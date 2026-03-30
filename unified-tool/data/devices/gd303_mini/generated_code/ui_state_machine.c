/**
 * @file    ui_state_machine.c
 * @brief   UI状态机实现 (自动生成 - 增强版)
 * @note    支持变量系统、Guard条件、UI与硬件分离
 * @date    2025-12-31
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
    [UI_STATE_ROOT] = "系统",
    [UI_STATE_OFF] = "关机",
    [UI_STATE_BOOT] = "开机流程",
    [UI_STATE_FULL_DISPLAY] = "全显",
    [UI_STATE_INIT] = "初始化",
    [UI_STATE_UNIT_SELECT] = "单位选择",
    [UI_STATE_ON] = "运行",
    [UI_STATE_IDLE] = "待机",
    [UI_STATE_SINGLE] = "单次测量",
    [UI_STATE_LASER_ON] = "激光开启",
    [UI_STATE_RANGING] = "测距中",
    [UI_STATE_RESULT] = "显示结果",
    [UI_STATE_ERROR] = "错误",
    [UI_STATE_AREA] = "面积测量",
    [UI_STATE_AREA_INIT] = "面积初始",
    [UI_STATE_AREA_STEP1] = "测量长度",
    [UI_STATE_AREA_STEP1_DONE] = "长度完成",
    [UI_STATE_AREA_STEP2] = "测量宽度",
    [UI_STATE_AREA_RESULT] = "面积结果",
    [UI_STATE_VOLUME] = "体积测量",
    [UI_STATE_VOL_INIT] = "体积初始",
    [UI_STATE_VOL_STEP1] = "测量长度",
    [UI_STATE_VOL_STEP2] = "测量宽度",
    [UI_STATE_VOL_STEP3] = "测量高度",
    [UI_STATE_VOL_RESULT] = "体积结果",
    [UI_STATE_PYTH1] = "勾股1",
    [UI_STATE_P1_INIT] = "勾股1初始",
    [UI_STATE_P1_STEP1] = "测量斜边",
    [UI_STATE_P1_STEP2] = "测量直角边",
    [UI_STATE_P1_RESULT] = "勾股1结果",
    [UI_STATE_P1_ERROR] = "勾股1错误",
    [UI_STATE_PYTH2] = "勾股2",
    [UI_STATE_P2_INIT] = "勾股2初始",
    [UI_STATE_P2_STEP1] = "测量斜边1",
    [UI_STATE_P2_STEP2] = "测量公共边",
    [UI_STATE_P2_STEP3] = "测量斜边2",
    [UI_STATE_P2_RESULT] = "勾股2结果",
    [UI_STATE_PYTH3] = "勾股3",
    [UI_STATE_P3_INIT] = "勾股3初始",
    [UI_STATE_P3_STEP1] = "测量斜边1",
    [UI_STATE_P3_STEP2] = "测量公共边",
    [UI_STATE_P3_STEP3] = "测量斜边2",
    [UI_STATE_P3_RESULT] = "勾股3结果",
    [UI_STATE_CONTINUOUS] = "连续测量",
    [UI_STATE_CONT_INIT] = "连续初始",
    [UI_STATE_CONT_MEASURING] = "连续测量中",
    [UI_STATE_SETTINGS] = "设置",
    [UI_STATE_BASE_SELECT] = "基准选择",
    [UI_STATE_BASE_BACK] = "后基准",
    [UI_STATE_BASE_FRONT] = "前基准",
    [UI_STATE_BEEP_SETTING] = "蜂鸣器设置",
    [UI_STATE_BEEP_ON] = "蜂鸣器开",
    [UI_STATE_BEEP_OFF] = "蜂鸣器关",
    [UI_STATE_BACKLIGHT_SETTING] = "背光设置",
    [UI_STATE_BL_ON] = "背光开",
    [UI_STATE_BL_OFF] = "背光关",
};

/* 状态处理函数声明 */
static void state_root(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_off(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_boot(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_full_display(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_unit_select(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_on(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_idle(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_single(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_laser_on(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_ranging(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_error(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area_step1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area_step1_done(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area_step2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_area_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_volume(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_vol_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_vol_step1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_vol_step2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_vol_step3(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_vol_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_pyth1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p1_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p1_step1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p1_step2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p1_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p1_error(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_pyth2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p2_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p2_step1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p2_step2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p2_step3(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p2_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_pyth3(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p3_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p3_step1(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p3_step2(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p3_step3(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_p3_result(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_continuous(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_cont_init(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_cont_measuring(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_settings(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_base_select(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_base_back(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_base_front(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_beep_setting(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_beep_on(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_beep_off(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_backlight_setting(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_bl_on(ui_hsm_t* hsm, const ui_event_t* evt);
static void state_bl_off(ui_hsm_t* hsm, const ui_event_t* evt);

/* 状态处理函数表 */
typedef void (*state_handler_t)(ui_hsm_t* hsm, const ui_event_t* evt);
static const state_handler_t state_handlers[UI_STATE_COUNT] = {
    [UI_STATE_ROOT] = state_root,
    [UI_STATE_OFF] = state_off,
    [UI_STATE_BOOT] = state_boot,
    [UI_STATE_FULL_DISPLAY] = state_full_display,
    [UI_STATE_INIT] = state_init,
    [UI_STATE_UNIT_SELECT] = state_unit_select,
    [UI_STATE_ON] = state_on,
    [UI_STATE_IDLE] = state_idle,
    [UI_STATE_SINGLE] = state_single,
    [UI_STATE_LASER_ON] = state_laser_on,
    [UI_STATE_RANGING] = state_ranging,
    [UI_STATE_RESULT] = state_result,
    [UI_STATE_ERROR] = state_error,
    [UI_STATE_AREA] = state_area,
    [UI_STATE_AREA_INIT] = state_area_init,
    [UI_STATE_AREA_STEP1] = state_area_step1,
    [UI_STATE_AREA_STEP1_DONE] = state_area_step1_done,
    [UI_STATE_AREA_STEP2] = state_area_step2,
    [UI_STATE_AREA_RESULT] = state_area_result,
    [UI_STATE_VOLUME] = state_volume,
    [UI_STATE_VOL_INIT] = state_vol_init,
    [UI_STATE_VOL_STEP1] = state_vol_step1,
    [UI_STATE_VOL_STEP2] = state_vol_step2,
    [UI_STATE_VOL_STEP3] = state_vol_step3,
    [UI_STATE_VOL_RESULT] = state_vol_result,
    [UI_STATE_PYTH1] = state_pyth1,
    [UI_STATE_P1_INIT] = state_p1_init,
    [UI_STATE_P1_STEP1] = state_p1_step1,
    [UI_STATE_P1_STEP2] = state_p1_step2,
    [UI_STATE_P1_RESULT] = state_p1_result,
    [UI_STATE_P1_ERROR] = state_p1_error,
    [UI_STATE_PYTH2] = state_pyth2,
    [UI_STATE_P2_INIT] = state_p2_init,
    [UI_STATE_P2_STEP1] = state_p2_step1,
    [UI_STATE_P2_STEP2] = state_p2_step2,
    [UI_STATE_P2_STEP3] = state_p2_step3,
    [UI_STATE_P2_RESULT] = state_p2_result,
    [UI_STATE_PYTH3] = state_pyth3,
    [UI_STATE_P3_INIT] = state_p3_init,
    [UI_STATE_P3_STEP1] = state_p3_step1,
    [UI_STATE_P3_STEP2] = state_p3_step2,
    [UI_STATE_P3_STEP3] = state_p3_step3,
    [UI_STATE_P3_RESULT] = state_p3_result,
    [UI_STATE_CONTINUOUS] = state_continuous,
    [UI_STATE_CONT_INIT] = state_cont_init,
    [UI_STATE_CONT_MEASURING] = state_cont_measuring,
    [UI_STATE_SETTINGS] = state_settings,
    [UI_STATE_BASE_SELECT] = state_base_select,
    [UI_STATE_BASE_BACK] = state_base_back,
    [UI_STATE_BASE_FRONT] = state_base_front,
    [UI_STATE_BEEP_SETTING] = state_beep_setting,
    [UI_STATE_BEEP_ON] = state_beep_on,
    [UI_STATE_BEEP_OFF] = state_beep_off,
    [UI_STATE_BACKLIGHT_SETTING] = state_backlight_setting,
    [UI_STATE_BL_ON] = state_bl_on,
    [UI_STATE_BL_OFF] = state_bl_off,
};

/* 初始化 */
void ui_hsm_init(ui_hsm_t* hsm) {
    /* 初始化变量 */
    ui_vars_init();
    
    hsm->current_state = UI_STATE_ROOT;
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
#define TRAN(target) do { \
    hsm->target_state = (target); \
    hsm->transition_pending = 1; \
} while(0)


/* 系统 状态处理 */
static void state_root(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 关机 状态处理 */
static void state_off(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        lcd_clear_all();
        lcd_comp_set_visible(COMP_LASER, 0);
        /* TODO: hw:backlight:off */
        /* TODO: assign:backlight_on = false */
        /* TODO: assign:idle_time = 0 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_XLONG:
        TRAN(UI_STATE_BOOT);
        break;

    default:
        break;
    }
}

/* 开机流程 状态处理 */
static void state_boot(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 全显 状态处理 */
static void state_full_display(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: hw:backlight:on */
        lcd_show_all();
        /* TODO: assign:backlight_on = true */
        /* TODO: timeout:500 */
        break;
        
    case UI_EVT_EXIT:
        lcd_clear_all();
        break;

    case UI_EVT_TIMEOUT:
        TRAN(UI_STATE_INIT);
        break;

    default:
        break;
    }
}

/* 初始化 状态处理 */
static void state_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_BOOT_INIT);
        /* TODO: assign:idle_time = 0 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_TIMEOUT_1S:
        if (g_ui_vars.K1_HELD) {
            TRAN(UI_STATE_UNIT_SELECT);
        }
        break;

    case UI_EVT_K1_RELEASE:
        ui_apply_preset(PRESET_BOOT_COMPLETE);
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 单位选择 状态处理 */
static void state_unit_select(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_UNIT_SELECT);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_UNITSELECTANIM);
        break;

    case UI_EVT_TIMEOUT_1S:
        g_ui_vars.unit++;
        if (g_ui_vars.unit > 2) {
            g_ui_vars.unit = 0;
        }
        ui_apply_preset(PRESET_UNIT_SELECT);
        TRAN(UI_STATE_UNIT_SELECT);
        break;

    case UI_EVT_K1_RELEASE:
        ui_apply_preset(PRESET_BOOT_COMPLETE);
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 运行 状态处理 */
static void state_on(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_BOOT_COMPLETE);
        /* TODO: assign:idle_time = 0 */
        break;
        
    case UI_EVT_EXIT:
        lcd_comp_set_visible(COMP_LASER, 0);
        ui_anim_stop(ANIM_LASERBLINK);
        break;

    case UI_EVT_K3_XLONG:
        TRAN(UI_STATE_OFF);
        break;

    case UI_EVT_TIMEOUT_POWER:
        TRAN(UI_STATE_OFF);
        break;

    default:
        break;
    }
}

/* 待机 状态处理 */
static void state_idle(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        lcd_comp_set_visible(COMP_LASER, 0);
        ui_anim_stop(ANIM_LASERBLINK);
        ui_apply_preset(PRESET_SINGLE_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_SINGLE);
        break;

    case UI_EVT_K1_LONG:
        TRAN(UI_STATE_CONTINUOUS);
        break;

    case UI_EVT_K2_SHORT:
        if (g_ui_vars.measure_mode == 0) {
            TRAN(UI_STATE_AREA);
        }
        break;

    default:
        break;
    }
}

/* 单次测量 状态处理 */
static void state_single(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 0 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_AREA);
        break;

    default:
        break;
    }
}

/* 激光开启 状态处理 */
static void state_laser_on(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        lcd_comp_set_visible(COMP_LASER, 1);
        ui_anim_start(ANIM_LASERBLINK);
        if (g_ui_vars.runstep % 2 == 0) {
            g_ui_vars.runstep++;
        }
        if (g_ui_vars.runstep > g_ui_vars.last_step) {
            ui_vars_scroll_history();
        }
        lcd_comp_show_preset(COMP_LINE4, "dash");
        /* TODO: assign:idle_time = 0 */
        break;
        
    case UI_EVT_EXIT:
        /* TODO: assign:last_step = runstep */
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_RANGING);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    case UI_EVT_TIMEOUT_LASER:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 测距中 状态处理 */
static void state_ranging(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_anim_start(ANIM_MEASURINGDOTS);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_MEASURINGDOTS);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_RESULT);
        break;

    case UI_EVT_MEASURE_FAIL:
        TRAN(UI_STATE_ERROR);
        break;

    default:
        break;
    }
}

/* 显示结果 状态处理 */
static void state_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        g_ui_vars.runstep++;
        /* TODO: assign:line4_data = distance */
        lcd_comp_set_visible(COMP_LASER, 0);
        ui_anim_stop(ANIM_LASERBLINK);
        /* TODO: hw:beep:short */
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        /* TODO: assign:idle_time = 0 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_LASER_ON);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    case UI_EVT_TIMEOUT_BACKLIGHT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 错误 状态处理 */
static void state_error(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        lcd_comp_set_visible(COMP_LASER, 0);
        ui_anim_stop(ANIM_LASERBLINK);
        /* TODO: hw:beep:long */
        ui_apply_preset(PRESET_ERROR_DISPLAY);
        ui_anim_start(ANIM_ERRORFLASH);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_ERRORFLASH);
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_LASER_ON);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 面积测量 状态处理 */
static void state_area(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 1 */
        /* TODO: flow:setType:multi */
        /* TODO: flow:clearSlots */
        ui_apply_preset(PRESET_AREA_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_VOLUME);
        break;

    case UI_EVT_K3_LONG:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 面积初始 状态处理 */
static void state_area_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_AREA_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_AREA_STEP1);
        break;

    default:
        break;
    }
}

/* 测量长度 状态处理 */
static void state_area_step1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: flow:onEnterReady */
        ui_anim_start(ANIM_LASERBLINK);
        ui_anim_start(ANIM_AREASIDE1BLINK);
        ui_apply_preset(PRESET_AREA_STEP1);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_AREASIDE1BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_AREA_STEP1_DONE);
        break;

    default:
        break;
    }
}

/* 长度完成 状态处理 */
static void state_area_step1_done(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: flow:storeSlot:2 */
        ui_apply_preset(PRESET_AREA_STEP1_DONE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_AREA_STEP2);
        break;

    case UI_EVT_K3_SHORT:
        /* TODO: flow:undo */
        TRAN(UI_STATE_AREA_STEP1);
        break;

    default:
        break;
    }
}

/* 测量宽度 状态处理 */
static void state_area_step2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: flow:onEnterReady */
        ui_anim_start(ANIM_LASERBLINK);
        ui_anim_start(ANIM_AREASIDE2BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_AREASIDE2BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_AREA_RESULT);
        break;

    case UI_EVT_K3_SHORT:
        /* TODO: flow:undo */
        TRAN(UI_STATE_AREA_STEP1);
        break;

    default:
        break;
    }
}

/* 面积结果 状态处理 */
static void state_area_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: flow:storeSlot:2 */
        /* TODO: flow:calcArea */
        ui_anim_stop(ANIM_LASERBLINK);
        ui_apply_preset(PRESET_AREA_RESULT);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_AREA_INIT);
        break;

    case UI_EVT_K3_SHORT:
        /* TODO: flow:undo */
        TRAN(UI_STATE_AREA_STEP2);
        break;

    default:
        break;
    }
}

/* 体积测量 状态处理 */
static void state_volume(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 2 */
        /* TODO: assign:runstep = 1 */
        ui_apply_preset(PRESET_VOLUME_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_PYTH1);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 体积初始 状态处理 */
static void state_vol_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_VOLUME_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_VOL_STEP1);
        break;

    default:
        break;
    }
}

/* 测量长度 状态处理 */
static void state_vol_step1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_anim_start(ANIM_LASERBLINK);
        ui_anim_start(ANIM_VOLUMESIDE1BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_VOLUMESIDE1BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_VOL_STEP2);
        break;

    default:
        break;
    }
}

/* 测量宽度 状态处理 */
static void state_vol_step2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line1_data = distance */
        lcd_comp_set_value(COMP_LINE1, "${line1_data}");
        ui_anim_start(ANIM_VOLUMESIDE2BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_VOLUMESIDE2BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_VOL_STEP3);
        break;

    default:
        break;
    }
}

/* 测量高度 状态处理 */
static void state_vol_step3(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line2_data = distance */
        lcd_comp_set_value(COMP_LINE2, "${line2_data}");
        ui_anim_start(ANIM_VOLUMESIDE3BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_VOLUMESIDE3BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_VOL_RESULT);
        break;

    default:
        break;
    }
}

/* 体积结果 状态处理 */
static void state_vol_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line3_data = distance */
        g_ui_vars.line4_data = g_ui_vars.line1_data * g_ui_vars.line2_data * g_ui_vars.line3_data;
        ui_anim_stop(ANIM_LASERBLINK);
        lcd_comp_set_value(COMP_LINE3, "${line3_data}");
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_VOL_INIT);
        break;

    default:
        break;
    }
}

/* 勾股1 状态处理 */
static void state_pyth1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 3 */
        /* TODO: assign:runstep = 1 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_PYTH2);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 勾股1初始 状态处理 */
static void state_p1_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_PYTH_IDLE);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_P1_STEP1);
        break;

    default:
        break;
    }
}

