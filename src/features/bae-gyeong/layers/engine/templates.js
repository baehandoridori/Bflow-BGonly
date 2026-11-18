/* BAE layer engine: flat color areas, 'looks like the floor around it', and whole-object templates
   (port of the Python prototype's t5_templates.py; per-object masks are box masks, see bm.js).
   Flat illustrations are made of flat color areas. Cutting along those areas (not pixel by pixel) gives clean edges,
   and a gap that shows the floor through a chair is one area that either goes or stays as a whole. */
import * as I from './img.js';
import * as B from './bm.js';

/* ---------- crops ---------- */
export function cropM(m, W, b) { const w = b[2] - b[0], h = b[3] - b[1], o = new Uint8Array(w * h); for (let y = 0; y < h; y++) o.set(m.subarray((y + b[1]) * W + b[0], (y + b[1]) * W + b[2]), y * w); return o; }
export function cropRGB(rgb, W, b) { const w = b[2] - b[0], h = b[3] - b[1], o = new Uint8Array(w * h * 3); for (let y = 0; y < h; y++) o.set(rgb.subarray(((y + b[1]) * W + b[0]) * 3, ((y + b[1]) * W + b[2]) * 3), y * w * 3); return o; }
export function cropI32(a, W, b) { const w = b[2] - b[0], h = b[3] - b[1], o = new Int32Array(w * h); for (let y = 0; y < h; y++) o.set(a.subarray((y + b[1]) * W + b[0], (y + b[1]) * W + b[2]), y * w); return o; }
export function pasteM(dst, W, b, sub) { const w = b[2] - b[0], h = b[3] - b[1]; for (let y = 0; y < h; y++) dst.set(sub.subarray(y * w, (y + 1) * w), (y + b[1]) * W + b[0]); return dst; }

/* ---------- areas inside a mask: per-area numbers ---------- */
export function regions(lbl) {                    // labels -> {inv (0..n-1, in sorted label order like np.unique), ids, n, cnt}
  const map = new Map(); const inv = new Int32Array(lbl.length); const ids = [];
  for (let i = 0; i < lbl.length; i++) { const v = lbl[i]; let k = map.get(v); if (k === undefined) { k = ids.length; map.set(v, k); ids.push(v); } inv[i] = k; }
  const order = ids.map((v, k) => [v, k]).sort((a, b) => a[0] - b[0]); const re = new Int32Array(ids.length); order.forEach(([, k], r) => { re[k] = r; });
  for (let i = 0; i < inv.length; i++) inv[i] = re[inv[i]];
  const n = ids.length; const cnt = new Int32Array(n); for (let i = 0; i < inv.length; i++) cnt[inv[i]]++;
  return { inv, ids: order.map(o => o[0]), n, cnt };
}
export function regionMedians(inv, n, vals, ch) { // per area, per channel median (numpy: mean of the two middle values)
  const cnt = new Int32Array(n); for (let i = 0; i < inv.length; i++) cnt[inv[i]]++;
  const start = new Int32Array(n + 1); for (let r = 0; r < n; r++) start[r + 1] = start[r] + cnt[r];
  const out = new Float64Array(n * ch); const buf = new Float64Array(inv.length); const pos = new Int32Array(n);
  for (let c = 0; c < ch; c++) {
    pos.set(start.subarray(0, n));
    for (let i = 0; i < inv.length; i++) buf[pos[inv[i]]++] = vals[i * ch + c];
    for (let r = 0; r < n; r++) {
      const a = start[r], b = start[r + 1]; if (b <= a) { out[r * ch + c] = NaN; continue; }
      const s = buf.subarray(a, b).sort(); const k = b - a; out[r * ch + c] = k % 2 ? s[(k - 1) >> 1] : (s[k / 2 - 1] + s[k / 2]) / 2;
    }
  }
  return out;
}
export const minDist = (p, o, centers) => { let best = Infinity; for (let k = 0; k < centers.length; k += 3) { const a = p[o] - centers[k], b = p[o + 1] - centers[k + 1], c = p[o + 2] - centers[k + 2]; const d = Math.sqrt(a * a + b * b + c * c); if (d < best) best = d; } return best; };
export function labMedian(rgb, cropMask, n) {      // per-channel median of the Lab colors under a mask (np.median(lab(orig[m]), 0))
  const px = []; for (let i = 0; i < n; i++) if (cropMask[i]) px.push(i);
  const L = new Float32Array(px.length * 3); const t = [0, 0, 0];
  px.forEach((i, k) => { I.lab1(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], t); L[k * 3] = t[0]; L[k * 3 + 1] = t[1]; L[k * 3 + 2] = t[2]; });
  return [0, 1, 2].map(c => I.median(Array.from({ length: px.length }, (_, k) => L[k * 3 + c])));
}

