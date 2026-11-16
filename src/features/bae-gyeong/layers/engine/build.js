/* BAE layer engine, step 'layers' (port of t5_build.py, round 5 of the Python prototype).
   In:  the finished picture, the empty background (plate), each prop's outline (SAM), who stands in front of whom,
        GPT's 'front removed' pictures and the whole-member templates (whole.js).
   Out: one RGBA layer per prop (cropped to its box), the empty background, a fix-up layer, and the folder order.
   What each part does, in plain words:
   OWNER   : under a desk you see the chair's legs and seat edge. The whole chair template is fitted onto every chair,
             and pixels of the template's color inside it are the chair's, even where they are seen through the desk.
   FLOOR   : floor/shadow seen through a desk goes when it has the empty background's color right there.
   SHADOW  : see-through dark layer; thin floor-board lines are not shadow.
   LEFTOVER: bits the empty background drew differently that look like floor/wall go to 'BG 보정', never into a prop. */
import * as I from './img.js';
import * as B from './bm.js';
import { backgroundParts, place, compatMap, takeAreas, cropRGB, cropI32, regions, minDist, labMedian } from './templates.js';
import { depthGraph, exclusive, groupsOf, innerPointBM } from './whole.js';

export async function buildLayers(ctx) {
  const { W, H, orig, plate, objs: objs0, ms, frontOf, see, edits = [], templates = {}, sam = null, log = () => {}, progress = () => {} } = ctx; const placeFn = ctx.placeFn || place;
  const N = W * H; const objs = objs0.map(o => ({ ...o })); let n = objs.length;
  const T0 = Date.now(); const tick = (s) => log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${s}`);
  const PL = plate; const rep = {};
  const Vof = (img) => { const v = new Uint8Array(N); for (let i = 0; i < N; i++) v[i] = Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]); return v; };
  const Vo = Vof(orig), Vp = Vof(PL);
  const FRONT_OF = {}; for (const [k, v] of Object.entries(frontOf)) FRONT_OF[+k] = new Set(v);
  const FRONT = new Set(), HID = new Set(); for (const e of edits) { for (const i of e.remove) FRONT.add(i); for (const j of e.keep || []) HID.add(j); }

  /* ---- small helpers on box masks ---- */
  const fullOf = (a) => B.toFull(a, W, H);
  function fillHoles(m, lim, keep = null) {          // holes (8-connected, as the prototype's cv2 call really was) up to lim px
    if (m.empty) return m; const b = m.box(), cw = b[2] - b[0], ch = b[3] - b[1]; const sub = B.crop(m, b);
    const inv = new Uint8Array(cw * ch); for (let i = 0; i < inv.length; i++) inv[i] = sub[i] ^ 1;
    const { lab, n: k, stats } = I.components(inv, cw, ch, 8); const out = sub.slice(); let changed = false;
    for (let c = 1; c <= k; c++) {
      const [a, x0, y0, x1, y1] = stats[c];
      if (a > lim || x0 === 0 || y0 === 0 || x1 >= cw || y1 >= ch) continue;
      const hole = new Uint8Array(cw * ch); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (lab[y * cw + x] === c) hole[y * cw + x] = 1;
      if (keep && !keep(B.fromCrop(hole, b))) continue;
      for (let i = 0; i < hole.length; i++) if (hole[i]) out[i] = 1; changed = true;
    }
    return changed ? B.fromCrop(out, b) : m;
  }
  function nearestColor(src, inner, box) {           // per pixel of box: the color of the nearest inner pixel (src: getter crop)
    const cw = box[2] - box[0], ch = box[3] - box[1]; const notIn = new Uint8Array(cw * ch).fill(1);
    const ic = B.crop(inner, box); for (let i = 0; i < ic.length; i++) if (ic[i]) notIn[i] = 0;
    const { idx } = I.edt(notIn, cw, ch, true); const out = new Float32Array(cw * ch * 3);
    for (let i = 0; i < cw * ch; i++) { const j = idx[i]; out[i * 3] = src[j * 3]; out[i * 3 + 1] = src[j * 3 + 1]; out[i * 3 + 2] = src[j * 3 + 2]; }
    return out;
  }
  function refine(m, srcimg) {                       // grow 2 px for the ink line, then drop OUTER-edge pixels that look like the empty background and not like the object
    const mf = fillHoles(m, Math.max(300, .02 * B.count(m)));
    const g = B.dil(m, 2, W, H); const emf = B.ero(mf, 3, W, H); const inner = B.and(emf, m);
    if (!B.any(inner)) return g;
    const box = g.box(), cw = box[2] - box[0], ch = box[3] - box[1];
    const sc = cropRGB(srcimg, W, box), pc = cropRGB(PL, W, box), nc = nearestColor(sc, inner, box);
    const gd = B.crop(g, box), ed = B.crop(emf, box); const out = gd.slice();
    for (let i = 0; i < cw * ch; i++) {
      if (!gd[i] || ed[i]) continue;                 // edge = g & ~ero(mf, 3)
      let dbg = 0, dfg = 0; for (let c = 0; c < 3; c++) { dbg = Math.max(dbg, Math.abs(sc[i * 3 + c] - pc[i * 3 + c])); dfg = Math.max(dfg, Math.abs(sc[i * 3 + c] - nc[i * 3 + c])); }
      if (dbg < 18 && dfg > dbg + 12) out[i] = 0;
    }
    return B.fromCrop(out, box);
  }
  function shadowOf(m, Vsrc, othersFull, limitFull = null) {
    const bb = m.box(); if (!bb) return new B.BM(); const [x0, y0, x1, y1] = bb; const h = y1 - y0;
    const ext = [Math.max(0, x0 - 20), y1 - 1, Math.min(W, x1 + 20), Math.min(H, y1 + Math.max(20, Math.floor(h / 6)))];
    const box = B.boxPad(B.boxUnion(B.boxPad(bb, 36 + 1, W, H), ext), 10, W, H); const cw = box[2] - box[0], ch = box[3] - box[1];
    const md = B.crop(m, box); const zone = I.dil(md, cw, ch, 36);
    for (let y = ext[1]; y < ext[3]; y++) for (let x = ext[0]; x < ext[2]; x++) zone[(y - box[1]) * cw + x - box[0]] = 1;
    const dark = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x, gi = (y + box[1]) * W + x + box[0];
      if (zone[i] && (othersFull[gi] || md[i] || (limitFull && !limitFull[gi]))) zone[i] = 0;
      if (zone[i] && Vp[gi] - Vsrc[gi] > 10) dark[i] = 1;
    }
    const dk = I.open(dark, cw, ch, I.ellipse(3)); const out = new Uint8Array(cw * ch);
    const { lab, n: k, stats } = I.components(dk, cw, ch, 8); const md4 = I.dil(md, cw, ch, 4);
    for (let c = 1; c <= k; c++) {
      const [a, cx0, cy0, cx1, cy1] = stats[c]; if (a < 60) continue;
      let touch = false, sy = 0;
      // (dil(c, 4) & m).any() == c touches dil(m, 4)
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { const i = y * cw + x; if (lab[i] !== c) continue; sy += y; if (md4[i]) touch = true; }
      if (!touch) continue;
      if (sy / a + box[1] < y0 + .6 * h) continue;   // a shadow lies on the ground at the object's foot, not beside its top
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) if (lab[y * cw + x] === c) out[y * cw + x] = 1;
    }
    const cl = I.close(out, cw, ch, I.ellipse(3)); for (let i = 0; i < cl.length; i++) cl[i] &= zone[i];
    return B.fromCrop(cl, box);
  }

  /* ---- names, depth ---- */
  const seenNames = {};
  objs.forEach((o, i) => { const nm = o.name; seenNames[nm] = (seenNames[nm] || 0) + 1; o.name = seenNames[nm] === 1 ? nm : `${nm} (${seenNames[nm]})`; o.key = 'p' + String(i).padStart(2, '0'); });
  objs.forEach((o, i) => { const b = ms[i].box(); o.bottom = b ? b[3] - 1 : 0; });
  function rankOrder(nn) {
    const left = new Set([...Array(nn).keys()]); const out = [];
    while (left.size) {
      const ready = [...left].sort((a, b) => a - b).filter(i => ![...(FRONT_OF[i] || [])].some(j => left.has(j)));
      const pool = ready.length ? ready : [...left].sort((a, b) => a - b);
      let i = pool[0]; for (const k of pool) if (objs[k].bottom < objs[i].bottom) i = k;
      out.push(i); left.delete(i);
    }
    return out;
  }
  const RANK = {}; rankOrder(n).forEach((i, r) => { RANK[i] = r; });
  const { ancestors } = depthGraph(n, FRONT_OF);
  const groups = groupsOf(objs);
  const SEE = see;
  const allm = new Uint8Array(N); for (const m of ms) B.orInto(allm, m, W);
  const excl = exclusive(ms, W, H);
  const SEG = I.felzenszwalb(orig, W, H, 30, 8); tick(`flat color areas: ${SEG.count}`);
  progress('flat');

  /* ---- 1. GPT's whole member as the template of its group, fitted onto every member ---- */
  const placed = new Map(), OK = new Map(), ZONE = new Map(), TPL_INFO = {};
  const unionOf = (ids, arr) => B.union(ids.map(i => arr[i]));
  function fitGroup(g, Tm, Trgb, tw, th, members, Vsel, Osel, scales, tag) {
    for (const j of members) {
      const V = Vsel(j); if (B.count(V) < 100) continue;
      const r = placeFn(Tm, Trgb, tw, th, V, Osel(j), orig, W, H, { scales, name: objs[j].name });
      if (!r || r.color_diff > 30) { log(`  ${objs[j].name}: template does not fit`); continue; }
      r.tag = tag; placed.set(j, r); const cm = compatMap(r.M, r.C, orig, W, H); OK.set(j, cm.ok); ZONE.set(j, cm.zone);
      log(`  ${objs[j].name}: scale ${r.scale} at ${r.x},${r.y} cover ${r.cover} agree ${r.agree} color ${r.color_diff}`);
    }
  }
  for (const [g, t] of Object.entries(templates)) {
    if (!groups.has(g)) continue;
    TPL_INFO[g] = { from: t.name, kind: 'GPT whole', edit: t.edit }; log(`template ${g} <- ${t.name}`);
    fitGroup(g, t.Tm, t.Trgb, t.tw, t.th, groups.get(g), (j) => B.count(excl[j]) > 300 ? excl[j] : ms[j],
      (j) => { const a = ancestors(j); return a.size ? unionOf([...a], ms) : new B.BM(); }, [.6, 1.45], 'gpt');
    progress('fit');
  }
  tick('templates fitted');

  /* ---- 2. what each object may show ---- */
  const A = ms.map(m => m);
  const groupOk = (g) => { const u = new Uint8Array(N); for (const j of groups.get(g)) if (OK.has(j)) B.orInto(u, OK.get(j), W); return u; };
  for (const g of Object.keys(templates)) {
    if (!groups.has(g)) continue; const oku = groupOk(g);
    for (const j of groups.get(g)) if (placed.has(j)) A[j] = takeAreas(ZONE.get(j), oku, SEG, W, H);  // a member = what its template explains
  }
  // see-through objects in front of a template member give up what that member's template explains (legs under a desk),
  // and areas that have only the member's own colors (the dark seat edge right under the desk)
  const given = {};
  for (let F = 0; F < n; F++) {
    if (!SEE.has(objs[F].group) || placed.has(F)) continue;
    const behind = [...placed.keys()].filter(j => ancestors(j).has(F)); if (!behind.length) continue;
    const before = B.count(A[F]);
    for (const j of behind) A[F] = B.andNot(A[F], A[j]);
    const xs = B.andNot(excl[F], B.dil(B.union(behind.map(j => placed.get(j).M)), 10, W, H));
    if (B.count(xs) > 200) {
      // the front object's main colors (a color covering < 6% of what only it shows is left out: SAM's own mistakes)
      const px = []; for (let y = 0; y < xs.h; y++) for (let x = 0; x < xs.w; x++) if (xs.d[y * xs.w + x]) { const gi = (y + xs.y0) * W + x + xs.x0; px.push(orig[gi * 3], orig[gi * 3 + 1], orig[gi * 3 + 2]); }
      const km = I.kmeans(Float32Array.from(px), 3, 8, { seed: 101 + F }); const share = new Float64Array(8); const np_ = px.length / 3;
      for (let i = 0; i < np_; i++) share[km.labels[i]]++;
      const keepC = []; for (let c = 0; c < km.centers.length / 3; c++) if (share[c] / np_ >= .06) keepC.push(km.centers[c * 3], km.centers[c * 3 + 1], km.centers[c * 3 + 2]);
      const fpal = I.labOfFloat(Float32Array.from(keepC));
      for (const j of behind) {
        const pj = placed.get(j); const tpal = I.labOfFloat(I.kcenters(pickC(pj), 8));
        const own = []; for (let k = 0; k < tpal.length; k += 3) if (minDist(tpal, k, fpal) > 20) own.push(tpal[k], tpal[k + 1], tpal[k + 2]);
        if (!own.length) continue;
        const near = B.and(A[F], B.dil(pj.M, 8, W, H)); if (!B.any(near)) continue;
        const nb = near.box(), cw = nb[2] - nb[0], ch = nb[3] - nb[1]; const nsub = B.crop(near, nb), ssub = cropI32(SEG, W, nb), osub = I.labOf(cropRGB(orig, W, nb), cw * ch);
        const sums = new Map(); for (let i = 0; i < cw * ch; i++) { if (!nsub[i]) continue; const s = ssub[i]; let e = sums.get(s); if (!e) { e = [0, 0, 0, 0]; sums.set(s, e); } e[0]++; e[1] += osub[i * 3]; e[2] += osub[i * 3 + 1]; e[3] += osub[i * 3 + 2]; }
        const moveIds = new Set(); for (const [s, e] of sums) { if (e[0] < 6) continue; if (minDist([e[1] / e[0], e[2] / e[0], e[3] / e[0]], 0, own) < 12) moveIds.add(s); }
        if (!moveIds.size) continue;
        const mv = new Uint8Array(cw * ch); for (let i = 0; i < cw * ch; i++) if (nsub[i] && moveIds.has(ssub[i])) mv[i] = 1;
        const mvb = B.fromCrop(mv, nb); A[j] = B.or(A[j], mvb); A[F] = B.andNot(A[F], mvb);
      }
    }
    given[objs[F].name] = before - B.count(A[F]);
  }
  rep.given_to_behind = given;
  function pickC(pj) { const out = []; const M = pj.M, C = pj.C, cw0 = C.box[2] - C.box[0]; for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) if (M.d[y * M.w + x]) { const ci = ((y + M.y0 - C.box[1]) * cw0 + x + M.x0 - C.box[0]) * 3; out.push(C.rgb[ci], C.rgb[ci + 1], C.rgb[ci + 2]); } return Uint8Array.from(out); }
  // floor seen through see-through objects: areas with the empty background's color (or its shadow) right there
  const bgdrop = {}, keptOwn = {};
  for (let F = 0; F < n; F++) {
    if (!SEE.has(objs[F].group) || placed.has(F)) continue;
    const d = backgroundParts(A[F], orig, SEG, W, H, { exclude: allm, plate: PL, paletteGaps: false, silhouette: true }); A[F] = B.andNot(A[F], d); bgdrop[objs[F].name] = B.count(d);
    if (d.kept && d.kept.length) keptOwn[objs[F].name] = d.kept;
  }
  rep.floor_removed_px = bgdrop; rep.see_through_kept = keptOwn;
  tick('owners decided'); progress('owners');

  /* ---- 2b. groups with hidden members and no GPT whole member: the most typical member standing in front is the template ---- */
  for (const [g, members] of groups) {
    if (templates[g] || members.length < 3 || !members.some(j => ancestors(j).size)) continue;
    if (!SEE.has(g)) continue;                        // only for see-through furniture (desks)
    const cands = members.filter(j => !ancestors(j).size && B.count(A[j]) > 500); if (!cands.length) continue;
    const areas = cands.map(j => [B.count(A[j]), j]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const t = areas[areas.length >> 1][1];
    let tm = B.openK(A[t], I.rect(1), W, H);          // the template without slivers and crumbs
    tm = dropCrumbs(tm);
    const b = tm.box(); const Tm = B.crop(tm, b), Trgb = cropRGB(orig, W, b);
    TPL_INFO[g] = { from: objs[t].name, kind: 'typical member' }; log(`template ${g} <- ${objs[t].name} (typical member)`);
    fitGroup(g, Tm, Trgb, b[2] - b[0], b[3] - b[1], members, (j) => A[j], (j) => { const a = ancestors(j); return a.size ? unionOf([...a], A) : new B.BM(); }, [.5, 1.25], 'typical');
    const oku = groupOk(g);
    for (const g2 of Object.keys(templates)) for (const k of groups.get(g2) || []) if (placed.has(k)) B.orInto(oku, A[k], W);
    for (const j of members) if (placed.has(j)) A[j] = takeAreas(ZONE.get(j), oku, SEG, W, H);
    progress('fit');
  }
  tick('second templates fitted');
  rep.templates = {}; for (const [j, r] of placed) { const { M, C, ...rest } = r; rep.templates[objs[j].name] = rest; }
  rep.template_from = TPL_INFO;
  function dropCrumbs(m) {                           // tiny islands cut off from the member are not it
    if (m.empty) return m; const b = m.box(), cw = b[2] - b[0], ch = b[3] - b[1]; const sub = B.crop(m, b);
    const { lab, n: k, stats } = I.components(sub, cw, ch, 8); if (!k) return m; let big = 0; for (let c = 1; c <= k; c++) big = Math.max(big, stats[c][0]);
    const lim = Math.max(150, .03 * big); for (let i = 0; i < sub.length; i++) if (lab[i] && stats[lab[i]][0] < lim) sub[i] = 0;
    return B.fromCrop(sub, b);
  }
  for (const j of placed.keys()) A[j] = dropCrumbs(B.openK(A[j], I.rect(1), W, H));   // crumbs: tiny islands and 1-2 px slivers
  // the floor/wall colors AROUND a place (outside every prop): local, so a far window frame's grey does not count
  const NOPROP = I.not(I.dil(allm, W, H, 3));
  function localBg(m, r = 40) {
    const bb = m.box(); const box = B.boxPad(bb, r, W, H), cw = box[2] - box[0], ch = box[3] - box[1];
    const dm = I.dil(B.crop(m, box), cw, ch, r); let q = new Uint8Array(cw * ch); let nq = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x; if (dm[i] && NOPROP[(y + box[1]) * W + x + box[0]]) { q[i] = 1; nq++; } }
    if (nq < 50) { nq = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x; q[i] = NOPROP[(y + box[1]) * W + x + box[0]]; nq += q[i]; } }
    if (nq < 50) return new Float32Array(0);
    return I.labOfFloat(I.kcenters(I.pick(cropRGB(orig, W, box), q, cw, ch), 8));
  }
  function bgLike(m) {
    const pal = localBg(m); if (!pal.length) return false;
    const b = m.box(), cw = b[2] - b[0], ch = b[3] - b[1]; const c = labMedian(cropRGB(orig, W, b), B.crop(m, b), cw * ch);
    return minDist(c, 0, pal) < 10;
  }

  /* ---- 3. visible part of every object (front-most wins), then the ink line into pixels nobody claims ---- */
  const anyA = new Uint8Array(N); for (const a of A) B.orInto(anyA, a, W);
  const frontFirst = [...Array(n).keys()].sort((a, b) => RANK[b] - RANK[a]);
  const vis = new Array(n).fill(null).map(() => new B.BM()), vsh = new Array(n).fill(null).map(() => new B.BM()); const taken = new Uint8Array(N);
  for (const i of frontFirst) { const v = B.andNotFull(A[i], taken, W); vis[i] = B.or(vis[i], v); B.orInto(taken, v, W); }
  // pixels nobody claims, right next to a template member, in that member's own colors (not floor colors): the member's
  const LABO = null; const grabbed = {};
  for (const j of [...placed.keys()].sort((a, b) => RANK[b] - RANK[a])) {
    const pj = placed.get(j); if (pj.tag !== 'gpt') continue;
    const tp = I.labOfFloat(I.kcenters(pickC(pj), 8)); const lb = localBg(pj.M);
    const own = []; for (let k = 0; k < tp.length; k += 3) if (!lb.length || minDist(tp, k, lb) > 15) own.push(tp[k], tp[k + 1], tp[k + 2]);
    if (!own.length) continue;
    let zone = B.dil(pj.M, 10, W, H); zone = B.andNotFull(B.andNotFull(zone, taken, W), anyA, W); if (!B.any(zone)) continue;
    const zb = zone.box(), cw = zb[2] - zb[0], ch = zb[3] - zb[1]; const zs = B.crop(zone, zb), sg = cropI32(SEG, W, zb), lo = I.labOf(cropRGB(orig, W, zb), cw * ch);
    const sums = new Map(); for (let i = 0; i < cw * ch; i++) { if (!zs[i]) continue; let e = sums.get(sg[i]); if (!e) { e = [0, 0, 0, 0]; sums.set(sg[i], e); } e[0]++; e[1] += lo[i * 3]; e[2] += lo[i * 3 + 1]; e[3] += lo[i * 3 + 2]; }
    const addIds = new Set(); for (const [s, e] of sums) if (e[0] >= 4 && minDist([e[1] / e[0], e[2] / e[0], e[3] / e[0]], 0, own) < 12) addIds.add(s);
    if (!addIds.size) continue;
    const add = new Uint8Array(cw * ch); for (let i = 0; i < cw * ch; i++) if (zs[i] && addIds.has(sg[i])) add[i] = 1;
    const v = B.fromCrop(add, zb); vis[j] = B.or(vis[j], v); B.orInto(taken, v, W); grabbed[objs[j].name] = B.count(v);
  }
  rep.grabbed_next_to_member = grabbed;
  const dropped = new Uint8Array(N); for (let F = 0; F < n; F++) if (SEE.has(objs[F].group)) B.orInto(dropped, B.andNot(ms[F], A[F]), W);
  for (const i of frontFirst) {
    if (placed.has(i)) continue;
    let v = refine(A[i], orig); v = B.andNotFull(B.andNotFull(B.andNotFull(v, anyA, W), dropped, W), taken, W);
    vis[i] = B.or(vis[i], v); B.orInto(taken, v, W);
  }
  const shadG = [];
  for (let i = 0; i < n; i++) {
    const others = anyA.slice(); B.andNotInto(others, A[i], W);
    shadG.push(B.andNot(shadowOf(B.any(vis[i]) ? vis[i] : A[i], Vo, others), vis[i]));
  }
  for (const i of frontFirst) { const v = B.andNotFull(shadG[i], taken, W); vsh[i] = B.or(vsh[i], v); B.orInto(taken, v, W); }
  tick('visible parts'); progress('visible');

  /* ---- 4. hidden parts ---- */
  const fbody = vis.slice(), fsh = vsh.slice(); const fin = {};
  const src = new Array(n).fill(null);              // per object: overrides on top of the picture {box, rgb, mask}
  function srcSet(i, mask, from) {                   // where mask: take colors from 'from' (full RGB or {box, rgb} crop)
    if (!mask || mask.empty) return; let s = src[i]; const mb = mask.box();
    if (!s) { s = src[i] = { box: mb.slice(), rgb: cropRGB(orig, W, mb), set: new Uint8Array((mb[2] - mb[0]) * (mb[3] - mb[1])) }; }
    else if (mb[0] < s.box[0] || mb[1] < s.box[1] || mb[2] > s.box[2] || mb[3] > s.box[3]) {
      const nb = B.boxUnion(s.box, mb), nw = nb[2] - nb[0]; const rgb = cropRGB(orig, W, nb), set = new Uint8Array(nw * (nb[3] - nb[1]));
      const ow = s.box[2] - s.box[0]; for (let y = s.box[1]; y < s.box[3]; y++) for (let x = s.box[0]; x < s.box[2]; x++) { const o = (y - s.box[1]) * ow + x - s.box[0], q = (y - nb[1]) * nw + x - nb[0]; rgb[q * 3] = s.rgb[o * 3]; rgb[q * 3 + 1] = s.rgb[o * 3 + 1]; rgb[q * 3 + 2] = s.rgb[o * 3 + 2]; set[q] = s.set[o]; }
      s.box = nb; s.rgb = rgb; s.set = set;
    }
    const sw = s.box[2] - s.box[0];
    for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
      if (!mask.d[y * mask.w + x]) continue; const gx = x + mask.x0, gy = y + mask.y0; const q = (gy - s.box[1]) * sw + gx - s.box[0];
      if (from.box) { const fw = from.box[2] - from.box[0], fi = ((gy - from.box[1]) * fw + gx - from.box[0]) * 3; s.rgb[q * 3] = from.rgb[fi]; s.rgb[q * 3 + 1] = from.rgb[fi + 1]; s.rgb[q * 3 + 2] = from.rgb[fi + 2]; }
      else { const gi = (gy * W + gx) * 3; s.rgb[q * 3] = from[gi]; s.rgb[q * 3 + 1] = from[gi + 1]; s.rgb[q * 3 + 2] = from[gi + 2]; }
      s.set[q] = 1;
    }
  }
  function srcCrop(i, box) {                          // the object's colors (picture + its overrides) inside box
    const out = cropRGB(orig, W, box); const s = src[i]; if (!s) return out; const cw = box[2] - box[0], sw = s.box[2] - s.box[0];
    for (let y = Math.max(box[1], s.box[1]); y < Math.min(box[3], s.box[3]); y++) for (let x = Math.max(box[0], s.box[0]); x < Math.min(box[2], s.box[2]); x++) {
      const q = (y - s.box[1]) * sw + x - s.box[0]; if (!s.set[q]) continue; const o = ((y - box[1]) * cw + x - box[0]) * 3; out[o] = s.rgb[q * 3]; out[o + 1] = s.rgb[q * 3 + 1]; out[o + 2] = s.rgb[q * 3 + 2];
    }
    return out;
  }
  const takenBody = new Uint8Array(N); for (const v of vis) B.orInto(takenBody, v, W);
  // template members: the template, only where something in front covers the member
  for (const [j, r] of placed) {
    const cover = B.union([...Array(n).keys()].filter(i => i !== j && RANK[i] > RANK[j]).map(i => vis[i]));  // a shadow in front is see-through
    const seam = B.and(B.and(vis[j], B.dil(cover, 2, W, H)), r.M);                // the mixed edge pixels where the front object began
    const nobody = B.andNotFull(B.dil(cover, 3, W, H), takenBody, W);            // mixed pixels right at that edge that nobody took
    const visNoSeam = B.andNot(vis[j], seam);
    const hidden = B.and(B.andNot(r.M, visNoSeam), B.union([cover, seam, nobody]));
    const hp = B.count(hidden);
    if (hp < 20) { fin[objs[j].name] = { template: r.tag, added_px: 0 }; continue; }
    // the template's colors brought to this member's own colors (per flat color of the template, from what it shows)
    const C = r.C, cb = C.box, cw = cb[2] - cb[0], chh = cb[3] - cb[1];
    const cen = I.kcenters(pickC(r), 6); const K = cen.length / 3;
    const tl = new Uint8Array(cw * chh); for (let i = 0; i < cw * chh; i++) { let bd = Infinity, bk = 0; for (let k = 0; k < K; k++) { const d = Math.max(Math.abs(C.rgb[i * 3] - cen[k * 3]), Math.abs(C.rgb[i * 3 + 1] - cen[k * 3 + 1]), Math.abs(C.rgb[i * 3 + 2] - cen[k * 3 + 2])); if (d < bd) { bd = d; bk = k; } } tl[i] = bk; }
    const seen = B.and(B.and(visNoSeam, r.M), B.ero(vis[j], 1, W, H)); const sd = B.crop(seen, cb);
    const gain = []; for (let k = 0; k < K; k++) {
      const oc = [[], [], []], tc = [[], [], []];
      for (let i = 0; i < cw * chh; i++) if (sd[i] && tl[i] === k) { const y = (i / cw) | 0, x = i - y * cw, gi = ((y + cb[1]) * W + x + cb[0]) * 3; for (let c = 0; c < 3; c++) { oc[c].push(orig[gi + c]); tc[c].push(C.rgb[i * 3 + c]); } }
      if (oc[0].length >= 30) gain.push([0, 1, 2].map(c => Math.min(1.25, Math.max(.8, I.median(oc[c]) / Math.max(I.median(tc[c]), 1))))); else gain.push([1, 1, 1]);
    }
    const Cg = new Uint8Array(cw * chh * 3); for (let i = 0; i < cw * chh; i++) for (let c = 0; c < 3; c++) Cg[i * 3 + c] = Math.max(0, Math.min(255, Math.trunc(C.rgb[i * 3 + c] * gain[tl[i]][c])));
    fbody[j] = B.or(visNoSeam, hidden); fsh[j] = B.andNot(fsh[j], hidden); srcSet(j, hidden, { box: cb, rgb: Cg });
    fin[objs[j].name] = { template: r.tag, added_px: hp, seam_px: B.count(seam) };
  }
  // everything else: from GPT's 'front removed' pictures
  function nearestWins(parts) {                      // a pixel claimed by several goes to the object whose visible part is nearest
    const ks = [...parts.keys()]; if (ks.length < 2) return parts;
    const box = B.boxUnion(...ks.map(j => parts.get(j).box()), ...ks.map(j => vis[j].box())); if (!box) return parts;
    const cw = box[2] - box[0], ch = box[3] - box[1]; const best = new Float32Array(cw * ch).fill(1e9), win = new Int32Array(cw * ch).fill(-1);
    ks.forEach((j, t) => {
      const p = parts.get(j); if (p.empty) return; const vd = B.crop(vis[j], box); const inv = new Uint8Array(cw * ch); for (let i = 0; i < inv.length; i++) inv[i] = vd[i] ^ 1;
      const { dist } = I.edt(inv, cw, ch); const pd = B.crop(p, box);
      for (let i = 0; i < cw * ch; i++) if (pd[i] && dist[i] < best[i]) { best[i] = dist[i]; win[i] = t; }
    });
    const out = new Map(); ks.forEach((j, t) => { const pd = B.crop(parts.get(j), box); for (let i = 0; i < pd.length; i++) if (pd[i] && win[i] !== t) pd[i] = 0; out.set(j, B.fromCrop(pd, box)); });
    return out;
  }
  for (const e of edits) {
    const HID_E = [...(e.keep || [])].filter(j => !placed.has(j)).sort((a, b) => a - b); if (!HID_E.length) continue;
    const Vn = Vof(e.rgb); const still = new Uint8Array(N); for (let i = 0; i < n; i++) if (!e.remove.has(i)) B.orInto(still, ms[i], W);
    const adds = new Map(), regionsM = new Map(); let imageSet = false;
    for (const j of HID_E) {
      if ((fin[objs[j].name] || {}).finished || !B.any(vis[j])) continue;
      const vj = vis[j]; let bx = vj.box();
      const occ = [...e.remove].filter(i => (FRONT_OF[i] || new Set()).has(j)).sort((a, b) => a - b);
      const region = B.union(occ.flatMap(i => [vis[i], vsh[i]])); regionsM.set(j, region);
      if (B.any(region)) bx = B.boxUnion(bx, region.box());
      if (!sam) { fin[objs[j].name] = { finished: false, kept: 0, added_px: 0 }; continue; }
      if (!imageSet) { await sam.setImage(e.key, e.rgb, W, H); imageSet = true; }
      const cands = await sam.predict({ box: bx, points: [innerPointBM(ms[j], W, H)], labels: [1], multimask: true });
      const nmj = Math.max(1, B.count(ms[j]));
      const scored = (cands || []).map(c => [B.countAnd(c.mask, ms[j]) / nmj, B.count(c.mask), c.mask]).sort((a, b) => a[1] - b[1]);
      const good = scored.filter(x => x[0] >= .8);
      const pickc = good.length ? good[0] : (scored.length ? scored.reduce((a, b) => b[0] > a[0] ? b : a) : [0, 0, new B.BM()]);
      const kept = pickc[0], full = pickc[2];
      let add = B.andNot(B.and(full, region), vj);
      // & (diff_eo > 30)
      if (!add.empty) { const o = add.d.slice(); for (let y = 0; y < add.h; y++) for (let x = 0; x < add.w; x++) { if (!o[y * add.w + x]) continue; const gi = ((y + add.y0) * W + x + add.x0) * 3; if (!(Math.max(Math.abs(e.rgb[gi] - orig[gi]), Math.abs(e.rgb[gi + 1] - orig[gi + 1]), Math.abs(e.rgb[gi + 2] - orig[gi + 2])) > 30)) o[y * add.w + x] = 0; } add = B.fromCrop(o, add.box() || [0, 0, 0, 0]); }
      let addC = new B.BM();
      if (!add.empty) {
        const ab = add.box(), cw = ab[2] - ab[0], ch = ab[3] - ab[1]; const sub = B.crop(add, ab); const { lab, n: k, stats } = I.components(sub, cw, ch, 8);
        const vjd = B.crop(B.dil(vj, 3, W, H), ab); const keepC = new Uint8Array(k + 1);
        for (let i = 0; i < sub.length; i++) if (lab[i] && stats[lab[i]][0] >= 20 && vjd[i]) keepC[lab[i]] = 1;   // (dil(c, 3) & vj).any() == c touches dil(vj, 3)
        const o = new Uint8Array(cw * ch); for (let i = 0; i < o.length; i++) if (lab[i] && keepC[lab[i]]) o[i] = 1; addC = B.fromCrop(o, ab);
      }
      const ac = B.count(addC);
      if (kept < .8 || ac < 40) { fin[objs[j].name] = { finished: false, kept: Math.round(kept * 100) / 100, added_px: ac }; continue; }
      adds.set(j, addC); fin[objs[j].name] = { kept: Math.round(kept * 100) / 100, edit: e.key };
    }
    const adds2 = nearestWins(adds); let ab = new Map(), ash = new Map();
    for (const [j, addC] of adds2) {
      const region = regionsM.get(j); const regionF = fullOf(region);
      ab.set(j, B.andNot(B.andFull(refine(addC, e.rgb), regionF, W), vis[j]));
      const others = still.slice(); B.andNotInto(others, ms[j], W);
      ash.set(j, B.andNot(B.andNot(shadowOf(B.or(addC, ms[j]), Vn, others, regionF), ab.get(j)), vis[j]));
    }
    ab = nearestWins(ab); ash = nearestWins(ash);
    for (const [j, a] of ab) {
      const s = ash.get(j) || new B.BM();
      fbody[j] = B.or(fbody[j], a); fsh[j] = B.andNot(B.or(fsh[j], s), fbody[j]);
      srcSet(j, B.or(a, s), e.rgb);
      Object.assign(fin[objs[j].name], { finished: true, added_px: B.count(B.or(a, s)) });
    }
  }
  rep.finish = fin;
  tick('hidden parts'); progress('hidden');

  /* ---- 5. pixels ---- */
  const layers = new Map();                          // key -> { box, rgba }
  function softEdge(i, mask, hard, box) {
    const cw = box[2] - box[0], ch = box[3] - box[1]; const obs = srcCrop(i, box), pl = cropRGB(PL, W, box);
    const md = B.crop(mask, box); const mf = fillHoles(mask, Math.max(300, .02 * B.count(mask))); const inner = B.and(B.ero(mf, 2, W, H), mask);
    const alpha = new Float32Array(cw * ch), col = new Float32Array(cw * ch * 3); for (let k = 0; k < obs.length; k++) col[k] = obs[k];
    if (!B.any(inner)) { for (let k = 0; k < md.length; k++) alpha[k] = md[k]; return { col, alpha }; }
    const near = nearestColor(obs, B.and(inner, new B.BM(box[0], box[1], cw, ch, new Uint8Array(cw * ch).fill(1))), box);
    const idn = B.crop(inner, box); const hd = hard ? B.crop(hard, box) : null;
    for (let k = 0; k < cw * ch; k++) {
      if (idn[k]) { alpha[k] = 1; continue; } if (!md[k]) continue;    // band = mask & ~inner
      let num = 0, dd = 0; for (let c = 0; c < 3; c++) { const d = near[k * 3 + c] - pl[k * 3 + c]; num += (obs[k * 3 + c] - pl[k * 3 + c]) * d; dd += d * d; }
      let a = Math.min(1, Math.max(0, num / Math.max(dd, 1))); if (dd < 900) a = 1; alpha[k] = a;
      for (let c = 0; c < 3; c++) col[k * 3 + c] = Math.min(255, Math.max(0, (obs[k * 3 + c] - (1 - a) * pl[k * 3 + c]) / Math.max(a, .2)));
      if (hd && hd[k]) { alpha[k] = 1; for (let c = 0; c < 3; c++) col[k * 3 + c] = near[k * 3 + c]; }   // edge against another prop: its own color, fully there
    }
    return { col, alpha };
  }
  function makeLayer(i) {
    let hard = null;
    if (placed.has(i)) { const oth = B.union([...placed.keys()].filter(k => k !== i).map(k => vis[k])); hard = B.and(fbody[i], B.dil(oth, 1, W, H)); }
    const sh = B.andNot(fsh[i], fbody[i]); const box0 = B.boxUnion(fbody[i].box(), sh.box());
    if (!box0) { layers.set(objs[i].key, { box: [0, 0, 1, 1], rgba: new Uint8Array(4) }); return; }
    const box = B.boxPad(box0, 6, W, H), cw = box[2] - box[0], ch = box[3] - box[1];
    const { col, alpha: a } = softEdge(i, fbody[i], hard, box);
    const shd = B.crop(sh, box); const sobs = srcCrop(i, box), pl = cropRGB(PL, W, box);
    const ratio = new Float32Array(cw * ch); for (let k = 0; k < cw * ch; k++) ratio[k] = (sobs[k * 3] + sobs[k * 3 + 1] + sobs[k * 3 + 2] + 3) / (pl[k * 3] + pl[k * 3 + 1] + pl[k * 3 + 2] + 3);
    // board lines are thin; a median over 9 px ignores them, so the shadow is one smooth darkness
    const u8 = new Uint8Array(cw * ch); for (let k = 0; k < cw * ch; k++) u8[k] = Math.trunc(Math.min(255, Math.max(0, (shd[k] ? ratio[k] : 1) * 200)));
    const med = I.medianBlur8(u8, cw, ch, 9); let as = new Float32Array(cw * ch); for (let k = 0; k < cw * ch; k++) as[k] = shd[k] ? Math.min(.95, Math.max(0, 1 - med[k] / 200)) : 0;
    if (I.any(shd)) {                                 // each shadow piece: no darker than its typical darkness
      const { lab, n: kk } = I.components(shd, cw, ch, 8); const vals = Array.from({ length: kk + 1 }, () => []);
      for (let k = 0; k < cw * ch; k++) if (lab[k]) vals[lab[k]].push(Math.min(.95, Math.max(0, 1 - ratio[k])));
      const cap = new Float32Array(kk + 1);
      for (let c = 1; c <= kk; c++) { const v = vals[c]; const lo = I.percentile(v, 20), hi = I.percentile(v, 80); const mid = v.filter(x => x >= lo && x <= hi); cap[c] = I.median(mid.length ? mid : v) + .04; }
      for (let k = 0; k < cw * ch; k++) if (lab[k]) as[k] = Math.min(as[k], cap[lab[k]]);
    }
    as = I.gaussianBlur(as, cw, ch, .8); for (let k = 0; k < cw * ch; k++) if (!shd[k]) as[k] = 0;
    const rgba = new Uint8Array(cw * ch * 4), body = new Uint8Array(cw * ch * 4), shm = new Uint8Array(cw * ch * 4); let hasSh = false;
    for (let k = 0; k < cw * ch; k++) {
      const ao = a[k] + as[k] * (1 - a[k]); const f = a[k] / Math.max(ao, 1e-6);
      for (let c = 0; c < 3; c++) { rgba[k * 4 + c] = Math.trunc(Math.min(255, Math.max(0, col[k * 3 + c] * f))); body[k * 4 + c] = Math.trunc(Math.min(255, Math.max(0, col[k * 3 + c]))); }
      rgba[k * 4 + 3] = Math.trunc(ao * 255 + .5); body[k * 4 + 3] = Math.trunc(a[k] * 255 + .5);
      // (v0.4.4) the same shadow as a multiply layer: gray 255 * (1 - darkness), so plate * gray / 255 = plate darkened the same way
      if (as[k] > 0) { const g = Math.trunc(255 * (1 - as[k]) + .5); shm[k * 4] = shm[k * 4 + 1] = shm[k * 4 + 2] = g; shm[k * 4 + 3] = 255; hasSh = true; }
    }
    layers.set(objs[i].key, { box, rgba, body, shadow: hasSh ? shm : null, vis: vis[i], vsh: vsh[i] || null });
  }
  function stack(keys) {                             // composite back to front over the full picture (float)
    const out = new Float32Array(N * 3);
    for (const k of keys) {
      if (k === 'bg') { for (let i = 0; i < N * 3; i++) out[i] = PL[i]; continue; }
      const L = layers.get(k); if (!L) continue; const [x0, y0, x1, y1] = L.box, cw = x1 - x0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = ((y - y0) * cw + x - x0) * 4, a = L.rgba[q + 3] / 255; if (!a) continue; const o = (y * W + x) * 3; for (let c = 0; c < 3; c++) out[o + c] = L.rgba[q + c] * a + out[o + c] * (1 - a); }
    }
    return out;
  }

  /* ---- 6. tidy ---- */
  const holes = {};
  for (let i = 0; i < n; i++) {
    if (placed.has(i)) { makeLayer(i); continue; }          // a template member's shape is the template's (handle hole stays open)
    const before = B.count(fbody[i]); const isSee = SEE.has(objs[i].group);
    const othersOf = (hole) => { let c = 0, t = 0; for (let y = 0; y < hole.h; y++) for (let x = 0; x < hole.w; x++) { if (!hole.d[y * hole.w + x]) continue; t++; const gx = x + hole.x0, gy = y + hole.y0; if (allm[gy * W + gx] && !B.get(ms[i], gx, gy)) c++; } return c / Math.max(1, t); };
    fbody[i] = fillHoles(fbody[i], Math.max(300, .02 * before), (h) => {
      const hb = h.box(); const sc = srcCrop(i, hb), pc = cropRGB(PL, W, hb), hd = B.crop(h, hb); let s = 0, t = 0;
      for (let k = 0; k < hd.length; k++) if (hd[k]) { t++; s += Math.max(Math.abs(sc[k * 3] - pc[k * 3]), Math.abs(sc[k * 3 + 1] - pc[k * 3 + 1]), Math.abs(sc[k * 3 + 2] - pc[k * 3 + 2])); }
      return s / Math.max(1, t) > 25 && othersOf(h) < .3 && !(isSee && bgLike(h));
    });
    fsh[i] = B.andNot(fsh[i], fbody[i]);
    if (B.count(fbody[i]) > before) holes[objs[i].name] = B.count(fbody[i]) - before;
    makeLayer(i);
  }
  progress('tidy');
  const rankKeys = () => [...Array(n).keys()].sort((a, b) => RANK[a] - RANK[b]).map(i => objs[i].key);
  let comp = stack(['bg', ...rankKeys()]);
  const anyp = new Uint8Array(N); for (let i = 0; i < n; i++) { const L = layers.get(objs[i].key); const [x0, y0, x1, y1] = L.box, cw = x1 - x0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (L.rgba[((y - y0) * cw + x - x0) * 4 + 3]) anyp[y * W + x] = 1; }
  const resid = new Uint8Array(N); for (let i = 0; i < N; i++) { if (anyp[i]) continue; let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(comp[i * 3 + c] - orig[i * 3 + c])); if (d > 40) resid[i] = 1; }
  const res = I.open(resid, W, H, I.rect(1)); comp = null;
  let extra = new B.BM(), bgfix = new B.BM(); const attached = {}; let bgBits = 0; const PAL = new Map();
  const HOLES = new Map(); for (const [j, r] of placed) { const b = r.M.box(), cw = b[2] - b[0], ch = b[3] - b[1]; const sub = B.crop(r.M, b); const f = I.fillHolesAll(sub, cw, ch); for (let k = 0; k < f.length; k++) f[k] &= sub[k] ^ 1; HOLES.set(j, B.fromCrop(f, b)); }
  const pal = (i) => {
    if (!PAL.has(i)) { const fb = fbody[i]; const q = B.and(fb, B.ero(fb, 1, W, H)); const use = B.count(q) > 30 ? q : fb; const b = use.box(); const sc = srcCrop(i, b); PAL.set(i, I.labOfFloat(I.kcenters(I.pick(sc, B.crop(use, b), b[2] - b[0], b[3] - b[1]), 6))); }
    return PAL.get(i);
  };
  const layerAlpha = (i) => { const L = layers.get(objs[i].key); const [x0, y0, x1, y1] = L.box, cw = x1 - x0, o = new Uint8Array(cw * (y1 - y0)); for (let k = 0; k < o.length; k++) o[k] = L.rgba[k * 4 + 3] ? 1 : 0; return B.fromCrop(o, L.box); };
  const LA = [...Array(n).keys()].map(layerAlpha);
  const attachTo = new Map();
  for (const c of I.compMasks(res, W, H, 40, 8)) {
    const cb = B.fromFull(c, W, H);
    if (bgLike(cb)) { bgfix = B.or(bgfix, cb); bgBits += c.area; continue; }   // floor-board line or wall detail drawn differently: background
    // distance from this bit to each layer (only nearby ones matter: 60 px)
    const box = B.boxPad(cb.box(), 64, W, H), cw = box[2] - box[0], ch = box[3] - box[1]; const inv = new Uint8Array(cw * ch).fill(1); const cd = B.crop(cb, box); for (let k = 0; k < cd.length; k++) if (cd[k]) inv[k] = 0;
    const { dist } = I.edt(inv, cw, ch); const near = new Float64Array(n).fill(1e9);
    for (let i = 0; i < n; i++) { const a = LA[i]; if (!B.boxesTouch(a.box(), box)) continue; const ad = B.crop(a, box); for (let k = 0; k < ad.length; k++) if (ad[k] && dist[k] < near[i]) near[i] = dist[k]; }
    const b2 = cb.box(); const cc = labMedian(cropRGB(orig, W, b2), B.crop(cb, b2), (b2[2] - b2[0]) * (b2[3] - b2[1]));
    const inHole = [...HOLES.values()].some(h => B.countAnd(cb, h) > .5 * c.area);
    const order = [...Array(n).keys()].sort((a, b) => near[a] - near[b] || a - b);
    const match = order.filter(i => near[i] <= (inHole ? 60 : 12) && !(inHole && placed.has(i)) && minDist(cc, 0, pal(i)) < 14);
    let i;
    if (match.length && c.area < 1500) i = match[0];
    else {
      const pool = [...Array(n).keys()].filter(k => !placed.has(k)); i = pool.length ? pool.reduce((a, k) => near[k] < near[a] ? k : a, pool[0]) : order[0];
      if (near[i] > 8 || c.area >= 400) i = -1;
    }
    if (i >= 0) { const g = B.andNotFull(B.dil(cb, 1, W, H), anyp, W); fbody[i] = B.or(fbody[i], g); fsh[i] = B.andNot(fsh[i], g); srcSet(i, g, orig); attached[objs[i].name] = (attached[objs[i].name] || 0) + B.count(g); attachTo.set(i, 1); continue; }
    const border = c.box[0] === 0 || c.box[1] === 0 || c.box[2] === W || c.box[3] === H;
    if (c.area > .005 * N || border) bgfix = B.or(bgfix, cb); else extra = B.or(extra, cb);
  }
  for (const i of attachTo.keys()) makeLayer(i);
  if (B.any(extra)) {
    const g = B.andNotFull(B.dil(extra, 2, W, H), anyp, W); const bb = g.box();
    objs.push({ group: '기타', name: '기타 (자동 보충)', key: 'p' + String(n).padStart(2, '0'), box: bb, bottom: bb[3] - 1 }); RANK[n] = -1;
    fbody.push(g); fsh.push(new B.BM()); src.push(null); vis.push(new B.BM()); n = objs.length; makeLayer(n - 1);
  }
  if (B.any(bgfix)) {
    const g = B.andNotFull(B.dil(bgfix, 1, W, H), anyp, W); const bb = g.box();
    objs.push({ group: 'BG 보정', name: 'BG 보정 (빈 배경이 달라진 곳)', key: 'p' + String(n).padStart(2, '0'), box: bb, bottom: -1 }); RANK[n] = -2;
    fbody.push(g); fsh.push(new B.BM()); src.push(null); vis.push(new B.BM()); n = objs.length; makeLayer(n - 1);
  }
  rep.tidy = { holes_filled_px: holes, attached_px: attached, extra_px: B.count(extra), bg_fix_px: B.count(bgfix), floor_bits_to_bg_fix_px: bgBits };
  log('tidy: ' + JSON.stringify(rep.tidy));
  tick('tidy');

  /* ---- 7. order and folders ---- */
  const depth = [...Array(n).keys()].sort((a, b) => RANK[a] - RANK[b] || (objs[a].key < objs[b].key ? -1 : 1));
  const al = [...Array(n).keys()].map(i => { const L = layers.get(objs[i].key); const [x0, y0, x1, y1] = L.box, cw = x1 - x0, o = new Uint8Array(cw * (y1 - y0)); for (let k = 0; k < o.length; k++) o[k] = L.rgba[k * 4 + 3] > 127 ? 1 : 0; return B.fromCrop(o, L.box); });
  const bbA = [...Array(n).keys()].map(i => layerAlpha(i).box());
  const mustBelow = [...Array(n).keys()].map(() => new Set());
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (a === b || RANK[a] <= RANK[b]) continue; const A_ = bbA[a], B_ = bbA[b]; if (!A_ || !B_) continue;
    if (A_[0] >= B_[2] || B_[0] >= A_[2] || A_[1] >= B_[3] || B_[1] >= A_[3]) continue;
    if (B.countAnd(al[a], al[b]) > 30) mustBelow[a].add(b);
  }
  for (let a = 0; a < n; a++) for (const b of FRONT_OF[a] || []) if (b < n && (RANK[a] ?? 0) > (RANK[b] ?? 0)) mustBelow[a].add(b);
  const runs = [];
  for (const i of depth) {
    const g = objs[i].group; let idx = -1; runs.forEach(([gg], fi) => { if (gg === g) idx = fi; });
    if (idx >= 0) { const later = new Set(); for (let fi = idx + 1; fi < runs.length; fi++) for (const x of runs[fi][1]) later.add(x); if (![...mustBelow[i]].some(x => later.has(x))) { runs[idx][1].push(i); continue; } }
    runs.push([g, [i]]);
  }
  const cnt = {}; for (const [g] of runs) cnt[g] = (cnt[g] || 0) + 1;
  const seenG = {}, unit = {}, folders = [];
  for (const [g, mem] of runs) {
    seenG[g] = (seenG[g] || 0) + 1; const k = seenG[g];
    const name = cnt[g] === 1 ? g : (k === 1 && cnt[g] === 2 ? `${g} (뒤)` : k === 2 && cnt[g] === 2 ? `${g} (앞)` : `${g} (${k})`);
    folders.push(name); for (const i of mem) unit[i] = name;
  }
  const stackKeys = ['bg', ...runs.flatMap(([, mem]) => mem.map(i => objs[i].key))];

  /* ---- 8. check ---- */
  const compF = stack(stackKeys); let sum = 0, g20 = 0, g40 = 0;
  for (let i = 0; i < N; i++) { let d = 0; for (let c = 0; c < 3; c++) { const v = Math.abs(compF[i * 3 + c] - orig[i * 3 + c]); sum += v; d = Math.max(d, v); } if (d > 20) g20++; if (d > 40) g40++; }
  rep.stack_vs_original = { mean_diff: +(sum / (N * 3)).toFixed(2), share_gt20: +(g20 / N).toFixed(4), share_gt40: +(g40 / N).toFixed(4) };
  // (v0.4.2) per object: how much of its outline ends up as the empty background although the picture shows something
  // else there (a part no layer kept). Only reported: BAE경 asks to check the layer above 3 %.
  const anyAl = new Uint8Array(N);
  for (const k of stackKeys) { if (k === 'bg') continue; const L = layers.get(k); const [x0, y0, x1, y1] = L.box, cw = x1 - x0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (L.rgba[((y - y0) * cw + x - x0) * 4 + 3] > 127) anyAl[y * W + x] = 1; }
  const lostIn = {}, toCheck = [];
  for (let i = 0; i < n; i++) {
    const m = ms[i]; if (!m || m.empty) continue; const tot = B.count(m); if (!tot) continue;
    const core = B.ero(m, 2, W, H); if (!core || core.empty) { lostIn[objs[i].name] = 0; continue; }   // outline edges: 1-2 px always differ a little
    const cw = core.w, ch = core.h, lost = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (!core.d[y * cw + x]) continue; const gi = (y + core.y0) * W + x + core.x0; if (anyAl[gi]) continue;
      let dd = 0; for (let c = 0; c < 3; c++) dd = Math.max(dd, Math.abs(compF[gi * 3 + c] - orig[gi * 3 + c])); if (dd > 12) lost[y * cw + x] = 1;
    }
    const { n: nc, stats } = I.components(lost, cw, ch, 8); let bad = 0;
    for (let c = 1; c <= nc; c++) if (stats[c][0] >= Math.max(200, .01 * tot)) bad += stats[c][0];   // only pieces, not specks
    const sh = bad / tot; lostIn[objs[i].name] = +sh.toFixed(4); if (sh > .03) toCheck.push(objs[i].name);
  }
  rep.lost_in_outline = lostIn; rep.check = toCheck;
  log('stack: ' + JSON.stringify(rep.stack_vs_original) + ' | folders: ' + JSON.stringify(folders));
  const meta = [{ key: 'bg', name: '빈 배경 (GPT)', group: 'BG', unit: 'BG', box: [0, 0, W, H], finished: false, front: false, hidden: false }];
  for (const i of depth) {
    const k = objs[i].key, nm = objs[i].name, f = fin[nm] || {};
    meta.push({ key: k, id: objs[i].id != null ? objs[i].id : null, name: nm, group: objs[i].group, unit: unit[i], bottom: objs[i].bottom, box: bbA[i], finished: !!(f.finished || (f.added_px || 0) > 0), template: f.template || null,
                front: FRONT.has(i), hidden: HID.has(i), shadow_px: B.count(B.andNot(fsh[i], fbody[i])) });
  }
  layers.set('bg', { box: [0, 0, W, H], rgba: null, rgb: PL });
  tick(`built ${meta.length} layers`); progress('done');
  return { W, H, layers, meta, folders: ['BG', ...folders], stackKeys, report: rep };
}
