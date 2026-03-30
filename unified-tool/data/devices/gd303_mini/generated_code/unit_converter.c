/**
 * @file    unit_converter.c
 * @brief   单位转换模块实现 (自动生成)
 * @date    2025-12-31
 */

#include "unit_converter.h"
#include <math.h>

/* 单位配置表 [数据类型][单位] */
static const unit_cfg_t unit_configs[DATA_TYPE_COUNT][UNIT_COUNT] = {
    /* DATA_LENGTH */
    {
        { 1f, 3, 0.05f, 99.999f },   /* m */
        { 3.28084f, 3, 0.164f, 328.08f }, /* ft */
        { 39.3701f, 2, 1.97f, 3937f }, /* in */
    },
    /* DATA_AREA */
    {
        { 1f, 3, 0f, 999.99f },   /* m² */
        { 10.7639f, 2, 0f, 9999.9f }, /* ft² */
        { 1550.003f, 1, 0f, 99999f }, /* in² */
    },
    /* DATA_VOLUME */
    {
        { 1f, 3, 0f, 999.99f },   /* m³ */
        { 35.3147f, 2, 0f, 9999.9f }, /* ft³ */
        { 61023.744f, 0, 0f, 99999f }, /* in³ */
    },
};

/* 获取单位配置 */
unit_cfg_t unit_get_config(unit_e unit, data_type_e type) {
    if (unit >= UNIT_COUNT) unit = UNIT_M;
    if (type >= DATA_TYPE_COUNT) type = DATA_LENGTH;
    return unit_configs[type][unit];
}

/* 转换值 */
float unit_convert(float meters, unit_e unit, data_type_e type) {
    unit_cfg_t cfg = unit_get_config(unit, type);
    return meters * cfg.factor;
}

/* 获取小数位数 */
uint8_t unit_get_decimals(unit_e unit, data_type_e type) {
    unit_cfg_t cfg = unit_get_config(unit, type);
    return cfg.decimals;
}
