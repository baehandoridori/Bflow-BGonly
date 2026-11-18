import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { build } from 'esbuild';
import { SONAMU_INV, SCENE_W, SCENE_H, sonamuScene, fakeSam, nodeCodec, encodePng, rgbToRgba } from './baeGyeongLayersFixtures.ts';
import { readFlat, hideOneCheck, type FlatLayer } from './baeGyeongLayersChecks.ts';

// BAE경 6단계 'BiRefNet 새 방식' (계획 11 10~11절 · 14 9-1 · 14b 11-3 6단계). 진짜 모델 · 진짜 OpenAI 없음.
//  1) 엔진 split.js 는 v0.4.4 그대로에 표시(// (BAE 6단계))를 붙인 한 군데만 더했다 (그 줄을 빼면 v0.4.4 와 바이트까지 같다)
//  2) birefnet.js 의 셈이 2026-11-03 시험의 마지막 판(tests/fixtures/bae/layers/poc6/poc_main6.mjs)과 같다 — 바꾼 한 가지
//     (두 SAM 윤곽이 원래 함께 가진 픽셀은 나누지 않음, 교실의 책상 다리)만 다르다
//  3) 엔진 한 판(session)에서: 모델이 없거나 · 불러오지 못하거나 · 계산이 실패하거나 · CPU 로만 돌면 SAM 만(지금 방식)과 같은 PSD 로
//     끝까지 가고 그 까닭을 쉬운 말로 적는다. 모델이 돌면 새 방식 (가짜 BiRefNet: 빈 배경 색이 아닌 픽셀)
//  4) 창 쪽 받기 상태(edgesModel) · 일꾼 부탁(edgesReady) · 메인 기록 줄
//  5) 진짜 그림 넷 (Electron 33 + DirectML 시험, C:\BAE_stage0\bir_port\harness) 의 재기 결과(tests/fixtures/bae/layers/stage6_checks.json)가
//     6단계 끝 기준을 넘는다. 그 PSD 가 이 PC 에 있으면 PSD 에서 다시 잰다.
const ROOT = path.resolve(import.meta.dirname, '..');
const POC = fs.readFileSync(path.join(ROOT, 'tests/fixtures/bae/layers/poc6/poc_main6.mjs'), 'utf8').replace(/\r\n/g, '\n');
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, external: ['electron'] });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
/** 엔진 · 새 방식 · 받기 상태가 같은 BM 모듈을 써야 한다 (한 묶음으로). */
async function loadRenderer() {
  const contents = [
    "export * from './src/features/bae-gyeong/layers/session.ts';",
    "export * as BIR from './src/features/bae-gyeong/layers/birefnet.js';",
    "export * as BM from './src/features/bae-gyeong/layers/engine/bm.js';",
    "export * as IMG from './src/features/bae-gyeong/layers/engine/img.js';",
    "export { clean } from './src/features/bae-gyeong/layers/engine/prep.js';",
    "export * as PM from './src/features/bae-gyeong/layers/planModel.ts';",
    "export * as EM from './src/features/bae-gyeong/layers/edgesModel.ts';",
    "export { createLayersClient } from './src/features/bae-gyeong/layers/layersClient.ts';",
    "export * as SH from './src/shared/bae/layers.ts';",
  ].join('\n');
  const r = await build({ stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'edges-entry.ts' }, bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const R = await loadRenderer();
const { BM, IMG, BIR, PM, EM, SH } = R;

/** poc_main6.mjs 의 셈을 글 그대로 꺼내 함수로 (Electron · onnxruntime 없이). birRun 만 넣어 준다. */
function pocFunctions(birRun: (x: Float32Array) => Promise<ArrayLike<number>>) {
  const cut = (from: string, to: string) => { const a = POC.indexOf(from), b = POC.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return POC.slice(a, b); };
  const prep = cut('function prepCrop(', 'async function run()');
  const refine = cut('  async function refineOutlines(', "  // ---- 2. BiRefNet's soft edge");
  const make = new Function('B', 'I', 'clean', 'birRun', 'birById',
    'const MEAN = [.485, .456, .406], STD = [.229, .224, .225];\n' + prep +
    "\nlet dump = null, refineMs = 0; const rgbPng = () => {}, grayPng = () => {}, path = { join: () => '' };\n" + refine +
    '\nreturn { refineOutlines, prepCrop, back, cropOf };');
  const birById = new Map();
  return { ...make(BM, IMG, R.clean, birRun, birById), birById } as {
    refineOutlines(o: unknown): Promise<{ ms: any[]; report: any[] }>; prepCrop(rgb: Uint8Array, w: number, h: number): Float32Array;
    back(o: ArrayLike<number>, w: number, h: number): Float32Array; cropOf(b: number[], W: number, H: number): number[]; birById: Map<unknown, unknown>;
  };
}
const MEAN = [.485, .456, .406], STD = [.229, .224, .225];
/** 가짜 BiRefNet: 보여 준 그림에서 빈 배경 색(들)과 tol(기본 30) 넘게 다른 픽셀 = 1 (0/1 이라 시그모이드 없이). */
function fakeBir(bg: Array<number[] | [number[], number]>) {
  const cols = bg.map((b) => (Array.isArray(b[0]) ? b : [b, 30]) as [number[], number]);
  return async (x: Float32Array) => {
    const N = 1024 * 1024; const o = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const c = [0, 1, 2].map((k) => (x[k * N + i] * STD[k] + MEAN[k]) * 255);
      o[i] = cols.every(([b, tol]) => Math.max(Math.abs(c[0] - b[0]), Math.abs(c[1] - b[1]), Math.abs(c[2] - b[2])) > tol) ? 1 : 0;
    }
    return o;
  };
}
const fullOf = (m: any, W: number, H: number) => BM.toFull(m, W, H) as Uint8Array;
const rectBM = (b: number[]) => BM.fromCrop(new Uint8Array((b[2] - b[0]) * (b[3] - b[1])).fill(1), b);
function paint(rgb: Uint8Array, W: number, b: number[], c: number[]) { for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) rgb.set(c, (y * W + x) * 3); }

