/**
 * 상태(useBaeMake · useBaeJobs) → 화면 부품 props. 글자와 숫자는 여기서 HTML 과 같은 함수로 만든다 (부품은 보여 주기만).
 */
import {
  RATIOS, RATIO_ORDER, TIERS, PERSPECTIVES, TIMES_BUILTIN, PLACE_LABEL_KO, DIR_MARKER_KO,
  dirNotes, dirUnclosed, guideSummaryKo, sizeChoices, promptCountText, carryList,
} from '@/shared/bae/order';
import { BAE_LIBRARY_DEFAULT } from '@/shared/bae/library';
import type { BaeJob } from '@/shared/bae/jobs';
import type { MakeWindowProps, MaterialWindowProps, MakingStageProps, BaeStepView } from '../make/ui';
import type { BaeBenchView, BaeBusyView, BaeFactView, BaeJobViewProps, BaeMaterialsView, BaeRecordRowView, BaeReviewView } from '../home/benchTypes';
import type { BaeStyleEntryView } from '../make/ui';
import { BAE_STRIP_SRC, baeActiveLibrary, baeBoard, baeLibSrc, baeMisfit, baeOrderStale, useBaeMake, type BaeActiveJob } from './useBaeMake';

export const KIND_LABEL: Record<string, string> = { new: '새 배경', same: '같은 장소', edit: '고친 그림', angle: '다른 각도', layers: '레이어', import: '불러온 그림', upscale: '4K', denoise: '노이즈 제거' };
const pad = (n: number) => String(n).padStart(2, '0');
export function whenText(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null; if (!t || Number.isNaN(t.getTime())) return '';
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
export const tookText = (sec: number | null | undefined) => (sec == null ? '' : sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`);
export const wonOf = (usd: number | null | undefined, rate: number) => (usd == null ? '' : `${Math.round(usd * rate).toLocaleString('ko-KR')}원`);
const timeLabel = (id: string) => TIMES_BUILTIN.find((t) => t.id === id)?.label ?? id;
const perspLabel = (id: string) => PERSPECTIVES.find((p) => p.id === id)?.label ?? id;

function styleRow(mode: 'auto' | 'manual', picks: string[]): string {
  return mode === 'manual' ? `스타일 띠, 예시 ${picks.length ? picks.join(' · ') : '고르는 중'}` : '스타일 띠, PD가 골라요';
}

/** 재료 창 */
export function materialProps(a: { onAddRefs(files: File[]): void; isAdmin: boolean }): Omit<MaterialWindowProps, 'board'> {
  const s = useBaeMake.getState(); const g = s.guide;
  const prev = s.job?.order ?? null;
  const carry = prev && s.job?.inputs ? carryList(prev, s.job.inputs.rough.key) : [];
  return {
    kind: s.kind,
    request: s.request, onRequest: s.setRequest,
    dirNotes: dirNotes(s.request), dirUnclosed: dirUnclosed(s.request),
    place: s.place, onPlace: s.setPlace,
    time: s.time, times: TIMES_BUILTIN.map((t) => ({ id: t.id, label: t.label })), onTime: s.setTime,
    persp: s.persp, persps: PERSPECTIVES.map((p) => ({ id: p.id, label: p.label })), onPersp: s.setPersp,
    perspHint: PERSPECTIVES.find((p) => p.id === s.persp)?.hint ?? '',
    guideUse: s.persp === 'auto' ? null : g.placed, onGuideUse: s.setGuideUse,
    guideUseText: s.persp === 'auto' ? '' : guideSummaryKo(s.persp, g),
    refs: s.refs.map((r) => ({ id: String(r.id), src: r.src, note: r.note })), refMax: 4,
    onAddRefs: a.onAddRefs, onRefNote: (id, note) => s.setRefNote(Number(id), note), onRemoveRef: (id) => s.removeRef(Number(id)),
    stripSrc: BAE_STRIP_SRC, styleRow: styleRow(s.styleMode, s.manualPicks), onOpenStyle: s.openStyle,
    carry: carry.length ? { count: carry.length, on: s.carryOn, text: carry.join('\n') } : null, onCarry: (on) => s.set('carryOn', on),
    message: s.message, submitting: s.submitting, onSubmit: () => { void s.submitOrder(); }, onClose: s.closeWin,
  };
}

/** 보낼 이미지 순서 (HTML renderPrepared 의 그림 줄): 러프 · 레퍼런스 · 예시 · 기본 스타일 띠 */
function sendList(j: BaeActiveJob): { src: string; label: string }[] {
  const inp = j.inputs; if (!inp) return [];
  const out: { src: string; label: string }[] = [{ src: inp.rough.small, label: '1번 ' + inp.rough.label }];
  inp.refs.forEach((r) => out.push({ src: r.small, label: `${out.length + 1}번 레퍼런스` }));
  for (const id of j.order?.picks ?? []) { const e = BAE_LIBRARY_DEFAULT.find((x) => x.id === id); if (e) out.push({ src: baeLibSrc(e.file ?? ''), label: `${out.length + 1}번 예시 ${id}` }); }
  out.push({ src: BAE_STRIP_SRC, label: '마지막 그림체 기준' });
  return out;
}

/** 만드는 창 */
export function makeProps(a: { revisingSeconds: number; imageLabel: string; rate: number }): MakeWindowProps & { onRetry?: () => void } {
  const s = useBaeMake.getState(); const j = s.job!; const o = j.order;
  const why = baeMisfit(); const stale = baeOrderStale();
  const state: MakeWindowProps['state'] = j.phase === 'revising' ? 'revising' : j.reviseError ? 'error' : why ? 'misfit' : stale ? 'stale' : 'ready';
  const statusText = state === 'misfit' ? why : state === 'stale' ? '재료가 바뀌었어요. 주문서를 다시 만들거나, 지금 주문서 그대로 그려도 돼요.' : state === 'error' ? (j.reviseError ?? '') : (o?.doneMsg ?? '');
  const tilt = baeBoard().tilt(); const sz = sizeChoices(s.ratio, s.tier, tilt);
  const cost = s.tier === 'l' || s.tier === 'x' ? '이 크기는 아직 재 본 적이 없어서, 값과 시간이 더 들 수 있어요.' : '이 크기로 한 장에 100~125원, 35~55초쯤 걸려요.';
  const lib = baeActiveLibrary();
  return {
    state, autoOpened: s.winAuto,
    roughSrc: j.inputs?.rough.annotated ?? j.inputs?.rough.small ?? '', roughPlainSrc: j.inputs?.rough.small ?? '',
    showNotes: s.showNotes ?? true, onShowNotes: (on) => s.set('showNotes', on), hasNotes: (j.inputs?.rough.noteCount ?? 0) > 0,
    ratio: s.ratio, ratios: RATIO_ORDER.map((id) => ({ id, hint: RATIOS[id].hint })), onRatio: s.setRatio,
    tier: s.tier, tiers: TIERS.map(([id, label, note]) => ({ id, label, size: RATIOS[s.ratio].sizes[id], note })), onTier: s.setTier,
    sizeNote: sz.hint, sendList: sendList(j),
    summary: o?.summary ?? '', notes: o?.notes ?? [],
    picks: (o?.picks ?? []).map((id) => { const e = lib.find((x) => x.id === id); return { id, name: e?.name ?? id, src: e?.src ?? '' }; }),
    reason: o?.reason ?? '',
    director: o?.director ? { ko: o.director.ko, en: o.director.en, replacedKo: o.director.replaced.map((k) => DIR_MARKER_KO[k] ?? k) } : null,
    revisions: o?.revisions ?? [],
    reviseText: s.reviseText, onReviseText: (t) => s.set('reviseText', t), onRevise: () => { void s.revise(); },
    prompt: j.promptText, onPrompt: s.setPrompt, promptCount: promptCountText(j.promptText).text,
    revisingSeconds: a.revisingSeconds, onStopRevise: () => { void s.stop(); },
    statusText, onRemake: () => { void s.submitOrder(); }, onRetry: () => { void s.revise(s.job?.revisions.at(-1) ?? ''); },
    footNote: `그림 모델은 ${a.imageLabel}이에요. ${cost}`,
    canDraw: !!o && !why && j.phase === 'ordered', onDraw: () => { void s.draw(); },
    onBack: s.backToMaterials, onClose: s.closeWin,
  };
}

/** 만드는 화면 (크게) */
export function makingProps(seconds: number): MakingStageProps {
  const s = useBaeMake.getState(); const j = s.job!;
  const ordering = j.phase === 'ordering';
  const mat = materialsLine(j);
  const steps: BaeStepView[] = ordering
    ? [{ name: '1 재료', text: mat, state: 'ok' }, { name: '2 주문서', text: `PD가 쓰는 중, ${seconds}초째`, state: 'now' }, { name: '3 결과', text: '주문서를 읽어 본 다음에 그려요', state: 'wait' }]
    : [{ name: '1 재료', text: mat, state: 'ok' }, { name: '2 주문서', text: `PD ${tookText(j.orderSec)}`, state: 'ok' }, { name: '3 결과', text: `그리는 중, ${seconds}초째. 중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`, state: 'now' }];
  const [w, h] = RATIOS[s.ratio].sizes[s.tier];
  return {
    phase: ordering ? 'order' : 'draw', title: titleOf(s.request), kindLabel: KIND_LABEL[j.kind],
    label: ordering ? `주문서 쓰는 중, ${seconds}초째` : `그리는 중, ${seconds}초째`,
    src: ordering ? (j.inputs?.rough.small ?? null) : (j.partial ?? j.inputs?.rough.small ?? null), partial: !ordering && !!j.partial,
    aspect: w / h, steps, onFold: s.fold, onStop: () => { void s.stop(); },
  };
}
function materialsLine(j: BaeActiveJob): string {
  const inp = j.inputs; if (!inp) return '러프';
  return (inp.rough.noteCount ? '러프와 빨간 메모' : '러프') + ' 1장' + (inp.refs.length ? `, 레퍼런스 ${inp.refs.length}장` : '');
}
const titleOf = (request: string) => { const t = request.replace(/[{｛][^}｝]*[}｝]/g, '').replace(/\s+/g, ' ').trim(); return t ? (t.length > 40 ? t.slice(0, 40) + '…' : t) : '새 배경'; };

/** 그림체 기준 창 */
export function styleEntries(): BaeStyleEntryView[] {
  const s = useBaeMake.getState(); const active = new Set(baeActiveLibrary().map((e) => e.id));
  return BAE_LIBRARY_DEFAULT.map((e) => ({ id: e.id, name: e.name, src: baeLibSrc(e.file ?? ''), place: PLACE_LABEL_KO[e.place] ?? e.place, tod: e.tod, off: !active.has(e.id), picked: s.manualPicks.includes(e.id) }));
}

/** 작업대 — 지금 작업 (이 PC 에서 진행 중이거나 방금 끝난 것) */
export function activeBench(rate: number): { bench: BaeBenchView; busy: BaeBusyView | null } {
  const s = useBaeMake.getState(); const j = s.job!; const o = j.order;
  const [w, h] = RATIOS[s.ratio].sizes[s.tier];
  const mat: BaeMaterialsView = {
    rough: j.inputs ? { src: j.inputs.rough.annotated ?? j.inputs.rough.small, alt: '러프', name: j.inputs.rough.noteCount ? '러프와 빨간 메모' : '러프', sub: j.inputs.rough.noteCount ? `빨간 메모 ${j.inputs.rough.noteCount}개` : '' } : null,
    refs: s.refs.map((r) => ({ id: String(r.id), src: r.src, alt: '레퍼런스', note: r.note })), refMax: 4, stripSrc: BAE_STRIP_SRC, styleRow: styleRow(s.styleMode, s.manualPicks),
    descLabel: '설명', desc: s.request,
    facts: [{ k: '비율', v: s.ratio }, { k: '장소', v: PLACE_LABEL_KO[s.place] }, { k: '시간대', v: timeLabel(s.time) }, { k: '투시', v: perspLabel(s.persp) }],
  };
  const head: BaeFactView[] = [];
  if (j.orderSec != null) head.push({ k: 'PD 시간', v: tookText(j.orderSec) });
  if (j.orderCostUsd != null) head.push({ k: 'PD 비용', v: wonOf(j.orderCostUsd, rate) });
  const bench: BaeBenchView = {
    id: j.id, title: titleOf(s.request), named: false, kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt), mat, matAct: '재료 바꿔 다시 그리기',
    order: o ? { summary: o.summary, ask: o.revisions.at(-1) ?? '', notes: o.notes, style: o.reason ? `예시 ${o.picks.join(' · ')}: ${o.reason}` : '', pdNote: '', head } : null,
    orderReady: j.phase === 'ordered' && !!o,
    result: j.result ? { src: j.result.url, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : w / h,
      facts: [{ k: '크기', v: `${j.result.w}×${j.result.h}` }, { k: '그림', v: tookText(j.result.sec) }, { k: '비용', v: wonOf(j.result.costUsd, rate) }] } : null,
    review: null,
    failed: j.phase === 'failed' || j.phase === 'order-failed' ? { title: j.phase === 'order-failed' ? '주문서를 만들지 못했어요' : '그림을 만들지 못했어요', text: j.error ?? '' }
      : j.phase === 'stopped' ? { title: '그만뒀어요', text: j.error ?? '' } : null,
  };
  const busy: BaeBusyView | null = j.phase === 'ordering' || j.phase === 'drawing' ? {
    phase: j.phase === 'ordering' ? 'order' : 'draw',
    main: j.phase === 'ordering' ? 'PD가 주문서 쓰는 중' : '그리는 중', sub: j.phase === 'ordering' ? '다 쓰면 요약을 읽고 그림을 만들어요' : `중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`,
    src: j.phase === 'drawing' ? (j.partial ?? j.inputs?.rough.small ?? null) : (j.inputs?.rough.small ?? null), partial: j.phase === 'drawing' && !!j.partial, aspect: w / h,
    facts: [{ k: '크기', v: `${w}×${h}` }, { k: '그림', v: j.phase === 'ordering' ? '아직' : '그리는 중' }, { k: '지금까지', v: wonOf(j.orderCostUsd ?? 0, rate) }],
  } : null;
  return { bench, busy };
}

/** 기록 한 건 (서버 줄) → 작업대 · 한 건 보기. localResult = 이 PC 원본 (있으면 미리보기보다 먼저). */
export function recordMaterials(j: BaeJob): BaeMaterialsView {
  const sm = j.summary;
  return {
    rough: j.images.rough || j.images.roughNotes ? { src: (j.images.roughNotes ?? j.images.rough)!, alt: '러프', name: j.images.roughNotes ? '러프와 빨간 메모' : '러프', sub: '' } : null,
    refs: (j.images.refs ?? []).map((src, i) => ({ id: `${j.id}-${i}`, src, alt: '레퍼런스', note: sm.refNotes?.[i] ?? '' })),
    refMax: 4, stripSrc: BAE_STRIP_SRC, styleRow: sm.styleMode ? styleRow(sm.styleMode, sm.picks ?? []) : '',
    descLabel: '설명', desc: sm.request ?? '',
    facts: [sm.ratio ? { k: '비율', v: sm.ratio } : null, sm.place ? { k: '장소', v: PLACE_LABEL_KO[sm.place as 'auto'] ?? sm.place } : null,
      sm.timeLabel ? { k: '시간대', v: sm.timeLabel } : null, sm.perspLabel ? { k: '투시', v: sm.perspLabel } : null].filter((x): x is BaeFactView => !!x),
  };
}
export function recordResultFacts(j: BaeJob, rate: number): BaeFactView[] {
  return [j.result.w ? { k: '크기', v: `${j.result.w}×${j.result.h}` } : null, j.result.sec != null ? { k: '그림', v: tookText(j.result.sec) } : null, { k: '비용', v: wonOf(j.costUsd, rate) }]
    .filter((x): x is BaeFactView => !!x);
}
export function recordBench(j: BaeJob, rate: number, localResult: string | null): BaeBenchView {
  const pd = j.pd;
  const src = localResult ?? j.images.result ?? null;
  return {
    id: j.id, title: j.name || titleOf(j.summary.request ?? '') || KIND_LABEL[j.kind], named: !!j.name, kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt),
    mat: recordMaterials(j), matAct: '',
    order: pd?.summaryKo ? { summary: pd.summaryKo, ask: pd.revisions?.at(-1) ?? '', notes: pd.notesKo ?? [], style: pd.reason ?? '', pdNote: '', head: [] } : null,
    orderReady: false,
    result: src && j.status === 'done' ? { src, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : 16 / 9, facts: recordResultFacts(j, rate) } : null,
    review: reviewOf(j),
    failed: j.status === 'failed' ? { title: '그림을 만들지 못했어요', text: j.result.error ?? '' } : j.status === 'stopped' ? { title: '그만뒀어요', text: j.result.error ?? '' } : null,
  };
}
export function reviewOf(j: BaeJob): BaeReviewView {
  const r = (j.selfReview ?? {}) as { rate?: string; good?: string; bad?: string };
  return { rate: r.rate === '좋음' || r.rate === '보통' || r.rate === '다시' ? r.rate : '', good: typeof r.good === 'string' ? r.good : '', bad: typeof r.bad === 'string' ? r.bad : '' };
}
export function recordRow(j: BaeJob, rate: number, liveSeconds: number | null): BaeRecordRowView {
  const live = j.status === 'drawing' || j.status === 'ordering' || j.status === 'ordered';
  return {
    id: j.id, thumb: j.images.thumb ?? j.images.result ?? j.images.rough ?? null, thumbAlt: j.images.rough ?? null,
    title: titleOf(j.summary.request ?? '') || KIND_LABEL[j.kind], name: j.name ?? '',
    sub: j.status === 'failed' ? `실패: ${j.result.error ?? ''}` : j.summary.roughNotes ? `메모 ${j.summary.roughNotes.split('\n').filter(Boolean).length}개` : '',
    kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt),
    took: live && liveSeconds != null ? `${liveSeconds}초째` : tookText(j.result.sec), cost: wonOf(j.costUsd, rate),
    state: live ? 'live' : j.status === 'failed' ? 'failed' : j.status === 'stopped' ? 'stopped' : 'done',
    stateLabel: live ? (j.status === 'drawing' ? '그리는 중' : '주문서 쓰는 중') : j.status === 'failed' ? '실패' : j.status === 'stopped' ? '그만둠' : '',
    stamp: j.stamp ? { label: j.stamp === 'good' ? '좋아요' : j.stamp === 'again' ? '다시' : '봤어요', tone: j.stamp } : null,
  };
}
export function jobViewProps(j: BaeJob, rate: number, localResult: string | null, extra: Pick<BaeJobViewProps, 'backLabel' | 'onBack' | 'review' | 'onSave'>): BaeJobViewProps {
  const pd = j.pd;
  const src = localResult ?? j.images.result ?? null;
  return {
    ...extra, title: j.name || titleOf(j.summary.request ?? '') || KIND_LABEL[j.kind], kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt),
    live: j.status === 'drawing' ? { main: '그리는 중', sub: '이 PC 나 다른 PC 에서 아직 그리는 중이에요' } : null,
    result: src && j.status === 'done' ? { src, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : 16 / 9, facts: recordResultFacts(j, rate) } : null,
    failed: j.status === 'failed' ? { title: '그림을 만들지 못했어요', text: j.result.error ?? '' } : j.status === 'stopped' ? { title: '그만뒀어요', text: j.result.error ?? '' } : null,
    facts: [...recordResultFacts(j, rate), { k: '만든 때', v: whenText(j.createdAt) }, { k: '만든 사람', v: j.userName }, ...(j.result.model ? [{ k: '그림 모델', v: j.result.model }] : [])],
    mat: recordMaterials(j),
    pd: pd ? { summary: pd.summaryKo ?? '', ask: pd.revisions?.at(-1) ?? '', notes: pd.notesKo ?? [], style: pd.reason ?? '', pdNote: '', head: [],
      prompt: pd.prompt ?? '', revisions: pd.revisions ?? [], director: pd.director ? { ko: pd.director.ko, en: pd.director.en } : null } : null,
  };
}
