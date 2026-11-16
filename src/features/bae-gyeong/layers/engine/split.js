/* BAE layer engine (v0.4.4), step 2 of 3 of the layer plan: split the picture the way the plan says.
   The GPT parts are the same as before (empty background, PD's front/back answers, 'front removed' pictures) and are
   kept per picture, so changing names, layers (OL/ML/UL), shadows, 'one layer / one each', merging or leaving props
   in the background costs nothing: only the last step (assemble.js) runs again. A prop boxed after the empty
   background was drawn is taken away only in its place, on top of that empty background (one more GPT picture).
   In: P = planLayers()'s result (picture at working size, the PD's props, the far view), plan = the edited plan. */
import * as I from './img.js';
import * as B from './bm.js';
import * as J from './gptjobs.js';
import { findOutlines, numberedPicture, plateDrift } from './prep.js';
import { frontFromAnswers, planEdits, editMaskRGBA } from './plan.js';
import { findWholeTemplates } from './whole.js';
import { buildLayers } from './build.js';
import { rgbToRgba, rgbaToRgb } from './pipeline.js';
import { outlineCands, DEFAULT_PICK } from './planner.js';

export const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const pickOf = (plan, id, far = false) => { const p = ((far ? plan.far : plan.objects) || {})[id]; return p && p.pick != null && p.pick !== 'auto' ? +p.pick : null; };

