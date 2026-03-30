/**
 * 测试数据管理页面
 */
window.TestDataPage = {
    sessions: [],
    currentSession: null,
    page: 1,
    pageSize: 20,

    total: 0,
    models: [],
    versions: [],
    errorChart: null,  // Chart.js 实例
    chartMetricKey: 'error',
    currentDeviceId: null,
    currentDeviceCrc: null,
    _deviceHubListenerBound: false,
    _postRestoreSyncTimer: null,

    _normReflectance(val) {
        let v = parseFloat(val);
        if (!Number.isFinite(v)) return 0;
        if (v > 0 && v <= 1) v = v * 100;
        v = Math.round(v);
        if (v < 0) v = 0;
        if (v > 100) v = 100;
        return v;
    },

    _fmtReflectance(val) {
        if (val === undefined || val === null || val === '') return '--';
        const n = this._normReflectance(val);
        if (!n) return '--';
        return `${n}%`;
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    _formatTemperatureValue(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2)));
    },

    _parseLegacyRemarkTemperature(remark) {
        const text = String(remark || '').trim();
        if (!text) return null;
        const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:℃|°C|C)?$/i);
        if (!match) return null;
        const temp = Number(match[1]);
        return Number.isFinite(temp) ? temp : null;
    },

    _getSessionTemperatureMeta(session) {
        const rawStructured = session?.test_temperature;
        const structured = rawStructured === '' || rawStructured === undefined || rawStructured === null
            ? null
            : Number(rawStructured);
        const structuredValue = Number.isFinite(structured) ? structured : null;
        const legacyValue = this._parseLegacyRemarkTemperature(session?.remark);

        let value = structuredValue;
        let source = 'structured';

        if (legacyValue !== null && (structuredValue === null || structuredValue === 25)) {
            value = legacyValue;
            source = 'remark';
        } else if (value === null && legacyValue !== null) {
            value = legacyValue;
            source = 'remark';
        }

        return {
            value,
            source,
            isLegacy: source === 'remark',
            text: value === null ? '--' : `${this._formatTemperatureValue(value)}℃`
        };
    },

    _formatDeviceId(deviceId) {
        if (deviceId === undefined || deviceId === null || deviceId === '') return '--';
        return typeof deviceId === 'number' ? deviceId.toString(16).toUpperCase() : String(deviceId);
    },

    _formatAppCrc(appCrc) {
        if (appCrc === undefined || appCrc === null || appCrc === '') return '--';
        return typeof appCrc === 'number'
            ? '0x' + appCrc.toString(16).toUpperCase().padStart(8, '0')
            : String(appCrc);
    },

    _setCurrentDeviceInfoText(text) {
        const el = document.getElementById('current-device-info');
        if (el) el.textContent = text || '无实时设备';
    },

    _persistFilterInputs() {
        try {
            if (window.App && typeof App.savePageInputs === 'function') {
                App.savePageInputs('test_data');
            }
        } catch (e) {}
    },

    _ensureDeviceHubBinding() {
        if (this._deviceHubListenerBound || !window.DeviceHub || typeof DeviceHub.onStatusChange !== 'function') {
            return;
        }
        this._deviceHubListenerBound = true;
        DeviceHub.onStatusChange(() => {
            this.detectCurrentDevice({
                applyFilters: !!document.getElementById('filter-current-device')?.checked,
                silent: true
            });
        });
    },

    _syncCurrentDeviceFilterUi({ applyFilters = false, silent = true } = {}) {
        const cb = document.getElementById('filter-current-device');
        const idInput = document.getElementById('filter-device-id');
        if (!cb || !idInput) return;

        const hadAutoCurrent = idInput.dataset.autoCurrentDevice === '1';
        let changed = false;
        let shouldApply = false;
        if (cb.checked) {
            shouldApply = true;
            if (this.currentDeviceId !== undefined && this.currentDeviceId !== null && this.currentDeviceId !== '') {
                const idHex = this._formatDeviceId(this.currentDeviceId);
                if (idInput.value !== idHex) {
                    idInput.value = idHex;
                    changed = true;
                }
                idInput.dataset.autoCurrentDevice = '1';
            } else {
                cb.checked = false;
                if (idInput.value) {
                    idInput.value = '';
                    changed = true;
                }
                delete idInput.dataset.autoCurrentDevice;
                changed = true;
                if (!silent && window.Utils) {
                    Utils.toast('当前没有实时设备信息，已取消“当前设备”筛选', 'warning');
                }
            }
        } else if (idInput.dataset.autoCurrentDevice === '1') {
            if (idInput.value) {
                idInput.value = '';
                changed = true;
            }
            delete idInput.dataset.autoCurrentDevice;
        }

        if (changed) {
            this._persistFilterInputs();
        }
        if (applyFilters && (changed || shouldApply || hadAutoCurrent)) {
            this.applyFilters();
        }
    },

    async init() {
        console.log('[TestData] init called');
        // 等待DOM完全就绪
        await new Promise(r => setTimeout(r, 100));

        try {
            const savedMetric = localStorage.getItem('test_data_chart_metric');
            if (savedMetric) this.chartMetricKey = savedMetric;
        } catch (e) {}
        this.syncChartMetricUi();

        this._ensureDeviceHubBinding();
        await this.detectCurrentDevice();
        await this.loadFilters();
        await this.refresh();
        if (this._postRestoreSyncTimer) clearTimeout(this._postRestoreSyncTimer);
        this._postRestoreSyncTimer = setTimeout(() => {
            this.detectCurrentDevice({
                applyFilters: !!document.getElementById('filter-current-device')?.checked,
                silent: true
            });
        }, 220);
        console.log('[TestData] init completed');
    },

    async detectCurrentDevice(options = {}) {
        const { applyFilters = false, silent = true } = options;
        this.currentDeviceId = null;
        this.currentDeviceCrc = null;
        this._setCurrentDeviceInfoText('无实时设备');

        try {
            const serialStatus = window.DeviceHub?.status?.serial || {};
            const info = serialStatus.info || {};
            const hasDeviceId = info.device_id !== undefined && info.device_id !== null && info.device_id !== '';

            // 仅在串口仍然连接且已识别出设备ID时，才认定为“当前设备”
            if (serialStatus.connected && hasDeviceId) {
                this.currentDeviceId = info.device_id;
                this.currentDeviceCrc = info.app_crc;
                this._setCurrentDeviceInfoText(`ID: ${this._formatDeviceId(this.currentDeviceId)}`);
            }
        } catch (e) {
            console.warn('检测当前设备失败:', e);
        }

        this._syncCurrentDeviceFilterUi({ applyFilters, silent });
    },

    toggleCurrentDevice() {
        this._syncCurrentDeviceFilterUi({ applyFilters: true, silent: false });
    },

    async loadFilters() {
        try {
            // 加载型号列表
            const modelsResult = await pywebview.api.data_list_models();
            if (modelsResult && modelsResult.success) {
                this.models = modelsResult.models || [];
                const modelList = document.getElementById('model-list');
                if (modelList) {
                    modelList.innerHTML = this.models.map(m => `<option value="${m}">`).join('');
                }
            }

            // 加载设备ID和CRC列表
            await this.loadDeviceAndCrcLists();
        } catch (e) {
            console.error('加载筛选项失败:', e);
        }
    },

    async loadDeviceAndCrcLists() {
        try {
            // 获取所有会话来提取唯一的设备ID和CRC
            const result = await pywebview.api.data_query_sessions({}, 500, 0);
            if (result && result.success) {
                const deviceIds = new Set();
                const crcs = new Set();

                result.sessions.forEach(s => {
                    if (s.device_id) {
                        const idHex = typeof s.device_id === 'number' 
                            ? s.device_id.toString(16).toUpperCase() : s.device_id;
                        deviceIds.add(idHex);
                    }
                    if (s.app_crc) {
                        const crcHex = typeof s.app_crc === 'number'
                            ? '0x' + s.app_crc.toString(16).toUpperCase().padStart(8, '0') : s.app_crc;
                        crcs.add(crcHex);
                    }
                });

                // 填充设备ID datalist
                const deviceList = document.getElementById('device-list');
                if (deviceList) {
                    deviceList.innerHTML = Array.from(deviceIds).map(id => `<option value="${id}">`).join('');
                }

                // 填充CRC datalist
                const crcList = document.getElementById('crc-list');
                if (crcList) {
                    crcList.innerHTML = Array.from(crcs).map(crc => `<option value="${crc}">`).join('');
                }
            }
        } catch (e) {
            console.warn('加载设备/CRC列表失败:', e);
        }
    },

    getPageContainer() {
        return document.querySelector('#dynamic-test_data') || document;
    },

    getFilters() {
        const container = this.getPageContainer();
        const filters = {};
        const model = container.querySelector('#filter-model')?.value;
        const type = container.querySelector('#filter-type')?.value;
        const status = container.querySelector('#filter-status')?.value;
        const deviceId = container.querySelector('#filter-device-id')?.value?.trim();
        const crc = container.querySelector('#filter-crc')?.value?.trim();

        if (model) filters.model_name = model;
        if (type) filters.test_type = type;
        if (status) filters.status = status;
        if (deviceId) filters.device_id = deviceId;
        if (crc) filters.app_crc = crc;

        return filters;
    },

    async refresh() {
        try {
            const filters = this.getFilters();
            console.log('[TestData] refresh called, filters:', JSON.stringify(filters));
            console.log('[TestData] pageSize:', this.pageSize, 'offset:', (this.page - 1) * this.pageSize);

            // 检查API是否可用
            if (!window.pywebview || !pywebview.api) {
                console.error('[TestData] pywebview.api 不可用');
                Utils.toast('API未就绪，请稍后重试', 'error');
                return;
            }

            const result = await pywebview.api.data_query_sessions(
                filters, this.pageSize, (this.page - 1) * this.pageSize
            );

            console.log('[TestData] query result:', JSON.stringify(result));

            if (result && result.success) {
                this.sessions = result.sessions || [];
                this.total = result.total || 0;
                console.log('[TestData] loaded sessions:', this.sessions.length, 'total:', this.total);
                this.renderTable();
                this.updateStats();
                this.updatePagination();

                if (this.sessions.length > 0) {
                    Utils.toast(`加载了 ${this.sessions.length} 条数据`, 'success');
                }
            } else {
                console.error('[TestData] query failed:', result?.error);
                Utils.toast('加载数据失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            console.error('[TestData] 加载数据失败:', e);
            Utils.toast('加载数据异常: ' + e.message, 'error');
        }
    },

    applyFilters() {
        this.page = 1;
        this.refresh();
    },

    renderTable() {
        // 新版使用列表渲染
        this.renderList();
    },

    renderList() {
        const pageContainer = this.getPageContainer();
        const listContainer = pageContainer.querySelector('#session-list');
        if (!listContainer) {
            console.error('[TestData] session-list element not found');
            return;
        }

        if (this.sessions.length === 0) {
            listContainer.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted)">暂无数据</div>';
            return;
        }

        listContainer.innerHTML = this.sessions.map(s => {
            const time = s.created_at ? new Date(s.created_at).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }) : '--';

            const stats = s.stats || {};
            const avgError = stats.avg_error !== undefined ? stats.avg_error.toFixed(2) : '--';
            const isActive = this.currentSession?.id === s.id;
            const isSelected = this.selectedSessions.includes(s.id);

            // 设备ID格式化
            const deviceId = this._formatDeviceId(s.device_id);
            const crc = this._formatAppCrc(s.app_crc);

            // 标签信息
            const alias = s.device_alias || '';
            const tempMeta = this._getSessionTemperatureMeta(s);
            const remark = String(s.remark || '').trim();
            const tagInfo = [];
            if (alias) tagInfo.push(alias);
            if (tempMeta.value !== null && (tempMeta.isLegacy || tempMeta.value !== 25)) {
                tagInfo.push(tempMeta.text);
            }

            // 多选模式下显示复选框
            const hasCheckbox = this.selectMode;

            return `
                <div class="session-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${hasCheckbox ? 'has-checkbox' : ''}" 
                     onclick="TestDataPage.${hasCheckbox ? 'toggleSessionSelect' : 'selectSession'}('${s.id}'${hasCheckbox ? ', event' : ''})">
                    ${hasCheckbox ? `<input type="checkbox" class="session-checkbox" data-id="${s.id}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); TestDataPage.toggleSessionSelect('${s.id}', event)">` : ''}
                    <div class="session-time">${time}</div>
                    <div class="session-main">
                        <div>
                            <span class="session-model">${this._escapeHtml(s.model_name || '未知型号')}</span>
                            <span class="session-type"> · ${this._escapeHtml(this.getTestTypeName(s.test_type))}</span>
                            ${tagInfo.length > 0 ? `<span class="session-tags">${this._escapeHtml(tagInfo.join(' · '))}</span>` : ''}
                        </div>
                        <span class="session-status ${s.status}">${this._escapeHtml(this.getStatusName(s.status))}</span>
                    </div>
                    <div class="session-ids">
                        <span class="id-tag">ID: <b>${this._escapeHtml(deviceId)}</b></span>
                        <span class="crc-tag" style="cursor:pointer;" onclick="event.stopPropagation(); App.vaultLookupCRC('${crc}')" title="点击查找对应版本">CRC: <b>${this._escapeHtml(crc)}</b></span>
                    </div>
                    <div class="session-error">误差: <b>${avgError}</b> mm · ${stats.total_points || 0}点</div>
                    ${remark ? `<div class="session-error" style="color:var(--text-muted);">备注: <b style="color:var(--text-color);">${this._escapeHtml(remark)}</b></div>` : ''}
                </div>
            `;
        }).join('');
    },

    debounceSearch() {
        if (this._searchTimer) clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.applyFilters(), 300);
    },

    async selectSession(sessionId) {
        // 更新列表选中状态
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.session-item[onclick*="${sessionId}"]`);
        if (item) item.classList.add('active');

        // 加载详情到右侧面板
        await this.loadDetail(sessionId);
    },

    async loadDetail(sessionId) {
        try {
            const sessionResult = await pywebview.api.data_get_session(sessionId);
            const pointsResult = await pywebview.api.data_get_points(sessionId);

            if (!sessionResult?.success) {
                Utils.toast(sessionResult?.error || '加载失败', 'error');
                return;
            }

            this.currentSession = sessionResult.session;
            const points = pointsResult?.success ? pointsResult.points || [] : [];
            this.currentPoints = points;  // 保存供标签面板使用

            // 显示详情面板
            const pageContainer = document.querySelector('#dynamic-test_data') || document;
            const emptyEl = pageContainer.querySelector('#detail-empty');
            const contentEl = pageContainer.querySelector('#detail-content');

            if (!emptyEl || !contentEl) {
                Utils.toast('错误: 找不到详情面板元素!', 'error');
                return;
            }

            emptyEl.style.display = 'none';
            contentEl.style.display = 'flex';

            // 渲染详情
            this.renderDetailPanel(this.currentSession, points, pageContainer);
        } catch (e) {
            console.error('[TestData] 加载详情失败:', e);
            Utils.toast('加载详情失败: ' + e.message, 'error');
        }
    },

    renderDetailPanel(session, points, container = document) {
        console.log('[TestData] renderDetailPanel called, session:', session?.id, 'points:', points?.length);

        this.renderSessionSummaryPanel(session, container);

        // 统计信息
        const stats = session.stats || {};
        const statsEl = container.querySelector('#detail-stats');

        if (statsEl) {
            statsEl.innerHTML = `
                <div class="stat-box"><div class="stat-value">${stats.total_points || 0}</div><div class="stat-label">数据点</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.avg_error || 0).toFixed(3)}</div><div class="stat-label">平均误差</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.max_error || 0).toFixed(3)}</div><div class="stat-label">最大误差</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.std_dev || 0).toFixed(3)}</div><div class="stat-label">标准差</div></div>
                <div class="stat-box"><div class="stat-value">${((stats.pass_rate || 0) * 100).toFixed(1)}%</div><div class="stat-label">通过率</div></div>
            `;
        }

        // 合并的标签+备注区域
        this.renderTagsAndRemarkPanel(session, points, container);

        this.currentFlowGroups = this._groupPointsByFlow(points);
        if (!this.currentFlowGroups.some(group => group.id === this.activeFlowId)) {
            this.activeFlowId = this.currentFlowGroups[0]?.id || null;
        }
        this.renderFlowTabs(container);
        this.renderActiveFlowPanel(container);
    },

    renderSessionSummaryPanel(session, container = document) {
        const infoEl = container.querySelector('#detail-summary-info');
        if (!infoEl) return;

        const deviceId = this._escapeHtml(this._formatDeviceId(session.device_id));
        const crc = this._escapeHtml(this._formatAppCrc(session.app_crc));
        const time = session.created_at ? new Date(session.created_at).toLocaleString('zh-CN') : '--';

        infoEl.innerHTML = `
            <div class="info-item">
                <span class="info-label">型号</span>
                <span class="info-value">${this._escapeHtml(session.model_name || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">测试类型</span>
                <span class="info-value">${this._escapeHtml(this.getTestTypeName(session.test_type))}</span>
            </div>
            <div class="info-item">
                <span class="info-label">状态</span>
                <span class="info-value">${this._escapeHtml(this.getStatusName(session.status))}</span>
            </div>
            <div class="info-item">
                <span class="info-label">测试时间</span>
                <span class="info-value">${this._escapeHtml(time)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">设备ID</span>
                <span class="info-value mono">${deviceId}</span>
            </div>
            <div class="info-item">
                <span class="info-label">CRC</span>
                <span class="info-value mono">${crc}</span>
            </div>
            <div class="info-item">
                <span class="info-label">硬件版本</span>
                <span class="info-value">${this._escapeHtml(session.hw_version || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">操作员</span>
                <span class="info-value">${this._escapeHtml(session.operator || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">备注</span>
                <span class="info-value">${this._escapeHtml(session.remark || '--')}</span>
            </div>
        `;
    },

    _safeParseRawData(rawData) {
        if (!rawData) return {};
        if (typeof rawData === 'object') return rawData;
        try {
            const parsed = JSON.parse(rawData);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    },

    _getPointFlowMeta(point, index) {
        const raw = this._safeParseRawData(point?.raw_data);
        let segmentNo = null;
        if (raw.segment !== undefined && raw.segment !== null && raw.segment !== '') {
            const v = Number(raw.segment);
            if (Number.isFinite(v)) segmentNo = v;
        } else if (raw.segment_idx !== undefined && raw.segment_idx !== null && raw.segment_idx !== '') {
            const v = Number(raw.segment_idx);
            if (Number.isFinite(v)) segmentNo = v + 1;
        }

        let reflectance = point?.reflectance;
        if ((reflectance === undefined || reflectance === null || reflectance === '') && raw.reflectance !== undefined) {
            reflectance = raw.reflectance;
        }
        reflectance = this._normReflectance(reflectance);

        return {
            index,
            raw,
            segmentNo,
            reflectance
        };
    },

    _formatPointNumber(value, digits = 0) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return Number(num.toFixed(digits)).toFixed(digits);
    },

    _getPointDetailFields(point) {
        const raw = this._safeParseRawData(point?.raw_data);
        const qualityX1000 = Number(raw?.quality_x1000);
        const quality = Number(raw?.quality);
        const goodShots = Number(raw?.good_shots);
        const totalShots = Number(raw?.total_shots);

        return {
            raw,
            target: Number.isFinite(Number(point?.position)) ? Number(point.position) : Number(raw?.target),
            reflectance: point?.reflectance ?? raw?.reflectance ?? null,
            measured: Number.isFinite(Number(point?.measured)) ? Number(point.measured) : Number(raw?.actual),
            error: Number.isFinite(Number(point?.error)) ? Number(point.error) : Number(raw?.error),
            timeMs: Number.isFinite(Number(raw?.time_ms)) ? Number(raw.time_ms) : null,
            fwTimeMs: Number.isFinite(Number(raw?.fw_time_ms))
                ? Number(raw.fw_time_ms)
                : (Number.isFinite(Number(raw?.measure_time_ms)) ? Number(raw.measure_time_ms) : null),
            amplitude: Number.isFinite(Number(raw?.amplitude)) ? Number(raw.amplitude) : null,
            rangeMm: Number.isFinite(Number(raw?.range_mm)) ? Number(raw.range_mm) : null,
            quality: Number.isFinite(quality)
                ? quality
                : (Number.isFinite(qualityX1000) ? qualityX1000 / 1000 : null),
            qualityX1000: Number.isFinite(qualityX1000) ? qualityX1000 : null,
            apdVoltage: Number.isFinite(Number(raw?.apd_voltage)) ? Number(raw.apd_voltage) : null,
            shotsText: (Number.isFinite(goodShots) && Number.isFinite(totalShots))
                ? `${goodShots}/${totalShots}`
                : '--',
            retryCount: Number.isFinite(Number(raw?.retry_count)) ? Number(raw.retry_count) : null,
            powerMode: raw?.power_mode ?? null,
            measureType: raw?.measure_type || null,
            timestamp: point?.timestamp || raw?.timestamp || null
        };
    },

    _calcPointStats(points) {
        if (!points || points.length === 0) {
            return {
                total_points: 0,
                avg_error: 0,
                max_error: 0,
                std_dev: 0,
                pass_rate: 0
            };
        }

        const errors = points.map(p => Number(p?.error) || 0);
        const absErrors = errors.map(Math.abs);
        const avg = absErrors.reduce((sum, val) => sum + val, 0) / absErrors.length;
        const max = absErrors.reduce((m, val) => Math.max(m, val), 0);
        const mean = errors.reduce((sum, val) => sum + val, 0) / errors.length;
        const variance = errors.length > 1
            ? errors.reduce((sum, val) => sum + ((val - mean) ** 2), 0) / (errors.length - 1)
            : 0;
        const passRate = absErrors.filter(val => val < 10).length / absErrors.length;

        return {
            total_points: points.length,
            avg_error: avg,
            max_error: max,
            std_dev: Math.sqrt(variance),
            pass_rate: passRate
        };
    },

    getChartMetricDefs() {
        return {
            error: {
                key: 'error',
                label: '误差',
                unit: 'mm',
                color: '#ff6b6b',
                getValue: (detail) => Number(detail?.error),
                threshold: 10,
                absStats: true
            },
            measured: {
                key: 'measured',
                label: '测量值',
                unit: 'mm',
                color: '#45b7d1',
                getValue: (detail) => Number(detail?.measured),
                absStats: false
            },
            amplitude: {
                key: 'amplitude',
                label: '幅值',
                unit: '',
                color: '#f59e0b',
                getValue: (detail) => Number(detail?.amplitude),
                absStats: false
            },
            rangeMm: {
                key: 'rangeMm',
                label: '极差',
                unit: 'mm',
                color: '#a78bfa',
                getValue: (detail) => Number(detail?.rangeMm),
                absStats: false
            },
            timeMs: {
                key: 'timeMs',
                label: '耗时',
                unit: 'ms',
                color: '#4ecdc4',
                getValue: (detail) => Number(detail?.timeMs),
                absStats: false
            },
            fwTimeMs: {
                key: 'fwTimeMs',
                label: 'FW耗时',
                unit: 'ms',
                color: '#00e676',
                getValue: (detail) => Number(detail?.fwTimeMs),
                absStats: false
            },
            quality: {
                key: 'quality',
                label: '质量',
                unit: '',
                color: '#ffd166',
                getValue: (detail) => Number(detail?.quality),
                absStats: false
            },
            apdVoltage: {
                key: 'apdVoltage',
                label: 'APD',
                unit: '',
                color: '#c084fc',
                getValue: (detail) => Number(detail?.apdVoltage),
                absStats: false
            }
        };
    },

    getChartMetricDef(metricKey = this.chartMetricKey) {
        const defs = this.getChartMetricDefs();
        return defs[metricKey] || defs.error;
    },

    _formatChartMetricValue(value, metricDef, digits = null) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        const finalDigits = Number.isFinite(digits)
            ? digits
            : (metricDef?.unit === 'mm' ? 3 : 1);
        return num.toFixed(finalDigits) + (metricDef?.unit ? ` ${metricDef.unit}` : '');
    },

    syncChartMetricUi() {
        const metricDef = this.getChartMetricDef();
        const selectEl = document.getElementById('test-data-chart-metric');
        if (selectEl) selectEl.value = metricDef.key;
        const titleEl = document.getElementById('test-data-chart-title');
        if (titleEl) titleEl.textContent = `📉 ${metricDef.label}趋势`;
    },

    setChartMetric(metricKey) {
        const metricDef = this.getChartMetricDef(metricKey);
        this.chartMetricKey = metricDef.key;
        try {
            localStorage.setItem('test_data_chart_metric', this.chartMetricKey);
        } catch (e) {}
        this.syncChartMetricUi();

        if (this.currentSession) {
            this.renderActiveFlowPanel();
        }
        const chartDialog = document.getElementById('chart-dialog');
        if (chartDialog && chartDialog.style.display !== 'none') {
            const canvas = document.getElementById('error-chart-popup');
            this.renderErrorChartOnCanvas(this.getActiveFlowGroup()?.points || [], canvas);
        }
    },

    _getMetricHeaderStyle(metricKey) {
        return this.chartMetricKey === metricKey
            ? 'color:var(--accent-color); text-decoration:underline; cursor:pointer;'
            : 'cursor:pointer;';
    },

    _buildFlowLabel(group, index) {
        const flowIndex = Number.isFinite(group.segmentNo) ? group.segmentNo : index + 1;
        const refText = group.reflectance ? ` · ${group.reflectance}%` : '';
        return `流程${flowIndex}${refText}`;
    },

    _groupPointsByFlow(points) {
        if (!Array.isArray(points) || points.length === 0) return [];

        const pointMetas = points.map((point, index) => ({
            point,
            meta: this._getPointFlowMeta(point, index)
        }));

        const hasSegment = pointMetas.some(item => Number.isFinite(item.meta.segmentNo));
        const groups = [];

        if (hasSegment) {
            const groupMap = new Map();
            let fallbackSeq = 1;
            pointMetas.forEach(item => {
                const segNo = item.meta.segmentNo;
                const key = Number.isFinite(segNo) ? `segment-${segNo}` : `fallback-${fallbackSeq++}`;
                let group = groupMap.get(key);
                if (!group) {
                    group = {
                        id: `flow-${groups.length + 1}`,
                        segmentNo: Number.isFinite(segNo) ? segNo : null,
                        reflectance: item.meta.reflectance || 0,
                        points: []
                    };
                    groupMap.set(key, group);
                    groups.push(group);
                }
                if (!group.reflectance && item.meta.reflectance) {
                    group.reflectance = item.meta.reflectance;
                }
                group.points.push(item.point);
            });
        } else {
            let currentGroup = null;
            pointMetas.forEach(item => {
                const reflectance = item.meta.reflectance || 0;
                const shouldStartNew = !currentGroup || currentGroup.reflectance !== reflectance;
                if (shouldStartNew) {
                    currentGroup = {
                        id: `flow-${groups.length + 1}`,
                        segmentNo: null,
                        reflectance,
                        points: []
                    };
                    groups.push(currentGroup);
                }
                currentGroup.points.push(item.point);
            });
        }

        return groups.map((group, index) => {
            const stats = this._calcPointStats(group.points);
            const positions = group.points
                .map(p => Number(p?.position))
                .filter(pos => Number.isFinite(pos));
            const startPos = positions.length ? positions[0] : null;
            const endPos = positions.length ? positions[positions.length - 1] : null;
            return {
                ...group,
                label: this._buildFlowLabel(group, index),
                stats,
                pointCount: group.points.length,
                startPos,
                endPos
            };
        });
    },

    getActiveFlowGroup() {
        if (!this.currentFlowGroups || this.currentFlowGroups.length === 0) return null;
        return this.currentFlowGroups.find(group => group.id === this.activeFlowId) || this.currentFlowGroups[0];
    },

    renderFlowTabs(container = document) {
        const tabsEl = container.querySelector('#detail-tabs');
        if (!tabsEl) return;

        const groups = this.currentFlowGroups || [];
        if (groups.length === 0) {
            tabsEl.innerHTML = '<span class="detail-flow-section-desc">当前记录没有可拆分的流程数据</span>';
            return;
        }

        tabsEl.innerHTML = groups.map(group => `
            <button class="detail-tab ${group.id === this.activeFlowId ? 'active' : ''}" onclick="TestDataPage.switchFlowTab('${group.id}')">
                ${this._escapeHtml(group.label)}
            </button>
        `).join('');
    },

    renderActiveFlowPanel(container = document) {
        const flow = this.getActiveFlowGroup();
        const metaEl = container.querySelector('#detail-flow-meta');
        const countEl = container.querySelector('#points-count');
        const tableEl = container.querySelector('#detail-points-table');
        const canvas = container.querySelector('#error-chart');

        if (!flow) {
            if (metaEl) metaEl.innerHTML = '';
            if (countEl) countEl.textContent = '0';
            if (tableEl) {
                tableEl.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-muted);">暂无流程数据</div>';
            }
            if (canvas) {
                this.renderErrorChartOnCanvas([], canvas);
            }
            return;
        }

        if (metaEl) {
            const rangeText = flow.startPos !== null && flow.endPos !== null
                ? `${flow.startPos.toFixed(0)} → ${flow.endPos.toFixed(0)} mm`
                : '--';
            metaEl.innerHTML = `
                <div class="flow-meta-item">
                    <span class="flow-meta-label">流程</span>
                    <span class="flow-meta-value">${this._escapeHtml(flow.label)}</span>
                </div>
                <div class="flow-meta-item">
                    <span class="flow-meta-label">反射率</span>
                    <span class="flow-meta-value">${this._escapeHtml(flow.reflectance ? `${flow.reflectance}%` : '多反射率')}</span>
                </div>
                <div class="flow-meta-item">
                    <span class="flow-meta-label">数据点</span>
                    <span class="flow-meta-value">${flow.pointCount}</span>
                </div>
                <div class="flow-meta-item">
                    <span class="flow-meta-label">位置范围</span>
                    <span class="flow-meta-value">${this._escapeHtml(rangeText)}</span>
                </div>
                <div class="flow-meta-item">
                    <span class="flow-meta-label">平均误差</span>
                    <span class="flow-meta-value">${flow.stats.avg_error.toFixed(3)} mm</span>
                </div>
                <div class="flow-meta-item">
                    <span class="flow-meta-label">最大误差</span>
                    <span class="flow-meta-value">${flow.stats.max_error.toFixed(3)} mm</span>
                </div>
            `;
        }

        if (countEl) countEl.textContent = String(flow.points.length);

        if (tableEl) {
            const rows = flow.points.map((point, index) => {
                const detail = this._getPointDetailFields(point);
                const errorValue = Number(detail.error) || 0;
                const errorColor = Math.abs(errorValue) > 10 ? '#ff5252' : '#00e676';
                const powerMode = detail.powerMode === null || detail.powerMode === undefined || detail.powerMode === ''
                    ? '--'
                    : this._escapeHtml(String(detail.powerMode));
                const measureType = detail.measureType
                    ? `<span class="point-chip">${this._escapeHtml(String(detail.measureType))}</span>`
                    : '--';
                const timeText = detail.timeMs === null ? '--' : `${Math.round(detail.timeMs)}ms`;
                const fwTimeText = detail.fwTimeMs === null ? '--' : `${Math.round(detail.fwTimeMs)}ms`;
                const timestampText = detail.timestamp
                    ? this._escapeHtml(String(detail.timestamp).replace('T', ' ').slice(0, 19))
                    : '--';
                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${this._formatPointNumber(detail.target, 1)}</td>
                        <td>${this._fmtReflectance(detail.reflectance)}</td>
                        <td>${this._formatPointNumber(detail.measured, 3)}</td>
                        <td style="color:${errorColor}">${this._formatPointNumber(detail.error, 3)}</td>
                        <td>${timeText}</td>
                        <td>${fwTimeText}</td>
                        <td>${this._formatPointNumber(detail.amplitude, 0)}</td>
                        <td>${this._formatPointNumber(detail.rangeMm, 1)}</td>
                        <td>${this._formatPointNumber(detail.quality, 3)}</td>
                        <td>${this._formatPointNumber(detail.apdVoltage, 0)}</td>
                        <td>${this._escapeHtml(detail.shotsText)}</td>
                        <td>${detail.retryCount === null ? '--' : this._escapeHtml(String(detail.retryCount))}</td>
                        <td>${powerMode}</td>
                        <td>${measureType}</td>
                        <td>${timestampText}</td>
                    </tr>
                `;
            }).join('');

            tableEl.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>目标位置</th>
                            <th>反射率</th>
                            <th onclick="TestDataPage.setChartMetric('measured')" style="${this._getMetricHeaderStyle('measured')}" title="点击查看测量值趋势">测量值</th>
                            <th onclick="TestDataPage.setChartMetric('error')" style="${this._getMetricHeaderStyle('error')}" title="点击查看误差趋势">误差</th>
                            <th onclick="TestDataPage.setChartMetric('timeMs')" style="${this._getMetricHeaderStyle('timeMs')}" title="点击查看耗时趋势">耗时</th>
                            <th onclick="TestDataPage.setChartMetric('fwTimeMs')" style="${this._getMetricHeaderStyle('fwTimeMs')}" title="点击查看FW耗时趋势">FW耗时</th>
                            <th onclick="TestDataPage.setChartMetric('amplitude')" style="${this._getMetricHeaderStyle('amplitude')}" title="点击查看幅值趋势">幅值</th>
                            <th onclick="TestDataPage.setChartMetric('rangeMm')" style="${this._getMetricHeaderStyle('rangeMm')}" title="点击查看极差趋势">极差</th>
                            <th onclick="TestDataPage.setChartMetric('quality')" style="${this._getMetricHeaderStyle('quality')}" title="点击查看质量趋势">质量</th>
                            <th onclick="TestDataPage.setChartMetric('apdVoltage')" style="${this._getMetricHeaderStyle('apdVoltage')}" title="点击查看APD趋势">APD</th>
                            <th>Shots</th>
                            <th>重试</th>
                            <th>功率</th>
                            <th>协议</th>
                            <th>时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            `;
        }

        if (canvas) {
            this.renderErrorChartOnCanvas(flow.points, canvas);
        }
    },

    // 合并的标签+备注面板
    renderTagsAndRemarkPanel(session, points, container) {
        const tagsEl = container.querySelector('#detail-tags');
        if (!tagsEl) return;

        // 自动获取的信息
        const modelName = session.model_name || '';
        const deviceId = this._formatDeviceId(session.device_id);

        // 自动从数据点提取反射率（如果有多个取第一个，或者显示"多反射率"）
        let autoReflectance = session.test_reflectance || 0;
        autoReflectance = autoReflectance ? this._normReflectance(autoReflectance) : 0;
        if (!autoReflectance && points && points.length > 0) {
            const refs = [...new Set(points.map(p => p.reflectance).filter(r => r))];
            if (refs.length === 1) {
                autoReflectance = this._normReflectance(refs[0]);
            }
        }

        // 用户可编辑的标签
        const alias = session.device_alias || '';
        const tempMeta = this._getSessionTemperatureMeta(session);
        const temp = tempMeta.value !== null ? tempMeta.value : 25;
        const remark = session.remark || '';
        const legacyRemarkTemp = this._parseLegacyRemarkTemperature(remark);
        const showRemark = !!remark && !(tempMeta.isLegacy && legacyRemarkTemp !== null);
        const temperatureNote = tempMeta.isLegacy ? '<span class="tag-note">备注温度回退</span>' : '';

        tagsEl.innerHTML = `
            <div class="tags-remark-section">
                <div class="tags-header">
                    <span>🏷️ 测试信息</span>
                    <button class="mini-btn" onclick="TestDataPage.openTagsDialog()">编辑备注/标签</button>
                </div>

                <!-- 显示模式 -->
                <div class="tags-display-mode" id="tags-display-mode">
                    <div class="tags-row">
                        <span class="tag-item"><b>型号:</b> <span class="tag-value">${this._escapeHtml(modelName || '--')}</span></span>
                        <span class="tag-item"><b>设备ID:</b> <span class="tag-value">${this._escapeHtml(deviceId || '--')}</span></span>
                    </div>
                    <div class="tags-row">
                        <span class="tag-item"><b>别名:</b> <span class="tag-value">${this._escapeHtml(alias || '--')}</span></span>
                        <span class="tag-item"><b>温度:</b> <span class="tag-value">${this._escapeHtml(tempMeta.text)}</span>${temperatureNote}</span>
                        <span class="tag-item"><b>反射率:</b> <span class="tag-value">${this._escapeHtml(autoReflectance ? autoReflectance + '%' : '多反射率')}</span></span>
                    </div>
                    ${showRemark ? `<div class="tags-row remark-row"><span class="tag-item"><b>备注:</b> <span class="tag-value">${this._escapeHtml(remark)}</span></span></div>` : ''}
                </div>

                <!-- 编辑模式 -->
                <div class="tags-edit-mode" id="tags-edit-mode" style="display:none;">
                    <div class="tag-form-row">
                        <label>型号</label>
                        <input type="text" id="tag-model" value="${this._escapeHtml(modelName)}" disabled class="auto-field">
                    </div>
                    <div class="tag-form-row">
                        <label>设备ID</label>
                        <input type="text" id="tag-device-id" value="${this._escapeHtml(deviceId)}" disabled class="auto-field">
                    </div>
                    <div class="tag-form-row">
                        <label>设备别名</label>
                        <input type="text" id="tag-alias" value="${this._escapeHtml(alias)}" placeholder="如：1#机、测试机A">
                    </div>
                    <div class="tag-form-row">
                        <label>测试温度(℃)</label>
                        <input type="number" id="tag-temperature" value="${this._escapeHtml(temp)}" step="1" placeholder="25">
                    </div>
                    <div class="tag-form-row">
                        <label>反射率(%)</label>
                        <input type="number" id="tag-reflectance" value="${this._escapeHtml(autoReflectance)}" min="0" max="100" placeholder="0=多反射率">
                    </div>
                    <div class="tag-form-row">
                        <label>备注</label>
                        <textarea id="tag-remark" placeholder="附加备注...">${this._escapeHtml(remark)}</textarea>
                    </div>
                    <div class="tags-form-actions">
                        <button class="mini-btn btn-primary" onclick="TestDataPage.saveTagsAndRemark()">保存</button>
                        <button class="mini-btn" onclick="TestDataPage.cancelTagsEdit()">取消</button>
                    </div>
                </div>
            </div>
        `;
    },

    openTagsDialog() {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }
        const dialog = document.getElementById('tags-dialog');
        if (!dialog) return;

        const session = this.currentSession;
        const deviceIdDisplay = session.device_id !== undefined && session.device_id !== null
            ? (typeof session.device_id === 'number' ? session.device_id.toString(16).toUpperCase() : String(session.device_id))
            : '--';
        const crcDisplay = session.app_crc !== undefined && session.app_crc !== null
            ? (typeof session.app_crc === 'number' ? '0x' + session.app_crc.toString(16).toUpperCase().padStart(8, '0') : String(session.app_crc))
            : '--';
        const time = session.created_at ? new Date(session.created_at).toLocaleString('zh-CN') : '--';

        const infoEl = document.getElementById('tags-dialog-info');
        if (infoEl) {
            infoEl.innerHTML = `
                <div class="item"><label>型号</label><span style="color:#00ff88; font-size:16px;">${session.model_name || '--'}</span></div>
                <div class="item"><label>设备ID</label><span style="font-family:monospace; color:#00d4ff;">${deviceIdDisplay}</span></div>
                <div class="item"><label>CRC</label><span style="font-family:monospace; color:#ffd700;">${crcDisplay}</span></div>
                <div class="item"><label>测试时间</label><span>${time}</span></div>
            `;
        }

        const aliasEl = document.getElementById('tag-alias-dialog');
        const tempEl = document.getElementById('tag-temperature-dialog');
        const refEl = document.getElementById('tag-reflectance-dialog');
        const remarkEl = document.getElementById('tag-remark-dialog');

        const alias = session.device_alias || '';
        const tempMeta = this._getSessionTemperatureMeta(session);
        const temp = tempMeta.value !== null ? tempMeta.value : 25;
        let autoReflectance = session.test_reflectance || 0;
        autoReflectance = autoReflectance ? this._normReflectance(autoReflectance) : 0;
        if (!autoReflectance && this.currentPoints && this.currentPoints.length > 0) {
            const refs = [...new Set(this.currentPoints.map(p => p.reflectance).filter(r => r))];
            if (refs.length === 1) autoReflectance = this._normReflectance(refs[0]);
        }

        if (aliasEl) aliasEl.value = alias;
        if (tempEl) tempEl.value = temp;
        if (refEl) refEl.value = autoReflectance || '';
        if (remarkEl) remarkEl.value = session.remark || '';

        dialog.style.display = 'flex';
    },

    closeTagsDialog() {
        const dialog = document.getElementById('tags-dialog');
        if (dialog) dialog.style.display = 'none';
    },

    async saveTagsAndRemarkFromDialog() {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }

        const alias = document.getElementById('tag-alias-dialog')?.value?.trim() || '';
        let temp = parseFloat(document.getElementById('tag-temperature-dialog')?.value);
        if (!Number.isFinite(temp)) temp = 25;
        let ref = parseFloat(document.getElementById('tag-reflectance-dialog')?.value);
        if (!Number.isFinite(ref)) ref = 0;
        if (ref > 0 && ref <= 1) ref = ref * 100;
        ref = Math.round(ref);
        if (ref < 0) ref = 0;
        if (ref > 100) ref = 100;
        const remark = document.getElementById('tag-remark-dialog')?.value?.trim() || '';

        try {
            const result = await pywebview.api.data_update_tags(
                this.currentSession.id,
                alias,
                temp,
                ref,
                null,
                remark
            );

            if (result?.success) {
                this.currentSession.device_alias = alias;
                this.currentSession.test_temperature = temp;
                this.currentSession.test_reflectance = ref;
                this.currentSession.remark = remark;

                const container = this.getPageContainer();
                this.renderTagsAndRemarkPanel(this.currentSession, this.currentPoints || [], container);

                Utils.toast('保存成功', 'success');
                this.refresh();
                this.closeTagsDialog();
            } else {
                Utils.toast(result?.error || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e, 'error');
        }
    },

    openChartDialog() {
        const dialog = document.getElementById('chart-dialog');
        if (!dialog) return;
        dialog.style.display = 'flex';

        requestAnimationFrame(() => {
            const canvas = document.getElementById('error-chart-popup');
            if (!canvas) return;
            this.renderErrorChartOnCanvas(this.getActiveFlowGroup()?.points || [], canvas);
        });
    },

    closeChartDialog() {
        const dialog = document.getElementById('chart-dialog');
        if (dialog) dialog.style.display = 'none';
        if (this.errorChart) {
            try {
                this.errorChart.destroy();
            } catch (e) {}
            this.errorChart = null;
        }
        const mainCanvas = document.getElementById('error-chart');
        if (mainCanvas) {
            this.renderErrorChartOnCanvas(this.getActiveFlowGroup()?.points || [], mainCanvas);
        }
    },

    switchFlowTab(flowId) {
        this.activeFlowId = flowId;
        this.renderFlowTabs(this.getPageContainer());
        this.renderActiveFlowPanel(this.getPageContainer());
    },

    getTestTypeName(type) {
        const map = { 'accuracy': '精度测试', 'calibration': '校准测试', 'slipway': '滑台测试', 'firmware': '固件测试' };
        return map[type] || type || '--';
    },

    getStatusName(status) {
        const map = { 'completed': '已完成', 'running': '进行中', 'failed': '失败', 'pending': '待处理' };
        return map[status] || status || '--';
    },

    updateStats() {
        const container = this.getPageContainer();
        const el1 = container.querySelector('#stat-total');
        const el2 = container.querySelector('#stat-completed');
        const el3 = container.querySelector('#stat-failed');
        if (el1) el1.textContent = this.total;
        if (el2) el2.textContent = this.sessions.filter(s => s.status === 'completed').length;
        if (el3) el3.textContent = this.sessions.filter(s => s.status === 'failed').length;
    },

    updatePagination() {
        const container = this.getPageContainer();
        const totalPages = Math.ceil(this.total / this.pageSize) || 1;
        const el = container.querySelector('#page-info');
        const prev = container.querySelector('#btn-prev');
        const next = container.querySelector('#btn-next');
        if (el) el.textContent = `${this.page}/${totalPages}`;
        if (prev) prev.disabled = this.page <= 1;
        if (next) next.disabled = this.page >= totalPages;
    },

    prevPage() {
        if (this.page > 1) { this.page--; this.refresh(); }
    },

    nextPage() {
        const totalPages = Math.ceil(this.total / this.pageSize);
        if (this.page < totalPages) { this.page++; this.refresh(); }
    },

    async showDetail(sessionId) {
        try {
            console.log('开始加载会话详情:', sessionId);

            const sessionResult = await pywebview.api.data_get_session(sessionId);
            const pointsResult = await pywebview.api.data_get_points(sessionId);

            console.log('会话结果:', sessionResult);
            console.log('数据点结果:', pointsResult);

            if (!sessionResult || !sessionResult.success) {
                Utils.toast(sessionResult?.error || '加载会话失败', 'error');
                return;
            }

            this.currentSession = sessionResult.session;
            const points = pointsResult?.success ? pointsResult.points || [] : [];

            console.log('最终数据点:', points);

            // 确保对话框元素存在
            const dialog = document.getElementById('detail-dialog');
            if (!dialog) {
                console.error('找不到详情对话框元素');
                return;
            }

            // 先显示弹窗，确保 chart-container 有尺寸（否则canvas宽度为0导致图表空白）
            dialog.style.display = 'flex';

            // 等待一帧让浏览器完成layout，再渲染内容/图表
            await new Promise(resolve => requestAnimationFrame(resolve));
            this.renderDetail(this.currentSession, points);
        } catch (e) {
            console.error('加载详情失败:', e);
            Utils.toast('加载详情失败: ' + e, 'error');
        }
    },

    renderDetail(session, points) {
        // 处理设备ID显示
        let deviceIdDisplay = '--';
        if (session.device_id !== undefined && session.device_id !== null && session.device_id !== '') {
            if (typeof session.device_id === 'number') {
                deviceIdDisplay = session.device_id.toString(16).toUpperCase();
            } else {
                deviceIdDisplay = String(session.device_id);
            }
        }

        // 处理CRC显示
        let crcDisplay = '--';
        if (session.app_crc !== undefined && session.app_crc !== null && session.app_crc !== '') {
            if (typeof session.app_crc === 'number') {
                crcDisplay = '0x' + session.app_crc.toString(16).toUpperCase().padStart(8, '0');
            } else {
                crcDisplay = String(session.app_crc);
            }
        }

        const time = session.created_at ? new Date(session.created_at).toLocaleString('zh-CN') : '--';

        const infoEl = document.getElementById('detail-info-dialog');
        if (infoEl) {
            infoEl.innerHTML = `
                <div class="item"><label>型号</label><span style="color:#00ff88; font-size:16px;">${session.model_name || '--'}</span></div>
                <div class="item"><label>设备ID</label><span style="font-family:monospace; color:#00d4ff;">${deviceIdDisplay}</span></div>
                <div class="item"><label>CRC</label><span style="font-family:monospace; color:#ffd700;">${crcDisplay}</span></div>
                <div class="item"><label>硬件版本</label><span>${session.hw_version || '--'}</span></div>
                <div class="item"><label>测试类型</label><span>${this.getTestTypeName(session.test_type)}</span></div>
                <div class="item"><label>状态</label><span class="status ${session.status}">${this.getStatusName(session.status)}</span></div>
                <div class="item"><label>测试时间</label><span>${time}</span></div>
                <div class="item"><label>操作员</label><span>${session.operator || '--'}</span></div>
                <div class="item"><label>备注</label><span>${session.remark || '--'}</span></div>
            `;
        }

        const stats = session.stats || {};
        const statsEl = document.getElementById('detail-stats-dialog');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="stat-box"><div class="stat-value">${stats.total_points || 0}</div><div class="stat-label">数据点</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.avg_error || 0).toFixed(3)}</div><div class="stat-label">平均误差(mm)</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.max_error || 0).toFixed(3)}</div><div class="stat-label">最大误差(mm)</div></div>
                <div class="stat-box"><div class="stat-value">${(stats.std_dev || 0).toFixed(3)}</div><div class="stat-label">标准差(mm)</div></div>
                <div class="stat-box"><div class="stat-value">${((stats.pass_rate || 0) * 100).toFixed(1)}%</div><div class="stat-label">通过率</div></div>
            `;
        }

        // 渲染误差图表（弹窗用）
        this.renderErrorChart(points, 'error-chart-dialog');

        const pointsEl = document.getElementById('detail-points-dialog');
        if (pointsEl) {
            pointsEl.innerHTML = `
                <table>
                    <thead><tr><th>序号</th><th>时间</th><th>位置(mm)</th><th>反射率(%)</th><th>测量值(mm)</th><th>误差(mm)</th></tr></thead>
                    <tbody>
                        ${points.map((p, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${p.timestamp ? new Date(p.timestamp).toLocaleTimeString() : '--'}</td>
                                <td>${p.position?.toFixed(3) || '--'}</td>
                                <td>${this._fmtReflectance(p.reflectance)}</td>
                                <td>${p.measured?.toFixed(3) || '--'}</td>
                                <td style="color: ${Math.abs(p.error || 0) > 10 ? '#ff6b6b' : 'inherit'}">${p.error?.toFixed(3) || '--'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
    },

    renderErrorChartOnCanvas(points, canvas) {
        if (!canvas) {
            console.warn('[TestData] renderErrorChartOnCanvas: canvas is null');
            return;
        }
        this.renderErrorChart(points, null, canvas);
    },
    
    renderErrorChart(points, canvasId = 'error-chart', canvasEl = null) {
        const canvas = canvasEl || document.getElementById(canvasId);
        if (!canvas) {
            console.warn('未找到图表canvas元素, canvasId:', canvasId);
            return;
        }
        
        console.log('准备渲染图表，数据点数量:', points?.length);
        
        // 确保canvas可见
        canvas.style.display = '';
        
        // 移除之前的空状态提示
        const chartContainer = canvas.parentElement;
        if (chartContainer) {
            const emptyDiv = chartContainer.querySelector('.chart-empty');
            if (emptyDiv) emptyDiv.remove();
        }

        if (this.errorChart) {
            this.errorChart.destroy();
            this.errorChart = null;
        }
        
        if (!points || points.length === 0) {
            // 显示空状态 - 只隐藏canvas，不替换整个容器
            if (chartContainer) {
                canvas.style.display = 'none';
                let emptyDiv = chartContainer.querySelector('.chart-empty');
                if (!emptyDiv) {
                    emptyDiv = document.createElement('div');
                    emptyDiv.className = 'chart-empty';
                    emptyDiv.style.cssText = 'display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted);';
                    emptyDiv.textContent = '暂无数据点可显示图表';
                    chartContainer.appendChild(emptyDiv);
                }
            }
            return;
        }

        const metricDef = this.getChartMetricDef();
        this.syncChartMetricUi();
        const detailPoints = points.map((point, index) => {
            const detail = this._getPointDetailFields(point);
            const x = Number.isFinite(Number(detail.target)) ? Number(detail.target) : index + 1;
            const y = metricDef.getValue(detail);
            return { x, y, detail };
        }).filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));

        // 图表统一按距离从近到远显示，避免反向流程时横轴倒着看
        detailPoints.sort((a, b) => a.x - b.x);

        if (detailPoints.length === 0) {
            if (chartContainer) {
                canvas.style.display = 'none';
                let emptyDiv = chartContainer.querySelector('.chart-empty');
                if (!emptyDiv) {
                    emptyDiv = document.createElement('div');
                    emptyDiv.className = 'chart-empty';
                    emptyDiv.style.cssText = 'display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted);';
                    chartContainer.appendChild(emptyDiv);
                }
                emptyDiv.textContent = `当前流程没有“${metricDef.label}”可绘制数据`;
            }
            return;
        }

        const labels = detailPoints.map(item => Number(item.x).toFixed(0));
        const metricData = detailPoints.map(item => item.y);
        const meanValue = metricData.reduce((sum, value) => sum + value, 0) / metricData.length;
        const thresholdValue = Number(metricDef.threshold);
        
        console.log('图表数据:', {
            labels: labels.length,
            metricKey: metricDef.key,
            metricData: metricData.length
        });

        // 创建图表配置
        const config = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: metricDef.unit ? `${metricDef.label} (${metricDef.unit})` : metricDef.label,
                        data: metricData,
                        borderColor: metricDef.color,
                        backgroundColor: metricDef.color + '22',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: '平均',
                        data: metricData.map(() => meanValue),
                        borderColor: '#f97316',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        fill: false,
                        tension: 0,
                        pointRadius: 0,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${metricDef.label}趋势分析`,
                        color: '#ffffff'
                    },
                    legend: {
                        labels: {
                            color: '#ffffff'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${this._formatChartMetricValue(context.parsed?.y, metricDef)}`
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '目标位置 (mm)',
                            color: '#ffffff'
                        },
                        ticks: {
                            color: '#ffffff'
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.1)'
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: metricDef.unit ? `${metricDef.label} (${metricDef.unit})` : metricDef.label,
                            color: metricDef.color
                        },
                        ticks: {
                            color: metricDef.color
                        },
                        grid: {
                            color: metricDef.color + '33'
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                hover: {
                    mode: 'index',
                    intersect: false
                }
            }
        };

        if (Number.isFinite(thresholdValue)) {
            config.data.datasets.push({
                type: 'line',
                label: '阈值(+)',
                data: metricData.map(() => thresholdValue),
                borderColor: '#ffb020',
                backgroundColor: 'transparent',
                borderWidth: 1.2,
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
                tension: 0,
                yAxisID: 'y'
            });
            if (metricDef.absStats) {
                config.data.datasets.push({
                    type: 'line',
                    label: '阈值(-)',
                    data: metricData.map(() => -thresholdValue),
                    borderColor: '#ffb020',
                    backgroundColor: 'transparent',
                    borderWidth: 1.2,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                    yAxisID: 'y'
                });
            }
        }

        // 确保canvas可见并移除之前的错误信息
        const chartBox = canvas.parentElement || document.getElementById('chart-container');
        if (chartBox) {
            const existingError = chartBox.querySelector('.chart-empty');
            if (existingError) existingError.remove();
        }
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        // 创建图表
        try {
            // 确保Chart.js已加载
            if (typeof Chart === 'undefined') {
                console.error('Chart.js 未加载');
                canvas.style.display = 'none';
                if (chartBox) {
                    let errorDiv = chartBox.querySelector('.chart-empty');
                    if (!errorDiv) {
                        errorDiv = document.createElement('div');
                        errorDiv.className = 'chart-empty';
                        errorDiv.textContent = '图表库未加载，请刷新页面重试';
                        chartBox.appendChild(errorDiv);
                    }
                }
                return;
            }
            
            console.log('开始创建图表实例，canvas尺寸:', canvas.width, 'x', canvas.height);
            
            // 直接创建图表（不使用 requestAnimationFrame，避免 this 上下文问题）
            this.errorChart = new Chart(canvas, config);
            console.log('图表创建成功');
            
        } catch (e) {
            console.error('创建图表失败:', e);
            canvas.style.display = 'none';
            if (chartBox) {
                let errorDiv = chartBox.querySelector('.chart-empty');
                if (!errorDiv) {
                    errorDiv = document.createElement('div');
                    errorDiv.className = 'chart-empty';
                    errorDiv.textContent = `图表加载失败: ${e.message}`;
                    chartBox.appendChild(errorDiv);
                }
            }
        }
    },
    
    hideDetail() {
        document.getElementById('detail-dialog').style.display = 'none';
        // 销毁图表实例
        if (this.errorChart) {
            this.errorChart.destroy();
            this.errorChart = null;
        }
    },
    
    async deleteSession() {
        if (!this.currentSession) return;
        if (!confirm('确定删除此测试记录吗？删除后无法恢复。')) return;
        
        try {
            const result = await pywebview.api.data_delete_session(this.currentSession.id);
            if (result && result.success) {
                Utils.toast('删除成功', 'success');
                this.currentSession = null;
                // 隐藏详情面板
                document.getElementById('detail-empty').style.display = 'flex';
                document.getElementById('detail-content').style.display = 'none';
                // 刷新列表
                this.refresh();
            } else {
                Utils.toast(result?.error || '删除失败', 'error');
            }
        } catch (e) {
            Utils.toast('删除失败: ' + e, 'error');
        }
    },

    _getExportFormatLabel(format) {
        const key = String(format || 'xlsx').toLowerCase();
        if (key === 'csv') return 'CSV';
        if (key === 'json') return 'JSON';
        return 'Excel';
    },

    _getExportFlowGroups() {
        if (Array.isArray(this.currentFlowGroups) && this.currentFlowGroups.length > 0) {
            return this.currentFlowGroups;
        }
        const groups = this._groupPointsByFlow(this.currentPoints || []);
        return groups;
    },

    getExportMetricDefs() {
        return [
            { key: 'error', label: '误差' },
            { key: 'measured', label: '测量值' },
            { key: 'amplitude', label: '幅值' },
            { key: 'range_mm', label: '极差' },
            { key: 'time_ms', label: '耗时' },
            { key: 'fw_time_ms', label: 'FW耗时' },
            { key: 'quality', label: '质量' },
            { key: 'apd_voltage', label: 'APD' }
        ];
    },

    _renderExportMetricChecks(containerId, selectedKeys = ['error']) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const selected = new Set((selectedKeys || []).map(v => String(v)));
        container.innerHTML = this.getExportMetricDefs().map(item => `
            <label style="display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid rgba(255,255,255,0.1); border-radius:8px; background:rgba(8,15,24,0.75); cursor:pointer;">
                <input type="checkbox" class="export-metric-check" data-metric-key="${this._escapeHtml(item.key)}" ${selected.has(item.key) ? 'checked' : ''}>
                <span>${this._escapeHtml(item.label)}总览</span>
            </label>
        `).join('');
    },

    _readExportMetricChecks(containerId) {
        const keys = [];
        document.querySelectorAll(`#${containerId} .export-metric-check`).forEach(el => {
            if (el.checked) {
                const key = String(el.dataset.metricKey || '').trim();
                if (key) keys.push(key);
            }
        });
        return keys;
    },

    _applyErrorAxisUi(prefix, state = {}) {
        const modeEl = document.getElementById(`${prefix}-error-axis-mode`);
        const minEl = document.getElementById(`${prefix}-error-axis-min`);
        const maxEl = document.getElementById(`${prefix}-error-axis-max`);
        if (!modeEl || !minEl || !maxEl) return;
        const mode = String(state.mode || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto';
        modeEl.value = mode;
        minEl.value = state.min ?? '';
        maxEl.value = state.max ?? '';
        const disabled = mode !== 'manual';
        minEl.disabled = disabled;
        maxEl.disabled = disabled;
        if (!modeEl._boundAxisToggle) {
            modeEl._boundAxisToggle = true;
            modeEl.addEventListener('change', () => this._applyErrorAxisUi(prefix, {
                mode: modeEl.value,
                min: minEl.value,
                max: maxEl.value
            }));
        }
    },

    _readErrorAxisUi(prefix) {
        const modeEl = document.getElementById(`${prefix}-error-axis-mode`);
        const minEl = document.getElementById(`${prefix}-error-axis-min`);
        const maxEl = document.getElementById(`${prefix}-error-axis-max`);
        const mode = String(modeEl?.value || 'auto').toLowerCase() === 'manual' ? 'manual' : 'auto';
        const min = Number(minEl?.value);
        const max = Number(maxEl?.value);
        return {
            mode,
            min: Number.isFinite(min) ? min : null,
            max: Number.isFinite(max) ? max : null
        };
    },

    _getZeroPointOffsetFromPoints(points) {
        if (!Array.isArray(points) || points.length === 0) return null;
        let bestOffset = null;
        let bestAbsTarget = Infinity;
        for (const point of points) {
            const detail = this._getPointDetailFields(point);
            const target = Number(detail?.target);
            const measured = Number(detail?.measured);
            const error = Number(detail?.error);
            if (!Number.isFinite(target)) continue;
            const absTarget = Math.abs(target);
            if (absTarget >= bestAbsTarget) continue;
            bestAbsTarget = absTarget;
            if (Number.isFinite(measured) && Number.isFinite(target)) {
                bestOffset = measured - target;
            } else if (Number.isFinite(error)) {
                bestOffset = error;
            } else {
                bestOffset = null;
            }
        }
        return Number.isFinite(Number(bestOffset)) ? Number(bestOffset) : null;
    },

    async _getSessionDefaultExportOffsetAsync(sessionId) {
        if (!sessionId) return null;
        if (this.currentSession && this.currentSession.id === sessionId) {
            return this._getZeroPointOffsetFromPoints(this.currentPoints || []);
        }
        try {
            const result = await pywebview.api.data_get_points(sessionId);
            const points = result?.success ? (result.points || []) : [];
            return this._getZeroPointOffsetFromPoints(points);
        } catch (e) {
            console.warn('[TestData] 读取0点偏移失败:', sessionId, e);
            return null;
        }
    },

    _applyTemperatureExportAlignModeUi() {
        const modeEl = document.getElementById('temperature-export-align-mode');
        const noteEl = document.getElementById('temperature-export-align-note');
        const allInput = document.getElementById('temperature-export-offset-all');
        const mode = String(modeEl?.value || this.temperatureExportAlignMode || 'auto').toLowerCase();
        const defaultOffsets = this.temperatureExportDefaultOffsetsBySession || {};
        const manualOffsets = this.temperatureExportOffsetsBySession || {};
        this.temperatureExportAlignMode = mode;

        document.querySelectorAll('#temperature-export-offset-list .temperature-export-offset-input').forEach(el => {
            const sessionId = String(el.dataset.sessionId || '').trim();
            const defaultOffset = Number(defaultOffsets[sessionId]);
            const manualOffset = Number(manualOffsets[sessionId]);
            const hasDefault = Number.isFinite(defaultOffset);
            const hasManual = Number.isFinite(manualOffset);

            if (mode === 'auto') {
                el.value = hasDefault ? String(defaultOffset) : '';
                el.disabled = true;
            } else if (mode === 'none') {
                el.value = '0';
                el.disabled = true;
            } else {
                el.value = hasManual ? String(manualOffset) : (hasDefault ? String(defaultOffset) : '');
                el.disabled = false;
            }
        });

        if (allInput) {
            allInput.disabled = mode !== 'manual';
        }
        const applyBtn = document.querySelector('button[onclick="TestDataPage.applyTemperatureExportOffsetToAll()"]');
        if (applyBtn) {
            applyBtn.disabled = mode !== 'manual';
        }

        if (noteEl) {
            if (mode === 'auto') {
                noteEl.innerHTML = '默认按每个会话距 0 最近的点自动对齐。导出时自动填入偏移并锁定输入框。';
            } else if (mode === 'manual') {
                noteEl.innerHTML = '手动模式下，你可以自己修改每个会话的偏移值；默认仍会先填入推荐的 0 点偏移。';
            } else {
                noteEl.innerHTML = '不对齐：导出时不应用任何 0 点修正，测量值和误差保持原始记录。';
            }
        }
    },

    openExportDialog(format = 'xlsx') {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }

        this.pendingExportFormat = String(format || 'xlsx').toLowerCase();
        const groups = this._getExportFlowGroups();
        const titleEl = document.getElementById('export-dialog-title');
        const confirmEl = document.getElementById('export-dialog-confirm');
        const infoEl = document.getElementById('export-dialog-info');
        const listEl = document.getElementById('export-offset-list');
        const dialog = document.getElementById('export-dialog');

        if (!titleEl || !confirmEl || !infoEl || !listEl || !dialog) {
            Utils.toast('导出弹窗未初始化', 'error');
            return;
        }

        const formatLabel = this._getExportFormatLabel(this.pendingExportFormat);
        titleEl.textContent = `${formatLabel} 导出设置`;
        confirmEl.textContent = `导出${formatLabel}`;

        this._renderExportMetricChecks('export-sheet-metrics', this.exportOverviewMetrics || ['error']);
        this._applyErrorAxisUi('export', this.exportErrorAxisState || { mode: 'auto', min: null, max: null });

        const session = this.currentSession || {};
        infoEl.innerHTML = `
            <div class="info-item">
                <span class="info-label">型号</span>
                <span class="info-value">${this._escapeHtml(session.model_name || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">设备ID</span>
                <span class="info-value mono">${this._escapeHtml(this._formatDeviceId(session.device_id))}</span>
            </div>
            <div class="info-item">
                <span class="info-label">CRC</span>
                <span class="info-value mono">${this._escapeHtml(this._formatAppCrc(session.app_crc))}</span>
            </div>
            <div class="info-item">
                <span class="info-label">流程数</span>
                <span class="info-value">${groups.length || 0}</span>
            </div>
        `;

        const offsetState = this.exportOffsetsByFlow || {};
        if (!groups.length) {
            listEl.innerHTML = '<div style="padding:12px 0; color:var(--text-muted);">当前记录没有可导出的流程数据</div>';
        } else {
            listEl.innerHTML = groups.map(group => {
                const rangeText = group.startPos !== null && group.startPos !== undefined && group.endPos !== null && group.endPos !== undefined
                    ? `${Number(group.startPos).toFixed(0)} → ${Number(group.endPos).toFixed(0)} mm`
                    : '--';
                const savedValue = offsetState[group.id];
                const valueAttr = savedValue === undefined || savedValue === null || savedValue === ''
                    ? ''
                    : ` value="${this._escapeHtml(String(savedValue))}"`;
                return `
                    <div style="display:grid; grid-template-columns:minmax(220px, 1.4fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(140px, 1fr); gap:10px; align-items:end; padding:10px 12px; border:1px solid rgba(255,255,255,0.1); border-radius:10px; background:rgba(8,15,24,0.9); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);">
                        <div>
                            <div style="font-weight:600; color:var(--accent-color);">${this._escapeHtml(group.label)}</div>
                            <div style="font-size:12px; color:var(--text-muted);">反射率 ${this._escapeHtml(group.reflectance ? `${group.reflectance}%` : '多反射率')} · ${group.pointCount || group.points?.length || 0} 点 · ${this._escapeHtml(rangeText)}</div>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:4px;">固定偏移(mm)</label>
                            <input type="number" class="export-offset-input" data-flow-id="${this._escapeHtml(group.id)}" step="0.001" placeholder="0"${valueAttr}>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:4px;">说明</label>
                            <div style="min-height:32px; display:flex; align-items:center; color:var(--text-muted);">导出时整组统一减去</div>
                        </div>
                        <div>
                            <label style="display:block; margin-bottom:4px;">公式</label>
                            <div style="min-height:32px; display:flex; align-items:center; color:var(--text-muted);">测量值 - 偏移</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        dialog.style.display = 'flex';
    },

    closeExportDialog() {
        const dialog = document.getElementById('export-dialog');
        if (dialog) dialog.style.display = 'none';
    },

    applyExportOffsetToAll() {
        const allInput = document.getElementById('export-offset-all');
        const raw = String(allInput?.value || '').trim();
        if (!raw) {
            Utils.toast('请输入统一偏移值', 'warning');
            return;
        }
        const offset = Number(raw);
        if (!Number.isFinite(offset)) {
            Utils.toast('统一偏移值无效', 'warning');
            return;
        }

        document.querySelectorAll('#export-offset-list .export-offset-input').forEach(el => {
            el.value = String(offset);
        });
    },

    _readExportOffsetsFromDialog() {
        const offsets = {};
        document.querySelectorAll('#export-offset-list .export-offset-input').forEach(el => {
            const flowId = String(el.dataset.flowId || '').trim();
            if (!flowId) return;
            const raw = String(el.value || '').trim();
            if (!raw) return;
            const offset = Number(raw);
            if (!Number.isFinite(offset)) return;
            offsets[flowId] = offset;
        });
        this.exportOffsetsByFlow = offsets;
        return offsets;
    },

    _buildExportOptionsFromDialog() {
        const flowOffsets = this._readExportOffsetsFromDialog();
        const overviewMetrics = this._readExportMetricChecks('export-sheet-metrics');
        const errorAxis = this._readErrorAxisUi('export');
        this.exportOverviewMetrics = overviewMetrics;
        this.exportErrorAxisState = errorAxis;
        return {
            flow_offsets: flowOffsets,
            overview_metrics: overviewMetrics,
            error_axis: errorAxis
        };
    },

    async confirmExportDialog() {
        const format = this.pendingExportFormat || 'xlsx';
        const exportOptions = this._buildExportOptionsFromDialog();
        this.closeExportDialog();

        if (format === 'csv') {
            await this.exportCSV(exportOptions);
            return;
        }
        if (format === 'json') {
            await this.exportJSON(exportOptions);
            return;
        }
        await this.exportXLSX(exportOptions);
    },

    _buildFrontendExportOffsetLookup(points, exportOptions = {}) {
        const flowOffsets = exportOptions?.flow_offsets || {};
        const lookup = {};
        const groups = this._groupPointsByFlow(points || []);
        groups.forEach(group => {
            const offset = Number(flowOffsets[group.id] || 0);
            const safeOffset = Number.isFinite(offset) ? offset : 0;
            (group.points || []).forEach(point => {
                if (point?.id) {
                    lookup[point.id] = safeOffset;
                }
            });
        });
        return lookup;
    },

    _getAdjustedPointForExport(point, exportOffset = 0) {
        const detail = this._getPointDetailFields(point);
        const target = Number.isFinite(Number(detail.target)) ? Number(detail.target) : null;
        const measuredRaw = Number.isFinite(Number(detail.measured)) ? Number(detail.measured) : null;
        const errorRaw = Number.isFinite(Number(detail.error)) ? Number(detail.error) : null;
        const safeOffset = Number.isFinite(Number(exportOffset)) ? Number(exportOffset) : 0;
        const measuredAdjusted = measuredRaw === null ? null : (measuredRaw - safeOffset);
        const errorAdjusted = measuredAdjusted !== null && target !== null
            ? (measuredAdjusted - target)
            : (errorRaw === null ? null : (errorRaw - safeOffset));

        return {
            ...detail,
            target,
            measuredRaw,
            errorRaw,
            exportOffset: safeOffset,
            measuredAdjusted,
            errorAdjusted
        };
    },
    
    async exportCSV(exportOptions = null) {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }

        if (exportOptions === null) {
            this.openExportDialog('csv');
            return;
        }
        
        try {
            // 使用后端保存文件功能
            const result = await pywebview.api.data_save_csv(this.currentSession.id, exportOptions);
            if (result && result.success) {
                Utils.toast(`CSV已保存到: ${result.path}`, 'success');
                return;
            } else if (result && result.error) {
                console.warn('后端导出失败:', result.error);
            }
        } catch (e) {
            console.warn('后端导出失败:', e);
        }
        
        // 回退到前端下载方式
        try {
            const points = this.currentPoints?.length
                ? this.currentPoints
                : ((await pywebview.api.data_get_points(this.currentSession.id))?.points || []);
            
            if (points.length === 0) {
                Utils.toast('没有数据可导出', 'warning');
                return;
            }

            const offsetLookup = this._buildFrontendExportOffsetLookup(points, exportOptions);
            
            // 生成CSV内容
            const session = this.currentSession;
            const headers = ['# 测试报告'];
            headers.push(`# 型号: ${session.model_name || '--'}`);
            headers.push(`# 设备ID: ${session.device_id ? session.device_id.toString(16).toUpperCase() : '--'}`);
            headers.push(`# CRC: ${session.app_crc ? '0x' + session.app_crc.toString(16).toUpperCase() : '--'}`);
            headers.push(`# 测试时间: ${session.created_at || '--'}`);
            headers.push('# 修正规则: 修正后测量值 = 原始测量值 - 导出偏移');
            headers.push('');
            headers.push('序号,时间,目标位置(mm),反射率(%),测量值(mm),误差(mm),导出偏移(mm),原始测量值(mm),原始误差(mm)');
            
            const csvContent = headers.join('\n') + '\n' + 
                points.map((p, i) => {
                    const detail = this._getAdjustedPointForExport(p, offsetLookup[p.id] || 0);
                    return [
                        i + 1,
                        p.timestamp ? new Date(p.timestamp).toLocaleString('zh-CN') : '',
                        detail.target?.toFixed(3) || '',
                        detail.reflectance || '',
                        detail.measuredAdjusted?.toFixed(3) || '',
                        detail.errorAdjusted?.toFixed(3) || '',
                        detail.exportOffset?.toFixed(3) || '0.000',
                        detail.measuredRaw?.toFixed(3) || '',
                        detail.errorRaw?.toFixed(3) || ''
                    ].join(',');
                }).join('\n');
            
            // 尝试使用下载链接
            const blob = new Blob(['\uFEFF' + csvContent], {type: 'text/csv;charset=utf-8'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `test_${session.model_name || 'data'}_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Utils.toast('CSV导出成功', 'success');
        } catch (e) {
            Utils.toast('导出失败: ' + e, 'error');
        }
    },
    
    async exportJSON(exportOptions = null) {
        if (!this.currentSession) return;
        if (exportOptions === null) {
            this.openExportDialog('json');
            return;
        }
        try {
            const result = await pywebview.api.data_export_json(this.currentSession.id, exportOptions);
            if (result && result.success) {
                const blob = new Blob([JSON.stringify(result.data, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `test_${this.currentSession.id.substring(0, 8)}.json`; a.click();
                URL.revokeObjectURL(url);
                Utils.toast('导出成功', 'success');
            }
        } catch (e) {
            Utils.toast('导出失败: ' + e, 'error');
        }
    },
    
    async exportXLSX(exportOptions = null) {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }
        if (exportOptions === null) {
            this.openExportDialog('xlsx');
            return;
        }
        try {
            Utils.toast('正在生成Excel文件...', 'info');
            const result = await pywebview.api.data_save_xlsx(this.currentSession.id, exportOptions);
            if (result && result.success) {
                Utils.toast(`Excel已保存: ${result.path}`, 'success');
            } else {
                Utils.toast(result?.error || '导出失败', 'error');
            }
        } catch (e) {
            Utils.toast('导出Excel失败: ' + e, 'error');
        }
    },
    
    async openDataFolder() {
        try {
            const result = await pywebview.api.data_open_folder();
            if (result && result.success) {
                Utils.toast('已打开数据文件夹: ' + result.path, 'success');
            } else {
                Utils.toast(result?.error || '打开文件夹失败', 'error');
            }
        } catch (e) {
            Utils.toast('打开文件夹失败: ' + e, 'error');
        }
    },
    
    async exportAll() {
        try {
            const result = await pywebview.api.task_save_export(null, null);
            if (result && result.success) {
                Utils.toast(`已导出 ${result.session_count} 条记录到: ${result.path}`, 'success');
            } else {
                Utils.toast(result?.error || '导出失败', 'error');
            }
        } catch (e) {
            Utils.toast('批量导出失败: ' + e, 'error');
        }
    },
    
    toggleChartType() {
        // 切换图表类型（线图/柱图）
        if (this.errorChart) {
            const newType = this.errorChart.config.type === 'line' ? 'bar' : 'line';
            this.errorChart.config.type = newType;
            this.errorChart.update();
            Utils.toast(`已切换为${newType === 'line' ? '折线图' : '柱状图'}`, 'info');
        }
    },
    
    // ========== 备注功能（已合并到标签面板） ==========
    
    toggleRemarkEdit() {
        // 兼容旧调用，重定向到标签编辑
        this.toggleTagsEdit();
    },
    
    cancelRemarkEdit() {
        this.cancelTagsEdit();
    },
    
    async saveRemark() {
        // 兼容旧调用
        await this.saveTagsAndRemark();
    },
    
    // ========== 结构化标签功能 ==========
    
    selectedSessions: [],  // 多选的会话ID列表
    currentPoints: [],     // 当前会话的数据点（用于自动提取反射率）
    
    toggleTagsEdit() {
        const displayMode = document.getElementById('tags-display-mode');
        const editMode = document.getElementById('tags-edit-mode');
        const btn = document.getElementById('btn-edit-tags');
        
        if (displayMode && editMode) {
            const isEditing = editMode.style.display !== 'none';
            displayMode.style.display = isEditing ? 'block' : 'none';
            editMode.style.display = isEditing ? 'none' : 'block';
            if (btn) btn.textContent = isEditing ? '编辑' : '取消';
        }
    },
    
    cancelTagsEdit() {
        const displayMode = document.getElementById('tags-display-mode');
        const editMode = document.getElementById('tags-edit-mode');
        const btn = document.getElementById('btn-edit-tags');
        
        if (displayMode && editMode) {
            displayMode.style.display = 'block';
            editMode.style.display = 'none';
            if (btn) btn.textContent = '编辑';
        }
    },
    
    async saveTagsAndRemark() {
        if (!this.currentSession) {
            Utils.toast('请先选择一个测试记录', 'warning');
            return;
        }

        const alias = document.getElementById('tag-alias')?.value?.trim() || '';
        let temp = parseFloat(document.getElementById('tag-temperature')?.value);
        if (!Number.isFinite(temp)) temp = 25;
        let ref = parseFloat(document.getElementById('tag-reflectance')?.value);
        if (!Number.isFinite(ref)) ref = 0;
        if (ref > 0 && ref <= 1) ref = ref * 100;
        ref = Math.round(ref);
        if (ref < 0) ref = 0;
        if (ref > 100) ref = 100;
        const remark = document.getElementById('tag-remark')?.value?.trim() || '';

        try {
            const result = await pywebview.api.data_update_tags(
                this.currentSession.id,
                alias,
                temp,
                ref,
                null,  // tags JSON
                remark
            );

            if (result?.success) {
                // 更新本地数据
                this.currentSession.device_alias = alias;
                this.currentSession.test_temperature = temp;
                this.currentSession.test_reflectance = ref;
                this.currentSession.remark = remark;

                // 重新渲染面板
                const container = this.getPageContainer();
                this.renderTagsAndRemarkPanel(this.currentSession, this.currentPoints || [], container);

                Utils.toast('保存成功', 'success');
                this.refresh();  // 刷新列表
            } else {
                Utils.toast(result?.error || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e, 'error');
        }
    },
    
    // ========== 多选和高低温报告导出 ==========
    
    toggleSelectMode() {
        this.selectMode = !this.selectMode;
        this.selectedSessions = [];
        
        const btn = document.getElementById('btn-select-mode');
        if (btn) {
            btn.textContent = this.selectMode ? '✓ 取消选择' : '☐ 多选';
            btn.classList.toggle('active', this.selectMode);
        }
        
        // 显示/隐藏导出按钮
        const exportBtn = document.getElementById('btn-export-temp');
        if (exportBtn) {
            exportBtn.style.display = this.selectMode ? 'inline-block' : 'none';
        }
        
        // 更新选中计数
        this.updateSelectCount();
        
        // 重新渲染列表
        this.renderList();
    },
    
    toggleSessionSelect(sessionId, event) {
        if (event) event.stopPropagation();
        
        const idx = this.selectedSessions.indexOf(sessionId);
        if (idx >= 0) {
            this.selectedSessions.splice(idx, 1);
        } else {
            this.selectedSessions.push(sessionId);
        }
        
        // 更新复选框状态
        const checkbox = document.querySelector(`.session-checkbox[data-id="${sessionId}"]`);
        if (checkbox) {
            checkbox.checked = idx < 0;
        }
        
        this.updateSelectCount();
    },
    
    updateSelectCount() {
        const countEl = document.getElementById('select-count');
        if (countEl) {
            countEl.textContent = this.selectedSessions.length > 0 
                ? `已选 ${this.selectedSessions.length} 条` 
                : '';
        }
    },
    
    async _loadSessionForTemperatureExport(sessionId) {
        if (!sessionId) return null;
        let session = this.sessions.find(item => item?.id === sessionId) || null;
        if (!session && this.currentSession?.id === sessionId) {
            session = this.currentSession;
        }
        if (session) return session;

        try {
            const result = await pywebview.api.data_get_session(sessionId);
            if (result?.success && result.session) {
                return result.session;
            }
        } catch (e) {
            console.warn('[TestData] 加载高低温导出会话失败:', sessionId, e);
        }
        return null;
    },

    async _getSelectedSessionsForTemperatureExport() {
        const ordered = [];
        for (const sessionId of this.selectedSessions) {
            const session = await this._loadSessionForTemperatureExport(sessionId);
            if (session) {
                ordered.push(session);
            }
        }
        return ordered;
    },

    async openTemperatureExportDialog() {
        const dialog = document.getElementById('temperature-export-dialog');
        const titleEl = document.getElementById('temperature-export-dialog-title');
        const infoEl = document.getElementById('temperature-export-dialog-info');
        const listEl = document.getElementById('temperature-export-offset-list');
        const confirmEl = document.getElementById('temperature-export-dialog-confirm');

        if (!dialog || !titleEl || !infoEl || !listEl || !confirmEl) {
            Utils.toast('高低温导出弹窗未初始化', 'error');
            return;
        }

        const sessions = await this._getSelectedSessionsForTemperatureExport();
        if (sessions.length < 2) {
            Utils.toast('请至少选择2条有效测试数据进行合并', 'warning');
            return;
        }
        const defaultOffsetMap = {};
        for (const session of sessions) {
            defaultOffsetMap[session.id] = await this._getSessionDefaultExportOffsetAsync(session.id);
        }
        this.temperatureExportDefaultOffsetsBySession = defaultOffsetMap;

        const modelNames = Array.from(new Set(sessions.map(item => String(item?.model_name || '').trim()).filter(Boolean)));
        const tempTexts = Array.from(new Set(
            sessions
                .map(item => this._getSessionTemperatureMeta(item).text)
                .filter(text => text && text !== '--')
        ));
        const reflectTexts = Array.from(new Set(
            sessions
                .map(item => this._fmtReflectance(item?.test_reflectance))
                .filter(text => text && text !== '--')
        ));

        titleEl.textContent = '高低温报告导出设置';
        confirmEl.textContent = `导出高低温报告 (${sessions.length} 条)`;
        this._renderExportMetricChecks('temperature-export-sheet-metrics', this.temperatureExportOverviewMetrics || ['error']);
        this._applyErrorAxisUi('temperature-export', this.temperatureExportErrorAxisState || { mode: 'auto', min: null, max: null });
        const alignModeEl = document.getElementById('temperature-export-align-mode');
        if (alignModeEl) {
            alignModeEl.value = this.temperatureExportAlignMode || 'auto';
            if (!alignModeEl._boundAlignModeChange) {
                alignModeEl._boundAlignModeChange = true;
                alignModeEl.addEventListener('change', () => this._applyTemperatureExportAlignModeUi());
            }
        }
        infoEl.innerHTML = `
            <div class="info-item">
                <span class="info-label">已选会话</span>
                <span class="info-value">${sessions.length}</span>
            </div>
            <div class="info-item">
                <span class="info-label">型号</span>
                <span class="info-value">${this._escapeHtml(modelNames.join(' / ') || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">温度</span>
                <span class="info-value">${this._escapeHtml(tempTexts.join(' / ') || '--')}</span>
            </div>
            <div class="info-item">
                <span class="info-label">反射率</span>
                <span class="info-value">${this._escapeHtml(reflectTexts.join(' / ') || '多反射率')}</span>
            </div>
        `;

        const offsetState = this.temperatureExportOffsetsBySession || {};
        listEl.innerHTML = sessions.map((session, index) => {
            const tempMeta = this._getSessionTemperatureMeta(session);
            const alias = String(session?.device_alias || '').trim() || `会话${index + 1}`;
            const model = String(session?.model_name || '').trim() || '--';
            const reflectance = this._fmtReflectance(session?.test_reflectance);
            const deviceId = this._formatDeviceId(session?.device_id);
            const createdAt = String(session?.created_at || '').trim().slice(0, 19) || '--';
            const remark = String(session?.remark || '').trim();
            const defaultOffset = defaultOffsetMap[session.id];
            const savedValue = offsetState[session.id];
            const valueAttr = savedValue === undefined || savedValue === null || savedValue === ''
                ? (Number.isFinite(defaultOffset) ? ` value="${this._escapeHtml(String(defaultOffset))}"` : '')
                : ` value="${this._escapeHtml(String(savedValue))}"`;
            return `
                <div style="display:grid; grid-template-columns:minmax(240px, 1.6fr) minmax(140px, 1fr) minmax(120px, 0.9fr) minmax(140px, 1fr); gap:10px; align-items:end; padding:10px 12px; border:1px solid rgba(255,255,255,0.1); border-radius:10px; background:rgba(8,15,24,0.9); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);">
                    <div>
                        <div style="font-weight:600; color:var(--accent-color);">${this._escapeHtml(alias)} · ${this._escapeHtml(tempMeta.text)}</div>
                        <div style="font-size:12px; color:var(--text-muted);">${this._escapeHtml(model)} · 反射率 ${this._escapeHtml(reflectance === '--' ? '多反射率' : reflectance)} · 设备 ${this._escapeHtml(deviceId)} · ${this._escapeHtml(createdAt)}</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">备注：${this._escapeHtml(remark || '无')}</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">推荐0点偏移：${Number.isFinite(defaultOffset) ? this._escapeHtml(defaultOffset.toFixed(3)) : '--'} mm</div>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:4px;">固定偏移(mm)</label>
                        <input type="number" class="temperature-export-offset-input" data-session-id="${this._escapeHtml(session.id)}" step="0.001" placeholder="0"${valueAttr}>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:4px;">公式</label>
                        <div style="min-height:32px; display:flex; align-items:center; color:var(--text-muted);">测量值 - 偏移</div>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:4px;">作用范围</label>
                        <div style="min-height:32px; display:flex; align-items:center; color:var(--text-muted);">该会话整份报告</div>
                    </div>
                </div>
            `;
        }).join('');

        this._applyTemperatureExportAlignModeUi();
        dialog.style.display = 'flex';
    },

    closeTemperatureExportDialog() {
        const dialog = document.getElementById('temperature-export-dialog');
        if (dialog) dialog.style.display = 'none';
    },

    applyTemperatureExportOffsetToAll() {
        const allInput = document.getElementById('temperature-export-offset-all');
        const raw = String(allInput?.value || '').trim();
        if (!raw) {
            Utils.toast('请输入统一偏移值', 'warning');
            return;
        }
        const offset = Number(raw);
        if (!Number.isFinite(offset)) {
            Utils.toast('统一偏移值无效', 'warning');
            return;
        }

        document.querySelectorAll('#temperature-export-offset-list .temperature-export-offset-input').forEach(el => {
            el.value = String(offset);
        });
    },

    _readTemperatureExportOffsetsFromDialog() {
        const mode = String(document.getElementById('temperature-export-align-mode')?.value || this.temperatureExportAlignMode || 'auto').toLowerCase();
        const defaultOffsets = this.temperatureExportDefaultOffsetsBySession || {};
        if (mode === 'none') {
            this.temperatureExportOffsetsBySession = {};
            return {};
        }
        if (mode === 'auto') {
            const offsets = {};
            Object.entries(defaultOffsets).forEach(([sessionId, value]) => {
                const offset = Number(value);
                if (!Number.isFinite(offset)) return;
                offsets[sessionId] = offset;
            });
            return offsets;
        }

        const offsets = {};
        document.querySelectorAll('#temperature-export-offset-list .temperature-export-offset-input').forEach(el => {
            const sessionId = String(el.dataset.sessionId || '').trim();
            if (!sessionId) return;
            const raw = String(el.value || '').trim();
            if (!raw) return;
            const offset = Number(raw);
            if (!Number.isFinite(offset)) return;
            offsets[sessionId] = offset;
        });
        this.temperatureExportOffsetsBySession = offsets;
        return offsets;
    },

    _buildTemperatureExportOptionsFromDialog() {
        const overviewMetrics = this._readExportMetricChecks('temperature-export-sheet-metrics');
        const errorAxis = this._readErrorAxisUi('temperature-export');
        this.temperatureExportOverviewMetrics = overviewMetrics;
        this.temperatureExportErrorAxisState = errorAxis;
        this.temperatureExportAlignMode = String(document.getElementById('temperature-export-align-mode')?.value || this.temperatureExportAlignMode || 'auto').toLowerCase();
        return {
            session_offsets: this._readTemperatureExportOffsetsFromDialog(),
            overview_metrics: overviewMetrics,
            error_axis: errorAxis,
            align_zero_mode: this.temperatureExportAlignMode
        };
    },

    async confirmTemperatureExportDialog() {
        const exportOptions = this._buildTemperatureExportOptionsFromDialog();
        this.closeTemperatureExportDialog();
        await this.exportTemperatureReport(exportOptions);
    },

    async exportTemperatureReport(exportOptions = null) {
        if (this.selectedSessions.length === 0) {
            Utils.toast('请先选择要合并的测试数据', 'warning');
            return;
        }
        
        if (this.selectedSessions.length < 2) {
            Utils.toast('请至少选择2条测试数据进行合并', 'warning');
            return;
        }

        if (exportOptions === null) {
            await this.openTemperatureExportDialog();
            return;
        }
        
        try {
            Utils.toast('正在生成高低温报告...', 'info');
            const result = await pywebview.api.data_export_temperature_report(this.selectedSessions, exportOptions);
            
            if (result?.success) {
                Utils.toast(`高低温报告已保存: ${result.path}`, 'success');
                
                // 显示汇总信息
                const summary = result.summary;
                if (summary) {
                    console.log('报告汇总:', summary);
                }
                
                // 退出选择模式
                this.toggleSelectMode();
            } else {
                Utils.toast(result?.error || '导出失败', 'error');
            }
        } catch (e) {
            Utils.toast('导出高低温报告失败: ' + e, 'error');
        }
    },
    
    selectMode: false,  // 多选模式标志
    activeFlowId: null,
    currentFlowGroups: [],
    pendingExportFormat: 'xlsx',
    exportOffsetsByFlow: {},
    temperatureExportOffsetsBySession: {},
    temperatureExportDefaultOffsetsBySession: {},
    exportOverviewMetrics: ['error'],
    exportErrorAxisState: { mode: 'auto', min: null, max: null },
    temperatureExportOverviewMetrics: ['error'],
    temperatureExportErrorAxisState: { mode: 'auto', min: null, max: null },
    temperatureExportAlignMode: 'auto'
};