/* the parts of A that are floor/wall seen through it: flat areas whose color is the color around A (and not A's own),
   when they are a real gap (thicker than a drawn line) or the rim of such a gap / of the outside.
   plate: the empty background; an area that has the empty background's color at the same place is background too.
   holesOnly: a thick floor-colored area counts only when it has the empty background's color right there. */
export function backgroundParts(A, img, seg, W, H, { exclude = null, ringPx = 18, plate = null, holesOnly = false, paletteGaps = true, silhouette = false } = {}) {
  if (!A || A.empty) return new B.BM(); const cb = B.pad(A, ringPx + 12, W, H);
  const cw = cb[2] - cb[0], chh = cb[3] - cb[1], n = cw * chh;
  const sub = cropRGB(img, W, cb), mm = B.crop(A, cb), L = I.labOf(sub, n), sg = cropI32(seg, W, cb);
  const ring = I.andNot(I.dil(mm, cw, chh, ringPx), I.dil(mm, cw, chh, 4));
  if (exclude) I.andNotInto(ring, exclude instanceof B.BM ? B.crop(exclude, cb) : cropM(exclude, W, cb));
  if (I.count(ring) < 30 || I.count(mm) < 30) return new B.BM();
  const bgc = I.labOfFloat(I.kcenters(I.pick(sub, ring, cw, chh), 8));
  const core = I.ero(mm, cw, chh, 3); for (let i = 0; i < n; i++) if (core[i] && !(minDist(L, i * 3, bgc) > 12)) core[i] = 0;
  if (I.count(core) < 30) return new B.BM();
  const fgc = I.labOfFloat(I.kcenters(I.pick(sub, core, cw, chh), 8));
  const lbl = new Int32Array(n); for (let i = 0; i < n; i++) lbl[i] = mm[i] ? sg[i] + 1 : 0;
  const { inv, ids, n: nr, cnt } = regions(lbl);
  const mean = new Float64Array(nr * 3); for (let i = 0; i < n; i++) { const r = inv[i] * 3; mean[r] += L[i * 3]; mean[r + 1] += L[i * 3 + 1]; mean[r + 2] += L[i * 3 + 2]; }
  for (let r = 0; r < nr; r++) for (let c = 0; c < 3; c++) mean[r * 3 + c] /= Math.max(cnt[r], 1);
  const bnd = new Uint8Array(n);                   // 1 where an area meets another (both sides)
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) { const i = y * cw + x; if (x + 1 < cw && inv[i] !== inv[i + 1]) { bnd[i] = 1; bnd[i + 1] = 1; } if (y + 1 < chh && inv[i] !== inv[i + cw]) { bnd[i] = 1; bnd[i + cw] = 1; } }
  const { dist } = I.edt(I.not(bnd), cw, chh);
  const mx = new Float64Array(nr); for (let i = 0; i < n; i++) if (dist[i] > mx[inv[i]]) mx[inv[i]] = dist[i];
  const thick = new Uint8Array(nr); for (let r = 0; r < nr; r++) thick[r] = mx[r] >= 2.0 ? 1 : 0;
  const bglike = new Uint8Array(nr);
  for (let r = 0; r < nr; r++) { if (ids[r] === 0) continue; const db = minDist(mean, r * 3, bgc), df = minDist(mean, r * 3, fgc); bglike[r] = (db < 8 && df > db + 4) ? 1 : 0; }
  const outside = I.not(I.fillHolesAll(mm, cw, chh));
  const drop = new Uint8Array(nr);
  if (!(holesOnly || !paletteGaps)) for (let r = 0; r < nr; r++) if (bglike[r] && thick[r]) drop[r] = 1;
  const thin = new Uint8Array(nr); for (let r = 0; r < nr; r++) if (bglike[r] && !thick[r]) thin[r] = 1;
  const kept = []; let pdist = null, pthr = Infinity;
  if (plate) {
    const psub = cropRGB(plate, W, cb), Lp = I.labOf(psub, n);
    const medp = regionMedians(inv, nr, Lp, 3), medo = regionMedians(inv, nr, L, 3);
    const so = regionMedians(inv, nr, sub, 3), sp = regionMedians(inv, nr, psub, 3);
    // silhouette (v0.4.2): a part of the object that only LOOKS like the empty background behind it (a white pot in
    // front of a white wall) is not a gap. The empty background is GPT's redraw, so it never matches the picture
    // exactly; next to the object we measure how closely it usually matches. A real gap matches about that closely,
    // the white pot clearly worse. Clearly darker areas are shadows on the background and still go (drawn back as soft
    // shadows), and small specks or pieces inside the object are judged as before.
    let free = null, dOut = null, area = 0, thr = 7;
    if (silhouette) {
      const ex = exclude ? (exclude instanceof B.BM ? B.crop(exclude, cb) : cropM(exclude, W, cb)) : null;
      free = new Uint8Array(n); for (let i = 0; i < n; i++) free[i] = (!mm[i] && !(ex && ex[i])) ? 1 : 0;
      dOut = I.edt(I.not(free), cw, chh).dist; area = I.count(mm);
      // how closely the empty background matches the picture right around the object (6-16 px out): GPT redraws it,
      // so even the untouched wall differs a little. An area that differs from it much more than that is not explained
      // by the empty background, so it is not background seen through
      const far = I.dil(mm, cw, chh, 16), close = I.dil(mm, cw, chh, 5); const dd = [];
      for (let i = 0; i < n; i++) if (far[i] && !close[i] && free[i]) dd.push(Math.hypot(L[i * 3] - Lp[i * 3], L[i * 3 + 1] - Lp[i * 3 + 1], L[i * 3 + 2] - Lp[i * 3 + 2]));
      if (dd.length >= 40) thr = Math.min(7, Math.max(3.5, 2 * I.median(dd)));
    }
    if (silhouette) { pthr = thr; pdist = new Float64Array(nr); for (let r = 0; r < nr; r++) pdist[r] = (medo[r * 3] - medp[r * 3] > -8) ? Math.hypot(medo[r * 3] - medp[r * 3], medo[r * 3 + 1] - medp[r * 3 + 1], medo[r * 3 + 2] - medp[r * 3 + 2]) : 0; }   // clearly darker rims (shadows, dark edges) count as explained
    // first: which candidate areas does the empty background not explain? (pieces of one pot can be many small areas)
    const cand = new Uint8Array(nr), unexp = new Uint8Array(nr), dif = new Float64Array(nr), dLs = new Float64Array(nr);
    for (let r = 0; r < nr; r++) {
      if (ids[r] === 0 || cnt[r] < 12) continue;
      const a = medo[r * 3] - medp[r * 3], b = medo[r * 3 + 1] - medp[r * 3 + 1], c = medo[r * 3 + 2] - medp[r * 3 + 2];
      const same = Math.sqrt(a * a + b * b + c * c) < 7;
      const rt = [0, 1, 2].map(k => (so[r * 3 + k] + 3) / (sp[r * 3 + k] + 3)); const rm = (rt[0] + rt[1] + rt[2]) / 3;
      const shade = rm > .5 && rm < .97 && Math.max(...rt.map(v => Math.abs(v - rm))) < .06;
      if (!((same || shade) && thick[r])) continue;
      cand[r] = 1; dif[r] = Math.sqrt(a * a + b * b + c * c); dLs[r] = a;
      if (silhouette && dif[r] > thr && a > -8) unexp[r] = 1;   // (v0.4.2) not explained, not clearly darker (a shadow)
    }
    // (v0.4.2) unexplained areas that together make a big piece on the object's outline are the object's own part:
    // a white pot in front of a white wall. Small specks and pieces inside the object are judged as before.
    const keepR = new Uint8Array(nr);
    if (silhouette && unexp.some(v => v)) {
      const um = new Uint8Array(n); for (let i = 0; i < n; i++) if (mm[i] && unexp[inv[i]]) um[i] = 1;
      const { lab, n: nc, stats } = I.components(um, cw, chh, 8); const touch = new Int32Array(nc + 1);
      for (let i = 0; i < n; i++) if (lab[i] && dOut[i] <= 5) touch[lab[i]]++;
      const okC = new Uint8Array(nc + 1); for (let k = 1; k <= nc; k++) okC[k] = stats[k][0] >= Math.max(150, .02 * area) && touch[k] >= 40 ? 1 : 0;
      const inOk = new Int32Array(nr); for (let i = 0; i < n; i++) if (lab[i] && okC[lab[i]]) inOk[inv[i]]++;
      for (let r = 0; r < nr; r++) if (unexp[r] && inOk[r] * 2 >= cnt[r]) keepR[r] = 1;
    }
    // the pieces between and around the kept part (a lighter spot on the pot, its rim) belong to it too: everything
    // inside the kept part's closed outline stays, also the thin rims
    if (keepR.some(v => v)) {
      const K = new Uint8Array(n); for (let i = 0; i < n; i++) if (mm[i] && keepR[inv[i]]) K[i] = 1;
      const Kc = I.fillHolesAll(I.close(K, cw, chh, I.ellipse(8)), cw, chh); const inK = new Int32Array(nr);
      for (let i = 0; i < n; i++) if (mm[i] && Kc[i]) inK[inv[i]]++;
      for (let r = 0; r < nr; r++) if (ids[r] !== 0 && !keepR[r] && inK[r] * 10 >= cnt[r] * 7) { keepR[r] = 2; thin[r] = 0; }
    }
    for (let r = 0; r < nr; r++) {
      if (!cand[r]) continue;
      if (keepR[r]) { kept.push({ px: cnt[r], diff: +dif[r].toFixed(2), usual: +(thr / 2).toFixed(2), dL: +dLs[r].toFixed(2) }); continue; }
      drop[r] = 1;
    }
  }
  for (let it = 0; it < 4; it++) {                 // rims of gaps and of the outside go too
    const seed = new Uint8Array(n); for (let i = 0; i < n; i++) seed[i] = (drop[inv[i]] || outside[i]) ? 1 : 0;
    const touch = I.dil(seed, cw, chh, 1); let more = false;
    const seen = new Uint8Array(nr); for (let i = 0; i < n; i++) if (touch[i]) seen[inv[i]] = 1;
    for (let r = 0; r < nr; r++) if (seen[r] && thin[r]) { if (pdist && kept.length && pdist[r] > pthr) { thin[r] = 0; continue; } drop[r] = 1; thin[r] = 0; more = true; }   // (v0.4.2) next to a kept part: only rims the empty background explains
    if (!more) break;
  }
  const s2 = new Uint8Array(n); for (let i = 0; i < n; i++) s2[i] = drop[inv[i]] && mm[i] ? 1 : 0;
  const out = B.fromCrop(s2, cb); out.kept = kept; return out;
}

