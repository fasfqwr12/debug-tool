@echo off
setlocal
cd /d "%~dp0"

for /f "delims=" %%i in ('dir /b /s "tools\clangd\*\bin\clangd.exe" 2^>nul') do (
  set "CLANGD_BIN=%%~dpi"
  goto :clangd_ready
)
:clangd_ready
if defined CLANGD_BIN (
  set "PATH=%CLANGD_BIN%;%PATH%"
)

set "PY_CMD="
where py >nul 2>nul
if %errorlevel%==0 set "PY_CMD=py"

if not defined PY_CMD (
  where python >nul 2>nul
  if %errorlevel%==0 set "PY_CMD=python"
)

if not defined PY_CMD (
  echo [ERROR] Python launcher not found. Please install Python 3.
  pause
  exit /b 1
)

%PY_CMD% main.py
set "APP_EXIT=%errorlevel%"
if not "%APP_EXIT%"=="0" (
  echo.
  echo [ERROR] App exited with code %APP_EXIT%.
  pause
)
exit /b %APP_EXIT%
