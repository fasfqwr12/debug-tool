/**
 * 段码LCD模拟器 - 支持配置化渲染
 * 
 * 两种模式:
 * 1. 状态模式 (updateFromFirmware) - 从固件JSON状态更新，兼容旧代码
 * 2. 缓冲区模式 (updateFromBuffer) - 从54字节LCD缓冲区渲染，根据元素配置解析
 */
const LCDSimulator = {
    canvas: null,
    ctx: null,
    width: 340,
    height: 190,
    
    // 元素配置 (从 lcd_elements/xxx.json 加载)
    config: null,
    configLoaded: false,
    
    // LCD缓冲区 (54字节)
    segBuffer: new Uint8Array(54),
    
    // 7段数码管编码 (abcdefg) - 标准编码
    DIGITS: {
        '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66,
        '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F,
        '-': 0x40, ' ': 0x00, 'E': 0x79, 'r': 0x50, 'o': 0x5C,
    },
    
    // 反向查找: 段码值 → 字符
    DIGITS_REVERSE: {},
    
    // 状态 (兼容旧模式)
    state: {
        battery: 3, signal: 3, beep: true, laser: false,
        mode: 0, base: 1, unit: 0,
        line1: '', line2: '', line3: '', line4: '-----',
    },
    
    colors: {
        bg: '#0c1821',
        segOn: '#00e676',
        segOff: '#0d2818',
    },
    
    // 渲染模式: 'state' 或 'buffer'
    renderMode: 'state',
    
    // 渲染完成回调
    _onRenderCallback: null,
    
    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return false;
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) return false;
        
        // 构建反向查找表
        Object.entries(this.DIGITS).forEach(([ch, code]) => {
            this.DIGITS_REVERSE[code] = ch;
        });
        
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.scale(dpr, dpr);
        
        this.render();
        return true;
    },
    
    isInitialized() { return this.canvas && this.ctx; },
    
    onRender(callback) { this._onRenderCallback = callback; },
    
    // ==================== 配置加载 ====================
    
    async loadConfig(device = 'gd303_mini') {
        try {
            // 尝试从API加载
            const resp = await fetch('/api/call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'lcd_config_get', params: [device] })
            });
            const result = await resp.json();
            if (result.success && result.config) {
                this.config = result.config;
                this.configLoaded = true;
                console.log('[LCD] 配置加载成功:', device);
                return true;
            }
        } catch (e) {
            console.warn('[LCD] API加载失败，尝试本地文件');
        }
        
        // 尝试从本地文件加载
        try {
            const resp = await fetch(`/js/lcd_elements/${device}.json`);
            if (resp.ok) {
                this.config = await resp.json();
                this.configLoaded = true;
                console.log('[LCD] 本地配置加载成功:', device);
                return true;
            }
        } catch (e) {
            console.error('[LCD] 配置加载失败:', e);
        }
        
        return false;
    },
    
    // ==================== 缓冲区模式 ====================
    
    /**
     * 从54字节LCD缓冲区更新显示
     * @param {Uint8Array|Array} buffer - 54字节缓冲区
     */
    updateFromBuffer(buffer) {
        if (!this.isInitialized()) return;
        if (!buffer || buffer.length < 54) {
            console.warn('[LCD] 缓冲区数据无效');
            return;
        }
        
        this.segBuffer = new Uint8Array(buffer);
        this.renderMode = 'buffer';
        
        // 如果有配置，解析缓冲区到状态
        if (this.configLoaded) {
            this.parseBufferToState();
        }
        
        this.render();
        this._triggerCallback();
    },
    
    /**
     * 根据配置解析缓冲区到状态
     */
    parseBufferToState() {
        if (!this.config || !this.config.elements) return;
        
        const elements = this.config.elements;
        const comBitMap = this.config.comBitMapping || {
            COM0: 7, COM1: 6, COM2: 5, COM3: 4, COM4: 3, COM5: 2, COM6: 1, COM7: 0
        };
        
        // 解析数字行 (传入完整的行配置，包含positions和decimalPoints)
        ['line1', 'line2', 'line3', 'line4'].forEach(lineName => {
            const lineConfig = elements.digits?.[lineName];
            if (lineConfig) {
                const digits = this.parseDigitLine(lineConfig, comBitMap);
                // 尝试转换为数字
                const num = parseFloat(digits);
                this.state[lineName] = isNaN(num) ? digits : num;
            }
        });
        
        // 解析图标
        if (elements.icons) {
            // 电池
            if (elements.icons.battery) {
                this.state.battery = this.parseBatteryLevel(elements.icons.battery, comBitMap);
            }
            // 信号
            if (elements.icons.signal) {
                this.state.signal = this.parseSignalLevel(elements.icons.signal, comBitMap);
            }
            // 蜂鸣器
            if (elements.icons.beep) {
                const beepOn = elements.icons.beep.segments?.find(s => s.id === 'beep_on');
                if (beepOn) {
                    this.state.beep = this.isSegmentOn(beepOn.seg, beepOn.com);
                }
            }
        }
        
        // 解析基准模式
        if (elements.base) {
            this.state.base = this.parseBaseMode(elements.base, comBitMap);
        }
        
        // 解析测量模式
        if (elements.measureMode) {
            this.state.mode = this.parseMeasureMode(elements.measureMode, comBitMap);
        }
    },
    
    /**
     * 解析基准模式
     */
    parseBaseMode(config, comBitMap) {
        if (!config.modes) return 1; // 默认后基准
        
        // 检查哪些段亮着
        const litSegments = new Set();
        for (const seg of (config.segments || [])) {
            if (this.isSegmentOn(seg.seg, seg.com)) {
                litSegments.add(seg.id);
            }
        }
        
        // 匹配模式
        for (const [modeName, modeSegs] of Object.entries(config.modes)) {
            const match = modeSegs.every(segId => litSegments.has(segId));
            if (match && modeSegs.length === litSegments.size) {
                // 简化返回: 前基准=0, 后基准=1
                if (modeName.includes('F_F') || modeName.includes('F_B')) return 0;
                if (modeName.includes('B_F') || modeName.includes('B_B')) return 1;
            }
        }
        
        return 1; // 默认后基准
    },
    
    /**
     * 解析测量模式
     */
    parseMeasureMode(config, comBitMap) {
        if (!config.modes) return 0; // 默认单次
        
        // 检查哪些段亮着
        const litSegments = new Set();
        for (const seg of (config.segments || [])) {
            if (this.isSegmentOn(seg.seg, seg.com)) {
                litSegments.add(seg.id);
            }
        }
        
        // 如果没有任何段亮，是单次模式
        if (litSegments.size === 0) return 0;
        
        // 匹配模式
        const modeMap = { 'AREA': 1, 'VOLUME': 2, 'PYTH1': 3, 'PYTH2': 4, 'PYTH3': 5 };
        for (const [modeName, modeSegs] of Object.entries(config.modes)) {
            const match = modeSegs.every(segId => litSegments.has(segId));
            if (match) {
                return modeMap[modeName] || 0;
            }
        }
        
        return 0;
    },
    
    /**
     * 解析一行数字 (包含小数点)
     * @param {Object} lineConfig - 行配置，包含 positions 和 decimalPoints
     * @param {Object} comBitMap - COM位映射
     * @returns {string} 解析出的数字字符串，如 "5.068"
     */
    parseDigitLine(lineConfig, comBitMap) {
        const positions = lineConfig.positions || lineConfig;
        const decimalPoints = lineConfig.decimalPoints || [];
        
        let result = '';
        let dpPositions = new Set(); // 小数点位置 (在第几个数字后面)
        
        // 先检测小数点位置
        for (const dp of decimalPoints) {
            const segIdx = dp.seg;
            const comName = dp.com;
            if (segIdx >= 0 && segIdx < 54) {
                const bitPos = comBitMap[comName];
                if (bitPos !== undefined && (this.segBuffer[segIdx] & (1 << bitPos))) {
                    // 找到这个小数点对应的数字位置
                    for (let i = 0; i < positions.length; i++) {
                        if (positions[i].seg === segIdx) {
                            dpPositions.add(i);
                            break;
                        }
                    }
                }
            }
        }
        
        // 解析每个数字
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const segIdx = pos.seg;
            if (segIdx < 0 || segIdx >= 54) continue;
            
            const segByte = this.segBuffer[segIdx];
            
            // 根据A-G的COM位提取7段码
            let code = 0;
            const segments = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
            segments.forEach((seg, j) => {
                const comName = pos[seg];
                if (comName) {
                    const bitPos = comBitMap[comName];
                    if (bitPos !== undefined && (segByte & (1 << bitPos))) {
                        code |= (1 << j);
                    }
                }
            });
            
            // 查找对应字符
            const ch = this.DIGITS_REVERSE[code] || ' ';
            result += ch;
            
            // 添加小数点
            if (dpPositions.has(i)) {
                result += '.';
            }
        }
        
        return result.trim() || '-----';
    },
    
    /**
     * 解析电池电量
     */
    parseBatteryLevel(config, comBitMap) {
        if (!config.segments) return 3;
        
        let level = 0;
        config.segments.forEach((seg, i) => {
            if (i === 0) return; // 跳过外框
            const bitPos = comBitMap[seg.com];
            if (bitPos !== undefined && (this.segBuffer[seg.seg] & (1 << bitPos))) {
                level++;
            }
        });
        return level;
    },
    
    /**
     * 解析信号强度
     */
    parseSignalLevel(config, comBitMap) {
        if (!config.segments) return 3;
        
        let level = 0;
        config.segments.forEach(seg => {
            const bitPos = comBitMap[seg.com];
            if (bitPos !== undefined && (this.segBuffer[seg.seg] & (1 << bitPos))) {
                level++;
            }
        });
        return level;
    },
    
    /**
     * 检查某个段是否亮
     */
    isSegmentOn(segIdx, comName) {
        if (segIdx < 0 || segIdx >= 54) return false;
        const comBitMap = this.config?.comBitMapping || {
            COM0: 7, COM1: 6, COM2: 5, COM3: 4, COM4: 3, COM5: 2, COM6: 1, COM7: 0
        };
        const bitPos = comBitMap[comName];
        if (bitPos === undefined) return false;
        return !!(this.segBuffer[segIdx] & (1 << bitPos));
    },
    
    // ==================== 状态模式 (兼容旧代码) ====================
    
    updateFromFirmware(s) {
        if (!this.isInitialized() || !s) return;
        
        this.renderMode = 'state';
        
        if (s.battery !== undefined) this.state.battery = s.battery;
        if (s.signal !== undefined) this.state.signal = s.signal;
        if (s.beep !== undefined) this.state.beep = !!s.beep;
        if (s.laser !== undefined) this.state.laser = !!s.laser;
        if (s.mode !== undefined) this.state.mode = s.mode;
        if (s.base !== undefined) this.state.base = s.base;
        if (s.unit !== undefined) this.state.unit = s.unit;
        
        const fmt = (v, isLine4) => {
            if (v === undefined || v === null) return '';
            if (v < 0) return '';
            if (v === 0 && !isLine4) return '';
            return v.toFixed(3);
        };
        
        if (s.line1 !== undefined) this.state.line1 = fmt(s.line1, false);
        if (s.line2 !== undefined) this.state.line2 = fmt(s.line2, false);
        if (s.line3 !== undefined) this.state.line3 = fmt(s.line3, false);
        if (s.line4 !== undefined) this.state.line4 = fmt(s.line4, true);
        
        this.render();
        this._triggerCallback();
    },
    
    _triggerCallback() {
        if (this._onRenderCallback) {
            const callback = this._onRenderCallback;
            requestAnimationFrame(() => callback());
        }
    },

    
    // ==================== 渲染 ====================
    
    render() {
        if (!this.isInitialized()) return;
        const ctx = this.ctx;
        
        // 背景
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, this.width, this.height);
        
        // 边框
        ctx.strokeStyle = '#1a3a2a';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, this.width - 4, this.height - 4);
        
        // 状态栏
        this.drawBattery(10, 10);
        this.drawSignal(50, 10);
        if (this.state.beep) this.drawText('♪', 95, 22, 14);
        
        // 模式图标
        this.drawModeIcon(10, 50);
        
        // 4行数字
        this.drawLine(this.state.line1, 100, 35, 14, 24);
        this.drawLine(this.state.line2, 100, 65, 14, 24);
        this.drawLine(this.state.line3, 100, 95, 14, 24);
        this.drawLine(this.state.line4, 85, 140, 20, 38);
        
        // 单位
        const units = ['m', 'ft', 'in'];
        const unit = units[this.state.unit] || 'm';
        ctx.fillStyle = this.colors.segOn;
        ctx.font = '11px Arial';
        if (this.state.line1) ctx.fillText(unit, 305, 35);
        if (this.state.line2) ctx.fillText(unit, 305, 65);
        if (this.state.line3) ctx.fillText(unit, 305, 95);
        ctx.font = 'bold 16px Arial';
        ctx.fillText(unit, 300, 148);
        
        // 基准图标
        this.drawBaseIcon(10, 155);
    },
    
    drawBattery(x, y) {
        const ctx = this.ctx;
        const on = this.colors.segOn, off = this.colors.segOff;
        const level = this.state.battery;
        
        ctx.strokeStyle = level >= 0 ? on : off;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, 26, 14);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(x + 26, y + 4, 3, 6);
        
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i < level ? on : off;
            ctx.fillRect(x + 2 + i * 8, y + 2, 7, 10);
        }
    },
    
    drawSignal(x, y) {
        const ctx = this.ctx;
        const on = this.colors.segOn, off = this.colors.segOff;
        for (let i = 0; i < 5; i++) {
            const h = 5 + i * 2;
            ctx.fillStyle = i < this.state.signal ? on : off;
            ctx.fillRect(x + i * 6, y + 14 - h, 4, h);
        }
    },
    
    drawText(text, x, y, size, bold) {
        const ctx = this.ctx;
        ctx.fillStyle = this.colors.segOn;
        ctx.font = (bold ? 'bold ' : '') + size + 'px Arial';
        ctx.fillText(text, x, y);
    },
    
    drawModeIcon(x, y) {
        const ctx = this.ctx;
        const on = this.colors.segOn;
        const modes = ['单次', '面积', '体积', '勾股', '勾股', '勾股', '连续'];
        
        ctx.strokeStyle = on;
        ctx.fillStyle = on;
        ctx.lineWidth = 1.5;
        
        switch (this.state.mode) {
            case 1: ctx.strokeRect(x, y, 28, 18); break;
            case 2: 
                ctx.strokeRect(x, y, 28, 18);
                ctx.beginPath();
                ctx.moveTo(x + 6, y); ctx.lineTo(x + 6, y + 18);
                ctx.moveTo(x, y + 6); ctx.lineTo(x + 28, y + 6);
                ctx.stroke();
                break;
            case 6:
                ctx.font = '18px Arial';
                ctx.fillText('∞', x, y + 16);
                break;
            default:
                ctx.beginPath();
                ctx.moveTo(x, y + 9); ctx.lineTo(x + 28, y + 9);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x + 3, y + 9, 3, 0, Math.PI * 2);
                ctx.arc(x + 25, y + 9, 3, 0, Math.PI * 2);
                ctx.fill();
        }
        
        ctx.font = '11px Arial';
        ctx.fillText(modes[this.state.mode] || '单次', x, y + 35);
    },
    
    drawBaseIcon(x, y) {
        const ctx = this.ctx;
        const on = this.colors.segOn;
        
        ctx.strokeStyle = on;
        ctx.fillStyle = on;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, 45, 18);
        
        if (this.state.base === 0) {
            ctx.fillRect(x, y + 5, 5, 8);
            ctx.font = '10px Arial';
            ctx.fillText('前', x + 8, y + 14);
        } else {
            ctx.fillRect(x + 40, y + 5, 5, 8);
            ctx.font = '10px Arial';
            ctx.fillText('后', x + 8, y + 14);
        }
        
        if (this.state.laser) {
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y + 9);
            ctx.lineTo(x - 25, y + 9);
            ctx.stroke();
            
            ctx.fillStyle = '#ff3333';
            ctx.beginPath();
            ctx.arc(x - 28, y + 9, 5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.shadowColor = '#ff3333';
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    },
    
    drawLine(text, x, y, digitW, digitH) {
        const str = text.toString().trim();
        if (!str) return;
        
        let posX = x;
        
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (ch === '.') {
                this.ctx.fillStyle = this.colors.segOn;
                this.ctx.beginPath();
                this.ctx.arc(posX - 2, y + digitH - 4, 2.5, 0, Math.PI * 2);
                this.ctx.fill();
                posX += 6;
            } else {
                this.draw7Seg(posX, y, digitW, digitH, ch);
                posX += digitW + 4;
            }
        }
    },
    
    draw7Seg(x, y, w, h, char) {
        const ctx = this.ctx;
        const code = this.DIGITS[char] ?? 0;
        const on = this.colors.segOn;
        const off = this.colors.segOff;
        
        const sw = Math.max(2, w * 0.15);
        const hh = (h - sw) / 2;
        
        const drawH = (sx, sy, isOn) => {
            ctx.fillStyle = isOn ? on : off;
            ctx.beginPath();
            ctx.moveTo(sx + sw, sy);
            ctx.lineTo(sx + w - sw, sy);
            ctx.lineTo(sx + w - sw/2, sy + sw/2);
            ctx.lineTo(sx + w - sw, sy + sw);
            ctx.lineTo(sx + sw, sy + sw);
            ctx.lineTo(sx + sw/2, sy + sw/2);
            ctx.closePath();
            ctx.fill();
        };
        
        const drawV = (sx, sy, isOn) => {
            ctx.fillStyle = isOn ? on : off;
            ctx.beginPath();
            ctx.moveTo(sx, sy + sw/2);
            ctx.lineTo(sx + sw/2, sy);
            ctx.lineTo(sx + sw, sy + sw/2);
            ctx.lineTo(sx + sw, sy + hh - sw/2);
            ctx.lineTo(sx + sw/2, sy + hh);
            ctx.lineTo(sx, sy + hh - sw/2);
            ctx.closePath();
            ctx.fill();
        };
        
        drawH(x, y, code & 0x01);
        drawV(x + w - sw, y, code & 0x02);
        drawV(x + w - sw, y + hh, code & 0x04);
        drawH(x, y + h - sw, code & 0x08);
        drawV(x, y + hh, code & 0x10);
        drawV(x, y, code & 0x20);
        drawH(x, y + hh - sw/2, code & 0x40);
    },
    
    toDataURL() { return this.canvas?.toDataURL('image/png'); },
    
    // ==================== 获取当前状态 (用于期望验证) ====================
    
    getState() {
        return { ...this.state };
    },
    
    // 获取指定行的数值
    getLineValue(line) {
        const text = this.state[line];
        if (!text || text === '-----' || text === 'Error') return null;
        const num = parseFloat(text);
        return isNaN(num) ? null : num;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LCDSimulator;
}
