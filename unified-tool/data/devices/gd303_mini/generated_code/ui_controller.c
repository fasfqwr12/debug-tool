/**
 * @file    ui_controller.c
 * @brief   UI控制器实现 (自动生成)
 * @date    2025-12-31
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
static void line4_set(float value, data_type_e type);
static void line4_set_str(const char* str);
static const char* line4_get(void);
static void line4_render(void);
static void line3_set(float value, data_type_e type);
static void line3_set_str(const char* str);
static const char* line3_get(void);
static void line3_render(void);
static void line2_set(float value, data_type_e type);
static void line2_set_str(const char* str);
static const char* line2_get(void);
static void line2_render(void);
static void line1_set(float value, data_type_e type);
static void line1_set_str(const char* str);
static const char* line1_get(void);
static void line1_render(void);
static void unit_set(uint8_t v);
static uint8_t unit_get(void);
static void unit_render(void);
static void battery_set(uint8_t v);
static uint8_t battery_get(void);
static void battery_render(void);
static void signal_set(uint8_t v);
static uint8_t signal_get(void);
static void signal_render(void);
static void base_set(uint8_t v);
static uint8_t base_get(void);
static void base_render(void);
static void beep_set(uint8_t v);
static uint8_t beep_get(void);
static void beep_render(void);
static void mode_selection_set(uint8_t v);
static uint8_t mode_selection_get(void);
static void mode_selection_render(void);
static void laser_set(uint8_t v);
static uint8_t laser_get(void);
static void laser_render(void);
static void bluetooth_set(uint8_t v);
static uint8_t bluetooth_get(void);
static void bluetooth_render(void);
static void wifi_set(uint8_t v);
static uint8_t wifi_get(void);
static void wifi_render(void);
static void rangefinder_set(uint8_t v);
static uint8_t rangefinder_get(void);
static void rangefinder_render(void);

/* ========== Line组件实现 ========== */

/* 第4行数字显示 (主显示行) */
static void line4_set(float value, data_type_e type) {
    ui.line4.raw_m = value;
    ui.line4.data_type = type;
    
    /* 转换并格式化 */
    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);
    float display_val = value * cfg.factor;
    
    /* 范围检查 */
    if (display_val > cfg.max) {
        strcpy(ui.line4.display, LINE_OL);
    } else {
        snprintf(ui.line4.display, 16, "%.*f", cfg.decimals, display_val);
    }
    
    /* 渲染到LCD */
    line4_render();
}

static void line4_set_str(const char* str) {
    strncpy(ui.line4.display, str, 15);
    ui.line4.display[15] = '\0';
    ui.line4.raw_m = 0;
    line4_render();
}

static const char* line4_get(void) {
    return ui.line4.display;
}

static void line4_render(void) {
    /* TODO: 根据配置渲染数字位和单位 */
    lcd_update();
}

/* 第3行数字显示 */
static void line3_set(float value, data_type_e type) {
    ui.line3.raw_m = value;
    ui.line3.data_type = type;
    
    /* 转换并格式化 */
    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);
    float display_val = value * cfg.factor;
    
    /* 范围检查 */
    if (display_val > cfg.max) {
        strcpy(ui.line3.display, LINE_OL);
    } else {
        snprintf(ui.line3.display, 16, "%.*f", cfg.decimals, display_val);
    }
    
    /* 渲染到LCD */
    line3_render();
}

static void line3_set_str(const char* str) {
    strncpy(ui.line3.display, str, 15);
    ui.line3.display[15] = '\0';
    ui.line3.raw_m = 0;
    line3_render();
}

static const char* line3_get(void) {
    return ui.line3.display;
}

static void line3_render(void) {
    /* TODO: 根据配置渲染数字位和单位 */
    lcd_update();
}

/* 第2行数字显示 */
static void line2_set(float value, data_type_e type) {
    ui.line2.raw_m = value;
    ui.line2.data_type = type;
    
    /* 转换并格式化 */
    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);
    float display_val = value * cfg.factor;
    
    /* 范围检查 */
    if (display_val > cfg.max) {
        strcpy(ui.line2.display, LINE_OL);
    } else {
        snprintf(ui.line2.display, 16, "%.*f", cfg.decimals, display_val);
    }
    
    /* 渲染到LCD */
    line2_render();
}

static void line2_set_str(const char* str) {
    strncpy(ui.line2.display, str, 15);
    ui.line2.display[15] = '\0';
    ui.line2.raw_m = 0;
    line2_render();
}

static const char* line2_get(void) {
    return ui.line2.display;
}

static void line2_render(void) {
    /* TODO: 根据配置渲染数字位和单位 */
    lcd_update();
}

