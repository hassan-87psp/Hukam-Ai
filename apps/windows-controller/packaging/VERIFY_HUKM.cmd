@echo off
setlocal
set "APP=%LOCALAPPDATA%\HUKM AI\Controller\hukm-controller.exe"
if not exist "%APP%" (
  echo HUKM not installed. Run INSTALL_OR_UPDATE.cmd first.
  pause
  exit /b 1
)
echo HUKM installed version:
"%APP%" --version
if errorlevel 1 goto error
echo.
echo Pairing status (keep tokens private):
"%APP%" status
if errorlevel 1 goto error
echo.
echo SUCCESS: EXE startup verified. Online status must still be tested with START_HUKM.
pause
exit /b 0
:error
echo ERROR: EXE startup or status check failed.
pause
exit /b 1
