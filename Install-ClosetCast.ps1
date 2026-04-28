param(
  [string]$InstallDir = "$env:USERPROFILE\ClosetCast",
  [string]$RepoOwner = "ejor5",
  [string]$RepoName = "ClosetCast",
  [string]$Branch = "main",
  [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"

function Read-YesNo {
  param(
    [string]$Prompt,
    [bool]$Default = $true
  )

  $suffix = if ($Default) { "Y/n" } else { "y/N" }
  while ($true) {
    $answer = Read-Host "$Prompt ($suffix)"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    if ($answer -match "^(y|yes)$") { return $true }
    if ($answer -match "^(n|no)$") { return $false }
    Write-Host "Please enter y or n."
  }
}

function Test-CommandExists {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget {
  param(
    [string]$PackageId,
    [string]$DisplayName
  )

  if (!(Test-CommandExists "winget")) {
    Write-Host "winget is not available. Please install $DisplayName manually, then rerun this command."
    return
  }

  if (Read-YesNo "$DisplayName is missing. Install it with winget now?" $true) {
    winget install --id $PackageId --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "$DisplayName install failed with exit code $LASTEXITCODE."
    }
  }
}

function Get-NpmCommand {
  $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }

  $common = "C:\Program Files\nodejs\npm.cmd"
  if (Test-Path -LiteralPath $common) { return $common }
  return $null
}

function Find-FfmpegPath {
  $command = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

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

function Add-CommonToolPaths {
  $paths = @(
    "C:\Program Files\nodejs",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links"
  )

  foreach ($path in $paths) {
    if ((Test-Path -LiteralPath $path) -and ($env:Path -notlike "*$path*")) {
      $env:Path = "$path;$env:Path"
    }
  }
}

function Install-RepoArchive {
  param(
    [string]$TargetDir,
    [string]$Owner,
    [string]$Name,
    [string]$Ref
  )

  $zipUrl = "https://github.com/$Owner/$Name/archive/refs/heads/$Ref.zip"
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("closetcast-" + [guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot "closetcast.zip"
  $extractPath = Join-Path $tempRoot "extract"

  try {
    New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath | Out-Null
    Write-Host "Downloading ClosetCast from $zipUrl"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

    $source = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
    if ($null -eq $source) { throw "Downloaded archive did not contain a project folder." }

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    $items = Get-ChildItem -LiteralPath $source.FullName -Force
    foreach ($item in $items) {
      Copy-Item -LiteralPath $item.FullName -Destination $TargetDir -Recurse -Force
    }

    if (!(Test-Path -LiteralPath (Join-Path $TargetDir "package.json"))) {
      throw "Install copy failed: package.json was not found in $TargetDir."
    }
  } finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
  }
}

function New-DesktopShortcut {
  param([string]$TargetDir)

  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "ClosetCast.lnk"
  $targetPath = Join-Path $TargetDir "Start-ClosetCast.cmd"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.WorkingDirectory = $TargetDir
  $shortcut.Description = "Start ClosetCast"
  $shortcut.Save()
  Write-Host "Created desktop shortcut: $shortcutPath"
}

Write-Host ""
Write-Host "ClosetCast one-command installer"
Write-Host "--------------------------------"
Write-Host "Install folder: $InstallDir"
Write-Host ""

Add-CommonToolPaths

if (!(Test-CommandExists "node")) {
  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  Add-CommonToolPaths
}

$npmCommand = Get-NpmCommand
if ($null -eq $npmCommand) {
  Write-Host "npm.cmd was not found. Install Node.js LTS, then rerun this command."
  exit 1
}

if (!(Test-CommandExists "ffmpeg") -and [string]::IsNullOrWhiteSpace((Find-FfmpegPath))) {
  Install-WithWinget "Gyan.FFmpeg" "FFmpeg"
  Add-CommonToolPaths
}

$ffmpegPath = Find-FfmpegPath
if (![string]::IsNullOrWhiteSpace($ffmpegPath)) {
  $env:CLOSETCAST_FFMPEG_PATH = $ffmpegPath
  Write-Host "Found FFmpeg: $ffmpegPath"
} else {
  Write-Host "FFmpeg still was not found. The setup wizard will ask for ffmpeg.exe, or you can install it later."
}

if ((Test-Path -LiteralPath $InstallDir) -and !(Read-YesNo "ClosetCast already exists here. Update files in place?" $true)) {
  Write-Host "Keeping existing files."
} else {
  Install-RepoArchive -TargetDir $InstallDir -Owner $RepoOwner -Name $RepoName -Ref $Branch
}

Push-Location $InstallDir
try {
  if (!(Test-Path -LiteralPath (Join-Path $InstallDir "package.json"))) {
    throw "ClosetCast files are incomplete in $InstallDir. Rerun this installer and answer Y when asked to update files in place."
  }

  Write-Host "Installing app dependencies..."
  & $npmCommand install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE."
  }

  if (!$SkipSetup) {
    Write-Host ""
    Write-Host "Starting setup wizard. Paste camera and calendar links when prompted."
    $setupScript = Join-Path $InstallDir "Setup-ClosetCast.cmd"
    if (!(Test-Path -LiteralPath $setupScript)) {
      throw "Setup wizard was not found at $setupScript."
    }
    & $setupScript
    if ($LASTEXITCODE -ne 0) {
      throw "Setup wizard failed with exit code $LASTEXITCODE."
    }
  }

  if (Read-YesNo "Create a Desktop shortcut for ClosetCast?" $true) {
    New-DesktopShortcut -TargetDir $InstallDir
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "ClosetCast is ready."
Write-Host "Install folder: $InstallDir"
Write-Host "Start command: $InstallDir\Start-ClosetCast.cmd"
