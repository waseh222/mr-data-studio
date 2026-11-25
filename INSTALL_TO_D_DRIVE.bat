@echo off
setlocal EnableExtensions
set "DEST=D:\InsightForge Analytics Studio"
if not exist "D:\" (
 echo ERROR: D: drive not found. Connect it or edit the script to use another disk.
 pause
 exit /b 1
)
if not exist "%DEST%" mkdir "%DEST%"
if errorlevel 1 (echo Cannot create application folder on D:.& pause &exit /b 1)
if /I not "%~dp0"=="%DEST%\" (
 echo Copying InsightForge Studio to D: (old files are NOT deleted)...
 robocopy "%~dp0" "%DEST%" /E /R:1 /W:1 /XD .venv workspace __pycache__ .pytest_cache temp pip-cache pycache mplconfig hf-cache torch-cache build_cache build dist /XF *.pyc *.joblib *.log >nul
 if errorlevel 8 (echo ERROR: The D: drive copy failed.&pause&exit /b 1)
)
if not exist "%DEST%\workspace" mkdir "%DEST%\workspace"
if not exist "%DEST%\temp" mkdir "%DEST%\temp"
if not exist "%DEST%\pip-cache" mkdir "%DEST%\pip-cache"
if not exist "%DEST%\pycache" mkdir "%DEST%\pycache"
rem Migrate previous C: dataset workspace only if destination has no existing manifest.
if exist "%USERPROFILE%\InsightForge Studio\workspace.json" if not exist "%DEST%\workspace\workspace.json" (
 echo Copying earlier local datasets to D: (keeping original files untouched)...
 robocopy "%USERPROFILE%\InsightForge Studio" "%DEST%\workspace" /E /R:1 /W:1 >nul
 if errorlevel 8 echo WARNING: Previous workspace could not be completely copied.
)
echo.
echo Installation location: %DEST%
echo Data and model location: %DEST%\workspace
echo Previous files are preserved. Nothing was deleted from C:.
echo.
if /I not "%~1"=="/AUTO" pause
exit /b 0