/* ---------------------------------------------------------------- 1. 엔진에 끼운 한 군데 */

test('엔진: split.js 는 레이어 엔진 v0.4.4 그대로 + 표시(// (BAE 6단계))를 붙인 한 군데뿐 (그 줄을 빼면 v0.4.4 와 바이트까지 같다)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/features/bae-gyeong/layers/engine/split.js'), 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n'); const marked = lines.map((l, i) => (l.endsWith('// (BAE 6단계)') ? i : -1)).filter((i) => i >= 0);
  assert.ok(marked.length >= 10, String(marked.length));
  assert.equal(marked.at(-1)! - marked[0] + 1, marked.length, '표시 줄이 한 덩어리 (끼운 자리 하나)');
  const rest = lines.filter((_, i) => !marked.includes(i)).join('\n');
  // v0.4.4 split.js (C:\BAE_stage0\app\bae-layers\src\split.js = 5단계 커밋 5e42dfe7 의 것) 의 SHA-256
  assert.equal(crypto.createHash('sha256').update(rest).digest('hex'), 'aebd2cecf8dd0d24d51dd203868b349f277a4f08bc703eb2c21e30c1c264f51a');
  // 끼운 자리는 SAM 윤곽(findOutlines) 바로 뒤, '윤곽 끝' 알림 앞 — 2026-11-03 bir/split_bir.js 와 같은 자리
  const at = lines.findIndex((l) => l.includes('const out = await findOutlines('));
  assert.ok(marked[0] > at && lines[marked.at(-1)! + 1].includes("step('outlines', 'ok'"));
});

/* ---------------------------------------------------------------- 2. poc_main6 과 같은 셈 */

test('셈: 잘라 넣기 · 되돌리기 · 자를 곳이 poc_main6 과 같다', async () => {
  const P = pocFunctions(async () => new Float32Array(0));
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const rgb = new Uint8Array(37 * 23 * 3).map(() => Math.floor(rnd() * 256));
  assert.deepEqual(BIR.prepCrop(rgb, 37, 23), P.prepCrop(rgb, 37, 23));
  const logits = new Float32Array(1024 * 1024).map(() => rnd() * 16 - 8); const probs = new Float32Array(1024 * 1024).map(() => rnd());
  assert.deepEqual(BIR.back(logits, 53, 41), P.back(logits, 53, 41), '로짓 (시그모이드)');
  assert.deepEqual(BIR.back(probs, 41, 53), P.back(probs, 41, 53), '0..1');
  for (const b of [[0, 0, 10, 10], [100, 50, 400, 300], [1800, 900, 2048, 1152]]) assert.deepEqual(BIR.cropOf(b, 2048, 1152), P.cropOf(b, 2048, 1152));
});

test('셈: 물건 윤곽 바꾸기가 poc_main6 과 픽셀까지 같다 (두 SAM 윤곽이 함께 가진 픽셀이 없을 때)', async () => {
  const W = 240, H = 160, WALL = [205, 200, 190], FLOOR = [150, 120, 90];
  const plate = new Uint8Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) plate.set(y < 100 ? WALL : FLOOR, (y * W + x) * 3);
  const orig = plate.slice(); paint(orig, W, [30, 40, 110, 130], [60, 90, 160]); paint(orig, W, [110, 60, 190, 140], [170, 60, 50]);
  // SAM 이 왼쪽 물건을 3px 넘게 땄고(오른쪽 물건 픽셀까지), 오른쪽 물건은 3px 덜 땄다 — 둘이 함께 가진 픽셀은 없다
  const ms0 = [rectBM([30, 40, 113, 130]), rectBM([113, 60, 190, 140])];
  const objs = () => [{ id: 'a', name: '파란 장', box: [30, 40, 110, 130] }, { id: 'b', name: '빨간 상자', box: [110, 60, 190, 140] }];
  const run = fakeBir([WALL, FLOOR]);
  const P = pocFunctions(run); const poc = await P.refineOutlines({ W, H, orig, plate, objs: objs(), ms: ms0.slice() });
  const ours = BIR.createBirefnet({ run }); const got = await ours.refineOutlines({ W, H, orig, plate, objs: objs(), ms: ms0.slice() });
  assert.ok(got.report.every((r: any) => r.used === 'birefnet'), JSON.stringify(got.report));
  assert.ok(got.report.some((r: any) => r.shared_px_kept > 0), '두 물건이 같은 픽셀을 말한 곳(색으로 나누기)도 지나갔다');
  for (let i = 0; i < 2; i++) assert.deepEqual(fullOf(got.ms[i], W, H), fullOf(poc.ms[i], W, H), objs()[i].name);
  assert.deepEqual(got.report, poc.report);
  assert.equal(ours.state.used, 2); assert.equal(ours.state.runs, 2); assert.equal(ours.state.failed, null);
  // 오른쪽 물건 픽셀은 오른쪽 물건에게 (SAM 이 왼쪽에 잘못 붙였던 3px)
  const right = fullOf(got.ms[1], W, H), left = fullOf(got.ms[0], W, H);
  assert.equal(right[100 * W + 111], 1); assert.equal(left[100 * W + 111], 0);
});

