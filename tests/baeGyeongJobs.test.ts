import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';

// BAE경 메인 작업 흐름 (electron/bae/baeJobs.ts) 을 127.0.0.1 의 가짜 OpenAI 로: 주문서 → 장부 줄, 그림 → 중간 그림 → 원본 →
// 장부 줄 → 기록 줄('그리는 중' → '완성'), 실패 · 그만두기 · 503 에도 멈추지 않고 기록이 남는다. 진짜 키 · 진짜 OpenAI 없음.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const ORDER = { summary_ko: '거실 그림', notes_ko: [], style_picks: ['L1'], style_reason_ko: '거실이라', prompt: 'Aspect ratio 16:9. A small living room. [STYLE]' };
const sse = (o: Record<string, unknown>) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;

function server(mode: { image?: 'ok' | '503' | 'stall' }) {
  const calls: string[] = []; const bodies: string[] = [];
  const srv = http.createServer((req, res) => {
    const parts: Buffer[] = []; req.on('data', (d) => parts.push(d));
    req.on('end', async () => {
      bodies.push(Buffer.concat(parts).toString('latin1'));
      const auth = String(req.headers.authorization || ''); calls.push(req.url + (auth === `Bearer ${FAKE_KEY}` ? ' key-ok' : ' key-bad'));
      if (req.url?.endsWith('/responses')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(ORDER) }] }], usage: { input_tokens: 9000, output_tokens: 800 } }));
        return;
      }
      if (mode.image === '503') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'overloaded (fake)' } })); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (mode.image === 'stall') { res.write(sse({ type: 'image_edit.partial_image', partial_image_index: 0, b64_json: PNG_1x1 })); return; }   // 그 뒤로 조용
      res.write(sse({ type: 'image_edit.partial_image', partial_image_index: 0, b64_json: PNG_1x1 }));
      res.write(sse({ type: 'image_edit.partial_image', partial_image_index: 1, b64_json: PNG_1x1 }));
      res.end(sse({ type: 'image_edit.completed', b64_json: PNG_1x1, usage: { input_tokens: 1600, output_tokens: 1631, input_tokens_details: { text_tokens: 300, image_tokens: 1300 } } }));
    });
  });
  return new Promise<{ base: string; calls: string[]; bodies: string[]; close: () => void }>((resolve) => srv.listen(0, '127.0.0.1', () => {
    const port = (srv.address() as { port: number }).port;
    resolve({ base: `http://127.0.0.1:${port}/v1`, calls, bodies, close: () => { srv.closeAllConnections?.(); srv.close(); } });
  }));
}

async function harness(apiBase: string, idle?: number, finishWaitMs?: number) {
  const { createBaeJobs } = await load('electron/bae/baeJobs.ts');
  const { effectiveBaeSettings } = await load('electron/bae/baeSettingsCache.ts');
  const { createBaeLocalStore } = await load('electron/bae/localStore.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bae-jobs-'));
  const local = createBaeLocalStore({ root });
  const queued: Array<{ kind: string; payload: any; opt: any }> = []; const progress: any[] = [];
  const s = { ...effectiveBaeSettings([]), apiBase };
  const jobs = createBaeJobs({
    settings: { get: async () => s, forget() {} }, keyFor: async () => FAKE_KEY, local,
    outbox: { enqueue: async (kind: string, payload: unknown, opt: unknown) => { queued.push({ kind, payload, opt }); return { id: 'x', status: 'queued' }; } },
    progress: (p: unknown) => progress.push(p), imagePrefs: { get: () => ({ imageField: 'image[]', stream: true }), set() {} },
    publicUrl: (p: string) => `https://storage.example/${p}`, appVersion: 'test', origin: 'PC',
    ...(idle ? { fetch: undefined } : {}),
    ...(finishWaitMs ? { finishWaitMs } : {}),
  });
  return { jobs, local, queued, progress, root };
}
const origin = { userId: 'u1', epoch: 1 };
const JOB = '0b9d4f6a-1111-4c2d-8e3f-123456789abc';
const materials = { ratio: '16:9', tier: 'm', tilt: 0, time: 'day', place: 'interior', persp: 'auto', guide: { type: 'auto', placed: false, hy: 0.5, v1: 0.5, v2: 1.6, v3: -0.9, depth: 0.16, cx: 0.42, ct: 0.14, cb: 0.86 }, request: '작은 거실' };
const inputs = { rough: { kind: 'rough', small: JPG, annotated: null, notesText: '', hasColor: false, tilt: 0, noteCount: 0, key: 'k1', painted: false }, refs: [], base: { small: JPG }, refIds: [], place: null };
const library = [{ id: 'L1', name: '학교 앞 횡단보도', place: 'exterior', tod: 'day' }];
const orderCall = (jobId = JOB) => ({ jobId, kind: 'new', materials, inputs, styleMode: 'auto', manualIds: [], manualPicks: [], library, libThumbs: { L1: JPG }, revise: null, prevOrder: null, prevPrompt: '', carry: [], carryExtra: [] });
const drawCall = (promptText: string, jobId = JOB) => ({ jobId, kind: 'new', parentJobId: null, promptText, ratio: '16:9', tier: 'm', tilt: 0, images: [Buffer.from(PNG_1x1, 'base64')],
  previews: { rough: JPG, roughNotes: null, refs: [] }, summary: { request: '작은 거실' }, pd: { summaryKo: '거실 그림' }, orderCostUsd: 0.026, name: null, createdAt: new Date().toISOString() });

