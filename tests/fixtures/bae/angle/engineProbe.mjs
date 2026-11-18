// BAE경 '다른 각도로' 엔진 값 시험의 '재는 쪽' (71개). 엔진(ANG)과 깊이 값을 받아 시험마다 값 묶음을 돌려준다.
// 같은 함수를 HTML v0.4.11 의 ANG(script_4.js 2755~3172줄 원본)에 돌려 expected.json 을 만들고, 시험은 Bflow 판 ANG 에 돌려 견준다.
// 시험 목록은 예전 엔진 시험(test_engine_node.mjs: v0.4.5 의 53개 + v0.4.8 9 + v0.4.9 5 + v0.4.10 4)과 같다. 파이썬 값 대신 HTML 엔진의 값
// (HTML 엔진은 그때 파이썬 값과 53/53 맞았다. 파이썬 기준 자료 pyref 는 이 PC 에 없다).
// D = { living, classroom, parking }: { disp: Float32Array, dw, dh }. hash(typedArray) → 16진 글.
export const PLACES = {
  living: { h: 1.2, hfov: 55, kind: 'interior', t: ['left20', 'right45', 'high', 'low'] },
  classroom: { h: 1.3, hfov: 60, kind: 'interior', t: ['left20', 'right45', 'high', 'low'] },
  parking: { h: 1.5, hfov: 50, kind: 'exterior', t: ['right45', 'high'] },
};
const r = (v) => (v == null ? v : JSON.parse(JSON.stringify(v, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x))));
export function probe(ANG, D, hash) {
  const out = {};
  const put = (id, v) => { if (id in out) throw new Error('dup ' + id); out[id] = r(v); };
  const sets = {};
  for (const [place, o] of Object.entries(PLACES)) {
    const d = D[place]; const S = ANG.build(d.disp, d.dw, d.dh, 2048, 1152, o); sets[place] = S;
    put(place + ': size and lens', { W: S.W, H: S.H, f: S.f, cx: S.cx, cy: S.cy, camH: S.camH, hfov: S.hfov, kind: S.kind });
    put(place + ': floor fit a, b', { fit: S.fit, fitOk: S.fitOk });
    for (const k of ['Zp', 'Zback', 'xmin', 'xmax']) put(place + ': ' + k, S[k]);
    put(place + ': mesh grid and triangles', { R: S.R, C: S.C, ntri: S.ntri, idx: hash(S.idx) });
    put(place + ': vertices', { pos: hash(S.pos), uv: hash(S.uv), ytop: S.ytop, vfov: S.vfov, pivot: S.pivot });
    const P = ANG.presets(S);
    for (const t of o.t) put(place + ': camera ' + t, { cam: P[t], info: ANG.info(S, P[t]), ko: ANG.ko(S, P[t]) });
  }
  const S = sets.living, P = ANG.presets(S);
  for (const t of ['left20', 'right45', 'high', 'low']) put('living: the ' + t + " sentence is the experiment's", ANG.sentence(S, P[t]));
  put("living: the whole order (right45) matches the experiment's", ANG.prompt(S, P.right45));
  // hand-placed cameras: the controls keep each other
  let cam = ANG.setOrbit(S, P.orig, 15);
  put('orbit 15 to the right from A: 15 degrees, same height, same distance', { cam, info: ANG.info(S, cam), sentence: ANG.sentence(S, cam), ko: ANG.ko(S, cam) });
  cam = ANG.setOrbit(S, P.orig, 25);
  put('orbit 25: the right wall is in the way, so it comes closer and keeps 25 degrees', { cam, info: ANG.info(S, cam), xmax: S.xmax, sentence: ANG.sentence(S, cam), ko: ANG.ko(S, cam) });
  cam = ANG.setHeight(S, cam, 3.0);
  put('height 3 m keeps the target, so it looks down', { cam, info: ANG.info(S, cam), sentence: ANG.sentence(S, cam) });
  cam = ANG.setPitch(S, cam, 0);
  put('tilt back to level', { cam, info: ANG.info(S, cam) });
  cam = ANG.setDist(S, cam, 0.6);
  put('closer: 60 % of the distance', { cam, info: ANG.info(S, cam), sentence: ANG.sentence(S, cam), ko: ANG.ko(S, cam) });
  cam = ANG.setOrbit(S, P.orig, 80);
  put('orbit 80: the camera stays inside the room (x clamped)', { cam, info: ANG.info(S, cam), sentence: ANG.sentence(S, cam), xmax: S.xmax });
  put('A is A', { a: ANG.near(S, P.orig), r20: ANG.near(S, P.right20) });
  put('fixCam keeps a camera in its room and the target in front', { far: ANG.fixCam(S, { pos: [99, 99, 99], target: [0, 0, 0] }), L: ANG.limits(S) });
  const V = ANG.birdView(S, 800, 450), pa = V.project([0, 0, 0]), pp = V.project(S.pivot);
  put('the bird view sees camera A and the middle of the room', { pa, pp, eye: V.eye, tgt: V.tgt, mvp: V.mvp });
  put('a pointer on camera A meets the eye level at A', ANG.hitY(V, pa[0], pa[1], 0));
  // a picture of another shape (3:2, portrait, square) builds without trouble
  for (const [w, h] of [[1536, 1024], [1152, 2048], [1024, 1024]]) {
    const s = ANG.build(D.living.disp, D.living.dw, D.living.dh, w, h, {}); const [W, H] = ANG.workSize(w, h);
    put(`${w}x${h}: builds (work ${W}x${H}, mesh to the edges)`, { W: s.W, H: s.H, R: s.R, C: s.C, ntri: s.ntri, Zp: s.Zp, uvEnd: [s.uv[s.uv.length - 2], s.uv[s.uv.length - 1]], pos: hash(s.pos) });
  }
  { const bad = new Float32Array(518 * 518).fill(3); const s = ANG.build(bad, 518, 518, 2048, 1152, {}); put('a flat disparity (no floor) does not break: a plain scale', { Zp: s.Zp, ntri: s.ntri, fitOk: s.fitOk, fit: s.fit }); }
  // v0.4.8 카메라 빼기 · 8장 · PD메모
  put('v0.4.8: where B may stand (stage, limits)', { living: { stage: ANG.stage(S), limits: ANG.limits(S) }, parking: { stage: ANG.stage(sets.parking), limits: ANG.limits(sets.parking) } });
  { const c = ANG.setDist(S, P.orig, 2.5); put('v0.4.8: distance 250 % goes straight back behind A', { cam: c, info: ANG.info(S, c), sentence: ANG.sentence(S, c), ko: ANG.ko(S, c), zmax: ANG.stage(S).zmax }); }
  { const S2 = Object.assign({}, S, { ext: { xmin: S.xmin - 2, xmax: S.xmax + 1, zmax: 14 } }); const c = ANG.fixCam(S2, { pos: [99, 0, 99], target: [0, 0, -3] });
    put("v0.4.8: an added picture's camera widens the room", { stage: ANG.stage(S2), limits: ANG.limits(S2), cam: c, before: ANG.limits(S) }); }
  { const c = ANG.fixCam(S, { pos: [0, 0, -2], target: [0.3, 0, 40] }); put('v0.4.8: B may look at the room behind A', { cam: c, info: ANG.info(S, c), sentence: ANG.sentence(S, c) }); }
  { const far = ANG.setDist(S, P.orig, 2.5), more = [far.pos, [far.pos[0], -S.camH, far.pos[2]], [S.xmax + 1, 0, 6]]; const B = ANG.birdView(S, 800, 500, more);
    put('v0.4.8: the map takes every camera in', { eye: B.eye, tgt: B.tgt, pts: more.map((q) => B.project(q)) }); }
  { const hand = ANG.setDist(S, ANG.setOrbit(S, P.orig, -25), 1.4); const o = {};
    for (const n of [0, 1, 2, 3, 4]) { o['right45 n' + n] = ANG.prompt(S, P.right45, { n }); o['hand n' + n + ' notes'] = ANG.prompt(S, hand, { n, notes: true }); }
    put("v0.4.8: with no notes and up to 4 pictures the order is v0.4.7's", o); }
  put('v0.4.8: the order for 8 added pictures', ANG.prompt(S, P.left20, { n: 8, notes: true }));
  put('v0.4.8: the PD sentence goes after the brush sentence', ANG.prompt(S, P.right20, { n: 1, notes: true, memo: { pd: '  Continue the window frame into the grey gap on the right;\n keep the wall corner straight' } }));
  put('v0.4.8: when the PD cannot read the notes, the notes go as they are', ANG.prompt(S, P.high, { memo: { raw: ['"창문 이어서" at (x 80%, y 40%)', 'something pointed at from (x 10%, y 20%) to (x 30%, y 25%)'] } }));
  // v0.4.9 가까이 잡은 샷
  put('v0.4.9: from A the part is the whole picture', ANG.part(S, P.orig));
  { const c = ANG.setDist(S, P.orig, 0.5); put('v0.4.9: at 50 % of the distance the part is about the middle third', { cam: c, part: ANG.part(S, c) }); }
  { const close = ANG.setDist(S, P.orig, 0.5), turned = ANG.setDist(S, ANG.setOrbit(S, P.orig, 20), 0.5), o = {};
    for (const k of ['left45', 'right20', 'high', 'low', 'orig']) o[k] = ANG.tightOf(S, P[k], ANG.part(S, P[k]));
    o.close = ANG.tightOf(S, close, ANG.part(S, close)); o.turned20 = ANG.tightOf(S, turned, ANG.part(S, turned)); const vp = ANG.vpCam(S, [0.3, 0]); o.vp = ANG.tightOf(S, vp, ANG.part(S, vp));
    put('v0.4.9: a closer shot is only a hand camera, nearer and turned less than 15 degrees', o); }
  { const close = ANG.setDist(S, P.orig, 0.5), o = {}; for (const [k, c] of Object.entries({ close, r45: P.right45, hand: ANG.setOrbit(S, P.orig, 30) })) { o[k + ' sentence'] = ANG.sentence(S, c); o[k + ' order'] = ANG.prompt(S, c, { n: 1 }); }
    put("v0.4.9: without the box the order and the camera sentence are v0.4.8's", o); }
  { const close = ANG.setDist(S, P.orig, 0.5); put("v0.4.9: the closer shot's order", { n0: ANG.prompt(S, close, { crop: true }), n1: ANG.prompt(S, close, { crop: true, n: 1, notes: true }), n3: ANG.prompt(S, close, { crop: true, n: 3, memo: { pd: 'A rug.' } }), sentence: ANG.sentence(S, close, { tight: true }) }); }
  // v0.4.10 밑면 · 0.15m
  put('v0.4.10: heights under 1 m to the nearest 5 cm', [0.12, 0.15, 0.17, 0.4, 0.62, 0.97, 0.975, 1.2, 2.66].map((h) => ANG.mKo(h)));
  { const c = ANG.vpCam(S, [0, -1]); put('v0.4.10: the floor end shows 0.15 m', { cam: c, ko: ANG.ko(S, c), sentence: ANG.sentence(S, c), eye: c.pos[1] + S.camH }); }
  { const close = ANG.setDist(S, P.orig, 0.5), vp = ANG.vpCam(S, [-0.34, 0.2]), hand = ANG.setOrbit(S, P.orig, -18), o = {};
    for (const [k, c, x] of [['button', P.right45, {}], ['vp', vp, { n: 1 }], ['tight', close, { crop: true }], ['hand', hand, { notes: true }]]) { o[k] = ANG.prompt(S, c, x); o[k + ' under false'] = ANG.prompt(S, c, Object.assign({ under: false }, x)); }
    put("v0.4.10: without undersides the order is v0.4.9's (button, vp, tight, hand)", o); }
  { const close = ANG.setDist(S, P.orig, 0.5); put('v0.4.10: the underside sentence comes right after image 1', { a: ANG.prompt(S, ANG.vpCam(S, [0, -1]), { under: true }), b: ANG.prompt(S, close, { crop: true, under: true, notes: true, memo: { pd: 'x' } }), c: ANG.prompt(S, P.low, { n: 2, under: true, memo: { raw: ['"a" at (x 1%, y 2%)'] } }) }); }
  return out;
}

/** 깊이 값 견본 풀기: 259x259, 줄마다 앞 값과의 차(uint16, brotli). 값 = mn + q (mx - mn) / 65535 (Float32). */
export function decodeDisp(buf, meta, zlib) {
  const raw = zlib.brotliDecompressSync(buf); const dl = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2); const n = meta.n, q = new Uint16Array(dl.length);
  for (let i = 0; i < dl.length; i++) q[i] = (dl[i] + (i % n ? q[i - 1] : (i >= n ? q[i - n] : 0))) & 0xffff;
  const d = new Float32Array(q.length); for (let i = 0; i < q.length; i++) d[i] = meta.mn + q[i] * (meta.mx - meta.mn) / 65535;
  return { disp: d, dw: n, dh: n };
}