export async function splitWithPlan({ P, plan, gpt, codec, sam, store = null, onStep = () => {}, log = () => {}, signal = null, maxEdits = 6 }) {
  const t0 = Date.now(); let usd = 0; const costs = {};
  const check = () => { if (signal && signal.aborted) { const e = new Error('그만뒀어요'); e.name = 'AbortError'; throw e; } };
  const S = store || { get: async () => undefined, set: async () => {} };
  const step = (id, state, info = {}) => onStep(id, state, info);
  const pay = (k, v) => { if (v) { usd += v; costs[k] = (costs[k] || 0) + v; } };
  const { W, H, orig } = P; const size = `${W}x${H}`;
  const decodeAt = async (png) => { const d = await codec.decodePng(png); return (d.w === W && d.h === H) ? d.rgb : I.resizeArea(d.rgb, d.w, d.h, W, H, 3); };
  const origPng = await codec.encodePng(rgbToRgba(orig, W, H), W, H);

  // ---- the props: the PD's and the ones the artist boxed ----
  const added = (plan.added || []).map(a => ({ id: a.id, group: a.group || a.name, name: a.name, en: a.en, box: a.box, see_through: !!a.see_through }));
  const objs0 = P.objs.map(o => ({ id: o.id, group: o.group, name: o.name, en: o.en, box: o.box })).concat(added);
  const groups = (P.groups || []).slice(); for (const a of added) if (!groups.some(g => g.group === a.group)) groups.push({ group: a.group, en: a.en, see_through: a.see_through });
  const inv = { groups, objects: objs0, background_en: P.background_en };

  // ---- 2 the empty background (drawn once for all props of that time; later ones only in their places) ----
  step('plate', 'run'); check();
  let base = await S.get('p4.plate'), baseIds = await S.get('p4.plate.ids');
  if (!base) {
    const r = await gpt.edit({ prompt: J.platePrompt(inv), image: origPng, mask: null, size, signal }); base = r.png; pay('plate', r.usd);
    baseIds = objs0.map(o => o.id); await S.set('p4.plate', base); await S.set('p4.plate.ids', baseIds);
  }
  await sam.setImage('orig', orig, W, H);
  const missing = objs0.filter(o => !(baseIds || []).includes(o.id)); let platePng = base;
  if (missing.length) {
    const key = 'p4.plate.add:' + hashOf(missing.map(o => o.id + ':' + o.box.map(Math.round).join(',')).join('|'));
    let png = await S.get(key);
    if (!png) {
      const ms = []; for (const o of missing) { const c = await outlineCands(sam, o.box, W, H); const k = pickOf(plan, o.id); ms.push(k != null && c[k] && !c[k].empty ? c[k] : c[DEFAULT_PICK]); }
      const hole = B.dil(B.union(ms), 12, W, H);
      const r = await gpt.edit({ prompt: J.plateAddPrompt(missing), image: base, mask: await codec.encodePng(editMaskRGBA(hole, W, H), W, H), size, signal }); png = r.png; pay('plate_add', r.usd); await S.set(key, png);
    }
    platePng = png;
  }
  let plate = await decodeAt(platePng); step('plate', 'ok', { added: missing.length });

  // ---- 3 outlines (an outline the artist chose stays) ----
  step('outlines', 'run'); check();
  const forced = {}; for (const o of objs0) { const k = pickOf(plan, o.id); if (k != null) forced[o.id] = k; }
  const out = await findOutlines({ W, H, orig, plate, inventory: inv, scale: 1, sam, log, forced, progress: (d, n) => step('outlines', 'run', { done: d, total: n }) });
  const { objs, ms, pairs } = out; if (!objs.length) throw new Error('물건 윤곽을 하나도 따지 못했어요.');
  // (BAE 6단계) BiRefNet 새 방식: 시험 폴더의 bir/split_bir.js 가 여기 끼운 한 군데와 같은 일. 엔진에서 바뀐 곳은 이 표시가 붙은 줄뿐이다.   // (BAE 6단계)
  // refineOutlines 를 넘기면 SAM 윤곽을 그것이 준 윤곽으로 바꾸고, findOutlines 가 윤곽에서 셈한 것(아래 자리 · 넓이 · 맞닿은 쌍 · 빈 배경 확인)을   // (BAE 6단계)
  // 새 윤곽으로 다시 셈한다 — 그 뒤(앞뒤 · GPT 가려진 부분 · 레이어 · BG 보정)는 모두 새 윤곽으로. 같은 윤곽을 돌려주면 SAM 만과 같다.   // (BAE 6단계)
  const refineOutlines = (arguments[0] && arguments[0].refineOutlines) || null;   // (BAE 6단계)
  if (refineOutlines) {   // (BAE 6단계)
    const r = await refineOutlines({ W, H, orig, plate, objs, ms }); ms.splice(0, ms.length, ...r.ms); out.refine = r.report;   // (BAE 6단계)
    objs.forEach((o, i) => { const b = ms[i].box(); o.bottom = b[3] - 1; o.area = B.count(ms[i]); o.mbox = b; });   // (BAE 6단계)
    pairs.length = 0; const dm = ms.map(m => B.dil(m, 3, W, H));   // (BAE 6단계)
    for (let a = 0; a < objs.length; a++) for (let b = a + 1; b < objs.length; b++) {   // (BAE 6단계)
      const A = objs[a].mbox, Bb = objs[b].mbox; if (A[0] > Bb[2] + 4 || Bb[0] > A[2] + 4 || A[1] > Bb[3] + 4 || Bb[1] > A[3] + 4) continue;   // (BAE 6단계)
      if (B.countAnd(dm[a], ms[b]) > 0) pairs.push([a, b]);   // (BAE 6단계)
    }   // (BAE 6단계)
    out.plateCheck = plateDrift(orig, plate, ms, W, H);   // (BAE 6단계)
  }   // (BAE 6단계)
  step('outlines', 'ok', { props: objs.length, pairs: pairs.length });

  // ---- 4 front/back (PD) ; the empty background drawn again inside a mask when it changed too much ----
  step('depth', 'run'); check();
  const pairKey = pairs.map(([a, b]) => objs[a].id + '&' + objs[b].id).join(',');
  const depthP = (async () => {
    if (!pairs.length) return { pairs: [] };
    const key = 'p4.depth:' + hashOf(pairKey); let ans = await S.get(key);
    if (!ans) {
      const np = numberedPicture(orig, W, H, objs, ms, pairs);
      const r = await gpt.pd({ prompt: J.depthPrompt(objs, pairs, P.pw, P.ph), images: [{ label: 'Image A:', url: P.pdUrl, detail: 'high' }, { label: 'Image B:', url: await codec.toDataUrl(rgbaToRgb(np.rgba, np.w, np.h), np.w, np.h, true), detail: 'high' }], schema: J.DEPTH_SCHEMA, name: 'depth', signal });
      ans = r.json; pay('depth', r.usd); await S.set(key, ans);
    }
    return ans;
  })();
  let plateNote = 'first';
  const drift1 = out.plateCheck.untouched_share_gt30;
  const plate2P = (async () => {
    if (!(drift1 > .03)) return null;
    const key = 'p4.redraw:' + hashOf(objs0.map(o => o.id).join(',')); let png = await S.get(key);
    if (!png) {
      const hole = B.dil(B.union(ms), 12, W, H);
      const r = await gpt.edit({ prompt: J.plateMaskedPrompt(J.platePrompt(inv)), image: origPng, mask: await codec.encodePng(editMaskRGBA(hole, W, H), W, H), size, signal }); png = r.png; pay('plate2', r.usd); await S.set(key, png);
    }
    return await decodeAt(png);
  })();
  const [ans, plate2] = await Promise.all([depthP, plate2P]); check();
  if (plate2) { const d2 = plateDrift(orig, plate2, ms, W, H).untouched_share_gt30; log(`plate drift ${drift1} -> masked redraw ${d2}`); if (d2 < drift1) { plate = plate2; plateNote = 'second (masked)'; } }
  const { frontOf, from } = frontFromAnswers(objs, pairs, ans.pairs);
  step('depth', 'ok', { pairs: pairs.length, from });

  // ---- 5 'front removed' pictures (GPT, all at once) ----
  const pe = planEdits({ objs, ms, pairs, frontOf, groups: inv.groups, background: inv.background_en, W, H });
  const todo = pe.edits.slice(0, maxEdits).map(e => Object.assign(e, { skey: 'p4.edit:' + hashOf(e.remove.map(i => objs[i].id).join(',') + '/' + e.keep.map(i => objs[i].id).join(',')) }));
  step('edits', 'run', { total: todo.length, done: 0 }); check(); let doneE = 0;
  const edits = await Promise.all(todo.map(async (e) => {
    let png = await S.get(e.skey);
    if (!png) { const r = await gpt.edit({ prompt: e.prompt, image: origPng, mask: await codec.encodePng(editMaskRGBA(e.hole, W, H), W, H), size, signal }); png = r.png; pay('edit_' + e.key, r.usd); await S.set(e.skey, png); }
    doneE++; step('edits', 'run', { total: todo.length, done: doneE });
    return { key: e.key, rgb: await decodeAt(png), remove: new Set(e.remove), keep: e.keep };
  }));
  step('edits', 'ok', { total: todo.length }); check();

  // ---- 6 layers, one per prop (assemble.js puts them together the way the plan says) ----
  step('build', 'run');
  const see = new Set(inv.groups.filter(g => g.see_through).map(g => g.group));
  const templates = await findWholeTemplates({ W, H, orig, plate, objs, ms, frontOf, edits, sam, log });
  check();
  const res = await buildLayers({ W, H, orig, plate, objs, ms, frontOf, see, edits, templates, sam, log, progress: (p) => step('build', 'run', { phase: p }) });
  res.report.plate = plateNote; res.report.depth_from = from; res.report.outline_picks = out.picks;
  // the far view (UL): its outline on the picture
  await sam.setImage('orig', orig, W, H);
  const far = [];
  for (const f of P.far || []) { const c = await outlineCands(sam, f.box, W, H); const k = pickOf(plan, f.id, true); const m = k != null && c[k] && B.count(c[k]) >= 60 ? c[k] : c[DEFAULT_PICK]; far.push({ id: f.id, name: f.name, box: f.box, mask: m }); }
  step('build', 'ok', { layers: res.meta.length });
  return { W, H, orig, plate, res, far, objs: objs0, addedIds: added.map(a => a.id), usd, costs, sec: Math.round((Date.now() - t0) / 1000), edits: todo.length };
}
