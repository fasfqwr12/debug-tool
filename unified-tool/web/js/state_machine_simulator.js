/**
 * 状态机仿真器 - 实时执行状态机逻辑
 * 
 * 功能:
 * 1. 加载状态机配置并初始化
 * 2. 事件分发和状态转移
 * 3. 动作执行 (LCD、动画、变量、硬件)
 * 4. 定时器管理
 * 5. 调试支持 (断点、单步、日志)
 * 
 * 参考: QP框架的HSM实现
 */

window.StateMachineSimulator = class StateMachineSimulator {
    
    constructor(options = {}) {
        // 配置
        this.stateMachine = null;
        this.lcdRuntime = options.lcdRuntime || null;
        
        // 运行时状态
        this.currentStatePath = [];  // 当前状态路径 ['ROOT', 'ON', 'SINGLE', 'LASER_ON']
        this.variables = {};
        this.timers = {};
        this.running = false;
        this.paused = false;
        
        // 调试
        this.breakpoints = new Set();
        this.eventLog = [];
        this.maxLogSize = 1000;
        this.stepMode = false;
        
        // 回调
        this.onStateChange = options.onStateChange || (() => {});
        this.onVariableChange = options.onVariableChange || (() => {});
        this.onEventLog = options.onEventLog || (() => {});
        this.onHardwareAction = options.onHardwareAction || (() => {});
        this.onBreakpoint = options.onBreakpoint || (() => {});
    }
    
    // ========== 初始化 ==========
    
    /**
     * 加载状态机配置
     */
    load(stateMachine) {
        this.stateMachine = stateMachine;
        this.reset();
        return this;
    }
    
    /**
     * 重置到初始状态
     */
    reset() {
        // 初始化变量
        this.variables = {};
        const vars = this.stateMachine?.variables || {};
        for (const [name, def] of Object.entries(vars)) {
            this.variables[name] = def.default;
        }
        
        // 清空定时器
        this.clearAllTimers();
        
        // 清空日志
        this.eventLog = [];
        
        // 进入初始状态
        this.currentStatePath = [];
        this.running = true;
        this.paused = false;
        
        // 从ROOT开始进入
        this._enterStateHierarchy('ROOT');
        
        this.log('INIT', null, `初始化完成，当前状态: ${this.getCurrentStateId()}`);
    }
    
    // ========== 状态查询 ==========
    
    /**
     * 获取当前状态ID (最深层)
     */
    getCurrentStateId() {
        return this.currentStatePath[this.currentStatePath.length - 1] || 'ROOT';
    }
    
    /**
     * 获取当前状态路径字符串
     */
    getCurrentStatePath() {
        return this.currentStatePath.join('.');
    }
    
    /**
     * 获取当前状态对象
     */
    getCurrentState() {
        return this._findState(this.getCurrentStateId());
    }
    
    /**
     * 检查是否在某个状态中 (包括父状态)
     */
    isInState(stateId) {
        return this.currentStatePath.includes(stateId);
    }
    
    /**
     * 获取变量值
     */
    getVariable(name) {
        return this.variables[name];
    }
    
    /**
     * 获取所有变量
     */
    getAllVariables() {
        return { ...this.variables };
    }
    
    // ========== 事件分发 ==========
    
    /**
     * 分发事件
     */
    dispatch(eventId, params = {}) {
        if (!this.running || this.paused) {
            this.log('BLOCKED', eventId, '仿真器未运行或已暂停');
            return false;
        }
        
        // 检查断点
        if (this.breakpoints.has(`event:${eventId}`)) {
            this.paused = true;
            this.onBreakpoint({ type: 'event', eventId });
            return false;
        }
        
        // 从当前状态向上查找能处理此事件的转移
        const transition = this._findTransition(eventId, params);
        
        if (transition) {
            this._executeTransition(transition, eventId, params);
            return true;
        } else {
            this.log('IGNORED', eventId, `当前状态 ${this.getCurrentStateId()} 无法处理此事件`);
            return false;
        }
    }
    
    /**
     * 触发按键事件
     */
    pressKey(keyId, type = 'SHORT') {
        const eventId = `K${keyId}_${type}`;
        return this.dispatch(eventId);
    }
    
    /**
     * 触发测量结果
     */
    measureResult(success, distance = 0, errorCode = 0) {
        if (success) {
            this.setVariable('distance', distance);
            return this.dispatch('MEASURE_OK');
        } else {
            this.setVariable('error_code', errorCode);
            return this.dispatch('MEASURE_FAIL');
        }
    }
    
    // ========== 变量操作 ==========
    
    /**
     * 设置变量
     */
    setVariable(name, value) {
        const oldValue = this.variables[name];
        this.variables[name] = value;
        
        if (oldValue !== value) {
            this.onVariableChange({ name, oldValue, newValue: value });
        }
    }
    
    /**
     * 递增变量
     */
    incVariable(name) {
        this.setVariable(name, (this.variables[name] || 0) + 1);
    }
    
    /**
     * 递减变量
     */
    decVariable(name) {
        this.setVariable(name, (this.variables[name] || 0) - 1);
    }
    
    // ========== 定时器 ==========
    
    /**
     * 启动定时器
     */
    startTimer(timerId, durationMs, eventId) {
        this.clearTimer(timerId);
        
        this.timers[timerId] = {
            id: setTimeout(() => {
                delete this.timers[timerId];
                this.dispatch(eventId);
            }, durationMs),
            eventId,
            startTime: Date.now(),
            duration: durationMs
        };
        
        this.log('TIMER_START', timerId, `${durationMs}ms 后触发 ${eventId}`);
    }
    
    /**
     * 清除定时器
     */
    clearTimer(timerId) {
        if (this.timers[timerId]) {
            clearTimeout(this.timers[timerId].id);
            delete this.timers[timerId];
            this.log('TIMER_CLEAR', timerId, '');
        }
    }
    
    /**
     * 清除所有定时器
     */
    clearAllTimers() {
        for (const timerId of Object.keys(this.timers)) {
            this.clearTimer(timerId);
        }
    }
    
    // ========== 调试功能 ==========
    
    /**
     * 暂停
     */
    pause() {
        this.paused = true;
        this.log('DEBUG', 'PAUSE', '仿真已暂停');
    }
    
    /**
     * 继续
     */
    resume() {
        this.paused = false;
        this.log('DEBUG', 'RESUME', '仿真已继续');
    }
    
    /**
     * 单步执行模式
     */
    setStepMode(enabled) {
        this.stepMode = enabled;
    }
    
    /**
     * 添加断点
     */
    addBreakpoint(type, id) {
        this.breakpoints.add(`${type}:${id}`);
    }
    
    /**
     * 移除断点
     */
    removeBreakpoint(type, id) {
        this.breakpoints.delete(`${type}:${id}`);
    }
    
    /**
     * 获取事件日志
     */
    getEventLog(count = 100) {
        return this.eventLog.slice(-count);
    }
    
    // ========== 内部方法 ==========
    
    /**
     * 查找状态定义
     */
    _findState(stateId, hierarchy = null) {
        hierarchy = hierarchy || this.stateMachine?.hierarchy;
        if (!hierarchy) return null;
        
        for (const [id, state] of Object.entries(hierarchy)) {
            if (id === stateId) return state;
            if (state.children) {
                const found = this._findState(stateId, state.children);
                if (found) return found;
            }
        }
        return null;
    }
    
    /**
     * 查找可用的转移
     */
    _findTransition(eventId, params) {
        const transitions = this.stateMachine?.transitions || [];
        
        // 从当前状态向上查找
        for (let i = this.currentStatePath.length - 1; i >= 0; i--) {
            const stateId = this.currentStatePath[i];
            
            // 查找从此状态出发、响应此事件的转移
            for (const trans of transitions) {
                if (trans.from === stateId && trans.event === eventId) {
                    // 检查Guard条件
                    if (this._evaluateGuard(trans.guard, params)) {
                        return trans;
                    }
                }
            }
        }
        
        // 检查全局转移
        const globalTransitions = this.stateMachine?.globalTransitions || [];
        for (const trans of globalTransitions) {
            if (trans.event === eventId) {
                if (this._evaluateGuard(trans.guard, params)) {
                    return { ...trans, from: this.getCurrentStateId() };
                }
            }
        }
        
        return null;
    }
    
    /**
     * 评估Guard条件
     */
    _evaluateGuard(guard, params = {}) {
        if (!guard) return true;
        
        try {
            // 创建变量上下文
            const context = { ...this.variables, ...params };
            
            // 简单表达式求值
            let expr = guard;
            for (const [name, value] of Object.entries(context)) {
                const regex = new RegExp(`\\b${name}\\b`, 'g');
                expr = expr.replace(regex, JSON.stringify(value));
            }
            
            return eval(expr);
        } catch (e) {
            console.warn('Guard evaluation failed:', guard, e);
            return false;
        }
    }
    
    /**
     * 执行状态转移
     */
    _executeTransition(transition, eventId, params) {
        const fromState = transition.from;
        const toState = transition.to;
        
        this.log('TRANSITION', eventId, `${fromState} → ${toState}`);
        
        // 检查断点
        if (this.breakpoints.has(`state:${toState}`)) {
            this.paused = true;
            this.onBreakpoint({ type: 'state', stateId: toState });
        }
        
        // 1. 计算需要退出和进入的状态
        const exitStates = this._calculateExitStates(fromState, toState);
        const enterStates = this._calculateEnterStates(fromState, toState);
        
        // 2. 执行退出动作 (从深到浅)
        for (const stateId of exitStates) {
            this._exitState(stateId);
        }
        
        // 3. 执行转移动作
        this._executeActions(transition.actions || []);
        
        // 4. 更新状态路径
        // 移除退出的状态
        for (const stateId of exitStates) {
            const idx = this.currentStatePath.indexOf(stateId);
            if (idx >= 0) {
                this.currentStatePath.splice(idx);
            }
        }
        
        // 5. 执行进入动作 (从浅到深)
        for (const stateId of enterStates) {
            this._enterState(stateId);
        }
        
        // 6. 通知状态变化
        this.onStateChange({
            from: fromState,
            to: toState,
            event: eventId,
            currentPath: this.getCurrentStatePath()
        });
    }
    
    /**
     * 计算需要退出的状态
     */
    _calculateExitStates(fromState, toState) {
        // 找到最近公共祖先
        const fromPath = this._getStatePath(fromState);
        const toPath = this._getStatePath(toState);
        
        let lcaIndex = 0;
        while (lcaIndex < fromPath.length && lcaIndex < toPath.length &&
               fromPath[lcaIndex] === toPath[lcaIndex]) {
            lcaIndex++;
        }
        
        // 需要退出的状态 (从深到浅)
        return fromPath.slice(lcaIndex).reverse();
    }
    
    /**
     * 计算需要进入的状态
     */
    _calculateEnterStates(fromState, toState) {
        const fromPath = this._getStatePath(fromState);
        const toPath = this._getStatePath(toState);
        
        let lcaIndex = 0;
        while (lcaIndex < fromPath.length && lcaIndex < toPath.length &&
               fromPath[lcaIndex] === toPath[lcaIndex]) {
            lcaIndex++;
        }
        
        // 需要进入的状态 (从浅到深)
        return toPath.slice(lcaIndex);
    }
    
    /**
     * 获取状态的完整路径
     */
    _getStatePath(stateId) {
        const path = [];
        const hierarchy = this.stateMachine?.hierarchy;
        
        const findPath = (node, targetId, currentPath) => {
            for (const [id, state] of Object.entries(node)) {
                const newPath = [...currentPath, id];
                if (id === targetId) {
                    return newPath;
                }
                if (state.children) {
                    const found = findPath(state.children, targetId, newPath);
                    if (found) return found;
                }
            }
            return null;
        };
        
        return findPath(hierarchy, stateId, []) || [stateId];
    }
    
    /**
     * 进入状态层级 (从ROOT开始)
     */
    _enterStateHierarchy(stateId) {
        const state = this._findState(stateId);
        if (!state) return;
        
        this._enterState(stateId);
        
        // 如果是复合状态，进入初始子状态
        if (state.type === 'compound' && state.initial) {
            this._enterStateHierarchy(state.initial);
        }
    }
    
    /**
     * 进入单个状态
     */
    _enterState(stateId) {
        const state = this._findState(stateId);
        if (!state) return;
        
        this.currentStatePath.push(stateId);
        this.log('ENTER', stateId, state.label || stateId);
        
        // 执行入口动作
        this._executeActions(state.entryActions || []);
        
        // 如果是复合状态，进入初始子状态
        if (state.type === 'compound' && state.initial) {
            this._enterState(state.initial);
        }
    }
    
    /**
     * 退出单个状态
     */
    _exitState(stateId) {
        const state = this._findState(stateId);
        if (!state) return;
        
        this.log('EXIT', stateId, state.label || stateId);
        
        // 执行退出动作
        this._executeActions(state.exitActions || []);
    }
    
    /**
     * 执行动作列表
     */
    _executeActions(actions) {
        for (const action of actions) {
            this._executeAction(action);
        }
    }
    
    /**
     * 执行单个动作
     */
    _executeAction(action) {
        if (typeof action !== 'string') return;
        
        // 预设
        if (action.startsWith('preset:')) {
            const presetId = action.split(':')[1];
            if (this.lcdRuntime) {
                // 传递变量以支持变量绑定
                this.lcdRuntime.applyPreset(presetId, this.variables);
            }
            this.log('ACTION', 'preset', presetId);
        }
        // 动画
        else if (action.startsWith('anim:')) {
            const parts = action.split(':');
            const animId = parts[1];
            const animAction = parts[2];
            if (this.lcdRuntime) {
                if (animAction === 'start') {
                    this.lcdRuntime.startAnimation(animId);
                } else {
                    this.lcdRuntime.stopAnimation(animId);
                }
            }
            this.log('ACTION', 'anim', `${animId}:${animAction}`);
        }
        // 硬件控制
        else if (action.startsWith('hw:')) {
            const parts = action.split(':');
            const device = parts[1];
            const hwAction = parts[2];
            this.onHardwareAction({ device, action: hwAction });
            this.log('ACTION', 'hw', `${device}:${hwAction}`);
        }
        // 变量设置
        else if (action.startsWith('set:')) {
            const expr = action.substring(4).trim();
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let value = match[2].trim();
                // 简单求值
                try {
                    value = this._evaluateExpression(value);
                } catch (e) {}
                this.setVariable(varName, value);
            }
        }
        // 递增
        else if (action.startsWith('inc:')) {
            const varName = action.substring(4).trim();
            this.incVariable(varName);
        }
        // 递减
        else if (action.startsWith('dec:')) {
            const varName = action.substring(4).trim();
            this.decVariable(varName);
        }
        // 计算
        else if (action.startsWith('calc:')) {
            const expr = action.substring(5).trim();
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                const calcExpr = match[2].trim();
                try {
                    const value = this._evaluateExpression(calcExpr);
                    this.setVariable(varName, value);
                } catch (e) {
                    console.warn('Calc failed:', calcExpr, e);
                }
            }
        }
        // LCD控制
        else if (action.startsWith('lcd:')) {
            const lcdAction = action.split(':')[1];
            if (this.lcdRuntime) {
                if (lcdAction === 'showAll') {
                    this.lcdRuntime.showAll();
                } else if (lcdAction === 'clearAll') {
                    this.lcdRuntime.clearAll();
                }
            }
            this.log('ACTION', 'lcd', lcdAction);
        }
        // 组件控制
        else if (action.startsWith('comp:')) {
            const parts = action.split(':');
            const compAction = parts[1];
            const compId = parts[2];
            const param = parts[3];
            
            if (this.lcdRuntime) {
                switch (compAction) {
                    case 'setValue':
                        this.lcdRuntime.setValue(compId, this._evaluateExpression(param));
                        break;
                    case 'showPreset':
                        this.lcdRuntime.showPreset(compId, param);
                        break;
                }
            }
            this.log('ACTION', 'comp', `${compId}.${compAction}(${param})`);
        }
        // 条件动作
        else if (action.startsWith('if:')) {
            const match = action.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                const condition = match[1].trim();
                const thenAction = match[2].trim();
                if (this._evaluateGuard(condition)) {
                    this._executeAction(thenAction);
                }
            }
        }
    }
    
    /**
     * 表达式求值
     */
    _evaluateExpression(expr) {
        if (expr === 'true') return true;
        if (expr === 'false') return false;
        if (!isNaN(Number(expr))) return Number(expr);
        
        // 替换变量
        let evalExpr = expr;
        for (const [name, value] of Object.entries(this.variables)) {
            const regex = new RegExp(`\\b${name}\\b`, 'g');
            evalExpr = evalExpr.replace(regex, JSON.stringify(value));
        }
        
        // 替换数学函数
        evalExpr = evalExpr.replace(/sqrt\(/g, 'Math.sqrt(');
        evalExpr = evalExpr.replace(/\^2/g, '**2');
        
        try {
            return eval(evalExpr);
        } catch (e) {
            return expr;
        }
    }
    
    /**
     * 记录日志
     */
    log(type, target, message) {
        const entry = {
            time: new Date().toISOString(),
            type,
            target,
            message,
            state: this.getCurrentStatePath()
        };
        
        this.eventLog.push(entry);
        if (this.eventLog.length > this.maxLogSize) {
            this.eventLog.shift();
        }
        
        this.onEventLog(entry);
    }
};
