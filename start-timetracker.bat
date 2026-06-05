@echo off
title TimeTracker Pro - Startup
color 0A
echo.
echo  =============================================
echo   TimeTracker Pro - Starting...
echo  =============================================
echo.

:: Start the Node.js server in a new window
echo  [1/2] Starting API server...
start "TimeTracker - Server" cmd /k "cd /d "C:\Users\Soundarya Ram\Downloads\timetracker-pro (2)" && npm run dev:server"

:: Wait 4 seconds for server to start
timeout /t 4 /nobreak > nul

:: Start the Cloudflare tunnel in a new window
echo  [2/2] Starting Cloudflare tunnel...
start "TimeTracker - Tunnel" cmd /k "cloudflared tunnel --config "C:\Users\Soundarya Ram\.cloudflared\config.yml" run timetracker"

echo.
echo  =============================================
echo   Both services started!
echo   App URL: https://timetracker.innovalqtechnologies.com
echo  =============================================
echo.
pause
