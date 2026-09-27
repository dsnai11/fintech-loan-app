@echo off
title LIFC Admin Portal Server
color 0A
echo.
echo  ========================================
echo    LIFC SuperAdmin Portal
echo    Laxmi India Finance Ltd.
echo  ========================================
echo.
echo  Starting server on port 8080...
echo.
echo  Access from this PC:
echo    http://localhost:8080
echo.
echo  Access from phone / other devices on WiFi:
echo    http://192.168.1.60:8080
echo.
echo  Press Ctrl+C to stop the server.
echo.
node "%~dp0server.js"
pause
