// 验证 standard 预设的工具集（是否有 shell/文件工具）
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');
const dir = path.join(process.cwd(), 'state', 'std-check');
fs.mkdirSync(dir, { recursive: true });
const ws = unwrap(await api.workspace.create({ path: dir }), 'workspace.create');
const s = unwrap(await api.sessions.create({ workspaceId: ws.workspace.workspaceId, agentPreset: 'standard' }), 'session.create');
console.log('standard 会话:', s.sessionId);

const texts = [];
const done = new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 60_000);
  (async () => {
    for await (const env of api.events.mux({})) {
      const f = env.payload;
      if (f.type === 'session/event' && f.sessionId === s.sessionId) {
        const ev = f.event;
        if (ev.type === 'assistant/message') {
          for (const b of ev.data?.message?.content ?? []) if (b?.type === 'text') texts.push(b.text);
        }
        if (ev.type === 'turn/end') { clearTimeout(timer); resolve('end'); return; }
      }
    }
  })().catch(() => resolve('stream-error'));
});
const acc = await api.sessions.prompt({
  sessionId: s.sessionId, mode: 'queue',
  content: [{ type: 'text', text: '请一句话列出你当前拥有的全部工具的名字（只要名字，用逗号分隔，不用解释）。' }],
});
console.log('prompt ok =', acc.result?.ok);
const r = await done;
console.log('结果:', r);
console.log('--- standard 会话工具清单 ---');
console.log(texts.join('')?.slice(0, 1200) || '(无回复)');
process.exit(0);
