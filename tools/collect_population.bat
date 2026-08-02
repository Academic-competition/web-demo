@echo off
chcp 65001 >nul
setlocal

REM ====================================================================
REM  상주인구(OA-15584) · 직장인구(OA-15569) 수집 — cmd 용 실행기
REM
REM  키를 파일에 적지 않고 실행할 때 입력받는다.
REM  (cmd 의 set 은 따옴표까지 값에 포함하므로 따옴표 없이 붙여넣을 것)
REM
REM  더블클릭해도 되고, cmd 에서 실행해도 된다.
REM ====================================================================

set "REPO=%~dp0..\..\Commercial-AI-"
set "PY=%REPO%\.venv\Scripts\python.exe"
set "SCRIPT=%~dp0collect_population.py"

if not exist "%PY%" (
    echo [오류] Python 을 찾을 수 없습니다: %PY%
    echo        Commercial-AI-/.venv 가 있는지 확인하세요.
    pause
    exit /b 2
)

if "%SEOUL_API_KEY%"=="" (
    echo.
    echo  서울 열린데이터광장 인증키를 입력하세요.
    echo  [주의] 따옴표 없이, 앞뒤 공백 없이 붙여넣으세요.
    echo.
    set /p SEOUL_API_KEY=인증키:
)

if "%SEOUL_API_KEY%"=="" (
    echo [오류] 인증키가 비어 있습니다.
    pause
    exit /b 2
)

echo.
echo  수집 시작 — 상주인구 / 직장인구 2종만 받습니다.
echo  (매출 101MB 등 기존 4종은 다시 받지 않습니다)
echo.

"%PY%" "%SCRIPT%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo  완료. 이 창 내용을 그대로 알려주시면 다음 단계를 진행합니다.
) else (
    echo  실패 또는 경고가 있습니다 ^(종료코드 %RC%^). 위 메시지를 확인하세요.
)
echo.
pause
endlocal
