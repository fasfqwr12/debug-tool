/**
 * 升降控制模块
 * 正运动控制卡 ZMC 系列
 */

const LiftControl = {
    connected: false,
    positionTimer: null,
    statusTimer: null,
    
    // 初始化
    init() {
        console.log('LiftControl init');
        this.loadSettings();
        this.bindEvents();
    },
    
    // 绑定事件
    bindEvents() {
        // 速度滑块同步
        document.getElementById('param-speed')?.addEventListener('input', () => this.updateSpeedDisplay());
        document.getElementById('param-accel')?.addEventListener('input', () => this.updateAccelDisplay());
        document.getElementById('param-decel')?.addEventListener('input', () => this.updateDecelDisplay());
        document.getElementById('param-jog-speed')?.addEventListener('input', () => this.updateJogSpeedDisplay());
    },
    
    // 加载保存的设置
    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('lift_settings') || '{}');
        if (settings.ip) document.getElementById('ctrl-ip').value = settings.ip;
        if (settings.axis) document.getElementById('ctrl-axis').value = settings.axis;
        if (settings.speed) {
            document.getElementById('param-speed').value = settings.speed;
            document.getElementById('param-speed-input').value = settings.speed;
        }
        if (settings.accel) {
            document.getElementById('param-accel').value = settings.accel;
            document.getElementById('param-accel-input').value = settings.accel;
        }
        if (settings.units) document.getElementById('param-units').value = settings.units;
        this.updateSpeedDisplay();
        this.updateAccelDisplay();
        this.updateDecelDisplay();
        this.updateJogSpeedDisplay();
    },
    
    // 保存设置
    saveSettings() {
        const settings = {
            ip: document.getElementById('ctrl-ip').value,
            axis: document.getElementById('ctrl-axis').value,
            speed: document.getElementById('param-speed').value,
            accel: document.getElementById('param-accel').value,
            decel: document.getElementById('param-decel').value,
            units: document.getElementById('param-units').value,
        };
        localStorage.setItem('lift_settings', JSON.stringify(settings));
    },
    
    // 连接控制器
    async connect() {
        const ip = document.getElementById('ctrl-ip').value;
        if (!ip) {
            this.log('请输入控制器IP地址', 'error');
            Utils.toast('请输入控制器IP地址', 'warning');
            return;
        }
        
        this.log(`正在连接 ${ip}...`, 'info');
        Utils.toast(`正在连接 ${ip}...`, 'info');
        
        try {
            const result = await API.call('lift_connect', ip);
            if (result.success) {
                this.connected = true;
                this.updateConnectionUI(true);
                this.log('连接成功', 'success');
                Utils.toast('控制器连接成功', 'success');
                this.saveSettings();
                
                // 应用参数
                await this.applyParams();
                
                // 开始位置刷新
                this.startPositionUpdate();
            } else {
                this.log(`连接失败: ${result.error}`, 'error');
                Utils.toast(`连接失败: ${result.error}`, 'error');
            }
        } catch (e) {
            this.log(`连接异常: ${e.message}`, 'error');
            Utils.toast(`连接异常: ${e.message}`, 'error');
        }
    },
    
    // 断开连接
    async disconnect() {
        try {
            await API.call('lift_disconnect');
            this.connected = false;
            this.updateConnectionUI(false);
            this.stopPositionUpdate();
            this.log('已断开连接', 'info');
            Utils.toast('已断开连接', 'info');
        } catch (e) {
            this.log(`断开异常: ${e.message}`, 'error');
            Utils.toast(`断开异常: ${e.message}`, 'error');
        }
    },
    
    // 更新连接UI
    updateConnectionUI(connected) {
        const dot = document.getElementById('conn-dot');
        const text = document.getElementById('conn-text');
        const btnConnect = document.getElementById('btn-connect');
        const btnDisconnect = document.getElementById('btn-disconnect');
        
        if (connected) {
            dot.classList.add('connected');
            text.textContent = '已连接';
            btnConnect.disabled = true;
            btnDisconnect.disabled = false;
        } else {
            dot.classList.remove('connected');
            text.textContent = '未连接';
            btnConnect.disabled = false;
            btnDisconnect.disabled = true;
        }
    },
    
    // 应用轴参数
    async applyParams() {
        if (!this.connected) {
            this.log('请先连接控制器', 'error');
            Utils.toast('请先连接控制器', 'warning');
            return;
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        const atype = parseInt(document.getElementById('param-atype').value);
        const units = parseFloat(document.getElementById('param-units').value);
        const speed = parseFloat(document.getElementById('param-speed-input').value);
        const accel = parseFloat(document.getElementById('param-accel-input').value);
        const decel = parseFloat(document.getElementById('param-decel-input').value);
        
        try {
            const result = await API.call('lift_config_axis', {
                axis, atype, units, speed, accel, decel
            });
            if (result.success) {
                this.log(`轴参数已应用: 速度=${speed}, 加速度=${accel}`, 'success');
                Utils.toast('轴参数已应用', 'success');
                this.saveSettings();
            } else {
                this.log(`参数设置失败: ${result.error}`, 'error');
                Utils.toast(`参数设置失败: ${result.error}`, 'error');
            }
        } catch (e) {
            this.log(`参数设置异常: ${e.message}`, 'error');
            Utils.toast(`参数设置异常`, 'error');
        }
    },
    
    // 绝对运动
    async moveTo(position) {
        if (!this.connected) {
            this.log('请先连接控制器', 'error');
            Utils.toast('请先连接控制器', 'warning');
            return;
        }
        
        if (position === undefined) {
            position = parseFloat(document.getElementById('target-pos').value);
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        this.log(`移动到 ${position} mm`, 'info');
        Utils.toast(`正在移动到 ${position} mm`, 'info');
        
        try {
            const result = await API.call('lift_move_abs', axis, position);
            if (!result.success) {
                this.log(`运动失败: ${result.error}`, 'error');
                Utils.toast(`运动失败: ${result.error}`, 'error');
            }
        } catch (e) {
            this.log(`运动异常: ${e.message}`, 'error');
            Utils.toast(`运动异常`, 'error');
        }
    },
    
    // JOG开始
    async jogStart(direction) {
        if (!this.connected) return;
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        const speed = parseFloat(document.getElementById('param-jog-speed-input').value);
        
        try {
            // 先设置JOG速度
            await API.call('lift_set_jog_speed', axis, speed);
            // 开始JOG
            await API.call('lift_jog', axis, direction);
        } catch (e) {
            this.log(`JOG异常: ${e.message}`, 'error');
        }
    },
    
    // JOG停止
    async jogStop() {
        if (!this.connected) return;
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        try {
            await API.call('lift_stop', axis, 0);  // 减速停止
        } catch (e) {
            console.error('JOG停止异常:', e);
        }
    },
    
    // 停止
    async stop() {
        if (!this.connected) {
            this.log('未连接', 'error');
            Utils.toast('未连接控制器', 'warning');
            return;
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        this.log('停止运动', 'info');
        Utils.toast('停止运动', 'warning');
        
        try {
            await API.call('lift_stop', axis, 2);  // 急停
        } catch (e) {
            this.log(`停止异常: ${e.message}`, 'error');
        }
    },
    
    // 回零
    async home() {
        if (!this.connected) {
            this.log('请先连接控制器', 'error');
            Utils.toast('请先连接控制器', 'warning');
            return;
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        const datumIn = parseInt(document.getElementById('home-input').value);
        const mode = parseInt(document.getElementById('home-mode').value);
        
        this.log(`执行回零: 原点输入IN${datumIn}, 模式${mode}`, 'info');
        Utils.toast('正在执行回零...', 'info');
        
        try {
            const result = await API.call('lift_home', axis, datumIn, mode);
            if (result.success) {
                this.log('回零命令已发送', 'success');
                Utils.toast('回零命令已发送', 'success');
            } else {
                this.log(`回零失败: ${result.error}`, 'error');
                Utils.toast(`回零失败: ${result.error}`, 'error');
            }
        } catch (e) {
            this.log(`回零异常: ${e.message}`, 'error');
            Utils.toast('回零异常', 'error');
        }
    },
    
    // 设为零点
    async setZero() {
        if (!this.connected) {
            this.log('请先连接控制器', 'error');
            Utils.toast('请先连接控制器', 'warning');
            return;
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        
        try {
            const result = await API.call('lift_set_zero', axis);
            if (result.success) {
                this.log('已设置当前位置为零点', 'success');
                Utils.toast('已设置当前位置为零点', 'success');
            } else {
                this.log(`设置失败: ${result.error}`, 'error');
                Utils.toast(`设置失败: ${result.error}`, 'error');
            }
        } catch (e) {
            this.log(`设置异常: ${e.message}`, 'error');
            Utils.toast('设置异常', 'error');
        }
    },
    
    // 应用限位
    async applyLimits() {
        if (!this.connected) {
            this.log('请先连接控制器', 'error');
            Utils.toast('请先连接控制器', 'warning');
            return;
        }
        
        const axis = parseInt(document.getElementById('ctrl-axis').value);
        const posLimit = parseFloat(document.getElementById('limit-pos').value);
        const negLimit = parseFloat(document.getElementById('limit-neg').value);
        const posIn = parseInt(document.getElementById('limit-pos-in').value);
        const negIn = parseInt(document.getElementById('limit-neg-in').value);
        
        try {
            const result = await API.call('lift_set_limits', {
                axis, posLimit, negLimit, posIn, negIn
            });
            if (result.success) {
                this.log(`限位已设置: [${negLimit}, ${posLimit}]`, 'success');
                Utils.toast(`限位已设置: [${negLimit}, ${posLimit}]`, 'success');
            } else {
                this.log(`限位设置失败: ${result.error}`, 'error');
                Utils.toast(`限位设置失败`, 'error');
            }
        } catch (e) {
            this.log(`限位设置异常: ${e.message}`, 'error');
            Utils.toast('限位设置异常', 'error');
        }
    },
    
    // 速度设置
    async setSpeed(value) {
        document.getElementById('param-speed').value = value;
        document.getElementById('param-speed-input').value = value;
        document.getElementById('speed-val').textContent = value;
        
        if (this.connected) {
            const axis = parseInt(document.getElementById('ctrl-axis').value);
            await API.call('lift_set_speed', axis, parseFloat(value));
        }
    },
    
    // 加速度设置
    async setAccel(value) {
        document.getElementById('param-accel').value = value;
        document.getElementById('param-accel-input').value = value;
        document.getElementById('accel-val').textContent = value;
        
        if (this.connected) {
            const axis = parseInt(document.getElementById('ctrl-axis').value);
            await API.call('lift_set_accel', axis, parseFloat(value));
        }
    },
    
    // 减速度设置
    async setDecel(value) {
        document.getElementById('param-decel').value = value;
        document.getElementById('param-decel-input').value = value;
        document.getElementById('decel-val').textContent = value;
        
        if (this.connected) {
            const axis = parseInt(document.getElementById('ctrl-axis').value);
            await API.call('lift_set_decel', axis, parseFloat(value));
        }
    },
    
    // JOG速度设置
    setJogSpeed(value) {
        document.getElementById('param-jog-speed').value = value;
        document.getElementById('param-jog-speed-input').value = value;
        document.getElementById('jog-speed-val').textContent = value;
    },
    
    // 更新速度显示
    updateSpeedDisplay() {
        const val = document.getElementById('param-speed').value;
        document.getElementById('speed-val').textContent = val;
        document.getElementById('param-speed-input').value = val;
    },
    
    updateAccelDisplay() {
        const val = document.getElementById('param-accel').value;
        document.getElementById('accel-val').textContent = val;
        document.getElementById('param-accel-input').value = val;
    },
    
    updateDecelDisplay() {
        const val = document.getElementById('param-decel').value;
        document.getElementById('decel-val').textContent = val;
        document.getElementById('param-decel-input').value = val;
    },
    
    updateJogSpeedDisplay() {
        const val = document.getElementById('param-jog-speed').value;
        document.getElementById('jog-speed-val').textContent = val;
        document.getElementById('param-jog-speed-input').value = val;
    },
    
    // 开始位置更新
    startPositionUpdate() {
        this.stopPositionUpdate();
        this.positionTimer = setInterval(() => this.updatePosition(), 500);  // 500ms（原100ms）
        this.statusTimer = setInterval(() => this.updateStatus(), 2000);     // 2秒（原500ms）
    },
    
    // 停止位置更新
    stopPositionUpdate() {
        if (this.positionTimer) {
            clearInterval(this.positionTimer);
            this.positionTimer = null;
        }
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
    },
    
    // 更新位置显示
    async updatePosition() {
        if (!this.connected) return;
        
        try {
            const axis = parseInt(document.getElementById('ctrl-axis').value);
            const result = await API.call('lift_get_position', axis);
            if (result.success) {
                document.getElementById('current-pos').textContent = result.dpos.toFixed(3);
                document.getElementById('st-dpos').textContent = result.dpos.toFixed(3) + ' mm';
                document.getElementById('st-mpos').textContent = result.mpos.toFixed(3) + ' mm';
            }
        } catch (e) {
            // 静默失败
        }
    },
    
    // 更新状态显示
    async updateStatus() {
        if (!this.connected) return;
        
        try {
            const axis = parseInt(document.getElementById('ctrl-axis').value);
            const result = await API.call('lift_get_status', axis);
            if (result.success) {
                // 轴状态
                const stAxis = document.getElementById('st-axis');
                stAxis.textContent = result.enabled ? '使能' : '未使能';
                stAxis.className = 'value ' + (result.enabled ? 'ok' : 'warning');
                
                // 运动状态
                const stMotion = document.getElementById('st-motion');
                stMotion.textContent = result.idle ? '静止' : '运动中';
                stMotion.className = 'value ' + (result.idle ? 'ok' : 'warning');
                
                // 速度
                document.getElementById('st-speed').textContent = result.speed.toFixed(1) + ' mm/s';
                
                // 跟随误差
                const stFe = document.getElementById('st-fe');
                stFe.textContent = result.fe.toFixed(3) + ' mm';
                stFe.className = 'value ' + (Math.abs(result.fe) < 0.1 ? 'ok' : 'warning');
            }
        } catch (e) {
            // 静默失败
        }
    },
    
    // 日志
    log(message, type = 'info') {
        const logArea = document.getElementById('log-area');
        if (!logArea) return;
        
        const time = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.innerHTML = `<span class="time">${time}</span>${message}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
        
        // 限制日志数量
        while (logArea.children.length > 100) {
            logArea.removeChild(logArea.firstChild);
        }
    },
    
    // 页面卸载时清理
    destroy() {
        this.stopPositionUpdate();
        if (this.connected) {
            this.disconnect();
        }
    }
};

// 页面加载时初始化
if (typeof window !== 'undefined') {
    window.LiftControl = LiftControl;
}
