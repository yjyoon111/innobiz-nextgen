@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PYTHON_EXE=C:\Users\Innobiz\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "GEN_SCRIPT=%SCRIPT_DIR%web-dashboard\scripts\generate_dashboard_data.py"

echo [INFO] 웹 대시보드 데이터 갱신 중...
"%PYTHON_EXE%" "%GEN_SCRIPT%"

if errorlevel 1 (
    echo [ERROR] 데이터 갱신에 실패했습니다.
    pause
    exit /b 1
)

echo [DONE] 데이터 갱신 완료: web-dashboard\data\dashboard.json
pause

