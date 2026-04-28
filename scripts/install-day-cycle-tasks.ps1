param(
  [string]$WakeTaskName = "ClosetCast Wake",
  [string]$SleepTaskName = "ClosetCast Backup Sleep",
  [string]$ProjectPath = "",
  [string]$WakeTime = "09:00",
  [string]$SleepTime = "22:30",
  [switch]$InstallBackupSleep,
  [string]$AppPath = "",
  [switch]$UsePackagedApp
)

$ErrorActionPreference = "Stop"

function Convert-Time {
  param([string]$TimeText)
  return [datetime]::ParseExact($TimeText, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
}

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
  $ProjectPath = Split-Path -Parent $PSScriptRoot
}

$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path

if ($UsePackagedApp) {
  if ([string]::IsNullOrWhiteSpace($AppPath)) {
    throw "Pass -AppPath with the packaged ClosetCast executable path."
  }
  $AppPath = (Resolve-Path -LiteralPath $AppPath).Path
  $wakeAction = New-ScheduledTaskAction -Execute $AppPath -WorkingDirectory (Split-Path -Parent $AppPath)
} else {
  $npm = Get-Command "npm.cmd" -ErrorAction Stop
  $wakeAction = New-ScheduledTaskAction -Execute $npm.Source -Argument "start" -WorkingDirectory $ProjectPath
}

$wakeTrigger = New-ScheduledTaskTrigger -Daily -At (Convert-Time $WakeTime)
$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel LeastPrivilege
$wakeTask = New-ScheduledTask -Action $wakeAction -Trigger $wakeTrigger -Settings $settings -Principal $principal -Description "Wakes the laptop and starts or focuses ClosetCast."

Register-ScheduledTask -TaskName $WakeTaskName -InputObject $wakeTask -Force | Out-Null
Write-Host "Installed wake task '$WakeTaskName' for $WakeTime."

if ($InstallBackupSleep) {
  $sleepScript = Join-Path $PSScriptRoot "sleep-now.ps1"
  $sleepAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$sleepScript`"" -WorkingDirectory $ProjectPath
  $sleepTrigger = New-ScheduledTaskTrigger -Daily -At (Convert-Time $SleepTime)
  $sleepTask = New-ScheduledTask -Action $sleepAction -Trigger $sleepTrigger -Settings $settings -Principal $principal -Description "Backup sleep task for ClosetCast."

  Register-ScheduledTask -TaskName $SleepTaskName -InputObject $sleepTask -Force | Out-Null
  Write-Host "Installed backup sleep task '$SleepTaskName' for $SleepTime."
}
