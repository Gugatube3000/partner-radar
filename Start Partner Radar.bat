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
  echo.
  echo  Claude Code was not found. LIVE runs need it - see README.txt.
  echo  DEMO mode still works.
  echo.
)
if not exist node_modules\express (
  echo  First run: installing, one moment...
  call npm install --omit=dev
)
echo.
echo  Partner Radar is running at http://localhost:4747
echo  Keep this window open. Close it to stop.
echo.
start "" http://localhost:4747
node server.js
pause
