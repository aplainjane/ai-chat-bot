@echo off
rem One-click start: snowluma / dsh / bridge. ASCII-only on purpose:
rem cmd.exe parses .bat files in the system codepage (GBK); UTF-8 Chinese breaks parsing.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1" %*
echo.
pause
