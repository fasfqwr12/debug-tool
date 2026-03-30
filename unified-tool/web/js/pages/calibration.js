/**
 * 校准测试页面模块
 */

const CalibrationPage = {
    templates: [],
    selectedTemplate: null,
    testRunning: false,
    results: [],
    
    async init() {
        await this.loadTemplates();
        this.bindEvents();
    },
    
    destroy() {},
    
    bindEvents() {
        // 监听后端事件
        document.addEventListener('backend:test_progress', (e) => this.onProgress(e.detail));
        document.addEventListener('backend:test_complete', (e) => this.onComplete(e.detail));
        document.addEventListener('backend:test_error', (e) => this.onError(e.detail));
    },
    
    async loadTemplates() {
        try {
            this.templates = await API.calibration.getTemplates();
            this.renderTemplates();
        } catch (e) {
            console.error('加载测试模板失败:', e);
        }
    },
    
    renderTemplates() {
        const container = document.getElementById('test-templates');
        if (!container) return;
        
        container.innerHTML = this.templates.map(t => `
            <div class="template-card ${this.selectedTemplate?.id === t.id ? 'selected' : ''}"
                 onclick="CalibrationPage.selectTemplate('${t.id}')">
                <div class="template-icon">📊</div>
                <div class="template-info">
                    <div class="template-name">${t.name}</div>
                    <div class="template-desc">${t.description}</div>
                </div>
            </div>
        `).join('');
    },
    
    selectTemplate(id) {
        this.selectedTemplate = this.templates.find(t => t.id === id);
        this.renderTemplates();
        this.showParams();
    },
    
    showParams() {
        const container = document.getElementById('test-params');
        if (!container || !this.selectedTemplate) return;
        
        const params = this.selectedTemplate.params || {};
        
        container.innerHTML = `
            <h4>测试参数</h4>
            ${Object.entries(params).map(([key, value]) => `
                <div class="param-row">
                    <label>${key}</label>
                    <input type="text" id="param-${key}" value="${JSON.stringify(value)}" 
                           class="param-input">
                </div>
            `).join('')}
            <button class="btn btn-primary" onclick="CalibrationPage.startTest()" 
                    ${this.testRunning ? 'disabled' : ''}>
                ${this.testRunning ? '测试中...' : '▶ 开始测试'}
            </button>
        `;
    },
    
    async startTest() {
        if (!this.selectedTemplate) {
            Utils.toast('请选择测试模板', 'warning');
            return;
        }
        
        if (this.testRunning) return;
        
        // 收集参数
        const params = {};
        Object.keys(this.selectedTemplate.params).forEach(key => {
            const input = document.getElementById(`param-${key}`);
            if (input) {
                try {
                    params[key] = JSON.parse(input.value);
                } catch {
                    params[key] = input.value;
                }
            }
        });
        
        try {
            const res = await API.calibration.startTest(this.selectedTemplate.id, params);
            if (res.success) {
                this.testRunning = true;
                this.results = [];
                this.updateProgress(0);
                Utils.toast('测试已开始', 'info');
                this.showParams(); // 更新按钮状态
            } else {
                Utils.toast(res.message || '启动失败', 'error');
            }
        } catch (e) {
            Utils.toast('启动测试失败', 'error');
        }
    },
    
    async stopTest() {
        try {
            await API.calibration.stopTest();
            this.testRunning = false;
            Utils.toast('测试已停止', 'warning');
            this.showParams();
        } catch (e) {
            Utils.toast('停止失败', 'error');
        }
    },
    
    onProgress(data) {
        this.results.push(data.result);
        this.updateProgress(data.percent);
        this.renderResults();
    },
    
    onComplete(data) {
        this.testRunning = false;
        this.results = data.results;
        this.showParams();
        this.renderResults();
        this.renderStats(data.stats);
        Utils.toast('测试完成！', 'success');
    },
    
    onError(data) {
        this.testRunning = false;
        this.showParams();
        Utils.toast(`测试错误: ${data.message}`, 'error');
    },
    
    updateProgress(percent) {
        const bar = document.getElementById('test-progress-bar');
        const text = document.getElementById('test-progress-text');
        
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.textContent = `${percent}%`;
    },
    
    renderResults() {
        const container = document.getElementById('test-results');
        if (!container) return;
        
        if (this.results.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无测试数据</div>';
            return;
        }
        
        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>步骤</th>
                        <th>目标</th>
                        <th>实际</th>
                        <th>误差</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.results.map(r => `
                        <tr>
                            <td>${r.step}</td>
                            <td>${r.target.toFixed(3)}</td>
                            <td>${r.actual.toFixed(3)}</td>
                            <td class="${Math.abs(r.error) > 0.01 ? 'error-high' : 'error-low'}">${r.error.toFixed(4)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    },
    
    renderStats(stats) {
        const container = document.getElementById('test-stats');
        if (!container || !stats) return;
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.max_error?.toFixed(4) || '--'}</div>
                    <div class="stat-label">最大误差</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.min_error?.toFixed(4) || '--'}</div>
                    <div class="stat-label">最小误差</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.avg_error?.toFixed(4) || '--'}</div>
                    <div class="stat-label">平均误差</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.std_error?.toFixed(4) || '--'}</div>
                    <div class="stat-label">标准差</div>
                </div>
            </div>
        `;
    },
    
    async generateReport(format = 'json') {
        if (this.results.length === 0) {
            Utils.toast('没有可导出的数据', 'warning');
            return;
        }
        
        try {
            const res = await API.calibration.generateReport(format);
            if (res.success) {
                Utils.toast(`报告已生成: ${res.filename}`, 'success');
            } else {
                Utils.toast(res.message || '生成失败', 'error');
            }
        } catch (e) {
            Utils.toast('生成报告失败', 'error');
        }
    },
    
    async loadReports() {
        try {
            const reports = await API.calibration.getReports();
            this.renderReports(reports);
        } catch (e) {
            console.error('加载报告列表失败:', e);
        }
    },
    
    renderReports(reports) {
        const container = document.getElementById('reports-list');
        if (!container) return;
        
        if (reports.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无报告</div>';
            return;
        }
        
        container.innerHTML = reports.map(r => `
            <div class="report-item">
                <span class="report-name">${r.filename}</span>
                <span class="report-date">${r.modified}</span>
            </div>
        `).join('');
    }
};

window.CalibrationPage = CalibrationPage;
