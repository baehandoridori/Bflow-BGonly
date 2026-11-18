/* BAE layer engine (v0.4.4), step 3 of 3 of the layer plan: the built layers -> the PSD the plan describes.
   Local only (no GPT), so it runs again in a moment whenever the artist changes the plan.
     OL / ML / UL folders (Photoshop folder colors orange / violet / blue), the names from the plan
     'one layer'  : the props of a bundle put together into one layer (back to front)
     merged       : a small prop goes into the layer of the prop it sits on
     not split    : the prop stays in the empty background (its own pixels are put back there)
     shadow       : on its own layer right under the prop, multiply (gray = how much darker); or kept in the prop
     UL           : the far view from the picture itself; the empty background is left open there
   Turning every layer on gives the picture again (checked: stack vs original). */
import * as B from './bm.js';
import { planView, BIN_INFO } from './planview.js';
import { tightLayer } from './psd.js';

function cutBox(L, box) {                          // a layer's RGBA moved into a bigger box
  const [x0, y0, x1, y1] = box, cw = x1 - x0, out = new Uint8Array(cw * (y1 - y0) * 4); const [a0, b0, a1, b1] = L.box, lw = a1 - a0;
  for (let y = b0; y < b1; y++) out.set(L.rgba.subarray(((y - b0) * lw) * 4, ((y - b0) * lw + lw) * 4), ((y - y0) * cw + a0 - x0) * 4);
  return out;
}

