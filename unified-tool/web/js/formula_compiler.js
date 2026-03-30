/**
 * @file    formula_compiler.js
 * @brief   公式编译器 - 将表达式字符串编译为C代码
 * @version 1.0.0
 * @date    2026-01-01
 * 
 * 支持的语法:
 * - 赋值: line4 = distance, result = a * b
 * - 公式: sqrt(a^2 + b^2), (x + y) / 2
 * - 条件: if x > 0 then y = x
 * - 字符串: line4 = '-----'
 * - 布尔: laser = true
 * - 硬件: hw:beep:50
 * - 预设: preset:idle
 * - 动画: anim:blink:start
 */

window.FormulaCompiler = {
    version: '1.0.0',
    
    // C语言函数映射
    funcMap: {
        'sqrt': 'sqrtf',
        'sin': 'sinf',
        'cos': 'cosf',
        'tan': 'tanf',
        'abs': 'fabsf',
        'pow': 'powf',
        'log': 'logf',
        'exp': 'expf',
        'floor': 'floorf',
        'ceil': 'ceilf',
        'round': 'roundf',
        'min': 'fminf',
        'max': 'fmaxf',
    },
    
    // 变量前缀
    varPrefix: 'g_ui_vars.',
    
    // 已知的Line组件
    lineComponents: ['line1', 'line2', 'line3', 'line4'],
    
    // 已知的Icon组件
    iconComponents: ['laser', 'bluetooth', 'wifi', 'beep_icon'],
    
    // 已知的Selector组件
    selectorComponents: ['unit', 'battery', 'base', 'signal', 'mode'],
    
    // 特殊字符串值
    specialStrings: {
        "'-----'": 'LINE_DASH',
        '"-----"': 'LINE_DASH',
        'dash': 'LINE_DASH',
        "'Err'": 'LINE_ERR',
        '"Err"': 'LINE_ERR',
        'error': 'LINE_ERR',
        "'OL'": 'LINE_OL',
        '"OL"': 'LINE_OL',
        'overflow': 'LINE_OL',
    },
    
    /**
     * 编译单条动作语句为C代码
     * @param {string} action - 动作语句
     * @param {object} context - 上下文 { indent: '        ' }
     * @returns {string} C代码
     */
    compile(action, context = {}) {
        const indent = context.indent || '        ';
        action = action.trim();
        
        if (!action) return '';
        
        // 1. preset:xxx
        if (action.startsWith('preset:')) {
            return this.compilePreset(action, indent);
        }
        
        // 2. anim:xxx:start/stop
        if (action.startsWith('anim:')) {
            return this.compileAnim(action, indent);
        }
        
        // 3. hw:xxx:yyy
        if (action.startsWith('hw:')) {
            return this.compileHardware(action, indent);
        }
        
        // 4. macro:xxx
        if (action.startsWith('macro:')) {
            return this.compileMacro(action, indent, context);
        }
        
        // 5. lcd:showAll / lcd:clearAll
        if (action.startsWith('lcd:')) {
            return this.compileLcd(action, indent);
        }
        
        // 6. if:condition then action
        if (action.startsWith('if:') || action.startsWith('if ')) {
            return this.compileCondition(action, indent, context);
        }
        
        // 7. 赋值语句: var = expr
        if (action.includes('=') && !action.includes('==') && !action.includes('!=')) {
            return this.compileAssignment(action, indent);
        }
        
        // 8. 其他 - 作为注释
        return `${indent}/* TODO: ${action} */\n`;
    },
    
    /**
     * 编译预设动作
     */
    compilePreset(action, indent) {
        const presetId = action.split(':')[1];
        // 预设展开由外部处理，这里生成函数调用
        return `${indent}preset_${this.toVarName(presetId)}();\n`;
    },
    
    /**
     * 编译动画动作
     */
    compileAnim(action, indent) {
        const parts = action.split(':');
        const animId = parts[1];
        const animAction = parts[2] || 'start';
        const animEnum = `ANIM_${this.toEnumName(animId)}`;
        
        if (animAction === 'stop') {
            return `${indent}anim_stop(${animEnum});\n`;
        } else if (animAction === 'startEx') {
            const interval = parts[3] || '0';
            const timeout = parts[4] || '0';
            return `${indent}anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
        } else {
            return `${indent}anim_start(${animEnum});\n`;
        }
    },
    
    /**
     * 编译硬件动作
     */
    compileHardware(action, indent) {
        const parts = action.split(':');
        // hw:beep:50 -> hw_beep(50)
        // hw:laser:on -> hw_laser_on()
        // hw:powerOff -> hw_power_off()
        
        if (parts.length === 2) {
            // hw:powerOff
            return `${indent}hw_${this.toVarName(parts[1])}();\n`;
        } else if (parts.length === 3) {
            const device = parts[1];
            const param = parts[2];
            
            // 检查是否是数字参数
            if (/^\d+$/.test(param)) {
                return `${indent}hw_${device}(${param});\n`;
            } else {
                return `${indent}hw_${device}_${param}();\n`;
            }
        }
        
        return `${indent}/* hw: ${action} */\n`;
    },
    
    /**
     * 编译宏调用
     */
    compileMacro(action, indent, context) {
        const macroId = action.split(':')[1];
        const macrosConfig = context.macrosConfig;
        
        // 如果有宏配置，展开宏
        if (macrosConfig?.macros?.[macroId]) {
            const macro = macrosConfig.macros[macroId];
            let code = `${indent}/* macro:${macroId} - ${macro.name || ''} */\n`;
            
            for (const step of macro.steps || macro.code || []) {
                code += this.compile(step, context);
            }
            
            return code;
        }
        
        // 否则生成函数调用
        return `${indent}macro_${this.toVarName(macroId)}();\n`;
    },
    
    /**
     * 编译LCD动作
     */
    compileLcd(action, indent) {
        if (action === 'lcd:showAll') {
            return `${indent}lcd_show_all();\n`;
        } else if (action === 'lcd:clearAll') {
            return `${indent}lcd_clear_all();\n`;
        }
        return `${indent}/* ${action} */\n`;
    },
    
    /**
     * 编译条件语句
     */
    compileCondition(action, indent, context) {
        // if:condition then action
        // if condition then action
        let match = action.match(/^if[:\s]+(.+?)\s+then\s+(.+)$/i);
        if (!match) {
            return `${indent}/* 无法解析条件: ${action} */\n`;
        }
        
        const condition = this.compileExpression(match[1].trim());
        const thenAction = match[2].trim();
        
        let code = `${indent}if (${condition}) {\n`;
        code += this.compile(thenAction, { ...context, indent: indent + '    ' });
        code += `${indent}}\n`;
        
        return code;
    },
    
    /**
     * 编译赋值语句
     */
    compileAssignment(action, indent) {
        const match = action.match(/^(\w+)\s*=\s*(.+)$/);
        if (!match) {
            return `${indent}/* 无法解析赋值: ${action} */\n`;
        }
        
        const target = match[1].trim().toLowerCase();
        const value = match[2].trim();
        
        // 判断目标类型
        const isLine = this.lineComponents.includes(target);
        const isIcon = this.iconComponents.includes(target);
        const isSelector = this.selectorComponents.includes(target);
        
        // 处理特殊字符串值
        if (this.specialStrings[value]) {
            if (isLine) {
                return `${indent}ui.${target}.set_str(${this.specialStrings[value]});\n`;
            }
        }
        
        // 处理字符串字面量
        if ((value.startsWith("'") && value.endsWith("'")) || 
            (value.startsWith('"') && value.endsWith('"'))) {
            const strValue = value.slice(1, -1);
            if (isLine) {
                return `${indent}ui.${target}.set_str("${strValue}");\n`;
            }
        }
        
        // 处理布尔值
        if (value === 'true' || value === 'false') {
            if (isIcon) {
                return `${indent}ui.${target}.set(${value === 'true' ? 1 : 0});\n`;
            }
        }
        
        // 处理数字
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            if (isLine) {
                return `${indent}${this.varPrefix}${target}_data = ${value}f;\n` +
                       `${indent}ui.${target}.set(${this.varPrefix}${target}_data, DATA_LENGTH);\n`;
            } else if (isSelector) {
                return `${indent}ui.${target}.set(${value});\n`;
            } else if (isIcon) {
                return `${indent}ui.${target}.set(${value});\n`;
            } else {
                return `${indent}${this.varPrefix}${target} = ${value}f;\n`;
            }
        }
        
        // 处理表达式
        const cExpr = this.compileExpression(value);
        
        if (isLine) {
            return `${indent}${this.varPrefix}${target}_data = ${cExpr};\n` +
                   `${indent}ui.${target}.set(${this.varPrefix}${target}_data, DATA_LENGTH);\n`;
        } else if (isIcon) {
            return `${indent}ui.${target}.set(${cExpr});\n`;
        } else if (isSelector) {
            return `${indent}ui.${target}.set(${cExpr});\n`;
        } else {
            return `${indent}${this.varPrefix}${target} = ${cExpr};\n`;
        }
    },
    
    /**
     * 编译表达式为C代码
     */
    compileExpression(expr) {
        if (!expr) return '0';
        
        expr = expr.trim();
        
        // 特殊值
        if (expr === 'true') return '1';
        if (expr === 'false') return '0';
        if (expr === 'distance') return `${this.varPrefix}distance`;
        
        // 纯数字
        if (/^-?\d+(\.\d+)?$/.test(expr)) {
            return expr + (expr.includes('.') ? 'f' : '.0f');
        }
        
        // 单个变量
        if (/^[a-z_][a-z0-9_]*$/i.test(expr)) {
            // 检查是否是Line组件
            if (this.lineComponents.includes(expr.toLowerCase())) {
                return `${this.varPrefix}${expr.toLowerCase()}_data`;
            }
            return `${this.varPrefix}${expr}`;
        }
        
        // 复杂表达式 - 逐步转换
        let result = expr;
        
        // 1. 处理 ^ 运算符 (幂运算)
        // a^2 -> (a * a)
        // a^3 -> powf(a, 3)
        result = result.replace(/(\w+)\^2\b/g, '($1 * $1)');
        result = result.replace(/(\w+)\^(\d+)/g, 'powf($1, $2)');
        result = result.replace(/(\([^)]+\))\^2/g, '($1 * $1)');
        result = result.replace(/(\([^)]+\))\^(\d+)/g, 'powf($1, $2)');
        
        // 2. 替换函数名
        for (const [jsFunc, cFunc] of Object.entries(this.funcMap)) {
            const regex = new RegExp(`\\b${jsFunc}\\s*\\(`, 'g');
            result = result.replace(regex, `${cFunc}(`);
        }
        
        // 3. 替换变量名
        result = result.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (match) => {
            // 跳过C函数名
            if (Object.values(this.funcMap).includes(match)) return match;
            // 跳过关键字
            if (['true', 'false', 'null'].includes(match)) return match;
            // 跳过数字
            if (/^\d/.test(match)) return match;
            
            // Line组件
            if (this.lineComponents.includes(match.toLowerCase())) {
                return `${this.varPrefix}${match.toLowerCase()}_data`;
            }
            
            // 普通变量
            return `${this.varPrefix}${match}`;
        });
        
        return result;
    },
    
    /**
     * 批量编译多条动作
     */
    compileActions(actions, context = {}) {
        if (!Array.isArray(actions)) return '';
        
        let code = '';
        for (const action of actions) {
            code += this.compile(action, context);
        }
        return code;
    },
    
    /**
     * 验证表达式语法
     */
    validate(expr) {
        try {
            // 简单验证：括号匹配
            let depth = 0;
            for (const char of expr) {
                if (char === '(') depth++;
                if (char === ')') depth--;
                if (depth < 0) return { valid: false, error: '括号不匹配' };
            }
            if (depth !== 0) return { valid: false, error: '括号不匹配' };
            
            // 尝试编译
            this.compileExpression(expr);
            return { valid: true };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    },
    
    // 工具函数
    toEnumName(name) {
        return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    },
    
    toVarName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.FormulaCompiler;
}
