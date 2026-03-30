/**
 * @file    code_generator_v5.js
 * @brief   UI代码生成器 v5.0 - 配置驱动 + 函数引擎
 * @version 5.0.0
 * @date    2026-01-01
 * 
 * 核心改进:
 * 1. 配置驱动 - 所有逻辑从配置文件读取，不再硬编码
 * 2. 函数引擎 - 使用 FunctionEngine 解析和生成动作代码
 * 3. 公式编译 - 使用 FormulaCompiler 编译数学公式
 * 4. 继承V4优点 - 依赖分析、预设展开、QHsm风格
 * 
 * 依赖:
 * - formula_compiler.js
 * - builtin_functions.js
 * - function_engine.js
 * 
 * 配置文件:
 * - macros.json - 宏动作定义
 * - modes.json - 流程模式定义
 * - functions.json - 自定义函数定义
 */

window.CodeGeneratorV5 = {
    version: '5.0.0',
    
    config: {
        segCount: 54,
        comCount: 8,
        indent: '    ',
        generateComments: true,
    },
    
    // 配置缓存
    macrosConfig: null,
    modesConfig: null,
    functionsConfig: null,
    presetsConfig: null,
    componentsConfig: null,
    animationsConfig: null,
    
    // ========== 主入口 ==========
    async generateAll(projectData) {
        const { 
            lcdProject, components, presets, animations, 
            stateMachine, variables, macros, modes, functions 
        } = projectData;
        
        // 缓存配置
        this.presetsConfig = presets?.presets || {};
        this.componentsConfig = components?.components || {};
        this.animationsConfig = animations?.animations || {};
        this.macrosConfig = macros || { macros: {} };
        this.modesConfig = modes || { modes: {} };
        this.functionsConfig = functions || { functions: {} };
        
        // 初始化函数引擎
        if (window.FunctionEngine) {
            window.FunctionEngine.customFunctions = this.functionsConfig;
            window.FunctionEngine.context = {
                macros: this.macrosConfig,
                FormulaCompiler: window.FormulaCompiler
            };
        }
        
        // Phase 1: 依赖分析
        const deps = this.analyzeDependencies(stateMachine, components, presets, animations);
        console.log('[CodeGen v5] 依赖分析结果:', deps);
        
        // Phase 2: 符号收集
        const symbols = this.collectSymbols(deps, lcdProject, components, presets, animations, stateMachine);
        
        // Phase 3: 代码生成
        const result = {};
        
        // 核心文件
        result['ui_controller.h'] = this.generateUIControllerHeader(symbols, components);
        result['ui_controller.c'] = this.generateUIControllerSource(symbols, components, lcdProject);
        result['lcd_mapping.h'] = this.generateLcdMappingHeader(symbols, lcdProject);
        result['lcd_mapping.c'] = this.generateLcdMappingSource(symbols, lcdProject);
        
        // 状态机
        if (deps.states.size > 0) {
            result['ui_state_machine.h'] = this.generateStateMachineHeader(symbols, stateMachine);
            result['ui_state_machine.c'] = this.generateStateMachineSource(symbols, stateMachine, deps);
        }
        
        // 动画
        if (deps.animations.size > 0) {
            result['ui_animation.h'] = this.generateAnimationHeader(symbols, animations, deps);
            result['ui_animation.c'] = this.generateAnimationSource(symbols, animations, deps);
        }
        
        // 变量系统
        result['ui_variables.h'] = this.generateVariablesHeader(symbols, stateMachine, deps);
        result['ui_variables.c'] = this.generateVariablesSource(symbols, stateMachine, deps);
        
        // 宏函数 (从 macros.json 生成)
        if (Object.keys(this.macrosConfig.macros || {}).length > 0) {
            result['ui_macros.h'] = this.generateMacrosHeader();
            result['ui_macros.c'] = this.generateMacrosSource();
        }
        
        // 流程引擎 (从 modes.json 生成)
        if (Object.keys(this.modesConfig.modes || {}).length > 0) {
            result['ui_flow.h'] = this.generateFlowHeader();
            result['ui_flow.c'] = this.generateFlowSource();
        }
        
        // 自定义函数 (从 functions.json 生成)
        if (Object.keys(this.functionsConfig.functions || {}).length > 0) {
            result['ui_functions.h'] = this.generateFunctionsHeader();
            result['ui_functions.c'] = this.generateFunctionsSource();
        }
        
        // 硬件抽象层
        result['ui_hal.h'] = this.generateHalHeader(symbols);
        result['hw_callbacks.h'] = this.generateHwCallbacksHeader(symbols, deps);
        
        // 主循环模板
        result['main_loop.c'] = this.generateMainLoopTemplate();
        
        // 单位转换器
        result['unit_converter.h'] = this.generateUnitConverterHeader();
        result['unit_converter.c'] = this.generateUnitConverterSource();
        
        return result;
    },
    
    // ========== 动作代码生成 (核心改进) ==========
    
    /**
     * 生成动作代码 - 使用函数引擎
     */
    generateActionCode(action, deps) {
        if (!action) return '';
        
        const indent = '        ';
        
        // 使用函数引擎生成代码
        if (window.FunctionEngine) {
            const context = {
                varPrefix: 'g_ui_vars.',
                indent: indent,
                FormulaCompiler: window.FormulaCompiler,
                macros: this.macrosConfig
            };
            
            const parsed = window.FunctionEngine.parseAction(action);
            
            switch (parsed.type) {
                case 'builtin':
                    return window.FunctionEngine.generateBuiltin(parsed.name, parsed.args, context);
                    
                case 'custom':
                    return window.FunctionEngine.generateCustom(parsed.name, parsed.args, context);
                    
                case 'macro':
                    return this.generateMacroCall(parsed.name, context);
                    
                case 'unknown':
                    // 回退到旧逻辑处理特殊情况
                    break;
            }
        }
        
        // 回退处理
        return this.generateActionCodeFallback(action, deps);
    },
    
    /**
     * 生成宏调用代码
     */
    generateMacroCall(macroId, context) {
        const macro = this.macrosConfig?.macros?.[macroId];
        if (!macro) {
            return `${context.indent}/* macro:${macroId} - 未找到配置 */\n`;
        }
        
        let code = `${context.indent}/* macro:${macroId} - ${macro.name} */\n`;
        
        // 展开宏步骤
        for (const step of macro.steps || []) {
            code += this.generateActionCode(step, {});
        }
        
        return code;
    },
    
    /**
     * 回退处理 - 处理函数引擎不支持的动作
     */
    generateActionCodeFallback(action, deps) {
        const indent = '        ';
        let code = '';
        
        // preset:xxx
        if (action.startsWith('preset:')) {
            const presetId = action.split(':')[1];
            code += this.expandPresetToCode(presetId);
        }
        // anim:xxx:start/stop
        else if (action.startsWith('anim:')) {
            const parts = action.split(':');
            const animId = parts[1];
            const animAction = parts[2] || 'start';
            const animEnum = `ANIM_${animId.toUpperCase()}`;
            
            if (animAction === 'start') {
                code += `${indent}anim_start(${animEnum});\n`;
            } else if (animAction === 'stop') {
                code += `${indent}anim_stop(${animEnum});\n`;
            } else if (animAction === 'startEx') {
                const interval = parts[3] || '0';
                const timeout = parts[4] || '0';
                code += `${indent}anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
            }
        }
        // flow:xxx - 从 modes.json 生成
        else if (action.startsWith('flow:')) {
            code += this.generateFlowActionCode(action);
        }
        // comp:xxx:yyy:zzz
        else if (action.startsWith('comp:')) {
            const parts = action.split(':');
            const method = parts[1];
            const compId = parts[2];
            const value = parts[3];
            
            switch (method) {
                case 'setValue':
                    code += `${indent}ui.${compId}.set(${value});\n`;
                    break;
                case 'setDataType':
                    const dtMap = { 'length': 'DATA_LENGTH', 'area': 'DATA_AREA', 'volume': 'DATA_VOLUME' };
                    code += `${indent}ui.${compId}.data_type = ${dtMap[value] || 'DATA_LENGTH'};\n`;
                    break;
                case 'showPreset':
                    const presetMap = { 'dash': 'LINE_DASH', 'err': 'LINE_ERR', 'empty': '""' };
                    code += `${indent}ui.${compId}.set_str(${presetMap[value] || '""'});\n`;
                    break;
            }
        }
        // set:xxx = yyy (旧语法兼容)
        else if (action.startsWith('set:')) {
            const expr = action.substring(4);
            code += this.generateAssignCode(expr);
        }
        // xxx = yyy (简化赋值语法)
        else if (action.includes('=')) {
            code += this.generateAssignCode(action);
        }
        // if:condition then action
        else if (action.startsWith('if:')) {
            const match = action.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                const condition = this.convertGuardExpression(match[1].trim());
                code += `${indent}if (${condition}) {\n`;
                code += '    ' + this.generateActionCode(match[2].trim(), deps);
                code += `${indent}}\n`;
            }
        }
        // timeout:ms
        else if (action.startsWith('timeout:')) {
            const ms = action.split(':')[1];
            code += `${indent}/* TODO: 设置超时 ${ms}ms */\n`;
        }
        // hw:device:action
        else if (action.startsWith('hw:')) {
            const parts = action.split(':');
            const device = parts[1];
            const hwAction = parts[2] || 'on';
            const param = parts[3];
            
            if (param) {
                code += `${indent}hw_${device}_${hwAction}(${param});\n`;
            } else {
                code += `${indent}hw_${device}_${hwAction}();\n`;
            }
        }
        else {
            code += `${indent}/* TODO: ${action} */\n`;
        }
        
        return code;
    },

    /**
     * 生成 flow: 动作代码 - 从 modes.json 读取配置
     */
    generateFlowActionCode(action) {
        const parts = action.split(':');
        const cmd = parts[1];
        const param1 = parts[2];
        const param2 = parts[3];
        const indent = '        ';
        
        let code = '';
        
        // 特殊命令处理
        switch (cmd) {
            case 'setType':
                code += `${indent}/* flow:setType:${param1} */\n`;
                code += `${indent}g_flow.mode = FLOW_MODE_${param1.toUpperCase()};\n`;
                code += `${indent}g_flow.step = 0;\n`;
                return code;
                
            case 'storeSlot':
                const slotIdx = parseInt(param1);
                const lineNum = slotIdx + 1;
                code += `${indent}g_ui_vars.line${lineNum}_data = g_ui_vars.distance;\n`;
                code += `${indent}ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
                return code;
                
            case 'scrollUp':
                return this.generateShiftCode(['line1', 'line2', 'line3', 'line4'], 'up');
                
            case 'scrollDown':
                return this.generateShiftCode(['line1', 'line2', 'line3', 'line4'], 'down');
                
            case 'clearSlots':
                code += `${indent}/* 清空数据槽 */\n`;
                for (let i = 1; i <= 4; i++) {
                    code += `${indent}g_ui_vars.line${i}_data = 0;\n`;
                }
                return code;
                
            case 'undo':
                code += `${indent}flow_restore_snapshot();\n`;
                code += `${indent}ui_refresh_all_lines();\n`;
                return code;
                
            case 'onEnterReady':
                code += `${indent}flow_save_snapshot();\n`;
                return code;
                
            case 'updateContinuous':
                code += `${indent}/* 更新连续测量 MAX/MIN */\n`;
                code += `${indent}if (g_ui_vars.max_data < 0 || g_ui_vars.distance > g_ui_vars.max_data) {\n`;
                code += `${indent}    g_ui_vars.max_data = g_ui_vars.distance;\n`;
                code += `${indent}}\n`;
                code += `${indent}if (g_ui_vars.min_data < 0 || g_ui_vars.distance < g_ui_vars.min_data) {\n`;
                code += `${indent}    g_ui_vars.min_data = g_ui_vars.distance;\n`;
                code += `${indent}}\n`;
                code += `${indent}ui.line2.set(g_ui_vars.max_data, DATA_LENGTH);\n`;
                code += `${indent}ui.line3.set(g_ui_vars.min_data, DATA_LENGTH);\n`;
                code += `${indent}ui.line4.set(g_ui_vars.distance, DATA_LENGTH);\n`;
                return code;
                
            case 'resetContinuous':
                code += `${indent}g_ui_vars.max_data = -1;\n`;
                code += `${indent}g_ui_vars.min_data = -1;\n`;
                return code;
        }
        
        // 计算命令 - 从 modes.json 读取公式
        if (cmd.startsWith('calc')) {
            const modeId = cmd.replace('calc', '').toLowerCase() || param1;
            return this.generateCalcFromMode(modeId);
        }
        
        code += `${indent}/* TODO: flow:${cmd} */\n`;
        return code;
    },
    
    /**
     * 从 modes.json 生成计算代码
     */
    generateCalcFromMode(modeId) {
        const mode = this.modesConfig?.modes?.[modeId];
        const indent = '        ';
        
        if (!mode?.calculate) {
            return `${indent}/* mode:${modeId} - 无计算公式 */\n`;
        }
        
        const calc = mode.calculate;
        let code = `${indent}/* ${mode.name}: ${calc.formula} */\n`;
        
        // 使用公式编译器的 compileExpression 方法
        if (window.FormulaCompiler) {
            // 编译公式表达式为C代码
            const cExpr = window.FormulaCompiler.compileExpression(calc.formula);
            
            const resultVar = calc.resultStore || 'line4';
            const dataTypeMap = { 'length': 'DATA_LENGTH', 'area': 'DATA_AREA', 'volume': 'DATA_VOLUME' };
            const dataType = dataTypeMap[calc.result] || 'DATA_LENGTH';
            
            // 添加验证条件
            if (calc.validate) {
                const condition = this.convertGuardExpression(calc.validate);
                code += `${indent}if (${condition}) {\n`;
                code += `${indent}    g_ui_vars.${resultVar}_data = ${cExpr};\n`;
                code += `${indent}    ui.${resultVar}.set(g_ui_vars.${resultVar}_data, ${dataType});\n`;
                code += `${indent}} else {\n`;
                code += `${indent}    ui.${resultVar}.set_str(LINE_ERR);\n`;
                code += `${indent}}\n`;
            } else {
                code += `${indent}g_ui_vars.${resultVar}_data = ${cExpr};\n`;
                code += `${indent}ui.${resultVar}.set(g_ui_vars.${resultVar}_data, ${dataType});\n`;
            }
        } else {
            code += `${indent}/* FormulaCompiler not loaded */\n`;
        }
        
        return code;
    },
    
    /**
     * 生成移位代码 - 使用内置函数
     */
    generateShiftCode(components, direction) {
        const indent = '        ';
        let code = `${indent}/* ${direction === 'up' ? '数据上移' : '数据下移'} */\n`;
        
        if (direction === 'up') {
            for (let i = 0; i < components.length - 1; i++) {
                const dst = components[i];
                const src = components[i + 1];
                code += `${indent}g_ui_vars.${dst}_data = g_ui_vars.${src}_data;\n`;
            }
        } else {
            for (let i = components.length - 1; i > 0; i--) {
                const dst = components[i];
                const src = components[i - 1];
                code += `${indent}g_ui_vars.${dst}_data = g_ui_vars.${src}_data;\n`;
            }
        }
        
        code += `${indent}ui_refresh_all_lines();\n`;
        return code;
    },
    
    /**
     * 生成赋值代码
     */
    generateAssignCode(expr) {
        const indent = '        ';
        const match = expr.match(/^(\w+)\s*=\s*(.+)/);
        if (!match) return `${indent}/* 无法解析: ${expr} */\n`;
        
        const varName = match[1];
        let value = match[2].trim();
        let code = '';
        
        // 判断目标类型
        const lineMatch = varName.match(/^line(\d)$/i);
        const isIcon = ['laser', 'bluetooth', 'wifi'].includes(varName.toLowerCase());
        
        if (lineMatch) {
            const lineNum = lineMatch[1];
            
            // 字符串预设
            if (value === "'-----'" || value === '"-----"' || value === 'dash') {
                code += `${indent}ui.line${lineNum}.set_str(LINE_DASH);\n`;
            } else if (value === "'Err'" || value === '"Err"' || value === 'error') {
                code += `${indent}ui.line${lineNum}.set_str(LINE_ERR);\n`;
            } else if (value === "''") {
                code += `${indent}ui.line${lineNum}.set_str("");\n`;
            }
            // 变量引用
            else if (value === 'distance') {
                code += `${indent}g_ui_vars.line${lineNum}_data = g_ui_vars.distance;\n`;
                code += `${indent}ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            }
            // 数字
            else if (!isNaN(parseFloat(value))) {
                code += `${indent}g_ui_vars.line${lineNum}_data = ${value}f;\n`;
                code += `${indent}ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            }
            // 公式计算
            else if (value.includes('*') || value.includes('/') || value.includes('+') || 
                     value.includes('-') || value.includes('^') || value.includes('sqrt')) {
                if (window.FormulaCompiler) {
                    // 使用 compileExpression 编译公式表达式
                    const cExpr = window.FormulaCompiler.compileExpression(value);
                    code += `${indent}g_ui_vars.line${lineNum}_data = ${cExpr};\n`;
                    code += `${indent}ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
                }
            }
            // 其他变量
            else {
                code += `${indent}g_ui_vars.line${lineNum}_data = g_ui_vars.${value}_data;\n`;
                code += `${indent}ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            }
        } else if (isIcon) {
            if (value === 'true' || value === '1') {
                code += `${indent}ui.${varName}.set(1);\n`;
            } else if (value === 'false' || value === '0') {
                code += `${indent}ui.${varName}.set(0);\n`;
            } else {
                code += `${indent}ui.${varName}.set(${value});\n`;
            }
        } else {
            // 普通变量
            if (value === 'true') value = '1';
            else if (value === 'false') value = '0';
            code += `${indent}g_ui_vars.${varName} = ${value};\n`;
        }
        
        return code;
    },
    
    // ========== 宏函数生成 (从 macros.json) ==========
    
    generateMacrosHeader() {
        let code = `/**
 * @file    ui_macros.h
 * @brief   宏函数 - 从 macros.json 生成
 * @version ${this.version}
 */

#ifndef UI_MACROS_H
#define UI_MACROS_H

#include <stdint.h>

`;
        
        // 生成宏函数声明
        for (const [id, macro] of Object.entries(this.macrosConfig.macros || {})) {
            const funcName = `macro_${id.replace(/-/g, '_')}`;
            code += `/* ${macro.name} */\n`;
            code += `void ${funcName}(void);\n\n`;
        }
        
        code += `#endif /* UI_MACROS_H */\n`;
        return code;
    },
    
    generateMacrosSource() {
        let code = `/**
 * @file    ui_macros.c
 * @brief   宏函数实现 - 从 macros.json 生成
 * @version ${this.version}
 */

#include "ui_macros.h"
#include "ui_variables.h"
#include "ui_controller.h"
#include "ui_animation.h"
#include "hw_callbacks.h"
#include <math.h>

`;
        
        // 使用函数引擎生成宏定义
        if (window.FunctionEngine) {
            code += window.FunctionEngine.generateMacroDefinitions(this.macrosConfig, {
                varPrefix: 'g_ui_vars.',
                indent: '    '
            });
        } else {
            // 回退：手动生成
            for (const [id, macro] of Object.entries(this.macrosConfig.macros || {})) {
                const funcName = `macro_${id.replace(/-/g, '_')}`;
                code += `/* ${macro.name} - ${macro.description || ''} */\n`;
                code += `void ${funcName}(void) {\n`;
                
                for (const step of macro.steps || []) {
                    code += this.generateActionCode(step, {});
                }
                
                code += `}\n\n`;
            }
        }
        
        return code;
    },

    // ========== 流程引擎生成 (从 modes.json) ==========
    
    generateFlowHeader() {
        const modes = this.modesConfig.modes || {};
        
        let code = `/**
 * @file    ui_flow.h
 * @brief   流程引擎 - 从 modes.json 生成
 * @version ${this.version}
 */

#ifndef UI_FLOW_H
#define UI_FLOW_H

#include <stdint.h>

/* 流程模式枚举 */
typedef enum {
`;
        
        let idx = 0;
        for (const modeId of Object.keys(modes)) {
            code += `    FLOW_MODE_${modeId.toUpperCase()} = ${idx},\n`;
            idx++;
        }
        code += `    FLOW_MODE_COUNT\n`;
        code += `} flow_mode_e;\n\n`;
        
        code += `/* 流程状态 */
typedef struct {
    flow_mode_e mode;
    uint8_t step;
    uint8_t total_steps;
} flow_state_t;

extern flow_state_t g_flow;

/* API */
void flow_init(void);
void flow_set_mode(flow_mode_e mode);
void flow_next_step(void);
void flow_calculate(void);
void flow_reset(void);
void flow_save_snapshot(void);
void flow_restore_snapshot(void);

#endif /* UI_FLOW_H */
`;
        return code;
    },
    
    generateFlowSource() {
        const modes = this.modesConfig.modes || {};
        
        let code = `/**
 * @file    ui_flow.c
 * @brief   流程引擎实现 - 从 modes.json 生成
 * @version ${this.version}
 */

#include "ui_flow.h"
#include "ui_variables.h"
#include "ui_controller.h"
#include <math.h>

/* 流程状态 */
flow_state_t g_flow;

/* 快照存储 */
static struct {
    float line1, line2, line3, line4;
} g_snapshot;

/* 模式步骤数 */
static const uint8_t mode_steps[FLOW_MODE_COUNT] = {
`;
        
        for (const [modeId, mode] of Object.entries(modes)) {
            code += `    ${mode.stepCount || 1},  /* ${modeId} */\n`;
        }
        code += `};\n\n`;
        
        code += `void flow_init(void) {
    g_flow.mode = FLOW_MODE_${Object.keys(modes)[0]?.toUpperCase() || 'SINGLE'};
    g_flow.step = 0;
    g_flow.total_steps = mode_steps[g_flow.mode];
}

void flow_set_mode(flow_mode_e mode) {
    if (mode < FLOW_MODE_COUNT) {
        g_flow.mode = mode;
        g_flow.step = 0;
        g_flow.total_steps = mode_steps[mode];
    }
}

void flow_next_step(void) {
    if (g_flow.step < g_flow.total_steps) {
        g_flow.step++;
    }
}

void flow_reset(void) {
    g_flow.step = 0;
}

void flow_save_snapshot(void) {
    g_snapshot.line1 = g_ui_vars.line1_data;
    g_snapshot.line2 = g_ui_vars.line2_data;
    g_snapshot.line3 = g_ui_vars.line3_data;
    g_snapshot.line4 = g_ui_vars.line4_data;
}

void flow_restore_snapshot(void) {
    g_ui_vars.line1_data = g_snapshot.line1;
    g_ui_vars.line2_data = g_snapshot.line2;
    g_ui_vars.line3_data = g_snapshot.line3;
    g_ui_vars.line4_data = g_snapshot.line4;
}

/* 执行计算 - 从 modes.json 的 calculate.formula 生成 */
void flow_calculate(void) {
    switch (g_flow.mode) {
`;
        
        // 为每个有计算公式的模式生成代码
        for (const [modeId, mode] of Object.entries(modes)) {
            if (!mode.calculate) continue;
            
            const calc = mode.calculate;
            code += `    case FLOW_MODE_${modeId.toUpperCase()}:\n`;
            code += `        /* ${mode.name}: ${calc.formula} */\n`;
            
            // 使用公式编译器的 compileExpression 方法
            if (window.FormulaCompiler) {
                // 编译公式表达式为C代码
                const cExpr = window.FormulaCompiler.compileExpression(calc.formula);
                
                const resultVar = 'line4';
                const dataTypeMap = { 'length': 'DATA_LENGTH', 'area': 'DATA_AREA', 'volume': 'DATA_VOLUME' };
                const dataType = dataTypeMap[calc.result] || 'DATA_LENGTH';
                
                if (calc.validate) {
                    const condition = this.convertGuardExpression(calc.validate);
                    code += `        if (${condition}) {\n`;
                    code += `            g_ui_vars.${resultVar}_data = ${cExpr};\n`;
                    code += `            ui.${resultVar}.set(g_ui_vars.${resultVar}_data, ${dataType});\n`;
                    code += `        } else {\n`;
                    code += `            ui.${resultVar}.set_str(LINE_ERR);\n`;
                    code += `        }\n`;
                } else {
                    code += `        g_ui_vars.${resultVar}_data = ${cExpr};\n`;
                    code += `        ui.${resultVar}.set(g_ui_vars.${resultVar}_data, ${dataType});\n`;
                }
            }
            
            code += `        break;\n\n`;
        }
        
        code += `    default:
        break;
    }
}
`;
        return code;
    },
    
    // ========== 自定义函数生成 (从 functions.json) ==========
    
    generateFunctionsHeader() {
        const funcs = this.functionsConfig.functions || {};
        
        let code = `/**
 * @file    ui_functions.h
 * @brief   自定义函数 - 从 functions.json 生成
 * @version ${this.version}
 */

#ifndef UI_FUNCTIONS_H
#define UI_FUNCTIONS_H

#include <stdint.h>

`;
        
        for (const [name, func] of Object.entries(funcs)) {
            if (func.inline) continue; // 内联函数不生成声明
            
            const funcName = `func_${name.replace(/-/g, '_')}`;
            code += `/* ${func.name || name} */\n`;
            code += `void ${funcName}(void);\n\n`;
        }
        
        code += `#endif /* UI_FUNCTIONS_H */\n`;
        return code;
    },
    
    generateFunctionsSource() {
        let code = `/**
 * @file    ui_functions.c
 * @brief   自定义函数实现 - 从 functions.json 生成
 * @version ${this.version}
 */

#include "ui_functions.h"
#include "ui_variables.h"
#include "ui_controller.h"
#include "ui_macros.h"
#include "hw_callbacks.h"
#include <math.h>

`;
        
        // 使用函数引擎生成
        if (window.FunctionEngine) {
            code += window.FunctionEngine.generateFunctionDefinitions({
                varPrefix: 'g_ui_vars.',
                indent: '    '
            });
        }
        
        return code;
    },
    
    // ========== 辅助方法 ==========
    
    convertGuardExpression(expr) {
        // 替换变量名为 g_ui_vars.xxx
        return expr.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (m) => {
            if (['true', 'false', 'null', 'distance'].includes(m)) {
                if (m === 'distance') return 'g_ui_vars.distance';
                return m;
            }
            // 检查是否是数学函数
            if (['sqrtf', 'sinf', 'cosf', 'fabsf', 'powf'].includes(m)) return m;
            return `g_ui_vars.${m}`;
        });
    },
    
    expandPresetToCode(presetId) {
        const preset = this.presetsConfig?.[presetId];
        if (!preset) {
            return `        /* preset:${presetId} - 未找到配置 */\n`;
        }
        
        let code = `        /* preset:${presetId} - ${preset.name || ''} */\n`;
        
        // LCD动作
        if (preset.action === 'lcd:showAll') {
            code += `        lcd_show_all();\n`;
            return code;
        } else if (preset.action === 'lcd:clearAll') {
            code += `        lcd_clear_all();\n`;
            return code;
        }
        
        // 组件设置
        for (const [compId, compConfig] of Object.entries(preset.components || {})) {
            if (compConfig.preset === 'dash') {
                code += `        ui.${compId}.set_str(LINE_DASH);\n`;
            } else if (compConfig.preset === 'error') {
                code += `        ui.${compId}.set_str(LINE_ERR);\n`;
            } else if (compConfig.value !== undefined) {
                if (typeof compConfig.value === 'number') {
                    code += `        ui.${compId}.set(${compConfig.value}f, DATA_LENGTH);\n`;
                } else if (compConfig.value === '') {
                    code += `        ui.${compId}.set_str("");\n`;
                } else {
                    code += `        ui.${compId}.set_str("${compConfig.value}");\n`;
                }
            } else if (compConfig.visible !== undefined) {
                code += `        ui.${compId}.set(${compConfig.visible ? 1 : 0});\n`;
            }
        }
        
        // 启动动画
        for (const animId of preset.behaviors || []) {
            code += `        anim_start(ANIM_${animId.toUpperCase()});\n`;
        }
        
        return code;
    },

    // ========== Phase 1: 依赖分析 (继承自V4) ==========
    
    analyzeDependencies(stateMachine, components, presets, animations) {
        const deps = {
            states: new Set(),
            events: new Set(),
            presets: new Set(),
            animations: new Set(),
            components: new Set(),
            elements: new Set(),
            variables: new Set(),
            hardwareCallbacks: new Set(),
            macros: new Set(),
            flows: new Set(),
        };
        
        if (!stateMachine?.hierarchy) return deps;
        
        // 递归遍历所有状态
        const traverseState = (state, parentId = null) => {
            if (!state) return;
            
            deps.states.add(state.id);
            
            for (const action of state.entryActions || []) {
                this.analyzeAction(action, deps);
            }
            
            for (const action of state.exitActions || []) {
                this.analyzeAction(action, deps);
            }
            
            if (state.children) {
                for (const child of Object.values(state.children)) {
                    traverseState(child, state.id);
                }
            }
        };
        
        traverseState(stateMachine.hierarchy.ROOT);
        
        // 分析转移
        for (const trans of stateMachine.transitions || []) {
            if (trans.event) {
                deps.events.add(trans.event);
            }
            for (const action of trans.actions || []) {
                this.analyzeAction(action, deps);
            }
        }
        
        // 展开预设依赖
        for (const presetId of deps.presets) {
            const preset = presets?.presets?.[presetId];
            if (preset) {
                for (const compId of Object.keys(preset.components || {})) {
                    deps.components.add(compId);
                }
                for (const animId of preset.behaviors || []) {
                    deps.animations.add(animId);
                }
            }
        }
        
        // 展开组件依赖
        const comps = components?.components || {};
        for (const compId of deps.components) {
            const comp = comps[compId];
            if (comp) {
                this.collectComponentElements(comp, deps.elements);
                for (const [key, actions] of Object.entries(comp.onSet || {})) {
                    if (actions.anim?.id) deps.animations.add(actions.anim.id);
                    if (actions.hardware) deps.hardwareCallbacks.add(actions.hardware);
                }
            }
        }
        
        return deps;
    },
    
    analyzeAction(action, deps) {
        if (!action) return;
        
        if (action.startsWith('preset:')) {
            deps.presets.add(action.split(':')[1]);
        } else if (action.startsWith('anim:')) {
            deps.animations.add(action.split(':')[1]);
        } else if (action.startsWith('comp:')) {
            const parts = action.split(':');
            if (parts[2]) deps.components.add(parts[2]);
        } else if (action.startsWith('macro:')) {
            deps.macros.add(action.split(':')[1]);
        } else if (action.startsWith('flow:')) {
            deps.flows.add(action.split(':')[1]);
            // flow动作需要的变量
            deps.variables.add('line1_data');
            deps.variables.add('line2_data');
            deps.variables.add('line3_data');
            deps.variables.add('line4_data');
            deps.variables.add('distance');
        } else if (action.includes('=')) {
            // 赋值语句中的变量
            const match = action.match(/^(\w+)\s*=\s*(.+)/);
            if (match) {
                deps.variables.add(match[1]);
            }
        } else if (action.startsWith('hw:')) {
            deps.hardwareCallbacks.add(action.split(':')[1]);
        }
    },
    
    collectComponentElements(comp, elements) {
        if (comp.elements) {
            for (const el of comp.elements) {
                elements.add(el);
            }
        }
        if (comp.digits) {
            for (const d of comp.digits) {
                elements.add(d);
            }
        }
        if (comp.dots) {
            for (const d of comp.dots) {
                elements.add(d);
            }
        }
        if (comp.units) {
            for (const unitGroup of Object.values(comp.units)) {
                for (const unitElements of Object.values(unitGroup)) {
                    for (const el of unitElements) {
                        elements.add(el);
                    }
                }
            }
        }
    },
    
    // ========== Phase 2: 符号收集 ==========
    
    collectSymbols(deps, lcdProject, components, presets, animations, stateMachine) {
        // 使用V4的符号收集方法，确保结构兼容
        if (window.CodeGeneratorV4?.collectSymbols) {
            return window.CodeGeneratorV4.collectSymbols(deps, lcdProject, components, presets, animations, stateMachine);
        }
        
        // 回退：返回V4兼容的结构
        return {
            states: [],
            stateGroups: {},
            events: [],
            presets: [],
            animations: [],
            components: { lines: [], selectors: [], icons: [] },
            elements: [],
            variables: [],
            hardwareCallbacks: [],
        };
    },
    
    collectElementSymbols(lcdProject) {
        const symbols = {};
        for (const el of lcdProject?.elements || []) {
            symbols[el.name] = {
                id: el.id,
                name: el.name,
                type: el.type,
                segments: el.segments || []
            };
        }
        return symbols;
    },
    
    collectComponentSymbols(components) {
        const symbols = {};
        for (const [id, comp] of Object.entries(components?.components || {})) {
            symbols[id] = {
                id,
                type: comp.type,
                elements: comp.elements || comp.digits || [],
            };
        }
        return symbols;
    },
    
    collectPresetSymbols(presets) {
        const symbols = {};
        for (const [id, preset] of Object.entries(presets?.presets || {})) {
            symbols[id] = {
                id,
                name: preset.name,
                components: Object.keys(preset.components || {}),
            };
        }
        return symbols;
    },
    
    collectAnimationSymbols(animations) {
        const symbols = {};
        for (const [id, anim] of Object.entries(animations?.animations || {})) {
            symbols[id] = {
                id,
                name: anim.name,
                type: anim.type,
            };
        }
        return symbols;
    },
    
    collectStateSymbols(stateMachine) {
        const symbols = {};
        const traverse = (state) => {
            if (!state) return;
            symbols[state.id] = {
                id: state.id,
                name: state.name,
                parent: state.parent,
            };
            if (state.children) {
                for (const child of Object.values(state.children)) {
                    traverse(child);
                }
            }
        };
        traverse(stateMachine?.hierarchy?.ROOT);
        return symbols;
    },
    
    collectEventSymbols(stateMachine) {
        const symbols = new Set();
        for (const trans of stateMachine?.transitions || []) {
            if (trans.event) symbols.add(trans.event);
        }
        return symbols;
    },
    
    // ========== 代码生成方法 (简化版，完整版继承V4) ==========
    
    generateUIControllerHeader(symbols, components) {
        // 继承V4的实现
        return window.CodeGeneratorV4?.generateUIControllerHeader?.(symbols, components) || 
               '/* ui_controller.h - 请确保加载 code_generator_v4.js */\n';
    },
    
    generateUIControllerSource(symbols, components, lcdProject) {
        return window.CodeGeneratorV4?.generateUIControllerSource?.(symbols, components, lcdProject) ||
               '/* ui_controller.c */\n';
    },
    
    generateLcdMappingHeader(symbols, lcdProject) {
        return window.CodeGeneratorV4?.generateLcdMappingHeader?.(symbols, lcdProject) ||
               '/* lcd_mapping.h */\n';
    },
    
    generateLcdMappingSource(symbols, lcdProject) {
        return window.CodeGeneratorV4?.generateLcdMappingSource?.(symbols, lcdProject) ||
               '/* lcd_mapping.c */\n';
    },
    
    generateStateMachineHeader(symbols, stateMachine) {
        return window.CodeGeneratorV4?.generateStateMachineHeader?.(symbols, stateMachine) ||
               '/* ui_state_machine.h */\n';
    },
    
    generateStateMachineSource(symbols, stateMachine, deps) {
        // V5 重写状态机源码生成，使用函数引擎
        if (!stateMachine?.hierarchy) return '/* 无状态机配置 */\n';
        
        let code = `/**
 * @file    ui_state_machine.c
 * @brief   状态机实现 - V5 配置驱动
 * @version ${this.version}
 */

#include "ui_state_machine.h"
#include "ui_controller.h"
#include "ui_variables.h"
#include "ui_animation.h"
#include "ui_macros.h"
#include "ui_flow.h"
#include "hw_callbacks.h"
#include <math.h>

/* 当前状态 */
static hsm_state_e g_current_state = HSM_STATE_ROOT;

`;
        
        // 生成状态处理函数
        const traverse = (state) => {
            if (!state) return;
            
            const stateEnum = `HSM_STATE_${state.id.toUpperCase()}`;
            const funcName = `state_${state.id.toLowerCase()}`;
            
            code += `/* 状态: ${state.name || state.id} */\n`;
            code += `static void ${funcName}_entry(void) {\n`;
            
            for (const action of state.entryActions || []) {
                code += this.generateActionCode(action, deps);
            }
            
            code += `}\n\n`;
            
            code += `static void ${funcName}_exit(void) {\n`;
            
            for (const action of state.exitActions || []) {
                code += this.generateActionCode(action, deps);
            }
            
            code += `}\n\n`;
            
            if (state.children) {
                for (const child of Object.values(state.children)) {
                    traverse(child);
                }
            }
        };
        
        traverse(stateMachine.hierarchy.ROOT);
        
        // 生成事件处理
        code += `/* 事件处理 */\n`;
        code += `void hsm_dispatch(hsm_event_e event) {\n`;
        code += `    switch (g_current_state) {\n`;
        
        // 简化的事件分发
        for (const trans of stateMachine.transitions || []) {
            if (!trans.event) continue;
            
            const fromState = `HSM_STATE_${trans.from.toUpperCase()}`;
            const toState = `HSM_STATE_${trans.to.toUpperCase()}`;
            const eventEnum = `HSM_EVENT_${trans.event.toUpperCase()}`;
            
            code += `    case ${fromState}:\n`;
            code += `        if (event == ${eventEnum}) {\n`;
            
            // 转移动作
            for (const action of trans.actions || []) {
                code += '    ' + this.generateActionCode(action, deps);
            }
            
            code += `            g_current_state = ${toState};\n`;
            code += `        }\n`;
            code += `        break;\n`;
        }
        
        code += `    default:\n`;
        code += `        break;\n`;
        code += `    }\n`;
        code += `}\n`;
        
        return code;
    },
    
    generateAnimationHeader(symbols, animations, deps) {
        return window.CodeGeneratorV4?.generateAnimationHeader?.(symbols, animations, deps) ||
               '/* ui_animation.h */\n';
    },
    
    generateAnimationSource(symbols, animations, deps) {
        return window.CodeGeneratorV4?.generateAnimationSource?.(symbols, animations, deps) ||
               '/* ui_animation.c */\n';
    },
    
    generateVariablesHeader(symbols, stateMachine, deps) {
        return window.CodeGeneratorV4?.generateVariablesHeader?.(symbols, stateMachine, deps) ||
               '/* ui_variables.h */\n';
    },
    
    generateVariablesSource(symbols, stateMachine, deps) {
        return window.CodeGeneratorV4?.generateVariablesSource?.(symbols, stateMachine, deps) ||
               '/* ui_variables.c */\n';
    },
    
    generateHalHeader(symbols) {
        return window.CodeGeneratorV4?.generateHalHeader?.(symbols) ||
               '/* ui_hal.h */\n';
    },
    
    generateHwCallbacksHeader(symbols, deps) {
        return window.CodeGeneratorV4?.generateHwCallbacksHeader?.(symbols, deps) ||
               '/* hw_callbacks.h */\n';
    },
    
    generateMainLoopTemplate() {
        return window.CodeGeneratorV4?.generateMainLoopTemplate?.() || `/**
 * @file    main_loop.c
 * @brief   主循环模板
 */

#include "ui_controller.h"
#include "ui_state_machine.h"
#include "ui_animation.h"
#include "ui_flow.h"
#include "ui_variables.h"

void main_init(void) {
    lcd_init();
    ui_init();
    hsm_init();
    anim_init();
    flow_init();
}

void main_tick(uint32_t ms) {
    anim_tick(ms);
    lcd_update();
}
`;
    },
    
    generateUnitConverterHeader() {
        return window.CodeGeneratorV4?.generateUnitConverterHeader?.() ||
               '/* unit_converter.h */\n';
    },
    
    generateUnitConverterSource() {
        return window.CodeGeneratorV4?.generateUnitConverterSource?.() ||
               '/* unit_converter.c */\n';
    },
};

// Node.js 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.CodeGeneratorV5;
}
