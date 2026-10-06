param([ValidateSet('state','pause','resume','stop','exit','command','startup-on','startup-off','settings','refresh-icon','talk','test-microphone','test-speaker','grant-folder')][string]$Action='state',[string]$Text='')
$ErrorActionPreference='Stop'
$pipe=New-Object IO.Pipes.NamedPipeClientStream('.','LUCIFER.Native.micha',[IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(5000)
try{$writer=New-Object IO.StreamWriter($pipe);$writer.AutoFlush=$true;$reader=New-Object IO.StreamReader($pipe);$writer.WriteLine((@{action=$Action;text=$Text}|ConvertTo-Json -Compress));$reader.ReadLine()}finally{$pipe.Dispose()}
