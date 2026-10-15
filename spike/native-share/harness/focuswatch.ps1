# Read-only: logs which process is in the foreground and whether a game window is minimized, only
# when something changes (5 checks per second). It never touches a window and never records titles,
# only process names, so it can run while someone plays.
#
# usage: powershell -File focuswatch.ps1 <outFile> [gameProcess=VALORANT-Win64-Shipping] [maxMinutes=20]
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$GameProcess = "VALORANT-Win64-Shipping",
  [int]$MaxMinutes = 20
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
}
"@

function Describe($h) {
  if ($h -eq [IntPtr]::Zero) { return "none" }
  $pid_ = 0
  [void][Fg]::GetWindowThreadProcessId($h, [ref]$pid_)
  $name = try { (Get-Process -Id $pid_ -ErrorAction Stop).ProcessName } catch { "?" }
  $cls = New-Object System.Text.StringBuilder 128
  [void][Fg]::GetClassName($h, $cls, 128)
  $ex = "0x{0:x}" -f [Fg]::GetWindowLong($h, -20)
  return "$name [$cls] ex=$ex"
}

$start = Get-Date
$last = ""
"# focuswatch started $(Get-Date -Format o); game process $GameProcess" | Out-File $Out -Encoding utf8
while (((Get-Date) - $start).TotalMinutes -lt $MaxMinutes) {
  $game = [IntPtr]::Zero
  $found = Get-Process -Name $GameProcess -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $game = $found.MainWindowHandle }
  $gameState = if ($game -eq [IntPtr]::Zero) { "game=absent" } else { "game=" + $(if ([Fg]::IsIconic($game)) { "MINIMIZED" } else { "open" }) }
  $line = "fg=" + (Describe ([Fg]::GetForegroundWindow())) + " | " + $gameState
  if ($line -ne $last) {
    "{0} {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $line | Out-File $Out -Append -Encoding utf8
    $last = $line
  }
  Start-Sleep -Milliseconds 200
}
"# focuswatch ended $(Get-Date -Format o)" | Out-File $Out -Append -Encoding utf8
