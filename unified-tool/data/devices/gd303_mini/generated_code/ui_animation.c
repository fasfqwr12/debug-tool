/**
 * @file    ui_animation.c
 * @brief   动画控制器实现 (自动生成)
 * @date    2025-12-31
 */

#include "ui_animation.h"
#include "ui_controller.h"
#include <string.h>

/* ========== 帧数据结构 ========== */
typedef struct {
    uint16_t duration;      /* 持续时间(ms) */
    void (*apply)(void);    /* 帧动作函数 */
} anim_frame_t;

/* ========== 动画配置 ========== */
typedef struct {
    const anim_frame_t* frames;
    uint8_t frame_count;
    uint8_t loop;           /* 1=循环, 0=播放一次自动停止 */
} anim_config_t;

/* ========== 动画状态 ========== */
typedef struct {
    uint8_t running;        /* 是否运行 */
    uint8_t frame_idx;      /* 当前帧索引 */
    uint16_t tick_count;    /* 帧计时器(ms) */
    uint16_t interval_ms;   /* 运行时间隔（0=用配置值）*/
    uint16_t timeout_ms;    /* 超时时间（0=不超时）*/
    uint32_t total_time;    /* 已运行总时间(ms) */
} anim_state_t;

/* ========== 动画控制器 ========== */
static anim_state_t anim_states[ANIM_COUNT];

static void laserblink_frame0(void) {
    ui.laser.set(ICON_ON);
}

static void laserblink_frame1(void) {
    ui.laser.set(ICON_OFF);
}

static const anim_frame_t laserblink_frames[] = {
    { 300, laserblink_frame0 },
    { 300, laserblink_frame1 },
};

static void bluetoothblink_frame0(void) {
    ui.bluetooth.set(ICON_ON);
}

static void bluetoothblink_frame1(void) {
    ui.bluetooth.set(ICON_OFF);
}

static const anim_frame_t bluetoothblink_frames[] = {
    { 500, bluetoothblink_frame0 },
    { 500, bluetoothblink_frame1 },
};

static void wifiblink_frame0(void) {
    ui.wifi.set(ICON_ON);
}

static void wifiblink_frame1(void) {
    ui.wifi.set(ICON_OFF);
}

static const anim_frame_t wifiblink_frames[] = {
    { 500, wifiblink_frame0 },
    { 500, wifiblink_frame1 },
};

static void charginganim_frame0(void) {
    ui.battery.set(1);
}

static void charginganim_frame1(void) {
    ui.battery.set(2);
}

static void charginganim_frame2(void) {
    ui.battery.set(3);
}

static void charginganim_frame3(void) {
    ui.battery.set(0);
}

static const anim_frame_t charginganim_frames[] = {
    { 250, charginganim_frame0 },
    { 250, charginganim_frame1 },
    { 250, charginganim_frame2 },
    { 250, charginganim_frame3 },
};

static void lowbatteryblink_frame0(void) {
    ui.battery.set(0);
}

static void lowbatteryblink_frame1(void) {
}

static const anim_frame_t lowbatteryblink_frames[] = {
    { 200, lowbatteryblink_frame0 },
    { 200, lowbatteryblink_frame1 },
};

static void basefrontblink_frame0(void) {
    ui.base.set(0);
}

static void basefrontblink_frame1(void) {
}

static const anim_frame_t basefrontblink_frames[] = {
    { 300, basefrontblink_frame0 },
    { 300, basefrontblink_frame1 },
};

static void basebackblink_frame0(void) {
    ui.base.set(1);
}

static void basebackblink_frame1(void) {
}

static const anim_frame_t basebackblink_frames[] = {
    { 300, basebackblink_frame0 },
    { 300, basebackblink_frame1 },
};

static void unitselectanim_frame0(void) {
    ui.line4.set_str(LINE_DASH);
}

static void unitselectanim_frame1(void) {
    ui.line4.set_str(LINE_DASH);
}

static void unitselectanim_frame2(void) {
    ui.line4.set_str(LINE_DASH);
}

