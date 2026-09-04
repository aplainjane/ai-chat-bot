# register-autostart.ps1 - One-time setup: boot autostart (Startup folder shortcut) + 4-hour watchdog task.
# Run via 注册开机自启和自检.bat from the qq-bridge root. Safe to re-run (overwrites).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot   # qq-bridge dir
$startAll = Join-Path $PSScriptRoot 'start-all.ps1'
$watchdog = Join-Path $PSScriptRoot 'watchdog.ps1'

Write-Host '=== 注册开机自启 ==='
# 方式一：当前用户启动文件夹快捷方式（最稳，不需要管理员）
$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
try {
    $lnkPath = Join-Path $startupDir 'qq-bot-start-all.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startAll + '"'
    $lnk.WorkingDirectory = $root
    $lnk.WindowStyle = 7
    $lnk.Description = 'QQ bot one-click start (SnowLuma + DSH + bridge)'
    $lnk.Save()
    Write-Host "[OK] 启动文件夹快捷方式: $lnkPath"
} catch {
    Write-Host "[失败] 创建启动快捷方式: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== 注册每 4 小时自检 ==='
$tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watchdog + '"'
& schtasks /Create /TN 'qq-bot-watchdog' /TR $tr /SC HOURLY /MO 4 /F
if ($LASTEXITCODE -eq 0) {
    Write-Host '[OK] 计划任务 qq-bot-watchdog（每 4 小时）'
} else {
    Write-Host '[失败] 计划任务注册失败（可能需要管理员权限；没有它也能用，只是少了自动巡检）'
}

Write-Host ''
Write-Host '=== 完成 ==='
Write-Host '现在双击 start-all.bat 可以立即拉起整套服务；以后开机会自动拉起。'
