@echo off
rem Starts LipiSetu (API + background OCR worker + built website) on http://localhost:8000
setlocal
cd /d "%~dp0backend"
if not exist .venv\Scripts\python.exe (
  echo Run setup.bat first.
  exit /b 1
)
echo LipiSetu is starting on http://localhost:8000  (press Ctrl+C to stop)
.venv\Scripts\python -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
