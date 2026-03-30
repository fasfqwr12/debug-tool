/**
 * 主应用入口
 * 负责页面路由和模块生命周期管理
 * 支持模块化页面加载
 */


window.__assetVersion = window.__assetVersion || '20260318-temperature-export-offset-6';
console.info('[App] assetVersion =', window.__assetVersion);

window._slipwayHomeIoBtnClicked = function(btn) {
    try {
        const stateEl = document.getElementById('slipway-home-io-state');
        if (stateEl) {
            stateEl.textContent = '限位IO: 点击中...';
            stateEl.style.color = '#38bdf8';
        }
        if (btn) {
            const prevText = btn.textContent || '检测IO';
            btn.textContent = '检测中';
            setTimeout(() => {
                try { btn.textContent = prevText; } catch (e) {}
            }, 1200);
        }
        if (window.SlipwayPage && typeof window.SlipwayPage.checkHomeIo === 'function') {
            return window.SlipwayPage.checkHomeIo();
        }
        console.warn('[App] SlipwayPage.checkHomeIo 不可用');
    } catch (e) {
        console.error('[App] _slipwayHomeIoBtnClicked 异常', e);
    }
};

const App = {
    currentPage: null,
    currentPageName: null,
    loadedPages: {},
    _settingsCache: null,
    _inputCache: {},  // 输入框值缓存
    _loadedScripts: {},  // 已加载的JS脚本缓存
    
    // 页面模块映射 - 全部使用动态加载
    // scripts: 页面需要的JS文件（按需加载，首次导航时才下载）
    pages: {
        home: { module: null, html: 'pages/home.html', scripts: ['js/pages/home.js'] },
        device: { module: () => DevicePage, html: 'pages/device.html', scripts: ['js/device_config_manager.js', 'js/pages/device.js'] },
        debug: { module: () => DebugPage, html: 'pages/debug.html', scripts: ['js/pages/debug.js'] },
        debug_pro: { module: () => window.DebugPro, html: 'pages/debug_pro.html', scripts: ['js/device_config_manager.js'] },
        production: { module: () => ProductionPage, html: 'pages/production.html', scripts: ['js/pages/production.js'] },
        slipway: { module: () => SlipwayPage, html: 'pages/slipway.html', scripts: ['js/pages/slipway.js'] },
        calibration: { module: () => CalibrationPageV2, html: 'pages/calibration_v2.html', scripts: ['js/device_config_manager.js', 'js/pages/calibration.js', 'js/pages/calibration_v2.js'] },
        // 研发-测试-生产管理
        dev_git: { module: () => DevGitPage, html: 'pages/dev_git.html', scripts: ['js/pages/dev_git.js'] },
        vault: { module: () => window.VaultPage, html: 'pages/vault.html' },
        dev_release: { module: () => DevReleasePage, html: 'pages/dev_release.html', scripts: ['js/pages/dev_release.js'] },
        test_queue: { module: () => TestQueuePage, html: 'pages/test_queue.html', scripts: ['js/pages/test_queue.js'] },
        prod_flash: { module: () => ProdFlashPage, html: 'pages/prod_flash.html', scripts: ['js/pages/prod_flash.js'] },
        hex_merge: { module: () => window.HexMergePage, html: 'pages/hex_merge.html', scripts: ['js/pages/hex_merge.js'] },
        // 帮助页面
        help_dev: { module: null, html: 'pages/help_dev.html' },
        help_test: { module: null, html: 'pages/help_test.html' },
        help_prod: { module: null, html: 'pages/help_prod.html' },
        // 用户登录
        user_login: { module: () => UserLoginPage, html: 'pages/user_login.html' },
        settings: { module: () => SettingsPage, html: 'pages/settings.html', scripts: ['js/pages/settings.js'] },
        // 主题选择
        theme_selector: { module: () => ThemeSelectorPage, html: 'pages/theme_selector.html', scripts: ['js/pages/theme_selector.js'] },
        // 升降控制
        lift_control: { module: () => LiftControl, html: 'pages/lift_control.html', scripts: ['js/pages/lift_control.js'] },
        // 协议管理
        protocol_manager: { module: () => window.ProtocolPage, html: 'pages/protocol_manager.html', scripts: ['js/pages/protocol_manager.js'] },
        // UI自动化测试
        ui_test: { module: () => window.UITestPage, html: 'pages/ui_test.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/ui_test_lib.js', 'js/test_suites/gd303_mini_suite.js'] },
        // UI测试结果审核
        ui_test_review: { module: () => window.TestReview, html: 'pages/ui_test_review.html', scripts: ['js/ui_test_lib.js'] },
        // UI测试集成版
        ui_test_integrated: { module: () => window.UITestIntegrated, html: 'pages/ui_test_integrated.html', scripts: ['js/ui_test_lib.js'] },
        // 测试脚本编辑器
        test_script_editor: { module: () => window.TestScriptEditor, html: 'pages/test_script_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/pages/test_script_editor.js'] },
        // LCD段码编辑器
        lcd_segment_editor: { module: () => window.SegmentEditor, html: 'pages/lcd_segment_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/pages/lcd_segment_editor.js'] },
        // LCD组件编辑器
        lcd_component_editor: { module: () => window.CompEditor, html: 'pages/lcd_component_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js'] },
        // LCD界面预设编辑器
        lcd_preset_editor: { module: () => window.PresetEditor, html: 'pages/lcd_preset_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js'] },
        // LCD动画效果编辑器
        lcd_animation_editor: { module: () => window.AnimEditor, html: 'pages/lcd_animation_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js'] },
        // LCD运行时演示
        lcd_runtime_demo: { module: () => window.LcdRuntimeDemo, html: 'pages/lcd_runtime_demo.html', scripts: ['js/lcd_runtime.js'] },
        // 变量绑定演示
        variable_binding_demo: { module: null, html: 'pages/variable_binding_demo.html' },
        // UIStore v2.0 演示
        ui_store_v2_demo: { module: null, html: 'pages/ui_store_v2_demo.html' },
        // LCD模拟器
        lcd_simulator: { module: () => window.LcdSimulatorPage, html: 'pages/lcd_simulator.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/pages/lcd_simulator_page.js'] },
        // 动作库编辑器
        action_lib_editor: { module: () => window.ActionLibEditor, html: 'pages/action_lib_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/pages/action_lib_editor.js'] },
        // 流程编辑器
        flow_editor: { module: () => window.FlowEditor, html: 'pages/flow_editor.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/flow_controller.js', 'js/pages/flow_editor.js'] },
        // 状态机编辑器 (层级状态机)
        state_machine_editor: { module: () => window.HSM, html: 'pages/state_machine_editor.html', scripts: ['js/pages/hsm_editor.js'] },
        // 状态机编辑器V2 (画布优先)
        state_machine_editor_v2: { module: () => window.SME2, html: 'pages/state_machine_editor_v2.html', scripts: ['js/state_machine_editor_v2.js'] },
        // UI开发工作室
        ui_dev_studio: { module: () => window.UIDevStudio, html: 'pages/ui_dev_studio.html', scripts: [
            'js/device_config_manager.js', 'js/lcd_runtime.js', 'js/flow_controller.js',
            'js/code_generator.js', 'js/code_generator_v2.js', 'js/code_generator_v4.js',
            'js/formula_compiler.js', 'js/builtin_functions.js', 'js/function_engine.js',
            'js/code_generator_v5.js', 'js/ui_dev_studio.js'
        ] },
        // UI自动化测试工作台
        ui_test_workbench: { module: () => window.UITestWorkbench, html: 'pages/ui_test_workbench.html', scripts: ['js/device_config_manager.js', 'js/lcd_runtime.js', 'js/ui_test_lib.js', 'js/ui_test_workbench.js'] },
        // 测试数据
        test_data: { module: () => window.TestDataPage, html: 'pages/test_data.html', scripts: ['js/lib/chart.min.js', 'js/pages/test_data.js'] },
        // 追溯统计
        traceability: { module: () => window.TraceabilityPage, html: 'pages/traceability.html', scripts: ['js/lib/chart.min.js', 'js/pages/traceability.js'] },
        // 任务中心
        task_center: { module: () => window.TaskCenterPage, html: 'pages/task_center.html', scripts: ['js/pages/task_center.js'] },
        // 代码生成器
        code_generator: { module: null, html: 'pages/code_generator.html', scripts: [
            'js/device_config_manager.js', 'js/lcd_runtime.js',
            'js/code_generator.js', 'js/code_generator_v2.js', 'js/code_generator_v4.js',
            'js/formula_compiler.js', 'js/builtin_functions.js', 'js/function_engine.js',
            'js/code_generator_v5.js'
        ] },
        // 产品配置
        product_config: { module: () => window.ProductConfigPage, html: 'pages/product_config.html', scripts: ['js/product_config.js'] },
    },
    
    _withAssetVersion(path) {
        const version = window.__assetVersion || '';
        if (!version) return path;
        return path.includes('?') ? `${path}&v=${encodeURIComponent(version)}` : `${path}?v=${encodeURIComponent(version)}`;
    },
    
    /**
     * 动态加载JS脚本（带缓存，不重复加载）
     */
    _loadScript(src) {
        const resolvedSrc = this._withAssetVersion(src);
        if (this._loadedScripts[resolvedSrc]) return this._loadedScripts[resolvedSrc];
        const promise = new Promise((resolve, reject) => {
            // 检查是否已经在DOM中
            if (document.querySelector(`script[src="${resolvedSrc}"]`) || document.querySelector(`script[data-src-base="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = resolvedSrc;
            script.dataset.srcBase = src;
            script.onload = () => { console.info('[App] script loaded:', resolvedSrc); resolve(); };
            script.onerror = () => { console.warn('Failed to load:', resolvedSrc); resolve(); };
            document.head.appendChild(script);
        });
        this._loadedScripts[resolvedSrc] = promise;
        return promise;
    },
    
    /**
     * 按顺序加载页面所需的JS脚本
     */
    async _loadPageScripts(pageName) {
        const config = this.pages[pageName];
        if (!config || !config.scripts || config.scripts.length === 0) return;
        // 按顺序加载（保证依赖顺序）
        for (const src of config.scripts) {
            await this._loadScript(src);
        }
    },
    
    async init() {
        console.log('App initializing...');
        await API.waitReady();
        console.log('API ready');
        
        // 初始化主题
        await this.initTheme();

        // 初始化特效强度（Pro/Show）
        await this.initFxMode();

        // 初始化字体/字号（确保启动即恢复上次保存的值）
        await this.initTypography();

        // 初始化减少动效（全站生效）
        await this.initReduceMotion();
        
        // 恢复上次访问的页面
        const lastPage = this.getLastPage();
        await this.navigate(lastPage);
        
        // 页面关闭前保存当前输入
        window.addEventListener('beforeunload', () => {
            if (this.currentPageName) {
                this.savePageInputs(this.currentPageName);
            }
        });
        
        // 定期自动保存（每30秒）
        setInterval(() => {
            if (this.currentPageName) {
                this.savePageInputs(this.currentPageName);
            }
        }, 30000);
    },
    
    /**
     * 获取上次访问的页面
     */
    getLastPage() {
        try {
            const saved = localStorage.getItem('kiro_state_last_page');
            // 验证页面是否存在
            if (saved && this.pages[saved]) {
                return saved;
            }
        } catch (e) {}
        return 'home';
    },
    
    /**
     * 保存当前页面
     */
    saveLastPage(pageName) {
        try {
            localStorage.setItem('kiro_state_last_page', pageName);
        } catch (e) {}
    },
    
    /**
     * 保存页面输入框值
     */
    savePageInputs(pageName) {
        const pageEl = document.getElementById(pageName) || document.getElementById(`dynamic-${pageName}`);
        if (!pageEl) return;
        
        const inputs = {};
        // 保存 input, select, textarea 的值
        pageEl.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.id) {
                if (el.type === 'checkbox' || el.type === 'radio') {
                    inputs[el.id] = el.checked;
                } else {
                    inputs[el.id] = el.value;
                }
            }
        });
        
        if (Object.keys(inputs).length > 0) {
            this._inputCache[pageName] = inputs;
            // 保存到 localStorage 以便重启后恢复
            try {
                localStorage.setItem(`page_inputs_${pageName}`, JSON.stringify(inputs));
            } catch (e) {}
        }
    },
    
    /**
     * 恢复页面输入框值
     */
    restorePageInputs(pageName) {
        // 延迟执行，确保页面DOM已渲染
        setTimeout(() => {
            const pageEl = document.getElementById(pageName) || document.getElementById(`dynamic-${pageName}`);
            if (!pageEl) return;
            
            // 优先从内存缓存读取，其次从 localStorage
            let inputs = this._inputCache[pageName];
            if (!inputs) {
                try {
                    const saved = localStorage.getItem(`page_inputs_${pageName}`);
                    if (saved) {
                        inputs = JSON.parse(saved);
                        this._inputCache[pageName] = inputs;
                    }
                } catch (e) {}
            }
            
            if (!inputs) return;
            
            // 恢复值
            Object.entries(inputs).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) {
                    // 跳过 file 类型的 input，不能程序设置值
                    if (el.type === 'file') {
                        return;
                    }
                    if (el.type === 'checkbox' || el.type === 'radio') {
                        el.checked = value;
                    } else {
                        el.value = value;
                    }
                }
            });
        }, 100);
    },
    
    async initTheme() {
        try {
            // 优先从后端获取设置
            const settings = await API.settings.getAll();
            this._settingsCache = settings || {};
            const theme = settings.ui_theme || localStorage.getItem('ui_theme') || 'aurora';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('ui_theme', theme);
            console.log('UI Theme loaded:', theme);
        } catch (e) {
            // 后端失败时从localStorage读取
            const theme = localStorage.getItem('ui_theme') || 'aurora';
            document.documentElement.setAttribute('data-theme', theme);
        }
    },

    async initFxMode() {
        const root = document.documentElement;
        const s = this._settingsCache || {};
        const fx = (s.ui_fx || localStorage.getItem('ui_fx') || 'pro');
        const fxNorm = (fx === 'show' ? 'show' : 'pro');
        root.setAttribute('data-fx', fxNorm);
        localStorage.setItem('ui_fx', fxNorm);
        try {
            await API.settings.set('ui_fx', fxNorm);
        } catch (e) {
            // 后端失败不影响前端
        }
    },

    async initTypography() {
        const root = document.documentElement;

        // settings 优先：后端 -> localStorage -> 默认
        const s = this._settingsCache || {};

        const fontFamily = s.ui_font_family || localStorage.getItem('ui_font_family') || 'default';
        const fontScale = parseInt((s.ui_font_scale ?? localStorage.getItem('ui_font_scale') ?? '100'), 10);

        // 字体映射（与 settings.js 保持一致）
        const fontMap = {
            'default': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif",
            'source-han': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif",
            'zcool': '"ZCOOL KuaiLe", "Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'lxgw': '"LXGW WenKai", "Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'system': '"Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'cn': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', system-ui, sans-serif",
            'mono': "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
        };
        const fontStack = fontMap[fontFamily] || fontMap.default;
        root.style.setProperty('--font-ui', fontStack);
        root.style.setProperty('--font-family-base', fontStack);
        localStorage.setItem('ui_font_family', fontFamily);

        // 字号缩放（百分比）
        const p = Math.max(70, Math.min(160, Number.isFinite(fontScale) ? fontScale : 100));
        const base = { sm: 12, base: 13, lg: 14, xl: 16 };
        const factor = p / 100;
        const px = (n) => `${Math.round(n * factor)}px`;
        root.style.setProperty('--font-size-sm', px(base.sm));
        root.style.setProperty('--font-size-base', px(base.base));
        root.style.setProperty('--font-size-lg', px(base.lg));
        root.style.setProperty('--font-size-xl', px(base.xl));
        localStorage.setItem('ui_font_scale', String(p));
    },

    async initReduceMotion() {
        const root = document.documentElement;
        const s = this._settingsCache || {};
        const reduce = !!(s.reduce_motion ?? (localStorage.getItem('reduce_motion') === 'true'));
        root.dataset.reduceMotion = reduce ? '1' : '0';
        localStorage.setItem('reduce_motion', reduce ? 'true' : 'false');
    },
    
    async loadPageHtml(pageName) {
        const config = this.pages[pageName];
        if (!config || !config.html) return null;
        
        if (this.loadedPages[pageName]) {
            return this.loadedPages[pageName];
        }
        
        try {
            const response = await fetch(this._withAssetVersion(config.html), { cache: 'no-store' });
            if (response.ok) {
                const html = await response.text();
                this.loadedPages[pageName] = html;
                return html;
            }
        } catch (e) {
            console.error(`加载页面 ${pageName} 失败:`, e);
        }
        return null;
    },
    
    async navigate(pageName) {
        if (this.currentPageName === pageName) return;
        
        // 保存当前页面的输入框值
        if (this.currentPageName) {
            this.savePageInputs(this.currentPageName);
        }
        
        // 更新导航状态
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });

        if (this.currentPage && this.currentPage.deactivate) {
            try {
                await this.currentPage.deactivate();
            } catch (e) {
                console.warn('页面停用失败:', e);
            }
        }

        if (this.currentPage && this.currentPage.destroy) {
            try {
                this.currentPage.destroy();
            } catch (e) {
                console.warn('页面销毁失败:', e);
            }
        }
        
        const container = document.getElementById('page-container');
        if (!container) {
            console.error('找不到页面容器');
            return;
        }
        
        const config = this.pages[pageName];
        let newPage = null;
        
        // 按需加载页面所需的JS脚本（首次导航时才下载）
        if (config) {
            await this._loadPageScripts(pageName);
        }
        
        // 先准备新页面（不显示）
        if (config && config.html) {
            let dynamicPage = document.getElementById(`dynamic-${pageName}`);
            if (!dynamicPage) {
                const html = await this.loadPageHtml(pageName);
                if (html) {
                    dynamicPage = document.createElement('section');
                    dynamicPage.id = `dynamic-${pageName}`;
                    dynamicPage.className = 'page';
                    dynamicPage.innerHTML = html;
                    container.appendChild(dynamicPage);
                    
                    // 手动执行插入的脚本（innerHTML 不会自动执行 script）
                    const scripts = dynamicPage.querySelectorAll('script');
                    const scriptPromises = [];
                    
                    scripts.forEach(oldScript => {
                        const newScript = document.createElement('script');
                        // 复制属性
                        Array.from(oldScript.attributes).forEach(attr => {
                            newScript.setAttribute(attr.name, attr.value);
                        });
                        
                        // 如果是外部脚本（有src属性），需要等待加载完成
                        if (oldScript.src) {
                            const loadPromise = new Promise((resolve, reject) => {
                                newScript.onload = resolve;
                                newScript.onerror = () => {
                                    console.warn('Failed to load script:', oldScript.src);
                                    resolve(); // 即使失败也继续
                                };
                            });
                            scriptPromises.push(loadPromise);
                        } else {
                            // 内联脚本，复制内容
                            newScript.textContent = oldScript.textContent;
                        }
                        
                        oldScript.parentNode.replaceChild(newScript, oldScript);
                    });
                    
                    // 等待所有外部脚本加载完成
                    if (scriptPromises.length > 0) {
                        await Promise.all(scriptPromises);
                    }
                    
                    // 等待脚本执行完成（给一个微任务的时间）
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
            newPage = dynamicPage;
        } else {
            newPage = document.getElementById(pageName);
        }
        
        // 新页面准备好后，再切换（避免闪屏）
        if (newPage) {
            // 隐藏所有页面
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            // 显示新页面
            newPage.classList.add('active');
            
            // 强制重绘，修复 WebView 渲染问题
            newPage.style.display = 'none';
            newPage.offsetHeight; // 触发重排
            newPage.style.display = '';
        }
        
        this.currentPageName = pageName;
        
        // 保存当前页面（用于下次启动恢复）
        this.saveLastPage(pageName);
        
        // 初始化页面模块
        if (config && config.module) {
            const pageModule = config.module();
            console.log(`[App] 页面模块: ${pageName}`, pageModule);
            if (pageModule && pageModule.init) {
                this.currentPage = pageModule;
                await pageModule.init();
            } else {
                console.warn(`[App] 页面模块无效或没有init方法: ${pageName}`);
            }
        } else {
            this.currentPage = null;
        }
        
        // 恢复页面输入框值
        this.restorePageInputs(pageName);
        
        console.log(`Navigated to: ${pageName}`);
    }
};

// CRC点击跳转到Vault查找（可传入CRC值，或自动读顶部栏）
App.vaultLookupCRC = async function(crcValue) {
    let crc = crcValue || '';
    if (!crc) {
        const crcEl = document.getElementById('hub-dev-crc');
        crc = crcEl ? crcEl.textContent.trim() : '';
    }
    if (!crc || crc === '--') return;

    // 跳转到vault页面
    await App.navigate('vault');
    // 等页面加载
    await new Promise(r => setTimeout(r, 300));
    // 填入CRC并搜索
    const input = document.getElementById('vault-crc-search');
    if (input) {
        input.value = crc;
        if (window.VaultPage) VaultPage.searchCRC();
    }
};

// 全局导航函数
function switchPage(pageName) {
    App.navigate(pageName);
}

// 折叠/展开导航文件夹
function toggleFolder(headerEl) {
    const folder = headerEl.parentElement;
    folder.classList.toggle('open');
    
    // 更新箭头
    const arrow = headerEl.querySelector('.folder-arrow');
    if (arrow) {
        arrow.textContent = folder.classList.contains('open') ? '▼' : '▶';
    }
}

// 收起/展开侧边栏
function toggleSidebar() {
    console.log('toggleSidebar called');
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) {
        console.error('sidebar element not found');
        return;
    }
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-hidden', isCollapsed);
    console.log('Sidebar collapsed:', isCollapsed);
    const toggleBtn = document.querySelector('.sidebar-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? '▶' : '◀';
    }
    
    // 保存状态
    localStorage.setItem('sidebar_collapsed', isCollapsed);
}

// 初始化侧边栏状态
function initSidebar() {
    const collapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (collapsed) {
        document.getElementById('sidebar')?.classList.add('collapsed');
        document.body.classList.add('sidebar-hidden');
    }
    const toggleBtn = document.querySelector('.sidebar-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = collapsed ? '▶' : '◀';
    }
}

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    if (window.pywebview) {
        App.init();
    } else {
        window.addEventListener('pywebviewready', () => App.init());
    }
});

window.App = App;
window.switchPage = switchPage;
window.toggleSidebar = toggleSidebar;
window.toggleFolder = toggleFolder;
