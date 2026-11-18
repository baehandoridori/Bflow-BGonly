/**
 * 상태(useBaeMake · useBaeJobs) → 화면 부품 props. 글자와 숫자는 여기서 HTML 과 같은 함수로 만든다 (부품은 보여 주기만).
 */
import {
  RATIOS, RATIO_ORDER, TIERS, PERSPECTIVES, TIMES_BUILTIN, PLACE_LABEL_KO, DIR_MARKER_KO,
  dirNotes, dirUnclosed, guideSummaryKo, sizeChoices, promptCountText, carryList,
} from '@/shared/bae/order';
import { BAE_LIBRARY_DEFAULT } from '@/shared/bae/library';
import { baeJobHasLock, baeJobVariant, type BaeJob, type BaeJobSummary, type BaeLayersDone, type BaeVariant } from '@/shared/bae/jobs';
import { BAE_STAMP_LABEL, type BaeStamp, type BaeStampEvent } from '@/shared/bae/review';
import { BAE_BASE_MAX, baeBaseFieldView, baeStyleForPlace, baePlaceMode } from '@/shared/bae/place';
import type { MaterialWindowProps, MakingStageProps, BaeStepView } from '../make/ui';
import type { BaeOrderPaneView, BaeBenchView, BaeBusyView, BaeFactView, BaeJobViewProps, BaeMaterialsView, BaeRecordRowView, BaeResultToolsView, BaeReviewView, BaeStampPanelView } from '../home/benchTypes';
import type { BaeStyleEntryView } from '../make/ui';
import { BAE_STRIP_SRC, baeActiveLibrary, baeBoard, baeLibSrc, baeMisfit, baeOrderStale, useBaeMake, type BaeActiveAngle, type BaeActiveJob } from './useBaeMake';
import { baeLockText, baeNoiseText, baeStyleRowForBases } from './baeBases';
import { BAE_UPSCALE_MODES, baeUpscaleButton, baeUpscaleEngineLabel, baeUpscalePlan } from '@/shared/bae/upscaleView';
import { BAE_IMAGE_QUALITIES, baeModelChoices, baeQualityLabel } from '@/shared/bae/imageChoice';
import type { TierId } from '@/shared/bae/order';
import { useBaeStore } from '../useBaeStore';

