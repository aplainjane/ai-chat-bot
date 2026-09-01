@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo  一键启动：snowluma / dsh / bridge
echo  已在运行的服务会自动跳过
echo ========================================
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-all.ps1" %*
echo.
pause
