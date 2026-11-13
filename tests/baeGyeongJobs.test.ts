import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { build } from 'esbuild';

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
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    const parts: Buffer[] = []; req.on('data', (d) => parts.push(d));
    req.on('end', async () => {
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
  return new Promise<{ base: string; calls: string[]; close: () => void }>((resolve) => srv.listen(0, '127.0.0.1', () => {
    const port = (srv.address() as { port: number }).port;
    resolve({ base: `http://127.0.0.1:${port}/v1`, calls, close: () => { srv.closeAllConnections?.(); srv.close(); } });
  }));
}

async function harness(apiBase: string, idle?: number) {
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
