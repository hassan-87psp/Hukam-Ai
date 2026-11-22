@echo off
setlocal
rem Local-only recovery. No remote arguments, downloads or automatic launch.
set "APP=%~dp0hukm-controller.exe"
set "PREV=%~dp0hukm-controller.previous.exe"
set "STAGED=%~dp0hukm-controller.recovery-stage.exe"
if not exist "%PREV%" (
  echo No previous HUKM executable is available. Keep your APPDATA pairing.
  exit /b 1
)
echo Close the running HUKM Controller first.
echo This restores the previous local executable, not your account or database.
echo Only proceed if this backup came from your own trusted HUKM installation.
if /I not "%CI%"=="true" (
  choice /C YN /N /M "Restore previous controller? [Y/N] "
  if not errorlevel 1 exit /b 1
  if errorlevel 2 exit /b 1
)
copy /Y "%PREV%" "%STAGED%" >nul
if errorlevel 1 goto failed
"%STAGED%" --version
if errorlevel 1 goto failed
"%STAGED%" --help >nul
if errorlevel 1 goto failed
rem Preserve current EXE in a separate file; do not overwrite the known backup.
if exist "%APP%" (
  copy /Y "%APP%" "%~dp0hukm-controller.before-recovery.exe" >nul
  if errorlevel 1 goto failed
)
move /Y "%STAGED%" "%APP%" >nul
if errorlevel 1 goto failed
"%APP%" --version
if errorlevel 1 goto failed
echo Previous executable restored. Pairing and settings were not modified.
echo Start HUKM manually and verify its connected version on the Devices page.
exit /b 0
:failed
if exist "%STAGED%" del "%STAGED%"
echo Recovery failed. Previous backup retained; close HUKM and verify installation.
exit /b 1