test('order then draw: the ledger gets a line per call, the record goes drawing → done, the original stays on this PC', async () => {
  const srv = await server({ image: 'ok' }); const h = await harness(srv.base);
  try {
    const o = await h.jobs.order(origin, orderCall());
    assert.equal(o.ok, true, o.message);
    assert.match(o.promptText, /Aspect ratio 16:9/);
    const d = await h.jobs.draw(origin, drawCall(o.promptText));
    assert.equal(d.ok, true, d.message);
    assert.equal(d.w, 1); assert.equal(d.h, 1);
    assert.deepEqual(srv.calls, ['/v1/responses key-ok', '/v1/images/edits key-ok']);
    const usage = h.queued.filter((q) => q.kind === 'usage').map((q) => q.payload);
    assert.deepEqual(usage.map((u) => [u.kind, u.model]), [['order', 'gpt-6.1-sol'], ['image', 'gpt-image-2.5-sunburst']], 'model names come from the settings');
    assert.ok(Math.abs(usage[0].usd - 0.026) < 1e-9 && usage[1].usd > 0);
    for (const u of usage) assert.equal(h.queued.find((q) => q.payload === u)!.opt.id, u.requestId, 'one ticket per call (resend-safe)');
    const writes = h.queued.filter((q) => q.kind === 'job').map((q) => q.payload);
    assert.deepEqual(writes.map((w) => w.status), ['drawing', 'done']);
    assert.equal(writes[1].images.thumb, `https://storage.example/bae/${JOB}/result_320.jpg`);
    assert.ok(h.queued.some((q) => q.kind === 'preview' && q.payload.name === 'result_1600.jpg'));
    assert.equal(h.progress.filter((p) => p.partial).length, 2, 'two partial pictures reach the screen');
    assert.ok(await h.local.readJobFile(JOB, 'result.png'), 'the original is kept on this PC');
    const text = JSON.stringify(h.queued);
    assert.ok(!text.includes('0123456789abcdef'), 'no key in anything queued');
  } finally { srv.close(); }
});

/** multipart 몸에서 글 칸 하나의 값 */
const formValue = (body: string, name: string) => { const m = new RegExp(`name="${name}"\r\n\r\n([^\r]*)\r\n`).exec(body); return m ? m[1] : null; };

test('each picture can choose its quality and picture model from the HTML list; anything else falls back to the settings', async () => {
  const srv = await server({ image: 'ok' }); const h = await harness(srv.base);
  try {
    const o = await h.jobs.order(origin, orderCall());
    assert.equal(o.ok, true, o.message);
    const d1 = await h.jobs.draw(origin, { ...drawCall(o.promptText), quality: 'max', imageModel: 'gpt-image-2.5-flare' });
    assert.equal(d1.ok, true, d1.message);
    const img1 = srv.bodies[srv.bodies.length - 1];
    assert.equal(formValue(img1, 'quality'), 'max');
    assert.equal(formValue(img1, 'model'), 'gpt-image-2.5-flare');
    assert.equal(d1.model, 'gpt-image-2.5-flare');
    const done1 = h.queued.filter((q) => q.kind === 'job' && q.payload.status === 'done').at(-1)!.payload;
    assert.equal(done1.result.quality, 'max', 'the record says which quality was used');
    const JOB2 = '0b9d4f6a-2222-4c2d-8e3f-123456789abc';
    const o2 = await h.jobs.order(origin, orderCall(JOB2));
    const d2 = await h.jobs.draw(origin, { ...drawCall(o2.promptText, JOB2), quality: 'ultra', imageModel: 'dall-e-9' });
    assert.equal(d2.ok, true, d2.message);
    const img2 = srv.bodies[srv.bodies.length - 1];
    assert.equal(formValue(img2, 'quality'), 'high', 'unknown quality → the settings value');
    assert.equal(formValue(img2, 'model'), 'gpt-image-2.5-sunburst', 'unknown model → the settings model');
  } finally { srv.close(); }
});

