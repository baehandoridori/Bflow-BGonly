import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { build } from 'esbuild';

// BAE경 '다른 각도로' 요청이 HTML v0.4.11 과 글자까지 같은지 (7단계 끝 기준: 버튼 7개 · 손으로 · 투시만 · 가까이 · 밑면 · 같은 공간 2장 · PD메모).
// 견본 tests/fixtures/bae/angle/cases.json 은 앱과 같은 엔진(Electron 33)의 화면 밖 창에서 받았다 (C:\BAE_stage0\angle_port\harness\capture_angle.mjs):
//   html = HTML 페이지를 127.0.0.1 가짜 OpenAI 로 돌려 받은 PD메모 요청 · 그림 요청 · 결과 기록,
//   ts   = 같은 장면을 Bflow 판 창 움직임(angle/controller.ts prepare)으로 만든 '메인에게 보내는 것' (그림은 sha256).
// 여기서는 그 ts 를 진짜 메인 코드(electron/bae/baeAngle.ts)에 가짜 fetch 로 넣어, 메인이 내보내는 요청이 html 의 요청과 같은지 본다.
const FIX = 'tests/fixtures/bae/angle';
const data = JSON.parse(fs.readFileSync(`${FIX}/cases.json`, 'utf8')) as { pdAnswer: { obj: { notes_en: string; notes_ko: string }; usage: Record<string, unknown> }; cases: Record<string, any> };
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': './src' }, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const main = await load('electron/bae/baeAngleIpc.ts');
const order = await load('src/shared/bae/angle/order.ts');
const calls = await load('src/shared/bae/angle/calls.ts');

/** 가짜 그림: PNG 머리 + sha 바이트 (메인은 PNG 머리만 본다). 보낸 바이트로 어느 그림인지 되찾는다. */
const fakePng = (sha: string) => new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('IHDR'), Buffer.from(sha, 'hex')]));
const shaOfFake = (b: Uint8Array) => Buffer.from(b).subarray(12).toString('hex');
const fakeJpegUrl = (sha: string) => 'data:image/jpeg;base64,' + Buffer.from(sha, 'hex').toString('base64');
const imgToken = (s: string) => (s.startsWith('img:') ? s.slice(4) : s);
/**
 * 그림 i 가 HTML 과 같은가: 바이트가 같거나, 크롬 캔버스의 '부드럽게 줄이기'가 가끔 내는 1단계 차이 (같은 HTML 도 실행마다 몇 픽셀 다를 때가 있다:
 * 견본 memo 의 원래 그림 1536 폭 줄임에서 10픽셀이 1단계) 안. 밑그림(그림 1)은 늘 바이트까지 같아야 한다.
 */
