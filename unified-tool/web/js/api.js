/**
 * API 封装模块
 * 封装与 Python 后端的通信
 */

const API = {
    // 是否已连接后端
    ready: false,
    _mode: null, // 'pywebview' | 'http'
    _httpBase: 'http://127.0.0.1:8766',
    
    // 等待后端就绪
    async waitReady() {
        // 支持两种模式：
        // 1) pywebview 注入 window.pywebview.api
        // 2) 浏览器模式走 HTTP /api/call
        if (this.ready) return true;

        const hasPywebview = !!(window.pywebview && window.pywebview.api);
        if (hasPywebview) {
            this._mode = 'pywebview';
            this.ready = true;
            return true;
        }

        // 浏览器模式：不阻塞等待，直接切 HTTP
        this._mode = 'http';
        try {
            // 尽量使用当前 origin，避免端口变化时写死
            if (window.location && window.location.origin) {
                this._httpBase = window.location.origin;
            }
        } catch (e) {}
        this.ready = true;
        return true;
    },
    
    // 通用调用
    async call(method, ...args) {
        if (!this.ready) await this.waitReady();
        try {
            if (this._mode === 'pywebview' && window.pywebview && window.pywebview.api) {
                return await window.pywebview.api[method](...args);
            }

            // HTTP fallback
            const resp = await fetch(`${this._httpBase}/api/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method, params: args || [] })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return await resp.json();
        } catch (e) {
            console.error(`API调用失败 [${method}]:`, e);
            throw e;
        }
    },
    
    // === 设备控制 ===
    device: {
        async list() { return API.call('get_devices_list'); },
        async connect(id, port, baudrate) { return API.call('connect_device', id, port, baudrate); },
        async disconnect(id) { return API.call('disconnect_device', id); },
        async move(id, distance, mode) { return API.call('move_device', id, distance, mode); },
        async home(id) { return API.call('home_device', id); },
        async stop(id) { return API.call('stop_device', id); },
        async jog(id, direction, speed) { return API.call('jog_device', id, direction, speed); }
    },
    
    // === 调试工具 ===
    debug: {
        // 串口
        async getPorts() { return API.call('get_serial_ports'); },
        async getBaudRates() { return API.call('get_baud_rates'); },
        async connectSerial(port, baudrate) { return API.call('debug_connect_serial', port, baudrate); },
        async connectWifi(ip, port) { return API.call('debug_connect_wifi', ip, port); },
        async disconnect() { return API.call('debug_disconnect'); },
        async getStatus() { return API.call('debug_get_status'); },
        async send(data, isHex) { return API.call('debug_send', data, isHex); },
        async clearStats() { return API.call('debug_clear_stats'); },
        
        // 命令管理
        async getConfigs() { return API.call('cmd_get_configs'); },
        async getCurrentConfig() { return API.call('cmd_get_current_config'); },
        async setCurrentConfig(name) { return API.call('cmd_set_current_config', name); },
        async getCommands() { return API.call('cmd_get_commands'); },
        async addCommand(hex, desc, delay) { return API.call('cmd_add', hex, desc, delay); },
        async updateCommand(idx, hex, desc, delay) { return API.call('cmd_update', idx, hex, desc, delay); },
        async deleteCommand(idx) { return API.call('cmd_delete', idx); },
        async sendCommand(idx) { return API.call('cmd_send_by_index', idx); },
        async addConfig(name) { return API.call('cmd_add_config', name); },
        async deleteConfig(name) { return API.call('cmd_delete_config', name); }
    },
    
    // === 滑台测试 ===
    slipway: {
        async connect(ip, port) { return API.call('slipway_connect', ip, port); },
        async disconnect() { return API.call('slipway_disconnect'); },
        async getStatus() { return API.call('slipway_get_status'); },
        async getProtocolOverview() { return API.call('slipway_get_protocol_overview'); },
        async getIoStatus(ioNums) { return API.call('slipway_get_io_status', ioNums || null); },
        async reset() { return API.call('slipway_reset'); },
        async moveTo(pos, minSpeed, maxSpeed) { return API.call('slipway_move_to', pos, minSpeed, maxSpeed); },
        async stop() { return API.call('slipway_stop'); },
        async getPosition() { return API.call('slipway_get_position'); },
        async measureOnce(measure = null) { return API.call('slipway_measure_once', measure); },
        
        // 转靶
        async rotaryConnect(ip, port) { return API.call('rotary_connect', ip, port); },
        async rotaryDisconnect() { return API.call('rotary_disconnect'); },
        async rotaryGetStatus() { return API.call('rotary_get_status'); },
        async rotaryReset() { return API.call('rotary_reset'); },
        async rotaryMoveTo(pos) { return API.call('rotary_move_to', pos); },
        
        // 测试
        async startAccuracyTest(params) { return API.call('test_start_accuracy', params); },
        async startPlan(params) { return API.call('test_start_plan', params); },
        async stopTest() { return API.call('test_stop'); },
        async getTestResults() { return API.call('test_get_results'); },
        async getTestStatus() { return API.call('test_get_status'); },
        // 断点续测
        async getTestProgress() { return API.call('test_get_progress'); },
        async resumeTest(fromSegment = -1) { return API.call('test_resume', fromSegment); },
        async clearTestProgress() { return API.call('test_clear_progress'); }
    },
    
    // === 生产管理 ===
    production: {
        async getPrograms() { return API.call('get_programs_list'); },
        async getProgram(id) { return API.call('get_program', id); },
        async saveProgram(id, data) { return API.call('save_program', id, data); },
        async deleteProgram(id) { return API.call('delete_program', id); },
        async runProgram(id) { return API.call('run_program', id); },
        async stopProgram() { return API.call('stop_program'); },
        async search(keyword) { return API.call('search_programs', keyword); }
    },

    // === 生产烧录（prod_flash 兼容 FirmwareService） ===
    prodFlash: {
        async getProductionVersions(projectId = null, includeTest = true) {
            return API.call('prod_get_versions', projectId, includeTest);
        },
        async getFlashLogs(projectId = null, limit = 10, includeAll = true) {
            return API.call('prod_get_flash_logs', projectId, limit, includeAll);
        },
        async getFlashStats(projectId = null, includeAll = true) {
            return API.call('prod_get_flash_stats', projectId, includeAll);
        },
        async generateSN(projectId) {
            return API.call('prod_generate_sn', projectId);
        },
        async flash(projectId, version, serialNumber, tool, chip) {
            return API.call('prod_flash', projectId, version, serialNumber, tool, chip);
        }
    },
    
    // === 校准测试 ===
    calibration: {
        async getTemplates() { return API.call('get_test_templates'); },
        async startTest(templateId, params) { return API.call('start_test', templateId, params); },
        async stopTest() { return API.call('stop_test'); },
        async getStatus() { return API.call('cal_get_status'); },
        async getResults() { return API.call('get_test_results'); },
        async generateReport(format) { return API.call('generate_report', format); },
        async getReports() { return API.call('get_reports_list'); },
        
        // V2 模块化接口
        async getCommands() { return API.call('cal_get_commands'); },
        async saveCommands(commands) { return API.call('cal_save_commands', commands); },
        async buildFrame(cmdId, params) { return API.call('cal_build_frame', cmdId, params); },
        async parseFrame(hex) { return API.call('cal_parse_frame', hex); },
        async getDeviceTypes() { return API.call('cal_get_device_types'); },
        async listDeviceConfigs() { return API.call('cal_list_device_configs'); },
        async getDeviceConfig(id) { return API.call('cal_get_device_config', id); },
        async addDeviceType(id, name, config) { return API.call('cal_add_device_type', id, name, config); },
        async updateDeviceType(id, config) { return API.call('cal_update_device_type', id, config); },
        async deleteDeviceType(id) { return API.call('cal_delete_device_type', id); },
        async listPorts() { return API.call('cal_list_ports'); },
        async connect(port, baud) { return API.call('cal_connect', port, baud); },
        async disconnect() { return API.call('cal_disconnect'); },
        async scanDevices() { return API.call('cal_scan_devices'); },
        async sendCommand(cmdId, params) { return API.call('cal_send_command', cmdId, params); },
        async sendRaw(hex) { return API.call('cal_send_raw', hex); },
        async getWorkflows() { return API.call('cal_get_workflows'); },
        async getWorkflow(id) { return API.call('cal_get_workflow', id); },
        async startWorkflow(id, params, startStep) { return API.call('cal_start_workflow', id, params, startStep); },
        async stopWorkflow() { return API.call('cal_stop_workflow'); },
        async confirmWorkflow(confirmed) { return API.call('cal_confirm_workflow', confirmed); },
        async getWorkflowStatus() { return API.call('cal_get_workflow_status'); },
        
        // 日志
        async getLogs(sinceIndex) { return API.call('cal_get_logs', sinceIndex || 0); },
        async clearLogs() { return API.call('cal_clear_logs'); }
    },
    
    // === 机型配置管理 ===
    deviceConfig: {
        async list() { return API.call('device_config_list'); },
        async get(configId) { return API.call('device_config_get', configId); },
        async activate(configId) { return API.call('device_config_activate', configId); },
        async getForModel(modelName) { return API.call('device_config_get_for_model', modelName); },
        async save(configId, configData) { return API.call('device_config_save', configId, configData); },
        async create(configId, name, fromTemplate) { return API.call('device_config_create', configId, name, fromTemplate); },
        async delete(configId) { return API.call('device_config_delete', configId); },
        async rename(configId, newName) { return API.call('device_config_rename', configId, newName); },
        async getTemplate() { return API.call('device_config_get_template'); }
    },

    // === 协议运行态 ===
    protocol: {
        async getRuntimeOverview() { return API.call('protocol_get_runtime_overview'); },
        async setRuntimeMeasure(measure) { return API.call('protocol_set_runtime_measure', measure); }
    },
    
    // === 系统设置 ===
    settings: {
        async getAll() { return API.call('get_settings'); },
        async get(key) { return API.call('get_setting', key); },
        async set(key, value) { return API.call('set_setting', key, value); },
        async setMultiple(settings) { return API.call('set_settings', settings); },
        async reset() { return API.call('reset_settings'); },
        async getSystemInfo() { return API.call('get_system_info'); },
        async exportConfig() { return API.call('export_config'); },

        // 工位/工装配置（本机）
        async stationList() { return API.call('station_list'); },
        async stationGetCurrent() { return API.call('station_get_current'); },
        async stationSetCurrent(stationId) { return API.call('station_set_current', stationId); },
        async stationCreate(stationId, name, toolProfileId) { return API.call('station_create', stationId, name, toolProfileId); },
        async stationDelete(stationId) { return API.call('station_delete', stationId); },
        async toolProfileGet(profileId = null) { return API.call('tool_profile_get', profileId); },
        async toolProfileUpdate(profileId, profile) { return API.call('tool_profile_update', profileId, profile); },

        // 竞品协议库（本机）
        async competitorProtoList() { return API.call('competitor_proto_list'); },
        async competitorProtoGet(protoId) { return API.call('competitor_proto_get', protoId); },
        async competitorProtoSave(protoId, proto) { return API.call('competitor_proto_save', protoId, proto); },
        async competitorProtoDelete(protoId) { return API.call('competitor_proto_delete', protoId); }
    },
    
    // === 通用 ===
    async getAppInfo() { return this.call('get_app_info'); },
    log(level, message) { this.call('log', level, message); }
};

// 后端事件处理器
window.onBackendEvent = function(eventName, data) {
    console.log(`[Backend Event] ${eventName}:`, data);
    
    // 分发到具体处理函数
    const handler = window[`on${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`];
    if (handler) handler(data);
    
    // 触发自定义事件
    document.dispatchEvent(new CustomEvent('backend:' + eventName, { detail: data }));
};

// 导出
window.API = API;

// ========== 兼容层：旧代码使用 FirmwareService ========== 
// prod_flash.js 依赖 FirmwareService.getProductionVersions / getFlashLogs / getFlashStats / generateSN / flash
if (!window.FirmwareService) {
    window.FirmwareService = {
        getProductionVersions: (...args) => API.prodFlash.getProductionVersions(...args),
        getFlashLogs: (...args) => API.prodFlash.getFlashLogs(...args),
        getFlashStats: (...args) => API.prodFlash.getFlashStats(...args),
        generateSN: (...args) => API.prodFlash.generateSN(...args),
        flash: (...args) => API.prodFlash.flash(...args)
    };
}
