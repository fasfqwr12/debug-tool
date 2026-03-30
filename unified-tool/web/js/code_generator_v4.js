/**
 * @file    code_generator_v4.js
 * @brief   UI代码生成器 v4.0 - 依赖分析 + 按需生成 + QHsm风格
 * @version 4.0.0
 * @date    2026-01-01
 * 
 * 改进点:
 * 1. 依赖分析 - 扫描状态机，只生成用到的代码
 * 2. QHsm风格 - 参考QP框架的状态机实现
 * 3. 完整实现 - line_render() 等函数完整实现
 * 4. 符号统一 - 消除编译错误
 * 
 * 架构:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Phase 1: 依赖分析 → 提取用到的组件/预设/动画/元素           │
 * │ Phase 2: 符号收集 → 生成统一的枚举和定义                    │
 * │ Phase 3: 代码生成 → 只生成需要的文件                        │
 * └─────────────────────────────────────────────────────────────┘
 */

window.CodeGeneratorV4 = {
    version: '4.0.0',
    
    config: {
        segCount: 54,
        comCount: 8,
        indent: '    ',
        generateComments: true,
    },
    
    // ========== 主入口 ==========
    async generateAll(projectData) {
        const { lcdProject, components, presets, animations, stateMachine, variables } = projectData;
        
        // 保存presets配置供展开使用
        this.presetsConfig = presets?.presets || {};
        this.componentsConfig = components?.components || {};
        this.animationsConfig = animations?.animations || {};
        
        // Phase 1: 依赖分析
        const deps = this.analyzeDependencies(stateMachine, components, presets, animations);
        console.log('[CodeGen v4] 依赖分析结果:', deps);
        
        // Phase 2: 符号收集
        const symbols = this.collectSymbols(deps, lcdProject, components, presets, animations, stateMachine);
        
        // Phase 3: 代码生成 (只生成用到的)
        const result = {};
        
        // 核心文件 (总是生成)
        result['ui_controller.h'] = this.generateUIControllerHeader(symbols, components);
        result['ui_controller.c'] = this.generateUIControllerSource(symbols, components, lcdProject);
        result['lcd_mapping.h'] = this.generateLcdMappingHeader(symbols, lcdProject);
        result['lcd_mapping.c'] = this.generateLcdMappingSource(symbols, lcdProject);
        
        // 状态机 (如果有状态)
        if (deps.states.size > 0) {
            result['ui_state_machine.h'] = this.generateStateMachineHeader(symbols, stateMachine);
            result['ui_state_machine.c'] = this.generateStateMachineSource(symbols, stateMachine, deps);
        }
        
        // 注意: 不再生成 ui_presets.h/c，预设动作会展开成组件/动画调用
        
        // 动画 (如果用到)
        if (deps.animations.size > 0) {
            result['ui_animation.h'] = this.generateAnimationHeader(symbols, animations, deps);
            result['ui_animation.c'] = this.generateAnimationSource(symbols, animations, deps);
        }
        
        // 变量系统 (如果用到)
        if (deps.variables.size > 0) {
            result['ui_variables.h'] = this.generateVariablesHeader(symbols, stateMachine, deps);
            result['ui_variables.c'] = this.generateVariablesSource(symbols, stateMachine, deps);
        }
        
        // 硬件抽象层 (模板)
        result['ui_hal.h'] = this.generateHalHeader(symbols);
        result['hw_callbacks.h'] = this.generateHwCallbacksHeader(symbols, deps);
        
        // 主循环模板
        result['main_loop.c'] = this.generateMainLoopTemplate();
        
        // 单位转换器 (总是生成)
        result['unit_converter.h'] = this.generateUnitConverterHeader();
        result['unit_converter.c'] = this.generateUnitConverterSource();
        
        return result;
    },
    
    // ========== Phase 1: 依赖分析 ==========
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
        };
        
        if (!stateMachine?.hierarchy) return deps;
        
        // 递归遍历所有状态
        const traverseState = (state, parentId = null) => {
            if (!state) return;
            
            deps.states.add(state.id);
            
            // 分析入口动作
            for (const action of state.entryActions || []) {
                this.analyzeAction(action, deps);
            }
            
            // 分析退出动作
            for (const action of state.exitActions || []) {
                this.analyzeAction(action, deps);
            }
            
            // 递归处理子状态
            if (state.children) {
                for (const child of Object.values(state.children)) {
                    traverseState(child, state.id);
                }
            }
        };
        
        // 从根状态开始遍历
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
        
        // 展开预设依赖 (预设可能引用组件和动画)
        for (const presetId of deps.presets) {
            const preset = presets?.presets?.[presetId];
            if (preset) {
                // 预设引用的组件
                for (const compId of Object.keys(preset.components || {})) {
                    deps.components.add(compId);
                }
                // 预设引用的动画
                for (const animId of preset.behaviors || []) {
                    deps.animations.add(animId);
                }
            }
        }
        
        // 展开组件依赖 (组件引用元素)
        const comps = components?.components || {};
        for (const compId of deps.components) {
            const comp = comps[compId];
            if (comp) {
                this.collectComponentElements(comp, deps.elements);
                // 组件的 onSet 可能引用动画和硬件回调
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
        
        // preset:xxx
        if (action.startsWith('preset:')) {
            deps.presets.add(action.split(':')[1]);
        }
        // anim:xxx:start/stop/startEx
        else if (action.startsWith('anim:')) {
            const parts = action.split(':');
            deps.animations.add(parts[1]);
        }
        // comp:xxx:yyy:zzz
        else if (action.startsWith('comp:')) {
            const parts = action.split(':');
            if (parts[2]) deps.components.add(parts[2]);
        }
        // flow:xxx 动作 (FlowController)
        else if (action.startsWith('flow:')) {
            const parts = action.split(':');
            const cmd = parts[1];
            // flow动作需要的变量
            if (['storeSlot', 'calcArea', 'calcVolume', 'calcPyth1', 'scrollUp', 'scrollDown'].includes(cmd)) {
                deps.variables.add('line1_data');
                deps.variables.add('line2_data');
                deps.variables.add('line3_data');
                deps.variables.add('line4_data');
                deps.variables.add('distance');
            }
        }
        // macro:xxx 宏动作
        else if (action.startsWith('macro:')) {
            const macroId = action.split(':')[1];
            // 宏动作需要的变量
            if (['scrollUp', 'scrollDown'].includes(macroId)) {
                deps.variables.add('line1_data');
                deps.variables.add('line2_data');
                deps.variables.add('line3_data');
                deps.variables.add('line4_data');
            }
            if (['calcArea', 'calcVolume', 'calcPyth1'].includes(macroId)) {
                deps.variables.add('line1_data');
                deps.variables.add('line2_data');
                deps.variables.add('line3_data');
                deps.variables.add('line4_data');
            }
        }
        // 简化语法: line4 = 12.345 / laser = true
        else if (action.match(/^\w+\s*=\s*.+/)) {
            const match = action.match(/^(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                deps.variables.add(varName);
                // 提取右侧表达式中的变量
                const vars = match[2].match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
                for (const v of vars) {
                    if (!['sqrt', 'sin', 'cos', 'abs', 'true', 'false', 'distance'].includes(v)) {
                        deps.variables.add(v);
                    }
                }
                if (match[2].includes('distance')) {
                    deps.variables.add('distance');
                }
            }
        }
        // set:var = value / assign:var = value
        else if (action.startsWith('set:') || action.startsWith('assign:')) {
            const match = action.match(/(?:set|assign):\s*(\w+)/);
            if (match) deps.variables.add(match[1]);
        }
        // calc:var = expr
        else if (action.startsWith('calc:')) {
            const match = action.match(/calc:\s*(\w+)/);
            if (match) deps.variables.add(match[1]);
            // 提取表达式中的变量
            const exprMatch = action.match(/=\s*(.+)/);
            if (exprMatch) {
                const vars = exprMatch[1].match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
                for (const v of vars) {
                    if (!['sqrt', 'sin', 'cos', 'abs', 'true', 'false'].includes(v)) {
                        deps.variables.add(v);
                    }
                }
            }
        }
        // inc:var / dec:var
        else if (action.startsWith('inc:') || action.startsWith('dec:')) {
            const varName = action.split(':')[1]?.trim();
            if (varName) deps.variables.add(varName);
        }
        // hw:xxx
        else if (action.startsWith('hw:')) {
            const parts = action.split(':');
            deps.hardwareCallbacks.add(parts.slice(1).join('_'));
        }
        // if:condition then action
        else if (action.startsWith('if:')) {
            const match = action.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                // 提取条件中的变量
                const vars = match[1].match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
                for (const v of vars) {
                    if (!['true', 'false', 'null'].includes(v)) {
                        deps.variables.add(v);
                    }
                }
                // 递归分析 then 动作
                this.analyzeAction(match[2], deps);
            }
        }
    },
    
    collectComponentElements(comp, elements) {
        // Line组件的数字位
        for (const digit of comp.digits || []) {
            if (digit.element) elements.add(digit.element);
        }
        // Line组件的小数点
        for (const dot of comp.dots || []) {
            if (dot.element) elements.add(dot.element);
        }
        // Line组件的单位
        if (comp.units) {
            for (const unitGroup of Object.values(comp.units)) {
                for (const unitElems of Object.values(unitGroup)) {
                    for (const elem of unitElems || []) {
                        elements.add(elem);
                    }
                }
            }
        }
        // Selector组件的选项元素
        for (const opt of comp.options || []) {
            for (const elem of opt.elements || []) {
                elements.add(elem);
            }
        }
        // Selector组件的框架元素
        for (const elem of comp.frame || []) {
            elements.add(elem);
        }
        // Icon组件的元素
        for (const elem of comp.elements || []) {
            elements.add(elem);
        }
    },
    
    // ========== Phase 2: 符号收集 ==========
    collectSymbols(deps, lcdProject, components, presets, animations, stateMachine) {
        const symbols = {
            states: [],
            stateGroups: {},  // 按模式分组的状态
            events: [],
            presets: [],
            animations: [],
            components: { lines: [], selectors: [], icons: [] },
            elements: [],
            variables: [],
            hardwareCallbacks: [],
        };
        
        // 收集状态层级信息
        const hierarchy = stateMachine?.hierarchy || {};
        const stateInfo = this.collectStateHierarchy(hierarchy.ROOT);
        
        // 按层级分组状态
        for (const stateId of deps.states) {
            const info = stateInfo[stateId] || { level: 0, parent: null, mode: null };
            const modeKey = info.mode || 'SYSTEM';
            
            if (!symbols.stateGroups[modeKey]) {
                symbols.stateGroups[modeKey] = [];
            }
            
            symbols.stateGroups[modeKey].push({
                id: stateId,
                enum: `UI_STATE_${this.toEnumName(stateId)}`,
                level: info.level,
                parent: info.parent,
                stepIndex: info.stepIndex,
            });
            
            symbols.states.push({
                id: stateId,
                enum: `UI_STATE_${this.toEnumName(stateId)}`,
                level: info.level,
                parent: info.parent,
                mode: modeKey,
                stepIndex: info.stepIndex,
            });
        }
        
        // 事件枚举
        for (const eventId of deps.events) {
            symbols.events.push({
                id: eventId,
                enum: `UI_EVT_${this.toEnumName(eventId)}`,
            });
        }
        
        // 预设枚举
        for (const presetId of deps.presets) {
            symbols.presets.push({
                id: presetId,
                enum: `PRESET_${this.toEnumName(presetId)}`,
            });
        }
        
        // 动画枚举
        for (const animId of deps.animations) {
            symbols.animations.push({
                id: animId,
                enum: `ANIM_${this.toEnumName(animId)}`,
            });
        }
        
        // 组件分类
        const comps = components?.components || {};
        for (const compId of deps.components) {
            const comp = comps[compId];
            if (!comp) continue;
            
            const compInfo = { id: compId, config: comp };
            if (comp.type === 'Line') symbols.components.lines.push(compInfo);
            else if (comp.type === 'Selector') symbols.components.selectors.push(compInfo);
            else if (comp.type === 'Icon') symbols.components.icons.push(compInfo);
        }
        
        // 元素枚举 (只包含用到的)
        const allElements = lcdProject?.elements || [];
        for (const elem of allElements) {
            if (deps.elements.has(elem.name)) {
                symbols.elements.push({
                    name: elem.name,
                    enum: `LCD_ELEM_${this.toEnumName(elem.name)}`,
                    segments: elem.segments || [],
                });
            }
        }
        
        // 变量
        const varsConfig = stateMachine?.variables || {};
        for (const varId of deps.variables) {
            const varDef = varsConfig[varId] || { type: 'float', default: 0 };
            symbols.variables.push({
                id: varId,
                type: varDef.type,
                default: varDef.default,
                description: varDef.description || '',
            });
        }
        
        // 硬件回调
        for (const cb of deps.hardwareCallbacks) {
            symbols.hardwareCallbacks.push({
                name: cb,
                func: `hw_${cb}`,
            });
        }
        
        return symbols;
    },

    // ========== Phase 3: 代码生成 ==========
    
    // ---------- UI控制器头文件 ----------
    generateUIControllerHeader(symbols, components) {
        const { lines, selectors, icons } = symbols.components;
        const date = new Date().toISOString().split('T')[0];
        
        let code = `/**
 * @file    ui_controller.h
 * @brief   UI控制器 v4.0 - 依赖分析生成 (自动生成)
 * @date    ${date}
 * @note    只包含状态机实际用到的组件
 * 
 * 使用方式:
 *   ui.line4.set(12.345f, DATA_LENGTH);  // 设置数字行
 *   ui.unit.set(UNIT_FT);                // 切换单位
 *   ui.laser.set(1);                     // 控制图标
 */

#ifndef UI_CONTROLLER_H
#define UI_CONTROLLER_H

#include <stdint.h>
#include <stdbool.h>
#include "lcd_mapping.h"

/* ========== 数据类型 ========== */
typedef enum {
    DATA_LENGTH = 0,
    DATA_AREA = 1,
    DATA_VOLUME = 2,
} data_type_e;

/* Line特殊显示 */
#define LINE_DASH  "-----"
#define LINE_ERR   "Err"
#define LINE_OL    "OL"

`;
        
        // 为每个Selector生成枚举
        for (const sel of selectors) {
            const enumName = this.toEnumName(sel.id);
            code += `/* ${sel.config.description || sel.id} */\n`;
            code += `typedef enum {\n`;
            for (const opt of sel.config.options || []) {
                code += `    ${enumName}_${opt.key} = ${opt.value},\n`;
            }
            code += `} ${sel.id}_e;\n\n`;
        }
        
        code += `/* ========== 组件结构体 ========== */

`;
        
        // Line组件结构
        if (lines.length > 0) {
            code += `/* Line组件 - 数字行显示 */
typedef struct {
    char display[16];       /* 当前显示字符串 */
    float raw_m;            /* 原始值(米) */
    data_type_e data_type;  /* 数据类型 */
    void (*set)(float value, data_type_e type);
    void (*set_str)(const char* str);
} ui_line_t;

`;
        }
        
        // Selector组件结构
        if (selectors.length > 0) {
            code += `/* Selector组件 - 模式选择器 */
typedef struct {
    uint8_t value;
    void (*set)(uint8_t v);
} ui_sel_t;

`;
        }
        
        // Icon组件结构
        if (icons.length > 0) {
            code += `/* Icon组件 - 图标显示 */
typedef struct {
    uint8_t value;
    void (*set)(uint8_t v);
} ui_icon_t;

`;
        }
        
        // UI控制器结构体
        code += `/* ========== UI控制器 ========== */
typedef struct {
`;
        
        if (lines.length > 0) {
            code += `    /* Line组件 (${lines.length}个) */\n`;
            for (const line of lines) {
                code += `    ui_line_t ${line.id};  /* ${line.config.description || ''} */\n`;
            }
            code += '\n';
        }
        
        if (selectors.length > 0) {
            code += `    /* Selector组件 (${selectors.length}个) */\n`;
            for (const sel of selectors) {
                code += `    ui_sel_t ${sel.id};  /* ${sel.config.description || ''} */\n`;
            }
            code += '\n';
        }
        
        if (icons.length > 0) {
            code += `    /* Icon组件 (${icons.length}个) */\n`;
            for (const icon of icons) {
                code += `    ui_icon_t ${icon.id};  /* ${icon.config.description || ''} */\n`;
            }
        }
        
        code += `} ui_t;

/* 全局实例 */
extern ui_t ui;

/* API函数 */
void ui_init(void);
void ui_update(void);
void ui_refresh_all_lines(void);

#endif /* UI_CONTROLLER_H */
`;
        return code;
    },
    
    // ---------- UI控制器源文件 ----------
    generateUIControllerSource(symbols, components, lcdProject) {
        const { lines, selectors, icons } = symbols.components;
        const date = new Date().toISOString().split('T')[0];
        
        let code = `/**
 * @file    ui_controller.c
 * @brief   UI控制器实现 (自动生成)
 * @date    ${date}
 */

#include "ui_controller.h"
#include "unit_converter.h"
#include "hw_callbacks.h"
#include <string.h>
#include <stdio.h>

`;
        
        // 如果有动画，包含动画头文件
        if (symbols.animations.length > 0) {
            code += `#include "ui_animation.h"\n`;
        }
        
        code += `
/* 全局实例 */
ui_t ui;

/* ========== 七段数码管字形表 ========== */
/* bit0=A, bit1=B, ..., bit6=G, bit7=DP */
static const uint8_t digit_patterns[128] = {
    ['0'] = 0x3F, ['1'] = 0x06, ['2'] = 0x5B, ['3'] = 0x4F, ['4'] = 0x66,
    ['5'] = 0x6D, ['6'] = 0x7D, ['7'] = 0x07, ['8'] = 0x7F, ['9'] = 0x6F,
    ['A'] = 0x77, ['B'] = 0x7C, ['C'] = 0x39, ['D'] = 0x5E, ['E'] = 0x79,
    ['F'] = 0x71, ['-'] = 0x40, ['_'] = 0x08, [' '] = 0x00,
    ['r'] = 0x50, ['n'] = 0x54, ['u'] = 0x1C, ['L'] = 0x38, ['H'] = 0x76,
    ['N'] = 0x37, ['o'] = 0x5C, ['P'] = 0x73, ['t'] = 0x78,
};

/* ========== 前向声明 ========== */
`;
        
        // 前向声明
        for (const line of lines) {
            code += `static void ${line.id}_set(float value, data_type_e type);\n`;
            code += `static void ${line.id}_set_str(const char* str);\n`;
            code += `static void ${line.id}_render(void);\n`;
        }
        for (const sel of selectors) {
            code += `static void ${sel.id}_set(uint8_t v);\n`;
            code += `static void ${sel.id}_render(void);\n`;
        }
        for (const icon of icons) {
            code += `static void ${icon.id}_set(uint8_t v);\n`;
            code += `static void ${icon.id}_render(void);\n`;
        }
        
        // Line组件实现
        if (lines.length > 0) {
            code += `\n/* ========== Line组件实现 ========== */\n\n`;
            
            for (const line of lines) {
                code += this.generateLineImplementation(line, symbols);
            }
        }
        
        // Selector组件实现
        if (selectors.length > 0) {
            code += `\n/* ========== Selector组件实现 ========== */\n\n`;
            
            for (const sel of selectors) {
                code += this.generateSelectorImplementation(sel, symbols);
            }
        }
        
        // Icon组件实现
        if (icons.length > 0) {
            code += `\n/* ========== Icon组件实现 ========== */\n\n`;
            
            for (const icon of icons) {
                code += this.generateIconImplementation(icon, symbols);
            }
        }
        
        // 初始化函数
        code += `\n/* ========== 初始化 ========== */
void ui_init(void) {
    memset(&ui, 0, sizeof(ui));
    
`;
        
        for (const line of lines) {
            code += `    /* ${line.id} */\n`;
            code += `    ui.${line.id}.set = ${line.id}_set;\n`;
            code += `    ui.${line.id}.set_str = ${line.id}_set_str;\n`;
            code += `    strcpy(ui.${line.id}.display, LINE_DASH);\n\n`;
        }
        
        for (const sel of selectors) {
            code += `    /* ${sel.id} */\n`;
            code += `    ui.${sel.id}.set = ${sel.id}_set;\n`;
            code += `    ui.${sel.id}.value = ${sel.config.default || 0};\n\n`;
        }
        
        for (const icon of icons) {
            code += `    /* ${icon.id} */\n`;
            code += `    ui.${icon.id}.set = ${icon.id}_set;\n`;
            code += `    ui.${icon.id}.value = ${icon.config.default ? 1 : 0};\n\n`;
        }
        
        code += `}

/* 更新LCD */
void ui_update(void) {
    lcd_update();
}

/* 刷新所有Line (单位切换时调用) */
void ui_refresh_all_lines(void) {
`;
        
        for (const line of lines) {
            code += `    if (ui.${line.id}.raw_m != 0) {\n`;
            code += `        ui.${line.id}.set(ui.${line.id}.raw_m, ui.${line.id}.data_type);\n`;
            code += `    }\n`;
        }
        
        code += `}
`;
        return code;
    },
    
    // 生成Line组件实现
    generateLineImplementation(line, symbols) {
        const id = line.id;
        const config = line.config;
        const digits = config.digits || [];
        const dots = config.dots || [];
        
        let code = `/* ${config.description || id} */
static void ${id}_set(float value, data_type_e type) {
    ui.${id}.raw_m = value;
    ui.${id}.data_type = type;
    
    /* 获取单位配置 */
    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);
    float display_val = value * cfg.factor;
    
    /* 范围检查 */
    if (display_val > cfg.max) {
        strcpy(ui.${id}.display, LINE_OL);
    } else {
        snprintf(ui.${id}.display, 16, "%.*f", cfg.decimals, display_val);
    }
    
    ${id}_render();
}

static void ${id}_set_str(const char* str) {
    strncpy(ui.${id}.display, str, 15);
    ui.${id}.display[15] = '\\0';
    ui.${id}.raw_m = 0;
    ${id}_render();
}

`;
        
        // 生成完整的render函数
        code += `static void ${id}_render(void) {
    const char* str = ui.${id}.display;
    uint8_t len = strlen(str);
    uint8_t digit_idx = 0;
    int8_t dot_after = -1;  /* 小数点在第几位数字后 */
    
    /* 查找小数点位置 */
    for (uint8_t i = 0; i < len; i++) {
        if (str[i] == '.') {
            dot_after = digit_idx;
            break;
        }
        if (str[i] != ' ') digit_idx++;
    }
    
    /* 清空所有数字位 */
`;
        
        // 清空数字位
        for (let i = 0; i < digits.length; i++) {
            const elemEnum = `LCD_ELEM_${this.toEnumName(digits[i].element)}`;
            code += `    lcd_set_digit(${elemEnum}, 0x00);\n`;
        }
        
        // 清空小数点
        for (const dot of dots) {
            const elemEnum = `LCD_ELEM_${this.toEnumName(dot.element)}`;
            code += `    lcd_set_element(${elemEnum}, 0);\n`;
        }
        
        code += `
    /* 渲染数字 (右对齐) */
    digit_idx = 0;
    uint8_t char_idx = 0;
    
    /* 计算起始位置 (右对齐) */
    uint8_t num_digits = 0;
    for (uint8_t i = 0; i < len; i++) {
        if (str[i] != '.' && str[i] != ' ') num_digits++;
    }
    uint8_t start_pos = (num_digits < ${digits.length}) ? (${digits.length} - num_digits) : 0;
    
    for (uint8_t i = 0; i < len && digit_idx < ${digits.length}; i++) {
        char c = str[i];
        if (c == '.') continue;  /* 小数点单独处理 */
        if (c == ' ' && digit_idx < start_pos) continue;
        
        uint8_t pattern = digit_patterns[(uint8_t)c];
        
        switch (digit_idx + start_pos) {
`;
        
        // 为每个数字位生成case
        for (let i = 0; i < digits.length; i++) {
            const elemEnum = `LCD_ELEM_${this.toEnumName(digits[i].element)}`;
            code += `        case ${i}: lcd_set_digit(${elemEnum}, pattern); break;\n`;
        }
        
        code += `        }
        digit_idx++;
    }
    
    /* 设置小数点 */
`;
        
        // 设置小数点
        for (const dot of dots) {
            const elemEnum = `LCD_ELEM_${this.toEnumName(dot.element)}`;
            code += `    if (dot_after == ${dot.afterDigit}) lcd_set_element(${elemEnum}, 1);\n`;
        }
        
        code += `}

`;
        return code;
    },

    // 生成Selector组件实现
    generateSelectorImplementation(sel, symbols) {
        const id = sel.id;
        const config = sel.config;
        const options = config.options || [];
        const frame = config.frame || [];
        const onSet = config.onSet || {};
        
        // 收集所有元素
        const allElements = new Set();
        for (const opt of options) {
            for (const elem of opt.elements || []) {
                allElements.add(elem);
            }
        }
        for (const elem of frame) {
            allElements.add(elem);
        }
        
        let code = `/* ${config.description || id} */
static void ${id}_set(uint8_t v) {
    ui.${id}.value = v;
`;
        
        // 如果是unit，需要刷新所有Line
        if (config.triggerRefresh) {
            code += `    ui_refresh_all_lines();\n`;
        }
        
        // 生成 onSet 联动代码
        if (Object.keys(onSet).length > 0) {
            code += `    \n    /* onSet 联动 */\n`;
            code += `    switch (v) {\n`;
            for (const [key, actions] of Object.entries(onSet)) {
                code += `    case ${key}:\n`;
                if (actions.anim) {
                    const animEnum = `ANIM_${this.toEnumName(actions.anim.id)}`;
                    if (actions.anim.action === 'stop') {
                        code += `        anim_stop(${animEnum});\n`;
                    } else {
                        const interval = actions.anim.interval || 0;
                        const timeout = actions.anim.timeout || 0;
                        code += `        anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
                    }
                }
                if (actions.hardware) {
                    code += `        hw_${actions.hardware}();\n`;
                }
                code += `        break;\n`;
            }
            code += `    }\n`;
        }
        
        code += `    ${id}_render();
}

static void ${id}_render(void) {
    /* 关闭所有元素 */
`;
        
        for (const elem of allElements) {
            code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 0);\n`;
        }
        
        // 框架元素始终显示
        if (frame.length > 0) {
            code += `    \n    /* 框架元素 (始终显示) */\n`;
            for (const elem of frame) {
                code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 1);\n`;
            }
        }
        
        code += `    \n    /* 打开当前选项元素 */\n`;
        code += `    switch (ui.${id}.value) {\n`;
        
        for (const opt of options) {
            code += `    case ${opt.value}: /* ${opt.key} */\n`;
            for (const elem of opt.elements || []) {
                code += `        lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 1);\n`;
            }
            code += `        break;\n`;
        }
        
        code += `    }
}

`;
        return code;
    },
    
    // 生成Icon组件实现
    generateIconImplementation(icon, symbols) {
        const id = icon.id;
        const config = icon.config;
        const elements = config.elements || [];
        const onSet = config.onSet || {};
        
        let code = `/* ${config.description || id} */
static void ${id}_set(uint8_t v) {
    ui.${id}.value = v;
`;
        
        // 生成 onSet 联动代码
        if (Object.keys(onSet).length > 0) {
            code += `    \n    /* onSet 联动 */\n`;
            code += `    if (v) {\n`;
            if (onSet['true']) {
                if (onSet['true'].anim?.id) {
                    const animEnum = `ANIM_${this.toEnumName(onSet['true'].anim.id)}`;
                    const interval = onSet['true'].anim.interval || 0;
                    const timeout = onSet['true'].anim.timeout || 0;
                    code += `        anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
                }
                if (onSet['true'].hardware) {
                    code += `        hw_${onSet['true'].hardware}();\n`;
                }
            }
            code += `    } else {\n`;
            if (onSet['false']) {
                // 停止动画
                const animId = onSet['false'].anim?.id || onSet['true']?.anim?.id;
                if (animId && (onSet['false'].anim?.action === 'stop' || !onSet['false'].anim?.id)) {
                    const animEnum = `ANIM_${this.toEnumName(animId)}`;
                    code += `        anim_stop(${animEnum});\n`;
                }
                if (onSet['false'].hardware) {
                    code += `        hw_${onSet['false'].hardware}();\n`;
                }
            }
            code += `    }\n`;
        }
        
        code += `    ${id}_render();
}

static void ${id}_render(void) {
`;
        
        for (const elem of elements) {
            code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, ui.${id}.value);\n`;
        }
        
        code += `}

`;
        return code;
    },
    
    // ---------- LCD映射头文件 ----------
    generateLcdMappingHeader(symbols, lcdProject) {
        const date = new Date().toISOString().split('T')[0];
        const elements = symbols.elements;
        
        let code = `/**
 * @file    lcd_mapping.h
 * @brief   LCD段码映射 (自动生成 - 只包含用到的元素)
 * @date    ${date}
 * @note    共 ${elements.length} 个元素 (依赖分析筛选)
 */

#ifndef LCD_MAPPING_H
#define LCD_MAPPING_H

#include <stdint.h>

/* LCD硬件配置 */
#define LCD_SEG_COUNT   ${this.config.segCount}
#define LCD_COM_COUNT   ${this.config.comCount}
#define LCD_BUFFER_SIZE LCD_SEG_COUNT

/* 元素ID枚举 (只包含用到的) */
typedef enum {
`;
        
        elements.forEach((elem, idx) => {
            code += `    ${elem.enum} = ${idx},  /* ${elem.name} */\n`;
        });
        
        code += `    LCD_ELEM_COUNT
} lcd_element_id_t;

/* 段定义 */
typedef struct {
    uint8_t seg;
    uint8_t com;
} lcd_seg_def_t;

/* 元素定义 */
typedef struct {
    const char* name;
    uint8_t seg_count;
    const lcd_seg_def_t* segs;
} lcd_element_def_t;

/* 外部声明 */
extern const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT];
extern uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* API函数 */
void lcd_init(void);
void lcd_set_segment(uint8_t seg, uint8_t com, uint8_t on);
void lcd_set_element(lcd_element_id_t elem_id, uint8_t on);
void lcd_set_digit(lcd_element_id_t elem_id, uint8_t pattern);
void lcd_clear_all(void);
void lcd_show_all(void);
void lcd_update(void);

