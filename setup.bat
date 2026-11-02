@echo off
rem One-time setup on Windows: Python environment, demo data, frontend build.
setlocal
cd /d "%~dp0"

echo [1/4] Creating Python environment...
if not exist backend\.venv (
  python -m venv backend\.venv || goto :error
)
call backend\.venv\Scripts\python -m pip install --upgrade pip >nul
call backend\.venv\Scripts\python -m pip install -r backend\requirements.txt || goto :error

echo [2/4] Seeding demo data (runs real OCR on the sample manuscripts)...
pushd backend
call .venv\Scripts\python -X utf8 -m scripts.seed || (popd & goto :error)
popd

echo [3/4] Installing frontend packages...
pushd frontend
call npm install || (popd & goto :error)

echo [4/4] Building the frontend...
call npm run build || (popd & goto :error)
popd

echo.
echo Setup complete. Run start.bat and open http://localhost:8000
exit /b 0

:error
echo.
echo Setup failed. See the messages above.
exit /b 1
