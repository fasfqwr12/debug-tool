/**
 * LCD段码编辑器 - 像素级编辑 + 元素分类管理 + 固件同步
 * 整合自 segment_editor 工具，增加固件0xBC同步功能
 * 
 * 功能:
 * 1. 加载LCD全显图像
 * 2. 像素级选择工具 (画笔/橡皮/魔棒/矩形)
 * 3. 元素分类管理 (digit/icon/unit)
 * 4. SEG×COM引脚分配
 * 5. 固件同步 (0xBC命令读取LCD缓冲区)
 * 6. 导出配置 (JSON/CSV/C代码)
 */
const SegmentEditor = {
    // ========== 状态管理 ==========
    state: {
        // 图像相关
        image: null,
        imageNaturalW: 0,
        imageNaturalH: 0,
        imageData: null,  // ImageData对象，用于魔棒
        
        // 视图控制
        zoom: 1,
        panX: 0,
        panY: 0,
        
        // 元素数据
        elements: [],  // [{id, name, type, description, segments:[{name, com, seg, pixelMask: Set}]}]
        
        // 选中状态
        selectedElement: null,
        selectedSegment: null,
        
        // 展开状态跟踪
        expandedElements: new Set(),
        
        // 工具状态
        activeTool: 'pan',  // 'pan' | 'brush' | 'eraser' | 'magic' | 'rect'
        brushRadius: 3,
        
        // 拖拽状态
        isDragging: false,
        isDrawing: false,
        dragStartX: 0,
        dragStartY: 0,
        dragMode: null,
        rectStart: null,
        
        // 批量圈选模式
        batchSelectMode: false,
        batchRegions: [],
        batchSegmentOrder: [],
        
        // 拾取组合模式 - 从像素拾取段组合成新元素
        pickMode: false,
        pickTargetElement: null,  // 目标元素名称
        pickedSegments: [],       // 已拾取的段 [{elemId, segName, seg对象引用}]
        
        // 显示设置
        overlayOpacity: 0.4,
        labelMode: 'all',  // 'none' | 'selected' | 'all'
        showPixelGrid: false,
        showOverlay: true,
        
        // 撤销功能
        history: [],
        historyIndex: -1,
        maxHistory: 50,
        
        // 固件缓冲区
        segBuffer: new Uint8Array(54),
    },
    
    // COM位映射: COM0=bit7, COM7=bit0
    comBitMap: { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 0 },
    
    // DOM元素引用
    canvas: null,
    ctx: null,
    
    // ========== 日志功能 ==========
    log(message, type = 'info') {
        const logArea = document.getElementById('seg-log-area');
        if (!logArea) return;
        
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const colors = {
            info: '#2196F3',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336',
            send: '#9C27B0'
        };
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            send: '📡'
        };
        
        const entry = document.createElement('div');
        entry.style.cssText = `color: ${colors[type] || colors.info}; margin-bottom: 4px;`;
        entry.innerHTML = `<span style="color:var(--text-muted)">[${time}]</span> ${icons[type] || ''} ${message}`;
        
        // 移除"等待操作"提示
        const placeholder = logArea.querySelector('div[style*="text-muted"]');
        if (placeholder && placeholder.textContent.includes('等待操作')) {
            placeholder.remove();
        }
        
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
        
        // 同时输出到控制台
        console.log(`[SegmentEditor] ${message}`);
    },
    
    clearLog() {
        const logArea = document.getElementById('seg-log-area');
        if (logArea) {
            logArea.innerHTML = '<div style="color:var(--text-muted);">日志已清空</div>';
        }
    },
    
    // ========== 初始化 ==========
    async init() {
        console.log('%c[SegmentEditor] 初始化像素级编辑器', 'color: #4CAF50; font-weight: bold; font-size: 14px');
        
        // 检查URL参数中是否指定了设备
        const urlParams = new URLSearchParams(window.location.search);
        this.urlDeviceId = urlParams.get('device');
        if (this.urlDeviceId) {
            console.log('[SegmentEditor] 从URL参数获取设备ID:', this.urlDeviceId);
        }
        
        // 确保 expandedElements 是 Set
        if (!(this.state.expandedElements instanceof Set)) {
            this.state.expandedElements = new Set();
        }
        
        // 初始化设备配置管理器
        await this.initDeviceManager();
        
        // 获取Canvas
        this.canvas = document.getElementById('seg-lcd-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d', { alpha: true, willReadFrequently: true });
            this.resizeCanvas();
            
            // 绑定Canvas事件
            this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
            this.canvas.addEventListener('wheel', (e) => this.onCanvasWheel(e), { passive: false });
            window.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
            window.addEventListener('resize', () => this.resizeCanvas());
            console.log('[SegmentEditor] Canvas初始化完成');
        } else {
            console.warn('[SegmentEditor] Canvas元素未找到');
        }
        
        // 绑定工具按钮
        this.bindToolButtons();
        
        // 绑定其他控件
        this.bindControls();
        
        // 优先从设备配置加载，localStorage 只用于恢复视图状态
        await this.loadDeviceConfig();
        
        // 恢复视图状态（缩放、平移等），但不恢复元素数据
        this.restoreViewState();
        
        // 渲染界面
        this.renderElementsTree();
        this.renderMatrix();
        this.renderBufferGrid();
        this.render();
        
        // 键盘快捷键
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        
        console.log('[SegmentEditor] 初始化完成，元素数量:', this.state.elements.length);
        
        // 延迟输出日志到页面
        setTimeout(() => {
            this.log('段码编辑器初始化完成', 'success');
            this.log(`加载了 ${this.state.elements.length} 个元素`, 'info');
            this.log('点击左侧元素可展开/收起，点击段可选中', 'info');
        }, 100);
    },
    
    // ========== 设备配置管理器集成 ==========
    async initDeviceManager() {
        // 初始化 DeviceConfigManager
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            // 如果URL指定了设备，先切换到该设备
            if (this.urlDeviceId) {
                await DeviceConfigManager.setCurrentDevice(this.urlDeviceId);
            }
            
            // 创建设备选择器
            createDeviceSelector('seg-device-selector', {
                onChange: (deviceId) => this.onDeviceChanged(deviceId),
                showAdd: true,
                showManage: true
            });
            
            // 订阅设备变化事件
            DeviceConfigManager.subscribe('device-changed', (e) => this.onDeviceChanged(e.newDevice));
            DeviceConfigManager.subscribe('lcd-updated', (e) => {
                // 其他页面更新了LCD配置，重新加载
                if (e.deviceId === DeviceConfigManager.getCurrentDevice()) {
                    this.log('检测到LCD配置更新，重新加载...', 'info');
                    this.loadDeviceConfig();
                }
            });
            
            console.log('[SegmentEditor] DeviceConfigManager 集成完成');
        } else {
            console.warn('[SegmentEditor] DeviceConfigManager 不可用，使用传统模式');
        }
    },
    
    async onDeviceChanged(deviceId) {
        this.log(`切换设备: ${deviceId}`, 'info');
        // 保存当前状态
        this.saveState();
        // 清除缓存
        this.state.elements = [];
        this.state.selectedElement = null;
        this.state.selectedSegment = null;
        // 加载新设备配置
        await this.loadDeviceConfig();
    },
    
    async loadDeviceConfig() {
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (!deviceId) {
            this.loadDefaultElements();
            return;
        }
        
        try {
            this.log(`加载设备配置: ${deviceId}...`);
            // 强制不使用缓存，确保触发 config-loaded 事件
            const lcdProject = await DeviceConfigManager.loadConfig('lcd', deviceId, { useCache: false });
            
            // 显示加载的文件路径
            const pathInfo = DeviceConfigManager.getConfigPath('lcd', deviceId);
            if (pathInfo) {
                this.log(`📂 配置文件: ${pathInfo.filePath}`, 'info');
            }
            
            if (lcdProject && lcdProject.elements && lcdProject.elements.length > 0) {
                this.applyProjectData(lcdProject);
                this.log(`✅ 从设备配置加载: ${lcdProject.elements.length} 个元素`, 'success');
                
                // 检查背景图是否存在
                if (!lcdProject.image) {
                    this.log(`⚠️ 配置缺少LCD背景图！请点击"加载图片"按钮添加LCD全显图`, 'warning');
                    // 显示提示框
                    this.showImageMissingAlert();
                }
            } else if (lcdProject && lcdProject.image) {
                // 有图片但没有元素数据 - 可能是数据丢失
                this.log(`⚠️ 配置文件有图片但缺少元素数据！`, 'warning');
                this.log(`请重新圈选段码或从备份恢复`, 'warning');
                
                // 只加载图片
                if (lcdProject.image) {
                    const img = new Image();
                    img.onload = () => {
                        this.state.image = img;
                        this.state.imageNaturalW = lcdProject.imageWidth || img.naturalWidth;
                        this.state.imageNaturalH = lcdProject.imageHeight || img.naturalHeight;
                        
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = img.naturalWidth;
                        tempCanvas.height = img.naturalHeight;
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.drawImage(img, 0, 0);
                        this.state.imageData = tempCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
                        
                        this.render();
                    };
                    img.src = lcdProject.image;
                }
                
                // 加载默认元素结构（没有像素数据）
                this.loadDefaultElements();
                
                // 显示警告
                this.showElementsMissingAlert();
            } else {
                this.log('设备无LCD配置，使用默认元素', 'warning');
                this.loadDefaultElements();
            }
        } catch (err) {
            console.error('[SegmentEditor] 加载设备配置失败:', err);
            this.log(`加载失败: ${err.message}，使用默认元素`, 'warning');
            this.loadDefaultElements();
        }
        
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
    },
    
    /**
     * 显示元素数据缺失提示
     */
    showElementsMissingAlert() {
        // 检查是否已有提示
        if (document.getElementById('seg-elements-missing-alert')) return;
        
        const alert = document.createElement('div');
        alert.id = 'seg-elements-missing-alert';
        alert.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-width: 500px;
            font-size: 14px;
        `;
        alert.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:24px;">❌</span>
                <span><b>元素数据丢失！</b></span>
            </div>
            <div style="margin-left:36px;">
                配置文件中有背景图但没有段码映射数据。<br>
                可能原因：之前保存时数据未正确写入。<br>
                <b>解决方案：</b>需要重新圈选所有段码像素。
            </div>
            <button onclick="this.parentElement.remove()" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                margin-top: 8px;
                align-self: flex-end;
            ">我知道了</button>
        `;
        document.body.appendChild(alert);
    },
    
    /**
     * 显示背景图缺失提示
     */
    showImageMissingAlert() {
        // 检查是否已有提示
        if (document.getElementById('seg-image-missing-alert')) return;
        
        const alert = document.createElement('div');
        alert.id = 'seg-image-missing-alert';
        alert.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 14px;
        `;
        alert.innerHTML = `
            <span style="font-size:20px;">⚠️</span>
            <span>LCD配置缺少背景图，请点击工具栏的<b>"加载图片"</b>按钮添加LCD全显图</span>
            <button onclick="this.parentElement.remove()" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                padding: 4px 12px;
                border-radius: 4px;
                cursor: pointer;
                margin-left: 8px;
            ">知道了</button>
        `;
        document.body.appendChild(alert);
        
        // 10秒后自动消失
        setTimeout(() => alert.remove(), 10000);
    },
    
    destroy() {
        // 页面切换前保存状态
        this.saveState();
        
        // 不清空状态，保留在内存中以便快速恢复
        // this.state.elements = [];
        // this.state.selectedElement = null;
        // this.state.selectedSegment = null;
        // this.state.image = null;
    },
    
    // ========== 状态保存/恢复 (页面切换记忆) ==========
    saveState() {
        try {
            // 准备图像数据 - 限制大小防止localStorage溢出
            let imageBase64 = null;
            if (this.state.image) {
                try {
                    const tempCanvas = document.createElement('canvas');
                    // 如果图像太大，缩小保存
                    const maxSize = 800;
                    let w = this.state.imageNaturalW;
                    let h = this.state.imageNaturalH;
                    if (w > maxSize || h > maxSize) {
                        const scale = maxSize / Math.max(w, h);
                        w = Math.round(w * scale);
                        h = Math.round(h * scale);
                    }
                    tempCanvas.width = w;
                    tempCanvas.height = h;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.drawImage(this.state.image, 0, 0, w, h);
                    imageBase64 = tempCanvas.toDataURL('image/jpeg', 0.7);  // 用JPEG压缩
                } catch (err) {
                    console.warn('[SegmentEditor] 图像转换失败:', err);
                }
            }
            
            const stateToSave = {
                version: '2.2',
                savedAt: new Date().toISOString(),
                // 图像
                image: imageBase64,
                imageWidth: this.state.imageNaturalW,
                imageHeight: this.state.imageNaturalH,
                // 元素数据
                elements: this.state.elements.map(elem => ({
                    ...elem,
                    segments: elem.segments.map(seg => ({
                        ...seg,
                        pixelMask: Array.from(seg.pixelMask || [])
                    }))
                })),
                // 选中状态
                selectedElement: this.state.selectedElement,
                selectedSegment: this.state.selectedSegment,
                // 展开状态
                expandedElements: Array.from(this.state.expandedElements || []),
                // 视图状态
                zoom: this.state.zoom,
                panX: this.state.panX,
                panY: this.state.panY,
                // 工具状态
                activeTool: this.state.activeTool,
                brushRadius: this.state.brushRadius,
                // 显示设置
                overlayOpacity: this.state.overlayOpacity,
                labelMode: this.state.labelMode,
                showPixelGrid: this.state.showPixelGrid,
                showOverlay: this.state.showOverlay,
            };
            
            const jsonStr = JSON.stringify(stateToSave);
            
            // 检查大小，如果太大就不保存图像
            if (jsonStr.length > 4 * 1024 * 1024) {  // 4MB限制
                console.warn('[SegmentEditor] 数据太大，不保存图像');
                stateToSave.image = null;
                localStorage.setItem('segment_editor_state', JSON.stringify(stateToSave));
            } else {
                localStorage.setItem('segment_editor_state', jsonStr);
            }
            console.log('[SegmentEditor] 状态已保存到localStorage, 大小:', Math.round(jsonStr.length / 1024), 'KB');
        } catch (err) {
            console.error('[SegmentEditor] 保存状态失败:', err);
            // 尝试只保存元素数据（不含图像）
            try {
                const minimalState = {
                    version: '2.2',
                    savedAt: new Date().toISOString(),
                    elements: this.state.elements.map(elem => ({
                        ...elem,
                        segments: elem.segments.map(seg => ({
                            ...seg,
                            pixelMask: Array.from(seg.pixelMask || [])
                        }))
                    })),
                    selectedElement: this.state.selectedElement,
                    selectedSegment: this.state.selectedSegment,
                };
                localStorage.setItem('segment_editor_state', JSON.stringify(minimalState));
                console.log('[SegmentEditor] 已保存最小状态（不含图像）');
            } catch (e2) {
                console.error('[SegmentEditor] 最小状态保存也失败:', e2);
            }
        }
    },
    
    restoreState() {
        try {
            const savedStr = localStorage.getItem('segment_editor_state');
            if (!savedStr) {
                console.log('[SegmentEditor] 没有保存的状态');
                return false;
            }
            
            const saved = JSON.parse(savedStr);
            console.log('[SegmentEditor] 恢复保存的状态, 版本:', saved.version, '保存时间:', saved.savedAt);
            
            // 恢复元素数据
            if (saved.elements && Array.isArray(saved.elements)) {
                this.state.elements = saved.elements.map(elem => ({
                    ...elem,
                    segments: elem.segments.map(seg => ({
                        ...seg,
                        pixelMask: new Set(seg.pixelMask || [])
                    }))
                }));
                console.log('[SegmentEditor] 恢复了', this.state.elements.length, '个元素');
            }
            
            // 恢复选中状态
            if (saved.selectedElement) {
                this.state.selectedElement = saved.selectedElement;
            }
            if (saved.selectedSegment) {
                this.state.selectedSegment = saved.selectedSegment;
            }
            
            // 恢复展开状态
            if (saved.expandedElements && Array.isArray(saved.expandedElements)) {
                this.state.expandedElements = new Set(saved.expandedElements);
            }
            
            // 恢复视图状态
            if (saved.zoom !== undefined) this.state.zoom = saved.zoom;
            if (saved.panX !== undefined) this.state.panX = saved.panX;
            if (saved.panY !== undefined) this.state.panY = saved.panY;
            
            // 恢复工具状态
            if (saved.activeTool) this.state.activeTool = saved.activeTool;
            if (saved.brushRadius !== undefined) this.state.brushRadius = saved.brushRadius;
            
            // 恢复显示设置
            if (saved.overlayOpacity !== undefined) this.state.overlayOpacity = saved.overlayOpacity;
            if (saved.labelMode !== undefined) this.state.labelMode = saved.labelMode;
            if (saved.showPixelGrid !== undefined) this.state.showPixelGrid = saved.showPixelGrid;
            if (saved.showOverlay !== undefined) this.state.showOverlay = saved.showOverlay;
            
            // 恢复图像
            if (saved.image) {
                const img = new Image();
                img.onload = () => {
                    this.state.image = img;
                    this.state.imageNaturalW = saved.imageWidth || img.naturalWidth;
                    this.state.imageNaturalH = saved.imageHeight || img.naturalHeight;
                    
                    // 提取像素数据用于魔棒
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = img.naturalWidth;
                    tempCanvas.height = img.naturalHeight;
                    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                    tempCtx.drawImage(img, 0, 0);
                    this.state.imageData = tempCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
                    
                    console.log('[SegmentEditor] 图像恢复成功:', img.naturalWidth, 'x', img.naturalHeight);
                    this.render();
                };
                img.onerror = () => {
                    console.warn('[SegmentEditor] 图像恢复失败');
                };
                img.src = saved.image;
            }
            
            // 更新UI控件
            setTimeout(() => {
                // 更新缩放滑块
                const zoomSlider = document.getElementById('seg-zoom-slider');
                if (zoomSlider) zoomSlider.value = this.state.zoom;
                
                // 更新画笔大小
                const brushSize = document.getElementById('seg-brush-size');
                const brushSizeValue = document.getElementById('seg-brush-size-value');
                if (brushSize) brushSize.value = this.state.brushRadius;
                if (brushSizeValue) brushSizeValue.textContent = this.state.brushRadius + 'px';
                
                // 更新显示选项
                const showOverlay = document.getElementById('seg-show-overlay');
                if (showOverlay) showOverlay.checked = this.state.showOverlay;
                
                const showPixelGrid = document.getElementById('seg-show-grid');
                if (showPixelGrid) showPixelGrid.checked = this.state.showPixelGrid;
                
                const opacitySlider = document.getElementById('seg-overlay-opacity');
                const opacityValue = document.getElementById('seg-opacity-value');
                if (opacitySlider) opacitySlider.value = Math.round(this.state.overlayOpacity * 100);
                if (opacityValue) opacityValue.textContent = Math.round(this.state.overlayOpacity * 100) + '%';
                
                // 更新工具按钮
                this.selectTool(this.state.activeTool);
                
                // 更新信息面板
                this.updateInfoPanel();
                this.updateStatistics();
            }, 100);
            
            return true;
        } catch (err) {
            console.error('[SegmentEditor] 恢复状态失败:', err);
            return false;
        }
    },
    
    /**
     * 只恢复视图状态（缩放、平移、工具等），不恢复元素数据
     * 元素数据从设备配置文件加载
     */
    restoreViewState() {
        try {
            const savedStr = localStorage.getItem('segment_editor_state');
            if (!savedStr) return;
            
            const saved = JSON.parse(savedStr);
            console.log('[SegmentEditor] 恢复视图状态');
            
            // 恢复视图状态
            if (saved.zoom !== undefined) this.state.zoom = saved.zoom;
            if (saved.panX !== undefined) this.state.panX = saved.panX;
            if (saved.panY !== undefined) this.state.panY = saved.panY;
            
            // 恢复工具状态
            if (saved.activeTool) this.state.activeTool = saved.activeTool;
            if (saved.brushRadius !== undefined) this.state.brushRadius = saved.brushRadius;
            
            // 恢复显示设置
            if (saved.overlayOpacity !== undefined) this.state.overlayOpacity = saved.overlayOpacity;
            if (saved.labelMode !== undefined) this.state.labelMode = saved.labelMode;
            if (saved.showPixelGrid !== undefined) this.state.showPixelGrid = saved.showPixelGrid;
            if (saved.showOverlay !== undefined) this.state.showOverlay = saved.showOverlay;
            
            // 恢复展开状态
            if (saved.expandedElements && Array.isArray(saved.expandedElements)) {
                this.state.expandedElements = new Set(saved.expandedElements);
            }
            
            // 更新UI控件
            setTimeout(() => {
                const zoomSlider = document.getElementById('seg-zoom-slider');
                if (zoomSlider) zoomSlider.value = this.state.zoom;
                
                const brushSize = document.getElementById('seg-brush-size');
                const brushSizeValue = document.getElementById('seg-brush-size-value');
                if (brushSize) brushSize.value = this.state.brushRadius;
                if (brushSizeValue) brushSizeValue.textContent = this.state.brushRadius + 'px';
                
                this.selectTool(this.state.activeTool);
            }, 100);
        } catch (err) {
            console.warn('[SegmentEditor] 恢复视图状态失败:', err);
        }
    },

    // ========== 工具绑定 ==========
    bindToolButtons() {
        const tools = ['pan', 'find', 'brush', 'eraser', 'magic', 'rect'];
        tools.forEach(tool => {
            const btn = document.getElementById(`seg-tool-${tool}`);
            if (btn) {
                btn.addEventListener('click', () => this.selectTool(tool));
            }
        });
        
        // 画笔大小
        const brushSize = document.getElementById('seg-brush-size');
        const brushSizeValue = document.getElementById('seg-brush-size-value');
        if (brushSize) {
            brushSize.addEventListener('input', () => {
                this.state.brushRadius = parseInt(brushSize.value);
                if (brushSizeValue) brushSizeValue.textContent = this.state.brushRadius + 'px';
            });
        }
    },
    
    bindControls() {
        // 缩放滑块
        const zoomSlider = document.getElementById('seg-zoom-slider');
        if (zoomSlider) {
            zoomSlider.addEventListener('input', () => {
                this.state.zoom = parseFloat(zoomSlider.value);
                this.render();
            });
        }
        
        // 显示选项
        const showOverlay = document.getElementById('seg-show-overlay');
        if (showOverlay) {
            showOverlay.addEventListener('change', () => {
                this.state.showOverlay = showOverlay.checked;
                this.render();
            });
        }
        
        const showPixelGrid = document.getElementById('seg-show-grid');
        if (showPixelGrid) {
            showPixelGrid.addEventListener('change', () => {
                this.state.showPixelGrid = showPixelGrid.checked;
                this.render();
            });
        }
        
        // 标签显示模式
        const labelMode = document.getElementById('seg-label-mode');
        if (labelMode) {
            labelMode.addEventListener('change', () => {
                this.state.labelMode = labelMode.value;
                this.render();
            });
        }
        
        // 不透明度
        const opacitySlider = document.getElementById('seg-overlay-opacity');
        const opacityValue = document.getElementById('seg-opacity-value');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', () => {
                this.state.overlayOpacity = parseInt(opacitySlider.value) / 100;
                if (opacityValue) opacityValue.textContent = opacitySlider.value + '%';
                this.render();
            });
        }
        
        // 矩阵范围
        const matrixStart = document.getElementById('seg-start');
        const matrixEnd = document.getElementById('seg-end');
        if (matrixStart) matrixStart.addEventListener('change', () => this.renderMatrix());
        if (matrixEnd) matrixEnd.addEventListener('change', () => this.renderMatrix());
    },
    
    // ========== 工具选择 ==========
    selectTool(tool) {
        this.state.activeTool = tool;
        
        // 更新按钮状态
        document.querySelectorAll('.seg-tool-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`seg-tool-${tool}`);
        if (activeBtn) activeBtn.classList.add('active');
        
        // 更新鼠标样式
        if (this.canvas) {
            if (tool === 'pan') this.canvas.style.cursor = 'grab';
            else if (tool === 'find') this.canvas.style.cursor = 'help';
            else if (tool === 'brush' || tool === 'eraser') this.canvas.style.cursor = 'crosshair';
            else if (tool === 'magic') this.canvas.style.cursor = 'pointer';
            else if (tool === 'rect') this.canvas.style.cursor = 'crosshair';
        }
    },
    
    // ========== 图像加载 ==========
    loadImage() {
        const input = document.getElementById('seg-image-input');
        if (input) input.click();
    },
    
    onImageSelected(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const img = new Image();
        img.onload = () => {
            this.state.image = img;
            this.state.imageNaturalW = img.naturalWidth;
            this.state.imageNaturalH = img.naturalHeight;
            
            // 提取像素数据用于魔棒
            const offCanvas = document.createElement('canvas');
            offCanvas.width = img.naturalWidth;
            offCanvas.height = img.naturalHeight;
            const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
            offCtx.drawImage(img, 0, 0);
            this.state.imageData = offCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
            
            console.log(`[SegmentEditor] 图片加载成功: ${img.naturalWidth}x${img.naturalHeight}`);
            
            this.fitToView();
            this.updateStatistics();
        };
        img.onerror = () => alert('图像加载失败！请确保文件格式正确（PNG/JPG）');
        img.src = URL.createObjectURL(file);
    },
    
    // ========== 视图控制 ==========
    resizeCanvas() {
        if (!this.canvas) return;
        const wrap = this.canvas.parentElement;
        if (wrap) {
            this.canvas.width = wrap.clientWidth;
            this.canvas.height = wrap.clientHeight;
            this.render();
        }
    },
    
    fitToView() {
        if (!this.state.image || !this.canvas) return;
        const wrapW = this.canvas.width;
        const wrapH = this.canvas.height;
        const imgW = this.state.imageNaturalW;
        const imgH = this.state.imageNaturalH;
        const scale = Math.min(wrapW / imgW, wrapH / imgH) * 0.9;
        this.state.zoom = scale;
        this.state.panX = 0;
        this.state.panY = 0;
        
        const zoomSlider = document.getElementById('seg-zoom-slider');
        if (zoomSlider) zoomSlider.value = scale;
        
        this.render();
    },
    
    resetView() {
        this.state.zoom = 1;
        this.state.panX = 0;
        this.state.panY = 0;
        
        const zoomSlider = document.getElementById('seg-zoom-slider');
        if (zoomSlider) zoomSlider.value = 1;
        
        this.render();
    },

    // ========== Canvas渲染 ==========
    render() {
        if (!this.ctx || !this.canvas) return;
        
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (!this.state.image) {
            ctx.fillStyle = 'var(--text-muted, #999)';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('请加载LCD全显图', this.canvas.width / 2, this.canvas.height / 2);
            return;
        }
        
        const s = this.state.zoom;
        const imgW = this.state.imageNaturalW * s;
        const imgH = this.state.imageNaturalH * s;
        const ox = (this.canvas.width - imgW) / 2 + this.state.panX;
        const oy = (this.canvas.height - imgH) / 2 + this.state.panY;
        
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.state.image, ox, oy, imgW, imgH);
        
        // 像素网格
        if (this.state.showPixelGrid && s >= 8) {
            ctx.strokeStyle = 'rgba(150, 150, 150, 0.2)';
            ctx.lineWidth = 0.5;
            for (let px = 0; px < this.state.imageNaturalW; px++) {
                const x = ox + px * s;
                ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + imgH); ctx.stroke();
            }
            for (let py = 0; py < this.state.imageNaturalH; py++) {
                const y = oy + py * s;
                ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + imgW, y); ctx.stroke();
            }
        }
        
        // 叠加层：显示所有段的像素蒙版
        if (this.state.showOverlay) {
            const opacity = this.state.overlayOpacity;
            const colors = [
                `rgba(255, 235, 59, ${opacity})`,   // 黄色
                `rgba(76, 175, 80, ${opacity})`,    // 绿色
                `rgba(33, 150, 243, ${opacity})`,   // 蓝色
                `rgba(244, 67, 54, ${opacity})`,    // 红色
                `rgba(156, 39, 176, ${opacity})`,   // 紫色
                `rgba(255, 152, 0, ${opacity})`,    // 橙色
                `rgba(0, 188, 212, ${opacity})`,    // 青色
                `rgba(233, 30, 99, ${opacity})`,    // 粉色
            ];
            let colorIdx = 0;
            
            for (const elem of this.state.elements) {
                for (const seg of elem.segments) {
                    const isSelected = (this.state.selectedElement === elem.id && this.state.selectedSegment === seg.name);
                    
                    // 如果有像素数据，绘制填充
                    if (seg.pixelMask && seg.pixelMask.size > 0) {
                        const color = isSelected ? `rgba(255, 235, 59, ${Math.min(opacity + 0.3, 1)})` : colors[colorIdx % colors.length];
                        
                        ctx.fillStyle = color;
                        for (const pkey of seg.pixelMask) {
                            const [px, py] = pkey.split(',').map(Number);
                            const rx = ox + px * s;
                            const ry = oy + py * s;
                            ctx.fillRect(rx, ry, s, s);
                        }
                        
                        // 选中时绘制边框
                        if (isSelected) {
                            ctx.strokeStyle = '#ff5722';
                            ctx.lineWidth = 3;
                            for (const pkey of seg.pixelMask) {
                                const [px, py] = pkey.split(',').map(Number);
                                const rx = ox + px * s;
                                const ry = oy + py * s;
                                ctx.strokeRect(rx, ry, s, s);
                            }
                        }
                        
                        if (!isSelected) colorIdx++;
                    }
                    // 选中但没有像素数据时，显示提示
                    else if (isSelected) {
                        // 在画布中央显示提示
                        ctx.fillStyle = 'rgba(255, 152, 0, 0.9)';
                        ctx.font = 'bold 14px Arial';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        const tipY = 30;  // 显示在顶部
                        ctx.fillText(`已选中: ${elem.name}.${seg.name} - 使用工具圈选像素区域`, this.canvas.width / 2, tipY);
                    }
                }
            }
            
            // 批量圈选模式：显示已圈选的区域
            if (this.state.batchSelectMode && this.state.batchRegions.length > 0) {
                const batchColors = [
                    'rgba(76, 175, 80, 0.6)', 'rgba(33, 150, 243, 0.6)', 'rgba(255, 152, 0, 0.6)',
                    'rgba(156, 39, 176, 0.6)', 'rgba(255, 235, 59, 0.6)', 'rgba(244, 67, 54, 0.6)',
                ];
                
                this.state.batchRegions.forEach((region, idx) => {
                    ctx.fillStyle = batchColors[idx % batchColors.length];
                    for (const pkey of region.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        ctx.fillRect(ox + px * s, oy + py * s, s, s);
                    }
                    
                    // 绘制编号
                    let sumX = 0, sumY = 0, count = 0;
                    for (const pkey of region.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        sumX += px; sumY += py; count++;
                    }
                    const cx = ox + (sumX / count) * s;
                    const cy = oy + (sumY / count) * s;
                    
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.beginPath();
                    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
                    ctx.fill();
                    
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 16px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText((idx + 1).toString(), cx, cy);
                });
            }
            
            // 绘制标签 (根据labelMode决定显示哪些)
            if (this.state.labelMode !== 'none') {
                for (const elem of this.state.elements) {
                    for (const seg of elem.segments) {
                        if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                        
                        const isSelected = (this.state.selectedElement === elem.id && this.state.selectedSegment === seg.name);
                        
                        // 如果是"仅选中"模式，只显示选中的段
                        if (this.state.labelMode === 'selected' && !isSelected) continue;
                        
                        let sumX = 0, sumY = 0, count = 0;
                        for (const pkey of seg.pixelMask) {
                            const [px, py] = pkey.split(',').map(Number);
                            sumX += px; sumY += py; count++;
                        }
                        const cx = ox + (sumX / count) * s;
                        const cy = oy + (sumY / count) * s;
                        
                        const label = `${elem.name}.${seg.name}`;
                        ctx.font = `bold ${Math.max(10, 12 * s)}px Arial`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        
                        const metrics = ctx.measureText(label);
                        const bgWidth = metrics.width + 8;
                        const bgHeight = 16;
                        
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                        ctx.fillRect(cx - bgWidth/2, cy - bgHeight/2, bgWidth, bgHeight);
                        
                        ctx.fillStyle = isSelected ? '#ffeb3b' : '#ffffff';
                        ctx.fillText(label, cx, cy);
                    }
                }
            }
        }
        
        // 矩形选择框
        if (this.state.rectStart && this.state.isDragging && this.state.activeTool === 'rect') {
            const pt = this.canvasToImage(this.state.dragStartX, this.state.dragStartY);
            if (pt) {
                const sx = ox + this.state.rectStart.x * s;
                const sy = oy + this.state.rectStart.y * s;
                const ex = ox + pt.x * s;
                const ey = oy + pt.y * s;
                ctx.strokeStyle = 'rgba(33, 150, 243, 0.9)';
                ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                ctx.rect(sx, sy, ex - sx, ey - sy);
                ctx.fill();
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        
        // 批量圈选模式提示
        if (this.state.batchSelectMode) {
            const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
            if (elem && this.state.batchSegmentOrder.length > 0) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.fillRect(0, 0, this.canvas.width, 60);
                
                ctx.fillStyle = '#4caf50';
                ctx.font = 'bold 18px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`✨ 批量圈选模式 - ${elem.name}`, this.canvas.width / 2, 22);
                
                ctx.fillStyle = '#ffffff';
                ctx.font = '14px Arial';
                ctx.fillText(`已圈选: ${this.state.batchRegions.length}/${this.state.batchSegmentOrder.length} | 使用魔棒点击区域`, this.canvas.width / 2, 45);
            }
        }
        
        // 拾取模式：高亮已拾取的段
        if (this.state.pickMode && this.state.pickedSegments.length > 0) {
            // 绘制已拾取段的高亮（紫色边框）
            ctx.strokeStyle = '#9c27b0';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);
            
            for (const picked of this.state.pickedSegments) {
                if (picked.pixelMask && picked.pixelMask.size > 0) {
                    // 填充紫色半透明
                    ctx.fillStyle = 'rgba(156, 39, 176, 0.4)';
                    for (const pkey of picked.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        ctx.fillRect(ox + px * s, oy + py * s, s, s);
                    }
                    
                    // 绘制编号标签
                    let sumX = 0, sumY = 0, count = 0;
                    for (const pkey of picked.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        sumX += px; sumY += py; count++;
                    }
                    const cx = ox + (sumX / count) * s;
                    const cy = oy + (sumY / count) * s;
                    
                    const idx = this.state.pickedSegments.indexOf(picked) + 1;
                    
                    // 绘制圆形背景
                    ctx.fillStyle = '#9c27b0';
                    ctx.beginPath();
                    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // 绘制编号
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(idx.toString(), cx, cy);
                }
            }
            
            // 顶部提示条
            ctx.fillStyle = 'rgba(156, 39, 176, 0.9)';
            ctx.fillRect(0, 0, this.canvas.width, 50);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`🎯 拾取模式 - 目标: ${this.state.pickTargetDisplayName || this.state.pickTargetElement}`, this.canvas.width / 2, 18);
            
            ctx.font = '13px Arial';
            ctx.fillText(`已拾取 ${this.state.pickedSegments.length} 个段 | 点击像素继续拾取`, this.canvas.width / 2, 38);
        }
        
        ctx.restore();
    },
    
    // ========== Canvas交互 ==========
    onCanvasMouseDown(e) {
        if (!this.state.image) return;
        
        this.state.isDragging = true;
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        
        const pt = this.canvasToImage(e.clientX, e.clientY);
        if (!pt) return;
        
        // 平移模式
        if (this.state.activeTool === 'pan' || e.shiftKey || e.button === 1 || e.button === 2) {
            this.state.dragMode = 'pan';
            if (this.canvas) this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // 查找模式 - 点击像素反查元素
        if (this.state.activeTool === 'find') {
            this.findPixelOwner(pt.x, pt.y);
            this.state.isDragging = false;
            return;
        }
        
        // 画笔/橡皮
        if (this.state.activeTool === 'brush' || this.state.activeTool === 'eraser') {
            if (!this.state.selectedElement || !this.state.selectedSegment) {
                alert('请先在左侧选择一个段');
                this.state.isDragging = false;
                return;
            }
            this.saveHistory(this.state.activeTool === 'brush' ? '画笔绘制' : '橡皮擦除');
            this.state.isDrawing = true;
            this.paintPixels(pt.x, pt.y, this.state.activeTool === 'brush');
            this.render();
            return;
        }
        
        // 魔棒
        if (this.state.activeTool === 'magic') {
            console.log('[SegmentEditor] 魔棒点击, selectedElement:', this.state.selectedElement, 'selectedSegment:', this.state.selectedSegment);
            if (!this.state.selectedElement || !this.state.selectedSegment) {
                alert('请先在左侧选择一个段');
                this.state.isDragging = false;
                return;
            }
            console.log('[SegmentEditor] 调用magicFill, 坐标:', pt.x, pt.y);
            this.magicFill(pt.x, pt.y);
            this.state.isDragging = false;
            this.render();
            return;
        }
        
        // 矩形选择
        if (this.state.activeTool === 'rect') {
            if (!this.state.selectedElement || !this.state.selectedSegment) {
                alert('请先在左侧选择一个段');
                this.state.isDragging = false;
                return;
            }
            this.state.rectStart = { x: pt.x, y: pt.y };
            return;
        }
    },
    
    onCanvasMouseMove(e) {
        if (!this.state.isDragging) return;
        
        // 平移
        if (this.state.dragMode === 'pan') {
            const dx = e.clientX - this.state.dragStartX;
            const dy = e.clientY - this.state.dragStartY;
            this.state.panX += dx;
            this.state.panY += dy;
            this.state.dragStartX = e.clientX;
            this.state.dragStartY = e.clientY;
            this.render();
            return;
        }
        
        // 画笔/橡皮
        if (this.state.isDrawing && (this.state.activeTool === 'brush' || this.state.activeTool === 'eraser')) {
            const pt = this.canvasToImage(e.clientX, e.clientY);
            if (pt) {
                this.paintPixels(pt.x, pt.y, this.state.activeTool === 'brush');
                this.render();
            }
            return;
        }
        
        // 矩形选择预览
        if (this.state.activeTool === 'rect' && this.state.rectStart) {
            this.state.dragStartX = e.clientX;
            this.state.dragStartY = e.clientY;
            this.render();
            return;
        }
    },
    
    onCanvasMouseUp(e) {
        if (!this.state.isDragging) return;
        
        // 矩形选择完成
        if (this.state.activeTool === 'rect' && this.state.rectStart) {
            const pt = this.canvasToImage(e.clientX, e.clientY);
            if (pt) {
                this.rectSelect(this.state.rectStart.x, this.state.rectStart.y, pt.x, pt.y);
            }
            this.state.rectStart = null;
        }
        
        this.state.isDragging = false;
        this.state.isDrawing = false;
        this.state.dragMode = null;
        
        if (this.state.activeTool === 'pan' && this.canvas) {
            this.canvas.style.cursor = 'grab';
        }
        
        this.render();
    },
    
    onCanvasWheel(e) {
        e.preventDefault();
        const factor = Math.pow(1.1, -e.deltaY / 100);
        this.state.zoom = Math.max(0.1, Math.min(10, this.state.zoom * factor));
        
        const zoomSlider = document.getElementById('seg-zoom-slider');
        if (zoomSlider) zoomSlider.value = this.state.zoom;
        
        this.render();
    },
    
    onKeyDown(e) {
        // Ctrl+Z: 撤销
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
        }
        
        // Enter: 全局快捷键 - 执行测试并自动+1
        if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
            // 排除在输入框、文本域、弹窗中按Enter的情况
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.closest('.modal')) {
                e.preventDefault();
                // 强制启用自动+1
                const autoIncCheckbox = document.getElementById('seg-test-auto-inc');
                if (autoIncCheckbox) autoIncCheckbox.checked = true;
                this.testManualSegment();
            }
        }
        
        // H: 循环切换标签显示模式 (隐藏 → 仅选中 → 全部)
        if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.altKey) {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                const modes = ['none', 'selected', 'all'];
                const currentIdx = modes.indexOf(this.state.labelMode);
                this.state.labelMode = modes[(currentIdx + 1) % modes.length];
                
                // 同步更新下拉框
                const labelModeSelect = document.getElementById('seg-label-mode');
                if (labelModeSelect) labelModeSelect.value = this.state.labelMode;
                
                const modeNames = { none: '隐藏', selected: '仅选中', all: '全部' };
                this.log(`标签模式: ${modeNames[this.state.labelMode]}`, 'info');
                this.render();
            }
        }
    },
    
    // ========== 坐标转换 ==========
    canvasToImage(cx, cy) {
        if (!this.state.image || !this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        const x = cx - rect.left;
        const y = cy - rect.top;
        
        const s = this.state.zoom;
        const imgW = this.state.imageNaturalW * s;
        const imgH = this.state.imageNaturalH * s;
        const ox = (this.canvas.width - imgW) / 2 + this.state.panX;
        const oy = (this.canvas.height - imgH) / 2 + this.state.panY;
        
        const px = Math.floor((x - ox) / s);
        const py = Math.floor((y - oy) / s);
        
        if (px < 0 || py < 0 || px >= this.state.imageNaturalW || py >= this.state.imageNaturalH) return null;
        return { x: px, y: py };
    },

    // ========== 绘制工具 ==========
    paintPixels(cx, cy, isAdd) {
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg) return;
        
        if (!seg.pixelMask) seg.pixelMask = new Set();
        
        const r = this.state.brushRadius;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;  // 圆形画笔
                const px = cx + dx;
                const py = cy + dy;
                if (px < 0 || py < 0 || px >= this.state.imageNaturalW || py >= this.state.imageNaturalH) continue;
                
                const key = `${px},${py}`;
                if (isAdd) {
                    seg.pixelMask.add(key);
                } else {
                    seg.pixelMask.delete(key);
                }
            }
        }
        
        this.updateInfoPanel();
        this.updateStatistics();
    },
    
    magicFill(sx, sy) {
        if (!this.state.imageData) {
            this.log('⚠️ 没有图像数据，请先加载图片', 'warning');
            return;
        }
        
        const w = this.state.imageNaturalW;
        const h = this.state.imageNaturalH;
        const data = this.state.imageData.data;
        
        // 获取起始像素的颜色
        const idx = (sy * w + sx) * 4;
        const targetR = data[idx], targetG = data[idx + 1], targetB = data[idx + 2];
        
        console.log(`[MagicFill] 点击位置: (${sx}, ${sy}), RGB: (${targetR},${targetG},${targetB})`);
        
        // 颜色差异阈值（不再限制亮度）
        const threshold = 30;
        
        // 限制最大像素数
        const maxPixels = 50000;
        const maxQueueSize = 500000;
        
        const regionMask = new Set();
        const visited = new Uint8Array(w * h);
        const queue = [[sx, sy]];
        visited[sy * w + sx] = 1;
        
        let iterations = 0;
        const maxIterations = 1000000;
        
        while (queue.length > 0) {
            iterations++;
            
            if (regionMask.size >= maxPixels) {
                this.log(`⚠️ 选区太大(>${maxPixels}像素)，已停止`, 'warning');
                break;  // 不return，保留已选的像素
            }
            
            if (iterations >= maxIterations || queue.length > maxQueueSize) {
                this.log(`⚠️ 选区计算超时，已停止`, 'warning');
                break;
            }
            
            const [x, y] = queue.shift();
            regionMask.add(`${x},${y}`);
            
            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const ni = ny * w + nx;
                if (visited[ni]) continue;
                
                const pi = ni * 4;
                const r = data[pi], g = data[pi + 1], b = data[pi + 2];
                
                // 使用RGB颜色差异而不是亮度
                const diff = Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);
                if (diff > threshold * 3) continue;
                
                visited[ni] = 1;
                queue.push([nx, ny]);
            }
        }
        
        console.log(`[MagicFill] 选区大小: ${regionMask.size} 像素`);
        
        // 如果选区太小
        if (regionMask.size < 1) {
            this.log(`选区为空`, 'warning');
            return;
        }
        
        // 批量圈选模式
        if (this.state.batchSelectMode) {
            this.state.batchRegions.push({ pixelMask: regionMask });
            console.log(`[SegmentEditor] 批量圈选: 第 ${this.state.batchRegions.length} 个区域, ${regionMask.size} 像素`);
            this.log(`批量圈选: 第 ${this.state.batchRegions.length} 个区域, ${regionMask.size} 像素`, 'success');
            this.updateBatchButton();
            return;
        }
        
        // 普通模式：直接分配给当前段
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg) return;
        
        this.saveHistory('魔棒填充');
        
        if (!seg.pixelMask) seg.pixelMask = new Set();
        for (const key of regionMask) {
            seg.pixelMask.add(key);
        }
        
        this.log(`魔棒填充: ${elem.name}.${seg.name}, ${regionMask.size} 像素`, 'success');
        
        this.updateInfoPanel();
        this.updateStatistics();
        this.renderElementsTree();
        this.render();  // 重绘画布显示圈选结果
        
        // 检测像素重叠
        const overlaps = this.checkPixelOverlap(elem.id, seg.name);
        if (overlaps) {
            this.showOverlapWarning(overlaps, elem.name, seg.name);
        }
    },
    
    rectSelect(x1, y1, x2, y2) {
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg) return;
        
        this.saveHistory('矩形选择');
        
        if (!seg.pixelMask) seg.pixelMask = new Set();
        
        const minX = Math.max(0, Math.min(x1, x2));
        const maxX = Math.min(this.state.imageNaturalW - 1, Math.max(x1, x2));
        const minY = Math.max(0, Math.min(y1, y2));
        const maxY = Math.min(this.state.imageNaturalH - 1, Math.max(y1, y2));
        
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                seg.pixelMask.add(`${x},${y}`);
            }
        }
        
        this.updateInfoPanel();
        this.updateStatistics();
        this.renderElementsTree();
        this.render();  // 重绘画布显示圈选结果
        
        // 检测像素重叠
        const overlaps = this.checkPixelOverlap(elem.id, seg.name);
        if (overlaps) {
            this.showOverlapWarning(overlaps, elem.name, seg.name);
        }
    },
    
    // ========== 撤销功能 ==========
    saveHistory(description) {
        const snapshot = {
            description: description,
            timestamp: Date.now(),
            elements: this.state.elements.map(elem => ({
                id: elem.id,
                name: elem.name,
                type: elem.type,
                description: elem.description || '',
                segments: elem.segments.map(seg => ({
                    name: seg.name,
                    com: seg.com,
                    seg: seg.seg,
                    pixelMask: new Set(seg.pixelMask || [])
                }))
            }))
        };
        
        this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
        this.state.history.push(snapshot);
        
        if (this.state.history.length > this.state.maxHistory) {
            this.state.history.shift();
        } else {
            this.state.historyIndex++;
        }
        
        this.updateUndoButton();
    },
    
    undo() {
        if (this.state.historyIndex <= 0) {
            console.log('[SegmentEditor] 没有可撤销的操作');
            return;
        }
        
        this.state.historyIndex--;
        const snapshot = this.state.history[this.state.historyIndex];
        
        this.state.elements = snapshot.elements.map(elem => ({
            id: elem.id,
            name: elem.name,
            type: elem.type,
            description: elem.description || '',
            segments: elem.segments.map(seg => ({
                name: seg.name,
                com: seg.com,
                seg: seg.seg,
                pixelMask: new Set(seg.pixelMask || [])
            }))
        }));
        
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
        this.updateUndoButton();
        
        console.log('[SegmentEditor] 撤销到:', snapshot.description);
    },
    
    updateUndoButton() {
        const btnUndo = document.getElementById('seg-btn-undo');
        if (btnUndo) {
            btnUndo.disabled = this.state.historyIndex <= 0;
        }
    },
    
    // ========== 批量圈选 ==========
    startBatchSelect() {
        if (!this.state.selectedElement || !this.state.image) {
            alert('请先选择一个元素并加载LCD图像！');
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        // 找出未完成的段
        const unfinishedSegments = elem.segments.filter(s => {
            const hasPins = (s.com !== '' && s.seg !== '');
            const hasPixels = s.pixelMask && s.pixelMask.size > 0;
            return hasPins && !hasPixels;
        });
        
        // 按 ABCDEFG 顺序排序
        const segmentOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
        unfinishedSegments.sort((a, b) => {
            const indexA = segmentOrder.indexOf(a.name.toUpperCase());
            const indexB = segmentOrder.indexOf(b.name.toUpperCase());
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
        
        if (unfinishedSegments.length === 0) {
            alert('当前元素所有段已完成！');
            return;
        }
        
        this.state.batchSelectMode = true;
        this.state.batchRegions = [];
        this.state.batchSegmentOrder = unfinishedSegments;
        
        this.selectTool('magic');
        this.updateBatchButton();
        this.render();
        
        alert(`批量圈选模式！\n\n元素: ${elem.name}\n需要圈选: ${unfinishedSegments.length} 个段\n顺序: ${unfinishedSegments.map(s => s.name).join(', ')}\n\n使用魔棒工具依次点击各段区域`);
    },
    
    finishBatchSelect() {
        if (!this.state.batchSelectMode || !this.state.selectedElement) return;
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        const unfinishedSegments = this.state.batchSegmentOrder;
        
        if (this.state.batchRegions.length === 0) {
            alert('请先使用魔棒工具点击区域！');
            return;
        }
        
        if (this.state.batchRegions.length !== unfinishedSegments.length) {
            if (!confirm(`已圈选 ${this.state.batchRegions.length} 个区域，但需要 ${unfinishedSegments.length} 个段。\n\n是否继续分配？`)) {
                return;
            }
        }
        
        this.saveHistory(`批量分配: ${elem.name}`);
        
        const maxAssign = Math.min(this.state.batchRegions.length, unfinishedSegments.length);
        for (let i = 0; i < maxAssign; i++) {
            const region = this.state.batchRegions[i];
            const segment = unfinishedSegments[i];
            segment.pixelMask = new Set(region.pixelMask);
        }
        
        this.state.batchSelectMode = false;
        this.state.batchRegions = [];
        this.state.batchSegmentOrder = [];
        
        this.renderElementsTree();
        this.render();
        this.updateStatistics();
        this.updateBatchButton();
        
        alert(`批量分配完成！已分配 ${maxAssign} 个段`);
    },
    
    cancelBatchSelect() {
        this.state.batchSelectMode = false;
        this.state.batchRegions = [];
        this.state.batchSegmentOrder = [];
        this.updateBatchButton();
        this.render();
    },
    
    undoLastBatchRegion() {
        if (this.state.batchRegions.length > 0) {
            this.state.batchRegions.pop();
            this.updateBatchButton();
            this.render();
        }
    },
    
    updateBatchButton() {
        const batchPanel = document.getElementById('seg-batch-panel');
        const batchCount = document.getElementById('seg-batch-count');
        const batchNeeded = document.getElementById('seg-batch-needed');
        
        if (batchPanel) {
            batchPanel.style.display = this.state.batchSelectMode ? 'block' : 'none';
        }
        
        if (batchCount) {
            batchCount.textContent = this.state.batchRegions.length;
        }
        
        if (batchNeeded) {
            batchNeeded.textContent = this.state.batchSegmentOrder.length;
        }
    },

    // ========== 元素管理 ==========
    loadDefaultElements() {
        this.state.elements = [
            {
                id: 'line4', name: '第四行数字', type: 'digit', description: 'SEG 23-27, 主显示行',
                segments: [
                    { name: 'D1', seg: '23', com: '', pixelMask: new Set() },
                    { name: 'D2', seg: '24', com: '', pixelMask: new Set() },
                    { name: 'D3', seg: '25', com: '', pixelMask: new Set() },
                    { name: 'D4', seg: '26', com: '', pixelMask: new Set() },
                    { name: 'D5', seg: '27', com: '', pixelMask: new Set() },
                ]
            },
            {
                id: 'battery', name: '电池图标', type: 'icon', description: 'SEG 6,9',
                segments: [
                    { name: '外框', seg: '6', com: '5', pixelMask: new Set() },
                    { name: '格1', seg: '9', com: '5', pixelMask: new Set() },
                    { name: '格2', seg: '6', com: '7', pixelMask: new Set() },
                    { name: '格3', seg: '9', com: '7', pixelMask: new Set() },
                ]
            },
        ];
    },
    
    addElement() {
        const name = prompt('元素名称:');
        if (!name) return;
        
        const type = prompt('类型 (digit/icon/unit):', 'icon') || 'icon';
        const description = prompt('说明 (可选):') || '';
        
        const elem = {
            id: 'elem_' + Date.now(),
            name: name,
            type: type,
            description: description,
            segments: []
        };
        
        if (type === 'digit') {
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].forEach(s => {
                elem.segments.push({ name: s, seg: '', com: '', pixelMask: new Set() });
            });
        } else {
            elem.segments.push({ name: '整体', seg: '', com: '', pixelMask: new Set() });
        }
        
        this.state.elements.push(elem);
        this.renderElementsTree();
        this.updateStatistics();
    },
    
    // ========== 中文翻译 ==========
    // 常用中文词汇翻译表
    chineseToEnglish: {
        '前': 'front', '后': 'rear', '左': 'left', '右': 'right',
        '上': 'top', '下': 'bottom', '中': 'mid', '内': 'inner', '外': 'outer',
        '基准': 'ref', '参考': 'ref', '标准': 'std',
        '电池': 'battery', '电量': 'power', '充电': 'charge',
        '蓝牙': 'bt', '信号': 'signal', '连接': 'conn',
        '测量': 'measure', '距离': 'dist', '角度': 'angle', '面积': 'area', '体积': 'vol',
        '单位': 'unit', '米': 'm', '英尺': 'ft', '英寸': 'in',
        '模式': 'mode', '设置': 'set', '菜单': 'menu',
        '数字': 'digit', '图标': 'icon', '符号': 'sym', '指示': 'ind',
        '行': 'line', '列': 'col', '位': 'd', '段': 's',
        '激光': 'laser', '开': 'on', '关': 'off',
        '温度': 'temp', '湿度': 'hum', '时间': 'time',
        '警告': 'warn', '错误': 'err', '成功': 'ok',
        '第一': '1st', '第二': '2nd', '第三': '3rd', '第四': '4th',
        '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
        '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
    },
    
    // 翻译中文名称为英文
    translateToEnglish(chinese) {
        if (!chinese) return '';
        
        // 如果已经是英文/数字，直接返回
        if (/^[a-zA-Z0-9_\-]+$/.test(chinese)) return chinese;
        
        let result = chinese;
        
        // 替换已知词汇
        for (const [cn, en] of Object.entries(this.chineseToEnglish)) {
            result = result.replace(new RegExp(cn, 'g'), en);
        }
        
        // 移除剩余的中文字符，用下划线连接
        result = result.replace(/[\u4e00-\u9fa5]+/g, '_');
        
        // 清理多余的下划线和特殊字符
        result = result.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
        
        // 如果结果为空，生成默认名称
        if (!result) {
            result = 'elem_' + Date.now();
        }
        
        return result;
    },
    
    // ========== 拾取组合模式 ==========
    // 开始拾取模式：输入新元素名称，然后点击像素拾取段
    startPickMode() {
        const chineseName = prompt('请输入新元素名称 (支持中文，会自动翻译):');
        if (!chineseName || !chineseName.trim()) return;
        
        // 翻译中文为英文
        const englishName = this.translateToEnglish(chineseName.trim());
        
        this.state.pickMode = true;
        this.state.pickTargetElement = englishName;
        this.state.pickTargetDisplayName = chineseName.trim();  // 保存原始中文名用于显示
        this.state.pickedSegments = [];
        
        // 切换到查找工具
        this.selectTool('find');
        
        // 显示拾取面板
        this.showPickPanel();
        
        this.log(`🎯 拾取模式开始 - 点击LCD像素选择要组合的段`, 'info');
        this.log(`目标元素: "${chineseName}" → ${englishName}`, 'info');
    },
    
    // 显示拾取面板
    showPickPanel() {
        let panel = document.getElementById('seg-pick-panel');
        if (!panel) {
            // 创建面板，插入到批量圈选面板后面
            const batchPanel = document.getElementById('seg-batch-panel');
            if (batchPanel) {
                panel = document.createElement('div');
                panel.id = 'seg-pick-panel';
                panel.style.cssText = `
                    display: block;
                    background: rgba(156, 39, 176, 0.15);
                    border: 1px solid #9c27b0;
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 10px;
                `;
                batchPanel.parentNode.insertBefore(panel, batchPanel.nextSibling);
            }
        }
        
        if (panel) {
            panel.style.display = 'block';
            this.updatePickPanel();
        }
    },
    
    // 更新拾取面板内容
    updatePickPanel() {
        const panel = document.getElementById('seg-pick-panel');
        if (!panel) return;
        
        const displayName = this.state.pickTargetDisplayName || this.state.pickTargetElement;
        const englishName = this.state.pickTargetElement;
        
        const pickedList = this.state.pickedSegments.map((p, i) => 
            `<div style="display:flex;align-items:center;gap:6px;padding:4px;background:rgba(255,255,255,0.1);border-radius:3px;margin-bottom:4px;">
                <span style="color:#fff;font-size:12px;">${i+1}. ${p.elemName}.${p.segName}</span>
                <span style="color:#9c27b0;font-size:10px;">SEG${p.seg}:COM${p.com}</span>
                <button onclick="SegmentEditor.removePickedSegment(${i})" style="margin-left:auto;padding:2px 6px;font-size:10px;background:#f44336;color:#fff;border:none;border-radius:3px;cursor:pointer;">✕</button>
            </div>`
        ).join('');
        
        panel.innerHTML = `
            <h4 style="color:#9c27b0;margin:0 0 8px;font-size:13px;">🎯 拾取组合模式</h4>
            <div style="font-size:12px;color:var(--text-color);margin-bottom:4px;">
                目标: <b style="color:#9c27b0">${displayName}</b>
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;">
                → ${englishName}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
                点击LCD上的像素拾取段 (已拾取: ${this.state.pickedSegments.length})
            </div>
            <div style="max-height:120px;overflow-y:auto;margin-bottom:8px;">
                ${pickedList || '<div style="color:var(--text-muted);font-size:11px;">暂无拾取的段</div>'}
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="SegmentEditor.finishPickMode()" style="flex:1;padding:6px;font-size:11px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;" ${this.state.pickedSegments.length === 0 ? 'disabled' : ''}>✅ 完成组合</button>
                <button onclick="SegmentEditor.cancelPickMode()" style="flex:1;padding:6px;font-size:11px;background:#f44336;color:#fff;border:none;border-radius:4px;cursor:pointer;">❌ 取消</button>
            </div>
        `;
    },
    
    // 拾取一个段（从findPixelOwner调用）
    pickSegment(elem, seg) {
        // 检查是否已拾取
        const exists = this.state.pickedSegments.find(p => p.elemId === elem.id && p.segName === seg.name);
        if (exists) {
            this.log(`⚠️ 该段已拾取: ${elem.name}.${seg.name}`, 'warning');
            return;
        }
        
        this.state.pickedSegments.push({
            elemId: elem.id,
            elemName: elem.name,
            segName: seg.name,
            seg: seg.seg,
            com: seg.com,
            pixelMask: new Set(seg.pixelMask)  // 复制像素数据
        });
        
        this.log(`✅ 拾取段: ${elem.name}.${seg.name} (SEG${seg.seg}:COM${seg.com})`, 'success');
        this.updatePickPanel();
        this.render();  // 重绘以高亮已拾取的段
    },
    
    // 移除已拾取的段
    removePickedSegment(index) {
        const removed = this.state.pickedSegments.splice(index, 1)[0];
        if (removed) {
            this.log(`移除拾取: ${removed.elemName}.${removed.segName}`, 'info');
        }
        this.updatePickPanel();
        this.render();
    },
    
    // 完成拾取，创建新元素
    finishPickMode() {
        if (this.state.pickedSegments.length === 0) {
            this.log('⚠️ 没有拾取任何段', 'warning');
            return;
        }
        
        const newElemName = this.state.pickTargetElement;
        
        // 创建新元素
        const newElem = {
            id: 'elem_' + Date.now(),
            name: newElemName,
            type: 'icon',
            description: `由 ${this.state.pickedSegments.length} 个段组合`,
            segments: []
        };
        
        // 移动段到新元素
        for (const picked of this.state.pickedSegments) {
            // 添加到新元素
            newElem.segments.push({
                name: picked.segName,
                seg: picked.seg,
                com: picked.com,
                pixelMask: picked.pixelMask
            });
            
            // 从原元素删除
            const srcElem = this.state.elements.find(e => e.id === picked.elemId);
            if (srcElem) {
                srcElem.segments = srcElem.segments.filter(s => s.name !== picked.segName);
            }
        }
        
        // 删除空元素
        this.state.elements = this.state.elements.filter(e => e.segments.length > 0);
        
        // 添加新元素
        this.state.elements.push(newElem);
        
        // 选中新元素
        this.state.selectedElement = newElem.id;
        this.state.selectedSegment = null;
        this.state.expandedElements.add(newElem.id);
        
        this.log(`✅ 创建元素 "${newElemName}"，包含 ${newElem.segments.length} 个段`, 'success');
        
        // 退出拾取模式
        this.cancelPickMode();
        
        // 刷新界面
        this.renderElementsTree();
        this.renderMatrix();
        this.updateInfoPanel();
        this.render();
        this.updateStatistics();
    },
    
    // 取消拾取模式
    cancelPickMode() {
        this.state.pickMode = false;
        this.state.pickTargetElement = null;
        this.state.pickedSegments = [];
        
        // 隐藏面板
        const panel = document.getElementById('seg-pick-panel');
        if (panel) panel.style.display = 'none';
        
        // 切换回平移工具
        this.selectTool('pan');
        
        this.log('拾取模式已取消', 'info');
        this.render();
    },
    
    deleteElement(elemId) {
        if (!confirm('确定删除该元素？')) return;
        this.state.elements = this.state.elements.filter(e => e.id !== elemId);
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
    },
    
    // 拆分元素 - 将多段元素拆分为独立元素
    splitElement(elemId) {
        const elem = this.state.elements.find(e => e.id === elemId);
        if (!elem) return;
        
        if (elem.segments.length <= 1) {
            alert('该元素只有一个段，无需拆分');
            return;
        }
        
        // 显示拆分对话框
        this.showSplitDialog(elem);
    },
    
    // 显示拆分对话框
    showSplitDialog(elem) {
        const baseName = elem.name;
        
        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'seg-dialog-overlay';
        dialog.innerHTML = `
            <div class="seg-dialog" style="width:500px;max-height:80vh;">
                <div class="seg-dialog-header" style="background:#2a2a3a;color:#fff;">
                    <span>✂️ 拆分元素: ${baseName}</span>
                    <button class="seg-dialog-close" onclick="this.closest('.seg-dialog-overlay').remove()">×</button>
                </div>
                <div class="seg-dialog-body" style="max-height:60vh;overflow-y:auto;background:#1e1e2e;">
                    <div style="margin-bottom:12px;font-size:12px;color:#aaa;">
                        选择要组合的段，并为每个新元素命名。<br>
                        勾选同一组的段会合并为一个元素。
                    </div>
                    <div id="split-groups-container"></div>
                    <button class="seg-btn" style="margin-top:12px;background:#3a3a4a;color:#ddd;border:1px solid #5a5a6a;" onclick="SegmentEditor.addSplitGroup()">+ 添加分组</button>
                </div>
                <div class="seg-dialog-footer" style="background:#2a2a3a;">
                    <button class="seg-btn" style="background:#3a3a4a;color:#ddd;border:1px solid #5a5a6a;" onclick="this.closest('.seg-dialog-overlay').remove()">取消</button>
                    <button class="seg-btn primary" style="background:#4caf50;color:#fff;border:1px solid #4caf50;" onclick="SegmentEditor.confirmSplit()">确认拆分</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        // 保存当前拆分的元素
        this._splitElem = elem;
        this._splitGroups = [];
        
        // 默认每个段一个分组
        elem.segments.forEach((seg, i) => {
            this._splitGroups.push({
                name: `${baseName}_${seg.name}`,
                segments: [seg.name]
            });
        });
        
        this.renderSplitGroups();
    },
    
    // 渲染拆分分组
    renderSplitGroups() {
        const container = document.getElementById('split-groups-container');
        if (!container) return;
        
        const elem = this._splitElem;
        const allSegNames = elem.segments.map(s => s.name);
        
        // 统计每个段被分配的次数
        const segAssignCount = {};
        allSegNames.forEach(s => segAssignCount[s] = 0);
        this._splitGroups.forEach(g => g.segments.forEach(s => segAssignCount[s]++));
        
        let html = `
            <div style="margin-bottom:8px;padding:6px 10px;background:#2a3a2a;border:1px solid #4a5a4a;border-radius:4px;font-size:11px;color:#8f8;">
                💡 提示：同一个段可以勾选到多个分组（共用），重叠检测时可选择忽略
            </div>
        `;
        
        this._splitGroups.forEach((group, gi) => {
            html += `
                <div class="split-group" style="background:#2a2a3a;border-radius:6px;padding:10px;margin-bottom:8px;border:1px solid #4a4a5a;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <label style="font-size:11px;color:#aaa;width:60px;">元素名:</label>
                        <input type="text" class="seg-input" value="${group.name}" 
                               onchange="SegmentEditor.updateSplitGroupName(${gi}, this.value)"
                               style="flex:1;padding:4px 8px;font-size:12px;background:#1a1a2a;border:1px solid #4a4a5a;color:#fff;">
                        <button class="seg-btn" style="padding:2px 8px;font-size:11px;color:#ef4444;background:#3a2a2a;border:1px solid #5a3a3a;" 
                                onclick="SegmentEditor.removeSplitGroup(${gi})">删除</button>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${allSegNames.map(sn => {
                            const isInGroup = group.segments.includes(sn);
                            const isShared = segAssignCount[sn] > 1;
                            // 共用的段显示橙色背景
                            const bgColor = isInGroup ? (isShared ? '#ff9800' : '#4caf50') : '#3a3a4a';
                            const textColor = isInGroup ? '#000' : '#ddd';
                            return `
                                <label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:${bgColor};border-radius:4px;cursor:pointer;font-size:11px;color:${textColor};" title="${isShared ? '共用段' : ''}">
                                    <input type="checkbox" ${isInGroup ? 'checked' : ''}
                                           onchange="SegmentEditor.toggleSplitSegmentMulti(${gi}, '${sn}', this.checked)">
                                    ${sn}${isShared && isInGroup ? ' 🔗' : ''}
                                </label>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        });
        
        // 显示未分配的段
        const unassigned = allSegNames.filter(s => segAssignCount[s] === 0);
        if (unassigned.length > 0) {
            html += `
                <div style="padding:8px;background:#3a2a2a;border:1px solid #5a3a3a;border-radius:4px;font-size:11px;color:#ef4444;">
                    ⚠️ 未分配的段: ${unassigned.join(', ')}
                </div>
            `;
        }
        
        // 显示共用段统计
        const sharedSegs = allSegNames.filter(s => segAssignCount[s] > 1);
        if (sharedSegs.length > 0) {
            html += `
                <div style="padding:8px;background:#3a3a2a;border:1px solid #5a5a3a;border-radius:4px;font-size:11px;color:#ff9800;margin-top:8px;">
                    🔗 共用段: ${sharedSegs.map(s => `${s}(${segAssignCount[s]}组)`).join(', ')}
                </div>
            `;
        }
        
        container.innerHTML = html;
    },
    
    // 多选模式 - 允许段在多个分组中
    toggleSplitSegmentMulti(groupIndex, segName, checked) {
        const group = this._splitGroups[groupIndex];
        if (checked) {
            // 添加到当前分组（不从其他分组移除）
            if (!group.segments.includes(segName)) {
                group.segments.push(segName);
            }
        } else {
            group.segments = group.segments.filter(s => s !== segName);
        }
        this.renderSplitGroups();
    },
    
    // 添加分组
    addSplitGroup() {
        const baseName = this._splitElem.name;
        this._splitGroups.push({
            name: `${baseName}_new${this._splitGroups.length + 1}`,
            segments: []
        });
        this.renderSplitGroups();
    },
    
    // 删除分组
    removeSplitGroup(index) {
        this._splitGroups.splice(index, 1);
        this.renderSplitGroups();
    },
    
    // 更新分组名称
    updateSplitGroupName(index, name) {
        this._splitGroups[index].name = name;
    },
    
    // 切换段的分组
    toggleSplitSegment(groupIndex, segName, checked) {
        const group = this._splitGroups[groupIndex];
        if (checked) {
            // 从其他分组移除
            this._splitGroups.forEach((g, i) => {
                if (i !== groupIndex) {
                    g.segments = g.segments.filter(s => s !== segName);
                }
            });
            // 添加到当前分组
            if (!group.segments.includes(segName)) {
                group.segments.push(segName);
            }
        } else {
            group.segments = group.segments.filter(s => s !== segName);
        }
        this.renderSplitGroups();
    },
    
    // 确认拆分
    confirmSplit() {
        const elem = this._splitElem;
        
        // 验证：所有段都必须至少分配到一个分组
        const allSegNames = new Set(elem.segments.map(s => s.name));
        const assignedSegs = new Set();
        this._splitGroups.forEach(g => g.segments.forEach(s => assignedSegs.add(s)));
        
        const unassigned = [...allSegNames].filter(s => !assignedSegs.has(s));
        if (unassigned.length > 0) {
            alert(`还有未分配的段: ${unassigned.join(', ')}`);
            return;
        }
        
        // 验证：每个分组至少有一个段
        const emptyGroups = this._splitGroups.filter(g => g.segments.length === 0);
        if (emptyGroups.length > 0) {
            alert('存在空分组，请删除或添加段');
            return;
        }
        
        // 验证：名称不能重复
        const names = this._splitGroups.map(g => g.name);
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        if (duplicates.length > 0) {
            alert(`元素名称重复: ${duplicates.join(', ')}`);
            return;
        }
        
        // 统计共用段
        const segUsageCount = {};
        allSegNames.forEach(s => segUsageCount[s] = 0);
        this._splitGroups.forEach(g => g.segments.forEach(s => segUsageCount[s]++));
        const sharedSegs = [...allSegNames].filter(s => segUsageCount[s] > 1);
        
        // 创建新元素（共用段会被复制到多个元素中）
        const newElements = this._splitGroups.map((group, i) => {
            const segs = elem.segments.filter(s => group.segments.includes(s.name));
            return {
                id: 'elem_' + Date.now() + '_' + i,
                name: group.name,
                type: segs.length === 1 ? 'icon' : elem.type,
                description: `从 ${elem.name} 拆分` + (sharedSegs.some(ss => group.segments.includes(ss)) ? ' (含共用段)' : ''),
                segments: segs.map(s => ({
                    name: s.name,
                    seg: s.seg,
                    com: s.com,
                    // 深拷贝 pixelMask，避免共用引用
                    pixelMask: new Set(s.pixelMask instanceof Set ? s.pixelMask : (s.pixelMask || s.pixels || [])),
                    pixelCount: s.pixelCount || (s.pixelMask?.size || s.pixels?.length || 0)
                }))
            };
        });
        
        // 移除原元素，添加新元素
        const idx = this.state.elements.findIndex(e => e.id === elem.id);
        this.state.elements.splice(idx, 1, ...newElements);
        
        // 关闭对话框
        document.querySelector('.seg-dialog-overlay')?.remove();
        
        // 清理
        this._splitElem = null;
        this._splitGroups = null;
        
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
        
        // 提示共用段信息
        if (sharedSegs.length > 0) {
            this.log(`⚠️ 共用段 ${sharedSegs.join(', ')} 已复制到多个元素，检测重叠时可忽略`, 'warning');
        }
        
        this.showToast(`已拆分为 ${newElements.length} 个元素`, 'success');
    },
    
    toggleElement(elemId, event) {
        // 阻止事件冒泡
        if (event) {
            event.stopPropagation();
        }
        
        console.log('%c[SegmentEditor] toggleElement: ' + elemId, 'color: #FF9800; font-weight: bold');
        console.log('  当前展开状态:', this.state.expandedElements.has(elemId));
        
        // 切换展开状态
        if (this.state.expandedElements.has(elemId)) {
            this.state.expandedElements.delete(elemId);
            console.log('  → 收起');
        } else {
            this.state.expandedElements.add(elemId);
            console.log('  → 展开');
        }
        
        // 直接更新DOM的class，不重新渲染整个树
        const group = document.querySelector(`.seg-element-group[data-id="${elemId}"]`);
        if (group) {
            const isExpanded = this.state.expandedElements.has(elemId);
            group.classList.toggle('expanded', isExpanded);
            
            // 更新chevron图标
            const chevron = group.querySelector('.chevron');
            if (chevron) {
                chevron.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
            }
            
            this.log(`${isExpanded ? '展开' : '收起'} 元素: ${elemId}`, 'info');
            console.log('%c[SegmentEditor] DOM更新完成, expanded=' + isExpanded, 'color: #4CAF50');
        } else {
            console.warn('[SegmentEditor] 未找到元素组:', elemId);
            this.log(`⚠️ 未找到元素组: ${elemId}`, 'warning');
        }
        
        // 更新选中状态（但不重新渲染树）
        if (this.state.selectedElement !== elemId) {
            this.state.selectedElement = elemId;
            this.state.selectedSegment = null;
            this.updateInfoPanel();
        }
    },
    
    selectSegment(elemId, segName) {
        this.state.selectedElement = elemId;
        this.state.selectedSegment = segName;
        // 自动展开选中的元素
        this.state.expandedElements.add(elemId);
        this.renderElementsTree();
        this.updateInfoPanel();
        this.renderMatrix();
        this.render();
        this.log(`选中段: ${elemId}.${segName}`, 'info');
    },
    
    clearSegmentPixels() {
        if (!this.state.selectedElement || !this.state.selectedSegment) {
            alert('请先选择一个段！');
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg || !seg.pixelMask || seg.pixelMask.size === 0) {
            alert('当前段没有像素');
            return;
        }
        
        if (confirm(`确定清除 ${elem.name}.${seg.name} 的 ${seg.pixelMask.size} 个像素吗？`)) {
            this.saveHistory(`清除段: ${elem.name}.${seg.name}`);
            seg.pixelMask.clear();
            this.updateInfoPanel();
            this.renderElementsTree();
            this.render();
            this.updateStatistics();
        }
    },
    
    // ========== 元素树渲染 ==========
    renderElementsTree() {
        const tree = document.getElementById('seg-elements-tree');
        if (!tree) {
            console.warn('[SegmentEditor] 未找到元素树容器 #seg-elements-tree');
            return;
        }
        
        let html = '';
        for (const elem of this.state.elements) {
            // 使用 expandedElements 集合来判断展开状态
            const isExpanded = this.state.expandedElements.has(elem.id);
            const totalSegs = elem.segments.length;
            const completedSegs = elem.segments.filter(s => s.pixelMask && s.pixelMask.size > 0).length;
            
            let statusIcon = '⚪';
            let statusClass = '';
            if (completedSegs === totalSegs && totalSegs > 0) {
                statusIcon = '✅';
                statusClass = 'completed';
            } else if (completedSegs > 0) {
                statusIcon = '🔶';
                statusClass = 'partial';
            }
            
            html += `
                <div class="seg-element-group ${isExpanded ? 'expanded' : ''}" data-id="${elem.id}">
                    <div class="seg-element-header" onclick="SegmentEditor.toggleElement('${elem.id}', event)">
                        <span class="chevron" style="transform:${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}">▶</span>
                        <span class="name">${elem.name}</span>
                        <span class="type-badge">${elem.type}</span>
                        <span class="status ${statusClass}">${statusIcon} ${completedSegs}/${totalSegs}</span>
                        ${totalSegs > 1 ? `<button class="btn-split" onclick="event.stopPropagation();SegmentEditor.splitElement('${elem.id}')" title="拆分为独立元素">✂️</button>` : ''}
                        <button class="btn-delete" onclick="event.stopPropagation();SegmentEditor.deleteElement('${elem.id}')">🗑️</button>
                    </div>
                    <div class="seg-segment-list">
            `;
            
            for (const seg of elem.segments) {
                const isSelected = this.state.selectedElement === elem.id && this.state.selectedSegment === seg.name;
                const hasPixels = seg.pixelMask && seg.pixelMask.size > 0;
                const hasPins = seg.com !== '' && seg.seg !== '';
                
                let segStatus = '⚪';
                let segStatusClass = '';
                if (hasPixels) {
                    segStatus = `✅ ${seg.pixelMask.size}px`;
                    segStatusClass = 'done';
                } else if (hasPins) {
                    segStatus = '⭕ 待圈选';
                    segStatusClass = 'ready';
                }
                
                const pinInfo = hasPins ? `SEG${seg.seg}:COM${seg.com}` : '-';
                
                html += `
                    <div class="seg-segment-row ${isSelected ? 'selected' : ''}" 
                         data-seg="${seg.name}"
                         onclick="SegmentEditor.selectSegment('${elem.id}', '${seg.name}')">
                        <span class="seg-name">${seg.name}</span>
                        <span class="seg-pin">${pinInfo}</span>
                        <span class="seg-status ${segStatusClass}">${segStatus}</span>
                    </div>
                `;
            }
            
            html += '</div></div>';
        }
        
        tree.innerHTML = html;
    },
    
    updateInfoPanel() {
        const elemSpan = document.getElementById('seg-info-element');
        const segSpan = document.getElementById('seg-info-segment');
        const pinSpan = document.getElementById('seg-info-pin');
        const pixelSpan = document.getElementById('seg-info-pixels');
        const renameBtn = document.getElementById('seg-rename-btn');
        const detailPanel = document.getElementById('seg-element-detail-panel');
        const detailList = document.getElementById('seg-element-segments-list');
        const detailCount = document.getElementById('seg-detail-count');
        
        if (!this.state.selectedElement) {
            if (elemSpan) elemSpan.textContent = '-';
            if (segSpan) segSpan.textContent = '-';
            if (pinSpan) pinSpan.textContent = '-';
            if (pixelSpan) pixelSpan.textContent = '0';
            if (renameBtn) renameBtn.style.display = 'none';
            if (detailPanel) detailPanel.style.display = 'none';
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        if (elemSpan) elemSpan.textContent = elem.name;
        if (renameBtn) renameBtn.style.display = 'inline-block';
        
        // 更新元素详情面板 - 显示所有绑定的段
        if (detailPanel && detailList) {
            detailPanel.style.display = 'block';
            const completedSegs = elem.segments.filter(s => s.pixelMask && s.pixelMask.size > 0).length;
            if (detailCount) detailCount.textContent = `(${completedSegs}/${elem.segments.length})`;
            
            let listHtml = '';
            for (const seg of elem.segments) {
                const isSelected = this.state.selectedSegment === seg.name;
                const hasPixels = seg.pixelMask && seg.pixelMask.size > 0;
                const hasPins = seg.com !== '' && seg.seg !== '';
                const pinInfo = hasPins ? `SEG${seg.seg}:COM${seg.com}` : '未分配';
                const pixelInfo = hasPixels ? `${seg.pixelMask.size}px` : '0px';
                
                listHtml += `
                    <div class="seg-detail-item ${isSelected ? 'selected' : ''}" 
                         onclick="SegmentEditor.selectSegment('${elem.id}', '${seg.name}')"
                         title="点击选中并高亮显示">
                        <span class="seg-detail-name">${seg.name}</span>
                        <span class="seg-detail-pin">${pinInfo}</span>
                        <span class="seg-detail-pixels ${hasPixels ? 'done' : ''}">${pixelInfo}</span>
                    </div>
                `;
            }
            detailList.innerHTML = listHtml;
        }
        
        if (this.state.selectedSegment) {
            const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
            if (seg) {
                if (segSpan) segSpan.textContent = seg.name;
                if (pinSpan) pinSpan.textContent = (seg.com !== '' && seg.seg !== '') ? `SEG${seg.seg}:COM${seg.com}` : '未分配';
                if (pixelSpan) pixelSpan.textContent = seg.pixelMask ? seg.pixelMask.size : 0;
            }
        } else {
            if (segSpan) segSpan.textContent = '-';
            if (pinSpan) pinSpan.textContent = '-';
            const totalPixels = elem.segments.reduce((sum, s) => sum + (s.pixelMask ? s.pixelMask.size : 0), 0);
            if (pixelSpan) pixelSpan.textContent = totalPixels;
        }
    },
    
    // 重命名选中的元素
    renameSelectedElement() {
        if (!this.state.selectedElement) {
            alert('请先选择一个元素');
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        const newName = prompt('请输入新的元素名称:', elem.name);
        if (newName && newName.trim() && newName !== elem.name) {
            const oldName = elem.name;
            elem.name = newName.trim();
            // 同时更新id以保持一致性
            const oldId = elem.id;
            elem.id = newName.trim();
            
            // 更新选中状态
            this.state.selectedElement = elem.id;
            if (this.state.expandedElements.has(oldId)) {
                this.state.expandedElements.delete(oldId);
                this.state.expandedElements.add(elem.id);
            }
            
            this.renderElementsTree();
            this.updateInfoPanel();
            this.log(`重命名元素: ${oldName} → ${newName}`, 'success');
        }
    },
    
    // 查找像素所属的元素和段
    findPixelOwner(x, y) {
        const pixelKey = `${x},${y}`;
        
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                if (seg.pixelMask.has(pixelKey)) {
                    // 找到了！
                    
                    // 如果在拾取模式，调用拾取方法
                    if (this.state.pickMode) {
                        this.pickSegment(elem, seg);
                        return;
                    }
                    
                    // 普通模式：选中该元素和段
                    this.state.selectedElement = elem.id;
                    this.state.selectedSegment = seg.name;
                    this.state.expandedElements.add(elem.id);
                    
                    this.renderElementsTree();
                    this.updateInfoPanel();
                    this.render();
                    
                    // 滚动到对应元素位置
                    this.scrollToElement(elem.id, seg.name);
                    
                    // 显示详细信息
                    const hasPins = seg.com !== '' && seg.seg !== '';
                    const pinInfo = hasPins ? `SEG${seg.seg}:COM${seg.com}` : '未分配';
                    
                    this.log(`🔍 找到: ${elem.name}.${seg.name} | ${pinInfo} | ${seg.pixelMask.size}像素`, 'success');
                    
                    // 弹出详细信息和操作选项
                    this.showFindResult(elem, seg, x, y);
                    return;
                }
            }
        }
        
        // 没找到
        this.log(`🔍 位置 (${x}, ${y}) 没有绑定到任何段`, 'warning');
    },
    
    // 滚动到指定元素位置
    scrollToElement(elemId, segName) {
        setTimeout(() => {
            const tree = document.getElementById('seg-elements-tree');
            if (!tree) return;
            
            // 先找元素头部 (使用 data-id 属性)
            const elemGroup = tree.querySelector(`.seg-element-group[data-id="${elemId}"]`);
            if (elemGroup) {
                const elemHeader = elemGroup.querySelector('.seg-element-header');
                if (elemHeader) {
                    elemHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            
            // 如果有段名，再滚动到段
            if (segName && elemGroup) {
                setTimeout(() => {
                    const segRow = elemGroup.querySelector(`.seg-segment-row[data-seg="${segName}"]`);
                    if (segRow) {
                        segRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 150);
            }
        }, 50);
    },
    
    // 显示查找结果 - 不弹窗，只在日志和面板显示
    showFindResult(elem, seg, x, y) {
        // 不弹窗，信息已经在日志中显示了
    },

    updateStatistics() {
        const elemCount = this.state.elements.length;
        const segCount = this.state.elements.reduce((sum, e) => sum + e.segments.length, 0);
        const completedCount = this.state.elements.reduce((sum, e) => 
            sum + e.segments.filter(s => s.pixelMask && s.pixelMask.size > 0).length, 0);
        
        const elemSpan = document.getElementById('seg-status-elements');
        const segSpan = document.getElementById('seg-status-segments');
        const completedSpan = document.getElementById('seg-status-completed');
        
        if (elemSpan) elemSpan.textContent = `元素:${elemCount}`;
        if (segSpan) segSpan.textContent = `段:${segCount}`;
        if (completedSpan) completedSpan.textContent = `已完成:${completedCount}`;
        
        // 自动保存状态（防止崩溃丢失数据）- 降低频率
        this.autoSave();
    },
    
    // ========== 像素重叠检测 ==========
    // 忽略重叠的元素对列表
    _ignoredOverlapPairs: new Set(),
    
    // 检测当前段与其他段的像素重叠
    checkPixelOverlap(currentElemId, currentSegName, ignoreList = null) {
        const currentElem = this.state.elements.find(e => e.id === currentElemId);
        if (!currentElem) return null;
        const currentSeg = currentElem.segments.find(s => s.name === currentSegName);
        if (!currentSeg || !currentSeg.pixelMask || currentSeg.pixelMask.size === 0) return null;
        
        const overlaps = [];
        const ignorePairs = ignoreList || this._ignoredOverlapPairs;
        
        // 遍历所有元素和段，检查重叠
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                // 跳过当前段自己
                if (elem.id === currentElemId && seg.name === currentSegName) continue;
                // 跳过没有像素的段
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                // 检查是否在忽略列表中
                const pairKey = [currentElemId + '.' + currentSegName, elem.id + '.' + seg.name].sort().join('|');
                if (ignorePairs.has(pairKey)) continue;
                
                // 计算重叠像素
                let overlapCount = 0;
                const overlapPixels = [];
                for (const pixel of currentSeg.pixelMask) {
                    if (seg.pixelMask.has(pixel)) {
                        overlapCount++;
                        if (overlapPixels.length < 10) { // 只记录前10个用于显示
                            overlapPixels.push(pixel);
                        }
                    }
                }
                
                if (overlapCount > 0) {
                    overlaps.push({
                        elemId: elem.id,
                        elemName: elem.name,
                        segName: seg.name,
                        overlapCount: overlapCount,
                        overlapPixels: overlapPixels,
                        totalPixels: seg.pixelMask.size,
                        pairKey: pairKey
                    });
                }
            }
        }
        
        return overlaps.length > 0 ? overlaps : null;
    },
    
    // 显示重叠警告（异步，不阻塞操作）
    showOverlapWarning(overlaps, currentElemName, currentSegName) {
        if (!overlaps || overlaps.length === 0) return;
        
        // 记录到日志
        this.log(`⚠️ 像素重叠: ${currentElemName}.${currentSegName} 与 ${overlaps.length} 个段重叠`, 'warning');
        
        // 使用setTimeout延迟显示，避免阻塞圈选操作
        setTimeout(() => {
            let msg = `⚠️ 检测到像素重叠！\n\n当前段: ${currentElemName}.${currentSegName}\n\n与以下段有重叠:\n`;
            for (const o of overlaps) {
                const percent = Math.round(o.overlapCount / o.totalPixels * 100);
                msg += `  • ${o.elemName}.${o.segName}: ${o.overlapCount}像素 (占${percent}%)\n`;
            }
            msg += `\n是否可能圈错了？\n点击"确定"查看第一个重叠段，点击"取消"忽略`;
            
            if (confirm(msg)) {
                // 跳转到第一个重叠的段
                const first = overlaps[0];
                this.state.selectedElement = first.elemId;
                this.state.selectedSegment = first.segName;
                this.state.expandedElements.add(first.elemId);
                this.renderElementsTree();
                this.updateInfoPanel();
                this.render();
                this.log(`跳转到重叠段: ${first.elemName}.${first.segName}`, 'info');
            }
        }, 100);
    },
    
    // 检测所有段的重叠情况（用于全局检查）- 带忽略选项
    checkAllOverlaps() {
        const allOverlaps = [];
        const checkedPairs = new Set();
        
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                const overlaps = this.checkPixelOverlap(elem.id, seg.name);
                if (overlaps) {
                    for (const o of overlaps) {
                        // 避免重复记录 A-B 和 B-A
                        const pairKey = [elem.id + '.' + seg.name, o.elemId + '.' + o.segName].sort().join('|');
                        if (!checkedPairs.has(pairKey)) {
                            checkedPairs.add(pairKey);
                            allOverlaps.push({
                                seg1: { elemId: elem.id, elemName: elem.name, segName: seg.name },
                                seg2: { elemId: o.elemId, elemName: o.elemName, segName: o.segName },
                                overlapCount: o.overlapCount,
                                pairKey: pairKey
                            });
                        }
                    }
                }
            }
        }
        
        if (allOverlaps.length === 0) {
            this.log('✅ 没有检测到像素重叠', 'success');
            alert('✅ 没有检测到像素重叠，所有段的像素都是独立的！');
        } else {
            // 显示带忽略选项的对话框
            this.showOverlapDialog(allOverlaps);
        }
        
        return allOverlaps;
    },
    
    // 显示重叠检测对话框（带忽略选项）
    showOverlapDialog(allOverlaps) {
        const dialog = document.createElement('div');
        dialog.className = 'seg-dialog-overlay';
        dialog.innerHTML = `
            <div class="seg-dialog" style="width:550px;max-height:80vh;">
                <div class="seg-dialog-header" style="background:#2a2a3a;color:#fff;">
                    <span>🔍 像素重叠检测 - 发现 ${allOverlaps.length} 对重叠</span>
                    <button class="seg-dialog-close" onclick="this.closest('.seg-dialog-overlay').remove()">×</button>
                </div>
                <div class="seg-dialog-body" style="max-height:60vh;overflow-y:auto;background:#1e1e2e;">
                    <div style="margin-bottom:12px;font-size:12px;color:#aaa;">
                        勾选要忽略的重叠对（如共用段），取消勾选的会被标记为问题。
                    </div>
                    <div id="overlap-list-container"></div>
                </div>
                <div class="seg-dialog-footer" style="background:#2a2a3a;">
                    <button class="seg-btn" style="background:#3a3a4a;color:#ddd;border:1px solid #5a5a6a;" onclick="SegmentEditor.ignoreAllOverlaps()">全部忽略</button>
                    <button class="seg-btn" style="background:#3a3a4a;color:#ddd;border:1px solid #5a5a6a;" onclick="SegmentEditor.clearIgnoredOverlaps()">清除忽略</button>
                    <button class="seg-btn primary" style="background:#4caf50;color:#fff;border:1px solid #4caf50;" onclick="this.closest('.seg-dialog-overlay').remove()">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this._currentOverlaps = allOverlaps;
        this.renderOverlapList();
    },
    
    // 渲染重叠列表
    renderOverlapList() {
        const container = document.getElementById('overlap-list-container');
        if (!container || !this._currentOverlaps) return;
        
        let html = '';
        this._currentOverlaps.forEach((o, i) => {
            const isIgnored = this._ignoredOverlapPairs.has(o.pairKey);
            html += `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isIgnored ? '#2a3a2a' : '#3a2a2a'};border-radius:4px;margin-bottom:6px;border:1px solid ${isIgnored ? '#4a5a4a' : '#5a3a3a'};">
                    <input type="checkbox" ${isIgnored ? 'checked' : ''} 
                           onchange="SegmentEditor.toggleIgnoreOverlap('${o.pairKey}', this.checked)"
                           style="width:16px;height:16px;">
                    <div style="flex:1;font-size:12px;">
                        <span style="color:${isIgnored ? '#8f8' : '#f88'};">${o.seg1.elemName}.${o.seg1.segName}</span>
                        <span style="color:#888;"> ↔ </span>
                        <span style="color:${isIgnored ? '#8f8' : '#f88'};">${o.seg2.elemName}.${o.seg2.segName}</span>
                    </div>
                    <span style="font-size:11px;color:#ff9800;">${o.overlapCount}px</span>
                    <button style="padding:2px 6px;font-size:10px;background:#3a3a4a;border:1px solid #5a5a6a;color:#ddd;border-radius:3px;cursor:pointer;"
                            onclick="SegmentEditor.jumpToOverlap(${i})">定位</button>
                </div>
            `;
        });
        
        const ignoredCount = [...this._ignoredOverlapPairs].filter(p => 
            this._currentOverlaps.some(o => o.pairKey === p)
        ).length;
        
        html = `
            <div style="margin-bottom:8px;font-size:11px;color:#888;">
                已忽略: ${ignoredCount} / ${this._currentOverlaps.length} 对
            </div>
        ` + html;
        
        container.innerHTML = html;
    },
    
    // 切换忽略状态
    toggleIgnoreOverlap(pairKey, ignored) {
        if (ignored) {
            this._ignoredOverlapPairs.add(pairKey);
        } else {
            this._ignoredOverlapPairs.delete(pairKey);
        }
        this.renderOverlapList();
        this.log(`${ignored ? '忽略' : '取消忽略'}重叠: ${pairKey}`, 'info');
    },
    
    // 忽略所有重叠
    ignoreAllOverlaps() {
        if (this._currentOverlaps) {
            this._currentOverlaps.forEach(o => this._ignoredOverlapPairs.add(o.pairKey));
            this.renderOverlapList();
            this.log(`已忽略所有 ${this._currentOverlaps.length} 对重叠`, 'success');
        }
    },
    
    // 清除所有忽略
    clearIgnoredOverlaps() {
        this._ignoredOverlapPairs.clear();
        this.renderOverlapList();
        this.log('已清除所有忽略设置', 'info');
    },
    
    // 跳转到重叠位置
    jumpToOverlap(index) {
        if (!this._currentOverlaps || !this._currentOverlaps[index]) return;
        const o = this._currentOverlaps[index];
        
        // 选中第一个段
        this.state.selectedElement = o.seg1.elemId;
        this.state.selectedSegment = o.seg1.segName;
        this.state.expandedElements.add(o.seg1.elemId);
        
        this.renderElementsTree();
        this.updateInfoPanel();
        this.render();
        this.scrollToElement(o.seg1.elemId, o.seg1.segName);
        
        this.log(`定位到: ${o.seg1.elemName}.${o.seg1.segName}`, 'info');
    },
    
    // 自动保存（防抖，2秒内只保存一次，减少性能影响）
    _autoSaveTimer: null,
    _lastSaveTime: 0,
    autoSave() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
        }
        
        // 限制保存频率，最多每5秒保存一次
        const now = Date.now();
        const minInterval = 5000;  // 5秒
        const delay = Math.max(2000, minInterval - (now - this._lastSaveTime));
        
        this._autoSaveTimer = setTimeout(() => {
            try {
                this.saveState();
                this._lastSaveTime = Date.now();
                console.log('[SegmentEditor] 自动保存完成');
            } catch (err) {
                console.error('[SegmentEditor] 自动保存失败:', err);
            }
        }, delay);
    },
    
    // ========== SEG×COM矩阵 ==========
    
    // 反向确认模式状态
    reverseMode: false,
    litSegment: null,  // { seg, com }
    scanning: false,
    
    renderMatrix() {
        const container = document.getElementById('seg-matrix-container');
        if (!container) return;
        
        const startSeg = parseInt(document.getElementById('seg-start')?.value) || 0;
        const endSeg = parseInt(document.getElementById('seg-end')?.value) || 27;
        
        const assignedPins = this.buildAssignedPinsMap();
        
        // 添加反向确认模式工具栏
        let html = `
        <div class="seg-matrix-toolbar" style="margin-bottom:10px;padding:8px;background:var(--input-bg);border-radius:4px;display:flex;align-items:center;gap:15px;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                <input type="checkbox" id="seg-reverse-mode" ${this.reverseMode ? 'checked' : ''}>
                <span style="font-size:12px;">🔍 反向确认模式</span>
            </label>
            <button id="seg-scan-all" class="seg-toolbar-btn" style="padding:4px 8px;font-size:11px;" title="逐个扫描所有SEG:COM">🔄 扫描全部</button>
            <span style="font-size:11px;color:var(--text-muted);">点击矩阵单元格点亮测试，右键编辑映射</span>
        </div>
        `;
        
        html += '<table class="seg-matrix-table"><thead><tr><th class="row-header">COM\\SEG</th>';
        for (let s = startSeg; s <= endSeg; s++) {
            html += `<th>SEG${s}</th>`;
        }
        html += '</tr></thead><tbody>';
        
        for (let c = 0; c < 8; c++) {
            html += `<tr><th class="row-header">COM${c}</th>`;
            for (let s = startSeg; s <= endSeg; s++) {
                const bit = this.comBitMap[c];
                const isOn = (this.state.segBuffer[s] & (1 << bit)) !== 0;
                const key = `${s}:${c}`;
                const assigned = assignedPins[key];
                const isLit = this.litSegment && this.litSegment.seg === s && this.litSegment.com === c;
                
                let cellClass = isOn ? 'on' : '';
                if (assigned) cellClass += ' assigned';
                if (isLit) cellClass += ' lit';
                
                const title = assigned ? `${assigned.elem}.${assigned.seg}\n点击点亮测试 | 右键编辑` : `未映射 SEG${s}:COM${c}\n点击点亮测试 | 右键添加映射`;
                const display = assigned ? assigned.seg.charAt(0) : (isOn ? '●' : '○');
                
                html += `<td class="${cellClass}" title="${title}" 
                            data-seg="${s}" data-com="${c}">${display}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        
        // 反向确认面板
        if (this.reverseMode && this.litSegment) {
            html += this.renderReverseConfirmPanel();
        }
        
        container.innerHTML = html;
        
        // 绑定事件
        this.bindMatrixEvents();
    },
    
    // 渲染反向确认面板
    renderReverseConfirmPanel() {
        const { seg, com } = this.litSegment;
        const assignedPins = this.buildAssignedPinsMap();
        const key = `${seg}:${com}`;
        const assigned = assignedPins[key];
        
        // 获取所有唯一的元素名
        const elements = [...new Set(this.state.elements.map(e => e.name))];
        
        // 找到当前映射的完整信息
        let currentElem = null, currentSeg = null;
        if (assigned) {
            currentElem = this.state.elements.find(e => e.name === assigned.elem);
            if (currentElem) {
                currentSeg = currentElem.segments.find(s => s.name === assigned.seg);
            }
        }
        
        return `
        <div class="seg-reverse-panel" style="margin-top:15px;padding:15px;background:#fff8e1;border:2px solid #ff9800;border-radius:8px;">
            <h4 style="margin:0 0 10px;color:#e65100;">🔍 反向确认: SEG${seg}:COM${com}</h4>
            <p style="font-size:12px;margin:5px 0;">当前映射: <strong style="color:${assigned ? '#4caf50' : '#f44336'}">${assigned ? assigned.elem + '.' + assigned.seg : '未映射'}</strong></p>
            <p style="font-size:11px;color:#666;margin:5px 0;">请观察LCD上亮起的段，选择或修改正确的元素:</p>
            
            <div style="display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center;margin:15px 0;">
                <label style="font-weight:bold;color:#666;font-size:12px;">元素名称:</label>
                <div style="display:flex;gap:5px;">
                    <select id="seg-reverse-element" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:4px;">
                        <option value="">-- 选择已有元素 --</option>
                        ${elements.map(e => `<option value="${e}" ${assigned && assigned.elem === e ? 'selected' : ''}>${e}</option>`).join('')}
                        <option value="__new__">+ 新建元素...</option>
                    </select>
                    <input type="text" id="seg-reverse-new-element" placeholder="新元素名" style="width:100px;padding:6px;border:1px solid #ddd;border-radius:4px;display:none;">
                </div>
                
                <label style="font-weight:bold;color:#666;font-size:12px;">段名称:</label>
                <input type="text" id="seg-reverse-segment" value="${assigned ? assigned.seg : 'A'}" placeholder="如: A, B, DP" style="padding:6px;border:1px solid #ddd;border-radius:4px;">
                
                <label style="font-weight:bold;color:#666;font-size:12px;">类型:</label>
                <select id="seg-reverse-type" style="padding:6px;border:1px solid #ddd;border-radius:4px;">
                    <option value="digit" ${currentElem && currentElem.type === 'digit' ? 'selected' : ''}>digit (数字)</option>
                    <option value="icon" ${currentElem && currentElem.type === 'icon' ? 'selected' : ''}>icon (图标)</option>
                    <option value="unit" ${currentElem && currentElem.type === 'unit' ? 'selected' : ''}>unit (单位)</option>
                </select>
                
                <label style="font-weight:bold;color:#666;font-size:12px;">描述:</label>
                <input type="text" id="seg-reverse-desc" value="${currentElem ? currentElem.description : ''}" placeholder="描述" style="padding:6px;border:1px solid #ddd;border-radius:4px;">
            </div>
            
            <div style="display:flex;gap:10px;margin-top:15px;">
                <button id="seg-reverse-confirm" style="flex:1;padding:8px 16px;background:#4caf50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">✓ 确认/修改映射</button>
                <button id="seg-reverse-skip" style="padding:8px 16px;background:#9e9e9e;color:white;border:none;border-radius:4px;cursor:pointer;">跳过</button>
                <button id="seg-reverse-delete" style="padding:8px 16px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;" ${assigned ? '' : 'disabled'}>🗑 删除</button>
            </div>
        </div>
        `;
    },
    
    // 绑定矩阵事件
    bindMatrixEvents() {
        // 反向确认模式切换
        const reverseCheckbox = document.getElementById('seg-reverse-mode');
        if (reverseCheckbox) {
            reverseCheckbox.addEventListener('change', (e) => {
                this.reverseMode = e.target.checked;
                if (!this.reverseMode) {
                    this.litSegment = null;
                    this.sendSegTest(0, 0, 0); // 熄灭
                }
                this.renderMatrix();
            });
        }
        
        // 扫描全部按钮
        const scanBtn = document.getElementById('seg-scan-all');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => this.startScanAll());
        }
        
        // 矩阵单元格事件
        const container = document.getElementById('seg-matrix-container');
        if (container) {
            container.querySelectorAll('td[data-seg]').forEach(cell => {
                const seg = parseInt(cell.dataset.seg);
                const com = parseInt(cell.dataset.com);
                
                // 左键点击：点亮测试
                cell.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (this.reverseMode) {
                        await this.lightAndConfirm(seg, com);
                    } else {
                        // 普通模式：点亮2秒后熄灭
                        await this.sendSegTest(seg, com, 1);
                        setTimeout(() => this.sendSegTest(0, 0, 0), 2000);
                    }
                });
                
                // 右键：快速编辑菜单
                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showQuickEditMenu(e, seg, com);
                });
            });
        }
        
        // 反向确认面板事件
        this.bindReverseConfirmEvents();
    },
    
    // 绑定反向确认面板事件
    bindReverseConfirmEvents() {
        const elementSelect = document.getElementById('seg-reverse-element');
        const newElementInput = document.getElementById('seg-reverse-new-element');
        const confirmBtn = document.getElementById('seg-reverse-confirm');
        const skipBtn = document.getElementById('seg-reverse-skip');
        const deleteBtn = document.getElementById('seg-reverse-delete');
        
        if (elementSelect) {
            elementSelect.addEventListener('change', () => {
                if (elementSelect.value === '__new__') {
                    newElementInput.style.display = 'block';
                    newElementInput.focus();
                } else {
                    newElementInput.style.display = 'none';
                }
            });
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmReverseMapping());
        }
        
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                this.litSegment = null;
                this.sendSegTest(0, 0, 0);
                this.renderMatrix();
            });
        }
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteCurrentMapping());
        }
    },
    
    // 点亮并等待确认
    async lightAndConfirm(seg, com) {
        this.log(`🔦 反向确认: 点亮 SEG${seg}:COM${com}`, 'info');
        console.log(`%c[SegmentEditor] 🔦 反向确认: 点亮 SEG${seg}:COM${com}`, 'color: #FF9800; font-weight: bold');
        
        // 先熄灭之前的
        if (this.litSegment) {
            this.log(`熄灭之前的 SEG${this.litSegment.seg}:COM${this.litSegment.com}`, 'info');
            await this.sendSegTest(0, 0, 0);
        }
        
        // 点亮新的
        this.litSegment = { seg, com };
        await this.sendSegTest(seg, com, 1);
        
        // 刷新显示
        this.renderMatrix();
    },
    
    // 确认反向映射（支持修改）
    confirmReverseMapping() {
        if (!this.litSegment) return;
        
        const elementSelect = document.getElementById('seg-reverse-element');
        const newElementInput = document.getElementById('seg-reverse-new-element');
        const segmentInput = document.getElementById('seg-reverse-segment');
        const typeSelect = document.getElementById('seg-reverse-type');
        const descInput = document.getElementById('seg-reverse-desc');
        
        let elementName = elementSelect.value;
        if (elementName === '__new__') {
            elementName = newElementInput.value.trim();
            if (!elementName) {
                alert('请输入新元素名称');
                return;
            }
        }
        if (!elementName) {
            alert('请选择或输入元素名称');
            return;
        }
        
        const segmentName = segmentInput.value.trim() || 'A';
        const type = typeSelect.value;
        const description = descInput.value.trim();
        
        const { seg, com } = this.litSegment;
        
        // 先删除旧的映射（如果存在）
        for (const elem of this.state.elements) {
            const idx = elem.segments.findIndex(s => 
                parseInt(s.seg) === seg && parseInt(s.com) === com
            );
            if (idx >= 0) {
                elem.segments.splice(idx, 1);
            }
        }
        
        // 清理空元素
        this.state.elements = this.state.elements.filter(e => e.segments.length > 0);
        
        // 查找或创建目标元素
        let targetElem = this.state.elements.find(e => e.name === elementName);
        if (!targetElem) {
            targetElem = {
                id: 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                name: elementName,
                type: type,
                description: description,
                segments: []
            };
            this.state.elements.push(targetElem);
        } else {
            // 更新元素类型和描述
            targetElem.type = type;
            targetElem.description = description;
        }
        
        // 添加新的段映射
        targetElem.segments.push({
            name: segmentName,
            seg: seg.toString(),
            com: com.toString(),
            pixelMask: new Set()
        });
        
        this.log(`✅ 映射更新: SEG${seg}:COM${com} → ${elementName}.${segmentName}`, 'success');
        console.log(`%c[SegmentEditor] ✅ 映射更新: SEG${seg}:COM${com} → ${elementName}.${segmentName}`, 'color: #4CAF50; font-weight: bold');
        
        // 熄灭并继续
        this.log(`熄灭测试段`, 'info');
        this.sendSegTest(0, 0, 0);
        this.litSegment = null;
        
        // 刷新所有视图
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
        
        // 保存历史
        this.saveHistory(`映射 SEG${seg}:COM${com} → ${elementName}.${segmentName}`);
    },
    
    // 删除当前映射
    deleteCurrentMapping() {
        if (!this.litSegment) return;
        
        const { seg, com } = this.litSegment;
        
        // 删除映射
        for (const elem of this.state.elements) {
            const idx = elem.segments.findIndex(s => 
                parseInt(s.seg) === seg && parseInt(s.com) === com
            );
            if (idx >= 0) {
                const removed = elem.segments.splice(idx, 1)[0];
                this.log(`🗑️ 删除映射: SEG${seg}:COM${com} (${elem.name}.${removed.name})`, 'warning');
                console.log(`[SegmentEditor] 删除映射: SEG${seg}:COM${com} (${elem.name}.${removed.name})`);
            }
        }
        
        // 清理空元素
        this.state.elements = this.state.elements.filter(e => e.segments.length > 0);
        
        this.sendSegTest(0, 0, 0);
        this.litSegment = null;
        
        this.renderElementsTree();
        this.renderMatrix();
        this.render();
        this.updateStatistics();
        
        this.saveHistory(`删除 SEG${seg}:COM${com} 映射`);
    },
    
    // 显示快速编辑菜单（右键）
    showQuickEditMenu(event, seg, com) {
        // 移除已有菜单
        document.querySelectorAll('.seg-context-menu').forEach(m => m.remove());
        
        const assignedPins = this.buildAssignedPinsMap();
        const key = `${seg}:${com}`;
        const assigned = assignedPins[key];
        
        const menu = document.createElement('div');
        menu.className = 'seg-context-menu';
        menu.style.cssText = 'position:fixed;background:var(--card-bg);border:1px solid var(--border-color);border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,0.2);z-index:1000;min-width:150px;';
        menu.innerHTML = `
            <div style="padding:8px 12px;background:var(--input-bg);font-weight:bold;border-bottom:1px solid var(--border-color);">SEG${seg}:COM${com}</div>
            ${assigned ? `<div style="padding:4px 12px;font-size:12px;color:var(--text-muted);background:var(--panel-bg);border-bottom:1px solid var(--border-color);">${assigned.elem}.${assigned.seg}</div>` : ''}
            <div class="seg-menu-item" data-action="light" style="padding:8px 12px;cursor:pointer;">💡 点亮测试</div>
            <div class="seg-menu-item" data-action="edit" style="padding:8px 12px;cursor:pointer;">✏️ 编辑映射</div>
            ${assigned ? `<div class="seg-menu-item" data-action="delete" style="padding:8px 12px;cursor:pointer;color:#f44336;">🗑 删除映射</div>` : ''}
        `;
        
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        document.body.appendChild(menu);
        
        // 添加hover效果
        menu.querySelectorAll('.seg-menu-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(33,150,243,0.1)');
            item.addEventListener('mouseleave', () => item.style.background = '');
        });
        
        // 绑定菜单事件
        menu.querySelectorAll('.seg-menu-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                menu.remove();
                
                switch (action) {
                    case 'light':
                        await this.sendSegTest(seg, com, 1);
                        setTimeout(() => this.sendSegTest(0, 0, 0), 2000);
                        break;
                    case 'edit':
                        this.reverseMode = true;
                        await this.lightAndConfirm(seg, com);
                        break;
                    case 'delete':
                        if (confirm(`确定删除 SEG${seg}:COM${com} 的映射？`)) {
                            this.litSegment = { seg, com };
                            this.deleteCurrentMapping();
                        }
                        break;
                }
            });
        });
        
        // 点击其他地方关闭菜单
        setTimeout(() => {
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }, 0);
    },
    
    // 扫描全部SEG:COM
    async startScanAll() {
        if (this.scanning) {
            this.scanning = false;
            alert('扫描已停止');
            return;
        }
        
        const startSeg = parseInt(document.getElementById('seg-start')?.value) || 0;
        const endSeg = parseInt(document.getElementById('seg-end')?.value) || 27;
        
        this.scanning = true;
        this.reverseMode = true;
        
        alert('开始扫描，点击"跳过"或"确认"继续下一个，再次点击"扫描全部"停止');
        
        for (let s = startSeg; s <= endSeg && this.scanning; s++) {
            for (let c = 0; c < 8 && this.scanning; c++) {
                await this.lightAndConfirm(s, c);
                
                // 等待用户操作
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (!this.litSegment || !this.scanning) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }
        }
        
        this.scanning = false;
        this.sendSegTest(0, 0, 0);
        console.log('[SegmentEditor] 扫描完成');
    },
    
    buildAssignedPinsMap() {
        const map = {};
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                if (seg.com !== '' && seg.seg !== '') {
                    const comNum = parseInt(seg.com);
                    const segNum = parseInt(seg.seg);
                    if (!isNaN(comNum) && !isNaN(segNum)) {
                        const key = `${segNum}:${comNum}`;
                        map[key] = { elem: elem.name, seg: seg.name };
                    }
                }
            }
        }
        return map;
    },
    
    toggleBit(segIdx, comIdx) {
        const bit = this.comBitMap[comIdx];
        this.state.segBuffer[segIdx] ^= (1 << bit);
        this.renderMatrix();
        this.renderBufferGrid();
    },
    
    renderBufferGrid() {
        const grid = document.getElementById('seg-buffer-grid');
        if (!grid) return;
        
        let html = '';
        for (let i = 0; i < 54; i++) {
            const val = this.state.segBuffer[i];
            const hex = val.toString(16).toUpperCase().padStart(2, '0');
            html += `
                <div class="seg-buffer-cell" onclick="SegmentEditor.selectBufferCell(${i})">
                    <span class="idx">${i}</span>
                    <span class="val">${hex}</span>
                </div>
            `;
        }
        grid.innerHTML = html;
    },
    
    selectBufferCell(idx) {
        const startInput = document.getElementById('seg-start');
        const endInput = document.getElementById('seg-end');
        if (startInput && endInput) {
            const start = Math.max(0, idx - 5);
            const end = Math.min(53, idx + 5);
            startInput.value = start;
            endInput.value = end;
            this.renderMatrix();
        }
    },
    
    applyManualPin() {
        if (!this.state.selectedElement || !this.state.selectedSegment) {
            alert('请先选择一个段');
            return;
        }
        
        const segIdx = parseInt(document.getElementById('seg-manual-seg')?.value);
        const comIdx = document.getElementById('seg-manual-com')?.value;
        
        if (isNaN(segIdx) || segIdx < 0 || segIdx > 53) {
            alert('SEG索引必须在0-53之间');
            return;
        }
        
        if (!comIdx) {
            alert('请选择COM');
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg) return;
        
        seg.seg = segIdx.toString();
        seg.com = comIdx;
        
        this.renderElementsTree();
        this.renderMatrix();
        this.updateInfoPanel();
    },

    // ========== 固件同步 ==========
    async syncFromFirmware() {
        try {
            const result = await API.call('lcd_dump');
            if (result.success && result.buffer) {
                this.state.segBuffer = new Uint8Array(result.buffer);
                this.renderMatrix();
                this.renderBufferGrid();
                
                const dot = document.getElementById('seg-status-dot');
                const device = document.getElementById('seg-status-device');
                if (dot) dot.classList.remove('offline');
                if (device) device.textContent = '已连接';
                
                console.log('[SegmentEditor] 固件同步成功');
            } else {
                throw new Error(result.error || '同步失败');
            }
        } catch (err) {
            console.error('[SegmentEditor] 固件同步失败:', err);
            const dot = document.getElementById('seg-status-dot');
            const device = document.getElementById('seg-status-device');
            if (dot) dot.classList.add('offline');
            if (device) device.textContent = '未连接';
            alert('同步失败: ' + err.message);
        }
    },
    
    // ========== 导入导出 ==========
    importCSV() {
        const input = document.getElementById('seg-csv-input');
        if (input) input.click();
    },
    
    onCSVSelected(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.parseCSV(e.target.result);
        };
        reader.readAsText(file, 'UTF-8');
    },
    
    parseCSV(text) {
        // 过滤空行和注释行
        const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
        if (lines.length < 2) {
            alert('CSV格式错误');
            return;
        }
        
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const colMap = {};
        headers.forEach((h, i) => {
            // 支持多种列名格式
            if (h.includes('elementname') || h.includes('element') || h.includes('元素')) colMap.element = i;
            else if (h.includes('type') || h.includes('类型')) colMap.type = i;
            else if (h.includes('description') || h.includes('说明')) colMap.description = i;
            else if (h === 'segment' || h.includes('段名') || h === 'seg_name') colMap.segment = i;
            else if (h === 'com') colMap.com = i;
            else if (h === 'seg') colMap.seg = i;
            else if (h.includes('pixelcount') || h.includes('像素')) colMap.pixelCount = i;
        });
        
        if (colMap.element === undefined || colMap.segment === undefined) {
            alert('CSV必须包含"ElementName"和"Segment"列');
            return;
        }
        
        const elementsMap = new Map();
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            const elemName = cols[colMap.element] || '';
            const segName = cols[colMap.segment] || '';
            const com = cols[colMap.com] || '';
            const seg = cols[colMap.seg] || '';
            const type = cols[colMap.type] || 'icon';
            const description = colMap.description !== undefined ? cols[colMap.description] || '' : '';
            
            if (!elemName || !segName) continue;
            
            if (!elementsMap.has(elemName)) {
                elementsMap.set(elemName, {
                    id: 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                    name: elemName,
                    type: type,
                    description: description,
                    segments: []
                });
            }
            
            elementsMap.get(elemName).segments.push({
                name: segName,
                seg: seg,
                com: com,
                pixelMask: new Set()
            });
        }
        
        this.state.elements = Array.from(elementsMap.values());
        this.renderElementsTree();
        this.renderMatrix();
        this.updateStatistics();
        
        // 保存初始状态
        this.state.history = [];
        this.state.historyIndex = -1;
        this.saveHistory('CSV导入');
        
        alert(`导入成功: ${this.state.elements.length}个元素`);
    },
    
    // 导出CSV映射表
    exportCSV() {
        if (this.state.elements.length === 0) {
            alert('没有映射数据可导出');
            return;
        }
        
        // CSV头
        let csv = 'ElementName,Type,Description,Segment,COM,SEG,PixelCount\n';
        
        // 收集所有段并排序
        const allSegments = [];
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                allSegments.push({
                    element: elem.name,
                    type: elem.type,
                    description: elem.description,
                    segment: seg.name,
                    com: seg.com,
                    seg: seg.seg,
                    pixelCount: seg.pixelMask ? seg.pixelMask.size : 0
                });
            }
        }
        
        // 按元素名和段名排序
        allSegments.sort((a, b) => {
            if (a.element !== b.element) return a.element.localeCompare(b.element);
            return a.segment.localeCompare(b.segment);
        });
        
        // 生成CSV内容
        for (const seg of allSegments) {
            csv += `${seg.element},${seg.type},${seg.description},${seg.segment},${seg.com},${seg.seg},${seg.pixelCount}\n`;
        }
        
        const deviceId = document.getElementById('seg-device-select')?.value || 'gd303_mini';
        
        // 通过 /api/call 调用后端方法保存到本地data目录
        fetch('/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                method: 'lcd_mapping_save', 
                params: [deviceId, csv] 
            })
        })
        .then(r => r.json())
        .then(result => {
            if (result.success) {
                this.log(`✅ CSV已保存到: ${result.path} (${result.count}个段)`, 'success');
            } else {
                this.log(`❌ 保存失败: ${result.error || '未知错误'}`, 'error');
                // 失败时降级为浏览器下载
                this._downloadFile(csv, `${deviceId}_lcd_mapping.csv`, 'text/csv');
            }
        })
        .catch(err => {
            this.log(`❌ 保存失败: ${err.message}，改为下载`, 'error');
            this._downloadFile(csv, `${deviceId}_lcd_mapping.csv`, 'text/csv');
        });
    },
    
    // 浏览器下载文件（备用）
    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.log(`📥 已下载: ${filename}`, 'info');
    },
    
    exportConfig() {
        const deviceId = document.getElementById('seg-device-select')?.value || 'gd303_mini';
        
        const elements = this.state.elements.map(elem => ({
            id: elem.id,
            name: elem.name,
            type: elem.type,
            description: elem.description,
            segments: elem.segments.map(seg => ({
                name: seg.name,
                seg: seg.seg,
                com: seg.com,
                pixelCount: seg.pixelMask ? seg.pixelMask.size : 0,
                pixels: seg.pixelMask ? Array.from(seg.pixelMask) : []
            }))
        }));
        
        // 通过 /api/call 调用后端方法保存到本地data目录
        fetch('/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                method: 'lcd_elements_save', 
                params: [deviceId, elements] 
            })
        })
        .then(r => r.json())
        .then(result => {
            if (result.success) {
                this.log(`✅ 元素JSON已保存到: ${result.path} (${result.count}个元素)`, 'success');
            } else {
                this.log(`❌ 保存失败: ${result.error || '未知错误'}`, 'error');
                // 失败时降级为浏览器下载
                const config = {
                    device: deviceId,
                    bufferSize: 54,
                    generatedAt: new Date().toISOString(),
                    elements: elements,
                    buffer: Array.from(this.state.segBuffer)
                };
                this._downloadFile(JSON.stringify(config, null, 2), `lcd_config_${deviceId}.json`, 'application/json');
            }
        })
        .catch(err => {
            this.log(`❌ 保存失败: ${err.message}，改为下载`, 'error');
            const config = {
                device: deviceId,
                bufferSize: 54,
                generatedAt: new Date().toISOString(),
                elements: elements,
                buffer: Array.from(this.state.segBuffer)
            };
            this._downloadFile(JSON.stringify(config, null, 2), `lcd_config_${deviceId}.json`, 'application/json');
        });
    },
    
    exportPixelMap() {
        if (!this.state.image) {
            alert('请先加载LCD图片！');
            return;
        }
        
        const pixelMap = {
            metadata: {
                imageWidth: this.state.imageNaturalW,
                imageHeight: this.state.imageNaturalH,
                generatedAt: new Date().toISOString(),
                totalElements: this.state.elements.length
            },
            elements: {}
        };
        
        let totalPixels = 0;
        let exportedCount = 0;
        
        for (const elem of this.state.elements) {
            for (const seg of elem.segments) {
                if (seg.pixelMask && seg.pixelMask.size > 0) {
                    const key = `${elem.name}_${seg.name}`;
                    const pixels = Array.from(seg.pixelMask).map(coordStr => {
                        const [x, y] = coordStr.split(',').map(Number);
                        return [x, y];
                    });
                    
                    pixelMap.elements[key] = {
                        elementName: elem.name,
                        elementType: elem.type,
                        segmentName: seg.name,
                        com: seg.com,
                        seg: seg.seg,
                        pixelCount: pixels.length,
                        pixels: pixels
                    };
                    
                    totalPixels += pixels.length;
                    exportedCount++;
                }
            }
        }
        
        pixelMap.metadata.totalExportedSegments = exportedCount;
        pixelMap.metadata.totalPixels = totalPixels;
        
        const blob = new Blob([JSON.stringify(pixelMap, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pixelMap.json';
        a.click();
        URL.revokeObjectURL(url);
        
        alert(`像素映射导出成功！\n\n已导出 ${exportedCount} 个段\n总像素数: ${totalPixels}`);
    },
    
    exportCCode() {
        if (this.state.elements.length === 0) {
            alert('请先导入CSV表格或添加元素！');
            return;
        }
        
        // 生成头文件
        let headerCode = `/*
 * lcd_config.h
 * 断码屏LCD配置头文件
 * 自动生成于: ${new Date().toLocaleString('zh-CN')}
 */

#ifndef LCD_CONFIG_H
#define LCD_CONFIG_H

#include <stdint.h>

`;
        
        // 数码管定义
        const digits = this.state.elements.filter(e => e.type === 'digit');
        if (digits.length > 0) {
            headerCode += `/* 数码管定义 (${digits.length}位) */\n`;
            digits.forEach((elem, idx) => {
                headerCode += `#define DIGIT_${idx + 1}_POS  ${idx}  // ${elem.name}\n`;
            });
            headerCode += '\n';
        }
        
        // 图标定义
        const icons = this.state.elements.filter(e => e.type === 'icon');
        if (icons.length > 0) {
            headerCode += `/* 图标定义 (${icons.length}个) */\n`;
            icons.forEach(elem => {
                const seg = elem.segments[0];
                if (seg && seg.com !== '' && seg.seg !== '') {
                    headerCode += `#define ICON_${elem.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}  {${seg.com}, ${seg.seg}}  // ${elem.description || elem.name}\n`;
                }
            });
            headerCode += '\n';
        }
        
        headerCode += `#endif /* LCD_CONFIG_H */\n`;
        
        // 下载
        const blob = new Blob([headerCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lcd_config.h';
        a.click();
        URL.revokeObjectURL(url);
        
        alert('C代码已导出！');
    },
    
    // ========== 保存/加载工作进度 ==========
    
    /**
     * 保存项目到后端 (优先) 或下载
     * 项目文件格式: .lcd (JSON)
     * 包含: 图片(base64) + 元素配置 + SEG:COM映射
     */
    async saveProject() {
        // 安全检查：防止意外覆盖有数据的配置
        if (this.state.elements.length === 0) {
            const confirmSave = confirm(
                '⚠️ 警告：当前没有元素数据！\n\n' +
                '如果继续保存，可能会覆盖已有的配置文件。\n' +
                '请确认是否要保存空配置？\n\n' +
                '点击"取消"可以先加载已有配置。'
            );
            if (!confirmSave) {
                this.log('保存已取消（元素为空）', 'warning');
                return;
            }
        }
        
        // 额外安全检查：如果元素数量异常少，给出警告
        if (this.state.elements.length > 0 && this.state.elements.length < 10) {
            const totalPixels = this.state.elements.reduce((sum, elem) => {
                return sum + elem.segments.reduce((s, seg) => s + (seg.pixelMask?.size || 0), 0);
            }, 0);
            if (totalPixels === 0) {
                const confirmSave = confirm(
                    `⚠️ 警告：当前有 ${this.state.elements.length} 个元素，但没有像素数据！\n\n` +
                    '这可能意味着数据加载不完整。\n' +
                    '确定要保存吗？'
                );
                if (!confirmSave) {
                    this.log('保存已取消（像素数据为空）', 'warning');
                    return;
                }
            }
        }
        
        // 获取设备型号 - 优先使用 DeviceConfigManager
        const device = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
        
        // 准备图像数据
        let imageBase64 = null;
        if (this.state.image) {
            try {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = this.state.imageNaturalW;
                tempCanvas.height = this.state.imageNaturalH;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(this.state.image, 0, 0);
                imageBase64 = tempCanvas.toDataURL('image/png');
            } catch (err) {
                console.error('图像转换失败:', err);
            }
        }
        
        const projectData = {
            device: device,
            saveTime: new Date().toISOString(),
            image: imageBase64,
            imageWidth: this.state.imageNaturalW,
            imageHeight: this.state.imageNaturalH,
            elements: this.state.elements.map(elem => ({
                ...elem,
                segments: elem.segments.map(seg => ({
                    name: seg.name,
                    seg: seg.seg,
                    com: seg.com,
                    pixelCount: seg.pixelMask ? seg.pixelMask.size : 0,
                    // 保存为 pixels 数组（与 project.json 格式一致）
                    pixels: Array.from(seg.pixelMask || [])
                }))
            }))
        };
        
        // 优先使用 DeviceConfigManager 保存
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            try {
                this.log(`保存项目到设备配置: ${device}...`);
                await DeviceConfigManager.saveLcdProject(projectData, device);
                this.log(`✅ 项目已保存到设备配置: ${device}`, 'success');
                return;
            } catch (err) {
                this.log(`❌ DeviceConfigManager保存失败: ${err.message}，尝试直接API`, 'warning');
            }
        }
        
        // 降级：尝试保存到后端
        try {
            this.log(`保存项目到后端: ${device}.lcd ...`);
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    method: 'lcd_project_save', 
                    params: [device, projectData] 
                })
            });
            const result = await response.json();
            
            if (result.success) {
                this.log(`✅ 项目已保存: ${result.path} (${result.count} 个元素, ${result.size})`, 'success');
                alert(`项目已保存到: data/lcd_projects/${device}.lcd`);
                return;
            } else {
                throw new Error(result.error || '保存失败');
            }
        } catch (err) {
            this.log(`❌ 保存到后端失败: ${err.message}，改为下载`, 'warning');
        }
        
        // 降级为浏览器下载
        const fullProject = {
            version: '1.0',
            device: device,
            savedAt: new Date().toISOString(),
            ...projectData
        };
        
        const blob = new Blob([JSON.stringify(fullProject, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${device}.lcd`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.log(`📥 已下载: ${device}.lcd`, 'info');
    },
    
    /**
     * 从后端加载项目或选择本地文件
     */
    async loadProject() {
        // 优先使用 DeviceConfigManager
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            const deviceId = DeviceConfigManager.getCurrentDevice();
            try {
                this.log(`从设备配置加载: ${deviceId}...`);
                const lcdProject = await DeviceConfigManager.loadLcdProject(deviceId);
                if (lcdProject && lcdProject.elements) {
                    this.applyProjectData(lcdProject);
                    this.log(`✅ 项目加载成功: ${deviceId} (${lcdProject.elements.length} 个元素)`, 'success');
                    return;
                }
            } catch (err) {
                this.log(`DeviceConfigManager加载失败: ${err.message}，尝试其他方式`, 'warning');
            }
        }
        
        // 降级：尝试从后端加载项目列表
        try {
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_project_list', params: [] })
            });
            const result = await response.json();
            
            if (result.success && result.projects && result.projects.length > 0) {
                // 显示项目选择对话框
                const projectList = result.projects.map(p => 
                    `${p.device} (${p.elementCount}个元素${p.hasImage ? ', 含图片' : ''})`
                ).join('\n');
                
                const choice = prompt(
                    `发现 ${result.projects.length} 个项目文件:\n${projectList}\n\n` +
                    `输入设备名加载，或留空选择本地文件:`,
                    result.projects[0].device
                );
                
                if (choice === null) return;  // 取消
                
                if (choice.trim()) {
                    // 从后端加载
                    await this.loadProjectFromServer(choice.trim());
                    return;
                }
            }
        } catch (err) {
            console.warn('[SegmentEditor] 获取项目列表失败:', err);
        }
        
        // 选择本地文件
        const input = document.getElementById('seg-project-input');
        if (input) input.click();
    },
    
    /**
     * 从后端加载项目
     */
    async loadProjectFromServer(device) {
        try {
            this.log(`从后端加载项目: ${device}.lcd ...`);
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_project_load', params: [device] })
            });
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || '加载失败');
            }
            
            const projectData = result.project;
            this.applyProjectData(projectData);
            this.log(`✅ 项目加载成功: ${device} (${projectData.elements?.length || 0} 个元素)`, 'success');
            
        } catch (err) {
            this.log(`❌ 加载失败: ${err.message}`, 'error');
            alert('加载失败: ' + err.message);
        }
    },
    
    /**
     * 应用项目数据到编辑器
     */
    applyProjectData(projectData) {
        if (!projectData.elements || !Array.isArray(projectData.elements)) {
            throw new Error('无效的项目文件！');
        }
        
        // 恢复元素数据
        // 注意: project.json 中像素数据存储为 "pixels" 数组，需要转换为 "pixelMask" Set
        this.state.elements = projectData.elements.map(elem => ({
            ...elem,
            segments: elem.segments.map(seg => ({
                ...seg,
                // 优先使用 pixels 数组（project.json格式），其次使用 pixelMask（localStorage格式）
                pixelMask: new Set(seg.pixels || seg.pixelMask || [])
            }))
        }));
        
        console.log('[SegmentEditor] applyProjectData: 加载了', this.state.elements.length, '个元素');
        if (this.state.elements.length > 0) {
            const firstElem = this.state.elements[0];
            console.log('[SegmentEditor] 第一个元素:', firstElem.name, '段数:', firstElem.segments.length);
            if (firstElem.segments.length > 0) {
                console.log('[SegmentEditor] 第一个段像素数:', firstElem.segments[0].pixelMask.size);
            }
        }
        
        // 恢复图像
        if (projectData.image) {
            const img = new Image();
            img.onload = () => {
                this.state.image = img;
                this.state.imageNaturalW = projectData.imageWidth || img.naturalWidth;
                this.state.imageNaturalH = projectData.imageHeight || img.naturalHeight;
                
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.naturalWidth;
                tempCanvas.height = img.naturalHeight;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(img, 0, 0);
                this.state.imageData = tempCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
                
                this.renderElementsTree();
                this.renderMatrix();
                this.render();
                this.updateStatistics();
                
                this.state.history = [];
                this.state.historyIndex = -1;
                this.saveHistory('加载项目');
            };
            img.src = projectData.image;
        } else {
            this.renderElementsTree();
            this.renderMatrix();
            this.render();
            this.updateStatistics();
        }
        
        // 更新设备选择
        const deviceSelect = document.getElementById('seg-device-select');
        if (deviceSelect && projectData.device) {
            deviceSelect.value = projectData.device;
        }
    },
    
    onProjectSelected(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const projectData = JSON.parse(e.target.result);
                this.applyProjectData(projectData);
                this.log(`✅ 本地项目加载成功: ${file.name}`, 'success');
                alert('项目加载成功！');
            } catch (err) {
                this.log(`❌ 加载失败: ${err.message}`, 'error');
                alert('加载失败：' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
    },
    
    loadDevice(device) {
        console.log('[SegmentEditor] 加载设备:', device);
        this.loadDefaultElements();
        this.renderElementsTree();
        this.renderMatrix();
    },
    
    // ========== 段码测试功能 (0xC8命令) ==========
    
    /**
     * 发送段码测试命令 (简化别名)
     * @param {number} seg SEG索引 (0-53)
     * @param {number} com COM索引 (0-7)
     * @param {number} mode 模式: 0=清屏后点亮, 1=叠加, 2=熄灭, 0xFF=全显
     */
    async sendSegTest(seg, com, mode) {
        return await this.sendSegTestCommand(seg, com, mode);
    },
    
    /**
     * 发送段码测试命令
     * @param {number} seg SEG索引 (0-53)
     * @param {number} com COM索引 (0-7)
     * @param {number} mode 模式: 0=清屏后点亮, 1=叠加, 2=熄灭, 0xFF=全显
     */
    async sendSegTestCommand(seg, com, mode) {
        // 检查串口连接
        if (typeof DeviceHub === 'undefined' || !DeviceHub.isSerialConnected()) {
            this.log('⚠️ 串口未连接，无法发送测试命令', 'warning');
            console.warn('[SegmentEditor] 串口未连接');
            return false;
        }
        
        // 构建命令: AA EE C8 [seg] [com] [mode] 00 [xor] BB FF
        const cmd = [0xAA, 0xEE, 0xC8, seg & 0xFF, com & 0xFF, mode & 0xFF, 0x00];
        let xor = 0xC8 ^ (seg & 0xFF) ^ (com & 0xFF) ^ (mode & 0xFF) ^ 0x00;
        cmd.push(xor, 0xBB, 0xFF);
        
        const hexStr = cmd.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        const modeDesc = mode === 0 ? '清屏点亮' : mode === 1 ? '叠加' : mode === 2 ? '熄灭' : mode === 0xFF ? '全显' : `mode=${mode}`;
        
        this.log(`发送: SEG${seg}:COM${com} [${modeDesc}]`, 'send');
        console.log(`%c[SegmentEditor] 📡 发送段码测试命令`, 'color: #9C27B0; font-weight: bold');
        console.log(`  SEG: ${seg}, COM: ${com}, 模式: ${modeDesc}`);
        console.log(`  HEX: ${hexStr}`);
        
        try {
            await DeviceHub.serialSend(cmd);
            this.log(`✓ 命令发送成功`, 'success');
            console.log(`%c[SegmentEditor] ✅ 命令发送成功`, 'color: #4CAF50');
            return true;
        } catch (err) {
            this.log(`✗ 发送失败: ${err.message}`, 'error');
            console.error('[SegmentEditor] ❌ 发送失败:', err);
            return false;
        }
    },
    
    /**
     * 测试选中的段
     */
    async testSelectedSegment() {
        if (!this.state.selectedElement || !this.state.selectedSegment) {
            alert('请先在左侧选择一个段');
            return;
        }
        
        const elem = this.state.elements.find(e => e.id === this.state.selectedElement);
        if (!elem) return;
        
        const seg = elem.segments.find(s => s.name === this.state.selectedSegment);
        if (!seg) return;
        
        if (seg.seg === undefined || seg.com === undefined) {
            alert(`段 ${elem.name}.${seg.name} 未分配SEG:COM引脚！\n请先在矩阵中分配引脚。`);
            return;
        }
        
        console.log(`%c[SegmentEditor] 🔍 测试选中段: ${elem.name}.${seg.name}`, 'color: #2196F3; font-weight: bold');
        
        // 发送测试命令 (mode=0: 清屏后只点亮这一个)
        const success = await this.sendSegTestCommand(seg.seg, seg.com, 0);
        if (success) {
            console.log(`[SegmentEditor] 测试段: ${elem.name}.${seg.name} = SEG${seg.seg}:COM${seg.com}`);
        }
    },
    
    /**
     * 全显模式
     */
    async testFullDisplay() {
        await this.sendSegTestCommand(0, 0, 0xFF);
    },
    
    /**
     * 清屏
     */
    async testClearDisplay() {
        // 使用mode=0xFE专门的清屏命令
        await this.sendSegTestCommand(0, 0, 0xFE);
    },
    
    /**
     * 退出段码测试模式
     * 恢复正常UI刷新
     */
    async exitTestMode() {
        await this.sendSegTestCommand(0, 0, 0xFD);
        this.log('✅ 已退出段码测试模式，恢复正常UI显示');
    },
    
    /**
     * 根据SEG:COM查找对应的元素和段
     * @returns {Object|null} { elemId, elemName, segName } 或 null
     */
    findElementBySegCom(seg, com) {
        for (const elem of this.state.elements) {
            for (const s of elem.segments) {
                if (parseInt(s.seg) === seg && parseInt(s.com) === com) {
                    return { elemId: elem.id, elemName: elem.name, segName: s.name };
                }
            }
        }
        return null;
    },
    
    /**
     * 手动测试指定SEG:COM
     * 支持自动递增：测试后自动跳到下一个COM，COM到7后跳到下一个SEG
     * 同时自动选中左边元素列表中对应的元素和段
     */
    async testManualSegment() {
        const segInput = document.getElementById('seg-test-seg');
        const comInput = document.getElementById('seg-test-com');
        const autoIncCheckbox = document.getElementById('seg-test-auto-inc');
        const overlayCheckbox = document.getElementById('seg-test-overlay');
        
        const seg = parseInt(segInput?.value || '0');
        const com = parseInt(comInput?.value || '0');
        const autoInc = autoIncCheckbox?.checked ?? true;
        const overlay = overlayCheckbox?.checked ?? true;
        
        if (seg < 0 || seg > 53) {
            alert('SEG范围: 0-53');
            return;
        }
        if (com < 0 || com > 7) {
            alert('COM范围: 0-7');
            return;
        }
        
        // 发送测试命令
        const mode = overlay ? 1 : 0;  // 1=叠加, 0=清屏后点亮
        await this.sendSegTestCommand(seg, com, mode);
        
        // 查找并选中左边对应的元素和段
        const found = this.findElementBySegCom(seg, com);
        if (found) {
            // 自动展开并选中
            this.state.selectedElement = found.elemId;
            this.state.selectedSegment = found.segName;
            this.state.expandedElements.add(found.elemId);
            this.renderElementsTree();
            this.updateInfoPanel();
            this.render();
            this.log(`✅ SEG${seg}:COM${com} → ${found.elemName}.${found.segName}`, 'success');
        } else {
            // 未找到映射，清除选中状态并提示
            this.state.selectedElement = null;
            this.state.selectedSegment = null;
            this.renderElementsTree();
            this.updateInfoPanel();
            this.render();
            this.log(`⚠️ SEG${seg}:COM${com} 未映射到任何元素`, 'warning');
        }
        
        // 自动递增
        if (autoInc) {
            let nextSeg = seg;
            let nextCom = com + 1;
            
            // COM到8后，跳到下一个SEG的COM0
            if (nextCom > 7) {
                nextCom = 0;
                nextSeg = seg + 1;
            }
            
            // SEG到54后，回到0
            if (nextSeg > 53) {
                nextSeg = 0;
                nextCom = 0;
            }
            
            // 更新输入框
            if (segInput) segInput.value = nextSeg;
            if (comInput) comInput.value = nextCom;
        }
    },
    
    /**
     * 切换标签显示
     */
    toggleLabels(show) {
        if (show) {
            // 如果"只显示选中"被勾选，则用selected模式，否则用all模式
            const onlySelected = document.getElementById('seg-only-selected-label')?.checked;
            this.state.labelMode = onlySelected ? 'selected' : 'all';
        } else {
            this.state.labelMode = 'none';
        }
        this.render();
        this.log(`标签模式: ${this.state.labelMode}`, 'info');
    },
    
    /**
     * 切换只显示选中标签
     */
    toggleOnlySelectedLabel(onlySelected) {
        const showLabels = document.getElementById('seg-show-labels')?.checked;
        if (!showLabels) {
            this.state.labelMode = 'none';
        } else {
            this.state.labelMode = onlySelected ? 'selected' : 'all';
        }
        this.render();
        this.log(`标签模式: ${this.state.labelMode}`, 'info');    },
    
    /**
     * 从矩阵单元格测试
     */
    async testFromMatrix(seg, com) {
        await this.sendSegTestCommand(seg, com, 1);  // mode=1: 叠加点亮
    },
    
    /**
     * 快速修改当前SEG:COM对应的元素信息
     * SEG:COM映射不变，只修改元素名和段名
     */
    quickEditCurrentMapping() {
        const segInput = document.getElementById('seg-test-seg');
        const comInput = document.getElementById('seg-test-com');
        
        const seg = parseInt(segInput?.value || '0');
        const com = parseInt(comInput?.value || '0');
        
        // 查找当前映射
        const found = this.findElementBySegCom(seg, com);
        if (!found) {
            alert(`SEG${seg}:COM${com} 还没有映射，请先添加映射！`);
            return;
        }
        
        // 获取当前元素和段的完整信息
        const currentElem = this.state.elements.find(e => e.id === found.elemId);
        const currentSeg = currentElem?.segments.find(s => s.name === found.segName);
        
        // 获取所有已有的元素名（用于下拉选择）
        const existingElements = [...new Set(this.state.elements.map(e => e.name))];
        
        // 创建弹窗
        const dialog = document.createElement('div');
        dialog.className = 'seg-edit-dialog';
        dialog.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: var(--card-bg, #1e1e1e); border: 2px solid var(--accent-color, #4CAF50);
            border-radius: 12px; padding: 20px; z-index: 10000; min-width: 380px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        `;
        
        dialog.innerHTML = `
            <h3 style="margin:0 0 15px;color:var(--text-color);font-size:16px;">
                ✏️ 修改元素信息: SEG${seg}:COM${com}
            </h3>
            <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;">
                当前: <strong style="color:#4caf50">${found.elemName}.${found.segName}</strong>
                <span style="color:var(--text-muted);font-size:11px;">(SEG:COM不变，只改元素名)</span>
            </p>
            
            <div style="background:var(--warning-bg);border:1px solid var(--warning-color);border-radius:6px;padding:10px;margin-bottom:15px;">
                <p style="margin:0;font-size:11px;color:var(--warning-color);">
                    💡 观察LCD上亮起的段，如果发现元素识别错误，在下方修改正确的元素名和段名
                </p>
            </div>
            
            <div style="display:grid;grid-template-columns:80px 1fr;gap:10px;align-items:center;">
                <label style="color:var(--text-muted);font-size:12px;">元素名:</label>
                <div style="display:flex;gap:5px;">
                    <select id="seg-edit-elem-select" style="flex:1;padding:6px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:4px;">
                        <option value="${found.elemName}" selected>${found.elemName} (当前)</option>
                        ${existingElements.filter(e => e !== found.elemName).map(e => `<option value="${e}">${e}</option>`).join('')}
                        <option value="__new__">+ 移动到新元素...</option>
                    </select>
                </div>
                
                <label style="color:var(--text-muted);font-size:12px;">新元素名:</label>
                <input type="text" id="seg-edit-new-elem" placeholder="如: Line3_D2" 
                    style="padding:6px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:4px;display:none;">
                
                <label style="color:var(--text-muted);font-size:12px;">段名:</label>
                <input type="text" id="seg-edit-seg-name" value="${found.segName}" placeholder="如: A, B, DP"
                    style="padding:6px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:4px;">
                
                <label style="color:var(--text-muted);font-size:12px;">类型:</label>
                <select id="seg-edit-type" style="padding:6px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:4px;">
                    <option value="digit" ${currentElem?.type === 'digit' ? 'selected' : ''}>digit (数字)</option>
                    <option value="icon" ${currentElem?.type === 'icon' ? 'selected' : ''}>icon (图标)</option>
                    <option value="unit" ${currentElem?.type === 'unit' ? 'selected' : ''}>unit (单位)</option>
                </select>
                
                <label style="color:var(--text-muted);font-size:12px;">备注:</label>
                <input type="text" id="seg-edit-note" value="${currentSeg?.note || ''}" placeholder="修改原因/备注"
                    style="padding:6px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:4px;">
            </div>
            
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
                <button id="seg-edit-cancel" style="padding:8px 16px;background:var(--border-color);color:var(--text-color);border:none;border-radius:4px;cursor:pointer;">取消</button>
                <button id="seg-edit-save" style="padding:8px 16px;background:#4caf50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">✓ 保存修改</button>
            </div>
        `;
        
        // 添加遮罩
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;';
        
        document.body.appendChild(overlay);
        document.body.appendChild(dialog);
        
        // 绑定事件
        const elemSelect = dialog.querySelector('#seg-edit-elem-select');
        const newElemInput = dialog.querySelector('#seg-edit-new-elem');
        
        elemSelect.addEventListener('change', () => {
            newElemInput.style.display = elemSelect.value === '__new__' ? 'block' : 'none';
            if (elemSelect.value === '__new__') newElemInput.focus();
        });
        
        const closeDialog = () => {
            overlay.remove();
            dialog.remove();
        };
        
        dialog.querySelector('#seg-edit-cancel').addEventListener('click', closeDialog);
        overlay.addEventListener('click', closeDialog);
        
        dialog.querySelector('#seg-edit-save').addEventListener('click', () => {
            let newElemName = elemSelect.value;
            if (newElemName === '__new__') {
                newElemName = newElemInput.value.trim();
                if (!newElemName) {
                    alert('请输入新元素名！');
                    return;
                }
            }
            
            const newSegName = dialog.querySelector('#seg-edit-seg-name').value.trim() || 'A';
            const newType = dialog.querySelector('#seg-edit-type').value;
            const note = dialog.querySelector('#seg-edit-note').value.trim();
            
            // 执行修改
            this.moveSegmentToElement(seg, com, found.elemId, found.segName, newElemName, newSegName, newType, note);
            closeDialog();
        });
    },
    
    /**
     * 将段移动到另一个元素（或重命名）
     * SEG:COM保持不变，只改变元素归属和段名
     */
    moveSegmentToElement(seg, com, oldElemId, oldSegName, newElemName, newSegName, newType, note) {
        // 记录修改历史
        const oldInfo = `${oldElemId}.${oldSegName}`;
        const newInfo = `${newElemName}.${newSegName}`;
        
        // 找到旧元素和段
        const oldElem = this.state.elements.find(e => e.id === oldElemId);
        if (!oldElem) return;
        
        const oldSegIdx = oldElem.segments.findIndex(s => s.name === oldSegName);
        if (oldSegIdx === -1) return;
        
        const segData = oldElem.segments[oldSegIdx];
        
        // 如果元素名没变，只是改段名
        if (newElemName === oldElem.name) {
            segData.name = newSegName;
            if (note) segData.note = note;
            segData.modifiedAt = new Date().toISOString();
            segData.modifiedFrom = oldInfo;
            
            this.log(`✅ 段名修改: ${oldInfo} → ${newInfo}`, 'success');
        } else {
            // 移动到另一个元素
            // 从旧元素中移除
            oldElem.segments.splice(oldSegIdx, 1);
            
            // 如果旧元素没有段了，删除它
            if (oldElem.segments.length === 0) {
                const elemIdx = this.state.elements.indexOf(oldElem);
                if (elemIdx !== -1) {
                    this.state.elements.splice(elemIdx, 1);
                    this.log(`🗑️ 删除空元素: ${oldElem.name}`, 'warning');
                }
            }
            
            // 查找或创建新元素
            let newElem = this.state.elements.find(e => e.name === newElemName);
            if (!newElem) {
                newElem = {
                    id: newElemName,
                    name: newElemName,
                    type: newType,
                    description: '',
                    segments: []
                };
                this.state.elements.push(newElem);
                this.log(`➕ 创建新元素: ${newElemName}`, 'success');
            }
            
            // 添加到新元素
            segData.name = newSegName;
            if (note) segData.note = note;
            segData.modifiedAt = new Date().toISOString();
            segData.modifiedFrom = oldInfo;
            newElem.segments.push(segData);
            
            this.log(`✅ 段移动: ${oldInfo} → ${newInfo}`, 'success');
        }
        
        // 刷新界面
        this.state.selectedElement = newElemName;
        this.state.selectedSegment = newSegName;
        this.state.expandedElements.add(newElemName);
        
        this.renderElementsTree();
        this.renderMatrix();
        this.updateInfoPanel();
        this.render();
        this.updateStatistics();
    },
};

// 页面加载时初始化
if (typeof window !== 'undefined') {
    window.SegmentEditor = SegmentEditor;
}
