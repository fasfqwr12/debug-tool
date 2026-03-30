/**
 * @file    lcd_mapping.c
 * @brief   LCD段码映射实现 (自动生成)
 * @date    2025-12-31
 */

#include "lcd_mapping.h"
#include "drv_seg_lcd.h"  /* 底层LCD驱动 */

/* LCD缓冲区 */
uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* COM位映射: COM0=bit7, COM7=bit0 */
static const uint8_t com_bit_map[8] = {7, 6, 5, 4, 3, 2, 1, 0};

/* Line4_D1 段定义 */
static const lcd_seg_def_t line4_d1_segs[] = {
    { 23, 2 },  /* A */
    { 23, 4 },  /* B */
    { 23, 5 },  /* C */
    { 23, 1 },  /* D */
    { 23, 3 },  /* E */
    { 23, 6 },  /* F */
    { 23, 7 },  /* G */
};

/* Line4_D2 段定义 */
static const lcd_seg_def_t line4_d2_segs[] = {
    { 24, 0 },  /* A */
    { 24, 2 },  /* B */
    { 24, 7 },  /* C */
    { 24, 3 },  /* D */
    { 24, 5 },  /* E */
    { 24, 4 },  /* F */
    { 24, 6 },  /* G */
};

/* Line4_D3 段定义 */
static const lcd_seg_def_t line4_d3_segs[] = {
    { 25, 0 },  /* A */
    { 25, 2 },  /* B */
    { 25, 7 },  /* C */
    { 25, 3 },  /* D */
    { 25, 5 },  /* E */
    { 25, 4 },  /* F */
    { 25, 6 },  /* G */
};

/* Line4_D4 段定义 */
static const lcd_seg_def_t line4_d4_segs[] = {
    { 26, 0 },  /* A */
    { 26, 2 },  /* B */
    { 26, 7 },  /* C */
    { 26, 3 },  /* D */
    { 26, 5 },  /* E */
    { 26, 4 },  /* F */
    { 26, 6 },  /* G */
};

/* Line4_D5 段定义 */
static const lcd_seg_def_t line4_d5_segs[] = {
    { 27, 0 },  /* A */
    { 27, 2 },  /* B */
    { 27, 7 },  /* C */
    { 27, 3 },  /* D */
    { 27, 5 },  /* E */
    { 27, 4 },  /* F */
    { 27, 6 },  /* G */
};

/* Line4_DP1 段定义 */
static const lcd_seg_def_t line4_dp1_segs[] = {
    { 24, 1 },  /* DP */
};

/* Line4_DP2 段定义 */
static const lcd_seg_def_t line4_dp2_segs[] = {
    { 25, 1 },  /* DP */
};

/* Line4_DP3 段定义 */
static const lcd_seg_def_t line4_dp3_segs[] = {
    { 26, 1 },  /* DP */
};

/* Line4_Unit_U0 段定义 */
static const lcd_seg_def_t line4_unit_u0_segs[] = {
    { 27, 1 },  /* U0 */
};

/* Line4_Unit_U1 段定义 */
static const lcd_seg_def_t line4_unit_u1_segs[] = {
    { 28, 1 },  /* U1 */
    { 30, 1 },  /* U2 */
};

/* Line4_Unit_U2 段定义 */
static const lcd_seg_def_t line4_unit_u2_segs[] = {
    { 30, 1 },  /* U2 */
    { 31, 1 },  /* U3 */
};

/* Line4_Exp 段定义 */
static const lcd_seg_def_t line4_exp_segs[] = {
    { 31, 6 },  /* A */
    { 31, 7 },  /* B */
    { 31, 5 },  /* C */
    { 31, 3 },  /* D */
    { 30, 5 },  /* E */
    { 30, 6 },  /* F */
    { 30, 7 },  /* G */
};

/* Line3_D1 段定义 */
static const lcd_seg_def_t line3_d1_segs[] = {
    { 17, 3 },  /* A */
    { 17, 5 },  /* B */
    { 17, 4 },  /* C */
    { 17, 0 },  /* D */
    { 17, 2 },  /* E */
    { 17, 7 },  /* F */
    { 17, 6 },  /* G */
};

