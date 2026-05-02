param(
  [ValidateSet("normal", "ambient", "yankees", "winddown")]
  [string]$Mode = "normal",
  [switch]$UseExistingConfig,
  [switch]$PromptForLinks
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-CommandPath {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Find-FfmpegPath {
  if (![string]::IsNullOrWhiteSpace($env:CLOSETCAST_FFMPEG_PATH) -and (Test-Path -LiteralPath $env:CLOSETCAST_FFMPEG_PATH)) {
    return (Resolve-Path -LiteralPath $env:CLOSETCAST_FFMPEG_PATH).Path
  }

  $commandPath = Find-CommandPath "ffmpeg"
  if (![string]::IsNullOrWhiteSpace($commandPath)) {
    return $commandPath
  }

  $roots = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
    "$env:ProgramFiles",
    "${env:ProgramFiles(x86)}"
  ) | Where-Object { ![string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_) }

  foreach ($root in $roots) {
    $match = Get-ChildItem -LiteralPath $root -Recurse -Filter "ffmpeg.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "ffmpeg" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($match) { return $match.FullName }
  }

  return $null
}

function Get-FreePort {
  param([int]$StartPort = 4657)

  for ($port = $StartPort; $port -lt ($StartPort + 100); $port++) {
    $listener = $null
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
      $listener.Start()
      return $port
    } catch {
      continue
    } finally {
      if ($null -ne $listener) {
        $listener.Stop()
      }
    }
  }

  throw "Could not find a free local test port starting at $StartPort."
}

function Test-PlaceholderUrl {
  param([string]$Url)
  return [string]::IsNullOrWhiteSpace($Url) -or $Url -match "username:password"
}

function Read-KeepOrReplace {
  param(
    [string]$Prompt,
    [string]$CurrentValue,
    [switch]$TreatCurrentAsPlaceholder
  )

  if (![string]::IsNullOrWhiteSpace($CurrentValue) -and !$TreatCurrentAsPlaceholder) {
    $answer = Read-Host "$Prompt (leave blank to keep saved value)"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $CurrentValue }
    return $answer
  }

  return Read-Host "$Prompt (leave blank to disable for this test)"
}

function Set-TestCamera {
  param(
    [object]$Config,
    [string]$Id,
    [string]$Label
  )

  $camera = $Config.cameras | Where-Object { $_.id -eq $Id } | Select-Object -First 1
  if ($null -eq $camera) {
    throw "Camera '$Id' is missing from config template."
  }

  $isPlaceholder = Test-PlaceholderUrl $camera.url
  $url = Read-KeepOrReplace "Paste RTSP URL for $Label" $camera.url -TreatCurrentAsPlaceholder:$isPlaceholder
  $camera.url = $url
  $camera.enabled = -not [string]::IsNullOrWhiteSpace($url)
}

function Ensure-CalendarSlots {
  param([object]$Config)

  if ($null -eq $Config.calendar) {
    $Config | Add-Member -NotePropertyName "calendar" -NotePropertyValue ([pscustomobject]@{})
  }
  if ($null -eq $Config.calendar.PSObject.Properties["icsUrls"]) {
    $Config.calendar | Add-Member -NotePropertyName "icsUrls" -NotePropertyValue @()
  }

  $slots = @()
  for ($i = 0; $i -lt 3; $i++) {
    if ($Config.calendar.icsUrls.Count -gt $i) {
      $slots += $Config.calendar.icsUrls[$i]
    } else {
      $slots += [pscustomobject]@{ name = "Apple Calendar $($i + 1)"; url = "" }
    }
  }
  $Config.calendar.icsUrls = $slots
}

function Set-TestCalendars {
  param([object]$Config)

  Ensure-CalendarSlots $Config
  $calendarEnabled = $false
  for ($i = 0; $i -lt 3; $i++) {
    $slot = $Config.calendar.icsUrls[$i]
    $url = Read-KeepOrReplace "Paste Apple Calendar $($i + 1) webcal/.ics URL" $slot.url
    $slot.name = "Apple Calendar $($i + 1)"
    $slot.url = $url
    if (![string]::IsNullOrWhiteSpace($url)) {
      $calendarEnabled = $true
    }
  }
  $Config.calendar.enabled = $calendarEnabled
}

