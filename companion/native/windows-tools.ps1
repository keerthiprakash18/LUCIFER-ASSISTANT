$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
if($request.operation -eq 'discover'){
  $apps=@{};$shell=New-Object -ComObject WScript.Shell
  foreach($folder in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))){
    foreach($link in @(Get-ChildItem $folder -Filter *.lnk -Recurse -ErrorAction SilentlyContinue|Select-Object -First 200)){
      $target=$shell.CreateShortcut($link.FullName).TargetPath
      if($target -and $target -match '\.exe$' -and (Test-Path $target) -and $target -notmatch '\\(cmd|powershell|pwsh|wsl|bash)\.exe$'){$alias=($link.BaseName.ToLowerInvariant()-replace '[^a-z0-9]','-').Trim('-');if($alias){$alias=$alias.Substring(0,[Math]::Min(60,$alias.Length));$apps[$alias]=@{name=$link.BaseName;executable=$target;control='launch only; accessibility must be observed';arguments=@()}}}
    }
  }
  @{apps=@($apps.GetEnumerator()|ForEach-Object {@{id=$_.Key;name=$_.Value.name;executable=$_.Value.executable;control=$_.Value.control}});observedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Depth 4;exit
}
if($request.operation -eq 'observe'){
  Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes
  $windows=@()
  foreach($process in @(Get-CimInstance Win32_Process|Where-Object {($_.ExecutablePath -eq $request.executable -or [IO.Path]::GetFileName($_.ExecutablePath) -eq [IO.Path]::GetFileName($request.executable)) -and $_.SessionId -eq (Get-Process -Id $PID).SessionId})){
    $view=Get-Process -Id $process.ProcessId
    if($view.MainWindowHandle -eq [IntPtr]::Zero){continue}
    $element=[Windows.Automation.AutomationElement]::FromHandle($view.MainWindowHandle)
    $controls=@();$items=$element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
    if([IO.Path]::GetFileName($request.executable) -match '^(chrome|msedge)\.exe$'){$items=@()}
    foreach($item in $items){if($controls.Count -ge 80){break};if($item.Current.IsPassword -or $item.Current.ControlType -in @([Windows.Automation.ControlType]::Edit,[Windows.Automation.ControlType]::Document)){continue};$name=$item.Current.Name;if($name -and $name -notmatch 'password|verification|one.time|token|api.key'){$controls+=@{name=$name;type=$item.Current.ControlType.ProgrammaticName;automationId=$item.Current.AutomationId;enabled=$item.Current.IsEnabled}}}
    $windows+=@{processId=$process.ProcessId;executable=$process.ExecutablePath;title=$view.MainWindowTitle;controls=$controls}
  }
  @{windows=$windows;observedAt=[DateTime]::UtcNow.ToString('o');interaction='Observation only; generic destructive controls are not automatically invoked'}|ConvertTo-Json -Depth 6;exit
}
throw 'Unsupported Windows inspection operation'
