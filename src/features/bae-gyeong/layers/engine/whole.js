/* BAE layer engine, step 'whole member' (port of t5_whole.py):
   props drawn identically (school chairs, desks...) only need ONE whole example. A member that GPT drew whole and in
   place in a 'front removed' picture is cut out there with SAM, cleaned of the floor seen through its gaps, and becomes
   that group's template. Masks are box masks (bm.js). */
import * as I from './img.js';
import * as B from './bm.js';
import { cleanTemplate, cropRGB } from './templates.js';

export function depthGraph(n, frontOf) {           // frontOf: {i: Set(j...)}: i stands in front of j
  const behindOf = []; for (let j = 0; j < n; j++) behindOf.push(new Set());   // behindOf[j] = who stands in front of j
  for (const [i, s] of Object.entries(frontOf)) for (const j of s) if (j < n) behindOf[j].add(+i);
  const anc = new Map();
  const ancestors = (j) => { if (anc.has(j)) return anc.get(j); const out = new Set(), todo = [...behindOf[j]]; while (todo.length) { const i = todo.pop(); if (!out.has(i)) { out.add(i); todo.push(...behindOf[i]); } } anc.set(j, out); return out; };
  return { behindOf, ancestors };
}
export function exclusive(ms, W, H) {             // each mask minus every other mask
  const cnt = new Uint8Array(W * H); for (const m of ms) { if (m.empty) continue; for (let y = 0; y < m.h; y++) { const r = (y + m.y0) * W + m.x0; for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x] && cnt[r + x] < 2) cnt[r + x]++; } }
  return ms.map(m => { if (m.empty) return new B.BM(); const o = m.d.slice(); for (let y = 0; y < m.h; y++) { const r = (y + m.y0) * W + m.x0; for (let x = 0; x < m.w; x++) if (cnt[r + x] > 1) o[y * m.w + x] = 0; } return B.fromCrop(o, m.box()); });
}
export function groupsOf(objs) { const g = new Map(); objs.forEach((o, i) => { if (!g.has(o.group)) g.set(o.group, []); g.get(o.group).push(i); }); return g; }
export function innerPointBM(m, W, H) { const b = m.box(); const sub = B.crop(m, b); const p = I.innerPoint(sub, b[2] - b[0], b[3] - b[1]); return [p[0] + b[0], p[1] + b[1]]; }

/* edits: [{ key, rgb, remove: Set }]; returns { [group]: { Tm, Trgb, tw, th, from, name, edit, box, px } } */
export async function findWholeTemplates({ W, H, orig, plate, objs, ms, frontOf, edits, sam, log = () => {} }) {
  const n = objs.length; const { behindOf, ancestors } = depthGraph(n, frontOf); const excl = exclusive(ms, W, H);
  const groups = groupsOf(objs);
  const REP = [...groups].filter(([, mem]) => mem.length >= 3 && mem.some(j => behindOf[j].size)).map(([g]) => g);
  log('groups of identical props with hidden members: ' + JSON.stringify(REP));
  const whole = new Map(); const areas = ms.map(m => B.count(m));
  for (const e of edits) {
    if (!REP.length) break;
    let imageSet = false;
    for (const g of REP) for (const j of groups.get(g)) {
      const front = ancestors(j);
      if (e.remove.has(j) || !front.size || ![...front].some(i => e.remove.has(i))) continue;  // only if what stood in front of it was taken away
      let [x0, y0, x1, y1] = ms[j].box();
      for (const i of front) { const a = ms[i].box(); if (!a) continue; x0 = Math.min(x0, a[0]); y0 = Math.min(y0, a[1]); x1 = Math.max(x1, a[2]); y1 = Math.max(y1, a[3]); }
      const pt = innerPointBM(B.count(excl[j]) > 200 ? excl[j] : ms[j], W, H);
      if (!imageSet) { await sam.setImage(e.key, e.rgb, W, H); imageSet = true; }
      const cands = await sam.predict({ box: [x0, y0, x1, y1], points: [pt], labels: [1], multimask: true });
      if (!cands || !cands.length) continue;
      const frontm = B.union([...front].map(i => ms[i])); const d4 = B.dil(ms[j], 4, W, H); const nEx = Math.max(1, B.count(excl[j]));
      let best = null;
      for (const { mask: m_, conf: cf } of cands) {
        let kept = 0, strayN = 0, mN = 0, newN = 0, gain = 0, swallowed = 0;
        for (let y = 0; y < m_.h; y++) for (let x = 0; x < m_.w; x++) {
          if (!m_.d[y * m_.w + x]) continue; const gx = x + m_.x0, gy = y + m_.y0, gi = gy * W + gx; mN++;
          if (B.get(excl[j], gx, gy)) kept++; const inF = B.get(frontm, gx, gy); if (!B.get(d4, gx, gy) && !inF) strayN++;
          if (!B.get(ms[j], gx, gy)) { newN++; const df = Math.max(Math.abs(e.rgb[gi * 3] - orig[gi * 3]), Math.abs(e.rgb[gi * 3 + 1] - orig[gi * 3 + 1]), Math.abs(e.rgb[gi * 3 + 2] - orig[gi * 3 + 2])) > 30; if (df) gain++; else if (inF) swallowed++; }
        }
        const k = kept / nEx, stray = strayN / Math.max(1, mN);
        if (swallowed > .3 * Math.max(1, newN)) continue;                          // the front object is still there and got swallowed
        if (k >= .9 && stray <= .03 && (!best || cf > best.cf)) best = { cf, m: m_, kept: k, stray, gain, px: mN };
      }
      if (best && best.gain > .1 * areas[j] && (!whole.has(j) || best.px > whole.get(j).px)) whole.set(j, { ...best, rgb: e.rgb, key: e.key });
      log(`  ${e.key} ${objs[j].name}: ` + (best ? `whole, kept ${best.kept.toFixed(2)} stray ${best.stray.toFixed(3)} new ${best.gain} px` : 'not whole here'));
    }
  }
  const out = {};
  for (const g of REP) {
    const cand = groups.get(g).filter(j => whole.has(j)); if (!cand.length) continue;
    let t = cand[0]; for (const j of cand) if (whole.get(j).px > whole.get(t).px) t = j;
    const wv = whole.get(t);
    const m2 = cleanTemplate(wv.m, wv.rgb, W, H, plate, (rgb, w, h) => I.felzenszwalb(rgb, w, h, 30, 8));
    const b = m2.box();
    out[g] = { Tm: B.crop(m2, b), Trgb: cropRGB(wv.rgb, W, b), tw: b[2] - b[0], th: b[3] - b[1], from: t, name: objs[t].name, edit: wv.key, box: b, px: B.count(m2) };
    log(`template for ${g} = ${objs[t].name} from ${wv.key} ${out[g].px} px`);
  }
  return out;
}