/* 测量斜边 状态处理 */
static void state_p1_step1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_anim_start(ANIM_LASERBLINK);
        ui_anim_start(ANIM_PYTHSIDE1BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_PYTHSIDE1BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P1_STEP2);
        break;

    default:
        break;
    }
}

/* 测量直角边 状态处理 */
static void state_p1_step2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line1_data = distance */
        lcd_comp_set_value(COMP_LINE1, "${line1_data}");
        ui_anim_start(ANIM_PYTHSIDE2BLINK);
        break;
        
    case UI_EVT_EXIT:
        ui_anim_stop(ANIM_PYTHSIDE2BLINK);
        break;

    case UI_EVT_MEASURE_OK:
        if (g_ui_vars.line1_data > g_ui_vars.distance) {
            TRAN(UI_STATE_P1_RESULT);
        }
        if (g_ui_vars.line1_data <= g_ui_vars.distance) {
            TRAN(UI_STATE_P1_ERROR);
        }
        break;

    default:
        break;
    }
}

/* 勾股1结果 状态处理 */
static void state_p1_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line2_data = distance */
        lcd_comp_set_value(COMP_LINE2, "${line2_data}");
        g_ui_vars.line4_data = sqrtf((g_ui_vars.line1_data*g_ui_vars.line1_data) - (g_ui_vars.line2_data*g_ui_vars.line2_data));
        ui_anim_stop(ANIM_LASERBLINK);
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_P1_INIT);
        break;

    default:
        break;
    }
}

