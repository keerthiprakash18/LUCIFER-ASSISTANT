[CmdletBinding()]
param(
  [string]$Model = 'qwen2.5:1.5b',
  [switch]$InstallIfMissing
)

$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

function Resolve-OllamaExe {
  $command=Get-Command ollama.exe -ErrorAction SilentlyContinue
  if($command){return $command.Source}
  $candidates=@(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )
  foreach($candidate in $candidates){if($candidate -and (Test-Path $candidate)){return $candidate}}
  return $null
}

function Test-OllamaApi {
  try {
    return Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3
  } catch {
    return $null
  }
}

Write-Host 'LUCIFER local fallback setup' -ForegroundColor Cyan
Write-Host ('Target model: ' + $Model)

$ollama=Resolve-OllamaExe
if(!$ollama -and $InstallIfMissing){
  Write-Host 'Ollama is not installed. Running the official Ollama Windows installer script...' -ForegroundColor Yellow
  $response=Invoke-WebRequest -UseBasicParsing -Uri 'https://ollama.com/install.ps1'
  $installer=if($response.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($response.Content)}else{[string]$response.Content}
  if([string]::IsNullOrWhiteSpace($installer)){throw 'Official Ollama installer script could not be downloaded.'}
  & ([ScriptBlock]::Create($installer))
  if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw ('Official Ollama installer failed with exit code '+$LASTEXITCODE)}
  for($i=0;$i -lt 20 -and !$ollama;$i++){
    Start-Sleep -Milliseconds 750
    $ollama=Resolve-OllamaExe
  }
}

if(!$ollama){
  throw @'
Ollama is not installed.
Re-run this script with -InstallIfMissing, or install Ollama from https://ollama.com/download/windows and run it again.
'@
}

Write-Host ('Ollama executable: ' + $ollama) -ForegroundColor Green

$api=Test-OllamaApi
if(!$api){
  Write-Host 'Starting the local Ollama API on 127.0.0.1:11434...' -ForegroundColor Yellow
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  for($i=0;$i -lt 20 -and !$api;$i++){
    Start-Sleep -Milliseconds 750
    $api=Test-OllamaApi
  }
}
if(!$api){throw 'Ollama installed, but its local API did not become ready on http://127.0.0.1:11434.'}

Write-Host ('Ollama API ready. Version: ' + $api.version) -ForegroundColor Green
Write-Host ('Pulling ' + $Model + ' ...') -ForegroundColor Cyan
& $ollama pull $Model
if($LASTEXITCODE -ne 0){throw ('ollama pull failed for ' + $Model)}

& $ollama show $Model *> $null
if($LASTEXITCODE -ne 0){throw ('Ollama cannot load the installed model ' + $Model)}

$body=@{
  model=$Model
  messages=@(@{role='user';content='Call lucifer_connection_check with value "ok". Do not answer normally.'})
  tools=@(@{
    type='function'
    function=@{
      name='lucifer_connection_check'
      description='Harmless LUCIFER local fallback compatibility check'
      parameters=@{
        type='object'
        properties=@{value=@{type='string'}}
        required=@('value')
        additionalProperties=$false
      }
    }
  })
  stream=$false
} | ConvertTo-Json -Depth 12

$verified=$false
for($attempt=1;$attempt -le 2 -and !$verified;$attempt++){
  try {
    $response=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120
    $call=@($response.message.tool_calls)[0]
    if($call.function.name -eq 'lucifer_connection_check' -and $call.function.arguments.value -eq 'ok'){$verified=$true}
  } catch {
    if($attempt -eq 2){throw}
  }
}

if(!$verified){
  throw ('The model is installed and reachable, but it did not return LUCIFER''s structured tool call. Choose another tool-capable Ollama model.')
}

$summary=[ordered]@{
  ready=$true
  api='http://127.0.0.1:11434'
  model=$Model
  toolsVerified=$true
  next='LUCIFER > Skills & integrations > AI provider > Ollama > Save and test connection, then enable Ollama in Advanced routing and fallback.'
}
$summary | ConvertTo-Json
