/* BAE layer engine (v0.4.4), step 1 of 3 of the layer plan: find the props for the plan screen.
   The PD lists and boxes the props (with where each probably goes: OL in front of the characters, ML behind them,
   the bigger prop a small one sits on, and the far view for UL); SAM outlines each box on the picture. No empty
   background yet, so this step costs only the PD call (about 10 won) and a few seconds on this computer.
   The artist then fixes the plan on the plan screen (planview.js) and the split follows it (split.js, assemble.js). */
import * as I from './img.js';
import * as B from './bm.js';
import * as J from './gptjobs.js';
import { clean } from './prep.js';
import { workingSize } from './pipeline.js';

export const DEFAULT_PICK = 3;                     // outline candidates: 0-2 = SAM's three answers, 3 = its single answer

export async function pdPictureOf(orig, W, H, codec) {   // what the PD sees: long side 1024
  const s = 1024 / Math.max(W, H), pw = Math.round(W * s), ph = Math.round(H * s);
  return { pw, ph, url: await codec.toDataUrl(I.resizeArea(orig, W, H, pw, ph, 3), pw, ph, true) };
}
function boxIn(box, scale, W, H) {
  const b0 = (box || []).slice(0, 4).map(v => +v * scale); if (b0.length < 4 || b0.some(v => !isFinite(v))) return null;
  const b = [Math.max(0, Math.min(W - 1, b0[0])), Math.max(0, Math.min(H - 1, b0[1])), Math.max(0, Math.min(W - 1, b0[2])), Math.max(0, Math.min(H - 1, b0[3]))];
  return b[2] - b[0] < 4 || b[3] - b[1] < 4 ? null : b;
}
/* the PD's answer -> props and far areas with ids and boxes in working pixels (ids stay the same for the same answer) */
export function normalizeInventory(inv, scale, W, H) {
  const see = new Map((inv.groups || []).map(g => [g.group, !!g.see_through]));
  const objs = [], far = []; let dropped = 0;
  (inv.objects || []).forEach((o, i) => {
    const b = boxIn(o.box, scale, W, H); if (!b) { dropped++; return; }
    objs.push({ id: 'o' + i, group: o.group, name: o.name, en: o.en, box: b, layer: o.layer === 'OL' ? 'OL' : 'ML', on: o.on || '', see_through: see.get(o.group) || false });
  });
  (inv.far || []).forEach((f, i) => { const b = boxIn(f.box, scale, W, H); if (b) far.push({ id: 'f' + i, name: f.name, en: f.en, box: b }); });
  return { objs, far, dropped };
}
/* the four outlines findOutlines weighs for a box, cleaned the same way */
export async function outlineCands(sam, box, W, H) {
  const a = await sam.predictAll({ box });
  return a.multi.map(c => clean(c.mask, W, H)).concat([clean(a.single.mask, W, H)]);
}
/* masks to the page and back: one bit per pixel */
export function packBM(m) {
  if (!m || m.empty) return null; const n = m.w * m.h, bits = new Uint8Array((n + 7) >> 3);
  for (let i = 0; i < n; i++) if (m.d[i]) bits[i >> 3] |= 1 << (i & 7);
  return { x0: m.x0, y0: m.y0, w: m.w, h: m.h, bits };
}
export function unpackBM(p) {
  if (!p) return new B.BM(); const n = p.w * p.h, d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = (p.bits[i >> 3] >> (i & 7)) & 1;
  return new B.BM(p.x0, p.y0, p.w, p.h, d);
}

export async function planLayers({ image, notes = '', gpt, codec, sam, store = null, onStep = () => {}, log = () => {}, signal = null }) {
  const t0 = Date.now(); let usd = 0; const costs = {};
  const check = () => { if (signal && signal.aborted) { const e = new Error('그만뒀어요'); e.name = 'AbortError'; throw e; } };
  const S = store || { get: async () => undefined, set: async () => {} };
  const { W, H } = workingSize(image.w, image.h);
  const orig = (W === image.w && H === image.h) ? image.rgb : I.resizeArea(image.rgb, image.w, image.h, W, H, 3);
  const pd = await pdPictureOf(orig, W, H, codec); const scale = W / pd.pw;
  onStep('inventory', 'run'); check();
  let inv = await S.get('p4.inventory');
  if (!inv) {
    const r = await gpt.pd({ prompt: J.inventoryPrompt2(pd.pw, pd.ph, notes), images: [{ label: 'Image A:', url: pd.url, detail: 'high' }], schema: J.INVENTORY_SCHEMA2, name: 'inventory', signal });
    inv = r.json; if (r.usd) { usd += r.usd; costs.inventory = r.usd; } await S.set('p4.inventory', inv);
  }
  const { objs, far, dropped } = normalizeInventory(inv, scale, W, H);
  if (!objs.length && !far.length) throw new Error('PD가 나눌 물건을 찾지 못했어요.');
  onStep('inventory', 'ok', { props: objs.length, groups: (inv.groups || []).length, far: far.length });
  onStep('outlines', 'run'); check();
  await sam.setImage('orig', orig, W, H);
  const all = objs.concat(far);
  for (let i = 0; i < all.length; i++) { check(); all[i].cands = await outlineCands(sam, all[i].box, W, H); onStep('outlines', 'run', { done: i + 1, total: all.length }); }
  const usable = (o) => o.cands.some(c => B.count(c) >= 60);
  const keep = objs.filter(usable), keepFar = far.filter(usable);
  log(`plan: ${keep.length} props (${objs.length - keep.length + dropped} dropped), far ${keepFar.length}`);
  onStep('outlines', 'ok', { props: keep.length, far: keepFar.length });
  return { W, H, pw: pd.pw, ph: pd.ph, scale, orig, pdUrl: pd.url, inventory: inv, groups: inv.groups || [], background_en: inv.background_en || '', objs: keep, far: keepFar, usd, costs, sec: Math.round((Date.now() - t0) / 1000) };
}

/* a prop the artist boxed: SAM outlines it, the PD names it in English (so GPT can take it away) */
export async function addObject({ P, box, name = '', gpt, sam, signal = null }) {
  const { W, H } = P; const b = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(W - 1, box[2]), Math.min(H - 1, box[3])];
  if (b[2] - b[0] < 4 || b[3] - b[1] < 4) throw new Error('네모가 너무 작아요');
  await sam.setImage('orig', P.orig, W, H);
  const cands = await outlineCands(sam, b, W, H);
  const pb = b.map(v => v / P.scale);
  const r = await gpt.pd({ prompt: J.describePrompt(P.pw, P.ph, pb, name), images: [{ label: 'Image A:', url: P.pdUrl, detail: 'high' }], schema: J.DESCRIBE_SCHEMA, name: 'describe', signal });
  const d = r.json || {};
  return { obj: { name: (name || '').trim() || d.name || '물건', group: d.group || d.name || '물건', en: d.en || 'the prop inside the marked box', see_through: !!d.see_through, box: b, cands }, usd: r.usd || 0 };
}
