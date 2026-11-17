@echo off
rem DTEK Odesa shutdown schedule app - Windows launcher
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python 3.9+ is required. Install it from https://www.python.org/downloads/
    echo and tick "Add python.exe to PATH" during installation.
    pause
    exit /b 1
)

python -c "import curl_cffi" >nul 2>nul
if errorlevel 1 (
    echo Installing curl_cffi (recommended for the DTEK site's bot protection)...
    pip install curl_cffi
)

python dtek_shutdown_app.py %*
pause
