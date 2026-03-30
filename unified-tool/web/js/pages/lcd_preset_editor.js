/**
 * LCD界面预设编辑器
 * 管理界面状态快照 - 组件值+图标+行为的组合
 */

window.PresetEditor = {
    state: {
        presets: {},
        components: {},
        commonPresets: {},
        lcdConfig: null,
        animations: {},
        selectedPreset: null,
        lcdImage: null,
        scale: 1
    },
    
    canvas: null,
    ctx: null,
    hoveredElement: null,
    
    // ========== 初始化 ==========
    async init() {
        console.log('[PresetEditor] 初始化');
        
        this.canvas = document.getElementById('preset-lcd-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            // 添加鼠标事件支持图像选择元素
            this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
            this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
            this.canvas.style.cursor = 'default';
        }
        
        await this.initDeviceManager();
        await this.loadAllConfigs();
        
        console.log('[PresetEditor] 初始化完成');
    },
    
    // ========== Canvas鼠标事件 ==========
    onCanvasMouseMove(e) {
        if (!this.state.lcdConfig?.elements) return;
        if (!this.canvas) return;
        
        const rect = this.canvas.getBoundingClientRect();
        // 计算鼠标在canvas上的实际像素坐标
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        
        // 转换为原始图像坐标
        const x = Math.floor(canvasX / this.state.scale);
        const y = Math.floor(canvasY / this.state.scale);
        const key = `${x},${y}`;
        
        // 查找鼠标下的元素
        let found = null;
        for (const elem of this.state.lcdConfig.elements) {
            for (const seg of elem.segments || []) {
                const pixels = seg.pixels || [];
                // pixels 可能是数组或 Set
                const hasPixel = Array.isArray(pixels) ? pixels.includes(key) : pixels.has?.(key);
                if (hasPixel) {
                    found = elem.name || elem.id;
                    break;
                }
            }
            if (found) break;
        }
        
        if (found !== this.hoveredElement) {
            this.hoveredElement = found;
            this.canvas.style.cursor = found ? 'pointer' : 'default';
            this.renderPreview();
        }
    },
    
    onCanvasClick(e) {
        if (!this.hoveredElement) return;
        
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) {
            this.showToast('请先选择一个预设', 'warning');
            return;
        }
        
        // 添加到直接元素列表
        if (!this.state.presets[id].elements) {
            this.state.presets[id].elements = [];
        }
        
        const elements = this.state.presets[id].elements;
        const idx = elements.indexOf(this.hoveredElement);
        if (idx >= 0) {
            elements.splice(idx, 1);
            this.showToast(`已移除: ${this.hoveredElement}`, 'info');
        } else {
            elements.push(this.hoveredElement);
            this.showToast(`已添加: ${this.hoveredElement}`, 'success');
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            const container = document.getElementById('preset-device-selector');
            if (container && typeof createDeviceSelector === 'function') {
                createDeviceSelector('preset-device-selector', {
                    onChange: () => this.loadAllConfigs(),
                    showAdd: false,
                    showManage: true
                });
            }
            
            DeviceConfigManager.subscribe('device-changed', () => this.loadAllConfigs());
            DeviceConfigManager.subscribe('lcd-updated', () => this.loadLcdConfig());
            DeviceConfigManager.subscribe('components-updated', () => this.loadComponents());
            DeviceConfigManager.subscribe('animations-updated', () => this.loadAnimations());
        }
    },
    
    // ========== 配置加载 ==========
    async loadAllConfigs() {
        await Promise.all([
            this.loadPresets(),
            this.loadComponents(),
            this.loadLcdConfig(),
            this.loadAnimations()
        ]);
        
        this.renderList();
        this.renderPreview();
    },
    
    async loadPresets() {
        try {
            const data = await DeviceConfigManager.loadConfig('presets');
            this.state.presets = data?.presets || {};
            console.log('[PresetEditor] 预设加载:', Object.keys(this.state.presets).length);
        } catch (e) {
            console.warn('[PresetEditor] 加载预设失败:', e);
            this.state.presets = {};
        }
    },
    
    async loadComponents() {
        try {
            const data = await DeviceConfigManager.loadConfig('components');
            this.state.components = data?.components || {};
            this.state.commonPresets = data?.commonPresets || {};
            console.log('[PresetEditor] 组件加载:', Object.keys(this.state.components).length, 'commonPresets:', Object.keys(this.state.commonPresets));
        } catch (e) {
            console.warn('[PresetEditor] 加载组件失败:', e);
        }
    },
    
    async loadLcdConfig() {
        try {
            const data = await DeviceConfigManager.loadLcdProject();
            console.log('[PresetEditor] LCD配置加载:', data ? 'OK' : 'NULL', 'elements:', data?.elements?.length);
            if (data?.elements) {
                this.state.lcdConfig = data;
                
                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.state.lcdImage = img;
                        console.log('[PresetEditor] LCD背景图加载完成');
                        this.renderPreview();
                    };
                    img.src = data.image;
                }
            }
        } catch (e) {
            console.warn('[PresetEditor] 加载LCD配置失败:', e);
        }
    },
    
    async loadAnimations() {
        try {
            const data = await DeviceConfigManager.loadConfig('animations');
            this.state.animations = data?.animations || {};
        } catch (e) {
            console.warn('[PresetEditor] 加载动画失败:', e);
        }
    },
    
    // ========== 保存 ==========
    async save() {
        try {
            const data = {
                version: '1.0',
                description: 'LCD界面预设库',
                presets: this.state.presets
            };
            await DeviceConfigManager.saveConfig('presets', data);
            this.showToast('保存成功', 'success');
        } catch (e) {
            this.showToast('保存失败: ' + e.message, 'error');
        }
    },
    
    // ========== 列表渲染 ==========
    renderList() {
        const container = document.getElementById('preset-list');
        if (!container) return;
        
        const presets = this.state.presets;
        if (Object.keys(presets).length === 0) {
            container.innerHTML = `
                <div class="preset-empty">
                    <div class="preset-empty-icon">📋</div>
                    <div>暂无预设</div>
                    <button class="preset-btn" style="margin-top:10px;" onclick="PresetEditor.showAddDialog()">+ 创建预设</button>
                </div>
            `;
            return;
        }
        
        // 按分类分组
        const groups = {};
        for (const [id, preset] of Object.entries(presets)) {
            const cat = preset.category || '其他';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({ id, ...preset });
        }
        
        let html = '';
        for (const [cat, items] of Object.entries(groups)) {
            html += `<div class="preset-category">${cat}</div>`;
            for (const item of items) {
                const selected = this.state.selectedPreset === item.id ? 'selected' : '';
                const behaviorCount = (item.behaviors || []).length;
                html += `
                    <div class="preset-item ${selected}" onclick="PresetEditor.selectPreset('${item.id}')">
                        <span class="icon">📋</span>
                        <span class="name">${item.name || item.id}</span>
                        ${behaviorCount > 0 ? `<span class="behavior-count">${behaviorCount}动画</span>` : ''}
                        <span class="delete" onclick="event.stopPropagation();PresetEditor.deletePreset('${item.id}')">🗑️</span>
                    </div>
                `;
            }
        }
        
        container.innerHTML = html;
    },
    
    // ========== 选择预设 ==========
    selectPreset(id) {
        this.state.selectedPreset = id;
        this.renderList();
        this.renderProperties();
        this.renderPreview();
        
        document.getElementById('preset-preview-name').textContent = 
            this.state.presets[id]?.name || id;
    },
    
    // ========== 属性面板 ==========
    renderProperties() {
        const container = document.getElementById('preset-properties');
        if (!container) return;
        
        const id = this.state.selectedPreset;
        const preset = this.state.presets[id];
        
        if (!preset) {
            container.innerHTML = `
                <div class="preset-empty">
                    <div class="preset-empty-icon">📋</div>
                    <div>选择或创建预设</div>
                </div>
            `;
            return;
        }
        
        // 合并 components 和 icons 到统一的组件状态
        const componentStates = { ...(preset.components || {}) };
        // 将旧的 icons 转换为组件状态格式
        for (const [iconName, isOn] of Object.entries(preset.icons || {})) {
            if (!componentStates[iconName]) {
                componentStates[iconName] = { visible: isOn };
            }
        }
        
        const behaviors = preset.behaviors || [];
        const elements = preset.elements || [];
        
        // 统计已添加的组件数量
        const addedCount = Object.keys(componentStates).length;
        const totalCount = Object.keys(this.state.components).length;
        
        container.innerHTML = `
            <!-- 基本信息 -->
            <div class="preset-form-group">
                <label>预设ID</label>
                <input type="text" class="preset-input" value="${id}" disabled>
            </div>
            <div class="preset-form-group">
                <label>名称</label>
                <input type="text" class="preset-input" value="${preset.name || ''}" 
                       onchange="PresetEditor.updateProp('name', this.value)">
            </div>
            <div class="preset-form-group">
                <label>分类</label>
                <select class="preset-select" onchange="PresetEditor.updateProp('category', this.value)">
                    <option value="系统" ${preset.category === '系统' ? 'selected' : ''}>系统</option>
                    <option value="单次测量" ${preset.category === '单次测量' ? 'selected' : ''}>单次测量</option>
                    <option value="连续测量" ${preset.category === '连续测量' ? 'selected' : ''}>连续测量</option>
                    <option value="面积测量" ${preset.category === '面积测量' ? 'selected' : ''}>面积测量</option>
                    <option value="体积测量" ${preset.category === '体积测量' ? 'selected' : ''}>体积测量</option>
                    <option value="勾股测量" ${preset.category === '勾股测量' ? 'selected' : ''}>勾股测量</option>
                    <option value="连接" ${preset.category === '连接' ? 'selected' : ''}>连接</option>
                    <option value="测试" ${preset.category === '测试' ? 'selected' : ''}>测试</option>
                    <option value="其他" ${preset.category === '其他' ? 'selected' : ''}>其他</option>
                </select>
            </div>
            <div class="preset-form-group">
                <label>描述</label>
                <textarea class="preset-textarea" onchange="PresetEditor.updateProp('description', this.value)">${preset.description || ''}</textarea>
            </div>
            
            <!-- 组件状态 - 统一管理所有组件 -->
            <div class="preset-section expanded">
                <div class="preset-section-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>📦 组件状态 (${addedCount}/${totalCount})</span>
                    <span class="toggle">▼</span>
                </div>
                <div class="preset-section-content">
                    ${this.renderAllComponentStates(componentStates)}
                    <div class="add-btn" onclick="PresetEditor.showAddComponentState()">+ 添加组件状态</div>
                </div>
            </div>
            
            <!-- 启动的动画 -->
            <div class="preset-section expanded">
                <div class="preset-section-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>✨ 启动动画 (${behaviors.length})</span>
                    <span class="toggle">▼</span>
                </div>
                <div class="preset-section-content">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;">
                        ${behaviors.map(b => `
                            <span class="behavior-tag">
                                ${this.state.animations[b]?.name || b}
                                <span class="remove" onclick="PresetEditor.removeBehavior('${b}')">×</span>
                            </span>
                        `).join('')}
                    </div>
                    <div class="add-btn" onclick="PresetEditor.showAddBehavior()">+ 添加动画</div>
                </div>
            </div>
            
            <!-- 直接控制的元素 -->
            <div class="preset-section">
                <div class="preset-section-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>📍 直接元素 (${elements.length})</span>
                    <span class="toggle">▼</span>
                </div>
                <div class="preset-section-content">
                    <div style="display:flex;flex-wrap:wrap;gap:4px;">
                        ${elements.map(e => `
                            <span class="element-tag">
                                ${e}
                                <span class="remove" onclick="PresetEditor.removeElement('${e}')">×</span>
                            </span>
                        `).join('')}
                    </div>
                    <div class="add-btn" onclick="PresetEditor.showAddElement()">+ 添加元素</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:6px;">💡 点击预览图像可直接添加/移除元素</div>
                </div>
            </div>
        `;
    },
    
    // 渲染所有组件状态 - 统一处理所有类型
    renderAllComponentStates(componentStates) {
        if (Object.keys(componentStates).length === 0) {
            return '<div style="color:var(--text-muted);font-size:11px;padding:8px;">暂无组件状态，点击下方添加</div>';
        }
        
        return Object.entries(componentStates).map(([name, state]) => {
            const comp = this.state.components[name];
            if (!comp) {
                return `
                    <div class="comp-state-item" style="opacity:0.5;">
                        <span class="comp-name">${name}</span>
                        <span style="color:#ef4444;font-size:10px;">组件不存在</span>
                        <span class="delete" onclick="PresetEditor.removeComponentState('${name}')">×</span>
                    </div>
                `;
            }
            
            const compType = comp.type?.toLowerCase() || '';
            const typeIcon = this.getCompTypeIcon(comp.type);
            const typeLabel = this.getCompTypeLabel(comp.type);
            
            // 根据组件类型生成不同的编辑控件
            let editControl = this.renderComponentEditControl(name, comp, state);
            
            return `
                <div class="comp-state-item" style="flex-wrap:wrap;">
                    <span class="comp-icon">${typeIcon}</span>
                    <span class="comp-name">${name}</span>
                    <span class="comp-type-label">${typeLabel}</span>
                    <span class="delete" onclick="PresetEditor.removeComponentState('${name}')">×</span>
                    <div class="comp-state-edit" style="width:100%;margin-top:6px;">
                        ${editControl}
                    </div>
                </div>
            `;
        }).join('');
    },
    
    // 根据组件类型渲染编辑控件
    renderComponentEditControl(compName, comp, state) {
        const compType = comp.type || '';
        const isBind = state.bind !== undefined;
        
        // ========== 新类型 v3.0 ==========
        if (compType === 'Line') {
            // Line组件：支持 value/bind/preset/dataType
            if (isBind) {
                return `
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:11px;color:#f59e0b;">🔗 绑定变量:</span>
                            <input type="text" class="comp-state-input" style="flex:1;" 
                                   value="${state.bind}" placeholder="变量名如: distance"
                                   onchange="PresetEditor.updateComponentBind('${compName}', this.value)">
                            <button class="preset-btn" style="padding:2px 8px;font-size:10px;" 
                                    onclick="PresetEditor.clearBind('${compName}')">取消</button>
                        </div>
                        <select class="comp-state-select" style="font-size:10px;" onchange="PresetEditor.updateLineDataType('${compName}', this.value)">
                            <option value="" ${!state.dataType ? 'selected' : ''}>数据类型: 自动</option>
                            <option value="length" ${state.dataType === 'length' ? 'selected' : ''}>长度</option>
                            <option value="area" ${state.dataType === 'area' ? 'selected' : ''}>面积</option>
                            <option value="volume" ${state.dataType === 'volume' ? 'selected' : ''}>体积</option>
                        </select>
                    </div>
                `;
            }
            
            // 获取单位选项（从全局unit组件获取）
            const unitComp = this.state.components['unit'];
            const unitOptions = unitComp?.options || [
                { key: 'M', value: 0 },
                { key: 'FT', value: 1 },
                { key: 'IN', value: 2 },
                { key: 'FT_IN', value: 3 }
            ];
            
            return `
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <select class="comp-state-select" onchange="PresetEditor.updateLineState('${compName}', this.value)">
                        <option value="value:" ${!state.preset && !isBind ? 'selected' : ''}>自定义值</option>
                        <option value="bind:">🔗 绑定变量</option>
                        <option value="preset:dash" ${state.preset === 'dash' ? 'selected' : ''}>预设: ----- (横线)</option>
                        <option value="preset:blank" ${state.preset === 'blank' ? 'selected' : ''}>预设: 空白</option>
                        <option value="preset:error" ${state.preset === 'error' ? 'selected' : ''}>预设: Err (错误)</option>
                    </select>
                    ${!state.preset && !isBind ? `
                    <input type="text" class="comp-state-input" 
                           value="${state.value || ''}" 
                           placeholder="输入数值如: 12.345"
                           onchange="PresetEditor.updateLineValue('${compName}', this.value)">
                    ` : ''}
                    <div style="display:flex;gap:6px;">
                        <select class="comp-state-select" style="flex:1;font-size:10px;" onchange="PresetEditor.updateLineDataType('${compName}', this.value)">
                            <option value="" ${!state.dataType ? 'selected' : ''}>数据类型: 自动</option>
                            <option value="length" ${state.dataType === 'length' ? 'selected' : ''}>长度</option>
                            <option value="area" ${state.dataType === 'area' ? 'selected' : ''}>面积</option>
                            <option value="volume" ${state.dataType === 'volume' ? 'selected' : ''}>体积</option>
                        </select>
                        <select class="comp-state-select" style="flex:1;font-size:10px;" onchange="PresetEditor.updateLineUnit('${compName}', this.value)">
                            <option value="" ${state.unit === undefined ? 'selected' : ''}>单位: 跟随全局</option>
                            ${unitOptions.map(opt => `
                                <option value="${opt.value}" ${state.unit === opt.value ? 'selected' : ''}>${opt.key}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>
            `;
        } else if (compType === 'Selector') {
            // Selector组件：直接选择选项值，不需要绑定变量
            const options = comp.options || [];
            return `
                <select class="comp-state-select" onchange="PresetEditor.updateSelectorValue('${compName}', this.value)">
                    ${options.map(opt => `
                        <option value="${opt.value}" ${state.value === opt.value ? 'selected' : ''}>${opt.key}</option>
                    `).join('')}
                </select>
            `;
        } else if (compType === 'Icon') {
            // Icon组件：显示/隐藏开关
            const isVisible = state.visible !== false;
            return `
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:11px;">显示状态:</span>
                    <div class="toggle-switch ${isVisible ? 'on' : ''}" 
                         onclick="PresetEditor.updateComponentVisible('${compName}', !${isVisible})"></div>
                    <span style="font-size:11px;color:var(--text-muted);">${isVisible ? '显示' : '隐藏'}</span>
                </div>
            `;
        }
        
        // ========== 旧类型兼容 ==========
        if (compType === 'NumberDisplay') {
            // 数字显示组件
            const commonPresets = this.state.commonPresets?.NumberDisplay || {};
            const presetKeys = Object.keys(commonPresets);
            const isPreset = state.preset !== undefined;
            const currentValue = isPreset ? (commonPresets[state.preset] || state.preset) : (state.value || '');
            
            if (isBind) {
                return `
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:11px;color:#f59e0b;">🔗 绑定变量:</span>
                            <input type="text" class="comp-state-input" style="flex:1;" 
                                   value="${state.bind}" placeholder="变量名如: distance"
                                   onchange="PresetEditor.updateComponentBind('${compName}', this.value)">
                            <button class="preset-btn" style="padding:2px 8px;font-size:10px;" 
                                    onclick="PresetEditor.clearBind('${compName}')">取消绑定</button>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <select class="comp-state-select" onchange="PresetEditor.updateComponentState('${compName}', this.value)">
                        <option value="value:" ${!isPreset ? 'selected' : ''}>自定义值</option>
                        <option value="bind:">🔗 绑定变量</option>
                        ${presetKeys.map(p => `
                            <option value="preset:${p}" ${isPreset && state.preset === p ? 'selected' : ''}>
                                预设: ${p} (${commonPresets[p]})
                            </option>
                        `).join('')}
                    </select>
                    <input type="text" class="comp-state-input" 
                           value="${currentValue}" 
                           placeholder="输入数值如: 12.345 或 -----"
                           onchange="PresetEditor.updateComponentValue('${compName}', this.value)"
                           ${isPreset ? 'disabled style="opacity:0.5;"' : ''}>
                </div>
            `;
        } else if (compType === 'modeselector') {
            // 模式选择器 - 支持绑定变量
            const modes = Object.keys(comp.modes || {});
            
            if (isBind) {
                return `
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:#f59e0b;">🔗 绑定变量:</span>
                        <input type="text" class="comp-state-input" style="flex:1;" 
                               value="${state.bind}" placeholder="变量名如: unit"
                               onchange="PresetEditor.updateComponentBind('${compName}', this.value)">
                        <button class="preset-btn" style="padding:2px 8px;font-size:10px;" 
                                onclick="PresetEditor.clearBind('${compName}')">取消</button>
                    </div>
                `;
            }
            
            return `
                <select class="comp-state-select" onchange="PresetEditor.updateComponentMode('${compName}', this.value)">
                    <option value="">-- 选择模式 --</option>
                    <option value="bind:">🔗 绑定变量</option>
                    ${modes.map(m => `<option value="${m}" ${state.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
            `;
        } else if (compType === 'levelindicator') {
            // 等级指示器 - 支持绑定变量
            const maxLevel = comp.maxLevel || (comp.levels?.length) || 4;
            
            if (isBind) {
                return `
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:#f59e0b;">🔗 绑定变量:</span>
                        <input type="text" class="comp-state-input" style="flex:1;" 
                               value="${state.bind}" placeholder="变量名如: battery_level"
                               onchange="PresetEditor.updateComponentBind('${compName}', this.value)">
                        <button class="preset-btn" style="padding:2px 8px;font-size:10px;" 
                                onclick="PresetEditor.clearBind('${compName}')">取消</button>
                    </div>
                `;
            }
            
            return `
                <select class="comp-state-select" onchange="PresetEditor.updateComponentLevel('${compName}', this.value)">
                    <option value="bind:">🔗 绑定变量</option>
                    ${Array.from({length: maxLevel + 1}, (_, i) => 
                        `<option value="${i}" ${state.level === i ? 'selected' : ''}>等级 ${i}</option>`
                    ).join('')}
                </select>
            `;
        } else if (compType === 'icon') {
            // 图标组件 - 显示/隐藏开关
            const isVisible = state.visible !== false;
            return `
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:11px;">显示状态:</span>
                    <div class="toggle-switch ${isVisible ? 'on' : ''}" 
                         onclick="PresetEditor.updateComponentVisible('${compName}', !${isVisible})"></div>
                    <span style="font-size:11px;color:var(--text-muted);">${isVisible ? '显示' : '隐藏'}</span>
                </div>
            `;
        } else {
            // 未知类型
            return `<div style="color:var(--text-muted);font-size:10px;">未知组件类型: ${comp.type}</div>`;
        }
    },
    
    getCompTypeLabel(type) {
        const labels = {
            // 新类型 v3.0
            'Line': '数字行',
            'Selector': '选择器',
            'Icon': '图标',
            // 旧类型兼容
            'NumberDisplay': '数字(旧)',
            'LevelIndicator': '等级(旧)',
            'ModeSelector': '模式(旧)'
        };
        return labels[type] || type;
    },
    
    updateComponentVisible(compName, visible) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        this.state.presets[id].components[compName] = { visible: visible };
        this.renderProperties();
        this.renderPreview();
    },
    
    // ========== 属性更新 ==========
    updateProp(key, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        this.state.presets[id][key] = value;
        this.renderList();
    },
    
    removeComponentState(name) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        // 同时从 components 和 icons 中删除
        if (this.state.presets[id].components) {
            delete this.state.presets[id].components[name];
        }
        if (this.state.presets[id].icons) {
            delete this.state.presets[id].icons[name];
        }
        this.renderProperties();
        this.renderPreview();
    },
    
    removeBehavior(name) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        const behaviors = this.state.presets[id].behaviors || [];
        const idx = behaviors.indexOf(name);
        if (idx >= 0) behaviors.splice(idx, 1);
        
        this.renderProperties();
    },
    
    removeElement(name) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        const elements = this.state.presets[id].elements || [];
        const idx = elements.indexOf(name);
        if (idx >= 0) elements.splice(idx, 1);
        
        this.renderProperties();
        this.renderPreview();
    },
    
    // ========== 组件状态更新方法 ==========
    updateComponentState(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        if (value.startsWith('preset:')) {
            this.state.presets[id].components[compName] = { preset: value.substring(7) };
        } else if (value === 'value:') {
            this.state.presets[id].components[compName] = { value: '' };
        } else if (value === 'bind:') {
            this.state.presets[id].components[compName] = { bind: '' };
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    // ========== 新类型 v3.0 状态更新方法 ==========
    updateLineState(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        // 保留现有的 dataType 和 unit
        const existing = this.state.presets[id].components[compName] || {};
        const dataType = existing.dataType;
        const unit = existing.unit;
        
        let newState = {};
        if (value.startsWith('preset:')) {
            newState = { preset: value.substring(7) };
        } else if (value === 'bind:') {
            newState = { bind: '' };
        } else {
            // 自定义值
            newState = { value: '' };
        }
        
        // 保留 dataType 和 unit
        if (dataType) newState.dataType = dataType;
        if (unit !== undefined) newState.unit = unit;
        
        this.state.presets[id].components[compName] = newState;
        
        this.renderProperties();
        this.renderPreview();
    },
    
    updateLineValue(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        // 保留现有的 dataType 和 unit
        const existing = this.state.presets[id].components[compName] || {};
        this.state.presets[id].components[compName] = { 
            value, 
            dataType: existing.dataType,
            unit: existing.unit
        };
        this.renderPreview();
    },
    
    updateLineDataType(compName, dataType) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        const existing = this.state.presets[id].components[compName] || {};
        // 创建新对象，保留 value/bind/preset/unit，更新 dataType
        const newState = {};
        if (existing.value !== undefined) newState.value = existing.value;
        if (existing.bind !== undefined) newState.bind = existing.bind;
        if (existing.preset !== undefined) newState.preset = existing.preset;
        if (existing.unit !== undefined) newState.unit = existing.unit;
        if (dataType) newState.dataType = dataType;
        
        this.state.presets[id].components[compName] = newState;
        this.renderPreview();
    },
    
    updateLineUnit(compName, unit) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        const existing = this.state.presets[id].components[compName] || {};
        // 创建新对象，保留 value/bind/preset/dataType，更新 unit
        const newState = {};
        if (existing.value !== undefined) newState.value = existing.value;
        if (existing.bind !== undefined) newState.bind = existing.bind;
        if (existing.preset !== undefined) newState.preset = existing.preset;
        if (existing.dataType !== undefined) newState.dataType = existing.dataType;
        if (unit !== '') newState.unit = parseInt(unit);
        
        this.state.presets[id].components[compName] = newState;
        this.renderPreview();
    },
    
    updateSelectorState(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        if (value === 'bind:') {
            this.state.presets[id].components[compName] = { bind: '' };
        } else {
            this.state.presets[id].components[compName] = { value: parseInt(value) };
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    // Selector组件直接选择值
    updateSelectorValue(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        this.state.presets[id].components[compName] = { value: parseInt(value) };
        this.renderPreview();
    },
    
    // ========== 旧类型兼容方法 ==========
    updateComponentValue(compName, value) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        this.state.presets[id].components[compName] = { value: value };
        this.renderPreview();
    },
    
    updateComponentBind(compName, varName) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        this.state.presets[id].components[compName] = { bind: varName };
        this.renderPreview();
    },
    
    clearBind(compName) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        // 清除绑定，恢复为默认值
        this.state.presets[id].components[compName] = { value: '' };
        this.renderProperties();
        this.renderPreview();
    },
    
    updateComponentLevel(compName, level) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        // 支持绑定变量
        if (level === 'bind:') {
            this.state.presets[id].components[compName] = { bind: '' };
        } else {
            this.state.presets[id].components[compName] = { level: parseInt(level) };
        }
        this.renderProperties();
        this.renderPreview();
    },
    
    updateComponentMode(compName, mode) {
        const id = this.state.selectedPreset;
        if (!id || !this.state.presets[id]) return;
        
        if (!this.state.presets[id].components) {
            this.state.presets[id].components = {};
        }
        
        // 支持绑定变量
        if (mode === 'bind:') {
            this.state.presets[id].components[compName] = { bind: '' };
        } else {
            this.state.presets[id].components[compName] = { mode: mode };
        }
        this.renderProperties();
        this.renderPreview();
    },
    
    // ========== 添加对话框 ==========
    showAddDialog() {
        const id = prompt('输入预设ID (英文，如 single_idle):');
        if (!id || !id.trim()) return;
        
        const presetId = id.trim().toLowerCase().replace(/\s+/g, '_');
        if (this.state.presets[presetId]) {
            this.showToast('预设已存在', 'error');
            return;
        }
        
        this.state.presets[presetId] = {
            name: '新预设',
            description: '',
            category: '其他',
            components: {},
            icons: {},
            behaviors: [],
            elements: []
        };
        
        this.selectPreset(presetId);
        this.showToast('已创建预设', 'success');
    },
    
    showAddComponentState() {
        const id = this.state.selectedPreset;
        if (!id) return;
        
        // 获取已添加的组件（包括 components 和旧的 icons）
        const existingComps = new Set([
            ...Object.keys(this.state.presets[id].components || {}),
            ...Object.keys(this.state.presets[id].icons || {})
        ]);
        
        // 获取可用组件列表，排除已添加的
        const availableComps = Object.entries(this.state.components)
            .filter(([name, _]) => !existingComps.has(name));
        
        if (availableComps.length === 0) {
            this.showToast('所有组件都已添加', 'info');
            return;
        }
        
        // 使用带图片选择的对话框
        const options = availableComps.map(([name, comp]) => ({
            value: name,
            label: `${name} (${this.getCompTypeLabel(comp.type)})`,
            icon: this.getCompTypeIcon(comp.type)
        }));
        
        this.showSelectDialog('选择组件', options, (name) => {
            if (!name) return;
            
            const comp = this.state.components[name];
            const compType = comp.type || '';
            let defaultState = {};
            
            // 新类型 v3.0
            if (compType === 'Line') {
                defaultState = { preset: 'dash' }; // 默认显示 -----
            } else if (compType === 'Selector') {
                // 获取第一个选项的key
                const firstOpt = comp.options?.[0];
                defaultState = { value: firstOpt?.value ?? 0 };
            } else if (compType === 'Icon') {
                defaultState = { visible: true };
            }
            // 旧类型兼容
            else if (compType === 'NumberDisplay') {
                const commonPresets = this.state.commonPresets?.NumberDisplay || {};
                const presetKeys = Object.keys(commonPresets);
                if (presetKeys.length > 0) {
                    defaultState = { preset: presetKeys[0] };
                } else {
                    defaultState = { value: '-----' };
                }
            } else if (compType === 'ModeSelector') {
                defaultState = { mode: comp.defaultMode || Object.keys(comp.modes || {})[0] || '' };
            } else if (compType === 'LevelIndicator') {
                defaultState = { level: comp.maxLevel || (comp.levels?.length) || 3 };
            } else {
                defaultState = { value: '' };
            }
            
            if (!this.state.presets[id].components) {
                this.state.presets[id].components = {};
            }
            this.state.presets[id].components[name] = defaultState;
            
            this.renderProperties();
            this.renderPreview();
            this.showToast(`已添加: ${name}`, 'success');
        }, true); // 启用图片选择
    },
    
    getCompTypeIcon(type) {
        const icons = {
            // 新类型 v3.0
            'Line': '🔢',
            'Selector': '🔘',
            'Icon': '💡',
            // 旧类型兼容
            'NumberDisplay': '🔢',
            'LevelIndicator': '📊',
            'ModeSelector': '🔘'
        };
        return icons[type] || '📦';
    },
    
    // 通用选择对话框 - 支持图片选择模式
    showSelectDialog(title, options, callback, enableImageSelect = false) {
        // 移除已有对话框
        const existing = document.getElementById('preset-select-dialog');
        if (existing) existing.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'preset-select-dialog';
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;
        
        // 保存当前选中项
        this._dialogSelectedItem = null;
        this._dialogCallback = callback;
        this._dialogOptions = options;
        
        const dialogWidth = enableImageSelect ? '900px' : '400px';
        const listHeight = enableImageSelect ? '400px' : '300px';
        
        let contentHtml = '';
        if (enableImageSelect) {
            // 带图片选择的布局：左边列表 + 右边图片
            contentHtml = `
                <div style="display: grid; grid-template-columns: 280px 1fr; gap: 15px; height: 450px;">
                    <!-- 左侧列表 -->
                    <div style="display: flex; flex-direction: column; overflow: hidden;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">可选项目</div>
                        <div id="dialog-options-list" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
                            ${options.map(opt => `
                                <div class="dialog-option-item" data-value="${opt.value}" style="
                                    padding: 8px 10px; background: var(--bg-tertiary); border-radius: 4px;
                                    cursor: pointer; border: 2px solid transparent; font-size: 12px;
                                    display: flex; align-items: center; gap: 8px;
                                " onmouseover="this.style.borderColor='var(--border-color)'"
                                   onmouseout="if(!this.classList.contains('selected'))this.style.borderColor='transparent'">
                                    <span class="opt-icon">${opt.icon || '📦'}</span>
                                    <span class="opt-label">${opt.label}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <!-- 右侧图片预览 -->
                    <div style="display: flex; flex-direction: column; overflow: hidden;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                            <span>点击图片选择</span>
                            <span id="dialog-hover-hint" style="color: #ffff00; font-weight: bold;"></span>
                        </div>
                        <div style="flex: 1; background: #1a1a2e; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                            <canvas id="dialog-lcd-canvas" style="max-width: 100%; max-height: 100%;"></canvas>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 简单列表模式
            contentHtml = `
                <div style="display: flex; flex-direction: column; gap: 6px; max-height: ${listHeight}; overflow-y: auto;">
                    ${options.map(opt => `
                        <div class="dialog-option-item" data-value="${opt.value}" style="
                            padding: 10px 12px; background: var(--bg-tertiary); border-radius: 4px;
                            cursor: pointer; border: 1px solid transparent; font-size: 13px;
                        " onmouseover="this.style.borderColor='var(--accent-color)'"
                           onmouseout="this.style.borderColor='transparent'">
                            ${opt.label}
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        dialog.innerHTML = `
            <div style="background: var(--bg-secondary); border-radius: 8px; padding: 20px; width: ${dialogWidth}; max-height: 90vh; overflow-y: auto;">
                <h3 style="margin: 0 0 15px 0; font-size: 14px; display: flex; align-items: center; justify-content: space-between;">
                    <span>${title}</span>
                    <button onclick="document.getElementById('preset-select-dialog').remove()" 
                            style="background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer;">×</button>
                </h3>
                ${contentHtml}
                <div style="margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px;">
                    <button onclick="document.getElementById('preset-select-dialog').remove()" 
                            style="padding: 6px 16px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); cursor: pointer;">
                        取消
                    </button>
                    ${enableImageSelect ? `
                    <button id="dialog-confirm-btn" onclick="PresetEditor.confirmDialogSelection()" 
                            style="padding: 6px 16px; background: var(--accent-color); border: 1px solid var(--accent-color); border-radius: 4px; color: #fff; cursor: pointer;" disabled>
                        确定
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // 绑定点击事件
        dialog.querySelectorAll('.dialog-option-item').forEach(opt => {
            opt.onclick = () => {
                const value = opt.dataset.value;
                if (enableImageSelect) {
                    // 图片选择模式：选中但不关闭
                    this.selectDialogOption(value);
                } else {
                    // 简单模式：直接选中并关闭
                    dialog.remove();
                    callback(value);
                }
            };
        });
        
        // 点击背景关闭
        dialog.onclick = (e) => {
            if (e.target === dialog) dialog.remove();
        };
        
        // 如果启用图片选择，初始化canvas
        if (enableImageSelect) {
            this.initDialogCanvas();
        }
    },
    
    // 初始化对话框中的canvas
    initDialogCanvas() {
        const canvas = document.getElementById('dialog-lcd-canvas');
        if (!canvas || !this.state.lcdConfig || !this.state.lcdImage) return;
        
        const ctx = canvas.getContext('2d');
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        
        const w = config.imageWidth || img.naturalWidth || 400;
        const h = config.imageHeight || img.naturalHeight || 200;
        
        // 计算缩放
        const container = canvas.parentElement;
        const maxW = container.clientWidth - 20;
        const maxH = container.clientHeight - 20;
        const scale = Math.min(maxW / w, maxH / h, 2);
        
        canvas.width = w * scale;
        canvas.height = h * scale;
        canvas.style.width = canvas.width + 'px';
        canvas.style.height = canvas.height + 'px';
        
        this._dialogScale = scale;
        this._dialogCanvas = canvas;
        this._dialogCtx = ctx;
        this._dialogHoveredElement = null;
        
        // 绑定鼠标事件
        canvas.addEventListener('mousemove', (e) => this.onDialogCanvasMouseMove(e));
        canvas.addEventListener('click', (e) => this.onDialogCanvasClick(e));
        canvas.style.cursor = 'crosshair';
        
        this.renderDialogCanvas();
    },
    
    // 对话框canvas鼠标移动
    onDialogCanvasMouseMove(e) {
        if (!this.state.lcdConfig?.elements) return;
        
        const canvas = this._dialogCanvas;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        
        const x = Math.floor(canvasX / this._dialogScale);
        const y = Math.floor(canvasY / this._dialogScale);
        const key = `${x},${y}`;
        
        let found = null;
        for (const elem of this.state.lcdConfig.elements) {
            for (const seg of elem.segments || []) {
                const pixels = seg.pixels || [];
                const hasPixel = Array.isArray(pixels) ? pixels.includes(key) : pixels.has?.(key);
                if (hasPixel) {
                    found = elem.name || elem.id;
                    break;
                }
            }
            if (found) break;
        }
        
        if (found !== this._dialogHoveredElement) {
            this._dialogHoveredElement = found;
            canvas.style.cursor = found ? 'pointer' : 'crosshair';
            
            // 更新提示
            const hint = document.getElementById('dialog-hover-hint');
            if (hint) {
                hint.textContent = found ? `选中: ${found}` : '';
            }
            
            this.renderDialogCanvas();
        }
    },
    
    // 对话框canvas点击
    onDialogCanvasClick(e) {
        if (!this._dialogHoveredElement) return;
        
        // 查找对应的选项
        const elemName = this._dialogHoveredElement;
        const option = this._dialogOptions.find(opt => {
            // 检查是否是组件，组件可能包含这个元素
            const comp = this.state.components[opt.value];
            if (comp) {
                return this.componentContainsElement(comp, elemName);
            }
            // 或者直接匹配元素名
            return opt.value === elemName;
        });
        
        if (option) {
            this.selectDialogOption(option.value);
        } else {
            this.showToast(`元素 "${elemName}" 不在可选列表中`, 'warning');
        }
    },
    
    // 检查组件是否包含某个元素
    componentContainsElement(comp, elemName) {
        if (!comp) return false;
        
        const compType = comp.type || '';
        
        // ========== 新类型 v3.0 ==========
        if (compType === 'Line') {
            const digits = comp.digits || [];
            const dots = comp.dots || [];
            return digits.some(d => d.element === elemName) ||
                   dots.some(d => d.element === elemName) ||
                   comp.minus === elemName;
        } else if (compType === 'Selector') {
            if ((comp.frame || []).includes(elemName)) return true;
            for (const opt of comp.options || []) {
                if ((opt.elements || []).includes(elemName)) return true;
            }
            return false;
        } else if (compType === 'Icon') {
            return (comp.elements || []).includes(elemName);
        }
        // ========== 旧类型兼容 ==========
        else if (compType === 'NumberDisplay') {
            const digits = comp.config?.digits || [];
            const dots = comp.config?.dots || [];
            return digits.some(d => d.element === elemName) ||
                   dots.some(d => d.element === elemName) ||
                   comp.config?.sign?.element === elemName;
        } else if (compType === 'ModeSelector') {
            for (const elements of Object.values(comp.modes || {})) {
                if (elements.includes(elemName)) return true;
            }
            return false;
        } else if (compType === 'LevelIndicator') {
            if (comp.frame === elemName) return true;
            for (const level of comp.levels || []) {
                if (level.includes(elemName)) return true;
            }
            return false;
        }
        
        return (comp.elements || []).includes(elemName);
    },
    
    // 选中对话框选项
    selectDialogOption(value) {
        this._dialogSelectedItem = value;
        
        // 更新列表项样式
        document.querySelectorAll('.dialog-option-item').forEach(item => {
            if (item.dataset.value === value) {
                item.classList.add('selected');
                item.style.borderColor = 'var(--accent-color)';
                item.style.background = 'rgba(6,182,212,0.2)';
                // 滚动到可见
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                item.classList.remove('selected');
                item.style.borderColor = 'transparent';
                item.style.background = 'var(--bg-tertiary)';
            }
        });
        
        // 启用确定按钮
        const confirmBtn = document.getElementById('dialog-confirm-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
        
        // 高亮对应的元素
        this.renderDialogCanvas();
    },
    
    // 确认对话框选择
    confirmDialogSelection() {
        if (!this._dialogSelectedItem) return;
        
        const value = this._dialogSelectedItem;
        const callback = this._dialogCallback;
        
        document.getElementById('preset-select-dialog')?.remove();
        
        if (callback) {
            callback(value);
        }
    },
    
    // 渲染对话框canvas
    renderDialogCanvas() {
        const ctx = this._dialogCtx;
        const canvas = this._dialogCanvas;
        if (!ctx || !canvas) return;
        
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        const s = this._dialogScale;
        
        // 清空
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 背景图
        if (img) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
        }
        
        if (!config?.elements) return;
        
        // 获取选中组件包含的元素
        const selectedElements = new Set();
        if (this._dialogSelectedItem) {
            const comp = this.state.components[this._dialogSelectedItem];
            if (comp) {
                this.getComponentElements(comp, selectedElements);
            }
        }
        
        // 渲染元素
        for (const elem of config.elements) {
            const elemName = elem.name || elem.id;
            const isSelected = selectedElements.has(elemName);
            const isHovered = elemName === this._dialogHoveredElement;
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixels || [];
                if (pixels.length === 0) continue;
                
                if (isHovered) {
                    ctx.fillStyle = '#ffff00';
                } else if (isSelected) {
                    ctx.fillStyle = '#00ff88';
                } else {
                    ctx.fillStyle = 'rgba(42, 58, 42, 0.3)';
                }
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, s, s);
                }
            }
        }
    },
    
    // 获取组件包含的所有元素
    getComponentElements(comp, elemSet) {
        if (!comp) return;
        
        const compType = comp.type || '';
        
        // ========== 新类型 v3.0 ==========
        if (compType === 'Line') {
            for (const d of comp.digits || []) {
                if (d.element) elemSet.add(d.element);
            }
            for (const d of comp.dots || []) {
                if (d.element) elemSet.add(d.element);
            }
            if (comp.minus) elemSet.add(comp.minus);
        } else if (compType === 'Selector') {
            for (const e of comp.frame || []) elemSet.add(e);
            for (const opt of comp.options || []) {
                for (const e of opt.elements || []) elemSet.add(e);
            }
        } else if (compType === 'Icon') {
            for (const e of comp.elements || []) elemSet.add(e);
        }
        // ========== 旧类型兼容 ==========
        else if (compType === 'NumberDisplay') {
            for (const d of comp.config?.digits || []) {
                if (d.element) elemSet.add(d.element);
            }
            for (const d of comp.config?.dots || []) {
                if (d.element) elemSet.add(d.element);
            }
            if (comp.config?.sign?.element) {
                elemSet.add(comp.config.sign.element);
            }
        } else if (compType === 'ModeSelector') {
            for (const elements of Object.values(comp.modes || {})) {
                for (const e of elements) elemSet.add(e);
            }
        } else if (compType === 'LevelIndicator') {
            if (comp.frame) elemSet.add(comp.frame);
            for (const level of comp.levels || []) {
                for (const e of level) elemSet.add(e);
            }
        } else if (comp.elements) {
            for (const e of comp.elements) elemSet.add(e);
        }
    },
    
    showAddBehavior() {
        const id = this.state.selectedPreset;
        if (!id) return;
        
        // 获取可用动画，排除已添加的
        const existingBehaviors = this.state.presets[id].behaviors || [];
        const availableAnims = Object.entries(this.state.animations)
            .filter(([name, _]) => !existingBehaviors.includes(name))
            .map(([name, anim]) => ({ 
                value: name, 
                label: `${anim.name || name} (${anim.type || 'Blink'})`,
                icon: anim.type === 'Sequence' ? '🎬' : '💫'
            }));
        
        if (availableAnims.length === 0) {
            this.showToast('没有可添加的动画', 'info');
            return;
        }
        
        // 动画不需要图片选择，使用简单模式
        this.showSelectDialog('选择动画', availableAnims, (name) => {
            if (!name) return;
            
            if (!this.state.presets[id].behaviors) {
                this.state.presets[id].behaviors = [];
            }
            this.state.presets[id].behaviors.push(name);
            
            this.renderProperties();
            this.showToast(`已添加: ${name}`, 'success');
        }, false); // 不启用图片选择
    },
    
    showAddElement() {
        const id = this.state.selectedPreset;
        if (!id) return;
        
        // 获取可用元素，排除已添加的
        const existingElements = this.state.presets[id].elements || [];
        const availableElements = (this.state.lcdConfig?.elements || [])
            .map(e => e.name || e.id)
            .filter(name => !existingElements.includes(name))
            .map(name => ({ value: name, label: name, icon: '📍' }));
        
        if (availableElements.length === 0) {
            this.showToast('没有可添加的元素，或直接在图像上点击选择', 'info');
            return;
        }
        
        // 使用带图片选择的对话框
        this.showSelectDialog('选择元素', availableElements, (name) => {
            if (!name) return;
            
            if (!this.state.presets[id].elements) {
                this.state.presets[id].elements = [];
            }
            this.state.presets[id].elements.push(name);
            
            this.renderProperties();
            this.renderPreview();
            this.showToast(`已添加: ${name}`, 'success');
        }, true); // 启用图片选择
    },
    
    // ========== 删除/复制 ==========
    deletePreset(id) {
        if (!confirm(`删除预设 "${this.state.presets[id]?.name || id}"?`)) return;
        
        delete this.state.presets[id];
        if (this.state.selectedPreset === id) {
            this.state.selectedPreset = null;
        }
        
        this.renderList();
        this.renderProperties();
        this.showToast('已删除', 'info');
    },
    
    duplicate() {
        const id = this.state.selectedPreset;
        if (!id) {
            this.showToast('请先选择预设', 'warning');
            return;
        }
        
        const newId = id + '_copy';
        this.state.presets[newId] = JSON.parse(JSON.stringify(this.state.presets[id]));
        this.state.presets[newId].name = (this.state.presets[id].name || id) + ' 副本';
        
        this.selectPreset(newId);
        this.showToast('已复制', 'success');
    },
    
    // ========== 预览渲染 ==========
    renderPreview() {
        if (!this.canvas || !this.ctx) return;
        
        const ctx = this.ctx;
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        
        // 计算尺寸
        let w = 400, h = 200;
        if (img) {
            w = config?.imageWidth || img.naturalWidth || 400;
            h = config?.imageHeight || img.naturalHeight || 200;
        }
        
        // 适应容器
        const container = this.canvas.parentElement;
        if (container) {
            const maxW = container.clientWidth - 40;
            const maxH = container.clientHeight - 40;
            this.state.scale = Math.min(maxW / w, maxH / h, 2);
        }
        
        const s = this.state.scale;
        this.canvas.width = w * s;
        this.canvas.height = h * s;
        
        // 背景
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 背景图
        if (img) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(img, 0, 0, w * s, h * s);
            ctx.globalAlpha = 1;
        }
        
        if (!config?.elements) return;
        
        // 获取当前预设要显示的元素
        const activeElements = this.getActiveElements();
        console.log('[PresetEditor] renderPreview, activeElements:', activeElements.size, [...activeElements].slice(0, 10));
        
        // 渲染元素
        for (const elem of config.elements) {
            const elemName = elem.name || elem.id;
            const isElemActive = activeElements.has(elemName);
            const isHovered = elemName === this.hoveredElement;
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixels || [];
                if (pixels.length === 0) continue;
                
                // 检查这个segment是否激活
                // 支持两种格式: "elemName" 或 "elemName:segName"
                const segKey = `${elemName}:${seg.name}`;
                const isSegActive = isElemActive || activeElements.has(segKey);
                
                // 颜色优先级: 悬停 > 激活 > 默认
                if (isHovered) {
                    ctx.fillStyle = '#ffff00'; // 黄色高亮悬停
                } else if (isSegActive) {
                    ctx.fillStyle = '#00ff88';
                } else {
                    ctx.fillStyle = 'rgba(42, 58, 42, 0.3)';
                }
                
                for (const pkey of pixels) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s, py * s, s, s);
                }
            }
        }
        
        // 显示悬停元素名称 - 更明显的提示
        if (this.hoveredElement) {
            const text = `选中: ${this.hoveredElement}`;
            ctx.font = 'bold 14px sans-serif';
            const textWidth = ctx.measureText(text).width;
            
            // 背景框
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(8, 8, textWidth + 20, 28);
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(8, 8, textWidth + 20, 28);
            
            // 文字
            ctx.fillStyle = '#ffff00';
            ctx.fillText(text, 18, 27);
        }
    },
    
    getActiveElements() {
        const active = new Set();
        const id = this.state.selectedPreset;
        const preset = this.state.presets[id];
        
        if (!preset) return active;
        
        // 直接元素
        for (const elem of preset.elements || []) {
            active.add(elem);
        }
        
        // 图标 (旧格式兼容)
        for (const [iconName, isOn] of Object.entries(preset.icons || {})) {
            if (isOn) {
                const comp = this.state.components[iconName];
                if (comp?.elements) {
                    for (const e of comp.elements) {
                        active.add(e);
                    }
                }
            }
        }
        
        // 组件状态
        for (const [compName, state] of Object.entries(preset.components || {})) {
            const comp = this.state.components[compName];
            if (!comp) continue;
            
            const compType = comp.type || '';
            
            // ========== 新类型 v3.0 ==========
            if (compType === 'Line') {
                // Line组件：根据值渲染数字段码 + 单位
                let value = state.value;
                // 预设值映射
                const presetValues = { dash: '-----', blank: '', error: 'Err' };
                if (state.preset && presetValues[state.preset] !== undefined) {
                    value = presetValues[state.preset];
                }
                
                // 只有有值的时候才显示数字和单位
                const hasValue = value !== undefined && value !== null && value !== '';
                
                if (hasValue) {
                    // 添加数字段码
                    this.addLineElements(comp, String(value), active);
                    
                    // 添加单位元素
                    const dataType = state.dataType || 'length';
                    const unitIndex = state.unit !== undefined ? state.unit : 0; // 默认 M
                    const unitKeys = ['m', 'ft', 'in', 'ft_in'];
                    const unitKey = unitKeys[unitIndex] || 'm';
                    
                    // 基础单位元素
                    const baseElements = comp.units?.base?.[unitKey] || [];
                    for (const e of baseElements) {
                        active.add(e);
                    }
                    
                    // 面积/体积的指数符号
                    if (dataType === 'area') {
                        const sqElements = comp.units?.exp?.sq || [];
                        for (const e of sqElements) {
                            active.add(e);
                        }
                    } else if (dataType === 'volume') {
                        const cuElements = comp.units?.exp?.cu || [];
                        for (const e of cuElements) {
                            active.add(e);
                        }
                    }
                }
                // 空白时不显示任何东西（数字和单位都不显示）
            } else if (compType === 'Selector') {
                // Selector组件：根据value显示对应选项的元素
                // 框架元素始终显示
                for (const e of comp.frame || []) {
                    active.add(e);
                }
                // 找到对应value的选项
                const selectedOpt = (comp.options || []).find(opt => opt.value === state.value);
                if (selectedOpt) {
                    for (const e of selectedOpt.elements || []) {
                        active.add(e);
                    }
                }
            } else if (compType === 'Icon') {
                // Icon组件
                if (state.visible !== false) {
                    for (const e of comp.elements || []) {
                        active.add(e);
                    }
                }
            }
            // ========== 旧类型兼容 ==========
            else if (compType === 'ModeSelector' && state.mode) {
                const modeElements = comp.modes?.[state.mode] || [];
                for (const e of modeElements) {
                    active.add(e);
                }
            } else if (compType === 'LevelIndicator' && state.level !== undefined) {
                if (comp.frame) active.add(comp.frame);
                const levelIdx = Math.max(0, state.level - 1);
                const levelElements = comp.levels?.[levelIdx] || [];
                for (const e of levelElements) {
                    active.add(e);
                }
            } else if (compType === 'NumberDisplay') {
                let value = state.value;
                const commonPresets = this.state.commonPresets?.NumberDisplay || {};
                if (state.preset && commonPresets[state.preset]) {
                    value = commonPresets[state.preset];
                }
                if (value !== undefined && value !== null && value !== '') {
                    this.addNumberDisplayElements(comp, String(value), active);
                }
            }
        }
        
        return active;
    },
    
    // 添加Line组件的元素 (v3.0)
    addLineElements(comp, value, active) {
        const digits = comp.digits || [];
        const dots = comp.dots || [];
        
        // 七段数码管字符映射
        const segMap = {
            '0': 'ABCDEF', '1': 'BC', '2': 'ABDEG', '3': 'ABCDG',
            '4': 'BCFG', '5': 'ACDFG', '6': 'ACDEFG', '7': 'ABC',
            '8': 'ABCDEFG', '9': 'ABCDFG', '-': 'G', ' ': '',
            'E': 'ADEFG', 'r': 'EG', 'o': 'CDEG', 'n': 'CEG',
            'F': 'AEFG', 'L': 'DEF', 'H': 'BCEFG', 'P': 'ABEFG',
            'U': 'BCDEF', 'A': 'ABCEFG', 'b': 'CDEFG', 'c': 'DEG',
            'd': 'BCDEG', 'N': 'ABCEF', 'u': 'CDE', 'l': 'EF'
        };
        
        // 处理小数点
        const hasDot = value.includes('.');
        const cleanValue = value.replace('.', '');
        const dotPos = hasDot ? value.indexOf('.') - 1 : -1;
        
        // 从右到左填充数字
        let digitIdx = digits.length - 1;
        let charIdx = cleanValue.length - 1;
        
        while (digitIdx >= 0 && charIdx >= 0) {
            const char = cleanValue[charIdx];
            const digit = digits[digitIdx];
            
            if (digit?.element) {
                const segs = segMap[char] || segMap[char.toUpperCase()] || '';
                // 添加对应段的元素
                this.addDigitSegments(digit.element, segs, active);
            }
            
            digitIdx--;
            charIdx--;
        }
        
        // 添加小数点
        if (hasDot && dotPos >= 0) {
            const dot = dots.find(d => d.afterDigit === dotPos + 1);
            if (dot?.element) {
                active.add(dot.element);
            }
        }
        
        // 添加负号
        if (value.startsWith('-') && comp.minus) {
            active.add(comp.minus);
        }
    },
    
    // 添加数字位的段码元素
    addDigitSegments(elemName, segs, active) {
        if (!this.state.lcdConfig?.elements) return;
        
        // 查找元素
        const elem = this.state.lcdConfig.elements.find(e => (e.name || e.id) === elemName);
        if (!elem) return;
        
        // 添加对应的段
        for (const seg of elem.segments || []) {
            const segName = seg.name?.toUpperCase() || '';
            if (segs.includes(segName)) {
                active.add(`${elemName}:${seg.name}`);
            }
        }
    },
    
    // 添加NumberDisplay组件的元素
    addNumberDisplayElements(comp, value, active) {
        const config = comp.config || {};
        const digits = config.digits || [];
        const dots = config.dots || [];
        
        // 七段数码管字符映射
        const segMap = {
            '0': 'ABCDEF', '1': 'BC', '2': 'ABDEG', '3': 'ABCDG',
            '4': 'BCFG', '5': 'ACDFG', '6': 'ACDEFG', '7': 'ABC',
            '8': 'ABCDEFG', '9': 'ABCDFG', '-': 'G', ' ': '',
            'E': 'ADEFG', 'r': 'EG', 'o': 'CDEG', 'n': 'CEG',
            'F': 'AEFG', 'L': 'DEF', 'H': 'BCEFG', 'P': 'ABEFG',
            'U': 'BCDEF', 'A': 'ABCEFG', 'b': 'CDEFG', 'c': 'DEG',
            'd': 'BCDEG', 'N': 'ABCEF', 'u': 'CDE', 'l': 'EF'
        };
        
        // 处理小数点
        const hasDot = value.includes('.');
        const cleanValue = value.replace('.', '');
        const dotPos = hasDot ? value.indexOf('.') - 1 : -1;
        
        // 从右到左填充数字
        const alignment = config.alignment || 'right';
        let digitIdx = digits.length - 1;
        let charIdx = cleanValue.length - 1;
        
        console.log('[PresetEditor] 渲染NumberDisplay:', value, 'digits:', digits.length, 'lcdConfig:', !!this.state.lcdConfig);
        
        if (alignment === 'right') {
            while (digitIdx >= 0 && charIdx >= 0) {
                const char = cleanValue[charIdx];
                const digit = digits[digitIdx];
                const elemName = digit.element || digit;
                const segsToShow = segMap[char.toUpperCase()] || segMap[char] || '';
                
                console.log('[PresetEditor] 处理字符:', char, '元素:', elemName, '段:', segsToShow);
                
                // 找到LCD project中对应的元素
                const lcdElem = this.state.lcdConfig?.elements?.find(e => e.name === elemName);
                if (lcdElem) {
                    console.log('[PresetEditor] 找到LCD元素:', elemName, 'segments:', lcdElem.segments?.length);
                    // 遍历元素的segments，找到需要点亮的段
                    for (const seg of lcdElem.segments || []) {
                        if (segsToShow.includes(seg.name)) {
                            // 将这个segment标记为需要点亮
                            // 使用 elemName + segName 作为唯一标识
                            const key = `${elemName}:${seg.name}`;
                            active.add(key);
                            console.log('[PresetEditor] 添加段:', key);
                        }
                    }
                } else {
                    console.warn('[PresetEditor] 未找到LCD元素:', elemName);
                }
                
                digitIdx--;
                charIdx--;
            }
        }
        
        // 处理小数点
        if (hasDot && dots.length > 0) {
            for (const dot of dots) {
                if (dot.afterDigit === dotPos) {
                    active.add(dot.element);
                    break;
                }
            }
        }
    },
    
    testPreset() {
        this.showToast('预览已更新', 'info');
        this.renderPreview();
    },
    
    // ========== 工具方法 ==========
    showToast(msg, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    }
};

// 页面加载时初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => PresetEditor.init());
} else {
    PresetEditor.init();
}
