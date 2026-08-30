# shutdown-dsh.ps1 - Stop the DSH web service (absolute-path logging version).
# Kills the DSH web process(es) WITHOUT restarting them. Use restart-dsh.ps1 to bring it back.
$ErrorActionPreference = 'Continue'
$logFile = 'F:\deepseek harness\workspace\qq-bridge\state\shutdown-dsh.log'
function Log([string]$msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Output $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { Write-Output ("LOGERR: " + $_.Exception.Message) }
}

Log '=== shutdown-dsh invoked ==='
Log ("PSScriptRoot=" + $PSScriptRoot)

# 1. Find target processes (node bin.ts web / pnpm dsh web, plus the wrapping cmd).
$targets = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in @('node.exe','cmd.exe') -and ($_.CommandLine -match 'bin\.ts.*web' -or $_.CommandLine -match 'pnpm\.js.*dsh web')
})
Log ("targets found: " + $targets.Count)
foreach ($t in $targets) {
    Log ("killing PID " + $t.ProcessId + " (" + $t.Name + ")")
    try {
        Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop
        Log ("killed " + $t.ProcessId)
    } catch {
        Log ("kill FAILED " + $t.ProcessId + ": " + $_.Exception.Message)
    }
}

Start-Sleep -Seconds 3

# 2. Verify DSH web is gone.
$still = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in @('node.exe','cmd.exe') -and ($_.CommandLine -match 'bin\.ts.*web' -or $_.CommandLine -match 'pnpm\.js.*dsh web')
})
Log ("remaining dsh web processes after kill: " + $still.Count)
if ($still.Count -gt 0) {
    Log "WARNING: some DSH web processes are still running - they may be under a watcher/daemon"
}

Log '=== shutdown-dsh done ==='