test('a 503 or a stopped stream fails cleanly with a record, and stopping works at once', async () => {
  const s503 = await server({ image: '503' }); const h = await harness(s503.base);
  try {
    const d = await h.jobs.draw(origin, drawCall('Aspect ratio 16:9. Room.'));
    assert.equal(d.ok, false); assert.equal(d.aborted, false); assert.ok(!d.message.includes('0123456789'));
    assert.deepEqual(h.queued.filter((q) => q.kind === 'job').map((q) => q.payload.status), ['drawing', 'failed']);
  } finally { s503.close(); }
  const stall = await server({ image: 'stall' }); const h2 = await harness(stall.base);
  try {
    const J2 = '0b9d4f6a-2222-4c2d-8e3f-123456789abc';
    const p = h2.jobs.draw(origin, drawCall('Aspect ratio 16:9. Room.', J2));
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(h2.jobs.active('u1').map((a: any) => a.jobId), [J2]);
    assert.equal(h2.jobs.abort(J2, 'someone-else'), false, 'only the maker can stop it');
    const t0 = Date.now(); assert.equal(h2.jobs.abort(J2, 'u1'), true);
    const d = await p;
    assert.ok(Date.now() - t0 < 2000, 'stopping does not wait for the stream');
    assert.equal(d.ok, false); assert.equal(d.aborted, true); assert.match(d.message, /그만뒀어요/);
    assert.deepEqual(h2.queued.filter((q) => q.kind === 'job').map((q) => q.payload.status), ['drawing', 'stopped']);
    assert.equal(h2.jobs.active('u1').length, 0);
  } finally { stall.close(); }
});

test('a job already running refuses a second start; bad job ids are refused', async () => {
  const h = await harness('http://127.0.0.1:9/v1');
  const r = await h.jobs.order(origin, orderCall('not-a-uuid'));
  assert.equal(r.ok, false); assert.match(r.message, /작업 번호/);
});

test('the draft on this PC belongs to the account that saved it', async () => {
  const { registerBaeJobsIpc } = await load('electron/bae/baeJobsIpc.ts');
  const { createBaeLocalStore } = await load('electron/bae/localStore.ts');
  const local = createBaeLocalStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'bae-draft-')) });
  const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
  let who = { userId: 'u1', epoch: 3 };
  registerBaeJobsIpc({ ipc: { handle: (c: string, h: any) => handlers.set(c, h) }, getSessionOriginOrThrow: () => who, canUse: async () => true,
    jobs: {} as never, local, flushOutbox() {}, saveAs: async () => null });
  assert.deepEqual([...handlers.keys()].sort(), ['bae:abort', 'bae:active', 'bae:draft-clear', 'bae:draft-load', 'bae:draft-save', 'bae:draw', 'bae:draw-finish', 'bae:job-patch', 'bae:local-file', 'bae:online', 'bae:order',
    'bae:result-set', 'bae:save-as', 'bae:tool-job'].sort());
  await handlers.get('bae:draft-save')!(null, { data: { request: '작은 거실' }, images: { 'board_paint.png': new Uint8Array([1, 2, 3]) } }, 3);
  const mine = await handlers.get('bae:draft-load')!(null, 3);
  assert.deepEqual(mine.data, { request: '작은 거실' }); assert.deepEqual([...mine.images['board_paint.png']], [1, 2, 3]);
  who = { userId: 'u2', epoch: 4 };
  assert.equal(await handlers.get('bae:draft-load')!(null, 4), null, "another account does not get my draft");
  await assert.rejects(handlers.get('bae:draft-load')!(null, 3), /세션이 바뀌었어요/);
});

