/**
 * @file    code_generator_v2.js
 * @brief   UI代码生成器 v3.0 - 支持 Line/Selector/Icon 三种组件类型
 * @version 3.0
 * @date    2025-12-31
 * 
 * 组件类型:
 * 1. Line - 数字行显示 (数字+单位转换)
 * 2. Selector - 模式/等级选择器
 * 3. Icon - 图标显示/隐藏
 * 
 * 生成的C代码结构:
 * - ui_t 控制器结构体
 * - ui_line_t, ui_sel_t, ui_icon_t 组件结构
 * - 枚举定义 (UNIT_M, BASE_FRONT 等)
 * - 单位转换配置表
 */

window.CodeGeneratorV2 = {
    version: '3.0.0',
    
    config: {
        segCount: 54,
        comCount: 8,
        indent: '    ',
        prefix: 'ui_',
        generateComments: true,
    },
    
    // ========== 主入口 ==========
    async generateAll(projectData) {
        const { lcdProject, components, presets, animations, stateMachine, variables } = projectData;
        
        // 使用 v3 组件配置
        const comps = components?.components || {};
        
        const result = {
            // Layer 1: LCD驱动层
            'lcd_mapping.h': this.generateLcdMappingHeader(lcdProject),
            'lcd_mapping.c': this.generateLcdMappingSource(lcdProject),
            
            // Layer 2: UI控制器 (核心)
            'ui_controller.h': this.generateUIControllerHeader(comps),
            'ui_controller.c': this.generateUIControllerSource(comps, lcdProject),
            
            // Layer 3: 单位转换
            'unit_converter.h': this.generateUnitConverterHeader(comps),
            'unit_converter.c': this.generateUnitConverterSource(comps),

            // Layer 4: 预设和动画
            'ui_presets.h': this.generatePresetsHeader(presets),
            'ui_presets.c': this.generatePresetsSourceV2(presets, components),
            'ui_animation.h': this.generateAnimationHeader(animations),
            'ui_animation.c': this.generateAnimationSource(animations, comps),
            
            // Layer 5: 状态机
            'ui_state_machine.h': this.generateStateMachineHeader(stateMachine),
            'ui_state_machine.c': this.generateStateMachineSourceV2(stateMachine, presets, animations),
            
            // Layer 0: 硬件抽象层
            'ui_hal.h': this.generateHardwareHeader(),
            'hw_callbacks.h': this.generateHwCallbacksHeader(comps),
            
            // 主循环模板
            'main_loop.c': this.generateMainLoopTemplate(),
        };
        
        return result;
    },
    
    // ========== UI控制器头文件 ==========
    generateUIControllerHeader(comps) {
        // 分类组件
        const lines = [];
        const selectors = [];
        const icons = [];
        
        for (const [name, comp] of Object.entries(comps)) {
            if (comp.type === 'Line') lines.push({ name, ...comp });
            else if (comp.type === 'Selector') selectors.push({ name, ...comp });
            else if (comp.type === 'Icon') icons.push({ name, ...comp });
        }
        
        let code = `/**
 * @file    ui_controller.h
 * @brief   UI控制器 v3.0 - Line/Selector/Icon (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 使用方式:
 *   ui.line4.set(12.345f, DATA_LENGTH);  // 设置数字行
 *   ui.unit.set(UNIT_FT);                // 切换单位
 *   ui.laser.set(ICON_ON);               // 控制图标
 */

#ifndef UI_CONTROLLER_H
#define UI_CONTROLLER_H

#include <stdint.h>
#include <stdbool.h>

/* ========== 枚举定义 ========== */

/* 数据类型 */
typedef enum {
    DATA_LENGTH = 0,
    DATA_AREA = 1,
    DATA_VOLUME = 2,
} data_type_e;

/* Icon开关 */
#define ICON_OFF 0
#define ICON_ON  1

/* Line特殊值 */
#define LINE_DASH "-----"
#define LINE_ERR  "Err"
#define LINE_OL   "OL"
#define LINE_OFF  "OFF"

`;
        
        // 为每个Selector生成枚举
        for (const sel of selectors) {
            const enumName = this.toEnumName(sel.name);
            code += `/* ${sel.description || sel.name} */\n`;
            code += `typedef enum {\n`;
            for (const opt of sel.options || []) {
                code += `    ${enumName}_${opt.key} = ${opt.value},\n`;
            }
            code += `} ${sel.name}_e;\n\n`;
        }
        
        code += `/* ========== 组件结构体 ========== */

/* Line组件 */
typedef struct {
    char display[16];       /* 当前显示字符串 */
    float raw_m;            /* 原始值(米) */
    data_type_e data_type;  /* 数据类型 */
    void (*set)(float value, data_type_e type);
    void (*set_str)(const char* str);
    const char* (*get)(void);
} ui_line_t;

/* Selector组件 */
typedef struct {
    uint8_t value;          /* 当前索引 */
    void (*set)(uint8_t v);
    uint8_t (*get)(void);
} ui_sel_t;

/* Icon组件 */
typedef struct {
    uint8_t value;          /* 0/1 */
    void (*set)(uint8_t v);
    uint8_t (*get)(void);
} ui_icon_t;

/* ========== UI控制器 ========== */

typedef struct {
`;
        
        // Line组件
        if (lines.length > 0) {
            code += `    /* Line组件 */\n`;
            for (const line of lines) {
                code += `    ui_line_t ${line.name};  /* ${line.description || ''} */\n`;
            }
            code += '\n';
        }
        
        // Selector组件
        if (selectors.length > 0) {
            code += `    /* Selector组件 */\n`;
            for (const sel of selectors) {
                code += `    ui_sel_t ${sel.name};  /* ${sel.description || ''} */\n`;
            }
            code += '\n';
        }
        
        // Icon组件
        if (icons.length > 0) {
            code += `    /* Icon组件 */\n`;
            for (const icon of icons) {
                code += `    ui_icon_t ${icon.name};  /* ${icon.description || ''} */\n`;
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

    // ========== UI控制器源文件 ==========
    generateUIControllerSource(comps, lcdProject) {
        // 分类组件
        const lines = [];
        const selectors = [];
        const icons = [];
        
        for (const [name, comp] of Object.entries(comps)) {
            if (comp.type === 'Line') lines.push({ name, ...comp });
            else if (comp.type === 'Selector') selectors.push({ name, ...comp });
            else if (comp.type === 'Icon') icons.push({ name, ...comp });
        }
        
        let code = `/**
 * @file    ui_controller.c
 * @brief   UI控制器实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "ui_controller.h"
#include "ui_animation.h"
#include "lcd_mapping.h"
#include "unit_converter.h"
#include "hw_callbacks.h"
#include <string.h>
#include <stdio.h>

/* 全局实例 */
ui_t ui;

/* ========== 七段数码管字形表 ========== */
static const uint8_t digit_patterns[128] = {
    ['0'] = 0x3F, ['1'] = 0x06, ['2'] = 0x5B, ['3'] = 0x4F, ['4'] = 0x66,
    ['5'] = 0x6D, ['6'] = 0x7D, ['7'] = 0x07, ['8'] = 0x7F, ['9'] = 0x6F,
    ['A'] = 0x77, ['B'] = 0x7C, ['C'] = 0x39, ['D'] = 0x5E, ['E'] = 0x79,
    ['F'] = 0x71, ['-'] = 0x40, ['_'] = 0x08, [' '] = 0x00, ['.'] = 0x80,
    ['r'] = 0x50, ['n'] = 0x54, ['u'] = 0x1C, ['L'] = 0x38, ['H'] = 0x76,
    ['N'] = 0x37, ['U'] = 0x3E, ['o'] = 0x5C, ['P'] = 0x73, ['t'] = 0x78,
};

/* ========== 前向声明 ========== */
`;
        
        // 前向声明
        for (const line of lines) {
            code += `static void ${line.name}_set(float value, data_type_e type);\n`;
            code += `static void ${line.name}_set_str(const char* str);\n`;
            code += `static const char* ${line.name}_get(void);\n`;
            code += `static void ${line.name}_render(void);\n`;
        }
        for (const sel of selectors) {
            code += `static void ${sel.name}_set(uint8_t v);\n`;
            code += `static uint8_t ${sel.name}_get(void);\n`;
            code += `static void ${sel.name}_render(void);\n`;
        }
        for (const icon of icons) {
            code += `static void ${icon.name}_set(uint8_t v);\n`;
            code += `static uint8_t ${icon.name}_get(void);\n`;
            code += `static void ${icon.name}_render(void);\n`;
        }
        
        code += `
/* ========== Line组件实现 ========== */

`;
        
        // Line组件实现
        for (const line of lines) {
            const varName = line.name;
            code += `/* ${line.description || line.name} */\n`;
            code += `static void ${varName}_set(float value, data_type_e type) {\n`;
            code += `    ui.${varName}.raw_m = value;\n`;
            code += `    ui.${varName}.data_type = type;\n`;
            code += `    \n`;
            code += `    /* 转换并格式化 */\n`;
            code += `    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);\n`;
            code += `    float display_val = value * cfg.factor;\n`;
            code += `    \n`;
            code += `    /* 范围检查 */\n`;
            code += `    if (display_val > cfg.max) {\n`;
            code += `        strcpy(ui.${varName}.display, LINE_OL);\n`;
            code += `    } else {\n`;
            code += `        snprintf(ui.${varName}.display, 16, "%.*f", cfg.decimals, display_val);\n`;
            code += `    }\n`;
            code += `    \n`;
            code += `    /* 渲染到LCD */\n`;
            code += `    ${varName}_render();\n`;
            code += `}\n\n`;
            
            code += `static void ${varName}_set_str(const char* str) {\n`;
            code += `    strncpy(ui.${varName}.display, str, 15);\n`;
            code += `    ui.${varName}.display[15] = '\\0';\n`;
            code += `    ui.${varName}.raw_m = 0;\n`;
            code += `    ${varName}_render();\n`;
            code += `}\n\n`;
            
            code += `static const char* ${varName}_get(void) {\n`;
            code += `    return ui.${varName}.display;\n`;
            code += `}\n\n`;
            
            code += `static void ${varName}_render(void) {\n`;
            code += `    /* TODO: 根据配置渲染数字位和单位 */\n`;
            code += `    lcd_update();\n`;
            code += `}\n\n`;
        }
        
        code += `/* ========== Selector组件实现 ========== */\n\n`;
        
        // Selector组件实现
        for (const sel of selectors) {
            const varName = sel.name;
            const onSet = sel.onSet || {};
            
            code += `/* ${sel.description || sel.name} */\n`;
            code += `static void ${varName}_set(uint8_t v) {\n`;
            code += `    ui.${varName}.value = v;\n`;
            
            // 如果是unit，需要刷新所有Line
            if (sel.triggerRefresh) {
                code += `    ui_refresh_all_lines();\n`;
            }
            
            // 生成 onSet 联动代码
            if (Object.keys(onSet).length > 0) {
                code += `    \n`;
                code += `    /* onSet 联动 */\n`;
                code += `    switch (v) {\n`;
                for (const [key, actions] of Object.entries(onSet)) {
                    code += `        case ${key}:\n`;
                    if (actions.anim) {
                        const anim = actions.anim;
                        const animEnum = `ANIM_${this.toEnumName(anim.id)}`;
                        if (anim.action === 'stop') {
                            code += `            anim_stop(${animEnum});\n`;
                        } else {
                            const interval = anim.interval || 0;
                            const timeout = anim.timeout || 0;
                            code += `            anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
                        }
                    }
                    if (actions.hardware) {
                        code += `            hw_${actions.hardware}();\n`;
                    }
                    code += `            break;\n`;
                }
                code += `    }\n`;
            }
            
            code += `    ${varName}_render();\n`;
            code += `}\n\n`;
            
            code += `static uint8_t ${varName}_get(void) {\n`;
            code += `    return ui.${varName}.value;\n`;
            code += `}\n\n`;
            
            code += `static void ${varName}_render(void) {\n`;
            // 关闭所有选项元素
            const allElements = new Set();
            for (const opt of sel.options || []) {
                for (const elem of opt.elements || []) {
                    allElements.add(elem);
                }
            }
            for (const elem of sel.frame || []) {
                allElements.add(elem);
            }
            
            code += `    /* 关闭所有元素 */\n`;
            for (const elem of allElements) {
                code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 0);\n`;
            }
            
            // 打开frame元素（始终显示）
            if (sel.frame?.length) {
                code += `    \n`;
                code += `    /* 框架元素（始终显示）*/\n`;
                for (const elem of sel.frame) {
                    code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 1);\n`;
                }
            }
            
            // 根据值打开对应选项
            code += `    \n`;
            code += `    /* 打开当前选项元素 */\n`;
            code += `    switch (ui.${varName}.value) {\n`;
            for (const opt of sel.options || []) {
                code += `        case ${opt.value}: /* ${opt.key} */\n`;
                for (const elem of opt.elements || []) {
                    code += `            lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, 1);\n`;
                }
                code += `            break;\n`;
            }
            code += `    }\n`;
            code += `}\n\n`;
        }
        
        code += `/* ========== Icon组件实现 ========== */\n\n`;
        
        // Icon组件实现
        for (const icon of icons) {
            const varName = icon.name;
            const onSet = icon.onSet || {};
            
            code += `/* ${icon.description || icon.name} */\n`;
            code += `static void ${varName}_set(uint8_t v) {\n`;
            code += `    ui.${varName}.value = v;\n`;
            
            // 生成 onSet 联动代码
            if (Object.keys(onSet).length > 0) {
                code += `    \n`;
                code += `    /* onSet 联动 */\n`;
                code += `    if (v) {\n`;
                if (onSet['true']) {
                    if (onSet['true'].anim) {
                        const anim = onSet['true'].anim;
                        const animEnum = `ANIM_${this.toEnumName(anim.id)}`;
                        if (anim.action === 'stop') {
                            code += `        anim_stop(${animEnum});\n`;
                        } else {
                            const interval = anim.interval || 0;
                            const timeout = anim.timeout || 0;
                            code += `        anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
                        }
                    }
                    if (onSet['true'].hardware) {
                        code += `        hw_${onSet['true'].hardware}();\n`;
                    }
                }
                code += `    } else {\n`;
                if (onSet['false']) {
                    if (onSet['false'].anim) {
                        const anim = onSet['false'].anim;
                        // 如果没有指定id，使用true分支的动画id（用于stop操作）
                        const animId = anim.id || (onSet['true']?.anim?.id);
                        if (animId) {
                            const animEnum = `ANIM_${this.toEnumName(animId)}`;
                            if (anim.action === 'stop') {
                                code += `        anim_stop(${animEnum});\n`;
                            } else {
                                const interval = anim.interval || 0;
                                const timeout = anim.timeout || 0;
                                code += `        anim_start_ex(${animEnum}, ${interval}, ${timeout});\n`;
                            }
                        }
                    }
                    if (onSet['false'].hardware) {
                        code += `        hw_${onSet['false'].hardware}();\n`;
                    }
                }
                code += `    }\n`;
            }
            
            code += `    ${varName}_render();\n`;
            code += `}\n\n`;
            
            code += `static uint8_t ${varName}_get(void) {\n`;
            code += `    return ui.${varName}.value;\n`;
            code += `}\n\n`;
            
            code += `static void ${varName}_render(void) {\n`;
            code += `    /* 设置图标元素 */\n`;
            for (const elem of icon.elements || []) {
                code += `    lcd_set_element(LCD_ELEM_${this.toEnumName(elem)}, ui.${varName}.value);\n`;
            }
            code += `}\n\n`;
        }
        
        code += `/* ========== 初始化 ========== */

void ui_init(void) {
    memset(&ui, 0, sizeof(ui));
    
`;
        
        // 初始化Line组件
        for (const line of lines) {
            code += `    /* ${line.name} */\n`;
            code += `    ui.${line.name}.set = ${line.name}_set;\n`;
            code += `    ui.${line.name}.set_str = ${line.name}_set_str;\n`;
            code += `    ui.${line.name}.get = ${line.name}_get;\n`;
            code += `    strcpy(ui.${line.name}.display, LINE_DASH);\n\n`;
        }
        
        // 初始化Selector组件
        for (const sel of selectors) {
            code += `    /* ${sel.name} */\n`;
            code += `    ui.${sel.name}.set = ${sel.name}_set;\n`;
            code += `    ui.${sel.name}.get = ${sel.name}_get;\n`;
            code += `    ui.${sel.name}.value = ${sel.default || 0};\n\n`;
        }
        
        // 初始化Icon组件
        for (const icon of icons) {
            code += `    /* ${icon.name} */\n`;
            code += `    ui.${icon.name}.set = ${icon.name}_set;\n`;
            code += `    ui.${icon.name}.get = ${icon.name}_get;\n`;
            code += `    ui.${icon.name}.value = ${icon.default ? 1 : 0};\n\n`;
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
            code += `    if (ui.${line.name}.raw_m != 0) {\n`;
            code += `        ui.${line.name}.set(ui.${line.name}.raw_m, ui.${line.name}.data_type);\n`;
            code += `    }\n`;
        }
        
        code += `}
`;
        return code;
    },

    // ========== 单位转换模块 ==========
    generateUnitConverterHeader(comps) {
        return `/**
 * @file    unit_converter.h
 * @brief   单位转换模块 (自动生成)
 * @note    存储原始值(米)，显示时转换
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#ifndef UNIT_CONVERTER_H
#define UNIT_CONVERTER_H

#include <stdint.h>

/* 单位索引 */
typedef enum {
    UNIT_M = 0,     /* 米 */
    UNIT_FT = 1,    /* 英尺 */
    UNIT_IN = 2,    /* 英寸 */
    UNIT_COUNT
} unit_e;

/* 数据类型 */
typedef enum {
    DATA_LENGTH = 0,
    DATA_AREA = 1,
    DATA_VOLUME = 2,
    DATA_TYPE_COUNT
} data_type_e;

/* 单位配置 */
typedef struct {
    float factor;       /* 转换系数 */
    uint8_t decimals;   /* 小数位数 */
    float min;          /* 最小值 */
    float max;          /* 最大值 */
} unit_cfg_t;

/* API函数 */
unit_cfg_t unit_get_config(unit_e unit, data_type_e type);
float unit_convert(float meters, unit_e unit, data_type_e type);
uint8_t unit_get_decimals(unit_e unit, data_type_e type);

#endif /* UNIT_CONVERTER_H */
`;
    },
    
    generateUnitConverterSource(comps) {
        // 从组件中提取单位配置
        let unitConfig = null;
        for (const [name, comp] of Object.entries(comps)) {
            if (comp.type === 'Line' && comp.unitConfig) {
                unitConfig = comp.unitConfig;
                break;
            }
        }
        
        // 默认配置
        if (!unitConfig) {
            unitConfig = {
                length: {
                    m:  { factor: 1.0,     decimals: 3, min: 0.05,  max: 99.999 },
                    ft: { factor: 3.28084, decimals: 3, min: 0.164, max: 328.08 },
                    in: { factor: 39.3701, decimals: 2, min: 1.97,  max: 3937.0 }
                },
                area: {
                    m2:  { factor: 1.0,      decimals: 3, min: 0, max: 999.99 },
                    ft2: { factor: 10.7639,  decimals: 2, min: 0, max: 9999.9 },
                    in2: { factor: 1550.003, decimals: 1, min: 0, max: 99999 }
                },
                volume: {
                    m3:  { factor: 1.0,       decimals: 3, min: 0, max: 999.99 },
                    ft3: { factor: 35.3147,   decimals: 2, min: 0, max: 9999.9 },
                    in3: { factor: 61023.744, decimals: 0, min: 0, max: 99999 }
                }
            };
        }
        
        return `/**
 * @file    unit_converter.c
 * @brief   单位转换模块实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "unit_converter.h"
#include <math.h>

/* 单位配置表 [数据类型][单位] */
static const unit_cfg_t unit_configs[DATA_TYPE_COUNT][UNIT_COUNT] = {
    /* DATA_LENGTH */
    {
        { ${unitConfig.length.m.factor}f, ${unitConfig.length.m.decimals}, ${unitConfig.length.m.min}f, ${unitConfig.length.m.max}f },   /* m */
        { ${unitConfig.length.ft.factor}f, ${unitConfig.length.ft.decimals}, ${unitConfig.length.ft.min}f, ${unitConfig.length.ft.max}f }, /* ft */
        { ${unitConfig.length.in.factor}f, ${unitConfig.length.in.decimals}, ${unitConfig.length.in.min}f, ${unitConfig.length.in.max}f }, /* in */
    },
    /* DATA_AREA */
    {
        { ${unitConfig.area.m2.factor}f, ${unitConfig.area.m2.decimals}, ${unitConfig.area.m2.min}f, ${unitConfig.area.m2.max}f },   /* m² */
        { ${unitConfig.area.ft2.factor}f, ${unitConfig.area.ft2.decimals}, ${unitConfig.area.ft2.min}f, ${unitConfig.area.ft2.max}f }, /* ft² */
        { ${unitConfig.area.in2.factor}f, ${unitConfig.area.in2.decimals}, ${unitConfig.area.in2.min}f, ${unitConfig.area.in2.max}f }, /* in² */
    },
    /* DATA_VOLUME */
    {
        { ${unitConfig.volume.m3.factor}f, ${unitConfig.volume.m3.decimals}, ${unitConfig.volume.m3.min}f, ${unitConfig.volume.m3.max}f },   /* m³ */
        { ${unitConfig.volume.ft3.factor}f, ${unitConfig.volume.ft3.decimals}, ${unitConfig.volume.ft3.min}f, ${unitConfig.volume.ft3.max}f }, /* ft³ */
        { ${unitConfig.volume.in3.factor}f, ${unitConfig.volume.in3.decimals}, ${unitConfig.volume.in3.min}f, ${unitConfig.volume.in3.max}f }, /* in³ */
    },
};

/* 获取单位配置 */
unit_cfg_t unit_get_config(unit_e unit, data_type_e type) {
    if (unit >= UNIT_COUNT) unit = UNIT_M;
    if (type >= DATA_TYPE_COUNT) type = DATA_LENGTH;
    return unit_configs[type][unit];
}

/* 转换值 */
float unit_convert(float meters, unit_e unit, data_type_e type) {
    unit_cfg_t cfg = unit_get_config(unit, type);
    return meters * cfg.factor;
}

/* 获取小数位数 */
uint8_t unit_get_decimals(unit_e unit, data_type_e type) {
    unit_cfg_t cfg = unit_get_config(unit, type);
    return cfg.decimals;
}
`;
    },

    // ========== 继承原有代码生成器的方法 ==========
    
    // LCD映射
    generateLcdMappingHeader(lcdProject) {
        return window.CodeGenerator?.generateLcdMappingHeader(lcdProject) || '';
    },
    
    generateLcdMappingSource(lcdProject) {
        return window.CodeGenerator?.generateLcdMappingSource(lcdProject) || '';
    },
    
    // 预设
    generatePresetsHeader(presets) {
        return window.CodeGenerator?.generatePresetsHeader(presets) || '';
    },
    
    generatePresetsSourceV2(presets, components) {
        return window.CodeGenerator?.generatePresetsSource(presets, components) || '';
    },
    
    // 动画
    generateAnimationHeader(animations) {
        return window.CodeGenerator?.generateAnimationHeader(animations) || '';
    },
    
    generateAnimationSource(animations, comps) {
        return window.CodeGenerator?.generateAnimationSource(animations, comps) || '';
    },
    
    // 状态机
    generateStateMachineHeader(stateMachine) {
        return window.CodeGenerator?.generateStateMachineHeader(stateMachine) || '';
    },
    
    generateStateMachineSourceV2(stateMachine, presets, animations) {
        return window.CodeGenerator?.generateStateMachineSourceEnhanced?.(stateMachine, presets, animations) 
            || window.CodeGenerator?.generateStateMachineSource(stateMachine, presets, animations) || '';
    },
    
    // 硬件抽象层
    generateHardwareHeader() {
        return window.CodeGenerator?.generateHardwareHeader() || '';
    },
    
    // 硬件回调头文件
    generateHwCallbacksHeader(comps) {
        // 收集所有硬件回调
        const callbacks = new Set();
        
        for (const [name, comp] of Object.entries(comps)) {
            const onSet = comp.onSet || {};
            for (const [key, actions] of Object.entries(onSet)) {
                if (actions.hardware) {
                    callbacks.add(actions.hardware);
                }
            }
        }
        
        let code = `/**
 * @file    hw_callbacks.h
 * @brief   硬件回调接口 (用户实现)
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 说明: 这些函数由UI控制器在组件状态变化时调用
 *       用户需要在自己的代码中实现这些函数
 */

#ifndef HW_CALLBACKS_H
#define HW_CALLBACKS_H

#include <stdint.h>

/* ========== 硬件回调函数 ========== */
/* 用户需要实现以下函数 */

`;
        
        for (const cb of callbacks) {
            code += `void hw_${cb}(void);\n`;
        }
        
        code += `
/* ========== 通用硬件接口 ========== */

/* 蜂鸣器 */
void hw_beep(uint16_t ms);

/* 背光 */
void hw_backlight_on(void);
void hw_backlight_off(void);

#endif /* HW_CALLBACKS_H */
`;
        return code;
    },
    
    // 主循环模板
    generateMainLoopTemplate() {
        return `/**
 * @file    main_loop.c
 * @brief   主循环模板 - UI和动画联动 (参考实现)
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 说明: 这是一个参考实现，展示如何集成UI控制器和动画控制器
 */

#include "ui_controller.h"
#include "ui_animation.h"
#include "lcd_mapping.h"

/* ========== 全局变量 ========== */
static volatile uint8_t tick_10ms_flag = 0;

/* ========== 定时器中断 (1ms) ========== */
void sys_tick_1ms_handler(void) {
    static uint8_t cnt = 0;
    cnt++;
    if (cnt >= 10) {
        cnt = 0;
        tick_10ms_flag = 1;
    }
}

/* ========== 10ms tick处理 ========== */
void main_tick(void) {
    /* 1. 动画推进 */
    anim_tick(10);
    
    /* 2. LCD刷新 */
    lcd_update();
}

/* ========== 主循环 ========== */
void main_loop(void) {
    /* 初始化 */
    lcd_init();
    ui_init();
    anim_init();
    
    /* 主循环 */
    while (1) {
        /* 10ms tick */
        if (tick_10ms_flag) {
            tick_10ms_flag = 0;
            main_tick();
        }
        
        /* 其他业务逻辑 */
        // ...
    }
}

/* ========== 使用示例 ========== */
/*
void example_usage(void) {
    // 开激光 → 自动启动闪烁动画 + 硬件回调
    ui.laser.set(ICON_ON);
    
    // 关激光 → 自动停止闪烁动画 + 硬件回调
    ui.laser.set(ICON_OFF);
    
    // 设置电量 → 低电量时自动启动闪烁
    ui.battery.set(BAT_EMPTY);
    
    // 设置数字行
    ui.line4.set(12.345f, DATA_LENGTH);
    
    // 切换单位 → 自动刷新所有Line
    ui.unit.set(UNIT_FT);
}
*/
`;
    },
    
    // ========== 工具函数 ==========
    toEnumName(name) {
        return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    },
    
    toVarName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    },
    
    // ========== 代码验证 ==========
    validateGeneratedCode(codeFiles) {
        return window.CodeGenerator?.validateGeneratedCode(codeFiles) || { valid: true, errors: [], warnings: [] };
    },
    
    // ========== 代码统计 ==========
    getCodeStats(codeFiles) {
        return window.CodeGenerator?.getCodeStats(codeFiles) || { totalFiles: 0, totalLines: 0, totalBytes: 0 };
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.CodeGeneratorV2;
}
