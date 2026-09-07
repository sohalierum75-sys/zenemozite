@echo off
echo ========================================
echo   Kill Process on Port 5000
echo ========================================
echo.

echo Checking for processes using port 5000...
echo.

netstat -ano | findstr :5000

if %errorlevel% equ 0 (
    echo.
    echo Process(es) found using port 5000.
    echo.
    set /p CONFIRM="Do you want to kill ALL node.exe processes? (Y/N): "
    
    if /i "%CONFIRM%"=="Y" (
        echo.
        echo Killing all node.exe processes...
        taskkill /F /IM node.exe
        echo.
        echo Done! You can now start the server with: node server.js
    ) else (
        echo.
        echo Cancelled. To manually kill a specific process:
        echo 1. Note the PID from the list above (last column)
        echo 2. Run: taskkill /PID [PID] /F
    )
) else (
    echo No processes found using port 5000.
    echo Port is available!
)

echo.
pause
