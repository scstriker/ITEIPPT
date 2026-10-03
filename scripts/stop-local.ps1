# scripts/stop-local.ps1
Write-Host "正在停止 ITEIPPT 本地服务 (端口 3000 / 8787)..." -ForegroundColor Yellow

$ports = @(3000, 8787)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pidToKill in $pids) {
            try {
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                Write-Host "已终止端口 $port 关联进程 (PID: $pidToKill)" -ForegroundColor Green
            } catch {
                Write-Warning "终止 PID $pidToKill 失败: $_"
            }
        }
    } else {
        Write-Host "端口 $port 未被占用。" -ForegroundColor Gray
    }
}
Write-Host "清理完成。" -ForegroundColor Cyan
