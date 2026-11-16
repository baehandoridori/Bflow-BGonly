import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

// BAE경 5단계 SAM 기억 함정 (계획 14 3-4 함정 1 · 14b 11-3 '그림 두 장을 이어서 나눠도 섞이지 않음').
// 엔진은 그림을 늘 'orig' 같은 같은 이름으로 부른다. 모델 일꾼은 이름으로 그림을 기억하므로, 이름만 보내면 두 번째 그림이
// 첫 그림의 기억을 쓴다. 화면 쪽 어댑터(remoteSam)는 이름에 픽셀 SHA-256 을 붙인다 — 그 차이를 가짜 모델 일꾼으로 본다.
// 가짜 일꾼은 modelWorker.ts 의 SAM 말(sam.setImage: 없으면 need · 기억 3장, sam.run: 없으면 SAM_NEED_IMAGE)을 그대로 따른다.
const ROOT = path.resolve(import.meta.dirname, '..');
let nonce = 0;
async function loadRenderer() {
  const contents = [
    "export * from './src/features/bae-gyeong/layers/remoteSam.ts';",
    "export * as BM from './src/features/bae-gyeong/layers/engine/bm.js';",
    "export { planLayers } from './src/features/bae-gyeong/layers/engine/planner.js';",
  ].join('\n');
  const r = await build({ stdin: { contents, resolveDir: ROOT, loader: 'ts', sourcefile: 'sam-entry.ts' }, bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}#${nonce++}`);
}

const W = 256, H = 144;
/** 빨간 네모 하나가 x 자리에 있는 그림 (나머지는 회색). */
function picture(x0: number): Uint8Array {
  const rgb = new Uint8Array(W * H * 3).fill(128);
  for (let y = 40; y < 100; y++) for (let x = x0; x < x0 + 60; x++) rgb.set([220, 30, 30], (y * W + x) * 3);
  return rgb;
}
/** 가짜 모델 일꾼: 그림을 이름으로 기억 (3장까지), 답은 상자 안의 빨간 픽셀 (256×256 낮은 해상도 로짓 네 장). */
function fakeModelWorker() {
  const ch = new MessageChannel(); const cache = new Map<string, { W: number; H: number; rgb: Uint8Array }>(); const log: string[] = [];
  const port = ch.port2 as unknown as { onmessage: ((e: { data: any }) => void) | null; postMessage(m: unknown): void; close(): void };
  port.onmessage = (e) => {
    const m = e.data; const reply = (o: Record<string, unknown>) => port.postMessage({ ...o, id: m.id });
    if (m.type === 'sam.setImage') {
      const c = cache.get(m.key);
      if (c) { log.push('cached ' + m.key); return reply({ ok: true, W: c.W, H: c.H, s: 1024 / Math.max(c.W, c.H), nw: Math.round(c.W * 1024 / Math.max(c.W, c.H)), nh: Math.round(c.H * 1024 / Math.max(c.W, c.H)), cached: true }); }
      if (!m.rgb) { log.push('need ' + m.key); return reply({ ok: true, need: true }); }
      log.push('read ' + m.key); if (cache.size >= 3) cache.delete(cache.keys().next().value!);
      cache.set(m.key, { W: m.W, H: m.H, rgb: m.rgb });
      const s = 1024 / Math.max(m.W, m.H); return reply({ ok: true, W: m.W, H: m.H, s, nw: Math.round(m.W * s), nh: Math.round(m.H * s), ep: 'cpu' });
    }
    if (m.type === 'sam.run') {
      const c = cache.get(m.key); if (!c) return reply({ ok: false, error: 'SAM: 그림을 먼저 읽어야 해요: ' + m.key, code: 'SAM_NEED_IMAGE' });
      const s = 1024 / Math.max(c.W, c.H); const masks = new Float32Array(4 * 256 * 256).fill(-5);
      const b = m.box as number[];
      for (let k = 0; k < 4; k++) for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const gx = Math.floor((x + 0.5) * 4 / s), gy = Math.floor((y + 0.5) * 4 / s); if (gx < b[0] || gx >= b[2] || gy < b[1] || gy >= b[3] || gx >= c.W || gy >= c.H) continue;
        const i = (gy * c.W + gx) * 3; if (c.rgb[i] > 200) masks[k * 65536 + y * 256 + x] = 5;
      }
      return reply({ ok: true, masks, iou: Float32Array.from([0.5, 0.9, 0.8, 0.95]), ep: 'cpu' });
    }
    reply({ ok: false, error: 'unknown ' + m.type });
  };
  return { port: ch.port1, cache, log, close() { ch.port1.close(); ch.port2.close(); } };
}
const centerX = (m: { x0: number; w: number; d: Uint8Array; h: number }) => { let sx = 0, n = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { sx += x; n++; } return m.x0 + sx / n; };

