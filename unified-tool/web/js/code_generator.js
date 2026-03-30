/**
 * @file    code_generator.js
 * @brief   UI代码生成器 - 从状态机JSON生成高质量C代码
 * @version 2.0
 * @date    2025-12-30
 * 
 * 架构层次:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Layer 4: 状态机层 (ui_state_machine.h/c)                    │
 * │   - 层级状态机(HSM)框架                                      │
 * │   - 状态转移逻辑                                             │
 * │   - 事件分发                                                 │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Layer 3: 预设/动画层 (ui_presets.h/c, ui_animation.h/c)     │
 * │   - 界面预设快照                                             │
 * │   - 动画效果引擎                                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Layer 2: 组件层 (lcd_components.h/c)                        │
 * │   - NumberDisplay, ModeSelector, LevelIndicator, Icon       │
 * │   - 高级显示API                                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Layer 1: 映射层 (lcd_mapping.h/c)                           │
 * │   - SEG:COM → 元素映射                                       │
 * │   - LCD缓冲区管理                                            │
 * ├─────────────────────────────────────────────────────────────┤
 * │ Layer 0: 硬件抽象层 (ui_hal.h) - 模板                        │
 * │   - 事件接口 (UI发送事件给固件)                               │
 * │   - 回调接口 (固件通知UI)                                     │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * 设计原则:
 * 1. UI与硬件分离 - UI只管显示，通过事件与固件通信
 * 2. 声明式配置 - JSON描述界面状态
 * 3. 层级清晰 - 每层只依赖下层
 * 4. 可测试性 - UI逻辑可独立于硬件测试
 */

