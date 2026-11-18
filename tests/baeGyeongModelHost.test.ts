import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';

// BAE경 모델 일꾼 지키기 (electron/bae/model/modelHost.ts) 와 모델 통로 (modelIpc.ts) — Electron 없이, 가짜 일꾼으로.
// 진짜 일꾼(utilityProcess · DirectML)은 C:\BAE_stage0\model_port\ 의 Electron 시험이 본다.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

/** 가짜 일꾼: utilityProcess 처럼 message · exit 를 내고, 받은 말에 handler 로 답한다. */
class FakeChild extends EventEmitter {
  static seq = 100;
  pid = FakeChild.seq++;
  sent: Array<{ msg: any; transfer?: unknown[] }> = [];
  killed = false;
  env: Record<string, string>;
  handler: (c: FakeChild, m: any) => void;
  constructor(env: Record<string, string>, handler: (c: FakeChild, m: any) => void, readyDelay = 0) {
    super(); this.env = env; this.handler = handler;
    if (readyDelay >= 0) setTimeout(() => { if (!this.killed) this.emit('message', { type: 'ready', pid: this.pid }); }, readyDelay);
  }
  postMessage(msg: any, transfer?: unknown[]) { this.sent.push({ msg, transfer }); if (!this.killed) setImmediate(() => this.handler(this, msg)); }
  reply(m: any) { if (!this.killed) this.emit('message', m); }
  kill() { if (this.killed) return false; this.killed = true; setImmediate(() => this.emit('exit', 0)); return true; }
  die(code = 3221225477) { this.killed = true; this.emit('exit', code); }
}

function harness(opts: { handler?: (c: FakeChild, m: any) => void; idleMs?: number; readyDelay?: number } = {}) {
  const children: FakeChild[] = []; const exits: any[] = [];
  let clock = 1_000_000; const intervals: Array<() => void> = [];
  const handler = opts.handler ?? ((c: FakeChild, m: any) => {
    if (m.type === 'hello') c.reply({ id: m.id, ok: true, pid: c.pid, env: c.env });
    if (m.type === 'up.a') { c.reply({ id: m.id, progress: { done: 1, total: 2 } }); c.reply({ id: m.id, progress: { done: 2, total: 2 } }); c.reply({ id: m.id, ok: true, w: m.W * 2, h: m.H * 2 }); }
    if (m.type === 'slow') { /* 답하지 않음 */ }
    if (m.type === 'fail') c.reply({ id: m.id, ok: false, error: '모델이 아직 이 PC 에 없어요.', code: 'MODEL_MISSING' });
  });
  return {
    children, exits, intervals,
    advance(ms: number) { clock += ms; for (const f of intervals) f(); },
    opts: {
      fork: (env: Record<string, string>) => { const c = new FakeChild(env, handler, opts.readyDelay ?? 0); children.push(c); return c; },
      env: { BAE_MODEL_ROOT: 'C:/x/models', BAE_MODEL_EP: 'dml' },
      idleMs: opts.idleMs ?? 300_000,
      now: () => clock,
      setInterval: (fn: () => void) => { intervals.push(fn); return fn; },
      clearInterval: (h: unknown) => { const i = intervals.indexOf(h as () => void); if (i >= 0) intervals.splice(i, 1); },
      onExit: (info: unknown) => exits.push(info),
    },
  };
}

test('started on the first request; requests wait for "ready"; progress and answers are matched by id', async () => {
  const { createBaeModelHost } = await load('electron/bae/model/modelHost.ts');
  const h = harness({ readyDelay: 20 });
  const host = createBaeModelHost(h.opts);
  assert.equal(host.state().running, false);
  assert.equal(h.children.length, 0, 'nothing is started before it is needed');
  const ticks: number[][] = [];
  const [a, b] = await Promise.all([host.request({ type: 'hello' }), host.request({ type: 'up.a', W: 32, H: 16, rgba: new Uint8Array(32 * 16 * 4) }, { onProgress: (d: number, n: number) => ticks.push([d, n]) })]);
  assert.equal(h.children.length, 1, 'one worker for both');
  assert.equal(a.pid, h.children[0].pid); assert.deepEqual(a.env, { BAE_MODEL_ROOT: 'C:/x/models', BAE_MODEL_EP: 'dml' });
  assert.equal(b.w, 64); assert.deepEqual(ticks, [[1, 2], [2, 2]]);
  await assert.rejects(host.request({ type: 'fail' } as any), (e: any) => e.code === 'MODEL_MISSING' && /아직 이 PC 에 없어요/.test(e.message));
  assert.equal(host.state().pending, 0);
});

