/**
 * @file    ui_animation.h
 * @brief   动画控制器 (自动生成)
 * @date    2025-12-31
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
    ANIM_LASERBLINK = 0,
    ANIM_BLUETOOTHBLINK = 1,
    ANIM_WIFIBLINK = 2,
    ANIM_CHARGINGANIM = 3,
    ANIM_LOWBATTERYBLINK = 4,
    ANIM_BASEFRONTBLINK = 5,
    ANIM_BASEBACKBLINK = 6,
    ANIM_UNITSELECTANIM = 7,
    ANIM_BOOTFULLTEST = 8,
    ANIM_SIGNALPULSE = 9,
    ANIM_AREASIDE1BLINK = 10,
    ANIM_AREASIDE2BLINK = 11,
    ANIM_VOLUMESIDE1BLINK = 12,
    ANIM_VOLUMESIDE2BLINK = 13,
    ANIM_VOLUMESIDE3BLINK = 14,
    ANIM_ERRORFLASH = 15,
    ANIM_MEASURINGDOTS = 16,
    ANIM_COUNT
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