test('셈: 바꾼 한 가지 — 두 SAM 윤곽이 원래 함께 가진 픽셀(가는 쇠다리)은 색으로 나누지 않고 엔진에 맡긴다 (poc_main6 은 책상 다리를 의자에 줬다)', async () => {
  const W = 220, H = 160, WALL = [205, 200, 190], FLOOR = [150, 120, 90];
  const plate = new Uint8Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) plate.set(y < 100 ? WALL : FLOOR, (y * W + x) * 3);
  const orig = plate.slice();
  const chair = [100, 40, 190, 120], top = [30, 50, 150, 80], legs = [[34, 80, 38, 140], [142, 80, 146, 140]];
  paint(orig, W, chair, [125, 125, 132]);                               // 쇠 의자 (책상 뒤)
  paint(orig, W, top, [140, 100, 60]); for (const l of legs) paint(orig, W, l, [120, 120, 120]);   // 책상 (앞) · 가는 쇠다리 4px
  const deskSam = BM.or(rectBM(top), BM.or(rectBM(legs[0]), rectBM(legs[1])));
  const ms0 = [deskSam, rectBM(chair)];                                // 의자 SAM 은 상자 전체 — 책상 윗판 일부와 오른쪽 다리 위쪽까지
  const objs = () => [{ id: 'd', name: '책상', box: [30, 50, 150, 140] }, { id: 'c', name: '의자', box: chair }];
  const zeros = async () => new Float32Array(1024 * 1024);            // BiRefNet 이 아무것도 못 잡음 → 둘 다 SAM 윤곽
  const P = pocFunctions(zeros); const poc = await P.refineOutlines({ W, H, orig, plate, objs: objs(), ms: ms0.slice() });
  const ours = BIR.createBirefnet({ run: zeros }); const got = await ours.refineOutlines({ W, H, orig, plate, objs: objs(), ms: ms0.slice() });
  assert.ok(got.report.every((r: any) => r.used === 'sam'));
  const d0 = fullOf(deskSam, W, H), c0 = fullOf(ms0[1], W, H);
  const leg = (m: Uint8Array) => { let n = 0; for (let y = 80; y < 120; y++) for (let x = 142; x < 146; x++) n += m[y * W + x]; return n; };
  assert.equal(leg(fullOf(poc.ms[0], W, H)), 0, 'poc_main6: 책상 오른쪽 다리 위쪽(의자 SAM 과 겹친 곳)이 색이 가까운 의자로 감');
  assert.equal(leg(fullOf(got.ms[0], W, H)), 160, '지금: 책상 다리 그대로 (160px)');
  assert.deepEqual(fullOf(got.ms[0], W, H), d0, '두 물건 모두 SAM 윤곽 그대로 = 지금 방식과 같다');
  assert.deepEqual(fullOf(got.ms[1], W, H), c0);
  // poc 와 다른 픽셀은 모두 두 SAM 윤곽이 함께 가진 곳뿐
  for (let k = 0; k < 2; k++) { const a = fullOf(got.ms[k], W, H), b = fullOf(poc.ms[k], W, H); for (let i = 0; i < W * H; i++) if (a[i] !== b[i]) assert.ok(d0[i] && c0[i], `${k}: ${i % W},${(i / W) | 0}`); }
  assert.ok(got.report.every((r: any) => r.shared_px_engine > 0 && !r.shared_px_kept));
});

