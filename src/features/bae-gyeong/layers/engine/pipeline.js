/* BAE layer engine: the whole run, one finished background -> layers + PSD.
   Everything that touches the outside world comes in as an adapter, so the same run works in BAE경 (browser) today
   and in Bflow (Electron) later:
     gpt   : { pd({ prompt, images, schema, name, signal }) -> { json, usd },
             edit({ prompt, image, mask, size, signal }) -> { png, usd } }       (image / mask / png: PNG bytes)
     codec : { encodePng(rgba, w, h) -> bytes, decodePng(bytes) -> { w, h, rgb }, toDataUrl(rgb, w, h, jpeg) -> string }
     sam   : createSam(...) from sam.js (onnxruntime-web or onnxruntime-node)
     store : { get(key), set(key, value) } keeps what GPT returned, so a second run of the same picture does not pay again
   Steps (and what they cost):
     1 inventory   PD lists and boxes the props                          (PD call)
     2 plate       GPT Image draws the empty background                   (image edit)
     3 outlines    SAM outlines every box, best one picked                (local)
     4 depth       PD says which of two touching props is in front        (PD call)
     4b plate2     only when the empty background changed too much: drawn again inside a mask (image edit)
     5 edits       per group of touching props: front layer removed, the one behind drawn whole (one image edit each)
     6 build       whole-member templates + layers                        (local)
     7 psd         folders = groups                                       (local) */
import * as I from './img.js';
import * as B from './bm.js';
import * as J from './gptjobs.js';
import { findOutlines, numberedPicture, plateDrift } from './prep.js';
import { frontFromAnswers, planEdits, editMaskRGBA } from './plan.js';
import { findWholeTemplates } from './whole.js';
import { buildLayers } from './build.js';
import { psdDocument } from './psd.js';

export const STEPS = [
  ['inventory', 'PD가 물건 목록을 짚는 중'], ['plate', '빈 배경 그리는 중'], ['outlines', '물건 윤곽 따는 중'], ['depth', 'PD가 앞뒤를 판단하는 중'],
  ['edits', '앞 물건 지우고 뒤 물건 완성하는 중'], ['build', '레이어 조립하는 중'], ['psd', 'PSD 만드는 중'],
];
export function workingSize(w, h, maxSide = 2048) {   // the run works at <= 2048 px on the long side, sizes that GPT Image accepts
  const s = Math.min(1, maxSide / Math.max(w, h)); let W = Math.max(16, Math.round(w * s / 16) * 16), H = Math.max(16, Math.round(h * s / 16) * 16);
  return { W, H, scale: W / w };
}
export function estimateUsd(nEdits = 2) { return { low: .03 + .17 * (1 + nEdits) + .02, high: .08 + .25 * (2 + nEdits) + .05 }; }