/* 第1行数字显示 (顶部小字) */
static void line1_set(float value, data_type_e type) {
    ui.line1.raw_m = value;
    ui.line1.data_type = type;
    
    /* 转换并格式化 */
    unit_cfg_t cfg = unit_get_config(ui.unit.value, type);
    float display_val = value * cfg.factor;
    
    /* 范围检查 */
    if (display_val > cfg.max) {
        strcpy(ui.line1.display, LINE_OL);
    } else {
        snprintf(ui.line1.display, 16, "%.*f", cfg.decimals, display_val);
    }
    
    /* 渲染到LCD */
    line1_render();
}

static void line1_set_str(const char* str) {
    strncpy(ui.line1.display, str, 15);
    ui.line1.display[15] = '\0';
    ui.line1.raw_m = 0;
    line1_render();
}

static const char* line1_get(void) {
    return ui.line1.display;
}

static void line1_render(void) {
    /* TODO: 根据配置渲染数字位和单位 */
    lcd_update();
}

/* ========== Selector组件实现 ========== */

/* 单位选择 */
static void unit_set(uint8_t v) {
    ui.unit.value = v;
    ui_refresh_all_lines();
    unit_render();
}

static uint8_t unit_get(void) {
    return ui.unit.value;
}

static void unit_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_UNIT_M, 0);
    lcd_set_element(LCD_ELEM_UNIT_FT, 0);
    lcd_set_element(LCD_ELEM_UNIT_IN, 0);
    lcd_set_element(LCD_ELEM_UNIT_IN_MARK, 0);
    
    /* 打开当前选项元素 */
    switch (ui.unit.value) {
        case 0: /* M */
            lcd_set_element(LCD_ELEM_UNIT_M, 1);
            break;
        case 1: /* FT */
            lcd_set_element(LCD_ELEM_UNIT_FT, 1);
            break;
        case 2: /* IN */
            lcd_set_element(LCD_ELEM_UNIT_IN, 1);
            break;
        case 3: /* FT_IN */
            lcd_set_element(LCD_ELEM_UNIT_FT, 1);
            lcd_set_element(LCD_ELEM_UNIT_IN_MARK, 1);
            break;
    }
}

/* 电量指示 */
static void battery_set(uint8_t v) {
    ui.battery.value = v;
    
    /* onSet 联动 */
    switch (v) {
        case 0:
            anim_start_ex(ANIM_LOWBATTERYBLINK, 200, 3000);
            hw_Turn_off_the_device();
            break;
    }
    battery_render();
}

static uint8_t battery_get(void) {
    return ui.battery.value;
}

static void battery_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_BATTERY_GRID1, 0);
    lcd_set_element(LCD_ELEM_BATTERY_GRID2, 0);
    lcd_set_element(LCD_ELEM_BATTERY_GRID3, 0);
    lcd_set_element(LCD_ELEM_BATTERY_FRAME, 0);
    
    /* 框架元素（始终显示）*/
    lcd_set_element(LCD_ELEM_BATTERY_FRAME, 1);
    
    /* 打开当前选项元素 */
    switch (ui.battery.value) {
        case 0: /* EMPTY */
            break;
        case 1: /* LOW */
            lcd_set_element(LCD_ELEM_BATTERY_GRID1, 1);
            break;
        case 2: /* MID */
            lcd_set_element(LCD_ELEM_BATTERY_GRID1, 1);
            lcd_set_element(LCD_ELEM_BATTERY_GRID2, 1);
            break;
        case 3: /* FULL */
            lcd_set_element(LCD_ELEM_BATTERY_GRID1, 1);
            lcd_set_element(LCD_ELEM_BATTERY_GRID2, 1);
            lcd_set_element(LCD_ELEM_BATTERY_GRID3, 1);
            break;
    }
}

/* 信号强度 */
static void signal_set(uint8_t v) {
    ui.signal.value = v;
    signal_render();
}

static uint8_t signal_get(void) {
    return ui.signal.value;
}

static void signal_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_SIGNAL_1, 0);
    lcd_set_element(LCD_ELEM_SIGNAL_2, 0);
    lcd_set_element(LCD_ELEM_SIGNAL_3, 0);
    lcd_set_element(LCD_ELEM_SIGNAL_4, 0);
    lcd_set_element(LCD_ELEM_SIGNAL_5, 0);
    
    /* 打开当前选项元素 */
    switch (ui.signal.value) {
        case 0: /* L0 */
            break;
        case 1: /* L1 */
            lcd_set_element(LCD_ELEM_SIGNAL_1, 1);
            break;
        case 2: /* L2 */
            lcd_set_element(LCD_ELEM_SIGNAL_1, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_2, 1);
            break;
        case 3: /* L3 */
            lcd_set_element(LCD_ELEM_SIGNAL_1, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_2, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_3, 1);
            break;
        case 4: /* L4 */
            lcd_set_element(LCD_ELEM_SIGNAL_1, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_2, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_3, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_4, 1);
            break;
        case 5: /* L5 */
            lcd_set_element(LCD_ELEM_SIGNAL_1, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_2, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_3, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_4, 1);
            lcd_set_element(LCD_ELEM_SIGNAL_5, 1);
            break;
    }
}

