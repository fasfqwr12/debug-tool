/**
 * @file    builtin_functions.js
 * @brief   内置函数库 - 提供通用的可配置函数
 * @version 1.0.0
 * @date    2026-01-01
 * 
 * 设计理念：
 * - 每个函数都有 execute() 和 generate() 两个方法
 * - execute() 用于前端模拟器执行
 * - generate() 用于生成C代码
 * - 参数灵活，逻辑通用
 * 
 * 内置函数列表：
 * - shift(components, direction) - 数据移位
 * - calc(formula, vars, target, dataType) - 公式计算
 * - store(source, target) - 数据存储
 * - snapshot(components, slot) - 快照保存/恢复
 * - setIcon(icon, state) - 图标控制
 * - hw(device, action, params) - 硬件控制
 * - setDataType(component, type) - 设置数据类型
 * - showPreset(component, preset) - 显示预设值
 */

window.BuiltinFunctions = {
    version: '1.0.0',
    
    /**
     * shift - 数据移位函数
     * 
     * @param {string[]} components - 组件列表，如 ["line1", "line2", "line3", "line4"]
     * @param {string} direction - 方向: "up" 或 "down"
     * 
     * 示例:
     *   shift(["line1","line2","line3","line4"], "up")
     *   → line1=line2, line2=line3, line3=line4
     *   
     *   shift(["line1","line2","line3","line4"], "down")
     *   → line4=line3, line3=line2, line2=line1
     */
    shift: {
        name: 'shift',
        description: '数据移位',
        params: [
            { name: 'components', type: 'array', description: '组件列表' },
            { name: 'direction', type: 'string', enum: ['up', 'down'], description: '方向' }
        ],
        
        /**
         * 前端执行
         * @param {object} context - { UIStore, LcdRuntime }
         * @param {string[]} components - 组件列表
         * @param {string} direction - 方向
         */
        execute(context, components, direction) {
            const { UIStore } = context;
            if (!UIStore || !components || components.length < 2) return;
            
            if (direction === 'up') {
                // 上移: line1←line2←line3←line4
                for (let i = 0; i < components.length - 1; i++) {
                    const srcValue = UIStore.get(components[i + 1]);
                    UIStore.set(components[i], srcValue);
                }
            } else {
                // 下移: line4←line3←line2←line1
                for (let i = components.length - 1; i > 0; i--) {
                    const srcValue = UIStore.get(components[i - 1]);
                    UIStore.set(components[i], srcValue);
                }
            }
        },
        
        /**
         * 生成C代码
         * @param {object} context - { varPrefix, indent }
         * @param {string[]} components - 组件列表
         * @param {string} direction - 方向
         * @returns {string} C代码
         */
        generate(context, components, direction) {
            const { varPrefix = 'g_ui_vars.', indent = '    ' } = context;
            let code = '';
            
            if (direction === 'up') {
                for (let i = 0; i < components.length - 1; i++) {
                    const dst = components[i];
                    const src = components[i + 1];
                    code += `${indent}${varPrefix}${dst}_data = ${varPrefix}${src}_data;\n`;
                    code += `${indent}ui.${dst}.set(${varPrefix}${dst}_data, ui.${dst}.data_type);\n`;
                }
            } else {
                for (let i = components.length - 1; i > 0; i--) {
                    const dst = components[i];
                    const src = components[i - 1];
                    code += `${indent}${varPrefix}${dst}_data = ${varPrefix}${src}_data;\n`;
                    code += `${indent}ui.${dst}.set(${varPrefix}${dst}_data, ui.${dst}.data_type);\n`;
                }
            }
            
            return code;
        }
    },
    
    /**
     * calc - 公式计算函数
     * 
     * @param {string} formula - 公式，如 "a * b" 或 "sqrt(a^2 + b^2)"
     * @param {object} vars - 变量映射，如 {a: "line2", b: "line3"}
     * @param {string} target - 结果存储目标，如 "line4"
     * @param {string} dataType - 数据类型，如 "area", "volume", "length"
     * 
     * 示例:
     *   calc("a * b", {a:"line2", b:"line3"}, "line4", "area")
     *   → line4 = line2 * line3, dataType = area
     */
    calc: {
        name: 'calc',
        description: '公式计算',
        params: [
            { name: 'formula', type: 'string', description: '数学公式' },
            { name: 'vars', type: 'object', description: '变量映射' },
            { name: 'target', type: 'string', description: '结果存储目标' },
            { name: 'dataType', type: 'string', enum: ['length', 'area', 'volume'], description: '数据类型' }
        ],
        
        execute(context, formula, vars, target, dataType) {
            const { UIStore, FormulaCompiler } = context;
            if (!UIStore || !FormulaCompiler) return;
            
            // 构建变量值映射
            const values = {};
            for (const [varName, compName] of Object.entries(vars || {})) {
                values[varName] = UIStore.get(compName) || 0;
            }
            
            // 计算结果
            const result = FormulaCompiler.evaluate(formula, values);
            
            // 存储结果
            UIStore.set(target, result);
            
            // 设置数据类型
            if (dataType && context.LcdRuntime) {
                context.LcdRuntime.setDataType(target, dataType);
            }
        },
        
        generate(context, formula, vars, target, dataType) {
            const { varPrefix = 'g_ui_vars.', indent = '    ', FormulaCompiler } = context;
            
            // 使用公式编译器的 compileExpression 生成C代码
            const cExpr = FormulaCompiler ? 
                FormulaCompiler.compileExpression(formula) :
                `/* formula: ${formula} */`;
            
            // 数据类型映射
            const dataTypeMap = {
                'length': 'DATA_LENGTH',
                'area': 'DATA_AREA',
                'volume': 'DATA_VOLUME'
            };
            const cDataType = dataTypeMap[dataType] || 'DATA_LENGTH';
            
            let code = `${indent}/* calc: ${formula} */\n`;
            code += `${indent}${varPrefix}${target}_data = ${cExpr};\n`;
            code += `${indent}ui.${target}.set(${varPrefix}${target}_data, ${cDataType});\n`;
            
            return code;
        }
    },
    
    /**
     * store - 数据存储函数
     * 
     * @param {string} source - 源变量或值
     * @param {string} target - 目标组件
     * @param {string} dataType - 可选，数据类型
     */
    store: {
        name: 'store',
        description: '数据存储',
        params: [
            { name: 'source', type: 'string', description: '源变量或值' },
            { name: 'target', type: 'string', description: '目标组件' },
            { name: 'dataType', type: 'string', optional: true, description: '数据类型' }
        ],
        
        execute(context, source, target, dataType) {
            const { UIStore } = context;
            if (!UIStore) return;
            
            // 判断source是变量名还是字面值
            let value;
            if (typeof source === 'number') {
                value = source;
            } else if (source === 'true') {
                value = true;
            } else if (source === 'false') {
                value = false;
            } else if (source.startsWith("'") && source.endsWith("'")) {
                // 字符串预设值，如 '-----'
                value = source.slice(1, -1);
            } else {
                // 变量引用
                value = UIStore.get(source);
            }
            
            UIStore.set(target, value);
        },
        
        generate(context, source, target, dataType) {
            const { varPrefix = 'g_ui_vars.', indent = '    ' } = context;
            let code = '';
            
            // 判断source类型
            if (typeof source === 'number' || !isNaN(parseFloat(source))) {
                // 数字
                code += `${indent}${varPrefix}${target}_data = ${source}f;\n`;
            } else if (source === 'true' || source === 'false') {
                // 布尔值
                code += `${indent}ui.${target}.set(${source === 'true' ? '1' : '0'});\n`;
                return code;
            } else if (source.startsWith("'") && source.endsWith("'")) {
                // 预设值
                const preset = source.slice(1, -1);
                code += `${indent}ui.${target}.show_preset(PRESET_${preset.toUpperCase().replace(/-/g, '_')});\n`;
                return code;
            } else {
                // 变量引用
                code += `${indent}${varPrefix}${target}_data = ${varPrefix}${source}_data;\n`;
            }
            
            // 更新显示
            if (dataType) {
                const dataTypeMap = { 'length': 'DATA_LENGTH', 'area': 'DATA_AREA', 'volume': 'DATA_VOLUME' };
                code += `${indent}ui.${target}.set(${varPrefix}${target}_data, ${dataTypeMap[dataType] || 'DATA_LENGTH'});\n`;
            } else {
                code += `${indent}ui.${target}.set(${varPrefix}${target}_data, ui.${target}.data_type);\n`;
            }
            
            return code;
        }
    },

    /**
     * snapshot - 快照保存/恢复
     * 
     * @param {string[]} components - 要快照的组件列表
     * @param {string} action - "save" 或 "restore"
     * @param {string} slot - 快照槽位名称
     */
    snapshot: {
        name: 'snapshot',
        description: '快照保存/恢复',
        params: [
            { name: 'components', type: 'array', description: '组件列表' },
            { name: 'action', type: 'string', enum: ['save', 'restore'], description: '操作' },
            { name: 'slot', type: 'string', description: '槽位名称' }
        ],
        
        // 快照存储
        _snapshots: {},
        
        execute(context, components, action, slot) {
            const { UIStore } = context;
            if (!UIStore) return;
            
            if (action === 'save') {
                this._snapshots[slot] = {};
                for (const comp of components) {
                    this._snapshots[slot][comp] = UIStore.get(comp);
                }
            } else if (action === 'restore') {
                const snapshot = this._snapshots[slot];
                if (snapshot) {
                    for (const comp of components) {
                        if (snapshot[comp] !== undefined) {
                            UIStore.set(comp, snapshot[comp]);
                        }
                    }
                }
            }
        },
        
        generate(context, components, action, slot) {
            const { varPrefix = 'g_ui_vars.', indent = '    ' } = context;
            let code = '';
            
            const slotVar = `snapshot_${slot}`;
            
            if (action === 'save') {
                code += `${indent}/* snapshot save: ${slot} */\n`;
                for (const comp of components) {
                    code += `${indent}${slotVar}.${comp} = ${varPrefix}${comp}_data;\n`;
                }
            } else {
                code += `${indent}/* snapshot restore: ${slot} */\n`;
                for (const comp of components) {
                    code += `${indent}${varPrefix}${comp}_data = ${slotVar}.${comp};\n`;
                    code += `${indent}ui.${comp}.set(${varPrefix}${comp}_data, ui.${comp}.data_type);\n`;
                }
            }
            
            return code;
        }
    },
    
    /**
     * setIcon - 图标控制
     * 
     * @param {string} icon - 图标组件名
     * @param {boolean|string} state - 状态: true/false 或 "toggle"
     */
    setIcon: {
        name: 'setIcon',
        description: '图标控制',
        params: [
            { name: 'icon', type: 'string', description: '图标组件名' },
            { name: 'state', type: 'boolean|string', description: '状态' }
        ],
        
        execute(context, icon, state) {
            const { UIStore } = context;
            if (!UIStore) return;
            
            if (state === 'toggle') {
                const current = UIStore.get(icon);
                UIStore.set(icon, !current);
            } else {
                UIStore.set(icon, state === true || state === 'true');
            }
        },
        
        generate(context, icon, state) {
            const { indent = '    ' } = context;
            
            if (state === 'toggle') {
                return `${indent}ui.${icon}.set(!ui.${icon}.value);\n`;
            } else {
                const val = (state === true || state === 'true') ? '1' : '0';
                return `${indent}ui.${icon}.set(${val});\n`;
            }
        }
    },
    
    /**
     * hw - 硬件控制
     * 
     * @param {string} device - 设备名: "laser", "beep", "backlight", "power"
     * @param {string} action - 动作: "on", "off", "toggle", 或具体参数
     * @param {object} params - 可选参数
     */
    hw: {
        name: 'hw',
        description: '硬件控制',
        params: [
            { name: 'device', type: 'string', description: '设备名' },
            { name: 'action', type: 'string', description: '动作' },
            { name: 'params', type: 'object', optional: true, description: '参数' }
        ],
        
        execute(context, device, action, params) {
            // 前端模拟：触发回调
            if (context.onHardware) {
                context.onHardware(device, action, params);
            }
            console.log(`[HW] ${device}.${action}`, params || '');
        },
        
        generate(context, device, action, params) {
            const { indent = '    ' } = context;
            
            // 生成硬件回调代码
            const funcName = `hw_${device}_${action}`;
            
            if (params && typeof params === 'object') {
                const paramStr = Object.values(params).join(', ');
                return `${indent}${funcName}(${paramStr});\n`;
            } else if (params !== undefined) {
                return `${indent}${funcName}(${params});\n`;
            } else {
                return `${indent}${funcName}();\n`;
            }
        }
    },
    
    /**
     * setDataType - 设置组件数据类型
     * 
     * @param {string} component - 组件名
     * @param {string} dataType - 数据类型: "length", "area", "volume"
     */
    setDataType: {
        name: 'setDataType',
        description: '设置数据类型',
        params: [
            { name: 'component', type: 'string', description: '组件名' },
            { name: 'dataType', type: 'string', enum: ['length', 'area', 'volume'], description: '数据类型' }
        ],
        
        execute(context, component, dataType) {
            if (context.LcdRuntime) {
                context.LcdRuntime.setDataType(component, dataType);
            }
        },
        
        generate(context, component, dataType) {
            const { indent = '    ' } = context;
            const dataTypeMap = { 'length': 'DATA_LENGTH', 'area': 'DATA_AREA', 'volume': 'DATA_VOLUME' };
            return `${indent}ui.${component}.data_type = ${dataTypeMap[dataType] || 'DATA_LENGTH'};\n`;
        }
    },
    
    /**
     * showPreset - 显示预设值
     * 
     * @param {string} component - 组件名
     * @param {string} preset - 预设名: "dash" (-----), "empty", "err", "off"
     */
    showPreset: {
        name: 'showPreset',
        description: '显示预设值',
        params: [
            { name: 'component', type: 'string', description: '组件名' },
            { name: 'preset', type: 'string', enum: ['dash', 'empty', 'err', 'off'], description: '预设名' }
        ],
        
        execute(context, component, preset) {
            const { UIStore, LcdRuntime } = context;
            
            const presetValues = {
                'dash': '-----',
                'empty': '',
                'err': 'Err',
                'off': null
            };
            
            const value = presetValues[preset];
            if (UIStore) {
                UIStore.set(component, value);
            }
        },
        
        generate(context, component, preset) {
            const { indent = '    ' } = context;
            const presetMap = {
                'dash': 'PRESET_DASH',
                'empty': 'PRESET_EMPTY',
                'err': 'PRESET_ERR',
                'off': 'PRESET_OFF'
            };
            return `${indent}ui.${component}.show_preset(${presetMap[preset] || 'PRESET_DASH'});\n`;
        }
    },
    
    /**
     * anim - 动画控制
     * 
     * @param {string} animId - 动画ID
     * @param {string} action - 动作: "start", "stop"
     * @param {object} options - 可选参数: { interval, timeout }
     */
    anim: {
        name: 'anim',
        description: '动画控制',
        params: [
            { name: 'animId', type: 'string', description: '动画ID' },
            { name: 'action', type: 'string', enum: ['start', 'stop'], description: '动作' },
            { name: 'options', type: 'object', optional: true, description: '选项' }
        ],
        
        execute(context, animId, action, options) {
            const { AnimController } = context;
            if (!AnimController) return;
            
            if (action === 'start') {
                if (options && (options.interval || options.timeout)) {
                    AnimController.startEx(animId, options.interval, options.timeout);
                } else {
                    AnimController.start(animId);
                }
            } else if (action === 'stop') {
                AnimController.stop(animId);
            }
        },
        
        generate(context, animId, action, options) {
            const { indent = '    ' } = context;
            const animEnum = `ANIM_${animId.toUpperCase()}`;
            
            if (action === 'start') {
                if (options && (options.interval || options.timeout)) {
                    return `${indent}anim_start_ex(${animEnum}, ${options.interval || 0}, ${options.timeout || 0});\n`;
                }
                return `${indent}anim_start(${animEnum});\n`;
            } else {
                return `${indent}anim_stop(${animEnum});\n`;
            }
        }
    },
    
    /**
     * preset - 应用界面预设
     * 
     * @param {string} presetId - 预设ID
     */
    preset: {
        name: 'preset',
        description: '应用界面预设',
        params: [
            { name: 'presetId', type: 'string', description: '预设ID' }
        ],
        
        execute(context, presetId) {
            const { LcdRuntime } = context;
            if (LcdRuntime) {
                LcdRuntime.applyPreset(presetId);
            }
        },
        
        generate(context, presetId) {
            const { indent = '    ' } = context;
            const presetFunc = `preset_${presetId.replace(/-/g, '_')}`;
            return `${indent}${presetFunc}();\n`;
        }
    },
    
    /**
     * 获取所有内置函数列表
     */
    getAll() {
        return Object.keys(this).filter(k => 
            typeof this[k] === 'object' && 
            this[k].name && 
            this[k].execute
        );
    },
    
    /**
     * 获取函数定义
     */
    get(name) {
        return this[name];
    },
    
    /**
     * 执行函数
     */
    execute(name, context, ...args) {
        const func = this[name];
        if (func && func.execute) {
            return func.execute.call(func, context, ...args);
        }
        console.warn(`[BuiltinFunctions] 未知函数: ${name}`);
    },
    
    /**
     * 生成函数C代码
     */
    generate(name, context, ...args) {
        const func = this[name];
        if (func && func.generate) {
            return func.generate.call(func, context, ...args);
        }
        return `/* unknown function: ${name} */\n`;
    }
};

// Node.js 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.BuiltinFunctions;
}