test('셈: BiRefNet 이 도중에 실패하면 그 그림은 SAM 윤곽 그대로 (같은 배열), 그만두기는 실패가 아니라 그대로 던진다', async () => {
  const W = 120, H = 80; const plate = new Uint8Array(W * H * 3).fill(200); const orig = plate.slice(); paint(orig, W, [20, 20, 60, 60], [40, 40, 40]); paint(orig, W, [70, 20, 100, 70], [200, 30, 30]);
  const ms = [rectBM([20, 20, 60, 60]), rectBM([70, 20, 100, 70])]; const objs = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }];
  let n = 0; const logs: string[] = [];
  const bir = BIR.createBirefnet({ run: async () => { if (++n === 2) throw new Error('DML 장치가 사라졌어요'); return new Float32Array(1024 * 1024); }, log: (t: string) => logs.push(t) });
  const r = await bir.refineOutlines({ W, H, orig, plate, objs, ms });
  assert.equal(r.ms, ms); assert.equal(bir.state.failed?.message, 'DML 장치가 사라졌어요'); assert.equal(bir.state.used, 0);
  assert.match(logs.join('\n'), /BiRefNet 실패 → SAM 윤곽 그대로/);
  const ctl = new AbortController(); const bir2 = BIR.createBirefnet({ run: async () => { ctl.abort(); return new Float32Array(1024 * 1024); }, signal: ctl.signal });
  await assert.rejects(bir2.refineOutlines({ W, H, orig, plate, objs, ms }), (e: Error) => e.name === 'AbortError');
});

/* ---------------------------------------------------------------- 3. 엔진 한 판: 새 방식 · 지금 방식으로 끝까지 */

const SC = sonamuScene(); const N = SCENE_W * SCENE_H;
const ORIG_PNG = encodePng(rgbToRgba(SC.orig, N), SCENE_W, SCENE_H); const PLATE_PNG = encodePng(rgbToRgba(SC.plate, N), SCENE_W, SCENE_H);
const WALL = [236, 226, 204], FLOOR = [196, 160, 118], SHADE: [number[], number] = [FLOOR.map((v) => Math.round(v * .6)), 10];   // 화분 그림자 (액자 색과 가까워 좁게)
/** 엔진 한 판 하나로 그림 찾기 → 처음 계획 → 나누기. GPT 는 저장된 답(물건 목록 · 빈 방), SAM 은 가짜. */
async function splitOnce(edges: unknown, o: { abortAt?: string } = {}) {
  const mem = new Map<string, unknown>(); const steps: Array<[string, string, Record<string, unknown>]> = []; const logs: string[] = [];
  const gpt = {
    async pd(r: { name: string }) { return { json: r.name === 'inventory' ? SONAMU_INV : { pairs: [] }, usd: 0 }; },
    async edit() { return { png: PLATE_PNG, usd: 0 }; },
  };
  const ctl = new AbortController();
  const S = R.createLayersSession({
    gpt, storeFor: (p: string) => ({ get: async (k: string) => mem.get(p + '|' + k), set: async (k: string, v: unknown) => { mem.set(p + '|' + k, v); } }),
    sam: fakeSam(BM.fromCrop), codec: nodeCodec, thumbs: null, edges, log: (t: string) => logs.push(t),
    onStep: (id: string, st: string, info: Record<string, unknown>) => { steps.push([id, st, info || {}]); if (o.abortAt && id === o.abortAt && st === 'run') ctl.abort(); },
  });
  const pic = crypto.createHash('sha256').update(ORIG_PNG).digest('hex');
  const p = (await S.plan({ image: { w: SCENE_W, h: SCENE_H, rgb: SC.orig }, pic, notes: '' })).proposal;
  const plan = PM.planFromProposal({ ...p, saved: null }).plan;
  const r = await S.split({ plan: PM.planForEngine(plan), signal: ctl.signal });
  return { ...r, steps, logs, flat: readFlat(r.psd) };
}
const sameLayers = (a: FlatLayer[], b: FlatLayer[]) => {
  assert.deepEqual(a.map((L) => L.path), b.map((L) => L.path));
  for (let i = 0; i < a.length; i++) { assert.deepEqual([a[i].left, a[i].top, a[i].w, a[i].h], [b[i].left, b[i].top, b[i].w, b[i].h], a[i].path); assert.ok(Buffer.from(a[i].data).equals(Buffer.from(b[i].data)), a[i].path); }
};
const model = (o: { ready?: () => Promise<unknown>; run?: (x: Float32Array) => Promise<{ data: ArrayLike<number>; ep: string }> }) => ({
  ready: o.ready ?? (async () => ({ ok: true })),
  run: o.run ?? (async (x: Float32Array) => ({ data: await fakeBir([WALL, FLOOR, SHADE])(x), ep: 'dml' })),
});

const BASE = await splitOnce(null);
test('엔진 한 판: 가장자리 모델이 없는 화면(시험 · 미리보기)은 지금 방식 — 엔진 그대로, 까닭 off', () => {
  const e = BASE.summary.edges;
  assert.deepEqual([e.method, e.why, e.used, e.props], ['sam', 'off', 0, 4]);
  assert.equal(e.text, '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (이 화면에서는 가장자리 모델을 쓰지 않아요).');
  assert.ok(!BASE.steps.some((s) => s[0] === 'edges'), '가장자리 단계가 없다');
});

