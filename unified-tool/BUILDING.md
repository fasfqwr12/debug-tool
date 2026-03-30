# Build & Dependency Notes

## 1) Python 环境

- 建议 Python `3.12.x`
- 新建虚拟环境后安装你们项目实际使用的依赖（按团队锁定版本）
- 本仓库已提供基础依赖清单：`requirements.in`

> 说明：本仓库是源码优先，不包含你本机缓存/发布产物。

## 2) 本地运行

在 `unified-tool` 目录启动：

```powershell
python main_web.py
```

默认端口：

- HTTP: `127.0.0.1:8766`
- WebSocket: `127.0.0.1:8767`

安装依赖（建议在虚拟环境中）：

```powershell
python -m pip install -U pip
python -m pip install -r requirements.in
```

## 3) 依赖边界（请务必统一）

为了避免仓库污染，以下内容不进 Git：

- 日志、数据库、导出文件
- WebView 缓存
- 反编译中间产物
- 可执行文件（`exe`）

如果需要发布版本，建议在 CI 或本地打包后上传到 Release/制品库，而不是提交到主分支。

## 4) 打包建议

推荐流程：

1. 固定 Python 与依赖版本（建议锁定到 `requirements.lock` 或等效方案）
2. 在干净环境执行打包（如 PyInstaller）
3. 产物只发布，不入主仓
4. 保留源码仓库纯净，确保可审计、可协作、可持续恢复

仓库内一键打包脚本：

```powershell
.\build.ps1 -InstallDeps
```

不重复安装依赖可用：

```powershell
.\build.ps1
```
