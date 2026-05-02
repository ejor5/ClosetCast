$ErrorActionPreference = "Stop"

function Read-Default {
  param(
    [string]$Prompt,
    [string]$Default = ""
  )

  if ([string]::IsNullOrWhiteSpace($Default)) {
    return Read-Host $Prompt
  }

  $answer = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($answer)) {
    return $Default
  }
  return $answer
}

function Read-YesNo {
  param(
    [string]$Prompt,
    [bool]$Default = $true
  )

  $suffix = if ($Default) { "Y/n" } else { "y/N" }
  while ($true) {
    $answer = Read-Host "$Prompt ($suffix)"
    if ([string]::IsNullOrWhiteSpace($answer)) {
      return $Default
    }
    if ($answer -match "^(y|yes)$") { return $true }
    if ($answer -match "^(n|no)$") { return $false }
    Write-Host "Please enter y or n."
  }
}

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

function Set-Camera {
  param(
    [object]$Config,
    [string]$Id,
    [string]$Label
  )

  $camera = $Config.cameras | Where-Object { $_.id -eq $Id } | Select-Object -First 1
  if ($null -eq $camera) {
    throw "Camera '$Id' is missing from config template."
  }

  $url = Read-Default "Paste RTSP URL for $Label"
  $camera.url = $url
  $camera.enabled = -not [string]::IsNullOrWhiteSpace($url)
}

function Resolve-CameraId {
  param(
    [object]$Config,
    [string]$Default = "garage"
  )

  $enabled = @($Config.cameras | Where-Object { $_.enabled -ne $false } | Sort-Object priority)
  if ($enabled.Count -eq 0) { return $Default }

  Write-Host ""
  Write-Host "Primary camera options:"
  for ($i = 0; $i -lt $enabled.Count; $i++) {
    Write-Host "  $($i + 1). $($enabled[$i].name) [$($enabled[$i].id)]"
  }

  while ($true) {
    $answer = Read-Default "Primary camera number or id" $Default
    if ($answer -eq "0") { return $Default }
    if ($answer -match "^\d+$") {
      $index = [int]$answer - 1
      if ($index -ge 0 -and $index -lt $enabled.Count) {
        return $enabled[$index].id
      }
    }

    $match = $enabled | Where-Object {
      $_.id -eq $answer -or $_.name -eq $answer
    } | Select-Object -First 1
    if ($match) { return $match.id }

    Write-Host "Choose a number from the list, or paste one of the camera ids."
  }
}

function Ensure-CalendarSlots {
  param([object]$Config)

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

function Normalize-CalendarUrl {
  param([string]$Url)
  return $Url -replace "^webcal://", "https://"
}

function Write-JsonNoBom {
  param(
    [string]$Path,
    [object]$Value
  )

  $json = $Value | ConvertTo-Json -Depth 20
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $encoding)
}

function Repair-ConfigEncoding {
  param([string]$Path)

  if (!(Test-Path -LiteralPath $Path)) { return }
  $text = [System.IO.File]::ReadAllText($Path)
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 65279) {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text.TrimStart([char]65279), $encoding)
    Write-Host "Repaired config.json UTF-8 encoding."
  }
}

$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$templatePath = Join-Path $projectPath "config.example.json"
$configPath = Join-Path $projectPath "config.json"

Write-Host ""
Write-Host "ClosetCast setup"
Write-Host "----------------"
Write-Host "This writes your private camera/calendar links to config.json."
Write-Host "config.json is ignored by git."
Write-Host ""

if (!(Test-Path -LiteralPath $templatePath)) {
  throw "Could not find config.example.json at $templatePath"
}

