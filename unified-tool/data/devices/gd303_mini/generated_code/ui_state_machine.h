/**
 * @file    ui_state_machine.h
 * @brief   UI状态机定义 (自动生成)
 * @note    层级状态机(HSM)架构，UI与硬件分离
 * @date    2025-12-31
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
    UI_STATE_ROOT = 0,
    UI_STATE_OFF = 1,
    UI_STATE_BOOT = 2,
    UI_STATE_FULL_DISPLAY = 3,
    UI_STATE_INIT = 4,
    UI_STATE_UNIT_SELECT = 5,
    UI_STATE_ON = 6,
    UI_STATE_IDLE = 7,
    UI_STATE_SINGLE = 8,
    UI_STATE_LASER_ON = 9,
    UI_STATE_RANGING = 10,
    UI_STATE_RESULT = 11,
    UI_STATE_ERROR = 12,
    UI_STATE_AREA = 13,
    UI_STATE_AREA_INIT = 14,
    UI_STATE_AREA_STEP1 = 15,
    UI_STATE_AREA_STEP1_DONE = 16,
    UI_STATE_AREA_STEP2 = 17,
    UI_STATE_AREA_RESULT = 18,
    UI_STATE_VOLUME = 19,
    UI_STATE_VOL_INIT = 20,
    UI_STATE_VOL_STEP1 = 21,
    UI_STATE_VOL_STEP2 = 22,
    UI_STATE_VOL_STEP3 = 23,
    UI_STATE_VOL_RESULT = 24,
    UI_STATE_PYTH1 = 25,
    UI_STATE_P1_INIT = 26,
    UI_STATE_P1_STEP1 = 27,
    UI_STATE_P1_STEP2 = 28,
    UI_STATE_P1_RESULT = 29,
    UI_STATE_P1_ERROR = 30,
    UI_STATE_PYTH2 = 31,
    UI_STATE_P2_INIT = 32,
    UI_STATE_P2_STEP1 = 33,
    UI_STATE_P2_STEP2 = 34,
    UI_STATE_P2_STEP3 = 35,
    UI_STATE_P2_RESULT = 36,
    UI_STATE_PYTH3 = 37,
    UI_STATE_P3_INIT = 38,
    UI_STATE_P3_STEP1 = 39,
    UI_STATE_P3_STEP2 = 40,
    UI_STATE_P3_STEP3 = 41,
    UI_STATE_P3_RESULT = 42,
    UI_STATE_CONTINUOUS = 43,
    UI_STATE_CONT_INIT = 44,
    UI_STATE_CONT_MEASURING = 45,
    UI_STATE_SETTINGS = 46,
    UI_STATE_BASE_SELECT = 47,
    UI_STATE_BASE_BACK = 48,
    UI_STATE_BASE_FRONT = 49,
    UI_STATE_BEEP_SETTING = 50,
    UI_STATE_BEEP_ON = 51,
    UI_STATE_BEEP_OFF = 52,
    UI_STATE_BACKLIGHT_SETTING = 53,
    UI_STATE_BL_ON = 54,
    UI_STATE_BL_OFF = 55,
    UI_STATE_COUNT
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
