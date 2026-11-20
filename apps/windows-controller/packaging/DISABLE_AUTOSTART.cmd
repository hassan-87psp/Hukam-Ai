@echo off
setlocal
set "APP=%LOCALAPPDATA%\HUKM AI\Controller\hukm-controller.exe"
if not exist "%APP%" (
  echo HUKM installation not found. Please use the controller's autostart command if installed elsewhere.
  pause
  exit /b 1
)
"%APP%" autostart off
if errorlevel 1 (
  echo Autostart disable failed.
  pause
  exit /b 1
)
echo Autostart disabled.
pause
