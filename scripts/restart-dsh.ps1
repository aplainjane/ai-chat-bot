# restart-dsh.ps1 - Restart the DSH web service (absolute-path logging version).
$ErrorActionPreference = 'Continue'
$logFile = 'F:\deepseek harness\workspace\qq-bridge\state\restart-dsh.log'
function Log([string]$msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Output $line
    try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { Write-Output ("LOGERR: " + $_.Exception.Message) }
}

Log '=== restart-dsh invoked ==='
Log ("PSScriptRoot=" + $PSScriptRoot)
Log ("PSVersion=" + $PSVersionTable.PSVersion.ToString())

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

Start-Sleep -Seconds 5

# 2. Verify old DSH web is gone.
$still = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bin\.ts.*web'
})
Log ("remaining dsh web node processes after kill: " + $still.Count)

# 3. Start the new DSH web.
Log 'starting new DSH web...'
$env:DSH_HOME = 'C:\Users\Administrator\.dsh'
try {
    Start-Process -FilePath 'F:\nvm\versions\node\v24.20.0\bin\node.exe' `
        -ArgumentList '--import','tsx/esm','apps/cli/src/bin.ts','web' `
        -WorkingDirectory 'F:\deepseek harness\deepseek-harness' `
        -WindowStyle Hidden
    Log 'DSH web launch issued'
} catch {
    Log ("launch FAILED: " + $_.Exception.Message)
}

# 4. Poll for port 3080 to come up (up to ~30s).
for ($i = 1; $i -le 6; $i++) {
    Start-Sleep -Seconds 5
    try {
        $c = Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction Stop
        Log ("3080 listening by PID " + $c[0].OwningProcess)
        break
    } catch {
        Log ("waiting for 3080 (attempt " + $i + ")...")
    }
}

Log '=== restart-dsh done ==='