#endif /* LCD_MAPPING_H */
`;
        return code;
    },
    
    // ---------- LCD映射源文件 ----------
    generateLcdMappingSource(symbols, lcdProject) {
        const date = new Date().toISOString().split('T')[0];
        const elements = symbols.elements;
        
        let code = `/**
 * @file    lcd_mapping.c
 * @brief   LCD段码映射实现 (自动生成)
 * @date    ${date}
 */

#include "lcd_mapping.h"
#include "drv_seg_lcd.h"

/* LCD缓冲区 */
uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* COM位映射 */
static const uint8_t com_bit_map[8] = {7, 6, 5, 4, 3, 2, 1, 0};

`;
        
        // 为每个元素生成段定义数组
        for (const elem of elements) {
            const varName = this.toVarName(elem.name);
            const segs = elem.segments.filter(s => s.seg !== '' && s.com !== '');
            
            code += `/* ${elem.name} */\n`;
            code += `static const lcd_seg_def_t ${varName}_segs[] = {\n`;
            for (const seg of segs) {
                code += `    { ${seg.seg}, ${seg.com} },  /* ${seg.name || ''} */\n`;
            }
            if (segs.length === 0) {
                code += `    { 0, 0 },  /* placeholder */\n`;
            }
            code += `};\n\n`;
        }
        
        // 元素定义表
        code += `/* 元素定义表 */
