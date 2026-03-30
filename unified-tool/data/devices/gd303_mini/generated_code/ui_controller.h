/**
 * @file    ui_controller.h
 * @brief   UI控制器 v3.0 - Line/Selector/Icon (自动生成)
 * @date    2025-12-31
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

/* 单位选择 */
typedef enum {
    UNIT_M = 0,
    UNIT_FT = 1,
    UNIT_IN = 2,
    UNIT_FT_IN = 3,
} unit_e;

/* 电量指示 */
typedef enum {
    BATTERY_EMPTY = 0,
    BATTERY_LOW = 1,
    BATTERY_MID = 2,
    BATTERY_FULL = 3,
} battery_e;

/* 信号强度 */
typedef enum {
    SIGNAL_L0 = 0,
    SIGNAL_L1 = 1,
    SIGNAL_L2 = 2,
    SIGNAL_L3 = 3,
    SIGNAL_L4 = 4,
    SIGNAL_L5 = 5,
} signal_e;

/* 基准模式 */
typedef enum {
    BASE_FRONT = 0,
    BASE_BEHIND = 1,
} base_e;

/* 蜂鸣器模式 */
typedef enum {
    BEEP_OFF = 0,
    BEEP_ON = 1,
} beep_e;

/* 模式选择 */
typedef enum {
    MODE_SELECTION_SINGLE = 0,
    MODE_SELECTION_CONTINUOUS = 1,
    MODE_SELECTION_AREA = 2,
    MODE_SELECTION_VOLUME = 3,
    MODE_SELECTION_PYTHAGOREAN1 = 4,
    MODE_SELECTION_PYTHAGOREAN2 = 5,
    MODE_SELECTION_PYTHAGOREAN3 = 6,
} mode_selection_e;

/* ========== 组件结构体 ========== */

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
    /* Line组件 */
    ui_line_t line4;  /* 第4行数字显示 (主显示行) */
    ui_line_t line3;  /* 第3行数字显示 */
    ui_line_t line2;  /* 第2行数字显示 */
    ui_line_t line1;  /* 第1行数字显示 (顶部小字) */

    /* Selector组件 */
    ui_sel_t unit;  /* 单位选择 */
    ui_sel_t battery;  /* 电量指示 */
    ui_sel_t signal;  /* 信号强度 */
    ui_sel_t base;  /* 基准模式 */
    ui_sel_t beep;  /* 蜂鸣器模式 */
    ui_sel_t mode_selection;  /* 模式选择 */

    /* Icon组件 */
    ui_icon_t laser;  /* 激光图标 */
    ui_icon_t bluetooth;  /* 蓝牙图标 */
    ui_icon_t wifi;  /* WiFi图标 */
    ui_icon_t rangefinder;  /* 测距仪图标 (常显) */
} ui_t;

/* 全局实例 */
extern ui_t ui;

/* API函数 */
void ui_init(void);
void ui_update(void);
void ui_refresh_all_lines(void);

#endif /* UI_CONTROLLER_H */
