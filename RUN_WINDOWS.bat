@echo off
setlocal EnableExtensions
set "DEST=D:\InsightForge Analytics Studio"
rem If started from Downloads on C: drive, install to D: first.
if exist "D:\" if /I not "%~dp0"=="%DEST%\" (
 call "%~dp0INSTALL_TO_D_DRIVE.bat" /AUTO
 if errorlevel 1 (echo Installation to D: failed.&pause&exit /b 1)
 call "%DEST%\RUN_WINDOWS.bat"
 exit /b %errorlevel%
)
cd /d "%~dp0"
set "INSIGHTFORGE_HOME=%~dp0workspace"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"
set "PIP_CACHE_DIR=%~dp0pip-cache"
set "PYTHONPYCACHEPREFIX=%~dp0pycache"
set "MPLCONFIGDIR=%~dp0mplconfig"
set "HF_HOME=%~dp0hf-cache"
set "TORCH_HOME=%~dp0torch-cache"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%PIP_CACHE_DIR%" mkdir "%PIP_CACHE_DIR%"
if not exist "%PYTHONPYCACHEPREFIX%" mkdir "%PYTHONPYCACHEPREFIX%"
if not exist "%MPLCONFIGDIR%" mkdir "%MPLCONFIGDIR%"
if not exist "%HF_HOME%" mkdir "%HF_HOME%"
if not exist "%TORCH_HOME%" mkdir "%TORCH_HOME%"
if not exist ".venv\Scripts\python.exe" (
 echo ======================================================
 echo InsightForge v2 - First time setup on %~d0
 echo Python libraries and workspace will be on this disk.
 echo ======================================================
 where py >nul 2>nul
 if not errorlevel 1 (
   py -3.11 -m venv .venv 2>nul
   if errorlevel 1 py -3 -m venv .venv
 ) else (
   python -m venv .venv
 )
 if errorlevel 1 (
   echo Python 3.11+ is required. Please install Python from python.org.
   pause
   exit /b 1
 )
 ".venv\Scripts\python.exe" -m pip install --upgrade pip
 ".venv\Scripts\python.exe" -m pip install -r requirements.txt
 if errorlevel 1 (
   echo Package setup failed. Internet is needed only for first-time library installation.
   pause
   exit /b 1
 )
)
echo.
echo InsightForge Studio v2 starts at http://127.0.0.1:8765
 echo Workspace: %INSIGHTFORGE_HOME%
echo Keep this terminal open; Ctrl+C stops the server.
".venv\Scripts\python.exe" desktop_launcher.py
if errorlevel 1 (echo Analytics engine stopped unexpectedly.&pause)
endlocal
