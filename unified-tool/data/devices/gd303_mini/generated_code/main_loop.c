/**
 * @file    main_loop.c
 * @brief   主循环模板 - UI和动画联动 (参考实现)
 * @date    2025-12-31
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