window.CodeGenerator = {
    
    // ========== 版本信息 ==========
    version: '2.0.0',
    
    // ========== 配置 ==========
    config: {
        // LCD硬件配置
        segCount: 54,       // SEG数量
        comCount: 8,        // COM数量
        
        // 代码风格
        indent: '    ',     // 缩进
        prefix: 'ui_',      // 函数前缀
        
        // 输出选项
        generateComments: true,
        generateDebugLog: false,
        
        // 事件系统 (替代硬件直接控制)
        useEventSystem: true,
    },
    
    // ========== 主入口 ==========
    
    /**
     * 生成完整的C代码包
     * @param {object} projectData - 包含所有配置的项目数据
     * @returns {object} - { header: string, source: string, ... }
     */
    async generateAll(projectData) {
        const {
            lcdProject,     // project.json
            components,     // components.json
            presets,        // presets.json
            animations,     // animations.json
            stateMachine,   // stateMachine.json
        } = projectData;
        
        const result = {
            // LCD驱动层
            'lcd_mapping.h': this.generateLcdMappingHeader(lcdProject),
            'lcd_mapping.c': this.generateLcdMappingSource(lcdProject),
            
            // 组件层
            'lcd_components.h': this.generateComponentsHeader(components),
            'lcd_components.c': this.generateComponentsSource(components, lcdProject),
            
            // 状态机层
            'ui_state_machine.h': this.generateStateMachineHeader(stateMachine),
            'ui_state_machine.c': this.generateStateMachineSource(stateMachine, presets, animations),
            
            // 预设和动画
            'ui_presets.h': this.generatePresetsHeader(presets),
            'ui_presets.c': this.generatePresetsSource(presets, components),
            
            // 动画引擎
            'ui_animation.h': this.generateAnimationHeader(animations),
            'ui_animation.c': this.generateAnimationSource(animations),
        };
        
        return result;
    },
    
    // ========== LCD映射代码生成 ==========
    
    generateLcdMappingHeader(lcdProject) {
        const elements = lcdProject?.elements || [];
        
        let code = `/**
 * @file    lcd_mapping.h
 * @brief   LCD段码映射定义 (自动生成)
 * @note    由SegLCD Studio生成，请勿手动修改
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#ifndef LCD_MAPPING_H
#define LCD_MAPPING_H

#include <stdint.h>

/* LCD硬件配置 */
#define LCD_SEG_COUNT   ${this.config.segCount}
#define LCD_COM_COUNT   ${this.config.comCount}
#define LCD_BUFFER_SIZE LCD_SEG_COUNT

/* 元素ID枚举 */
typedef enum {
`;
        
        // 生成元素枚举
        elements.forEach((elem, idx) => {
            const enumName = this.toEnumName(elem.name);
            code += `    LCD_ELEM_${enumName} = ${idx},\n`;
        });
        
        code += `    LCD_ELEM_COUNT
} lcd_element_id_t;

/* 段定义结构 */
typedef struct {
    uint8_t seg;    /* SEG索引 (0-${this.config.segCount - 1}) */
    uint8_t com;    /* COM索引 (0-${this.config.comCount - 1}) */
} lcd_seg_def_t;

/* 元素定义结构 */
typedef struct {
    const char* name;           /* 元素名称 */
    uint8_t seg_count;          /* 段数量 */
    const lcd_seg_def_t* segs;  /* 段定义数组 */
} lcd_element_def_t;

/* 外部声明 */
extern const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT];
extern uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* API函数 */
void lcd_mapping_init(void);
void lcd_set_segment(uint8_t seg, uint8_t com, uint8_t on);
uint8_t lcd_get_segment(uint8_t seg, uint8_t com);
void lcd_set_element(lcd_element_id_t elem_id, uint8_t on);
void lcd_clear_all(void);
void lcd_show_all(void);
void lcd_update(void);

#endif /* LCD_MAPPING_H */
`;
        return code;
    },
    
    generateLcdMappingSource(lcdProject) {
        const elements = lcdProject?.elements || [];
        
        let code = `/**
 * @file    lcd_mapping.c
 * @brief   LCD段码映射实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "lcd_mapping.h"
#include "drv_seg_lcd.h"  /* 底层LCD驱动 */

/* LCD缓冲区 */
uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* COM位映射: COM0=bit7, COM7=bit0 */
static const uint8_t com_bit_map[8] = {7, 6, 5, 4, 3, 2, 1, 0};

`;
        
        // 生成每个元素的段定义数组
        elements.forEach(elem => {
            const varName = this.toVarName(elem.name);
            const segs = elem.segments || [];
            
            code += `/* ${elem.name} 段定义 */\n`;
            code += `static const lcd_seg_def_t ${varName}_segs[] = {\n`;
            
            segs.forEach(seg => {
                if (seg.seg !== '' && seg.com !== '') {
                    code += `    { ${seg.seg}, ${seg.com} },  /* ${seg.name} */\n`;
                }
            });
            
            code += `};\n\n`;
        });
        
        // 生成元素定义表
        code += `/* 元素定义表 */\n`;
        code += `const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT] = {\n`;
        
        elements.forEach(elem => {
            const enumName = this.toEnumName(elem.name);
            const varName = this.toVarName(elem.name);
            const segs = (elem.segments || []).filter(s => s.seg !== '' && s.com !== '');
            
            code += `    [LCD_ELEM_${enumName}] = { "${elem.name}", ${segs.length}, ${varName}_segs },\n`;
        });
        
        code += `};

/* 初始化 */
void lcd_mapping_init(void) {
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

/* 获取段状态 */
uint8_t lcd_get_segment(uint8_t seg, uint8_t com) {
    if (seg >= LCD_SEG_COUNT || com >= LCD_COM_COUNT) return 0;
    
    uint8_t bit = com_bit_map[com];
    return (lcd_buffer[seg] & (1 << bit)) ? 1 : 0;
}

/* 设置元素 (点亮/熄灭所有段) */
void lcd_set_element(lcd_element_id_t elem_id, uint8_t on) {
    if (elem_id >= LCD_ELEM_COUNT) return;
    
    const lcd_element_def_t* elem = &lcd_elements[elem_id];
    for (uint8_t i = 0; i < elem->seg_count; i++) {
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
    /* 调用底层驱动写入LCD */
    seg_lcd_write_buffer(lcd_buffer, LCD_BUFFER_SIZE);
}
`;
        return code;
    },
    
    // ========== 组件代码生成 ==========
    
    generateComponentsHeader(components) {
        const comps = components?.components || {};
        
        let code = `/**
 * @file    lcd_components.h
 * @brief   LCD组件定义 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#ifndef LCD_COMPONENTS_H
#define LCD_COMPONENTS_H

#include <stdint.h>
#include "lcd_mapping.h"

/* 七段数码管字形表 */
extern const uint8_t digit_patterns[128];

/* 组件类型 */
typedef enum {
    COMP_TYPE_NUMBER_DISPLAY,
    COMP_TYPE_MODE_SELECTOR,
    COMP_TYPE_LEVEL_INDICATOR,
    COMP_TYPE_ICON,
} lcd_comp_type_t;

`;
        
        // 生成组件ID枚举
        code += `/* 组件ID枚举 */\ntypedef enum {\n`;
        Object.keys(comps).forEach((name, idx) => {
            code += `    COMP_${this.toEnumName(name)} = ${idx},\n`;
        });
        code += `    COMP_COUNT\n} lcd_comp_id_t;\n\n`;
        
        // 生成API声明
        code += `/* 组件API */
void lcd_comp_init(void);
void lcd_comp_set_value(lcd_comp_id_t comp, const char* value);
void lcd_comp_set_number(lcd_comp_id_t comp, float value, uint8_t decimals);
void lcd_comp_set_mode(lcd_comp_id_t comp, uint8_t mode);
void lcd_comp_set_level(lcd_comp_id_t comp, uint8_t level);
void lcd_comp_set_visible(lcd_comp_id_t comp, uint8_t visible);
void lcd_comp_show_preset(lcd_comp_id_t comp, const char* preset);

#endif /* LCD_COMPONENTS_H */
`;
        return code;
    },
    
    generateComponentsSource(components, lcdProject) {
        const comps = components?.components || {};
        const elements = lcdProject?.elements || [];
        
        // 创建元素名到ID的映射
        const elemMap = {};
        elements.forEach((elem, idx) => {
            elemMap[elem.name] = idx;
        });
        
        let code = `/**
 * @file    lcd_components.c
 * @brief   LCD组件实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "lcd_components.h"
#include <string.h>

/* 七段数码管字形表 (A-G段, bit0=A, bit6=G) */
const uint8_t digit_patterns[128] = {
    ['0'] = 0x3F, ['1'] = 0x06, ['2'] = 0x5B, ['3'] = 0x4F, ['4'] = 0x66,
    ['5'] = 0x6D, ['6'] = 0x7D, ['7'] = 0x07, ['8'] = 0x7F, ['9'] = 0x6F,
    ['A'] = 0x77, ['B'] = 0x7C, ['C'] = 0x39, ['D'] = 0x5E, ['E'] = 0x79,
    ['F'] = 0x71, ['-'] = 0x40, ['_'] = 0x08, [' '] = 0x00, ['.'] = 0x80,
    ['r'] = 0x50, ['n'] = 0x54, ['u'] = 0x1C, ['L'] = 0x38, ['H'] = 0x76,
};

/* 组件状态 */
static struct {
    char value[16];
    uint8_t mode;
    uint8_t level;
    uint8_t visible;
} comp_states[COMP_COUNT];

`;
        
        // 为每个NumberDisplay组件生成数位元素数组
        for (const [name, comp] of Object.entries(comps)) {
            if (comp.type === 'NumberDisplay' && comp.config?.digits) {
                const varName = this.toVarName(name);
                code += `/* ${name} 数位元素 */\n`;
                code += `static const lcd_element_id_t ${varName}_digits[] = {\n`;
                comp.config.digits.forEach(d => {
                    const elemId = elemMap[d.element];
                    if (elemId !== undefined) {
                        code += `    LCD_ELEM_${this.toEnumName(d.element)},\n`;
                    }
                });
                code += `};\n\n`;
            }
        }
        
        code += `/* 初始化 */
void lcd_comp_init(void) {
    memset(comp_states, 0, sizeof(comp_states));
    for (int i = 0; i < COMP_COUNT; i++) {
        comp_states[i].visible = 1;
    }
}

/* 设置字符串值 */
void lcd_comp_set_value(lcd_comp_id_t comp, const char* value) {
    if (comp >= COMP_COUNT) return;
    strncpy(comp_states[comp].value, value, sizeof(comp_states[comp].value) - 1);
    /* TODO: 根据组件类型渲染 */
}

/* 设置数字值 */
void lcd_comp_set_number(lcd_comp_id_t comp, float value, uint8_t decimals) {
    if (comp >= COMP_COUNT) return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%.*f", decimals, value);
    lcd_comp_set_value(comp, buf);
}

/* 设置模式 */
void lcd_comp_set_mode(lcd_comp_id_t comp, uint8_t mode) {
    if (comp >= COMP_COUNT) return;
    comp_states[comp].mode = mode;
    /* TODO: 根据组件类型切换显示 */
}

/* 设置等级 */
void lcd_comp_set_level(lcd_comp_id_t comp, uint8_t level) {
    if (comp >= COMP_COUNT) return;
    comp_states[comp].level = level;
    /* TODO: 根据组件类型显示等级 */
}

/* 设置可见性 */
void lcd_comp_set_visible(lcd_comp_id_t comp, uint8_t visible) {
    if (comp >= COMP_COUNT) return;
    comp_states[comp].visible = visible;
    /* TODO: 显示/隐藏组件 */
}

/* 显示预设值 */
void lcd_comp_show_preset(lcd_comp_id_t comp, const char* preset) {
    lcd_comp_set_value(comp, preset);
}
`;
        return code;
    },

    // ========== 状态机代码生成 ==========
    
    generateStateMachineHeader(stateMachine) {
        const hierarchy = stateMachine?.hierarchy || {};
        
        // 收集所有状态
        const states = this.collectStates(hierarchy);
        
        let code = `/**
 * @file    ui_state_machine.h
 * @brief   UI状态机定义 (自动生成)
 * @note    层级状态机(HSM)架构，UI与硬件分离
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 架构说明:
 * - UI层只处理显示逻辑和状态转移
 * - 通过 ui_emit_event() 发送请求给固件
 * - 固件通过 ui_hsm_dispatch() 发送事件给UI
 */

#ifndef UI_STATE_MACHINE_H
#define UI_STATE_MACHINE_H

#include <stdint.h>
#include "ui_hal.h"  /* 事件接口 */

/* 状态ID枚举 */
typedef enum {
`;
        
        states.forEach((state, idx) => {
            code += `    UI_STATE_${this.toEnumName(state.id)} = ${idx},\n`;
        });
        
        code += `    UI_STATE_COUNT
} ui_state_id_t;

/* 输入事件类型 (固件 → UI) */
typedef enum {
    UI_EVT_ENTRY,           /* 进入状态 (内部) */
    UI_EVT_EXIT,            /* 退出状态 (内部) */
    UI_EVT_INIT,            /* 初始化 (内部) */
    
    /* 按键事件 (来自按键驱动) */
    UI_EVT_K1_SHORT,        /* K1短按 */
    UI_EVT_K2_SHORT,        /* K2短按 */
    UI_EVT_K3_SHORT,        /* K3短按 */
    UI_EVT_K1_LONG,         /* K1长按 */
    UI_EVT_K2_LONG,         /* K2长按 */
    UI_EVT_K3_LONG,         /* K3长按 */
    UI_EVT_K1_XLONG,        /* K1超长按 */
    UI_EVT_K3_XLONG,        /* K3超长按 */
    UI_EVT_K1_RELEASE,      /* K1松开 */
    UI_EVT_K1K2_COMBO,      /* K1+K2组合 */
    
    /* 超时事件 (来自定时器) */
    UI_EVT_TIMEOUT,         /* 通用超时 */
    UI_EVT_TIMEOUT_1S,      /* 1秒超时 */
    UI_EVT_TIMEOUT_LASER,   /* 激光超时 */
    UI_EVT_TIMEOUT_BACKLIGHT, /* 背光超时 */
    UI_EVT_TIMEOUT_POWER,   /* 关机超时 */
    
    /* 测量事件 (来自测距模块) */
    UI_EVT_MEASURE_OK,      /* 测量成功 */
    UI_EVT_MEASURE_FAIL,    /* 测量失败 */
    UI_EVT_MEASURE_ERR,     /* 测量错误 */
    
    /* 系统事件 */
    UI_EVT_BATTERY_LOW,     /* 低电量 */
    UI_EVT_CHARGING,        /* 充电中 */
    UI_EVT_BT_CONNECTED,    /* 蓝牙连接 */
    UI_EVT_BT_DISCONNECTED, /* 蓝牙断开 */
    
    UI_EVT_COUNT,           /* 事件数量 */
} ui_event_type_t;

/* 事件结构 */
typedef struct {
    ui_event_type_t type;
    uint8_t key_id;         /* 按键ID (K1=1, K2=2, K3=3) */
    uint16_t param;         /* 附加参数 */
} ui_event_t;

/* 状态机上下文 */
typedef struct {
    ui_state_id_t current_state;
    ui_state_id_t target_state;
    uint32_t state_enter_tick;
    uint8_t transition_pending;
} ui_hsm_t;

/* API函数 */
void ui_hsm_init(ui_hsm_t* hsm);
void ui_hsm_dispatch(ui_hsm_t* hsm, const ui_event_t* evt);
ui_state_id_t ui_hsm_get_state(const ui_hsm_t* hsm);
const char* ui_hsm_get_state_name(ui_state_id_t state);

/* 全局状态机实例 */
extern ui_hsm_t g_ui_hsm;

#endif /* UI_STATE_MACHINE_H */
`;
        return code;
    },
    
    generateStateMachineSource(stateMachine, presets, animations) {
        const hierarchy = stateMachine?.hierarchy || {};
        const transitions = stateMachine?.transitions || [];
        const states = this.collectStates(hierarchy);
        
        let code = `/**
 * @file    ui_state_machine.c
 * @brief   UI状态机实现 (自动生成)
 * @note    UI与硬件分离，通过事件接口通信
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "ui_state_machine.h"
#include "ui_presets.h"
#include "ui_animation.h"
#include "lcd_components.h"
#include "lcd_mapping.h"

/* 全局状态机实例 */
ui_hsm_t g_ui_hsm;

/* 状态名称表 */
static const char* state_names[UI_STATE_COUNT] = {
`;
        
        states.forEach(state => {
            code += `    [UI_STATE_${this.toEnumName(state.id)}] = "${state.label || state.id}",\n`;
        });
        
        code += `};

/* 状态处理函数声明 */
`;
        
        // 声明每个状态的处理函数
        states.forEach(state => {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt);\n`;
        });
        
        code += `
/* 状态处理函数表 */
typedef void (*state_handler_t)(ui_hsm_t* hsm, const ui_event_t* evt);
static const state_handler_t state_handlers[UI_STATE_COUNT] = {
`;
        
        states.forEach(state => {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `    [UI_STATE_${this.toEnumName(state.id)}] = ${funcName},\n`;
        });
        
        code += `};

/* 初始化 */
void ui_hsm_init(ui_hsm_t* hsm) {
    hsm->current_state = UI_STATE_${this.toEnumName(states[0]?.id || 'ROOT')};
    hsm->target_state = hsm->current_state;
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

`;
        
        // 生成每个状态的处理函数
        states.forEach(state => {
            code += this.generateStateHandler(state, transitions, presets, animations);
        });
        
        return code;
    },
    
    generateStateHandler(state, transitions, presets, animations) {
        const funcName = `state_${this.toVarName(state.id)}`;
        const stateEnum = `UI_STATE_${this.toEnumName(state.id)}`;
        
        // 找到从这个状态出发的转移
        const outTransitions = transitions.filter(t => t.from === state.id);
        
        let code = `
/* ${state.label || state.id} 状态处理 */
static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
`;
        
        // 入口动作
        if (state.entryActions?.length) {
            state.entryActions.forEach(action => {
                code += this.generateActionCode(action, presets, animations);
            });
        }
        
        code += `        break;
        
    case UI_EVT_EXIT:
`;
        
        // 退出动作
        if (state.exitActions?.length) {
            state.exitActions.forEach(action => {
                code += this.generateActionCode(action, presets, animations);
            });
        }
        
        code += `        break;
`;
        
        // 处理转移
        outTransitions.forEach(trans => {
            const eventType = this.eventToEnum(trans.event);
            const targetEnum = `UI_STATE_${this.toEnumName(trans.to)}`;
            
            code += `
    case ${eventType}:
`;
            
            // 转移动作
            if (trans.actions?.length) {
                trans.actions.forEach(action => {
                    code += this.generateActionCode(action, presets, animations);
                });
            }
            
            code += `        TRAN(${targetEnum});
        break;
`;
        });
        
        code += `
    default:
        break;
    }
}
`;
        return code;
    },
    
    generateActionCode(actionId, presets, animations) {
        let code = '';
        
        // 界面预设
        if (actionId.startsWith('preset:')) {
            const presetId = actionId.split(':')[1];
            code += `        ui_apply_preset(PRESET_${this.toEnumName(presetId)});\n`;
        }
        // 动画控制
        else if (actionId.startsWith('anim:')) {
            const parts = actionId.split(':');
            const animId = parts[1];
            const animAction = parts[2];
            if (animAction === 'start') {
                code += `        ui_anim_start(ANIM_${this.toEnumName(animId)});\n`;
            } else {
                code += `        ui_anim_stop(ANIM_${this.toEnumName(animId)});\n`;
            }
        }
        // 事件发射 (emit:eventName) - UI通知固件
        else if (actionId.startsWith('emit:')) {
            const eventName = actionId.split(':')[1];
            // 转换事件名称: laserOn -> LASER_ON, measureStart -> MEASURE_START
            const eventEnum = `UI_EMIT_${this.toEnumName(eventName.replace(/([A-Z])/g, '_$1').toUpperCase())}`;
            code += `        ui_emit_event(${eventEnum});\n`;
        }
        // 变量设置 (set:var = value)
        else if (actionId.startsWith('set:')) {
            const expr = actionId.substring(4).trim();
            // 解析 var = value 格式
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let value = match[2].trim();
                // 转换 true/false 为 1/0
                if (value === 'true') value = '1';
                else if (value === 'false') value = '0';
                code += `        g_ui_vars.${varName} = ${value};\n`;
            } else {
                code += `        /* set: ${expr} */\n`;
            }
        }
        // 变量递增 (inc:var)
        else if (actionId.startsWith('inc:')) {
            const varName = actionId.substring(4).trim();
            code += `        g_ui_vars.${varName}++;\n`;
        }
        // 变量递减 (dec:var)
        else if (actionId.startsWith('dec:')) {
            const varName = actionId.substring(4).trim();
            code += `        g_ui_vars.${varName}--;\n`;
        }
        // 计算表达式 (calc:var = expr)
        else if (actionId.startsWith('calc:')) {
            const expr = actionId.substring(5).trim();
            const match = expr.match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let calcExpr = match[2].trim();
                // 转换数学函数
                calcExpr = calcExpr.replace(/sqrt\(/g, 'sqrtf(');
                // a^2 -> (a*a) - 先标记变量，再替换
                calcExpr = calcExpr.replace(/(\w+)\^2/g, '(__VAR_$1__*__VAR_$1__)');
                // 替换变量名为g_ui_vars.xxx
                calcExpr = calcExpr.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (m) => {
                    if (['sqrtf', 'sinf', 'cosf', 'fabsf', 'fabs'].includes(m)) return m;
                    return `g_ui_vars.${m}`;
                });
                // 还原标记的变量
                calcExpr = calcExpr.replace(/__VAR_(\w+)__/g, 'g_ui_vars.$1');
                code += `        g_ui_vars.${varName} = ${calcExpr};\n`;
            }
        }
        // 组件API
        else if (actionId.startsWith('comp:')) {
            const parts = actionId.split(':');
            const action = parts[1];
            const component = parts[2];
            const param = parts[3];
            
            const compEnum = `COMP_${this.toEnumName(component)}`;
            
            switch (action) {
                case 'setValue':
                    code += `        lcd_comp_set_value(${compEnum}, "${param || ''}");\n`;
                    break;
                case 'setMode':
                    code += `        lcd_comp_set_mode(${compEnum}, ${param || 0});\n`;
                    break;
                case 'setLevel':
                    code += `        lcd_comp_set_level(${compEnum}, ${param || 0});\n`;
                    break;
                case 'setVisible':
                    code += `        lcd_comp_set_visible(${compEnum}, ${param === 'true' ? 1 : 0});\n`;
                    break;
                case 'showPreset':
                    code += `        lcd_comp_show_preset(${compEnum}, "${param}");\n`;
                    break;
            }
        }
        // LCD控制
        else if (actionId.startsWith('lcd:')) {
            const action = actionId.split(':')[1];
            if (action === 'showAll') {
                code += `        lcd_show_all();\n`;
            } else if (action === 'clearAll') {
                code += `        lcd_clear_all();\n`;
            }
        }
        // 条件动作 (if:condition then action)
        else if (actionId.startsWith('if:')) {
            const match = actionId.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                let condition = match[1].trim();
                const thenAction = match[2].trim();
                // 替换变量名
                condition = condition.replace(/\b([a-z_]\w*)\b/gi, (m) => {
                    if (['true', 'false', 'null'].includes(m)) return m;
                    return `ui_var_${m}`;
                });
                code += `        if (${condition}) {\n`;
                code += '    ' + this.generateActionCode(thenAction, presets, animations);
                code += `        }\n`;
            }
        }
        // 普通动作
        else {
            code += `        /* TODO: ${actionId} */\n`;
        }
        
        return code;
    },
    
    // ========== 预设代码生成 ==========
    
    generatePresetsHeader(presets) {
        const presetList = presets?.presets || {};
        
        let code = `/**
 * @file    ui_presets.h
 * @brief   界面预设定义 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#ifndef UI_PRESETS_H
#define UI_PRESETS_H

#include <stdint.h>

/* 预设ID枚举 */
typedef enum {
`;
        
        Object.keys(presetList).forEach((name, idx) => {
            code += `    PRESET_${this.toEnumName(name)} = ${idx},\n`;
        });
        
        code += `    PRESET_COUNT
} ui_preset_id_t;

/* API函数 */
void ui_apply_preset(ui_preset_id_t preset_id);

#endif /* UI_PRESETS_H */
`;
        return code;
    },
    
    generatePresetsSource(presets, components) {
        const presetList = presets?.presets || {};
        
        let code = `/**
 * @file    ui_presets.c
 * @brief   界面预设实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "ui_presets.h"
#include "lcd_components.h"
#include "lcd_mapping.h"
#include "ui_animation.h"

/* 应用预设 */
void ui_apply_preset(ui_preset_id_t preset_id) {
    switch (preset_id) {
`;
        
        for (const [name, preset] of Object.entries(presetList)) {
            code += `    case PRESET_${this.toEnumName(name)}:\n`;
            code += `        /* ${preset.name || name}: ${preset.description || ''} */\n`;
            
            // 组件设置
            if (preset.components) {
                for (const [compId, config] of Object.entries(preset.components)) {
                    const compEnum = `COMP_${this.toEnumName(compId)}`;
                    if (config.preset) {
                        code += `        lcd_comp_show_preset(${compEnum}, "${config.preset}");\n`;
                    } else if (config.value !== undefined) {
                        code += `        lcd_comp_set_value(${compEnum}, "${config.value}");\n`;
                    } else if (config.mode !== undefined) {
                        code += `        lcd_comp_set_mode(${compEnum}, ${config.mode});\n`;
                    } else if (config.level !== undefined) {
                        code += `        lcd_comp_set_level(${compEnum}, ${config.level});\n`;
                    }
                }
            }
            
            // 图标设置
            if (preset.icons) {
                for (const [iconId, visible] of Object.entries(preset.icons)) {
                    code += `        lcd_set_element(LCD_ELEM_${this.toEnumName(iconId)}, ${visible ? 1 : 0});\n`;
                }
            }
            
            // 启动动画
            if (preset.behaviors) {
                preset.behaviors.forEach(behaviorId => {
                    code += `        ui_anim_start(ANIM_${this.toEnumName(behaviorId)});\n`;
                });
            }
            
            code += `        break;\n\n`;
        }
        
        code += `    default:
        break;
    }
    
    lcd_update();
}
`;
        return code;
    },
    
    // ========== 动画代码生成 ==========
    
    generateAnimationHeader(animations) {
        const animList = animations?.animations || {};
        
        let code = `/**
 * @file    ui_animation.h
 * @brief   动画控制器 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 功能：
 * - 多个动画同时运行
 * - 运行时参数覆盖（间隔、超时）
 * - 循环/非循环（自动停止）
 */

#ifndef UI_ANIMATION_H
#define UI_ANIMATION_H

#include <stdint.h>

/* 动画ID枚举 */
typedef enum {
`;
        
        Object.keys(animList).forEach((name, idx) => {
            code += `    ANIM_${this.toEnumName(name)} = ${idx},\n`;
        });
        
        code += `    ANIM_COUNT
} anim_id_e;

/* ========== 基础API ========== */

/* 初始化动画控制器 */
void anim_init(void);

/* 定时器调用 (建议10ms间隔) */
void anim_tick(uint16_t ms);

/* 启动动画（用配置的默认参数）*/
void anim_start(anim_id_e id);

/* 停止动画 */
void anim_stop(anim_id_e id);

/* 停止所有动画 */
void anim_stop_all(void);

/* 检查是否运行中 */
uint8_t anim_is_running(anim_id_e id);

/* ========== 扩展API（运行时参数）========== */

/**
 * 启动动画，可覆盖间隔和超时
 * @param id          动画ID
 * @param interval_ms 帧间隔(ms)，0=用配置值
 * @param timeout_ms  超时自动停止(ms)，0=不超时
 */
void anim_start_ex(anim_id_e id, uint16_t interval_ms, uint16_t timeout_ms);

/* 修改运行中动画的间隔 */
void anim_set_interval(anim_id_e id, uint16_t interval_ms);

/* 修改运行中动画的超时 */
void anim_set_timeout(anim_id_e id, uint16_t timeout_ms);

#endif /* UI_ANIMATION_H */
`;
        return code;
    },
    
    generateAnimationSource(animations) {
        const animList = animations?.animations || {};
        
        let code = `/**
 * @file    ui_animation.c
 * @brief   动画控制器实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "ui_animation.h"
#include "ui_controller.h"
#include <string.h>

/* ========== 帧数据结构 ========== */
typedef struct {
    uint16_t duration;      /* 持续时间(ms) */
    void (*apply)(void);    /* 帧动作函数 */
} anim_frame_t;

/* ========== 动画配置 ========== */
typedef struct {
    const anim_frame_t* frames;
    uint8_t frame_count;
    uint8_t loop;           /* 1=循环, 0=播放一次自动停止 */
} anim_config_t;

/* ========== 动画状态 ========== */
typedef struct {
    uint8_t running;        /* 是否运行 */
    uint8_t frame_idx;      /* 当前帧索引 */
    uint16_t tick_count;    /* 帧计时器(ms) */
    uint16_t interval_ms;   /* 运行时间隔（0=用配置值）*/
    uint16_t timeout_ms;    /* 超时时间（0=不超时）*/
    uint32_t total_time;    /* 已运行总时间(ms) */
} anim_state_t;

/* ========== 动画控制器 ========== */
static anim_state_t anim_states[ANIM_COUNT];

`;
        
        // 生成每个动画的帧函数和帧数组
        for (const [name, animDef] of Object.entries(animList)) {
            const varName = this.toVarName(name);
            const frames = animDef.frames || [];
            
            if (frames.length === 0) continue;
            
            // 生成帧函数
            frames.forEach((frame, idx) => {
                code += `static void ${varName}_frame${idx}(void) {\n`;
                
                // 处理组件状态
                if (frame.components) {
                    for (const [compName, state] of Object.entries(frame.components)) {
                        const compVar = this.toVarName(compName);
                        if (state.visible !== undefined) {
                            code += `    ui.${compVar}.set(${state.visible ? 'ICON_ON' : 'ICON_OFF'});\n`;
                        } else if (state.value !== undefined) {
                            code += `    ui.${compVar}.set(${state.value});\n`;
                        } else if (state.preset) {
                            const presetMap = { dash: 'LINE_DASH', blank: '""', error: 'LINE_ERR' };
                            code += `    ui.${compVar}.set_str(${presetMap[state.preset] || '""'});\n`;
                        }
                    }
                }
                
                // 处理特殊动作
                if (frame.action) {
                    if (frame.action === 'lcd:showAll') {
                        code += `    lcd_show_all();\n`;
                    } else if (frame.action === 'lcd:clearAll') {
                        code += `    lcd_clear_all();\n`;
                    }
                }
                
                code += `}\n\n`;
            });
            
            // 生成帧数组
            code += `static const anim_frame_t ${varName}_frames[] = {\n`;
            frames.forEach((frame, idx) => {
                const duration = frame.duration || 200;
                code += `    { ${duration}, ${varName}_frame${idx} },\n`;
            });
            code += `};\n\n`;
        }
        
        // 生成动画配置表
        code += `/* ========== 动画配置表 ========== */\nstatic const anim_config_t anim_configs[ANIM_COUNT] = {\n`;
        
        for (const [name, animDef] of Object.entries(animList)) {
            const varName = this.toVarName(name);
            const frames = animDef.frames || [];
            const loop = animDef.loop !== false ? 1 : 0;
            
            if (frames.length > 0) {
                code += `    [ANIM_${this.toEnumName(name)}] = { ${varName}_frames, ${frames.length}, ${loop} },\n`;
            } else {
                code += `    [ANIM_${this.toEnumName(name)}] = { NULL, 0, 0 },\n`;
            }
        }
        
        code += `};

/* ========== 初始化 ========== */
void anim_init(void) {
    memset(anim_states, 0, sizeof(anim_states));
}

/* ========== 启动动画（默认参数）========== */
void anim_start(anim_id_e id) {
    anim_start_ex(id, 0, 0);
}

/* ========== 启动动画（扩展参数）========== */
void anim_start_ex(anim_id_e id, uint16_t interval_ms, uint16_t timeout_ms) {
    if (id >= ANIM_COUNT) return;
    
    anim_state_t* s = &anim_states[id];
    s->running = 1;
    s->frame_idx = 0;
    s->tick_count = 0;
    s->interval_ms = interval_ms;
    s->timeout_ms = timeout_ms;
    s->total_time = 0;
    
    /* 立即执行第一帧 */
    const anim_config_t* cfg = &anim_configs[id];
    if (cfg->frames && cfg->frame_count > 0) {
        cfg->frames[0].apply();
    }
}

/* ========== 停止动画 ========== */
void anim_stop(anim_id_e id) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].running = 0;
}

