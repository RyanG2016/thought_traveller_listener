@echo off
REM Build script wrapper for Windows
REM Run this to build the Windows executable

cd /d "%~dp0\.."
powershell -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
pause