/* Line3_D2 段定义 */
static const lcd_seg_def_t line3_d2_segs[] = {
    { 18, 1 },  /* A */
    { 18, 3 },  /* B */
    { 18, 6 },  /* C */
    { 18, 2 },  /* D */
    { 18, 4 },  /* E */
    { 18, 5 },  /* F */
    { 18, 7 },  /* G */
};

/* Line3_D3 段定义 */
static const lcd_seg_def_t line3_d3_segs[] = {
    { 19, 1 },  /* A */
    { 19, 3 },  /* B */
    { 19, 6 },  /* C */
    { 19, 2 },  /* D */
    { 19, 4 },  /* E */
    { 19, 5 },  /* F */
    { 19, 7 },  /* G */
};

/* Line3_D4 段定义 */
static const lcd_seg_def_t line3_d4_segs[] = {
    { 20, 1 },  /* A */
    { 20, 3 },  /* B */
    { 20, 6 },  /* C */
    { 20, 2 },  /* D */
    { 20, 4 },  /* E */
    { 20, 5 },  /* F */
    { 20, 7 },  /* G */
};

/* Line3_D5 段定义 */
static const lcd_seg_def_t line3_d5_segs[] = {
    { 21, 3 },  /* A */
    { 21, 5 },  /* B */
    { 21, 4 },  /* C */
    { 21, 0 },  /* D */
    { 21, 2 },  /* E */
    { 21, 7 },  /* F */
    { 21, 6 },  /* G */
};

/* Line3_DP1 段定义 */
static const lcd_seg_def_t line3_dp1_segs[] = {
    { 18, 0 },  /* DP */
};

/* Line3_DP2 段定义 */
static const lcd_seg_def_t line3_dp2_segs[] = {
    { 19, 0 },  /* DP */
};

/* Line3_DP3 段定义 */
static const lcd_seg_def_t line3_dp3_segs[] = {
    { 20, 0 },  /* DP */
};

/* Line3_Unit_U0 段定义 */
static const lcd_seg_def_t line3_unit_u0_segs[] = {
    { 35, 6 },  /* U0 */
};

/* Line3_Unit_U1 段定义 */
static const lcd_seg_def_t line3_unit_u1_segs[] = {
    { 34, 4 },  /* U1 */
    { 33, 6 },  /* U2 */
};

/* Line3_Unit_U2 段定义 */
static const lcd_seg_def_t line3_unit_u2_segs[] = {
    { 33, 6 },  /* U2 */
    { 32, 6 },  /* U3 */
};

/* Line2_D1 段定义 */
static const lcd_seg_def_t line2_d1_segs[] = {
    { 36, 2 },  /* A */
    { 36, 4 },  /* B */
    { 36, 5 },  /* C */
    { 36, 1 },  /* D */
    { 36, 3 },  /* E */
    { 36, 6 },  /* F */
    { 36, 7 },  /* G */
};

/* Line2_D2 段定义 */
static const lcd_seg_def_t line2_d2_segs[] = {
    { 37, 0 },  /* A */
    { 37, 2 },  /* B */
    { 37, 7 },  /* C */
    { 37, 3 },  /* D */
    { 37, 5 },  /* E */
    { 37, 4 },  /* F */
    { 37, 6 },  /* G */
};

/* Line2_D3 段定义 */
static const lcd_seg_def_t line2_d3_segs[] = {
    { 38, 0 },  /* A */
    { 38, 2 },  /* B */
    { 38, 7 },  /* C */
    { 38, 3 },  /* D */
    { 38, 5 },  /* E */
    { 38, 4 },  /* F */
    { 38, 6 },  /* G */
};

/* Line2_D4 段定义 */
static const lcd_seg_def_t line2_d4_segs[] = {
    { 39, 0 },  /* A */
    { 39, 2 },  /* B */
    { 39, 7 },  /* C */
    { 39, 3 },  /* D */
    { 39, 5 },  /* E */
    { 39, 4 },  /* F */
    { 39, 6 },  /* G */
};