/* 勾股1错误 状态处理 */
static void state_p1_error(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:error_code = 4 */
        ui_apply_preset(PRESET_ERROR_DISPLAY);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_P1_INIT);
        break;

    default:
        break;
    }
}

/* 勾股2 状态处理 */
static void state_pyth2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 4 */
        /* TODO: assign:runstep = 1 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_PYTH3);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 勾股2初始 状态处理 */
static void state_p2_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_P2_STEP1);
        break;

    default:
        break;
    }
}

/* 测量斜边1 状态处理 */
static void state_p2_step1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P2_STEP2);
        break;

    default:
        break;
    }
}

/* 测量公共边 状态处理 */
static void state_p2_step2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P2_STEP3);
        break;

    default:
        break;
    }
}

/* 测量斜边2 状态处理 */
static void state_p2_step3(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P2_RESULT);
        break;

    default:
        break;
    }
}

/* 勾股2结果 状态处理 */
static void state_p2_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line3_data = distance */
        g_ui_vars.line4_data = sqrtf((g_ui_vars.line1_data*g_ui_vars.line1_data) - (g_ui_vars.line2_data*g_ui_vars.line2_data)) + sqrtf((g_ui_vars.line3_data*g_ui_vars.line3_data) - (g_ui_vars.line2_data*g_ui_vars.line2_data));
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 勾股3 状态处理 */
static void state_pyth3(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:measure_mode = 5 */
        /* TODO: assign:runstep = 1 */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_SHORT:
        TRAN(UI_STATE_SINGLE);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 勾股3初始 状态处理 */
static void state_p3_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_P3_STEP1);
        break;

    default:
        break;
    }
}

