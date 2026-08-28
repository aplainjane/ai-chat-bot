// 桥接守护进程：bridge.js 退出/崩溃后自动重启（桥接控制台的重启命令也依赖本守护拉起）。
// 1 分钟内连续崩溃 MAX_CRASHES 次则放弃（防止无限崩溃循环刷屏）。
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(ROOT, 'src', 'bridge.js');
const RESTART_DELAY_MS = 3000;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 60000;

let crashes = [];
let child = null;
let stopping = false;

function maybeRestart(code) {
  const now = Date.now();
  crashes = crashes.filter((t) => now - t < CRASH_WINDOW_MS);
  crashes.push(now);
  if (crashes.length >= MAX_CRASHES) {
    console.log(`[supervisor] ${MAX_CRASHES} 次连续崩溃（1 分钟内），停止尝试，请人工检查`);
    process.exit(1);
  }
  console.log(`[supervisor] bridge 退出（code=${code}），${RESTART_DELAY_MS / 1000}s 后自动重启`);
  setTimeout(start, RESTART_DELAY_MS);
}

function start() {
  if (stopping) return;
  child = spawn(process.execPath, [BRIDGE], { cwd: ROOT, stdio: 'inherit' });
  console.log(`[supervisor] bridge 已启动 (pid ${child.pid})`);
  child.on('exit', (code, signal) => {
    console.log(`[supervisor] bridge 进程退出 code=${code} signal=${signal ?? ''}`);
    child = null;
    if (!stopping) maybeRestart(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`[supervisor] bridge 启动失败: ${err.message}`);
    child = null;
    if (!stopping) maybeRestart(1);
  });
}

process.on('SIGINT', () => { stopping = true; child?.kill('SIGINT'); setTimeout(() => process.exit(0), 300); });
process.on('SIGTERM', () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(0), 300); });

start();
