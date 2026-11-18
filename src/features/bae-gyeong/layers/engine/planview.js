/* BAE layer engine (v0.4.4): the layer plan, as plain data the plan screen edits and the engine follows.
   No imports, no pixels: the page uses the very same functions (BAE경 copies this file into its page), so what the
   artist sees in the PSD preview is what the engine builds.

   plan = {
     v: 1,
     objects: { [id]: { name, bin: 'OL'|'ML', shadow: bool, split: bool, merge: id|null, pick: 'auto'|0..3 } },
     bundles: { [group + '|' + bin]: { mode: 'one'|'each', name } },   // the same kind of prop in one layer, or one each
     far:     { [id]: { name, split: bool, pick } },                     // the far view (UL)
     added:   [ { id, name, group, en, see_through, box } ]              // props the artist boxed (box in working pixels)
   }
   objs: [{ id, group, name, box }] = the PD's props (+ the added ones), far: [{ id, name, box }] */

export const BINS = ['OL', 'ML', 'UL'];
export const BIN_INFO = { OL: { color: '#C2410C', psd: 'orange', ko: '캐릭터 앞' }, ML: { color: '#6C5CE7', psd: 'violet', ko: '캐릭터 뒤 일반 배경' }, UL: { color: '#0E7490', psd: 'blue', ko: '맨 뒤 원경' } };
export const ONE_FROM = 3;                         // the same kind of prop: 3 or more start as one layer (한솔, 2026-10-26)

