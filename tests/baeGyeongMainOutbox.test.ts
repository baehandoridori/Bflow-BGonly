import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// BAE경 못 보낸 것 줄 (electron/bae/outbox.ts). 시험 폴더는 OS 임시 폴더 아래에 새로 만든다 (지우지 않는다).
let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const O = await load('electron/bae/outbox.ts');
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';
const TOKEN = 'sess-tok-7f3a9c1e5b2d4f60';
const JOB = '0f6f1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';

const freshDir = () => mkdtempSync(join(tmpdir(), 'bae-outbox-'));
const lines = (dir: string, file = 'outbox.jsonl') => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean) : []);
const allText = (dir: string) => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

/** 시계와 타이머는 손으로 돌린다. */
function rig(dir: string, handlers: Record<string, (p: unknown, id: string, ctx: { owner: string | null }) => Promise<unknown>>, extra: Record<string, unknown> = {}) {
  const clock = { t: 1_000_000 };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const box = O.createBaeOutbox({
    dir, handlers, now: () => clock.t, random: () => 0, log: () => undefined,
    setTimer: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => undefined,
    ...extra,
  });
  return { box, clock, timers };
}
const usage = (rid: string) => ({ kind: 'image', model: 'gpt-image-2.5-sunburst', requestId: rid, usd: 0.12, tokens: { input_tokens: 10 } });

test('a line that fails stays in the file, waits longer each time (5s → 10s → … → 10 min), and goes when it is sent', async () => {
  const dir = freshDir(); let mode = 'fail'; const sent: string[] = [];
  const { box, clock, timers } = rig(dir, { usage: async (_p, id) => { if (mode === 'fail') throw new Error('fetch failed'); sent.push(id); } });
  const r = await box.enqueue('usage', usage('req_1'), 'req_1');
  assert.deepEqual(r, { id: 'req_1', status: 'queued' });
  assert.equal(lines(dir).length, 1);
  const e = JSON.parse(lines(dir)[0]);
  assert.equal(e.id, 'req_1'); assert.equal(e.kind, 'usage'); assert.equal(e.tries, 1); assert.equal(e.nextAt - clock.t, 5_000); assert.equal(e.lastError, 'fetch failed');
  assert.equal(timers.at(-1)!.ms, 5_000, 'the next try is scheduled');
  const waits: number[] = [];
  for (let i = 0; i < 9; i++) { await box.flush({ all: true }); const p = box.pending()[0]; waits.push(p.nextAt - clock.t); }
  assert.deepEqual(waits, [10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 600_000, 600_000, 600_000]);
  // not due yet: a plain flush leaves it alone
  mode = 'ok'; await box.flush(); assert.deepEqual(sent, []);
  clock.t += 600_000; await box.flush();
  assert.deepEqual(sent, ['req_1']); assert.deepEqual(box.pending(), []); assert.deepEqual(lines(dir), []);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no half-written file is left');
  await box.stop();
});

test('the same id never goes in twice: not while it waits, not after it was sent', async () => {
  const dir = freshDir(); let calls = 0; let fail = true;
  const { box, clock } = rig(dir, { usage: async () => { calls++; if (fail) throw new Error('offline'); } });
  assert.equal((await box.enqueue('usage', usage('req_2'), 'req_2')).status, 'queued');
  assert.equal((await box.enqueue('usage', usage('req_2'), 'req_2')).status, 'duplicate');
  assert.equal(lines(dir).length, 1);
  fail = false; clock.t += 5_000; await box.flush();
  assert.equal((await box.enqueue('usage', usage('req_2'), { id: 'req_2' })).status, 'duplicate');
  assert.equal(calls, 2, 'one failed try, one success, nothing more');
  const a = await box.enqueue('usage', usage('x'));
  assert.match(a.id, /^[0-9a-f-]{36}$/, 'without an id it gets a uuid'); assert.equal(a.status, 'sent');
  await assert.rejects(box.enqueue('usage', usage('y'), '../../evil'), /번호표/);
  await assert.rejects(box.enqueue('nope', {}), /알 수 없는/);
  await box.stop();
});

