/**
 * 动画控制器 v1.0
 * 统一管理所有动画的播放
 * 
 * 功能：
 * - 多个动画同时运行
 * - 运行时参数覆盖（间隔、超时）
 * - 循环/非循环（自动停止）
 * - 启动/停止控制
 * - 组件联动（onSet配置）
 * 
 * 使用示例：
 *   await AnimController.init('gd303_mini');
 *   AnimController.start('laserBlink');
 *   AnimController.startEx('laserBlink', 300, 15000);  // 300ms间隔，15秒超时
 *   AnimController.stop('laserBlink');
 */

window.AnimController = {
    // 动画配置
    animations: {},
    
    // 组件配置（用于联动）
    components: {},
    
    // 运行状态
    states: {},
    
    // 定时器
    timer: null,
    tickInterval: 10,  // 10ms
    
    // 回调
    callbacks: {
        onAnimStart: null,
        onAnimEnd: null,
        onFrameChange: null,
        onBufferUpdate: null,
        onHardware: null  // 硬件回调
    },
    
    // ========== 初始化 ==========
    async init(deviceId) {
        console.log('[AnimController] 初始化');
        
        try {
            // 加载动画配置
            const animData = await DeviceConfigManager.loadConfig('animations');
            this.animations = animData?.animations || {};
            
            // 加载组件配置（用于联动）
            const compData = await DeviceConfigManager.loadConfig('components');
            this.components = compData?.components || {};
            
            // 初始化所有动画状态
            for (const id of Object.keys(this.animations)) {
                this.states[id] = this._createState();
            }
            
            // 启动定时器
            this._startTimer();
            
            console.log('[AnimController] 加载动画:', Object.keys(this.animations).length);
            console.log('[AnimController] 加载组件:', Object.keys(this.components).length);
        } catch (e) {
            console.warn('[AnimController] 初始化失败:', e);
            this.animations = {};
            this.components = {};
        }
    },
    
    _createState() {
        return {
            running: false,
            frameIdx: 0,
            tickCount: 0,
            intervalMs: 0,      // 运行时间隔（0=用配置值）
            timeoutMs: 0,       // 超时时间（0=不超时）
            totalTime: 0        // 已运行总时间
        };
    },
    
    _startTimer() {
        if (this.timer) return;
        this.timer = setInterval(() => this._tick(), this.tickInterval);
    },
    
    _stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    },
    
    // ========== 基础API ==========
    
    /**
     * 启动动画（用配置的默认参数）
     * @param {string} animId - 动画ID
     */
    start(animId) {
        this.startEx(animId, 0, 0);
    },
    
    /**
     * 启动动画（扩展参数）
     * @param {string} animId - 动画ID
     * @param {number} intervalMs - 帧间隔(ms)，0=用配置值
     * @param {number} timeoutMs - 超时自动停止(ms)，0=不超时
     */
    startEx(animId, intervalMs = 0, timeoutMs = 0) {
        if (!this.animations[animId]) {
            console.warn(`[AnimController] 动画不存在: ${animId}`);
            return;
        }
        
        // 确保状态存在
        if (!this.states[animId]) {
            this.states[animId] = this._createState();
        }
        
        const state = this.states[animId];
        state.running = true;
        state.frameIdx = 0;
        state.tickCount = 0;
        state.intervalMs = intervalMs || 0;
        state.timeoutMs = timeoutMs || 0;
        state.totalTime = 0;
        
        // 立即执行第一帧
        this._applyFrame(animId, 0);
        
        // 触发回调
        this.callbacks.onAnimStart?.(animId);
        
        console.log(`[AnimController] 启动: ${animId}, interval=${intervalMs || '默认'}, timeout=${timeoutMs || '无'}`);
    },
    
    /**
     * 停止动画
     * @param {string} animId - 动画ID
     */
    stop(animId) {
        if (this.states[animId]) {
            this.states[animId].running = false;
            this.callbacks.onAnimEnd?.(animId, 'stopped');
            console.log(`[AnimController] 停止: ${animId}`);
        }
    },
    
    /**
     * 停止所有动画
     */
    stopAll() {
        for (const id of Object.keys(this.states)) {
            if (this.states[id].running) {
                this.stop(id);
            }
        }
    },
    
    /**
     * 检查动画是否运行中
     * @param {string} animId - 动画ID
     * @returns {boolean}
     */
    isRunning(animId) {
        return this.states[animId]?.running || false;
    },
    
    /**
     * 获取所有运行中的动画
     * @returns {string[]}
     */
    getRunningAnimations() {
        return Object.entries(this.states)
            .filter(([_, state]) => state.running)
            .map(([id, _]) => id);
    },
    
    // ========== 运行时参数修改 ==========
    
    /**
     * 修改运行中动画的间隔
     * @param {string} animId - 动画ID
     * @param {number} intervalMs - 新间隔(ms)
     */
    setInterval(animId, intervalMs) {
        if (this.states[animId]) {
            this.states[animId].intervalMs = intervalMs;
            console.log(`[AnimController] ${animId} 间隔改为: ${intervalMs}ms`);
        }
    },
    
    /**
     * 修改运行中动画的超时
     * @param {string} animId - 动画ID
     * @param {number} timeoutMs - 新超时(ms)
     */
    setTimeout(animId, timeoutMs) {
        if (this.states[animId]) {
            this.states[animId].timeoutMs = timeoutMs;
            console.log(`[AnimController] ${animId} 超时改为: ${timeoutMs}ms`);
        }
    },
    
    // ========== 定时器回调 ==========
    _tick() {
        for (const [id, state] of Object.entries(this.states)) {
            if (!state.running) continue;
            
            const anim = this.animations[id];
            if (!anim?.frames?.length) continue;
            
            // 更新总时间
            state.totalTime += this.tickInterval;
            
            // 检查超时
            if (state.timeoutMs > 0 && state.totalTime >= state.timeoutMs) {
                state.running = false;
                this.callbacks.onAnimEnd?.(id, 'timeout');
                console.log(`[AnimController] ${id} 超时停止`);
                continue;
            }
            
            // 更新帧计时
            state.tickCount += this.tickInterval;
            
            // 获取当前帧间隔
            const frame = anim.frames[state.frameIdx];
            const duration = state.intervalMs > 0 ? state.intervalMs : (frame.duration || 200);
            
            if (state.tickCount >= duration) {
                state.tickCount = 0;
                state.frameIdx++;
                
                // 检查是否播放完
                if (state.frameIdx >= anim.frames.length) {
                    if (anim.loop !== false) {
                        state.frameIdx = 0;
                    } else {
                        // 非循环动画，自动停止
                        state.running = false;
                        this.callbacks.onAnimEnd?.(id, 'complete');
                        console.log(`[AnimController] ${id} 播放完成`);
                        continue;
                    }
                }
                
                // 执行帧动作
                this._applyFrame(id, state.frameIdx);
            }
        }
    },
    
    // ========== 帧应用 ==========
    _applyFrame(animId, frameIdx) {
        const anim = this.animations[animId];
        const frame = anim?.frames?.[frameIdx];
        if (!frame) return;
        
        // 触发帧变化回调
        this.callbacks.onFrameChange?.(animId, frameIdx, frame);
        
        // 应用组件状态
        if (frame.components && typeof UIStore !== 'undefined') {
            for (const [compName, compState] of Object.entries(frame.components)) {
                this._applyComponentState(compName, compState);
            }
        }
        
        // 应用直接元素
        if (frame.elements && typeof LcdRuntime !== 'undefined') {
            LcdRuntime.setElements?.(frame.elements);
        }
        
        // 应用特殊动作
        if (frame.action) {
            this._applyAction(frame.action);
        }
        
        // 触发缓冲区更新回调
        this.callbacks.onBufferUpdate?.();
    },
    
    _applyComponentState(compName, state) {
        if (typeof UIStore === 'undefined') return;
        
        // Icon组件
        if (state.visible !== undefined) {
            UIStore.set?.(compName, state.visible);
        }
        // Selector组件
        else if (state.value !== undefined) {
            UIStore.set?.(compName, state.value);
        }
        // Line组件
        else if (state.preset) {
            const presets = { dash: '-----', blank: '', error: 'Err' };
            UIStore.set?.(compName, presets[state.preset] || state.preset);
        }
    },
    
    _applyAction(action) {
        if (typeof LcdRuntime === 'undefined') return;
        
        if (action === 'lcd:showAll') {
            LcdRuntime.showAll?.();
        } else if (action === 'lcd:clearAll') {
            LcdRuntime.clearAll?.();
        }
    },
    
    // ========== 事件回调 ==========
    
    /**
     * 注册回调
     * @param {string} event - 事件名: onAnimStart, onAnimEnd, onFrameChange, onBufferUpdate
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(event)) {
            this.callbacks[event] = callback;
        }
    },
    
    /**
     * 移除回调
     * @param {string} event - 事件名
     */
    off(event) {
        if (this.callbacks.hasOwnProperty(event)) {
            this.callbacks[event] = null;
        }
    },
    
    // ========== 销毁 ==========
    destroy() {
        this._stopTimer();
        this.animations = {};
        this.states = {};
        this.callbacks = {
            onAnimStart: null,
            onAnimEnd: null,
            onFrameChange: null,
            onBufferUpdate: null
        };
        console.log('[AnimController] 已销毁');
    },
    
    // ========== 调试 ==========
    getStatus() {
        const running = this.getRunningAnimations();
        return {
            total: Object.keys(this.animations).length,
            running: running.length,
            runningList: running,
            states: this.states
        };
    },
    
    // ========== 组件联动 ==========
    
    /**
     * 处理组件值变化，触发联动动画和硬件回调
     * @param {string} compName - 组件名
     * @param {any} value - 新值
     */
    handleComponentChange(compName, value) {
        const comp = this.components[compName];
        if (!comp?.onSet) return;
        
        // 确定key
        let key;
        if (typeof value === 'boolean') {
            key = value ? 'true' : 'false';
        } else {
            key = String(value);
        }
        
        const actions = comp.onSet[key];
        if (!actions) return;
        
        console.log(`[AnimController] 组件联动: ${compName} = ${value}`);
        
        // 处理动画
        if (actions.anim) {
            const anim = actions.anim;
            if (anim.action === 'stop') {
                this.stop(anim.id);
            } else {
                this.startEx(anim.id, anim.interval || 0, anim.timeout || 0);
            }
        }
        
        // 处理硬件回调
        if (actions.hardware) {
            console.log(`[AnimController] 硬件回调: hw_${actions.hardware}()`);
            this.callbacks.onHardware?.(actions.hardware);
        }
    },
    
    /**
     * 获取组件的联动配置
     * @param {string} compName - 组件名
     * @returns {object|null}
     */
    getComponentTriggers(compName) {
        return this.components[compName]?.onSet || null;
    }
};
