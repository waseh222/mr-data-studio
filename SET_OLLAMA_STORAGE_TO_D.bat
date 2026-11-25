@echo off
setlocal EnableExtensions
set "MODELDIR=D:\InsightForge Analytics Studio\ollama-models"
if not exist D:\ (echo D: not found.&pause&exit /b 1)
if not exist "%MODELDIR%" mkdir "%MODELDIR%"
echo Configuring future Ollama downloads to save model files on D:...
setx OLLAMA_MODELS "%MODELDIR%"
if errorlevel 1 (echo Could not update your user environment setting.&pause&exit /b 1)
echo.
echo Ollama model storage: %MODELDIR%
echo IMPORTANT: Completely quit and restart Ollama before downloading a model.
echo Existing Ollama models are NOT moved or deleted automatically.
echo This setting does not install Ollama or a language model.
pause
endlocal
