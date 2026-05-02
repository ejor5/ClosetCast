@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-ui-test.ps1" -PromptForLinks
if errorlevel 1 pause
