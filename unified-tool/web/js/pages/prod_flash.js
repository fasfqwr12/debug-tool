/**
 * 生产 - 固件烧录页面
 * 烧录固件、追溯版本信息
 */

const ProdFlashPage = {
    currentFirmware: null,
    versions: [],
    flashLogs: [],
    flashStats: null,
    isFlashing: false,

    releaseStatus: null,

    async init() {
        console.log('ProdFlashPage init');
        await this.loadVersions();
        await this.loadStats();
        this.updateIsland('idle');

        // 生产锁定（Release）状态
        await this.refreshReleaseStatus();
    },

    destroy() {
        console.log('ProdFlashPage destroy');
    },

    async refreshReleaseStatus() {
        try {
            const st = await API.calibration.getReleaseStatus();
            this.releaseStatus = st;
            this.renderReleaseStatus();
        } catch (e) {
            this.releaseStatus = { error: String(e) };
            this.renderReleaseStatus();
        }
    },

    renderReleaseStatus() {
        const s = this.releaseStatus || {};
        const elLoaded = document.getElementById('prod-release-loaded');
        const elVer = document.getElementById('prod-release-version');
        const elModel = document.getElementById('prod-release-model');
        const elAppCrc = document.getElementById('prod-release-app-crc');
        const elProtoCrc = document.getElementById('prod-release-proto-crc');
        const elCheck = document.getElementById('prod-release-check');
        if (!elLoaded || !elVer || !elModel || !elAppCrc || !elProtoCrc || !elCheck) return;

        if (s.error) {
            elLoaded.textContent = '错误';
            elVer.textContent = '-';
            elModel.textContent = '-';
            elAppCrc.textContent = '-';
            elProtoCrc.textContent = '-';
            elCheck.textContent = s.error;
            return;
        }

        const loaded = !!s.loaded;
        elLoaded.textContent = loaded ? '已加载' : '未加载';
        elVer.textContent = s.release_version || '-';
        elProtoCrc.textContent = s.protocol_crc || '-';

        const d = s.last_check?.device || null;
        const model = d?.model_name || d?.model || '-';
        const appCrc = (d?.app_crc !== undefined && d?.app_crc !== null)
            ? ('0x' + Number(d.app_crc).toString(16).toUpperCase().padStart(8, '0'))
            : '-';
        elModel.textContent = model;
        elAppCrc.textContent = appCrc;

        const ok = s.last_check?.ok;
        const err = s.last_check?.error;
        if (loaded) {
            elCheck.textContent = ok ? '通过' : (err || '失败');
        } else {
            elCheck.textContent = '未启用（无release文件）';
        }
    },

    async updateReleaseFromDevice() {
        try {
            const res = await API.calibration.releaseUpdateFromDevice(null, 'prod');
            if (!res || res.success !== true) {
                Utils.toast('锁定失败: ' + (res?.error || ''), 'error');
                return;
            }
            Utils.toast('已锁定当前设备(model+CRC)', 'success');
            await this.refreshReleaseStatus();
        } catch (e) {
            Utils.toast('锁定失败: ' + e, 'error');
        }
    },

    async disableRelease() {
        try {
            const ok = await Utils.confirm('确定要解除锁定吗？解除后将不再校验机型/CRC（建议仅工程人员操作）');
            if (!ok) return;
            const res = await API.calibration.releaseDisable('rename');
            if (!res || res.success !== true) {
                Utils.toast('解除失败: ' + (res?.error || ''), 'error');
                return;
            }
            Utils.toast('已解除锁定', 'success');
            await this.refreshReleaseStatus();
        } catch (e) {
            Utils.toast('解除失败: ' + e, 'error');
        }
    },

    // 加载生产版本
    async loadVersions() {
        const result = await FirmwareService.getProductionVersions(null, true);
        if (result.success) {
            this.versions = result.versions;
            this.renderFirmwareList();
        }
    },

    exportTrace() {
        if (!this.currentFirmware) {
            Utils.toast('请先选择固件', 'warning');
            return;
        }
        try {
            const data = {
                firmware: this.currentFirmware,
                logs: this.flashLogs,
                exported_at: new Date().toISOString()
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `trace_${this.currentFirmware.project_id || 'project'}_${this.currentFirmware.version || 'v'}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            Utils.toast('追溯信息已导出', 'success');
        } catch (e) {
            Utils.toast('导出失败', 'error');
        }
    },

    // 加载统计
    async loadStats() {
        const result = await FirmwareService.getFlashStats(null, true);
        if (result.success) {
            this.flashStats = result.stats;
        }
    },

    // 渲染可用固件列表
    renderFirmwareList() {
        const container = document.getElementById('firmware-list');
        if (!container) return;

        const countEl = document.getElementById('firmware-count');
        if (countEl) countEl.textContent = String(this.versions.length);

        if (this.versions.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无可用固件<br><small>等待测试通过</small></div>';
            return;
        }

        container.innerHTML = this.versions.map(v => `
            <div class="firmware-item ${this.currentFirmware?.id === v.id ? 'active' : ''}"
                 onclick="ProdFlashPage.selectFirmware('${v.id}')">
                <div class="product">${v.project?.icon || '📦'} ${v.project?.name || ''}</div>
                <div class="version">
                    v${v.version}
                    ${v.is_active ? '<span class="active-badge">生产中</span>' : ''}
                </div>
                <div class="date">发布于 ${v.release_time || '--'}</div>
            </div>
        `).join('');
    },

    // 选择固件
    async selectFirmware(prodId) {
        this.currentFirmware = this.versions.find(v => v.id === prodId);
        if (!this.currentFirmware) return;

        // 更新列表选中状态
        document.querySelectorAll('.firmware-item').forEach(item => {
            item.classList.remove('active');
        });
        if (event?.currentTarget) {
            event.currentTarget.classList.add('active');
        }

        // 加载烧录日志
        const logsResult = await FirmwareService.getFlashLogs(this.currentFirmware.project_id, 10, true);
        if (logsResult.success) {
            this.flashLogs = logsResult.logs.filter(l => l.version === this.currentFirmware.version);
        }

        // 渲染烧录内容
        this.renderFlashContent();
        
        // 渲染追溯信息
        this.renderTraceInfo();

        // 显示操作岛
        const island = document.getElementById('flash-island');
        if (island) island.style.display = 'flex';
        this.updateIsland('ready');

        // 默认生成一个SN
        await this.regenerateSN();
    },

    updateIsland(state, opts = {}) {
        const island = document.getElementById('flash-island');
        const iconEl = document.getElementById('flash-status-icon');
        const textEl = document.getElementById('flash-status-text');
        const barEl = document.getElementById('flash-progress-bar');
        const fillEl = document.getElementById('flash-progress-fill');
        const btnEl = document.getElementById('flash-main-btn');

        if (!island) return;

        const pct = typeof opts.progress === 'number' ? Math.max(0, Math.min(100, opts.progress)) : null;

        if (state === 'idle') {
            if (iconEl) iconEl.textContent = '⏳';
            if (textEl) textEl.textContent = '请选择固件';
            if (barEl) barEl.style.display = 'none';
            if (fillEl) fillEl.style.width = '0%';
            if (btnEl) {
                btnEl.disabled = true;
                btnEl.textContent = '🔥 开始烧录';
            }
            return;
        }

        if (state === 'ready') {
            if (iconEl) iconEl.textContent = '✅';
            if (textEl) textEl.textContent = '就绪';
            if (barEl) barEl.style.display = 'none';
            if (fillEl) fillEl.style.width = '0%';
            if (btnEl) {
                btnEl.disabled = !this.currentFirmware || this.isFlashing;
                btnEl.textContent = this.isFlashing ? '⏳ 烧录中...' : '🔥 开始烧录';
            }
            return;
        }

        if (state === 'running') {
            if (iconEl) iconEl.textContent = '🔥';
            if (textEl) textEl.textContent = opts.text || '烧录中...';
            if (barEl) barEl.style.display = 'block';
            if (fillEl && pct !== null) fillEl.style.width = `${pct}%`;
            if (btnEl) {
                btnEl.disabled = true;
                btnEl.textContent = '⏳ 烧录中...';
            }
            return;
        }

        if (state === 'success') {
            if (iconEl) iconEl.textContent = '🎉';
            if (textEl) textEl.textContent = opts.text || '烧录成功';
            if (barEl) barEl.style.display = 'block';
            if (fillEl) fillEl.style.width = '100%';
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = '🔥 再次烧录';
            }
            return;
        }

        if (state === 'error') {
            if (iconEl) iconEl.textContent = '❌';
            if (textEl) textEl.textContent = opts.text || '烧录失败';
            if (barEl) barEl.style.display = 'block';
            if (fillEl) fillEl.style.width = '0%';
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.textContent = '🔁 重试烧录';
            }
        }
    },

    async startFlash() {
        if (this.isFlashing) return;
        if (!this.currentFirmware) {
            Utils.toast('请先选择固件', 'warning');
            return;
        }

        const sn = document.getElementById('prod-sn')?.value;
        if (!sn) {
            Utils.toast('请先生成序列号', 'warning');
            await this.regenerateSN();
            return;
        }

        this.isFlashing = true;
        this.updateIsland('running', { progress: 10, text: '准备中...' });

        try {
            // 复用原有逻辑（会调用真实烧录API）
            await this.flash();
        } finally {
            this.isFlashing = false;
            // flash() 内部会根据结果更新进度条，这里回到 ready 由 selectFirmware 决定
            if (this.currentFirmware) this.updateIsland('ready');
        }
    },

    // 渲染烧录内容
    renderFlashContent() {
        const container = document.getElementById('flash-content');
        if (!container || !this.currentFirmware) return;

        const v = this.currentFirmware;
        const build = v.build || {};
        const logs = this.flashLogs.slice(0, 5);

        container.innerHTML = `
            <div class="flash-header">
                <h2>${v.project?.icon || ''} ${v.project?.name || ''}</h2>
                <p>版本 ${v.version} · ${build.hex_file || '--'}</p>
            </div>

            <div class="flash-config">
                <div class="config-row">
                    <label>烧录工具</label>
                    <select id="flash-tool">
                        <option value="jlink">J-Link</option>
                        <option value="stlink">ST-Link</option>
                    </select>
                </div>
                <div class="config-row">
                    <label>芯片型号</label>
                    <select id="chip-model">
                        <option>${v.project?.chip || 'STM32F103C8'}</option>
                    </select>
                </div>
                <div class="config-row">
                    <label>产品序列号</label>
                    <input type="text" id="prod-sn" placeholder="点击生成" value="">
                    <button class="mini-btn" onclick="ProdFlashPage.regenerateSN()">生成</button>
                </div>
            </div>

            <button class="flash-btn" onclick="ProdFlashPage.startFlash()">
                🔥 开始烧录
            </button>

            <div class="flash-progress" id="flash-progress">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill"></div>
                </div>
                <div class="progress-text" id="progress-text">准备中...</div>
            </div>

            <div class="recent-flash">
                <h4>最近烧录记录</h4>
                <div class="flash-log">
                    ${logs.map(l => `
                        <div class="log-item ${l.success ? 'success' : 'error'}">
                            <span class="time">${(l.flash_time || '').split(' ')[1] || '--'}</span>
                            <span class="sn">${l.serial_number || '--'}</span>
                            <span class="status">${l.success ? '✓ 成功' : '✗ ' + (l.error_msg || '失败')}</span>
                        </div>
                    `).join('') || '<div class="empty-state">暂无记录</div>'}
                </div>
            </div>
        `;
    },

    // 渲染追溯信息（关联测试和研发数据）
    renderTraceInfo() {
        const container = document.getElementById('trace-info');
        if (!container || !this.currentFirmware) return;

        const v = this.currentFirmware;
        const test = v.test;

        container.innerHTML = `
            <div class="trace-card">
                <h4>🧪 测试信息</h4>
                <div class="trace-row"><span class="label">测试状态</span><span style="color:var(--primary-color)">✓ 通过</span></div>
                <div class="trace-row"><span class="label">测试人员</span><span>${test?.tester || '--'}</span></div>
                <div class="trace-row"><span class="label">测试时间</span><span>${test?.endTime || '--'}</span></div>
                <div class="trace-row"><span class="label">激光功率</span><span>${test?.data?.laserPower || '--'} mW</span></div>
                <div class="trace-row"><span class="label">电机精度</span><span>${test?.data?.motorAccuracy || '--'} °</span></div>
                <div class="trace-row"><span class="label">通讯延迟</span><span>${test?.data?.commDelay || '--'} ms</span></div>
                <div class="trace-row"><span class="label">测试备注</span><span>${test?.remark || '--'}</span></div>
                <button class="link-btn" onclick="ProdFlashPage.viewTest('${test?.id}')">
                    🧪 查看完整测试报告
                </button>
            </div>

            <div class="trace-card">
                <h4>💻 构建信息</h4>
                <div class="trace-row"><span class="label">Git提交</span><span>${v.gitCommit || '--'}</span></div>
                <div class="trace-row"><span class="label">分支</span><span>${v.gitBranch || '--'}</span></div>
                <div class="trace-row"><span class="label">构建时间</span><span>${v.buildTime || '--'}</span></div>
                <div class="trace-row"><span class="label">编译配置</span><span>${v.config || '--'}</span></div>
                <div class="trace-row"><span class="label">固件大小</span><span>${v.hexSize || '--'}</span></div>
                <button class="link-btn" onclick="ProdFlashPage.viewDev('${v.id}')">
                    💻 查看研发详情
                </button>
            </div>

            <div class="trace-card">
                <h4>📜 版本时间线</h4>
                <div class="trace-timeline">
                    <div class="timeline-item">
                        <span class="time">${v.buildTime?.split(' ')[0] || '--'}</span>
                        <span class="event">研发编译完成</span>
                    </div>
                    <div class="timeline-item">
                        <span class="time">${test?.submitTime?.split(' ')[0] || '--'}</span>
                        <span class="event">提交测试</span>
                    </div>
                    <div class="timeline-item">
                        <span class="time">${test?.endTime?.split(' ')[0] || '--'}</span>
                        <span class="event">测试通过</span>
                    </div>
                    ${v.production ? `
                    <div class="timeline-item">
                        <span class="time">${v.production.releaseTime?.split(' ')[0] || '--'}</span>
                        <span class="event">发布生产</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    },

    // 生成序列号
    async regenerateSN() {
        const snInput = document.getElementById('prod-sn');
        if (!snInput || !this.currentFirmware) return;
        
        const result = await FirmwareService.generateSN(this.currentFirmware.project_id);
        if (result.success) {
            snInput.value = result.serial_number;
        } else {
            // 本地生成备用
            const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
            snInput.value = `${this.currentFirmware.project_id || 'GL100'}-${date}-${seq}`;
        }
    },

    // 烧录
    async flash() {
        const sn = document.getElementById('prod-sn')?.value;
        if (!sn) {
            alert('请先生成序列号');
            await this.regenerateSN();
            return;
        }

        if (!this.currentFirmware) {
            alert('请先选择固件');
            return;
        }

        const tool = document.getElementById('flash-tool')?.value || 'jlink';
        const chip = document.getElementById('chip-model')?.value || 'STM32F103C8';

        const progressEl = document.getElementById('flash-progress');
        const fillEl = document.getElementById('progress-fill');
        const textEl = document.getElementById('progress-text');

        // 同步更新操作岛
        this.updateIsland('running', { progress: 30, text: '正在烧录...' });
        
        if (progressEl) progressEl.style.display = 'block';
        if (textEl) textEl.textContent = '正在烧录...';
        if (fillEl) fillEl.style.width = '50%';

        // 调用真实烧录API
        const result = await FirmwareService.flash(
            this.currentFirmware.project_id,
            this.currentFirmware.version,
            sn,
            tool,
            chip
        );

        if (result.success) {
            if (fillEl) fillEl.style.width = '100%';
            if (textEl) textEl.textContent = '烧录成功!';

            this.updateIsland('success', { text: '烧录成功', progress: 100 });
            
            setTimeout(async () => {
                if (progressEl) progressEl.style.display = 'none';
                if (fillEl) fillEl.style.width = '0%';
                
                // 刷新日志和生成新SN
                await this.selectFirmware(this.currentFirmware.id);
                await this.regenerateSN();
            }, 1000);
        } else {
            if (fillEl) fillEl.style.width = '0%';
            if (textEl) textEl.textContent = '烧录失败';
            this.updateIsland('error', { text: '烧录失败', progress: 0 });
            alert('烧录失败: ' + (result.error || result.message || '未知错误'));
            
            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
            }, 2000);
        }
    },

    // 跳转
    viewTest(testId) {
        switchPage('test_queue');
    },

    viewDev(buildId) {
        // 当前导航中没有 dev_project，先回到版本发布页
        switchPage('dev_release');
    }
};

window.ProdFlashPage = ProdFlashPage;