/* ========== 停止所有动画 ========== */
void anim_stop_all(void) {
    for (int i = 0; i < ANIM_COUNT; i++) {
        anim_states[i].running = 0;
    }
}

/* ========== 检查是否运行中 ========== */
uint8_t anim_is_running(anim_id_e id) {
    if (id >= ANIM_COUNT) return 0;
    return anim_states[id].running;
}

/* ========== 修改间隔 ========== */
void anim_set_interval(anim_id_e id, uint16_t interval_ms) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].interval_ms = interval_ms;
}

/* ========== 修改超时 ========== */
void anim_set_timeout(anim_id_e id, uint16_t timeout_ms) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].timeout_ms = timeout_ms;
}

/* ========== 定时器调用 ========== */
void anim_tick(uint16_t ms) {
    for (int i = 0; i < ANIM_COUNT; i++) {
        anim_state_t* s = &anim_states[i];
        if (!s->running) continue;
        
        const anim_config_t* cfg = &anim_configs[i];
        if (!cfg->frames || cfg->frame_count == 0) continue;
        
        /* 更新总时间 */
        s->total_time += ms;
        
        /* 检查超时 */
        if (s->timeout_ms > 0 && s->total_time >= s->timeout_ms) {
            s->running = 0;
            continue;
        }
        
        /* 更新帧计时 */
        s->tick_count += ms;
        
        /* 获取当前帧间隔（运行时参数优先）*/
        uint16_t duration;
        if (s->interval_ms > 0) {
            duration = s->interval_ms;
        } else {
            duration = cfg->frames[s->frame_idx].duration;
        }
        
        if (s->tick_count >= duration) {
            s->tick_count = 0;
            s->frame_idx++;
            
            /* 检查是否播放完 */
            if (s->frame_idx >= cfg->frame_count) {
                if (cfg->loop) {
                    s->frame_idx = 0;
                } else {
                    /* 非循环动画，自动停止 */
                    s->running = 0;
                    continue;
                }
            }
            
            /* 执行帧动作 */
            cfg->frames[s->frame_idx].apply();
        }
    }
}
`;
        return code;
    },
    
    // ========== 工具函数 ==========
    
    collectStates(hierarchy, states = []) {
        const root = hierarchy.ROOT || hierarchy;
        
        const traverse = (node) => {
            states.push(node);
            if (node.children) {
                for (const child of Object.values(node.children)) {
                    traverse(child);
                }
            }
        };
        
        traverse(root);
        return states;
    },
    
    toEnumName(name) {
        return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    },
    
    toVarName(name) {
        return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    },
    
    eventToEnum(eventName) {
        // 每个事件都有唯一的枚举值
        const mapping = {
            'K1_SHORT': 'UI_EVT_K1_SHORT',
            'K2_SHORT': 'UI_EVT_K2_SHORT',
            'K3_SHORT': 'UI_EVT_K3_SHORT',
            'K1_LONG': 'UI_EVT_K1_LONG',
            'K2_LONG': 'UI_EVT_K2_LONG',
            'K3_LONG': 'UI_EVT_K3_LONG',
            'K1_XLONG': 'UI_EVT_K1_XLONG',
            'K3_XLONG': 'UI_EVT_K3_XLONG',
            'K1_RELEASE': 'UI_EVT_K1_RELEASE',
            'K1K2_COMBO': 'UI_EVT_K1K2_COMBO',
            'TIMEOUT': 'UI_EVT_TIMEOUT',
            'TIMEOUT_1S': 'UI_EVT_TIMEOUT_1S',
            'TIMEOUT_LASER': 'UI_EVT_TIMEOUT_LASER',
            'TIMEOUT_BACKLIGHT': 'UI_EVT_TIMEOUT_BACKLIGHT',
            'TIMEOUT_POWER': 'UI_EVT_TIMEOUT_POWER',
            'MEASURE_OK': 'UI_EVT_MEASURE_OK',
            'MEASURE_FAIL': 'UI_EVT_MEASURE_FAIL',
            'MEASURE_ERR': 'UI_EVT_MEASURE_ERR',
        };
        return mapping[eventName] || `UI_EVT_${this.toEnumName(eventName)}`;
    },
    
    // ========== 变量系统代码生成 ==========
    
    /**
     * 生成变量声明头文件
     */
    generateVariablesHeader(variables) {
        if (!variables || Object.keys(variables).length === 0) {
            return '';
        }
        
        let code = `/**
 * @file    ui_variables.h
 * @brief   UI状态机变量定义 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#ifndef UI_VARIABLES_H
#define UI_VARIABLES_H

#include <stdint.h>

/* 变量结构体 */
typedef struct {
`;
        
        for (const [name, def] of Object.entries(variables)) {
            const cType = this.toCType(def.type);
            code += `    ${cType} ${name};  /* ${def.description || ''} */\n`;
        }
        
        // 添加运行时标志
        code += `    /* 运行时标志 */
    uint8_t K1_HELD;  /* K1按键保持标志 */
`;
        
        code += `} ui_vars_t;

