@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "%~dp0server.mjs" (
  echo server.mjs was not found next to start.cmd.
  pause
  exit /b 1
)

if not exist "%~dp0quest-preview.local.json" (
  echo No quest-preview.local.json found; the built-in demo data will be used.
  echo Run install.cmd first to select your Minecraft instance or quests folder.
  echo.
)

set "PREVIEW_PORT=4173"
if defined QUEST_PREVIEW_PORT set "PREVIEW_PORT=%QUEST_PREVIEW_PORT%"
echo Starting Quest Preview at http://127.0.0.1:%PREVIEW_PORT%
echo Press Ctrl+C to stop the server.
echo.
node "%~dp0server.mjs" %*
exit /b %ERRORLEVEL%

:no_node
echo Node.js 20 or newer was not found on PATH.
echo Install Node.js 24 LTS from https://nodejs.org/en/download and run start.cmd again.
pause
exit /b 1
