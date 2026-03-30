/**
 * LCD动画效果编辑器 v2.0
 * 统一使用帧序列方式设计动画
 * 每一帧可以设置：组件状态 或 元素列表 + 持续时间
 */

window.AnimEditor = {
    state: {
        animations: {},
        components: {},
        lcdConfig: null,
        selectedAnim: null,
        selectedFrame: null,
        lcdImage: null,
        scale: 1,
        // 播放状态
        isPlaying: false,
        playTimer: null,
        currentFrame: 0,
        currentTime: 0
    },
    
    canvas: null,
    ctx: null,
    hoveredElement: null,
    
    // ========== 初始化 ==========
    async init() {
        console.log('[AnimEditor] 初始化 v2.0');
        
        this.canvas = document.getElementById('anim-lcd-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
            this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
            this.canvas.style.cursor = 'default';
        }
        
        await this.initDeviceManager();
        await this.loadAllConfigs();
        
        console.log('[AnimEditor] 初始化完成');
    },
    
    // ========== Canvas鼠标事件 ==========
    onCanvasMouseMove(e) {
        if (!this.state.lcdConfig?.elements) return;
        if (!this.canvas) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        
        const x = Math.floor(canvasX / this.state.scale);
        const y = Math.floor(canvasY / this.state.scale);
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
        
        if (found !== this.hoveredElement) {
            this.hoveredElement = found;
            this.canvas.style.cursor = found ? 'pointer' : 'default';
            this.renderPreview();
        }
    },
    
    onCanvasClick(e) {
        if (!this.hoveredElement) return;
        
        const id = this.state.selectedAnim;
        const anim = this.state.animations[id];
        if (!anim) {
            this.showToast('请先选择一个动画', 'warning');
            return;
        }
        
        const frameIdx = this.state.selectedFrame;
        if (frameIdx === null || !anim.frames?.[frameIdx]) {
            this.showToast('请先选择一个帧', 'warning');
            return;
        }
        
        // 添加到当前帧的元素列表
        const frame = anim.frames[frameIdx];
        if (!frame.elements) frame.elements = [];
        
        const idx = frame.elements.indexOf(this.hoveredElement);
        if (idx >= 0) {
            frame.elements.splice(idx, 1);
            this.showToast(`已移除: ${this.hoveredElement}`, 'info');
        } else {
            frame.elements.push(this.hoveredElement);
            this.showToast(`已添加: ${this.hoveredElement}`, 'success');
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            const container = document.getElementById('anim-device-selector');
            if (container && typeof createDeviceSelector === 'function') {
                createDeviceSelector('anim-device-selector', {
                    onChange: () => this.loadAllConfigs(),
                    showAdd: false,
                    showManage: true
                });
            }
            
            DeviceConfigManager.subscribe('device-changed', () => this.loadAllConfigs());
            DeviceConfigManager.subscribe('lcd-updated', () => this.loadLcdConfig());
            DeviceConfigManager.subscribe('components-updated', () => this.loadComponents());
        }
    },
    
    // ========== 配置加载 ==========
    async loadAllConfigs() {
        await Promise.all([
            this.loadAnimations(),
            this.loadComponents(),
            this.loadLcdConfig()
        ]);
        
        this.renderList();
        this.renderPreview();
    },
    
    async loadAnimations() {
        try {
            const data = await DeviceConfigManager.loadConfig('animations');
            this.state.animations = data?.animations || {};
            // 迁移旧格式
            this.migrateOldFormat();
            console.log('[AnimEditor] 动画加载:', Object.keys(this.state.animations).length);
        } catch (e) {
            console.warn('[AnimEditor] 加载动画失败:', e);
            this.state.animations = {};
        }
    },
    
    // 迁移旧的 Blink 格式到帧序列格式
    migrateOldFormat() {
        for (const [id, anim] of Object.entries(this.state.animations)) {
            if (anim.type === 'Blink' && !anim.frames) {
                const interval = anim.interval || 300;
                const duty = anim.duty || 50;
                const onTime = Math.round(interval * duty / 100);
                const offTime = interval - onTime;
                
                // 获取目标元素
                let elements = [];
                if (anim.targets) {
                    elements = [...anim.targets];
                } else if (anim.component) {
                    const comp = this.state.components[anim.component];
                    if (comp) {
                        elements = this.getComponentAllElements(comp);
                    }
                }
                
                // 转换为帧序列
                anim.frames = [
                    { duration: onTime, elements: elements },
                    { duration: offTime, elements: [] }
                ];
                anim.loop = anim.count ? false : true;
                
                // 清理旧字段
                delete anim.type;
                delete anim.targets;
                delete anim.interval;
                delete anim.duty;
                delete anim.count;
                delete anim.component;
                
                console.log(`[AnimEditor] 迁移动画 ${id} 到帧序列格式`);
            }
        }
    },
    
    async loadComponents() {
        try {
            const data = await DeviceConfigManager.loadConfig('components');
            this.state.components = data?.components || {};
        } catch (e) {
            console.warn('[AnimEditor] 加载组件失败:', e);
        }
    },
    
    async loadLcdConfig() {
        try {
            const data = await DeviceConfigManager.loadLcdProject();
            if (data?.elements) {
                this.state.lcdConfig = data;
                
                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.state.lcdImage = img;
                        this.renderPreview();
                    };
                    img.src = data.image;
                }
            }
        } catch (e) {
            console.warn('[AnimEditor] 加载LCD配置失败:', e);
        }
    },
    
    // ========== 保存 ==========
    async save() {
        try {
            const data = {
                version: '2.0',
                description: 'LCD动画效果库 - 帧序列格式',
                animations: this.state.animations
            };
            await DeviceConfigManager.saveConfig('animations', data);
            this.showToast('保存成功', 'success');
        } catch (e) {
            this.showToast('保存失败: ' + e.message, 'error');
        }
    },
    
    // ========== 列表渲染 ==========
    renderList() {
        const container = document.getElementById('anim-list');
        if (!container) return;
        
        const anims = this.state.animations;
        if (Object.keys(anims).length === 0) {
            container.innerHTML = `
                <div class="anim-empty">
                    <div class="anim-empty-icon">✨</div>
                    <div>暂无动画</div>
                    <button class="anim-btn" style="margin-top:10px;" onclick="AnimEditor.showAddDialog()">+ 创建动画</button>
                </div>
            `;
            return;
        }
        
        // 按分类分组
        const groups = {};
        for (const [id, anim] of Object.entries(anims)) {
            const cat = anim.category || '其他';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push({ id, ...anim });
        }
        
        let html = '';
        for (const [cat, items] of Object.entries(groups)) {
            html += `<div class="anim-category">${cat}</div>`;
            for (const item of items) {
                const selected = this.state.selectedAnim === item.id ? 'selected' : '';
                const frameCount = item.frames?.length || 0;
                const loopIcon = item.loop !== false ? '🔄' : '➡️';
                html += `
                    <div class="anim-item ${selected}" onclick="AnimEditor.selectAnim('${item.id}')">
                        <span class="icon">${loopIcon}</span>
                        <span class="name">${item.name || item.id}</span>
                        <span class="frame-count">${frameCount}帧</span>
                        <span class="delete" onclick="event.stopPropagation();AnimEditor.deleteAnim('${item.id}')">🗑️</span>
                    </div>
                `;
            }
        }
        
        container.innerHTML = html;
    },
    
    // ========== 选择动画 ==========
    selectAnim(id) {
        this.stopPlay();
        this.state.selectedAnim = id;
        this.state.selectedFrame = null;
        this.state.currentFrame = 0;
        this.state.currentTime = 0;
        
        this.renderList();
        this.renderProperties();
        this.renderPreview();
        
        document.getElementById('anim-preview-name').textContent = 
            this.state.animations[id]?.name || id;
    },
    
    // ========== 属性面板 ==========
    renderProperties() {
        const container = document.getElementById('anim-properties');
        if (!container) return;
        
        const id = this.state.selectedAnim;
        const anim = this.state.animations[id];
        
        if (!anim) {
            container.innerHTML = `
                <div class="anim-empty">
                    <div class="anim-empty-icon">✨</div>
                    <div>选择或创建动画</div>
                </div>
            `;
            return;
        }
        
        const frames = anim.frames || [];
        const totalDuration = frames.reduce((sum, f) => sum + (f.duration || 200), 0);
        
        container.innerHTML = `
            <!-- 基本信息 -->
            <div class="anim-form-group">
                <label>动画ID</label>
                <input type="text" class="anim-input" value="${id}" disabled>
            </div>
            <div class="anim-form-group">
                <label>名称</label>
                <input type="text" class="anim-input" value="${anim.name || ''}" 
                       onchange="AnimEditor.updateProp('name', this.value)">
            </div>
            <div class="anim-form-group">
                <label>分类</label>
                <select class="anim-select" onchange="AnimEditor.updateProp('category', this.value)">
                    <option value="激光" ${anim.category === '激光' ? 'selected' : ''}>激光</option>
                    <option value="基准" ${anim.category === '基准' ? 'selected' : ''}>基准</option>
                    <option value="电池" ${anim.category === '电池' ? 'selected' : ''}>电池</option>
                    <option value="模式提示" ${anim.category === '模式提示' ? 'selected' : ''}>模式提示</option>
                    <option value="连接" ${anim.category === '连接' ? 'selected' : ''}>连接</option>
                    <option value="测量" ${anim.category === '测量' ? 'selected' : ''}>测量</option>
                    <option value="系统" ${anim.category === '系统' ? 'selected' : ''}>系统</option>
                    <option value="其他" ${anim.category === '其他' ? 'selected' : ''}>其他</option>
                </select>
            </div>
            <div class="anim-form-group">
                <label>描述</label>
                <textarea class="anim-textarea" onchange="AnimEditor.updateProp('description', this.value)">${anim.description || ''}</textarea>
            </div>
            <div class="anim-form-group">
                <label>循环播放</label>
                <select class="anim-select" onchange="AnimEditor.updateProp('loop', this.value === 'true')">
                    <option value="true" ${anim.loop !== false ? 'selected' : ''}>是 🔄</option>
                    <option value="false" ${anim.loop === false ? 'selected' : ''}>否 ➡️</option>
                </select>
            </div>
            
            <!-- 帧列表 -->
            <div class="anim-section expanded">
                <div class="anim-section-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>🎬 帧列表 (${frames.length}帧, ${totalDuration}ms)</span>
                    <span class="toggle">▼</span>
                </div>
                <div class="anim-section-content">
                    ${this.renderFrameList(frames)}
                    <div class="add-btn" onclick="AnimEditor.addFrame()">+ 添加帧</div>
                </div>
            </div>
            
            <!-- 当前帧编辑 -->
            ${this.renderFrameEditor()}
        `;
    },
    
    renderFrameList(frames) {
        if (frames.length === 0) {
            return '<div style="color:var(--text-muted);font-size:11px;padding:8px;">暂无帧，点击下方添加</div>';
        }
        
        return frames.map((frame, i) => {
            const selected = this.state.selectedFrame === i ? 'selected' : '';
            const desc = this.getFrameDesc(frame);
            return `
                <div class="frame-item ${selected}" onclick="AnimEditor.selectFrame(${i})">
                    <span class="frame-num">${i + 1}</span>
                    <span class="frame-desc">${desc}</span>
                    <input type="number" class="frame-duration" value="${frame.duration || 200}" 
                           onclick="event.stopPropagation()"
                           onchange="AnimEditor.updateFrameDuration(${i}, parseInt(this.value))">
                    <span class="frame-unit">ms</span>
                    <span class="frame-actions">
                        <span onclick="event.stopPropagation();AnimEditor.duplicateFrame(${i})" title="复制">📋</span>
                        <span onclick="event.stopPropagation();AnimEditor.deleteFrame(${i})" title="删除">🗑️</span>
                    </span>
                </div>
            `;
        }).join('');
    },
    
    getFrameDesc(frame) {
        if (frame.components && Object.keys(frame.components).length > 0) {
            const compNames = Object.keys(frame.components).slice(0, 2).join(', ');
            const more = Object.keys(frame.components).length > 2 ? '...' : '';
            return `组件: ${compNames}${more}`;
        }
        if (frame.elements && frame.elements.length > 0) {
            if (frame.elements.length === 0) return '空白';
            const elemNames = frame.elements.slice(0, 2).join(', ');
            const more = frame.elements.length > 2 ? '...' : '';
            return `元素: ${elemNames}${more}`;
        }
        return '空白帧';
    },
    
    renderFrameEditor() {
        const id = this.state.selectedAnim;
        const anim = this.state.animations[id];
        const frameIdx = this.state.selectedFrame;
        
        if (frameIdx === null || !anim?.frames?.[frameIdx]) {
            return `
                <div class="anim-section">
                    <div class="anim-section-header">
                        <span>📝 帧编辑</span>
                    </div>
                    <div class="anim-section-content">
                        <div style="color:var(--text-muted);font-size:11px;padding:8px;">选择一个帧进行编辑</div>
                    </div>
                </div>
            `;
        }
        
        const frame = anim.frames[frameIdx];
        const components = frame.components || {};
        const elements = frame.elements || [];
        
        return `
            <div class="anim-section expanded">
                <div class="anim-section-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>📝 帧${frameIdx + 1}编辑</span>
                    <span class="toggle">▼</span>
                </div>
                <div class="anim-section-content">
                    <!-- 组件状态 -->
                    <div style="margin-bottom:10px;">
                        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">组件状态 (${Object.keys(components).length})</div>
                        ${this.renderFrameComponents(components, frameIdx)}
                        <div class="add-btn" onclick="AnimEditor.showAddFrameComponent(${frameIdx})">+ 添加组件</div>
                    </div>
                    
                    <!-- 直接元素 -->
                    <div>
                        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">直接元素 (${elements.length})</div>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;">
                            ${elements.map(e => `
                                <span class="element-tag">
                                    ${e}
                                    <span class="remove" onclick="AnimEditor.removeFrameElement(${frameIdx}, '${e}')">×</span>
                                </span>
                            `).join('')}
                        </div>
                        <div class="add-btn" onclick="AnimEditor.showAddFrameElement(${frameIdx})">+ 添加元素</div>
                    </div>
                </div>
            </div>
        `;
    },
    
    renderFrameComponents(components, frameIdx) {
        if (Object.keys(components).length === 0) {
            return '<div style="color:var(--text-muted);font-size:10px;margin-bottom:6px;">暂无组件状态</div>';
        }
        
        return Object.entries(components).map(([compName, state]) => {
            const comp = this.state.components[compName];
            if (!comp) return '';
            
            const compType = comp.type || '';
            let stateEditor = '';
            
            if (compType === 'Icon') {
                // Icon: 显示/隐藏选择
                stateEditor = `
                    <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'visible', this.value === 'true')">
                        <option value="true" ${state.visible !== false ? 'selected' : ''}>显示</option>
                        <option value="false" ${state.visible === false ? 'selected' : ''}>隐藏</option>
                    </select>
                `;
            } else if (compType === 'Selector') {
                // Selector: 选择选项值
                const options = comp.options || [];
                stateEditor = `
                    <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'value', parseInt(this.value))">
                        ${options.map(opt => `
                            <option value="${opt.value}" ${state.value === opt.value ? 'selected' : ''}>${opt.key}</option>
                        `).join('')}
                    </select>
                `;
            } else if (compType === 'Line') {
                // Line: 完整属性支持
                stateEditor = this.renderLineStateEditor(compName, state, frameIdx);
            }
            
            return `
                <div class="frame-comp-item" style="flex-direction:column;align-items:stretch;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:${compType === 'Line' ? '6px' : '0'};">
                        <span class="comp-name">${compName}</span>
                        <span class="comp-type">${this.getCompTypeLabel(compType)}</span>
                        <span style="flex:1;"></span>
                        ${compType !== 'Line' ? stateEditor : ''}
                        <span class="remove" onclick="AnimEditor.removeFrameComponent(${frameIdx}, '${compName}')">×</span>
                    </div>
                    ${compType === 'Line' ? stateEditor : ''}
                </div>
            `;
        }).join('');
    },
    
    // Line组件状态编辑器
    renderLineStateEditor(compName, state, frameIdx) {
        const mode = state.mode || (state.value !== undefined ? 'value' : 'preset');
        
        return `
            <div class="line-state-editor">
                <div class="line-state-row">
                    <label>模式</label>
                    <select class="frame-comp-select" onchange="AnimEditor.updateLineMode(${frameIdx}, '${compName}', this.value)">
                        <option value="preset" ${mode === 'preset' ? 'selected' : ''}>预设值</option>
                        <option value="value" ${mode === 'value' ? 'selected' : ''}>自定义值</option>
                    </select>
                </div>
                ${mode === 'preset' ? `
                    <div class="line-state-row">
                        <label>预设</label>
                        <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'preset', this.value)">
                            <option value="dash" ${state.preset === 'dash' || !state.preset ? 'selected' : ''}>横线 -----</option>
                            <option value="blank" ${state.preset === 'blank' ? 'selected' : ''}>空白</option>
                            <option value="error" ${state.preset === 'error' ? 'selected' : ''}>错误 Err</option>
                        </select>
                    </div>
                    <div class="line-state-row">
                        <label>显示单位</label>
                        <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'showUnit', this.value === 'true')">
                            <option value="true" ${state.showUnit !== false ? 'selected' : ''}>是</option>
                            <option value="false" ${state.showUnit === false ? 'selected' : ''}>否</option>
                        </select>
                    </div>
                    ${state.showUnit !== false ? `
                        <div class="line-state-row">
                            <label>单位</label>
                            <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'unit', parseInt(this.value))">
                                <option value="0" ${state.unit === 0 || state.unit === undefined ? 'selected' : ''}>m</option>
                                <option value="1" ${state.unit === 1 ? 'selected' : ''}>ft</option>
                                <option value="2" ${state.unit === 2 ? 'selected' : ''}>in</option>
                            </select>
                        </div>
                    ` : ''}
                ` : ''}
                ${mode === 'value' ? `
                    <div class="line-state-row">
                        <label>数值</label>
                        <input type="number" class="frame-comp-input" style="flex:1;" step="0.001"
                               value="${state.value !== undefined ? state.value : ''}" placeholder="如 12.345"
                               onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'value', parseFloat(this.value))">
                    </div>
                    <div class="line-state-row">
                        <label>数据类型</label>
                        <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'dataType', this.value)">
                            <option value="length" ${state.dataType === 'length' || !state.dataType ? 'selected' : ''}>长度</option>
                            <option value="area" ${state.dataType === 'area' ? 'selected' : ''}>面积</option>
                            <option value="volume" ${state.dataType === 'volume' ? 'selected' : ''}>体积</option>
                        </select>
                    </div>
                    <div class="line-state-row">
                        <label>单位</label>
                        <select class="frame-comp-select" onchange="AnimEditor.updateFrameCompState(${frameIdx}, '${compName}', 'unit', parseInt(this.value))">
                            <option value="0" ${state.unit === 0 || state.unit === undefined ? 'selected' : ''}>m/m²/m³</option>
                            <option value="1" ${state.unit === 1 ? 'selected' : ''}>ft/ft²/ft³</option>
                            <option value="2" ${state.unit === 2 ? 'selected' : ''}>in/in²/in³</option>
                        </select>
                    </div>
                ` : ''}
            </div>
        `;
    },
    
    // 更新Line组件模式
    updateLineMode(frameIdx, compName, mode) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const frame = this.state.animations[id].frames[frameIdx];
        if (!frame.components) frame.components = {};
        if (!frame.components[compName]) frame.components[compName] = {};
        
        const state = frame.components[compName];
        state.mode = mode;
        
        // 清理其他模式的属性
        if (mode === 'preset') {
            delete state.value;
            delete state.bind;
            delete state.dataType;
            delete state.unit;
            if (!state.preset) state.preset = 'dash';
        } else if (mode === 'value') {
            delete state.preset;
            delete state.bind;
            if (state.value === undefined) state.value = 0;
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    // 更新帧中组件状态
    updateFrameCompState(frameIdx, compName, key, value) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const frame = this.state.animations[id].frames[frameIdx];
        if (!frame.components) frame.components = {};
        if (!frame.components[compName]) frame.components[compName] = {};
        
        frame.components[compName][key] = value;
        
        // 如果是Line设置了value，清除preset
        if (key === 'value') {
            delete frame.components[compName].preset;
        }
        
        this.renderPreview();
    },
    
    // ========== 帧操作 ==========
    selectFrame(index) {
        this.state.selectedFrame = index;
        this.state.currentFrame = index;
        this.renderProperties();
        this.renderPreview();
    },
    
    addFrame() {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]) return;
        
        if (!this.state.animations[id].frames) {
            this.state.animations[id].frames = [];
        }
        
        this.state.animations[id].frames.push({
            duration: 300,
            components: {},
            elements: []
        });
        
        // 选中新添加的帧
        this.state.selectedFrame = this.state.animations[id].frames.length - 1;
        this.renderProperties();
        this.showToast('已添加帧', 'success');
    },
    
    duplicateFrame(index) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[index]) return;
        
        const frame = this.state.animations[id].frames[index];
        const newFrame = JSON.parse(JSON.stringify(frame));
        
        this.state.animations[id].frames.splice(index + 1, 0, newFrame);
        this.state.selectedFrame = index + 1;
        this.renderProperties();
        this.showToast('已复制帧', 'success');
    },
    
    deleteFrame(index) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames) return;
        
        this.state.animations[id].frames.splice(index, 1);
        
        if (this.state.selectedFrame === index) {
            this.state.selectedFrame = null;
        } else if (this.state.selectedFrame > index) {
            this.state.selectedFrame--;
        }
        
        this.renderProperties();
        this.renderPreview();
    },
    
    updateFrameDuration(index, duration) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[index]) return;
        
        this.state.animations[id].frames[index].duration = duration;
        this.renderProperties();
    },
    
    // ========== 帧内容编辑 ==========
    showAddFrameComponent(frameIdx) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const frame = this.state.animations[id].frames[frameIdx];
        const existingComps = new Set(Object.keys(frame.components || {}));
        
        const availableComps = Object.entries(this.state.components)
            .filter(([name, _]) => !existingComps.has(name))
            .map(([name, comp]) => ({
                value: name,
                label: `${name} (${this.getCompTypeLabel(comp.type)})`,
                icon: this.getCompTypeIcon(comp.type)
            }));
        
        if (availableComps.length === 0) {
            this.showToast('所有组件都已添加', 'info');
            return;
        }
        
        this.showSelectDialog('选择组件', availableComps, (compName) => {
            if (!compName) return;
            
            const comp = this.state.components[compName];
            const compType = comp.type || '';
            let defaultState = {};
            
            if (compType === 'Icon') {
                defaultState = { visible: true };
            } else if (compType === 'Selector') {
                defaultState = { value: comp.default || 0 };
            } else if (compType === 'Line') {
                defaultState = { preset: 'dash' };
            }
            
            if (!frame.components) frame.components = {};
            frame.components[compName] = defaultState;
            
            this.renderProperties();
            this.renderPreview();
            this.showToast(`已添加: ${compName}`, 'success');
        });
    },
    
    removeFrameComponent(frameIdx, compName) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        delete this.state.animations[id].frames[frameIdx].components[compName];
        this.renderProperties();
        this.renderPreview();
    },
    
    removeFrameElement(frameIdx, elemName) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const elements = this.state.animations[id].frames[frameIdx].elements || [];
        const idx = elements.indexOf(elemName);
        if (idx >= 0) {
            elements.splice(idx, 1);
            this.renderProperties();
            this.renderPreview();
        }
    },
    
    // 显示添加元素对话框
    showAddFrameElement(frameIdx) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const frame = this.state.animations[id].frames[frameIdx];
        const existingElements = new Set(frame.elements || []);
        
        // 获取所有可用元素
        const allElements = (this.state.lcdConfig?.elements || []).map(e => e.name || e.id);
        const availableElements = allElements.filter(e => !existingElements.has(e));
        
        if (availableElements.length === 0) {
            this.showToast('所有元素都已添加', 'info');
            return;
        }
        
        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'anim-dialog-overlay';
        dialog.innerHTML = `
            <div class="anim-dialog" style="width:400px;max-height:500px;">
                <div class="anim-dialog-header">
                    <span>选择元素</span>
                    <button class="anim-dialog-close" onclick="this.closest('.anim-dialog-overlay').remove()">×</button>
                </div>
                <div class="anim-dialog-body" style="max-height:400px;overflow-y:auto;">
                    <input type="text" class="anim-input" placeholder="搜索元素..." 
                           oninput="AnimEditor.filterElementList(this.value)" style="margin-bottom:10px;">
                    <div id="anim-element-list" style="display:flex;flex-wrap:wrap;gap:4px;">
                        ${availableElements.map(e => `
                            <span class="element-select-tag" onclick="AnimEditor.addFrameElementFromDialog(${frameIdx}, '${e}')">
                                ${e}
                            </span>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        // 保存可用元素列表供搜索用
        this._availableElements = availableElements;
        this._currentFrameIdx = frameIdx;
    },
    
    // 搜索过滤元素列表
    filterElementList(keyword) {
        const container = document.getElementById('anim-element-list');
        if (!container) return;
        
        const filtered = this._availableElements.filter(e => 
            e.toLowerCase().includes(keyword.toLowerCase())
        );
        
        container.innerHTML = filtered.map(e => `
            <span class="element-select-tag" onclick="AnimEditor.addFrameElementFromDialog(${this._currentFrameIdx}, '${e}')">
                ${e}
            </span>
        `).join('');
    },
    
    // 从对话框添加元素
    addFrameElementFromDialog(frameIdx, elemName) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]?.frames?.[frameIdx]) return;
        
        const frame = this.state.animations[id].frames[frameIdx];
        if (!frame.elements) frame.elements = [];
        
        if (!frame.elements.includes(elemName)) {
            frame.elements.push(elemName);
            this.showToast(`已添加: ${elemName}`, 'success');
        }
        
        // 关闭对话框
        document.querySelector('.anim-dialog-overlay')?.remove();
        
        this.renderProperties();
        this.renderPreview();
    },
    
    getCompTypeIcon(type) {
        const icons = {
            'Line': '🔢',
            'Selector': '🔘',
            'Icon': '💡'
        };
        return icons[type] || '📦';
    },
    
    getCompTypeLabel(type) {
        const labels = {
            'Line': '数字行',
            'Selector': '选择器',
            'Icon': '图标'
        };
        return labels[type] || type;
    },
    
    // ========== 属性更新 ==========
    updateProp(key, value) {
        const id = this.state.selectedAnim;
        if (!id || !this.state.animations[id]) return;
        
        this.state.animations[id][key] = value;
        this.renderList();
    },
    
    // ========== 播放控制 ==========
    togglePlay() {
        if (this.state.isPlaying) {
            this.stopPlay();
        } else {
            this.startPlay();
        }
    },
    
    startPlay() {
        const id = this.state.selectedAnim;
        const anim = this.state.animations[id];
        if (!anim?.frames?.length) {
            this.showToast('动画没有帧', 'warning');
            return;
        }
        
        this.state.isPlaying = true;
        this.state.currentTime = 0;
        this.state.currentFrame = 0;
        
        document.getElementById('anim-play-btn').classList.add('playing');
        document.getElementById('anim-play-btn').textContent = '⏹';
        
        this.playNextFrame();
    },
    
    stopPlay() {
        this.state.isPlaying = false;
        if (this.state.playTimer) {
            clearTimeout(this.state.playTimer);
            this.state.playTimer = null;
        }
        
        const btn = document.getElementById('anim-play-btn');
        if (btn) {
            btn.classList.remove('playing');
            btn.textContent = '▶';
        }
    },
    
    playNextFrame() {
        if (!this.state.isPlaying) return;
        
        const anim = this.state.animations[this.state.selectedAnim];
        if (!anim?.frames?.length) return;
        
        const frame = anim.frames[this.state.currentFrame];
        this.renderPreview();
        this.updateTimeLabel();
        
        const duration = frame.duration || 200;
        
        this.state.playTimer = setTimeout(() => {
            this.state.currentTime += duration;
            this.state.currentFrame++;
            
            if (this.state.currentFrame >= anim.frames.length) {
                if (anim.loop !== false) {
                    this.state.currentFrame = 0;
                    this.state.currentTime = 0;
                } else {
                    this.stopPlay();
                    return;
                }
            }
            
            this.playNextFrame();
        }, duration);
    },
    
    updateTimeLabel() {
        const anim = this.state.animations[this.state.selectedAnim];
        if (!anim?.frames) return;
        
        const totalTime = anim.frames.reduce((sum, f) => sum + (f.duration || 200), 0);
        
        const timeLabel = document.getElementById('anim-time');
        if (timeLabel) {
            timeLabel.textContent = `${this.state.currentTime}ms / ${totalTime}ms`;
        }
        
        const progress = document.getElementById('anim-progress');
        if (progress && totalTime > 0) {
            progress.style.width = `${(this.state.currentTime % totalTime) / totalTime * 100}%`;
        }
        
        const frameInfo = document.getElementById('anim-frame-info');
        if (frameInfo) {
            frameInfo.textContent = `帧 ${this.state.currentFrame + 1}/${anim.frames.length}`;
        }
    },
    
    // ========== 预览渲染 ==========
    renderPreview() {
        if (!this.canvas || !this.ctx) return;
        
        const ctx = this.ctx;
        const config = this.state.lcdConfig;
        const img = this.state.lcdImage;
        
        let w = 400, h = 200;
        if (img) {
            w = config?.imageWidth || img.naturalWidth || 400;
            h = config?.imageHeight || img.naturalHeight || 200;
        }
        
        const container = this.canvas.parentElement;
        if (container) {
            const maxW = container.clientWidth - 40;
            const maxH = container.clientHeight - 40;
            this.state.scale = Math.min(maxW / w, maxH / h, 2);
        }
        
        const s = this.state.scale;
        this.canvas.width = w * s;
        this.canvas.height = h * s;
        
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (img) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(img, 0, 0, w * s, h * s);
            ctx.globalAlpha = 1;
        }
        
        if (!config?.elements) return;
        
        // 获取活动状态：包含元素级别和段级别
        const { activeElements, activeSegments } = this.getActiveElementsAndSegments();
        
        for (const elem of config.elements) {
            const elemName = elem.name || elem.id;
            const isElementActive = activeElements.has(elemName);
            const isHovered = elemName === this.hoveredElement;
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixels || [];
                if (pixels.length === 0) continue;
                
                // 检查段级别激活状态
                const segKey = `${elemName}:${seg.name}`;
                const isSegActive = activeSegments.has(segKey);
                
                if (isHovered) {
                    ctx.fillStyle = '#ffff00';
                } else if (isSegActive || isElementActive) {
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
        
        if (this.hoveredElement) {
            const text = `选中: ${this.hoveredElement}`;
            ctx.font = 'bold 14px sans-serif';
            const textWidth = ctx.measureText(text).width;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.fillRect(8, 8, textWidth + 20, 28);
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.strokeRect(8, 8, textWidth + 20, 28);
            
            ctx.fillStyle = '#ffff00';
            ctx.fillText(text, 18, 27);
        }
    },
    
    getActiveElementsAndSegments() {
        const activeElements = new Set();  // 元素级别激活
        const activeSegments = new Set();  // 段级别激活 (格式: "elementName:segName")
        
        const id = this.state.selectedAnim;
        const anim = this.state.animations[id];
        
        if (!anim?.frames?.length) return { activeElements, activeSegments };
        
        const frameIdx = this.state.isPlaying ? this.state.currentFrame : (this.state.selectedFrame ?? 0);
        const frame = anim.frames[frameIdx];
        if (!frame) return { activeElements, activeSegments };
        
        // 直接元素 - 元素级别激活
        for (const e of frame.elements || []) {
            activeElements.add(e);
        }
        
        // 组件状态
        for (const [compName, state] of Object.entries(frame.components || {})) {
            const comp = this.state.components[compName];
            if (!comp) continue;
            
            const compType = comp.type || '';
            
            if (compType === 'Icon') {
                if (state.visible !== false) {
                    for (const e of comp.elements || []) {
                        activeElements.add(e);
                    }
                }
            } else if (compType === 'Selector') {
                for (const e of comp.frame || []) {
                    activeElements.add(e);
                }
                const selectedOpt = (comp.options || []).find(opt => opt.value === state.value);
                if (selectedOpt) {
                    for (const e of selectedOpt.elements || []) {
                        activeElements.add(e);
                    }
                }
            } else if (compType === 'Line') {
                // Line组件渲染 - 段级别
                this.renderLineToActiveSegments(comp, state, activeElements, activeSegments);
            }
        }
        
        return { activeElements, activeSegments };
    },
    
    // 渲染Line组件到active集合 - 段级别渲染
    renderLineToActiveSegments(comp, state, activeElements, activeSegments) {
        const digits = comp.digits || [];
        const dots = comp.dots || [];
        const units = comp.units || {};
        
        // 7段码字模 - 每个字符对应哪些段点亮
        // 段顺序: A(0), B(1), C(2), D(3), E(4), F(5), G(6)
        const DIGIT_FONT = {
            '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66,
            '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
            '-': 0x40, ' ': 0x00, 'E': 0x79, 'r': 0x50
        };
        const SEG_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        
        // 确定显示内容
        let displayStr = '';
        let showUnit = state.showUnit !== false;
        let unitIndex = state.unit || 0;
        
        if (state.preset) {
            if (state.preset === 'dash') {
                displayStr = '-----';
            } else if (state.preset === 'blank') {
                displayStr = '';
                showUnit = false;
            } else if (state.preset === 'error') {
                displayStr = '  Err';
            }
        } else if (state.value !== undefined) {
            displayStr = String(state.value);
        }
        
        // 渲染数字
        if (displayStr) {
            // 处理小数点位置
            const dotPos = displayStr.indexOf('.');
            const pureStr = displayStr.replace('.', '');
            
            // 右对齐填充
            const chars = pureStr.padStart(digits.length, ' ').slice(-digits.length).split('');
            
            for (let i = 0; i < digits.length && i < chars.length; i++) {
                const digit = digits[i];
                if (!digit?.element) continue;
                
                const char = chars[i];
                const pattern = DIGIT_FONT[char] || 0;
                
                // 找到元素
                const elem = this.findElement(digit.element);
                if (elem && pattern > 0) {
                    // 遍历7段，只点亮需要的段
                    for (let s = 0; s < 7; s++) {
                        if (pattern & (1 << s)) {
                            const segName = SEG_NAMES[s];
                            // 添加段级别激活
                            activeSegments.add(`${digit.element}:${segName}`);
                        }
                    }
                }
            }
            
            // 渲染小数点
            if (dotPos >= 0) {
                // 计算小数点应该在哪个数字后面
                const dotAfterDigit = dotPos - (displayStr.length - digits.length);
                for (const dot of dots) {
                    if (dot.element && dot.afterDigit === dotAfterDigit) {
                        activeElements.add(dot.element);
                    }
                }
            }
        }
        
        // 渲染单位
        if (showUnit && units.base) {
            const unitKeys = ['m', 'ft', 'in'];
            const unitKey = unitKeys[unitIndex] || 'm';
            const unitElements = units.base[unitKey] || [];
            for (const e of unitElements) {
                activeElements.add(e);
            }
        }
    },
    
    // 查找元素
    findElement(elemName) {
        if (!this.state.lcdConfig?.elements) return null;
        return this.state.lcdConfig.elements.find(e => (e.name || e.id) === elemName);
    },
    
    getComponentAllElements(comp) {
        const elements = [];
        if (!comp) return elements;
        
        const compType = comp.type || '';
        
        if (compType === 'Icon') {
            elements.push(...(comp.elements || []));
        } else if (compType === 'Selector') {
            elements.push(...(comp.frame || []));
            for (const opt of comp.options || []) {
                elements.push(...(opt.elements || []));
            }
        } else if (compType === 'Line') {
            for (const d of comp.digits || []) {
                if (d.element) elements.push(d.element);
            }
            for (const d of comp.dots || []) {
                if (d.element) elements.push(d.element);
            }
        }
        
        return elements;
    },

    // ========== 对话框 ==========
    showSelectDialog(title, options, callback) {
        const existing = document.getElementById('anim-select-dialog');
        if (existing) existing.remove();
        
        const dialog = document.createElement('div');
        dialog.id = 'anim-select-dialog';
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.6); z-index: 10000;
            display: flex; align-items: center; justify-content: center;
        `;
        
        dialog.innerHTML = `
            <div style="background: var(--bg-secondary); border-radius: 8px; padding: 20px; width: 400px; max-height: 80vh; overflow-y: auto;">
                <h3 style="margin: 0 0 15px 0; font-size: 14px; display: flex; justify-content: space-between;">
                    <span>${title}</span>
                    <button onclick="document.getElementById('anim-select-dialog').remove()" 
                            style="background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer;">×</button>
                </h3>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${options.map(opt => `
                        <div class="dialog-option-item" data-value="${opt.value}" style="
                            padding: 10px 12px; background: var(--bg-tertiary); border-radius: 4px;
                            cursor: pointer; border: 1px solid transparent; font-size: 13px;
                            display: flex; align-items: center; gap: 8px;
                        ">
                            <span>${opt.icon || '📦'}</span>
                            <span>${opt.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        dialog.querySelectorAll('.dialog-option-item').forEach(opt => {
            opt.onclick = () => {
                dialog.remove();
                callback(opt.dataset.value);
            };
            opt.onmouseover = () => { opt.style.borderColor = 'var(--accent-color)'; };
            opt.onmouseout = () => { opt.style.borderColor = 'transparent'; };
        });
        
        dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); };
    },
    
    // ========== 添加/删除/复制动画 ==========
    showAddDialog() {
        const id = prompt('输入动画ID (英文，如 laserBlink):');
        if (!id || !id.trim()) return;
        
        const animId = id.trim().replace(/\s+/g, '_');
        if (this.state.animations[animId]) {
            this.showToast('动画已存在', 'error');
            return;
        }
        
        this.state.animations[animId] = {
            name: '新动画',
            description: '',
            category: '其他',
            loop: true,
            frames: [
                { duration: 300, components: {}, elements: [] },
                { duration: 300, components: {}, elements: [] }
            ]
        };
        
        this.selectAnim(animId);
        this.showToast('已创建动画', 'success');
    },
    
    deleteAnim(id) {
        if (!confirm(`删除动画 "${this.state.animations[id]?.name || id}"?`)) return;
        
        delete this.state.animations[id];
        if (this.state.selectedAnim === id) {
            this.state.selectedAnim = null;
            this.state.selectedFrame = null;
            this.stopPlay();
        }
        
        this.renderList();
        this.renderProperties();
        this.showToast('已删除', 'info');
    },
    
    duplicate() {
        const id = this.state.selectedAnim;
        if (!id) {
            this.showToast('请先选择动画', 'warning');
            return;
        }
        
        const newId = id + '_copy';
        this.state.animations[newId] = JSON.parse(JSON.stringify(this.state.animations[id]));
        this.state.animations[newId].name = (this.state.animations[id].name || id) + ' 副本';
        
        this.selectAnim(newId);
        this.showToast('已复制', 'success');
    },
    
    // ========== 快捷创建 ==========
    createBlinkAnim() {
        // 快速创建闪烁动画
        const id = prompt('输入动画ID:');
        if (!id) return;
        
        this.state.animations[id] = {
            name: '闪烁动画',
            category: '其他',
            loop: true,
            frames: [
                { duration: 300, components: {}, elements: [] },
                { duration: 300, components: {}, elements: [] }
            ]
        };
        
        this.selectAnim(id);
        this.state.selectedFrame = 0;
        this.renderProperties();
        this.showToast('已创建闪烁动画模板，请编辑第1帧(显示)和第2帧(隐藏)', 'info');
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
    document.addEventListener('DOMContentLoaded', () => AnimEditor.init());
} else {
    AnimEditor.init();
}
