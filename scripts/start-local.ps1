# scripts/start-local.ps1
Write-Host "=== 正在启动 ITEIPPT 本地服务 ===" -ForegroundColor Cyan

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root "src"
$envFile = Join-Path $srcDir ".env"

if (-not (Test-Path $envFile)) {
    Write-Warning "未找到 src/.env 配置文件，正在从 .env.example 复制..."
    Copy-Item (Join-Path $srcDir ".env.example") $envFile
}

# 1. 启动 API Proxy (Port 8787)
Write-Host "启动 API 代理服务 (端口 8787)..." -ForegroundColor Green
Start-Process powershell -WorkingDirectory $srcDir -ArgumentList "-NoExit", "-Command", "Write-Host '=== ITEIPPT API Proxy (Port 8787) ===' -ForegroundColor Green; npm run proxy:dev"

# 等待代理服务启动
Start-Sleep -Seconds 2

# 2. 启动前端 Vite (Port 3000)
Write-Host "启动前端服务 (端口 3000)..." -ForegroundColor Green
Start-Process powershell -WorkingDirectory $srcDir -ArgumentList "-NoExit", "-Command", "Write-Host '=== ITEIPPT Frontend (Port 3000) ===' -ForegroundColor Cyan; npm run dev"

# 等待前端服务就绪
Start-Sleep -Seconds 3

# 3. 自动在浏览器中打开
Write-Host "正在打开本地浏览器..." -ForegroundColor Yellow
Start-Process "http://localhost:3000"

Write-Host "=== 服务已成功启动！请在打开的浏览器中体验 ===" -ForegroundColor Green
