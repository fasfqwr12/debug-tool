/**
 * WS -> Toast
 * - 连接 ws://127.0.0.1:8767
 * - 订阅 ui_notify / slipway_event
 * - 将复位/IO/切速等事件用右上角 Toast 显示（不使用右下角面板）
 */

(function () {
  const WS_URL = 'ws://127.0.0.1:8767';

  const WsToast = {
    _ws: null,
    _reconnectTimer: null,

    init() {
      this._connect();
    },

    _toast(message, level) {
      const msg = String(message || '').trim();
      if (!msg) return;
      const lvl = String(level || 'info').toLowerCase();
      const type = (lvl === 'error') ? 'error' :
                   (lvl === 'warning') ? 'warning' :
                   (lvl === 'success') ? 'success' : 'info';
      const duration = (type === 'error') ? 4500 :
                       (type === 'warning') ? 2600 :
                       (type === 'success') ? 1400 : 1600;
      if (window.Utils && typeof window.Utils.toast === 'function') {
        window.Utils.toast(msg, type, duration);
      } else {
        console.info('[WS toast]', type, msg);
      }
    },

    _connect() {
      try {
        if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return;
        this._ws = new WebSocket(WS_URL);

        this._ws.onopen = () => {
          try {
            this._ws.send(JSON.stringify({ type: 'subscribe', topics: ['ui_notify', 'slipway_event'] }));
          } catch (e) {}
          // 不弹“已连接”toast，避免干扰测试
        };

        this._ws.onmessage = (evt) => {
          let msg;
          try { msg = JSON.parse(evt.data); } catch (e) { return; }
          const type = msg.type;
          const data = msg.data || {};

          if (type === 'ui_notify' || type === 'slipway_event') {
            const level = data.level || 'info';
            const message = data.message || '';
            const action = String(data.action || '');

            // slipway_event 只挑动作级事件弹 toast，避免被轮询/状态同步刷屏
            if (type === 'slipway_event') {
              const allow = new Set([
                'patch_installed',
                'reset_start',
                'reset_fast',
                'io_precheck',
                'io_hit',
                'switch_slow',
                'release_limit',
                'reset_end',
                'reset_exception',
                'slipway_move_start',
                'slipway_move_done',
                'slipway_move_failed',
                'slipway_stop',
                'rotary_move_start',
                'rotary_move_done',
                'rotary_move_failed',
                'rotary_stop',
                'rotary_reset_start',
                'rotary_reset_done',
                'rotary_reset_failed',
                'test_start',
                'test_resume',
                'test_stop',
              ]);
              if (!allow.has(action) && String(level).toLowerCase() === 'info') return;
            }

            this._toast(message, level);
          }
        };

        this._ws.onclose = () => {
          this._scheduleReconnect();
        };

        this._ws.onerror = () => {
          this._scheduleReconnect();
        };
      } catch (e) {
        this._scheduleReconnect();
      }
    },

    _scheduleReconnect() {
      if (this._reconnectTimer) return;
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._connect();
      }, 3000);
    },
  };

  window.WsToast = WsToast;

  document.addEventListener('DOMContentLoaded', () => {
    try { WsToast.init(); } catch (e) { console.warn('WsToast init failed', e); }
  });
})();