// ── 3단계: 그린 뒤 화면이 마무리 (기울기 · 색 맞춤), 결과 판 바꾸기, 도구 작업 ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** w×h 한 색 PNG (진짜 PNG: 메인은 IHDR 의 크기를 읽는다). */
function pngOf(w: number, h: number, rgb: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const GPT_BYTES = new Uint8Array(Buffer.from(PNG_1x1, 'base64'));
const same = (a: Uint8Array | null, b: Uint8Array) => !!a && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const previewsOf = (h: { queued: Array<{ kind: string; payload: any }> }) => h.queued.filter((q) => q.kind === 'preview').map((q) => `${q.payload.name}<${q.payload.file}`);
const writesOf = (h: { queued: Array<{ kind: string; payload: any }> }) => h.queued.filter((q) => q.kind === 'job').map((q) => q.payload);

test('with tilt or base colors the draw waits for the screen: gpt.png only, then draw-finish ends it with the finished picture', async () => {
  const srv = await server({ image: 'ok' }); const h = await harness(srv.base);
  try {
    const call = { ...drawCall('Aspect ratio 16:9. Room.'), finish: true, previews: { rough: JPG, roughNotes: null, refs: [], bases: [JPG, JPG], sheet: null },
      summary: { request: '거실', base: { mode: 'base', n: 2, painted: false, notes: ['소파 쪽', 'TV 쪽'], parts: 0 }, lockOn: true } };
    const d = await h.jobs.draw(origin, call);
    assert.equal(d.ok, true, d.message); assert.equal(d.finish, true, 'the screen must finish it');
    assert.ok(same(d.png, GPT_BYTES), 'the GPT picture comes back as it was');
    assert.deepEqual(writesOf(h).map((w) => w.status), ['drawing'], 'not done yet');
    assert.equal(previewsOf(h).length, 0, 'no previews before the picture is final');
    assert.ok(same(await h.local.readJobFile(JOB, 'gpt.png'), GPT_BYTES));
    assert.equal(await h.local.readJobFile(JOB, 'result.png'), null);
    assert.deepEqual(h.jobs.pendingFinish('u1'), [JOB]);
    // 다른 계정 · 엉터리 그림은 받지 않는다
    assert.equal((await h.jobs.drawFinish({ userId: 'u2', epoch: 1 }, { jobId: JOB, png: GPT_BYTES, alt: null, moved: 0, tilt: 0, note: '' })).ok, false);
    assert.equal((await h.jobs.drawFinish(origin, { jobId: JOB, png: new Uint8Array([1, 2, 3]), alt: null, moved: 0, tilt: 0, note: '' })).ok, false);
    const locked = pngOf(4, 3, [200, 180, 150]);
    const f = await h.jobs.drawFinish(origin, { jobId: JOB, png: locked, alt: null, moved: 3, tilt: 0, note: '' });
    assert.equal(f.ok, true, f.message); assert.equal(f.w, 4); assert.equal(f.h, 3);
    assert.deepEqual(writesOf(h).map((w) => w.status), ['drawing', 'done']);
    const done = writesOf(h)[1];
    assert.deepEqual(done.result.finish, { tilt: 0, lock: { moved: 3, on: true }, noise: null });
    assert.equal(done.result.w, 4);
    assert.equal(done.images.gpt, `https://storage.example/bae/${JOB}/gpt_1600.jpg`, 'the GPT original preview, because the result differs');
    assert.deepEqual(done.images.bases, [`https://storage.example/bae/${JOB}/base_1.jpg`, `https://storage.example/bae/${JOB}/base_2.jpg`]);
    assert.deepEqual(done.summary.base.notes, ['소파 쪽', 'TV 쪽']);
    assert.deepEqual(previewsOf(h), ['result_1600.jpg<final.png', 'result_320.jpg<final.png', 'gpt_1600.jpg<gpt.png', 'rough.jpg<rough.jpg', 'base_1.jpg<base_1.jpg', 'base_2.jpg<base_2.jpg']);
    assert.ok(same(await h.local.readJobFile(JOB, 'result.png'), locked));
    assert.ok(same(await h.local.readJobFile(JOB, 'final.png'), locked));
    assert.ok(same(await h.local.readJobFile(JOB, 'alt.png'), GPT_BYTES), 'with no tilt the picture before the color lock is the GPT one');
    assert.deepEqual(h.jobs.pendingFinish('u1'), []);
    assert.equal((await h.jobs.drawFinish(origin, { jobId: JOB, png: locked, alt: null, moved: 0, tilt: 0, note: '' })).ok, false, 'only once');
  } finally { srv.close(); }
});

test('if the screen cannot finish, the job still ends with the GPT picture and the note (sent, or after the wait)', async () => {
  const srv = await server({ image: 'ok' });
  try {
    // 화면이 엔진을 못 돌려 GPT 그림 그대로 보낸다
    const h = await harness(srv.base);
    const d = await h.jobs.draw(origin, { ...drawCall('Aspect ratio 16:9. Room.'), finish: true });
    assert.equal(d.finish, true);
    const note = '그린 뒤 마무리를 하지 못해서 GPT가 그린 그대로 뒀어요. (엔진이 멈췄어요)';
    const f = await h.jobs.drawFinish(origin, { jobId: JOB, png: d.png, alt: null, moved: 0, tilt: 5, note });
    assert.equal(f.ok, true, f.message);
    const done = writesOf(h).at(-1);
    assert.equal(done.status, 'done'); assert.equal(done.result.finish.note, note); assert.equal(done.result.finish.lock, null);
    assert.equal(done.images.gpt, undefined, 'no GPT preview when nothing changed');
    assert.deepEqual(previewsOf(h).slice(0, 2), ['result_1600.jpg<gpt.png', 'result_320.jpg<gpt.png']);
    assert.equal(await h.local.readJobFile(JOB, 'final.png'), null);
    // 화면이 아예 보내지 않으면 (창을 닫음 · 앱이 멈춤) 기다린 뒤 메인이 끝낸다
    const J2 = '0b9d4f6a-3333-4c2d-8e3f-123456789abc';
    const h2 = await harness(srv.base, undefined, 60);
    const d2 = await h2.jobs.draw(origin, { ...drawCall('Aspect ratio 16:9. Room.', J2), finish: true });
    assert.equal(d2.finish, true);
    await new Promise((r) => setTimeout(r, 250));
    const w2 = writesOf(h2);
    assert.deepEqual(w2.map((w) => w.status), ['drawing', 'done']);
    assert.match(w2[1].result.finish.note, /마무리를 하지 못해서/);
    assert.ok(same(await h2.local.readJobFile(J2, 'result.png'), GPT_BYTES));
    assert.equal((await h2.jobs.drawFinish(origin, { jobId: J2, png: GPT_BYTES, alt: null, moved: 0, tilt: 0, note: '' })).ok, false, 'too late: already ended');
  } finally { srv.close(); }
});

test('draw-finish over the channel: the answer is dropped when the login session changed, and the job ends later anyway', async () => {
  const srv = await server({ image: 'ok' }); const h = await harness(srv.base, undefined, 80);
  const { registerBaeJobsIpc } = await load('electron/bae/baeJobsIpc.ts');
  const handlers = new Map<string, (...a: unknown[]) => Promise<any>>();
  let who = { userId: 'u1', epoch: 5 }; let switchOnCheck = false;
  registerBaeJobsIpc({ ipc: { handle: (c: string, fn: any) => handlers.set(c, fn) }, getSessionOriginOrThrow: () => who,
    canUse: async () => { if (switchOnCheck) who = { userId: 'u2', epoch: 6 }; return true; }, jobs: h.jobs, local: h.local, flushOutbox() {}, saveAs: async () => null });
  try {
    const d = await handlers.get('bae:draw')!(null, { ...drawCall('Aspect ratio 16:9. Room.'), finish: true }, 5);
    assert.equal(d.ok, true, d.message); assert.equal(d.finish, true);
    await assert.rejects(handlers.get('bae:draw-finish')!(null, { jobId: JOB, png: 'not bytes', alt: null, moved: 0, tilt: 0, note: '' }, 5), /올바르지 않아요/);
    switchOnCheck = true;   // 보내는 사이 다른 계정으로 바뀜
    const r = await handlers.get('bae:draw-finish')!(null, { jobId: JOB, png: pngOf(2, 2, [1, 2, 3]), alt: null, moved: 0, tilt: 0, note: '' }, 5);
    assert.equal(r.ok, false); assert.equal(r.code, 'SESSION');
    await assert.rejects(handlers.get('bae:draw-finish')!(null, { jobId: JOB, png: GPT_BYTES, alt: null, moved: 0, tilt: 0, note: '' }, 5), /세션이 바뀌었어요/, 'an old screen cannot finish');
    await new Promise((r2) => setTimeout(r2, 250));
    assert.equal(writesOf(h).filter((w) => w.status === 'done').length, 1, 'the job still ends exactly once');
  } finally { srv.close(); }
});

test('result tools: color lock on and off, denoise and back — files, previews and the record follow; missing pictures are asked for', async () => {
  const srv = await server({ image: 'ok' }); const h = await harness(srv.base);
  try {
    await h.jobs.draw(origin, { ...drawCall('Aspect ratio 16:9. Room.'), finish: true });
    const locked = pngOf(4, 3, [200, 180, 150]); const before = pngOf(4, 3, [90, 90, 90]);
    assert.equal((await h.jobs.drawFinish(origin, { jobId: JOB, png: locked, alt: before, moved: 2, tilt: 4, note: '' })).ok, true);
    assert.ok(same(await h.local.readJobFile(JOB, 'alt.png'), before), 'with tilt the picture before the lock is the turned one the screen sent');
    h.queued.length = 0;
    // 색 맞춤 끄기 → 맞추기 전 그림
    const off = await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: true, noise: false }, png: null });
    assert.equal(off.ok, true, off.message);
    assert.ok(same(await h.local.readJobFile(JOB, 'result.png'), before));
    assert.deepEqual(off.result.finish.lock, { moved: 2, on: false });
    assert.equal(off.images.result, `https://storage.example/bae/${JOB}/alt_1600.jpg`); assert.equal(off.images.thumb, `https://storage.example/bae/${JOB}/alt_320.jpg`);
    assert.deepEqual(previewsOf(h), ['alt_1600.jpg<alt.png', 'alt_320.jpg<alt.png']);
    const w = writesOf(h).at(-1);
    assert.deepEqual(Object.keys(w).sort(), ['id', 'images', 'result', 'status'], 'only the changed columns go to the server');
    assert.equal(w.result.finish.tilt, 4); assert.equal(w.result.model, 'gpt-image-2.5-sunburst', 'the rest of the result stays');
    // 노이즈 제거: 이 PC 에 없으면 MISSING, 화면이 만든 그림을 보내면 그 판으로
    const miss = await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: true, noise: true }, png: null });
    assert.equal(miss.ok, false); assert.equal(miss.code, 'MISSING');
    const clean = pngOf(4, 3, [91, 91, 91]);
    const on = await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: true, noise: true }, png: clean, sec: 3 });
    assert.equal(on.ok, true, on.message);
    assert.deepEqual(on.result.finish.noise, { on: true, sec: 3 });
    assert.ok(same(await h.local.readJobFile(JOB, 'alt_noise.png'), clean));
    assert.ok(same(await h.local.readJobFile(JOB, 'result.png'), clean));
    assert.ok(same(await h.local.readJobFile(JOB, 'alt.png'), before), 'the picture before the denoise is kept');
    // 되돌리기 · 다시 켜기 (이미 만든 판은 그대로 다시)
    assert.equal((await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: false, noise: false }, png: null })).ok, true);
    assert.ok(same(await h.local.readJobFile(JOB, 'result.png'), locked), 'back to the first finished picture');
    const again = await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: true, noise: true }, png: null });
    assert.equal(again.ok, true); assert.deepEqual(again.result.finish.noise, { on: true, sec: 3 });
    // 막는 것: 처음 그림 덮어쓰기 · 남의 그림 · 색 맞춤 안 한 작업의 alt
    assert.equal((await h.jobs.setResult('u1', { jobId: JOB, variant: { alt: false, noise: false }, png: clean })).ok, false);
    assert.equal((await h.jobs.setResult('u2', { jobId: JOB, variant: { alt: false, noise: true }, png: clean })).ok, false);
    const J2 = '0b9d4f6a-4444-4c2d-8e3f-123456789abc';
    assert.equal((await h.jobs.draw(origin, drawCall('Aspect ratio 16:9. Room.', J2))).ok, true);
    const no = await h.jobs.setResult('u1', { jobId: J2, variant: { alt: true, noise: false }, png: null });
    assert.equal(no.ok, false); assert.match(no.message, /색 맞춤/);
    // 메인이 끝낸 작업(기울기 · 기준 배경 없음)도 노이즈 제거: 처음 그림은 gpt.png
    assert.equal((await h.jobs.setResult('u1', { jobId: J2, variant: { alt: false, noise: true }, png: clean, sec: 2 })).ok, true);
    assert.equal((await h.jobs.setResult('u1', { jobId: J2, variant: { alt: false, noise: false }, png: null })).ok, true);
    assert.ok(same(await h.local.readJobFile(J2, 'result.png'), GPT_BYTES));
    assert.ok(previewsOf(h).includes('result_1600.jpg<gpt.png'));
  } finally { srv.close(); }
});

