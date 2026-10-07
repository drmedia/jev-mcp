@echo off
rem Stops the jev-mcp Streamable HTTP server listening on port 8098 (Windows).
rem Double-click to run. Only stops a node process, never anything else on the port.
setlocal
powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalPort 8098 -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { 'The jev-mcp HTTP server is not running.'; exit 0 }" ^
  "$failed = $false;" ^
  "foreach ($id in ($c.OwningProcess | Select-Object -Unique)) {" ^
  "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue;" ^
  "  if ($p.ProcessName -ne 'node') { 'Port 8098 is used by ' + $p.ProcessName + ', not jev-mcp; nothing was stopped.'; continue }" ^
  "  try { Stop-Process -Id $id -Force -ErrorAction Stop; 'Stopped the jev-mcp HTTP server (process ' + $id + ').' }" ^
  "  catch { $failed = $true; 'Could not stop the jev-mcp HTTP server (process ' + $id + '): access denied.'; 'It was started by another user or with higher rights. Close its window, or run this script as administrator.' }" ^
  "}" ^
  "if ($failed) { exit 1 }"
pause
