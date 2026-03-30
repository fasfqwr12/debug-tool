/**
 * FlowController v3 - 流程控制器
 * 
 * 核心设计:
 * - 每个状态有 stepIndex 序号 (1,2,3,4...)
 * - 每个状态有 isReady 标记 (准备状态)
 * - 撤回时往前找最近的准备状态
 * - 统一逻辑兼容单步/多步/循环
 * 
 * 流程类型:
 * - single: 单步型 (单次测量) - 支持撤回
 * - multi:  多步型 (面积/体积/勾股) - 支持撤回
 * - loop:   循环型 (连续测量) - 不支持撤回
 * 
 * 撤回逻辑:
 * - step2撤回 → 找step1(准备) → 跳到LASER_ON
 * - step3撤回 → 找step2(不是准备) → 找step1(准备) → 跳到AREA_STEP1
 * - step4撤回 → 找step3(准备) → 跳到AREA_STEP2
 */

window.FlowController = {
    DEBUG: true,
    
    // ========== 流程类型常量 ==========
    FLOW_TYPE: {
        SINGLE: 'single',      // 单步型
        MULTI: 'multi',        // 多步型
        LOOP: 'loop'           // 循环型
    },
    
    // ========== 状态 ==========
    state: {
        initialized: false,
        
        // 当前流程类型
        flowType: 'single',
        
        // 当前步骤序号 (1-based)
        currentStep: 0,
        
        // 当前状态ID
        currentState: null,
        
        // 数据槽 (Line1-4, 索引0-3)
        slots: [0, 0, 0, 0],
        
        // 数据类型 (length/area/volume)
        dataTypes: ['length', 'length', 'length', 'length'],
        
        // 连续测量专用
        maxVal: -1,
        minVal: -1,
        
        // 步骤配置列表 (从状态机加载)
        // [{stepIndex:1, stateId:'AREA_STEP1', isReady:true}, {stepIndex:2, stateId:'AREA_STEP1_DONE', isReady:false}, ...]
        stepConfigs: [],
        
        // 数据快照 (每个准备状态进入时保存)
        // [{stepIndex:1, stateId:'AREA_STEP1', slots:[0,0,0,0]}, ...]
        snapshots: [],
    },
    
    // 回调
    callbacks: {
        onStateChange: null,
        onDisplayUpdate: null,
        onUndo: null,
    },
    
    // ========== 初始化 ==========
    init() {
        this.reset();
        this.state.initialized = true;
        this.log('FlowController v3 初始化完成');
        return this;
    },
    
    reset() {
        this.state.flowType = 'single';
        this.state.currentStep = 0;
        this.state.currentState = null;
        this.state.slots = [0, 0, 0, 0];
        this.state.dataTypes = ['length', 'length', 'length', 'length'];
        this.state.maxVal = -1;
        this.state.minVal = -1;
        this.state.stepConfigs = [];
        this.state.snapshots = [];
        this.log('重置');
    },
    
    // ========== 配置加载 ==========
    
    /**
     * 设置流程类型
     * @param {string} type - 'single' | 'multi' | 'loop'
     */
    setFlowType(type) {
        if (!['single', 'multi', 'loop'].includes(type)) {
            this.log('无效流程类型:', type);
            return;
        }
        this.state.flowType = type;
        this.state.currentStep = 0;
        this.state.snapshots = [];
        this.clearSlots();
        this.log('设置流程类型:', type);
    },
    
    /**
     * 从状态机配置加载步骤信息
     * @param {Object} smConfig - 状态机配置 (hierarchy)
     * @param {string} parentId - 父状态ID (如 'AREA')
     */
    loadFromStateMachine(smConfig, parentId) {
        this.state.stepConfigs = [];
        
        // 递归查找指定父状态下的所有子状态
        const findChildren = (node, targetId) => {
            if (node.id === targetId && node.children) {
                return node.children;
            }
            if (node.children) {
                for (const child of Object.values(node.children)) {
                    const result = findChildren(child, targetId);
                    if (result) return result;
                }
            }
            return null;
        };
        
        const children = findChildren(smConfig.hierarchy.ROOT, parentId);
        if (!children) {
            this.log('未找到父状态:', parentId);
            return;
        }
        
        // 提取步骤配置
        for (const [id, node] of Object.entries(children)) {
            if (node.stepIndex !== undefined) {
                this.state.stepConfigs.push({
                    stepIndex: node.stepIndex,
                    stateId: node.id,
                    isReady: node.isReady === true,
                    label: node.label || node.id,
                });
            }
        }
        
        // 按 stepIndex 排序
        this.state.stepConfigs.sort((a, b) => a.stepIndex - b.stepIndex);
        
        // 设置流程类型
        const parentNode = this.findNode(smConfig.hierarchy.ROOT, parentId);
        if (parentNode && parentNode.flowType) {
            this.state.flowType = parentNode.flowType;
        }
        
        this.log('加载步骤配置:', this.state.stepConfigs);
    },
    
    /**
     * 手动设置步骤配置
     * @param {Array} configs - [{stepIndex, stateId, isReady}, ...]
     */
    setStepConfigs(configs) {
        this.state.stepConfigs = configs.map(c => ({
            stepIndex: c.stepIndex,
            stateId: c.stateId,
            isReady: c.isReady === true,
            label: c.label || c.stateId,
        }));
        this.state.stepConfigs.sort((a, b) => a.stepIndex - b.stepIndex);
        this.log('设置步骤配置:', this.state.stepConfigs);
    },
    
    // ========== 状态进入 ==========
    
    /**
     * 进入状态时调用
     * - 如果是准备状态，保存快照
     * @param {string} stateId - 状态ID
     */
    enterState(stateId) {
        // 查找步骤配置
        const config = this.state.stepConfigs.find(c => c.stateId === stateId);
        if (!config) {
            this.log('状态无步骤配置:', stateId);
            return;
        }
        
        this.state.currentStep = config.stepIndex;
        this.state.currentState = stateId;
        
        // 如果是准备状态，保存快照
        if (config.isReady) {
            this.pushSnapshot(config.stepIndex, stateId);
        }
        
        this.log(`进入状态: ${stateId}, step=${config.stepIndex}, isReady=${config.isReady}`);
    },
    
    /**
     * 保存数据快照
     */
    pushSnapshot(stepIndex, stateId) {
        // 循环型不保存快照
        if (this.state.flowType === 'loop') {
            return;
        }
        
        // 检查是否已有该步骤的快照（避免重复）
        const existing = this.state.snapshots.findIndex(s => s.stepIndex === stepIndex);
        if (existing >= 0) {
            // 更新已有快照
            this.state.snapshots[existing] = {
                stepIndex,
                stateId,
                slots: [...this.state.slots],
                dataTypes: [...this.state.dataTypes],
            };
            this.log(`更新快照: step=${stepIndex}, slots=[${this.state.slots.join(',')}]`);
        } else {
            // 添加新快照
            this.state.snapshots.push({
                stepIndex,
                stateId,
                slots: [...this.state.slots],
                dataTypes: [...this.state.dataTypes],
            });
            this.log(`保存快照: step=${stepIndex}, slots=[${this.state.slots.join(',')}]`);
        }
    },
    
    // ========== 撤回逻辑 ==========
    
    /**
     * 撤回到上一个准备状态
     * @returns {Object|null} {stateId, stepIndex} 或 null
     */
    undo() {
        // 循环型不支持撤回
        if (this.state.flowType === 'loop') {
            this.log('循环型不支持撤回');
            return null;
        }
        
        // 没有快照
        if (this.state.snapshots.length === 0) {
            this.log('无快照可撤回');
            return null;
        }
        
        const currentStep = this.state.currentStep;
        this.log(`撤回: 当前step=${currentStep}, 快照数=${this.state.snapshots.length}`);
        
        // 往前找最近的准备状态
        // 从当前步骤-1开始往前找
        let targetSnapshot = null;
        
        for (let i = this.state.snapshots.length - 1; i >= 0; i--) {
            const snapshot = this.state.snapshots[i];
            // 找比当前步骤小的准备状态
            if (snapshot.stepIndex < currentStep) {
                targetSnapshot = snapshot;
                // 移除该快照之后的所有快照
                this.state.snapshots = this.state.snapshots.slice(0, i + 1);
                break;
            }
        }
        
        if (!targetSnapshot) {
            // 如果没找到比当前小的，取第一个快照
            if (this.state.snapshots.length > 0) {
                targetSnapshot = this.state.snapshots[0];
                this.state.snapshots = [targetSnapshot];
            } else {
                this.log('无有效快照');
                return null;
            }
        }
        
        // 恢复数据
        this.state.slots = [...targetSnapshot.slots];
        this.state.dataTypes = [...targetSnapshot.dataTypes];
        this.state.currentStep = targetSnapshot.stepIndex;
        this.state.currentState = targetSnapshot.stateId;
        
        this.log(`撤回到: ${targetSnapshot.stateId}, step=${targetSnapshot.stepIndex}, slots=[${this.state.slots.join(',')}]`);
        
        // 触发回调
        if (this.callbacks.onUndo) {
            this.callbacks.onUndo(targetSnapshot);
        }
        
        // 刷新显示
        this.refreshDisplay();
        
        return {
            stateId: targetSnapshot.stateId,
            stepIndex: targetSnapshot.stepIndex,
        };
    },
    
    /**
     * 检查是否可以撤回
     */
    canUndo() {
        if (this.state.flowType === 'loop') return false;
        if (this.state.snapshots.length === 0) return false;
        
        // 检查是否有比当前步骤小的快照
        const currentStep = this.state.currentStep;
        return this.state.snapshots.some(s => s.stepIndex < currentStep) || 
               this.state.snapshots.length > 0;
    },
    
    // ========== 数据操作 ==========
    
    /**
     * 存储测量值到指定槽位
     * @param {number} slotIndex - 槽位索引 (0-3 对应 Line1-4)
     * @param {number} value - 测量值
     * @param {string} dataType - 数据类型 ('length'/'area'/'volume')
     */
    storeSlot(slotIndex, value, dataType = 'length') {
        if (slotIndex < 0 || slotIndex > 3) {
            this.log('无效槽位索引:', slotIndex);
            return;
        }
        this.state.slots[slotIndex] = value;
        this.state.dataTypes[slotIndex] = dataType;
        this.log(`存储: slot[${slotIndex}] = ${value} (${dataType})`);
    },
    
    /**
     * 获取槽位值
     */
    getSlot(slotIndex) {
        if (slotIndex < 0 || slotIndex > 3) return 0;
        return this.state.slots[slotIndex];
    },
    
    /**
     * 获取所有槽位
     */
    getAllSlots() {
        return [...this.state.slots];
    },
    
    /**
     * 清空所有槽位
     */
    clearSlots() {
        this.state.slots = [0, 0, 0, 0];
        this.state.dataTypes = ['length', 'length', 'length', 'length'];
    },
    
    /**
     * 数据上移: slot[0]←slot[1]←slot[2]←slot[3]
     */
    scrollUp() {
        this.state.slots[0] = this.state.slots[1];
        this.state.slots[1] = this.state.slots[2];
        this.state.slots[2] = this.state.slots[3];
        this.state.slots[3] = 0;
        
        this.state.dataTypes[0] = this.state.dataTypes[1];
        this.state.dataTypes[1] = this.state.dataTypes[2];
        this.state.dataTypes[2] = this.state.dataTypes[3];
        this.state.dataTypes[3] = 'length';
        
        this.log('数据上移');
    },
    
    /**
     * 数据下移: slot[3]←slot[2]←slot[1]←slot[0]
     */
    scrollDown() {
        this.state.slots[3] = this.state.slots[2];
        this.state.slots[2] = this.state.slots[1];
        this.state.slots[1] = this.state.slots[0];
        this.state.slots[0] = 0;
        
        this.state.dataTypes[3] = this.state.dataTypes[2];
        this.state.dataTypes[2] = this.state.dataTypes[1];
        this.state.dataTypes[1] = this.state.dataTypes[0];
        this.state.dataTypes[0] = 'length';
        
        this.log('数据下移');
    },
    
    // ========== 连续测量专用 ==========
    
    /**
     * 更新连续测量的MAX/MIN
     */
    updateContinuous(distance) {
        if (this.state.maxVal < 0 || distance > this.state.maxVal) {
            this.state.maxVal = distance;
        }
        if (this.state.minVal < 0 || distance < this.state.minVal) {
            this.state.minVal = distance;
        }
        
        this.state.slots[1] = this.state.maxVal;  // Line2 = MAX
        this.state.slots[2] = this.state.minVal;  // Line3 = MIN
        this.state.slots[3] = distance;            // Line4 = 当前
        
        this.log(`连续测量: MAX=${this.state.maxVal}, MIN=${this.state.minVal}, 当前=${distance}`);
    },
    
    /**
     * 重置连续测量
     */
    resetContinuous() {
        this.state.maxVal = -1;
        this.state.minVal = -1;
    },
    
    // ========== 计算 ==========
    
    /**
     * 计算面积: slot[1] * slot[2] → slot[3]
     */
    calcArea() {
        const length = this.state.slots[1] || this.state.slots[2];
        const width = this.state.slots[2] || this.state.slots[3];
        const area = length * width;
        
        this.state.slots[3] = area;
        this.state.dataTypes[3] = 'area';
        
        this.log(`计算面积: ${length} × ${width} = ${area}`);
        return area;
    },
    
    /**
     * 计算体积: slot[0] * slot[1] * slot[2] → slot[3]
     */
    calcVolume() {
        const l = this.state.slots[0];
        const w = this.state.slots[1];
        const h = this.state.slots[2];
        const volume = l * w * h;
        
        this.state.slots[3] = volume;
        this.state.dataTypes[3] = 'volume';
        
        this.log(`计算体积: ${l} × ${w} × ${h} = ${volume}`);
        return volume;
    },
    
    /**
     * 勾股定理1: √(slot[0]² - slot[1]²) → slot[3]
     */
    calcPyth1() {
        const a = this.state.slots[0];  // 斜边
        const b = this.state.slots[1];  // 直角边
        
        if (a <= b) {
            this.log('勾股1错误: 斜边必须大于直角边');
            return null;
        }
        
        const result = Math.sqrt(a * a - b * b);
        this.state.slots[3] = result;
        this.state.dataTypes[3] = 'length';
        
        this.log(`勾股1: √(${a}² - ${b}²) = ${result}`);
        return result;
    },
    
    // ========== 显示更新 ==========
    
    /**
     * 刷新显示
     */
    refreshDisplay() {
        // 调用 UIStore 更新显示
        if (typeof UIStore !== 'undefined' && UIStore.set) {
            for (let i = 0; i < 4; i++) {
                const compName = `Line${i + 1}`;
                if (this.state.slots[i] !== 0) {
                    UIStore.set(compName, this.state.slots[i]);
                } else {
                    UIStore.set(compName, '-----');
                }
            }
        }
        
        // 触发回调
        if (this.callbacks.onDisplayUpdate) {
            this.callbacks.onDisplayUpdate({
                slots: [...this.state.slots],
                dataTypes: [...this.state.dataTypes],
                currentStep: this.state.currentStep,
                currentState: this.state.currentState,
            });
        }
    },
    
    // ========== 动作执行 ==========
    
    /**
     * 执行 flow:xxx 动作
     * @param {string} action - 动作字符串
     * @returns {Object|null} 返回值（如撤回目标）
     */
    executeAction(action) {
        if (!action.startsWith('flow:')) {
            return null;
        }
        
        const parts = action.split(':');
        const cmd = parts[1];
        const param1 = parts[2];
        const param2 = parts[3];
        
        this.log('执行动作:', action);
        
        switch (cmd) {
            case 'setType':
                this.setFlowType(param1);
                return null;
                
            case 'enterState':
            case 'onEnterReady':
                // 进入状态（由状态机入口动作调用）
                // 实际的 stateId 由状态机模拟器传入
                return null;
                
            case 'storeSlot':
                // flow:storeSlot:2 - 存储到slot[2] (Line3)
                const slotIdx = parseInt(param1);
                // 值从外部传入（通过 distance 变量）
                return { action: 'storeSlot', slotIndex: slotIdx };
                
            case 'undo':
                return this.undo();
                
            case 'scrollUp':
                this.scrollUp();
                this.refreshDisplay();
                return null;
                
            case 'scrollDown':
                this.scrollDown();
                this.refreshDisplay();
                return null;
                
            case 'calcArea':
                this.calcArea();
                this.refreshDisplay();
                return null;
                
            case 'calcVolume':
                this.calcVolume();
                this.refreshDisplay();
                return null;
                
            case 'calcPyth1':
                this.calcPyth1();
                this.refreshDisplay();
                return null;
                
            case 'clearSlots':
                this.clearSlots();
                this.refreshDisplay();
                return null;
                
            case 'resetContinuous':
                this.resetContinuous();
                return null;
                
            default:
                this.log('未知命令:', cmd);
                return null;
        }
    },
    
    // ========== 工具方法 ==========
    
    /**
     * 递归查找节点
     */
    findNode(node, targetId) {
        if (node.id === targetId) return node;
        if (node.children) {
            for (const child of Object.values(node.children)) {
                const result = this.findNode(child, targetId);
                if (result) return result;
            }
        }
        return null;
    },
    
    /**
     * 获取状态快照（用于调试）
     */
    getSnapshot() {
        return {
            flowType: this.state.flowType,
            currentStep: this.state.currentStep,
            currentState: this.state.currentState,
            slots: [...this.state.slots],
            dataTypes: [...this.state.dataTypes],
            snapshotCount: this.state.snapshots.length,
            snapshots: this.state.snapshots.map(s => ({
                step: s.stepIndex,
                state: s.stateId,
                slots: s.slots.join(','),
            })),
            canUndo: this.canUndo(),
        };
    },
    
    /**
     * 获取步骤配置
     */
    getStepConfigs() {
        return [...this.state.stepConfigs];
    },
    
    /**
     * 根据状态ID获取步骤配置
     */
    getStepConfig(stateId) {
        return this.state.stepConfigs.find(c => c.stateId === stateId);
    },
    
    /**
     * 根据步骤序号获取准备状态
     */
    getReadyStateByStep(stepIndex) {
        // 找该步骤或之前最近的准备状态
        for (let i = this.state.stepConfigs.length - 1; i >= 0; i--) {
            const config = this.state.stepConfigs[i];
            if (config.stepIndex <= stepIndex && config.isReady) {
                return config;
            }
        }
        return null;
    },
    
    log(...args) {
        if (this.DEBUG) {
            console.log('[FlowController]', ...args);
        }
    },
};

// 自动初始化
if (typeof window !== 'undefined') {
    FlowController.init();
}