test('a denoise tool job: original and result on this PC, one done record at 0 won, and it can go back to the original', async () => {
  const h = await harness('http://127.0.0.1:9/v1');
  const J = '0b9d4f6a-5555-4c2d-8e3f-123456789abc';
  const src = pngOf(6, 4, [10, 120, 200]); const clean = pngOf(6, 4, [12, 122, 202]);
  const r = await h.jobs.toolJob('u1', { jobId: J, kind: 'denoise', parentJobId: null, createdAt: new Date().toISOString(), source: src, png: clean, sec: 2.4, label: '거실 정면.png' });
  assert.equal(r.ok, true, r.message); assert.equal(r.w, 6); assert.equal(r.h, 4);
  const w = writesOf(h);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'denoise'); assert.equal(w[0].status, 'done'); assert.equal(w[0].costUsd, 0);
  assert.deepEqual(w[0].result.finish, { tilt: 0, lock: null, noise: { on: true, sec: 2 } });
  assert.equal(w[0].images.result, `https://storage.example/bae/${J}/noise_1600.jpg`); assert.equal(w[0].images.source, `https://storage.example/bae/${J}/result_1600.jpg`);
  assert.equal(w[0].summary.source, '거실 정면.png');
  assert.deepEqual(previewsOf(h), ['noise_1600.jpg<final_noise.png', 'noise_320.jpg<final_noise.png', 'result_1600.jpg<source.png', 'result_320.jpg<source.png']);
  assert.equal(h.queued.filter((q) => q.kind === 'usage').length, 0, 'no ledger line: it cost nothing');
  assert.equal((await h.jobs.setResult('u1', { jobId: J, variant: { alt: false, noise: false }, png: null })).ok, true);
  assert.ok(same(await h.local.readJobFile(J, 'result.png'), src));
  assert.ok(same(await h.local.readJobFile(J, 'final_noise.png'), clean));
  assert.equal((await h.jobs.toolJob('u1', { jobId: J, kind: 'denoise', parentJobId: null, createdAt: new Date().toISOString(), source: src, png: clean, sec: 1, label: '' })).ok, false, 'one job id once');
  assert.equal((await h.jobs.toolJob('u1', { jobId: '0b9d4f6a-6666-4c2d-8e3f-123456789abc', kind: 'denoise', parentJobId: null, createdAt: new Date().toISOString(), source: new Uint8Array([1]), png: clean, sec: 1, label: '' })).ok, false);
});

