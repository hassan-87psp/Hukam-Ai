@echo off
setlocal
set "SRC=%~dp0hukm-controller.exe"
set "DEST=%LOCALAPPDATA%\HUKM AI\Controller"
set "APP=%DEST%\hukm-controller.exe"
echo HUKM AI - Safe Install / Update
echo.
if not exist "%SRC%" (
  echo ERROR: Package is incomplete. Extract the full ZIP first.
  pause
  exit /b 1
)
echo Checking new executable...
"%SRC%" --version
if errorlevel 1 goto error
"%SRC%" --help >nul
if errorlevel 1 goto error
if not exist "%DEST%" mkdir "%DEST%"
if errorlevel 1 goto error
if exist "%APP%" (
  echo Backing up previous executable...
  copy /Y "%APP%" "%DEST%\hukm-controller.previous.exe" >nul
  if errorlevel 1 (
    echo ERROR: Could not back up old EXE. Close the old Controller window and retry.
    pause
    exit /b 1
  )
)
echo Installing to %DEST%
copy /Y "%~dp0RESTORE_PREVIOUS.cmd" "%DEST%\RESTORE_PREVIOUS.cmd" >nul
if errorlevel 1 goto error
copy /Y "%SRC%" "%APP%" >nul
if errorlevel 1 goto rollback
"%APP%" --version
if errorlevel 1 goto rollback
"%APP%" status
if errorlevel 1 goto rollback
echo.
echo SUCCESS: HUKM Controller installed in a permanent folder.
echo Pairing and configuration in APPDATA were NOT deleted or replaced.
echo Run START_HUKM.cmd to connect. Enable Autostart only after testing.
if /I not "%CI%"=="true" pause
exit /b 0
:rollback
echo ERROR: Installation verification failed. Trying automatic EXE rollback...
if exist "%DEST%\hukm-controller.previous.exe" (
  copy /Y "%DEST%\hukm-controller.previous.exe" "%APP%" >nul
  if errorlevel 1 echo Rollback could not finish. The previous EXE remains in the folder.
)
:error
echo Install / update FAILED. Existing user data was preserved.
if /I not "%CI%"=="true" pause
exit /b 1
