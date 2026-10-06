param([switch]$OpenSettings)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root '.local\native\LUCIFER.exe'
if(!(Test-Path $exe)){throw 'Installed LUCIFER launcher is missing. Run this project''s native installer.'}
function Promote-Installed-Icon {
  foreach($key in @(Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings' -ErrorAction SilentlyContinue)){
    $entry=Get-ItemProperty $key.PSPath
    if($entry.ExecutablePath -eq $exe -and $entry.IsPromoted -ne 1){Set-ItemProperty $key.PSPath -Name IsPromoted -Type DWord -Value 1}
  }
}
Promote-Installed-Icon
$arguments=@('--supervise');if($OpenSettings){$arguments+='--settings'}
$launcher=Start-Process $exe -ArgumentList $arguments -WorkingDirectory $root -PassThru
# The installed mutex/pipe path reuses an existing instance. Wait only for fresh
# current-session metadata, never infer visibility from an old status file.
$deadline=[DateTime]::UtcNow.AddSeconds(30)
$ready=$false
while([DateTime]::UtcNow -lt $deadline){
  try{
    $status=Get-Content (Join-Path $root '.local\native\status.json') -Raw|ConvertFrom-Json
    $fresh=([DateTime]::UtcNow-[DateTime]::Parse($status.updatedAt).ToUniversalTime()).TotalSeconds -lt 4
    $live=Get-Process -Id $status.processId -ErrorAction SilentlyContinue
    if($live -and $live.Path -eq $exe -and $fresh -and $status.sessionId -eq (Get-Process -Id $PID).SessionId -and $status.windowStation -eq 'WinSta0' -and $status.desktop -eq 'Default' -and (!$OpenSettings -or $status.settingsOpen)){$ready=$true;break}
  }catch{}
  if($launcher.HasExited -and $launcher.ExitCode -ne 0){throw 'LUCIFER launch failed; inspect the sanitized supervisor/tray event logs.'}
  Start-Sleep -Milliseconds 300
}
if(!$ready){throw 'No fresh LUCIFER status/settings window in the current interactive desktop. Inspect scripts/inspect-native-tray.ps1.'}
Promote-Installed-Icon
@{launcher=$exe;session=$status.sessionId;station=$status.windowStation;desktop=$status.desktop;trayPid=$status.processId;settingsOpen=$status.settingsOpen;tooltip=$status.tooltip}|ConvertTo-Json
