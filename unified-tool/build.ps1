param(
    [string]$PythonExe = "python",
    [switch]$InstallDeps
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
    Write-Host "[build] $msg" -ForegroundColor Cyan
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

Write-Step "workspace: $root"

if (-not (Test-Path -LiteralPath ".\main_web.py")) {
    throw "main_web.py not found in $root"
}

if (-not (Test-Path -LiteralPath ".\runtime")) {
    throw "runtime directory missing. Restore runtime before packaging."
}

if ($InstallDeps) {
    Write-Step "installing dependencies from requirements.in"
    & $PythonExe -m pip install -U pip
    & $PythonExe -m pip install -r ".\requirements.in"
}

Write-Step "running pyinstaller"
& $PythonExe -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name "GreenLaser_Tool" `
    --distpath ".\dist" `
    --workpath ".\build" `
    --add-data "web;web" `
    --add-data "config;config" `
    --add-data "data;data" `
    --add-data "calibration;calibration" `
    --add-data "runtime;runtime" `
    ".\main_web.py"

Write-Step "done"
Write-Host "Output: $root\dist\GreenLaser_Tool" -ForegroundColor Green