function sameImage(cs: any, i: number): boolean {
  const r = cs.render.images[i]; if (!r) return false;
  if (r.same) return true;
  return i > 0 && r.max <= 1 && r.diffPx / (r.w * r.h) < 1e-4 && r.greyIoU === 1;
}
/** ts 의 그림 sha → html 의 그림 sha (같다고 본 그림끼리). */
function htmlShaOf(cs: any): Map<string, string> {
  const files = cs.html.image[0].fields.filter((f: any) => f.filename); const m = new Map<string, string>();
  cs.ts.call.images.forEach((s: string, i: number) => { if (files[i] && sameImage(cs, i)) m.set(imgToken(s), files[i].sha256); });
  return m;
}
/** ts 견본의 call 을 메인에 넣을 모양으로 (그림 → 가짜 PNG, 데이터 주소 → 가짜 JPEG). */
function liveCall(c: any) {
  return { ...c, images: c.images.map((s: string) => fakePng(imgToken(s))),
    memo: c.memo ? { ...c.memo, clean: fakeJpegUrl(imgToken(c.memo.clean)), noted: fakeJpegUrl(imgToken(c.memo.noted)) } : null,
    previews: { rough: fakeJpegUrl(imgToken(c.previews.rough)), roughNotes: c.previews.roughNotes ? fakeJpegUrl(imgToken(c.previews.roughNotes)) : null, refs: c.previews.refs.map((s: string) => fakeJpegUrl(imgToken(s))) } };
}
const RESULT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAB4yR/0AAAAJklEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAPBgVkQAAZ6tnWwAAAAASUVORK5CYII=', 'base64');
/** 가짜 OpenAI (메인이 부르는 fetch). /responses = PD메모, /images/edits = 그림 (스트림: 중간 그림 2장 + 완성). */
function fakeFetch(pd: 'ok' | 'fail' | undefined) {
  const seen: { pd: unknown[]; image: Array<Array<{ name: string; value?: string; file?: { sha: string; filename: string; type: string } }>> } = { pd: [], image: [] };
  const fetchFn = async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/responses')) {
      const body = JSON.parse(String(init.body)); seen.pd.push(body);
      if (pd !== 'ok') return new Response(JSON.stringify({ error: { message: 'no answer queued' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data.pdAnswer.obj) }] }], usage: data.pdAnswer.usage }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const fd = init.body as FormData; const fields: Array<{ name: string; value?: string; file?: { sha: string; filename: string; type: string } }> = [];
    for (const [name, v] of fd.entries()) {
      if (typeof v === 'string') fields.push({ name, value: v });
      else fields.push({ name, file: { sha: shaOfFake(new Uint8Array(await (v as File).arrayBuffer())), filename: (v as File).name, type: (v as File).type } });
    }
    seen.image.push(fields);
    const b64 = RESULT_PNG.toString('base64'), usage = { input_tokens: 2400, output_tokens: 6200, input_tokens_details: { text_tokens: 700, image_tokens: 1700 } };
    const ev = (o: Record<string, unknown>) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
    const sse = ev({ type: 'image_edit.partial_image', b64_json: b64, partial_image_index: 0 }) + ev({ type: 'image_edit.partial_image', b64_json: b64, partial_image_index: 1 }) + ev({ type: 'image_edit.completed', b64_json: b64, usage });
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { seen, fetchFn };
}
const SETTINGS = {
  manualText: '', fixedText: '', guidanceText: '', versions: { manual: null, fixed: null, guidance: null }, revisions: {},
  models: { pdModel: 'gpt-6.1-sol', imageModel: 'gpt-image-2.5-sunburst', imageQuality: 'high', imageLabel: '' },
  prices: { pd: { 'gpt-6.1-sol': [2, 10] }, image: { text: 5, image: 8, out: 30 }, krwPerUsd: 1400 }, apiBase: 'http://127.0.0.1:9/v1', calib: 0, times: { user: [] }, libraryOff: [],
};
function rig(pd: 'ok' | 'fail' | undefined, fetchOverride?: (u: string, init: RequestInit) => Promise<Response>) {
  const f = fakeFetch(pd); const queued: Array<{ kind: string; payload: any }> = []; const files = new Map<string, Uint8Array>(); const progress: unknown[] = []; let meta: any = null;
  const handlers = new Map<string, (...a: any[]) => Promise<unknown>>();
  const angle = main.registerBaeAngleIpc({
    ipc: { handle: (ch: string, fn: (...a: any[]) => Promise<unknown>) => handlers.set(ch, fn) },
    getSessionOriginOrThrow: () => ({ userId: 'u1', epoch: 7 }), canUse: async () => true,
    settings: { get: async () => SETTINGS, forget() {} }, keyFor: async () => 'sk-test-local-only',
    local: { saveJobFile: async (_id: string, _c: string, name: string, b: Uint8Array) => { files.set(name, b); }, writeJobMeta: async (_id: string, _c: string, m: unknown) => { meta = m; } },
    outbox: { enqueue: async (kind: string, payload: unknown) => { queued.push({ kind, payload }); } },
    progress: (p: unknown) => progress.push(p), imagePrefs: { get: () => ({ imageField: 'image[]', stream: true }), set() {} },
    publicUrl: (p: string) => 'https://example.invalid/' + p, appVersion: '1.151.0-test', origin: 'TEST-PC', now: () => Date.UTC(2026, 10, 16), fetch: fetchOverride ?? f.fetchFn,
  });
  return { angle, handlers, f, queued, files, progress, get meta() { return meta; } };
}
const tokenUrls = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === 'string' && x.startsWith('data:image/jpeg;base64,') ? 'img:' + Buffer.from(x.slice(23), 'base64').toString('hex') : x));

