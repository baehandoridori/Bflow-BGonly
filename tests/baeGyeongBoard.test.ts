import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dimsFor, dragGuide, frameGeo, guideCtl, guideFor, guideHit, guideScene, tiltLabel, tiltStep, turn, unturn, withGuideParam, type Geo, type GuideOp,
} from '../src/features/bae-gyeong/make/board/guideMath.ts';
import { fitNotes, noteAt, noteBox, notesSummary, noteWidth, ratioFit, textSizeFor, type BoardNote } from '../src/features/bae-gyeong/make/board/notesMath.ts';
import { applyFillMask, floodMask, grow, hasColorOf, hexToRgb, paintShareOf, rgbToHex, scanFill } from '../src/features/bae-gyeong/make/board/fillMath.ts';
import { CORRIDOR_STEPS, type GuideState, type PerspectiveId } from '../src/shared/bae/order/constants.ts';

const TYPES: PerspectiveId[] = ['auto', 'flat', '1p', 'corridor', '2p', '3pu', '3pd'];
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const measure = (text: string, font: string) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.6; // 시험용 어림 폭

// HTML v0.4.11 script_4.js 54줄과 543~547줄을 그대로 옮겨 적은 것 (constants.ts 가 아니라 HTML 을 기준으로)
const HTML_GUIDE_DEFAULTS: Record<string, Record<string, number>> = { auto: { hy: .5 }, flat: { hy: .5 }, '1p': { hy: .5, v1: .5 }, corridor: { hy: .5, v1: .5, depth: .16 }, '2p': { hy: .55, v1: -.6, v2: 1.6, cx: .42, ct: .14, cb: .86 }, '3pu': { hy: .82, v1: -.6, v2: 1.6, v3: -.9 }, '3pd': { hy: .16, v1: -.6, v2: 1.6, v3: 1.9 } };
function htmlSetGuideType(type: string) {
  const d = HTML_GUIDE_DEFAULTS[type] || HTML_GUIDE_DEFAULTS.auto; const pick = (k: string, dv: number) => d[k] == null ? dv : d[k];
  return { type, placed: false, hy: d.hy, v1: pick('v1', .5), v2: pick('v2', 1.6), v3: pick('v3', -.9), depth: pick('depth', .16), cx: pick('cx', .42), ct: pick('ct', .14), cb: pick('cb', .86) };
}

test('setGuideType: the seven guide types start where the HTML puts them', () => {
  for (const t of TYPES) assert.deepEqual(guideFor(t), htmlSetGuideType(t), t);
  assert.deepEqual(guideFor('2p'), { type: '2p', placed: false, hy: 0.55, v1: -0.6, v2: 1.6, v3: -0.9, depth: 0.16, cx: 0.42, ct: 0.14, cb: 0.86 });
  assert.equal(guideFor('3pd').v3, 1.9);
  assert.equal(guideFor('3pu').hy, 0.82);
});

test('setGuideParam: spread keeps the middle, depth picks one of ten steps, use only switches placed', () => {
  const g = guideFor('2p');
  const s = withGuideParam(g, 'spread', 3);
  assert.ok(near(s.v1, -1) && near(s.v2, 2) && s.placed, JSON.stringify(s));
  assert.ok(near((s.v1 + s.v2) / 2, (g.v1 + g.v2) / 2));
  assert.equal(g.placed, false, 'the old state is not touched');
  const c = guideFor('corridor');
  assert.equal(withGuideParam(c, 'depth', 8).depth, CORRIDOR_STEPS[7]);
  assert.equal(withGuideParam(c, 'depth', 3.4).depth, 0.25);
  assert.equal(withGuideParam(c, 'depth', 0).depth, 0.42, 'below 1 = the shortest');
  assert.equal(withGuideParam(c, 'depth', 99).depth, 0.045, 'above 10 = the longest');
  assert.equal(withGuideParam(c, 'depth', 5).placed, true);
  const u = withGuideParam(c, 'use', true);
  assert.deepEqual({ ...u, placed: false }, c);
  assert.equal(u.placed, true);
  assert.equal(withGuideParam(u, 'use', false).placed, false);
});

