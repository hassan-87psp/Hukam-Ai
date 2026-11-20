@echo off
setlocal
set "APP=%LOCALAPPDATA%\HUKM AI\Controller\hukm-controller.exe"
if not exist "%APP%" (
  echo Install HUKM first.
  pause
  exit /b 1
)
echo Only enable after START_HUKM has shown ONLINE.
"%APP%" autostart on
if errorlevel 1 (
  echo Autostart setup failed.
  pause
  exit /b 1
)
echo Autostart configured for this Windows user after sign-in.
pause