/* 全局变量实例 */
extern ui_vars_t g_ui_vars;

/* API函数 */
void ui_vars_init(void);
void ui_vars_reset(void);

/* 历史数据滚动 */
void ui_vars_scroll_history(void);

#endif /* UI_VARIABLES_H */
`;
        return code;
    },
    
    /**
     * 生成变量实现源文件
     */
    generateVariablesSource(variables) {
        if (!variables || Object.keys(variables).length === 0) {
            return '';
        }
        
        let code = `/**
 * @file    ui_variables.c
 * @brief   UI状态机变量实现 (自动生成)
 * @date    ${new Date().toISOString().split('T')[0]}
 */

#include "ui_variables.h"

/* 全局变量实例 */
ui_vars_t g_ui_vars;

/* 初始化 */
void ui_vars_init(void) {
`;
        
        for (const [name, def] of Object.entries(variables)) {
            const defaultVal = this.toDefaultValue(def.type, def.default);
            code += `    g_ui_vars.${name} = ${defaultVal};\n`;
        }
        
        code += `}

/* 重置 */
void ui_vars_reset(void) {
    ui_vars_init();
}

/* 历史数据滚动: line1 ← line2 ← line3 ← line4 */
void ui_vars_scroll_history(void) {
    g_ui_vars.line1_data = g_ui_vars.line2_data;
    g_ui_vars.line2_data = g_ui_vars.line3_data;
    g_ui_vars.line3_data = g_ui_vars.line4_data;
}
`;
        return code;
    },
    
    /**
     * 转换类型到C类型
     */
    toCType(type) {
        const mapping = {
            'int': 'int16_t',
            'float': 'float',
            'bool': 'uint8_t',
            'uint8': 'uint8_t',
            'uint16': 'uint16_t',
            'uint32': 'uint32_t',
        };
        return mapping[type] || 'int16_t';
    },
    
    /**
     * 转换默认值
     */
    toDefaultValue(type, value) {
        if (type === 'float') {
            const num = parseFloat(value) || 0;
            return `${num.toFixed(1)}f`;  // 0.0f 而不是 0f
        } else if (type === 'bool') {
            return value ? '1' : '0';
        }
        return String(value || 0);
    },
    
    // ========== Guard条件代码生成 ==========
    
    /**
     * 生成Guard条件代码
     */
    generateGuardCode(guard) {
        if (!guard) return null;
        
        let code = guard;
        // a^2 -> (a*a) - 先标记变量，再替换
        code = code.replace(/(\w+)\^2/g, '(__VAR_$1__*__VAR_$1__)');
        // 替换所有可能的变量名为结构体访问
        const varNames = [
            'runstep', 'last_step', 'line1_data', 'line2_data', 'line3_data', 'line4_data',
            'max_data', 'min_data', 'laser_on', 'continuous_flag', 'error_code', 'distance',
            'measure_mode', 'unit', 'base_back', 'backlight_on', 'beep_enable', 'idle_time',
            'K1_HELD'  // 特殊标志
        ];
        varNames.forEach(v => {
            const regex = new RegExp(`\\b${v}\\b`, 'g');
            code = code.replace(regex, `g_ui_vars.${v}`);
        });
        // 还原标记的变量
        code = code.replace(/__VAR_(\w+)__/g, 'g_ui_vars.$1');
        // 转换数学函数
        code = code.replace(/sqrt\(/g, 'sqrtf(');
        
        return code;
    },
    
    /**
     * 生成带Guard的转移代码
     */
    generateGuardedTransition(trans, presets, animations) {
        const targetEnum = `UI_STATE_${this.toEnumName(trans.to)}`;
        let code = '';
        
        if (trans.guard) {
            const guardCode = this.generateGuardCode(trans.guard);
            code += `        if (${guardCode}) {\n`;
            
            // 转移动作
            if (trans.actions?.length) {
                trans.actions.forEach(action => {
                    code += '    ' + this.generateActionCode(action, presets, animations);
                });
            }
            
            code += `            TRAN(${targetEnum});\n`;
            code += `        }\n`;
        } else {
            // 无Guard条件
            if (trans.actions?.length) {
                trans.actions.forEach(action => {
                    code += this.generateActionCode(action, presets, animations);
                });
            }
            code += `        TRAN(${targetEnum});\n`;
        }
        
        return code;
    },
    
    // ========== 增强的动作代码生成 ==========
    
    /**
     * 生成增强的动作代码 (支持变量操作)
     */
    generateEnhancedActionCode(actionId, presets, animations) {
        let code = '';
        
        // 变量设置: set:varname = value
        if (actionId.startsWith('set:')) {
            const expr = actionId.substring(4);
            const parts = expr.split('=').map(s => s.trim());
            const varName = parts[0];
            let value = parts[1] || '0';
            // 转换 true/false 为 1/0
            if (value === 'true') value = '1';
            else if (value === 'false') value = '0';
            // 如果value是变量名，添加g_ui_vars前缀
            else if (/^[a-z_][a-z0-9_]*$/i.test(value) && !['0', '1'].includes(value)) {
                value = `g_ui_vars.${value}`;
            }
            code += `        g_ui_vars.${varName} = ${value};\n`;
        }
        // 变量递增: inc:varname
        else if (actionId.startsWith('inc:')) {
            const varName = actionId.substring(4).trim();
            code += `        g_ui_vars.${varName}++;\n`;
        }
        // 变量递减: dec:varname
        else if (actionId.startsWith('dec:')) {
            const varName = actionId.substring(4).trim();
            code += `        g_ui_vars.${varName}--;\n`;
        }
        // 计算表达式: calc:result = expr
        else if (actionId.startsWith('calc:')) {
            const expr = actionId.substring(5);
            const parts = expr.split('=').map(s => s.trim());
            const varName = parts[0];
            const formula = parts[1] || '0';
            const cFormula = this.generateGuardCode(formula);
            code += `        g_ui_vars.${varName} = ${cFormula};\n`;
        }
        // 历史滚动: scroll:history
        else if (actionId === 'scroll:history') {
            code += `        ui_vars_scroll_history();\n`;
        }
        // 条件动作: if:condition then action
        else if (actionId.startsWith('if:')) {
            const match = actionId.match(/if:(.+)\s+then\s+(.+)/);
            if (match) {
                const condition = this.generateGuardCode(match[1].trim());
                const action = match[2].trim();
                code += `        if (${condition}) {\n`;
                code += '    ' + this.generateEnhancedActionCode(action, presets, animations);
                code += `        }\n`;
            }
        }
        // 其他动作使用原有逻辑
        else {
            code = this.generateActionCode(actionId, presets, animations);
        }
        
        return code;
    },
    
    // ========== 完整代码包生成 (增强版) ==========
    
    /**
     * 生成完整的C代码包 (增强版，支持变量)
     */
    async generateAllEnhanced(projectData) {
        const {
            lcdProject,
            components,
            presets,
            animations,
            stateMachine,
        } = projectData;
        
        const variables = stateMachine?.variables || {};
        
        const result = {
            // Layer 1: LCD驱动层
            'lcd_mapping.h': this.generateLcdMappingHeader(lcdProject),
            'lcd_mapping.c': this.generateLcdMappingSource(lcdProject),
            
            // Layer 2: 组件层
            'lcd_components.h': this.generateComponentsHeader(components),
            'lcd_components.c': this.generateComponentsSource(components, lcdProject),
            
            // Layer 3a: 变量层
            'ui_variables.h': this.generateVariablesHeader(variables),
            'ui_variables.c': this.generateVariablesSource(variables),
            
            // Layer 3b: 预设和动画
            'ui_presets.h': this.generatePresetsHeader(presets),
            'ui_presets.c': this.generatePresetsSource(presets, components),
            'ui_animation.h': this.generateAnimationHeader(animations),
            'ui_animation.c': this.generateAnimationSource(animations),
            
            // Layer 4: 状态机层
            'ui_state_machine.h': this.generateStateMachineHeader(stateMachine),
            'ui_state_machine.c': this.generateStateMachineSourceEnhanced(stateMachine, presets, animations),
            
            // Layer 0: 硬件抽象层 (事件接口模板)
            'ui_hal.h': this.generateHardwareHeader(),
        };
        
        return result;
    },
    
    /**
     * 生成UI事件接口头文件 (替代硬件抽象层)
     * UI通过事件与固件通信，不直接控制硬件
     */
    generateHardwareHeader() {
        return `/**
 * @file    ui_hal.h
 * @brief   UI硬件抽象层 - 事件接口 (模板文件)
 * @note    UI层通过事件与固件通信，不直接控制硬件
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 设计原则:
 * - UI只管显示逻辑，不直接操作硬件
 * - 通过 ui_emit_event() 发送事件给固件
 * - 固件通过 ui_hsm_dispatch() 发送事件给UI
 * 
 * 事件流:
 *   UI层                          固件层
 *   ─────                         ─────
 *   进入LASER_ON状态
 *     → emit:laserOn      ───→   laser_enable(true)
 *   
 *   进入MEASURING状态
 *     → emit:measureStart ───→   ranging_start()
 *   
 *   测量完成
 *     ← MEASURE_OK        ←───   ui_hsm_dispatch(&evt)
 */