test('함정: 이름만 보내면 두 번째 그림이 첫 그림의 기억을 쓴다 (그래서 이름에 픽셀 해시를 붙인다)', async () => {
  const mw = fakeModelWorker();
  try {
    const R = await loadRenderer();
    // 이름만 쓰는 어댑터 (해시 없이): 0단계에 시험 도구에서 실제로 한 번 걸린 모양
    const naive = R.remoteSam(mw.port);
    const A = picture(20), B = picture(170);
    let r = await naive.call({ type: 'sam.setImage', key: 'orig', W, H }); if (r.need) await naive.call({ type: 'sam.setImage', key: 'orig', W, H, rgb: A });
    r = await naive.call({ type: 'sam.setImage', key: 'orig', W, H }); if (r.need) await naive.call({ type: 'sam.setImage', key: 'orig', W, H, rgb: B });
    const out = await naive.call({ type: 'sam.run', key: 'orig', box: [0, 30, 256, 110] });
    const e = { W, H, nw: 1024, nh: 576 };
    const m = R.samToMask(out.masks as Float32Array, 1, e);
    assert.ok(Math.abs(centerX(m) - 50) < 4, `B 를 물었는데 A 의 네모(가운데 x≈50)가 나온다: ${centerX(m).toFixed(1)}`);
    assert.deepEqual(mw.log, ['need orig', 'read orig', 'cached orig'], '두 번째 그림은 보내지도 않았다');
  } finally { mw.close(); }
});

test('remoteSam: 그림 두 장을 이어서 읽어도 섞이지 않는다 (이름 + 픽셀 SHA-256 앞 12자리)', async () => {
  const mw = fakeModelWorker();
  try {
    const R = await loadRenderer(); const sam = R.remoteSam(mw.port);
    const A = picture(20), B = picture(170);
    await sam.setImage('orig', A, W, H); const kA = sam.current;
    const a = await sam.predictAll({ box: [0, 30, 256, 110] });
    await sam.setImage('orig', B, W, H); const kB = sam.current;
    const b = await sam.predictAll({ box: [0, 30, 256, 110] });
    assert.match(kA, /^orig@[0-9a-f]{12}$/); assert.match(kB, /^orig@[0-9a-f]{12}$/); assert.notEqual(kA, kB);
    assert.ok(Math.abs(centerX(a.single.mask) - 50) < 4, 'A: 왼쪽 네모');
    assert.ok(Math.abs(centerX(b.single.mask) - 200) < 4, 'B: 오른쪽 네모');
    await sam.setImage('orig', A, W, H); assert.equal(sam.current, kA, '같은 그림은 같은 이름 (다시 보내지 않음)');
    assert.equal(sam.stats.sentPictures, 2);
    assert.deepEqual(mw.log.map((l) => l.split(' ')[0]), ['need', 'read', 'need', 'read', 'cached']);
  } finally { mw.close(); }
});

test('remoteSam: 엔진(planLayers)으로 두 그림을 이어서 찾아도 각자의 윤곽', async () => {
  const mw = fakeModelWorker();
  try {
    const R = await loadRenderer(); const sam = R.remoteSam(mw.port);
    const inv = { background_en: 'gray', groups: [{ group: '상자', en: 'the red box', see_through: false }], objects: [{ group: '상자', name: '빨간 상자', en: 'the red box', box: [0, 30, 256, 110], layer: 'ML', on: '' }], far: [] };
    // PD 그림 1024 기준 상자: 작업 크기 256 → 배율 0.25 이므로 PD 좌표는 4배
    const pdInv = { ...inv, objects: inv.objects.map((o) => ({ ...o, box: o.box.map((v) => v * 4) })) };
    const gpt = { async pd() { return { json: pdInv, usd: 0 }; }, async edit() { throw new Error('not here'); } };
    const codec = { async toDataUrl() { return 'data:image/png;base64,AAAA'; }, async encodePng() { return new Uint8Array(0); }, async decodePng() { throw new Error('no'); } };
    const pA = await R.planLayers({ image: { w: W, h: H, rgb: picture(20) }, gpt, codec, sam });
    const pB = await R.planLayers({ image: { w: W, h: H, rgb: picture(170) }, gpt, codec, sam });
    assert.ok(Math.abs(centerX(pA.objs[0].cands[3]) - 50) < 4 && Math.abs(centerX(pB.objs[0].cands[3]) - 200) < 4);
  } finally { mw.close(); }
});

test('remoteSam: 새 통로(모델 일꾼을 다시 띄움) · 기억에서 밀려난 그림은 다시 보내고 이어 가고, 일꾼이 내려가면 기다리던 것은 실패', async () => {
  const R = await loadRenderer();
  const mw1 = fakeModelWorker(); const sam = R.remoteSam(mw1.port);
  const A = picture(20);
  await sam.setImage('orig', A, W, H);
  // 일꾼이 쉬어서 내려감 → 새 일꾼(기억 없음)의 통로로 바꿈: run 이 SAM_NEED_IMAGE → 픽셀을 다시 보내고 이어 감
  const mw2 = fakeModelWorker(); sam.usePort(mw2.port);
  const a = await sam.predictAll({ box: [0, 30, 256, 110] });
  assert.ok(Math.abs(centerX(a.single.mask) - 50) < 4);
  assert.deepEqual(mw2.log.map((l) => l.split(' ')[0]), ['read']);
  // 기다리는 중 일꾼이 내려감
  const silent = new MessageChannel(); sam.usePort(silent.port1 as never);
  const pending = sam.predictAll({ box: [0, 30, 256, 110] });
  sam.gone('모델 일꾼이 멈췄어요. 다시 누르면 새로 띄워서 해요.');
  await assert.rejects(pending, /모델 일꾼이 멈췄어요/);
  mw1.close(); mw2.close(); silent.port1.close(); silent.port2.close();
});
