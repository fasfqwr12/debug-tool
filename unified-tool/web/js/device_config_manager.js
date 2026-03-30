/**
 * 设备配置管理器 (Singleton)
 * 统一管理所有设备的配置文件
 * 提供设备切换、配置加载/保存、事件订阅等功能
 */

class DeviceConfigManagerClass {
    constructor() {
        this.currentDevice = null;
        this.deviceList = [];
        this.cache = {};  // { deviceId: { lcd, tests, protocols, calibration, ... } }
        this.listeners = {};  // { eventType: [callbacks] }
        this._initialized = false;
        this._initPromise = null;
    }
    
    // ========== 初始化 ==========
    
    async init() {
        if (this._initialized) return;
        if (this._initPromise) return this._initPromise;
        
        this._initPromise = this._doInit();
        return this._initPromise;
    }
    
    async _doInit() {
        try {
            // 统一合并设备管理器和协议机型列表，保证“全局机型”可用于协议切换
            this.deviceList = await this._loadDeviceList();
            
            // 恢复上次选择的设备
            const lastDevice = localStorage.getItem('dm_currentDevice');
            if (lastDevice && this.deviceList.some(d => d.id === lastDevice)) {
                this.currentDevice = lastDevice;
            } else if (this.deviceList.length > 0) {
                this.currentDevice = this.deviceList[0].id;
            }

            if (this.currentDevice) {
                try {
                    await this._activateDeviceProtocol(this.currentDevice);
                } catch (e) {
                    console.warn('[DeviceConfigManager] 初始化时激活协议失败:', e);
                }
            }
            
            this._initialized = true;
            this._emit('initialized', { currentDevice: this.currentDevice });
            console.log('[DeviceConfigManager] 初始化完成, 当前设备:', this.currentDevice);
        } catch (e) {
            console.error('[DeviceConfigManager] 初始化失败:', e);
            this._initialized = true;  // 即使失败也标记为已初始化，避免重复尝试
        }
    }
    
    // ========== 设备管理 ==========
    
    /**
     * 获取设备列表
     * @returns {Array} 设备列表
     */
    listDevices() {
        return this.deviceList;
    }

    async _loadDeviceList() {
        const merged = new Map();

        try {
            const result = await this._apiCall('dm_device_list');
            if (result.success && Array.isArray(result.data)) {
                result.data.forEach(item => {
                    if (!item || !item.id) return;
                    merged.set(item.id, {
                        ...item,
                        id: item.id,
                        name: item.name || item.id,
                        source: item.source || 'device_manager'
                    });
                });
            }
        } catch (e) {
            console.warn('[DeviceConfigManager] 读取 dm_device_list 失败:', e);
        }

        try {
            const result = await this._apiCall('device_config_list');
            if (result.success && Array.isArray(result.configs)) {
                result.configs.forEach(item => {
                    if (!item || !item.id) return;
                    const prev = merged.get(item.id) || {};
                    merged.set(item.id, {
                        ...prev,
                        id: item.id,
                        name: prev.name || item.name || item.id,
                        model_pattern: item.model_pattern || prev.model_pattern || '',
                        version: item.version || prev.version || '1.0',
                        commands_count: item.commands_count ?? prev.commands_count ?? 0,
                        workflows_count: item.workflows_count ?? prev.workflows_count ?? 0,
                        source: prev.source ? `${prev.source}+protocol` : 'protocol'
                    });
                });
            }
        } catch (e) {
            console.warn('[DeviceConfigManager] 读取 device_config_list 失败:', e);
        }

        return Array.from(merged.values());
    }
    
    /**
     * 获取当前设备ID
     * @returns {string|null} 当前设备ID
     */
    getCurrentDevice() {
        return this.currentDevice;
    }
    
    /**
     * 获取当前设备信息
     * @returns {Object|null} 当前设备信息
     */
    getCurrentDeviceInfo() {
        if (!this.currentDevice) return null;
        return this.deviceList.find(d => d.id === this.currentDevice) || null;
    }
    
    /**
     * 切换当前设备
     * @param {string} deviceId 设备ID
     */
    async setCurrentDevice(deviceId) {
        if (!this.deviceList.some(d => d.id === deviceId)) {
            throw new Error(`设备 ${deviceId} 不存在`);
        }

        const oldDevice = this.currentDevice;

        if (oldDevice === deviceId) {
            return await this._activateDeviceProtocol(deviceId);
        }

        const activation = await this._activateDeviceProtocol(deviceId);
        this.currentDevice = deviceId;
        localStorage.setItem('dm_currentDevice', deviceId);
        
        // 清除旧设备的缓存
        if (oldDevice && oldDevice !== deviceId) {
            delete this.cache[oldDevice];
        }
        
        this._emit('device-changed', { oldDevice, newDevice: deviceId, activation });
        console.log('[DeviceConfigManager] 切换设备:', oldDevice, '->', deviceId, activation);
        return activation;
    }

    async _activateDeviceProtocol(deviceId) {
        const result = await this._apiCall('device_config_activate', [deviceId]);
        if (!result.success) {
            throw new Error(result.error || `激活机型协议失败: ${deviceId}`);
        }
        return result;
    }
    
