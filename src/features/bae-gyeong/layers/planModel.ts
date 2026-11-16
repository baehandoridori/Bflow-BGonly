/**
 * 레이어 계획 화면의 규칙 (DOM 없이). HTML v0.4.11 script_4.js 의 레이어 계획 창(lpPlanned · lpEdit 손잡이들 · lpEstimate ·
 * lpRenderSum · lpRenderTree · lpRenderMerge · lpRowSub · lpFolderRuns)을 순수 함수로 옮겼다. 계획 → PSD 미리보기는 엔진의
 * planview.js 를 같이 쓰므로, 창에 보이는 레이어 목록이 엔진이 만드는 PSD 와 같다.
 * 계획을 바꾸는 함수는 받은 계획을 고치지 않고 새 계획을 돌려준다 (React 상태).
 */
import { defaultPlan, planView, BINS, BIN_INFO } from './engine/planview.js';
import type { LayerBin, LayerPlan, ObjectBin, PlanObj, PlanFarArea, PlanViewResult, ViewRow, PlanAdded } from './engine/planview';
import type { LayersDoneSummary, LayersProposal, PackedObj } from './session';
import type { PackedMask } from './engine/planner';

export { BINS, BIN_INFO };
export type { LayerBin, LayerPlan, PlanViewResult, ViewRow };

/** 윤곽 후보: 0~2 = SAM 의 세 답, 3 = 한 장짜리 답 (엔진 DEFAULT_PICK). 'auto' 는 나눌 때 빈 배경과 가장 맞는 것. */
export const LAYERS_DEFAULT_PICK = 3;
export const LAYERS_FIND_STEPS: Array<[string, string]> = [['engine', '레이어 엔진 준비'], ['inventory', 'PD가 물건 찾기'], ['outlines', '물건 윤곽 따기 (이 PC)']];
export const LAYERS_SPLIT_STEPS: Array<[string, string]> = [['plate', '빈 배경 그리기 (GPT)'], ['outlines', '윤곽 다시 맞추기 (이 PC)'], ['depth', 'PD가 앞뒤 판단'], ['edits', '가려진 부분 그리기 (GPT)'], ['build', '레이어 조립 (이 PC)'], ['psd', 'PSD 만들기']];
export const LAYERS_AGAIN_STEPS: Array<[string, string]> = [['psd', 'PSD 다시 조립 (0원)']];
/** GPT Image 한 장 · PD 한 번의 대강 (HTML lpEstimate) */
const IMG_USD = 0.056;

export type AddedWithCands = PlanAdded & { cands?: Array<PackedMask | null> };
const clone = <T>(v: T): T => structuredClone(v);

/* ---------------------------------------------------------------- 계획 만들기 · 저장 */