/* Line2_D5 段定义 */
static const lcd_seg_def_t line2_d5_segs[] = {
    { 40, 0 },  /* A */
    { 40, 2 },  /* B */
    { 40, 7 },  /* C */
    { 40, 3 },  /* D */
    { 40, 5 },  /* E */
    { 40, 4 },  /* F */
    { 40, 6 },  /* G */
};

/* Line2_DP1 段定义 */
static const lcd_seg_def_t line2_dp1_segs[] = {
    { 37, 1 },  /* DP */
};

/* Line2_DP2 段定义 */
static const lcd_seg_def_t line2_dp2_segs[] = {
    { 38, 1 },  /* DP */
};

/* Line2_DP3 段定义 */
static const lcd_seg_def_t line2_dp3_segs[] = {
    { 39, 1 },  /* DP */
};

/* Line2_Unit_U0 段定义 */
static const lcd_seg_def_t line2_unit_u0_segs[] = {
    { 40, 1 },  /* U0 */
};

/* Line2_Unit_U1 段定义 */
static const lcd_seg_def_t line2_unit_u1_segs[] = {
    { 41, 1 },  /* U1 */
    { 43, 1 },  /* U2 */
};

/* Line2_Unit_U2 段定义 */
static const lcd_seg_def_t line2_unit_u2_segs[] = {
    { 43, 1 },  /* U2 */
    { 44, 1 },  /* U3 */
};

/* Line1_D1 段定义 */
static const lcd_seg_def_t line1_d1_segs[] = {
    { 53, 1 },  /* A */
    { 53, 3 },  /* B */
    { 53, 6 },  /* C */
    { 53, 2 },  /* D */
    { 53, 4 },  /* E */
    { 53, 5 },  /* F */
    { 53, 7 },  /* G */
};

/* Line1_D2 段定义 */
static const lcd_seg_def_t line1_d2_segs[] = {
    { 52, 1 },  /* A */
    { 52, 3 },  /* B */
    { 52, 6 },  /* C */
    { 52, 2 },  /* D */
    { 52, 4 },  /* E */
    { 52, 5 },  /* F */
    { 52, 7 },  /* G */
};

/* Line1_D3 段定义 */
static const lcd_seg_def_t line1_d3_segs[] = {
    { 51, 3 },  /* A */
    { 51, 5 },  /* B */
    { 51, 4 },  /* C */
    { 51, 0 },  /* D */
    { 51, 2 },  /* E */
    { 51, 7 },  /* F */
    { 51, 6 },  /* G */
};

/* Line1_D4 段定义 */
static const lcd_seg_def_t line1_d4_segs[] = {
    { 50, 1 },  /* A */
    { 50, 3 },  /* B */
    { 50, 6 },  /* C */
    { 50, 2 },  /* D */
    { 50, 4 },  /* E */
    { 50, 5 },  /* F */
    { 50, 7 },  /* G */
};

/* Line1_D5 段定义 */
static const lcd_seg_def_t line1_d5_segs[] = {
    { 49, 3 },  /* A */
    { 49, 5 },  /* B */
    { 49, 4 },  /* C */
    { 49, 0 },  /* D */
    { 49, 2 },  /* E */
    { 49, 7 },  /* F */
    { 49, 6 },  /* G */
};

/* Line1_DP1 段定义 */
static const lcd_seg_def_t line1_dp1_segs[] = {
    { 52, 0 },  /* DP */
};

/* Line1_DP2 段定义 */
static const lcd_seg_def_t line1_dp2_segs[] = {
    { 53, 0 },  /* DP */
};

/* Line1_DP3 段定义 */
static const lcd_seg_def_t line1_dp3_segs[] = {
    { 50, 0 },  /* DP */
};

/* Line1_Unit_U0 段定义 */
static const lcd_seg_def_t line1_unit_u0_segs[] = {
    { 48, 6 },  /* U0 */
};