test('엔진 한 판: 모델이 없거나(받지 못함 · 받는 중) · 불러오지 못하거나 · 계산이 실패하거나 · CPU 로만 돌면 SAM 만과 픽셀까지 같은 PSD 로 끝까지, 까닭은 쉬운 말로', async () => {
  const cases: Array<[string, unknown, string, string]> = [
    ['모델을 받지 못함', model({ ready: async () => ({ ok: false, why: 'missing' }) }), 'missing', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 받지 못했어요).'],
    ['아직 받는 중 (기다려도 안 끝남)', model({ ready: async () => ({ ok: false, why: 'downloading' }) }), 'downloading', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 아직 받는 중이에요).'],
    ['확인이 예외', model({ ready: async () => { throw new Error('통로가 닫힘'); } }), 'missing', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 받지 못했어요).'],
    ['불러오지 못함 (모델 일꾼이 첫 계산에서 실패)', model({ run: async () => { throw Object.assign(new Error('가장자리 모델을 불러오지 못했어요'), { code: 'MODEL_LOAD' }); } }), 'failed', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (이 PC에서 모델이 돌지 않았어요).'],
    ['세 번째 물건에서 계산 실패', (() => { let n = 0; const ok = fakeBir([WALL, FLOOR, SHADE]); return model({ run: async (x) => { if (++n === 3) throw new Error('계산 실패'); return { data: await ok(x), ep: 'dml' }; } }); })(), 'failed', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (이 PC에서 모델이 돌지 않았어요).'],
    ['그래픽카드 없이 CPU 로만 돔', model({ run: async (x) => ({ data: await fakeBir([WALL, FLOOR, SHADE])(x), ep: 'cpu' }) }), 'cpu', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (그래픽카드로 돌릴 수 없어요).'],
    ['모델이 그린 윤곽이 어느 물건과도 맞지 않음', model({ run: async () => ({ data: new Float32Array(1024 * 1024), ep: 'dml' }) }), 'nomatch', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델이 그린 윤곽이 물건과 맞지 않았어요).'],
  ];
  for (const [label, edges, why, text] of cases) {
    const r = await splitOnce(edges);
    const e = r.summary.edges;
    assert.deepEqual([e.method, e.why, e.used], ['sam', why, 0], label);
    assert.equal(e.text, text, label);
    sameLayers(r.flat.layers, BASE.flat.layers);
    const last = r.steps.filter((s) => s[0] === 'edges').at(-1)!;
    assert.deepEqual([last[1], last[2].method, last[2].why], ['ok', 'sam', why], label + ' (단계 줄)');
  }
});

test('엔진 한 판: 모델이 돌면 새 방식 — 물건 4개 모두 BiRefNet 윤곽 · 부드러운 가장자리, 레이어 이름은 그대로, 레이어 하나씩 꺼도 남는 것이 늘지 않는다', async () => {
  let runs = 0; const r = await splitOnce(model({ run: async (x) => { runs++; return { data: await fakeBir([WALL, FLOOR, SHADE])(x), ep: 'dml' }; } }));
  const e = r.summary.edges;
  assert.deepEqual([e.method, e.why, e.used, e.props, e.runs], ['birefnet', null, 4, 4, 4]); assert.equal(runs, 4);
  assert.equal(e.text, '가장자리를 새 방식으로 다듬었어요 (물건 4개 중 4개).');
  assert.ok(e.outlines.every((x: { used: string; iou: number }) => x.used === 'birefnet' && x.iou >= .85));
  assert.ok(e.soft.length === 4 && e.soft.every((x: { soft: string }) => x.soft === 'birefnet'), JSON.stringify(e.soft));
  // 단계: 윤곽 → 가장자리(물건마다 진행) → 앞뒤 …
  const ids = r.steps.map((s) => s[0] + ':' + s[1]);
  assert.ok(ids.indexOf('edges:run') > ids.lastIndexOf('outlines:run') && ids.indexOf('edges:ok') < ids.indexOf('depth:run'), ids.join(' '));
  assert.ok(r.steps.some((s) => s[0] === 'edges' && s[1] === 'run' && s[2].done === 2 && s[2].total === 4));
  assert.deepEqual(r.flat.layers.map((L) => L.path), BASE.flat.layers.map((L) => L.path));
  assert.ok(r.flat.layers.some((L, i) => !Buffer.from(L.data).equals(Buffer.from(BASE.flat.layers[i].data))), '가장자리가 바뀐 레이어가 있다');
  const plate = SC.plate; const before = hideOneCheck(BASE.flat.layers, SCENE_W, SCENE_H, plate), after = hideOneCheck(r.flat.layers, SCENE_W, SCENE_H, plate);
  for (const h of after) assert.ok(h.leftover <= (before.find((b) => b.path === h.path)?.leftover ?? 0), `${h.path}: ${h.leftover}`);
  assert.ok(Math.abs(r.summary.stack.mean_diff - BASE.summary.stack.mean_diff) < 1, '다 켠 그림이 원본과 비슷한 정도');
});

test('엔진 한 판: 가장자리 단계에서 그만두면 실패로 돌지 않고 그대로 그만둔다', async () => {
  // 모델을 기다리는 중 (화면 쪽 일꾼에서는 rpc 가 그만두기 신호를 듣는다 — 여기서는 ready 가 직접)
  const stop = () => Object.assign(new Error('그만뒀어요'), { name: 'AbortError' });
  const waiting = model({ ready: ((signal: AbortSignal) => new Promise((_, rej) => { if (signal.aborted) rej(stop()); else signal.addEventListener('abort', () => rej(stop())); })) as never });
  await assert.rejects(splitOnce(waiting, { abortAt: 'edges' }), (e: Error) => e.name === 'AbortError', '모델을 기다리는 중');
  // 물건마다 BiRefNet 을 돌리는 중
  const during = model({ run: async (x) => ({ data: await fakeBir([WALL, FLOOR, SHADE])(x), ep: 'dml' }) });
  await assert.rejects(splitOnce(during, { abortAt: 'edges' }), (e: Error) => e.name === 'AbortError', 'BiRefNet 을 돌리는 중');
});

/* ---------------------------------------------------------------- 4. 창 쪽 받기 상태 · 일꾼 부탁 · 기록 줄 */

test('받기 상태: 처음 레이어 때 받기 시작, 나눌 때 받는 중이면 기다리고(늦으면 downloading), 못 받으면 missing, 일꾼이 멈춘 적 있으면 crashed', async () => {
  EM.resetLayersEdgesForTest();
  let finish: (() => void) | null = null; let fail: ((e: Error) => void) | null = null; let calls = 0;
  const mg = { ensure: (id: string) => { calls++; assert.equal(id, 'birefnet'); return new Promise<void>((res, rej) => { finish = res; fail = rej; }); } };
  const seen: string[] = []; const off = EM.onLayersEdges(() => seen.push(EM.layersEdgesState().phase));
  EM.startLayersEdges(mg); EM.startLayersEdges(mg); assert.equal(calls, 1, '받는 중에는 다시 받지 않는다');
  EM.layersEdgesProgress(120e6, 490e6); assert.equal(EM.edgesGetText(), '가장자리 모델 받는 중 120/490MB (처음 한 번)');
  assert.deepEqual(await EM.layersEdgesReady(mg, 30), { ok: false, why: 'downloading' });
  const later = EM.layersEdgesReady(mg, 5000); finish!(); assert.deepEqual(await later, { ok: true });
  assert.deepEqual(await EM.layersEdgesReady(mg, 10), { ok: true }); assert.equal(calls, 1);
  assert.equal(EM.markLayersEdgesBroken(), true); assert.deepEqual(await EM.layersEdgesReady(mg, 10), { ok: false, why: 'crashed' });
  EM.resetLayersEdgesForTest(); assert.equal(EM.markLayersEdgesBroken(), false, '받아 둔 모델로 돌던 중이 아니면 멈춤으로 치지 않는다');
  const p = EM.layersEdgesReady(mg, 5000); fail!(new Error('모델 창고와 인터넷 둘 다 안 돼요')); assert.deepEqual(await p, { ok: false, why: 'missing' });
  assert.equal(EM.layersEdgesState().phase, 'failed'); assert.match(EM.layersEdgesState().message, /모델 창고/);
  EM.startLayersEdges(mg); assert.equal(calls, 3, '실패했으면 다음 레이어 때 다시 받는다');
  assert.ok(seen.includes('getting') && seen.includes('ready') && seen.includes('failed')); off(); EM.resetLayersEdgesForTest();
});

test('일꾼 부탁 edgesReady: 창이 넣은 답을 돌려주고, 아무것도 안 넣었으면 off (지금 방식)', async () => {
  const sent: any[] = []; const fw = { onmessage: null as ((e: MessageEvent) => void) | null, onerror: null, postMessage(m: unknown) { sent.push(m); }, terminate() {} };
  const c = R.createLayersClient({ gateway: () => ({}) as never, makeWorker: () => fw });
  c.usePort(new MessageChannel().port1);   // 일꾼이 생긴다
  const ask = async (id: number) => { fw.onmessage!({ data: { type: 'rpc', id, method: 'edgesReady', args: {} } } as MessageEvent); for (let i = 0; i < 20 && !sent.some((m) => m.id === id); i++) await new Promise((r) => setTimeout(r, 5)); return sent.find((m) => m.id === id); };
  assert.deepEqual(await ask(1), { type: 'rpc-reply', id: 1, ok: true, value: { ok: false, why: 'off' } });
  c.setEdges(async () => ({ ok: true })); assert.deepEqual((await ask(2)).value, { ok: true });
  c.setEdges(async () => { throw new Error('창이 닫힘'); }); const r3 = await ask(3); assert.equal(r3.ok, false); assert.match(r3.error, /창이 닫힘/);
});

test('공용 말: 방식 이름 · 까닭 · 기록 줄은 모르는 방식과 너무 긴 글을 받지 않는다', () => {
  assert.equal(SH.baeLayersEdgesLabel('birefnet'), '새 방식 (가장자리 다듬기)'); assert.equal(SH.baeLayersEdgesLabel('sam'), '지금 방식 (윤곽 모델만)');
  assert.equal(SH.baeLayersEdgesNote('birefnet', null, 20, 91), '가장자리를 새 방식으로 다듬었어요 (물건 91개 중 20개, 나머지 71개는 지금 방식).');
  assert.equal(SH.baeLayersEdgesNote('sam', 'missing'), '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 받지 못했어요).');
  for (const w of SH.BAE_LAYERS_EDGES_WHY) assert.doesNotMatch(SH.baeLayersEdgesNote('sam', w), /undefined|BiRefNet|SAM|GPU|DirectML/, w);
  assert.deepEqual(SH.baeLayersEdgesRecord('birefnet', '  가장자리를\n새 방식으로 다듬었어요.  '), { edges: 'birefnet', edgesNote: '가장자리를 새 방식으로 다듬었어요.' });
  assert.deepEqual(SH.baeLayersEdgesRecord('gpu-magic', 'x'.repeat(201)), { edges: 'sam', edgesNote: '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요.' });
  assert.deepEqual(SH.baeLayersEdgesRecord(undefined, undefined), { edges: 'sam', edgesNote: '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요.' }, '5단계 화면이 보낸 것');
});

test('메인 기록 줄: 다 나누면 result.layers 에 가장자리 방식과 그 까닭 (쉬운 말)', async () => {
  const { createBaeLayers } = await load('electron/bae/baeLayers.ts');
  const { effectiveBaeSettings } = await load('electron/bae/baeSettingsCache.ts');
  const { createBaeLocalStore } = await load('electron/bae/localStore.ts');
  const local = createBaeLocalStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'bae-edges-')) });
  const queued: Array<{ kind: string; payload: any }> = [];
  const layers = createBaeLayers({
    settings: { get: async () => ({ ...effectiveBaeSettings([]), apiBase: 'http://127.0.0.1:9/v1' }) }, keyFor: async () => 'sk-test-local-only-edges', local,
    outbox: { enqueue: async (kind: string, payload: unknown) => { queued.push({ kind, payload }); return { id: 'x', status: 'queued' }; } },
    imagePrefs: { get: () => ({ imageField: 'image[]', stream: true }), set: () => {} }, publicUrl: (p: string) => `https://storage.example/${p}`, showItemInFolder: () => {}, appVersion: 'test', origin: 'PC',
  });
  const psd = new Uint8Array(64); psd.set([0x38, 0x42, 0x50, 0x53]);
  const sum = { W: 2, H: 2, layers: 5, shadows: 1, bins: { OL: 1, ML: 4, UL: 0 }, left: 0, merged: 0, stackDiff: 0.8, sec: 3, again: false, props: 6 };
  const rows: any[] = [];
  for (const [edges, edgesNote] of [['birefnet', '가장자리를 새 방식으로 다듬었어요 (물건 6개 중 6개).'], ['sam', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 받지 못했어요).']]) {
    const jobId = crypto.randomUUID();
    assert.equal((await layers.begin('u', { jobId, createdAt: new Date().toISOString(), parentJobId: null, label: 'a.png', source: PLATE_PNG, w: SCENE_W, h: SCENE_H })).ok, true);
    assert.equal((await layers.done('u', { jobId, psd, summary: { ...sum, edges, edgesNote } })).ok, true);
    rows.push(queued.filter((q) => q.kind === 'job').at(-1)!.payload.result.layers);
  }
  assert.deepEqual([rows[0].edges, rows[0].edgesNote], ['birefnet', '가장자리를 새 방식으로 다듬었어요 (물건 6개 중 6개).']);
  assert.deepEqual([rows[1].edges, rows[1].edgesNote], ['sam', '가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요 (모델을 받지 못했어요).']);
});

