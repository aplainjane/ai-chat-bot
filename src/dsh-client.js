// Node 环境的 DSH Web API 客户端 —— 适配新版 DSH（浏览器令牌 cookie 认证 + Typert RPC + WebSocket mux 事件流）。
// 协议：
//   - unary RPC：POST /api/<namespace>/<method>，body 为 { type:'client-request', rpcId, method, payload:{ args:{...} } }
//   - 事件流：WebSocket /api/remote.mux 复用一条连接，多路复用若干逻辑流（$events 全局事件 + 每会话 session/follow）
//   - 提问/审批：经 $events 流的 waterfall 帧下发，用 $events/result RPC 应答
// 认证：DSH 要求每个 /api 请求带浏览器会话 cookie；本客户端读取 ~/.dsh/.credentials.yaml 中的签名密钥本地生成合法 cookie。
import { createHash, createHmac, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ---- base64url ----
function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4), 'base64');
}

/**
 * 伪造 DSH 浏览器会话 cookie。
 * DSH 的 cookie 由 ~/.dsh/.credentials.yaml 中的 browser-session 签名密钥签发，格式公开：
 *   cookie 名 = dsh-auth-<sha256(authority) 的 base64url>
 *   cookie 值 = v1.<body>.<sig>，body 为 {version, authority, issuedAt, expiresAt} 的 base64url JSON，
 *   sig 为 HMAC-SHA256(secret, body)。
 * 生成后即可通过 /api 信任栅栏 + 认证，与浏览器换取的 cookie 等价（本机操作者持有签名密钥）。
 */
