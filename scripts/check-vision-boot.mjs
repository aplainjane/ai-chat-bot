import { NodeApiClient } from '../src/dsh-client.js';

const api = new NodeApiClient('http://127.0.0.1:3080');
const res = await fetch('http://127.0.0.1:3080/', { headers: { cookie: api.cookie } });
const html = await res.text();
const marker = 'globalThis["__DSH_BOOT__"] = ';
const from = html.indexOf(marker);
const s = html.indexOf('{', from);
const e = html.indexOf('</script>', from);
const boot = JSON.parse(html.slice(s, e).replace(/;\s*$/, ''));
const entry = (boot.entries ?? []).find(x => /vision/.test(x.id));
console.log('新 rev:', entry.rev);
const bres = await fetch(new URL(entry.url, 'http://127.0.0.1:3080').href, { headers: { cookie: api.cookie } });
const body = await bres.text();
console.log('mutate 已包 args:', body.includes('ns: req.ns') && body.includes('args: {') ? 'YES' : 'NO');
// 检查不再有旧的未包 args 的 mutate（顶层 ns 紧跟 rpc.call）
const bad = body.match(/rpc\.call\('\/api', 'settings\/mutate', \{\s*\n\s*ns:/);
console.log('旧错误形式残留:', bad ? 'YES' : 'NO');
// 打印 mutate 附近的片段确认
const mi = body.indexOf("settings/mutate");
if (mi >= 0) console.log('--- mutate 片段 ---\n' + body.slice(mi - 40, mi + 160));
process.exit(0);
