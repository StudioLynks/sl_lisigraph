@echo off
rem Double-cliquable : lance desinstaller.ps1 sans changer la politique d'execution de PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstaller.ps1"
pause
