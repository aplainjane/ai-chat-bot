// 验证 session/selectModel
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');
const cwd = path.join(process.cwd(), 'state', 'select-model-test');
fs.mkdirSync(cwd, { recursive: true });

const { sessionId } = unwrap(await api.sessions.create({ cwd }), 'session.create');
console.log('✅ 会话已创建:', sessionId);

const r = await api.sessions.selectModel({
  sessionId,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash-vision-exp',
  reasoningEffort: 'max',
});
console.log('✅ selectModel ok =', r.result?.ok, 'value =', JSON.stringify(r.result?.value));

const bad = await api.sessions.selectModel({ sessionId, provider: 'nope', model: 'x' });
console.log('⚠️ 非法 provider ok =', bad.result?.ok, 'error =', JSON.stringify(bad.result?.error).slice(0, 120));

process.exit(0);