/* the whole member cut from GPT's picture: one piece, without the floor/wall showing through its gaps */
export function cleanTemplate(m, img, W, H, plate, segFn) {
  const cb0 = B.pad(m, 4, W, H), cw0 = cb0[2] - cb0[0], ch0 = cb0[3] - cb0[1]; const sub0 = B.crop(m, cb0);
  const { lab, n, stats } = I.components(sub0, cw0, ch0, 8); if (!n) return m;
  let big = 1; for (let c = 2; c <= n; c++) if (stats[c][0] > stats[big][0]) big = c;
  const core = new Uint8Array(cw0 * ch0); for (let i = 0; i < core.length; i++) core[i] = lab[i] === big ? 1 : 0;
  const d3 = I.dil(core, cw0, ch0, 3); for (let i = 0; i < core.length; i++) core[i] = core[i] | (d3[i] & sub0[i]);
  const m2 = B.fromCrop(core, cb0);
  const cb = B.pad(m2, 40, W, H); const seg = new Int32Array(W * H);
  const cw = cb[2] - cb[0], ch = cb[3] - cb[1]; const s = segFn(cropRGB(img, W, cb), cw, ch);
  for (let y = 0; y < ch; y++) seg.set(s.subarray(y * cw, (y + 1) * cw), (y + cb[1]) * W + cb[0]);
  const drop = backgroundParts(m2, img, seg, W, H, { holesOnly: true, plate });
  return B.andNot(m2, drop);
}

