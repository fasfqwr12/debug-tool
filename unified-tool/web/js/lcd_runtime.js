/**
 * LCD运行时引擎 - 将组件、预设、动画库连接成完整的UI系统
 * 
 * 功能:
 * 1. 组件注册和状态管理
 * 2. 动画系统（闪烁Blink、序列帧Sequence）
 * 3. 预设应用（快速设置界面状态）
 * 4. LCD缓冲区渲染
 * 5. 回调机制（动画完成、状态变化等）
 * 
 * 参考: LVGL动画架构 + 固件svc_ui_mini.c实现
 */

window.LcdRuntime = {
    // 调试开关 - 设为false关闭日志输出
    DEBUG: false,
    
    // 调试日志
    log(...args) {
        if (this.DEBUG) this.log('', ...args);
    },
    warn(...args) {
        if (this.DEBUG) this.warn('', ...args);
    },
    
    // ========== 状态 ==========
    state: {
        initialized: false,
        deviceId: null,
        
        // 配置数据
        lcdProject: null,       // LCD段码映射 (project.json)
        components: {},         // 组件定义 (components.json)
        commonPresets: {},      // 通用预设 (components.json中的commonPresets)
        presets: {},            // 界面预设 (presets.json)
        animations: {},         // 动画定义 (animations.json)
        
        // 运行时状态
        componentStates: {},    // 组件当前状态 { componentId: { value, mode, level, visible, ... } }
        elementStates: {},      // 元素点亮状态 { elementId: true/false }
        activeAnimations: {},   // 活动动画 { animId: { timer, frameIndex, ... } }
        activeBehaviors: {},    // 活动行为 { behaviorId: { timer, state, ... } }
        
        // LCD缓冲区 (54字节, SEG0-53, 每字节8个COM)
        buffer: new Uint8Array(54),
        
        // 回调
        callbacks: {
            onStateChange: [],      // 状态变化回调
            onAnimationStart: [],   // 动画开始回调
            onAnimationEnd: [],     // 动画结束回调
            onBufferUpdate: [],     // 缓冲区更新回调
            onPresetApplied: [],    // 预设应用回调
        }
    },
    
    // COM位映射: COM0=bit7, COM7=bit0
    COM_BIT_MAP: { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 0 },
    
    // 七段数码管字形表 (A-G段, 低位在前)
    DIGIT_PATTERNS: {
        '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66,
        '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
        'A': 0x77, 'B': 0x7C, 'C': 0x39, 'D': 0x5E, 'E': 0x79, 'F': 0x71,
        '-': 0x40, '_': 0x08, ' ': 0x00, '.': 0x80,
        'r': 0x50, 'n': 0x54, 'u': 0x1C, 'L': 0x38, 'H': 0x76,
        'o': 0x5C, 'P': 0x73, 't': 0x78, 'N': 0x37, 'U': 0x3E,
    },
    
    // ========== 初始化 ==========
    async init(deviceId) {
        this.log(' 初始化, 设备:', deviceId);
        
        this.state.deviceId = deviceId || DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
        
        // 加载所有配置
        await this.loadAllConfigs();
        
        // 初始化组件状态
        this.initComponentStates();
        
        // 清空缓冲区
        this.clearBuffer();
        
        this.state.initialized = true;
        this.log(' 初始化完成');
        
        return this;
    },
    
    async loadAllConfigs() {
        if (typeof DeviceConfigManager === 'undefined') {
            this.warn(' DeviceConfigManager不可用');
            return;
        }
        
        try {
            // 并行加载所有配置
            const [lcdProject, components, presets, animations] = await Promise.all([
                DeviceConfigManager.loadLcdProject(this.state.deviceId),
                DeviceConfigManager.loadConfig('components', this.state.deviceId),
                DeviceConfigManager.loadConfig('presets', this.state.deviceId),
                DeviceConfigManager.loadConfig('animations', this.state.deviceId),
            ]);
            
            this.state.lcdProject = lcdProject;
            this.state.components = components?.components || {};
            this.state.commonPresets = components?.commonPresets || {};  // 加载通用预设
            this.state.presets = presets?.presets || {};
            this.state.animations = animations?.animations || {};
            
            // 合并behaviors到animations (兼容旧格式)
            if (components?.behaviors) {
                for (const [id, behavior] of Object.entries(components.behaviors)) {
                    if (!this.state.animations[id]) {
                        this.state.animations[id] = behavior;
                    }
                }
            }
            
            this.log(' 配置加载完成:', {
                elements: lcdProject?.elements?.length || 0,
                components: Object.keys(this.state.components).length,
                commonPresets: Object.keys(this.state.commonPresets).length,
                presets: Object.keys(this.state.presets).length,
                animations: Object.keys(this.state.animations).length,
            });
        } catch (e) {
            console.error('[LcdRuntime] 加载配置失败:', e);
        }
    },
    
    initComponentStates() {
        this.state.componentStates = {};
        this.state.elementStates = {};
        
        // 初始化每个组件的默认状态
        for (const [id, comp] of Object.entries(this.state.components)) {
            this.state.componentStates[id] = this.getDefaultComponentState(comp);
        }
        
        // 初始化元素状态
        if (this.state.lcdProject?.elements) {
            for (const elem of this.state.lcdProject.elements) {
                this.state.elementStates[elem.id || elem.name] = false;
            }
        }
    },
    
    getDefaultComponentState(comp) {
        switch (comp.type) {
            case 'NumberDisplay':
                return { value: '', visible: true };
            case 'LineDisplay':
                return { 
                    value: 0, 
                    visible: true, 
                    dataType: comp.dataType || 'length',
                    showUnit: comp.showUnit !== false
                };
            case 'ModeSelector':
                return { mode: comp.defaultMode || Object.keys(comp.modes || {})[0], visible: true };
            case 'LevelIndicator':
                return { level: 0, visible: true };
            case 'Icon':
                return { visible: comp.defaultVisible || false };
            default:
                return { visible: true };
        }
    },

    // ========== 组件API ==========
    
    /**
     * 设置组件值 (NumberDisplay / LineDisplay)
     * @param {string} componentId - 组件ID
     * @param {string|number} value - 显示值
     */
    setValue(componentId, value) {
        const comp = this.state.components[componentId];
        if (!comp) {
            this.warn(' 组件不存在:', componentId);
            return;
        }
        
        const state = this.state.componentStates[componentId];
        const oldValue = state.value;
        state.value = value;
        
        // 更新LCD显示
        this.renderComponent(componentId);
        
        // 触发回调
        this.emit('onStateChange', { componentId, type: 'value', oldValue, newValue: value });
    },
    
    /**
     * 设置 LineDisplay 的数据类型
     * @param {string} componentId - 组件ID
     * @param {string} dataType - 数据类型 ('length'|'area'|'volume')
     */
    setDataType(componentId, dataType) {
        const comp = this.state.components[componentId];
        if (!comp || comp.type !== 'LineDisplay') {
            this.warn(' 无效的LineDisplay:', componentId);
            return;
        }
        
        const state = this.state.componentStates[componentId];
        const oldType = state.dataType;
        state.dataType = dataType;
        
        // 重新渲染
        this.renderComponent(componentId);
        
        this.emit('onStateChange', { componentId, type: 'dataType', oldValue: oldType, newValue: dataType });
    },
    
    /**
     * 设置组件模式 (ModeSelector)
     * @param {string} componentId - 组件ID
     * @param {string} mode - 模式名称
     */
    setMode(componentId, mode) {
        const comp = this.state.components[componentId];
        if (!comp || comp.type !== 'ModeSelector') {
            this.warn(' 无效的ModeSelector:', componentId);
            return;
        }
        
        if (!comp.modes[mode]) {
            this.warn(' 无效的模式:', mode, '可用:', Object.keys(comp.modes));
            return;
        }
        
        const state = this.state.componentStates[componentId];
        const oldMode = state.mode;
        state.mode = mode;
        
        this.renderComponent(componentId);
        this.emit('onStateChange', { componentId, type: 'mode', oldValue: oldMode, newValue: mode });
    },
    
    /**
     * 设置等级 (LevelIndicator)
     * @param {string} componentId - 组件ID
     * @param {number} level - 等级 (0 ~ maxLevel)
     */
    setLevel(componentId, level) {
        const comp = this.state.components[componentId];
        if (!comp || comp.type !== 'LevelIndicator') {
            this.warn(' 无效的LevelIndicator:', componentId);
            return;
        }
        
        const maxLevel = comp.maxLevel || comp.levels?.length || 1;
        level = Math.max(0, Math.min(maxLevel, level));
        
        const state = this.state.componentStates[componentId];
        const oldLevel = state.level;
        state.level = level;
        
        this.renderComponent(componentId);
        this.emit('onStateChange', { componentId, type: 'level', oldValue: oldLevel, newValue: level });
    },
    
    /**
     * 设置组件可见性
     * @param {string} componentId - 组件ID
     * @param {boolean} visible - 是否可见
     */
    setVisible(componentId, visible) {
        const state = this.state.componentStates[componentId];
        if (!state) return;
        
        const oldVisible = state.visible;
        state.visible = visible;
        
        this.renderComponent(componentId);
        this.emit('onStateChange', { componentId, type: 'visible', oldValue: oldVisible, newValue: visible });
    },
    
    /**
     * 设置元素点亮状态
     * @param {string} elementId - 元素ID
     * @param {boolean} lit - 是否点亮
     */
    setElement(elementId, lit) {
        this.state.elementStates[elementId] = lit;
        this.renderElement(elementId);
    },
    
    /**
     * 显示组件预设值 (如 "-----", "Err")
     * @param {string} componentId - 组件ID
     * @param {string} presetName - 预设名称
     */
    showPreset(componentId, presetName) {
        const comp = this.state.components[componentId];
        if (!comp) {
            this.warn(' 组件不存在:', componentId);
            return;
        }
        
        // 先从组件自身的presets查找
        let presetValue = comp.presets?.[presetName];
        
        // 如果没有，从commonPresets查找（根据组件类型）
        if (presetValue === undefined && this.state.commonPresets) {
            const typePresets = this.state.commonPresets[comp.type];
            if (typePresets) {
                presetValue = typePresets[presetName];
            }
        }
        
        if (presetValue === undefined) {
            this.warn(' 预设不存在:', componentId, presetName, 
                '组件类型:', comp.type,
                'commonPresets:', Object.keys(this.state.commonPresets),
                '该类型预设:', this.state.commonPresets[comp.type] ? Object.keys(this.state.commonPresets[comp.type]) : '无');
            return;
        }
        
        this.log(' showPreset:', componentId, presetName, '→', presetValue);
        this.setValue(componentId, presetValue);
    },
    
    // ========== 预设系统 ==========
    
    /**
     * 应用界面预设
     * @param {string} presetId - 预设ID
     * @param {object} bindings - 数据绑定 { distance: 12.345, signal: 3, unit: 1, ... }
     */
    applyPreset(presetId, bindings = {}) {
        const preset = this.state.presets[presetId];
        if (!preset) {
            this.warn(' 预设不存在:', presetId);
            return;
        }
        
        this.log(' 应用预设:', presetId, preset.name, '绑定数据:', bindings);
        
        // 开始批量更新 - 暂停事件触发
        this._batchUpdate = true;
        
        // 1. 设置组件状态
        if (preset.components) {
            for (const [compId, config] of Object.entries(preset.components)) {
                if (config.preset) {
                    this.showPreset(compId, config.preset);
                } else if (config.bind) {
                    // 数据绑定 - 根据组件类型处理
                    this.applyBindingToComponent(compId, config.bind, bindings);
                } else if (config.value !== undefined) {
                    this.setValue(compId, config.value);
                } else if (config.mode !== undefined) {
                    this.setMode(compId, config.mode);
                } else if (config.level !== undefined) {
                    this.setLevel(compId, config.level);
                } else if (config.visible !== undefined) {
                    this.setVisible(compId, config.visible);
                }
            }
        }
        
        // 2. 设置图标状态
        if (preset.icons) {
            for (const [iconId, visible] of Object.entries(preset.icons)) {
                this.setVisible(iconId, visible);
            }
        }
        
        // 3. 设置直接元素
        if (preset.elements) {
            for (const elemId of preset.elements) {
                this.setElement(elemId, true);
            }
        }
        
        // 4. 启动行为/动画
        if (preset.behaviors) {
            for (const behaviorId of preset.behaviors) {
                this.startAnimation(behaviorId);
            }
        }
        
        // 5. 执行特殊动作
        if (preset.action) {
            this.executeAction(preset.action);
        }
        
        // 结束批量更新 - 触发一次事件
        this._batchUpdate = false;
        this.emit('onBufferUpdate', { buffer: this.state.buffer });
        
        this.emit('onPresetApplied', { presetId, preset, bindings });
    },
    
    /**
     * 将变量绑定应用到组件
     * @param {string} compId - 组件ID
     * @param {string} varName - 变量名
     * @param {object} bindings - 绑定数据
     */
    applyBindingToComponent(compId, varName, bindings) {
        const comp = this.state.components[compId];
        if (!comp) {
            this.warn(' 绑定组件不存在:', compId);
            return;
        }
        
        const value = bindings[varName];
        if (value === undefined) {
            this.warn(' 绑定变量未提供:', varName, '可用:', Object.keys(bindings));
            return;
        }
        
        this.log(' 应用绑定:', compId, varName, '=', value, '组件类型:', comp.type);
        
        switch (comp.type) {
            case 'NumberDisplay':
                // 数字显示直接设置值
                this.setValue(compId, value);
                break;
                
            case 'ModeSelector':
                // 模式选择器 - 需要将整数值映射到模式名
                const modeName = this.mapValueToMode(comp, varName, value);
                if (modeName) {
                    this.setMode(compId, modeName);
                }
                break;
                
            case 'LevelIndicator':
                // 等级指示器直接设置等级
                this.setLevel(compId, parseInt(value) || 0);
                break;
                
            case 'Icon':
                // 图标设置可见性
                this.setVisible(compId, !!value);
                break;
                
            default:
                this.warn(' 未知组件类型的绑定:', comp.type);
        }
    },
    
    /**
     * 将变量值映射到模式名
     * 支持的映射规则:
     * - unit: 0=m, 1=ft, 2=in
     * - base_back: true=behind, false=front
     * - beep_enable: true=on, false=off
     * - 其他: 尝试直接匹配模式名或按索引
     */
    mapValueToMode(comp, varName, value) {
        const modes = Object.keys(comp.modes || {});
        if (modes.length === 0) return null;
        
        // 特殊变量映射
        if (varName === 'unit') {
            // 单位变量: 0=m, 1=ft, 2=in
            const unitMap = { 0: 'm', 1: 'ft', 2: 'in' };
            const modeName = unitMap[value];
            if (modeName && modes.includes(modeName)) {
                return modeName;
            }
            this.warn(' unit映射失败:', value, '尝试索引');
        }
        
        if (varName === 'base_back') {
            // 基准变量: true=behind(后基准), false=front(前基准)
            const modeName = value ? 'behind' : 'front';
            if (modes.includes(modeName)) {
                return modeName;
            }
        }
        
        if (varName === 'beep_enable') {
            // 蜂鸣器变量: true=on, false=off
            const modeName = value ? 'on' : 'off';
            if (modes.includes(modeName)) {
                return modeName;
            }
        }
        
        // 如果值是字符串且直接匹配模式名
        if (typeof value === 'string' && modes.includes(value)) {
            return value;
        }
        
        // 如果值是数字，按索引选择模式
        if (typeof value === 'number' && value >= 0 && value < modes.length) {
            return modes[value];
        }
        
        // 布尔值映射到第一个/第二个模式
        if (typeof value === 'boolean' && modes.length >= 2) {
            return value ? modes[0] : modes[1];
        }
        
        this.warn(' 无法映射值到模式:', varName, value, '可用模式:', modes);
        return null;
    },
    
    /**
     * 执行特殊动作
     */
    executeAction(action) {
        if (action === 'lcd:showAll') {
            this.showAll();
        } else if (action === 'lcd:clearAll') {
            this.clearAll();
        }
    },
    
    // ========== 动画系统 ==========
    
    /**
     * 启动动画
     * @param {string} animId - 动画ID
     * @param {object} options - 选项 { onComplete, onFrame }
     */
    startAnimation(animId, options = {}) {
        const anim = this.state.animations[animId];
        if (!anim) {
            this.warn(' 动画不存在:', animId);
            return;
        }
        
        // 如果已在运行，先停止
        if (this.state.activeAnimations[animId]) {
            this.stopAnimation(animId);
        }
        
        this.log(' 启动动画:', animId, anim.type);
        
        const animState = {
            id: animId,
            config: anim,
            options,
            frameIndex: 0,
            blinkState: true,
            startTime: Date.now(),
            timer: null,
        };
        
        if (anim.type === 'Blink') {
            this.startBlinkAnimation(animState);
        } else if (anim.type === 'Sequence') {
            this.startSequenceAnimation(animState);
        } else if (anim.type === 'Animation') {
            // 兼容旧格式
            this.startSequenceAnimation(animState);
        }
        
        this.state.activeAnimations[animId] = animState;
        this.emit('onAnimationStart', { animId, anim });
    },
    
    /**
     * 停止动画
     * @param {string} animId - 动画ID
     */
    stopAnimation(animId) {
        const animState = this.state.activeAnimations[animId];
        if (!animState) return;
        
        this.log(' 停止动画:', animId);
        
        if (animState.timer) {
            clearInterval(animState.timer);
            animState.timer = null;
        }
        
        // 恢复元素状态
        const anim = animState.config;
        if (anim.targets) {
            for (const target of anim.targets) {
                this.setElement(target, false);
            }
        }
        
        delete this.state.activeAnimations[animId];
        this.emit('onAnimationEnd', { animId, completed: false });
    },
    
    /**
     * 停止所有动画
     */
    stopAllAnimations() {
        for (const animId of Object.keys(this.state.activeAnimations)) {
            this.stopAnimation(animId);
        }
    },
    
    /**
     * 闪烁动画
     */
    startBlinkAnimation(animState) {
        const anim = animState.config;
        const interval = anim.interval || 300;
        const duty = anim.duty || 50;  // 占空比
        const count = anim.count;  // 闪烁次数 (undefined = 无限)
        
        let blinkCount = 0;
        
        animState.timer = setInterval(() => {
            animState.blinkState = !animState.blinkState;
            
            // 更新目标元素
            if (anim.targets) {
                for (const target of anim.targets) {
                    this.setElement(target, animState.blinkState);
                }
            }
            
            // 更新组件
            if (anim.component) {
                this.setVisible(anim.component, animState.blinkState);
            }
            
            // 检查次数限制
            if (!animState.blinkState) {
                blinkCount++;
                if (count && blinkCount >= count) {
                    this.stopAnimation(animState.id);
                    if (animState.options.onComplete) {
                        animState.options.onComplete();
                    }
                    this.emit('onAnimationEnd', { animId: animState.id, completed: true });
                }
            }
        }, interval * (animState.blinkState ? duty / 100 : (100 - duty) / 100));
    },
    
    /**
     * 序列帧动画
     */
    startSequenceAnimation(animState) {
        const anim = animState.config;
        const frames = anim.frames || [];
        if (frames.length === 0) return;
        
        const playFrame = () => {
            const frame = frames[animState.frameIndex];
            if (!frame) return;
            
            // 应用帧内容
            if (frame.elements) {
                // 先清除所有相关元素
                const allElements = new Set();
                for (const f of frames) {
                    if (f.elements) f.elements.forEach(e => allElements.add(e));
                }
                for (const elem of allElements) {
                    this.setElement(elem, false);
                }
                // 点亮当前帧元素
                for (const elem of frame.elements) {
                    this.setElement(elem, true);
                }
            }
            
            if (frame.mode && anim.component) {
                this.setMode(anim.component, frame.mode);
            }
            
            if (frame.value !== undefined && anim.component) {
                this.setValue(anim.component, frame.value);
            }
            
            if (frame.level !== undefined && anim.component) {
                this.setLevel(anim.component, frame.level);
            }
            
            if (frame.action) {
                this.executeAction(frame.action);
            }
            
            // 回调
            if (animState.options.onFrame) {
                animState.options.onFrame(animState.frameIndex, frame);
            }
            
            // 下一帧
            animState.frameIndex++;
            if (animState.frameIndex >= frames.length) {
                if (anim.loop) {
                    animState.frameIndex = 0;
                } else {
                    // 动画完成
                    clearTimeout(animState.timer);
                    delete this.state.activeAnimations[animState.id];
                    if (animState.options.onComplete) {
                        animState.options.onComplete();
                    }
                    this.emit('onAnimationEnd', { animId: animState.id, completed: true });
                    return;
                }
            }
            
            // 设置下一帧定时器
            const nextFrame = frames[animState.frameIndex];
            const duration = frame.duration || 300;
            animState.timer = setTimeout(playFrame, duration);
        };
        
        // 开始播放
        playFrame();
    },

    // ========== LCD缓冲区操作 ==========
    
    /**
     * 清空缓冲区
     */
    clearBuffer() {
        this.state.buffer.fill(0);
        this.emit('onBufferUpdate', { buffer: this.state.buffer });
    },
    
    /**
     * 全显
     */
    showAll() {
        this.state.buffer.fill(0xFF);
        this.emit('onBufferUpdate', { buffer: this.state.buffer });
    },
    
    /**
     * 清除所有显示
     */
    clearAll() {
        this.clearBuffer();
        // 重置所有元素状态
        for (const key of Object.keys(this.state.elementStates)) {
            this.state.elementStates[key] = false;
        }
    },
    
    /**
     * 设置缓冲区中的段
     * @param {number} seg - SEG索引 (0-53)
     * @param {number} com - COM索引 (0-7)
     * @param {boolean} lit - 是否点亮
     */
    setSegment(seg, com, lit) {
        if (seg < 0 || seg >= 54 || com < 0 || com > 7) {
            console.warn('[LcdRuntime] setSegment: 无效参数', seg, com);
            return;
        }
        
        const bit = this.COM_BIT_MAP[com];
        if (lit) {
            this.state.buffer[seg] |= (1 << bit);
        } else {
            this.state.buffer[seg] &= ~(1 << bit);
        }
        
        // 调试日志
        if (this.DEBUG) {
            console.log(`[LcdRuntime] setSegment(${seg}, ${com}, ${lit}) -> buffer[${seg}] = 0x${this.state.buffer[seg].toString(16)}`);
        }
    },
    
    /**
     * 获取段状态
     */
    getSegment(seg, com) {
        if (seg < 0 || seg >= 54 || com < 0 || com > 7) return false;
        const bit = this.COM_BIT_MAP[com];
        return (this.state.buffer[seg] & (1 << bit)) !== 0;
    },
    
    /**
     * 获取缓冲区副本
     */
    getBuffer() {
        return new Uint8Array(this.state.buffer);
    },
    
    /**
     * 设置缓冲区 (从固件同步)
     */
    setBuffer(buffer) {
        if (buffer.length !== 54) {
            this.warn(' 缓冲区长度错误:', buffer.length);
            return;
        }
        this.state.buffer = new Uint8Array(buffer);
        this.emit('onBufferUpdate', { buffer: this.state.buffer });
    },
    
    // ========== 渲染 ==========
    
    /**
     * 渲染组件到缓冲区
     */
    renderComponent(componentId) {
        const comp = this.state.components[componentId];
        const state = this.state.componentStates[componentId];
        if (!comp || !state) return;
        
        if (!state.visible) {
            // 隐藏组件 - 清除所有相关段
            this.clearComponentSegments(componentId);
            return;
        }
        
        switch (comp.type) {
            case 'NumberDisplay':
                this.renderNumberDisplay(componentId, comp, state);
                break;
            case 'LineDisplay':
            case 'Line':  // 新类型 v3.0
                this.renderLineDisplay(componentId, comp, state);
                break;
            case 'ModeSelector':
                this.renderModeSelector(componentId, comp, state);
                break;
            case 'Selector':  // 新类型 v3.0
                this.renderSelector(componentId, comp, state);
                break;
            case 'LevelIndicator':
                this.renderLevelIndicator(componentId, comp, state);
                break;
            case 'Icon':
                this.renderIcon(componentId, comp, state);
                break;
        }
        
        // 批量更新时不触发事件
        if (!this._batchUpdate) {
            this.emit('onBufferUpdate', { buffer: this.state.buffer });
        }
    },
    
    /**
     * 渲染数字显示组件
     */
    renderNumberDisplay(componentId, comp, state) {
        const config = comp.config;
        if (!config?.digits) return;
        
        const value = String(state.value || '');
        const digits = config.digits;
        const alignment = config.alignment || 'right';
        
        // 解析数字和小数点
        let chars = [];
        let dotPositions = [];
        
        for (let i = 0; i < value.length; i++) {
            const c = value[i];
            if (c === '.') {
                if (chars.length > 0) {
                    dotPositions.push(chars.length - 1);
                }
            } else {
                chars.push(c);
            }
        }
        
        // 对齐处理
        while (chars.length < digits.length) {
            if (alignment === 'right') {
                chars.unshift(' ');
                dotPositions = dotPositions.map(p => p + 1);
            } else {
                chars.push(' ');
            }
        }
        
        // 截断
        if (chars.length > digits.length) {
            chars = chars.slice(chars.length - digits.length);
        }
        
        // 渲染每个数位
        for (let i = 0; i < digits.length; i++) {
            const digitConfig = digits[i];
            const char = chars[i] || ' ';
            this.renderDigit(digitConfig.element, char);
        }
        
        // 渲染小数点
        if (config.dots) {
            for (const dotConfig of config.dots) {
                const showDot = dotPositions.includes(dotConfig.afterDigit);
                this.setElementByName(dotConfig.element, showDot);
            }
        }
        
        // 渲染符号
        if (config.sign) {
            const showMinus = value.startsWith('-');
            this.setElementByName(config.sign.element, showMinus);
        }
    },
    
    /**
     * 渲染 LineDisplay 组件 (数字 + 单位 一体化)
     */
    renderLineDisplay(componentId, comp, state) {
        const digits = comp.digits;
        if (!digits) return;
        
        const rawValue = state.value;
        const dataType = state.dataType || comp.dataType || 'length';
        const emptyDisplay = comp.emptyDisplay || 'dash';
        const showUnit = state.showUnit !== false && comp.showUnit !== false;
        
        // 获取当前单位
        const unit = (typeof UIStore !== 'undefined') ? (UIStore.get('unit') || 0) : 0;
        
        // 空值处理
        if (rawValue === 0 || rawValue === null || rawValue === undefined || rawValue === '') {
            if (emptyDisplay === 'dash') {
                this.renderLineDigits(comp, '-----');
                this.hideLineUnits(comp);
            } else if (emptyDisplay === 'hidden') {
                this.clearLineDisplay(comp);
            } else {
                this.renderLineDigits(comp, '0');
                if (showUnit) this.showLineUnit(comp, unit, dataType);
            }
            return;
        }
        
        // 单位转换
        let displayValue;
        let decimals = 3;
        
        if (typeof UnitConverter !== 'undefined' && typeof rawValue === 'number') {
            const result = UnitConverter.toDisplay(rawValue, unit, dataType);
            displayValue = result.display;
            decimals = result.decimals;
        } else {
            displayValue = String(rawValue);
        }
        
        // 渲染数字
        this.renderLineDigits(comp, displayValue);
        
        // 渲染单位
        if (showUnit) {
            this.showLineUnit(comp, unit, dataType);
        }
    },
    
    /**
     * 渲染 LineDisplay 的数字部分
     */
    renderLineDigits(comp, value) {
        const digits = comp.digits;
        if (!digits) return;
        
        const valueStr = String(value || '');
        const alignment = 'right';
        
        // 解析数字和小数点
        let chars = [];
        let dotPositions = [];
        
        for (let i = 0; i < valueStr.length; i++) {
            const c = valueStr[i];
            if (c === '.') {
                if (chars.length > 0) {
                    dotPositions.push(chars.length - 1);
                }
            } else {
                chars.push(c);
            }
        }
        
        // 右对齐
        while (chars.length < digits.length) {
            chars.unshift(' ');
            dotPositions = dotPositions.map(p => p + 1);
        }
        
        // 截断
        if (chars.length > digits.length) {
            chars = chars.slice(chars.length - digits.length);
        }
        
        // 渲染每个数位
        for (let i = 0; i < digits.length; i++) {
            const digitConfig = digits[i];
            const char = chars[i] || ' ';
            this.renderDigit(digitConfig.element, char);
        }
        
        // 渲染小数点
        if (comp.dots) {
            for (const dotConfig of comp.dots) {
                const showDot = dotPositions.includes(dotConfig.afterDigit);
                this.setElementByName(dotConfig.element, showDot);
            }
        }
    },
    
    /**
     * 显示 LineDisplay 的单位
     */
    showLineUnit(comp, unit, dataType) {
        if (!comp.units) return;
        
        const typeUnits = comp.units[dataType];
        if (!typeUnits) return;
        
        // 单位映射
        const unitMap = {
            length: { 0: 'm', 1: 'ft', 2: 'in' },
            area: { 0: 'm2', 1: 'ft2', 2: 'in2' },
            volume: { 0: 'm3', 1: 'ft3', 2: 'in3' }
        };
        
        const unitSymbol = unitMap[dataType]?.[unit] || 'm';
        
        // 先隐藏所有单位
        this.hideLineUnits(comp);
        
        // 显示当前单位
        const elements = typeUnits[unitSymbol];
        if (elements) {
            for (const elem of elements) {
                this.setElementByName(elem, true);
            }
        }
    },
    
    /**
     * 隐藏 LineDisplay 的所有单位
     */
    hideLineUnits(comp) {
        if (!comp.units) return;
        
        for (const typeUnits of Object.values(comp.units)) {
            for (const elements of Object.values(typeUnits)) {
                for (const elem of elements) {
                    this.setElementByName(elem, false);
                }
            }
        }
    },
    
    /**
     * 清除 LineDisplay 的所有显示
     */
    clearLineDisplay(comp) {
        // 清除数字
        if (comp.digits) {
            for (const digit of comp.digits) {
                this.clearElement(digit.element);
            }
        }
        // 清除小数点
        if (comp.dots) {
            for (const dot of comp.dots) {
                this.setElementByName(dot.element, false);
            }
        }
        // 清除单位
        this.hideLineUnits(comp);
    },
    
    /**
     * 渲染单个数位
     */
    renderDigit(elementName, char) {
        const pattern = this.DIGIT_PATTERNS[char.toUpperCase()] || this.DIGIT_PATTERNS[char] || 0;
        const element = this.findElement(elementName);
        if (!element) return;
        
        // 假设数位有7段 (A-G)
        const segNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        for (let i = 0; i < segNames.length; i++) {
            const seg = element.segments?.find(s => s.name === segNames[i] || s.name === segNames[i].toLowerCase());
            if (seg && seg.seg !== '' && seg.com !== '') {
                const lit = (pattern & (1 << i)) !== 0;
                this.setSegment(parseInt(seg.seg), parseInt(seg.com), lit);
            }
        }
    },
    
    /**
     * 渲染模式选择器
     */
    renderModeSelector(componentId, comp, state) {
        const modes = comp.modes || {};
        const currentMode = state.mode;
        
        // 关闭所有模式的元素
        for (const [mode, elements] of Object.entries(modes)) {
            for (const elemName of elements) {
                this.setElementByName(elemName, mode === currentMode);
            }
        }
    },
    
    /**
     * 渲染 Selector 组件 (新类型 v3.0)
     * 根据 value 显示对应选项的元素
     */
    renderSelector(componentId, comp, state) {
        const options = comp.options || [];
        const frame = comp.frame || [];
        const currentValue = state.value;
        
        // 框架元素始终显示
        for (const elemName of frame) {
            this.setElementByName(elemName, true);
        }
        
        // 收集所有选项的元素
        const allElements = new Set();
        for (const opt of options) {
            for (const elem of opt.elements || []) {
                allElements.add(elem);
            }
        }
        
        // 找到当前选中的选项
        const selectedOpt = options.find(opt => opt.value === currentValue);
        const selectedElements = selectedOpt?.elements || [];
        
        // 设置状态：只显示选中选项的元素
        for (const elem of allElements) {
            this.setElementByName(elem, selectedElements.includes(elem));
        }
    },
    
    /**
     * 渲染等级指示器
     */
    renderLevelIndicator(componentId, comp, state) {
        const levels = comp.levels || [];
        const currentLevel = state.level || 0;
        
        // 显示框架
        if (comp.frame) {
            this.setElementByName(comp.frame, true);
        }
        
        // 显示对应等级的元素
        const elementsToShow = currentLevel > 0 && currentLevel <= levels.length 
            ? levels[currentLevel - 1] 
            : [];
        
        // 收集所有可能的元素
        const allElements = new Set();
        for (const levelElems of levels) {
            for (const elem of levelElems) {
                allElements.add(elem);
            }
        }
        
        // 设置状态
        for (const elem of allElements) {
            this.setElementByName(elem, elementsToShow.includes(elem));
        }
    },
    
    /**
     * 渲染图标
     */
    renderIcon(componentId, comp, state) {
        const elements = comp.elements || [];
        for (const elemName of elements) {
            this.setElementByName(elemName, state.visible);
        }
    },
    
    /**
     * 清除组件的所有段
     */
    clearComponentSegments(componentId) {
        const comp = this.state.components[componentId];
        if (!comp) return;
        
        // 根据组件类型清除相关元素
        if (comp.config?.digits) {
            for (const digit of comp.config.digits) {
                this.clearElement(digit.element);
            }
            if (comp.config.dots) {
                for (const dot of comp.config.dots) {
                    this.setElementByName(dot.element, false);
                }
            }
            if (comp.config.sign) {
                this.setElementByName(comp.config.sign.element, false);
            }
        }
        
        if (comp.modes) {
            for (const elements of Object.values(comp.modes)) {
                for (const elem of elements) {
                    this.setElementByName(elem, false);
                }
            }
        }
        
        if (comp.levels) {
            for (const elements of comp.levels) {
                for (const elem of elements) {
                    this.setElementByName(elem, false);
                }
            }
        }
        
        if (comp.elements) {
            for (const elem of comp.elements) {
                this.setElementByName(elem, false);
            }
        }
    },
    
    /**
     * 渲染单个元素
     */
    renderElement(elementId) {
        const lit = this.state.elementStates[elementId];
        this.setElementByName(elementId, lit);
    },
    
    /**
     * 通过名称设置元素
     */
    setElementByName(elementName, lit) {
        const element = this.findElement(elementName);
        if (!element) return;
        
        for (const seg of element.segments || []) {
            if (seg.seg !== '' && seg.com !== '') {
                this.setSegment(parseInt(seg.seg), parseInt(seg.com), lit);
            }
        }
    },
    
    /**
     * 清除元素的所有段
     */
    clearElement(elementName) {
        this.setElementByName(elementName, false);
    },
    
    /**
     * 查找元素
     */
    findElement(name) {
        if (!this.state.lcdProject?.elements) return null;
        return this.state.lcdProject.elements.find(e => e.name === name || e.id === name);
    },
    
    // ========== 回调系统 ==========
    
    /**
     * 注册回调
     * @param {string} event - 事件名称
     * @param {function} callback - 回调函数
     */
    on(event, callback) {
        if (this.state.callbacks[event]) {
            this.state.callbacks[event].push(callback);
        }
    },
    
    /**
     * 移除回调
     */
    off(event, callback) {
        if (this.state.callbacks[event]) {
            const idx = this.state.callbacks[event].indexOf(callback);
            if (idx >= 0) {
                this.state.callbacks[event].splice(idx, 1);
            }
        }
    },
    
    /**
     * 触发事件
     */
    emit(event, data) {
        if (this.state.callbacks[event]) {
            for (const cb of this.state.callbacks[event]) {
                try {
                    cb(data);
                } catch (e) {
                    console.error('[LcdRuntime] 回调错误:', event, e);
                }
            }
        }
    },
    
    // ========== 状态查询 ==========
    
    /**
     * 获取组件状态
     */
    getComponentState(componentId) {
        return this.state.componentStates[componentId];
    },
    
    /**
     * 获取所有组件状态
     */
    getAllComponentStates() {
        return { ...this.state.componentStates };
    },
    
    /**
     * 获取活动动画列表
     */
    getActiveAnimations() {
        return Object.keys(this.state.activeAnimations);
    },
    
    /**
     * 检查动画是否在运行
     */
    isAnimationRunning(animId) {
        return !!this.state.activeAnimations[animId];
    },
    
    // ========== 销毁 ==========
    
    destroy() {
        this.stopAllAnimations();
        this.state.initialized = false;
        this.state.callbacks = {
            onStateChange: [],
            onAnimationStart: [],
            onAnimationEnd: [],
            onBufferUpdate: [],
            onPresetApplied: [],
        };
    }
};

// 导出为全局对象
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LcdRuntime;
}
