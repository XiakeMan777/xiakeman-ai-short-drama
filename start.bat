@echo off
setlocal
chcp 65001 >nul 2>&1
title Xiakeman - Dev Server
color 0A

set "ROOT=%~dp0"
set "FRONTEND_PORT=8022"
set "BFF_PORT=8030"

echo.
echo ============================================================
echo  Xiakeman dev environment
echo  Frontend : http://localhost:%FRONTEND_PORT%
echo  BFF      : http://localhost:%BFF_PORT%
echo ============================================================
echo.

echo [1/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  color 0C
  echo Node.js was not found. Please install Node.js 20.19+ first.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
echo Node.js %NODE_VER%
echo.

echo [2/5] Switching workspace...
cd /d "%ROOT%"
echo %cd%
echo.

echo [3/5] Checking frontend dependencies...
if not exist "node_modules" (
  echo Installing frontend dependencies...
  call npm ci
  if errorlevel 1 (
    color 0C
    echo Frontend dependency installation failed.
    echo.
    pause
    exit /b 1
  )
) else (
  echo Frontend node_modules already exists.
)
echo.

echo [4/5] Checking BFF dependencies...
if not exist "bff\node_modules" (
  echo Installing BFF dependencies...
  pushd bff
  call npm ci
  if errorlevel 1 (
    popd
    color 0C
    echo BFF dependency installation failed.
    echo.
    pause
    exit /b 1
  )
  popd
) else (
  echo BFF node_modules already exists.
)
echo.

echo [5/5] Starting services...

call :IsPortListening %BFF_PORT%
if "%PORT_LISTENING%"=="1" (
  echo BFF is already running on port %BFF_PORT%.
) else (
  echo Starting BFF on port %BFF_PORT% with template auto-reload...
  start "Xiakeman BFF :%BFF_PORT% (watch)" cmd /k "cd /d ""%ROOT%bff"" && npm run dev"
  timeout /t 2 /nobreak >nul
)

call :IsPortListening %FRONTEND_PORT%
if "%PORT_LISTENING%"=="1" (
  echo.
  echo Frontend is already running on port %FRONTEND_PORT%.
  echo Open: http://localhost:%FRONTEND_PORT%
  echo.
  echo No new Vite process was started, so this is not a crash.
  echo Close this window or press any key to exit.
  pause >nul
  exit /b 0
)

echo Starting Vite frontend on port %FRONTEND_PORT%...
echo.
echo ------------------------------------------------------------
echo  Frontend : http://localhost:%FRONTEND_PORT%
echo  BFF      : http://localhost:%BFF_PORT%
echo  BFF watch mode is enabled; backend template edits auto-reload.
echo  Press Ctrl+C here to stop the frontend dev server.
echo ------------------------------------------------------------
echo.

call npx vite --strictPort --port %FRONTEND_PORT% --host

echo.
echo Frontend dev server stopped.
pause
exit /b %errorlevel%

:IsPortListening
set "PORT_LISTENING=0"
for /f "usebackq tokens=*" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue) { '1' } else { '0' }"`) do set "PORT_LISTENING=%%p"
exit /b 0
