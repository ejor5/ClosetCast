$ErrorActionPreference = "Stop"

Add-Type -Name PowerState -Namespace ClosetCast -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("powrprof.dll", SetLastError = true)]
public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);
"@

[void][ClosetCast.PowerState]::SetSuspendState($false, $false, $false)
