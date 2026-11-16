import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { SONAMU_INV, SCENE_W, SCENE_H, sonamuScene, fakeSam, nodeCodec, encodePng, rgbToRgba } from './baeGyeongLayersFixtures.ts';

// BAE경 5단계 '레이어로 나누기' (계획 14d 3-2 · 14b 11-3 5단계). 진짜 키 · 진짜 OpenAI 없음 (127.0.0.1 의 가짜, 0원).
//  1) 메인이 보내는 레이어 GPT 요청이 HTML v0.4.4 엔진(browserGpt)의 요청과 글자까지 같다 (캡처: tests/fixtures/bae/layers/html_requests.json)
//  2) GPT 답 저장 · 장부 · 기록 줄 · PSD 저장
//  3) HTML 계획 창 시험 25가지 (test_v044_layers.py L0~L7 + '오류 없음')를 엔진 한 판(session) + 계획 규칙(planModel) + 메인(baeLayers)으로.
//     SAM 은 가짜 (상자 가운데 색과 같은 픽셀) — 진짜 SAM · 일꾼 · 창은 Electron 시험(C:\BAE_stage0\layers_port\harness)에서.
const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
/** 엔진 · 계획 규칙 · 그리기 · 가짜 SAM 의 BM 이 같은 모듈이어야 한다 (엔진 templates.js 가 instanceof BM 을 본다). */
async function loadRenderer() {
  const contents = [
    "export * from './src/features/bae-gyeong/layers/session.ts';",
    "export * as BM from './src/features/bae-gyeong/layers/engine/bm.js';",
    "export * as PM from './src/features/bae-gyeong/layers/planModel.ts';",
    "export * as D from './src/features/bae-gyeong/layers/draw.ts';",
  ].join('\n');
  const r = await build({ stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'layers-entry.ts' }, bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';
const OWNER = 'user-layers-a';
const ORIGIN = { userId: OWNER, epoch: 1 };
const HTML = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/bae/layers/html_requests.json'), 'utf8'));

function parseMultipart(raw: Buffer, ctype: string) {
  const bnd = '--' + /boundary=(.+)$/.exec(ctype)![1]; const s = raw.toString('latin1'); const parts = s.split(bnd).slice(1, -1); const out: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    const i = p.indexOf('\r\n\r\n'); const head = p.slice(2, i); const body = Buffer.from(p.slice(i + 4, p.length - 2), 'latin1');
    const name = /name="([^"]*)"/.exec(head)![1]; const fn = /filename="([^"]*)"/.exec(head); const ty = /Content-Type: ([^\r\n]+)/i.exec(head);
    out.push(fn ? { name, filename: fn[1], type: ty ? ty[1] : null, sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length } : { name, value: body.toString('utf8') });
  }
  return out;
}

/** 가짜 OpenAI: PD 는 schema 이름으로 (물건 목록 · 앞뒤 · 네모 안 물건), 그림은 빈 방 PNG. 받은 요청을 적는다. */
function fakeOpenAI(o: { plate: Uint8Array; inv?: unknown; pdUsage?: Record<string, unknown>; imageUsage?: Record<string, unknown> }) {
  const calls: Array<[string, string]> = []; const raw: Array<{ kind: string; body?: string; fields?: Array<Record<string, unknown>>; auth: string }> = [];
  const srv = http.createServer((req, res) => {
    const parts: Buffer[] = []; req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts); const auth = String(req.headers.authorization || '');
      if (req.url?.endsWith('/responses')) {
        const txt = body.toString('utf8'); raw.push({ kind: 'pd', body: txt, auth });
        const name = (JSON.parse(txt).text?.format?.name) as string; calls.push(['pd', name]);
        const out = name === 'inventory' ? (o.inv ?? SONAMU_INV) : name === 'depth' ? { pairs: [] } : { name: '추가 물건', group: '추가', en: 'the small added prop on the wall', see_through: false };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(out) }] }], usage: o.pdUsage ?? { input_tokens: 3000, output_tokens: 800 } }));
        return;
      }
      const fields = parseMultipart(body, String(req.headers['content-type'])); raw.push({ kind: 'edit', fields, auth });
      const prompt = String((fields.find((f) => f.name === 'prompt') || {}).value || ''); const mask = fields.some((f) => f.name === 'mask');
      calls.push(['img', /remove these objects completely/.test(prompt) ? (mask ? 'plate_add' : 'plate') : 'edit']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: Buffer.from(o.plate).toString('base64') }], usage: o.imageUsage ?? { input_tokens: 2000, output_tokens: 6000, input_tokens_details: { text_tokens: 500, image_tokens: 1500 } } }));
    });
  });
  return new Promise<{ base: string; calls: typeof calls; raw: typeof raw; close: () => void }>((resolve) => srv.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`, calls, raw, close: () => { srv.closeAllConnections?.(); srv.close(); } });
  }));
}

async function mainLayers(apiBase: string) {
  const { createBaeLayers } = await load('electron/bae/baeLayers.ts');
  const { effectiveBaeSettings } = await load('electron/bae/baeSettingsCache.ts');
  const { createBaeLocalStore } = await load('electron/bae/localStore.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bae-layers-'));
  const local = createBaeLocalStore({ root });
  const queued: Array<{ kind: string; payload: any; opt: any }> = []; const shown: string[] = [];
  let prefs: { imageField: 'image[]' | 'image'; stream: boolean } = { imageField: 'image[]', stream: true };
  const make = () => createBaeLayers({
    settings: { get: async () => ({ ...effectiveBaeSettings([]), apiBase }) }, keyFor: async () => FAKE_KEY, local,
    outbox: { enqueue: async (kind: string, payload: unknown, opt: unknown) => { queued.push({ kind, payload, opt }); return { id: 'x', status: 'queued' }; } },
    imagePrefs: { get: () => prefs, set: (p: typeof prefs) => { prefs = p; } },
    publicUrl: (p: string) => `https://storage.example/${p}`, showItemInFolder: (p: string) => { shown.push(p); }, appVersion: 'test', origin: 'PC',
  });
  const layers = make();
  /** 앱을 다시 켠 것처럼: 같은 이 PC 보관함, 기억은 비어 있음 */
  const restarted = () => make();
  return { layers, local, root, queued, shown, restarted };
}
const newId = () => crypto.randomUUID();
const isoNow = () => new Date().toISOString();
const SRC_1x1 = Buffer.from(HTML.png, 'base64');

