@echo off
rem Development mode: API with auto-reload on :8000 and the Vite dev server on :5173.
setlocal
cd /d "%~dp0"
start "LipiSetu API" cmd /k "cd backend && .venv\Scripts\python -X utf8 -m uvicorn app.main:app --reload --port 8000"
cd frontend
npm run dev