/** 물건 찾기 결과 → 계획 (HTML lpPlanned): 저장해 둔 계획이 있으면 그것, 새 물건은 처음 값으로. */
export function planFromProposal(p: LayersProposal): { plan: LayerPlan; restored: boolean } {
  const def = defaultPlan(p.objs as PlanObj[], p.far as PlanFarArea[]);
  const sv = p.saved ? planFromSaved(p.saved) : null;
  if (!sv || sv.v !== 1 || !sv.objects) return { plan: def, restored: false };
  const plan = clone(sv);
  for (const id of Object.keys(def.objects)) if (!plan.objects[id]) plan.objects[id] = def.objects[id];
  plan.far = plan.far || {}; for (const id of Object.keys(def.far)) if (!plan.far[id]) plan.far[id] = def.far[id];
  plan.bundles = Object.assign({}, def.bundles, plan.bundles || {}); plan.added = plan.added || [];
  return { plan, restored: true };
}
const bitsTo64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000) as unknown as number[]); return btoa(s); };
const bitsFrom64 = (s: string) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
/** 저장할 계획: 더한 물건의 윤곽 후보(1비트 마스크)는 글자로 (메인 저장소는 JSON). */
export function planToSaved(plan: LayerPlan): LayerPlan {
  const out = clone(plan) as LayerPlan & { added: AddedWithCands[] };
  out.added = (plan.added as AddedWithCands[]).map((a) => ({ ...a, cands: (a.cands || []).map((c) => (c ? { x0: c.x0, y0: c.y0, w: c.w, h: c.h, b64: bitsTo64(c.bits) } : null)) as never }));
  return out;
}
export function planFromSaved(v: unknown): LayerPlan | null {
  if (!v || typeof v !== 'object') return null;
  const plan = clone(v) as LayerPlan & { added?: Array<AddedWithCands & { cands?: unknown }> };
  plan.added = (Array.isArray(plan.added) ? plan.added : []).map((a) => ({
    ...a, cands: (Array.isArray(a.cands) ? a.cands : []).map((c: { x0: number; y0: number; w: number; h: number; b64?: string; bits?: Uint8Array } | null) =>
      (c ? { x0: c.x0, y0: c.y0, w: c.w, h: c.h, bits: c.bits instanceof Uint8Array ? c.bits : bitsFrom64(String(c.b64 || '')) } : null)),
  }));
  return plan;
}
/** 엔진에 보낼 계획: 더한 물건의 윤곽 후보는 빼고 (엔진은 나눌 때 다시 딴다). */
export function planForEngine(plan: LayerPlan): LayerPlan {
  const out = clone(plan); out.added = (out.added as AddedWithCands[]).map(({ cands: _c, ...a }) => a);
  return out;
}

/** 레이어 자체가 기대는 것 (더한 물건 · 사람이 고른 윤곽). 같으면 나눈 레이어를 다시 묶기만 한다 (엔진 worker/entry.js buildKeyOf). */
export function layersBuildKey(plan: LayerPlan): string {
  const picks: Record<string, unknown> = {}; for (const [id, p] of Object.entries(plan.objects || {})) if (p.pick != null && p.pick !== 'auto') picks[id] = p.pick;
  const fp: Record<string, unknown> = {}; for (const [id, p] of Object.entries(plan.far || {})) if (p.pick != null && p.pick !== 'auto') fp[id] = p.pick;
  return JSON.stringify([(plan.added || []).map((a) => [a.id, a.box.map(Math.round)]), picks, fp]);
}
/** 계획의 지문 (더한 물건의 윤곽 후보는 크고 바뀌지 않아 뺌, HTML lpSig). */
export const planSig = (p: LayerPlan) => JSON.stringify(p, (k, v) => (k === 'cands' ? undefined : v));
/** 나눈 뒤 계획을 바꿨는지 (HTML lpDirty). */
export const planDirty = (plan: LayerPlan | null, splitPlan: LayerPlan | null) => !!plan && !!splitPlan && planSig(splitPlan) !== planSig(plan);

/* ---------------------------------------------------------------- 보기 */