export function assemblePlan(built, plan) {
  const { W, H, orig, plate, res, far } = built; const N = W * H;
  const metaById = new Map(), rankById = {}, metaByKey = new Map(res.meta.map(m => [m.key, m]));
  res.stackKeys.forEach((k, r) => { const m = metaByKey.get(k); if (m && m.id != null) { metaById.set(m.id, m); rankById[m.id] = r; } });
  const pobjs = built.objs.filter(o => metaById.has(o.id)).map(o => ({ id: o.id, group: o.group, name: o.name, box: o.box }));
  const planX = Object.assign({}, plan, { added: (plan.added || []).filter(a => metaById.has(a.id)) });
  const view = planView(planX, pobjs, far.map(f => ({ id: f.id, name: f.name, box: f.box })), rankById);
  const L = (id) => res.layers.get(metaById.get(id).key);

  // ---- the empty background (ML, at the bottom): props left in it get their own pixels back; the far view is open ----
  const bg = new Uint8Array(N * 4); for (let i = 0; i < N; i++) { bg[i * 4] = plate[i * 3]; bg[i * 4 + 1] = plate[i * 3 + 1]; bg[i * 4 + 2] = plate[i * 3 + 2]; bg[i * 4 + 3] = 255; }
  const putBack = (m) => { if (!m || m.empty) return; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.d[y * m.w + x]) { const g = (y + m.y0) * W + x + m.x0; bg[g * 4] = orig[g * 3]; bg[g * 4 + 1] = orig[g * 3 + 1]; bg[g * 4 + 2] = orig[g * 3 + 2]; } };
  const left = view.skipped.filter(id => metaById.has(id)).map(id => ({ id, rank: rankById[id], vis: L(id).vis }));
  for (const s of left) { putBack(B.dil(s.vis, 1, W, H)); putBack(L(s.id).vsh); }
  const ul = []; let props = null;
  for (const fr of view.farRows) {
    const f = far.find(x => x.id === fr.head); if (!f || !f.mask || f.mask.empty) continue; const m = f.mask, box = m.box(), cw = box[2] - box[0];
    if (!props) { props = new Uint8Array(N); for (const k of res.stackKeys) { const Ly = res.layers.get(k); if (Ly && Ly.vis) B.orInto(props, B.dil(Ly.vis, 2, W, H), W); } }
    const rgba = new Uint8Array(cw * (box[3] - box[1]) * 4);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (!m.d[y * m.w + x]) continue; const g = (y + m.y0) * W + x + m.x0, q = (y * cw + x) * 4;
      const src = props[g] ? bg : null;            // where a prop stood in front of the view: the view GPT drew behind it, else the picture itself
      for (let c = 0; c < 3; c++) rgba[q + c] = src ? bg[g * 4 + c] : orig[g * 3 + c]; rgba[q + 3] = 255; bg[g * 4 + 3] = 0;
    }
    ul.push({ row: fr, box, rgba, shadow: null });
  }

  // ---- the layers of the plan ----
  function compose(row) {
    const ids = row.members.concat(row.merged).filter(id => metaById.has(id)).sort((a, b) => rankById[a] - rankById[b]); if (!ids.length) return null;
    const sep = row.shadow; const box = B.boxUnion(...ids.map(id => L(id).box)); const cw = box[2] - box[0], ch = box[3] - box[1], n = cw * ch;
    const acc = new Float32Array(n * 4); let sh = null;
    for (const id of ids) {
      const Ly = L(id); const src = cutBox({ box: Ly.box, rgba: sep ? Ly.body : Ly.rgba }, box);
      const cut = left.filter(s => s.rank > rankById[id]).map(s => s.vis);   // a prop left in the background in front of this one still covers it
      const blocked = cut.length ? B.union(cut) : null; const bd = blocked && !blocked.empty ? B.crop(blocked, box) : null;
      for (let k = 0; k < n; k++) {
        const a = src[k * 4 + 3] / 255; if (!a || (bd && bd[k])) continue;
        for (let c = 0; c < 3; c++) acc[k * 4 + c] = src[k * 4 + c] * a + acc[k * 4 + c] * (1 - a);
        acc[k * 4 + 3] = a + acc[k * 4 + 3] * (1 - a);
      }
      if (sep && Ly.shadow) {
        const s = cutBox({ box: Ly.box, rgba: Ly.shadow }, box); sh = sh || new Float32Array(n).fill(1);
        for (let k = 0; k < n; k++) if (s[k * 4 + 3] && !(bd && bd[k])) sh[k] *= s[k * 4] / 255;
      }
    }
    const rgba = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) { const a = acc[k * 4 + 3]; if (a <= 0) continue; for (let c = 0; c < 3; c++) rgba[k * 4 + c] = Math.min(255, Math.max(0, Math.round(acc[k * 4 + c] / a))); rgba[k * 4 + 3] = Math.round(a * 255); }
    let shadow = null;
    if (sh) { shadow = new Uint8Array(n * 4); let any = false; for (let k = 0; k < n; k++) if (sh[k] < 1) { const g = Math.round(255 * sh[k]); shadow[k * 4] = shadow[k * 4 + 1] = shadow[k * 4 + 2] = g; shadow[k * 4 + 3] = 255; any = true; } if (!any) shadow = null; }
    return { row, box, rgba, shadow };
  }
  const bins = { OL: [], ML: [], UL: ul };
  for (const r of view.rows) { const c = compose(r); if (c) bins[r.bin].push(c); }
  const extra = res.meta.filter(m => m.id == null && m.key !== 'bg').map(m => ({ m, rank: res.stackKeys.indexOf(m.key) })).sort((a, b) => a.rank - b.rank);   // 'BG 보정' and '기타 (자동 보충)'

  // ---- the PSD: children from the bottom up; in each folder back to front, a shadow right under its prop ----
  const layerOf = (name, box, rgba, more) => { const t = tightLayer({ box, rgba }); return t ? Object.assign({ name, left: t.left, top: t.top, right: t.right, bottom: t.bottom, imageData: { width: t.w, height: t.h, data: t.data } }, more || {}) : null; };
  const folderNames = {};
  function kidsOf(items, base) {
    const kids = base.slice(); let folder = null;
    for (const it of items) {
      const pair = [];
      if (it.shadow) { const s = layerOf(it.row.name + ' 그림자', it.box, it.shadow, { blendMode: 'multiply' }); if (s) pair.push(s); }
      const b = layerOf(it.row.name, it.box, it.rgba); if (b) pair.push(b); if (!pair.length) continue;
      if (it.row.folder) {
        if (!folder || folder.base !== it.row.folder) { const k = folderNames[it.row.folder] = (folderNames[it.row.folder] || 0) + 1; folder = { base: it.row.folder, node: { name: k === 1 ? it.row.folder : `${it.row.folder} (${k})`, opened: false, children: [] } }; kids.push(folder.node); }
        folder.node.children.push(...pair);
      } else { folder = null; kids.push(...pair); }
    }
    return kids;
  }
  const mlBase = [{ name: '배경 (빈 방)', left: 0, top: 0, right: W, bottom: H, imageData: { width: W, height: H, data: new Uint8ClampedArray(bg.buffer) } }];
  for (const e of extra) { const Ly = res.layers.get(e.m.key); const t = layerOf(e.m.name, Ly.box, Ly.rgba); if (t) mlBase.push(t); }
  const children = [];
  if (bins.UL.length) children.push({ name: 'UL', opened: true, layerColor: BIN_INFO.UL.psd, children: kidsOf(bins.UL, []) });
  children.push({ name: 'ML', opened: true, layerColor: BIN_INFO.ML.psd, children: kidsOf(bins.ML, mlBase) });
  if (bins.OL.length) children.push({ name: 'OL', opened: true, layerColor: BIN_INFO.OL.psd, children: kidsOf(bins.OL, []) });

  // ---- everything on, flattened: the PSD's preview, and the check against the picture ----
  const F = new Float32Array(N * 3);
  const over = (box, rgba) => { const [x0, y0, x1, y1] = box, cw = x1 - x0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = ((y - y0) * cw + x - x0) * 4, a = rgba[q + 3] / 255; if (!a) continue; const o = (y * W + x) * 3; for (let c = 0; c < 3; c++) F[o + c] = rgba[q + c] * a + F[o + c] * (1 - a); } };
  const mul = (box, rgba) => { const [x0, y0, x1, y1] = box, cw = x1 - x0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = ((y - y0) * cw + x - x0) * 4, a = rgba[q + 3] / 255; if (!a) continue; const o = (y * W + x) * 3; for (let c = 0; c < 3; c++) F[o + c] *= 1 - a + a * rgba[q + c] / 255; } };
  for (const it of bins.UL) over(it.box, it.rgba);
  over([0, 0, W, H], bg); for (const e of extra) { const Ly = res.layers.get(e.m.key); over(Ly.box, Ly.rgba); }
  for (const bin of ['ML', 'OL']) for (const it of bins[bin]) { if (it.shadow) mul(it.box, it.shadow); over(it.box, it.rgba); }
  const comp = new Uint8ClampedArray(N * 4); let sum = 0, g20 = 0;
  for (let i = 0; i < N; i++) { let d = 0; for (let c = 0; c < 3; c++) { const v = Math.min(255, Math.max(0, Math.round(F[i * 3 + c]))); comp[i * 4 + c] = v; const e = Math.abs(v - orig[i * 3 + c]); sum += e; d = Math.max(d, e); } comp[i * 4 + 3] = 255; if (d > 20) g20++; }
  const psd = { width: W, height: H, children, imageData: { width: W, height: H, data: comp } };
  const names = { OL: bins.OL.map(it => it.row.name), ML: bins.ML.map(it => it.row.name), UL: bins.UL.map(it => it.row.name) };
  const check = (res.report.check || []).filter(n => { const m = res.meta.find(x => x.name === n); return !m || !view.skipped.includes(m.id); });
  const summary = { W, H, layers: bins.OL.length + bins.ML.length + bins.UL.length, shadows: bins.OL.concat(bins.ML).filter(it => it.shadow).length, extra: extra.map(e => e.m.name),
    bins: { OL: bins.OL.length, ML: bins.ML.length, UL: bins.UL.length }, names, left: view.skipped.length, merged: [...view.merges.values()].reduce((s, v) => s + v.length, 0),
    stack: { mean_diff: +(sum / (N * 3)).toFixed(2), share_gt20: +(g20 / N).toFixed(4) }, check, lost: res.report.lost_in_outline || {} };
  return { psd, summary, comp, bg, items: bins.UL.concat(bins.ML, bins.OL) };
}