test('the worker dies mid-request → that request fails, Bflow goes on, and the next request starts a new worker', async () => {
  const { createBaeModelHost } = await load('electron/bae/model/modelHost.ts');
  const h = harness();
  const host = createBaeModelHost(h.opts);
  await host.request({ type: 'hello' });
  const first = h.children[0];
  const slow = host.request({ type: 'slow' } as any);
  await new Promise((r) => setImmediate(r));
  first.die();
  await assert.rejects(slow, (e: any) => e.code === 'WORKER_EXIT' && /다시 누르면 새로 띄워서/.test(e.message));
  assert.deepEqual(h.exits, [{ code: 3221225477, expected: false, reason: 'exit 3221225477' }]);
  assert.equal(host.state().running, false);
  assert.equal(host.state().crashes, 1);
  const again = await host.request({ type: 'hello' });
  assert.equal(h.children.length, 2, 'a new worker');
  assert.equal(again.pid, h.children[1].pid);
  assert.equal(host.state().starts, 2);
  // 죽은 일꾼의 늦은 말은 새 일꾼의 요청과 섞이지 않는다
  first.emit('message', { id: 999, ok: true, pid: 'ghost' });
  assert.equal(host.state().pending, 0);
});

test('a worker that never gets ready is stopped and its requests fail; the next request tries again', async () => {
  const { createBaeModelHost } = await load('electron/bae/model/modelHost.ts');
  const h = harness({ readyDelay: -1 });   // 준비됨을 끝내 보내지 않음
  const timeouts: Array<() => void> = [];
  const host = createBaeModelHost({ ...h.opts, setTimeout: (fn: () => void) => { timeouts.push(fn); return fn; }, clearTimeout: () => {} });
  const p = host.request({ type: 'hello' });
  timeouts[0]();   // 준비 시간이 지남
  await assert.rejects(p, (e: any) => e.code === 'WORKER_EXIT');
  assert.equal(host.state().running, false);
});

test('idle for 5 minutes → the worker is let go (memory back); work through the private channel counts as activity', async () => {
  const { createBaeModelHost } = await load('electron/bae/model/modelHost.ts');
  const h = harness({ idleMs: 300_000 });
  const host = createBaeModelHost(h.opts);
  await host.request({ type: 'hello' });
  h.advance(200_000); assert.equal(host.state().running, true);
  h.children[0].reply({ type: 'activity' });   // 화면 쪽 일꾼이 전용 통로로 일을 시킴
  h.advance(200_000); assert.equal(host.state().running, true, 'activity on the port keeps it up');
  // 일이 걸려 있는 동안은 내리지 않는다
  const slow = host.request({ type: 'slow' } as any);
  h.advance(400_000); assert.equal(host.state().running, true, 'never while a request is pending');
  h.children[0].reply({ id: host.state().pending ? 2 : 0, ok: true });
  await slow;
  h.advance(299_000); assert.equal(host.state().running, true);
  h.advance(2_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(host.state().running, false, 'stopped after 5 quiet minutes');
  assert.equal(h.children[0].killed, true);
  assert.deepEqual(h.exits.at(-1), { code: 0, expected: true, reason: 'idle' });
  assert.equal(host.state().crashes, 0); assert.equal(host.state().idleStops, 1);
  await host.request({ type: 'hello' });
  assert.equal(h.children.length, 2, 'started again on the next request');
});

test('a port is handed to the worker with the transfer list; restartWith changes the next worker (the "no graphics card" switch)', async () => {
  const { createBaeModelHost } = await load('electron/bae/model/modelHost.ts');
  const h = harness();
  const host = createBaeModelHost(h.opts);
  const port = { fake: 'port' };
  host.connectPort(port);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(h.children[0].sent[0], { msg: { type: 'port' }, transfer: [port] });
  host.restartWith({ BAE_MODEL_FAKE_NO_GPU: 'session' });
  await new Promise((r) => setTimeout(r, 5));
  const r = await host.request({ type: 'hello' });
  assert.equal(r.env.BAE_MODEL_FAKE_NO_GPU, 'session');
  assert.equal(h.children.length, 2);
  assert.equal(h.exits[0].expected, true);
});

// ── 모델 통로 (modelIpc) ──
function fakeIpc() {
  const handlers = new Map<string, (e: any, ...a: unknown[]) => Promise<unknown>>();
  return { handlers, ipc: { handle: (ch: string, fn: any) => { handlers.set(ch, fn); } } };
}
async function ipcHarness(over: Record<string, unknown> = {}) {
  const { registerBaeModelIpc, BAE_MODEL_CHANNELS } = await load('electron/bae/model/modelIpc.ts');
  const { ipc, handlers } = fakeIpc();
  let session = { userId: 'u1', epoch: 7 };
  const calls: any[] = []; const sent: any[] = []; const broadcasts: any[] = [];
  const deps = {
    ipc, getSessionOriginOrThrow: () => session, canUse: async (u: string) => u !== 'nobody',
    store: {
      ensure: async (id: string, p: (x: unknown) => void) => { calls.push(['ensure', id]); p({ id, phase: 'done' }); return { id, files: { [`${id}/model.onnx`]: import.meta.filename }, sources: { [`${id}/model.onnx`]: 'local' } }; },
      states: async () => [{ id: 'depth', ready: true }], filePath: () => '',
    },
    host: {
      request: async (msg: any, o: any) => { calls.push(['request', msg.type, msg.W, msg.H, msg.rgba?.byteLength]); o?.onProgress?.(1, 2); return { w: msg.W * 2, h: msg.H * 2, rgba: new Uint8ClampedArray(4), ep: 'dml', ms: 5, tiles: 2, fellBack: false }; },
      connectPort: (p: unknown) => calls.push(['port', p]),
      state: () => ({ running: true, pid: 9, starts: 1, crashes: 0 }),
    },
    runCheck: async (w: unknown) => { calls.push(['check', w]); return { checkedAt: new Date().toISOString(), level: 'ok' }; },
    pcChecks: { put: async (u: string, pc: string, c: any) => { calls.push(['put', u, pc, c.level]); return { userId: u }; }, list: async (u: string) => { calls.push(['list', u]); return []; } },
    pcId: async () => 'pc-1',
    makeChannel: () => ({ port1: 'P1', port2: 'P2' }),
    broadcast: (ch: string, p: unknown) => broadcasts.push([ch, p]),
    ...over,
  };
  registerBaeModelIpc(deps);
  const ev = { sender: { send: (ch: string, p: unknown) => sent.push([ch, p]), postMessage: (ch: string, m: unknown, t: unknown[]) => sent.push([ch, m, t]) } };
  const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(ev, ...args);
  return { call, calls, sent, broadcasts, handlers, channels: BAE_MODEL_CHANNELS, setSession: (s: typeof session) => { session = s; } };
}

test('model IPC: every channel is registered, checks the session epoch and the BAE right', async () => {
  const h = await ipcHarness();
  assert.deepEqual([...h.handlers.keys()].sort(), [...h.channels].sort());
  await assert.rejects(h.call('bae:model-status', 6), /로그인 세션이 바뀌었어요/);
  assert.deepEqual((await h.call('bae:model-status', 7) as any).worker, { running: true, pid: 9, starts: 1, crashes: 0 });
  h.setSession({ userId: 'nobody', epoch: 7 });
  await assert.rejects(h.call('bae:model-ensure', 'depth', 7), /권한이 없습니다/);
  await assert.rejects(h.call('bae:upscale-a', new Uint8Array(64 * 64 * 4), 64, 64, 't1', 7), /권한이 없습니다/);
  await assert.rejects(h.call('bae:model-port', 7), /권한이 없습니다/);
});

test('model IPC: ensure · files · 4K A validate what the screen sends', async () => {
  const h = await ipcHarness();
  await assert.rejects(h.call('bae:model-ensure', '../etc', 7), /알 수 없는 모델/);
  assert.deepEqual(await h.call('bae:model-ensure', 'depth', 7), { id: 'depth', sources: { 'depth/model.onnx': 'local' } });
  assert.deepEqual(h.broadcasts[0], ['bae:model-progress', { id: 'depth', phase: 'done' }]);
  await assert.rejects(h.call('bae:model-files', 'sam', 7), /화면에서 쓰는 모델이 아니에요/, 'worker models never go to the screen');
  await assert.rejects(h.call('bae:upscale-a', 'nope', 64, 64, 't', 7), /그림 데이터가 없어요/);
  await assert.rejects(h.call('bae:upscale-a', new Uint8Array(10), 64, 64, 't', 7), /크기가 맞지 않아요/);
  await assert.rejects(h.call('bae:upscale-a', new Uint8Array(4), 1, 1, 't', 7), /그림 크기가 올바르지 않아요/);
  const r: any = await h.call('bae:upscale-a', new Uint8Array(32 * 16 * 4), 32, 16, 'tk-1', 7);
  assert.equal(r.w, 64); assert.equal(r.ep, 'dml');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'ensure').at(-1), ['ensure', 'up-a'], 'the model is ready before the worker is asked');
  assert.deepEqual(h.calls.at(-1), ['request', 'up.a', 32, 16, 2048]);
  assert.deepEqual(h.sent.at(-1), ['bae:upscale-progress', { ticket: 'tk-1', done: 1, total: 2 }]);
});