/* where template Tm (mask) / Trgb (colors) sits on a member: it has to cover what the member shows (V), and it is
   scored by how many of its pixels have the same color in the picture, minus pixels with a wrong color where nothing
   stands in front of the member (O = what stands in front).
   The prototype tried every scale and every position at full size (OpenCV's FFT template matching). Here the same
   score is searched in two passes: every scale on a quarter-size grid, then the best few at full size around the
   winner. */
export function place(Tm, Trgb, tw0, th0, Vbm, Obm, orig, W, H, { scales = [.6, 1.45], coarse = 4, keep = 6 } = {}) {
  if (!Vbm || Vbm.empty) return null; const Vn = Math.max(1, B.count(Vbm)); const vb = Vbm.box();
  const maxS = scales[1], tmaxW = Math.round(tw0 * maxS) + 2, tmaxH = Math.round(th0 * maxS) + 2;
  const win = [Math.max(0, vb[0] - tmaxW), Math.max(0, vb[1] - tmaxH), Math.min(W, vb[2] + tmaxW), Math.min(H, vb[3] + tmaxH)];
  const ww = win[2] - win[0], wh = win[3] - win[1];
  const V = B.crop(Vbm, win), O = B.crop(Obm, win); const dV3 = I.dil(V, ww, wh, 3);
  const forb = new Uint8Array(ww * wh); for (let i = 0; i < ww * wh; i++) forb[i] = (V[i] | O[i] | dV3[i]) ? 0 : 1;
  const cen = I.kcenters(I.pick(Trgb, Tm, tw0, th0), 6); const K = cen.length / 3;
  const cheb = (rgb, o, k) => Math.max(Math.abs(rgb[o] - cen[k * 3]), Math.abs(rgb[o + 1] - cen[k * 3 + 1]), Math.abs(rgb[o + 2] - cen[k * 3 + 2]));
  const tl = new Uint8Array(tw0 * th0); for (let i = 0; i < tw0 * th0; i++) { let bd = Infinity, bk = 0; for (let k = 0; k < K; k++) { const d = cheb(Trgb, i * 3, k); if (d < bd) { bd = d; bk = k; } } tl[i] = bk; }
  const Lim = new Int8Array(ww * wh);              // the picture pixel's template color, -1 when none is near (>= 26)
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) { const gi = (y + win[1]) * W + x + win[0]; let bd = Infinity, bk = -1; for (let k = 0; k < K; k++) { const d = cheb(orig, gi * 3, k); if (d < bd) { bd = d; bk = k; } } Lim[y * ww + x] = bd < 26 ? bk : -1; }
  const SI = new Int32Array((ww + 1) * (wh + 1)); // integral image of V: the most a template box could cover
  for (let y = 0; y < wh; y++) { let s = 0; for (let x = 0; x < ww; x++) { s += V[y * ww + x]; SI[(y + 1) * (ww + 1) + x + 1] = SI[y * (ww + 1) + x + 1] + s; } }
  const boxV = (x0, y0, x1, y1) => SI[y1 * (ww + 1) + x1] - SI[y0 * (ww + 1) + x1] - SI[y1 * (ww + 1) + x0] + SI[y0 * (ww + 1) + x0];
  const cacheT = new Map();
  function scaled(s, step) {                       // one scale of the template as (dx, dy, color) lists; colors with < 20 px do not count
    const key = s.toFixed(4) + ':' + step; if (cacheT.has(key)) return cacheT.get(key);
    const th = Math.round(th0 * s), tw = Math.round(tw0 * s); if (th < 8 || tw < 8) { cacheT.set(key, null); return null; }
    const Tf = I.resizeLinear(Float32Array.from(Tm), tw0, th0, tw, th, 1); const Tl = I.resizeNearest(tl, tw0, th0, tw, th, 1);
    const ccount = new Int32Array(K); let nT = 0; for (let i = 0; i < tw * th; i++) if (Tf[i] > .5) { ccount[Tl[i]]++; nT++; }
    const pts = []; for (let y = 0; y < th; y += step) for (let x = 0; x < tw; x += step) { const i = y * tw + x; if (Tf[i] > .5) pts.push(x, y, ccount[Tl[i]] >= 20 ? Tl[i] : -2); }
    const r = { s, tw, th, pts: Int32Array.from(pts), nT, Tf }; cacheT.set(key, r); return r;
  }
  function scoreAt(t, px, py, step) {              // px, py in window coordinates
    const p = t.pts; let R1 = 0, AG = 0, DIS = 0;
    for (let k = 0; k < p.length; k += 3) { const i = (py + p[k + 1]) * ww + px + p[k]; R1 += V[i]; const c = p[k + 2]; if (c === -2) continue; if (Lim[i] === c) AG++; else if (!O[i]) DIS++; }
    const f = step * step; return { R1: R1 * f, AG: AG * f, DIS: DIS * f };
  }
  const vx0 = vb[0] - win[0], vy0 = vb[1] - win[1], vx1 = vb[2] - win[0], vy1 = vb[3] - win[1];
  const range = (tw, th) => [Math.max(0, vx0 - tw), Math.max(0, vy0 - th), Math.min(ww, vx1 + tw) - tw, Math.min(wh, vy1 + th) - th];
  const scList = []; for (let i = 0; ; i++) { const s = scales[0] + i * .02; if (s >= scales[1] - 1e-9) break; scList.push(+s.toFixed(10)); }
  const cand = [];                                 // pass 1: quarter-size grid over every scale
  for (const s of scList) {
    const t = scaled(s, coarse); if (!t) continue; const { tw, th } = t; const [ax, ay, bx, by] = range(tw, th); if (bx < ax || by < ay) continue;
    let best = null;
    for (let py = ay; py <= by; py += coarse) for (let px = ax; px <= bx; px += coarse) {
      if (boxV(px, py, px + tw, py + th) < .8 * Vn) continue;
      const r = scoreAt(t, px, py, coarse); if (r.R1 < .7 * Vn) continue;
      const sc = (r.AG - 1.5 * r.DIS) / Vn; if (!best || sc > best.sc) best = { sc, s, px, py, tw, th };
    }
    if (best) cand.push(best);
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.sc - a.sc);
  let best = null; const tried = new Set();         // pass 2: full size around the best few (scale +-0.04, same center)
  for (const c of cand.slice(0, keep)) for (let ds = -2; ds <= 2; ds++) {
    const s = +(c.s + ds * .02).toFixed(10); if (s < scales[0] - 1e-9 || s >= scales[1] - 1e-9) continue;
    const t = scaled(s, 1); if (!t) continue; const { tw, th } = t; const [ax, ay, bx, by] = range(tw, th); if (bx < ax || by < ay) continue;
    const cx = Math.round(c.px + (c.tw - tw) / 2), cy = Math.round(c.py + (c.th - th) / 2);
    const rx = coarse + 2 + Math.ceil(Math.abs(c.tw - tw) / 2), ry = coarse + 2 + Math.ceil(Math.abs(c.th - th) / 2);
    for (let py = Math.max(ay, cy - ry); py <= Math.min(by, cy + ry); py++) for (let px = Math.max(ax, cx - rx); px <= Math.min(bx, cx + rx); px++) {
      const key = s + ':' + px + ':' + py; if (tried.has(key)) continue; tried.add(key);
      if (boxV(px, py, px + tw, py + th) < .8 * Vn) continue;
      const r = scoreAt(t, px, py, 1); if (r.R1 / Vn < .8) continue;
      const sc = (r.AG - 1.5 * r.DIS) / Vn;
      if (!best || sc > best.score || (sc === best.score && (s < best.s || (s === best.s && (py < best.py || (py === best.py && px < best.px)))))) {
        let R2 = 0; const p = t.pts; for (let k = 0; k < p.length; k += 3) R2 += forb[(py + p[k + 1]) * ww + px + p[k]];
        best = { score: sc, s, px, py, cover: r.R1 / Vn, spill: R2 / t.nT, agree: r.AG / t.nT, t };
      }
    }
  }
  if (!best) return null;
  const { t } = best; const { tw, th } = t; let px = best.px + win[0], py = best.py + win[1];
  const Ts = new Uint8Array(tw * th); for (let i = 0; i < tw * th; i++) Ts[i] = t.Tf[i] > .5 ? 1 : 0;
  const Trs = I.resizeArea(Trgb, tw0, th0, tw, th, 3);
  const Ve = B.ero(Vbm, 1, W, H); let bestc = null;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {   // last +-2 px: where the colors agree best
    const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx + tw > W || qy + th > H) continue;
    let nOv = 0, sum = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const ti = y * tw + x; if (!Ts[ti] || !B.get(Ve, qx + x, qy + y)) continue; const gi = (qy + y) * W + qx + x;
      nOv++; sum += Math.max(Math.abs(Trs[ti * 3] - orig[gi * 3]), Math.abs(Trs[ti * 3 + 1] - orig[gi * 3 + 1]), Math.abs(Trs[ti * 3 + 2] - orig[gi * 3 + 2]));
    }
    if (nOv < 50) continue; const cd = sum / nOv; if (!bestc || cd < bestc[0]) bestc = [cd, qx, qy];
  }
  let cd = 999; if (bestc) { cd = bestc[0]; px = bestc[1]; py = bestc[2]; }
  const box = [px, py, px + tw, py + th];
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return { score: r3(best.score), scale: r3(best.s), x: px, y: py, cover: r3(best.cover), spill: r3(best.spill), agree: r3(best.agree), color_diff: Math.round(cd * 10) / 10,
           M: B.fromCrop(Ts, box), C: { box, rgb: Trs } };
}
export function cAt(C, x, y, out) {               // placed template color at a picture pixel
  const [x0, y0, x1] = C.box; const i = ((y - y0) * (x1 - x0) + x - x0) * 3; out[0] = C.rgb[i]; out[1] = C.rgb[i + 1]; out[2] = C.rgb[i + 2]; return out;
}