#ifndef UI_HAL_H
#define UI_HAL_H

#include <stdint.h>

/* ========== UI发出的事件 (UI → 固件) ========== */
typedef enum {
    /* 激光控制请求 */
    UI_EMIT_LASER_ON,           /* 请求开启激光 */
    UI_EMIT_LASER_OFF,          /* 请求关闭激光 */
    
    /* 测量控制请求 */
    UI_EMIT_MEASURE_START,      /* 请求开始测量 */
    UI_EMIT_MEASURE_STOP,       /* 请求停止测量 */
    UI_EMIT_MEASURE_CONTINUOUS, /* 请求连续测量 */
    
    /* 背光控制请求 */
    UI_EMIT_BACKLIGHT_ON,       /* 请求开启背光 */
    UI_EMIT_BACKLIGHT_OFF,      /* 请求关闭背光 */
    
    /* 蜂鸣器请求 */
    UI_EMIT_BEEP_SHORT,         /* 请求短蜂鸣 */
    UI_EMIT_BEEP_LONG,          /* 请求长蜂鸣 */
    UI_EMIT_BEEP_ERROR,         /* 请求错误蜂鸣 */
    
    /* 电源控制请求 */
    UI_EMIT_POWER_OFF,          /* 请求关机 */
    UI_EMIT_SLEEP,              /* 请求休眠 */
    
    /* 模式切换通知 */
    UI_EMIT_MODE_CHANGED,       /* 测量模式已切换 */
    UI_EMIT_UNIT_CHANGED,       /* 单位已切换 */
    
    /* 数据请求 */
    UI_EMIT_GET_BATTERY,        /* 请求电量信息 */
    UI_EMIT_GET_SIGNAL,         /* 请求信号强度 */
    
    UI_EMIT_COUNT
} ui_emit_event_t;

