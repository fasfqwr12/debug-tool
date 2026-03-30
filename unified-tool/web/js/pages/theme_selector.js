// 主题选择器页面模块
const ThemeSelectorPage = {
    selectedTheme: null,
    fxMode: null,
    _bound: false,
    
    // 主题名称映射
    themeNames: {
        'dracula': '🧛 Dracula 吸血鬼',
        'tokyo-night': '🗼 Tokyo Night 东京夜',
        'nord': '🏔️ Nord 北极',
        'rose-pine': '🌹 Rose Pine 玫瑰松',
        'synthwave': '🎹 Synthwave 合成波',
        'neon-blade': '⚔️ Neon Blade 霓虹刀锋',
        'aurora': '🌌 Aurora 极光',
        'industrial-pro': '🏭 Industrial Pro',
        'midnight-glass': '🌙 Midnight Glass',
        'matrix-terminal': '💻 Matrix Terminal',
        'carbon-premium': '💎 Carbon Premium',
        'arctic-clean': '❄️ Arctic Clean',
        'cyber': '🌃 赛博朋克',
        'glass': '💜 玻璃拟态',
        'ocean': '🌊 深海科技',
        'mars': '🔴 火星殖民',
        'gold': '💰 黄金奢华',
        'neon': '💜 霓虹紫',
        'matrix': '💻 矩阵绿',
        'glacier': '❄️ 冰川蓝',
        'sunset': '🌅 日落橙',
        'enterprise-light': '🏢 Enterprise Light 企业白灰',
        'cloud-blue': '☁️ Cloud Blue 云雾蓝',
        'ice-mint': '🩺 Ice Mint 医疗青',
        'slate-light': '🧱 Slate Light 石墨浅灰',
        'lite': '🚀 Lite 简约深色',
        'lite-dark': '🚀 Lite 简约深色',
        'lite-light': '🚀 Lite 简约浅色'
    },
    
    async init() {
        console.log('ThemeSelectorPage initialized');
        // 加载已保存的主题（统一使用 ui_theme；优先后端）
        try {
            const settings = await API.settings.getAll();
            const theme = settings.ui_theme || localStorage.getItem('ui_theme') || 'aurora';
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('ui_theme', theme);
            this.selectedTheme = theme;

            const fx = settings.ui_fx || localStorage.getItem('ui_fx') || 'pro';
            this.applyFxMode(fx);
        } catch (e) {
            const saved = localStorage.getItem('ui_theme') || 'aurora';
            document.documentElement.setAttribute('data-theme', saved);
            this.selectedTheme = saved;

            const fx = localStorage.getItem('ui_fx') || 'pro';
            this.applyFxMode(fx);
        }
        this.bindEvents();
        this.updateCurrentThemeDisplay();
        this.highlightSelected();
    },
    
    bindEvents() {
        if (this._bound) return;
        this._bound = true;
        // 给主题卡片绑定点击事件
        document.querySelectorAll('.theme-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const theme = card.dataset.theme;
                if (theme) this.applyTheme(theme);
            });
        });

        // Pro/Show 强度切换（可选：页面不存在也不报错）
        const fxPro = document.getElementById('fx-mode-pro');
        const fxShow = document.getElementById('fx-mode-show');
        if (fxPro) fxPro.addEventListener('click', () => this.setFxMode('pro'));
        if (fxShow) fxShow.addEventListener('click', () => this.setFxMode('show'));
    },

    applyFxMode(mode) {
        const m = (mode === 'show' ? 'show' : 'pro');
        this.fxMode = m;
        document.documentElement.setAttribute('data-fx', m);
        localStorage.setItem('ui_fx', m);

        const fxPro = document.getElementById('fx-mode-pro');
        const fxShow = document.getElementById('fx-mode-show');
        if (fxPro) fxPro.classList.toggle('active', m === 'pro');
        if (fxShow) fxShow.classList.toggle('active', m === 'show');
    },

    async setFxMode(mode) {
        this.applyFxMode(mode);
        try {
            await API.settings.set('ui_fx', this.fxMode);
        } catch (e) {
            // 后端失败不阻塞
        }
        if (window.Utils) {
            Utils.toast(`特效强度已切换到 ${this.fxMode === 'show' ? 'Show(展示)' : 'Pro(专业)'} 模式`, 'info');
        }
    },
    
    async applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('ui_theme', theme);
        this.selectedTheme = theme;

        // 同步到后端（保证重启/跨端一致）
        try {
            await API.settings.set('ui_theme', theme);
        } catch (e) {
            // 后端失败不阻塞前端切换
        }

        this.highlightSelected();
        
        this.updateCurrentThemeDisplay();
        
        if (window.Utils) {
            Utils.toast(`已切换到 ${this.themeNames[theme] || theme} 主题`, 'success');
        }
    },

    highlightSelected() {
        const theme = this.selectedTheme;
        document.querySelectorAll('.theme-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.theme === theme);
        });
    },
    
    updateCurrentThemeDisplay() {
        const el = document.getElementById('current-theme-name');
        if (el && this.selectedTheme) {
            el.textContent = this.themeNames[this.selectedTheme] || this.selectedTheme;
        }
    },
    
    selectTheme(theme) {
        this.applyTheme(theme);
    }
};

// 全局暴露
window.ThemeSelectorPage = ThemeSelectorPage;

// 全局函数供 HTML onclick 调用
window.applyTheme = function(theme) {
    ThemeSelectorPage.applyTheme(theme);
};
