/* BAE layer engine, step 'outlines' (port of t3_phase2.py):
   SAM gives a few candidate outlines per box from the PD; the one that best explains what disappears in the empty
   background wins. Then: which props touch (so the PD can say which one is in front), how much the empty background
   changed where no prop was, and a numbered picture for the PD. */
import * as I from './img.js';
import * as B from './bm.js';
import { drawNumber } from './digits.js';

export function changedMask(orig, plate, N) {      // changed, but not just evenly darker (a shadow that left)
  const m = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let d = 0, s = 0; const r = [0, 0, 0];
    for (let c = 0; c < 3; c++) { const o = orig[i * 3 + c], p = plate[i * 3 + c]; d = Math.max(d, Math.abs(o - p)); r[c] = (o + 3) / (p + 3); s += r[c]; }
    if (d <= 30) continue; const rm = s / 3; const flat = rm < .97 && Math.max(Math.abs(r[0] - rm), Math.abs(r[1] - rm), Math.abs(r[2] - rm)) < .08;
    if (!flat) m[i] = 1;
  }
  return m;
}
export function clean(m, W, H) {                         // one main piece (+ pieces >= 5% of it), small gaps closed
  if (!m || m.empty) return m; const b = B.pad(m, 2, W, H), cw = b[2] - b[0], ch = b[3] - b[1]; let sub = B.crop(m, b);
  const { lab, n, stats } = I.components(sub, cw, ch, 8);
  if (n > 1) { let big = 0; for (let c = 1; c <= n; c++) big = Math.max(big, stats[c][0]); const lim = Math.max(40, .05 * big); for (let i = 0; i < sub.length; i++) if (lab[i] && stats[lab[i]][0] < lim) sub[i] = 0; }
  sub = I.close(sub, cw, ch, I.rect(1)); return B.fromCrop(sub, b);
}