/* ========== 事件发送函数 (需要固件实现) ========== */

/**
 * @brief UI发送事件给固件
 * @param event 事件类型
 * @note 固件需要实现此函数，处理UI的请求
 * 
 * 示例实现:
 * void ui_emit_event(ui_emit_event_t event) {
 *     switch (event) {
 *     case UI_EMIT_LASER_ON:
 *         laser_enable(true);
 *         break;
 *     case UI_EMIT_MEASURE_START:
 *         ranging_start();
 *         break;
 *     // ...
 *     }
 * }
 */
void ui_emit_event(ui_emit_event_t event);

/**
 * @brief UI发送带参数的事件
 * @param event 事件类型
 * @param param 参数值
 */
void ui_emit_event_param(ui_emit_event_t event, uint16_t param);

/* ========== 系统时钟 (需要固件实现) ========== */

/**
 * @brief 获取系统tick (毫秒)
 * @return 系统运行时间(ms)
 */
uint32_t sys_tick_get(void);

/* ========== 数据绑定回调 (可选) ========== */

/**
 * @brief 设置测量结果 (固件调用)
 * @param distance 距离值
 * @param signal 信号强度
 */
void ui_set_measure_result(float distance, uint8_t signal);

/**
 * @brief 设置电池电量 (固件调用)
 * @param level 电量等级 (0-3)
 * @param charging 是否充电中
 */
