@echo off
echo ========================================
echo   MovieStream - TMDB API Key Setup
echo ========================================
echo.
echo Your backend is currently running with FALLBACK DATA.
echo.
echo To get REAL movie data from TMDB:
echo.
echo 1. Open your browser and go to:
echo    https://www.themoviedb.org/signup
echo.
echo 2. Create a FREE account (takes 1 minute)
echo.
echo 3. Go to your account settings:
echo    https://www.themoviedb.org/settings/api
echo.
echo 4. Click "Request API Key" - Choose "Developer"
echo.
echo 5. Fill in the form (use placeholder info for personal use):
echo    - Application Name: MovieStream
echo    - Application URL: http://localhost:5173
echo    - Application Summary: Personal movie streaming app
echo.
echo 6. Copy your API Key (v3 auth)
echo.
echo 7. Create a file: backend\.env
echo    And add this line:
echo    TMDB_API_KEY=your_api_key_here
echo.
echo 8. Restart your backend server
echo.
echo 9. Check http://localhost:5000/api/status
echo    You should see "configured": true
echo.
echo ========================================
echo   That's it! Fresh movies will load.
echo ========================================
echo.
pause
