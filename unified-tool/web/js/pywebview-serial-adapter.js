/**
 * PyWebview 串口适配器
 * 替代 Web Serial API，使用 Python 后端处理连接
 * 支持 pywebview 和 HTTP API 两种模式
 */

// HTTP API 基础URL
const HTTP_API_BASE = 'http://127.0.0.1:8766';

// HTTP API 调用封装
async function httpApiCall(method, ...params) {
    const response = await fetch(`${HTTP_API_BASE}/api/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

// 创建 HTTP API 代理对象
function createHttpApiProxy() {
    return new Proxy({}, {
        get(target, prop) {
            return (...args) => httpApiCall(prop, ...args);
        }
    });
}

// 获取 pywebview API（支持 iframe 内访问，带 HTTP fallback）
function getApi() {
    // 优先使用当前窗口的 pywebview
    if (window.pywebview && window.pywebview.api) {
        return window.pywebview.api;
    }
    // 尝试访问父窗口的 pywebview（iframe 场景）
    if (window.parent && window.parent.pywebview && window.parent.pywebview.api) {
        return window.parent.pywebview.api;
    }
    // 尝试顶层窗口
    if (window.top && window.top.pywebview && window.top.pywebview.api) {
        return window.top.pywebview.api;
    }
    // Fallback: 使用 HTTP API
    console.info('pywebview API 不可用，使用 HTTP API fallback');
    return createHttpApiProxy();
}

const bt = {
    // 连接状态
    _connected: false,
    _connType: null,
    _onDataCallback: null,
    _onErrorCallback: null,
    _pollTimer: null,
    
    // ========== 串口连接 ==========
    
    async connectSerial(onConnect, onError) {
        try {
            const api = getApi();
            if (!api) { onError && onError('API不可用'); return; }
            
            // 获取串口列表
            const ports = await api.debug_list_ports();
            if (!ports || ports.length === 0) {
                onError('没有可用串口');
                return;
            }
            
            // 弹窗让用户选择串口
            let portList = ports.map((p, i) => `${i + 1}. ${p.device} - ${p.description || '未知设备'}`).join('\n');
            let lastPort = localStorage.getItem('last_serial_port') || '';
            let defaultIdx = ports.findIndex(p => p.device === lastPort);
            if (defaultIdx < 0) defaultIdx = 0;
            
            const input = prompt(`请选择串口 (输入序号 1-${ports.length}):\n\n${portList}`, String(defaultIdx + 1));
            if (!input) {
                onError && onError('用户取消');
                return;
            }
            
            const idx = parseInt(input) - 1;
            if (isNaN(idx) || idx < 0 || idx >= ports.length) {
                onError && onError('无效的选择');
                return;
            }
            
            const port = ports[idx].device;
            localStorage.setItem('last_serial_port', port);
            const baudRate = parseInt(localStorage.getItem('baud_rate') || '115200');
            
            const result = await api.debug_connect(port, baudRate);
            if (result.success) {
                this._connected = true;
                this._connType = 'serial';
                this._startPolling();
                onConnect && onConnect();
            } else {
                onError && onError(result.error || '连接失败');
            }
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    async connectToPort(port, onConnect, onError) {
        try {
            const baudRate = parseInt(localStorage.getItem('baud_rate') || '115200');
            const result = await getApi().debug_connect(port, baudRate);
            if (result.success) {
                this._connected = true;
                this._connType = 'serial';
                this._startPolling();
                onConnect && onConnect();
            } else {
                onError && onError(result.error || '连接失败');
            }
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    // ========== BLE 连接 ==========
    
    async connectBLE(onConnect, onError) {
        try {
            const result = await getApi().debug_connect_ble();
            if (result.success) {
                this._connected = true;
                this._connType = 'ble';
                this._startPolling();
                onConnect && onConnect();
            } else {
                onError && onError(result.error || 'BLE连接失败');
            }
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    // ========== 通用连接（兼容旧接口）==========
    
    async connect(type, onConnect, onError) {
        if (type === 'web-serial') {
            return this.connectSerial(onConnect, onError);
        } else if (type === 'web-bluetooth') {
            return this.connectBLE(onConnect, onError);
        } else {
            onError && onError('未知连接类型: ' + type);
        }
    },
    
    // ========== WiFi/ESP32 连接 ==========
    
    async connectESP32(url, onConnect, onError) {
        try {
            const result = await getApi().debug_connect_wifi(url);
            if (result.success) {
                this._connected = true;
                this._connType = 'esp32';
                this._startPolling();
                onConnect && onConnect();
            } else {
                onError && onError(result.error || 'WiFi连接失败');
            }
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    // ========== 断开连接 ==========
    
    async disconnect(onDisconnect, onError) {
        try {
            this._stopPolling();
            await getApi().debug_disconnect();
            this._connected = false;
            this._connType = null;
            onDisconnect && onDisconnect();
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    // ========== 数据收发 ==========
    
    async write(data, onSuccess, onError) {
        try {
            let hexData;
            if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
                hexData = Array.from(new Uint8Array(data))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            } else if (typeof data === 'string') {
                // 文本转HEX
                hexData = Array.from(new TextEncoder().encode(data))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            } else {
                hexData = data;
            }
            
            const result = await getApi().debug_send(hexData);
            if (result.success) {
                onSuccess && onSuccess();
            } else {
                onError && onError(result.error || '发送失败');
            }
        } catch (e) {
            onError && onError(e.message || e);
        }
    },
    
    onData(callback) {
        this._onDataCallback = callback;
    },
    
    // ========== 轮询接收数据 ==========
    
    _startPolling() {
        if (this._pollTimer) return;
        
        this._pollTimer = setInterval(async () => {
            try {
                const logs = await getApi().debug_get_logs_simple();
                if (logs && logs.length > 0) {
                    for (const log of logs) {
                        if (log.type === 'rx' && this._onDataCallback) {
                            // 将HEX字符串转回字节数组
                            const hex = log.hex.replace(/\s/g, '');
                            const bytes = new Uint8Array(hex.length / 2);
                            for (let i = 0; i < hex.length; i += 2) {
                                bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                            }
                            this._onDataCallback(bytes);
                        }
                    }
                }
            } catch (e) {
                console.error('轮询数据失败:', e);
            }
        }, 50);  // 50ms轮询
    },
    
    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },
    
    // ========== 状态查询 ==========
    
    isConnected() {
        return this._connected;
    },
    
    getConnectionType() {
        return this._connType;
    }
};

// ========== WebSocket 连接（用于浏览器模式同步串口数据）==========

let _wsConnection = null;
let _wsReconnectTimer = null;

function connectWebSocket() {
    if (_wsConnection && _wsConnection.readyState === WebSocket.OPEN) return;
    
    try {
        _wsConnection = new WebSocket('ws://127.0.0.1:8767');
        
        _wsConnection.onopen = () => {
            console.info('WebSocket 已连接');
            // 订阅串口数据
            _wsConnection.send(JSON.stringify({
                type: 'subscribe',
                topics: ['serial_data', 'serial_status']
            }));
        };
        
        _wsConnection.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'serial_data' && bt._onDataCallback) {
                    // 收到串口数据
                    const hex = msg.data.hex.replace(/\s/g, '');
                    const bytes = new Uint8Array(hex.length / 2);
                    for (let i = 0; i < hex.length; i += 2) {
                        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
                    }
                    bt._onDataCallback(bytes);
                } else if (msg.type === 'serial_status') {
                    // 串口状态变化
                    bt._connected = msg.data.connected;
                    bt._connType = msg.data.type || 'serial';
                }
            } catch (e) {
                console.warn('WebSocket消息解析失败:', e);
            }
        };
        
        _wsConnection.onclose = () => {
            console.info('WebSocket 已断开，5秒后重连...');
            _wsReconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        
        _wsConnection.onerror = (err) => {
            console.warn('WebSocket 错误:', err);
        };
    } catch (e) {
        console.warn('WebSocket 连接失败:', e);
    }
}

// 检测是否在浏览器模式（非pywebview）
function isBrowserMode() {
    return !(window.pywebview && window.pywebview.api) &&
           !(window.parent && window.parent.pywebview && window.parent.pywebview.api) &&
           !(window.top && window.top.pywebview && window.top.pywebview.api);
}

// 获取后端当前串口状态
async function syncSerialStatus() {
    try {
        const api = getApi();
        const status = await api.debug_get_status();
        if (status && status.connected) {
            bt._connected = true;
            bt._connType = status.type || 'serial';
            console.info('同步串口状态: 已连接', status.name);
            // 触发状态更新事件，让页面更新UI
            window.dispatchEvent(new CustomEvent('serial_status_sync', { 
                detail: { connected: true, name: status.name, type: status.type }
            }));
        } else {
            bt._connected = false;
            bt._connType = null;
            console.info('同步串口状态: 未连接');
        }
    } catch (e) {
        console.warn('获取串口状态失败:', e);
    }
}

// 暴露同步函数供页面调用
window.syncSerialStatus = syncSerialStatus;

// 自动初始化WebSocket（浏览器模式）
if (isBrowserMode()) {
    console.info('检测到浏览器模式，启动WebSocket连接...');
    setTimeout(connectWebSocket, 500);
    // 同步当前串口状态
    setTimeout(syncSerialStatus, 1000);
}

// 兼容原有代码
window.bt = bt;
