@echo off
REM Build the portable HUKM AI controller (run from apps\windows-controller\packaging)
setlocal
cd /d %~dp0\..
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% -m venv .venv || goto :err
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r requirements-dev.txt || goto :err
python -m pytest -q || goto :err
pyinstaller --noconfirm --clean --distpath dist --workpath build packaging\hukm-controller.spec || goto :err
echo.
echo Built: %cd%\dist\hukm-controller.exe
exit /b 0
:err
echo Build failed.
exit /b 1