test('a 4K tool job (stage 4): source and the enlarged picture on this PC, previews at the usual sizes, one done record at 0 won that points at its job', async () => {
  const h = await harness('http://127.0.0.1:9/v1');
  const J = '0b9d4f6a-7777-4c2d-8e3f-123456789abc'; const PARENT = '0b9d4f6a-1111-4c2d-8e3f-123456789abc';
  const src = pngOf(16, 9, [40, 90, 160]); const big = pngOf(30, 17, [41, 91, 161]);
  const call = { jobId: J, kind: 'upscale', parentJobId: PARENT, createdAt: new Date().toISOString(), source: src, png: big, sec: 12.34, label: '주차장 낮.png',
    upscale: { mode: 'A', ep: 'dml', fellBack: false } };
  const r = await h.jobs.toolJob('u1', call);
  assert.equal(r.ok, true, r.message); assert.equal(r.w, 30); assert.equal(r.h, 17);
  assert.ok(same(await h.local.readJobFile(J, 'source.png'), src), 'the picture before 4K stays on this PC');
  assert.ok(same(await h.local.readJobFile(J, 'final.png'), big), 'the 4K picture is a version file (never rewritten)');
  assert.ok(same(await h.local.readJobFile(J, 'result.png'), big), 'and the visible picture (PNG 저장 saves this)');
  assert.deepEqual(previewsOf(h), ['result_1600.jpg<final.png', 'result_320.jpg<final.png'], 'only the usual 1600 and 320 previews go to the server');
  const w = writesOf(h); assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'upscale'); assert.equal(w[0].status, 'done'); assert.equal(w[0].costUsd, 0); assert.equal(w[0].parentJobId, PARENT);
  assert.deepEqual(w[0].summary, { source: '주차장 낮.png' });
  assert.deepEqual(w[0].result, { w: 30, h: 17, sec: 12, model: 'Real-ESRGAN animevideov3',
    finish: { tilt: 0, lock: null, noise: null, upscale: { mode: 'A', ep: 'dml', fellBack: false, from: [16, 9] } } });
  assert.equal(w[0].images.result, `https://storage.example/bae/${J}/result_1600.jpg`); assert.equal(w[0].images.thumb, `https://storage.example/bae/${J}/result_320.jpg`);
  assert.equal(h.queued.filter((q) => q.kind === 'usage').length, 0, 'no ledger line: it cost nothing');
  // 키운 그림의 노이즈 제거는 키운 그림(final.png)에서 — 키우기 전 그림(source.png)으로 돌아가지 않는다
  const clean = pngOf(30, 17, [42, 92, 162]);
  assert.equal((await h.jobs.setResult('u1', { jobId: J, variant: { alt: false, noise: true }, png: clean, sec: 3 })).ok, true);
  assert.equal((await h.jobs.setResult('u1', { jobId: J, variant: { alt: false, noise: false }, png: null })).ok, true);
  assert.ok(same(await h.local.readJobFile(J, 'result.png'), big), 'back to the 4K picture, not the small source');
  // B · 미리보기를 키운 것: 계산한 곳과 안내가 기록에 남는다
  const J2 = '0b9d4f6a-8888-4c2d-8e3f-123456789abc';
  const r2 = await h.jobs.toolJob('u1', { ...call, jobId: J2, parentJobId: null, upscale: { mode: 'B', ep: 'wasm', fellBack: true }, fromPreview: true });
  assert.equal(r2.ok, true, r2.message);
  const w2 = writesOf(h).at(-1);
  assert.equal(w2.result.model, 'waifu2x swin_unet art'); assert.deepEqual(w2.result.finish.upscale, { mode: 'B', ep: 'wasm', fellBack: true, from: [16, 9] });
  assert.match(w2.result.finish.note, /미리보기 그림\(1600px\)을 키웠어요/);
  // 막는 것: 같은 번호 두 번 · 모르는 방식 · 작아진 그림 · 8K 넘는 그림 · PNG 가 아닌 것
  assert.equal((await h.jobs.toolJob('u1', call)).ok, false, 'one job id once');
  const J3 = '0b9d4f6a-9999-4c2d-8e3f-123456789abc';
  assert.match((await h.jobs.toolJob('u1', { ...call, jobId: J3, upscale: { mode: 'C', ep: 'dml', fellBack: false } })).message, /방식/);
  assert.match((await h.jobs.toolJob('u1', { ...call, jobId: J3, upscale: { mode: 'A', ep: 'cuda', fellBack: false } })).message, /방식/);
  assert.match((await h.jobs.toolJob('u1', { ...call, jobId: J3, png: pngOf(8, 4, [1, 2, 3]) })).message, /크기/);
  const huge = pngOf(1, 1, [1, 2, 3]); new DataView(huge.buffer, huge.byteOffset).setUint32(16, 8000); new DataView(huge.buffer, huge.byteOffset).setUint32(20, 4500);  // 머리만 8000×4500
  assert.match((await h.jobs.toolJob('u1', { ...call, jobId: J3, png: huge })).message, /크기/);
  assert.equal((await h.jobs.toolJob('u1', { ...call, jobId: J3, upscale: undefined })).ok, false, 'a 4K job says how it was made');
  assert.equal(await h.local.readJobMeta(J3), null, 'nothing was kept for the refused ones');
});