static const anim_frame_t unitselectanim_frames[] = {
    { 800, unitselectanim_frame0 },
    { 800, unitselectanim_frame1 },
    { 800, unitselectanim_frame2 },
};

static void bootfulltest_frame0(void) {
    lcd_show_all();
}

static void bootfulltest_frame1(void) {
    lcd_clear_all();
}

static void bootfulltest_frame2(void) {
    lcd_show_all();
}

static void bootfulltest_frame3(void) {
    lcd_clear_all();
}

static const anim_frame_t bootfulltest_frames[] = {
    { 500, bootfulltest_frame0 },
    { 200, bootfulltest_frame1 },
    { 500, bootfulltest_frame2 },
    { 200, bootfulltest_frame3 },
};

static void signalpulse_frame0(void) {
    ui.signal.set(1);
}

static void signalpulse_frame1(void) {
    ui.signal.set(3);
}

static void signalpulse_frame2(void) {
    ui.signal.set(5);
}

static void signalpulse_frame3(void) {
    ui.signal.set(3);
}

static const anim_frame_t signalpulse_frames[] = {
    { 100, signalpulse_frame0 },
    { 100, signalpulse_frame1 },
    { 100, signalpulse_frame2 },
    { 100, signalpulse_frame3 },
};

static void areaside1blink_frame0(void) {
}

static void areaside1blink_frame1(void) {
}

static const anim_frame_t areaside1blink_frames[] = {
    { 400, areaside1blink_frame0 },
    { 400, areaside1blink_frame1 },
};

static void areaside2blink_frame0(void) {
}

static void areaside2blink_frame1(void) {
}

static const anim_frame_t areaside2blink_frames[] = {
    { 400, areaside2blink_frame0 },
    { 400, areaside2blink_frame1 },
};

static void volumeside1blink_frame0(void) {
}

static void volumeside1blink_frame1(void) {
}

static const anim_frame_t volumeside1blink_frames[] = {
    { 400, volumeside1blink_frame0 },
    { 400, volumeside1blink_frame1 },
};

static void volumeside2blink_frame0(void) {
}

static void volumeside2blink_frame1(void) {
}

static const anim_frame_t volumeside2blink_frames[] = {
    { 400, volumeside2blink_frame0 },
    { 400, volumeside2blink_frame1 },
};

static void volumeside3blink_frame0(void) {
}

static void volumeside3blink_frame1(void) {
}

static const anim_frame_t volumeside3blink_frames[] = {
    { 400, volumeside3blink_frame0 },
    { 400, volumeside3blink_frame1 },
};

static void errorflash_frame0(void) {
    ui.line4.set_str(LINE_ERR);
}

static void errorflash_frame1(void) {
    ui.line4.set();
}

static const anim_frame_t errorflash_frames[] = {
    { 300, errorflash_frame0 },
    { 300, errorflash_frame1 },
};

static void measuringdots_frame0(void) {
    ui.line4.set_str("");
}

static void measuringdots_frame1(void) {
    ui.line4.set_str("");
}

static void measuringdots_frame2(void) {
    ui.line4.set_str("");
}

static const anim_frame_t measuringdots_frames[] = {
    { 200, measuringdots_frame0 },
    { 200, measuringdots_frame1 },
    { 200, measuringdots_frame2 },
};

