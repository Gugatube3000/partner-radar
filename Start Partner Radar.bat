@echo off
title Partner Radar
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet. Opening the download page...
  echo  Install the LTS version, then double-click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b
)
where claude >nul 2>nul
if errorlevel 1 (
  where codex >nul 2>nul
  if errorlevel 1 (
    echo  Install Codex or Claude Code and sign in for live research.
    echo  The dashboard includes setup help and a demo.
  )
)
set "RADAR_INSTALL=0"
if not exist node_modules\express set "RADAR_INSTALL=1"
if not exist node_modules\.partner-radar-lock set "RADAR_INSTALL=1"
if exist node_modules\.partner-radar-lock (
  fc /b package-lock.json node_modules\.partner-radar-lock >nul 2>nul
  if errorlevel 1 set "RADAR_INSTALL=1"
)
if "%RADAR_INSTALL%"=="1" (
  echo  First run: installing, one moment...
  call npm ci --omit=dev
  if errorlevel 1 (
    echo  Installation failed. Check your internet connection and retry.
    pause
    exit /b 1
  )
  copy /y package-lock.json node_modules\.partner-radar-lock >nul
)
echo.
echo  Partner Radar is running at http://localhost:4747
echo  Keep this window open. Close it to stop.
echo.
start "" http://localhost:4747
node server.js
pause
