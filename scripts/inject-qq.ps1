# inject-qq.ps1 - Auto-login to SnowLuma WebUI API and inject the hook into the running QQ.exe.
# Used when SnowLuma is up but OneBot (3001) isn't: "QQ is running but not hooked".
# Password comes from -Password param or bridge config snowluma.webuiPassword.
# Exit code 0 = 3001 is up at the end; 1 = failed.
param(
  [string]$Password = ''
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$ws   = Split-Path -Parent $root

function Log([string]$m) {
  $l = "[$(Get-Date -Format 'MM-dd HH:mm:ss')] $m"
  Write-Host $l
  try { Add-Content (Join-Path $root 'state\inject-qq.log') $l -Encoding UTF8 } catch {}
}
function Test-PortListen([int]$port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(700)
    if ($ok) { $c.EndConnect($iar) }
    $c.Close()
    return [bool]$ok
  } catch { return $false }
}

if (Test-PortListen 3001) { Log '3001 already up, nothing to do'; exit 0 }

# WebUI port from SnowLuma runtime.json（SnowLuma 目录从 config.json 读取，避免硬编码）
$webuiPort = 5099
try {
  $cfg0 = Get-Content (Join-Path $root 'config.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $snowDir = [string]$cfg0.snowluma.homeDir
  if (-not $snowDir) { $snowDir = Join-Path $ws 'SnowLuma' }
  $rt = Get-Content (Join-Path $snowDir 'config\runtime.json') -Raw -Encoding utf8 | ConvertFrom-Json
  if ($rt.webuiPort) { $webuiPort = [int]$rt.webuiPort }
} catch {}
$base = "http://127.0.0.1:$webuiPort"

if (-not (Test-PortListen $webuiPort)) { Log "WebUI ($webuiPort) not listening - SnowLuma not up?"; exit 1 }

# Password: param > bridge config
if (-not $Password) {
  try {
    $cfg = Get-Content (Join-Path $root 'config.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $Password = [string]$cfg.snowluma.webuiPassword
  } catch {}
}
if (-not $Password) { Log 'no webui password (set snowluma.webuiPassword in config.json)'; exit 1 }

# 1. Login
$session = $null
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/login" -Method Post -ContentType 'application/json' `
          -Body (@{ password = $Password } | ConvertTo-Json) -SessionVariable session -TimeoutSec 10
  $login = $resp.Content | ConvertFrom-Json
  if (-not $login.success) { Log "login failed: $($login.message)"; exit 1 }
  $bearer = @{ Authorization = "Bearer $($login.token)" }
  Log 'webui login ok'
} catch { Log "login request failed: $($_.Exception.Message)"; exit 1 }

# 2. List hookable processes
$list = @()
try {
  $pl = Invoke-RestMethod -UseBasicParsing -Uri "$base/api/processes" -Headers $bearer -TimeoutSec 10
  $list = @($pl.list)
} catch { Log "list processes failed: $($_.Exception.Message)"; exit 1 }
if ($list.Count -eq 0) { Log 'no hookable processes found (QQ not running?)'; exit 1 }
Log ("candidates: " + (($list | ForEach-Object { $n = if ($_.name) { $_.name } elseif ($_.processName) { $_.processName } else { 'QQ' }; "$n#$($_.pid)[$($_.status)]" }) -join ', '))

# 3. Try load on each candidate until OneBot (3001) comes up
foreach ($p in $list) {
  $procId = [int]$p.pid
  $st = [string]$p.status
  if ($st -eq 'online' -or $st -eq 'connected') { Log "pid $procId already $st, skip"; continue }
  try {
    $r = Invoke-RestMethod -UseBasicParsing -Uri "$base/api/processes/$procId/load" -Method Post -Headers $bearer -TimeoutSec 30
    Log ("load pid ${procId}: success=" + $r.success + " status=" + $r.process.status)
  } catch { Log "load pid ${procId} failed: $($_.Exception.Message)"; continue }
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-PortListen 3001) { Log 'OneBot 3001 is UP'; exit 0 }
    Start-Sleep -Seconds 3
  }
}

Log 'tried all candidates, 3001 still down'
exit 1
