/**
 * 滑台测试页面模块 - 使用DeviceHub共享设备
 */
console.info('[SlipwayPage] script loaded, assetVersion =', window.__assetVersion || 'n/a');

const SlipwayPage = {
    // 状态 (从DviceHub同步)
    slipwayConnected: false,
    rotaryConnected: false,
    serialConnected: false,
    slipwayPos: 0,
    rotaryPos: 0,
    slipwayState: '离线',
    rotaryState: '离线',
    slipwayResetDone: null,
    ioWatchList: [],
    ioStatusMap: null,
    ioPrevStatusMap: null,
    ioChangeState: {},
    ioDetectRunning: false,
    ioDetectTimer: null,
    ioDetectPrevMap: null,
    ioDetectStartTs: null,
    ioDetectInFlight: false,
    _refreshPausedByIoDetect: false,
    testRunning: false,
    testResults: [],
    refreshTimer: null,
    _persistBound: false,
    _persistTimer: null,
    _progressDedup: null,

    PERSIST_STATE_KEY: 'slipway_test_state_v2',
    PERSIST_STATE_BACKUP_KEY: 'slipway_test_state_backup_v2',
    PERSIST_SAVE_DEBOUNCE_MS: 300,

    maxSlipwayPosMm: 38000,
    stepOptions: [0.1, 1, 10, 50, 100],
    activeStep: 10,
    activeReflectance: 90,
    homeIoNum: 4,
    homeIoActiveLevel: 0,
    homeIoChecking: false,
    
    // 流程模式: 'basic' 或 'advanced'
    testMode: 'basic',
    errorChart: null,

    segEditorInited: false,
    segments: [],
    planJsonExpanded: false,
    planConfigOpen: false,

    // UI参数
    errorThresholdMm: 5,
    estPointTimeSec: 3,

    chartExpanded: false,
    chartMetricKey: 'error',

    subtractBaselineError: false,

    _parseIoWatchList(val) {
        if (!val) return [];
        const s = String(val);
        const parts = s.split(/[,，\s]+/g).map(x => x.trim()).filter(Boolean);
        const out = [];
        for (const p of parts) {
            const n = parseInt(p, 10);
            if (!Number.isFinite(n) || n < 0) continue;
            if (!out.includes(n)) out.push(n);
        }
        return out;
    },

    _ioDetectGetRange() {
        const fromEl = document.getElementById('ss-io-detect-from');
        const toEl = document.getElementById('ss-io-detect-to');
        let from = parseInt(fromEl ? fromEl.value : '0', 10);
        let to = parseInt(toEl ? toEl.value : '15', 10);
        if (!Number.isFinite(from)) from = 0;
        if (!Number.isFinite(to)) to = 15;
        if (from < 0) from = 0;
        if (to < 0) to = 0;
        if (to < from) {
            const t = from;
            from = to;
            to = t;
        }
        if (to - from > 128) to = from + 128;
        return { from, to };
    },

    _ioDetectLog(line) {
        const box = document.getElementById('ss-io-detect-log');
        if (!box) return;
        const ts = this.ioDetectStartTs ? ((Date.now() - this.ioDetectStartTs) / 1000).toFixed(1) : '0.0';
        const safe = String(line || '').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
        const html = `<div style="opacity:.92;"><span style="opacity:.65; margin-right:8px;">[${ts}s]</span>${safe}</div>`;
        box.insertAdjacentHTML('afterbegin', html);
        // 控制日志长度
        try {
            const maxLines = 80;
            while (box.children.length > maxLines) box.removeChild(box.lastChild);
        } catch (e) {}
    },

    clearIoDetectLog() {
        const box = document.getElementById('ss-io-detect-log');
        if (box) box.innerHTML = '';
    },

    _getHomeIoConfig() {
        const ioEl = document.getElementById('ss-home-io');
        const activeEl = document.getElementById('ss-io-active');
        let ioNum = parseInt(ioEl ? ioEl.value : String(this.homeIoNum ?? 4), 10);
        let activeLevel = parseInt(activeEl ? activeEl.value : String(this.homeIoActiveLevel ?? 0), 10);
        if (!Number.isFinite(ioNum) || ioNum < 0) ioNum = Number.isFinite(this.homeIoNum) ? this.homeIoNum : 4;
        if (!Number.isFinite(activeLevel)) activeLevel = Number.isFinite(this.homeIoActiveLevel) ? this.homeIoActiveLevel : 0;
        return { ioNum, activeLevel };
    },

    _updateHomeIoStateLabel(value = null, readable = null, ioNum = null, activeLevel = null, customText = null, customColor = null) {
        const el = document.getElementById('slipway-home-io-state');
        if (!el) return;
        const cfg = this._getHomeIoConfig();
        const io = Number.isFinite(ioNum) ? ioNum : cfg.ioNum;
        const active = Number.isFinite(activeLevel) ? activeLevel : cfg.activeLevel;

        let text = '未知';
        let color = '#94a3b8';
        if (customText) {
            text = String(customText);
            color = customColor || color;
        } else if (readable === false) {
            text = '读取失败';
            color = '#ff6b6b';
        } else if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
            const n = Number(value);
            if (n === Number(active)) {
                text = `已触发(${n})`;
                color = '#f59e0b';
            } else {
                text = `未触发(${n})`;
                color = '#00e676';
            }
        }

        el.textContent = `限位IO${io}: ${text}`;
        el.style.color = color;
    },

    _isSlipwayBusyForIoCheck() {
        const state = String(this.slipwayState || '').toLowerCase();
        return state.includes('moving') || state.includes('运动') || state.includes('reset') || state.includes('复位') || state.includes('busy');
    },

    async checkHomeIo() {
        if (this.homeIoChecking) return;
        try { Utils.toast('检测IO按钮已触发', 'info', 1200); } catch (e) {}

        const { ioNum, activeLevel } = this._getHomeIoConfig();
        if (this.ioDetectRunning) {
            this._updateHomeIoStateLabel(null, null, ioNum, activeLevel, '自动检测中', '#f59e0b');
            return Utils.toast('IO自动检测运行中，请先停止', 'warning');
        }
        if (this.testRunning) {
            this._updateHomeIoStateLabel(null, null, ioNum, activeLevel, '测试中', '#f59e0b');
            return Utils.toast('测试运行中，请先停止测试', 'warning');
        }

        let pausedRefresh = false;
        this.homeIoChecking = true;
        this._updateHomeIoStateLabel(null, null, ioNum, activeLevel, '检测中...', '#38bdf8');

        try {
            if (this.refreshTimer) {
                this.stopRefresh();
                pausedRefresh = true;
            }
        } catch (e) {}

        try {
            try {
                await this.updateStatus();
            } catch (e) {}

            if (this._isSlipwayBusyForIoCheck()) {
                this._updateHomeIoStateLabel(null, null, ioNum, activeLevel, '运动中', '#f59e0b');
                return Utils.toast('滑台运动/复位中，暂不允许检测IO', 'warning');
            }

            const ioRes = await API.slipway.getIoStatus([ioNum]);
            if (ioRes && ioRes.test_busy) {
                this._updateHomeIoStateLabel(null, null, ioNum, activeLevel, '测试忙', '#f59e0b');
                return Utils.toast('当前测试忙，暂时无法检测IO', 'warning');
            }
            if (!ioRes || !ioRes.success) {
                const msg = ioRes?.message || '读取失败';
                const stateText = ioRes && ioRes.connected === false ? '未连接' : '读取失败';
                this._updateHomeIoStateLabel(null, false, ioNum, activeLevel, stateText, '#ff6b6b');
                return Utils.toast('检测IO失败: ' + msg, 'error');
            }

            const ioMap = (ioRes && ioRes.io) ? ioRes.io : {};
            let value = ioMap[String(ioNum)];
            if (value === undefined) {
                const keys = Object.keys(ioMap || {});
                if (keys.length) value = ioMap[keys[0]];
            }
            if (value === undefined || value === null || !Number.isFinite(Number(value))) {
                this._updateHomeIoStateLabel(null, false, ioNum, activeLevel, '读取失败', '#ff6b6b');
                return Utils.toast(`限位IO${ioNum} 读取失败`, 'error');
            }

            const numValue = Number(value);
            const prevMap = { ...(this.ioStatusMap || {}) };
            const nextMap = { ...(this.ioStatusMap || {}), [String(ioNum)]: numValue };
            this.ioPrevStatusMap = this.ioStatusMap ? { ...this.ioStatusMap } : null;
            this.ioStatusMap = nextMap;
            this._updateIoChangeState(prevMap, nextMap);
            this._renderIoBar();
            this._updateHomeIoStateLabel(numValue, true, ioNum, activeLevel);

            if (numValue === Number(activeLevel)) {
                Utils.toast(`限位IO${ioNum} 已触发(${numValue})`, 'warning');
            } else {
                Utils.toast(`限位IO${ioNum} 未触发(${numValue})`, 'success');
            }
        } catch (e) {
            this._updateHomeIoStateLabel(null, false, ioNum, activeLevel, '读取失败', '#ff6b6b');
            Utils.toast('检测IO异常: ' + (e && e.message ? e.message : e), 'error');
        } finally {
            this.homeIoChecking = false;
            try {
                if (pausedRefresh && !this.ioDetectRunning) {
                    this.startRefresh();
                }
            } catch (e) {}
        }
    },

    async _ioDetectTick() {
        if (!this.ioDetectRunning) return;
        if (this.ioDetectInFlight) return;
        this.ioDetectInFlight = true;
        if (!this.slipwayConnected) {
            this._ioDetectLog('滑台未连接');
            this.ioDetectInFlight = false;
            return;
        }
        // 测试运行期间跳过IO检测（避免抢占TCP通道）
        if (this.testRunning) {
            this.ioDetectInFlight = false;
            return;
        }

        const { from, to } = this._ioDetectGetRange();
        const ioNums = [];
        for (let i = from; i <= to; i++) ioNums.push(i);

        try {
            const ioRes = await API.slipway.getIoStatus(ioNums);
            // 后端测试忙时返回 test_busy，静默跳过
            if (ioRes && ioRes.test_busy) { this.ioDetectInFlight = false; return; }
            const next = (ioRes && ioRes.success && ioRes.io) ? ioRes.io : null;
            if (!next) return;

            const prev = this.ioDetectPrevMap;
            if (prev) {
                const keys = Object.keys(next);
                keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
                for (const k of keys) {
                    const pv = prev[k];
                    const nv = next[k];
                    if (pv === undefined || pv === null) continue;
                    if (pv === nv) continue;
                    const arrow = (pv === 0 && nv === 1) ? '↑' : (pv === 1 && nv === 0) ? '↓' : '↕';
                    this._ioDetectLog(`IO${k} ${pv} -> ${nv} ${arrow}`);
                    // 添加通知推送
                    Utils.toast(`🔔 IO${k} 变化: ${pv} → ${nv} ${arrow}`, 'info', 3000);
                }
            } else {
                this._ioDetectLog(`开始采样 IO ${from}~${to}`);
            }

            this.ioDetectPrevMap = next;
        } catch (e) {
            this._ioDetectLog('读取失败: ' + (e && e.message ? e.message : e));
        } finally {
            this.ioDetectInFlight = false;
        }
    },

    startIoDetect() {
        if (this.ioDetectRunning) return;
        if (!this.slipwayConnected) return Utils.toast('请先连接滑台', 'warning');

        // 暂停页面常规刷新（避免 get_position 等查询抢走 IO 回包）
        try {
            if (this.refreshTimer) {
                this.stopRefresh();
                this._refreshPausedByIoDetect = true;
            } else {
                this._refreshPausedByIoDetect = false;
            }
        } catch (e) {}

        this.ioDetectRunning = true;
        this.ioDetectPrevMap = null;
        this.ioDetectStartTs = Date.now();
        this._ioDetectLog('IO自动检测已开始，请触发开关/限位观察变化...');

        // 先跑一次，再进入定时器
        this._ioDetectTick();
        this.ioDetectTimer = setInterval(() => this._ioDetectTick(), 300);
    },

    stopIoDetect() {
        this.ioDetectRunning = false;
        if (this.ioDetectTimer) {
            clearInterval(this.ioDetectTimer);
            this.ioDetectTimer = null;
        }
        this._ioDetectLog('IO自动检测已停止');

        // 恢复页面常规刷新
        try {
            if (this._refreshPausedByIoDetect) {
                this.startRefresh();
            }
            this._refreshPausedByIoDetect = false;
        } catch (e) {}
    },

    _updateIoChangeState(prev, next) {
        const now = Date.now();
        if (!next || typeof next !== 'object') return;

        const prevMap = (prev && typeof prev === 'object') ? prev : {};
        const nextKeys = Object.keys(next);
        for (const k of nextKeys) {
            const pv = prevMap[k];
            const nv = next[k];
            if (pv === undefined || pv === null) continue;
            if (pv === nv) continue;
            const dir = (pv === 0 && nv === 1) ? 'up' : (pv === 1 && nv === 0) ? 'down' : 'chg';
            this.ioChangeState[String(k)] = { ts: now, from: pv, to: nv, dir };
        }

        // 清理过期闪烁状态
        try {
            for (const k of Object.keys(this.ioChangeState || {})) {
                const item = this.ioChangeState[k];
                if (!item || !item.ts) continue;
                if (now - item.ts > 2000) delete this.ioChangeState[k];
            }
        } catch (e) {}
    },

    _renderIoBar() {
        const el = document.getElementById('slipway-io-bar');
        if (!el) return;

        const m = this.ioStatusMap;
        const keys = m ? Object.keys(m) : [];
        if (!keys.length) {
            el.innerHTML = '<span style="opacity:.6; font-size:12px;">--</span>';
            return;
        }

        // 稳定排序（按IO编号）
        keys.sort((a, b) => {
            const na = parseInt(a, 10);
            const nb = parseInt(b, 10);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return String(a).localeCompare(String(b));
        });

        const items = [];
        for (const k of keys) {
            const v = m[k];
            let color = '#666';
            let txt = '?';
            if (v === 0) { color = '#ff6b6b'; txt = '0'; }
            else if (v === 1) { color = '#00e676'; txt = '1'; }

            // 变化提示（短暂高亮）
            let glow = '';
            let arrow = '';
            try {
                const st = (this.ioChangeState || {})[String(k)];
                if (st && st.ts && (Date.now() - st.ts) <= 1500) {
                    glow = 'box-shadow:0 0 0 1px rgba(255,255,255,0.35), 0 0 10px rgba(0,212,255,0.35);';
                    arrow = (st.dir === 'up') ? '↑' : (st.dir === 'down') ? '↓' : '↕';
                }
            } catch (e) {}
            items.push(
                `<span style="display:inline-flex; align-items:center; gap:6px; padding:2px 6px; border-radius:10px; background:rgba(255,255,255,0.06); ${glow}">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color};"></span>
                    <span style="font-size:12px;">IO${k}:${txt}${arrow ? (' ' + arrow) : ''}</span>
                </span>`
            );
        }
        el.innerHTML = items.join('');
    },
    
    // 当前关联的任务（从任务中心跳转过来时）
    currentTask: null,
    
    // 内存优化配置
    MAX_TABLE_ROWS: 500,        // 表格最大显示行数
    MAX_CHART_POINTS: 1000,     // 图表最大数据点数
    MAX_RESULTS_MEMORY: 5000,   // 内存中最大保留结果数

    _resultIdentity(result) {
        if (!result || typeof result !== 'object') return '';
        return [
            result.step ?? '',
            result.sample ?? '',
            result.segment_idx ?? '',
            result.target ?? '',
            result.reflectance ?? ''
        ].join('|');
    },

    _syncSlipwaySoftLimitUi() {
        const maxPos = Number.isFinite(Number(this.maxSlipwayPosMm)) && Number(this.maxSlipwayPosMm) > 0
            ? Number(this.maxSlipwayPosMm)
            : 38000;
        const setMax = (id, extra = {}) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.max = String(maxPos);
            if (extra.min !== undefined) el.min = String(extra.min);
            if (extra.placeholder !== undefined) el.placeholder = extra.placeholder;
            el.title = `软限位范围: ${extra.min ?? 0} ~ ${maxPos} mm`;
        };
        setMax('slipway-target', { min: 0, placeholder: `0 ~ ${maxPos}` });
        setMax('jog-step-input', { min: 0 });
        setMax('ss-max-pos', { min: 1 });
    },

    _clampSlipwayTargetInput() {
        const el = document.getElementById('slipway-target');
        if (!el) return null;
        let value = parseFloat(el.value);
        if (!Number.isFinite(value)) return null;
        const maxPos = Number(this.maxSlipwayPosMm) || 38000;
        if (value < 0) value = 0;
        if (value > maxPos) value = maxPos;
        el.value = String(value);
        return value;
    },

    _cloneResultsTail(results, limit = this.MAX_RESULTS_MEMORY) {
        if (!Array.isArray(results) || results.length === 0) return [];
        const safeLimit = Math.max(0, parseInt(limit, 10) || 0);
        let items = results;
        if (safeLimit === 0) {
            items = [];
        } else if (items.length > safeLimit) {
            items = items.slice(-safeLimit);
        }
        return items.map(item => (item && typeof item === 'object') ? { ...item } : item);
    },

    _cloneSegmentResultsMap(segmentResults, limit = this.MAX_RESULTS_MEMORY) {
        const out = {};
        if (!segmentResults || typeof segmentResults !== 'object') return out;
        Object.entries(segmentResults).forEach(([key, results]) => {
            out[key] = this._cloneResultsTail(results, limit);
        });
        return out;
    },

    _buildPersistState(forStorage = false) {
        const limit = forStorage
            ? Math.min(Math.max(50, parseInt(this.MAX_RESULTS_MEMORY, 10) || 500), 1200)
            : Math.max(0, parseInt(this.MAX_RESULTS_MEMORY, 10) || 0);
        const testResults = this._cloneResultsTail(this.testResults, limit);
        const segmentResults = this._cloneSegmentResultsMap(this.segmentResults, limit);
        return {
            testRunning: !!this.testRunning,
            testResults,
            segmentResults,
            activeSegmentTab: this.activeSegmentTab || 'all',
            testMode: this.testMode || 'basic',
            segments: Array.isArray(this.segments) ? this.segments.map(seg => (seg && typeof seg === 'object') ? { ...seg } : seg) : [],
            activeReflectance: this.activeReflectance,
            failedPoints: Array.isArray(this._failedPoints) ? this._failedPoints.map(item => (item && typeof item === 'object') ? { ...item } : item) : [],
            resultCount: Array.isArray(this.testResults) ? this.testResults.length : 0,
            timestamp: Date.now()
        };
    },

    _schedulePersistState(force = false) {
        if (force) {
            if (this._persistTimer) {
                clearTimeout(this._persistTimer);
                this._persistTimer = null;
            }
            this.saveTestState();
            return;
        }
        if (this._persistTimer) return;
        this._persistTimer = setTimeout(() => {
            this._persistTimer = null;
            this.saveTestState();
        }, this.PERSIST_SAVE_DEBOUNCE_MS);
    },

    _clearPersistedTestState() {
        try { sessionStorage.removeItem(this.PERSIST_STATE_KEY); } catch (e) {}
        try { sessionStorage.removeItem('slipway_test_state'); } catch (e) {}
        try { localStorage.removeItem(this.PERSIST_STATE_BACKUP_KEY); } catch (e) {}
        try { window.__slipway_test_state_mem = null; } catch (e) {}
    },

    _rebuildSegmentResultsFromResults(results = this.testResults) {
        const next = {};
        (Array.isArray(results) ? results : []).forEach(result => {
            if (!result || result.segment_idx === undefined || result.segment_idx === null) return;
            const segIdx = result.segment_idx;
            if (!next[segIdx]) next[segIdx] = [];
            next[segIdx].push(result);
        });
        this.segmentResults = next;
        return next;
    },

    _trimResultsMemory() {
        const limit = Math.max(0, parseInt(this.MAX_RESULTS_MEMORY, 10) || 0);
        let trimmed = 0;

        if (!Array.isArray(this.testResults)) {
            this.testResults = [];
        }

        if (limit === 0) {
            trimmed = this.testResults.length;
            this.testResults = [];
            this.segmentResults = {};
            return trimmed;
        }

        if (this.testResults.length > limit) {
            trimmed = this.testResults.length - limit;
            this.testResults = this.testResults.slice(-limit);
        }

        this._rebuildSegmentResultsFromResults(this.testResults);
        return trimmed;
    },

    // 统计: 测距频率（用于判断“机器没测出来”还是“前端卡/丢更新”）
    RATE_WINDOW: 20,            // 频率滚动窗口（点数）
    _rateSamples: [],           // [{ts:number(ms), time_ms:number|null}]
    _rateStutterCount: 0,
    _lastMeasureGapMs: null,

    // UI更新节流（减少“卡顿”，避免每个点都重渲染表格/图表）
    _uiUpdatePending: false,
    _uiUpdateTimer: null,
    _lastUiRenderMs: null,

    // 检查是否可以操作滑台（TCP连接 或 仿真模式）
    canOperateSlipway() {
        return this.slipwayConnected || (window.DeviceHub && DeviceHub.simulationEnabled);
    },

    _bindPersistHooks() {
        if (this._persistBound) return;
        this._persistBound = true;

        window.addEventListener('pagehide', () => {
            try { this.saveTestState(); } catch (e) {}
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') {
                try { this.saveTestState(); } catch (e) {}
            }
        });
    },

    // 自动测试页：基础流程反射率（可选）
    async setAutoReflectance(val, btn) {
        this._applyReflectanceUi(val);
        return await this.setReflectance(val);
    },

    _normReflectance(val) {
        let v = parseFloat(val);
        if (!Number.isFinite(v)) return 0;
        if (v > 0 && v <= 1) v = v * 100;
        v = Math.round(v);
        if (v < 0) v = 0;
        if (v > 100) v = 100;
        return v;
    },

    _displayReflectance(val) {
        if (val === undefined || val === null || val === '') return '--';
        const n = this._normReflectance(val);
        return Number.isFinite(n) && n > 0 ? `${n}%` : '--';
    },

    _formatDiagNumber(val, digits = 0) {
        const num = Number(val);
        if (!Number.isFinite(num)) return '--';
        return digits > 0 ? num.toFixed(digits) : Math.round(num).toLocaleString('zh-CN');
    },

    _buildMeasureTooltip(result) {
        const quality = Number.isFinite(Number(result?.quality))
            ? Number(result.quality).toFixed(3)
            : '--';
        const fwTime = Number.isFinite(Number(result?.fw_time_ms))
            ? `${Number(result.fw_time_ms)}ms`
            : '--';
        const apd = this._formatDiagNumber(result?.apd_voltage, 0);
        const goodShots = result?.good_shots ?? '--';
        const totalShots = result?.total_shots ?? '--';
        const retryCount = result?.retry_count ?? '--';
        const powerMode = result?.power_mode ?? '--';
        return `固件耗时: ${fwTime} | 质量: ${quality} | APD: ${apd} | shots: ${goodShots}/${totalShots} | 重试: ${retryCount} | 功率: ${powerMode}`;
    },

    _applyReflectanceUi(val) {
        const n = this._normReflectance(val);
        if (!Number.isFinite(n) || n <= 0) return;
        this.activeReflectance = n;

        // 同步下拉框
        const select = document.getElementById('rotary-ref-select');
        if (select) select.value = String(n);

        // 同步显示文本
        const refValEl = document.getElementById('rotary-ref-val');
        if (refValEl) refValEl.textContent = n + '%';
        const headerRef = document.getElementById('header-ref');
        if (headerRef) headerRef.textContent = n + '%';

        const rotaryRefDisplay = document.getElementById('rotary-ref-display');
        if (rotaryRefDisplay) rotaryRefDisplay.textContent = n + '%';

        // 同步转靶tab按钮高亮
        try {
            const rotaryGrid = document.querySelector('#tab-rotary .ref-grid');
            if (rotaryGrid) {
                rotaryGrid.querySelectorAll('.ref-btn').forEach(el => {
                    const vv = parseInt((el.textContent || '').replace('%', ''), 10);
                    el.classList.toggle('active', vv === n);
                });
            }
        } catch (e) {}

        // 同步自动tab按钮高亮（基础流程那一组）
        try {
            const autoGrid = document.querySelector('#basic-mode-panel .ref-grid');
            if (autoGrid) {
                autoGrid.querySelectorAll('.ref-btn').forEach(el => {
                    const vv = parseInt((el.textContent || '').replace('%', ''), 10);
                    el.classList.toggle('active', vv === n);
                });
            }
        } catch (e) {}
    },
    
    // 检查是否可以操作转靶（TCP连接 或 仿真模式）
    canOperateRotary() {
        return this.slipwayConnected || (window.DeviceHub && DeviceHub.simulationEnabled);
    },
    
    // 检查是否可以进行测距（串口连接 或 仿真模式）
    canMeasure() {
        return this.serialConnected || (window.DeviceHub && DeviceHub.simulationEnabled);
    },
    
    // 通用检查（任意连接 或 仿真模式）
    canOperate() {
        return this.slipwayConnected || this.serialConnected || (window.DeviceHub && DeviceHub.simulationEnabled);
    },

    // ========== 生命周期 ==========
    
    async init() {
        console.log('SlipwayPage init - 使用DeviceHub');
        
        // 监听DeviceHub状态变化
        if (window.DeviceHub) {
            DeviceHub.onStatusChange(() => this.syncFromHub());
            this.syncFromHub();
        }

        // 启动时加载当前工位绑定的滑台/转靶设置并应用到UI
        await this.loadAndApplySlipwaySettings();
        
        await this.updateStatus();
        this.startRefresh();
        this.bindEvents();

        // 本机浏览器记忆：恢复上次输入/选择
        this.loadUiStateFromLocal();
        
        // 恢复测试状态（页面切换后返回时）
        const restored = this.restoreTestState();

        this._bindPersistHooks();
        
        // 绑定 WebSocket 测试进度监听
        this._bindTestProgressListener();
        
        // 初始化误差曲线图
        setTimeout(() => this.initErrorChart(), 100);
        
        // 初始化数据表滚动检测
        setTimeout(() => this._initScrollPauseDetection(), 100);

        // 初始化高级流程可视化编辑器（如果DOM已就绪）
        setTimeout(() => this.initSegmentEditor(), 120);

        // 绑定UI参数输入
        setTimeout(() => this.bindUiParams(), 150);
        
        // 加载关联的任务（从任务中心跳转过来时）
        this.loadCurrentTask();
        
        // 初始化模式显示
        this.updateModeDisplay();
        
        // 如果有恢复的数据，显示提示
        if (restored && this.testResults.length > 0) {
            Utils.toast(`已恢复 ${this.testResults.length} 条测试数据`, 'info');
        }
    },
    
    // 更新模式显示
    updateModeDisplay() {
        const mode = this.testMode || 'basic';
        const statStatus = document.getElementById('stat-status');
        if (statStatus) {
            statStatus.textContent = mode === 'basic' ? '基础模式' : '高级模式';
            statStatus.style.color = mode === 'basic' ? 'var(--accent)' : '#ffc107';
        }
    },
    
    // 加载当前关联的任务
    loadCurrentTask() {
        try {
            const taskData = sessionStorage.getItem('currentTestTask');
            if (taskData) {
                this.currentTask = JSON.parse(taskData);
                console.log('[SlipwayPage] 已加载关联任务:', this.currentTask.project_name, 'v' + this.currentTask.version);
                this.showTaskInfo();
            }
        } catch (e) {
            console.warn('加载任务信息失败:', e);
        }
    },
    
    // 显示任务信息栏
    showTaskInfo() {
        if (!this.currentTask) return;
        
        // 查找或创建任务信息栏
        let taskBar = document.getElementById('slipway-task-bar');
        if (!taskBar) {
            // 在页面顶部插入任务信息栏
            const container = document.querySelector('.slipway-container') || document.querySelector('.page-content');
            if (!container) return;
            
            taskBar = document.createElement('div');
            taskBar.id = 'slipway-task-bar';
            taskBar.className = 'task-info-bar';
            container.insertBefore(taskBar, container.firstChild);
        }
        
        const t = this.currentTask;
        taskBar.innerHTML = `
            <div class="task-info-content">
                <span class="task-label">📋 当前任务:</span>
                <span class="task-name">${t.project_name || '未知项目'} v${t.version || '?'}</span>
                <span class="task-source">${t.source_label || ''}</span>
                <span class="task-status ${t.status}">${t.status === 'testing' ? '测试中' : '待测试'}</span>
            </div>
            <div class="task-actions">
                <button class="btn-small" onclick="SlipwayPage.clearTask()">取消关联</button>
                <button class="btn-small primary" onclick="SlipwayPage.returnToTaskCenter()">返回任务中心</button>
            </div>
        `;
        taskBar.style.display = 'flex';
    },
    
    // 清除任务关联
    clearTask() {
        this.currentTask = null;
        sessionStorage.removeItem('currentTestTask');
        const taskBar = document.getElementById('slipway-task-bar');
        if (taskBar) taskBar.style.display = 'none';
        Utils.toast('已取消任务关联', 'info');
    },
    
    // 返回任务中心
    returnToTaskCenter() {
        if (typeof switchPage === 'function') {
            switchPage('task_center');
        }
    },

    loadUiStateFromLocal() {
        let st = null;
        try {
            st = JSON.parse(localStorage.getItem('slipway_ui_state_v1') || 'null');
        } catch (e) {
            st = null;
        }
        if (!st || typeof st !== 'object') return;

        const setIf = (id, v) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (v === undefined || v === null) return;
            el.value = v;
        };

        setIf('slipway-ip', st.slipway_ip);
        setIf('slipway-target', st.slipway_target);
        setIf('jog-step-input', st.jog_step);

        setIf('test-start', st.test_start);
        setIf('test-end', st.test_end);
        setIf('test-step', st.test_step);
        setIf('test-repeats', st.test_repeats);

        setIf('err-threshold', st.err_threshold);
        setIf('point-time', st.point_time);

        if (st.active_step !== undefined && st.active_step !== null) {
            try { this.setJogStep(st.active_step); } catch (e) {}
        }

        if (st.active_reflectance !== undefined && st.active_reflectance !== null) {
            try { this._applyReflectanceUi(st.active_reflectance); } catch (e) {}
        }

        if (st.test_mode === 'basic' || st.test_mode === 'advanced') {
            try { this.switchMode(st.test_mode); } catch (e) {}
        }
    },

    saveUiStateToLocal() {
        const getVal = (id) => document.getElementById(id)?.value;
        const st = {
            slipway_ip: getVal('slipway-ip') || '',
            slipway_target: getVal('slipway-target') || '',
            jog_step: getVal('jog-step-input') || '',

            test_start: getVal('test-start') || '',
            test_end: getVal('test-end') || '',
            test_step: getVal('test-step') || '',
            test_repeats: getVal('test-repeats') || '',

            err_threshold: getVal('err-threshold') || '',
            point_time: getVal('point-time') || '',

            test_mode: this.testMode || 'basic',
            active_step: this.activeStep,
            active_reflectance: this.activeReflectance,
        };
        try {
            localStorage.setItem('slipway_ui_state_v1', JSON.stringify(st));
        } catch (e) {}
    },

    // ========== 设置弹窗 ==========

    _updateMeasureUi() {
        // 测距路由已迁移到全局设备工具栏；这里保留空实现兼容旧调用。
    },

    _escapeHtml(v) {
        return String(v == null ? '' : v).replace(/[<>&"]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[s]));
    },

    _renderProtocolOverview(data) {
        const box = document.getElementById('ss-protocol-overview');
        if (!box) return;
        if (!data || !data.success) {
            box.innerHTML = `<div style="color:#ff9f9f;">加载失败: ${this._escapeHtml(data?.error || '未知错误')}</div>`;
            return;
        }

        const measure = data.measure || {};
        const activeProtocol = data.active_protocol || {};
        const activeFb = (data.fb || {}).active_definition || null;
        const fbDefs = Array.isArray((data.fb || {}).definitions) ? data.fb.definitions : [];
        const management = Array.isArray((data.fb || {}).management) ? data.fb.management : [];
        const parseModes = Array.isArray((data.fb || {}).runtime_parse_modes) ? data.fb.runtime_parse_modes : [];
        const modeList = Array.isArray(measure.available_modes) ? measure.available_modes : [];
        const parserList = Array.isArray(measure.supported_parsers) ? measure.supported_parsers : [];
        const profileList = Array.isArray(measure.competitor_profiles) ? measure.competitor_profiles : [];

        const activeProtocolText = `${this._escapeHtml(activeProtocol.protocol_id || 'default')}${activeProtocol.model_name ? ` <span style="opacity:.72;">(model=${this._escapeHtml(activeProtocol.model_name)})</span>` : ''}`;
        const profileText = measure.profile_id
            ? `${this._escapeHtml(measure.profile_id)}${measure.profile_name ? ` <span style="opacity:.72;">(${this._escapeHtml(measure.profile_name)})</span>` : ''}`
            : '<span style="opacity:.62;">未绑定竞品Profile</span>';
        const activeFbText = activeFb
            ? `${this._escapeHtml(activeFb.profile || 'FB')} <span style="opacity:.72;">[${this._escapeHtml((activeFb.recv_params || []).join(', ') || '无字段')}]</span>`
            : '<span style="opacity:.62;">当前活动协议的 measure 不是 FB，或尚未激活</span>';

        const fbListHtml = fbDefs.length
            ? fbDefs.map(item => {
                const recv = Array.isArray(item.recv_params) ? item.recv_params.join(', ') : '';
                return `<div style="padding:4px 0; border-top:1px solid rgba(255,255,255,0.06);">
                    <b>${this._escapeHtml(item.protocol_id || '')}</b>
                    <span style="opacity:.72;">[${this._escapeHtml(item.scope || '')}]</span>
                    <span style="opacity:.82;">${this._escapeHtml(item.profile || '')}</span>
                    <div style="opacity:.72;">${this._escapeHtml(recv || '无 recv_params')}</div>
                </div>`;
            }).join('')
            : '<div style="opacity:.62;">未找到 FB 定义</div>';

        const parseModesHtml = parseModes.length
            ? parseModes.map(item => `<div style="padding:2px 0;">${this._escapeHtml(item.label || '')}：${this._escapeHtml(item.when || '')}</div>`).join('')
            : '<div style="opacity:.62;">无</div>';

        const modeListHtml = modeList.length
            ? modeList.map(item => {
                const isCurrent = String(item.id || '') === String(measure.selection_mode || measure.type || '');
                return `<div style="padding:4px 0; border-top:1px solid rgba(255,255,255,0.06);">
                    <b>${this._escapeHtml(item.label || item.id || '')}</b>
                    ${isCurrent ? '<span style="color:#34d399; margin-left:6px;">[当前]</span>' : ''}
                    <div style="opacity:.72;">${this._escapeHtml(item.desc || '')}</div>
                </div>`;
            }).join('')
            : '<div style="opacity:.62;">无</div>';

        const parserListHtml = parserList.length
            ? parserList.map(item => {
                const flags = [
                    item.is_current ? '当前' : '',
                    item.available ? '可用' : '未启用',
                ].filter(Boolean).join(' / ');
                return `<div style="padding:4px 0; border-top:1px solid rgba(255,255,255,0.06);">
                    <b>${this._escapeHtml(item.label || item.id || '')}</b>
                    <span style="opacity:.72;">[${this._escapeHtml(flags || '--')}]</span>
                    <div style="opacity:.72;">${this._escapeHtml(item.desc || '')}</div>
                </div>`;
            }).join('')
            : '<div style="opacity:.62;">无</div>';

        const profileListHtml = profileList.length
            ? profileList.map(item => {
                return `<div style="padding:4px 0; border-top:1px solid rgba(255,255,255,0.06);">
                    <b>${this._escapeHtml(item.id || '')}</b>
                    <span style="opacity:.72;">${this._escapeHtml(item.name || '')}</span>
                    <span style="opacity:.72;">[${this._escapeHtml(item.kind_label || item.kind || '')}]</span>
                    ${item.is_current ? '<span style="color:#34d399; margin-left:6px;">[当前]</span>' : ''}
                    <div style="opacity:.72;">controls=${this._escapeHtml(String(item.control_count ?? 0))} / ${this._escapeHtml(item.desc || '')}</div>
                </div>`;
            }).join('')
            : '<div style="opacity:.62;">竞品协议库为空</div>';

        const managementHtml = management.length
            ? management.map(item => `<div style="padding:4px 0; border-top:1px solid rgba(255,255,255,0.06);">
                <b>${this._escapeHtml(item.title || '')}</b>
                <div style="opacity:.78;">${this._escapeHtml(item.desc || '')}</div>
                <div style="opacity:.6; font-family:monospace;">${this._escapeHtml(item.path || '')}</div>
            </div>`).join('')
            : '<div style="opacity:.62;">无</div>';

        box.innerHTML = `
            <div><b>当前测距来源</b>：${this._escapeHtml(measure.selection_label || measure.label || measure.type || '--')}</div>
            <div><b>实际解析Provider</b>：${this._escapeHtml(measure.resolved_label || measure.resolved_kind || '--')}</div>
            <div><b>当前活动协议</b>：${activeProtocolText}</div>
            <div><b>当前生效路由</b>：${this._escapeHtml(measure.route_text || '--')}</div>
            <div><b>当前解析说明</b>：${this._escapeHtml(measure.parse_summary || '--')}</div>
            <div><b>当前竞品Profile</b>：${profileText}</div>
            <div><b>Profile控制数</b>：${this._escapeHtml(String(measure.control_count ?? 0))}</div>
            <div style="margin-top:8px;"><b>全局可切换模式</b></div>
            <div>${modeListHtml}</div>
            <div style="margin-top:8px;"><b>扩展解析能力</b></div>
            <div>${parserListHtml}</div>
            <div style="margin-top:8px;"><b>竞品协议库</b>：${this._escapeHtml(String(measure.competitor_profile_count ?? 0))} 个</div>
            <div>${profileListHtml}</div>
            <div style="margin-top:8px;"><b>当前FB定义</b>：${activeFbText}</div>
            <div style="margin-top:8px;"><b>FB运行时解析分支</b></div>
            <div style="margin-left:8px;">${parseModesHtml}</div>
            <div style="margin-top:8px;"><b>FB定义数量</b>：${this._escapeHtml(String((data.fb || {}).definition_count ?? 0))}</div>
            <div>${fbListHtml}</div>
            <div style="margin-top:8px;"><b>FB/竞品管理位置</b></div>
            <div>${managementHtml}</div>
        `;
    },

    async loadProtocolOverview() {
        const box = document.getElementById('ss-protocol-overview');
        if (box) box.innerHTML = '<div style="opacity:.72;">加载协议概览中...</div>';
        try {
            const res = await API.slipway.getProtocolOverview();
            this._renderProtocolOverview(res || {});
        } catch (e) {
            this._renderProtocolOverview({ success: false, error: e?.message || String(e) });
        }
    },

    openSettings() {
        const overlay = document.getElementById('slipway-settings-overlay');
        if (overlay) overlay.classList.add('show');
        this.loadSettingsToDialog();
    },

    closeSettings() {
        const overlay = document.getElementById('slipway-settings-overlay');
        if (overlay) overlay.classList.remove('show');
    },

    async loadSettingsToDialog() {
        // 从当前工位绑定的工装配置加载（本机）
        try {
            const res = await API.settings.toolProfileGet(null);
            if (!res || !res.success) return;
            const profile = res.profile || {};
            const slipway = profile.slipway || {};

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el && val !== undefined && val !== null) el.value = val;
            };

            setVal('ss-max-pos', slipway.max_position_mm ?? this.maxSlipwayPosMm);
            setVal('ss-step-options', (slipway.step_options_mm || this.stepOptions).join(','));

            setVal('ss-move-min', slipway.move_min_speed ?? 50000);
            setVal('ss-move-max', slipway.move_max_speed ?? 600000);

            setVal('ss-reset-fast-min', slipway.reset_fast_min_speed ?? 70000);
            setVal('ss-reset-fast-max', slipway.reset_fast_max_speed ?? 500000);

            setVal('ss-reset-slow-min', slipway.reset_slow_min_speed ?? 50000);
            setVal('ss-reset-slow-max', slipway.reset_slow_max_speed ?? 100000);
            setVal('ss-reset-ultra-min', slipway.reset_ultra_slow_min_speed ?? 20000);
            setVal('ss-reset-ultra-max', slipway.reset_ultra_slow_max_speed ?? 50000);

            setVal('ss-home-io', slipway.home_io_num ?? 4);
            setVal('ss-io-active', slipway.home_io_active_level ?? 0);
            setVal('ss-zero-confirm-io', slipway.zero_confirm_io_num ?? -1);
            setVal('ss-zero-confirm-active', slipway.zero_confirm_io_active_level ?? 0);
            setVal('ss-reset-release-mm', slipway.reset_limit_release_mm ?? 2.0);
            setVal('ss-reset-io-poll', slipway.reset_io_poll_interval ?? 0.05);
            setVal('ss-reset-confirm-samples', slipway.reset_home_confirm_samples ?? 3);
            setVal('ss-reset-confirm-interval', slipway.reset_home_confirm_interval ?? 0.03);
            setVal('ss-io-watch', slipway.io_watch ?? (Array.isArray(slipway.io_watch_list) ? slipway.io_watch_list.join(',') : ''));
            
            // 内存优化配置
            setVal('ss-max-table-rows', slipway.max_table_rows ?? this.MAX_TABLE_ROWS);
            setVal('ss-max-chart-points', slipway.max_chart_points ?? this.MAX_CHART_POINTS);
            setVal('ss-max-results', slipway.max_results_memory ?? this.MAX_RESULTS_MEMORY);

            const outEl = document.getElementById('ss-measure-once-result');
            if (outEl) outEl.textContent = '';
            await this.loadProtocolOverview();
        } catch (e) {
            console.warn('[loadSettingsToDialog] 失败:', e);
        }
    },

    async loadAndApplySlipwaySettings() {
        // 从当前工位绑定的工装配置加载（本机），并直接应用到页面状态/步进按钮
        try {
            const res = await API.settings.toolProfileGet(null);
            if (!res || !res.success) return;
            const profile = res.profile || {};
            const slipway = profile.slipway || {};

            try {
                const wl = slipway.io_watch ?? (Array.isArray(slipway.io_watch_list) ? slipway.io_watch_list.join(',') : '');
                this.ioWatchList = this._parseIoWatchList(wl);
            } catch (e) {
                this.ioWatchList = [];

            const homeIoNum = parseInt((slipway.limit_io_num ?? slipway.home_io_num), 10);
            if (Number.isFinite(homeIoNum) && homeIoNum >= 0) {
                this.homeIoNum = homeIoNum;
            }
            const homeIoActiveLevel = parseInt((slipway.limit_io_active_level ?? slipway.home_io_active_level), 10);
            if (Number.isFinite(homeIoActiveLevel)) {
                this.homeIoActiveLevel = homeIoActiveLevel;
            }
            this._updateHomeIoStateLabel(null, null, this.homeIoNum, this.homeIoActiveLevel);

            }

            const maxPos = parseFloat(slipway.max_position_mm);
            if (Number.isFinite(maxPos) && maxPos > 0) {
                this.maxSlipwayPosMm = maxPos;
            }
            this._syncSlipwaySoftLimitUi();

            const steps = Array.isArray(slipway.step_options_mm) ? slipway.step_options_mm : null;
            if (steps && steps.length) {
                const stepOptions = steps
                    .map(v => parseFloat(v))
                    .filter(n => Number.isFinite(n) && n > 0);
                if (stepOptions.length) {
                    this.stepOptions = stepOptions;
                    this.activeStep = stepOptions.includes(this.activeStep) ? this.activeStep : stepOptions[0];
                }
            }

            // 恢复上次选择的点动步进（本机工位）
            const savedStep = parseFloat(slipway.active_step_mm);
            if (Number.isFinite(savedStep) && savedStep > 0) {
                this.activeStep = savedStep;
            }
            
            // 加载内存优化配置
            const maxTableRows = parseInt(slipway.max_table_rows);
            if (Number.isFinite(maxTableRows) && maxTableRows > 0) {
                this.MAX_TABLE_ROWS = maxTableRows;
            }
            const maxChartPoints = parseInt(slipway.max_chart_points);
            if (Number.isFinite(maxChartPoints) && maxChartPoints > 0) {
                this.MAX_CHART_POINTS = maxChartPoints;
            }
            const maxResults = parseInt(slipway.max_results_memory);
            if (Number.isFinite(maxResults) && maxResults > 0) {
                this.MAX_RESULTS_MEMORY = maxResults;
            }

            // 刷新步进UI（否则会保持slipway.html里的静态按钮）
            this.renderStepButtons();

            // 同步输入框，避免按钮/输入框不一致
            const input = document.getElementById('jog-step-input');
            if (input) input.value = this.activeStep;
            this._clampSlipwayTargetInput();
        } catch (e) {
            console.warn('[loadAndApplySlipwaySettings] 失败:', e);
        }
    },

    async saveSettings() {
        const getVal = (id) => document.getElementById(id)?.value;
        const maxPos = parseFloat(getVal('ss-max-pos'));
        const stepsStr = (getVal('ss-step-options') || '').trim();
        const stepOptions = stepsStr
            .split(',')
            .map(s => parseFloat(s.trim()))
            .filter(n => !isNaN(n) && n > 0);

        if (isNaN(maxPos) || maxPos <= 0) return Utils.toast('最大位置无效', 'warning');
        if (!stepOptions.length) return Utils.toast('步进档位无效', 'warning');

        const settings = {
            max_position_mm: maxPos,
            step_options_mm: stepOptions,
            active_step_mm: this.activeStep,
            move_min_speed: parseInt(getVal('ss-move-min') || '0', 10),
            move_max_speed: parseInt(getVal('ss-move-max') || '0', 10),
            reset_fast_min_speed: parseInt(getVal('ss-reset-fast-min') || '0', 10),
            reset_fast_max_speed: parseInt(getVal('ss-reset-fast-max') || '0', 10),
            reset_slow_min_speed: parseInt(getVal('ss-reset-slow-min') || '0', 10),
            reset_slow_max_speed: parseInt(getVal('ss-reset-slow-max') || '0', 10),
            reset_ultra_slow_min_speed: parseInt(getVal('ss-reset-ultra-min') || '0', 10),
            reset_ultra_slow_max_speed: parseInt(getVal('ss-reset-ultra-max') || '0', 10),
            home_io_num: parseInt(getVal('ss-home-io') || '4', 10),
            home_io_active_level: parseInt(getVal('ss-io-active') || '0', 10),
            limit_io_num: parseInt(getVal('ss-home-io') || '4', 10),
            limit_io_active_level: parseInt(getVal('ss-io-active') || '0', 10),
            zero_confirm_io_num: parseInt(getVal('ss-zero-confirm-io') || '-1', 10),
            zero_confirm_io_active_level: parseInt(getVal('ss-zero-confirm-active') || '0', 10),
            reset_limit_release_mm: parseFloat(getVal('ss-reset-release-mm') || '2'),
            reset_io_poll_interval: parseFloat(getVal('ss-reset-io-poll') || '0.05'),
            reset_home_confirm_samples: parseInt(getVal('ss-reset-confirm-samples') || '3', 10),
            reset_home_confirm_interval: parseFloat(getVal('ss-reset-confirm-interval') || '0.03'),
            io_watch: String(getVal('ss-io-watch') || '').trim(),
            // 内存优化配置
            max_table_rows: parseInt(getVal('ss-max-table-rows') || '500', 10),
            max_chart_points: parseInt(getVal('ss-max-chart-points') || '1000', 10),
            max_results_memory: parseInt(getVal('ss-max-results') || '5000', 10),
        };

        // 立即应用到前端
        this.maxSlipwayPosMm = maxPos;
        this._syncSlipwaySoftLimitUi();
        this.stepOptions = stepOptions;
        this.activeStep = stepOptions.includes(this.activeStep) ? this.activeStep : stepOptions[0];
        
        // 应用内存优化配置
        this.MAX_TABLE_ROWS = settings.max_table_rows;
        this.MAX_CHART_POINTS = settings.max_chart_points;
        this.MAX_RESULTS_MEMORY = settings.max_results_memory;

        try {
            this.ioWatchList = this._parseIoWatchList(settings.io_watch);
        } catch (e) {
            this.ioWatchList = [];
        }
        this.homeIoNum = Number.isFinite(settings.home_io_num) ? settings.home_io_num : this.homeIoNum;
        this.homeIoActiveLevel = Number.isFinite(settings.home_io_active_level) ? settings.home_io_active_level : this.homeIoActiveLevel;
        this._updateHomeIoStateLabel(null, null, this.homeIoNum, this.homeIoActiveLevel);

        // 更新步进UI按钮
        this.renderStepButtons();
        this._clampSlipwayTargetInput();

        // 保存到当前工位绑定的工装配置（本机）
        try {
            const profileRes = await API.settings.toolProfileGet(null);
            if (!profileRes || !profileRes.success) {
                this.closeSettings();
                return Utils.toast('未配置工位/工装参数，请到 系统设置-工位管理 配置', 'warning');
            }

            const profileId = profileRes.profile_id;
            const profile = profileRes.profile || {};
            profile.slipway = { ...(profile.slipway || {}), ...settings };

            const saveRes = await API.settings.toolProfileUpdate(profileId, profile);
            if (saveRes && saveRes.success) {
                Utils.toast('设置已保存（本机工位）', 'success');
                this.closeSettings();
            } else {
                Utils.toast('保存失败: ' + (saveRes?.message || ''), 'error');
            }
        } catch (e) {
            console.error('[saveSettings] 失败:', e);
            Utils.toast('保存异常: ' + (e.message || e), 'error');
        }
    },

    renderStepButtons() {
        const container = document.querySelector('.jog-step-group');
        if (!container) return;
        container.innerHTML = this.stepOptions.map(v => {
            const active = (v === this.activeStep) ? ' active' : '';
            return `<button class="jog-step-btn${active}" onclick="setJogStep(${v})">${v}</button>`;
        }).join('');
        const input = document.getElementById('jog-step-input');
        if (input) input.value = this.activeStep;
    },

    // 更新点动步进（UI按钮/输入框/下拉框 -> activeStep）
    setJogStep(val) {
        const n = parseFloat(val);
        if (!Number.isFinite(n) || n <= 0) return;
        this.activeStep = n;

        // 同步输入框
        const input = document.getElementById('jog-step-input');
        if (input) input.value = n;

        // 更新按钮高亮（兼容旧版按钮）
        try {
            document.querySelectorAll('.jog-step-btn').forEach(el => el.classList.remove('active'));
            const btn = Array.from(document.querySelectorAll('.jog-step-btn')).find(b => String(b.textContent).trim() === String(n));
            if (btn) btn.classList.add('active');
        } catch (e) {}

        // 轻量持久化：写回到本机工位 profile（不弹窗、不阻塞点动）
        try {
            API.settings.toolProfileGet(null).then(profileRes => {
                if (!profileRes || !profileRes.success) return;
                const profileId = profileRes.profile_id;
                const profile = profileRes.profile || {};
                const slipway = profile.slipway || {};
                if (slipway.active_step_mm === n) return;
                profile.slipway = { ...slipway, active_step_mm: n };
                API.settings.toolProfileUpdate(profileId, profile).catch(() => {});
            }).catch(() => {});
        } catch (e) {}
    },
    
    // 从DeviceHub同步状态
    syncFromHub() {
        if (!window.DeviceHub) return;
        const status = DeviceHub.status;
        this.serialConnected = status.serial.connected;
        this.slipwayConnected = status.slipway.connected;
        this.rotaryConnected = status.rotary.connected;
        this.updateUI();
        
        // 同步设备信息 (如果校准模块已获取)
        if (window.CalibrationPageV2 && CalibrationPageV2.devices && CalibrationPageV2.devices.length > 0) {
            this.updateDeviceInfo(CalibrationPageV2.devices[0]);
        }
    },
    
    destroy() {
        this.stopRefresh();
        // 保存测试数据到 sessionStorage（页面切换时保留）
        this._schedulePersistState(true);
    },

    async deactivate() {
        this._schedulePersistState(true);
    },
    
    // 保存测试状态（页面切换时调用）
    saveTestState() {
        try {
            const state = this._buildPersistState(false);
            const storageState = this._buildPersistState(true);

            try {
                window.__slipway_test_state_mem = state;
            } catch (e) {}

            try {
                sessionStorage.setItem(this.PERSIST_STATE_KEY, JSON.stringify(storageState));
                sessionStorage.setItem('slipway_test_state', JSON.stringify(storageState));
            } catch (e) {
                console.warn('[SlipwayPage] sessionStorage 保存失败，改写 localStorage 备份:', e);
            }

            try {
                localStorage.setItem(this.PERSIST_STATE_BACKUP_KEY, JSON.stringify(storageState));
            } catch (e) {}

            console.log('[SlipwayPage] 测试状态已保存，数据点:', state.resultCount);
        } catch (e) {
            console.warn('保存测试状态失败:', e);
        }
    },
    
    // 恢复测试状态（页面初始化时调用）
    restoreTestState() {
        try {
            const candidates = [];
            try {
                if (window.__slipway_test_state_mem) candidates.push(window.__slipway_test_state_mem);
            } catch (e) {}
            try {
                const saved = sessionStorage.getItem(this.PERSIST_STATE_KEY) || sessionStorage.getItem('slipway_test_state');
                if (saved) candidates.push(JSON.parse(saved));
            } catch (e) {}
            try {
                const backup = localStorage.getItem(this.PERSIST_STATE_BACKUP_KEY);
                if (backup) candidates.push(JSON.parse(backup));
            } catch (e) {}

            let state = null;
            for (const item of candidates) {
                if (!item || typeof item !== 'object') continue;
                if (!state || Number(item.timestamp || 0) > Number(state.timestamp || 0)) {
                    state = item;
                }
            }
            if (!state) return false;
            
            // 检查数据是否过期（超过1小时则丢弃）
            if (Date.now() - state.timestamp > 3600000) {
                this._clearPersistedTestState();
                return false;
            }
            
            // 恢复状态
            this.testResults = state.testResults || [];
            this.activeSegmentTab = state.activeSegmentTab || 'all';
            this.testMode = state.testMode || 'basic';
            this.segments = state.segments || [];
            this.activeReflectance = state.activeReflectance || 90;
            this._trimResultsMemory();
            this.segmentResults = this._cloneSegmentResultsMap(state.segmentResults || {});

            if (this.testResults.length === 0 && state.segmentResults && typeof state.segmentResults === 'object') {
                this.segmentResults = state.segmentResults || {};
            } else if (this.testResults.length > 0 && Object.keys(this.segmentResults).length === 0) {
                this._rebuildSegmentResultsFromResults(this.testResults);
            }
            this._failedPoints = Array.isArray(state.failedPoints) ? state.failedPoints : null;
            
            // 如果测试正在进行中，需要重新监听后端进度
            if (state.testRunning) {
                this.testRunning = true;
                // 重新绑定 WebSocket 监听
                this._bindTestProgressListener();
            }
            
            console.log('[SlipwayPage] 测试状态已恢复，数据点:', this.testResults.length);
            
            // 恢复UI显示
            setTimeout(() => {
                // 更新分段Tab（如果有分段数据）
                if (Object.keys(this.segmentResults).length > 0) {
                    this.updateSegmentTabs();
                }
                this.renderResultsTable();
                this.updateErrorChart();
                this.updateStats();
                if (this._failedPoints && this._failedPoints.length > 0) {
                    this.showFailedPointsSummary(this._failedPoints);
                } else {
                    this.hideFailedBar();
                }
                this._applyReflectanceUi(this.activeReflectance);
                // 恢复测试模式UI
                if (this.testMode === 'advanced') {
                    try { this.switchMode('advanced'); } catch (e) {}
                } else {
                    try { this.switchMode('basic'); } catch (e) {}
                }

                // 关键：切回页面后以设备真实状态为准（避免session里旧值覆盖UI）
                try { this.updateStatus(); } catch (e) {}
            }, 100);
            
            return true;
        } catch (e) {
            console.warn('恢复测试状态失败:', e);
            return false;
        }
    },
    
    // 绑定测试进度监听器
    _bindTestProgressListener() {
        // 统一使用 api.js 的 window.onBackendEvent -> document 事件分发链路。
        // 这里不要覆盖全局分发器，否则后端推送的 test_progress/test_complete
        // 无法继续派发到页面级监听器，实时表格会变成空白。
        if (window.__slipway_backend_events_bound) return;
        window.__slipway_backend_events_bound = true;
        document.addEventListener('backend:test_progress', (e) => this.onTestProgress(e.detail));
        document.addEventListener('backend:test_complete', (e) => this.onTestComplete(e.detail));
        document.addEventListener('backend:test_segment_change', (e) => this.onSegmentChange(e.detail));
    },

    // 高级模式段切换事件（后端推送）
    onTestSegmentChange(data) {
        if (!data || typeof data.segment_idx === 'undefined') return;
        const segIdx = data.segment_idx;
        const segName = data.segment_name || `段${segIdx + 1}`;
        console.log(`[SlipwayPage] 切换到段: ${segName} (idx=${segIdx})`);
        // 更新当前段Tab
        this.activeSegmentTab = segIdx.toString();
        this.updateSegmentTabs();
        // 可选：显示提示
        Utils.toast(`切换到 ${segName}`, 'info', 2000);
    },
    
    startRefresh() {
        if (!this.refreshTimer) {
            this.refreshTimer = setInterval(() => this.updateStatus(), 1000);  // 1秒刷新
        }
    },
    
    stopRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    },

    bindEvents() {
        // 本机浏览器记忆：任何输入变化都自动保存
        const bind = (id, evt = 'input') => {
            const el = document.getElementById(id);
            if (!el || el._lsBound) return;
            el._lsBound = true;
            el.addEventListener(evt, () => this.saveUiStateToLocal());
        };

        bind('slipway-ip');
        bind('slipway-target');
        bind('jog-step-input');
        bind('test-start');
        bind('test-end');
        bind('test-step');
        bind('test-repeats');
        bind('err-threshold');
        bind('point-time');

        const btnCheckHomeIo = document.getElementById('btn-check-home-io');
        if (btnCheckHomeIo) {
            btnCheckHomeIo.type = 'button';
            btnCheckHomeIo.style.pointerEvents = 'auto';
            btnCheckHomeIo.title = '手动检测限位IO（已绑定）';
            btnCheckHomeIo.onclick = (e) => {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation && e.stopImmediatePropagation();
                } catch (err) {}
                console.info('[SlipwayPage] 检测IO按钮 onclick 触发');
                return this.checkHomeIo();
            };
            btnCheckHomeIo._boundHomeIoClick = true;
        }
        if (!this._docHomeIoCaptureBound) {
            this._docHomeIoCaptureBound = true;
            document.addEventListener('click', (e) => {
                const btn = e && e.target && typeof e.target.closest === 'function'
                    ? e.target.closest('#btn-check-home-io')
                    : null;
                if (!btn) return;
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation && e.stopImmediatePropagation();
                } catch (err) {}
                console.info('[SlipwayPage] 捕获到检测IO点击');
                this.checkHomeIo();
            }, true);
        }
    },

    bindUiParams() {
        const th = document.getElementById('err-threshold');
        const pt = document.getElementById('point-time');
        if (th) {
            const v = parseFloat(th.value);
            if (Number.isFinite(v) && v > 0) this.errorThresholdMm = v;
            th.addEventListener('input', () => {
                const vv = parseFloat(th.value);
                if (Number.isFinite(vv) && vv > 0) this.errorThresholdMm = vv;
                this.renderSegmentPreview();
                this.updateErrorChart();
            });
        }
        if (pt) {
            const v = parseFloat(pt.value);
            if (Number.isFinite(v) && v > 0) this.estPointTimeSec = v;
            pt.addEventListener('input', () => {
                const vv = parseFloat(pt.value);
                if (Number.isFinite(vv) && vv > 0) this.estPointTimeSec = vv;
                this.renderSegmentPreview();
            });
        }
    },

    // ========== 状态更新 ==========
    
    async updateStatus() {
        try {
            // 同步串口状态（以DeviceHub为准）
            try {
                if (window.DeviceHub && DeviceHub.status && DeviceHub.status.serial) {
                    this.serialConnected = !!DeviceHub.status.serial.connected;
                }
            } catch (e) {}

            // 获取滑台状态
            const slipway = await API.slipway.getStatus();
            this.slipwayConnected = slipway.connected;
            this.slipwayPos = slipway.position ?? 0;
            this.slipwayState = slipway.connected ? (slipway.state || '空闲') : '离线';
            this.slipwayResetDone = (slipway && (slipway.reset_done !== undefined) && (slipway.reset_done !== null)) ? !!slipway.reset_done : null;

            try {
                const ev = slipway && slipway.last_event;
                const eid = ev && ev.id;
                if (eid !== undefined && eid !== null) {
                    const last = this._lastSlipwayEventId;
                    if (last === undefined || last === null || Number(eid) > Number(last)) {
                        this._lastSlipwayEventId = Number(eid);
                        const msg = (ev && ev.msg) ? String(ev.msg) : '进入慢段减速';
                        Utils.toast(msg, 'info');
                    }
                }
            } catch (e) {}
            
            // 获取转靶状态 (尝试自动连接或查询)
            const rotary = await API.slipway.rotaryGetStatus();
            this.rotaryConnected = rotary.connected;
            this.rotaryPos = rotary.position ?? 0;

            try {
                if (rotary && rotary.reflectance !== undefined && rotary.reflectance !== null) {
                    const v = parseInt(String(rotary.reflectance).replace('%', ''), 10);
                    if (Number.isFinite(v) && v > 0) {
                        this._applyReflectanceUi(v);
                    }
                }
            } catch (e) {}

            // 同步测试运行状态（以后台为准，避免切页后前端自状态不一致）
            try {
                const ts = await API.slipway.getTestStatus();
                const running = !!(ts && ts.running);
                this.testRunning = running;
                if (running) {
                    const modeName = (ts.mode === 'plan') ? '高级模式' : (ts.mode === 'accuracy' ? '基础模式' : '测试中');
                    const panel = document.getElementById('test-progress-panel');
                    const isShown = !!(panel && panel.style.display !== 'none');
                    if (!isShown) {
                        this.showProgressPanel(modeName);
                    }
                } else {
                    this.hideProgressPanel();
                }
            } catch (e) {}
            
            this.updateUI();
        } catch (e) {
            console.warn('状态更新异常:', e);
        }
    },
    
    updateUI() {
        // 1. 顶部状态栏
        const hSlipway = document.getElementById('header-slipway-status');
        const hRotary = document.getElementById('header-rotary-status');
        
        if (hSlipway) {
            hSlipway.textContent = this.slipwayConnected ? '在线' : '离线';
            hSlipway.style.color = this.slipwayConnected ? '#84fab0' : '#aaa';
        }
        if (hRotary) {
            // 转靶与滑台共用同一套控制器/链路：用滑台连接状态即可
            hRotary.textContent = this.slipwayConnected ? '在线' : '离线';
            hRotary.style.color = this.slipwayConnected ? '#84fab0' : '#aaa';
        }

        // 2. 连接按钮状态
        const btnConnect = document.getElementById('btn-connect');
        if (btnConnect) {
            // 这里我们主要显示滑台连接状态，因为它是主的
            btnConnect.textContent = this.slipwayConnected ? '断开连接' : '连接设备';
            btnConnect.style.background = this.slipwayConnected 
                ? 'var(--btn-grad-stop)' 
                : 'var(--btn-grad-conn)';
        }

        // 3. 滑台 Tab 数据
        const elSlipwayPos = document.getElementById('slipway-pos');
        if (elSlipwayPos) elSlipwayPos.value = this.slipwayPos.toFixed(3);

        // 4. 底部状态栏
        const fConn = document.getElementById('comm-status');
        if (fConn) {
            if (this.slipwayConnected && this.serialConnected) {
                if (this.slipwayResetDone === false) {
                    fConn.textContent = '未复位';
                    fConn.style.color = '#ffcc66';
                } else {
                    fConn.textContent = '正常';
                    fConn.style.color = '#84fab0';
                }
            } else if (this.slipwayConnected && !this.serialConnected) {
                fConn.textContent = '串口断开';
                fConn.style.color = '#ffcc66';
            } else {
                fConn.textContent = '断开';
                fConn.style.color = '#ff6b6b';
            }
        }
        
        // 5. 滑台/转靶状态显示
        const slipwayDot = document.getElementById('slipway-status-dot');
        const slipwayPosVal = document.getElementById('slipway-pos-val');
        if (slipwayDot) {
            slipwayDot.className = 'status-icon' + (this.slipwayConnected ? ' online' : '');
        }
        if (slipwayPosVal) {
            slipwayPosVal.textContent = this.slipwayPos.toFixed(3) + ' mm';
        }
        
        const rotaryDot = document.getElementById('rotary-status-dot');
        if (rotaryDot) {
            // 转靶与滑台共用同一套控制器/链路：用滑台连接状态即可
            rotaryDot.className = 'status-icon' + (this.slipwayConnected ? ' online' : '');
        }
        
        // 6. 顶部位置显示
        const headerPos = document.getElementById('header-pos');
        if (headerPos) {
            headerPos.textContent = this.slipwayPos.toFixed(3);
        }
        
        // 7. 统计栏当前位置
        const statPos = document.getElementById('stat-pos');
        if (statPos) {
            statPos.textContent = this.slipwayPos.toFixed(3);
        }
        
        // 8. 左侧控制面板位置显示
        const slipwayPosDisplay = document.getElementById('slipway-pos-display');
        if (slipwayPosDisplay) {
            slipwayPosDisplay.textContent = this.slipwayPos.toFixed(3);
        }
        
        // 9. 左侧控制面板转靶显示
        const rotaryRefDisplay = document.getElementById('rotary-ref-display');
        if (rotaryRefDisplay) {
            rotaryRefDisplay.textContent = this.activeReflectance + '%';
        }

        // 10. 测试运行状态：按钮/模式切换同步
        try {
            const startBtn = document.querySelector('.action-area .big-btn.start');
            const stopBtn = document.querySelector('.action-area .big-btn.stop');
            if (startBtn) startBtn.disabled = !!this.testRunning;
            if (stopBtn) stopBtn.disabled = !this.testRunning;

            const basicBtn = document.getElementById('mode-basic-btn');
            const advancedBtn = document.getElementById('mode-advanced-btn');
            if (basicBtn) basicBtn.disabled = !!this.testRunning;
            if (advancedBtn) advancedBtn.disabled = !!this.testRunning;
        } catch (e) {}
    },
    
    // 更新设备信息 (从校准模块同步)
    updateDeviceInfo(info) {
        if (info) {
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || '--';
            };
            setVal('dev-model', info.model_name || info.model);
            setVal('dev-sn', info.device_id ? info.device_id.toString(16).toUpperCase() : info.sn);
            setVal('dev-version', info.sw_version || info.version);
        }
    },

    // ========== 设备控制 ==========
    
    async toggleSlipway() {
        // 使用DeviceHub连接
        if (!window.DeviceHub) {
            Utils.toast('DeviceHub未初始化', 'error');
            return;
        }
        
        if (this.slipwayConnected) {
            // 断开设备（滑台/转靶共用同一连接）
            await DeviceHub.disconnectSlipway();
            Utils.toast('设备已断开', 'info');
        } else {
            const inputVal = document.getElementById('slipway-ip').value;
            let ip = '192.168.2.46';
            let port = 6000;

            if (inputVal.includes(':')) {
                const parts = inputVal.split(':');
                ip = parts[0];
                port = parseInt(parts[1]);
            } else {
                ip = inputVal;
            }
            
            if (!ip) return Utils.toast('请输入IP地址', 'warning');
            
            Utils.toast('正在连接设备...', 'info');
            
            // 通过DeviceHub连接滑台
            const res1 = await DeviceHub.connectSlipway(ip, port);
            
            if (res1.success) {
                Utils.toast('滑台连接成功', 'success');
                // 首次连接成功后，弹出复位确认对话框
                this.showFirstConnectDialog();
            } else {
                Utils.toast('滑台连接失败: ' + (res1.error || '未知错误'), 'error');
            }
        }
        this.syncFromHub();

        // 关键：连接/断开后立刻回读一次，确保顶部/左侧/位置/反射率显示同步
        try { await this.updateStatus(); } catch (e) {}
    },
    
    // 首次连接确认对话框
    showFirstConnectDialog() {
        // 创建对话框
        const overlay = document.createElement('div');
        overlay.id = 'first-connect-overlay';
        overlay.className = 'modal-overlay show';
        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width: 450px;">
                <div class="modal-header">
                    <h3>⚠️ 首次连接确认</h3>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <p style="margin-bottom: 16px; color: #ffc864;">
                        滑台/转靶已连接成功，请确认设备位置是否正确：
                    </p>
                    <ul style="margin: 0 0 16px 20px; color: #aaa; line-height: 1.8;">
                        <li>滑台当前位置是否在安全范围内？</li>
                        <li>转靶是否处于正确的反射率位置？</li>
                        <li>周围是否有障碍物？</li>
                    </ul>
                    <p style="color: #ff6b6b; font-size: 13px;">
                        如果位置不确定，建议先执行复位操作。
                    </p>
                </div>
                <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 20px;">
                    <button class="btn" onclick="SlipwayPage.closeFirstConnectDialog()" style="min-width: 100px;">
                        位置正确，继续
                    </button>
                    <button class="btn primary" onclick="SlipwayPage.doFirstConnectReset()" style="min-width: 100px;">
                        执行复位
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    },
    
    closeFirstConnectDialog() {
        const overlay = document.getElementById('first-connect-overlay');
        if (overlay) {
            overlay.remove();
        }
    },
    
    async doFirstConnectReset() {
        this.closeFirstConnectDialog();
        
        // 询问是否同时复位转靶
        const resetRotary = confirm('是否同时复位转靶？\n\n点击"确定"同时复位滑台和转靶\n点击"取消"仅复位滑台');
        
        Utils.toast('正在执行复位...', 'info');
        
        // 复位滑台
        const slipwayRes = await API.slipway.reset();
        if (!slipwayRes.success) {
            Utils.toast('滑台复位失败: ' + (slipwayRes.message || ''), 'error');
            return;
        }
        
        // 复位转靶（如果用户选择）
        if (resetRotary) {
            const rotaryRes = await API.slipway.rotaryReset();
            if (!rotaryRes.success) {
                Utils.toast('转靶复位失败: ' + (rotaryRes.message || ''), 'warning');
            } else {
                Utils.toast('滑台和转靶复位完成', 'success');
                return;
            }
        }
        
        Utils.toast('滑台复位完成', 'success');
    },
    
    async homeSlipway() {
        if (!this.canOperateSlipway()) return Utils.toast('请先连接滑台或开启仿真模式', 'warning');
        
        // 复位前先更新配置（从设置中读取）
        try {
            const profileRes = await API.settings.toolProfileGet(null);
            if (profileRes && profileRes.success) {
                const slipway = profileRes.profile?.slipway || {};
            await API.call('slipway_update_reset_config',
                slipway.reset_fast_min_speed ?? null,
                slipway.reset_fast_max_speed ?? null,
                slipway.reset_slow_min_speed ?? null,
                slipway.reset_slow_max_speed ?? null,
                slipway.reset_ultra_slow_min_speed ?? null,
                slipway.reset_ultra_slow_max_speed ?? null,
                slipway.home_io_num ?? null,
                slipway.home_io_active_level ?? null,
                slipway.limit_io_num ?? null,
                slipway.limit_io_active_level ?? null,
                slipway.zero_confirm_io_num ?? null,
                slipway.zero_confirm_io_active_level ?? null,
                slipway.reset_limit_release_mm ?? null,
                slipway.reset_io_poll_interval ?? null,
                slipway.reset_home_confirm_samples ?? null,
                slipway.reset_home_confirm_interval ?? null
            );
            }
        } catch (e) {
            console.warn('更新复位配置失败:', e);
        }
        
        Utils.toast('滑台正在复位...', 'info');
        const res = await API.slipway.reset();
        if (!res.success) Utils.toast('复位失败', 'error');
    },
    
    async stopSlipway() {
        if (!this.canOperateSlipway()) return;
        await API.slipway.stop();
        Utils.toast('滑台已停止', 'warning');
    },
    
    async moveSlipway() {
        console.log('[moveSlipway] 被调用');
        if (!this.canOperateSlipway()) {
            console.log('[moveSlipway] 滑台未连接且非仿真模式');
            return Utils.toast('请先连接滑台或开启仿真模式', 'warning');
        }
        
        const target = this._clampSlipwayTargetInput();
        console.log('[moveSlipway] 目标位置(mm):', target);
        if (!Number.isFinite(target)) return Utils.toast('请输入有效目标位置', 'warning');

        if (target < 0 || target > this.maxSlipwayPosMm) {
            return Utils.toast(`目标位置超出软限位范围 (0~${this.maxSlipwayPosMm}mm)`, 'warning');
        }
        
        Utils.toast(`正在移动到 ${target}mm...`, 'info');
        try {
            const res = await API.slipway.moveTo(target);
            console.log('[moveSlipway] 结果:', res);
            if (!res.success) {
                Utils.toast('移动命令失败: ' + (res.message || ''), 'error');
            } else {
                // 移动命令发送成功后，启动位置轮询直到到达目标
                this._pollPositionUntilIdle(target);
            }
        } catch (e) {
            console.error('[moveSlipway] 异常:', e);
            Utils.toast('移动异常: ' + e.message, 'error');
        }
    },
    
    // 轮询位置直到滑台空闲（移动完成）
    async _pollPositionUntilIdle(targetPos) {
        const maxPolls = 600;  // 最多轮询60秒
        const pollInterval = 100;  // 100ms轮询一次
        
        for (let i = 0; i < maxPolls; i++) {
            try {
                const status = await API.slipway.getStatus();
                this.slipwayPos = status.position || 0;
                this.slipwayState = status.state || 'idle';
                this.updateUI();
                
                // 如果滑台已停止移动
                if (status.state !== 'moving') {
                    console.log(`[_pollPositionUntilIdle] 移动完成，当前位置: ${this.slipwayPos}mm`);
                    // 最终位置确认
                    await this.updateStatus();
                    return;
                }
            } catch (e) {
                console.warn('[_pollPositionUntilIdle] 轮询异常:', e);
            }
            
            await new Promise(r => setTimeout(r, pollInterval));
        }
        
        console.warn('[_pollPositionUntilIdle] 轮询超时');
        await this.updateStatus();
    },
    
    // 点动控制 (步进)
    async jogPos() {
        this.jogStep(this._getJogStepDelta(+1));
    },
    
    async jogNeg() {
        this.jogStep(this._getJogStepDelta(-1));
    },

    _getJogStepDelta(dir) {
        // dir: +1 or -1
        let step = this.activeStep;
        try {
            const input = document.getElementById('jog-step-input');
            const v = parseFloat(input?.value);
            if (Number.isFinite(v) && v > 0) step = v;
        } catch (e) {}
        if (!Number.isFinite(step) || step <= 0) step = 10;
        this.activeStep = step;
        return step * (dir >= 0 ? 1 : -1);
    },
    
    async jogStep(delta) {
        console.log('[jogStep] delta:', delta);
        if (!this.canOperateSlipway()) {
            console.log('[jogStep] 滑台未连接且非仿真模式');
            return Utils.toast('请先连接滑台或开启仿真模式', 'warning');
        }
        const target = this.slipwayPos + delta;
        console.log('[jogStep] 当前(mm):', this.slipwayPos, '目标(mm):', target);
        if (target < 0 || target > this.maxSlipwayPosMm) return Utils.toast(`超出软限位范围 (0~${this.maxSlipwayPosMm}mm)`, 'warning');
        
        Utils.toast(`正在移动到 ${target.toFixed(1)}mm...`, 'info');
        try {
            const res = await API.slipway.moveTo(target);
            console.log('[jogStep] 结果:', res);
            if (!res.success) {
                Utils.toast('移动失败', 'error');
            } else {
                // 移动命令发送成功后，启动位置轮询直到到达目标
                this._pollPositionUntilIdle(target);
            }
        } catch (e) {
            console.error('[jogStep] 异常:', e);
        }
    },

    // ========== 转靶控制 ==========
    
    async homeRotary() {
        if (!this.canOperateRotary()) return Utils.toast('请先连接滑台或开启仿真模式', 'warning');
        Utils.toast('转靶正在复位...', 'info');
        const res = await API.slipway.rotaryReset();
        if (res.success) {
            Utils.toast('转靶复位成功', 'success');
            // 复位后默认为0位置? 实际上通常复位后需要设置反射率
        } else {
            Utils.toast('转靶复位失败', 'error');
        }
    },
    
    async setReflectance(val) {
        if (!this.canOperateRotary()) return Utils.toast('请先连接滑台或开启仿真模式', 'warning');
        
        val = this._normReflectance(val);

        // 同步下拉框
        const select = document.getElementById('rotary-ref-select');
        if (select) select.value = val;
        
        Utils.toast(`切换反射率到 ${val}%...`, 'info');
        try {
            const res = await API.slipway.rotaryMoveTo(val);
            if (res.success) {
                // 更新UI显示（统一同步）
                this._applyReflectanceUi(val);
                Utils.toast(`反射率已切换到 ${val}%`, 'success');
            } else {
                Utils.toast('切换失败: ' + (res.message || ''), 'error');
                try { await this.updateStatus(); } catch (e) {}
            }
        } catch (e) {
            console.error('[setReflectance] 异常:', e);
            Utils.toast('切换反射率异常', 'error');
            try { await this.updateStatus(); } catch (e2) {}
        }
    },

    // ========== 精度测试 ==========
    
    async startTest() {
        console.log('[startTest] 被调用');
        
        // 检查滑台连接（仿真模式除外）
        if (!this.slipwayConnected && !(window.DeviceHub && DeviceHub.simulationEnabled)) {
            console.log('[startTest] 滑台未连接');
            return Utils.toast('请先连接滑台设备', 'warning');
        }
        
        // 检查串口连接（仿真模式除外）- 测距需要串口
        if (!this.serialConnected && !(window.DeviceHub && DeviceHub.simulationEnabled)) {
            console.log('[startTest] 串口未连接');
            return Utils.toast('请先连接串口设备（测距需要串口）', 'warning');
        }

        if (this.slipwayResetDone === false && !(window.DeviceHub && DeviceHub.simulationEnabled)) {
            return Utils.toast('请先复位滑台（回零）', 'warning');
        }
        
        if (this.testRunning) return Utils.toast('测试已在运行中', 'warning');

        // 仅在高级模式下才使用 segments 计划
        const isAdvanced = this.testMode === 'advanced';
        const planText = isAdvanced ? (document.getElementById('test-plan')?.value || '').trim() : '';
        
        const params = {
            start_pos: parseFloat(document.getElementById('test-start').value),
            end_pos: parseFloat(document.getElementById('test-end').value),
            step: parseFloat(document.getElementById('test-step').value),
            repeats: parseInt(document.getElementById('test-repeats').value),
            reflectance: this._normReflectance(this.activeReflectance || 90)  // 当前选择的反射率
        };
        
        this.testResults = [];
        this.segmentResults = {};  // 清空分段结果
        this.activeSegmentTab = 'all';  // 重置为全部Tab
        this._lastSegmentIdx = -1;  // 重置段索引追踪
        this._testStartTime = Date.now();  // 记录开始时间
        this.testRunning = true;
        this._resetRateStats();
        this.updateStats();
        const tbody = document.getElementById('results-tbody');
        if (tbody) tbody.innerHTML = ''; // 清空表格
        this.updateSegmentTabs();  // 刷新Tab显示
        
        // 显示进度面板
        this.showProgressPanel(isAdvanced ? '高级模式' : '基础模式');

        let res = null;
        if (isAdvanced) {
            try {
                // 高级模式：确保segments与textarea一致（以segments为准）并校验
                try {
                    if (!this.segEditorInited) this.initSegmentEditor();
                    this.validateSegmentsAndSync(true);
                } catch (e) {}

                const segments = JSON.parse(planText);
                if (!Array.isArray(segments) || segments.length === 0) {
                    this.testRunning = false;
                    this.hideProgressPanel();
                    return Utils.toast('高级流程segments为空', 'warning');
                }
                res = await API.slipway.startPlan({ segments });
            } catch (e) {
                this.testRunning = false;
                this.hideProgressPanel();
                return Utils.toast('高级流程JSON解析失败: ' + (e.message || e), 'error');
            }
        } else {
            res = await API.slipway.startAccuracyTest(params);
        }
        if (res.success) {
            Utils.toast(`${isAdvanced ? '高级' : '基础'}测试已启动`, 'success');
        } else {
            this.testRunning = false;
            this.hideProgressPanel();
            Utils.toast('启动失败: ' + res.message, 'error');
        }
    },
    
    // 显示进度面板
    showProgressPanel(modeName) {
        let panel = document.getElementById('test-progress-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'test-progress-panel';
            panel.className = 'progress-panel';
            const container = document.querySelector('.slipway-container') || document.body;
            container.appendChild(panel);
        }
        
        panel.innerHTML = `
            <div class="progress-header">
                <span class="progress-mode">${modeName}</span>
                <span class="progress-status">测试中...</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" id="test-progress-bar" style="width: 0%"></div>
            </div>
            <div class="progress-info">
                <span id="progress-step">0 / 0</span>
                <span id="progress-time">已用时: 0s</span>
                <span id="progress-eta">预计剩余: --</span>
            </div>
            <div class="progress-current" id="progress-current-action">准备中...</div>
        `;
        panel.style.display = 'block';
        
        // 启动时间更新
        this._progressTimer = setInterval(() => this.updateProgressTime(), 1000);
    },
    
    // 隐藏进度面板
    hideProgressPanel() {
        const panel = document.getElementById('test-progress-panel');
        if (panel) panel.style.display = 'none';
        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
    },
    
    // 更新进度时间
    updateProgressTime() {
        if (!this._testStartTime) return;
        const elapsed = Math.floor((Date.now() - this._testStartTime) / 1000);
        const timeEl = document.getElementById('progress-time');
        if (timeEl) {
            const min = Math.floor(elapsed / 60);
            const sec = elapsed % 60;
            timeEl.textContent = `已用时: ${min > 0 ? min + 'm ' : ''}${sec}s`;
        }
    },
    
    // 更新进度显示
    updateProgress(data) {
        const bar = document.getElementById('test-progress-bar');
        const stepEl = document.getElementById('progress-step');
        const etaEl = document.getElementById('progress-eta');
        const actionEl = document.getElementById('progress-current-action');
        const statusEl = document.querySelector('.progress-status');
        
        if (data.percent !== undefined && bar) {
            bar.style.width = data.percent + '%';
        }
        if (data.step !== undefined && data.total !== undefined && stepEl) {
            stepEl.textContent = `${data.step} / ${data.total}`;
        }
        
        // 计算预计剩余时间
        if (data.step > 0 && data.total > 0 && this._testStartTime) {
            const elapsed = (Date.now() - this._testStartTime) / 1000;
            const avgTime = elapsed / data.step;
            const remaining = Math.ceil(avgTime * (data.total - data.step));
            if (etaEl) {
                if (remaining > 60) {
                    etaEl.textContent = `预计剩余: ${Math.floor(remaining / 60)}m ${remaining % 60}s`;
                } else {
                    etaEl.textContent = `预计剩余: ${remaining}s`;
                }
            }
        }
        
        // 显示当前动作
        if (data.result && actionEl) {
            const r = data.result;
            if (r.segment_idx !== undefined) {
                actionEl.textContent = `段${r.segment_idx + 1} | 位置: ${r.target}mm | 测量值: ${r.actual?.toFixed(1) || '--'}mm`;
            } else {
                actionEl.textContent = `位置: ${r.target}mm | 测量值: ${r.actual?.toFixed(1) || '--'}mm`;
            }
        }
        
        if (statusEl) {
            statusEl.textContent = '测试中...';
        }
    },
    
    async stopTest() {
        if (!this.testRunning) return;
        await API.slipway.stopTest();
        this.testRunning = false;
        this.hideProgressPanel();
        Utils.toast('测试已停止', 'warning');
        
        // 检查是否可以断点续测
        this.checkResumeAvailable();
    },
    
    // 检查断点续测
    async checkResumeAvailable() {
        try {
            const res = await API.slipway.getTestProgress();
            if (res?.can_resume) {
                this.showResumePrompt(res.progress);
            }
        } catch (e) {
            console.warn('检查断点续测失败:', e);
        }
    },
    
    // 显示断点续测提示
    showResumePrompt(progress) {
        const resumeFrom = progress?.resume_from || 0;
        const mode = progress?.mode === 'plan' ? '高级模式' : '基础模式';
        const resultsCount = Number.isFinite(Number(progress?.result_count))
            ? Number(progress.result_count)
            : (progress?.results?.length || 0);
        const isAdvanced = progress?.mode === 'plan';
        const segments = progress?.segments || [];
        const currentSegment = progress?.current_segment || 0;
        
        // 保存进度信息供后续使用
        this._resumeProgress = progress;
        
        let resumeBar = document.getElementById('resume-bar');
        if (!resumeBar) {
            resumeBar = document.createElement('div');
            resumeBar.id = 'resume-bar';
            resumeBar.className = 'resume-bar';
            const container = document.querySelector('.slipway-container') || document.body;
            container.insertBefore(resumeBar, container.firstChild);
        }
        
        // 高级模式下显示段选择
        let segmentOptions = '';
        if (isAdvanced && segments.length > 0) {
            segmentOptions = `
                <div class="resume-segment-select">
                    <span>选择重测起点:</span>
                    <select id="resume-segment-select" class="resume-select">
                        <option value="-1">从断点继续 (段${currentSegment + 1})</option>
                        ${segments.map((seg, idx) => `
                            <option value="${idx}">从段${idx + 1}开始 (${seg.reflectance || '--'}%)</option>
                        `).join('')}
                    </select>
                </div>
            `;
        }
        
        resumeBar.innerHTML = `
            <div class="resume-info">
                <span class="resume-icon">⏸️</span>
                <span>上次测试中断 (${mode}，已完成 ${resultsCount} 点${isAdvanced ? `，当前段${currentSegment + 1}` : ''})</span>
            </div>
            ${segmentOptions}
            <div class="resume-actions">
                <button class="btn-small primary" onclick="SlipwayPage.resumeTest()">继续测试</button>
                <button class="btn-small" onclick="SlipwayPage.clearTestProgress()">放弃</button>
            </div>
        `;
        resumeBar.style.display = 'flex';
    },
    
    // 断点续测
    async resumeTest() {
        if (this.testRunning) {
            return Utils.toast('测试正在进行中', 'warning');
        }
        
        try {
            // 获取用户选择的重测起点（高级模式）
            let fromSegment = -1;  // -1 表示从断点继续
            const selectEl = document.getElementById('resume-segment-select');
            if (selectEl) {
                fromSegment = parseInt(selectEl.value, 10);
            }
            
            const res = await API.slipway.resumeTest(fromSegment);
            if (res?.success) {
                this.testRunning = true;
                this.hideResumeBar();
                this.showProgressPanel('断点续测');
                Utils.toast(res.message || '已继续测试', 'success');
            } else {
                Utils.toast(res?.message || '续测失败', 'error');
            }
        } catch (e) {
            Utils.toast('续测失败: ' + e.message, 'error');
        }
    },
    
    // 清除测试进度
    async clearTestProgress() {
        try {
            await API.slipway.clearTestProgress();
            this.hideResumeBar();
            Utils.toast('已清除测试进度', 'info');
        } catch (e) {
            console.warn('清除进度失败:', e);
        }
    },
    
    // 隐藏续测提示
    hideResumeBar() {
        const bar = document.getElementById('resume-bar');
        if (bar) bar.style.display = 'none';
    },
    
    // 收到测试进度/结果 (由后端事件触发)
    onTestProgress(data) {
        // 更新进度面板
        this.updateProgress(data);
        
        // data.result 包含单点结果 {step, target, actual, error, time, segment_idx}
        if (data && data.result) {
            const r = data.result;
            try {
                if (!this._progressDedup) this._progressDedup = new Map();
                const key = [r.step, r.sample, r.target, r.reflectance, r.segment_idx].join('|');
                const now = Date.now();
                const last = this._progressDedup.get(key);
                if (last && (now - last) < 800) {
                    return;
                }
                this._progressDedup.set(key, now);
                if (this._progressDedup.size > 2000) {
                    this._progressDedup.clear();
                }
            } catch (e) {}

            // 记录测距频率/卡顿信息（独立于表格/图表渲染频率）
            try { this._updateRateFromResult(r); } catch (e) {}

            this.testResults.push(r);
            if (r.segment_idx !== undefined && r.segment_idx !== null) {
                this.addResultToSegment(r.segment_idx, r);
            }

            const trimmed = this._trimResultsMemory();
            if (trimmed > 0) {
                console.log(`[内存优化] 结果数组已裁剪，释放 ${trimmed} 条，保留 ${this.testResults.length} 条`);
            }

            // 重渲染表格/图表/统计使用节流，避免高频点导致前端“卡卡的”
            this._scheduleUiUpdate();
            this._schedulePersistState();
        }
    },

    async measureOnce() {
        const outEl = document.getElementById('ss-measure-once-result');
        const setOut = (s) => { if (outEl) outEl.textContent = String(s || ''); };

        try {
            if (!this.canMeasure()) {
                setOut('串口未连接（或未开启仿真模式）');
                return Utils.toast('请先连接串口（DeviceHub）', 'warning');
            }

            setOut('测距中...');
            const res = await API.slipway.measureOnce(null);
            if (!res || !res.success) {
                const msg = res?.error || '调用失败';
                setOut('失败: ' + msg);
                return Utils.toast('测距失败: ' + msg, 'error');
            }

            const r = res.result || {};
            if (r.success) {
                const mm = Number(r.distance);
                const ms = Number(r.time_ms);
                const mt = r.measure_type || 'current';
                const raw = Array.isArray(r.raw_lines) ? r.raw_lines.slice(-6).join(' | ') : '';
                const refl = (r.refl !== undefined && r.refl !== null) ? `, refl=${r.refl}` : '';
                setOut(`OK [${mt}] ${Number.isFinite(mm) ? mm.toFixed(3) : r.distance} mm, ${Number.isFinite(ms) ? ms : r.time_ms} ms${refl}${raw ? ' | ' + raw : ''}`);
                return;
            }

            const err = r.error || '测距失败';
            const raw = Array.isArray(r.raw_lines) ? r.raw_lines.slice(-6).join(' | ') : '';
            setOut(`FAIL: ${err}${raw ? ' | ' + raw : ''}`);
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            setOut('异常: ' + msg);
            Utils.toast('测距异常: ' + msg, 'error');
        }
    },

    _resetRateStats() {
        this._rateSamples = [];
        this._rateStutterCount = 0;
        this._lastMeasureGapMs = null;
        try {
            const el = document.getElementById('stat-hz');
            if (el) {
                el.textContent = '--';
                el.title = '';
                el.style.color = '#38bdf8';
            }
        } catch (e) {}
    },

    _updateRateFromResult(r) {
        const el = document.getElementById('stat-hz');
        if (!el) return;

        let ts = Date.now();
        try {
            const p = r && r.timestamp ? Date.parse(r.timestamp) : NaN;
            if (Number.isFinite(p)) ts = p;
        } catch (e) {}

        const timeMsRaw = (r && (r.time_ms ?? r.timeMs)) ?? null;
        const timeMs = Number.isFinite(Number(timeMsRaw)) ? Number(timeMsRaw) : null;

        const prev = this._rateSamples.length ? this._rateSamples[this._rateSamples.length - 1] : null;
        if (prev && Number.isFinite(prev.ts)) {
            const gap = ts - prev.ts;
            this._lastMeasureGapMs = gap;

            // gap 明显大于测距耗时，通常意味着“测距断/卡”或TCP/串口阻塞
            const stutterThreshold = Math.max(1500, (timeMs && timeMs > 0) ? (timeMs * 3) : 1500);
            if (gap > stutterThreshold) {
                this._rateStutterCount = (this._rateStutterCount || 0) + 1;
            }
        }

        this._rateSamples.push({ ts, time_ms: timeMs });
        if (this._rateSamples.length > 80) this._rateSamples.shift();

        let hzInst = null;
        if (timeMs && timeMs > 0) hzInst = 1000 / timeMs;

        let hzAvg = null;
        const n = Math.min(this.RATE_WINDOW || 20, this._rateSamples.length);
        if (n >= 2) {
            const window = this._rateSamples.slice(-n);
            const dt = window[window.length - 1].ts - window[0].ts;
            if (dt > 0) hzAvg = (window.length - 1) / (dt / 1000);
        }

        const showHz = Number.isFinite(hzAvg) ? hzAvg : hzInst;
        el.textContent = Number.isFinite(showHz) ? showHz.toFixed(1) : '--';

        const gapText = (prev && Number.isFinite(this._lastMeasureGapMs)) ? `${Math.round(this._lastMeasureGapMs)}ms` : '--';
        const uiMs = Number.isFinite(this._lastUiRenderMs) ? `${this._lastUiRenderMs.toFixed(0)}ms` : '--';
        el.title = [
            `瞬时: ${Number.isFinite(hzInst) ? hzInst.toFixed(1) : '--'} Hz`,
            `平均(${n}点): ${Number.isFinite(hzAvg) ? hzAvg.toFixed(1) : '--'} Hz`,
            `time_ms: ${timeMs ?? '--'}`,
            `gap: ${gapText}`,
            `卡顿计数: ${this._rateStutterCount || 0}`,
            `UI渲染: ${uiMs}`,
        ].join(' | ');

        // 轻量的“低频/卡顿”视觉提示
        try {
            const baseColor = '#38bdf8';
            const lowColor = '#ff6b6b';
            const warnColor = '#f59e0b';
            if ((this._rateStutterCount || 0) > 0) {
                el.style.color = warnColor;
            } else if (Number.isFinite(showHz) && showHz < 2) {
                el.style.color = lowColor;
            } else {
                el.style.color = baseColor;
            }
        } catch (e) {}
    },

    _scheduleUiUpdate() {
        if (this._uiUpdatePending) return;
        this._uiUpdatePending = true;

        if (this._uiUpdateTimer) {
            try { clearTimeout(this._uiUpdateTimer); } catch (e) {}
            this._uiUpdateTimer = null;
        }

        // 100-150ms 一次足够“看起来实时”，但不会把浏览器渲染打爆
        this._uiUpdateTimer = setTimeout(() => {
            this._uiUpdatePending = false;
            const t0 = (window.performance && performance.now) ? performance.now() : Date.now();

            try {
                if (this.testMode === 'advanced') {
                    this.updateSegmentTabs();
                }
            } catch (e) {}

            try { this.renderResultsTable(); } catch (e) {}
            try { this.updateStats(); } catch (e) {}

            try {
                let chartData = (this.testMode === 'advanced')
                    ? (this.getResultsForCurrentTab ? this.getResultsForCurrentTab() : this.testResults)
                    : this.testResults;
                if (chartData && chartData.length > this.MAX_CHART_POINTS) {
                    chartData = chartData.slice(-this.MAX_CHART_POINTS);
                }
                this.updateErrorChart(chartData);
            } catch (e) {}

            const t1 = (window.performance && performance.now) ? performance.now() : Date.now();
            this._lastUiRenderMs = (typeof t1 === 'number' && typeof t0 === 'number') ? (t1 - t0) : null;
        }, 120);
    },
     
    // 收到段切换事件 (由后端在段变化时触发)
    onSegmentChange(data) {
        // data: { segment_idx, reflectance, total_segments }
        if (data && data.segment_idx !== undefined) {
            const segIdx = data.segment_idx;
            console.log(`[SlipwayPage] 段切换: ${this._lastSegmentIdx} -> ${segIdx}`);
            
            // 记录当前段
            this._lastSegmentIdx = segIdx;
            
            // 自动切换到当前段的Tab
            const currentSegTab = String(segIdx);
            this.switchSegmentTab(currentSegTab);
            
            // 显示提示
            const ref = data.reflectance;
            if (ref !== undefined) {
                Utils.toast(`切换到段${segIdx + 1} (${ref}%)`, 'info');
            }
        }
    },
    
    async onTestComplete(data) {
        this.testRunning = false;
        this.hideProgressPanel();

        if ((!Array.isArray(this.testResults) || this.testResults.length === 0) && window.API?.slipway?.getTestResults) {
            try {
                const fallbackResults = await API.slipway.getTestResults();
                if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
                    this.testResults = fallbackResults;
                    this._rebuildSegmentResultsFromResults(fallbackResults);
                    console.log(`[SlipwayPage] 已从后端补拉 ${fallbackResults.length} 条测试结果`);
                }
            } catch (e) {
                console.warn('[SlipwayPage] 测试完成后补拉结果失败:', e);
            }
        }

        this._trimResultsMemory();
        
        if (data && data.stats) {
            // 更新最终统计
            // this.updateStats(data.stats); 
        }
        this.renderResultsTable();
        this.updateStats();
        this.updateErrorChart();  // 最终更新误差曲线图
        
        // 显示失败点统计（如果有）
        if (data?.failed_points && data.failed_points.length > 0) {
            this.showFailedPointsSummary(data.failed_points);
        }
        
        // 保存测试结果到sessionStorage，供固件测试页面使用
        this.saveTestResultsForTask(data);
        
        // 测试完成后清除临时状态（但保留结果数据供查看）
        this.saveTestState();
        
        // 保存备注（如果有）
        const remark = document.getElementById('test-remark')?.value?.trim();
        const alias = document.getElementById('test-alias')?.value?.trim();
        let temperature = parseFloat(document.getElementById('test-temperature')?.value);
        if (!Number.isFinite(temperature)) temperature = 25;
        
        if (data?.session_id) {
            // 保存标签和备注
            this.saveTestTags(data.session_id, alias, temperature, remark);
        }
        
        // 保存session_id供后续使用
        this._lastSessionId = data?.session_id;
        
        // 计算测试耗时
        let timeStr = '';
        if (this._testStartTime) {
            const elapsed = Math.floor((Date.now() - this._testStartTime) / 1000);
            const min = Math.floor(elapsed / 60);
            const sec = elapsed % 60;
            timeStr = min > 0 ? ` (耗时 ${min}m ${sec}s)` : ` (耗时 ${sec}s)`;
        }
        
        const successCount = Number.isFinite(Number(data?.result_count))
            ? Number(data.result_count)
            : (Number.isFinite(Number(data?.stats?.count)) ? Number(data.stats.count) : this.testResults.length);
        const failedCount = data?.failed_points?.length || 0;
        Utils.toast(`测试完成: ${successCount}点成功, ${failedCount}点失败${timeStr}`, 'success');
        
        // 如果有关联任务，提示用户
        if (this.currentTask) {
            setTimeout(() => {
                if (confirm('测试完成！是否返回任务中心提交结果？')) {
                    this.returnToTaskCenter();
                }
            }, 500);
        }
    },
    
    // 显示失败点汇总 - 在状态栏下方显示
    showFailedPointsSummary(failedPoints) {
        if (!failedPoints || failedPoints.length === 0) {
            this.hideFailedBar();
            return;
        }
        
        // 保存失败点数据
        this._failedPoints = failedPoints;
        
        // 显示失败点栏
        const bar = document.getElementById('failed-bar');
        const countEl = document.getElementById('failed-count');
        const detailsEl = document.getElementById('failed-details');
        
        if (!bar) return;
        
        bar.style.display = 'block';
        if (countEl) countEl.textContent = failedPoints.length;
        
        // 按类型分组
        const byType = {};
        failedPoints.forEach(p => {
            const type = p.type || 'unknown';
            if (!byType[type]) byType[type] = [];
            byType[type].push(p);
        });
        
        // 生成详情HTML
        let html = '';
        for (const [type, points] of Object.entries(byType)) {
            const typeLabel = {
                'move_failed': '滑台移动失败',
                'measure_failed': '测距失败',
                'rotary_failed': '转靶切换失败'
            }[type] || type;
            
            html += `<div class="failed-type-group">`;
            html += `<div class="failed-type-label">${typeLabel} (${points.length})</div>`;
            html += '<ul class="failed-type-list">';
            points.slice(0, 5).forEach(p => {
                const retryInfo = p.retry_count ? ` (已重试${p.retry_count}次)` : '';
                html += `<li>${p.target}mm - ${p.reason || ''}${retryInfo}</li>`;
            });
            if (points.length > 5) {
                html += `<li>...还有 ${points.length - 5} 个</li>`;
            }
            html += '</ul></div>';
        }
        
        if (detailsEl) detailsEl.innerHTML = html;
    },
    
    // 隐藏失败点栏
    hideFailedBar() {
        const bar = document.getElementById('failed-bar');
        if (bar) bar.style.display = 'none';
        this._failedPoints = null;
    },
    
    // 切换失败点详情展开/收起
    toggleFailedDetails() {
        const detailsEl = document.getElementById('failed-details');
        const toggleEl = document.getElementById('failed-toggle');
        if (!detailsEl) return;
        
        const isExpanded = detailsEl.style.display !== 'none';
        detailsEl.style.display = isExpanded ? 'none' : 'block';
        if (toggleEl) toggleEl.classList.toggle('expanded', !isExpanded);
    },
    
    // 测试异常处理
    onTestError(data) {
        this.testRunning = false;
        const errorMsg = data?.message || data?.error || '未知错误';
        
        console.error('[SlipwayPage] 测试异常:', errorMsg);
        
        // 显示错误通知（使用醒目的样式）
        Utils.toast(`⚠️ 测试异常: ${errorMsg}`, 'error', 8000);
        
        // 如果有更详细的错误信息，显示弹窗
        if (data?.details || errorMsg.length > 50) {
            this.showErrorDialog(errorMsg, data?.details);
        }
        
        // 更新UI状态
        this.updateStats();
        this.updateErrorChart();
        
        // 保存当前测试状态（即使异常也保留已有数据）
        this.saveTestState();
        
        // 播放提示音（如果浏览器支持）
        this.playErrorSound();
    },
    
    // 显示错误详情弹窗
    showErrorDialog(message, details) {
        // 创建弹窗
        let overlay = document.getElementById('test-error-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'test-error-overlay';
            overlay.className = 'modal-overlay';
            document.body.appendChild(overlay);
        }
        
        overlay.innerHTML = `
            <div class="modal-dialog" style="max-width: 500px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #ff6b6b, #ee5a5a);">
                    <h3>⚠️ 测试异常</h3>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="color: #ff6b6b; font-size: 16px; margin-bottom: 15px;">
                        ${message}
                    </div>
                    ${details ? `
                    <div style="background: #1a1a2e; padding: 12px; border-radius: 8px; font-size: 13px; color: #aaa; max-height: 200px; overflow-y: auto;">
                        <pre style="margin: 0; white-space: pre-wrap;">${details}</pre>
                    </div>
                    ` : ''}
                    <div style="margin-top: 15px; color: #888; font-size: 13px;">
                        已测试 ${this.testResults.length} 个点，数据已保留
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="document.getElementById('test-error-overlay').classList.remove('show')">
                        确定
                    </button>
                </div>
            </div>
        `;
        
        overlay.classList.add('show');
    },
    
    // 播放错误提示音
    playErrorSound() {
        try {
            // 使用Web Audio API播放简单的提示音
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.frequency.value = 440; // A4音
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;
            
            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
            oscillator.stop(audioCtx.currentTime + 0.5);
        } catch (e) {
            // 浏览器不支持或用户未交互，静默忽略
        }
    },
    
    // 保存测试备注
    async saveTestRemark(sessionId, remark) {
        try {
            const result = await pywebview.api.data_update_remark(sessionId, remark);
            if (result?.success) {
                console.log('[SlipwayPage] 备注已保存');
            }
        } catch (e) {
            console.warn('保存备注失败:', e);
        }
    },
    
    // 保存测试标签（别名、温度、备注）
    async saveTestTags(sessionId, alias, temperature, remark) {
        try {
            const tempVal = Number.isFinite(temperature) ? temperature : 25;
            const remarkVal = (remark === undefined || remark === null) ? null : String(remark);
            const result = await pywebview.api.data_update_tags(
                sessionId,
                alias || null,
                tempVal,
                null,  // reflectance 从测试参数自动获取
                null,  // tags
                remarkVal
            );
            if (result?.success) {
                console.log('[SlipwayPage] 测试标签已保存:', { alias, temperature, remark });
            }
        } catch (e) {
            console.warn('保存测试标签失败:', e);
        }
    },
    
    // 保存测试结果供其他页面使用
    saveTestResultsForTask(data) {
        try {
            const results = this.testResults || [];
            const stats = data?.stats || {};
            
            // 计算统计信息
            const errors = results.map(r => Math.abs(r.error || 0));
            const maxError = Number.isFinite(Number(stats.max_error))
                ? Number(stats.max_error)
                : (errors.length > 0 ? Math.max(...errors) : 0);
            const minError = Number.isFinite(Number(stats.min_error))
                ? Number(stats.min_error)
                : (errors.length > 0 ? Math.min(...errors) : 0);
            const avgError = Number.isFinite(Number(stats.avg_error))
                ? Number(stats.avg_error)
                : (errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0);
            const totalPoints = Number.isFinite(Number(stats.count))
                ? Number(stats.count)
                : results.length;
            
            const testData = {
                results: {
                    max_error: maxError,
                    min_error: minError,
                    avg_error: avgError,
                    total_points: totalPoints,
                    pass_rate: errors.filter(e => e <= (this.errorThresholdMm || 5)).length / Math.max(errors.length, 1)
                },
                time: new Date().toISOString(),
                count: totalPoints,
                session_id: data?.session_id || '',
                task_id: this.currentTask?.id || '',
                test_mode: this.testMode,
                segments: this.testMode === 'advanced' ? this.segments : null
            };
            
            sessionStorage.setItem('slipwayTestResults', JSON.stringify(testData));
            console.log('[SlipwayPage] 测试结果已保存:', testData.count, '个数据点');
            
        } catch (e) {
            console.error('保存测试结果失败:', e);
        }
    },
    
    addResultRow(res) {
        // 不直接操作DOM，而是通过renderResultsTable统一渲染
        // 数据已经在onTestProgress中添加到testResults和segmentResults
        // 这里只需要触发表格重新渲染
        this.renderResultsTable();
    },
    
    _autoScrollToBottom() {
        const container = document.getElementById('results-tbody')?.parentElement;
        if (!container) return;
        
        // 如果用户最近有手动滚动，暂停自动滚动
        if (this._userScrollPaused) return;
        
        container.scrollTop = container.scrollHeight;
    },
    
    _initScrollPauseDetection() {
        const container = document.getElementById('results-tbody')?.parentElement;
        if (!container || container._scrollBound) return;
        container._scrollBound = true;
        
        container.addEventListener('wheel', () => {
            this._userScrollPaused = true;
            clearTimeout(this._scrollResumeTimer);
            // 5秒无操作后恢复自动滚动
            this._scrollResumeTimer = setTimeout(() => {
                this._userScrollPaused = false;
            }, 5000);
        });
    },
    
    updateStats() {
        const count = this.testResults.length;
        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        
        // 兼容不同UI版本：有的页面叫 stat-count，有的没有
        setEl('stat-count', count);
        setEl('total-records', count);
        
        if (count > 0) {
            const errors = this.testResults.map(r => Math.abs(r.error));
            const max = Math.max(...errors);
            const min = Math.min(...errors);
            const avg = errors.reduce((a, b) => a + b, 0) / count;
            
            // 标准差
            const variance = errors.reduce((sum, e) => sum + (e - avg) ** 2, 0) / count;
            const std = Math.sqrt(variance);
            
            // 通过率（误差 <= 阈值mm 为通过）
            const threshold = Number.isFinite(Number(this.errorThresholdMm)) ? Number(this.errorThresholdMm) : 1;
            const passCount = errors.filter(e => e <= threshold).length;
            const passRate = (passCount / count * 100);
            
            setEl('stat-max', max.toFixed(4));
            setEl('stat-min', min.toFixed(4));
            setEl('stat-avg', avg.toFixed(4));
            setEl('stat-std', std.toFixed(4));
            // 兼容：slipway.html 用 stat-pass，旧页面用 stat-pass-rate
            setEl('stat-pass-rate', `${passRate.toFixed(1)}%`);
            setEl('stat-pass', `${passRate.toFixed(1)}%`);
        } else {
            setEl('stat-max', '--');
            setEl('stat-min', '--');
            setEl('stat-avg', '--');
            setEl('stat-std', '--');
            setEl('stat-pass-rate', '--');
            setEl('stat-pass', '--');
        }
    },
    
    exportResults() {
        if (this.testResults.length === 0) return Utils.toast('暂无数据导出', 'warning');
        
        // 根据当前Tab决定导出范围
        const isAllTab = this.activeSegmentTab === 'all';
        const results = this.getResultsForCurrentTab ? this.getResultsForCurrentTab() : this.testResults;
        
        if (results.length === 0) return Utils.toast('当前Tab暂无数据', 'warning');
        
        // 检查是否为高级模式（有segment信息）
        const hasSegments = results.some(r => r.segment_idx !== undefined);
        
        // 如果是"全部"Tab且有多段数据，按段分开导出到不同Sheet（CSV格式用空行分隔）
        if (isAllTab && hasSegments && this.testMode === 'advanced') {
            this.exportResultsBySegment();
            return;
        }
        
        let csv = '';
        if (hasSegments) {
            csv = 'Segment,Reflectance(%),Time,Target(mm),Actual(mm),Amplitude,Range(mm),Error(mm),FwTime(ms),Quality,APD,GoodShots,TotalShots,RetryCount,PowerMode\n';
        } else {
            csv = 'Time,Target(mm),Actual(mm),Amplitude,Range(mm),Error(mm),FwTime(ms),Quality,APD,GoodShots,TotalShots,RetryCount,PowerMode\n';
        }
        
        const raw = results.filter(r => r && typeof r.error === 'number');
        const baseline = (this.subtractBaselineError && raw.length > 0) ? (raw[0].error ?? 0) : 0;
        
        results.forEach(r => {
            const err = (typeof r.error === 'number') ? (r.error - baseline) : r.error;
            const amplitude = (r.amplitude === undefined || r.amplitude === null) ? '' : r.amplitude;
            const rangeMm = (r.range_mm === undefined || r.range_mm === null) ? '' : r.range_mm;
            const fwTime = (r.fw_time_ms === undefined || r.fw_time_ms === null) ? '' : r.fw_time_ms;
            const quality = (r.quality === undefined || r.quality === null) ? '' : Number(r.quality).toFixed(3);
            const apd = (r.apd_voltage === undefined || r.apd_voltage === null) ? '' : r.apd_voltage;
            const goodShots = (r.good_shots === undefined || r.good_shots === null) ? '' : r.good_shots;
            const totalShots = (r.total_shots === undefined || r.total_shots === null) ? '' : r.total_shots;
            const retryCount = (r.retry_count === undefined || r.retry_count === null) ? '' : r.retry_count;
            const powerMode = (r.power_mode === undefined || r.power_mode === null) ? '' : r.power_mode;
            if (hasSegments) {
                const segNum = (r.segment_idx !== undefined) ? (r.segment_idx + 1) : '--';
                const ref = (r.reflectance === undefined || r.reflectance === null) ? '--' : this._normReflectance(r.reflectance);
                csv += `${segNum},${ref},${r.time_ms ?? r.timestamp ?? ''},${r.target},${r.actual},${amplitude},${rangeMm},${err},${fwTime},${quality},${apd},${goodShots},${totalShots},${retryCount},${powerMode}\n`;
            } else {
                csv += `${r.time_ms ?? r.timestamp ?? ''},${r.target},${r.actual},${amplitude},${rangeMm},${err},${fwTime},${quality},${apd},${goodShots},${totalShots},${retryCount},${powerMode}\n`;
            }
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // 文件名包含Tab信息
        const tabSuffix = isAllTab ? 'all' : `segment${parseInt(this.activeSegmentTab, 10) + 1}`;
        a.download = `accuracy_test_${tabSuffix}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        Utils.toast('导出成功', 'success');
    },
    
    // 按段分开导出（每段一个CSV文件，或合并为一个带分隔的文件）
    exportResultsBySegment() {
        const segments = this.segments || [];
        if (segments.length === 0) {
            Utils.toast('没有段配置', 'warning');
            return;
        }
        
        // 构建每段的CSV内容
        let allCsv = '';
        const dateStr = new Date().toISOString().slice(0, 10);
        
        segments.forEach((seg, idx) => {
            const segResults = this.segmentResults[idx] || [];
            if (segResults.length === 0) return;
            
            // 段标题
            const segRef = (seg.reflectance === undefined || seg.reflectance === null) ? '--' : this._normReflectance(seg.reflectance);
            allCsv += `\n===== 段${idx + 1}: ${segRef}% (${seg.start_pos}mm → ${seg.end_pos}mm) =====\n`;
            allCsv += 'Time,Target(mm),Actual(mm),Amplitude,Range(mm),Error(mm),Reflectance(%),FwTime(ms),Quality,APD,GoodShots,TotalShots,RetryCount,PowerMode\n';
            
            // 计算该段的baseline
            const raw = segResults.filter(r => r && typeof r.error === 'number');
            const baseline = (this.subtractBaselineError && raw.length > 0) ? (raw[0].error ?? 0) : 0;
            
            segResults.forEach(r => {
                const err = (typeof r.error === 'number') ? (r.error - baseline) : r.error;
                const ref = (r.reflectance === undefined || r.reflectance === null)
                    ? ((seg.reflectance === undefined || seg.reflectance === null) ? '--' : this._normReflectance(seg.reflectance))
                    : this._normReflectance(r.reflectance);
                const amplitude = (r.amplitude === undefined || r.amplitude === null) ? '' : r.amplitude;
                const rangeMm = (r.range_mm === undefined || r.range_mm === null) ? '' : r.range_mm;
                const fwTime = (r.fw_time_ms === undefined || r.fw_time_ms === null) ? '' : r.fw_time_ms;
                const quality = (r.quality === undefined || r.quality === null) ? '' : Number(r.quality).toFixed(3);
                const apd = (r.apd_voltage === undefined || r.apd_voltage === null) ? '' : r.apd_voltage;
                const goodShots = (r.good_shots === undefined || r.good_shots === null) ? '' : r.good_shots;
                const totalShots = (r.total_shots === undefined || r.total_shots === null) ? '' : r.total_shots;
                const retryCount = (r.retry_count === undefined || r.retry_count === null) ? '' : r.retry_count;
                const powerMode = (r.power_mode === undefined || r.power_mode === null) ? '' : r.power_mode;
                allCsv += `${r.time_ms ?? r.timestamp ?? ''},${r.target},${r.actual},${amplitude},${rangeMm},${err},${ref},${fwTime},${quality},${apd},${goodShots},${totalShots},${retryCount},${powerMode}\n`;
            });
            
            // 段统计
            if (raw.length > 0) {
                const errors = raw.map(r => Math.abs(r.error - baseline));
                const maxErr = Math.max(...errors);
                const minErr = Math.min(...errors);
                const avgErr = errors.reduce((a, b) => a + b, 0) / errors.length;
                allCsv += `\n统计: 点数=${raw.length}, 最大误差=${maxErr.toFixed(3)}mm, 最小误差=${minErr.toFixed(3)}mm, 平均误差=${avgErr.toFixed(3)}mm\n`;
            }
        });
        
        if (!allCsv.trim()) {
            Utils.toast('没有数据可导出', 'warning');
            return;
        }
        
        // 添加总体信息
        const header = `精度测试报告 - ${dateStr}\n测试模式: 高级流程\n段数: ${segments.length}\n总点数: ${this.testResults.length}\n`;
        allCsv = header + allCsv;
        
        const blob = new Blob([allCsv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `accuracy_test_by_segment_${dateStr}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        Utils.toast('按段导出成功', 'success');
    },
    
    clearResults() {
        this.testResults = [];
        this.segmentResults = {};
        this._failedPoints = null;
        document.getElementById('results-tbody').innerHTML = '';
        this.updateStats();
        // 清除保存的测试状态
        this._clearPersistedTestState();
        this.hideFailedBar();
        Utils.toast('记录已清空', 'info');
    }
};

// 暴露给全局
window.SlipwayPage = SlipwayPage;

// ========== 全局辅助函数 (供 HTML onclick 调用) ==========

// 手动检测限位IO按钮兜底入口
window._slipwayHomeIoBtnClicked = function(btn) {
    try {
        const stateEl = document.getElementById('slipway-home-io-state');
        if (stateEl) {
            stateEl.textContent = '限位IO: 点击中...';
            stateEl.style.color = '#38bdf8';
        }
        if (btn) {
            btn.dataset.prevText = btn.textContent || '检测IO';
            btn.textContent = '检测中';
            setTimeout(() => {
                try { btn.textContent = btn.dataset.prevText || '检测IO'; } catch (e) {}
            }, 1200);
        }
        return window.checkHomeIo ? window.checkHomeIo() : undefined;
    } catch (e) {
        console.error('[SlipwayPage] _slipwayHomeIoBtnClicked 异常', e);
    }
};

// 手动检测限位IO
window.checkHomeIo = function() {
    try {
        console.info('[SlipwayPage] checkHomeIo 全局入口触发');
        return window.SlipwayPage && typeof window.SlipwayPage.checkHomeIo === 'function'
            ? window.SlipwayPage.checkHomeIo()
            : console.warn('[SlipwayPage] checkHomeIo 不存在');
    } catch (e) {
        console.error('[SlipwayPage] checkHomeIo 全局入口异常', e);
    }
};

// Tab 切换
window.switchTab = function(tabId, btn) {
    const container = btn.closest('.card');
    container.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    container.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    container.querySelector('#tab-' + tabId).classList.add('active');
    btn.classList.add('active');
};

// 反射率选择
window.selectRef = function(val, btn) {
    // 更新所有反射率按钮状态
    document.querySelectorAll('.ref-btn').forEach(el => {
        el.classList.remove('active');
        const vv = parseInt((el.textContent || '').replace('%', ''), 10);
        const nv = (window.SlipwayPage && SlipwayPage._normReflectance) ? SlipwayPage._normReflectance(val) : parseInt(val, 10);
        if (Number.isFinite(vv) && vv === nv) {
            el.classList.add('active');
        }
    });
    
    // 更新显示
    const select = document.getElementById('rotary-ref-select');
    const nv2 = (window.SlipwayPage && SlipwayPage._normReflectance) ? SlipwayPage._normReflectance(val) : parseInt(val, 10);
    if (select) select.value = String(nv2);
    
    try {
        // 由 setReflectance 成功后统一同步UI，失败则自动回读状态
    } catch (e) {}
    if (window.SlipwayPage) SlipwayPage.setReflectance(val);
};

// 点动步进设置
window.setJogStep = function(val) {
    const input = document.getElementById('jog-step-input');
    if (input) input.value = val;
    document.querySelectorAll('.jog-step-btn').forEach(el => el.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    if (window.SlipwayPage) SlipwayPage.setJogStep(val);
};

// ========== 流程模式切换 ==========
SlipwayPage.switchMode = function(mode) {
    // 如果测试正在运行，不允许切换
    if (this.testRunning) {
        Utils.toast('测试进行中，无法切换模式', 'warning');
        return;
    }
    
    this.testMode = mode;
    const basicPanel = document.getElementById('basic-mode-panel');
    const advancedPanel = document.getElementById('advanced-mode-panel');
    const basicBtn = document.getElementById('mode-basic-btn');
    const advancedBtn = document.getElementById('mode-advanced-btn');
    
    // 更新模式指示器（侧边栏）
    const modeIndicator = document.getElementById('current-mode-indicator');
    if (modeIndicator) {
        modeIndicator.textContent = mode === 'basic' ? '基础模式' : '高级模式';
        modeIndicator.className = 'mode-indicator ' + mode;
    }
    
    // 更新顶部状态栏的模式显示
    const statStatus = document.getElementById('stat-status');
    if (statStatus) {
        statStatus.textContent = mode === 'basic' ? '基础模式' : '高级模式';
        statStatus.style.color = mode === 'basic' ? 'var(--accent)' : '#ffc107';
    }
    
    if (mode === 'basic') {
        if (basicPanel) basicPanel.style.display = 'block';
        if (advancedPanel) advancedPanel.style.display = 'none';
        if (basicBtn) basicBtn.classList.add('active');
        if (advancedBtn) advancedBtn.classList.remove('active');
    } else {
        if (basicPanel) basicPanel.style.display = 'none';
        if (advancedPanel) advancedPanel.style.display = 'block';
        if (basicBtn) basicBtn.classList.remove('active');
        if (advancedBtn) advancedBtn.classList.add('active');

        // 切换到高级模式时确保编辑器已初始化并渲染
        try { this.initSegmentEditor(); } catch (e) {}
    }
    
    console.log(`[SlipwayPage] 模式切换: ${mode}`);
};

// ========== 高级流程：segments 可视化编辑器 ==========
SlipwayPage.initSegmentEditor = function() {
    const planEl = document.getElementById('test-plan');
    if (!planEl) return;
    if (this.segEditorInited) return;
    this.segEditorInited = true;

    // textarea 变化时（用户直接编辑JSON）同步到可视化
    planEl.addEventListener('input', () => {
        if (!this.planJsonExpanded) return;
        this.loadSegmentsFromTextarea();
        this.renderSegments();
        this.renderSegmentPreview();
        this.validateSegmentsAndSync(false);
    });

    this.loadSegmentsFromTextarea();
    this.renderSegments();
    this.renderSegmentPreview();
    this.validateSegmentsAndSync(false);
};

SlipwayPage.loadSegmentsFromTextarea = function() {
    const planEl = document.getElementById('test-plan');
    if (!planEl) return;
    const txt = (planEl.value || '').trim();
    if (!txt) { this.segments = []; return; }
    try {
        const arr = JSON.parse(txt);
        if (Array.isArray(arr)) {
            this.segments = arr.map(s => ({
                reflectance: this._normReflectance(s.reflectance),
                start_pos: s.start_pos,
                end_pos: s.end_pos,
                step: s.step,
                samples: s.samples,
            }));
        } else {
            this.segments = [];
        }
    } catch (e) {
        // JSON非法时不覆盖现有segments，只显示错误
    }
};

SlipwayPage.syncTextareaFromSegments = function() {
    const planEl = document.getElementById('test-plan');
    if (!planEl) return;
    planEl.value = JSON.stringify(this.segments || [], null, 2);
};

SlipwayPage.renderSegments = function() {
    // 编辑器只在弹窗里渲染
    const listEl = document.getElementById('seg-modal-list');
    if (!listEl) return;
    const segs = Array.isArray(this.segments) ? this.segments : [];
    if (!segs.length) {
        listEl.innerHTML = `<div style="padding:8px; color:var(--text-dim); font-size:12px;">暂无段，点击“新增段”添加</div>`;
        return;
    }

    listEl.innerHTML = segs.map((s, idx) => {
        const r = (s.reflectance ?? '');
        const sp = (s.start_pos ?? '');
        const ep = (s.end_pos ?? '');
        const st = (s.step ?? '');
        const sa = (s.samples ?? '');
        return `
        <div class="seg-row" data-idx="${idx}">
            <select class="seg-input" data-k="reflectance" title="选择反射率">
                <option value="">不切换转靶</option>
                <option value="10" ${r == 10 ? 'selected' : ''}>10% - 白色</option>
                <option value="20" ${r == 20 ? 'selected' : ''}>20% - 灰白</option>
                <option value="30" ${r == 30 ? 'selected' : ''}>30% - 浅灰</option>
                <option value="40" ${r == 40 ? 'selected' : ''}>40% - 中灰</option>
                <option value="50" ${r == 50 ? 'selected' : ''}>50% - 灰色</option>
                <option value="60" ${r == 60 ? 'selected' : ''}>60% - 深灰</option>
                <option value="70" ${r == 70 ? 'selected' : ''}>70% - 黑灰</option>
                <option value="90" ${r == 90 ? 'selected' : ''}>90% - 黑色</option>
            </select>
            <input class="seg-input" type="number" step="1" data-k="start_pos" value="${sp}" placeholder="起始位置">
            <input class="seg-input" type="number" step="1" data-k="end_pos" value="${ep}" placeholder="结束位置">
            <input class="seg-input" type="number" step="1" min="1" data-k="step" value="${st}" placeholder="步进">
            <input class="seg-input" type="number" step="1" min="1" data-k="samples" value="${sa}" placeholder="采样次数">
            <button class="seg-del" title="删除" onclick="SlipwayPage.removeSegment(${idx})">×</button>
        </div>`;
    }).join('');

    // 统一绑定 input 事件（事件委托）
    listEl.oninput = (ev) => {
        const target = ev.target;
        if (!target || !target.classList.contains('seg-input')) return;
        const row = target.closest('.seg-row');
        if (!row) return;
        const idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
        const key = target.getAttribute('data-k');
        if (idx < 0 || !key) return;

        const v = target.value;
        const num = v === '' ? null : parseFloat(v);
        if (!this.segments[idx]) return;
        this.segments[idx][key] = num;
        this.validateSegmentsAndSync(true);
        this.renderSegmentPreview();
    };
};

SlipwayPage.renderSegmentPreview = function() {
    const previewEl = document.getElementById('seg-preview');
    if (!previewEl) return;
    const segs = Array.isArray(this.segments) ? this.segments : [];
    if (!segs.length) {
        previewEl.innerHTML = `<div class="seg-preview-empty">暂无段（点“配置高级流程”添加）</div>`;
        return;
    }
    const thr = Number.isFinite(this.errorThresholdMm) ? this.errorThresholdMm : 5;
    const pt = Number.isFinite(this.estPointTimeSec) ? this.estPointTimeSec : 3;
    const calcPoints = (s) => {
        const sp = s.start_pos, ep = s.end_pos, st = s.step, sa = s.samples;
        if (![sp, ep, st, sa].every(v => Number.isFinite(v))) return null;
        if (st <= 0 || sa <= 0) return null;
        const n = Math.floor(Math.abs(ep - sp) / st) + 1;
        return n * sa;
    };
    const perSegPoints = segs.map(calcPoints);
    const totalPoints = perSegPoints.filter(v => Number.isFinite(v)).reduce((a, b) => a + b, 0);
    const estSec = totalPoints * pt;
    const fmtTime = (sec) => {
        if (!Number.isFinite(sec) || sec <= 0) return '--';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m > 0 ? `${m}m${s}s` : `${s}s`;
    };

    const header = `<div style="display:flex; justify-content:space-between; margin-bottom:6px; color:var(--text-dim);">
        <span>阈值: ±${thr}mm</span>
        <span>点数: ${totalPoints || '--'} | 估时: ${fmtTime(estSec)}</span>
    </div>`;

    const rows = segs.map((s, i) => {
        const ref = (s.reflectance ?? '--');
        const sp = (s.start_pos ?? '--');
        const ep = (s.end_pos ?? '--');
        const st = (s.step ?? '--');
        const sa = (s.samples ?? '--');
        const pts = perSegPoints[i];
        const ptsTxt = Number.isFinite(pts) ? ` | pts=${pts}` : '';
        return `
        <div class="seg-preview-row">
            <span class="seg-preview-idx">${i + 1}</span>
            <span class="seg-preview-ref">${ref}%</span>
            <span class="seg-preview-desc">${sp} → ${ep} | step=${st} | samples=${sa}${ptsTxt}</span>
        </div>`;
    }).join('');

    previewEl.innerHTML = header + rows;
};

SlipwayPage.validateSegmentsAndSync = function(syncTextarea) {
    const errEl = document.getElementById('seg-modal-err');
    const listEl = document.getElementById('seg-modal-list');
    const planEl = document.getElementById('test-plan');
    const segs = Array.isArray(this.segments) ? this.segments : [];

    let errMsg = '';
    const rowInvalid = new Set();

    if (!segs.length) {
        errMsg = 'segments为空';
    } else {
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i] || {};
            const r = s.reflectance;
            const sp = s.start_pos;
            const ep = s.end_pos;
            const st = s.step;
            const sa = s.samples;

            // 允许用户在JSON里写0.9/0.1，统一归一化为90/10
            if (!(r === null || r === undefined) && Number.isFinite(r) && r > 0 && r <= 1) {
                s.reflectance = this._normReflectance(r);
            }

            const bad = (v) => v === null || v === undefined || Number.isNaN(v);
            // reflectance 允许为空（表示不切换转靶）
            if (!(r === null || r === undefined) && !Number.isNaN(r) && (r < 0 || r > 100)) {
                rowInvalid.add(i);
                errMsg = errMsg || `第${i + 1}段: reflectance需0~100 或留空`;
            }
            if (bad(sp) || bad(ep)) { rowInvalid.add(i); errMsg = errMsg || `第${i + 1}段: start/end不能为空`; }
            if (!bad(sp) && !bad(ep) && sp === ep) { rowInvalid.add(i); errMsg = errMsg || `第${i + 1}段: start=end`; }
            if (bad(st) || st <= 0) { rowInvalid.add(i); errMsg = errMsg || `第${i + 1}段: step需>0`; }
            if (bad(sa) || sa <= 0) { rowInvalid.add(i); errMsg = errMsg || `第${i + 1}段: samples需>0`; }
        }
    }

    // 行高亮
    if (listEl) {
        listEl.querySelectorAll('.seg-row').forEach(row => {
            const idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
            if (rowInvalid.has(idx)) row.classList.add('seg-invalid');
            else row.classList.remove('seg-invalid');
        });
    }

    if (errEl) {
        if (errMsg) {
            errEl.style.display = 'inline';
            errEl.textContent = errMsg;
        } else {
            errEl.style.display = 'none';
            errEl.textContent = '';
        }
    }

    if (syncTextarea) this.syncTextareaFromSegments();

    // JSON展开时，提示JSON是否可解析
    if (this.planJsonExpanded && planEl) {
        try { JSON.parse(planEl.value || ''); }
        catch (e) {
            if (errEl) {
                errEl.style.display = 'inline';
                errEl.textContent = 'JSON格式错误: ' + (e.message || e);
            }
        }
    }
};