export const planObjs = (p: LayersProposal): PlanObj[] => p.objs as unknown as PlanObj[];
export function viewOf(plan: LayerPlan, p: LayersProposal, order: Record<string, number> | null = null): PlanViewResult {
  return planView(plan, planObjs(p), p.far as PlanFarArea[], order);
}
/** 계획 화면에 보이는 모든 윤곽 (PD 물건 · 더한 물건 · 원경). */
export const allIds = (plan: LayerPlan, p: LayersProposal) => p.objs.map((o) => o.id).concat(plan.added.map((a) => a.id), p.far.map((f) => f.id));
/** 그 물건이 어느 층 색으로 보이나 (나누지 않음은 null = 회색). */
export function binOfId(view: PlanViewResult, plan: LayerPlan, id: string): LayerBin | null {
  if (id[0] === 'f') return (plan.far[id] || {}).split === false ? null : 'UL';
  if (view.skipped.includes(id)) return null;
  const r = view.rows.find((x) => x.members.includes(id) || x.merged.includes(id));
  return r ? r.bin : null;
}
/** 고른 물건과 함께 밝아지는 것: 그 레이어 전체 (한 장 묶음, 합친 작은 것). HTML lpGroupOf */
export function groupOf(view: PlanViewResult | null, id: string | null): string[] {
  if (!id || !view) return []; if (id[0] === 'f') return [id];
  const r = view.rows.find((x) => x.members.includes(id) || x.merged.includes(id)); return r ? r.members.concat(r.merged) : [id];
}
export function membersOf(view: PlanViewResult, id: string): string[] {
  const row = view.rows.find((r) => r.members.includes(id)); return row && row.kind === 'bundle' ? row.members.slice() : [id];
}
export function pickOf(plan: LayerPlan, id: string): number {
  const p = id[0] === 'f' ? plan.far[id] : plan.objects[id];
  return p && p.pick != null && p.pick !== 'auto' ? +p.pick : LAYERS_DEFAULT_PICK;
}
export function candsOf(plan: LayerPlan, p: LayersProposal, id: string): Array<PackedMask | null> {
  if (id[0] === 'f') { const f = p.far.find((x) => x.id === id); return f ? f.cands : []; }
  const o = p.objs.find((x) => x.id === id) as PackedObj | undefined;
  if (o) return o.cands || [];
  const a = (plan.added as AddedWithCands[]).find((x) => x.id === id); return a?.cands || [];
}

/** 이름표 (레이어마다 하나, 원경 포함): 'OL · 앞줄 의자 (7)'. ord 가 클수록 앞. */
export interface LayersLabel { id: string; ids: string[]; text: string; bin: LayerBin; ord: number }
export function labelsOf(view: PlanViewResult): LayersLabel[] {
  return view.rows.map((r, i) => ({ id: r.head, ids: r.members, text: r.bin + ' · ' + r.name + (r.kind === 'bundle' ? ' (' + r.members.length + ')' : ''), bin: r.bin, ord: i }))
    .concat(view.farRows.map((r, k) => ({ id: r.head, ids: [r.head], text: 'UL · ' + r.name, bin: 'UL' as LayerBin, ord: -1 - k })));
}

/** 목록 줄의 작은 글 (HTML lpRowSub). */
export function rowSub(r: ViewRow, plan: LayerPlan, p: LayersProposal): string {
  if (r.kind === 'far') return (plan.far[r.head] || {}).split === false ? '' : '보이는 부분만 · 0원';
  const bits: string[] = [];
  if (r.kind === 'bundle') bits.push('같은 물건 ' + r.members.length + '개 한 장');
  else if (r.head[0] === 'a') bits.push('직접 그린 네모');
  else { const o = p.objs.find((x) => x.id === r.head); bits.push(o && o.layer === 'OL' && r.bin === 'OL' ? 'PD 제안 OL' : 'PD가 찾음'); }
  if (r.merged.length) bits.push('작은 것 ' + r.merged.length + '개 합침');
  return bits.join(' · ');
}

/** PSD 의 폴더 이름 (엔진 assemble.js 와 같게: 아래부터 ML 다음 OL, 뒤에서 앞, 끊기면 '이름 (2)'). HTML lpFolderRuns */
export function folderRuns(view: PlanViewResult): Map<string, string> {
  const seen: Record<string, number> = {}; const out = new Map<string, string>();
  for (const bin of ['ML', 'OL'] as const) {
    let cur: string | null = null, name: string | null = null;
    for (const r of view.rows) {
      if (r.bin !== bin) continue;
      if (!r.folder) { cur = null; continue; }
      if (cur !== r.folder) { const k = seen[r.folder] = (seen[r.folder] || 0) + 1; name = k === 1 ? r.folder : r.folder + ' (' + k + ')'; cur = r.folder; }
      out.set(r.key, name!);
    }
  }
  return out;
}

