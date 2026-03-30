/**
 * LCD模拟器页面 - 基于像素映射渲染固件LCD状态 + 元素绑定功能
 * 
 * 功能:
 * 1. 加载段码编辑器导出的元素配置（像素区域+SEG:COM映射）
 * 2. 读取固件54字节LCD缓冲区（0xBC命令）
 * 3. 根据缓冲区数据渲染LCD显示
 * 4. 【新增】编辑模式：选择段码，创建元素，绑定段码到元素
 * 5. 【新增】拖拽平移和滚轮缩放
 */
const LcdSimulatorPage = {
    // 状态
    state: {
        config: null,           // 元素配置
        image: null,            // LCD背景图 (可选，用于参考)
        imageWidth: 0,
        imageHeight: 0,
        buffer: new Uint8Array(54),  // LCD缓冲区
        zoom: 1,
        panX: 0,                // 平移X偏移
        panY: 0,                // 平移Y偏移
        showLabels: true,
        selectedElement: null,
        autoSyncTimer: null,
        autoSyncing: false,
        
        // 仿真显示样式配置
        bgOpacity: 0.3,         // 背景图透明度
        lcdBgColor: '#1a1a2e',  // LCD底色（未点亮区域）
        litColor: '#00ff88',    // 点亮段颜色（绿色LCD）
        unlitColor: '#2a3a2a',  // 未点亮段颜色
        unlitOpacity: 0.5,      // 未点亮段透明度
        
        // 【新增】拖拽状态
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
    },
    
    // COM位映射: COM0=bit7, COM7=bit0
    comBitMap: { 0: 7, 1: 6, 2: 5, 3: 4, 4: 3, 5: 2, 6: 1, 7: 0 },
    
    canvas: null,
    ctx: null,
    
    // ========== 初始化 ==========
    async init() {
        console.log('[LcdSimulator] 初始化');
        
        // 检查URL参数中是否指定了设备
        const urlParams = new URLSearchParams(window.location.search);
        this.urlDeviceId = urlParams.get('device');
        if (this.urlDeviceId) {
            console.log('[LcdSimulator] 从URL参数获取设备ID:', this.urlDeviceId);
        }
        
        // 【修复】从当前活动的页面容器中查找 canvas
        // 这解决了多个页面有相同 id 的 canvas 时的冲突问题
        const pageContainer = document.getElementById('dynamic-lcd_simulator') || 
                              document.querySelector('.page.active');
        
        if (pageContainer) {
            this.canvas = pageContainer.querySelector('#sim-lcd-canvas');
        } else {
            // 降级：直接查找（可能找到错误的 canvas）
            this.canvas = document.getElementById('sim-lcd-canvas');
        }
        
        console.log('[LcdSimulator] canvas 元素:', this.canvas, 
                    'container:', pageContainer?.id,
                    'visible:', this.canvas?.offsetParent !== null);
        
        if (this.canvas) {
            // 【修复】重新创建 context，确保绑定到正确的 canvas
            this.ctx = this.canvas.getContext('2d', { alpha: true });
            
            // 移除旧的事件监听器（如果有的话）
            // 注意：由于我们使用的是匿名函数，无法直接移除，所以这里用标记来避免重复绑定
            if (!this.canvas._lcdSimEventsAttached) {
                this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
                this.canvas.addEventListener('mousemove', (e) => this.onCanvasMove(e));
                this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
                this.canvas.addEventListener('wheel', (e) => this.onCanvasWheel(e), { passive: false });
                this.canvas._lcdSimEventsAttached = true;
            }
            
            // 设置默认鼠标样式
            this.canvas.style.cursor = 'grab';
        } else {
            console.error('[LcdSimulator] 找不到 canvas 元素 #sim-lcd-canvas');
        }
        
        // 全局事件只绑定一次
        if (!this._globalEventsAttached) {
            window.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
            window.addEventListener('mousemove', (e) => {
                if (this.state.isDragging) this.onCanvasMove(e);
            });
            this._globalEventsAttached = true;
        }
        
        // 初始化设备配置管理器
        await this.initDeviceManager();
        
        // 加载保存的样式设置
        this.loadStyleSettings();
        
        // 自动加载配置
        await this.loadConfig();
        
        // 【修复】延迟执行最终渲染，确保 DOM 布局完成
        setTimeout(() => {
            this.resizeCanvas();
            this.render();
            console.log('[LcdSimulator] 延迟渲染完成, canvas size:', this.canvas?.width, 'x', this.canvas?.height);
        }, 100);
        
        this.log('LCD模拟器初始化完成', 'success');
    },
    
    // ========== 设备配置管理器集成 ==========
    async initDeviceManager() {
        if (typeof DeviceConfigManager !== 'undefined') {
            await DeviceConfigManager.init();
            
            // 如果URL指定了设备，先切换到该设备
            if (this.urlDeviceId) {
                await DeviceConfigManager.setCurrentDevice(this.urlDeviceId);
            }
            
            // 创建设备选择器
            createDeviceSelector('sim-device-selector', {
                onChange: (deviceId) => this.onDeviceChanged(deviceId),
                showAdd: true,
                showManage: true
            });
            
            // 订阅设备变化事件
            DeviceConfigManager.subscribe('device-changed', (e) => this.onDeviceChanged(e.newDevice));
            DeviceConfigManager.subscribe('lcd-updated', (e) => {
                // 段码编辑器更新了LCD配置，重新加载
                if (e.deviceId === DeviceConfigManager.getCurrentDevice()) {
                    this.log('检测到LCD配置更新，重新加载...', 'info');
                    this.loadConfig();
                }
            });
            
            console.log('[LcdSimulator] DeviceConfigManager 集成完成');
        } else {
            console.warn('[LcdSimulator] DeviceConfigManager 不可用');
        }
    },
    
    async onDeviceChanged(deviceId) {
        this.log(`切换设备: ${deviceId}`, 'info');
        this.state.config = null;
        this.state.selectedElement = null;
        await this.loadConfig();
    },
    
    destroy() {
        this.stopAutoSync();
    },
    
    // ========== 日志 ==========
    log(message, type = 'info') {
        const logArea = document.getElementById('sim-log-area');
        if (!logArea) return;
        
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const colors = {
            info: 'var(--text-primary)',
            success: 'var(--success-color, #4CAF50)',
            warning: 'var(--warning-color, #FF9800)',
            error: 'var(--error-color, #F44336)',
        };
        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        
        const entry = document.createElement('div');
        entry.style.color = colors[type] || colors.info;
        entry.innerHTML = `<span style="color:var(--text-muted)">[${time}]</span> ${icons[type] || ''} ${message}`;
        
        // 移除占位符
        const placeholder = logArea.querySelector('div');
        if (placeholder && placeholder.textContent.includes('等待操作')) {
            placeholder.remove();
        }
        
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
    },
    
    clearLog() {
        const logArea = document.getElementById('sim-log-area');
        if (logArea) {
            logArea.innerHTML = '<div style="color:var(--text-muted);">日志已清空</div>';
        }
    },
    
    // ========== 拖拽和缩放 ==========
    onCanvasMouseDown(e) {
        e.preventDefault();  // 防止选中文本
        
        // 记录起始位置
        this.state.dragStartX = e.clientX;
        this.state.dragStartY = e.clientY;
        this.state.mouseDownTime = Date.now();
        this.state.hasMoved = false;
        
        // 左键、中键都可以拖拽
        if (e.button === 0 || e.button === 1) {
            this.state.isDragging = true;
            if (this.canvas) this.canvas.style.cursor = 'grabbing';
        }
    },
    
    onCanvasMouseUp(e) {
        const dragTime = Date.now() - (this.state.mouseDownTime || 0);
        const dx = Math.abs(e.clientX - this.state.dragStartX);
        const dy = Math.abs(e.clientY - this.state.dragStartY);
        
        // 判断是否是点击（移动距离小且时间短）
        const isClick = dx < 5 && dy < 5 && dragTime < 300 && !this.state.hasMoved;
        
        this.state.isDragging = false;
        if (this.canvas) this.canvas.style.cursor = 'grab';
        
        // 如果是点击，手动触发点击处理
        if (isClick && e.button === 0) {
            this.handleClick(e);
        }
    },
    
    onCanvasMove(e) {
        // 拖拽平移 - 检查 isDragging 状态
        if (this.state.isDragging) {
            const dx = e.clientX - this.state.dragStartX;
            const dy = e.clientY - this.state.dragStartY;
            
            // 如果移动超过阈值，标记为已移动
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                this.state.hasMoved = true;
            }
            
            this.state.panX += dx;
            this.state.panY += dy;
            this.state.dragStartX = e.clientX;
            this.state.dragStartY = e.clientY;
            this.render();
        }
    },
    
    onCanvasWheel(e) {
        e.preventDefault();
        
        // 计算缩放因子
        const factor = Math.pow(1.1, -e.deltaY / 100);
        const newZoom = Math.max(0.1, Math.min(5, this.state.zoom * factor));
        
        // 以鼠标位置为中心缩放
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 计算缩放前后的偏移调整
        const zoomRatio = newZoom / this.state.zoom;
        this.state.panX = mouseX - (mouseX - this.state.panX) * zoomRatio;
        this.state.panY = mouseY - (mouseY - this.state.panY) * zoomRatio;
        
        this.state.zoom = newZoom;
        
        // 更新缩放滑块（如果存在）
        const zoomSlider = document.getElementById('sim-zoom-slider');
        if (zoomSlider) zoomSlider.value = newZoom;
        const zoomValue = document.getElementById('sim-zoom-value');
        if (zoomValue) zoomValue.textContent = Math.round(newZoom * 100) + '%';
        
        this.resizeCanvas();
        this.render();
    },
    
    // 重置视图
    resetView() {
        this.state.zoom = 1;
        this.state.panX = 0;
        this.state.panY = 0;
        
        const zoomSlider = document.getElementById('sim-zoom-slider');
        if (zoomSlider) zoomSlider.value = 1;
        const zoomValue = document.getElementById('sim-zoom-value');
        if (zoomValue) zoomValue.textContent = '100%';
        
        this.resizeCanvas();
        this.render();
    },
    
    // 适应视图
    fitToView() {
        if (!this.canvas) return;
        
        // 计算内容边界
        let maxX = 400, maxY = 200;
        if (this.state.config && this.state.config.elements) {
            for (const elem of this.state.config.elements) {
                for (const seg of elem.segments) {
                    if (!seg.pixelMask) continue;
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        if (px > maxX) maxX = px;
                        if (py > maxY) maxY = py;
                    }
                }
            }
        }
        
        // 计算适合的缩放比例
        const containerW = this.canvas.parentElement?.clientWidth || this.canvas.width;
        const containerH = this.canvas.parentElement?.clientHeight || this.canvas.height;
        const scaleX = containerW / (maxX + 40);
        const scaleY = containerH / (maxY + 40);
        const scale = Math.min(scaleX, scaleY, 2) * 0.9;
        
        this.state.zoom = scale;
        this.state.panX = 0;
        this.state.panY = 0;
        
        const zoomSlider = document.getElementById('sim-zoom-slider');
        if (zoomSlider) zoomSlider.value = scale;
        const zoomValue = document.getElementById('sim-zoom-value');
        if (zoomValue) zoomValue.textContent = Math.round(scale * 100) + '%';
        
        this.resizeCanvas();
        this.render();
    },

    // ========== 配置加载 ==========
    async loadConfig() {
        // 优先使用 DeviceConfigManager
        const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
        this.log(`加载配置: ${deviceId}...`);
        
        // 1. 优先使用 DeviceConfigManager 加载
        if (typeof DeviceConfigManager !== 'undefined' && DeviceConfigManager.getCurrentDevice()) {
            try {
                const lcdProject = await DeviceConfigManager.loadLcdProject(deviceId);
                console.log('[LcdSimulator] loadConfig - 收到数据:', {
                    hasData: !!lcdProject,
                    hasElements: !!(lcdProject?.elements),
                    elementsCount: lcdProject?.elements?.length || 0,
                    hasImage: !!(lcdProject?.image),
                    imageLength: lcdProject?.image?.length || 0
                });
                if (lcdProject && lcdProject.elements) {
                    this.applyConfig(deviceId, lcdProject);
                    this.log(`✅ 从设备配置加载: ${this.state.config.elements.length} 个元素`, 'success');
                    return;
                }
            } catch (err) {
                this.log(`DeviceConfigManager加载失败: ${err.message}，尝试其他方式`, 'warning');
            }
        }
        
        try {
            // 2. 降级：从后端加载项目文件 (.lcd)
            const projectResponse = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_project_load', params: [deviceId] })
            });
            const projectResult = await projectResponse.json();
            
            if (projectResult.success && projectResult.project) {
                this.applyConfig(deviceId, projectResult.project);
                this.log(`✅ 从项目文件加载: ${this.state.config.elements.length} 个元素`, 'success');
                return;
            }
            
            // 3. 从localStorage加载段码编辑器保存的状态
            const savedStr = localStorage.getItem('segment_editor_state');
            if (savedStr) {
                const saved = JSON.parse(savedStr);
                if (saved.elements && saved.elements.length > 0) {
                    this.applyConfig(deviceId, saved);
                    this.log(`从localStorage加载: ${this.state.config.elements.length} 个元素`, 'success');
                    return;
                }
            }
            
            // 4. 尝试从后端加载元素配置文件 (gd303_mini_elements.json)
            const elemResponse = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_elements_load', params: [deviceId] })
            });
            const elemResult = await elemResponse.json();
            
            if (elemResult.success && elemResult.elements) {
                this.applyConfig(deviceId, { elements: elemResult.elements });
                this.log(`从元素配置加载: ${this.state.config.elements.length} 个元素`, 'success');
                return;
            }
            
            // 5. 尝试从后端加载旧格式配置
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_config_get', params: [deviceId] })
            });
            const result = await response.json();
            
            if (result.success && result.config) {
                this.state.config = result.config;
                this.log(`从服务器加载: ${result.config.elements?.length || 0} 个元素`, 'success');
                this.renderElementList();
                this.resizeCanvas();
                this.render();
            } else {
                this.log('未找到配置，请先在段码编辑器中创建并保存项目', 'warning');
            }
        } catch (err) {
            this.log(`加载配置失败: ${err.message}`, 'error');
        }
    },
    
    /**
     * 应用配置数据
     */
    applyConfig(deviceId, projectData) {
        this.state.config = {
            device: deviceId,
            elements: (projectData.elements || []).map(elem => ({
                ...elem,
                segments: elem.segments.map(seg => ({
                    ...seg,
                    pixelMask: new Set(seg.pixelMask || seg.pixels || [])
                }))
            }))
        };
        
        // 调试：检查元素和像素数据
        let totalPixels = 0;
        for (const elem of this.state.config.elements) {
            for (const seg of elem.segments) {
                totalPixels += seg.pixelMask.size;
            }
        }
        console.log('[LcdSimulator] applyConfig - 元素数:', this.state.config.elements.length, '总像素:', totalPixels);
        
        // 恢复图像
        const hasImage = projectData.image && projectData.image.length > 0;
        console.log('[LcdSimulator] applyConfig - 图片字段:', hasImage ? `存在 (${projectData.image.length} 字符)` : '不存在');
        
        if (hasImage) {
            const img = new Image();
            img.onload = () => {
                console.log('[LcdSimulator] 图片加载成功:', img.naturalWidth, 'x', img.naturalHeight);
                this.state.image = img;
                this.state.imageWidth = projectData.imageWidth || img.naturalWidth;
                this.state.imageHeight = projectData.imageHeight || img.naturalHeight;
                this.log(`✅ 背景图加载成功: ${img.naturalWidth}x${img.naturalHeight}`, 'success');
                
                // 【修复】使用 requestAnimationFrame 确保 DOM 布局完成后再渲染
                requestAnimationFrame(() => {
                    this.resizeCanvas();
                    this.render();
                });
            };
            img.onerror = (err) => {
                console.error('[LcdSimulator] 图片加载失败:', err);
                this.log('⚠️ 背景图加载失败，请检查图片数据', 'warning');
                this.resizeCanvas();
                this.render();
            };
            img.src = projectData.image;
        } else {
            this.log('⚠️ 配置中没有背景图，请在段码编辑器中添加LCD全显图', 'warning');
            this.resizeCanvas();
            this.render();
        }
        
        this.renderElementList();
    },
    
    // ========== 固件同步 ==========
    async syncFromDevice() {
        this.log('同步固件LCD缓冲区...');
        
        try {
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_dump', params: [] })
            });
            const result = await response.json();
            
            if (result.success && result.buffer) {
                this.state.buffer = new Uint8Array(result.buffer);
                this.updateBufferDisplay();
                this.render();
                this.log(`同步成功: ${result.buffer.length} 字节`, 'success');
            } else {
                this.log(`同步失败: ${result.error || '未知错误'}`, 'error');
            }
        } catch (err) {
            this.log(`同步失败: ${err.message}`, 'error');
        }
    },
    
    startAutoSync() {
        if (this.state.autoSyncing) {
            this.stopAutoSync();
            return;
        }
        
        this.state.autoSyncing = true;
        const btn = document.getElementById('sim-auto-sync-btn');
        if (btn) {
            btn.textContent = '⏹ 停止同步';
            btn.style.background = 'var(--error-color, #F44336)';
            btn.style.color = 'white';
        }
        
        this.log('开始自动同步 (500ms间隔)', 'info');
        
        this.state.autoSyncTimer = setInterval(() => {
            this.syncFromDevice();
        }, 500);
    },
    
    stopAutoSync() {
        if (this.state.autoSyncTimer) {
            clearInterval(this.state.autoSyncTimer);
            this.state.autoSyncTimer = null;
        }
        this.state.autoSyncing = false;
        
        const btn = document.getElementById('sim-auto-sync-btn');
        if (btn) {
            btn.textContent = '▶ 自动同步';
            btn.style.background = 'var(--bg-tertiary)';
            btn.style.color = 'var(--text-primary)';
        }
        
        this.log('停止自动同步', 'info');
    },
    
    updateBufferDisplay() {
        const hexDiv = document.getElementById('sim-buffer-hex');
        if (!hexDiv) return;
        
        const hexStr = Array.from(this.state.buffer)
            .map((b, i) => {
                const hex = b.toString(16).padStart(2, '0').toUpperCase();
                return (i % 8 === 0 && i > 0) ? ' ' + hex : hex;
            })
            .join(' ');
        
        hexDiv.textContent = hexStr;
    },

    // ========== 渲染 ==========
    resizeCanvas() {
        if (!this.canvas) return;
        
        // 如果有图像，使用图像尺寸
        if (this.state.image) {
            const w = this.state.imageWidth * this.state.zoom;
            const h = this.state.imageHeight * this.state.zoom;
            this.canvas.width = w;
            this.canvas.height = h;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            return;
        }
        
        // 否则根据元素配置计算边界
        if (this.state.config && this.state.config.elements) {
            let maxX = 0, maxY = 0;
            for (const elem of this.state.config.elements) {
                for (const seg of elem.segments) {
                    if (!seg.pixelMask) continue;
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        if (px > maxX) maxX = px;
                        if (py > maxY) maxY = py;
                    }
                }
            }
            
            // 添加边距，并确保最小尺寸
            maxX = Math.max(maxX + 20, 400);  // 最小宽度400
            maxY = Math.max(maxY + 20, 200);  // 最小高度200
            const w = maxX * this.state.zoom;
            const h = maxY * this.state.zoom;
            this.canvas.width = w;
            this.canvas.height = h;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            return;
        }
        
        // 默认尺寸 - 使用较大的默认值
        const defaultW = 400 * this.state.zoom;
        const defaultH = 200 * this.state.zoom;
        this.canvas.width = defaultW;
        this.canvas.height = defaultH;
        this.canvas.style.width = defaultW + 'px';
        this.canvas.style.height = defaultH + 'px';
    },
    
    render() {
        if (!this.ctx || !this.canvas) return;
        
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const s = this.state.zoom;
        const panX = this.state.panX;
        const panY = this.state.panY;
        
        console.log('[LcdSimulator] render - using styles:', {
            lcdBgColor: this.state.lcdBgColor,
            litColor: this.state.litColor,
            unlitColor: this.state.unlitColor,
            bgOpacity: this.state.bgOpacity
        });
        
        // 清空画布 - 使用LCD底色
        ctx.fillStyle = this.state.lcdBgColor || '#1a1a2e';
        ctx.fillRect(0, 0, w, h);
        
        // 绘制背景图（如果有）- 带透明度
        if (this.state.image) {
            const imgW = this.state.imageWidth || this.state.image.naturalWidth;
            const imgH = this.state.imageHeight || this.state.image.naturalHeight;
            ctx.globalAlpha = this.state.bgOpacity;
            ctx.drawImage(this.state.image, panX, panY, imgW * s, imgH * s);
            ctx.globalAlpha = 1;
        }
        
        // 如果没有配置，显示提示
        if (!this.state.config || !this.state.config.elements) {
            ctx.fillStyle = '#888';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('请先加载配置', w / 2, h / 2);
            return;
        }
        
        // 根据缓冲区数据渲染每个段
        for (const elem of this.state.config.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask || seg.pixelMask.size === 0) continue;
                
                // 检查该段是否点亮
                const isLit = this.isSegmentLit(seg.seg, seg.com);
                const isSelected = this.state.selectedElement === elem.id;
                
                if (isLit) {
                    // 点亮的段 - 使用设定的颜色
                    ctx.fillStyle = this.state.litColor || '#00ff88';
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        ctx.fillRect(px * s + panX, py * s + panY, s, s);
                    }
                } else {
                    // 未点亮的段 - 使用设定的颜色和透明度
                    const unlitColor = this.state.unlitColor || '#2a3a2a';
                    // 确保未点亮段始终可见（最小透明度0.1）
                    const unlitOpacity = Math.max(0.1, this.state.unlitOpacity || 0.5);
                    ctx.fillStyle = this.hexToRgba(unlitColor, unlitOpacity);
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        ctx.fillRect(px * s + panX, py * s + panY, s, s);
                    }
                }
                
                // 选中元素高亮边框
                if (isSelected) {
                    ctx.strokeStyle = 'rgba(255, 100, 0, 0.8)';
                    ctx.lineWidth = 2;
                    for (const pkey of seg.pixelMask) {
                        const [px, py] = pkey.split(',').map(Number);
                        ctx.strokeRect(px * s + panX, py * s + panY, s, s);
                    }
                }
            }
        }
        
        // 绘制标签
        if (this.state.showLabels) {
            this.renderLabels(ctx, s, panX, panY);
        }
    },
    
    // 辅助方法：hex颜色转rgba
    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },
    
    // 更新显示样式
    updateStyle() {
        // 读取控件值
        const bgOpacity = document.getElementById('sim-bg-opacity');
        const lcdBgColor = document.getElementById('sim-lcd-bg-color');
        const litColor = document.getElementById('sim-lit-color');
        const unlitColor = document.getElementById('sim-unlit-color');
        const unlitOpacity = document.getElementById('sim-unlit-opacity');
        
        if (bgOpacity) {
            this.state.bgOpacity = parseInt(bgOpacity.value) / 100;
            const label = document.getElementById('sim-bg-opacity-value');
            if (label) label.textContent = bgOpacity.value + '%';
        }
        if (lcdBgColor) this.state.lcdBgColor = lcdBgColor.value;
        if (litColor) this.state.litColor = litColor.value;
        if (unlitColor) this.state.unlitColor = unlitColor.value;
        if (unlitOpacity) {
            this.state.unlitOpacity = parseInt(unlitOpacity.value) / 100;
            const label = document.getElementById('sim-unlit-opacity-value');
            if (label) label.textContent = unlitOpacity.value + '%';
        }
        
        this.render();
        this.saveStyleSettings();  // 自动保存
    },
    
    // 保存样式设置到localStorage
    saveStyleSettings() {
        const settings = {
            bgOpacity: this.state.bgOpacity,
            lcdBgColor: this.state.lcdBgColor,
            litColor: this.state.litColor,
            unlitColor: this.state.unlitColor,
            unlitOpacity: this.state.unlitOpacity
        };
        localStorage.setItem('lcd_simulator_style', JSON.stringify(settings));
    },
    
    // 加载样式设置
    loadStyleSettings() {
        try {
            const saved = localStorage.getItem('lcd_simulator_style');
            console.log('[LcdSimulator] loadStyleSettings - saved:', saved);
            if (saved) {
                const settings = JSON.parse(saved);
                console.log('[LcdSimulator] loadStyleSettings - parsed:', settings);
                // 使用 ?? 处理 null/undefined，但对于 0 值需要特殊处理
                // bgOpacity 可以为 0（完全隐藏背景图）
                this.state.bgOpacity = (settings.bgOpacity !== undefined && settings.bgOpacity !== null) 
                    ? settings.bgOpacity : 0.3;
                this.state.lcdBgColor = settings.lcdBgColor ?? '#1a1a2e';
                this.state.litColor = settings.litColor ?? '#00ff88';
                this.state.unlitColor = settings.unlitColor ?? '#2a3a2a';
                // unlitOpacity 最小为 0.1，确保未点亮段始终可见
                this.state.unlitOpacity = (settings.unlitOpacity !== undefined && settings.unlitOpacity !== null) 
                    ? Math.max(0.1, settings.unlitOpacity) : 0.5;
                
                console.log('[LcdSimulator] loadStyleSettings - state after load:', {
                    bgOpacity: this.state.bgOpacity,
                    lcdBgColor: this.state.lcdBgColor,
                    litColor: this.state.litColor,
                    unlitColor: this.state.unlitColor,
                    unlitOpacity: this.state.unlitOpacity
                });
                
                // 更新控件
                this.syncStyleControls();
                this.log('已恢复显示样式设置', 'info');
            } else {
                console.log('[LcdSimulator] loadStyleSettings - no saved settings, using defaults');
            }
        } catch (e) {
            console.warn('[LcdSimulator] 加载样式设置失败:', e);
        }
    },
    
    // 同步样式控件显示
    syncStyleControls() {
        const bgOpacity = document.getElementById('sim-bg-opacity');
        const bgOpacityValue = document.getElementById('sim-bg-opacity-value');
        const lcdBgColor = document.getElementById('sim-lcd-bg-color');
        const litColor = document.getElementById('sim-lit-color');
        const unlitColor = document.getElementById('sim-unlit-color');
        const unlitOpacity = document.getElementById('sim-unlit-opacity');
        const unlitOpacityValue = document.getElementById('sim-unlit-opacity-value');
        
        console.log('[LcdSimulator] syncStyleControls - DOM elements:', {
            bgOpacity: !!bgOpacity,
            lcdBgColor: !!lcdBgColor,
            litColor: !!litColor,
            unlitColor: !!unlitColor,
            unlitOpacity: !!unlitOpacity
        });
        
        if (bgOpacity) bgOpacity.value = Math.round(this.state.bgOpacity * 100);
        if (bgOpacityValue) bgOpacityValue.textContent = Math.round(this.state.bgOpacity * 100) + '%';
        if (lcdBgColor) lcdBgColor.value = this.state.lcdBgColor;
        if (litColor) litColor.value = this.state.litColor;
        if (unlitColor) unlitColor.value = this.state.unlitColor;
        if (unlitOpacity) unlitOpacity.value = Math.round(this.state.unlitOpacity * 100);
        if (unlitOpacityValue) unlitOpacityValue.textContent = Math.round(this.state.unlitOpacity * 100) + '%';
        
        console.log('[LcdSimulator] syncStyleControls - values set:', {
            bgOpacity: bgOpacity?.value,
            lcdBgColor: lcdBgColor?.value,
            litColor: litColor?.value,
            unlitColor: unlitColor?.value,
            unlitOpacity: unlitOpacity?.value
        });
    },
    
    // 应用预设样式
    applyPreset(preset) {
        const presets = {
            green: {
                lcdBgColor: '#1a2a1a',
                litColor: '#00ff88',
                unlitColor: '#2a3a2a',
                unlitOpacity: 50
            },
            blue: {
                lcdBgColor: '#1a1a2e',
                litColor: '#00aaff',
                unlitColor: '#2a2a3e',
                unlitOpacity: 50
            },
            amber: {
                lcdBgColor: '#2a2010',
                litColor: '#ffaa00',
                unlitColor: '#3a3020',
                unlitOpacity: 50
            }
        };
        
        const p = presets[preset];
        if (!p) return;
        
        // 更新状态
        this.state.lcdBgColor = p.lcdBgColor;
        this.state.litColor = p.litColor;
        this.state.unlitColor = p.unlitColor;
        this.state.unlitOpacity = p.unlitOpacity / 100;
        
        // 更新控件
        const lcdBgColor = document.getElementById('sim-lcd-bg-color');
        const litColor = document.getElementById('sim-lit-color');
        const unlitColor = document.getElementById('sim-unlit-color');
        const unlitOpacity = document.getElementById('sim-unlit-opacity');
        const unlitOpacityValue = document.getElementById('sim-unlit-opacity-value');
        
        if (lcdBgColor) lcdBgColor.value = p.lcdBgColor;
        if (litColor) litColor.value = p.litColor;
        if (unlitColor) unlitColor.value = p.unlitColor;
        if (unlitOpacity) unlitOpacity.value = p.unlitOpacity;
        if (unlitOpacityValue) unlitOpacityValue.textContent = p.unlitOpacity + '%';
        
        this.log(`应用预设样式: ${preset}`, 'success');
        this.render();
        this.saveStyleSettings();  // 自动保存
    },
    
    // 重置样式为默认值
    resetStyle() {
        // 默认值
        this.state.bgOpacity = 0.3;
        this.state.lcdBgColor = '#1a1a2e';
        this.state.litColor = '#00ff88';
        this.state.unlitColor = '#2a3a2a';
        this.state.unlitOpacity = 0.5;
        
        // 更新控件
        this.syncStyleControls();
        
        this.log('已重置为默认样式', 'success');
        this.render();
        this.saveStyleSettings();
    },
    
    isSegmentLit(segIdx, comIdx) {
        if (segIdx < 0 || segIdx >= 54) return false;
        if (comIdx < 0 || comIdx > 7) return false;
        
        const byte = this.state.buffer[segIdx];
        const bit = this.comBitMap[comIdx];
        return (byte & (1 << bit)) !== 0;
    },
    
    renderLabels(ctx, scale, panX = 0, panY = 0) {
        if (!this.state.config || !this.state.config.elements) return;
        
        ctx.font = `bold ${Math.max(10, 12 * scale)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (const elem of this.state.config.elements) {
            // 计算元素中心点
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
            
            if (count === 0) continue;
            
            const cx = (sumX / count) * scale + panX;
            const cy = (sumY / count) * scale + panY;
            
            // 绘制标签背景 - 半透明深色背景
            const label = elem.name;
            const metrics = ctx.measureText(label);
            const bgW = metrics.width + 8;
            const bgH = 16;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(cx - bgW/2, cy - bgH/2, bgW, bgH);
            
            // 绘制标签文字 - 使用点亮色或白色
            const isSelected = this.state.selectedElement === elem.id;
            ctx.fillStyle = isSelected ? '#ff6600' : (this.state.litColor || '#00ff88');
            ctx.fillText(label, cx, cy);
        }
    },
    
    // ========== 交互 ==========
    onCanvasClick(e) {
        // 点击事件由 handleClick 处理，这里不做任何事
        // 因为我们在 mouseUp 中手动调用 handleClick
    },
    
    // 实际的点击处理逻辑
    handleClick(e) {
        if (!this.state.config) return;
        
        const rect = this.canvas.getBoundingClientRect();
        // 计算点击位置时需要减去平移偏移
        const x = Math.floor((e.clientX - rect.left - this.state.panX) / this.state.zoom);
        const y = Math.floor((e.clientY - rect.top - this.state.panY) / this.state.zoom);
        
        console.log('[LcdSimulator] 点击位置:', x, y);
        
        // 【编辑模式】选择段码
        if (this.state.editMode) {
            for (const elem of this.state.config.elements) {
                for (const seg of elem.segments) {
                    if (!seg.pixelMask) continue;
                    if (seg.pixelMask.has(`${x},${y}`)) {
                        this.toggleSegmentSelection(elem, seg, e.ctrlKey || e.metaKey);
                        return;
                    }
                }
            }
            // 点击空白处，如果没有按Ctrl则清除选择
            if (!e.ctrlKey && !e.metaKey) {
                this.clearSelection();
            }
            return;
        }
        
        // 【普通模式】查找点击的元素和段 - 反查功能
        for (const elem of this.state.config.elements) {
            for (const seg of elem.segments) {
                if (!seg.pixelMask) continue;
                if (seg.pixelMask.has(`${x},${y}`)) {
                    // 找到了！显示详细信息
                    console.log('[LcdSimulator] 找到元素:', elem.name, '段:', seg.name);
                    this.selectElement(elem);
                    this.showPixelInfo(elem, seg, x, y);
                    return;
                }
            }
        }
        
        console.log('[LcdSimulator] 未找到元素');
        // 点击空白处取消选中
        this.selectElement(null);
    },
    
    // 显示像素所属的元素和段信息
    showPixelInfo(elem, seg, x, y) {
        const infoDiv = document.getElementById('sim-element-info');
        if (!infoDiv) return;
        
        const lit = this.isSegmentLit(seg.seg, seg.com);
        const bound = seg.seg !== '' && seg.com !== '';
        const segInfo = bound ? `SEG${seg.seg}:COM${seg.com}` : '未绑定';
        
        infoDiv.innerHTML = `
            <div style="margin-bottom: 12px; padding: 10px; background: var(--bg-secondary); border-radius: 6px; border-left: 3px solid var(--accent-color);">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">📍 点击位置: (${x}, ${y})</div>
                <div style="font-weight: 600; font-size: 16px; color: var(--accent-color); margin-bottom: 4px;">
                    ${elem.name}
                    <button onclick="LcdSimulatorPage.renameElement('${elem.id}')" 
                        style="margin-left: 8px; padding: 2px 8px; font-size: 11px; border-radius: 3px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); cursor: pointer;" title="重命名元素">
                        ✏️ 重命名
                    </button>
                </div>
                <div style="font-size: 13px; color: var(--text-muted);">类型: ${elem.type || 'unknown'}</div>
            </div>
            
            <div style="margin-bottom: 12px; padding: 10px; background: ${lit ? 'rgba(76, 175, 80, 0.1)' : 'var(--bg-secondary)'}; border-radius: 6px; border-left: 3px solid ${lit ? 'var(--success-color)' : 'var(--border-color)'};">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">🔍 所属段</div>
                <div style="font-weight: 600; font-size: 15px; color: ${lit ? 'var(--success-color)' : 'var(--text-primary)'};">
                    ${seg.name} ${lit ? '● 点亮' : '○ 未点亮'}
                </div>
                <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
                    引脚: ${segInfo}
                </div>
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
                    像素数: ${seg.pixelMask ? seg.pixelMask.size : 0}
                </div>
            </div>
            
            <div style="font-size: 12px; margin-bottom: 8px;">
                <div style="font-weight: 500; margin-bottom: 6px;">该元素所有段 (${elem.segments.length}):</div>
                <div style="max-height: 150px; overflow-y: auto;">
                ${elem.segments.map(s => {
                    const sLit = this.isSegmentLit(s.seg, s.com);
                    const sBound = s.seg !== '' && s.com !== '';
                    const sInfo = sBound ? `SEG${s.seg}:COM${s.com}` : '未绑定';
                    const isCurrent = s.name === seg.name;
                    return `<div style="padding: 4px 8px; margin-bottom: 2px; border-radius: 4px; 
                                background: ${isCurrent ? 'rgba(33, 150, 243, 0.2)' : 'transparent'};
                                border: ${isCurrent ? '1px solid var(--accent-color)' : '1px solid transparent'};
                                color: ${sLit ? 'var(--success-color)' : (sBound ? 'var(--text-primary)' : 'var(--text-muted)')};">
                        ${s.name}: ${sInfo} ${sLit ? '●' : (sBound ? '○' : '—')}
                    </div>`;
                }).join('')}
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button onclick="LcdSimulatorPage.renameElement('${elem.id}')" 
                    style="flex: 1; padding: 6px 12px; font-size: 12px; border-radius: 4px; background: var(--accent-color); color: white; border: none; cursor: pointer;">
                    ✏️ 重命名元素
                </button>
                <button onclick="LcdSimulatorPage.jumpToSegmentEditor('${elem.id}')" 
                    style="flex: 1; padding: 6px 12px; font-size: 12px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); cursor: pointer;">
                    📝 在编辑器中打开
                </button>
            </div>
        `;
    },
    
    // 重命名元素
    async renameElement(elemId) {
        const elem = this.state.config?.elements?.find(e => e.id === elemId);
        if (!elem) return;
        
        const newName = prompt('请输入新的元素名称:', elem.name);
        if (!newName || newName.trim() === '' || newName === elem.name) return;
        
        const oldName = elem.name;
        elem.name = newName.trim();
        elem.id = newName.trim();  // 同时更新ID
        
        // 更新选中状态
        if (this.state.selectedElement === elemId) {
            this.state.selectedElement = elem.id;
        }
        
        this.renderElementList();
        this.render();
        this.log(`重命名元素: ${oldName} → ${newName}`, 'success');
        
        // 保存到后端
        await this.saveConfig();
    },
    
    // 跳转到段码编辑器
    jumpToSegmentEditor(elemId) {
        // 保存要选中的元素ID到localStorage
        localStorage.setItem('segment_editor_select_element', elemId);
        // 跳转到段码编辑器页面
        if (typeof navigateTo === 'function') {
            navigateTo('lcd_segment_editor');
        } else {
            window.location.hash = '#lcd_segment_editor';
        }
    },
    
    // 保存配置到后端
    async saveConfig() {
        if (!this.state.config) return;
        
        try {
            const deviceId = DeviceConfigManager?.getCurrentDevice() || 'gd303_mini';
            
            // 准备保存数据
            const saveData = {
                device: deviceId,
                saveTime: new Date().toISOString(),
                image: '',  // 图片数据需要从原配置获取
                imageWidth: this.state.imageWidth,
                imageHeight: this.state.imageHeight,
                elements: this.state.config.elements.map(elem => ({
                    id: elem.id,
                    name: elem.name,
                    type: elem.type,
                    description: elem.description || '',
                    segments: elem.segments.map(seg => ({
                        name: seg.name,
                        seg: seg.seg,
                        com: seg.com,
                        pixelCount: seg.pixelMask ? seg.pixelMask.size : 0,
                        pixels: seg.pixelMask ? Array.from(seg.pixelMask) : []
                    }))
                }))
            };
            
            // 如果有图片，添加图片数据
            if (this.state.image && this.state.image.src) {
                saveData.image = this.state.image.src;
            }
            
            await DeviceConfigManager.saveLcdProject(saveData, deviceId);
            this.log('配置已保存', 'success');
        } catch (err) {
            this.log(`保存失败: ${err.message}`, 'error');
        }
    },
    
    onCanvasMove(e) {
        // 可以添加悬停提示
    },
    
    selectElement(elem) {
        this.state.selectedElement = elem ? elem.id : null;
        this.render();
        this.updateElementInfo(elem);
    },
    
    updateElementInfo(elem) {
        const infoDiv = document.getElementById('sim-element-info');
        if (!infoDiv) return;
        
        if (!elem) {
            infoDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">点击LCD上的元素查看详情</div>';
            return;
        }
        
        // 统计点亮的段和绑定状态
        let litCount = 0;
        let boundCount = 0;
        for (const seg of elem.segments) {
            if (this.isSegmentLit(seg.seg, seg.com)) {
                litCount++;
            }
            if (seg.seg !== '' && seg.com !== '') {
                boundCount++;
            }
        }
        
        // 编辑模式下显示操作按钮
        const editButtons = this.state.editMode ? `
            <div style="margin-top: 8px; display: flex; gap: 8px;">
                <button onclick="LcdSimulatorPage.unbindAllSegments('${elem.id}')" 
                    style="flex: 1; padding: 4px 8px; font-size: 11px; border-radius: 4px; background: var(--warning-color); color: white; border: none; cursor: pointer;">
                    解绑全部
                </button>
                <button onclick="LcdSimulatorPage.deleteElement('${elem.id}')" 
                    style="flex: 1; padding: 4px 8px; font-size: 11px; border-radius: 4px; background: var(--error-color); color: white; border: none; cursor: pointer;">
                    删除元素
                </button>
            </div>
        ` : '';
        
        infoDiv.innerHTML = `
            <div style="margin-bottom: 8px;">
                <div style="font-weight: 600; font-size: 15px; color: var(--accent-color);">${elem.name}</div>
                <div style="font-size: 12px; color: var(--text-muted);">${elem.type || 'unknown'}</div>
            </div>
            <div style="font-size: 13px; margin-bottom: 8px;">${elem.description || '无描述'}</div>
            <div style="font-size: 12px; color: var(--text-muted);">
                段数: ${elem.segments.length} | 已绑定: ${boundCount} | 点亮: ${litCount}
            </div>
            <div style="margin-top: 8px; font-size: 12px;">
                <div style="font-weight: 500; margin-bottom: 4px;">段列表:</div>
                ${elem.segments.map(seg => {
                    const lit = this.isSegmentLit(seg.seg, seg.com);
                    const bound = seg.seg !== '' && seg.com !== '';
                    const segInfo = bound ? `SEG${seg.seg}:COM${seg.com}` : '未绑定';
                    return `<div style="color: ${lit ? 'var(--success-color)' : (bound ? 'var(--text-primary)' : 'var(--text-muted)')};">
                        ${seg.name}: ${segInfo} ${lit ? '●' : (bound ? '○' : '—')}
                    </div>`;
                }).join('')}
            </div>
            ${editButtons}
        `;
    },
    
    // 解绑元素的所有段码
    unbindAllSegments(elemId) {
        const elem = this.state.config?.elements?.find(e => e.id === elemId);
        if (!elem) return;
        
        if (!confirm(`确定要解绑元素 "${elem.name}" 的所有段码吗？`)) return;
        
        for (const seg of elem.segments) {
            seg.seg = '';
            seg.com = '';
            seg.pixelMask = new Set();
            seg.pixels = [];
        }
        
        this.updateElementInfo(elem);
        this.renderElementList();
        this.render();
        this.log(`已解绑元素 ${elem.name} 的所有段码`, 'warning');
    },

    // ========== 元素列表 ==========
    renderElementList() {
        const listDiv = document.getElementById('sim-element-list');
        if (!listDiv || !this.state.config) {
            if (listDiv) listDiv.innerHTML = '<div style="color: var(--text-muted);">无元素</div>';
            return;
        }
        
        const elements = this.state.config.elements || [];
        
        // 按类型分组
        const groups = {};
        for (const elem of elements) {
            const type = elem.type || 'other';
            if (!groups[type]) groups[type] = [];
            groups[type].push(elem);
        }
        
        let html = '';
        for (const [type, elems] of Object.entries(groups)) {
            const typeNames = {
                'digit': '数码管',
                'icon': '图标',
                'unit': '单位',
                'mode': '模式图标',
                'base': '基准图标',
                'other': '其他'
            };
            
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 4px;">
                    ${typeNames[type] || type} (${elems.length})
                </div>`;
            
            for (const elem of elems) {
                const isSelected = this.state.selectedElement === elem.id;
                // 计算绑定状态
                const boundCount = elem.segments.filter(s => s.seg !== '' && s.com !== '').length;
                const totalCount = elem.segments.length;
                const bindStatus = boundCount === totalCount ? '✅' : (boundCount > 0 ? `${boundCount}/${totalCount}` : '⚪');
                
                html += `<div 
                    onclick="LcdSimulatorPage.selectElement(LcdSimulatorPage.state.config.elements.find(e => e.id === '${elem.id}'))"
                    style="padding: 4px 8px; margin-bottom: 2px; border-radius: 4px; cursor: pointer; font-size: 13px;
                           display: flex; justify-content: space-between; align-items: center;
                           background: ${isSelected ? 'var(--accent-color)' : 'transparent'};
                           color: ${isSelected ? 'white' : 'var(--text-primary)'};">
                    <span>${elem.name} <span style="font-size: 11px; opacity: 0.7;">${bindStatus}</span></span>
                    ${this.state.editMode ? `<button onclick="event.stopPropagation(); LcdSimulatorPage.deleteElement('${elem.id}')" 
                        style="padding: 2px 6px; font-size: 11px; border-radius: 3px; background: var(--error-color); color: white; border: none; cursor: pointer;">
                        ✕
                    </button>` : ''}
                </div>`;
            }
            
            html += '</div>';
        }
        
        listDiv.innerHTML = html || '<div style="color: var(--text-muted);">无元素</div>';
        this.updateElementCount();
    },
    
    // ========== 控制 ==========
    setZoom(value) {
        this.state.zoom = parseFloat(value);
        const label = document.getElementById('sim-zoom-value');
        if (label) label.textContent = Math.round(this.state.zoom * 100) + '%';
        this.resizeCanvas();
        this.render();
    },
    
    toggleLabels(show) {
        this.state.showLabels = show;
        this.render();
    },
    
    toggleUnlit(show) {
        this.state.showUnlit = show;
        this.render();
    },
    
    // ========== 编辑模式 ==========
    toggleEditMode(enabled) {
        this.state.editMode = enabled;
        
        // 显示/隐藏编辑面板
        const bindPanel = document.getElementById('sim-bind-panel');
        const selectionHint = document.getElementById('sim-selection-hint');
        if (bindPanel) bindPanel.style.display = enabled ? 'block' : 'none';
        if (selectionHint) selectionHint.style.display = enabled ? 'inline' : 'none';
        
        // 清除选择
        if (!enabled) {
            this.clearSelection();
        }
        
        this.log(enabled ? '进入编辑模式 - 点击选择段码，Ctrl+点击多选' : '退出编辑模式', 'info');
        this.renderElementList();  // 刷新列表以显示/隐藏删除按钮
        this.render();
    },
    
    // 删除元素
    deleteElement(elemId) {
        if (!this.state.config?.elements) return;
        
        const elem = this.state.config.elements.find(e => e.id === elemId);
        if (!elem) return;
        
        if (!confirm(`确定要删除元素 "${elem.name}" 吗？`)) return;
        
        // 从数组中移除
        const idx = this.state.config.elements.findIndex(e => e.id === elemId);
        if (idx >= 0) {
            this.state.config.elements.splice(idx, 1);
        }
        
        // 如果删除的是当前选中的元素，清除选中状态
        if (this.state.selectedElement === elemId) {
            this.state.selectedElement = null;
            this.updateElementInfo(null);
        }
        
        // 清除选中的段码中属于该元素的
        this.state.selectedSegments = this.state.selectedSegments.filter(s => s.elemId !== elemId);
        
        this.renderElementList();
        this.updateElementCount();
        this.updateSelectedSegmentsDisplay();
        this.render();
        this.log(`已删除元素: ${elem.name}`, 'warning');
    },
    
    // 检查段码是否被选中
    isSegmentSelected(elemId, segName) {
        return this.state.selectedSegments.some(s => s.elemId === elemId && s.segName === segName);
    },
    
    // 切换段码选择状态
    toggleSegmentSelection(elem, seg, isMultiSelect) {
        const key = { elemId: elem.id, segName: seg.name, seg: seg.seg, com: seg.com, elemName: elem.name };
        const idx = this.state.selectedSegments.findIndex(s => s.elemId === elem.id && s.segName === seg.name);
        
        if (idx >= 0) {
            // 已选中，取消选择
            this.state.selectedSegments.splice(idx, 1);
        } else {
            // 未选中
            if (!isMultiSelect) {
                // 单选模式，清除之前的选择
                this.state.selectedSegments = [];
            }
            this.state.selectedSegments.push(key);
        }
        
        this.updateSelectedSegmentsDisplay();
        this.render();
    },
    
    // 清除选择
    clearSelection() {
        this.state.selectedSegments = [];
        this.updateSelectedSegmentsDisplay();
        this.render();
    },
    
    // 更新选中段码显示
    updateSelectedSegmentsDisplay() {
        const div = document.getElementById('sim-selected-segments');
        const bindBtn = document.getElementById('sim-bind-btn');
        
        if (!div) return;
        
        if (this.state.selectedSegments.length === 0) {
            div.innerHTML = '<span style="color: var(--text-muted);">点击LCD选择段码</span>';
            if (bindBtn) bindBtn.disabled = true;
        } else {
            const items = this.state.selectedSegments.map(s => 
                `<span style="display: inline-block; padding: 2px 6px; margin: 2px; background: var(--accent-color); color: white; border-radius: 4px; font-size: 12px;">
                    ${s.elemName}.${s.segName} (SEG${s.seg}:COM${s.com})
                </span>`
            ).join('');
            div.innerHTML = items;
            if (bindBtn) bindBtn.disabled = false;
        }
    },
    
    // ========== 创建元素 ==========
    showCreateElementDialog() {
        const dialog = document.getElementById('sim-create-element-dialog');
        if (dialog) {
            dialog.style.display = 'flex';
            // 清空输入
            document.getElementById('sim-new-elem-name').value = '';
            document.getElementById('sim-new-elem-type').value = 'digit';
            document.getElementById('sim-new-elem-desc').value = '';
        }
    },
    
    hideCreateElementDialog() {
        const dialog = document.getElementById('sim-create-element-dialog');
        if (dialog) dialog.style.display = 'none';
    },
    
    createNewElement() {
        const name = document.getElementById('sim-new-elem-name')?.value?.trim();
        const type = document.getElementById('sim-new-elem-type')?.value || 'digit';
        const desc = document.getElementById('sim-new-elem-desc')?.value?.trim() || '';
        
        if (!name) {
            alert('请输入元素名称！');
            return;
        }
        
        // 检查名称是否重复
        if (this.state.config?.elements?.some(e => e.name === name)) {
            alert('元素名称已存在！');
            return;
        }
        
        // 创建元素
        const elem = {
            id: 'elem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: name,
            type: type,
            description: desc,
            segments: []
        };
        
        // 根据类型预创建段
        if (type === 'digit') {
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].forEach(s => {
                elem.segments.push({ name: s, seg: '', com: '', pixelMask: new Set() });
            });
        } else {
            elem.segments.push({ name: '整体', seg: '', com: '', pixelMask: new Set() });
        }
        
        // 添加到配置
        if (!this.state.config) {
            this.state.config = { device: 'gd303_mini', elements: [] };
        }
        this.state.config.elements.push(elem);
        
        this.hideCreateElementDialog();
        this.renderElementList();
        this.updateElementCount();
        this.log(`创建元素: ${name} (${type})`, 'success');
    },
    
    // ========== 绑定段码到元素 ==========
    bindToElement() {
        if (this.state.selectedSegments.length === 0) {
            alert('请先选择段码！');
            return;
        }
        
        // 显示绑定对话框
        const dialog = document.getElementById('sim-bind-dialog');
        if (!dialog) return;
        
        // 填充元素下拉框
        const elemSelect = document.getElementById('sim-bind-target-elem');
        if (elemSelect && this.state.config?.elements) {
            elemSelect.innerHTML = this.state.config.elements.map(e => 
                `<option value="${e.id}">${e.name} (${e.type})</option>`
            ).join('');
        }
        
        // 更新段下拉框
        this.onBindTargetChange();
        
        // 显示将绑定的段码
        const preview = document.getElementById('sim-bind-preview');
        if (preview) {
            preview.textContent = this.state.selectedSegments.map(s => 
                `${s.elemName}.${s.segName} (SEG${s.seg}:COM${s.com})`
            ).join(', ');
        }
        
        dialog.style.display = 'flex';
    },
    
    hideBindDialog() {
        const dialog = document.getElementById('sim-bind-dialog');
        if (dialog) dialog.style.display = 'none';
    },
    
    onBindTargetChange() {
        const elemSelect = document.getElementById('sim-bind-target-elem');
        const segSelect = document.getElementById('sim-bind-target-seg');
        
        if (!elemSelect || !segSelect) return;
        
        const elemId = elemSelect.value;
        const elem = this.state.config?.elements?.find(e => e.id === elemId);
        
        if (!elem) {
            segSelect.innerHTML = '<option value="">无可用段</option>';
            return;
        }
        
        // 显示该元素的所有段
        segSelect.innerHTML = elem.segments.map(s => {
            const hasBind = s.seg !== '' && s.com !== '';
            const status = hasBind ? ` [已绑定 SEG${s.seg}:COM${s.com}]` : ' [未绑定]';
            return `<option value="${s.name}">${s.name}${status}</option>`;
        }).join('');
    },
    
    confirmBind() {
        const elemSelect = document.getElementById('sim-bind-target-elem');
        const segSelect = document.getElementById('sim-bind-target-seg');
        
        if (!elemSelect || !segSelect) return;
        
        const targetElemId = elemSelect.value;
        const targetSegName = segSelect.value;
        
        const targetElem = this.state.config?.elements?.find(e => e.id === targetElemId);
        if (!targetElem) {
            alert('请选择目标元素！');
            return;
        }
        
        const targetSeg = targetElem.segments.find(s => s.name === targetSegName);
        if (!targetSeg) {
            alert('请选择目标段！');
            return;
        }
        
        // 如果只选了一个段码，直接绑定
        if (this.state.selectedSegments.length === 1) {
            const source = this.state.selectedSegments[0];
            const sourceElem = this.state.config.elements.find(e => e.id === source.elemId);
            const sourceSeg = sourceElem?.segments.find(s => s.name === source.segName);
            
            if (sourceSeg) {
                // 复制SEG:COM和像素数据
                targetSeg.seg = sourceSeg.seg;
                targetSeg.com = sourceSeg.com;
                targetSeg.pixelMask = new Set(sourceSeg.pixelMask || []);
                targetSeg.pixels = Array.from(sourceSeg.pixelMask || []);
                
                this.log(`绑定成功: ${source.elemName}.${source.segName} → ${targetElem.name}.${targetSegName}`, 'success');
            }
        } else {
            // 多个段码，按顺序绑定到digit的各段
            const segOrder = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
            let boundCount = 0;
            
            for (let i = 0; i < this.state.selectedSegments.length && i < segOrder.length; i++) {
                const source = this.state.selectedSegments[i];
                const sourceElem = this.state.config.elements.find(e => e.id === source.elemId);
                const sourceSeg = sourceElem?.segments.find(s => s.name === source.segName);
                
                const targetSegForBind = targetElem.segments.find(s => s.name === segOrder[i]);
                
                if (sourceSeg && targetSegForBind) {
                    targetSegForBind.seg = sourceSeg.seg;
                    targetSegForBind.com = sourceSeg.com;
                    targetSegForBind.pixelMask = new Set(sourceSeg.pixelMask || []);
                    targetSegForBind.pixels = Array.from(sourceSeg.pixelMask || []);
                    boundCount++;
                }
            }
            
            this.log(`批量绑定成功: ${boundCount} 个段码 → ${targetElem.name}`, 'success');
        }
        
        this.hideBindDialog();
        this.clearSelection();
        this.renderElementList();
        this.render();
    },
    
    // ========== 保存元素库 ==========
    async saveElements() {
        if (!this.state.config?.elements || this.state.config.elements.length === 0) {
            alert('没有元素可保存！');
            return;
        }
        
        const deviceId = document.getElementById('sim-device-select')?.value || 'gd303_mini';
        
        // 准备保存数据
        const saveData = {
            device: deviceId,
            saveTime: new Date().toISOString(),
            elements: this.state.config.elements.map(elem => ({
                id: elem.id,
                name: elem.name,
                type: elem.type,
                description: elem.description || '',
                segments: elem.segments.map(seg => ({
                    name: seg.name,
                    seg: seg.seg,
                    com: seg.com,
                    pixelCount: seg.pixelMask?.size || 0,
                    pixels: Array.from(seg.pixelMask || [])
                }))
            }))
        };
        
        try {
            // 保存到后端
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_elements_save', params: [deviceId, saveData] })
            });
            const result = await response.json();
            
            if (result.success) {
                this.log(`元素库已保存: ${saveData.elements.length} 个元素`, 'success');
                
                // 同时保存到localStorage
                localStorage.setItem('segment_editor_state', JSON.stringify({
                    version: '2.2',
                    savedAt: saveData.saveTime,
                    elements: saveData.elements
                }));
            } else {
                this.log(`保存失败: ${result.error}`, 'error');
            }
        } catch (err) {
            this.log(`保存失败: ${err.message}`, 'error');
            
            // 尝试只保存到localStorage
            try {
                localStorage.setItem('segment_editor_state', JSON.stringify({
                    version: '2.2',
                    savedAt: saveData.saveTime,
                    elements: saveData.elements
                }));
                this.log('已保存到本地存储', 'warning');
            } catch (e2) {
                this.log('本地保存也失败', 'error');
            }
        }
    },
    
    // 更新元素计数
    updateElementCount() {
        const countSpan = document.getElementById('sim-element-count');
        if (countSpan && this.state.config?.elements) {
            countSpan.textContent = `${this.state.config.elements.length} 个元素`;
        }
    },
    
    // ========== UI命令测试 ==========
    
    /**
     * 发送UI测试命令
     * @param {string} cmdCode - 命令码 (如 'B0', 'B3', 'BF')
     * @param {Array} params - 参数字节数组 (可选)
     */
    async sendUICmd(cmdCode, params = [0, 0, 0, 0]) {
        const cmdNames = {
            'B0': '开机', 'B3': 'K1短按', 'B4': 'K1长按', 'B5': 'K2短按',
            'B6': 'K2长按', 'B7': 'K3短按', 'B8': 'K3长按', 'B9': '状态(文本)',
            'BA': '蜂鸣器', 'BB': '关机', 'BC': 'LCD缓冲区', 'BD': '测距成功',
            'BE': '测距失败', 'BF': '状态(完整)', 'C0': '设置单位', 'C8': '段码测试', 'C9': 'K3释放', 'B1': 'K1释放'
        };
        
        const cmdName = cmdNames[cmdCode] || cmdCode;
        this.log(`发送命令: ${cmdCode} (${cmdName})`, 'info');
        
        try {
            // 构建HEX命令: AA EE [cmd] [p0] [p1] [p2] [p3] [xor] BB FF
            const cmdByte = parseInt(cmdCode, 16);
            let xor = cmdByte;
            for (let i = 0; i < 4; i++) {
                xor ^= (params[i] || 0);
            }
            
            const hexData = `AA EE ${cmdCode} ${(params[0]||0).toString(16).padStart(2,'0').toUpperCase()} ${(params[1]||0).toString(16).padStart(2,'0').toUpperCase()} ${(params[2]||0).toString(16).padStart(2,'0').toUpperCase()} ${(params[3]||0).toString(16).padStart(2,'0').toUpperCase()} ${xor.toString(16).padStart(2,'0').toUpperCase()} BB FF`;
            
            // 调用后端发送
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'ui_cmd_send', params: [hexData] })
            });
            const result = await response.json();
            
            if (result.success) {
                // 显示响应
                const statusDiv = document.getElementById('sim-ui-status');
                if (statusDiv) {
                    const respText = result.response_text || result.response_hex || '(无响应)';
                    statusDiv.innerHTML = `<span style="color:#4CAF50">✅ ${cmdName}</span><br><span style="font-family:monospace;font-size:10px;">${respText.substring(0, 200)}</span>`;
                }
                this.log(`命令成功: ${cmdName}`, 'success');
                
                // 自动同步LCD显示
                setTimeout(() => this.syncFromDevice(), 100);
            } else {
                const statusDiv = document.getElementById('sim-ui-status');
                if (statusDiv) {
                    statusDiv.innerHTML = `<span style="color:#f44336">❌ ${result.error || '发送失败'}</span>`;
                }
                this.log(`命令失败: ${result.error}`, 'error');
            }
        } catch (err) {
            this.log(`发送失败: ${err.message}`, 'error');
            const statusDiv = document.getElementById('sim-ui-status');
            if (statusDiv) {
                statusDiv.innerHTML = `<span style="color:#f44336">❌ ${err.message}</span>`;
            }
        }
    },
    
    /**
     * 模拟测距成功
     */
    async simMeasureOk() {
        const distInput = document.getElementById('sim-measure-dist');
        const dist = parseInt(distInput?.value || 5000);
        
        // 参数: [dist_H] [dist_L] [signal] [0]
        const params = [
            (dist >> 8) & 0xFF,
            dist & 0xFF,
            3,  // 信号强度
            0
        ];
        
        this.log(`模拟测距: ${dist}mm`, 'info');
        await this.sendUICmd('BD', params);
    },
    
    /**
     * 查询UI状态
     */
    async queryStatus() {
        this.log('查询UI状态...', 'info');
        
        try {
            const response = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'ui_cmd_send', params: ['AA EE BF 00 00 00 00 BF BB FF'] })
            });
            const result = await response.json();
            
            const statusDiv = document.getElementById('sim-ui-status');
            if (result.success && result.response_text) {
                // 解析文本响应: bf.s;power: ON;mode: SINGLE;...;bf.e
                const text = result.response_text;
                let parsed = {};
                
                // 提取 bf.s 和 bf.e 之间的内容
                const match = text.match(/bf\.s;(.+?);bf\.e/);
                if (match) {
                    const parts = match[1].split(';');
                    for (const part of parts) {
                        const [key, val] = part.split(':').map(s => s.trim());
                        if (key && val) parsed[key.toLowerCase()] = val;
                    }
                }
                
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;font-size:10px;">
                            <span>电源: <b style="color:#4CAF50">${parsed.power || '-'}</b></span>
                            <span>模式: <b style="color:#2196F3">${parsed.mode || '-'}</b></span>
                            <span>基准: <b>${parsed.base || '-'}</b></span>
                            <span>单位: <b>${parsed.unit || '-'}</b></span>
                            <span>激光: <b style="color:${parsed.laser==='ON'?'#f44336':'#888'}">${parsed.laser || '-'}</b></span>
                            <span>连续: <b>${parsed.continuous || '-'}</b></span>
                            <span>步骤: <b>${parsed.step || '-'}</b></span>
                            <span>类型: <b>${parsed.step_type || '-'}</b></span>
                        </div>
                    `;
                }
                this.log('状态查询成功', 'success');
            } else {
                if (statusDiv) {
                    statusDiv.innerHTML = `<span style="color:#f44336">❌ ${result.error || '查询失败'}</span>`;
                }
                this.log(`状态查询失败: ${result.error}`, 'error');
            }
        } catch (err) {
            this.log(`查询失败: ${err.message}`, 'error');
        }
    },
};

// 注册到全局
window.LcdSimulatorPage = LcdSimulatorPage;