function Set-TestLinks {
  param([object]$Config)

  Write-Host ""
  Write-Host "Test camera links"
  Write-Host "Paste real RTSP links here. They go only into .closetcast-test\config.test.json."
  Set-TestCamera $Config "garage" "Garage"
  Set-TestCamera $Config "front-yard" "Front Yard"
  Set-TestCamera $Config "back-yard" "Back Yard"
  Set-TestCamera $Config "side-yard" "Side Yard"
  Set-TestCamera $Config "ring-doorbell" "Ring Doorbell"

  Write-Host ""
  Write-Host "Test Apple calendars"
  Set-TestCalendars $Config

  Write-Host ""
  if ($null -eq $Config.yankees.PSObject.Properties["streamSiteUrl"]) {
    $Config.yankees | Add-Member -NotePropertyName "streamSiteUrl" -NotePropertyValue ""
  }

  $savedStreamSiteUrl = $Config.yankees.streamSiteUrl
  $legacyStreamSiteProperty = $Config.yankees.PSObject.Properties[("stream" + "eastUrl")]
  if ([string]::IsNullOrWhiteSpace($savedStreamSiteUrl) -and $legacyStreamSiteProperty) {
    $savedStreamSiteUrl = $legacyStreamSiteProperty.Value
  }

  $streamSiteUrl = Read-Host "Yankees stream site base URL for this test [$savedStreamSiteUrl]"
  if (![string]::IsNullOrWhiteSpace($streamSiteUrl)) {
    $Config.yankees.streamSiteUrl = $streamSiteUrl
  } else {
    $Config.yankees.streamSiteUrl = $savedStreamSiteUrl
  }

  $ffmpegPath = Find-FfmpegPath
  if (![string]::IsNullOrWhiteSpace($ffmpegPath)) {
    $Config.ffmpegPath = $ffmpegPath
    Write-Host "Using FFmpeg: $ffmpegPath"
  } else {
    $answer = Read-Host "ffmpeg.exe was not found. Paste full path, or leave blank to use 'ffmpeg'"
    $Config.ffmpegPath = if ([string]::IsNullOrWhiteSpace($answer)) { "ffmpeg" } else { $answer }
  }
}

$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectPath ".closetcast-test"
$testConfigPath = Join-Path $runtimeDir "config.test.json"
$userDataDir = Join-Path $runtimeDir "electron-user-data"
$sourceConfigPath = if ($UseExistingConfig -and (Test-Path -LiteralPath (Join-Path $projectPath "config.json"))) {
  Join-Path $projectPath "config.json"
} elseif ((Test-Path -LiteralPath $testConfigPath) -and $PromptForLinks) {
  $testConfigPath
} else {
  Join-Path $projectPath "config.example.json"
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
$config = Get-Content -LiteralPath $sourceConfigPath -Raw | ConvertFrom-Json

if ($PromptForLinks) {
  Set-TestLinks $config
}

$config.fullscreenOnLaunch = $false
$config.autostartOnLogin = $false
$config.media.enabled = $false
$config.streamServer.port = Get-FreePort 4657
$config.dayCycle.enabled = $true
$config.dayCycle.triggerSleepFromApp = $false
$config.dayCycle.installWakeTask = $false
$config.dayCycle.installBackupSleepTask = $false
$config.ambientYouTube.enabled = $true
$config.ambientYouTube.startTime = "00:00"
$config.ambientYouTube.endTime = "23:59"
$config.ambientYouTube.directVideos = @()
$config.ambientYouTube.searchTopics = @(
  [pscustomobject]@{
    title = "Mattercam live"
    query = "Mattercam live"
    enabled = $true
  }
)
if ($null -eq $config.PSObject.Properties["debug"]) {
  $config | Add-Member -NotePropertyName "debug" -NotePropertyValue ([pscustomobject]@{})
}
$config.debug = [pscustomobject]@{
  enabled = $true
  forceMode = $Mode
  ambientTitle = "Mattercam live"
  ambientUrl = ""
  yankeesUrl = $config.yankees.streamSiteUrl
  resolveYankeesNow = $true
}

$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($testConfigPath, ($config | ConvertTo-Json -Depth 20), $encoding)

Write-Host ""
Write-Host "Starting ClosetCast UI test mode: $Mode"
Write-Host "Fullscreen, autostart, wake tasks, and sleep trigger are disabled."
Write-Host "Press F6 inside the app to cycle: normal -> Mattercam -> Yankees resolver -> wind-down."
Write-Host "Test config: $testConfigPath"
Write-Host "Test stream port: $($config.streamServer.port)"
Write-Host ""

if (!(Test-CommandExists "npm.cmd")) {
  throw "npm.cmd was not found. Install Node.js with npm, then rerun this test."
}

$command = "`$env:CLOSETCAST_CONFIG = '$testConfigPath'; `$env:CLOSETCAST_USER_DATA_DIR = '$userDataDir'; Set-Location '$projectPath'; npm.cmd start"
Start-Process powershell.exe -ArgumentList "-NoProfile", "-NoExit", "-Command", $command -WorkingDirectory $projectPath
