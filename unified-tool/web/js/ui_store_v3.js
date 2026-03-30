/**
 * UIStore v3.0 - UI控制器
 * 
 * 设计原则:
 * - 3种组件类型: Line, Selector, Icon
 * - 组件名 = 变量名，自动绑定
 * - Line: 存原始值(米)，显示时按单位转换
 * - Selector: 用枚举，不用数字
 * - Icon: ICON_ON/OFF
 * 
 * 使用:
 *   await UIStore.init('gd303_mini');
 *   ui.line4.set(12.345, 'length');
 *   ui.unit.set('FT');
 *   ui.laser.set(true);
 */

window.UIStore = {
    DEBUG: true,
    
    log(...args) {
        if (this.DEBUG) console.log('[UIStore]', ...args);
    },
    
    // ========== 常量 ==========
    DATA_TYPE: {
        LENGTH: 'length',
        AREA: 'area',
        VOLUME: 'volume'
    },
    
    SPECIAL: {
        DASH: '-----',
        ERR: 'Err',
        OL: 'OL',
        OFF: 'OFF'
    },
    
    // ========== 状态 ==========
    state: {
        initialized: false,
        deviceId: null,
        components: {},     // 组件定义
        lines: {},          // Line组件实例
        selectors: {},      // Selector组件实例
        icons: {},          // Icon组件实例
    },
    
    // ========== 初始化 ==========
    async init(deviceId) {
        this.log('初始化, 设备:', deviceId);
        this.state.deviceId = deviceId || 'gd303_mini';
        
        // 加载组件定义
        await this.loadComponents();
        
        // 创建组件实例
        this.createComponentInstances();
        
        this.state.initialized = true;
        this.log('初始化完成');
        
        return this;
    },
    
    async loadComponents() {
        try {
            // 优先加载 v3 版本
            if (typeof DeviceConfigManager !== 'undefined') {
                let comps = await DeviceConfigManager.loadConfig('components', this.state.deviceId);
                if (comps?.version?.startsWith('3')) {
                    this.state.components = comps.components || {};
                    return;
                }
            }
            
            // 尝试直接 fetch
            const resp = await fetch(`/api/dm/config/load?device_id=${this.state.deviceId}&type=components`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.success && data.data?.version?.startsWith('3')) {
                    this.state.components = data.data.components || {};
                    return;
                }
            }
            
            this.log('未找到 v3 组件配置，使用默认');
            this.state.components = this.getDefaultComponents();
        } catch (e) {
            console.warn('[UIStore] 加载组件失败:', e);
            this.state.components = this.getDefaultComponents();
        }
    },
    
    getDefaultComponents() {
        return {
            line4: { type: 'Line', digitCount: 5 },
            line3: { type: 'Line', digitCount: 5 },
            line2: { type: 'Line', digitCount: 5 },
            line1: { type: 'Line', digitCount: 5 },
            unit: { type: 'Selector', options: [
                { key: 'M', value: 0 }, { key: 'FT', value: 1 }, { key: 'IN', value: 2 }
            ], default: 0 },
            battery: { type: 'Selector', options: [
                { key: 'EMPTY', value: 0 }, { key: 'LOW', value: 1 },
                { key: 'MID', value: 2 }, { key: 'FULL', value: 3 }
            ], default: 3 },
            base: { type: 'Selector', options: [
                { key: 'FRONT', value: 0 }, { key: 'BEHIND', value: 1 }
            ], default: 1 },
            laser: { type: 'Icon', default: false },
            bluetooth: { type: 'Icon', default: false },
        };
    },
    
    // ========== 创建组件实例 ==========
    createComponentInstances() {
        const self = this;
        
        for (const [name, def] of Object.entries(this.state.components)) {
            switch (def.type) {
                case 'Line':
                    this.state.lines[name] = this.createLineInstance(name, def);
                    break;
                case 'Selector':
                    this.state.selectors[name] = this.createSelectorInstance(name, def);
                    break;
                case 'Icon':
                    this.state.icons[name] = this.createIconInstance(name, def);
                    break;
            }
        }
        
        // 创建全局 ui 对象
        window.ui = {};
        Object.assign(window.ui, this.state.lines);
        Object.assign(window.ui, this.state.selectors);
        Object.assign(window.ui, this.state.icons);
        
        this.log('创建组件:', {
            lines: Object.keys(this.state.lines),
            selectors: Object.keys(this.state.selectors),
            icons: Object.keys(this.state.icons)
        });
    },
    
    // ========== Line 组件 ==========
    createLineInstance(name, def) {
        const self = this;
        
        const instance = {
            _name: name,
            _def: def,
            
            // 状态
            display: '',
            raw_m: 0,
            data_type: 'length',
            
            // 设置数值 (自动转换)
            set(value, type = 'length') {
                this.raw_m = value;
                this.data_type = type;
                this._render();
                self.log(`${this._name}.set(${value}, ${type}) → "${this.display}"`);
            },
            
            // 设置特殊值
            set_str(str) {
                this.display = str;
                this.raw_m = 0;
                this._renderStr();
                self.log(`${this._name}.set_str("${str}")`);
            },
            
            // 内部渲染
            _render() {
                const unitValue = self.state.selectors.unit?.value || 0;
                const unitKey = self.getUnitKey(unitValue);
                const cfg = this._getUnitConfig(unitKey);
                
                if (!cfg) {
                    this.display = String(this.raw_m);
                    return;
                }
                
                let displayVal = this.raw_m * cfg.factor;
                
                // 范围检查
                if (displayVal > cfg.max) {
                    this.display = self.SPECIAL.OL;
                    this._renderToLcd();
                    return;
                }
                
                // 动态小数位 (溢出时后移)
                let decimals = cfg.decimals;
                const digitCount = this._def.digitCount || 5;
                while (displayVal >= Math.pow(10, digitCount - decimals - 1) && decimals > 0) {
                    decimals--;
                }
                
                this.display = displayVal.toFixed(decimals);
                this._renderToLcd();
                this._showUnit(unitKey);
            },
            
            _renderStr() {
                this._renderToLcd();
                this._hideAllUnits();
            },
            
            _renderToLcd() {
                if (typeof LcdRuntime !== 'undefined') {
                    LcdRuntime.setLineDisplay(this._name, this.display);
                }
            },
            
            _getUnitConfig(unitKey) {
                const cfg = this._def.unitConfig;
                if (!cfg) return null;
                const typeCfg = cfg[this.data_type];
                if (!typeCfg) return cfg.length?.[unitKey];
                return typeCfg[unitKey];
            },
            
            _showUnit(unitKey) {
                const units = this._def.units?.[this.data_type];
                if (!units) return;
                
                // 隐藏所有单位
                for (const elems of Object.values(units)) {
                    for (const elem of elems) {
                        if (typeof LcdRuntime !== 'undefined') {
                            LcdRuntime.setElementByName(elem, false);
                        }
                    }
                }
                
                // 显示当前单位
                const typeKey = this.data_type === 'length' ? unitKey : 
                               `${unitKey}${this.data_type === 'area' ? '2' : '3'}`;
                const showElems = units[typeKey] || units[unitKey];
                if (showElems) {
                    for (const elem of showElems) {
                        if (typeof LcdRuntime !== 'undefined') {
                            LcdRuntime.setElementByName(elem, true);
                        }
                    }
                }
            },
            
            _hideAllUnits() {
                const allUnits = this._def.units;
                if (!allUnits) return;
                for (const typeUnits of Object.values(allUnits)) {
                    for (const elems of Object.values(typeUnits)) {
                        for (const elem of elems) {
                            if (typeof LcdRuntime !== 'undefined') {
                                LcdRuntime.setElementByName(elem, false);
                            }
                        }
                    }
                }
            },
            
            // 刷新 (单位切换时调用)
            refresh() {
                if (this.raw_m !== 0) {
                    this._render();
                }
            }
        };
        
        return instance;
    },
    
    // ========== Selector 组件 ==========
    createSelectorInstance(name, def) {
        const self = this;
        
        // 创建选项映射
        const keyToValue = {};
        const valueToKey = {};
        for (const opt of (def.options || [])) {
            keyToValue[opt.key] = opt.value;
            valueToKey[opt.value] = opt.key;
        }
        
        const instance = {
            _name: name,
            _def: def,
            _keyToValue: keyToValue,
            _valueToKey: valueToKey,
            
            // 状态
            value: def.default || 0,
            
            // 设置 (支持枚举key或数值)
            set(v) {
                let newValue;
                if (typeof v === 'string') {
                    newValue = this._keyToValue[v.toUpperCase()];
                    if (newValue === undefined) newValue = parseInt(v) || 0;
                } else {
                    newValue = v;
                }
                
                const oldValue = this.value;
                this.value = newValue;
                
                this._render();
                self.log(`${this._name}.set(${v}) → ${newValue} (was ${oldValue})`);
                
                // 如果是 unit，触发所有 Line 刷新
                if (this._def.triggerRefresh) {
                    self.refreshAllLines();
                }
            },
            
            // 获取当前key
            getKey() {
                return this._valueToKey[this.value] || String(this.value);
            },
            
            _render() {
                const options = this._def.options || [];
                
                // 隐藏所有选项元素
                for (const opt of options) {
                    for (const elem of (opt.elements || [])) {
                        if (typeof LcdRuntime !== 'undefined') {
                            LcdRuntime.setElementByName(elem, false);
                        }
                    }
                }
                
                // 显示当前选项元素
                const currentOpt = options.find(o => o.value === this.value);
                if (currentOpt) {
                    for (const elem of (currentOpt.elements || [])) {
                        if (typeof LcdRuntime !== 'undefined') {
                            LcdRuntime.setElementByName(elem, true);
                        }
                    }
                }
                
                // 显示框架元素 (如电池框)
                for (const elem of (this._def.frame || [])) {
                    if (typeof LcdRuntime !== 'undefined') {
                        LcdRuntime.setElementByName(elem, true);
                    }
                }
            }
        };
        
        return instance;
    },
    
    // ========== Icon 组件 ==========
    createIconInstance(name, def) {
        const self = this;
        
        const instance = {
            _name: name,
            _def: def,
            
            // 状态
            value: def.default || false,
            
            // 设置
            set(v) {
                let newValue;
                if (typeof v === 'string') {
                    newValue = v.toLowerCase() === 'on' || v === '1' || v === 'true';
                } else {
                    newValue = !!v;
                }
                
                this.value = newValue;
                this._render();
                self.log(`${this._name}.set(${v}) → ${newValue}`);
            },
            
            _render() {
                for (const elem of (this._def.elements || [])) {
                    if (typeof LcdRuntime !== 'undefined') {
                        LcdRuntime.setElementByName(elem, this.value);
                    }
                }
            }
        };
        
        return instance;
    },
    
    // ========== 工具方法 ==========
    
    getUnitKey(value) {
        const map = { 0: 'm', 1: 'ft', 2: 'in' };
        return map[value] || 'm';
    },
    
    refreshAllLines() {
        this.log('刷新所有Line');
        for (const line of Object.values(this.state.lines)) {
            line.refresh();
        }
    },
    
    // ========== 获取组件 ==========
    
    getLine(name) {
        return this.state.lines[name];
    },
    
    getSelector(name) {
        return this.state.selectors[name];
    },
    
    getIcon(name) {
        return this.state.icons[name];
    },
    
    // ========== 状态快照 ==========
    
    getSnapshot() {
        const snapshot = {};
        
        for (const [name, line] of Object.entries(this.state.lines)) {
            snapshot[name] = { display: line.display, raw_m: line.raw_m, data_type: line.data_type };
        }
        for (const [name, sel] of Object.entries(this.state.selectors)) {
            snapshot[name] = { value: sel.value, key: sel.getKey() };
        }
        for (const [name, icon] of Object.entries(this.state.icons)) {
            snapshot[name] = { value: icon.value };
        }
        
        return snapshot;
    },
    
    // ========== 重置 ==========
    
    reset() {
        for (const line of Object.values(this.state.lines)) {
            line.display = '';
            line.raw_m = 0;
            line.data_type = 'length';
        }
        for (const [name, sel] of Object.entries(this.state.selectors)) {
            sel.value = this.state.components[name]?.default || 0;
        }
        for (const [name, icon] of Object.entries(this.state.icons)) {
            icon.value = this.state.components[name]?.default || false;
        }
        this.log('重置完成');
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.UIStore;
}
