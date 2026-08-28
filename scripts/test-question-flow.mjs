// 提问/审批链路测试：让 agent 调用 ask_user_question，验证 $events waterfall + $events/result
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');

async function main() {
  const cwd = path.join(process.cwd(), 'state', 'question-test');
  fs.mkdirSync(cwd, { recursive: true });
  const { sessionId } = unwrap(await api.sessions.create({ cwd }), 'session.create');
  console.log('✅ 会话已创建:', sessionId);

  // 先订阅事件流（打开 $events + follow），再 prompt
  const muxDone = (async () => {
    for await (const envelope of api.events.mux({})) {
      const frame = envelope.payload;
      if (frame.type === 'question/requested') {
        console.log('✅ 收到提问帧:', JSON.stringify(frame.questions));
        const answers = (frame.questions ?? []).map((q) => ({ id: q.id, selected: [], custom: 'Python（测试回答）' }));
        const receipt = await api.respond({
          type: 'client-response',
          rpcId: envelope.rpcId,
          result: { ok: true, value: { sessionId: frame.sessionId, answer: { answers } } },
        });
        console.log('✅ 已回答提问, receipt ok =', receipt.result?.ok);
        return 'answered';
      }
      if (frame.type === 'session/event' && frame.sessionId === sessionId && frame.event?.type === 'turn/end') {
        return 'turn-end';
      }
    }
  })();

  const accepted = await api.sessions.prompt({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: '请调用 ask_user_question 工具向我提一个问题（例如你最喜欢的编程语言是什么）。收到我的回答后，用一句话总结并结束。' }],
  });
  console.log('✅ prompt 已接受:', JSON.stringify(accepted.result));

  const result = await Promise.race([
    muxDone,
    new Promise((_, rej) => setTimeout(() => rej(new Error('90s 超时未收到提问')), 90_000)),
  ]);
  console.log('🎉 结果:', result);
  process.exit(0);
}

main().catch((e) => { console.error('❌ 失败:', e?.message ?? e); process.exit(1); });
