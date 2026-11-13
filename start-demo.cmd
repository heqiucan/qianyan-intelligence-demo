@echo off
chcp 65001 >nul
title Zheyan AI Demo
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "scripts\start_demo.py" --open-browser %*
) else (
  py -3 "scripts\start_demo.py" --open-browser %*
)
if errorlevel 1 (
  echo.
  echo Demo failed to start. Please keep this window open to view the error above.
  pause
  exit /b 1
)
exit /b 0
