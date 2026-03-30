/**
 * @file    ui_hal.h
 * @brief   UI硬件抽象层 - 事件接口 (模板文件)
 * @note    UI层通过事件与固件通信，不直接控制硬件
 * @date    2025-12-31
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
