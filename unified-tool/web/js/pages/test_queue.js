/**
 * 测试 - 测试队列页面
 * 管理待测固件、执行测试、记录数据
 * 
 * 集成 DeviceConfigManager 统一设备配置管理
 */

const TestQueuePage = {
    currentTest: null,
    queue: [],
    history: [],
    _useDeviceConfigManager: false,

    async init() {
        console.log('TestQueuePage init');
        // 初始使用默认模板
        this.testTemplate = JSON.parse(JSON.stringify(this.defaultTemplate));
        this.currentTab = this.currentTab || 'ui';
        
        // 初始化设备管理器
        await this.initDeviceManager();
        
        await this.loadQueue();
        await this.loadHistory();
        this.renderQueue();
        this.renderHistory();
        
        // 初始化共享目录状态
        await this.initShareDir();
        
        // 初始化模板库（包括加载GD303 Mini模板）
        await this.initTemplateLibrary();
    },
    
    // 初始化设备管理器
    async initDeviceManager() {
        if (typeof DeviceConfigManager === 'undefined') {
            console.log('[TestQueuePage] DeviceConfigManager 不可用');
            this._useDeviceConfigManager = false;
            return;
        }
        
        try {
            await DeviceConfigManager.init();
            this._useDeviceConfigManager = true;
            
            // 订阅设备变更事件
            DeviceConfigManager.subscribe('device-changed', (e) => {
                console.log('[TestQueuePage] 设备变更:', e.newDevice);
                // 重新加载模板
                this.initTemplateLibrary();
            });
            
            // 订阅测试套件更新事件
            DeviceConfigManager.subscribe('tests-updated', (e) => {
                console.log('[TestQueuePage] 测试套件更新:', e.deviceId);
                this.initTemplateLibrary();
            });
            
            console.log('[TestQueuePage] DeviceConfigManager 已初始化');
        } catch (e) {
            console.warn('[TestQueuePage] DeviceConfigManager 初始化失败:', e);
            this._useDeviceConfigManager = false;
        }
    },
    
    async initShareDir() {
        try {
            const result = await API.call('share_get_directory');
            const statusEl = document.getElementById('share-dir-status');
            const pathEl = document.getElementById('share-dir-path');
            
            if (result.success && result.path) {
                if (statusEl) statusEl.style.display = 'block';
                if (pathEl) pathEl.textContent = `📂 ${result.path}`;
                // 自动扫描一次
                await this.scanShareDir();
            } else {
                if (statusEl) statusEl.style.display = 'block';
                if (pathEl) pathEl.textContent = '📂 未设置共享目录，点击设置 →';
            }
        } catch (e) {
            console.warn('初始化共享目录失败:', e);
        }
    },
    
    async scanShareDir() {
        try {
            Utils.toast('正在扫描共享目录...', 'info');
            const result = await API.call('share_scan_directory');
            
            if (result.success) {
                const tasks = result.tasks || [];
                if (tasks.length > 0) {
                    // 合并到待测队列
                    for (const task of tasks) {
                        const existIdx = this.queue.findIndex(q => q.id === task.id);
                        if (existIdx < 0) {
                            this.queue.unshift(task);
                        }
                    }
                    this.renderQueue();
                    Utils.toast(`发现 ${tasks.length} 个待处理任务`, 'success');
                } else {
                    Utils.toast('共享目录中没有新任务', 'info');
                }
            } else {
                if (result.error === '未设置共享目录') {
                    // 提示设置
                    if (confirm('尚未设置共享目录，是否现在设置？')) {
                        await this.openShareDir();
                    }
                } else {
                    Utils.toast('扫描失败: ' + result.error, 'error');
                }
            }
        } catch (e) {
            console.error('扫描共享目录失败:', e);
            Utils.toast('扫描失败: ' + e.message, 'error');
        }
    },

    destroy() {
        console.log('TestQueuePage destroy');
    },

    // 加载待测队列（从版本列表中筛选submitted/testing状态）
    async loadQueue() {
        const result = await API.call('dev_get_test_queue');
        if (result.success) {
            this.queue = result.queue || [];
            this.renderQueue();
        }
    },

    // 加载历史记录
    async loadHistory() {
        const result = await API.call('dev_get_test_history');
        if (result.success) {
            this.history = result.history || [];
            this.renderHistory();
        }
    },

    // 渲染待测队列
    renderQueue() {
        const container = document.getElementById('queue-list');
        const countEl = document.getElementById('queue-count');
        if (!container) return;

        if (countEl) countEl.textContent = this.queue.length;

        if (this.queue.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无待测固件</div>';
            return;
        }

        // 增量渲染，避免一次性innerHTML卡顿
        Utils.renderInChunks(container, this.queue, (t) => {
            return `
                <div class="queue-item ${t.status === 'testing' ? 'testing' : ''} ${this.currentTest?.id === t.id ? 'active' : ''}"
                     onclick="TestQueuePage.selectTest('${t.id}')">
                    <div class="queue-item-header">
                        <div class="name">${t.project?.icon || '📦'} ${t.project?.name || ''} v${t.version}</div>
                        <button class="quick-reject-btn" onclick="event.stopPropagation(); TestQueuePage.quickReject('${t.id}')" title="快速驳回">✗</button>
                    </div>
                    <div class="time">提交于 ${t.submit_time || t.submitTime || '--'}</div>
                    <div class="status">${t.status === 'testing' ? '🔄 测试中...' : '⏳ 待测试'}</div>
                </div>
            `;
        }, 30);
    },

    // 渲染历史记录
    renderHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;

        if (this.history.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无历史记录</div>';
            return;
        }

        const list = this.history.slice(0, 50);
        Utils.renderInChunks(container, list, (t) => {
            return `
                <div class="history-item ${t.status}" onclick="TestQueuePage.viewHistory('${t.id}')">
                    <span>${t.project?.icon || ''} ${t.project?.name || ''} v${t.version}</span>
                    <span style="float:right">${t.status === 'passed' ? '✓' : '✗'}</span>
                </div>
            `;
        }, 40);
    },

    // 选择测试项
    async selectTest(testId) {
        this.currentTest = this.queue.find(t => t.id === testId);
        if (!this.currentTest) {
            this.currentTest = this.history.find(t => t.id === testId);
        }
        
        if (!this.currentTest) return;
        
        // 重置测试结果和设备列表
        // devices 用对象存储，key为设备索引，value为该设备的测试结果
        this.testResults = { issues: [], customItems: [], devices: {}, conclusion: '' };
        this.testDevices = [];
        this.currentDeviceIdx = 0;
        
        // 读取滑台测试结果（如有）
        this.loadSlipwayResults();

        // 加载该产品的模板
        await this.loadProductTemplate();

        // 更新队列选中状态
        document.querySelectorAll('.queue-item').forEach(item => {
            item.classList.remove('active');
        });
        if (event?.currentTarget) {
            event.currentTarget.classList.add('active');
        }

        // 渲染测试内容
        this.renderTestContent();
        
        // 渲染来源信息
        this.renderSourceInfo();
    },
    
    // 加载滑台测试结果
    loadSlipwayResults() {
        const data = sessionStorage.getItem('slipwayTestResults');
        if (!data) return;
        
        try {
            const { results, time, count } = JSON.parse(data);
            
            // 填入精度测试结果
            Object.entries(results).forEach(([key, value]) => {
                if (key.endsWith('_result')) {
                    const itemKey = key.replace('_result', '');
                    this.testResults[itemKey] = value;
                } else {
                    this.testResults[key + '_value'] = value;
                }
            });
            
            // 记录滑台测试信息
            this.testResults['slipway_test'] = {
                time,
                count,
                imported: true
            };
            
            console.log('已导入滑台测试结果:', count, '个数据点');
            
            // 清除 sessionStorage
            sessionStorage.removeItem('slipwayTestResults');
            
        } catch (e) {
            console.error('解析滑台测试结果失败', e);
        }
    },
    
    // 加载产品关联的模板
    async loadProductTemplate() {
        await this.initTemplateLibrary();
        
        const projectId = this.currentTest?.project_id || this.currentTest?.project?.id;
        if (!projectId) {
            this.currentTemplateId = 'default';
            this.testTemplate = JSON.parse(JSON.stringify(this.defaultTemplate));
            return;
        }
        
        // 查找产品关联的模板ID
        const templateId = localStorage.getItem(`productTemplate_${projectId}`) || 'default';
        const tpl = this.templateLibrary[templateId];
        
        if (tpl) {
            this.currentTemplateId = templateId;
            this.testTemplate = JSON.parse(JSON.stringify(tpl.data));
            console.log('已加载模板:', tpl.name);
            
            // 如果是GD303 Mini模板，同步加载自动化脚本
            if (templateId === 'gd303_mini' && tpl.data?.ui?.groups) {
                this.autoScripts = {};
                tpl.data.ui.groups.forEach(group => {
                    group.items.forEach(item => {
                        if (item.autoScript) {
                            this.autoScripts[item.key] = item.autoScript;
                        }
                    });
                });
                console.log(`[UITest] 已加载 ${Object.keys(this.autoScripts).length} 个自动化脚本`);
            }
        } else {
            this.currentTemplateId = 'default';
            this.testTemplate = JSON.parse(JSON.stringify(this.defaultTemplate));
        }
    },

    currentTab: 'ui',
    testTemplate: null,  // 当前使用的模板（动态加载）
    
    // 测试设备列表（性能测试需要多台设备）
    testDevices: [],
    currentDeviceIdx: 0,
    
    // 默认测试模板 - GD303 80M激光测距仪 (基于固件代码分析)
    // ========== 专业测试模板 - 基于等价类/边界值/状态转换/异常处理/组合覆盖 ==========
    defaultTemplate: {
        ui: {
            name: 'UI测试',
            multiDevice: false,
            minDevices: 1,
            groups: [
                // ==================== 1. 数值显示边界值测试 ====================
                {
                    name: '【边界值】距离显示极限',
                    items: [
                        { key: 'bv_dist_min', name: '最小距离0.05m', desc: '显示0.050m，小数点位置正确' },
                        { key: 'bv_dist_min_1', name: '最小距离-1(0.049m)', desc: '低于最小量程时显示处理' },
                        { key: 'bv_dist_max', name: '最大距离80.000m', desc: '显示80.000m，不溢出' },
                        { key: 'bv_dist_max_1', name: '最大距离+1(80.001m)', desc: '超量程显示Error或---' },
                        { key: 'bv_dist_zero', name: '零值显示', desc: '显示0.000m，非空白' },
                        { key: 'bv_dist_overflow', name: '显示溢出99999', desc: '超5位数时显示处理' },
                    ]
                },
                {
                    name: '【边界值】角度显示极限',
                    items: [
                        { key: 'bv_angle_0', name: '角度0.0°', desc: '水平时显示0.0°' },
                        { key: 'bv_angle_pos90', name: '角度+90.0°', desc: '垂直向上显示+90.0°' },
                        { key: 'bv_angle_neg90', name: '角度-90.0°', desc: '垂直向下显示-90.0°' },
                        { key: 'bv_angle_pos91', name: '角度>90°处理', desc: '超限时显示处理' },
                        { key: 'bv_angle_neg91', name: '角度<-90°处理', desc: '超限时显示处理' },
                        { key: 'bv_angle_decimal', name: '角度小数0.1°', desc: '最小分辨率显示' },
                    ]
                },
                {
                    name: '【边界值】面积/体积极限',
                    items: [
                        { key: 'bv_area_min', name: '最小面积0.0025m²', desc: '0.05×0.05显示正确' },
                        { key: 'bv_area_max', name: '最大面积6400m²', desc: '80×80显示正确' },
                        { key: 'bv_vol_min', name: '最小体积0.000125m³', desc: '0.05³显示正确' },
                        { key: 'bv_vol_max', name: '最大体积512000m³', desc: '80³显示或溢出处理' },
                        { key: 'bv_area_overflow', name: '面积溢出处理', desc: '超显示范围时处理' },
                    ]
                },
                // ==================== 2. 单位×模式×基准 组合覆盖 ====================
                {
                    name: '【组合】米制单位×所有模式',
                    items: [
                        { key: 'comb_m_single', name: 'm+单次测量', desc: '米制单次测量显示' },
                        { key: 'comb_m_cont', name: 'm+连续测量', desc: '米制连续测量显示' },
                        { key: 'comb_m_area', name: 'm+面积(m²)', desc: '米制面积单位显示' },
                        { key: 'comb_m_vol', name: 'm+体积(m³)', desc: '米制体积单位显示' },
                        { key: 'comb_m_pyth1', name: 'm+勾股1', desc: '米制勾股模式1显示' },
                        { key: 'comb_m_pyth2', name: 'm+勾股2', desc: '米制勾股模式2显示' },
                        { key: 'comb_m_pyth3', name: 'm+勾股3', desc: '米制勾股模式3显示' },
                        { key: 'comb_m_add', name: 'm+加法', desc: '米制加法累加显示' },
                        { key: 'comb_m_sub', name: 'm+减法', desc: '米制减法结果显示' },
                    ]
                },
                {
                    name: '【组合】英尺单位×所有模式',
                    items: [
                        { key: 'comb_ft_single', name: 'ft+单次测量', desc: '英尺单次测量显示' },
                        { key: 'comb_ft_cont', name: 'ft+连续测量', desc: '英尺连续测量显示' },
                        { key: 'comb_ft_area', name: 'ft+面积(ft²)', desc: '英尺面积单位显示' },
                        { key: 'comb_ft_vol', name: 'ft+体积(ft³)', desc: '英尺体积单位显示' },
                        { key: 'comb_ft_pyth1', name: 'ft+勾股1', desc: '英尺勾股模式1显示' },
                        { key: 'comb_ft_pyth2', name: 'ft+勾股2', desc: '英尺勾股模式2显示' },
                        { key: 'comb_ft_pyth3', name: 'ft+勾股3', desc: '英尺勾股模式3显示' },
                        { key: 'comb_ft_add', name: 'ft+加法', desc: '英尺加法累加显示' },
                        { key: 'comb_ft_sub', name: 'ft+减法', desc: '英尺减法结果显示' },
                    ]
                },
                {
                    name: '【组合】英寸单位×所有模式',
                    items: [
                        { key: 'comb_in_single', name: 'in+单次测量', desc: '英寸单次测量显示' },
                        { key: 'comb_in_cont', name: 'in+连续测量', desc: '英寸连续测量显示' },
                        { key: 'comb_in_area', name: 'in+面积', desc: '英寸面积单位显示' },
                        { key: 'comb_in_vol', name: 'in+体积', desc: '英寸体积单位显示' },
                        { key: 'comb_in_pyth', name: 'in+勾股', desc: '英寸勾股模式显示' },
                    ]
                },
                {
                    name: '【组合】基准×单位交叉',
                    items: [
                        { key: 'comb_base_front_m', name: '前基准+m', desc: '前基准米制测量' },
                        { key: 'comb_base_front_ft', name: '前基准+ft', desc: '前基准英尺测量' },
                        { key: 'comb_base_back_m', name: '后基准+m', desc: '后基准米制测量' },
                        { key: 'comb_base_back_ft', name: '后基准+ft', desc: '后基准英尺测量' },
                        { key: 'comb_base_diff', name: '基准差值验证', desc: '前后基准差=机身长度' },
                    ]
                },
                // ==================== 3. 状态转换测试 ====================
                {
                    name: '【状态转换】模式切换',
                    items: [
                        { key: 'st_single_to_cont', name: '单次→连续', desc: '切换后图标/显示变化' },
                        { key: 'st_cont_to_single', name: '连续→单次', desc: '退出连续后恢复' },
                        { key: 'st_single_to_area', name: '单次→面积', desc: '进入面积模式' },
                        { key: 'st_area_to_vol', name: '面积→体积', desc: '模式循环切换' },
                        { key: 'st_vol_to_pyth', name: '体积→勾股', desc: '进入勾股模式' },
                        { key: 'st_pyth_cycle', name: '勾股1→2→3循环', desc: '勾股子模式切换' },
                        { key: 'st_mode_wrap', name: '模式循环回单次', desc: '最后模式→单次' },
                    ]
                },
                {
                    name: '【状态转换】单位切换',
                    items: [
                        { key: 'st_m_to_ft', name: 'm→ft切换', desc: '数值自动换算' },
                        { key: 'st_ft_to_in', name: 'ft→in切换', desc: '数值自动换算' },
                        { key: 'st_in_to_m', name: 'in→m循环', desc: '单位循环回m' },
                        { key: 'st_unit_in_area', name: '面积模式切单位', desc: 'm²↔ft²切换' },
                        { key: 'st_unit_in_vol', name: '体积模式切单位', desc: 'm³↔ft³切换' },
                        { key: 'st_unit_preserve', name: '切模式保持单位', desc: '模式切换不改单位' },
                    ]
                },
                {
                    name: '【状态转换】测量流程状态',
                    items: [
                        { key: 'st_idle_to_measure', name: '待机→测量中', desc: '按READ后激光开启' },
                        { key: 'st_measure_to_result', name: '测量中→显示结果', desc: '测量完成显示数值' },
                        { key: 'st_result_to_idle', name: '结果→待机', desc: '超时后回待机' },
                        { key: 'st_measure_cancel', name: '测量中取消', desc: '按CLR取消测量' },
                        { key: 'st_area_step1_2', name: '面积步骤1→2', desc: '第一边→第二边' },
                        { key: 'st_area_step2_result', name: '面积步骤2→结果', desc: '计算并显示面积' },
                        { key: 'st_vol_steps', name: '体积3步骤流转', desc: '长→宽→高→结果' },
                    ]
                },
                // ==================== 4. 异常/错误处理测试 ====================
                {
                    name: '【异常】测量错误处理',
                    items: [
                        { key: 'err_no_target', name: '无目标(对空)', desc: '对天空测量显示Error' },
                        { key: 'err_too_close', name: '目标太近(<5cm)', desc: '近距离错误处理' },
                        { key: 'err_too_far', name: '目标太远(>80m)', desc: '超量程错误处理' },
                        { key: 'err_weak_signal', name: '信号太弱', desc: '黑色/远距离弱信号' },
                        { key: 'err_strong_light', name: '强光干扰', desc: '阳光直射错误处理' },
                        { key: 'err_moving_target', name: '目标移动', desc: '连续测量目标移动' },
                        { key: 'err_timeout', name: '测量超时', desc: '3秒无结果超时' },
                        { key: 'err_multi_reflect', name: '多次反射', desc: '玻璃/镜面反射处理' },
                    ]
                },
                {
                    name: '【异常】按键异常处理',
                    items: [
                        { key: 'err_key_stuck', name: '按键卡住', desc: '长时间按住处理' },
                        { key: 'err_key_rapid', name: '快速连按', desc: '100ms内连按防抖' },
                        { key: 'err_key_multi', name: '多键同按', desc: '同时按多键处理' },
                        { key: 'err_key_during_measure', name: '测量中按键', desc: '测量过程按其他键' },
                        { key: 'err_key_invalid_state', name: '无效状态按键', desc: '错误状态下按键' },
                    ]
                },
                {
                    name: '【异常】电源异常处理',
                    items: [
                        { key: 'err_lowbat_measure', name: '低电量测量', desc: '电量<10%时测量' },
                        { key: 'err_lowbat_warning', name: '低电量警告', desc: '低电量图标+蜂鸣' },
                        { key: 'err_lowbat_shutdown', name: '低电量自动关机', desc: '电量耗尽保护' },
                        { key: 'err_charge_during_use', name: '使用中充电', desc: '边充边用显示' },
                        { key: 'err_power_unstable', name: '电源不稳', desc: '电压波动时显示' },
                    ]
                },
                {
                    name: '【异常】数据异常处理',
                    items: [
                        { key: 'err_flash_full', name: '存储满', desc: '历史记录满处理' },
                        { key: 'err_flash_corrupt', name: '数据损坏', desc: 'Flash数据异常恢复' },
                        { key: 'err_calc_overflow', name: '计算溢出', desc: '面积/体积溢出处理' },
                        { key: 'err_negative_result', name: '负数结果', desc: '减法负数显示' },
                        { key: 'err_divide_zero', name: '除零保护', desc: '勾股计算除零' },
                    ]
                },
                {
                    name: '【异常】通讯异常处理',
                    items: [
                        { key: 'err_bt_disconnect', name: '蓝牙断开', desc: '传输中断开处理' },
                        { key: 'err_bt_timeout', name: '蓝牙超时', desc: '连接超时处理' },
                        { key: 'err_usb_disconnect', name: 'USB断开', desc: 'USB拔出处理' },
                        { key: 'err_cmd_invalid', name: '无效命令', desc: '错误串口命令' },
                        { key: 'err_cmd_checksum', name: '校验错误', desc: '数据校验失败' },
                    ]
                },
                // ==================== 5. 等价类测试 ====================
                {
                    name: '【等价类】有效距离范围',
                    items: [
                        { key: 'eq_dist_near', name: '近距离(0.05-1m)', desc: '有效近距离测量' },
                        { key: 'eq_dist_mid', name: '中距离(1-30m)', desc: '有效中距离测量' },
                        { key: 'eq_dist_far', name: '远距离(30-80m)', desc: '有效远距离测量' },
                        { key: 'eq_dist_invalid_low', name: '无效(<0.05m)', desc: '低于最小量程' },
                        { key: 'eq_dist_invalid_high', name: '无效(>80m)', desc: '高于最大量程' },
                    ]
                },
                {
                    name: '【等价类】有效角度范围',
                    items: [
                        { key: 'eq_angle_level', name: '水平(-5°~+5°)', desc: '近水平角度' },
                        { key: 'eq_angle_tilt', name: '倾斜(5°~45°)', desc: '中等倾斜角度' },
                        { key: 'eq_angle_steep', name: '陡峭(45°~90°)', desc: '大角度倾斜' },
                        { key: 'eq_angle_neg', name: '负角度(-90°~0°)', desc: '向下倾斜' },
                    ]
                },
                {
                    name: '【等价类】目标反射率',
                    items: [
                        { key: 'eq_reflect_white', name: '白色目标(>90%)', desc: '高反射率测量' },
                        { key: 'eq_reflect_gray', name: '灰色目标(30-60%)', desc: '中反射率测量' },
                        { key: 'eq_reflect_black', name: '黑色目标(<10%)', desc: '低反射率测量' },
                        { key: 'eq_reflect_mirror', name: '镜面反射', desc: '玻璃/金属表面' },
                        { key: 'eq_reflect_transparent', name: '透明目标', desc: '玻璃穿透测量' },
                    ]
                },
                // ==================== 6. LCD段码完整性 ====================
                {
                    name: '【段码】数字0-9完整性',
                    items: [
                        { key: 'seg_digit_0', name: '数字0显示', desc: '所有行显示0正确' },
                        { key: 'seg_digit_1', name: '数字1显示', desc: '所有行显示1正确' },
                        { key: 'seg_digit_2', name: '数字2显示', desc: '所有行显示2正确' },
                        { key: 'seg_digit_3', name: '数字3显示', desc: '所有行显示3正确' },
                        { key: 'seg_digit_4', name: '数字4显示', desc: '所有行显示4正确' },
                        { key: 'seg_digit_5', name: '数字5显示', desc: '所有行显示5正确' },
                        { key: 'seg_digit_6', name: '数字6显示', desc: '所有行显示6正确' },
                        { key: 'seg_digit_7', name: '数字7显示', desc: '所有行显示7正确' },
                        { key: 'seg_digit_8', name: '数字8显示', desc: '所有行显示8正确(全亮)' },
                        { key: 'seg_digit_9', name: '数字9显示', desc: '所有行显示9正确' },
                    ]
                },
                {
                    name: '【段码】特殊字符显示',
                    items: [
                        { key: 'seg_char_E', name: '字符E(Error)', desc: 'Error显示E正确' },
                        { key: 'seg_char_r', name: '字符r(Error)', desc: 'Error显示r正确' },
                        { key: 'seg_char_dash', name: '横杠-显示', desc: '无数据时---显示' },
                        { key: 'seg_char_blank', name: '空白显示', desc: '前导零消隐' },
                        { key: 'seg_decimal_pos', name: '小数点位置', desc: '1/2/3位小数点' },
                        { key: 'seg_minus_sign', name: '负号显示', desc: '负数负号位置' },
                    ]
                },
                {
                    name: '【段码】图标完整性',
                    items: [
                        { key: 'seg_icon_bat0', name: '电池0格', desc: '空电池框显示' },
                        { key: 'seg_icon_bat1', name: '电池1格', desc: '1格电量显示' },
                        { key: 'seg_icon_bat2', name: '电池2格', desc: '2格电量显示' },
                        { key: 'seg_icon_bat3', name: '电池3格', desc: '满电显示' },
                        { key: 'seg_icon_bt', name: '蓝牙图标', desc: '蓝牙符号完整' },
                        { key: 'seg_icon_beep', name: '蜂鸣器图标', desc: '喇叭符号完整' },
                        { key: 'seg_icon_laser', name: '激光图标', desc: '激光发射符号' },
                    ]
                }
            ]
        },
        perf: {
            name: '性能测试',
            multiDevice: true,
            minDevices: 3,
            groups: [
                // ==================== 精度边界值测试 ====================
                {
                    name: '【边界值】测距精度(滑台)',
                    items: [
                        { key: 'acc_min_0.05m', name: '最小量程0.05m', desc: '误差≤±2mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_1m', name: '1m精度', desc: '误差≤±1.5mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_5m', name: '5m精度', desc: '误差≤±1.5mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_10m', name: '10m精度', desc: '误差≤±1.5mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_30m', name: '30m精度', desc: '误差≤±2mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_50m', name: '50m精度', desc: '误差≤±2mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_79m', name: '79m精度(近极限)', desc: '误差≤±3mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_80m', name: '80m精度(极限)', desc: '误差≤±3mm', hasValue: true, unit: 'mm' },
                        { key: 'acc_80.5m', name: '80.5m(超量程)', desc: '应报错或不显示' },
                    ],
                    slipway: true
                },
                {
                    name: '【边界值】角度精度(MC3416)',
                    items: [
                        { key: 'angle_0', name: '0°(水平)', desc: '误差≤±0.2°', hasValue: true, unit: '°' },
                        { key: 'angle_1', name: '1°(近水平)', desc: '误差≤±0.2°', hasValue: true, unit: '°' },
                        { key: 'angle_45', name: '45°', desc: '误差≤±0.3°', hasValue: true, unit: '°' },
                        { key: 'angle_89', name: '89°(近垂直)', desc: '误差≤±0.3°', hasValue: true, unit: '°' },
                        { key: 'angle_90', name: '90°(垂直)', desc: '误差≤±0.3°', hasValue: true, unit: '°' },
                        { key: 'angle_neg45', name: '-45°', desc: '负角度精度', hasValue: true, unit: '°' },
                        { key: 'angle_neg90', name: '-90°', desc: '负垂直精度', hasValue: true, unit: '°' },
                    ]
                },
                // ==================== 极限条件测试 ====================
                {
                    name: '【极限】环境温度',
                    items: [
                        { key: 'temp_neg10', name: '-10°C低温', desc: '低温精度≤±3mm', hasValue: true, unit: 'mm' },
                        { key: 'temp_0', name: '0°C', desc: '冰点精度', hasValue: true, unit: 'mm' },
                        { key: 'temp_25', name: '25°C(常温)', desc: '标准精度', hasValue: true, unit: 'mm' },
                        { key: 'temp_40', name: '40°C高温', desc: '高温精度≤±3mm', hasValue: true, unit: 'mm' },
                        { key: 'temp_50', name: '50°C(极限)', desc: '极限高温工作' },
                    ]
                },
                {
                    name: '【极限】目标反射率',
                    items: [
                        { key: 'reflect_10', name: '10%反射率', desc: '黑色目标最大距离', hasValue: true, unit: 'm' },
                        { key: 'reflect_30', name: '30%反射率', desc: '深色目标距离', hasValue: true, unit: 'm' },
                        { key: 'reflect_60', name: '60%反射率', desc: '中等目标距离', hasValue: true, unit: 'm' },
                        { key: 'reflect_90', name: '90%反射率', desc: '白色目标距离', hasValue: true, unit: 'm' },
                        { key: 'reflect_mirror', name: '镜面反射', desc: '玻璃/金属测量' },
                    ]
                },
                {
                    name: '【极限】光照条件',
                    items: [
                        { key: 'light_dark', name: '黑暗环境', desc: '0lux精度', hasValue: true, unit: 'mm' },
                        { key: 'light_indoor', name: '室内(500lux)', desc: '室内精度', hasValue: true, unit: 'mm' },
                        { key: 'light_outdoor', name: '室外(10000lux)', desc: '室外精度', hasValue: true, unit: 'mm' },
                        { key: 'light_direct_sun', name: '阳光直射(100000lux)', desc: '强光下最大距离', hasValue: true, unit: 'm' },
                        { key: 'light_laser_interfere', name: '激光干扰', desc: '其他激光源干扰' },
                    ]
                },
                // ==================== 重复性/稳定性测试 ====================
                {
                    name: '【重复性】同点多次测量',
                    items: [
                        { key: 'repeat_10_1m', name: '1m×10次', desc: '标准差≤0.5mm', hasValue: true, unit: 'mm' },
                        { key: 'repeat_10_10m', name: '10m×10次', desc: '标准差≤0.5mm', hasValue: true, unit: 'mm' },
                        { key: 'repeat_10_50m', name: '50m×10次', desc: '标准差≤1mm', hasValue: true, unit: 'mm' },
                        { key: 'repeat_100', name: '100次连续测量', desc: '无累积误差' },
                        { key: 'repeat_1000', name: '1000次压力测试', desc: '长时间稳定性' },
                    ]
                },
                {
                    name: '【稳定性】长时间运行',
                    items: [
                        { key: 'stable_1h', name: '1小时连续', desc: '精度无衰减' },
                        { key: 'stable_4h', name: '4小时连续', desc: '精度无衰减' },
                        { key: 'stable_8h', name: '8小时连续', desc: '精度无衰减' },
                        { key: 'stable_temp_drift', name: '温漂测试', desc: '温度变化时精度' },
                        { key: 'stable_angle_drift', name: '角度漂移', desc: '长时间角度稳定' },
                    ]
                },
                // ==================== 响应时间边界 ====================
                {
                    name: '【边界值】响应时间',
                    items: [
                        { key: 'speed_boot', name: '开机时间', desc: '≤2秒', hasValue: true, unit: 's' },
                        { key: 'speed_first_measure', name: '首次测量', desc: '开机后首测≤1秒', hasValue: true, unit: 's' },
                        { key: 'speed_single_near', name: '近距离单测', desc: '1m测量≤0.3秒', hasValue: true, unit: 's' },
                        { key: 'speed_single_far', name: '远距离单测', desc: '80m测量≤0.8秒', hasValue: true, unit: 's' },
                        { key: 'speed_cont_rate', name: '连续测量频率', desc: '≥2次/秒', hasValue: true, unit: 'Hz' },
                        { key: 'speed_key_response', name: '按键响应', desc: '≤50ms', hasValue: true, unit: 'ms' },
                        { key: 'speed_lcd_refresh', name: 'LCD刷新', desc: '≤100ms', hasValue: true, unit: 'ms' },
                        { key: 'speed_angle_update', name: '角度更新', desc: '≤100ms', hasValue: true, unit: 'ms' },
                    ]
                },
                // ==================== 功耗边界 ====================
                {
                    name: '【边界值】功耗测试',
                    items: [
                        { key: 'power_off', name: '关机电流', desc: '≤10μA', hasValue: true, unit: 'μA' },
                        { key: 'power_sleep', name: '休眠电流', desc: '≤100μA', hasValue: true, unit: 'μA' },
                        { key: 'power_idle', name: '待机电流', desc: '≤5mA', hasValue: true, unit: 'mA' },
                        { key: 'power_idle_bl', name: '待机+背光', desc: '背光开启电流', hasValue: true, unit: 'mA' },
                        { key: 'power_measure', name: '测量电流', desc: '≤150mA', hasValue: true, unit: 'mA' },
                        { key: 'power_peak', name: '峰值电流', desc: '激光发射瞬间', hasValue: true, unit: 'mA' },
                        { key: 'power_bt_active', name: '蓝牙传输', desc: '蓝牙活动电流', hasValue: true, unit: 'mA' },
                        { key: 'power_laser', name: '激光功率', desc: '≤1mW(Class 2)', hasValue: true, unit: 'mW' },
                    ]
                },
                {
                    name: '【边界值】电池续航',
                    items: [
                        { key: 'battery_measure_count', name: '测量次数', desc: '满电≥5000次', hasValue: true, unit: '次' },
                        { key: 'battery_standby_time', name: '待机时间', desc: '满电待机≥30天', hasValue: true, unit: '天' },
                        { key: 'battery_charge_time', name: '充电时间', desc: '0→100%≤3小时', hasValue: true, unit: 'h' },
                        { key: 'battery_charge_temp', name: '充电温升', desc: '温升≤10°C', hasValue: true, unit: '°C' },
                    ]
                }
            ]
        },
        func: {
            name: '功能测试',
            groups: [
                // ==================== 测量功能完整流程 ====================
                {
                    name: '【流程】单次测量完整流程',
                    items: [
                        { key: 'flow_single_idle', name: '待机状态确认', desc: '显示上次结果或---' },
                        { key: 'flow_single_press', name: '按READ触发', desc: '激光开启，显示测量中' },
                        { key: 'flow_single_laser', name: '激光点确认', desc: '红点可见，位置正确' },
                        { key: 'flow_single_result', name: '结果显示', desc: '数值显示，激光关闭' },
                        { key: 'flow_single_beep', name: '完成提示音', desc: '蜂鸣器响一声' },
                        { key: 'flow_single_save', name: '自动保存', desc: '结果存入历史' },
                        { key: 'flow_single_timeout', name: '超时回待机', desc: '无操作后回待机' },
                    ]
                },
                {
                    name: '【流程】连续测量完整流程',
                    items: [
                        { key: 'flow_cont_enter', name: '长按进入', desc: '长按READ 2秒进入' },
                        { key: 'flow_cont_icon', name: '连续图标显示', desc: '连续测量图标亮起' },
                        { key: 'flow_cont_update', name: '实时更新', desc: '数值持续刷新' },
                        { key: 'flow_cont_max', name: 'MAX值记录', desc: '最大值自动记录' },
                        { key: 'flow_cont_min', name: 'MIN值记录', desc: '最小值自动记录' },
                        { key: 'flow_cont_exit_clr', name: 'CLR退出', desc: '按CLR退出连续' },
                        { key: 'flow_cont_exit_read', name: 'READ退出', desc: '按READ锁定当前值' },
                        { key: 'flow_cont_save', name: '退出时保存', desc: '最终值存入历史' },
                    ]
                },
                {
                    name: '【流程】面积测量完整流程',
                    items: [
                        { key: 'flow_area_enter', name: '进入面积模式', desc: 'MODE切换到面积' },
                        { key: 'flow_area_icon', name: '面积图标显示', desc: '矩形图标亮起' },
                        { key: 'flow_area_step1', name: '测量第一边(长)', desc: '显示L1，等待测量' },
                        { key: 'flow_area_step1_done', name: '第一边完成', desc: '显示长度值' },
                        { key: 'flow_area_step2', name: '测量第二边(宽)', desc: '显示L2，等待测量' },
                        { key: 'flow_area_calc', name: '计算面积', desc: '自动计算L1×L2' },
                        { key: 'flow_area_result', name: '结果显示', desc: '显示面积+单位m²' },
                        { key: 'flow_area_detail', name: '详情显示', desc: '可查看长/宽/面积' },
                        { key: 'flow_area_cancel', name: '中途取消', desc: 'CLR取消回第一步' },
                    ]
                },
                {
                    name: '【流程】体积测量完整流程',
                    items: [
                        { key: 'flow_vol_enter', name: '进入体积模式', desc: 'MODE切换到体积' },
                        { key: 'flow_vol_icon', name: '体积图标显示', desc: '立方体图标亮起' },
                        { key: 'flow_vol_step1', name: '测量长', desc: '显示L1' },
                        { key: 'flow_vol_step2', name: '测量宽', desc: '显示L2' },
                        { key: 'flow_vol_step3', name: '测量高', desc: '显示L3' },
                        { key: 'flow_vol_calc', name: '计算体积', desc: 'L1×L2×L3' },
                        { key: 'flow_vol_result', name: '结果显示', desc: '显示体积+单位m³' },
                        { key: 'flow_vol_cancel_step2', name: '第2步取消', desc: '回到第1步' },
                        { key: 'flow_vol_cancel_step3', name: '第3步取消', desc: '回到第2步' },
                    ]
                },
                {
                    name: '【流程】勾股测量完整流程',
                    items: [
                        { key: 'flow_pyth_enter', name: '进入勾股模式', desc: 'MODE切换到勾股' },
                        { key: 'flow_pyth_mode1', name: '模式1(单边+角度)', desc: '测一边+倾角计算' },
                        { key: 'flow_pyth_mode2', name: '模式2(双边)', desc: '测两边计算高度' },
                        { key: 'flow_pyth_mode3', name: '模式3(三边)', desc: '测三边计算高度' },
                        { key: 'flow_pyth_angle_show', name: '角度实时显示', desc: '测量时显示倾角' },
                        { key: 'flow_pyth_calc', name: '三角计算', desc: '勾股定理计算' },
                        { key: 'flow_pyth_result', name: '高度结果', desc: '显示计算高度' },
                    ]
                },
                // ==================== 加减法边界测试 ====================
                {
                    name: '【边界值】加减法计算',
                    items: [
                        { key: 'calc_add_2', name: '2次累加', desc: 'A+B正确' },
                        { key: 'calc_add_10', name: '10次累加', desc: '多次累加无误差' },
                        { key: 'calc_add_max', name: '累加到最大值', desc: '接近显示上限' },
                        { key: 'calc_add_overflow', name: '累加溢出', desc: '超限时处理' },
                        { key: 'calc_sub_normal', name: '正常减法', desc: 'A-B(A>B)正确' },
                        { key: 'calc_sub_negative', name: '减法负数', desc: 'A-B(A<B)显示负数' },
                        { key: 'calc_sub_zero', name: '减法为零', desc: 'A-A=0显示' },
                        { key: 'calc_mixed', name: '加减混合', desc: 'A+B-C正确' },
                    ]
                },
                // ==================== 单位换算精度 ====================
                {
                    name: '【精度】单位换算验证',
                    items: [
                        { key: 'unit_m_to_ft', name: 'm→ft换算', desc: '1m=3.28084ft' },
                        { key: 'unit_ft_to_m', name: 'ft→m换算', desc: '1ft=0.3048m' },
                        { key: 'unit_m_to_in', name: 'm→in换算', desc: '1m=39.3701in' },
                        { key: 'unit_in_to_m', name: 'in→m换算', desc: '1in=0.0254m' },
                        { key: 'unit_m2_to_ft2', name: 'm²→ft²换算', desc: '1m²=10.7639ft²' },
                        { key: 'unit_m3_to_ft3', name: 'm³→ft³换算', desc: '1m³=35.3147ft³' },
                        { key: 'unit_round_trip', name: '往返换算', desc: 'm→ft→m无损失' },
                        { key: 'unit_precision', name: '换算精度', desc: '小数位数正确' },
                    ]
                },
                // ==================== 数据存储边界 ====================
                {
                    name: '【边界值】数据存储',
                    items: [
                        { key: 'store_first', name: '第1条记录', desc: '首次存储正确' },
                        { key: 'store_20th', name: '第20条记录', desc: '存满20条' },
                        { key: 'store_21st', name: '第21条(溢出)', desc: '覆盖最旧记录' },
                        { key: 'store_nav_first', name: '翻页到第1条', desc: '边界不越界' },
                        { key: 'store_nav_last', name: '翻页到最后', desc: '边界不越界' },
                        { key: 'store_nav_wrap', name: '翻页循环', desc: '最后→第一循环' },
                        { key: 'store_clear_all', name: '清除全部', desc: '长按CLR清空' },
                        { key: 'store_clear_confirm', name: '清除确认', desc: '有确认提示' },
                        { key: 'store_power_off', name: '掉电保持', desc: '关机后数据在' },
                    ]
                },
                // ==================== 通讯协议测试 ====================
                {
                    name: '【协议】串口命令测试',
                    items: [
                        { key: 'cmd_measure', name: '测量命令', desc: '远程触发测量' },
                        { key: 'cmd_read_result', name: '读取结果', desc: '获取测量值' },
                        { key: 'cmd_set_unit', name: '设置单位', desc: '远程切换单位' },
                        { key: 'cmd_set_base', name: '设置基准', desc: '远程切换基准' },
                        { key: 'cmd_get_version', name: '获取版本', desc: '读取固件版本' },
                        { key: 'cmd_get_sn', name: '获取序列号', desc: '读取设备SN' },
                        { key: 'cmd_invalid', name: '无效命令', desc: '错误命令响应' },
                        { key: 'cmd_checksum_err', name: '校验错误', desc: '校验失败响应' },
                        { key: 'cmd_timeout', name: '命令超时', desc: '无响应处理' },
                    ]
                },
                {
                    name: '【协议】蓝牙功能测试',
                    items: [
                        { key: 'bt_pair', name: '配对连接', desc: '首次配对成功' },
                        { key: 'bt_reconnect', name: '自动重连', desc: '断开后自动连' },
                        { key: 'bt_range', name: '传输距离', desc: '10m内稳定' },
                        { key: 'bt_data_sync', name: '数据同步', desc: '测量后自动发送' },
                        { key: 'bt_remote_measure', name: '远程测量', desc: 'APP触发测量' },
                        { key: 'bt_multi_device', name: '多设备切换', desc: '切换手机连接' },
                        { key: 'bt_disconnect', name: '主动断开', desc: '断开后图标消失' },
                    ]
                },
                // ==================== 设置功能边界 ====================
                {
                    name: '【边界值】设置参数',
                    items: [
                        { key: 'set_beep_off', name: '蜂鸣器关', desc: '静音模式' },
                        { key: 'set_beep_low', name: '蜂鸣器低', desc: '低音量' },
                        { key: 'set_beep_high', name: '蜂鸣器高', desc: '高音量' },
                        { key: 'set_bl_off', name: '背光关', desc: '背光禁用' },
                        { key: 'set_bl_5s', name: '背光5秒', desc: '最短时间' },
                        { key: 'set_bl_60s', name: '背光60秒', desc: '最长时间' },
                        { key: 'set_bl_always', name: '背光常亮', desc: '不自动关' },
                        { key: 'set_autooff_1min', name: '自动关机1分钟', desc: '最短时间' },
                        { key: 'set_autooff_30min', name: '自动关机30分钟', desc: '最长时间' },
                        { key: 'set_autooff_never', name: '不自动关机', desc: '禁用自动关机' },
                        { key: 'set_factory_reset', name: '恢复出厂', desc: '所有设置重置' },
                        { key: 'set_preserve', name: '设置保持', desc: '关机后设置在' },
                    ]
                }
            ]
        },
        stability: {
            name: '稳定性/异常测试',
            groups: [
                // ==================== 异常输入测试 ====================
                {
                    name: '【异常输入】按键异常',
                    items: [
                        { key: 'abnormal_key_stuck_1s', name: '按键卡住1秒', desc: '单次触发不重复' },
                        { key: 'abnormal_key_stuck_10s', name: '按键卡住10秒', desc: '长按功能正常' },
                        { key: 'abnormal_key_stuck_60s', name: '按键卡住60秒', desc: '不死机不异常' },
                        { key: 'abnormal_key_rapid_10', name: '10次/秒连按', desc: '防抖正常' },
                        { key: 'abnormal_key_rapid_50', name: '50次/秒连按', desc: '不死机' },
                        { key: 'abnormal_key_all_press', name: '所有键同按', desc: '不死机不异常' },
                        { key: 'abnormal_key_random', name: '随机乱按1分钟', desc: '状态可恢复' },
                    ]
                },
                {
                    name: '【异常输入】测量异常',
                    items: [
                        { key: 'abnormal_no_target', name: '对空测量', desc: '超时报错' },
                        { key: 'abnormal_moving', name: '移动中测量', desc: '结果或报错' },
                        { key: 'abnormal_vibrate', name: '振动中测量', desc: '结果或报错' },
                        { key: 'abnormal_tilt_measure', name: '大角度倾斜测', desc: '角度显示正确' },
                        { key: 'abnormal_rapid_measure', name: '快速连续测量', desc: '不死机' },
                        { key: 'abnormal_measure_1000', name: '1000次连续', desc: '无累积错误' },
                    ]
                },
                // ==================== 电源异常测试 ====================
                {
                    name: '【异常】电源异常',
                    items: [
                        { key: 'power_sudden_off', name: '突然断电', desc: '数据不丢失' },
                        { key: 'power_low_voltage', name: '低电压工作', desc: '3.0V能开机' },
                        { key: 'power_critical_low', name: '临界低电', desc: '2.8V保护关机' },
                        { key: 'power_measure_lowbat', name: '低电量测量', desc: '能完成测量' },
                        { key: 'power_charge_use', name: '边充边用', desc: '功能正常' },
                        { key: 'power_charge_full', name: '充满保护', desc: '不过充' },
                        { key: 'power_charge_remove', name: '充电中拔出', desc: '正常工作' },
                        { key: 'power_reverse', name: '电池反接', desc: '保护不损坏' },
                    ]
                },
                // ==================== 通讯异常测试 ====================
                {
                    name: '【异常】通讯异常',
                    items: [
                        { key: 'comm_bt_disconnect', name: '蓝牙突然断开', desc: '不死机可重连' },
                        { key: 'comm_bt_out_range', name: '蓝牙超距离', desc: '断开后可重连' },
                        { key: 'comm_bt_interfere', name: '蓝牙干扰', desc: '2.4G干扰下' },
                        { key: 'comm_usb_disconnect', name: 'USB突然拔出', desc: '不死机' },
                        { key: 'comm_usb_reconnect', name: 'USB重新连接', desc: '自动识别' },
                        { key: 'comm_cmd_flood', name: '命令洪水', desc: '大量命令不死机' },
                        { key: 'comm_cmd_garbage', name: '垃圾数据', desc: '乱码不死机' },
                    ]
                },
                // ==================== 存储异常测试 ====================
                {
                    name: '【异常】存储异常',
                    items: [
                        { key: 'flash_write_fail', name: '写入失败模拟', desc: '错误处理' },
                        { key: 'flash_read_fail', name: '读取失败模拟', desc: '错误处理' },
                        { key: 'flash_corrupt', name: '数据损坏', desc: '能检测并恢复' },
                        { key: 'flash_full', name: '存储满', desc: '覆盖旧数据' },
                        { key: 'flash_wear', name: '磨损均衡', desc: '长期使用不坏' },
                    ]
                },
                // ==================== 环境极限测试 ====================
                {
                    name: '【极限】温度极限',
                    items: [
                        { key: 'env_temp_neg20', name: '-20°C(超低温)', desc: '能开机或保护', hasValue: true, unit: '°C' },
                        { key: 'env_temp_neg10', name: '-10°C(低温)', desc: '正常工作', hasValue: true, unit: '°C' },
                        { key: 'env_temp_0', name: '0°C(冰点)', desc: '正常工作', hasValue: true, unit: '°C' },
                        { key: 'env_temp_40', name: '40°C(高温)', desc: '正常工作', hasValue: true, unit: '°C' },
                        { key: 'env_temp_50', name: '50°C(极限高温)', desc: '能工作或保护', hasValue: true, unit: '°C' },
                        { key: 'env_temp_60', name: '60°C(超高温)', desc: '保护关机', hasValue: true, unit: '°C' },
                        { key: 'env_temp_cycle', name: '温度循环', desc: '-10↔40°C循环10次' },
                    ]
                },
                {
                    name: '【极限】湿度/防护',
                    items: [
                        { key: 'env_humid_30', name: '30%RH(干燥)', desc: '正常工作' },
                        { key: 'env_humid_85', name: '85%RH(高湿)', desc: '正常工作' },
                        { key: 'env_humid_95', name: '95%RH(极湿)', desc: '能工作或保护' },
                        { key: 'env_rain', name: '淋雨测试', desc: 'IP54防水' },
                        { key: 'env_dust', name: '灰尘测试', desc: 'IP54防尘' },
                        { key: 'env_salt_spray', name: '盐雾测试', desc: '48小时盐雾' },
                    ]
                },
                // ==================== 机械可靠性 ====================
                {
                    name: '【可靠性】机械测试',
                    items: [
                        { key: 'mech_drop_0.5m', name: '0.5m跌落', desc: '6面各1次' },
                        { key: 'mech_drop_1m', name: '1m跌落', desc: '6面各1次' },
                        { key: 'mech_drop_1.5m', name: '1.5m跌落', desc: '极限跌落' },
                        { key: 'mech_vibrate', name: '振动测试', desc: '10-500Hz扫频' },
                        { key: 'mech_shock', name: '冲击测试', desc: '100G冲击' },
                        { key: 'mech_key_life', name: '按键寿命', desc: '10万次按键' },
                        { key: 'mech_lcd_press', name: 'LCD按压', desc: '按压不花屏' },
                    ]
                },
                // ==================== 看门狗/恢复测试 ====================
                {
                    name: '【恢复】异常恢复',
                    items: [
                        { key: 'recover_wdt_reset', name: '看门狗复位', desc: '死机后自动重启' },
                        { key: 'recover_wdt_time', name: '复位时间', desc: '≤3秒恢复', hasValue: true, unit: 's' },
                        { key: 'recover_hardfault', name: 'HardFault恢复', desc: '异常后重启' },
                        { key: 'recover_stack_overflow', name: '栈溢出恢复', desc: '检测并重启' },
                        { key: 'recover_data_after_reset', name: '复位后数据', desc: '设置/历史保留' },
                        { key: 'recover_state_after_reset', name: '复位后状态', desc: '回到待机状态' },
                    ]
                },
                // ==================== 固件升级测试 ====================
                {
                    name: '【升级】固件升级',
                    items: [
                        { key: 'upgrade_usb_normal', name: 'USB正常升级', desc: '升级成功' },
                        { key: 'upgrade_usb_interrupt', name: 'USB升级中断', desc: '断电后可恢复' },
                        { key: 'upgrade_usb_corrupt', name: '固件损坏', desc: '校验失败拒绝' },
                        { key: 'upgrade_usb_wrong_ver', name: '错误版本', desc: '版本检查拒绝' },
                        { key: 'upgrade_bt_ota', name: '蓝牙OTA升级', desc: 'OTA升级成功' },
                        { key: 'upgrade_bt_interrupt', name: 'OTA中断', desc: '断开后可恢复' },
                        { key: 'upgrade_rollback', name: '升级回滚', desc: '失败后回滚旧版' },
                        { key: 'upgrade_verify', name: '升级验证', desc: '版本号正确' },
                        { key: 'upgrade_data_preserve', name: '数据保留', desc: '升级后数据在' },
                        { key: 'upgrade_settings_preserve', name: '设置保留', desc: '升级后设置在' },
                    ]
                },
                // ==================== 长期稳定性 ====================
                {
                    name: '【长期】稳定性测试',
                    items: [
                        { key: 'longterm_1h', name: '1小时连续', desc: '无异常无漂移' },
                        { key: 'longterm_8h', name: '8小时连续', desc: '无异常无漂移' },
                        { key: 'longterm_24h', name: '24小时连续', desc: '无异常无漂移' },
                        { key: 'longterm_1week', name: '1周老化', desc: '开机1周稳定' },
                        { key: 'longterm_measure_10000', name: '10000次测量', desc: '无累积误差' },
                        { key: 'longterm_onoff_1000', name: '1000次开关机', desc: '开关机循环' },
                        { key: 'longterm_mode_switch_1000', name: '1000次模式切换', desc: '模式切换循环' },
                    ]
                }
            ]
        }
    },

    // 渲染测试内容
    renderTestContent() {
        // 显示版本信息栏
        this.renderVersionBar();
        // 显示共享文件操作栏
        const shareBar = document.getElementById('share-bar');
        if (shareBar) shareBar.style.display = 'block';
        // 允许点击按钮（未打开任务文件时会在点击后提示）
        const btnUpdate = document.getElementById('btn-update-share');
        if (btnUpdate) btnUpdate.disabled = false;
        const btnSubmit = document.getElementById('btn-submit-result');
        if (btnSubmit) btnSubmit.disabled = false;
        // 显示标签页
        const tabsEl = document.getElementById('test-tabs');
        if (tabsEl) tabsEl.style.display = 'flex';
        // 渲染当前标签内容
        this.renderTabContent();
    },

    clearHistory() {
        if (!this.history || this.history.length === 0) return;
        Utils.confirm('确定清空历史记录吗？').then(ok => {
            if (!ok) return;
            // 后端暂无清空接口：前端先清掉显示
            this.history = [];
            this.renderHistory();
            Utils.toast('已清空历史（仅本地显示）', 'info');
        });
    },

    async quickReject(testId) {
        const reason = await Utils.prompt('请输入驳回原因（可选）', '');
        // 后端是否有接口不确定：先本地从队列移除并提示
        this.queue = (this.queue || []).filter(t => t.id !== testId);
        this.renderQueue();
        Utils.toast(reason ? `已驳回：${reason}` : '已驳回', 'warning');
    },
    
    // 渲染版本信息栏
    renderVersionBar() {
        const container = document.getElementById('version-bar');
        if (!container || !this.currentTest) return;
        
        const t = this.currentTest;
        const tplName = this.templateLibrary[this.currentTemplateId]?.name || '默认模板';
        
        container.innerHTML = `
            <div class="info-grid" style="grid-template-columns: repeat(5, 1fr)">
                <div class="info-item">
                    <div class="label">产品名称</div>
                    <div class="value">${t.project?.name || '--'}</div>
                </div>
                <div class="info-item">
                    <div class="label">软件版本</div>
                    <div class="value">v${t.version}</div>
                </div>
                <div class="info-item">
                    <div class="label">Git提交</div>
                    <div class="value">${t.git_commit || t.gitCommit || '--'}</div>
                </div>
                <div class="info-item">
                    <div class="label">提交时间</div>
                    <div class="value">${t.created_at || t.createdAt || '--'}</div>
                </div>
                <div class="info-item">
                    <div class="label">测试模板</div>
                    <div class="value" style="cursor:pointer; color:var(--primary-color)" onclick="TestQueuePage.showTemplateSelect()">
                        📋 ${tplName} <span style="font-size:10px">▼</span>
                    </div>
                </div>
            </div>
        `;
    },
    
    // 切换标签
    switchTab(tab) {
        this.currentTab = tab;
        // 更新标签样式
        document.querySelectorAll('.test-tabs .tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        this.renderTabContent();
    },
    
    // 渲染标签内容
    renderTabContent() {
        const container = document.getElementById('test-content');
        if (!container) return;
        
        // 初始化测试结果
        if (!this.testResults) {
            this.testResults = { issues: [], customItems: [] };
        }
        if (!this.testResults.issues) this.testResults.issues = [];
        if (!this.testResults.customItems) this.testResults.customItems = [];
        
        if (this.currentTab === 'summary') {
            this.renderReport();
            return;
        }
        
        if (this.currentTab === 'issues') {
            this.renderIssues();
            return;
        }
        
        const template = this.testTemplate[this.currentTab];
        if (!template) return;
        
        let html = '';
        
        // 多设备测试：显示设备管理栏
        if (template.multiDevice) {
            html += this.renderDeviceBar(template);
        }
        
        // UI测试标签页：添加自动化测试入口和批量执行按钮
        if (this.currentTab === 'ui') {
            html += `
                <div class="slipway-link" style="background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.3);">
                    <div class="icon">🤖</div>
                    <div class="info">
                        <div class="title">UI自动化测试</div>
                        <div class="desc">每个测试项可单独执行自动化脚本，或批量执行所有支持自动化的测试项</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn" onclick="TestQueuePage.runAllAutoTests()" style="background: var(--accent); color: var(--text-on-accent);">▶ 批量自动执行</button>
                        <button class="btn" onclick="TestQueuePage.editAutoScripts()" style="background: var(--card-bg); border: 1px solid var(--border-color);">✏️ 编辑脚本</button>
                        <button class="btn" onclick="switchPage('ui_test_integrated')" style="background: var(--card-bg); border: 1px solid var(--border-color);">📋 规范化测试</button>
                    </div>
                </div>
            `;
        }
        
        template.groups.forEach(group => {
            // 滑台测试链接
            if (group.slipway) {
                html += `
                    <div class="slipway-link">
                        <div class="icon">🎯</div>
                        <div class="info">
                            <div class="title">使用滑台进行精度测试</div>
                            <div class="desc">跳转到滑台测试页面进行自动化精度测试</div>
                        </div>
                        <button class="btn" onclick="switchPage('slipway')">打开滑台测试</button>
                    </div>
                `;
            }
            
            // 获取当前设备的测试结果
            const deviceResults = template.multiDevice && this.testDevices.length > 0
                ? (this.testResults.devices[this.currentDeviceIdx] || {})
                : this.testResults;
            
            // 计算进度
            const total = group.items.length;
            const done = group.items.filter(item => 
                deviceResults[item.key] === 'pass' || deviceResults[item.key] === 'fail'
            ).length;
            
            html += `<div class="test-group">
                <div class="test-group-header">
                    <h3>${group.name}</h3>
                    <span class="progress">${done}/${total}</span>
                </div>`;
            
            group.items.forEach(item => {
                const result = deviceResults[item.key];
                const value = deviceResults[item.key + '_value'] || '';
                const hasAutoScript = this.autoScripts && this.autoScripts[item.key];
                
                html += `
                    <div class="test-item" data-key="${item.key}">
                        <div class="checkbox ${result === 'pass' ? 'checked' : ''} ${result === 'fail' ? 'failed' : ''}"
                             onclick="event.stopPropagation(); TestQueuePage.toggleResult('${item.key}')">
                            ${result === 'pass' ? '✓' : result === 'fail' ? '✗' : ''}
                        </div>
                        <div class="content" onclick="TestQueuePage.showItemDetail('${item.key}')">
                            <div class="name">${item.name} ${hasAutoScript ? '<span style="color:var(--accent);font-size:10px;">🤖</span>' : ''}</div>
                            <div class="desc">${item.desc}</div>
                        </div>
                        ${item.hasValue ? `
                            <input type="number" class="value-input" placeholder="测量值" 
                                   value="${value}"
                                   onchange="TestQueuePage.setDeviceValue('${item.key}', this.value)">
                            <span class="unit">${item.unit}</span>
                        ` : ''}
                        <div class="result-btns">
                            ${hasAutoScript ? `<button class="result-btn auto" style="background:rgba(0,255,136,0.1);border-color:var(--accent);color:var(--accent);"
                                    onclick="event.stopPropagation(); TestQueuePage.runAutoTest('${item.key}')">▶ 自动</button>` : ''}
                            <button class="result-btn pass ${result === 'pass' ? 'active' : ''}"
                                    onclick="event.stopPropagation(); TestQueuePage.setResult('${item.key}', 'pass')">通过</button>
                            <button class="result-btn fail ${result === 'fail' ? 'active' : ''}"
                                    onclick="event.stopPropagation(); TestQueuePage.setResult('${item.key}', 'fail')">不通过</button>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        });
        
        container.innerHTML = html;
    },
    
    // 渲染设备管理栏
    renderDeviceBar(template) {
        const minDevices = template.minDevices || 3;
        const deviceCount = this.testDevices.length;
        const needMore = deviceCount < minDevices;
        
        let deviceTabs = this.testDevices.map((dev, idx) => {
            const isActive = idx === this.currentDeviceIdx;
            const devResults = this.testResults.devices[idx] || {};
            const hasResults = Object.keys(devResults).some(k => !k.endsWith('_value'));
            return `
                <div class="device-tab ${isActive ? 'active' : ''} ${hasResults ? 'has-data' : ''}" 
                     onclick="TestQueuePage.switchDevice(${idx})">
                    <span class="device-sn">${dev.sn || `设备${idx + 1}`}</span>
                    ${hasResults ? '<span class="device-status">✓</span>' : ''}
                </div>
            `;
        }).join('');
        
        return `
            <div class="device-bar">
                <div class="device-info">
                    <span class="label">📱 多设备测试</span>
                    <span class="hint">需要至少 ${minDevices} 台设备验证</span>
                    <span class="count ${needMore ? 'warning' : 'ok'}">${deviceCount}/${minDevices}</span>
                </div>
                <div class="device-tabs">
                    ${deviceTabs}
                    <button class="add-device-btn" onclick="TestQueuePage.addDevice()">+ 添加设备</button>
                </div>
                ${this.testDevices.length > 0 ? `
                <div class="current-device-info">
                    <span>当前: ${this.testDevices[this.currentDeviceIdx]?.sn || '未知'}</span>
                    <button class="btn-small" onclick="TestQueuePage.editDevice(${this.currentDeviceIdx})">编辑</button>
                    <button class="btn-small danger" onclick="TestQueuePage.removeDevice(${this.currentDeviceIdx})">删除</button>
                </div>
                ` : '<div class="empty-hint">请先添加测试设备</div>'}
            </div>
        `;
    },
    
    // 添加测试设备
    async addDevice() {
        const sn = prompt('请输入设备序列号/SN:');
        if (!sn) return;
        
        // 检查是否重复
        if (this.testDevices.some(d => d.sn === sn)) {
            Utils.toast('该设备已添加', 'warning');
            return;
        }
        
        this.testDevices.push({
            sn: sn,
            addedAt: new Date().toISOString()
        });
        
        // 初始化该设备的测试结果
        this.testResults.devices[this.testDevices.length - 1] = {};
        
        // 切换到新设备
        this.currentDeviceIdx = this.testDevices.length - 1;
        
        this.renderTabContent();
        Utils.toast(`已添加设备: ${sn}`, 'success');
    },
    
    // 切换设备
    switchDevice(idx) {
        if (idx < 0 || idx >= this.testDevices.length) return;
        this.currentDeviceIdx = idx;
        this.renderTabContent();
    },
    
    // 编辑设备
    editDevice(idx) {
        const dev = this.testDevices[idx];
        if (!dev) return;
        
        const newSn = prompt('修改设备序列号:', dev.sn);
        if (newSn && newSn !== dev.sn) {
            dev.sn = newSn;
            this.renderTabContent();
        }
    },
    
    // 删除设备
    removeDevice(idx) {
        if (!confirm('确定删除该设备及其测试数据？')) return;
        
        this.testDevices.splice(idx, 1);
        delete this.testResults.devices[idx];
        
        // 重新整理设备索引
        const newDevices = {};
        Object.keys(this.testResults.devices).forEach((key, i) => {
            if (parseInt(key) > idx) {
                newDevices[parseInt(key) - 1] = this.testResults.devices[key];
            } else if (parseInt(key) < idx) {
                newDevices[key] = this.testResults.devices[key];
            }
        });
        this.testResults.devices = newDevices;
        
        // 调整当前设备索引
        if (this.currentDeviceIdx >= this.testDevices.length) {
            this.currentDeviceIdx = Math.max(0, this.testDevices.length - 1);
        }
        
        this.renderTabContent();
    },
    
    // 设置设备测试值
    setDeviceValue(key, value) {
        const template = this.testTemplate[this.currentTab];
        if (template?.multiDevice && this.testDevices.length > 0) {
            if (!this.testResults.devices[this.currentDeviceIdx]) {
                this.testResults.devices[this.currentDeviceIdx] = {};
            }
            this.testResults.devices[this.currentDeviceIdx][key + '_value'] = value;
        } else {
            this.testResults[key + '_value'] = value;
        }
    },
    
    // 设置测试结果
    setResult(key, result) {
        const template = this.testTemplate[this.currentTab];
        if (template?.multiDevice && this.testDevices.length > 0) {
            // 多设备模式：存储到当前设备
            if (!this.testResults.devices[this.currentDeviceIdx]) {
                this.testResults.devices[this.currentDeviceIdx] = {};
            }
            this.testResults.devices[this.currentDeviceIdx][key] = result;
        } else {
            // 单设备模式
            this.testResults[key] = result;
        }
        this.renderTabContent();
    },
    
    // 切换结果
    toggleResult(key) {
        const template = this.testTemplate[this.currentTab];
        let currentResult;
        
        if (template?.multiDevice && this.testDevices.length > 0) {
            const devResults = this.testResults.devices[this.currentDeviceIdx] || {};
            currentResult = devResults[key];
        } else {
            currentResult = this.testResults[key];
        }
        
        let newResult;
        if (currentResult === 'pass') {
            newResult = 'fail';
        } else if (currentResult === 'fail') {
            newResult = null;
        } else {
            newResult = 'pass';
        }
        
        this.setResult(key, newResult);
    },
    
    // 渲染异常记录
    renderIssues() {
        const container = document.getElementById('test-content');
        if (!container) return;
        
        const issues = this.testResults.issues || [];
        const customItems = this.testResults.customItems || [];
        
        container.innerHTML = `
            <!-- 添加异常 -->
            <div class="test-group">
                <div class="test-group-header">
                    <h3>⚠️ 异常问题记录</h3>
                    <button class="add-btn" onclick="TestQueuePage.addIssue()">+ 添加异常</button>
                </div>
                ${issues.length === 0 ? '<div class="empty-hint">暂无异常记录</div>' : ''}
                ${issues.map((issue, i) => `
                    <div class="issue-card ${issue.severity}">
                        <div class="issue-header">
                            <span class="severity-badge ${issue.severity}">${issue.severity === 'critical' ? '严重' : issue.severity === 'major' ? '主要' : '次要'}</span>
                            <span class="issue-category">${issue.category || '其他'}</span>
                            <button class="del-btn" onclick="TestQueuePage.removeIssue(${i})">×</button>
                        </div>
                        <div class="issue-title">${issue.title}</div>
                        <div class="issue-desc">${issue.description || ''}</div>
                        <div class="issue-footer">
                            <span>记录时间: ${issue.time || '--'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <!-- 自定义测试项 -->
            <div class="test-group">
                <div class="test-group-header">
                    <h3>📝 自定义测试项</h3>
                    <button class="add-btn" onclick="TestQueuePage.addCustomItem()">+ 添加测试项</button>
                </div>
                ${customItems.length === 0 ? '<div class="empty-hint">可添加模板外的测试项</div>' : ''}
                ${customItems.map((item, i) => `
                    <div class="test-item">
                        <div class="checkbox ${item.result === 'pass' ? 'checked' : ''} ${item.result === 'fail' ? 'failed' : ''}"
                             onclick="TestQueuePage.toggleCustomResult(${i})">
                            ${item.result === 'pass' ? '✓' : item.result === 'fail' ? '✗' : ''}
                        </div>
                        <div class="content">
                            <div class="name">${item.name}</div>
                            <div class="desc">${item.desc || ''}</div>
                        </div>
                        ${item.hasValue ? `
                            <input type="number" class="value-input" placeholder="测量值" 
                                   value="${item.value || ''}"
                                   onchange="TestQueuePage.testResults.customItems[${i}].value = this.value">
                            <span class="unit">${item.unit || ''}</span>
                        ` : ''}
                        <div class="result-btns">
                            <button class="result-btn pass ${item.result === 'pass' ? 'active' : ''}"
                                    onclick="TestQueuePage.setCustomResult(${i}, 'pass')">通过</button>
                            <button class="result-btn fail ${item.result === 'fail' ? 'active' : ''}"
                                    onclick="TestQueuePage.setCustomResult(${i}, 'fail')">不通过</button>
                        </div>
                        <button class="del-btn" onclick="TestQueuePage.removeCustomItem(${i})">×</button>
                    </div>
                `).join('')}
            </div>
        `;
    },
    
    // 添加异常
    addIssue() {
        const title = prompt('异常标题:');
        if (!title) return;
        
        const severity = prompt('严重程度 (critical/major/minor):', 'major') || 'major';
        const category = prompt('分类 (UI/性能/功能/其他):', '其他') || '其他';
        const description = prompt('详细描述:') || '';
        
        this.testResults.issues.push({
            title,
            severity,
            category,
            description,
            time: new Date().toLocaleString()
        });
        this.renderIssues();
    },
    
    removeIssue(index) {
        if (confirm('确定删除此异常记录？')) {
            this.testResults.issues.splice(index, 1);
            this.renderIssues();
        }
    },
    
    // 添加自定义测试项
    addCustomItem() {
        const name = prompt('测试项名称:');
        if (!name) return;
        
        const desc = prompt('测试标准/描述:') || '';
        const hasValue = confirm('是否需要记录数值？');
        let unit = '';
        if (hasValue) {
            unit = prompt('数值单位 (如 mm, mA, s):') || '';
        }
        
        this.testResults.customItems.push({
            name, desc, hasValue, unit, result: null, value: ''
        });
        this.renderIssues();
    },
    
    removeCustomItem(index) {
        if (confirm('确定删除此测试项？')) {
            this.testResults.customItems.splice(index, 1);
            this.renderIssues();
        }
    },
    
    setCustomResult(index, result) {
        this.testResults.customItems[index].result = result;
        this.renderIssues();
    },
    
    toggleCustomResult(index) {
        const item = this.testResults.customItems[index];
        if (item.result === 'pass') item.result = 'fail';
        else if (item.result === 'fail') item.result = null;
        else item.result = 'pass';
        this.renderIssues();
    },
    
    // 渲染测试报告
    renderReport() {
        const container = document.getElementById('test-content');
        if (!container) return;
        
        const t = this.currentTest;
        
        // 统计各分类测试结果
        let total = 0, passed = 0, failed = 0, pending = 0;
        let multiDeviceStats = {};  // 多设备测试统计
        let multiDeviceWarnings = [];  // 多设备测试警告
        
        Object.entries(this.testTemplate).forEach(([catKey, cat]) => {
            if (cat.multiDevice && cat.minDevices) {
                // 多设备测试分类
                const deviceCount = this.testDevices.length;
                const minDevices = cat.minDevices;
                
                if (deviceCount < minDevices) {
                    multiDeviceWarnings.push(`${cat.name}: 需要至少 ${minDevices} 台设备，当前仅 ${deviceCount} 台`);
                }
                
                // 统计每台设备的测试结果
                let catStats = { devices: [], allPassed: true };
                for (let i = 0; i < deviceCount; i++) {
                    const devResults = this.testResults.devices[i] || {};
                    const dev = this.testDevices[i];
                    let devTotal = 0, devPassed = 0, devFailed = 0;
                    
                    cat.groups.forEach(group => {
                        group.items.forEach(item => {
                            devTotal++;
                            const r = devResults[item.key];
                            if (r === 'pass') devPassed++;
                            else if (r === 'fail') devFailed++;
                        });
                    });
                    
                    catStats.devices.push({
                        sn: dev?.sn || `设备${i+1}`,
                        total: devTotal,
                        passed: devPassed,
                        failed: devFailed,
                        pending: devTotal - devPassed - devFailed
                    });
                    
                    if (devFailed > 0) catStats.allPassed = false;
                    
                    // 累加到总计（每台设备的测试项都计入）
                    total += devTotal;
                    passed += devPassed;
                    failed += devFailed;
                    pending += devTotal - devPassed - devFailed;
                }
                
                multiDeviceStats[catKey] = catStats;
            } else {
                // 单设备测试分类
                cat.groups.forEach(group => {
                    group.items.forEach(item => {
                        total++;
                        const r = this.testResults[item.key];
                        if (r === 'pass') passed++;
                        else if (r === 'fail') failed++;
                        else pending++;
                    });
                });
            }
        });
        
        // 自定义测试项统计
        const customItems = this.testResults.customItems || [];
        customItems.forEach(item => {
            total++;
            if (item.result === 'pass') passed++;
            else if (item.result === 'fail') failed++;
            else pending++;
        });
        
        const issues = this.testResults.issues || [];
        const criticalCount = issues.filter(i => i.severity === 'critical').length;
        
        // 生成多设备测试汇总HTML
        let multiDeviceHtml = '';
        if (Object.keys(multiDeviceStats).length > 0) {
            multiDeviceHtml = `
            <div class="report-section">
                <h4>📱 多设备测试汇总</h4>
                ${Object.entries(multiDeviceStats).map(([catKey, stats]) => {
                    const cat = this.testTemplate[catKey];
                    return `
                    <div style="margin-bottom:16px; padding:12px; background:var(--input-bg); border-radius:8px;">
                        <div style="font-weight:600; margin-bottom:10px;">${cat.name} (${stats.devices.length}/${cat.minDevices} 台设备)</div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">
                            ${stats.devices.map(dev => `
                                <div style="padding:10px; background:var(--card-bg); border-radius:6px; border-left:3px solid ${dev.failed > 0 ? '#ef4444' : dev.pending > 0 ? '#f59e0b' : '#22c55e'};">
                                    <div style="font-weight:500; margin-bottom:4px;">${dev.sn}</div>
                                    <div style="font-size:12px; color:var(--text-muted);">
                                        通过: ${dev.passed}/${dev.total} | 
                                        <span style="color:${dev.failed > 0 ? '#ef4444' : 'inherit'}">失败: ${dev.failed}</span> | 
                                        <span style="color:${dev.pending > 0 ? '#f59e0b' : 'inherit'}">待测: ${dev.pending}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
            `;
        }
        
        // 多设备警告HTML
        let warningsHtml = '';
        if (multiDeviceWarnings.length > 0) {
            warningsHtml = `
            <div class="report-section" style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:8px; padding:12px;">
                <h4 style="color:#f59e0b; margin-bottom:8px;">⚠️ 多设备测试警告</h4>
                ${multiDeviceWarnings.map(w => `<div style="font-size:13px; margin-bottom:4px;">• ${w}</div>`).join('')}
            </div>
            `;
        }
        
        container.innerHTML = `
            <div class="report-header">
                <h2>📋 固件测试报告</h2>
                <button class="export-btn" onclick="TestQueuePage.exportReport()">📄 导出报告</button>
            </div>
            
            <div class="report-section">
                <h4>产品信息</h4>
                <div class="report-grid">
                    <div class="report-item"><span class="label">产品名称</span><span>${t?.project?.name || '--'}</span></div>
                    <div class="report-item"><span class="label">软件版本</span><span>v${t?.version || '--'}</span></div>
                    <div class="report-item"><span class="label">Git提交</span><span>${t?.git_commit || t?.gitCommit || '--'}</span></div>
                    <div class="report-item"><span class="label">测试日期</span><span>${new Date().toLocaleDateString()}</span></div>
                </div>
            </div>
            
            ${warningsHtml}
            
            <div class="summary-stats">
                <div class="stat-card">
                    <div class="number">${total}</div>
                    <div class="label">测试项总数</div>
                </div>
                <div class="stat-card pass">
                    <div class="number">${passed}</div>
                    <div class="label">通过</div>
                </div>
                <div class="stat-card fail">
                    <div class="number">${failed}</div>
                    <div class="label">不通过</div>
                </div>
                <div class="stat-card" style="${issues.length > 0 ? 'border:1px solid #f59e0b' : ''}">
                    <div class="number" style="color:${issues.length > 0 ? '#f59e0b' : ''}">${issues.length}</div>
                    <div class="label">异常问题</div>
                </div>
            </div>
            
            ${multiDeviceHtml}
            
            ${issues.length > 0 ? `
            <div class="report-section">
                <h4>⚠️ 异常问题列表</h4>
                ${issues.map(issue => `
                    <div class="issue-card ${issue.severity}" style="margin-bottom:8px">
                        <span class="severity-badge ${issue.severity}">${issue.severity === 'critical' ? '严重' : issue.severity === 'major' ? '主要' : '次要'}</span>
                        <strong>${issue.title}</strong>
                        <span style="color:var(--text-muted); margin-left:10px">${issue.description || ''}</span>
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <div class="report-section">
                <h4>📝 测试结论</h4>
                <textarea style="width:100%; padding:12px; background:var(--input-bg); border:1px solid var(--border-color); border-radius:8px; color:var(--text-color); resize:none;" 
                          rows="4" placeholder="填写测试结论和建议..."
                          onchange="TestQueuePage.testResults.conclusion = this.value">${this.testResults.conclusion || ''}</textarea>
            </div>
            
            <div class="final-actions">
                <button class="final-btn reject" onclick="TestQueuePage.failTest()">
                    ✗ 测试不通过，退回研发
                </button>
                <button class="final-btn approve" onclick="TestQueuePage.passTest()" ${failed > 0 || criticalCount > 0 || multiDeviceWarnings.length > 0 ? 'disabled style="opacity:0.5"' : ''}>
                    ✓ 测试通过${failed > 0 || criticalCount > 0 ? '（存在失败项或严重异常）' : multiDeviceWarnings.length > 0 ? '（多设备测试未完成）' : ''}
                </button>
            </div>
        `;
    },
    
    // ==================== 模板库管理 ====================
    templateCat: 'ui',
    editingTemplate: null,
    editingTemplateId: null,
    templateLibrary: {},  // 模板库 { id: { name, data, desc } }
    currentTemplateId: null,  // 当前使用的模板ID
    
    // 初始化模板库
    async initTemplateLibrary() {
        const saved = localStorage.getItem('testTemplateLibrary');
        if (saved) {
            try {
                this.templateLibrary = JSON.parse(saved);
            } catch(e) { console.error('加载模板库失败', e); }
        }
        // 确保有默认模板
        if (!this.templateLibrary['default']) {
            this.templateLibrary['default'] = {
                name: '激光测距仪标准模板',
                desc: '适用于手持激光测距仪的完整测试流程',
                data: JSON.parse(JSON.stringify(this.defaultTemplate))
            };
            this.saveTemplateLibrary();
        }
        
        // 从 gd303_mini_suite.js 加载GD303 Mini专用模板
        // 优先使用本地JS文件，而不是服务器API
        if (!this.templateLibrary['gd303_mini'] || this._shouldReloadSuite) {
            await this._loadGD303MiniSuite();
        }
    },
    
    // 从 gd303_mini_suite.js 加载测试套件
    async _loadGD303MiniSuite() {
        // 动态加载脚本
        if (!window.GD303MiniTestSuite) {
            try {
                await this._loadScript('/js/test_suites/gd303_mini_suite.js');
                await this._loadScript('/js/ui_test_lib.js');
            } catch (e) {
                console.warn('[UITest] 加载测试套件脚本失败:', e);
                return;
            }
        }
        
        const suite = window.GD303MiniTestSuite;
        if (!suite) {
            console.warn('[UITest] GD303MiniTestSuite 未定义');
            return;
        }
        
        console.log(`[UITest] 加载测试套件: ${suite.name} v${suite.version}`);
        
        // 将 suite.categories 转换为模板库格式
        const groups = this._convertSuiteToGroups(suite);
        
        // 提取自动化脚本
        this.autoScripts = {};
        for (const group of groups) {
            for (const item of group.items) {
                if (item.autoScript) {
                    this.autoScripts[item.key] = item.autoScript;
                }
            }
        }
        
        this.templateLibrary['gd303_mini'] = {
            name: `${suite.name} v${suite.version}`,
            desc: `${suite.device} 测试套件，${groups.length} 个分组`,
            data: {
                ui: {
                    name: 'UI测试',
                    multiDevice: false,
                    minDevices: 1,
                    groups: groups
                },
                perf: this.defaultTemplate.perf,
                func: this.defaultTemplate.func,
                stability: this.defaultTemplate.stability
            }
        };
        
        this.saveTemplateLibrary();
        console.log(`[UITest] GD303 Mini模板已加载: ${groups.length} 个分组, ${Object.keys(this.autoScripts).length} 个自动化脚本`);
    },
    
    // 将 suite.categories 转换为 groups 格式
    _convertSuiteToGroups(suite) {
        const groups = [];
        
        for (const category of suite.categories) {
            for (const testCase of category.cases) {
                // 每个 case 作为一个分组
                const group = {
                    name: `${category.id}. ${category.name} - ${testCase.id} ${testCase.name}`,
                    items: []
                };
                
                // 每个 subcase 作为一个测试项
                for (const subcase of (testCase.subcases || [])) {
                    const item = {
                        key: subcase.id,
                        name: subcase.name,
                        desc: subcase.desc || '',
                        // 将 steps 转换为 autoScript 格式
                        autoScript: this._convertStepsToScript(subcase.steps, subcase.initial)
                    };
                    group.items.push(item);
                }
                
                if (group.items.length > 0) {
                    groups.push(group);
                }
            }
        }
        
        return groups;
    },
    
    // 将 suite 的 steps 格式转换为 autoScript 格式
    _convertStepsToScript(steps, initial) {
        if (!steps || steps.length === 0) return null;
        
        const script = {
            setup: [],
            steps: [],
            expect: {}
        };
        
        // 解析每个步骤
        for (const step of steps) {
            const parsed = this._parseAction(step.action);
            if (parsed) {
                script.steps.push({
                    cmd: parsed.cmd,
                    param: parsed.param,
                    expect: step.expect  // 保留每步的期望值
                });
            }
        }
        
        // 最后一步的期望值作为整体期望
        if (steps.length > 0 && steps[steps.length - 1].expect) {
            script.expect = steps[steps.length - 1].expect;
        }
        
        return script;
    },
    
    // 解析动作字符串
    _parseAction(actionStr) {
        if (window.UITestLib) {
            return UITestLib.parseAction(actionStr);
        }
        
        // 备用解析逻辑
        const actionMap = {
            'K1短按': { cmd: 'key_measure' },
            'K1长按': { cmd: 'key_measure_long' },
            'K2短按': { cmd: 'key_mode' },
            'K2长按': { cmd: 'key_base' },
            'K3短按': { cmd: 'key_clear' },
            'K3长按': { cmd: 'key_backlight' },
            'K3超长按': { cmd: 'key_power_off' },
            '获取状态': { cmd: 'get_status' },
            '重置': { cmd: 'reset' },
        };
        
        // 检查是否有参数
        const match = actionStr.match(/^(.+?)\((.+)\)$/);
        if (match) {
            const name = match[1];
            const paramsStr = match[2];
            
            if (name === '模拟测距成功') {
                const [dist, signal] = paramsStr.split(',').map(s => parseInt(s.trim()));
                return { cmd: 'sim_ok', param: { distance: dist, signal: signal || 3 } };
            }
            if (name === '模拟测距失败') {
                return { cmd: 'sim_err', param: parseInt(paramsStr) };
            }
            if (name === '设置单位') {
                return { cmd: 'set_unit', param: parseInt(paramsStr) };
            }
            if (name === '等待') {
                return { cmd: 'wait', param: parseInt(paramsStr) };
            }
        }
        
        return actionMap[actionStr] || null;
    },
    
    // 动态加载脚本
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            // 检查是否已加载
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },
    
    saveTemplateLibrary() {
        localStorage.setItem('testTemplateLibrary', JSON.stringify(this.templateLibrary));
    },
    
    // 显示模板选择
    async showTemplateSelect() {
        await this.initTemplateLibrary();
        document.getElementById('template-select-dialog').style.display = 'flex';
        this.renderTemplateList();
    },
    
    hideTemplateSelect() {
        document.getElementById('template-select-dialog').style.display = 'none';
    },
    
    renderTemplateList() {
        const container = document.getElementById('template-list');
        if (!container) return;
        
        const templates = Object.entries(this.templateLibrary);
        
        container.innerHTML = templates.map(([id, tpl]) => `
            <div class="template-card ${this.currentTemplateId === id ? 'active' : ''}" onclick="TestQueuePage.selectTemplate('${id}')">
                <div class="icon">📋</div>
                <div class="info">
                    <div class="name">${tpl.name}</div>
                    <div class="desc">${tpl.desc || '无描述'}</div>
                </div>
                <div class="actions">
                    <button class="action-btn" onclick="event.stopPropagation(); TestQueuePage.editTemplate('${id}')" title="编辑">✏️</button>
                    <button class="action-btn" onclick="event.stopPropagation(); TestQueuePage.copyTemplate('${id}')" title="复制">📄</button>
                    ${id !== 'default' ? `<button class="action-btn del" onclick="event.stopPropagation(); TestQueuePage.deleteTemplate('${id}')" title="删除">🗑️</button>` : ''}
                </div>
            </div>
        `).join('');
    },
    
    // 选择模板
    selectTemplate(id) {
        const tpl = this.templateLibrary[id];
        if (!tpl) return;
        
        this.currentTemplateId = id;
        this.testTemplate = JSON.parse(JSON.stringify(tpl.data));
        
        // 如果是GD303 Mini模板，加载自动化脚本
        if (id === 'gd303_mini' && tpl.data?.ui?.groups) {
            this.autoScripts = {};
            tpl.data.ui.groups.forEach(group => {
                group.items.forEach(item => {
                    if (item.autoScript) {
                        this.autoScripts[item.key] = item.autoScript;
                    }
                });
            });
            console.log(`[UITest] 已加载 ${Object.keys(this.autoScripts).length} 个自动化脚本`);
            Utils.toast(`已加载 ${Object.keys(this.autoScripts).length} 个自动化脚本`, 'success');
        } else {
            // 其他模板清空自动化脚本
            this.autoScripts = {};
        }
        
        // 保存产品-模板关联
        const projectId = this.currentTest?.project_id || this.currentTest?.project?.id;
        if (projectId) {
            localStorage.setItem(`productTemplate_${projectId}`, id);
        }
        
        this.hideTemplateSelect();
        this.renderVersionBar();
        this.renderTabContent();
    },
    
    // 编辑模板
    editTemplate(id) {
        this.editingTemplateId = id;
        const tpl = this.templateLibrary[id];
        if (!tpl) return;
        
        this.editingTemplate = JSON.parse(JSON.stringify(tpl.data));
        this.templateCat = 'ui';
        
        document.getElementById('template-name-input').value = tpl.name;
        document.getElementById('template-dialog').style.display = 'flex';
        this.hideTemplateSelect();
        this.renderTemplateContent();
    },
    
    // 复制模板
    copyTemplate(id) {
        const tpl = this.templateLibrary[id];
        if (!tpl) return;
        
        const newName = prompt('新模板名称:', tpl.name + ' - 副本');
        if (!newName) return;
        
        const newId = 'tpl_' + Date.now();
        this.templateLibrary[newId] = {
            name: newName,
            desc: tpl.desc,
            data: JSON.parse(JSON.stringify(tpl.data))
        };
        this.saveTemplateLibrary();
        this.renderTemplateList();
    },
    
    // 删除模板
    deleteTemplate(id) {
        if (confirm('确定删除此模板？')) {
            delete this.templateLibrary[id];
            this.saveTemplateLibrary();
            this.renderTemplateList();
        }
    },
    
    // 新建模板
    createNewTemplate() {
        const name = prompt('模板名称:');
        if (!name) return;
        
        const baseId = prompt('基于哪个模板？(留空使用默认)', '') || 'default';
        const baseTpl = this.templateLibrary[baseId] || this.templateLibrary['default'];
        
        const newId = 'tpl_' + Date.now();
        this.templateLibrary[newId] = {
            name: name,
            desc: '',
            data: JSON.parse(JSON.stringify(baseTpl.data))
        };
        this.saveTemplateLibrary();
        
        // 直接进入编辑
        this.editTemplate(newId);
    },
    
    // 显示模板管理（从标签页按钮）
    showTemplateManager() {
        this.showTemplateSelect();
    },
    
    hideTemplateManager() {
        document.getElementById('template-dialog').style.display = 'none';
    },
    
    switchTemplateCat(cat) {
        this.templateCat = cat;
        document.querySelectorAll('.template-tabs .t-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.cat === cat);
        });
        this.renderTemplateContent();
    },
    
    renderTemplateContent() {
        const container = document.getElementById('template-content');
        if (!container || !this.editingTemplate) return;
        
        const cat = this.editingTemplate[this.templateCat];
        if (!cat) return;
        
        let html = '';
        cat.groups.forEach((group, gi) => {
            html += `
                <div class="template-group">
                    <div class="template-group-header">
                        <input type="text" value="${group.name}" 
                               onchange="TestQueuePage.updateGroupName(${gi}, this.value)">
                        <button class="mini-btn del" onclick="TestQueuePage.deleteGroup(${gi})">×</button>
                    </div>
                    ${group.items.map((item, ii) => `
                        <div class="template-item">
                            <input type="text" value="${item.name}" placeholder="测试项名称"
                                   onchange="TestQueuePage.updateItem(${gi}, ${ii}, 'name', this.value)">
                            <input type="text" class="desc-input" value="${item.desc}" placeholder="测试标准"
                                   onchange="TestQueuePage.updateItem(${gi}, ${ii}, 'desc', this.value)">
                            <label style="font-size:11px; color:var(--text-muted)">
                                <input type="checkbox" ${item.hasValue ? 'checked' : ''}
                                       onchange="TestQueuePage.updateItem(${gi}, ${ii}, 'hasValue', this.checked)"> 数值
                            </label>
                            ${item.hasValue ? `
                                <input type="text" style="width:50px" value="${item.unit || ''}" placeholder="单位"
                                       onchange="TestQueuePage.updateItem(${gi}, ${ii}, 'unit', this.value)">
                            ` : ''}
                            <button class="mini-btn del" onclick="TestQueuePage.deleteItem(${gi}, ${ii})">×</button>
                        </div>
                    `).join('')}
                    <button class="add-item-btn" onclick="TestQueuePage.addItem(${gi})">+ 添加测试项</button>
                </div>
            `;
        });
        html += `<button class="add-group-btn" onclick="TestQueuePage.addGroup()">+ 添加测试分组</button>`;
        container.innerHTML = html;
    },
    
    updateGroupName(gi, value) {
        this.editingTemplate[this.templateCat].groups[gi].name = value;
    },
    
    updateItem(gi, ii, field, value) {
        const item = this.editingTemplate[this.templateCat].groups[gi].items[ii];
        item[field] = value;
        if (field === 'hasValue') this.renderTemplateContent();
    },
    
    deleteGroup(gi) {
        if (confirm('确定删除此分组及所有测试项？')) {
            this.editingTemplate[this.templateCat].groups.splice(gi, 1);
            this.renderTemplateContent();
        }
    },
    
    deleteItem(gi, ii) {
        this.editingTemplate[this.templateCat].groups[gi].items.splice(ii, 1);
        this.renderTemplateContent();
    },
    
    addGroup() {
        this.editingTemplate[this.templateCat].groups.push({
            name: '新分组',
            items: []
        });
        this.renderTemplateContent();
    },
    
    addItem(gi) {
        const key = 'custom_' + Date.now();
        this.editingTemplate[this.templateCat].groups[gi].items.push({
            key, name: '新测试项', desc: '测试标准', hasValue: false
        });
        this.renderTemplateContent();
    },
    
    saveTemplate() {
        const id = this.editingTemplateId;
        const name = document.getElementById('template-name-input').value || '未命名模板';
        
        this.templateLibrary[id] = {
            name: name,
            desc: this.templateLibrary[id]?.desc || '',
            data: this.editingTemplate
        };
        this.saveTemplateLibrary();
        
        // 如果是当前使用的模板，同步更新
        if (this.currentTemplateId === id) {
            this.testTemplate = JSON.parse(JSON.stringify(this.editingTemplate));
        }
        
        this.hideTemplateManager();
        this.renderTabContent();
        alert('模板已保存！');
    },
    
    // ==================== 测试项详情 ====================
    currentItemKey: null,
    
    showItemDetail(key) {
        this.currentItemKey = key;
        
        // 查找测试项信息
        let itemInfo = null;
        Object.values(this.testTemplate).forEach(cat => {
            cat.groups.forEach(group => {
                group.items.forEach(item => {
                    if (item.key === key) itemInfo = item;
                });
            });
        });
        
        if (!itemInfo) return;
        
        // 获取已记录的详情
        const detail = this.testResults[key + '_detail'] || {};
        
        // 获取 autoScript
        const autoScript = this.autoScripts ? this.autoScripts[key] : null;
        
        // 格式化 autoScript 显示
        const formatAutoScript = (script) => {
            if (!script) return '';
            
            const formatCmd = (step) => {
                let cmd = step.cmd || step.command || '?';
                if (step.param !== undefined) {
                    if (typeof step.param === 'object') {
                        cmd += `(${JSON.stringify(step.param)})`;
                    } else {
                        cmd += `(${step.param})`;
                    }
                }
                return cmd;
            };
            
            let html = '<div class="auto-script-preview" style="background:var(--card-bg);padding:12px;border-radius:8px;font-family:monospace;font-size:12px;line-height:1.6;">';
            
            // Setup
            if (script.setup && script.setup.length > 0) {
                html += '<div style="margin-bottom:8px;color:var(--text-secondary);"><b>📋 Setup:</b></div>';
                html += '<div style="margin-left:16px;margin-bottom:12px;">';
                script.setup.forEach((s, i) => {
                    html += `<span style="background:var(--primary-color);color:white;padding:2px 8px;border-radius:4px;margin-right:4px;">${formatCmd(s)}</span>`;
                    if (i < script.setup.length - 1) html += ' → ';
                });
                html += '</div>';
            }
            
            // Steps
            if (script.steps && script.steps.length > 0) {
                html += '<div style="margin-bottom:8px;color:var(--text-secondary);"><b>▶️ Steps:</b></div>';
                html += '<div style="margin-left:16px;margin-bottom:12px;">';
                script.steps.forEach((s, i) => {
                    html += `<div style="margin-bottom:4px;"><span style="color:var(--primary-color);font-weight:bold;">${i+1}.</span> <span style="background:var(--success-color);color:white;padding:2px 8px;border-radius:4px;">${formatCmd(s)}</span></div>`;
                });
                html += '</div>';
            }
            
            // Expect
            if (script.expect && Object.keys(script.expect).length > 0) {
                html += '<div style="margin-bottom:8px;color:var(--text-secondary);"><b>✅ Expect:</b></div>';
                html += '<div style="margin-left:16px;">';
                Object.entries(script.expect).forEach(([k, v]) => {
                    html += `<div style="margin-bottom:2px;"><span style="color:var(--warning-color);">${k}</span>: <span style="color:var(--text-primary);font-weight:bold;">${v}</span></div>`;
                });
                html += '</div>';
            }
            
            html += '</div>';
            return html;
        };
        
        document.getElementById('detail-title').textContent = itemInfo.name;
        document.getElementById('detail-body').innerHTML = `
            <div class="detail-form" style="display:grid;grid-template-columns:1fr 360px;gap:16px;">
                <!-- 左侧：测试配置 -->
                <div>
                    <div class="detail-row">
                        <label>测试标准</label>
                        <input type="text" id="detail-standard" value="${itemInfo.desc}" readonly 
                               style="background:var(--card-bg)">
                    </div>
                    
                    <!-- 自动化脚本区域 -->
                    <div class="detail-row">
                        <label style="display:flex;align-items:center;gap:8px;">
                            🤖 自动化脚本
                            ${autoScript ? '<span style="color:var(--success-color);font-size:12px;">已配置</span>' : '<span style="color:var(--text-muted);font-size:12px;">未配置</span>'}
                        </label>
                        <div id="auto-script-container">
                            ${autoScript ? formatAutoScript(autoScript) : '<div style="color:var(--text-muted);padding:12px;text-align:center;background:var(--card-bg);border-radius:8px;">暂无自动化脚本</div>'}
                        </div>
                        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                            ${autoScript ? `
                                <button onclick="TestQueuePage.runAutoScript('${key}')" class="cyber-btn sm primary">▶ 执行测试</button>
                                <button onclick="TestQueuePage.editAutoScript('${key}')" class="cyber-btn sm" id="btn-edit-script">✏️ 编辑脚本</button>
                                <button onclick="TestQueuePage.deleteAutoScript('${key}')" class="cyber-btn sm" style="color:var(--error-color);">🗑️ 删除</button>
                            ` : `
                                <button onclick="TestQueuePage.createAutoScript('${key}')" class="cyber-btn sm primary">➕ 创建脚本</button>
                            `}
                        </div>
                    </div>
                    
                    <div class="detail-row">
                        <label>测试结果</label>
                        <select id="detail-result">
                            <option value="">未测试</option>
                            <option value="pass" ${this.testResults[key] === 'pass' ? 'selected' : ''}>✓ 通过</option>
                            <option value="fail" ${this.testResults[key] === 'fail' ? 'selected' : ''}>✗ 不通过</option>
                        </select>
                    </div>
                    
                    ${itemInfo.hasValue ? `
                    <div class="detail-row">
                        <label>测量数值 (${itemInfo.unit || ''})</label>
                        <input type="number" id="detail-value" value="${this.testResults[key + '_value'] || ''}" 
                               step="any" placeholder="输入测量值">
                    </div>
                    ` : ''}
                    
                    <div class="detail-row">
                        <label>详细备注</label>
                        <textarea id="detail-note" rows="2" placeholder="记录详细测试过程和发现...">${detail.note || ''}</textarea>
                    </div>
                </div>
                
                <!-- 右侧：LCD仿真器 -->
                <div style="background:var(--card-bg);border-radius:8px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <label style="font-weight:bold;">📺 LCD仿真</label>
                        <div style="display:flex;gap:4px;">
                            <button onclick="TestQueuePage.refreshLCD()" class="cyber-btn sm" title="刷新LCD">🔄</button>
                            <button onclick="TestQueuePage.screenshotLCD()" class="cyber-btn sm" title="截屏">📷</button>
                        </div>
                    </div>
                    <canvas id="detail-lcd-canvas" width="340" height="190" style="border:1px solid var(--border-color);border-radius:4px;background:#0c1821;"></canvas>
                    <div id="detail-lcd-status" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>
                </div>
            </div>
        `;
        
        document.getElementById('item-detail-dialog').style.display = 'flex';
        
        // 初始化 LCD 仿真器
        this.initDetailLCD();
    },
    
    // 初始化详情对话框中的 LCD 仿真器
    async initDetailLCD() {
        const canvas = document.getElementById('detail-lcd-canvas');
        if (!canvas) return;
        
        // 确保 LCDSimulator 已加载
        if (!window.LCDSimulator) {
            await this.loadLCDSimulator();
        }
        
        // 创建一个临时的 LCD 仿真器实例
        if (!this._detailLCD) {
            this._detailLCD = {
                canvas: null,
                ctx: null,
                width: 340,
                height: 190,
                colors: {
                    bg: '#0c1821',
                    segOn: '#00e676',
                    segOff: '#0d2818',
                },
                DIGITS: {
                    '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66,
                    '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
                    '-': 0x40, ' ': 0x00, 'E': 0x79, 'r': 0x50, 'o': 0x5C,
                },
                state: {
                    battery: 3, signal: 3, beep: true, laser: false,
                    mode: 0, base: 1, unit: 0,
                    line1: '', line2: '', line3: '', line4: '-----',
                },
            };
        }
        
        // 初始化 canvas
        this._detailLCD.canvas = canvas;
        this._detailLCD.ctx = canvas.getContext('2d');
        
        // 渲染初始状态
        if (window.LCDSimulator && typeof window.LCDSimulator.render === 'function') {
            window.LCDSimulator.render.call(this._detailLCD);
        }
    },
    
    // 动态加载 LCD 仿真器脚本
    loadLCDSimulator() {
        return new Promise((resolve, reject) => {
            if (window.LCDSimulator) {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = '/js/lcd_simulator.js';
            script.onload = () => {
                console.log('[TestQueue] LCDSimulator 加载完成');
                resolve();
            };
            script.onerror = () => {
                console.error('[TestQueue] LCDSimulator 加载失败');
                reject(new Error('加载 lcd_simulator.js 失败'));
            };
            document.head.appendChild(script);
        });
    },
    
    // 刷新 LCD - 从设备读取状态
    async refreshLCD() {
        const statusEl = document.getElementById('detail-lcd-status');
        if (statusEl) statusEl.textContent = '正在获取状态...';
        
        try {
            const status = await this.getUIStatus();
            if (status && this._detailLCD) {
                // 更新状态
                if (status.battery !== undefined) this._detailLCD.state.battery = status.battery;
                if (status.signal !== undefined) this._detailLCD.state.signal = status.signal;
                if (status.beep !== undefined) this._detailLCD.state.beep = !!status.beep;
                if (status.laser !== undefined) this._detailLCD.state.laser = status.laser === 'ON' || status.laser === true;
                if (status.mode !== undefined) this._detailLCD.state.mode = typeof status.mode === 'string' ? this.modeToNum(status.mode) : status.mode;
                if (status.base !== undefined) this._detailLCD.state.base = typeof status.base === 'string' ? (status.base === 'BACK' ? 1 : 0) : status.base;
                if (status.unit !== undefined) this._detailLCD.state.unit = typeof status.unit === 'string' ? this.unitToNum(status.unit) : status.unit;
                
                // 格式化数值
                const fmt = (v, isLine4) => {
                    if (v === undefined || v === null) return '';
                    if (v < 0) return '';
                    if (v === 0 && !isLine4) return '';
                    return v.toFixed(3);
                };
                if (status.line1 !== undefined) this._detailLCD.state.line1 = fmt(status.line1, false);
                if (status.line2 !== undefined) this._detailLCD.state.line2 = fmt(status.line2, false);
                if (status.line3 !== undefined) this._detailLCD.state.line3 = fmt(status.line3, false);
                if (status.line4 !== undefined) this._detailLCD.state.line4 = fmt(status.line4, true);
                
                // 渲染
                if (window.LCDSimulator && typeof window.LCDSimulator.render === 'function') {
                    window.LCDSimulator.render.call(this._detailLCD);
                }
                
                if (statusEl) statusEl.textContent = `状态: ${status.state || 'IDLE'} | 模式: ${status.mode || 'SINGLE'} | 基准: ${status.base || 'BACK'}`;
            } else {
                if (statusEl) statusEl.textContent = '获取状态失败';
            }
        } catch (err) {
            console.error('刷新LCD失败:', err);
            if (statusEl) statusEl.textContent = '错误: ' + err.message;
        }
    },
    
    // 模式字符串转数字
    modeToNum(mode) {
        const map = { 'SINGLE': 0, 'AREA': 1, 'VOLUME': 2, 'PYTH1': 3, 'PYTH2': 4, 'PYTH3': 5, 'CONTINUOUS': 6 };
        return map[mode] ?? 0;
    },
    
    // 单位字符串转数字
    unitToNum(unit) {
        const map = { 'm': 0, 'ft': 1, 'in': 2 };
        return map[unit] ?? 0;
    },
    
    // LCD 截屏
    screenshotLCD() {
        const canvas = document.getElementById('detail-lcd-canvas');
        if (!canvas) {
            alert('LCD仿真器未初始化');
            return;
        }
        
        const dataUrl = canvas.toDataURL('image/png');
        const filename = 'lcd_screenshot_' + Date.now() + '.png';
        
        // 创建下载链接
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
        
        Utils.toast(`截屏已保存: ${filename}`, 'success');
    },
    
    // 执行单个测试项的自动化脚本
    async runAutoScript(key) {
        const autoScript = this.autoScripts ? this.autoScripts[key] : null;
        if (!autoScript) {
            alert('该测试项没有自动化脚本');
            return;
        }
        
        // 检查串口连接
        if (!window.DeviceHub || !window.DeviceHub.isSerialConnected()) {
            alert('请先连接串口设备');
            return;
        }
        
        try {
            // 执行 setup
            if (autoScript.setup && autoScript.setup.length > 0) {
                for (const step of autoScript.setup) {
                    await this.executeAutoStep(step);
                    await this.sleep(100);
                }
            }
            
            // 执行 steps
            if (autoScript.steps && autoScript.steps.length > 0) {
                for (const step of autoScript.steps) {
                    await this.executeAutoStep(step);
                    await this.sleep(300);
                }
            }
            
            // 等待一下再获取状态
            await this.sleep(500);
            
            // 获取UI状态验证
            const status = await this.getUIStatus();
            
            // 验证期望值
            if (autoScript.expect && status) {
                const result = this.verifyExpect(autoScript.expect, status);
                this.testResults[key] = result.pass ? 'pass' : 'fail';
                
                // 更新下拉框
                const resultEl = document.getElementById('detail-result');
                if (resultEl) {
                    resultEl.value = result.pass ? 'pass' : 'fail';
                }
                
                alert(result.pass ? '✓ 测试通过！' : `✗ 测试失败: ${result.message}`);
            } else {
                alert('自动化脚本执行完成，请手动验证结果');
            }
            
        } catch (err) {
            console.error('自动化脚本执行失败:', err);
            alert('执行失败: ' + err.message);
        }
    },
    
    // 执行单个自动化步骤
    async executeAutoStep(step) {
        const cmd = step.cmd || step.command;
        const param = step.param;
        
        // ========== 前端控制命令 ==========
        
        // 延时命令 - 纯前端处理
        if (cmd === 'delay') {
            await this.sleep(param || 500);
            return { success: true, cmd: 'delay', ms: param || 500 };
        }
        
        // 串口连接
        if (cmd === 'serial_connect') {
            try {
                const port = param || 'COM108';
                if (window.DeviceHub) {
                    const result = await window.DeviceHub.connect(port, 115200);
                    return { success: result, cmd: 'serial_connect', port };
                }
                return { success: false, cmd: 'serial_connect', error: 'DeviceHub不可用' };
            } catch (err) {
                return { success: false, cmd: 'serial_connect', error: err.message };
            }
        }
        
        // 串口断开
        if (cmd === 'serial_disconnect') {
            try {
                if (window.DeviceHub) {
                    await window.DeviceHub.disconnect();
                    return { success: true, cmd: 'serial_disconnect' };
                }
                return { success: false, cmd: 'serial_disconnect', error: 'DeviceHub不可用' };
            } catch (err) {
                return { success: false, cmd: 'serial_disconnect', error: err.message };
            }
        }
        
        // LCD仿真更新 - 从设备读取状态并更新LCD仿真器
        if (cmd === 'lcd_update') {
            try {
                // 先获取UI状态
                const status = await this.getUIStatus();
                if (status && window.LCDSimulator) {
                    window.LCDSimulator.updateFromFirmware(status);
                    return { success: true, cmd: 'lcd_update', state: status };
                }
                return { success: false, cmd: 'lcd_update', error: '获取状态失败或LCD仿真器不可用' };
            } catch (err) {
                return { success: false, cmd: 'lcd_update', error: err.message };
            }
        }
        
        // LCD截屏保存
        if (cmd === 'lcd_screenshot') {
            try {
                if (window.LCDSimulator && window.LCDSimulator.isInitialized()) {
                    const dataUrl = window.LCDSimulator.toDataURL();
                    const filename = (param || 'screenshot') + '_' + Date.now() + '.png';
                    
                    // 创建下载链接
                    const link = document.createElement('a');
                    link.download = filename;
                    link.href = dataUrl;
                    link.click();
                    
                    return { success: true, cmd: 'lcd_screenshot', filename };
                }
                return { success: false, cmd: 'lcd_screenshot', error: 'LCD仿真器未初始化' };
            } catch (err) {
                return { success: false, cmd: 'lcd_screenshot', error: err.message };
            }
        }
        
        // 获取UI状态
        if (cmd === 'get_status') {
            const status = await this.getUIStatus();
            return { success: !!status, cmd: 'get_status', state: status };
        }
        
        // ========== 设备命令 ==========
        
        // 命令别名映射
        const cmdMap = {
            'key_measure': 'ui_k1_short',
            'key_measure_long': 'ui_k1_long',
            'key_mode': 'ui_k2_short',
            'key_base': 'ui_k2_long',
            'key_clear': 'ui_k3_short',
            'key_backlight': 'ui_k3_long',
            'key_power_off': 'ui_k3_3s',
            'sim_ok': 'ui_sim_measure_ok',
            'sim_err': 'ui_sim_measure_err',
            'set_unit': 'ui_set_unit',
        };
        
        const protocolId = cmdMap[cmd] || cmd;
        
        // 使用后端 API 发送命令并等待响应
        try {
            const api = window.pywebview?.api || {
                ui_test_send_cmd: async (cmdId, params) => {
                    const response = await fetch('http://127.0.0.1:8766/api/call', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            method: 'ui_test_send_cmd',
                            params: [cmdId, params]
                        })
                    });
                    return await response.json();
                }
            };
            
            const result = await api.ui_test_send_cmd(protocolId, param);
            console.log(`[AutoTest] ${cmd} -> ${protocolId}:`, result);
            
            // 解析响应判断成功
            if (result.success === false) {
                return { success: false, cmd, error: result.error || '发送失败' };
            }
            
            // 解析文本响应中的 error 字段
            const responseText = result.response_text || '';
            const errorMatch = responseText.match(/error:\s*(\d+)/i);
            const errorCode = errorMatch ? parseInt(errorMatch[1]) : 0;
            
            // 解析状态并自动更新LCD仿真器
            const state = this.parseResponseState(responseText);
            if (state && window.LCDSimulator) {
                window.LCDSimulator.updateFromFirmware(state);
            }
            
            return {
                success: errorCode === 0,
                cmd,
                errorCode,
                response: responseText,
                state
            };
        } catch (err) {
            console.error(`[AutoTest] ${cmd} 执行失败:`, err);
            return { success: false, cmd, error: err.message };
        }
    },
    
    // 解析响应中的状态信息
    parseResponseState(text) {
        if (!text) return null;
        
        const state = {};
        const patterns = {
            state: /state:\s*(\w+)/i,
            mode: /mode:\s*(\w+)/i,
            base: /base:\s*(\w+)/i,
            unit: /unit:\s*(\w+)/i,
            laser: /laser:\s*(\w+)/i,
            runstep: /runstep:\s*(\d+)/i,
            line1: /line1:\s*([\d.-]+)/i,
            line2: /line2:\s*([\d.-]+)/i,
            line3: /line3:\s*([\d.-]+)/i,
            line4: /line4:\s*([\d.-]+)/i,
            error: /error:\s*(\d+)/i
        };
        
        for (const [key, pattern] of Object.entries(patterns)) {
            const match = text.match(pattern);
            if (match) {
                const value = match[1];
                // 转换数值
                if (['runstep', 'error'].includes(key)) {
                    state[key] = parseInt(value);
                } else if (['line1', 'line2', 'line3', 'line4'].includes(key)) {
                    state[key] = parseFloat(value);
                } else {
                    state[key] = value;
                }
            }
        }
        
        return Object.keys(state).length > 0 ? state : null;
    },
    
    // 获取UI状态 - 使用后端 API
    async getUIStatus() {
        try {
            const api = window.pywebview?.api || {
                ui_test_get_status: async () => {
                    const response = await fetch('http://127.0.0.1:8766/api/call', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            method: 'ui_test_get_status',
                            params: []
                        })
                    });
                    return await response.json();
                }
            };
            
            const result = await api.ui_test_get_status();
            console.log('[AutoTest] UI状态:', result);
            
            // 解析响应
            if (result.response_text) {
                return this.parseResponseState(result.response_text);
            }
            return result;
        } catch (err) {
            console.error('获取UI状态失败:', err);
        }
        return null;
    },
    
    // 验证期望值
    verifyExpect(expect, status) {
        const tolerance = expect.tolerance || 0.01;
        
        for (const [key, expectedValue] of Object.entries(expect)) {
            if (key === 'tolerance') continue;
            
            const actualValue = status[key];
            if (actualValue === undefined) {
                return { pass: false, message: `缺少字段: ${key}` };
            }
            
            if (typeof expectedValue === 'number') {
                if (Math.abs(actualValue - expectedValue) > tolerance) {
                    return { pass: false, message: `${key}: 期望 ${expectedValue}, 实际 ${actualValue}` };
                }
            } else if (actualValue !== expectedValue) {
                return { pass: false, message: `${key}: 期望 ${expectedValue}, 实际 ${actualValue}` };
            }
        }
        
        return { pass: true, message: '所有验证通过' };
    },
    
    // 辅助函数
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    
    // ==================== 自动化脚本编辑 ====================
    editingAutoScript: null,
    
    // 格式化步骤命令显示
    formatStepCmd(step) {
        const cmd = step.cmd || step.command || '?';
        const cmdLabels = {
            // 按键操作
            'key_measure': 'K1短按',
            'key_measure_long': 'K1长按',
            'key_mode': 'K2短按',
            'key_base': 'K2长按',
            'key_clear': 'K3短按',
            'key_backlight': 'K3长按',
            'key_power_off': 'K3关机',
            // 模拟命令
            'sim_ok': '模拟成功',
            'sim_err': '模拟失败',
            'set_unit': '设置单位',
            // 设备操作
            'serial_connect': '连接串口',
            'serial_disconnect': '断开串口',
            // LCD操作
            'lcd_update': 'LCD更新',
            'lcd_screenshot': 'LCD截屏',
            // 控制
            'delay': '延时',
            'get_status': '获取状态'
        };
        let label = cmdLabels[cmd] || cmd;
        
        if (step.param !== undefined) {
            if (typeof step.param === 'object') {
                const parts = [];
                if (step.param.distance !== undefined) parts.push(`${step.param.distance}mm`);
                if (step.param.signal !== undefined) parts.push(`sig=${step.param.signal}`);
                if (parts.length > 0) label += `(${parts.join(',')})`;
            } else {
                if (cmd === 'set_unit') {
                    const units = ['m', 'ft', 'in'];
                    label += `(${units[step.param] || step.param})`;
                } else if (cmd === 'delay') {
                    label += `(${step.param}ms)`;
                } else if (cmd === 'serial_connect') {
                    label += `(${step.param})`;
                } else if (cmd === 'lcd_screenshot') {
                    label += `(${step.param})`;
                } else {
                    label += `(${step.param})`;
                }
            }
        }
        return label;
    },
    
    // 创建新脚本
    createAutoScript(key) {
        this.editingAutoScript = { setup: [], steps: [], expect: {} };
        this.showScriptEditor(key);
    },
    
    // 编辑脚本
    editAutoScript(key) {
        console.log('[TestQueue] editAutoScript called, key:', key);
        const script = this.autoScripts ? this.autoScripts[key] : null;
        console.log('[TestQueue] script:', script);
        this.editingAutoScript = script ? JSON.parse(JSON.stringify(script)) : { setup: [], steps: [], expect: {} };
        console.log('[TestQueue] editingAutoScript:', this.editingAutoScript);
        this.showScriptEditor(key);
    },
    
    // 删除脚本
    deleteAutoScript(key) {
        if (!confirm('确定删除此自动化脚本？')) return;
        if (this.autoScripts) delete this.autoScripts[key];
        this.saveAutoScriptsToTemplate();
        this.showItemDetail(key);
        Utils.toast('脚本已删除', 'success');
    },
    
    // 显示脚本编辑器 - 每步都有期望值验证
    showScriptEditor(key) {
        console.log('[TestQueue] showScriptEditor called, key:', key);
        const container = document.getElementById('auto-script-container');
        if (!container) {
            console.error('[TestQueue] auto-script-container not found!');
            return;
        }
        
        // 转换旧格式到新格式
        this._convertOldScriptFormat();
        const s = this.editingAutoScript || { steps: [] };
        console.log('[TestQueue] rendering script:', s);
        
        // 保存当前编辑的key
        this._editingKey = key;
        
        // 获取模板列表
        const templates = window.UITestLib ? window.UITestLib.getTemplateList() : [];
        
        let html = `
        <div class="script-editor-v2" style="background:var(--card-bg);border-radius:8px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-weight:bold;color:var(--text-color);">📝 测试步骤编辑器</span>
                <div style="display:flex;gap:6px;">
                    <select id="template-select" style="padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--input-bg);color:var(--text-color);font-size:11px;">
                        <option value="">📋 插入模板...</option>
                        ${templates.map(t => `<option value="${t.name}">${t.name} (${t.stepCount}步)</option>`).join('')}
                    </select>
                    <button class="cyber-btn sm primary" onclick="TestQueuePage.addTestStepV2()">➕ 添加步骤</button>
                </div>
            </div>
            
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;padding:6px;background:rgba(0,0,0,0.2);border-radius:4px;">
                💡 输入动作/期望时按 <kbd style="background:var(--card-bg);padding:1px 4px;border-radius:2px;">Tab</kbd> 显示补全列表，按 <kbd style="background:var(--card-bg);padding:1px 4px;border-radius:2px;">Enter</kbd> 确认
            </div>
            
            <div id="test-steps-container-v2" style="max-height:400px;overflow-y:auto;">
                ${this.renderTestStepsV2(s.steps || [])}
            </div>
            
            <div style="display:flex;gap:8px;justify-content:space-between;padding-top:10px;margin-top:10px;border-top:1px solid var(--border-color);">
                <button class="cyber-btn sm" onclick="TestQueuePage.deleteAutoScript('${key}')" style="color:var(--error-color);">🗑️ 删除脚本</button>
                <div style="display:flex;gap:8px;">
                    <button class="cyber-btn sm" onclick="TestQueuePage.cancelScriptEdit('${key}')">取消</button>
                    <button class="cyber-btn sm primary" onclick="TestQueuePage.saveScript('${key}')">💾 保存</button>
                </div>
            </div>
        </div>
        
        <!-- 补全下拉框 -->
        <div id="autocomplete-dropdown" style="display:none;position:fixed;background:var(--card-bg);border:1px solid var(--border-color);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);max-height:200px;overflow-y:auto;z-index:1000;min-width:200px;"></div>
        `;
        
        container.innerHTML = html;
        
        // 绑定模板选择事件
        const templateSelect = document.getElementById('template-select');
        if (templateSelect) {
            templateSelect.onchange = () => {
                const tplName = templateSelect.value;
                if (tplName) {
                    this.insertTemplateV2(tplName);
                    templateSelect.value = '';
                }
            };
        }
        
        // 隐藏原来的按钮区域
        const btnArea = container.nextElementSibling;
        if (btnArea) btnArea.style.display = 'none';
    },
    
    // 渲染测试步骤V2 - 使用文本输入+Tab补全
    renderTestStepsV2(steps) {
        if (!steps || steps.length === 0) {
            return `<div style="padding:16px;text-align:center;color:var(--text-muted);">
                <div style="font-size:20px;margin-bottom:6px;">📋</div>
                <div style="font-size:12px;">暂无步骤，点击上方按钮添加或选择模板</div>
            </div>`;
        }
        
        return steps.map((step, i) => {
            const actionText = this._actionToText(step);
            const expectTexts = this._expectsToTexts(step.expect || {});
            
            return `
            <div class="test-step-v2" draggable="true" data-index="${i}"
                style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:6px;background:rgba(0,0,0,0.15);"
                ondragstart="TestQueuePage.onStepDrag(event,${i},'start')"
                ondragover="TestQueuePage.onStepDrag(event,${i},'over')"
                ondrop="TestQueuePage.onStepDrag(event,${i},'drop')"
                ondragend="TestQueuePage.onStepDrag(event,${i},'end')">
                
                <!-- 动作行 -->
                <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,0,0,0.15);border-radius:6px 6px 0 0;">
                    <span style="cursor:grab;color:var(--text-muted);" title="拖拽排序">⋮⋮</span>
                    <span style="background:var(--primary-color);color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;">${i+1}</span>
                    
                    <input type="text" class="action-input" data-step="${i}" 
                        style="flex:1;padding:5px 8px;border:1px solid var(--border-color);border-radius:4px;background:var(--input-bg);color:var(--text-color);font-size:12px;"
                        value="${this._escapeHtml(actionText)}"
                        placeholder="输入动作，按Tab补全..."
                        onkeydown="TestQueuePage.onInputKeydown(event, ${i}, 'action')"
                        onfocus="TestQueuePage.onInputFocus(event, ${i}, 'action')"
                        onblur="TestQueuePage.onInputBlur(event, ${i}, 'action')">
                    
                    <button class="cyber-btn sm" onclick="TestQueuePage.insertTestStep(${i})" title="在后面插入" style="padding:3px 6px;">➕</button>
                    <button class="cyber-btn sm" onclick="TestQueuePage.removeTestStep(${i})" title="删除" style="padding:3px 6px;color:var(--error-color);">🗑️</button>
                </div>
                
                <!-- 期望值行 -->
                <div style="padding:6px 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:10px;color:var(--text-muted);">期望:</span>
                    <div class="expect-tags" data-step="${i}" style="display:flex;flex-wrap:wrap;gap:4px;">
                        ${expectTexts.map((txt, ei) => `
                            <span class="expect-tag" style="display:inline-flex;align-items:center;gap:2px;background:var(--card-bg);padding:2px 6px;border-radius:3px;font-size:10px;color:var(--primary-color);">
                                ${this._escapeHtml(txt)}
                                <span onclick="TestQueuePage.removeExpectTag(${i},${ei})" style="cursor:pointer;color:var(--error-color);margin-left:2px;">×</span>
                            </span>
                        `).join('')}
                    </div>
                    <input type="text" class="expect-input" data-step="${i}"
                        style="width:100px;padding:2px 6px;border:1px dashed var(--border-color);border-radius:3px;background:transparent;color:var(--text-color);font-size:10px;"
                        placeholder="+ 添加期望"
                        onkeydown="TestQueuePage.onInputKeydown(event, ${i}, 'expect')"
                        onfocus="TestQueuePage.onInputFocus(event, ${i}, 'expect')"
                        onblur="TestQueuePage.onInputBlur(event, ${i}, 'expect')">
                </div>
            </div>`;
        }).join('');
    },
    
    // 动作转文本
    _actionToText(step) {
        if (!step || !step.cmd) return '';
        const lib = window.UITestLib;
        if (!lib) return step.cmd;
        
        // 反向查找动作名
        for (const [name, def] of Object.entries(lib.actions)) {
            if (def.cmd === step.cmd) {
                if (def.params && step.param) {
                    const paramVals = def.params.map(p => step.param[p.key] ?? p.default);
                    return `${name}(${paramVals.join(',')})`;
                }
                if (step.param !== undefined && step.param !== null) {
                    return `${name}(${step.param})`;
                }
                return name;
            }
        }
        return step.cmd;
    },
    
    // 期望转文本数组
    _expectsToTexts(expects) {
        if (!expects) return [];
        const lib = window.UITestLib;
        const texts = [];
        
        for (const [key, value] of Object.entries(expects)) {
            if (!lib) {
                texts.push(`${key}=${value}`);
                continue;
            }
            // 反向查找期望名
            let found = false;
            for (const [name, def] of Object.entries(lib.expects)) {
                if (def.field === key) {
                    if (def.params) {
                        texts.push(`${name}(${value})`);
                    } else if (def.value === value) {
                        texts.push(name);
                    } else {
                        texts.push(`${name}=${value}`);
                    }
                    found = true;
                    break;
                }
            }
            if (!found) texts.push(`${key}=${value}`);
        }
        return texts;
    },
    
    // HTML转义
    _escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },
    
    // 输入框键盘事件
    onInputKeydown(e, stepIndex, type) {
        if (e.key === 'Tab') {
            e.preventDefault();
            this.showAutocomplete(e.target, stepIndex, type);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.confirmInput(e.target, stepIndex, type);
        } else if (e.key === 'Escape') {
            this.hideAutocomplete();
        }
    },
    
    // 输入框获得焦点
    onInputFocus(e, stepIndex, type) {
        // 可选：自动显示补全
    },
    
    // 输入框失去焦点
    onInputBlur(e, stepIndex, type) {
        // 延迟隐藏，允许点击下拉项
        setTimeout(() => this.hideAutocomplete(), 200);
        // 保存当前输入
        if (type === 'action') {
            this.confirmInput(e.target, stepIndex, type);
        }
    },
    
    // 显示补全下拉
    showAutocomplete(input, stepIndex, type) {
        const lib = window.UITestLib;
        if (!lib) return;
        
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (!dropdown) return;
        
        const rect = input.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 2) + 'px';
        dropdown.style.minWidth = rect.width + 'px';
        
        const filter = input.value.toLowerCase();
        let html = '';
        
        if (type === 'action') {
            const categories = lib.getActionList();
            for (const [cat, items] of Object.entries(categories)) {
                html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.2);">${cat}</div>`;
                for (const item of items) {
                    if (!filter || item.name.toLowerCase().includes(filter) || item.desc.toLowerCase().includes(filter)) {
                        html += `<div class="autocomplete-item" style="padding:6px 10px;cursor:pointer;font-size:11px;" 
                            onmousedown="TestQueuePage.selectAutocomplete('${this._escapeHtml(item.example || item.name)}', ${stepIndex}, 'action')">
                            <span style="color:var(--primary-color);">${this._escapeHtml(item.name)}</span>
                            <span style="color:var(--text-muted);margin-left:6px;">${this._escapeHtml(item.desc)}</span>
                        </div>`;
                    }
                }
            }
        } else {
            const expects = lib.getExpectList();
            for (const item of expects) {
                if (!filter || item.name.toLowerCase().includes(filter) || item.desc.toLowerCase().includes(filter)) {
                    html += `<div class="autocomplete-item" style="padding:6px 10px;cursor:pointer;font-size:11px;"
                        onmousedown="TestQueuePage.selectAutocomplete('${this._escapeHtml(item.example || item.name)}', ${stepIndex}, 'expect')">
                        <span style="color:var(--primary-color);">${this._escapeHtml(item.name)}</span>
                        <span style="color:var(--text-muted);margin-left:6px;">${this._escapeHtml(item.desc)}</span>
                    </div>`;
                }
            }
        }
        
        if (!html) {
            html = '<div style="padding:10px;color:var(--text-muted);font-size:11px;">无匹配项</div>';
        }
        
        dropdown.innerHTML = html;
        dropdown.style.display = 'block';
        
        // 添加hover效果
        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.onmouseenter = () => item.style.background = 'var(--input-bg)';
            item.onmouseleave = () => item.style.background = 'transparent';
        });
    },
    
    // 隐藏补全下拉
    hideAutocomplete() {
        const dropdown = document.getElementById('autocomplete-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    },
    
    // 选择补全项
    selectAutocomplete(value, stepIndex, type) {
        this.hideAutocomplete();
        
        if (type === 'action') {
            const input = document.querySelector(`.action-input[data-step="${stepIndex}"]`);
            if (input) {
                input.value = value;
                this.updateStepAction(stepIndex, value);
            }
        } else {
            this.addExpectTag(stepIndex, value);
            const input = document.querySelector(`.expect-input[data-step="${stepIndex}"]`);
            if (input) input.value = '';
        }
    },
    
    // 确认输入
    confirmInput(input, stepIndex, type) {
        const value = input.value.trim();
        if (!value) return;
        
        if (type === 'action') {
            this.updateStepAction(stepIndex, value);
        } else {
            this.addExpectTag(stepIndex, value);
            input.value = '';
        }
        this.hideAutocomplete();
    },
    
    // 更新步骤动作
    updateStepAction(stepIndex, actionText) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        
        const lib = window.UITestLib;
        if (lib) {
            const parsed = lib.parseAction(actionText);
            if (parsed) {
                this.editingAutoScript.steps[stepIndex].cmd = parsed.cmd;
                this.editingAutoScript.steps[stepIndex].param = parsed.param;
                return;
            }
        }
        
        // 无法解析，保存原始文本
        this.editingAutoScript.steps[stepIndex].cmd = actionText;
        this.editingAutoScript.steps[stepIndex].param = undefined;
    },
    
    // 添加期望标签
    addExpectTag(stepIndex, expectText) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        const step = this.editingAutoScript.steps[stepIndex];
        if (!step.expect) step.expect = {};
        
        const lib = window.UITestLib;
        if (lib) {
            const parsed = lib.parseExpect(expectText);
            if (parsed) {
                step.expect[parsed.field] = parsed.value !== undefined ? parsed.value : parsed.check;
                this.refreshTestStepsV2();
                return;
            }
        }
        
        // 无法解析，尝试简单格式 key=value
        const match = expectText.match(/^(\w+)=(.+)$/);
        if (match) {
            const numVal = parseFloat(match[2]);
            step.expect[match[1]] = isNaN(numVal) ? match[2] : numVal;
        }
        this.refreshTestStepsV2();
    },
    
    // 移除期望标签
    removeExpectTag(stepIndex, tagIndex) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        const expects = this.editingAutoScript.steps[stepIndex].expect;
        if (!expects) return;
        
        const keys = Object.keys(expects);
        if (tagIndex < keys.length) {
            delete expects[keys[tagIndex]];
            this.refreshTestStepsV2();
        }
    },
    
    // 插入模板
    insertTemplateV2(templateName) {
        const lib = window.UITestLib;
        if (!lib) return;
        
        const steps = lib.applyTemplate(templateName);
        if (!steps || steps.length === 0) return;
        
        if (!this.editingAutoScript) this.editingAutoScript = { steps: [] };
        if (!this.editingAutoScript.steps) this.editingAutoScript.steps = [];
        
        // 转换模板步骤格式
        steps.forEach(s => {
            this.editingAutoScript.steps.push({
                cmd: s.cmd,
                param: s.param,
                expect: s.expects ? s.expects.reduce((acc, e) => {
                    if (e) acc[e.field] = e.value !== undefined ? e.value : e.check;
                    return acc;
                }, {}) : {}
            });
        });
        
        this.refreshTestStepsV2();
        Utils.toast(`已插入模板: ${templateName}`, 'success');
    },
    
    // 添加测试步骤V2
    addTestStepV2() {
        if (!this.editingAutoScript) this.editingAutoScript = { steps: [] };
        if (!this.editingAutoScript.steps) this.editingAutoScript.steps = [];
        this.editingAutoScript.steps.push({ cmd: 'key_measure', expect: {} });
        this.refreshTestStepsV2();
    },
    
    // 刷新步骤显示V2
    refreshTestStepsV2() {
        const container = document.getElementById('test-steps-container-v2');
        if (container && this.editingAutoScript) {
            container.innerHTML = this.renderTestStepsV2(this.editingAutoScript.steps || []);
        }
    },
    
    // 转换旧格式 {setup, steps, expect} 到新格式 {steps: [{cmd, param, expect}]}
    _convertOldScriptFormat() {
        const s = this.editingAutoScript;
        if (!s) return;
        
        // 如果已经是新格式，不转换
        if (s.steps && s.steps.length > 0 && s.steps[0].expect !== undefined) return;
        
        // 合并 setup 和 steps
        const newSteps = [];
        
        // setup 步骤
        if (s.setup && s.setup.length > 0) {
            s.setup.forEach(step => {
                newSteps.push({ cmd: step.cmd, param: step.param, expect: {} });
            });
        }
        
        // steps 步骤
        if (s.steps && s.steps.length > 0) {
            s.steps.forEach((step, i) => {
                const newStep = { cmd: step.cmd, param: step.param, expect: {} };
                // 最后一步继承原来的 expect
                if (i === s.steps.length - 1 && s.expect) {
                    newStep.expect = { ...s.expect };
                }
                newSteps.push(newStep);
            });
        }
        
        this.editingAutoScript = { steps: newSteps };
    },
    
    // 渲染测试步骤 - 每步包含动作和期望值
    renderTestSteps(steps) {
        if (!steps || steps.length === 0) {
            return `<div style="padding:16px;text-align:center;color:var(--text-muted);">
                <div style="font-size:20px;margin-bottom:6px;">📋</div>
                <div style="font-size:12px;">暂无步骤，点击上方按钮添加</div>
            </div>`;
        }
        
        return steps.map((step, i) => {
            const action = step.cmd || 'key_measure';
            const expects = step.expect || {};
            
            return `
            <div class="test-step" draggable="true" data-index="${i}"
                style="margin-bottom:8px;border:1px solid var(--border-color);border-radius:6px;background:rgba(0,0,0,0.15);"
                ondragstart="TestQueuePage.onStepDrag(event,${i},'start')"
                ondragover="TestQueuePage.onStepDrag(event,${i},'over')"
                ondrop="TestQueuePage.onStepDrag(event,${i},'drop')"
                ondragend="TestQueuePage.onStepDrag(event,${i},'end')">
                
                <!-- 动作行 -->
                <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:rgba(0,0,0,0.15);border-radius:6px 6px 0 0;">
                    <span style="cursor:grab;color:var(--text-muted);" title="拖拽排序">⋮⋮</span>
                    <span style="background:var(--primary-color);color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;">${i+1}</span>
                    
                    <select style="flex:1;padding:5px;border:1px solid var(--border-color);border-radius:4px;background:var(--input-bg);color:var(--text-color);font-size:12px;" 
                            onchange="TestQueuePage.updateTestStep(${i},'cmd',this.value)">
                        <optgroup label="按键">
                            ${this.actionTypes.filter(a=>a.group==='按键').map(a => 
                                `<option value="${a.id}" ${action===a.id?'selected':''}>${a.icon} ${a.name}</option>`).join('')}
                        </optgroup>
                        <optgroup label="模拟">
                            ${this.actionTypes.filter(a=>a.group==='模拟').map(a => 
                                `<option value="${a.id}" ${action===a.id?'selected':''}>${a.icon} ${a.name}</option>`).join('')}
                        </optgroup>
                        <optgroup label="控制">
                            ${this.actionTypes.filter(a=>a.group==='控制'||a.group==='LCD').map(a => 
                                `<option value="${a.id}" ${action===a.id?'selected':''}>${a.icon} ${a.name}</option>`).join('')}
                        </optgroup>
                    </select>
                    
                    ${this.renderStepParam(step, i)}
                    
                    <button class="cyber-btn sm" onclick="TestQueuePage.insertTestStep(${i})" title="在后面插入" style="padding:3px 6px;">➕</button>
                    <button class="cyber-btn sm" onclick="TestQueuePage.removeTestStep(${i})" title="删除" style="padding:3px 6px;color:var(--error-color);">🗑️</button>
                </div>
                
                <!-- 期望值行 -->
                <div style="padding:6px 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span style="font-size:10px;color:var(--text-muted);">期望:</span>
                    ${this.renderStepExpects(expects, i)}
                    <button onclick="TestQueuePage.addStepExpect(${i})" 
                        style="background:none;border:1px dashed var(--border-color);color:var(--text-muted);padding:2px 6px;border-radius:3px;font-size:10px;cursor:pointer;">+</button>
                </div>
            </div>`;
        }).join('');
    },
    
    // 渲染步骤参数
    renderStepParam(step, i) {
        const action = step.cmd || 'key_measure';
        const style = 'padding:4px 6px;border:1px solid var(--border-color);border-radius:3px;background:var(--input-bg);color:var(--text-color);font-size:11px;';
        
        switch(action) {
            case 'sim_ok': {
                const dist = step.param?.distance ?? 5000;
                const sig = step.param?.signal ?? 3;
                return `<input type="number" style="width:60px;${style}" value="${dist}" onchange="TestQueuePage.updateStepParam(${i},'distance',this.value)" title="距离(mm)">
                        <input type="number" style="width:35px;${style}" value="${sig}" onchange="TestQueuePage.updateStepParam(${i},'signal',this.value)" title="信号">`;
            }
            case 'sim_err':
                return `<input type="number" style="width:50px;${style}" value="${step.param||1}" onchange="TestQueuePage.updateTestStep(${i},'param',parseInt(this.value))" title="错误码">`;
            case 'set_unit':
                return `<select style="width:55px;${style}" onchange="TestQueuePage.updateTestStep(${i},'param',parseInt(this.value))">
                    <option value="0" ${step.param==0?'selected':''}>米</option>
                    <option value="1" ${step.param==1?'selected':''}>英尺</option>
                    <option value="2" ${step.param==2?'selected':''}>英寸</option>
                </select>`;
            case 'wait':
                return `<input type="number" style="width:50px;${style}" value="${step.param||300}" onchange="TestQueuePage.updateTestStep(${i},'param',parseInt(this.value))" title="ms">
                        <span style="font-size:10px;color:var(--text-muted);">ms</span>`;
            case 'lcd_screenshot':
                return `<input type="text" style="width:70px;${style}" value="${step.param||'step'+(i+1)}" onchange="TestQueuePage.updateTestStep(${i},'param',this.value)" title="文件名">`;
            default:
                return '';
        }
    },
    
    // 渲染步骤期望值
    renderStepExpects(expects, stepIndex) {
        const entries = Object.entries(expects || {});
        if (entries.length === 0) {
            return '<span style="font-size:10px;color:var(--text-muted);font-style:italic;">无</span>';
        }
        
        return entries.map(([key, value]) => {
            const field = this.expectFields.find(f => f.id === key) || { name: key };
            return `<div style="display:inline-flex;align-items:center;gap:2px;background:var(--card-bg);padding:2px 6px;border-radius:3px;font-size:10px;">
                <select style="border:none;background:transparent;color:var(--primary-color);font-size:10px;padding:0;" 
                        onchange="TestQueuePage.updateStepExpectKey(${stepIndex},'${key}',this.value)">
                    ${this.expectFields.map(f => `<option value="${f.id}" ${f.id===key?'selected':''}>${f.name}</option>`).join('')}
                </select>
                <span style="color:var(--text-muted);">=</span>
                ${field.options 
                    ? `<select style="border:none;background:transparent;color:var(--text-color);font-size:10px;padding:0;" 
                            onchange="TestQueuePage.updateStepExpectValue(${stepIndex},'${key}',this.value)">
                        ${field.options.map(opt => `<option value="${opt}" ${value===opt?'selected':''}>${opt}</option>`).join('')}
                       </select>`
                    : `<input type="text" style="width:40px;border:none;background:transparent;color:var(--text-color);font-size:10px;padding:0;" 
                            value="${value}" onchange="TestQueuePage.updateStepExpectValue(${stepIndex},'${key}',this.value)">`
                }
                <span onclick="TestQueuePage.removeStepExpect(${stepIndex},'${key}')" style="cursor:pointer;color:var(--error-color);">×</span>
            </div>`;
        }).join('');
    },
    
    // 测试步骤操作
    addTestStep() {
        if (!this.editingAutoScript) this.editingAutoScript = { steps: [] };
        if (!this.editingAutoScript.steps) this.editingAutoScript.steps = [];
        this.editingAutoScript.steps.push({ cmd: 'key_measure', expect: {} });
        this.refreshTestSteps();
    },
    
    insertTestStep(afterIndex) {
        if (!this.editingAutoScript?.steps) return;
        this.editingAutoScript.steps.splice(afterIndex + 1, 0, { cmd: 'key_measure', expect: {} });
        this.refreshTestSteps();
    },
    
    removeTestStep(index) {
        if (!this.editingAutoScript?.steps) return;
        this.editingAutoScript.steps.splice(index, 1);
        this.refreshTestSteps();
    },
    
    updateTestStep(index, field, value) {
        if (!this.editingAutoScript?.steps) return;
        this.editingAutoScript.steps[index][field] = value;
        if (field === 'cmd') {
            delete this.editingAutoScript.steps[index].param;
            this.refreshTestSteps();
        }
    },
    
    updateStepParam(index, paramKey, value) {
        if (!this.editingAutoScript?.steps) return;
        const step = this.editingAutoScript.steps[index];
        if (!step.param || typeof step.param !== 'object') step.param = {};
        step.param[paramKey] = parseInt(value) || 0;
    },
    
    addStepExpect(stepIndex) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        const step = this.editingAutoScript.steps[stepIndex];
        if (!step.expect) step.expect = {};
        const usedKeys = Object.keys(step.expect);
        const field = this.expectFields.find(f => !usedKeys.includes(f.id));
        if (field) {
            step.expect[field.id] = field.options ? field.options[0] : '';
        }
        this.refreshTestSteps();
    },
    
    updateStepExpectKey(stepIndex, oldKey, newKey) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        const expect = this.editingAutoScript.steps[stepIndex].expect;
        if (!expect || oldKey === newKey) return;
        const value = expect[oldKey];
        delete expect[oldKey];
        expect[newKey] = value;
        this.refreshTestSteps();
    },
    
    updateStepExpectValue(stepIndex, key, value) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        const expect = this.editingAutoScript.steps[stepIndex].expect;
        if (!expect) return;
        const numVal = parseFloat(value);
        expect[key] = isNaN(numVal) ? value : numVal;
    },
    
    removeStepExpect(stepIndex, key) {
        if (!this.editingAutoScript?.steps?.[stepIndex]) return;
        delete this.editingAutoScript.steps[stepIndex].expect[key];
        this.refreshTestSteps();
    },
    
    refreshTestSteps() {
        // 优先使用V2容器
        const containerV2 = document.getElementById('test-steps-container-v2');
        if (containerV2 && this.editingAutoScript) {
            containerV2.innerHTML = this.renderTestStepsV2(this.editingAutoScript.steps || []);
            return;
        }
        // 兼容旧容器
        const container = document.getElementById('test-steps-container');
        if (container && this.editingAutoScript) {
            container.innerHTML = this.renderTestSteps(this.editingAutoScript.steps || []);
        }
    },
    
    // 拖拽排序
    onStepDrag(e, index, action) {
        if (action === 'start') {
            this._dragIndex = index;
            e.target.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        } else if (action === 'over') {
            e.preventDefault();
        } else if (action === 'drop') {
            e.preventDefault();
            const from = this._dragIndex;
            if (from !== undefined && from !== index) {
                const arr = this.editingAutoScript?.steps;
                if (arr) {
                    const [item] = arr.splice(from, 1);
                    arr.splice(index, 0, item);
                    this.refreshTestSteps();
                }
            }
        } else if (action === 'end') {
            e.target.style.opacity = '1';
            this._dragIndex = undefined;
        }
    },
    
    // 取消编辑
    cancelScriptEdit(key) {
        this.editingAutoScript = null;
        this.showItemDetail(key);
    },
    
    // 保存脚本
    async saveScript(key) {
        if (!this.editingAutoScript) return;
        if (!this.autoScripts) this.autoScripts = {};
        this.autoScripts[key] = this.editingAutoScript;
        await this.saveAutoScriptsToTemplate();
        this.editingAutoScript = null;
        this.showItemDetail(key);
        Utils.toast('脚本已保存', 'success');
    },
    
    // 保存 autoScripts 到模板文件
    async saveAutoScriptsToTemplate() {
        try {
            // 使用 pywebview API 或 HTTP fallback
            const api = window.pywebview?.api || {
                ui_test_save_scripts: async (template, scripts) => {
                    const response = await fetch('http://127.0.0.1:8766/api/call', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            method: 'ui_test_save_scripts',
                            params: [template, scripts]
                        })
                    });
                    return await response.json();
                }
            };
            
            const result = await api.ui_test_save_scripts('gd303_mini_ui', this.autoScripts);
            if (!result.success) {
                console.error('保存脚本失败:', result.error);
            }
        } catch (err) {
            console.error('保存脚本失败:', err);
        }
    },
    
    hideItemDetail() {
        document.getElementById('item-detail-dialog').style.display = 'none';
    },
    
    saveItemDetail() {
        const key = this.currentItemKey;
        if (!key) return;
        
        // 保存结果
        const result = document.getElementById('detail-result').value;
        if (result) {
            this.testResults[key] = result;
        } else {
            delete this.testResults[key];
        }
        
        // 保存数值
        const valueEl = document.getElementById('detail-value');
        if (valueEl) {
            this.testResults[key + '_value'] = valueEl.value;
        }
        
        // 保存详情
        this.testResults[key + '_detail'] = {
            method: document.getElementById('detail-method').value,
            env: document.getElementById('detail-env').value,
            device: document.getElementById('detail-device').value,
            note: document.getElementById('detail-note').value,
            time: new Date().toLocaleString()
        };
        
        this.hideItemDetail();
        this.renderTabContent();
    },
    
    // 导出测试报告
    exportReport() {
        const t = this.currentTest;
        
        // 构建报告内容
        let report = `# 固件测试报告\n\n`;
        report += `## 产品信息\n`;
        report += `- 产品名称: ${t?.project?.name || '--'}\n`;
        report += `- 软件版本: v${t?.version || '--'}\n`;
        report += `- Git提交: ${t?.git_commit || t?.gitCommit || '--'}\n`;
        report += `- 测试日期: ${new Date().toLocaleDateString()}\n\n`;
        
        // 各分类测试结果
        Object.entries(this.testTemplate).forEach(([catKey, cat]) => {
            report += `## ${cat.name}\n`;
            
            if (cat.multiDevice && this.testDevices.length > 0) {
                // 多设备测试：按设备分组显示
                report += `> 多设备测试 (${this.testDevices.length}/${cat.minDevices || 3} 台设备)\n\n`;
                
                this.testDevices.forEach((dev, idx) => {
                    const devResults = this.testResults.devices[idx] || {};
                    report += `### 设备: ${dev.sn || `设备${idx+1}`}\n`;
                    
                    cat.groups.forEach(group => {
                        report += `#### ${group.name}\n`;
                        group.items.forEach(item => {
                            const r = devResults[item.key];
                            const v = devResults[item.key + '_value'];
                            const status = r === 'pass' ? '✓ 通过' : r === 'fail' ? '✗ 不通过' : '○ 未测试';
                            report += `- ${item.name}: ${status}${v ? ` (${v}${item.unit || ''})` : ''}\n`;
                        });
                        report += '\n';
                    });
                });
                
                // 多设备汇总表
                report += `### 设备测试汇总\n`;
                report += `| 设备SN | 通过 | 失败 | 待测 |\n`;
                report += `|--------|------|------|------|\n`;
                this.testDevices.forEach((dev, idx) => {
                    const devResults = this.testResults.devices[idx] || {};
                    let passed = 0, failed = 0, pending = 0;
                    cat.groups.forEach(group => {
                        group.items.forEach(item => {
                            const r = devResults[item.key];
                            if (r === 'pass') passed++;
                            else if (r === 'fail') failed++;
                            else pending++;
                        });
                    });
                    report += `| ${dev.sn || `设备${idx+1}`} | ${passed} | ${failed} | ${pending} |\n`;
                });
                report += '\n';
            } else {
                // 单设备测试
                cat.groups.forEach(group => {
                    report += `### ${group.name}\n`;
                    group.items.forEach(item => {
                        const r = this.testResults[item.key];
                        const v = this.testResults[item.key + '_value'];
                        const status = r === 'pass' ? '✓ 通过' : r === 'fail' ? '✗ 不通过' : '○ 未测试';
                        report += `- ${item.name}: ${status}${v ? ` (${v}${item.unit || ''})` : ''}\n`;
                    });
                    report += '\n';
                });
            }
        });
        
        // 自定义测试项
        const customItems = this.testResults.customItems || [];
        if (customItems.length > 0) {
            report += `## 自定义测试项\n`;
            customItems.forEach(item => {
                const status = item.result === 'pass' ? '✓ 通过' : item.result === 'fail' ? '✗ 不通过' : '○ 未测试';
                report += `- ${item.name}: ${status}${item.value ? ` (${item.value}${item.unit || ''})` : ''}\n`;
            });
            report += '\n';
        }
        
        // 异常
        if (this.testResults.issues?.length > 0) {
            report += `## 异常问题\n`;
            this.testResults.issues.forEach(issue => {
                report += `- [${issue.severity}] ${issue.title}: ${issue.description || ''}\n`;
            });
            report += '\n';
        }
        
        // 测试设备列表
        if (this.testDevices.length > 0) {
            report += `## 测试设备列表\n`;
            this.testDevices.forEach((dev, idx) => {
                report += `- ${idx + 1}. ${dev.sn} (添加时间: ${dev.addedAt || '--'})\n`;
            });
            report += '\n';
        }
        
        // 结论
        report += `## 测试结论\n${this.testResults.conclusion || '无'}\n`;
        
        // 下载
        const blob = new Blob([report], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `测试报告_${t?.project?.name || 'unknown'}_v${t?.version || '0'}_${new Date().toISOString().slice(0,10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // 渲染来源信息（不再使用，新布局没有这个面板）
    renderSourceInfo() {
        // 新布局不需要
    },

    // 更新测试数据
    updateChecklist(index, checked) {
        if (this.testData) {
            this.testData.checklist[index].checked = checked;
        }
    },

    updateChecklistNote(index, note) {
        if (this.testData) {
            this.testData.checklist[index].note = note;
        }
    },

    // 测试通过
    async passTest() {
        if (!this.currentTest) return;
        
        // 检查多设备测试是否完成
        let multiDeviceWarnings = [];
        Object.entries(this.testTemplate).forEach(([catKey, cat]) => {
            if (cat.multiDevice && cat.minDevices) {
                const deviceCount = this.testDevices.length;
                if (deviceCount < cat.minDevices) {
                    multiDeviceWarnings.push(`${cat.name}: 需要至少 ${cat.minDevices} 台设备，当前仅 ${deviceCount} 台`);
                }
            }
        });
        
        if (multiDeviceWarnings.length > 0) {
            alert('多设备测试未完成:\n\n' + multiDeviceWarnings.join('\n'));
            return;
        }
        
        if (confirm('确认测试通过？')) {
            // 保存测试结果，包含设备信息
            const resultData = {
                ...this.testResults,
                testDevices: this.testDevices,
                templateId: this.currentTemplateId
            };
            const notes = JSON.stringify(resultData);
            const result = await API.call('dev_update_test_status', this.currentTest.id, 'passed', notes);
            
            if (result.success) {
                this.currentTest = null;
                this.testResults = null;
                this.testDevices = [];
                document.getElementById('test-tabs').style.display = 'none';
                document.getElementById('version-bar').innerHTML = '<div class="empty-state">✅ 测试通过！</div>';
                document.getElementById('test-content').innerHTML = '';
                await this.loadQueue();
                await this.loadHistory();
            } else {
                alert('操作失败: ' + (result.error || '未知错误'));
            }
        }
    },

    // 测试不通过
    async failTest() {
        if (!this.currentTest) return;
        
        const reason = prompt('请输入不通过原因:');
        if (reason) {
            // 保存测试结果，包含设备信息
            const resultData = {
                ...this.testResults,
                failReason: reason,
                testDevices: this.testDevices,
                templateId: this.currentTemplateId
            };
            const notes = JSON.stringify(resultData);
            const result = await API.call('dev_update_test_status', this.currentTest.id, 'rejected', notes);
            
            if (result.success) {
                this.currentTest = null;
                this.testResults = null;
                this.testDevices = [];
                document.getElementById('test-tabs').style.display = 'none';
                document.getElementById('version-bar').innerHTML = '<div class="empty-state">❌ 已退回研发</div>';
                document.getElementById('test-content').innerHTML = '';
                await this.loadQueue();
                await this.loadHistory();
            } else {
                alert('操作失败: ' + (result.error || '未知错误'));
            }
        }
    },

    // 快速驳回（直接从列表驳回）
    async quickReject(testId) {
        const test = this.queue.find(t => t.id === testId);
        if (!test) return;
        
        const reason = prompt(`驳回 "${test.project?.name || ''} v${test.version}"，请输入原因:`);
        if (reason) {
            const notes = JSON.stringify({ failReason: reason, quickReject: true });
            const result = await API.call('dev_update_test_status', testId, 'rejected', notes);
            
            if (result.success) {
                // 如果当前正在查看这个测试，清空右侧面板
                if (this.currentTest?.id === testId) {
                    this.currentTest = null;
                    this.testResults = null;
                    document.getElementById('test-tabs').style.display = 'none';
                    document.getElementById('version-bar').innerHTML = '<div class="empty-state">选择左侧待测固件开始测试</div>';
                    document.getElementById('test-content').innerHTML = '';
                }
                await this.loadQueue();
                await this.loadHistory();
                console.log('已驳回:', test.project?.name, 'v' + test.version);
            } else {
                alert('驳回失败: ' + (result.error || '未知错误'));
            }
        }
    },

    // 查看历史
    viewHistory(testId) {
        const test = this.history.find(t => t.id === testId);
        if (test) {
            this.currentTest = test;
            this.renderTestContent();
            this.renderSourceInfo();
        }
    },

    // 跳转到研发页面
    viewInDev(buildId) {
        switchPage('dev_project');
    },
    
    // 共享文件相关
    currentShareData: null,
    currentSharePath: null,
    
    async openShareFile() {
        try {
            const result = await API.call('share_load_file');
            
            if (result.success) {
                this.currentShareData = result.share_data;
                this.currentSharePath = result.path;
                
                // 验证版本匹配
                const manifest = this.currentShareData.manifest;
                const verifyResult = await API.call('share_verify_version', this.currentShareData);
                
                if (verifyResult.success) {
                    let statusText = `已打开: ${result.path.split('\\').pop()}`;
                    if (!verifyResult.match) {
                        statusText += ' (⚠️ 版本不匹配)';
                        if (verifyResult.warnings.length > 0) {
                            statusText += '\n' + verifyResult.warnings.join('\n');
                        }
                    } else {
                        statusText += ' (版本匹配)';
                    }
                    
                    document.getElementById('share-status').textContent = statusText;
                    const btnImport = document.getElementById('btn-import-share');
                    if (btnImport) btnImport.disabled = false;
                    const btnUpdate = document.getElementById('btn-update-share');
                    if (btnUpdate) btnUpdate.disabled = false;
                    
                    Utils.toast('共享文件加载成功', verifyResult.match ? 'success' : 'warning');
                } else {
                    Utils.toast('验证失败: ' + verifyResult.error, 'error');
                }
            } else {
                Utils.toast('加载失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async importShareData() {
        if (!this.currentShareData) {
            Utils.toast('请先打开共享文件', 'warning');
            return;
        }
        
        if (!confirm('确定导入共享文件的测试结果？这将添加到本地数据库中。')) {
            return;
        }
        
        try {
            const result = await API.call('share_import_results', this.currentShareData);
            
            if (result.success) {
                Utils.toast(`导入成功: 新增${result.imported}条，跳过${result.skipped}条`, 'success');
                
                // 刷新测试数据页面
                if (window.TestDataPage) {
                    await TestDataPage.loadData();
                }
            } else {
                Utils.toast('导入失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async updateShareFile() {
        if (!this.currentTest) {
            Utils.toast('请先选择测试项', 'warning');
            return;
        }

        // 如果未打开任务文件，但当前测试项带有 share_path，则自动加载
        if (!this.currentShareData) {
            const sharePath = this.currentTest?.share_path;
            if (!sharePath) {
                Utils.toast('请先点击“打开任务文件”加载任务', 'warning');
                return;
            }

            const loadResult = await API.call('share_load_file', sharePath);
            if (!loadResult.success) {
                Utils.toast('加载任务文件失败: ' + (loadResult.error || '未知错误'), 'error');
                return;
            }
            this.currentShareData = loadResult.share_data;
            this.currentSharePath = sharePath;
        }
        
        try {
            // 获取当前测试结果
            const testResults = this.currentTest.results || {};
            const issues = this.currentTest.issues || [];
            const customItems = this.currentTest.custom_items || [];
            
            // 获取测试数据
            const sessions = [];
            if (this.currentTest.test_data_ids) {
                for (const sessionId of this.currentTest.test_data_ids) {
                    // 这里需要从数据API获取会话数据
                    const sessionResult = await API.call('data_get_session', sessionId);
                    if (sessionResult.success) {
                        sessions.push(sessionResult.session);
                    }
                }
            }
            
            // 更新共享文件
            const status = this.currentTest.status || 'testing';
            const notes = this.currentTest.remarks || '';
            
            const result = await API.call('share_update_results', 
                this.currentShareData, status, notes, testResults, issues, customItems, sessions);
            
            if (result.success) {
                this.currentShareData = result.share_data;
                
                // 保存文件
                const saveResult = await API.call('share_save_file', this.currentShareData, this.currentSharePath);
                if (saveResult.success) {
                    document.getElementById('share-status').textContent = 
                        `已更新: ${saveResult.path.split('\\').pop()}`;
                    Utils.toast('共享文件更新成功', 'success');
                } else {
                    Utils.toast('保存失败: ' + saveResult.error, 'error');
                }
            } else {
                Utils.toast('更新失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    // ==================== 任务文件导入 ====================
    
    async importTaskFile() {
        try {
            // 选择.glshare.json文件
            const result = await API.call('share_select_file');
            if (!result.success) {
                if (result.error !== '用户取消') {
                    Utils.toast('选择文件失败: ' + result.error, 'error');
                }
                return;
            }
            
            const filePath = result.path;
            Utils.toast('正在加载任务文件...', 'info');
            
            // 加载共享文件
            const loadResult = await API.call('share_load_file', filePath);
            if (!loadResult.success) {
                Utils.toast('加载失败: ' + loadResult.error, 'error');
                return;
            }
            
            const shareData = loadResult.share_data;
            this.currentShareData = shareData;
            this.currentSharePath = filePath;
            
            // 显示任务信息
            const manifest = shareData.manifest || {};
            const assignment = shareData.assignment || {};
            
            Utils.toast(`任务已加载: ${manifest.project_name || '未知项目'} v${manifest.version || '?'}`, 'success');
            
            // 将任务添加到待测队列
            const taskItem = {
                id: shareData.share_id,
                version_id: manifest.version_id,
                version: manifest.version,
                project_name: manifest.project_name,
                fw_version: manifest.fw_version,
                fw_model: manifest.fw_model,
                expected_crc: manifest.expected_crc,
                hex_file: manifest.hex_file,
                status: 'pending',
                priority: assignment.priority || 'medium',
                due_date: assignment.due_date,
                source: 'share_file',
                share_path: filePath
            };
            
            // 检查是否已存在
            const existIdx = this.queue.findIndex(q => q.id === taskItem.id);
            if (existIdx >= 0) {
                this.queue[existIdx] = taskItem;
            } else {
                this.queue.unshift(taskItem);
            }
            
            this.renderQueue();
            
            // 自动选中并开始测试流程
            this.selectTest(taskItem.id);
            
            // 显示共享文件操作栏
            document.getElementById('share-bar').style.display = 'block';
            document.getElementById('btn-update-share').disabled = false;
            const btnSubmit = document.getElementById('btn-submit-result');
            if (btnSubmit) btnSubmit.disabled = false;
            document.getElementById('share-status').textContent = 
                `已加载: ${filePath.split('\\').pop()} | 分配人: ${assignment.assigned_by || '未知'}`;
                
        } catch (e) {
            console.error('导入任务文件失败:', e);
            Utils.toast('导入失败: ' + e.message, 'error');
        }
    },
    
    async openShareDir() {
        try {
            // 获取共享目录路径
            const result = await API.call('share_get_directory');
            if (result.success && result.path) {
                // 打开目录
                await API.call('share_open_directory', result.path);
                Utils.toast('已打开共享目录', 'success');
            } else {
                // 让用户设置共享目录
                const setResult = await API.call('share_set_directory');
                if (setResult.success) {
                    Utils.toast('共享目录已设置: ' + setResult.path, 'success');
                }
            }
        } catch (e) {
            console.error('打开共享目录失败:', e);
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    // ==================== 提交结果并发送邮件 ====================
    
    async submitResultAndNotify() {
        if (!this.currentShareData || !this.currentSharePath) {
            const sharePath = this.currentTest?.share_path;
            if (sharePath) {
                const loadResult = await API.call('share_load_file', sharePath);
                if (loadResult.success) {
                    this.currentShareData = loadResult.share_data;
                    this.currentSharePath = sharePath;
                } else {
                    Utils.toast('请先打开任务文件', 'error');
                    return;
                }
            } else {
                Utils.toast('请先打开任务文件', 'error');
                return;
            }
        }
        
        try {
            Utils.toast('正在提交测试结果...', 'info');
            
            // 获取当前测试结果
            const testResults = this.currentTest?.results || {};
            const issues = this.currentTest?.issues || [];
            
            // 计算通过率
            let totalItems = 0;
            let passedItems = 0;
            for (const cat in testResults) {
                for (const itemId in testResults[cat]) {
                    totalItems++;
                    if (testResults[cat][itemId] === 'pass') passedItems++;
                }
            }
            const passRate = totalItems > 0 ? passedItems / totalItems : 0;
            const status = passRate >= 0.8 ? 'passed' : 'failed';
            
            // 更新共享文件
            this.currentShareData.assignment.status = 'completed';
            this.currentShareData.test_results = {
                status: status,
                pass_rate: passRate,
                total_items: totalItems,
                passed_items: passedItems,
                results: testResults,
                issues: issues,
                completed_at: new Date().toISOString()
            };
            
            // 保存共享文件
            const saveResult = await API.call('share_save_file', this.currentShareData, this.currentSharePath);
            if (!saveResult.success) {
                Utils.toast('保存失败: ' + saveResult.error, 'error');
                return;
            }
            
            // 获取研发人员信息并发送邮件
            const assignedBy = this.currentShareData.assignment?.assigned_by;
            if (assignedBy) {
                const userResult = await API.call('user_get', assignedBy);
                if (userResult.success && userResult.user?.email) {
                    const manifest = this.currentShareData.manifest || {};
                    const currentUser = await API.call('user_get_current');
                    
                    const resultInfo = {
                        project_name: manifest.project_name || '',
                        version: manifest.version || '',
                        status: status,
                        tester_name: currentUser.user?.name || '测试人员',
                        stats: { pass_rate: passRate },
                        test_time: new Date().toLocaleString('zh-CN'),
                        notes: issues.length > 0 ? `发现 ${issues.length} 个问题` : '测试通过，无异常'
                    };
                    
                    const emailResult = await API.call('email_send_result', 
                        userResult.user.email,
                        userResult.user.name || assignedBy,
                        resultInfo,
                        this.currentSharePath
                    );
                    
                    if (emailResult.success) {
                        Utils.toast('测试结果已提交，邮件已发送给研发！', 'success');
                    } else {
                        Utils.toast('结果已保存，但邮件发送失败: ' + emailResult.error, 'warning');
                    }
                    
                    // 同时更新Git仓库
                    try {
                        const gitResult = await API.call('git_update_task', this.currentShareData, this.currentSharePath);
                        if (gitResult.success) {
                            Utils.toast(`Git仓库已更新: ${gitResult.web_url}`, 'info');
                        }
                    } catch (e) {
                        console.log('Git更新失败:', e);
                    }
                } else {
                    Utils.toast('结果已保存，但未找到研发人员邮箱', 'warning');
                }
            } else {
                Utils.toast('测试结果已保存', 'success');
            }
            
            // 更新界面状态
            document.getElementById('share-status').textContent = 
                `✅ 已提交 | 通过率: ${(passRate * 100).toFixed(1)}%`;
                
        } catch (e) {
            console.error('提交结果失败:', e);
            Utils.toast('提交失败: ' + e.message, 'error');
        }
    },
    
    // ==================== UI自动化测试 ====================
    
    // 自动化脚本存储 { itemKey: { setup, steps, expect } }
    autoScripts: {},
    autoTestRunning: false,
    autoTestAbort: false,
    
    // 运行单个测试项的自动化脚本
    async runAutoTest(itemKey) {
        const script = this.autoScripts[itemKey];
        if (!script) {
            Utils.toast('该测试项没有自动化脚本', 'warning');
            return;
        }
        
        // 检查串口连接
        if (!window.DeviceHub?.isSerialConnected()) {
            Utils.toast('请先连接设备', 'error');
            return;
        }
        
        this.autoTestRunning = true;
        this.autoTestAbort = false;
        
        // 更新UI显示运行状态
        const itemEl = document.querySelector(`.test-item[data-key="${itemKey}"]`);
        if (itemEl) {
            itemEl.classList.add('running');
        }
        
        try {
            // 执行setup
            if (script.setup) {
                for (const action of script.setup) {
                    if (this.autoTestAbort) break;
                    await this.executeAction(action);
                }
            }
            
            // 执行steps (每步都有期望值验证)
            let allPassed = true;
            let lastError = null;
            
            if (script.steps) {
                for (let i = 0; i < script.steps.length; i++) {
                    if (this.autoTestAbort) break;
                    const step = script.steps[i];
                    
                    // 处理复合动作（如"重置"）
                    if (step.cmd === 'reset' && window.UITestLib?.actions['重置']?.isComposite) {
                        const resetDef = UITestLib.actions['重置'];
                        for (const subAction of resetDef.subActions) {
                            await this.executeAction({ cmd: subAction.cmd });
                            if (subAction.delay) await this.sleep(subAction.delay);
                        }
                    } else {
                        await this.executeAction(step);
                    }
                    
                    // 每步验证期望值
                    if (step.expect && Object.keys(step.expect).length > 0) {
                        await this.sleep(150); // 等待设备状态稳定
                        const result = await this.verifyExpect(step.expect);
                        
                        if (!result.passed) {
                            allPassed = false;
                            lastError = `步骤${i+1}: ${result.error}`;
                            // 继续执行后续步骤，但记录失败
                        }
                    }
                }
            }
            
            // 记录结果
            if (allPassed) {
                this.setResult(itemKey, 'pass');
                Utils.toast(`[${itemKey}] 测试通过`, 'success');
            } else {
                this.setResult(itemKey, 'fail');
                Utils.toast(`[${itemKey}] 测试失败: ${lastError}`, 'error');
            }
        } catch (e) {
            console.error('自动测试失败:', e);
            this.setResult(itemKey, 'fail');
            Utils.toast(`[${itemKey}] 执行失败: ${e.message}`, 'error');
        } finally {
            this.autoTestRunning = false;
            if (itemEl) {
                itemEl.classList.remove('running');
            }
        }
    },
    
    // 批量运行所有有脚本的测试项
    async runAllAutoTests() {
        if (!window.DeviceHub?.isSerialConnected()) {
            Utils.toast('请先连接设备', 'error');
            return;
        }
        
        const itemsWithScript = Object.keys(this.autoScripts);
        if (itemsWithScript.length === 0) {
            Utils.toast('没有可执行的自动化脚本，请先加载模板', 'warning');
            return;
        }
        
        if (!confirm(`将执行 ${itemsWithScript.length} 个自动化测试，是否继续？`)) {
            return;
        }
        
        this.autoTestRunning = true;
        this.autoTestAbort = false;
        
        let passed = 0, failed = 0;
        
        for (const itemKey of itemsWithScript) {
            if (this.autoTestAbort) {
                Utils.toast('测试已中止', 'warning');
                break;
            }
            
            await this.runAutoTest(itemKey);
            
            // 统计结果
            if (this.testResults[itemKey] === 'pass') passed++;
            else if (this.testResults[itemKey] === 'fail') failed++;
            
            // 短暂延时
            await this.sleep(100);
        }
        
        this.autoTestRunning = false;
        Utils.toast(`批量测试完成: ${passed} 通过, ${failed} 失败`, passed > failed ? 'success' : 'warning');
    },
    
    // 执行单个动作
    async executeAction(action) {
        const cmd = action.cmd;
        const param = action.param;
        
        if (cmd === 'wait') {
            await this.sleep(param || 100);
            return;
        }
        
        // 调用后端API发送命令
        const result = await API.call('ui_test_send_cmd', cmd, param);
        if (!result || !result.success) {
            throw new Error(`命令 ${cmd} 执行失败`);
        }
    },
    
    // 验证期望值
    async verifyExpect(expect) {
        // 获取设备状态
        const result = await API.call('ui_test_get_device_status');
        if (!result || !result.success) {
            return { passed: false, error: '无法获取设备状态' };
        }
        
        const status = result.status;
        const tolerance = expect.tolerance || 0;
        const errors = [];
        
        for (const [key, expected] of Object.entries(expect)) {
            if (key === 'tolerance') continue;
            
            const actual = status[key];
            if (actual === undefined) {
                errors.push(`${key}: 未获取到值`);
                continue;
            }
            
            // 数值比较
            if (typeof expected === 'number' && typeof actual === 'number') {
                if (Math.abs(actual - expected) > tolerance) {
                    errors.push(`${key}: 期望 ${expected}±${tolerance}, 实际 ${actual}`);
                }
            } else if (actual !== expected) {
                errors.push(`${key}: 期望 ${expected}, 实际 ${actual}`);
            }
        }
        
        return {
            passed: errors.length === 0,
            error: errors.join('; '),
            actual: status
        };
    },
    
    // 编辑自动化脚本
    editAutoScripts() {
        // 打开脚本编辑器页面
        switchPage('ui_test_integrated');
    },
    
    // 辅助函数
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

window.TestQueuePage = TestQueuePage;
