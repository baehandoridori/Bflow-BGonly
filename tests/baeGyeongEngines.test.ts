import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { build } from 'esbuild';

// BAE경 '같은 장소' 엔진 (src/features/bae-gyeong/engines): 색 견본 · 색 맞춤 v6 · 노이즈 제거가 HTML v0.4.11 의 워커와 같은 답을 내는지.
// 기대값(tests/fixtures/bae/engines/expected.json)은 HTML script_4.js 의 COLOR_WORKER_SRC · NOISE_WORKER_SRC 원본을 가짜 self 로
// 돌려서 만든 것 (만든 스크립트: C:\BAE_stage0\engine_port\make_fixtures.mjs). 그림은 기준 배경 실험의 결과를 줄이거나 자른 것.
let nonce = 0;
async function load(entry: string) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
async function workerScope(entry: string) {   // 워커 파일을 묶어 가짜 self 에서 돌린다 (HTML 워커와 같은 메시지 약속인지)
  const r = await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', write: false });
  const self: { onmessage: ((e: { data: unknown }) => void) | null; sent: Array<{ msg: any; transfer?: unknown[] }>; postMessage(m: unknown, t?: unknown[]): void } = {
    onmessage: null, sent: [], postMessage(m, t) { this.sent.push({ msg: m, transfer: t }); },
  };
  vm.runInNewContext(r.outputFiles[0].text, { self, Date });
  return self;
}
const FIX = 'tests/fixtures/bae/engines';
const exp = JSON.parse(fs.readFileSync(`${FIX}/expected.json`, 'utf8'));
type Img = { data: Uint8ClampedArray; w: number; h: number };
function input(key: string): Img {
  const meta = exp.inputs[key]; const b = zlib.gunzipSync(fs.readFileSync(`${FIX}/${meta.file}`));
  return { data: new Uint8ClampedArray(b.buffer, b.byteOffset, b.length), w: meta.w, h: meta.h };
}
function upscale(img: Img, s: number): Img {   // make_fixtures.mjs 와 같은 것: 가까운 픽셀로 키우고 정해진 작은 잡음
  const w = img.w * s, h = img.h * s, o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (((y / s) | 0) * img.w + ((x / s) | 0)) * 4, j = (y * w + x) * 4, n = ((x * 7 + y * 13) % 5) - 2;
    o[j] = img.data[i] + n; o[j + 1] = img.data[i + 1] + n; o[j + 2] = img.data[i + 2] + n; o[j + 3] = 255;
  }
  return { data: o, w, h };
}
const sha = (a: Uint8ClampedArray) => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const plain = (o: unknown) => JSON.parse(JSON.stringify(o));

test('팔레트: HTML 색 워커와 같은 색 (기준 배경 견본 · 부품 상자 빼기 · 부품 색 옵션)', async () => {
  const { palette } = await load('src/features/bae-gyeong/engines/colorEngine.ts');
  assert.ok(exp.palette.length >= 5);
  for (const c of exp.palette) assert.deepEqual(plain(palette(input(c.input).data, exp.inputs[c.input].w, exp.inputs[c.input].h, c.opts)), c.colors, c.name);
  assert.deepEqual(palette(new Uint8ClampedArray(4 * 40), 40, 1, {}), [], '50 픽셀 미만이면 빈 목록');
});

test('색 맞춤 v6: HTML 과 픽셀까지 같고 정보도 같다 (작은 그림 · 표본 뽑기 · 180만 픽셀 넘는 그림), 입력은 그대로', async () => {
  const { lockRgba } = await load('src/features/bae-gyeong/engines/colorEngine.ts');
  const ref = input('base'), small = input('result');
  for (const c of exp.lock) {
    const img = c.scale === 1 ? small : upscale(small, c.scale); const before = sha(img.data), refBefore = sha(ref.data);
    const r = lockRgba(ref, img, {});
    assert.equal(r.w, c.w); assert.equal(r.h, c.h);
    assert.equal(sha(r.data), c.sha256, c.name + ': 픽셀');
    assert.deepEqual(plain(r.info), c.info, c.name + ': 정보');
    assert.ok(r.info.moved.length > 0, c.name + ': 넓은 면을 옮김');
    assert.equal(sha(img.data), before, '입력 그림은 바뀌지 않음'); assert.equal(sha(ref.data), refBefore, '기준 배경 픽셀도 그대로');
    assert.notEqual(r.data, img.data);
  }
});

test('노이즈 제거: HTML 과 픽셀까지 같고 정보 · 단계도 같다, 입력은 그대로', async () => {
  const { denoise } = await load('src/features/bae-gyeong/engines/noiseEngine.ts');
  for (const c of exp.denoise) {
    const img = input(c.input), before = sha(img.data), steps: string[] = [];
    const r = denoise(img.data, img.w, img.h, (s: string) => steps.push(s));
    assert.equal(sha(r.data), c.sha256, c.name + ': 픽셀');
    const info = plain(r.info); assert.equal(typeof info.sec, 'number'); delete info.sec;
    assert.deepEqual(info, c.info, c.name + ': 정보');
    assert.deepEqual(steps, c.steps, c.name + ': 단계');
    assert.equal(sha(img.data), before, '입력 그림은 바뀌지 않음'); assert.notEqual(r.data, img.data);
  }
});