/** 오른쪽 위 'PSD 에 들어갈 레이어' 목록 (위가 앞). 폴더 OL · ML · UL, ML 맨 아래 '배경 (빈 방)', 그림자 줄, '나누지 않음' 묶음. */
export type TreeRow =
  | { kind: 'bin'; bin: LayerBin; count: number; shadows: number; maxShadows: boolean }
  | { kind: 'folder'; name: string; bin: LayerBin }
  | { kind: 'row'; id: string; key: string; bin: LayerBin; name: string; sub: string; sel: boolean; inFolder: boolean; shadowNote: boolean }
  | { kind: 'shadow'; key: string; bin: LayerBin; name: string; inFolder: boolean; done: boolean }
  | { kind: 'plate'; note: string; thumb: string }
  | { kind: 'skipHead'; count: number }
  | { kind: 'skip'; id: string; name: string; sel: boolean };
export function treeRows(view: PlanViewResult, plan: LayerPlan, p: LayersProposal, sel: string | null, summary: LayersDoneSummary | null): TreeRow[] {
  const out: TreeRow[] = []; const folds = folderRuns(view); const on = new Set(groupOf(view, sel));
  for (const bin of BINS) {
    const rows = (bin === 'UL' ? view.farRows : view.rows.filter((r) => r.bin === bin)).slice().reverse();
    if (bin !== 'ML' && !rows.length) continue;
    const shadows = summary ? summary.rows.filter((x) => x.bin === bin && x.shadow).length : rows.filter((r) => r.shadow && bin !== 'UL').length;
    out.push({ kind: 'bin', bin, count: rows.length + (bin === 'ML' ? 1 : 0), shadows, maxShadows: !summary });
    let folder: string | null = null;
    for (const r of rows) {
      const fl = folds.get(r.key) || null;
      if (fl && fl !== folder) out.push({ kind: 'folder', name: fl, bin }); folder = fl;
      const sRow = summary ? summary.rows.find((x) => x.key === r.key) : null;
      out.push({ kind: 'row', id: r.head, key: r.key, bin, name: r.name, sub: rowSub(r, plan, p), sel: on.has(r.head), inFolder: !!fl, shadowNote: !summary && r.shadow && bin !== 'UL' });
      const hasShadow = summary ? !!sRow?.shadow : r.shadow && bin !== 'UL';
      if (hasShadow) out.push({ kind: 'shadow', key: r.key + '|sh', bin, name: r.name + ' 그림자', inFolder: !!fl, done: !!summary });
    }
    if (bin === 'ML') out.push({ kind: 'plate', thumb: summary?.thumbs.plate || '', note: 'GPT가 물건을 지운 방' + (view.skipped.length ? ' · 나누지 않은 물건 ' + view.skipped.length + '개는 그대로' : '') + (view.farRows.length ? ' · 원경 자리는 비어 있어요' : '') });
  }
  if (view.skipped.length) {
    out.push({ kind: 'skipHead', count: view.skipped.length });
    for (const id of view.skipped) { const o = view.byId.get(id); out.push({ kind: 'skip', id, name: (plan.objects[id] || {}).name || o?.name || id, sel: on.has(id) }); }
  }
  return out;
}

