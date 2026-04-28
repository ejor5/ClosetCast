@echo off
setlocal
cd /d "%~dp0"
if not exist "config.json" (
  echo config.json was not found.
  echo Run Setup-ClosetCast.cmd first.
  pause
  exit /b 1
)
npm.cmd start