const boxArea = (b) => Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const inside = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/* a name for several props in one layer: what their names share ('앞줄 책상 1', '앞줄 책상 2' -> '앞줄 책상') */
export function commonName(names, fallback) {
  const ns = names.filter(Boolean); if (!ns.length) return fallback; if (ns.length === 1) return ns[0];
  let p = ns[0]; for (const n of ns) { let k = 0; while (k < p.length && k < n.length && p[k] === n[k]) k++; p = p.slice(0, k); }
  p = p.replace(/[\s\d(\[{·,.\-_#]+$/u, '').trim();
  return p.length >= 2 && (!fallback || p.includes(fallback)) ? p : fallback;   // '창문 왼쪽 커튼', '창문 오른쪽 커튼' -> 커튼, not 창문
}

/* what the PD proposed -> the first plan: OL where the PD saw the foreground, small things merged into the bigger prop
   they sit on, 3 or more of a kind in one layer, every shadow on its own multiply layer, the far view as UL */
export function defaultPlan(objs, far) {
  const byName = new Map(), byGroup = new Map();
  for (const o of objs) { if (!byName.has(o.name)) byName.set(o.name, o); if (!byGroup.has(o.group)) byGroup.set(o.group, []); byGroup.get(o.group).push(o); }
  const objects = {};
  for (const o of objs) {
    let t = null; const on = String(o.on || '').trim();
    if (on) {
      t = byName.get(on) || null;
      if (!t && byGroup.has(on)) { const g = byGroup.get(on); t = g.length === 1 ? g[0] : (g.find(x => inside(center(o.box), x.box)) || null); }
      if (!t) t = objs.find(x => x !== o && (x.name.includes(on) || on.includes(x.name)) && inside(center(o.box), x.box)) || null;
      if (t && (t.id === o.id || boxArea(o.box) > .5 * boxArea(t.box))) t = null;   // only a small thing goes into a bigger one
    }
    objects[o.id] = { name: o.name, bin: o.layer === 'OL' ? 'OL' : 'ML', shadow: true, split: true, merge: t ? t.id : null, mergeTo: null, pick: 'auto' };
  }
  for (const o of objs) {                          // a -> b -> c becomes a -> c; a loop is cut
    const seen = new Set([o.id]); let t = objects[o.id].merge;
    while (t && objects[t] && objects[t].merge) { if (seen.has(t)) { t = null; break; } seen.add(t); t = objects[t].merge; }
    if (t && seen.has(t)) t = null;
    objects[o.id].merge = t || null; objects[o.id].mergeTo = t || null;   // mergeTo: where the PD would put it (the '작은 것 합치기' switch puts it back)
  }
  const plan = { v: 1, objects, bundles: {}, far: {}, added: [] };
  for (const f of far) plan.far[f.id] = { name: f.name, split: true, pick: 'auto' };
  const v = planView(plan, objs, far);
  for (const b of v.bundles) plan.bundles[b.key] = { mode: b.mode, name: b.name };
  return plan;
}

/* the plan -> the PSD it makes: rows = output layers (bottom of the list = back), skipped = props left in the empty
   background, bundles = every group of the same kind in one bin (for the 'one layer / one each' switch).
   order: id -> depth rank (bigger = nearer); before the split the bottom edge of the box stands in for it */
export function planView(plan, objs, far = [], order = null) {
  const all = objs.concat((plan.added || []).filter(a => !objs.some(o => o.id === a.id)));
  const byId = new Map(all.map(o => [o.id, o])); const P = (id) => plan.objects[id] || {};
  const rank = (id) => order && order[id] != null ? order[id] : (byId.get(id) ? byId.get(id).box[3] / 1e5 : 0);
  const target = (id) => { let t = id; const seen = new Set([t]); while (P(t).merge && byId.has(P(t).merge) && !seen.has(P(t).merge)) { t = P(t).merge; seen.add(t); } return t; };
  const bundleMembers = new Map(), skipped = [];
  for (const o of all) {
    const t = target(o.id); if (P(o.id).split === false || P(t).split === false) { skipped.push(o.id); continue; }
    if (t !== o.id) continue;
    const bk = o.group + '|' + (P(o.id).bin === 'OL' ? 'OL' : 'ML'); if (!bundleMembers.has(bk)) bundleMembers.set(bk, []); bundleMembers.get(bk).push(o.id);
  }
  const bundles = [];
  for (const [bk, ids] of bundleMembers) {
    const st = (plan.bundles || {})[bk] || {}; const mode = st.mode || (ids.length >= ONE_FROM ? 'one' : 'each');
    const [group, bin] = bk.split('|');
    bundles.push({ key: bk, group, bin, ids, mode: ids.length < 2 ? 'each' : mode, name: st.name || commonName(ids.map(i => P(i).name || byId.get(i).name), group) });
  }
  const bundleOf = new Map(bundles.map(b => [b.key, b])); const rows = [], byKey = new Map();
  for (const o of all) {
    if (skipped.includes(o.id)) continue; const t = target(o.id); const tp = P(t), to = byId.get(t);
    const bin = tp.bin === 'OL' ? 'OL' : 'ML'; const b = bundleOf.get(to.group + '|' + bin);
    const one = b && b.mode === 'one'; const key = one ? 'B|' + b.key : 'O|' + t;
    let r = byKey.get(key);
    if (!r) { r = { key, bin, kind: one ? 'bundle' : 'object', bundle: b ? b.key : null, group: to.group, name: one ? b.name : (tp.name || to.name), head: t, members: [], merged: [], shadow: tp.shadow !== false, rank: -Infinity }; byKey.set(key, r); rows.push(r); }
    (o.id === t ? r.members : r.merged).push(o.id); r.rank = Math.max(r.rank, rank(o.id));
    if (one && o.id === t && P(o.id).shadow === false) r.shadow = false;
  }
  rows.sort((a, b) => (a.rank - b.rank) || (a.key < b.key ? -1 : 1));
  for (const r of rows) { r.members.sort((a, b) => rank(a) - rank(b)); r.merged.sort((a, b) => rank(a) - rank(b)); r.folder = null; }
  for (const b of bundles) { if (b.mode !== 'each') continue; const rs = rows.filter(r => r.kind === 'object' && r.bundle === b.key); if (rs.length >= 2) for (const r of rs) r.folder = b.name; }
  const farRows = far.filter(f => (plan.far[f.id] || {}).split !== false).map(f => ({ key: 'F|' + f.id, bin: 'UL', kind: 'far', name: (plan.far[f.id] || {}).name || f.name, head: f.id, members: [f.id], merged: [], shadow: false }));
  const merges = new Map();                        // target -> merged ids (for the '작은 것 합치기' list)
  for (const o of all) { const t = P(o.id).merge; if (t && byId.has(t) && !skipped.includes(o.id)) { const tt = target(o.id); if (!merges.has(tt)) merges.set(tt, []); merges.get(tt).push(o.id); } }
  return { rows, farRows, skipped, bundles, merges, byId };
}
