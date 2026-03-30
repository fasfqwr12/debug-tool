/**
 * 工具函数模块
 */

const Utils = {
    _lastToastKey: null,
    _lastToastAt: 0,

    // 格式化时间
    formatTime(date = new Date()) {
        return date.toLocaleTimeString('zh-CN', { hour12: false });
    },
    
    // 格式化日期时间
    formatDateTime(date = new Date()) {
        return date.toLocaleString('zh-CN');
    },
    
    // 防抖
    debounce(fn, delay = 300) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },
    
    // 节流
    throttle(fn, interval = 100) {
        let lastTime = 0;
        return function(...args) {
            const now = Date.now();
            if (now - lastTime >= interval) {
                lastTime = now;
                fn.apply(this, args);
            }
        };
    },
    
    // 简单的模板渲染
    template(html, data) {
        return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return data[key] !== undefined ? data[key] : match;
        });
    },
    
    // 显示 Toast 提示
    toast(message, type = 'info', duration = 3000) {
        // 防止由于重复事件触发导致的双弹（短时间内同文案同类型只弹一次）
        const key = `${type}::${String(message)}`;
        const now = Date.now();
        if (this._lastToastKey === key && (now - this._lastToastAt) < 500) {
            return;
        }
        this._lastToastKey = key;
        this._lastToastAt = now;

        this._ensureSingleToastContainer();
        const container = document.getElementById('toast-container') || this._createToastContainer();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${this._getToastIcon(type)}</span>
            <span class="toast-message">${message}</span>
        `;
        
        container.appendChild(toast);
        
        // 动画入场
        requestAnimationFrame(() => toast.classList.add('show'));
        
        // 自动移除
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    _ensureSingleToastContainer() {
        const containers = document.querySelectorAll('#toast-container');
        if (!containers || containers.length <= 1) return;

        const primary = containers[0];
        for (let i = 1; i < containers.length; i++) {
            const extra = containers[i];
            while (extra.firstChild) {
                primary.appendChild(extra.firstChild);
            }
            extra.remove();
        }
    },
    
    _createToastContainer() {
        const container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
        return container;
    },
    
    _getToastIcon(type) {
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        return icons[type] || icons.info;
    },
    
    // 确认对话框
    async confirm(message, title = '确认') {
        return new Promise(resolve => {
            const result = window.confirm(`${title}\n\n${message}`);
            resolve(result);
        });
    },
    
    // 输入对话框
    async prompt(message, defaultValue = '') {
        return new Promise(resolve => {
            const result = window.prompt(message, defaultValue);
            resolve(result);
        });
    }
};

// 批量DOM更新（避免频繁reflow）
Utils.batchRender = function(container, htmlArray, chunkSize = 50) {
    const frag = document.createDocumentFragment();
    const temp = document.createElement('div');
    
    htmlArray.forEach((html, i) => {
        temp.innerHTML = html;
        while (temp.firstChild) {
            frag.appendChild(temp.firstChild);
        }
    });
    
    container.innerHTML = '';
    container.appendChild(frag);
};

// 增量渲染长列表（分批避免卡顿）
Utils.renderInChunks = function(container, items, renderFn, chunkSize = 30) {
    container.innerHTML = '';
    let index = 0;
    
    function renderChunk() {
        const frag = document.createDocumentFragment();
        const end = Math.min(index + chunkSize, items.length);
        
        for (; index < end; index++) {
            const el = renderFn(items[index], index);
            if (typeof el === 'string') {
                const temp = document.createElement('div');
                temp.innerHTML = el;
                while (temp.firstChild) frag.appendChild(temp.firstChild);
            } else if (el) {
                frag.appendChild(el);
            }
        }
        
        container.appendChild(frag);
        
        if (index < items.length) {
            requestAnimationFrame(renderChunk);
        }
    }
    
    renderChunk();
};

window.Utils = Utils;
