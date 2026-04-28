param(
  [string]$WakeTaskName = "ClosetCast Wake",
  [string]$SleepTaskName = "ClosetCast Backup Sleep"
)

$ErrorActionPreference = "Stop"

foreach ($taskName in @($WakeTaskName, $SleepTaskName)) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    Write-Host "Scheduled task '$taskName' was not found."
    continue
  }

  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed scheduled task '$taskName'."
}
