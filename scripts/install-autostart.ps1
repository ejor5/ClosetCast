param(
  [string]$TaskName = "ClosetCast",
  [string]$ProjectPath = "",
  [string]$AppPath = "",
  [switch]$UsePackagedApp
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
  $ProjectPath = Split-Path -Parent $PSScriptRoot
}

$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path

if ($UsePackagedApp) {
  if ([string]::IsNullOrWhiteSpace($AppPath)) {
    $candidate = Join-Path $ProjectPath "dist\ClosetCast.exe"
    if (Test-Path -LiteralPath $candidate) {
      $AppPath = $candidate
    } else {
      throw "Pass -AppPath with the packaged ClosetCast.exe path, or run without -UsePackagedApp for npm startup."
    }
  }

  $AppPath = (Resolve-Path -LiteralPath $AppPath).Path
  $action = New-ScheduledTaskAction -Execute $AppPath -WorkingDirectory (Split-Path -Parent $AppPath)
} else {
  $npm = Get-Command "npm.cmd" -ErrorAction Stop
  $action = New-ScheduledTaskAction -Execute $npm.Source -Argument "start" -WorkingDirectory $ProjectPath
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts ClosetCast at user logon."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host "Installed scheduled task '$TaskName'. ClosetCast will start when $env:USERNAME logs in."
Write-Host "Project: $ProjectPath"