/* ---------------------------------------------------------------- 5. 진짜 그림 넷 (Electron 시험의 재기) */

const CHECKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/bae/layers/stage6_checks.json'), 'utf8'));
/** 6단계 끝 기준 (14b 11-3) — 재기 결과 한 벌에 대해 */
function stage6Criteria(c: any) {
  const A = c.meetA, Bf = c.meetB, CL = c.classroom, SO = c.sonamu;
  // 회의실 측면 · 정면: 11-03 결과 재현 — 새 방식 PSD 가 11-03 의 '2_새방식_BiRefNet.psd' 와 레이어 픽셀까지 같고, 책상 윗선이 그림 선 위 (±0.5px 안)
  for (const [m, name] of [[A, '측면'], [Bf, '정면']] as const) {
    if (m.same_as_1103) assert.deepEqual(m.same_as_1103.diff_px, Object.fromEntries(Object.keys(m.same_as_1103.diff_px).map((k) => [k, 0])), name + ': 11-03 PSD 와 픽셀까지 같다');
    assert.ok(Math.abs(m.desk.new.all.mean) <= .5 && Math.abs(m.desk.new.wall.mean) <= .5, `${name} 새 방식 책상 윗선 ${m.desk.new.all.mean}`);
    assert.ok(m.desk.current.all.mean >= 1.5, `${name} 지금 방식은 그림 선보다 아래 (${m.desk.current.all.mean})`);
    assert.equal(m.new.bgFix, null, name + ": 새 방식에는 'BG 보정' 레이어가 없다");
    for (const h of m.new.hideOne) assert.equal(h.leftover, 0, `${name} ${h.path} 를 끄면 아무것도 안 남는다`);
  }
  assert.equal(Bf.new.hideOne.find((h: any) => h.path === 'ML/벽걸이 TV').leftover, 0, 'TV 를 끄면 아무것도 안 남는다');
  // 교실 · 소나무: 레이어 하나씩 끄기 — 물건마다 새 방식이 남기는 픽셀이 지금 방식 + 50 안, 모두 합치면 지금 방식 이하.
  // 가는 부분(책상 다리 · 가방 끈, 소나무는 모든 물건) 중 그려진 것(빈 배경과 다른 픽셀): 지금 방식이 가진 것의 98% 이상을 새 방식도 가진다.
  // 교실의 책상 · 가방은 빈 배경과 같은 픽셀까지 세어도 지금 방식 이상
  for (const [p, name] of [[CL, '교실'], [SO, '소나무']] as const) {
    let a = 0, b = 0;
    for (const h of p.new.hideOne) { const cur = p.current.hideOne.find((x: any) => x.path === h.path); assert.ok(cur, h.path); a += cur.leftover; b += h.leftover; assert.ok(h.leftover <= cur.leftover + 50, `${name} ${h.path}: ${cur.leftover} → ${h.leftover}`); }
    assert.ok(b <= a, `${name} 합: ${a} → ${b}`);
    for (const t of p.thin) assert.ok(t.drawn_in_new >= .98 * t.drawn_in_current, `${name} ${t.name} 그려진 가는 부분 ${t.drawn_in_current} → ${t.drawn_in_new}`);
  }
  for (const t of CL.thin) assert.ok(t.thin_in_new >= t.thin_in_current, `교실 ${t.name} 가는 부분 ${t.thin_in_current} → ${t.thin_in_new}`);
  assert.ok(CL.thin.some((t: any) => /책상/.test(t.name)) && CL.thin.some((t: any) => /가방/.test(t.name)), '교실은 책상 · 가방을 잰다');
}
test('진짜 그림 넷 (Electron 33 · DirectML · 저장된 GPT 답): 6단계 끝 기준 — 회의실 둘은 11-03 재현, 교실 · 소나무는 레이어 하나씩 끄기 · 가는 부분', () => {
  stage6Criteria(CHECKS.pictures);
  assert.equal(CHECKS.runs.normal.ep, 'dml');
  for (const w of ['meetA', 'meetB', 'classroom', 'sonamu']) { assert.equal(CHECKS.runs.normal[w].bir.method, 'birefnet', w); assert.equal(CHECKS.runs.normal[w].sam.method, 'sam', w); }
  // 모델이 없거나 실패하면 SAM 만으로 끝까지, 창과 기록에 그렇게
  for (const [mode, why] of [['missing', 'missing'], ['fail-load', 'failed'], ['fail-run', 'failed']] as const) {
    const r = CHECKS.runs[mode];
    for (const b of r.bench) { assert.equal(b.method, 'sam', mode); assert.equal(b.why, why, mode); assert.equal(b.same_as_sam_only, true, mode + ' ' + b.which + ': SAM 만 PSD 와 같다'); }
    assert.match(r.ui.method, /^가장자리지금 방식 \(윤곽 모델만\) · 가장자리 다듬기 모델을 쓰지 못해 지금 방식으로 나눴어요/, mode);
    assert.equal(r.ui.record.edges, 'sam', mode); assert.match(r.ui.record.edgesNote, /지금 방식으로 나눴어요/, mode);
  }
});
const PSD_DIR = 'C:\\BAE_stage0\\bir_port\\psd';
test('진짜 그림 넷: 이 PC 에 시험 PSD 가 있으면 PSD 에서 다시 재서 같은 기준 (없으면 건너뜀)', { skip: !fs.existsSync(path.join(PSD_DIR, '교실_2_새방식_BiRefNet.psd')) && '시험 PSD 없음' }, async () => {
  const url = 'file:///C:/BAE_stage0/bir_port/measure.mjs';   // 재는 셈은 이 저장소의 tests/baeGyeongLayersChecks.ts 를 쓴다
  const measure = (await import(url)).measure as (w: string, a: string, b: string) => any;
  const KO: Record<string, string> = { meetA: '회의실측면', meetB: '회의실정면', classroom: '교실', sonamu: '소나무거실' };
  const got: Record<string, any> = {};
  for (const w of Object.keys(KO)) {
    const m = measure(w, path.join(PSD_DIR, `${KO[w]}_1_지금방식_SAM만.psd`), path.join(PSD_DIR, `${KO[w]}_2_새방식_BiRefNet.psd`));
    got[w] = { ...m, desk: m.desk ? m.desk.byLayer : undefined };
    const saved = CHECKS.pictures[w];
    assert.deepEqual(got[w].new.hideOne.map((h: any) => [h.path, h.leftover]), saved.new.hideOne.map((h: any) => [h.path, h.leftover]), w + ': 저장한 재기와 같다');
  }
  stage6Criteria(got);
});
