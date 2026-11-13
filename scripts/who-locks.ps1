param([string]$TargetPath = $(throw "Pass -TargetPath"))
# Identify processes holding a lock on a file via the Windows Restart Manager API.
$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class RestartManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
}
'@
Add-Type -TypeDefinition $code -Language CSharp

$handle = [uint32]0
$key = [Guid]::NewGuid().ToString()
$res = [RestartManager]::RmStartSession([ref]$handle, 0, $key)
if ($res -ne 0) { throw "RmStartSession failed: $res" }
try {
  $res = [RestartManager]::RmRegisterResources($handle, 1, @($TargetPath), 0, $null, 0, $null)
  if ($res -ne 0) { throw "RmRegisterResources failed: $res" }
  $needed = [uint32]0; $count = [uint32]10; $reasons = [uint32]0
  $info = New-Object RestartManager+RM_PROCESS_INFO[] 10
  $res = [RestartManager]::RmGetList($handle, [ref]$needed, [ref]$count, $info, [ref]$reasons)
  if ($res -ne 0) { throw "RmGetList failed: $res" }
  if ($count -eq 0) { Write-Output "NO PROCESS holds a lock on: $TargetPath"; return }
  Write-Output "$needed process(es) lock this file:"
  for ($i = 0; $i -lt $count; $i++) {
    $pid2 = $info[$i].Process.dwProcessId
    $app = $info[$i].strAppName
    $proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
    Write-Output ("  PID {0}  '{1}'  exe={2}" -f $pid2, $app, $proc.Path)
  }
} finally { [RestartManager]::RmEndSession($handle) | Out-Null }
