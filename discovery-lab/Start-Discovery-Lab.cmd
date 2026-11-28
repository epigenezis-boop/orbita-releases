@echo off
cd /d "%~dp0"
where node.exe >nul 2>nul || (echo Install Node.js 18 or newer first. & pause & exit /b 1)
node lab-server.mjs
pause
