/**
 * DeviceHub 前端模块
 * 全局设备状态管理，供各页面共享
 */

const DeviceHub = {
    // 设备状态
    status: {
        serial: { connected: false, info: {} },
        slipway: { connected: false, info: {} },
        rotary: { connected: false, info: {} }
    },
    
    // 仿真模式状态
    simulationEnabled: false,

    // 设备信息栏展开状态
    devInfoExpanded: false,
    
    // 状态刷新定时器
    _refreshTimer: null,
    
    // 状态变化回调
    _callbacks: [],
    
    /**
     * 初始化
     */
    init() {
        console.log('DeviceHub init');
        try {
            this.devInfoExpanded = (localStorage.getItem('hub_devinfo_expanded') === 'true');
            this.applyDevInfoExpanded();
        } catch (e) {
            this.devInfoExpanded = false;
        }
        this.startRefresh();
        this.refreshSimulationStatus();
    },

    toggleDevInfoExpand() {
        this.devInfoExpanded = !this.devInfoExpanded;
        try {
            localStorage.setItem('hub_devinfo_expanded', this.devInfoExpanded ? 'true' : 'false');
        } catch (e) {}
        this.applyDevInfoExpanded();
    },

    applyDevInfoExpanded() {
        const bar = document.getElementById('device-status-bar');
        if (!bar) return;
        bar.classList.toggle('expanded', !!this.devInfoExpanded);
    },
    
    /**
     * 刷新仿真状态
     */
    async refreshSimulationStatus() {
        try {
            const result = await pywebview.api.simulation_get_status();
            if (result && result.success) {
                this.simulationEnabled = result.status.enabled;
                this.updateSimulationUI();
            }
        } catch (e) {
            console.warn('获取仿真状态失败:', e);
        }
    },
    
    /**
     * 切换仿真模式
     */
    async toggleSimulation() {
        try {
            const result = await pywebview.api.simulation_toggle();
            if (result && result.success) {
                this.simulationEnabled = result.enabled;
                this.updateSimulationUI();
                if (window.Utils) {
                    Utils.toast(this.simulationEnabled ? '仿真模式已启用' : '仿真模式已关闭', 'info');
                }
            }
        } catch (e) {
            console.error('切换仿真模式失败:', e);
            if (window.Utils) {
                Utils.toast('切换仿真模式失败', 'error');
            }
        }
    },
    
    /**
     * 更新仿真模式UI
     */
    updateSimulationUI() {
        const icon = document.getElementById('hub-sim-icon');
        const text = document.getElementById('hub-sim-text');
        const toggle = document.querySelector('.simulation-toggle');
        
        if (icon && text) {
            if (this.simulationEnabled) {
                icon.textContent = '🎮';
                text.textContent = '仿真';
                if (toggle) toggle.classList.add('active');
            } else {
                icon.textContent = '🔌';
                text.textContent = '实机';
                if (toggle) toggle.classList.remove('active');
            }
        }
    },
    
    /**
     * 开始定时刷新状态
     */
    startRefresh() {
        if (this._refreshTimer) return;
        this._refreshTimer = setInterval(() => this.refresh(), 2000);  // 2秒刷新一次（原500ms）
        this.refresh(); // 立即刷新一次
    },
    
    /**
     * 停止刷新
     */
    stopRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    },
    
    /**
     * 刷新状态
     */
    async refresh() {
        try {
            const result = await API.call('hub_get_status');
            if (result) {
                const changed = this._checkChanged(result);
                this.status = result;
                if (changed) {
                    this._notifyCallbacks();
                }
                this.updateStatusBar();
            }
        } catch (e) {
            console.warn('DeviceHub refresh error:', e);
        }
    },
    
    /**
     * 检查状态是否变化
     */
    _checkChanged(newStatus) {
        const oldInfo = this.status?.serial?.info || {};
        const nextInfo = newStatus?.serial?.info || {};
        const oldIdentity = [
            oldInfo.port || '',
            oldInfo.transport || '',
            oldInfo.model_name || oldInfo.model || '',
            oldInfo.device_id ?? '',
            oldInfo.app_crc ?? '',
            oldInfo.sw_version ?? '',
            oldInfo.hw_version ?? ''
        ].join('|');
        const nextIdentity = [
            nextInfo.port || '',
            nextInfo.transport || '',
            nextInfo.model_name || nextInfo.model || '',
            nextInfo.device_id ?? '',
            nextInfo.app_crc ?? '',
            nextInfo.sw_version ?? '',
            nextInfo.hw_version ?? ''
        ].join('|');

        return this.status.serial.connected !== newStatus.serial.connected ||
               this.status.slipway.connected !== newStatus.slipway.connected ||
               this.status.rotary.connected !== newStatus.rotary.connected ||
               oldIdentity !== nextIdentity;
    },
    
    /**
     * 注册状态变化回调
     */
    onStatusChange(callback) {
        if (!this._callbacks.includes(callback)) {
            this._callbacks.push(callback);
        }
    },
    
    /**
     * 移除回调
     */
    offStatusChange(callback) {
        const idx = this._callbacks.indexOf(callback);
        if (idx >= 0) this._callbacks.splice(idx, 1);
    },
    
    /**
     * 通知回调
     */
    _notifyCallbacks() {
        this._callbacks.forEach(cb => {
            try { cb(this.status); } catch (e) { console.error(e); }
        });
    },
    
    /**
     * 更新顶部状态栏
     */
    updateStatusBar() {
        // 串口状态
        const serialDot = document.getElementById('hub-serial-dot');
        const serialText = document.getElementById('hub-serial-text');
        if (serialDot && serialText) {
            serialDot.className = 'status-dot' + (this.status.serial.connected ? ' on' : '');
            serialText.textContent = this.status.serial.connected ? 
                (this.status.serial.info.port || '已连接') : '未连接';
                
            // 强制添加动画样式
            if (this.status.serial.connected) {
                serialDot.style.color = '#00ff88';
                serialDot.style.textShadow = '0 0 8px #00ff88, 0 0 12px #00ff88';
                serialDot.style.animation = 'pulse-glow 2s infinite';
            } else {
                serialDot.style.color = '';
                serialDot.style.textShadow = '';
                serialDot.style.animation = '';
            }
        }
        
        // 滑台/转靶状态（同一控制器，合并显示）
        const slipwayDot = document.getElementById('hub-slipway-dot');
        const slipwayText = document.getElementById('hub-slipway-text');
        if (slipwayDot && slipwayText) {
            const isOn = this.status.slipway.connected;
            slipwayDot.className = 'status-dot' + (isOn ? ' on' : '');
            if (isOn) {
                slipwayDot.style.color = '#84fab0';
                slipwayDot.style.textShadow = '0 0 8px #84fab0';
                slipwayDot.style.animation = 'breathe 2s ease-in-out infinite';
            } else {
                slipwayDot.style.color = '';
                slipwayDot.style.textShadow = '';
                slipwayDot.style.animation = '';
            }
            slipwayText.textContent = isOn ? '已连接' : '未连接';
        }

        // 滑台位置 / 转靶反射率（从后端实时取，避免仅靠连接状态）
        this.updateSlipwayInfoBar();
        
        // 设备信息
        this.updateDeviceInfoBar();
    },

    async updateSlipwayInfoBar() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = (val === undefined || val === null || val === '') ? '--' : val;
        };

        if (!this.status.slipway.connected && !this.simulationEnabled) {
            setVal('hub-slipway-pos', '--');
            setVal('hub-rotary-ref', '--');
            return;
        }

        try {
            const slipway = await API.slipway.getStatus();
            if (slipway && slipway.connected) {
                const pos = typeof slipway.position === 'number' ? slipway.position.toFixed(3) : (slipway.position || '0.000');
                setVal('hub-slipway-pos', pos);
            } else {
                setVal('hub-slipway-pos', '--');
            }
        } catch (e) {
            setVal('hub-slipway-pos', '--');
        }

        try {
            const rotary = await API.slipway.rotaryGetStatus();
            if (rotary && rotary.connected) {
                const ref = rotary.reflectance || rotary.reflect || rotary.position;
                setVal('hub-rotary-ref', ref);
            } else {
                setVal('hub-rotary-ref', '--');
            }
        } catch (e) {
            setVal('hub-rotary-ref', '--');
        }
    },
    
    /**
     * 更新顶部设备信息栏
     */
    updateDeviceInfoBar() {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val || '--';
        };

        // 优先从后端 DeviceHub 状态拿设备信息（无需进入校准页也能显示）
        try {
            const info = this.status?.serial?.info || {};
            const has = (k) => info && info[k] !== undefined && info[k] !== null && info[k] !== '';
            if (has('model_name') || has('model') || has('device_id') || has('app_crc')) {
                const model = info.model_name || info.model || '--';
                const did = info.device_id;
                const sw = info.sw_version;
                const hw = info.hw_version;
                setVal('hub-dev-model', model);
                setVal('hub-dev-id', (typeof did === 'number') ? did.toString(16).toUpperCase() : (did || '--'));
                setVal('hub-dev-sw', (typeof sw === 'number') ? ('0x' + sw.toString(16).toUpperCase().padStart(4, '0')) : (sw || '--'));
                setVal('hub-dev-hw', (typeof hw === 'number') ? (hw / 256).toFixed(1) : (hw || '--'));
                setVal('hub-dev-flash', info.flash_size ? (info.flash_size / 1024) + 'KB' : '--');
                setVal('hub-dev-app', info.app_start ? '0x' + Number(info.app_start).toString(16).toUpperCase() : '--');
                setVal('hub-dev-crc', info.app_crc ? '0x' + Number(info.app_crc).toString(16).toUpperCase() : '--');
                return;
            }
        } catch (e) {}

        // 回退：从校准模块获取设备信息
        if (window.CalibrationPageV2 && CalibrationPageV2.devices && CalibrationPageV2.devices.length > 0) {
            const dev = CalibrationPageV2.devices[0];
            setVal('hub-dev-model', dev.model_name || dev.model || '--');
            setVal('hub-dev-id', dev.device_id ? dev.device_id.toString(16).toUpperCase() : '--');
            setVal('hub-dev-sw', dev.sw_version ? '0x' + dev.sw_version.toString(16).toUpperCase().padStart(4, '0') : '--');
            setVal('hub-dev-hw', dev.hw_version ? (dev.hw_version / 256).toFixed(1) : '--');
            setVal('hub-dev-flash', dev.flash_size ? (dev.flash_size / 1024) + 'KB' : '--');
            setVal('hub-dev-app', dev.app_start ? '0x' + dev.app_start.toString(16).toUpperCase() : '--');
            setVal('hub-dev-crc', dev.app_crc ? '0x' + dev.app_crc.toString(16).toUpperCase() : '--');
        }
    },

    getSerialTransport() {
        const info = this.status?.serial?.info || {};
        if (info.transport) return info.transport;
        if (String(info.port || '').startsWith('tcp://')) return 'tcp';
        return 'serial';
    },

    getPreferredTcpSerialPort() {
        const livePort = this.status?.serial?.info?.port || '';
        if (String(livePort).startsWith('tcp://')) return String(livePort);
        try {
            const ip = (localStorage.getItem('hub_serial_tcp_ip') || localStorage.getItem('cal_tcp_ip') || '').trim();
            const port = (localStorage.getItem('hub_serial_tcp_port') || localStorage.getItem('cal_tcp_port') || '7000').trim();
            if (ip && port) return `tcp://${ip}:${port}`;
        } catch (e) {}
        return '';
    },

    isTcpSerialBridgeActive() {
        return !!(this.status?.serial?.connected && this.getSerialTransport() === 'tcp');
    },
    
    /**
     * 自动扫描串口设备
     */
    async autoScan(force = true) {
        const preferredTcp = (!this.status?.serial?.connected) && ((localStorage.getItem('hub_serial_mode') || 'local') === 'tcp');
        const bridgePort = (this.isTcpSerialBridgeActive() || preferredTcp) ? this.getPreferredTcpSerialPort() : '';
        if (this.isTcpSerialBridgeActive() || preferredTcp) {
            if (!bridgePort) {
                Utils.toast('桥接扫描需要先配置 tcp://IP:端口', 'warning');
                return;
            }
            Utils.toast(`正在通过网络串口桥接扫描设备 (${bridgePort})...`, 'info');
        } else {
            Utils.toast('正在扫描设备...', 'info');
        }
        // 调用校准模块的自动扫描
        if (window.CalibrationPageV2) {
            await CalibrationPageV2.autoScan(force);
            // 扫描完成后更新状态栏和设备信息
            await this.refresh();
            this.updateDeviceInfoBar();
            // 注意：CalibrationPageV2.autoScan() 已经显示了 toast，这里不再重复
        } else {
            // 直接调用API
            const result = await API.call('cal_auto_scan', 115200, bridgePort || '');
            if (result && result.success) {
                Utils.toast(`发现 ${result.devices?.length || 0} 台设备`, 'success');
            } else {
                Utils.toast(result?.error || '未找到设备', 'warning');
            }
            await this.refresh();
        }
    },
    
    // ==================== 串口设备 ====================
    
    /**
     * 连接串口
     */
    async connectSerial(port, baudrate = 115200) {
        const result = await API.call('hub_connect_serial', port, baudrate);
        await this.refresh();
        return result;
    },
    
    /**
     * 断开串口
     */
    async disconnectSerial() {
        const result = await API.call('hub_disconnect_serial');
        await this.refresh();
        return result;
    },
    
    /**
     * 发送串口命令
     */
    async serialSend(command) {
        return await API.call('hub_serial_send', command);
    },
    
    /**
     * 扫描串口
     */
    async scanPorts() {
        return await API.call('hub_scan_serial_ports');
    },

    async loadSerialPortsIntoDialog() {
        const select = document.getElementById('hub-serial-port');
        if (!select) return;

        select.innerHTML = '<option value="">选择串口...</option>';
        try {
            const ports = await this.scanPorts();
            if (!ports?.success && ports?.error) {
                select.innerHTML = `<option value="">${ports.error}</option>`;
                return;
            }

            (ports?.ports || []).forEach(p => {
                select.innerHTML += `<option value="${p.device}">${p.device} - ${p.description}</option>`;
            });
        } catch (e) {
            select.innerHTML = '<option value="">获取串口失败</option>';
        }
    },
    
    // ==================== 滑台控制 ====================
    
    /**
     * 连接滑台
     */
    async connectSlipway(ip, port = 6000) {
        const result = await API.call('hub_connect_slipway', ip, port);
        await this.refresh();
        return result;
    },
    
    /**
     * 断开滑台
     */
    async disconnectSlipway() {
        const result = await API.call('hub_disconnect_slipway');
        await this.refresh();
        return result;
    },
    
    /**
     * 滑台移动
     */
    async slipwayMove(position) {
        return await API.call('hub_slipway_move', position);
    },
    
    /**
     * 滑台回零
     */
    async slipwayHome() {
        return await API.call('hub_slipway_home');
    },
    
    /**
     * 滑台停止
     */
    async slipwayStop() {
        return await API.call('hub_slipway_stop');
    },
    
    /**
     * 获取滑台位置
     */
    async slipwayGetPosition() {
        return await API.call('hub_slipway_get_position');
    },
    
    // ==================== 转靶控制 ====================
    
    /**
     * 连接转靶
     */
    async connectRotary(ip, port = 6000) {
        const result = await API.call('hub_connect_rotary', ip, port);
        await this.refresh();
        return result;
    },
    
    /**
     * 断开转靶
     */
    async disconnectRotary() {
        const result = await API.call('hub_disconnect_rotary');
        await this.refresh();
        return result;
    },
    
    /**
     * 设置反射率
     */
    async rotarySetRef(reflectance) {
        return await API.call('hub_rotary_set_ref', reflectance);
    },
    
    /**
     * 转靶回零
     */
    async rotaryHome() {
        return await API.call('hub_rotary_home');
    },
    
    /**
     * 获取当前反射率
     */
    async rotaryGetRef() {
        return await API.call('hub_rotary_get_ref');
    },
    
    // ==================== 便捷方法 ====================
    
    /**
     * 断开所有设备
     */
    async disconnectAll() {
        const result = await API.call('hub_disconnect_all');
        await this.refresh();
        return result;
    },
    
    /**
     * 串口是否已连接
     */
    isSerialConnected() {
        return this.status.serial.connected;
    },
    
    /**
     * 滑台是否已连接
     */
    isSlipwayConnected() {
        return this.status.slipway.connected;
    },
    
    /**
     * 转靶是否已连接
     */
    isRotaryConnected() {
        return this.status.rotary.connected;
    },
    
    // ==================== 连接对话框 ====================
    
    currentDialogType: null,
    
    /**
     * 显示连接对话框
     */
    async showConnectDialog(type) {
        this.currentDialogType = type;
        const overlay = document.getElementById('hub-dialog-overlay');
        const title = document.getElementById('hub-dialog-title');
        const body = document.getElementById('hub-dialog-body');
        
        if (!overlay || !title || !body) return;
        
        // 滑台和转靶是同一控制器，统一处理
        const isMotion = (type === 'slipway' || type === 'rotary');
        const isConnected = type === 'serial' ? this.isSerialConnected() :
                           (this.isSlipwayConnected() || this.isRotaryConnected());
        
        const titles = { serial: '串口连接', slipway: '滑台/转靶连接', rotary: '滑台/转靶连接' };
        title.textContent = titles[type] || '设备连接';
        
        if (type === 'serial') {
            const bridgeConnected = this.isTcpSerialBridgeActive();
            const savedMode = bridgeConnected ? 'tcp' : (localStorage.getItem('hub_serial_mode') || 'local'); // local | tcp
            const savedTcpIp = localStorage.getItem('hub_serial_tcp_ip') || '';
            const savedTcpPort = localStorage.getItem('hub_serial_tcp_port') || '7000';
            let portOptions = '';

            if (savedMode !== 'tcp') {
                const ports = await this.scanPorts();
                portOptions = (ports?.ports || []).map(p =>
                    `<option value="${p.device}">${p.device} - ${p.description}</option>`
                ).join('');
            }
            
            body.innerHTML = isConnected ? `
                <div style="text-align: center; padding: 10px 0;">
                    <div style="color: var(--accent); font-size: 14px; margin-bottom: 8px;">● 已连接</div>
                    <div style="color: var(--text-muted); font-size: 12px;">${this.status.serial.info.port || ''}</div>
                </div>
                <div class="btn-row">
                    <button class="btn danger" onclick="DeviceHub.doDisconnect('serial')">断开连接</button>
                </div>
            ` : `
                <div class="input-group">
                    <label>连接方式</label>
                    <select id="hub-serial-mode" onchange="DeviceHub.onSerialModeChanged(this.value)">
                        <option value="local" ${savedMode === 'local' ? 'selected' : ''}>本机串口 (COM)</option>
                        <option value="tcp" ${savedMode === 'tcp' ? 'selected' : ''}>网络串口桥接 (TCP)</option>
                    </select>
                </div>

                <div id="hub-serial-local-group" style="${savedMode === 'tcp' ? 'display:none;' : ''}">
                <div class="input-group">
                    <label>选择串口</label>
                    <select id="hub-serial-port">
                        <option value="">选择串口...</option>
                        ${portOptions}
                    </select>
                </div>
                </div>

                <div id="hub-serial-tcp-group" style="${savedMode === 'local' ? 'display:none;' : ''}">
                    <div class="input-group">
                        <label>远端IP</label>
                        <input type="text" id="hub-serial-tcp-ip" value="${savedTcpIp}" placeholder="192.168.1.50">
                    </div>
                    <div class="input-group">
                        <label>远端端口</label>
                        <input type="number" id="hub-serial-tcp-port" value="${savedTcpPort}" placeholder="7000">
                    </div>
                    <div style="color: var(--text-muted); font-size: 12px; margin: -6px 0 8px 0;">
                        将连接到 <code>tcp://IP:端口</code>
                    </div>
                </div>

                <div class="input-group">
                    <label>波特率</label>
                    <select id="hub-serial-baud">
                        <option value="115200" selected>115200</option>
                        <option value="9600">9600</option>
                        <option value="57600">57600</option>
                    </select>
                </div>
                <div class="btn-row">
                    <button class="btn" onclick="DeviceHub.hideConnectDialog()">取消</button>
                    <button class="btn primary" onclick="DeviceHub.doConnect('serial')">连接</button>
                </div>
            `;

            if (!isConnected && savedMode !== 'tcp') {
                await this.loadSerialPortsIntoDialog();
            }
        } else {
            // 滑台/转靶连接 (TCP)
            const savedIp = localStorage.getItem('hub_tcp_ip') || '192.168.2.46';
            const savedPort = localStorage.getItem('hub_tcp_port') || '6000';

            // 读取当前工位/工装配置（模块化配置入口）
            let stationId = null;
            let stations = {};
            let toolProfileId = null;
            let toolSlipway = null;
            try {
                if (window.API && API.settings) {
                    const s = await API.settings.stationList();
                    stationId = s?.current_station_id || null;
                    stations = s?.stations || {};

                    const tp = await API.settings.toolProfileGet(null);
                    toolProfileId = tp?.profile_id || null;
                    toolSlipway = (tp?.profile && tp.profile.slipway) ? tp.profile.slipway : null;
                }
            } catch (e) {}

            // 缓存供“使用工装IP”按钮使用
            this._motionToolProfileCache = { toolProfileId, toolSlipway, stationId };

            const stationOptions = (() => {
                try {
                    const ids = Object.keys(stations || {});
                    if (!ids.length) return '';
                    return ids.map(id => {
                        const s = stations[id] || {};
                        const label = s.name ? `${s.name}` : id;
                        const selected = (id === stationId) ? 'selected' : '';
                        return `<option value="${id}" ${selected}>${label}</option>`;
                    }).join('');
                } catch (e) {
                    return '';
                }
            })();

            const toolHint = toolProfileId ? `工装: <b>${toolProfileId}</b>` : `工装: <b>--</b>`;
             
            body.innerHTML = isConnected ? `
                <div style="text-align: center; padding: 10px 0;">
                    <div style="color: var(--accent); font-size: 14px; margin-bottom: 8px;">● 已连接</div>
                    <div style="color: var(--text-muted); font-size: 12px;">${this.status[type].info.ip || ''}:${this.status[type].info.port || ''}</div>
                </div>
                <div class="btn-row">
                    <button class="btn danger" onclick="DeviceHub.doDisconnect('${type}')">断开连接</button>
                </div>
            ` : `
                ${stationOptions ? `
                <div class="input-group">
                    <label>工位</label>
                    <select id="hub-station-select" onchange="DeviceHub.onMotionStationChanged(this.value)">
                        ${stationOptions}
                    </select>
                </div>
                ` : ''}
                <div style="display:flex; align-items:center; gap:10px; margin: -4px 0 10px 0;">
                    <div style="flex:1; color: var(--text-muted); font-size: 12px;">${toolHint}${stationId ? ` <span style="opacity:.7;">(工位: ${stationId})</span>` : ''}</div>
                    <button class="btn" onclick="DeviceHub.fillMotionFromToolProfile()" style="min-width: 110px;">使用工装IP</button>
                </div>
                <div class="input-group">
                    <label>IP地址</label>
                    <input type="text" id="hub-tcp-ip" value="${savedIp}" placeholder="192.168.2.46">
                </div>
                <div class="input-group">
                    <label>端口</label>
                    <input type="number" id="hub-tcp-port" value="${savedPort}" placeholder="6000">
                </div>
                <div class="btn-row">
                    <button class="btn" onclick="DeviceHub.hideConnectDialog()">取消</button>
                    <button class="btn primary" onclick="DeviceHub.doConnect('${type}')">连接</button>
                </div>
            `;
        }
        
        overlay.classList.add('show');
    },
    
    /**
     * 隐藏连接对话框
     */
    hideConnectDialog() {
        const overlay = document.getElementById('hub-dialog-overlay');
        if (overlay) overlay.classList.remove('show');
    },
    
    /**
     * 执行连接
     */
    async doConnect(type) {
        let result;
        
        if (type === 'serial') {
            const mode = (document.getElementById('hub-serial-mode')?.value) || (localStorage.getItem('hub_serial_mode') || 'local');
            let port = '';
            if (mode === 'tcp') {
                const ip = (document.getElementById('hub-serial-tcp-ip')?.value || '').trim();
                const tcpPort = parseInt(document.getElementById('hub-serial-tcp-port')?.value || '7000') || 7000;
                if (!ip) {
                    Utils.toast('请输入远端IP', 'warning');
                    return;
                }
                localStorage.setItem('hub_serial_tcp_ip', ip);
                localStorage.setItem('hub_serial_tcp_port', String(tcpPort));
                port = `tcp://${ip}:${tcpPort}`;
            } else {
                port = document.getElementById('hub-serial-port').value;
            }
            const baud = parseInt(document.getElementById('hub-serial-baud').value);
            if (!port) {
                Utils.toast('请选择串口', 'warning');
                return;
            }
            result = await this.connectSerial(port, baud);
        } else {
            // 滑台和转靶是同一控制器：只连接滑台即可
            const ip = document.getElementById('hub-tcp-ip').value;
            const port = parseInt(document.getElementById('hub-tcp-port').value) || 6000;
            if (!ip) {
                Utils.toast('请输入IP地址', 'warning');
                return;
            }
            // 保存设置
            localStorage.setItem('hub_tcp_ip', ip);
            localStorage.setItem('hub_tcp_port', port);
            
            // 连接滑台
            result = await this.connectSlipway(ip, port);
        }
        
        if (result.success) {
            Utils.toast('连接成功', 'success');
            this.hideConnectDialog();
        } else {
            Utils.toast('连接失败: ' + (result.error || ''), 'error');
        }
    },

    async onSerialModeChanged(mode) {
        try {
            localStorage.setItem('hub_serial_mode', mode || 'local');
            const localGroup = document.getElementById('hub-serial-local-group');
            const tcpGroup = document.getElementById('hub-serial-tcp-group');
            if (localGroup) localGroup.style.display = (mode === 'tcp') ? 'none' : '';
            if (tcpGroup) tcpGroup.style.display = (mode === 'local') ? 'none' : '';
            if (mode !== 'tcp') {
                await this.loadSerialPortsIntoDialog();
            }
        } catch (e) {
            // ignore
        }
    },

    // ==================== 工位/工装（滑台/转靶） ====================

    async onMotionStationChanged(stationId) {
        try {
            if (!stationId) return;
            if (!(window.API && API.settings)) return;

            const setRes = await API.settings.stationSetCurrent(stationId);
            if (!setRes || !setRes.success) {
                Utils.toast(setRes?.message || '切换工位失败', 'error');
                return;
            }

            // 切换工位后立即拉取工装配置，并填充到IP/端口输入
            const tp = await API.settings.toolProfileGet(null);
            const toolProfileId = tp?.profile_id || null;
            const toolSlipway = (tp?.profile && tp.profile.slipway) ? tp.profile.slipway : null;
            this._motionToolProfileCache = { toolProfileId, toolSlipway, stationId };
            this._applyMotionToolProfileToInputs(toolSlipway);

            Utils.toast(`已切换工位: ${stationId}`, 'success');
        } catch (e) {
            Utils.toast('切换工位异常: ' + (e?.message || e), 'error');
        }
    },

    fillMotionFromToolProfile() {
        try {
            const toolSlipway = this._motionToolProfileCache?.toolSlipway || null;
            if (!toolSlipway || !toolSlipway.ip || !toolSlipway.port) {
                Utils.toast('当前工装未配置滑台IP/端口，请到 设置 里配置', 'warning');
                return;
            }
            this._applyMotionToolProfileToInputs(toolSlipway);
            Utils.toast('已填充工装IP/端口', 'success', 1200);
        } catch (e) {
            Utils.toast('填充失败: ' + (e?.message || e), 'error');
        }
    },

    _applyMotionToolProfileToInputs(toolSlipway) {
        try {
            const ipEl = document.getElementById('hub-tcp-ip');
            const portEl = document.getElementById('hub-tcp-port');
            if (ipEl && toolSlipway?.ip) ipEl.value = String(toolSlipway.ip);
            if (portEl && toolSlipway?.port) portEl.value = String(toolSlipway.port);
        } catch (e) {}
    },
    
    /**
     * 执行断开
     */
    async doDisconnect(type) {
        if (type === 'serial') {
            await this.disconnectSerial();
        } else {
            // 滑台和转靶共用同一连接：只断开滑台即可
            await this.disconnectSlipway();
        }
        Utils.toast('已断开', 'info');
        this.hideConnectDialog();
    }
};

// 暴露到全局
window.DeviceHub = DeviceHub;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，等待API准备好
    setTimeout(() => DeviceHub.init(), 500);
});
