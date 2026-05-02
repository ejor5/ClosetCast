param(
  [ValidateSet("normal", "ambient", "yankees", "winddown")]
  [string]$Mode = "normal",
  [switch]$UseExistingConfig
)

$ErrorActionPreference = "Stop"

$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectPath ".closetcast-test"
$testConfigPath = Join-Path $runtimeDir "config.test.json"
$sourceConfigPath = if ($UseExistingConfig -and (Test-Path -LiteralPath (Join-Path $projectPath "config.json"))) {
  Join-Path $projectPath "config.json"
} else {
  Join-Path $projectPath "config.example.json"
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$config = Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json

$config.fullscreenOnLaunch = $false
$config.autostartOnLogin = $false
$config.media.enabled = $false
$config.streamServer.port = 4657
$config.dayCycle.enabled = $true
$config.dayCycle.triggerSleepFromApp = $false
$config.dayCycle.installWakeTask = $false
$config.dayCycle.installBackupSleepTask = $false
$config.ambientYouTube.enabled = $true
$config.ambientYouTube.startTime = "00:00"
$config.ambientYouTube.endTime = "23:59"
if ($null -eq $config.PSObject.Properties["debug"]) {
  $config | Add-Member -NotePropertyName "debug" -NotePropertyValue ([pscustomobject]@{})
}
$config.debug = [pscustomobject]@{
  enabled = $true
  forceMode = $Mode
  ambientUrl = "https://www.youtube.com/watch?v=9E-l9qYiqxQ&t=2725s&autoplay=1&mute=1"
  yankeesUrl = $config.yankees.streameastUrl
}

$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($testConfigPath, ($config | ConvertTo-Json -Depth 20), $encoding)

Write-Host ""
Write-Host "Starting ClosetCast UI test mode: $Mode"
Write-Host "Fullscreen, autostart, wake tasks, and sleep trigger are disabled."
Write-Host "Press F6 inside the app to cycle: normal -> ambient -> Yankees -> wind-down."
Write-Host "Test config: $testConfigPath"
Write-Host ""

$command = "`$env:CLOSETCAST_CONFIG = '$testConfigPath'; Set-Location '$projectPath'; npm.cmd start"
Start-Process powershell.exe -ArgumentList "-NoProfile", "-NoExit", "-Command", $command -WorkingDirectory $projectPath
