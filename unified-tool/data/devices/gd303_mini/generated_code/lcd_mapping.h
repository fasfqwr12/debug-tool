/**
 * @file    lcd_mapping.h
 * @brief   LCD段码映射定义 (自动生成)
 * @note    由SegLCD Studio生成，请勿手动修改
 * @date    2025-12-31
 */

#ifndef LCD_MAPPING_H
#define LCD_MAPPING_H

#include <stdint.h>

/* LCD硬件配置 */
#define LCD_SEG_COUNT   54
#define LCD_COM_COUNT   8
#define LCD_BUFFER_SIZE LCD_SEG_COUNT

/* 元素ID枚举 */
typedef enum {
    LCD_ELEM_LINE4_D1 = 0,
    LCD_ELEM_LINE4_D2 = 1,
    LCD_ELEM_LINE4_D3 = 2,
    LCD_ELEM_LINE4_D4 = 3,
    LCD_ELEM_LINE4_D5 = 4,
    LCD_ELEM_LINE4_DP1 = 5,
    LCD_ELEM_LINE4_DP2 = 6,
    LCD_ELEM_LINE4_DP3 = 7,
    LCD_ELEM_LINE4_UNIT_U0 = 8,
    LCD_ELEM_LINE4_UNIT_U1 = 9,
    LCD_ELEM_LINE4_UNIT_U2 = 10,
    LCD_ELEM_LINE4_EXP = 11,
    LCD_ELEM_LINE3_D1 = 12,
    LCD_ELEM_LINE3_D2 = 13,
    LCD_ELEM_LINE3_D3 = 14,
    LCD_ELEM_LINE3_D4 = 15,
    LCD_ELEM_LINE3_D5 = 16,
    LCD_ELEM_LINE3_DP1 = 17,
    LCD_ELEM_LINE3_DP2 = 18,
    LCD_ELEM_LINE3_DP3 = 19,
    LCD_ELEM_LINE3_UNIT_U0 = 20,
    LCD_ELEM_LINE3_UNIT_U1 = 21,
    LCD_ELEM_LINE3_UNIT_U2 = 22,
    LCD_ELEM_LINE2_D1 = 23,
    LCD_ELEM_LINE2_D2 = 24,
    LCD_ELEM_LINE2_D3 = 25,
    LCD_ELEM_LINE2_D4 = 26,
    LCD_ELEM_LINE2_D5 = 27,
    LCD_ELEM_LINE2_DP1 = 28,
    LCD_ELEM_LINE2_DP2 = 29,
    LCD_ELEM_LINE2_DP3 = 30,
    LCD_ELEM_LINE2_UNIT_U0 = 31,
    LCD_ELEM_LINE2_UNIT_U1 = 32,
    LCD_ELEM_LINE2_UNIT_U2 = 33,
    LCD_ELEM_LINE1_D1 = 34,
    LCD_ELEM_LINE1_D2 = 35,
    LCD_ELEM_LINE1_D3 = 36,
    LCD_ELEM_LINE1_D4 = 37,
    LCD_ELEM_LINE1_D5 = 38,
    LCD_ELEM_LINE1_DP1 = 39,
    LCD_ELEM_LINE1_DP2 = 40,
    LCD_ELEM_LINE1_DP3 = 41,
    LCD_ELEM_LINE1_UNIT_U0 = 42,
    LCD_ELEM_LINE1_UNIT_U1 = 43,
    LCD_ELEM_LINE1_UNIT_U2 = 44,
    LCD_ELEM_BATTERY_FRAME = 45,
    LCD_ELEM_BATTERY_GRID1 = 46,
    LCD_ELEM_BATTERY_GRID2 = 47,
    LCD_ELEM_BATTERY_GRID3 = 48,
    LCD_ELEM_BASE_S1 = 49,
    LCD_ELEM_BASE_S19 = 50,
    LCD_ELEM_BASE_S21 = 51,
    LCD_ELEM_BASE_S26 = 52,
    LCD_ELEM_BASE_S29 = 53,
    LCD_ELEM_BASE_S2 = 54,
    LCD_ELEM_BASE_S20 = 55,
    LCD_ELEM_BASE_S22 = 56,
    LCD_ELEM_BASE_S23 = 57,
    LCD_ELEM_BASE_S25 = 58,
    LCD_ELEM_BASE_S24 = 59,
    LCD_ELEM_BASE_S28 = 60,
    LCD_ELEM_BASE_S27 = 61,
    LCD_ELEM_BASE_S30 = 62,
    LCD_ELEM_MODE_S_1_W = 63,
    LCD_ELEM_MODE_S_1_X = 64,
    LCD_ELEM_MODE_S_1_Y = 65,
    LCD_ELEM_MODE_S_1_Z = 66,
    LCD_ELEM_MODE_S_2_H = 67,
    LCD_ELEM_MODE_S_2_W = 68,
    LCD_ELEM_MODE_S_2_X = 69,
    LCD_ELEM_MODE_S_2_Y = 70,
    LCD_ELEM_MODE_S_2_Z = 71,
    LCD_ELEM_MODE_S_3_H = 72,
    LCD_ELEM_MODE_S_3_X = 73,
    LCD_ELEM_MODE_S_3_Y1 = 74,
    LCD_ELEM_MODE_S_3_Y2 = 75,
    LCD_ELEM_MODE_S_3_W = 76,
    LCD_ELEM_MODE_S_3_Z = 77,
    LCD_ELEM_MODE_S_Q = 78,
    LCD_ELEM_MODE_S_ANGLE = 79,
    LCD_ELEM_BLUETOOTH = 80,
    LCD_ELEM_BEEP_ON = 81,
    LCD_ELEM_BEEP_OFF = 82,
    LCD_ELEM_SIGNAL_1 = 83,
    LCD_ELEM_SIGNAL_2 = 84,
    LCD_ELEM_SIGNAL_3 = 85,
    LCD_ELEM_SIGNAL_4 = 86,
    LCD_ELEM_SIGNAL_5 = 87,
    LCD_ELEM_WIFI = 88,
    LCD_ELEM_MAX_MIN = 89,
    LCD_ELEM_ANGLE_SYMBOL = 90,
    LCD_ELEM_ANGLE_MINUS = 91,
    LCD_ELEM_ANGLE_DP = 92,
    LCD_ELEM_ANGLE_TENS = 93,
    LCD_ELEM_ANGLE_ONES = 94,
    LCD_ELEM_ANGLE_DECIMAL = 95,
    LCD_ELEM_COUNT
} lcd_element_id_t;

/* 段定义结构 */
typedef struct {
    uint8_t seg;    /* SEG索引 (0-53) */
    uint8_t com;    /* COM索引 (0-7) */
} lcd_seg_def_t;

/* 元素定义结构 */
typedef struct {
    const char* name;           /* 元素名称 */
    uint8_t seg_count;          /* 段数量 */
    const lcd_seg_def_t* segs;  /* 段定义数组 */
} lcd_element_def_t;

/* 外部声明 */
extern const lcd_element_def_t lcd_elements[LCD_ELEM_COUNT];
extern uint8_t lcd_buffer[LCD_BUFFER_SIZE];

/* API函数 */
void lcd_mapping_init(void);
void lcd_set_segment(uint8_t seg, uint8_t com, uint8_t on);
uint8_t lcd_get_segment(uint8_t seg, uint8_t com);
void lcd_set_element(lcd_element_id_t elem_id, uint8_t on);
void lcd_clear_all(void);
void lcd_show_all(void);
void lcd_update(void);

#endif /* LCD_MAPPING_H */
