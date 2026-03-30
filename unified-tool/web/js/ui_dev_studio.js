/**
 * UI 开发工作室 - 层级化可视化开发平台
 * 整合: 事件库 → 动作库 → 模式树 → 流程编辑 → 模拟运行
 */
window.UIDevStudio = {
    // 数据
    events: {},           // 事件库
    eventCategories: {},  // 事件分类
    actions: {},          // 动作库
    modeTree: {},         // 模式树
    flows: {},            // 流程定义
    lcdProject: null,     // LCD配置
    
    // 状态
    currentTab: 'events',
    currentCategory: null,
    currentAction: null,
    currentMode: null,
    currentFlow: null,
    currentFlowState: null,
    modified: false,
    
    // 流程编辑器状态
    flowTool: 'pointer',
    flowCanvas: null,
    flowCtx: null,
    flowZoom: 1,
    flowOffset: { x: 0, y: 0 },
    flowNodePositions: {},
    
    // 模拟器状态
    simState: null,
    simLog: [],
    
    // ==================== 初始化 ====================
    async init() {
        console.log('[UIDevStudio] 初始化...');
        
        // 初始化设备选择器
        if (window.DeviceConfigManager) {
            await DeviceConfigManager.init();
            DeviceConfigManager.createSelector('studio-device-selector', async (deviceId) => {
                await this.loadDevice(deviceId);
            });
        }
        
        // 初始化画布
        this.initFlowCanvas();
        
        // 加载当前设备
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (deviceId) {
            await this.loadDevice(deviceId);
        }
        
        // 渲染初始界面
        this.renderEventCategories();
    },
    
    // ==================== 设备加载 ====================
    async loadDevice(deviceId) {
        console.log('[UIDevStudio] 加载设备:', deviceId);
        document.getElementById('studio-device').textContent = '设备: ' + deviceId;
        
        // 加载LCD配置
        this.lcdProject = await DeviceConfigManager.loadLcdProject(deviceId);
        
        // 加载UI配置 (包含事件、动作、模式树、流程)
        try {
            const uiConfig = await DeviceConfigManager.loadConfig('ui', deviceId);
            if (uiConfig) {
                this.eventCategories = uiConfig.eventCategories || this.getDefaultEventCategories();
                this.events = uiConfig.events || {};
                this.actions = uiConfig.actions || {};
                this.modeTree = uiConfig.modeTree || this.getDefaultModeTree();
                this.flows = uiConfig.flows || {};
            } else {
                this.loadDefaults();
            }
        } catch (e) {
            console.log('加载UI配置失败，使用默认值');
            this.loadDefaults();
        }
        
        // 刷新界面
        this.renderCurrentTab();
    },
    
    loadDefaults() {
        this.eventCategories = this.getDefaultEventCategories();
        this.events = this.getDefaultEvents();
        this.actions = this.getDefaultActions();
        this.modeTree = this.getDefaultModeTree();
        this.flows = this.getDefaultFlows();
        this.flowNodePositions = this.getDefaultFlowPositions();
    },
    
    // 默认动作库
    getDefaultActions() {
        return {
            idle_display: {
                label: '待机显示',
                description: '显示待机界面',
                ui: { line4: '-----', laser: false },
                hardware: [],
                sound: null
            },
            laser_on: {
                label: '开启激光',
                description: '开启激光并显示',
                ui: { laser: true },
                hardware: ['LASER_ON'],
                timer: { start: 'laser_timeout', duration: 30000 },
                sound: 'beep_short'
            },
            laser_off: {
                label: '关闭激光',
                description: '关闭激光',
                ui: { laser: false },
                hardware: ['LASER_OFF'],
                timer: { stop: 'laser_timeout' },
                sound: null
            },
            start_measure: {
                label: '开始测量',
                description: '启动测距',
                ui: {},
                hardware: ['MEASURE_START'],
                sound: 'beep_short'
            },
            show_result: {
                label: '显示结果',
                description: '显示测量结果',
                ui: { line4: '$result', laser: false },
                hardware: [],
                timer: { start: 'display_timeout', duration: 60000 },
                sound: 'beep_short'
            },
            show_error: {
                label: '显示错误',
                description: '显示测量错误',
                ui: { line4: 'Error', laser: false },
                hardware: [],
                timer: { start: 'error_timeout', duration: 3000 },
                sound: 'beep_error'
            },
            clear_display: {
                label: '清除显示',
                description: '清除当前显示',
                ui: { line4: '-----' },
                hardware: [],
                sound: null
            },
            power_off: {
                label: '关机',
                description: '执行关机操作',
                ui: { line4: '', laser: false },
                hardware: ['POWER_OFF'],
                sound: 'beep_long'
            }
        };
    },
    
    // 默认流程
    getDefaultFlows() {
        return {
            'ON.MEASURE_MODE.SINGLE': {
                states: {
                    IDLE: {
                        label: '待机',
                        display: { line4: '-----', laser: false, unit: 'm', mode: 'single' },
                        onEnter: ['idle_display']
                    },
                    LASER_ON: {
                        label: '激光开启',
                        display: { line4: '-----', laser: true },
                        onEnter: ['laser_on']
                    },
                    MEASURING: {
                        label: '测量中',
                        display: { line4: '-----', laser: true },
                        onEnter: ['start_measure']
                    },
                    RESULT: {
                        label: '显示结果',
                        display: { line4: '$result', laser: false },
                        onEnter: ['show_result']
                    },
                    ERROR: {
                        label: '错误',
                        display: { line4: 'Error', laser: false },
                        onEnter: ['show_error']
                    }
                },
                transitions: [
                    { from: 'IDLE', to: 'LASER_ON', event: 'K1_SHORT', actions: [] },
                    { from: 'LASER_ON', to: 'MEASURING', event: 'K1_SHORT', actions: [] },
                    { from: 'LASER_ON', to: 'IDLE', event: 'K3_SHORT', actions: ['laser_off'] },
                    { from: 'LASER_ON', to: 'IDLE', event: 'TIMEOUT', actions: ['laser_off'] },
                    { from: 'MEASURING', to: 'RESULT', event: 'MEASURE_OK', actions: [] },
                    { from: 'MEASURING', to: 'ERROR', event: 'MEASURE_FAIL', actions: [] },
                    { from: 'MEASURING', to: 'ERROR', event: 'MEASURE_TIMEOUT', actions: [] },
                    { from: 'RESULT', to: 'LASER_ON', event: 'K1_SHORT', actions: [] },
                    { from: 'RESULT', to: 'IDLE', event: 'K3_SHORT', actions: ['clear_display'] },
                    { from: 'RESULT', to: 'IDLE', event: 'TIMEOUT', actions: [] },
                    { from: 'ERROR', to: 'IDLE', event: 'K3_SHORT', actions: [] },
                    { from: 'ERROR', to: 'IDLE', event: 'TIMEOUT', actions: [] }
                ],
                initialState: 'IDLE'
            },
            'ON.MEASURE_MODE.CONTINUOUS': {
                states: {
                    IDLE: {
                        label: '待机',
                        display: { line4: '-----', laser: false },
                        onEnter: ['idle_display']
                    },
                    RUNNING: {
                        label: '连续测量中',
                        display: { line4: '$result', laser: true },
                        onEnter: ['laser_on', 'start_measure']
                    },
                    PAUSED: {
                        label: '暂停',
                        display: { line4: '$result', laser: false },
                        onEnter: ['laser_off']
                    }
                },
                transitions: [
                    { from: 'IDLE', to: 'RUNNING', event: 'K1_LONG', actions: [] },
                    { from: 'RUNNING', to: 'PAUSED', event: 'K1_SHORT', actions: [] },
                    { from: 'RUNNING', to: 'IDLE', event: 'K3_SHORT', actions: ['laser_off'] },
                    { from: 'PAUSED', to: 'RUNNING', event: 'K1_SHORT', actions: [] },
                    { from: 'PAUSED', to: 'IDLE', event: 'K3_SHORT', actions: [] }
                ],
                initialState: 'IDLE'
            }
        };
    },
    
    // 默认节点位置
    getDefaultFlowPositions() {
        return {
            'ON.MEASURE_MODE.SINGLE': {
                IDLE: { x: 50, y: 120 },
                LASER_ON: { x: 230, y: 120 },
                MEASURING: { x: 410, y: 120 },
                RESULT: { x: 410, y: 250 },
                ERROR: { x: 590, y: 120 }
            },
            'ON.MEASURE_MODE.CONTINUOUS': {
                IDLE: { x: 50, y: 150 },
                RUNNING: { x: 250, y: 150 },
                PAUSED: { x: 450, y: 150 }
            }
        };
    },

    // ==================== 默认数据 ====================
    getDefaultEventCategories() {
        return {
            key: { label: '按键事件', color: '#3b82f6', icon: '🔘' },
            hardware: { label: '硬件事件', color: '#f59e0b', icon: '⚡' },
            measure: { label: '测量事件', color: '#22c55e', icon: '📏' },
            comm: { label: '通信事件', color: '#8b5cf6', icon: '📡' },
            system: { label: '系统事件', color: '#ef4444', icon: '⚙️' }
        };
    },
    
    getDefaultEvents() {
        return {
            // 按键事件
            K1_SHORT: { category: 'key', label: 'K1短按', description: '测量键短按' },
            K1_LONG: { category: 'key', label: 'K1长按', description: '测量键长按，进入连续测量' },
            K2_SHORT: { category: 'key', label: 'K2短按', description: '模式键短按' },
            K2_LONG: { category: 'key', label: 'K2长按', description: '模式键长按' },
            K3_SHORT: { category: 'key', label: 'K3短按', description: '清除键短按' },
            K3_LONG: { category: 'key', label: 'K3长按', description: '清除键长按' },
            K3_SUPER_LONG: { category: 'key', label: 'K3超长按', description: '关机' },
            POWER_KEY: { category: 'key', label: '开机键', description: '开机' },
            // 硬件事件
            CHARGE_IN: { category: 'hardware', label: '充电插入', description: '充电器插入' },
            CHARGE_OUT: { category: 'hardware', label: '充电拔出', description: '充电器拔出' },
            CHARGE_FULL: { category: 'hardware', label: '充电完成', description: '电池充满' },
            LOW_BATTERY: { category: 'hardware', label: '低电报警', description: '电量低于20%' },
            CRITICAL_BAT: { category: 'hardware', label: '电量耗尽', description: '电量低于5%' },
            // 测量事件
            MEASURE_OK: { category: 'measure', label: '测距成功', params: ['dist', 'precision'] },
            MEASURE_FAIL: { category: 'measure', label: '测距失败', params: ['errorCode'] },
            MEASURE_TIMEOUT: { category: 'measure', label: '测距超时', description: '测量超时' },
            // 通信事件
            BT_CONNECTED: { category: 'comm', label: '蓝牙连接', description: '蓝牙设备连接' },
            BT_DISCONNECTED: { category: 'comm', label: '蓝牙断开', description: '蓝牙设备断开' },
            // 系统事件
            TIMEOUT: { category: 'system', label: '超时', description: '通用超时事件' },
            AUTO_OFF: { category: 'system', label: '自动关机', description: '自动关机超时' }
        };
    },
    
    getDefaultModeTree() {
        return {
            OFF: { label: '关机', type: 'atomic', icon: '⭕' },
            CHARGING: { label: '充电中', type: 'atomic', icon: '🔋' },
            ON: {
                label: '运行中',
                type: 'compound',
                icon: '🟢',
                initial: 'MEASURE_MODE',
                children: {
                    MEASURE_MODE: {
                        label: '测量模式',
                        type: 'compound',
                        icon: '📏',
                        initial: 'SINGLE',
                        children: {
                            SINGLE: { label: '单次测距', type: 'flow', icon: '1️⃣' },
                            CONTINUOUS: { label: '连续测距', type: 'flow', icon: '🔄' },
                            AREA: { label: '面积测量', type: 'flow', icon: '⬜' }
                        }
                    },
                    SETTING_MODE: {
                        label: '设置模式',
                        type: 'compound',
                        icon: '⚙️',
                        children: {
                            UNIT_SELECT: { label: '单位选择', type: 'flow', icon: '📐' },
                            BACKLIGHT: { label: '背光设置', type: 'flow', icon: '💡' }
                        }
                    }
                }
            }
        };
    },
    
    // ==================== Tab 切换 ====================
    switchTab(tab) {
        this.currentTab = tab;
        
        // 更新 Tab 按钮状态
        document.querySelectorAll('.studio-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        // 显示对应面板
        document.querySelectorAll('.studio-panel').forEach(panel => {
            panel.style.display = 'none';
        });
        document.getElementById(`panel-${tab}`).style.display = 'block';
        
        // 渲染内容
        this.renderCurrentTab();
    },
    
    renderCurrentTab() {
        switch (this.currentTab) {
            case 'events': this.renderEventCategories(); break;
            case 'actions': this.renderActionList(); break;
            case 'modes': this.renderModeTree(); break;
            case 'flow': this.renderFlowEditor(); break;
            case 'simulate': this.renderSimulator(); break;
        }
    },

    // ==================== 事件库 ====================
    renderEventCategories() {
        const container = document.getElementById('event-categories');
        if (!container) return;
        
        let html = '';
        for (const [catId, cat] of Object.entries(this.eventCategories)) {
            const count = Object.values(this.events).filter(e => e.category === catId).length;
            const isActive = this.currentCategory === catId;
            html += `
                <div class="event-category ${isActive ? 'active' : ''}" onclick="UIDevStudio.selectCategory('${catId}')">
                    <span class="cat-color" style="background:${cat.color}"></span>
                    <span class="cat-name">${cat.icon || ''} ${cat.label}</span>
                    <span class="cat-count">${count}</span>
                </div>
            `;
        }
        container.innerHTML = html;
        
        // 如果有选中分类，渲染事件列表
        if (this.currentCategory) {
            this.renderEventList();
        }
    },
    
    selectCategory(catId) {
        this.currentCategory = catId;
        this.renderEventCategories();
        this.renderEventList();
    },
    
    renderEventList() {
        const container = document.getElementById('event-list');
        const title = document.getElementById('events-title');
        if (!container) return;
        
        const cat = this.eventCategories[this.currentCategory];
        title.textContent = cat ? `${cat.label} (${cat.icon || ''})` : '选择分类查看事件';
        
        const events = Object.entries(this.events).filter(([id, e]) => e.category === this.currentCategory);
        
        if (events.length === 0) {
            container.innerHTML = '<div class="empty-hint">该分类暂无事件</div>';
            return;
        }
        
        let html = '';
        for (const [eventId, event] of events) {
            const color = cat?.color || '#666';
            html += `
                <div class="event-item" style="border-left-color:${color}">
                    <div class="event-id">${eventId}</div>
                    <div class="event-label">${event.label || ''}</div>
                    ${event.params ? `<div class="event-params">参数: ${event.params.join(', ')}</div>` : ''}
                    ${event.description ? `<div class="event-label">${event.description}</div>` : ''}
                </div>
            `;
        }
        container.innerHTML = html;
    },
    
    addEvent() {
        if (!this.currentCategory) {
            alert('请先选择事件分类');
            return;
        }
        
        const eventId = prompt('输入事件ID (如 K1_SHORT):');
        if (!eventId) return;
        
        const label = prompt('输入事件名称:');
        
        this.events[eventId.toUpperCase()] = {
            category: this.currentCategory,
            label: label || eventId,
            description: ''
        };
        
        this.markModified();
        this.renderEventCategories();
        this.renderEventList();
    },
    
    addEventCategory() {
        const catId = prompt('输入分类ID (如 custom):');
        if (!catId) return;
        
        const label = prompt('输入分类名称:');
        const color = prompt('输入颜色 (如 #ff6600):', '#666666');
        
        this.eventCategories[catId] = {
            label: label || catId,
            color: color || '#666666',
            icon: '📌'
        };
        
        this.markModified();
        this.renderEventCategories();
    },
    
    // ==================== 动作库 ====================
    renderActionList() {
        const container = document.getElementById('action-list');
        if (!container) return;
        
        const actions = Object.entries(this.actions);
        
        if (actions.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无动作，点击 ➕ 添加</div>';
            return;
        }
        
        let html = '';
        for (const [actionId, action] of actions) {
            const isActive = this.currentAction === actionId;
            html += `
                <div class="action-item ${isActive ? 'active' : ''}" onclick="UIDevStudio.selectAction('${actionId}')">
                    <div class="action-id">${actionId}</div>
                    <div class="action-desc">${action.label || ''}</div>
                </div>
            `;
        }
        container.innerHTML = html;
    },
    
    selectAction(actionId) {
        this.currentAction = actionId;
        this.renderActionList();
        this.renderActionEditor();
    },
    
    renderActionEditor() {
        const container = document.getElementById('action-editor');
        if (!container || !this.currentAction) {
            container.innerHTML = '<div class="empty-hint">👈 选择或创建动作</div>';
            return;
        }
        
        const action = this.actions[this.currentAction];
        const components = this.lcdProject?.components || {};
        
        let html = `
            <div class="form-group">
                <label>动作ID</label>
                <input type="text" value="${this.currentAction}" disabled>
            </div>
            <div class="form-group">
                <label>动作名称</label>
                <input type="text" id="action-label" value="${action.label || ''}" 
                    onchange="UIDevStudio.updateAction('label', this.value)">
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea id="action-desc" rows="2" onchange="UIDevStudio.updateAction('description', this.value)">${action.description || ''}</textarea>
            </div>
            
            <div class="form-section">
                <div class="form-section-title">📺 UI 变化</div>
        `;
        
        // LCD组件编辑
        const ui = action.ui || {};
        for (const [compId, comp] of Object.entries(components)) {
            const value = ui[compId];
            html += this.renderActionComponentEditor(compId, comp, value);
        }
        
        html += `
            </div>
            <div class="form-section">
                <div class="form-section-title">⚡ 硬件操作</div>
                <div class="form-group">
                    <label>硬件命令 (逗号分隔)</label>
                    <input type="text" value="${(action.hardware || []).join(', ')}" 
                        onchange="UIDevStudio.updateAction('hardware', this.value.split(',').map(s=>s.trim()).filter(s=>s))">
                </div>
            </div>
            <div class="form-section">
                <div class="form-section-title">⏱️ 定时器</div>
                <div class="form-group">
                    <label>启动定时器</label>
                    <input type="text" placeholder="定时器名称" value="${action.timer?.start || ''}"
                        onchange="UIDevStudio.updateActionTimer('start', this.value)">
                </div>
                <div class="form-group">
                    <label>超时时间 (ms)</label>
                    <input type="number" value="${action.timer?.duration || ''}"
                        onchange="UIDevStudio.updateActionTimer('duration', parseInt(this.value))">
                </div>
            </div>
            <div class="form-section">
                <div class="form-section-title">🔊 声音</div>
                <div class="form-group">
                    <label>蜂鸣器</label>
                    <select onchange="UIDevStudio.updateAction('sound', this.value)">
                        <option value="" ${!action.sound ? 'selected' : ''}>无</option>
                        <option value="beep_short" ${action.sound === 'beep_short' ? 'selected' : ''}>短响</option>
                        <option value="beep_long" ${action.sound === 'beep_long' ? 'selected' : ''}>长响</option>
                        <option value="beep_error" ${action.sound === 'beep_error' ? 'selected' : ''}>错误音</option>
                    </select>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    renderActionComponentEditor(compId, comp, value) {
        let inputHtml = '';
        
        switch (comp.type) {
            case 'digit_group':
                inputHtml = `<input type="text" value="${value !== undefined ? value : ''}" placeholder="数值或变量如 $result"
                    onchange="UIDevStudio.updateActionUI('${compId}', this.value)">`;
                break;
            case 'icon':
                inputHtml = `<select onchange="UIDevStudio.updateActionUI('${compId}', this.value === 'true')">
                    <option value="" ${value === undefined ? 'selected' : ''}>不变</option>
                    <option value="true" ${value === true ? 'selected' : ''}>点亮</option>
                    <option value="false" ${value === false ? 'selected' : ''}>熄灭</option>
                </select>`;
                break;
            case 'select_one':
                const options = comp.options || {};
                inputHtml = `<select onchange="UIDevStudio.updateActionUI('${compId}', this.value || undefined)">
                    <option value="" ${!value ? 'selected' : ''}>不变</option>`;
                for (const [optId, opt] of Object.entries(options)) {
                    inputHtml += `<option value="${optId}" ${value === optId ? 'selected' : ''}>${opt.label || optId}</option>`;
                }
                inputHtml += '</select>';
                break;
            default:
                inputHtml = `<input type="text" value="${value || ''}" onchange="UIDevStudio.updateActionUI('${compId}', this.value)">`;
        }
        
        return `<div class="form-group"><label>${comp.label || compId}</label>${inputHtml}</div>`;
    },
    
    addAction() {
        const actionId = prompt('输入动作ID (如 laser_on):');
        if (!actionId) return;
        
        this.actions[actionId] = {
            label: actionId,
            description: '',
            ui: {},
            hardware: [],
            timer: null,
            sound: null
        };
        
        this.currentAction = actionId;
        this.markModified();
        this.renderActionList();
        this.renderActionEditor();
    },
    
    updateAction(field, value) {
        if (!this.currentAction) return;
        this.actions[this.currentAction][field] = value;
        this.markModified();
    },
    
    updateActionUI(compId, value) {
        if (!this.currentAction) return;
        if (!this.actions[this.currentAction].ui) {
            this.actions[this.currentAction].ui = {};
        }
        if (value === undefined || value === '') {
            delete this.actions[this.currentAction].ui[compId];
        } else {
            this.actions[this.currentAction].ui[compId] = value;
        }
        this.markModified();
    },
    
    updateActionTimer(field, value) {
        if (!this.currentAction) return;
        if (!this.actions[this.currentAction].timer) {
            this.actions[this.currentAction].timer = {};
        }
        this.actions[this.currentAction].timer[field] = value;
        this.markModified();
    },

    // ==================== 模式树 ====================
    renderModeTree() {
        const container = document.getElementById('mode-tree');
        if (!container) return;
        
        let html = this.renderModeNode(this.modeTree, '', 0);
        container.innerHTML = html || '<div class="empty-hint">暂无模式定义</div>';
    },
    
    renderModeNode(nodes, parentPath, level) {
        let html = '';
        for (const [nodeId, node] of Object.entries(nodes)) {
            const path = parentPath ? `${parentPath}.${nodeId}` : nodeId;
            const hasChildren = node.children && Object.keys(node.children).length > 0;
            const isActive = this.currentMode === path;
            const isExpanded = true; // 默认展开
            
            html += `<div class="mode-node">
                <div class="mode-node-header ${isActive ? 'active' : ''}" onclick="UIDevStudio.selectMode('${path}')">
                    <span class="expand-icon">${hasChildren ? (isExpanded ? '▼' : '▶') : ''}</span>
                    <span class="mode-icon">${node.icon || '📄'}</span>
                    <span class="mode-name">${nodeId}</span>
                    <span style="font-size:10px;color:var(--text-muted)">${node.type}</span>
                </div>`;
            
            if (hasChildren && isExpanded) {
                html += `<div class="mode-node-children">
                    ${this.renderModeNode(node.children, path, level + 1)}
                </div>`;
            }
            
            html += '</div>';
        }
        return html;
    },
    
    selectMode(path) {
        this.currentMode = path;
        this.renderModeTree();
        this.renderModeEditor();
    },
    
    renderModeEditor() {
        const container = document.getElementById('mode-editor');
        if (!container || !this.currentMode) {
            container.innerHTML = '<div class="empty-hint">👈 选择模式查看属性</div>';
            return;
        }
        
        const node = this.getModeByPath(this.currentMode);
        if (!node) return;
        
        const pathParts = this.currentMode.split('.');
        const nodeId = pathParts[pathParts.length - 1];
        
        let html = `
            <div class="form-group">
                <label>模式ID</label>
                <input type="text" value="${nodeId}" disabled>
            </div>
            <div class="form-group">
                <label>名称</label>
                <input type="text" value="${node.label || ''}" 
                    onchange="UIDevStudio.updateMode('label', this.value)">
            </div>
            <div class="form-group">
                <label>类型</label>
                <select onchange="UIDevStudio.updateMode('type', this.value)">
                    <option value="atomic" ${node.type === 'atomic' ? 'selected' : ''}>原子状态</option>
                    <option value="compound" ${node.type === 'compound' ? 'selected' : ''}>复合状态</option>
                    <option value="flow" ${node.type === 'flow' ? 'selected' : ''}>流程 (可编辑)</option>
                </select>
            </div>
            <div class="form-group">
                <label>图标</label>
                <input type="text" value="${node.icon || ''}" 
                    onchange="UIDevStudio.updateMode('icon', this.value)">
            </div>
        `;
        
        if (node.type === 'compound') {
            html += `
                <div class="form-group">
                    <label>初始子状态</label>
                    <select onchange="UIDevStudio.updateMode('initial', this.value)">
                        <option value="">-- 选择 --</option>
                        ${Object.keys(node.children || {}).map(c => 
                            `<option value="${c}" ${node.initial === c ? 'selected' : ''}>${c}</option>`
                        ).join('')}
                    </select>
                </div>
            `;
        }
        
        if (node.type === 'flow') {
            html += `
                <div class="form-section">
                    <div class="form-section-title">🔄 流程编辑</div>
                    <button class="studio-btn" onclick="UIDevStudio.editFlow('${this.currentMode}')">
                        打开流程编辑器 →
                    </button>
                </div>
            `;
        }
        
        container.innerHTML = html;
    },
    
    getModeByPath(path) {
        const parts = path.split('.');
        let current = this.modeTree;
        for (const part of parts) {
            if (current[part]) {
                current = current[part];
            } else if (current.children?.[part]) {
                current = current.children[part];
            } else {
                return null;
            }
        }
        return current;
    },
    
    updateMode(field, value) {
        if (!this.currentMode) return;
        const node = this.getModeByPath(this.currentMode);
        if (node) {
            node[field] = value;
            this.markModified();
            this.renderModeTree();
        }
    },
    
    addMode() {
        const nodeId = prompt('输入模式ID (如 NEW_MODE):');
        if (!nodeId) return;
        
        const type = prompt('类型 (atomic/compound/flow):', 'atomic');
        
        if (this.currentMode) {
            // 添加为当前模式的子节点
            const parent = this.getModeByPath(this.currentMode);
            if (parent && parent.type === 'compound') {
                if (!parent.children) parent.children = {};
                parent.children[nodeId] = { label: nodeId, type: type || 'atomic', icon: '📄' };
            }
        } else {
            // 添加为顶层
            this.modeTree[nodeId] = { label: nodeId, type: type || 'atomic', icon: '📄' };
        }
        
        this.markModified();
        this.renderModeTree();
    },
    
    editFlow(modePath) {
        this.currentFlow = modePath;
        this.switchTab('flow');
    },

    // ==================== 流程编辑 ====================
    initFlowCanvas() {
        this.flowCanvas = document.getElementById('flow-canvas');
        if (!this.flowCanvas) return;
        
        this.flowCtx = this.flowCanvas.getContext('2d');
        
        // 绑定事件
        this.flowCanvas.addEventListener('mousedown', (e) => this.onFlowMouseDown(e));
        this.flowCanvas.addEventListener('mousemove', (e) => this.onFlowMouseMove(e));
        this.flowCanvas.addEventListener('mouseup', (e) => this.onFlowMouseUp(e));
        this.flowCanvas.addEventListener('dblclick', (e) => this.onFlowDblClick(e));
        this.flowCanvas.addEventListener('wheel', (e) => this.onFlowWheel(e));
        
        // 调整大小
        this.resizeFlowCanvas();
        window.addEventListener('resize', () => this.resizeFlowCanvas());
    },
    
    resizeFlowCanvas() {
        if (!this.flowCanvas) return;
        const container = this.flowCanvas.parentElement;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.flowCanvas.width = rect.width * dpr;
        this.flowCanvas.height = rect.height * dpr;
        this.flowCanvas.style.width = rect.width + 'px';
        this.flowCanvas.style.height = rect.height + 'px';
        
        this.flowCtx.scale(dpr, dpr);
        this.renderFlowCanvas();
    },
    
    renderFlowEditor() {
        // 填充流程选择下拉框
        const select = document.getElementById('flow-select');
        if (select) {
            select.innerHTML = '<option value="">-- 选择流程 --</option>';
            this.collectFlowModes(this.modeTree, '', select);
            if (this.currentFlow) {
                select.value = this.currentFlow;
            }
        }
        
        // 渲染事件面板
        this.renderFlowEvents();
        
        // 渲染画布
        this.resizeFlowCanvas();
        this.renderFlowCanvas();
        
        // 渲染状态列表
        this.renderFlowStates();
    },
    
    collectFlowModes(nodes, parentPath, select) {
        for (const [nodeId, node] of Object.entries(nodes)) {
            const path = parentPath ? `${parentPath}.${nodeId}` : nodeId;
            if (node.type === 'flow') {
                select.innerHTML += `<option value="${path}">${path} - ${node.label}</option>`;
            }
            if (node.children) {
                this.collectFlowModes(node.children, path, select);
            }
        }
    },
    
    loadFlow(flowPath) {
        this.currentFlow = flowPath;
        this.currentFlowState = null;
        
        // 初始化流程数据
        if (flowPath && !this.flows[flowPath]) {
            this.flows[flowPath] = {
                states: {
                    IDLE: { label: '待机', display: {} }
                },
                transitions: [],
                initialState: 'IDLE'
            };
            this.flowNodePositions[flowPath] = {
                IDLE: { x: 200, y: 150 }
            };
        }
        
        this.renderFlowStates();
        this.renderFlowCanvas();
    },
    
    renderFlowStates() {
        const container = document.getElementById('flow-states');
        if (!container) return;
        
        const flow = this.flows[this.currentFlow];
        if (!flow) {
            container.innerHTML = '<div class="empty-hint">选择流程</div>';
            return;
        }
        
        let html = '';
        for (const [stateId, state] of Object.entries(flow.states || {})) {
            const isActive = this.currentFlowState === stateId;
            const isInitial = flow.initialState === stateId;
            html += `
                <div class="flow-state-item ${isActive ? 'active' : ''}" onclick="UIDevStudio.selectFlowState('${stateId}')">
                    ${isInitial ? '⭐ ' : ''}${stateId}
                    <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${state.label || ''}</span>
                </div>
            `;
        }
        container.innerHTML = html || '<div class="empty-hint">暂无状态</div>';
    },
    
    renderFlowEvents() {
        const container = document.getElementById('flow-events');
        if (!container) return;
        
        let html = '';
        for (const [eventId, event] of Object.entries(this.events)) {
            const cat = this.eventCategories[event.category] || {};
            html += `
                <div class="flow-event-item" style="border-left-color:${cat.color || '#666'}" 
                     draggable="true" data-event="${eventId}">
                    ${event.label || eventId}
                </div>
            `;
        }
        container.innerHTML = html || '<div class="empty-hint">暂无事件</div>';
    },
    
    selectFlowState(stateId) {
        this.currentFlowState = stateId;
        this.renderFlowStates();
        this.renderFlowProperty();
        this.renderFlowCanvas();
        this.updateFlowLcdPreview();
    },
    
    renderFlowProperty() {
        const container = document.getElementById('flow-property-content');
        if (!container) return;
        
        const flow = this.flows[this.currentFlow];
        if (!flow || !this.currentFlowState) {
            container.innerHTML = '<div class="empty-hint">选择状态或转移</div>';
            return;
        }
        
        const state = flow.states[this.currentFlowState];
        if (!state) return;
        
        const components = this.lcdProject?.components || {};
        
        let html = `
            <div class="form-group">
                <label>状态ID</label>
                <input type="text" value="${this.currentFlowState}" disabled>
            </div>
            <div class="form-group">
                <label>名称</label>
                <input type="text" value="${state.label || ''}" 
                    onchange="UIDevStudio.updateFlowState('label', this.value)">
            </div>
            <div class="form-group">
                <label>进入动作</label>
                <select onchange="UIDevStudio.updateFlowState('onEnter', this.value ? [this.value] : [])">
                    <option value="">无</option>
                    ${Object.keys(this.actions).map(a => 
                        `<option value="${a}" ${(state.onEnter || [])[0] === a ? 'selected' : ''}>${a}</option>`
                    ).join('')}
                </select>
            </div>
            <div style="font-size:11px;font-weight:600;margin:12px 0 8px;color:var(--accent-color);">LCD显示</div>
        `;
        
        const display = state.display || {};
        for (const [compId, comp] of Object.entries(components)) {
            html += this.renderFlowDisplayEditor(compId, comp, display[compId]);
        }
        
        container.innerHTML = html;
    },
    
    renderFlowDisplayEditor(compId, comp, value) {
        let inputHtml = '';
        
        switch (comp.type) {
            case 'digit_group':
                inputHtml = `<input type="text" value="${value !== undefined ? value : ''}" placeholder="-----"
                    style="padding:4px 6px;font-size:11px;"
                    onchange="UIDevStudio.updateFlowDisplay('${compId}', this.value)">`;
                break;
            case 'icon':
                inputHtml = `<select style="padding:4px 6px;font-size:11px;" onchange="UIDevStudio.updateFlowDisplay('${compId}', this.value === 'true')">
                    <option value="" ${value === undefined ? 'selected' : ''}>-</option>
                    <option value="true" ${value === true ? 'selected' : ''}>亮</option>
                    <option value="false" ${value === false ? 'selected' : ''}>灭</option>
                </select>`;
                break;
            case 'select_one':
                inputHtml = `<select style="padding:4px 6px;font-size:11px;" onchange="UIDevStudio.updateFlowDisplay('${compId}', this.value || undefined)">
                    <option value="">-</option>`;
                for (const [optId, opt] of Object.entries(comp.options || {})) {
                    inputHtml += `<option value="${optId}" ${value === optId ? 'selected' : ''}>${opt.label || optId}</option>`;
                }
                inputHtml += '</select>';
                break;
            default:
                inputHtml = `<input type="text" value="${value || ''}" style="padding:4px 6px;font-size:11px;"
                    onchange="UIDevStudio.updateFlowDisplay('${compId}', this.value)">`;
        }
        
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:10px;min-width:50px;">${comp.label || compId}</span>
            ${inputHtml}
        </div>`;
    },
    
    updateFlowState(field, value) {
        const flow = this.flows[this.currentFlow];
        if (!flow || !this.currentFlowState) return;
        
        flow.states[this.currentFlowState][field] = value;
        this.markModified();
        this.renderFlowStates();
    },
    
    updateFlowDisplay(compId, value) {
        const flow = this.flows[this.currentFlow];
        if (!flow || !this.currentFlowState) return;
        
        if (!flow.states[this.currentFlowState].display) {
            flow.states[this.currentFlowState].display = {};
        }
        
        if (value === undefined || value === '') {
            delete flow.states[this.currentFlowState].display[compId];
        } else {
            flow.states[this.currentFlowState].display[compId] = value;
        }
        
        this.markModified();
        this.updateFlowLcdPreview();
    },
    
    setFlowTool(tool) {
        this.flowTool = tool;
        document.querySelectorAll('.flow-tools .tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    },

    // ==================== 流程画布渲染 ====================
    renderFlowCanvas() {
        if (!this.flowCtx) return;
        
        const dpr = window.devicePixelRatio || 1;
        const width = this.flowCanvas.width / dpr;
        const height = this.flowCanvas.height / dpr;
        
        const ctx = this.flowCtx;
        
        // 清空
        ctx.clearRect(0, 0, width, height);
        
        // 背景网格
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        const gridSize = 20;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        
        const flow = this.flows[this.currentFlow];
        if (!flow) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('选择或创建流程', width / 2, height / 2);
            return;
        }
        
        const positions = this.flowNodePositions[this.currentFlow] || {};
        
        // 绘制转移线
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2;
        for (const trans of (flow.transitions || [])) {
            const fromPos = positions[trans.from];
            const toPos = positions[trans.to];
            if (!fromPos || !toPos) continue;
            
            const from = { x: fromPos.x + 70, y: fromPos.y + 30 };
            const to = { x: toPos.x + 70, y: toPos.y + 30 };
            
            // 获取事件颜色
            const evt = this.events[trans.event] || {};
            const cat = this.eventCategories[evt.category] || {};
            ctx.strokeStyle = cat.color || '#64748b';
            
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            
            // 箭头
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            ctx.fillStyle = cat.color || '#64748b';
            ctx.beginPath();
            ctx.moveTo(to.x, to.y);
            ctx.lineTo(to.x - 10 * Math.cos(angle - 0.5), to.y - 10 * Math.sin(angle - 0.5));
            ctx.lineTo(to.x - 10 * Math.cos(angle + 0.5), to.y - 10 * Math.sin(angle + 0.5));
            ctx.closePath();
            ctx.fill();
            
            // 事件标签
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(midX - 30, midY - 10, 60, 16);
            ctx.fillStyle = cat.color || '#64748b';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(evt.label || trans.event, midX, midY + 3);
        }
        
        // 绘制状态节点
        for (const [stateId, state] of Object.entries(flow.states || {})) {
            const pos = positions[stateId] || { x: 100, y: 100 };
            const isSelected = this.currentFlowState === stateId;
            const isInitial = flow.initialState === stateId;
            
            // 节点背景
            ctx.fillStyle = '#1e293b';
            ctx.strokeStyle = isSelected ? '#22c55e' : '#475569';
            ctx.lineWidth = isSelected ? 2 : 1;
            
            this.roundRect(ctx, pos.x, pos.y, 140, 60, 8);
            ctx.fill();
            ctx.stroke();
            
            // 初始状态标记
            if (isInitial) {
                ctx.fillStyle = '#22c55e';
                ctx.beginPath();
                ctx.arc(pos.x - 10, pos.y + 30, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // 状态ID
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(stateId, pos.x + 70, pos.y + 25);
            
            // 状态标签
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.fillText(state.label || '', pos.x + 70, pos.y + 42);
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
    
    // 流程画布事件
    flowDragging: false,
    flowDragState: null,
    flowDragOffset: { x: 0, y: 0 },
    
    onFlowMouseDown(e) {
        const rect = this.flowCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 检测点击的状态
        const flow = this.flows[this.currentFlow];
        const positions = this.flowNodePositions[this.currentFlow] || {};
        
        if (flow) {
            for (const [stateId, state] of Object.entries(flow.states || {})) {
                const pos = positions[stateId];
                if (!pos) continue;
                
                if (x >= pos.x && x <= pos.x + 140 && y >= pos.y && y <= pos.y + 60) {
                    this.selectFlowState(stateId);
                    
                    if (this.flowTool === 'pointer') {
                        this.flowDragging = true;
                        this.flowDragState = stateId;
                        this.flowDragOffset = { x: x - pos.x, y: y - pos.y };
                    }
                    return;
                }
            }
        }
        
        // 点击空白处
        this.currentFlowState = null;
        this.renderFlowProperty();
    },
    
    onFlowMouseMove(e) {
        if (!this.flowDragging || !this.flowDragState) return;
        
        const rect = this.flowCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left - this.flowDragOffset.x;
        const y = e.clientY - rect.top - this.flowDragOffset.y;
        
        if (!this.flowNodePositions[this.currentFlow]) {
            this.flowNodePositions[this.currentFlow] = {};
        }
        this.flowNodePositions[this.currentFlow][this.flowDragState] = { x, y };
        
        this.renderFlowCanvas();
    },
    
    onFlowMouseUp(e) {
        this.flowDragging = false;
        this.flowDragState = null;
    },
    
    onFlowDblClick(e) {
        const rect = this.flowCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // 双击空白处添加状态
        const stateId = prompt('输入状态ID:');
        if (!stateId) return;
        
        const flow = this.flows[this.currentFlow];
        if (!flow) return;
        
        flow.states[stateId.toUpperCase()] = {
            label: stateId,
            display: {}
        };
        
        if (!this.flowNodePositions[this.currentFlow]) {
            this.flowNodePositions[this.currentFlow] = {};
        }
        this.flowNodePositions[this.currentFlow][stateId.toUpperCase()] = { x: x - 70, y: y - 30 };
        
        this.markModified();
        this.renderFlowStates();
        this.renderFlowCanvas();
    },
    
    onFlowWheel(e) {
        e.preventDefault();
        // 可以添加缩放功能
    },
    
    updateFlowLcdPreview() {
        const canvas = document.getElementById('flow-lcd-canvas');
        if (!canvas || !this.lcdProject) return;
        
        const ctx = canvas.getContext('2d');
        canvas.width = this.lcdProject.imageWidth || 200;
        canvas.height = this.lcdProject.imageHeight || 100;
        
        ctx.fillStyle = '#d0d0c8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const flow = this.flows[this.currentFlow];
        if (!flow || !this.currentFlowState) return;
        
        const state = flow.states[this.currentFlowState];
        if (!state?.display) return;
        
        // 使用 SME2 的渲染逻辑
        if (window.SME2) {
            SME2.lcdProject = this.lcdProject;
            const litElements = SME2.collectLitElements(state.display);
            ctx.fillStyle = '#1a1a1a';
            for (const elemName of litElements) {
                SME2.renderLcdElement(ctx, elemName);
            }
        }
    },

    // ==================== 模拟运行 ====================
    renderSimulator() {
        // 渲染事件按钮
        const container = document.getElementById('sim-event-buttons');
        if (container) {
            let html = '';
            for (const [eventId, event] of Object.entries(this.events)) {
                const cat = this.eventCategories[event.category] || {};
                html += `<button class="sim-event-btn" style="border-left-color:${cat.color}" 
                    onclick="UIDevStudio.simTriggerEvent('${eventId}')">${event.label || eventId}</button>`;
            }
            container.innerHTML = html;
        }
        
        // 初始化模拟器
        this.simReset();
    },
    
    simReset() {
        // 找到初始状态
        const initialMode = this.findInitialState(this.modeTree);
        this.simState = initialMode || 'OFF';
        this.simLog = [];
        
        this.simAddLog('system', `模拟器重置，初始状态: ${this.simState}`);
        this.simUpdateDisplay();
    },
    
    findInitialState(nodes, path = '') {
        for (const [nodeId, node] of Object.entries(nodes)) {
            const currentPath = path ? `${path}.${nodeId}` : nodeId;
            if (node.type === 'atomic' || node.type === 'flow') {
                return currentPath;
            }
            if (node.children && node.initial) {
                return this.findInitialState({ [node.initial]: node.children[node.initial] }, currentPath);
            }
        }
        return null;
    },
    
    simTriggerEvent(eventId) {
        const event = this.events[eventId];
        this.simAddLog('event', `触发事件: ${event?.label || eventId}`);
        
        // 查找当前流程中的转移
        const flowPath = this.getFlowPathForState(this.simState);
        const flow = this.flows[flowPath];
        
        if (flow) {
            const stateName = this.simState.split('.').pop();
            const transition = flow.transitions?.find(t => t.from === stateName && t.event === eventId);
            
            if (transition) {
                this.simAddLog('transition', `状态转移: ${transition.from} → ${transition.to}`);
                
                // 执行动作
                if (transition.actions) {
                    for (const actionId of transition.actions) {
                        this.simAddLog('action', `执行动作: ${actionId}`);
                    }
                }
                
                // 更新状态
                const newStatePath = flowPath + '.' + transition.to;
                this.simState = newStatePath;
                
                // 执行进入动作
                const newState = flow.states[transition.to];
                if (newState?.onEnter) {
                    for (const actionId of newState.onEnter) {
                        this.simAddLog('action', `进入动作: ${actionId}`);
                    }
                }
                
                this.simUpdateDisplay();
            } else {
                this.simAddLog('system', `当前状态无此事件的转移`);
            }
        }
    },
    
    getFlowPathForState(statePath) {
        const parts = statePath.split('.');
        parts.pop(); // 移除最后的状态名
        return parts.join('.');
    },
    
    simAddLog(type, message) {
        this.simLog.push({ type, message, time: new Date().toLocaleTimeString() });
        
        const container = document.getElementById('sim-log');
        if (container) {
            container.innerHTML = this.simLog.map(log => 
                `<div class="sim-log-entry ${log.type}">[${log.time}] ${log.message}</div>`
            ).join('');
            container.scrollTop = container.scrollHeight;
        }
    },
    
    simUpdateDisplay() {
        // 更新当前状态显示
        document.getElementById('sim-current-state').textContent = this.simState;
        
        // 更新 LCD 显示
        const canvas = document.getElementById('sim-lcd-canvas');
        if (canvas && this.lcdProject) {
            const ctx = canvas.getContext('2d');
            canvas.width = this.lcdProject.imageWidth || 300;
            canvas.height = this.lcdProject.imageHeight || 150;
            
            ctx.fillStyle = '#d0d0c8';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // 获取当前状态的显示配置
            const flowPath = this.getFlowPathForState(this.simState);
            const flow = this.flows[flowPath];
            const stateName = this.simState.split('.').pop();
            const state = flow?.states?.[stateName];
            
            if (state?.display && window.SME2) {
                SME2.lcdProject = this.lcdProject;
                const litElements = SME2.collectLitElements(state.display);
                ctx.fillStyle = '#1a1a1a';
                for (const elemName of litElements) {
                    SME2.renderLcdElement(ctx, elemName);
                }
            }
        }
        
        // 更新流程图高亮
        this.renderSimFlowCanvas();
    },
    
    renderSimFlowCanvas() {
        const canvas = document.getElementById('sim-flow-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 简化的流程图显示
        const flowPath = this.getFlowPathForState(this.simState);
        const flow = this.flows[flowPath];
        if (!flow) return;
        
        const states = Object.keys(flow.states || {});
        const currentStateName = this.simState.split('.').pop();
        
        const nodeW = 80;
        const nodeH = 40;
        const gap = 30;
        const startX = 20;
        const startY = (canvas.height - nodeH) / 2;
        
        states.forEach((stateId, i) => {
            const x = startX + i * (nodeW + gap);
            const y = startY;
            const isCurrent = stateId === currentStateName;
            
            ctx.fillStyle = isCurrent ? '#22c55e' : '#1e293b';
            ctx.strokeStyle = isCurrent ? '#22c55e' : '#475569';
            ctx.lineWidth = 1;
            
            this.roundRect(ctx, x, y, nodeW, nodeH, 4);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = isCurrent ? '#1a1a1a' : '#f8fafc';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(stateId, x + nodeW / 2, y + nodeH / 2 + 3);
            
            // 箭头
            if (i < states.length - 1) {
                ctx.strokeStyle = '#475569';
                ctx.beginPath();
                ctx.moveTo(x + nodeW, y + nodeH / 2);
                ctx.lineTo(x + nodeW + gap, y + nodeH / 2);
                ctx.stroke();
            }
        });
    },
    
    simStep() {
        this.simAddLog('system', '单步执行 (待实现)');
    },

    // ==================== 保存与代码生成 ====================
    markModified() {
        this.modified = true;
        document.getElementById('studio-modified').textContent = '● 已修改';
        document.getElementById('studio-modified').style.color = '#f59e0b';
    },
    
    clearModified() {
        this.modified = false;
        document.getElementById('studio-modified').textContent = '';
    },
    
    async save() {
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (!deviceId) {
            alert('请先选择设备');
            return;
        }
        
        const data = {
            version: '2.0',
            device: deviceId,
            saveTime: new Date().toISOString(),
            eventCategories: this.eventCategories,
            events: this.events,
            actions: this.actions,
            modeTree: this.modeTree,
            flows: this.flows,
            flowNodePositions: this.flowNodePositions
        };
        
        try {
            await DeviceConfigManager.saveConfig('ui', data, deviceId);
            alert('保存成功!');
            this.clearModified();
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    },
    
    generateCode() {
        if (!this.modeTree || Object.keys(this.flows).length === 0) {
            alert('请先创建模式树和流程');
            return;
        }
        
        let code = this.generateCCode();
        
        // 下载
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ui_fsm.c';
        a.click();
        URL.revokeObjectURL(url);
        
        alert('代码已生成并下载!');
    },
    
    generateCCode() {
        const deviceId = DeviceConfigManager?.getCurrentDevice() || 'unknown';
        
        let code = `/**
 * @file ui_fsm.c
 * @brief UI状态机 - 自动生成代码
 * @device ${deviceId}
 * @date ${new Date().toISOString().split('T')[0]}
 * 
 * 本文件由 UI 开发工作室自动生成
 */

#include "ui_fsm.h"
#include "lcd_elements.h"

`;
        
        // 事件枚举
        code += `/* ==================== 事件定义 ==================== */\n`;
        code += `typedef enum {\n`;
        Object.keys(this.events).forEach((eventId, i, arr) => {
            code += `    EVT_${eventId}${i < arr.length - 1 ? ',' : ''}\n`;
        });
        code += `} ui_event_t;\n\n`;
        
        // 收集所有状态
        const allStates = [];
        this.collectAllStates(this.modeTree, '', allStates);
        
        code += `/* ==================== 状态定义 ==================== */\n`;
        code += `typedef enum {\n`;
        allStates.forEach((s, i) => {
            code += `    STATE_${s.replace(/\./g, '_')}${i < allStates.length - 1 ? ',' : ''}\n`;
        });
        code += `} ui_state_t;\n\n`;
        
        code += `static ui_state_t g_current_state = STATE_${allStates[0]?.replace(/\./g, '_') || 'OFF'};\n\n`;
        
        // 状态进入函数
        code += `/* ==================== 状态进入处理 ==================== */\n`;
        code += `static void state_enter(ui_state_t state) {\n`;
        code += `    switch(state) {\n`;
        
        for (const [flowPath, flow] of Object.entries(this.flows)) {
            for (const [stateId, state] of Object.entries(flow.states || {})) {
                const fullState = `${flowPath}.${stateId}`.replace(/\./g, '_');
                code += `        case STATE_${fullState}:\n`;
                
                // 生成显示代码
                if (state.display) {
                    for (const [compId, value] of Object.entries(state.display)) {
                        if (value !== undefined) {
                            code += `            lcd_${compId}_set(${JSON.stringify(value)});\n`;
                        }
                    }
                }
                
                code += `            break;\n`;
            }
        }
        
        code += `        default: break;\n`;
        code += `    }\n`;
        code += `}\n\n`;
        
        // 事件处理函数
        code += `/* ==================== 事件处理 ==================== */\n`;
        code += `void ui_handle_event(ui_event_t evt, void* data) {\n`;
        code += `    (void)data;\n`;
        code += `    switch(g_current_state) {\n`;
        
        for (const [flowPath, flow] of Object.entries(this.flows)) {
            for (const [stateId, state] of Object.entries(flow.states || {})) {
                const fullState = `${flowPath}.${stateId}`.replace(/\./g, '_');
                const transitions = (flow.transitions || []).filter(t => t.from === stateId);
                
                if (transitions.length > 0) {
                    code += `        case STATE_${fullState}:\n`;
                    code += `            switch(evt) {\n`;
                    
                    for (const trans of transitions) {
                        const targetState = `${flowPath}.${trans.to}`.replace(/\./g, '_');
                        code += `                case EVT_${trans.event}:\n`;
                        code += `                    g_current_state = STATE_${targetState};\n`;
                        code += `                    state_enter(g_current_state);\n`;
                        code += `                    break;\n`;
                    }
                    
                    code += `                default: break;\n`;
                    code += `            }\n`;
                    code += `            break;\n`;
                }
            }
        }
        
        code += `        default: break;\n`;
        code += `    }\n`;
        code += `}\n\n`;
        
        // 初始化函数
        code += `/* ==================== 初始化 ==================== */\n`;
        code += `void ui_fsm_init(void) {\n`;
        code += `    g_current_state = STATE_${allStates[0]?.replace(/\./g, '_') || 'OFF'};\n`;
        code += `    state_enter(g_current_state);\n`;
        code += `}\n`;
        
        return code;
    },
    
    collectAllStates(nodes, parentPath, result) {
        for (const [nodeId, node] of Object.entries(nodes)) {
            const path = parentPath ? `${parentPath}.${nodeId}` : nodeId;
            
            if (node.type === 'atomic') {
                result.push(path);
            } else if (node.type === 'flow') {
                const flow = this.flows[path];
                if (flow?.states) {
                    for (const stateId of Object.keys(flow.states)) {
                        result.push(`${path}.${stateId}`);
                    }
                }
            }
            
            if (node.children) {
                this.collectAllStates(node.children, path, result);
            }
        }
    },
    
    // 加载示例
    loadExample() {
        if (this.modified) {
            if (!confirm('当前有未保存的修改，确定要加载示例吗？')) {
                return;
            }
        }
        
        // 加载默认数据（包含完整示例）
        this.loadDefaults();
        
        // 自动选择单次测距流程
        this.currentFlow = 'ON.MEASURE_MODE.SINGLE';
        
        // 刷新所有界面
        this.renderCurrentTab();
        
        // 提示
        alert(`✅ 示例已加载！

包含内容：
📋 事件库: 21个事件（按键/硬件/测量/通信/系统）
⚡ 动作库: 8个动作（开关激光、显示结果、错误处理等）
📁 模式树: 完整的产品模式结构
🔄 流程: 
   - 单次测距流程（5个状态，12个转移）
   - 连续测距流程（3个状态，5个转移）

建议操作：
1. 点击"事件库"查看所有事件定义
2. 点击"动作库"查看动作如何绑定UI变化
3. 点击"模式树"查看产品模式层级
4. 点击"流程编辑"查看单次测距的状态机
5. 点击"模拟运行"测试流程是否正确`);
        
        this.markModified();
    },
    
    showHelp() {
        alert(`UI 开发工作室 使用说明

📋 事件库
定义系统中所有可能的输入事件（按键、硬件、测量等）

⚡ 动作库  
定义可复用的动作，包含 UI 变化、硬件操作、定时器等

📁 模式树
定义产品的模式层级结构（关机→运行→测量模式→单次测距...）

🔄 流程编辑
在画布上可视化编辑每个流程的状态和转移
- 双击画布添加状态
- 拖拽状态移动位置
- 点击状态编辑 LCD 显示

▶️ 模拟运行
模拟运行状态机，验证流程是否正确

⚙️ 生成代码
生成可直接编译的 C 代码

💡 快速开始
点击"📦 加载示例"按钮加载完整的测距仪示例`);
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('studio-device-selector')) {
        UIDevStudio.init();
    }
});