    /**
     * 创建新设备
     * @param {string} deviceId 设备ID
     * @param {Object} options 选项 { name, description, lcdType, template }
     */
    async createDevice(deviceId, options = {}) {
        const result = await this._apiCall('dm_device_create', [deviceId, options]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        this.deviceList = await this._loadDeviceList();
        
        this._emit('device-created', { deviceId });
        return deviceId;
    }
    
    /**
     * 删除设备
     * @param {string} deviceId 设备ID
     */
    async deleteDevice(deviceId) {
        if (deviceId === this.currentDevice) {
            throw new Error('不能删除当前选中的设备');
        }
        
        const result = await this._apiCall('dm_device_delete', [deviceId]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // 刷新设备列表
        this.deviceList = this.deviceList.filter(d => d.id !== deviceId);
        delete this.cache[deviceId];
        
        this._emit('device-deleted', { deviceId });
    }
    
    /**
     * 确保设备存在
     * @param {string} deviceId 设备ID
     */
    async ensureDeviceExists(deviceId) {
        if (this.deviceList.some(d => d.id === deviceId)) {
            return true;
        }
        
        // 尝试创建
        await this.createDevice(deviceId);
        return true;
    }
    
    // ========== 通用配置加载/保存 ==========
    
    // 配置版本定义
    static CONFIG_VERSIONS = {
        lcd: '1.0',
        tests: '1.0',
        actions: '1.0',
        protocols: '1.0',
        calibration: '1.0',
        workflows: '1.0',
        debug: '1.0',
        templates: '1.0'
    };
    
    /**
     * 加载配置
     * @param {string} type 配置类型
     * @param {string} deviceId 设备ID（可选，默认当前设备）
     * @param {Object} options 选项 { useCache: true, showPath: true }
     */
    async loadConfig(type, deviceId = null, options = {}) {
        const { useCache = true, showPath = true } = options;
        const id = deviceId || this.currentDevice;
        if (!id) throw new Error('未选择设备');
        
        // 检查缓存
        if (useCache && this.cache[id]?.[type]) {
            console.log(`[DeviceConfigManager] 使用缓存: ${type} (${id})`);
            // 即使用缓存也触发事件，让工具栏能显示
            if (showPath && this.cache[id]?.[`${type}_path`]) {
                const pathInfo = this.cache[id][`${type}_path`];
                this._emit('config-loaded', {
                    deviceId: id,
                    type,
                    filePath: pathInfo.filePath,
                    fullPath: pathInfo.fullPath,
                    exists: pathInfo.exists,
                    fromCache: true
                });
            }
            return this.cache[id][type];
        }
        
        const result = await this._apiCall('dm_config_load', [id, type]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        let data = result.data;
        
        // 显示加载的文件路径信息
        const pathInfo = result.filePath || `data/devices/${id}/${type}`;
        const exists = result.exists !== false;
        
        if (showPath) {
            const status = exists ? '✓' : '(不存在)';
            console.log(`[DeviceConfigManager] 加载配置: ${pathInfo} ${status}`);
        }
        
        // 触发路径信息事件，供UI显示
        this._emit('config-loaded', {
            deviceId: id,
            type,
            filePath: result.filePath,
            fullPath: result.fullPath,
            exists: exists,
            fromCache: false
        });
        
        // 版本检查和迁移
        if (data && typeof data === 'object') {
            data = this._checkAndMigrateConfig(type, data);
        }
        
        // 缓存结果（同时保存路径信息）
        if (!this.cache[id]) this.cache[id] = {};
        this.cache[id][type] = data;
        this.cache[id][`${type}_path`] = {
            filePath: result.filePath,
            fullPath: result.fullPath,
            exists: result.exists
        };
        
        return data;
    }
    
    /**
     * 获取配置文件路径信息
     * @param {string} type 配置类型
     * @param {string} deviceId 设备ID（可选）
     * @returns {Object|null} { filePath, fullPath, exists }
     */
    getConfigPath(type, deviceId = null) {
        const id = deviceId || this.currentDevice;
        return this.cache[id]?.[`${type}_path`] || null;
    }
    
    /**
     * 检查配置版本并迁移
     * @param {string} type 配置类型
     * @param {Object} data 配置数据
     * @returns {Object} 迁移后的配置
     */
    _checkAndMigrateConfig(type, data) {
        const currentVersion = DeviceConfigManagerClass.CONFIG_VERSIONS[type];
        if (!currentVersion) return data;
        
        const dataVersion = data._version || data.version || '0.0';
        
        // 版本相同，无需迁移
        if (dataVersion === currentVersion) return data;
        
        // 版本不同，尝试迁移
        console.log(`[DeviceConfigManager] 配置版本不匹配: ${type} (${dataVersion} -> ${currentVersion})`);
        
        const migrated = this._migrateConfig(type, data, dataVersion, currentVersion);
        
        // 更新版本号
        if (migrated && typeof migrated === 'object') {
            migrated._version = currentVersion;
        }
        
        return migrated;
    }
    
    /**
     * 迁移配置到新版本
     * @param {string} type 配置类型
     * @param {Object} data 原始数据
     * @param {string} fromVersion 原版本
     * @param {string} toVersion 目标版本
     * @returns {Object} 迁移后的数据
     */
    _migrateConfig(type, data, fromVersion, toVersion) {
        // 目前所有配置都是1.0版本，暂无迁移逻辑
        // 未来添加新版本时在这里添加迁移代码
        
        // 示例迁移逻辑:
        // if (type === 'lcd' && fromVersion === '0.9' && toVersion === '1.0') {
        //     // 迁移LCD配置从0.9到1.0
        //     data.newField = data.oldField;
        //     delete data.oldField;
        // }
        
        return data;
    }
    
    /**
     * 保存配置
     * @param {string} type 配置类型
     * @param {*} data 配置数据
     * @param {string} deviceId 设备ID（可选，默认当前设备）
     */
    async saveConfig(type, data, deviceId = null) {
        const id = deviceId || this.currentDevice;
        if (!id) throw new Error('未选择设备');
        
        const result = await this._apiCall('dm_config_save', [id, type, data]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // 更新缓存
        if (this.cache[id]) {
            this.cache[id][type] = data;
        }
        
        this._emit(`${type}-updated`, { deviceId: id, data });
    }
    
    // ========== 便捷方法 (语义化封装) ==========
    
    async loadLcdProject(deviceId = null) { return this.loadConfig('lcd', deviceId); }
    async saveLcdProject(data, deviceId = null) { return this.saveConfig('lcd', data, deviceId); }
    
    async loadTestSuite(deviceId = null) { return this.loadConfig('tests', deviceId); }
    async saveTestSuite(data, deviceId = null) { return this.saveConfig('tests', data, deviceId); }
    
    async loadActions(deviceId = null) { return this.loadConfig('actions', deviceId); }
    async saveActions(data, deviceId = null) { return this.saveConfig('actions', data, deviceId); }
    
    async loadProtocols(deviceId = null) { return this.loadConfig('protocols', deviceId); }
    async saveProtocols(data, deviceId = null) { return this.saveConfig('protocols', data, deviceId); }
    
    async loadCalibration(deviceId = null) { return this.loadConfig('calibration', deviceId); }
    async saveCalibration(data, deviceId = null) { return this.saveConfig('calibration', data, deviceId); }
    
    async loadWorkflows(deviceId = null) { return this.loadConfig('workflows', deviceId); }
    async saveWorkflows(data, deviceId = null) { return this.saveConfig('workflows', data, deviceId); }
    
    async loadDebugCommands(deviceId = null) { return this.loadConfig('debug', deviceId); }
    async saveDebugCommands(data, deviceId = null) { return this.saveConfig('debug', data, deviceId); }
    
    async loadTemplates(deviceId = null) { return this.loadConfig('templates', deviceId); }
    async saveTemplates(data, deviceId = null) { return this.saveConfig('templates', data, deviceId); }
    
    async loadComponents(deviceId = null) { return this.loadConfig('components', deviceId); }
    async saveComponents(data, deviceId = null) { return this.saveConfig('components', data, deviceId); }

    async loadMacros(deviceId = null) { return this.loadConfig('macros', deviceId); }
    async saveMacros(data, deviceId = null) { return this.saveConfig('macros', data, deviceId); }

    async loadFlow(deviceId = null) { return this.loadConfig('flow', deviceId); }
    async saveFlow(data, deviceId = null) { return this.saveConfig('flow', data, deviceId); }

    /**
     * 创建设备选择器（便捷方法）
     * @param {string} containerId 容器元素ID
     * @param {Function} onChange 设备切换回调
     */
    createSelector(containerId, onChange = null) {
        return createDeviceSelector(containerId, { onChange, showAdd: true, showManage: true });
    }

    
    // ========== 事件订阅 ==========
    
    /**
     * 订阅事件
     * @param {string} eventType 事件类型
     * @param {Function} callback 回调函数
     * @returns {Function} 取消订阅函数
     */
    subscribe(eventType, callback) {
        if (!this.listeners[eventType]) {
            this.listeners[eventType] = [];
        }
        this.listeners[eventType].push(callback);
        return () => this.unsubscribe(eventType, callback);
    }
    
    /**
     * 取消订阅
     * @param {string} eventType 事件类型
     * @param {Function} callback 回调函数
     */
    unsubscribe(eventType, callback) {
        if (this.listeners[eventType]) {
            this.listeners[eventType] = this.listeners[eventType].filter(cb => cb !== callback);
        }
    }
    
    /**
     * 触发事件
     * @param {string} eventType 事件类型
     * @param {*} data 事件数据
     */
    _emit(eventType, data) {
        if (this.listeners[eventType]) {
            this.listeners[eventType].forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[DeviceConfigManager] 事件处理错误 ${eventType}:`, e);
                }
            });
        }
    }
    
    // ========== 缓存管理 ==========
    
    /**
     * 使缓存失效
     * @param {string} type 配置类型（可选）
     * @param {string} deviceId 设备ID（可选）
     */
    invalidateCache(type = null, deviceId = null) {
        const id = deviceId || this.currentDevice;
        if (type && this.cache[id]) {
            delete this.cache[id][type];
        } else if (id) {
            delete this.cache[id];
        }
    }
    
    /**
     * 清除所有缓存
     */
    clearCache() {
        this.cache = {};
    }
    
    // ========== 数据迁移 ==========
    
    /**
     * 迁移旧配置到新结构
     * @param {string} deviceId 设备ID
     */
    async migrateDevice(deviceId) {
        const result = await this._apiCall('dm_device_migrate', [deviceId]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        this.deviceList = await this._loadDeviceList();
        
        return result.data;  // 返回迁移日志
    }
    
    // ========== 导入导出 ==========
    
    /**
     * 导出设备配置
     * @param {string} deviceId 设备ID
     */
    async exportDevice(deviceId) {
        const result = await this._apiCall('dm_device_export', [deviceId]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        // 触发下载
        const { filename, content } = result.data;
        const blob = this._base64ToBlob(content, 'application/zip');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    /**
     * 导入设备配置
     * @param {File} file ZIP文件
     * @param {string} deviceId 设备ID（可选）
     * @param {boolean} overwrite 是否覆盖
     */
    async importDevice(file, deviceId = null, overwrite = false) {
        const base64 = await this._fileToBase64(file);
        const result = await this._apiCall('dm_device_import', [base64, deviceId, overwrite]);
        if (!result.success) {
            throw new Error(result.error);
        }
        
        this.deviceList = await this._loadDeviceList();
        
        this._emit('device-created', { deviceId: result.data });
        return result.data;
    }
    
    // ========== API调用 ==========
    
    async _apiCall(method, params = []) {
        const response = await fetch('/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, params })
        });
        const result = await response.json();
        return result;
    }
    
    // ========== 工具方法 ==========
    
    _base64ToBlob(base64, type) {
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type });
    }
    
    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}

// 全局单例
window.DeviceConfigManager = new DeviceConfigManagerClass();


// ========== 设备选择器组件 ==========

/**
 * 创建设备选择器组件
 * @param {string} containerId 容器元素ID
 * @param {Object} options 选项 { onChange, showAdd, showManage }
 */
function createDeviceSelector(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('[DeviceSelector] 容器不存在:', containerId);
        return null;
    }
    
    const {
        onChange = null,
        showAdd = true,
        showManage = true
    } = options;
    
    const render = async () => {
        // 确保初始化
        if (!DeviceConfigManager._initialized) {
            await DeviceConfigManager.init();
        }
        
        const devices = DeviceConfigManager.listDevices();
        const current = DeviceConfigManager.getCurrentDevice();
        
        container.innerHTML = `
            <div class="device-selector">
                <select class="device-selector-select">
                    ${devices.length === 0 ? '<option value="">-- 无设备 --</option>' : ''}
                    ${devices.map(d => `
                        <option value="${d.id}" ${d.id === current ? 'selected' : ''}>
                            ${d.name || d.id}
                        </option>
                    `).join('')}
                </select>
                ${showAdd ? '<button class="device-selector-btn device-selector-add" title="新建设备">+</button>' : ''}
                ${showManage ? '<button class="device-selector-btn device-selector-manage" title="管理设备">⚙️</button>' : ''}
            </div>
        `;
        
        // 绑定事件
        const select = container.querySelector('.device-selector-select');
        select.addEventListener('change', async (e) => {
            const deviceId = e.target.value;
            if (deviceId) {
                await DeviceConfigManager.setCurrentDevice(deviceId);
                if (onChange) onChange(deviceId);
            }
        });
        
        if (showAdd) {
            container.querySelector('.device-selector-add').addEventListener('click', () => {
                showCreateDeviceDialog();
            });
        }
        
        if (showManage) {
            container.querySelector('.device-selector-manage').addEventListener('click', () => {
                showManageDevicesDialog();
            });
        }
    };
    
    // 监听设备变化
    DeviceConfigManager.subscribe('device-changed', render);
    DeviceConfigManager.subscribe('device-created', render);
    DeviceConfigManager.subscribe('device-deleted', render);
    
    render();
    return { render };
}

/**
 * 显示创建设备对话框
 */
function showCreateDeviceDialog() {
    // 创建对话框
    const dialog = document.createElement('div');
    dialog.className = 'dm-dialog-overlay';
    dialog.innerHTML = `
        <div class="dm-dialog">
            <div class="dm-dialog-header">
                <h3>新建设备</h3>
                <button class="dm-dialog-close">&times;</button>
            </div>
            <div class="dm-dialog-body">
                <div class="dm-form-group">
                    <label>设备ID <span class="required">*</span></label>
                    <input type="text" id="dm-device-id" placeholder="小写字母、数字、下划线" pattern="[a-z0-9_]+">
                    <small>例如: gd303_mini, gd303_pt</small>
                </div>
                <div class="dm-form-group">
                    <label>显示名称 <span class="required">*</span></label>
                    <input type="text" id="dm-device-name" placeholder="设备显示名称">
                </div>
                <div class="dm-form-group">
                    <label>LCD类型</label>
                    <select id="dm-device-lcd-type">
                        <option value="segment">段码LCD</option>
                        <option value="dot_matrix">点阵LCD</option>
                    </select>
                </div>
                <div class="dm-form-group">
                    <label>描述</label>
                    <textarea id="dm-device-desc" rows="2" placeholder="可选"></textarea>
                </div>
            </div>
            <div class="dm-dialog-footer">
                <button class="dm-btn dm-btn-secondary dm-dialog-cancel">取消</button>
                <button class="dm-btn dm-btn-primary dm-dialog-confirm">创建</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    dialog.querySelector('.dm-dialog-close').onclick = () => dialog.remove();
    dialog.querySelector('.dm-dialog-cancel').onclick = () => dialog.remove();
    dialog.querySelector('.dm-dialog-overlay').onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };
    
    dialog.querySelector('.dm-dialog-confirm').onclick = async () => {
        const deviceId = document.getElementById('dm-device-id').value.trim();
        const name = document.getElementById('dm-device-name').value.trim();
        const lcdType = document.getElementById('dm-device-lcd-type').value;
        const description = document.getElementById('dm-device-desc').value.trim();
        
        if (!deviceId) {
            alert('请输入设备ID');
            return;
        }
        if (!/^[a-z0-9_]+$/.test(deviceId)) {
            alert('设备ID只能包含小写字母、数字和下划线');
            return;
        }
        if (!name) {
            alert('请输入显示名称');
            return;
        }
        
        try {
            await DeviceConfigManager.createDevice(deviceId, { name, lcdType, description });
            await DeviceConfigManager.setCurrentDevice(deviceId);
            dialog.remove();
        } catch (e) {
            alert('创建失败: ' + e.message);
        }
    };
    
    // 聚焦第一个输入框
    document.getElementById('dm-device-id').focus();
}

/**
 * 显示设备管理对话框
 */
function showManageDevicesDialog() {
    const devices = DeviceConfigManager.listDevices();
    const current = DeviceConfigManager.getCurrentDevice();
    
    const dialog = document.createElement('div');
    dialog.className = 'dm-dialog-overlay';
    dialog.innerHTML = `
        <div class="dm-dialog dm-dialog-wide">
            <div class="dm-dialog-header">
                <h3>设备管理</h3>
                <button class="dm-dialog-close">&times;</button>
            </div>
            <div class="dm-dialog-body">
                <div class="dm-toolbar">
                    <button class="dm-btn dm-btn-secondary dm-import-device">📥 导入设备</button>
                    <input type="file" class="dm-import-file" accept=".zip" style="display:none">
                </div>
                <div class="dm-device-list">
                    ${devices.length === 0 ? '<div class="dm-empty">暂无设备</div>' : ''}
                    ${devices.map(d => `
                        <div class="dm-device-item ${d.id === current ? 'active' : ''}" data-id="${d.id}">
                            <div class="dm-device-info">
                                <div class="dm-device-name">${d.name || d.id}</div>
                                <div class="dm-device-id">${d.id}</div>
                                ${d.description ? `<div class="dm-device-desc">${d.description}</div>` : ''}
                            </div>
                            <div class="dm-device-actions">
                                <button class="dm-btn dm-btn-sm dm-export-device" data-id="${d.id}" title="导出配置">📤</button>
                                ${d.id === current ? '<span class="dm-badge">当前</span>' : `
                                    <button class="dm-btn dm-btn-sm dm-btn-danger dm-delete-device" data-id="${d.id}">删除</button>
                                `}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="dm-dialog-footer">
                <button class="dm-btn dm-btn-secondary dm-dialog-close-btn">关闭</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    dialog.querySelector('.dm-dialog-close').onclick = () => dialog.remove();
    dialog.querySelector('.dm-dialog-close-btn').onclick = () => dialog.remove();
    dialog.querySelector('.dm-dialog-overlay').onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };
    
    // 导入按钮
    const importBtn = dialog.querySelector('.dm-import-device');
    const importFile = dialog.querySelector('.dm-import-file');
    importBtn.onclick = () => importFile.click();
    importFile.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const deviceId = await DeviceConfigManager.importDevice(file);
            alert(`设备 "${deviceId}" 导入成功！`);
            dialog.remove();
            showManageDevicesDialog();  // 刷新
        } catch (err) {
            alert('导入失败: ' + err.message);
        }
    };
    
    // 导出按钮
    dialog.querySelectorAll('.dm-export-device').forEach(btn => {
        btn.onclick = async () => {
            const deviceId = btn.dataset.id;
            try {
                await DeviceConfigManager.exportDevice(deviceId);
            } catch (err) {
                alert('导出失败: ' + err.message);
            }
        };
    });
    
    // 删除按钮
    dialog.querySelectorAll('.dm-delete-device').forEach(btn => {
        btn.onclick = async () => {
            const deviceId = btn.dataset.id;
            if (confirm(`确定要删除设备 "${deviceId}" 吗？\n\n删除后可在回收站恢复。`)) {
                try {
                    await DeviceConfigManager.deleteDevice(deviceId);
                    dialog.remove();
                    showManageDevicesDialog();  // 刷新
                } catch (e) {
                    alert('删除失败: ' + e.message);
                }
            }
        };
    });
}

/**
 * 显示配置加载状态面板
 * 展示当前设备所有配置文件的加载状态
 */
async function showConfigStatusPanel() {
    const deviceId = DeviceConfigManager.getCurrentDevice();
    if (!deviceId) {
        alert('请先选择设备');
        return;
    }
    
    // 配置类型定义
    const configTypes = [
        { type: 'lcd', name: 'LCD段码映射', path: 'lcd/project.json', icon: '🎨' },
        { type: 'components', name: 'LCD组件', path: 'lcd/components.json', icon: '🧩' },
        { type: 'animations', name: '动画效果', path: 'lcd/animations.json', icon: '✨' },
        { type: 'macros', name: '宏动作', path: 'lcd/macros.json', icon: '📜' },
        { type: 'tests', name: '测试套件', path: 'tests/suite.js', icon: '📋' },
        { type: 'actions', name: '动作库', path: 'tests/actions.json', icon: '⚡' },
        { type: 'protocols', name: '协议命令', path: 'protocols/commands.json', icon: '📡' },
        { type: 'workflows', name: '工作流', path: 'protocols/workflows.json', icon: '🔄' },
        { type: 'calibration', name: '校准配置', path: 'calibration/config.json', icon: '🎯' },
        { type: 'debug', name: '调试命令', path: 'debug/commands.json', icon: '🔧' },
        { type: 'templates', name: '测试模板', path: 'tests/templates.json', icon: '📄' },
        { type: 'ui', name: '状态机', path: 'ui/stateMachine.json', icon: '🔀' },
    ];
    
    // 创建对话框
    const dialog = document.createElement('div');
    dialog.className = 'dm-dialog-overlay';
    dialog.innerHTML = `
        <div class="dm-dialog dm-dialog-wide" style="max-width:700px;">
            <div class="dm-dialog-header">
                <h3>📂 配置加载状态 - ${deviceId}</h3>
                <button class="dm-dialog-close">&times;</button>
            </div>
            <div class="dm-dialog-body" style="max-height:500px;overflow-y:auto;">
                <div style="margin-bottom:12px;padding:8px;background:var(--bg-tertiary);border-radius:6px;">
                    <div style="font-size:11px;color:var(--text-muted);">配置目录</div>
                    <div style="font-family:monospace;font-size:12px;color:var(--accent-color);">
                        data/devices/${deviceId}/
                    </div>
                </div>
                <div id="config-status-list" style="display:flex;flex-direction:column;gap:8px;">
                    <div style="text-align:center;padding:20px;color:var(--text-muted);">
                        加载中...
                    </div>
                </div>
            </div>
            <div class="dm-dialog-footer">
                <button class="dm-btn dm-btn-secondary" onclick="this.closest('.dm-dialog-overlay').remove()">关闭</button>
                <button class="dm-btn dm-btn-primary" id="btn-reload-all">🔄 重新加载全部</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定关闭事件
    dialog.querySelector('.dm-dialog-close').onclick = () => dialog.remove();
    dialog.querySelector('.dm-dialog-overlay').onclick = (e) => {
        if (e.target === dialog) dialog.remove();
    };
    
    // 加载各配置状态
    const listContainer = dialog.querySelector('#config-status-list');
    let html = '';
    
    for (const cfg of configTypes) {
        try {
            // 强制重新加载以获取最新路径信息
            await DeviceConfigManager.loadConfig(cfg.type, deviceId, { useCache: false, showPath: false });
            const pathInfo = DeviceConfigManager.getConfigPath(cfg.type, deviceId);
            const data = DeviceConfigManager.cache[deviceId]?.[cfg.type];
            
            const exists = pathInfo?.exists !== false;
            const hasData = data !== null && data !== undefined;
            
            // 计算数据统计
            let stats = '-';
            if (hasData) {
                if (cfg.type === 'lcd' && data.elements) {
                    stats = `${data.elements.length} 个元素`;
                } else if (cfg.type === 'actions' && data.actions) {
                    stats = `${Object.keys(data.actions).length} 个动作`;
                } else if (cfg.type === 'protocols' && data.commands) {
                    stats = `${data.commands.length} 个命令`;
                } else if (cfg.type === 'tests') {
                    if (typeof data === 'string') {
                        stats = `${data.length} 字符 (JS)`;
                    } else if (data.categories) {
                        let count = 0;
                        data.categories.forEach(c => c.cases?.forEach(cs => count += cs.subcases?.length || 0));
                        stats = `${count} 个用例`;
                    }
                } else if (cfg.type === 'ui' && data.states) {
                    stats = `${data.states.length} 个状态`;
                } else if (typeof data === 'object') {
                    stats = `${Object.keys(data).length} 个字段`;
                }
            }
            
            const statusIcon = exists ? (hasData ? '✅' : '⚠️') : '❌';
            const statusText = exists ? (hasData ? '已加载' : '空文件') : '不存在';
            const statusColor = exists ? (hasData ? 'var(--accent-color)' : '#f59e0b') : '#ff6b6b';
            
            html += `
                <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-tertiary);border-radius:6px;border-left:3px solid ${statusColor};">
                    <div style="font-size:20px;">${cfg.icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:500;font-size:13px;">${cfg.name}</div>
                        <div style="font-family:monospace;font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;">
                            ${cfg.path}
                        </div>
                    </div>
                    <div style="text-align:right;min-width:80px;">
                        <div style="font-size:11px;color:${statusColor};">${statusIcon} ${statusText}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${stats}</div>
                    </div>
                </div>
            `;
        } catch (err) {
            html += `
                <div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--bg-tertiary);border-radius:6px;border-left:3px solid #ff6b6b;">
                    <div style="font-size:20px;">${cfg.icon}</div>
                    <div style="flex:1;">
                        <div style="font-weight:500;font-size:13px;">${cfg.name}</div>
                        <div style="font-size:11px;color:#ff6b6b;">加载错误: ${err.message}</div>
                    </div>
                </div>
            `;
        }
    }
    
    listContainer.innerHTML = html;
    
    // 重新加载全部按钮
    dialog.querySelector('#btn-reload-all').onclick = async () => {
        DeviceConfigManager.invalidateCache(null, deviceId);
        dialog.remove();
        showConfigStatusPanel();
    };
}

// 导出
window.createDeviceSelector = createDeviceSelector;
window.showCreateDeviceDialog = showCreateDeviceDialog;
window.showManageDevicesDialog = showManageDevicesDialog;
window.showConfigStatusPanel = showConfigStatusPanel;

// ========== 配置加载工具栏 (悬浮小组件) ==========

/**
 * 配置加载工具栏 - 显示当前页面加载的配置文件
 */
class ConfigToolbar {
    constructor() {
        this.element = null;
        this.loadedConfigs = [];  // [{type, path, exists, time}]
        this.isMinimized = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }
    
    /**
     * 初始化工具栏
     */
    init() {
        if (this.element) return;
        
        // 创建工具栏元素
        this.element = document.createElement('div');
        this.element.id = 'config-toolbar';
        this.element.innerHTML = `
            <div class="ct-header" id="ct-header">
                <span class="ct-title">📂 配置加载</span>
                <span class="ct-device" id="ct-device">-</span>
                <div class="ct-btns">
                    <button class="ct-btn" onclick="ConfigToolbar.toggle()" title="展开/收起">▼</button>
                    <button class="ct-btn" onclick="ConfigToolbar.refresh()" title="刷新">🔄</button>
                    <button class="ct-btn" onclick="showConfigStatusPanel()" title="详情">📋</button>
                </div>
            </div>
            <div class="ct-body" id="ct-body">
                <div class="ct-empty">暂无加载记录</div>
            </div>
        `;
        
        // 添加样式
        if (!document.getElementById('config-toolbar-style')) {
            const style = document.createElement('style');
            style.id = 'config-toolbar-style';
            style.textContent = `
                #config-toolbar {
                    position: fixed;
                    right: 10px;
                    bottom: 10px;
                    width: 280px;
                    background: var(--card-bg, #1e1e2e);
                    border: 1px solid var(--border-color, #333);
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    font-size: 11px;
                    z-index: 9999;
                    overflow: hidden;
                    transition: width 0.2s ease;
                }
                #config-toolbar.minimized {
                    width: 160px;
                }
                #config-toolbar.minimized .ct-body {
                    display: none;
                }
                #config-toolbar.minimized .ct-btn:first-child {
                    transform: rotate(180deg);
                }
                .ct-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 10px;
                    background: var(--bg-tertiary, #252535);
                    border-bottom: 1px solid var(--border-color, #333);
                    cursor: move;
                    user-select: none;
                }
                .ct-title {
                    font-weight: 600;
                    color: var(--text-primary, #fff);
                }
                .ct-device {
                    flex: 1;
                    color: var(--accent-color, #00d4ff);
                    font-family: monospace;
                    font-size: 10px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .ct-btns {
                    display: flex;
                    gap: 4px;
                }
                .ct-btn {
                    width: 20px;
                    height: 20px;
                    padding: 0;
                    background: transparent;
                    border: none;
                    color: var(--text-muted, #888);
                    cursor: pointer;
                    border-radius: 3px;
                    font-size: 10px;
                    transition: all 0.15s;
                }
                .ct-btn:hover {
                    background: var(--bg-tertiary, #333);
                    color: var(--text-primary, #fff);
                }
                .ct-body {
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 6px;
                }
                .ct-empty {
                    text-align: center;
                    color: var(--text-muted, #666);
                    padding: 12px;
                }
                .ct-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 6px;
                    border-radius: 4px;
                    margin-bottom: 2px;
                    background: var(--bg-tertiary, #252535);
                }
                .ct-item:hover {
                    background: var(--input-bg, #2a2a3e);
                }
                .ct-item-icon {
                    font-size: 12px;
                }
                .ct-item-info {
                    flex: 1;
                    min-width: 0;
                }
                .ct-item-type {
                    font-weight: 500;
                    color: var(--text-primary, #fff);
                }
                .ct-item-path {
                    font-family: monospace;
                    font-size: 9px;
                    color: var(--text-muted, #888);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .ct-item-status {
                    font-size: 10px;
                }
                .ct-item-status.ok { color: #4caf50; }
                .ct-item-status.empty { color: #ff9800; }
                .ct-item-status.missing { color: #ff6b6b; }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(this.element);
        
        // 绑定拖拽事件
        this.initDrag();
        
        // 订阅配置加载事件
        DeviceConfigManager.subscribe('config-loaded', (e) => this.onConfigLoaded(e));
        DeviceConfigManager.subscribe('device-changed', (e) => this.onDeviceChanged(e));
        
        // 更新设备显示
        this.updateDevice();
        
        // 加载已缓存的配置信息
        this.loadCachedConfigs();
        
        console.log('[ConfigToolbar] 初始化完成');
    }
    
    /**
     * 初始化拖拽
     */
    initDrag() {
        const header = document.getElementById('ct-header');
        if (!header) return;
        
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.ct-btn')) return; // 点击按钮不拖拽
            
            this.isDragging = true;
            const rect = this.element.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            this.element.style.transition = 'none';
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            const x = e.clientX - this.dragOffset.x;
            const y = e.clientY - this.dragOffset.y;
            
            // 限制在窗口内
            const maxX = window.innerWidth - this.element.offsetWidth;
            const maxY = window.innerHeight - this.element.offsetHeight;
            
            this.element.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            this.element.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            this.element.style.right = 'auto';
            this.element.style.bottom = 'auto';
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.element.style.transition = 'width 0.2s ease';
            }
        });
    }
    
    /**
     * 加载已缓存的配置信息
     */
    loadCachedConfigs() {
        const deviceId = DeviceConfigManager.getCurrentDevice();
        if (!deviceId || !DeviceConfigManager.cache[deviceId]) return;
        
        const cache = DeviceConfigManager.cache[deviceId];
        const types = ['lcd', 'tests', 'actions', 'protocols', 'workflows', 'calibration', 'debug', 'templates', 'ui'];
        
        for (const type of types) {
            const pathKey = `${type}_path`;
            if (cache[pathKey]) {
                this.loadedConfigs.push({
                    type,
                    path: cache[pathKey].filePath,
                    exists: cache[pathKey].exists,
                    time: '缓存'
                });
            }
        }
        
        this.render();
    }
    
    /**
     * 更新设备显示
     */
    updateDevice() {
        const el = document.getElementById('ct-device');
        if (el) {
            el.textContent = DeviceConfigManager.getCurrentDevice() || '-';
        }
    }
    
    /**
     * 配置加载回调
     */
    onConfigLoaded(e) {
        const { type, filePath, exists } = e;
        
        // 更新或添加记录
        const idx = this.loadedConfigs.findIndex(c => c.type === type);
        const record = {
            type,
            path: filePath,
            exists,
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false })
        };
        
        if (idx >= 0) {
            this.loadedConfigs[idx] = record;
        } else {
            this.loadedConfigs.push(record);
        }
        
        this.render();
    }
    
    /**
     * 设备切换回调
     */
    onDeviceChanged(e) {
        this.loadedConfigs = [];
        this.updateDevice();
        this.render();
    }
    
    /**
     * 渲染列表
     */
    render() {
        const body = document.getElementById('ct-body');
        if (!body) return;
        
        if (this.loadedConfigs.length === 0) {
            body.innerHTML = '<div class="ct-empty">暂无加载记录</div>';
            return;
        }
        
        const typeInfo = {
            lcd: { name: 'LCD', icon: '🎨' },
            tests: { name: '测试', icon: '📋' },
            actions: { name: '动作', icon: '⚡' },
            protocols: { name: '协议', icon: '📡' },
            workflows: { name: '流程', icon: '🔄' },
            calibration: { name: '校准', icon: '🎯' },
            debug: { name: '调试', icon: '🔧' },
            templates: { name: '模板', icon: '📄' },
            ui: { name: '状态机', icon: '🔀' },
        };
        
        let html = '';
        for (const cfg of this.loadedConfigs) {
            const info = typeInfo[cfg.type] || { name: cfg.type, icon: '📁' };
            const statusClass = cfg.exists ? 'ok' : 'missing';
            const statusText = cfg.exists ? '✓' : '✗';
            
            html += `
                <div class="ct-item" title="${cfg.path}\n加载时间: ${cfg.time}">
                    <span class="ct-item-icon">${info.icon}</span>
                    <div class="ct-item-info">
                        <div class="ct-item-type">${info.name}</div>
                        <div class="ct-item-path">${cfg.path}</div>
                    </div>
                    <span class="ct-item-status ${statusClass}">${statusText}</span>
                </div>
            `;
        }
        
        body.innerHTML = html;
    }
    
    /**
     * 切换展开/收起
     */
    static toggle() {
        const toolbar = document.getElementById('config-toolbar');
        if (toolbar) {
            toolbar.classList.toggle('minimized');
        }
    }
    
    /**
     * 刷新配置 - 重新扫描当前设备的缓存
     */
    static refresh() {
        if (!window.ConfigToolbar) return;
        window.ConfigToolbar.loadedConfigs = [];
        window.ConfigToolbar.loadCachedConfigs();
    }
    
    /**
     * 显示/隐藏工具栏
     */
    static show() {
        if (!window.ConfigToolbar) {
            window.ConfigToolbar = new ConfigToolbar();
        }
        window.ConfigToolbar.init();
        document.getElementById('config-toolbar').style.display = 'block';
    }
    
    static hide() {
        const el = document.getElementById('config-toolbar');
        if (el) el.style.display = 'none';
    }
}

// 自动初始化
window.ConfigToolbar = new ConfigToolbar();
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，等待 DeviceConfigManager 就绪
    setTimeout(() => {
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager._initialized) {
            window.ConfigToolbar.init();
        } else {
            // 等待初始化完成
            const checkInit = setInterval(() => {
                if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager._initialized) {
                    clearInterval(checkInit);
                    window.ConfigToolbar.init();
                }
            }, 500);
        }
    }, 1000);
});
