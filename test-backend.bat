@echo off
echo Testing Backend Server Startup...
echo.
cd backend
start /B node server.js > test-output.log 2>&1
timeout /t 3 /nobreak > nul
echo.
echo Server output:
type test-output.log
del test-output.log
taskkill /F /IM node.exe > nul 2>&1