/* Line1_Unit_U1 段定义 */
static const lcd_seg_def_t line1_unit_u1_segs[] = {
    { 47, 4 },  /* U1 */
    { 46, 6 },  /* U2 */
};

/* Line1_Unit_U2 段定义 */
static const lcd_seg_def_t line1_unit_u2_segs[] = {
    { 46, 6 },  /* U2 */
    { 45, 6 },  /* U3 */
};

/* Battery_Frame 段定义 */
static const lcd_seg_def_t battery_frame_segs[] = {
    { 6, 5 },  /* s8 */
};

/* Battery_Grid1 段定义 */
static const lcd_seg_def_t battery_grid1_segs[] = {
    { 9, 5 },  /* s5 */
};

/* Battery_Grid2 段定义 */
static const lcd_seg_def_t battery_grid2_segs[] = {
    { 8, 5 },  /* s6 */
};

/* Battery_Grid3 段定义 */
static const lcd_seg_def_t battery_grid3_segs[] = {
    { 6, 3 },  /* s7 */
};

/* Base_s1 段定义 */
static const lcd_seg_def_t base_s1_segs[] = {
    { 7, 7 },  /* s1 */
};

/* Base_s19 段定义 */
static const lcd_seg_def_t base_s19_segs[] = {
    { 7, 6 },  /* s19 */
};

/* Base_s21 段定义 */
static const lcd_seg_def_t base_s21_segs[] = {
    { 7, 4 },  /* s21 */
};

/* Base_s26 段定义 */
static const lcd_seg_def_t base_s26_segs[] = {
    { 7, 2 },  /* s26 */
};

/* Base_s29 段定义 */
static const lcd_seg_def_t base_s29_segs[] = {
    { 7, 0 },  /* s29 */
};

/* Base_s2 段定义 */
static const lcd_seg_def_t base_s2_segs[] = {
    { 8, 7 },  /* s2 */
};

/* Base_s20 段定义 */
static const lcd_seg_def_t base_s20_segs[] = {
    { 8, 6 },  /* s20 */
};

/* Base_s22 段定义 */
static const lcd_seg_def_t base_s22_segs[] = {
    { 9, 6 },  /* s22 */
};

/* Base_s23 段定义 */
static const lcd_seg_def_t base_s23_segs[] = {
    { 8, 4 },  /* s23 */
};

/* Base_s25 段定义 */
static const lcd_seg_def_t base_s25_segs[] = {
    { 9, 4 },  /* s25 */
};

/* Base_s24 段定义 */
static const lcd_seg_def_t base_s24_segs[] = {
    { 8, 2 },  /* s24 */
};

/* Base_s28 段定义 */
static const lcd_seg_def_t base_s28_segs[] = {
    { 9, 2 },  /* s28 */
};

/* Base_s27 段定义 */
static const lcd_seg_def_t base_s27_segs[] = {
    { 8, 0 },  /* s27 */
};

/* Base_s30 段定义 */
static const lcd_seg_def_t base_s30_segs[] = {
    { 9, 0 },  /* s30 */
};

/* Mode_s_1_w 段定义 */
static const lcd_seg_def_t mode_s_1_w_segs[] = {
    { 13, 4 },  /* s_1_w */
};

/* Mode_s_1_x 段定义 */
static const lcd_seg_def_t mode_s_1_x_segs[] = {
    { 14, 2 },  /* s_1_x */
};

/* Mode_s_1_y 段定义 */
static const lcd_seg_def_t mode_s_1_y_segs[] = {
    { 11, 6 },  /* s_1_y */
};

/* Mode_s_1_z 段定义 */
static const lcd_seg_def_t mode_s_1_z_segs[] = {
    { 11, 7 },  /* s_1_z */
};

/* Mode_s_2_h 段定义 */
static const lcd_seg_def_t mode_s_2_h_segs[] = {
    { 15, 7 },  /* s_2_h */
};

/* Mode_s_2_w 段定义 */
static const lcd_seg_def_t mode_s_2_w_segs[] = {
    { 15, 5 },  /* s_2_w */
};

