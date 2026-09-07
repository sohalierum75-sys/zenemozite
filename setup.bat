@echo off
echo ========================================
echo   MovieStream - Automated Setup
echo ========================================
echo.

echo [1/4] Installing Backend Dependencies...
cd backend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Backend installation failed
    pause
    exit /b 1
)
echo.

echo [2/4] Installing Frontend Dependencies...
cd ..
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Frontend installation failed
    pause
    exit /b 1
)
echo.

echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo To start the application:
echo.
echo 1. Backend:  cd backend ^&^& npm start
echo 2. Frontend: npm run dev
echo.
echo Then open: http://localhost:5173
echo.
pause
