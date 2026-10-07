param([switch]$Uninstall,[switch]$DisableStartup,[switch]$SkipSpeechDownload)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$directory=Join-Path $root '.local\native'
Set-Location $root
$startup='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
function Send-Control($action){try{$pipe=New-Object IO.Pipes.NamedPipeClientStream('.','LUCIFER.Native.micha',[IO.Pipes.PipeDirection]::InOut);$pipe.Connect(1500);$writer=New-Object IO.StreamWriter($pipe);$writer.AutoFlush=$true;$reader=New-Object IO.StreamReader($pipe);$writer.WriteLine((@{action=$action}|ConvertTo-Json -Compress));$null=$reader.ReadLine();$pipe.Dispose()}catch{}}
if($DisableStartup -or $Uninstall){Remove-ItemProperty -Path $startup -Name 'LUCIFER Assistant' -ErrorAction SilentlyContinue;if($Uninstall){Send-Control 'exit'; & wsl.exe -d Ubuntu --cd ($root.Replace('C:\','/mnt/c/').Replace('\','/')) -- bash .local/native/stop-backend.sh};Write-Output 'Startup disabled. Owner data, pairing, encrypted credentials and downloaded models retained.';exit}
New-Item -ItemType Directory -Force $directory,(Join-Path $directory 'audio'),(Join-Path $root '.local\notes')|Out-Null
$apps=@{notepad=@{executable="$env:WINDIR\System32\notepad.exe";args=@()}}
$calculator="$env:WINDIR\System32\calc.exe";$explorer="$env:WINDIR\explorer.exe"
if(Test-Path $calculator){$apps.calculator=@{executable=$calculator;args=@()}}
if(Test-Path $explorer){$apps.camera=@{executable=$explorer;args=@('microsoft.windows.camera:')}}
$edge="${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe";$chrome="${env:ProgramFiles}\Google\Chrome\Application\chrome.exe";$code="$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
if(Test-Path $edge){$apps.edge=@{executable=$edge;args=@()};$apps.browser=$apps.edge}
if(Test-Path $chrome){$apps.chrome=@{executable=$chrome;args=@()};if(!$apps.browser){$apps.browser=$apps.chrome}}
if(Test-Path $code){$apps.vscode=@{executable=$code;args=@()}}
$policyPath=Join-Path $directory 'policy.json'
if(!(Test-Path $policyPath)){
  $policy=@{server='http://127.0.0.1:3001';name='LUCIFER native Windows';apps=$apps;folders=@{notes=(Join-Path $root '.local\notes')};websites=@();allowHttpsWebsites=$true;commands=@{};actions=@('open_app','open_website','read_file','find_files','write_document')}
  if($apps.vscode){$policy.actions+= 'open_project';$policy.folders.workspace=$root}
  if(Test-Path (Join-Path $root 'companion\config.json')){$existing=Get-Content (Join-Path $root 'companion\config.json') -Raw|ConvertFrom-Json;foreach($p in $existing.apps.PSObject.Properties){if(!$policy.apps.ContainsKey($p.Name)){$policy.apps[$p.Name]=$p.Value}};foreach($p in $existing.folders.PSObject.Properties){$policy.folders[$p.Name]=$p.Value}}
  $policy|ConvertTo-Json -Depth 10|Set-Content $policyPath -Encoding UTF8
}
$policy=Get-Content $policyPath -Raw|ConvertFrom-Json
$policyChanged=$false
foreach($alias in $apps.Keys){if(-not $policy.apps.PSObject.Properties[$alias]){$policy.apps|Add-Member -NotePropertyName $alias -NotePropertyValue ([pscustomobject]$apps[$alias]);$policyChanged=$true}}
if($policyChanged){$policy|ConvertTo-Json -Depth 10|Set-Content $policyPath -Encoding UTF8}
$capabilities=@{apps=@($policy.apps.PSObject.Properties.Name);folders=@($policy.folders.PSObject.Properties.Name);commands=@();actions=@($policy.actions)}
@{windowsOwner=[Environment]::UserName;capabilities=$capabilities}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $directory 'install-request.json') -Encoding UTF8
$wslRoot=$root.Replace('C:\','/mnt/c/').Replace('\','/')
$wslNode='/home/micha/.nvm/versions/node/v24.21.0/bin/node'
& wsl.exe -d Ubuntu --cd $wslRoot -- $wslNode --import tsx/esm scripts/native-build.ts
if($LASTEXITCODE -ne 0){throw 'Native worker and managed backend preparation failed.'}
& wsl.exe -d Ubuntu --cd $wslRoot -- $wslNode --import tsx/esm scripts/upgrade-native-capabilities.ts
if($LASTEXITCODE -ne 0){throw 'Scoped native capability upgrade failed.'}
& wsl.exe -d Ubuntu --cd $wslRoot -- env 'PATH=/home/micha/.nvm/versions/node/v24.21.0/bin:/usr/local/bin:/usr/bin:/bin' $wslNode /home/micha/.nvm/versions/node/v24.21.0/lib/node_modules/npm/bin/npm-cli.js run build
if($LASTEXITCODE -ne 0){throw 'Production TypeScript/frontend build failed.'}
& wsl.exe -d Ubuntu --cd $wslRoot -- /home/micha/.nvm/versions/node/v24.21.0/bin/node --import tsx/esm scripts/native-provision.ts
if($LASTEXITCODE -ne 0){throw 'Native device provisioning failed; owner data was not reset.'}
$python=(Get-Command python.exe).Source;$venv=Join-Path $directory 'python'
if(!(Test-Path (Join-Path $venv 'Scripts\python.exe'))){& $python -m venv $venv;if($LASTEXITCODE -ne 0){throw 'Local speech virtual environment creation failed.'}}
$python=Join-Path $venv 'Scripts\python.exe'
$speechProbe=@'
import importlib.metadata as m, sys
try:
    valid = m.version('av') == '15.1.0' and m.version('faster-whisper') == '1.2.1'
except m.PackageNotFoundError:
    valid = False
sys.exit(0 if valid else 1)
'@
& $python -c $speechProbe
if($LASTEXITCODE -ne 0){
  Send-Control 'exit';Start-Sleep -Seconds 2
  Write-Output 'Installing project-local Faster-Whisper 1.2.1 and compatible PyAV 15.1.0 (Windows decoder ~31 MB).'
  & $python -m pip install --disable-pip-version-check 'faster-whisper==1.2.1' 'av==15.1.0' 'huggingface-hub>=0.34,<1'
  if($LASTEXITCODE -ne 0){throw 'Speech dependency installation failed.'}
}
if(!$SkipSpeechDownload){
  Write-Output 'Preparing multilingual Whisper small (~486 MB). CPU int8; no paid speech service.'
  & $python (Join-Path $root 'scripts\native-speech-setup.py') $root
  if($LASTEXITCODE -ne 0){throw 'Speech model preparation failed. Rerun this installer; existing credentials remain intact.'}
}
$espeakDir=Join-Path $directory 'espeak'
if(!(Test-Path $espeakDir)){New-Item -ItemType Directory -Force $espeakDir|Out-Null}
$espeak=Get-ChildItem $espeakDir -Filter espeak-ng.exe -Recurse -ErrorAction SilentlyContinue|Select-Object -First 1 -ExpandProperty FullName
if(!$espeak){
  $msi=Join-Path $directory 'espeak-ng.msi'
  if(!(Test-Path $msi)){Write-Output 'Downloading official eSpeak-NG 1.52 (~12.8 MB) for local Tamil speech.';Invoke-WebRequest -UseBasicParsing 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi' -OutFile $msi}
  $extract=Start-Process msiexec.exe -ArgumentList @('/a',('"'+$msi+'"'),'/qn',('TARGETDIR="'+$espeakDir+'"')) -Wait -PassThru
  if($extract.ExitCode -ne 0){throw 'Project-local eSpeak extraction failed. No global installation or elevation was requested.'}
  $espeak=Get-ChildItem $espeakDir -Filter espeak-ng.exe -Recurse|Select-Object -First 1 -ExpandProperty FullName
  if(!$espeak){throw 'Local Tamil speech executable was not extracted.'}
}
$speechCheck=Join-Path (Join-Path $directory 'audio') ([Guid]::NewGuid().ToString('N'))
$previousSpeechPath=$env:ESPEAK_DATA_PATH
try{
  $env:ESPEAK_DATA_PATH=Split-Path $espeak -Parent
  [IO.File]::WriteAllText(($speechCheck+'.txt'),(([char[]]@(0x0BB5,0x0BA3,0x0B95,0x0BCD,0x0B95,0x0BAE,0x0BCD))-join ''),(New-Object Text.UTF8Encoding($false)))
  $check=Start-Process $espeak -ArgumentList @('-v','ta','-b','1','-w',('"'+$speechCheck+'.wav"'),'-f',('"'+$speechCheck+'.txt"')) -WorkingDirectory (Split-Path $espeak -Parent) -WindowStyle Hidden -Wait -PassThru
  if($check.ExitCode -ne 0 -or !(Test-Path ($speechCheck+'.wav')) -or (Get-Item ($speechCheck+'.wav')).Length -le 44){throw 'Local Tamil speech synthesis check failed.'}
}finally{$env:ESPEAK_DATA_PATH=$previousSpeechPath;Remove-Item ($speechCheck+'.txt'),($speechCheck+'.wav') -ErrorAction SilentlyContinue}
@{node=(Get-Command node.exe).Source;python=$python;espeak=$espeak;distribution='Ubuntu';wslRoot=$wslRoot}|ConvertTo-Json|Set-Content (Join-Path $directory 'runtime.json') -Encoding UTF8
Send-Control 'exit';Start-Sleep -Seconds 2
& wsl.exe -d Ubuntu --cd $wslRoot -- bash .local/native/stop-backend.sh
if($LASTEXITCODE -ne 0){throw 'Managed production backend could not be stopped for upgrade.'}
& (Join-Path $PSScriptRoot 'build-native-tray.ps1')
New-Item -Force $startup|Out-Null
Set-ItemProperty -Path $startup -Name 'LUCIFER Assistant' -Value ('"'+(Join-Path $directory 'LUCIFER.exe')+'" --supervise')
& (Join-Path $PSScriptRoot 'start-native.ps1')
Write-Output 'Installed current-owner Windows sign-in startup and launched the production voice runtime. Tray lists the active pause shortcut (Ctrl+Alt+L or Ctrl+Alt+Shift+L); Ctrl+Alt+Esc stops. No operation before sign-in, while asleep, or when powered off.'
