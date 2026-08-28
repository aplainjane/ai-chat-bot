// 诊断：打印会话事件流全部事件带时间戳，定位卡点
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');
const cwd = path.join(process.cwd(), 'state', 'diag2');
fs.mkdirSync(cwd, { recursive: true });
const { sessionId } = unwrap(await api.sessions.create({ cwd }), 'session.create');
console.log(`[${Date.now()}] 会话:`, sessionId);

const seen = new Set();
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => { console.log(`[${Date.now()}] TIMEOUT 90s`); resolve('timeout'); }, 90_000);
  (async () => {
    for await (const env of api.events.mux({})) {
      const f = env.payload;
      if (f.type === 'session/event' && f.sessionId === sessionId) {
        const ev = f.event;
        if (!seen.has(ev.type)) { seen.add(ev.type); console.log(`[${Date.now()}] 首次事件类型:`, ev.type); }
        if (ev.type === 'turn/end') {
          console.log(`[${Date.now()}] turn/end reason =`, JSON.stringify(ev.data.reason).slice(0, 300));
          clearTimeout(timer); resolve('end'); return;
        }
      }
    }
  })().catch(reject);
});

const acc = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: '只回复两个字：收到' }] });
console.log(`[${Date.now()}] prompt ok =`, acc.result?.ok, JSON.stringify(acc.result?.value ?? acc.result?.error).slice(0, 100));
console.log(`[${Date.now()}] 等待事件...`);
const r = await done;
console.log('结果:', r);
process.exit(0);
