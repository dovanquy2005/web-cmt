@echo off
chcp 65001 > nul
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
setlocal

echo ======================================================================
echo           TIKTOK COMMENTS WEB APPLICATION (1-CLICK RUNNER)
echo ======================================================================
echo.

if not exist "%~dp0node_modules" (
    echo [*] Phat hien chua cai dat thu vien Node.js. Dang tien hanh cai dat...
    call npm install
    echo.
)

echo [*] Dang khoi dong Web Server tai http://localhost:5000 ...
echo.

start "" "http://localhost:5000"
python app.py

pause