/** '작은 것 합치기' 목록 (HTML lpRenderMerge): '카드 38 · 사진 6 → 뒤쪽 대형 게시판 [합침]'. */
export interface MergeRow { target: string; text: string; sub: string; all: boolean }
export function mergeRows(plan: LayerPlan, p: LayersProposal): MergeRow[] {
  const P = plan.objects; const byT = new Map<string, string[]>();
  for (const [id, x] of Object.entries(P)) if (x.mergeTo) { if (!byT.has(x.mergeTo)) byT.set(x.mergeTo, []); byT.get(x.mergeTo)!.push(id); }
  const name = (id: string) => (P[id] && P[id].name) || (p.objs.find((o) => o.id === id) || { name: id }).name;
  const out: MergeRow[] = [];
  for (const [t, ids] of byT) {
    const cnt: Record<string, number> = {}; for (const id of ids) { const o = p.objs.find((x) => x.id === id); const g = o ? o.group : '물건'; cnt[g] = (cnt[g] || 0) + 1; }
    const on = ids.filter((id) => P[id].merge === t).length; const all = on === ids.length;
    out.push({ target: t, text: Object.entries(cnt).map(([g, n]) => g + ' ' + n).join(' · ') + ' → ' + name(t), sub: all ? name(t) + ' 레이어에 그대로 남아요' : on ? on + '개만 합쳐져 있어요' : '따로 나눠요', all });
  }
  return out;
}

/** 층 색 설명의 장 수 (HTML lpRenderLegend). */
export function legendCounts(view: PlanViewResult): Record<LayerBin, number> {
  return { OL: view.rows.filter((r) => r.bin === 'OL').length, ML: view.rows.filter((r) => r.bin === 'ML').length + 1, UL: view.farRows.length };
}

/** 안내 금액 (HTML lpEst, 10원 단위). */
export const wonOf = (usd: number, rate = 1400) => '약 ' + (Math.round(usd * rate / 10) * 10).toLocaleString('ko-KR') + '원';
/** '이대로 나누기'를 누르면 드는 것 (HTML lpEstimate). */
export function estimate(o: { plan: LayerPlan; p: LayersProposal; plated: boolean; summary: LayersDoneSummary | null; splitPlan: LayerPlan | null; rate?: number }): { text: string; usd: number } {
  const rate = o.rate ?? 1400; let low = 0; const note: string[] = [];
  if (o.summary && o.splitPlan) {
    if (layersBuildKey(o.plan) === layersBuildKey(o.splitPlan)) return { text: '다시 나누기: 0원 (GPT 없이 조립만, 몇 초)', usd: 0 };
    const newAdds = o.plan.added.filter((a) => !o.splitPlan!.added.some((b) => b.id === a.id));
    if (newAdds.length) { low += IMG_USD; note.push('추가한 물건 자리만 빈 배경 다시 약 80원 (다른 물건과 겹치면 더)'); }
    else note.push('윤곽을 바꿔서 레이어를 다시 조립해요 (겹친 곳이 바뀌면 GPT 비용이 더 들 수 있어요)');
    return { text: '다시 나누기: ' + (low ? wonOf(low, rate) + '~' : '0원~') + ' · ' + note.join(' · '), usd: low };
  }
  low = o.plated ? 0 : IMG_USD; let clusters = 0;   // 대강: 서로 닿는 상자 묶음 (묶음마다 '앞 지우기' 그림 한 장이 들 수 있다)
  const bs = o.p.objs.map((x) => x.box).concat(o.plan.added.map((a) => a.box)); const par = bs.map((_, i) => i);
  const f = (i: number): number => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) { const A = bs[a], B = bs[b]; if (A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3]) par[f(a)] = f(b); }
  const cnt = new Map<number, number>(); for (let i = 0; i < bs.length; i++) cnt.set(f(i), (cnt.get(f(i)) || 0) + 1); for (const n of cnt.values()) if (n > 1) clusters++;
  const high = low + Math.min(6, clusters) * IMG_USD + .01;
  return { text: (o.plated ? '빈 배경은 저장해 둔 것 (0원)' : '빈 배경 약 80원') + (clusters ? ' + 겹친 묶음마다 약 80원 (최대 6장)' : '') + ' · 모두 ' + (high - low > .02 ? wonOf(low, rate) + '~' + wonOf(high, rate) : wonOf(high, rate)), usd: high };
}
/** 레이어 장 수 줄 (HTML lpRenderSum): '레이어 6장 + 그림자 최대 3장' · '폴더 OL · ML · 빈 배경 포함'. */
export function sumOf(view: PlanViewResult, summary: LayersDoneSummary | null, dirty: boolean): { layers: number; shadows: number; maxShadows: boolean; folders: string } {
  const n = view.rows.length + view.farRows.length + 1;
  const bins = BINS.filter((b) => b === 'ML' || (b === 'UL' ? view.farRows.length : view.rows.some((r) => r.bin === b)));
  const done = !!summary && !dirty;
  const sh = done ? summary!.shadows : view.rows.filter((r) => r.shadow).length;
  return { layers: n, shadows: sh, maxShadows: !done, folders: bins.join(' · ') };
}

