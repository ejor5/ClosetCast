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
    $config.calendar.icsUrls[$i].url = $calendarUrl
    if (![string]::IsNullOrWhiteSpace($calendarUrl)) {
      $calendarEnabled = $true
    }
  }
  $config.calendar.enabled = $calendarEnabled

  Write-Host ""
  $primaryCamera = Read-Default "Primary camera id" "garage"
  $config.primaryCameraId = $primaryCamera
  $config.fullscreenOnLaunch = Read-YesNo "Start fullscreen/kiosk on launch?" $true
  $config.media.enabled = Read-YesNo "Enable local media rotation from the media folder?" $true
  $config.yankees.enabled = Read-YesNo "Enable Yankees auto mode?" $true
  $config.ambientYouTube.enabled = Read-YesNo "Enable rotating YouTube ambiance after noon?" $true
  $config.dayCycle.enabled = Read-YesNo "Enable 10 PM wind-down and 10:30 PM sleep?" $true
  $config.dayCycle.installWakeTask = Read-YesNo "Install 9 AM Windows wake task?" $true
  $config.dayCycle.installBackupSleepTask = Read-YesNo "Install backup 10:30 PM sleep task?" $false
  $config.autostartOnLogin = Read-YesNo "Start ClosetCast automatically when Windows logs in?" $true

  if (!(Test-CommandExists "ffmpeg")) {
    Write-Host ""
    Write-Host "ffmpeg was not found on PATH."
    $ffmpegPath = Read-Default "Paste full ffmpeg.exe path, or leave 'ffmpeg' if you will install it later" "ffmpeg"
    $config.ffmpegPath = $ffmpegPath
  }

  $json = $config | ConvertTo-Json -Depth 20
  Set-Content -LiteralPath $configPath -Value $json -Encoding UTF8
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