test('요청: 메인이 보내는 레이어 PD · 그림 요청이 HTML v0.4.4 엔진(browserGpt)과 글자 · 칸 · 바이트까지 같고, 비용 셈도 같다', async () => {
  // 캡처 서버와 같은 사용량으로 답한다 (capture_html_requests.mjs)
  const srv = await fakeOpenAI({ plate: new Uint8Array(SRC_1x1), pdUsage: { input_tokens: 3000, output_tokens: 400 }, imageUsage: { input_tokens: 1600, output_tokens: 1500, input_tokens_details: { text_tokens: 300, image_tokens: 1300 } } });
  try {
    const { layers } = await mainLayers(srv.base);
    const jobId = newId();
    assert.equal((await layers.begin(OWNER, { jobId, createdAt: isoNow(), parentJobId: null, label: 'x.png', source: new Uint8Array(SRC_1x1), w: 2, h: 2 })).ok, true);
    for (const c of HTML.out) {
      srv.raw.length = 0;
      if (c.kind === 'pd') {
        const r = await layers.pd(ORIGIN, { jobId, name: c.args.name, prompt: c.args.prompt, images: c.args.images, schema: c.args.schema });
        assert.equal(r.ok, true, c.label);
        assert.equal(srv.raw[0].body, c.sent.body, `${c.label}: PD 요청 몸이 HTML 과 같다 (키 순서 · 글자까지)`);
        assert.equal(srv.raw[0].auth, `Bearer ${FAKE_KEY}`);
        assert.ok(Math.abs((r as { usd: number }).usd - c.usd) < 1e-12, `${c.label}: 비용 셈이 같다`);
      } else {
        const r = await layers.edit(ORIGIN, { jobId, prompt: c.args.prompt, image: new Uint8Array(Buffer.from(HTML.png, 'base64')), mask: c.args.mask ? new Uint8Array(Buffer.from(HTML.mask, 'base64')) : null, size: c.args.size });
        assert.equal(r.ok, true, c.label);
        assert.deepEqual(srv.raw[0].fields, c.sent.fields, `${c.label}: 그림 요청 칸이 HTML 과 같다 (순서 · 이름 · 파일 이름 · 종류 · 바이트)`);
        assert.ok(Math.abs((r as { usd: number }).usd - c.usd) < 1e-12, `${c.label}: 비용 셈이 같다`);
      }
    }
  } finally { srv.close(); }
});

test('요청 확인: 엔진이 보내지 않는 모양은 메인이 거절한다 (돈이 나가기 전에)', async () => {
  const srv = await fakeOpenAI({ plate: new Uint8Array(SRC_1x1) });
  try {
    const { layers } = await mainLayers(srv.base);
    const jobId = newId();
    await layers.begin(OWNER, { jobId, createdAt: isoNow(), parentJobId: null, label: 'x', source: new Uint8Array(SRC_1x1), w: 2, h: 2 });
    const bad = [
      await layers.pd(ORIGIN, { jobId, name: 'order' as never, prompt: 'x', images: [], schema: { type: 'object' } }),
      await layers.pd(ORIGIN, { jobId, name: 'inventory', prompt: 'x', images: [{ label: 'A', url: 'https://example.com/a.png' }], schema: { type: 'object' } }),
      await layers.pd(ORIGIN, { jobId, name: 'inventory', prompt: 'x', images: [], schema: 'nope' }),
      await layers.edit(ORIGIN, { jobId, prompt: 'x', image: new Uint8Array([1, 2, 3]), mask: null, size: '1024x576' }),
      await layers.edit(ORIGIN, { jobId, prompt: 'x', image: new Uint8Array(SRC_1x1), mask: null, size: '4096x4096' }),
      await layers.pd({ userId: 'someone-else', epoch: 1 }, { jobId, name: 'inventory', prompt: 'x', images: [], schema: { type: 'object' } }),
    ];
    for (const r of bad) assert.equal(r.ok, false);
    assert.equal(srv.calls.length, 0, 'OpenAI 에는 아무것도 가지 않았다');
  } finally { srv.close(); }
});