/* 测量斜边1 状态处理 */
static void state_p3_step1(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P3_STEP2);
        break;

    default:
        break;
    }
}

/* 测量公共边 状态处理 */
static void state_p3_step2(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P3_STEP3);
        break;

    default:
        break;
    }
}

/* 测量斜边2 状态处理 */
static void state_p3_step3(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_P3_RESULT);
        break;

    default:
        break;
    }
}

/* 勾股3结果 状态处理 */
static void state_p3_result(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line3_data = distance */
        g_ui_vars.line4_data = sqrtf((g_ui_vars.line1_data*g_ui_vars.line1_data) - (g_ui_vars.line2_data*g_ui_vars.line2_data)) - sqrtf((g_ui_vars.line3_data*g_ui_vars.line3_data) - (g_ui_vars.line2_data*g_ui_vars.line2_data));
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 连续测量 状态处理 */
static void state_continuous(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:continuous_flag = true */
        /* TODO: assign:max_data = -1 */
        /* TODO: assign:min_data = -1 */
        ui_apply_preset(PRESET_CONTINUOUS_IDLE);
        break;
        
    case UI_EVT_EXIT:
        /* TODO: assign:continuous_flag = false */
        ui_anim_stop(ANIM_LASERBLINK);
        break;

    case UI_EVT_K1_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    case UI_EVT_K3_SHORT:
        TRAN(UI_STATE_IDLE);
        break;

    default:
        break;
    }
}

