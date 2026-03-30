/**
 * @file    ui_presets.c
 * @brief   界面预设实现 (自动生成)
 * @date    2025-12-31
 */

#include "ui_presets.h"
#include "lcd_components.h"
#include "lcd_mapping.h"
#include "ui_animation.h"

/* 应用预设 */
void ui_apply_preset(ui_preset_id_t preset_id) {
    switch (preset_id) {
    case PRESET_BOOT_INIT:
        /* 开机初始化: 开机后的初始界面，显示----- */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        lcd_comp_set_value(COMP_LINE1, "");
        lcd_comp_set_value(COMP_BATTERY, "3");
        lcd_comp_set_value(COMP_BEEP, "1");
        lcd_comp_set_value(COMP_BASE, "1");
        break;

    case PRESET_UNIT_SELECT:
        /* 单位选择中: 开机单位选择状态，单位闪烁提示 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        lcd_comp_set_value(COMP_LINE1, "");
        lcd_comp_set_value(COMP_BATTERY, "3");
        ui_anim_start(ANIM_UNITSELECTANIM);
        break;

    case PRESET_BOOT_COMPLETE:
        /* 开机完成: 开机流程完成，进入正常待机状态 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        lcd_comp_set_value(COMP_LINE1, "");
        lcd_comp_set_value(COMP_BATTERY, "3");
        lcd_comp_set_value(COMP_SIGNAL, "0");
        lcd_comp_set_value(COMP_BASE, "1");
        break;

    case PRESET_SINGLE_IDLE:
        /* 单次待机: 单次测量模式，激光关闭，显示----- */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        lcd_comp_set_value(COMP_LINE1, "");
        lcd_comp_set_value(COMP_BASE, "1");
        break;

    case PRESET_SINGLE_LASER_ON:
        /* 单次激光开: 单次测量模式，激光开启等待测量 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_SINGLE_RESULT:
        /* 单次结果: 单次测量完成，Line4显示测量结果 */
        lcd_comp_set_value(COMP_SIGNAL, "3");
        break;

    case PRESET_CONTINUOUS_IDLE:
        /* 连续待机: 连续测量模式初始界面 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_show_preset(COMP_LINE3, "dash");
        lcd_comp_show_preset(COMP_LINE2, "dash");
        break;

    case PRESET_CONTINUOUS_MEASURING:
        /* 连续测量中: 连续测量中，显示MAX/MIN/当前值 */
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_AREA_IDLE:
        /* 面积待机: 面积测量模式，等待开始 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        break;

    case PRESET_AREA_STEP1:
        /* 面积步骤1: 面积测量，等待测量第一边(长) */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_AREA_STEP1_DONE:
        /* 面积步骤1完成: 面积测量，第一边测量完成，等待第二边 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_AREA_STEP2:
        /* 面积步骤2: 面积测量，等待测量第二边(宽) */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        ui_anim_start(ANIM_AREASIDE2BLINK);
        break;

    case PRESET_AREA_RESULT:
        /* 面积结果: 面积测量完成，显示长、宽、面积 */
        break;

    case PRESET_VOLUME_IDLE:
        /* 体积待机: 体积测量模式，等待开始 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        break;

    case PRESET_VOLUME_STEP1:
        /* 体积步骤1: 体积测量，等待测量第一边(长) */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_VOLUME_STEP2:
        /* 体积步骤2: 体积测量，等待测量第二边(宽) */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_VOLUME_STEP3:
        /* 体积步骤3: 体积测量，等待测量第三边(高) */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        ui_anim_start(ANIM_LASERBLINK);
        break;

    case PRESET_VOLUME_RESULT:
        /* 体积结果: 体积测量完成，显示长、宽、高、体积 */
        break;

    case PRESET_PYTH_IDLE:
        /* 勾股待机: 勾股定理测量模式 */
        lcd_comp_show_preset(COMP_LINE4, "dash");
        break;

    case PRESET_ERROR_DISPLAY:
        /* 错误显示: 测量错误界面，显示Err */
        lcd_comp_show_preset(COMP_LINE4, "error");
        break;

    case PRESET_CHARGING:
        /* 充电中: 充电状态界面 */
        lcd_comp_set_value(COMP_LINE4, "");
        lcd_comp_set_value(COMP_LINE3, "");
        lcd_comp_set_value(COMP_LINE2, "");
        lcd_comp_set_value(COMP_LINE1, "");
        ui_anim_start(ANIM_CHARGINGANIM);
        break;

    case PRESET_LOW_BATTERY:
        /* 低电量: 低电量警告界面 */
        lcd_comp_set_value(COMP_BATTERY, "0");
        ui_anim_start(ANIM_LOWBATTERYBLINK);
        break;

    case PRESET_BLUETOOTH_PAIRING:
        /* 蓝牙配对: 蓝牙搜索配对中 */
        ui_anim_start(ANIM_BLUETOOTHBLINK);
        break;

    case PRESET_WIFI_CONNECTING:
        /* WiFi连接中: WiFi连接中 */
        ui_anim_start(ANIM_WIFIBLINK);
        break;

    case PRESET_FULL_DISPLAY:
        /* 全显测试: LCD全显测试，点亮所有段码 */
        break;

    case PRESET_CLEAR_DISPLAY:
        /* 清屏: LCD清屏，熄灭所有段码 */
        break;

    default:
        break;
    }
    
    lcd_update();
}
