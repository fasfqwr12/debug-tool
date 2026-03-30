/**
 * UI自动化测试工作台 - 整合全部工具
 * Tab: 段码映射 | LCD模拟 | 动作库 | 用例编辑 | 执行测试 | 测试报告
 * 
 * 特性:
 * - 记忆上次打开的Tab
 * - 记忆各Tab的选中状态
 * - 统一设备选择器
 */
window.UITestWorkbench = {
    // 当前状态
    currentTab: 'cases',
    deviceId: null,
    modified: false,
    
    // 数据
    actions: {},
    expects: {},
    suite: null,
    testReport: null,
    
    // 记忆状态 (localStorage)
    memory: {
        lastTab: 'cases',
        selectedAction: null,
        selectedCase: null,
        selectedGroup: null,
    },
    
    // Tab 初始化状态
    tabInited: {
        segment: false,
        lcd: false,
        actions: false,
        cases: false,
        execute: false,
        report: false,
    },
    
    // ==================== 初始化 ====================
    async init() {
        console.log('[UITestWorkbench] 初始化...');
        
        // 加载记忆
        this.loadMemory();
        
        // 初始化设备选择器
        await this.initDeviceManager();
        
        // 更新串口状态
        this.updateSerialStatus();
        if (window.DeviceHub) {
            DeviceHub.onStatusChange(() => this.updateSerialStatus());
        }
        
        // 切换到记忆的Tab
        this.switchTab(this.memory.lastTab || 'cases');
    },
    
    destroy() {
        console.log('[UITestWorkbench] 销毁');
        this.saveMemory();
    },
    
    // ==================== 设备管理 ====================
    async initDeviceManager() {
        if (typeof DeviceConfigManager === 'undefined') {
            console.warn('[UITestWorkbench] DeviceConfigManager 不可用');
            return;
        }
        
        await DeviceConfigManager.init();
        
        // 创建设备选择器
        DeviceConfigManager.createSelector('wb-device-selector', async (deviceId) => {
            await this.onDeviceChanged(deviceId);
        });
        
        // 订阅设备变化
        DeviceConfigManager.subscribe('device-changed', (e) => this.onDeviceChanged(e.newDevice));
        
        // 加载当前设备
        this.deviceId = DeviceConfigManager.getCurrentDevice();
        if (this.deviceId) {
            document.getElementById('wb-device-name').textContent = '设备: ' + this.deviceId;
        }
    },

    async onDeviceChanged(deviceId) {
        console.log('[UITestWorkbench] 切换设备:', deviceId);
        this.deviceId = deviceId;
        document.getElementById('wb-device-name').textContent = '设备: ' + deviceId;
        
        // 重置Tab初始化状态，下次切换时重新加载
        this.tabInited = { segment: false, lcd: false, actions: false, cases: false, execute: false, report: false };
        
        // 重新初始化当前Tab
        await this.initCurrentTab();
    },
    
    updateSerialStatus() {
        const el = document.getElementById('wb-serial-status');
        if (!el) return;
        
        if (window.DeviceHub && DeviceHub.isSerialConnected()) {
            el.textContent = '🟢 已连接';
            el.classList.add('connected');
        } else {
            el.textContent = '⚪ 未连接';
            el.classList.remove('connected');
        }
    },
    
    // ==================== Tab 切换 ====================
    switchTab(tab) {
        this.currentTab = tab;
        this.memory.lastTab = tab;
        this.saveMemory();
        
        // 更新Tab按钮状态
        document.querySelectorAll('.wb-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        // 显示对应面板
        document.querySelectorAll('.wb-panel').forEach(panel => {
            panel.style.display = 'none';
        });
        const panel = document.getElementById(`panel-${tab}`);
        if (panel) panel.style.display = 'block';
        
        // 初始化Tab内容
        this.initCurrentTab();
    },
    
    async initCurrentTab() {
        const tab = this.currentTab;
        
        // 如果已初始化，跳过
        if (this.tabInited[tab]) return;
        
        this.setStatus(`加载 ${tab}...`);
        
        switch (tab) {
            case 'segment':
                await this.initSegmentTab();
                break;
            case 'lcd':
                await this.initLcdTab();
                break;
            case 'actions':
                await this.initActionsTab();
                break;
            case 'cases':
                await this.initCasesTab();
                break;
            case 'execute':
                await this.initExecuteTab();
                break;
            case 'report':
                await this.initReportTab();
                break;
        }
        
        this.tabInited[tab] = true;
        this.setStatus('就绪');
    },
    
    // ==================== Tab 1: 段码映射 ====================
    async initSegmentTab() {
        const container = document.getElementById('embed-segment');
        if (!container) return;
        
        // 由于 iframe 在 pywebview 中无法访问 API，改为提供跳转链接
        container.innerHTML = `
            <div class="embed-placeholder">
                <div class="placeholder-icon">🎨</div>
                <h3>段码映射编辑器</h3>
                <p>绑定 LCD 像素到 SEG:COM，建立显示映射关系</p>
                <p style="color:var(--text-muted);font-size:12px;margin-top:8px;">
                    当前设备: <strong style="color:var(--accent-color)">${this.deviceId || '未选择'}</strong>
                </p>
                <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
                    <button class="wb-btn primary" onclick="switchPage('lcd_segment_editor')">
                        🔗 打开段码编辑器
                    </button>
                </div>
                <p style="color:var(--text-muted);font-size:11px;margin-top:16px;">
                    💡 段码编辑器需要在独立页面中运行以获得完整功能
                </p>
            </div>
        `;
    },
    
    // ==================== Tab 2: LCD模拟 ====================
    async initLcdTab() {
        const container = document.getElementById('embed-lcd');
        if (!container) return;
        
        // 由于 iframe 在 pywebview 中无法访问 API，改为提供跳转链接
        container.innerHTML = `
            <div class="embed-placeholder">
                <div class="placeholder-icon">📺</div>
                <h3>LCD 模拟器</h3>
                <p>实时显示 LCD 状态，验证段码映射是否正确</p>
                <p style="color:var(--text-muted);font-size:12px;margin-top:8px;">
                    当前设备: <strong style="color:var(--accent-color)">${this.deviceId || '未选择'}</strong>
                </p>
                <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
                    <button class="wb-btn primary" onclick="switchPage('lcd_simulator')">
                        🔗 打开 LCD 模拟器
                    </button>
                </div>
                <p style="color:var(--text-muted);font-size:11px;margin-top:16px;">
                    💡 LCD 模拟器需要在独立页面中运行以获得完整功能
                </p>
            </div>
        `;
    },

    // ==================== Tab 3: 动作库 ====================
    async initActionsTab() {
        // 加载动作库数据
        try {
            const data = await DeviceConfigManager.loadActions(this.deviceId);
            console.log('[UITestWorkbench] 动作库原始数据:', data);
            if (data) {
                this.actions = data.actions || {};
                this.expects = data.expects || {};
                console.log('[UITestWorkbench] 解析后 actions:', Object.keys(this.actions).length, '个');
            }
            // 显示加载的文件路径
            const pathInfo = DeviceConfigManager.getConfigPath('actions', this.deviceId);
            if (pathInfo) {
                this.showConfigPath('actions', pathInfo);
            }
        } catch (e) {
            console.warn('加载动作库失败:', e);
            this.actions = {};
            this.expects = {};
        }
        
        // 更新badge
        const count = Object.keys(this.actions).length;
        document.getElementById('badge-actions').textContent = count;
        
        // 渲染分类和列表
        this.renderActionCategories();
        this.renderExpectList();
    },
    
    renderActionCategories() {
        const container = document.getElementById('action-categories');
        if (!container) return;
        
        console.log('[UITestWorkbench] renderActionCategories, this.actions:', this.actions);
        
        // 按category分组
        const categories = {};
        for (const [id, action] of Object.entries(this.actions)) {
            const cat = action.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ id, ...action });
        }
        
        console.log('[UITestWorkbench] 分类结果:', categories);
        
        let html = '';
        for (const [cat, items] of Object.entries(categories)) {
            html += `<div class="list-item" onclick="UITestWorkbench.selectActionCategory('${cat}')">
                <div class="item-name">${cat}</div>
                <div class="item-desc">${items.length} 个动作</div>
            </div>`;
        }
        container.innerHTML = html || '<div class="empty-hint">暂无动作</div>';
    },
    
    selectActionCategory(cat) {
        console.log('[UITestWorkbench] selectActionCategory:', cat);
        this.memory.selectedActionCategory = cat;
        this.renderActionList(cat);
    },
    
    renderActionList(category) {
        const container = document.getElementById('action-list');
        const title = document.getElementById('action-list-title');
        if (!container) return;
        
        console.log('[UITestWorkbench] renderActionList, category:', category);
        console.log('[UITestWorkbench] this.actions 当前值:', this.actions);
        
        title.textContent = category || '动作列表';
        
        const items = Object.entries(this.actions).filter(([id, a]) => (a.category || '其他') === category);
        console.log('[UITestWorkbench] 过滤后的动作:', items.length, '个', items);
        
        let html = '';
        for (const [id, action] of items) {
            const isActive = this.memory.selectedAction === id;
            html += `<div class="list-item ${isActive ? 'active' : ''}" onclick="UITestWorkbench.selectAction('${id}')">
                <div class="item-name">${id}</div>
                <div class="item-desc">${action.desc || ''}</div>
            </div>`;
        }
        console.log('[UITestWorkbench] 设置 action-list HTML, 长度:', html.length);
        container.innerHTML = html || '<div class="empty-hint">该分类暂无动作</div>';
        console.log('[UITestWorkbench] action-list 容器内容:', container.innerHTML.substring(0, 200));
    },
    
    selectAction(id) {
        this.memory.selectedAction = id;
        this.renderActionList(this.memory.selectedActionCategory);
        this.renderActionEditor(id);
    },
    
    renderActionEditor(id) {
        const container = document.getElementById('action-editor');
        if (!container) return;
        
        const action = this.actions[id];
        if (!action) {
            container.innerHTML = '<div class="empty-hint">选择动作编辑</div>';
            return;
        }
        
        let html = `
            <div class="form-group">
                <label>动作ID</label>
                <input type="text" value="${id}" disabled>
            </div>
            <div class="form-group">
                <label>命令</label>
                <input type="text" value="${action.cmd || ''}" onchange="UITestWorkbench.updateAction('${id}', 'cmd', this.value)">
            </div>
            <div class="form-group">
                <label>描述</label>
                <input type="text" value="${action.desc || ''}" onchange="UITestWorkbench.updateAction('${id}', 'desc', this.value)">
            </div>
            <div class="form-group">
                <label>分类</label>
                <input type="text" value="${action.category || ''}" onchange="UITestWorkbench.updateAction('${id}', 'category', this.value)">
            </div>
        `;
        
        if (action.params) {
            html += `<div class="form-group">
                <label>参数</label>
                <textarea rows="3" disabled>${JSON.stringify(action.params, null, 2)}</textarea>
            </div>`;
        }
        
        container.innerHTML = html;
    },
    
    updateAction(id, field, value) {
        if (this.actions[id]) {
            this.actions[id][field] = value;
            this.markModified();
        }
    },
    
    renderExpectList() {
        const container = document.getElementById('expect-list');
        if (!container) return;
        
        // 简化显示期望值列表
        let html = '<div style="font-size:10px;color:var(--text-muted);padding:4px;">期望值定义:</div>';
        for (const [id, exp] of Object.entries(this.expects || {})) {
            html += `<div style="padding:4px 8px;font-size:10px;border-bottom:1px solid var(--border-color);">
                <span style="color:var(--accent-color)">${id}</span>
                <span style="color:var(--text-muted);margin-left:8px;">${exp.desc || ''}</span>
            </div>`;
        }
        container.innerHTML = html;
    },
    
    addAction() {
        const id = prompt('输入动作ID (如 K1短按):');
        if (!id) return;
        
        this.actions[id] = {
            cmd: '',
            desc: '',
            category: this.memory.selectedActionCategory || '其他'
        };
        
        this.markModified();
        this.renderActionCategories();
        this.selectAction(id);
    },
    
    addActionCategory() {
        const cat = prompt('输入分类名称:');
        if (!cat) return;
        
        // 添加一个空动作到新分类
        const id = `new_action_${Date.now()}`;
        this.actions[id] = { cmd: '', desc: '新动作', category: cat };
        
        this.markModified();
        this.renderActionCategories();
        this.selectActionCategory(cat);
    },

    // ==================== Tab 4: 用例编辑 ====================
    async initCasesTab() {
        // 加载动作库（用于快速参考）
        if (Object.keys(this.actions).length === 0) {
            try {
                const data = await DeviceConfigManager.loadActions(this.deviceId);
                if (data) {
                    this.actions = data.actions || {};
                    this.expects = data.expects || {};
                }
            } catch (e) {
                console.warn('加载动作库失败:', e);
            }
        }
        
        // 加载测试套件
        try {
            const content = await DeviceConfigManager.loadTestSuite(this.deviceId);
            console.log('[UITestWorkbench] 加载测试套件, 类型:', typeof content);
            
            if (content) {
                if (typeof content === 'string') {
                    console.log('[UITestWorkbench] 解析JS字符串, 长度:', content.length);
                    this.suite = this.parseJsSuite(content);
                } else if (typeof content === 'object') {
                    // 后端可能已经解析了
                    this.suite = content;
                    console.log('[UITestWorkbench] 直接使用对象');
                }
            }
            
            // 显示加载的文件路径
            const pathInfo = DeviceConfigManager.getConfigPath('tests', this.deviceId);
            if (pathInfo) {
                this.showConfigPath('tests', pathInfo);
            }
            
            console.log('[UITestWorkbench] 套件解析结果:', this.suite ? `${this.suite.categories?.length || 0} 个分类` : 'null');
        } catch (e) {
            console.warn('加载测试套件失败:', e);
            this.suite = null;
        }
        
        // 更新badge
        let caseCount = 0;
        if (this.suite?.categories) {
            for (const cat of this.suite.categories) {
                for (const c of cat.cases || []) {
                    caseCount += (c.subcases || []).length;
                }
            }
        }
        document.getElementById('badge-cases').textContent = caseCount;
        
        // 渲染用例树
        this.renderCaseTree();
        this.renderQuickRef();
    },
    
    parseJsSuite(jsContent) {
        try {
            // 方法1: 尝试匹配 window.XXXTestSuite = {...}
            const match = jsContent.match(/window\.(\w+)\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
            if (match) {
                // 使用 Function 构造器安全执行
                const obj = new Function(`return ${match[2]}`)();
                console.log('[UITestWorkbench] 解析测试套件成功:', match[1], obj?.categories?.length, '个分类');
                return obj;
            }
            
            // 方法2: 尝试直接执行整个脚本
            const fn = new Function(jsContent + '; return window.GD303MiniTestSuite || window.TestSuite;');
            const result = fn();
            if (result) {
                console.log('[UITestWorkbench] 通过执行脚本解析成功');
                return result;
            }
            
            console.warn('[UITestWorkbench] 无法解析测试套件');
            return null;
        } catch (e) {
            console.error('[UITestWorkbench] 解析测试套件失败:', e);
            return null;
        }
    },
    
    renderCaseTree() {
        const container = document.getElementById('case-tree');
        if (!container) return;
        
        if (!this.suite?.categories) {
            container.innerHTML = '<div class="empty-hint">暂无测试用例</div>';
            return;
        }
        
        let html = '';
        for (const cat of this.suite.categories) {
            html += `<div class="list-item" style="font-weight:600;cursor:pointer;" onclick="const next=this.nextElementSibling;next.style.display=next.style.display==='none'?'block':'none'">
                📁 ${cat.id}. ${cat.name}
            </div>
            <div style="margin-left:12px;display:block;">`;
            
            for (const c of cat.cases || []) {
                html += `<div class="list-item" style="font-size:11px;cursor:pointer;" onclick="event.stopPropagation();const next=this.nextElementSibling;next.style.display=next.style.display==='none'?'block':'none'">
                    📋 ${c.id} ${c.name}
                </div>
                <div style="margin-left:12px;display:block;">`;
                
                for (const sub of c.subcases || []) {
                    const isActive = this.memory.selectedCase === sub.id;
                    html += `<div class="list-item ${isActive ? 'active' : ''}" style="font-size:10px;" onclick="event.stopPropagation();UITestWorkbench.selectCase('${sub.id}')">
                        ${sub.id} ${sub.name}
                    </div>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }
        container.innerHTML = html;
    },
    
    selectCase(id) {
        this.memory.selectedCase = id;
        this.renderCaseTree();
        this.renderCaseEditor(id);
    },
    
    renderCaseEditor(id) {
        const container = document.getElementById('case-editor');
        const title = document.getElementById('case-editor-title');
        if (!container) return;
        
        // 查找用例
        let subcase = null;
        if (this.suite?.categories) {
            for (const cat of this.suite.categories) {
                for (const c of cat.cases || []) {
                    subcase = (c.subcases || []).find(s => s.id === id);
                    if (subcase) break;
                }
                if (subcase) break;
            }
        }
        
        if (!subcase) {
            container.innerHTML = '<div class="empty-hint">选择用例编辑</div>';
            title.textContent = '选择用例';
            return;
        }
        
        title.textContent = `${subcase.id} ${subcase.name}`;
        
        // 根据视图模式渲染
        if (this.caseViewMode === 'code') {
            container.innerHTML = this.renderCaseEditorCode(subcase);
            return;
        }
        
        // 可视化模式 - 渲染步骤
        let html = `<div style="margin-bottom:12px;">
            <div class="form-group">
                <label>用例名称</label>
                <input type="text" value="${subcase.name || ''}">
            </div>
            <div class="form-group">
                <label>描述</label>
                <input type="text" value="${subcase.desc || ''}">
            </div>
        </div>
        <div style="font-size:11px;font-weight:600;margin-bottom:8px;">测试步骤:</div>`;
        
        for (let i = 0; i < (subcase.steps || []).length; i++) {
            const step = subcase.steps[i];
            html += `<div style="display:flex;gap:8px;margin-bottom:6px;padding:8px;background:var(--bg-tertiary);border-radius:4px;">
                <span style="color:var(--accent-color);font-weight:600;width:20px;">${i + 1}</span>
                <div style="flex:1;">
                    <div style="font-size:11px;font-weight:500;">${step.action}</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
                        期望: ${Object.entries(step.expect || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '-'}
                    </div>
                </div>
            </div>`;
        }
        
        html += `<button class="wb-btn" style="margin-top:8px;" onclick="UITestWorkbench.addStep('${id}')">➕ 添加步骤</button>`;
        
        container.innerHTML = html;
    },
    
    // 视图模式: visual / code
    caseViewMode: 'visual',
    
    switchCaseView(mode) {
        this.caseViewMode = mode;
        
        // 更新按钮状态 - 使用更精确的选择器
        const toggleBtns = document.querySelectorAll('#panel-cases .view-toggle .toggle-btn');
        toggleBtns.forEach(btn => {
            const isVisual = btn.textContent.trim() === '可视化';
            const isCode = btn.textContent.trim() === '代码';
            btn.classList.toggle('active', (mode === 'visual' && isVisual) || (mode === 'code' && isCode));
        });
        document.querySelectorAll('.view-toggle .toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.includes(mode === 'visual' ? '可视化' : '代码'));
        });
        
        // 重新渲染当前用例
        if (this.memory.selectedCase) {
            this.renderCaseEditor(this.memory.selectedCase);
        }
    },
    
    renderCaseEditorCode(subcase) {
        // 代码模式：显示 JS 代码
        const steps = subcase.steps || [];
        let code = `// ${subcase.id} ${subcase.name}\n`;
        code += `// ${subcase.desc || ''}\n\n`;
        
        for (const step of steps) {
            code += `await ${step.action};\n`;
            if (step.expect && Object.keys(step.expect).length > 0) {
                code += `expect(${JSON.stringify(step.expect)});\n`;
            }
            code += '\n';
        }
        
        return `<textarea style="
            width: 100%;
            height: 100%;
            min-height: 300px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-primary);
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            line-height: 1.6;
            padding: 12px;
            resize: none;
            outline: none;
        " readonly>${code}</textarea>`;
    },
    
    renderQuickRef() {
        const container = document.getElementById('quick-ref');
        if (!container) return;
        
        // 显示动作和期望的快速参考
        let html = '<div style="font-size:10px;font-weight:600;margin-bottom:6px;">可用动作:</div>';
        for (const [id, action] of Object.entries(this.actions || {})) {
            html += `<div style="padding:3px 6px;font-size:10px;cursor:pointer;border-radius:3px;" 
                onmouseover="this.style.background='var(--bg-tertiary)'" 
                onmouseout="this.style.background=''"
                onclick="navigator.clipboard.writeText('${id}')">
                <span style="color:var(--accent-color)">${id}</span>
            </div>`;
        }
        
        html += '<div style="font-size:10px;font-weight:600;margin:10px 0 6px;">可用期望:</div>';
        for (const [id, exp] of Object.entries(this.expects || {})) {
            html += `<div style="padding:3px 6px;font-size:10px;cursor:pointer;border-radius:3px;"
                onmouseover="this.style.background='var(--bg-tertiary)'" 
                onmouseout="this.style.background=''"
                onclick="navigator.clipboard.writeText('${id}')">
                <span style="color:#f59e0b">${id}</span>
            </div>`;
        }
        
        container.innerHTML = html;
    },
    
    addCategory() {
        alert('添加分类功能开发中...');
    },
    
    addStep(caseId) {
        alert('添加步骤功能开发中...');
    },
    
    switchCaseView(view) {
        this.caseViewMode = view;
        document.querySelectorAll('.view-toggle .toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.includes(view === 'visual' ? '可视化' : '代码'));
        });
        if (this.memory.selectedCase) {
            this.renderCaseEditor(this.memory.selectedCase);
        }
    },

    // ==================== Tab 5: 执行测试 ====================
    async initExecuteTab() {
        // 加载测试套件（如果还没加载）
        if (!this.suite) {
            try {
                const content = await DeviceConfigManager.loadTestSuite(this.deviceId);
                if (content) {
                    if (typeof content === 'string') {
                        this.suite = this.parseJsSuite(content);
                    } else {
                        this.suite = content;
                    }
                }
            } catch (e) {
                console.warn('加载测试套件失败:', e);
            }
        }
        
        // 初始化LCD画布
        await this.initLcdCanvas();
        
        // 渲染分组列表
        this.renderExecGroups();
        
        // 渲染设备状态
        this.renderDeviceStatus();
        
        // 渲染手动控制
        this.renderManualCtrl();
        
        // 清空日志
        const logEl = document.getElementById('wb-exec-log');
        if (logEl) logEl.innerHTML = '';
        
        this.log('info', '执行测试模块已加载');
    },
    
    // 以下方法保留用于未来内嵌执行测试功能
    async initLcdCanvas() {
        const canvas = document.getElementById('wb-lcd-canvas');
        if (!canvas) return;
        
        // 加载LCD配置
        try {
            this.lcdConfig = await DeviceConfigManager.loadLcdProject(this.deviceId);
            if (this.lcdConfig && this.lcdConfig.image) {
                // 加载背景图
                const img = new Image();
                img.onload = () => {
                    this.lcdBgImage = img;
                    // 设置画布大小
                    const scale = 0.4;
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    this.renderLcd();
                };
                img.src = this.lcdConfig.image;
            } else {
                // 无配置时显示占位
                canvas.width = 300;
                canvas.height = 150;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#1a1a2e';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#666';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('LCD配置未加载', canvas.width/2, canvas.height/2);
            }
        } catch (e) {
            console.warn('加载LCD配置失败:', e);
        }
    },
    
    renderLcd(lcdBuffer = null) {
        const canvas = document.getElementById('wb-lcd-canvas');
        if (!canvas || !this.lcdBgImage) return;
        
        const ctx = canvas.getContext('2d');
        const scale = canvas.width / this.lcdBgImage.width;
        
        // 绘制背景
        ctx.drawImage(this.lcdBgImage, 0, 0, canvas.width, canvas.height);
        
        // 如果有LCD缓冲区数据，渲染段码
        if (lcdBuffer && this.lcdConfig?.elements) {
            ctx.fillStyle = 'rgba(0, 255, 100, 0.8)';
            for (const elem of this.lcdConfig.elements) {
                for (const seg of elem.segments || []) {
                    const segIdx = parseInt(seg.seg);
                    const comIdx = parseInt(seg.com);
                    // 检查该段是否点亮
                    if (this.isSegmentOn(lcdBuffer, segIdx, comIdx)) {
                        // 绘制像素
                        for (const px of seg.pixels || []) {
                            const [x, y] = px.split(',').map(Number);
                            ctx.fillRect(x * scale, y * scale, scale, scale);
                        }
                    }
                }
            }
        }
    },
    
    isSegmentOn(buffer, seg, com) {
        // LCD缓冲区格式: 54字节，每字节8位对应8个COM
        if (!buffer || seg >= buffer.length) return false;
        return (buffer[seg] & (1 << com)) !== 0;
    },
    
    renderExecGroups() {
        const container = document.getElementById('exec-group-list');
        if (!container) return;
        
        if (!this.suite?.categories) {
            container.innerHTML = '<div class="empty-hint">暂无测试分组</div>';
            return;
        }
        
        let html = '';
        let groupIdx = 0;
        for (const cat of this.suite.categories) {
            for (const c of cat.cases || []) {
                groupIdx++;
                const isActive = this.memory.selectedGroup === `${cat.id}_${c.id}`;
                html += `<div class="list-item ${isActive ? 'active' : ''}" onclick="UITestWorkbench.selectExecGroup('${cat.id}_${c.id}')">
                    <div class="item-name">${cat.id}.${c.id} ${c.name}</div>
                    <div class="item-desc">${(c.subcases || []).length} 个用例</div>
                </div>`;
            }
        }
        container.innerHTML = html || '<div class="empty-hint">暂无分组</div>';
    },
    
    selectExecGroup(groupKey) {
        this.memory.selectedGroup = groupKey;
        this.saveMemory();
        this.renderExecGroups();
        this.renderExecItems(groupKey);
    },
    
    renderExecItems(groupKey) {
        const container = document.getElementById('exec-item-list');
        if (!container) return;
        
        const [catId, caseId] = groupKey.split('_');
        
        let items = [];
        if (this.suite?.categories) {
            const cat = this.suite.categories.find(c => c.id === catId);
            if (cat) {
                const c = (cat.cases || []).find(x => x.id === caseId);
                if (c) items = c.subcases || [];
            }
        }
        
        let html = '';
        for (const item of items) {
            html += `<div class="list-item">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                    <input type="checkbox" class="exec-item-check" data-id="${item.id}">
                    <span>${item.id} ${item.name}</span>
                </label>
            </div>`;
        }
        container.innerHTML = html || '<div class="empty-hint">选择分组</div>';
    },
    
    renderDeviceStatus() {
        const container = document.getElementById('wb-device-status');
        if (!container) return;
        
        container.innerHTML = `
            <div class="status-row"><span>state</span><span id="ds-state">-</span></div>
            <div class="status-row"><span>mode</span><span id="ds-mode">-</span></div>
            <div class="status-row"><span>laser</span><span id="ds-laser">-</span></div>
            <div class="status-row"><span>line4</span><span id="ds-line4" style="color:var(--accent-color)">-</span></div>
        `;
    },
    
    renderManualCtrl() {
        const container = document.getElementById('wb-manual-ctrl');
        if (!container) return;
        
        container.innerHTML = `
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="mini-btn" onclick="UITestWorkbench.sendCmd('key_measure')">K1测量</button>
                <button class="mini-btn" onclick="UITestWorkbench.sendCmd('key_mode')">K2模式</button>
                <button class="mini-btn" onclick="UITestWorkbench.sendCmd('key_clear')">K3清除</button>
            </div>
            <div style="display:flex;gap:4px;margin-top:6px;align-items:center;">
                <input type="number" id="wb-sim-dist" value="5000" style="width:60px;padding:3px 6px;font-size:10px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:3px;color:var(--text-primary);">
                <span style="font-size:9px;color:var(--text-muted)">mm</span>
                <button class="mini-btn" onclick="UITestWorkbench.simOk()">✅OK</button>
                <button class="mini-btn" onclick="UITestWorkbench.simErr()">❌ERR</button>
            </div>
        `;
    },
    
    async sendCmd(cmd) {
        this.log('info', `发送: ${cmd}`);
        try {
            const result = await API.call('ui_test_send_cmd', cmd);
            if (result.success) {
                this.log('pass', `响应: ${result.response_text || 'OK'}`);
            } else {
                this.log('fail', `失败: ${result.error}`);
            }
        } catch (e) {
            this.log('fail', `异常: ${e.message}`);
        }
    },
    
    async simOk() {
        const dist = document.getElementById('wb-sim-dist')?.value || 5000;
        await this.sendCmd('sim_ok', { distance: parseInt(dist), signal: 3 });
    },
    
    async simErr() {
        await this.sendCmd('sim_err', { code: 1 });
    },
    
    zoomLcd(delta) {
        const canvas = document.getElementById('wb-lcd-canvas');
        if (!canvas || !this.lcdBgImage) return;
        
        // 计算新的缩放比例
        const currentScale = canvas.width / this.lcdBgImage.width;
        const newScale = Math.max(0.2, Math.min(1.5, currentScale + delta));
        
        // 更新画布大小
        canvas.width = this.lcdBgImage.width * newScale;
        canvas.height = this.lcdBgImage.height * newScale;
        
        // 重新渲染
        this.renderLcd();
    },
    
    toggleAll() {
        const checked = document.getElementById('wb-check-all')?.checked;
        document.querySelectorAll('.exec-item-check').forEach(cb => cb.checked = checked);
    },
    
    // 运行状态
    running: false,
    aborted: false,
    results: {},
    
    async runSelected() {
        const selected = [];
        document.querySelectorAll('.exec-item-check:checked').forEach(cb => selected.push(cb.dataset.id));
        
        if (selected.length === 0) {
            alert('请先选择测试项');
            return;
        }
        
        await this.runItems(selected);
    },
    
    async runAll() {
        // 收集所有可自动执行的测试项
        const allKeys = [];
        if (this.suite?.categories) {
            for (const cat of this.suite.categories) {
                for (const c of cat.cases || []) {
                    for (const sub of c.subcases || []) {
                        if (sub.steps && sub.steps.length > 0) {
                            allKeys.push(sub.id);
                        }
                    }
                }
            }
        }
        
        if (allKeys.length === 0) {
            alert('没有可自动执行的测试项');
            return;
        }
        
        await this.runItems(allKeys);
    },
    
    async runItems(keys) {
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            alert('请先连接串口');
            return;
        }
        
        this.running = true;
        this.aborted = false;
        document.getElementById('wb-btn-stop').disabled = false;
        
        this.log('info', `开始运行 ${keys.length} 个测试项...`);
        
        // 初始化测试报告
        this.testReport = {
            startTime: new Date().toISOString(),
            endTime: null,
            device: this.deviceId,
            testCases: [],
        };
        
        for (const key of keys) {
            if (this.aborted) {
                this.log('info', '测试已中止');
                break;
            }
            
            // 找到测试用例
            const subcase = this.findSubcase(key);
            if (!subcase || !subcase.steps || subcase.steps.length === 0) {
                this.log('info', `[${key}] 跳过(无测试步骤)`);
                continue;
            }
            
            this.log('step', `[${key}] ${subcase.name}`);
            
            try {
                await this.executeSubcase(subcase);
            } catch (e) {
                this.results[key] = { passed: false, error: e.message };
                this.log('fail', `[${key}] 执行异常: ${e.message}`);
            }
            
            // 更新显示
            this.renderExecGroups();
        }
        
        this.testReport.endTime = new Date().toISOString();
        this.running = false;
        document.getElementById('wb-btn-stop').disabled = true;
        
        const passed = Object.values(this.results).filter(r => r.passed).length;
        const failed = Object.values(this.results).filter(r => !r.passed).length;
        this.log('info', `测试完成: ${passed} 通过, ${failed} 失败`);
    },
    
    findSubcase(id) {
        if (!this.suite?.categories) return null;
        for (const cat of this.suite.categories) {
            for (const c of cat.cases || []) {
                const sub = (c.subcases || []).find(s => s.id === id);
                if (sub) return sub;
            }
        }
        return null;
    },
    
    async executeSubcase(subcase) {
        const key = subcase.id;
        let allPassed = true;
        let lastError = null;
        
        for (let i = 0; i < subcase.steps.length; i++) {
            if (this.aborted) return;
            
            const step = subcase.steps[i];
            this.log('info', `  [${i+1}] ${step.action}`);
            
            // 执行动作
            const parsed = this.parseAction(step.action);
            if (parsed) {
                await this.executeAction(parsed.cmd, parsed.param);
            }
            
            // 验证期望值
            if (step.expect && Object.keys(step.expect).length > 0) {
                await this.sleep(150);
                const result = await this.verifyExpect(step.expect);
                
                if (result.passed) {
                    this.log('pass', `    ✓ 验证通过`);
                } else {
                    this.log('fail', `    ✗ 验证失败: ${result.error}`);
                    allPassed = false;
                    lastError = result.error;
                }
            }
        }
        
        this.results[key] = { passed: allPassed, error: lastError };
        
        if (allPassed) {
            this.log('pass', `  ✓ [${key}] 测试通过`);
        } else {
            this.log('fail', `  ✗ [${key}] 测试失败`);
        }
    },
    
    parseAction(actionStr) {
        // 使用 UITestLib 解析
        if (window.UITestLib) {
            return UITestLib.parseAction(actionStr);
        }
        
        // 备用解析
        const actionMap = {
            'K1短按': { cmd: 'key_measure' },
            'K1长按': { cmd: 'key_measure_long' },
            'K2短按': { cmd: 'key_mode' },
            'K2长按': { cmd: 'key_base' },
            'K3短按': { cmd: 'key_clear' },
            'K3长按': { cmd: 'key_backlight' },
            'K3超长按': { cmd: 'key_power_off' },
            '获取状态': { cmd: 'get_status' },
            '重置': { cmd: 'reset' },
        };
        
        // 检查带参数的动作
        const match = actionStr.match(/^(.+?)\((.+)\)$/);
        if (match) {
            const name = match[1];
            const paramsStr = match[2];
            
            if (name === '模拟测距成功') {
                const [dist, signal] = paramsStr.split(',').map(s => parseInt(s.trim()));
                return { cmd: 'sim_ok', param: { distance: dist, signal: signal || 3 } };
            }
            if (name === '模拟测距失败') {
                return { cmd: 'sim_err', param: parseInt(paramsStr) };
            }
            if (name === '设置单位') {
                return { cmd: 'set_unit', param: parseInt(paramsStr) };
            }
            if (name === '等待') {
                return { cmd: 'wait', param: parseInt(paramsStr) };
            }
        }
        
        return actionMap[actionStr] || null;
    },
    
    async executeAction(cmd, param) {
        if (cmd === 'wait') {
            await this.sleep(param || 100);
            return;
        }
        
        if (cmd === 'reset') {
            // 执行多次清除
            for (let i = 0; i < 4; i++) {
                await this.sendCmdInternal('key_clear');
                await this.sleep(100);
            }
            return;
        }
        
        await this.sendCmdInternal(cmd, param);
    },
    
    async sendCmdInternal(cmd, param) {
        try {
            const result = await API.call('ui_test_send_cmd', cmd, param);
            if (result.success) {
                if (result.hex) this.log('tx', `    TX: ${result.hex}`);
                if (result.response_text) this.log('rx', `    RX: ${result.response_text.replace(/\r\n/g, ' ')}`);
                
                // 更新LCD显示
                await this.updateLcdFromDevice();
            } else {
                this.log('fail', `    命令失败: ${result.error}`);
            }
            return result;
        } catch (e) {
            this.log('fail', `    命令异常: ${e.message}`);
            return { success: false, error: e.message };
        }
    },
    
    async updateLcdFromDevice() {
        try {
            const result = await API.call('lcd_dump');
            if (result.success && result.buffer) {
                this.renderLcd(result.buffer);
                this.updateDeviceStatusFromBuffer(result.buffer);
            }
        } catch (e) {
            console.warn('LCD更新失败:', e);
        }
    },
    
    updateDeviceStatusFromBuffer(buffer) {
        // 简单解析一些状态
        // 这里需要根据实际协议解析
    },
    
    async verifyExpect(expect) {
        // 获取当前设备状态
        try {
            const result = await API.call('ui_test_send_cmd', 'get_status');
            if (!result.success) {
                return { passed: false, error: '获取状态失败' };
            }
            
            // 解析状态
            const status = this.parseStatusResponse(result.response_text);
            
            // 验证每个期望值
            for (const [key, expected] of Object.entries(expect)) {
                const actual = status[key];
                if (actual !== expected && String(actual) !== String(expected)) {
                    return { passed: false, error: `${key}: 期望 ${expected}, 实际 ${actual}` };
                }
            }
            
            return { passed: true };
        } catch (e) {
            return { passed: false, error: e.message };
        }
    },
    
    parseStatusResponse(text) {
        // 解析状态响应文本
        const status = {};
        if (!text) return status;
        
        // 尝试解析 key=value 格式
        const pairs = text.split(/[,\s]+/);
        for (const pair of pairs) {
            const [k, v] = pair.split('=');
            if (k && v !== undefined) {
                status[k.trim()] = v.trim();
            }
        }
        
        return status;
    },
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    stop() {
        this.aborted = true;
        this.log('info', '正在停止测试...');
    },
    
    log(type, msg) {
        const container = document.getElementById('wb-exec-log');
        if (!container) return;
        
        const time = new Date().toLocaleTimeString();
        const colors = { 
            info: 'var(--text-muted)', 
            pass: 'var(--accent-color)', 
            fail: '#ff6b6b', 
            tx: '#00d4ff', 
            rx: '#a78bfa',
            step: '#f59e0b'
        };
        container.innerHTML += `<div style="color:${colors[type] || 'inherit'}">[${time}] ${msg}</div>`;
        container.scrollTop = container.scrollHeight;
    },

    // ==================== Tab 6: 测试报告 ====================
    async initReportTab() {
        // 渲染当前测试结果
        this.renderReportSummary();
        
        // 加载历史报告列表
        this.refreshReports();
    },
    
    renderReportSummary() {
        const container = document.getElementById('report-summary');
        if (!container) return;
        
        if (!this.testReport || !this.testReport.testCases || this.testReport.testCases.length === 0) {
            container.innerHTML = '<div class="empty-hint">运行测试后显示结果</div>';
            return;
        }
        
        const report = this.testReport;
        const passed = report.testCases.filter(c => c.passed).length;
        const failed = report.testCases.filter(c => !c.passed).length;
        const total = report.testCases.length;
        const rate = total > 0 ? Math.round(passed / total * 100) : 0;
        
        container.innerHTML = `
            <div style="display:flex;gap:16px;text-align:center;">
                <div style="flex:1;padding:12px;background:var(--bg-tertiary);border-radius:6px;">
                    <div style="font-size:24px;font-weight:bold;">${total}</div>
                    <div style="font-size:10px;color:var(--text-muted);">总用例</div>
                </div>
                <div style="flex:1;padding:12px;background:var(--bg-tertiary);border-radius:6px;">
                    <div style="font-size:24px;font-weight:bold;color:var(--accent-color);">${passed}</div>
                    <div style="font-size:10px;color:var(--text-muted);">通过</div>
                </div>
                <div style="flex:1;padding:12px;background:var(--bg-tertiary);border-radius:6px;">
                    <div style="font-size:24px;font-weight:bold;color:#ff6b6b;">${failed}</div>
                    <div style="font-size:10px;color:var(--text-muted);">失败</div>
                </div>
                <div style="flex:1;padding:12px;background:var(--bg-tertiary);border-radius:6px;">
                    <div style="font-size:24px;font-weight:bold;">${rate}%</div>
                    <div style="font-size:10px;color:var(--text-muted);">通过率</div>
                </div>
            </div>
            <div style="margin-top:12px;font-size:11px;color:var(--text-muted);">
                设备: ${report.device || '-'} | 
                时间: ${report.startTime ? new Date(report.startTime).toLocaleString() : '-'}
            </div>
        `;
    },
    
    refreshReports() {
        const container = document.getElementById('report-list');
        if (!container) return;
        
        // TODO: 从后端加载历史报告列表
        container.innerHTML = '<div class="empty-hint">暂无历史报告</div>';
    },
    
    exportReport() {
        if (!this.testReport || !this.testReport.testCases || this.testReport.testCases.length === 0) {
            alert('没有测试数据，请先运行测试');
            return;
        }
        
        // 复用 UITestPage 的报告生成逻辑
        if (window.UITestPage && typeof UITestPage.exportReport === 'function') {
            UITestPage.testReport = this.testReport;
            UITestPage.groups = this.getGroupsFromSuite();
            UITestPage.exportReport();
        } else {
            alert('报告导出功能不可用');
        }
    },
    
    getGroupsFromSuite() {
        const groups = [];
        if (this.suite?.categories) {
            for (const cat of this.suite.categories) {
                for (const c of cat.cases || []) {
                    groups.push({
                        name: `${cat.id}. ${cat.name} - ${c.id} ${c.name}`,
                        items: (c.subcases || []).map(s => ({ key: s.id, name: s.name, desc: s.desc }))
                    });
                }
            }
        }
        return groups;
    },
    
    // ==================== 通用功能 ====================
    
    /**
     * 显示配置文件路径信息
     * @param {string} type 配置类型
     * @param {Object} pathInfo { filePath, fullPath, exists }
     */
    showConfigPath(type, pathInfo) {
        const typeNames = {
            actions: '动作库',
            tests: '测试套件',
            lcd: 'LCD配置',
            protocols: '协议配置'
        };
        const typeName = typeNames[type] || type;
        const status = pathInfo.exists ? '✓' : '(不存在)';
        const msg = `📂 ${typeName}: ${pathInfo.filePath} ${status}`;
        
        console.log(`[UITestWorkbench] ${msg}`);
        this.setStatus(msg);
        
        // 3秒后恢复状态
        setTimeout(() => {
            if (this.tabInited[this.currentTab]) {
                this.setStatus('就绪');
            }
        }, 3000);
    },
    
    setStatus(msg) {
        const el = document.getElementById('wb-status');
        if (el) el.textContent = msg;
    },
    
    markModified() {
        this.modified = true;
        const el = document.getElementById('wb-modified');
        if (el) {
            el.textContent = '● 已修改';
            el.style.color = '#f59e0b';
        }
    },
    
    clearModified() {
        this.modified = false;
        const el = document.getElementById('wb-modified');
        if (el) el.textContent = '';
    },
    
    async save() {
        if (!this.deviceId) {
            alert('请先选择设备');
            return;
        }
        
        try {
            // 保存动作库
            if (Object.keys(this.actions).length > 0) {
                await DeviceConfigManager.saveActions({
                    version: '1.0',
                    device: this.deviceId,
                    actions: this.actions,
                    expects: this.expects
                }, this.deviceId);
            }
            
            // 保存测试套件
            if (this.suite) {
                await DeviceConfigManager.saveTestSuite(this.suite, this.deviceId);
            }
            
            this.clearModified();
            this.setStatus('保存成功');
            setTimeout(() => this.setStatus('就绪'), 2000);
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    },
    
    // ==================== 记忆功能 ====================
    loadMemory() {
        try {
            const saved = localStorage.getItem('ui_test_workbench_memory');
            if (saved) {
                this.memory = { ...this.memory, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('加载记忆失败:', e);
        }
    },
    
    saveMemory() {
        try {
            localStorage.setItem('ui_test_workbench_memory', JSON.stringify(this.memory));
        } catch (e) {
            console.warn('保存记忆失败:', e);
        }
    },
    
    showHelp() {
        alert(`UI自动化测试工作台 使用说明

🎨 段码映射
绑定 LCD 像素到 SEG:COM，建立显示映射关系

📺 LCD模拟
实时显示 LCD 状态，验证段码映射是否正确

⚡ 动作库
定义测试动作（按键、模拟命令）和期望值

📝 用例编辑
编写测试用例脚本，支持可视化和代码双视图

▶️ 执行测试
运行测试用例，实时显示 LCD 和设备状态

📊 测试报告
查看测试结果，导出 HTML 报告

💡 开发流程:
1. 段码映射 → 建立 LCD 元素映射
2. LCD模拟 → 验证映射正确性
3. 动作库 → 定义测试动作
4. 用例编辑 → 编写测试脚本
5. 执行测试 → 运行并验证
6. 测试报告 → 导出结果`);
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('wb-device-selector')) {
        UITestWorkbench.init();
    }
});
