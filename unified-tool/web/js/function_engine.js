/**
 * @file    function_engine.js
 * @brief   函数引擎 - 解析和执行函数调用
 * @version 1.0.0
 * @date    2026-01-01
 * 
 * 功能：
 * - 解析函数调用语法
 * - 分发到内置函数或自定义函数
 * - 支持前端执行和C代码生成
 * - 管理自定义函数配置
 * 
 * 函数调用语法：
 *   内置函数: shift(["line1","line2","line3","line4"], "up")
 *   自定义函数: scrollUp4()
 *   简化语法: line4 = distance
 *   宏调用: macro:scrollUp
 */

window.FunctionEngine = {
    version: '1.0.0',
    
    // 自定义函数配置
    customFunctions: null,
    
    // 执行上下文
    context: null,
    
    /**
     * 初始化函数引擎
     * @param {object} options - { customFunctions, context }
     */
    async init(options = {}) {
        this.context = options.context || {};
        
        // 加载自定义函数配置
        if (options.customFunctions) {
            this.customFunctions = options.customFunctions;
        } else if (options.deviceId && window.DeviceConfigManager) {
            try {
                this.customFunctions = await DeviceConfigManager.loadConfig('functions', options.deviceId);
            } catch (e) {
                console.warn('[FunctionEngine] 加载自定义函数失败:', e);
                this.customFunctions = { functions: {} };
            }
        }
        
        console.log('[FunctionEngine] 初始化完成');
    },
    
    /**
     * 设置执行上下文
     */
    setContext(context) {
        this.context = { ...this.context, ...context };
    },
    
    /**
     * 解析动作字符串
     * @param {string} action - 动作字符串
     * @returns {object} { type, name, args }
     */
    parseAction(action) {
        if (!action || typeof action !== 'string') {
            return { type: 'unknown', raw: action };
        }
        
        action = action.trim();
        
        // 1. 宏调用: macro:scrollUp
        if (action.startsWith('macro:')) {
            return {
                type: 'macro',
                name: action.substring(6),
                args: []
            };
        }
        
        // 2. 预设: preset:idle_ready
        if (action.startsWith('preset:')) {
            return {
                type: 'builtin',
                name: 'preset',
                args: [action.substring(7)]
            };
        }
        
        // 3. 动画: anim:laserBlink:start
        if (action.startsWith('anim:')) {
            const parts = action.substring(5).split(':');
            return {
                type: 'builtin',
                name: 'anim',
                args: [parts[0], parts[1] || 'start', {}]
            };
        }
        
        // 4. 硬件: hw:beep:50 或 hw:laser:on
        if (action.startsWith('hw:')) {
            const parts = action.substring(3).split(':');
            return {
                type: 'builtin',
                name: 'hw',
                args: [parts[0], parts[1] || 'on', parts[2] ? parseInt(parts[2]) : undefined]
            };
        }
        
        // 5. 组件操作: comp:setValue:line4:12.345
        if (action.startsWith('comp:')) {
            const parts = action.substring(5).split(':');
            const method = parts[0];
            const comp = parts[1];
            const value = parts[2];
            
            // 映射到内置函数
            switch (method) {
                case 'setValue':
                    return { type: 'builtin', name: 'store', args: [value, comp] };
                case 'setDataType':
                    return { type: 'builtin', name: 'setDataType', args: [comp, value] };
                case 'showPreset':
                    return { type: 'builtin', name: 'showPreset', args: [comp, value] };
                default:
                    return { type: 'unknown', raw: action };
            }
        }
        
        // 6. 赋值: line4 = distance 或 line4 = 12.345 或 line4 = '-----'
        const assignMatch = action.match(/^(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            const target = assignMatch[1];
            let source = assignMatch[2].trim();
            
            // 检查是否是公式计算
            if (source.includes('*') || source.includes('/') || source.includes('+') || 
                source.includes('-') || source.includes('^') || source.includes('sqrt') ||
                source.includes('(')) {
                // 公式计算
                return {
                    type: 'builtin',
                    name: 'calc',
                    args: [source, {}, target, 'length']
                };
            }
            
            // 简单赋值
            return {
                type: 'builtin',
                name: 'store',
                args: [source, target]
            };
        }
        
        // 7. 函数调用: funcName(arg1, arg2, ...)
        const funcMatch = action.match(/^(\w+)\s*\((.*)\)$/);
        if (funcMatch) {
            const funcName = funcMatch[1];
            const argsStr = funcMatch[2];
            
            // 解析参数
            const args = this.parseArgs(argsStr);
            
            // 检查是否是内置函数
            if (window.BuiltinFunctions && window.BuiltinFunctions[funcName]) {
                return { type: 'builtin', name: funcName, args };
            }
            
            // 检查是否是自定义函数
            if (this.customFunctions?.functions?.[funcName]) {
                return { type: 'custom', name: funcName, args };
            }
            
            return { type: 'unknown', name: funcName, args };
        }
        
        // 8. 简单函数调用（无参数）: scrollUp4
        if (/^\w+$/.test(action)) {
            // 检查自定义函数
            if (this.customFunctions?.functions?.[action]) {
                return { type: 'custom', name: action, args: [] };
            }
        }
        
        return { type: 'unknown', raw: action };
    },
    
    /**
     * 解析参数字符串
     */
    parseArgs(argsStr) {
        if (!argsStr || !argsStr.trim()) return [];
        
        const args = [];
        let current = '';
        let depth = 0;
        let inString = false;
        let stringChar = '';
        
        for (let i = 0; i < argsStr.length; i++) {
            const c = argsStr[i];
            
            if (inString) {
                current += c;
                if (c === stringChar && argsStr[i - 1] !== '\\') {
                    inString = false;
                }
            } else if (c === '"' || c === "'") {
                inString = true;
                stringChar = c;
                current += c;
            } else if (c === '[' || c === '{' || c === '(') {
                depth++;
                current += c;
            } else if (c === ']' || c === '}' || c === ')') {
                depth--;
                current += c;
            } else if (c === ',' && depth === 0) {
                args.push(this.parseValue(current.trim()));
                current = '';
            } else {
                current += c;
            }
        }
        
        if (current.trim()) {
            args.push(this.parseValue(current.trim()));
        }
        
        return args;
    },
    
    /**
     * 解析单个值
     */
    parseValue(str) {
        if (!str) return null;
        
        // 数字
        if (/^-?\d+(\.\d+)?$/.test(str)) {
            return parseFloat(str);
        }
        
        // 布尔
        if (str === 'true') return true;
        if (str === 'false') return false;
        
        // null
        if (str === 'null') return null;
        
        // 字符串（带引号）
        if ((str.startsWith('"') && str.endsWith('"')) ||
            (str.startsWith("'") && str.endsWith("'"))) {
            return str.slice(1, -1);
        }
        
        // 数组
        if (str.startsWith('[') && str.endsWith(']')) {
            try {
                return JSON.parse(str);
            } catch (e) {
                return str;
            }
        }
        
        // 对象
        if (str.startsWith('{') && str.endsWith('}')) {
            try {
                return JSON.parse(str);
            } catch (e) {
                return str;
            }
        }
        
        // 其他作为字符串
        return str;
    },

    /**
     * 执行动作（前端模拟）
     * @param {string} action - 动作字符串
     * @param {object} context - 可选，覆盖默认上下文
     * @returns {any} 执行结果
     */
    execute(action, context) {
        const ctx = { ...this.context, ...context };
        const parsed = this.parseAction(action);
        
        switch (parsed.type) {
            case 'builtin':
                return this.executeBuiltin(parsed.name, parsed.args, ctx);
                
            case 'custom':
                return this.executeCustom(parsed.name, parsed.args, ctx);
                
            case 'macro':
                return this.executeMacro(parsed.name, ctx);
                
            default:
                console.warn('[FunctionEngine] 未知动作:', action);
                return null;
        }
    },
    
    /**
     * 执行内置函数
     */
    executeBuiltin(name, args, context) {
        if (!window.BuiltinFunctions) {
            console.error('[FunctionEngine] BuiltinFunctions 未加载');
            return null;
        }
        
        return window.BuiltinFunctions.execute(name, context, ...args);
    },
    
    /**
     * 执行自定义函数
     */
    executeCustom(name, args, context) {
        const func = this.customFunctions?.functions?.[name];
        if (!func) {
            console.warn('[FunctionEngine] 自定义函数不存在:', name);
            return null;
        }
        
        // 绑定参数
        const boundContext = { ...context };
        if (func.params && args.length > 0) {
            func.params.forEach((param, i) => {
                if (args[i] !== undefined) {
                    boundContext[param.name] = args[i];
                }
            });
        }
        
        // 执行步骤
        if (func.steps) {
            for (const step of func.steps) {
                this.execute(step, boundContext);
            }
        }
        
        // 执行内置函数调用
        if (func.builtin) {
            const builtinArgs = this.resolveArgs(func.builtin.args, boundContext);
            return this.executeBuiltin(func.builtin.name, builtinArgs, boundContext);
        }
        
        return null;
    },
    
    /**
     * 执行宏
     */
    executeMacro(macroId, context) {
        // 从 macros.json 获取宏定义
        const macros = context.macros || this.context.macros;
        if (!macros?.macros?.[macroId]) {
            console.warn('[FunctionEngine] 宏不存在:', macroId);
            return null;
        }
        
        const macro = macros.macros[macroId];
        
        // 执行宏步骤
        for (const step of macro.steps) {
            this.execute(step, context);
        }
        
        return null;
    },
    
    /**
     * 解析参数中的变量引用
     */
    resolveArgs(args, context) {
        if (!args) return [];
        
        return args.map(arg => {
            if (typeof arg === 'string' && arg.startsWith('$')) {
                // 变量引用: $components → context.components
                const varName = arg.substring(1);
                return context[varName];
            }
            return arg;
        });
    },
    
    /**
     * 生成C代码
     * @param {string} action - 动作字符串
     * @param {object} context - 生成上下文
     * @returns {string} C代码
     */
    generate(action, context) {
        const ctx = { 
            varPrefix: 'g_ui_vars.',
            indent: '    ',
            FormulaCompiler: window.FormulaCompiler,
            ...this.context, 
            ...context 
        };
        
        const parsed = this.parseAction(action);
        
        switch (parsed.type) {
            case 'builtin':
                return this.generateBuiltin(parsed.name, parsed.args, ctx);
                
            case 'custom':
                return this.generateCustom(parsed.name, parsed.args, ctx);
                
            case 'macro':
                return this.generateMacro(parsed.name, ctx);
                
            default:
                return `${ctx.indent}/* unknown action: ${action} */\n`;
        }
    },
    
    /**
     * 生成内置函数C代码
     */
    generateBuiltin(name, args, context) {
        if (!window.BuiltinFunctions) {
            return `/* BuiltinFunctions not loaded */\n`;
        }
        
        return window.BuiltinFunctions.generate(name, context, ...args);
    },
    
    /**
     * 生成自定义函数C代码
     */
    generateCustom(name, args, context) {
        const func = this.customFunctions?.functions?.[name];
        if (!func) {
            return `${context.indent}/* custom function not found: ${name} */\n`;
        }
        
        // 如果有内联展开标记，展开步骤
        if (func.inline) {
            let code = `${context.indent}/* ${func.name || name} */\n`;
            
            // 绑定参数
            const boundContext = { ...context };
            if (func.params && args.length > 0) {
                func.params.forEach((param, i) => {
                    if (args[i] !== undefined) {
                        boundContext[param.name] = args[i];
                    }
                });
            }
            
            // 展开步骤
            if (func.steps) {
                for (const step of func.steps) {
                    code += this.generate(step, boundContext);
                }
            }
            
            // 展开内置函数调用
            if (func.builtin) {
                const builtinArgs = this.resolveArgs(func.builtin.args, boundContext);
                code += this.generateBuiltin(func.builtin.name, builtinArgs, boundContext);
            }
            
            return code;
        }
        
        // 否则生成函数调用
        const funcName = `func_${name.replace(/-/g, '_')}`;
        if (args.length > 0) {
            const argsStr = args.map(a => JSON.stringify(a)).join(', ');
            return `${context.indent}${funcName}(${argsStr});\n`;
        }
        return `${context.indent}${funcName}();\n`;
    },
    
    /**
     * 生成宏C代码
     */
    generateMacro(macroId, context) {
        const macros = context.macros || this.context.macros;
        if (!macros?.macros?.[macroId]) {
            return `${context.indent}/* macro not found: ${macroId} */\n`;
        }
        
        const macro = macros.macros[macroId];
        let code = `${context.indent}/* macro:${macroId} - ${macro.name} */\n`;
        
        // 展开宏步骤
        for (const step of macro.steps) {
            code += this.generate(step, context);
        }
        
        return code;
    },
    
    /**
     * 生成自定义函数的C函数定义
     */
    generateFunctionDefinitions(context) {
        if (!this.customFunctions?.functions) return '';
        
        let code = '';
        const ctx = { 
            varPrefix: 'g_ui_vars.',
            indent: '    ',
            FormulaCompiler: window.FormulaCompiler,
            ...context 
        };
        
        for (const [name, func] of Object.entries(this.customFunctions.functions)) {
            if (func.inline) continue; // 内联函数不生成定义
            
            const funcName = `func_${name.replace(/-/g, '_')}`;
            
            // 函数签名
            code += `/* ${func.name || name} */\n`;
            code += `static void ${funcName}(void) {\n`;
            
            // 函数体
            if (func.steps) {
                for (const step of func.steps) {
                    code += this.generate(step, ctx);
                }
            }
            
            if (func.builtin) {
                const builtinArgs = func.builtin.args || [];
                code += this.generateBuiltin(func.builtin.name, builtinArgs, ctx);
            }
            
            code += '}\n\n';
        }
        
        return code;
    },
    
    /**
     * 生成宏的C函数定义
     */
    generateMacroDefinitions(macros, context) {
        if (!macros?.macros) return '';
        
        let code = '';
        const ctx = { 
            varPrefix: 'g_ui_vars.',
            indent: '    ',
            FormulaCompiler: window.FormulaCompiler,
            macros,
            ...context 
        };
        
        for (const [id, macro] of Object.entries(macros.macros)) {
            const funcName = `macro_${id.replace(/-/g, '_')}`;
            
            code += `/* ${macro.name} - ${macro.description || ''} */\n`;
            code += `void ${funcName}(void) {\n`;
            
            for (const step of macro.steps) {
                // 检查是否是嵌套宏调用
                if (step.startsWith('macro:')) {
                    const nestedMacro = step.substring(6);
                    code += `    macro_${nestedMacro.replace(/-/g, '_')}();\n`;
                } else {
                    code += this.generate(step, ctx);
                }
            }
            
            code += '}\n\n';
        }
        
        return code;
    },
    
    /**
     * 获取所有可用函数列表（用于编辑器）
     */
    getAllFunctions() {
        const result = {
            builtin: [],
            custom: [],
            macros: []
        };
        
        // 内置函数
        if (window.BuiltinFunctions) {
            result.builtin = window.BuiltinFunctions.getAll().map(name => {
                const func = window.BuiltinFunctions[name];
                return {
                    name,
                    description: func.description,
                    params: func.params
                };
            });
        }
        
        // 自定义函数
        if (this.customFunctions?.functions) {
            result.custom = Object.entries(this.customFunctions.functions).map(([name, func]) => ({
                name,
                description: func.description || func.name,
                params: func.params,
                category: func.category
            }));
        }
        
        // 宏
        if (this.context.macros?.macros) {
            result.macros = Object.entries(this.context.macros.macros).map(([id, macro]) => ({
                id,
                name: macro.name,
                description: macro.description,
                category: macro.category,
                icon: macro.icon
            }));
        }
        
        return result;
    }
};

// Node.js 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.FunctionEngine;
}