test('preview names: every result version and place material has its own fixed name under the job', async () => {
  const { BAE_PREVIEW_NAMES, baePreviewPath, baeVariantFile, baeVariantPreviews, baeJobVariant, baeJobHasLock } = await load('src/shared/bae/jobs.ts');
  for (const n of ['alt_1600.jpg', 'alt_320.jpg', 'noise_1600.jpg', 'noise_320.jpg', 'altnoise_1600.jpg', 'altnoise_320.jpg', 'base_1.jpg', 'base_2.jpg', 'base_3.jpg', 'sheet.jpg', 'gpt_1600.jpg'])
    assert.equal(baePreviewPath(JOB, n), `bae/${JOB}/${n}`);
  assert.throws(() => baePreviewPath(JOB, 'base_4.jpg'));
  assert.equal(new Set(BAE_PREVIEW_NAMES).size, BAE_PREVIEW_NAMES.length);
  assert.deepEqual([[false, false], [true, false], [false, true], [true, true]].map(([alt, noise]) => [baeVariantFile({ alt, noise }), baeVariantPreviews({ alt, noise }).big]),
    [[null, 'result_1600.jpg'], ['alt.png', 'alt_1600.jpg'], ['final_noise.png', 'noise_1600.jpg'], ['alt_noise.png', 'altnoise_1600.jpg']]);
  assert.deepEqual(baeJobVariant({ result: { finish: { lock: { moved: 2, on: false }, noise: { on: true } } } }), { alt: true, noise: true });
  assert.deepEqual(baeJobVariant({ result: {} }), { alt: false, noise: false });
  assert.equal(baeJobHasLock({ result: { finish: { lock: { moved: 0, on: true } } } }), false);
  const { BAE_JOB_FILE_NAMES } = await load('electron/bae/localStore.ts');
  for (const f of ['final.png', 'alt.png', 'final_noise.png', 'alt_noise.png', 'source.png', 'base_3.jpg', 'sheet.jpg']) assert.ok(BAE_JOB_FILE_NAMES.includes(f), f);
});
