/**
 * 设备控制页面模块
 */

const DevicePage = {
    refreshInterval: null,
    refreshMs: 3000,  // 3秒刷新（原1.5秒）
    selectMode: false,
    selectedIds: new Set(),
    
    // 设备图标
    icons: {
        'slipway': '📏',
        'rotary': '🎡',
        'lift': '🏗️'
    },
    
    // 初始化
    init() {
        this.selectedIds = new Set();
        this.selectMode = false;
        this.updateBatchBar();
        this.startAutoRefresh();
    },
    
    // 销毁
    destroy() {
        this.stopAutoRefresh();
    },
    
    // 开始自动刷新
    startAutoRefresh() {
        this.refresh();
        this.refreshInterval = setInterval(() => this.refresh(), this.refreshMs);
    },
    
    // 停止自动刷新
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    },
    
    // 刷新设备列表
    async refresh() {
        try {
            const devices = await API.device.list();
            this.render(devices);
        } catch (e) {
            console.error('刷新设备列表失败:', e);
        }
    },

    refreshAll() {
        this.refresh();
    },

    toggleSelectMode() {
        this.selectMode = !this.selectMode;
        if (!this.selectMode) {
            this.selectedIds.clear();
        }
        const btn = document.getElementById('select-mode-btn');
        if (btn) {
            btn.classList.toggle('active', this.selectMode);
            btn.textContent = this.selectMode ? '✅ 批量' : '☑️ 批量';
        }
        document.querySelectorAll('.device-card').forEach(card => {
            const id = card.dataset.deviceId;
            card.classList.toggle('selected', !!id && this.selectedIds.has(id));
        });
        this.updateBatchBar();
    },

    toggleSelectDevice(id) {
        if (!this.selectMode) return;
        if (this.selectedIds.has(id)) this.selectedIds.delete(id);
        else this.selectedIds.add(id);
        const card = document.getElementById(`card-${id}`);
        if (card) card.classList.toggle('selected', this.selectedIds.has(id));
        this.updateBatchBar();
    },

    updateBatchBar() {
        const bar = document.getElementById('batch-bar');
        const countEl = document.getElementById('selected-count');
        if (countEl) countEl.textContent = String(this.selectedIds.size);
        if (bar) bar.style.display = this.selectMode ? 'flex' : 'none';
    },
    
    // 渲染设备卡片
    render(devices) {
        const motionContainer = document.getElementById('motion-devices');
        const measureContainer = document.getElementById('measure-devices');
        const otherContainer = document.getElementById('other-devices');
        if (!motionContainer || !measureContainer || !otherContainer) return;

        // 清空（数量通常不大，先走简单实现）
        motionContainer.innerHTML = '';
        measureContainer.innerHTML = '';
        otherContainer.innerHTML = '';

        const motion = [];
        const measure = [];
        const other = [];

        (devices || []).forEach(dev => {
            if (dev.type === 'slipway' || dev.type === 'rotary' || dev.type === 'lift') motion.push(dev);
            else if (dev.type === 'measure' || dev.type === 'sensor') measure.push(dev);
            else other.push(dev);
        });

        const setCount = (id, n) => {
            const el = document.getElementById(id);
            if (el) el.textContent = String(n);
        };
        setCount('motion-count', motion.length);
        setCount('measure-count', measure.length);
        setCount('other-count', other.length);

        const appendGroup = (container, list) => {
            if (list.length === 0) {
                container.innerHTML = '<div class="empty-devices">暂无设备</div>';
                return;
            }
            list.forEach(dev => {
                const card = this.createCard(dev);
                container.appendChild(card);
            });
        };

        appendGroup(motionContainer, motion);
        appendGroup(measureContainer, measure);
        appendGroup(otherContainer, other);
    },
    
    // 创建设备卡片
    createCard(dev) {
        const card = document.createElement('div');
        card.className = 'device-card';
        card.id = `card-${dev.id}`;
        card.dataset.deviceId = dev.id;
        if (this.selectMode && this.selectedIds.has(dev.id)) {
            card.classList.add('selected');
        }
        card.addEventListener('click', (e) => {
            // 选中模式下：点击卡片就是选中/取消
            if (this.selectMode) {
                e.preventDefault();
                this.toggleSelectDevice(dev.id);
            }
        });

        const statusClass = dev.connected ? 'online' : '';
        const isBusy = (dev.state && String(dev.state).toLowerCase() !== 'idle' && String(dev.state).toLowerCase() !== '空闲');
        const dotClass = isBusy ? 'busy' : statusClass;

        const defaultPort = localStorage.getItem('default_port') || 'COM1';
        const defaultBaud = parseInt(localStorage.getItem('default_baudrate') || '115200');
        
        card.innerHTML = `
            <div class="card-header">
                <div class="device-icon">${this.icons[dev.type] || '🤖'}</div>
                <div class="device-name">${dev.name || dev.id}</div>
                <div class="status-dot ${dotClass}"></div>
            </div>

            <div class="device-info">
                <div class="info-row"><span>类型</span><span>${dev.type || '--'}</span></div>
                <div class="info-row"><span>位置</span><span>${(dev.position || 0).toFixed(3)}</span></div>
                <div class="info-row"><span>状态</span><span>${dev.connected ? (dev.state || '空闲') : '离线'}</span></div>
            </div>

            <div class="card-actions" onclick="event.stopPropagation()">
                ${dev.connected
                    ? `
                        <button class="action-btn" onclick="DevicePage.disconnect('${dev.id}')">断开</button>
                        <button class="action-btn" onclick="DevicePage.home('${dev.id}')">复位</button>
                        <button class="action-btn primary" onclick="DevicePage.stop('${dev.id}')">停止</button>
                      `
                    : `
                        <button class="action-btn primary" onclick="DevicePage.connect('${dev.id}', '${defaultPort}', ${defaultBaud})">连接</button>
                      `
                }
            </div>
        `;
        
        return card;
    },
    
    // === 操作方法 ===
    
    async connect(id, port, baudrate) {
        const res = await API.device.connect(id, port, baudrate);
        if (!res.success) {
            Utils.toast(res.message || res.error || '连接失败', 'error');
        } else {
            Utils.toast('连接成功', 'success');
        }
        await this.refresh();
    },

    async disconnect(id) {
        const res = await API.device.disconnect(id);
        if (!res.success) {
            Utils.toast(res.message || res.error || '断开失败', 'error');
        } else {
            Utils.toast('已断开', 'info');
        }
        await this.refresh();
    },
    
    async home(id) {
        if (!await Utils.confirm('确定要复位该设备吗？')) return;
        
        const res = await API.device.home(id);
        if (res.success) {
            Utils.toast('正在复位...', 'info');
        } else {
            Utils.toast(res.message, 'error');
        }
    },
    
    async stop(id) {
        await API.device.stop(id);
        Utils.toast('已停止', 'warning');
        await this.refresh();
    },

    async batchConnect() {
        if (this.selectedIds.size === 0) return;
        const port = localStorage.getItem('default_port') || 'COM1';
        const baud = parseInt(localStorage.getItem('default_baudrate') || '115200');
        for (const id of this.selectedIds) {
            await this.connect(id, port, baud);
        }
    },

    async batchDisconnect() {
        if (this.selectedIds.size === 0) return;
        for (const id of this.selectedIds) {
            await this.disconnect(id);
        }
    },

    async batchReset() {
        if (this.selectedIds.size === 0) return;
        if (!await Utils.confirm(`将复位 ${this.selectedIds.size} 个设备，是否继续？`)) return;
        for (const id of this.selectedIds) {
            await this.home(id);
        }
    }
};

window.DevicePage = DevicePage;