test('dragging a handle stays inside the HTML ranges', () => {
  const g = guideFor('2p');
  assert.equal(dragGuide(g, g, 'hz', 0, 9).hy, 2.5);
  assert.equal(dragGuide(g, g, 'hz', 0, -9).hy, -1.5);
  assert.ok(near(dragGuide(g, g, 'hz', 5, 0.1).hy, 0.65));
  const v = dragGuide(g, g, 'v1', -20, 0.2);
  assert.equal(v.v1, -6); assert.ok(near(v.hy, 0.75));
  assert.equal(dragGuide(g, g, 'v2', 20, 0).v2, 7);
  assert.equal(dragGuide(guideFor('3pu'), guideFor('3pu'), 'v3', 0, -20).v3, -6);
  assert.equal(dragGuide(guideFor('3pd'), guideFor('3pd'), 'v3', 0, 20).v3, 7);
  assert.equal(dragGuide(g, g, 'cx', 5, 0).cx, 1.3);
  assert.equal(dragGuide(g, g, 'cx', -5, 0).cx, -0.3);
  const ct = dragGuide(g, g, 'ct', 0.1, 5);
  assert.ok(near(ct.ct, g.cb - 0.04)); assert.ok(near(ct.cx, 0.52));
  assert.equal(dragGuide(g, g, 'ct', 0, -5).ct, -1.5);
  assert.ok(near(dragGuide(g, g, 'cb', 0, -5).cb, g.ct + 0.04));
  assert.equal(dragGuide(g, g, 'cb', 0, 5).cb, 2.5);
  assert.equal(dragGuide(g, g, 'hz', 0, 0.1).placed, false, 'Board turns placed on (with the notice), not the math');
  // the drag is measured from where it started (g0), not from the last move
  const mid = dragGuide(g, g, 'v1', 0.3, 0);
  assert.ok(near(dragGuide(g, mid, 'v1', 0.5, 0).v1, g.v1 + 0.5));
});

test('the side controls follow the guide (labels at their HTML edges)', () => {
  const at = (v1: number, v2: number) => guideCtl({ ...guideFor('2p'), v1, v2 });
  assert.equal(at(0, 1.5).spreadLabel, '강하게');
  assert.equal(at(0, 1.51).spreadLabel, '보통');
  assert.equal(at(0, 2.79).spreadLabel, '보통');
  assert.equal(at(0, 2.8).spreadLabel, '약하게');
  assert.equal(at(0, 0.3).spread, 0.8); assert.equal(at(0, 9).spread, 5);
  assert.equal(guideCtl(guideFor('2p')).spreadLabel, '보통', '2p starts at 2.2');
  const step = (n: number) => guideCtl(withGuideParam(guideFor('corridor'), 'depth', n));
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => step(n).depthLabel), ['짧게', '짧게', '짧게', '보통', '보통', '길게', '길게', '아주 길게', '아주 길게', '아주 길게']);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => step(n).depthStep), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(guideCtl(guideFor('corridor')).depthStep, 5, 'the default .16 is step 5');
  for (const t of TYPES) {
    const c = guideCtl(guideFor(t));
    assert.equal(c.showSpread, t === '2p' || t === '3pu' || t === '3pd', t);
    assert.equal(c.showDepth, t === 'corridor', t);
    assert.equal(c.showUse, t !== 'auto', t); assert.equal(c.showLegend, t !== 'auto', t);
    assert.equal(c.showCornerKey, t === '2p', t);
  }
  assert.equal(guideCtl({ ...guideFor('1p'), placed: true }).useOn, true);
});

test('the paper is laid out with wider margins for two- and three-point guides', () => {
  const wide = frameGeo(1000, 600, 1536, 864, '2p', true);
  assert.ok(near(wide.s, 700 / 1536)); assert.ok(near(wide.fx, 150)); assert.ok(near(wide.fw, 700));
  assert.ok(near(wide.fy, (600 - 864 * 700 / 1536) / 2));
  const plain = frameGeo(1000, 600, 1536, 864, '1p', true);
  assert.ok(near(plain.s, Math.min(900 / 1536, 540 / 864)));
  assert.deepEqual(frameGeo(1000, 600, 1536, 864, '3pd', false), plain, 'a hidden guide needs no room');
  const small = frameGeo(300, 200, 1536, 864, 'auto', true);
  assert.ok(near(small.s, Math.min((300 - 56) / 1536, (200 - 56) / 864)), 'at least 28px around');
});