/* Mode_s_2_x 段定义 */
static const lcd_seg_def_t mode_s_2_x_segs[] = {
    { 13, 2 },  /* s_2_x */
};

/* Mode_s_2_y 段定义 */
static const lcd_seg_def_t mode_s_2_y_segs[] = {
    { 13, 0 },  /* s_2_y */
};

/* Mode_s_2_z 段定义 */
static const lcd_seg_def_t mode_s_2_z_segs[] = {
    { 14, 4 },  /* s_2_z */
};

/* Mode_s_3_h 段定义 */
static const lcd_seg_def_t mode_s_3_h_segs[] = {
    { 11, 4 },  /* s_3_h */
};

/* Mode_s_3_x 段定义 */
static const lcd_seg_def_t mode_s_3_x_segs[] = {
    { 12, 2 },  /* s_3_x */
};

/* Mode_s_3_y1 段定义 */
static const lcd_seg_def_t mode_s_3_y1_segs[] = {
    { 12, 0 },  /* s_3_y1 */
};

/* Mode_s_3_y2 段定义 */
static const lcd_seg_def_t mode_s_3_y2_segs[] = {
    { 11, 2 },  /* s_3_y2 */
};

/* Mode_s_3_w 段定义 */
static const lcd_seg_def_t mode_s_3_w_segs[] = {
    { 14, 6 },  /* s_3_w */
};

/* Mode_s_3_z 段定义 */
static const lcd_seg_def_t mode_s_3_z_segs[] = {
    { 15, 6 },  /* s_3_z */
};

/* Mode_s_q 段定义 */
static const lcd_seg_def_t mode_s_q_segs[] = {
    { 13, 6 },  /* s_q */
};

/* Mode_s_angle 段定义 */
static const lcd_seg_def_t mode_s_angle_segs[] = {
    { 13, 7 },  /* s_angle */
};

/* Bluetooth 段定义 */
static const lcd_seg_def_t bluetooth_segs[] = {
    { 10, 7 },  /* BT */
};

/* Beep_On 段定义 */
static const lcd_seg_def_t beep_on_segs[] = {
    { 10, 5 },  /* beep_on */
};

/* Beep_Off 段定义 */
static const lcd_seg_def_t beep_off_segs[] = {
    { 9, 7 },  /* beep_off */
};

/* Signal_1 段定义 */
static const lcd_seg_def_t signal_1_segs[] = {
    { 0, 4 },  /* sig1 */
};

/* Signal_2 段定义 */
static const lcd_seg_def_t signal_2_segs[] = {
    { 0, 6 },  /* sig2 */
};

/* Signal_3 段定义 */
static const lcd_seg_def_t signal_3_segs[] = {
    { 0, 7 },  /* sig3 */
};

/* Signal_4 段定义 */
static const lcd_seg_def_t signal_4_segs[] = {
    { 0, 5 },  /* sig4 */
};

/* Signal_5 段定义 */
static const lcd_seg_def_t signal_5_segs[] = {
    { 0, 3 },  /* sig5 */
};

/* WiFi 段定义 */
static const lcd_seg_def_t wifi_segs[] = {
    { 0, 2 },  /* wifi */
};

/* MAX_MIN 段定义 */
static const lcd_seg_def_t max_min_segs[] = {
    { 11, 0 },  /* max */
    { 14, 7 },  /* min */
};

/* Angle_Symbol 段定义 */
static const lcd_seg_def_t angle_symbol_segs[] = {
    { 0, 0 },  /* deg */
};

/* Angle_Minus 段定义 */
static const lcd_seg_def_t angle_minus_segs[] = {
    { 6, 6 },  /* minus */
};

/* Angle_DP 段定义 */
static const lcd_seg_def_t angle_dp_segs[] = {
    { 2, 6 },  /* dp */
};