const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT] = {
`;
        
        for (const elem of elements) {
            const varName = this.toVarName(elem.name);
            const segs = elem.segments.filter(s => s.seg !== '' && s.com !== '');
            code += `    [${elem.enum}] = { "${elem.name}", ${segs.length}, ${varName}_segs },\n`;
        }
        
        code += `};

/* 初始化 */
void lcd_init(void) {
    lcd_clear_all();
}

/* 设置单个段 */
void lcd_set_segment(uint8_t seg, uint8_t com, uint8_t on) {
    if (seg >= LCD_SEG_COUNT || com >= LCD_COM_COUNT) return;
    
    uint8_t bit = com_bit_map[com];
    if (on) {
        lcd_buffer[seg] |= (1 << bit);
    } else {
        lcd_buffer[seg] &= ~(1 << bit);
    }
}

/* 设置元素 (点亮/熄灭所有段) */
void lcd_set_element(lcd_element_id_t elem_id, uint8_t on) {
    if (elem_id >= LCD_ELEM_COUNT) return;
    
    const lcd_element_def_t* elem = &lcd_elements[elem_id];
    for (uint8_t i = 0; i < elem->seg_count; i++) {
        lcd_set_segment(elem->segs[i].seg, elem->segs[i].com, on);
    }
}

/* 设置数字位 (7段显示) */
void lcd_set_digit(lcd_element_id_t elem_id, uint8_t pattern) {
    if (elem_id >= LCD_ELEM_COUNT) return;
    
    const lcd_element_def_t* elem = &lcd_elements[elem_id];
    /* 假设段顺序: A,B,C,D,E,F,G (bit0-bit6) */
    for (uint8_t i = 0; i < elem->seg_count && i < 7; i++) {
        uint8_t on = (pattern >> i) & 1;
        lcd_set_segment(elem->segs[i].seg, elem->segs[i].com, on);
    }
}