export const KIND_LABEL: Record<string, string> = { new: '새 배경', same: '같은 장소', edit: '고친 그림', angle: '다른 각도', layers: '레이어', import: '불러온 그림', upscale: '4K', denoise: '노이즈 제거' };
const pad = (n: number) => String(n).padStart(2, '0');
export function whenText(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null; if (!t || Number.isNaN(t.getTime())) return '';
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
export const tookText = (sec: number | null | undefined) => (sec == null ? '' : sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`);
export const wonOf = (usd: number | null | undefined, rate: number) => (usd == null ? '' : `${Math.round(usd * rate).toLocaleString('ko-KR')}원`);
const timeLabel = (id: string) => TIMES_BUILTIN.find((t) => t.id === id)?.label ?? id;
/** 레이어 작업 한 줄 ('PSD 레이어 12장 · 그림자 2'): 물건 레이어 + 빈 방 배경 한 장 (창의 'PSD로 저장했어요' 글과 같은 셈). */
export const baeLayersLine = (l: BaeLayersDone) => `PSD 레이어 ${l.count + 1}장${l.shadows ? ` · 그림자 ${l.shadows}` : ''}`;
type BaeAngleSummaryRecord = NonNullable<BaeJobSummary['angle']>;
/** 다른 각도로의 '2 주문서' 자리: PD메모를 어떻게 했는지 (주문서는 메인이 카메라 문장으로 쓴다). */
function angleOrderText(memo: BaeAngleSummaryRecord['memo'] | BaeActiveAngle['memo'] | undefined): string {
  if (memo === 'reading') return 'PD가 메모를 읽고 그림 모델에게 할 말을 쓰는 중이에요.';
  if (memo === 'raw' || (memo && typeof memo === 'object' && memo.raw)) return 'PD를 부르지 못해서 메모 글을 그대로 넣어 그렸어요.';
  if (memo === 'done') return 'PD가 메모를 읽고 그림 모델에게 할 말을 썼어요.';
  if (memo && typeof memo === 'object') return `PD가 메모 ${memo.n}개를 읽고 그림 모델에게 할 말을 썼어요.`;
  return '메모 없이 카메라 문장과 입체 판 밑그림으로 그렸어요.';
}
const placeKo = (k: string | undefined) => (k === 'exterior' ? '실외' : k === 'interior' ? '실내' : k ?? '');
/** 다른 각도로의 재료: 입체 판 밑그림 · 원래 그림과 같은 공간 그림 · 카메라 줄. */
function angleMaterials(a: { rough: string | null; roughNotes?: string | null; refs: string[]; line: string; label: string; kind?: string; memoN?: number; unseen?: number | null; id: string }): BaeMaterialsView {
  const rough = a.roughNotes ?? a.rough;
  return {
    rough: rough ? { src: rough, alt: '입체 판 밑그림', name: a.roughNotes ? '입체 판 밑그림과 메모' : '입체 판 밑그림', sub: a.memoN ? `메모 ${a.memoN}개` : '' } : null,
    refs: a.refs.map((src, i) => ({ id: `${a.id}-a${i}`, src, alt: i === 0 ? '원래 그림' : '같은 공간 그림', note: i === 0 ? '원래 그림' : `같은 공간 그림 ${i}` })),
    refMax: 4, refsLabel: '원래 그림 · 같은 공간',
    bases: [], baseMax: BAE_BASE_MAX, sheet: null, stripSrc: BAE_STRIP_SRC, styleRow: '',
    descLabel: '카메라', desc: a.line,
    facts: [{ k: '각도', v: a.label }, a.kind ? { k: '장소', v: placeKo(a.kind) } : null, a.unseen != null ? { k: '새로 그릴 곳', v: `${Math.round(a.unseen * 100)}%` } : null].filter((x): x is BaeFactView => !!x),
  };
}
const perspLabel = (id: string) => PERSPECTIVES.find((p) => p.id === id)?.label ?? id;

/** 기준 배경이 있으면 스타일 예시는 보내지 않는다 (시안 작업판 2 주문서 '스타일 예시' 줄). */
const PLACE_STYLE = '보내지 않았어요. 기준 배경이 이 장소의 그림체 기준이에요.';
/** 그림체 기준 줄: 재료 창은 '기준 배경 2장이 기준이에요', 작업판의 좁은 칸은 '기준 배경 2장' (시안 그대로). */
function styleRow(mode: 'auto' | 'manual', picks: string[], bases = 0, short = false): string {
  if (bases) return short ? `기준 배경 ${bases}장` : baeStyleRowForBases(bases);
  return mode === 'manual' ? `스타일 띠, 예시 ${picks.length ? picks.join(' · ') : '고르는 중'}` : '스타일 띠, PD가 골라요';
}
/** 그림체 기준 창에 보일 안내 (기준 배경이 있으면 예시를 보내지 않는다 — HTML syncStyleForPlace). 없으면 null. */
export function stylePlaceHint(): string | null {
  const s = useBaeMake.getState(); const m = baePlaceMode(s.bases);
  return m ? baeStyleForPlace(m, s.styleMode).hint : null;
}
/**
 * 결과 다듬기 줄 (HTML syncNoiseBtn · syncLockRow · upSync 의 글). size = 4K 버튼을 둘 그림의 크기와 비율 (없으면 4K 버튼 없음),
 * upBusy = 이 그림을 4K로 키우는 중.
 */
export function toolsView(q: {
  variant: BaeVariant; hasLock: boolean; moved: number; noiseSec: number | null | undefined; note: string; busy?: { what: 'noise' | 'lock'; step: string }; away: boolean;
  size?: { w: number; h: number; ratio: string | null } | null; upBusy?: boolean;
}): BaeResultToolsView {
  const nt = baeNoiseText(q.variant.noise, q.noiseSec);
  const lt = q.hasLock ? baeLockText(!q.variant.alt, q.moved) : null;
  return {
    noise: { on: q.variant.noise, ...nt, busy: q.busy?.what === 'noise' ? q.busy.step || '지우는 중' : '' },
    lock: lt ? { on: !q.variant.alt, ...lt, busy: q.busy?.what === 'lock' ? q.busy.step || '바꾸는 중' : '' } : null,
    note: q.note, away: q.away,
    upscale: q.size && q.size.w > 0 && q.size.h > 0 ? { ...baeUpscaleButton(baeUpscalePlan(q.size)), busy: q.upBusy ? '4K로 키우는 중' : '' } : null,
  };
}

/** 재료 창 */
export function materialProps(a: { onAddRefs(files: File[]): void; isAdmin: boolean }): Omit<MaterialWindowProps, 'board'> {
  const s = useBaeMake.getState(); const g = s.guide;
  const prev = s.job?.order ?? null;
  const carry = prev && s.job?.inputs ? carryList(prev, s.job.inputs.rough.key) : [];
  const fv = baeBaseFieldView(s.bases, BAE_BASE_MAX);
  return {
    kind: s.kind === 'same' || s.bases.length ? 'same' : 'new',
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
    bases: s.bases.map((b) => ({ id: String(b.id), src: b.src, note: b.note, parts: b.parts.length })), baseMax: BAE_BASE_MAX,
    onAddBases: (files) => { void s.addBases(files); }, onBaseNote: (id, note) => s.setBaseNote(Number(id), note), onRemoveBase: (id) => s.removeBase(Number(id)),
    baseHint: fv.hint, partsButton: fv.partsButton, onOpenParts: () => s.openParts(0), lockOn: s.lockOn, onLockOn: s.setLockOn,
    stripSrc: BAE_STRIP_SRC, styleRow: styleRow(s.styleMode, s.manualPicks, s.bases.length), onOpenStyle: s.openStyle,
    carry: carry.length ? { count: carry.length, on: s.carryOn, text: carry.join('\n') } : null, onCarry: (on) => s.set('carryOn', on),
    message: s.message, submitting: s.submitting, onSubmit: () => { void s.submitOrder(); }, onClose: s.closeWin,
  };
}

/** 보낼 이미지 순서 (HTML renderPrepared 의 그림 줄): 러프 · 레퍼런스 · 예시 · 기본 스타일 띠 */
function sendList(j: BaeActiveJob): { src: string; label: string }[] {
  const inp = j.inputs; if (!inp) return [];
  const out: { src: string; label: string }[] = [{ src: inp.rough.small, label: '1번 ' + inp.rough.label }];
  (inp.place?.items ?? []).forEach((it) => out.push({ src: it.small, label: `${out.length + 1}번 ${it.label}${it.note ? ` (${it.note})` : ''}` }));
  inp.refs.forEach((r) => out.push({ src: r.small, label: `${out.length + 1}번 레퍼런스` }));
  for (const id of j.order?.picks ?? []) { const e = BAE_LIBRARY_DEFAULT.find((x) => x.id === id); if (e) out.push({ src: baeLibSrc(e.file ?? ''), label: `${out.length + 1}번 예시 ${id}` }); }
  out.push({ src: BAE_STRIP_SRC, label: '마지막 그림체 기준' });
  return out;
}

/** 스타일 예시 한 줄 (HTML '레퍼런스 이미지 예시: L2 아파트 집 안 (현관에서 본 거실) · 까닭'). */
function styleLine(picks: string[], reason: string): string {
  const names = picks.map((id) => { const e = BAE_LIBRARY_DEFAULT.find((x) => x.id === id); return e ? `${id} ${e.name}` : id; });
  return names.length ? `레퍼런스 이미지 예시: ${names.join(' · ')}${reason ? ' · ' + reason : ''}` : reason;
}
/** 설정 책장의 그림 모델 (관리자가 정한 것). */
function teamImageModel(): { model: string; label: string } {
  const v = useBaeStore.getState().row('models')?.value as { imageModel?: unknown; imageLabel?: unknown } | undefined;
  return { model: typeof v?.imageModel === 'string' && v.imageModel ? v.imageModel : 'gpt-image-2.5-sunburst', label: typeof v?.imageLabel === 'string' ? v.imageLabel : '' };
}
/** 그림 값 · 시간 안내 (크기와 품질에 따라). '보통 · 높음'만 재 봤다 (2026-11-17 진짜 GPT 확인: 한 장 약 135원, 그림 28~34초). */
function drawCostHint(tier: string, quality: string): string {
  if (quality === 'max' || quality === 'xhigh') return `'${baeQualityLabel(quality)}' 품질은 '높음'보다 값과 시간이 더 들어요. 처음 몇 장은 비용 탭에서 금액을 확인해 주세요.`;
  if (tier === 'l' || tier === 'x') return '이 크기는 아직 재 본 적이 없어서, 값과 시간이 더 들 수 있어요.';
  if (quality === 'medium') return '중간 품질은 빠르고 저렴해요.';
  return '이 크기 · 품질로 한 장에 약 100~135원, 30~55초쯤 걸려요.';
}

/** 작업대 2 주문서 칸의 확인 판 — 지금 작업 (만드는 창 대신, 2026-11-18). 주문서가 없으면 null. */
export function activeOrderPane(j: BaeActiveJob, seconds: number): BaeOrderPaneView | null {
  const s = useBaeMake.getState(); const o = j.order;
  if (!o || j.angle) return null;
  const drawn = j.phase === 'done' || j.phase === 'drawing';
  const why = baeMisfit(); const stale = baeOrderStale();
  const state: BaeOrderPaneView['state'] = j.phase === 'revising' ? 'revising' : j.reviseError ? 'error' : drawn ? 'done' : why ? 'misfit' : stale ? 'stale' : 'ready';
  const statusText = state === 'misfit' ? why : state === 'stale' ? '재료가 바뀌었어요. 주문서를 다시 만들거나, 지금 주문서 그대로 그려도 돼요.' : state === 'error' ? (j.reviseError ?? '') : state === 'ready' ? (o.doneMsg ?? '') : '';
  const lib = baeActiveLibrary();
  const team = teamImageModel();
  const sz = sizeChoices(s.ratio, s.tier, baeBoard().tilt());
  const canOrderAgain = j.phase !== 'drawing' && j.phase !== 'ordering';
  return {
    state, statusText, sendList: sendList(j),
    summary: o.summary, style: o.place ? PLACE_STYLE : styleLine(o.picks.filter((id) => lib.some((e) => e.id === id) || BAE_LIBRARY_DEFAULT.some((e) => e.id === id)), o.reason),
    notes: o.notes,
    director: o.director ? { ko: o.director.ko, en: o.director.en, replacedKo: o.director.replaced.map((k) => DIR_MARKER_KO[k] ?? k) } : null,
    revisions: o.revisions, prompt: j.promptText, promptCount: promptCountText(j.promptText).text,
    revise: canOrderAgain ? {
      text: s.reviseText, onText: (t) => s.set('reviseText', t), onRevise: () => { void s.revise(); },
      busySec: j.phase === 'revising' ? seconds : null, onStop: () => { void s.stop(); },
      again: j.phase === 'done' || j.phase === 'failed' || j.phase === 'stopped',
      onRemake: () => { void s.submitOrder(); },
    } : null,
    draw: drawn ? null : {
      tier: s.tier, tiers: TIERS.map(([id, label, note]) => ({ id, label, size: RATIOS[s.ratio].sizes[id], note })), onTier: (id) => s.setTier(id as TierId),
      quality: s.quality, qualities: BAE_IMAGE_QUALITIES.map((q) => ({ id: q.id, label: q.label })), onQuality: s.setQuality,
      model: s.imageModel ?? team.model, models: baeModelChoices(team.model, team.label), onModel: s.setImageModel,
      hint: [sz.hint, drawCostHint(s.tier, s.quality)].filter(Boolean).map((t) => (/[.!?]$/.test(t.trim()) ? t.trim() : t.trim() + '.')).join(' '),
      canDraw: !why && (j.phase === 'ordered' || j.phase === 'failed' || j.phase === 'stopped'), onDraw: () => { void s.draw(); },
    },
    flashAt: s.orderDoneAt,
  };
}

/** 작업대 2 주문서 칸 — 기록 한 건 (보기만: 요약 · 스타일 예시 · PD 메모 · 지문 · 고친 기록 · 영어 주문서). */
export function recordOrderPane(j: BaeJob): BaeOrderPaneView | null {
  const pd = j.pd;
  if (!pd?.summaryKo || j.kind === 'angle') return null;
  return {
    state: 'done', statusText: '', sendList: [],
    summary: pd.summaryKo, style: j.summary.base ? PLACE_STYLE : styleLine(j.summary.picks ?? [], pd.reason ?? ''),
    notes: pd.notesKo ?? [],
    director: pd.director && pd.director.ko.length ? { ko: pd.director.ko, en: pd.director.en, replacedKo: (pd.director.replaced ?? []).map((k) => DIR_MARKER_KO[k] ?? k) } : null,
    revisions: pd.revisions ?? [], prompt: pd.prompt ?? '', promptCount: pd.prompt ? promptCountText(pd.prompt).text : '',
    revise: null, draw: null, flashAt: 0,
  };
}

/** 만드는 화면에서 돌아가며 보일 짧은 말 (HTML orderPhrases · PHR_DRAW 그대로). */
export function makingPhrases(j: BaeActiveJob): string[] {
  if (j.angle) return j.angle.memo === 'reading' ? ['PD가 메모 읽는 중', '그림 모델에게 할 말 쓰는 중'] : ['입체 판 따라 구도 잡는 중', '원래 그림 색 맞추는 중', '새로 보이는 곳 칠하는 중'];
  if (j.phase !== 'ordering') return ['러프 따라 구도 잡는 중', '그림체 기준 맞추는 중', '단색 면으로 칠하는 중', '손맛 넣는 중'];
  const inp = j.inputs; const s = useBaeMake.getState();
  const p = ['PD가 러프를 읽는 중'];
  if (inp?.rough.noteCount) p.push('빨간 메모 읽는 중');
  if (inp?.place) p.push(inp.place.mode === 'sheet' ? '부품 시트 보는 중' : '기준 배경 보는 중');
  if (inp?.refs.length) p.push('레퍼런스 보는 중');
  if (!inp?.place && s.styleMode === 'auto' && baeActiveLibrary().length) p.push('비슷한 팀 배경 찾는 중');
  p.push('영어 주문서 쓰는 중');
  return p;
}

/** 만드는 화면 (크게) */
export function makingProps(seconds: number, onFinaleEnd?: () => void): MakingStageProps {
  const s = useBaeMake.getState(); const j = s.job!;
  // 다 그렸으면 마무리 장면 (점이 풀리며 완성 그림이 드러난 뒤 onFinaleEnd → 작업대)
  if (j.phase === 'done' && j.result) {
    const steps: BaeStepView[] = j.angle
      ? [{ name: '1 재료', text: '원래 그림, 입체 판 밑그림', state: 'ok' }, { name: '2 PD메모', text: j.angle.memo === null ? '메모 없이 카메라 문장만 보냈어요' : 'PD가 메모를 읽었어요', state: 'ok' }, { name: '3 결과', text: `다 그렸어요, ${tookText(j.result.sec)}`, state: 'ok' }]
      : [{ name: '1 재료', text: materialsLine(j), state: 'ok' }, { name: '2 주문서', text: `PD ${tookText(j.orderSec)}`, state: 'ok' }, { name: '3 결과', text: `다 그렸어요, ${tookText(j.result.sec)}`, state: 'ok' }];
    return {
      phase: 'done', title: j.angle ? '다른 각도 ' + j.angle.label : titleOf(s.request), kindLabel: j.angle ? KIND_LABEL.angle : KIND_LABEL[j.kind], label: '다 그렸어요',
      src: j.result.url, partial: false, aspect: j.result.w && j.result.h ? j.result.w / j.result.h : 16 / 9, steps,
      partialCount: j.partialCount, onFinaleEnd, onFold: s.fold, onStop: () => { onFinaleEnd?.(); },
    };
  }
  if (j.angle) {
    // 다른 각도로: 재료(원래 그림 · 입체 판) → PD메모(있으면) → 그림
    const a = j.angle; const reading = a.memo === 'reading';
    const steps: BaeStepView[] = [
      { name: '1 재료', text: '원래 그림' + (a.extra ? `, 같은 공간 그림 ${a.extra}장` : '') + ', 입체 판 밑그림', state: 'ok' },
      { name: '2 PD메모', text: a.memo === null ? '메모 없이 카메라 문장만 보내요' : reading ? `PD가 메모 읽는 중, ${seconds}초째` : a.memo === 'raw' ? 'PD를 부르지 못해 메모를 그대로 넣었어요' : 'PD가 메모를 읽었어요', state: reading ? 'now' : 'ok' },
      { name: '3 결과', text: reading ? '메모를 읽은 다음에 그려요' : `그리는 중, ${seconds}초째. 중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`, state: reading ? 'wait' : 'now' },
    ];
    return {
      phase: 'draw', title: '다른 각도 ' + a.label, kindLabel: KIND_LABEL.angle, label: reading ? `PD가 메모 읽는 중, ${seconds}초째` : `그리는 중, ${seconds}초째`,
      src: j.partial ?? a.rough, partial: !!j.partial, aspect: a.size[0] / Math.max(1, a.size[1]), steps, onFold: s.fold, onStop: () => { void s.stop(); },
      phrases: makingPhrases(j), partialCount: j.partialCount,
    };
  }
  const ordering = j.phase === 'ordering';
  const mat = materialsLine(j);
  const steps: BaeStepView[] = ordering
    ? [{ name: '1 재료', text: mat, state: 'ok' }, { name: '2 주문서', text: `PD가 쓰는 중, ${seconds}초째`, state: 'now' }, { name: '3 결과', text: '주문서를 읽어 본 다음에 그려요', state: 'wait' }]
    : [{ name: '1 재료', text: mat, state: 'ok' }, { name: '2 주문서', text: `PD ${tookText(j.orderSec)}`, state: 'ok' },
      { name: '3 결과', text: j.finishing ? `${j.finishing}, ${seconds}초째. 이 PC에서 마무리해요` : `그리는 중, ${seconds}초째. 중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`, state: 'now' }];
  const [w, h] = RATIOS[s.ratio].sizes[s.tier];
  return {
    phase: ordering ? 'order' : 'draw', title: titleOf(s.request), kindLabel: KIND_LABEL[j.kind],
    label: ordering ? `주문서 쓰는 중, ${seconds}초째` : j.finishing ? `${j.finishing}, ${seconds}초째` : `그리는 중, ${seconds}초째`,
    src: ordering ? (j.inputs?.rough.annotated ?? j.inputs?.rough.small ?? null) : (j.partial ?? j.inputs?.rough.small ?? null), partial: !ordering && !!j.partial,
    aspect: w / h, steps, onFold: s.fold, onStop: () => { void s.stop(); },
    phrases: makingPhrases(j), partialCount: j.partialCount,
  };
}
function materialsLine(j: BaeActiveJob): string {
  const inp = j.inputs; if (!inp) return '러프';
  const pl = inp.place ? (inp.place.mode === 'sheet' ? ', 부품 시트 1장' : `, 기준 배경 ${inp.place.n}장`) : '';
  return (inp.rough.noteCount ? '러프와 빨간 메모' : '러프') + ' 1장' + pl + (inp.refs.length ? `, 레퍼런스 ${inp.refs.length}장` : '');
}
const titleOf = (request: string) => { const t = request.replace(/[{｛][^}｝]*[}｝]/g, '').replace(/\s+/g, ' ').trim(); return t ? (t.length > 40 ? t.slice(0, 40) + '…' : t) : '새 배경'; };

/** 그림체 기준 창 */
export function styleEntries(): BaeStyleEntryView[] {
  const s = useBaeMake.getState(); const active = new Set(baeActiveLibrary().map((e) => e.id));
  return BAE_LIBRARY_DEFAULT.map((e) => ({ id: e.id, name: e.name, src: baeLibSrc(e.file ?? ''), place: PLACE_LABEL_KO[e.place] ?? e.place, tod: e.tod, off: !active.has(e.id), picked: s.manualPicks.includes(e.id) }));
}

/** 작업대 — 지금 작업 (이 PC 에서 진행 중이거나 방금 끝난 것) */
export function activeBench(rate: number, seconds = 0, toolBusy?: { what: 'noise' | 'lock'; step: string }, upBusy = false): { bench: BaeBenchView; busy: BaeBusyView | null } {
  const s = useBaeMake.getState(); const j = s.job!; const o = j.order;
  if (j.angle) return angleBench(j, j.angle, rate, seconds, toolBusy, upBusy);
  const [w, h] = RATIOS[s.ratio].sizes[s.tier];
  const mat: BaeMaterialsView = {
    rough: j.inputs ? { src: j.inputs.rough.annotated ?? j.inputs.rough.small, alt: '러프', name: j.inputs.rough.noteCount ? '러프와 빨간 메모' : '러프', sub: j.inputs.rough.noteCount ? `빨간 메모 ${j.inputs.rough.noteCount}개` : '' } : null,
    refs: s.refs.map((r) => ({ id: String(r.id), src: r.src, alt: '레퍼런스', note: r.note })), refMax: 4,
    bases: s.bases.map((b, i) => ({ id: String(b.id), src: b.src, alt: `기준 배경 ${i + 1}`, note: b.note })), baseMax: BAE_BASE_MAX, sheet: null,
    stripSrc: BAE_STRIP_SRC, styleRow: styleRow(s.styleMode, s.manualPicks, s.bases.length, true),
    descLabel: '설명', desc: s.request,
    facts: [{ k: '비율', v: s.ratio }, { k: '장소', v: PLACE_LABEL_KO[s.place] }, { k: '시간대', v: timeLabel(s.time) }, { k: '투시', v: perspLabel(s.persp) }],
  };
  const head: BaeFactView[] = [];
  if (j.orderSec != null) head.push({ k: 'PD 시간', v: tookText(j.orderSec) });
  if (j.orderCostUsd != null) head.push({ k: 'PD 비용', v: wonOf(j.orderCostUsd, rate) });
  const bench: BaeBenchView = {
    id: j.id, title: titleOf(s.request), named: false, kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt), mat, matAct: '재료 바꿔 다시 그리기',
    order: o ? { summary: o.summary, ask: o.revisions.at(-1) ?? '', notes: o.notes, style: o.place ? PLACE_STYLE : o.reason ? `예시 ${o.picks.join(' · ')}: ${o.reason}` : '', pdNote: '', head } : null,
    orderPane: activeOrderPane(j, seconds),
    orderReady: j.phase === 'ordered' && !!o,
    result: j.result ? { src: j.result.url, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : w / h, fresh: !!j.doneAt && Date.now() - j.doneAt < 8000,
      facts: [{ k: '크기', v: `${j.result.w}×${j.result.h}` }, { k: '그림', v: tookText(j.result.sec) }, { k: '비용', v: wonOf(j.result.costUsd, rate) }],
      tools: toolsView({ variant: j.result.variant, hasLock: j.result.hasLock, moved: j.result.moved, noiseSec: j.result.noiseSec, note: j.result.note, busy: toolBusy, away: false,
        size: { w: j.result.w, h: j.result.h, ratio: s.ratio }, upBusy }) } : null,
    review: null,
    failed: j.phase === 'failed' || j.phase === 'order-failed' ? { title: j.phase === 'order-failed' ? '주문서를 만들지 못했어요' : '그림을 만들지 못했어요', text: j.error ?? '' }
      : j.phase === 'stopped' ? { title: '그만뒀어요', text: j.error ?? '' } : null,
  };
  const busy: BaeBusyView | null = j.phase === 'ordering' || j.phase === 'drawing' ? {
    phase: j.phase === 'ordering' ? 'order' : 'draw',
    main: j.phase === 'ordering' ? `PD가 주문서 쓰는 중, ${seconds}초째` : j.finishing ? `${j.finishing}, ${seconds}초째` : `그리는 중, ${seconds}초째`,
    sub: j.phase === 'ordering' ? '다 쓰면 요약을 읽고 그림을 만들어요' : j.finishing ? '그림이 왔어요. 이 PC에서 마무리하는 중이에요 (0원)' : `중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`,
    src: j.phase === 'drawing' ? (j.partial ?? j.inputs?.rough.small ?? null) : (j.inputs?.rough.small ?? null), partial: j.phase === 'drawing' && !!j.partial, aspect: w / h,
    facts: [{ k: '크기', v: `${w}×${h}` }, { k: '그림', v: j.phase === 'ordering' ? '아직' : '그리는 중' }, { k: '지금까지', v: wonOf(j.orderCostUsd ?? 0, rate) }],
  } : null;
  return { bench, busy };
}

/** 작업대 — 지금 다른 각도로 그리는 작업 (재료 = 밑그림 · 원래 그림, 2 주문서 = PD메모 상태). */
function angleBench(j: BaeActiveJob, a: BaeActiveAngle, rate: number, seconds: number, toolBusy?: { what: 'noise' | 'lock'; step: string }, upBusy = false): { bench: BaeBenchView; busy: BaeBusyView | null } {
  const [w, h] = a.size; const reading = a.memo === 'reading';
  const bench: BaeBenchView = {
    id: j.id, title: '다른 각도 ' + a.label, named: false, kindLabel: '다른 각도 ' + a.label, when: whenText(j.createdAt),
    mat: angleMaterials({ id: j.id, rough: a.rough, refs: a.refs, line: a.line, label: a.label }), matAct: '각도 다시 맞추기',
    order: { summary: angleOrderText(a.memo), ask: '', notes: [], style: '', pdNote: '', head: [] }, orderReady: false,
    result: j.result ? { src: j.result.url, alt: '다른 각도로 그린 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : w / h, fresh: !!j.doneAt && Date.now() - j.doneAt < 8000,
      facts: [{ k: '크기', v: `${j.result.w}×${j.result.h}` }, { k: '그림', v: tookText(j.result.sec) }, { k: '비용', v: wonOf(j.result.costUsd, rate) }],
      tools: toolsView({ variant: j.result.variant, hasLock: false, moved: 0, noiseSec: j.result.noiseSec, note: j.result.note, busy: toolBusy, away: false, size: { w: j.result.w, h: j.result.h, ratio: null }, upBusy }) } : null,
    review: null,
    failed: j.phase === 'failed' ? { title: '다른 각도로 그리지 못했어요', text: j.error ?? '' } : j.phase === 'stopped' ? { title: '그만뒀어요', text: j.error ?? '' } : null,
  };
  const busy: BaeBusyView | null = j.phase === 'drawing' ? {
    phase: 'draw', main: reading ? `PD가 메모 읽는 중, ${seconds}초째` : `그리는 중, ${seconds}초째`,
    sub: reading ? '메모를 읽은 다음에 그려요' : `중간 그림 2장 중 ${Math.min(2, j.partialCount)}장`,
    src: j.partial ?? a.rough, partial: !!j.partial, aspect: w / Math.max(1, h),
    facts: [{ k: '크기', v: `${w}×${h}` }, { k: '그림', v: reading ? '아직' : '그리는 중' }, { k: '지금까지', v: wonOf(0, rate) }],
  } : null;
  return { bench, busy };
}

/** 기록 한 건 (서버 줄) → 작업대 · 한 건 보기. localResult = 이 PC 원본 (있으면 미리보기보다 먼저). */
export function recordMaterials(j: BaeJob): BaeMaterialsView {
  const sm = j.summary;
  if (j.kind === 'angle' && sm.angle) {
    const a = sm.angle;
    return angleMaterials({ id: j.id, rough: j.images.rough ?? null, roughNotes: j.images.roughNotes ?? null, refs: j.images.refs ?? [], line: a.line, label: a.label, kind: a.kind,
      memoN: a.memo?.n, unseen: a.unseen?.all ?? null });
  }
  return {
    rough: j.images.rough || j.images.roughNotes ? { src: (j.images.roughNotes ?? j.images.rough)!, alt: '러프', name: j.images.roughNotes ? '러프와 빨간 메모' : '러프', sub: '' } : null,
    refs: (j.images.refs ?? []).map((src, i) => ({ id: `${j.id}-${i}`, src, alt: '레퍼런스', note: sm.refNotes?.[i] ?? '' })),
    refMax: 4,
    bases: (j.images.bases ?? []).map((src, i) => ({ id: `${j.id}-b${i}`, src, alt: `기준 배경 ${i + 1}`, note: sm.base?.notes?.[i] ?? '' })),
    baseMax: BAE_BASE_MAX, sheet: j.images.sheet ?? null,
    stripSrc: BAE_STRIP_SRC, styleRow: sm.base ? styleRow('auto', [], sm.base.notes?.length || sm.base.n, true) : sm.styleMode ? styleRow(sm.styleMode, sm.picks ?? []) : '',
    descLabel: '설명', desc: sm.request ?? '',
    facts: [sm.ratio ? { k: '비율', v: sm.ratio } : null, sm.place ? { k: '장소', v: PLACE_LABEL_KO[sm.place as 'auto'] ?? sm.place } : null,
      sm.timeLabel ? { k: '시간대', v: sm.timeLabel } : null, sm.perspLabel ? { k: '투시', v: sm.perspLabel } : null].filter((x): x is BaeFactView => !!x),
  };
}
export function recordResultFacts(j: BaeJob, rate: number): BaeFactView[] {
  const lay = j.result.layers;
  if (lay) {
    // 레이어 작업: 크기 · 나눈 시간 · PSD 레이어 · 비용
    return [j.result.w ? { k: '크기', v: `${j.result.w}×${j.result.h}` } : null, j.result.sec != null ? { k: '나누기', v: tookText(j.result.sec) } : null,
      { k: '레이어', v: baeLayersLine(lay) }, { k: '비용', v: wonOf(j.costUsd, rate) }].filter((x): x is BaeFactView => !!x);
  }
  const up = j.result.finish?.upscale;
  if (up) {
    // 4K 도구 작업: 크기 · 키운 시간 · 방식 · 계산한 곳 · 비용 (0원)
    return [j.result.w ? { k: '크기', v: `${j.result.w}×${j.result.h}` } : null, j.result.sec != null ? { k: '키우기', v: tookText(j.result.sec) } : null,
      { k: '방식', v: BAE_UPSCALE_MODES[up.mode]?.name ?? up.mode }, { k: '계산', v: baeUpscaleEngineLabel(up.ep, up.fellBack) }, { k: '비용', v: wonOf(j.costUsd, rate) }]
      .filter((x): x is BaeFactView => !!x);
  }
  return [j.result.w ? { k: '크기', v: `${j.result.w}×${j.result.h}` } : null, j.result.sec != null ? { k: '그림', v: tookText(j.result.sec) } : null, { k: '비용', v: wonOf(j.costUsd, rate) }]
    .filter((x): x is BaeFactView => !!x);
}
/** 기록 한 건의 다듬기 줄. 이 PC 원본이 없으면 away (색 맞춤은 못 바꾸고, 노이즈 제거 · 4K 는 미리보기로 창을 연다). 실패 · 진행 중이면 null. */
export function recordTools(j: BaeJob, localResult: string | null, busy?: { what: 'noise' | 'lock'; step: string }, upBusy = false): BaeResultToolsView | null {
  if (j.status !== 'done' || j.kind === 'layers') return null;   // 레이어 작업의 그림은 나눈 원래 그림이라 다듬지 않는다
  const f = j.result.finish;
  return toolsView({ variant: baeJobVariant(j), hasLock: baeJobHasLock(j) && !!localResult, moved: f?.lock?.moved ?? 0, noiseSec: f?.noise?.sec, note: f?.note ?? '', busy, away: !localResult,
    size: j.result.w && j.result.h ? { w: j.result.w, h: j.result.h, ratio: j.summary.ratio ?? null } : null, upBusy });
}
/** 이 기록에서 나온 4K 기록 중 가장 최근 것의 한 줄 ('뒤에 한 일: 4K', 계획 14 5-2). 없으면 null. */
export function upscaleChildFact(j: BaeJob, rows: BaeJob[]): BaeFactView | null {
  const kid = rows.filter((r) => r.parentJobId === j.id && r.kind === 'upscale' && r.status === 'done').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const up = kid?.result.finish?.upscale;
  return kid && kid.result.w ? { k: '4K', v: `${kid.result.w}×${kid.result.h}${up ? ` · ${BAE_UPSCALE_MODES[up.mode]?.name ?? up.mode}` : ''}` } : null;
}
/** 기록의 설명 한 줄: 설명이 없으면 (도구 작업) '노이즈 제거: 파일 이름', 그것도 없으면 종류. titleOf 는 빈 설명에 '새 배경'을 주므로 먼저 거른다. */
const recordDesc = (j: BaeJob) => ((j.summary.request ?? '').trim() ? titleOf(j.summary.request!) : '')
  || (j.kind === 'angle' && j.summary.angle?.label ? `다른 각도 ${j.summary.angle.label}` : '')
  || (j.summary.source ? `${KIND_LABEL[j.kind]}: ${j.summary.source}` : '') || KIND_LABEL[j.kind];
const recordTitle = (j: BaeJob) => j.name || recordDesc(j);
/** 기록의 제목 (붙인 이름, 없으면 설명 · '다른 각도 오른쪽 45°' · '레이어: 파일 이름'). */
export const baeRecordTitle = recordTitle;
export function recordBench(j: BaeJob, rate: number, localResult: string | null, busy?: { what: 'noise' | 'lock'; step: string }, upBusy = false): BaeBenchView {
  const pd = j.pd;
  const src = localResult ?? j.images.result ?? null;
  return {
    id: j.id, title: recordTitle(j), named: !!j.name, kindLabel: j.kind === 'angle' && j.summary.angle?.label ? `다른 각도 ${j.summary.angle.label}` : KIND_LABEL[j.kind], when: whenText(j.createdAt),
    mat: recordMaterials(j), matAct: '',
    order: j.kind === 'angle' && j.summary.angle ? { summary: angleOrderText(j.summary.angle.memo), ask: '', notes: pd?.notesKo ?? [], style: '', pdNote: '', head: [] }
      : pd?.summaryKo ? { summary: pd.summaryKo, ask: pd.revisions?.at(-1) ?? '', notes: pd.notesKo ?? [], style: j.summary.base ? PLACE_STYLE : pd.reason ?? '', pdNote: '', head: [] } : null,
    orderPane: recordOrderPane(j),
    orderReady: false,
    result: src && j.status === 'done' ? { src, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : 16 / 9, facts: recordResultFacts(j, rate), tools: recordTools(j, localResult, busy, upBusy) } : null,
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
    title: recordDesc(j), name: j.name ?? '',
    sub: j.status === 'failed' ? `실패: ${j.result.error ?? ''}` : j.result.layers ? baeLayersLine(j.result.layers) : j.summary.roughNotes ? `메모 ${j.summary.roughNotes.split('\n').filter(Boolean).length}개` : '',
    kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt),
    took: live && liveSeconds != null ? `${liveSeconds}초째` : tookText(j.result.sec), cost: wonOf(j.costUsd, rate),
    state: live ? 'live' : j.status === 'failed' ? 'failed' : j.status === 'stopped' ? 'stopped' : 'done',
    stateLabel: live ? (j.status === 'drawing' ? '그리는 중' : '주문서 쓰는 중') : j.status === 'failed' ? '실패' : j.status === 'stopped' ? '그만둠' : '',
    stamp: j.stamp ? { label: BAE_STAMP_LABEL[j.stamp], tone: j.stamp } : null,
  };
}
/** 팀 기록 한 줄: 내 기록 줄 + 만든 사람, 여러 건 '확인함'으로 고를 수 있는지. */
export function teamRow(j: BaeJob, rate: number): BaeRecordRowView {
  const finished = j.status === 'done' || j.status === 'failed' || j.status === 'stopped';
  return { ...recordRow(j, rate, null), maker: j.userName || '(지운 사용자)', pickable: finished && !j.stamp };
}
/**
 * 한 건 보기의 확인 도장 칸. 지금 도장은 작업 줄에서, 누가는 이름으로 (차례에 이름이 있으면 그것, 아니면 사람 목록).
 * 검수자에게만 찍는 곳이 있고, 아직 만드는 중이면 까닭을 적는다.
 */
export function stampPanelView(j: BaeJob, history: BaeStampEvent[] | undefined, a: {
  nameOf(id: string): string; fresh: boolean; canStamp: boolean; saving: boolean; onStamp(stamp: BaeStamp | null, note: string): void;
}): BaeStampPanelView {
  const finished = j.status === 'done' || j.status === 'failed' || j.status === 'stopped';
  const latest = history?.find((h) => h.stamp === j.stamp && (!j.stampBy || h.by === j.stampBy));
  return {
    current: j.stamp ? { id: latest?.id ?? 0, tone: j.stamp, label: BAE_STAMP_LABEL[j.stamp], by: latest?.byName || (j.stampBy ? a.nameOf(j.stampBy) : ''), when: whenText(j.stampAt), note: j.stampNote ?? latest?.note ?? '' } : null,
    history: (history ?? []).map((h) => ({ id: h.id, tone: h.stamp, label: h.stamp ? BAE_STAMP_LABEL[h.stamp] : '도장 뺌', by: h.byName || a.nameOf(h.by), when: whenText(h.at), note: h.note ?? '' })),
    fresh: a.fresh,
    edit: a.canStamp ? { saving: a.saving, blocked: finished ? '' : '아직 만드는 중이라 도장을 찍을 수 없어요. 다 그린 뒤에 찍어 주세요.', onStamp: a.onStamp } : null,
  };
}
export function jobViewProps(j: BaeJob, rate: number, localResult: string | null, extra: Pick<BaeJobViewProps, 'backLabel' | 'onBack' | 'review' | 'onSave' | 'onNoise' | 'onLock' | 'onUpscale' | 'onUseBase' | 'onLayers' | 'onAngle' | 'onShowPsd'>,
  busy?: { what: 'noise' | 'lock'; step: string }, upBusy = false): BaeJobViewProps {
  const pd = j.pd;
  const src = localResult ?? j.images.result ?? null;
  return {
    ...extra, title: recordTitle(j), kindLabel: KIND_LABEL[j.kind], when: whenText(j.createdAt),
    live: j.status === 'drawing' ? { main: '그리는 중', sub: '이 PC 나 다른 PC 에서 아직 그리는 중이에요' } : null,
    result: src && j.status === 'done' ? { src, alt: '만든 배경 그림', aspect: j.result.w && j.result.h ? j.result.w / j.result.h : 16 / 9, facts: recordResultFacts(j, rate), tools: recordTools(j, localResult, busy, upBusy) } : null,
    failed: j.status === 'failed' ? { title: '그림을 만들지 못했어요', text: j.result.error ?? '' } : j.status === 'stopped' ? { title: '그만뒀어요', text: j.result.error ?? '' } : null,
    facts: [...recordResultFacts(j, rate), { k: '만든 때', v: whenText(j.createdAt) }, { k: '만든 사람', v: j.userName },
      ...(j.result.model ? [{ k: j.result.finish?.upscale ? '4K 모델' : '그림 모델', v: j.result.model }] : [])],
    mat: recordMaterials(j),
    orderPane: recordOrderPane(j),
    pd: pd ? { summary: j.kind === 'angle' && j.summary.angle ? angleOrderText(j.summary.angle.memo) : pd.summaryKo ?? '', ask: pd.revisions?.at(-1) ?? '', notes: pd.notesKo ?? [], style: j.summary.base ? PLACE_STYLE : pd.reason ?? '', pdNote: '', head: [],
      prompt: pd.prompt ?? '', revisions: pd.revisions ?? [], director: pd.director ? { ko: pd.director.ko, en: pd.director.en } : null } : null,
  };
}
