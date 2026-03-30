/**
 * 测试脚本编辑器 - 双视图模式
 * 支持可视化编辑和代码编辑无缝切换
 * 支持LCD期望可视化选择
 */

const TestScriptEditor = {
    // 当前视图模式
    currentView: 'visual', // 'visual' | 'code'
    
    // 当前测试套件（统一数据模型）
    suite: null,
    
    // 当前选中的节点路径
    selectedPath: null,
    
    // 当前编辑的用例数据
    currentCase: null,
    
    // LCD配置缓存
    lcdConfig: null,
    lcdImage: null,
    
    // LCD预设（用户自定义，保存到localStorage）
    lcdPresets: [],
    
    // 当前正在编辑LCD期望的步骤索引
    editingLcdStepIndex: null,
    
    // 右侧画布当前选中的元素
    presetSelectedElements: new Set(),
    
    // 初始状态字段定义（全面覆盖）
    initialFields: [
        { key: 'laser', name: '激光', type: 'select', options: ['OFF', 'ON'], default: 'OFF' },
        { key: 'mode', name: '模式', type: 'select', options: ['SINGLE', 'AREA', 'VOLUME', 'PYTH1', 'PYTH2', 'PYTH3', 'CONTINUOUS'], default: 'SINGLE' },
        { key: 'unit', name: '单位', type: 'select', options: ['m', 'ft', 'in'], default: 'm' },
        { key: 'base', name: '基准', type: 'select', options: ['BACK', 'FRONT'], default: 'BACK' },
        { key: 'runstep', name: '步骤', type: 'number', default: 0 },
        { key: 'line4', name: '第4行', type: 'text', default: '-----' },
        { key: 'line3', name: '第3行', type: 'text', default: '-----' },
        { key: 'line2', name: '第2行', type: 'text', default: '-----' },
        { key: 'line1', name: '第1行', type: 'text', default: '-----' },
        { key: 'state', name: '状态', type: 'select', options: ['IDLE', 'MEASURING', 'RESULT', 'ERROR'], default: 'IDLE' },
        { key: 'backlight', name: '背光', type: 'select', options: ['OFF', 'ON'], default: 'ON' },
        { key: 'beep', name: '蜂鸣', type: 'select', options: ['OFF', 'ON'], default: 'ON' },
    ],
    
    // 动作定义
    actions: {},
    
    // 期望定义
    expects: {},

    async init() {
        console.log('[TestScriptEditor] init');
        
        // 初始化设备配置管理器
        await this.initDeviceManager();
        
        // 加载定义
        this.loadDefinitions();
        
        // 加载LCD配置
        await this.loadLcdConfig();
        
        // 加载LCD预设
        this.loadLcdPresets();
        
        // 渲染参考列表
        this.renderReference();
        
        // 初始化LCD预设画布
        this.initPresetCanvas();
        
        // 渲染预设列表
        this.renderPresetList();
        
        // 绑定事件
        this.bindEvents();
        
        // 加载套件
        await this.loadSuite();
        
        // 渲染树
        this.renderTree();
    },
    
    // 加载LCD配置
    async loadLcdConfig() {
        if (typeof DeviceConfigManager === 'undefined') return;
        
        const currentDevice = DeviceConfigManager.getCurrentDevice();
        if (!currentDevice) {
            console.warn('[TestScriptEditor] 未选择设备，跳过LCD配置加载');
            return;
        }
        
        try {
            const lcdProject = await DeviceConfigManager.loadLcdProject(currentDevice);
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
                
                // 调试：检查元素和像素数据
                let totalPixels = 0;
                for (const elem of this.lcdConfig.elements) {
                    for (const seg of elem.segments) {
                        totalPixels += seg.pixelMask.size;
                    }
                }
                console.log('[TestScriptEditor] loadLcdConfig - 元素数:', this.lcdConfig.elements.length, '总像素:', totalPixels);
                
                // 加载背景图
                if (lcdProject.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.lcdImage = img;
                        console.log('[TestScriptEditor] LCD背景图加载成功:', img.naturalWidth, 'x', img.naturalHeight);
                        this.renderPresetCanvas();
                    };
                    img.onerror = (err) => {
                        console.error('[TestScriptEditor] LCD背景图加载失败:', err);
                        this.renderPresetCanvas();  // 即使图片失败也渲染
                    };
                    img.src = lcdProject.image;
                } else {
                    console.warn('[TestScriptEditor] LCD配置中没有背景图');
                    this.renderPresetCanvas();  // 没有图片也渲染元素
                }
                
                console.log('[TestScriptEditor] LCD配置加载成功:', this.lcdConfig.elements.length, '个元素');
            } else {
                console.warn('[TestScriptEditor] LCD配置为空或无元素');
                this.lcdConfig = null;
            }
        } catch (err) {
            console.warn('[TestScriptEditor] 加载LCD配置失败:', err);
            this.lcdConfig = null;
        }
    },
    
    // 加载LCD预设
    loadLcdPresets() {
        try {
            const saved = localStorage.getItem('tse_lcd_presets');
            if (saved) {
                this.lcdPresets = JSON.parse(saved);
            }
        } catch (e) {
            this.lcdPresets = [];
        }
    },
    
    // 保存LCD预设
    saveLcdPresets() {
        localStorage.setItem('tse_lcd_presets', JSON.stringify(this.lcdPresets));
    },
    
    // 初始化预设画布
    initPresetCanvas() {
        const canvas = document.getElementById('lcd-preset-canvas');
        if (!canvas) return;
        
        canvas.addEventListener('click', (e) => this.onPresetCanvasClick(e));
        this.renderPresetCanvas();
    },
    
    // 预设画布点击
    onPresetCanvasClick(e) {
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        const canvas = document.getElementById('lcd-preset-canvas');
        const rect = canvas.getBoundingClientRect();
        
        // 计算缩放
        const imgW = this.lcdConfig.imageWidth || 400;
        const imgH = this.lcdConfig.imageHeight || 200;
        const scale = Math.min(canvas.width / imgW, canvas.height / imgH);
        const offsetX = (canvas.width - imgW * scale) / 2;
        const offsetY = (canvas.height - imgH * scale) / 2;
        
        // 转换坐标
        const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
        const x = Math.floor((canvasX - offsetX) / scale);
        const y = Math.floor((canvasY - offsetY) / scale);
        
        // 查找点击的元素
        for (const elem of this.lcdConfig.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                if (seg.pixelMask.has(`${x},${y}`)) {
                    // 切换选中状态
                    if (this.presetSelectedElements.has(elem.name)) {
                        this.presetSelectedElements.delete(elem.name);
                    } else {
                        this.presetSelectedElements.add(elem.name);
                    }
                    this.renderPresetCanvas();
                    
                    // 如果正在编辑某个步骤的LCD期望，同步更新
                    if (this.editingLcdStepIndex !== null) {
                        this.syncLcdExpectToStep();
                    }
                    return;
                }
            }
        }
    },
    
    // 渲染预设画布
    renderPresetCanvas() {
        const canvas = document.getElementById('lcd-preset-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        // 清空
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
        
        if (!this.lcdConfig || !this.lcdConfig.elements || this.lcdConfig.elements.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('未加载LCD配置', w / 2, h / 2);
            ctx.font = '10px Arial';
            ctx.fillText('请先在段码编辑器中配置', w / 2, h / 2 + 16);
            return;
        }
        
        // 计算缩放 - 确保元素可见
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
        
        // 绘制元素 - 确保每个像素至少1px
        const pixelSize = Math.max(1, scale);
        for (const elem of this.lcdConfig.elements) {
            const isSelected = this.presetSelectedElements.has(elem.name);
            
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                ctx.fillStyle = isSelected ? '#00ff88' : 'rgba(42, 58, 42, 0.6)';
                
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
        
        // 显示选中数量
        if (this.presetSelectedElements.size > 0) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(w - 60, 5, 55, 20);
            ctx.fillStyle = '#00ff88';
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(`${this.presetSelectedElements.size} 选中`, w - 8, 18);
        }
        
        // 编辑模式提示
        if (this.editingLcdStepIndex !== null) {
            ctx.fillStyle = 'rgba(0, 150, 255, 0.8)';
            ctx.fillRect(0, 0, w, 18);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`编辑步骤 ${this.editingLcdStepIndex + 1} 的LCD期望 - 点击元素切换`, w / 2, 12);
        }
    },
    
    // 渲染预设列表
    renderPresetList() {
        const container = document.getElementById('lcd-preset-list');
        if (!container) return;
        
        if (this.lcdPresets.length === 0) {
            container.innerHTML = `
                <div style="color:var(--text-muted);font-size:11px;padding:8px;text-align:center;">
                    点击画布选择元素<br>
                    然后点击💾保存为预设
                </div>`;
            return;
        }
        
        container.innerHTML = this.lcdPresets.map((preset, i) => `
            <div class="lcd-preset-item" onclick="TestScriptEditor.applyPreset(${i})">
                <span class="preset-name">${preset.name}</span>
                <span class="preset-count">${preset.elements.length}个</span>
                <div class="preset-actions">
                    <button onclick="event.stopPropagation();TestScriptEditor.renamePreset(${i})" title="重命名">✏️</button>
                    <button onclick="event.stopPropagation();TestScriptEditor.deletePreset(${i})" title="删除">🗑️</button>
                </div>
            </div>
        `).join('');
    },
    
    // 保存当前选中为预设
    saveCurrentAsPreset() {
        if (this.presetSelectedElements.size === 0) {
            Utils.toast('请先在画布上选择元素', 'warning');
            return;
        }
        
        const name = prompt('输入预设名称:', `预设${this.lcdPresets.length + 1}`);
        if (!name) return;
        
        this.lcdPresets.push({
            name: name,
            elements: Array.from(this.presetSelectedElements)
        });
        
        this.saveLcdPresets();
        this.renderPresetList();
        Utils.toast(`已保存预设: ${name}`, 'success');
    },
    
    // 应用预设
    applyPreset(index) {
        const preset = this.lcdPresets[index];
        if (!preset) return;
        
        this.presetSelectedElements = new Set(preset.elements);
        this.renderPresetCanvas();
        
        // 如果正在编辑步骤，同步
        if (this.editingLcdStepIndex !== null) {
            this.syncLcdExpectToStep();
        }
    },
    
    // 重命名预设
    renamePreset(index) {
        const preset = this.lcdPresets[index];
        if (!preset) return;
        
        const name = prompt('输入新名称:', preset.name);
        if (!name) return;
        
        preset.name = name;
        this.saveLcdPresets();
        this.renderPresetList();
    },
    
    // 删除预设
    deletePreset(index) {
        this.lcdPresets.splice(index, 1);
        this.saveLcdPresets();
        this.renderPresetList();
    },
    
    // 开始编辑步骤的LCD期望
    startEditLcdExpect(stepIndex) {
        if (!this.lcdConfig || !this.lcdConfig.elements) {
            Utils.toast('未加载LCD配置', 'warning');
            return;
        }
        
        this.editingLcdStepIndex = stepIndex;
        
        // 加载当前步骤的LCD期望到画布
        const lcdExpect = this.currentCase?.steps?.[stepIndex]?.expect?.lcd || [];
        this.presetSelectedElements = new Set(lcdExpect);
        
        // 直接打开大画布弹窗
        this.openLcdPicker();
        
        this.renderPresetCanvas();
        this.renderVisualEditor();
    },
    
    // 完成编辑LCD期望
    finishEditLcdExpect() {
        this.syncLcdExpectToStep();
        this.editingLcdStepIndex = null;
        this.presetSelectedElements.clear();
        this.renderPresetCanvas();
        this.renderVisualEditor();
    },
    
    // 同步LCD期望到步骤
    syncLcdExpectToStep() {
        if (this.editingLcdStepIndex === null) return;
        if (!this.currentCase?.steps?.[this.editingLcdStepIndex]) return;
        
        const step = this.currentCase.steps[this.editingLcdStepIndex];
        if (!step.expect) step.expect = {};
        
        if (this.presetSelectedElements.size > 0) {
            step.expect.lcd = Array.from(this.presetSelectedElements);
        } else {
            delete step.expect.lcd;
        }
        
        this.updatePreview();
        
        // 更新步骤卡片显示
        const stepCard = document.querySelector(`.step-card[data-index="${this.editingLcdStepIndex}"]`);
        if (stepCard) {
            const lcdSection = stepCard.querySelector('.step-lcd-expect');
            if (lcdSection) {
                lcdSection.innerHTML = this.renderStepLcdExpect(this.editingLcdStepIndex);
            }
        }
    },
    
    // 清除步骤的LCD期望
    clearStepLcdExpect(stepIndex) {
        if (!this.currentCase?.steps?.[stepIndex]) return;
        
        const step = this.currentCase.steps[stepIndex];
        if (step.expect) {
            delete step.expect.lcd;
        }
        
        // 如果正在编辑这个步骤，清空画布选中
        if (this.editingLcdStepIndex === stepIndex) {
            this.presetSelectedElements.clear();
            this.renderPresetCanvas();
        }
        
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // ========== LCD选择器弹窗 ==========
    
    // 弹窗状态
    pickerShowLabels: false,  // 默认不显示标签
    
    // 打开LCD选择器弹窗
    async openLcdPicker() {
        if (!this.lcdConfig || !this.lcdConfig.elements) {
            Utils.toast('未加载LCD配置', 'warning');
            return;
        }
        
        // 加载界面预设
        await this.loadScreenPresets();
        this.updateScreenPresetSelect();
        
        const modal = document.getElementById('lcd-picker-modal');
        if (modal) {
            modal.classList.add('show');
            this.initPickerCanvas();
            this.renderPickerCanvas();
            // 绑定键盘事件
            this._pickerKeyHandler = (e) => this.onPickerKeydown(e);
            document.addEventListener('keydown', this._pickerKeyHandler);
        }
    },
    
    // 关闭LCD选择器弹窗
    closeLcdPicker() {
        const modal = document.getElementById('lcd-picker-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        // 移除键盘事件
        if (this._pickerKeyHandler) {
            document.removeEventListener('keydown', this._pickerKeyHandler);
            this._pickerKeyHandler = null;
        }
    },
    
    // 弹窗键盘事件
    onPickerKeydown(e) {
        if (e.key === 'h' || e.key === 'H') {
            this.pickerShowLabels = !this.pickerShowLabels;
            this.renderPickerCanvas();
        } else if (e.key === 'Escape') {
            this.closeLcdPicker();
        }
    },
    
    // 初始化弹窗画布
    initPickerCanvas() {
        const canvas = document.getElementById('lcd-picker-canvas');
        if (!canvas) return;
        
        // 移除旧的事件监听器，重新绑定
        if (canvas._bindClick) {
            canvas.removeEventListener('click', canvas._clickHandler);
        }
        
        canvas._clickHandler = (e) => this.onPickerCanvasClick(e);
        canvas.addEventListener('click', canvas._clickHandler);
        canvas._bindClick = true;
    },
    
    // 弹窗画布点击
    onPickerCanvasClick(e) {
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        const canvas = document.getElementById('lcd-picker-canvas');
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        
        // 计算缩放
        const imgW = this.lcdConfig.imageWidth || 400;
        const imgH = this.lcdConfig.imageHeight || 200;
        const scale = Math.min(canvas.width / imgW, canvas.height / imgH) * 0.95;
        const offsetX = (canvas.width - imgW * scale) / 2;
        const offsetY = (canvas.height - imgH * scale) / 2;
        
        // 转换坐标 - 考虑canvas的CSS缩放
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;
        const x = Math.floor((canvasX - offsetX) / scale);
        const y = Math.floor((canvasY - offsetY) / scale);
        
        console.log('[LcdPicker] 点击坐标:', x, y);
        
        // 查找点击的元素
        for (const elem of this.lcdConfig.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                if (seg.pixelMask.has(`${x},${y}`)) {
                    // 切换选中状态
                    if (this.presetSelectedElements.has(elem.name)) {
                        this.presetSelectedElements.delete(elem.name);
                        console.log('[LcdPicker] 取消选中:', elem.name);
                    } else {
                        this.presetSelectedElements.add(elem.name);
                        console.log('[LcdPicker] 选中:', elem.name);
                    }
                    this.renderPickerCanvas();
                    this.renderPresetCanvas();
                    return;
                }
            }
        }
        console.log('[LcdPicker] 未找到元素');
    },
    
    // 渲染弹窗画布
    renderPickerCanvas() {
        const canvas = document.getElementById('lcd-picker-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        
        // 清空
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
        
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        // 计算缩放
        const imgW = this.lcdConfig.imageWidth || 400;
        const imgH = this.lcdConfig.imageHeight || 200;
        const scale = Math.min(w / imgW, h / imgH) * 0.95;
        const offsetX = (w - imgW * scale) / 2;
        const offsetY = (h - imgH * scale) / 2;
        
        // 绘制背景图
        if (this.lcdImage) {
            ctx.globalAlpha = 0.4;
            ctx.drawImage(this.lcdImage, offsetX, offsetY, imgW * scale, imgH * scale);
            ctx.globalAlpha = 1;
        }
        
        // 绘制元素
        const pixelSize = Math.max(1, scale);
        for (const elem of this.lcdConfig.elements) {
            const isSelected = this.presetSelectedElements.has(elem.name);
            
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                ctx.fillStyle = isSelected ? '#00ff88' : 'rgba(60, 80, 60, 0.7)';
                
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
        
        // 只有开启标签时才绘制
        if (this.pickerShowLabels) {
            for (const elem of this.lcdConfig.elements) {
                if (elem.segments.length > 0) {
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
                        const isSelected = this.presetSelectedElements.has(elem.name);
                        
                        ctx.font = 'bold 9px Arial';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        const label = elem.name;
                        const metrics = ctx.measureText(label);
                        
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                        ctx.fillRect(cx - metrics.width/2 - 2, cy - 6, metrics.width + 4, 12);
                        
                        ctx.fillStyle = isSelected ? '#00ff88' : '#aaa';
                        ctx.fillText(label, cx, cy);
                    }
                }
            }
        }
        
        // 更新选中数量和提示
        const countEl = document.getElementById('lcd-picker-count');
        if (countEl) {
            countEl.textContent = `已选: ${this.presetSelectedElements.size} 个`;
        }
    },
    
    // 清空弹窗选择
    clearPickerSelection() {
        this.presetSelectedElements.clear();
        this.renderPickerCanvas();
        this.renderPresetCanvas();
    },
    
    // 确认弹窗选择
    confirmLcdPicker() {
        // 如果正在编辑某个步骤，同步到步骤
        if (this.editingLcdStepIndex !== null) {
            this.syncLcdExpectToStep();
        }
        this.closeLcdPicker();
        this.renderPresetCanvas();
    },
    
    // 选择预设组
    selectPresetGroup(group) {
        if (!this.lcdConfig || !this.lcdConfig.elements) return;
        
        // 根据组名匹配元素
        const patterns = {
            'line4': /^Line4_/i,
            'line3': /^Line3_/i,
            'line2': /^Line2_/i,
            'line1': /^Line1_/i,
            'allDigits': /^Line\d_D\d/i,
            'icons': /^(Battery|WiFi|Signal|Beep|Base|Mode|MAX|MIN)/i,
            'units': /Unit/i,
            'dp': /DP/i,
        };
        
        const pattern = patterns[group];
        if (!pattern) return;
        
        // 切换：如果该组全部已选中则取消，否则全选
        const matchedElements = this.lcdConfig.elements.filter(e => pattern.test(e.name));
        const allSelected = matchedElements.every(e => this.presetSelectedElements.has(e.name));
        
        if (allSelected) {
            // 取消选中
            matchedElements.forEach(e => this.presetSelectedElements.delete(e.name));
        } else {
            // 全选
            matchedElements.forEach(e => this.presetSelectedElements.add(e.name));
        }
        
        this.renderPickerCanvas();
        this.renderPresetCanvas();
    },
    
    // 同步固件LCD状态
    async syncFromFirmware() {
        try {
            // 调用后端读取LCD缓冲区
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_dump', params: [] })
            });
            const result = await response.json();
            
            if (!result.success || !result.buffer) {
                Utils.toast('读取固件LCD失败: ' + (result.error || '未连接设备'), 'error');
                return;
            }
            
            const buffer = new Uint8Array(result.buffer);
            
            // COM位映射: COM0=bit7, COM7=bit0
            const comBitMap = { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 0 };
            
            // 检查每个元素是否点亮
            this.presetSelectedElements.clear();
            
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
                    this.presetSelectedElements.add(elem.name);
                }
            }
            
            this.renderPickerCanvas();
            this.renderPresetCanvas();
            Utils.toast(`已同步固件状态，选中 ${this.presetSelectedElements.size} 个元素`, 'success');
            
        } catch (err) {
            Utils.toast('同步失败: ' + err.message, 'error');
        }
    },
    
    // ========== 界面预设相关 ==========
    
    // 界面预设缓存
    screenPresets: {},
    
    // 加载界面预设
    async loadScreenPresets() {
        if (typeof DeviceConfigManager === 'undefined') return;
        
        try {
            const actionsData = await DeviceConfigManager.loadActions();
            if (actionsData && actionsData.screenPresets) {
                this.screenPresets = actionsData.screenPresets;
                console.log('[TestScriptEditor] 加载界面预设:', Object.keys(this.screenPresets).length, '个');
            } else {
                this.screenPresets = {};
            }
        } catch (err) {
            console.warn('[TestScriptEditor] 加载界面预设失败:', err);
            this.screenPresets = {};
        }
    },
    
    // 刷新界面预设下拉框
    async refreshScreenPresets() {
        await this.loadScreenPresets();
        this.updateScreenPresetSelect();
        Utils.toast('已刷新界面预设列表', 'success');
    },
    
    // 更新界面预设下拉框
    updateScreenPresetSelect() {
        const select = document.getElementById('screen-preset-select');
        if (!select) return;
        
        let html = '<option value="">-- 选择预设 --</option>';
        
        // 按分类分组
        const categories = {};
        for (const [name, preset] of Object.entries(this.screenPresets)) {
            const cat = preset.category || '未分类';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({ name, ...preset });
        }
        
        for (const [cat, items] of Object.entries(categories)) {
            html += `<optgroup label="${cat}">`;
            for (const item of items) {
                html += `<option value="${item.name}">${item.name} (${item.elements?.length || 0}个)</option>`;
            }
            html += '</optgroup>';
        }
        
        select.innerHTML = html;
    },
    
    // 应用界面预设
    applyScreenPreset(presetName) {
        if (!presetName) return;
        
        const preset = this.screenPresets[presetName];
        if (!preset || !preset.elements) {
            Utils.toast('预设不存在或无元素', 'warning');
            return;
        }
        
        // 应用预设元素到当前选择
        this.presetSelectedElements = new Set(preset.elements);
        
        this.renderPickerCanvas();
        this.renderPresetCanvas();
        Utils.toast(`已应用预设: ${presetName} (${preset.elements.length}个元素)`, 'success');
    },
    
    // 初始化设备配置管理器
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            // 创建设备选择器
            createDeviceSelector('tse-device-selector', {
                onChange: (deviceId) => this.onDeviceChanged(deviceId),
                showAdd: true,
                showManage: true
            });
            
            // 订阅设备变化事件
            DeviceConfigManager.subscribe('device-changed', (e) => this.onDeviceChanged(e.newDevice));
            
            console.log('[TestScriptEditor] DeviceConfigManager 集成完成');
        } else {
            console.warn('[TestScriptEditor] DeviceConfigManager 不可用');
        }
    },
    
    async onDeviceChanged(deviceId) {
        console.log('[TestScriptEditor] 切换设备:', deviceId);
        this.suite = null;
        this.selectedPath = null;
        this.currentCase = null;
        this.lcdConfig = null;
        this.lcdImage = null;
        this.editingLcdStepIndex = null;
        this.presetSelectedElements.clear();
        await this.loadLcdConfig();
        this.loadLcdPresets();
        this.renderPresetCanvas();
        this.renderPresetList();
        await this.loadSuite();
        this.renderTree();
    },
    
    // 加载测试套件
    async loadSuite() {
        // 优先使用 DeviceConfigManager 加载
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            try {
                const testSuiteContent = await DeviceConfigManager.loadTestSuite();
                if (testSuiteContent) {
                    // 如果是字符串（JS文件内容），需要解析
                    if (typeof testSuiteContent === 'string') {
                        const suite = this.parseJsSuite(testSuiteContent);
                        if (suite) {
                            this.suite = suite;
                            console.log('[TestScriptEditor] 从设备配置加载套件:', suite.name);
                            return;
                        }
                    } else if (testSuiteContent.categories) {
                        this.suite = testSuiteContent;
                        console.log('[TestScriptEditor] 从设备配置加载套件:', testSuiteContent.name);
                        return;
                    }
                }
            } catch (err) {
                console.warn('[TestScriptEditor] DeviceConfigManager加载失败:', err);
            }
        }
        
        // 降级：加载默认套件
        await this.loadDefaultSuite();
    },
    
    // 解析JS格式的测试套件
    parseJsSuite(jsContent) {
        try {
            const match = jsContent.match(/window\.(\w+TestSuite)\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (match) {
                const fn = new Function(`return ${match[2]}`);
                return fn();
            }
            const constMatch = jsContent.match(/(?:const|let|var)\s+\w+\s*=\s*(\{[\s\S]*\});?\s*$/);
            if (constMatch) {
                const fn = new Function(`return ${constMatch[1]}`);
                return fn();
            }
            return null;
        } catch (err) {
            console.error('[TestScriptEditor] 解析JS测试套件失败:', err);
            return null;
        }
    },
    
    destroy() {
        console.log('[TestScriptEditor] destroy');
    },
    
    // 加载动作和期望定义
    loadDefinitions() {
        const lib = window.UITestLib;
        if (lib) {
            this.actions = lib.actions;
            this.expects = lib.expects;
        } else {
            // 默认定义
            this.actions = {
                "K1短按": { cmd: "key_measure", desc: "测量键(开激光/测距)" },
                "K1长按": { cmd: "key_measure_long", desc: "连续测量" },
                "K2短按": { cmd: "key_mode", desc: "切换模式" },
                "K2长按": { cmd: "key_base", desc: "切换基准" },
                "K3短按": { cmd: "key_clear", desc: "清除/返回" },
                "K3长按": { cmd: "key_backlight", desc: "背光开关" },
                "K3超长按": { cmd: "key_power_off", desc: "关机(3秒)" },
                "模拟测距成功": { cmd: "sim_ok", desc: "模拟成功(距离mm,信号)", hasParams: true },
                "模拟测距失败": { cmd: "sim_err", desc: "模拟失败(错误码)", hasParams: true },
                "设置单位": { cmd: "set_unit", desc: "设置单位(0米/1英尺/2英寸)", hasParams: true },
                "等待": { cmd: "wait", desc: "等待(毫秒)", hasParams: true },
                "获取状态": { cmd: "get_status", desc: "获取UI状态" },
            };
            this.expects = {
                "激光开": { field: "laser", value: "ON" },
                "激光关": { field: "laser", value: "OFF" },
                "步骤奇数": { field: "runstep", check: "odd" },
                "步骤偶数": { field: "runstep", check: "even" },
                "模式单次": { field: "mode", value: "SINGLE" },
                "模式面积": { field: "mode", value: "AREA" },
                "模式体积": { field: "mode", value: "VOLUME" },
                "模式连续": { field: "mode", value: "CONTINUOUS" },
                "单位米": { field: "unit", value: "m" },
                "单位英尺": { field: "unit", value: "ft" },
                "单位英寸": { field: "unit", value: "in" },
                "后基准": { field: "base", value: "BACK" },
                "前基准": { field: "base", value: "FRONT" },
                "显示Error": { field: "line4", value: "Error" },
                "显示-----": { field: "line4", value: "-----" },
            };
        }
    },
    
    // 渲染参考列表
    renderReference() {
        // 动作列表
        const actionsEl = document.getElementById('ref-actions');
        if (actionsEl) {
            actionsEl.innerHTML = Object.entries(this.actions).map(([name, def]) => 
                `<div class="ref-item" onclick="TestScriptEditor.insertAction('${name}')">
                    <code>${name}</code> ${def.hasParams ? '(...)' : ''} - ${def.desc}
                </div>`
            ).join('');
        }
        
        // 期望列表
        const expectsEl = document.getElementById('ref-expects');
        if (expectsEl) {
            const lib = window.UITestLib;
            const items = lib ? Object.entries(lib.expects) : Object.entries(this.expects);
            expectsEl.innerHTML = items.map(([name, def]) => 
                `<div class="ref-item" onclick="TestScriptEditor.insertExpect('${name}')">
                    <code>${name}</code> - ${def.desc || `${def.field}=${def.value || def.check}`}
                </div>`
            ).join('');
        }
    },
    
    // 绑定事件
    bindEvents() {
        const textarea = document.getElementById('code-textarea');
        if (textarea) {
            textarea.addEventListener('keydown', (e) => this.onCodeKeydown(e));
            textarea.addEventListener('input', () => this.onCodeInput());
            textarea.addEventListener('blur', () => {
                // 延迟隐藏，允许点击补全项
                setTimeout(() => this.hideAutocomplete(), 150);
                this.syncFromCode();
            });
            textarea.addEventListener('scroll', () => this.syncScroll());
        }
        
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-box') && !e.target.closest('.code-textarea')) {
                this.hideAutocomplete();
            }
        });
    },
    
    // 同步滚动
    syncScroll() {
        const textarea = document.getElementById('code-textarea');
        const highlight = document.getElementById('code-highlight');
        if (textarea && highlight) {
            highlight.scrollTop = textarea.scrollTop;
            highlight.scrollLeft = textarea.scrollLeft;
        }
    },
    
    // 所有可补全的关键词
    allKeywords: null,
    
    // 初始化关键词列表
    initKeywords() {
        if (this.allKeywords) return;
        
        this.allKeywords = [];
        
        // 关键字
        this.allKeywords.push({ text: '初始:', type: 'keyword', desc: '定义初始状态' });
        this.allKeywords.push({ text: '→ ', type: 'keyword', desc: '添加步骤' });
        
        // 动作
        Object.entries(this.actions).forEach(([name, def]) => {
            if (def.hasParams) {
                if (name === '模拟测距成功') {
                    this.allKeywords.push({ text: `${name}(5000,3)`, type: 'action', desc: def.desc });
                } else {
                    this.allKeywords.push({ text: `${name}()`, type: 'action', desc: def.desc });
                }
            } else {
                this.allKeywords.push({ text: name, type: 'action', desc: def.desc });
            }
        });
        
        // 期望（从UITestLib）
        const lib = window.UITestLib;
        if (lib) {
            Object.entries(lib.expects).forEach(([name, def]) => {
                this.allKeywords.push({ text: name, type: 'expect', desc: def.desc || `${def.field}=${def.value || def.check}` });
            });
        }
        
        // 字段
        this.initialFields.forEach(f => {
            if (f.options) {
                f.options.forEach(opt => {
                    this.allKeywords.push({ text: `${f.key}=${opt}`, type: 'field', desc: `${f.name}=${opt}` });
                });
            } else {
                this.allKeywords.push({ text: `${f.key}=`, type: 'field', desc: f.name });
            }
        });
    },
    
    // 切换视图
    switchView(view) {
        if (view === this.currentView) return;
        
        // 保存当前数据
        if (this.currentView === 'code') {
            this.syncFromCode();
        } else {
            this.syncFromVisual();
        }
        
        this.currentView = view;
        
        // 更新按钮状态
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        
        // 切换视图
        document.getElementById('visual-view').style.display = view === 'visual' ? 'block' : 'none';
        document.getElementById('code-view').style.display = view === 'code' ? 'block' : 'none';
        
        // 渲染对应视图
        if (view === 'visual') {
            this.renderVisualEditor();
        } else {
            this.renderCodeEditor();
        }
    },
    
    // 加载默认套件
    // 当前机芯型号
    currentMachine: 'gd303_mini',
    
    // 机芯型号列表
    machines: {
        'gd303_mini': { name: 'GD303 Mini (30H)', fuselage: 68 },
        'gd303_pt': { name: 'GD303 PT (80M)', fuselage: 40 }
    },
    
    // 切换机芯型号
    switchMachine(machineId) {
        if (!this.machines[machineId]) {
            Utils.toast('未知机芯型号', 'error');
            return;
        }
        
        // 保存当前数据
        this.saveCurrentCase();
        this.saveSuiteToStorage();
        
        // 切换
        this.currentMachine = machineId;
        
        // 加载对应数据
        this.loadSuiteFromStorage();
        
        Utils.toast(`已切换到 ${this.machines[machineId].name}`, 'success');
    },
    
    // 添加新机芯
    addMachine() {
        const id = prompt('输入机芯ID (英文):', '');
        if (!id || this.machines[id]) {
            Utils.toast('ID无效或已存在', 'error');
            return;
        }
        
        const name = prompt('输入机芯名称:', '');
        if (!name) return;
        
        const fuselage = parseInt(prompt('输入机身长度(mm):', '68')) || 68;
        
        this.machines[id] = { name, fuselage };
        
        // 更新下拉框
        const select = document.getElementById('machine-type-select');
        if (select) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = name;
            select.appendChild(opt);
            select.value = id;
        }
        
        // 切换到新机芯
        this.switchMachine(id);
    },
    
    // 保存套件到存储
    saveSuiteToStorage() {
        if (this.suite) {
            localStorage.setItem(`test_script_suite_${this.currentMachine}`, JSON.stringify(this.suite));
        }
    },
    
    // 从存储加载套件
    loadSuiteFromStorage() {
        const saved = localStorage.getItem(`test_script_suite_${this.currentMachine}`);
        if (saved) {
            try {
                this.suite = JSON.parse(saved);
                this.selectedPath = null;
                this.currentCase = null;
                this.renderTree();
                return true;
            } catch (e) {}
        }
        
        // 加载默认数据
        this.loadDefaultSuiteData();
        this.renderTree();
        return false;
    },
    
    async loadDefaultSuite() {
        // 初始化机芯选择下拉框
        const select = document.getElementById('machine-type-select');
        if (select) {
            select.innerHTML = Object.entries(this.machines).map(([id, m]) => 
                `<option value="${id}" ${id === this.currentMachine ? 'selected' : ''}>${m.name}</option>`
            ).join('');
        }
        
        // 尝试从存储加载
        if (this.loadSuiteFromStorage()) {
            return;
        }
    },
    
    // 加载默认套件数据
    loadDefaultSuiteData() {
        // 根据机芯型号加载不同的默认数据
        if (this.currentMachine === 'gd303_mini') {
            // 优先使用外部完整套件
            if (window.GD303MiniTestSuite) {
                this.suite = JSON.parse(JSON.stringify(window.GD303MiniTestSuite));
            } else {
                this.suite = this.getGD303MiniDefaultSuite();
            }
        } else if (this.currentMachine === 'gd303_pt') {
            this.suite = this.getGD303PTDefaultSuite();
        } else {
            this.suite = { name: "测试套件", version: "2.0", categories: [] };
        }
    },
    
    // GD303 PT 默认套件（简化版）
    getGD303PTDefaultSuite() {
        return {
            name: "GD303 PT UI测试",
            version: "2.0",
            categories: [
                {
                    id: "1",
                    name: "测距功能",
                    cases: [
                        {
                            id: "1.1",
                            name: "单次测距",
                            subcases: [
                                {
                                    id: "1.1.1",
                                    name: "基本流程",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----",
                                        state: "IDLE", backlight: "ON", beep: "ON"
                                    },
                                    steps: [
                                        { action: "K1短按", expect: { laser: "ON", runstep: "odd", state: "MEASURING" } },
                                        { action: "模拟测距成功(5000,3)", expect: { laser: "OFF", line4: 5.040, runstep: "even", state: "RESULT" } }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };
    },
    
    // GD303 Mini 完整默认套件 (基于 gd303_mini.yaml TC01-TC13)
    getGD303MiniDefaultSuite() {
        // 机身长度68mm (FUSELAGE_LENGTH=0.068f)
        // 后基准模式: 显示值 = 测量值 + 68mm
        // 前基准模式: 显示值 = 测量值 (不加偏移)
        
        return {
            name: "GD303 Mini UI测试",
            version: "2.0",
            categories: [
                // ============ 1. 测距功能 ============
                {
                    id: "1",
                    name: "测距功能",
                    cases: [
                        {
                            id: "1.1",
                            name: "单次测距",
                            subcases: [
                                {
                                    id: "1.1.1",
                                    name: "TC01-基本流程",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----",
                                        state: "IDLE", backlight: "ON", beep: "ON"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K1短按", expect: { laser: "ON", runstep: "odd" } },
                                        { action: "模拟测距成功(2953,3)", expect: { laser: "OFF", line4: 3.021, runstep: "even", state: "RESULT" } }
                                    ]
                                },
                                {
                                    id: "1.1.2",
                                    name: "TC02-历史数据滚动",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----",
                                        state: "IDLE", backlight: "ON", beep: "ON"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, runstep: 2 } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line3: 1.068, line4: 2.068, runstep: 4 } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(3000,3)", expect: { line2: 1.068, line3: 2.068, line4: 3.068, runstep: 6 } }
                                    ]
                                },
                                {
                                    id: "1.1.3",
                                    name: "TC03-报错不滚动数据",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, runstep: 2 } },
                                        { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                        { action: "模拟测距失败(3)", expect: { state: "ERROR", runstep: 3 } },
                                        { action: "K1短按", expect: { runstep: 3, line4: 1.068 } }
                                    ]
                                }
                            ]
                        },
                        {
                            id: "1.2",
                            name: "连续测距",
                            subcases: [
                                {
                                    id: "1.2.1",
                                    name: "TC13-MAX/MIN更新",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K1长按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                        { action: "模拟测距成功(3000,3)", expect: { line4: 3.068 } },
                                        { action: "K3短按", expect: { laser: "OFF" } }
                                    ]
                                }
                            ]
                        },
                        {
                            id: "1.3",
                            name: "错误处理",
                            subcases: [
                                {
                                    id: "1.3.1",
                                    name: "TC04-模式切换清除错误",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距失败(2)", expect: { state: "ERROR" } },
                                        { action: "K2短按", expect: { state: "IDLE", mode: "AREA" } }
                                    ]
                                },
                                {
                                    id: "1.3.2",
                                    name: "TC05-清除键重置状态",
                                    initial: {
                                        laser: "OFF", mode: "AREA", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                        { action: "K3短按", expect: { state: "IDLE" } }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                // ============ 2. 单位切换 ============
                {
                    id: "2",
                    name: "单位切换",
                    cases: [
                        {
                            id: "2.1",
                            name: "单位转换",
                            subcases: [
                                {
                                    id: "2.1.1",
                                    name: "TC06-米单位",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { unit: "m", line4: 1.068 } }
                                    ]
                                },
                                {
                                    id: "2.1.2",
                                    name: "TC07-英尺单位",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "ft", base: "BACK",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(1)", expect: { unit: "ft" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { unit: "ft", line4: 3.503 } }
                                    ]
                                },
                                {
                                    id: "2.1.3",
                                    name: "TC08-英寸单位",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "in", base: "BACK",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(2)", expect: { unit: "in" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { unit: "in", line4: 42.05 } }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                // ============ 3. 基准偏移 ============
                {
                    id: "3",
                    name: "基准偏移",
                    cases: [
                        {
                            id: "3.1",
                            name: "前后基准",
                            subcases: [
                                {
                                    id: "3.1.1",
                                    name: "TC09-后基准(+68mm)",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "获取状态", expect: { base: "BACK" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } }
                                    ]
                                },
                                {
                                    id: "3.1.2",
                                    name: "TC10-前基准(无偏移)",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", unit: "m", base: "FRONT",
                                        runstep: 0, line4: "-----", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K2长按", expect: { base: "FRONT" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(1000,3)", expect: { line4: 1.000 } }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                // ============ 4. 模式切换 ============
                {
                    id: "4",
                    name: "模式切换",
                    cases: [
                        {
                            id: "4.1",
                            name: "模式循环",
                            subcases: [
                                {
                                    id: "4.1.1",
                                    name: "全模式切换",
                                    initial: {
                                        laser: "OFF", mode: "SINGLE", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K2短按", expect: { mode: "AREA" } },
                                        { action: "K2短按", expect: { mode: "VOLUME" } },
                                        { action: "K2短按", expect: { mode: "PYTH1" } },
                                        { action: "K2短按", expect: { mode: "PYTH2" } },
                                        { action: "K2短按", expect: { mode: "PYTH3" } },
                                        { action: "K2短按", expect: { mode: "SINGLE" } }
                                    ]
                                }
                            ]
                        },
                        {
                            id: "4.2",
                            name: "面积体积",
                            subcases: [
                                {
                                    id: "4.2.1",
                                    name: "TC11-面积测量",
                                    initial: {
                                        laser: "OFF", mode: "AREA", unit: "m", base: "BACK",
                                        runstep: 0, state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K2短按", expect: { mode: "AREA" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(3000,3)", expect: { line2: 3.068, line4: 6.345 } }
                                    ]
                                },
                                {
                                    id: "4.2.2",
                                    name: "TC12-体积测量",
                                    initial: {
                                        laser: "OFF", mode: "VOLUME", unit: "m", base: "BACK",
                                        runstep: 0, state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3短按", expect: { state: "IDLE" } },
                                        { action: "设置单位(0)", expect: { unit: "m" } },
                                        { action: "K2短按", expect: { mode: "AREA" } },
                                        { action: "K2短按", expect: { mode: "VOLUME" } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line2: 2.068 } },
                                        { action: "K1短按", expect: { laser: "ON" } },
                                        { action: "模拟测距成功(2000,3)", expect: { line3: 2.068, line4: 8.845 } }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                // ============ 5. 系统功能 ============
                {
                    id: "5",
                    name: "系统功能",
                    cases: [
                        {
                            id: "5.1",
                            name: "背光蜂鸣",
                            subcases: [
                                {
                                    id: "5.1.1",
                                    name: "背光开关",
                                    initial: {
                                        backlight: "ON", state: "IDLE"
                                    },
                                    steps: [
                                        { action: "K3长按", expect: { backlight: "OFF" } },
                                        { action: "K3长按", expect: { backlight: "ON" } }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        };
    },
    
    // 渲染测试树
    renderTree() {
        const container = document.getElementById('test-tree');
        if (!container) return;
        
        let html = '';
        
        this.suite.categories.forEach(cat => {
            const isCatActive = this.selectedPath === cat.id;
            html += `<div class="tree-item category ${isCatActive ? 'active' : ''}" data-path="${cat.id}" onclick="TestScriptEditor.selectNode('${cat.id}')">
                <span>📁 ${cat.id}. ${cat.name}</span>
                <div class="tree-actions">
                    <button onclick="event.stopPropagation();TestScriptEditor.addCase('${cat.id}')" title="添加用例">➕</button>
                    <button onclick="event.stopPropagation();TestScriptEditor.renameNode('${cat.id}')" title="重命名">✏️</button>
                    <button onclick="event.stopPropagation();TestScriptEditor.deleteNode('${cat.id}')" title="删除">🗑️</button>
                </div>
            </div>`;
            
            (cat.cases || []).forEach(c => {
                const isCaseActive = this.selectedPath === c.id;
                html += `<div class="tree-item case ${isCaseActive ? 'active' : ''}" data-path="${c.id}" onclick="TestScriptEditor.selectNode('${c.id}')">
                    <span>📄 ${c.id} ${c.name}</span>
                    <div class="tree-actions">
                        <button onclick="event.stopPropagation();TestScriptEditor.addSubcase('${c.id}')" title="添加子用例">➕</button>
                        <button onclick="event.stopPropagation();TestScriptEditor.renameNode('${c.id}')" title="重命名">✏️</button>
                        <button onclick="event.stopPropagation();TestScriptEditor.deleteNode('${c.id}')" title="删除">🗑️</button>
                    </div>
                </div>`;
                
                (c.subcases || []).forEach(sc => {
                    const isActive = this.selectedPath === sc.id;
                    html += `<div class="tree-item subcase ${isActive ? 'active' : ''}" data-path="${sc.id}" onclick="TestScriptEditor.selectNode('${sc.id}')">
                        <span>📝 ${sc.id} ${sc.name}</span>
                        <div class="tree-actions">
                            <button onclick="event.stopPropagation();TestScriptEditor.duplicateNode('${sc.id}')" title="复制">📋</button>
                            <button onclick="event.stopPropagation();TestScriptEditor.renameNode('${sc.id}')" title="重命名">✏️</button>
                            <button onclick="event.stopPropagation();TestScriptEditor.deleteNode('${sc.id}')" title="删除">🗑️</button>
                        </div>
                    </div>`;
                });
            });
        });
        
        container.innerHTML = html;
    },
    
    // 选择节点
    selectNode(path) {
        // 保存当前编辑
        this.saveCurrentCase();
        
        this.selectedPath = path;
        this.renderTree();
        
        // 查找节点
        const node = this.findNode(path);
        const titleEl = document.getElementById('editor-title');
        
        if (node && node.initial !== undefined) {
            // 子用例，可编辑
            this.currentCase = JSON.parse(JSON.stringify(node));
            titleEl.textContent = `${path} ${node.name}`;
            
            if (this.currentView === 'visual') {
                this.renderVisualEditor();
            } else {
                this.renderCodeEditor();
            }
        } else if (node) {
            // 分类或用例，显示提示
            this.currentCase = null;
            titleEl.textContent = `${path} ${node.name}`;
            
            document.getElementById('visual-view').innerHTML = `
                <div class="empty-hint">
                    <div style="font-size:24px;margin-bottom:10px;">📁</div>
                    <div>这是一个${node.cases ? '分类' : '用例组'}，请选择具体的测试用例</div>
                    <button class="add-step-btn" style="margin-top:16px;width:auto;padding:10px 20px;" 
                        onclick="TestScriptEditor.addSubcase('${path}')">➕ 添加子用例</button>
                </div>`;
            document.getElementById('code-textarea').value = `# ${node.name}\n# 请选择具体的测试用例`;
        }
        
        this.updatePreview();
    },

    // 查找节点
    findNode(path) {
        const parts = path.split('.');
        
        for (const cat of this.suite.categories) {
            if (cat.id === parts[0] || cat.id === path) {
                if (parts.length === 1) return cat;
                
                for (const c of (cat.cases || [])) {
                    if (c.id === `${parts[0]}.${parts[1]}` || c.id === path) {
                        if (parts.length === 2) return c;
                        
                        for (const sc of (c.subcases || [])) {
                            if (sc.id === path) return sc;
                        }
                    }
                }
            }
        }
        return null;
    },
    
    // 保存当前用例
    saveCurrentCase() {
        if (!this.currentCase || !this.selectedPath) return;
        
        // 同步数据
        if (this.currentView === 'code') {
            this.syncFromCode();
        } else {
            this.syncFromVisual();
        }
        
        // 更新到套件
        const parts = this.selectedPath.split('.');
        if (parts.length === 3) {
            const cat = this.suite.categories.find(c => c.id === parts[0]);
            const c = cat?.cases?.find(x => x.id === `${parts[0]}.${parts[1]}`);
            const sc = c?.subcases?.find(x => x.id === this.selectedPath);
            if (sc) {
                Object.assign(sc, this.currentCase);
            }
        }
    },
    
    // ==================== 可视化编辑器 ====================
    
    renderVisualEditor() {
        const container = document.getElementById('visual-view');
        if (!container || !this.currentCase) return;
        
        const c = this.currentCase;
        
        let html = `
        <!-- 初始状态 -->
        <div class="initial-section">
            <div class="section-title">🎯 初始状态期望 (执行前验证)</div>
            <div class="initial-grid">
                ${this.initialFields.map(f => this.renderInitialField(f, c.initial)).join('')}
            </div>
        </div>
        
        <!-- 测试步骤 -->
        <div class="steps-section">
            <div class="section-title">
                <span>📋 测试步骤 (${c.steps?.length || 0})</span>
            </div>
            <div id="steps-container">
                ${(c.steps || []).map((step, i) => this.renderStepCard(step, i)).join('')}
            </div>
            <button class="add-step-btn" onclick="TestScriptEditor.addStep()">➕ 添加步骤</button>
        </div>`;
        
        container.innerHTML = html;
        
        // 绑定拖拽
        this.bindDragEvents();
    },
    
    // 渲染初始状态字段
    renderInitialField(field, initial) {
        const value = initial?.[field.key] ?? field.default;
        
        if (field.type === 'select') {
            return `<div class="initial-item">
                <label>${field.name}</label>
                <select onchange="TestScriptEditor.updateInitial('${field.key}', this.value)">
                    ${field.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            </div>`;
        } else {
            return `<div class="initial-item">
                <label>${field.name}</label>
                <input type="${field.type}" value="${value}" 
                    onchange="TestScriptEditor.updateInitial('${field.key}', this.value)">
            </div>`;
        }
    },
    
    // 渲染步骤卡片
    renderStepCard(step, index) {
        const actionName = step.action || '';
        const expects = step.expect || {};
        const isEditingLcd = this.editingLcdStepIndex === index;
        
        return `
        <div class="step-card ${isEditingLcd ? 'editing-lcd' : ''}" draggable="true" data-index="${index}">
            <div class="step-header">
                <span class="step-num">${index + 1}</span>
                <select class="step-action-select" onchange="TestScriptEditor.updateStepAction(${index}, this.value)">
                    <option value="">-- 选择动作 --</option>
                    ${Object.entries(this.actions).map(([name, def]) => 
                        `<option value="${name}" ${actionName.startsWith(name) ? 'selected' : ''}>${name}</option>`
                    ).join('')}
                </select>
                <div class="step-params">
                    ${this.renderStepParams(step, index)}
                </div>
                <div class="step-actions">
                    <button onclick="TestScriptEditor.insertStep(${index})" title="插入">➕</button>
                    <button onclick="TestScriptEditor.deleteStep(${index})" title="删除">🗑️</button>
                </div>
            </div>
            <div class="step-expects">
                <span class="label">期望:</span>
                ${this.renderExpectTags(expects, index)}
                <button class="add-expect-btn" onclick="TestScriptEditor.showExpectPicker(${index}, this)">+ 添加</button>
            </div>
            <div class="step-lcd-expect">
                ${this.renderStepLcdExpect(index)}
            </div>
        </div>`;
    },
    
    // 渲染步骤的LCD期望部分
    renderStepLcdExpect(stepIndex) {
        const lcdExpect = this.currentCase?.steps?.[stepIndex]?.expect?.lcd || [];
        const isEditing = this.editingLcdStepIndex === stepIndex;
        
        if (isEditing) {
            return `
                <span class="label">🖥️ LCD:</span>
                <span style="color:#4da6ff;font-size:10px;">编辑中 - 在右侧画布点选元素</span>
                <button class="edit-lcd-btn" style="background:rgba(0,150,255,0.2);border-style:solid;" 
                    onclick="TestScriptEditor.finishEditLcdExpect()">✓ 完成</button>
            `;
        }
        
        if (lcdExpect.length === 0) {
            return `
                <span class="label">🖥️ LCD:</span>
                <button class="edit-lcd-btn" onclick="TestScriptEditor.startEditLcdExpect(${stepIndex})">+ 设置期望</button>
            `;
        }
        
        return `
            <span class="label">🖥️ LCD:</span>
            <span class="lcd-tag">
                ${lcdExpect.length}个元素
                <span class="remove" onclick="TestScriptEditor.clearStepLcdExpect(${stepIndex})">×</span>
            </span>
            <button class="edit-lcd-btn" onclick="TestScriptEditor.startEditLcdExpect(${stepIndex})">✏️ 编辑</button>
        `;
    },
    
    // 渲染步骤参数
    renderStepParams(step, index) {
        const actionName = step.action?.split('(')[0] || '';
        const def = this.actions[actionName];
        
        if (!def?.hasParams) return '';
        
        // 解析参数
        const match = step.action?.match(/\((.+)\)/);
        const params = match ? match[1].split(',').map(s => s.trim()) : [];
        
        if (actionName === '模拟测距成功') {
            return `<input type="number" placeholder="距离mm" value="${params[0] || 5000}" 
                        onchange="TestScriptEditor.updateStepParams(${index}, [this.value, this.nextElementSibling.value])">
                    <input type="number" placeholder="信号" value="${params[1] || 3}" style="width:40px;"
                        onchange="TestScriptEditor.updateStepParams(${index}, [this.previousElementSibling.value, this.value])">`;
        } else if (actionName === '模拟测距失败' || actionName === '设置单位' || actionName === '等待') {
            return `<input type="number" placeholder="参数" value="${params[0] || ''}" 
                        onchange="TestScriptEditor.updateStepParams(${index}, [this.value])">`;
        }
        return '';
    },
    
    // 渲染期望标签
    renderExpectTags(expects, stepIndex) {
        const tags = [];
        
        for (const [key, value] of Object.entries(expects)) {
            // 跳过LCD期望（单独显示）
            if (key === 'lcd') continue;
            
            // 尝试找到对应的期望名称
            let displayName = `${key}=${value}`;
            
            const lib = window.UITestLib;
            if (lib) {
                for (const [name, def] of Object.entries(lib.expects)) {
                    if (def.field === key && (def.value === value || def.check === value)) {
                        displayName = name;
                        break;
                    }
                }
            }
            
            tags.push(`<span class="expect-tag">
                ${displayName}
                <span class="remove" onclick="TestScriptEditor.removeExpect(${stepIndex}, '${key}')">×</span>
            </span>`);
        }
        
        return tags.join('') || '<span style="color:var(--text-muted);font-size:10px;">无</span>';
    },
    
    // 更新初始状态
    updateInitial(key, value) {
        if (!this.currentCase) return;
        if (!this.currentCase.initial) this.currentCase.initial = {};
        
        // 类型转换
        const field = this.initialFields.find(f => f.key === key);
        if (field?.type === 'number') {
            value = parseFloat(value) || 0;
        }
        
        this.currentCase.initial[key] = value;
        this.updatePreview();
    },
    
    // 更新步骤动作
    updateStepAction(index, actionName) {
        if (!this.currentCase?.steps?.[index]) return;
        
        const def = this.actions[actionName];
        if (def?.hasParams) {
            // 带参数的动作
            if (actionName === '模拟测距成功') {
                this.currentCase.steps[index].action = `${actionName}(5000,3)`;
            } else {
                this.currentCase.steps[index].action = `${actionName}()`;
            }
        } else {
            this.currentCase.steps[index].action = actionName;
        }
        
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 更新步骤参数
    updateStepParams(index, params) {
        if (!this.currentCase?.steps?.[index]) return;
        
        const actionName = this.currentCase.steps[index].action?.split('(')[0] || '';
        this.currentCase.steps[index].action = `${actionName}(${params.join(',')})`;
        this.updatePreview();
    },
    
    // 显示期望选择器
    showExpectPicker(stepIndex, btn) {
        const box = document.getElementById('autocomplete-box');
        if (!box) return;
        
        const rect = btn.getBoundingClientRect();
        box.style.left = rect.left + 'px';
        box.style.top = (rect.bottom + 2) + 'px';
        
        const lib = window.UITestLib;
        const items = lib ? Object.entries(lib.expects) : Object.entries(this.expects);
        
        box.innerHTML = items.map(([name, def]) => 
            `<div class="autocomplete-item" onclick="TestScriptEditor.addExpect(${stepIndex}, '${name}')">
                <span class="name">${name}</span>
                <span class="desc">${def.desc || ''}</span>
            </div>`
        ).join('');
        
        box.style.display = 'block';
        this._expectStepIndex = stepIndex;
    },
    
    // 添加期望
    addExpect(stepIndex, expectName) {
        if (!this.currentCase?.steps?.[stepIndex]) return;
        
        const lib = window.UITestLib;
        let parsed = null;
        
        if (lib) {
            parsed = lib.parseExpect(expectName);
        } else {
            const def = this.expects[expectName];
            if (def) {
                parsed = { field: def.field, value: def.value || def.check };
            }
        }
        
        if (parsed) {
            if (!this.currentCase.steps[stepIndex].expect) {
                this.currentCase.steps[stepIndex].expect = {};
            }
            this.currentCase.steps[stepIndex].expect[parsed.field] = parsed.value !== undefined ? parsed.value : parsed.check;
        }
        
        this.hideAutocomplete();
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 移除期望
    removeExpect(stepIndex, key) {
        if (!this.currentCase?.steps?.[stepIndex]?.expect) return;
        delete this.currentCase.steps[stepIndex].expect[key];
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 添加步骤
    addStep() {
        if (!this.currentCase) return;
        if (!this.currentCase.steps) this.currentCase.steps = [];
        this.currentCase.steps.push({ action: '', expect: {} });
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 插入步骤
    insertStep(afterIndex) {
        if (!this.currentCase?.steps) return;
        this.currentCase.steps.splice(afterIndex + 1, 0, { action: '', expect: {} });
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 删除步骤
    deleteStep(index) {
        if (!this.currentCase?.steps) return;
        this.currentCase.steps.splice(index, 1);
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 绑定拖拽事件
    bindDragEvents() {
        const container = document.getElementById('steps-container');
        if (!container) return;
        
        let dragIndex = null;
        
        container.querySelectorAll('.step-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                dragIndex = parseInt(card.dataset.index);
                card.classList.add('dragging');
            });
            
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                dragIndex = null;
            });
            
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                const dropIndex = parseInt(card.dataset.index);
                if (dragIndex !== null && dragIndex !== dropIndex) {
                    this.moveStep(dragIndex, dropIndex);
                }
            });
        });
    },
    
    // 移动步骤
    moveStep(from, to) {
        if (!this.currentCase?.steps) return;
        const [item] = this.currentCase.steps.splice(from, 1);
        this.currentCase.steps.splice(to, 0, item);
        this.renderVisualEditor();
        this.updatePreview();
    },
    
    // 从可视化同步数据
    syncFromVisual() {
        // 数据已经实时更新，无需额外操作
    },

    // ==================== 代码编辑器 ====================
    
    renderCodeEditor() {
        const textarea = document.getElementById('code-textarea');
        if (!textarea || !this.currentCase) return;
        
        const code = this.caseToCode(this.currentCase);
        textarea.value = code;
        this.highlightCode(code);
    },
    
    // 语法高亮
    highlightCode(code) {
        const highlight = document.getElementById('code-highlight');
        if (!highlight) return;
        
        // 转义HTML
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // 逐行处理
        const lines = code.split('\n');
        const highlighted = lines.map(line => {
            const trimmed = line.trim();
            
            // 注释
            if (trimmed.startsWith('#')) {
                return `<span class="hl-comment">${escape(line)}</span>`;
            }
            
            // 初始状态行
            if (trimmed.startsWith('初始:') || trimmed.startsWith('初始：')) {
                return this.highlightInitialLine(line);
            }
            
            // 步骤行
            if (trimmed.startsWith('→') || trimmed.startsWith('->')) {
                return this.highlightStepLine(line);
            }
            
            // 普通行（可能是续行的期望）
            return this.highlightExpectLine(line);
        });
        
        highlight.innerHTML = highlighted.join('\n') + '\n'; // 末尾加换行保持高度一致
    },
    
    // 高亮初始状态行
    highlightInitialLine(line) {
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) return escape(line);
        
        const keyword = line.substring(0, colonIdx);
        const rest = line.substring(colonIdx + 1);
        
        // 解析 key=value 对
        const parts = rest.split(',').map(part => {
            const eqIdx = part.indexOf('=');
            if (eqIdx > 0) {
                const key = part.substring(0, eqIdx);
                const value = part.substring(eqIdx + 1);
                return `<span class="hl-field">${escape(key)}</span><span class="hl-colon">=</span><span class="hl-value">${escape(value)}</span>`;
            }
            return escape(part);
        });
        
        return `<span class="hl-keyword">${escape(keyword)}</span><span class="hl-colon">:</span>${parts.join('<span class="hl-comma">,</span>')}`;
    },
    
    // 高亮步骤行
    highlightStepLine(line) {
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // 找到箭头
        let arrowEnd = 0;
        if (line.includes('→')) {
            arrowEnd = line.indexOf('→') + 1;
        } else if (line.includes('->')) {
            arrowEnd = line.indexOf('->') + 2;
        }
        
        const prefix = line.substring(0, arrowEnd);
        const rest = line.substring(arrowEnd);
        
        // 找到冒号分隔动作和期望
        const colonIdx = rest.indexOf(':');
        
        let result = `<span class="hl-arrow">${escape(prefix)}</span>`;
        
        if (colonIdx > 0) {
            const actionPart = rest.substring(0, colonIdx);
            const expectPart = rest.substring(colonIdx + 1);
            
            result += this.highlightAction(actionPart);
            result += `<span class="hl-colon">:</span>`;
            result += this.highlightExpects(expectPart);
        } else {
            result += this.highlightAction(rest);
        }
        
        return result;
    },
    
    // 高亮动作
    highlightAction(action) {
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const trimmed = action.trim();
        
        // 检查是否有参数
        const parenIdx = trimmed.indexOf('(');
        if (parenIdx > 0) {
            const name = trimmed.substring(0, parenIdx);
            const params = trimmed.substring(parenIdx);
            
            // 高亮参数中的数字
            const highlightedParams = params.replace(/(\d+\.?\d*)/g, '<span class="hl-number">$1</span>');
            
            const leadingSpace = action.match(/^\s*/)[0];
            return `${leadingSpace}<span class="hl-action">${escape(name)}</span><span class="hl-param">${highlightedParams}</span>`;
        }
        
        const leadingSpace = action.match(/^\s*/)[0];
        return `${leadingSpace}<span class="hl-action">${escape(trimmed)}</span>`;
    },
    
    // 高亮期望列表
    highlightExpects(expects) {
        const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        const parts = expects.split(',').map(part => {
            const trimmed = part.trim();
            const leadingSpace = part.match(/^\s*/)[0];
            
            // key=value 格式
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx);
                const value = trimmed.substring(eqIdx + 1);
                
                // 数字值特殊颜色
                const isNumber = /^-?\d+\.?\d*$/.test(value);
                const valueClass = isNumber ? 'hl-number' : 'hl-value';
                
                return `${leadingSpace}<span class="hl-field">${escape(key)}</span><span class="hl-colon">=</span><span class="${valueClass}">${escape(value)}</span>`;
            }
            
            // 简单期望名
            return `${leadingSpace}<span class="hl-expect">${escape(trimmed)}</span>`;
        });
        
        return parts.join('<span class="hl-comma">,</span>');
    },
    
    // 高亮期望行（续行）
    highlightExpectLine(line) {
        if (!line.trim()) return line;
        return this.highlightExpects(line);
    },
    
    // 用例转代码
    caseToCode(c) {
        let lines = [];
        
        // 初始状态
        if (c.initial && Object.keys(c.initial).length > 0) {
            const initParts = Object.entries(c.initial).map(([k, v]) => `${k}=${v}`);
            lines.push(`初始: ${initParts.join(', ')}`);
        }
        
        // 步骤
        (c.steps || []).forEach(step => {
            let line = `→ ${step.action || ''}`;
            if (step.expect && Object.keys(step.expect).length > 0) {
                const expectParts = this.expectsToStrings(step.expect);
                line += `: ${expectParts.join(', ')}`;
            }
            lines.push(line);
        });
        
        return lines.join('\n');
    },
    
    // 期望对象转字符串数组
    expectsToStrings(expects) {
        const result = [];
        const lib = window.UITestLib;
        
        for (const [key, value] of Object.entries(expects)) {
            // LCD期望特殊处理
            if (key === 'lcd' && Array.isArray(value)) {
                if (value.length > 0) {
                    result.push(`lcd=[${value.join(',')}]`);
                }
                continue;
            }
            
            // 尝试找到简短名称
            let found = false;
            if (lib) {
                for (const [name, def] of Object.entries(lib.expects)) {
                    if (def.field === key && (def.value === value || def.check === value)) {
                        result.push(name);
                        found = true;
                        break;
                    }
                }
            }
            if (!found) {
                result.push(`${key}=${value}`);
            }
        }
        
        return result;
    },
    
    // 代码转用例
    codeToCase(code) {
        const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        
        const result = {
            initial: {},
            steps: []
        };
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('初始:') || trimmed.startsWith('初始：')) {
                const expectStr = trimmed.substring(trimmed.indexOf(':') + 1).trim();
                result.initial = this.parseExpectString(expectStr);
            } else if (trimmed.startsWith('→') || trimmed.startsWith('->')) {
                const content = trimmed.replace(/^(→|->)\s*/, '');
                const colonIdx = content.indexOf(':');
                
                let action, expectStr;
                if (colonIdx > 0) {
                    action = content.substring(0, colonIdx).trim();
                    expectStr = content.substring(colonIdx + 1).trim();
                } else {
                    action = content.trim();
                    expectStr = '';
                }
                
                result.steps.push({
                    action,
                    expect: expectStr ? this.parseExpectString(expectStr) : {}
                });
            }
        }
        
        return result;
    },
    
    // 解析期望字符串
    parseExpectString(str) {
        const result = {};
        const parts = str.split(',').map(s => s.trim()).filter(Boolean);
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            
            // LCD期望特殊格式: lcd=[elem1,elem2,...]
            if (part.startsWith('lcd=[')) {
                // 找到完整的lcd数组
                let lcdStr = part;
                while (!lcdStr.endsWith(']') && i + 1 < parts.length) {
                    i++;
                    lcdStr += ',' + parts[i];
                }
                const match = lcdStr.match(/lcd=\[([^\]]*)\]/);
                if (match) {
                    result.lcd = match[1].split(',').map(s => s.trim()).filter(Boolean);
                }
                continue;
            }
            
            const lib = window.UITestLib;
            if (lib) {
                const parsed = lib.parseExpect(part);
                if (parsed) {
                    result[parsed.field] = parsed.value !== undefined ? parsed.value : parsed.check;
                    continue;
                }
            }
            
            // 简单格式 key=value
            const eqIdx = part.indexOf('=');
            if (eqIdx > 0) {
                const key = part.substring(0, eqIdx).trim();
                let value = part.substring(eqIdx + 1).trim();
                const numVal = parseFloat(value);
                result[key] = isNaN(numVal) ? value : numVal;
            }
        }
        
        return result;
    },
    
    // 代码输入事件 - 实时补全
    onCodeInput() {
        const textarea = document.getElementById('code-textarea');
        if (textarea) {
            this.highlightCode(textarea.value);
            this.showAutoComplete(textarea);
        }
        this.updatePreview();
    },
    
    // 实时自动补全
    showAutoComplete(textarea) {
        this.initKeywords();
        
        const pos = textarea.selectionStart;
        const text = textarea.value;
        
        // 获取当前正在输入的词
        const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        const lineText = text.substring(lineStart, pos);
        
        // 找到当前词的开始位置
        const wordMatch = lineText.match(/[a-zA-Z0-9\u4e00-\u9fa5_]+$/);
        if (!wordMatch || wordMatch[0].length < 1) {
            this.hideAutocomplete();
            return;
        }
        
        const currentWord = wordMatch[0].toLowerCase();
        
        // 根据上下文过滤
        let candidates = this.allKeywords;
        
        // 判断上下文
        const isLineStart = lineText.trim() === wordMatch[0];
        const isAfterArrow = lineText.includes('→') || lineText.includes('->');
        const isAfterColon = lineText.includes(':');
        const isAfterComma = lineText.lastIndexOf(',') > lineText.lastIndexOf(':');
        
        if (isLineStart) {
            // 行首：关键字和步骤
            candidates = this.allKeywords.filter(k => k.type === 'keyword');
        } else if (isAfterArrow && !isAfterColon) {
            // 箭头后、冒号前：动作
            candidates = this.allKeywords.filter(k => k.type === 'action');
        } else if (isAfterColon || isAfterComma) {
            // 冒号后或逗号后：期望和字段
            candidates = this.allKeywords.filter(k => k.type === 'expect' || k.type === 'field');
        }
        
        // 模糊匹配
        const matches = candidates.filter(k => {
            const lower = k.text.toLowerCase();
            return lower.includes(currentWord) || this.fuzzyMatch(currentWord, lower);
        }).slice(0, 8);
        
        if (matches.length === 0) {
            this.hideAutocomplete();
            return;
        }
        
        // 显示补全框
        this.showAutocompleteBox(textarea, matches, wordMatch[0].length);
    },
    
    // 模糊匹配（拼音首字母等）
    fuzzyMatch(input, target) {
        // 简单的连续字符匹配
        let j = 0;
        for (let i = 0; i < target.length && j < input.length; i++) {
            if (target[i] === input[j]) j++;
        }
        return j === input.length;
    },
    
    // 显示补全框
    showAutocompleteBox(textarea, matches, replaceLen) {
        const box = document.getElementById('autocomplete-box');
        if (!box) return;
        
        // 计算位置
        const rect = textarea.getBoundingClientRect();
        const pos = textarea.selectionStart;
        const text = textarea.value.substring(0, pos);
        const lines = text.split('\n');
        const lineNum = lines.length;
        const colNum = lines[lines.length - 1].length;
        
        // 估算位置
        const lineHeight = 23; // 1.8 * 13px
        const charWidth = 8;
        
        box.style.left = Math.min(rect.left + 12 + colNum * charWidth, rect.right - 220) + 'px';
        box.style.top = Math.min(rect.top + 12 + lineNum * lineHeight, rect.bottom - 200) + 'px';
        
        // 渲染
        const typeColors = {
            keyword: '#c678dd',
            action: '#e06c75',
            expect: '#56b6c2',
            field: '#61afef'
        };
        
        box.innerHTML = matches.map((m, i) => `
            <div class="autocomplete-item ${i === 0 ? 'selected' : ''}" data-index="${i}" data-text="${this.escapeAttr(m.text)}" data-len="${replaceLen}">
                <span class="name" style="color:${typeColors[m.type] || '#abb2bf'}">${this.escapeHtml(m.text)}</span>
                <span class="desc">${this.escapeHtml(m.desc || '')}</span>
            </div>
        `).join('');
        
        box.style.display = 'block';
        this._autocompleteMatches = matches;
        this._autocompleteIndex = 0;
        this._autocompleteReplaceLen = replaceLen;
        
        // 绑定点击
        box.querySelectorAll('.autocomplete-item').forEach(item => {
            item.onclick = () => {
                this.insertAutocomplete(item.dataset.text, parseInt(item.dataset.len));
            };
        });
    },
    
    escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    
    escapeAttr(s) {
        return String(s).replace(/"/g, '&quot;');
    },
    
    // 插入补全
    insertAutocomplete(text, replaceLen) {
        const textarea = document.getElementById('code-textarea');
        if (!textarea) return;
        
        const pos = textarea.selectionStart;
        const before = textarea.value.substring(0, pos - replaceLen);
        const after = textarea.value.substring(pos);
        
        textarea.value = before + text + after;
        
        // 光标位置
        let newPos = before.length + text.length;
        
        // 如果有括号，光标放在括号内
        const parenIdx = text.indexOf('(');
        if (parenIdx > 0 && text.endsWith(')')) {
            newPos = before.length + parenIdx + 1;
        }
        
        textarea.selectionStart = textarea.selectionEnd = newPos;
        textarea.focus();
        
        this.hideAutocomplete();
        this.highlightCode(textarea.value);
        this.updatePreview();
    },
    
    // 代码键盘事件
    onCodeKeydown(e) {
        const box = document.getElementById('autocomplete-box');
        const isVisible = box && box.style.display === 'block';
        
        if (isVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.moveAutocompleteSelection(1);
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.moveAutocompleteSelection(-1);
                return;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                this.confirmAutocomplete();
                return;
            } else if (e.key === 'Escape') {
                this.hideAutocomplete();
                return;
            }
        }
        
        // Tab在没有补全时也触发补全
        if (e.key === 'Tab' && !isVisible) {
            e.preventDefault();
            const textarea = document.getElementById('code-textarea');
            if (textarea) {
                this.showAutoComplete(textarea);
            }
        }
    },
    
    // 移动补全选择
    moveAutocompleteSelection(delta) {
        const box = document.getElementById('autocomplete-box');
        if (!box || !this._autocompleteMatches) return;
        
        const items = box.querySelectorAll('.autocomplete-item');
        const count = items.length;
        if (count === 0) return;
        
        // 移除当前选中
        items[this._autocompleteIndex]?.classList.remove('selected');
        
        // 计算新索引
        this._autocompleteIndex = (this._autocompleteIndex + delta + count) % count;
        
        // 添加选中
        items[this._autocompleteIndex]?.classList.add('selected');
        items[this._autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
    },
    
    // 确认补全
    confirmAutocomplete() {
        if (!this._autocompleteMatches || this._autocompleteIndex === undefined) return;
        
        const match = this._autocompleteMatches[this._autocompleteIndex];
        if (match) {
            this.insertAutocomplete(match.text, this._autocompleteReplaceLen || 0);
        }
    },
    
    // 显示代码补全
    showCodeAutocomplete() {
        const textarea = document.getElementById('code-textarea');
        const box = document.getElementById('autocomplete-box');
        if (!textarea || !box) return;
        
        const pos = textarea.selectionStart;
        const text = textarea.value;
        const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
        const line = text.substring(lineStart, pos);
        
        let items = [];
        const isAfterArrow = line.includes('→') && !line.includes(':');
        
        if (isAfterArrow) {
            // 补全动作
            items = Object.entries(this.actions).map(([name, def]) => ({
                name,
                desc: def.desc,
                insert: def.hasParams ? `${name}()` : name
            }));
        } else {
            // 补全期望
            const lib = window.UITestLib;
            if (lib) {
                items = Object.entries(lib.expects).map(([name, def]) => ({
                    name,
                    desc: def.desc || '',
                    insert: name
                }));
            }
        }
        
        // 过滤
        const lastWord = line.split(/[\s,:]/).pop().toLowerCase();
        if (lastWord) {
            items = items.filter(i => i.name.toLowerCase().includes(lastWord));
        }
        
        if (items.length === 0) {
            this.hideAutocomplete();
            return;
        }
        
        // 计算位置
        const rect = textarea.getBoundingClientRect();
        box.style.left = (rect.left + 100) + 'px';
        box.style.top = (rect.top + 50) + 'px';
        
        box.innerHTML = items.slice(0, 10).map((item, i) => 
            `<div class="autocomplete-item" onclick="TestScriptEditor.insertCodeText('${item.insert}')">
                <span class="name">${item.name}</span>
                <span class="desc">${item.desc}</span>
            </div>`
        ).join('');
        
        box.style.display = 'block';
    },
    
    // 插入代码文本
    insertCodeText(text) {
        const textarea = document.getElementById('code-textarea');
        if (!textarea) return;
        
        const pos = textarea.selectionStart;
        const before = textarea.value.substring(0, pos);
        const after = textarea.value.substring(pos);
        
        // 删除当前词
        const lastSpace = Math.max(
            before.lastIndexOf(' '),
            before.lastIndexOf(','),
            before.lastIndexOf(':'),
            before.lastIndexOf('\n')
        );
        const newBefore = before.substring(0, lastSpace + 1);
        
        textarea.value = newBefore + text + after;
        textarea.selectionStart = textarea.selectionEnd = newBefore.length + text.length;
        textarea.focus();
        
        this.hideAutocomplete();
        this.updatePreview();
    },
    
    // 从代码同步数据
    syncFromCode() {
        const textarea = document.getElementById('code-textarea');
        if (!textarea || !this.currentCase) return;
        
        const parsed = this.codeToCase(textarea.value);
        this.currentCase.initial = parsed.initial;
        this.currentCase.steps = parsed.steps;
    },
    
    hideAutocomplete() {
        const box = document.getElementById('autocomplete-box');
        if (box) box.style.display = 'none';
    },
    
    // ==================== 预览和导出 ====================
    
    updatePreview() {
        const preview = document.getElementById('script-preview');
        if (!preview) return;
        
        if (!this.currentCase) {
            preview.innerHTML = '<span style="color:var(--text-muted);">选择用例查看预览</span>';
            return;
        }
        
        // 如果是代码视图，先解析
        if (this.currentView === 'code') {
            const textarea = document.getElementById('code-textarea');
            if (textarea) {
                const parsed = this.codeToCase(textarea.value);
                preview.innerHTML = `<pre style="margin:0;white-space:pre-wrap;color:var(--text-color);">${JSON.stringify(parsed, null, 2)}</pre>`;
                return;
            }
        }
        
        preview.innerHTML = `<pre style="margin:0;white-space:pre-wrap;color:var(--text-color);">${JSON.stringify({
            initial: this.currentCase.initial,
            steps: this.currentCase.steps
        }, null, 2)}</pre>`;
    },
    
    copyJson() {
        const preview = document.getElementById('script-preview');
        if (!preview) return;
        
        const text = preview.textContent;
        navigator.clipboard.writeText(text).then(() => {
            Utils.toast('已复制到剪贴板', 'success');
        });
    },
    
    // ==================== 树操作 ====================
    
    addCategory() {
        const id = String(this.suite.categories.length + 1);
        const name = prompt('输入分类名称:', '新分类');
        if (!name) return;
        
        this.suite.categories.push({ id, name, cases: [] });
        this.renderTree();
    },
    
    addCase(catId) {
        const cat = this.suite.categories.find(c => c.id === catId);
        if (!cat) return;
        
        if (!cat.cases) cat.cases = [];
        const id = `${catId}.${cat.cases.length + 1}`;
        const name = prompt('输入用例名称:', '新用例');
        if (!name) return;
        
        cat.cases.push({ id, name, subcases: [] });
        this.renderTree();
    },
    
    addSubcase(parentId) {
        const parts = parentId.split('.');
        let parent;
        
        if (parts.length === 1) {
            // 在分类下添加
            const cat = this.suite.categories.find(c => c.id === parentId);
            if (!cat?.cases?.length) {
                // 先添加用例
                this.addCase(parentId);
                return;
            }
            parent = cat.cases[cat.cases.length - 1];
        } else {
            // 在用例下添加
            const cat = this.suite.categories.find(c => c.id === parts[0]);
            parent = cat?.cases?.find(c => c.id === parentId);
        }
        
        if (!parent) return;
        if (!parent.subcases) parent.subcases = [];
        
        const id = `${parent.id}.${parent.subcases.length + 1}`;
        const name = prompt('输入子用例名称:', '新子用例');
        if (!name) return;
        
        // 创建带完整初始状态的子用例
        const newCase = {
            id,
            name,
            initial: {},
            steps: []
        };
        
        // 填充默认初始状态
        this.initialFields.forEach(f => {
            newCase.initial[f.key] = f.default;
        });
        
        parent.subcases.push(newCase);
        this.renderTree();
        this.selectNode(id);
    },
    
    renameNode(path) {
        const node = this.findNode(path);
        if (!node) return;
        
        const name = prompt('输入新名称:', node.name);
        if (!name) return;
        
        node.name = name;
        this.renderTree();
    },
    
    duplicateNode(path) {
        const parts = path.split('.');
        if (parts.length !== 3) return;
        
        const cat = this.suite.categories.find(c => c.id === parts[0]);
        const c = cat?.cases?.find(x => x.id === `${parts[0]}.${parts[1]}`);
        const sc = c?.subcases?.find(x => x.id === path);
        
        if (!sc || !c) return;
        
        const newId = `${c.id}.${c.subcases.length + 1}`;
        const copy = JSON.parse(JSON.stringify(sc));
        copy.id = newId;
        copy.name = sc.name + ' (副本)';
        
        c.subcases.push(copy);
        this.renderTree();
        this.selectNode(newId);
    },
    
    deleteNode(path) {
        if (!confirm(`确定删除 ${path}?`)) return;
        
        const parts = path.split('.');
        
        if (parts.length === 1) {
            this.suite.categories = this.suite.categories.filter(c => c.id !== path);
        } else if (parts.length === 2) {
            const cat = this.suite.categories.find(c => c.id === parts[0]);
            if (cat) cat.cases = cat.cases?.filter(c => c.id !== path) || [];
        } else {
            const cat = this.suite.categories.find(c => c.id === parts[0]);
            const c = cat?.cases?.find(x => x.id === `${parts[0]}.${parts[1]}`);
            if (c) c.subcases = c.subcases?.filter(sc => sc.id !== path) || [];
        }
        
        if (this.selectedPath === path) {
            this.selectedPath = null;
            this.currentCase = null;
        }
        
        this.renderTree();
    },
    
    // ==================== 文件操作 ====================
    
    newSuite() {
        if (!confirm('新建将清空当前内容，确定?')) return;
        
        this.suite = { name: "新测试套件", version: "2.0", categories: [] };
        this.selectedPath = null;
        this.currentCase = null;
        this.renderTree();
        
        document.getElementById('visual-view').innerHTML = '<div class="empty-hint">点击左侧添加分类开始</div>';
        document.getElementById('code-textarea').value = '';
        document.getElementById('editor-title').textContent = '选择或创建测试用例';
    },
    
    async saveSuite() {
        this.saveCurrentCase();
        
        // 优先使用 DeviceConfigManager 保存
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            try {
                await DeviceConfigManager.saveTestSuite(this.suite);
                Utils.toast('✓ 已保存到设备配置', 'success');
                return;
            } catch (err) {
                console.warn('[TestScriptEditor] DeviceConfigManager保存失败:', err);
            }
        }
        
        // 降级：保存到 localStorage
        this.saveSuiteToStorage();
        Utils.toast('✓ 已保存到本地', 'success');
    },
    
    async loadSuite() {
        // 优先使用 DeviceConfigManager 加载
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            try {
                const testSuiteContent = await DeviceConfigManager.loadTestSuite();
                if (testSuiteContent) {
                    if (typeof testSuiteContent === 'string') {
                        const suite = this.parseJsSuite(testSuiteContent);
                        if (suite) {
                            this.suite = suite;
                            this.renderTree();
                            Utils.toast('✓ 已从设备配置加载', 'success');
                            return true;
                        }
                    } else if (testSuiteContent.categories) {
                        this.suite = testSuiteContent;
                        this.renderTree();
                        Utils.toast('✓ 已从设备配置加载', 'success');
                        return true;
                    }
                }
            } catch (err) {
                console.warn('[TestScriptEditor] DeviceConfigManager加载失败:', err);
            }
        }
        
        // 降级：从 localStorage 加载
        if (this.loadSuiteFromStorage()) {
            Utils.toast('✓ 已从本地加载', 'success');
            return true;
        } else {
            Utils.toast('没有保存的数据', 'warning');
            return false;
        }
    },
    
    exportScript() {
        this.saveCurrentCase();
        
        const scripts = {};
        
        for (const cat of this.suite.categories) {
            for (const c of (cat.cases || [])) {
                for (const sc of (c.subcases || [])) {
                    scripts[sc.id] = {
                        name: `${cat.name} > ${c.name} > ${sc.name}`,
                        initial: sc.initial || {},
                        steps: (sc.steps || []).map(s => ({
                            cmd: this.actionToCmd(s.action),
                            param: this.actionToParam(s.action),
                            expect: s.expect || {}
                        }))
                    };
                }
            }
        }
        
        const blob = new Blob([JSON.stringify(scripts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.suite.name}_scripts.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        Utils.toast(`✓ 已导出 ${Object.keys(scripts).length} 个脚本`, 'success');
    },
    
    // 动作转命令
    actionToCmd(action) {
        if (!action) return '';
        const name = action.split('(')[0];
        const def = this.actions[name];
        return def?.cmd || name;
    },
    
    // 动作转参数
    actionToParam(action) {
        if (!action) return undefined;
        const match = action.match(/\((.+)\)/);
        if (!match) return undefined;
        
        const name = action.split('(')[0];
        const params = match[1].split(',').map(s => {
            const v = s.trim();
            const n = parseFloat(v);
            return isNaN(n) ? v : n;
        });
        
        if (name === '模拟测距成功') {
            return { distance: params[0], signal: params[1] || 3 };
        }
        return params.length === 1 ? params[0] : params;
    },
    
    validateCase() {
        if (!this.currentCase) {
            Utils.toast('请先选择用例', 'warning');
            return;
        }
        
        const errors = [];
        
        // 检查初始状态
        if (!this.currentCase.initial || Object.keys(this.currentCase.initial).length === 0) {
            errors.push('缺少初始状态');
        }
        
        // 检查步骤
        if (!this.currentCase.steps || this.currentCase.steps.length === 0) {
            errors.push('没有测试步骤');
        } else {
            this.currentCase.steps.forEach((step, i) => {
                if (!step.action) {
                    errors.push(`步骤${i + 1}缺少动作`);
                }
            });
        }
        
        if (errors.length > 0) {
            Utils.toast('❌ ' + errors.join(', '), 'error');
        } else {
            Utils.toast(`✓ 验证通过: ${this.currentCase.steps.length} 个步骤`, 'success');
        }
    },
    
    runSelected() {
        if (!this.currentCase) {
            Utils.toast('请先选择用例', 'warning');
            return;
        }
        
        // TODO: 执行测试
        Utils.toast('执行功能开发中...', 'info');
    },
    
    // 插入动作（从参考列表点击）
    insertAction(name) {
        if (this.currentView === 'code') {
            this.insertCodeText(name);
        } else {
            // 可视化模式下添加步骤
            if (this.currentCase) {
                if (!this.currentCase.steps) this.currentCase.steps = [];
                const def = this.actions[name];
                let action = name;
                if (def?.hasParams) {
                    if (name === '模拟测距成功') action = `${name}(5000,3)`;
                    else action = `${name}()`;
                }
                this.currentCase.steps.push({ action, expect: {} });
                this.renderVisualEditor();
                this.updatePreview();
            }
        }
    },
    
    // 插入期望（从参考列表点击）
    insertExpect(name) {
        if (this.currentView === 'code') {
            this.insertCodeText(name);
        }
    },
};

window.TestScriptEditor = TestScriptEditor;