/* Angle_Tens 段定义 */
static const lcd_seg_def_t angle_tens_segs[] = {
    { 5, 0 },  /* A */
    { 5, 2 },  /* B */
    { 5, 4 },  /* C */
    { 5, 6 },  /* D */
    { 6, 4 },  /* E */
    { 6, 0 },  /* F */
    { 6, 2 },  /* G */
};

/* Angle_Ones 段定义 */
static const lcd_seg_def_t angle_ones_segs[] = {
    { 3, 0 },  /* A */
    { 3, 2 },  /* B */
    { 3, 4 },  /* C */
    { 3, 6 },  /* D */
    { 4, 4 },  /* E */
    { 4, 0 },  /* F */
    { 4, 2 },  /* G */
};

/* Angle_Decimal 段定义 */
static const lcd_seg_def_t angle_decimal_segs[] = {
    { 1, 0 },  /* A */
    { 1, 2 },  /* B */
    { 1, 4 },  /* C */
    { 1, 6 },  /* D */
    { 2, 4 },  /* E */
    { 2, 0 },  /* F */
    { 2, 2 },  /* G */
};

/* 元素定义表 */
const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT] = {
    [LCD_ELEM_LINE4_D1] = { "Line4_D1", 7, line4_d1_segs },
    [LCD_ELEM_LINE4_D2] = { "Line4_D2", 7, line4_d2_segs },
    [LCD_ELEM_LINE4_D3] = { "Line4_D3", 7, line4_d3_segs },
    [LCD_ELEM_LINE4_D4] = { "Line4_D4", 7, line4_d4_segs },
    [LCD_ELEM_LINE4_D5] = { "Line4_D5", 7, line4_d5_segs },
    [LCD_ELEM_LINE4_DP1] = { "Line4_DP1", 1, line4_dp1_segs },
    [LCD_ELEM_LINE4_DP2] = { "Line4_DP2", 1, line4_dp2_segs },
    [LCD_ELEM_LINE4_DP3] = { "Line4_DP3", 1, line4_dp3_segs },
    [LCD_ELEM_LINE4_UNIT_U0] = { "Line4_Unit_U0", 1, line4_unit_u0_segs },
    [LCD_ELEM_LINE4_UNIT_U1] = { "Line4_Unit_U1", 2, line4_unit_u1_segs },
    [LCD_ELEM_LINE4_UNIT_U2] = { "Line4_Unit_U2", 2, line4_unit_u2_segs },
    [LCD_ELEM_LINE4_EXP] = { "Line4_Exp", 7, line4_exp_segs },
    [LCD_ELEM_LINE3_D1] = { "Line3_D1", 7, line3_d1_segs },
    [LCD_ELEM_LINE3_D2] = { "Line3_D2", 7, line3_d2_segs },
    [LCD_ELEM_LINE3_D3] = { "Line3_D3", 7, line3_d3_segs },
    [LCD_ELEM_LINE3_D4] = { "Line3_D4", 7, line3_d4_segs },
    [LCD_ELEM_LINE3_D5] = { "Line3_D5", 7, line3_d5_segs },
    [LCD_ELEM_LINE3_DP1] = { "Line3_DP1", 1, line3_dp1_segs },
    [LCD_ELEM_LINE3_DP2] = { "Line3_DP2", 1, line3_dp2_segs },
    [LCD_ELEM_LINE3_DP3] = { "Line3_DP3", 1, line3_dp3_segs },
    [LCD_ELEM_LINE3_UNIT_U0] = { "Line3_Unit_U0", 1, line3_unit_u0_segs },
    [LCD_ELEM_LINE3_UNIT_U1] = { "Line3_Unit_U1", 2, line3_unit_u1_segs },
    [LCD_ELEM_LINE3_UNIT_U2] = { "Line3_Unit_U2", 2, line3_unit_u2_segs },
    [LCD_ELEM_LINE2_D1] = { "Line2_D1", 7, line2_d1_segs },
    [LCD_ELEM_LINE2_D2] = { "Line2_D2", 7, line2_d2_segs },
    [LCD_ELEM_LINE2_D3] = { "Line2_D3", 7, line2_d3_segs },
    [LCD_ELEM_LINE2_D4] = { "Line2_D4", 7, line2_d4_segs },
    [LCD_ELEM_LINE2_D5] = { "Line2_D5", 7, line2_d5_segs },
    [LCD_ELEM_LINE2_DP1] = { "Line2_DP1", 1, line2_dp1_segs },
    [LCD_ELEM_LINE2_DP2] = { "Line2_DP2", 1, line2_dp2_segs },
    [LCD_ELEM_LINE2_DP3] = { "Line2_DP3", 1, line2_dp3_segs },
    [LCD_ELEM_LINE2_UNIT_U0] = { "Line2_Unit_U0", 1, line2_unit_u0_segs },
    [LCD_ELEM_LINE2_UNIT_U1] = { "Line2_Unit_U1", 2, line2_unit_u1_segs },
    [LCD_ELEM_LINE2_UNIT_U2] = { "Line2_Unit_U2", 2, line2_unit_u2_segs },
    [LCD_ELEM_LINE1_D1] = { "Line1_D1", 7, line1_d1_segs },
    [LCD_ELEM_LINE1_D2] = { "Line1_D2", 7, line1_d2_segs },
    [LCD_ELEM_LINE1_D3] = { "Line1_D3", 7, line1_d3_segs },
    [LCD_ELEM_LINE1_D4] = { "Line1_D4", 7, line1_d4_segs },
    [LCD_ELEM_LINE1_D5] = { "Line1_D5", 7, line1_d5_segs },
    [LCD_ELEM_LINE1_DP1] = { "Line1_DP1", 1, line1_dp1_segs },
    [LCD_ELEM_LINE1_DP2] = { "Line1_DP2", 1, line1_dp2_segs },
    [LCD_ELEM_LINE1_DP3] = { "Line1_DP3", 1, line1_dp3_segs },
    [LCD_ELEM_LINE1_UNIT_U0] = { "Line1_Unit_U0", 1, line1_unit_u0_segs },
    [LCD_ELEM_LINE1_UNIT_U1] = { "Line1_Unit_U1", 2, line1_unit_u1_segs },
    [LCD_ELEM_LINE1_UNIT_U2] = { "Line1_Unit_U2", 2, line1_unit_u2_segs },
    [LCD_ELEM_BATTERY_FRAME] = { "Battery_Frame", 1, battery_frame_segs },
    [LCD_ELEM_BATTERY_GRID1] = { "Battery_Grid1", 1, battery_grid1_segs },
    [LCD_ELEM_BATTERY_GRID2] = { "Battery_Grid2", 1, battery_grid2_segs },
    [LCD_ELEM_BATTERY_GRID3] = { "Battery_Grid3", 1, battery_grid3_segs },
    [LCD_ELEM_BASE_S1] = { "Base_s1", 1, base_s1_segs },
    [LCD_ELEM_BASE_S19] = { "Base_s19", 1, base_s19_segs },
    [LCD_ELEM_BASE_S21] = { "Base_s21", 1, base_s21_segs },
    [LCD_ELEM_BASE_S26] = { "Base_s26", 1, base_s26_segs },
    [LCD_ELEM_BASE_S29] = { "Base_s29", 1, base_s29_segs },
    [LCD_ELEM_BASE_S2] = { "Base_s2", 1, base_s2_segs },
    [LCD_ELEM_BASE_S20] = { "Base_s20", 1, base_s20_segs },
    [LCD_ELEM_BASE_S22] = { "Base_s22", 1, base_s22_segs },
    [LCD_ELEM_BASE_S23] = { "Base_s23", 1, base_s23_segs },
    [LCD_ELEM_BASE_S25] = { "Base_s25", 1, base_s25_segs },
    [LCD_ELEM_BASE_S24] = { "Base_s24", 1, base_s24_segs },
    [LCD_ELEM_BASE_S28] = { "Base_s28", 1, base_s28_segs },
    [LCD_ELEM_BASE_S27] = { "Base_s27", 1, base_s27_segs },
    [LCD_ELEM_BASE_S30] = { "Base_s30", 1, base_s30_segs },
    [LCD_ELEM_MODE_S_1_W] = { "Mode_s_1_w", 1, mode_s_1_w_segs },
    [LCD_ELEM_MODE_S_1_X] = { "Mode_s_1_x", 1, mode_s_1_x_segs },
    [LCD_ELEM_MODE_S_1_Y] = { "Mode_s_1_y", 1, mode_s_1_y_segs },
    [LCD_ELEM_MODE_S_1_Z] = { "Mode_s_1_z", 1, mode_s_1_z_segs },
    [LCD_ELEM_MODE_S_2_H] = { "Mode_s_2_h", 1, mode_s_2_h_segs },
    [LCD_ELEM_MODE_S_2_W] = { "Mode_s_2_w", 1, mode_s_2_w_segs },
    [LCD_ELEM_MODE_S_2_X] = { "Mode_s_2_x", 1, mode_s_2_x_segs },
    [LCD_ELEM_MODE_S_2_Y] = { "Mode_s_2_y", 1, mode_s_2_y_segs },
    [LCD_ELEM_MODE_S_2_Z] = { "Mode_s_2_z", 1, mode_s_2_z_segs },
    [LCD_ELEM_MODE_S_3_H] = { "Mode_s_3_h", 1, mode_s_3_h_segs },
    [LCD_ELEM_MODE_S_3_X] = { "Mode_s_3_x", 1, mode_s_3_x_segs },
    [LCD_ELEM_MODE_S_3_Y1] = { "Mode_s_3_y1", 1, mode_s_3_y1_segs },
    [LCD_ELEM_MODE_S_3_Y2] = { "Mode_s_3_y2", 1, mode_s_3_y2_segs },
    [LCD_ELEM_MODE_S_3_W] = { "Mode_s_3_w", 1, mode_s_3_w_segs },
    [LCD_ELEM_MODE_S_3_Z] = { "Mode_s_3_z", 1, mode_s_3_z_segs },
    [LCD_ELEM_MODE_S_Q] = { "Mode_s_q", 1, mode_s_q_segs },
    [LCD_ELEM_MODE_S_ANGLE] = { "Mode_s_angle", 1, mode_s_angle_segs },
    [LCD_ELEM_BLUETOOTH] = { "Bluetooth", 1, bluetooth_segs },
    [LCD_ELEM_BEEP_ON] = { "Beep_On", 1, beep_on_segs },
    [LCD_ELEM_BEEP_OFF] = { "Beep_Off", 1, beep_off_segs },
    [LCD_ELEM_SIGNAL_1] = { "Signal_1", 1, signal_1_segs },
    [LCD_ELEM_SIGNAL_2] = { "Signal_2", 1, signal_2_segs },
    [LCD_ELEM_SIGNAL_3] = { "Signal_3", 1, signal_3_segs },
    [LCD_ELEM_SIGNAL_4] = { "Signal_4", 1, signal_4_segs },
    [LCD_ELEM_SIGNAL_5] = { "Signal_5", 1, signal_5_segs },
    [LCD_ELEM_WIFI] = { "WiFi", 1, wifi_segs },
    [LCD_ELEM_MAX_MIN] = { "MAX_MIN", 2, max_min_segs },
    [LCD_ELEM_ANGLE_SYMBOL] = { "Angle_Symbol", 1, angle_symbol_segs },
    [LCD_ELEM_ANGLE_MINUS] = { "Angle_Minus", 1, angle_minus_segs },
    [LCD_ELEM_ANGLE_DP] = { "Angle_DP", 1, angle_dp_segs },
    [LCD_ELEM_ANGLE_TENS] = { "Angle_Tens", 7, angle_tens_segs },
    [LCD_ELEM_ANGLE_ONES] = { "Angle_Ones", 7, angle_ones_segs },
    [LCD_ELEM_ANGLE_DECIMAL] = { "Angle_Decimal", 7, angle_decimal_segs },
};

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
