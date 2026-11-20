@echo off
setlocal
set "APP=%LOCALAPPDATA%\HUKM AI\Controller\hukm-controller.exe"
if not exist "%APP%" (
  echo HUKM not installed. Run INSTALL_OR_UPDATE.cmd first.
  pause
  exit /b 1
)
"%APP%" run
if errorlevel 1 (
  echo Controller stopped with an error.
  pause
  exit /b 1
)
echo Controller is now stopped. Remote control is OFF.
pause