/* ---------------------------------------------------------------- 고른 물건 고치기 (HTML lpRenderEdit 의 상태) */

export interface EditorState {
  id: string; far: boolean; added: boolean;
  /** 이름 칸의 이름표 · 값 · 못 바꿈 */
  nameLabel: string; name: string; nameLocked: boolean;
  /** PSD 위치 글 ('OL / 소파') */
  where: string; group: string;
  bin: LayerBin; binLocked: boolean;
  shadowOn: boolean; shadowLocked: boolean;
  keepOn: boolean;
  /** 같은 물건 묶음 (2개 이상): 한 장으로 / 하나씩 */
  bundle: { n: number; mode: 'one' | 'each' } | null;
  /** 합침: 'in' 이 물건이 다른 레이어에 들어가 있음 · 'pd' PD 가 합치자고 했는데 따로 · 'has' 이 레이어에 작은 것이 들어와 있음 */
  merge: { kind: 'in'; into: string; head: string } | { kind: 'pd'; into: string } | null;
  mergedCount: number;
  cands: boolean[]; pick: number; pickAuto: boolean;
}
export function editorState(view: PlanViewResult, plan: LayerPlan, p: LayersProposal, id: string | null): EditorState | null {
  if (!id) return null;
  const cs = candsOf(plan, p, id).map((c) => !!c);
  const pk = (id[0] === 'f' ? plan.far[id] : plan.objects[id]) || null;
  const pickAuto = !pk || pk.pick == null || pk.pick === 'auto';
  if (id[0] === 'f') {
    const f = p.far.find((x) => x.id === id); if (!f) return null; const pf = plan.far[id] || { name: f.name, split: true, pick: 'auto' };
    const nm = pf.name || f.name;
    return { id, far: true, added: false, nameLabel: '이름 (PSD 레이어 이름)', name: nm, nameLocked: false, where: pf.split === false ? '배경 (빈 방)에 그대로' : 'UL / ' + nm, group: '원경 (하늘·창밖)',
      bin: 'UL', binLocked: true, shadowOn: false, shadowLocked: true, keepOn: pf.split === false, bundle: null, merge: null, mergedCount: 0, cands: cs, pick: pickOf(plan, id), pickAuto };
  }
  const o = view.byId.get(id); if (!o) return null;
  const P = plan.objects; const po = P[id] || ({} as Partial<LayerPlan['objects'][string]>);
  const row = view.rows.find((r) => r.members.includes(id) || r.merged.includes(id));
  const merged = !!row && row.merged.includes(id); const head = row ? row.head : id; const hp = P[head] || {};
  const bund = view.bundles.find((b) => b.ids.includes(head)); const one = !!row && row.kind === 'bundle';
  const left = view.skipped.includes(id); const binNow: ObjectBin = left ? ((po.bin as ObjectBin) || 'ML') : row ? (row.bin as ObjectBin) : ((po.bin as ObjectBin) || 'ML');
  const nm = one ? row!.name : (po.name || o.name);
  const fold = row ? folderRuns(view).get(row.key) : undefined;
  const where = left ? '배경 (빈 방)에 그대로' : binNow + ' / ' + (fold ? fold + ' / ' : '') + (row ? row.name : nm);
  let merge: EditorState['merge'] = null;
  if (merged) merge = { kind: 'in', into: (P[head] || {}).name || view.byId.get(head)?.name || '', head };
  else if (po.mergeTo && !po.merge) merge = { kind: 'pd', into: (P[po.mergeTo] || {}).name || '' };
  return {
    id, far: false, added: id[0] === 'a',
    nameLabel: one ? '묶음 이름 (PSD 레이어 이름, ' + row!.members.length + '개 한 장)' : merged ? '이름 (합쳐져서 PSD에는 안 나와요)' : '이름 (PSD 레이어 이름)',
    name: nm, nameLocked: merged, where, group: o.group || '',
    bin: binNow, binLocked: merged,
    shadowOn: one ? row!.shadow : hp.shadow !== false, shadowLocked: merged,
    keepOn: po.split === false,
    bundle: bund && bund.ids.length >= 2 && !merged ? { n: bund.ids.length, mode: bund.mode } : null,
    merge, mergedCount: row && !merged ? row.merged.length : 0,
    cands: cs, pick: pickOf(plan, id), pickAuto,
  };
}