test('색 워커: HTML 과 같은 메시지 약속 (palette · lock 은 결과 버퍼를 넘김 · 모르는 일 · 오류)', async () => {
  const self = await workerScope('src/features/bae-gyeong/engines/colorWorker.ts');
  const base = input('base'), res = input('result');
  self.onmessage!({ data: { id: 7, type: 'palette', data: base.data, w: base.w, h: base.h, opts: exp.palette[0].opts } });
  assert.deepEqual(plain(self.sent[0].msg), { id: 7, ok: true, colors: exp.palette[0].colors });
  self.onmessage!({ data: { id: 8, type: 'lock', ref: base, img: { data: new Uint8ClampedArray(res.data), w: res.w, h: res.h }, opts: {} } });
  const m = self.sent[1].msg; assert.equal(m.id, 8); assert.equal(m.ok, true); assert.equal(m.w, res.w); assert.equal(m.h, res.h);
  assert.equal(sha(m.data), exp.lock[0].sha256); assert.deepEqual(plain(m.info), exp.lock[0].info);
  assert.equal(self.sent[1].transfer?.[0], m.data.buffer, '결과 버퍼를 넘긴다');
  self.onmessage!({ data: { id: 9, type: 'nope' } });
  assert.deepEqual(plain(self.sent[2].msg), { id: 9, ok: false, error: 'unknown job nope' });
  self.onmessage!({ data: { id: 10, type: 'lock', ref: null, img: base } });
  assert.equal(self.sent[3].msg.id, 10); assert.equal(self.sent[3].msg.ok, false); assert.equal(typeof self.sent[3].msg.error, 'string');
});

test('노이즈 워커: 단계마다 { id, step }, 끝에 결과 (버퍼를 넘김), 오류는 ok:false', async () => {
  const self = await workerScope('src/features/bae-gyeong/engines/noiseWorker.ts');
  const c = exp.denoise[1], img = input(c.input);
  self.onmessage!({ data: { id: 3, data: img.data, w: img.w, h: img.h } });
  const steps = self.sent.filter((s) => s.msg.step).map((s) => s.msg);
  assert.deepEqual(steps.map((s) => s.step), c.steps); assert.ok(steps.every((s) => s.id === 3));
  const last = self.sent[self.sent.length - 1]; assert.equal(last.msg.ok, true); assert.equal(last.msg.w, img.w); assert.equal(last.msg.h, img.h);
  assert.equal(sha(last.msg.data), c.sha256); assert.equal(last.transfer?.[0], last.msg.data.buffer);
  self.sent = []; self.onmessage!({ data: { id: 4, data: null, w: 3, h: 3 } });
  const err = self.sent[self.sent.length - 1].msg; assert.equal(err.id, 4); assert.equal(err.ok, false); assert.equal(typeof err.error, 'string');
});

test('기준 배경 색 견본: HTML baseSwatches · sheetSwatches · nearHex 그대로', async () => {
  const { baseSwatches, sheetSwatches, nearHex, rgbToHex, swHex, hexToRgb } = await load('src/features/bae-gyeong/engines/colorEngine.ts');
  assert.equal(rgbToHex(232, 201, 154), '#E8C99A'); assert.equal(swHex([10, 0, 255]), '#0A00FF'); assert.deepEqual(hexToRgb('#e8c99a'), [232, 201, 154]); assert.deepEqual(hexToRgb('nope'), [0, 0, 0]);
  assert.equal(nearHex('#E8C99A', '#E9CA9C'), true, '차이 합 4'); assert.equal(nearHex('#E8C99A', '#EECD9A'), false, '차이 합 10');
  const a = { sw: { auto: ['#E8C99A', '#F5F3E1', '#954937'], off: ['#F5F3E1'], add: ['#123456', '#E8C99A'] } };
  assert.deepEqual(baseSwatches(a), ['#E8C99A', '#954937', '#123456'], '엔진 색 + 더한 색, 겹침 하나, 끈 색 빼기');
  assert.deepEqual(baseSwatches({ sw: { auto: null, off: [], add: ['#ABCDEF'] } }), ['#ABCDEF'], '엔진이 아직 안 골랐으면 더한 색만');
  const b = { sw: { auto: ['#E9CA9C', '#F5F3E1', '#000000', '#111111', '#222222', '#333333', '#444444', '#555555'], off: [], add: [] } };
  assert.deepEqual(sheetSwatches([a, b]), ['#E8C99A', '#954937', '#123456', '#F5F3E1', '#000000', '#111111', '#222222', '#333333'], '가까운 색(#E9CA9C)은 하나만, 8개까지');
});
