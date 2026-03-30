/**
 * 设备追溯与生产统计页面
 */
window.TraceabilityPage = {
    qualityChart: null,
    modelChart: null,
    firmwareChart: null,
    
    async init() {
        console.log('[Traceability] init');
        
        // 设置默认日期范围（最近30天）
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        
        const dateFrom = document.getElementById('prod-date-from');
        const dateTo = document.getElementById('prod-date-to');
        if (dateFrom) dateFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
        if (dateTo) dateTo.value = today.toISOString().split('T')[0];
        
        // 加载筛选选项
        await this.loadFilterOptions();
        
        // 加载打印机列表
        await this.refreshPrinters();
        
        // 默认加载生产统计
        await this.loadProductionStats();
    },
    
    async loadFilterOptions() {
        try {
            // 加载型号列表
            const modelsResult = await pywebview.api.data_list_models();
            if (modelsResult?.success) {
                const select = document.getElementById('prod-model');
                if (select) {
                    modelsResult.models.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        opt.textContent = m;
                        select.appendChild(opt);
                    });
                }
            }
            
            // 加载工位列表
            const stationsResult = await pywebview.api.data_list_stations();
            if (stationsResult?.success) {
                const select = document.getElementById('prod-station');
                if (select) {
                    stationsResult.stations.forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s;
                        opt.textContent = s || '未知工位';
                        select.appendChild(opt);
                    });
                }
            }
            
            // 加载CRC列表用于固件对比
            const crcsResult = await pywebview.api.data_list_crcs();
            if (crcsResult?.success) {
                const select = document.getElementById('firmware-crc-select');
                if (select) {
                    crcsResult.crcs.forEach(crc => {
                        const opt = document.createElement('option');
                        opt.value = crc;
                        opt.textContent = '0x' + crc.toString(16).toUpperCase().padStart(8, '0');
                        select.appendChild(opt);
                    });
                }
                
                // 设备ID列表
                const deviceList = document.getElementById('trace-device-list');
                if (deviceList) {
                    const sessionsResult = await pywebview.api.data_query_sessions({}, 500, 0);
                    if (sessionsResult?.success) {
                        const deviceIds = new Set();
                        sessionsResult.sessions.forEach(s => {
                            if (s.device_id) {
                                const idHex = s.device_id.toString(16).toUpperCase();
                                deviceIds.add(idHex);
                            }
                        });
                        deviceList.innerHTML = Array.from(deviceIds).map(id => 
                            `<option value="${id}">`
                        ).join('');
                    }
                }
            }
        } catch (e) {
            console.error('加载筛选选项失败:', e);
        }
    },
    
    switchTab(tabName) {
        // 切换Tab按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        // 找到对应的Tab按钮并激活
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            if (btn.textContent.includes(this._getTabLabel(tabName))) {
                btn.classList.add('active');
            }
        });
        
        // 切换面板
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        const targetPanel = document.getElementById(`tab-${tabName}`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }
        
        // 切换到二维码Tab时，重置预览区域
        if (tabName === 'qrcode') {
            const preview = document.getElementById('qrcode-preview');
            if (preview && !this._currentLabel) {
                preview.innerHTML = '<div class="preview-placeholder">生成后显示预览</div>';
            }
        }
    },
    
    _getTabLabel(tabName) {
        const labels = {
            'lifecycle': '设备追溯',
            'qrcode': '二维码',
            'production': '生产统计',
            'firmware': '固件对比'
        };
        return labels[tabName] || tabName;
    },
    
    // ==================== 设备追溯 ====================
    
    async searchDevice() {
        const deviceId = document.getElementById('trace-device-id')?.value?.trim();
        const serialNumber = document.getElementById('trace-serial')?.value?.trim();
        
        if (!deviceId && !serialNumber) {
            Utils.toast('请输入设备ID或序列号', 'warning');
            return;
        }
        
        try {
            Utils.toast('正在查询...', 'info');
            
            const result = await pywebview.api.data_get_device_lifecycle(
                deviceId || null,
                serialNumber || null
            );
            
            if (!result?.success) {
                Utils.toast(result?.error || '查询失败', 'error');
                return;
            }
            
            if (!result.sessions || result.sessions.length === 0) {
                Utils.toast('未找到该设备的测试记录', 'warning');
                document.getElementById('device-overview').style.display = 'none';
                document.getElementById('device-timeline').style.display = 'none';
                return;
            }
            
            // 显示设备概览
            this.renderDeviceOverview(result);
            
            // 显示时间线
            this.renderTimeline(result.timeline);
            
            Utils.toast(`找到 ${result.total_tests} 条测试记录`, 'success');
            
            // 加载校准和滑台测试历史
            await this.loadDeviceTrackerHistory(deviceId);
            
        } catch (e) {
            console.error('查询设备失败:', e);
            Utils.toast('查询失败: ' + e.message, 'error');
        }
    },
    
    renderDeviceOverview(data) {
        const panel = document.getElementById('device-overview');
        panel.style.display = 'block';
        
        // 设备标题
        const deviceId = data.device_id ? data.device_id.toString(16).toUpperCase() : '--';
        document.getElementById('device-title').textContent = `设备 ${deviceId}`;
        document.getElementById('device-model').textContent = data.model_name || '未知型号';
        
        // 统计数据
        document.getElementById('stat-total-tests').textContent = data.total_tests || 0;
        document.getElementById('stat-passed').textContent = data.completed || 0;
        document.getElementById('stat-failed').textContent = data.failed || 0;
        document.getElementById('stat-pass-rate').textContent = (data.pass_rate || 0) + '%';
        
        // 详细信息
        document.getElementById('info-first-test').textContent = 
            data.first_test ? new Date(data.first_test).toLocaleString('zh-CN') : '--';
        document.getElementById('info-last-test').textContent = 
            data.last_test ? new Date(data.last_test).toLocaleString('zh-CN') : '--';
        document.getElementById('info-firmware').textContent = 
            data.firmware_versions?.join(', ') || '--';
    },
    
    renderTimeline(timeline) {
        const container = document.getElementById('device-timeline');
        const list = document.getElementById('timeline-list');
        
        container.style.display = 'block';
        
        if (!timeline || timeline.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">暂无记录</div>';
            return;
        }
        
        list.innerHTML = timeline.map(item => {
            const time = item.time ? new Date(item.time).toLocaleString('zh-CN') : '--';
            const statusClass = item.status === 'completed' ? 'passed' : 
                               item.status === 'failed' ? 'failed' : '';
            const statusText = item.status === 'completed' ? '✅ 通过' :
                              item.status === 'failed' ? '❌ 失败' : '⏳ ' + item.status;
            
            // 备注显示
            const remarkHtml = item.remark ? `<div class="timeline-remark">📝 ${item.remark}</div>` : '';
            
            return `
                <div class="timeline-item ${statusClass}">
                    <div class="timeline-time">${time}</div>
                    <div class="timeline-content">
                        <div class="timeline-type">${this.getTestTypeName(item.type)} ${statusText}</div>
                        <div class="timeline-info">
                            固件: ${item.firmware || '--'} | 
                            工位: ${item.station || '--'} | 
                            操作员: ${item.operator || '--'} |
                            误差: ${item.avg_error?.toFixed(3) || '--'} mm
                        </div>
                        ${remarkHtml}
                    </div>
                </div>
            `;
        }).join('');
    },
    
    getTestTypeName(type) {
        const map = {
            'accuracy': '精度测试',
            'calibration': '校准测试',
            'firmware': '固件测试',
            'slipway': '滑台测试',
            'plan': '高级测试'
        };
        return map[type] || type || '测试';
    },
    
    // ==================== 校准和滑台测试历史 ====================
    
    async loadDeviceTrackerHistory(deviceId) {
        try {
            const result = await pywebview.api.data_get_device_tracker_history(deviceId);
            
            if (!result?.success) {
                console.log('设备跟踪数据不可用:', result?.error);
                return;
            }
            
            // 渲染校准历史
            if (result.calibrations && result.calibrations.length > 0) {
                this.renderCalibrationHistory(result.calibrations);
            }
            
            // 渲染滑台测试历史
            if (result.tests && result.tests.length > 0) {
                this.renderSlipwayHistory(result.tests);
            }
            
        } catch (e) {
            console.error('加载设备跟踪历史失败:', e);
        }
    },
    
    renderCalibrationHistory(calibrations) {
        const container = document.getElementById('calibration-history');
        const list = document.getElementById('calibration-list');
        
        container.style.display = 'block';
        
        list.innerHTML = calibrations.map(cal => {
            const time = cal.timestamp ? new Date(cal.timestamp).toLocaleString('zh-CN') : '--';
            const statusClass = cal.success ? 'success' : 'failed';
            
            // 解析校准数据
            let phaseHtml = '';
            if (cal.phase_cal_data && typeof cal.phase_cal_data === 'object') {
                const phases = Object.entries(cal.phase_cal_data);
                if (phases.length > 0) {
                    phaseHtml = `
                        <div class="cal-data-section">
                            <h5>相位校准数据</h5>
                            <div class="cal-data-grid">
                                ${phases.map(([key, data]) => `
                                    <div class="history-data-item">
                                        <label>${key}</label>
                                        <span>160M: ${data.phase_160M_x10 || 0}, APD: ${data.apdvol || 0}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }
            
            let coeffHtml = '';
            if (cal.coeff_speed_data && typeof cal.coeff_speed_data === 'object') {
                const coeff = cal.coeff_speed_data;
                coeffHtml = `
                    <div class="cal-data-section">
                        <h5>系数+光速数据</h5>
                        <div class="cal-data-grid">
                            <div class="history-data-item"><label>APDWork</label><span>${coeff.apdwork_x1000 || 0}</span></div>
                            <div class="history-data-item"><label>APDCoeff</label><span>${coeff.apdcoeff_x1000 || 0}</span></div>
                            <div class="history-data-item"><label>校准次数</label><span>${coeff.speed_num || 0}</span></div>
                            <div class="history-data-item"><label>位置1</label><span>${coeff.actual_dis1 || 0} mm</span></div>
                            <div class="history-data-item"><label>位置2</label><span>${coeff.actual_dis2 || 0} mm</span></div>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="history-item ${statusClass}">
                    <div class="history-item-header">
                        <span class="history-item-title">${cal.workflow_name || cal.workflow_id || '校准'} ${cal.success ? '✅' : '❌'}</span>
                        <span class="history-item-time">${time}</span>
                    </div>
                    <div class="history-item-data">
                        <div class="history-data-item"><label>型号</label><span>${cal.model_name || '--'}</span></div>
                        <div class="history-data-item"><label>CRC</label><span>${cal.app_crc_hex || '--'}</span></div>
                        <div class="history-data-item"><label>工位</label><span>${cal.station_id || '--'}</span></div>
                        <div class="history-data-item"><label>耗时</label><span>${cal.duration ? cal.duration.toFixed(1) + 's' : '--'}</span></div>
                    </div>
                    ${phaseHtml}
                    ${coeffHtml}
                </div>
            `;
        }).join('');
    },
    
    renderSlipwayHistory(tests) {
        const container = document.getElementById('slipway-history');
        const list = document.getElementById('slipway-list');
        
        container.style.display = 'block';
        
        list.innerHTML = tests.map(test => {
            const time = test.timestamp ? new Date(test.timestamp).toLocaleString('zh-CN') : '--';
            const passRate = test.pass_rate ? (test.pass_rate * 100).toFixed(1) : '100';
            
            return `
                <div class="history-item">
                    <div class="history-item-header">
                        <span class="history-item-title">${this.getTestTypeName(test.test_type)}</span>
                        <span class="history-item-time">${time}</span>
                    </div>
                    <div class="history-item-data">
                        <div class="history-data-item"><label>型号</label><span>${test.model_name || '--'}</span></div>
                        <div class="history-data-item"><label>CRC</label><span>${test.app_crc_hex || '--'}</span></div>
                        <div class="history-data-item"><label>测试点数</label><span>${test.total_points || 0}</span></div>
                        <div class="history-data-item"><label>平均误差</label><span>${test.avg_error?.toFixed(2) || '--'} mm</span></div>
                        <div class="history-data-item"><label>最大误差</label><span>${test.max_error?.toFixed(2) || '--'} mm</span></div>
                        <div class="history-data-item"><label>最小误差</label><span>${test.min_error?.toFixed(2) || '--'} mm</span></div>
                        <div class="history-data-item"><label>通过率</label><span>${passRate}%</span></div>
                        ${test.calibration_id ? `<div class="history-data-item"><label>关联校准</label><span style="color:var(--primary-color)">已关联</span></div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },
    
    // ==================== 生产统计 ====================
    
    async loadProductionStats() {
        const dateFrom = document.getElementById('prod-date-from')?.value;
        const dateTo = document.getElementById('prod-date-to')?.value;
        const modelName = document.getElementById('prod-model')?.value;
        const stationId = document.getElementById('prod-station')?.value;
        
        try {
            const result = await pywebview.api.data_get_production_stats(
                dateFrom || null,
                dateTo || null,
                modelName || null,
                stationId || null
            );
            
            if (!result?.success) {
                Utils.toast(result?.error || '获取统计失败', 'error');
                return;
            }
            
            // 更新概览数据
            document.getElementById('prod-total').textContent = result.total || 0;
            document.getElementById('prod-passed').textContent = result.passed || 0;
            document.getElementById('prod-failed').textContent = result.failed || 0;
            document.getElementById('prod-pass-rate').textContent = (result.pass_rate || 0) + '%';
            
            // 渲染图表
            this.renderQualityTrendChart(result.quality_trend);
            this.renderModelDistChart(result.by_model);
            
            // 渲染工位统计表
            this.renderStationTable(result.by_station);
            
        } catch (e) {
            console.error('获取生产统计失败:', e);
            Utils.toast('获取统计失败: ' + e.message, 'error');
        }
    },
    
    renderQualityTrendChart(data) {
        const canvas = document.getElementById('quality-trend-chart');
        if (!canvas) return;
        
        if (this.qualityChart) {
            this.qualityChart.destroy();
        }
        
        if (!data || data.length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = 'block';
        
        const labels = data.map(d => d.date);
        const passRates = data.map(d => d.pass_rate);
        const totals = data.map(d => d.total);
        
        this.qualityChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '通过率 (%)',
                        data: passRates,
                        borderColor: '#00e676',
                        backgroundColor: 'rgba(0, 230, 118, 0.1)',
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y'
                    },
                    {
                        label: '测试数量',
                        data: totals,
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#fff' } }
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 100,
                        ticks: { color: '#00e676' },
                        grid: { color: 'rgba(0,230,118,0.1)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#2196f3' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },
    
    renderModelDistChart(data) {
        const canvas = document.getElementById('model-dist-chart');
        if (!canvas) return;
        
        if (this.modelChart) {
            this.modelChart.destroy();
        }
        
        if (!data || Object.keys(data).length === 0) {
            canvas.style.display = 'none';
            return;
        }
        canvas.style.display = 'block';
        
        const labels = Object.keys(data);
        const totals = labels.map(k => data[k].total);
        const passRates = labels.map(k => data[k].pass_rate);
        
        this.modelChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '测试数量',
                        data: totals,
                        backgroundColor: 'rgba(33, 150, 243, 0.7)',
                        yAxisID: 'y'
                    },
                    {
                        label: '通过率 (%)',
                        data: passRates,
                        type: 'line',
                        borderColor: '#00e676',
                        backgroundColor: 'transparent',
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#fff' } }
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#2196f3' },
                        grid: { color: 'rgba(33,150,243,0.1)' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        min: 0,
                        max: 100,
                        ticks: { color: '#00e676' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },
    
    renderStationTable(data) {
        const tbody = document.querySelector('#station-table tbody');
        if (!tbody) return;
        
        if (!data || Object.keys(data).length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">暂无数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = Object.entries(data).map(([station, stats]) => `
            <tr>
                <td>${station || '未知'}</td>
                <td>${stats.total}</td>
                <td style="color:#00e676">${stats.passed}</td>
                <td style="color:#ff5252">${stats.failed}</td>
                <td>${stats.pass_rate}%</td>
            </tr>
        `).join('');
    },
    
    // ==================== 固件对比 ====================
    
    async compareFirmware() {
        const select = document.getElementById('firmware-crc-select');
        const selectedOptions = Array.from(select.selectedOptions);
        
        if (selectedOptions.length < 1) {
            Utils.toast('请至少选择一个CRC版本', 'warning');
            return;
        }
        
        const crcs = selectedOptions.map(opt => parseInt(opt.value));
        
        try {
            const result = await pywebview.api.data_get_firmware_comparison(null, crcs);
            
            if (!result?.success) {
                Utils.toast(result?.error || '对比分析失败', 'error');
                return;
            }
            
            this.renderFirmwareComparison(result.comparison);
            
        } catch (e) {
            console.error('固件对比失败:', e);
            Utils.toast('对比失败: ' + e.message, 'error');
        }
    },
    
    renderFirmwareComparison(data) {
        const tbody = document.querySelector('#firmware-table tbody');
        if (!tbody) return;
        
        if (!data || Object.keys(data).length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">暂无数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = Object.entries(data).map(([version, stats]) => `
            <tr>
                <td style="font-family:monospace;color:var(--primary-color)">${version}</td>
                <td>${stats.total_tests}</td>
                <td style="color:#00e676">${stats.passed}</td>
                <td>${stats.pass_rate}%</td>
                <td>${stats.avg_error?.toFixed(3) || '--'}</td>
                <td>${stats.max_error?.toFixed(3) || '--'}</td>
                <td>${stats.min_error?.toFixed(3) || '--'}</td>
            </tr>
        `).join('');
        
        // 渲染对比图表
        this.renderFirmwareChart(data);
    },
    
    renderFirmwareChart(data) {
        const canvas = document.getElementById('firmware-compare-chart');
        if (!canvas) return;
        
        if (this.firmwareChart) {
            this.firmwareChart.destroy();
        }
        
        const labels = Object.keys(data);
        const passRates = labels.map(k => data[k].pass_rate);
        const avgErrors = labels.map(k => data[k].avg_error || 0);
        
        this.firmwareChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '通过率 (%)',
                        data: passRates,
                        backgroundColor: 'rgba(0, 230, 118, 0.7)',
                        yAxisID: 'y'
                    },
                    {
                        label: '平均误差 (mm)',
                        data: avgErrors,
                        backgroundColor: 'rgba(255, 107, 107, 0.7)',
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#fff' } }
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 100,
                        ticks: { color: '#00e676' },
                        title: { display: true, text: '通过率 (%)', color: '#00e676' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#ff6b6b' },
                        title: { display: true, text: '平均误差 (mm)', color: '#ff6b6b' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    },
    
    // ==================== 二维码功能 ====================
    
    // 当前生成的标签数据
    _currentLabel: null,
    _authToken: null,
    
    async generateQRCode() {
        const deviceId = document.getElementById('qr-device-id')?.value?.trim();
        const modelName = document.getElementById('qr-model-name')?.value?.trim();
        const labelSize = document.getElementById('qr-label-size')?.value || 'medium';
        
        if (!deviceId) {
            Utils.toast('请输入设备ID', 'warning');
            return;
        }
        
        try {
            Utils.toast('生成中...', 'info');
            
            const result = await pywebview.api.qrcode_generate_label(
                null, deviceId, modelName, labelSize
            );
            
            if (!result?.success) {
                Utils.toast(result?.error || '生成失败', 'error');
                return;
            }
            
            // 保存当前标签数据
            this._currentLabel = result;
            
            // 显示预览
            const preview = document.getElementById('qrcode-preview');
            preview.innerHTML = `<img src="${result.label}" alt="QR Label">`;
            
            Utils.toast('二维码已生成', 'success');
            
        } catch (e) {
            console.error('生成二维码失败:', e);
            Utils.toast('生成失败: ' + e.message, 'error');
        }
    },
    
    async downloadLabel() {
        if (!this._currentLabel?.label) {
            Utils.toast('请先生成二维码', 'warning');
            return;
        }
        
        try {
            // 调用后端保存图片
            const result = await pywebview.api.qrcode_save_label({
                label_base64: this._currentLabel.label,
                device_id_hex: this._currentLabel.device_id_hex || 'device'
            });
            
            if (result?.success) {
                Utils.toast(`已保存到: ${result.path}`, 'success');
            } else {
                Utils.toast(result?.error || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e.message, 'error');
        }
    },
    
    async refreshPrinters() {
        const select = document.getElementById('qr-printer-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">加载中...</option>';
        
        try {
            const result = await pywebview.api.qrcode_list_printers();
            
            if (!result?.success) {
                select.innerHTML = '<option value="">获取失败</option>';
                Utils.toast(result?.error || '获取打印机列表失败', 'error');
                return;
            }
            
            if (!result.printers || result.printers.length === 0) {
                select.innerHTML = '<option value="">未找到打印机</option>';
                return;
            }
            
            select.innerHTML = result.printers.map(p => 
                `<option value="${p.name}" ${p.is_default ? 'selected' : ''}>${p.name}${p.is_default ? ' (默认)' : ''}</option>`
            ).join('');
            
        } catch (e) {
            console.error('获取打印机列表失败:', e);
            select.innerHTML = '<option value="">获取失败</option>';
        }
    },
    
    async printLabel() {
        const deviceId = document.getElementById('qr-device-id')?.value?.trim();
        const modelName = document.getElementById('qr-model-name')?.value?.trim();
        const labelSize = document.getElementById('qr-label-size')?.value || 'medium';
        const printerName = document.getElementById('qr-printer-select')?.value;
        const copies = parseInt(document.getElementById('qr-copies')?.value) || 1;
        
        if (!deviceId) {
            Utils.toast('请输入设备ID', 'warning');
            return;
        }
        
        if (!printerName) {
            Utils.toast('请选择打印机', 'warning');
            return;
        }
        
        try {
            Utils.toast('正在打印...', 'info');
            
            const result = await pywebview.api.qrcode_print_label(
                null, deviceId, modelName, printerName, labelSize, copies
            );
            
            if (!result?.success) {
                Utils.toast(result?.error || '打印失败', 'error');
                return;
            }
            
            Utils.toast(result.message || '打印成功', 'success');
            
        } catch (e) {
            console.error('打印失败:', e);
            Utils.toast('打印失败: ' + e.message, 'error');
        }
    },
    
    async printTestPage() {
        const printerName = document.getElementById('qr-printer-select')?.value;
        
        if (!printerName) {
            Utils.toast('请选择打印机', 'warning');
            return;
        }
        
        try {
            Utils.toast('正在打印测试页...', 'info');
            
            const result = await pywebview.api.qrcode_print_test(printerName);
            
            if (!result?.success) {
                Utils.toast(result?.error || '打印失败', 'error');
                return;
            }
            
            Utils.toast(result.message || '测试页已发送', 'success');
            
        } catch (e) {
            console.error('打印测试页失败:', e);
            Utils.toast('打印失败: ' + e.message, 'error');
        }
    },
    
    async scanQuery() {
        const input = document.getElementById('qr-scan-input')?.value?.trim();
        
        if (!input) {
            Utils.toast('请输入扫描结果或设备ID', 'warning');
            return;
        }
        
        let deviceId = input;
        
        // 如果是二维码URL，先解析
        if (input.startsWith('greenlaser://')) {
            try {
                const parseResult = await pywebview.api.qrcode_parse_url(input);
                if (parseResult?.success) {
                    deviceId = parseResult.device_id_hex;
                } else {
                    Utils.toast('无效的二维码', 'error');
                    return;
                }
            } catch (e) {
                Utils.toast('解析二维码失败', 'error');
                return;
            }
        }
        
        // 检查是否已验证
        if (!this._authToken) {
            Utils.toast('请先验证密码', 'warning');
            document.getElementById('qr-current-password')?.focus();
            return;
        }
        
        try {
            Utils.toast('查询中...', 'info');
            
            const result = await pywebview.api.qrcode_get_device_trace(deviceId, null, this._authToken);
            
            if (!result?.success) {
                if (result?.need_auth) {
                    this._authToken = null;
                    this._updateAuthStatus(false, '令牌已过期，请重新验证');
                    return;
                }
                Utils.toast(result?.error || '查询失败', 'error');
                return;
            }
            
            // 切换到设备追溯Tab并显示结果
            this.switchTab('lifecycle');
            document.getElementById('trace-device-id').value = deviceId;
            await this.searchDevice();
            
            Utils.toast('查询成功', 'success');
            
        } catch (e) {
            console.error('查询失败:', e);
            Utils.toast('查询失败: ' + e.message, 'error');
        }
    },
    
    async verifyPassword() {
        const password = document.getElementById('qr-current-password')?.value;
        
        if (!password) {
            Utils.toast('请输入密码', 'warning');
            return;
        }
        
        try {
            const result = await pywebview.api.qrcode_verify_password(password);
            
            if (result?.success) {
                this._authToken = result.token;
                this._updateAuthStatus(true, '验证成功，有效期1小时');
                Utils.toast('密码验证成功', 'success');
            } else {
                this._authToken = null;
                this._updateAuthStatus(false, result?.error || '密码错误');
                Utils.toast('密码错误', 'error');
            }
            
        } catch (e) {
            console.error('验证失败:', e);
            Utils.toast('验证失败', 'error');
        }
    },
    
    async changePassword() {
        const newPassword = document.getElementById('qr-new-password')?.value;
        
        if (!newPassword || newPassword.length < 4) {
            Utils.toast('新密码长度至少4位', 'warning');
            return;
        }
        
        try {
            const result = await pywebview.api.qrcode_set_password(newPassword);
            
            if (result?.success) {
                this._authToken = null;
                this._updateAuthStatus(false, '密码已修改，请重新验证');
                document.getElementById('qr-new-password').value = '';
                Utils.toast('密码已修改', 'success');
            } else {
                Utils.toast(result?.error || '修改失败', 'error');
            }
            
        } catch (e) {
            console.error('修改密码失败:', e);
            Utils.toast('修改失败', 'error');
        }
    },
    
    _updateAuthStatus(success, message) {
        const status = document.getElementById('qr-auth-status');
        if (status) {
            status.className = 'auth-status ' + (success ? 'success' : 'error');
            status.textContent = message;
        }
    }
};
