/**
 * LCD组件编辑器 - 组合元素为可复用组件
 * 
 * v2.0 架构:
 * - 组件 (Components): 数据到显示的映射
 *   - NumberDisplay, ModeSelector, LevelIndicator, Icon
 * - 行为 (Behaviors): 动态效果，可附加到组件或元素
 *   - Blink: 闪烁效果
 *   - Animation: 帧动画
 * - 规则 (Rules): 事件驱动的智能联动
 *   - 触发器: timeout, componentChange, event
 *   - 动作: startBehavior, stopBehavior, emit
 */

window.CompEditor = {
    state: {
        components: {},      // 组件配置
        behaviors: {},       // 行为配置
        hardwareCallbacks: [], // 硬件回调库
        elements: [],        // 可用元素 (从lcd/project.json)
        lcdConfig: null,     // LCD配置
        lcdImage: null,      // LCD背景图
        selectedComp: null,  // 当前选中组件
        selectedBehavior: null, // 当前选中行为
        selectedMode: null,  // 当前选中模式
        zoom: 1,
        panX: 0,
        panY: 0,
        highlightElements: new Set(),
        elementPicker: null,
        currentTab: 'components',
        lastClickedElement: null,  // 上次点击的元素，用于Shift范围选择
    },
    
    canvas: null,
    ctx: null,
    
    // 组件类型定义 v3.0 - 简化为3种类型
    COMP_TYPES: {
        Line: { icon: '🔢', name: 'Line数字行', desc: '数字显示+单位转换' },
        Selector: { icon: '🔘', name: 'Selector选择器', desc: '模式/等级选择' },
        Icon: { icon: '💡', name: 'Icon图标', desc: '显示/隐藏图标' },
        // 兼容旧类型
        NumberDisplay: { icon: '🔢', name: '数字显示(旧)', desc: '显示数字，支持小数', legacy: true },
        ModeSelector: { icon: '🔘', name: '模式选择(旧)', desc: '不同模式亮不同元素', legacy: true },
        LevelIndicator: { icon: '📊', name: '等级指示(旧)', desc: '电池、信号等级', legacy: true },
    },
    
    // 行为类型定义
    BEHAVIOR_TYPES: {
        Blink: { icon: '✨', name: '闪烁', desc: '周期性闪烁效果' },
        Animation: { icon: '🎬', name: '动画', desc: '帧动画效果' },
    },
    
    // 触发器类型
    TRIGGER_TYPES: {
        timeout: { name: '超时', desc: '行为运行指定时间后触发' },
        componentChange: { name: '组件变化', desc: '组件值变化时触发' },
        event: { name: '事件', desc: '收到指定事件时触发' },
    },
    
    // 动作类型
    ACTION_TYPES: {
        startBehavior: { name: '启动行为', desc: '启动指定行为' },
        stopBehavior: { name: '停止行为', desc: '停止指定行为' },
        emit: { name: '发送事件', desc: '发送自定义事件' },
        setValue: { name: '设置值', desc: '设置组件值' },
    },
    
    // 7段码字模
    DIGIT_FONT: {
        '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66,
        '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
        '-': 0x40, ' ': 0x00, 'N': 0x37, 'U': 0x3E, 'L': 0x38,
        'E': 0x79, 'r': 0x50, 'o': 0x5C, 'H': 0x76,
    },
    
    // ========== 初始化 ==========
    async init() {
        console.log('[CompEditor] 初始化 v2.0');
        
        this.canvas = document.getElementById('comp-lcd-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.setupCanvasEvents();
        }
        
        await this.initDeviceManager();
        await this.loadAllConfigs();
        
        console.log('[CompEditor] 初始化完成');
    },
    
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            if (typeof createDeviceSelector === 'function') {
                createDeviceSelector('comp-device-selector', {
                    onChange: () => this.loadAllConfigs(),
                    showAdd: false,
                    showManage: true
                });
            }
            
            DeviceConfigManager.subscribe('device-changed', () => this.loadAllConfigs());
            DeviceConfigManager.subscribe('lcd-updated', () => this.loadLcdConfig());
        }
    },
    
    async loadAllConfigs() {
        await this.loadLcdConfig();
        await this.loadComponents();
        this.renderComponentList();
        this.renderBehaviorList();
        this.renderHardwareList();
        this.renderElementList();
        this.render();
    },
    
    async loadLcdConfig() {
        try {
            const data = await DeviceConfigManager.loadLcdProject();
            if (data) {
                this.state.lcdConfig = data;
                this.state.elements = data.elements || [];
                console.log('[CompEditor] LCD配置:', this.state.elements.length, '元素');
                
                if (data.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.state.lcdImage = img;
                        this.render();
                    };
                    img.src = data.image;
                }
            }
        } catch (e) {
            console.warn('[CompEditor] 加载LCD配置失败:', e);
        }
    },
    
    async loadComponents() {
        try {
            const data = await DeviceConfigManager.loadConfig('components');
            if (data) {
                this.state.components = data.components || {};
                this.state.behaviors = data.behaviors || {};
                this.state.hardwareCallbacks = data.hardwareCallbacks || [];
                console.log('[CompEditor] 加载完成 - 组件:', Object.keys(this.state.components).length,
                    '行为:', Object.keys(this.state.behaviors).length,
                    '硬件回调:', this.state.hardwareCallbacks.length);
            }
        } catch (e) {
            this.state.components = {};
            this.state.behaviors = {};
            this.state.hardwareCallbacks = [];
        }
    },
    
    async save() {
        try {
            await DeviceConfigManager.saveConfig('components', {
                version: '2.0',
                saveTime: new Date().toISOString(),
                components: this.state.components,
                behaviors: this.state.behaviors,
                hardwareCallbacks: this.state.hardwareCallbacks
            });
            this.showToast('保存成功', 'success');
        } catch (e) {
            this.showToast('保存失败: ' + e.message, 'error');
        }
    },

    // ========== 画布事件 ==========
    setupCanvasEvents() {
        this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        
        // 拖动平移
        let isDragging = false;
        let lastX = 0, lastY = 0;
        
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && e.shiftKey)) { // 中键或Shift+左键
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                this.state.panX += e.clientX - lastX;
                this.state.panY += e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;
                this.render();
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.canvas.style.cursor = 'crosshair';
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            if (isDragging) {
                isDragging = false;
                this.canvas.style.cursor = 'crosshair';
            }
        });
    },
    
    onCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.state.panX) / this.state.zoom;
        const y = (e.clientY - rect.top - this.state.panY) / this.state.zoom;
        
        // 查找点击的元素
        const elem = this.findElementAt(x, y);
        if (elem) {
            const elemName = elem.name || elem.id;
            
            // 如果有元素选择器激活，填充到对应字段
            if (this.state.elementPicker) {
                this.fillElementPicker(elemName);
                return;
            }
            
            if (this.state.selectedComp) {
                // 有选中组件时，添加/移除元素
                this.toggleElementInComponent(elemName);
            } else {
                // 没有选中组件时，只高亮并滚动到元素
                this.selectElementFromCanvas(elemName);
            }
        }
    },
    
    onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.state.zoom = Math.max(0.3, Math.min(3, this.state.zoom * factor));
        this.render();
    },
    
    findElementAt(x, y) {
        for (const elem of this.state.elements) {
            for (const seg of elem.segments || []) {
                const pixels = seg.pixelMask || seg.pixels || [];
                const pixelSet = pixels instanceof Set ? pixels : new Set(pixels);
                for (const pkey of pixelSet) {
                    const [px, py] = pkey.split(',').map(Number);
                    if (Math.abs(px - x) < 5 && Math.abs(py - y) < 5) {
                        return elem;
                    }
                }
            }
        }
        return null;
    },
    
    resetView() {
        this.state.zoom = 1;
        this.state.panX = 0;
        this.state.panY = 0;
        this.render();
    },
    
    // Tab切换
    switchTab(tab) {
        this.state.currentTab = tab;
        
        // 更新Tab按钮状态
        document.querySelectorAll('.comp-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        // 更新Tab内容显示
        document.querySelectorAll('.comp-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tab}`);
        });
        
        // 如果切换到元素Tab且有选择器激活，保持选择模式
        if (tab === 'elements' && this.state.elementPicker) {
            this.renderElementList();
        }
    },

    // ========== 渲染 ==========
    render() {
        if (!this.ctx) return;
        
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const s = this.state.zoom;
        
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
        
        // 背景图
        if (this.state.lcdImage) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(this.state.lcdImage, this.state.panX, this.state.panY,
                (this.state.lcdConfig?.imageWidth || 400) * s,
                (this.state.lcdConfig?.imageHeight || 200) * s);
            ctx.globalAlpha = 1;
        }
        
        // 渲染元素
        for (const elem of this.state.elements) {
            const isHighlight = this.state.highlightElements.has(elem.name || elem.id);
            
            for (const seg of elem.segments || []) {
                const pixels = seg.pixelMask || seg.pixels || [];
                const pixelSet = pixels instanceof Set ? pixels : new Set(pixels);
                
                if (isHighlight) {
                    ctx.fillStyle = '#00ff88';
                } else {
                    ctx.fillStyle = 'rgba(42, 58, 42, 0.4)';
                }
                
                for (const pkey of pixelSet) {
                    const [px, py] = pkey.split(',').map(Number);
                    ctx.fillRect(px * s + this.state.panX, py * s + this.state.panY, s, s);
                }
            }
        }
        
        // 更新预览名称
        const nameEl = document.getElementById('comp-preview-name');
        if (nameEl) {
            nameEl.textContent = this.state.selectedComp || '';
        }
    },

    // ========== 组件列表 ==========
    renderComponentList() {
        const container = document.getElementById('comp-list');
        if (!container) return;
        
        const comps = Object.entries(this.state.components);
        
        if (comps.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);padding:20px;font-size:11px;">
                    暂无组件<br>点击"新建"创建
                </div>
            `;
            return;
        }
        
        container.innerHTML = comps.map(([name, comp]) => {
            const type = this.COMP_TYPES[comp.type] || { icon: '📦', name: comp.type };
            const isSelected = this.state.selectedComp === name;
            return `
                <div class="comp-list-item ${isSelected ? 'selected' : ''}" 
                     onclick="CompEditor.selectComponent('${name}')">
                    <span class="icon">${type.icon}</span>
                    <span class="name">${name}</span>
                    <span class="type">${type.name}</span>
                    <span class="delete" onclick="event.stopPropagation();CompEditor.deleteComponent('${name}')">×</span>
                </div>
            `;
        }).join('');
    },
    
    // 获取元素在当前组件中的配置位置描述
    getElementConfigInfo(elemName) {
        if (!this.state.selectedComp) return null;
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return null;
        
        if (comp.type === 'Line') {
            // Line组件
            const digits = comp.digits || [];
            const dots = comp.dots || [];
            
            for (let i = 0; i < digits.length; i++) {
                if (digits[i].element === elemName) {
                    return { type: 'lineDigit', index: i, label: `数字位${i + 1}` };
                }
            }
            for (let i = 0; i < dots.length; i++) {
                if (dots[i].element === elemName) {
                    return { type: 'lineDot', index: i, label: `小数点${i + 1}` };
                }
            }
            if (comp.minus === elemName) {
                return { type: 'lineMinus', label: '负号' };
            }
            // 检查新结构的单位元素 (base/exp/symbol/fraction)
            const unitLabels = {
                base: { m: 'm(米)', ft: 'ft(英尺)', in: 'in(英寸)' },
                exp: { sq: '²平方', cu: '³立方' },
                symbol: { ft_mark: "'符号", in_mark: '"符号', slash: '/分数线' },
                fraction: { numerator: '分子', denominator: '分母' }
            };
            for (const [category, units] of Object.entries(comp.units || {})) {
                for (const [unitKey, elements] of Object.entries(units)) {
                    if ((elements || []).includes(elemName)) {
                        const label = unitLabels[category]?.[unitKey] || `${category}/${unitKey}`;
                        return { type: 'lineUnit', dataType: category, unitKey, label };
                    }
                }
            }
        } else if (comp.type === 'Selector') {
            // Selector组件
            if ((comp.frame || []).includes(elemName)) {
                return { type: 'selectorFrame', label: '框架' };
            }
            for (let i = 0; i < (comp.options || []).length; i++) {
                if ((comp.options[i].elements || []).includes(elemName)) {
                    return { type: 'selectorOption', index: i, label: `选项:${comp.options[i].key}` };
                }
            }
        } else if (comp.type === 'NumberDisplay') {
            const digits = comp.config?.digits || [];
            const dots = comp.config?.dots || [];
            
            for (let i = 0; i < digits.length; i++) {
                if (digits[i].element === elemName) {
                    return { type: 'digit', index: i, label: `数字位${i + 1}` };
                }
            }
            for (let i = 0; i < dots.length; i++) {
                if (dots[i].element === elemName) {
                    return { type: 'dot', index: i, label: `小数点${i + 1}` };
                }
            }
            if (comp.config?.sign?.element === elemName) {
                return { type: 'sign', label: '符号位' };
            }
        } else if (comp.type === 'ModeSelector') {
            for (const [modeName, elements] of Object.entries(comp.modes || {})) {
                if (elements.includes(elemName)) {
                    return { type: 'mode', mode: modeName, label: `模式:${modeName}` };
                }
            }
        } else if (comp.type === 'LevelIndicator') {
            if (comp.frame === elemName) {
                return { type: 'frame', label: '外框' };
            }
            for (let i = 0; i < (comp.levels || []).length; i++) {
                if (comp.levels[i].includes(elemName)) {
                    return { type: 'level', index: i, label: `等级${i}` };
                }
            }
        } else if (comp.type === 'BlinkIcon' || comp.type === 'AnimatedIcon') {
            if ((comp.elements || []).includes(elemName)) {
                return { type: 'element', label: '图标元素' };
            }
            for (let i = 0; i < (comp.frames || []).length; i++) {
                if (comp.frames[i].includes(elemName)) {
                    return { type: 'frame', index: i, label: `帧${i + 1}` };
                }
            }
        } else if (comp.type === 'Icon') {
            if ((comp.elements || []).includes(elemName)) {
                return { type: 'icon', label: '图标元素' };
            }
        }
        return null;
    },
    
    renderElementList() {
        const container = document.getElementById('comp-elements');
        const countEl = document.getElementById('comp-element-count');
        if (!container) return;
        
        if (countEl) {
            countEl.textContent = `${this.state.elements.length} 个`;
        }
        
        if (this.state.elements.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">请先在段码编辑器中定义元素</div>';
            return;
        }
        
        const isPicking = this.state.elementPicker;
        
        // 按类型分组
        const groups = {};
        for (const elem of this.state.elements) {
            const type = elem.type || 'other';
            if (!groups[type]) groups[type] = [];
            groups[type].push(elem);
        }
        
        let html = '';
        
        // 如果在选择模式，显示提示
        if (isPicking) {
            html += `
                <div class="picker-hint" style="padding:8px;background:rgba(245,158,11,0.1);border:1px solid #f59e0b;border-radius:4px;margin-bottom:8px;font-size:11px;">
                    <div style="font-weight:bold;color:#f59e0b;">🎯 选择模式</div>
                    <div style="color:var(--text-muted);margin-top:4px;">点击下方元素或LCD图像选择</div>
                    <button class="comp-btn" style="margin-top:6px;width:100%;" onclick="CompEditor.cancelElementPicker()">取消选择</button>
                </div>
            `;
        }
        
        for (const [type, elems] of Object.entries(groups)) {
            html += `<div style="font-size:10px;color:var(--text-muted);margin:8px 0 4px;">${type} (${elems.length})</div>`;
            for (const elem of elems) {
                const name = elem.name || elem.id;
                const configInfo = this.getElementConfigInfo(name);
                const isInComp = configInfo !== null;
                const isHighlight = this.state.highlightElements.has(name);
                
                html += `
                    <div class="comp-element-item ${isInComp ? 'selected' : ''} ${isHighlight ? 'highlight' : ''} ${isPicking ? 'pickable' : ''}"
                         data-element="${name}"
                         onclick="CompEditor.onElementClick('${name}', event)">
                        ${!isPicking ? `<input type="checkbox" ${isInComp ? 'checked' : ''} onclick="event.stopPropagation(); CompEditor.onElementClick('${name}', event)">` : ''}
                        <span class="elem-name">${name}</span>
                        ${configInfo ? `<span class="elem-config-tag">${configInfo.label}</span>` : ''}
                    </div>
                `;
            }
        }
        container.innerHTML = html;
        
        // 添加Shift选择提示
        if (isPicking && this.state.lastClickedElement) {
            const hint = document.querySelector('.picker-hint');
            if (hint) {
                hint.innerHTML += `<div style="margin-top:4px;font-size:10px;">💡 Shift+点击可范围选择</div>`;
            }
        }
    },
    
    // 元素点击处理 - 支持Shift范围选择
    onElementClick(elemName, event) {
        // 如果有元素选择器激活，填充到对应字段
        if (this.state.elementPicker) {
            // Shift+点击进行范围选择
            if (event?.shiftKey && this.state.lastClickedElement) {
                this.rangeSelectElements(this.state.lastClickedElement, elemName);
            } else {
                this.fillElementPicker(elemName);
                this.state.lastClickedElement = elemName;
            }
            return;
        }
        
        // 高亮元素
        this.state.highlightElements.clear();
        this.state.highlightElements.add(elemName);
        
        // 如果有选中的组件，尝试添加/移除元素
        if (this.state.selectedComp) {
            this.toggleElementInComponent(elemName);
        }
        
        this.state.lastClickedElement = elemName;
        this.renderElementList();
        this.render();
    },
    
    // Shift范围选择元素
    rangeSelectElements(startElem, endElem) {
        // 获取所有元素名称的有序列表
        const allNames = this.state.elements.map(e => e.name || e.id);
        const startIdx = allNames.indexOf(startElem);
        const endIdx = allNames.indexOf(endElem);
        
        if (startIdx === -1 || endIdx === -1) return;
        
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        
        // 选择范围内的所有元素
        const selectedNames = allNames.slice(minIdx, maxIdx + 1);
        
        // 根据picker类型批量添加
        const picker = this.state.elementPicker;
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        let addedCount = 0;
        for (const name of selectedNames) {
            if (picker.type === 'mode') {
                const modeName = picker.modeName || this.state.selectedMode;
                if (modeName && comp.modes) {
                    if (!comp.modes[modeName]) comp.modes[modeName] = [];
                    if (!comp.modes[modeName].includes(name)) {
                        comp.modes[modeName].push(name);
                        addedCount++;
                    }
                }
            } else if (picker.type === 'level' && picker.index !== null) {
                if (!comp.levels) comp.levels = [];
                if (!comp.levels[picker.index]) comp.levels[picker.index] = [];
                if (!comp.levels[picker.index].includes(name)) {
                    comp.levels[picker.index].push(name);
                    addedCount++;
                }
            } else if (picker.type === 'frame' && picker.index !== null) {
                if (!comp.frames) comp.frames = [];
                if (!comp.frames[picker.index]) comp.frames[picker.index] = [];
                if (!comp.frames[picker.index].includes(name)) {
                    comp.frames[picker.index].push(name);
                    addedCount++;
                }
            } else if (picker.type === 'icon') {
                if (!comp.elements) comp.elements = [];
                if (!comp.elements.includes(name)) {
                    comp.elements.push(name);
                    addedCount++;
                }
            }
        }
        
        this.showToast(`批量添加 ${addedCount} 个元素`, 'success');
        this.state.lastClickedElement = endElem;
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    // 激活元素选择器
    startElementPicker(type, index = null) {
        this.state.elementPicker = { type, index };
        // 自动切换到元素Tab
        this.switchTab('elements');
        this.showToast(`点击元素列表或LCD图像选择`, 'info');
        // 添加选择模式样式
        document.body.classList.add('element-picker-active');
        this.renderElementList();
    },
    
    // 为ModeSelector添加元素
    startModeElementPicker(modeName) {
        this.state.selectedMode = modeName;
        this.state.elementPicker = { type: 'mode', modeName };
        // 自动切换到元素Tab
        this.switchTab('elements');
        this.showToast(`为模式 "${modeName}" 选择元素`, 'info');
        document.body.classList.add('element-picker-active');
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    // 取消元素选择器
    cancelElementPicker() {
        this.state.elementPicker = null;
        document.body.classList.remove('element-picker-active');
        // 切回组件Tab
        this.switchTab('components');
        this.renderElementList();
    },
    
    // 填充元素选择器
    fillElementPicker(elemName) {
        const picker = this.state.elementPicker;
        if (!picker) return;
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        // ===== Line 组件类型 =====
        if (picker.type === 'lineDigit' && picker.index !== null) {
            if (!comp.digits) comp.digits = [];
            if (!comp.digits[picker.index]) {
                comp.digits[picker.index] = { element: '', position: picker.index };
            }
            comp.digits[picker.index].element = elemName;
        } else if (picker.type === 'lineDot' && picker.index !== null) {
            if (!comp.dots) comp.dots = [];
            if (!comp.dots[picker.index]) {
                comp.dots[picker.index] = { element: '', afterDigit: picker.index };
            }
            comp.dots[picker.index].element = elemName;
        } else if (picker.type === 'lineMinus') {
            comp.minus = elemName;
        } else if (picker.type === 'lineUnit') {
            // Line组件的单位元素选择 (切换模式)
            const { dataType, unitKey } = picker;
            if (!comp.units) comp.units = {};
            if (!comp.units[dataType]) comp.units[dataType] = {};
            if (!comp.units[dataType][unitKey]) comp.units[dataType][unitKey] = [];
            
            const idx = comp.units[dataType][unitKey].indexOf(elemName);
            if (idx >= 0) {
                comp.units[dataType][unitKey].splice(idx, 1);
                this.showToast(`移除: ${elemName}`, 'info');
            } else {
                comp.units[dataType][unitKey].push(elemName);
                this.showToast(`添加: ${elemName}`, 'success');
            }
            // 继续选择模式
            this.updateHighlightFromComponent();
            this.renderElementList();
            this.renderProperties();
            this.render();
            return;
        // ===== Selector 组件类型 =====
        } else if (picker.type === 'selectorOption' && picker.optionIndex !== undefined) {
            // Selector选项元素选择 (切换模式)
            if (!comp.options?.[picker.optionIndex]) return;
            if (!comp.options[picker.optionIndex].elements) {
                comp.options[picker.optionIndex].elements = [];
            }
            const elements = comp.options[picker.optionIndex].elements;
            const idx = elements.indexOf(elemName);
            if (idx >= 0) {
                elements.splice(idx, 1);
                this.showToast(`移除: ${elemName}`, 'info');
            } else {
                elements.push(elemName);
                this.showToast(`添加: ${elemName}`, 'success');
            }
            // 继续选择模式
            this.updateHighlightFromComponent();
            this.renderElementList();
            this.renderProperties();
            this.render();
            return;
        } else if (picker.type === 'selectorFrame') {
            // Selector框架元素选择 (切换模式)
            if (!comp.frame) comp.frame = [];
            const idx = comp.frame.indexOf(elemName);
            if (idx >= 0) {
                comp.frame.splice(idx, 1);
                this.showToast(`移除: ${elemName}`, 'info');
            } else {
                comp.frame.push(elemName);
                this.showToast(`添加: ${elemName}`, 'success');
            }
            // 继续选择模式
            this.updateHighlightFromComponent();
            this.renderElementList();
            this.renderProperties();
            this.render();
            return;
        // ===== 旧类型兼容 =====
        } else if (picker.type === 'digit' && picker.index !== null) {
            if (!comp.config) comp.config = {};
            if (!comp.config.digits) comp.config.digits = [];
            if (!comp.config.digits[picker.index]) {
                comp.config.digits[picker.index] = { element: '', position: picker.index };
            }
            comp.config.digits[picker.index].element = elemName;
        } else if (picker.type === 'dot' && picker.index !== null) {
            if (!comp.config) comp.config = {};
            if (!comp.config.dots) comp.config.dots = [];
            if (!comp.config.dots[picker.index]) {
                comp.config.dots[picker.index] = { element: '', afterDigit: picker.index };
            }
            comp.config.dots[picker.index].element = elemName;
        } else if (picker.type === 'sign') {
            if (!comp.config) comp.config = {};
            comp.config.sign = { element: elemName };
        } else if (picker.type === 'levelFrame') {
            // LevelIndicator的外框元素（单个）
            comp.frame = elemName;
        } else if (picker.type === 'level' && picker.index !== null) {
            // level类型使用切换模式，不关闭选择器
            this.toggleLevelElement(picker.index, elemName);
            return; // 不关闭选择器，继续选择
        } else if (picker.type === 'frame' && picker.index !== null) {
            // AnimatedIcon的帧元素（数组），使用切换模式
            this.toggleFrameElement(picker.index, elemName);
            return; // 不关闭选择器，继续选择
        } else if (picker.type === 'mode') {
            const modeName = picker.modeName || this.state.selectedMode;
            if (modeName && comp.modes) {
                if (!comp.modes[modeName]) comp.modes[modeName] = [];
                const idx = comp.modes[modeName].indexOf(elemName);
                if (idx >= 0) {
                    comp.modes[modeName].splice(idx, 1);
                    this.showToast(`移除: ${elemName}`, 'info');
                } else {
                    comp.modes[modeName].push(elemName);
                    this.showToast(`添加: ${elemName}`, 'success');
                }
                // mode类型也使用切换模式
                this.updateHighlightFromComponent();
                this.renderElementList();
                this.renderProperties();
                this.render();
                return; // 不关闭选择器
            }
        } else if (picker.type === 'blink') {
            if (!comp.elements) comp.elements = [];
            if (!comp.elements.includes(elemName)) {
                comp.elements.push(elemName);
            }
        } else if (picker.type === 'icon') {
            // Icon组件的元素选择
            if (!comp.elements) comp.elements = [];
            if (!comp.elements.includes(elemName)) {
                comp.elements.push(elemName);
                this.showToast(`添加: ${elemName}`, 'success');
            }
            // 继续选择模式
            this.updateHighlightFromComponent();
            this.renderElementList();
            this.renderProperties();
            this.render();
            return;
        }
        
        // 清除选择器状态
        this.state.elementPicker = null;
        document.body.classList.remove('element-picker-active');
        
        // 切回组件Tab
        this.switchTab('components');
        
        // 更新UI
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
        
        this.showToast(`已选择: ${elemName}`, 'success');
    },
    
    // 从LCD画布点击选中元素
    selectElementFromCanvas(elemName) {
        // 高亮元素
        this.state.highlightElements.clear();
        this.state.highlightElements.add(elemName);
        
        // 切换到元素Tab并滚动到对应项
        this.switchTab('elements');
        
        setTimeout(() => {
            const elemItem = document.querySelector(`.comp-element-item[data-element="${elemName}"]`);
            if (elemItem) {
                elemItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                elemItem.classList.add('flash');
                setTimeout(() => elemItem.classList.remove('flash'), 500);
            }
        }, 100);
        
        this.renderElementList();
        this.render();
    },
    
    // 清除高亮
    clearHighlight() {
        this.state.highlightElements.clear();
        this.render();
    },

    // ========== 组件操作 ==========
    showAddDialog() {
        // 防止重复打开
        if (document.querySelector('.hsm-dialog-overlay')) {
            return;
        }
        
        // 分离新类型和旧类型
        const newTypes = Object.entries(this.COMP_TYPES).filter(([k, t]) => !t.legacy);
        const legacyTypes = Object.entries(this.COMP_TYPES).filter(([k, t]) => t.legacy);
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:400px;">
                <div class="hsm-dialog-header">
                    <span>新建组件</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div class="comp-form-group">
                        <label>组件名称</label>
                        <input type="text" class="comp-input" id="new-comp-name" placeholder="如 line4, unit, battery, laser">
                    </div>
                    <div class="comp-form-group">
                        <label>组件类型 (推荐使用新类型)</label>
                        <div style="display:grid;gap:6px;">
                            <div style="font-size:11px;color:#4ade80;margin:4px 0;">✨ 新类型 (v3.0)</div>
                            ${newTypes.map(([key, t]) => `
                                <label style="display:flex;align-items:center;gap:8px;padding:10px;background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);border-radius:4px;cursor:pointer;">
                                    <input type="radio" name="comp-type" value="${key}" ${key === 'Line' ? 'checked' : ''}>
                                    <span style="font-size:18px;">${t.icon}</span>
                                    <span style="flex:1;">
                                        <div style="font-size:13px;font-weight:500;">${t.name}</div>
                                        <div style="font-size:10px;color:var(--text-muted);">${t.desc}</div>
                                    </span>
                                </label>
                            `).join('')}
                            
                            <div style="font-size:11px;color:var(--text-muted);margin:8px 0 4px;">📦 旧类型 (兼容)</div>
                            ${legacyTypes.map(([key, t]) => `
                                <label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-primary);border-radius:4px;cursor:pointer;opacity:0.7;">
                                    <input type="radio" name="comp-type" value="${key}">
                                    <span style="font-size:16px;">${t.icon}</span>
                                    <span>
                                        <div style="font-size:12px;">${t.name}</div>
                                        <div style="font-size:10px;color:var(--text-muted);">${t.desc}</div>
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <button class="comp-btn primary" style="width:100%;margin-top:12px;" onclick="CompEditor.createComponent()">创建</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        document.getElementById('new-comp-name').focus();
    },
    
    createComponent() {
        const nameInput = document.getElementById('new-comp-name');
        const typeInput = document.querySelector('input[name="comp-type"]:checked');
        
        const name = nameInput?.value?.trim();
        const type = typeInput?.value;
        
        if (!name) {
            this.showToast('请输入组件名称', 'warning');
            return;
        }
        if (this.state.components[name]) {
            this.showToast('组件已存在', 'warning');
            return;
        }
        
        // 创建组件
        this.state.components[name] = this.createDefaultComponent(type);
        
        // 关闭对话框
        document.querySelector('.hsm-dialog-overlay')?.remove();
        
        // 选中新组件
        this.selectComponent(name);
        this.renderComponentList();
        this.showToast(`已创建: ${name}`, 'success');
    },
    
    createDefaultComponent(type) {
        switch (type) {
            // ===== v3.0 新类型 =====
            case 'Line':
                return {
                    type: 'Line',
                    description: '',
                    digits: [],      // [{element, position}]
                    dots: [],        // [{element, afterDigit}]
                    minus: null,     // 负号元素
                    units: {         // 单位元素配置
                        length: { m: [], ft: [], in: [] },
                        area: { m2: [], ft2: [], in2: [] },
                        volume: { m3: [], ft3: [], in3: [] }
                    },
                    digitCount: 5,
                    hasSign: false,
                    unitConfig: {    // 单位转换配置
                        length: {
                            m:  { factor: 1.0,     decimals: 3, min: 0.05,  max: 99.999 },
                            ft: { factor: 3.28084, decimals: 3, min: 0.164, max: 328.08 },
                            in: { factor: 39.3701, decimals: 2, min: 1.97,  max: 3937.0 }
                        },
                        area: {
                            m2:  { factor: 1.0,      decimals: 3, min: 0, max: 999.99 },
                            ft2: { factor: 10.7639,  decimals: 2, min: 0, max: 9999.9 },
                            in2: { factor: 1550.003, decimals: 1, min: 0, max: 99999 }
                        },
                        volume: {
                            m3:  { factor: 1.0,       decimals: 3, min: 0, max: 999.99 },
                            ft3: { factor: 35.3147,   decimals: 2, min: 0, max: 9999.9 },
                            in3: { factor: 61023.744, decimals: 0, min: 0, max: 99999 }
                        }
                    }
                };
            case 'Selector':
                return {
                    type: 'Selector',
                    description: '',
                    options: [],     // [{key, value, elements}]
                    frame: [],       // 框架元素(常显)
                    default: 0,
                    triggerRefresh: false  // 是否触发Line刷新(unit专用)
                };
            case 'Icon':
                return {
                    type: 'Icon',
                    description: '',
                    elements: [],
                    default: false
                };
            // ===== 兼容旧类型 =====
            case 'NumberDisplay':
                return {
                    type: 'NumberDisplay',
                    config: {
                        digits: [],      // [{element, position}]
                        dots: [],        // [{element, afterDigit}]
                        sign: null,      // {element}
                        alignment: 'right',
                        decimalPlaces: 3,
                        maxValue: 99999,
                        minValue: -9999,
                    },
                    presets: {
                        dash: '-----',
                        null1: 'NULL1',
                        null2: 'NULL2',
                    }
                };
            case 'ModeSelector':
                return {
                    type: 'ModeSelector',
                    modes: {},  // {modeName: [elements]}
                    defaultMode: null,
                };
            case 'LevelIndicator':
                return {
                    type: 'LevelIndicator',
                    frame: null,     // 外框元素
                    levels: [],      // [[level0 elements], [level1], ...]
                    maxLevel: 3,
                };
            case 'BlinkIcon':
                return {
                    type: 'BlinkIcon',
                    elements: [],
                    blinkInterval: 300,
                    timeout: 0,
                    onTimeout: null,
                    linkedComponents: [],
                };
            case 'AnimatedIcon':
                return {
                    type: 'AnimatedIcon',
                    frames: [],      // [[frame0 elements], [frame1], ...]
                    interval: 500,
                    loop: true,
                };
            default:
                return { type, elements: [] };
        }
    },
    
    selectComponent(name) {
        this.state.selectedComp = name;
        this.state.selectedBehavior = null;
        this.state.selectedMode = null; // 清除选中的模式，这样会高亮所有元素
        this.state.elementPicker = null; // 清除元素选择器
        document.body.classList.remove('element-picker-active');
        this.updateHighlightFromComponent();
        this.renderComponentList();
        this.renderBehaviorList();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    deleteComponent(name) {
        if (!confirm(`删除组件 "${name}"?`)) return;
        delete this.state.components[name];
        if (this.state.selectedComp === name) {
            this.state.selectedComp = null;
        }
        this.renderComponentList();
        this.renderProperties();
        this.showToast('已删除', 'info');
    },
    
    updateHighlightFromComponent() {
        this.state.highlightElements.clear();
        
        if (!this.state.selectedComp) return;
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        const picker = this.state.elementPicker;
        
        // 根据组件类型获取元素
        if (comp.type === 'Line') {
            // 如果正在选择某个单位的元素，只高亮该单位
            if (picker?.type === 'lineUnit') {
                const { dataType, unitKey } = picker;
                const unitElements = comp.units?.[dataType]?.[unitKey] || [];
                for (const el of unitElements) {
                    this.state.highlightElements.add(el);
                }
            } else if (picker?.type === 'lineDigit' && picker?.index !== null) {
                // 正在选择数字位，高亮已选的数字位
                const digit = comp.digits?.[picker.index];
                if (digit?.element) {
                    this.state.highlightElements.add(digit.element);
                }
            } else if (picker?.type === 'lineDot' && picker?.index !== null) {
                // 正在选择小数点，高亮已选的小数点
                const dot = comp.dots?.[picker.index];
                if (dot?.element) {
                    this.state.highlightElements.add(dot.element);
                }
            } else if (picker?.type === 'lineMinus') {
                // 正在选择负号
                if (comp.minus) {
                    this.state.highlightElements.add(comp.minus);
                }
            } else {
                // 默认：高亮所有元素
                for (const d of comp.digits || []) {
                    if (d.element) this.state.highlightElements.add(d.element);
                }
                for (const d of comp.dots || []) {
                    if (d.element) this.state.highlightElements.add(d.element);
                }
                if (comp.minus) {
                    this.state.highlightElements.add(comp.minus);
                }
                // 高亮所有单位元素
                for (const dataType of Object.values(comp.units || {})) {
                    for (const unitElements of Object.values(dataType)) {
                        for (const el of unitElements || []) {
                            this.state.highlightElements.add(el);
                        }
                    }
                }
            }
        } else if (comp.type === 'Selector') {
            // Selector组件: 高亮框架和当前选中选项的元素
            for (const el of comp.frame || []) {
                this.state.highlightElements.add(el);
            }
            // 如果正在选择某个选项的元素，只高亮该选项
            if (picker?.type === 'selectorOption' && picker?.optionIndex !== undefined) {
                const opt = comp.options?.[picker.optionIndex];
                if (opt) {
                    for (const el of opt.elements || []) {
                        this.state.highlightElements.add(el);
                    }
                }
            } else if (this.state.selectedMode) {
                // 如果有选中的选项，高亮该选项的元素
                const opt = (comp.options || []).find(o => o.key === this.state.selectedMode);
                if (opt) {
                    for (const el of opt.elements || []) {
                        this.state.highlightElements.add(el);
                    }
                }
            } else {
                // 否则高亮所有选项的元素
                for (const opt of comp.options || []) {
                    for (const el of opt.elements || []) {
                        this.state.highlightElements.add(el);
                    }
                }
            }
        } else if (comp.type === 'NumberDisplay') {
            for (const d of comp.config?.digits || []) {
                if (d.element) this.state.highlightElements.add(d.element);
            }
            for (const d of comp.config?.dots || []) {
                if (d.element) this.state.highlightElements.add(d.element);
            }
            if (comp.config?.sign?.element) {
                this.state.highlightElements.add(comp.config.sign.element);
            }
        } else if (comp.type === 'ModeSelector') {
            // 高亮当前选中模式的元素
            if (this.state.selectedMode && comp.modes?.[this.state.selectedMode]) {
                for (const el of comp.modes[this.state.selectedMode]) {
                    this.state.highlightElements.add(el);
                }
            }
        } else if (comp.type === 'LevelIndicator') {
            // 高亮外框
            if (comp.frame) {
                this.state.highlightElements.add(comp.frame);
            }
            // 如果正在编辑某个等级，只高亮该等级的元素
            const picker = this.state.elementPicker;
            if (picker?.type === 'level' && picker?.index !== null) {
                const levelElements = comp.levels?.[picker.index] || [];
                for (const el of levelElements) {
                    this.state.highlightElements.add(el);
                }
            } else {
                // 否则高亮所有等级的元素
                for (const level of comp.levels || []) {
                    for (const el of level) {
                        this.state.highlightElements.add(el);
                    }
                }
            }
        } else if (comp.type === 'AnimatedIcon') {
            // 如果正在编辑某个帧，只高亮该帧的元素
            const picker = this.state.elementPicker;
            if (picker?.type === 'frame' && picker?.index !== null) {
                const frameElements = comp.frames?.[picker.index] || [];
                for (const el of frameElements) {
                    this.state.highlightElements.add(el);
                }
            } else {
                // 否则高亮所有帧的元素
                for (const frame of comp.frames || []) {
                    for (const el of frame) {
                        this.state.highlightElements.add(el);
                    }
                }
            }
        } else if (comp.elements) {
            for (const el of comp.elements) {
                this.state.highlightElements.add(el);
            }
        }
    },
    
    isElementInCurrentComponent(elemName) {
        if (!this.state.selectedComp) return false;
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return false;
        
        if (comp.type === 'Line') {
            // Line组件: 检查数字位、小数点、负号、单位元素
            const digits = comp.digits || [];
            const dots = comp.dots || [];
            if (digits.some(d => d.element === elemName)) return true;
            if (dots.some(d => d.element === elemName)) return true;
            if (comp.minus === elemName) return true;
            // 检查单位元素
            for (const dataType of Object.values(comp.units || {})) {
                for (const unitElements of Object.values(dataType)) {
                    if ((unitElements || []).includes(elemName)) return true;
                }
            }
            return false;
        } else if (comp.type === 'Selector') {
            // Selector组件: 检查框架和选项元素
            if ((comp.frame || []).includes(elemName)) return true;
            for (const opt of comp.options || []) {
                if ((opt.elements || []).includes(elemName)) return true;
            }
            return false;
        } else if (comp.type === 'NumberDisplay') {
            const digits = comp.config?.digits || [];
            const dots = comp.config?.dots || [];
            return digits.some(d => d.element === elemName) ||
                   dots.some(d => d.element === elemName) ||
                   comp.config?.sign?.element === elemName;
        } else if (comp.type === 'ModeSelector') {
            for (const mode of Object.values(comp.modes || {})) {
                if (mode.includes(elemName)) return true;
            }
            return false;
        } else {
            return (comp.elements || []).includes(elemName);
        }
    },
    
    toggleElementInComponent(elemName) {
        if (!this.state.selectedComp) {
            this.showToast('请先选择组件', 'warning');
            return;
        }
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        if (comp.type === 'Line') {
            // Line组件：弹出选择对话框
            this.showLineAssignDialog(elemName);
            return;
        } else if (comp.type === 'Selector') {
            // Selector组件：添加到当前选中的选项
            if (!this.state.selectedMode) {
                this.showToast('请先选择一个选项', 'warning');
                return;
            }
            const opt = (comp.options || []).find(o => o.key === this.state.selectedMode);
            if (!opt) return;
            if (!opt.elements) opt.elements = [];
            
            const idx = opt.elements.indexOf(elemName);
            if (idx >= 0) {
                opt.elements.splice(idx, 1);
            } else {
                opt.elements.push(elemName);
            }
        } else if (comp.type === 'ModeSelector') {
            // 模式选择器：添加到当前选中的模式
            if (!this.state.selectedMode) {
                this.showToast('请先选择一个模式', 'warning');
                return;
            }
            const mode = comp.modes[this.state.selectedMode];
            if (!mode) return;
            
            const idx = mode.indexOf(elemName);
            if (idx >= 0) {
                mode.splice(idx, 1);
            } else {
                mode.push(elemName);
            }
        } else if (comp.type === 'NumberDisplay') {
            // 数字显示：弹出选择对话框
            this.showDigitAssignDialog(elemName);
            return;
        } else {
            // 其他类型：直接添加/移除
            if (!comp.elements) comp.elements = [];
            const idx = comp.elements.indexOf(elemName);
            if (idx >= 0) {
                comp.elements.splice(idx, 1);
            } else {
                comp.elements.push(elemName);
            }
        }
        
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    // Line组件的元素分配对话框
    showLineAssignDialog(elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        
        // 检查元素是否已经被分配
        const configInfo = this.getElementConfigInfo(elemName);
        if (configInfo) {
            // 已分配，询问是否移除
            if (confirm(`"${elemName}" 已分配为 ${configInfo.label}，是否移除？`)) {
                if (configInfo.type === 'lineDigit') {
                    comp.digits.splice(configInfo.index, 1);
                } else if (configInfo.type === 'lineDot') {
                    comp.dots.splice(configInfo.index, 1);
                } else if (configInfo.type === 'lineMinus') {
                    comp.minus = null;
                } else if (configInfo.type === 'lineUnit') {
                    const { dataType, unitKey } = configInfo;
                    const idx = comp.units[dataType][unitKey].indexOf(elemName);
                    if (idx >= 0) comp.units[dataType][unitKey].splice(idx, 1);
                }
                this.updateHighlightFromComponent();
                this.renderElementList();
                this.renderProperties();
                this.render();
            }
            return;
        }
        
        // 防止重复弹出
        const existing = document.querySelector('.hsm-dialog-overlay.line-assign-dialog');
        if (existing) existing.remove();
        
        // 未分配，弹出选择对话框
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay line-assign-dialog';
        dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); }; // 点击遮罩关闭
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:280px;">
                <div class="hsm-dialog-header">
                    <span>分配元素: ${elemName}</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <button class="comp-btn" onclick="CompEditor.assignLineElement('${elemName}', 'digit');this.closest('.hsm-dialog-overlay').remove()">
                            🔢 数字位
                        </button>
                        <button class="comp-btn" onclick="CompEditor.assignLineElement('${elemName}', 'dot');this.closest('.hsm-dialog-overlay').remove()">
                            ⚫ 小数点
                        </button>
                        <button class="comp-btn" onclick="CompEditor.assignLineElement('${elemName}', 'minus');this.closest('.hsm-dialog-overlay').remove()">
                            ➖ 负号
                        </button>
                        <button class="comp-btn" onclick="CompEditor.assignLineElement('${elemName}', 'unit');this.closest('.hsm-dialog-overlay').remove()">
                            📏 单位符号
                        </button>
                        <button class="comp-btn" style="margin-top:8px;" onclick="this.closest('.hsm-dialog-overlay').remove()">
                            取消
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    },
    
    // 分配Line元素
    assignLineElement(elemName, type) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        
        if (type === 'digit') {
            if (!comp.digits) comp.digits = [];
            comp.digits.push({ element: elemName, position: comp.digits.length });
        } else if (type === 'dot') {
            if (!comp.dots) comp.dots = [];
            comp.dots.push({ element: elemName, afterDigit: comp.dots.length });
        } else if (type === 'minus') {
            comp.minus = elemName;
        } else if (type === 'unit') {
            // 弹出单位类型选择
            this.showUnitTypeDialog(elemName);
            return;
        }
        
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
        this.showToast(`已添加: ${elemName}`, 'success');
    },
    
    // 单位类型选择对话框
    showUnitTypeDialog(elemName) {
        // 防止重复弹出
        const existing = document.querySelector('.hsm-dialog-overlay.unit-type-dialog');
        if (existing) existing.remove();
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay unit-type-dialog';
        dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); }; // 点击遮罩关闭
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:360px;">
                <div class="hsm-dialog-header">
                    <span>选择单位类型: ${elemName}</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">📏 基础单位符号</div>
                    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'base', 'm');this.closest('.hsm-dialog-overlay').remove()">m (米)</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'base', 'ft');this.closest('.hsm-dialog-overlay').remove()">ft (英尺)</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'base', 'in');this.closest('.hsm-dialog-overlay').remove()">in (英寸)</button>
                    </div>
                    
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">📐 指数符号 (可选数码管或专用元素)</div>
                    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'exp', 'sq');this.closest('.hsm-dialog-overlay').remove()">² 平方</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'exp', 'cu');this.closest('.hsm-dialog-overlay').remove()">³ 立方</button>
                    </div>
                    
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">🔢 ft+in 复合单位符号</div>
                    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'symbol', 'ft_mark');this.closest('.hsm-dialog-overlay').remove()">' (英尺符号)</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'symbol', 'in_mark');this.closest('.hsm-dialog-overlay').remove()">" (英寸符号)</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'symbol', 'slash');this.closest('.hsm-dialog-overlay').remove()">/ (分数线)</button>
                    </div>
                    
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">🔢 分数元素 (ft+in 分数模式)</div>
                    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'fraction', 'numerator');this.closest('.hsm-dialog-overlay').remove()">分子</button>
                        <button class="comp-btn" onclick="CompEditor.addUnitElement('${elemName}', 'fraction', 'denominator');this.closest('.hsm-dialog-overlay').remove()">分母</button>
                    </div>
                    
                    <button class="comp-btn" style="width:100%;margin-top:8px;" onclick="this.closest('.hsm-dialog-overlay').remove()">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    },
    
    // 添加单位元素
    addUnitElement(elemName, dataType, unitKey) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        
        if (!comp.units) comp.units = {};
        if (!comp.units[dataType]) comp.units[dataType] = {};
        if (!comp.units[dataType][unitKey]) comp.units[dataType][unitKey] = [];
        
        if (!comp.units[dataType][unitKey].includes(elemName)) {
            comp.units[dataType][unitKey].push(elemName);
        }
        
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
        this.showToast(`已添加: ${elemName} → ${dataType}/${unitKey}`, 'success');
    },
    
    // 数字显示组件的元素分配对话框
    showDigitAssignDialog(elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'NumberDisplay') return;
        
        const config = comp.config || {};
        const digits = config.digits || [];
        const dots = config.dots || [];
        
        // 检查元素是否已经被分配
        const existingDigit = digits.findIndex(d => d.element === elemName);
        const existingDot = dots.findIndex(d => d.element === elemName);
        const isSign = config.sign?.element === elemName;
        
        if (existingDigit >= 0 || existingDot >= 0 || isSign) {
            // 已分配，询问是否移除
            const location = existingDigit >= 0 ? `数字位${existingDigit + 1}` : 
                            existingDot >= 0 ? `小数点${existingDot + 1}` : '符号位';
            if (confirm(`"${elemName}" 已分配为 ${location}，是否移除？`)) {
                if (existingDigit >= 0) {
                    digits.splice(existingDigit, 1);
                } else if (existingDot >= 0) {
                    dots.splice(existingDot, 1);
                } else if (isSign) {
                    config.sign = null;
                }
                this.updateHighlightFromComponent();
                this.renderElementList();
                this.renderProperties();
                this.render();
            }
            return;
        }
        
        // 未分配，弹出选择对话框
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:300px;">
                <div class="hsm-dialog-header">
                    <span>分配元素: ${elemName}</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div style="margin-bottom:12px;font-size:12px;color:var(--text-muted);">
                        选择将此元素分配为:
                    </div>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <button class="comp-btn" onclick="CompEditor.assignElementAs('${elemName}', 'digit');this.closest('.hsm-dialog-overlay').remove()">
                            🔢 数字位 (位${digits.length + 1})
                        </button>
                        <button class="comp-btn" onclick="CompEditor.assignElementAs('${elemName}', 'dot');this.closest('.hsm-dialog-overlay').remove()">
                            ⚫ 小数点 (点${dots.length + 1})
                        </button>
                        <button class="comp-btn" onclick="CompEditor.assignElementAs('${elemName}', 'sign');this.closest('.hsm-dialog-overlay').remove()">
                            ➖ 符号位
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    },
    
    // 分配元素到指定类型
    assignElementAs(elemName, type) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'NumberDisplay') return;
        
        if (!comp.config) comp.config = {};
        
        if (type === 'digit') {
            if (!comp.config.digits) comp.config.digits = [];
            comp.config.digits.push({ element: elemName, position: comp.config.digits.length });
        } else if (type === 'dot') {
            if (!comp.config.dots) comp.config.dots = [];
            comp.config.dots.push({ element: elemName, afterDigit: comp.config.dots.length });
        } else if (type === 'sign') {
            comp.config.sign = { element: elemName };
        }
        
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
        this.showToast(`已分配: ${elemName} → ${type}`, 'success');
    },

    // ========== 属性面板 ==========
    renderProperties() {
        const container = document.getElementById('comp-properties');
        const typeEl = document.getElementById('comp-prop-type');
        if (!container) return;
        
        // 根据当前选中的类型渲染不同的属性面板
        if (this.state.selectedBehavior) {
            this.renderBehaviorProperties(container, typeEl);
            return;
        }
        
        if (!this.state.selectedComp) {
            container.innerHTML = `
                <div class="comp-empty">
                    <div class="comp-empty-icon">🧩</div>
                    <div>选择或创建组件</div>
                </div>
            `;
            if (typeEl) typeEl.textContent = '';
            return;
        }
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        const typeInfo = this.COMP_TYPES[comp.type] || { icon: '📦', name: comp.type };
        if (typeEl) typeEl.textContent = typeInfo.name;
        
        let html = `
            <div class="comp-form-group">
                <label>组件名称</label>
                <input type="text" class="comp-input" value="${this.state.selectedComp}" 
                       onchange="CompEditor.renameComponent(this.value)">
            </div>
            <div class="comp-form-group">
                <label>类型</label>
                <div style="padding:6px 10px;background:var(--bg-primary);border-radius:4px;font-size:12px;">
                    ${typeInfo.icon} ${typeInfo.name}
                </div>
            </div>
        `;
        
        // 根据类型渲染不同的配置
        switch (comp.type) {
            // v3.0 新类型
            case 'Line':
                html += this.renderLineProps(comp);
                break;
            case 'Selector':
                html += this.renderSelectorProps(comp);
                break;
            // 兼容旧类型
            case 'NumberDisplay':
                html += this.renderNumberDisplayProps(comp);
                break;
            case 'ModeSelector':
                html += this.renderModeSelectorProps(comp);
                break;
            case 'LevelIndicator':
                html += this.renderLevelIndicatorProps(comp);
                break;
            case 'Icon':
                html += this.renderIconProps(comp);
                break;
            case 'BlinkIcon':
                html += this.renderBlinkIconProps(comp);
                break;
            case 'AnimatedIcon':
                html += this.renderAnimatedIconProps(comp);
                break;
        }
        
        container.innerHTML = html;
    },
    
    // 行为属性面板
    renderBehaviorProperties(container, typeEl) {
        const name = this.state.selectedBehavior;
        const beh = this.state.behaviors[name];
        if (!beh) return;
        
        const typeInfo = this.BEHAVIOR_TYPES[beh.type] || { icon: '❓', name: beh.type };
        if (typeEl) typeEl.textContent = typeInfo.name;
        
        let html = `
            <div class="comp-form-group">
                <label>行为名称</label>
                <input type="text" class="comp-input" value="${name}" 
                       onchange="CompEditor.renameBehavior('${name}', this.value)">
            </div>
            <div class="comp-form-group">
                <label>类型</label>
                <div style="padding:6px 10px;background:var(--bg-primary);border-radius:4px;font-size:12px;">
                    ${typeInfo.icon} ${typeInfo.name}
                </div>
            </div>
            <div class="comp-form-group">
                <label>描述</label>
                <input type="text" class="comp-input" value="${beh.description || ''}" 
                       placeholder="行为说明"
                       onchange="CompEditor.updateBehavior('${name}', 'description', this.value)">
            </div>
            <div class="comp-form-group">
                <label style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" ${beh.enabled ? 'checked' : ''} 
                           onchange="CompEditor.updateBehavior('${name}', 'enabled', this.checked)">
                    默认启用
                </label>
            </div>
        `;
        
        if (beh.type === 'Blink') {
            html += this.renderBlinkBehaviorProps(name, beh);
        } else if (beh.type === 'Animation') {
            html += this.renderAnimationBehaviorProps(name, beh);
        }
        
        container.innerHTML = html;
    },
    
    renderBlinkBehaviorProps(name, beh) {
        const targets = beh.targets || [];
        
        // 获取可选目标列表（组件+元素）
        const compOptions = Object.keys(this.state.components).map(c => 
            `<option value="${c}" class="comp-opt">📦 ${c}</option>`
        ).join('');
        const elemOptions = this.state.elements.slice(0, 50).map(e => 
            `<option value="${e.name || e.id}" class="elem-opt">📋 ${e.name || e.id}</option>`
        ).join('');
        
        return `
            <div class="comp-form-group">
                <label>闪烁间隔</label>
                <div style="display:flex;align-items:center;gap:8px;">
                    <input type="number" class="comp-input" style="width:100px;" 
                           value="${beh.interval || 500}" min="100" step="100"
                           onchange="CompEditor.updateBehavior('${name}', 'interval', parseInt(this.value))">
                    <span style="font-size:11px;color:var(--text-muted);">ms</span>
                </div>
            </div>
            <div class="comp-form-group">
                <label>目标 (${targets.length})</label>
                <div class="target-list">
                    ${targets.map(t => {
                        const isComp = this.state.components[t];
                        return `
                            <span class="target-tag ${isComp ? 'component' : 'element'}">
                                ${isComp ? '📦' : '📋'} ${t}
                                <span class="remove" onclick="CompEditor.removeBlinkTarget('${name}', '${t}')">×</span>
                            </span>
                        `;
                    }).join('')}
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                    <select class="comp-select" id="blink-target-select" style="flex:1;">
                        <option value="">选择目标...</option>
                        <optgroup label="组件">${compOptions}</optgroup>
                        <optgroup label="元素">${elemOptions}</optgroup>
                    </select>
                    <button class="comp-btn" onclick="CompEditor.addBlinkTarget('${name}')">添加</button>
                </div>
            </div>
        `;
    },
    
    renderAnimationBehaviorProps(name, beh) {
        const frames = beh.frames || [];
        
        return `
            <div class="comp-form-group">
                <label>动画帧 (${frames.length})</label>
                <div class="comp-mode-list">
                    ${frames.map((frame, i) => `
                        <div class="comp-mode-item" style="border:1px solid #3a3a4a;border-radius:4px;margin-bottom:4px;">
                            <div class="comp-mode-header" style="padding:6px 8px;background:#2a2a3a;">
                                <span style="flex:1;font-size:12px;">帧 ${i + 1}</span>
                                <span style="font-size:10px;color:#888;margin-right:8px;">${frame.duration || 500}ms</span>
                                <span style="font-size:10px;color:#888;">${(frame.elements || []).length} 元素</span>
                                <span style="margin-left:8px;color:#f44;cursor:pointer;" onclick="CompEditor.removeAnimFrame('${name}', ${i})">×</span>
                            </div>
                            <div style="padding:4px 8px;font-size:10px;color:#666;background:#1a1a2a;">
                                ${(frame.elements || []).join(', ') || '(空)'}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addAnimFrame('${name}')">+ 添加帧</button>
            </div>
            <div class="comp-form-group">
                <label style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" ${beh.loop ? 'checked' : ''} 
                           onchange="CompEditor.updateBehavior('${name}', 'loop', this.checked)">
                    循环播放
                </label>
            </div>
        `;
    },
    
    // 规则属性面板
    renderRuleProperties(container, typeEl) {
        const name = this.state.selectedRule;
        const rule = this.state.rules[name];
        if (!rule) return;
        
        if (typeEl) typeEl.textContent = '事件规则';
        
        const trigger = rule.trigger || {};
        const actions = rule.actions || [];
        const triggerType = this.TRIGGER_TYPES[trigger.type] || { name: '未知' };
        
        let html = `
            <div class="comp-form-group">
                <label>规则名称</label>
                <input type="text" class="comp-input" value="${name}" 
                       onchange="CompEditor.renameRule('${name}', this.value)">
            </div>
            <div class="comp-form-group">
                <label>描述</label>
                <input type="text" class="comp-input" value="${rule.description || ''}" 
                       placeholder="规则说明"
                       onchange="CompEditor.updateRule('${name}', 'description', this.value)">
            </div>
            
            <div style="font-size:12px;font-weight:600;margin:16px 0 8px;color:var(--accent-color);">⚡ 触发器</div>
            <div class="comp-form-group">
                <label>类型: ${triggerType.name}</label>
                ${this.renderTriggerConfig(name, trigger)}
            </div>
            
            <div style="font-size:12px;font-weight:600;margin:16px 0 8px;color:#6366f1;">🎯 动作 (${actions.length})</div>
            <div class="comp-form-group">
                ${actions.map((action, i) => `
                    <div class="action-item">
                        <span class="action-type">${this.ACTION_TYPES[action.type]?.name || action.type}</span>
                        <span class="action-target">${action.target || action.event || ''}</span>
                        <span class="delete" onclick="CompEditor.removeRuleAction('${name}', ${i})">×</span>
                    </div>
                `).join('')}
                <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.showAddActionDialog('${name}')">+ 添加动作</button>
            </div>
        `;
        
        container.innerHTML = html;
    },
    
    renderTriggerConfig(ruleName, trigger) {
        if (trigger.type === 'timeout') {
            const behaviorOptions = Object.keys(this.state.behaviors).map(b => 
                `<option value="${b}" ${trigger.behavior === b ? 'selected' : ''}>${b}</option>`
            ).join('');
            return `
                <div class="comp-behavior-section">
                    <div class="comp-behavior-row">
                        <label>行为</label>
                        <select class="comp-select" onchange="CompEditor.updateTrigger('${ruleName}', 'behavior', this.value)">
                            <option value="">选择行为...</option>
                            ${behaviorOptions}
                        </select>
                    </div>
                    <div class="comp-behavior-row">
                        <label>超时</label>
                        <input type="number" value="${trigger.duration || 5000}" min="100" step="1000"
                               onchange="CompEditor.updateTrigger('${ruleName}', 'duration', parseInt(this.value))">
                        <span>ms</span>
                    </div>
                </div>
            `;
        } else if (trigger.type === 'componentChange') {
            const compOptions = Object.keys(this.state.components).map(c => 
                `<option value="${c}" ${trigger.target === c ? 'selected' : ''}>${c}</option>`
            ).join('');
            return `
                <div class="comp-behavior-section">
                    <div class="comp-behavior-row">
                        <label>组件</label>
                        <select class="comp-select" onchange="CompEditor.updateTrigger('${ruleName}', 'target', this.value)">
                            <option value="">选择组件...</option>
                            ${compOptions}
                        </select>
                    </div>
                    <div class="comp-behavior-row">
                        <label>条件</label>
                        <input type="text" class="comp-input" value="${trigger.condition || ''}" 
                               placeholder="如 level <= 0"
                               onchange="CompEditor.updateTrigger('${ruleName}', 'condition', this.value)">
                    </div>
                </div>
            `;
        } else if (trigger.type === 'event') {
            return `
                <div class="comp-behavior-section">
                    <div class="comp-behavior-row">
                        <label>事件名</label>
                        <input type="text" class="comp-input" value="${trigger.name || ''}" 
                               placeholder="如 chargingStarted"
                               onchange="CompEditor.updateTrigger('${ruleName}', 'name', this.value)">
                    </div>
                </div>
            `;
        }
        return '';
    },
    
    // Icon组件属性
    renderIconProps(comp) {
        const elements = comp.elements || [];
        const onSet = comp.onSet || {};
        
        return `
            <div class="comp-form-group">
                <label>图标元素 (${elements.length})</label>
                <div class="target-list">
                    ${elements.map(el => `
                        <span class="target-tag element">
                            📋 ${el}
                            <span class="remove" onclick="CompEditor.removeIconElement('${el}')">×</span>
                        </span>
                    `).join('')}
                </div>
                <button class="comp-btn" style="width:100%;margin-top:8px;" 
                        onclick="CompEditor.startElementPicker('icon')">
                    🎯 添加元素
                </button>
            </div>
            
            <!-- onSet 联动配置 -->
            <div class="comp-form-group">
                <label>值变化联动 (onSet)</label>
                <div class="onset-config">
                    <!-- true 时的动作 -->
                    <div class="onset-item">
                        <div class="onset-header">
                            <span class="onset-key">✅ 显示时 (true)</span>
                        </div>
                        ${this.renderOnSetActions(onSet['true'], 'true')}
                    </div>
                    
                    <!-- false 时的动作 -->
                    <div class="onset-item">
                        <div class="onset-header">
                            <span class="onset-key">❌ 隐藏时 (false)</span>
                        </div>
                        ${this.renderOnSetActions(onSet['false'], 'false')}
                    </div>
                </div>
            </div>
        `;
    },
    
    // 渲染 onSet 动作配置
    renderOnSetActions(actions, key) {
        const anim = actions?.anim || {};
        const hardware = actions?.hardware || '';
        const hasAnim = anim.id || anim.action;
        
        // 获取可用动画列表
        const animOptions = this.getAnimationOptions();
        // 获取硬件回调列表
        const hwOptions = this.getHardwareCallbackOptions();
        
        return `
            <div class="onset-actions">
                <!-- 动画配置 -->
                <div class="onset-action-row">
                    <label>动画</label>
                    <select class="comp-select" style="flex:1;" 
                            onchange="CompEditor.updateOnSetAnim('${key}', 'id', this.value)">
                        <option value="">无</option>
                        <option value="__stop__" ${anim.action === 'stop' ? 'selected' : ''}>停止动画</option>
                        ${animOptions.map(a => `
                            <option value="${a.id}" ${anim.id === a.id && anim.action !== 'stop' ? 'selected' : ''}>${a.name}</option>
                        `).join('')}
                    </select>
                </div>
                
                ${anim.id && anim.action !== 'stop' ? `
                    <div class="onset-action-row">
                        <label>间隔</label>
                        <input type="number" class="comp-input" style="flex:1;" 
                               value="${anim.interval || ''}" placeholder="默认"
                               onchange="CompEditor.updateOnSetAnim('${key}', 'interval', parseInt(this.value) || 0)">
                        <span style="color:var(--text-muted);font-size:10px;width:20px;">ms</span>
                    </div>
                    <div class="onset-action-row">
                        <label>超时</label>
                        <input type="number" class="comp-input" style="flex:1;" 
                               value="${anim.timeout || ''}" placeholder="无"
                               onchange="CompEditor.updateOnSetAnim('${key}', 'timeout', parseInt(this.value) || 0)">
                        <span style="color:var(--text-muted);font-size:10px;width:20px;">ms</span>
                    </div>
                ` : ''}
                
                <!-- 硬件回调 -->
                <div class="onset-action-row">
                    <label>硬件</label>
                    <select class="comp-select" style="flex:1;" 
                            onchange="CompEditor.updateOnSetHardware('${key}', this.value)">
                        <option value="">无</option>
                        ${hwOptions.map(hw => `
                            <option value="${hw.name}" ${hardware === hw.name ? 'selected' : ''}>${hw.name}${hw.description ? ' - ' + hw.description : ''}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `;
    },
    
    // 获取可用动画列表
    getAnimationOptions() {
        // 从 AnimController 或缓存获取
        if (typeof AnimController !== 'undefined' && AnimController.animations) {
            return Object.entries(AnimController.animations).map(([id, anim]) => ({
                id,
                name: anim.name || id
            }));
        }
        // 备用：从 state 获取
        if (this._animationCache) {
            return this._animationCache;
        }
        // 异步加载
        this.loadAnimationsAsync();
        return [];
    },
    
    async loadAnimationsAsync() {
        try {
            const data = await DeviceConfigManager.loadConfig('animations');
            if (data?.animations) {
                this._animationCache = Object.entries(data.animations).map(([id, anim]) => ({
                    id,
                    name: anim.name || id
                }));
                // 刷新属性面板
                this.renderProperties();
            }
        } catch (e) {
            console.warn('[CompEditor] 加载动画失败:', e);
        }
    },
    
    // 更新 onSet 动画配置
    updateOnSetAnim(key, field, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        if (!comp.onSet) comp.onSet = {};
        if (!comp.onSet[key]) comp.onSet[key] = {};
        
        if (field === 'id') {
            if (value === '') {
                // 清除动画配置
                delete comp.onSet[key].anim;
            } else if (value === '__stop__') {
                // 停止动画
                comp.onSet[key].anim = { action: 'stop' };
            } else {
                // 启动动画
                comp.onSet[key].anim = { id: value };
            }
        } else {
            // 更新 interval 或 timeout
            if (!comp.onSet[key].anim) comp.onSet[key].anim = {};
            if (value) {
                comp.onSet[key].anim[field] = value;
            } else {
                delete comp.onSet[key].anim[field];
            }
        }
        
        // 清理空对象
        if (comp.onSet[key].anim && Object.keys(comp.onSet[key].anim).length === 0) {
            delete comp.onSet[key].anim;
        }
        if (Object.keys(comp.onSet[key]).length === 0) {
            delete comp.onSet[key];
        }
        if (Object.keys(comp.onSet).length === 0) {
            delete comp.onSet;
        }
        
        this.renderProperties();
    },
    
    // 更新 onSet 硬件回调
    updateOnSetHardware(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        if (!comp.onSet) comp.onSet = {};
        if (!comp.onSet[key]) comp.onSet[key] = {};
        
        if (value) {
            comp.onSet[key].hardware = value;
        } else {
            delete comp.onSet[key].hardware;
        }
        
        // 清理空对象
        if (Object.keys(comp.onSet[key]).length === 0) {
            delete comp.onSet[key];
        }
        if (Object.keys(comp.onSet).length === 0) {
            delete comp.onSet;
        }
        
        this.renderProperties();
    },
    
    removeIconElement(elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.elements) return;
        const idx = comp.elements.indexOf(elemName);
        if (idx >= 0) {
            comp.elements.splice(idx, 1);
            this.renderProperties();
            this.updateHighlightFromComponent();
            this.render();
        }
    },
    
    // ========== Line 组件属性 (v3.0) ==========
    renderLineProps(comp) {
        const digits = comp.digits || [];
        const dots = comp.dots || [];
        const isPicking = this.state.elementPicker;
        
        return `
            <div class="comp-form-group">
                <label>描述</label>
                <input type="text" class="comp-input" value="${comp.description || ''}" 
                       placeholder="如: 第4行数字显示"
                       onchange="CompEditor.updateLineField('description', this.value)">
            </div>
            
            <div class="comp-form-group">
                <label>数字位 (${digits.length})</label>
                <div class="comp-digit-config">
                    ${digits.map((d, i) => `
                        <div class="comp-digit-row">
                            <label>位${i + 1}</label>
                            <div class="comp-element-picker-field ${isPicking?.type === 'lineDigit' && isPicking?.index === i ? 'picking' : ''}"
                                 onclick="CompEditor.startElementPicker('lineDigit', ${i})">
                                <span class="value">${d.element || '点击选择'}</span>
                                <span class="pick-icon">🎯</span>
                            </div>
                            <button class="comp-btn-icon delete" onclick="CompEditor.removeLineDigit(${i})">×</button>
                        </div>
                    `).join('')}
                    <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addLineDigit()">+ 添加数字位</button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>小数点 (${dots.length})</label>
                <div class="comp-digit-config">
                    ${dots.map((d, i) => `
                        <div class="comp-digit-row">
                            <label>点${i + 1}</label>
                            <div class="comp-element-picker-field ${isPicking?.type === 'lineDot' && isPicking?.index === i ? 'picking' : ''}"
                                 onclick="CompEditor.startElementPicker('lineDot', ${i})">
                                <span class="value">${d.element || '点击选择'}</span>
                                <span class="pick-icon">🎯</span>
                            </div>
                            <label style="width:auto;">后</label>
                            <input type="number" style="width:36px;" value="${d.afterDigit || 0}" min="0" max="${digits.length}"
                                   onchange="CompEditor.updateLineDot(${i}, 'afterDigit', parseInt(this.value))">
                            <button class="comp-btn-icon delete" onclick="CompEditor.removeLineDot(${i})">×</button>
                        </div>
                    `).join('')}
                    <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addLineDot()">+ 添加小数点</button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>负号元素</label>
                <div class="comp-element-picker-field ${isPicking?.type === 'lineMinus' ? 'picking' : ''}"
                     onclick="CompEditor.startElementPicker('lineMinus')">
                    <span class="value">${comp.minus || '点击选择(可选)'}</span>
                    <span class="pick-icon">🎯</span>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>单位元素配置</label>
                <div class="comp-digit-config">
                    <div style="font-size:10px;color:#f59e0b;margin-bottom:8px;padding:6px;background:rgba(245,158,11,0.1);border-radius:4px;">
                        💡 显示逻辑: 长度=base, 面积=base+², 体积=base+³<br>
                        例: m² = m元素 + ²元素
                    </div>
                    <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">📏 基础单位符号</div>
                    ${this.renderUnitElementRow(comp, 'base', 'm', 'm (米)')}
                    ${this.renderUnitElementRow(comp, 'base', 'ft', 'ft (英尺)')}
                    ${this.renderUnitElementRow(comp, 'base', 'in', 'in (英寸)')}
                    
                    <div style="font-size:10px;color:var(--text-muted);margin:8px 0 6px;">📐 指数符号 (可选数码管或专用元素)</div>
                    ${this.renderUnitElementRow(comp, 'exp', 'sq', '² 平方')}
                    ${this.renderUnitElementRow(comp, 'exp', 'cu', '³ 立方')}
                    
                    <div style="font-size:10px;color:var(--text-muted);margin:8px 0 6px;">🔢 ft+in 复合单位符号</div>
                    ${this.renderUnitElementRow(comp, 'symbol', 'ft_mark', "' 英尺符号")}
                    ${this.renderUnitElementRow(comp, 'symbol', 'in_mark', '" 英寸符号')}
                    ${this.renderUnitElementRow(comp, 'symbol', 'slash', '/ 分数线')}
                    
                    <div style="font-size:10px;color:var(--text-muted);margin:8px 0 6px;">🔢 分数元素 (ft+in 分数模式)</div>
                    ${this.renderUnitElementRow(comp, 'fraction', 'numerator', '分子')}
                    ${this.renderUnitElementRow(comp, 'fraction', 'denominator', '分母')}
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>分数配置</label>
                <div class="comp-digit-config">
                    <div class="comp-digit-row">
                        <label>分数模式</label>
                        <select class="comp-select" onchange="CompEditor.updateLineField('fractionMode', this.value)">
                            <option value="none" ${!comp.fractionMode || comp.fractionMode === 'none' ? 'selected' : ''}>不使用分数</option>
                            <option value="fixed" ${comp.fractionMode === 'fixed' ? 'selected' : ''}>固定分母</option>
                            <option value="simplify" ${comp.fractionMode === 'simplify' ? 'selected' : ''}>智能化简</option>
                        </select>
                    </div>
                    ${comp.fractionMode === 'fixed' ? `
                    <div class="comp-digit-row">
                        <label>固定分母</label>
                        <select class="comp-select" onchange="CompEditor.updateLineField('fixedDenominator', parseInt(this.value))">
                            <option value="2" ${comp.fixedDenominator === 2 ? 'selected' : ''}>2 (1/2)</option>
                            <option value="4" ${comp.fixedDenominator === 4 ? 'selected' : ''}>4 (1/4)</option>
                            <option value="8" ${comp.fixedDenominator === 8 ? 'selected' : ''}>8 (1/8)</option>
                            <option value="16" ${comp.fixedDenominator === 16 ? 'selected' : ''}>16 (1/16)</option>
                            <option value="32" ${comp.fixedDenominator === 32 ? 'selected' : ''}>32 (1/32)</option>
                        </select>
                    </div>
                    ` : ''}
                    ${comp.fractionMode === 'simplify' ? `
                    <div class="comp-digit-row">
                        <label>最大分母</label>
                        <select class="comp-select" onchange="CompEditor.updateLineField('maxDenominator', parseInt(this.value))">
                            <option value="8" ${comp.maxDenominator === 8 ? 'selected' : ''}>8</option>
                            <option value="16" ${comp.maxDenominator === 16 || !comp.maxDenominator ? 'selected' : ''}>16</option>
                            <option value="32" ${comp.maxDenominator === 32 ? 'selected' : ''}>32</option>
                        </select>
                    </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>单位转换配置</label>
                <div class="comp-digit-config">
                    <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;">
                        配置各单位的转换系数、小数位、范围
                    </div>
                    <button class="comp-btn" style="width:100%;" onclick="event.stopPropagation();CompEditor.showUnitConfigDialog()">
                        ⚙️ 编辑单位配置
                    </button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>显示配置</label>
                <div class="comp-digit-config">
                    <div class="comp-digit-row">
                        <label>数位数</label>
                        <input type="number" class="comp-input" value="${comp.digitCount || 5}" min="1" max="10"
                               onchange="CompEditor.updateLineField('digitCount', parseInt(this.value))">
                    </div>
                    <div class="comp-digit-row">
                        <label style="display:flex;align-items:center;gap:6px;">
                            <input type="checkbox" ${comp.hasSign ? 'checked' : ''} 
                                   onchange="CompEditor.updateLineField('hasSign', this.checked)">
                            支持负数
                        </label>
                    </div>
                </div>
            </div>
        `;
    },
    
    renderUnitElementRow(comp, dataType, unitKey, label) {
        const units = comp.units || {};
        const typeUnits = units[dataType] || {};
        const elements = typeUnits[unitKey] || [];
        const isPicking = this.state.elementPicker;
        const isPickingThis = isPicking?.type === 'lineUnit' && isPicking?.dataType === dataType && isPicking?.unitKey === unitKey;
        
        return `
            <div class="comp-digit-row">
                <label style="width:80px;flex-shrink:0;">${label}</label>
                <div class="comp-element-picker-field ${isPickingThis ? 'picking' : ''}" style="flex:1;"
                     onclick="CompEditor.startLineUnitPicker('${dataType}', '${unitKey}')">
                    <span class="value">${elements.length > 0 ? elements.join(', ') : '点击选择'}</span>
                    <span class="pick-icon">🎯</span>
                </div>
            </div>
        `;
    },
    
    // ========== Selector 组件属性 (v3.0) ==========
    renderSelectorProps(comp) {
        const options = comp.options || [];
        const isPicking = this.state.elementPicker;
        const onSet = comp.onSet || {};
        
        return `
            <div class="comp-form-group">
                <label>描述</label>
                <input type="text" class="comp-input" value="${comp.description || ''}" 
                       placeholder="如: 单位选择"
                       onchange="CompEditor.updateSelectorField('description', this.value)">
            </div>
            
            <div class="comp-form-group">
                <label>选项列表 (${options.length}) <span style="font-size:10px;color:var(--text-muted);">KEY用于生成枚举</span></label>
                <div class="comp-mode-list">
                    ${options.map((opt, i) => `
                        <div class="comp-mode-item ${this.state.selectedMode === opt.key ? 'expanded' : ''}">
                            <div class="comp-mode-header" onclick="CompEditor.toggleSelectorOption('${opt.key}')">
                                <span class="comp-mode-name" style="font-family:monospace;color:#4ade80;">${opt.key}</span>
                                <span class="comp-mode-count">${(opt.elements || []).length}个元素</span>
                                <span class="comp-mode-delete" onclick="event.stopPropagation();CompEditor.removeSelectorOption(${i})">×</span>
                            </div>
                            <div class="comp-mode-elements">
                                <div style="display:flex;gap:8px;margin-bottom:8px;">
                                    <div style="flex:1;">
                                        <label style="font-size:10px;color:var(--text-muted);">KEY (枚举名)</label>
                                        <input type="text" class="comp-input" value="${opt.key}" 
                                               placeholder="如 M, FT, FRONT"
                                               onchange="CompEditor.updateSelectorOptionKey(${i}, this.value)"
                                               style="font-family:monospace;">
                                    </div>
                                    <div style="width:60px;">
                                        <label style="font-size:10px;color:var(--text-muted);">值</label>
                                        <input type="number" class="comp-input" value="${opt.value}" 
                                               onchange="CompEditor.updateSelectorOptionValue(${i}, parseInt(this.value))">
                                    </div>
                                </div>
                                <div class="target-list">
                                    ${(opt.elements || []).map(el => `
                                        <span class="target-tag element">
                                            ${el}
                                            <span class="remove" onclick="CompEditor.removeSelectorElement(${i}, '${el}')">×</span>
                                        </span>
                                    `).join('')}
                                </div>
                                <button class="comp-btn" style="width:100%;margin-top:8px;" 
                                        onclick="CompEditor.startSelectorElementPicker(${i})">
                                    🎯 添加元素
                                </button>
                            </div>
                        </div>
                    `).join('')}
                    <button class="comp-btn" style="width:100%;margin-top:8px;" onclick="CompEditor.addSelectorOption()">+ 添加选项</button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>框架元素 (常显)</label>
                <div class="comp-element-picker-field ${isPicking?.type === 'selectorFrame' ? 'picking' : ''}"
                     onclick="CompEditor.startElementPicker('selectorFrame')">
                    <span class="value">${(comp.frame || []).length > 0 ? comp.frame.join(', ') : '点击选择(可选)'}</span>
                    <span class="pick-icon">🎯</span>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>默认值</label>
                <select class="comp-select" onchange="CompEditor.updateSelectorField('default', parseInt(this.value))">
                    ${options.map(opt => `
                        <option value="${opt.value}" ${comp.default === opt.value ? 'selected' : ''}>${opt.key}</option>
                    `).join('')}
                </select>
            </div>
            
            <div class="comp-form-group">
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" ${comp.triggerRefresh ? 'checked' : ''} 
                           onchange="CompEditor.updateSelectorField('triggerRefresh', this.checked)">
                    切换时刷新所有Line (unit专用)
                </label>
            </div>
            
            <!-- onSet 联动配置 -->
            <div class="comp-form-group">
                <label>值变化联动 (onSet) <button class="comp-btn" style="padding:2px 8px;font-size:10px;float:right;" onclick="CompEditor.addSelectorOnSet()">+ 添加</button></label>
                <div class="onset-config">
                    ${Object.keys(onSet).length === 0 ? 
                        '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:12px;">暂无联动配置</div>' :
                        Object.entries(onSet).map(([key, actions]) => {
                            const opt = options.find(o => String(o.value) === key);
                            const label = opt ? `${opt.key} (值=${key})` : `值=${key}`;
                            return `
                                <div class="onset-item">
                                    <div class="onset-header">
                                        <span class="onset-key">🔘 ${label}</span>
                                        <span class="comp-mode-delete" onclick="CompEditor.removeSelectorOnSet('${key}')">×</span>
                                    </div>
                                    ${this.renderSelectorOnSetActions(actions, key)}
                                </div>
                            `;
                        }).join('')
                    }
                </div>
            </div>
            
            <div style="margin-top:12px;padding:8px;background:rgba(74,222,128,0.1);border-radius:4px;font-size:10px;color:var(--text-muted);">
                💡 生成的C代码枚举: <code style="color:#4ade80;">${this.state.selectedComp?.toUpperCase()}_${options.map(o => o.key).join(', ' + this.state.selectedComp?.toUpperCase() + '_')}</code>
            </div>
        `;
    },
    
    // 渲染 Selector 的 onSet 动作配置
    renderSelectorOnSetActions(actions, key) {
        const anim = actions?.anim || {};
        const hardware = actions?.hardware || '';
        const comp = this.state.components[this.state.selectedComp];
        const options = comp?.options || [];
        
        // 获取可用动画列表
        const animOptions = this.getAnimationOptions();
        // 获取硬件回调列表
        const hwOptions = this.getHardwareCallbackOptions();
        
        return `
            <div class="onset-actions">
                <!-- 选择触发值 -->
                <div class="onset-action-row">
                    <label>触发值</label>
                    <select class="comp-select" style="flex:1;" 
                            onchange="CompEditor.changeSelectorOnSetKey('${key}', this.value)">
                        ${options.map(opt => `
                            <option value="${opt.value}" ${String(opt.value) === key ? 'selected' : ''}>${opt.key} (${opt.value})</option>
                        `).join('')}
                    </select>
                </div>
                
                <!-- 动画配置 -->
                <div class="onset-action-row">
                    <label>动画</label>
                    <select class="comp-select" style="flex:1;" 
                            onchange="CompEditor.updateSelectorOnSetAnim('${key}', 'id', this.value)">
                        <option value="">无</option>
                        <option value="__stop__" ${anim.action === 'stop' ? 'selected' : ''}>停止动画</option>
                        ${animOptions.map(a => `
                            <option value="${a.id}" ${anim.id === a.id && anim.action !== 'stop' ? 'selected' : ''}>${a.name}</option>
                        `).join('')}
                    </select>
                </div>
                
                ${anim.id && anim.action !== 'stop' ? `
                    <div class="onset-action-row">
                        <label>间隔</label>
                        <input type="number" class="comp-input" style="flex:1;" 
                               value="${anim.interval || ''}" placeholder="默认"
                               onchange="CompEditor.updateSelectorOnSetAnim('${key}', 'interval', parseInt(this.value) || 0)">
                        <span style="color:var(--text-muted);font-size:10px;width:20px;">ms</span>
                    </div>
                    <div class="onset-action-row">
                        <label>超时</label>
                        <input type="number" class="comp-input" style="flex:1;" 
                               value="${anim.timeout || ''}" placeholder="无"
                               onchange="CompEditor.updateSelectorOnSetAnim('${key}', 'timeout', parseInt(this.value) || 0)">
                        <span style="color:var(--text-muted);font-size:10px;width:20px;">ms</span>
                    </div>
                ` : ''}
                
                <!-- 硬件回调 -->
                <div class="onset-action-row">
                    <label>硬件</label>
                    <select class="comp-select" style="flex:1;" 
                            onchange="CompEditor.updateSelectorOnSetHardware('${key}', this.value)">
                        <option value="">无</option>
                        ${hwOptions.map(hw => `
                            <option value="${hw.name}" ${hardware === hw.name ? 'selected' : ''}>${hw.name}${hw.description ? ' - ' + hw.description : ''}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `;
    },
    
    // 修改 Selector onSet 的触发值
    changeSelectorOnSetKey(oldKey, newKey) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.onSet || oldKey === newKey) return;
        
        // 检查新key是否已存在
        if (comp.onSet[newKey]) {
            this.showToast('该值已有配置', 'warning');
            this.renderProperties();
            return;
        }
        
        // 移动配置
        comp.onSet[newKey] = comp.onSet[oldKey];
        delete comp.onSet[oldKey];
        
        this.renderProperties();
    },
    
    // 更新 Selector onSet 动画配置
    updateSelectorOnSetAnim(key, field, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        if (!comp.onSet) comp.onSet = {};
        if (!comp.onSet[key]) comp.onSet[key] = {};
        
        if (field === 'id') {
            if (value === '') {
                // 清除动画配置
                delete comp.onSet[key].anim;
            } else if (value === '__stop__') {
                // 停止动画
                comp.onSet[key].anim = { action: 'stop' };
            } else {
                // 启动动画
                comp.onSet[key].anim = { id: value };
            }
        } else {
            // 更新 interval 或 timeout
            if (!comp.onSet[key].anim) comp.onSet[key].anim = {};
            if (value) {
                comp.onSet[key].anim[field] = value;
            } else {
                delete comp.onSet[key].anim[field];
            }
        }
        
        // 清理空对象
        if (comp.onSet[key].anim && Object.keys(comp.onSet[key].anim).length === 0) {
            delete comp.onSet[key].anim;
        }
        if (Object.keys(comp.onSet[key]).length === 0) {
            delete comp.onSet[key];
        }
        if (Object.keys(comp.onSet).length === 0) {
            delete comp.onSet;
        }
        
        this.renderProperties();
    },
    
    // 更新 Selector onSet 硬件回调
    updateSelectorOnSetHardware(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        if (!comp.onSet) comp.onSet = {};
        if (!comp.onSet[key]) comp.onSet[key] = {};
        
        if (value) {
            comp.onSet[key].hardware = value;
        } else {
            delete comp.onSet[key].hardware;
        }
        
        // 清理空对象
        if (Object.keys(comp.onSet[key]).length === 0) {
            delete comp.onSet[key];
        }
        if (Object.keys(comp.onSet).length === 0) {
            delete comp.onSet;
        }
        
        this.renderProperties();
    },
    
    // 添加 Selector onSet 联动
    addSelectorOnSet() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.options?.length) {
            this.showToast('请先添加选项', 'warning');
            return;
        }
        
        // 找一个还没配置的选项值
        const existingKeys = Object.keys(comp.onSet || {});
        const availableOpt = comp.options.find(o => !existingKeys.includes(String(o.value)));
        
        if (!availableOpt) {
            this.showToast('所有选项都已配置', 'info');
            return;
        }
        
        if (!comp.onSet) comp.onSet = {};
        comp.onSet[String(availableOpt.value)] = {};
        
        this.renderProperties();
    },
    
    // 删除 Selector onSet 联动
    removeSelectorOnSet(key) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.onSet) return;
        
        delete comp.onSet[key];
        
        if (Object.keys(comp.onSet).length === 0) {
            delete comp.onSet;
        }
        
        this.renderProperties();
    },

    renderNumberDisplayProps(comp) {
        const config = comp.config || {};
        const digits = config.digits || [];
        const dots = config.dots || [];
        const isPicking = this.state.elementPicker;
        
        return `
            <div class="comp-form-group">
                <label>数字位 (${digits.length})</label>
                <div class="comp-digit-config">
                    ${digits.map((d, i) => `
                        <div class="comp-digit-row">
                            <label>位${i + 1}</label>
                            <div class="comp-element-picker-field ${isPicking?.type === 'digit' && isPicking?.index === i ? 'picking' : ''}"
                                 onclick="CompEditor.startElementPicker('digit', ${i})">
                                <span class="value">${d.element || '点击选择'}</span>
                                <span class="pick-icon">🎯</span>
                            </div>
                            <button class="comp-btn-icon delete" onclick="CompEditor.removeDigit(${i})">×</button>
                        </div>
                    `).join('')}
                    <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addDigit()">+ 添加数字位</button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>小数点 (${dots.length})</label>
                <div class="comp-digit-config">
                    ${dots.map((d, i) => `
                        <div class="comp-digit-row">
                            <label>点${i + 1}</label>
                            <div class="comp-element-picker-field ${isPicking?.type === 'dot' && isPicking?.index === i ? 'picking' : ''}"
                                 onclick="CompEditor.startElementPicker('dot', ${i})">
                                <span class="value">${d.element || '点击选择'}</span>
                                <span class="pick-icon">🎯</span>
                            </div>
                            <label style="width:auto;">后</label>
                            <input type="number" style="width:36px;" value="${d.afterDigit || 0}" min="0" max="${digits.length}"
                                   onchange="CompEditor.updateDot(${i}, 'afterDigit', parseInt(this.value))">
                            <button class="comp-btn-icon delete" onclick="CompEditor.removeDot(${i})">×</button>
                        </div>
                    `).join('')}
                    <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addDot()">+ 添加小数点</button>
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>符号位</label>
                <div class="comp-element-picker-field ${isPicking?.type === 'sign' ? 'picking' : ''}"
                     onclick="CompEditor.startElementPicker('sign')">
                    <span class="value">${config.sign?.element || '点击选择(可选)'}</span>
                    <span class="pick-icon">🎯</span>
                </div>
                ${config.sign?.element ? `<button class="comp-btn" style="margin-top:4px;" onclick="CompEditor.updateSign('')">清除符号位</button>` : ''}
            </div>
            
            <div class="comp-form-group">
                <label>显示配置</label>
                <div class="comp-digit-config">
                    <div class="comp-digit-row">
                        <label>对齐</label>
                        <select onchange="CompEditor.updateConfig('alignment', this.value)">
                            <option value="right" ${config.alignment === 'right' ? 'selected' : ''}>右对齐</option>
                            <option value="left" ${config.alignment === 'left' ? 'selected' : ''}>左对齐</option>
                        </select>
                    </div>
                    <div class="comp-digit-row">
                        <label>小数位</label>
                        <input type="number" value="${config.decimalPlaces || 3}" min="0" max="5"
                               onchange="CompEditor.updateConfig('decimalPlaces', parseInt(this.value))">
                    </div>
                </div>
            </div>
        `;
    },
    
    renderModeSelectorProps(comp) {
        const modes = comp.modes || {};
        const modeNames = Object.keys(modes);
        
        return `
            <div class="comp-form-group">
                <label>模式列表 <button class="comp-btn" style="padding:1px 6px;font-size:10px;float:right;" onclick="CompEditor.addMode()">+ 添加</button></label>
                <div class="comp-mode-list">
                    ${modeNames.map(name => {
                        const elements = modes[name] || [];
                        const isSelected = this.state.selectedMode === name;
                        return `
                            <div class="comp-mode-item ${isSelected ? 'expanded' : ''}">
                                <div class="comp-mode-header" onclick="CompEditor.selectMode('${name}')">
                                    <span class="comp-mode-name">${isSelected ? '▼' : '▶'} ${name}</span>
                                    <span class="comp-mode-count">${elements.length} 元素</span>
                                    <span class="comp-mode-delete" onclick="event.stopPropagation();CompEditor.deleteMode('${name}')">×</span>
                                </div>
                                <div class="comp-mode-elements">
                                    ${elements.map(el => `
                                        <span class="comp-mode-element-tag">
                                            ${el}
                                            <span class="remove" onclick="CompEditor.removeElementFromMode('${name}', '${el}')">×</span>
                                        </span>
                                    `).join('')}
                                    <button class="comp-btn" style="padding:2px 8px;font-size:10px;margin-top:4px;" 
                                            onclick="CompEditor.startModeElementPicker('${name}')">
                                        🎯 添加元素
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${modeNames.length === 0 ? '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:12px;">点击"添加"创建模式</div>' : ''}
                </div>
            </div>
            
            <div class="comp-form-group">
                <label>默认模式</label>
                <select class="comp-select" onchange="CompEditor.setDefaultMode(this.value)">
                    <option value="">无</option>
                    ${modeNames.map(name => `<option value="${name}" ${comp.defaultMode === name ? 'selected' : ''}>${name}</option>`).join('')}
                </select>
            </div>
        `;
    },
    
    renderLevelIndicatorProps(comp) {
        const isPicking = this.state.elementPicker;
        const pickerLevelIndex = isPicking?.type === 'level' ? isPicking.index : null;
        
        return `
            <div class="comp-form-group">
                <label>外框元素</label>
                <div class="comp-element-picker-field ${isPicking?.type === 'levelFrame' ? 'picking' : ''}"
                     onclick="CompEditor.startElementPicker('levelFrame')">
                    <span class="value">${comp.frame || '点击选择(可选)'}</span>
                    <span class="pick-icon">🎯</span>
                </div>
                ${comp.frame ? `<button class="comp-btn" style="margin-top:4px;" onclick="CompEditor.updateLevelFrame('')">清除外框</button>` : ''}
            </div>
            <div class="comp-form-group">
                <label>等级配置 (${(comp.levels || []).length} 级)</label>
                <div class="comp-mode-list">
                    ${(comp.levels || []).map((level, i) => {
                        const isEditing = pickerLevelIndex === i;
                        return `
                            <div class="comp-mode-item ${isEditing ? 'expanded' : ''}" style="border:1px solid ${isEditing ? '#4caf50' : '#3a3a4a'};border-radius:4px;margin-bottom:4px;">
                                <div class="comp-mode-header" style="display:flex;align-items:center;padding:6px 8px;background:${isEditing ? '#2a3a2a' : '#2a2a3a'};cursor:pointer;" onclick="CompEditor.selectLevel(${i})">
                                    <span style="flex:1;font-size:12px;color:#ddd;">${isEditing ? '▼' : '▶'} 等级 ${i}</span>
                                    <span style="font-size:11px;color:#888;margin-right:8px;">${level.length}</span>
                                    <span style="color:${isEditing ? '#4caf50' : '#888'};">🎯</span>
                                    <span class="comp-mode-delete" style="margin-left:6px;color:#f44;cursor:pointer;" onclick="event.stopPropagation();CompEditor.deleteLevel(${i})">×</span>
                                </div>
                                <div class="comp-mode-elements" style="padding:4px 8px;background:#1a1a2a;${isEditing ? '' : 'display:none;'}">
                                    ${level.map(el => `
                                        <span class="comp-mode-element-tag">
                                            ${el}
                                            <span class="remove" onclick="CompEditor.removeElementFromLevel(${i}, '${el}')">×</span>
                                        </span>
                                    `).join('')}
                                    ${level.length === 0 ? '<span style="font-size:10px;color:#666;">(空)</span>' : ''}
                                    <button class="comp-btn" style="padding:2px 8px;font-size:10px;margin-top:4px;" 
                                            onclick="CompEditor.startLevelElementPicker(${i})">
                                        🎯 添加元素
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addLevel()">+ 添加等级</button>
            </div>
        `;
    },
    
    renderBlinkIconProps(comp) {
        return `
            <div class="comp-form-group">
                <label>元素</label>
                <div class="comp-element-picker">
                    ${this.state.elements.slice(0, 20).map(e => {
                        const name = e.name || e.id;
                        const isIn = (comp.elements || []).includes(name);
                        return `
                            <div class="comp-element-item ${isIn ? 'selected' : ''}" onclick="CompEditor.toggleBlinkElement('${name}')">
                                <input type="checkbox" ${isIn ? 'checked' : ''}>
                                <span>${name}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            <div class="comp-form-group">
                <label>行为配置</label>
                <div class="comp-behavior-section">
                    <div class="comp-behavior-row">
                        <label>闪烁间隔</label>
                        <input type="number" value="${comp.blinkInterval || 300}" min="100" step="100"
                               onchange="CompEditor.updateBlinkConfig('blinkInterval', parseInt(this.value))"> ms
                    </div>
                    <div class="comp-behavior-row">
                        <label>超时时间</label>
                        <input type="number" value="${comp.timeout || 0}" min="0" step="1000"
                               onchange="CompEditor.updateBlinkConfig('timeout', parseInt(this.value))"> ms
                    </div>
                    <div class="comp-behavior-row">
                        <label>超时回调</label>
                        <input type="text" style="flex:1;" value="${comp.onTimeout || ''}" placeholder="事件名"
                               onchange="CompEditor.updateBlinkConfig('onTimeout', this.value)">
                    </div>
                </div>
            </div>
        `;
    },
    
    renderAnimatedIconProps(comp) {
        const isPicking = this.state.elementPicker;
        const pickerFrameIndex = isPicking?.type === 'frame' && isPicking?.index !== undefined ? isPicking.index : null;
        
        return `
            <div class="comp-form-group">
                <label>动画帧 (${(comp.frames || []).length} 帧)</label>
                <div class="comp-mode-list">
                    ${(comp.frames || []).map((frame, i) => {
                        const isEditing = pickerFrameIndex === i;
                        return `
                            <div class="comp-mode-item ${isEditing ? 'expanded' : ''}" style="border:1px solid ${isEditing ? '#2196f3' : '#3a3a4a'};border-radius:4px;margin-bottom:4px;">
                                <div class="comp-mode-header" style="display:flex;align-items:center;padding:6px 8px;background:${isEditing ? '#1a2a3a' : '#2a2a3a'};cursor:pointer;" onclick="CompEditor.selectFrame(${i})">
                                    <span style="flex:1;font-size:12px;color:#ddd;">${isEditing ? '▼' : '▶'} 帧 ${i + 1}</span>
                                    <span style="font-size:11px;color:#888;margin-right:8px;">${frame.length} 元素</span>
                                    <span style="color:${isEditing ? '#2196f3' : '#888'};">🎯</span>
                                    <span class="comp-mode-delete" style="margin-left:6px;color:#f44;cursor:pointer;" onclick="event.stopPropagation();CompEditor.deleteFrame(${i})">×</span>
                                </div>
                                <div class="comp-mode-elements" style="padding:4px 8px;background:#1a1a2a;${isEditing ? '' : 'display:none;'}">
                                    ${frame.map(el => `
                                        <span class="comp-mode-element-tag">
                                            ${el}
                                            <span class="remove" onclick="CompEditor.removeElementFromFrame(${i}, '${el}')">×</span>
                                        </span>
                                    `).join('')}
                                    ${frame.length === 0 ? '<span style="font-size:10px;color:#666;">(空)</span>' : ''}
                                    <button class="comp-btn" style="padding:2px 8px;font-size:10px;margin-top:4px;" 
                                            onclick="CompEditor.startFrameElementPicker(${i})">
                                        🎯 添加元素
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <button class="comp-btn" style="width:100%;margin-top:6px;" onclick="CompEditor.addFrame()">+ 添加帧</button>
            </div>
            <div class="comp-form-group">
                <label>动画配置</label>
                <div class="comp-behavior-section">
                    <div class="comp-behavior-row">
                        <label>帧间隔</label>
                        <input type="number" value="${comp.interval || 500}" min="100" step="100"
                               onchange="CompEditor.updateAnimConfig('interval', parseInt(this.value))"> ms
                    </div>
                    <div class="comp-behavior-row">
                        <input type="checkbox" ${comp.loop ? 'checked' : ''} onchange="CompEditor.updateAnimConfig('loop', this.checked)">
                        <label>循环播放</label>
                    </div>
                </div>
            </div>
        `;
    },

    // ========== Line 组件操作 (v3.0) ==========
    updateLineField(field, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        comp[field] = value;
        this.renderProperties();
    },
    
    addLineDigit() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        if (!comp.digits) comp.digits = [];
        comp.digits.push({ element: '', position: comp.digits.length });
        this.renderProperties();
    },
    
    removeLineDigit(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.digits) return;
        comp.digits.splice(index, 1);
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    addLineDot() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        if (!comp.dots) comp.dots = [];
        comp.dots.push({ element: '', afterDigit: comp.dots.length });
        this.renderProperties();
    },
    
    removeLineDot(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.dots) return;
        comp.dots.splice(index, 1);
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    updateLineDot(index, field, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.dots?.[index]) return;
        comp.dots[index][field] = value;
    },
    
    startLineUnitPicker(dataType, unitKey) {
        // 生成友好的提示信息
        const labels = {
            base: { m: 'm(米)', ft: 'ft(英尺)', in: 'in(英寸)' },
            exp: { sq: '²平方', cu: '³立方' },
            symbol: { ft_mark: "'符号", in_mark: '"符号', slash: '/分数线' },
            fraction: { numerator: '分子', denominator: '分母' }
        };
        const label = labels[dataType]?.[unitKey] || `${dataType}/${unitKey}`;
        
        this.state.elementPicker = { type: 'lineUnit', dataType, unitKey };
        this.switchTab('elements');
        this.showToast(`为 ${label} 选择元素`, 'info');
        document.body.classList.add('element-picker-active');
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    showUnitConfigDialog() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        
        // 防止重复弹出：先移除已有的对话框
        const existing = document.querySelector('.hsm-dialog-overlay.unit-config-dialog');
        if (existing) existing.remove();
        
        const cfg = comp.unitConfig || {};
        const units = comp.units || {};
        
        // 检查是否配置了基础单位
        const baseUnits = units.base || {};
        const hasBaseUnits = Object.keys(baseUnits).some(k => (baseUnits[k] || []).length > 0);
        
        // 检查是否配置了指数符号
        const expUnits = units.exp || {};
        const hasSq = (expUnits.sq || []).length > 0;
        const hasCu = (expUnits.cu || []).length > 0;
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay unit-config-dialog';
        dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); }; // 点击遮罩关闭
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:550px;max-height:80vh;overflow-y:auto;">
                <div class="hsm-dialog-header">
                    <span>单位转换配置</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">
                        配置各单位的转换系数、小数位数、显示范围<br>
                        <span style="color:#f59e0b;">💡 显示逻辑: 长度=base, 面积=base+², 体积=base+³</span>
                    </div>
                    
                    ${!hasBaseUnits ? `
                        <div style="text-align:center;color:var(--text-muted);padding:20px;">
                            暂无已配置的基础单位元素<br>
                            请先在上方"单位元素配置"中添加 m/ft/in
                        </div>
                    ` : `
                        <div style="display:grid;grid-template-columns:80px 1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px;font-size:10px;color:var(--text-muted);">
                            <span>单位</span><span>系数</span><span>小数位</span><span>最小值</span><span>最大值</span>
                        </div>
                        
                        <div style="font-weight:bold;margin:12px 0 8px;color:#4ade80;">📏 长度单位</div>
                        ${(baseUnits.m || []).length > 0 ? this.renderUnitConfigRow(cfg, 'length', 'm', 'm') : ''}
                        ${(baseUnits.ft || []).length > 0 ? this.renderUnitConfigRow(cfg, 'length', 'ft', 'ft') : ''}
                        ${(baseUnits.in || []).length > 0 ? this.renderUnitConfigRow(cfg, 'length', 'in', 'in') : ''}
                        ${(baseUnits.ft || []).length > 0 && (baseUnits.in || []).length > 0 ? this.renderUnitConfigRow(cfg, 'length', 'ft_in', "ft+in", true) : ''}
                        
                        ${hasSq ? `
                            <div style="font-weight:bold;margin:12px 0 8px;color:#60a5fa;">📐 面积单位 (base + ²)</div>
                            ${(baseUnits.m || []).length > 0 ? this.renderUnitConfigRow(cfg, 'area', 'm2', 'm²') : ''}
                            ${(baseUnits.ft || []).length > 0 ? this.renderUnitConfigRow(cfg, 'area', 'ft2', 'ft²') : ''}
                            ${(baseUnits.in || []).length > 0 ? this.renderUnitConfigRow(cfg, 'area', 'in2', 'in²') : ''}
                        ` : ''}
                        
                        ${hasCu ? `
                            <div style="font-weight:bold;margin:12px 0 8px;color:#f472b6;">📦 体积单位 (base + ³)</div>
                            ${(baseUnits.m || []).length > 0 ? this.renderUnitConfigRow(cfg, 'volume', 'm3', 'm³') : ''}
                            ${(baseUnits.ft || []).length > 0 ? this.renderUnitConfigRow(cfg, 'volume', 'ft3', 'ft³') : ''}
                            ${(baseUnits.in || []).length > 0 ? this.renderUnitConfigRow(cfg, 'volume', 'in3', 'in³') : ''}
                        ` : ''}
                    `}
                    
                    <div style="display:flex;gap:8px;margin-top:16px;">
                        <button class="comp-btn" style="flex:1;" onclick="this.closest('.hsm-dialog-overlay').remove()">取消</button>
                        <button class="comp-btn primary" style="flex:1;" onclick="CompEditor.saveUnitConfig();this.closest('.hsm-dialog-overlay').remove()">保存</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    },
    
    renderUnitConfigRow(cfg, dataType, unitKey, label, isCompound = false) {
        const typeCfg = cfg[dataType] || {};
        const unitCfg = typeCfg[unitKey] || { factor: 1, decimals: 3, min: 0, max: 99999 };
        
        // 复合单位（如 ft'in"）不需要系数配置
        if (isCompound) {
            return `
                <div style="display:grid;grid-template-columns:70px 1fr;gap:6px;margin-bottom:6px;font-size:11px;">
                    <span style="color:var(--text-muted);">${label}</span>
                    <span style="color:#f59e0b;font-size:10px;">复合单位，无需配置系数</span>
                </div>
            `;
        }
        
        return `
            <div style="display:grid;grid-template-columns:70px 1fr 1fr 1fr 1fr;gap:6px;margin-bottom:6px;font-size:11px;">
                <span style="color:var(--text-muted);">${label}</span>
                <input type="number" step="0.0001" value="${unitCfg.factor}" placeholder="系数" 
                       data-type="${dataType}" data-unit="${unitKey}" data-field="factor"
                       style="padding:4px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:3px;color:var(--text-primary);">
                <input type="number" value="${unitCfg.decimals}" placeholder="小数" min="0" max="5"
                       data-type="${dataType}" data-unit="${unitKey}" data-field="decimals"
                       style="padding:4px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:3px;color:var(--text-primary);">
                <input type="number" step="0.001" value="${unitCfg.min}" placeholder="最小"
                       data-type="${dataType}" data-unit="${unitKey}" data-field="min"
                       style="padding:4px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:3px;color:var(--text-primary);">
                <input type="number" step="0.001" value="${unitCfg.max}" placeholder="最大"
                       data-type="${dataType}" data-unit="${unitKey}" data-field="max"
                       style="padding:4px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:3px;color:var(--text-primary);">
            </div>
        `;
    },
    
    saveUnitConfig() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Line') return;
        
        if (!comp.unitConfig) comp.unitConfig = {};
        
        const inputs = document.querySelectorAll('.hsm-dialog input[data-type]');
        inputs.forEach(input => {
            const dataType = input.dataset.type;
            const unitKey = input.dataset.unit;
            const field = input.dataset.field;
            const value = field === 'decimals' ? parseInt(input.value) : parseFloat(input.value);
            
            if (!comp.unitConfig[dataType]) comp.unitConfig[dataType] = {};
            if (!comp.unitConfig[dataType][unitKey]) comp.unitConfig[dataType][unitKey] = {};
            comp.unitConfig[dataType][unitKey][field] = value;
        });
        
        this.showToast('单位配置已保存', 'success');
    },
    
    // ========== Selector 组件操作 (v3.0) ==========
    updateSelectorField(field, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Selector') return;
        comp[field] = value;
        this.renderProperties();
    },
    
    addSelectorOption() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || comp.type !== 'Selector') return;
        
        const key = prompt('选项KEY (如 M, FT, FRONT):', 'OPT_' + Date.now());
        if (!key) return;
        
        if (!comp.options) comp.options = [];
        const value = comp.options.length;
        comp.options.push({ key: key.toUpperCase(), value, elements: [] });
        
        this.renderProperties();
        this.showToast(`添加选项: ${key}`, 'success');
    },
    
    removeSelectorOption(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.options) return;
        
        if (!confirm('删除此选项?')) return;
        comp.options.splice(index, 1);
        
        // 重新编号value
        comp.options.forEach((opt, i) => opt.value = i);
        
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    toggleSelectorOption(key) {
        if (this.state.selectedMode === key) {
            this.state.selectedMode = null;
        } else {
            this.state.selectedMode = key;
        }
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    startSelectorElementPicker(optionIndex) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.options?.[optionIndex]) return;
        
        this.state.elementPicker = { type: 'selectorOption', optionIndex };
        this.state.selectedMode = comp.options[optionIndex].key;
        this.switchTab('elements');
        this.showToast(`为选项 "${comp.options[optionIndex].key}" 选择元素`, 'info');
        document.body.classList.add('element-picker-active');
        this.updateHighlightFromComponent();
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    removeSelectorElement(optionIndex, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.options?.[optionIndex]?.elements) return;
        
        const idx = comp.options[optionIndex].elements.indexOf(elemName);
        if (idx >= 0) {
            comp.options[optionIndex].elements.splice(idx, 1);
            this.updateHighlightFromComponent();
            this.renderProperties();
            this.render();
        }
    },
    
    // 更新选项KEY
    updateSelectorOptionKey(optionIndex, newKey) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.options?.[optionIndex]) return;
        
        // 转大写，去除非法字符
        newKey = newKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        if (!newKey) return;
        
        const oldKey = comp.options[optionIndex].key;
        comp.options[optionIndex].key = newKey;
        
        // 如果当前选中的是这个选项，更新选中状态
        if (this.state.selectedMode === oldKey) {
            this.state.selectedMode = newKey;
        }
        
        this.renderProperties();
    },
    
    // 更新选项值
    updateSelectorOptionValue(optionIndex, newValue) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.options?.[optionIndex]) return;
        
        comp.options[optionIndex].value = newValue;
        this.renderProperties();
    },

    // ========== NumberDisplay 操作 ==========
    addDigit() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config) return;
        if (!comp.config.digits) comp.config.digits = [];
        comp.config.digits.push({ element: '', position: comp.config.digits.length });
        this.renderProperties();
    },
    
    removeDigit(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config?.digits) return;
        comp.config.digits.splice(index, 1);
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    updateDigit(index, key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config?.digits?.[index]) return;
        comp.config.digits[index][key] = value;
        this.updateHighlightFromComponent();
        this.render();
    },
    
    addDot() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config) return;
        if (!comp.config.dots) comp.config.dots = [];
        comp.config.dots.push({ element: '', afterDigit: 0 });
        this.renderProperties();
    },
    
    removeDot(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config?.dots) return;
        comp.config.dots.splice(index, 1);
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    updateDot(index, key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config?.dots?.[index]) return;
        comp.config.dots[index][key] = value;
        this.updateHighlightFromComponent();
        this.render();
    },
    
    updateSign(value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config) return;
        comp.config.sign = value ? { element: value } : null;
        this.updateHighlightFromComponent();
        this.render();
    },
    
    updateConfig(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.config) return;
        comp.config[key] = value;
    },
    
    updatePreset(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.presets) return;
        comp.presets[key] = value;
    },

    // ========== ModeSelector 操作 ==========
    addMode() {
        const name = prompt('模式名称:', 'mode_' + Date.now());
        if (!name) return;
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.modes) comp.modes = {};
        if (comp.modes[name]) {
            this.showToast('模式已存在', 'warning');
            return;
        }
        comp.modes[name] = [];
        this.state.selectedMode = name;
        this.renderProperties();
    },
    
    selectMode(name) {
        this.state.selectedMode = this.state.selectedMode === name ? null : name;
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    deleteMode(name) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.modes) return;
        delete comp.modes[name];
        if (this.state.selectedMode === name) {
            this.state.selectedMode = null;
        }
        this.renderProperties();
    },
    
    removeElementFromMode(modeName, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp?.modes?.[modeName]) return;
        const idx = comp.modes[modeName].indexOf(elemName);
        if (idx >= 0) {
            comp.modes[modeName].splice(idx, 1);
        }
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    setDefaultMode(value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        comp.defaultMode = value || null;
    },

    // ========== BlinkIcon 操作 ==========
    toggleBlinkElement(name) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        if (!comp.elements) comp.elements = [];
        const idx = comp.elements.indexOf(name);
        if (idx >= 0) {
            comp.elements.splice(idx, 1);
        } else {
            comp.elements.push(name);
        }
        this.updateHighlightFromComponent();
        this.renderProperties();
        this.render();
    },
    
    updateBlinkConfig(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        comp[key] = value;
    },

    // ========== LevelIndicator 操作 ==========
    updateLevelFrame(value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        comp.frame = value || null;
    },
    
    addLevel() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        if (!comp.levels) comp.levels = [];
        comp.levels.push([]);
        this.renderProperties();
    },
    
    // 选择等级进行编辑
    selectLevel(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.levels) return;
        
        // 切换展开/收起
        const picker = this.state.elementPicker;
        if (picker?.type === 'level' && picker?.index === index) {
            // 已经在编辑这个等级，收起
            this.state.elementPicker = null;
            document.body.classList.remove('element-picker-active');
        } else {
            // 展开这个等级
            this.startLevelElementPicker(index);
        }
        this.renderProperties();
    },
    
    // 启动等级元素拾取模式
    startLevelElementPicker(levelIndex) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        this.state.elementPicker = {
            type: 'level',
            index: levelIndex
        };
        
        // 切换到元素标签页
        this.switchTab('elements');
        document.body.classList.add('element-picker-active');
        
        // 高亮当前等级的元素
        this.state.highlightElements.clear();
        const levelElements = comp.levels?.[levelIndex] || [];
        for (const el of levelElements) {
            this.state.highlightElements.add(el);
        }
        
        this.renderElementList();
        this.renderProperties();
        this.render();
        
        this.showToast(`选择等级 ${levelIndex} 的元素`, 'info');
    },
    
    // 填充等级元素拾取列表 - 已废弃，使用renderElementList统一处理
    fillLevelElementPicker(levelIndex) {
        // 现在由renderElementList统一处理
        this.renderElementList();
    },
    
    // 切换等级中的元素
    toggleLevelElement(levelIndex, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        if (!comp.levels) comp.levels = [];
        if (!comp.levels[levelIndex]) comp.levels[levelIndex] = [];
        
        const idx = comp.levels[levelIndex].indexOf(elemName);
        if (idx >= 0) {
            comp.levels[levelIndex].splice(idx, 1);
            this.state.highlightElements.delete(elemName);
            this.showToast(`移除: ${elemName}`, 'info');
        } else {
            comp.levels[levelIndex].push(elemName);
            this.state.highlightElements.add(elemName);
            this.showToast(`添加: ${elemName}`, 'success');
        }
        
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    // 从等级中移除元素
    removeElementFromLevel(levelIndex, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.levels || !comp.levels[levelIndex]) return;
        
        const idx = comp.levels[levelIndex].indexOf(elemName);
        if (idx >= 0) {
            comp.levels[levelIndex].splice(idx, 1);
            this.state.highlightElements.delete(elemName);
            this.renderProperties();
            this.render();
        }
    },
    
    // 删除等级
    deleteLevel(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.levels) return;
        
        if (!confirm(`删除等级 ${index}?`)) return;
        
        comp.levels.splice(index, 1);
        
        // 如果正在编辑这个等级，取消编辑
        if (this.state.elementPicker?.type === 'level' && this.state.elementPicker?.index === index) {
            this.state.elementPicker = null;
            document.body.classList.remove('element-picker-active');
        }
        
        this.renderProperties();
        this.showToast('已删除等级', 'info');
    },
    
    // 完成等级拾取
    finishLevelPicker() {
        this.state.elementPicker = null;
        document.body.classList.remove('element-picker-active');
        this.switchTab('components');
        this.renderProperties();
        this.showToast('等级编辑完成', 'success');
    },

    // ========== AnimatedIcon 操作 ==========
    addFrame() {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        if (!comp.frames) comp.frames = [];
        comp.frames.push([]);
        this.renderProperties();
    },
    
    // 选择帧进行编辑
    selectFrame(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.frames) return;
        
        // 切换展开/收起
        const picker = this.state.elementPicker;
        if (picker?.type === 'frame' && picker?.index === index) {
            // 已经在编辑这个帧，收起
            this.state.elementPicker = null;
            document.body.classList.remove('element-picker-active');
        } else {
            // 展开这个帧
            this.startFrameElementPicker(index);
        }
        this.renderProperties();
    },
    
    // 启动帧元素拾取模式
    startFrameElementPicker(frameIndex) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        
        this.state.elementPicker = {
            type: 'frame',
            index: frameIndex
        };
        
        // 切换到元素标签页
        this.switchTab('elements');
        document.body.classList.add('element-picker-active');
        
        // 高亮当前帧的元素
        this.state.highlightElements.clear();
        const frameElements = comp.frames?.[frameIndex] || [];
        for (const el of frameElements) {
            this.state.highlightElements.add(el);
        }
        
        this.renderElementList();
        this.renderProperties();
        this.render();
        
        this.showToast(`选择帧 ${frameIndex + 1} 的元素`, 'info');
    },
    
    // 切换帧中的元素
    toggleFrameElement(frameIndex, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        if (!comp.frames) comp.frames = [];
        if (!comp.frames[frameIndex]) comp.frames[frameIndex] = [];
        
        const idx = comp.frames[frameIndex].indexOf(elemName);
        if (idx >= 0) {
            comp.frames[frameIndex].splice(idx, 1);
            this.state.highlightElements.delete(elemName);
            this.showToast(`移除: ${elemName}`, 'info');
        } else {
            comp.frames[frameIndex].push(elemName);
            this.state.highlightElements.add(elemName);
            this.showToast(`添加: ${elemName}`, 'success');
        }
        
        this.renderElementList();
        this.renderProperties();
        this.render();
    },
    
    // 从帧中移除元素
    removeElementFromFrame(frameIndex, elemName) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.frames || !comp.frames[frameIndex]) return;
        
        const idx = comp.frames[frameIndex].indexOf(elemName);
        if (idx >= 0) {
            comp.frames[frameIndex].splice(idx, 1);
            this.state.highlightElements.delete(elemName);
            this.renderProperties();
            this.render();
        }
    },
    
    // 删除帧
    deleteFrame(index) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp || !comp.frames) return;
        
        if (!confirm(`删除帧 ${index + 1}?`)) return;
        
        comp.frames.splice(index, 1);
        
        // 如果正在编辑这个帧，取消编辑
        if (this.state.elementPicker?.type === 'frame' && this.state.elementPicker?.index === index) {
            this.state.elementPicker = null;
            document.body.classList.remove('element-picker-active');
        }
        
        this.renderProperties();
        this.showToast('已删除帧', 'info');
    },
    
    updateAnimConfig(key, value) {
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) return;
        comp[key] = value;
    },

    // ========== 测试显示 ==========
    onTestInput(e) {
        if (e.key === 'Enter') {
            this.testDisplay();
        }
    },
    
    testDisplay() {
        const input = document.getElementById('comp-test-value');
        const value = input?.value?.trim();
        if (!value) return;
        
        const comp = this.state.components[this.state.selectedComp];
        if (!comp) {
            this.showToast('请先选择组件', 'warning');
            return;
        }
        
        this.state.highlightElements.clear();
        
        if (comp.type === 'NumberDisplay') {
            this.testNumberDisplay(comp, value);
        } else if (comp.type === 'ModeSelector') {
            this.testModeSelector(comp, value);
        } else if (comp.type === 'LevelIndicator') {
            this.testLevelIndicator(comp, parseInt(value));
        }
        
        this.render();
    },
    
    testNumberDisplay(comp, value) {
        const config = comp.config || {};
        const digits = config.digits || [];
        
        // 解析数值
        let str = value;
        let isNegative = false;
        
        if (str.startsWith('-')) {
            isNegative = true;
            str = str.substring(1);
        }
        
        // 处理预设
        if (comp.presets?.[value]) {
            str = comp.presets[value];
        }
        
        // 找小数点位置
        const dotPos = str.indexOf('.');
        let intPart = dotPos >= 0 ? str.substring(0, dotPos) : str;
        let decPart = dotPos >= 0 ? str.substring(dotPos + 1) : '';
        
        // 组合成显示字符串
        let displayStr = intPart + decPart;
        
        // 右对齐填充
        while (displayStr.length < digits.length) {
            displayStr = ' ' + displayStr;
        }
        
        // 截取
        displayStr = displayStr.substring(displayStr.length - digits.length);
        
        // 高亮对应的数字元素
        for (let i = 0; i < digits.length && i < displayStr.length; i++) {
            const char = displayStr[i];
            if (char !== ' ' && digits[i]?.element) {
                this.state.highlightElements.add(digits[i].element);
            }
        }
        
        // 高亮小数点
        if (dotPos >= 0) {
            const dotIndex = digits.length - decPart.length - 1;
            const dot = (config.dots || []).find(d => d.afterDigit === dotIndex);
            if (dot?.element) {
                this.state.highlightElements.add(dot.element);
            }
        }
        
        // 高亮符号
        if (isNegative && config.sign?.element) {
            this.state.highlightElements.add(config.sign.element);
        }
    },
    
    testModeSelector(comp, modeName) {
        const elements = comp.modes?.[modeName] || [];
        for (const el of elements) {
            this.state.highlightElements.add(el);
        }
    },
    
    testLevelIndicator(comp, level) {
        // 外框
        if (comp.frame) {
            this.state.highlightElements.add(comp.frame);
        }
        // 等级元素
        for (let i = 0; i <= level && i < (comp.levels || []).length; i++) {
            for (const el of comp.levels[i]) {
                this.state.highlightElements.add(el);
            }
        }
    },

    // ========== 代码生成 ==========
    generateCode() {
        const comps = this.state.components;
        if (Object.keys(comps).length === 0) {
            this.showToast('没有组件可生成', 'warning');
            return;
        }
        
        let headerCode = this.generateHeaderCode(comps);
        let sourceCode = this.generateSourceCode(comps);
        
        // 显示代码
        this.showCodeDialog(headerCode, sourceCode);
    },
    
    generateHeaderCode(comps) {
        let code = `/**
 * LCD组件库 - 自动生成
 * 设备: ${DeviceConfigManager?.getCurrentDevice() || 'unknown'}
 * 生成时间: ${new Date().toLocaleString()}
 */

#ifndef __LCD_COMPONENTS_H
#define __LCD_COMPONENTS_H

#include <stdint.h>

`;
        
        for (const [name, comp] of Object.entries(comps)) {
            const funcName = name.toLowerCase();
            
            if (comp.type === 'NumberDisplay') {
                code += `/* ${name} - 数字显示 */\n`;
                code += `void lcd_${funcName}_show_number(float value);\n`;
                code += `void lcd_${funcName}_show_str(const char* str);\n`;
                code += `void lcd_${funcName}_clear(void);\n\n`;
            } else if (comp.type === 'ModeSelector') {
                const modes = Object.keys(comp.modes || {});
                code += `/* ${name} - 模式选择 */\n`;
                code += `typedef enum {\n`;
                for (const mode of modes) {
                    code += `    ${name.toUpperCase()}_${mode.toUpperCase()},\n`;
                }
                code += `} ${funcName}_mode_t;\n`;
                code += `void lcd_${funcName}_set_mode(${funcName}_mode_t mode);\n\n`;
            } else if (comp.type === 'LevelIndicator') {
                code += `/* ${name} - 等级指示 */\n`;
                code += `void lcd_${funcName}_set_level(uint8_t level);\n\n`;
            } else if (comp.type === 'BlinkIcon') {
                code += `/* ${name} - 闪烁图标 */\n`;
                code += `void lcd_${funcName}_on(void);\n`;
                code += `void lcd_${funcName}_off(void);\n`;
                code += `void lcd_${funcName}_blink(void);\n\n`;
            }
        }
        
        code += `#endif /* __LCD_COMPONENTS_H */\n`;
        return code;
    },
    
    generateSourceCode(comps) {
        let code = `/**
 * LCD组件库实现 - 自动生成
 */

#include "lcd_components.h"
#include "drv_seg_lcd.h"

/* 7段码字模 */
static const uint8_t DIGIT_FONT[128] = {
    ['0'] = 0x3F, ['1'] = 0x06, ['2'] = 0x5B, ['3'] = 0x4F, ['4'] = 0x66,
    ['5'] = 0x6D, ['6'] = 0x7D, ['7'] = 0x07, ['8'] = 0x7F, ['9'] = 0x6F,
    ['-'] = 0x40, [' '] = 0x00, ['N'] = 0x37, ['U'] = 0x3E, ['L'] = 0x38,
};

`;
        
        for (const [name, comp] of Object.entries(comps)) {
            const funcName = name.toLowerCase();
            
            if (comp.type === 'NumberDisplay') {
                code += this.generateNumberDisplayCode(name, comp);
            } else if (comp.type === 'ModeSelector') {
                code += this.generateModeSelectorCode(name, comp);
            }
        }
        
        return code;
    },
    
    generateNumberDisplayCode(name, comp) {
        const funcName = name.toLowerCase();
        const config = comp.config || {};
        const digits = config.digits || [];
        
        let code = `/* ${name} 数字显示实现 */\n`;
        code += `void lcd_${funcName}_show_number(float value) {\n`;
        code += `    char buf[16];\n`;
        code += `    int len = snprintf(buf, sizeof(buf), "%${digits.length}.${config.decimalPlaces || 3}f", value);\n`;
        code += `    lcd_${funcName}_show_str(buf);\n`;
        code += `}\n\n`;
        
        code += `void lcd_${funcName}_show_str(const char* str) {\n`;
        code += `    // TODO: 实现字符串显示\n`;
        code += `    // 根据配置的digit元素设置段码\n`;
        code += `}\n\n`;
        
        code += `void lcd_${funcName}_clear(void) {\n`;
        code += `    lcd_${funcName}_show_str("     ");\n`;
        code += `}\n\n`;
        
        return code;
    },
    
    generateModeSelectorCode(name, comp) {
        const funcName = name.toLowerCase();
        const modes = comp.modes || {};
        
        let code = `/* ${name} 模式选择实现 */\n`;
        code += `void lcd_${funcName}_set_mode(${funcName}_mode_t mode) {\n`;
        code += `    switch (mode) {\n`;
        
        for (const [modeName, elements] of Object.entries(modes)) {
            code += `        case ${name.toUpperCase()}_${modeName.toUpperCase()}:\n`;
            for (const el of elements) {
                code += `            // seg_lcd_set_element("${el}", 1);\n`;
            }
            code += `            break;\n`;
        }
        
        code += `    }\n`;
        code += `}\n\n`;
        
        return code;
    },
    
    showCodeDialog(headerCode, sourceCode) {
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:700px;max-height:80vh;">
                <div class="hsm-dialog-header">
                    <span>💻 生成的代码</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body" style="max-height:60vh;overflow:auto;">
                    <div style="margin-bottom:12px;">
                        <div style="font-weight:bold;margin-bottom:6px;">lcd_components.h</div>
                        <pre style="background:#0d1117;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;">${this.escapeHtml(headerCode)}</pre>
                    </div>
                    <div>
                        <div style="font-weight:bold;margin-bottom:6px;">lcd_components.c</div>
                        <pre style="background:#0d1117;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;">${this.escapeHtml(sourceCode)}</pre>
                    </div>
                </div>
                <div style="padding:12px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;">
                    <button class="comp-btn" onclick="CompEditor.copyCode('header')">复制 .h</button>
                    <button class="comp-btn" onclick="CompEditor.copyCode('source')">复制 .c</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this._generatedHeader = headerCode;
        this._generatedSource = sourceCode;
    },
    
    copyCode(type) {
        const code = type === 'header' ? this._generatedHeader : this._generatedSource;
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('已复制', 'success');
        });
    },
    
    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    // ========== 工具方法 ==========
    renameComponent(newName) {
        if (!newName || newName === this.state.selectedComp) return;
        if (this.state.components[newName]) {
            this.showToast('名称已存在', 'warning');
            return;
        }
        
        const comp = this.state.components[this.state.selectedComp];
        delete this.state.components[this.state.selectedComp];
        this.state.components[newName] = comp;
        this.state.selectedComp = newName;
        this.renderComponentList();
    },
    
    // ========== 行为列表渲染 ==========
    renderBehaviorList() {
        const container = document.getElementById('behavior-list');
        if (!container) return;
        
        const behaviors = Object.entries(this.state.behaviors);
        
        if (behaviors.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);padding:20px;font-size:11px;">
                    暂无行为<br>点击"新建"创建闪烁或动画
                </div>
            `;
            return;
        }
        
        container.innerHTML = behaviors.map(([name, beh]) => {
            const type = this.BEHAVIOR_TYPES[beh.type] || { icon: '❓', name: beh.type };
            const isSelected = this.state.selectedBehavior === name;
            const isAnim = beh.type === 'Animation';
            return `
                <div class="behavior-item ${isSelected ? 'selected' : ''}" 
                     onclick="CompEditor.selectBehavior('${name}')">
                    <span class="icon">${type.icon}</span>
                    <span class="name">${name}</span>
                    <span class="type-tag ${isAnim ? 'anim' : ''}">${type.name}</span>
                    <span class="enabled-dot ${beh.enabled ? 'on' : ''}" title="${beh.enabled ? '已启用' : '已禁用'}"></span>
                    <span class="delete" onclick="event.stopPropagation();CompEditor.deleteBehavior('${name}')">×</span>
                </div>
            `;
        }).join('');
    },
    
    selectBehavior(name) {
        this.state.selectedBehavior = name;
        this.state.selectedComp = null;
        this.renderBehaviorList();
        this.renderComponentList();
        this.renderProperties();
        this.updateHighlightFromBehavior();
        this.render();
    },
    
    updateHighlightFromBehavior() {
        this.state.highlightElements.clear();
        if (!this.state.selectedBehavior) return;
        
        const beh = this.state.behaviors[this.state.selectedBehavior];
        if (!beh) return;
        
        // 高亮目标元素
        const targets = beh.targets || [];
        for (const target of targets) {
            // 检查是组件还是元素
            if (this.state.components[target]) {
                // 是组件，获取其所有元素
                const compElements = this.getComponentElements(target);
                for (const el of compElements) {
                    this.state.highlightElements.add(el);
                }
            } else {
                // 是元素
                this.state.highlightElements.add(target);
            }
        }
        
        // Animation类型高亮所有帧的元素
        if (beh.type === 'Animation' && beh.frames) {
            for (const frame of beh.frames) {
                for (const el of frame.elements || []) {
                    this.state.highlightElements.add(el);
                }
            }
        }
    },
    
    getComponentElements(compName) {
        const comp = this.state.components[compName];
        if (!comp) return [];
        
        const elements = [];
        if (comp.type === 'NumberDisplay') {
            for (const d of comp.config?.digits || []) {
                if (d.element) elements.push(d.element);
            }
            for (const d of comp.config?.dots || []) {
                if (d.element) elements.push(d.element);
            }
            if (comp.config?.sign?.element) elements.push(comp.config.sign.element);
        } else if (comp.type === 'ModeSelector') {
            for (const mode of Object.values(comp.modes || {})) {
                elements.push(...mode);
            }
        } else if (comp.type === 'LevelIndicator') {
            if (comp.frame) elements.push(comp.frame);
            for (const level of comp.levels || []) {
                elements.push(...level);
            }
        } else if (comp.type === 'Icon') {
            elements.push(...(comp.elements || []));
        }
        return [...new Set(elements)];
    },
    
    deleteBehavior(name) {
        if (!confirm(`删除行为 "${name}"?`)) return;
        delete this.state.behaviors[name];
        if (this.state.selectedBehavior === name) {
            this.state.selectedBehavior = null;
        }
        this.renderBehaviorList();
        this.renderProperties();
        this.showToast('已删除', 'info');
    },
    
    // ========== 硬件回调列表 ==========
    renderHardwareList() {
        const container = document.getElementById('hardware-list');
        if (!container) return;
        
        const callbacks = this.state.hardwareCallbacks || [];
        
        if (callbacks.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);padding:20px;font-size:11px;">
                    暂无硬件回调<br>点击"新建"添加
                </div>
            `;
            return;
        }
        
        container.innerHTML = callbacks.map((cb, i) => `
            <div class="behavior-item" style="cursor:default;">
                <span class="icon">🔌</span>
                <span class="name" style="font-family:monospace;">${cb.name}</span>
                <span style="flex:1;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;">${cb.description || ''}</span>
                <span class="delete" onclick="CompEditor.deleteHardwareCallback(${i})">×</span>
            </div>
        `).join('');
    },
    
    addHardwareCallback() {
        const name = prompt('硬件回调名称 (如: laser_on, beep)');
        if (!name) return;
        
        // 检查重复
        if (this.state.hardwareCallbacks.some(cb => cb.name === name)) {
            this.showToast('名称已存在', 'warning');
            return;
        }
        
        const description = prompt('描述 (可选)') || '';
        
        this.state.hardwareCallbacks.push({ name, description });
        this.renderHardwareList();
        this.showToast(`已添加: ${name}`, 'success');
    },
    
    deleteHardwareCallback(index) {
        const cb = this.state.hardwareCallbacks[index];
        if (!confirm(`删除硬件回调 "${cb.name}"?`)) return;
        
        this.state.hardwareCallbacks.splice(index, 1);
        this.renderHardwareList();
        this.showToast('已删除', 'info');
    },
    
    // 获取硬件回调选项列表
    getHardwareCallbackOptions() {
        return this.state.hardwareCallbacks || [];
    },

    showAddBehaviorDialog() {
        if (document.querySelector('.hsm-dialog-overlay')) return;
        
        const types = Object.entries(this.BEHAVIOR_TYPES);
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:360px;">
                <div class="hsm-dialog-header">
                    <span>新建行为</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div class="comp-form-group">
                        <label>行为名称</label>
                        <input type="text" class="comp-input" id="new-behavior-name" placeholder="如 laserBlink, chargingAnim">
                    </div>
                    <div class="comp-form-group">
                        <label>行为类型</label>
                        <div style="display:grid;gap:6px;">
                            ${types.map(([key, t]) => `
                                <label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-primary);border-radius:4px;cursor:pointer;">
                                    <input type="radio" name="behavior-type" value="${key}" ${key === 'Blink' ? 'checked' : ''}>
                                    <span style="font-size:16px;">${t.icon}</span>
                                    <span>
                                        <div style="font-size:12px;">${t.name}</div>
                                        <div style="font-size:10px;color:var(--text-muted);">${t.desc}</div>
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:12px;">
                        <button class="comp-btn" style="flex:1;" onclick="this.closest('.hsm-dialog-overlay').remove()">取消</button>
                        <button class="comp-btn primary" style="flex:1;" onclick="CompEditor.createBehavior()">创建</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        document.getElementById('new-behavior-name').focus();
    },
    
    createBehavior() {
        const nameInput = document.getElementById('new-behavior-name');
        const typeInput = document.querySelector('input[name="behavior-type"]:checked');
        
        const name = nameInput?.value?.trim();
        const type = typeInput?.value;
        
        if (!name) {
            this.showToast('请输入行为名称', 'warning');
            return;
        }
        if (this.state.behaviors[name]) {
            this.showToast('行为已存在', 'warning');
            return;
        }
        
        // 创建默认行为配置
        if (type === 'Blink') {
            this.state.behaviors[name] = {
                type: 'Blink',
                targets: [],
                interval: 500,
                enabled: false,
                description: ''
            };
        } else if (type === 'Animation') {
            this.state.behaviors[name] = {
                type: 'Animation',
                target: null,
                frames: [],
                loop: true,
                enabled: false,
                description: ''
            };
        }
        
        document.querySelector('.hsm-dialog-overlay')?.remove();
        this.selectBehavior(name);
        this.renderBehaviorList();
        this.showToast(`已创建: ${name}`, 'success');
    },
    
    // ========== 规则列表渲染 ==========
    renderRuleList() {
        const container = document.getElementById('rule-list');
        if (!container) return;
        
        const rules = Object.entries(this.state.rules);
        
        if (rules.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);padding:20px;font-size:11px;">
                    暂无规则<br>点击"新建"创建事件规则
                </div>
            `;
            return;
        }
        
        container.innerHTML = rules.map(([name, rule]) => {
            const isSelected = this.state.selectedRule === name;
            const triggerType = this.TRIGGER_TYPES[rule.trigger?.type] || { name: '未知' };
            return `
                <div class="rule-item ${isSelected ? 'selected' : ''}" 
                     onclick="CompEditor.selectRule('${name}')">
                    <div class="rule-header">
                        <span class="rule-name">⚡ ${name}</span>
                        <span class="trigger-tag">${triggerType.name}</span>
                        <span class="delete" onclick="event.stopPropagation();CompEditor.deleteRule('${name}')">×</span>
                    </div>
                    ${rule.description ? `<div class="rule-desc">${rule.description}</div>` : ''}
                </div>
            `;
        }).join('');
    },
    
    selectRule(name) {
        this.state.selectedRule = name;
        this.state.selectedComp = null;
        this.state.selectedBehavior = null;
        this.renderRuleList();
        this.renderProperties();
    },
    
    deleteRule(name) {
        if (!confirm(`删除规则 "${name}"?`)) return;
        delete this.state.rules[name];
        if (this.state.selectedRule === name) {
            this.state.selectedRule = null;
        }
        this.renderRuleList();
        this.renderProperties();
        this.showToast('已删除', 'info');
    },
    
    showAddRuleDialog() {
        if (document.querySelector('.hsm-dialog-overlay')) return;
        
        const triggers = Object.entries(this.TRIGGER_TYPES);
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:360px;">
                <div class="hsm-dialog-header">
                    <span>新建规则</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div class="comp-form-group">
                        <label>规则名称</label>
                        <input type="text" class="comp-input" id="new-rule-name" placeholder="如 onLowBattery, laserTimeout">
                    </div>
                    <div class="comp-form-group">
                        <label>触发器类型</label>
                        <div style="display:grid;gap:6px;">
                            ${triggers.map(([key, t]) => `
                                <label style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-primary);border-radius:4px;cursor:pointer;">
                                    <input type="radio" name="trigger-type" value="${key}" ${key === 'event' ? 'checked' : ''}>
                                    <span>
                                        <div style="font-size:12px;">${t.name}</div>
                                        <div style="font-size:10px;color:var(--text-muted);">${t.desc}</div>
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:12px;">
                        <button class="comp-btn" style="flex:1;" onclick="this.closest('.hsm-dialog-overlay').remove()">取消</button>
                        <button class="comp-btn primary" style="flex:1;" onclick="CompEditor.createRule()">创建</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        document.getElementById('new-rule-name').focus();
    },
    
    createRule() {
        const nameInput = document.getElementById('new-rule-name');
        const typeInput = document.querySelector('input[name="trigger-type"]:checked');
        
        const name = nameInput?.value?.trim();
        const triggerType = typeInput?.value;
        
        if (!name) {
            this.showToast('请输入规则名称', 'warning');
            return;
        }
        if (this.state.rules[name]) {
            this.showToast('规则已存在', 'warning');
            return;
        }
        
        // 创建默认规则配置
        const trigger = { type: triggerType };
        if (triggerType === 'timeout') {
            trigger.behavior = '';
            trigger.duration = 5000;
        } else if (triggerType === 'componentChange') {
            trigger.target = '';
            trigger.condition = '';
        } else if (triggerType === 'event') {
            trigger.name = '';
        }
        
        this.state.rules[name] = {
            description: '',
            trigger,
            actions: []
        };
        
        document.querySelector('.hsm-dialog-overlay')?.remove();
        this.selectRule(name);
        this.renderRuleList();
        this.showToast(`已创建: ${name}`, 'success');
    },
    
    // ========== 行为操作方法 ==========
    updateBehavior(name, key, value) {
        if (!this.state.behaviors[name]) return;
        this.state.behaviors[name][key] = value;
        if (key === 'enabled') {
            this.renderBehaviorList();
        }
    },
    
    renameBehavior(oldName, newName) {
        newName = newName.trim();
        if (!newName || newName === oldName) return;
        if (this.state.behaviors[newName]) {
            this.showToast('名称已存在', 'warning');
            return;
        }
        this.state.behaviors[newName] = this.state.behaviors[oldName];
        delete this.state.behaviors[oldName];
        this.state.selectedBehavior = newName;
        this.renderBehaviorList();
        this.renderProperties();
    },
    
    addBlinkTarget(behaviorName) {
        const select = document.getElementById('blink-target-select');
        const target = select?.value;
        if (!target) return;
        
        const beh = this.state.behaviors[behaviorName];
        if (!beh) return;
        if (!beh.targets) beh.targets = [];
        if (!beh.targets.includes(target)) {
            beh.targets.push(target);
            this.renderProperties();
            this.updateHighlightFromBehavior();
            this.render();
        }
    },
    
    removeBlinkTarget(behaviorName, target) {
        const beh = this.state.behaviors[behaviorName];
        if (!beh || !beh.targets) return;
        const idx = beh.targets.indexOf(target);
        if (idx >= 0) {
            beh.targets.splice(idx, 1);
            this.renderProperties();
            this.updateHighlightFromBehavior();
            this.render();
        }
    },
    
    addAnimFrame(behaviorName) {
        const beh = this.state.behaviors[behaviorName];
        if (!beh) return;
        if (!beh.frames) beh.frames = [];
        beh.frames.push({ elements: [], duration: 500 });
        this.renderProperties();
    },
    
    removeAnimFrame(behaviorName, index) {
        const beh = this.state.behaviors[behaviorName];
        if (!beh || !beh.frames) return;
        beh.frames.splice(index, 1);
        this.renderProperties();
    },
    
    // ========== 规则操作方法 ==========
    updateRule(name, key, value) {
        if (!this.state.rules[name]) return;
        this.state.rules[name][key] = value;
    },
    
    renameRule(oldName, newName) {
        newName = newName.trim();
        if (!newName || newName === oldName) return;
        if (this.state.rules[newName]) {
            this.showToast('名称已存在', 'warning');
            return;
        }
        this.state.rules[newName] = this.state.rules[oldName];
        delete this.state.rules[oldName];
        this.state.selectedRule = newName;
        this.renderRuleList();
        this.renderProperties();
    },
    
    updateTrigger(ruleName, key, value) {
        const rule = this.state.rules[ruleName];
        if (!rule || !rule.trigger) return;
        rule.trigger[key] = value;
    },
    
    removeRuleAction(ruleName, index) {
        const rule = this.state.rules[ruleName];
        if (!rule || !rule.actions) return;
        rule.actions.splice(index, 1);
        this.renderProperties();
    },
    
    showAddActionDialog(ruleName) {
        if (document.querySelector('.hsm-dialog-overlay')) return;
        
        const actionTypes = Object.entries(this.ACTION_TYPES);
        const behaviorOptions = Object.keys(this.state.behaviors).map(b => 
            `<option value="${b}">${b}</option>`
        ).join('');
        
        const dialog = document.createElement('div');
        dialog.className = 'hsm-dialog-overlay';
        dialog.innerHTML = `
            <div class="hsm-dialog" style="width:360px;">
                <div class="hsm-dialog-header">
                    <span>添加动作</span>
                    <button class="hsm-dialog-close" onclick="this.closest('.hsm-dialog-overlay').remove()">×</button>
                </div>
                <div class="hsm-dialog-body">
                    <div class="comp-form-group">
                        <label>动作类型</label>
                        <select class="comp-select" id="action-type-select" onchange="CompEditor.onActionTypeChange()">
                            ${actionTypes.map(([key, t]) => `<option value="${key}">${t.name}</option>`).join('')}
                        </select>
                    </div>
                    <div class="comp-form-group" id="action-target-group">
                        <label>目标行为</label>
                        <select class="comp-select" id="action-target-select">
                            <option value="">选择...</option>
                            ${behaviorOptions}
                        </select>
                    </div>
                    <div class="comp-form-group" id="action-event-group" style="display:none;">
                        <label>事件名</label>
                        <input type="text" class="comp-input" id="action-event-input" placeholder="事件名称">
                    </div>
                    <div style="display:flex;gap:8px;margin-top:12px;">
                        <button class="comp-btn" style="flex:1;" onclick="this.closest('.hsm-dialog-overlay').remove()">取消</button>
                        <button class="comp-btn primary" style="flex:1;" onclick="CompEditor.addRuleAction('${ruleName}')">添加</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
    },
    
    onActionTypeChange() {
        const type = document.getElementById('action-type-select')?.value;
        const targetGroup = document.getElementById('action-target-group');
        const eventGroup = document.getElementById('action-event-group');
        
        if (type === 'emit') {
            targetGroup.style.display = 'none';
            eventGroup.style.display = 'block';
        } else {
            targetGroup.style.display = 'block';
            eventGroup.style.display = 'none';
        }
    },
    
    addRuleAction(ruleName) {
        const rule = this.state.rules[ruleName];
        if (!rule) return;
        
        const type = document.getElementById('action-type-select')?.value;
        const target = document.getElementById('action-target-select')?.value;
        const event = document.getElementById('action-event-input')?.value;
        
        if (!rule.actions) rule.actions = [];
        
        if (type === 'emit') {
            if (!event) {
                this.showToast('请输入事件名', 'warning');
                return;
            }
            rule.actions.push({ type, event });
        } else {
            if (!target) {
                this.showToast('请选择目标', 'warning');
                return;
            }
            rule.actions.push({ type, target });
        }
        
        document.querySelector('.hsm-dialog-overlay')?.remove();
        this.renderProperties();
        this.showToast('已添加动作', 'success');
    },

    showToast(msg, type = 'info') {
        const colors = { info: '#3b82f6', success: '#22c55e', warning: '#f59e0b', error: '#ef4444' };
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            padding: 10px 20px; border-radius: 6px; color: white; z-index: 10000;
            background: ${colors[type]}; font-size: 13px;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    },
};

// 挂载到window
window.CompEditor = CompEditor;

// 页面独立运行时自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // 检查是否在app框架内，如果不是则自动初始化
        if (!window.App) {
            CompEditor.init();
        }
    });
} else if (!window.App) {
    CompEditor.init();
}