export function forgeDshCookie(baseUrl) {
  const authority = new URL(baseUrl).host; // 例如 127.0.0.1:3080
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const credFile = path.join(home, '.credentials.yaml');
  let text = null;
  try {
    text = fs.readFileSync(credFile, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 DSH 浏览器会话签名密钥 ${credFile}: ${error?.message ?? error}`);
  }
  const m = String(text).match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`未在 ${credFile} 中找到 browser-session secret`);
  const secret = decodeBase64Url(m[1]);
  const cookieName = 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest());
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000;
  const body = encodeBase64Url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'));
  const sig = encodeBase64Url(createHmac('sha256', secret).update(body).digest());
  return `${cookieName}=v1.${body}.${sig}`;
}

/**
 * 一条复用物理 WebSocket 的 mux 会话：负责连接 /api/remote.mux、打开 $events 流、
 * 为每个已跟踪会话打开 session/follow 流，并把收到的帧转成桥接需要的信封。
 * 生命周期与一次 events.mux() 调用绑定（桥接在事件流中断后自行重试新建）。
 */
class MuxSession {
  constructor(client) {
    this.client = client;
    this.socket = null;
    this.closed = false;
    this.failure = null;
    this.eventsStreamId = null;
    this.eventsClientId = null;
    this.sessionToStream = new Map(); // sessionId -> streamId
    this.followByStream = new Map();  // streamId -> sessionId
    this.inboxes = new Map();         // streamId -> { frames:[], waiters:[], done:false }
    this.envelopesQueue = [];
    this.envelopeWaiters = [];
    this.nextStreamSeq = 1;
  }

  nextStreamId() {
    return `s${this.nextStreamSeq++}`;
  }

  send(obj) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('DSH mux WebSocket 未连接');
    }
    this.socket.send(JSON.stringify(obj));
  }

  openStream(endpoint, payload) {
    const streamId = this.nextStreamId();
    this.inboxes.set(streamId, { frames: [], waiters: [], done: false });
    this.send({ type: 'open', streamId, endpoint, payload });
    return streamId;
  }

  openFollow(sessionId) {
    if (this.sessionToStream.has(sessionId)) return;
    const streamId = this.openStream('session/follow', {
      args: { request: { address: { kind: 'session', sessionId } } },
    });
    this.sessionToStream.set(sessionId, streamId);
    this.followByStream.set(streamId, sessionId);
  }

  /** 建立连接、打开 $events 与已跟踪会话的 follow 流，随后回调 onOpen。 */
  async open(onOpen) {
    const url = new URL('/api/remote.mux', this.client.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url.href, { headers: { cookie: this.client.cookie } });
    this.socket = ws;
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('DSH mux WebSocket 打开失败')), { once: true });
    });
    ws.addEventListener('message', (event) => this.routeMessage(event));
    ws.addEventListener('close', () => this.fail(new Error('DSH mux 连接关闭')));
    ws.addEventListener('error', () => this.fail(new Error('DSH mux 连接错误')));
    this.eventsStreamId = this.openStream('$events', { args: {} });
    for (const sessionId of this.client.followed) this.openFollow(sessionId);
    onOpen?.();
  }

  routeMessage(event) {
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'item') {
      if (msg.streamId === this.eventsStreamId) this.routeEventsItem(msg.value);
      else this.routeFollowItem(msg.streamId, msg.value);
      return;
    }
    // error / end
    const inbox = this.inboxes.get(msg.streamId);
    if (!inbox) return;
    if (msg.type === 'error') inbox.frames.push({ kind: 'error', error: msg.error });
    else if (msg.type === 'end') {
      inbox.frames.push({ kind: 'end' });
      inbox.done = true;
    } else return;
    const waiter = inbox.waiters.shift();
    waiter?.();
  }

  routeEventsItem(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ready') {
      this.eventsClientId = value.clientId;
      return;
    }
    if (value.type === 'emit') return; // 会话生命周期事件（api-session/*）暂不使用
    if (value.type === 'waterfall') {
      const eventId = value.eventId;
      const agentId = value.agentId;
      const request = value.request ?? {};
      if (value.event === 'user-questions/request') {
        const rpcId = randomUUID();
        this.client.waterfallByRpcId.set(rpcId, { clientId: this.eventsClientId, eventId, kind: 'question' });
        this.pushEnvelope({ rpcId, payload: {
          type: 'question/requested',
          sessionId: agentId,
          questions: Array.isArray(request.questions) ? request.questions : [],
        } });
      } else if (value.event === 'approval/request') {
        const rpcId = randomUUID();
        this.client.waterfallByRpcId.set(rpcId, { clientId: this.eventsClientId, eventId, kind: 'approval' });
        this.pushEnvelope({ rpcId, payload: {
          type: 'approval/requested',
          sessionId: agentId,
          approvalId: eventId,
          toolName: String(request.toolName ?? ''),
          ...(request.reason === undefined ? {} : { reason: String(request.reason) }),
        } });
      }
    }
  }

  routeFollowItem(streamId, value) {
    const sessionId = this.followByStream.get(streamId);
    if (sessionId === undefined || !value || typeof value !== 'object') return;
    // 只转发 live 事件帧；snapshot 历史重放会重复发送旧 turn，忽略。
    if (value.type === 'event') {
      this.pushEnvelope({ rpcId: randomUUID(), payload: { type: 'session/event', sessionId, event: value.event } });
    }
  }

  pushEnvelope(envelope) {
    this.envelopesQueue.push(envelope);
    const waiter = this.envelopeWaiters.shift();
    waiter?.(envelope);
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const inbox of this.inboxes.values()) {
      inbox.done = true;
      inbox.frames.push({ kind: 'error', error: { code: 'carrier', message: error.message, details: {} } });
      const waiter = inbox.waiters.shift();
      waiter?.();
    }
    while (this.envelopeWaiters.length) {
      const waiter = this.envelopeWaiters.shift();
      waiter?.(this.failure);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket?.close(); } catch {}
  }

  /** 逐条产出桥接信封；连接失败时抛错（桥接捕获后 3 秒重连）。 */
  async *envelopes(signal) {
    for (;;) {
      while (this.envelopesQueue.length > 0) yield this.envelopesQueue.shift();
      if (this.failure) throw this.failure;
      if (signal?.aborted) return;
      const next = await new Promise((resolve) => this.envelopeWaiters.push(resolve));
      if (next instanceof Error) throw next;
    }
  }
}

/**
 * 新版 DSH Web API 客户端。
 * 方法返回旧版一致的 RpcResponse 信封形状 { result: { ok, value, error } }，
 * 桥接/自测通过 unwrap() 或直接读 .result.ok 使用，业务错误不抛、以 result.ok=false 返回。
 */
export class NodeApiClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = String(baseUrl ?? 'http://127.0.0.1:3080').replace(/\/+$/, '');
    this.cookie = forgeDshCookie(this.baseUrl);
    this.timeoutMs = timeoutMs ?? 300000;
    this.followed = new Set();           // 已跟踪会话（自动打开 session/follow）
    this.waterfallByRpcId = new Map();   // 提问/审批信封 rpcId -> {clientId, eventId, kind}
    this.activeMux = null;               // 当前活动的 MuxSession（events.mux 期间）

    // 与旧版一致的领域方法表面（桥接/自测直接调用）
    this.host = { describe: async () => this.hostDescribe() };
    this.sessions = {
      create: async (params) => this.sessionCreate(params),
      prompt: async (params) => this.sessionPrompt(params),
      selectModel: async (params) => this.sessionSelectModel(params),
    };
    this.workspace = {
      create: async (params) => this.workspaceCreate(params),
      rename: async (params) => this.workspaceRename(params),
      list: async () => this.workspaceList(),
      archiveSession: async (params) => this.workspaceArchiveSession(params),
      delete: async (params) => this.workspaceDelete(params),
    };
    this.settings = { describe: async () => this.settingsDescribe() };
    this.agentPresets = { list: async () => this.agentPresetsList() };
    this.events = {
      mux: (payload, signal, onOpen) => this.eventsMux(payload, signal, onOpen),
      trackSession: (sessionId) => this.trackSession(sessionId),
    };
  }

  // ---- 统一 RPC（返回 {result} 信封；传输/HTTP 层错误抛异常，业务错误以 result.ok=false 返回） ----
  async rpc(endpoint, args) {
    const rpcId = randomUUID();
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: this.cookie },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`transport failure for /api/${endpoint}: ${error?.message ?? error}`);
    }
    if (!response.ok) {
      throw new Error(`transport failure for /api/${endpoint}: HTTP ${response.status}`);
    }
    let full;
    try {
      full = await response.json();
    } catch {
      throw new Error(`invalid JSON response for /api/${endpoint}`);
    }
    if (!full || full.type !== 'server-response' || !full.result) {
      throw new Error(`invalid server-response for /api/${endpoint}`);
    }
    return { result: full.result };
  }

  // ---- 健康检查（新版无 host.describe；用 settings/describe 探活） ----
  async hostDescribe() {
    try {
      await this.rpc('settings/describe', {});
    } catch (error) {
      throw error;
    }
    return { result: { ok: true, value: {} } };
  }

  // ---- settings ----
  async settingsDescribe() {
    return this.rpc('settings/describe', {});
  }

  // ---- agentPresets ----
  async agentPresetsList() {
    return this.rpc('agentPresets/list', {});
  }

  // ---- workspace ----
  async workspaceCreate(params) {
    return this.rpc('workspace/create', { request: { path: params?.path } });
  }

  async workspaceRename(params) {
    return this.rpc('workspace/rename', { request: { workspaceId: params?.workspaceId, title: params?.title } });
  }

  // 新版 DSH 无 workspace/list 端点；返回空列表（仅影响控制台“重置工作区”的会话归档，不影响主链路）。
  async workspaceList() {
    return { result: { ok: true, value: { items: [] } } };
  }

  async workspaceArchiveSession(params) {
    return this.rpc('workspace/archiveSession', { request: { sessionId: params?.sessionId } });
  }

  async workspaceDelete(params) {
    return this.rpc('workspace/delete', { request: { workspaceId: params?.workspaceId } });
  }

  // ---- sessions ----
  async sessionCreate(params) {
    const request = {};
    if (params?.cwd !== undefined) request.cwd = params.cwd;
    if (params?.workspaceId !== undefined) request.workspaceId = params.workspaceId;
    if (params?.agentPreset !== undefined) request.agentPreset = params.agentPreset;
    if (params?.sessionId !== undefined) request.sessionId = params.sessionId;
    const resp = await this.rpc('session/create', { request });
    if (resp.result.ok && resp.result.value?.sessionId) {
      this.trackSession(resp.result.value.sessionId);
    }
    return resp;
  }

  async sessionPrompt(params) {
    const sessionId = params?.sessionId;
    if (sessionId) this.trackSession(sessionId);
    const request = {
      requestId: randomUUID(),
      sessionId,
      mode: params?.mode ?? 'queue',
      content: Array.isArray(params?.content) ? params.content : [],
    };
    if (params?.clientTimeZone) request.clientTimeZone = params.clientTimeZone;
    return this.rpc('session/prompt', { request });
  }

  async sessionSelectModel(params) {
    const request = {
      sessionId: params?.sessionId,
      provider: params?.provider,
      model: params?.model,
    };
    if (params?.reasoningEffort !== undefined && params.reasoningEffort !== null && params.reasoningEffort !== '') {
      request.reasoningEffort = params.reasoningEffort;
    }
    return this.rpc('session/selectModel', { request });
  }

  // ---- 会话跟踪（自动打开 session/follow 事件流） ----
  trackSession(sessionId) {
    if (!sessionId || this.followed.has(sessionId)) return;
    this.followed.add(sessionId);
    const mux = this.activeMux;
    if (mux) {
      try {
        mux.openFollow(sessionId);
      } catch (error) {
        // mux 未就绪时由下次连接兜底
      }
    }
  }

  // ---- 事件流（桥接 pumpMux 消费；中断抛错由桥接重试） ----
  async *eventsMux(_payload, signal, onOpen) {
    const mux = new MuxSession(this);
    this.activeMux = mux;
    try {
      await mux.open(onOpen);
      if (signal?.aborted) return;
      yield* mux.envelopes(signal);
    } finally {
      if (this.activeMux === mux) this.activeMux = null;
      mux.close();
    }
  }

  // ---- 提问/审批应答（把旧版 respond 信封翻译成 $events/result RPC） ----
  async respond(payload) {
    const rpcId = payload?.rpcId;
    const info = rpcId ? this.waterfallByRpcId.get(rpcId) : undefined;
    if (!info) throw new Error(`未知的提问/审批回执 rpcId: ${String(rpcId)}`);
    const value = payload?.result?.value;
    let outcome;
    if (info.kind === 'question') {
      const answers = value?.answer?.answers ?? [];
      outcome = { kind: 'result', value: { answers } };
    } else {
      const o = value?.outcome ?? 'rejected';
      outcome = { kind: 'result', value: o };
    }
    try {
      const resp = await this.rpc('$events/result', {
        clientId: info.clientId,
        eventId: info.eventId,
        outcome,
      });
      this.waterfallByRpcId.delete(rpcId);
      return resp;
    } catch (error) {
      throw error;
    }
  }
}

/** 把 RpcResponse 的结果槽解出来；业务错误直接抛出。 */
export function unwrap(response, label) {
  if (response.result.ok) return response.result.value;
  const { code, message } = response.result.error;
  throw new Error(`${label} failed: ${code}: ${message}`);
}

/** 在会话事件流里收集一次 turn 的 assistant 文本（按 turn 分组）。 */
export function createTurnCollector() {
  const turns = new Map(); // turn -> { text }
  return {
    /** 处理一条 session/event，返回该事件是否终结了一个 turn（此时可取最终文本）。 */
    push(event) {
      if (event.type === 'turn/start') {
        turns.set(event.data.turn, { text: '' });
        return null;
      }
      if (event.type === 'assistant/chunk') {
        // 忽略流式分块：assistant/message 携带同一内容的完整组装文本，
        // 两者都累加会导致回复文本翻倍（曾因此把「收到」发成「收到收到」）。
        return null;
      }
      if (event.type === 'assistant/message') {
        const t = turns.get(event.data.turn);
        if (!t) return null;
        for (const block of event.data.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') t.text += block.text;
        }
        return null;
      }
      if (event.type === 'turn/end') {
        const t = turns.get(event.data.turn);
        turns.delete(event.data.turn);
        if (!t) return null;
        return { turn: event.data.turn, reason: event.data.reason, text: t.text };
      }
      return null;
    },
    has(turn) {
      return turns.has(turn);
    }
  };
}

/** 从 assistant 消息的 ContentBlock[] 中提取纯文本。 */
export function blocksToText(content) {
  return (content ?? [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