/* ---------------------------------------------------------------- 계획 바꾸기 (HTML lpEdit 손잡이들) */

/** 이름 (PSD 레이어 이름): 원경 · 한 장 묶음은 묶음 이름 · 그 밖은 물건 이름. */
export function setName(plan: LayerPlan, view: PlanViewResult, id: string, val: string): LayerPlan {
  const pl = clone(plan);
  if (id[0] === 'f') { pl.far[id] = { ...(pl.far[id] || { split: true, pick: 'auto' }), name: val } as LayerPlan['far'][string]; return pl; }
  const row = view.rows.find((r) => r.members.includes(id));
  if (row && row.kind === 'bundle' && row.bundle) pl.bundles[row.bundle] = Object.assign({}, pl.bundles[row.bundle] || {}, { name: val }) as LayerPlan['bundles'][string];
  else if (pl.objects[id]) pl.objects[id].name = val;
  return pl;
}
/** 층 (OL · ML): 한 장 묶음은 같이 옮기고 스위치 · 이름을 지닌다. 나누지 않음이었으면 다시 나눈다. */
export function setBin(plan: LayerPlan, view: PlanViewResult, id: string, to: ObjectBin): LayerPlan {
  const ids = membersOf(view, id); const row = view.rows.find((r) => r.members.includes(id)); const pl = clone(plan);
  for (const x of ids) { if (!pl.objects[x]) continue; pl.objects[x].bin = to; pl.objects[x].split = true; }
  if (row && row.kind === 'bundle' && row.group != null) { const nk = row.group + '|' + to; pl.bundles[nk] = Object.assign({}, pl.bundles[row.bundle || ''] || {}, { mode: 'one' as const }); }
  return pl;
}
/** 같은 물건 묶음: 한 장으로 / 하나씩. */
export function setMode(plan: LayerPlan, view: PlanViewResult, id: string, mode: 'one' | 'each'): LayerPlan {
  const row = view.rows.find((r) => r.members.includes(id) || r.merged.includes(id)); const bund = view.bundles.find((x) => x.ids.includes(row ? row.head : id));
  if (!bund) return plan; const pl = clone(plan);
  pl.bundles[bund.key] = Object.assign({}, pl.bundles[bund.key] || {}, { mode, name: (pl.bundles[bund.key] || {}).name || bund.name });
  return pl;
}
/** 나누지 않음 (빈 배경에 그대로) 켜고 끄기. */
export function toggleKeep(plan: LayerPlan, id: string): LayerPlan {
  const pl = clone(plan);
  if (id[0] === 'f') { if (pl.far[id]) pl.far[id].split = pl.far[id].split === false; }
  else if (pl.objects[id]) pl.objects[id].split = pl.objects[id].split === false;
  return pl;
}
/** 그림자 따로 (곱하기): 한 장 묶음은 다 같이. */
export function toggleShadow(plan: LayerPlan, view: PlanViewResult, id: string): LayerPlan {
  const ids = membersOf(view, id); const now = (plan.objects[ids[0]] || {}).shadow !== false; const pl = clone(plan);
  for (const x of ids) if (pl.objects[x]) pl.objects[x].shadow = !now;
  return pl;
}
/** 윤곽 바꾸기: 후보 k (0~3) 또는 'auto'. */
export function setPick(plan: LayerPlan, id: string, k: number | 'auto'): LayerPlan {
  const pl = clone(plan); const t = id[0] === 'f' ? pl.far[id] : pl.objects[id]; if (t) t.pick = k; return pl;
}
/** HTML 의 '윤곽 바꾸기' 한 번 누름: 다음 후보 (없는 후보는 건너뜀). */
export function cyclePick(plan: LayerPlan, p: LayersProposal, id: string): LayerPlan {
  const cs = candsOf(plan, p, id); let k = pickOf(plan, id); for (let t = 0; t < 4; t++) { k = (k + 1) % 4; if (cs[k]) break; }
  return setPick(plan, id, k);
}
export function unmerge(plan: LayerPlan, id: string): LayerPlan { const pl = clone(plan); if (pl.objects[id]) pl.objects[id].merge = null; return pl; }
export function remerge(plan: LayerPlan, id: string): LayerPlan { const pl = clone(plan); if (pl.objects[id]) pl.objects[id].merge = pl.objects[id].mergeTo; return pl; }
export function unmergeAll(plan: LayerPlan, view: PlanViewResult, id: string): LayerPlan {
  const row = view.rows.find((r) => r.members.includes(id)); if (!row) return plan; const pl = clone(plan);
  for (const x of row.merged) if (pl.objects[x]) pl.objects[x].merge = null;
  return pl;
}
/** '작은 것 합치기' 목록의 단추: 다 합쳐져 있으면 모두 풀고, 아니면 모두 합친다. */
export function toggleMergeGroup(plan: LayerPlan, target: string): LayerPlan {
  const ids = Object.entries(plan.objects).filter(([, x]) => x.mergeTo === target).map(([id]) => id);
  const all = ids.every((id) => plan.objects[id].merge === target); const pl = clone(plan);
  for (const id of ids) pl.objects[id].merge = all ? null : target;
  return pl;
}
/** 합쳐진 물건을 고르면 그 레이어의 큰 물건으로 (HTML go-head). */
export function headOf(view: PlanViewResult, id: string): string { const row = view.rows.find((r) => r.merged.includes(id)); return row ? row.head : id; }
/** 네모로 더한 물건 (PD 가 이름을 붙인 뒤, HTML lpAdded). */
export function addBoxed(plan: LayerPlan, id: string, o: { name: string; group: string; en: string; see_through: boolean; box: number[]; cands: Array<PackedMask | null> }): LayerPlan {
  const pl = clone(plan);
  (pl.added as AddedWithCands[]).push({ id, name: o.name, group: o.group, en: o.en, see_through: !!o.see_through, box: o.box.map((v) => Math.round(v)), cands: o.cands });
  pl.objects[id] = { name: o.name, bin: 'ML', shadow: true, split: true, merge: null, mergeTo: null, pick: 'auto' };
  return pl;
}
/** 직접 그린 네모 빼기. */
export function removeBoxed(plan: LayerPlan, id: string): LayerPlan {
  const pl = clone(plan); pl.added = pl.added.filter((a) => a.id !== id); delete pl.objects[id]; return pl;
}
/** 네모 그리기: 끈 자리 → 상자 (8 픽셀보다 작으면 null, HTML lpBoxOf · pointerup). */
export function boxOfDrag(d: { x0: number; y0: number; x1: number; y1: number }): number[] | null {
  const b = [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)];
  return b[2] - b[0] < 8 || b[3] - b[1] < 8 ? null : b;
}
