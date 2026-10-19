@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto no_node

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto old_node

node "%~dp0install.mjs" %*
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo Setup finished. Next: run start.cmd, then open http://127.0.0.1:4173
) else (
  echo Setup did not finish. Read the message above.
)
pause
exit /b %RESULT%

:no_node
echo Node.js 20 or newer was not found on PATH.
echo Install Node.js 24 LTS from https://nodejs.org/en/download and run install.cmd again.
pause
exit /b 1

:old_node
echo Node.js 20 or newer is required. Detected:
node --version
echo Update Node.js from https://nodejs.org/en/download and run install.cmd again.
pause
exit /b 1