test('ratios give the HTML board sizes', () => {
  assert.deepEqual(['16:9', '2:1', '3:1', '3:2', '4:3', '1:1', '9:16'].map((r) => dimsFor(r)), [[1536, 864], [1536, 768], [1536, 512], [1536, 1024], [1536, 1152], [1536, 1536], [864, 1536]]);
});

test('screen tilt: half degrees from -15 to 15, and its label', () => {
  assert.equal(tiltStep(7.3), 7.5); assert.equal(tiltStep(7.2), 7); assert.equal(tiltStep(-20), -15); assert.equal(tiltStep('x'), 0); assert.equal(tiltStep(15.4), 15);
  assert.equal(tiltLabel(0), '0° (수평)'); assert.equal(tiltLabel(7), '+7° (오른쪽이 올라감)'); assert.equal(tiltLabel(-3.5), '-3.5° (왼쪽이 올라감)');
  const geo: Geo = { fx: 100, fy: 50, fw: 800, fh: 450, s: 0.52 };
  const p = { sx: 333, sy: 111 };
  const back = unturn(turn(p, 7, geo), 7, geo);
  assert.ok(near(back.sx, p.sx) && near(back.sy, p.sy));
  assert.deepEqual(unturn(p, 0, geo), p);
  const c = { sx: 500, sy: 275 }; const cc = unturn(c, 12, geo); assert.ok(near(cc.sx, 500) && near(cc.sy, 275), 'the middle does not move');
});

const GEO: Geo = { fx: 60, fy: 40, fw: 880, fh: 495, s: 880 / 1536 };
const lines = (ops: GuideOp[]) => ops.filter((o) => o.k === 'line');
const chips = (ops: GuideOp[]) => ops.filter((o) => o.k === 'chip').map((o) => (o as Extract<GuideOp, { k: 'chip' }>).text);

test('guide lines: how many, which labels, which handles, for each type', () => {
  const sc = (t: PerspectiveId, g: Partial<GuideState> = {}, tilt = 0) => guideScene({ ...guideFor(t), ...g }, GEO, 1000, 575, tilt, measure);
  assert.deepEqual(sc('auto').ops, []); assert.equal(sc('auto').rot, null);
  const lvl = sc('auto', {}, 7);
  assert.equal(lvl.ops.length, 1); assert.equal(lvl.ops[0].k, 'level');
  assert.equal((lvl.ops[0] as Extract<GuideOp, { k: 'level' }>).text, '기울기 7° · 이 선이 러프의 지평선과 나란하게');
  assert.ok(lvl.rot && near(lvl.rot.rad, -7 * Math.PI / 180) && near(lvl.rot.cx, 500));
  const flat = sc('flat');
  assert.equal(lines(flat.ops).length, 1); assert.deepEqual(chips(flat.ops), ['지평선 50%']); assert.deepEqual(flat.handles.map((h) => h.id), ['hz']);
  const p1 = sc('1p');
  assert.equal(lines(p1.ops).length, 28 + 1); assert.deepEqual(p1.handles.map((h) => h.id), ['v1', 'hz']);
  assert.ok(near(p1.handles[0].x!, 60 + 440) && near(p1.handles[0].y!, 40 + 247.5));
  const co = sc('corridor');
  assert.equal(lines(co.ops).length, 6 + 4 + 4 + 6 * 4 + 4 + 1);
  const p2 = sc('2p');
  assert.equal(lines(p2.ops).length, 18 * 2 + 4 + 1 + 1);
  assert.deepEqual(chips(p2.ops), ['모서리 42%', '지평선 45%']);
  assert.deepEqual(p2.handles.map((h) => h.id), ['ct', 'cb', 'cx', 'v1', 'v2', 'hz']);
  const v1 = p2.handles.find((h) => h.id === 'v1')!;
  assert.equal(v1.x, 10, 'a vanishing point off the stage sits at the edge');
  assert.ok(p2.ops.some((o) => o.k === 'glyph' && o.text === '◀'));
  assert.ok(p2.ops.some((o) => o.k === 'glyph' && o.text === '▶'));
  assert.ok(p2.ops.some((o) => o.k === 'line' && o.c === '#E8603C' && o.w === 3), 'the coral corner line');
  const up = sc('3pu');
  assert.equal(lines(up.ops).length, 18 * 2 + 17 + 1); assert.deepEqual(chips(up.ops), ['지평선 18%']);
  assert.deepEqual(up.handles.map((h) => h.id), ['v1', 'v2', 'v3', 'hz']);
  const dn = sc('3pd'); assert.deepEqual(chips(dn.ops), ['지평선 84%']);
  assert.equal(dn.handles.find((h) => h.id === 'v3')!.y, 575 - 10);
  // a label near the edge stays on the stage
  const lowHz = sc('1p', { hy: 2.4 }); const ch = lowHz.ops.find((o) => o.k === 'chip') as Extract<GuideOp, { k: 'chip' }>;
  assert.equal(ch.y, 575 - 22);
});