if ((Test-Path -LiteralPath $configPath) -and !(Read-YesNo "config.json already exists. Replace it?" $false)) {
  Repair-ConfigEncoding $configPath
  Write-Host "Keeping existing config.json."
} else {
  $config = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json

  Write-Host ""
  Write-Host "Camera links"
  Write-Host "Paste each RTSP URL. Leave blank to disable that camera for now."
  Set-Camera $config "garage" "Garage"
  Set-Camera $config "front-yard" "Front Yard"
  Set-Camera $config "back-yard" "Back Yard"
  Set-Camera $config "side-yard" "Side Yard"
  Set-Camera $config "ring-doorbell" "Ring Doorbell"

  Write-Host ""
  Write-Host "Optional Apple Calendar"
  Ensure-CalendarSlots $config
  $calendarEnabled = $false
  for ($i = 0; $i -lt 3; $i++) {
    $calendarUrl = Read-Default "Paste Apple Calendar $($i + 1) .ics URL, or leave blank"
    $config.calendar.icsUrls[$i].name = "Apple Calendar $($i + 1)"
    $config.calendar.icsUrls[$i].url = Normalize-CalendarUrl $calendarUrl
    if (![string]::IsNullOrWhiteSpace($calendarUrl)) {
      $calendarEnabled = $true
    }
  }
  $config.calendar.enabled = $calendarEnabled

  Write-Host ""
  $config.primaryCameraId = Resolve-CameraId $config "garage"
  $config.fullscreenOnLaunch = Read-YesNo "Start fullscreen/kiosk on launch?" $true
  $config.media.enabled = Read-YesNo "Enable local media rotation from the media folder?" $true
  $config.yankees.enabled = Read-YesNo "Enable Yankees auto mode?" $true
  if ($null -eq $config.yankees.PSObject.Properties["streamSiteUrl"]) {
    $config.yankees | Add-Member -NotePropertyName "streamSiteUrl" -NotePropertyValue ""
  }
  if ($config.yankees.enabled) {
    $config.yankees.streamSiteUrl = Read-Default "Paste Yankees stream site base URL"
  }
  $config.ambientYouTube.enabled = Read-YesNo "Enable rotating YouTube ambiance after noon?" $true
  $config.dayCycle.enabled = Read-YesNo "Enable 10 PM wind-down and 10:30 PM sleep?" $true
  $config.dayCycle.installWakeTask = Read-YesNo "Install 9 AM Windows wake task?" $true
  $config.dayCycle.installBackupSleepTask = Read-YesNo "Install backup 10:30 PM sleep task?" $false
  $config.autostartOnLogin = Read-YesNo "Start ClosetCast automatically when Windows logs in?" $true

  $ffmpegPath = Find-FfmpegPath
  if (![string]::IsNullOrWhiteSpace($ffmpegPath)) {
    $config.ffmpegPath = $ffmpegPath
    Write-Host "Using FFmpeg: $ffmpegPath"
  } else {
    Write-Host ""
    Write-Host "ffmpeg was not found on PATH."
    $ffmpegPath = Read-Default "Paste full ffmpeg.exe path, or leave 'ffmpeg' if you will install it later" "ffmpeg"
    $config.ffmpegPath = $ffmpegPath
  }

  Write-JsonNoBom $configPath $config
  Write-Host ""
  Write-Host "Wrote $configPath"
}

Write-Host ""
if (!(Test-CommandExists "node")) {
  Write-Host "Node.js was not found. Install Node.js 20+ and rerun this setup."
  exit 1
}

if (!(Test-CommandExists "npm.cmd")) {
  Write-Host "npm.cmd was not found. Reinstall Node.js with npm and rerun this setup."
  exit 1
}

if (!(Test-Path -LiteralPath (Join-Path $projectPath "node_modules"))) {
  Write-Host "Installing ClosetCast dependencies..."
  Push-Location $projectPath
  try {
    npm.cmd install
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Dependencies already installed."
}

Write-Host "Validating config..."
Push-Location $projectPath
try {
  node scripts\validate-config.js config.json
} finally {
  Pop-Location
}

$currentConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($currentConfig.autostartOnLogin) {
  Write-Host "Installing Windows autostart task..."
  & (Join-Path $PSScriptRoot "install-autostart.ps1") -ProjectPath $projectPath
}

if ($currentConfig.dayCycle.installWakeTask) {
  Write-Host "Installing Windows wake/sleep schedule tasks..."
  $dayCycleArgs = @{
    ProjectPath = $projectPath
    WakeTime = $currentConfig.dayCycle.wakeTime
    SleepTime = $currentConfig.dayCycle.sleepTime
  }
  if ($currentConfig.dayCycle.installBackupSleepTask) {
    & (Join-Path $PSScriptRoot "install-day-cycle-tasks.ps1") @dayCycleArgs -InstallBackupSleep
  } else {
    & (Join-Path $PSScriptRoot "install-day-cycle-tasks.ps1") @dayCycleArgs
  }
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Run Start-ClosetCast.cmd to launch the app."
Write-Host "Your local config is at: $configPath"
