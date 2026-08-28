// 验证 ask/deepseek-v4-flash-ga-260731 全链路
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap, createTurnCollector } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');
const cwd = path.join(process.cwd(), 'state', 'ask-model-test');
fs.mkdirSync(cwd, { recursive: true });
const { sessionId } = unwrap(await api.sessions.create({ cwd }), 'session.create');
console.log('✅ 会话:', sessionId);

const sel = await api.sessions.selectModel({ sessionId, provider: 'ask', model: 'deepseek-v4-flash-ga-260731', reasoningEffort: 'medium' });
console.log('✅ selectModel ok =', sel.result?.ok, JSON.stringify(sel.result?.value ?? sel.result?.error).slice(0, 150));

const collector = createTurnCollector();
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('90s 超时')), 90_000);
  (async () => {
    for await (const env of api.events.mux({})) {
      const f = env.payload;
      if (f.type === 'session/event' && f.sessionId === sessionId) {
        const ended = collector.push(f.event);
        if (ended) { clearTimeout(timer); resolve(ended); return; }
      }
    }
  })().catch(reject);
});
const acc = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: '只回复两个字：收到' }] });
console.log('✅ prompt ok =', acc.result?.ok);
const ended = await done;
console.log('✅ turn/end reason =', JSON.stringify(ended.reason));
console.log('🤖 回复 =', JSON.stringify(ended.text));
process.exit(0);