/* inventory: the PD's answer {groups, objects (box in PD-picture pixels), background_en}; scale: picture px per PD px */
export async function findOutlines({ W, H, orig, plate, inventory, scale, sam, log = () => {}, progress = () => {}, forced = {} }) {   // forced: id -> candidate index (0-2 SAM's three, 3 its single answer)
  const N = W * H; const see = new Map(inventory.groups.map(g => [g.group, !!g.see_through]));
  let objs = [];
  for (const o of inventory.objects) {
    const b0 = (o.box || []).slice(0, 4).map(v => +v * scale); if (b0.length < 4 || b0.some(v => !isFinite(v))) continue;
    const b = [Math.max(0, Math.min(W - 1, b0[0])), Math.max(0, Math.min(H - 1, b0[1])), Math.max(0, Math.min(W - 1, b0[2])), Math.max(0, Math.min(H - 1, b0[3]))];
    if (b[2] - b[0] < 4 || b[3] - b[1] < 4) continue;
    objs.push({ id: o.id, group: o.group, name: o.name, en: o.en, box: b, see_through: see.get(o.group) || false });
  }
  await sam.setImage('orig', orig, W, H);
  const answers = [];
  for (let i = 0; i < objs.length; i++) { answers.push(await sam.predictAll({ box: objs[i].box })); progress(i + 1, objs.length); }
  const changed = changedMask(orig, plate, N);
  const rawDefaults = answers.map(a => a.single.mask), defaults = rawDefaults.map(m => clean(m, W, H));
  const ms = []; let picks = 0;
  for (let i = 0; i < objs.length; i++) {
    const b = objs[i].box; const g = .03 * Math.max(b[2] - b[0], b[3] - b[1]) + 4;
    const ex = [Math.trunc(Math.max(0, b[1] - g)), Math.trunc(Math.min(H, b[3] + g)), Math.trunc(Math.max(0, b[0] - g)), Math.trunc(Math.min(W, b[2] + g))]; // y0, y1, x0, x1
    const inEx = (x, y) => y >= ex[0] && y < ex[1] && x >= ex[2] && x < ex[3];
    const cands = answers[i].multi.map(c => clean(c.mask, W, H)).concat([defaults[i]]); const conf = answers[i].multi.map(c => c.conf).concat([null]);
    const best = Math.max(...conf.filter(c => c != null));
    // others = every other box's default outline (only near this box matters)
    const zone = [Math.max(0, ex[2] - 2), Math.max(0, ex[0] - 2), Math.min(W, ex[3] + 2), Math.min(H, ex[1] + 2)];
    const others = new B.BM(zone[0], zone[1], zone[2] - zone[0], zone[3] - zone[1]);
    for (let k = 0; k < objs.length; k++) { if (k === i) continue; const d = rawDefaults[k]; if (!d || d.empty || !B.boxesTouch(d.box(), zone)) continue; const c = B.crop(d, zone); for (let q = 0; q < c.length; q++) others.d[q] |= c[q]; }
    const fk = objs[i].id != null ? forced[objs[i].id] : undefined;
    if (fk != null && cands[fk] && B.count(cands[fk]) >= 60) { ms.push(cands[fk]); continue; }
    const scored = [];
    cands.forEach((m, t) => {
      const c = conf[t]; if (!m || B.count(m) < 60 || !(c == null || c >= .75 * best)) return;
      let miss = 0, spill = 0;
      for (let y = ex[0]; y < ex[1]; y++) for (let x = ex[2]; x < ex[3]; x++) { const i2 = y * W + x; if (changed[i2] && !B.get(m, x, y) && !B.get(others, x, y)) miss++; }
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x] && !inEx(x + m.x0, y + m.y0)) spill++;
      scored.push([miss + spill, t]);
    });
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!scored.length) { ms.push(null); continue; }
    let pick = scored[0][1]; const dflt = scored.filter(s => s[1] === cands.length - 1);
    if (dflt.length && scored[0][0] > .85 * dflt[0][0] - 50) pick = cands.length - 1;
    picks += pick !== cands.length - 1 ? 1 : 0; ms.push(cands[pick]);
  }
  const keep = objs.map((o, i) => [o, ms[i]]).filter(([, m]) => m && B.count(m) >= 60);
  const dropped = objs.length - keep.length; objs = keep.map(k => k[0]); const masks = keep.map(k => k[1]);
  objs.forEach((o, i) => { const b = masks[i].box(); o.bottom = b[3] - 1; o.area = B.count(masks[i]); o.mbox = b; });
  // touching pairs (outline grown by 3 px meets the other outline)
  const pairs = []; const dm = masks.map(m => B.dil(m, 3, W, H));
  for (let a = 0; a < objs.length; a++) for (let b = a + 1; b < objs.length; b++) {
    const A = objs[a].mbox, Bb = objs[b].mbox; if (A[0] > Bb[2] + 4 || Bb[0] > A[2] + 4 || A[1] > Bb[3] + 4 || Bb[1] > A[3] + 4) continue;
    if (B.countAnd(dm[a], masks[b]) > 0) pairs.push([a, b]);
  }
  const plateCheck = plateDrift(orig, plate, masks, W, H);
  log(`outlines: ${objs.length} props (dropped ${dropped}), touching pairs ${pairs.length}, better outline picked ${picks}, plate ${JSON.stringify(plateCheck)}`);
  return { objs, ms: masks, pairs, plateCheck, picks, dropped };
}
export function plateDrift(orig, plate, masks, W, H) {   // how much the empty background changed where no prop was
  const props = new Uint8Array(W * H); for (const m of masks) B.orInto(props, m, W); const near = I.dil(props, W, H, 20);
  let n = 0, s = 0, g30 = 0;
  for (let i = 0; i < W * H; i++) { if (near[i]) continue; const d = (Math.abs(orig[i * 3] - plate[i * 3]) + Math.abs(orig[i * 3 + 1] - plate[i * 3 + 1]) + Math.abs(orig[i * 3 + 2] - plate[i * 3 + 2])) / 3; n++; s += d; if (d > 30) g30++; }
  return { untouched_mean_diff: +(s / Math.max(1, n)).toFixed(2), untouched_share_gt30: +(g30 / Math.max(1, n)).toFixed(4) };
}
/* the picture for the PD's front/back question: lightened, the touching props outlined and numbered (long side 1536) */
export function numberedPicture(orig, W, H, objs, masks, pairs) {
  const s = 1536 / Math.max(W, H), vw = Math.round(W * s), vh = Math.round(H * s);
  const vis = I.resizeArea(orig, W, H, vw, vh, 3); const out = new Uint8Array(vw * vh * 4);
  for (let i = 0; i < vw * vh; i++) { for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.trunc(vis[i * 3 + c] * .75 + 255 * .25); out[i * 4 + 3] = 255; }
  const inpair = [...new Set(pairs.flat())].sort((a, b) => a - b); const rnd = I.mulberry32(3);
  const cols = new Map(inpair.map(i => [i, [40 + ((rnd() * 180) | 0), 40 + ((rnd() * 180) | 0), 40 + ((rnd() * 180) | 0)]]));
  for (const i of inpair) {                        // outer outline, 2 px
    const full = B.toFull(masks[i], W, H); const sm = I.resizeNearest(full, W, H, vw, vh, 1); const f = I.fillHolesAll(sm, vw, vh);
    const edge = new Uint8Array(vw * vh); for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) { const k = y * vw + x; if (!f[k]) continue; if (x === 0 || y === 0 || x === vw - 1 || y === vh - 1 || !f[k - 1] || !f[k + 1] || !f[k - vw] || !f[k + vw]) edge[k] = 1; }
    const e2 = I.dilate(edge, vw, vh, I.rect(1)); const c = cols.get(i);
    for (let k = 0; k < vw * vh; k++) if (e2[k] && (f[k] || edge[k])) { out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2]; }
  }
  for (const i of inpair) { const [x0, y0] = objs[i].mbox; drawNumber(out, vw, vh, String(i), Math.trunc(x0 * s) + 2, Math.trunc(y0 * s) + 2, cols.get(i)); }
  return { w: vw, h: vh, rgba: out };
}
