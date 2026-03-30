/**
 * 流程编辑器 - 管理测量模式和流程动作
 * 
 * 功能:
 * - 可视化编辑 modes.json (测量模式配置)
 * - 管理 flow:xxx 动作
 * - 流程图预览和交互
 * - 步骤详细编辑
 * - 计算公式编辑器
 */

window.FlowEditor = {
    currentTab: 'modes',
    selectedItem: null,
    selectedType: null,
    selectedStepIndex: -1,  // 当前选中的步骤索引
    currentDevice: null,
    modesConfig: null,
    isDirty: false,  // 是否有未保存的修改
    
    // 画布状态
    canvas: null,
    ctx: null,
    zoom: 1,
    panX: 50,
    panY: 30,
    
    // 画布节点位置（用于点击检测）
    nodePositions: [],
    hoveredNode: null,
    
    // 数据类型选项
    DATA_TYPES: [
        { value: 'length', label: '长度 (length)', icon: '📏' },
        { value: 'area', label: '面积 (area)', icon: '📐' },
        { value: 'volume', label: '体积 (volume)', icon: '📦' },
    ],
    
    // 存储位置选项
    STORE_OPTIONS: [
        { value: 'line1', label: 'Line1 (历史3)' },
        { value: 'line2', label: 'Line2 (历史2)' },
        { value: 'line3', label: 'Line3 (历史1)' },
        { value: 'line4', label: 'Line4 (当前)' },
    ],
    
    // 内置流程动作定义
    flowActions: {
        'setMode': {
            name: '设置模式',
            desc: '切换到指定测量模式',
            params: ['mode'],
            template: 'flow:setMode:{mode}',
            category: '模式控制'
        },
        'nextMode': {
            name: '下一模式',
            desc: '循环切换到下一个测量模式',
            params: [],
            template: 'flow:nextMode',
            category: '模式控制'
        },
        'onMeasureOk': {
            name: '测量成功',
            desc: '处理测量成功事件，自动存储和计算',
            params: ['distance'],
            template: 'flow:onMeasureOk:${distance}',
            category: '测量事件'
        },
        'onMeasureFail': {
            name: '测量失败',
            desc: '处理测量失败事件',
            params: ['errorCode'],
            template: 'flow:onMeasureFail:{errorCode}',
            category: '测量事件'
        },
        'undo': {
            name: '撤回',
            desc: '撤回到上一步状态',
            params: [],
            template: 'flow:undo',
            category: '历史操作'
        },
        'scrollUp': {
            name: '数据上移',
            desc: 'line1←line2←line3←line4',
            params: [],
            template: 'flow:scrollUp',
            category: '数据操作'
        },
        'scrollDown': {
            name: '数据下移',
            desc: 'line4←line3←line2←line1',
            params: [],
            template: 'flow:scrollDown',
            category: '数据操作'
        },
        'clearCurrent': {
            name: '清除当前行',
            desc: '清除line4数据',
            params: [],
            template: 'flow:clearCurrent',
            category: '数据操作'
        },
        'clearAll': {
            name: '清除全部',
            desc: '清空所有行数据和历史',
            params: [],
            template: 'flow:clearAll',
            category: '数据操作'
        }
    },
    
    // ========== 初始化 ==========
    async init() {
        console.log('[FlowEditor] 初始化');
        
        this.canvas = document.getElementById('flow-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.setupCanvasEvents();
        }
        
        await this.initDeviceManager();
        this.renderList();
        this.resizeCanvas();
        this.setupKeyboardShortcuts();
        
        console.log('[FlowEditor] 初始化完成');
    },
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+S 保存
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.save();
            }
            // Delete 删除选中步骤
            if (e.key === 'Delete' && this.selectedStepIndex >= 0) {
                this.deleteStep(this.selectedItem, this.selectedStepIndex);
            }
            // Escape 取消选择
            if (e.key === 'Escape') {
                this.selectedStepIndex = -1;
                this.renderSteps(this.selectedItem);
            }
        });
    },
    
    async initDeviceManager() {
        if (typeof DeviceConfigManager === 'undefined') {
            console.warn('[FlowEditor] DeviceConfigManager 不可用');
            return;
        }
        
        await DeviceConfigManager.init();
        
        const container = document.getElementById('flow-device-selector');
        if (container && typeof createDeviceSelector === 'function') {
            createDeviceSelector('flow-device-selector', {
                showManage: true,
                onChange: (deviceId) => this.onDeviceChanged(deviceId)
            });
        }
        
        DeviceConfigManager.subscribe('device-changed', (e) => {
            if (e.newDevice !== this.currentDevice) {
                this.onDeviceChanged(e.newDevice);
            }
        });
        
        this.currentDevice = DeviceConfigManager.getCurrentDevice();
        if (this.currentDevice) {
            await this.loadModesConfig();
        }
    },
    
    async onDeviceChanged(deviceId) {
        console.log('[FlowEditor] 设备变更:', deviceId);
        this.currentDevice = deviceId;
        this.selectedItem = null;
        this.selectedType = null;
        this.selectedStepIndex = -1;
        this.isDirty = false;
        
        await this.loadModesConfig();
        this.renderList();
        this.clearProps();
        this.renderCanvas();
    },
    
    async loadModesConfig() {
        if (!this.currentDevice) return;
        
        try {
            const data = await DeviceConfigManager.loadConfig('flow');
            if (data?.modes) {
                this.modesConfig = data;
                console.log('[FlowEditor] 模式配置加载:', Object.keys(data.modes).length, '个模式');
            } else {
                this.modesConfig = this.createDefaultConfig();
            }
        } catch (e) {
            console.warn('[FlowEditor] 加载模式配置失败:', e);
            this.modesConfig = this.createDefaultConfig();
        }
    },
    
    createDefaultConfig() {
        return {
            version: '1.0',
            description: '测量模式配置',
            modes: {
                single: {
                    name: '单次测量',
                    icon: '📏',
                    stepCount: 1,
                    resultType: 'length',
                    steps: [{ step: 1, action: 'measure', store: 'line4', dataType: 'length' }]
                }
            }
        };
    },
    
    async save() {
        if (!this.currentDevice || !this.modesConfig) {
            this.showToast('无法保存：未选择设备', 'error');
            return;
        }
        
        try {
            await DeviceConfigManager.saveConfig('flow', this.modesConfig);
            this.isDirty = false;
            this.showToast('保存成功', 'success');
            this.updateSaveButton();
        } catch (e) {
            this.showToast('保存失败: ' + e.message, 'error');
        }
    },
    
    markDirty() {
        this.isDirty = true;
        this.updateSaveButton();
    },
    
    updateSaveButton() {
        const btn = document.querySelector('.flow-editor-page .btn-primary');
        if (btn) {
            btn.textContent = this.isDirty ? '💾 保存 *' : '💾 保存';
            btn.classList.toggle('btn-warning', this.isDirty);
        }
    },
    
    // ========== Tab切换 ==========
    switchTab(tab) {
        this.currentTab = tab;
        this.selectedItem = null;
        this.selectedType = null;
        this.selectedStepIndex = -1;
        
        document.querySelectorAll('.flow-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        
        this.renderList();
        this.clearProps();
        this.renderCanvas();
    },
    
    // ========== 列表渲染 ==========
    renderList() {
        const container = document.getElementById('flow-list');
        if (!container) return;
        
        if (this.currentTab === 'modes') {
            container.innerHTML = this.renderModesList();
        } else {
            container.innerHTML = this.renderActionsList();
        }
    },
    
    renderModesList() {
        if (!this.modesConfig?.modes) {
            return '<div class="flow-empty-hint"><div class="icon">📐</div><div>暂无模式配置</div></div>';
        }
        
        const modes = Object.entries(this.modesConfig.modes);
        return modes.map(([id, mode]) => {
            const selected = this.selectedItem === id && this.selectedType === 'mode' ? 'selected' : '';
            return `
                <div class="flow-item ${selected}" onclick="FlowEditor.selectMode('${id}')">
                    <div class="name">${mode.icon || '📐'} ${mode.name}</div>
                    <div class="desc">${mode.description || ''}</div>
                    <div class="meta">
                        <span>${mode.stepCount || 1} 步</span>
                        <span>${mode.resultType || 'length'}</span>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    renderActionsList() {
        // 按分类分组
        const categories = {};
        Object.entries(this.flowActions).forEach(([id, action]) => {
            const cat = action.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ id, ...action });
        });
        
        let html = '';
        for (const [cat, actions] of Object.entries(categories)) {
            html += `
                <div class="flow-action-category">
                    <div class="flow-action-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span>📁 ${cat}</span>
                        <span>${actions.length}</span>
                    </div>
                    <div class="flow-action-items">
                        ${actions.map(a => {
                            const selected = this.selectedItem === a.id && this.selectedType === 'action' ? 'selected' : '';
                            return `
                                <div class="flow-action-item ${selected}" onclick="FlowEditor.selectAction('${a.id}')">
                                    <span>${a.name}</span>
                                    <code>${a.template}</code>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        return html;
    },
    
    filterList() {
        const search = document.getElementById('flow-search')?.value?.toLowerCase() || '';
        const items = document.querySelectorAll('.flow-item, .flow-action-item');
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(search) ? '' : 'none';
        });
    },
    
    // ========== 选择项目 ==========
    selectMode(id) {
        this.selectedItem = id;
        this.selectedType = 'mode';
        this.selectedStepIndex = -1;
        
        document.querySelectorAll('.flow-item').forEach(el => el.classList.remove('selected'));
        event?.currentTarget?.classList.add('selected');
        
        this.renderModeProps(id);
        this.renderCanvas();
        this.renderSteps(id);
        this.updatePreview();
    },
    
    selectAction(id) {
        this.selectedItem = id;
        this.selectedType = 'action';
        
        document.querySelectorAll('.flow-action-item').forEach(el => el.classList.remove('selected'));
        event?.currentTarget?.classList.add('selected');
        
        this.renderActionProps(id);
        this.updatePreview();
    },
    
    // ========== 属性面板 ==========
    renderModeProps(id) {
        const mode = this.modesConfig?.modes?.[id];
        if (!mode) return;
        
        const titleEl = document.getElementById('flow-props-title');
        const badgeEl = document.getElementById('flow-props-badge');
        const contentEl = document.getElementById('flow-props-content');
        
        titleEl.textContent = mode.name;
        badgeEl.textContent = '模式';
        badgeEl.style.display = 'inline';
        
        // 生成变量列表（从步骤中提取）
        const variables = (mode.steps || [])
            .filter(s => s.variable)
            .map(s => s.variable);
        
        contentEl.innerHTML = `
            <div class="flow-form-section">
                <h5>📝 基本信息</h5>
                <div class="flow-form-row">
                    <label>ID</label>
                    <input type="text" id="mode-id" value="${id}" disabled>
                </div>
                <div class="flow-form-row">
                    <label>名称</label>
                    <input type="text" id="mode-name" value="${mode.name}" onchange="FlowEditor.onModeChange()">
                </div>
                <div class="flow-form-row">
                    <label>图标</label>
                    <div class="icon-picker">
                        <input type="text" id="mode-icon" value="${mode.icon || ''}" onchange="FlowEditor.onModeChange()">
                        <div class="icon-suggestions">
                            ${['📏', '📐', '📦', '🔄', '📊', '🎯', '⚡', '🔺'].map(i => 
                                `<span onclick="FlowEditor.setIcon('${i}')">${i}</span>`
                            ).join('')}
                        </div>
                    </div>
                </div>
                <div class="flow-form-row">
                    <label>描述</label>
                    <textarea id="mode-desc" onchange="FlowEditor.onModeChange()">${mode.description || ''}</textarea>
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>⚙️ 配置</h5>
                <div class="flow-form-row">
                    <label>步骤数</label>
                    <input type="number" id="mode-steps" value="${mode.stepCount || 0}" min="0" readonly 
                           title="由步骤列表自动计算">
                </div>
                <div class="flow-form-row">
                    <label>结果类型</label>
                    <select id="mode-result" onchange="FlowEditor.onModeChange()">
                        ${this.DATA_TYPES.map(t => 
                            `<option value="${t.value}" ${mode.resultType === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>🔢 计算公式 <span class="hint">(可选)</span></h5>
                <div class="flow-form-row">
                    <label>启用</label>
                    <label class="switch">
                        <input type="checkbox" id="mode-calc-enabled" 
                               ${mode.calculate ? 'checked' : ''} 
                               onchange="FlowEditor.toggleCalculate()">
                        <span class="slider"></span>
                    </label>
                </div>
                <div id="calc-editor" style="display:${mode.calculate ? 'block' : 'none'}">
                    <div class="flow-form-row">
                        <label>公式</label>
                        <input type="text" id="mode-formula" 
                               value="${mode.calculate?.formula || ''}" 
                               placeholder="如: length * width"
                               onchange="FlowEditor.onModeChange()">
                    </div>
                    <div class="flow-form-row">
                        <label>变量</label>
                        <div class="var-tags" id="calc-vars">
                            ${variables.map(v => `<span class="var-tag" onclick="FlowEditor.insertVar('${v}')">${v}</span>`).join('')}
                        </div>
                    </div>
                    <div class="flow-form-row">
                        <label>验证</label>
                        <input type="text" id="mode-validate" 
                               value="${mode.calculate?.validate || ''}" 
                               placeholder="如: hypotenuse > side"
                               onchange="FlowEditor.onModeChange()">
                    </div>
                    <div class="formula-preview">
                        <span class="label">预览:</span>
                        <code id="formula-preview">${this.formatFormula(mode.calculate?.formula, variables)}</code>
                    </div>
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>📤 完成后</h5>
                <div class="flow-form-row">
                    <label>显示位置</label>
                    <select id="mode-complete-display" onchange="FlowEditor.onModeChange()">
                        <option value="">不显示</option>
                        ${this.STORE_OPTIONS.map(o => 
                            `<option value="${o.value}" ${mode.onComplete?.display === o.value ? 'selected' : ''}>${o.label}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            
            <div class="flow-form-section flow-actions-row">
                <button class="btn btn-sm" onclick="FlowEditor.duplicateMode('${id}')">📋 复制模式</button>
                <button class="btn btn-danger btn-sm" onclick="FlowEditor.deleteMode('${id}')">🗑️ 删除</button>
            </div>
        `;
    },
    
    setIcon(icon) {
        const input = document.getElementById('mode-icon');
        if (input) {
            input.value = icon;
            this.onModeChange();
        }
    },
    
    insertVar(varName) {
        const input = document.getElementById('mode-formula');
        if (input) {
            const pos = input.selectionStart;
            const val = input.value;
            input.value = val.slice(0, pos) + varName + val.slice(pos);
            input.focus();
            input.setSelectionRange(pos + varName.length, pos + varName.length);
            this.onModeChange();
        }
    },
    
    toggleCalculate() {
        const enabled = document.getElementById('mode-calc-enabled')?.checked;
        const editor = document.getElementById('calc-editor');
        if (editor) {
            editor.style.display = enabled ? 'block' : 'none';
        }
        
        if (!this.selectedItem) return;
        const mode = this.modesConfig.modes[this.selectedItem];
        
        if (enabled && !mode.calculate) {
            mode.calculate = { formula: '', variables: [], result: mode.resultType };
        } else if (!enabled && mode.calculate) {
            delete mode.calculate;
        }
        
        this.markDirty();
        this.updatePreview();
    },
    
    formatFormula(formula, variables) {
        if (!formula) return '<span class="muted">未设置</span>';
        let result = formula;
        // 高亮变量
        (variables || []).forEach(v => {
            result = result.replace(new RegExp(`\\b${v}\\b`, 'g'), `<span class="var">${v}</span>`);
        });
        // 高亮函数
        result = result.replace(/\b(sqrt|abs|min|max|pow)\b/g, '<span class="func">$1</span>');
        return result;
    },
    
    renderActionProps(id) {
        const action = this.flowActions[id];
        if (!action) return;
        
        const titleEl = document.getElementById('flow-props-title');
        const badgeEl = document.getElementById('flow-props-badge');
        const contentEl = document.getElementById('flow-props-content');
        
        titleEl.textContent = action.name;
        badgeEl.textContent = '动作';
        badgeEl.style.display = 'inline';
        
        contentEl.innerHTML = `
            <div class="flow-form-section">
                <h5>📝 动作信息</h5>
                <div class="flow-form-row">
                    <label>名称</label>
                    <input type="text" value="${action.name}" disabled>
                </div>
                <div class="flow-form-row">
                    <label>分类</label>
                    <input type="text" value="${action.category}" disabled>
                </div>
                <div class="flow-form-row">
                    <label>描述</label>
                    <textarea disabled>${action.desc}</textarea>
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>⚡ 动作格式</h5>
                <div style="padding:8px;background:var(--bg-primary);border-radius:4px;font-family:monospace;font-size:12px;">
                    ${action.template}
                </div>
                ${action.params.length > 0 ? `
                <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">
                    参数: ${action.params.join(', ')}
                </div>
                ` : ''}
            </div>
            
            <div class="flow-form-section">
                <h5>📋 使用示例</h5>
                <div style="font-size:11px;color:var(--text-secondary);">
                    在状态机编辑器中，添加入口/退出/转移动作时选择此动作
                </div>
            </div>
            
            <div class="flow-form-section">
                <button class="btn btn-sm" onclick="FlowEditor.copyAction('${id}')">📋 复制动作</button>
            </div>
        `;
    },
    
    clearProps() {
        const titleEl = document.getElementById('flow-props-title');
        const badgeEl = document.getElementById('flow-props-badge');
        const contentEl = document.getElementById('flow-props-content');
        
        if (titleEl) titleEl.textContent = '属性';
        if (badgeEl) badgeEl.style.display = 'none';
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="flow-empty-hint">
                    <div class="icon">📐</div>
                    <div>选择一个模式或动作</div>
                    <div class="sub">查看和编辑属性</div>
                </div>
            `;
        }
        
        const stepsPanel = document.getElementById('flow-steps-panel');
        if (stepsPanel) stepsPanel.style.display = 'none';
    },
    
    // ========== 步骤编辑 ==========
    renderSteps(modeId) {
        const mode = this.modesConfig?.modes?.[modeId];
        const panel = document.getElementById('flow-steps-panel');
        const list = document.getElementById('flow-steps-list');
        
        if (!mode || !panel || !list) return;
        
        panel.style.display = 'block';
        
        if (!mode.steps || mode.steps.length === 0) {
            list.innerHTML = `
                <div class="flow-empty-steps">
                    <div>暂无步骤</div>
                    <button class="btn btn-sm btn-primary" onclick="FlowEditor.addStep()">+ 添加第一个步骤</button>
                </div>
            `;
            return;
        }
        
        list.innerHTML = mode.steps.map((step, i) => {
            const isSelected = this.selectedStepIndex === i;
            return `
                <div class="flow-step-item ${isSelected ? 'selected' : ''}" 
                     data-idx="${i}" 
                     onclick="FlowEditor.selectStep(${i})"
                     draggable="true"
                     ondragstart="FlowEditor.onStepDragStart(event, ${i})"
                     ondragover="FlowEditor.onStepDragOver(event)"
                     ondrop="FlowEditor.onStepDrop(event, ${i})">
                    <div class="step-drag-handle">⋮⋮</div>
                    <div class="step-num">${step.step || i + 1}</div>
                    <div class="step-info">
                        <div class="step-name">${step.description || '测量'}</div>
                        <div class="step-meta">
                            <span class="tag">${step.store || 'line4'}</span>
                            <span class="tag">${step.dataType || 'length'}</span>
                            ${step.variable ? `<span class="tag var">${step.variable}</span>` : ''}
                            ${step.scrollBefore ? '<span class="tag scroll">↑上移</span>' : ''}
                        </div>
                    </div>
                    <div class="step-actions">
                        <button class="btn btn-xs" onclick="event.stopPropagation();FlowEditor.moveStep('${modeId}', ${i}, -1)" 
                                ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
                        <button class="btn btn-xs" onclick="event.stopPropagation();FlowEditor.moveStep('${modeId}', ${i}, 1)" 
                                ${i === mode.steps.length - 1 ? 'disabled' : ''} title="下移">↓</button>
                        <button class="btn btn-xs btn-danger" onclick="event.stopPropagation();FlowEditor.deleteStep('${modeId}', ${i})" 
                                title="删除">×</button>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    selectStep(idx) {
        this.selectedStepIndex = idx;
        this.renderSteps(this.selectedItem);
        this.renderStepProps(idx);
        this.renderCanvas();
    },
    
    renderStepProps(idx) {
        if (!this.selectedItem || this.selectedType !== 'mode') return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        const step = mode.steps?.[idx];
        if (!step) return;
        
        const contentEl = document.getElementById('flow-props-content');
        const titleEl = document.getElementById('flow-props-title');
        const badgeEl = document.getElementById('flow-props-badge');
        
        titleEl.textContent = `步骤 ${step.step || idx + 1}`;
        badgeEl.textContent = '步骤';
        badgeEl.style.background = '#3b82f6';
        
        contentEl.innerHTML = `
            <div class="flow-form-section">
                <h5>📝 步骤信息</h5>
                <div class="flow-form-row">
                    <label>描述</label>
                    <input type="text" id="step-desc" value="${step.description || ''}" 
                           placeholder="如: 测量长度"
                           onchange="FlowEditor.onStepChange(${idx})">
                </div>
                <div class="flow-form-row">
                    <label>动作</label>
                    <select id="step-action" onchange="FlowEditor.onStepChange(${idx})">
                        <option value="measure" ${step.action === 'measure' ? 'selected' : ''}>测量 (measure)</option>
                        <option value="calculate" ${step.action === 'calculate' ? 'selected' : ''}>计算 (calculate)</option>
                        <option value="display" ${step.action === 'display' ? 'selected' : ''}>显示 (display)</option>
                    </select>
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>💾 数据存储</h5>
                <div class="flow-form-row">
                    <label>存储位置</label>
                    <select id="step-store" onchange="FlowEditor.onStepChange(${idx})">
                        ${this.STORE_OPTIONS.map(o => 
                            `<option value="${o.value}" ${step.store === o.value ? 'selected' : ''}>${o.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="flow-form-row">
                    <label>数据类型</label>
                    <select id="step-datatype" onchange="FlowEditor.onStepChange(${idx})">
                        ${this.DATA_TYPES.map(t => 
                            `<option value="${t.value}" ${step.dataType === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="flow-form-row">
                    <label>变量名</label>
                    <input type="text" id="step-variable" value="${step.variable || ''}" 
                           placeholder="用于计算公式，如: length"
                           onchange="FlowEditor.onStepChange(${idx})">
                </div>
            </div>
            
            <div class="flow-form-section">
                <h5>⚙️ 选项</h5>
                <div class="flow-form-row">
                    <label>测量前上移</label>
                    <label class="switch">
                        <input type="checkbox" id="step-scroll" 
                               ${step.scrollBefore ? 'checked' : ''} 
                               onchange="FlowEditor.onStepChange(${idx})">
                        <span class="slider"></span>
                    </label>
                </div>
                ${step.action === 'measure' ? `
                <div class="flow-form-row">
                    <label>更新MAX</label>
                    <select id="step-updatemax" onchange="FlowEditor.onStepChange(${idx})">
                        <option value="">不更新</option>
                        ${this.STORE_OPTIONS.map(o => 
                            `<option value="${o.value}" ${step.updateMax === o.value ? 'selected' : ''}>${o.label}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="flow-form-row">
                    <label>更新MIN</label>
                    <select id="step-updatemin" onchange="FlowEditor.onStepChange(${idx})">
                        <option value="">不更新</option>
                        ${this.STORE_OPTIONS.map(o => 
                            `<option value="${o.value}" ${step.updateMin === o.value ? 'selected' : ''}>${o.label}</option>`
                        ).join('')}
                    </select>
                </div>
                ` : ''}
            </div>
            
            <div class="flow-form-section">
                <button class="btn btn-sm" onclick="FlowEditor.duplicateStep(${idx})">📋 复制步骤</button>
                <button class="btn btn-sm" onclick="FlowEditor.selectStep(-1);FlowEditor.renderModeProps('${this.selectedItem}')">↩ 返回模式</button>
            </div>
        `;
    },
    
    onStepChange(idx) {
        if (!this.selectedItem) return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        const step = mode.steps[idx];
        if (!step) return;
        
        step.description = document.getElementById('step-desc')?.value || '';
        step.action = document.getElementById('step-action')?.value || 'measure';
        step.store = document.getElementById('step-store')?.value || 'line4';
        step.dataType = document.getElementById('step-datatype')?.value || 'length';
        step.variable = document.getElementById('step-variable')?.value || '';
        step.scrollBefore = document.getElementById('step-scroll')?.checked || false;
        
        const updateMax = document.getElementById('step-updatemax')?.value;
        const updateMin = document.getElementById('step-updatemin')?.value;
        if (updateMax) step.updateMax = updateMax; else delete step.updateMax;
        if (updateMin) step.updateMin = updateMin; else delete step.updateMin;
        
        // 清理空值
        if (!step.variable) delete step.variable;
        if (!step.scrollBefore) delete step.scrollBefore;
        
        this.markDirty();
        this.renderSteps(this.selectedItem);
        this.renderCanvas();
        this.updatePreview();
        this.updateCalcVariables();
    },
    
    updateCalcVariables() {
        // 更新计算公式中的变量列表
        if (!this.selectedItem) return;
        const mode = this.modesConfig.modes[this.selectedItem];
        if (!mode.calculate) return;
        
        const variables = (mode.steps || [])
            .filter(s => s.variable)
            .map(s => s.variable);
        
        mode.calculate.variables = variables;
        
        // 更新UI
        const varsEl = document.getElementById('calc-vars');
        if (varsEl) {
            varsEl.innerHTML = variables.map(v => 
                `<span class="var-tag" onclick="FlowEditor.insertVar('${v}')">${v}</span>`
            ).join('');
        }
    },
    
    addStep() {
        if (!this.selectedItem || this.selectedType !== 'mode') return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        if (!mode.steps) mode.steps = [];
        
        const stepNum = mode.steps.length + 1;
        mode.steps.push({
            step: stepNum,
            action: 'measure',
            store: `line${Math.min(stepNum, 4)}`,
            dataType: 'length',
            description: `测量${stepNum === 1 ? '' : stepNum}`
        });
        
        mode.stepCount = mode.steps.length;
        this.markDirty();
        this.renderSteps(this.selectedItem);
        this.renderModeProps(this.selectedItem);
        this.renderCanvas();
        this.updatePreview();
        
        // 自动选中新步骤
        this.selectStep(mode.steps.length - 1);
    },
    
    duplicateStep(idx) {
        if (!this.selectedItem) return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        const step = mode.steps[idx];
        if (!step) return;
        
        const newStep = JSON.parse(JSON.stringify(step));
        newStep.step = mode.steps.length + 1;
        newStep.description = (newStep.description || '') + ' (副本)';
        
        mode.steps.push(newStep);
        mode.stepCount = mode.steps.length;
        
        this.markDirty();
        this.renderSteps(this.selectedItem);
        this.renderCanvas();
        this.selectStep(mode.steps.length - 1);
    },
    
    moveStep(modeId, idx, direction) {
        const mode = this.modesConfig.modes[modeId];
        const newIdx = idx + direction;
        
        if (newIdx < 0 || newIdx >= mode.steps.length) return;
        
        // 交换
        [mode.steps[idx], mode.steps[newIdx]] = [mode.steps[newIdx], mode.steps[idx]];
        
        // 重新编号
        mode.steps.forEach((s, i) => s.step = i + 1);
        
        this.markDirty();
        this.selectedStepIndex = newIdx;
        this.renderSteps(modeId);
        this.renderCanvas();
    },
    
    // 拖拽排序
    draggedStepIndex: -1,
    
    onStepDragStart(e, idx) {
        this.draggedStepIndex = idx;
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
    },
    
    onStepDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    },
    
    onStepDrop(e, targetIdx) {
        e.preventDefault();
        
        if (this.draggedStepIndex < 0 || this.draggedStepIndex === targetIdx) return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        const [removed] = mode.steps.splice(this.draggedStepIndex, 1);
        mode.steps.splice(targetIdx, 0, removed);
        
        // 重新编号
        mode.steps.forEach((s, i) => s.step = i + 1);
        
        this.draggedStepIndex = -1;
        this.selectedStepIndex = targetIdx;
        this.markDirty();
        this.renderSteps(this.selectedItem);
        this.renderCanvas();
    },
    
    editStep(modeId, idx) {
        // 已改为点击选中
        this.selectStep(idx);
    },
    
    deleteStep(modeId, idx) {
        if (!confirm('确定删除此步骤?')) return;
        
        const mode = this.modesConfig.modes[modeId];
        mode.steps.splice(idx, 1);
        mode.stepCount = mode.steps.length;
        
        // 重新编号
        mode.steps.forEach((s, i) => s.step = i + 1);
        
        this.selectedStepIndex = -1;
        this.markDirty();
        this.renderSteps(modeId);
        this.renderModeProps(modeId);
        this.renderCanvas();
        this.updateCalcVariables();
    },
    
    // ========== 模式操作 ==========
    addMode() {
        const id = prompt('模式ID (英文，如 area, volume):', 'new_mode');
        if (!id) return;
        
        // 验证ID格式
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
            this.showToast('ID格式错误：只能包含小写字母、数字和下划线，且以字母开头', 'error');
            return;
        }
        
        if (this.modesConfig.modes[id]) {
            this.showToast('模式ID已存在', 'error');
            return;
        }
        
        this.modesConfig.modes[id] = {
            name: '新模式',
            icon: '📐',
            stepCount: 1,
            resultType: 'length',
            steps: [{ step: 1, action: 'measure', store: 'line4', dataType: 'length', description: '测量' }]
        };
        
        this.markDirty();
        this.renderList();
        this.selectMode(id);
    },
    
    duplicateMode(id) {
        const mode = this.modesConfig.modes[id];
        if (!mode) return;
        
        let newId = id + '_copy';
        let counter = 1;
        while (this.modesConfig.modes[newId]) {
            newId = `${id}_copy${counter++}`;
        }
        
        this.modesConfig.modes[newId] = JSON.parse(JSON.stringify(mode));
        this.modesConfig.modes[newId].name += ' (副本)';
        
        this.markDirty();
        this.renderList();
        this.selectMode(newId);
        this.showToast('已复制模式', 'success');
    },
    
    deleteMode(id) {
        if (!confirm(`确定删除模式 "${this.modesConfig.modes[id]?.name}"?`)) return;
        
        delete this.modesConfig.modes[id];
        this.selectedItem = null;
        this.selectedType = null;
        this.selectedStepIndex = -1;
        
        this.markDirty();
        this.renderList();
        this.clearProps();
        this.renderCanvas();
    },
    
    onModeChange() {
        if (!this.selectedItem || this.selectedType !== 'mode') return;
        
        const mode = this.modesConfig.modes[this.selectedItem];
        
        mode.name = document.getElementById('mode-name')?.value || mode.name;
        mode.icon = document.getElementById('mode-icon')?.value || '';
        mode.description = document.getElementById('mode-desc')?.value || '';
        mode.resultType = document.getElementById('mode-result')?.value || 'length';
        
        // 计算公式
        const calcEnabled = document.getElementById('mode-calc-enabled')?.checked;
        if (calcEnabled) {
            if (!mode.calculate) mode.calculate = {};
            mode.calculate.formula = document.getElementById('mode-formula')?.value || '';
            mode.calculate.validate = document.getElementById('mode-validate')?.value || '';
            mode.calculate.result = mode.resultType;
            
            // 从步骤中提取变量
            mode.calculate.variables = (mode.steps || [])
                .filter(s => s.variable)
                .map(s => s.variable);
            
            // 清理空值
            if (!mode.calculate.validate) delete mode.calculate.validate;
            
            // 更新公式预览
            const previewEl = document.getElementById('formula-preview');
            if (previewEl) {
                previewEl.innerHTML = this.formatFormula(mode.calculate.formula, mode.calculate.variables);
            }
        } else {
            delete mode.calculate;
        }
        
        // 完成后配置
        const completeDisplay = document.getElementById('mode-complete-display')?.value;
        if (completeDisplay) {
            if (!mode.onComplete) mode.onComplete = {};
            mode.onComplete.display = completeDisplay;
            mode.onComplete.dataType = mode.resultType;
        } else {
            delete mode.onComplete;
        }
        
        // 清理空描述
        if (!mode.description) delete mode.description;
        
        this.markDirty();
        this.renderList();
        this.renderCanvas();
        this.updatePreview();
    },
    
    copyAction(id) {
        const action = this.flowActions[id];
        if (action) {
            navigator.clipboard.writeText(action.template);
            this.showToast('已复制: ' + action.template, 'success');
        }
    },
    
    // ========== 画布渲染 ==========
    setupCanvasEvents() {
        // 缩放
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoom = Math.max(0.5, Math.min(2, this.zoom * factor));
            this.renderCanvas();
        });
        
        // 点击节点
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // 检测点击的节点
            const clickedNode = this.nodePositions.find(node => {
                return x >= node.x && x <= node.x + node.width &&
                       y >= node.y && y <= node.y + node.height;
            });
            
            if (clickedNode) {
                if (clickedNode.type === 'step') {
                    this.selectStep(clickedNode.index);
                } else if (clickedNode.type === 'result') {
                    this.selectedStepIndex = -1;
                    this.renderModeProps(this.selectedItem);
                    this.renderSteps(this.selectedItem);
                }
            }
        });
        
        // 鼠标移动（悬停效果）
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const hoveredNode = this.nodePositions.find(node => {
                return x >= node.x && x <= node.x + node.width &&
                       y >= node.y && y <= node.y + node.height;
            });
            
            if (hoveredNode !== this.hoveredNode) {
                this.hoveredNode = hoveredNode;
                this.canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
                this.renderCanvas();
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            if (this.hoveredNode) {
                this.hoveredNode = null;
                this.renderCanvas();
            }
        });
        
        window.addEventListener('resize', () => this.resizeCanvas());
    },
    
    resizeCanvas() {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight - 40;
        this.renderCanvas();
    },
    
    renderCanvas() {
        if (!this.ctx) return;
        
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // 清空节点位置
        this.nodePositions = [];
        
        // 清空
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, w, h);
        
        // 网格
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        const gridSize = 20 * this.zoom;
        for (let x = this.panX % gridSize; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = this.panY % gridSize; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        
        // 更新标题
        const titleEl = document.getElementById('flow-canvas-title');
        
        if (this.selectedType === 'mode' && this.selectedItem) {
            const mode = this.modesConfig?.modes?.[this.selectedItem];
            if (mode) {
                titleEl.textContent = `${mode.icon || '📐'} ${mode.name} - 流程图`;
                this.drawModeFlow(mode);
            }
        } else {
            titleEl.textContent = '选择一个模式查看流程';
            this.drawEmptyHint(ctx, w, h);
        }
    },
    
    drawEmptyHint(ctx, w, h) {
        ctx.fillStyle = '#475569';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('← 从左侧选择一个模式', w / 2, h / 2);
        ctx.textAlign = 'left';
    },
    
    drawModeFlow(mode) {
        const ctx = this.ctx;
        const steps = mode.steps || [];
        const startX = 80 * this.zoom + this.panX;
        const startY = 80 * this.zoom + this.panY;
        const stepWidth = 140 * this.zoom;
        const stepHeight = 60 * this.zoom;
        const gap = 40 * this.zoom;
        
        // 绘制开始节点
        this.drawNode(ctx, startX, startY, '开始', '#22c55e', 'circle');
        
        // 绘制步骤
        let x = startX + 60 * this.zoom + gap;
        let prevX = startX + 30 * this.zoom;
        
        steps.forEach((step, i) => {
            // 连线
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(prevX, startY);
            ctx.lineTo(x - 10, startY);
            ctx.stroke();
            
            // 箭头
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.moveTo(x - 10, startY);
            ctx.lineTo(x - 20, startY - 6);
            ctx.lineTo(x - 20, startY + 6);
            ctx.closePath();
            ctx.fill();
            
            // 步骤节点
            const isSelected = this.selectedStepIndex === i;
            const isHovered = this.hoveredNode?.type === 'step' && this.hoveredNode?.index === i;
            const label = step.description || `步骤${step.step}`;
            const subLabel = `${step.store} (${step.dataType})`;
            const color = isSelected ? '#f59e0b' : (isHovered ? '#60a5fa' : '#3b82f6');
            
            this.drawNode(ctx, x, startY - stepHeight/2, label, color, 'rect', stepWidth, stepHeight, subLabel, isSelected);
            
            // 记录节点位置（用于点击检测）
            this.nodePositions.push({
                type: 'step',
                index: i,
                x: x,
                y: startY - stepHeight/2,
                width: stepWidth,
                height: stepHeight
            });
            
            prevX = x + stepWidth;
            x += stepWidth + gap;
        });
        
        // 结果节点
        if (mode.resultType && steps.length > 0) {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(prevX, startY);
            ctx.lineTo(x - 10, startY);
            ctx.stroke();
            
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.moveTo(x - 10, startY);
            ctx.lineTo(x - 20, startY - 6);
            ctx.lineTo(x - 20, startY + 6);
            ctx.closePath();
            ctx.fill();
            
            const resultLabel = mode.calculate ? '计算结果' : '完成';
            const isHovered = this.hoveredNode?.type === 'result';
            const color = isHovered ? '#fbbf24' : '#f59e0b';
            this.drawNode(ctx, x, startY - stepHeight/2, resultLabel, color, 'rect', stepWidth, stepHeight, mode.resultType);
            
            this.nodePositions.push({
                type: 'result',
                x: x,
                y: startY - stepHeight/2,
                width: stepWidth,
                height: stepHeight
            });
        }
        
        // 撤回箭头（如果有多步）
        if (steps.length > 1) {
            const undoY = startY + stepHeight + 30 * this.zoom;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(startX + 60 * this.zoom + gap + stepWidth, undoY);
            ctx.lineTo(startX + 60 * this.zoom + gap, undoY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // 箭头
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(startX + 60 * this.zoom + gap, undoY);
            ctx.lineTo(startX + 60 * this.zoom + gap + 10, undoY - 5);
            ctx.lineTo(startX + 60 * this.zoom + gap + 10, undoY + 5);
            ctx.closePath();
            ctx.fill();
            
            ctx.font = `${10 * this.zoom}px sans-serif`;
            ctx.fillText('撤回 (flow:undo)', startX + 60 * this.zoom + gap + 20, undoY - 8);
        }
        
        // 绘制计算公式（如果有）
        if (mode.calculate?.formula) {
            const formulaY = startY + stepHeight + 60 * this.zoom;
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${11 * this.zoom}px monospace`;
            ctx.fillText(`📐 ${mode.calculate.formula}`, startX, formulaY);
        }
    },
    
    drawNode(ctx, x, y, label, color, shape, width, height, subLabel, isSelected) {
        const w = width || 60 * this.zoom;
        const h = height || 40 * this.zoom;
        
        ctx.fillStyle = color + '30';
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 2;
        
        if (shape === 'circle') {
            const r = 25 * this.zoom;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = color;
            ctx.font = `bold ${12 * this.zoom}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x, y);
        } else {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 6 * this.zoom);
            ctx.fill();
            ctx.stroke();
            
            // 选中时添加发光效果
            if (isSelected) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
            
            ctx.fillStyle = '#e2e8f0';
            ctx.font = `bold ${12 * this.zoom}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + w/2, y + h/2 - (subLabel ? 8 * this.zoom : 0));
            
            if (subLabel) {
                ctx.fillStyle = '#94a3b8';
                ctx.font = `${10 * this.zoom}px sans-serif`;
                ctx.fillText(subLabel, x + w/2, y + h/2 + 10 * this.zoom);
            }
        }
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    },
    
    zoomIn() {
        this.zoom = Math.min(2, this.zoom * 1.2);
        this.renderCanvas();
    },
    
    zoomOut() {
        this.zoom = Math.max(0.5, this.zoom / 1.2);
        this.renderCanvas();
    },
    
    fitView() {
        this.zoom = 1;
        this.panX = 50;
        this.panY = 30;
        this.renderCanvas();
    },
    
    // ========== 预览 ==========
    updatePreview() {
        const previewEl = document.getElementById('flow-json-preview');
        if (!previewEl) return;
        
        let data = null;
        if (this.selectedType === 'mode' && this.selectedItem) {
            data = this.modesConfig?.modes?.[this.selectedItem];
        } else if (this.selectedType === 'action' && this.selectedItem) {
            data = this.flowActions[this.selectedItem];
        }
        
        previewEl.textContent = data ? JSON.stringify(data, null, 2) : '';
    },
    
    // ========== 工具方法 ==========
    showToast(msg, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    },
    
    // 获取所有流程动作（供状态机编辑器使用）
    getFlowActions() {
        const actions = [];
        
        // 内置动作
        Object.entries(this.flowActions).forEach(([id, action]) => {
            actions.push({
                id: action.template,
                name: action.name,
                desc: action.desc,
                category: '流程控制',
                subCategory: action.category
            });
        });
        
        // 根据配置的模式生成 setMode 动作
        if (this.modesConfig?.modes) {
            Object.entries(this.modesConfig.modes).forEach(([modeId, mode]) => {
                actions.push({
                    id: `flow:setMode:${modeId}`,
                    name: `${mode.icon || '📐'} ${mode.name}模式`,
                    desc: `设置为${mode.name}`,
                    category: '流程控制',
                    subCategory: '模式切换'
                });
            });
        }
        
        return actions;
    }
};

// 页面加载时初始化
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        // 延迟初始化，等待页面切换
    });
}
