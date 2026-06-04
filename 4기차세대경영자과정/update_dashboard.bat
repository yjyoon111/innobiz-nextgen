@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PYTHON_EXE=C:\Users\Innobiz\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

echo [INFO] 대시보드를 갱신합니다...
"%PYTHON_EXE%" "%SCRIPT_DIR%build_finance_dashboard.py"

if errorlevel 1 (
    echo [ERROR] 대시보드 생성 중 오류가 발생했습니다.
    pause
    exit /b 1
)

echo [DONE] 대시보드 생성이 완료되었습니다.
pause

