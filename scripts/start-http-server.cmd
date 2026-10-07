@echo off
rem Starts the jev-mcp Streamable HTTP server in this window (Windows).
rem Double-click to run. Close the window or press Ctrl+C to stop.
rem Needs JEV_HTTP_TOKEN in .env at the repository root (see docs/clients.md).
setlocal
title jev-mcp HTTP server (close this window to stop)
cd /d "%~dp0.."

if not exist "dist\transport\http.js" (
  echo Building jev-mcp...
  call npm run build || goto :failed
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8098 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo Port 8098 is already in use; the server is probably running already.
  echo Run scripts\stop-http-server.cmd first to restart it.
  pause
  exit /b 1
)

node dist\transport\http.js
echo.
echo The server stopped.
pause
exit /b 0

:failed
echo Build failed.
pause
exit /b 1