/* 清屏 */
void lcd_clear_all(void) {
    for (uint8_t i = 0; i < LCD_BUFFER_SIZE; i++) {
        lcd_buffer[i] = 0;
    }
}

/* 全显 */
void lcd_show_all(void) {
    for (uint8_t i = 0; i < LCD_BUFFER_SIZE; i++) {
        lcd_buffer[i] = 0xFF;
    }
}

/* 更新到硬件 */
void lcd_update(void) {
    seg_lcd_write_buffer(lcd_buffer, LCD_BUFFER_SIZE);
}
`;
        return code;
    },

    // ---------- 状态机头文件 ----------
    generateStateMachineHeader(symbols, stateMachine) {
        const date = new Date().toISOString().split('T')[0];
        const states = symbols.states;
        const events = symbols.events;
        const stateGroups = symbols.stateGroups;
        
        let code = `/**
 * @file    ui_state_machine.h
 * @brief   UI状态机 (自动生成 - QHsm风格)
 * @date    ${date}
 * @note    共 ${states.length} 个状态, ${events.length} 个事件
 *          按测量模式分组，便于理解和维护
 */

#ifndef UI_STATE_MACHINE_H
#define UI_STATE_MACHINE_H

#include <stdint.h>

/* ========== 测量模式枚举 ========== */
typedef enum {
    MODE_SINGLE = 0,    /* 单次测量 */
    MODE_AREA = 1,      /* 面积测量 */
    MODE_VOLUME = 2,    /* 体积测量 */
    MODE_PYTH1 = 3,     /* 勾股1 */
    MODE_PYTH2 = 4,     /* 勾股2 */
    MODE_PYTH3 = 5,     /* 勾股3 */
    MODE_CONTINUOUS = 6,/* 连续测量 */
    MODE_COUNT
} ui_mode_t;

/* ========== 状态ID枚举 (按模式分组) ========== */
typedef enum {
`;
        
        // 按模式分组输出状态枚举
        const modeOrder = ['SYSTEM', 'BOOT', 'SINGLE', 'AREA', 'VOLUME', 'PYTH1', 'PYTH2', 'PYTH3', 'CONTINUOUS', 'SETTINGS'];
        const modeLabels = {
            'SYSTEM': '系统状态',
            'BOOT': '开机流程',
            'SINGLE': '单次测量',
            'AREA': '面积测量 (2步)',
            'VOLUME': '体积测量 (3步)',
            'PYTH1': '勾股1 (2步)',
            'PYTH2': '勾股2 (3步)',
            'PYTH3': '勾股3 (3步)',
            'CONTINUOUS': '连续测量',
            'SETTINGS': '系统设置',
        };
        
        let stateIndex = 0;
        for (const mode of modeOrder) {
            const group = stateGroups[mode];
            if (!group || group.length === 0) continue;
            
            code += `    /* --- ${modeLabels[mode] || mode} --- */\n`;
            
            // 按level排序，同level按stepIndex排序
            group.sort((a, b) => {
                if (a.level !== b.level) return a.level - b.level;
                if (a.stepIndex !== null && b.stepIndex !== null) return a.stepIndex - b.stepIndex;
                return 0;
            });
            
            for (const state of group) {
                const indent = '    '.repeat(Math.min(state.level, 2));
                const stepComment = state.stepIndex ? ` (步骤${state.stepIndex})` : '';
                code += `    ${state.enum} = ${stateIndex},${indent}/* ${state.id}${stepComment} */\n`;
                stateIndex++;
            }
            code += '\n';
        }
        
        code += `    UI_STATE_COUNT
} ui_state_id_t;

/* ========== 步骤索引宏 (用于多步测量) ========== */
`;
        
        // 为每个模式生成步骤宏
        for (const mode of ['AREA', 'VOLUME', 'PYTH1', 'PYTH2', 'PYTH3']) {
            const group = stateGroups[mode];
            if (!group) continue;
            
            const steps = group.filter(s => s.stepIndex !== null).sort((a, b) => a.stepIndex - b.stepIndex);
            if (steps.length > 0) {
                code += `/* ${mode} 步骤 */\n`;
                for (const step of steps) {
                    code += `#define ${mode}_STEP${step.stepIndex}  ${step.enum}\n`;
                }
                code += `#define ${mode}_TOTAL_STEPS  ${steps.length}\n\n`;
            }
        }
        
        code += `/* ========== 事件类型枚举 ========== */
typedef enum {
    /* 内部事件 */
    UI_EVT_ENTRY,
    UI_EVT_EXIT,
    UI_EVT_INIT,
    
    /* 用户事件 */
`;
        
        for (const evt of events) {
            code += `    ${evt.enum},\n`;
        }
        
        code += `    
    UI_EVT_COUNT
} ui_event_type_t;

/* 事件结构 */
typedef struct {
    ui_event_type_t type;
    uint16_t param;
} ui_event_t;

/* 状态机上下文 */
typedef struct {
    ui_state_id_t current_state;
    ui_state_id_t target_state;
    ui_mode_t current_mode;       /* 当前测量模式 */
    uint8_t current_step;         /* 当前步骤 (1-based) */
    uint32_t state_enter_tick;
    uint8_t transition_pending;
} ui_hsm_t;

/* API函数 */
void ui_hsm_init(ui_hsm_t* hsm);
void ui_hsm_dispatch(ui_hsm_t* hsm, const ui_event_t* evt);
ui_state_id_t ui_hsm_get_state(const ui_hsm_t* hsm);
ui_mode_t ui_hsm_get_mode(const ui_hsm_t* hsm);
uint8_t ui_hsm_get_step(const ui_hsm_t* hsm);
const char* ui_hsm_get_state_name(ui_state_id_t state);

/* 全局实例 */
extern ui_hsm_t g_ui_hsm;

/* 系统tick (用户实现) */
extern uint32_t sys_tick_get(void);

#endif /* UI_STATE_MACHINE_H */
`;
        return code;
    },
    
    // ---------- 状态机源文件 ----------
    generateStateMachineSource(symbols, stateMachine, deps) {
        const date = new Date().toISOString().split('T')[0];
        const states = symbols.states;
        const hierarchy = stateMachine?.hierarchy || {};
        const transitions = stateMachine?.transitions || [];
        
        let code = `/**
 * @file    ui_state_machine.c
 * @brief   UI状态机实现 (自动生成 - QHsm风格)
 * @date    ${date}
 * @note    预设动作已展开为组件/动画调用
 */

#include "ui_state_machine.h"
#include "ui_controller.h"
#include "lcd_mapping.h"
`;
        
        // 不再需要 ui_presets.h，预设已展开
        if (deps.animations.size > 0) {
            code += `#include "ui_animation.h"\n`;
        }
        if (deps.variables.size > 0) {
            code += `#include "ui_variables.h"\n`;
        }
        
        code += `#include <math.h>

/* 全局状态机实例 */
ui_hsm_t g_ui_hsm;

/* 状态名称表 */
static const char* state_names[UI_STATE_COUNT] = {
`;
        
        // 收集状态标签
        const stateLabels = {};
        const collectLabels = (node) => {
            if (!node) return;
            stateLabels[node.id] = node.label || node.id;
            if (node.children) {
                for (const child of Object.values(node.children)) {
                    collectLabels(child);
                }
            }
        };
        collectLabels(hierarchy.ROOT);
        
        for (const state of states) {
            const label = stateLabels[state.id] || state.id;
            code += `    [${state.enum}] = "${label}",\n`;
        }
        
        code += `};

/* 状态处理函数声明 */
`;
        
        for (const state of states) {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt);\n`;
        }
        
        code += `
/* 状态处理函数表 */
typedef void (*state_handler_t)(ui_hsm_t* hsm, const ui_event_t* evt);
static const state_handler_t state_handlers[UI_STATE_COUNT] = {
`;
        
        for (const state of states) {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `    [${state.enum}] = ${funcName},\n`;
        }
        
        code += `};

/* 初始化 */
void ui_hsm_init(ui_hsm_t* hsm) {
`;
        
        if (deps.variables.size > 0) {
            code += `    ui_vars_init();\n`;
        }
        
        const initialState = states[0]?.enum || 'UI_STATE_ROOT';
        code += `    
    hsm->current_state = ${initialState};
    hsm->target_state = hsm->current_state;
    hsm->current_mode = MODE_SINGLE;
    hsm->current_step = 0;
    hsm->state_enter_tick = sys_tick_get();
    hsm->transition_pending = 0;
    
    /* 触发初始状态的ENTRY事件 */
    ui_event_t entry_evt = { .type = UI_EVT_ENTRY };
    state_handlers[hsm->current_state](hsm, &entry_evt);
}

/* 事件分发 */
void ui_hsm_dispatch(ui_hsm_t* hsm, const ui_event_t* evt) {
    if (hsm->current_state >= UI_STATE_COUNT) return;
    
    /* 调用当前状态的处理函数 */
    state_handlers[hsm->current_state](hsm, evt);
    
    /* 处理状态转移 */
    if (hsm->transition_pending) {
        hsm->transition_pending = 0;
        
        /* 退出当前状态 */
        ui_event_t exit_evt = { .type = UI_EVT_EXIT };
        state_handlers[hsm->current_state](hsm, &exit_evt);
        
        /* 切换状态 */
        hsm->current_state = hsm->target_state;
        hsm->state_enter_tick = sys_tick_get();
        
        /* 进入新状态 */
        ui_event_t entry_evt = { .type = UI_EVT_ENTRY };
        state_handlers[hsm->current_state](hsm, &entry_evt);
    }
}

/* 获取当前状态 */
ui_state_id_t ui_hsm_get_state(const ui_hsm_t* hsm) {
    return hsm->current_state;
}

/* 获取当前模式 */
ui_mode_t ui_hsm_get_mode(const ui_hsm_t* hsm) {
    return hsm->current_mode;
}

/* 获取当前步骤 */
uint8_t ui_hsm_get_step(const ui_hsm_t* hsm) {
    return hsm->current_step;
}

/* 获取状态名称 */
const char* ui_hsm_get_state_name(ui_state_id_t state) {
    if (state >= UI_STATE_COUNT) return "UNKNOWN";
    return state_names[state];
}

/* 状态转移宏 */
#define TRAN(target) do { \\
    hsm->target_state = (target); \\
    hsm->transition_pending = 1; \\
} while(0)