/* 基准模式 */
static void base_set(uint8_t v) {
    ui.base.value = v;
    base_render();
}

static uint8_t base_get(void) {
    return ui.base.value;
}

static void base_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_BASE_S2, 0);
    lcd_set_element(LCD_ELEM_BASE_S20, 0);
    lcd_set_element(LCD_ELEM_BASE_S22, 0);
    lcd_set_element(LCD_ELEM_BASE_S25, 0);
    lcd_set_element(LCD_ELEM_BASE_S28, 0);
    
    /* 打开当前选项元素 */
    switch (ui.base.value) {
        case 0: /* FRONT */
            lcd_set_element(LCD_ELEM_BASE_S2, 1);
            lcd_set_element(LCD_ELEM_BASE_S20, 1);
            break;
        case 1: /* BEHIND */
            lcd_set_element(LCD_ELEM_BASE_S22, 1);
            lcd_set_element(LCD_ELEM_BASE_S2, 1);
            lcd_set_element(LCD_ELEM_BASE_S25, 1);
            lcd_set_element(LCD_ELEM_BASE_S28, 1);
            break;
    }
}

/* 蜂鸣器模式 */
static void beep_set(uint8_t v) {
    ui.beep.value = v;
    
    /* onSet 联动 */
    switch (v) {
        case 0:
            hw_beep_off();
            break;
        case 1:
            hw_beep_on();
            break;
    }
    beep_render();
}

static uint8_t beep_get(void) {
    return ui.beep.value;
}

static void beep_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_BEEP_OFF, 0);
    lcd_set_element(LCD_ELEM_BEEP_ON, 0);
    
    /* 打开当前选项元素 */
    switch (ui.beep.value) {
        case 0: /* OFF */
            lcd_set_element(LCD_ELEM_BEEP_OFF, 1);
            break;
        case 1: /* ON */
            lcd_set_element(LCD_ELEM_BEEP_ON, 1);
            break;
    }
}

/* 模式选择 */
static void mode_selection_set(uint8_t v) {
    ui.mode_selection.value = v;
    mode_selection_render();
}

static uint8_t mode_selection_get(void) {
    return ui.mode_selection.value;
}

static void mode_selection_render(void) {
    /* 关闭所有元素 */
    lcd_set_element(LCD_ELEM_MODE_S_2_X, 0);
    lcd_set_element(LCD_ELEM_MODE_S_2_Y, 0);
    lcd_set_element(LCD_ELEM_MODE_S_1_Y, 0);
    lcd_set_element(LCD_ELEM_MODE_S_1_X, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_Y1, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_X, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_Y2, 0);
    lcd_set_element(LCD_ELEM_MODE_S_1_Z, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_H, 0);
    lcd_set_element(LCD_ELEM_MODE_S_2_Z, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_W, 0);
    lcd_set_element(LCD_ELEM_MODE_S_3_Z, 0);
    lcd_set_element(LCD_ELEM_MODE_S_2_H, 0);
    lcd_set_element(LCD_ELEM_MODE_S_2_W, 0);
    
    /* 打开当前选项元素 */
    switch (ui.mode_selection.value) {
        case 0: /* SINGLE */
            break;
        case 1: /* CONTINUOUS */
            break;
        case 2: /* AREA */
            lcd_set_element(LCD_ELEM_MODE_S_2_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_Y, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_Y, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_X, 1);
            break;
        case 3: /* VOLUME */
            lcd_set_element(LCD_ELEM_MODE_S_3_Y1, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_Y2, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_Y, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_Y, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_Z, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_H, 1);
            break;
        case 4: /* PYTHAGOREAN1 */
            lcd_set_element(LCD_ELEM_MODE_S_1_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_Z, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_W, 1);
            break;
        case 5: /* PYTHAGOREAN2 */
            lcd_set_element(LCD_ELEM_MODE_S_1_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_Z, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_W, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_Z, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_H, 1);
            break;
        case 6: /* PYTHAGOREAN3 */
            lcd_set_element(LCD_ELEM_MODE_S_2_W, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_H, 1);
            lcd_set_element(LCD_ELEM_MODE_S_2_Z, 1);
            lcd_set_element(LCD_ELEM_MODE_S_1_X, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_W, 1);
            lcd_set_element(LCD_ELEM_MODE_S_3_Z, 1);
            break;
    }
}

/* ========== Icon组件实现 ========== */

