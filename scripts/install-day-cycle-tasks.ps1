param(
  [string]$WakeTaskName = "ClosetCast Wake",
  [string]$SleepTaskName = "ClosetCast Backup Sleep",
  [string]$ProjectPath = "",
  [string]$WakeTime = "09:00",
  [string]$SleepTime = "22:30",
  [string]$ExtraSleepWindowsJson = "[]",
  [switch]$InstallBackupSleep,
  [string]$AppPath = "",
  [switch]$UsePackagedApp
)

$ErrorActionPreference = "Stop"

function Convert-Time {
  param([string]$TimeText)
  return [datetime]::ParseExact($TimeText, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Convert-DayName {
  param([string]$Day)
  $text = [System.Globalization.CultureInfo]::InvariantCulture.TextInfo.ToTitleCase($Day.ToLowerInvariant())
  return [System.Enum]::Parse([System.DayOfWeek], $text, $true)
}

function Convert-ExtraSleepWindows {
  param([string]$Json)
  if ([string]::IsNullOrWhiteSpace($Json)) { return @() }
  $windows = @($Json | ConvertFrom-Json)
  return @($windows | Where-Object {
    $null -ne $_ -and
    $_.days.Count -gt 0 -and
    $_.startTime -match "^\d{2}:\d{2}$" -and
    $_.endTime -match "^\d{2}:\d{2}$"
  })
}

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
  $ProjectPath = Split-Path -Parent $PSScriptRoot
}

$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$extraSleepWindows = Convert-ExtraSleepWindows $ExtraSleepWindowsJson

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
$wakeTriggers = @($wakeTrigger)
foreach ($window in $extraSleepWindows) {
  $days = @($window.days | ForEach-Object { Convert-DayName $_ })
  $wakeTriggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At (Convert-Time $window.endTime)
}
$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$wakeTask = New-ScheduledTask -Action $wakeAction -Trigger $wakeTriggers -Settings $settings -Principal $principal -Description "Wakes the laptop and starts or focuses ClosetCast."

Register-ScheduledTask -TaskName $WakeTaskName -InputObject $wakeTask -Force | Out-Null
Write-Host "Installed wake task '$WakeTaskName' for $WakeTime."
foreach ($window in $extraSleepWindows) {
  Write-Host "Added wake trigger after '$($window.label)' at $($window.endTime)."
}

if ($InstallBackupSleep) {
  $sleepScript = Join-Path $PSScriptRoot "sleep-now.ps1"
  $sleepAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$sleepScript`"" -WorkingDirectory $ProjectPath
  $sleepTrigger = New-ScheduledTaskTrigger -Daily -At (Convert-Time $SleepTime)
  $sleepTriggers = @($sleepTrigger)
  foreach ($window in $extraSleepWindows) {
    $days = @($window.days | ForEach-Object { Convert-DayName $_ })
    $sleepTriggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At (Convert-Time $window.startTime)
  }
  $sleepTask = New-ScheduledTask -Action $sleepAction -Trigger $sleepTriggers -Settings $settings -Principal $principal -Description "Backup sleep task for ClosetCast."

  Register-ScheduledTask -TaskName $SleepTaskName -InputObject $sleepTask -Force | Out-Null
  Write-Host "Installed backup sleep task '$SleepTaskName' for $SleepTime."
  foreach ($window in $extraSleepWindows) {
    Write-Host "Added backup sleep trigger for '$($window.label)' at $($window.startTime)."
  }
}