test('견본: 14장면 모두 HTML 과 Bflow 판이 같은 장면에서 받았다 (Electron 33)', () => {
  assert.deepEqual(Object.keys(data.cases), ['btn_left45', 'btn_left20', 'btn_orig', 'btn_right20', 'btn_right45', 'btn_high', 'btn_low', 'hand', 'vp', 'tight', 'under', 'same2', 'memo', 'memo_raw']);
});
for (const [id, cs] of Object.entries(data.cases)) {
  test(`${id}: 창의 안내 줄 · 금액 줄이 HTML 과 같다`, () => {
    assert.equal(cs.ts.info, cs.html.info); assert.equal(cs.ts.est, cs.html.est); assert.equal(cs.ts.infoAfter, cs.html.infoAfter);
    assert.deepEqual(cs.ts.cam, cs.html.cam); assert.deepEqual(cs.ts.unseen, cs.html.unseen);
  });
  if (cs.setup.refuse) {
    test(`${id}: 원래 자리 카메라는 둘 다 그리지 않는다 (요청 없음)`, () => {
      assert.equal(cs.ts.call, null); assert.equal(cs.html.image.length, 0); assert.equal(cs.html.pd.length, 0); assert.equal(cs.html.rec, null);
      assert.equal(cs.ts.infoAfter, '카메라가 원래 자리예요. 도면에서 빨간 B를 옮기거나 위 버튼을 골라 주세요.');
    });
    continue;
  }
  test(`${id}: 보낼 그림 · 기록 · 이름이 HTML 과 같다`, () => {
    const call = cs.ts.call, files = cs.html.image[0].fields.filter((f: any) => f.filename);
    assert.equal(call.images.length, files.length);
    call.images.forEach((s: string, i: number) => assert.ok(sameImage(cs, i), `그림 ${i + 1}(밑그림 · 원래 그림 · 같은 공간 그림)이 HTML 과 같아야 해요`));
    assert.equal(cs.render.images[0].same, true, '밑그림은 바이트까지 같아야 해요');
    assert.deepEqual(call.images.map((s: string) => htmlShaOf(cs).get(imgToken(s))), files.map((f: any) => f.sha256));
    assert.deepEqual(call.size, cs.html.image[0].fields.find((f: any) => f.name === 'size').value.split('x').map(Number));
    const { memo: _m, ...htmlRec } = cs.html.rec.angle; const { memo: _t, ...tsRec } = call.record;
    assert.deepEqual(tsRec, htmlRec, '결과 기록 rec.angle');
    assert.equal(call.fileName, cs.html.rec.name); assert.equal(call.line, cs.html.rec.summary); assert.equal(call.label, cs.html.rec.angle.label);
    assert.deepEqual(call.previews, { rough: cs.html.rec.inputs.rough, roughNotes: cs.html.rec.inputs.roughNotes, refs: cs.html.rec.inputs.refs });
    if (call.memo) assert.equal(call.memo.summary, cs.html.rec.inputs.notes);
    assert.equal(calls.baeAngleCallProblem(liveCall(call)), null);
  });
  test(`${id}: 메인이 보내는 요청이 HTML 과 글자까지 같다`, async () => {
    const R = rig(cs.setup.pd);
    const out = await R.handlers.get('bae:angle-draw')!(null, liveCall(cs.ts.call), 7) as any;
    assert.equal(out.ok, true, out.message);
    // PD메모 요청 (/responses 몸, 그림은 sha)
    assert.equal(R.f.seen.pd.length, cs.html.pd.length);
    R.f.seen.pd.forEach((b, i) => assert.equal(JSON.stringify(tokenUrls(b)), JSON.stringify(cs.html.pd[i].body)));
    // 그림 요청 (/images/edits 필드: 이름 · 순서 · 값 · 파일 이름 · 형식 · 그림)
    assert.equal(R.f.seen.image.length, 1);
    const want = cs.html.image[0].fields.map((f: any) => (f.filename ? { name: f.name, file: { sha: f.sha256, filename: f.filename, type: f.type } } : { name: f.name, value: f.value }));
    const map = htmlShaOf(cs);
    assert.deepEqual(R.f.seen.image[0].map((f) => (f.file ? { ...f, file: { ...f.file, sha: map.get(f.file.sha) ?? 'ts:' + f.file.sha } } : f)), want);
    assert.equal(out.prompt, cs.html.rec.prompt);
    // 메모 기록 (PD 문장 · 한국어 · 그대로 넣었는지 · 비용)
    const hm = cs.html.rec.angle.memo;
    if (hm) assert.deepEqual({ ...out.memo, err: out.memo.err ? 'err' : '' , cost: out.memo.cost == null ? null : +out.memo.cost.toFixed(12) }, { ...hm, err: hm.err ? 'err' : '', cost: hm.cost == null ? null : +hm.cost.toFixed(12) });
    else assert.equal(out.memo, null);
    if (hm && hm.raw) assert.equal(out.memo.err, hm.err);
    // 작업 기록 · 장부 · 이 PC 원본
    const jobs = R.queued.filter((q) => q.kind === 'job').map((q) => q.payload);
    assert.deepEqual(jobs.map((j) => j.status), ['drawing', 'done']);
    assert.equal(jobs[0].kind, 'angle'); assert.equal(jobs[1].pd.prompt, cs.html.rec.prompt); assert.deepEqual(jobs[1].pd.notesKo, cs.html.rec.pdNotes);
    assert.deepEqual(jobs[1].summary.angle.label, cs.html.rec.angle.label); assert.equal(jobs[1].summary.place, cs.html.rec.place);
    const usage = R.queued.filter((q) => q.kind === 'usage').map((q) => q.payload);
    assert.deepEqual(usage.map((u) => u.kind), (cs.setup.pd === 'ok' ? ['note'] : []).concat(['angle']));
    const imgUsd = (700 * 5 + 1700 * 8 + 6200 * 30) / 1e6, memoUsd = cs.setup.pd === 'ok' ? (2611 * 2 + 214 * 10) / 1e6 : 0;
    assert.ok(Math.abs(usage[usage.length - 1].usd - imgUsd) < 1e-12);
    assert.ok(Math.abs(out.costUsd - (imgUsd + memoUsd)) < 1e-12);
    if (cs.html.rec.total != null) assert.ok(Math.abs(out.costUsd - cs.html.rec.total) < 1e-12, '합계가 HTML 금액 계산과 같아야 해요');
    for (let i = 1; i <= cs.ts.call.images.length; i++) assert.ok(R.files.has(`input_${i}.png`));
    assert.ok(R.files.has('gpt.png') && R.files.has('result.png') && R.files.has('rough.jpg'));
    assert.equal(R.meta.kind, 'angle'); assert.equal(R.meta.requestPrompt, cs.html.rec.prompt);
  });
}