/* 激光图标 */
static void laser_set(uint8_t v) {
    ui.laser.value = v;
    
    /* onSet 联动 */
    if (v) {
        anim_start_ex(ANIM_LASERBLINK, 300, 15000);
        hw_laser_on();
    } else {
        anim_stop(ANIM_LASERBLINK);
        hw_laser_off();
    }
    laser_render();
}

static uint8_t laser_get(void) {
    return ui.laser.value;
}

static void laser_render(void) {
    /* 设置图标元素 */
    lcd_set_element(LCD_ELEM_BASE_S19, ui.laser.value);
    lcd_set_element(LCD_ELEM_BASE_S1, ui.laser.value);
}

/* 蓝牙图标 */
static void bluetooth_set(uint8_t v) {
    ui.bluetooth.value = v;
    bluetooth_render();
}

static uint8_t bluetooth_get(void) {
    return ui.bluetooth.value;
}

static void bluetooth_render(void) {
    /* 设置图标元素 */
    lcd_set_element(LCD_ELEM_BLUETOOTH, ui.bluetooth.value);
}

/* WiFi图标 */
static void wifi_set(uint8_t v) {
    ui.wifi.value = v;
    wifi_render();
}

static uint8_t wifi_get(void) {
    return ui.wifi.value;
}

static void wifi_render(void) {
    /* 设置图标元素 */
    lcd_set_element(LCD_ELEM_WIFI, ui.wifi.value);
}

/* 测距仪图标 (常显) */
static void rangefinder_set(uint8_t v) {
    ui.rangefinder.value = v;
    rangefinder_render();
}

static uint8_t rangefinder_get(void) {
    return ui.rangefinder.value;
}

static void rangefinder_render(void) {
    /* 设置图标元素 */
    lcd_set_element(LCD_ELEM_BASE_S21, ui.rangefinder.value);
}

/* ========== 初始化 ========== */

void ui_init(void) {
    memset(&ui, 0, sizeof(ui));
    
    /* line4 */
    ui.line4.set = line4_set;
    ui.line4.set_str = line4_set_str;
    ui.line4.get = line4_get;
    strcpy(ui.line4.display, LINE_DASH);

    /* line3 */
    ui.line3.set = line3_set;
    ui.line3.set_str = line3_set_str;
    ui.line3.get = line3_get;
    strcpy(ui.line3.display, LINE_DASH);

    /* line2 */
    ui.line2.set = line2_set;
    ui.line2.set_str = line2_set_str;
    ui.line2.get = line2_get;
    strcpy(ui.line2.display, LINE_DASH);

    /* line1 */
    ui.line1.set = line1_set;
    ui.line1.set_str = line1_set_str;
    ui.line1.get = line1_get;
    strcpy(ui.line1.display, LINE_DASH);

    /* unit */
    ui.unit.set = unit_set;
    ui.unit.get = unit_get;
    ui.unit.value = 0;

    /* battery */
    ui.battery.set = battery_set;
    ui.battery.get = battery_get;
    ui.battery.value = 3;

    /* signal */
    ui.signal.set = signal_set;
    ui.signal.get = signal_get;
    ui.signal.value = 0;

    /* base */
    ui.base.set = base_set;
    ui.base.get = base_get;
    ui.base.value = 1;

    /* beep */
    ui.beep.set = beep_set;
    ui.beep.get = beep_get;
    ui.beep.value = 1;

    /* mode_selection */
    ui.mode_selection.set = mode_selection_set;
    ui.mode_selection.get = mode_selection_get;
    ui.mode_selection.value = 0;

    /* laser */
    ui.laser.set = laser_set;
    ui.laser.get = laser_get;
    ui.laser.value = 0;

    /* bluetooth */
    ui.bluetooth.set = bluetooth_set;
    ui.bluetooth.get = bluetooth_get;
    ui.bluetooth.value = 0;

    /* wifi */
    ui.wifi.set = wifi_set;
    ui.wifi.get = wifi_get;
    ui.wifi.value = 0;

    /* rangefinder */
    ui.rangefinder.set = rangefinder_set;
    ui.rangefinder.get = rangefinder_get;
    ui.rangefinder.value = 1;

}

/* 更新LCD */
void ui_update(void) {
    lcd_update();
}

/* 刷新所有Line (单位切换时调用) */
void ui_refresh_all_lines(void) {
    if (ui.line4.raw_m != 0) {
        ui.line4.set(ui.line4.raw_m, ui.line4.data_type);
    }
    if (ui.line3.raw_m != 0) {
        ui.line3.set(ui.line3.raw_m, ui.line3.data_type);
    }
    if (ui.line2.raw_m != 0) {
        ui.line2.set(ui.line2.raw_m, ui.line2.data_type);
    }
    if (ui.line1.raw_m != 0) {
        ui.line1.set(ui.line1.raw_m, ui.line1.data_type);
    }
}