SlipwayPage.addSegment = function() {
    if (!Array.isArray(this.segments)) this.segments = [];
    this.segments.push({
        reflectance: 90,
        start_pos: 0,
        end_pos: 38000,
        step: 1000,
        samples: 1,
    });
    this.renderSegments();
    this.validateSegmentsAndSync(true);
    this.renderSegmentPreview();
};

SlipwayPage.removeSegment = function(idx) {
    if (!Array.isArray(this.segments)) return;
    if (idx < 0 || idx >= this.segments.length) return;
    this.segments.splice(idx, 1);
    this.renderSegments();
    this.validateSegmentsAndSync(true);
    this.renderSegmentPreview();
};

SlipwayPage.togglePlanJson = function() {
    const planEl = document.getElementById('test-plan');
    if (!planEl) return;
    this.planJsonExpanded = !this.planJsonExpanded;
    planEl.style.display = this.planJsonExpanded ? 'block' : 'none';
    if (this.planJsonExpanded) {
        // 展开时先从segments写回textarea，保证一致
        this.syncTextareaFromSegments();
    } else {
        // 收起时尝试从textarea加载（如果用户手改过）
        this.loadSegmentsFromTextarea();
        this.renderSegments();
        this.renderSegmentPreview();
    }
    this.validateSegmentsAndSync(false);
};

