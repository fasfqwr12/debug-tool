/**
 * 精度测试页面 - 参数记忆功能
 */
const SlipwayNewPage = {
    // 参数记忆键值
    STORAGE_KEY: 'slipway_accuracy_test_params',
    
    // 默认参数
    defaultParams: {
        testStart: 1000,
        testEnd: 5000, 
        testStep: 1000,
        testRepeats: 2,
        testCompensate: 0,
        testMode: 'basic',
        reflectance: null  // 当前选中的反射率
    },

    /**
     * 初始化页面
     */
    init() {
        console.log('[SlipwayNew] 初始化精度测试页面');
        
        // 加载保存的参数
        this.loadParams();
        
        // 绑定参数变化事件
        this.bindParamEvents();
        
        // 绑定反射率按钮事件
        this.bindReflectanceEvents();
    },

    /**
     * 从localStorage加载参数
     */
    loadParams() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            const params = saved ? JSON.parse(saved) : this.defaultParams;
            
            // 应用参数到UI
            this.applyParamsToUI(params);
            
            console.log('[SlipwayNew] 加载参数:', params);
        } catch (e) {
            console.warn('[SlipwayNew] 加载参数失败:', e);
            this.applyParamsToUI(this.defaultParams);
        }
    },

    /**
     * 保存参数到localStorage
     */
    saveParams() {
        try {
            const params = this.collectParamsFromUI();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(params));
            console.log('[SlipwayNew] 保存参数:', params);
        } catch (e) {
            console.warn('[SlipwayNew] 保存参数失败:', e);
        }
    },

    /**
     * 将参数应用到UI
     */
    applyParamsToUI(params) {
        // 基础参数
        const testStart = document.getElementById('test-start');
        const testEnd = document.getElementById('test-end');
        const testStep = document.getElementById('test-step');
        const testRepeats = document.getElementById('test-repeats');
        const testCompensate = document.getElementById('test-compensate');
        
        if (testStart) testStart.value = params.testStart || this.defaultParams.testStart;
        if (testEnd) testEnd.value = params.testEnd || this.defaultParams.testEnd;
        if (testStep) testStep.value = params.testStep || this.defaultParams.testStep;
        if (testRepeats) testRepeats.value = params.testRepeats || this.defaultParams.testRepeats;
        if (testCompensate) testCompensate.value = params.testCompensate || this.defaultParams.testCompensate;
        
        // 测试模式
        const modeRadios = document.querySelectorAll('input[name="test-mode"]');
        const targetMode = params.testMode || this.defaultParams.testMode;
        modeRadios.forEach(radio => {
            radio.checked = (radio.value === targetMode);
        });
        
        // 反射率按钮
        if (params.reflectance) {
            const targetBtn = document.querySelector(`.ref-btn[data-ref="${params.reflectance}"]`);
            if (targetBtn) {
                document.querySelectorAll('.ref-btn').forEach(btn => btn.classList.remove('active'));
                targetBtn.classList.add('active');
            }
        }
    },

    /**
     * 从UI收集当前参数
     */
    collectParamsFromUI() {
        const testStart = document.getElementById('test-start');
        const testEnd = document.getElementById('test-end');
        const testStep = document.getElementById('test-step');
        const testRepeats = document.getElementById('test-repeats');
        const testCompensate = document.getElementById('test-compensate');
        
        // 获取选中的测试模式
        const modeRadio = document.querySelector('input[name="test-mode"]:checked');
        
        // 获取选中的反射率
        const activeRefBtn = document.querySelector('.ref-btn.active');
        
        return {
            testStart: testStart ? parseInt(testStart.value) || this.defaultParams.testStart : this.defaultParams.testStart,
            testEnd: testEnd ? parseInt(testEnd.value) || this.defaultParams.testEnd : this.defaultParams.testEnd,
            testStep: testStep ? parseInt(testStep.value) || this.defaultParams.testStep : this.defaultParams.testStep,
            testRepeats: testRepeats ? parseInt(testRepeats.value) || this.defaultParams.testRepeats : this.defaultParams.testRepeats,
            testCompensate: testCompensate ? parseInt(testCompensate.value) || this.defaultParams.testCompensate : this.defaultParams.testCompensate,
            testMode: modeRadio ? modeRadio.value : this.defaultParams.testMode,
            reflectance: activeRefBtn ? activeRefBtn.dataset.ref || activeRefBtn.textContent.replace('%', '') : null
        };
    },

    /**
     * 绑定参数输入事件
     */
    bindParamEvents() {
        // 数值输入框事件
        const inputs = ['test-start', 'test-end', 'test-step', 'test-repeats', 'test-compensate'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    this.saveParams();
                });
                el.addEventListener('blur', () => {
                    this.saveParams();
                });
            }
        });
        
        // 测试模式单选按钮事件
        const modeRadios = document.querySelectorAll('input[name="test-mode"]');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                this.saveParams();
            });
        });
    },

    /**
     * 绑定反射率按钮事件
     */
    bindReflectanceEvents() {
        const refBtns = document.querySelectorAll('.ref-btn');
        refBtns.forEach(btn => {
            // 为按钮添加data-ref属性（如果没有的话）
            if (!btn.dataset.ref && btn.textContent.includes('%')) {
                btn.dataset.ref = btn.textContent.replace('%', '');
            }
            
            btn.addEventListener('click', () => {
                // 更新按钮状态
                refBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 保存参数
                this.saveParams();
            });
        });
    },

    /**
     * 重置参数为默认值
     */
    resetParams() {
        if (confirm('确定要重置所有参数为默认值吗？')) {
            localStorage.removeItem(this.STORAGE_KEY);
            this.applyParamsToUI(this.defaultParams);
            console.log('[SlipwayNew] 参数已重置为默认值');
        }
    }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    SlipwayNewPage.init();
});

// 暴露到全局（兼容现有代码）
window.SlipwayNewPage = SlipwayNewPage;
