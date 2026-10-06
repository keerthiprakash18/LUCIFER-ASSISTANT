$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root '.local\native\LUCIFER.exe'
function Installed-Processes{@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'LUCIFER.exe' -and $_.ExecutablePath -eq $exe})}
function Snapshot {
  $processes=Installed-Processes
  $supervisors=@($processes|Where-Object {$_.CommandLine -match '--supervise'})
  $trays=@($processes|Where-Object {$_.CommandLine -match '--tray'})
  if($supervisors.Count -ne 1 -or $trays.Count -ne 1){throw 'Expected exactly one installed supervisor and one tray.'}
  $status=(& (Join-Path $PSScriptRoot 'native-control.ps1') -Action state)|ConvertFrom-Json
  if($status.processId -ne $trays[0].ProcessId -or $status.sessionId -ne (Get-Process -Id $PID).SessionId -or $status.windowStation -ne 'WinSta0' -or $status.desktop -ne 'Default'){throw 'Tray/status does not match the current interactive desktop.'}
  if(([DateTime]::UtcNow-[DateTime]::Parse($status.updatedAt).ToUniversalTime()).TotalSeconds -gt 4){throw 'Native status is stale.'}
  if(!(Get-Process -Id $status.processId).Responding){throw 'Native UI is not responding.'}
  return @{at=[DateTime]::UtcNow.ToString('o');supervisorPid=$supervisors[0].ProcessId;trayPid=$trays[0].ProcessId;workerPid=$status.workerId;pythonPid=$status.pythonId;state=$status.state;session=$status.sessionId;updatedAt=$status.updatedAt}
}
$protected=@('.local\ai-credentials.key','.local\ai-credentials.enc','.local\native\credential.bin','.env')
$hashes=@{};foreach($relative in $protected){$file=Join-Path $root $relative;if(Test-Path $file){$hashes[$relative]=(Get-FileHash $file -Algorithm SHA256).Hash}}
$first=Snapshot
# Capture the requested window immediately. The owner may legitimately save or
# close it during the sustained process check; that is not a runtime failure.
$duplicate=Start-Process $exe -ArgumentList '--supervise','--settings' -WorkingDirectory $root -PassThru
if(!$duplicate.WaitForExit(10000) -or $duplicate.ExitCode -ne 0){throw 'Recovery launch did not reuse the existing supervisor.'}
Start-Sleep -Seconds 1
$opened=(& (Join-Path $PSScriptRoot 'inspect-native-tray.ps1') -SettingsOnly|ConvertFrom-Json)
$windows=@($opened.settingsWindows|Where-Object {$_.visible -and !$_.offscreen -and $_.microphoneSelectorPresent})
$microphoneSelector=$windows.Count -eq 1
if(!$microphoneSelector){throw 'Microphone settings window/control is not visible.'}
$samples=@($first)
for($step=0;$step -lt 5;$step++){
  Start-Sleep -Seconds 6
  $sample=Snapshot
  if($sample.supervisorPid -ne $first.supervisorPid -or $sample.trayPid -ne $first.trayPid -or $sample.workerPid -ne $first.workerPid -or $sample.pythonPid -ne $first.pythonPid){throw 'An installed runtime process restarted during the sustained check.'}
  $samples+=$sample
}
$final=Snapshot
if($final.trayPid -ne $first.trayPid -or $final.supervisorPid -ne $first.supervisorPid){throw 'Recovery changed the running instance unexpectedly.'}
$shell=(& (Join-Path $PSScriptRoot 'inspect-native-tray.ps1')|ConvertFrom-Json)
$icons=@($shell.registeredIconRects|Where-Object {$_.pid -eq $final.trayPid})
if($icons.Count -ne 1){throw 'Expected one registered icon.'}
$run=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'LUCIFER Assistant').'LUCIFER Assistant'
if($run -ne ('"'+$exe+'" --supervise')){throw 'Startup no longer targets the installed launcher.'}
foreach($relative in $hashes.Keys){if((Get-FileHash (Join-Path $root $relative) -Algorithm SHA256).Hash -ne $hashes[$relative]){throw 'Protected credential file changed.'}}
$report=@{passed=$true;checkedAt=[DateTime]::UtcNow.ToString('o');session=$final.session;station='WinSta0';desktop='Default';trayPid=$final.trayPid;supervisorPid=$final.supervisorPid;samples=$samples;secondsObserved=30;registeredIconCount=$icons.Count;settingsWindowOpenedAndVisible=$true;microphoneSelectorPresent=$microphoneSelector;manualLauncherReusedExistingInstance=$true;startupPreserved=$true;protectedCredentialFilesUnchanged=$true;physicalMicrophoneTesting='not performed';physicalWakeWordTesting='not performed';providerRequests=0;launcher=$exe;arguments='--supervise --settings'}
$report|ConvertTo-Json -Depth 6|Set-Content (Join-Path $root '.local\verification\tray-recovery-results.json') -Encoding UTF8
$report|ConvertTo-Json -Depth 6