test('guideHit: corner points first, then vanishing points, the corner line, the horizon', () => {
  const sc = guideScene(guideFor('2p'), GEO, 1000, 575, 0, measure);
  const h = (id: string) => sc.handles.find((x) => x.id === id)!;
  assert.equal(guideHit(sc.handles, { sx: h('ct').x!, sy: h('ct').y! }), 'ct');
  assert.equal(guideHit(sc.handles, { sx: h('cb').x! + 5, sy: h('cb').y! - 5 }), 'cb');
  assert.equal(guideHit(sc.handles, { sx: h('v2').x!, sy: h('v2').y! }), 'v2');
  assert.equal(guideHit(sc.handles, { sx: h('cx').x! + 4, sy: (h('cx').top! + h('cx').bot!) / 2 }), 'cx');
  assert.equal(guideHit(sc.handles, { sx: 300, sy: h('hz').y! + 6 }), 'hz');
  assert.equal(guideHit(sc.handles, { sx: 300, sy: h('hz').y! + 12 }), null);
  assert.equal(guideHit([], { sx: 0, sy: 0 }), null, 'a hidden guide has no handles');
});

test('notes: boxes, picking, the PD summary and fitting into a new ratio', () => {
  const notes: BoardNote[] = [
    { type: 'mark', pts: [[100, 100], [200, 150], [300, 120]], w: 7 },
    { type: 'arrow', x1: 400, y1: 400, x2: 600, y2: 300, w: 7 },
    { type: 'text', x: 700, y: 500, text: '창문\n여기', size: 40 },
  ];
  assert.deepEqual(noteBox(notes[0], measure), { x: 93, y: 93, w: 214, h: 64 });
  assert.deepEqual(noteBox(notes[1], measure), { x: 383, y: 283, w: 234, h: 134 });
  const tb = noteBox(notes[2], measure); assert.equal(tb.h, 2 * 40 * 1.22); assert.equal(tb.w, 2 * 40 * 0.6, "the widest line");
  assert.equal(noteAt(notes, { x: 500, y: 352 }, measure), notes[1]);
  assert.equal(noteAt(notes, { x: 705, y: 505 }, measure), notes[2]);
  assert.equal(noteAt(notes, { x: 1000, y: 10 }, measure), null);
  assert.equal(notesSummary(notes, 1536, 864, measure),
    '- circled or marked area around (x 13%, y 14%), about 14% wide and 7% tall\n- arrow from (x 26%, y 46%) to (x 39%, y 35%)\n- text "창문 여기" at (x 46%, y 58%)');
  assert.equal(notesSummary(notes.slice(1, 2), 1536, 864, measure, (x, y) => [1 - x, y]), '- arrow from (x 74%, y 46%) to (x 61%, y 35%)');
  const f = ratioFit(1536, 864, 864, 1536); assert.ok(near(f.s, 0.5625) && near(f.ox, 0) && near(f.oy, 525));
  const moved: BoardNote[] = JSON.parse(JSON.stringify(notes)); fitNotes(moved, f.s, f.ox, f.oy);
  assert.deepEqual((moved[1] as Extract<BoardNote, { type: 'arrow' }>).x1, 225); assert.ok(near((moved[1] as Extract<BoardNote, { type: 'arrow' }>).w, 7 * 0.5625));
  assert.ok(near((moved[2] as Extract<BoardNote, { type: 'text' }>).size, 22.5));
  assert.deepEqual((moved[0] as Extract<BoardNote, { type: 'mark' }>).pts[0], [56.25, 581.25]);
  assert.deepEqual([4, 10, 24, 7].map(noteWidth), [5, 7, 11, 7]);
  assert.deepEqual([4, 10, 24, 7].map(textSizeFor), [28, 40, 64, 40]);
});

