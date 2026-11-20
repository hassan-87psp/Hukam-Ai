@echo off
REM Run the controller from source (developer mode). End users can use dist\hukm-controller.exe instead.
cd /d %~dp0
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
if not exist .venv ( %PY% -m venv .venv && .venv\Scripts\pip install -r requirements.txt )
.venv\Scripts\python -m controller %*
pause
