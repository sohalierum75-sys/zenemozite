@echo off
echo ========================================
echo   Starting MovieStream Platform
echo ========================================
echo.

echo [1/2] Starting Backend Server...
echo.
start cmd /k "cd backend && npm start"

timeout /t 3 /nobreak > nul

echo [2/2] Starting Frontend Server...
echo.
start cmd /k "npm run dev"

echo.
echo ========================================
echo   Both Servers Starting!
echo ========================================
echo.
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:5173
echo.
echo Press any key to exit this window...
pause > nul
