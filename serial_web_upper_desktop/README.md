# 串口上位机 Web 版

## 功能
- 多串口并行连接（每串口独立线程）
- 掉线自动重连
- 并行扫码探测（固定探测帧：`AA EE F0 00 00 00 00 F0 BB FF`）
- 并行定时发送 HEX
- 自定义 HEX 发送（选中/全部）
- WebSocket 实时日志和状态推送
- 一键自动筛选设备（可选断开非设备口）

## 启动
```powershell
cd E:\相位\serial_web_upper
python -m uvicorn app:app --host 127.0.0.1 --port 18080
```

浏览器打开：
- http://127.0.0.1:18080/

## 桌面版启动
已内置 `pywebview` 桌面壳（窗口内打开 Web 页面，并自动管理后端进程）。

```powershell
cd E:\相位\serial_web_upper
python desktop_app.py
```

或直接双击：
- `E:\相位\serial_web_upper\start_desktop.bat`

## API 概览
- `GET /api/ports`
- `GET /api/state`
- `POST /api/connect`
- `POST /api/disconnect`
- `POST /api/send`
- `POST /api/scan`
- `POST /api/schedule/start`
- `POST /api/schedule/stop`
- `POST /api/auto-pick`
- `WS /ws/events`

## 测试
```powershell
cd E:\相位\serial_web_upper
pytest -q
```

说明：测试使用 `loop://` 虚拟串口做后端能力验证，不依赖真实 COM 设备。
