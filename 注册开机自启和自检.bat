@echo off
rem One-time setup: register boot autostart + 4-hour watchdog. ASCII-only on purpose:
rem cmd.exe parses .bat files in the system codepage (GBK); UTF-8 Chinese breaks parsing.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-autostart.ps1"
echo.
pause