export async function separateLayers({ image, notes = '', gpt, codec, sam, store = null, onStep = () => {}, log = () => {}, signal = null, maxEdits = 6 }) {
  const t0 = Date.now(); let usd = 0; const costs = {};
  const check = () => { if (signal && signal.aborted) { const e = new Error('그만뒀어요'); e.name = 'AbortError'; throw e; } };
  const S = store || { get: async () => undefined, set: async () => {} };
  const step = (id, state, info = {}) => onStep(id, state, info);
  // ---- the picture at working size ----
  const { W, H } = workingSize(image.w, image.h);
  const orig = (W === image.w && H === image.h) ? image.rgb : I.resizeArea(image.rgb, image.w, image.h, W, H, 3);
  const size = `${W}x${H}`; const pdS = 1024 / Math.max(W, H), pw = Math.round(W * pdS), ph = Math.round(H * pdS);
  const pdPicture = await codec.toDataUrl(I.resizeArea(orig, W, H, pw, ph, 3), pw, ph, true);
  const origPng = await codec.encodePng(rgbToRgba(orig, W, H), W, H);
  const pay = (k, v) => { if (v) { usd += v; costs[k] = (costs[k] || 0) + v; } };
  const decodeAt = async (png) => { const d = await codec.decodePng(png); return (d.w === W && d.h === H) ? d.rgb : I.resizeArea(d.rgb, d.w, d.h, W, H, 3); };

  // ---- 1 inventory ----
  step('inventory', 'run'); check();
  let inv = await S.get('inventory');
  if (!inv) { const r = await gpt.pd({ prompt: J.inventoryPrompt(pw, ph, notes), images: [{ label: 'Image A:', url: pdPicture, detail: 'high' }], schema: J.INVENTORY_SCHEMA, name: 'inventory', signal }); inv = r.json; pay('inventory', r.usd); await S.set('inventory', inv); }
  if (!inv.objects || !inv.objects.length) throw new Error('PD가 나눌 물건을 찾지 못했어요.');
  step('inventory', 'ok', { props: inv.objects.length, groups: inv.groups.length });
  // ---- 2 plate (GPT) and 3 SAM on the picture, at the same time ----
  step('plate', 'run'); step('outlines', 'run'); check();
  const plateP = (async () => {
    let png = await S.get('plate');
    if (!png) { const r = await gpt.edit({ prompt: J.platePrompt(inv), image: origPng, mask: null, size, signal }); png = r.png; pay('plate', r.usd); await S.set('plate', png); }
    step('plate', 'ok'); return await decodeAt(png);
  })();
  await sam.setImage('orig', orig, W, H);          // reads the picture while GPT draws
  let plate = await plateP; check();
  const out = await findOutlines({ W, H, orig, plate, inventory: inv, scale: W / pw, sam, log, progress: (d, n) => step('outlines', 'run', { done: d, total: n }) });
  const { objs, ms, pairs } = out; if (!objs.length) throw new Error('물건 윤곽을 하나도 따지 못했어요.');
  step('outlines', 'ok', { props: objs.length, pairs: pairs.length });
  // ---- 4 depth (PD) ; 4b plate drawn again when it changed too much ----
  step('depth', 'run'); check();
  const depthP = (async () => {
    if (!pairs.length) return { pairs: [] };
    let ans = await S.get('depth');
    if (!ans) { const np = numberedPicture(orig, W, H, objs, ms, pairs); const r = await gpt.pd({ prompt: J.depthPrompt(objs, pairs, pw, ph), images: [{ label: 'Image A:', url: pdPicture, detail: 'high' }, { label: 'Image B:', url: await codec.toDataUrl(rgbaToRgb(np.rgba, np.w, np.h), np.w, np.h, true), detail: 'high' }], schema: J.DEPTH_SCHEMA, name: 'depth', signal }); ans = r.json; pay('depth', r.usd); await S.set('depth', ans); }
    return ans;
  })();
  let plateNote = 'first';
  const drift1 = out.plateCheck.untouched_share_gt30;
  const plate2P = (async () => {
    if (!(drift1 > .03)) return null;
    let png = await S.get('plate2');
    if (!png) {
      const props = B.union(ms); const hole = B.dil(props, 12, W, H);
      const r = await gpt.edit({ prompt: J.plateMaskedPrompt(J.platePrompt(inv)), image: origPng, mask: await codec.encodePng(editMaskRGBA(hole, W, H), W, H), size, signal }); png = r.png; pay('plate2', r.usd); await S.set('plate2', png);
    }
    return await decodeAt(png);
  })();
  const [ans, plate2] = await Promise.all([depthP, plate2P]); check();
  if (plate2) { const d2 = plateDrift(orig, plate2, ms, W, H).untouched_share_gt30; log(`plate drift ${drift1} -> masked redraw ${d2}`); if (d2 < drift1) { plate = plate2; plateNote = 'second (masked)'; } }
  const { frontOf, from } = frontFromAnswers(objs, pairs, ans.pairs);
  step('depth', 'ok', { pairs: pairs.length, from });
  // ---- 5 edits (GPT, all at once) ----
  const plan = planEdits({ objs, ms, pairs, frontOf, groups: inv.groups, background: inv.background_en, W, H });
  const todo = plan.edits.slice(0, maxEdits);
  step('edits', 'run', { total: todo.length, done: 0 }); check(); let doneE = 0;
  const edits = await Promise.all(todo.map(async (e) => {
    let png = await S.get('edit_' + e.key);
    if (!png) { const r = await gpt.edit({ prompt: e.prompt, image: origPng, mask: await codec.encodePng(editMaskRGBA(e.hole, W, H), W, H), size, signal }); png = r.png; pay('edit_' + e.key, r.usd); await S.set('edit_' + e.key, png); }
    doneE++; step('edits', 'run', { total: todo.length, done: doneE });
    return { key: e.key, rgb: await decodeAt(png), remove: new Set(e.remove), keep: e.keep };
  }));
  step('edits', 'ok', { total: todo.length }); check();
  // ---- 6 build ----
  step('build', 'run');
  const see = new Set(inv.groups.filter(g => g.see_through).map(g => g.group));
  const templates = await findWholeTemplates({ W, H, orig, plate, objs, ms, frontOf, edits, sam, log });
  check();
  const res = await buildLayers({ W, H, orig, plate, objs, ms, frontOf, see, edits, templates, sam, log, progress: (p) => step('build', 'run', { phase: p }) });
  res.report.plate = plateNote; res.report.depth_from = from; res.report.outline_picks = out.picks;
  step('build', 'ok', { layers: res.meta.length });
  // ---- 7 psd ----
  step('psd', 'run'); const doc = psdDocument(res); step('psd', 'ok');
  const sec = Math.round((Date.now() - t0) / 1000);
  return { result: res, psd: doc, W, H, usd, costs, sec, inventory: inv, edits: todo.map(e => ({ key: e.key, remove: e.remove, keep: e.keep, groups: e.groups })) };
}
export function rgbToRgba(rgb, w, h) { const o = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { o[i * 4] = rgb[i * 3]; o[i * 4 + 1] = rgb[i * 3 + 1]; o[i * 4 + 2] = rgb[i * 3 + 2]; o[i * 4 + 3] = 255; } return o; }
export function rgbaToRgb(rgba, w, h) { const o = new Uint8Array(w * h * 3); for (let i = 0; i < w * h; i++) { o[i * 3] = rgba[i * 4]; o[i * 3 + 1] = rgba[i * 4 + 1]; o[i * 3 + 2] = rgba[i * 4 + 2]; } return o; }
