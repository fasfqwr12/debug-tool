/**
 * 层级状态机编辑器 - 优化版
 * 修复: 树同步、LCD交互、连线美化、可搜索下拉
 * 性能优化: requestAnimationFrame、防抖、自动布局
 */

// ========== 性能监测工具 ==========
window.HSMPerf = {
    enabled: false,
    samples: [],
    maxSamples: 100,
    
    // 开启性能监测
    start() {
        this.enabled = true;
        this.samples = [];
        console.log('%c[HSM性能监测] 已开启', 'color: #22c55e; font-weight: bold');
        this.showPanel();
    },
    
    // 关闭性能监测
    stop() {
        this.enabled = false;
        this.hidePanel();
        console.log('%c[HSM性能监测] 已关闭', 'color: #ef4444; font-weight: bold');
    },
    
    // 记录耗时
    mark(name) {
        if (!this.enabled) return { end: () => {} };
        const start = performance.now();
        return {
            end: () => {
                const duration = performance.now() - start;
                this.record(name, duration);
            }
        };
    },
    
    // 记录数据
    record(name, duration) {
        if (!this.enabled) return;
        
        if (!this.samples[name]) {
            this.samples[name] = [];
        }
        this.samples[name].push(duration);
        if (this.samples[name].length > this.maxSamples) {
            this.samples[name].shift();
        }
        
        // 更新面板
        this.updatePanel();
    },
    
    // 获取统计
    getStats(name) {
        const data = this.samples[name] || [];
        if (data.length === 0) return null;
        
        const sum = data.reduce((a, b) => a + b, 0);
        const avg = sum / data.length;
        const max = Math.max(...data);
        const min = Math.min(...data);
        const last = data[data.length - 1];
        
        return { avg, max, min, last, count: data.length };
    },
    
    // 显示面板
    showPanel() {
        let panel = document.getElementById('hsm-perf-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'hsm-perf-panel';
            panel.style.cssText = `
                position: fixed;
                top: 10px;
                right: 10px;
                width: 320px;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid #3b82f6;
                border-radius: 8px;
                padding: 12px;
                font-family: monospace;
                font-size: 11px;
                color: #e2e8f0;
                z-index: 99999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            `;
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-weight:bold;color:#3b82f6;">📊 HSM 性能监测</span>
                    <button onclick="HSMPerf.stop()" style="background:#ef4444;border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;">关闭</button>
                </div>
                <div id="hsm-perf-content"></div>
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid #334155;">
                    <button onclick="HSMPerf.clear()" style="background:#475569;border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;margin-right:4px;">清除</button>
                    <button onclick="HSMPerf.report()" style="background:#3b82f6;border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;">控制台报告</button>
                </div>
            `;
            document.body.appendChild(panel);
        }
        panel.style.display = 'block';
    },
    
    // 隐藏面板
    hidePanel() {
        const panel = document.getElementById('hsm-perf-panel');
        if (panel) panel.style.display = 'none';
    },
    
    // 更新面板
    updatePanel() {
        const content = document.getElementById('hsm-perf-content');
        if (!content) return;
        
        const names = Object.keys(this.samples).sort();
        let html = '<table style="width:100%;border-collapse:collapse;">';
        html += '<tr style="color:#94a3b8;"><th style="text-align:left;">操作</th><th>最近</th><th>平均</th><th>最大</th></tr>';
        
        for (const name of names) {
            const stats = this.getStats(name);
            if (!stats) continue;
            
            const color = stats.last > 16 ? '#ef4444' : (stats.last > 8 ? '#f59e0b' : '#22c55e');
            html += `<tr>
                <td style="padding:2px 0;">${name}</td>
                <td style="text-align:right;color:${color};">${stats.last.toFixed(1)}ms</td>
                <td style="text-align:right;">${stats.avg.toFixed(1)}ms</td>
                <td style="text-align:right;color:#f59e0b;">${stats.max.toFixed(1)}ms</td>
            </tr>`;
        }
        html += '</table>';
        
        // FPS计算
        const renderStats = this.getStats('render');
        if (renderStats) {
            const fps = Math.round(1000 / renderStats.avg);
            const fpsColor = fps >= 55 ? '#22c55e' : (fps >= 30 ? '#f59e0b' : '#ef4444');
            html += `<div style="margin-top:8px;padding:4px;background:#1e293b;border-radius:4px;">
                <span>估算帧率: </span><span style="color:${fpsColor};font-weight:bold;">${fps} FPS</span>
                <span style="color:#64748b;margin-left:8px;">(目标: 60 FPS)</span>
            </div>`;
        }
        
        content.innerHTML = html;
    },
    
    // 清除数据
    clear() {
        this.samples = [];
        this.updatePanel();
    },
    
    // 输出报告
    report() {
        console.log('%c========== HSM 性能报告 ==========', 'color: #3b82f6; font-weight: bold; font-size: 14px');
        const names = Object.keys(this.samples).sort();
        for (const name of names) {
            const stats = this.getStats(name);
            if (!stats) continue;
            console.log(`%c${name}%c: 平均 ${stats.avg.toFixed(2)}ms, 最大 ${stats.max.toFixed(2)}ms, 最小 ${stats.min.toFixed(2)}ms (${stats.count}次采样)`,
                'color: #22c55e', 'color: inherit');
        }
        console.log('%c=====================================', 'color: #3b82f6; font-weight: bold');
    }
};

// 快捷命令
console.log('%c[HSM] 性能监测命令: HSMPerf.start() 开启, HSMPerf.stop() 关闭', 'color: #64748b');

window.HSM = {
    state: {
        machine: null,
        lcdConfig: null,
        actionsConfig: null,
        componentsConfig: null,  // 组件配置
        presetsConfig: null,     // 界面预设库
        animationsConfig: null,  // 动画效果库
        macrosConfig: null,      // 宏动作库
        currentPath: ['ROOT'],
        selectedNode: null,
        selectedTransition: null,  // 选中的转移线
        zoom: 1,
        panX: 50,
        panY: 50,
        isDragging: false,
        dragTarget: null,
        dragStartX: 0,
        dragStartY: 0,
        currentTool: 'select',
        // LCD交互
        lcdScale: 1,
        lcdOffsetX: 0,
        lcdOffsetY: 0,
        clipboard: null,        // 复制的节点
        clipboardType: null,    // 'node' 或 'transition'
        contextMenuX: 0,        // 右键菜单位置
        contextMenuY: 0,
    },
    
    // 性能优化：防抖定时器
    _renderRAF: null,
    _lcdPreviewTimer: null,
    _selectTimer: null,
    
    // 性能优化：缓存
    _cachedContainer: null,
    _cachedPath: null,
    _cachedPositions: null,
    
    // 组件API动作类型
    COMPONENT_ACTIONS: {
        setValue: { name: '设置值', desc: '设置组件显示值', params: ['component', 'value'] },
        setMode: { name: '设置模式', desc: '切换模式选择器', params: ['component', 'mode'] },
        setLevel: { name: '设置等级', desc: '设置等级指示器', params: ['component', 'level'] },
        setVisible: { name: '设置可见', desc: '显示/隐藏组件', params: ['component', 'visible'] },
        startBehavior: { name: '启动行为', desc: '启动闪烁/动画', params: ['behavior'] },
        stopBehavior: { name: '停止行为', desc: '停止闪烁/动画', params: ['behavior'] },
        showPreset: { name: '显示预设', desc: '显示预设值(如-----)', params: ['component', 'preset'] },
    },
    
    canvas: null,
    ctx: null,
    lcdCanvas: null,
    lcdCtx: null,
    
    levelColors: {
        0: { bg: '#ef444430', border: '#ef4444', text: '#ef4444' },
        1: { bg: '#f59e0b30', border: '#f59e0b', text: '#f59e0b' },
        2: { bg: '#3b82f630', border: '#3b82f6', text: '#3b82f6' },
        3: { bg: '#22c55e30', border: '#22c55e', text: '#22c55e' },
        4: { bg: '#8b5cf630', border: '#8b5cf6', text: '#8b5cf6' },
    },
    
    // 当前激活的Tab
    currentTab: 'props',
    
    // Tab切换
    switchTab(tabId) {
        this.currentTab = tabId;
        
        // 更新Tab按钮状态
        document.querySelectorAll('.hsm-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        
        // 更新Tab内容显示
        document.querySelectorAll('.hsm-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `hsm-tab-${tabId}`);
        });
    },
    
    // ========== 初始化 ==========
    async init() {
        console.log('[HSM] 初始化');
        
        this.canvas = document.getElementById('hsm-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.setupCanvasEvents();
        }
        
        this.lcdCanvas = document.getElementById('hsm-lcd-canvas');
        if (this.lcdCanvas) {
            this.lcdCtx = this.lcdCanvas.getContext('2d');
            this.setupLcdEvents();
        }
        
        await this.initDeviceManager();
        await this.loadAllConfigs();
        await this.initLcdRuntime();  // 初始化LCD运行时
        await this.initAnimController();  // 初始化动画控制器
        this.setupToolbar();
        this.resizeCanvas();
        this.render();
        
        console.log('[HSM] 初始化完成');
    },
    
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            const container = document.getElementById('hsm-device-selector');
            if (container && typeof createDeviceSelector === 'function') {
                createDeviceSelector('hsm-device-selector', {
                    onChange: () => this.loadAllConfigs(),
                    showAdd: false,
                    showManage: true
                });
            }
            
            DeviceConfigManager.subscribe('device-changed', () => this.loadAllConfigs());
            DeviceConfigManager.subscribe('lcd-updated', () => this.loadLcdConfig());
            DeviceConfigManager.subscribe('components-updated', () => this.loadComponentsConfig());
            DeviceConfigManager.subscribe('actions-updated', () => this.loadActionsConfig());
            DeviceConfigManager.subscribe('presets-updated', () => this.loadPresetsConfig());
            DeviceConfigManager.subscribe('animations-updated', () => this.loadAnimationsConfig());
        }
    },
    
    // ========== 配置加载 ==========
    async loadAllConfigs() {
        await Promise.all([
            this.loadStateMachine(),
            this.loadLcdConfig(),
            this.loadActionsConfig(),
            this.loadComponentsConfig(),
            this.loadPresetsConfig(),
            this.loadAnimationsConfig(),
            this.loadMacrosConfig()
        ]);
        
        this.renderTree();
        this.renderEvents();
        this.render();
        this.renderLcdPreview();
    },
    
    async loadStateMachine() {
        try {
            const data = await DeviceConfigManager.loadConfig('ui');
            if (data?.hierarchy) {
                this.state.machine = data;
                console.log('[HSM] 状态机加载:', data.name);
            } else {
                this.state.machine = this.createDefaultMachine();
            }
        } catch (e) {
            console.warn('[HSM] 加载状态机失败:', e);
            this.state.machine = this.createDefaultMachine();
        }
    },
    
    async loadLcdConfig() {
        try {
            const data = await DeviceConfigManager.loadLcdProject();
            if (data?.elements) {
                this.state.lcdConfig = data;
                console.log('[HSM] LCD配置:', data.elements.length, '元素');
                
                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.state.lcdImage = img;
                        this.renderLcdPreview();
                    };
                    img.src = data.image;
                }
            }
        } catch (e) {
            console.warn('[HSM] 加载LCD失败:', e);
        }
    },
    
    async loadActionsConfig() {
        try {
            const data = await DeviceConfigManager.loadActions();
            if (data) {
                this.state.actionsConfig = data;
                console.log('[HSM] 动作库加载');
            }
        } catch (e) {
            console.warn('[HSM] 加载动作库失败:', e);
        }
    },
    
    async loadComponentsConfig() {
        try {
            const data = await DeviceConfigManager.loadConfig('components');
            if (data) {
                this.state.componentsConfig = data;
                console.log('[HSM] 组件配置加载:', 
                    Object.keys(data.components || {}).length, '组件,',
                    Object.keys(data.behaviors || {}).length, '行为');
            }
        } catch (e) {
            console.warn('[HSM] 加载组件配置失败:', e);
            this.state.componentsConfig = { components: {}, behaviors: {} };
        }
    },
    
    async loadPresetsConfig() {
        try {
            const data = await DeviceConfigManager.loadConfig('presets');
            if (data?.presets) {
                this.state.presetsConfig = data;
                console.log('[HSM] 界面预设加载:', Object.keys(data.presets).length, '个预设');
            }
        } catch (e) {
            console.warn('[HSM] 加载界面预设失败:', e);
            this.state.presetsConfig = { presets: {} };
        }
    },
    
    async loadAnimationsConfig() {
        try {
            const data = await DeviceConfigManager.loadConfig('animations');
            if (data?.animations) {
                this.state.animationsConfig = data;
                console.log('[HSM] 动画效果加载:', Object.keys(data.animations).length, '个动画');
            }
        } catch (e) {
            console.warn('[HSM] 加载动画效果失败:', e);
            this.state.animationsConfig = { animations: {} };
        }
    },
    
    async loadMacrosConfig() {
        try {
            const data = await DeviceConfigManager.loadConfig('macros');
            if (data?.macros) {
                this.state.macrosConfig = data;
                console.log('[HSM] 宏动作加载:', Object.keys(data.macros).length, '个宏');
            }
        } catch (e) {
            console.warn('[HSM] 加载宏动作失败:', e);
            this.state.macrosConfig = { macros: {} };
        }
    },
    
    createDefaultMachine() {
        return {
            device: DeviceConfigManager?.getCurrentDevice() || 'unknown',
            name: '新状态机',
            version: '2.0',
            hierarchy: {
                ROOT: { id: 'ROOT', label: '根', type: 'compound', level: 0, children: {} }
            },
            transitions: [],
            nodePositions: { ROOT: {} }
        };
    },
    
    async save() {
        if (!this.state.machine) return;
        try {
            this.state.machine.saveTime = new Date().toISOString();
            await DeviceConfigManager.saveConfig('ui', this.state.machine);
            this.showToast('保存成功', 'success');
        } catch (e) {
            this.showToast('保存失败: ' + e.message, 'error');
        }
    },
    
    // ========== 画布事件 ==========
    setupCanvasEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('click', (e) => this.hideContextMenu(e));
        window.addEventListener('resize', () => { this.resizeCanvas(); this.render(); });
    },
    
    // 右键菜单
    onContextMenu(e) {
        e.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.state.panX) / this.state.zoom;
        const y = (e.clientY - rect.top - this.state.panY) / this.state.zoom;
        
        // 保存点击位置用于创建状态
        this.state.contextMenuX = x;
        this.state.contextMenuY = y;
        
        const node = this.findNodeAt(x, y);
        const trans = node ? null : this.findTransitionAt(x, y);
        this.showContextMenu(e.clientX, e.clientY, node, trans);
    },
    
    showContextMenu(screenX, screenY, node, trans) {
        this.hideContextMenu();
        
        const menu = document.createElement('div');
        menu.id = 'hsm-context-menu';
        menu.className = 'hsm-context-menu';
        
        let items = [];
        
        if (node) {
            // 点击在节点上
            this.selectNode(node);
            this.state.selectedTransition = null;
            items = [
                { icon: '✏️', label: '重命名', shortcut: 'F2', action: () => this.renameNode(node) },
                { icon: '📋', label: '复制', shortcut: 'Ctrl+C', action: () => this.copyNode(node) },
                { divider: true },
                { icon: '⚡', label: '添加入口动作', action: () => this.showAddDialog('entry') },
                { icon: '🚪', label: '添加退出动作', action: () => this.showAddDialog('exit') },
                { icon: '⏱️', label: '添加超时事件', action: () => this.addTimeoutEvent(node) },
                { divider: true },
                { icon: '➡️', label: '添加转移', action: () => this.startConnectFrom(node) },
                { icon: '🎯', label: '设为初始状态', action: () => this.setInitialState(node) },
                { icon: '📦', label: node.type === 'compound' ? '转为原子状态' : '转为复合状态', 
                  action: () => this.toggleNodeType(node) },
                { divider: true },
                { icon: '🗑️', label: '删除', shortcut: 'Del', action: () => this.deleteNode(node), danger: true },
            ];
            
            if (node.type === 'compound') {
                items.splice(3, 0, { icon: '📂', label: '进入子状态', action: () => this.enterNode(node) });
            }
        } else if (trans) {
            // 点击在转移线上
            this.selectTransition(trans);
            items = [
                { icon: '✏️', label: '编辑事件', action: () => this.editTransition(trans) },
                { icon: '📋', label: '复制', shortcut: 'Ctrl+C', action: () => this.copyTransition(trans) },
                { icon: '⚡', label: '添加转移动作', action: () => this.showAddTransitionAction() },
                { divider: true },
                { icon: '🔄', label: '反转方向', action: () => this.reverseTransition(trans) },
                { divider: true },
                { icon: '🗑️', label: '删除', shortcut: 'Del', action: () => this.deleteSelectedTransition(), danger: true },
            ];
        } else {
            // 点击在空白处
            items = [
                { icon: '➕', label: '新建原子状态', action: () => this.createStateAt(this.state.contextMenuX, this.state.contextMenuY, 'atomic') },
                { icon: '📦', label: '新建复合状态', action: () => this.createStateAt(this.state.contextMenuX, this.state.contextMenuY, 'compound') },
                { divider: true },
                { icon: '📋', label: '粘贴', shortcut: 'Ctrl+V', action: () => {
                    if (this.state.clipboardType === 'node') this.pasteNode();
                    else if (this.state.clipboardType === 'transition') this.pasteTransition();
                }, disabled: !this.state.clipboard },
                { divider: true },
                { icon: '📐', label: '当前层布局', shortcut: 'L', action: () => this.autoLayout() },
                { icon: '🌐', label: '全部自动布局', shortcut: 'Shift+L', action: () => this.autoLayoutAll() },
                { icon: '🔍', label: '适应视图', shortcut: 'F', action: () => this.fitView() },
                { icon: '🔄', label: '重置视图', shortcut: '0', action: () => this.resetView() },
            ];
        }
        
        menu.innerHTML = items.map(item => {
            if (item.divider) {
                return '<div class="hsm-context-divider"></div>';
            }
            return `
                <div class="hsm-context-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}"
                     onclick="HSM.executeContextAction(${items.indexOf(item)})">
                    <span class="icon">${item.icon}</span>
                    <span class="label">${item.label}</span>
                    ${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ''}
                </div>
            `;
        }).join('');
        
        // 保存actions供执行
        this._contextActions = items;
        
        // 定位菜单
        menu.style.left = screenX + 'px';
        menu.style.top = screenY + 'px';
        document.body.appendChild(menu);
        
        // 确保菜单不超出屏幕
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = (screenX - menuRect.width) + 'px';
        }
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = (screenY - menuRect.height) + 'px';
        }
    },
    
    hideContextMenu(e) {
        const menu = document.getElementById('hsm-context-menu');
        if (menu && (!e || !menu.contains(e.target))) {
            menu.remove();
        }
    },
    
    executeContextAction(index) {
        const action = this._contextActions?.[index];
        if (action && action.action && !action.disabled) {
            action.action();
        }
        this.hideContextMenu();
    },
    
    onMouseDown(e) {
        const perfMouseDown = HSMPerf.mark('mouseDown');
        
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.state.panX) / this.state.zoom;
        const y = (e.clientY - rect.top - this.state.panY) / this.state.zoom;
        
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        
        const perfFind = HSMPerf.mark('findNodeAt');
        const node = this.findNodeAt(x, y);
        perfFind.end();
        
        if (this.state.currentTool === 'connect' && node) {
            this.state.connectFrom = node;
            perfMouseDown.end();
            return;
        }
        
        if (node) {
            // 快速选中 - 只更新状态和重绘画布，延迟更新属性面板
            this.state.selectedNode = node;
            this.state.selectedTransition = null;
            this.state.isDragging = true;
            this.state.dragTarget = 'node';
            this._doRender(); // 立即重绘
            this.highlightTreeNode(node?.id);
            
            // 延迟更新属性面板和LCD预览
            if (this._selectTimer) clearTimeout(this._selectTimer);
            this._selectTimer = setTimeout(() => {
                if (this.state.selectedNode === node && !this.state.isDragging) {
                    const perfProps = HSMPerf.mark('renderProperties');
                    this.renderProperties(node);
                    perfProps.end();
                    
                    const perfLcd = HSMPerf.mark('renderLcdPreview');
                    this.renderLcdPreview(node);
                    perfLcd.end();
                    
                    if (this.currentTab !== 'props') {
                        this.switchTab('props');
                    }
                }
            }, 150);
        } else {
            // 检查是否点击了转移线
            const trans = this.findTransitionAt(x, y);
            if (trans) {
                this.selectTransition(trans);
                this.state.selectedNode = null;
            } else {
                this.state.selectedTransition = null;
                this.state.isDragging = true;
                this.state.dragTarget = 'canvas';
            }
        }
        
        perfMouseDown.end();
    },
    
    onMouseMove(e) {
        if (!this.state.isDragging) return;
        
        const dx = e.clientX - this.state.dragStartX;
        const dy = e.clientY - this.state.dragStartY;
        
        // 忽略微小移动（提高阈值）
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        
        if (this.state.dragTarget === 'canvas') {
            this.state.panX += dx;
            this.state.panY += dy;
        } else if (this.state.dragTarget === 'node' && this.state.selectedNode) {
            // 直接更新缓存的位置（不调用getCachedPositions减少开销）
            const nodeId = this.state.selectedNode.id;
            const path = this.state.currentPath.join('/');
            
            if (!this.state.machine.nodePositions[path]) {
                this.state.machine.nodePositions[path] = {};
            }
            const positions = this.state.machine.nodePositions[path];
            if (!positions[nodeId]) positions[nodeId] = { x: 200, y: 200 };
            
            positions[nodeId].x += dx / this.state.zoom;
            positions[nodeId].y += dy / this.state.zoom;
            
            // 同步缓存
            if (this._cachedPositions) {
                this._cachedPositions[nodeId] = positions[nodeId];
            }
        }
        
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        
        // 直接渲染（不使用RAF，避免延迟）
        this._doRender();
    },
    
    onMouseUp(e) {
        const wasDragging = this.state.isDragging;
        const draggedNode = this.state.selectedNode;
        
        if (this.state.connectFrom) {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left - this.state.panX) / this.state.zoom;
            const y = (e.clientY - rect.top - this.state.panY) / this.state.zoom;
            const target = this.findNodeAt(x, y);
            
            if (target && target !== this.state.connectFrom) {
                this.createTransition(this.state.connectFrom, target);
            }
            this.state.connectFrom = null;
        }
        
        this.state.isDragging = false;
        this.state.dragTarget = null;
        
        // 拖动结束后更新属性面板
        if (wasDragging && draggedNode) {
            this.renderProperties(draggedNode);
            this.renderLcdPreview(draggedNode);
            if (this.currentTab !== 'props') {
                this.switchTab('props');
            }
        }
        
        // 重绘网格（拖动时跳过了）
        this.render();
    },
    
    onDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.state.panX) / this.state.zoom;
        const y = (e.clientY - rect.top - this.state.panY) / this.state.zoom;
        
        const node = this.findNodeAt(x, y);
        
        if (node?.type === 'compound' && node.children) {
            this.enterNode(node);
        } else if (!node) {
            this.createStateAt(x, y);
        }
    },
    
    onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.3, Math.min(3, this.state.zoom * factor));
        
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratio = newZoom / this.state.zoom;
        
        this.state.panX = mx - (mx - this.state.panX) * ratio;
        this.state.panY = my - (my - this.state.panY) * ratio;
        this.state.zoom = newZoom;
        
        document.getElementById('hsm-zoom').textContent = Math.round(newZoom * 100) + '%';
        this.render();
    },
    
    onKeyDown(e) {
        // 如果在输入框中，不处理快捷键（除了Escape）
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (e.key === 'Escape') {
                e.target.blur();
                this.hideAllDialogs();
            }
            return;
        }
        
        const key = e.key.toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;
        
        // ========== 全局快捷键 ==========
        
        // Ctrl+K: 命令面板
        if (ctrl && key === 'k') {
            e.preventDefault();
            this.showCommandPalette();
            return;
        }
        
        // Ctrl+S: 保存
        if (ctrl && key === 's') {
            e.preventDefault();
            this.save();
            return;
        }
        
        // Ctrl+Z: 撤销
        if (ctrl && key === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }
        
        // Ctrl+Shift+Z / Ctrl+Y: 重做
        if ((ctrl && shift && key === 'z') || (ctrl && key === 'y')) {
            e.preventDefault();
            this.redo();
            return;
        }
        
        // Escape: 取消/返回上层
        if (e.key === 'Escape') {
            e.preventDefault();
            this.handleEscape();
            return;
        }
        
        // F5: 开始模拟
        if (e.key === 'F5') {
            e.preventDefault();
            this.simStart();
            return;
        }
        
        // F6: 停止模拟
        if (e.key === 'F6') {
            e.preventDefault();
            this.simStop();
            return;
        }
        
        // ========== 节点选中时的快捷键 ==========
        if (this.state.selectedNode) {
            const node = this.state.selectedNode;
            
            // Tab: 快速创建下一个状态并连线
            if (e.key === 'Tab') {
                e.preventDefault();
                if (shift) {
                    this.quickCreatePrevState();
                } else {
                    this.quickCreateNextState();
                }
                return;
            }
            
            // Enter: 进入复合状态 / 编辑名称
            if (e.key === 'Enter') {
                e.preventDefault();
                if (node.type === 'compound') {
                    this.enterNode(node);
                } else {
                    this.startEditNodeLabel();
                }
                return;
            }
            
            // F2: 重命名
            if (e.key === 'F2') {
                e.preventDefault();
                this.renameNode(node);
                return;
            }
            
            // Delete/Backspace: 删除
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.deleteSelectedNode();
                return;
            }
            
            // Ctrl+C: 复制
            if (ctrl && key === 'c') {
                e.preventDefault();
                this.copyNode(node);
                return;
            }
            
            // Ctrl+D: 复制并粘贴
            if (ctrl && key === 'd') {
                e.preventDefault();
                this.duplicateNode(node);
                return;
            }
            
            // 方向键: 导航到相邻状态
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.navigateToAdjacentNode(e.key);
                return;
            }
            
            // T: 开始连线模式
            if (key === 't' && !ctrl) {
                e.preventDefault();
                this.startConnectFrom(node);
                this.showToast('点击目标状态完成连线', 'info');
                return;
            }
            
            // A: 添加动作
            if (key === 'a' && !ctrl) {
                e.preventDefault();
                this.showAddDialog('entry');
                return;
            }
            
            // E: 编辑属性（聚焦到属性面板）
            if (key === 'e' && !ctrl) {
                e.preventDefault();
                this.focusPropertiesPanel();
                return;
            }
            
            // I: 设为初始状态
            if (key === 'i' && !ctrl) {
                e.preventDefault();
                this.setInitialState(node);
                return;
            }
            
            // C: 转换类型（原子/复合）
            if (key === 'c' && !ctrl) {
                e.preventDefault();
                this.toggleNodeType(node);
                return;
            }
        }
        
        // ========== 转移线选中时的快捷键 ==========
        if (this.state.selectedTransition) {
            // Delete/Backspace: 删除
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.deleteSelectedTransition();
                return;
            }
            
            // E: 编辑转移
            if (key === 'e' && !ctrl) {
                e.preventDefault();
                this.editTransition(this.state.selectedTransition);
                return;
            }
            
            // R: 反转方向
            if (key === 'r' && !ctrl) {
                e.preventDefault();
                this.reverseTransition(this.state.selectedTransition);
                return;
            }
            
            // Ctrl+C: 复制
            if (ctrl && key === 'c') {
                e.preventDefault();
                this.copyTransition(this.state.selectedTransition);
                return;
            }
        }
        
        // ========== 无选中时的快捷键 ==========
        
        // N: 新建状态
        if (key === 'n' && !ctrl) {
            e.preventDefault();
            this.createStateAtCenter();
            return;
        }
        
        // Ctrl+V: 粘贴
        if (ctrl && key === 'v') {
            e.preventDefault();
            if (this.state.clipboardType === 'node') {
                this.pasteNode();
            } else if (this.state.clipboardType === 'transition') {
                this.pasteTransition();
            }
            return;
        }
        
        // +/-: 缩放
        if (key === '=' || key === '+') {
            e.preventDefault();
            this.zoomIn();
            return;
        }
        if (key === '-') {
            e.preventDefault();
            this.zoomOut();
            return;
        }
        
        // 0: 重置视图
        if (key === '0' && !ctrl) {
            e.preventDefault();
            this.resetView();
            return;
        }
        
        // F: 适应视图
        if (key === 'f' && !ctrl) {
            e.preventDefault();
            this.fitView();
            return;
        }
        
        // L: 自动布局（当前层）
        if (key === 'l' && !ctrl && !shift) {
            e.preventDefault();
            this.autoLayout();
            return;
        }
        
        // Shift+L: 全部自动布局
        if (key === 'l' && !ctrl && shift) {
            e.preventDefault();
            this.autoLayoutAll();
            return;
        }
        
        // Space: 切换模拟状态
        if (e.key === ' ') {
            e.preventDefault();
            if (this.simState?.running) {
                this.simStop();
            } else {
                this.simStart();
            }
            return;
        }
    },
    
    // 处理Escape键
    handleEscape() {
        // 1. 关闭对话框
        if (this.hideAllDialogs()) return;
        
        // 2. 取消连线模式
        if (this.state.connectFrom) {
            this.state.connectFrom = null;
            this.setTool('select');
            this.render();
            return;
        }
        
        // 3. 取消选中转移线
        if (this.state.selectedTransition) {
            this.state.selectedTransition = null;
            this.render();
            return;
        }
        
        // 4. 取消选中节点
        if (this.state.selectedNode) {
            this.state.selectedNode = null;
            this.render();
            this.renderProperties(null);
            return;
        }
        
        // 5. 返回上层
        if (this.state.currentPath.length > 1) {
            this.goUp();
        }
    },
    
    // 隐藏所有对话框
    hideAllDialogs() {
        const dialogs = document.querySelectorAll('.hsm-dialog-overlay, #hsm-context-menu, #hsm-command-palette');
        if (dialogs.length > 0) {
            dialogs.forEach(d => d.remove());
            return true;
        }
        return false;
    },
    
    // 快速创建下一个状态并连线
    quickCreateNextState() {
        const currentNode = this.state.selectedNode;
        if (!currentNode) return;
        
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path] || {};
        const currentPos = positions[currentNode.id] || { x: 200, y: 200 };
        
        // 在右侧创建新状态
        const newX = currentPos.x + 180;
        const newY = currentPos.y;
        
        // 创建新状态
        const container = this.getCurrentContainer();
        if (!container.children) container.children = {};
        
        const id = 'STATE_' + Date.now();
        const newNode = {
            id,
            label: '新状态',
            type: 'atomic',
            level: this.state.currentPath.length,
            description: '',
            entryActions: [],
            exitActions: [],
            display: {}
        };
        
        container.children[id] = newNode;
        
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        this.state.machine.nodePositions[path][id] = { x: newX, y: newY };
        
        // 创建转移线（不弹出对话框）
        this.createQuickTransition(currentNode, newNode);
        
        // 选中新状态
        this.selectNode(newNode);
        this.renderTree();
        this.render();
        
        // 自动进入重命名模式
        setTimeout(() => this.renameNode(newNode), 100);
    },
    
    // 快速创建前一个状态
    quickCreatePrevState() {
        const currentNode = this.state.selectedNode;
        if (!currentNode) return;
        
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path] || {};
        const currentPos = positions[currentNode.id] || { x: 200, y: 200 };
        
        // 在左侧创建新状态
        const newX = currentPos.x - 180;
        const newY = currentPos.y;
        
        const container = this.getCurrentContainer();
        if (!container.children) container.children = {};
        
        const id = 'STATE_' + Date.now();
        const newNode = {
            id,
            label: '新状态',
            type: 'atomic',
            level: this.state.currentPath.length,
            description: '',
            entryActions: [],
            exitActions: [],
            display: {}
        };
        
        container.children[id] = newNode;
        
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        this.state.machine.nodePositions[path][id] = { x: newX, y: newY };
        
        // 创建从新状态到当前状态的转移线（不弹出对话框）
        this.createQuickTransition(newNode, currentNode);
        
        this.selectNode(newNode);
        this.renderTree();
        this.render();
        
        setTimeout(() => this.renameNode(newNode), 100);
    },
    
    // 导航到相邻节点
    navigateToAdjacentNode(direction) {
        const currentNode = this.state.selectedNode;
        if (!currentNode) return;
        
        const container = this.getCurrentContainer();
        if (!container.children) return;
        
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path] || {};
        const currentPos = positions[currentNode.id] || { x: 200, y: 200 };
        
        let bestNode = null;
        let bestDistance = Infinity;
        
        for (const [id, node] of Object.entries(container.children)) {
            if (id === currentNode.id) continue;
            
            const pos = positions[id] || { x: 200, y: 200 };
            const dx = pos.x - currentPos.x;
            const dy = pos.y - currentPos.y;
            
            let isInDirection = false;
            switch (direction) {
                case 'ArrowRight': isInDirection = dx > 50; break;
                case 'ArrowLeft': isInDirection = dx < -50; break;
                case 'ArrowDown': isInDirection = dy > 30; break;
                case 'ArrowUp': isInDirection = dy < -30; break;
            }
            
            if (isInDirection) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestNode = node;
                }
            }
        }
        
        if (bestNode) {
            this.selectNode(bestNode);
        }
    },
    
    // 在画布中心创建状态
    createStateAtCenter() {
        const centerX = (this.canvas.width / 2 - this.state.panX) / this.state.zoom;
        const centerY = (this.canvas.height / 2 - this.state.panY) / this.state.zoom;
        this.createStateAt(centerX, centerY);
    },
    
    // 复制并粘贴节点
    duplicateNode(node) {
        this.copyNode(node);
        
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path] || {};
        const pos = positions[node.id] || { x: 200, y: 200 };
        
        // 偏移位置
        this.state.contextMenuX = pos.x + 30;
        this.state.contextMenuY = pos.y + 30;
        
        this.pasteNode();
    },
    
    // 重置视图
    resetView() {
        this.state.zoom = 1;
        this.state.panX = 50;
        this.state.panY = 50;
        document.getElementById('hsm-zoom').textContent = '100%';
        this.render();
    },
    
    // 聚焦到属性面板
    focusPropertiesPanel() {
        const firstInput = document.querySelector('#hsm-props-content input:not([disabled])');
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }
    },
    
    // 开始编辑节点名称
    startEditNodeLabel() {
        const node = this.state.selectedNode;
        if (!node) return;
        
        const labelInput = document.querySelector('#hsm-props-content input[onchange*="label"]');
        if (labelInput) {
            labelInput.focus();
            labelInput.select();
        } else {
            this.renameNode(node);
        }
    },
    
    // 命令面板
    showCommandPalette() {
        const old = document.getElementById('hsm-command-palette');
        if (old) old.remove();
        
        const commands = [
            { id: 'new-state', name: '新建状态', shortcut: 'N', icon: '➕', action: () => this.createStateAtCenter() },
            { id: 'new-compound', name: '新建复合状态', shortcut: 'Shift+N', icon: '📦', action: () => this.createStateAt(300, 200, 'compound') },
            { id: 'save', name: '保存', shortcut: 'Ctrl+S', icon: '💾', action: () => this.save() },
            { id: 'export', name: '导出C代码', shortcut: '', icon: '📤', action: () => this.exportCode() },
            { id: 'generate-tests', name: '生成测试用例', shortcut: '', icon: '🧪', action: () => this.generateTestCases() },
            { id: 'sim-start', name: '开始模拟', shortcut: 'F5', icon: '▶️', action: () => this.simStart() },
            { id: 'sim-stop', name: '停止模拟', shortcut: 'F6', icon: '⏹️', action: () => this.simStop() },
            { id: 'auto-layout', name: '当前层布局', shortcut: 'L', icon: '📐', action: () => this.autoLayout() },
            { id: 'auto-layout-all', name: '全部自动布局', shortcut: 'Shift+L', icon: '🌐', action: () => this.autoLayoutAll() },
            { id: 'fit-view', name: '适应视图', shortcut: 'F', icon: '⊡', action: () => this.fitView() },
            { id: 'reset-view', name: '重置视图', shortcut: '0', icon: '🔄', action: () => this.resetView() },
            { id: 'go-up', name: '返回上层', shortcut: 'Esc', icon: '⬆️', action: () => this.goUp() },
            { id: 'load-example', name: '加载示例', shortcut: '', icon: '📥', action: () => this.loadExample() },
            { id: 'show-variables', name: '变量管理', shortcut: '', icon: '📊', action: () => this.showVariablesPanel() },
        ];
        
        // 如果有选中节点，添加节点相关命令
        if (this.state.selectedNode) {
            const node = this.state.selectedNode;
            commands.unshift(
                { id: 'rename', name: `重命名 "${node.label}"`, shortcut: 'F2', icon: '✏️', action: () => this.renameNode(node) },
                { id: 'delete', name: `删除 "${node.label}"`, shortcut: 'Del', icon: '🗑️', action: () => this.deleteSelectedNode() },
                { id: 'add-action', name: '添加入口动作', shortcut: 'A', icon: '⚡', action: () => this.showAddDialog('entry') },
                { id: 'add-transition', name: '添加转移线', shortcut: 'T', icon: '➡️', action: () => this.startConnectFrom(node) },
                { id: 'set-initial', name: '设为初始状态', shortcut: 'I', icon: '🎯', action: () => this.setInitialState(node) },
                { id: 'toggle-type', name: node.type === 'compound' ? '转为原子状态' : '转为复合状态', shortcut: 'C', icon: '🔄', action: () => this.toggleNodeType(node) },
            );
            if (node.type === 'compound') {
                commands.splice(1, 0, { id: 'enter', name: `进入 "${node.label}"`, shortcut: 'Enter', icon: '📂', action: () => this.enterNode(node) });
            }
        }
        
        const dialog = document.createElement('div');
        dialog.id = 'hsm-command-palette';
        dialog.className = 'hsm-dialog-overlay';
        dialog.style.cssText = 'align-items: flex-start; padding-top: 100px;';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width: 400px; max-height: 450px;">
                <div class="hsm-dialog-body" style="padding: 0;">
                    <input type="text" class="hsm-command-input" placeholder="输入命令..." 
                           oninput="HSM.filterCommands(this.value)"
                           onkeydown="HSM.handleCommandKey(event)"/>
                    <div class="hsm-command-list" id="hsm-command-list"></div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this._commands = commands;
        this._commandIndex = 0;
        this.filterCommands('');
        
        dialog.querySelector('.hsm-command-input').focus();
        
        // 点击背景关闭
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.remove();
        });
    },
    
    filterCommands(query) {
        const list = document.getElementById('hsm-command-list');
        if (!list) return;
        
        const q = query.toLowerCase();
        const filtered = this._commands.filter(cmd => 
            cmd.name.toLowerCase().includes(q) || cmd.id.includes(q)
        );
        
        this._filteredCommands = filtered;
        this._commandIndex = 0;
        
        list.innerHTML = filtered.map((cmd, i) => `
            <div class="hsm-command-item ${i === 0 ? 'selected' : ''}" 
                 onclick="HSM.executeCommand('${cmd.id}')"
                 onmouseenter="HSM.selectCommandItem(${i})">
                <span class="hsm-command-icon">${cmd.icon}</span>
                <span class="hsm-command-name">${cmd.name}</span>
                ${cmd.shortcut ? `<span class="hsm-command-shortcut">${cmd.shortcut}</span>` : ''}
            </div>
        `).join('') || '<div class="hsm-empty">无匹配命令</div>';
    },
    
    handleCommandKey(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.selectCommandItem(Math.min(this._commandIndex + 1, (this._filteredCommands?.length || 1) - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.selectCommandItem(Math.max(this._commandIndex - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = this._filteredCommands?.[this._commandIndex];
            if (cmd) this.executeCommand(cmd.id);
        } else if (e.key === 'Escape') {
            document.getElementById('hsm-command-palette')?.remove();
        }
    },
    
    selectCommandItem(index) {
        this._commandIndex = index;
        document.querySelectorAll('.hsm-command-item').forEach((el, i) => {
            el.classList.toggle('selected', i === index);
        });
    },
    
    executeCommand(id) {
        const cmd = this._commands.find(c => c.id === id);
        if (cmd) {
            document.getElementById('hsm-command-palette')?.remove();
            cmd.action();
        }
    },
    
    // 撤销/重做（简单实现）
    _history: [],
    _historyIndex: -1,
    
    saveHistory() {
        // 保存当前状态到历史
        const snapshot = JSON.stringify(this.state.machine);
        this._history = this._history.slice(0, this._historyIndex + 1);
        this._history.push(snapshot);
        this._historyIndex = this._history.length - 1;
        
        // 限制历史长度
        if (this._history.length > 50) {
            this._history.shift();
            this._historyIndex--;
        }
    },
    
    undo() {
        if (this._historyIndex > 0) {
            this._historyIndex--;
            this.state.machine = JSON.parse(this._history[this._historyIndex]);
            this.render();
            this.renderTree();
            this.showToast('已撤销', 'info');
        } else {
            this.showToast('没有可撤销的操作', 'warning');
        }
    },
    
    redo() {
        if (this._historyIndex < this._history.length - 1) {
            this._historyIndex++;
            this.state.machine = JSON.parse(this._history[this._historyIndex]);
            this.render();
            this.renderTree();
            this.showToast('已重做', 'info');
        } else {
            this.showToast('没有可重做的操作', 'warning');
        }
    },
    
    setupToolbar() {
        document.querySelectorAll('.hsm-canvas-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
        });
        document.querySelectorAll('.hsm-level-dot').forEach(dot => {
            dot.addEventListener('click', () => this.goToLevel(parseInt(dot.dataset.level)));
        });
    },
    
    setTool(tool) {
        this.state.currentTool = tool;
        document.querySelectorAll('.hsm-canvas-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    },

    // ========== 层级导航 ==========
    getCurrentContainer() {
        const pathStr = this.state.currentPath.join('/');
        
        // 使用缓存
        if (this._cachedPath === pathStr && this._cachedContainer) {
            return this._cachedContainer;
        }
        
        let container = this.state.machine.hierarchy.ROOT;
        for (let i = 1; i < this.state.currentPath.length; i++) {
            const id = this.state.currentPath[i];
            if (container.children?.[id]) {
                container = container.children[id];
            }
        }
        
        // 更新缓存
        this._cachedPath = pathStr;
        this._cachedContainer = container;
        this._cachedPositions = this.state.machine.nodePositions[pathStr] || {};
        
        return container;
    },
    
    // 获取缓存的位置信息
    getCachedPositions() {
        const pathStr = this.state.currentPath.join('/');
        if (this._cachedPath !== pathStr) {
            this.getCurrentContainer(); // 刷新缓存
        }
        return this._cachedPositions || {};
    },
    
    // 清除缓存（路径变化时调用）
    invalidateCache() {
        this._cachedContainer = null;
        this._cachedPath = null;
        this._cachedPositions = null;
    },
    
    // skipAutoLayout: 仿真时跳过自动布局
    enterNode(node, skipAutoLayout = false) {
        if (node.type !== 'compound') return;
        this.state.currentPath.push(node.id);
        this.state.selectedNode = null;
        this.invalidateCache(); // 清除缓存
        this.updateBreadcrumb();
        this.updateLevelHint();
        this.renderTree();
        
        // 仿真时跳过自动布局
        if (skipAutoLayout) {
            this.render();
            return;
        }
        
        // 检查是否需要自动布局（如果节点位置重叠或未定义）
        const container = this.getCurrentContainer();
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path];
        
        if (container.children && Object.keys(container.children).length > 0) {
            // 检查是否有位置信息
            const hasPositions = positions && Object.keys(positions).length > 0;
            
            if (!hasPositions) {
                // 没有位置信息，自动布局
                this.autoLayout();
            } else {
                // 有位置信息，直接渲染并适应视图
                this.render();
                this.fitView();
            }
        } else {
            this.render();
        }
    },
    
    goUp() {
        if (this.state.currentPath.length <= 1) return;
        this.state.currentPath.pop();
        this.state.selectedNode = null;
        this.invalidateCache(); // 清除缓存
        this.updateBreadcrumb();
        this.updateLevelHint();
        this.render();
        this.renderTree();
        this.fitView();
    },
    
    goToLevel(level) {
        while (this.state.currentPath.length > level + 1) {
            this.state.currentPath.pop();
        }
        this.state.selectedNode = null;
        this.invalidateCache(); // 清除缓存
        this.updateBreadcrumb();
        this.updateLevelHint();
        this.render();
        this.renderTree();
    },
    
    // 导航到指定节点路径
    navigateToNode(nodeId) {
        const path = this.findNodePath(nodeId);
        if (path && path.length > 1) {
            // 导航到父节点层级
            this.state.currentPath = path.slice(0, -1);
            this.state.selectedNode = this.findNodeById(nodeId);
            this.updateBreadcrumb();
            this.updateLevelHint();
            this.render();
            this.renderProperties(this.state.selectedNode);
            this.renderLcdPreview(this.state.selectedNode);
        }
    },
    
    updateBreadcrumb() {
        const container = document.getElementById('hsm-breadcrumb');
        if (!container) return;
        
        let html = '';
        for (let i = 0; i < this.state.currentPath.length; i++) {
            const id = this.state.currentPath[i];
            const isLast = i === this.state.currentPath.length - 1;
            if (i > 0) html += '<span class="hsm-breadcrumb-sep">›</span>';
            html += `<span class="hsm-breadcrumb-item ${isLast ? 'current' : ''}" onclick="HSM.goToLevel(${i})">${id}</span>`;
        }
        container.innerHTML = html;
    },
    
    updateLevelHint() {
        const hint = document.getElementById('hsm-level-hint');
        if (!hint) return;
        
        const level = this.state.currentPath.length - 1;
        const names = ['系统层', '功能管理', '功能模块', '子流程', '细节'];
        const colors = this.levelColors[Math.min(level, 4)];
        
        hint.innerHTML = `
            <div class="hsm-level-hint-icon" style="background:${colors.bg};color:${colors.text};">L${level}</div>
            <span>${names[level] || '层级' + level}</span>
        `;
        
        document.querySelectorAll('.hsm-level-dot').forEach(dot => {
            dot.classList.toggle('active', parseInt(dot.dataset.level) === level);
        });
    },
    
    // ========== 节点操作 ==========
    findNodeAt(x, y) {
        const container = this.getCurrentContainer();
        if (!container.children) return null;
        
        const positions = this.getCachedPositions();
        
        for (const [id, node] of Object.entries(container.children)) {
            const pos = positions[id] || { x: 200, y: 200 };
            const w = this.getNodeWidth(node);
            const h = this.getNodeHeight(node);
            
            if (x >= pos.x && x <= pos.x + w && y >= pos.y && y <= pos.y + h) {
                return node;
            }
        }
        return null;
    },
    
    // 完整选中（用于树点击、快捷键等非拖动场景）
    selectNode(node) {
        this.state.selectedNode = node;
        this.render();
        this.highlightTreeNode(node?.id);
        
        // 异步更新属性面板和LCD预览
        requestAnimationFrame(() => {
            this.renderProperties(node);
            
            // LCD预览使用防抖
            if (this._lcdPreviewTimer) {
                clearTimeout(this._lcdPreviewTimer);
            }
            this._lcdPreviewTimer = setTimeout(() => {
                this.renderLcdPreview(node);
            }, 100);
            
            // 选中节点时自动切换到属性Tab
            if (node && this.currentTab !== 'props') {
                this.switchTab('props');
            }
        });
    },
    
    highlightTreeNode(nodeId) {
        document.querySelectorAll('.hsm-tree-header').forEach(el => {
            el.classList.remove('selected');
        });
        if (nodeId) {
            const el = document.querySelector(`.hsm-tree-header[data-id="${nodeId}"]`);
            if (el) el.classList.add('selected');
        }
    },
    
    createStateAt(x, y, type = 'atomic') {
        const container = this.getCurrentContainer();
        if (!container.children) container.children = {};
        
        const id = 'STATE_' + Date.now();
        const level = this.state.currentPath.length;
        
        const newNode = {
            id, 
            label: type === 'compound' ? '新复合状态' : '新状态', 
            type, 
            level,
            description: '', 
            entryActions: [], 
            exitActions: [], 
            display: {}
        };
        
        if (type === 'compound') {
            newNode.children = {};
        }
        
        container.children[id] = newNode;
        
        const path = this.state.currentPath.join('/');
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        this.state.machine.nodePositions[path][id] = { x, y };
        
        this.selectNode(container.children[id]);
        this.renderTree();
        this.render();
        this.showToast('已创建状态', 'success');
    },
    
    deleteSelectedNode() {
        if (!this.state.selectedNode) return;
        if (!confirm(`删除 "${this.state.selectedNode.label}"?`)) return;
        
        const container = this.getCurrentContainer();
        if (container.children) {
            delete container.children[this.state.selectedNode.id];
        }
        
        this.state.machine.transitions = this.state.machine.transitions.filter(
            t => t.from !== this.state.selectedNode.id && t.to !== this.state.selectedNode.id
        );
        
        this.state.selectedNode = null;
        this.renderTree();
        this.render();
        this.renderProperties(null);
    },
    
    // 删除指定节点
    deleteNode(node) {
        if (!node) return;
        if (!confirm(`删除 "${node.label}"?`)) return;
        
        const container = this.getCurrentContainer();
        if (container.children) {
            delete container.children[node.id];
        }
        
        this.state.machine.transitions = this.state.machine.transitions.filter(
            t => t.from !== node.id && t.to !== node.id
        );
        
        if (this.state.selectedNode === node) {
            this.state.selectedNode = null;
        }
        this.renderTree();
        this.render();
        this.renderProperties(null);
        this.showToast('已删除', 'info');
    },
    
    // 重命名节点
    renameNode(node) {
        const newLabel = prompt('输入新名称:', node.label || node.id);
        if (newLabel && newLabel.trim()) {
            node.label = newLabel.trim();
            this.renderTree();
            this.render();
            this.renderProperties(node);
            this.showToast('已重命名', 'success');
        }
    },
    
    // 复制节点
    copyNode(node) {
        this.state.clipboard = JSON.parse(JSON.stringify(node));
        this.state.clipboard.id = null; // 清除ID，粘贴时重新生成
        this.state.clipboardType = 'node';
        this.showToast('已复制节点', 'success');
    },
    
    // 粘贴节点
    pasteNode() {
        if (!this.state.clipboard || this.state.clipboardType !== 'node') return;
        
        const container = this.getCurrentContainer();
        if (!container.children) container.children = {};
        
        const newNode = JSON.parse(JSON.stringify(this.state.clipboard));
        newNode.id = 'STATE_' + Date.now();
        newNode.label = (newNode.label || 'State') + '_copy';
        newNode.level = this.state.currentPath.length;
        
        container.children[newNode.id] = newNode;
        
        // 设置位置
        const path = this.state.currentPath.join('/');
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        this.state.machine.nodePositions[path][newNode.id] = {
            x: this.state.contextMenuX || 200,
            y: this.state.contextMenuY || 200
        };
        
        this.selectNode(newNode);
        this.renderTree();
        this.render();
        this.showToast('已粘贴节点', 'success');
    },
    
    // 复制转移线
    copyTransition(trans) {
        this.state.clipboard = JSON.parse(JSON.stringify(trans));
        this.state.clipboardType = 'transition';
        this.showToast('已复制转移', 'success');
    },
    
    // 粘贴转移线
    pasteTransition() {
        if (!this.state.clipboard || this.state.clipboardType !== 'transition') return;
        
        const newTrans = JSON.parse(JSON.stringify(this.state.clipboard));
        newTrans.event = newTrans.event + '_copy';
        
        this.state.machine.transitions.push(newTrans);
        this.selectTransition(newTrans);
        this.render();
        this.showToast('已粘贴转移', 'success');
    },
    
    // 查找点击位置的转移线
    findTransitionAt(x, y) {
        if (!this.state.machine.transitions) return null;
        
        const container = this.getCurrentContainer();
        const children = container.children ? Object.keys(container.children) : [];
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine.nodePositions[path] || {};
        
        for (const trans of this.state.machine.transitions) {
            if (!children.includes(trans.from) || !children.includes(trans.to)) continue;
            
            const fromNode = container.children[trans.from];
            const toNode = container.children[trans.to];
            if (!fromNode || !toNode) continue;
            
            const fromPos = positions[trans.from] || { x: 200, y: 200 };
            const toPos = positions[trans.to] || { x: 400, y: 200 };
            
            const fw = this.getNodeWidth(fromNode);
            const fh = this.getNodeHeight(fromNode);
            const tw = this.getNodeWidth(toNode);
            const th = this.getNodeHeight(toNode);
            
            // 计算连接点
            const fcx = fromPos.x + fw / 2;
            const fcy = fromPos.y + fh / 2;
            const tcx = toPos.x + tw / 2;
            const tcy = toPos.y + th / 2;
            
            // 检查点是否在线段附近
            const dist = this.pointToLineDistance(x, y, fcx, fcy, tcx, tcy);
            if (dist < 10) {
                return trans;
            }
        }
        return null;
    },
    
    // 计算点到线段的距离
    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
            xx = x1; yy = y1;
        } else if (param > 1) {
            xx = x2; yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    },
    
    // 选中转移线
    selectTransition(trans) {
        this.state.selectedTransition = trans;
        this.state.selectedNode = null;
        this.render();
        this.renderTransitionProperties(trans);
    },
    
    // 删除选中的转移线
    deleteSelectedTransition() {
        if (!this.state.selectedTransition) return;
        if (!confirm(`删除转移 "${this.state.selectedTransition.event}"?`)) return;
        
        const idx = this.state.machine.transitions.indexOf(this.state.selectedTransition);
        if (idx >= 0) {
            this.state.machine.transitions.splice(idx, 1);
        }
        
        this.state.selectedTransition = null;
        this.render();
        this.renderProperties(null);
        this.showToast('已删除转移', 'info');
    },
    
    // 编辑转移线
    editTransition(trans) {
        const event = prompt('事件名称:', trans.event);
        if (event !== null) {
            trans.event = event;
            this.render();
            this.renderTransitionProperties(trans);
        }
    },
    
    // 渲染转移线属性面板
    renderTransitionProperties(trans) {
        const container = document.getElementById('hsm-props-content');
        if (!container) return;
        
        if (!trans) {
            container.innerHTML = '<div class="hsm-empty">选择节点或转移查看属性</div>';
            return;
        }
        
        const actions = this.state.actionsConfig?.actions || {};
        
        container.innerHTML = `
            <div class="hsm-prop-section">
                <label>转移类型</label>
                <div style="padding:4px 0;color:var(--accent-color);font-size:12px;">➡️ 状态转移</div>
            </div>
            <div class="hsm-prop-section">
                <label>源状态</label>
                <input type="text" value="${trans.from}" disabled class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>目标状态</label>
                <input type="text" value="${trans.to}" disabled class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>触发事件</label>
                <input type="text" value="${trans.event || ''}" 
                       onchange="HSM.updateTransitionProp('event', this.value)" class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>条件 (guard)</label>
                <input type="text" value="${trans.guard || ''}" 
                       placeholder="可选，如: battery > 20"
                       onchange="HSM.updateTransitionProp('guard', this.value)" class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>转移动作 <button class="hsm-btn-mini" onclick="HSM.showAddTransitionAction()">+</button></label>
                <div class="hsm-tag-list" id="hsm-trans-actions">
                    ${(trans.actions || []).map(a => `
                        <span class="hsm-tag hsm-tag-action">
                            ${actions[a]?.name || a}
                            <span class="hsm-tag-remove" onclick="HSM.removeTransitionAction('${a}')">×</span>
                        </span>
                    `).join('')}
                </div>
            </div>
            <div class="hsm-prop-section">
                <label>描述</label>
                <textarea onchange="HSM.updateTransitionProp('description', this.value)" 
                          class="hsm-textarea">${trans.description || ''}</textarea>
            </div>
            <div class="hsm-prop-section" style="margin-top:12px;">
                <button class="hsm-btn" style="width:100%;background:#ef4444;border-color:#ef4444;" 
                        onclick="HSM.deleteSelectedTransition()">🗑️ 删除转移</button>
            </div>
        `;
    },
    
    updateTransitionProp(prop, value) {
        if (!this.state.selectedTransition) return;
        this.state.selectedTransition[prop] = value;
        this.render();
    },
    
    showAddTransitionAction() {
        if (!this.state.selectedTransition) return;
        
        const actions = this.state.actionsConfig?.actions || {};
        const items = Object.entries(actions).map(([k, v]) => ({ 
            id: k, name: v.name || k, desc: v.description, category: '动作库'
        }));
        
        this.showSearchableDialog('添加转移动作', items, (selected) => {
            const value = typeof selected === 'object' ? selected.id : selected;
            if (!this.state.selectedTransition.actions) {
                this.state.selectedTransition.actions = [];
            }
            if (!this.state.selectedTransition.actions.includes(value)) {
                this.state.selectedTransition.actions.push(value);
            }
            this.renderTransitionProperties(this.state.selectedTransition);
        });
    },
    
    removeTransitionAction(actionId) {
        if (!this.state.selectedTransition) return;
        this.state.selectedTransition.actions = (this.state.selectedTransition.actions || []).filter(a => a !== actionId);
        this.renderTransitionProperties(this.state.selectedTransition);
    },
    
    // 设为初始状态
    setInitialState(node) {
        const container = this.getCurrentContainer();
        container.initial = node.id;
        this.render();
        this.renderTree();
        this.showToast(`已设为初始状态`, 'success');
    },
    
    // 切换节点类型
    toggleNodeType(node) {
        if (node.type === 'compound') {
            if (node.children && Object.keys(node.children).length > 0) {
                if (!confirm('转为原子状态将删除所有子状态，确定？')) return;
            }
            node.type = 'atomic';
            delete node.children;
        } else {
            node.type = 'compound';
            node.children = {};
        }
        this.render();
        this.renderTree();
        this.renderProperties(node);
    },
    
    // 开始连线
    startConnectFrom(node) {
        this.state.connectFrom = node;
        this.setTool('connect');
        this.showToast('点击目标状态完成连线', 'info');
    },
    
    // 添加超时事件
    addTimeoutEvent(node) {
        const timeout = prompt('超时时间(毫秒):', '3000');
        if (!timeout) return;
        
        const ms = parseInt(timeout);
        if (isNaN(ms) || ms <= 0) {
            this.showToast('请输入有效的毫秒数', 'warning');
            return;
        }
        
        // 添加到入口动作
        if (!node.entryActions) node.entryActions = [];
        const timeoutAction = `timeout:${ms}`;
        if (!node.entryActions.includes(timeoutAction)) {
            node.entryActions.push(timeoutAction);
        }
        
        this.renderProperties(node);
        this.render();
        this.showToast(`已添加 ${ms}ms 超时`, 'success');
    },
    
    // 反转转移方向
    reverseTransition(trans) {
        const temp = trans.from;
        trans.from = trans.to;
        trans.to = temp;
        this.render();
        this.renderTransitionProperties(trans);
        this.showToast('已反转方向', 'success');
    },
    
    addState() {
        const rect = this.canvas.getBoundingClientRect();
        const x = (rect.width / 2 - this.state.panX) / this.state.zoom;
        const y = (rect.height / 2 - this.state.panY) / this.state.zoom;
        this.createStateAt(x, y);
    },
    
    createTransition(from, to, eventName = null) {
        // 如果没有提供事件名，弹出对话框
        if (!eventName) {
            eventName = prompt('事件名称:', 'EVENT');
            if (!eventName) return null;
        }
        
        const trans = {
            from: from.id, to: to.id, event: eventName, actions: [], description: ''
        };
        this.state.machine.transitions.push(trans);
        this.render();
        return trans;
    },
    
    // 快速创建转移（不弹出对话框）
    createQuickTransition(from, to) {
        const trans = {
            from: from.id, to: to.id, event: 'EVENT', actions: [], description: ''
        };
        this.state.machine.transitions.push(trans);
        return trans;
    },
    
    // ========== 渲染 ==========
    resizeCanvas() {
        if (!this.canvas) return;
        const area = document.getElementById('hsm-canvas-area');
        if (area) {
            this.canvas.width = area.clientWidth;
            this.canvas.height = area.clientHeight;
        }
    },
    
    getNodeWidth(node) {
        // 根据标签长度动态计算宽度
        const label = node.label || node.id;
        const baseWidth = Math.max(label.length * 10, 100);
        return Math.min(Math.max(baseWidth, 120), 180);
    },
    
    getNodeHeight(node) {
        // 更紧凑的高度计算
        let h = 56; // 基础高度：标签 + 类型
        if (node.entryActions?.length) h += 16;
        if (node.exitActions?.length) h += 16;
        if (node.type === 'compound' && node.children) h += 18;
        return Math.max(h, 70);
    },
    
    render() {
        // 使用 requestAnimationFrame 优化渲染性能
        if (this._renderRAF) {
            cancelAnimationFrame(this._renderRAF);
        }
        this._renderRAF = requestAnimationFrame(() => this._doRender());
    },
    
    _doRender() {
        if (!this.ctx) return;
        
        const perfRender = HSMPerf.mark('render');
        
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // 简化背景 - 纯色更快
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        
        // 网格（仅在非拖动时绘制，提升性能）
        if (!this.state.isDragging) {
            const perfGrid = HSMPerf.mark('drawGrid');
            this.drawGrid(ctx, w, h);
            perfGrid.end();
        }
        
        ctx.save();
        ctx.translate(this.state.panX, this.state.panY);
        ctx.scale(this.state.zoom, this.state.zoom);
        
        // 使用缓存 - 只调用一次
        const perfCache = HSMPerf.mark('getCache');
        const container = this.getCurrentContainer();
        const positions = this.getCachedPositions();
        const initial = container.initial;
        perfCache.end();
        
        // 绘制转移线
        const perfTrans = HSMPerf.mark('drawTransitions');
        this.drawTransitions(ctx, container, positions);
        perfTrans.end();
        
        // 绘制节点 - 传入initial避免重复查询
        const perfNodes = HSMPerf.mark('drawNodes');
        if (container.children) {
            for (const [id, node] of Object.entries(container.children)) {
                const pos = positions[id] || { x: 200, y: 100 };
                this.drawNode(ctx, node, pos.x, pos.y, initial);
            }
        }
        perfNodes.end();
        
        ctx.restore();
        
        // 空状态提示
        const empty = document.getElementById('hsm-empty-hint');
        if (empty) {
            empty.style.display = (!container.children || Object.keys(container.children).length === 0) ? 'block' : 'none';
        }
        
        perfRender.end();
    },
    
    drawGrid(ctx, w, h) {
        // 简化网格 - 仅在缩放较大时绘制
        if (this.state.zoom < 0.5) return;
        
        const gridSize = 24 * this.state.zoom;
        ctx.fillStyle = 'rgba(100, 116, 139, 0.12)';
        
        for (let x = this.state.panX % gridSize; x < w; x += gridSize) {
            for (let y = this.state.panY % gridSize; y < h; y += gridSize) {
                ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
            }
        }
    },

    drawNode(ctx, node, x, y, initialId) {
        const w = this.getNodeWidth(node);
        const h = this.getNodeHeight(node);
        const isSelected = this.state.selectedNode === node;
        const isCompound = node.type === 'compound';
        const isInitial = initialId === node.id;
        const isReady = node.isReady === true;  // 准备状态标记
        
        // 简化配色 - 准备状态用绿色
        const bgColor = isCompound ? 'rgba(20, 50, 50, 0.95)' : 
                        isReady ? 'rgba(20, 50, 30, 0.95)' : 'rgba(30, 41, 59, 0.95)';
        const borderColor = isSelected ? '#3b82f6' : 
                           isReady ? '#22c55e' :
                           (isCompound ? '#0d9488' : '#475569');
        const accentColor = isCompound ? '#2dd4bf' : 
                           isReady ? '#4ade80' : '#60a5fa';
        
        const radius = 10;
        
        // 选中发光（简化）
        if (isSelected) {
            ctx.shadowColor = '#3b82f6';
            ctx.shadowBlur = 15;
        } else if (isReady) {
            ctx.shadowColor = '#22c55e';
            ctx.shadowBlur = 8;
        }
        
        // 背景
        ctx.fillStyle = bgColor;
        this.roundRect(ctx, x, y, w, h, radius);
        ctx.fill();
        
        // 清除阴影
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // 边框 - 准备状态用更粗的绿色边框
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isSelected ? 2 : (isReady ? 2 : 1);
        this.roundRect(ctx, x, y, w, h, radius);
        ctx.stroke();
        
        // 顶部高亮线
        ctx.strokeStyle = accentColor + '60';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + radius, y + 1);
        ctx.lineTo(x + w - radius, y + 1);
        ctx.stroke();
        
        // 初始状态标记
        if (isInitial) {
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(x - 15, y + h / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 10, y + h / 2);
            ctx.lineTo(x, y + h / 2);
            ctx.stroke();
        }
        
        // 准备状态标记 - 右上角绿色圆点
        if (isReady) {
            ctx.fillStyle = '#22c55e';
            ctx.beginPath();
            ctx.arc(x + w - 8, y + 8, 5, 0, Math.PI * 2);
            ctx.fill();
            // 步骤序号
            if (node.stepIndex) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 8px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(node.stepIndex, x + w - 8, y + 11);
            }
        }
        
        let ty = y + 22;
        
        // 标签
        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(node.label || node.id, x + w / 2, ty);
        ty += 16;
        
        // 类型标签 - 准备状态显示"准备"
        ctx.fillStyle = accentColor;
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(isCompound ? '复合' : (isReady ? '准备' : '原子'), x + w / 2, ty);
        ty += 16;
        
        // 动作计数（简化）
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'left';
        
        if (node.entryActions?.length) {
            ctx.fillStyle = '#fbbf24';
            ctx.fillText(`⚡ ${node.entryActions.length}`, x + 8, ty);
        }
        if (node.exitActions?.length) {
            ctx.fillStyle = '#f87171';
            ctx.fillText(`🚪 ${node.exitActions.length}`, x + 45, ty);
        }
        
        // 子状态数
        if (isCompound && node.children) {
            ctx.fillStyle = accentColor;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${Object.keys(node.children).length} →`, x + w - 8, y + h - 8);
        }
        
        // 流程类型标记（复合状态）
        if (isCompound && node.flowType) {
            const flowLabels = { single: '单步', multi: '多步', loop: '循环' };
            const flowColors = { single: '#60a5fa', multi: '#f59e0b', loop: '#a78bfa' };
            ctx.fillStyle = flowColors[node.flowType] || '#64748b';
            ctx.font = '9px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`📊${flowLabels[node.flowType]}`, x + 8, y + h - 8);
        }
    },
    
    roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },
    
    // 现代化转移线绘制 - 平滑贝塞尔曲线（优化版）
    drawTransitions(ctx, container, positions) {
        const transitions = this.state.machine.transitions;
        if (!transitions || transitions.length === 0) return;
        
        const children = container.children;
        if (!children) return;
        
        const childIds = Object.keys(children);
        const isDragging = this.state.isDragging;
        
        // 预计算节点尺寸（避免重复调用）
        const nodeSizes = {};
        for (const id of childIds) {
            const node = children[id];
            nodeSizes[id] = {
                w: this.getNodeWidth(node),
                h: this.getNodeHeight(node)
            };
        }
        
        for (const trans of transitions) {
            if (!childIds.includes(trans.from) || !childIds.includes(trans.to)) continue;
            
            const fromNode = children[trans.from];
            const toNode = children[trans.to];
            if (!fromNode || !toNode) continue;
            
            const fromPos = positions[trans.from] || { x: 200, y: 200 };
            const toPos = positions[trans.to] || { x: 400, y: 200 };
            
            const { w: fw, h: fh } = nodeSizes[trans.from];
            const { w: tw, h: th } = nodeSizes[trans.to];
            
            // 计算中心点
            const fcx = fromPos.x + fw / 2;
            const fcy = fromPos.y + fh / 2;
            const tcx = toPos.x + tw / 2;
            const tcy = toPos.y + th / 2;
            
            const dx = tcx - fcx;
            const dy = tcy - fcy;
            
            // 连接点
            let fx, fy, tx, ty;
            if (Math.abs(dx) > Math.abs(dy) * 0.5) {
                fx = dx > 0 ? fromPos.x + fw : fromPos.x;
                fy = fcy;
                tx = dx > 0 ? toPos.x : toPos.x + tw;
                ty = tcy;
            } else {
                fx = fcx;
                fy = dy > 0 ? fromPos.y + fh : fromPos.y;
                tx = tcx;
                ty = dy > 0 ? toPos.y : toPos.y + th;
            }
            
            const isSelected = this.state.selectedTransition === trans;
            const color = isSelected ? '#22c55e' : '#64748b';
            
            // 发光（拖动时跳过）
            if (isSelected && !isDragging) {
                ctx.shadowColor = '#22c55e';
                ctx.shadowBlur = 6;
            }
            
            // 贝塞尔曲线
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            
            const curvature = Math.min(Math.sqrt(dx * dx + dy * dy) * 0.25, 50);
            if (Math.abs(dx) > Math.abs(dy)) {
                ctx.bezierCurveTo(fx + curvature * Math.sign(dx), fy, tx - curvature * Math.sign(dx), ty, tx, ty);
            } else {
                ctx.bezierCurveTo(fx, fy + curvature * Math.sign(dy), tx, ty - curvature * Math.sign(dy), tx, ty);
            }
            ctx.stroke();
            
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            
            // 箭头
            const endAngle = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : Math.PI) : (dy > 0 ? Math.PI / 2 : -Math.PI / 2);
            const arrowSize = 6;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - arrowSize * Math.cos(endAngle - 0.5), ty - arrowSize * Math.sin(endAngle - 0.5));
            ctx.lineTo(tx - arrowSize * Math.cos(endAngle + 0.5), ty - arrowSize * Math.sin(endAngle + 0.5));
            ctx.closePath();
            ctx.fill();
            
            // 事件标签（拖动时简化）
            const labelX = (fx + tx) / 2;
            const labelY = (fy + ty) / 2;
            
            if (isDragging) {
                // 拖动时只显示简单文字
                ctx.fillStyle = '#e2e8f0';
                ctx.font = '10px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(trans.event, labelX, labelY);
            } else {
                // 非拖动时显示完整标签
                ctx.font = '10px system-ui, sans-serif';
                const labelW = ctx.measureText(trans.event).width + 12;
                
                ctx.fillStyle = isSelected ? 'rgba(34, 197, 94, 0.9)' : 'rgba(30, 41, 59, 0.9)';
                this.roundRect(ctx, labelX - labelW / 2, labelY - 9, labelW, 18, 9);
                ctx.fill();
                
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                this.roundRect(ctx, labelX - labelW / 2, labelY - 9, labelW, 18, 9);
                ctx.stroke();
                
                // 标签文字
                ctx.fillStyle = isSelected ? '#fff' : '#e2e8f0';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(trans.event, labelX, labelY);
            }
            ctx.textBaseline = 'alphabetic';
        }
    },
    
    // ========== 状态树 ==========
    renderTree() {
        const container = document.getElementById('hsm-tree');
        if (!container || !this.state.machine) return;
        
        const root = this.state.machine.hierarchy.ROOT;
        container.innerHTML = this.renderTreeNode(root, 0);
        
        // 绑定右键菜单事件
        container.querySelectorAll('.hsm-tree-header').forEach(header => {
            header.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const nodeId = header.dataset.id;
                this.showTreeContextMenu(e.clientX, e.clientY, nodeId);
            });
        });
    },
    
    // 状态树右键菜单
    showTreeContextMenu(screenX, screenY, nodeId) {
        this.hideContextMenu();
        
        const node = this.findNodeById(nodeId);
        if (!node) return;
        
        const isRoot = nodeId === 'ROOT';
        const isCompound = node.type === 'compound';
        const parentNode = this.findParentNode(nodeId);
        const isInitial = parentNode?.initial === nodeId;
        
        const menu = document.createElement('div');
        menu.id = 'hsm-context-menu';
        menu.className = 'hsm-context-menu';
        
        let items = [];
        
        if (isCompound) {
            items.push({ icon: '➕', label: '新建原子状态', action: () => this.createChildState(nodeId, 'atomic') });
            items.push({ icon: '📦', label: '新建复合状态', action: () => this.createChildState(nodeId, 'compound') });
            items.push({ divider: true });
        }
        
        if (!isRoot) {
            items.push({ icon: '✏️', label: '重命名', action: () => this.renameNode(node) });
            items.push({ icon: '📋', label: '复制', action: () => this.copyNode(node) });
            
            if (!isInitial && parentNode) {
                items.push({ icon: '🎯', label: '设为初始状态', action: () => this.setInitialStateInParent(nodeId, parentNode) });
            }
            
            items.push({ icon: '🔄', label: isCompound ? '转为原子状态' : '转为复合状态', action: () => this.toggleNodeType(node) });
            items.push({ divider: true });
            items.push({ icon: '🗑️', label: '删除', action: () => this.deleteNodeFromTree(nodeId), danger: true });
        } else {
            items.push({ icon: '➕', label: '新建原子状态', action: () => this.createChildState(nodeId, 'atomic') });
            items.push({ icon: '📦', label: '新建复合状态', action: () => this.createChildState(nodeId, 'compound') });
        }
        
        menu.innerHTML = items.map((item, idx) => {
            if (item.divider) {
                return '<div class="hsm-context-divider"></div>';
            }
            return `
                <div class="hsm-context-item ${item.danger ? 'danger' : ''}"
                     onclick="HSM.executeTreeContextAction(${idx})">
                    <span class="icon">${item.icon}</span>
                    <span class="label">${item.label}</span>
                </div>
            `;
        }).join('');
        
        this._treeContextActions = items;
        
        menu.style.left = screenX + 'px';
        menu.style.top = screenY + 'px';
        document.body.appendChild(menu);
        
        // 确保菜单不超出屏幕
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = (screenX - menuRect.width) + 'px';
        }
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = (screenY - menuRect.height) + 'px';
        }
    },
    
    executeTreeContextAction(index) {
        const action = this._treeContextActions?.[index];
        if (action && action.action) {
            action.action();
        }
        this.hideContextMenu();
    },
    
    // 在指定父节点下创建子状态
    createChildState(parentId, type = 'atomic') {
        const parent = this.findNodeById(parentId);
        if (!parent) return;
        
        // 确保父节点是复合状态
        if (parent.type !== 'compound') {
            parent.type = 'compound';
            if (!parent.children) parent.children = {};
        }
        
        const id = 'STATE_' + Date.now();
        const level = (parent.level || 0) + 1;
        
        const newNode = {
            id,
            label: type === 'compound' ? '新复合状态' : '新状态',
            type,
            level,
            description: '',
            entryActions: [],
            exitActions: [],
            display: {}
        };
        
        if (type === 'compound') {
            newNode.children = {};
        }
        
        parent.children[id] = newNode;
        
        // 如果是第一个子状态，设为初始状态
        if (Object.keys(parent.children).length === 1) {
            parent.initial = id;
        }
        
        // 设置位置
        const path = this.findNodePath(parentId);
        if (path) {
            const posPath = path.join('/');
            if (!this.state.machine.nodePositions[posPath]) {
                this.state.machine.nodePositions[posPath] = {};
            }
            // 计算新位置
            const existingPositions = Object.values(this.state.machine.nodePositions[posPath] || {});
            const maxX = existingPositions.length > 0 ? Math.max(...existingPositions.map(p => p.x || 0)) : 0;
            this.state.machine.nodePositions[posPath][id] = { x: maxX + 200, y: 150 };
        }
        
        this.renderTree();
        this.render();
        this.showToast(`已创建: ${newNode.label}`, 'success');
        
        // 自动进入重命名
        setTimeout(() => this.renameNode(newNode), 100);
    },
    
    // 查找父节点
    findParentNode(nodeId, root = null, parent = null) {
        root = root || this.state.machine.hierarchy.ROOT;
        if (root.id === nodeId) return parent;
        if (root.children) {
            for (const child of Object.values(root.children)) {
                const found = this.findParentNode(nodeId, child, root);
                if (found !== undefined) return found;
            }
        }
        return undefined;
    },
    
    // 在父节点中设置初始状态
    setInitialStateInParent(nodeId, parentNode) {
        if (parentNode) {
            parentNode.initial = nodeId;
            this.renderTree();
            this.render();
            this.showToast('已设为初始状态', 'success');
        }
    },
    
    // 从树中删除节点
    deleteNodeFromTree(nodeId) {
        const node = this.findNodeById(nodeId);
        if (!node) return;
        
        if (!confirm(`删除 "${node.label || nodeId}"?\n${node.children ? '(包含所有子状态)' : ''}`)) return;
        
        const parent = this.findParentNode(nodeId);
        if (parent && parent.children) {
            delete parent.children[nodeId];
            
            // 如果删除的是初始状态，重新设置
            if (parent.initial === nodeId) {
                const remaining = Object.keys(parent.children);
                parent.initial = remaining.length > 0 ? remaining[0] : null;
            }
        }
        
        // 删除相关转移
        this.state.machine.transitions = (this.state.machine.transitions || []).filter(
            t => t.from !== nodeId && t.to !== nodeId
        );
        
        if (this.state.selectedNode?.id === nodeId) {
            this.state.selectedNode = null;
        }
        
        this.renderTree();
        this.render();
        this.renderProperties(null);
        this.showToast('已删除', 'info');
    },
    
    renderTreeNode(node, depth) {
        const hasChildren = node.children && Object.keys(node.children).length > 0;
        const isSelected = this.state.selectedNode?.id === node.id;
        const isCompound = node.type === 'compound';
        const container = this.getCurrentContainer();
        const isInitial = container.initial === node.id;
        
        // 使用CSS变量控制缩进，每层8px，更紧凑
        const indent = depth * 8;
        
        let html = `
            <div class="hsm-tree-node">
                <div class="hsm-tree-header ${isSelected ? 'selected' : ''}" 
                     style="--indent: ${indent}px;"
                     data-id="${node.id}"
                     onclick="HSM.onTreeClick('${node.id}')"
                     ondblclick="HSM.onTreeDblClick('${node.id}')">
                    <span class="hsm-tree-spacer"></span>
                    <span class="hsm-tree-expand ${hasChildren ? 'expanded' : 'empty'}" 
                          onclick="event.stopPropagation();HSM.toggleTreeNode('${node.id}')">▶</span>
                    <span class="hsm-tree-icon">${isCompound ? '📦' : '⚪'}</span>
                    <span class="hsm-tree-name">${node.label || node.id}${isInitial ? '<span class="hsm-tree-badge initial">初始</span>' : ''}</span>
                </div>
        `;
        
        if (hasChildren) {
            html += '<div class="hsm-tree-children expanded">';
            for (const child of Object.values(node.children)) {
                html += this.renderTreeNode(child, depth + 1);
            }
            html += '</div>';
        }
        
        html += '</div>';
        return html;
    },
    
    toggleTreeNode(nodeId) {
        const header = document.querySelector(`.hsm-tree-header[data-id="${nodeId}"]`);
        if (!header) return;
        
        const expand = header.querySelector('.hsm-tree-expand');
        const children = header.parentElement.querySelector('.hsm-tree-children');
        
        if (expand && children) {
            expand.classList.toggle('expanded');
            children.classList.toggle('expanded');
        }
    },
    
    onTreeClick(nodeId) {
        // 点击树节点 - 导航到该节点并选中
        this.navigateToNode(nodeId);
    },
    
    onTreeDblClick(nodeId) {
        const node = this.findNodeById(nodeId);
        if (node?.type === 'compound') {
            const path = this.findNodePath(nodeId);
            if (path) {
                this.state.currentPath = path;
                this.state.selectedNode = null;
                this.updateBreadcrumb();
                this.updateLevelHint();
                this.render();
            }
        }
    },
    
    findNodeById(nodeId, root = null) {
        root = root || this.state.machine.hierarchy.ROOT;
        if (root.id === nodeId) return root;
        if (root.children) {
            for (const child of Object.values(root.children)) {
                const found = this.findNodeById(nodeId, child);
                if (found) return found;
            }
        }
        return null;
    },
    
    findNodePath(nodeId, root = null, path = ['ROOT']) {
        root = root || this.state.machine.hierarchy.ROOT;
        if (root.id === nodeId) return path;
        if (root.children) {
            for (const child of Object.values(root.children)) {
                const found = this.findNodePath(nodeId, child, [...path, child.id]);
                if (found) return found;
            }
        }
        return null;
    },

    // ========== 事件面板 ==========
    renderEvents() {
        const container = document.getElementById('hsm-events');
        if (!container) return;
        
        const actions = this.state.actionsConfig?.actions || {};
        const actionList = Object.entries(actions);
        
        if (actionList.length === 0) {
            container.innerHTML = '<div class="hsm-empty">暂无动作定义</div>';
            return;
        }
        
        let html = '';
        for (const [key, action] of actionList.slice(0, 20)) {
            html += `
                <div class="hsm-event-item" draggable="true" 
                     ondragstart="HSM.onEventDragStart(event, '${key}')"
                     title="${action.description || key}">
                    <span class="hsm-event-icon">⚡</span>
                    <span class="hsm-event-name">${action.name || key}</span>
                </div>
            `;
        }
        if (actionList.length > 20) {
            html += `<div class="hsm-event-more">还有 ${actionList.length - 20} 个...</div>`;
        }
        container.innerHTML = html;
    },
    
    onEventDragStart(e, actionKey) {
        e.dataTransfer.setData('action', actionKey);
    },

    // ========== 属性面板 ==========
    renderProperties(node) {
        const perfProps = HSMPerf.mark('renderProperties_total');
        
        const container = document.getElementById('hsm-props-content');
        if (!container) {
            perfProps.end();
            return;
        }
        
        if (!node) {
            container.innerHTML = '<div class="hsm-empty">选择节点查看属性</div>';
            perfProps.end();
            return;
        }
        
        const actions = this.state.actionsConfig?.actions || {};
        const expects = this.state.actionsConfig?.expects || {};
        
        // 格式化入口动作显示
        const formatAction = (actionId) => {
            // 界面预设格式: preset:presetId
            if (actionId.startsWith('preset:')) {
                const presetId = actionId.split(':')[1];
                const preset = this.state.presetsConfig?.presets?.[presetId];
                return `📋 ${preset?.name || presetId}`;
            }
            // 动画效果格式: anim:animId:start/stop
            if (actionId.startsWith('anim:')) {
                const parts = actionId.split(':');
                const animId = parts[1];
                const animAction = parts[2];
                const anim = this.state.animationsConfig?.animations?.[animId];
                const icon = animAction === 'start' ? '▶️' : '⏹️';
                const verb = animAction === 'start' ? '启动' : '停止';
                return `${icon} ${verb} ${anim?.name || animId}`;
            }
            // 组件API格式: comp:action:component:param
            if (actionId.startsWith('comp:')) {
                const parts = actionId.split(':');
                const action = parts[1];
                const component = parts[2];
                const param = parts[3];
                
                const icons = {
                    setValue: '🔢', setMode: '🔘', setLevel: '📊',
                    setVisible: '👁', startBehavior: '▶️', stopBehavior: '⏹',
                    showPreset: '📝'
                };
                const icon = icons[action] || '⚙️';
                
                if (action === 'startBehavior' || action === 'stopBehavior') {
                    return `${icon} ${action === 'startBehavior' ? '启动' : '停止'} ${component}`;
                }
                return `${icon} ${component}${param ? ` → ${param}` : ''}`;
            }
            // LCD控制格式: lcd:action
            if (actionId.startsWith('lcd:')) {
                const action = actionId.split(':')[1];
                if (action === 'showAll') return '🔆 全显';
                if (action === 'clearAll') return '🔅 清屏';
                return actionId;
            }
            // 超时格式: timeout:ms
            if (actionId.startsWith('timeout:')) {
                const ms = actionId.split(':')[1];
                return `⏱️ ${ms}ms后`;
            }
            // 硬件控制格式: hw:device:action
            if (actionId.startsWith('hw:')) {
                const parts = actionId.split(':');
                const device = parts[1];
                const hwAction = parts[2];
                const deviceIcons = {
                    laser: hwAction === 'on' ? '🔴' : '⚫',
                    backlight: hwAction === 'on' ? '💡' : '🌑',
                    beep: hwAction === 'short' ? '🔔' : (hwAction === 'long' ? '🔔' : '🔕'),
                    power: '⏻'
                };
                const deviceNames = {
                    laser: '激光',
                    backlight: '背光',
                    beep: '蜂鸣器',
                    power: '电源'
                };
                const actionNames = {
                    on: '开', off: '关', short: '短', long: '长'
                };
                return `${deviceIcons[device] || '⚙️'} ${deviceNames[device] || device}${actionNames[hwAction] || hwAction}`;
            }
            // 变量设置格式: set:var = value
            if (actionId.startsWith('set:')) {
                const expr = actionId.substring(4);
                return `📝 ${expr}`;
            }
            // 变量递增格式: inc:var
            if (actionId.startsWith('inc:')) {
                const varName = actionId.substring(4);
                return `➕ ${varName}++`;
            }
            // 变量递减格式: dec:var
            if (actionId.startsWith('dec:')) {
                const varName = actionId.substring(4);
                return `➖ ${varName}--`;
            }
            // 计算表达式格式: calc:var = expr
            if (actionId.startsWith('calc:')) {
                const expr = actionId.substring(5);
                return `🔢 ${expr}`;
            }
            // 条件动作格式: if:condition then action
            if (actionId.startsWith('if:')) {
                const match = actionId.match(/if:\s*(.+?)\s+then\s+(.+)/);
                if (match) {
                    return `❓ if ${match[1]}`;
                }
                return `❓ ${actionId.substring(3)}`;
            }
            // 历史滚动
            if (actionId === 'scroll:history') {
                return '📜 历史滚动';
            }
            // 普通动作
            return actions[actionId]?.name || actionId;
        };
        
        // 获取动作标签样式
        const getActionTagClass = (actionId) => {
            if (actionId.startsWith('preset:')) return 'hsm-tag-preset';
            if (actionId.startsWith('anim:')) return 'hsm-tag-anim';
            if (actionId.startsWith('comp:')) return 'hsm-tag-comp';
            if (actionId.startsWith('lcd:')) return 'hsm-tag-lcd';
            if (actionId.startsWith('timeout:')) return 'hsm-tag-timeout';
            if (actionId.startsWith('hw:')) return 'hsm-tag-hw';
            if (actionId.startsWith('flow:')) return 'hsm-tag-flow';
            if (actionId.startsWith('macro:')) return 'hsm-tag-macro';
            if (actionId.startsWith('set:') || actionId.startsWith('inc:') || actionId.startsWith('dec:') || actionId.startsWith('assign:')) return 'hsm-tag-var';
            if (actionId.startsWith('calc:')) return 'hsm-tag-calc';
            if (actionId.startsWith('if:')) return 'hsm-tag-cond';
            if (actionId === 'scroll:history') return 'hsm-tag-var';
            return 'hsm-tag-action';
        };
        
        container.innerHTML = `
            <div class="hsm-prop-section">
                <label>ID</label>
                <input type="text" value="${node.id}" disabled class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>名称</label>
                <input type="text" value="${node.label || ''}" 
                       onchange="HSM.updateNodeProp('label', this.value)" class="hsm-input"/>
            </div>
            <div class="hsm-prop-section">
                <label>类型</label>
                <select onchange="HSM.updateNodeProp('type', this.value)" class="hsm-select">
                    <option value="atomic" ${node.type === 'atomic' ? 'selected' : ''}>原子状态</option>
                    <option value="compound" ${node.type === 'compound' ? 'selected' : ''}>复合状态</option>
                </select>
            </div>
            <div class="hsm-prop-section">
                <label>描述</label>
                <textarea onchange="HSM.updateNodeProp('description', this.value)" 
                          class="hsm-textarea">${node.description || ''}</textarea>
            </div>
            
            ${node.type === 'compound' ? `
            <div class="hsm-prop-section hsm-flow-section">
                <label>📊 流程类型</label>
                <select onchange="HSM.updateNodeProp('flowType', this.value)" class="hsm-select">
                    <option value="" ${!node.flowType ? 'selected' : ''}>无</option>
                    <option value="single" ${node.flowType === 'single' ? 'selected' : ''}>单步型 (单次测量)</option>
                    <option value="multi" ${node.flowType === 'multi' ? 'selected' : ''}>多步型 (面积/体积/勾股)</option>
                    <option value="loop" ${node.flowType === 'loop' ? 'selected' : ''}>循环型 (连续测量)</option>
                </select>
                <div class="hsm-hint">单步型/多步型支持撤回，循环型不支持</div>
            </div>
            ${node.flowType === 'multi' ? `
            <div class="hsm-prop-section">
                <label>总步数</label>
                <input type="number" value="${node.totalSteps || 2}" min="2" max="10"
                       onchange="HSM.updateNodeProp('totalSteps', parseInt(this.value))" class="hsm-input"/>
            </div>
            ` : ''}
            ` : ''}
            
            ${node.type === 'atomic' ? `
            <div class="hsm-prop-section hsm-flow-section">
                <label>
                    <input type="checkbox" ${node.isReady ? 'checked' : ''} 
                           onchange="HSM.updateNodeProp('isReady', this.checked)"/>
                    🟢 准备状态
                </label>
                <div class="hsm-hint">准备状态会保存历史，撤回时回到此状态</div>
            </div>
            ${node.isReady ? `
            <div class="hsm-prop-section">
                <label>步骤序号</label>
                <input type="number" value="${node.stepIndex || 1}" min="1" max="10"
                       onchange="HSM.updateNodeProp('stepIndex', parseInt(this.value))" class="hsm-input"/>
                <div class="hsm-hint">多步流程中的步骤编号</div>
            </div>
            ` : ''}
            ` : ''}
            
            <div class="hsm-prop-section">
                <label>组件设置 <button class="hsm-btn-mini" onclick="HSM.showComponentSettings()">⚙️</button></label>
                <div class="hsm-hint">点击设置按钮配置组件状态</div>
                ${this.renderComponentSettingsSummary(node)}
            </div>
            
            <div class="hsm-prop-section">
                <label>入口动作 <button class="hsm-btn-mini" onclick="HSM.showAddDialog('entry')">+</button></label>
                <div class="hsm-tag-list" id="hsm-entry-actions">
                    ${(node.entryActions || []).map(a => `
                        <span class="hsm-tag ${getActionTagClass(a)}">
                            ${formatAction(a)}
                            <span class="hsm-tag-remove" onclick="HSM.removeFromNode('entryActions','${a}')">×</span>
                        </span>
                    `).join('')}
                </div>
            </div>
            
            <div class="hsm-prop-section">
                <label>退出动作 <button class="hsm-btn-mini" onclick="HSM.showAddDialog('exit')">+</button></label>
                <div class="hsm-tag-list" id="hsm-exit-actions">
                    ${(node.exitActions || []).map(a => `
                        <span class="hsm-tag ${getActionTagClass(a)}">
                            ${formatAction(a)}
                            <span class="hsm-tag-remove" onclick="HSM.removeFromNode('exitActions','${a}')">×</span>
                        </span>
                    `).join('')}
                </div>
            </div>
            
            ${node.type === 'compound' ? `
            <div class="hsm-prop-section">
                <label>子状态</label>
                <div class="hsm-children-list">
                    ${Object.values(node.children || {}).map(child => `
                        <div class="hsm-child-item ${this.getCurrentContainer().initial === child.id ? 'initial' : ''}"
                             onclick="HSM.navigateToNode('${child.id}')">
                            <span>${child.type === 'compound' ? '📦' : '⚪'}</span>
                            <span>${child.label || child.id}</span>
                        </div>
                    `).join('')}
                </div>
                ${Object.keys(node.children || {}).length === 0 ? '<div class="hsm-hint">双击进入添加子状态</div>' : ''}
            </div>
            ` : ''}
            
            <div class="hsm-prop-section" style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border-color);">
                <div class="hsm-hint">
                    💡 <strong>快捷键:</strong> A=动作 T=连线 Tab=快速创建
                </div>
            </div>
        `;
        
        perfProps.end();
    },
    
    updateNodeProp(prop, value) {
        if (!this.state.selectedNode) return;
        this.state.selectedNode[prop] = value;
        if (prop === 'type' && value === 'compound' && !this.state.selectedNode.children) {
            this.state.selectedNode.children = {};
        }
        this.render();
        this.renderTree();
    },
    
    // 设置节点的界面预设
    setNodePreset(presetId) {
        if (!this.state.selectedNode) return;
        if (!this.state.selectedNode.display) {
            this.state.selectedNode.display = {};
        }
        
        if (presetId && presetId !== '') {
            this.state.selectedNode.display.preset = presetId;
            // 同时添加到入口动作（如果还没有）
            if (!this.state.selectedNode.entryActions) {
                this.state.selectedNode.entryActions = [];
            }
            const presetAction = `preset:${presetId}`;
            // 移除旧的预设动作
            this.state.selectedNode.entryActions = this.state.selectedNode.entryActions.filter(a => !a.startsWith('preset:'));
            // 添加新的预设动作到开头
            this.state.selectedNode.entryActions.unshift(presetAction);
            
            // 更新LCD预览 - 直接应用预设并渲染
            if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state?.initialized) {
                LcdRuntime.clearAll();
                LcdRuntime.stopAllAnimations();
                
                // 传递变量以支持变量绑定
                const variables = this.getPreviewVariables();
                LcdRuntime.applyPreset(presetId, variables);
                // 强制渲染
                this.renderLcdFromRuntime();
            }
        } else {
            // 清除预设
            delete this.state.selectedNode.display.preset;
            // 移除入口动作中的预设
            if (this.state.selectedNode.entryActions) {
                this.state.selectedNode.entryActions = this.state.selectedNode.entryActions.filter(a => !a.startsWith('preset:'));
            }
            // 清空LCD预览
            if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state?.initialized) {
                LcdRuntime.clearAll();
                this.renderLcdFromRuntime();
            }
        }
        
        this.renderProperties(this.state.selectedNode);
        this.render();
    },
    
    // 渲染组件设置摘要
    renderComponentSettingsSummary(node) {
        const compSettings = node.display?.components || {};
        const count = Object.keys(compSettings).length;
        if (count === 0) {
            return '<div class="hsm-hint" style="color:var(--text-muted);">未设置</div>';
        }
        
        const items = Object.entries(compSettings).map(([compName, setting]) => {
            let valueStr = '';
            if (setting.preset) valueStr = setting.preset;
            else if (setting.value !== undefined) valueStr = String(setting.value);
            else if (setting.visible !== undefined) valueStr = setting.visible ? '显示' : '隐藏';
            return `<span class="hsm-tag hsm-tag-comp">${compName}: ${valueStr}</span>`;
        }).join('');
        
        return `<div class="hsm-tag-list">${items}</div>`;
    },
    
    // 临时组件设置（用于预览）
    _tempCompSettings: null,
    _compPreviewBgImage: null,
    _compToolbarVisible: false,
    
    // 显示组件设置 - 底部工具栏式弹窗
    showComponentSettings() {
        if (!this.state.selectedNode) {
            this.showToast('请先选择节点', 'warning');
            return;
        }
        
        const node = this.state.selectedNode;
        const components = this.state.componentsConfig?.components || {};
        
        // 初始化临时设置
        this._tempCompSettings = JSON.parse(JSON.stringify(node.display?.components || {}));
        
        // 显示底部工具栏
        this._showCompToolbar(node, components);
    },
    
    // 显示底部工具栏式组件设置面板
    _showCompToolbar(node, components) {
        // 移除已有的工具栏
        let toolbar = document.getElementById('hsm-comp-toolbar');
        if (toolbar) toolbar.remove();
        
        // 按类型分组
        const lineComps = [], selectorComps = [], iconComps = [];
        for (const [name, comp] of Object.entries(components)) {
            if (comp.type === 'Line') lineComps.push([name, comp]);
            else if (comp.type === 'Selector') selectorComps.push([name, comp]);
            else if (comp.type === 'Icon') iconComps.push([name, comp]);
        }
        
        // 创建工具栏
        toolbar = document.createElement('div');
        toolbar.id = 'hsm-comp-toolbar';
        toolbar.className = 'hsm-comp-toolbar';
        toolbar.innerHTML = `
            <div class="hsm-comp-toolbar-header">
                <span>⚙️ 组件设置 - ${node.label || node.id}</span>
                <div class="hsm-comp-toolbar-actions">
                    <button class="hsm-comp-quick-btn" onclick="HSM.compQuickSet('allDash')">全横线</button>
                    <button class="hsm-comp-quick-btn" onclick="HSM.compQuickSet('allBlank')">全空白</button>
                    <button class="hsm-comp-quick-btn" onclick="HSM.compQuickSet('ready')">待机</button>
                    <button class="hsm-btn" onclick="HSM.clearTempCompSettings()">🗑️ 清空</button>
                    <button class="hsm-btn" onclick="HSM.closeCompToolbar()">取消</button>
                    <button class="hsm-btn primary" onclick="HSM.saveCompSettings()">✓ 保存</button>
                </div>
            </div>
            <div class="hsm-comp-toolbar-body">
                ${this._renderCompToolbarContent(lineComps, selectorComps, iconComps)}
            </div>
        `;
        
        document.body.appendChild(toolbar);
        this._compToolbarVisible = true;
        
        // 动画显示
        requestAnimationFrame(() => {
            toolbar.classList.add('visible');
        });
    },
    
    // 渲染工具栏内容 - 横向布局
    _renderCompToolbarContent(lineComps, selectorComps, iconComps) {
        const settings = this._tempCompSettings || {};
        let html = '<div class="hsm-comp-toolbar-grid">';
        
        // Line组件 - 横向排列
        if (lineComps.length > 0) {
            html += '<div class="hsm-comp-toolbar-section"><div class="hsm-comp-toolbar-section-title">📊 数字行</div><div class="hsm-comp-toolbar-items">';
            for (const [name, comp] of lineComps) {
                const setting = settings[name] || {};
                const isActive = Object.keys(setting).length > 0 ? 'active' : '';
                html += `
                    <div class="hsm-comp-toolbar-item ${isActive}" id="comp-toolbar-${name}">
                        <label>${name}</label>
                        <select onchange="HSM.onToolbarLineChange('${name}', this.value)">
                            <option value="">--</option>
                            <option value="dash" ${setting.preset === 'dash' ? 'selected' : ''}>-----</option>
                            <option value="blank" ${setting.preset === 'blank' ? 'selected' : ''}>空白</option>
                            <option value="error" ${setting.preset === 'error' ? 'selected' : ''}>Err</option>
                        </select>
                    </div>
                `;
            }
            html += '</div></div>';
        }
        
        // Selector组件
        if (selectorComps.length > 0) {
            html += '<div class="hsm-comp-toolbar-section"><div class="hsm-comp-toolbar-section-title">🔘 选择器</div><div class="hsm-comp-toolbar-items">';
            for (const [name, comp] of selectorComps) {
                const setting = settings[name] || {};
                const isActive = setting.value !== undefined ? 'active' : '';
                html += `
                    <div class="hsm-comp-toolbar-item ${isActive}" id="comp-toolbar-${name}">
                        <label>${name}</label>
                        <select onchange="HSM.onToolbarSelectorChange('${name}', this.value)">
                            <option value="">--</option>
                            ${(comp.options || []).map(opt => 
                                `<option value="${opt.value}" ${setting.value === opt.value ? 'selected' : ''}>${opt.key}</option>`
                            ).join('')}
                        </select>
                    </div>
                `;
            }
            html += '</div></div>';
        }
        
        // Icon组件 - 紧凑的开关
        if (iconComps.length > 0) {
            html += '<div class="hsm-comp-toolbar-section"><div class="hsm-comp-toolbar-section-title">👁 图标</div><div class="hsm-comp-toolbar-items hsm-comp-toolbar-icons">';
            for (const [name, comp] of iconComps) {
                const setting = settings[name] || {};
                const isActive = setting.visible !== undefined ? 'active' : '';
                html += `
                    <div class="hsm-comp-toolbar-icon ${isActive}" id="comp-toolbar-${name}">
                        <label>${name}</label>
                        <select onchange="HSM.onToolbarIconChange('${name}', this.value)">
                            <option value="">--</option>
                            <option value="true" ${setting.visible === true ? 'selected' : ''}>显示</option>
                            <option value="false" ${setting.visible === false ? 'selected' : ''}>隐藏</option>
                        </select>
                    </div>
                `;
            }
            html += '</div></div>';
        }
        
        html += '</div>';
        return html;
    },
    
    // 工具栏事件处理
    onToolbarLineChange(compName, value) {
        if (!this._tempCompSettings) this._tempCompSettings = {};
        
        if (value === '') {
            delete this._tempCompSettings[compName];
        } else {
            this._tempCompSettings[compName] = { preset: value };
        }
        
        this._updateToolbarItemState(compName);
        this.renderLcdPreview(this.state.selectedNode); // 更新主编辑器的LCD预览
    },
    
    onToolbarSelectorChange(compName, value) {
        if (!this._tempCompSettings) this._tempCompSettings = {};
        
        if (value === '') {
            delete this._tempCompSettings[compName];
        } else {
            this._tempCompSettings[compName] = { value: parseInt(value) };
        }
        
        this._updateToolbarItemState(compName);
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    onToolbarIconChange(compName, value) {
        if (!this._tempCompSettings) this._tempCompSettings = {};
        
        if (value === '') {
            delete this._tempCompSettings[compName];
        } else {
            this._tempCompSettings[compName] = { visible: value === 'true' };
        }
        
        this._updateToolbarItemState(compName);
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    _updateToolbarItemState(compName) {
        const item = document.getElementById(`comp-toolbar-${compName}`);
        if (!item) return;
        
        const setting = this._tempCompSettings?.[compName] || {};
        const hasValue = setting.preset || setting.value !== undefined || setting.visible !== undefined;
        
        if (hasValue) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    },
    
    // 关闭工具栏
    closeCompToolbar() {
        const toolbar = document.getElementById('hsm-comp-toolbar');
        if (toolbar) {
            toolbar.classList.remove('visible');
            setTimeout(() => toolbar.remove(), 200);
        }
        this._compToolbarVisible = false;
        this._tempCompSettings = null;
        // 恢复原来的LCD预览
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    // 关闭组件设置面板（兼容旧代码）
    closeCompSettingsPanel() {
        this.closeCompToolbar();
    },
    
    // 保存组件设置
    saveCompSettings() {
        if (this.state.selectedNode) {
            if (!this.state.selectedNode.display) {
                this.state.selectedNode.display = {};
            }
            this.state.selectedNode.display.components = this._tempCompSettings || {};
            this._generateCompActions();
            this.showToast('组件设置已保存', 'success');
        }
        this.closeCompToolbar();
        this.renderProperties(this.state.selectedNode);
        this.renderLcdPreview(this.state.selectedNode);
        this.render();
    },
    
    // 获取变量选项
    getVariableOptions(currentBind) {
        const vars = this.state.machine?.variables || {};
        return Object.entries(vars).map(([name, v]) => 
            `<option value="${name}" ${currentBind === name ? 'selected' : ''}>${name} - ${v.description || v.type}</option>`
        ).join('');
    },
    
    // 渲染组件设置面板内容
    _renderCompSettingsPanel(lineComps, selectorComps, iconComps) {
        const settings = this._tempCompSettings || {};
        let html = '';
        
        // Line组件
        if (lineComps.length > 0) {
            html += '<div class="hsm-comp-group"><div class="hsm-comp-group-title">📊 数字行 (Line)</div>';
            for (const [name, comp] of lineComps) {
                const setting = settings[name] || {};
                const hasOnSet = comp.onSet ? '<span class="hsm-comp-onset">⚡联动</span>' : '';
                const isActive = Object.keys(setting).length > 0 ? 'active' : '';
                html += `
                    <div class="hsm-comp-card ${isActive}" id="comp-card-${name}">
                        <div class="hsm-comp-card-header">
                            ${name}
                            <span class="hsm-comp-desc">${comp.description || ''}</span>
                            ${hasOnSet}
                        </div>
                        <div class="hsm-comp-card-body">
                            <div class="hsm-comp-row">
                                <label>显示内容</label>
                                <select id="comp-${name}-display" onchange="HSM.onTempLineDisplayChange('${name}', this.value)">
                                    <option value="">-- 不设置 --</option>
                                    <option value="dash" ${setting.preset === 'dash' ? 'selected' : ''}>----- (横线)</option>
                                    <option value="blank" ${setting.preset === 'blank' ? 'selected' : ''}>空白</option>
                                    <option value="error" ${setting.preset === 'error' ? 'selected' : ''}>Err (错误)</option>
                                    <option value="value" ${setting.value !== undefined ? 'selected' : ''}>固定数值</option>
                                </select>
                            </div>
                            <div class="hsm-comp-row" id="comp-${name}-value-row" style="display:${setting.value !== undefined ? 'flex' : 'none'}">
                                <label>数值</label>
                                <input type="number" step="0.001" value="${setting.value ?? 0}" id="comp-${name}-value"
                                       onchange="HSM.updateTempCompSetting('${name}', 'value', parseFloat(this.value))"/>
                            </div>
                            <div class="hsm-comp-row">
                                <label>数据类型</label>
                                <select onchange="HSM.updateTempCompSetting('${name}', 'dataType', this.value || null)">
                                    <option value="">-- 不设置 --</option>
                                    <option value="length" ${setting.dataType === 'length' ? 'selected' : ''}>长度</option>
                                    <option value="area" ${setting.dataType === 'area' ? 'selected' : ''}>面积</option>
                                    <option value="volume" ${setting.dataType === 'volume' ? 'selected' : ''}>体积</option>
                                </select>
                            </div>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
        }
        
        // Selector组件
        if (selectorComps.length > 0) {
            html += '<div class="hsm-comp-group"><div class="hsm-comp-group-title">🔘 选择器 (Selector)</div>';
            for (const [name, comp] of selectorComps) {
                const setting = settings[name] || {};
                const hasOnSet = comp.onSet ? '<span class="hsm-comp-onset">⚡联动</span>' : '';
                const isActive = setting.value !== undefined ? 'active' : '';
                html += `
                    <div class="hsm-comp-card ${isActive}" id="comp-card-${name}">
                        <div class="hsm-comp-card-header">
                            ${name}
                            <span class="hsm-comp-desc">${comp.description || ''}</span>
                            ${hasOnSet}
                        </div>
                        <div class="hsm-comp-card-body">
                            <div class="hsm-comp-row">
                                <label>选项</label>
                                <select onchange="HSM.updateTempCompSetting('${name}', 'value', this.value === '' ? null : parseInt(this.value))">
                                    <option value="">-- 不设置 --</option>
                                    ${(comp.options || []).map(opt => 
                                        `<option value="${opt.value}" ${setting.value === opt.value ? 'selected' : ''}>${opt.key} (${opt.value})</option>`
                                    ).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                `;
            }
            html += '</div>';
        }
        
        // Icon组件
        if (iconComps.length > 0) {
            html += '<div class="hsm-comp-group"><div class="hsm-comp-group-title">👁 图标 (Icon)</div>';
            html += '<div class="hsm-icon-grid">';
            for (const [name, comp] of iconComps) {
                const setting = settings[name] || {};
                const hasOnSet = comp.onSet ? ' ⚡' : '';
                const isActive = setting.visible !== undefined ? 'active' : '';
                html += `
                    <div class="hsm-icon-item ${isActive}" id="comp-card-${name}">
                        <label>${name}${hasOnSet}</label>
                        <select onchange="HSM.updateTempCompSetting('${name}', 'visible', this.value === '' ? null : this.value === 'true')">
                            <option value="">--</option>
                            <option value="true" ${setting.visible === true ? 'selected' : ''}>显示</option>
                            <option value="false" ${setting.visible === false ? 'selected' : ''}>隐藏</option>
                        </select>
                    </div>
                `;
            }
            html += '</div></div>';
        }
        
        return html;
    },
    
    // 更新统计信息
    _updateCompStats() {
        const settings = this._tempCompSettings || {};
        const compCount = Object.keys(settings).filter(k => {
            const s = settings[k];
            return s.preset || s.value !== undefined || s.visible !== undefined;
        }).length;
        const actionCount = this._countTempActions();
        
        const compCountEl = document.getElementById('hsm-comp-count');
        const actionCountEl = document.getElementById('hsm-action-count');
        if (compCountEl) compCountEl.textContent = compCount;
        if (actionCountEl) actionCountEl.textContent = actionCount;
    },
    
    // 更新右侧LCD预览（复用已有的renderLcdPreview）- 已废弃，保留兼容
    _updateLcdPreviewFromTemp() {
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    _countTempActions() {
        const settings = this._tempCompSettings || {};
        let count = 0;
        for (const [compName, setting] of Object.entries(settings)) {
            if (setting.preset) count++;
            else if (setting.value !== undefined) count++;
            if (setting.dataType) count++;
            if (setting.visible !== undefined) count++;
        }
        return count;
    },
    
    onTempLineDisplayChange(compName, displayType) {
        const valueRow = document.getElementById(`comp-${compName}-value-row`);
        if (valueRow) valueRow.style.display = displayType === 'value' ? 'flex' : 'none';
        
        if (!this._tempCompSettings) this._tempCompSettings = {};
        
        if (displayType === '' || displayType === null) {
            delete this._tempCompSettings[compName];
        } else if (displayType === 'dash' || displayType === 'blank' || displayType === 'error') {
            this._tempCompSettings[compName] = { preset: displayType };
        } else if (displayType === 'value') {
            const valueInput = document.getElementById(`comp-${compName}-value`);
            this._tempCompSettings[compName] = { value: parseFloat(valueInput?.value) || 0 };
        }
        
        this._updateCompCardState(compName);
        this._updateCompStats();
        this._updateLcdPreviewFromTemp();
    },
    
    updateTempCompSetting(compName, prop, value) {
        if (!this._tempCompSettings) this._tempCompSettings = {};
        
        if (value === null || value === '' || value === undefined) {
            if (this._tempCompSettings[compName]) {
                delete this._tempCompSettings[compName][prop];
                if (Object.keys(this._tempCompSettings[compName]).length === 0) {
                    delete this._tempCompSettings[compName];
                }
            }
        } else {
            if (!this._tempCompSettings[compName]) {
                this._tempCompSettings[compName] = {};
            }
            if (prop === 'preset') {
                delete this._tempCompSettings[compName].value;
            } else if (prop === 'value') {
                delete this._tempCompSettings[compName].preset;
            }
            this._tempCompSettings[compName][prop] = value;
        }
        
        this._updateCompCardState(compName);
        this._updateCompStats();
        this._updateLcdPreviewFromTemp();
    },
    
    _updateCompCardState(compName) {
        const card = document.getElementById(`comp-card-${compName}`);
        if (!card) return;
        
        const setting = this._tempCompSettings?.[compName] || {};
        const hasValue = setting.preset || setting.value !== undefined || setting.visible !== undefined;
        
        if (hasValue) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    },
    
    compQuickSet(preset) {
        const components = this.state.componentsConfig?.components || {};
        this._tempCompSettings = {};
        
        if (preset === 'allDash') {
            for (const [name, comp] of Object.entries(components)) {
                if (comp.type === 'Line') {
                    this._tempCompSettings[name] = { preset: 'dash' };
                }
            }
        } else if (preset === 'allBlank') {
            for (const [name, comp] of Object.entries(components)) {
                if (comp.type === 'Line') {
                    this._tempCompSettings[name] = { preset: 'blank' };
                }
            }
        } else if (preset === 'ready') {
            this._tempCompSettings = {
                line4: { preset: 'dash' },
                laser: { visible: false },
                battery: { value: 3 }
            };
        } else if (preset === 'measuring') {
            this._tempCompSettings = {
                laser: { visible: true }
            };
        } else if (preset === 'error') {
            this._tempCompSettings = {
                line4: { preset: 'error' }
            };
        }
        
        // 刷新工具栏
        this._refreshCompToolbar();
        // 更新主编辑器的LCD预览
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    // 刷新工具栏内容
    _refreshCompToolbar() {
        const components = this.state.componentsConfig?.components || {};
        const lineComps = [], selectorComps = [], iconComps = [];
        for (const [name, comp] of Object.entries(components)) {
            if (comp.type === 'Line') lineComps.push([name, comp]);
            else if (comp.type === 'Selector') selectorComps.push([name, comp]);
            else if (comp.type === 'Icon') iconComps.push([name, comp]);
        }
        
        const body = document.querySelector('.hsm-comp-toolbar-body');
        if (body) {
            body.innerHTML = this._renderCompToolbarContent(lineComps, selectorComps, iconComps);
        }
    },
    
    clearTempCompSettings() {
        this._tempCompSettings = {};
        this._refreshCompToolbar();
        this.renderLcdPreview(this.state.selectedNode);
    },
    
    _generateCompActions() {
        if (!this.state.selectedNode) return;
        
        const settings = this.state.selectedNode.display?.components || {};
        const components = this.state.componentsConfig?.components || {};
        const actions = [];
        
        for (const [compName, setting] of Object.entries(settings)) {
            const comp = components[compName];
            if (!comp) continue;
            
            if (comp.type === 'Line') {
                if (setting.preset) {
                    if (setting.preset === 'dash') {
                        actions.push(`${compName} = '-----'`);
                    } else if (setting.preset === 'blank') {
                        actions.push(`${compName} = ''`);
                    } else if (setting.preset === 'error') {
                        actions.push(`${compName} = 'Err'`);
                    }
                } else if (setting.value !== undefined) {
                    actions.push(`${compName} = ${setting.value}`);
                }
                if (setting.dataType) {
                    actions.push(`comp:setDataType:${compName}:${setting.dataType}`);
                }
            } else if (comp.type === 'Selector') {
                if (setting.value !== undefined) {
                    actions.push(`${compName} = ${setting.value}`);
                }
            } else if (comp.type === 'Icon') {
                if (setting.visible !== undefined) {
                    actions.push(`${compName} = ${setting.visible}`);
                }
            }
        }
        
        if (actions.length === 0) return;
        
        if (!this.state.selectedNode.entryActions) {
            this.state.selectedNode.entryActions = [];
        }
        this.state.selectedNode.entryActions = this.state.selectedNode.entryActions.filter(a => {
            if (a.startsWith('comp:')) return false;
            if (a.startsWith('macro:')) return true;
            if (a.startsWith('anim:')) return true;
            if (a.startsWith('hw:')) return true;
            const match = a.match(/^(\w+)\s*=/);
            if (match) {
                const name = match[1];
                if (this.state.componentsConfig?.components?.[name]) return false;
            }
            return true;
        });
        
        this.state.selectedNode.entryActions.unshift(...actions);
    },
    
    removeFromNode(type, value) {
        if (!this.state.selectedNode) return;
        if (type === 'entryActions') {
            this.state.selectedNode.entryActions = (this.state.selectedNode.entryActions || []).filter(a => a !== value);
        } else if (type === 'exitActions') {
            this.state.selectedNode.exitActions = (this.state.selectedNode.exitActions || []).filter(a => a !== value);
        }
        this.renderProperties(this.state.selectedNode);
        this.renderLcdPreview(this.state.selectedNode);
        this.render();
    },
    
    // ========== 可搜索下拉对话框 ==========
    showAddDialog(type) {
        if (!this.state.selectedNode) {
            this.showToast('请先选择节点', 'warning');
            return;
        }
        
        let items = [];
        let title = '';
        
        if (type === 'entry' || type === 'exit') {
            title = type === 'entry' ? '添加入口动作' : '添加退出动作';
            
            const components = this.state.componentsConfig?.components || {};
            const animations = this.state.animationsConfig?.animations || {};
            const macros = this.state.macrosConfig?.macros || {};
            
            // ========== 1. 组件赋值 (组件名=变量名) ==========
            for (const [compName, comp] of Object.entries(components)) {
                const hasOnSet = comp.onSet ? ' ⚡' : '';
                
                if (comp.type === 'Line') {
                    // Line: 直接赋值
                    items.push({
                        id: `${compName} = `,
                        name: `🔢 ${compName} = 数值`,
                        desc: `${comp.description || ''} (输入数值或变量)`,
                        category: '� Linne',
                        needsInput: true,
                        placeholder: '12.345 或 distance'
                    });
                    items.push({
                        id: `${compName} = '-----'`,
                        name: `➖ ${compName} = -----`,
                        desc: '显示横线',
                        category: '� Liine'
                    });
                    items.push({
                        id: `${compName} = ''`,
                        name: `⬜ ${compName} = 空白`,
                        desc: '清空显示',
                        category: '�  Line'
                    });
                    items.push({
                        id: `${compName} = 'Err'`,
                        name: `❌ ${compName} = Err`,
                        desc: '显示错误',
                        category: '� Line组'
                    });
                } else if (comp.type === 'Selector') {
                    for (const opt of comp.options || []) {
                        items.push({
                            id: `${compName} = ${opt.value}`,
                            name: `🔘 ${compName} = ${opt.key}${hasOnSet}`,
                            desc: comp.description || '',
                            category: '🔘 Selector'
                        });
                    }
                } else if (comp.type === 'Icon') {
                    items.push({
                        id: `${compName} = true`,
                        name: `👁 ${compName} = 显示${hasOnSet}`,
                        desc: comp.description || '',
                        category: '👁 Icon'
                    });
                    items.push({
                        id: `${compName} = false`,
                        name: `🚫 ${compName} = 隐藏${hasOnSet}`,
                        desc: comp.description || '',
                        category: '👁 Icon'
                    });
                }
            }
            
            // ========== 2. 计算表达式 ==========
            items.push({
                id: 'line4 = line2 * line3',
                name: '📐 面积计算',
                desc: 'line4 = line2 × line3',
                category: '🔢 计算'
            });
            items.push({
                id: 'line4 = line1 * line2 * line3',
                name: '📦 体积计算',
                desc: 'line4 = line1 × line2 × line3',
                category: '🔢 计算'
            });
            items.push({
                id: 'calc:',
                name: '🔢 自定义计算',
                desc: '输入计算表达式',
                category: '🔢 计算',
                needsInput: true,
                placeholder: 'line4 = sqrt(line1^2 - line2^2)'
            });
            
            // ========== 3. 宏动作 ==========
            for (const [macroId, macro] of Object.entries(macros)) {
                items.push({
                    id: `macro:${macroId}`,
                    name: `${macro.icon || '📜'} ${macro.name}`,
                    desc: macro.description,
                    category: `📜 宏`
                });
            }
            
            // ========== 4. 动画控制 ==========
            for (const [animId, anim] of Object.entries(animations)) {
                items.push({
                    id: `anim:${animId}:start`,
                    name: `▶️ ${anim.name || animId}`,
                    desc: anim.description || '启动动画',
                    category: '✨ 动画'
                });
                items.push({
                    id: `anim:${animId}:startEx:300:15000`,
                    name: `⏱️ ${anim.name || animId} (带参数)`,
                    desc: '启动动画(间隔300ms,超时15s)',
                    category: '✨ 动画'
                });
                items.push({
                    id: `anim:${animId}:stop`,
                    name: `⏹️ 停止 ${anim.name || animId}`,
                    desc: '停止动画',
                    category: '✨ 动画'
                });
            }
            
            // ========== 5. LCD控制 ==========
            items.push({
                id: 'lcd:showAll',
                name: '🔆 LCD全显',
                desc: '点亮所有段码',
                category: '📺 LCD'
            });
            items.push({
                id: 'lcd:clearAll',
                name: '🔅 LCD清屏',
                desc: '熄灭所有段码',
                category: '📺 LCD'
            });
            
            // ========== 6. 硬件控制 ==========
            items.push({
                id: 'hw:beep:short',
                name: '🔔 短蜂鸣',
                desc: '短促蜂鸣提示',
                category: '🔧 硬件'
            });
            items.push({
                id: 'hw:beep:long',
                name: '🔔 长蜂鸣',
                desc: '长蜂鸣提示',
                category: '🔧 硬件'
            });
            items.push({
                id: 'hw:backlight:on',
                name: '💡 背光开',
                desc: '打开背光',
                category: '🔧 硬件'
            });
            items.push({
                id: 'hw:backlight:off',
                name: '🌙 背光关',
                desc: '关闭背光',
                category: '🔧 硬件'
            });
            
            // ========== 7. 流程控制 ==========
            items.push({
                id: 'flow:setType:single',
                name: '📏 单步流程',
                desc: '设置为单步流程(单次测量)',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:setType:multi',
                name: '📐 多步流程',
                desc: '设置为多步流程(面积/体积/勾股)',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:setType:loop',
                name: '🔄 循环流程',
                desc: '设置为循环流程(连续测量)',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:onEnterReady',
                name: '🎯 进入准备状态',
                desc: '标记进入准备状态，保存快照',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:storeSlot:2',
                name: '💾 存储到Line3',
                desc: '存储测量值到slot[2]',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:storeSlot:3',
                name: '💾 存储到Line4',
                desc: '存储测量值到slot[3]',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:undo',
                name: '↩️ 撤回',
                desc: '撤回到上一个准备状态',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:scrollUp',
                name: '⬆️ 数据上移',
                desc: 'slot[0]←slot[1]←slot[2]←slot[3]',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:calcArea',
                name: '📐 计算面积',
                desc: 'slot[1] × slot[2] → slot[3]',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:calcVolume',
                name: '📦 计算体积',
                desc: 'slot[0] × slot[1] × slot[2] → slot[3]',
                category: '🔀 流程'
            });
            items.push({
                id: 'flow:clearSlots',
                name: '🗑️ 清空数据槽',
                desc: '清空所有数据槽',
                category: '🔀 流程'
            });
            
            // ========== 8. 超时 ==========
            items.push({
                id: 'timeout:',
                name: '⏱️ 超时',
                desc: '设置超时时间(毫秒)',
                category: '⏱️ 定时',
                needsInput: true,
                placeholder: '500'
            });
        }
        
        this.showSearchableDialog(title, items, (selected) => {
            this.addToNode(type, selected);
        });
    },
    
    showSearchableDialog(title, items, onSelect) {
        // 移除旧对话框
        const old = document.getElementById('hsm-search-dialog');
        if (old) old.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'hsm-search-dialog';
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog">
                <div class="hsm-dialog-header">
                    <span>${title}</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <input type="text" class="hsm-search-input" placeholder="搜索..." 
                           oninput="HSM.filterDialogItems(this.value)"/>
                    <div class="hsm-search-list" id="hsm-dialog-list"></div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this._dialogItems = items;
        this._dialogCallback = onSelect;
        this.filterDialogItems('');
        
        dialog.querySelector('.hsm-search-input').focus();
    },
    
    filterDialogItems(query) {
        const list = document.getElementById('hsm-dialog-list');
        if (!list) return;
        
        const q = query.toLowerCase();
        const filtered = this._dialogItems.filter(item => 
            item.name.toLowerCase().includes(q) || 
            item.id.toLowerCase().includes(q) ||
            (item.desc && item.desc.toLowerCase().includes(q)) ||
            (item.category && item.category.toLowerCase().includes(q))
        );
        
        if (filtered.length === 0) {
            list.innerHTML = '<div class="hsm-empty">无匹配项</div>';
            return;
        }
        
        // 按分类分组
        const groups = {};
        for (const item of filtered.slice(0, 80)) {
            const cat = item.category || '其他';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(item);
        }
        
        let html = '';
        for (const [cat, items] of Object.entries(groups)) {
            html += `<div class="hsm-search-category">${cat}</div>`;
            html += items.map(item => `
                <div class="hsm-search-item" onclick="HSM.selectDialogItem('${item.id}')">
                    <div class="hsm-search-item-name">${item.name}</div>
                    ${item.desc ? `<div class="hsm-search-item-desc">${item.desc}</div>` : ''}
                </div>
            `).join('');
        }
        
        list.innerHTML = html;
    },
    
    selectDialogItem(id) {
        const item = this._dialogItems.find(i => i.id === id);
        if (!item) return;
        
        // 需要用户输入的动作
        if (item.needsInput) {
            const dialog = document.getElementById('hsm-search-dialog');
            if (dialog) dialog.remove();
            
            // 根据动作类型显示不同的输入提示
            let placeholder = '';
            let example = '';
            if (id.startsWith('comp:setValue:')) {
                const compName = id.split(':')[2];
                placeholder = `输入 ${compName} 的值`;
                example = '例如: 12.345 或 distance';
            } else if (id === 'assign:') {
                placeholder = '变量赋值表达式';
                example = '例如: line4 = distance';
            } else if (id === 'calc:') {
                placeholder = '计算表达式';
                example = '例如: area = line3 * line4';
            } else if (id === 'if:') {
                placeholder = '条件表达式';
                example = '例如: battery == 0 then hw:powerOff';
            } else if (id === 'script:') {
                placeholder = '脚本代码';
                example = '例如: history.push(line4)';
            }
            
            const input = prompt(`${placeholder}\n${example}`);
            if (input && input.trim()) {
                // 构建完整的动作ID
                let finalId;
                if (id.startsWith('comp:setValue:')) {
                    finalId = `${id}:${input.trim()}`;
                } else {
                    finalId = `${id} ${input.trim()}`;
                }
                
                if (this._dialogCallback) {
                    this._dialogCallback({ ...item, id: finalId });
                }
            }
            return;
        }
        
        if (this._dialogCallback) {
            this._dialogCallback(item);
        }
        const dialog = document.getElementById('hsm-search-dialog');
        if (dialog) dialog.remove();
    },
    
    addToNode(type, selected) {
        if (!this.state.selectedNode) return;
        
        // selected 可能是对象(新格式)或字符串ID(旧格式)
        const value = typeof selected === 'object' ? selected.id : selected;
        
        if (type === 'entry') {
            if (!this.state.selectedNode.entryActions) this.state.selectedNode.entryActions = [];
            if (!this.state.selectedNode.entryActions.includes(value)) {
                this.state.selectedNode.entryActions.push(value);
            }
        } else if (type === 'exit') {
            if (!this.state.selectedNode.exitActions) this.state.selectedNode.exitActions = [];
            if (!this.state.selectedNode.exitActions.includes(value)) {
                this.state.selectedNode.exitActions.push(value);
            }
        }
        
        this.renderProperties(this.state.selectedNode);
        this.renderLcdPreview(this.state.selectedNode);
        this.render();
    },

    // ========== LCD预览 ==========
    
    // LCD渲染防抖定时器
    _lcdRenderTimer: null,
    
    // 初始化LcdRuntime
    async initLcdRuntime() {
        if (typeof LcdRuntime === 'undefined') {
            console.warn('[HSM] LcdRuntime 未加载');
            return;
        }
        
        try {
            const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
            await LcdRuntime.init(deviceId);
            
            // 监听缓冲区更新 - 使用防抖避免频繁渲染
            LcdRuntime.on('onBufferUpdate', () => {
                if (this._lcdRenderTimer) clearTimeout(this._lcdRenderTimer);
                this._lcdRenderTimer = setTimeout(() => {
                    this.renderLcdFromRuntime();
                }, 16); // 约60fps
            });
            
            console.log('[HSM] LcdRuntime 初始化完成');
            this.renderLcdFromRuntime();
        } catch (e) {
            console.error('[HSM] LcdRuntime 初始化失败:', e);
        }
    },
    
    // 初始化AnimController (动画控制器)
    async initAnimController() {
        if (typeof AnimController === 'undefined') {
            console.warn('[HSM] AnimController 未加载');
            return;
        }
        
        try {
            const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
            await AnimController.init(deviceId);
            
            // 监听缓冲区更新
            AnimController.on('onBufferUpdate', () => {
                this.renderLcdFromRuntime();
            });
            
            // 监听硬件回调
            AnimController.on('onHardware', (hwName) => {
                this.simLog?.('hw', `硬件回调: ${hwName}`, '⚡');
                console.log(`[HSM] 硬件回调: hw_${hwName}()`);
            });
            
            console.log('[HSM] AnimController 初始化完成');
        } catch (e) {
            console.error('[HSM] AnimController 初始化失败:', e);
        }
    },
    
    // 使用LcdRuntime渲染LCD预览
    renderLcdFromRuntime() {
        if (!this.lcdCanvas || !this.lcdCtx) return;
        if (typeof LcdRuntime === 'undefined' || !LcdRuntime.state?.initialized) return;
        
        const perfTotal = HSMPerf.mark('lcdRuntime_total');
        
        const ctx = this.lcdCtx;
        const canvas = this.lcdCanvas;
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        
        // 计算画布尺寸 - 基于原始图片尺寸
        let w = 400, h = 200;
        if (img) {
            w = config?.imageWidth || img.naturalWidth || 400;
            h = config?.imageHeight || img.naturalHeight || 200;
        }
        
        // 自适应容器宽度，保持宽高比
        const container = canvas.parentElement;
        if (container) {
            const containerW = container.clientWidth - 12;  // 留点边距
            const scale = Math.min(containerW / w, 2.5);  // 最大放大2.5倍
            this.state.lcdScale = scale;
            canvas.width = w * scale;
            canvas.height = h * scale;
            // 设置CSS尺寸保持清晰
            canvas.style.width = canvas.width + 'px';
            canvas.style.height = canvas.height + 'px';
        }
        
        const s = this.state.lcdScale;
        
        // 背景
        ctx.fillStyle = '#0a1a0a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 背景图
        if (img) {
            ctx.globalAlpha = 0.4;
            ctx.drawImage(img, 0, 0, w * s, h * s);
            ctx.globalAlpha = 1;
        }
        
        if (!config?.elements) {
            perfTotal.end();
            return;
        }
        
        const perfPixels = HSMPerf.mark('lcdRuntime_pixels');
        
        // 从LcdRuntime获取缓冲区状态渲染 - 优化：分批绘制
        // 先绘制所有暗淡的段
        ctx.fillStyle = 'rgba(30, 50, 30, 0.3)';
        for (const elem of config.elements) {
            for (const seg of elem.segments || []) {
                const segIdx = parseInt(seg.seg);
                const comIdx = parseInt(seg.com);
                if (LcdRuntime.getSegment(segIdx, comIdx)) continue; // 跳过亮的
                
                const pixels = seg.pixelMask || seg.pixels || [];
                if (pixels.length === 0) continue;
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, Math.max(s, 1), Math.max(s, 1));
                }
            }
        }
        
        // 再绘制所有亮的段
        ctx.fillStyle = '#00ff88';
        for (const elem of config.elements) {
            for (const seg of elem.segments || []) {
                const segIdx = parseInt(seg.seg);
                const comIdx = parseInt(seg.com);
                if (!LcdRuntime.getSegment(segIdx, comIdx)) continue; // 跳过暗的
                
                const pixels = seg.pixelMask || seg.pixels || [];
                if (pixels.length === 0) continue;
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, Math.max(s, 1), Math.max(s, 1));
                }
            }
        }
        
        perfPixels.end();
        perfTotal.end();
    },
    
    // 预览状态节点的LCD显示
    previewNodeLcd(node) {
        if (typeof LcdRuntime === 'undefined' || !LcdRuntime.state?.initialized) {
            return;
        }
        
        const perfPreview = HSMPerf.mark('previewNodeLcd');
        
        // 清空当前显示
        LcdRuntime.clearAll();
        LcdRuntime.stopAllAnimations();
        
        if (!node) {
            this.renderLcdFromRuntime();
            perfPreview.end();
            return;
        }
        
        // 获取变量值
        const variables = this.getPreviewVariables();
        
        // 1. 先应用组件设置（如果有）
        if (node.display?.components && Object.keys(node.display.components).length > 0) {
            this.applyComponentSettings(node.display.components);
        }
        
        // 2. 执行入口动作
        if (node.entryActions && node.entryActions.length > 0) {
            for (const action of node.entryActions) {
                this.executePreviewAction(action, variables);
            }
        }
        
        // 3. 点亮直接指定的LCD元素
        if (node.display?.lcdElements) {
            for (const elemName of node.display.lcdElements) {
                LcdRuntime.setElement(elemName, true);
            }
        }
        
        const perfRenderLcd = HSMPerf.mark('renderLcdFromRuntime');
        this.renderLcdFromRuntime();
        perfRenderLcd.end();
        
        perfPreview.end();
    },
    
    // 应用组件设置到LCD预览
    applyComponentSettings(compSettings) {
        if (!compSettings || typeof LcdRuntime === 'undefined') return;
        
        const components = this.state.componentsConfig?.components || {};
        
        for (const [compName, setting] of Object.entries(compSettings)) {
            const comp = components[compName];
            if (!comp) continue;
            
            if (comp.type === 'Line') {
                // 数字行
                if (setting.preset === 'dash') {
                    this.renderLineDash(compName, comp);
                } else if (setting.preset === 'blank') {
                    // 空白 - 不显示任何内容
                } else if (setting.preset === 'error') {
                    this.renderLineError(compName, comp);
                } else if (setting.value !== undefined) {
                    this.renderLineValue(compName, comp, setting.value);
                }
            } else if (comp.type === 'Selector') {
                // 选择器
                if (setting.value !== undefined) {
                    const opt = comp.options?.find(o => o.value === setting.value);
                    if (opt?.elements) {
                        for (const elemName of opt.elements) {
                            LcdRuntime.setElement(elemName, true);
                        }
                    }
                    // 框架元素
                    if (comp.frame) {
                        for (const frameName of comp.frame) {
                            LcdRuntime.setElement(frameName, true);
                        }
                    }
                }
            } else if (comp.type === 'Icon') {
                // 图标
                if (setting.visible === true) {
                    for (const elemName of (comp.elements || [])) {
                        LcdRuntime.setElement(elemName, true);
                    }
                }
            }
        }
    },
    
    // 渲染Line组件显示横线
    renderLineDash(compName, comp) {
        const digits = comp.digits || [];
        for (const digit of digits) {
            // 只点亮G段（横线）
            const elemName = digit.element;
            // 通过LcdRuntime设置元素的G段
            if (typeof LcdRuntime !== 'undefined') {
                // 优先使用 LcdRuntime.state.lcdProject，否则使用 this.state.lcdConfig
                const lcdProject = LcdRuntime.state?.lcdProject || this.state.lcdConfig;
                const elem = lcdProject?.elements?.find(e => e.name === elemName);
                if (elem) {
                    const gSeg = elem.segments?.find(s => s.name === 'G' || s.name === 'g');
                    if (gSeg) {
                        LcdRuntime.setSegment(parseInt(gSeg.seg), parseInt(gSeg.com), true);
                    }
                }
            }
        }
    },
    
    // 渲染Line组件显示Err
    renderLineError(compName, comp) {
        // 简化处理：显示横线
        this.renderLineDash(compName, comp);
    },
    
    // 渲染Line组件显示数值
    renderLineValue(compName, comp, value) {
        const digits = comp.digits || [];
        const dots = comp.dots || [];
        
        // 格式化数值
        const absValue = Math.abs(value);
        const valueStr = absValue.toFixed(3);
        const parts = valueStr.split('.');
        const intPart = parts[0];
        const decPart = parts[1] || '';
        const fullStr = intPart + decPart;
        
        // 从右往左填充数字
        const digitChars = fullStr.split('').reverse();
        const dotPos = decPart.length; // 小数点位置（从右数）
        
        const segMap = {
            '0': ['A', 'B', 'C', 'D', 'E', 'F'],
            '1': ['B', 'C'],
            '2': ['A', 'B', 'D', 'E', 'G'],
            '3': ['A', 'B', 'C', 'D', 'G'],
            '4': ['B', 'C', 'F', 'G'],
            '5': ['A', 'C', 'D', 'F', 'G'],
            '6': ['A', 'C', 'D', 'E', 'F', 'G'],
            '7': ['A', 'B', 'C'],
            '8': ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
            '9': ['A', 'B', 'C', 'D', 'F', 'G'],
        };
        
        // 优先使用 LcdRuntime.state.lcdProject，否则使用 this.state.lcdConfig
        const lcdProject = LcdRuntime.state?.lcdProject || this.state.lcdConfig;
        
        for (let i = 0; i < digits.length && i < digitChars.length; i++) {
            const digit = digits[digits.length - 1 - i];
            const char = digitChars[i];
            const segsToLight = segMap[char] || [];
            
            const elem = lcdProject?.elements?.find(e => e.name === digit.element);
            if (elem) {
                for (const segName of segsToLight) {
                    const seg = elem.segments?.find(s => s.name === segName || s.name === segName.toLowerCase());
                    if (seg && typeof LcdRuntime !== 'undefined') {
                        LcdRuntime.setSegment(parseInt(seg.seg), parseInt(seg.com), true);
                    }
                }
            }
        }
        
        // 点亮小数点
        if (dotPos > 0 && dotPos <= dots.length) {
            const dotInfo = dots[dots.length - dotPos];
            if (dotInfo) {
                const dotElem = lcdProject?.elements?.find(e => e.name === dotInfo.element);
                if (dotElem && dotElem.segments?.[0] && typeof LcdRuntime !== 'undefined') {
                    const seg = dotElem.segments[0];
                    LcdRuntime.setSegment(parseInt(seg.seg), parseInt(seg.com), true);
                }
            }
        }
    },
    
    // 获取预览用的变量值
    getPreviewVariables() {
        // 如果模拟器有变量，使用模拟器的
        if (this.simState?.variables && Object.keys(this.simState.variables).length > 0) {
            return this.simState.variables;
        }
        
        // 否则从状态机定义中获取默认值
        const vars = {};
        const defs = this.state.machine?.variables || {};
        for (const [name, def] of Object.entries(defs)) {
            vars[name] = def.default;
        }
        return vars;
    },
    
    // 执行预览动作
    executePreviewAction(actionId, variables) {
        if (typeof LcdRuntime === 'undefined') return;
        
        // 使用传入的变量或获取默认变量
        const vars = variables || this.getPreviewVariables();
        
        // 新语法: compName = value (组件赋值)
        const assignMatch = actionId.match(/^(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            const compName = assignMatch[1];
            let value = assignMatch[2].trim();
            
            const comp = this.state.componentsConfig?.components?.[compName];
            if (comp) {
                if (comp.type === 'Line') {
                    // 处理特殊值
                    if (value === "'-----'" || value === '"-----"') {
                        this.renderLineDash(compName, comp);
                    } else if (value === "''" || value === '""') {
                        // 空白，不显示
                    } else if (value === "'Err'" || value === '"Err"') {
                        this.renderLineError(compName, comp);
                    } else {
                        // 数值
                        const numValue = parseFloat(value);
                        if (!isNaN(numValue)) {
                            this.renderLineValue(compName, comp, numValue);
                        }
                    }
                } else if (comp.type === 'Selector') {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue)) {
                        const opt = comp.options?.find(o => o.value === numValue);
                        if (opt?.elements) {
                            for (const elemName of opt.elements) {
                                LcdRuntime.setElement(elemName, true);
                            }
                        }
                        if (comp.frame) {
                            for (const frameName of comp.frame) {
                                LcdRuntime.setElement(frameName, true);
                            }
                        }
                    }
                } else if (comp.type === 'Icon') {
                    const visible = value === 'true';
                    if (visible) {
                        for (const elemName of (comp.elements || [])) {
                            LcdRuntime.setElement(elemName, true);
                        }
                    }
                }
                return;
            }
        }
        
        // 界面预设
        if (actionId.startsWith('preset:')) {
            const presetId = actionId.split(':')[1];
            LcdRuntime.applyPreset(presetId, vars);
            return;
        }
        
        // 动画效果
        if (actionId.startsWith('anim:')) {
            const parts = actionId.split(':');
            const animId = parts[1];
            const animAction = parts[2];
            if (animAction === 'start') {
                LcdRuntime.startAnimation(animId);
            } else if (animAction === 'stop') {
                LcdRuntime.stopAnimation(animId);
            }
            return;
        }
        
        // 组件API
        if (actionId.startsWith('comp:')) {
            const parts = actionId.split(':');
            const action = parts[1];
            const component = parts[2];
            const param = parts[3];
            
            switch (action) {
                case 'setValue':
                    LcdRuntime.setValue(component, param || '');
                    break;
                case 'setMode':
                    LcdRuntime.setMode(component, param);
                    break;
                case 'setLevel':
                    LcdRuntime.setLevel(component, parseInt(param) || 0);
                    break;
                case 'setVisible':
                    LcdRuntime.setVisible(component, param === 'true');
                    break;
                case 'showPreset':
                    LcdRuntime.showPreset(component, param);
                    break;
                case 'startBehavior':
                    LcdRuntime.startAnimation(component);
                    break;
                case 'stopBehavior':
                    LcdRuntime.stopAnimation(component);
                    break;
            }
            return;
        }
        
        // LCD控制
        if (actionId.startsWith('lcd:')) {
            const action = actionId.split(':')[1];
            if (action === 'showAll') {
                LcdRuntime.showAll();
            } else if (action === 'clearAll') {
                LcdRuntime.clearAll();
            }
            return;
        }
    },
    
    renderLcdPreview(node) {
        if (!this.lcdCanvas || !this.lcdCtx) return;
        
        const perfLcdTotal = HSMPerf.mark('lcdPreview_total');
        
        // 如果工具栏打开，使用临时设置
        let previewNode = node;
        if (this._compToolbarVisible && this._tempCompSettings) {
            previewNode = {
                ...node,
                display: {
                    ...node?.display,
                    components: this._tempCompSettings
                }
            };
        }
        
        // 如果LcdRuntime可用，使用它来预览
        if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state?.initialized) {
            this.previewNodeLcd(previewNode);
            perfLcdTotal.end();
            return;
        }
        
        // 降级：使用原有的静态渲染
        const ctx = this.lcdCtx;
        const canvas = this.lcdCanvas;
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        
        // 计算画布尺寸
        let w = 400, h = 200;
        if (img) {
            w = config?.imageWidth || img.naturalWidth || 400;
            h = config?.imageHeight || img.naturalHeight || 200;
        }
        
        // 适应容器
        const container = canvas.parentElement;
        if (container) {
            const maxW = container.clientWidth - 20;
            const maxH = container.clientHeight - 40;
            const scale = Math.min(maxW / w, maxH / h, 2);
            this.state.lcdScale = scale;
            canvas.width = w * scale;
            canvas.height = h * scale;
        }
        
        const s = this.state.lcdScale;
        
        // 背景
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 背景图
        if (img) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(img, 0, 0, w * s, h * s);
            ctx.globalAlpha = 1;
        }
        
        if (!config?.elements) {
            perfLcdTotal.end();
            return;
        }
        
        // 获取选中的LCD元素
        const selectedLcd = node?.display?.lcdElements || [];
        const selectedSet = new Set(selectedLcd);
        
        // 渲染所有元素 - 优化：批量绘制
        const perfPixels = HSMPerf.mark('lcdPreview_pixels');
        
        // 分两批绘制：未选中和选中
        ctx.fillStyle = 'rgba(42, 58, 42, 0.5)';
        for (const elem of config.elements) {
            if (selectedSet.has(elem.name || elem.id)) continue;
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixelMask || seg.pixels || [];
                if (pixels.length === 0) continue;
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, s, s);
                }
            }
        }
        
        // 选中的元素高亮
        ctx.fillStyle = '#00ff88';
        for (const elem of config.elements) {
            if (!selectedSet.has(elem.name || elem.id)) continue;
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixelMask || seg.pixels || [];
                if (pixels.length === 0) continue;
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, s, s);
                }
            }
        }
        
        perfPixels.end();
        perfLcdTotal.end();
    },
    
    // LCD点击交互
    setupLcdEvents() {
        if (!this.lcdCanvas) return;
        
        this.lcdCanvas.addEventListener('click', (e) => this.onLcdClick(e));
        this.lcdCanvas.style.cursor = 'pointer';
    },
    
    onLcdClick(e) {
        if (!this.state.selectedNode) {
            this.showToast('请先选择状态节点', 'warning');
            return;
        }
        
        if (!this.state.lcdConfig?.elements) return;
        
        const rect = this.lcdCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / this.state.lcdScale;
        const y = (e.clientY - rect.top) / this.state.lcdScale;
        
        // 查找点击的元素
        for (const elem of this.state.lcdConfig.elements) {
            for (const seg of elem.segments || []) {
                const pixels = seg.pixelMask || seg.pixels || [];
                const pixelSet = pixels instanceof Set ? pixels : new Set(pixels);
                
                for (const pkey of pixelSet) {
                    const [px, py] = pkey.split(',').map(Number);
                    if (Math.abs(px - x) < 3 && Math.abs(py - y) < 3) {
                        this.toggleLcdElement(elem.name || elem.id);
                        return;
                    }
                }
            }
        }
    },
    
    toggleLcdElement(elemName) {
        if (!this.state.selectedNode) return;
        
        if (!this.state.selectedNode.display) {
            this.state.selectedNode.display = {};
        }
        if (!this.state.selectedNode.display.lcdElements) {
            this.state.selectedNode.display.lcdElements = [];
        }
        
        const list = this.state.selectedNode.display.lcdElements;
        const idx = list.indexOf(elemName);
        
        if (idx >= 0) {
            list.splice(idx, 1);
            this.showToast(`移除: ${elemName}`, 'info');
        } else {
            list.push(elemName);
            this.showToast(`添加: ${elemName}`, 'success');
        }
        
        this.renderProperties(this.state.selectedNode);
        this.renderLcdPreview(this.state.selectedNode);
        this.render();
    },

    // ========== 工具方法 ==========
    showToast(msg, type = 'info') {
        const colors = { info: '#3b82f6', success: '#22c55e', warning: '#f59e0b', error: '#ef4444' };
        
        const toast = document.createElement('div');
        toast.className = 'hsm-toast';
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; border-radius: 6px; color: white; z-index: 10000;
            background: ${colors[type] || colors.info}; font-size: 13px;
            animation: fadeInUp 0.3s ease;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    },
    
    zoomIn() {
        this.state.zoom = Math.min(3, this.state.zoom * 1.2);
        document.getElementById('hsm-zoom').textContent = Math.round(this.state.zoom * 100) + '%';
        this.render();
    },
    
    zoomOut() {
        this.state.zoom = Math.max(0.3, this.state.zoom / 1.2);
        document.getElementById('hsm-zoom').textContent = Math.round(this.state.zoom * 100) + '%';
        this.render();
    },
    
    fitView() {
        const container = this.getCurrentContainer();
        if (!container.children || Object.keys(container.children).length === 0) {
            this.state.zoom = 1;
            this.state.panX = 50;
            this.state.panY = 50;
        } else {
            const path = this.state.currentPath.join('/');
            const positions = this.state.machine.nodePositions[path] || {};
            
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [id, node] of Object.entries(container.children)) {
                const pos = positions[id] || { x: 200, y: 200 };
                const w = this.getNodeWidth(node);
                const h = this.getNodeHeight(node);
                minX = Math.min(minX, pos.x);
                minY = Math.min(minY, pos.y);
                maxX = Math.max(maxX, pos.x + w);
                maxY = Math.max(maxY, pos.y + h);
            }
            
            const cw = this.canvas.width;
            const ch = this.canvas.height;
            const contentW = maxX - minX + 100;
            const contentH = maxY - minY + 100;
            
            this.state.zoom = Math.min(cw / contentW, ch / contentH, 1.5);
            this.state.panX = (cw - contentW * this.state.zoom) / 2 - minX * this.state.zoom + 50;
            this.state.panY = (ch - contentH * this.state.zoom) / 2 - minY * this.state.zoom + 50;
        }
        
        document.getElementById('hsm-zoom').textContent = Math.round(this.state.zoom * 100) + '%';
        this.render();
    },
    
    // ========== 自动布局算法 ==========
    // 基于层级的DAG布局，类似dagre
    autoLayout() {
        const container = this.getCurrentContainer();
        if (!container.children || Object.keys(container.children).length === 0) {
            this.showToast('没有状态需要布局', 'warning');
            return;
        }
        
        const path = this.state.currentPath.join('/');
        const children = container.children;
        const childIds = Object.keys(children);
        
        // 获取当前层级的转移
        const transitions = (this.state.machine.transitions || []).filter(t => 
            childIds.includes(t.from) && childIds.includes(t.to)
        );
        
        // 1. BFS确定层级
        const levels = {};
        const visited = new Set();
        
        // 从初始状态或第一个状态开始
        const startId = container.initial || childIds[0];
        const queue = [startId];
        levels[startId] = 0;
        visited.add(startId);
        
        while (queue.length > 0) {
            const current = queue.shift();
            const currentLevel = levels[current];
            
            // 找到所有从当前状态出发的转移
            for (const t of transitions) {
                if (t.from === current && !visited.has(t.to)) {
                    levels[t.to] = currentLevel + 1;
                    visited.add(t.to);
                    queue.push(t.to);
                }
            }
        }
        
        // 未访问的状态放到最后一层
        let maxLevel = Math.max(...Object.values(levels), 0);
        for (const id of childIds) {
            if (!visited.has(id)) {
                levels[id] = ++maxLevel;
            }
        }
        
        // 2. 按层级分组
        const levelGroups = {};
        for (const [id, level] of Object.entries(levels)) {
            if (!levelGroups[level]) levelGroups[level] = [];
            levelGroups[level].push(id);
        }
        
        // 3. 计算每个节点的位置
        const nodeWidth = 150;
        const nodeHeight = 90;
        const gapX = 80;  // 水平间距
        const gapY = 50;  // 垂直间距
        const startX = 60;
        const startY = 60;
        
        // 确保位置对象存在
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        const positions = this.state.machine.nodePositions[path];
        
        // 计算每层的最大节点数，用于居中
        const maxNodesInLevel = Math.max(...Object.values(levelGroups).map(g => g.length));
        
        for (const [levelStr, group] of Object.entries(levelGroups)) {
            const level = parseInt(levelStr);
            const nodesInLevel = group.length;
            
            // 计算这一层的起始Y位置（居中）
            const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * gapY;
            const maxTotalHeight = maxNodesInLevel * nodeHeight + (maxNodesInLevel - 1) * gapY;
            const offsetY = (maxTotalHeight - totalHeight) / 2;
            
            for (let i = 0; i < group.length; i++) {
                const id = group[i];
                positions[id] = {
                    x: startX + level * (nodeWidth + gapX),
                    y: startY + offsetY + i * (nodeHeight + gapY)
                };
            }
        }
        
        this.invalidateCache(); // 清除缓存
        this.render();
        this.fitView();
        this.showToast(`已布局 ${childIds.length} 个状态`, 'success');
    },
    
    // 全部自动布局 - 递归布局所有层级
    autoLayoutAll() {
        const count = this._autoLayoutRecursive(this.state.machine.hierarchy.ROOT, ['ROOT']);
        this.invalidateCache();
        this.render();
        this.fitView();
        this.showToast(`已布局全部 ${count} 个状态`, 'success');
    },
    
    // 递归布局辅助函数
    _autoLayoutRecursive(container, currentPath) {
        if (!container.children || Object.keys(container.children).length === 0) {
            return 0;
        }
        
        const path = currentPath.join('/');
        const children = container.children;
        const childIds = Object.keys(children);
        
        // 获取当前层级的转移
        const transitions = (this.state.machine.transitions || []).filter(t => 
            childIds.includes(t.from) && childIds.includes(t.to)
        );
        
        // BFS确定层级
        const levels = {};
        const visited = new Set();
        const startId = container.initial || childIds[0];
        const queue = [startId];
        levels[startId] = 0;
        visited.add(startId);
        
        while (queue.length > 0) {
            const current = queue.shift();
            const currentLevel = levels[current];
            for (const t of transitions) {
                if (t.from === current && !visited.has(t.to)) {
                    levels[t.to] = currentLevel + 1;
                    visited.add(t.to);
                    queue.push(t.to);
                }
            }
        }
        
        let maxLevel = Math.max(...Object.values(levels), 0);
        for (const id of childIds) {
            if (!visited.has(id)) {
                levels[id] = ++maxLevel;
            }
        }
        
        // 按层级分组
        const levelGroups = {};
        for (const [id, level] of Object.entries(levels)) {
            if (!levelGroups[level]) levelGroups[level] = [];
            levelGroups[level].push(id);
        }
        
        // 计算位置
        const nodeWidth = 150;
        const nodeHeight = 90;
        const gapX = 80;
        const gapY = 50;
        const startX = 60;
        const startY = 60;
        
        if (!this.state.machine.nodePositions[path]) {
            this.state.machine.nodePositions[path] = {};
        }
        const positions = this.state.machine.nodePositions[path];
        
        const maxNodesInLevel = Math.max(...Object.values(levelGroups).map(g => g.length));
        
        for (const [levelStr, group] of Object.entries(levelGroups)) {
            const level = parseInt(levelStr);
            const nodesInLevel = group.length;
            const totalHeight = nodesInLevel * nodeHeight + (nodesInLevel - 1) * gapY;
            const maxTotalHeight = maxNodesInLevel * nodeHeight + (maxNodesInLevel - 1) * gapY;
            const offsetY = (maxTotalHeight - totalHeight) / 2;
            
            for (let i = 0; i < group.length; i++) {
                positions[group[i]] = {
                    x: startX + level * (nodeWidth + gapX),
                    y: startY + offsetY + i * (nodeHeight + gapY)
                };
            }
        }
        
        // 递归处理子状态
        let totalCount = childIds.length;
        for (const [id, node] of Object.entries(children)) {
            if (node.type === 'compound' && node.children) {
                totalCount += this._autoLayoutRecursive(node, [...currentPath, id]);
            }
        }
        
        return totalCount;
    },
    
    // 重置视图
    resetView() {
        this.state.zoom = 1;
        this.state.panX = 50;
        this.state.panY = 50;
        document.getElementById('hsm-zoom').textContent = '100%';
        this.render();
    },
    
    refreshPreview() {
        this.renderLcdPreview(this.state.selectedNode);
        this.showToast('预览已刷新', 'success');
    },
    
    loadExample() {
        this.state.machine = {
            device: DeviceConfigManager?.getCurrentDevice() || 'demo',
            name: '示例状态机',
            version: '2.0',
            hierarchy: {
                ROOT: {
                    id: 'ROOT', label: '系统', type: 'compound', level: 0,
                    children: {
                        IDLE: { id: 'IDLE', label: '待机', type: 'atomic', level: 1, entryActions: ['reset'], display: { expects: ['idle_display'] } },
                        MEASURING: { id: 'MEASURING', label: '测量中', type: 'compound', level: 1, children: {
                            LASER_ON: { id: 'LASER_ON', label: '激光开启', type: 'atomic', level: 2 },
                            CALCULATING: { id: 'CALCULATING', label: '计算中', type: 'atomic', level: 2 }
                        }},
                        RESULT: { id: 'RESULT', label: '结果显示', type: 'atomic', level: 1 }
                    },
                    initial: 'IDLE'
                }
            },
            transitions: [
                { from: 'IDLE', to: 'MEASURING', event: 'MEASURE_BTN' },
                { from: 'MEASURING', to: 'RESULT', event: 'MEASURE_DONE' },
                { from: 'RESULT', to: 'IDLE', event: 'TIMEOUT' }
            ],
            nodePositions: {
                'ROOT': { IDLE: { x: 100, y: 150 }, MEASURING: { x: 350, y: 150 }, RESULT: { x: 600, y: 150 } },
                'ROOT/MEASURING': { LASER_ON: { x: 100, y: 100 }, CALCULATING: { x: 300, y: 100 } }
            }
        };
        
        this.state.currentPath = ['ROOT'];
        this.state.selectedNode = null;
        this.updateBreadcrumb();
        this.updateLevelHint();
        this.renderTree();
        this.render();
        this.showToast('已加载示例', 'success');
    },
    
    // ========== 变量面板 ==========
    
    showVariablesPanel() {
        const variables = this.state.machine?.variables || {};
        
        let html = `
            <div class="hsm-dialog-overlay" onclick="if(event.target===this)HSM.closeDialog()">
                <div class="hsm-dialog" style="width:400px;max-height:500px;">
                    <div class="hsm-dialog-header">
                        <span>📊 状态机变量</span>
                        <button class="hsm-dialog-close" onclick="HSM.closeDialog()">×</button>
                    </div>
                    <div class="hsm-dialog-body" style="max-height:400px;overflow-y:auto;">
                        <div style="margin-bottom:10px;">
                            <button class="hsm-btn primary" onclick="HSM.addVariable()">➕ 添加变量</button>
                        </div>
                        <table style="width:100%;font-size:11px;border-collapse:collapse;">
                            <thead>
                                <tr style="background:var(--bg-tertiary);">
                                    <th style="padding:6px;text-align:left;">名称</th>
                                    <th style="padding:6px;text-align:left;">类型</th>
                                    <th style="padding:6px;text-align:left;">默认值</th>
                                    <th style="padding:6px;text-align:left;">说明</th>
                                    <th style="padding:6px;width:50px;"></th>
                                </tr>
                            </thead>
                            <tbody id="hsm-vars-list">
        `;
        
        for (const [name, def] of Object.entries(variables)) {
            html += `
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:6px;"><code>${name}</code></td>
                    <td style="padding:6px;">${def.type}</td>
                    <td style="padding:6px;">${def.default}</td>
                    <td style="padding:6px;color:var(--text-muted);font-size:10px;">${def.description || ''}</td>
                    <td style="padding:6px;">
                        <button class="hsm-btn" style="padding:2px 6px;font-size:10px;" onclick="HSM.editVariable('${name}')">✏️</button>
                        <button class="hsm-btn" style="padding:2px 6px;font-size:10px;color:#ef4444;" onclick="HSM.deleteVariable('${name}')">🗑️</button>
                    </td>
                </tr>
            `;
        }
        
        if (Object.keys(variables).length === 0) {
            html += `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-muted);">暂无变量，点击"添加变量"创建</td></tr>`;
        }
        
        html += `
                            </tbody>
                        </table>
                        <div style="margin-top:12px;padding:10px;background:var(--bg-tertiary);border-radius:4px;font-size:10px;color:var(--text-muted);">
                            <strong>💡 变量用法:</strong><br>
                            • 动作中使用: <code>set:runstep = 1</code>, <code>inc:runstep</code><br>
                            • Guard条件: <code>runstep % 2 == 1</code><br>
                            • 计算表达式: <code>calc:area = line1_data * line2_data</code>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
    },
    
    addVariable() {
        const name = prompt('变量名称 (英文):');
        if (!name || !/^[a-z_][a-z0-9_]*$/i.test(name)) {
            this.showToast('无效的变量名', 'error');
            return;
        }
        
        if (!this.state.machine.variables) {
            this.state.machine.variables = {};
        }
        
        if (this.state.machine.variables[name]) {
            this.showToast('变量已存在', 'error');
            return;
        }
        
        const type = prompt('类型 (int/float/bool):', 'int') || 'int';
        const defaultVal = prompt('默认值:', '0') || '0';
        const desc = prompt('说明:', '') || '';
        
        this.state.machine.variables[name] = {
            type: type,
            default: type === 'float' ? parseFloat(defaultVal) : (type === 'bool' ? defaultVal === 'true' : parseInt(defaultVal)),
            description: desc
        };
        
        this.closeDialog();
        this.showVariablesPanel();
        this.showToast('变量已添加', 'success');
    },
    
    editVariable(name) {
        const def = this.state.machine.variables?.[name];
        if (!def) return;
        
        const newDefault = prompt(`${name} 的默认值:`, String(def.default));
        if (newDefault !== null) {
            def.default = def.type === 'float' ? parseFloat(newDefault) : 
                         (def.type === 'bool' ? newDefault === 'true' : parseInt(newDefault));
        }
        
        const newDesc = prompt(`${name} 的说明:`, def.description || '');
        if (newDesc !== null) {
            def.description = newDesc;
        }
        
        this.closeDialog();
        this.showVariablesPanel();
        this.showToast('变量已更新', 'success');
    },
    
    deleteVariable(name) {
        if (!confirm(`删除变量 "${name}"?`)) return;
        
        delete this.state.machine.variables[name];
        this.closeDialog();
        this.showVariablesPanel();
        this.showToast('变量已删除', 'info');
    },
    
    closeDialog() {
        document.querySelectorAll('.hsm-dialog-overlay').forEach(el => el.remove());
    },
    
    // ========== 导出代码 ==========
    
    async exportCode() {
        if (!this.state.machine) {
            this.showToast('无状态机数据', 'error');
            return;
        }
        
        // 检查CodeGenerator是否可用
        if (typeof CodeGenerator === 'undefined') {
            this.showToast('代码生成器未加载', 'error');
            return;
        }
        
        try {
            // 收集所有配置数据
            const projectData = {
                lcdProject: this.state.lcdConfig,
                components: this.state.componentsConfig,
                presets: this.state.presetsConfig,
                animations: this.state.animationsConfig,
                stateMachine: this.state.machine
            };
            
            // 生成代码
            const files = await CodeGenerator.generateAllEnhanced(projectData);
            
            // 显示导出对话框
            this.showExportDialog(files);
            
        } catch (e) {
            console.error('代码生成失败:', e);
            this.showToast('代码生成失败: ' + e.message, 'error');
        }
    },
    
    showExportDialog(files) {
        const fileList = Object.keys(files);
        
        let html = `
            <div class="hsm-dialog-overlay" onclick="if(event.target===this)HSM.closeDialog()">
                <div class="hsm-dialog" style="width:600px;max-height:80vh;">
                    <div class="hsm-dialog-header">
                        <span>📤 导出C代码</span>
                        <button class="hsm-dialog-close" onclick="HSM.closeDialog()">×</button>
                    </div>
                    <div class="hsm-dialog-body">
                        <div style="display:flex;gap:10px;margin-bottom:10px;">
                            <button class="hsm-btn primary" onclick="HSM.downloadAllCode()">📥 下载全部 (ZIP)</button>
                            <button class="hsm-btn" onclick="HSM.copySelectedCode()">📋 复制选中</button>
                        </div>
                        <div style="display:grid;grid-template-columns:180px 1fr;gap:10px;height:400px;">
                            <div style="border:1px solid var(--border-color);border-radius:4px;overflow-y:auto;">
                                ${fileList.map((f, i) => `
                                    <div class="hsm-export-file ${i === 0 ? 'selected' : ''}" 
                                         onclick="HSM.selectExportFile('${f}')" 
                                         data-file="${f}">
                                        📄 ${f}
                                    </div>
                                `).join('')}
                            </div>
                            <div style="border:1px solid var(--border-color);border-radius:4px;overflow:auto;">
                                <pre id="hsm-export-preview" style="margin:0;padding:10px;font-size:11px;font-family:monospace;white-space:pre-wrap;">${this.escapeHtml(files[fileList[0]] || '')}</pre>
                            </div>
                        </div>
                        <div style="margin-top:10px;font-size:10px;color:var(--text-muted);">
                            生成了 ${fileList.length} 个文件，包含LCD映射、组件驱动、状态机、预设和动画代码
                        </div>
                    </div>
                </div>
            </div>
            <style>
                .hsm-export-file {
                    padding: 8px 10px;
                    font-size: 11px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border-color);
                }
                .hsm-export-file:hover { background: var(--bg-tertiary); }
                .hsm-export-file.selected { background: var(--accent-color); color: white; }
            </style>
        `;
        
        document.body.insertAdjacentHTML('beforeend', html);
        
        // 保存文件数据供后续使用
        this._exportedFiles = files;
    },
    
    selectExportFile(filename) {
        const files = this._exportedFiles;
        if (!files || !files[filename]) return;
        
        // 更新选中状态
        document.querySelectorAll('.hsm-export-file').forEach(el => {
            el.classList.toggle('selected', el.dataset.file === filename);
        });
        
        // 更新预览
        document.getElementById('hsm-export-preview').textContent = files[filename];
    },
    
    copySelectedCode() {
        const preview = document.getElementById('hsm-export-preview');
        if (!preview) return;
        
        navigator.clipboard.writeText(preview.textContent).then(() => {
            this.showToast('代码已复制', 'success');
        });
    },
    
    async downloadAllCode() {
        const files = this._exportedFiles;
        if (!files) return;
        
        // 检查JSZip是否可用
        if (typeof JSZip === 'undefined') {
            // 简单方式：逐个下载
            for (const [filename, content] of Object.entries(files)) {
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
            }
            this.showToast('文件已下载', 'success');
            return;
        }
        
        // 使用JSZip打包
        const zip = new JSZip();
        for (const [filename, content] of Object.entries(files)) {
            zip.file(filename, content);
        }
        
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.state.machine.device || 'ui'}_code.zip`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast('ZIP已下载', 'success');
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    generateCode() {
        if (!this.state.machine) {
            this.showToast('无状态机数据', 'error');
            return;
        }
        
        let code = `// 自动生成的状态机代码\n`;
        code += `// 设备: ${this.state.machine.device}\n`;
        code += `// 生成时间: ${new Date().toLocaleString()}\n\n`;
        code += `const StateMachine = {\n`;
        code += `    name: '${this.state.machine.name}',\n`;
        code += `    states: ${JSON.stringify(this.state.machine.hierarchy, null, 2)},\n`;
        code += `    transitions: ${JSON.stringify(this.state.machine.transitions, null, 2)}\n`;
        code += `};\n`;
        
        // 复制到剪贴板
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('代码已复制到剪贴板', 'success');
        }).catch(() => {
            console.log(code);
            this.showToast('请查看控制台', 'info');
        });
    },
    
    // ========== 状态机模拟 ==========
    
    simState: {
        running: false,
        currentState: 'OFF',
        variables: {},
        history: [],
        log: [],  // 执行日志
    },
    
    simStart() {
        if (!this.state.machine) {
            this.showToast('请先加载状态机', 'error');
            return;
        }
        
        this.simState.running = true;
        this.simState.currentState = 'OFF';
        this.simState.history = [];
        this.simState.timeoutId = null;  // 超时定时器ID
        
        // 初始化变量
        const vars = this.state.machine.variables || {};
        this.simState.variables = {};
        for (const [name, def] of Object.entries(vars)) {
            this.simState.variables[name] = def.default;
        }
        
        // 初始化FlowController
        if (typeof FlowController !== 'undefined') {
            FlowController.init();
            console.log('%c🔀 FlowController 已初始化', 'color: #f97316; font-weight: bold;');
        }
        
        // 控制台输出启动信息
        console.clear();
        console.log('%c🚀 状态机模拟器启动', 'color: #22c55e; font-size: 16px; font-weight: bold;');
        console.log('%c' + '═'.repeat(50), 'color: #22c55e;');
        
        this.simLog('state', '初始状态: OFF');
        
        // 显示所有变量初始值
        console.log('%c📊 变量初始化:', 'color: #ec4899; font-weight: bold;');
        for (const [name, value] of Object.entries(this.simState.variables)) {
            console.log(`%c   ${name} = ${JSON.stringify(value)}`, 'color: #ec4899;');
        }
        
        // 更新UI
        const startBtn = document.getElementById('hsm-sim-start');
        const stopBtn = document.getElementById('hsm-sim-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        
        // 执行OFF状态的入口动作
        this.simExecuteEntryActions('OFF');
        
        this.simUpdateUI();
        this.simHighlightState(this.simState.currentState);
        this.renderLcdFromRuntime();
        
        this.showToast('模拟已启动，当前状态: OFF', 'success');
    },
    
    simStop() {
        this.simState.running = false;
        
        // 清除超时定时器
        if (this.simState.timeoutId) {
            clearTimeout(this.simState.timeoutId);
            this.simState.timeoutId = null;
        }
        
        document.getElementById('hsm-sim-start').disabled = false;
        document.getElementById('hsm-sim-stop').disabled = true;
        
        // 清除高亮
        this.render();
        this.showToast('模拟已停止', 'info');
    },
    
    simReset() {
        this.simStop();
        this.simState.history = [];
        this.simState.currentState = 'OFF';
        this.simUpdateUI();
    },
    
    /**
     * 快捷流程：开机（快速松开）
     * OFF → K1_XLONG → BOOT/FULL_DISPLAY → (500ms超时) → INIT → K1_RELEASE → IDLE
     */
    async simBootSequence() {
        console.log('[SIM] ===== 开机流程 =====');
        this.simReset();
        this.simStart();
        
        // 延迟执行，让用户看到每一步
        await this.delay(300);
        this.simSendEvent('K1_XLONG');  // 开机 → FULL_DISPLAY (全显)
        
        // 等待全显超时自动转移到INIT (500ms + 一点缓冲)
        await this.delay(700);
        
        // 松开K1进入IDLE
        this.simSendEvent('K1_RELEASE');
        
        this.showToast('开机完成，进入待机', 'success');
    },
    
    /**
     * 快捷流程：开机+选择单位
     * OFF → K1_XLONG → BOOT/FULL_DISPLAY → (超时) → INIT → TIMEOUT_1S(循环) → K1_RELEASE → IDLE
     */
    async simBootWithUnitSelect() {
        console.log('[SIM] ===== 开机+选单位流程 =====');
        this.simReset();
        this.simStart();
        
        await this.delay(300);
        this.simSendEvent('K1_XLONG');  // 开机 → FULL_DISPLAY
        
        // 等待全显超时自动转移到INIT
        await this.delay(700);
        
        // 模拟K1持续按住，每秒切换单位
        for (let i = 0; i < 3; i++) {
            await this.delay(800);
            this.simSendEvent('TIMEOUT_1S');  // 切换单位
        }
        
        await this.delay(500);
        this.simSendEvent('K1_RELEASE');  // 松开，确认单位
        
        const unitNames = ['m', 'ft', 'in'];
        const unit = this.simState.variables.unit || 0;
        this.showToast(`开机完成，单位: ${unitNames[unit]}`, 'success');
    },
    
    /**
     * 快捷流程：关机
     */
    async simShutdown() {
        console.log('[SIM] ===== 关机流程 =====');
        if (!this.simState.running) {
            this.showToast('模拟器未运行', 'warning');
            return;
        }
        
        this.simSendEvent('K3_XLONG');  // 关机
        this.showToast('已关机', 'info');
    },
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    // ========== 执行日志 - 输出到控制台 ==========
    
    // 控制台颜色样式
    LOG_STYLES: {
        event:      'color: #3b82f6; font-weight: bold; font-size: 12px;',  // 蓝色 - 事件
        transition: 'color: #22c55e; font-weight: bold; font-size: 12px;',  // 绿色 - 转移
        entry:      'color: #f59e0b; font-weight: bold;',                   // 橙色 - 入口动作
        exit:       'color: #ef4444; font-weight: bold;',                   // 红色 - 退出动作
        lcd:        'color: #06b6d4;',                                      // 青色 - LCD操作
        var:        'color: #ec4899;',                                      // 粉色 - 变量
        state:      'color: #10b981; font-weight: bold;',                   // 绿色 - 状态变化
        action:     'color: #a855f7;',                                      // 紫色 - 硬件控制
        flow:       'color: #f97316; font-weight: bold;',                   // 橙色 - 流程控制
        macro:      'color: #8b5cf6;',                                      // 紫色 - 宏动作
        comp:       'color: #14b8a6;',                                      // 青绿 - 组件
        hw:         'color: #ef4444;',                                      // 红色 - 硬件
        info:       'color: #6b7280;',                                      // 灰色 - 信息
        error:      'color: #dc2626; font-weight: bold;',                   // 红色 - 错误
    },
    
    LOG_ICONS: {
        event: '📨',
        transition: '➡️',
        entry: '⚡',
        exit: '🚪',
        lcd: '📺',
        var: '📊',
        state: '🔄',
        action: '▶️',
        flow: '🔀',
        macro: '📜',
        comp: '🧩',
        hw: '⚙️',
        info: 'ℹ️',
        error: '❌',
    },
    
    /**
     * 加载复合状态的步骤配置到FlowController
     * @param {string} stateId - 复合状态ID (如 'AREA')
     */
    loadFlowStepConfigs(stateId) {
        if (typeof FlowController === 'undefined') return;
        
        const state = this.findStateById(stateId);
        if (!state || !state.children) {
            console.log('[HSM] 状态无子状态:', stateId);
            return;
        }
        
        // 提取子状态的步骤配置
        const configs = [];
        for (const [id, child] of Object.entries(state.children)) {
            if (child.stepIndex !== undefined) {
                configs.push({
                    stepIndex: child.stepIndex,
                    stateId: child.id,
                    isReady: child.isReady === true,
                    label: child.label || child.id,
                });
            }
        }
        
        if (configs.length > 0) {
            FlowController.setStepConfigs(configs);
            console.log('[HSM] 加载步骤配置:', configs.length, '个步骤');
        }
    },
    
    /**
     * 查找状态的父状态
     * @param {string} stateId - 状态ID
     * @returns {Object|null} 父状态对象
     */
    findParentState(stateId) {
        const findParent = (hierarchy, targetId, parent = null) => {
            for (const state of Object.values(hierarchy)) {
                if (state.id === targetId) {
                    return parent;
                }
                if (state.children) {
                    const result = findParent(state.children, targetId, state);
                    if (result !== undefined) return result;
                }
            }
            return undefined;
        };
        
        return findParent(this.state.machine?.hierarchy || {}, stateId);
    },
    
    simLog(type, message, detail = null) {
        const style = this.LOG_STYLES[type] || this.LOG_STYLES.info;
        const icon = this.LOG_ICONS[type] || '•';
        
        // 输出到控制台（带颜色）
        if (detail) {
            console.log(`%c${icon} ${message}`, style, `| ${detail}`);
        } else {
            console.log(`%c${icon} ${message}`, style);
        }
    },

    // 同步FlowController数据到模拟器变量
    syncFlowDataToSimVars() {
        if (typeof FlowController === 'undefined') return;
        
        const slots = FlowController.getAllSlots();
        const dataTypes = FlowController.state.dataTypes;
        
        // 同步line数据
        for (let i = 0; i < 4; i++) {
            const varName = `line${i + 1}_data`;
            this.simState.variables[varName] = slots[i];
        }
        
        // 同步步骤
        this.simState.variables.runstep = FlowController.state.currentStep;
        this.simState.variables.flow_type = FlowController.state.flowType;
        
        // 更新LCD显示
        if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state.initialized) {
            for (let i = 0; i < 4; i++) {
                const compName = `Line${i + 1}`;
                try {
                    if (slots[i] !== 0) {
                        LcdRuntime.setValue(compName, slots[i]);
                    } else {
                        LcdRuntime.showPreset(compName, 'dash');
                    }
                } catch (e) {}
            }
            this.renderLcdFromRuntime();
        }
        
        // 更新模拟器UI显示
        this.updateSimVarsDisplay();
    },

    // 更新模拟器变量显示
    updateSimVarsDisplay() {
        // 更新流程控制器状态显示
        if (typeof FlowController !== 'undefined') {
            const typeEl = document.getElementById('hsm-flow-type');
            const stepEl = document.getElementById('hsm-flow-step');
            const stateEl = document.getElementById('hsm-flow-state');
            const historyEl = document.getElementById('hsm-flow-history');
            const line1El = document.getElementById('hsm-flow-line1');
            const line2El = document.getElementById('hsm-flow-line2');
            const line3El = document.getElementById('hsm-flow-line3');
            const line4El = document.getElementById('hsm-flow-line4');
            
            if (typeEl) {
                const typeNames = { single: '单步', multi: '多步', loop: '循环' };
                typeEl.textContent = typeNames[FlowController.state.flowType] || FlowController.state.flowType;
            }
            if (stepEl) stepEl.textContent = FlowController.state.currentStep;
            if (stateEl) stateEl.textContent = FlowController.state.currentState || '-';
            if (historyEl) historyEl.textContent = FlowController.state.snapshots.length;
            
            const slots = FlowController.getAllSlots();
            if (line1El) line1El.textContent = slots[0] !== 0 ? slots[0].toFixed(3) : '-----';
            if (line2El) line2El.textContent = slots[1] !== 0 ? slots[1].toFixed(3) : '-----';
            if (line3El) line3El.textContent = slots[2] !== 0 ? slots[2].toFixed(3) : '-----';
            if (line4El) line4El.textContent = lineData[3] !== 0 ? lineData[3].toFixed(3) : '-----';
        }
    },

    clearSimLog() {
        console.clear();
        console.log('%c🔄 模拟器日志已清空', 'color: #6b7280; font-size: 14px;');
    },
    
    simSendEvent(eventName) {
        if (!this.simState.running) {
            console.log('%c[SIM] 模拟器未运行，自动启动', 'color: #f59e0b;');
            this.simStart();
        }
        
        const transitions = this.state.machine.transitions || [];
        const currentState = this.simState.currentState;
        
        // 控制台分隔线
        console.log('%c' + '═'.repeat(50), 'color: #3b82f6;');
        this.simLog('event', `事件: ${eventName}`, `当前状态: ${currentState}`);
        console.log('[SIM] ========== 发送事件 ==========');
        console.log('[SIM] 事件:', eventName, '当前状态:', currentState);
        console.log('[SIM] 当前变量:', JSON.stringify(this.simState.variables));
        
        // 查找匹配的转移
        const trans = transitions.find(t => {
            // 检查from状态是否匹配（直接匹配或祖先匹配）
            if (t.from !== currentState && !this.isAncestorState(t.from, currentState)) {
                return false;
            }
            if (t.event !== eventName) return false;
            
            // 检查Guard条件
            if (t.guard) {
                try {
                    const result = this.simEvalGuard(t.guard);
                    this.simLog('info', `Guard: ${t.guard}`, result ? '✓通过' : '✗失败');
                    console.log('[SIM] Guard评估:', t.guard, '=', result);
                    if (!result) return false;
                } catch (e) {
                    console.warn('[SIM] Guard评估失败:', t.guard, e);
                    return false;
                }
            }
            return true;
        });
        
        if (trans) {
            const fromState = currentState;
            const toState = trans.to;
            
            // 清除之前的超时定时器（状态转移时）
            if (this.simState.timeoutId) {
                clearTimeout(this.simState.timeoutId);
                this.simState.timeoutId = null;
                this.simLog('action', '清除超时定时器');
            }
            
            this.simLog('transition', `${fromState} → ${toState}`, trans.description || '');
            
            // 执行退出动作
            this.simExecuteExitActions(fromState);
            
            // 执行转移动作
            if (trans.actions && trans.actions.length > 0) {
                this.simLog('action', '转移动作', `共${trans.actions.length}个`);
                trans.actions.forEach(action => this.simExecuteAction(action, '转移'));
            }
            
            // 切换状态 - 处理复合状态的初始子状态
            let finalState = toState;
            const targetState = this.findStateById(toState);
            if (targetState) {
                // 执行目标状态的入口动作
                this.simExecuteEntryActions(toState);
                
                // 如果是复合状态，递归进入初始子状态
                if (targetState.type === 'compound') {
                    this.simLog('state', `进入复合状态: ${toState}`);
                    finalState = this.simEnterState(toState);
                }
            }
            
            this.simLog('state', `最终状态: ${finalState}`);
            this.simState.currentState = finalState;
            
            // 记录历史
            this.simState.history.unshift({
                event: eventName,
                from: fromState,
                to: finalState,
                time: new Date().toLocaleTimeString()
            });
            
            // 限制历史长度
            if (this.simState.history.length > 20) {
                this.simState.history.pop();
            }
            
            this.simUpdateUI();
            this.simHighlightState(finalState);  // 使用最终状态进行高亮
            
            // 更新LCD预览
            this.simUpdateLcd(finalState);  // 使用最终状态更新LCD
            
            this.showToast(`${fromState} → ${finalState}`, 'success');
        } else {
            this.simLog('error', `无效事件: ${eventName}`, `状态: ${currentState}`);
            console.log('[SIM] 无匹配转移，当前状态:', currentState, '事件:', eventName);
            console.log('[SIM] 可用转移:', transitions.filter(t => t.event === eventName).map(t => `${t.from}→${t.to}`));
            this.showToast(`事件 ${eventName} 在状态 ${currentState} 无效`, 'warning');
        }
    },
    
    isAncestorState(ancestorId, stateId) {
        // 检查ancestorId是否是stateId的祖先状态
        const findState = (hierarchy, id, path = []) => {
            for (const [key, state] of Object.entries(hierarchy)) {
                if (state.id === id) {
                    return path;
                }
                if (state.children) {
                    const result = findState(state.children, id, [...path, state.id]);
                    if (result) return result;
                }
            }
            return null;
        };
        
        const path = findState(this.state.machine.hierarchy, stateId);
        return path && path.includes(ancestorId);
    },
    
    simEvalGuard(guard) {
        // 简单的Guard条件评估
        let expr = guard;
        // 处理特殊的按键状态变量
        // K1_HELD, K2_HELD, K3_HELD 在模拟器中默认为 true（简化测试）
        expr = expr.replace(/\bK1_HELD\b/g, 'true');
        expr = expr.replace(/\bK2_HELD\b/g, 'true');
        expr = expr.replace(/\bK3_HELD\b/g, 'true');
        
        for (const [name, value] of Object.entries(this.simState.variables)) {
            const regex = new RegExp(`\\b${name}\\b`, 'g');
            expr = expr.replace(regex, JSON.stringify(value));
        }
        return eval(expr);
    },
    
    simExecuteAction(action, source = '') {
        const prefix = source ? `[${source}] ` : '';
        const components = this.state.componentsConfig?.components || {};
        
        // ========== 新语法: compName = value (组件名=变量名) ==========
        const assignMatch = action.match(/^(\w+)\s*=\s*(.+)$/);
        if (assignMatch) {
            const compName = assignMatch[1].trim();
            let valueStr = assignMatch[2].trim();
            
            // 检查是否是组件
            const comp = components[compName];
            if (comp) {
                // 处理特殊值
                if (valueStr === "'-----'" || valueStr === '"-----"' || valueStr === 'dash') {
                    this.simLog('comp', `${prefix}${compName} = -----`);
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.showPreset(compName, 'dash'); } catch(e) {}
                    }
                    return;
                }
                if (valueStr === "''" || valueStr === '""' || valueStr === 'blank') {
                    this.simLog('comp', `${prefix}${compName} = 空白`);
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.showPreset(compName, 'blank'); } catch(e) {}
                    }
                    return;
                }
                if (valueStr === "'Err'" || valueStr === '"Err"' || valueStr === 'error') {
                    this.simLog('comp', `${prefix}${compName} = Err`);
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.showPreset(compName, 'error'); } catch(e) {}
                    }
                    return;
                }
                
                // 计算值
                let value;
                try {
                    // 替换变量引用
                    let expr = valueStr;
                    for (const [name, val] of Object.entries(this.simState.variables)) {
                        const regex = new RegExp(`\\b${name}\\b`, 'g');
                        expr = expr.replace(regex, JSON.stringify(val));
                    }
                    // 替换数学函数
                    expr = expr.replace(/sqrt\(/g, 'Math.sqrt(');
                    expr = expr.replace(/\^2/g, '**2');
                    value = eval(expr);
                } catch (e) {
                    this.simLog('error', `${prefix}计算失败: ${action}`, e.message);
                    return;
                }
                
                // 更新变量
                const oldValue = this.simState.variables[compName];
                this.simState.variables[compName] = value;
                
                // 更新组件显示
                if (comp.type === 'Line') {
                    this.simLog('comp', `${prefix}${compName} = ${value}`, oldValue !== undefined ? `(原: ${oldValue})` : '');
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.setValue(compName, value); } catch(e) {}
                    }
                } else if (comp.type === 'Icon') {
                    const visible = !!value;
                    this.simLog('comp', `${prefix}${compName} = ${visible ? '显示' : '隐藏'}`);
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.setVisible(compName, visible); } catch(e) {}
                    }
                    // 触发onSet联动
                    if (comp.onSet) {
                        const onSetConfig = comp.onSet[String(visible)];
                        if (onSetConfig) {
                            if (onSetConfig.hardware) {
                                this.simLog('hw', `${prefix}硬件回调: ${onSetConfig.hardware}`);
                            }
                            if (onSetConfig.anim) {
                                if (onSetConfig.anim.action === 'stop') {
                                    this.simLog('anim', `${prefix}停止动画`);
                                } else if (onSetConfig.anim.id) {
                                    this.simLog('anim', `${prefix}启动动画: ${onSetConfig.anim.id}`);
                                }
                            }
                        }
                    }
                } else if (comp.type === 'Selector') {
                    const opt = comp.options?.find(o => o.value === value);
                    this.simLog('comp', `${prefix}${compName} = ${opt?.key || value}`);
                    if (typeof LcdRuntime !== 'undefined') {
                        try { LcdRuntime.setValue(compName, value); } catch(e) {}
                    }
                }
                return;
            }
            
            // 不是组件，当作普通变量赋值
            let value;
            try {
                let expr = valueStr;
                for (const [name, val] of Object.entries(this.simState.variables)) {
                    const regex = new RegExp(`\\b${name}\\b`, 'g');
                    expr = expr.replace(regex, JSON.stringify(val));
                }
                expr = expr.replace(/sqrt\(/g, 'Math.sqrt(');
                expr = expr.replace(/\^2/g, '**2');
                value = eval(expr);
            } catch (e) {
                this.simLog('error', `${prefix}计算失败: ${action}`, e.message);
                return;
            }
            const oldValue = this.simState.variables[compName];
            this.simState.variables[compName] = value;
            this.simLog('var', `${prefix}${compName} = ${value}`, oldValue !== undefined ? `(原: ${oldValue})` : '');
            return;
        }
        
        // ========== 宏动作: macro:macroId ==========
        if (action.startsWith('macro:')) {
            const macroId = action.substring(6).trim();
            const macro = this.state.macrosConfig?.macros?.[macroId];
            if (macro) {
                this.simLog('macro', `${prefix}执行宏: ${macro.name}`, `${macro.steps.length} 步`);
                for (const step of macro.steps) {
                    // 递归执行宏中的每个步骤
                    this.simExecuteAction(step, `${macroId}`);
                }
            } else {
                this.simLog('error', `${prefix}宏不存在: ${macroId}`);
            }
            return;
        }
        
        // ========== 赋值: assign: var = value ==========
        if (action.startsWith('assign:')) {
            const match = action.substring(7).match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1].trim();
                let value = match[2].trim();
                const oldValue = this.simState.variables[varName];
                try {
                    // 替换变量引用
                    for (const [name, val] of Object.entries(this.simState.variables)) {
                        const regex = new RegExp(`\\b${name}\\b`, 'g');
                        value = value.replace(regex, JSON.stringify(val));
                    }
                    value = eval(value);
                } catch (e) {
                    this.simLog('error', `${prefix}赋值失败: ${action}`, e.message);
                    return;
                }
                this.simState.variables[varName] = value;
                this.simLog('var', `${prefix}${varName} = ${value}`, oldValue !== undefined ? `(原: ${oldValue})` : '');
                
                // 如果是line变量，同步更新LCD
                if (varName.startsWith('line') && typeof LcdRuntime !== 'undefined') {
                    const compName = varName;  // line1, line2, line3, line4
                    try {
                        LcdRuntime.setValue(compName, value);
                    } catch (e) {}
                }
            }
            return;
        }
        
        // ========== 脚本: script: code ==========
        if (action.startsWith('script:')) {
            const code = action.substring(7).trim();
            try {
                // 创建变量上下文
                const vars = this.simState.variables;
                const history = this.simState.history || [];
                // 执行脚本
                const result = eval(code);
                this.simLog('script', `${prefix}${code}`, result !== undefined ? `= ${result}` : '');
            } catch (e) {
                this.simLog('error', `${prefix}脚本失败: ${code}`, e.message);
            }
            return;
        }
        
        // 变量设置: set:varname = value
        if (action.startsWith('set:')) {
            const match = action.substring(4).match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let value = match[2].trim();
                const oldValue = this.simState.variables[varName];
                try {
                    // 替换变量引用
                    for (const [name, val] of Object.entries(this.simState.variables)) {
                        const regex = new RegExp(`\\b${name}\\b`, 'g');
                        value = value.replace(regex, JSON.stringify(val));
                    }
                    value = eval(value);
                } catch (e) {}
                this.simState.variables[varName] = value;
                this.simLog('var', `${prefix}${varName} = ${value}`, oldValue !== undefined ? `(原: ${oldValue})` : '');
            }
        }
        // 变量递增: inc:varname
        else if (action.startsWith('inc:')) {
            const varName = action.substring(4).trim();
            if (this.simState.variables[varName] !== undefined) {
                const oldValue = this.simState.variables[varName];
                this.simState.variables[varName]++;
                this.simLog('var', `${prefix}${varName}++`, `${oldValue} → ${this.simState.variables[varName]}`);
            }
        }
        // 变量递减: dec:varname
        else if (action.startsWith('dec:')) {
            const varName = action.substring(4).trim();
            if (this.simState.variables[varName] !== undefined) {
                const oldValue = this.simState.variables[varName];
                this.simState.variables[varName]--;
                this.simLog('var', `${prefix}${varName}--`, `${oldValue} → ${this.simState.variables[varName]}`);
            }
        }
        // 计算表达式: calc:result = expr
        else if (action.startsWith('calc:')) {
            const match = action.substring(5).match(/(\w+)\s*=\s*(.+)/);
            if (match) {
                const varName = match[1];
                let expr = match[2].trim();
                try {
                    // 替换变量引用
                    for (const [name, val] of Object.entries(this.simState.variables)) {
                        const regex = new RegExp(`\\b${name}\\b`, 'g');
                        expr = expr.replace(regex, JSON.stringify(val));
                    }
                    // 替换数学函数
                    expr = expr.replace(/sqrt\(/g, 'Math.sqrt(');
                    expr = expr.replace(/\^2/g, '**2');
                    const result = eval(expr);
                    this.simState.variables[varName] = result;
                    this.simLog('var', `${prefix}${varName} = ${result}`, `计算: ${match[2]}`);
                } catch (e) {
                    console.warn('计算失败:', expr, e);
                }
            }
        }
        // 条件动作: if:condition then action
        else if (action.startsWith('if:')) {
            const match = action.match(/if:\s*(.+?)\s+then\s+(.+)/);
            if (match) {
                const condition = match[1].trim();
                const thenAction = match[2].trim();
                try {
                    const result = this.simEvalGuard(condition);
                    if (result) {
                        this.simLog('action', `${prefix}条件成立: ${condition}`, `执行: ${thenAction}`);
                        this.simExecuteAction(thenAction, source);
                    } else {
                        this.simLog('info', `${prefix}条件不成立: ${condition}`);
                    }
                } catch (e) {
                    console.warn('条件评估失败:', condition, e);
                }
            }
        }
        // 历史滚动: scroll:history
        else if (action === 'scroll:history') {
            this.simState.variables.line1_data = this.simState.variables.line2_data;
            this.simState.variables.line2_data = this.simState.variables.line3_data;
            this.simState.variables.line3_data = this.simState.variables.line4_data;
            this.simLog('action', `${prefix}历史滚动`);
        }
        // 界面预设: preset:presetId
        else if (action.startsWith('preset:')) {
            const presetId = action.split(':')[1];
            const preset = LcdRuntime?.state?.presets?.[presetId];
            this.simLog('lcd', `${prefix}预设: ${presetId}`, preset?.name || '');
            
            if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state.initialized) {
                try {
                    LcdRuntime.applyPreset(presetId, this.simState.variables);
                    // 记录组件变化
                    if (preset?.components) {
                        for (const [compId, config] of Object.entries(preset.components)) {
                            if (config.preset) {
                                this.simLog('lcd', `  └─ ${compId}.showPreset(${config.preset})`);
                            } else if (config.bind) {
                                const value = this.simState.variables[config.bind];
                                this.simLog('lcd', `  └─ ${compId}.bind(${config.bind})`, `= ${value}`);
                            } else if (config.value !== undefined) {
                                this.simLog('lcd', `  └─ ${compId}.setValue(${config.value})`);
                            } else if (config.mode !== undefined) {
                                this.simLog('lcd', `  └─ ${compId}.setMode(${config.mode})`);
                            } else if (config.level !== undefined) {
                                this.simLog('lcd', `  └─ ${compId}.setLevel(${config.level})`);
                            } else if (config.visible !== undefined) {
                                this.simLog('lcd', `  └─ ${compId}.setVisible(${config.visible})`);
                            }
                        }
                    }
                    // 记录图标变化
                    if (preset?.icons) {
                        for (const [iconId, visible] of Object.entries(preset.icons)) {
                            this.simLog('lcd', `  └─ ${iconId}: ${visible ? '显示' : '隐藏'}`);
                        }
                    }
                    this.renderLcdFromRuntime();
                } catch (e) {
                    this.simLog('error', `预设失败: ${presetId}`, e.message);
                }
            } else {
                this.simLog('error', 'LcdRuntime未初始化');
            }
        }
        // 动画控制: anim:animId:start/stop/startEx:interval:timeout
        else if (action.startsWith('anim:')) {
            const parts = action.split(':');
            const animId = parts[1];
            const animAction = parts[2];
            const param1 = parts[3];  // interval for startEx
            const param2 = parts[4];  // timeout for startEx
            
            // 优先使用 AnimController (如果可用)
            if (typeof AnimController !== 'undefined') {
                try {
                    if (animAction === 'start') {
                        AnimController.start(animId);
                        this.simLog('anim', `${prefix}启动动画: ${animId}`);
                    } else if (animAction === 'startEx') {
                        // anim:laserBlink:startEx:300:15000
                        const interval = parseInt(param1) || 0;
                        const timeout = parseInt(param2) || 0;
                        AnimController.startEx(animId, interval, timeout);
                        this.simLog('anim', `${prefix}启动动画: ${animId}`, `间隔=${interval}ms, 超时=${timeout}ms`);
                    } else if (animAction === 'stop') {
                        AnimController.stop(animId);
                        this.simLog('anim', `${prefix}停止动画: ${animId}`);
                    }
                } catch (e) {
                    console.warn('AnimController动画控制失败:', animId, e);
                }
            }
            // 回退到 LcdRuntime
            else if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state.initialized) {
                try {
                    if (animAction === 'start' || animAction === 'startEx') {
                        LcdRuntime.startAnimation(animId);
                        this.simLog('lcd', `${prefix}动画: ${animId}`, 'start');
                    } else if (animAction === 'stop') {
                        LcdRuntime.stopAnimation(animId);
                        this.simLog('lcd', `${prefix}动画: ${animId}`, 'stop');
                    }
                } catch (e) {
                    console.warn('LcdRuntime动画控制失败:', animId, e);
                }
            }
        }
        // 组件API: comp:action:component:param
        else if (action.startsWith('comp:')) {
            const parts = action.split(':');
            const compAction = parts[1];
            const component = parts[2];
            let param = parts[3];
            
            // 替换变量引用 ${varname}
            if (param && param.includes('${')) {
                const originalParam = param;
                param = param.replace(/\$\{(\w+)\}/g, (_, varName) => {
                    return this.simState.variables[varName] ?? '';
                });
                this.simLog('lcd', `${prefix}${component}.${compAction}`, `${originalParam} → ${param}`);
            } else {
                this.simLog('lcd', `${prefix}${component}.${compAction}`, param || '');
            }
            
            if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state.initialized) {
                try {
                    let valueForTrigger = null;  // 用于触发onSet联动的值
                    
                    switch (compAction) {
                        case 'setValue':
                            LcdRuntime.setValue(component, param);
                            valueForTrigger = param;
                            break;
                        case 'setMode':
                            LcdRuntime.setMode(component, param);
                            valueForTrigger = param;
                            break;
                        case 'setLevel':
                            const level = parseInt(param) || 0;
                            LcdRuntime.setLevel(component, level);
                            valueForTrigger = level;
                            break;
                        case 'setVisible':
                            const visible = param === 'true';
                            LcdRuntime.setVisible(component, visible);
                            valueForTrigger = visible;
                            break;
                        case 'showPreset':
                            LcdRuntime.showPreset(component, param);
                            break;
                        case 'startBehavior':
                            LcdRuntime.startAnimation(component);
                            break;
                        case 'stopBehavior':
                            LcdRuntime.stopAnimation(component);
                            break;
                    }
                    
                    // 触发组件联动 (onSet配置)
                    if (valueForTrigger !== null && typeof AnimController !== 'undefined') {
                        AnimController.handleComponentChange(component, valueForTrigger);
                    }
                } catch (e) {
                    this.simLog('error', `组件操作失败: ${component}.${compAction}`, e.message);
                    console.warn('组件操作失败:', compAction, component, e);
                }
            }
        }
        // LCD控制: lcd:showAll/clearAll
        else if (action.startsWith('lcd:')) {
            const lcdAction = action.split(':')[1];
            this.simLog('lcd', `${prefix}LCD: ${lcdAction}`);
            if (typeof LcdRuntime !== 'undefined' && LcdRuntime.state.initialized) {
                if (lcdAction === 'showAll') {
                    LcdRuntime.showAll();
                } else if (lcdAction === 'clearAll') {
                    LcdRuntime.clearAll();
                }
                this.renderLcdFromRuntime();
            }
        }
        // 延时动作: delay:ms (模拟器中立即返回，仅记录日志)
        else if (action.startsWith('delay:')) {
            const ms = parseInt(action.split(':')[1]) || 0;
            this.simLog('action', `${prefix}延时: ${ms}ms`, '⏱️');
            // 注意: 模拟器中延时是同步的，实际固件中会真正延时
            // 如需真实延时效果，请使用超时事件(TIMEOUT)触发状态转移
        }
        // 超时设置: timeout:ms (设置当前状态的超时定时器)
        else if (action.startsWith('timeout:')) {
            const ms = parseInt(action.split(':')[1]) || 0;
            this.simLog('action', `${prefix}设置超时: ${ms}ms`, '⏰');
            // 清除之前的超时
            if (this.simState.timeoutId) {
                clearTimeout(this.simState.timeoutId);
            }
            // 设置新超时
            if (ms > 0) {
                this.simState.timeoutId = setTimeout(() => {
                    if (this.simState.running) {
                        this.simLog('event', '超时触发', `${ms}ms`);
                        this.simSendEvent('TIMEOUT');
                    }
                }, ms);
            }
        }
        // 流程控制: flow:xxx (调用FlowController)
        else if (action.startsWith('flow:')) {
            if (typeof FlowController !== 'undefined') {
                const parts = action.split(':');
                const cmd = parts[1];
                const param = parts[2];
                
                // 替换变量引用 ${varname}
                let resolvedParam = param;
                if (param && param.includes('${')) {
                    resolvedParam = param.replace(/\$\{(\w+)\}/g, (_, varName) => {
                        return this.simState.variables[varName] ?? '';
                    });
                }
                
                switch (cmd) {
                    case 'setType':
                        FlowController.setFlowType(resolvedParam);
                        // 同时加载当前复合状态的步骤配置
                        // source 是执行入口动作的状态ID，需要找到它的父状态（复合状态）
                        const parentState = this.findParentState(source);
                        if (parentState) {
                            this.loadFlowStepConfigs(parentState.id);
                        } else {
                            // 如果source本身就是复合状态
                            this.loadFlowStepConfigs(source);
                        }
                        this.simLog('flow', `${prefix}设置流程类型: ${resolvedParam}`);
                        break;
                        
                    case 'onEnterReady':
                        // 进入准备状态时调用，由状态机入口动作触发
                        // source 参数就是当前执行入口动作的状态ID
                        const enterStateId = source || this.simState.currentState;
                        FlowController.enterState(enterStateId);
                        this.simLog('flow', `${prefix}进入准备状态: ${enterStateId}`, `step=${FlowController.state.currentStep}`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'storeSlot':
                        // flow:storeSlot:2 - 存储到slot[2] (Line3)
                        const slotIdx = parseInt(resolvedParam);
                        const distance = this.simState.variables.distance || 0;
                        FlowController.storeSlot(slotIdx, distance);
                        this.simLog('flow', `${prefix}存储: slot[${slotIdx}] = ${distance}`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'undo':
                        const undoResult = FlowController.undo();
                        if (undoResult) {
                            this.simLog('flow', `${prefix}撤回到: ${undoResult.stateId}`, `step=${undoResult.stepIndex}`);
                            this.syncFlowDataToSimVars();
                            // 返回目标状态，供状态机转移
                            return undoResult.stateId;
                        } else {
                            this.simLog('flow', `${prefix}无法撤回`, '无快照');
                        }
                        break;
                        
                    case 'scrollUp':
                        FlowController.scrollUp();
                        this.simLog('flow', `${prefix}数据上移`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'scrollDown':
                        FlowController.scrollDown();
                        this.simLog('flow', `${prefix}数据下移`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'calcArea':
                        const area = FlowController.calcArea();
                        this.simLog('flow', `${prefix}计算面积: ${area}`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'calcVolume':
                        const volume = FlowController.calcVolume();
                        this.simLog('flow', `${prefix}计算体积: ${volume}`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'calcPyth1':
                        const pyth = FlowController.calcPyth1();
                        if (pyth !== null) {
                            this.simLog('flow', `${prefix}勾股计算: ${pyth}`);
                        } else {
                            this.simLog('error', `${prefix}勾股计算失败: 斜边必须大于直角边`);
                        }
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'clearSlots':
                        FlowController.clearSlots();
                        this.simLog('flow', `${prefix}清空数据槽`);
                        this.syncFlowDataToSimVars();
                        break;
                        
                    case 'resetContinuous':
                        FlowController.resetContinuous();
                        this.simLog('flow', `${prefix}重置连续测量`);
                        break;
                        
                    default:
                        this.simLog('error', `${prefix}未知flow命令: ${cmd}`);
                }
            } else {
                this.simLog('error', `${prefix}FlowController未加载`);
            }
        }
        // 硬件控制: hw:device:action (仅更新变量状态，实际硬件由固件控制)
        else if (action.startsWith('hw:')) {
            const parts = action.split(':');
            const device = parts[1];
            const hwAction = parts[2];
            
            // 更新模拟状态中的硬件标志
            switch (device) {
                case 'laser':
                    this.simState.variables.laser_on = (hwAction === 'on');
                    this.simLog('action', `${prefix}激光: ${hwAction}`, hwAction === 'on' ? '🔴' : '⚫');
                    break;
                case 'backlight':
                    this.simState.variables.backlight_on = (hwAction === 'on');
                    this.simLog('action', `${prefix}背光: ${hwAction}`, hwAction === 'on' ? '💡' : '🌑');
                    break;
                case 'beep':
                    this.simLog('action', `${prefix}蜂鸣器: ${hwAction}`, '🔊');
                    console.log(`[SIM] 蜂鸣器: ${hwAction}`);
                    break;
                case 'power':
                    if (hwAction === 'off') {
                        this.simLog('action', `${prefix}系统关机`, '⏻');
                        console.log('[SIM] 系统关机');
                    }
                    break;
            }
        }
    },
    
    /**
     * 进入状态 - 处理复合状态的初始子状态
     */
    simEnterState(stateId) {
        const state = this.findStateById(stateId);
        if (!state) {
            console.warn('[SIM] 状态不存在:', stateId);
            return stateId;
        }
        
        // 如果是复合状态，进入初始子状态
        if (state.type === 'compound' && state.children && state.initial) {
            const initialChild = state.initial;
            this.simLog('state', `${stateId} → ${initialChild}`, '(进入初始子状态)');
            
            // 执行初始子状态的入口动作
            this.simExecuteEntryActions(initialChild);
            
            // 递归处理
            return this.simEnterState(initialChild);
        }
        
        this.simLog('state', `到达原子状态: ${stateId}`);
        return stateId;
    },
    
    simExecuteEntryActions(stateId) {
        const state = this.findStateById(stateId);
        if (state && state.entryActions && state.entryActions.length > 0) {
            this.simLog('entry', `${stateId} 入口动作`, `共${state.entryActions.length}个`);
            state.entryActions.forEach((action, index) => {
                console.log(`%c   [${index + 1}] ${action}`, 'color: #f59e0b;');
                this.simExecuteAction(action, stateId);
            });
        }
    },
    
    simExecuteExitActions(stateId) {
        const state = this.findStateById(stateId);
        if (state && state.exitActions && state.exitActions.length > 0) {
            this.simLog('exit', `${stateId} 退出动作`, `共${state.exitActions.length}个`);
            state.exitActions.forEach((action, index) => {
                console.log(`%c   [${index + 1}] ${action}`, 'color: #ef4444;');
                this.simExecuteAction(action, stateId);
            });
        }
    },
    
    findStateById(stateId, hierarchy = null) {
        hierarchy = hierarchy || this.state.machine?.hierarchy;
        if (!hierarchy) return null;
        
        for (const state of Object.values(hierarchy)) {
            if (state.id === stateId) return state;
            if (state.children) {
                const found = this.findStateById(stateId, state.children);
                if (found) return found;
            }
        }
        return null;
    },
    
    simUpdateUI() {
        // 更新当前状态显示
        const stateEl = document.getElementById('hsm-sim-current-state');
        if (stateEl) {
            const state = this.findStateById(this.simState.currentState);
            const label = state?.label || this.simState.currentState;
            stateEl.textContent = label;
            // 添加运行状态指示
            stateEl.style.color = this.simState.running ? '#22c55e' : 'var(--text-color)';
            console.log('[SIM] UI更新 - 当前状态:', this.simState.currentState, '标签:', label, '运行中:', this.simState.running);
        }
        
        // 更新变量显示
        const varsEl = document.getElementById('hsm-sim-vars');
        if (varsEl) {
            const importantVars = ['unit', 'laser_on', 'backlight_on', 'runstep', 'measure_mode', 'base_back', 'beep_enable'];
            let html = '';
            for (const name of importantVars) {
                if (this.simState.variables[name] !== undefined) {
                    let value = this.simState.variables[name];
                    let displayValue = value;
                    
                    // 格式化显示
                    if (typeof value === 'boolean') {
                        displayValue = value ? '✓' : '✗';
                    } else if (name === 'unit') {
                        const unitNames = ['m', 'ft', 'in'];
                        displayValue = `${value} (${unitNames[value] || '?'})`;
                    }
                    
                    html += `<div class="hsm-sim-var"><span>${name}</span><span>${displayValue}</span></div>`;
                }
            }
            varsEl.innerHTML = html || '<div style="color:var(--text-muted);font-size:10px;">无变量</div>';
        }
        
        // 更新历史显示
        const historyEl = document.getElementById('hsm-sim-history');
        if (historyEl) {
            if (this.simState.history.length === 0) {
                historyEl.innerHTML = '<div class="hsm-sim-history-empty">点击事件按钮开始模拟</div>';
            } else {
                historyEl.innerHTML = this.simState.history.map(h => `
                    <div class="hsm-sim-history-item">
                        <span class="hsm-sim-history-event">${h.event}</span>
                        <span class="hsm-sim-history-arrow">→</span>
                        <span class="hsm-sim-history-state">${h.to}</span>
                    </div>
                `).join('');
            }
        }
        
        // 更新流程控制器状态显示
        this.updateSimVarsDisplay();
    },
    
    simHighlightState(stateId) {
        // 找到状态所在的路径，自动导航到对应层级
        const statePath = this.findStatePath(stateId);
        if (statePath && statePath.length > 0) {
            // 获取父路径（不包括状态本身）
            const parentPath = statePath.slice(0, -1);
            if (parentPath.length > 0) {
                // 检查是否需要切换路径
                const currentPathStr = this.state.currentPath.join('/');
                const targetPathStr = parentPath.join('/');
                
                if (currentPathStr !== targetPathStr) {
                    console.log('[SIM] 自动导航到:', parentPath);
                    this.state.currentPath = parentPath;
                    this.updateBreadcrumb();
                    this.updateLevelHint();
                    this.renderTree();
                    // 仿真时不自动布局，只渲染
                }
            }
        }
        
        // 重新渲染画布
        this._doRender();
        
        // 在画布上高亮当前状态
        if (!this.ctx) return;
        
        // 获取当前路径下的节点位置
        const path = this.state.currentPath.join('/');
        const positions = this.state.machine?.nodePositions?.[path] || {};
        const pos = positions[stateId];
        
        if (pos && pos.x !== undefined) {
            this.ctx.save();
            this.ctx.translate(this.state.panX, this.state.panY);
            this.ctx.scale(this.state.zoom, this.state.zoom);
            
            // 绘制高亮边框（绿色虚线）
            this.ctx.strokeStyle = '#22c55e';
            this.ctx.lineWidth = 3;
            this.ctx.setLineDash([5, 3]);
            
            const w = this.getNodeWidth(this.findStateById(stateId)) || 120;
            const h = this.getNodeHeight(this.findStateById(stateId)) || 50;
            this.ctx.strokeRect(pos.x - 5, pos.y - 5, w + 10, h + 10);
            
            this.ctx.restore();
        } else {
            console.log('[SIM] 状态位置未找到:', stateId, '路径:', path);
        }
    },
    
    /**
     * 查找状态的完整路径
     * @returns {string[]} 路径数组，如 ['ROOT', 'BOOT', 'INIT']
     */
    findStatePath(stateId, hierarchy = null, currentPath = ['ROOT']) {
        hierarchy = hierarchy || this.state.machine?.hierarchy?.ROOT?.children;
        if (!hierarchy) return null;
        
        for (const [id, state] of Object.entries(hierarchy)) {
            if (state.id === stateId) {
                return [...currentPath, stateId];
            }
            if (state.children) {
                const found = this.findStatePath(stateId, state.children, [...currentPath, state.id]);
                if (found) return found;
            }
        }
        return null;
    },
    
    simUpdateLcd(stateId) {
        // 根据状态更新LCD预览 - 只刷新显示，不重新执行入口动作
        // 入口动作已经在 simExecuteEntryActions 中执行过了
        const state = this.findStateById(stateId);
        if (!state) return;
        
        if (typeof LcdRuntime === 'undefined' || !LcdRuntime.state.initialized) {
            this.refreshPreview();
            return;
        }
        
        // 点亮直接指定的LCD元素
        if (state.display?.lcdElements) {
            for (const elemName of state.display.lcdElements) {
                LcdRuntime.setElement(elemName, true);
            }
        }
        
        // 刷新LCD预览
        this.renderLcdFromRuntime();
    },
    
    // ========== 测试用例生成 ==========
    
    /**
     * 从状态机生成测试用例
     * 遍历所有转移路径，生成对应的测试脚本
     */
    generateTestCases() {
        if (!this.state.machine) {
            this.showToast('请先加载状态机', 'error');
            return;
        }
        
        const testCases = [];
        const transitions = this.state.machine.transitions || [];
        const events = this.state.machine.events || {};
        
        // 1. 生成基本转移测试
        for (const trans of transitions) {
            if (trans._comment) continue;  // 跳过注释
            
            const testCase = this.createTestCaseFromTransition(trans, events);
            if (testCase) {
                testCases.push(testCase);
            }
        }
        
        // 2. 生成路径测试（常见流程）
        const pathTests = this.generatePathTests();
        testCases.push(...pathTests);
        
        // 3. 显示生成结果
        this.showTestCaseDialog(testCases);
    },
    
    /**
     * 从单个转移创建测试用例
     */
    createTestCaseFromTransition(trans, events) {
        const eventDef = events[trans.event] || {};
        const fromState = this.findStateById(trans.from);
        const toState = this.findStateById(trans.to);
        
        if (!fromState || !toState) return null;
        
        // 映射事件到UITestLib动作
        const actionMap = {
            'K1_SHORT': { action: 'key_short', params: { key: 'K1' } },
            'K1_LONG': { action: 'key_long', params: { key: 'K1' } },
            'K1_XLONG': { action: 'key_xlong', params: { key: 'K1', duration: 1100 } },
            'K2_SHORT': { action: 'key_short', params: { key: 'K2' } },
            'K2_LONG': { action: 'key_long', params: { key: 'K2' } },
            'K3_SHORT': { action: 'key_short', params: { key: 'K3' } },
            'K3_LONG': { action: 'key_long', params: { key: 'K3' } },
            'K3_XLONG': { action: 'key_xlong', params: { key: 'K3', duration: 3000 } },
            'K1K2_COMBO': { action: 'key_combo', params: { keys: ['K1', 'K2'] } },
            'K1_RELEASE': { action: 'key_release', params: { key: 'K1' } },
            'MEASURE_OK': { action: 'sim_measure_ok', params: { distance: 12.345 } },
            'MEASURE_FAIL': { action: 'sim_measure_fail', params: { errorCode: 1 } },
            'TIMEOUT_LASER': { action: 'wait', params: { ms: 15000 } },
            'TIMEOUT_POWER': { action: 'wait', params: { ms: 60000 } },
            'TIMEOUT_BACKLIGHT': { action: 'wait', params: { ms: 30000 } },
            'TIMEOUT_1S': { action: 'wait', params: { ms: 1000 } },
        };
        
        const actionDef = actionMap[trans.event];
        if (!actionDef) return null;
        
        // 构建期望的LCD状态
        const expects = [];
        if (toState.display?.expects) {
            expects.push(...toState.display.expects);
        }
        if (toState.display?.preset) {
            expects.push(`preset:${toState.display.preset}`);
        }
        
        return {
            id: `test_${trans.from}_${trans.event}_${trans.to}`,
            name: `${fromState.label || trans.from} → ${toState.label || trans.to}`,
            description: trans.description || `${trans.event}: ${fromState.label} 到 ${toState.label}`,
            category: eventDef.category || 'transition',
            precondition: trans.from,
            steps: [
                {
                    action: actionDef.action,
                    params: actionDef.params,
                    description: eventDef.label || trans.event
                }
            ],
            expects: expects,
            expectedState: trans.to,
            guard: trans.guard || null
        };
    },
    
    /**
     * 生成常见路径测试
     */
    generatePathTests() {
        const paths = [
            // 开机流程
            {
                id: 'path_boot',
                name: '开机流程测试',
                description: '测试完整的开机流程',
                category: 'path',
                steps: [
                    { action: 'key_xlong', params: { key: 'K1', duration: 1100 }, description: 'K1超长按开机' },
                    { action: 'wait', params: { ms: 500 }, description: '等待初始化' },
                    { action: 'key_release', params: { key: 'K1' }, description: 'K1松开' },
                ],
                expects: ['进入待机状态', 'LCD显示正常'],
                expectedState: 'IDLE'
            },
            // 单次测量流程
            {
                id: 'path_single_measure',
                name: '单次测量流程',
                description: '测试单次测量完整流程',
                category: 'path',
                precondition: 'IDLE',
                steps: [
                    { action: 'key_short', params: { key: 'K1' }, description: 'K1短按开始测量' },
                    { action: 'wait', params: { ms: 200 }, description: '等待激光开启' },
                    { action: 'key_short', params: { key: 'K1' }, description: 'K1短按触发测距' },
                    { action: 'sim_measure_ok', params: { distance: 5.678 }, description: '模拟测距成功' },
                ],
                expects: ['Line4显示测量值', '激光关闭'],
                expectedState: 'RESULT'
            },
            // 模式切换流程
            {
                id: 'path_mode_switch',
                name: '模式切换测试',
                description: '测试K2短按切换测量模式',
                category: 'path',
                precondition: 'IDLE',
                steps: [
                    { action: 'key_short', params: { key: 'K2' }, description: 'K2短按切换到面积' },
                    { action: 'key_short', params: { key: 'K2' }, description: 'K2短按切换到体积' },
                    { action: 'key_short', params: { key: 'K2' }, description: 'K2短按切换到勾股1' },
                ],
                expects: ['模式图标正确切换'],
                expectedState: 'PYTH1'
            },
            // 关机流程
            {
                id: 'path_shutdown',
                name: '关机流程测试',
                description: '测试K3超长按关机',
                category: 'path',
                precondition: 'IDLE',
                steps: [
                    { action: 'key_xlong', params: { key: 'K3', duration: 3000 }, description: 'K3超长按关机' },
                ],
                expects: ['LCD全灭', '设备关机'],
                expectedState: 'OFF'
            },
            // 连续测量流程
            {
                id: 'path_continuous',
                name: '连续测量流程',
                description: '测试K1长按进入连续测量',
                category: 'path',
                precondition: 'IDLE',
                steps: [
                    { action: 'key_long', params: { key: 'K1' }, description: 'K1长按进入连续测量' },
                    { action: 'sim_measure_ok', params: { distance: 10.0 }, description: '第一次测量' },
                    { action: 'sim_measure_ok', params: { distance: 12.5 }, description: '第二次测量(MAX)' },
                    { action: 'sim_measure_ok', params: { distance: 8.0 }, description: '第三次测量(MIN)' },
                    { action: 'key_short', params: { key: 'K3' }, description: 'K3短按退出' },
                ],
                expects: ['MAX=12.5', 'MIN=8.0', '退出连续测量'],
                expectedState: 'IDLE'
            }
        ];
        
        return paths;
    },
    
    /**
     * 显示测试用例生成对话框
     */
    showTestCaseDialog(testCases) {
        const old = document.getElementById('hsm-testcase-dialog');
        if (old) old.remove();
        
        // 按分类分组
        const groups = {};
        for (const tc of testCases) {
            const cat = tc.category || 'other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(tc);
        }
        
        const categoryLabels = {
            'key': '按键测试',
            'measure': '测量测试',
            'timer': '超时测试',
            'path': '流程测试',
            'transition': '转移测试',
            'other': '其他'
        };
        
        let listHtml = '';
        for (const [cat, cases] of Object.entries(groups)) {
            listHtml += `<div class="hsm-search-category">${categoryLabels[cat] || cat} (${cases.length})</div>`;
            listHtml += cases.map(tc => `
                <div class="hsm-search-item" data-id="${tc.id}">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" checked data-testcase="${tc.id}"/>
                        <div>
                            <div class="hsm-search-item-name">${tc.name}</div>
                            <div class="hsm-search-item-desc">${tc.description || ''}</div>
                        </div>
                    </label>
                </div>
            `).join('');
        }
        
        const dialog = document.createElement('div');
        dialog.id = 'hsm-testcase-dialog';
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:450px;max-height:600px;">
                <div class="hsm-dialog-header">
                    <span>📋 生成测试用例 (${testCases.length})</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div style="margin-bottom:10px;display:flex;gap:8px;">
                        <button class="hsm-btn" onclick="document.querySelectorAll('#hsm-testcase-dialog input[type=checkbox]').forEach(c=>c.checked=true)">全选</button>
                        <button class="hsm-btn" onclick="document.querySelectorAll('#hsm-testcase-dialog input[type=checkbox]').forEach(c=>c.checked=false)">全不选</button>
                        <button class="hsm-btn" onclick="document.querySelectorAll('#hsm-testcase-dialog input[type=checkbox]').forEach(c=>c.checked=c.closest('.hsm-search-item').previousElementSibling?.textContent.includes('流程'))">仅流程</button>
                    </div>
                    <div class="hsm-search-list" style="max-height:350px;overflow-y:auto;">
                        ${listHtml}
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
                        <button class="hsm-btn" onclick="HSM.exportTestCasesAsJson()">📄 导出JSON</button>
                        <button class="hsm-btn primary" onclick="HSM.exportTestCasesAsScript()">📝 生成测试脚本</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this._generatedTestCases = testCases;
    },
    
    /**
     * 导出测试用例为JSON
     */
    exportTestCasesAsJson() {
        const selected = this.getSelectedTestCases();
        if (selected.length === 0) {
            this.showToast('请选择要导出的测试用例', 'warning');
            return;
        }
        
        const json = JSON.stringify(selected, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `test_cases_${this.state.machine?.device || 'device'}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast(`已导出 ${selected.length} 个测试用例`, 'success');
    },
    
    /**
     * 导出测试用例为JavaScript测试脚本
     */
    exportTestCasesAsScript() {
        const selected = this.getSelectedTestCases();
        if (selected.length === 0) {
            this.showToast('请选择要导出的测试用例', 'warning');
            return;
        }
        
        let script = `/**
 * 自动生成的UI测试脚本
 * 设备: ${this.state.machine?.device || 'unknown'}
 * 生成时间: ${new Date().toISOString()}
 * 测试用例数: ${selected.length}
 */

// 测试套件定义
const testSuite = {
    name: '${this.state.machine?.name || '状态机测试'}',
    device: '${this.state.machine?.device || 'gd303_mini'}',
    tests: [
`;
        
        for (const tc of selected) {
            script += `        {
            id: '${tc.id}',
            name: '${tc.name}',
            description: '${tc.description || ''}',
            precondition: '${tc.precondition || 'OFF'}',
            steps: [
`;
            for (const step of tc.steps || []) {
                script += `                { action: '${step.action}', params: ${JSON.stringify(step.params)}, desc: '${step.description || ''}' },\n`;
            }
            script += `            ],
            expects: ${JSON.stringify(tc.expects || [])},
            expectedState: '${tc.expectedState || ''}'
        },
`;
        }
        
        script += `    ]
};

// 测试执行函数
async function runTest(test) {
    console.log('执行测试:', test.name);
    
    // 设置前置条件
    if (test.precondition && test.precondition !== 'OFF') {
        await UITestLib.gotoState(test.precondition);
    }
    
    // 执行测试步骤
    for (const step of test.steps) {
        console.log('  步骤:', step.desc || step.action);
        await UITestLib.executeAction(step.action, step.params);
        await UITestLib.wait(100);  // 步骤间隔
    }
    
    // 验证期望状态
    if (test.expectedState) {
        const currentState = await UITestLib.getCurrentState();
        if (currentState !== test.expectedState) {
            throw new Error(\`状态不匹配: 期望 \${test.expectedState}, 实际 \${currentState}\`);
        }
    }
    
    // 验证LCD显示
    for (const expect of test.expects) {
        const result = await UITestLib.verifyExpect(expect);
        if (!result) {
            console.warn('  期望验证失败:', expect);
        }
    }
    
    console.log('  ✓ 测试通过');
}

// 运行所有测试
async function runAllTests() {
    console.log('开始执行测试套件:', testSuite.name);
    let passed = 0, failed = 0;
    
    for (const test of testSuite.tests) {
        try {
            await runTest(test);
            passed++;
        } catch (e) {
            console.error('✗ 测试失败:', test.name, e.message);
            failed++;
        }
    }
    
    console.log(\`测试完成: \${passed} 通过, \${failed} 失败\`);
}

// 导出
if (typeof module !== 'undefined') {
    module.exports = { testSuite, runTest, runAllTests };
}
`;
        
        const blob = new Blob([script], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `test_suite_${this.state.machine?.device || 'device'}.js`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showToast(`已生成 ${selected.length} 个测试用例的脚本`, 'success');
        
        // 关闭对话框
        const dialog = document.getElementById('hsm-testcase-dialog');
        if (dialog) dialog.remove();
    },
    
    /**
     * 获取选中的测试用例
     */
    getSelectedTestCases() {
        const checkboxes = document.querySelectorAll('#hsm-testcase-dialog input[type=checkbox]:checked');
        const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.testcase);
        return (this._generatedTestCases || []).filter(tc => selectedIds.includes(tc.id));
    },
    
    // ========== 代码生成功能 ==========
    
    /**
     * 显示代码生成对话框
     */
    async showCodeGenDialog() {
        // 检查JSZip是否已加载
        if (typeof JSZip === 'undefined') {
            // 动态加载JSZip（本地文件）
            const script = document.createElement('script');
            script.src = 'js/lib/jszip.min.js';
            script.onload = () => this._showCodeGenDialogInner();
            script.onerror = () => this.showToast('加载JSZip库失败', 'error');
            document.head.appendChild(script);
        } else {
            this._showCodeGenDialogInner();
        }
    },
    
    /**
     * 内部方法：显示代码生成对话框
     */
    async _showCodeGenDialogInner() {
        // 检查CodeGeneratorV2是否可用
        if (typeof CodeGeneratorV2 === 'undefined') {
            this.showToast('代码生成器未加载', 'error');
            return;
        }
        
        const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
        
        // 预计生成的文件列表
        const fileList = [
            { name: 'lcd_mapping.h', desc: 'LCD段码映射头文件' },
            { name: 'lcd_mapping.c', desc: 'LCD段码映射实现' },
            { name: 'ui_controller.h', desc: 'UI控制器头文件' },
            { name: 'ui_controller.c', desc: 'UI控制器实现' },
            { name: 'unit_converter.h', desc: '单位转换头文件' },
            { name: 'unit_converter.c', desc: '单位转换实现' },
            { name: 'ui_presets.h', desc: '界面预设头文件' },
            { name: 'ui_presets.c', desc: '界面预设实现' },
            { name: 'ui_animation.h', desc: '动画控制头文件' },
            { name: 'ui_animation.c', desc: '动画控制实现' },
            { name: 'ui_state_machine.h', desc: '状态机头文件' },
            { name: 'ui_state_machine.c', desc: '状态机实现' },
            { name: 'ui_hal.h', desc: '硬件抽象层' },
            { name: 'hw_callbacks.h', desc: '硬件回调接口' },
            { name: 'main_loop.c', desc: '主循环模板' },
        ];
        
        // 创建对话框
        const dialog = document.createElement('div');
        dialog.id = 'hsm-codegen-dialog';
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:500px;max-height:80vh;">
                <div class="hsm-dialog-header">
                    <span>🔧 生成C代码</span>
                    <button class="hsm-dialog-close" onclick="document.getElementById('hsm-codegen-dialog').remove()">×</button>
                </div>
                <div class="hsm-dialog-body" style="max-height:50vh;overflow-y:auto;">
                    <div style="margin-bottom:12px;padding:10px;background:var(--bg-tertiary);border-radius:6px;">
                        <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">当前设备</div>
                        <div style="font-size:14px;font-weight:600;color:var(--accent-color);">${deviceId}</div>
                    </div>
                    <div style="font-size:12px;font-weight:600;margin-bottom:8px;">📁 将生成以下文件：</div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        ${fileList.map(f => `
                            <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-primary);border-radius:4px;font-size:11px;">
                                <span style="color:#22c55e;">✓</span>
                                <span style="font-family:monospace;color:var(--text-primary);min-width:160px;">${f.name}</span>
                                <span style="color:var(--text-muted);flex:1;">${f.desc}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div id="hsm-codegen-status" style="margin-top:12px;padding:10px;border-radius:6px;display:none;"></div>
                </div>
                <div class="hsm-dialog-footer" style="justify-content:flex-end;">
                    <button class="hsm-btn" onclick="document.getElementById('hsm-codegen-dialog').remove()">取消</button>
                    <button class="hsm-btn primary" id="hsm-codegen-btn" onclick="HSM.generateAndDownloadCode()">
                        🚀 生成并下载
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
    },
    
    /**
     * 生成代码并下载ZIP
     */
    async generateAndDownloadCode() {
        console.log('[HSM] 开始生成代码...');
        const statusEl = document.getElementById('hsm-codegen-status');
        const btn = document.getElementById('hsm-codegen-btn');
        
        if (!statusEl || !btn) {
            console.error('[HSM] 找不到状态元素');
            return;
        }
        
        // 显示状态
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(59, 130, 246, 0.2)';
        statusEl.style.color = '#3b82f6';
        statusEl.innerHTML = '⏳ 正在加载配置...';
        btn.disabled = true;
        btn.innerHTML = '⏳ 生成中...';
        
        try {
            const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
            console.log('[HSM] 设备ID:', deviceId);
            
            // 加载所有配置 (V5需要额外加载 macros, modes, functions)
            console.log('[HSM] 加载配置...');
            const [lcdProject, components, presets, animations, stateMachine, variables, macros, modes, functions] = await Promise.all([
                DeviceConfigManager.loadLcdProject(deviceId),
                DeviceConfigManager.loadConfig('components', deviceId),
                DeviceConfigManager.loadConfig('presets', deviceId),
                DeviceConfigManager.loadConfig('animations', deviceId),
                DeviceConfigManager.loadConfig('ui', deviceId),
                DeviceConfigManager.loadConfig('variables', deviceId),
                DeviceConfigManager.loadConfig('macros', deviceId),
                DeviceConfigManager.loadConfig('flow', deviceId),
                DeviceConfigManager.loadConfig('functions', deviceId)
            ]);
            console.log('[HSM] 配置加载完成');
            
            statusEl.innerHTML = '⏳ 正在生成代码...';
            
            // 调用代码生成器 (优先使用v5，回退到v4，再回退到v2)
            const generator = window.CodeGeneratorV5 || window.CodeGeneratorV4 || window.CodeGeneratorV2;
            const genVersion = window.CodeGeneratorV5 ? 'v5' : (window.CodeGeneratorV4 ? 'v4' : 'v2');
            console.log(`[HSM] 调用CodeGenerator ${genVersion}...`);
            const projectData = { lcdProject, components, presets, animations, stateMachine, variables, macros, modes, functions };
            const generatedFiles = await generator.generateAll(projectData);
            console.log('[HSM] 代码生成完成, 文件数:', Object.keys(generatedFiles).length);
            
            // 统计
            let totalLines = 0;
            let totalBytes = 0;
            let fileCount = 0;
            
            for (const [filename, content] of Object.entries(generatedFiles)) {
                if (content) {
                    totalLines += content.split('\n').length;
                    totalBytes += new Blob([content]).size;
                    fileCount++;
                }
            }
            console.log('[HSM] 统计: ', fileCount, '文件,', totalLines, '行,', totalBytes, '字节');
            
            statusEl.innerHTML = `⏳ 正在保存 ${fileCount} 个文件...`;
            
            // 调用后端API弹出保存对话框
            console.log('[HSM] 调用save_zip_dialog...');
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    method: 'save_zip_dialog', 
                    params: [`${deviceId}_generated_code.zip`, generatedFiles] 
                })
            });
            const result = await response.json();
            console.log('[HSM] 保存结果:', result);
            
            if (result.success) {
                // 成功
                statusEl.style.background = 'rgba(34, 197, 94, 0.2)';
                statusEl.style.color = '#22c55e';
                statusEl.innerHTML = `✅ 生成完成！共 ${fileCount} 个文件，${totalLines} 行，${(totalBytes/1024).toFixed(1)} KB<br><span style="font-size:10px;">已保存到: ${result.path}</span>`;
                
                btn.innerHTML = '✅ 完成';
                btn.disabled = false;
                btn.onclick = () => {
                    document.getElementById('hsm-codegen-dialog')?.remove();
                };
                
                this.showToast(`代码已保存: ${result.path}`, 'success');
            } else {
                throw new Error(result.error || '保存失败');
            }
            
        } catch (e) {
            console.error('[HSM] 代码生成失败:', e);
            statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
            statusEl.style.color = '#ef4444';
            statusEl.innerHTML = `❌ 生成失败: ${e.message}`;
            btn.disabled = false;
            btn.innerHTML = '🔄 重试';
        }
    }
};

// 页面加载时初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => HSM.init());
} else {
    HSM.init();
}