# watchdog.ps1 - self-check for the bot stack. Designed to run every 4 hours via Task Scheduler.
# 1) Any core port down -> rerun start-all.ps1 (skips what's already running).
# 2) QQ liveness probe (get_group_member_info with no_cache, forces a real server round-trip).
#    Probe failure = SnowLuma hook zombie (the "injected but dead" failure mode) -> restart SnowLuma, re-probe.
# 3) Balloon notification only when something was wrong; every run appends one line to state\watchdog.log.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot          # qq-bridge dir
$ws   = Split-Path -Parent $root                   # workspace dir
$logFile = Join-Path $root 'state\watchdog.log'

function Log([string]$m) {
    $l = "[$(Get-Date -Format 'MM-dd HH:mm:ss')] $m"
    Write-Host $l
    try { Add-Content $logFile $l -Encoding UTF8 } catch {}
}
function Test-Port([int]$port) {
    try { $null = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop; return $true } catch { return $false }
}
function Wait-Port([int]$port, [int]$sec) {
    for ($i = 0; $i -lt $sec; $i += 3) { if (Test-Port $port) { return $true }; Start-Sleep -Seconds 3 }
    return $false
}
function Balloon([string]$title, [string]$msg, [string]$level = 'Warning') {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $ni = New-Object System.Windows.Forms.NotifyIcon
        $ni.Icon = [System.Drawing.SystemIcons]::Warning
        $ni.Visible = $true
        $ni.ShowBalloonTip(8000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::$level)
        Start-Sleep -Seconds 9
        $ni.Dispose()
    } catch {}
}

$cfg = Get-Content (Join-Path $root 'config.json') -Raw -Encoding utf8 | ConvertFrom-Json
$token   = [string]$cfg.snowluma.accessToken
$httpUrl = ([string]$cfg.snowluma.httpUrl).TrimEnd('/')
$groupId = [long]($cfg.allow.groups[0])
$probeUin = [long]$cfg.ownerQQ
# SnowLuma 路径统一从 config.json 读取，避免硬编码目录名
$launcher = [string]$cfg.snowluma.launcherPath
$snowDir  = [string]$cfg.snowluma.homeDir
if (-not $launcher) { $launcher = Join-Path $ws 'SnowLuma\launcher.bat' }
if (-not $snowDir)  { $snowDir  = Join-Path $ws 'SnowLuma' }

function Test-QQAlive {
    try {
        $body = @{ group_id = $groupId; user_id = $probeUin; no_cache = $true } | ConvertTo-Json
        $r = Invoke-RestMethod -Uri "$httpUrl/get_group_member_info" -Method Post -TimeoutSec 12 `
             -Headers @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' } -Body $body
        return ($r.retcode -eq 0)
    } catch { return $false }
}

$actions = @()

# ── 1. Port checks: anything down -> rerun one-click start (skips running parts) ──
if (-not ((Test-Port 3001) -and (Test-Port 3080) -and (Test-Port 3100))) {
    Log 'some ports down (3001/3080/3100), running start-all.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-all.ps1') | Out-Null
    $actions += 'restarted-missing-components'
}

# ── 2. QQ liveness probe ──
if ((Test-Port 3001) -and -not (Test-QQAlive)) {
    Log 'QQ probe FAILED -> SnowLuma likely zombie, restarting SnowLuma'
    # kill whatever owns 3000/3001
    $pids = @()
    foreach ($p in @(3000, 3001)) {
        try { $pids += @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }) } catch {}
    }
    foreach ($procId in ($pids | Select-Object -Unique)) {
        if ($procId -gt 0) { try { Stop-Process -Id $procId -Force -ErrorAction Stop; Log "killed SnowLuma PID $procId" } catch { Log "kill $procId failed: $($_.Exception.Message)" } }
    }
    # a guardian (if any) may revive it; only relaunch if still down
    if (-not (Wait-Port 3001 25)) {
        Start-Process -FilePath $launcher -WorkingDirectory $snowDir -WindowStyle Minimized
        Log 'SnowLuma relaunched'
    }
    [void](Wait-Port 3001 90)
    Start-Sleep -Seconds 20   # give the hook a moment to re-inject and warm up
    if (Test-QQAlive) {
        Log 'QQ probe OK after SnowLuma restart (self-healed)'
        Balloon '小比机器人自检' '检测到收信卡死，已自动重启 SnowLuma 恢复。' 'Info'
        $actions += 'snowluma-restarted-self-healed'
    } else {
        Log 'QQ probe STILL FAILING after restart'
        Balloon '小比机器人自检' 'QQ 收信异常：自动重启没救回来。请打开 PC QQ 检查机器人账号（可能要重新登录/重新注入）。' 'Warning'
        $actions += 'snowluma-still-dead'
    }
}

# ── 3. Summary ──
$ports = "3001=$(Test-Port 3001) 3080=$(Test-Port 3080) 3100=$(Test-Port 3100)"
if ($actions.Count -eq 0) {
    Log "OK all-up ($ports)"
} else {
    Log "actions: $($actions -join ', ') | final: $ports"
}