/* 连续初始 状态处理 */
static void state_cont_init(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        ui_apply_preset(PRESET_CONTINUOUS_IDLE);
        ui_anim_start(ANIM_LASERBLINK);
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_CONT_MEASURING);
        break;

    default:
        break;
    }
}

/* 连续测量中 状态处理 */
static void state_cont_measuring(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:line4_data = distance */
        if (g_ui_vars.distance > g_ui_vars.max_data) {
            g_ui_vars.max_data = g_ui_vars.distance;
        }
        if (g_ui_vars.distance < g_ui_vars.min_data || g_ui_vars.min_data < 0) {
            g_ui_vars.min_data = g_ui_vars.distance;
        }
        lcd_comp_set_value(COMP_LINE2, "${max_data}");
        lcd_comp_set_value(COMP_LINE3, "${min_data}");
        lcd_comp_set_value(COMP_LINE4, "${line4_data}");
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_MEASURE_OK:
        TRAN(UI_STATE_CONT_MEASURING);
        break;

    default:
        break;
    }
}

/* 设置 状态处理 */
static void state_settings(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 基准选择 状态处理 */
static void state_base_select(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 后基准 状态处理 */
static void state_base_back(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:base_back = true */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_LONG:
        TRAN(UI_STATE_BASE_FRONT);
        break;

    default:
        break;
    }
}

/* 前基准 状态处理 */
static void state_base_front(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:base_back = false */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K2_LONG:
        TRAN(UI_STATE_BASE_BACK);
        break;

    default:
        break;
    }
}

