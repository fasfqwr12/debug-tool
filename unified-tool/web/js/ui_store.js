/**
 * UIStore - 统一状态管理中心 v2.0
 * 
 * 核心理念: 组件名 = 变量名，创建即绑定，零配置！
 * 
 * 自动绑定规则:
 * - 创建组件时自动注册到 UIStore
 * - 组件名就是变量名，无需手动配置 binding
 * - 按组件类型自动分配控制方式:
 *   - LineDisplay/NumberDisplay → set(name, number) 显示数字
 *   - Icon → set(name, bool) 显示/隐藏
 *   - LevelIndicator → set(name, level) 设置等级
 *   - ModeSelector → set(name, mode) 切换模式
 * 
 * 简化用法:
 *   await UIStore.init('gd303_mini');  // 自动加载所有组件
 *   UIStore.set('Line4', 12.345);      // 直接设置，自动单位转换
 *   UIStore.set('Laser', true);        // 图标显示
 *   UIStore.set('Battery', 2);         // 电量等级
 *   UIStore.set('unit', 1);            // 切换单位，自动刷新所有Line
 */

window.UIStore = {
    DEBUG: true,
    
    log(...args) {
        if (this.DEBUG) console.log('[UIStore]', ...args);
    },
    
    // ========== 状态 ==========
    state: {
        initialized: false,
        deviceId: null,
        
        // 变量定义 (内置 + 从 variables.json 加载)
        variableDefs: {
            globals: {},
            data: {},
            components: {}  // 组件变量 (自动生成)
        },
        
        // 当前值
        globals: {},    // 全局状态: unit, laser_on, ...
        data: {},       // 业务数据: distance, length, width, ...
        components: {}, // 组件值: Line4, Line3, Laser, Battery, ...
        
        // 组件定义 (从 components.json 加载)
        componentDefs: {},
        
        // 绑定索引 (运行时构建): { variableName: [compId1, compId2, ...] }
        bindingIndex: {},
        
        // 回调
        callbacks: {
            onStateChange: [],      // 状态变化
            onHardware: [],         // 硬件回调
            onBindingUpdate: [],    // 绑定更新
            onComponentUpdate: [],  // 组件更新
        }
    },
    
    // ========== 初始化 ==========
    async init(deviceId) {
        this.log('初始化, 设备:', deviceId);
        
        this.state.deviceId = deviceId || 'gd303_mini';
        
        // 加载变量定义
        await this.loadVariables();
        
        // 加载组件定义
        await this.loadComponents();
        
        // 自动生成组件变量
        this.generateComponentVariables();
        
        // 构建绑定索引
        this.buildBindingIndex();
        
        // 初始化默认值
        this.initDefaultValues();
        
        // ★ 初始化动画控制器 (联动)
        if (typeof AnimController !== 'undefined') {
            await AnimController.init(this.state.deviceId);
            this.log('动画控制器已绑定');
        }
        
        this.state.initialized = true;
        this.log('初始化完成', {
            globals: Object.keys(this.state.globals),
            data: Object.keys(this.state.data),
            components: Object.keys(this.state.components),
            bindings: this.state.bindingIndex
        });
        
        return this;
    },
    
    async loadVariables() {
        try {
            // 尝试从 DeviceConfigManager 加载
            if (typeof DeviceConfigManager !== 'undefined') {
                const vars = await DeviceConfigManager.loadConfig('variables', this.state.deviceId);
                if (vars) {
                    this.state.variableDefs = vars;
                    return;
                }
            }
            
            // 使用默认变量定义
            this.state.variableDefs = this.getDefaultVariables();
        } catch (e) {
            console.warn('[UIStore] 加载变量定义失败，使用默认值:', e);
            this.state.variableDefs = this.getDefaultVariables();
        }
    },
    
    async loadComponents() {
        try {
            if (typeof DeviceConfigManager !== 'undefined') {
                const comps = await DeviceConfigManager.loadConfig('components', this.state.deviceId);
                this.state.componentDefs = comps?.components || {};
            }
        } catch (e) {
            console.warn('[UIStore] 加载组件定义失败:', e);
        }
    },
    
    /**
     * 自动生成组件变量 - 核心自动绑定逻辑
     * 
     * 规则:
     * - 每个组件自动有同名变量
     * - 按组件类型确定变量类型和默认值
     * - 无需手动配置 binding
     */
    generateComponentVariables() {
        this.state.variableDefs.components = {};
        
        for (const [compId, comp] of Object.entries(this.state.componentDefs)) {
            // 根据组件类型确定变量类型和默认值
            let varDef = { type: 'any', default: null };
            
            switch (comp.type) {
                case 'NumberDisplay':
                case 'LineDisplay':
                case 'Line':  // v3.0 新类型
                    // 数字显示组件 → float 类型，默认0
                    varDef = { 
                        type: 'float', 
                        default: 0, 
                        description: `${compId}显示值`,
                        compType: comp.type,
                        dataType: comp.dataType || 'length',
                        emptyDisplay: comp.emptyDisplay || 'dash'
                    };
                    break;
                case 'ModeSelector':
                case 'Selector':  // v3.0 新类型
                    // 选择器 → int 类型，默认值
                    varDef = { 
                        type: 'int', 
                        default: comp.default || 0, 
                        description: `${compId}选择`,
                        compType: comp.type,
                        options: comp.options || []
                    };
                    break;
                case 'LevelIndicator':
                    // 等级指示器 → int 类型，默认0
                    varDef = { 
                        type: 'int', 
                        default: 0, 
                        description: `${compId}等级`,
                        compType: comp.type,
                        maxLevel: comp.maxLevel || comp.levels?.length || 3
                    };
                    break;
                case 'Icon':
                    // 图标 → bool 类型，默认false
                    varDef = { 
                        type: 'bool', 
                        default: comp.default || false, 
                        description: `${compId}可见性`,
                        compType: comp.type
                    };
                    break;
            }
            
            this.state.variableDefs.components[compId] = varDef;
            
            // 同时初始化组件值
            this.state.components[compId] = varDef.default;
        }
        
        this.log('自动绑定组件变量:', Object.keys(this.state.variableDefs.components));
    },
    
    getDefaultVariables() {
        return {
            globals: {
                unit: { type: 'int', default: 0, description: '单位: 0=m, 1=ft, 2=in, 3=ft+in' },
                laser_on: { type: 'bool', default: false, description: '激光状态', hardware: 'laser' },
                backlight_on: { type: 'bool', default: true, description: '背光状态', hardware: 'backlight' },
                base_back: { type: 'bool', default: true, description: '基准: true=后, false=前' },
                beep_enable: { type: 'bool', default: true, description: '蜂鸣器开关' },
                battery: { type: 'int', default: 3, description: '电量等级 0-3' }
            },
            data: {
                // 测量数据
                distance: { type: 'float', default: 0, description: '当前测量距离(米)' },
                length: { type: 'float', default: 0, description: '长度(米)' },
                width: { type: 'float', default: 0, description: '宽度(米)' },
                height: { type: 'float', default: 0, description: '高度(米)' },
                
                // 计算结果
                area_result: { type: 'float', default: 0, description: '面积结果(平方米)' },
                volume_result: { type: 'float', default: 0, description: '体积结果(立方米)' },
                pythagorean_result: { type: 'float', default: 0, description: '勾股结果(米)' },
                
                // 连续测量
                max_data: { type: 'float', default: -1, description: '连续测量最大值' },
                min_data: { type: 'float', default: -1, description: '连续测量最小值' },
                
                // 其他
                signal: { type: 'int', default: 0, description: '信号强度 0-5' },
                angle: { type: 'float', default: 0, description: '角度' }
            }
        };
    },
    
    buildBindingIndex() {
        this.state.bindingIndex = {};
        
        for (const [compId, comp] of Object.entries(this.state.componentDefs)) {
            if (comp.binding?.variable) {
                const varName = comp.binding.variable;
                if (!this.state.bindingIndex[varName]) {
                    this.state.bindingIndex[varName] = [];
                }
                this.state.bindingIndex[varName].push(compId);
            }
        }
        
        this.log('绑定索引:', this.state.bindingIndex);
    },
    
    initDefaultValues() {
        // 初始化全局状态
        for (const [name, def] of Object.entries(this.state.variableDefs.globals)) {
            this.state.globals[name] = def.default;
        }
        
        // 初始化业务数据
        for (const [name, def] of Object.entries(this.state.variableDefs.data)) {
            this.state.data[name] = def.default;
        }
        
        // 初始化组件值
        for (const [name, def] of Object.entries(this.state.variableDefs.components)) {
            this.state.components[name] = def.default;
        }
    },
    
    // ========== 核心 API ==========
    
    /**
     * 设置变量值 (统一入口)
     * 支持: 全局变量、业务数据、组件变量
     * @param {string} name - 变量名或组件名
     * @param {any} value - 值
     */
    set(name, value) {
        // 1. 检查是否是组件名 (直接操作组件)
        if (name in this.state.variableDefs.components) {
            return this.setComponent(name, value);
        }
        
        // 2. 检查是否是全局变量
        if (name in this.state.variableDefs.globals) {
            return this.setGlobal(name, value);
        }
        
        // 3. 检查是否是业务数据
        if (name in this.state.variableDefs.data) {
            return this.setData(name, value);
        }
        
        console.warn('[UIStore] 未知变量:', name);
    },
    
    /**
     * 设置组件值 (直接操作组件)
     */
    setComponent(compId, value) {
        const comp = this.state.componentDefs[compId];
        if (!comp) return;
        
        const oldValue = this.state.components[compId];
        this.state.components[compId] = value;
        
        this.log(`组件 ${compId} = ${value} (was ${oldValue})`);
        
        // 直接更新 LcdRuntime
        this.updateComponentDisplay(compId, comp, value);
        
        // ★ 触发动画联动 (onSet 配置)
        if (typeof AnimController !== 'undefined' && AnimController.handleComponentChange) {
            AnimController.handleComponentChange(compId, value);
        }
        
        // 触发回调
        this.emit('onComponentUpdate', { compId, value, oldValue });
        this.emit('onStateChange', { name: compId, value, oldValue, type: 'component' });
    },
    
    /**
     * 设置全局变量
     */
    setGlobal(name, value) {
        const oldValue = this.state.globals[name];
        this.state.globals[name] = value;
        
        this.log(`全局 ${name} = ${value} (was ${oldValue})`);
        
        // 更新绑定的组件
        this.updateBindings(name, value);
        
        // 特殊处理: unit 变化时，重新渲染所有 LineDisplay 组件
        if (name === 'unit') {
            this.refreshAllLineDisplays();
        }
        
        // 触发硬件回调
        const varDef = this.state.variableDefs.globals[name];
        if (varDef?.hardware) {
            this.triggerHardware(varDef.hardware, value);
        }
        
        // 触发回调
        this.emit('onStateChange', { name, value, oldValue, type: 'global' });
    },
    
    /**
     * 刷新所有 LineDisplay 组件 (单位变化时调用)
     */
    refreshAllLineDisplays() {
        for (const [compId, comp] of Object.entries(this.state.componentDefs)) {
            if (comp.type === 'LineDisplay') {
                const value = this.state.components[compId];
                if (value !== undefined && value !== null) {
                    this.updateComponentDisplay(compId, comp, value);
                    this.log(`  刷新 ${compId} (单位变化)`);
                }
            }
        }
    },
    
    /**
     * 设置业务数据
     */
    setData(name, value) {
        const oldValue = this.state.data[name];
        this.state.data[name] = value;
        
        this.log(`数据 ${name} = ${value} (was ${oldValue})`);
        
        // 触发回调
        this.emit('onStateChange', { name, value, oldValue, type: 'data' });
    },
    
    /**
     * 更新组件显示
     */
    updateComponentDisplay(compId, comp, value) {
        if (typeof LcdRuntime === 'undefined') return;
        
        // 处理预设值字符串
        if (typeof value === 'string') {
            if (value === '-----' || value === 'dash') {
                LcdRuntime.showPreset?.(compId, 'dash');
                return;
            }
            if (value === '' || value === 'null' || value === 'hidden') {
                LcdRuntime.setVisible?.(compId, false);
                return;
            }
            if (value === 'Err' || value === 'error') {
                LcdRuntime.showPreset?.(compId, 'error');
                return;
            }
        }
        
        // 根据组件类型处理
        switch (comp.type) {
            case 'NumberDisplay':
            case 'LineDisplay':
            case 'Line':  // v3.0 新类型
                // 数字显示 - 支持单位转换
                if (comp.type === 'LineDisplay' || comp.type === 'Line') {
                    this.updateLineDisplay(compId, comp, value);
                } else {
                    LcdRuntime.setValue?.(compId, value);
                }
                break;
                
            case 'ModeSelector':
                LcdRuntime.setMode?.(compId, value);
                break;
                
            case 'Selector':  // v3.0 新类型
                // Selector 组件 - 根据 value 显示对应元素
                this.updateSelector(compId, comp, value);
                break;
                
            case 'LevelIndicator':
                LcdRuntime.setLevel?.(compId, parseInt(value) || 0);
                break;
                
            case 'Icon':
                LcdRuntime.setVisible?.(compId, !!value);
                break;
        }
    },
    
    /**
     * 更新 Selector 组件
     */
    updateSelector(compId, comp, value) {
        if (typeof LcdRuntime === 'undefined') return;
        
        const options = comp.options || [];
        const frame = comp.frame || [];
        
        // 关闭所有选项元素
        for (const opt of options) {
            for (const elem of opt.elements || []) {
                LcdRuntime.setElementByName?.(elem, false);
            }
        }
        
        // 显示框架元素（始终显示）
        for (const elem of frame) {
            LcdRuntime.setElementByName?.(elem, true);
        }
        
        // 显示当前选项元素
        const selectedOpt = options.find(opt => opt.value === value);
        if (selectedOpt) {
            for (const elem of selectedOpt.elements || []) {
                LcdRuntime.setElementByName?.(elem, true);
            }
        }
        
        this.log(`  Selector ${compId}: value=${value} → ${selectedOpt?.key || 'unknown'}`);
    },
    
    /**
     * 更新 LineDisplay 组件 (带单位转换)
     */
    updateLineDisplay(compId, comp, value) {
        if (typeof LcdRuntime === 'undefined') return;
        
        const unit = this.state.globals.unit || 0;
        const dataType = comp.dataType || 'length';
        const emptyDisplay = comp.emptyDisplay || 'dash';
        
        // 空值处理
        if (value === 0 || value === null || value === undefined) {
            if (emptyDisplay === 'dash') {
                LcdRuntime.showPreset(compId, 'dash');
                // 隐藏单位
                if (comp.showUnit !== false) {
                    this.hideLineUnit(compId, comp);
                }
            } else if (emptyDisplay === 'hidden') {
                LcdRuntime.setVisible(compId, false);
            } else {
                LcdRuntime.setValue(compId, '0');
            }
            return;
        }
        
        // 单位转换
        if (typeof UnitConverter !== 'undefined') {
            const result = UnitConverter.toDisplay(value, unit, dataType);
            LcdRuntime.setValue(compId, result.display);
            
            // 显示对应单位
            if (comp.showUnit !== false) {
                this.showLineUnit(compId, comp, unit, dataType);
            }
        } else {
            LcdRuntime.setValue(compId, value);
        }
    },
    
    /**
     * 显示 LineDisplay 的单位
     */
    showLineUnit(compId, comp, unit, dataType) {
        // 如果组件有 units 配置
        if (comp.units && comp.units[dataType]) {
            const unitModes = comp.units[dataType];
            
            // 根据单位索引和数据类型确定要显示的单位key
            const unitKeyMap = {
                length: { 0: 'm', 1: 'ft', 2: 'in' },
                area: { 0: 'm2', 1: 'ft2', 2: 'in2' },
                volume: { 0: 'm3', 1: 'ft3', 2: 'in3' }
            };
            
            const targetKey = unitKeyMap[dataType]?.[unit];
            
            // 隐藏所有单位，显示当前单位
            for (const [symbol, elements] of Object.entries(unitModes)) {
                const show = symbol === targetKey;
                for (const elem of elements) {
                    if (typeof LcdRuntime !== 'undefined') {
                        LcdRuntime.setElementByName(elem, show);
                    }
                }
            }
        }
    },
    
    /**
     * 隐藏 LineDisplay 的单位
     */
    hideLineUnit(compId, comp) {
        if (comp.units) {
            for (const typeUnits of Object.values(comp.units)) {
                for (const elements of Object.values(typeUnits)) {
                    for (const elem of elements) {
                        if (typeof LcdRuntime !== 'undefined') {
                            LcdRuntime.setElementByName(elem, false);
                        }
                    }
                }
            }
        }
    },
    
    /**
     * 获取变量值
     * @param {string} name - 变量名或组件名
     * @returns {any}
     */
    get(name) {
        // 组件值
        if (name in this.state.components) {
            return this.state.components[name];
        }
        // 全局变量
        if (name in this.state.globals) {
            return this.state.globals[name];
        }
        // 业务数据
        if (name in this.state.data) {
            return this.state.data[name];
        }
        return undefined;
    },
    
    /**
     * 批量设置
     * @param {object} values - { name: value, ... }
     */
    setMultiple(values) {
        for (const [name, value] of Object.entries(values)) {
            this.set(name, value);
        }
    },
    
    /**
     * 执行状态机动作
     * 支持简化语法: "Line4 = distance", "Laser = true", "unit = 1"
     * @param {string} action - 动作字符串
     */
    executeAction(action) {
        if (!action || typeof action !== 'string') return;
        
        // 解析 "name = value" 格式
        const match = action.match(/^\s*(\w+)\s*=\s*(.+)\s*$/);
        if (!match) {
            this.log('无法解析动作:', action);
            return;
        }
        
        const [, name, valueStr] = match;
        let value;
        
        // 解析值
        if (valueStr === 'true') {
            value = true;
        } else if (valueStr === 'false') {
            value = false;
        } else if (valueStr.startsWith("'") || valueStr.startsWith('"')) {
            // 字符串值
            value = valueStr.slice(1, -1);
        } else if (!isNaN(parseFloat(valueStr))) {
            // 数字
            value = parseFloat(valueStr);
        } else if (valueStr in this.state.data) {
            // 引用业务数据
            value = this.state.data[valueStr];
        } else if (valueStr in this.state.globals) {
            // 引用全局变量
            value = this.state.globals[valueStr];
        } else if (valueStr in this.state.components) {
            // 引用组件值
            value = this.state.components[valueStr];
        } else {
            // 作为字符串
            value = valueStr;
        }
        
        this.log(`执行动作: ${name} = ${value} (from "${valueStr}")`);
        this.set(name, value);
    },
    
    // ========== 绑定更新 (全局变量 → 组件) ==========
    
    updateBindings(varName, value) {
        const boundComponents = this.state.bindingIndex[varName] || [];
        
        if (boundComponents.length === 0) {
            this.log(`变量 ${varName} 没有绑定的组件`);
            return;
        }
        
        this.log(`更新绑定: ${varName} → [${boundComponents.join(', ')}]`);
        
        for (const compId of boundComponents) {
            this.updateComponentFromBinding(compId, varName, value);
        }
    },
    
    updateComponentFromBinding(compId, varName, value) {
        const comp = this.state.componentDefs[compId];
        if (!comp) return;
        
        const binding = comp.binding;
        if (!binding) return;
        
        // 根据组件类型处理
        switch (comp.type) {
            case 'ModeSelector':
                this.updateModeSelector(compId, comp, value);
                break;
            case 'LevelIndicator':
                this.updateLevelIndicator(compId, comp, value);
                break;
            case 'Icon':
                this.updateIcon(compId, comp, value);
                break;
            case 'NumberDisplay':
            case 'LineDisplay':
                this.updateNumberDisplay(compId, comp, value);
                break;
        }
        
        this.emit('onBindingUpdate', { compId, varName, value, comp });
    },
    
    updateModeSelector(compId, comp, value) {
        const mapping = comp.binding?.mapping || {};
        const mode = mapping[String(value)] || Object.keys(comp.modes || {})[value] || value;
        
        this.log(`  ModeSelector ${compId}: value=${value} → mode=${mode}`);
        
        if (typeof LcdRuntime !== 'undefined') {
            LcdRuntime.setMode(compId, mode);
        }
    },
    
    updateLevelIndicator(compId, comp, value) {
        const level = parseInt(value) || 0;
        
        this.log(`  LevelIndicator ${compId}: level=${level}`);
        
        if (typeof LcdRuntime !== 'undefined') {
            LcdRuntime.setLevel(compId, level);
        }
    },
    
    updateIcon(compId, comp, value) {
        const mapping = comp.binding?.mapping || {};
        let visible;
        
        if (mapping[String(value)] !== undefined) {
            visible = mapping[String(value)] === 'visible' || mapping[String(value)] === true;
        } else {
            visible = !!value;
        }
        
        this.log(`  Icon ${compId}: visible=${visible}`);
        
        if (typeof LcdRuntime !== 'undefined') {
            LcdRuntime.setVisible(compId, visible);
        }
    },
    
    updateNumberDisplay(compId, comp, value) {
        this.log(`  NumberDisplay ${compId}: value=${value}`);
        
        if (typeof LcdRuntime !== 'undefined') {
            LcdRuntime.setValue(compId, value);
        }
    },
    
    // ========== 硬件回调 ==========
    
    triggerHardware(type, value) {
        this.log(`硬件回调: ${type} = ${value}`);
        this.emit('onHardware', { type, value });
    },
    
    // ========== 事件系统 ==========
    
    on(event, callback) {
        if (this.state.callbacks[event]) {
            this.state.callbacks[event].push(callback);
        }
    },
    
    off(event, callback) {
        if (this.state.callbacks[event]) {
            const idx = this.state.callbacks[event].indexOf(callback);
            if (idx >= 0) {
                this.state.callbacks[event].splice(idx, 1);
            }
        }
    },
    
    emit(event, data) {
        if (this.state.callbacks[event]) {
            for (const cb of this.state.callbacks[event]) {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[UIStore] 回调错误 ${event}:`, e);
                }
            }
        }
    },
    
    // ========== 工具方法 ==========
    
    /**
     * 获取所有全局状态
     */
    getGlobals() {
        return { ...this.state.globals };
    },
    
    /**
     * 获取所有业务数据
     */
    getData() {
        return { ...this.state.data };
    },
    
    /**
     * 获取所有组件值
     */
    getComponents() {
        return { ...this.state.components };
    },
    
    /**
     * 获取变量定义
     */
    getVariableDefs() {
        return this.state.variableDefs;
    },
    
    /**
     * 获取组件定义
     */
    getComponentDefs() {
        return this.state.componentDefs;
    },
    
    /**
     * 获取绑定索引
     */
    getBindingIndex() {
        return { ...this.state.bindingIndex };
    },
    
    /**
     * 获取绑定到指定变量的组件列表
     */
    getBoundComponents(varName) {
        return this.state.bindingIndex[varName] || [];
    },
    
    /**
     * 获取所有可用变量名 (用于状态机编辑器)
     */
    getAllVariableNames() {
        return {
            globals: Object.keys(this.state.variableDefs.globals),
            data: Object.keys(this.state.variableDefs.data),
            components: Object.keys(this.state.variableDefs.components)
        };
    },
    
    /**
     * 重置为默认值
     */
    reset() {
        this.initDefaultValues();
        
        // 更新所有绑定
        for (const varName of Object.keys(this.state.bindingIndex)) {
            const value = this.get(varName);
            this.updateBindings(varName, value);
        }
    }
};