test('model IPC: the port goes to the worker and to the asking window only; a session change drops the answer', async () => {
  const h = await ipcHarness();
  const nonce = await h.call('bae:model-port', 7) as string;
  assert.match(nonce, /^p[0-9a-z]+$/);
  assert.deepEqual(h.calls.at(-1), ['port', 'P1']);
  assert.deepEqual(h.sent.at(-1), ['bae:model-port', { nonce }, ['P2']]);
  // 점검: 화면이 보낸 WebGPU 정보는 모양만 추려 넣는다, 서버로는 마지막 점검을 올린다
  await h.call('bae:pc-check', { ok: true, name: 'x'.repeat(500), evil: 1 }, 7);
  assert.deepEqual(h.calls.at(-1), ['check', { ok: true, f16: undefined, name: 'x'.repeat(120), why: undefined }]);
  await h.call('bae:pc-check-put', 7);
  assert.deepEqual(h.calls.at(-1), ['put', 'u1', 'pc-1', 'ok']);
  // 응답 전에 로그인이 바뀌면 버린다
  const slow = await ipcHarness({ runCheck: async () => { await new Promise((r) => setTimeout(r, 10)); return { checkedAt: new Date().toISOString(), level: 'ok' }; } });
  const p = slow.call('bae:pc-check', null, 7);
  slow.setSession({ userId: 'u2', epoch: 8 });
  await assert.rejects(p, /로그인 세션이 바뀌어/);
});