test('저장: GPT 답 · 계획은 그림 해시마다 이 PC 에 (사람마다 따로), 지우기는 파일을 지우지 않고 새 판으로', async () => {
  const { layers, local } = await mainLayers('http://127.0.0.1:9/v1');
  const pic = 'a'.repeat(64), png = new Uint8Array(SRC_1x1);
  assert.equal(await layers.storeGet(OWNER, pic, 'p4.inventory'), null);
  await layers.storeSet(OWNER, pic, 'p4.inventory', { objects: [{ name: '소파' }] });
  await layers.storeSet(OWNER, pic, 'p4.plate', png);
  await layers.storeSet(OWNER, pic, 'p4.edit:abc12', png);
  await layers.storeSet(OWNER, pic, 'p4.plan', { v: 1, objects: {} });
  assert.deepEqual(await layers.storeGet(OWNER, pic, 'p4.inventory'), { objects: [{ name: '소파' }] });
  assert.deepEqual(Buffer.from(await layers.storeGet(OWNER, pic, 'p4.plate') as Uint8Array), Buffer.from(png));
  assert.equal(await layers.storeGet('someone-else', pic, 'p4.inventory'), null, '다른 사람은 내 답을 쓰지 않는다');
  await assert.rejects(layers.storeSet(OWNER, pic, '../../evil', { a: 1 }), /저장 이름/);
  await assert.rejects(layers.storeSet(OWNER, '../x', 'p4.plan', {}), /그림 해시/);
  await assert.rejects(layers.storeSet(OWNER, pic, 'p4.plate', { not: 'png' }), /그림/);
  const dirs = fs.readdirSync(path.join(local.cacheDir, 'layers')); assert.equal(dirs.length, 1); assert.match(dirs[0], /^[0-9a-f]{40}$/, '폴더 이름에는 해시만');
  await layers.storeForget(OWNER, pic);
  assert.equal(await layers.storeGet(OWNER, pic, 'p4.inventory'), null, '지운 뒤에는 처음부터');
  assert.ok(fs.existsSync(path.join(local.cacheDir, 'layers', dirs[0], 'g1', 'inventory.json')), '앞 판 파일은 그대로 (지우지 않음)');
});

test('장부 · 기록: 돈이 처음 나갈 때 기록 줄(그리는 중), 다 나누면 PSD 를 이 PC 에 · 완성 줄, 실패는 늘 · 닫음은 돈이 나간 것만', async () => {
  const scene = sonamuScene(); const plate = encodePng(rgbToRgba(scene.plate, SCENE_W * SCENE_H), SCENE_W, SCENE_H);
  const srv = await fakeOpenAI({ plate });
  try {
    const { layers, queued, shown, restarted } = await mainLayers(srv.base);
    const free = newId();
    await layers.begin(OWNER, { jobId: free, createdAt: isoNow(), parentJobId: null, label: '무료.png', source: new Uint8Array(SRC_1x1), w: 2, h: 2 });
    assert.equal(await layers.end(OWNER, free, 'closed', ''), true);
    assert.equal(queued.filter((q) => q.kind === 'job').length, 0, '돈이 나가지 않고 닫으면 기록 줄이 없다');
    const jobId = newId();
    await layers.begin(OWNER, { jobId, createdAt: isoNow(), parentJobId: null, label: '거실 정면.png', source: new Uint8Array(SRC_1x1), w: 2, h: 2 });
    const r = await layers.pd(ORIGIN, { jobId, name: 'inventory', prompt: 'p', images: [], schema: { type: 'object', properties: {} } });
    assert.equal(r.ok, true);
    const usage = queued.filter((q) => q.kind === 'usage'); assert.equal(usage.length, 1);
    assert.equal(usage[0].payload.kind, 'layers'); assert.equal(usage[0].payload.jobId, jobId); assert.ok(usage[0].payload.usd > 0);
    const rows = queued.filter((q) => q.kind === 'job'); assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.kind, 'layers'); assert.equal(rows[0].payload.status, 'drawing'); assert.deepEqual(rows[0].payload.summary, { source: '거실 정면.png', size: [2, 2] });
    assert.ok(queued.some((q) => q.kind === 'preview' && q.payload.name === 'result_1600.jpg' && q.payload.file === 'source.png'));
    const psd = new Uint8Array(64); psd.set([0x38, 0x42, 0x50, 0x53]);
    const d = await layers.done(OWNER, { jobId, psd, summary: { W: 2, H: 2, layers: 5, shadows: 3, bins: { OL: 1, ML: 4, UL: 0 }, left: 1, merged: 0, stackDiff: 1.2, sec: 3, again: false, props: 4 } });
    assert.equal(d.ok, true);
    assert.ok(fs.existsSync((d as { psdPath: string }).psdPath) && (d as { psdPath: string }).psdPath.endsWith('layers.psd'));
    const doneRow = queued.filter((q) => q.kind === 'job').at(-1)!.payload;
    assert.equal(doneRow.status, 'done'); assert.equal(doneRow.result.layers.count, 5); assert.equal(doneRow.result.layers.file, 'layers.psd'); assert.ok(doneRow.costUsd > 0);
    assert.equal(await layers.showPsd(OWNER, jobId), true); assert.equal(shown.length, 1);
    assert.equal(await layers.showPsd('someone-else', jobId), false, '남의 작업 폴더는 열지 않는다');
    const after = restarted();
    assert.equal(await after.showPsd(OWNER, jobId), true, '앱을 다시 켠 뒤에도 이 PC 작업 폴더의 PSD 를 연다');
    assert.ok(shown.at(-1)!.endsWith('layers.psd')); assert.equal(shown.length, 2);
    assert.equal(await after.showPsd(OWNER, newId()), false, 'PSD 가 없는 작업(다른 PC 기록)은 false');
    const failed = newId();
    await layers.begin(OWNER, { jobId: failed, createdAt: isoNow(), parentJobId: null, label: 'f.png', source: new Uint8Array(SRC_1x1), w: 2, h: 2 });
    await layers.end(OWNER, failed, 'failed', 'OpenAI에 연결하지 못했어요. sk-test-local-only-0123456789abcdef');
    const fr = queued.filter((q) => q.kind === 'job').at(-1)!.payload;
    assert.equal(fr.status, 'failed'); assert.doesNotMatch(JSON.stringify(fr), /sk-test-local-only-0123/, '키 모양은 가린다');
    assert.doesNotMatch(JSON.stringify(queued), new RegExp(FAKE_KEY), '줄 어디에도 키가 없다');
  } finally { srv.close(); }
});

