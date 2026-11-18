@echo off
rem DWH Runner launcher (plan A.9). Double-click it, or use the desktop shortcut (npm run dwh:shortcut).
rem Checks Node and the settings file, then starts the page in a minimised window; if the page
rem is already running it only opens the browser. Set DWH_FAKE=1 to try it without the DWH.
setlocal
cd /d "%~dp0"
title DWH Runner
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=24?0:1)"
if errorlevel 1 goto nonode
if "%DWH_FAKE%"=="1" goto envok
if not exist ".env" goto noenv
:envok
if /i "%~1"=="--no-browser" set DWH_NO_BROWSER=1
node src\dwh\server.ts --launch-check
if errorlevel 3 goto start
if errorlevel 1 goto problem
exit /b 0
:start
start "DWH Runner - close this window to stop" /min node --env-file-if-exists=.env src\dwh\server.ts
exit /b 0
:nonode
echo Node.js 24 or newer is needed on the host PC. Ask IT to install it.
pause
exit /b 1
:noenv
echo The host PC is not set up to reach the DWH yet (the settings file is missing).
pause
exit /b 1
:problem
pause
exit /b 1
