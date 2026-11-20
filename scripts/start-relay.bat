@echo off
REM Starts the HUKM AI relay + web app on this Windows machine (needs Node.js 22.13+).
cd /d %~dp0\..
if not exist node_modules ( call npm install || goto :err )
if not exist apps\relay\dist\server.js ( call npm run build || goto :err )
if not exist apps\web\dist\index.html ( call npm run build || goto :err )
echo Starting HUKM AI relay on http://localhost:8787 ...
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning apps\relay\dist\server.js
exit /b 0
:err
echo Failed. Check the messages above.
pause
exit /b 1
