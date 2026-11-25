@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "INSIGHTFORGE_HOME=%~dp0workspace"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"
set "MPLCONFIGDIR=%~dp0mplconfig"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%MPLCONFIGDIR%" mkdir "%MPLCONFIGDIR%"
if not exist ".venv\Scripts\python.exe" (echo Please run RUN_WINDOWS.bat first.&pause&exit /b 1)
".venv\Scripts\python.exe" app.py
endlocal
