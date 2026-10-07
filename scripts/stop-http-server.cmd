@echo off
rem Stops the jev-mcp Streamable HTTP server listening on port 8098 (Windows).
rem Double-click to run. Only stops a node process, never anything else on the port.
setlocal
powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalPort 8098 -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { 'The jev-mcp HTTP server is not running.'; exit 0 }" ^
  "foreach ($id in ($c.OwningProcess | Select-Object -Unique)) {" ^
  "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue;" ^
  "  if ($p.ProcessName -eq 'node') { Stop-Process -Id $id -Force; 'Stopped the jev-mcp HTTP server (process ' + $id + ').' }" ^
  "  else { 'Port 8098 is used by ' + $p.ProcessName + ', not jev-mcp; nothing was stopped.' }" ^
  "}"
pause