test('HTML 계획 창 시험 25가지 (test_v044_layers.py L0~L7, 소나무 거실, 저장된 PD 답 · 빈 방, 가짜 SAM)', async (t) => {
  const R = await loadRenderer(); const { PM, D } = R;
  const scene = sonamuScene(); const N = SCENE_W * SCENE_H;
  const origPng = encodePng(rgbToRgba(scene.orig, N), SCENE_W, SCENE_H); const platePng = encodePng(rgbToRgba(scene.plate, N), SCENE_W, SCENE_H);
  const srv = await fakeOpenAI({ plate: platePng });
  const { readPsd } = require('ag-psd') as { readPsd(b: Buffer, o: Record<string, unknown>): any };
  const tree = (bytes: Uint8Array) => readPsd(Buffer.from(bytes), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const names = (kids: any[]) => kids.map((k) => k.name);
  const errors: string[] = []; const logs: string[] = [];
  const count = (k: string, n: string) => srv.calls.filter((c) => c[0] === k && c[1] === n).length;
  try {
    const M = await mainLayers(srv.base);
    const pic = crypto.createHash('sha256').update(origPng).digest('hex');
    const jobId = newId();
    const gpt = {
      async pd(r: any) { const o = await M.layers.pd(ORIGIN, { jobId, name: r.name, prompt: r.prompt, images: r.images, schema: r.schema }); if (!o.ok) { errors.push(o.message); throw new Error(o.message); } return { json: o.json, usd: o.usd }; },
      async edit(r: any) { const o = await M.layers.edit(ORIGIN, { jobId, prompt: r.prompt, image: r.image, mask: r.mask, size: r.size }); if (!o.ok) { errors.push(o.message); throw new Error(o.message); } return { png: o.png, usd: o.usd }; },
    };
    const storeFor = (p: string) => ({ get: (k: string) => M.layers.storeGet(OWNER, p, k), set: async (k: string, v: unknown) => { await M.layers.storeSet(OWNER, p, k, v); } });
    const steps: Array<[string, string]> = [];
    const newSession = () => R.createLayersSession({ gpt, storeFor, sam: fakeSam(R.BM.fromCrop), codec: nodeCodec, thumbs: null, log: (x: string) => logs.push(x), onStep: (id: string, st: string) => steps.push([id, st]) });
    let S = newSession();
    const save = async (plan: any) => { await M.layers.storeSet(OWNER, pic, 'p4.plan', PM.planToSaved(plan)); };
    const image = { w: SCENE_W, h: SCENE_H, rgb: scene.orig };

    // ---- L0: 나눌 그림 ----
    const b = await M.layers.begin(OWNER, { jobId, createdAt: isoNow(), parentJobId: null, label: '소나무 거실.png', source: origPng, w: SCENE_W, h: SCENE_H });
    await t.test('L0: 나눌 그림이 이 PC 작업 폴더에 들어가고 (원본 그대로), 아직 기록 줄은 없다', async () => {
      assert.equal(b.ok, true);
      const dir = await M.local.jobDir(jobId); assert.ok(dir && fs.readFileSync(path.join(dir, 'source.png')).equals(Buffer.from(origPng)));
      assert.equal(M.queued.filter((q) => q.kind === 'job').length, 0);
    });

    // ---- L1: 계획 열기 ----
    const p1 = (await S.plan({ image, pic, notes: '' })).proposal;
    let plan = PM.planFromProposal(p1).plan; let view = PM.viewOf(plan, p1);
    const ids = Object.fromEntries(p1.objs.map((o: any) => [o.name, o.id]));
    await t.test('L1: 열면 바로 물건 찾기가 세 단계로 (엔진 준비 · PD 물건 찾기 · 이 PC 윤곽)', () => {
      assert.deepEqual(PM.LAYERS_FIND_STEPS.map((x: string[]) => x[0]), ['engine', 'inventory', 'outlines']);
      for (const id of ['inventory', 'outlines']) assert.ok(steps.some((s) => s[0] === id && s[1] === 'ok'), id);
    });
    await t.test('L1: 물건 4개, 원경 0, 윤곽 준비됨', () => { assert.equal(p1.objs.length, 4); assert.equal(p1.far.length, 0); assert.ok(p1.objs.every((o: any) => o.cands.length === 4 && o.cands[3])); });
    await t.test("L1: PD 의 OL 제안 그대로 (화분 OL, 나머지 ML 셋)", () => {
      assert.deepEqual(view.rows.filter((r: any) => r.bin === 'OL').map((r: any) => r.name), ['왼쪽 흰색 화분']);
      assert.equal(view.rows.filter((r: any) => r.bin === 'ML').length, 3);
    });
    await t.test("L1: PSD 미리보기에 OL(화분, 'PD 제안 OL')이 ML(+ '배경 (빈 방)')보다 위", () => {
      const rows = PM.treeRows(view, plan, p1, null, null); const text = JSON.stringify(rows);
      assert.ok(text.includes('PD 제안 OL') && rows.some((r: any) => r.kind === 'plate'));
      const ol = rows.findIndex((r: any) => r.kind === 'bin' && r.bin === 'OL'), ml = rows.findIndex((r: any) => r.kind === 'bin' && r.bin === 'ML');
      assert.ok(ol >= 0 && ol < ml);
    });
    await t.test('L1: 그림 위에 윤곽이 그려진다 (물건마다 지금 고른 후보의 마스크)', () => {
      const px = PM.allIds(plan, p1).map((id: string) => D.unpackMask(PM.candsOf(plan, p1, id)[PM.pickOf(plan, id)])).reduce((n: number, m: any) => n + (m ? m.area : 0), 0);
      assert.ok(px > 5000, String(px));
    });
    await t.test("L1: 안내에 빈 배경 비용 ('빈 배경 약 80원')", () => {
      assert.match(PM.estimate({ plan, p: p1, plated: p1.plated, summary: null, splitPlan: null }).text, /빈 배경 약 80원/);
    });

    // ---- L2: 고치기 ----
    const maskOf = (id: string) => D.unpackMask(PM.candsOf(plan, p1, id)[PM.pickOf(plan, id)]);
    const centerOf = (id: string) => { const m = maskOf(id)!; let sx = 0, sy = 0, n = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { sx += x; sy += y; n++; } return [m.x0 + sx / n, m.y0 + sy / n]; };
    const sofa = ids['적갈색 소파'], ac = ids['오른쪽 스탠드 에어컨'], frame = ids['호랑이 그림 액자'], plant = ids['왼쪽 흰색 화분'];
    const [cx, cy] = centerOf(sofa); const hit = D.hitTest(cx, cy, PM.allIds(plan, p1), maskOf);
    await t.test('L2: 그림에서 소파를 누르면 소파가 골라진다 (이름 칸에 적갈색 소파)', () => {
      assert.equal(hit, sofa); assert.equal(PM.editorState(view, plan, p1, hit).name, '적갈색 소파');
    });
    plan = PM.setName(plan, view, sofa, '소파'); view = PM.viewOf(plan, p1);
    plan = PM.setBin(plan, view, sofa, 'OL'); view = PM.viewOf(plan, p1);
    plan = PM.toggleShadow(plan, view, sofa); view = PM.viewOf(plan, p1);
    await t.test('L2: 이름 소파 · OL 로 · 그림자 따로 끔', () => {
      assert.ok(view.rows.some((r: any) => r.bin === 'OL' && r.name === '소파' && r.shadow === false));
      assert.equal(plan.objects[sofa].bin, 'OL'); assert.equal(plan.objects[sofa].shadow, false);
    });
    plan = PM.toggleKeep(plan, ac); view = PM.viewOf(plan, p1); await save(plan);
    await t.test('L2: 에어컨은 나누지 않음 (빈 배경에 그대로)', () => {
      assert.deepEqual(view.skipped, [ac]);
      assert.ok(PM.treeRows(view, plan, p1, null, null).some((r: any) => r.kind === 'plate' && r.note.includes('나누지 않은 물건 1개는 그대로')));
    });

    // ---- L3: 나누기 ----
    const s3 = await S.split({ plan: PM.planForEngine(plan) });
    const d3 = await M.layers.done(OWNER, { jobId, psd: s3.psd, summary: { W: s3.summary.W, H: s3.summary.H, layers: s3.summary.layers, shadows: s3.summary.shadows, bins: s3.summary.bins, left: s3.summary.left, merged: s3.summary.merged, stackDiff: s3.summary.stack.mean_diff, sec: s3.summary.sec, again: s3.summary.again, props: s3.summary.props } });
    let splitPlan = structuredClone(plan); let summary = s3.summary;
    const T3 = tree(fs.readFileSync((d3 as any).psdPath)); const top = T3.children;
    const OL = top.find((k: any) => k.name === 'OL'), ML = top.find((k: any) => k.name === 'ML');
    await t.test('L3: PSD 에 ML · OL 폴더 (보라 · 주황), UL 은 없음', () => {
      assert.deepEqual(names(top), ['ML', 'OL']); assert.equal(OL.layerColor, 'orange'); assert.equal(ML.layerColor, 'violet');
    });
    await t.test('L3: OL = 화분과 그 바로 아래 곱하기 그림자, 이름 바꾼 소파 (그림자는 소파 안에)', () => {
      const n = names(OL.children);
      assert.ok(n.includes('소파') && n.includes('왼쪽 흰색 화분') && !n.includes('소파 그림자'), n.join(','));
      assert.equal(n.indexOf('왼쪽 흰색 화분 그림자'), n.indexOf('왼쪽 흰색 화분') - 1, n.join(','));
      assert.equal(OL.children.find((k: any) => k.name === '왼쪽 흰색 화분 그림자').blendMode, 'multiply');
    });
    await t.test('L3: ML = 맨 아래 배경 (빈 방) + 액자, 에어컨은 레이어가 아님', () => {
      const n = names(ML.children); assert.equal(n[0], '배경 (빈 방)'); assert.ok(n.includes('호랑이 그림 액자'));
      assert.ok(!n.concat(names(OL.children)).some((x: string) => x.includes('에어컨')));
    });
    await t.test('L3: 다 켜면 원래 그림 (차이 3 미만)', () => { assert.ok(summary.stack.mean_diff < 3, String(summary.stack.mean_diff)); });
    await t.test('L3: GPT 는 물건 목록 한 번 · 빈 방 한 번, PSD 를 이 PC 에 저장', () => {
      assert.equal(count('pd', 'inventory'), 1); assert.equal(count('img', 'plate'), 1); assert.equal(d3.ok, true);
      assert.equal(M.queued.filter((q) => q.kind === 'job').at(-1)!.payload.status, 'done');
    });
    await t.test('L3: 나눈 뒤 계획 그대로면 다시 나눌 것이 없고, 목록에 실제 레이어와 그림자 줄', () => {
      assert.equal(PM.planDirty(plan, splitPlan), false);
      const rows = PM.treeRows(PM.viewOf(plan, p1, summary.order), plan, p1, null, summary);
      assert.ok(rows.some((r: any) => r.kind === 'shadow' && r.name === '왼쪽 흰색 화분 그림자' && r.done));
    });

    // ---- L4: 나눈 뒤 바꾸기 = 0원 ----
    const nBefore = srv.calls.length;
    view = PM.viewOf(plan, p1, summary.order); plan = PM.setName(plan, view, frame, '액자'); await save(plan);
    await t.test("L4: 바꾼 계획은 '다시 나누기: 0원'", () => {
      assert.equal(PM.planDirty(plan, splitPlan), true);
      assert.match(PM.estimate({ plan, p: p1, plated: true, summary, splitPlan }).text, /^다시 나누기: 0원/);
    });
    const s4 = await S.split({ plan: PM.planForEngine(plan) }); splitPlan = structuredClone(plan); summary = s4.summary;
    await t.test('L4: GPT 없이 다시 조립 (새 요청 0), 새 이름이 PSD 에', () => {
      assert.equal(srv.calls.length, nBefore); assert.equal(s4.summary.again, true);
      assert.ok(names(tree(s4.psd).children.find((k: any) => k.name === 'ML').children).includes('액자'));
    });

    // ---- L5: 네모로 물건 더하기 ----
    const box = [SCENE_W * .36, SCENE_H * .18, SCENE_W * .41, SCENE_H * .26];
    const added = await S.add({ box, name: '' }); const addId = 'a' + Date.now().toString(36);
    plan = PM.addBoxed(plan, addId, added.obj); view = PM.viewOf(plan, p1, summary.order); await save(plan);
    await t.test('L5: 네모를 그리면 PD 가 이름을 붙인 물건이 더해지고 (골라진 채, 이름 바꿀 수 있게)', () => {
      assert.equal(added.obj.name, '추가 물건'); assert.ok(addId.startsWith('a')); assert.equal(count('pd', 'describe'), 1);
      assert.equal(PM.editorState(view, plan, p1, addId).name, '추가 물건'); assert.equal(PM.editorState(view, plan, p1, addId).added, true);
    });
    await t.test('L5: 안내에 더한 물건 자리만 빈 배경 다시', () => {
      assert.match(PM.estimate({ plan, p: p1, plated: true, summary, splitPlan }).text, /추가한 물건 자리만/);
    });
    const s5 = await S.split({ plan: PM.planForEngine(plan) }); splitPlan = structuredClone(plan); summary = s5.summary;
    await t.test('L5: 그 자리만 마스크로 빈 배경 한 장 더 (빈 방은 여전히 한 번), PSD 에 새 물건', () => {
      assert.equal(count('img', 'plate_add'), 1); assert.equal(count('img', 'plate'), 1);
      assert.ok(names(tree(s5.psd).children.find((k: any) => k.name === 'ML').children).includes('추가 물건'));
    });

    // ---- L6: 계획이 남는다 ----
    await t.test('L6: 닫았다 열기 = 일꾼에 엔진 한 판이 그대로 (물건 찾기 없이, 다시 나누기는 조립만)', async () => {
      assert.equal(S.pic, pic);
      const n0 = srv.calls.length; const again = await S.split({ plan: PM.planForEngine(plan) });
      assert.equal(again.summary.again, true); assert.equal(srv.calls.length, n0);
    });
    const nInv = count('pd', 'inventory');
    S = newSession();   // 앱을 다시 켬: 새 일꾼, 저장소만 남음
    const p6 = (await S.plan({ image, pic, notes: '' })).proposal; const r6 = PM.planFromProposal(p6); const rows6 = PM.viewOf(r6.plan, p6).rows.map((r: any) => [r.bin, r.name]);
    await t.test('L6: 앱을 다시 켜도 저장한 물건 목록(PD 안 부름)과 계획이 그대로 (지난번 계획을 불러왔어요)', () => {
      assert.equal(count('pd', 'inventory'), nInv); assert.equal(r6.restored, true);
      for (const want of [['OL', '소파'], ['ML', '액자'], ['ML', '추가 물건']]) assert.ok(rows6.some((r: string[]) => r[0] === want[0] && r[1] === want[1]), JSON.stringify(rows6));
      assert.equal(p6.plated, true, '빈 방도 저장해 둔 것');
    });

    // ---- L7: 저장해 둔 단계 지우기 ----
    await M.layers.storeForget(OWNER, pic); S.drop(); S = newSession();
    const p7 = (await S.plan({ image, pic, notes: '' })).proposal; const r7 = PM.planFromProposal(p7); const rows7 = PM.viewOf(r7.plan, p7).rows.map((r: any) => [r.bin, r.name]);
    await t.test("L7: '처음부터 다시 찾기'는 물건 목록과 계획을 잊는다 (PD 다시, 처음 계획)", () => {
      assert.equal(count('pd', 'inventory'), nInv + 1); assert.equal(r7.restored, false);
      assert.ok(rows7.some((r: string[]) => r[0] === 'OL' && r[1] === '왼쪽 흰색 화분') && rows7.some((r: string[]) => r[0] === 'ML' && r[1] === '적갈색 소파'), JSON.stringify(rows7));
      assert.equal(p7.plated, false);
    });

    await t.test('오류 없음 (GPT · 저장 · 줄에 오류도 키도 없음)', () => {
      assert.deepEqual(errors, []);
      assert.doesNotMatch(JSON.stringify(M.queued), new RegExp(FAKE_KEY));
      assert.ok(!logs.some((l) => /실패|failed/i.test(l)), logs.filter((l) => /실패|failed/i.test(l)).join('\n'));
    });
    void plant;
  } finally { srv.close(); }
});

test('계획 규칙: 같은 물건 묶음(한 장 · 하나씩) · 작은 것 합치기 · 원경 · 윤곽 후보 · 저장 모양 (HTML lpEdit 손잡이)', async () => {
  const { PM } = await loadRenderer();
  const mk = (id: string, group: string, name: string, box: number[], extra: Record<string, unknown> = {}) => ({ id, group, name, box, cands: [null, null, null, { x0: box[0], y0: box[1], w: 2, h: 2, bits: new Uint8Array([15]) }], ...extra });
  const p = {
    W: 1024, H: 576, scale: 1, groups: [], background_en: '', usd: 0, costs: {}, sec: 0, ep: 'dml', saved: null, plated: false,
    objs: [
      mk('o0', '의자', '앞줄 의자 1', [0, 400, 50, 500], { layer: 'OL' }), mk('o1', '의자', '앞줄 의자 2', [60, 400, 110, 500], { layer: 'OL' }), mk('o2', '의자', '앞줄 의자 3', [120, 400, 170, 500], { layer: 'OL' }),
      mk('o3', '게시판', '뒤쪽 게시판', [300, 50, 700, 250]), mk('o4', '카드', '카드 1', [320, 60, 360, 100], { on: '뒤쪽 게시판' }), mk('o5', '카드', '카드 2', [400, 60, 440, 100], { on: '뒤쪽 게시판' }),
    ],
    far: [{ id: 'f0', name: '창밖 풍경', box: [800, 50, 1000, 300], cands: [null, null, null, { x0: 800, y0: 50, w: 2, h: 2, bits: new Uint8Array([15]) }] }],
  };
  let plan = PM.planFromProposal(p).plan; let view = PM.viewOf(plan, p);
  const bundle = view.rows.find((r: any) => r.kind === 'bundle');
  assert.equal(bundle.name, '앞줄 의자', '3개 이상은 한 장, 이름은 공통 부분'); assert.equal(bundle.members.length, 3); assert.equal(bundle.bin, 'OL');
  assert.deepEqual(view.rows.find((r: any) => r.head === 'o3').merged, ['o4', 'o5'], '작은 카드는 게시판에 합침');
  assert.deepEqual(view.farRows.map((r: any) => [r.bin, r.name]), [['UL', '창밖 풍경']]);
  assert.equal(PM.rowSub(bundle, plan, p), '같은 물건 3개 한 장');
  assert.equal(PM.rowSub(view.rows.find((r: any) => r.head === 'o3'), plan, p), 'PD가 찾음 · 작은 것 2개 합침');
  assert.deepEqual(PM.mergeRows(plan, p).map((m: any) => [m.text, m.all]), [['카드 2 → 뒤쪽 게시판', true]]);
  // 하나씩 → 폴더 (HTML lpFolderRuns)
  plan = PM.setMode(plan, view, 'o1', 'each'); view = PM.viewOf(plan, p);
  assert.equal(view.rows.filter((r: any) => r.bin === 'OL').length, 3); assert.deepEqual([...PM.folderRuns(view).values()], ['앞줄 의자', '앞줄 의자', '앞줄 의자']);
  // 한 장 묶음의 층 바꾸기는 같이, 그림자도 같이
  plan = PM.setMode(plan, view, 'o1', 'one'); view = PM.viewOf(plan, p);
  plan = PM.setBin(plan, view, 'o1', 'ML'); view = PM.viewOf(plan, p);
  assert.deepEqual(['o0', 'o1', 'o2'].map((id) => plan.objects[id].bin), ['ML', 'ML', 'ML']);
  plan = PM.toggleShadow(plan, view, 'o2'); assert.deepEqual(['o0', 'o1', 'o2'].map((id) => plan.objects[id].shadow), [false, false, false]);
  view = PM.viewOf(plan, p);
  // 합치기 풀기 · 다시 · 모두 · 목록 단추
  plan = PM.unmerge(plan, 'o4'); view = PM.viewOf(plan, p); assert.equal(PM.editorState(view, plan, p, 'o4').merge.kind, 'pd');
  plan = PM.remerge(plan, 'o4'); view = PM.viewOf(plan, p); assert.equal(PM.editorState(view, plan, p, 'o4').merge.kind, 'in');
  assert.equal(PM.editorState(view, plan, p, 'o4').nameLocked, true, '합쳐진 물건은 PSD 에 이름이 안 나와요');
  plan = PM.unmergeAll(plan, view, 'o3'); assert.deepEqual(PM.mergeRows(plan, p).map((m: any) => m.all), [false]);
  plan = PM.toggleMergeGroup(plan, 'o3'); assert.deepEqual(PM.mergeRows(plan, p).map((m: any) => m.all), [true]);
  // 원경: UL 만, 나누지 않음, 윤곽
  view = PM.viewOf(plan, p); const fe = PM.editorState(view, plan, p, 'f0');
  assert.equal(fe.bin, 'UL'); assert.equal(fe.binLocked, true); assert.equal(fe.where, 'UL / 창밖 풍경');
  plan = PM.toggleKeep(plan, 'f0'); assert.equal(PM.viewOf(plan, p).farRows.length, 0);
  // 윤곽 후보: 자동 → 후보 4 (한 장짜리) 기본, 고르면 레이어가 기대는 것이 바뀐다
  const k0 = PM.layersBuildKey(plan); plan = PM.setPick(plan, 'o3', 0); assert.notEqual(PM.layersBuildKey(plan), k0); plan = PM.setPick(plan, 'o3', 'auto'); assert.equal(PM.layersBuildKey(plan), k0);
  // 더한 네모: 저장할 때 윤곽 비트는 글자로, 읽으면 그대로 · 엔진에는 빼고
  plan = PM.addBoxed(plan, 'a1', { name: '시계', group: '시계', en: 'the clock', see_through: false, box: [10.4, 20.6, 50, 60], cands: [{ x0: 10, y0: 20, w: 3, h: 3, bits: new Uint8Array([255, 1]) }] });
  assert.deepEqual(plan.added[0].box, [10, 21, 50, 60]);
  const saved = JSON.parse(JSON.stringify(PM.planToSaved(plan))); const back = PM.planFromSaved(saved);
  assert.deepEqual(Array.from(back.added[0].cands[0].bits), [255, 1]); assert.equal(PM.planSig(back), PM.planSig(plan));
  assert.equal(PM.planForEngine(plan).added[0].cands, undefined);
  plan = PM.removeBoxed(plan, 'a1'); assert.equal(plan.added.length, 0); assert.equal(plan.objects.a1, undefined);
  assert.equal(PM.boxOfDrag({ x0: 10, y0: 10, x1: 15, y1: 40 }), null, '8 픽셀보다 작은 네모는 버린다');
  assert.deepEqual(PM.boxOfDrag({ x0: 40, y0: 50, x1: 10, y1: 10 }), [10, 10, 40, 50]);
  // 저장해 둔 계획 + 새 물건 = 새 물건은 처음 값 (HTML lpPlanned)
  const sv = PM.planToSaved(PM.planFromProposal(p).plan); delete sv.objects.o5;
  const re = PM.planFromProposal({ ...p, saved: sv }); assert.equal(re.restored, true); assert.ok(re.plan.objects.o5);
});
