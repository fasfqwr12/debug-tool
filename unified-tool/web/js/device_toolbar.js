/**
 * DeviceToolbar - 全局设备控制工具栏
 * 提供快捷的设备操作，可在任何页面使用
 * 支持拖动移动位置
 */

const DeviceToolbar = {
    visible: false,
    _refreshTimer: null,
    _isDragging: false,
    _dragOffset: { x: 0, y: 0 },
    _measureType: null,
    _lastMeasureRefreshTs: 0,
    _l1MeasureTimer: null,
    _l1MeasureInFlight: false,
    _l1MeasureStats: null,
    _compProfileId: null,
    _compProto: null,
    _compControls: null,
    _lastProtocolRefreshTs: 0,
    _protocolOverview: null,
    _protocolDevices: [],
    _activeTab: 'protocol',
    maxSlipwayPosMm: 38000,
    
    /**
     * 切换工具栏显示/隐藏
     */
    toggle() {
        this.visible = !this.visible;
        const toolbar = document.getElementById('device-toolbar');
        const btn = document.querySelector('.status-toolbar-btn');
        
        if (toolbar) {
            toolbar.style.display = this.visible ? 'block' : 'none';
        }
        if (btn) {
            btn.classList.toggle('active', this.visible);
        }
        
        if (this.visible) {
            this.restoreInputs();
            this._restoreActiveTab();
            this.switchTab(this._activeTab, false);
            this.syncStatus();
            this._startRefresh();
            this._initDrag();
            this._restorePosition();
            this.refreshProtocolOverview();
            // 初始化流程
            this.refreshWorkflows();
            // 根据当前工位配置，显示/隐藏竞品基准控制
            this.refreshCompetitorControls();
        } else {
            this.saveInputs();
            this._stopRefresh();
            this.stopL1MeasureLoop(true);
        }
    },
    
    /**
     * 初始化拖动功能
     */
    _initDrag() {
        const toolbar = document.getElementById('device-toolbar');
        const handle = document.getElementById('toolbar-drag-handle');
        if (!toolbar || !handle) return;
        
        handle.style.cursor = 'move';
        
        handle.onmousedown = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            this._isDragging = true;
            const rect = toolbar.getBoundingClientRect();
            this._dragOffset.x = e.clientX - rect.left;
            this._dragOffset.y = e.clientY - rect.top;
            document.body.style.userSelect = 'none';
        };
        
        document.onmousemove = (e) => {
            if (!this._isDragging) return;
            const x = e.clientX - this._dragOffset.x;
            const y = e.clientY - this._dragOffset.y;
            
            // 限制在窗口内
            const maxX = window.innerWidth - toolbar.offsetWidth;
            const maxY = window.innerHeight - toolbar.offsetHeight;
            toolbar.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
            toolbar.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
            toolbar.style.right = 'auto';
        };
        
        document.onmouseup = () => {
            if (this._isDragging) {
                this._isDragging = false;
                document.body.style.userSelect = '';
                this._savePosition();
            }
        };
    },
    
    /**
     * 保存工具栏位置
     */
    _savePosition() {
        const toolbar = document.getElementById('device-toolbar');
        if (!toolbar) return;
        try {
            localStorage.setItem('toolbar_pos', JSON.stringify({
                left: toolbar.style.left,
                top: toolbar.style.top
            }));
        } catch (e) {}
    },
    
    /**
     * 恢复工具栏位置
     */
    _restorePosition() {
        const toolbar = document.getElementById('device-toolbar');
        if (!toolbar) return;
        try {
            const pos = JSON.parse(localStorage.getItem('toolbar_pos'));
            if (pos && pos.left && pos.top) {
                toolbar.style.left = pos.left;
                toolbar.style.top = pos.top;
                toolbar.style.right = 'auto';
            }
        } catch (e) {}
    },
    
    /**
     * 保存输入框值
     */
    saveInputs() {
        try {
            const data = {
                slipwayIp: document.getElementById('toolbar-slipway-ip')?.value || '',
                slipwayTarget: document.getElementById('toolbar-slipway-target')?.value || '',
                slipwayStep: document.getElementById('toolbar-slipway-step')?.value || '10'
            };
            localStorage.setItem('toolbar_inputs', JSON.stringify(data));
        } catch (e) {}
    },
    
    /**
     * 恢复输入框值
     */
    restoreInputs() {
        try {
            const data = JSON.parse(localStorage.getItem('toolbar_inputs')) || {};
            const savedIp = data.slipwayIp || localStorage.getItem('hub_tcp_ip') || '192.168.2.46';
            const savedPort = localStorage.getItem('hub_tcp_port') || '6000';
            
            const ipInput = document.getElementById('toolbar-slipway-ip');
            if (ipInput) {
                ipInput.value = data.slipwayIp || `${savedIp}:${savedPort}`;
            }
            
            const targetInput = document.getElementById('toolbar-slipway-target');
            if (targetInput && data.slipwayTarget) {
                targetInput.value = data.slipwayTarget;
            }
            
            const stepInput = document.getElementById('toolbar-slipway-step');
            if (stepInput) {
                stepInput.value = data.slipwayStep || '10';
            }
        } catch (e) {}
        this._syncSlipwaySoftLimitUi();
    },

    _getSlipwaySoftLimitMm() {
        const maxPos = parseFloat(this.maxSlipwayPosMm);
        return Number.isFinite(maxPos) && maxPos > 0 ? maxPos : 38000;
    },

    _syncSlipwaySoftLimitUi() {
        const maxPos = this._getSlipwaySoftLimitMm();
        const applyLimit = (id, extra = {}) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.min = String(extra.min ?? 0);
            el.max = String(maxPos);
            if (extra.placeholder !== undefined) {
                el.placeholder = extra.placeholder;
            }
            el.title = `软限位范围: ${extra.min ?? 0} ~ ${maxPos} mm`;
        };

        applyLimit('toolbar-slipway-target', { min: 0, placeholder: `0 ~ ${maxPos}` });
        applyLimit('toolbar-slipway-step', { min: 0, placeholder: `0 ~ ${maxPos}` });

        this._clampSlipwayTargetInput();
        this._clampSlipwayStepInput();
    },

    _clampSlipwayNumberInput(inputId, min = 0, max = this._getSlipwaySoftLimitMm()) {
        const el = document.getElementById(inputId);
        if (!el) return null;
        const raw = String(el.value || '').trim();
        if (!raw) return null;

        let value = parseFloat(raw);
        if (!Number.isFinite(value)) return null;
        if (value < min) value = min;
        if (value > max) value = max;
        el.value = String(value);
        return value;
    },

    _clampSlipwayTargetInput() {
        return this._clampSlipwayNumberInput('toolbar-slipway-target', 0, this._getSlipwaySoftLimitMm());
    },

    _clampSlipwayStepInput() {
        return this._clampSlipwayNumberInput('toolbar-slipway-step', 0, this._getSlipwaySoftLimitMm());
    },
    
    /**
     * 开始定时刷新状态
     */
    _startRefresh() {
        if (this._refreshTimer) return;
        this._refreshTimer = setInterval(() => this.syncStatus(), 2000);  // 2秒刷新（原500ms）
    },
    
    /**
     * 停止刷新
     */
    _stopRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    },
    
    /**
     * 同步设备状态到工具栏UI
     */
    async syncStatus() {
        if (!this.visible) return;
        
        // 滑台状态
        const slipwayBtn = document.getElementById('toolbar-slipway-btn');
        if (slipwayBtn && window.DeviceHub) {
            const connected = DeviceHub.isSlipwayConnected();
            slipwayBtn.textContent = connected ? '断开' : '连接';
            slipwayBtn.classList.toggle('connected', connected);
        }
        
        // 滑台位置
        try {
            if (DeviceHub.isSlipwayConnected() || DeviceHub.simulationEnabled) {
                const status = await API.slipway.getStatus();
                if (status && status.connected) {
                    const pos = typeof status.position === 'number' ? 
                        status.position.toFixed(3) : (status.position || '--');
                    const posEl = document.getElementById('toolbar-slipway-pos');
                    if (posEl) posEl.textContent = pos;
                }
            }
        } catch (e) {}
        
        // 转靶反射率
        try {
            if (DeviceHub.isSlipwayConnected() || DeviceHub.simulationEnabled) {
                const rotary = await API.slipway.rotaryGetStatus();
                if (rotary && rotary.connected) {
                    const ref = rotary.reflectance || rotary.reflect || rotary.position || '--';
                    const refEl = document.getElementById('toolbar-rotary-ref');
                    if (refEl) refEl.textContent = ref + '%';
                }
            }
        } catch (e) {}

        // 竞品控制区是否显示（不需要高频刷新，但保持在2s节奏里同步更省心）
        try {
            const now = Date.now();
            const needHard = !this._lastMeasureRefreshTs || (now - this._lastMeasureRefreshTs > 8000);
            await this.refreshCompetitorControls(!needHard);
            if (needHard) this._lastMeasureRefreshTs = now;
        } catch (e) {}

        try {
            const now = Date.now();
            const needHard = !this._lastProtocolRefreshTs || (now - this._lastProtocolRefreshTs > 8000);
            if (needHard) {
                await this.refreshProtocolOverview();
                this._lastProtocolRefreshTs = now;
            } else {
                this._renderProtocolDeviceSelect();
            }
        } catch (e) {}
    },

    _restoreActiveTab() {
        try {
            const saved = localStorage.getItem('toolbar_active_tab');
            if (saved) {
                this._activeTab = saved;
            }
        } catch (e) {}
    },

    switchTab(tabId, persist = true) {
        const buttons = Array.from(document.querySelectorAll('#device-toolbar [data-toolbar-tab]'));
        const panels = Array.from(document.querySelectorAll('#device-toolbar [data-toolbar-panel]'));
        if (!buttons.length || !panels.length) return;

        let nextTab = String(tabId || this._activeTab || 'protocol').trim() || 'protocol';
        const visibleButtons = buttons.filter(btn => btn.style.display !== 'none');
        if (!visibleButtons.some(btn => btn.dataset.toolbarTab === nextTab)) {
            nextTab = visibleButtons[0]?.dataset.toolbarTab || 'protocol';
        }

        this._activeTab = nextTab;

        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.toolbarTab === nextTab);
        });
        panels.forEach(panel => {
            panel.classList.toggle('active', panel.dataset.toolbarPanel === nextTab);
        });

        if (persist) {
            try {
                localStorage.setItem('toolbar_active_tab', nextTab);
            } catch (e) {}
        }
    },

    _syncTabVisibility() {
        const competitorSection = document.getElementById('toolbar-competitor-section');
        const competitorBtn = document.querySelector('#device-toolbar [data-toolbar-tab="competitor"]');
        const showCompetitor = !!(competitorSection && competitorSection.style.display !== 'none');

        if (competitorBtn) {
            competitorBtn.style.display = showCompetitor ? '' : 'none';
        }

        if (!showCompetitor && this._activeTab === 'competitor') {
            this.switchTab('protocol');
            return;
        }

        this.switchTab(this._activeTab, false);
    },

    _escapeHtml(v) {
        return String(v == null ? '' : v).replace(/[<>&"]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[s]));
    },

    _renderProtocolDeviceSelect() {
        const select = document.getElementById('toolbar-protocol-device-select');
        if (!select) return;
        const managerDevices = (window.DeviceConfigManager && typeof DeviceConfigManager.listDevices === 'function')
            ? (DeviceConfigManager.listDevices() || [])
            : [];
        const devices = Array.isArray(this._protocolDevices) && this._protocolDevices.length
            ? this._protocolDevices
            : managerDevices;
        const current = (window.DeviceConfigManager && typeof DeviceConfigManager.getCurrentDevice === 'function')
            ? (DeviceConfigManager.getCurrentDevice() || '')
            : '';
        const activeProtocolId = this._protocolOverview?.active_protocol?.protocol_id || '';
        const prev = select.value;
        if (!devices.length) {
            select.innerHTML = '<option value="">-- 无机型 --</option>';
            return;
        }
        select.innerHTML = devices.map(d => {
            const id = this._escapeHtml(d.id || '');
            const name = this._escapeHtml(d.name || d.id || '');
            return `<option value="${id}">${name}</option>`;
        }).join('');
        const selected = devices.some(d => String(d.id) === String(current))
            ? current
            : (devices.some(d => String(d.id) === String(activeProtocolId))
                ? activeProtocolId
                : (prev || devices[0].id || ''));
        if (selected) select.value = selected;
    },

    _renderMeasureModeSelect(measure) {
        const select = document.getElementById('toolbar-measure-mode-select');
        if (!select) return;
        const modes = Array.isArray(measure?.available_modes) ? measure.available_modes : [];
        const current = String(measure?.selection_mode || measure?.type || 'firmware').trim() || 'firmware';
        const prev = select.value;
        if (!modes.length) {
            select.innerHTML = '<option value="firmware">我司固件</option>';
            select.value = 'firmware';
            return;
        }
        select.innerHTML = modes.map(item => {
            const id = this._escapeHtml(item.id || '');
            const label = this._escapeHtml(item.label || item.id || '');
            return `<option value="${id}">${label}</option>`;
        }).join('');
        const selected = modes.some(item => item.id === current)
            ? current
            : (modes.some(item => item.id === prev) ? prev : (modes[0]?.id || 'firmware'));
        select.value = selected;
    },

    _renderCompetitorProfileSelect(measure) {
        const row = document.getElementById('toolbar-comp-profile-row');
        const select = document.getElementById('toolbar-comp-profile-select');
        if (!row || !select) return;

        const mode = String(measure?.selection_mode || measure?.type || 'firmware').trim().toLowerCase();
        const profiles = Array.isArray(measure?.competitor_profiles) ? measure.competitor_profiles : [];
        const show = mode === 'competitor_profile';
        row.style.display = show ? '' : 'none';
        if (!show) return;

        if (!profiles.length) {
            select.innerHTML = '<option value="">-- 协议库为空 --</option>';
            select.value = '';
            return;
        }

        const prev = select.value;
        select.innerHTML = profiles.map(item => {
            const id = this._escapeHtml(item.id || '');
            const label = this._escapeHtml(item.name || item.id || '');
            const kind = this._escapeHtml(item.kind_label || item.kind || '');
            const suffix = kind ? ` [${kind}]` : '';
            return `<option value="${id}">${label}${suffix}</option>`;
        }).join('');
        const current = String(measure?.profile_id || '').trim();
        const selected = profiles.some(item => item.id === current)
            ? current
            : (profiles.some(item => item.id === prev) ? prev : (profiles[0]?.id || ''));
        select.value = selected;
    },

    _renderSupportedParsers(measure) {
        const box = document.getElementById('toolbar-supported-parsers');
        if (!box) return;
        const parsers = Array.isArray(measure?.supported_parsers) ? measure.supported_parsers : [];
        if (!parsers.length) {
            box.innerHTML = '<div class="toolbar-parser-card"><div class="toolbar-parser-desc">未获取到解析能力</div></div>';
            return;
        }

        box.innerHTML = parsers.map(item => {
            const classes = [
                'toolbar-parser-card',
                item.is_current ? 'current' : '',
                item.available ? '' : 'unavailable',
            ].filter(Boolean).join(' ');
            const badge = item.is_current ? '当前' : (item.available ? '可用' : '未启用');
            return `
                <div class="${classes}">
                    <div class="toolbar-parser-title">
                        <span>${this._escapeHtml(item.label || item.id || '--')}</span>
                        <span class="toolbar-parser-badge">${this._escapeHtml(badge)}</span>
                    </div>
                    <div class="toolbar-parser-desc">${this._escapeHtml(item.desc || '')}</div>
                </div>
            `;
        }).join('');
    },

    _renderProtocolOverview() {
        this._renderProtocolDeviceSelect();
        const ov = this._protocolOverview || {};
        const measure = ov.measure || {};
        const active = ov.active_protocol || {};
        const fb = ov.fb || {};
        const activeFb = fb.active_definition || null;
        this._measureType = measure.type || 'firmware';

        this._renderMeasureModeSelect(measure);
        this._renderCompetitorProfileSelect(measure);
        this._renderSupportedParsers(measure);

        const activeEl = document.getElementById('toolbar-active-protocol');
        const parserEl = document.getElementById('toolbar-measure-parser-current');
        const routeEl = document.getElementById('toolbar-measure-route');
        const fbEl = document.getElementById('toolbar-fb-summary');
        const hintEl = document.getElementById('toolbar-protocol-hint');

        if (activeEl) {
            const text = active.protocol_id
                ? `${active.protocol_id}${active.model_name ? ` (${active.model_name})` : ''}`
                : '--';
            activeEl.textContent = text;
        }

        if (parserEl) {
            let text = measure.resolved_label || measure.label || '--';
            if (measure.profile_name || measure.profile_id) {
                text += ` / ${measure.profile_name || measure.profile_id}`;
            }
            parserEl.textContent = text;
        }

        if (routeEl) {
            let text = measure.route_text || '--';
            if (measure.current_profile_kind) {
                text += ` / ${measure.current_profile_kind}`;
            }
            routeEl.textContent = text;
        }

        if (fbEl) {
            const text = activeFb
                ? `${activeFb.profile || 'FB'} / ${activeFb.recv_params_count || 0}字段 / 总数${fb.definition_count || 0}`
                : `当前非FB / 总数${fb.definition_count || 0}`;
            fbEl.textContent = text;
        }

        if (hintEl) {
            const profileCount = Number(measure.competitor_profile_count || 0);
            const parserCount = Array.isArray(measure.supported_parsers) ? measure.supported_parsers.length : 0;
            const parse = measure.parse_summary || '';
            const libText = `竞品协议库 ${profileCount} 个，扩展解析 ${parserCount} 种。`;
            hintEl.textContent = parse ? `${libText} ${parse}` : libText;
        }
    },

    async refreshProtocolOverview() {
        try {
            if (window.DeviceConfigManager && !DeviceConfigManager._initialized) {
                await DeviceConfigManager.init();
            }
            const [overviewResult, configResult] = await Promise.allSettled([
                API.protocol.getRuntimeOverview(),
                API.deviceConfig.list()
            ]);
            const res = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
            const configRes = configResult.status === 'fulfilled' ? configResult.value : null;
            this._protocolDevices = (configRes && configRes.success && Array.isArray(configRes.configs))
                ? configRes.configs.map(cfg => ({
                    id: cfg.id,
                    name: cfg.name || cfg.id
                }))
                : [];
            if (res && res.success) {
                this._protocolOverview = res;
            } else {
                this._protocolOverview = {
                    measure: { parse_summary: res?.error || '协议概览获取失败' },
                    active_protocol: {},
                    fb: { definition_count: 0 },
                };
            }
        } catch (e) {
            this._protocolOverview = {
                measure: { parse_summary: e?.message || String(e) },
                active_protocol: {},
                fb: { definition_count: 0 },
            };
        }
        this._renderProtocolOverview();
    },

    async switchMeasureMode(mode) {
        const nextMode = String(mode || '').trim();
        if (!nextMode) return;
        try {
            const measure = this._protocolOverview?.measure || {};
            if (nextMode === 'competitor_profile') {
                const profiles = Array.isArray(measure.competitor_profiles) ? measure.competitor_profiles : [];
                const select = document.getElementById('toolbar-comp-profile-select');
                const profileId = String(select?.value || measure.profile_id || profiles[0]?.id || '').trim();
                if (!profileId) {
                    this._renderProtocolOverview();
                    return Utils.toast('竞品协议库为空，请先到设置里创建 Profile', 'warning');
                }
                const res = await API.protocol.setRuntimeMeasure({ type: 'competitor_profile', profile_id: profileId });
                if (!res || !res.success) {
                    throw new Error(res?.error || '切换失败');
                }
                this._protocolOverview = res;
                this._renderProtocolOverview();
                await this.refreshCompetitorControls();
                return Utils.toast(`全局测距已切换到竞品协议: ${profileId}`, 'success', 1200);
            }

            const res = await API.protocol.setRuntimeMeasure({ type: nextMode });
            if (!res || !res.success) {
                throw new Error(res?.error || '切换失败');
            }
            this._protocolOverview = res;
            this._renderProtocolOverview();
            await this.refreshCompetitorControls();
            Utils.toast(`全局测距已切换: ${nextMode}`, 'success', 1000);
        } catch (e) {
            Utils.toast('切换测距模式失败: ' + (e?.message || e), 'error');
            this._renderProtocolOverview();
        }
    },

    async switchCompetitorProfile(profileId) {
        const id = String(profileId || '').trim();
        if (!id) return;
        try {
            const res = await API.protocol.setRuntimeMeasure({ type: 'competitor_profile', profile_id: id });
            if (!res || !res.success) {
                throw new Error(res?.error || '切换失败');
            }
            this._protocolOverview = res;
            this._renderProtocolOverview();
            await this.refreshCompetitorControls();
            Utils.toast(`竞品协议已切换: ${id}`, 'success', 1200);
        } catch (e) {
            Utils.toast('切换竞品协议失败: ' + (e?.message || e), 'error');
            this._renderProtocolOverview();
        }
    },

    async switchProtocolDevice(deviceId) {
        const id = String(deviceId || '').trim();
        if (!id) return;
        try {
            if (window.DeviceConfigManager) {
                await DeviceConfigManager.init();
                await DeviceConfigManager.setCurrentDevice(id);
            } else {
                const res = await API.deviceConfig.activate(id);
                if (!res || !res.success) {
                    throw new Error(res?.error || `激活失败: ${id}`);
                }
            }
            await this.refreshProtocolOverview();
            await this.refreshCompetitorControls();
            Utils.toast(`全局机型已切换: ${id}`, 'success', 900);
        } catch (e) {
            Utils.toast('切换机型失败: ' + (e?.message || e), 'error');
            this._renderProtocolDeviceSelect();
        }
    },

    _isCompetitorMeasureType(t) {
        const s = String(t || '').trim().toLowerCase();
        if (!s) return false;
        return s.startsWith('l1_') || s.startsWith('competitor_') || s === 'l1' || s === 'l1_ascii' || s === 'l1_modbus' || s === 'competitor_profile' || s === 'comp_profile' || s === 'profile';
    },

    async refreshCompetitorControls(soft = false) {
        const sec = document.getElementById('toolbar-competitor-section');
        if (!sec) return;

        // soft: avoid extra API call if we already know measureType
        if (soft && this._measureType !== null) {
            sec.style.display = this._isCompetitorMeasureType(this._measureType) ? '' : 'none';
            this._renderToolbarCompControls();
            this._syncTabVisibility();
            return;
        }

        try {
            const res = await API.settings.toolProfileGet(null);
            const profile = res && res.success ? (res.profile || {}) : {};
            const measure = profile.measure || {};
            const slipway = profile.slipway || {};
            const maxPos = parseFloat(slipway.max_position_mm);
            this.maxSlipwayPosMm = Number.isFinite(maxPos) && maxPos > 0 ? maxPos : 38000;
            this._syncSlipwaySoftLimitUi();
            this._measureType = measure.type || 'firmware';
            const show = this._isCompetitorMeasureType(this._measureType);
            sec.style.display = show ? '' : 'none';

            // Resolve competitor profile controls if applicable
            this._compProfileId = null;
            this._compProto = null;
            this._compControls = null;
            if (show) {
                const t = String(this._measureType || '').trim().toLowerCase();
                if (t === 'competitor_profile' || t === 'comp_profile' || t === 'profile') {
                    const pid = String(measure.profile_id || '').trim();
                    this._compProfileId = pid || null;
                    if (pid) {
                        const pr = await API.settings.competitorProtoGet(pid);
                        if (pr && pr.success) {
                            this._compProto = pr.proto || null;
                            const ctrls = (this._compProto && typeof this._compProto === 'object') ? (this._compProto.controls || {}) : {};
                            this._compControls = (ctrls && typeof ctrls === 'object') ? ctrls : {};
                        }
                    }
                } else {
                    // Backward compat: if directly using l1_ascii provider, expose a default control set
                    this._compControls = {
                        laser_on: 'iLD:1',
                        laser_off: 'iLD:0',
                        halt: 'iHALT',
                        set_ascii: 'iSET:4,1',
                        set_modbus: 'iSET:4,0',
                        set_hex: 'iSET:4,2',
                        get_proto: 'iGET:4',
                    };
                }
            }

            this._renderToolbarCompControls();

            // 恢复上次手输命令
            const inp = document.getElementById('toolbar-l1-cmd');
            if (inp && !inp.value) {
                const saved = localStorage.getItem('toolbar_l1_cmd') || '';
                if (saved) inp.value = saved;
            }
            this._syncTabVisibility();
        } catch (e) {
            // 不影响其他功能
            sec.style.display = 'none';
            this._compProfileId = null;
            this._compProto = null;
            this._compControls = null;
            this._renderToolbarCompControls();
            this._syncSlipwaySoftLimitUi();
            this._syncTabVisibility();
        }
    },

    _labelForCompKey(key) {
        const labelMap = {
            laser_on: '🔦 开激光',
            laser_off: '🚫 关激光',
            halt: '⏹ 停止输出',
            get_proto: 'iGET:4',
            set_ascii: 'ASCII',
            set_modbus: 'Modbus',
            set_hex: 'HEX',
        };
        return labelMap[String(key || '')] || String(key || '');
    },

    _renderToolbarCompControls() {
        const box = document.getElementById('toolbar-comp-controls');
        if (!box) return;
        const ctrls = this._compControls && typeof this._compControls === 'object' ? this._compControls : {};
        const entries = Object.entries(ctrls || {}).filter(([k, v]) => k && v);
        if (!entries.length) {
            box.innerHTML = `<span style="opacity:.7; font-size:12px;">(无 controls)</span>`;
            return;
        }
        box.innerHTML = entries.map(([k]) => {
            const label = this._labelForCompKey(k);
            const arg = JSON.stringify(String(k));
            return `<button class="toolbar-btn small" onclick="DeviceToolbar.sendCompetitorControl(${arg})">${label}</button>`;
        }).join('');
    },

    async sendCompetitorControl(key) {
        const ctrls = this._compControls && typeof this._compControls === 'object' ? this._compControls : null;
        if (!ctrls) return;
        const v = ctrls[key];
        if (!v) return;

        // v can be:
        // - string: ASCII command (auto CRLF)
        // - object: { data: '...', is_hex: true/false }
        if (typeof v === 'string') {
            return this._sendAscii(v);
        }
        if (v && typeof v === 'object') {
            const data = String(v.data || v.cmd || '');
            const isHex = !!(v.is_hex || v.isHex || v.hex);
            if (!data) return;
            return this._sendRaw(data, isHex);
        }
    },

    async _sendRaw(data, isHex) {
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            return Utils.toast('串口未连接，无法发送竞品指令', 'warning');
        }
        try {
            const r = await API.debug.send(data, !!isHex);
            if (r && r.success) Utils.toast('已发送', 'success', 900);
            else Utils.toast('发送失败: ' + (r?.message || ''), 'error');
        } catch (e) {
            Utils.toast('发送异常: ' + (e?.message || e), 'error');
        }
    },

    async _sendAscii(cmd) {
        const s = String(cmd || '').trim();
        if (!s) return;
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            return Utils.toast('串口未连接，无法发送竞品指令', 'warning');
        }

        let payload = s;
        if (!payload.endsWith('\n')) payload += '\r\n';

        try {
            localStorage.setItem('toolbar_l1_cmd', s);
        } catch (e) {}

        const r = await API.debug.send(payload, false);
        if (r && r.success) {
            Utils.toast(`已发送: ${s}`, 'success', 1200);
        } else {
            Utils.toast('发送失败: ' + (r?.message || ''), 'error');
        }
    },

    // ===== L1 / 竞品快捷命令 =====
    async l1LaserOn() { return this._sendAscii('iLD:1'); },
    async l1LaserOff() { return this._sendAscii('iLD:0'); },
    async l1Halt() { return this._sendAscii('iHALT'); },
    async l1SetAscii() { return this._sendAscii('iSET:4,1'); },
    async l1SetModbus() { return this._sendAscii('iSET:4,0'); },
    async l1SetHex() { return this._sendAscii('iSET:4,2'); },
    async l1GetProto() { return this._sendAscii('iGET:4'); },

    async l1SendFromInput() {
        const inp = document.getElementById('toolbar-l1-cmd');
        const s = inp ? String(inp.value || '').trim() : '';
        if (!s) return Utils.toast('请输入命令', 'warning');
        return this._sendAscii(s);
    },

    // ===== 测距（复用 slipway_measure_once + 当前工位 measure.type 路由）=====
    _setL1MeasureStatus(text) {
        const el = document.getElementById('toolbar-l1-measure-status');
        if (el) el.textContent = String(text || '--');
    },

    _getL1MeasureIntervalMs() {
        const el = document.getElementById('toolbar-l1-measure-interval');
        let ms = parseInt(el ? el.value : '200', 10);
        if (!Number.isFinite(ms) || ms < 50) ms = 200;
        if (ms > 5000) ms = 5000;
        if (el) el.value = String(ms);
        return ms;
    },

    _updateL1LoopBtn(running) {
        const btn = document.getElementById('toolbar-l1-measure-loop-btn');
        if (!btn) return;
        btn.textContent = running ? '⏹ 停止' : '▶ 连续';
        btn.classList.toggle('danger', !!running);
    },

    _formatMeasureOnceResult(res) {
        const r = (res && res.result) ? res.result : null;
        if (!r) return 'FAIL: no result';
        const mt = r.measure_type || r.measureType || r.type || (this._measureType || '--');
        const ms = Number(r.time_ms);
        if (r.success) {
            const mm = Number(r.distance);
            const refl = (r.refl !== undefined && r.refl !== null) ? ` refl=${r.refl}` : '';
            const raw = Array.isArray(r.raw_lines) ? r.raw_lines.slice(-3).join(' | ') : '';
            const mmText = Number.isFinite(mm) ? mm.toFixed(3) : String(r.distance);
            const msText = Number.isFinite(ms) ? String(Math.round(ms)) : String(r.time_ms || '--');
            return `OK[${mt}] ${mmText}mm ${msText}ms${refl}${raw ? ' | ' + raw : ''}`;
        }
        const err = r.error || 'measure failed';
        const raw = Array.isArray(r.raw_lines) ? r.raw_lines.slice(-3).join(' | ') : '';
        return `FAIL[${mt}] ${err}${raw ? ' | ' + raw : ''}`;
    },

    async l1MeasureOnce() {
        if (this._l1MeasureInFlight) return;
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            this._setL1MeasureStatus('串口未连接');
            return Utils.toast('请先连接串口', 'warning');
        }

        this._l1MeasureInFlight = true;
        try {
            this._setL1MeasureStatus('测距中...');
            const res = await API.slipway.measureOnce(null);
            if (!res || !res.success) {
                const msg = res?.error || '调用失败';
                this._setL1MeasureStatus('FAIL: ' + msg);
                return Utils.toast('测距失败: ' + msg, 'error');
            }
            this._setL1MeasureStatus(this._formatMeasureOnceResult(res));
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            this._setL1MeasureStatus('异常: ' + msg);
        } finally {
            this._l1MeasureInFlight = false;
        }
    },

    toggleL1MeasureLoop() {
        if (this._l1MeasureTimer) {
            this.stopL1MeasureLoop();
        } else {
            this.startL1MeasureLoop();
        }
    },

    startL1MeasureLoop() {
        if (this._l1MeasureTimer) return;
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            this._setL1MeasureStatus('串口未连接');
            return Utils.toast('请先连接串口', 'warning');
        }

        const intervalMs = this._getL1MeasureIntervalMs();
        this._l1MeasureStats = {
            startTs: Date.now(),
            lastTs: null,
            ok: 0,
            fail: 0,
            lastText: '--'
        };
        this._updateL1LoopBtn(true);
        this._setL1MeasureStatus(`连续测距中... interval=${intervalMs}ms`);

        const tick = async () => {
            if (!this._l1MeasureTimer) return;
            if (this._l1MeasureInFlight) return;
            this._l1MeasureInFlight = true;
            try {
                const res = await API.slipway.measureOnce(null);
                const st = this._l1MeasureStats;
                if (!st) return;
                st.lastTs = Date.now();
                if (res && res.success && res.result && res.result.success) st.ok += 1;
                else st.fail += 1;
                st.lastText = this._formatMeasureOnceResult(res || {});

                const elapsedS = Math.max(0.001, (st.lastTs - st.startTs) / 1000);
                const hz = (st.ok + st.fail) / elapsedS;
                this._setL1MeasureStatus(`Hz=${hz.toFixed(2)} ok=${st.ok} fail=${st.fail} | ${st.lastText}`);
            } catch (e) {
                const st = this._l1MeasureStats;
                if (st) st.fail += 1;
                const msg = (e && e.message) ? e.message : String(e);
                this._setL1MeasureStatus(`FAIL: ${msg}`);
            } finally {
                this._l1MeasureInFlight = false;
            }
        };

        this._l1MeasureTimer = setInterval(() => { tick(); }, intervalMs);
        // 立即来一发
        setTimeout(() => { tick(); }, 10);
    },

    stopL1MeasureLoop(silent = false) {
        if (this._l1MeasureTimer) {
            clearInterval(this._l1MeasureTimer);
            this._l1MeasureTimer = null;
        }
        this._updateL1LoopBtn(false);
        if (!silent) {
            const st = this._l1MeasureStats;
            if (st) {
                const elapsedS = Math.max(0.001, (Date.now() - st.startTs) / 1000);
                const hz = (st.ok + st.fail) / elapsedS;
                this._setL1MeasureStatus(`已停止 | Hz=${hz.toFixed(2)} ok=${st.ok} fail=${st.fail}`);
            } else {
                this._setL1MeasureStatus('已停止');
            }
        }
        this._l1MeasureStats = null;
    },
    
    /**
     * 连接/断开滑台
     */
    async connectSlipway() {
        if (!window.DeviceHub) return;
        
        if (DeviceHub.isSlipwayConnected()) {
            await DeviceHub.disconnectSlipway();
            Utils.toast('滑台已断开', 'info');
        } else {
            const ipInput = document.getElementById('toolbar-slipway-ip');
            const addr = ipInput?.value || '192.168.2.46:6000';
            const [ip, portStr] = addr.split(':');
            const port = parseInt(portStr) || 6000;
            
            if (!ip) {
                Utils.toast('请输入IP地址', 'warning');
                return;
            }
            
            // 保存设置
            localStorage.setItem('hub_tcp_ip', ip);
            localStorage.setItem('hub_tcp_port', port);
            this.saveInputs();
            
            const result = await DeviceHub.connectSlipway(ip, port);
            if (result.success) {
                Utils.toast(`滑台连接成功，位置: ${result.position || '--'}mm`, 'success');
            } else {
                Utils.toast('连接失败: ' + (result.error || ''), 'error');
            }
        }
        this.syncStatus();
    },
    
    /**
     * 强制断开所有 TCP 连接
     */
    async forceDisconnect() {
        try {
            const result = await API.call('slipway_force_disconnect');
            if (result.success) {
                Utils.toast(result.message || '已强制断开', 'success');
            } else {
                Utils.toast('断开失败: ' + (result.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('断开失败: ' + e.message, 'error');
        }
        this.syncStatus();
    },
    
    /**
     * 滑台移动到目标位置
     */
    async slipwayMove() {
        const target = this._clampSlipwayTargetInput();
        const softLimit = this._getSlipwaySoftLimitMm();
        
        if (!Number.isFinite(target)) {
            Utils.toast('请输入目标位置', 'warning');
            return;
        }

        if (target < 0 || target > softLimit) {
            Utils.toast(`目标位置超出软限位范围 (0~${softLimit}mm)`, 'warning');
            return;
        }
        
        this.saveInputs();
        
        try {
            const result = await API.slipway.moveTo(target);
            if (result.success) {
                Utils.toast(`移动到 ${target}mm`, 'success');
            } else {
                Utils.toast('移动失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('移动失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 滑台步进移动（前进/后退）
     * @param {number} direction - 1=前进, -1=后退
     */
    async slipwayJog(direction) {
        const step = this._clampSlipwayStepInput() || 10;
        const softLimit = this._getSlipwaySoftLimitMm();
        
        this.saveInputs();
        
        try {
            // 获取当前位置
            const status = await API.slipway.getStatus();
            if (!status || !status.connected) {
                Utils.toast('滑台未连接', 'warning');
                return;
            }
            
            const currentPos = parseFloat(status.position) || 0;
            const targetPos = currentPos + (step * direction);

            if (targetPos < 0 || targetPos > softLimit) {
                Utils.toast(`目标位置超出软限位范围 (0~${softLimit}mm)`, 'warning');
                return;
            }
            
            const result = await API.slipway.moveTo(targetPos);
            if (result.success) {
                Utils.toast(`${direction > 0 ? '前进' : '后退'} ${step}mm`, 'info');
            } else {
                Utils.toast('移动失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('移动失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 滑台回零
     */
    async slipwayHome() {
        try {
            try {
                const profileRes = await API.settings.toolProfileGet(null);
                if (profileRes && profileRes.success) {
                    const slipway = profileRes.profile?.slipway || {};
                    await API.call(
                        'slipway_update_reset_config',
                        slipway.reset_fast_min_speed ?? null,
                        slipway.reset_fast_max_speed ?? null,
                        slipway.reset_slow_min_speed ?? null,
                        slipway.reset_slow_max_speed ?? null,
                        slipway.home_io_num ?? null,
                        slipway.home_io_active_level ?? null
                    );
                }
            } catch (e) {
                console.warn('工具栏更新复位配置失败:', e);
            }

            const result = await API.slipway.reset();
            if (result.success) {
                Utils.toast('滑台回零中...', 'info');
            } else {
                Utils.toast('回零失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('回零失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 滑台停止
     */
    async slipwayStop() {
        try {
            const result = await API.slipway.stop();
            Utils.toast('已停止', 'info');
        } catch (e) {
            Utils.toast('停止失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 设置反射率
     */
    async setReflectance(ref) {
        try {
            const result = await API.slipway.rotaryMoveTo(ref);
            if (result.success) {
                Utils.toast(`切换到 ${ref}%`, 'success');
            } else {
                Utils.toast('切换失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('切换失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 转靶回零
     */
    async rotaryHome() {
        try {
            const result = await API.slipway.rotaryReset();
            if (result.success) {
                Utils.toast('转靶回零中...', 'info');
            } else {
                Utils.toast('回零失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('回零失败: ' + e.message, 'error');
        }
    },
    
    // ========== 流程控制 ==========
    _calWorkflows: [],
    _calDevices: [],
    _calRunning: false,
    _calSelectedWorkflow: null,
    _calProgressTimer: null,
    
    /**
     * 刷新流程列表
     */
    async refreshWorkflows() {
        try {
            const workflows = await API.calibration.getWorkflows();
            this._calWorkflows = workflows || [];
            this._renderWorkflowSelect();
            
            // 同时刷新设备列表
            await this._refreshCalDevices();
            
            Utils.toast('流程列表已刷新', 'info');
        } catch (e) {
            Utils.toast('刷新失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 刷新设备列表
     */
    async _refreshCalDevices() {
        try {
            const status = await API.calibration.getStatus();
            this._calDevices = status.devices || [];
            this._renderDeviceSelect();
        } catch (e) {
            this._calDevices = [];
            this._renderDeviceSelect();
        }
    },
    
    /**
     * 渲染流程选择下拉框
     */
    _renderWorkflowSelect() {
        const select = document.getElementById('toolbar-workflow-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- 选择流程 --</option>' +
            this._calWorkflows.map(w => 
                `<option value="${w.id}">${w.icon || '📋'} ${w.name}</option>`
            ).join('');
        
        // 恢复上次选择
        if (this._calSelectedWorkflow) {
            select.value = this._calSelectedWorkflow.id;
        }
        
        this._updateCalButtons();
    },
    
    /**
     * 渲染设备选择下拉框
     */
    _renderDeviceSelect() {
        const select = document.getElementById('toolbar-device-select');
        if (!select) return;
        
        if (this._calDevices.length === 0) {
            select.innerHTML = '<option value="">-- 无设备 --</option>';
        } else {
            select.innerHTML = this._calDevices.map(d => {
                const id = d.device_id;
                const idHex = typeof id === 'number' ? id.toString(16).toUpperCase() : id;
                const model = d.model_name || d.model || '未知';
                return `<option value="${id}">${model} (${idHex})</option>`;
            }).join('');
        }
        
        this._updateCalButtons();
    },
    
    /**
     * 选择流程
     */
    selectWorkflow(workflowId) {
        if (!workflowId) {
            this._calSelectedWorkflow = null;
        } else {
            this._calSelectedWorkflow = this._calWorkflows.find(w => String(w.id) === String(workflowId));
        }
        this._updateCalButtons();
    },
    
    /**
     * 更新流程按钮状态
     */
    _updateCalButtons() {
        const startBtn = document.getElementById('toolbar-cal-start');
        const stopBtn = document.getElementById('toolbar-cal-stop');
        const progressEl = document.getElementById('toolbar-cal-progress');
        
        const wfSelect = document.getElementById('toolbar-workflow-select');
        const devSelect = document.getElementById('toolbar-device-select');
        
        const hasWorkflow = wfSelect && wfSelect.value;
        const hasDevice = devSelect && devSelect.value;
        const canStart = hasWorkflow && hasDevice && !this._calRunning;
        
        if (startBtn) {
            startBtn.disabled = !canStart;
            startBtn.style.display = this._calRunning ? 'none' : 'flex';
        }
        if (stopBtn) {
            stopBtn.style.display = this._calRunning ? 'flex' : 'none';
        }
        if (progressEl) {
            progressEl.style.display = this._calRunning ? 'flex' : 'none';
        }
    },
    
    /**
     * 开始流程
     */
    async startCalibration() {
        const wfSelect = document.getElementById('toolbar-workflow-select');
        const devSelect = document.getElementById('toolbar-device-select');
        
        const workflowId = wfSelect?.value;
        const deviceId = devSelect?.value;
        
        if (!workflowId) {
            Utils.toast('请选择流程', 'warning');
            return;
        }
        
        if (!deviceId) {
            Utils.toast('请选择设备', 'warning');
            return;
        }
        
        try {
            // 获取流程参数（使用默认值）
            const workflow = this._calWorkflows.find(w => String(w.id) === String(workflowId));
            const params = {};
            if (workflow && workflow.params) {
                for (const [key, def] of Object.entries(workflow.params)) {
                    if (def && typeof def === 'object' && def.default !== undefined) {
                        params[key] = def.default;
                    }
                }
            }
            
            const res = await API.calibration.startWorkflow(workflowId, params, 1);
            if (res.success) {
                this._calRunning = true;
                this._updateCalButtons();
                this._startProgressPolling();
                Utils.toast('流程已启动', 'success');
            } else {
                Utils.toast(res.error || '启动失败', 'error');
            }
        } catch (e) {
            Utils.toast('启动失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 停止流程
     */
    async stopCalibration() {
        try {
            await API.calibration.stopWorkflow();
            this._calRunning = false;
            this._stopProgressPolling();
            this._updateCalButtons();
            Utils.toast('流程已停止', 'info');
        } catch (e) {
            Utils.toast('停止失败: ' + e.message, 'error');
        }
    },
    
    /**
     * 开始进度轮询
     */
    _startProgressPolling() {
        this._stopProgressPolling();
        this._calProgressTimer = setInterval(() => this._pollCalProgress(), 1000);
    },
    
    /**
     * 停止进度轮询
     */
    _stopProgressPolling() {
        if (this._calProgressTimer) {
            clearInterval(this._calProgressTimer);
            this._calProgressTimer = null;
        }
    },
    
    /**
     * 轮询流程进度
     */
    async _pollCalProgress() {
        try {
            const status = await API.calibration.getStatus();
            const running = status.running || false;
            const progress = status.progress || 0;
            const step = status.current_step || 0;
            const total = status.total_steps || 0;
            
            // 更新进度条
            const fillEl = document.getElementById('toolbar-cal-progress-fill');
            const textEl = document.getElementById('toolbar-cal-progress-text');
            
            if (fillEl) fillEl.style.width = `${progress}%`;
            if (textEl) textEl.textContent = total > 0 ? `${step}/${total}` : `${progress}%`;
            
            // 检查是否完成
            if (!running && this._calRunning) {
                this._calRunning = false;
                this._stopProgressPolling();
                this._updateCalButtons();
                Utils.toast('流程已完成', 'success');
            }
        } catch (e) {
            // 忽略轮询错误
        }
    },
    
    /**
     * 初始化
     */
    init() {
        // 初始化时不做任何事，等 toggle 时再恢复
        this._restoreActiveTab();
        this.switchTab(this._activeTab, false);

        if (window.DeviceConfigManager) {
            DeviceConfigManager.init().then(() => {
                DeviceConfigManager.subscribe('device-changed', async () => {
                    this._lastProtocolRefreshTs = 0;
                    if (this.visible) {
                        await this.refreshProtocolOverview();
                        await this.refreshCompetitorControls();
                    }
                });
            }).catch(() => {});
        }
        
        // 监听后端流程事件
        document.addEventListener('backend:cal_progress', (e) => {
            if (!this.visible) return;
            const data = e.detail || {};
            const pct = Math.max(0, Math.min(100, data.progress || 0));
            const fillEl = document.getElementById('toolbar-cal-progress-fill');
            const textEl = document.getElementById('toolbar-cal-progress-text');
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (textEl) textEl.textContent = data.text || `${pct}%`;
        });
        
        document.addEventListener('backend:cal_complete', (e) => {
            if (!this.visible) return;
            this._calRunning = false;
            this._stopProgressPolling();
            this._updateCalButtons();
        });
        
        document.addEventListener('backend:cal_error', (e) => {
            if (!this.visible) return;
            this._calRunning = false;
            this._stopProgressPolling();
            this._updateCalButtons();
        });
    }
};

// 暴露到全局
window.DeviceToolbar = DeviceToolbar;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => DeviceToolbar.init(), 600);
});
