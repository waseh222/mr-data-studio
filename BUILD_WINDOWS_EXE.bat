@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "INSIGHTFORGE_HOME=%~dp0workspace"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"
set "PIP_CACHE_DIR=%~dp0pip-cache"
set "PYINSTALLER_CONFIG_DIR=%~dp0build_cache"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "%PYINSTALLER_CONFIG_DIR%" mkdir "%PYINSTALLER_CONFIG_DIR%"
if not exist ".venv\Scripts\python.exe" (
 echo Run RUN_WINDOWS.bat first so the Python environment is installed on D:.
 pause
 exit /b 1
)
".venv\Scripts\python.exe" -m pip install "pyinstaller>=6.0"
if errorlevel 1 (echo ERROR: PyInstaller installation failed.&pause&exit /b 1)
echo Building native desktop Windows EXE on D: (may be large)...
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onedir --windowed ^
 --name "InsightForge Studio v2" ^
 --distpath "%~dp0dist" --workpath "%~dp0build" --specpath "%~dp0build_cache" ^
 --add-data "static;static" --collect-all "plotly" --collect-all "sklearn" ^
 --collect-all "scipy" --collect-all "pandas" --collect-all "matplotlib" ^
 --collect-all "seaborn" --collect-all "pyarrow" --hidden-import "multipart" ^
 --hidden-import "pypdf" --hidden-import "docx" --hidden-import "joblib" ^
 --collect-all "webview" desktop_launcher.py
if errorlevel 1 (echo ERROR: EXE build failed. Review the output.&pause&exit /b 1)
echo SUCCESS: "%~dp0dist\InsightForge Studio v2\InsightForge Studio v2.exe"
pause
endlocal
