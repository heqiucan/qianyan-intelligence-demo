@echo off
chcp 65001 >nul
title Zheyan - Free Zhipu Connection Check
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "scripts\configure_zhipu.py" --check
) else (
  py -3 "scripts\configure_zhipu.py" --check
)
echo.
pause
