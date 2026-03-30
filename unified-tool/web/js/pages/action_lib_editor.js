/**
 * 动作库编辑器 - 可视化编辑动作和期望定义
 * 用于编辑 ui_test_lib.js 中的 actions/expects/templates
 * 
 * 集成 DeviceConfigManager 统一设备配置管理
 */

window.ActionLibEditor = {
    currentTab: 'actions',
    selectedItem: null,
    selectedType: null,
    currentDevice: null,
    actionsData: null,  // 当前设备的动作库数据
    
    // 界面预设相关
    screenPresets: {},  // 界面预设数据
    lcdConfig: null,    // LCD配置
    lcdImage: null,     // LCD背景图
    screenSelectedElements: new Set(),  // 当前选中的元素
    showLabels: false,  // 是否显示标签
    
    // 初始化
    async init() {
        console.log('[ActionLibEditor] 初始化');
        
        // 初始化设备管理器（内部会加载LCD配置）
        await this.initDeviceManager();
        
        this.renderList();
        this.renderHelpItems();
        
        // 绑定键盘事件（H切换标签）
        document.addEventListener('keydown', (e) => {
            if (this.currentTab === 'screens' && (e.key === 'h' || e.key === 'H')) {
                this.showLabels = !this.showLabels;
                this.renderScreenCanvas();
            }
        });
    },
    
    // 初始化设备管理器
    async initDeviceManager() {
        // 等待 DeviceConfigManager 可用
        if (typeof DeviceConfigManager === 'undefined') {
            console.warn('[ActionLibEditor] DeviceConfigManager 不可用，使用默认数据');
            return;
        }
        
        // 确保 DeviceConfigManager 已初始化
        try {
            await DeviceConfigManager.init();
        } catch (e) {
            console.warn('[ActionLibEditor] DeviceConfigManager 初始化失败:', e);
        }
        
        // 创建设备选择器
        const selectorContainer = document.getElementById('device-selector-container');
        if (selectorContainer && typeof createDeviceSelector === 'function') {
            createDeviceSelector('device-selector-container', {
                showManage: true,
                onChange: (deviceId) => this.onDeviceChanged(deviceId)
            });
        }
        
        // 订阅设备变更事件
        DeviceConfigManager.subscribe('device-changed', (e) => {
            if (e.newDevice !== this.currentDevice) {
                this.onDeviceChanged(e.newDevice);
            }
        });
        
        // 订阅动作库更新事件
        DeviceConfigManager.subscribe('actions-updated', (e) => {
            if (e.deviceId === this.currentDevice) {
                this.loadActionsData();
            }
        });
        
        // 加载当前设备配置
        this.currentDevice = DeviceConfigManager.getCurrentDevice();
        console.log('[ActionLibEditor] 当前设备:', this.currentDevice);
        if (this.currentDevice) {
            await this.loadActionsData();
            await this.loadLcdConfig();
        } else {
            console.warn('[ActionLibEditor] 未选择设备，等待用户选择');
        }
    },
    
    // 设备变更处理
    async onDeviceChanged(deviceId) {
        console.log('[ActionLibEditor] 设备变更:', deviceId);
        this.currentDevice = deviceId;
        this.selectedItem = null;
        this.selectedType = null;
        
        await this.loadActionsData();
        await this.loadLcdConfig();
        await this.loadScreenPresets();
        this.renderList();
        this.clearEditForm();
    },
    
    // 加载动作库数据
    async loadActionsData() {
        if (!this.currentDevice || typeof DeviceConfigManager === 'undefined') {
            // 使用默认的 UITestLib 数据
            this.actionsData = null;
            return;
        }
        
        try {
            const data = await DeviceConfigManager.loadActions(this.currentDevice);
            if (data) {
                this.actionsData = data;
                // 合并到 UITestLib（如果存在）
                if (typeof UITestLib !== 'undefined') {
                    if (data.actions) Object.assign(UITestLib.actions, data.actions);
                    if (data.expects) Object.assign(UITestLib.expects, data.expects);
                    if (data.templates) Object.assign(UITestLib.templates, data.templates);
                }
                // 加载界面预设
                if (data.screenPresets) {
                    this.screenPresets = data.screenPresets;
                }
                console.log('[ActionLibEditor] 已加载设备动作库:', this.currentDevice);
            }
        } catch (err) {
            console.error('[ActionLibEditor] 加载动作库失败:', err);
        }
    },
    
    // 加载LCD配置
    async loadLcdConfig() {
        if (typeof DeviceConfigManager === 'undefined') {
            console.warn('[ActionLibEditor] DeviceConfigManager 不可用');
            return;
        }
        if (!this.currentDevice) {
            console.warn('[ActionLibEditor] 未选择设备，跳过LCD配置加载');
            return;
        }
        
        try {
            const lcdProject = await DeviceConfigManager.loadLcdProject(this.currentDevice);
            if (lcdProject && lcdProject.elements && lcdProject.elements.length > 0) {
                this.lcdConfig = {
                    elements: lcdProject.elements.map(elem => ({
                        ...elem,
                        segments: elem.segments.map(seg => ({
                            ...seg,
                            pixelMask: new Set(seg.pixelMask || seg.pixels || [])
                        }))
                    })),
                    imageWidth: lcdProject.imageWidth || 400,
                    imageHeight: lcdProject.imageHeight || 200
                };
                
                // 加载背景图
                if (lcdProject.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.lcdImage = img;
                        this.renderScreenCanvas();
                    };
                    img.src = lcdProject.image;
                }
                
                console.log('[ActionLibEditor] LCD配置加载成功:', this.lcdConfig.elements.length, '个元素');
            } else {
                console.warn('[ActionLibEditor] LCD配置为空或无元素');
                this.lcdConfig = null;
            }
        } catch (err) {
            console.warn('[ActionLibEditor] 加载LCD配置失败:', err);
            this.lcdConfig = null;
        }
    },
    
    // 加载界面预设
    async loadScreenPresets() {
        if (!this.actionsData) return;
        this.screenPresets = this.actionsData.screenPresets || {};
    },
    
    // 保存动作库数据
    async saveActionsData() {
        if (!this.currentDevice || typeof DeviceConfigManager === 'undefined') {
            console.warn('[ActionLibEditor] 无法保存：设备未选择或 DeviceConfigManager 不可用');
            return false;
        }
        
        try {
            const data = {
                actions: UITestLib.actions,
                expects: UITestLib.expects,
                templates: UITestLib.templates,
                screenPresets: this.screenPresets,  // 包含界面预设
                version: '1.0',
                lastModified: new Date().toISOString()
            };
            
            await DeviceConfigManager.saveActions(this.currentDevice, data);
            console.log('[ActionLibEditor] 动作库已保存:', this.currentDevice);
            return true;
        } catch (err) {
            console.error('[ActionLibEditor] 保存动作库失败:', err);
            return false;
        }
    },
    
    // 切换标签页
    switchTab(tab) {
        this.currentTab = tab;
        this.selectedItem = null;
        this.selectedType = null;
        
        // 更新标签样式
        document.querySelectorAll('.action-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        
        // 显示/隐藏LCD预览区 - 界面预设和期望tab都可能需要显示
        const lcdSection = document.getElementById('lcd-preview-section');
        if (lcdSection) {
            lcdSection.style.display = (tab === 'screens' || tab === 'expects') ? 'block' : 'none';
            // 清除预览信息
            const infoDiv = lcdSection.querySelector('.preview-info');
            if (infoDiv) infoDiv.remove();
        }
        
        this.renderList();
        this.clearEditForm();
        
        // 如果是界面预设或期望tab，渲染画布
        if (tab === 'screens' || tab === 'expects') {
            this.screenSelectedElements.clear();
            this.renderScreenCanvas();
        }
    },
    
    // 渲染列表
    renderList() {
        const container = document.getElementById('action-list');
        if (!container) return;
        
        let html = '';
        
        if (this.currentTab === 'actions') {
            html = this.renderActionList();
        } else if (this.currentTab === 'expects') {
            html = this.renderExpectList();
        } else if (this.currentTab === 'templates') {
            html = this.renderTemplateList();
        } else if (this.currentTab === 'screens') {
            html = this.renderScreenList();
        }
        
        container.innerHTML = html;
    },

    // 渲染动作列表（按分类分组）
    renderActionList() {
        const categories = UITestLib.getActionList();
        let html = '';
        
        for (const [cat, items] of Object.entries(categories)) {
            html += `
                <div class="action-category">
                    <div class="action-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span>📁 ${cat}</span>
                        <span class="count">${items.length}</span>
                    </div>
                    <div class="action-category-items">
            `;
            
            for (const item of items) {
                const selected = this.selectedItem === item.name && this.selectedType === 'action' ? 'selected' : '';
                html += `
                    <div class="action-item ${selected}" onclick="ActionLibEditor.selectItem('action', '${item.name}')">
                        <div class="name">${item.name}</div>
                        <div class="desc">${item.desc}</div>
                        <div class="cmd">cmd: ${UITestLib.actions[item.name].cmd}</div>
                    </div>
                `;
            }
            
            html += '</div></div>';
        }
        
        return html;
    },
    
    // 渲染期望列表（按分类分组）
    renderExpectList() {
        const categories = {};
        
        // 按分类分组
        Object.entries(UITestLib.expects).forEach(([name, def]) => {
            if (name.startsWith('_')) return; // 跳过注释
            const cat = def.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ name, ...def });
        });
        
        let html = '';
        
        for (const [cat, items] of Object.entries(categories)) {
            const catIcons = {
                '状态': '🔄', '数字': '🔢', '模式': '📐', '单位': '📏',
                '基准': '📍', '图标': '🔔', '界面': '🖥️', '其他': '📋'
            };
            const icon = catIcons[cat] || '📁';
            
            html += `
                <div class="action-category">
                    <div class="action-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span>${icon} ${cat}</span>
                        <span class="count">${items.length}</span>
                    </div>
                    <div class="action-category-items">
            `;
            
            for (const item of items) {
                const selected = this.selectedItem === item.name && this.selectedType === 'expect' ? 'selected' : '';
                const def = UITestLib.expects[item.name];
                
                // 构建信息行
                let infoLine = '';
                if (def.field) {
                    infoLine = `field: ${def.field}`;
                    if (def.value !== undefined) infoLine += `, value: ${def.value}`;
                    if (def.check) infoLine += `, check: ${def.check}`;
                } else if (def.type) {
                    infoLine = `type: ${def.type}`;
                }
                if (def.lcdElements) {
                    infoLine += ` | LCD: ${def.lcdElements.length}元素`;
                }
                
                html += `
                    <div class="action-item ${selected}" onclick="ActionLibEditor.selectItem('expect', '${item.name}')">
                        <div class="name">${item.name}</div>
                        <div class="desc">${item.desc}</div>
                        <div class="cmd">${infoLine}</div>
                    </div>
                `;
            }
            
            html += '</div></div>';
        }
        
        return html;
    },

    // 渲染模板列表
    renderTemplateList() {
        const templates = UITestLib.getTemplateList();
        let html = '<div class="action-category"><div class="action-category-items">';
        
        for (const item of templates) {
            const selected = this.selectedItem === item.name && this.selectedType === 'template' ? 'selected' : '';
            html += `
                <div class="action-item ${selected}" onclick="ActionLibEditor.selectItem('template', '${item.name}')">
                    <div class="name">${item.name}</div>
                    <div class="desc">${item.desc}</div>
                    <div class="cmd">${item.stepCount} 步骤</div>
                </div>
            `;
        }
        
        html += '</div></div>';
        return html;
    },
    
    // 渲染界面预设列表
    renderScreenList() {
        const presets = Object.entries(this.screenPresets);
        
        if (presets.length === 0) {
            return `
                <div style="text-align:center;padding:30px;color:var(--text-muted);">
                    <div style="font-size:32px;margin-bottom:12px;">🖥️</div>
                    <div>暂无界面预设</div>
                    <div style="font-size:11px;margin-top:8px;">点击"新建"创建界面预设<br>或从固件同步当前界面</div>
                </div>
            `;
        }
        
        // 按分类分组
        const categories = {};
        for (const [name, preset] of presets) {
            const cat = preset.category || '未分类';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ name, ...preset });
        }
        
        let html = '';
        for (const [cat, items] of Object.entries(categories)) {
            html += `
                <div class="action-category">
                    <div class="action-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span>📁 ${cat}</span>
                        <span class="count">${items.length}</span>
                    </div>
                    <div class="action-category-items">
            `;
            
            for (const item of items) {
                const selected = this.selectedItem === item.name && this.selectedType === 'screen' ? 'selected' : '';
                const elemCount = item.elements ? item.elements.length : 0;
                html += `
                    <div class="action-item ${selected}" onclick="ActionLibEditor.selectItem('screen', '${item.name}')">
                        <div class="name">${item.name}</div>
                        <div class="desc">${item.desc || ''}</div>
                        <div class="cmd">${elemCount} 个元素</div>
                    </div>
                `;
            }
            
            html += '</div></div>';
        }
        
        return html;
    },
    
    // 选择项目
    selectItem(type, name) {
        this.selectedItem = name;
        this.selectedType = type;
        
        // 更新列表选中状态
        document.querySelectorAll('.action-item').forEach(el => el.classList.remove('selected'));
        if (event && event.currentTarget) {
            event.currentTarget.classList.add('selected');
        }
        
        // 渲染编辑表单
        this.renderEditForm(type, name);
        
        // 更新JSON预览
        this.updatePreview();
        
        // 如果是界面预设，加载到画布
        if (type === 'screen') {
            const preset = this.screenPresets[name];
            if (preset && preset.elements) {
                this.screenSelectedElements = new Set(preset.elements);
            } else {
                this.screenSelectedElements.clear();
            }
            this.renderScreenCanvas();
        }
        
        // 如果是期望且有LCD绑定，显示在画布上
        if (type === 'expect') {
            const def = UITestLib.expects[name];
            if (def && (def.lcdElements || def.lcdOff)) {
                this.screenSelectedElements.clear();
                if (def.lcdElements) {
                    def.lcdElements.forEach(e => this.screenSelectedElements.add(e));
                }
                this.renderScreenCanvas();
                
                // 更新预览信息
                const lcdSection = document.getElementById('lcd-preview-section');
                if (lcdSection) {
                    let infoDiv = lcdSection.querySelector('.preview-info');
                    if (!infoDiv) {
                        infoDiv = document.createElement('div');
                        infoDiv.className = 'preview-info';
                        lcdSection.insertBefore(infoDiv, lcdSection.querySelector('h4').nextSibling);
                    }
                    infoDiv.style.cssText = 'padding:8px;background:rgba(33,150,243,0.1);border-radius:4px;margin-bottom:8px;font-size:11px;';
                    infoDiv.innerHTML = `
                        <b>期望:</b> ${name}<br>
                        <span style="color:#4caf50;">✅ 亮起: ${(def.lcdElements || []).length}个</span>
                        ${def.lcdOff ? `<span style="color:#f44336;margin-left:8px;">❌ 熄灭: ${def.lcdOff.length}个</span>` : ''}
                    `;
                }
            } else {
                // 无LCD绑定的期望，清空画布
                this.screenSelectedElements.clear();
                this.renderScreenCanvas();
                const lcdSection = document.getElementById('lcd-preview-section');
                if (lcdSection) {
                    const infoDiv = lcdSection.querySelector('.preview-info');
                    if (infoDiv) infoDiv.remove();
                }
            }
        }
    },
    
    // 渲染编辑表单
    renderEditForm(type, name) {
        const container = document.getElementById('edit-content');
        const titleEl = document.getElementById('edit-title');
        const badgeEl = document.getElementById('edit-type-badge');
        
        if (!container) return;
        
        titleEl.textContent = name;
        badgeEl.style.display = 'inline';
        badgeEl.textContent = type === 'action' ? '动作' : type === 'expect' ? '期望' : type === 'template' ? '模板' : '界面';
        
        if (type === 'action') {
            container.innerHTML = this.renderActionForm(name);
        } else if (type === 'expect') {
            container.innerHTML = this.renderExpectForm(name);
        } else if (type === 'template') {
            container.innerHTML = this.renderTemplateForm(name);
        } else if (type === 'screen') {
            container.innerHTML = this.renderScreenForm(name);
        }
    },

    // 渲染动作编辑表单
    renderActionForm(name) {
        const def = UITestLib.actions[name];
        if (!def) return '<div>未找到动作定义</div>';
        
        let paramsHtml = '';
        if (def.params && def.params.length > 0) {
            paramsHtml = `
                <div class="form-section">
                    <h4>📋 参数定义</h4>
                    <div class="params-list" id="params-list">
                        ${def.params.map((p, i) => `
                            <div class="param-row">
                                <input type="text" value="${p.name}" placeholder="参数名" data-field="name" data-idx="${i}">
                                <input type="text" value="${p.key}" placeholder="键名" data-field="key" data-idx="${i}">
                                <select data-field="type" data-idx="${i}">
                                    <option value="number" ${p.type === 'number' ? 'selected' : ''}>数字</option>
                                    <option value="string" ${p.type === 'string' ? 'selected' : ''}>字符串</option>
                                </select>
                                <input type="text" value="${p.default || ''}" placeholder="默认值" data-field="default" data-idx="${i}">
                                <button class="btn-remove" onclick="ActionLibEditor.removeParam(${i})">×</button>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn-add-param" onclick="ActionLibEditor.addParam()">+ 添加参数</button>
                </div>
            `;
        }
        
        let compositeHtml = '';
        if (def.isComposite && def.subActions) {
            compositeHtml = `
                <div class="form-section">
                    <h4>🔗 复合动作</h4>
                    <div class="composite-actions" id="composite-list">
                        ${def.subActions.map((a, i) => `
                            <div class="composite-row">
                                <span class="step-num">${i + 1}</span>
                                <select data-field="cmd" data-idx="${i}">
                                    ${Object.entries(UITestLib.actions).map(([n, d]) => 
                                        `<option value="${d.cmd}" ${d.cmd === a.cmd ? 'selected' : ''}>${n}</option>`
                                    ).join('')}
                                </select>
                                <input type="number" value="${a.delay || 100}" placeholder="延迟ms" data-field="delay" data-idx="${i}">
                                <button class="btn-remove" onclick="ActionLibEditor.removeSubAction(${i})">×</button>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn-add-param" onclick="ActionLibEditor.addSubAction()">+ 添加子动作</button>
                </div>
            `;
        }
        
        return `
            <div class="form-section">
                <h4>📝 基本信息</h4>
                <div class="form-row">
                    <label>名称</label>
                    <input type="text" id="edit-name" value="${name}" onchange="ActionLibEditor.onFieldChange()">
                </div>
                <div class="form-row">
                    <label>命令</label>
                    <input type="text" id="edit-cmd" value="${def.cmd}" onchange="ActionLibEditor.onFieldChange()">
                </div>
                <div class="form-row">
                    <label>分类</label>
                    <select id="edit-category" onchange="ActionLibEditor.onFieldChange()">
                        <option value="按键" ${def.category === '按键' ? 'selected' : ''}>按键</option>
                        <option value="模拟" ${def.category === '模拟' ? 'selected' : ''}>模拟</option>
                        <option value="控制" ${def.category === '控制' ? 'selected' : ''}>控制</option>
                        <option value="其他" ${!def.category || def.category === '其他' ? 'selected' : ''}>其他</option>
                    </select>
                </div>
                <div class="form-row">
                    <label>描述</label>
                    <textarea id="edit-desc" onchange="ActionLibEditor.onFieldChange()">${def.desc || ''}</textarea>
                </div>
                <div class="form-row">
                    <label>示例</label>
                    <input type="text" id="edit-example" value="${def.example || ''}" placeholder="如: 模拟测距成功(5000,3)" onchange="ActionLibEditor.onFieldChange()">
                </div>
            </div>
            ${paramsHtml}
            ${compositeHtml}
            <div class="form-section">
                <h4>⚙️ 选项</h4>
                <div class="form-row">
                    <label>复合动作</label>
                    <input type="checkbox" id="edit-composite" ${def.isComposite ? 'checked' : ''} onchange="ActionLibEditor.toggleComposite()">
                    <span class="hint">勾选后可添加子动作序列</span>
                </div>
            </div>
        `;
    },

    // 渲染期望编辑表单
    renderExpectForm(name) {
        const def = UITestLib.expects[name];
        if (!def) return '<div>未找到期望定义</div>';
        
        let paramsHtml = '';
        if (def.params && def.params.length > 0) {
            paramsHtml = `
                <div class="form-section">
                    <h4>📋 参数定义</h4>
                    <div class="params-list">
                        ${def.params.map((p, i) => `
                            <div class="param-row">
                                <input type="text" value="${p.name}" placeholder="参数名">
                                <select>
                                    <option value="number" ${p.type === 'number' ? 'selected' : ''}>数字</option>
                                    <option value="string" ${p.type === 'string' ? 'selected' : ''}>字符串</option>
                                    <option value="preset" ${p.type === 'preset' ? 'selected' : ''}>预设</option>
                                </select>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        
        // LCD元素绑定显示
        let lcdBindingHtml = '';
        if (def.lcdElements || def.lcdOff) {
            const onElements = def.lcdElements || [];
            const offElements = def.lcdOff || [];
            lcdBindingHtml = `
                <div class="form-section">
                    <h4>🖥️ LCD元素绑定</h4>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
                        此期望关联的LCD元素，用于可视化验证
                    </div>
                    ${onElements.length > 0 ? `
                        <div style="margin-bottom:8px;">
                            <div style="font-size:11px;color:#4caf50;margin-bottom:4px;">✅ 应亮起 (${onElements.length}个)</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px;">
                                ${onElements.map(e => `
                                    <span style="padding:2px 6px;background:rgba(76,175,80,0.2);border-radius:3px;font-size:10px;">${e}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${offElements.length > 0 ? `
                        <div>
                            <div style="font-size:11px;color:#f44336;margin-bottom:4px;">❌ 应熄灭 (${offElements.length}个)</div>
                            <div style="display:flex;flex-wrap:wrap;gap:4px;">
                                ${offElements.map(e => `
                                    <span style="padding:2px 6px;background:rgba(244,67,54,0.2);border-radius:3px;font-size:10px;">${e}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <button class="btn" style="margin-top:8px;font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.previewExpectLcd('${name}')">
                        👁️ 预览LCD效果
                    </button>
                </div>
            `;
        }
        
        // 类型显示
        const typeLabels = {
            'lcd_line': '数字行显示',
            'lcd_text': '固定文本',
            'lcd_icon': '图标状态',
            'lcd_preset': '界面预设'
        };
        const typeLabel = def.type ? typeLabels[def.type] || def.type : '固件字段';
        
        return `
            <div class="form-section">
                <h4>📝 基本信息</h4>
                <div class="form-row">
                    <label>名称</label>
                    <input type="text" id="edit-name" value="${name}" onchange="ActionLibEditor.onFieldChange()">
                </div>
                <div class="form-row">
                    <label>类型</label>
                    <span style="padding:4px 8px;background:var(--bg-tertiary);border-radius:4px;font-size:12px;">${typeLabel}</span>
                </div>
                ${def.field ? `
                <div class="form-row">
                    <label>字段</label>
                    <select id="edit-field" onchange="ActionLibEditor.onFieldChange()">
                        <option value="laser" ${def.field === 'laser' ? 'selected' : ''}>laser (激光)</option>
                        <option value="line4" ${def.field === 'line4' ? 'selected' : ''}>line4 (第4行)</option>
                        <option value="line3" ${def.field === 'line3' ? 'selected' : ''}>line3 (第3行)</option>
                        <option value="line2" ${def.field === 'line2' ? 'selected' : ''}>line2 (第2行)</option>
                        <option value="line1" ${def.field === 'line1' ? 'selected' : ''}>line1 (第1行)</option>
                        <option value="runstep" ${def.field === 'runstep' ? 'selected' : ''}>runstep (步骤)</option>
                        <option value="mode" ${def.field === 'mode' ? 'selected' : ''}>mode (模式)</option>
                        <option value="unit" ${def.field === 'unit' ? 'selected' : ''}>unit (单位)</option>
                        <option value="base" ${def.field === 'base' ? 'selected' : ''}>base (基准)</option>
                        <option value="state" ${def.field === 'state' ? 'selected' : ''}>state (状态)</option>
                        <option value="tolerance" ${def.field === 'tolerance' ? 'selected' : ''}>tolerance (容差)</option>
                    </select>
                </div>
                ` : ''}
                ${def.value !== undefined || def.field ? `
                <div class="form-row">
                    <label>期望值</label>
                    <input type="text" id="edit-value" value="${def.value !== undefined ? def.value : ''}" placeholder="留空表示需要参数" onchange="ActionLibEditor.onFieldChange()">
                </div>
                ` : ''}
                ${def.check || def.field ? `
                <div class="form-row">
                    <label>检查方式</label>
                    <select id="edit-check" onchange="ActionLibEditor.onFieldChange()">
                        <option value="" ${!def.check ? 'selected' : ''}>精确匹配</option>
                        <option value="odd" ${def.check === 'odd' ? 'selected' : ''}>奇数</option>
                        <option value="even" ${def.check === 'even' ? 'selected' : ''}>偶数</option>
                        <option value="gt" ${def.check === 'gt' ? 'selected' : ''}>大于</option>
                        <option value="lt" ${def.check === 'lt' ? 'selected' : ''}>小于</option>
                        <option value="contains" ${def.check === 'contains' ? 'selected' : ''}>包含</option>
                    </select>
                </div>
                ` : ''}
                <div class="form-row">
                    <label>分类</label>
                    <select id="edit-category" onchange="ActionLibEditor.onFieldChange()">
                        <option value="状态" ${def.category === '状态' ? 'selected' : ''}>状态</option>
                        <option value="数字" ${def.category === '数字' ? 'selected' : ''}>数字</option>
                        <option value="模式" ${def.category === '模式' ? 'selected' : ''}>模式</option>
                        <option value="单位" ${def.category === '单位' ? 'selected' : ''}>单位</option>
                        <option value="基准" ${def.category === '基准' ? 'selected' : ''}>基准</option>
                        <option value="图标" ${def.category === '图标' ? 'selected' : ''}>图标</option>
                        <option value="界面" ${def.category === '界面' ? 'selected' : ''}>界面</option>
                        <option value="其他" ${!def.category || def.category === '其他' ? 'selected' : ''}>其他</option>
                    </select>
                </div>
                <div class="form-row">
                    <label>描述</label>
                    <textarea id="edit-desc" onchange="ActionLibEditor.onFieldChange()">${def.desc || ''}</textarea>
                </div>
                <div class="form-row">
                    <label>示例</label>
                    <input type="text" id="edit-example" value="${def.example || ''}" placeholder="如: 第4行显示(5.068)" onchange="ActionLibEditor.onFieldChange()">
                </div>
            </div>
            ${paramsHtml}
            ${lcdBindingHtml}
        `;
    },
    
    // 预览期望的LCD效果
    previewExpectLcd(expectName) {
        const def = UITestLib.expects[expectName];
        if (!def) return;
        
        if (!this.lcdConfig || !this.lcdConfig.elements) {
            alert('未加载LCD配置，请先在段码编辑器中配置LCD元素');
            return;
        }
        
        // 切换到界面预设tab并显示预览
        this.switchTab('screens');
        
        // 设置选中的元素
        this.screenSelectedElements.clear();
        if (def.lcdElements) {
            def.lcdElements.forEach(e => this.screenSelectedElements.add(e));
        }
        
        // 渲染画布
        this.renderScreenCanvas();
        
        // 显示提示
        const lcdSection = document.getElementById('lcd-preview-section');
        if (lcdSection) {
            const infoDiv = lcdSection.querySelector('.preview-info') || document.createElement('div');
            infoDiv.className = 'preview-info';
            infoDiv.style.cssText = 'padding:8px;background:rgba(33,150,243,0.1);border-radius:4px;margin-bottom:8px;font-size:11px;';
            infoDiv.innerHTML = `
                <b>预览期望:</b> ${expectName}<br>
                <span style="color:#4caf50;">✅ 亮起: ${(def.lcdElements || []).length}个</span>
                ${def.lcdOff ? `<span style="color:#f44336;margin-left:8px;">❌ 熄灭: ${def.lcdOff.length}个</span>` : ''}
            `;
            if (!lcdSection.querySelector('.preview-info')) {
                lcdSection.insertBefore(infoDiv, lcdSection.firstChild);
            }
        }
    },

    // 渲染模板编辑表单
    renderTemplateForm(name) {
        const def = UITestLib.templates[name];
        if (!def) return '<div>未找到模板定义</div>';
        
        return `
            <div class="form-section">
                <h4>📝 基本信息</h4>
                <div class="form-row">
                    <label>名称</label>
                    <input type="text" id="edit-name" value="${name}" onchange="ActionLibEditor.onFieldChange()">
                </div>
                <div class="form-row">
                    <label>描述</label>
                    <textarea id="edit-desc" onchange="ActionLibEditor.onFieldChange()">${def.desc || ''}</textarea>
                </div>
            </div>
            <div class="form-section">
                <h4>📋 步骤列表 (${def.steps.length}步)</h4>
                <div class="composite-actions" id="template-steps">
                    ${def.steps.map((step, i) => `
                        <div class="composite-row" style="flex-wrap:wrap;">
                            <span class="step-num">${i + 1}</span>
                            <input type="text" value="${step.action}" placeholder="动作" style="flex:1;min-width:150px;" data-field="action" data-idx="${i}">
                            <input type="text" value="${step.expects.join(', ')}" placeholder="期望(逗号分隔)" style="flex:2;min-width:200px;" data-field="expects" data-idx="${i}">
                            <button class="btn-remove" onclick="ActionLibEditor.removeTemplateStep(${i})">×</button>
                        </div>
                    `).join('')}
                </div>
                <button class="btn-add-param" onclick="ActionLibEditor.addTemplateStep()">+ 添加步骤</button>
            </div>
        `;
    },
    
    // 清空编辑表单
    clearEditForm() {
        const container = document.getElementById('edit-content');
        const titleEl = document.getElementById('edit-title');
        const badgeEl = document.getElementById('edit-type-badge');
        
        if (container) {
            container.innerHTML = `
                <div style="text-align:center;padding:60px;color:var(--text-muted);">
                    <div style="font-size:48px;margin-bottom:16px;">📝</div>
                    <div>从左侧选择一个动作或期望进行编辑</div>
                    <div style="margin-top:8px;font-size:12px;">或点击"新建"创建新的定义</div>
                </div>
            `;
        }
        if (titleEl) titleEl.textContent = '选择一个项目进行编辑';
        if (badgeEl) badgeEl.style.display = 'none';
        
        this.updatePreview();
    },
    
    // 更新JSON预览
    updatePreview() {
        const previewEl = document.getElementById('preview-code');
        if (!previewEl) return;
        
        if (!this.selectedItem || !this.selectedType) {
            previewEl.textContent = '// 选择项目后显示JSON';
            return;
        }
        
        let data;
        if (this.selectedType === 'action') {
            data = UITestLib.actions[this.selectedItem];
        } else if (this.selectedType === 'expect') {
            data = UITestLib.expects[this.selectedItem];
        } else if (this.selectedType === 'template') {
            data = UITestLib.templates[this.selectedItem];
        } else if (this.selectedType === 'screen') {
            // 界面预设：显示当前选中的元素
            data = {
                name: this.selectedItem,
                ...this.screenPresets[this.selectedItem],
                elements: Array.from(this.screenSelectedElements)
            };
        }
        
        previewEl.textContent = JSON.stringify(data, null, 2);
    },

    // 渲染帮助项
    renderHelpItems() {
        const container = document.getElementById('help-items');
        if (!container) return;
        
        const helpItems = [
            { title: '按键动作', example: 'K1短按, K2长按, K3超长按' },
            { title: '模拟测距', example: '模拟测距成功(5000,3)' },
            { title: '设置单位', example: '设置单位(0) // 0米1英尺2英寸' },
            { title: '期望显示', example: '第4行显示(5.068)' },
            { title: '状态检查', example: '步骤奇数, 激光开, 模式单次' },
            { title: '等待延时', example: '等待(300) // 毫秒' },
        ];
        
        container.innerHTML = helpItems.map(item => `
            <div class="help-item" onclick="ActionLibEditor.insertHelp('${item.example.split(',')[0]}')">
                <div class="title">${item.title}</div>
                <div class="example">${item.example}</div>
            </div>
        `).join('');
    },
    
    // 插入帮助文本
    insertHelp(text) {
        const testInput = document.getElementById('test-input');
        if (testInput) {
            testInput.value = text;
            this.testParse();
        }
    },
    
    // 测试解析
    testParse() {
        const input = document.getElementById('test-input');
        const result = document.getElementById('test-result');
        if (!input || !result) return;
        
        const text = input.value.trim();
        if (!text) {
            result.className = 'result';
            result.textContent = '请输入测试字符串';
            return;
        }
        
        // 尝试解析为动作
        const actionResult = UITestLib.parseAction(text);
        if (actionResult) {
            result.className = 'result success';
            result.innerHTML = `<b>✅ 动作解析成功</b><br>命令: ${actionResult.cmd}<br>参数: ${JSON.stringify(actionResult.param)}`;
            return;
        }
        
        // 尝试解析为期望
        const expectResult = UITestLib.parseExpect(text);
        if (expectResult) {
            result.className = 'result success';
            result.innerHTML = `<b>✅ 期望解析成功</b><br>字段: ${expectResult.field}<br>值: ${expectResult.value}${expectResult.check ? '<br>检查: ' + expectResult.check : ''}`;
            return;
        }
        
        result.className = 'result error';
        result.textContent = '❌ 无法解析，请检查格式';
    },
    
    // 字段变更处理
    onFieldChange() {
        this.updatePreview();
        // TODO: 实时更新UITestLib中的数据
    },

    // 新建项目
    addNew() {
        const type = this.currentTab === 'actions' ? 'action' : 
                     this.currentTab === 'expects' ? 'expect' : 
                     this.currentTab === 'templates' ? 'template' : 'screen';
        
        const typeNames = {
            'action': '动作',
            'expect': '期望',
            'template': '模板',
            'screen': '界面预设'
        };
        
        const name = prompt(`请输入新${typeNames[type]}名称:`);
        if (!name) return;
        
        if (type === 'action') {
            if (UITestLib.actions[name]) {
                alert('动作已存在');
                return;
            }
            UITestLib.actions[name] = {
                cmd: 'new_cmd',
                desc: '新动作描述',
                category: '其他'
            };
        } else if (type === 'expect') {
            if (UITestLib.expects[name]) {
                alert('期望已存在');
                return;
            }
            UITestLib.expects[name] = {
                field: 'line4',
                desc: '新期望描述'
            };
        } else if (type === 'template') {
            if (UITestLib.templates[name]) {
                alert('模板已存在');
                return;
            }
            UITestLib.templates[name] = {
                desc: '新模板描述',
                steps: []
            };
        } else if (type === 'screen') {
            if (this.screenPresets[name]) {
                alert('界面预设已存在');
                return;
            }
            this.screenPresets[name] = {
                category: '其他',
                desc: '新界面预设',
                elements: [],
                lastModified: new Date().toISOString()
            };
            this.screenSelectedElements.clear();
        }
        
        this.renderList();
        this.selectItem(type, name);
    },
    
    // 添加参数
    addParam() {
        if (!this.selectedItem || this.selectedType !== 'action') return;
        
        const def = UITestLib.actions[this.selectedItem];
        if (!def.params) def.params = [];
        
        def.params.push({
            name: '参数' + (def.params.length + 1),
            key: 'param' + (def.params.length + 1),
            type: 'number',
            default: 0
        });
        
        this.renderEditForm('action', this.selectedItem);
        this.updatePreview();
    },
    
    // 移除参数
    removeParam(idx) {
        if (!this.selectedItem || this.selectedType !== 'action') return;
        
        const def = UITestLib.actions[this.selectedItem];
        if (def.params) {
            def.params.splice(idx, 1);
            this.renderEditForm('action', this.selectedItem);
            this.updatePreview();
        }
    },
    
    // 添加子动作
    addSubAction() {
        if (!this.selectedItem || this.selectedType !== 'action') return;
        
        const def = UITestLib.actions[this.selectedItem];
        if (!def.subActions) def.subActions = [];
        
        def.subActions.push({ cmd: 'key_clear', delay: 100 });
        
        this.renderEditForm('action', this.selectedItem);
        this.updatePreview();
    },
    
    // 移除子动作
    removeSubAction(idx) {
        if (!this.selectedItem || this.selectedType !== 'action') return;
        
        const def = UITestLib.actions[this.selectedItem];
        if (def.subActions) {
            def.subActions.splice(idx, 1);
            this.renderEditForm('action', this.selectedItem);
            this.updatePreview();
        }
    },

    // 切换复合动作
    toggleComposite() {
        if (!this.selectedItem || this.selectedType !== 'action') return;
        
        const def = UITestLib.actions[this.selectedItem];
        const checkbox = document.getElementById('edit-composite');
        
        def.isComposite = checkbox.checked;
        if (def.isComposite && !def.subActions) {
            def.subActions = [];
        }
        
        this.renderEditForm('action', this.selectedItem);
        this.updatePreview();
    },
    
    // 添加模板步骤
    addTemplateStep() {
        if (!this.selectedItem || this.selectedType !== 'template') return;
        
        const def = UITestLib.templates[this.selectedItem];
        def.steps.push({ action: 'K1短按', expects: ['激光开'] });
        
        this.renderEditForm('template', this.selectedItem);
        this.updatePreview();
    },
    
    // 移除模板步骤
    removeTemplateStep(idx) {
        if (!this.selectedItem || this.selectedType !== 'template') return;
        
        const def = UITestLib.templates[this.selectedItem];
        def.steps.splice(idx, 1);
        
        this.renderEditForm('template', this.selectedItem);
        this.updatePreview();
    },
    
    // 导入库
    importLib() {
        document.getElementById('lib-import-input').click();
    },
    
    // 处理导入文件
    onImportSelected(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.actions) {
                    Object.assign(UITestLib.actions, data.actions);
                }
                if (data.expects) {
                    Object.assign(UITestLib.expects, data.expects);
                }
                if (data.templates) {
                    Object.assign(UITestLib.templates, data.templates);
                }
                
                this.renderList();
                alert('导入成功！');
            } catch (err) {
                alert('导入失败: ' + err.message);
            }
        };
        reader.readAsText(file);
        
        // 清空input以便重复选择同一文件
        event.target.value = '';
    },
    
    // 导出库
    exportLib() {
        const deviceName = this.currentDevice || 'default';
        const data = {
            device: deviceName,
            actions: UITestLib.actions,
            expects: UITestLib.expects,
            templates: UITestLib.templates,
            exportTime: new Date().toISOString(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `ui_test_lib_${deviceName}_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
    },
    
    // 保存到设备配置
    async saveToDevice() {
        if (!this.currentDevice) {
            alert('请先选择设备');
            return;
        }
        
        const success = await this.saveActionsData();
        if (success) {
            alert('动作库已保存到设备配置');
        } else {
            alert('保存失败，请检查控制台');
        }
    },
    
    // ========== 界面预设相关方法 ==========
    
    // 渲染界面预设编辑表单
    renderScreenForm(name) {
        const preset = this.screenPresets[name];
        if (!preset) return '<div>未找到界面预设</div>';
        
        const elemCount = preset.elements ? preset.elements.length : 0;
        
        return `
            <div class="form-section">
                <h4>📝 基本信息</h4>
                <div class="form-row">
                    <label>名称</label>
                    <input type="text" id="edit-screen-name" value="${name}" onchange="ActionLibEditor.onScreenFieldChange()">
                </div>
                <div class="form-row">
                    <label>分类</label>
                    <select id="edit-screen-category" onchange="ActionLibEditor.onScreenFieldChange()">
                        <option value="单次模式" ${preset.category === '单次模式' ? 'selected' : ''}>单次模式</option>
                        <option value="连续模式" ${preset.category === '连续模式' ? 'selected' : ''}>连续模式</option>
                        <option value="面积模式" ${preset.category === '面积模式' ? 'selected' : ''}>面积模式</option>
                        <option value="体积模式" ${preset.category === '体积模式' ? 'selected' : ''}>体积模式</option>
                        <option value="勾股模式" ${preset.category === '勾股模式' ? 'selected' : ''}>勾股模式</option>
                        <option value="设置界面" ${preset.category === '设置界面' ? 'selected' : ''}>设置界面</option>
                        <option value="错误界面" ${preset.category === '错误界面' ? 'selected' : ''}>错误界面</option>
                        <option value="其他" ${!preset.category || preset.category === '其他' ? 'selected' : ''}>其他</option>
                    </select>
                </div>
                <div class="form-row">
                    <label>描述</label>
                    <textarea id="edit-screen-desc" onchange="ActionLibEditor.onScreenFieldChange()">${preset.desc || ''}</textarea>
                </div>
            </div>
            <div class="form-section">
                <h4>🖥️ LCD元素 (${elemCount}个)</h4>
                <div style="margin-bottom:12px;font-size:11px;color:var(--text-muted);">
                    在右侧画布点击元素切换选中状态，按H显示/隐藏标签
                </div>
                <div class="form-row" style="flex-wrap:wrap;gap:4px;">
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('line4')">第4行</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('line3')">第3行</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('line2')">第2行</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('line1')">第1行</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('allDigits')">全部数字</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('icons')">图标</button>
                    <button class="btn" style="font-size:11px;padding:4px 8px;" onclick="ActionLibEditor.selectPresetGroup('units')">单位</button>
                </div>
                <div id="screen-elements-list" style="max-height:200px;overflow-y:auto;margin-top:8px;">
                    ${this.renderScreenElementsList()}
                </div>
            </div>
            <div class="form-section">
                <h4>⚙️ 操作</h4>
                <div class="form-row">
                    <button class="btn primary" style="flex:1" onclick="ActionLibEditor.saveScreenPreset()">💾 保存预设</button>
                    <button class="btn danger" style="flex:1" onclick="ActionLibEditor.deleteScreenPreset()">🗑️ 删除</button>
                </div>
            </div>
        `;
    },
    
    // 渲染已选元素列表
    renderScreenElementsList() {
        if (this.screenSelectedElements.size === 0) {
            return '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:12px;">未选择任何元素</div>';
        }
        
        const elements = Array.from(this.screenSelectedElements).sort();
        return elements.map(name => `
            <div style="display:inline-block;padding:3px 8px;margin:2px;background:rgba(33,150,243,0.2);border-radius:4px;font-size:11px;">
                ${name}
                <span style="cursor:pointer;margin-left:4px;opacity:0.6;" onclick="ActionLibEditor.removeScreenElement('${name}')">×</span>
            </div>
        `).join('');
    },
    
    // 渲染LCD画布
    renderScreenCanvas() {
        const canvas = document.getElementById('screen-preview-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        // 清空
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
        
        // 检查LCD配置是否已加载
        if (!this.lcdConfig || !this.lcdConfig.elements || this.lcdConfig.elements.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('未加载LCD配置', w / 2, h / 2);
            ctx.font = '10px Arial';
            ctx.fillText('请先在段码编辑器中配置', w / 2, h / 2 + 16);
            return;
        }
        
        // 计算缩放
        const imgW = this.lcdConfig.imageWidth || 400;
        const imgH = this.lcdConfig.imageHeight || 200;
        const scale = Math.min(w / imgW, h / imgH) * 0.95;
        const offsetX = (w - imgW * scale) / 2;
        const offsetY = (h - imgH * scale) / 2;
        
        // 绘制背景图
        if (this.lcdImage) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(this.lcdImage, offsetX, offsetY, imgW * scale, imgH * scale);
            ctx.globalAlpha = 1;
        }
        
        // 绘制元素
        const pixelSize = Math.max(1, scale);
        for (const elem of this.lcdConfig.elements) {
            const isSelected = this.screenSelectedElements.has(elem.name);
            
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                ctx.fillStyle = isSelected ? '#00ff88' : 'rgba(60, 80, 60, 0.5)';
                
                for (const pkey of seg.pixelMask) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(
                        offsetX + px * scale,
                        offsetY + py * scale,
                        pixelSize,
                        pixelSize
                    );
                }
            }
        }
        
        // 显示标签
        if (this.showLabels) {
            ctx.font = 'bold 8px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            for (const elem of this.lcdConfig.elements) {
                if (elem.segments.length === 0) continue;
                
                let sumX = 0, sumY = 0, count = 0;
                for (const seg of elem.segments) {
                    if (!seg.pixelMask) continue;
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        sumX += px;
                        sumY += py;
                        count++;
                    }
                }
                
                if (count > 0) {
                    const cx = offsetX + (sumX / count) * scale;
                    const cy = offsetY + (sumY / count) * scale;
                    const isSelected = this.screenSelectedElements.has(elem.name);
                    
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    const metrics = ctx.measureText(elem.name);
                    ctx.fillRect(cx - metrics.width/2 - 2, cy - 5, metrics.width + 4, 10);
                    
                    ctx.fillStyle = isSelected ? '#00ff88' : '#aaa';
                    ctx.fillText(elem.name, cx, cy);
                }
            }
        }
        
        // 显示选中数量
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(w - 55, 5, 50, 16);
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`${this.screenSelectedElements.size} 选中`, w - 8, 15);
        
        // 绑定点击事件
        if (!canvas._bindClick) {
            canvas.addEventListener('click', (e) => this.onScreenCanvasClick(e));
            canvas._bindClick = true;
        }
    },
    
    // 画布点击
    onScreenCanvasClick(e) {
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        const canvas = document.getElementById('screen-preview-canvas');
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const imgW = this.lcdConfig.imageWidth || 400;
        const imgH = this.lcdConfig.imageHeight || 200;
        const scale = Math.min(canvas.width / imgW, canvas.height / imgH) * 0.95;
        const offsetX = (canvas.width - imgW * scale) / 2;
        const offsetY = (canvas.height - imgH * scale) / 2;
        
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        const x = Math.floor((canvasX - offsetX) / scale);
        const y = Math.floor((canvasY - offsetY) / scale);
        
        // 查找点击的元素
        for (const elem of this.lcdConfig.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                if (seg.pixelMask.has(`${x},${y}`)) {
                    // 切换选中状态
                    if (this.screenSelectedElements.has(elem.name)) {
                        this.screenSelectedElements.delete(elem.name);
                    } else {
                        this.screenSelectedElements.add(elem.name);
                    }
                    this.renderScreenCanvas();
                    this.updateScreenElementsList();
                    this.updatePreview();
                    return;
                }
            }
        }
    },
    
    // 更新元素列表显示
    updateScreenElementsList() {
        const container = document.getElementById('screen-elements-list');
        if (container) {
            container.innerHTML = this.renderScreenElementsList();
        }
    },
    
    // 移除单个元素
    removeScreenElement(name) {
        this.screenSelectedElements.delete(name);
        this.renderScreenCanvas();
        this.updateScreenElementsList();
        this.updatePreview();
    },
    
    // 清空选择
    clearScreenSelection() {
        this.screenSelectedElements.clear();
        this.renderScreenCanvas();
        this.updateScreenElementsList();
        this.updatePreview();
    },
    
    // 选择预设组
    selectPresetGroup(group) {
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        const patterns = {
            'line4': /^Line4_/i,
            'line3': /^Line3_/i,
            'line2': /^Line2_/i,
            'line1': /^Line1_/i,
            'allDigits': /^Line\d_D\d/i,
            'icons': /^(Battery|WiFi|Signal|Beep|Base|Mode|MAX|MIN)/i,
            'units': /Unit/i,
        };
        
        const pattern = patterns[group];
        if (!pattern) return;
        
        const matchedElements = this.lcdConfig.elements.filter(e => pattern.test(e.name));
        const allSelected = matchedElements.every(e => this.screenSelectedElements.has(e.name));
        
        if (allSelected) {
            matchedElements.forEach(e => this.screenSelectedElements.delete(e.name));
        } else {
            matchedElements.forEach(e => this.screenSelectedElements.add(e.name));
        }
        
        this.renderScreenCanvas();
        this.updateScreenElementsList();
        this.updatePreview();
    },
    
    // 从固件同步
    async syncFromFirmware() {
        if (!this.lcdConfig || !this.lcdConfig.elements) {
            alert('未加载LCD配置，请先在段码编辑器中配置LCD元素');
            return;
        }
        
        try {
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_dump', params: [] })
            });
            const result = await response.json();
            
            if (!result.success || !result.buffer) {
                alert('读取固件LCD失败: ' + (result.error || '未连接设备'));
                return;
            }
            
            const buffer = new Uint8Array(result.buffer);
            const comBitMap = { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 0 };
            
            this.screenSelectedElements.clear();
            
            for (const elem of this.lcdConfig.elements) {
                let anyLit = false;
                for (const seg of elem.segments) {
                    const segIdx = parseInt(seg.seg);
                    const comIdx = parseInt(seg.com);
                    if (isNaN(segIdx) || isNaN(comIdx)) continue;
                    if (segIdx < 0 || segIdx >= 54) continue;
                    if (comIdx < 0 || comIdx > 7) continue;
                    
                    const byte = buffer[segIdx];
                    const bit = comBitMap[comIdx];
                    if ((byte & (1 << bit)) !== 0) {
                        anyLit = true;
                        break;
                    }
                }
                if (anyLit) {
                    this.screenSelectedElements.add(elem.name);
                }
            }
            
            this.renderScreenCanvas();
            this.updateScreenElementsList();
            this.updatePreview();
            alert(`已同步固件状态，选中 ${this.screenSelectedElements.size} 个元素`);
            
        } catch (err) {
            alert('同步失败: ' + err.message);
        }
    },
    
    // 界面预设字段变更
    onScreenFieldChange() {
        // 实时更新预览
        this.updatePreview();
    },
    
    // 保存界面预设
    saveScreenPreset() {
        const nameInput = document.getElementById('edit-screen-name');
        const categorySelect = document.getElementById('edit-screen-category');
        const descInput = document.getElementById('edit-screen-desc');
        
        if (!nameInput) return;
        
        const newName = nameInput.value.trim();
        if (!newName) {
            alert('请输入预设名称');
            return;
        }
        
        // 如果改名了，删除旧的
        if (this.selectedItem && this.selectedItem !== newName) {
            delete this.screenPresets[this.selectedItem];
        }
        
        // 保存新的
        this.screenPresets[newName] = {
            category: categorySelect ? categorySelect.value : '其他',
            desc: descInput ? descInput.value : '',
            elements: Array.from(this.screenSelectedElements),
            lastModified: new Date().toISOString()
        };
        
        this.selectedItem = newName;
        this.renderList();
        this.updatePreview();
        alert('界面预设已保存（需点击"保存"按钮同步到设备）');
    },
    
    // 删除界面预设
    deleteScreenPreset() {
        if (!this.selectedItem) return;
        
        if (!confirm(`确定删除界面预设 "${this.selectedItem}"？`)) return;
        
        delete this.screenPresets[this.selectedItem];
        this.selectedItem = null;
        this.selectedType = null;
        this.screenSelectedElements.clear();
        
        this.renderList();
        this.clearEditForm();
        this.renderScreenCanvas();
    },
};

console.log('[ActionLibEditor] 模块已加载');
