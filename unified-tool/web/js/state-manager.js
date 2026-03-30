/**
 * 统一状态管理器 - 记忆用户输入和界面状态
 * 支持自动保存/恢复表单输入、下拉框选择、页面状态等
 */

const StateManager = {
    // 存储键前缀
    PREFIX: 'kiro_state_',
    
    // 当前页面名称
    currentPage: null,
    
    // 防抖定时器
    _saveTimers: {},
    
    /**
     * 初始化页面状态管理
     * @param {string} pageName - 页面名称
     * @param {object} options - 配置选项
     */
    init(pageName, options = {}) {
        this.currentPage = pageName;
        console.log(`[StateManager] 初始化页面: ${pageName}`);
        
        // 恢复状态
        this.restore(pageName);
        
        // 自动绑定带 data-remember 属性的元素
        if (options.autoBind !== false) {
            this.bindAutoSave(pageName);
        }
    },
    
    /**
     * 获取存储键
     */
    getKey(pageName, field) {
        return `${this.PREFIX}${pageName}_${field}`;
    },
    
    /**
     * 保存单个字段
     */
    save(pageName, field, value) {
        const key = this.getKey(pageName, field);
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn(`[StateManager] 保存失败: ${key}`, e);
        }
    },
    
    /**
     * 读取单个字段
     */
    load(pageName, field, defaultValue = null) {
        const key = this.getKey(pageName, field);
        try {
            const stored = localStorage.getItem(key);
            if (stored !== null) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.warn(`[StateManager] 读取失败: ${key}`, e);
        }
        return defaultValue;
    },
    
    /**
     * 保存整个页面状态
     */
    savePageState(pageName, state) {
        const key = `${this.PREFIX}${pageName}`;
        try {
            localStorage.setItem(key, JSON.stringify(state));
        } catch (e) {
            console.warn(`[StateManager] 保存页面状态失败: ${pageName}`, e);
        }
    },
    
    /**
     * 读取整个页面状态
     */
    loadPageState(pageName) {
        const key = `${this.PREFIX}${pageName}`;
        try {
            const stored = localStorage.getItem(key);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.warn(`[StateManager] 读取页面状态失败: ${pageName}`, e);
        }
        return {};
    },
    
    /**
     * 自动绑定带 data-remember 属性的元素
     * 用法: <input data-remember="fieldName" ...>
     */
    bindAutoSave(pageName) {
        const elements = document.querySelectorAll('[data-remember]');
        elements.forEach(el => {
            const field = el.getAttribute('data-remember');
            if (!field) return;
            
            // 恢复值
            const savedValue = this.load(pageName, field);
            if (savedValue !== null) {
                this.setElementValue(el, savedValue);
            }
            
            // 绑定变化事件
            const eventType = this.getEventType(el);
            el.addEventListener(eventType, () => {
                this.debounceSave(pageName, field, this.getElementValue(el));
            });
        });
    },
    
    /**
     * 恢复页面状态
     */
    restore(pageName) {
        const elements = document.querySelectorAll('[data-remember]');
        elements.forEach(el => {
            const field = el.getAttribute('data-remember');
            if (!field) return;
            
            const savedValue = this.load(pageName, field);
            if (savedValue !== null) {
                this.setElementValue(el, savedValue);
            }
        });
    },
    
    /**
     * 防抖保存
     */
    debounceSave(pageName, field, value, delay = 300) {
        const key = `${pageName}_${field}`;
        if (this._saveTimers[key]) {
            clearTimeout(this._saveTimers[key]);
        }
        this._saveTimers[key] = setTimeout(() => {
            this.save(pageName, field, value);
        }, delay);
    },
    
    /**
     * 获取元素值
     */
    getElementValue(el) {
        if (el.type === 'checkbox') {
            return el.checked;
        } else if (el.type === 'radio') {
            const name = el.name;
            const checked = document.querySelector(`input[name="${name}"]:checked`);
            return checked ? checked.value : null;
        } else {
            return el.value;
        }
    },
    
    /**
     * 设置元素值
     */
    setElementValue(el, value) {
        if (el.type === 'checkbox') {
            el.checked = !!value;
        } else if (el.type === 'radio') {
            if (el.value === value) {
                el.checked = true;
            }
        } else {
            el.value = value;
        }
    },
    
    /**
     * 获取元素的事件类型
     */
    getEventType(el) {
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'select') return 'change';
        if (el.type === 'checkbox' || el.type === 'radio') return 'change';
        return 'input';
    },
    
    /**
     * 记忆上次访问的页面
     */
    saveLastPage(pageName) {
        try {
            localStorage.setItem(`${this.PREFIX}last_page`, pageName);
        } catch (e) {}
    },
    
    /**
     * 获取上次访问的页面
     */
    getLastPage() {
        try {
            return localStorage.getItem(`${this.PREFIX}last_page`) || 'home';
        } catch (e) {
            return 'home';
        }
    },
    
    /**
     * 清除页面状态
     */
    clearPageState(pageName) {
        const prefix = `${this.PREFIX}${pageName}`;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },
    
    /**
     * 清除所有状态
     */
    clearAll() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }
};

// 导出到全局
window.StateManager = StateManager;
