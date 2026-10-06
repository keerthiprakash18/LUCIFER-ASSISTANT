param([switch]$Restart,[switch]$OpenSettings)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$directory=Join-Path $root '.local\native'
$installed=Join-Path $directory 'LUCIFER.exe'
$staged=Join-Path $directory 'LUCIFER.next.exe'
$icon=Join-Path $directory 'LUCIFER.ico'
$builder=Join-Path $directory 'IconBuilder.exe'
$csc="$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if(!(Test-Path $directory)){throw 'Run existing native setup first; this repair does not provision or reset owner data.'}
& $csc /nologo /target:exe /main:LuciferNative.IconBuilder /platform:x64 /optimize+ ("/out:"+$builder) /r:System.Drawing.dll (Join-Path $root 'companion\native\BrandIcon.cs')
if($LASTEXITCODE -ne 0){throw 'LUCIFER icon builder compilation failed.'}
& $builder $icon
if($LASTEXITCODE -ne 0){throw 'LUCIFER icon generation failed.'}
Add-Type -AssemblyName System.Speech
$speechAssembly=[System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location
& $csc /nologo /target:winexe /main:LuciferNative.Program /platform:x64 /optimize+ ("/win32icon:"+$icon) ("/out:"+$staged) /r:System.Windows.Forms.dll /r:System.Drawing.dll ("/r:"+$speechAssembly) /r:System.Web.Extensions.dll /r:System.Core.dll /r:System.Security.dll (Join-Path $root 'companion\native\Audio.cs') (Join-Path $root 'companion\native\BrandIcon.cs') (Join-Path $root 'companion\native\Diagnostics.cs') (Join-Path $root 'companion\native\AssemblyInfo.cs') (Join-Path $root 'companion\native\Tray.cs')
if($LASTEXITCODE -ne 0){throw 'Native tray compilation failed; the running installed app was not stopped.'}
function Installed-Processes{@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'LUCIFER.exe' -and $_.ExecutablePath -eq $installed})}
if($Restart -and (Installed-Processes).Count){
  & (Join-Path $PSScriptRoot 'native-control.ps1') -Action exit | Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  while((Installed-Processes).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 250}
}
if((Installed-Processes).Count){throw 'New build is staged. The installed tray did not exit; it was not forcibly replaced.'}
Move-Item $staged $installed -Force
Write-Output 'Installed branded native tray. Backend, databases, configuration, pairing and credentials retained.'
if($Restart){& (Join-Path $PSScriptRoot 'start-native.ps1') -OpenSettings:$OpenSettings}
