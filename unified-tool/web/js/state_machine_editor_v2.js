/**
 * 状态机可视化编辑器 V2 - 画布优先设计
 * 类似 Stately.ai 的交互体验
 */
window.SME2 = {
    // ==================== 状态数据 ====================
    machine: null,           // 当前状态机数据
    lcdProject: null,        // LCD配置
    
    // 画布状态
    canvas: null,
    ctx: null,
    zoom: 1,
    offset: { x: 0, y: 0 },
    
    // 交互状态
    tool: 'pointer',         // pointer, hand, state, transition
    isDragging: false,
    isPanning: false,
    dragStart: { x: 0, y: 0 },
    dragOffset: { x: 0, y: 0 },
    
    // 选中状态
    selectedNode: null,      // { type: 'state'|'transition', id: string }
    hoveredNode: null,
    
    // 节点位置 (状态ID -> {x, y})
    nodePositions: {},
    
    // 转移创建临时状态
    transitionDraft: null,   // { from: stateId, toPos: {x, y} }
    
    // 常量
    NODE_W: 140,
    NODE_H: 60,
    NODE_RADIUS: 8,
    HANDLE_SIZE: 10,
    
    // ==================== 初始化 ====================
    async init() {
        console.log('[SME2] 初始化画布编辑器...');
        
        // 获取画布
        this.canvas = document.getElementById('sme2-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // 初始化设备选择器
        if (window.DeviceConfigManager) {
            await DeviceConfigManager.init();
            DeviceConfigManager.createSelector('sme2-device-selector', async (deviceId) => {
                await this.loadDevice(deviceId);
            });
        }
        
        // 绑定事件
        this.bindEvents();
        
        // 调整画布大小
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // 加载当前设备
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (deviceId) {
            await this.loadDevice(deviceId);
        }
        
        // 开始渲染循环
        this.render();
    },
    
    // ==================== 事件绑定 ====================
    bindEvents() {
        const container = document.getElementById('sme2-canvas-container');
        
        // 鼠标事件
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e));
        
        // 右键菜单
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e);
        });
        
        // 键盘事件
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        
        // 状态机选择
        document.getElementById('sme2-machine-select')?.addEventListener('change', (e) => {
            if (e.target.value) this.loadMachine(e.target.value);
        });
    },
    
    // ==================== 画布操作 ====================
    resizeCanvas() {
        const container = document.getElementById('sme2-canvas-container');
        if (!container || !this.canvas) return;
        
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        this.ctx.scale(dpr, dpr);
        this.render();
    },
    
    // 屏幕坐标转画布坐标
    screenToCanvas(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (screenX - rect.left - this.offset.x) / this.zoom,
            y: (screenY - rect.top - this.offset.y) / this.zoom
        };
    },
    
    // 画布坐标转屏幕坐标
    canvasToScreen(canvasX, canvasY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: canvasX * this.zoom + this.offset.x + rect.left,
            y: canvasY * this.zoom + this.offset.y + rect.top
        };
    },
    
    // ==================== 鼠标事件处理 ====================
    onMouseDown(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        this.dragStart = { x: e.clientX, y: e.clientY };
        
        // 手型工具 - 平移画布
        if (this.tool === 'hand' || e.button === 1) {
            this.isPanning = true;
            this.canvas.style.cursor = 'grabbing';
            return;
        }
        
        // 空格键 + 拖拽 = 平移
        if (e.spaceKey) {
            this.isPanning = true;
            return;
        }
        
        // 检查是否点击了节点
        const hitNode = this.hitTest(pos);
        
        if (this.tool === 'pointer') {
            if (hitNode) {
                this.selectNode(hitNode);
                if (hitNode.type === 'state') {
                    this.isDragging = true;
                    const nodePos = this.nodePositions[hitNode.id] || { x: 0, y: 0 };
                    this.dragOffset = {
                        x: pos.x - nodePos.x,
                        y: pos.y - nodePos.y
                    };
                }
            } else {
                this.deselectAll();
            }
        } else if (this.tool === 'transition') {
            // 开始创建转移
            if (hitNode && hitNode.type === 'state') {
                this.transitionDraft = {
                    from: hitNode.id,
                    toPos: pos
                };
            }
        }
    },
    
    onMouseMove(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        
        // 更新状态栏位置
        document.getElementById('sme2-status-pos').textContent = 
            `X: ${Math.round(pos.x)}, Y: ${Math.round(pos.y)}`;
        
        // 平移画布
        if (this.isPanning) {
            const dx = e.clientX - this.dragStart.x;
            const dy = e.clientY - this.dragStart.y;
            this.offset.x += dx;
            this.offset.y += dy;
            this.dragStart = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }
        
        // 拖拽节点
        if (this.isDragging && this.selectedNode?.type === 'state') {
            const newX = pos.x - this.dragOffset.x;
            const newY = pos.y - this.dragOffset.y;
            this.nodePositions[this.selectedNode.id] = { x: newX, y: newY };
            this.render();
            return;
        }
        
        // 创建转移中
        if (this.transitionDraft) {
            this.transitionDraft.toPos = pos;
            this.render();
            return;
        }
        
        // 悬停检测
        const hitNode = this.hitTest(pos);
        if (hitNode !== this.hoveredNode) {
            this.hoveredNode = hitNode;
            this.canvas.style.cursor = hitNode ? 'pointer' : 'default';
            this.render();
        }
    },
    
    onMouseUp(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        
        // 结束平移
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = this.tool === 'hand' ? 'grab' : 'default';
        }
        
        // 结束拖拽
        this.isDragging = false;
        
        // 完成转移创建
        if (this.transitionDraft) {
            const hitNode = this.hitTest(pos);
            if (hitNode && hitNode.type === 'state' && hitNode.id !== this.transitionDraft.from) {
                this.createTransition(this.transitionDraft.from, hitNode.id);
            }
            this.transitionDraft = null;
            this.render();
        }
    },
    
    onDoubleClick(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        const hitNode = this.hitTest(pos);
        
        if (hitNode) {
            // 双击节点 - 编辑
            if (hitNode.type === 'state') {
                this.editState(hitNode.id);
            }
        } else {
            // 双击空白 - 添加状态
            this.showQuickMenu(e.clientX, e.clientY, pos);
        }
    },
    
    onWheel(e) {
        e.preventDefault();
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // 计算缩放
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.1, Math.min(3, this.zoom * delta));
        
        // 以鼠标位置为中心缩放
        const scale = newZoom / this.zoom;
        this.offset.x = mouseX - (mouseX - this.offset.x) * scale;
        this.offset.y = mouseY - (mouseY - this.offset.y) * scale;
        this.zoom = newZoom;
        
        // 更新缩放指示器
        document.getElementById('sme2-zoom-indicator').textContent = 
            Math.round(this.zoom * 100) + '%';
        
        this.render();
    },
    
    onKeyDown(e) {
        // Delete - 删除选中
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.selectedNode && !e.target.matches('input, textarea')) {
                this.deleteSelected();
            }
        }
        
        // Escape - 取消操作
        if (e.key === 'Escape') {
            this.transitionDraft = null;
            this.hideQuickMenu();
            this.deselectAll();
            this.render();
        }
        
        // 空格 - 临时切换到手型工具
        if (e.key === ' ' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.canvas.style.cursor = 'grab';
        }
    },
    
    // ==================== 碰撞检测 ====================
    hitTest(pos) {
        if (!this.machine) return null;
        
        // 检测状态节点
        for (const [stateId, state] of Object.entries(this.machine.states || {})) {
            const nodePos = this.nodePositions[stateId];
            if (!nodePos) continue;
            
            if (pos.x >= nodePos.x && pos.x <= nodePos.x + this.NODE_W &&
                pos.y >= nodePos.y && pos.y <= nodePos.y + this.NODE_H) {
                return { type: 'state', id: stateId };
            }
        }
        
        // TODO: 检测转移线
        
        return null;
    },
    
    // ==================== 渲染 ====================
    render() {
        if (!this.ctx) return;
        
        const dpr = window.devicePixelRatio || 1;
        const width = this.canvas.width / dpr;
        const height = this.canvas.height / dpr;
        
        // 清空画布
        this.ctx.clearRect(0, 0, width, height);
        
        // 绘制背景网格
        this.drawGrid(width, height);
        
        // 应用变换
        this.ctx.save();
        this.ctx.translate(this.offset.x, this.offset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        // 绘制转移线
        this.drawTransitions();
        
        // 绘制转移草稿
        if (this.transitionDraft) {
            this.drawTransitionDraft();
        }
        
        // 绘制状态节点
        this.drawNodes();
        
        this.ctx.restore();
        
        // 更新空状态提示
        const emptyHint = document.getElementById('sme2-empty-hint');
        if (emptyHint) {
            emptyHint.style.display = 
                (!this.machine || Object.keys(this.machine.states || {}).length === 0) 
                    ? 'block' : 'none';
        }
        
        // 更新统计
        this.updateStats();
    },
    
    drawGrid(width, height) {
        const gridSize = 20 * this.zoom;
        const offsetX = this.offset.x % gridSize;
        const offsetY = this.offset.y % gridSize;
        
        this.ctx.strokeStyle = '#2a2a2a';
        this.ctx.lineWidth = 1;
        
        // 垂直线
        for (let x = offsetX; x < width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }
        
        // 水平线
        for (let y = offsetY; y < height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
            this.ctx.stroke();
        }
    },
    
    drawNodes() {
        if (!this.machine?.states) return;
        
        const ctx = this.ctx;
        const initialState = this.machine.initialState;
        
        for (const [stateId, state] of Object.entries(this.machine.states)) {
            const pos = this.nodePositions[stateId];
            if (!pos) continue;
            
            const isSelected = this.selectedNode?.type === 'state' && this.selectedNode?.id === stateId;
            const isHovered = this.hoveredNode?.type === 'state' && this.hoveredNode?.id === stateId;
            const isInitial = stateId === initialState;
            const isCompound = state.type === 'compound';
            
            // 节点背景
            ctx.fillStyle = isCompound ? '#2d3748' : '#1e293b';
            ctx.strokeStyle = isSelected ? '#22c55e' : (isHovered ? '#3b82f6' : '#475569');
            ctx.lineWidth = isSelected ? 2 : 1;
            
            this.roundRect(ctx, pos.x, pos.y, this.NODE_W, this.NODE_H, this.NODE_RADIUS);
            ctx.fill();
            ctx.stroke();
            
            // 初始状态标记
            if (isInitial) {
                ctx.fillStyle = '#22c55e';
                ctx.beginPath();
                ctx.arc(pos.x - 15, pos.y + this.NODE_H / 2, 6, 0, Math.PI * 2);
                ctx.fill();
                
                // 箭头
                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(pos.x - 9, pos.y + this.NODE_H / 2);
                ctx.lineTo(pos.x, pos.y + this.NODE_H / 2);
                ctx.stroke();
            }
            
            // 状态ID
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 12px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(stateId, pos.x + this.NODE_W / 2, pos.y + 20);
            
            // 状态标签
            if (state.label) {
                ctx.fillStyle = '#94a3b8';
                ctx.font = '11px -apple-system, sans-serif';
                ctx.fillText(state.label, pos.x + this.NODE_W / 2, pos.y + 40);
            }
            
            // 复合状态图标
            if (isCompound) {
                ctx.fillStyle = '#f59e0b';
                ctx.font = '10px -apple-system, sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('📁', pos.x + 6, pos.y + 14);
            }
            
            // 连接点 (悬停时显示)
            if (isHovered || isSelected) {
                this.drawHandles(pos);
            }
        }
    },
    
    drawHandles(pos) {
        const ctx = this.ctx;
        const handles = [
            { x: pos.x + this.NODE_W / 2, y: pos.y },                    // 上
            { x: pos.x + this.NODE_W, y: pos.y + this.NODE_H / 2 },      // 右
            { x: pos.x + this.NODE_W / 2, y: pos.y + this.NODE_H },      // 下
            { x: pos.x, y: pos.y + this.NODE_H / 2 }                     // 左
        ];
        
        ctx.fillStyle = '#3b82f6';
        for (const h of handles) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    },
    
    drawTransitions() {
        if (!this.machine?.transitions) return;
        
        const ctx = this.ctx;
        const events = this.machine.events || {};
        const eventCategories = this.machine.eventCategories || {};
        
        for (const trans of this.machine.transitions) {
            const fromPos = this.nodePositions[trans.from];
            const toPos = this.nodePositions[trans.to];
            if (!fromPos || !toPos) continue;
            
            // 计算连接点
            const from = this.getConnectionPoint(fromPos, toPos);
            const to = this.getConnectionPoint(toPos, fromPos);
            
            // 获取事件颜色
            const evt = events[trans.event] || {};
            const category = eventCategories[evt.category] || {};
            const color = category.color || '#64748b';
            
            // 绘制曲线
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            const ctrlOffset = 30;
            
            // 简单直线或贝塞尔曲线
            if (trans.from === trans.to) {
                // 自循环
                ctx.arc(fromPos.x + this.NODE_W / 2, fromPos.y - 20, 20, 0.2 * Math.PI, 0.8 * Math.PI);
            } else {
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
            }
            ctx.stroke();
            
            // 箭头
            this.drawArrow(ctx, from, to, color);
            
            // 事件标签
            const labelX = midX;
            const labelY = midY - 10;
            
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(labelX - 30, labelY - 8, 60, 16);
            
            ctx.fillStyle = color;
            ctx.font = '10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(evt.label || trans.event, labelX, labelY);
        }
    },
    
    drawTransitionDraft() {
        if (!this.transitionDraft) return;
        
        const fromPos = this.nodePositions[this.transitionDraft.from];
        if (!fromPos) return;
        
        const from = {
            x: fromPos.x + this.NODE_W / 2,
            y: fromPos.y + this.NODE_H / 2
        };
        const to = this.transitionDraft.toPos;
        
        this.ctx.strokeStyle = '#22c55e';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(to.x, to.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // 箭头
        this.drawArrow(this.ctx, from, to, '#22c55e');
    },
    
    drawArrow(ctx, from, to, color) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowLen = 10;
        
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
            to.x - arrowLen * Math.cos(angle - Math.PI / 6),
            to.y - arrowLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            to.x - arrowLen * Math.cos(angle + Math.PI / 6),
            to.y - arrowLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
    },
    
    getConnectionPoint(fromPos, toPos) {
        const fromCenter = {
            x: fromPos.x + this.NODE_W / 2,
            y: fromPos.y + this.NODE_H / 2
        };
        const toCenter = {
            x: toPos.x + this.NODE_W / 2,
            y: toPos.y + this.NODE_H / 2
        };
        
        const dx = toCenter.x - fromCenter.x;
        const dy = toCenter.y - fromCenter.y;
        const angle = Math.atan2(dy, dx);
        
        // 简化：从边缘出发
        if (Math.abs(dx) > Math.abs(dy)) {
            return {
                x: fromCenter.x + (dx > 0 ? this.NODE_W / 2 : -this.NODE_W / 2),
                y: fromCenter.y
            };
        } else {
            return {
                x: fromCenter.x,
                y: fromCenter.y + (dy > 0 ? this.NODE_H / 2 : -this.NODE_H / 2)
            };
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
    
    // ==================== 工具切换 ====================
    setTool(tool) {
        this.tool = tool;
        
        // 更新工具按钮状态
        document.querySelectorAll('.sme2-tool-btn[data-tool]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        
        // 更新光标
        const cursors = {
            pointer: 'default',
            hand: 'grab',
            state: 'crosshair',
            transition: 'crosshair'
        };
        this.canvas.style.cursor = cursors[tool] || 'default';
        
        // 更新状态栏
        const toolNames = {
            pointer: '选择',
            hand: '平移',
            state: '添加状态',
            transition: '添加转移'
        };
        document.getElementById('sme2-status-tool').textContent = '工具: ' + toolNames[tool];
    },

    // ==================== 视图控制 ====================
    zoomIn() {
        this.zoom = Math.min(3, this.zoom * 1.2);
        document.getElementById('sme2-zoom-indicator').textContent = Math.round(this.zoom * 100) + '%';
        this.render();
    },
    
    zoomOut() {
        this.zoom = Math.max(0.1, this.zoom / 1.2);
        document.getElementById('sme2-zoom-indicator').textContent = Math.round(this.zoom * 100) + '%';
        this.render();
    },
    
    fitView() {
        if (!this.machine?.states || Object.keys(this.machine.states).length === 0) return;
        
        // 计算边界
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pos of Object.values(this.nodePositions)) {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + this.NODE_W);
            maxY = Math.max(maxY, pos.y + this.NODE_H);
        }
        
        const container = document.getElementById('sme2-canvas-container');
        const padding = 50;
        const contentW = maxX - minX + padding * 2;
        const contentH = maxY - minY + padding * 2;
        
        this.zoom = Math.min(
            container.clientWidth / contentW,
            container.clientHeight / contentH,
            1.5
        );
        
        this.offset.x = (container.clientWidth - contentW * this.zoom) / 2 - minX * this.zoom + padding * this.zoom;
        this.offset.y = (container.clientHeight - contentH * this.zoom) / 2 - minY * this.zoom + padding * this.zoom;
        
        document.getElementById('sme2-zoom-indicator').textContent = Math.round(this.zoom * 100) + '%';
        this.render();
    },
    
    resetView() {
        this.zoom = 1;
        this.offset = { x: 100, y: 100 };
        document.getElementById('sme2-zoom-indicator').textContent = '100%';
        this.render();
    },
    
    // ==================== 选择操作 ====================
    selectNode(node) {
        this.selectedNode = node;
        
        // 更新状态栏
        document.getElementById('sme2-status-selection').textContent = 
            node ? `选中: ${node.type === 'state' ? '状态' : '转移'} ${node.id}` : '未选中';
        
        // 显示属性面板
        this.showPropertyPanel(node);
        this.render();
    },
    
    deselectAll() {
        this.selectedNode = null;
        document.getElementById('sme2-status-selection').textContent = '未选中';
        
        // 显示概览面板
        document.getElementById('sme2-overview-panel').style.display = 'block';
        document.getElementById('sme2-state-panel').style.display = 'none';
        document.getElementById('sme2-transition-panel').style.display = 'none';
        
        this.render();
    },
    
    // ==================== 属性面板 ====================
    showPropertyPanel(node) {
        const overviewPanel = document.getElementById('sme2-overview-panel');
        const statePanel = document.getElementById('sme2-state-panel');
        const transitionPanel = document.getElementById('sme2-transition-panel');
        
        overviewPanel.style.display = 'none';
        statePanel.style.display = 'none';
        transitionPanel.style.display = 'none';
        
        if (!node) {
            overviewPanel.style.display = 'block';
            return;
        }
        
        if (node.type === 'state') {
            statePanel.style.display = 'block';
            this.populateStatePanel(node.id);
        } else if (node.type === 'transition') {
            transitionPanel.style.display = 'block';
            this.populateTransitionPanel(node.id);
        }
    },
    
    populateStatePanel(stateId) {
        const state = this.machine?.states?.[stateId];
        if (!state) return;
        
        document.getElementById('sme2-state-id').value = stateId;
        document.getElementById('sme2-state-label').value = state.label || '';
        document.getElementById('sme2-state-type').value = state.type || 'atomic';
        document.getElementById('sme2-state-desc').value = state.description || '';
        
        // 渲染LCD组件编辑器
        this.renderLcdComponents(state.display || {});
        
        // 更新LCD预览
        this.updateLcdPreview(state.display || {});
    },
    
    renderLcdComponents(display) {
        const container = document.getElementById('sme2-lcd-components');
        if (!container) return;
        
        const components = this.lcdProject?.components || {};
        let html = '';
        
        for (const [compId, comp] of Object.entries(components)) {
            const value = display[compId];
            html += this.renderLcdComponentEditor(compId, comp, value);
        }
        
        container.innerHTML = html || '<div style="color:var(--text-muted);font-size:11px;">无LCD组件配置</div>';
    },
    
    renderLcdComponentEditor(compId, comp, value) {
        const type = comp.type;
        let inputHtml = '';
        
        switch (type) {
            case 'digit_group':
                inputHtml = `<input type="text" value="${value !== undefined ? value : '-----'}" 
                    onchange="SME2.updateDisplayField('${compId}', this.value)">`;
                break;
                
            case 'select_one':
                const options = comp.options || {};
                inputHtml = '<div class="sme2-radio-group">';
                for (const [optId, opt] of Object.entries(options)) {
                    const checked = value === optId ? 'checked' : '';
                    inputHtml += `<label><input type="radio" name="sme2-lcd-${compId}" value="${optId}" ${checked}
                        onchange="SME2.updateDisplayField('${compId}', '${optId}')">${opt.label || optId}</label>`;
                }
                inputHtml += '</div>';
                break;
                
            case 'icon':
                const checked = value ? 'checked' : '';
                inputHtml = `<label style="display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" ${checked} onchange="SME2.updateDisplayField('${compId}', this.checked)">点亮</label>`;
                break;
                
            case 'level':
                const levels = comp.levels || [];
                inputHtml = `<select onchange="SME2.updateDisplayField('${compId}', parseInt(this.value))">
                    <option value="0" ${value === 0 ? 'selected' : ''}>关闭</option>`;
                for (let i = 1; i <= levels.length; i++) {
                    inputHtml += `<option value="${i}" ${value === i ? 'selected' : ''}>${i}格</option>`;
                }
                inputHtml += '</select>';
                break;
                
            default:
                inputHtml = `<span style="color:var(--text-muted);font-size:10px;">未知类型</span>`;
        }
        
        return `<div class="sme2-lcd-component">
            <span class="sme2-lcd-component-label">${comp.label || compId}</span>
            <div class="sme2-lcd-component-input">${inputHtml}</div>
        </div>`;
    },
    
    updateStateProperty(field, value) {
        if (!this.selectedNode || this.selectedNode.type !== 'state') return;
        
        const stateId = this.selectedNode.id;
        if (!this.machine.states[stateId]) return;
        
        this.machine.states[stateId][field] = value;
        this.markModified();
        this.render();
    },
    
    updateDisplayField(compId, value) {
        if (!this.selectedNode || this.selectedNode.type !== 'state') return;
        
        const stateId = this.selectedNode.id;
        const state = this.machine.states[stateId];
        if (!state) return;
        
        if (!state.display) state.display = {};
        state.display[compId] = value;
        
        this.updateLcdPreview(state.display);
        this.markModified();
    },
    
    updateLcdPreview(display) {
        const canvas = document.getElementById('sme2-lcd-canvas');
        if (!canvas || !this.lcdProject) return;
        
        const ctx = canvas.getContext('2d');
        canvas.width = this.lcdProject.imageWidth || 200;
        canvas.height = this.lcdProject.imageHeight || 100;
        
        // 背景
        ctx.fillStyle = '#d0d0c8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (!display || Object.keys(display).length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('配置LCD显示', canvas.width / 2, canvas.height / 2);
            return;
        }
        
        // 收集点亮元素并渲染
        const litElements = this.collectLitElements(display);
        ctx.fillStyle = '#1a1a1a';
        for (const elemName of litElements) {
            this.renderLcdElement(ctx, elemName);
        }
    },
    
    collectLitElements(display) {
        const litElements = [];
        const components = this.lcdProject?.components || {};
        const font = this.lcdProject?.font || {};
        
        for (const [compId, value] of Object.entries(display)) {
            const comp = components[compId];
            if (!comp) continue;
            
            switch (comp.type) {
                case 'digit_group':
                    if (value !== undefined && value !== null) {
                        const str = String(value);
                        const digits = comp.digits || [];
                        const decimals = comp.decimals || [];
                        
                        let chars = [];
                        let dpPos = -1;
                        
                        if (str === '-----' || str === '') {
                            chars = ['-', '-', '-', '-', '-'];
                        } else {
                            const num = parseFloat(str);
                            if (!isNaN(num)) {
                                const formatted = this.formatNumber(num, digits.length);
                                chars = formatted.chars;
                                dpPos = formatted.dpPos;
                            } else {
                                chars = str.split('').slice(0, digits.length);
                            }
                        }
                        
                        for (let i = 0; i < digits.length && i < chars.length; i++) {
                            const char = chars[i];
                            const segments = font[char] || [];
                            for (const seg of segments) {
                                litElements.push(`${digits[i]}_${seg}`);
                            }
                        }
                        
                        if (dpPos >= 0 && dpPos < decimals.length) {
                            litElements.push(decimals[dpPos]);
                        }
                    }
                    break;
                    
                case 'select_one':
                    if (value && comp.options?.[value]) {
                        const elements = comp.options[value].elements || [];
                        litElements.push(...elements);
                    }
                    break;
                    
                case 'icon':
                    if (value && comp.element) {
                        litElements.push(comp.element);
                    }
                    break;
                    
                case 'level':
                    const levels = comp.levels || [];
                    const level = parseInt(value) || 0;
                    if (comp.frame) litElements.push(comp.frame);
                    for (let i = 0; i < level && i < levels.length; i++) {
                        litElements.push(levels[i]);
                    }
                    break;
            }
        }
        
        return litElements;
    },
    
    formatNumber(num, digitCount) {
        const isNeg = num < 0;
        const absNum = Math.abs(num);
        
        let decimals = 3;
        if (absNum >= 100) decimals = 2;
        if (absNum >= 1000) decimals = 1;
        if (absNum >= 10000) decimals = 0;
        
        const str = absNum.toFixed(decimals);
        const parts = str.split('.');
        const intPart = parts[0];
        const decPart = parts[1] || '';
        
        let chars = [];
        let dpPos = -1;
        
        if (isNeg) chars.push('-');
        for (const c of intPart) chars.push(c);
        
        if (decPart) {
            dpPos = chars.length - 1;
            for (const c of decPart) chars.push(c);
        }
        
        while (chars.length < digitCount) {
            chars.unshift(' ');
            if (dpPos >= 0) dpPos++;
        }
        
        if (chars.length > digitCount) {
            chars = chars.slice(0, digitCount);
        }
        
        return { chars, dpPos };
    },
    
    renderLcdElement(ctx, elemName) {
        const elements = this.lcdProject?.elements || [];
        
        for (const elem of elements) {
            if (elem.name === elemName) {
                if (elem.segments) {
                    for (const seg of elem.segments) {
                        if (seg.pixels?.length > 0) {
                            this.renderPixels(ctx, seg.pixels);
                        }
                    }
                }
                return;
            }
            
            if (elemName.includes('_')) {
                const parts = elemName.split('_');
                const segName = parts.pop();
                const baseName = parts.join('_');
                if (elem.name === baseName) {
                    const seg = elem.segments?.find(s => s.name === segName);
                    if (seg?.pixels?.length > 0) {
                        this.renderPixels(ctx, seg.pixels);
                    }
                    return;
                }
            }
        }
    },
    
    renderPixels(ctx, pixels) {
        for (const pixel of pixels) {
            const [x, y] = pixel.split(',').map(Number);
            ctx.fillRect(x, y, 1, 1);
        }
    },
    
    populateTransitionPanel(transIndex) {
        const trans = this.machine?.transitions?.[transIndex];
        if (!trans) return;
        
        document.getElementById('sme2-trans-from').value = trans.from;
        document.getElementById('sme2-trans-to').value = trans.to;
        
        // 填充事件选择
        const eventSelect = document.getElementById('sme2-trans-event');
        const events = this.machine.events || {};
        eventSelect.innerHTML = Object.entries(events)
            .map(([id, e]) => `<option value="${id}" ${trans.event === id ? 'selected' : ''}>${e.label || id}</option>`)
            .join('');
        
        // 填充动作选择
        const actionsContainer = document.getElementById('sme2-trans-actions');
        const actions = this.machine.actions || {};
        actionsContainer.innerHTML = Object.entries(actions)
            .map(([id, a]) => {
                const checked = (trans.actions || []).includes(id) ? 'checked' : '';
                return `<label><input type="checkbox" value="${id}" ${checked} 
                    onchange="SME2.updateTransitionActions()">${a.description || id}</label>`;
            }).join('');
        
        document.getElementById('sme2-trans-guard').value = trans.guard || '';
    },
    
    updateTransitionProperty(field, value) {
        if (!this.selectedNode || this.selectedNode.type !== 'transition') return;
        
        const transIndex = this.selectedNode.id;
        if (!this.machine.transitions[transIndex]) return;
        
        this.machine.transitions[transIndex][field] = value;
        this.markModified();
        this.render();
    },
    
    updateTransitionActions() {
        if (!this.selectedNode || this.selectedNode.type !== 'transition') return;
        
        const transIndex = this.selectedNode.id;
        const checkboxes = document.querySelectorAll('#sme2-trans-actions input:checked');
        const actions = Array.from(checkboxes).map(cb => cb.value);
        
        this.machine.transitions[transIndex].actions = actions;
        this.markModified();
    },

    // ==================== 快捷菜单 ====================
    showQuickMenu(screenX, screenY, canvasPos) {
        const menu = document.getElementById('sme2-quick-menu');
        menu.style.display = 'block';
        menu.style.left = screenX + 'px';
        menu.style.top = screenY + 'px';
        menu._canvasPos = canvasPos;
        
        document.getElementById('sme2-quick-state-id').value = '';
        document.getElementById('sme2-quick-state-label').value = '';
        document.getElementById('sme2-quick-state-id').focus();
    },
    
    hideQuickMenu() {
        document.getElementById('sme2-quick-menu').style.display = 'none';
    },
    
    confirmQuickAdd() {
        const menu = document.getElementById('sme2-quick-menu');
        const id = document.getElementById('sme2-quick-state-id').value.trim().toUpperCase();
        const label = document.getElementById('sme2-quick-state-label').value.trim();
        const pos = menu._canvasPos || { x: 100, y: 100 };
        
        if (!id) {
            alert('请输入状态ID');
            return;
        }
        
        this.addState(id, label, pos);
        this.hideQuickMenu();
    },
    
    // ==================== 状态操作 ====================
    addState(id, label, pos) {
        if (!this.machine) {
            this.machine = this.createEmptyMachine();
        }
        
        if (this.machine.states[id]) {
            alert('状态ID已存在');
            return;
        }
        
        this.machine.states[id] = {
            label: label || id,
            type: 'atomic',
            description: '',
            display: { line4: '-----' }
        };
        
        this.nodePositions[id] = pos || { x: 100, y: 100 };
        
        // 如果是第一个状态，设为初始状态
        if (Object.keys(this.machine.states).length === 1) {
            this.machine.initialState = id;
        }
        
        this.markModified();
        this.selectNode({ type: 'state', id });
        this.render();
    },
    
    createTransition(fromId, toId) {
        if (!this.machine) return;
        
        // 检查是否已存在相同转移
        const exists = this.machine.transitions.some(t => t.from === fromId && t.to === toId);
        if (exists) {
            alert('该转移已存在');
            return;
        }
        
        // 获取第一个事件作为默认
        const events = Object.keys(this.machine.events || {});
        const defaultEvent = events[0] || 'EVENT';
        
        this.machine.transitions.push({
            from: fromId,
            to: toId,
            event: defaultEvent,
            actions: []
        });
        
        this.markModified();
        this.render();
    },
    
    deleteSelected() {
        if (!this.selectedNode || !this.machine) return;
        
        if (this.selectedNode.type === 'state') {
            const stateId = this.selectedNode.id;
            
            // 删除状态
            delete this.machine.states[stateId];
            delete this.nodePositions[stateId];
            
            // 删除相关转移
            this.machine.transitions = this.machine.transitions.filter(
                t => t.from !== stateId && t.to !== stateId
            );
            
            // 更新初始状态
            if (this.machine.initialState === stateId) {
                const remaining = Object.keys(this.machine.states);
                this.machine.initialState = remaining[0] || null;
            }
        } else if (this.selectedNode.type === 'transition') {
            this.machine.transitions.splice(this.selectedNode.id, 1);
        }
        
        this.deselectAll();
        this.markModified();
        this.render();
    },
    
    duplicateSelected() {
        if (!this.selectedNode || this.selectedNode.type !== 'state') return;
        
        const stateId = this.selectedNode.id;
        const state = this.machine.states[stateId];
        const pos = this.nodePositions[stateId];
        
        if (!state || !pos) return;
        
        // 生成新ID
        let newId = stateId + '_COPY';
        let i = 1;
        while (this.machine.states[newId]) {
            newId = stateId + '_COPY' + i++;
        }
        
        // 复制状态
        this.machine.states[newId] = JSON.parse(JSON.stringify(state));
        this.machine.states[newId].label = (state.label || stateId) + ' (副本)';
        
        // 偏移位置
        this.nodePositions[newId] = {
            x: pos.x + 30,
            y: pos.y + 30
        };
        
        this.markModified();
        this.selectNode({ type: 'state', id: newId });
        this.render();
    },
    
    // ==================== 自动布局 ====================
    autoLayout() {
        if (!this.machine?.states) return;
        
        const states = Object.keys(this.machine.states);
        const transitions = this.machine.transitions || [];
        
        // 简单的层级布局
        const levels = {};
        const visited = new Set();
        
        // BFS确定层级
        const queue = [this.machine.initialState || states[0]];
        levels[queue[0]] = 0;
        visited.add(queue[0]);
        
        while (queue.length > 0) {
            const current = queue.shift();
            const currentLevel = levels[current];
            
            for (const t of transitions) {
                if (t.from === current && !visited.has(t.to)) {
                    levels[t.to] = currentLevel + 1;
                    visited.add(t.to);
                    queue.push(t.to);
                }
            }
        }
        
        // 未访问的状态放到最后一层
        let maxLevel = Math.max(...Object.values(levels), 0);
        for (const s of states) {
            if (!visited.has(s)) {
                levels[s] = ++maxLevel;
            }
        }
        
        // 按层级分组
        const levelGroups = {};
        for (const [s, l] of Object.entries(levels)) {
            if (!levelGroups[l]) levelGroups[l] = [];
            levelGroups[l].push(s);
        }
        
        // 计算位置
        const startX = 100;
        const startY = 100;
        const gapX = 200;
        const gapY = 100;
        
        for (const [level, group] of Object.entries(levelGroups)) {
            const l = parseInt(level);
            for (let i = 0; i < group.length; i++) {
                this.nodePositions[group[i]] = {
                    x: startX + l * gapX,
                    y: startY + i * gapY
                };
            }
        }
        
        this.fitView();
    },
    
    // ==================== 数据加载/保存 ====================
    async loadDevice(deviceId) {
        console.log('[SME2] 加载设备:', deviceId);
        document.getElementById('sme2-status-device').textContent = '设备: ' + deviceId;
        
        // 加载LCD配置
        this.lcdProject = await DeviceConfigManager.loadLcdProject(deviceId);
        
        // 加载状态机列表
        await this.loadMachineList(deviceId);
    },
    
    async loadMachineList(deviceId) {
        const select = document.getElementById('sme2-machine-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- 选择状态机 --</option>';
        
        try {
            const response = await fetch(`/api/dm/config/load?device_id=${deviceId}&type=ui`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data) {
                    select.innerHTML += `<option value="default">${data.data.name || '默认状态机'}</option>`;
                }
            }
        } catch (e) {
            console.log('暂无状态机配置');
        }
    },
    
    async loadMachine(machineId) {
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (!deviceId) return;
        
        try {
            const response = await fetch(`/api/dm/config/load?device_id=${deviceId}&type=ui`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.machine = data.data;
                    this.initNodePositions();
                    this.deselectAll();
                    this.fitView();
                }
            }
        } catch (e) {
            console.error('加载状态机失败:', e);
        }
    },
    
    initNodePositions() {
        if (!this.machine?.states) return;
        
        // 如果有保存的位置，使用保存的
        if (this.machine.nodePositions) {
            this.nodePositions = { ...this.machine.nodePositions };
            return;
        }
        
        // 否则自动布局
        this.autoLayout();
    },
    
    createEmptyMachine() {
        return {
            device: DeviceConfigManager?.getCurrentDevice() || 'unknown',
            name: '新状态机',
            version: '1.0',
            eventCategories: {
                key: { label: '按键事件', color: '#3b82f6' },
                hardware: { label: '硬件事件', color: '#f59e0b' },
                measure: { label: '测量事件', color: '#22c55e' },
                comm: { label: '通信事件', color: '#8b5cf6' },
                system: { label: '系统事件', color: '#ef4444' }
            },
            events: {
                'K1_SHORT': { category: 'key', label: 'K1短按' },
                'K2_SHORT': { category: 'key', label: 'K2短按' },
                'K3_SHORT': { category: 'key', label: 'K3短按' },
                'MEASURE_OK': { category: 'measure', label: '测距成功' },
                'MEASURE_FAIL': { category: 'measure', label: '测距失败' }
            },
            states: {},
            transitions: [],
            globalTransitions: [],
            actions: {},
            variables: {},
            initialState: null
        };
    },
    
    newMachine() {
        this.machine = this.createEmptyMachine();
        this.nodePositions = {};
        this.deselectAll();
        this.markModified();
        this.render();
    },
    
    async saveMachine() {
        if (!this.machine) {
            alert('没有可保存的状态机');
            return;
        }
        
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (!deviceId) {
            alert('请先选择设备');
            return;
        }
        
        // 保存节点位置
        this.machine.nodePositions = { ...this.nodePositions };
        
        try {
            const response = await fetch('/api/dm/config/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: deviceId,
                    type: 'ui',
                    data: this.machine
                })
            });
            
            const result = await response.json();
            if (result.success) {
                alert('保存成功!');
                this.clearModified();
            } else {
                alert('保存失败: ' + result.error);
            }
        } catch (e) {
            alert('保存失败: ' + e.message);
        }
    },
    
    markModified() {
        document.getElementById('sme2-status-modified').textContent = '● 已修改';
        document.getElementById('sme2-status-modified').style.color = '#f59e0b';
    },
    
    clearModified() {
        document.getElementById('sme2-status-modified').textContent = '';
    },
    
    // ==================== 统计更新 ====================
    updateStats() {
        const stateCount = Object.keys(this.machine?.states || {}).length;
        const transCount = (this.machine?.transitions || []).length;
        const eventCount = Object.keys(this.machine?.events || {}).length;
        
        document.getElementById('sme2-stat-states').textContent = stateCount;
        document.getElementById('sme2-stat-transitions').textContent = transCount;
        document.getElementById('sme2-stat-events').textContent = eventCount;
    },
    
    // ==================== 快速开始 ====================
    async quickStart() {
        const deviceId = DeviceConfigManager?.getCurrentDevice();
        if (!deviceId) {
            alert('请先选择设备');
            return;
        }
        
        // 尝试加载已有状态机
        const select = document.getElementById('sme2-machine-select');
        if (select && select.options.length > 1) {
            select.selectedIndex = 1;
            await this.loadMachine(select.value);
        } else {
            // 创建示例状态机
            this.createExampleMachine();
        }
    },
    
    createExampleMachine() {
        this.machine = {
            device: DeviceConfigManager?.getCurrentDevice() || 'unknown',
            name: '测距仪示例状态机',
            version: '1.0',
            eventCategories: {
                key: { label: '按键事件', color: '#3b82f6' },
                measure: { label: '测量事件', color: '#22c55e' },
                system: { label: '系统事件', color: '#ef4444' }
            },
            events: {
                'K1_SHORT': { category: 'key', label: 'K1短按' },
                'K3_SHORT': { category: 'key', label: 'K3短按' },
                'MEASURE_OK': { category: 'measure', label: '测距成功' },
                'MEASURE_FAIL': { category: 'measure', label: '测距失败' },
                'TIMEOUT': { category: 'system', label: '超时' }
            },
            states: {
                'IDLE': { label: '待机', type: 'atomic', display: { line4: '-----', laser: false } },
                'LASER_ON': { label: '激光开启', type: 'atomic', display: { line4: '-----', laser: true } },
                'MEASURING': { label: '测量中', type: 'atomic', display: { line4: '-----', laser: true } },
                'RESULT': { label: '显示结果', type: 'atomic', display: { line4: '$result', laser: false } },
                'ERROR': { label: '错误', type: 'atomic', display: { line4: 'Error', laser: false } }
            },
            transitions: [
                { from: 'IDLE', to: 'LASER_ON', event: 'K1_SHORT', actions: [] },
                { from: 'LASER_ON', to: 'MEASURING', event: 'K1_SHORT', actions: [] },
                { from: 'LASER_ON', to: 'IDLE', event: 'K3_SHORT', actions: [] },
                { from: 'LASER_ON', to: 'IDLE', event: 'TIMEOUT', actions: [] },
                { from: 'MEASURING', to: 'RESULT', event: 'MEASURE_OK', actions: [] },
                { from: 'MEASURING', to: 'ERROR', event: 'MEASURE_FAIL', actions: [] },
                { from: 'RESULT', to: 'LASER_ON', event: 'K1_SHORT', actions: [] },
                { from: 'RESULT', to: 'IDLE', event: 'K3_SHORT', actions: [] },
                { from: 'ERROR', to: 'IDLE', event: 'K3_SHORT', actions: [] }
            ],
            globalTransitions: [],
            actions: {},
            variables: { result: { type: 'float', default: 0 } },
            initialState: 'IDLE'
        };
        
        // 设置初始位置
        this.nodePositions = {
            'IDLE': { x: 100, y: 150 },
            'LASER_ON': { x: 300, y: 150 },
            'MEASURING': { x: 500, y: 150 },
            'RESULT': { x: 500, y: 300 },
            'ERROR': { x: 700, y: 150 }
        };
        
        this.deselectAll();
        this.fitView();
    },
    
    // ==================== 代码生成 ====================
    generateCode(type) {
        if (!this.machine) {
            alert('请先加载或创建状态机');
            return;
        }
        
        let code, filename;
        
        if (type === 'c') {
            code = this.generateCCode();
            filename = 'ui_state_machine.c';
        } else {
            code = this.generateTestScript();
            filename = 'test_script.json';
        }
        
        // 下载
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },
    
    generateCCode() {
        // 复用原有的C代码生成逻辑
        return window.StateMachineEditor?.generateCCode?.call({ currentMachine: this.machine, lcdProject: this.lcdProject }) 
            || '// 代码生成功能需要加载完整编辑器';
    },
    
    generateTestScript() {
        return window.StateMachineEditor?.generateTestScript?.call({ currentMachine: this.machine, lcdProject: this.lcdProject })
            || '// 测试脚本生成功能需要加载完整编辑器';
    },
    
    // ==================== 帮助 ====================
    showHelp() {
        alert(`状态机编辑器 V2 使用说明

🖱️ 基本操作:
• 双击画布 - 添加新状态
• 拖拽状态 - 移动位置
• 点击状态 - 选中并编辑属性
• 滚轮 - 缩放画布
• 中键拖拽 - 平移画布

🔧 工具栏:
• ↖ 选择工具 - 选择和移动状态
• ✋ 手型工具 - 平移画布
• ⬜ 状态工具 - 点击添加状态
• → 转移工具 - 从一个状态拖到另一个创建转移

⌨️ 快捷键:
• Delete - 删除选中
• Escape - 取消操作
• 空格+拖拽 - 临时平移

📺 LCD显示:
• 选中状态后在右侧面板配置LCD显示
• 支持数字组、图标、单选组、等级等组件`);
    },
    
    editState(stateId) {
        // 双击状态时的编辑操作
        this.selectNode({ type: 'state', id: stateId });
    },
    
    showContextMenu(e) {
        // TODO: 实现右键菜单
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('sme2-canvas')) {
        SME2.init();
    }
});