void ui_set_battery_level(uint8_t level, uint8_t charging);

#endif /* UI_HAL_H */
`;
    },
    
    /**
     * 生成增强版状态机源文件 (支持变量和Guard)
     */
    generateStateMachineSourceEnhanced(stateMachine, presets, animations) {
        const hierarchy = stateMachine?.hierarchy || {};
        const transitions = stateMachine?.transitions || [];
        const variables = stateMachine?.variables || {};
        const states = this.collectStates(hierarchy);
        
        let code = `/**
 * @file    ui_state_machine.c
 * @brief   UI状态机实现 (自动生成 - 增强版)
 * @note    支持变量系统、Guard条件、UI与硬件分离
 * @date    ${new Date().toISOString().split('T')[0]}
 * 
 * 架构说明:
 * - UI层只处理显示逻辑和状态转移
 * - 通过 ui_emit_event() 发送请求给固件
 * - 不直接调用硬件控制函数
 */

#include "ui_state_machine.h"
#include "ui_variables.h"
#include "ui_presets.h"
#include "ui_animation.h"
#include "lcd_components.h"
#include "lcd_mapping.h"
#include <math.h>

/* 全局状态机实例 */
ui_hsm_t g_ui_hsm;

/* 状态名称表 */
static const char* state_names[UI_STATE_COUNT] = {
`;
        
        states.forEach(state => {
            code += `    [UI_STATE_${this.toEnumName(state.id)}] = "${state.label || state.id}",\n`;
        });
        
        code += `};