SlipwayPage.openPlanConfig = function() {
    const overlay = document.getElementById('plan-config-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    this.planConfigOpen = true;
    
    // 更新标题显示当前配置
    const titleEl = document.getElementById('current-config-title');
    if (titleEl) {
        const cfg = this.advConfigs[this.currentAdvConfig];
        titleEl.textContent = cfg ? cfg.name : '默认配置';
    }
    
    try {
        if (!this.segEditorInited) this.initSegmentEditor();
        this.loadSegmentsFromTextarea();
        this.renderSegments();
        this.validateSegmentsAndSync(false);
    } catch (e) {}
};

SlipwayPage.closePlanConfig = function() {
    const overlay = document.getElementById('plan-config-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    this.planConfigOpen = false;
};

SlipwayPage.savePlanConfig = function() {
    try {
        this.validateSegmentsAndSync(true);
        this.renderSegmentPreview();
        
        // 同时保存到当前配置
        this.saveCurrentAdvConfig();
        
        // 更新多流程Tab（如果段数有变化）
        this.updateSegmentTabs();
        
        this.closePlanConfig();
        Utils.toast('高级流程已保存', 'success');
    } catch (e) {
        Utils.toast('保存失败: ' + (e.message || e), 'error');
    }
};

// ========== 误差曲线图 ==========
SlipwayPage.getChartMetricDefs = function() {
    return {
        error: {
            key: 'error',
            label: '误差',
            unit: 'mm',
            color: '#00ff9a',
            getValue: (r) => Number(r?.error),
            threshold: () => (Number.isFinite(Number(this.errorThresholdMm)) ? Number(this.errorThresholdMm) : null),
            absStats: true,
            symmetric: true
        },
        actual: {
            key: 'actual',
            label: '实际位置',
            unit: 'mm',
            color: '#45b7d1',
            getValue: (r) => Number(r?.actual),
            absStats: false
        },
        amplitude: {
            key: 'amplitude',
            label: '幅值',
            unit: '',
            color: '#f59e0b',
            getValue: (r) => Number(r?.amplitude),
            absStats: false
        },
        range_mm: {
            key: 'range_mm',
            label: '极差',
            unit: 'mm',
            color: '#a78bfa',
            getValue: (r) => Number(r?.range_mm ?? r?.rangeMm),
            absStats: false
        },
        time_ms: {
            key: 'time_ms',
            label: '耗时',
            unit: 'ms',
            color: '#4ecdc4',
            getValue: (r) => Number(r?.time_ms ?? r?.timeMs),
            absStats: false
        },
        fw_time_ms: {
            key: 'fw_time_ms',
            label: 'FW耗时',
            unit: 'ms',
            color: '#ff6b6b',
            getValue: (r) => Number(r?.fw_time_ms ?? r?.fwTimeMs),
            absStats: false
        }
    };
};

SlipwayPage.getChartMetricDef = function(metricKey = this.chartMetricKey) {
    const defs = this.getChartMetricDefs();
    return defs[metricKey] || defs.error;
};

SlipwayPage._formatChartMetricValue = function(value, def, digits = null) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    const finalDigits = Number.isFinite(digits)
        ? digits
        : (def?.unit === 'mm' ? 2 : 1);
    return num.toFixed(finalDigits) + (def?.unit ? ` ${def.unit}` : '');
};

SlipwayPage.syncChartMetricUi = function() {
    const def = this.getChartMetricDef();
    const titleEl = document.getElementById('error-chart-title');
    if (titleEl) titleEl.textContent = `📈 ${def.label}趋势`;

    const selectEl = document.getElementById('error-chart-metric');
    if (selectEl) selectEl.value = def.key;

    const seriesDotEl = document.getElementById('error-chart-series-dot');
    if (seriesDotEl) seriesDotEl.style.background = def.color;
    const seriesLabelEl = document.getElementById('error-chart-series-label');
    if (seriesLabelEl) seriesLabelEl.textContent = def.label;

    const avgLegendEl = document.getElementById('error-chart-avg-label');
    if (avgLegendEl) avgLegendEl.textContent = '平均';

    const thresholdLegendEl = document.getElementById('error-chart-threshold-legend');
    const thresholdLabelEl = document.getElementById('error-chart-threshold-label');
    const thresholdValue = typeof def.threshold === 'function' ? def.threshold() : def.threshold;
    const showThreshold = Number.isFinite(Number(thresholdValue));
    if (thresholdLegendEl) thresholdLegendEl.style.display = showThreshold ? '' : 'none';
    if (thresholdLabelEl) {
        thresholdLabelEl.textContent = showThreshold
            ? `阈值(${this._formatChartMetricValue(Number(thresholdValue), def)})`
            : '阈值';
    }

    const statMaxLabelEl = document.getElementById('chart-max-label');
    const statMinLabelEl = document.getElementById('chart-min-label');
    const statAvgLabelEl = document.getElementById('chart-avg-stat-label');
    const statStdLabelEl = document.getElementById('chart-std-label');
    if (statMaxLabelEl) statMaxLabelEl.textContent = def.absStats ? '最大绝对值' : '最大';
    if (statMinLabelEl) statMinLabelEl.textContent = def.absStats ? '最小绝对值' : '最小';
    if (statAvgLabelEl) statAvgLabelEl.textContent = def.absStats ? '平均绝对值' : '平均';
    if (statStdLabelEl) statStdLabelEl.textContent = '标准差';

    document.querySelectorAll('[data-chart-metric]').forEach((el) => {
        const isActive = el.getAttribute('data-chart-metric') === def.key;
        el.style.color = isActive ? '#00ff9a' : '';
        el.style.fontWeight = isActive ? '700' : '';
        el.style.cursor = 'pointer';
        el.style.textDecoration = isActive ? 'underline' : '';
    });
};

SlipwayPage.setChartMetric = function(metricKey, options = {}) {
    const def = this.getChartMetricDef(metricKey);
    this.chartMetricKey = def.key;
    try {
        localStorage.setItem('slipway_chart_metric', this.chartMetricKey);
    } catch (e) {}
    this.syncChartMetricUi();
    if (!options.skipRender) {
        this.updateErrorChart();
    }
};

SlipwayPage.initErrorChart = function() {
    const canvas = document.getElementById('error-chart');
    if (!canvas) return;

    // 如果页面被切走又切回，DOM可能重建：errorChart 仍引用旧canvas，需要重绑
    try {
        if (this.errorChart && this.errorChart.canvas && this.errorChart.canvas !== canvas) {
            const keepData = this.errorChart.data || [];
            this.errorChart = null;
            // 继续往下走，按新的canvas重建，并在最后恢复data
            canvas._keepData = keepData;
        }
    } catch (e) {}

    // 绑定展开/收起按钮（只绑定一次）
    try {
        const toggleBtn = document.getElementById('error-chart-toggle');
        if (toggleBtn && !toggleBtn._bound) {
            toggleBtn._bound = true;
            toggleBtn.addEventListener('click', () => this.toggleErrorChartExpand());
        }
    } catch (e) {}

    // 恢复展开状态
    try {
        const saved = localStorage.getItem('slipway_error_chart_expanded');
        this.chartExpanded = (saved === '1');
    } catch (e) {
        this.chartExpanded = false;
    }

    // 恢复“减去首点偏移”状态，并绑定checkbox
    try {
        const saved = localStorage.getItem('slipway_error_subtract_baseline');
        this.subtractBaselineError = (saved === '1');
    } catch (e) {
        this.subtractBaselineError = false;
    }
    try {
        const cb = document.getElementById('error-subtract-baseline');
        if (cb && !cb._bound) {
            cb._bound = true;
            cb.checked = !!this.subtractBaselineError;
            cb.addEventListener('change', () => {
                this.subtractBaselineError = !!cb.checked;
                try {
                    localStorage.setItem('slipway_error_subtract_baseline', this.subtractBaselineError ? '1' : '0');
                } catch (e) {}
                this.updateErrorChart();
            });
        } else if (cb) {
            cb.checked = !!this.subtractBaselineError;
        }
    } catch (e) {}

    try {
        const savedMetric = localStorage.getItem('slipway_chart_metric');
        if (savedMetric) this.chartMetricKey = savedMetric;
    } catch (e) {}
    try {
        const metricSelect = document.getElementById('error-chart-metric');
        if (metricSelect && !metricSelect._bound) {
            metricSelect._bound = true;
            metricSelect.addEventListener('change', () => this.setChartMetric(metricSelect.value));
        }
    } catch (e) {}
    this.syncChartMetricUi();

    // 先同步容器状态，但不触发reflow（避免初始化时重复计算）
    this.applyErrorChartExpandState(false);

    const ctx = canvas.getContext('2d');
    // 设置canvas实际尺寸（按DPR缩放，保证文字清晰）
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(10, rect.width - 24);
    const cssH = this.chartExpanded ? 320 : 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas._dpr = dpr;
    canvas._cssW = cssW;
    canvas._cssH = cssH;

    const initData = canvas._keepData || [];
    try { delete canvas._keepData; } catch (e) {}
    this.errorChart = { ctx, canvas, data: initData };
    this.renderErrorChart();
};

SlipwayPage.applyErrorChartExpandState = function(reflow = true) {
    const container = document.querySelector('.slipway-container');
    if (container) container.classList.toggle('chart-expanded', !!this.chartExpanded);

    const btn = document.getElementById('error-chart-toggle');
    if (btn) btn.textContent = this.chartExpanded ? '收起' : '展开';

    if (!reflow) return;
    // 切换后重新计算尺寸并重绘（避免 canvas 变形）
    setTimeout(() => {
        if (!this.errorChart || !this.errorChart.canvas) return;
        const canvas = this.errorChart.canvas;
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.max(10, rect.width - 24);
        const cssH = this.chartExpanded ? 320 : 220;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas._dpr = dpr;
        canvas._cssW = cssW;
        canvas._cssH = cssH;
        this.renderErrorChart();
        this.updateChartStats();
    }, 180);
};

SlipwayPage.toggleErrorChartExpand = function() {
    this.chartExpanded = !this.chartExpanded;
    try {
        localStorage.setItem('slipway_error_chart_expanded', this.chartExpanded ? '1' : '0');
    } catch (e) {}
    this.applyErrorChartExpandState(true);
};

SlipwayPage.updateErrorChart = function(results) {
    // 如果canvas被重建或当前页面尚未渲染出来，确保重新init
    try {
        const canvas = document.getElementById('error-chart');
        if (!canvas || (this.errorChart && this.errorChart.canvas && this.errorChart.canvas !== canvas)) {
            this.errorChart = null;
        }
    } catch (e) {}

    if (!this.errorChart) this.initErrorChart();
    if (!this.errorChart) return;

    const def = this.getChartMetricDef();
    const raw = (results || this.testResults || []).map((r) => {
        if (!r) return null;
        const pos = Number(r.target ?? r.position);
        const rawValue = def.getValue(r);
        if (!Number.isFinite(pos) || !Number.isFinite(rawValue)) return null;
        return {
            pos,
            rawValue,
            row: r
        };
    }).filter(Boolean);
    const baseline = (this.subtractBaselineError && raw.length > 0) ? raw[0].rawValue : 0;

    const uniquePos = new Set(raw.map(item => item.pos));
    const useSampleIndex = uniquePos.size <= 1;
    let mapped;
    if (useSampleIndex) {
        mapped = raw.map((item, index) => ({
            pos: item.pos,
            xValue: index + 1,
            xLabel: `#${index + 1}`,
            value: item.rawValue - baseline,
            rawValue: item.rawValue,
            sampleCount: 1
        }));
    } else {
        const grouped = new Map();
        raw.forEach((item) => {
            const key = String(item.pos);
            let bucket = grouped.get(key);
            if (!bucket) {
                bucket = { pos: item.pos, sum: 0, count: 0 };
                grouped.set(key, bucket);
            }
            bucket.sum += item.rawValue;
            bucket.count += 1;
        });
        mapped = Array.from(grouped.values()).map((bucket) => {
            const avgRaw = bucket.count > 0 ? (bucket.sum / bucket.count) : 0;
            return {
                pos: bucket.pos,
                xValue: bucket.pos,
                xLabel: `${bucket.pos.toFixed(0)}`,
                value: avgRaw - baseline,
                rawValue: avgRaw,
                sampleCount: bucket.count
            };
        });
    }
    mapped.sort((a, b) => (a.xValue - b.xValue));
    this.errorChart.data = mapped;
    this.errorChart.metric = def;
    this.errorChart.useSampleIndex = useSampleIndex;
    
    this.renderErrorChart();
    this.updateChartStats();
};

SlipwayPage.renderErrorChart = function() {
    if (!this.errorChart) return;
    const { ctx, canvas, data } = this.errorChart;
    const metric = this.errorChart.metric || this.getChartMetricDef();
    const dpr = canvas._dpr || window.devicePixelRatio || 1;
    const w = (canvas._cssW || (canvas.width / dpr) || canvas.width);
    const h = (canvas._cssH || (canvas.height / dpr) || canvas.height);

    // 使用DPR缩放，保证文字/线条清晰
    try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (e) {}

    // 主题色
    const rootStyle = getComputedStyle(document.documentElement);
    const textColor = (rootStyle.getPropertyValue('--text-color') || '').trim() || '#F3FBFF';
    const textDim = (rootStyle.getPropertyValue('--text-dim') || '').trim() || 'rgba(255,255,255,0.82)';
    const fontUi = (rootStyle.getPropertyValue('--font-ui') || '').trim() || '"Microsoft YaHei UI", "Segoe UI", Arial, sans-serif';
    const fontMono = (rootStyle.getPropertyValue('--font-mono') || '').trim() || 'Consolas, "Cascadia Mono", monospace';
    const gridColor = 'rgba(255,255,255,0.18)';
    
    // 清空画布并铺底色
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, w, h);
    
    // 边距
    const paddingLeft = 62;
    const paddingRight = 18;
    const paddingTop = 22;
    const paddingBottom = 36;
    const chartW = w - paddingLeft - paddingRight;
    const chartH = h - paddingTop - paddingBottom;
    
    if (data.length === 0) {
        ctx.fillStyle = textDim;
        ctx.font = `500 13px ${fontUi}`;
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', w / 2, h / 2);
        return;
    }
    
    // 计算数据范围
    const values = data.map(d => d.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const meanVal = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
    const thresholdValue = typeof metric.threshold === 'function' ? metric.threshold() : metric.threshold;

    let yMin = minVal;
    let yMax = maxVal;
    if (metric.symmetric || (Number.isFinite(thresholdValue) && thresholdValue > 0)) {
        const range = Math.max(Math.abs(minVal), Math.abs(maxVal), Math.abs(Number(thresholdValue) || 0), 1);
        yMin = -range * 1.15;
        yMax = range * 1.15;
    } else {
        const span = Math.max(maxVal - minVal, Math.abs(maxVal) * 0.12, Math.abs(minVal) * 0.12, 1);
        yMin = minVal - span * 0.18;
        yMax = maxVal + span * 0.18;
        if (Math.abs(yMax - yMin) < 1e-6) {
            yMin -= 1;
            yMax += 1;
        }
    }
    
    const xMin = Math.min(...data.map(d => Number(d.xValue)));
    const xMax = Math.max(...data.map(d => Number(d.xValue)));
    const xRange = Math.max(xMax - xMin, 1);
    const useSampleIndex = !!this.errorChart.useSampleIndex;
    // 坐标转换函数
    const toXPos = (xValue) => paddingLeft + ((xValue - xMin) / xRange) * chartW;
    const toY = (value) => {
        const ratio = (yMax - value) / Math.max(yMax - yMin, 1e-6);
        return paddingTop + ratio * chartH;
    };
    
    // 绘制背景网格（水平线）
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const yTickValues = Array.from({ length: 7 }, (_, idx) => yMin + ((yMax - yMin) * idx / 6));
    yTickValues.forEach(v => {
        const y = toY(v);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(w - paddingRight, y);
        ctx.stroke();
    });
    
    // 绘制趋势曲线
    ctx.beginPath();
    ctx.strokeStyle = metric.color;
    ctx.lineWidth = 2.6;
    data.forEach((d, index) => {
        const x = toXPos(d.xValue);
        const y = toY(d.value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // 绘制数据点
    ctx.fillStyle = metric.color;
    data.forEach((d) => {
        const x = toXPos(d.xValue);
        const y = toY(d.value);
        ctx.beginPath();
        ctx.arc(x, y, 3.8, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // 绘制零线（范围跨过0时显示）
    if (yMin < 0 && yMax > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.2;
        const zeroY = toY(0);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, zeroY);
        ctx.lineTo(w - paddingRight, zeroY);
        ctx.stroke();
    }
    
    // 绘制平均线
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]);
    const avgY = toY(meanVal);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, avgY);
    ctx.lineTo(w - paddingRight, avgY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 绘制±阈值线（仅支持带阈值的指标）
    if (Number.isFinite(Number(thresholdValue))) {
        const thr = Number(thresholdValue);
        ctx.strokeStyle = 'rgba(255,176,32,0.9)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(paddingLeft, toY(thr));
        ctx.lineTo(w - paddingRight, toY(thr));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(paddingLeft, toY(-thr));
        ctx.lineTo(w - paddingRight, toY(-thr));
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // ===== Y轴标签 =====
    ctx.font = `600 12px ${fontMono}`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'right';
    yTickValues.forEach(v => {
        const y = toY(v);
        const txt = Number(v).toFixed(metric.unit === 'mm' ? 1 : 0);
        ctx.fillText(txt, paddingLeft - 5, y + 4);
    });
    
    // ===== X轴标签（显示位置mm） =====
    ctx.font = `600 12px ${fontMono}`;
    ctx.textAlign = 'center';
    {
        const xTickCount = 5;
        for (let i = 0; i < xTickCount; i++) {
            const xValue = xMin + (xRange * i / (xTickCount - 1));
            const x = toXPos(xValue);
            const label = useSampleIndex ? `#${Math.round(xValue)}` : `${xValue.toFixed(0)}`;
            ctx.fillText(label, x, h - 8);
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, paddingTop);
            ctx.lineTo(x, h - paddingBottom);
            ctx.stroke();
        }
    }
    
    // Y轴标题
    ctx.save();
    ctx.translate(14, paddingTop + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = textDim;
    ctx.font = `500 12px ${fontUi}`;
    ctx.fillText(metric.unit ? `${metric.label}(${metric.unit})` : metric.label, 0, 0);
    ctx.restore();
    
    // X轴标题
    ctx.textAlign = 'center';
    ctx.fillStyle = textDim;
    ctx.font = `500 12px ${fontUi}`;
    ctx.fillText(useSampleIndex ? '样本序号' : '位置(mm)', paddingLeft + chartW / 2, h - 20);
};

SlipwayPage.updateChartStats = function() {
    const data = this.errorChart?.data || [];
    if (data.length === 0) return;
    const metric = this.errorChart?.metric || this.getChartMetricDef();
    const rawValues = data.map(d => Number(d.value)).filter(v => Number.isFinite(v));
    const statValues = metric.absStats ? rawValues.map(v => Math.abs(v)) : rawValues;
    if (statValues.length === 0) return;

    const max = Math.max(...statValues);
    const min = Math.min(...statValues);
    const avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;
    const std = Math.sqrt(statValues.map(v => (v - avg) ** 2).reduce((a, b) => a + b, 0) / statValues.length);
    
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = this._formatChartMetricValue(val, metric, metric.unit === 'mm' ? 2 : 1);
    };
    
    setVal('chart-max', max);
    setVal('chart-min', min);
    setVal('chart-avg', avg);
    setVal('chart-std', std);
};

// ========== 调试：注入测试数据（复现坐标/阈值线显示问题） ==========
SlipwayPage.debugInjectErrorData = function() {
    const pts = [];
    const base = 5000;
    for (let i = 0; i < 12; i++) {
        const pos = base + i * 2000;
        // 构造一个既有正负误差、也有接近阈值/超阈值的波形
        const err = (i % 2 === 0 ? 1 : -1) * (2 + (i % 5) * 1.6);
        pts.push({
            target: pos,
            actual: pos + err,
            error: err,
            reflectance: 90
        });
    }
    // 手动设一个阈值，方便看橙色虚线
    SlipwayPage.errorThresholdMm = 5;
    SlipwayPage.updateErrorChart(pts);
};

// ========== 高级流程：多配置管理 ==========
SlipwayPage.advConfigs = {};          // { configName: { segments: [], threshold: 5, pointTime: 3 } }
SlipwayPage.currentAdvConfig = 'default';

SlipwayPage.initAdvConfigs = function() {
    // 从 localStorage 加载配置
    try {
        const saved = localStorage.getItem('slipway_adv_configs');
        if (saved) {
            this.advConfigs = JSON.parse(saved);
        }
    } catch (e) {}
    
    // 确保有默认配置
    if (!this.advConfigs['default']) {
        this.advConfigs['default'] = {
            name: '默认配置',
            segments: [
                { reflectance: 90, start_pos: 0, end_pos: 38000, step: 1000, samples: 1 },
                { reflectance: 10, start_pos: 38000, end_pos: 0, step: 1000, samples: 1 }
            ],
            threshold: 5,
            pointTime: 3
        };
    }

    if (!this.advConfigs['sim_3seg']) {
        this.advConfigs['sim_3seg'] = {
            name: '仿真-三段(90→70→30)',
            segments: [
                { reflectance: 90, start_pos: 0, end_pos: 12000, step: 1000, samples: 1 },
                { reflectance: 70, start_pos: 12000, end_pos: 24000, step: 800, samples: 1 },
                { reflectance: 30, start_pos: 24000, end_pos: 38000, step: 1200, samples: 1 }
            ],
            threshold: 5,
            pointTime: 2
        };
    }
    if (!this.advConfigs['sim_multisample']) {
        this.advConfigs['sim_multisample'] = {
            name: '仿真-多采样(同段3次)',
            segments: [
                { reflectance: 90, start_pos: 0, end_pos: 10000, step: 1000, samples: 3 },
                { reflectance: 90, start_pos: 10000, end_pos: 0, step: 1000, samples: 3 }
            ],
            threshold: 5,
            pointTime: 2
        };
    }
    if (!this.advConfigs['sim_reverse']) {
        this.advConfigs['sim_reverse'] = {
            name: '仿真-反向段(高→低)',
            segments: [
                { reflectance: 80, start_pos: 38000, end_pos: 20000, step: 1500, samples: 1 },
                { reflectance: 40, start_pos: 20000, end_pos: 0, step: 1500, samples: 1 }
            ],
            threshold: 5,
            pointTime: 2
        };
    }
    if (!this.advConfigs['sim_sparse']) {
        this.advConfigs['sim_sparse'] = {
            name: '仿真-稀疏点(大步进)',
            segments: [
                { reflectance: 60, start_pos: 0, end_pos: 38000, step: 3000, samples: 1 }
            ],
            threshold: 5,
            pointTime: 2
        };
    }

    this.refreshAdvConfigSelect();
    this.loadAdvConfig(this.currentAdvConfig);
};

SlipwayPage.refreshAdvConfigSelect = function() {
    const sel = document.getElementById('adv-config-select');
    if (!sel) return;

    sel.innerHTML = '';
    Object.keys(this.advConfigs).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = this.advConfigs[key].name || key;
        if (key === this.currentAdvConfig) opt.selected = true;
        sel.appendChild(opt);
    });
};

SlipwayPage.loadAdvConfig = function(configKey) {
    const cfg = this.advConfigs[configKey];
    if (!cfg) return;
    
    this.currentAdvConfig = configKey;
    this.segments = cfg.segments ? JSON.parse(JSON.stringify(cfg.segments)) : [];
    this.errorThresholdMm = cfg.threshold || 5;
    this.estPointTimeSec = cfg.pointTime || 3;
    
    // 更新UI
    const thresholdEl = document.getElementById('err-threshold');
    const pointTimeEl = document.getElementById('point-time');
    if (thresholdEl) thresholdEl.value = this.errorThresholdMm;
    if (pointTimeEl) pointTimeEl.value = this.estPointTimeSec;
    
    this.syncTextareaFromSegments();
    this.renderSegmentPreview();
    
    // 保存当前选择
    try { localStorage.setItem('slipway_current_adv_config', configKey); } catch (e) {}
};

SlipwayPage.saveCurrentAdvConfig = function() {
    const cfg = this.advConfigs[this.currentAdvConfig];
    if (!cfg) return;
    
    cfg.segments = JSON.parse(JSON.stringify(this.segments || []));
    cfg.threshold = this.errorThresholdMm;
    cfg.pointTime = this.estPointTimeSec;
    
    this._persistAdvConfigs();
};

SlipwayPage.saveAdvConfigAs = function() {
    const name = prompt('请输入新配置名称:', '配置-' + Date.now());
    if (!name) return;
    
    const key = 'cfg_' + Date.now();
    this.advConfigs[key] = {
        name: name,
        segments: JSON.parse(JSON.stringify(this.segments || [])),
        threshold: this.errorThresholdMm,
        pointTime: this.estPointTimeSec
    };
    
    this.currentAdvConfig = key;
    this._persistAdvConfigs();
    this.refreshAdvConfigSelect();
    Utils.toast('配置已保存: ' + name, 'success');
};

SlipwayPage.deleteAdvConfig = function() {
    if (this.currentAdvConfig === 'default') {
        Utils.toast('不能删除默认配置', 'warning');
        return;
    }
    
    if (!confirm('确定删除当前配置?')) return;
    
    delete this.advConfigs[this.currentAdvConfig];
    this.currentAdvConfig = 'default';
    this._persistAdvConfigs();
    this.refreshAdvConfigSelect();
    this.loadAdvConfig('default');
    Utils.toast('配置已删除', 'success');
};

SlipwayPage._persistAdvConfigs = function() {
    try {
        localStorage.setItem('slipway_adv_configs', JSON.stringify(this.advConfigs));
    } catch (e) {}
};

// ========== 多流程Tab管理 ==========
SlipwayPage.segmentResults = {};      // { segIdx: [results...] }
SlipwayPage.activeSegmentTab = 'all';

SlipwayPage.initSegmentTabs = function() {
    if (this.segmentResults && Object.keys(this.segmentResults).length > 0) {
        if (!this.activeSegmentTab) this.activeSegmentTab = 'all';
        this.updateSegmentTabs();
        return;
    }
    this.segmentResults = {};
    this.activeSegmentTab = 'all';
    this.updateSegmentTabs();
};

SlipwayPage.updateSegmentTabs = function() {
    const tabsEl = document.getElementById('segment-tabs');
    if (!tabsEl) return;
    
    // 构建Tab按钮
    let html = '<button class="seg-tab' + (this.activeSegmentTab === 'all' ? ' active' : '') + 
               '" data-seg="all" onclick="SlipwayPage.switchSegmentTab(\'all\')">全部</button>';
    
    const segments = this.segments || [];
    segments.forEach((seg, idx) => {
        const count = (this.segmentResults[idx] || []).length;
        const label = `段${idx + 1}(${seg.reflectance || '--'}%) [${count}]`;
        html += `<button class="seg-tab${this.activeSegmentTab === String(idx) ? ' active' : ''}" 
                  data-seg="${idx}" onclick="SlipwayPage.switchSegmentTab('${idx}')">${label}</button>`;
    });
    
    tabsEl.innerHTML = html;
};

SlipwayPage.switchSegmentTab = function(tabKey) {
    this.activeSegmentTab = tabKey;
    this.updateSegmentTabs();
    this.renderResultsTable();
    
    // 更新误差图 - 传入当前Tab对应的数据
    const chartData = this.getResultsForCurrentTab();
    this.updateErrorChart(chartData);
    
    // 切换Tab后恢复自动滚动
    this.resumeAutoScroll();
    this._schedulePersistState();
};

// 获取当前Tab对应的结果数据
SlipwayPage.getResultsForCurrentTab = function() {
    if (this.activeSegmentTab === 'all') {
        return this.testResults || [];
    }
    const segIdx = parseInt(this.activeSegmentTab, 10);
    return this.segmentResults[segIdx] || [];
};

SlipwayPage.addResultToSegment = function(segIdx, result) {
    if (!this.segmentResults[segIdx]) {
        this.segmentResults[segIdx] = [];
    }
    this.segmentResults[segIdx].push(result);
};

// ========== 自动滚动控制 ==========
SlipwayPage.autoScrollEnabled = true;
SlipwayPage.autoScrollPauseTimer = null;
SlipwayPage.AUTO_SCROLL_RESUME_DELAY = 5000; // 5秒无操作后恢复

SlipwayPage.onTableScroll = function() {
    // 用户操作，暂停自动滚动
    this.pauseAutoScroll();
};

SlipwayPage.pauseAutoScroll = function() {
    this.autoScrollEnabled = false;
    
    // 清除之前的计时器
    if (this.autoScrollPauseTimer) {
        clearTimeout(this.autoScrollPauseTimer);
    }
    
    // 5秒后恢复自动滚动
    this.autoScrollPauseTimer = setTimeout(() => {
        this.resumeAutoScroll();
    }, this.AUTO_SCROLL_RESUME_DELAY);
};

SlipwayPage.resumeAutoScroll = function() {
    this.autoScrollEnabled = true;
    if (this.autoScrollPauseTimer) {
        clearTimeout(this.autoScrollPauseTimer);
        this.autoScrollPauseTimer = null;
    }
    
    // 立即滚动到最新
    this.scrollToLatest();
};

SlipwayPage.scrollToLatest = function() {
    if (!this.autoScrollEnabled) return;
    
    const tbody = document.getElementById('results-tbody');
    if (tbody) {
        tbody.scrollTop = tbody.scrollHeight;
    }
};

// ========== 修改结果表格渲染，支持按段筛选 + 内存优化 ==========
SlipwayPage.renderResultsTable = function() {
    const tbody = document.getElementById('results-tbody');
    if (!tbody) return;
    
    let results = [];
    
    if (this.activeSegmentTab === 'all') {
        // 显示全部结果
        results = this.testResults || [];
    } else {
        // 显示指定段的结果
        const segIdx = parseInt(this.activeSegmentTab, 10);
        results = this.segmentResults[segIdx] || [];
    }
    
    if (results.length === 0) {
        tbody.innerHTML = '<div class="table-row empty">暂无数据</div>';
        return;
    }
    
    // 内存优化：限制表格显示行数，只显示最新的数据
    const totalCount = results.length;
    const displayResults = results.length > this.MAX_TABLE_ROWS 
        ? results.slice(-this.MAX_TABLE_ROWS) 
        : results;
    const startIndex = results.length > this.MAX_TABLE_ROWS 
        ? results.length - this.MAX_TABLE_ROWS 
        : 0;
    
    // 如果数据被截断，显示提示
    let truncateHint = '';
    if (totalCount > this.MAX_TABLE_ROWS) {
        truncateHint = `<div class="table-row truncate-hint" style="background: rgba(255,200,100,0.1); color: #ffc864; text-align: center; padding: 8px;">
            ⚠️ 仅显示最新 ${this.MAX_TABLE_ROWS} 条记录 (共 ${totalCount} 条)
        </div>`;
    }
    
    tbody.innerHTML = truncateHint + displayResults.map((r, i) => {
        const errorClass = Math.abs((r.error ?? 0)) > (this.errorThresholdMm || 5) ? 'error-high' : '';
        const statusTitle = this._buildMeasureTooltip(r);
        // 时间显示：优先使用 time_ms（测距耗时），否则显示 timestamp
        let timeDisplay = '--';
        if (r.time_ms !== undefined && r.time_ms !== null) {
            timeDisplay = r.time_ms + 'ms';
        } else if (r.timestamp) {
            // 从 ISO 时间戳提取时间部分
            try {
                const d = new Date(r.timestamp);
                timeDisplay = d.toLocaleTimeString('zh-CN', {hour12: false});
            } catch (e) {
                timeDisplay = r.timestamp;
            }
        }
        const amplitudeDisplay = this._formatDiagNumber(r.amplitude, 0);
        const rangeDisplay = this._formatDiagNumber(r.range_mm, 1);
        const reflectanceDisplay = this._displayReflectance(r.reflectance);
        return `
            <div class="table-row ${errorClass}">
                <span>${startIndex + i + 1}</span>
                <span>${timeDisplay}</span>
                <span>${(r.target ?? 0).toFixed(1)}</span>
                <span>${(r.actual ?? 0).toFixed(1)}</span>
                <span>${amplitudeDisplay}</span>
                <span>${rangeDisplay}</span>
                <span class="error-val">${(r.error ?? 0).toFixed(2)}</span>
                <span>${reflectanceDisplay}</span>
                <span class="status-${r.status || 'ok'}" title="${statusTitle}">${r.status === 'error' ? '异常' : '正常'}</span>
            </div>
        `;
    }).join('');
    
    // 更新记录数（显示总数）
    const totalEl = document.getElementById('total-records');
    if (totalEl) totalEl.textContent = totalCount;
    
    // 自动滚动到最新
    if (this.autoScrollEnabled) {
        requestAnimationFrame(() => this.scrollToLatest());
    }
};

// ========== 初始化时加载配置 ==========
(function() {
    const originalInit = SlipwayPage.init;
    SlipwayPage.init = function() {
        if (originalInit) originalInit.call(this);
        this.initAdvConfigs();
        this.initSegmentTabs();
        
        // 恢复上次选择的配置
        try {
            const lastConfig = localStorage.getItem('slipway_current_adv_config');
            if (lastConfig && this.advConfigs[lastConfig]) {
                this.loadAdvConfig(lastConfig);
            }
        } catch (e) {}
    };
})();
