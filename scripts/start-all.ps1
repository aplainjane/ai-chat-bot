# 一键启动脚本：读取 config.json 的 startup.services，逐个启动 snowluma / dsh / bridge 等。
# 用法：双击 start-all.bat（或直接运行本脚本）。
#   已经在运行的服务会自动跳过，不会重复启动。
#   支持 -DryRun：只打印将要执行的动作，不真正启动（可先检查一遍配置）。
#
# 服务配置见 config.json -> startup.services：
#   name    服务名（仅用于显示）
#   enabled 是否参与一键启动
#   dir     工作目录
#   cmd     要启动的可执行文件（.bat/.exe/.cmd 或脚本）
#   args    命令行参数数组
#   env     附加环境变量（启动前临时设置）
#   match   用于“是否已在运行”判断的正则，匹配进程命令行

param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # qq-bridge 根目录
$configPath = Join-Path $root 'config.json'
if (-not (Test-Path $configPath)) {
  Write-Host "[错误] 找不到 $configPath"
  exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$services = $config.startup.services
if (-not $services -or $services.Count -eq 0) {
  Write-Host "[提示] config.json 里没有配置 startup.services，跳过"
  exit 0
}

Write-Host "=== 一键启动 $(($services | Where-Object { $_.enabled -ne $false }).Count) 个服务（共 $($services.Count) 个） ==="

function Test-Running([string]$match) {
  try {
    $hits = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $match }
    if ($hits) { return $hits[0].ProcessId }
  } catch { }
  return $null
}

foreach ($svc in $services) {
  if ($svc.enabled -eq $false) {
    Write-Host "[跳过] $($svc.name) （已禁用）"
    continue
  }
  $dir = [string]$svc.dir
  $cmd = [string]$svc.cmd
  $svcArgs = @($svc.args)
  $match = [string]$svc.match
  $desc = "$cmd $(($svcArgs -join ' '))  (cwd=$dir)"

  if ($match) {
    $pidHit = Test-Running $match
    if ($pidHit) {
      Write-Host "[已在运行] $($svc.name)  (pid=$pidHit)  跳过"
      continue
    }
  }

  if ($DryRun) {
    Write-Host "[将启动] $($svc.name) : $desc"
    continue
  }

  # 临时设置服务需要的环境变量
  $saved = @{}
  if ($svc.env) {
    foreach ($prop in $svc.env.PSObject.Properties) {
      $k = $prop.Name
      $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
      [Environment]::SetEnvironmentVariable($k, [string]$prop.Value, 'Process')
    }
  }

  try {
    Start-Process -FilePath $cmd -ArgumentList $svcArgs -WorkingDirectory $dir -WindowStyle Minimized
    Write-Host "[已启动] $($svc.name) : $desc"
  } catch {
    Write-Host "[失败] $($svc.name) : $($_.Exception.Message)"
  }

  # 恢复环境变量
  foreach ($k in $saved.Keys) {
    [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process')
  }
}

Write-Host "=== 全部处理完成 ==="
if ($DryRun) {
  Write-Host "（DryRun 模式：未真正启动任何服务；正式运行直接双击 start-all.bat 即可）"
}