/* 状态处理函数声明 */
`;
        
        states.forEach(state => {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt);\n`;
        });
        
        code += `
/* 状态处理函数表 */
typedef void (*state_handler_t)(ui_hsm_t* hsm, const ui_event_t* evt);
static const state_handler_t state_handlers[UI_STATE_COUNT] = {
`;
        
        states.forEach(state => {
            const funcName = `state_${this.toVarName(state.id)}`;
            code += `    [UI_STATE_${this.toEnumName(state.id)}] = ${funcName},\n`;
        });
        
        code += `};

/* 初始化 */
void ui_hsm_init(ui_hsm_t* hsm) {
    /* 初始化变量 */
    ui_vars_init();
    
    hsm->current_state = UI_STATE_${this.toEnumName(states[0]?.id || 'ROOT')};
    hsm->target_state = hsm->current_state;
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

`;
        
        // 生成每个状态的处理函数
        states.forEach(state => {
            code += this.generateStateHandlerEnhanced(state, transitions, presets, animations);
        });
        
        return code;
    },
    
    /**
     * 生成增强版状态处理函数
     */
    generateStateHandlerEnhanced(state, transitions, presets, animations) {
        const funcName = `state_${this.toVarName(state.id)}`;
        
        // 找到从这个状态出发的转移
        const outTransitions = transitions.filter(t => t.from === state.id);
        
        // 按事件分组转移 (同一事件可能有多个带不同Guard的转移)
        const transitionsByEvent = {};
        outTransitions.forEach(trans => {
            if (!transitionsByEvent[trans.event]) {
                transitionsByEvent[trans.event] = [];
            }
            transitionsByEvent[trans.event].push(trans);
        });
        
        let code = `
/* ${state.label || state.id} 状态处理 */
static void ${funcName}(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
`;
        
        // 入口动作
        if (state.entryActions?.length) {
            state.entryActions.forEach(action => {
                code += this.generateEnhancedActionCode(action, presets, animations);
            });
        }
        
        code += `        break;
        
    case UI_EVT_EXIT:
`;
        
        // 退出动作
        if (state.exitActions?.length) {
            state.exitActions.forEach(action => {
                code += this.generateEnhancedActionCode(action, presets, animations);
            });
        }
        
        code += `        break;
`;
        
        // 处理转移 (按事件分组)
        for (const [eventName, transList] of Object.entries(transitionsByEvent)) {
            const eventType = this.eventToEnum(eventName);
            
            code += `
    case ${eventType}:
`;
            
            // 如果有多个转移，需要用if-else链
            if (transList.length > 1 || transList[0].guard) {
                transList.forEach((trans, idx) => {
                    code += this.generateGuardedTransition(trans, presets, animations);
                });
            } else {
                // 单个无Guard转移
                const trans = transList[0];
                if (trans.actions?.length) {
                    trans.actions.forEach(action => {
                        code += this.generateEnhancedActionCode(action, presets, animations);
                    });
                }
                code += `        TRAN(UI_STATE_${this.toEnumName(trans.to)});\n`;
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
    
    // ========== 代码验证 ==========
    
    /**
     * 验证生成的代码
     * @param {object} codeFiles - 生成的代码文件对象
     * @returns {object} - { valid: boolean, errors: [], warnings: [] }
     */
    validateGeneratedCode(codeFiles) {
        const result = {
            valid: true,
            errors: [],
            warnings: [],
        };
        
        for (const [filename, content] of Object.entries(codeFiles)) {
            // 检查括号匹配
            const braceCheck = this.checkBraceBalance(content, filename);
            if (!braceCheck.valid) {
                result.valid = false;
                result.errors.push(...braceCheck.errors);
            }
            
            // 检查必要的include
            if (filename.endsWith('.c')) {
                const headerName = filename.replace('.c', '.h');
                if (!content.includes(`#include "${headerName}"`)) {
                    result.warnings.push(`${filename}: 缺少对应头文件的include`);
                }
            }
            
            // 检查函数声明和定义匹配
            if (filename.endsWith('.h')) {
                const funcDecls = this.extractFunctionDeclarations(content);
                const sourceFile = filename.replace('.h', '.c');
                const sourceContent = codeFiles[sourceFile];
                if (sourceContent) {
                    funcDecls.forEach(func => {
                        if (!sourceContent.includes(func.name + '(')) {
                            result.warnings.push(`${sourceFile}: 缺少函数 ${func.name} 的实现`);
                        }
                    });
                }
            }
        }
        
        return result;
    },
    
    /**
     * 检查括号平衡
     */
    checkBraceBalance(code, filename) {
        const result = { valid: true, errors: [] };
        const stack = [];
        const pairs = { '{': '}', '(': ')', '[': ']' };
        let lineNum = 1;
        
        for (let i = 0; i < code.length; i++) {
            const char = code[i];
            if (char === '\n') lineNum++;
            
            if ('{(['.includes(char)) {
                stack.push({ char, line: lineNum });
            } else if ('})]'.includes(char)) {
                if (stack.length === 0) {
                    result.valid = false;
                    result.errors.push(`${filename}:${lineNum}: 多余的 '${char}'`);
                } else {
                    const top = stack.pop();
                    if (pairs[top.char] !== char) {
                        result.valid = false;
                        result.errors.push(`${filename}:${lineNum}: '${char}' 与第${top.line}行的 '${top.char}' 不匹配`);
                    }
                }
            }
        }
        
        if (stack.length > 0) {
            result.valid = false;
            stack.forEach(item => {
                result.errors.push(`${filename}:${item.line}: 未闭合的 '${item.char}'`);
            });
        }
        
        return result;
    },
    
    /**
     * 提取函数声明
     */
    extractFunctionDeclarations(headerContent) {
        const funcs = [];
        // 匹配函数声明: 返回类型 函数名(参数);
        const regex = /^\s*(?:void|int|uint\d+_t|float|const\s+char\*|[a-z_]+_t)\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)\s*;/gmi;
        let match;
        while ((match = regex.exec(headerContent)) !== null) {
            funcs.push({ name: match[1] });
        }
        return funcs;
    },
    
    // ========== 代码统计 ==========
    
    /**
     * 统计生成的代码
     */
    getCodeStats(codeFiles) {
        const stats = {
            totalFiles: Object.keys(codeFiles).length,
            totalLines: 0,
            totalBytes: 0,
            byFile: {},
        };
        
        for (const [filename, content] of Object.entries(codeFiles)) {
            const lines = content.split('\n').length;
            const bytes = new Blob([content]).size;
            stats.totalLines += lines;
            stats.totalBytes += bytes;
            stats.byFile[filename] = { lines, bytes };
        }
        
        return stats;
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.CodeGenerator;
}
