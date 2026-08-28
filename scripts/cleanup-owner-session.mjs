// 清理管理员私聊(owner)的污染：删除 sessions.json 映射 + social-v2.json 里的 conversation 条目，
// 使重启后桥接为管理员私聊重新创建干净的会话（qq-admin 预设）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OWNER_KEY = process.env.OWNER_KEY || 'private:1471336506';

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// 1) sessions.json：删除 owner key 映射
const sessionsFile = join(ROOT, 'state', 'sessions.json');
const sessions = readJson(sessionsFile, { sessions: {} });
const oldSid = sessions.sessions?.[OWNER_KEY];
if (oldSid) {
  delete sessions.sessions[OWNER_KEY];
  writeJson(sessionsFile, sessions);
  console.log(`✅ sessions.json：已删除 ${OWNER_KEY} -> ${oldSid}`);
} else {
  console.log(`- sessions.json：${OWNER_KEY} 无映射，无需处理`);
}

// 2) social-v2.json：删除 owner key conversation 条目
const svFile = join(ROOT, 'state', 'social-v2.json');
const sv = readJson(svFile, { conversations: {} });
if (sv.conversations && OWNER_KEY in sv.conversations) {
  delete sv.conversations[OWNER_KEY];
  writeJson(svFile, sv);
  console.log(`✅ social-v2.json：已删除 ${OWNER_KEY} 的 conversation 条目`);
} else {
  console.log(`- social-v2.json：${OWNER_KEY} 无条目，无需处理`);
}

console.log('清理完成。');