test('주문서 글: 메인이 쓰는 anglePromptText 가 견본의 카메라 문장 · 켬/끔으로 HTML 주문서와 같다', () => {
  for (const cs of Object.values(data.cases)) {
    if (!cs.ts.call) continue; const o = cs.ts.call.order;
    const memo = cs.setup.pd === 'ok' ? { pd: data.pdAnswer.obj.notes_en } : cs.ts.call.memo ? { raw: cs.ts.call.memo.raw } : null;
    assert.equal(order.anglePromptText(o.kind, o.sentence, { n: o.n, notes: o.notes, memo, crop: o.crop, under: o.under }), cs.html.rec.prompt, cs.setup.id);
  }
});
test('장면마다 끝 기준의 경우가 들어 있다 (밑면 · 가까이 · 같은 공간 2장 · 붓 · 메모 · 투시 · 실외)', () => {
  const c = data.cases;
  assert.equal(c.under.ts.call.order.under, true); assert.ok(c.under.html.rec.prompt.includes('undersides seen from below'));
  assert.equal(c.tight.ts.call.order.crop, true); assert.ok(c.tight.html.rec.prompt.includes('Do not zoom out'));
  assert.equal(c.same2.ts.call.order.n, 1); assert.equal(c.same2.html.image[0].fields.filter((f: any) => f.filename).length, 3); assert.ok(c.same2.html.rec.prompt.includes('images 2 and 3 are two views'));
  assert.ok(c.memo.html.rec.prompt.includes("The art director's notes for this view: " + data.pdAnswer.obj.notes_en));
  assert.ok(c.memo.html.rec.prompt.includes('Loose colored brush strokes'));
  assert.ok(c.memo_raw.html.rec.prompt.includes('(never write these words in the picture): "여기 창문 이어서" at (x 62%, y 22%)'));
  assert.equal(c.vp.ts.call.record.preset, 'vp'); assert.ok(c.vp.html.rec.prompt.includes('Only the perspective changes'));
  assert.equal(c.btn_right45.ts.call.order.kind, 'exterior'); assert.ok(c.btn_right45.html.rec.prompt.includes('(the same buildings, ground, plants and objects'));
  for (const k of ['btn_left45', 'btn_left20', 'btn_right20', 'btn_right45', 'btn_high', 'btn_low']) assert.equal(c[k].ts.call.record.preset, k.slice(4));
  assert.equal(c.hand.ts.call.record.preset, null);
});
test('메인: 다른 세션 · 권한 없음 · 잘못된 재료는 거절하고 그만두기는 작업마다', async () => {
  const R = rig('ok'); const call = liveCall(data.cases.btn_left20.ts.call);
  await assert.rejects(() => R.handlers.get('bae:angle-draw')!(null, call, 8), /로그인 세션/);
  const bad = await R.handlers.get('bae:angle-draw')!(null, { ...call, order: { ...call.order, n: 3 } }, 7) as any;
  assert.equal(bad.ok, false); assert.match(bad.message, /같은 공간 그림 수/);
  const noPng = await R.handlers.get('bae:angle-draw')!(null, { ...call, images: [new Uint8Array(30), call.images[1]] }, 7) as any;
  assert.equal(noPng.ok, false);
  assert.equal(await R.handlers.get('bae:angle-abort')!(null, call.jobId, 7), false);
  // 그만두기: 그림 요청이 걸려 있는 동안 → 작업 줄 '그만둠', '이미 보낸 요청은 비용이 들 수 있어요'
  let started = false;
  const S = rig('ok', (_u, init) => new Promise<Response>((_res, rej) => { started = true; init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); }));
  const p = S.handlers.get('bae:angle-draw')!(null, liveCall(data.cases.btn_left20.ts.call), 7) as Promise<any>;
  for (let i = 0; i < 100 && !started; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(await S.handlers.get('bae:angle-abort')!(null, data.cases.btn_left20.ts.call.jobId, 7), true);
  const res = await p; assert.equal(res.ok, false); assert.equal(res.aborted, true); assert.match(res.message, /비용이 들 수 있어요/);
  assert.equal(S.queued.filter((q) => q.kind === 'job').map((q) => q.payload.status).join(','), 'drawing,stopped');
});
test('PD메모 글 · 금액 줄 · 크기 (HTML agNotesSummary · agNotesRaw · agEst · agMemoEst · agOutSize)', () => {
  const notes = data.cases.memo.setup.notes;
  assert.equal(order.angleNotesSummary(notes), data.cases.memo.html.rec.inputs.notes);
  assert.deepEqual(order.angleNotesRaw(notes.slice(0, 2)), ['"여기 창문 이어서" at (x 62%, y 22%)', 'something pointed at from (x 70%, y 30%) to (x 88%, y 40%)']);
  assert.equal(order.angleEst(0, 1400), '약 80~100원'); assert.equal(order.angleEst(2, 1400), '약 110~140원');
  assert.equal(order.angleMemoEst([2, 10], 1400), '약 20원');
  assert.deepEqual(order.angleOutSize({ kind: 'result', w: 2048, h: 1152 }), [2048, 1152]);
  assert.deepEqual(order.angleOutSize({ kind: 'file', w: 1875, h: 1057 }, 'm'), [2048, 1152]);
  assert.deepEqual(order.angleOutSize({ kind: 'file', w: 1000, h: 333 }, 'l'), [3072, 1024]);
  assert.deepEqual(order.angleOutSize({ kind: 'file', w: 1000, h: 700 }), [1840, 1280]);
});
test('견본 그림 해시: 밑그림 · 원래 그림의 sha256 은 16진 64자 (견본이 비어 있지 않다)', () => {
  for (const cs of Object.values(data.cases)) if (cs.ts.call) for (const s of cs.ts.call.images) assert.match(imgToken(s), /^[0-9a-f]{64}$/);
  assert.ok(crypto.createHash('sha256').update('x').digest('hex').length === 64);
});
