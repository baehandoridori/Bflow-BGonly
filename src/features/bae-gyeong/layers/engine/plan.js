/* BAE layer engine, step 'plan' (port of t3_phase3.py + t4_plan.py):
   read the PD's front/back answers, then for each group of touching props (a 'cluster') plan ONE short GPT edit that
   takes away only the front-most layer of that cluster and keeps the layer right behind it whole. The instruction is
   built with fixed sentence patterns from the PD's own descriptions (no hand-written text). */
import * as I from './img.js';
import * as B from './bm.js';

export function frontFromAnswers(objs, pairs, answers) {   // -> {i: Set(j)}: i stands in front of j
  const ans = new Map(); for (const p of answers || []) ans.set(Math.min(p.a, p.b) + ':' + Math.max(p.a, p.b), p.front);
  const frontOf = {}; const src = { pd: 0, rule: 0, none: 0 }; const add = (i, j) => { (frontOf[i] = frontOf[i] || new Set()).add(j); };
  for (const [a, b] of pairs) {
    const f = ans.get(Math.min(a, b) + ':' + Math.max(a, b));
    if (f === a || f === b) { src.pd++; add(f, f === a ? b : a); }
    else if (f === 0) src.none++;
    else { src.rule++; if (Math.abs(objs[a].bottom - objs[b].bottom) > 6) { if (objs[a].bottom > objs[b].bottom) add(a, b); else add(b, a); } }  // the PD skipped it: lower in the picture = nearer
  }
  return { frontOf, from: src };
}
export function depthLevels(n, frontOf) {          // level 0 = nothing in front of it; level 1 = right behind a level-0 prop ...
  const behindOf = []; for (let j = 0; j < n; j++) behindOf.push(new Set());
  for (const [i, v] of Object.entries(frontOf)) for (const j of v) behindOf[j].add(+i);
  const memo = new Map();
  const lv = (j, stack) => { if (memo.has(j)) return memo.get(j); if (stack.has(j)) return 0; let v = 0; if (behindOf[j].size) { const s2 = new Set(stack); s2.add(j); let m = 0; for (const i of [...behindOf[j]].sort((a, b) => a - b)) m = Math.max(m, lv(i, s2)); v = 1 + m; } memo.set(j, v); return v; };
  const LV = {}; for (let i = 0; i < n; i++) LV[i] = lv(i, new Set()); return { LV, behindOf };
}
export function clusters(n, pairs) {
  const par = [...Array(n).keys()]; const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const [a, b] of pairs) par[find(a)] = find(b);
  const out = new Map(); for (let i = 0; i < n; i++) { const r = find(i); if (!out.has(r)) out.set(r, []); out.get(r).push(i); }
  return [...out.values()].filter(v => v.length > 1).map(v => v.sort((a, b) => a - b));
}
function lines(objs, ids, gen) {
  const byGroup = new Map(); objs.forEach((o, i) => { if (!byGroup.has(o.group)) byGroup.set(o.group, []); byGroup.get(o.group).push(i); });
  const out = [];
  for (const [g, members] of byGroup) {
    const sel = members.filter(i => ids.has(i)); if (!sel.length) continue; const rest = members.filter(i => !ids.has(i));
    if (!rest.length && sel.length > 2) out.push(`- all of ${gen[g] || g}`);
    else if (members.length > 4 && sel.length > members.length / 2 && rest.length <= 4) out.push(`- all of ${gen[g] || g}, except these which stay: ` + rest.map(i => objs[i].en).join('; '));
    else for (const i of sel) out.push(`- ${objs[i].en}`);
  }
  return out;
}
export function editPrompt(objs, R, K, gen, bg) {
  const byGroup = new Map(); objs.forEach((o, i) => { if (!byGroup.has(o.group)) byGroup.set(o.group, []); byGroup.get(o.group).push(i); });
  const keepOthers = [];
  for (const [g, members] of byGroup) { const m = members.filter(i => R.has(i)).length; if (m > 0 && m < members.length && members.length - m > 4) keepOthers.push(`Of ${gen[g] || g} there are ${members.length} in the picture: remove only the ${m} listed above and keep the other ${members.length - m} exactly as they are.`); }
  return 'Remove only these objects in front, with their shadows:\n' + lines(objs, R, gen).join('\n') +
    '\nKeep these objects that stand right behind them, and draw every part that was hidden (for example legs, seats, edges and corners) so each one is whole, in the same flat hand-drawn style:\n' + lines(objs, K, gen).join('\n') +
    (keepOthers.length ? '\n' + keepOthers.join('\n') : '') +
    `\nBehind them, continue the background as it is (background: ${String(bg).replace(/\.\s*$/, '')}).\nDo not remove, move or change anything else. Only change the masked areas. No people, no text.`;
}
/* the edits: one per cluster of touching props that has a front layer and a layer right behind it */
export function planEdits({ objs, ms, pairs, frontOf, groups, background, W, H }) {
  const n = objs.length; const { LV, behindOf } = depthLevels(n, frontOf); const gen = Object.fromEntries(groups.map(g => [g.group, g.en]));
  const edits = [];
  const cl = clusters(n, pairs).map((c, k) => [c, k]).sort((a, b) => b[0].length - a[0].length || a[1] - b[1]).map(x => x[0]);
  cl.forEach((C, ci) => {
    const L1 = new Set(C.filter(j => LV[j] === 1));
    const R = [...new Set(C.filter(i => LV[i] === 0 && [...(frontOf[i] || [])].some(j => L1.has(j))))].sort((a, b) => a - b);
    const Rs = new Set(R); const K = [...L1].filter(j => [...behindOf[j]].some(i => Rs.has(i))).sort((a, b) => a - b);
    if (!R.length || !K.length) return;
    const hole = B.dil(B.union(R.map(i => ms[i])), 15, W, H);
    const names = [...new Set(C.map(i => objs[i].group))].sort();
    edits.push({ key: 'c' + ci, cluster: C, remove: R, keep: K, hole, prompt: editPrompt(objs, Rs, new Set(K), gen, background), groups: names });
  });
  return { edits, LV };
}
/* mask picture for the image API: white, fully transparent where GPT may draw */
export function editMaskRGBA(hole, W, H) {
  const out = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255; out[i * 4 + 3] = 255; }
  if (hole && !hole.empty) for (let y = 0; y < hole.h; y++) for (let x = 0; x < hole.w; x++) if (hole.d[y * hole.w + x]) out[((y + hole.y0) * W + x + hole.x0) * 4 + 3] = 0;
  return out;
}
