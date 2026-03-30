/**
 * @file    unit_converter.h
 * @brief   单位转换模块 (自动生成)
 * @note    存储原始值(米)，显示时转换
 * @date    2025-12-31
 */

#ifndef UNIT_CONVERTER_H
#define UNIT_CONVERTER_H

#include <stdint.h>

/* 单位索引 */
typedef enum {
    UNIT_M = 0,     /* 米 */
    UNIT_FT = 1,    /* 英尺 */
    UNIT_IN = 2,    /* 英寸 */
    UNIT_COUNT
} unit_e;

/* 数据类型 */
typedef enum {
    DATA_LENGTH = 0,
    DATA_AREA = 1,
    DATA_VOLUME = 2,
    DATA_TYPE_COUNT
} data_type_e;

/* 单位配置 */
typedef struct {
    float factor;       /* 转换系数 */
    uint8_t decimals;   /* 小数位数 */
    float min;          /* 最小值 */
    float max;          /* 最大值 */
} unit_cfg_t;

/* API函数 */
unit_cfg_t unit_get_config(unit_e unit, data_type_e type);
float unit_convert(float meters, unit_e unit, data_type_e type);
uint8_t unit_get_decimals(unit_e unit, data_type_e type);

#endif /* UNIT_CONVERTER_H */
