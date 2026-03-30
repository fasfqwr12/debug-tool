/**
 * 校准测试页面 V2 - 使用DeviceHub共享设备
 */

const CalibrationPageV2 = {
    connected: false,
    selectedWorkflow: null,
    workflows: [],
    allWorkflows: [],
    commands: [],
    devices: [],
    running: false,
    activeModelName: '',
    activeProfile: null,
    serialTransport: 'serial',

    configTab: 'params',

    releaseStatus: null,

    // 继续执行（中断/失败后从某步开始）
    lastInterruptedStep: null,

    // KPI
    kpi: {
        position: null,
        reflectivity: null,
        error: null,
        step: { done: 0, total: 0 }
    },

    // 日志交互
    logPaused: false,
    logLevelFilter: 'all',

    kpiTimer: null,
    
    // 日志轮询
    logPollTimer: null,
    logIndex: 0,
    pollInterval: 500,
    
    // 保存的命令参数（点击直接用这些值发送）
    commandParams: {
        laser_on: { model: 0, direction: 0 },
        calibrate_p1: { distance: 5000 },
        calibrate_p2: { distance: 20000 },
        calibrate_p3: { distance: 25000 }
    },

    // ========== 后端事件（用于KPI/进度） ==========
    onProgress(data) {
        // data: { progress:0-100, text, step, total }
        const pct = Math.max(0, Math.min(100, data?.progress ?? 0));
        const pctEl = document.getElementById('cal-progress-pct');
        const fillEl = document.getElementById('cal-progress-fill');
        const stepEl = document.getElementById('cal-progress-step');
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (stepEl && data?.text) stepEl.textContent = data.text;

        // KPI 进度
        if (typeof data?.step === 'number') this.kpi.step.done = data.step;
        if (typeof data?.total === 'number') this.kpi.step.total = data.total;
        this.updateKpiUI();
    },

    onStepComplete(data) {
        // 允许后端推送误差/位置/反射率等
        if (typeof data?.position === 'number') this.kpi.position = data.position;
        if (typeof data?.reflectivity === 'number') this.kpi.reflectivity = data.reflectivity;
        if (typeof data?.error === 'number') this.kpi.error = data.error;
        this.updateKpiUI();
    },

    onComplete(data) {
        this.running = false;
        this.updateRunningUI(false);
        this.appendLog('success', data?.message || '流程执行完成');
        Utils.toast('流程执行完成', 'success');
    },

    onError(data) {
        this.running = false;
        this.updateRunningUI(false);
        const msg = data?.message || data?.error || '流程执行失败';
        this.appendLog('error', msg);
        Utils.toast(msg, 'error');
    },

    onConfirmRequired(data) {
        const card = document.getElementById('cal-confirm-card');
        const msgEl = document.getElementById('cal-confirm-msg');
        if (msgEl) msgEl.textContent = data?.message || '请确认继续';
        if (card) card.style.display = 'flex';
    },

    onResponse(data) {
        // {hex,text}
        const hex = data?.hex || data?.raw || '';
        if (hex) {
            this.appendLog('rx', hex);
            this.showResponse(hex);
            return;
        }
        // 兜底：有些事件只带结构化字段
        const msg = data?.text || data?.message;
        if (msg) {
            this.appendLog('rx', msg);
        }
    },
    
    async init() {
        console.log('CalibrationPageV2 初始化 - 使用DeviceHub');
        
        // 初始化状态管理器
        if (window.StateManager) {
            StateManager.init('calibration');
        }
        
        // 初始化设备配置管理器
        if (window.DeviceConfigManager) {
            await DeviceConfigManager.init();
            // 订阅设备变更事件
            DeviceConfigManager.subscribe('device-changed', async ({ newDevice }) => {
                console.log('[CalibrationPageV2] 设备切换:', newDevice);
                await this.onDeviceChanged(newDevice);
            });
            // 订阅配置更新事件
            DeviceConfigManager.subscribe('workflows-updated', async () => {
                console.log('[CalibrationPageV2] 工作流配置已更新');
                await this.loadWorkflows();
            });
            DeviceConfigManager.subscribe('calibration-updated', async () => {
                console.log('[CalibrationPageV2] 校准配置已更新');
                await this.loadCommands();
            });
        }
        
        // 监听DeviceHub状态变化
        if (window.DeviceHub) {
            DeviceHub.onStatusChange(() => this.syncFromHub());
            this.syncFromHub();
        }
        
        // 加载数据
        this.onConnModeChanged(this.getConnMode());
        await this.refreshPorts();
        await this.loadWorkflows();
        await this.loadCommands();

        // 绑定事件
        this.bindEvents();
        
        // 检查连接状态
        await this.checkStatus();

        // 每次进入页面都同步后端机型配置（确保B页修改立即在A页生效）
        await this.syncDeviceConfigFromBackend();

        // 刷新release状态（生产发布包）
        await this.refreshReleaseStatus();
        
        // 启动日志轮询
        this.startLogPolling();

        // 初始化KPI显示
        this.updateKpiUI();

        // 启动KPI轻量刷新（后端推送不足时也能更新）
        this.startKpiPolling();

        // 恢复上次选中的配置标签页（如果存在的话）
        this.restoreConfigTab();

        // 初始刷新按钮状态
        this.refreshStartButtons();
        
        // 恢复上次选中的流程
        this.restoreLastWorkflow();

        // 页面可见性变化时自动同步机型配置（从B页切回A页时立即拉取最新）
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.activeProfile?.id) {
                this.syncDeviceConfigFromBackend();
            }
        });
    },
    
    /**
     * 恢复上次选中的流程
     */
    restoreLastWorkflow() {
        if (!window.StateManager) return;
        const savedWorkflow = StateManager.load('calibration', 'workflow');
        if (savedWorkflow) {
            const select = document.getElementById('cal-workflow-select');
            if (select && select.querySelector(`option[value="${savedWorkflow}"]`)) {
                select.value = savedWorkflow;
                this.selectWorkflow(savedWorkflow);
            }
        }
    },

    restoreConfigTab() {
        // 恢复上次选中的配置标签页
        try {
            const saved = localStorage.getItem('calibration_config_tab');
            if (saved && ['params', 'preview'].includes(saved)) {
                this.configTab = saved;
            }
        } catch (e) {
            console.warn('恢复配置标签页失败:', e);
        }
    },

    saveConfigTab() {
        // 保存当前选中的配置标签页
        try {
            localStorage.setItem('calibration_config_tab', this.configTab);
        } catch (e) {
            console.warn('保存配置标签页失败:', e);
        }
    },

    async refreshReleaseStatus() {
        try {
            const st = await API.calibration.getReleaseStatus();
            this.releaseStatus = st;
            this.renderReleaseStatus();
        } catch (e) {
            this.releaseStatus = null;
            this.renderReleaseStatus({ error: String(e) });
        }
    },

    renderReleaseStatus(override = null) {
        const s = override || this.releaseStatus || {};

        const elLoaded = document.getElementById('cal-release-loaded');
        const elVer = document.getElementById('cal-release-version');
        const elModel = document.getElementById('cal-release-model');
        const elAppCrc = document.getElementById('cal-release-app-crc');
        const elProtoCrc = document.getElementById('cal-release-proto-crc');
        const elCheck = document.getElementById('cal-release-check');

        if (!elLoaded || !elVer || !elModel || !elAppCrc || !elProtoCrc || !elCheck) return;

        if (s.error) {
            elLoaded.textContent = '错误';
            elVer.textContent = '-';
            elModel.textContent = '-';
            elAppCrc.textContent = '-';
            elProtoCrc.textContent = '-';
            elCheck.textContent = s.error;
            return;
        }

        const loaded = !!s.loaded;
        elLoaded.textContent = loaded ? '已加载' : '未加载';
        elVer.textContent = s.release_version || '-';
        elProtoCrc.textContent = s.protocol_crc || '-';

        const d = s.last_check?.device || null;
        const model = d?.model_name || d?.model || '-';
        const appCrc = (d?.app_crc !== undefined && d?.app_crc !== null)
            ? ('0x' + Number(d.app_crc).toString(16).toUpperCase().padStart(8, '0'))
            : '-';
        elModel.textContent = model;
        elAppCrc.textContent = appCrc;

        const ok = s.last_check?.ok;
        const err = s.last_check?.error;
        if (loaded) {
            elCheck.textContent = ok ? '通过' : (err || '失败');
        } else {
            elCheck.textContent = '未启用（无release文件）';
        }
    },

    async updateReleaseFromDevice() {
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        try {
            const res = await API.calibration.releaseUpdateFromDevice(null, 'prod');
            if (!res || res.success !== true) {
                Utils.toast('生成release失败: ' + (res?.error || ''), 'error');
                return;
            }
            Utils.toast('release已生成/更新', 'success');
            await this.refreshReleaseStatus();
        } catch (e) {
            Utils.toast('生成release失败: ' + e, 'error');
        }
    },

    refreshStartButtons() {
        const canStart = !!this.connected && !!this.selectedWorkflow && !!this.selectedDeviceId && !this.running;
        const startBtn = document.getElementById('cal-start-btn');
        const startBtnMini = document.getElementById('cal-start-btn-mini');
        if (startBtn) startBtn.disabled = !canStart;
        if (startBtnMini) startBtnMini.disabled = !canStart;

        const resumeBtnMini = document.getElementById('cal-resume-btn-mini');
        const canResume = canStart && !!this.lastInterruptedStep;
        if (resumeBtnMini) resumeBtnMini.style.display = canResume ? 'inline-flex' : 'none';
    },
    
    // 从DviceHub同步串口连接状态
    syncFromHub() {
        if (!window.DeviceHub) return;
        const status = DeviceHub.status;
        const transport = status?.serial?.info?.transport || (status?.serial?.info?.port?.startsWith?.('tcp://') ? 'tcp' : 'serial');
        // 如果DeviceHub串口已连接，同步状态
        if (status?.serial?.connected) {
            this.serialTransport = transport;
            this.setConnMode(transport === 'tcp' ? 'tcp' : 'local');
            if (!this.connected) {
                this.connected = true;
                this.updateConnectionUI(true, status.serial.info.port || '');
            }
        } else {
            if (this.connected) {
                this.connected = false;
                this.updateConnectionUI(false);
            }
        }
    },

    getConnMode() {
        try {
            return localStorage.getItem('cal_conn_mode') || 'local';
        } catch (e) {
            return 'local';
        }
    },

    setConnMode(mode) {
        const normalized = mode === 'tcp' ? 'tcp' : 'local';
        this.connMode = normalized;
        try {
            localStorage.setItem('cal_conn_mode', normalized);
        } catch (e) {}
    },

    isTcpBridgeActive() {
        if (this.serialTransport === 'tcp') return true;
        try {
            const port = window.DeviceHub?.status?.serial?.info?.port || '';
            const transport = window.DeviceHub?.status?.serial?.info?.transport || '';
            return transport === 'tcp' || String(port).startsWith('tcp://');
        } catch (e) {
            return false;
        }
    },

    getPreferredTcpScanPort() {
        try {
            const livePort = window.DeviceHub?.status?.serial?.info?.port || '';
            if (String(livePort).startsWith('tcp://')) return String(livePort);
        } catch (e) {}

        const ip = (document.getElementById('cal-tcp-ip')?.value || '').trim();
        const port = (document.getElementById('cal-tcp-port')?.value || '').trim();
        if (ip && port) return `tcp://${ip}:${port}`;

        try {
            const savedIp = (localStorage.getItem('cal_tcp_ip') || localStorage.getItem('hub_serial_tcp_ip') || '').trim();
            const savedPort = (localStorage.getItem('cal_tcp_port') || localStorage.getItem('hub_serial_tcp_port') || '7000').trim();
            if (savedIp && savedPort) return `tcp://${savedIp}:${savedPort}`;
        } catch (e) {}

        return '';
    },

    onConnModeChanged(mode) {
        this.setConnMode(mode);
        const actualMode = this.getConnMode();
        const modeSelect = document.getElementById('cal-conn-mode');
        const portGroup = document.getElementById('cal-port-group');
        const tcpGroup = document.getElementById('cal-tcp-group');

        if (modeSelect && modeSelect.value !== actualMode) {
            modeSelect.value = actualMode;
        }
        if (portGroup) portGroup.style.display = actualMode === 'tcp' ? 'none' : '';
        if (tcpGroup) tcpGroup.style.display = actualMode === 'tcp' ? '' : 'none';

        if (actualMode === 'local') {
            this.refreshPorts();
        } else {
            const select = document.getElementById('cal-port');
            if (select) {
                select.innerHTML = '<option value="">桥接模式下不扫描本机串口</option>';
            }
        }
    },
    
    destroy() {
        // 清理
        this.stopLogPolling();
        this.stopKpiPolling();
    },
    
    /**
     * 设备切换时的处理
     * @param {string} deviceId 新设备ID
     */
    async onDeviceChanged(deviceId) {
        console.log('[CalibrationPageV2] 处理设备切换:', deviceId);
        this._setCurrentMachine(deviceId);
        this.loadMachineConfig(deviceId);
        // 重新加载工作流和命令
        await this.loadWorkflows();
        await this.loadCommands();
        // 刷新UI
        this.refreshStartButtons();
    },

    startKpiPolling() {
        this.stopKpiPolling();
        // 频率不高，避免增加负担
        this.kpiTimer = setInterval(() => {
            // 若正在运行/连接中，优先保持步进与进度的UI；位置/反射率可从DeviceHub兜底
            if (window.DeviceHub && DeviceHub.status) {
                const s = DeviceHub.status;
                if (typeof s.slipway?.position === 'number') this.kpi.position = s.slipway.position;
                if (typeof s.rotary?.reflectivity === 'number') this.kpi.reflectivity = s.rotary.reflectivity;
            }
            this.updateKpiUI();
        }, 2000);  // 2秒刷新（原800ms）
    },

    stopKpiPolling() {
        if (this.kpiTimer) {
            clearInterval(this.kpiTimer);
            this.kpiTimer = null;
        }
    },
    
    // ========== 日志轮询 ==========
    
    startLogPolling() {
        this.stopLogPolling();
        this.schedulePoll();
    },
    
    schedulePoll() {
        this.logPollTimer = setTimeout(() => this.pollLogs(), this.pollInterval);
    },
    
    stopLogPolling() {
        if (this.logPollTimer) {
            clearTimeout(this.logPollTimer);
            this.logPollTimer = null;
        }
    },
    
    async pollLogs() {
        if (!this.connected) {
            this.pollInterval = 500;
            this.schedulePoll();
            return;
        }
        
        try {
            const result = await API.call('cal_get_logs', this.logIndex);
            // 调试：确认轮询是否拿到日志
            if (result && result.logs && result.logs.length > 0) {
                console.log('[CAL:poll]', { from: this.logIndex, count: result.logs.length, next: result.next_index });
            }
            if (result && result.logs && result.logs.length > 0) {
                this.pollInterval = 50;
                
                result.logs.forEach(log => {
                    const t = (log.type || log.level || 'info').toString().toLowerCase();
                    const hex = log.hex || log.raw || '';
                    const msg = log.message || log.msg || '';
                    const text = hex || msg || JSON.stringify(log);

                    if (t === 'rx') {
                        if (hex) this.showResponse(hex);
                        this.appendLog('rx', text);
                    } else if (t === 'tx') {
                        this.appendLog('tx', text);
                    } else if (t === 'success' || t === 'error' || t === 'warn' || t === 'warning' || t === 'info') {
                        this.appendLog(t, text);
                    } else {
                        this.appendLog('info', text);
                    }
                });
                this.logIndex = result.next_index;
            } else {
                this.pollInterval = Math.min(this.pollInterval + 50, 500);
            }
        } catch (e) {
            this.pollInterval = 500;
        }
        
        this.schedulePoll();
    },

    async flushLogs(maxRounds = 10) {
        if (!this.connected) return;

        for (let i = 0; i < maxRounds; i++) {
            let result = null;
            try {
                result = await API.call('cal_get_logs', this.logIndex);
            } catch (e) {
                break;
            }

            if (!(result && result.logs && result.logs.length > 0)) break;

            result.logs.forEach(log => {
                const t = (log.type || log.level || 'info').toString().toLowerCase();
                const hex = log.hex || log.raw || '';
                const msg = log.message || log.msg || '';
                const text = hex || msg || JSON.stringify(log);

                if (t === 'rx') {
                    if (hex) this.showResponse(hex);
                    this.appendLog('rx', text);
                } else if (t === 'tx') {
                    this.appendLog('tx', text);
                } else if (t === 'success' || t === 'error' || t === 'warn' || t === 'warning' || t === 'info') {
                    this.appendLog(t, text);
                } else {
                    this.appendLog('info', text);
                }
            });

            this.logIndex = result.next_index;

            // 让浏览器有机会渲染日志，避免同一秒内顺序错觉
            await new Promise(r => setTimeout(r, 0));
        }
    },
    
    bindEvents() {
        // 监听后端推送
        document.addEventListener('backend:cal_progress', (e) => this.onProgress(e.detail));
        document.addEventListener('backend:cal_step', (e) => this.onStepComplete(e.detail));
        document.addEventListener('backend:cal_complete', (e) => this.onComplete(e.detail));
        document.addEventListener('backend:cal_error', (e) => this.onError(e.detail));
        document.addEventListener('backend:cal_confirm', (e) => this.onConfirmRequired(e.detail));
        document.addEventListener('backend:cal_response', (e) => this.onResponse(e.detail));
    },

    // ========== HTML onclick 适配（避免找不到函数） ==========
    openConnDialog() {
        const modal = document.getElementById('conn-modal');
        if (modal) modal.style.display = 'flex';
    },

    closeConnDialog() {
        const modal = document.getElementById('conn-modal');
        if (modal) modal.style.display = 'none';
    },

    selectWorkflow(workflowId) {
        this.selectWorkflowById(workflowId);
    },

    selectDevice(deviceId) {
        const did = (deviceId != null) ? String(deviceId) : '';
        // 空值：仅当真的没有设备时才视为取消（避免重渲染时误触）
        if (!did) {
            if ((this.devices || []).length === 0) {
                this.selectedDeviceId = '';
                this.log('info', '取消设备选择');
            }
            return;
        }

        // 先存起来，供 workflow params 使用
        this.selectedDeviceId = did;
        const d = (this.devices || []).find(x => String(x.device_id) === did);
        if (d) {
            // 更新KPI（至少位置/反射率先占位）
            this.kpi.position = d.position ?? this.kpi.position;
            this.kpi.reflectivity = d.reflectivity ?? this.kpi.reflectivity;
            this.updateKpiUI();
        }
        this.log('info', `已选择设备: ${did}`);
    },

    openSettings() {
        // 协议配置页面
        if (window.switchPage) switchPage('protocol_manager');
    },
    
    // ========== 连接管理 ==========
    
    async refreshPorts() {
        if (this.getConnMode() === 'tcp' || this.isTcpBridgeActive()) {
            const select = document.getElementById('cal-port');
            if (select) {
                select.innerHTML = '<option value="">桥接模式下不扫描本机串口</option>';
            }
            return;
        }

        try {
            const ports = await API.calibration.listPorts();
            const select = document.getElementById('cal-port');
            if (!select) return;
            
            select.innerHTML = '<option value="">选择串口...</option>';
            ports.forEach(p => {
                select.innerHTML += `<option value="${p.device}">${p.device} - ${p.description}</option>`;
            });
        } catch (e) {
            console.error('获取串口列表失败:', e);
        }
    },
    
    async toggleConnection() {
        if (this.connected) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    },
    
    async connect() {
        const mode = this.getConnMode();
        let port = document.getElementById('cal-port')?.value;
        const baud = parseInt(document.getElementById('cal-baud')?.value || '115200');
        
        if (mode === 'tcp') {
            const ip = (document.getElementById('cal-tcp-ip')?.value || '').trim();
            const tcpPort = parseInt(document.getElementById('cal-tcp-port')?.value || '7000');
            if (!ip || !tcpPort) {
                Utils.toast('请输入桥接IP和端口', 'warning');
                return;
            }
            try {
                localStorage.setItem('cal_tcp_ip', ip);
                localStorage.setItem('cal_tcp_port', String(tcpPort));
            } catch (e) {}
            port = `tcp://${ip}:${tcpPort}`;
        } else if (!port) {
            Utils.toast('请选择串口', 'warning');
            return;
        }
        
        try {
            const res = await API.calibration.connect(port, baud);
            if (res.success) {
                this.connected = true;
                this.serialTransport = mode === 'tcp' ? 'tcp' : 'serial';
                this.updateConnectionUI(true, port);
                Utils.toast('连接成功', 'success');
                this.log('info', `已连接 ${port} @ ${baud}`);
                
                // 连接后主动发起设备识别；桥接模式下不再做本机串口扫描
                setTimeout(() => this.scanDevices(), 500);
            } else {
                Utils.toast(res.message || '连接失败', 'error');
            }
        } catch (e) {
            Utils.toast('连接失败', 'error');
        }
    },
    
    async disconnect() {
        try {
            await API.calibration.disconnect();
            this.connected = false;
            this.serialTransport = 'serial';
            this.devices = [];
            this.updateConnectionUI(false);
            this.renderDevices();
            this.log('info', '已断开连接');
        } catch (e) {
            console.error('断开失败:', e);
        }
    },
    
    async checkStatus() {
        try {
            const status = await API.calibration.getStatus();
            this.connected = status.connected;
            this.serialTransport = status.transport || (status.port?.startsWith?.('tcp://') ? 'tcp' : 'serial');
            if (status.connected) {
                this.setConnMode(this.serialTransport === 'tcp' ? 'tcp' : 'local');
            }
            this.devices = status.devices || [];
            
            const oldProfile = this.activeProfile;
            this.activeModelName = status?.active_protocol?.model_name || this.activeModelName || '';
            this.activeProfile = status?.active_profile || this.activeProfile || null;
            
            this.updateConnectionUI(status.connected, status.port);
            this.renderDevices();
            
            // 如果匹配到新的机型配置，显示通知并重新加载流程
            if (this.activeProfile && this.activeProfile.id !== oldProfile?.id) {
                const profileName = this.activeProfile.name || this.activeProfile.id;
                Utils.toast(`✓ 已匹配机型: ${profileName}`, 'success');
                this.log('success', `已自动匹配机型配置: ${profileName}`);
                // 以机型配置为准同步(流程/命令/参数)
                await this.syncDeviceConfigFromBackend();
                // 重新加载该机型的流程
                await this.loadWorkflows();
            } else {
                this.applyWorkflowFilter();
            }
        } catch (e) {
            console.error('获取状态失败:', e);
        }
    },
    
    updateConnectionUI(connected, port = '') {
        // 工具栏连接状态
        const dot = document.getElementById('cal-conn-dot');
        const textEl = document.getElementById('cal-conn-text');
        const modalBtn = document.getElementById('conn-modal-btn');
        const startBtn = document.getElementById('cal-start-btn');
        const stopBtn = document.getElementById('cal-stop-btn');
        
        if (dot) {
            dot.className = connected ? 'status-dot connected' : 'status-dot';
        }
        if (textEl) textEl.textContent = connected ? `已连接` : '未连接';
        if (modalBtn) {
            modalBtn.textContent = connected ? '断开' : '连接';
            modalBtn.className = connected ? 'cyber-btn danger' : 'cyber-btn primary';
        }
        
        if (startBtn) startBtn.disabled = !connected;
        if (stopBtn) stopBtn.disabled = !connected;
        this.refreshStartButtons();
        
        // 连接成功后关闭弹窗
        if (connected) {
            this.closeConnDialog();
        }
    },

    // ========== KPI UI ==========
    updateKpiUI() {
        const setText = (id, v, fallback = '--') => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = (v === null || v === undefined || v === '') ? fallback : String(v);
        };

        const pos = (typeof this.kpi.position === 'number') ? this.kpi.position.toFixed(3) : this.kpi.position;
        const ref = (typeof this.kpi.reflectivity === 'number') ? this.kpi.reflectivity.toFixed(1) : this.kpi.reflectivity;
        const err = (typeof this.kpi.error === 'number') ? this.kpi.error.toFixed(3) : this.kpi.error;
        const step = `${this.kpi.step.done || 0}/${this.kpi.step.total || 0}`;

        setText('kpi-position', pos);
        setText('kpi-reflectivity', ref);
        setText('kpi-error', err);
        setText('kpi-step', step, '0/0');
    },

    // ========== 日志：暂停/过滤 ==========
    toggleLogPause() {
        this.logPaused = !this.logPaused;
        Utils.toast(this.logPaused ? '日志已暂停滚动' : '日志已恢复', 'info');
    },

    setLogFilter(level) {
        this.logLevelFilter = level || 'all';
        // 只控制显示
        document.querySelectorAll('#cal-log .log-row').forEach(row => {
            const lvl = row.dataset.level || 'info';
            row.style.display = (this.logLevelFilter === 'all' || lvl === this.logLevelFilter) ? '' : 'none';
        });
    },

    appendLog(level, message) {
        const container = document.getElementById('cal-log');
        if (!container) return;

        // level: tx/rx/info/success/error/warn
        const lvl = (level || 'info').toString().toLowerCase();

        const row = document.createElement('div');
        row.className = `log-row ${lvl}`;
        row.dataset.level = (lvl === 'tx' || lvl === 'rx') ? 'info' : lvl;

        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        row.innerHTML = `
            <span class="t">${time}</span>
            <span class="tag">${lvl.toUpperCase()}</span>
            <span class="msg"></span>
        `;
        row.querySelector('.msg').textContent = message || '';

        container.appendChild(row);

        // 同步到开发者控制台（便于排查）
        try {
            const m = message || '';
            if (lvl === 'error') console.error(`[CAL:${lvl}]`, m);
            else if (lvl === 'warning' || lvl === 'warn') console.warn(`[CAL:${lvl}]`, m);
            else console.log(`[CAL:${lvl}]`, m);
        } catch (e) {
            // ignore
        }

        // 过滤
        if (this.logLevelFilter && this.logLevelFilter !== 'all') {
            const checkLvl = row.dataset.level || 'info';
            if (checkLvl !== this.logLevelFilter) row.style.display = 'none';
        }

        // 暂停滚动时不自动滚
        if (!this.logPaused) {
            container.scrollTop = container.scrollHeight;
        }
    },

    log(level, message) {
        this.appendLog(level, message);
    },

    clearLog() {
        const container = document.getElementById('cal-log');
        if (container) container.innerHTML = '';
        this.logIndex = 0;
        // 同时清后端缓存
        API.calibration.clearLogs();
    },
    
    // ========== 设备管理 ==========
    
    async scanDevices() {
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        
        this.log('info', '正在扫描设备...');
        
        try {
            const devices = await API.calibration.scanDevices();
            this.devices = devices;
            this.renderDevices();
            
            if (devices.length > 0) {
                this.log('success', `发现 ${devices.length} 台设备`);
                Utils.toast(`发现 ${devices.length} 台设备`, 'success');
            } else {
                this.log('error', '未发现设备');
                Utils.toast('未发现设备', 'warning');
            }
        } catch (e) {
            this.log('error', '扫描失败');
        }
    },
    
    async autoScan(force = false) {
        const countEl = document.getElementById('cal-device-count');
        const bridgeMode = this.isTcpBridgeActive() || this.getConnMode() === 'tcp';
        const bridgePort = bridgeMode ? this.getPreferredTcpScanPort() : '';

        if (bridgeMode) {
            if (!bridgePort) {
                const msg = '桥接扫描需要先配置 tcp://IP:端口';
                this.log('warning', msg);
                Utils.toast(msg, 'warning');
                if (countEl) countEl.textContent = '桥接未配置';
                return;
            }
            this.log('info', `🔍 正在通过桥接扫描设备: ${bridgePort}`);
            if (countEl) countEl.textContent = '桥接扫描中...';
        } else {
            this.log('info', '🔍 自动扫描所有串口...');
            if (countEl) countEl.textContent = '扫描中...';
        }
        
        try {
            // 先检查是否已经连接（除非强制扫描）
            if (!force && this.connected && this.devices && this.devices.length > 0) {
                this.log('info', '设备已连接，跳过扫描');
                Utils.toast('设备已连接', 'info');
                return;
            }
            
            const result = await API.call('cal_auto_scan', 115200, bridgePort || '');
            
            // 调试：打印完整结果
            console.log('[autoScan] 扫描结果:', result);
            
            // 修复：检查result.success和devices字段
            if (result && (result.success || result.devices)) {
                this.devices = result.devices || [];
                const count = this.devices.length;
                this.renderDevices();
                
                // 自动连接成功
                this.connected = true;
                this.serialTransport = result?.transport || (String(result?.port || '').startsWith('tcp://') ? 'tcp' : 'serial');
                this.updateConnectionUI(true, result.port);
                
                // 同步到DeviceHub，让其他模块也知道串口已连接
                if (window.DeviceHub) {
                    DeviceHub.connectSerial(result.port, 115200);
                }
                
                this.log('success', `✓ 自动连接 ${result.port}`);
                this.log('success', `发现 ${count} 台设备`);
                
                // 显示设备详情
                this.devices.forEach(d => {
                    this.log('info', `📡 ${d.model_name} ID:${d.device_id?.toString?.(16)?.toUpperCase() || d.device_id}`);
                });
                
                // 自动选择第一个设备
                if (count > 0) {
                    const firstDevice = this.devices[0];
                    this.selectedDeviceId = firstDevice.device_id;
                    const select = document.getElementById('cal-device-select');
                    if (select) select.value = String(firstDevice.device_id);
                    this.refreshStartButtons();
                }
                
                Utils.toast(`已连接 ${result.port}`, 'success');
                if (countEl) countEl.textContent = count;

                await this.checkStatus();
            } else {
                // 修复：更详细的错误信息
                // 如果实际上已经连上（例如上一次连接未断开/其他模块已连接），则复用当前连接并刷新状态
                let reused = false;
                try {
                    const hub = window.DeviceHub;
                    const port = hub?.status?.serial?.info?.port;
                    const connected = !!hub?.status?.serial?.connected;
                    const transport = hub?.status?.serial?.info?.transport;
                    if (connected && port) {
                        reused = true;
                        this.connected = true;
                        this.serialTransport = transport || (String(port).startsWith('tcp://') ? 'tcp' : 'serial');
                        this.updateConnectionUI(true, port);
                        this.log('success', `✓ 已连接 ${port}（复用当前连接）`);
                        Utils.toast(`已连接 ${port}`, 'success');
                        await this.checkStatus();
                    }
                } catch (e) {}

                // 兜底：DeviceHub状态可能尚未刷新，直接向后端查询 hub_get_status
                if (!reused) {
                    try {
                        const st = await API.call('hub_get_status');
                        const serial = st?.serial;
                        const port = serial?.info?.port;
                        const info = serial?.info;
                        const connected = !!serial?.connected;
                        const hasInfo = !!(info && (info.device_id !== undefined || info.model_name || info.model));
                        if (connected && port) {
                            reused = true;
                            this.connected = true;
                            this.serialTransport = serial?.info?.transport || (String(port).startsWith('tcp://') ? 'tcp' : 'serial');
                            this.updateConnectionUI(true, port);
                            this.log('success', `✓ 已连接 ${port}（后端状态确认）`);

                            // 如果能拿到缓存设备信息，则填充 devices，保证页面/测试数据页可显示设备信息
                            if (hasInfo) {
                                const dev = {
                                    device_id: info.device_id,
                                    model_name: info.model_name || info.model,
                                    sw_version: info.sw_version || info.version,
                                    hw_version: info.hw_version,
                                    crc: info.crc,
                                };
                                this.devices = [dev];
                                this.renderDevices();
                                const select = document.getElementById('cal-device-select');
                                if (select && info.device_id !== undefined && info.device_id !== null) {
                                    this.selectedDeviceId = info.device_id;
                                    select.value = String(info.device_id);
                                }
                                this.refreshStartButtons();
                            }

                            Utils.toast(`已连接 ${port}`, 'success');
                            if (countEl) countEl.textContent = (this.devices?.length || 0);
                            await this.checkStatus();
                        }
                    } catch (e) {}
                }

                if (!reused) {
                    const errorMsg = result?.error || '未找到设备';
                    this.log('error', errorMsg);
                    Utils.toast(errorMsg, 'warning');
                    if (countEl) countEl.textContent = '0';
                }
                
                // 调试：打印为什么失败
                console.warn('[autoScan] 失败原因:', {
                    success: result?.success,
                    error: result?.error,
                    scanned: result?.scanned,
                    hasResponse: !!result
                });
            }
        } catch (e) {
            this.log('error', '扫描出错: ' + e.message);
            Utils.toast('扫描出错: ' + (e.message || '未知错误'), 'error');
            if (countEl) countEl.textContent = '0';
        }
    },
    
    renderDevices() {
        // 填充设备选择下拉框
        const select = document.getElementById('cal-device-select');
        if (select) {
            if (this.devices.length === 0) {
                select.innerHTML = '<option value="">未发现设备</option>';
            } else {
                select.innerHTML = '<option value="">选择设备...</option>' +
                    this.devices.map(d => 
                        `<option value="${d.device_id}">📡 ${d.model_name || '设备'} (ID:${d.device_id})</option>`
                    ).join('');

                // 保留/恢复选择（避免render导致value回空触发取消）
                const cur = this.selectedDeviceId != null ? String(this.selectedDeviceId) : '';
                const exists = !!this.devices.find(x => String(x.device_id) === cur);
                if (cur && exists) {
                    select.value = cur;
                } else if (this.devices.length > 0) {
                    const first = this.devices[0];
                    this.selectedDeviceId = String(first.device_id);
                    select.value = String(first.device_id);
                }
            }
        }
        
        // 更新设备信息栏
        const infoBar = document.getElementById('device-info-bar');
        if (this.devices.length > 0) {
            const d = this.devices[0];  // 显示第一个设备
            this.updateDeviceInfoBar(d);
            if (infoBar) infoBar.style.display = 'flex';
        } else {
            if (infoBar) infoBar.style.display = 'none';
        }
    },
    
    updateDeviceInfoBar(device) {
        // 填充设备信息
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val || '-';
        };
        
        setVal('dev-model', device.model_name);
        setVal('dev-id', device.device_id?.toString(16).toUpperCase().padStart(8, '0'));
        setVal('dev-sw-ver', device.sw_version);
        setVal('dev-hw-ver', device.hw_version);
        
        // 额外信息 (如果有)
        if (device.flash_size) {
            setVal('dev-flash', (device.flash_size / 1024) + 'KB');
        }
        if (device.app_start) {
            setVal('dev-app-addr', '0x' + device.app_start.toString(16).toUpperCase());
        }
        // CRC32自检值
        if (device.app_crc) {
            setVal('dev-crc', '0x' + device.app_crc.toString(16).toUpperCase().padStart(8, '0'));
        } else {
            setVal('dev-crc', '-');
        }
    },
    
    // ========== 流程管理 ==========
    
    async loadWorkflows() {
        try {
            this.allWorkflows = await API.calibration.getWorkflows();
            this.applyWorkflowFilter();
        } catch (e) {
            console.error('加载流程失败:', e);
        }
    },

    applyWorkflowFilter() {
        const profile = this.activeProfile;
        // 流程已经从机型配置直接加载，直接使用allWorkflows
        this.workflows = Array.isArray(this.allWorkflows) ? this.allWorkflows : [];

        this.renderWorkflows();

        // 自动选择默认流程（优先profile指定的，否则取第一个）
        const defWf = profile?.default_workflow || (this.workflows.length > 0 ? this.workflows[0].id : null);
        const defWfStr = defWf != null ? String(defWf) : '';
        if (defWfStr && this.workflows.find(w => String(w.id) === defWfStr)) {
            const select = document.getElementById('cal-workflow-select');
            if (select) select.value = defWfStr;
            this.selectWorkflowById(defWfStr);
            try {
                this.log('info', `默认流程已自动选中: ${defWfStr} (profile=${profile?.id || ''})`);
            } catch (e) {}
        } else {
            try {
                const ids = (this.workflows || []).slice(0, 6).map(w => String(w.id)).join(',');
                this.log('info', `未找到默认流程: ${defWfStr || '(empty)'} | 当前流程: ${ids}${(this.workflows||[]).length>6?'...':''}`);
            } catch (e) {}
        }

        // 自动选择第一个设备
        if (this.devices.length > 0 && !this.selectedDeviceId) {
            const firstDevice = this.devices[0];
            this.selectedDeviceId = firstDevice.device_id;
            const devSelect = document.getElementById('cal-device-select');
            if (devSelect) devSelect.value = String(firstDevice.device_id);
        }

        if (this.selectedWorkflow && !this.workflows.find(w => w.id === this.selectedWorkflow.id)) {
            this.selectedWorkflow = null;
            this.renderWorkflowConfig();
        }
        this.refreshStartButtons();
    },
    
    renderWorkflows() {
        // 填充流程选择下拉框
        const select = document.getElementById('cal-workflow-select');
        if (select) {
            select.innerHTML = '<option value="">选择流程...</option>' + 
                this.workflows.map(w => 
                    `<option value="${w.id}">${w.icon || '📋'} ${w.name}</option>`
                ).join('');
        }
    },
    
    selectWorkflowById(workflowId) {
        const wid = workflowId != null ? String(workflowId) : '';
        this.selectedWorkflow = this.workflows.find(w => String(w.id) === wid);
        this.renderWorkflowConfig();
        
        // 更新开始按钮状态
        this.refreshStartButtons();
    },
    
    async renderWorkflowConfig() {
        const iconEl = document.getElementById('cal-wf-icon');
        const nameEl = document.getElementById('cal-wf-name');
        const descEl = document.getElementById('cal-wf-desc');
        const previewPanel = document.getElementById('cal-config-panel-preview');
        
        if (!this.selectedWorkflow) {
            if (nameEl) nameEl.textContent = '选择一个流程';
            if (descEl) descEl.textContent = '从左侧选择要执行的测试流程';
            if (previewPanel) previewPanel.innerHTML = '<div class="params-placeholder">选择流程后显示预览</div>';
            this._wfParamDefs = {};
            return;
        }
        
        if (iconEl) iconEl.textContent = this.selectedWorkflow.icon || '🎯';
        if (nameEl) nameEl.textContent = this.selectedWorkflow.name;
        if (descEl) descEl.textContent = this.selectedWorkflow.description || '';

        // 流程预览：从后端取完整定义（含 steps）
        let wfFull = null;
        try {
            wfFull = await API.calibration.getWorkflow(this.selectedWorkflow.id);
        } catch (e) {
            wfFull = null;
        }
        const steps = (wfFull && Array.isArray(wfFull.steps)) ? wfFull.steps : [];

        // 参数引用定位：标注每个参数在流程里被哪些步骤使用
        const paramUsage = {};
        try {
            for (const s of steps) {
                const sid = s?.id;
                const text = JSON.stringify(s || {});
                if (!text) continue;
                // 只记录常见的 ${xxx} 形式
                const matches = text.match(/\$\{[a-zA-Z0-9_]+\}/g) || [];
                for (const m of matches) {
                    const key = m.slice(2, -1);
                    if (!paramUsage[key]) paramUsage[key] = [];
                    if (sid != null && !paramUsage[key].includes(sid)) paramUsage[key].push(sid);
                }
            }
        } catch (e) {
            // ignore
        }

        // 参数定义：优先使用完整workflow里的params，避免列表摘要缺字段
        let paramDefs = (wfFull && wfFull.params && typeof wfFull.params === 'object')
            ? wfFull.params
            : (this.selectedWorkflow.params || {});

        // 用B页同步后的默认值覆盖（wfFull.params 往往是后端静态定义，default可能不是最新）
        try {
            const wfListItem = (this.workflows || []).find(w => String(w.id) === String(this.selectedWorkflow?.id));
            const synced = (wfListItem && wfListItem.params && typeof wfListItem.params === 'object')
                ? wfListItem.params
                : (this.selectedWorkflow.params || {});
            for (const [k, def] of Object.entries(synced || {})) {
                if (!def || typeof def !== 'object') continue;
                if (def.default === undefined) continue;
                if (paramDefs[k] && typeof paramDefs[k] === 'object') {
                    paramDefs[k].default = def.default;
                } else {
                    paramDefs[k] = { default: def.default, label: def.label || k, type: def.type || 'number' };
                }
            }
        } catch (e) {}

        // 若workflow未显式定义params，则从步骤中提取到的${var}生成快捷参数
        try {
            const hasDefs = paramDefs && typeof paramDefs === 'object' && Object.keys(paramDefs).length > 0;
            const keys = Object.keys(paramUsage || {});
            if (!hasDefs && keys.length > 0) {
                const auto = {};
                keys.forEach(k => {
                    const kk = String(k || '').trim();
                    if (!kk) return;
                    let def = { label: kk, type: 'number', default: '' };
                    const lk = kk.toLowerCase();
                    if (lk.includes('reflect')) {
                        def = { label: kk, type: 'number', default: 10, min: 0, max: 100 };
                    } else if (lk.includes('distance') || lk.includes('dist') || lk.includes('pos') || lk.includes('position')) {
                        def = { label: kk, type: 'number', default: 5000, min: 0 };
                    } else if (lk.includes('point') || lk.includes('idx') || lk.includes('index')) {
                        def = { label: kk, type: 'number', default: 1, min: 1 };
                    }
                    auto[kk] = def;
                });
                paramDefs = auto;
            }
        } catch (e) {}

        this._wfParamDefs = paramDefs;

        // 用于把 ${var} 替换为具体数值（来自 workflow.params[var].default）
        const paramValueMap = {};
        try {
            for (const [k, def] of Object.entries(paramDefs || {})) {
                if (!def || typeof def !== 'object') continue;
                if (def.default === undefined || def.default === null) continue;
                paramValueMap[k] = def.default;
            }
        } catch (e) {}

        // 步骤预览
        let previewHtml = '';
        if (steps.length) {
            const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const hl = (v) => {
                return esc(v).replace(/\$\{[^}]+\}/g, (m) => {
                    const key = m.slice(2, -1);
                    if (Object.prototype.hasOwnProperty.call(paramValueMap, key)) {
                        const vv = paramValueMap[key];
                        return `<span class="wf-var">${esc(vv)}</span>`;
                    }
                    return `<span class="wf-var">${m}</span>`;
                });
            };
            const wrap = (cls, html) => `<span class="wf-line ${cls}">${html}</span>`;
            const lines = steps.slice(0, 12).map((s, idx) => {
                const a = (s.action || '').toString();
                if (a === 'move_rotary') return wrap('wf-act-move', hl(`${idx + 1}. 转靶切换 → ${s.position ?? ''}`));
                if (a === 'move_slipway') return wrap('wf-act-move', hl(`${idx + 1}. 滑台移动 → ${s.position ?? ''}mm`));
                if (a === 'delay') return wrap('wf-act-delay', hl(`${idx + 1}. 延时 → ${s.ms ?? ''}ms`));
                if (a === 'notify') return wrap('wf-act-notify', hl(`${idx + 1}. 通知 → ${s.message ?? ''}`));
                if (a === 'command') {
                    const cmd = hl(s.cmd ?? '');
                    return wrap('wf-act-command', `${esc(idx + 1)}. <span class="wf-tag">CMD</span> 发送命令 → <span class="wf-cmd">${cmd}</span>`);

                }
                return wrap('wf-act-other', hl(`${idx + 1}. ${a}`));
            });

            const expanded = !!this._wfPreviewExpanded;
            const btnText = expanded ? '收起' : '展开';
            const bodyCls = expanded ? 'wf-preview-body expanded' : 'wf-preview-body';
            previewHtml = `
                <div class="wf-preview">
                    <div class="wf-preview-title">
                        <span>步骤预览</span>
                        <button class="wf-preview-toggle" onclick="CalibrationPageV2.toggleWfPreview()">${btnText}</button>
                    </div>
                    <pre class="${bodyCls}">${lines.join('\n')}${steps.length > 12 ? '\n…' : ''}</pre>
                </div>
            `;
        }

        if (previewPanel) {
            previewPanel.innerHTML = previewHtml || '<div class="empty-state">暂无步骤预览</div>';
        }
    },
    
    async startWorkflow() {
        if (!this.selectedWorkflow) {
            Utils.toast('请选择流程', 'warning');
            return;
        }
        
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }

        if (!this.selectedDeviceId) {
            Utils.toast('请先选择目标设备', 'warning');
            return;
        }
        
        const params = this._collectCurrentWfParams();

        // A页执行前强制刷新一次机型配置（确保B页修改立即生效）
        try {
            await this.syncDeviceConfigFromBackend();
        } catch (e) {}
        
        // 新开始：清除中断点
        this.lastInterruptedStep = null;
        this.refreshStartButtons();

        this.log('info', `启动流程: ${this.selectedWorkflow.name}`);
        
        try {
            const res = await API.calibration.startWorkflow(this.selectedWorkflow.id, params, 1);
            if (res.success) {
                this.running = true;
                this.updateRunningUI(true);
                Utils.toast('流程已启动', 'success');
            } else {
                Utils.toast(res.error || '启动失败', 'error');
                this.log('error', res.error || '启动失败');
            }
        } catch (e) {
            Utils.toast('启动失败', 'error');
        }
    },

    async resumeWorkflow() {
        if (!this.lastInterruptedStep) {
            Utils.toast('没有可继续的中断点', 'warning');
            return;
        }
        if (!this.selectedWorkflow || !this.connected || !this.selectedDeviceId) {
            Utils.toast('请先连接并选择流程/设备', 'warning');
            return;
        }

        const params = this._collectCurrentWfParams();

        const startStep = this.lastInterruptedStep;
        this.log('info', `继续流程: 从步骤 ${startStep} 开始`);
        try {
            const res = await API.calibration.startWorkflow(this.selectedWorkflow.id, params, startStep);
            if (res.success) {
                this.running = true;
                this.updateRunningUI(true);
                Utils.toast('流程已继续', 'success');
            } else {
                Utils.toast(res.error || '继续失败', 'error');
                this.log('error', res.error || '继续失败');
            }
        } catch (e) {
            Utils.toast('继续失败', 'error');
        }
    },
    
    async stopWorkflow() {
        try {
            await API.calibration.stopWorkflow();
            this.running = false;
            this.updateRunningUI(false);
            this.log('info', '流程已停止');

            // 中断点：从当前步继续（下一步）
            const stepDone = (this.kpi?.step?.done || 0);
            this.lastInterruptedStep = Math.max(1, stepDone + 1);
            this.refreshStartButtons();
        } catch (e) {
            console.error('停止失败:', e);
        }
    },
    
    confirmWorkflow(confirmed) {
        API.calibration.confirmWorkflow(confirmed);
        const card = document.getElementById('cal-confirm-card');
        if (card) card.style.display = 'none';
        
        if (confirmed) {
            this.log('info', '用户确认继续');
        } else {
            this.log('info', '用户取消操作');
        }
    },
    
    updateRunningUI(running) {
        const startBtn = document.getElementById('cal-start-btn');
        const stopBtn = document.getElementById('cal-stop-btn');
        const startBtnMini = document.getElementById('cal-start-btn-mini');
        const stopBtnMini = document.getElementById('cal-stop-btn-mini');
        const progressCard = document.getElementById('cal-progress-card');
        const statusEl = document.getElementById('cal-workflow-status');
        
        if (startBtn) startBtn.style.display = running ? 'none' : 'flex';
        if (stopBtn) stopBtn.style.display = running ? 'flex' : 'none';
        if (startBtnMini) startBtnMini.style.display = running ? 'none' : 'inline-flex';
        if (stopBtnMini) stopBtnMini.style.display = running ? 'inline-flex' : 'none';
        const resumeBtnMini = document.getElementById('cal-resume-btn-mini');
        if (resumeBtnMini) resumeBtnMini.style.display = (!running && !!this.lastInterruptedStep) ? 'inline-flex' : 'none';
        if (progressCard) progressCard.style.display = running ? 'block' : 'none';
        if (statusEl) statusEl.textContent = running ? '执行中...' : '就绪';

        this.refreshStartButtons();
    },

    // ========== 命令管理 ==========
    
    async loadCommands() {
        try {
            this.commands = await API.calibration.getCommands();
            this.renderCommands();
        } catch (e) {
            console.error('加载命令失败:', e);
        }
    },
    
    renderCommands() {
        const container = document.getElementById('cal-cmd-list');
        if (!container) return;
        
        container.innerHTML = this.commands.map(cmd => {
            // 显示当前参数值
            const params = this.commandParams[cmd.id] || {};
            let paramText = '';
            if (params.distance !== undefined) {
                paramText = `${params.distance}mm`;
            } else if (params.model !== undefined) {
                const models = ['mini-30h', '两键', '双头'];
                paramText = models[params.model] || '';
            }
            
            return `
                <div class="cmd-item" onclick="CalibrationPageV2.quickSend('${cmd.id}')">
                    <span class="icon">${cmd.icon || '📌'}</span>
                    <div class="cmd-info">
                        <span class="name">${cmd.name}</span>
                        ${paramText ? `<span class="param-hint">${paramText}</span>` : ''}
                    </div>
                    <span class="code">0x${cmd.code}</span>
                </div>
            `;
        }).join('');
    },
    
    // 快速发送（用保存的参数）
    quickSend(cmdId) {
        const params = this.commandParams[cmdId] || {};
        this.sendCommand(cmdId, params);
    },
    
    // 显示命令参数弹窗
    showCommandModal(cmdId) {
        const cmd = this.commands.find(c => c.id === cmdId);
        if (!cmd) return;
        
        this.pendingCommand = cmd;
        
        const modal = document.getElementById('cmd-modal');
        const title = document.getElementById('cmd-modal-title');
        const body = document.getElementById('cmd-modal-body');
        
        if (title) title.textContent = `${cmd.icon} ${cmd.name}`;
        
        // 生成参数表单
        const params = cmd.send_params || [];
        if (params.length === 0) {
            // 无参数，直接发送
            this.sendCommand(cmdId, {});
            return;
        }
        
        let html = '';
        for (const p of params) {
            const enumOpts = p.enum ? Object.entries(p.enum).map(([v, n]) => 
                `<option value="${v}">${n}</option>`
            ).join('') : '';
            
            if (enumOpts) {
                html += `
                    <div class="param-group">
                        <label class="param-label">${p.label || p.name}</label>
                        <select id="modal-param-${p.name}" class="cyber-select">${enumOpts}</select>
                    </div>
                `;
            } else {
                html += `
                    <div class="param-group">
                        <label class="param-label">${p.label || p.name}${p.type === 'uint16' ? ' (mm)' : ''}</label>
                        <input type="number" id="modal-param-${p.name}" class="param-input" 
                               value="${p.default || 0}" placeholder="输入${p.label || p.name}">
                    </div>
                `;
            }
        }
        
        if (body) body.innerHTML = html;
        if (modal) modal.style.display = 'flex';
    },
    
    closeModal() {
        const modal = document.getElementById('cmd-modal');
        if (modal) modal.style.display = 'none';
        this.pendingCommand = null;
    },
    
    sendModalCommand() {
        if (!this.pendingCommand) return;
        
        const params = {};
        for (const p of (this.pendingCommand.send_params || [])) {
            const input = document.getElementById(`modal-param-${p.name}`);
            if (input) {
                params[p.name] = parseInt(input.value) || 0;
            }
        }
        
        this.sendCommand(this.pendingCommand.id, params);
        this.closeModal();
    },
    
    async sendCommand(cmdId, params = {}) {
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        
        const cmd = this.commands.find(c => c.id === cmdId);
        if (!cmd) return;
        
        this.log('info', `发送命令: ${cmd.name} ${Object.keys(params).length ? JSON.stringify(params) : ''}`);
        
        try {
            const res = await API.calibration.sendCommand(cmdId, params);
            console.log('[DEBUG] sendCommand response:', res);
            if (res && res.success) {
                const respParams = res.params || {};
                console.log('[DEBUG] respParams:', respParams);
                let respText = this.formatResponseParams(respParams);
                this.log('success', `✓ ${respText}`);
                this.showResponse(res.raw || '');
            } else {
                // 有回包但设备返回错误码时，不要误报“无响应”
                const errCode = (res && (res.error_code ?? res.errorCode)) ?? ((res && res.params && (res.params.error ?? res.params.err)) ?? null);
                if (res && (res.raw || res.params || errCode !== null)) {
                    const msg = (errCode !== null && errCode !== undefined) ? (`设备返回错误码: ${errCode}`) : (res.error || '设备返回失败');
                    this.log('error', `✗ ${msg}`);
                    this.showResponse(res.raw || '(设备返回失败)');
                } else {
                    this.log('error', `✗ ${res?.error || '无响应'}`);
                    this.showResponse('(无响应)');
                }
            }
        } catch (e) {
            this.log('error', '发送失败');
        }
    },
    
    async sendCustom() {
        const hexInput = document.getElementById('cal-hex-input');
        if (!hexInput || !hexInput.value) return;
        
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        
        try {
            const res = await API.calibration.sendRaw(hexInput.value);
            if (res.success) {
                this.log('info', `已发送: ${res.sent}`);
            } else {
                this.log('error', res.error || '发送失败');
            }
        } catch (e) {
            this.log('error', '发送失败');
        }
    },
    
    calcXor() {
        const hexInput = document.getElementById('cal-hex-input');
        if (!hexInput || !hexInput.value) return;
        
        try {
            const parts = hexInput.value.trim().toUpperCase().split(/\s+/);
            // 假设格式: AA EE CMD LEN DATA... XOR BB FF
            // XOR = CMD ^ LEN ^ DATA[0] ^ ...
            
            if (parts.length < 4) return;
            
            let xor = 0;
            // 从索引2开始 (CMD)
            for (let i = 2; i < parts.length - 2; i++) { // 排除最后两个 BB FF
                const val = parseInt(parts[i], 16);
                if (!isNaN(val)) {
                    xor ^= val;
                }
            }
            
            // 在倒数第三位插入校验
            const result = [...parts.slice(0, -2), xor.toString(16).toUpperCase().padStart(2, '0'), 'BB', 'FF'];
            hexInput.value = result.join(' ');
            
        } catch (e) {
            console.error('计算校验失败:', e);
        }
    },
    
    showResponse(hex) {
        const el = document.getElementById('cal-response');
        if (el) {
            el.textContent = hex || '(无响应)';
        }
    },
    
    formatResponseParams(params) {
        if (!params || Object.keys(params).length === 0) return '{}';
        
        const parts = [];
        for (const [key, val] of Object.entries(params)) {
            let display;
            if (typeof val === 'number') {
                // 特殊字段用十六进制显示
                if (key.includes('crc') || key.includes('id') || key.includes('start') || key.includes('size') || key.includes('version')) {
                    if (val > 0xFFFF) {
                        display = '0x' + val.toString(16).toUpperCase().padStart(8, '0');
                    } else if (val > 0xFF) {
                        display = '0x' + val.toString(16).toUpperCase().padStart(4, '0');
                    } else {
                        display = val;
                    }
                } else {
                    display = val;
                }
            } else if (typeof val === 'string') {
                display = `"${val}"`;
            } else {
                display = val;
            }
            parts.push(`${key}:${display}`);
        }
        return '{' + parts.join(',') + '}';
    },
    
    // ========== 事件处理 ==========
    
    onProgress(data) {
        const bar = document.getElementById('cal-progress-fill');
        const text = document.getElementById('cal-progress-pct');
        const step = document.getElementById('cal-progress-step');
        
        if (bar) bar.style.width = `${data.percent || 0}%`;
        if (text) text.textContent = `${data.percent || 0}%`;
        if (step) step.textContent = data.description || '';
    },
    
    onStepComplete(data) {
        const result = data.result || {};
        const status = result.success ? 'success' : 'error';
        
        // 构建详细日志信息
        let logMsg = `[步骤${data.step}] ${result.description || ''}`;
        
        // 如果有命令数据，显示详情
        if (result.data) {
            const d = result.data;
            if (d.delay_ms !== undefined) {
                logMsg += ` (延时 ${d.delay_ms}ms)`;
            } else if (d.position !== undefined) {
                logMsg += ` (位置 ${d.position})`;
            } else if (d.reflectance !== undefined) {
                logMsg += ` (反射率 ${d.reflectance})`;
            } else if (d.frame) {
                logMsg += ` (TX: ${d.frame})`;
            } else if (d.params) {
                // 命令响应参数
                const paramStr = Object.entries(d.params || {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ');
                if (paramStr) logMsg += ` (${paramStr})`;
            }
        }
        
        // 如果失败，显示错误信息
        if (!result.success && result.error) {
            logMsg += ` - 错误: ${result.error}`;
        }
        
        this.log(status, logMsg);

        // 若该步失败，记录中断点（从当前步重新开始）
        if (!result.success) {
            const s = parseInt(data.step, 10);
            if (Number.isFinite(s) && s > 0) {
                this.lastInterruptedStep = s;
                this.refreshStartButtons();
            }
        }
    },
    
    onComplete(data) {
        this.running = false;
        this.updateRunningUI(false);
        
        if (data.success) {
            this.log('success', `✅ 流程完成! 耗时 ${data.duration?.toFixed(1)}s`);
            Utils.toast('流程执行完成', 'success');
            
            // 显示统计
            if (data.stats) {
                this.log('info', `统计: 通过 ${data.stats.passed_points}/${data.stats.total_points}`);
            }
        } else {
            this.log('error', '❌ 流程执行失败');
            Utils.toast('流程执行失败', 'error');

            // 若未记录中断点，兜底用当前已完成步+1
            if (!this.lastInterruptedStep) {
                const stepDone = (this.kpi?.step?.done || 0);
                this.lastInterruptedStep = Math.max(1, stepDone + 1);
            }
            this.refreshStartButtons();
        }
    },
    
    onError(data) {
        this.log('error', `错误: ${data.message || '未知错误'}`);
        Utils.toast(data.message || '发生错误', 'error');
    },
    
    onConfirmRequired(data) {
        const card = document.getElementById('cal-confirm-card');
        const msg = document.getElementById('cal-confirm-msg');
        
        if (card) card.style.display = 'block';
        if (msg) msg.textContent = data.message || '请确认继续';
    },
    
    onResponse(data) {
        // 显示设备响应
        this.showResponse(data.raw || '');
    },
    
    // ========== 快捷操作 ==========
    
    async autoShutdown(seconds) {
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        
        try {
            const res = await API.calibration.sendCommand('auto_shutdown', { delay: seconds });
            if (res.success) {
                if (seconds > 0) {
                    this.log('warning', `⏻ 设备将在 ${seconds} 秒后自动关机`);
                    Utils.toast(`${seconds}秒后自动关机`, 'warning');
                } else {
                    this.log('info', '✓ 已取消自动关机');
                    Utils.toast('已取消自动关机', 'success');
                }
            } else {
                this.log('error', `自动关机设置失败: ${res.error || '未知错误'}`);
            }
        } catch (e) {
            this.log('error', '发送失败');
        }
    },
    
    // 打开诊断弹窗
    runDiagnostic() {
        if (!this.connected) {
            Utils.toast('请先连接设备', 'warning');
            return;
        }
        
        // 显示弹窗
        const modal = document.getElementById('diag-modal');
        if (modal) modal.style.display = 'flex';
        
        // 重置状态
        this.diagItems = [
            { id: 'status', name: '系统状态', icon: '📊', status: 'pending', detail: '' },
            { id: 'adc', name: 'ADC波形', icon: '📈', status: 'pending', detail: '' },
            { id: 'apd', name: 'APD电压', icon: '⚡', status: 'pending', detail: '' },
            { id: 'phase', name: '相位稳定性', icon: '🎯', status: 'pending', detail: '' },
            { id: 'cal', name: '校准数据', icon: '📋', status: 'pending', detail: '' },
            { id: 'coeff', name: '系数+光速', icon: '⚙️', status: 'pending', detail: '' }
        ];
        this.renderDiagItems();
        this.updateDiagProgress(0, '点击开始诊断');
        
        const btn = document.getElementById('diag-start-btn');
        if (btn) { btn.disabled = false; btn.textContent = '开始诊断'; }
    },
    
    closeDiagModal() {
        const modal = document.getElementById('diag-modal');
        if (modal) modal.style.display = 'none';
    },
    
    updateDiagProgress(pct, text) {
        const fill = document.getElementById('diag-progress-fill');
        const pctEl = document.getElementById('diag-progress-pct');
        const textEl = document.getElementById('diag-step-text');
        if (fill) fill.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (textEl) textEl.textContent = text;
    },
    
    renderDiagItems() {
        const container = document.getElementById('diag-results');
        if (!container) return;
        
        container.innerHTML = this.diagItems.map(item => `
            <div class="diag-item ${item.status}" id="diag-item-${item.id}">
                <div class="diag-icon">${item.status === 'pass' ? '✅' : item.status === 'fail' ? '❌' : item.status === 'warn' ? '⚠️' : '⏳'}</div>
                <div class="diag-content">
                    <div class="diag-title">${item.icon} ${item.name}</div>
                    <div class="diag-detail">${item.detail || '等待检测...'}</div>
                </div>
            </div>
        `).join('');
    },
    
    updateDiagItem(id, status, detail) {
        const item = this.diagItems.find(i => i.id === id);
        if (item) {
            item.status = status;
            item.detail = detail;
        }
        this.renderDiagItems();
    },

    // 别名：HTML中调用的是 startDiagnostic
    startDiagnostic() { return this.runDiagnosis(); },

    // 协议配置缓存
    _protocolConfig: null,
    
    // 获取协议配置（带缓存）
    async getProtocolConfig() {
        if (!this._protocolConfig) {
            try {
                const resp = await fetch('/calibration/config/protocols.json');
                this._protocolConfig = await resp.json();
            } catch (e) {
                console.warn('加载协议配置失败:', e);
                this._protocolConfig = { commands: {} };
            }
        }
        return this._protocolConfig;
    },
    
    // 从协议配置获取错误描述和修复建议
    getDiagFix(cmdId, errorCode, modelName = null) {
        const config = this._protocolConfig;
        if (!config?.commands?.[cmdId]) return null;
        
        const cmd = config.commands[cmdId];
        const errorParam = cmd.recv_params?.find(p => p.name === 'error');
        if (!errorParam) return null;
        
        const errStr = String(errorCode);
        let text = errorParam.enum?.[errStr] || `错误${errorCode}`;
        let fix = errorParam.fix?.[errStr] || null;
        
        // 检查设备特定覆盖
        if (modelName && errorParam.model_overrides?.[modelName]?.[errStr]) {
            const override = errorParam.model_overrides[modelName][errStr];
            if (override.text) text = override.text;
            if (override.fix) fix = override.fix;
        }
        
        return { text, fix };
    },
    
    // 获取硬件状态位描述
    getHwStatusBit(cmdId, bitIndex, modelName = null) {
        const config = this._protocolConfig;
        if (!config?.commands?.[cmdId]) return null;
        
        const cmd = config.commands[cmdId];
        const hwParam = cmd.recv_params?.find(p => p.name === 'hw_status');
        if (!hwParam?.bits) return null;
        
        const bitStr = String(bitIndex);
        let info = hwParam.bits[bitStr] || null;
        if (!info) return null;
        
        // 检查设备特定覆盖
        if (modelName && hwParam.model_overrides?.[modelName]?.[bitStr]) {
            info = { ...info, ...hwParam.model_overrides[modelName][bitStr] };
        }
        
        return info;
    },

    async runDiagnosis() {
        const btn = document.getElementById('diag-start-btn');
        if (btn) { btn.disabled = true; btn.textContent = '诊断中...'; }
        
        // 预加载协议配置
        await this.getProtocolConfig();
        
        // 获取当前设备型号（用于设备特定修复建议）
        const modelName = this.devices?.[0]?.model_name?.toLowerCase()?.replace(/[- ]/g, '-') || null;
        
        this.log('info', '🔍 开始设备诊断...');
        let passCount = 0, totalCount = 6;
        const fixes = []; // 收集修复建议
        
        try {
            // E0 - 系统状态
            this.updateDiagProgress(10, '检测系统状态...');
            const e0 = await API.calibration.sendCommand('diag_status', {});
            if (e0.success) {
                const p = e0.params || {};
                const sysErr = p.sys_err || 0;
                const hw = p.hw_status || 0;
                const phaseTxt = p.phase_cal === 2 ? '完成' : (p.phase_cal === 1 ? '部分' : '未校准');
                const speedTxt = p.speed_cal === 4 ? '已校准' : '未校准';
                
                // 从配置获取硬件状态位描述
                const mc3416Info = this.getHwStatusBit('diag_status', 0, modelName) || { name: 'MC3416', fix: '检查加速度计焊接' };
                const pllInfo = this.getHwStatusBit('diag_status', 1, modelName) || { name: 'PLL', fix: '检查晶振和PLL电路' };
                
                let detail = `错误码: <span class="${sysErr?'err':'val'}">0x${sysErr.toString(16).toUpperCase()}</span> | 
                    相位: <span class="val">${phaseTxt}</span> | 光速: <span class="val">${speedTxt}</span><br>
                    ${mc3416Info.name}: ${(hw&1)?'✓':'✗'} | ${pllInfo.name}: ${(hw&2)?'✓':'✗'} | apdwork: <span class="val">${(p.apdwork_x100||0)/100}</span>`;
                
                if (!(hw & 1)) fixes.push(`🔧 ${mc3416Info.name}未检测到 → ${mc3416Info.fix}`);
                if (!(hw & 2)) fixes.push(`🔧 ${pllInfo.name}未锁定 → ${pllInfo.fix}`);
                if (p.phase_cal !== 2) fixes.push('🔧 相位未完全校准 → 执行三点标定流程');
                if (p.speed_cal !== 4) fixes.push('🔧 光速未校准 → 执行光速校准流程');
                
                this.updateDiagItem('status', sysErr === 0 && (hw === 3) ? 'pass' : 'warn', detail);
                if (sysErr === 0 && hw === 3) passCount++;
            } else {
                this.updateDiagItem('status', 'fail', `通信失败: ${e0.error || '无响应'}`);
                fixes.push('🔧 设备通信失败 → 检查串口连接和波特率');
            }
            
            // E1 - ADC
            this.updateDiagProgress(25, '检测ADC波形...');
            const e1 = await API.calibration.sendCommand('diag_adc', { channel: 0 });
            if (e1.success) {
                const p = e1.params || {};
                const err = p.error || 0;
                let detail = `Min: <span class="val">${p.adc_min||0}</span> | Max: <span class="val">${p.adc_max||0}</span>`;
                if (err !== 0) {
                    const diagInfo = this.getDiagFix('diag_adc', err, modelName);
                    detail += ` <span class="err">(${diagInfo?.text || '异常'})</span>`;
                    if (diagInfo?.fix) fixes.push(`🔧 ${diagInfo.text} → ${diagInfo.fix}`);
                }
                this.updateDiagItem('adc', err === 0 ? 'pass' : 'fail', detail);
                if (err === 0) passCount++;
            } else {
                this.updateDiagItem('adc', 'fail', `通信失败`);
            }
            
            // E2 - APD
            this.updateDiagProgress(40, '检测APD电压...');
            const e2 = await API.calibration.sendCommand('diag_apd', {});
            if (e2.success) {
                const p = e2.params || {};
                const err = p.error || 0;
                let detail = `当前: <span class="val">${p.apd_vol||0}</span> | 最佳: <span class="val">${p.best_apd||0}</span>`;
                if (err !== 0) {
                    const diagInfo = this.getDiagFix('diag_apd', err, modelName);
                    detail += ` <span class="err">(${diagInfo?.text || '异常'})</span>`;
                    if (diagInfo?.fix) fixes.push(`🔧 ${diagInfo.text} → ${diagInfo.fix}`);
                }
                this.updateDiagItem('apd', err === 0 ? 'pass' : 'fail', detail);
                if (err === 0) passCount++;
            } else {
                this.updateDiagItem('apd', 'fail', `通信失败`);
            }
            
            // E3 - 相位稳定性
            this.updateDiagProgress(55, '检测相位稳定性...');
            const e3 = await API.calibration.sendCommand('diag_phase', { channel: 0 });
            // 注意：success是基于error===0判断的，但我们要用params存在来判断通信是否成功
            if (e3.params) {
                const p = e3.params || {};
                const err = p.error || 0;
                let detail = `相位: <span class="val">${(p.phase_x10||0)/10}°</span> | 幅值: <span class="val">${p.amplitude||0}</span> | shake: <span class="val">${(p.shake_x10||0)/10}</span>`;
                if (err !== 0) {
                    const diagInfo = this.getDiagFix('diag_phase', err, modelName);
                    detail += ` <span class="err">(${diagInfo?.text || '异常'})</span>`;

                    // 如果配置里有明确修复建议，优先用；否则补一个通用原因提示
                    if (diagInfo?.fix) {
                        fixes.push(`🔧 ${diagInfo.text} → ${diagInfo.fix}`);
                    } else {
                        fixes.push('🔧 相位稳定性异常（常见是扫描原因） → 检查光路：光斑是否打在接收窗、是否有光偏移/光斑散、距离靶反射是否过低；检查安装角度/固定螺丝；必要时重新对光后再做三点标定');
                    }
                }
                this.updateDiagItem('phase', err === 0 ? 'pass' : (err & 2) ? 'fail' : 'warn', detail);
                if (err === 0) passCount++;
            } else {
                this.updateDiagItem('phase', 'fail', `通信失败: ${e3.error || '无响应'}`);
            }
            
            // E4 - 校准数据
            this.updateDiagProgress(70, '检测校准数据...');
            const e4 = await API.calibration.sendCommand('diag_phase_cal', { index: 0 });
            if (e4.success) {
                const p = e4.params || {};
                const err = p.error || 0;
                let detail = `160M: <span class="val">${(p.phase_160M_x10||0)/10}°</span> | APD: <span class="val">${p.apdvol||0}</span>`;
                if (err !== 0) {
                    const diagInfo = this.getDiagFix('diag_phase_cal', err, modelName);
                    detail += ` <span class="err">(${diagInfo?.text || '异常'})</span>`;
                    if (diagInfo?.fix) fixes.push(`🔧 ${diagInfo.text} → ${diagInfo.fix}`);
                }
                this.updateDiagItem('cal', err === 0 ? 'pass' : 'fail', detail);
                if (err === 0) passCount++;
            } else {
                this.updateDiagItem('cal', 'fail', `通信失败`);
            }
            
            // E5 - 系数+光速
            this.updateDiagProgress(85, '检测系数和光速...');
            const e5 = await API.calibration.sendCommand('diag_coeff_speed', {});
            // 注意：success是基于error===0判断的，但我们要用params存在来判断通信是否成功
            if (e5.params) {
                const p = e5.params || {};
                const err = p.error || 0;
                let detail = `apdwork: <span class="val">${(p.apdwork_x1000||0)/1000}</span> | apd2work: <span class="val">${(p.apd2work_x1000||0)/1000}</span> | 
                    apdcoeff: <span class="val">${(p.apdcoeff_x1000||0)/1000}</span><br>
                    光速校准: num=<span class="val">${p.speed_num}</span> | dis1=<span class="val">${p.actual_dis1||0}</span> | dis2=<span class="val">${p.actual_dis2||0}</span>`;
                if (err !== 0) {
                    const diagInfo = this.getDiagFix('diag_coeff_speed', err, modelName);
                    detail += ` <span class="err">(${diagInfo?.text || '异常'})</span>`;
                    if (diagInfo?.fix) fixes.push(`🔧 ${diagInfo.text} → ${diagInfo.fix}`);
                }
                this.updateDiagItem('coeff', err === 0 ? 'pass' : 'fail', detail);
                if (err === 0) passCount++;
            } else {
                this.updateDiagItem('coeff', 'fail', `通信失败: ${e5.error || '无响应'}`);
            }
            
            // 完成 - 显示修复建议
            await this.flushLogs();
            this.updateDiagProgress(100, `诊断完成: ${passCount}/${totalCount} 通过`);
            this.showDiagSummary(passCount, totalCount, fixes);
            this.log('success', `🔍 诊断完成: ${passCount}/${totalCount} 通过`);
            
        } catch (e) {
            this.log('error', '诊断出错: ' + e.message);
            this.updateDiagProgress(0, '诊断出错');
        }
        
        if (btn) { btn.disabled = false; btn.textContent = '重新诊断'; }
    },
    
    showDiagSummary(passCount, totalCount, fixes) {
        const container = document.getElementById('diag-results');
        if (!container) return;
        
        // 添加总结卡片
        let summaryHtml = `
            <div class="diag-summary" style="margin-top:16px; padding:16px; background:rgba(0,0,0,0.3); border-radius:8px; border:1px solid ${passCount === totalCount ? '#4ade80' : '#fbbf24'}">
                <div style="font-size:18px; font-weight:600; margin-bottom:12px; color:${passCount === totalCount ? '#4ade80' : '#fbbf24'}">
                    ${passCount === totalCount ? '✅ 设备状态正常' : `⚠️ 发现 ${totalCount - passCount} 个问题`}
                </div>`;
        
        const hasIssue = passCount !== totalCount;

        if (fixes.length > 0) {
            summaryHtml += `<div style="font-size:13px; color:#94a3b8; margin-bottom:8px">修复建议:</div>
                <ul style="margin:0; padding-left:20px; font-size:13px; line-height:1.8">
                    ${fixes.map(f => `<li>${f}</li>`).join('')}
                </ul>`;
        } else {
            summaryHtml += hasIssue
                ? `<div style="font-size:13px; color:#94a3b8">发现异常但暂无自动修复建议。建议：先排查光路/对光（光偏移、光斑散、反射率过低）、检查安装固定与线缆连接；必要时重新执行三点标定。</div>`
                : `<div style="font-size:13px; color:#94a3b8">所有检测项均通过，设备可正常使用。</div>`;
        }
        
        summaryHtml += '</div>';
        container.insertAdjacentHTML('beforeend', summaryHtml);
        container.scrollTop = container.scrollHeight;
    },
    
    // ========== 日志 ==========
    
    log(type, message) {
        // 兼容旧调用：最终以新版appendLog渲染（含颜色/过滤/控制台同步）
        if (typeof this.appendLog === 'function') {
            this.appendLog(type, message);
        }
    },
    
    clearLog() {
        // 兼容旧调用：最终以新版clearLog执行（含后端清理/索引重置）
        const container = document.getElementById('cal-log');
        if (container) container.innerHTML = '';
        this.logIndex = 0;
        if (API?.calibration?.clearLogs) API.calibration.clearLogs();
    },
    
    // 连接弹窗
    openConnDialog() {
        const modal = document.getElementById('conn-modal');
        if (modal) modal.style.display = 'flex';
        const mode = this.isTcpBridgeActive() ? 'tcp' : this.getConnMode();
        this.onConnModeChanged(mode);
        try {
            const ipEl = document.getElementById('cal-tcp-ip');
            const portEl = document.getElementById('cal-tcp-port');
            if (ipEl) ipEl.value = localStorage.getItem('cal_tcp_ip') || ipEl.value || '';
            if (portEl) portEl.value = localStorage.getItem('cal_tcp_port') || portEl.value || '7000';
        } catch (e) {}
        this.refreshPorts();
    },
    
    closeConnDialog() {
        const modal = document.getElementById('conn-modal');
        if (modal) modal.style.display = 'none';
    },
    
    // 更新连接状态显示
    updateConnUI() {
        const dot = document.getElementById('cal-conn-dot');
        const text = document.getElementById('cal-conn-text');
        const btn = document.getElementById('conn-modal-btn');
        
        if (this.connected) {
            dot?.classList.add('connected');
            if (text) text.textContent = '已连接';
            if (btn) btn.textContent = '断开';
        } else {
            dot?.classList.remove('connected');
            if (text) text.textContent = '未连接';
            if (btn) btn.textContent = '连接';
        }
    },
    
    // 选择流程
    selectWorkflow(wfId) {
        // 兼容旧调用：委托到新版逻辑（会渲染步骤预览/参数）
        this.selectWorkflowById(wfId);
        const name = this.selectedWorkflow?.name || wfId || '';
        if (name) this.log('info', `已选择流程: ${name}`);
    },

    
    toggleWfPreview() {
        this._wfPreviewExpanded = !this._wfPreviewExpanded;
        this.renderWorkflowConfig();
    },
    
    // ========== 配置管理 ==========
    
    // 当前机器的自定义配置
    machineConfigs: {},
    currentMachine: '',
    editingCmd: null,
    editingWf: null,

    _setCurrentMachine(machineId) {
        if (!machineId) return;
        this.currentMachine = machineId;
        try {
            localStorage.setItem('cal_current_machine', String(machineId));
        } catch (e) {}
        const select = document.getElementById('machine-type');
        if (select) select.value = String(machineId);
    },
    
    openSettings() {
        const modal = document.getElementById('cal-settings-modal');
        if (modal) {
            modal.style.display = 'flex';
            this.bindTabEvents();
            this.renderCmdConfigList();
            this.renderWfConfigList();
            this.loadSettingsValues();
        }
    },
    
    closeSettings() {
        const modal = document.getElementById('cal-settings-modal');
        if (modal) modal.style.display = 'none';
    },
    
    bindTabEvents() {
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
            };
        });
    },
    
    // 机器类型切换
    async switchMachine(machineId, options = {}) {
        const { fromDeviceManager = false } = options || {};
        if (!machineId) return;
        if (!fromDeviceManager && window.DeviceConfigManager) {
            const current = DeviceConfigManager.getCurrentDevice();
            if (current !== machineId) {
                await DeviceConfigManager.setCurrentDevice(machineId);
                return;
            }
        }
        this._setCurrentMachine(machineId);
        // 加载该机器的配置
        this.loadMachineConfig(machineId);
        this.renderCmdConfigList();
        this.renderWfConfigList();
        this.renderCommands();
        this.renderWorkflows();
        Utils.toast(`已切换到: ${machineId}`, 'info');
    },
    
    loadMachineConfig(machineId) {
        const saved = localStorage.getItem(`machine_config_${machineId}`);
        if (saved) {
            try {
                const config = JSON.parse(saved);
                this.commands = config.commands || this.commands;
                this.workflows = config.workflows || this.workflows;
                this.commandParams = config.params || this.commandParams;
            } catch (e) {}
        }
    },

    async syncDeviceConfigFromBackend() {
        // 当后端匹配到机型配置后，以后端 device_config 为准覆盖本页编辑器数据
        const cfgId = this.activeProfile?.id || this.activeConfigId;
        if (!cfgId) {
            console.log('[CAL] syncDeviceConfigFromBackend: 没有活动配置ID，跳过同步');
            return;
        }
        console.log('[CAL] syncDeviceConfigFromBackend: 开始同步配置', cfgId);
        try {
            const res = await API.deviceConfig.get(cfgId);
            if (!res || res.success !== true || !res.config) {
                console.log('[CAL] syncDeviceConfigFromBackend: 获取配置失败或为空', res);
                return;
            }
            console.log('[CAL] syncDeviceConfigFromBackend: 获取到配置', res.config.params);

            this.activeConfigId = res.config.id || cfgId;
            this.activeModelPattern = res.config.model_pattern || '';

            // 以匹配到的机型配置ID作为当前机型，避免退出后回到默认gd_laser导致“保存机型旁边重置”
            this._setCurrentMachine(this.activeConfigId);

            // 注意：device_config_get 会把 commands dict 转成 list
            this.commands = Array.isArray(res.config.commands) ? res.config.commands : (this.commands || []);
            this.workflows = Array.isArray(res.config.workflows) ? res.config.workflows : (this.workflows || []);
            this.commandParams = (res.config.params && typeof res.config.params === 'object') ? res.config.params : (this.commandParams || {});

            // 把 commandParams 的值同步到所有 workflow.params（映射 calibrate_p1.distance → p1_distance_mm 等）
            this._syncCommandParamsToWorkflows();

            // 立即刷新UI
            this.renderCmdConfigList();
            this.renderWfConfigList();
            this.renderCommands();
            this.renderWorkflows();

            // 如果当前有选中流程，也刷新参数面板
            if (this.selectedWorkflow) {
                const wfId = this.selectedWorkflow.id;
                const updated = this.workflows.find(w => w.id === wfId);
                if (updated) {
                    this.selectedWorkflow = updated;
                    this.renderWorkflowConfig(updated);
                }
            }
        } catch (e) {
            console.error('同步机型配置失败:', e);
        }
    },

    _syncCommandParamsToWorkflows() {
        // B页是配置源，把所有参数同步到workflow.params的default值
        // 包括：标定距离、滑台位置、转靶位置等所有参数
        const cp = this.commandParams || {};
        
        // 建立参数映射：workflow.params的key → B页配置的值
        const mapping = {
            // 标定距离参数
            'p1_distance_mm': cp.calibrate_p1?.distance,
            'p1_distance': cp.calibrate_p1?.distance,
            'p2_distance_mm': cp.calibrate_p2?.distance,
            'p2_distance': cp.calibrate_p2?.distance,
            'p3_distance_mm': cp.calibrate_p3?.distance,
            'p3_distance': cp.calibrate_p3?.distance,
            'p1_reflectivity_pct': cp.calibrate_p1?.reflectivity,
            'p2_reflectivity_pct': cp.calibrate_p2?.reflectivity,
            'p3_reflectivity_pct': cp.calibrate_p3?.reflectivity,
            // 滑台位置（独立参数）
            'slipway_p1_mm': cp.slipway_p1_mm,
            'slipway_p2_mm': cp.slipway_p2_mm,
            'slipway_p3_mm': cp.slipway_p3_mm,
            // 激光参数
            'laser_model': cp.laser_on?.model,
            'laser_direction': cp.laser_on?.direction,
        };

        // 遍历所有workflow，更新其params的default值
        for (const wf of (this.workflows || [])) {
            if (!wf.params || typeof wf.params !== 'object') continue;
            for (const [key, val] of Object.entries(mapping)) {
                if (val === undefined || val === null) continue;
                if (wf.params[key] !== undefined) {
                    // 更新 default 值
                    if (typeof wf.params[key] === 'object') {
                        wf.params[key].default = val;
                    } else {
                        wf.params[key] = { default: val };
                    }
                }
            }
        }
        console.log('[CAL] _syncCommandParamsToWorkflows: 已同步B页所有参数到workflows');
    },

    _getWfParamStorageKey(workflowId) {
        const wid = workflowId != null ? String(workflowId) : '';
        const cfg = (this.activeConfigId || this.activeProfile?.id || this.activeModelName || 'default');
        return `cal_wf_params_${cfg}_${wid}`;
    },

    _loadWfParamValues(workflowId) {
        try {
            const raw = localStorage.getItem(this._getWfParamStorageKey(workflowId));
            if (!raw) return null;
            const data = JSON.parse(raw);
            return (data && typeof data === 'object') ? data : null;
        } catch (e) {
            return null;
        }
    },

    _saveWfParamValues(workflowId, params) {
        try {
            localStorage.setItem(this._getWfParamStorageKey(workflowId), JSON.stringify(params || {}));
        } catch (e) {}
    },

    _collectCurrentWfParams() {
        // A页仅预览，不再有参数输入框，直接使用后端配置的默认值
        const params = {};
        const paramDefs = this._wfParamDefs || this.selectedWorkflow?.params || {};
        for (const [key, def] of Object.entries(paramDefs)) {
            params[key] = def.default;
        }
        return params;
    },
    
    addMachine() {
        const name = prompt('输入新机器类型名称:');
        if (!name) return;
        const id = name.toLowerCase().replace(/\s+/g, '_');
        
        const select = document.getElementById('machine-type');
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
        select.value = id;
        
        this.switchMachine(id);
        Utils.toast(`已创建机器类型: ${name}`, 'success');
    },
    
    // 命令配置列表
    renderCmdConfigList() {
        const container = document.getElementById('cmd-config-list');
        if (!container) return;
        
        container.innerHTML = this.commands.map((cmd, idx) => `
            <div class="config-item" onclick="CalibrationPageV2.editCommand(${idx})">
                <span class="icon">${cmd.icon || '📌'}</span>
                <div class="info">
                    <div class="name">${cmd.name}</div>
                    <div class="meta">${(cmd.send_params || []).length} 个参数</div>
                </div>
                <span class="code">0x${cmd.code}</span>
                <button class="cyber-btn sm edit-btn">编辑</button>
            </div>
        `).join('') || '<div class="empty-state">暂无命令</div>';
    },
    
    // 流程配置列表
    renderWfConfigList() {
        const container = document.getElementById('wf-config-list');
        if (!container) return;
        
        container.innerHTML = this.workflows.map((wf, idx) => `
            <div class="config-item" onclick="CalibrationPageV2.editWorkflow(${idx})">
                <span class="icon">${wf.icon || '📋'}</span>
                <div class="info">
                    <div class="name">${wf.name}</div>
                    <div class="meta">${wf.description || ''}</div>
                </div>
                <button class="cyber-btn sm edit-btn">编辑</button>
            </div>
        `).join('') || '<div class="empty-state">暂无流程</div>';
    },
    
    // ========== 命令编辑 ==========
    
    addCommand() {
        this.editingCmd = {
            id: 'new_cmd_' + Date.now(),
            name: '',
            code: '',
            icon: '📌',
            timeout: 500,
            retry: 3,
            send_params: [],
            recv_params: [{ name: 'error', type: 'uint8', label: '错误码' }]
        };
        this.showCmdEditModal('新增命令', true);
    },
    
    editCommand(idx) {
        this.editingCmd = JSON.parse(JSON.stringify(this.commands[idx]));
        this.editingCmd._index = idx;
        this.showCmdEditModal('编辑命令', false);
    },
    
    showCmdEditModal(title, isNew) {
        document.getElementById('cmd-edit-title').textContent = title;
        document.getElementById('cmd-edit-name').value = this.editingCmd.name || '';
        document.getElementById('cmd-edit-code').value = this.editingCmd.code || '';
        document.getElementById('cmd-edit-icon').value = this.editingCmd.icon || '📌';
        document.getElementById('cmd-edit-timeout').value = this.editingCmd.timeout || 500;
        document.getElementById('cmd-edit-retry').value = this.editingCmd.retry || 3;
        document.getElementById('cmd-delete-btn').style.display = isNew ? 'none' : 'block';
        
        this.renderSendParams();
        this.renderRecvParams();
        this.updateFramePreview();
        
        document.getElementById('cmd-edit-modal').style.display = 'flex';
    },
    
    // 渲染发送参数表格
    renderSendParams() {
        const container = document.getElementById('cmd-send-params');
        const params = this.editingCmd?.send_params || [];
        
        let html = `<div class="param-header">
            <span>参数名</span><span>类型</span><span>显示名</span><span>默认值</span><span></span>
        </div>`;
        
        if (params.length === 0) {
            html += '<div class="param-empty">无发送参数（点击添加）</div>';
        } else {
            params.forEach((p, i) => {
                html += `<div class="param-row">
                    <input type="text" value="${p.name || ''}" onchange="CalibrationPageV2.updateSendParam(${i}, 'name', this.value)" placeholder="name">
                    <select onchange="CalibrationPageV2.updateSendParam(${i}, 'type', this.value)">
                        <option value="uint8" ${p.type === 'uint8' ? 'selected' : ''}>uint8 (1字节)</option>
                        <option value="uint16" ${p.type === 'uint16' ? 'selected' : ''}>uint16 (2字节)</option>
                        <option value="uint32" ${p.type === 'uint32' ? 'selected' : ''}>uint32 (4字节)</option>
                    </select>
                    <input type="text" value="${p.label || ''}" onchange="CalibrationPageV2.updateSendParam(${i}, 'label', this.value)" placeholder="显示名">
                    <input type="number" value="${p.default || 0}" onchange="CalibrationPageV2.updateSendParam(${i}, 'default', this.value)">
                    <button class="cyber-btn sm del-btn" onclick="CalibrationPageV2.removeSendParam(${i})">🗑️</button>
                </div>`;
            });
        }
        container.innerHTML = html;
    },
    
    // 渲染接收参数表格
    renderRecvParams() {
        const container = document.getElementById('cmd-recv-params');
        const params = this.editingCmd?.recv_params || [];
        
        let html = `<div class="param-header">
            <span>参数名</span><span>类型</span><span>显示名</span><span>单位</span><span></span>
        </div>`;
        
        if (params.length === 0) {
            html += '<div class="param-empty">无接收参数（点击添加）</div>';
        } else {
            params.forEach((p, i) => {
                html += `<div class="param-row">
                    <input type="text" value="${p.name || ''}" onchange="CalibrationPageV2.updateRecvParam(${i}, 'name', this.value)" placeholder="name">
                    <select onchange="CalibrationPageV2.updateRecvParam(${i}, 'type', this.value)">
                        <option value="uint8" ${p.type === 'uint8' ? 'selected' : ''}>uint8 (1字节)</option>
                        <option value="uint16" ${p.type === 'uint16' ? 'selected' : ''}>uint16 (2字节)</option>
                        <option value="uint32" ${p.type === 'uint32' ? 'selected' : ''}>uint32 (4字节)</option>
                    </select>
                    <input type="text" value="${p.label || ''}" onchange="CalibrationPageV2.updateRecvParam(${i}, 'label', this.value)" placeholder="显示名">
                    <input type="text" value="${p.unit || ''}" onchange="CalibrationPageV2.updateRecvParam(${i}, 'unit', this.value)" placeholder="mm">
                    <button class="cyber-btn sm del-btn" onclick="CalibrationPageV2.removeRecvParam(${i})">🗑️</button>
                </div>`;
            });
        }
        container.innerHTML = html;
    },
    
    addSendParam() {
        if (!this.editingCmd) return;
        this.editingCmd.send_params.push({ name: '', type: 'uint8', label: '', default: 0 });
        this.renderSendParams();
        this.updateFramePreview();
    },
    
    updateSendParam(idx, field, value) {
        if (!this.editingCmd) return;
        this.editingCmd.send_params[idx][field] = field === 'default' ? parseInt(value) || 0 : value;
        this.updateFramePreview();
    },
    
    removeSendParam(idx) {
        if (!this.editingCmd) return;
        this.editingCmd.send_params.splice(idx, 1);
        this.renderSendParams();
        this.updateFramePreview();
    },
    
    addRecvParam() {
        if (!this.editingCmd) return;
        this.editingCmd.recv_params.push({ name: '', type: 'uint8', label: '', unit: '' });
        this.renderRecvParams();
        this.updateFramePreview();
    },
    
    updateRecvParam(idx, field, value) {
        if (!this.editingCmd) return;
        this.editingCmd.recv_params[idx][field] = value;
        this.updateFramePreview();
    },
    
    removeRecvParam(idx) {
        if (!this.editingCmd) return;
        this.editingCmd.recv_params.splice(idx, 1);
        this.renderRecvParams();
        this.updateFramePreview();
    },
    
    // 更新帧预览
    updateFramePreview() {
        const cmd = this.editingCmd;
        if (!cmd) return;
        
        const code = cmd.code || '--';
        const typeSize = { 'uint8': 1, 'uint16': 2, 'uint32': 4, 'string16': 16 };
        
        // 构建发送参数详情
        let sendLen = 0;
        let sendDetail = '';
        (cmd.send_params || []).forEach(p => {
            const sz = typeSize[p.type] || 1;
            sendLen += sz;
            sendDetail += `[${p.name}:${sz}B] `;
        });
        
        // 构建接收参数详情
        let recvLen = 0;
        let recvDetail = '';
        (cmd.recv_params || []).forEach(p => {
            const sz = typeSize[p.type] || 1;
            recvLen += sz;
            recvDetail += `[${p.name}:${sz}B] `;
        });
        
        const sendLenHex = sendLen.toString(16).toUpperCase().padStart(2, '0');
        const recvLenHex = recvLen.toString(16).toUpperCase().padStart(2, '0');
        
        // 发送固定10字节: AA EE CMD [4字节数据,不足补0] XOR BB FF
        // 接收可变: AA FE CMD LEN [DATA] XOR BB FF
        const recvTotal = 7 + recvLen;
        
        document.getElementById('cmd-preview-send').textContent = 
            `AA EE ${code} [${sendDetail || '00 00 00 00'}] [XOR] BB FF (固定10字节)`;
        document.getElementById('cmd-preview-recv').textContent = 
            `AA FE ${code} ${recvLenHex} ${recvDetail}[XOR] BB FF (共${recvTotal}字节)`;
    },
    
    closeCmdEdit() {
        document.getElementById('cmd-edit-modal').style.display = 'none';
        this.editingCmd = null;
    },
    
    saveCmdEdit() {
        const cmd = this.editingCmd;
        cmd.name = document.getElementById('cmd-edit-name').value;
        cmd.code = document.getElementById('cmd-edit-code').value.toUpperCase();
        cmd.icon = document.getElementById('cmd-edit-icon').value || '📌';
        cmd.timeout = parseInt(document.getElementById('cmd-edit-timeout').value) || 500;
        cmd.retry = parseInt(document.getElementById('cmd-edit-retry').value) || 3;
        
        if (!cmd.name || !cmd.code) {
            Utils.toast('请填写命令名称和命令码', 'warning');
            return;
        }
        
        if (cmd._index !== undefined) {
            this.commands[cmd._index] = cmd;
        } else {
            cmd.id = cmd.name.toLowerCase().replace(/\s+/g, '_');
            this.commands.push(cmd);
        }
        
        this.closeCmdEdit();
        this.renderCmdConfigList();
        this.renderCommands();
        Utils.toast('命令已保存', 'success');
    },
    
    deleteCommand() {
        if (this.editingCmd?._index === undefined) return;
        if (!confirm('确定删除这个命令?')) return;
        
        this.commands.splice(this.editingCmd._index, 1);
        this.closeCmdEdit();
        this.renderCmdConfigList();
        this.renderCommands();
        Utils.toast('命令已删除', 'success');
    },
    
    // ========== 流程编辑 ==========
    // ========== 配置导入导出 ==========
    
    saveAllConfig() {
        // 保存快捷参数
        const p = this.commandParams;
        const laserModel = document.getElementById('set-laser-model');
        const laserDir = document.getElementById('set-laser-dir');
        if (laserModel && laserDir) {
            p.laser_on = { model: parseInt(laserModel.value), direction: parseInt(laserDir.value) };
        }
        p.calibrate_p1 = { distance: parseInt(document.getElementById('set-cal-p1')?.value) || 5000 };
        p.calibrate_p2 = { distance: parseInt(document.getElementById('set-cal-p2')?.value) || 20000 };
        p.calibrate_p3 = { distance: parseInt(document.getElementById('set-cal-p3')?.value) || 25000 };
        
        // 保存到localStorage
        const config = {
            commands: this.commands,
            workflows: this.workflows,
            params: this.commandParams
        };
        localStorage.setItem(`machine_config_${this.currentMachine}`, JSON.stringify(config));

        // 同步保存到后端机型配置（避免打包版/刷新后丢失导致流程失败）
        this.activeConfigId = this.activeProfile?.id || this.activeConfigId || this.currentMachine;
        this.activeModelPattern = this.activeModelPattern || (this.activeConfigId ? `^${this.activeConfigId}$` : '');
        this._persistConfigToBackend();
        
        this.renderCommands();
        this.closeSettings();
        Utils.toast('配置已保存', 'success');
    },
    
    exportConfig() {
        const config = {
            machine: this.currentMachine,
            commands: this.commands,
            workflows: this.workflows,
            params: this.commandParams
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentMachine}_config.json`;
        a.click();
        URL.revokeObjectURL(url);
        Utils.toast('配置已导出', 'success');
    },
    
    importConfig() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const config = JSON.parse(ev.target.result);
                    this.commands = config.commands || [];
                    this.workflows = config.workflows || [];
                    this.commandParams = config.params || {};
                    this.renderCmdConfigList();
                    this.renderWfConfigList();
                    this.renderCommands();
                    this.renderWorkflows();
                    Utils.toast('配置已导入', 'success');
                } catch (err) {
                    Utils.toast('导入失败: JSON格式错误', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },
    
    loadSettingsValues() {
        const p = this.commandParams;
        const laserModel = document.getElementById('set-laser-model');
        const laserDir = document.getElementById('set-laser-dir');
        const calP1 = document.getElementById('set-cal-p1');
        const calP2 = document.getElementById('set-cal-p2');
        const calP3 = document.getElementById('set-cal-p3');
        
        if (laserModel) laserModel.value = String(p.laser_on?.model ?? 0);
        if (laserDir) laserDir.value = String(p.laser_on?.direction ?? 0);
        if (calP1) calP1.value = String(p.calibrate_p1?.distance ?? 5000);
        if (calP2) calP2.value = String(p.calibrate_p2?.distance ?? 20000);
        if (calP3) calP3.value = String(p.calibrate_p3?.distance ?? 25000);
    },
    
    loadSavedParams() {
        // 优先恢复上次选择的机型，并同步到下拉框，避免只改内存不改UI
        let last = '';
        try {
            last = localStorage.getItem('cal_current_machine') || '';
        } catch (e) {}

        const select = document.getElementById('machine-type');
        const fallback = select?.value || this.currentMachine || 'gd_laser';
        const machineId = String(last || fallback);

        this._setCurrentMachine(machineId);
        this.loadMachineConfig(this.currentMachine);
    },
    
    async _persistConfigToBackend() {
        // 将当前配置持久化到后端文件
        if (!this.activeConfigId) {
            console.warn('没有活动的机型配置ID，无法保存');
            return;
        }
        try {
            // 合并旧配置的 frame_format/version/default_workflow，避免写入不完整导致协议解析失败
            let prev = null;
            try {
                const prevRes = await API.deviceConfig.get(this.activeConfigId);
                if (prevRes && prevRes.success === true && prevRes.config) prev = prevRes.config;
            } catch (e) {}

            const configData = {
                name: prev?.name || this.activeConfigId,
                model_pattern: this.activeModelPattern || prev?.model_pattern || `^${this.activeConfigId}$`,
                version: prev?.version || '1.0',
                default_workflow: prev?.default_workflow || '',
                frame_format: prev?.frame_format || null,
                commands: this.commands,
                workflows: this.workflows,
                params: this.commandParams
            };
            const result = await API.deviceConfig.save(this.activeConfigId, configData);
            if (!result.success) {
                console.error('保存配置失败:', result.error);
                Utils.toast('保存到后端失败: ' + (result.error || '未知错误'), 'error');
            }
        } catch (e) {
            console.error('持久化配置异常:', e);
        }
    },

    // ========== 设备诊断 (0xE6/E7/E8) ==========
    
    DIAG_ERROR_BITS: {
        4: { name: "MC3416 ID错误", module: "传感器", suggestion: "检查角度传感器焊接" },
        5: { name: "MC3416数据读取失败", module: "传感器", suggestion: "角度传感器可能损坏" },
        8: { name: "PLL通信失败", module: "PLL", suggestion: "检查PLL芯片I2C连接" },
        9: { name: "PLL锁定失败", module: "PLL", suggestion: "PLL芯片可能损坏" },
        12: { name: "APD电压超范围", module: "APD", suggestion: "检查升压电路" },
        13: { name: "APD寻优失败", module: "APD", suggestion: "APD可能损坏或未焊接" },
        17: { name: "LD发射无响应", module: "LD", suggestion: "激光器可能损坏" },
        18: { name: "LD功率切换失败", module: "LD", suggestion: "检查功率控制电路" },
        20: { name: "ADC采集超时", module: "信号链", suggestion: "检查ADC触发引脚" },
        21: { name: "ADC数据全零", module: "信号链", suggestion: "检查接收电路焊接" },
        22: { name: "内光路异常", module: "信号链", suggestion: "检查内光路对准" },
        24: { name: "相位不稳定", module: "信号链", suggestion: "信号质量差，检查光路" },
        27: { name: "相位校准无效", module: "校准", suggestion: "需要重新相位校准" },
        28: { name: "光速校准无效", module: "校准", suggestion: "需要重新光速校准" },
        29: { name: "系数异常", module: "校准", suggestion: "校准系数超范围" },
    },

    DIAG_ITEMS: [
        { bit: 4, name: "角度传感器", module: "传感器" },
        { bit: 9, name: "PLL锁定", module: "PLL" },
        { bit: 12, name: "APD电压", module: "APD" },
        { bit: 17, name: "LD发射", module: "LD" },
        { bit: 20, name: "ADC采集", module: "信号链" },
        { bit: 22, name: "内光路", module: "信号链" },
        { bit: 24, name: "相位稳定性", module: "信号链" },
        { bit: 27, name: "相位校准", module: "校准" },
        { bit: 28, name: "光速校准", module: "校准" },
        { bit: 29, name: "系数有效性", module: "校准" },
    ],

    runDiagnostic() {
        const modal = document.getElementById('diag-modal');
        if (modal) { modal.style.display = 'flex'; this.renderDiagItems('pending'); }
    },

    closeDiagModal() {
        const modal = document.getElementById('diag-modal');
        if (modal) modal.style.display = 'none';
    },

    renderDiagItems(defaultStatus = 'pending') {
        const container = document.getElementById('diag-results');
        if (!container) return;
        let html = '';
        this.DIAG_ITEMS.forEach(item => {
            const icon = defaultStatus === 'pass' ? '✅' : defaultStatus === 'fail' ? '❌' : '⏳';
            html += `<div class="diag-item ${defaultStatus}" data-bit="${item.bit}">
                <div class="diag-icon">${icon}</div>
                <div class="diag-content">
                    <div class="diag-title">${item.name}</div>
                    <div class="diag-detail">[${item.module}] <span class="status-text">等待检测...</span></div>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    },

    async startDiagnostic() {
        if (!this.connected) { Utils.toast('请先连接设备', 'warning'); return; }
        const btn = document.getElementById('diag-start-btn');
        if (btn) { btn.disabled = true; btn.textContent = '检测中...'; }

        const updateProgress = (pct, text) => {
            const pctEl = document.getElementById('diag-progress-pct');
            const fillEl = document.getElementById('diag-progress-fill');
            const stepEl = document.getElementById('diag-step-text');
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (stepEl) stepEl.textContent = text;
        };

        this.renderDiagItems('pending');
        updateProgress(0, '正在执行自检...');

        try {
            const result = await API.call('diag_run_selftest');
            if (!result || !result.success) {
                updateProgress(100, '自检失败');
                Utils.toast(result?.error || '自检失败', 'error');
                return;
            }
            updateProgress(100, '自检完成');
            const errorCode = result.error_code || 0;
            this.updateDiagResults(errorCode);

            if (result.pass) {
                Utils.toast('✅ 自检通过', 'success');
                this.log('success', `自检通过 (0x${errorCode.toString(16).toUpperCase().padStart(8, '0')})`);
            } else {
                const failCount = result.errors?.length || 0;
                Utils.toast(`❌ 自检发现 ${failCount} 个问题`, 'error');
                this.log('error', `自检失败: ${failCount} 个问题 (0x${errorCode.toString(16).toUpperCase().padStart(8, '0')})`);
            }
        } catch (e) {
            updateProgress(100, '自检异常');
            Utils.toast('自检异常: ' + e, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '开始诊断'; }
        }
    },

    updateDiagResults(errorCode) {
        const container = document.getElementById('diag-results');
        if (!container) return;
        this.DIAG_ITEMS.forEach(item => {
            const el = container.querySelector(`[data-bit="${item.bit}"]`);
            if (!el) return;
            const isFail = (errorCode & (1 << item.bit)) !== 0;
            el.className = `diag-item ${isFail ? 'fail' : 'pass'}`;
            el.querySelector('.diag-icon').textContent = isFail ? '❌' : '✅';
            const detail = el.querySelector('.diag-detail');
            if (isFail) {
                const errInfo = this.DIAG_ERROR_BITS[item.bit];
                detail.innerHTML = `<span class="err">${errInfo?.suggestion || '检测失败'}</span>`;
            } else {
                detail.innerHTML = `<span class="val">通过</span>`;
            }
        });
    }
};

// 初始化时加载保存的参数
CalibrationPageV2.loadSavedParams();

window.CalibrationPageV2 = CalibrationPageV2;