/* ========== 动画配置表 ========== */
static const anim_config_t anim_configs[ANIM_COUNT] = {
    [ANIM_LASERBLINK] = { laserblink_frames, 2, 1 },
    [ANIM_BLUETOOTHBLINK] = { bluetoothblink_frames, 2, 1 },
    [ANIM_WIFIBLINK] = { wifiblink_frames, 2, 1 },
    [ANIM_CHARGINGANIM] = { charginganim_frames, 4, 1 },
    [ANIM_LOWBATTERYBLINK] = { lowbatteryblink_frames, 2, 1 },
    [ANIM_BASEFRONTBLINK] = { basefrontblink_frames, 2, 1 },
    [ANIM_BASEBACKBLINK] = { basebackblink_frames, 2, 1 },
    [ANIM_UNITSELECTANIM] = { unitselectanim_frames, 3, 1 },
    [ANIM_BOOTFULLTEST] = { bootfulltest_frames, 4, 0 },
    [ANIM_SIGNALPULSE] = { signalpulse_frames, 4, 0 },
    [ANIM_AREASIDE1BLINK] = { areaside1blink_frames, 2, 1 },
    [ANIM_AREASIDE2BLINK] = { areaside2blink_frames, 2, 1 },
    [ANIM_VOLUMESIDE1BLINK] = { volumeside1blink_frames, 2, 1 },
    [ANIM_VOLUMESIDE2BLINK] = { volumeside2blink_frames, 2, 1 },
    [ANIM_VOLUMESIDE3BLINK] = { volumeside3blink_frames, 2, 1 },
    [ANIM_ERRORFLASH] = { errorflash_frames, 2, 1 },
    [ANIM_MEASURINGDOTS] = { measuringdots_frames, 3, 1 },
};

/* ========== 初始化 ========== */
void anim_init(void) {
    memset(anim_states, 0, sizeof(anim_states));
}

/* ========== 启动动画（默认参数）========== */
void anim_start(anim_id_e id) {
    anim_start_ex(id, 0, 0);
}

/* ========== 启动动画（扩展参数）========== */
void anim_start_ex(anim_id_e id, uint16_t interval_ms, uint16_t timeout_ms) {
    if (id >= ANIM_COUNT) return;
    
    anim_state_t* s = &anim_states[id];
    s->running = 1;
    s->frame_idx = 0;
    s->tick_count = 0;
    s->interval_ms = interval_ms;
    s->timeout_ms = timeout_ms;
    s->total_time = 0;
    
    /* 立即执行第一帧 */
    const anim_config_t* cfg = &anim_configs[id];
    if (cfg->frames && cfg->frame_count > 0) {
        cfg->frames[0].apply();
    }
}

/* ========== 停止动画 ========== */
void anim_stop(anim_id_e id) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].running = 0;
}

/* ========== 停止所有动画 ========== */
void anim_stop_all(void) {
    for (int i = 0; i < ANIM_COUNT; i++) {
        anim_states[i].running = 0;
    }
}

/* ========== 检查是否运行中 ========== */
uint8_t anim_is_running(anim_id_e id) {
    if (id >= ANIM_COUNT) return 0;
    return anim_states[id].running;
}

/* ========== 修改间隔 ========== */
void anim_set_interval(anim_id_e id, uint16_t interval_ms) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].interval_ms = interval_ms;
}

/* ========== 修改超时 ========== */
void anim_set_timeout(anim_id_e id, uint16_t timeout_ms) {
    if (id >= ANIM_COUNT) return;
    anim_states[id].timeout_ms = timeout_ms;
}

/* ========== 定时器调用 ========== */
void anim_tick(uint16_t ms) {
    for (int i = 0; i < ANIM_COUNT; i++) {
        anim_state_t* s = &anim_states[i];
        if (!s->running) continue;
        
        const anim_config_t* cfg = &anim_configs[i];
        if (!cfg->frames || cfg->frame_count == 0) continue;
        
        /* 更新总时间 */
        s->total_time += ms;
        
        /* 检查超时 */
        if (s->timeout_ms > 0 && s->total_time >= s->timeout_ms) {
            s->running = 0;
            continue;
        }
        
        /* 更新帧计时 */
        s->tick_count += ms;
        
        /* 获取当前帧间隔（运行时参数优先）*/
        uint16_t duration;
        if (s->interval_ms > 0) {
            duration = s->interval_ms;
        } else {
            duration = cfg->frames[s->frame_idx].duration;
        }
        
        if (s->tick_count >= duration) {
            s->tick_count = 0;
            s->frame_idx++;
            
            /* 检查是否播放完 */
            if (s->frame_idx >= cfg->frame_count) {
                if (cfg->loop) {
                    s->frame_idx = 0;
                } else {
                    /* 非循环动画，自动停止 */
                    s->running = 0;
                    continue;
                }
            }
            
            /* 执行帧动作 */
            cfg->frames[s->frame_idx].apply();
        }
    }
}