/* 20×20 흰 종이에 검은 네모 테두리, 오른쪽 변에 2칸 틈 */
function boxWithGap() {
  const W = 20, H = 20, d = new Uint8ClampedArray(W * H * 4).fill(255);
  const ink = (x: number, y: number) => { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; };
  for (let i = 4; i <= 15; i++) { ink(i, 4); ink(i, 15); ink(4, i); if (i < 9 || i > 10) ink(15, i); }
  return { W, H, d };
}
const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

test('paint bucket: as is leaks through a gap, gap closing stays inside', () => {
  const { W, H, d } = boxWithGap();
  assert.equal(floodMask(d, W, H, 10, 10, [255, 255, 255], 0), null, 'same color = nothing to do');
  assert.equal(floodMask(d, W, H, -1, 10, [255, 0, 0], 0), null);
  const leak = floodMask(d, W, H, 10, 10, [255, 0, 0], 0)!;
  assert.equal(leak[0], 1, 'as is: the fill runs out of the box');
  const inside = floodMask(d, W, H, 10, 10, [255, 0, 0], 2)!;
  assert.equal(inside[0], 0, 'small gap closing: stays inside');
  assert.equal(inside[10 * W + 10], 1);
  assert.ok(count(inside) >= 8 * 8 && count(inside) <= 11 * 11, String(count(inside)));
  const paint = new Uint8ClampedArray(W * H * 4); applyFillMask(paint, inside, W, H, [233, 30, 99]);
  assert.deepEqual([...paint.slice((10 * W + 10) * 4, (10 * W + 10) * 4 + 4)], [233, 30, 99, 255]);
  assert.deepEqual([...paint.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(count(grow(new Uint8Array(25).fill(0).map((_, i) => (i === 12 ? 1 : 0)), 1, 5, 5)), 9);
  assert.equal(count(scanFill(new Uint8Array(16).fill(1), 0, 0, 4, 4)), 16);
});

test('colors: hex both ways, colored share and colorful paint', () => {
  assert.deepEqual(hexToRgb('#26251F'), [38, 37, 31]); assert.deepEqual(hexToRgb('nope'), [0, 0, 0]);
  assert.equal(rgbToHex(233, 30, 99), '#E91E63');
  const white = new Uint8ClampedArray(4 * 100).fill(255);
  assert.equal(paintShareOf(white), 0);
  const blue = new Uint8ClampedArray(4 * 100); for (let i = 0; i < 400; i += 4) { blue[i] = 40; blue[i + 1] = 120; blue[i + 2] = 220; blue[i + 3] = 255; }
  assert.equal(paintShareOf(blue), 1);
  assert.equal(hasColorOf(blue), false, 'needs more than 150 colored samples');
  const big = new Uint8ClampedArray(4 * 7 * 200); for (let i = 0; i < big.length; i += 4) { big[i] = 40; big[i + 1] = 120; big[i + 2] = 220; big[i + 3] = 255; }
  assert.equal(hasColorOf(big), true);
  const grey = big.map((v, i) => (i % 4 === 3 ? 255 : 128)); assert.equal(hasColorOf(grey), false);
});
