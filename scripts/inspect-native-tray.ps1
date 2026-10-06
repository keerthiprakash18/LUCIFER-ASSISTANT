param([switch]$OpenHiddenIcons,[switch]$CaptureIcon,[switch]$SettingsOnly)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(-not ('LuciferTrayProbe' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class LuciferTrayProbe {
  [StructLayout(LayoutKind.Sequential)] struct IconIdentifier{public uint size;public IntPtr window;public uint id;public Guid guid;}
  [StructLayout(LayoutKind.Sequential)] struct Rect{public int left,top,right,bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct Point{public int x,y;}
  [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref IconIdentifier icon,out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string name,string title);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int length);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle,int index,StringBuilder text,int length,out int needed);
  delegate bool EnumCallback(IntPtr window,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumCallback callback,IntPtr data);
  public static string Name(IntPtr handle){var text=new StringBuilder(256);int needed;return GetUserObjectInformation(handle,2,text,512,out needed)?text.ToString():"unavailable";}
  public static string[] Windows(uint pid){var result=new List<string>();EnumWindows(delegate(IntPtr window,IntPtr data){uint owner;GetWindowThreadProcessId(window,out owner);if(owner==pid){var title=new StringBuilder(256);var cls=new StringBuilder(128);GetWindowText(window,title,256);GetClassName(window,cls,128);result.Add(window.ToInt64()+"|"+IsWindowVisible(window)+"|"+cls+"|"+title);}return true;},IntPtr.Zero);return result.ToArray();}
  public static string IconRect(long window,uint id){var icon=new IconIdentifier{size=(uint)Marshal.SizeOf(typeof(IconIdentifier)),window=new IntPtr(window),id=id};Rect rect;int result=Shell_NotifyIconGetRect(ref icon,out rect);return result==0?rect.left+","+rect.top+","+rect.right+","+rect.bottom:null;}
  public static int VisibleCombos(long parent){int count=0;EnumChildWindows(new IntPtr(parent),delegate(IntPtr window,IntPtr data){var cls=new StringBuilder(128);GetClassName(window,cls,128);if(cls.ToString().ToUpperInvariant().Contains("COMBOBOX")&&IsWindowVisible(window))count++;return true;},IntPtr.Zero);return count;}
  public static bool MicrophoneLabel(long parent){bool found=false;EnumChildWindows(new IntPtr(parent),delegate(IntPtr window,IntPtr data){var text=new StringBuilder(64);GetWindowText(window,text,64);if(text.ToString()=="Microphone input"&&IsWindowVisible(window))found=true;return true;},IntPtr.Zero);return found;}
}
'@
}
$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'LUCIFER.exe' -and $_.ExecutablePath -eq (Join-Path $root '.local\native\LUCIFER.exe')} | ForEach-Object {@{pid=$_.ProcessId;parent=$_.ParentProcessId;session=$_.SessionId;role=$(if($_.CommandLine -match '--tray'){'tray'}else{'supervisor'});responding=(Get-Process -Id $_.ProcessId).Responding;windows=@([LuciferTrayProbe]::Windows($_.ProcessId))}})
$tray=[LuciferTrayProbe]::FindWindow('Shell_TrayWnd',$null)
$names=@()
$registered=@()
try{
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if($OpenHiddenIcons -and $tray -ne [IntPtr]::Zero){
    $taskbarElement=[Windows.Automation.AutomationElement]::FromHandle($tray)
    $hidden=$taskbarElement.FindFirst([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,'Show Hidden Icons')))
    if($hidden){$pattern=$null;if($hidden.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke();Start-Sleep -Milliseconds 700}}
  }
  $handles=@($tray,[LuciferTrayProbe]::FindWindow('NotifyIconOverflowWindow',$null))
  foreach($explorer in @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object {$_.SessionId -eq (Get-Process -Id $PID).SessionId})){
    foreach($window in [LuciferTrayProbe]::Windows($explorer.Id)){$parts=$window.Split('|');if($parts[1] -eq 'True' -and $parts[2] -match 'Overflow|Xaml|CoreWindow'){$handles+= [IntPtr]([long]$parts[0])}}
  }
  foreach($handle in $(if($SettingsOnly){@()}else{$handles | Select-Object -Unique})){
    if($handle -eq [IntPtr]::Zero){continue}
    $element=[Windows.Automation.AutomationElement]::FromHandle($handle)
    $buttons=$element.FindAll([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)))
    foreach($button in $buttons){$name=$button.Current.Name;if($name -match 'LUCIFER|hidden|overflow|tray|notification'){$names+=@{name=$name;automationId=$button.Current.AutomationId;offscreen=$button.Current.IsOffscreen;bounds=$button.Current.BoundingRectangle.ToString()}}}
  }
}catch{$names+=@{inspectionError=$_.Exception.GetType().Name}}
foreach($process in $processes){foreach($window in $process.windows){$handle=[long]$window.Split('|')[0];foreach($id in 0..3){$rect=[LuciferTrayProbe]::IconRect($handle,$id);if($rect){$registered+=@{pid=$process.pid;window=$handle;iconId=$id;rect=$rect}}}}}
$settings=@();$tooltip=@();$capture=$null
foreach($process in $processes){foreach($window in $process.windows){$parts=$window.Split('|');if($parts[1] -eq 'True' -and $parts[3] -eq 'LUCIFER - Voice settings and calibration'){
  $element=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$parts[0]))
  $comboCount=[LuciferTrayProbe]::VisibleCombos([long]$parts[0])
  $settings+=@{pid=$process.pid;visible=$true;offscreen=$element.Current.IsOffscreen;title=$parts[3];visibleComboCount=$comboCount;microphoneSelectorPresent=($comboCount -ge 4 -and [LuciferTrayProbe]::MicrophoneLabel([long]$parts[0]))}
}}}
if($CaptureIcon -and $registered.Count -gt 0){
  Add-Type -AssemblyName System.Drawing
  $null=[LuciferTrayProbe]::SetProcessDPIAware()
  $rect=$registered[0].rect.Split(',')|ForEach-Object {[int]$_}
  $old=New-Object LuciferTrayProbe+Point;$null=[LuciferTrayProbe]::GetCursorPos([ref]$old)
  try{
    $bitmap=New-Object Drawing.Bitmap(($rect[2]-$rect[0]),($rect[3]-$rect[1]));$graphics=[Drawing.Graphics]::FromImage($bitmap)
    try{$graphics.CopyFromScreen($rect[0],$rect[1],0,0,$bitmap.Size);$capture=Join-Path $root '.local\verification\tray-icon-visible.png';$bitmap.Save($capture,[Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose()}
    $null=[LuciferTrayProbe]::SetCursorPos(($rect[0]+$rect[2])/2,($rect[1]+$rect[3])/2);Start-Sleep -Milliseconds 1200
    foreach($explorer in @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object {$_.SessionId -eq (Get-Process -Id $PID).SessionId})){foreach($window in [LuciferTrayProbe]::Windows($explorer.Id)){$parts=$window.Split('|');if($parts[1] -eq 'True' -and $parts[3] -match '^LUCIFER - '){$tooltip+=$parts[3]}}}
  }finally{$null=[LuciferTrayProbe]::SetCursorPos($old.x,$old.y)}
}
$status=$null
try{$status=Get-Content (Join-Path $root '.local/native/status.json') -Raw|ConvertFrom-Json}catch{}
@{checkedAt=[DateTime]::UtcNow.ToString('o');inspectionSession=(Get-Process -Id $PID).SessionId;consoleSession=[LuciferTrayProbe]::WTSGetActiveConsoleSessionId();station=[LuciferTrayProbe]::Name([LuciferTrayProbe]::GetProcessWindowStation());desktop=[LuciferTrayProbe]::Name([LuciferTrayProbe]::GetThreadDesktop([LuciferTrayProbe]::GetCurrentThreadId()));shellWindow=[LuciferTrayProbe]::GetShellWindow().ToInt64();taskbar=$tray.ToInt64();processes=$processes;matchingShellButtons=$names;registeredIconRects=$registered;settingsWindows=$settings;hoverTooltip=$tooltip;iconOnlyCapture=$capture;statusAgeSeconds=$(if($status){([DateTime]::UtcNow-[DateTime]::Parse($status.updatedAt).ToUniversalTime()).TotalSeconds}else{$null})}|ConvertTo-Json -Depth 6