/* (ok, zone): zone = the placed template grown a little; ok = pixels in it whose color is the template's color
   within r px (the template may sit 1-3 px off) */
export function compatMap(M, C, orig, W, H, { tol = 40, r = 3, grow = 2 } = {}) {
  const cb = B.pad(M, grow + r + 2, W, H); const cw = cb[2] - cb[0], ch = cb[3] - cb[1];
  const best = new Int16Array(cw * ch).fill(999); const m = B.crop(M, cb); const cw0 = C.box[2] - C.box[0];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    for (let y = 0; y < ch; y++) {
      const sy = y + dy; if (sy < 0 || sy >= ch) continue;
      for (let x = 0; x < cw; x++) {
        const sx = x + dx; if (sx < 0 || sx >= cw || !m[sy * cw + sx]) continue;
        const gx = sx + cb[0], gy = sy + cb[1]; const ci = ((gy - C.box[1]) * cw0 + gx - C.box[0]) * 3; const oi = ((y + cb[1]) * W + x + cb[0]) * 3;
        const d = Math.max(Math.abs(orig[oi] - C.rgb[ci]), Math.abs(orig[oi + 1] - C.rgb[ci + 1]), Math.abs(orig[oi + 2] - C.rgb[ci + 2]));
        if (d < best[y * cw + x]) best[y * cw + x] = d;
      }
    }
  }
  const z = I.dil(m, cw, ch, grow); const ok = new Uint8Array(cw * ch); for (let i = 0; i < cw * ch; i++) ok[i] = z[i] && best[i] < tol ? 1 : 0;
  return { ok: B.fromCrop(ok, cb), zone: B.fromCrop(z, cb) };
}