/* 设置模式宏 */
#define SET_MODE(m) do { hsm->current_mode = (m); } while(0)

/* 设置步骤宏 */
#define SET_STEP(s) do { hsm->current_step = (s); } while(0)

`;
        
        // 生成每个状态的处理函数
        const allStates = this.collectAllStates(hierarchy.ROOT);
        for (const state of allStates) {
            code += this.generateStateHandler(state, transitions, deps);
        }
        
        return code;
    },
    
    // 收集状态层级信息
    collectStateHierarchy(node, parent = null, mode = null, result = {}) {
        if (!node) return result;
        
        // 确定当前模式 (测量模式作为分组依据)
        let currentMode = mode;
        const modeStates = ['SINGLE', 'AREA', 'VOLUME', 'PYTH1', 'PYTH2', 'PYTH3', 'CONTINUOUS', 'SETTINGS', 'BOOT'];
        if (modeStates.includes(node.id)) {
            currentMode = node.id;
        }
        
        // 提取步骤索引 (如 AREA_STEP1 -> 1, VOL_STEP2 -> 2)
        // 排除 _DONE 后缀的状态
        let stepIndex = null;
        if (!node.id.includes('_DONE') && !node.id.includes('_RESULT') && !node.id.includes('_ERROR')) {
            const stepMatch = node.id.match(/STEP(\d+)$/);
            if (stepMatch) {
                stepIndex = parseInt(stepMatch[1]);
            }
        }
        
        result[node.id] = {
            level: node.level || 0,
            parent: parent,
            mode: currentMode,
            stepIndex: stepIndex,
            label: node.label,
        };
        
        if (node.children) {
            for (const child of Object.values(node.children)) {
                this.collectStateHierarchy(child, node.id, currentMode, result);
            }
        }
        
        return result;
    },
    
    // 收集所有状态
    collectAllStates(node, result = []) {
        if (!node) return result;
        result.push(node);
        if (node.children) {
            for (const child of Object.values(node.children)) {
                this.collectAllStates(child, result);
            }
        }
        return result;
    },
    
    // 生成状态处理函数
    generateStateHandler(state, transitions, deps) {
        const funcName = `state_${this.toVarName(state.id)}`;
        const stateEnum = `UI_STATE_${this.toEnumName(state.id)}`;
        
        // 找到从这个状态出发的转移
        const outTransitions = transitions.filter(t => t.from === state.id);
        
        let code = `
/* ${state.label || state.id} */
static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
`;
        
        // 入口动作
        for (const action of state.entryActions || []) {
            code += this.generateActionCode(action, deps);
        }
        
        code += `        break;
        
    case UI_EVT_EXIT:
`;
        
        // 退出动作
        for (const action of state.exitActions || []) {
            code += this.generateActionCode(action, deps);
        }
        
        code += `        break;
`;
        
        // 处理转移
        for (const trans of outTransitions) {
            const eventEnum = `UI_EVT_${this.toEnumName(trans.event)}`;
            const targetEnum = `UI_STATE_${this.toEnumName(trans.to)}`;
            
            code += `
    case ${eventEnum}:
`;
            
            // Guard条件
            if (trans.guard) {
                const guardExpr = this.convertGuardExpression(trans.guard);
                code += `        if (${guardExpr}) {\n`;
                
                for (const action of trans.actions || []) {
                    code += '    ' + this.generateActionCode(action, deps);
                }
                
                code += `            TRAN(${targetEnum});\n`;
                code += `        }\n`;
            } else {
                for (const action of trans.actions || []) {
                    code += this.generateActionCode(action, deps);
                }
                code += `        TRAN(${targetEnum});\n`;
            }
            
            code += `        break;