test('after a restart (a new instance on the same folder) start() sends what was left, in order', async () => {
  const dir = freshDir();
  const first = rig(dir, { usage: async () => { throw new Error('offline'); }, job: async () => { throw new Error('offline'); } });
  await first.box.enqueue('job', { id: JOB, status: 'drawing' }, 'job-1');
  await first.box.enqueue('usage', usage('req_3'), 'req_3');
  await first.box.enqueue('job', { id: JOB, status: 'done' }, 'job-2');
  await first.box.stop();
  assert.equal(lines(dir).length, 3);
  const sent: string[] = [];
  const second = rig(dir, { usage: async (_p, id) => { sent.push(id); }, job: async (p) => { sent.push('job:' + (p as { status: string }).status); } });
  await second.box.start();
  assert.deepEqual(sent, ['job:drawing', 'req_3', 'job:done']);
  assert.deepEqual(lines(dir), []);
  await second.box.stop();
});

test('a broken line (the app died while writing) is set aside and the rest is read', async () => {
  const dir = freshDir();
  const ok = (id: string) => JSON.stringify({ id, kind: 'usage', payload: usage(id), tries: 0, nextAt: 0, createdAt: 1, owner: null, orderKey: null, lastError: null });
  writeFileSync(join(dir, 'outbox.jsonl'), ok('req_a') + '\n' + '{"id":"req_b","kind":"usa' + '\n' + 'garbage\r\n' + ok('req_c') + '\n');
  const sent: string[] = [];
  const { box } = rig(dir, { usage: async (_p, id) => { sent.push(id); } });
  await box.start();
  assert.deepEqual(sent, ['req_a', 'req_c']);
  const broken = readFileSync(join(dir, 'broken.txt'), 'utf8');
  assert.match(broken, /\{"id":"req_b","kind":"usa/); assert.match(broken, /garbage/);
  assert.deepEqual(lines(dir), []);
  await box.stop();
});

test('an error that sending again cannot fix moves the line to dead and the others go on; an expired login is not one', async () => {
  const dir = freshDir(); const sent: string[] = [];
  const { box, clock } = rig(dir, {
    job: async (p) => {
      const s = (p as { status: string }).status;
      if (s === 'other') throw Object.assign(new Error('다른 사람의 BAE경 작업 기록은 고칠 수 없습니다.'), { code: '42501' });
      if (s === 'shape') throw Object.assign(new Error('BAE경 작업 기록의 모양이 올바르지 않습니다.'), { code: '22023' });
      if (s === 'session') throw Object.assign(new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'), { code: '42501' });
      sent.push(s);
    },
  });
  assert.equal((await box.enqueue('job', { id: JOB, status: 'other' }, 'j1')).status, 'dead');
  assert.equal((await box.enqueue('job', { id: JOB, status: 'done' }, 'j2')).status, 'sent', 'a dead line does not hold the next one of the same job');
  assert.equal((await box.enqueue('job', { id: 'b' + JOB.slice(1), status: 'shape' }, 'j3')).status, 'dead');
  assert.equal((await box.enqueue('job', { id: 'c' + JOB.slice(1), status: 'session' }, 'j4')).status, 'queued');
  assert.deepEqual(sent, ['done']);
  const dead = lines(dir, 'dead.jsonl').map((l) => JSON.parse(l));
  assert.deepEqual(dead.map((d) => [d.id, d.lastError]), [['j1', '다른 사람의 BAE경 작업 기록은 고칠 수 없습니다.'], ['j3', 'BAE경 작업 기록의 모양이 올바르지 않습니다.']]);
  assert.deepEqual(box.pending().map((p: { id: string }) => p.id), ['j4']);
  assert.equal((await box.enqueue('job', { id: JOB, status: 'other' }, 'j1')).status, 'duplicate', 'a dead id does not come back');
  clock.t += 10_000; await box.stop();
  // a new instance knows the dead ids too
  const again = rig(dir, { job: async () => undefined });
  assert.equal((await again.box.enqueue('job', { id: JOB, status: 'other' }, 'j1')).status, 'duplicate');
  await again.box.stop();
});

test('a job\'s lines go in the order they were made: when the first fails, the next one waits; ledger lines do not wait', async () => {
  const dir = freshDir(); const calls: string[] = []; let failDrawing = true;
  const { box, clock } = rig(dir, {
    job: async (p) => { const s = (p as { status: string }).status; calls.push('job:' + s); if (s === 'drawing' && failDrawing) throw new Error('offline'); },
    preview: async () => { calls.push('preview'); },
    usage: async (_p, id) => { calls.push(id); },
  });
  await box.enqueue('job', { id: JOB, status: 'drawing' }, 'a');
  await box.enqueue('preview', { jobId: JOB, name: 'result.png' }, 'b');
  await box.enqueue('job', { id: JOB, status: 'done' }, 'c');
  await box.enqueue('usage', usage('req_4'), 'req_4');
  assert.deepEqual(calls, ['job:drawing', 'req_4'], 'the preview and done waited behind drawing; the ledger line went');
  failDrawing = false; clock.t += 5_000; await box.flush();
  assert.deepEqual(calls, ['job:drawing', 'req_4', 'job:drawing', 'preview', 'job:done']);
  assert.equal(O.baeDefaultOrderKey('usage', { jobId: JOB }), null);
  assert.equal(O.baeDefaultOrderKey('job', { id: JOB }), 'job:' + JOB);
  assert.equal(O.baeDefaultOrderKey('preview', { jobId: JOB }), 'job:' + JOB);
  await box.stop();
});

test('lines go only with the session of the person who put them in', async () => {
  const dir = freshDir(); const owners: Array<string | null> = []; let me: string | null = 'u1'; let fail = true;
  const { box } = rig(dir, { usage: async (_p, _id, ctx) => { owners.push(ctx.owner); if (fail) throw new Error('offline'); } }, { ownerNow: () => me });
  await box.enqueue('usage', usage('req_5'), 'req_5');
  assert.equal(box.pending()[0].owner, 'u1');
  fail = false; me = 'u2';
  await box.flush({ all: true });
  assert.deepEqual(owners, ['u1'], 'someone else is logged in: it waits');
  me = 'u1'; await box.flush({ all: true });
  assert.deepEqual(owners, ['u1', 'u1']); assert.deepEqual(box.pending(), []);
  me = null;
  await assert.rejects(box.enqueue('usage', usage('req_6'), 'req_6'), /로그인 세션/);
  assert.equal((await box.enqueue('usage', usage('req_7'), { id: 'req_7', owner: 'u3' })).status, 'queued', 'an owner caught at the start of the call is kept');
  await box.stop();
});

test('keys and session tokens never go into a line (and never reach the file)', async () => {
  const dir = freshDir();
  const { box } = rig(dir, { usage: async () => { throw new Error('offline'); } }, { forbiddenValues: () => [TOKEN, null] });
  await assert.rejects(box.enqueue('usage', { ...usage('r1'), note: `failed with ${FAKE_KEY}` }), /키나 로그인 정보/);
  await assert.rejects(box.enqueue('usage', { ...usage('r2'), p_session_token: 'x' }), /키나 로그인 정보/);
  await assert.rejects(box.enqueue('usage', { ...usage('r3'), nested: { apiKey: 'x' } }), /키나 로그인 정보/);
  await assert.rejects(box.enqueue('usage', { ...usage('r4'), header: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' }), /키나 로그인 정보/);
  await assert.rejects(box.enqueue('usage', { ...usage('r5'), trace: `t=${TOKEN}` }), /키나 로그인 정보/);
  // a word that only looks a bit like a key is fine (a desk-lamp in a prompt)
  assert.equal(O.baeOutboxPayloadProblem({ prompt: 'a desk-lamp-with-long-shade-0123456789 on a table', tokens: { input_tokens: 1 } }), null);
  await box.enqueue('usage', usage('r6'), 'r6');
  const text = allText(dir);
  assert.ok(text.includes('r6'));
  for (const secret of [FAKE_KEY, TOKEN, 'p_session_token', 'Bearer']) assert.ok(!text.includes(secret), `${secret} reached the file`);
  await box.stop();
});

test('a send that never answers counts as a failure after the time limit and stays in the line', async () => {
  const dir = freshDir();
  const { box } = rig(dir, { usage: () => new Promise(() => undefined) }, { sendTimeoutMs: 100 });
  const t0 = Date.now();
  assert.equal((await box.enqueue('usage', usage('req_8'), 'req_8')).status, 'queued');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(box.pending()[0].lastError, '보내기가 너무 오래 걸려요.');
  await box.stop();
});

test('when several lines fail in a row (no connection), the round stops and waits; "online" sends at once', async () => {
  const dir = freshDir(); let calls = 0; let fail = true;
  const { box, timers } = rig(dir, { usage: async () => { calls++; if (fail) throw new Error('offline'); } });
  await box.stop(); // 바로 보내기 없이 줄만 쌓기 위해 멈춘 채로 넣는다
  for (let i = 0; i < 6; i++) await box.enqueue('usage', usage('q' + i), 'q' + i);
  assert.equal(calls, 0, 'stopped: nothing is sent');
  await box.start();
  assert.equal(calls, 3, 'three failures in a row end the round');
  assert.ok(timers.at(-1)!.ms >= 5_000, 'and the next round waits');
  fail = false; await box.flush({ all: true });
  assert.equal(calls, 3 + 6); assert.deepEqual(box.pending(), []);
  await box.stop();
});