/* 蜂鸣器设置 状态处理 */
static void state_beep_setting(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 蜂鸣器开 状态处理 */
static void state_beep_on(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:beep_enable = true */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1K2_COMBO:
        TRAN(UI_STATE_BEEP_OFF);
        break;

    default:
        break;
    }
}

/* 蜂鸣器关 状态处理 */
static void state_beep_off(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:beep_enable = false */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K1K2_COMBO:
        TRAN(UI_STATE_BEEP_ON);
        break;

    default:
        break;
    }
}

/* 背光设置 状态处理 */
static void state_backlight_setting(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        break;
        
    case UI_EVT_EXIT:
        break;

    default:
        break;
    }
}

/* 背光开 状态处理 */
static void state_bl_on(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:backlight_on = true */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K3_LONG:
        TRAN(UI_STATE_BL_OFF);
        break;

    default:
        break;
    }
}

/* 背光关 状态处理 */
static void state_bl_off(ui_hsm_t* hsm, const ui_event_t* evt) {
    switch (evt->type) {
    case UI_EVT_ENTRY:
        /* TODO: assign:backlight_on = false */
        break;
        
    case UI_EVT_EXIT:
        break;

    case UI_EVT_K3_LONG:
        TRAN(UI_STATE_BL_ON);
        break;

    default:
        break;
    }
}
