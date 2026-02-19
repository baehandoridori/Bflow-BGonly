@echo off
chcp 65001 >nul
title BG 진행 현황판 [테스트 모드]

echo ============================================
echo   BG 진행 현황판 - 테스트 모드 실행
echo ============================================
echo.

:: 테스트 모드 환경변수 설정
set TEST_MODE=1

:: Node.js 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo https://nodejs.org 에서 설치해 주세요.
    pause
    exit /b 1
)

:: node_modules 확인 및 설치
if not exist "node_modules" (
    echo [설치] npm 패키지를 설치합니다...
    call npm install
    if %errorlevel% neq 0 (
        echo [오류] npm install 실패
        pause
        exit /b 1
    )
    echo.
)

:: test-data 폴더 생성
if not exist "test-data" (
    mkdir test-data
    echo [생성] test-data 폴더를 만들었습니다.
)

echo [실행] 개발 서버를 시작합니다...
echo   - 테스트 모드: ON (로컬 JSON 파일 사용)
echo   - 테스트 데이터: test-data\sheets.json
echo   - 종료: Ctrl+C
echo.

:: Vite + Electron 개발 모드 실행
call npm run dev
