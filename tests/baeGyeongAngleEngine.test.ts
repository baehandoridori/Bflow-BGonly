import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// BAE경 '다른 각도로' 엔진 값 시험 71개 (src/features/bae-gyeong/angle/engine.ts).
// 예전 엔진 시험(v0.4.5 test_engine_node.mjs 53개 + v0.4.8 9 + v0.4.9 5 + v0.4.10 4)과 같은 목록이다. 그때는 파이썬(prep_place.py) 값과 견줬고,
// 파이썬 기준 자료가 이 PC 에 없어서 이제는 그 시험을 통과했던 HTML v0.4.11 의 ANG 원본이 같은 깊이 값으로 낸 값과 '글자까지' 견준다
// (tests/fixtures/bae/angle/engine_expected.json, 만든 스크립트: C:\BAE_stage0\angle_port\harness\make_engine_fixtures.mjs).
// 깊이 값은 이 PC 의 Depth Anything V2 Small 로 잰 실제 그림의 것 (거실 · 교실 · 주차장, 259x259 로 줄여 uint16 견본).
// 예전 시험이 보던 성질(돌기 25° 에서 벽에 막혀 가까이 · A 는 A · 도면이 A 를 담음 …)도 같이 본다.
const FIX = 'tests/fixtures/bae/angle';
const probeMod = await import(pathToFileURL(`${FIX}/engineProbe.mjs`).href) as { probe: (ANG: unknown, D: unknown, hash: (a: ArrayBufferView) => string) => Record<string, any>; decodeDisp: (b: Buffer, m: unknown, z: typeof zlib) => { disp: Float32Array; dw: number; dh: number }; PLACES: Record<string, { t: string[] }> };
const meta = JSON.parse(fs.readFileSync(`${FIX}/disp/disp.json`, 'utf8'));
const expected = JSON.parse(fs.readFileSync(`${FIX}/engine_expected.json`, 'utf8')).checks as Record<string, any>;
const D: Record<string, { disp: Float32Array; dw: number; dh: number }> = {};
for (const n of ['living', 'classroom', 'parking']) D[n] = probeMod.decodeDisp(fs.readFileSync(`${FIX}/disp/${n}.u16.br`), meta[n], zlib);
const hash = (a: ArrayBufferView) => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 32);
const r = await build({ entryPoints: ['src/features/bae-gyeong/angle/engine.ts'], bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': './src' } });
const { ANG } = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`) as { ANG: any };
const got = probeMod.probe(ANG, D, hash);

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const UNDER = 'The eye is now lower than some things, such as a table top, so their top surfaces are hidden from here. The darker flat shapes in image 1 are their undersides seen from below: draw them as the underside and the front edge of those things, with their legs. ';
// 예전 시험의 성질 (HTML 의 값과 같은 것에 더해서)
const props: Record<string, (v: any) => void> = {};
for (const [place, o] of Object.entries(probeMod.PLACES)) {
  props[place + ': size and lens'] = (v) => { assert.equal(v.W, 2048); assert.equal(v.H, 1152); assert.ok(near(v.f, 2048 / (2 * Math.tan(v.hfov * Math.PI / 360)))); };
  props[place + ': floor fit a, b'] = (v) => { assert.equal(v.fitOk, true); assert.ok(v.fit[0] > 0); };
  props[place + ': Zp'] = (v) => assert.ok(v > 1 && v < 60);
  props[place + ': Zback'] = (v) => assert.ok(v >= got[place + ': Zp']);
  props[place + ': xmin'] = (v) => assert.ok(v < 0);
  props[place + ': xmax'] = (v) => assert.ok(v > 0 && v - got[place + ': xmin'] >= 2);
  props[place + ': mesh grid and triangles'] = (v) => { assert.equal(v.R, 289); assert.equal(v.C, 513); assert.ok(v.ntri > 1000 && v.ntri <= (v.R - 1) * (v.C - 1) * 2); };
  props[place + ': vertices'] = (v) => assert.ok(v.ytop > 0);
  for (const t of o.t) props[place + ': camera ' + t] = (v) => {
    assert.equal(v.cam.preset, t);
    if (t.startsWith('left')) assert.ok(v.info.orbit < 0); if (t.startsWith('right')) assert.ok(v.info.orbit > 0);
    if (t === 'high') assert.ok(v.info.pitch < 0 && v.info.dy > 0); if (t === 'low') assert.ok(v.info.pitch > 0 && v.info.dy < 0);
  };
}
Object.assign(props, {
  "living: the left20 sentence is the experiment's": (v: string) => assert.equal(v, 'The camera has moved about 20 degrees to the left around the middle of the room (it now stands to the left of where the reference was drawn), at the same eye height, and still looks at the middle of the room, so we see the room a little from the left side.'),
  "living: the right45 sentence is the experiment's": (v: string) => assert.equal(v, 'The camera has moved about 45 degrees to the right around the middle of the room (it now stands near the right side of the room), at the same eye height, and looks back toward the middle of the room, so we see the room from the right at an angle.'),
  "living: the high sentence is the experiment's": (v: string) => assert.match(v, /^The camera stays at the same spot but is raised up near the ceiling and looks down at the middle of the room \(about \d+ degrees down\): a high-angle view that shows more of the floor\.$/),
  "living: the low sentence is the experiment's": (v: string) => assert.equal(v, 'The camera stays at the same spot but is lowered close to the floor (about knee height) and tilts up slightly: a low-angle view, the floor looks thin and the walls and furniture look taller.'),
  "living: the whole order (right45) matches the experiment's": (v: string) => { assert.ok(v.startsWith('Image 1 shows the place of image 2 from a new camera: a 3D copy of image 2 was moved to this camera')); assert.ok(v.includes('the camera move is: ' + got["living: the right45 sentence is the experiment's"] + ' Keep the exact drawing style of the reference:')); assert.ok(v.endsWith('No people, no new text or signs.')); },
  'orbit 15 to the right from A: 15 degrees, same height, same distance': (v: any) => { assert.ok(near(v.info.orbit, 15) && Math.abs(v.info.dy) < 1e-9 && near(v.info.dist, 1)); },
  'orbit 25: the right wall is in the way, so it comes closer and keeps 25 degrees': (v: any) => { assert.ok(near(v.info.orbit, 25) && v.info.dist < 0.9 && near(v.cam.pos[0], v.xmax - 0.5)); },
  'height 3 m keeps the target, so it looks down': (v: any) => { assert.ok(near(v.info.floorH, 3, 1e-9) && v.info.pitch < -5); },
  'tilt back to level': (v: any) => assert.ok(Math.abs(v.info.pitch) < 1e-6),
  'closer: 60 % of the distance': (v: any) => assert.ok(Math.abs(v.info.dist - 0.6) < 0.01),
  'orbit 80: the camera stays inside the room (x clamped)': (v: any) => assert.ok(v.cam.pos[0] <= v.xmax - 0.5 + 1e-9 && v.info.orbit < 80),
  'A is A': (v: any) => assert.deepEqual(v, { a: true, r20: false }),
  'fixCam keeps a camera in its room and the target in front': (v: any) => { assert.deepEqual([v.far.pos[0], v.far.pos[1], v.far.pos[2]], [v.L.x[1], v.L.y[1], v.L.z[1]]); assert.ok(v.far.target[2] < v.far.pos[2] - 0.5); },
  'the bird view sees camera A and the middle of the room': (v: any) => assert.ok(v.pa[0] > 0 && v.pa[0] < 800 && v.pa[1] > 0 && v.pa[1] < 450 && v.pp[1] < v.pa[1]),
  'a pointer on camera A meets the eye level at A': (v: any) => assert.ok(v && Math.hypot(v[0], v[2]) < 0.01),
  '1536x1024: builds (work 2048x1365, mesh to the edges)': (v: any) => { assert.equal(v.W, 2048); assert.equal(v.H, 1365); assert.deepEqual(v.uvEnd, [1, 0]); assert.ok(v.ntri > 1000); },
  '1152x2048: builds (work 1152x2048, mesh to the edges)': (v: any) => { assert.equal(v.W, 1152); assert.equal(v.H, 2048); assert.deepEqual(v.uvEnd, [1, 0]); assert.ok(v.ntri > 1000); },
  '1024x1024: builds (work 2048x2048, mesh to the edges)': (v: any) => { assert.equal(v.W, 2048); assert.equal(v.H, 2048); assert.deepEqual(v.uvEnd, [1, 0]); assert.ok(v.ntri > 1000); },
  'a flat disparity (no floor) does not break: a plain scale': (v: any) => assert.ok(Number.isFinite(v.Zp) && v.ntri > 0),
  'v0.4.8: where B may stand (stage, limits)': (v: any) => { assert.ok(v.living.stage.zmax >= 0.5 * got['living: Zback'] - 1e-9); assert.ok(v.parking.stage.zmax >= 0.3 * got['parking: Zback'] - 1e-9); },
  'v0.4.8: distance 250 % goes straight back behind A': (v: any) => { assert.ok(v.cam.pos[2] > 0.3); assert.ok(v.cam.pos[2] <= v.zmax + 1e-9); assert.ok(v.ko.includes('거리')); },
  "v0.4.8: an added picture's camera widens the room": (v: any) => { assert.ok(v.limits.x[0] < v.before.x[0] && v.limits.x[1] > v.before.x[1]); assert.ok(v.limits.z[1] === 14 && v.before.z[1] < 14); assert.equal(v.cam.pos[2], 14); },
  'v0.4.8: B may look at the room behind A': (v: any) => assert.ok(v.cam.target[2] > 0),
  'v0.4.8: the map takes every camera in': (v: any) => { for (const p of v.pts) assert.ok(p && p[0] >= 0 && p[0] <= 800 && p[1] >= 0 && p[1] <= 500); },
  "v0.4.8: with no notes and up to 4 pictures the order is v0.4.7's": (v: any) => { for (const s of Object.values(v) as string[]) assert.ok(!s.includes('art director')); assert.ok((v['right45 n4'] as string).includes('images 2 to 6 are five views')); },
  'v0.4.8: the order for 8 added pictures': (v: string) => assert.ok(v.includes('images 2 to 10 are nine views') && v.includes('Keep the exact drawing style of the references:')),
  'v0.4.8: the PD sentence goes after the brush sentence': (v: string) => assert.ok(v.includes("draw those things properly in the style. The art director's notes for this view: Continue the window frame into the grey gap on the right; keep the wall corner straight. Draw the finished background")),
  'v0.4.8: when the PD cannot read the notes, the notes go as they are': (v: string) => assert.ok(v.includes('(never write these words in the picture): "창문 이어서" at (x 80%, y 40%); something pointed at from (x 10%, y 20%) to (x 30%, y 25%). Draw the finished')),
  'v0.4.9: from A the part is the whole picture': (v: any) => assert.ok(v.area > 0.9 && v.box[0] < 0.05 && v.box[3] > 0.95),
  'v0.4.9: at 50 % of the distance the part is about the middle third': (v: any) => { assert.ok(v.part.area < 0.5 && v.part.area > 0.1); assert.ok(Math.abs((v.part.box[0] + v.part.box[2]) / 2 - 0.5) < 0.1); },
  'v0.4.9: a closer shot is only a hand camera, nearer and turned less than 15 degrees': (v: any) => assert.deepEqual(v, { left45: false, right20: false, high: false, low: false, orig: false, close: true, turned20: false, vp: false }),
  "v0.4.9: without the box the order and the camera sentence are v0.4.8's": (v: any) => { for (const s of Object.values(v) as string[]) { assert.ok(!s.includes('tighter shot')); assert.ok(!s.includes('closer camera')); } },
  "v0.4.9: the closer shot's order": (v: any) => { assert.ok(v.n0.includes('Do not zoom out or widen the view') && v.n0.includes('Everything must look exactly as it does in image 2')); assert.ok(v.n3.includes('images 3 to 5 are other views')); assert.ok(v.sentence.endsWith('It is a closer, tighter shot: that part fills the whole frame, and nothing outside it is seen.')); },
  'v0.4.10: heights under 1 m to the nearest 5 cm': (v: any) => assert.deepEqual(v, ['0.1', '0.15', '0.15', '0.4', '0.6', '0.95', '1.0', '1.2', '2.7']),
  'v0.4.10: the floor end shows 0.15 m': (v: any) => { assert.ok(v.ko.includes('(눈높이 0.15m)')); assert.ok(near(v.eye, 0.15, 1e-9)); assert.ok(v.sentence.includes('down to about 0.15 m above the floor')); },
  "v0.4.10: without undersides the order is v0.4.9's (button, vp, tight, hand)": (v: any) => { for (const k of ['button', 'vp', 'tight', 'hand']) { assert.equal(v[k], v[k + ' under false']); assert.ok(!v[k].includes('undersides')); } },
  'v0.4.10: the underside sentence comes right after image 1': (v: any) => { assert.ok(v.a.includes('some edges are stretched or smeared. ' + UNDER + 'Draw the finished')); assert.ok(v.b.includes('smeared. ' + UNDER + 'Loose colored brush strokes')); assert.ok(v.c.includes('smeared. ' + UNDER + "The art director's notes")); },
});

test('엔진 값 시험은 71개 (예전 v0.4.10 엔진 시험과 같은 수)', () => {
  assert.equal(Object.keys(expected).length, 71);
  assert.deepEqual(Object.keys(got), Object.keys(expected));
});
for (const id of Object.keys(expected)) {
  test(`엔진: ${id}`, () => {
    assert.deepStrictEqual(got[id], expected[id], 'HTML v0.4.11 엔진과 값이 달라요');
    const p = props[id]; assert.ok(p, '성질 확인이 없어요: ' + id); p(got[id]);
  });
}