`;
        }
        
        code += `
    default:
        break;
    }
}
`;
        return code;
    },
    
    // 生成动作代码
    generateActionCode(action, deps) {
        if (!action) return '';
        
        let code = '';
        
        // preset:xxx - 展开成组件/动画调用
        if (action.startsWith('preset:')) {
            const presetId = action.split(':')[1];
            code += this.expandPresetToCode(presetId);
        }
        // anim:xxx:start/stop/startEx
        else if (action.startsWith('anim:')) {
            const parts = action.split(':');
            const animId = parts[1];
            const animAction = parts[2];
            const animEnum = `ANIM_${this.toEnumName(animId)}`;
            
            if (animAction === 'start') {
                code += `        anim_start(${animEnum});\n`;
            } else if (animAction === 'stop') {
                code += `        anim_stop(${animEnum});\n`;
            } else if (animAction === 'startEx') {
                // anim:laserBlink:startEx:300:15000
                const interval = parts[3] || '0';
                const timeout = parts[4] || '0';
                code += `        anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
            } else {
                code += `        anim_start(${animEnum});\n`;
            }
        }
        // flow:xxx 动作 (FlowController)
        else if (action.startsWith('flow:')) {
            code += this.generateFlowActionCode(action);
        }
        // macro:xxx 宏动作
        else if (action.startsWith('macro:')) {
            code += this.generateMacroActionCode(action);
        }
        // 简化语法: line4 = 12.345 / laser = true
        else if (action.match(/^\w+\s*=\s*.+/) && !action.startsWith('assign:') && !action.startsWith('calc:')) {
            code += this.generateSimplifiedAssignCode(action);
        }
        // comp:setVisible:xxx:true/false
        else if (action.startsWith('comp:setVisible:')) {
            const parts = action.split(':');
            const compId = parts[2];
            const visible = parts[3] === 'true' ? 1 : 0;
            code += `        ui.${compId}.set(${visible});\n`;
        }
        // comp:setValue:xxx:value
        else if (action.startsWith('comp:setValue:')) {
            const parts = action.split(':');
            const compId = parts[2];
            const value = parts[3];
            if (value?.startsWith('${') && value?.endsWith('}')) {
                // 变量引用
                const varName = value.slice(2, -1);
                code += `        ui.${compId}.set(g_ui_vars.${varName}, DATA_LENGTH);\n`;
            } else {
                code += `        ui.${compId}.set_str("${value || ''}");\n`;
            }
        }
        // comp:showPreset:xxx:dash
        else if (action.startsWith('comp:showPreset:')) {
            const parts = action.split(':');
            const compId = parts[2];
            const preset = parts[3];
            if (preset === 'dash') {
                code += `        ui.${compId}.set_str(LINE_DASH);\n`;
            } else if (preset === 'error') {
                code += `        ui.${compId}.set_str(LINE_ERR);\n`;
            } else {
                code += `        ui.${compId}.set_str("${preset}");\n`;
            }
        }
        // lcd:showAll / lcd:clearAll
        else if (action === 'lcd:showAll') {
            code += `        lcd_show_all();\n`;
        }
        else if (action === 'lcd:clearAll') {
            code += `        lcd_clear_all();\n`;
        }
        // assign:var = value
        else if (action.startsWith('assign:')) {
            const expr = action.substring(7).trim();
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let value = match[2].trim();
                if (value === 'true') value = '1';
                else if (value === 'false') value = '0';
                else if (value === 'distance') value = 'g_ui_vars.distance';
                code += `        g_ui_vars.${varName} = ${value};\n`;
            }
        }
        // calc:var = expr
        else if (action.startsWith('calc:')) {
            const expr = action.substring(5).trim();
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let calcExpr = this.convertCalcExpression(match[2].trim());
                code += `        g_ui_vars.${varName} = ${calcExpr};\n`;
            }
        }
        // inc:var
        else if (action.startsWith('inc:')) {
            const varName = action.substring(4).trim();
            code += `        g_ui_vars.${varName}++;\n`;
        }
        // dec:var
        else if (action.startsWith('dec:')) {
            const varName = action.substring(4).trim();
            code += `        g_ui_vars.${varName}--;\n`;
        }
        // hw:xxx
        else if (action.startsWith('hw:')) {
            const parts = action.split(':');
            const hwAction = parts.slice(1).join('_');
            code += `        hw_${hwAction}();\n`;
        }
        // if:condition then action
        else if (action.startsWith('if:')) {
            const match = action.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                const condition = this.convertGuardExpression(match[1].trim());
                code += `        if (${condition}) {\n`;
                code += '    ' + this.generateActionCode(match[2].trim(), deps);
                code += `        }\n`;
            }
        }
        // timeout:ms
        else if (action.startsWith('timeout:')) {
            const ms = action.split(':')[1];
            code += `        /* TODO: 设置超时 ${ms}ms */\n`;
        }
        // scroll:history (历史数据滚动)
        else if (action === 'scroll:history') {
            code += `        ui_vars_scroll_history();\n`;
        }
        // 其他
        else {
            code += `        /* TODO: ${action} */\n`;
        }
        
        return code;
    },
    
    // 生成 flow: 动作代码 (FlowController)
    generateFlowActionCode(action) {
        const parts = action.split(':');
        const cmd = parts[1];
        const param1 = parts[2];
        const param2 = parts[3];
        
        let code = '';
        
        switch (cmd) {
            case 'setType':
                // flow:setType:multi - 设置流程类型 (状态机层面处理)
                code += `        /* flow:setType:${param1} - 流程类型设置 */\n`;
                break;
                
            case 'onEnterReady':
                // flow:onEnterReady - 进入准备状态 (保存快照)
                code += `        /* 进入准备状态 - 保存数据快照 */\n`;
                code += `        flow_save_snapshot();\n`;
                break;
                
            case 'storeSlot':
                // flow:storeSlot:1 - 存储到slot[1] (Line2)
                // flow:storeSlot:2 - 存储到slot[2] (Line3)
                // slot索引+1 = Line编号
                const slotIdx = parseInt(param1);
                const lineNum = slotIdx + 1;  // slot[1] 对应 line2_data, slot[2] 对应 line3_data
                code += `        g_ui_vars.line${lineNum}_data = g_ui_vars.distance;\n`;
                code += `        ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
                break;
                
            case 'scrollUp':
                // flow:scrollUp - 数据上移
                code += `        /* 数据上移: line1←line2←line3←line4 */\n`;
                code += `        g_ui_vars.line1_data = g_ui_vars.line2_data;\n`;
                code += `        g_ui_vars.line2_data = g_ui_vars.line3_data;\n`;
                code += `        g_ui_vars.line3_data = g_ui_vars.line4_data;\n`;
                code += `        g_ui_vars.line4_data = 0;\n`;
                code += `        ui_refresh_all_lines();\n`;
                break;
                
            case 'scrollDown':
                // flow:scrollDown - 数据下移 (撤回)
                code += `        /* 数据下移: line4←line3←line2←line1 */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line3_data;\n`;
                code += `        g_ui_vars.line3_data = g_ui_vars.line2_data;\n`;
                code += `        g_ui_vars.line2_data = g_ui_vars.line1_data;\n`;
                code += `        g_ui_vars.line1_data = 0;\n`;
                code += `        ui_refresh_all_lines();\n`;
                break;
                
            case 'calcArea':
                // flow:calcArea - 计算面积
                code += `        /* 计算面积: line4 = line2 * line3 */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line2_data * g_ui_vars.line3_data;\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_AREA);\n`;
                break;
                
            case 'calcVolume':
                // flow:calcVolume - 计算体积
                code += `        /* 计算体积: line4 = line1 * line2 * line3 */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line1_data * g_ui_vars.line2_data * g_ui_vars.line3_data;\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_VOLUME);\n`;
                break;
                
            case 'calcPyth1':
                // flow:calcPyth1 - 勾股定理1: √(斜边²-直角边²)
                code += `        /* 勾股1: line4 = √(line1² - line2²) */\n`;
                code += `        if (g_ui_vars.line1_data > g_ui_vars.line2_data) {\n`;
                code += `            g_ui_vars.line4_data = sqrtf(g_ui_vars.line1_data * g_ui_vars.line1_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `            ui.line4.set(g_ui_vars.line4_data, DATA_LENGTH);\n`;
                code += `        } else {\n`;
                code += `            ui.line4.set_str(LINE_ERR);\n`;
                code += `        }\n`;
                break;
                
            case 'calcPyth2':
                // flow:calcPyth2 - 勾股定理2: √(斜边1²-公共边²)+√(斜边2²-公共边²)
                code += `        /* 勾股2: line4 = √(line1²-line2²) + √(line3²-line2²) */\n`;
                code += `        if (g_ui_vars.line1_data > g_ui_vars.line2_data && g_ui_vars.line3_data > g_ui_vars.line2_data) {\n`;
                code += `            float a = sqrtf(g_ui_vars.line1_data * g_ui_vars.line1_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `            float b = sqrtf(g_ui_vars.line3_data * g_ui_vars.line3_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `            g_ui_vars.line4_data = a + b;\n`;
                code += `            ui.line4.set(g_ui_vars.line4_data, DATA_LENGTH);\n`;
                code += `        } else {\n`;
                code += `            ui.line4.set_str(LINE_ERR);\n`;
                code += `        }\n`;
                break;
                
            case 'calcPyth3':
                // flow:calcPyth3 - 勾股定理3: √(斜边1²-公共边²)-√(斜边2²-公共边²)
                code += `        /* 勾股3: line4 = √(line1²-line2²) - √(line3²-line2²) */\n`;
                code += `        if (g_ui_vars.line1_data > g_ui_vars.line2_data && g_ui_vars.line3_data > g_ui_vars.line2_data) {\n`;
                code += `            float a = sqrtf(g_ui_vars.line1_data * g_ui_vars.line1_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `            float b = sqrtf(g_ui_vars.line3_data * g_ui_vars.line3_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `            g_ui_vars.line4_data = fabsf(a - b);\n`;
                code += `            ui.line4.set(g_ui_vars.line4_data, DATA_LENGTH);\n`;
                code += `        } else {\n`;
                code += `            ui.line4.set_str(LINE_ERR);\n`;
                code += `        }\n`;
                break;
                
            case 'clearSlots':
                // flow:clearSlots - 清空所有数据槽
                code += `        /* 清空数据槽 */\n`;
                code += `        g_ui_vars.line1_data = 0;\n`;
                code += `        g_ui_vars.line2_data = 0;\n`;
                code += `        g_ui_vars.line3_data = 0;\n`;
                code += `        g_ui_vars.line4_data = 0;\n`;
                break;
                
            case 'undo':
                // flow:undo - 撤回 (由状态转移处理)
                code += `        /* flow:undo - 撤回到上一个准备状态 */\n`;
                code += `        flow_restore_snapshot();\n`;
                code += `        ui_refresh_all_lines();\n`;
                break;
                
            case 'updateContinuous':
                // flow:updateContinuous - 更新连续测量MAX/MIN
                code += `        /* 更新连续测量 MAX/MIN */\n`;
                code += `        if (g_ui_vars.max_data < 0 || g_ui_vars.distance > g_ui_vars.max_data) {\n`;
                code += `            g_ui_vars.max_data = g_ui_vars.distance;\n`;
                code += `        }\n`;
                code += `        if (g_ui_vars.min_data < 0 || g_ui_vars.distance < g_ui_vars.min_data) {\n`;
                code += `            g_ui_vars.min_data = g_ui_vars.distance;\n`;
                code += `        }\n`;
                code += `        ui.line2.set(g_ui_vars.max_data, DATA_LENGTH);\n`;
                code += `        ui.line3.set(g_ui_vars.min_data, DATA_LENGTH);\n`;
                code += `        ui.line4.set(g_ui_vars.distance, DATA_LENGTH);\n`;
                break;
                
            case 'resetContinuous':
                // flow:resetContinuous - 重置连续测量
                code += `        g_ui_vars.max_data = -1;\n`;
                code += `        g_ui_vars.min_data = -1;\n`;
                break;
                
            default:
                code += `        /* TODO: flow:${cmd} */\n`;
        }
        
        return code;
    },
    
    // 生成 macro: 宏动作代码
    generateMacroActionCode(action) {
        const macroId = action.split(':')[1];
        let code = '';
        
        switch (macroId) {
            case 'scrollUp':
                code += `        /* macro:scrollUp - 数据上移 */\n`;
                code += `        ui_vars_scroll_history();\n`;
                code += `        ui_refresh_all_lines();\n`;
                break;
                
            case 'scrollDown':
                code += `        /* macro:scrollDown - 数据下移 */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line3_data;\n`;
                code += `        g_ui_vars.line3_data = g_ui_vars.line2_data;\n`;
                code += `        g_ui_vars.line2_data = g_ui_vars.line1_data;\n`;
                code += `        g_ui_vars.line1_data = 0;\n`;
                code += `        ui_refresh_all_lines();\n`;
                break;
                
            case 'calcArea':
                code += `        /* macro:calcArea */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line2_data * g_ui_vars.line3_data;\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_AREA);\n`;
                break;
                
            case 'calcVolume':
                code += `        /* macro:calcVolume */\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.line1_data * g_ui_vars.line2_data * g_ui_vars.line3_data;\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_VOLUME);\n`;
                break;
                
            case 'calcPyth1':
                code += `        /* macro:calcPyth1 */\n`;
                code += `        g_ui_vars.line4_data = sqrtf(g_ui_vars.line1_data * g_ui_vars.line1_data - g_ui_vars.line2_data * g_ui_vars.line2_data);\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_LENGTH);\n`;
                break;
                
            case 'clearAll':
                code += `        /* macro:clearAll */\n`;
                code += `        ui.line1.set_str(LINE_DASH);\n`;
                code += `        ui.line2.set_str(LINE_DASH);\n`;
                code += `        ui.line3.set_str(LINE_DASH);\n`;
                code += `        ui.line4.set_str(LINE_DASH);\n`;
                break;
                
            case 'showReady':
                code += `        /* macro:showReady */\n`;
                code += `        ui.line4.set_str(LINE_DASH);\n`;
                break;
                
            case 'showError':
                code += `        /* macro:showError */\n`;
                code += `        ui.line4.set_str(LINE_ERR);\n`;
                break;
                
            case 'laserOn':
                code += `        ui.laser.set(1);\n`;
                break;
                
            case 'laserOff':
                code += `        ui.laser.set(0);\n`;
                break;
                
            case 'measureSuccess':
                code += `        /* macro:measureSuccess */\n`;
                code += `        ui_vars_scroll_history();\n`;
                code += `        g_ui_vars.line4_data = g_ui_vars.distance;\n`;
                code += `        ui.line4.set(g_ui_vars.line4_data, DATA_LENGTH);\n`;
                code += `        ui_refresh_all_lines();\n`;
                code += `        hw_beep(50);\n`;
                break;
                
            case 'measureFail':
                code += `        /* macro:measureFail */\n`;
                code += `        ui.line4.set_str(LINE_ERR);\n`;
                code += `        hw_beep(200);\n`;
                break;
                
            default:
                code += `        /* TODO: macro:${macroId} */\n`;
        }
        
        return code;
    },
    
    // 生成简化语法赋值代码: line4 = 12.345 / laser = true
    generateSimplifiedAssignCode(action) {
        const match = action.match(/^(\w+)\s*=\s*(.+)/);
        if (!match) return `        /* 无法解析: ${action} */\n`;
        
        const varName = match[1];
        let value = match[2].trim();
        let code = '';
        
        // 判断是组件还是变量
        const lineMatch = varName.match(/^line(\d)$/i);
        const isIcon = ['laser', 'bluetooth', 'wifi'].includes(varName.toLowerCase());
        const isSelector = ['unit', 'battery', 'base', 'beep', 'signal', 'mode_selection'].includes(varName.toLowerCase());
        
        if (lineMatch) {
            // Line组件
            const lineNum = lineMatch[1];
            if (value === "'-----'" || value === '"-----"' || value === 'dash') {
                code += `        ui.line${lineNum}.set_str(LINE_DASH);\n`;
            } else if (value === "'Err'" || value === '"Err"' || value === 'error') {
                code += `        ui.line${lineNum}.set_str(LINE_ERR);\n`;
            } else if (value === 'distance') {
                code += `        g_ui_vars.line${lineNum}_data = g_ui_vars.distance;\n`;
                code += `        ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            } else if (!isNaN(parseFloat(value))) {
                code += `        g_ui_vars.line${lineNum}_data = ${value}f;\n`;
                code += `        ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            } else {
                // 变量引用
                code += `        g_ui_vars.line${lineNum}_data = g_ui_vars.${value};\n`;
                code += `        ui.line${lineNum}.set(g_ui_vars.line${lineNum}_data, DATA_LENGTH);\n`;
            }
        } else if (isIcon) {
            // Icon组件
            if (value === 'true' || value === '1') {
                code += `        ui.${varName}.set(1);\n`;
            } else if (value === 'false' || value === '0') {
                code += `        ui.${varName}.set(0);\n`;
            } else {
                code += `        ui.${varName}.set(${value});\n`;
            }
        } else if (isSelector) {
            // Selector组件
            code += `        ui.${varName}.set(${value});\n`;
        } else {
            // 普通变量
            if (value === 'true') value = '1';
            else if (value === 'false') value = '0';
            else if (value === 'distance') value = 'g_ui_vars.distance';
            code += `        g_ui_vars.${varName} = ${value};\n`;
        }
        
        return code;
    },
    
    // 转换Guard表达式
    convertGuardExpression(expr) {
        // 替换变量名为 g_ui_vars.xxx
        return expr.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (m) => {
            if (['true', 'false', 'null', 'distance'].includes(m)) {
                if (m === 'distance') return 'g_ui_vars.distance';
                return m;
            }
            return `g_ui_vars.${m}`;
        });
    },
    
    // 转换计算表达式
    convertCalcExpression(expr) {
        // sqrt() -> sqrtf()
        expr = expr.replace(/sqrt\(/g, 'sqrtf(');
        // a^2 -> (a*a)
        expr = expr.replace(/(\w+)\^2/g, '($1*$1)');
        // 替换变量名
        expr = expr.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (m) => {
            if (['sqrtf', 'sinf', 'cosf', 'fabsf', 'true', 'false'].includes(m)) return m;
            return `g_ui_vars.${m}`;
        });
        return expr;
    },
    
    // 展开预设为组件/动画调用代码
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
            const comp = this.componentsConfig?.[compId];
            const compType = comp?.type || 'unknown';
            
            if (compConfig.preset === 'dash') {
                code += `        ui.${compId}.set_str(LINE_DASH);\n`;
            } else if (compConfig.preset === 'error') {
                code += `        ui.${compId}.set_str(LINE_ERR);\n`;
            } else if (compConfig.preset === 'dot1') {
                code += `        ui.${compId}.set_str(".");\n`;
            } else if (compConfig.preset === 'dot2') {
                code += `        ui.${compId}.set_str("..");\n`;
            } else if (compConfig.preset === 'dot3') {
                code += `        ui.${compId}.set_str("...");\n`;
            } else if (compConfig.value !== undefined) {
                if (typeof compConfig.value === 'number') {
                    if (compType === 'Line') {
                        code += `        ui.${compId}.set(${compConfig.value}f, DATA_LENGTH);\n`;
                    } else {
                        code += `        ui.${compId}.set(${compConfig.value});\n`;
                    }
                } else if (compConfig.value === '') {
                    code += `        ui.${compId}.set_str("");\n`;
                } else {
                    code += `        ui.${compId}.set_str("${compConfig.value}");\n`;
                }
            } else if (compConfig.visible !== undefined) {
                code += `        ui.${compId}.set(${compConfig.visible ? 1 : 0});\n`;
            } else if (compConfig.bind !== undefined) {
                // 绑定变量
                code += `        ui.${compId}.set(g_ui_vars.${compConfig.bind}, DATA_LENGTH);\n`;
            } else if (compConfig.unit !== undefined) {
                // 单位设置
                code += `        ui.unit.set(${compConfig.unit});\n`;
            } else if (compConfig.dataType !== undefined) {
                // 数据类型设置 - 暂时忽略，由set函数处理
            }
        }
        
        // 启动动画
        for (const animId of preset.behaviors || []) {
            code += `        anim_start(ANIM_${this.toEnumName(animId)});\n`;
        }
        
        // 元素设置
        for (const elemId of preset.elements || []) {
            code += `        lcd_set_element(LCD_ELEM_${this.toEnumName(elemId)}, 1);\n`;
        }
        
        return code;
    },

    // ---------- 动画头文件 ----------
    generateAnimationHeader(symbols, animations, deps) {
        const date = new Date().toISOString().split('T')[0];
        const animList = symbols.animations;
        
        let code = `/**
 * @file    ui_animation.h
 * @brief   动画引擎 (自动生成 - 只包含用到的)
 * @date    ${date}
 * @note    共 ${animList.length} 个动画
 */

#ifndef UI_ANIMATION_H
#define UI_ANIMATION_H

#include <stdint.h>

/* 动画ID枚举 */
typedef enum {
`;
        
        for (const anim of animList) {
            code += `    ${anim.enum},\n`;
        }
        
        code += `    ANIM_COUNT
} ui_anim_id_t;

/* API函数 */
void anim_init(void);
void anim_tick(uint16_t elapsed_ms);
void anim_start(ui_anim_id_t anim_id);
void anim_start_ex(ui_anim_id_t anim_id, uint16_t interval_ms, uint32_t timeout_ms);
void anim_stop(ui_anim_id_t anim_id);
void anim_stop_all(void);
uint8_t anim_is_running(ui_anim_id_t anim_id);

#endif /* UI_ANIMATION_H */
`;
        return code;
    },
    
    // ---------- 动画源文件 ----------
    generateAnimationSource(symbols, animations, deps) {
        const date = new Date().toISOString().split('T')[0];
        const animList = symbols.animations;
        const animConfig = animations?.animations || {};
        
        let code = `/**
 * @file    ui_animation.c
 * @brief   动画引擎实现 (自动生成)
 * @date    ${date}
 */

#include "ui_animation.h"
#include "ui_controller.h"
#include "lcd_mapping.h"

/* 动画状态 */
typedef struct {
    uint8_t running;
    uint16_t interval_ms;
    uint32_t timeout_ms;
    uint32_t elapsed_ms;
    uint32_t total_ms;
    uint8_t frame_idx;
    uint8_t toggle_state;
} anim_state_t;

static anim_state_t anim_states[ANIM_COUNT];

/* 动画配置 */
typedef struct {
    uint16_t default_interval;
    uint8_t frame_count;
    void (*frame_func)(uint8_t frame_idx, uint8_t toggle);
} anim_config_t;

/* 动画帧函数声明 */
`;
        
        for (const anim of animList) {
            code += `static void anim_frame_${this.toVarName(anim.id)}(uint8_t frame_idx, uint8_t toggle);\n`;
        }
        
        code += `
/* 动画配置表 */
static const anim_config_t anim_configs[ANIM_COUNT] = {
`;
        
        for (const anim of animList) {
            const config = animConfig[anim.id] || {};
            const interval = config.interval || 500;
            const frameCount = config.frames?.length || 2;
            code += `    [${anim.enum}] = { ${interval}, ${frameCount}, anim_frame_${this.toVarName(anim.id)} },\n`;
        }
        
        code += `};

/* 初始化 */
void anim_init(void) {
    for (uint8_t i = 0; i < ANIM_COUNT; i++) {
        anim_states[i].running = 0;
    }
}

/* 时间推进 */
void anim_tick(uint16_t elapsed_ms) {
    for (uint8_t i = 0; i < ANIM_COUNT; i++) {
        anim_state_t* s = &anim_states[i];
        if (!s->running) continue;
        
        s->elapsed_ms += elapsed_ms;
        s->total_ms += elapsed_ms;
        
        /* 检查超时 */
        if (s->timeout_ms > 0 && s->total_ms >= s->timeout_ms) {
            s->running = 0;
            continue;
        }
        
        /* 检查帧切换 */
        if (s->elapsed_ms >= s->interval_ms) {
            s->elapsed_ms = 0;
            s->toggle_state = !s->toggle_state;
            s->frame_idx++;
            if (s->frame_idx >= anim_configs[i].frame_count) {
                s->frame_idx = 0;
            }
            
            /* 调用帧函数 */
            if (anim_configs[i].frame_func) {
                anim_configs[i].frame_func(s->frame_idx, s->toggle_state);
            }
        }
    }
}

/* 启动动画 */
void anim_start(ui_anim_id_t anim_id) {
    anim_start_ex(anim_id, anim_configs[anim_id].default_interval, 0);
}

/* 启动动画 (带参数) */
void anim_start_ex(ui_anim_id_t anim_id, uint16_t interval_ms, uint32_t timeout_ms) {
    if (anim_id >= ANIM_COUNT) return;
    
    anim_state_t* s = &anim_states[anim_id];
    s->running = 1;
    s->interval_ms = interval_ms > 0 ? interval_ms : anim_configs[anim_id].default_interval;
    s->timeout_ms = timeout_ms;
    s->elapsed_ms = 0;
    s->total_ms = 0;
    s->frame_idx = 0;
    s->toggle_state = 0;
}

/* 停止动画 */
void anim_stop(ui_anim_id_t anim_id) {
    if (anim_id >= ANIM_COUNT) return;
    anim_states[anim_id].running = 0;
}

/* 停止所有动画 */
void anim_stop_all(void) {
    for (uint8_t i = 0; i < ANIM_COUNT; i++) {
        anim_states[i].running = 0;
    }
}

/* 检查动画是否运行 */
uint8_t anim_is_running(ui_anim_id_t anim_id) {
    if (anim_id >= ANIM_COUNT) return 0;
    return anim_states[anim_id].running;
}

/* ========== 动画帧函数 ========== */

`;
        
        // 生成每个动画的帧函数
        for (const anim of animList) {
            const config = animConfig[anim.id] || {};
            code += `/* ${config.name || anim.id} */\n`;
            code += `static void anim_frame_${this.toVarName(anim.id)}(uint8_t frame_idx, uint8_t toggle) {\n`;
            
            // 根据动画类型生成代码
            if (config.type === 'blink' || !config.type) {
                // 闪烁动画
                const targets = config.targets || [];
                for (const target of targets) {
                    code += `    ui.${target}.set(toggle);\n`;
                }
                if (targets.length === 0) {
                    code += `    /* TODO: 配置闪烁目标 */\n`;
                }
            } else if (config.type === 'sequence') {
                // 序列动画
                code += `    /* TODO: 序列动画帧 */\n`;
            }
            
            code += `}\n\n`;
        }
        
        return code;
    },
    
    // ---------- 变量头文件 ----------
    generateVariablesHeader(symbols, stateMachine, deps) {
        const date = new Date().toISOString().split('T')[0];
        const variables = symbols.variables;
        
        let code = `/**
 * @file    ui_variables.h
 * @brief   UI变量系统 (自动生成 - 只包含用到的)
 * @date    ${date}
 * @note    共 ${variables.length} 个变量
 * 
 * 对应上位机: UIStore + FlowController
 */

#ifndef UI_VARIABLES_H
#define UI_VARIABLES_H

#include <stdint.h>

/* UI变量结构 */
typedef struct {
`;
        
        for (const v of variables) {
            const cType = this.toCType(v.type);
            code += `    ${cType} ${v.id};  /* ${v.description || ''} */\n`;
        }
        
        code += `} ui_vars_t;

/* 全局变量实例 */
extern ui_vars_t g_ui_vars;

/* ========== 变量API ========== */
void ui_vars_init(void);
void ui_vars_scroll_history(void);

/* ========== 流程控制API (FlowController) ========== */
void flow_save_snapshot(void);      /* 保存数据快照 */
void flow_restore_snapshot(void);   /* 恢复数据快照 */
void flow_clear_snapshots(void);    /* 清空快照 */
uint8_t flow_get_snapshot_count(void);  /* 获取快照数量 */

#endif /* UI_VARIABLES_H */
`;
        return code;
    },
    
    // ---------- 变量源文件 ----------
    generateVariablesSource(symbols, stateMachine, deps) {
        const date = new Date().toISOString().split('T')[0];
        const variables = symbols.variables;
        
        let code = `/**
 * @file    ui_variables.c
 * @brief   UI变量系统实现 (自动生成)
 * @date    ${date}
 */

#include "ui_variables.h"
#include "ui_controller.h"
#include <string.h>

/* 全局变量实例 */
ui_vars_t g_ui_vars;

/* 数据快照 (用于撤回) */
#define MAX_SNAPSHOTS 4
static ui_vars_t snapshots[MAX_SNAPSHOTS];
static uint8_t snapshot_count = 0;

/* 初始化 */
void ui_vars_init(void) {
    memset(&g_ui_vars, 0, sizeof(g_ui_vars));
    snapshot_count = 0;
    
`;
        
        for (const v of variables) {
            if (v.default !== undefined && v.default !== 0) {
                code += `    g_ui_vars.${v.id} = ${v.default};\n`;
            }
        }
        
        // 初始化 max_data 和 min_data 为 -1
        const hasMaxData = variables.some(v => v.id === 'max_data');
        const hasMinData = variables.some(v => v.id === 'min_data');
        if (hasMaxData) code += `    g_ui_vars.max_data = -1;\n`;
        if (hasMinData) code += `    g_ui_vars.min_data = -1;\n`;
        
        code += `}

/* 历史数据滚动 (line1←line2←line3←line4) */
void ui_vars_scroll_history(void) {
`;
        
        // 检查是否有line数据变量
        const hasLine1 = variables.some(v => v.id === 'line1_data');
        const hasLine2 = variables.some(v => v.id === 'line2_data');
        const hasLine3 = variables.some(v => v.id === 'line3_data');
        const hasLine4 = variables.some(v => v.id === 'line4_data');
        
        if (hasLine1 && hasLine2) {
            code += `    g_ui_vars.line1_data = g_ui_vars.line2_data;\n`;
        }
        if (hasLine2 && hasLine3) {
            code += `    g_ui_vars.line2_data = g_ui_vars.line3_data;\n`;
        }
        if (hasLine3 && hasLine4) {
            code += `    g_ui_vars.line3_data = g_ui_vars.line4_data;\n`;
        }
        if (hasLine4) {
            code += `    g_ui_vars.line4_data = 0;\n`;
        }
        
        code += `}

/* 保存数据快照 (进入准备状态时调用) */
void flow_save_snapshot(void) {
    if (snapshot_count < MAX_SNAPSHOTS) {
        memcpy(&snapshots[snapshot_count], &g_ui_vars, sizeof(ui_vars_t));
        snapshot_count++;
    } else {
        /* 快照满了，移除最旧的 */
        memmove(&snapshots[0], &snapshots[1], sizeof(ui_vars_t) * (MAX_SNAPSHOTS - 1));
        memcpy(&snapshots[MAX_SNAPSHOTS - 1], &g_ui_vars, sizeof(ui_vars_t));
    }
}

/* 恢复数据快照 (撤回时调用) */
void flow_restore_snapshot(void) {
    if (snapshot_count > 0) {
        snapshot_count--;
        memcpy(&g_ui_vars, &snapshots[snapshot_count], sizeof(ui_vars_t));
    }
}

/* 清空快照 */
void flow_clear_snapshots(void) {
    snapshot_count = 0;
}

/* 获取快照数量 */
uint8_t flow_get_snapshot_count(void) {
    return snapshot_count;
}
`;
        return code;
    },
    
    // ---------- HAL头文件 ----------
    generateHalHeader(symbols) {
        const date = new Date().toISOString().split('T')[0];
        
        return `/**
 * @file    ui_hal.h
 * @brief   UI硬件抽象层 (用户实现)
 * @date    ${date}
 */

#ifndef UI_HAL_H
#define UI_HAL_H

#include <stdint.h>

/* 系统tick (用户实现) */
uint32_t sys_tick_get(void);

/* LCD驱动 (用户实现) */
void seg_lcd_write_buffer(uint8_t* buffer, uint8_t size);

#endif /* UI_HAL_H */
`;
    },
    
    // ---------- 硬件回调头文件 ----------
    generateHwCallbacksHeader(symbols, deps) {
        const date = new Date().toISOString().split('T')[0];
        const callbacks = symbols.hardwareCallbacks;
        
        let code = `/**
 * @file    hw_callbacks.h
 * @brief   硬件回调接口 (用户实现)
 * @date    ${date}
 * @note    共 ${callbacks.length} 个回调
 */

#ifndef HW_CALLBACKS_H
#define HW_CALLBACKS_H

#include <stdint.h>

/* ========== 硬件回调函数 ========== */
/* 用户需要实现以下函数 */

`;
        
        for (const cb of callbacks) {
            code += `void ${cb.func}(void);\n`;
        }
        
        code += `
/* ========== 通用硬件接口 ========== */

void hw_beep(uint16_t ms);
void hw_backlight_on(void);
void hw_backlight_off(void);

#endif /* HW_CALLBACKS_H */
`;
        return code;
    },
    
    // ---------- 主循环模板 ----------
    generateMainLoopTemplate() {
        const date = new Date().toISOString().split('T')[0];
        
        return `/**
 * @file    main_loop.c
 * @brief   主循环模板 (参考实现)
 * @date    ${date}
 */

#include "ui_controller.h"
#include "ui_state_machine.h"
#include "ui_animation.h"
#include "lcd_mapping.h"

/* 10ms tick标志 */
static volatile uint8_t tick_10ms_flag = 0;

/* 定时器中断 (1ms) */
void sys_tick_1ms_handler(void) {
    static uint8_t cnt = 0;
    if (++cnt >= 10) {
        cnt = 0;
        tick_10ms_flag = 1;
    }
}

/* 10ms tick处理 */
void main_tick(void) {
    /* 1. 动画推进 */
    anim_tick(10);
    
    /* 2. LCD刷新 */
    lcd_update();
}

/* 主循环 */
void main_loop(void) {
    /* 初始化 */
    lcd_init();
    ui_init();
    anim_init();
    ui_hsm_init(&g_ui_hsm);
    
    while (1) {
        if (tick_10ms_flag) {
            tick_10ms_flag = 0;
            main_tick();
        }
        
        /* 其他业务逻辑 */
    }
}
`;
    },
    
    // ---------- 单位转换器头文件 ----------
    generateUnitConverterHeader() {
        const date = new Date().toISOString().split('T')[0];
        
        return `/**
 * @file    unit_converter.h
 * @brief   单位转换器 (自动生成)
 * @date    ${date}
 * 
 * 设计原则:
 * 1. 存储原始值(米) - 不丢失精度
 * 2. 显示时转换 - 根据当前单位
 * 3. 计算用原始值 - 保证精度
 * 4. 单位切换时自动刷新显示
 */

#ifndef UNIT_CONVERTER_H
#define UNIT_CONVERTER_H

#include <stdint.h>
#include "ui_controller.h"

/* 单位索引 */
#define UNIT_M   0   /* 米 */
#define UNIT_FT  1   /* 英尺 */
#define UNIT_IN  2   /* 英寸 */

/* 转换系数 */
#define M_TO_FT     3.28084f    /* 米 → 英尺 */
#define M_TO_IN     39.3701f    /* 米 → 英寸 */
#define M2_TO_FT2   10.7639f    /* 平方米 → 平方英尺 */
#define M3_TO_FT3   35.3147f    /* 立方米 → 立方英尺 */
#define IN2_TO_FT2  144.0f      /* 平方英寸 → 平方英尺 */
#define IN3_TO_FT3  1728.0f     /* 立方英寸 → 立方英尺 */

/* 单位配置结构 */
typedef struct {
    float factor;       /* 转换系数 (米→显示单位) */
    uint8_t decimals;   /* 小数位数 */
    float max;          /* 最大显示值 */
} unit_cfg_t;

/* API函数 */

/**
 * @brief 获取单位配置
 * @param unit_idx 单位索引 (UNIT_M/UNIT_FT/UNIT_IN)
 * @param data_type 数据类型 (DATA_LENGTH/DATA_AREA/DATA_VOLUME)
 * @return 单位配置
 */
unit_cfg_t unit_get_config(uint8_t unit_idx, data_type_e data_type);

/**
 * @brief 米转显示值
 * @param value_m 原始值(米)
 * @param unit_idx 单位索引
 * @param data_type 数据类型
 * @return 显示值
 */
float unit_to_display(float value_m, uint8_t unit_idx, data_type_e data_type);

/**
 * @brief 显示值转米
 * @param value_display 显示值
 * @param unit_idx 单位索引
 * @param data_type 数据类型
 * @return 原始值(米)
 */
float unit_to_meters(float value_display, uint8_t unit_idx, data_type_e data_type);

#endif /* UNIT_CONVERTER_H */
`;
    },
    
    // ---------- 单位转换器源文件 ----------
    generateUnitConverterSource() {
        const date = new Date().toISOString().split('T')[0];
        
        return `/**
 * @file    unit_converter.c
 * @brief   单位转换器实现 (自动生成)
 * @date    ${date}
 */

#include "unit_converter.h"

/* 长度单位配置表 */
static const unit_cfg_t length_configs[] = {
    [UNIT_M]  = { 1.0f,      3, 99999.0f },   /* 米: 3位小数, 最大99999 */
    [UNIT_FT] = { M_TO_FT,   3, 99999.0f },   /* 英尺: 3位小数 */
    [UNIT_IN] = { M_TO_IN,   2, 99999.0f },   /* 英寸: 2位小数 */
};

/* 面积单位配置表 */
static const unit_cfg_t area_configs[] = {
    [UNIT_M]  = { 1.0f,       3, 99999.0f },  /* 平方米 */
    [UNIT_FT] = { M2_TO_FT2,  3, 99999.0f },  /* 平方英尺 */
    [UNIT_IN] = { M2_TO_FT2,  3, 99999.0f },  /* 英寸模式下面积显示ft² */
};

/* 体积单位配置表 */
static const unit_cfg_t volume_configs[] = {
    [UNIT_M]  = { 1.0f,       3, 99999.0f },  /* 立方米 */
    [UNIT_FT] = { M3_TO_FT3,  3, 99999.0f },  /* 立方英尺 */
    [UNIT_IN] = { M3_TO_FT3,  3, 99999.0f },  /* 英寸模式下体积显示ft³ */
};

/* 获取单位配置 */
unit_cfg_t unit_get_config(uint8_t unit_idx, data_type_e data_type) {
    if (unit_idx > UNIT_IN) unit_idx = UNIT_M;
    
    switch (data_type) {
    case DATA_LENGTH:
        return length_configs[unit_idx];
    case DATA_AREA:
        return area_configs[unit_idx];
    case DATA_VOLUME:
        return volume_configs[unit_idx];
    default:
        return length_configs[unit_idx];
    }
}

/* 米转显示值 */
float unit_to_display(float value_m, uint8_t unit_idx, data_type_e data_type) {
    unit_cfg_t cfg = unit_get_config(unit_idx, data_type);
    return value_m * cfg.factor;
}

/* 显示值转米 */
float unit_to_meters(float value_display, uint8_t unit_idx, data_type_e data_type) {
    unit_cfg_t cfg = unit_get_config(unit_idx, data_type);
    if (cfg.factor == 0) return 0;
    return value_display / cfg.factor;
}
`;
    },
    
    // ========== 工具函数 ==========
    toEnumName(name) {
        return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    },
    
    toVarName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    },
    
    toCType(type) {
        switch (type) {
            case 'int': return 'int16_t';
            case 'float': return 'float';
            case 'bool': return 'uint8_t';
            default: return 'int16_t';
        }
    },
    
    // ========== 代码统计 ==========
    getCodeStats(codeFiles) {
        let totalFiles = 0;
        let totalLines = 0;
        let totalBytes = 0;
        
        for (const [name, content] of Object.entries(codeFiles)) {
            totalFiles++;
            totalLines += content.split('\n').length;
            totalBytes += content.length;
        }
        
        return { totalFiles, totalLines, totalBytes };
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.CodeGeneratorV4;
}
