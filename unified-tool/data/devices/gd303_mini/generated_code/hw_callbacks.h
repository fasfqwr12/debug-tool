/**
 * @file    hw_callbacks.h
 * @brief   硬件回调接口 (用户实现)
 * @date    2025-12-31
 * 
 * 说明: 这些函数由UI控制器在组件状态变化时调用
 *       用户需要在自己的代码中实现这些函数
 */

#ifndef HW_CALLBACKS_H
#define HW_CALLBACKS_H

#include <stdint.h>

/* ========== 硬件回调函数 ========== */
/* 用户需要实现以下函数 */

void hw_Turn_off_the_device(void);
void hw_beep_off(void);
void hw_beep_on(void);
void hw_laser_on(void);
void hw_laser_off(void);

/* ========== 通用硬件接口 ========== */

/* 蜂鸣器 */
void hw_beep(uint16_t ms);

/* 背光 */
void hw_backlight_on(void);
void hw_backlight_off(void);

#endif /* HW_CALLBACKS_H */