/* flat color areas that touch the zone and are mostly (over the WHOLE area) explained by the group's templates:
   returned clipped to the zone. A desk's big grey shelf crossed by a chair leg is not taken; the leg is. */
export function takeAreas(zone, okAll, seg, W, H, minFrac = .5) {
  if (!zone || zone.empty) return new B.BM(); const b0 = zone.box();
  const idsIn = new Set(); for (let y = 0; y < zone.h; y++) for (let x = 0; x < zone.w; x++) if (zone.d[y * zone.w + x]) idsIn.add(seg[(y + zone.y0) * W + x + zone.x0]);
  const cb = [Math.max(0, b0[0] - 60), Math.max(0, b0[1] - 60), Math.min(W, b0[2] + 60), Math.min(H, b0[3] + 60)];
  const tot = new Map(), okc = new Map();
  for (let y = cb[1]; y < cb[3]; y++) for (let x = cb[0]; x < cb[2]; x++) { const i = y * W + x, s = seg[i]; if (!idsIn.has(s)) continue; tot.set(s, (tot.get(s) || 0) + 1); if (okAll[i]) okc.set(s, (okc.get(s) || 0) + 1); }
  const take = new Set(); for (const [s, n] of tot) if ((okc.get(s) || 0) / n >= minFrac) take.add(s);
  const o = new Uint8Array(zone.w * zone.h); for (let y = 0; y < zone.h; y++) for (let x = 0; x < zone.w; x++) { const k = y * zone.w + x; if (zone.d[k] && take.has(seg[(y + zone.y0) * W + x + zone.x0])) o[k] = 1; }
  return B.fromCrop(o, b0);
}
