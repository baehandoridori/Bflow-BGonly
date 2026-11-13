/**
 * BAE경 만들기 흐름의 상태 (계획 14e 4장 · 8장): 재료 창 → 만드는 화면(주문서 쓰는 중) → 만드는 창 → 만드는 화면(그리는 중) → 작업판 결과.
 * - 그림판 엔진과 보낼 그림 캐시는 이 모듈이 붙잡는다: 창을 닫았다 열어도, 다른 메뉴에 다녀와도 그대로.
 * - PD · 그림 모델은 통로(메인 / 테스트 모드)가 부른다. 화면을 떠나도 작업은 계속되고, 끝나면 알림.
 * - 주문서가 재료와 맞는지(misfit) · 재료가 바뀌었는지(stale)는 HTML v0.4.11 의 규칙 그대로.
 * - 모델 이름 · 품질은 여기서 정하지 않는다 (메인이 설정 책장에서). 화면에는 이름표 글자만.
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import {
  RATIOS, TIERS, PERSPECTIVES, TIMES_BUILTIN, GUIDE_INITIAL, currentPickIds, dirNotes, shownLibrary, carryList, effRatio,
  type BaeOrder, type GuideState, type PerspectiveId, type RatioId, type TierId, type StyleMode, type PlaceId, type LibEntry,
} from '@/shared/bae/order';
import { BAE_LIBRARY_DEFAULT } from '@/shared/bae/library';
import type { BaeJob } from '@/shared/bae/jobs';
import type { BaeProgress } from '@/shared/bae/makeCalls';
import { createBoard, type Board } from '../make/board';
import { createInputsCache, prepareInputs, currentList, libThumbs, orderInputsOf, listPngBytes, type BaeInputs, type InputsSources } from '../make/inputs';
import { baeGw, useBaeStore } from '../useBaeStore';
import { useBaeJobs } from './useBaeJobs';
import { useAppStore } from '@/stores/useAppStore';

// ── 그림체 기준 그림 (앱 안 파일) ──
const LIB_URLS = import.meta.glob('../assets/library/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const baeLibSrc = (file: string) => LIB_URLS[`../assets/library/${file}`] ?? '';
export const BAE_STRIP_SRC = baeLibSrc('strip.jpg');

export type BaeMakePhase = 'ordering' | 'order-failed' | 'ordered' | 'revising' | 'drawing' | 'done' | 'failed' | 'stopped';
export interface BaeRef { id: number; src: string; note: string; img: HTMLImageElement }
export interface BaeActiveJob {
  id: string;
  kind: 'new' | 'same';
  createdAt: string;
  phase: BaeMakePhase;
  startedAt: number;
  order: BaeOrder | null;
  promptText: string;
  orderCostUsd: number | null;
  orderSec: number | null;
  inputs: BaeInputs | null;
  partial: string | null;
  partialCount: number;
  result: { url: string; w: number; h: number; sec: number; costUsd: number | null; model: string } | null;
  error: string | null;
  reviseError: string | null;
  revisions: string[];
}
type Win = null | 'material' | 'make' | 'style';

interface MakeState {
  kind: 'new' | 'same';
  ratio: RatioId; tier: TierId; place: PlaceId; time: string; persp: PerspectiveId; request: string;
  refs: BaeRef[]; styleMode: StyleMode; manualPicks: string[]; carryOn: boolean;
  guide: GuideState; tilt: number; boardRev: number;
  win: Win; winAuto: boolean; styleBack: Win;
  job: BaeActiveJob | null;
  makingBig: boolean;
  showNotes: boolean;
  reviseText: string;
  message: { tone: 'error' | 'warn' | 'info'; text: string } | null;
  submitting: boolean;
  viewVisible: boolean;
  /** 주문서가 다 됐는데 창이 저절로 뜨지 않은 것 (景 표시 · 작업판 버튼) */
  waitingCheck: boolean;
  // 동작
  openMaterial(kind?: 'new' | 'same'): void;
  closeWin(): void;
  openStyle(): void;
  backFromStyle(): void;
  set<K extends keyof MakeState>(k: K, v: MakeState[K]): void;
  setRequest(t: string): void;
  setPlace(p: PlaceId): void;
  setTime(t: string): void;
  setPersp(p: PerspectiveId): void;
  setGuideUse(on: boolean): void;
  setRatio(r: RatioId): void;
  setTier(t: TierId): void;
  setStyleMode(m: StyleMode): void;
  togglePick(id: string): void;
  addRefs(files: File[]): Promise<void>;
  setRefNote(id: number, note: string): void;
  removeRef(id: number): void;
  submitOrder(): Promise<void>;
  revise(text?: string): Promise<void>;
  draw(): Promise<void>;
  stop(): Promise<void>;
  fold(): void;
  unfold(): void;
  openMake(): void;
  backToMaterials(): void;
  setPrompt(t: string): void;
  dismissResult(): void;
}

const TIER_KEY = 'bae-gyeong.tier';
const readTier = (): TierId => { try { const v = localStorage.getItem(TIER_KEY); return v === 's' || v === 'm' || v === 'l' || v === 'x' ? v : 'm'; } catch { return 'm'; } };

// ── 붙잡아 두는 것들 ──
let board: Board | null = null;
const cache = createInputsCache();
let refSeq = 0;
let progressOff: (() => void) | null = null;

export function baeBoard(): Board {
  if (board) return board;
  board = createBoard({
    onChange: () => { useBaeMake.setState({ boardRev: board!.rev() }); markStale(); scheduleDraftSave(); },
    onGuide: () => { const g = board!.guide(); useBaeMake.setState({ guide: { ...g } }); markStale(); scheduleDraftSave(); },
    onTilt: (t) => { useBaeMake.setState({ tilt: t }); markStale(); },
    onRatio: (r) => { if (useBaeMake.getState().ratio !== r) useBaeMake.setState({ ratio: r }); },
    onToast: (text) => toast(text),
  });
  board.setRatio(useBaeMake.getState().ratio);
  return board;
}

/** 지금 켜 둔 예시 (설정 책장 library.off 를 뺀 것) + 그림 주소 */
export function baeActiveLibrary(): Array<LibEntry & { src: string }> {
  const row = useBaeStore.getState().row('library');
  const off = Array.isArray((row?.value as { off?: unknown } | undefined)?.off) ? ((row!.value as { off: unknown[] }).off.filter((x) => typeof x === 'string') as string[]) : [];
  return BAE_LIBRARY_DEFAULT.filter((e) => !off.includes(e.id)).map((e) => ({ id: e.id, name: e.name, place: e.place, tod: e.tod, src: baeLibSrc(e.file ?? '') }));
}
function sources(): InputsSources {
  const s = useBaeMake.getState();
  return { board: baeBoard(), ratio: s.ratio, tier: s.tier, refs: s.refs.map((r) => ({ id: r.id, img: r.img, note: r.note })), styleSrc: BAE_STRIP_SRC, styleKey: 'default', photoLike: baeBoard().ui().photoLike };
}
/** HTML misfit(): 주문서 속 그림 번호가 지금 재료와 맞지 않는 까닭 (없으면 ''). 기준 배경은 3단계. */
export function baeMisfit(): string {
  const s = useBaeMake.getState(); const o = s.job?.order; if (!o) return '';
  if (!baeBoard().hasContent()) return '러프가 비어 있어요. 러프를 다시 넣어주세요.';
  if (o.place) return '기준 배경이 바뀌어서, 주문서 속 그림 번호와 설명이 지금 기준 배경과 맞지 않아요.\n\'주문서 만들기\'를 다시 눌러주세요. (어느 쪽인지 적은 글만 고친 건 괜찮아요)';
  if (o.refIds.join(',') !== s.refs.map((r) => r.id).join(',')) return '레퍼런스가 바뀌어서, 주문서 속 그림 번호가 지금 레퍼런스와 맞지 않아요.\n\'주문서 만들기\'를 다시 눌러주세요. (설명 글만 고친 건 괜찮아요)';
  if (o.picks.length !== (pickIds() || []).length) return '레퍼런스 이미지 예시 개수가 바뀌어서, 주문서 속 그림 번호가 지금 순서와 맞지 않아요.\n\'주문서 만들기\'를 다시 눌러주세요. (개수가 같으면 다른 예시로 바꿔 끼워도 돼요)';
  return '';
}
function pickIds(): string[] | null {
  const s = useBaeMake.getState();
  return currentPickIds('', s.styleMode, s.manualPicks, s.job?.order ?? null, baeActiveLibrary());
}
/** HTML orderStale(): 재료가 바뀌었는지 */
export function baeOrderStale(): boolean {
  const o = useBaeMake.getState().job?.order; if (!o) return false;
  return o.dirty || (pickIds() || []).join(',') !== o.picks.join(',');
}
function markStale() {
  scheduleDraftSave();
  const s = useBaeMake.getState(); const j = s.job;
  if (j?.order && !j.order.dirty && (j.phase === 'ordered' || j.phase === 'revising')) useBaeMake.setState({ job: { ...j, order: { ...j.order, dirty: true } } });
}
/* ── 초안 (HTML scheduleDraftSave): 재료 창의 러프 · 설명 · 고른 값을 이 PC 보관함에. 앱을 다시 켜도 이어서. ── */
let draftTimer = 0; let draftLoaded = false; let draftSaving = false;
export function scheduleDraftSave(delay = 1500) {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => { void saveDraftNow(); }, delay);
}
async function saveDraftNow() {
  if (draftSaving || !board) return; draftSaving = true;
  try {
    const s = useBaeMake.getState(); const d = await board.serialize();
    const images: Record<string, Uint8Array> = {};
    if (d.paint) images['board_paint.png'] = new Uint8Array(await d.paint.arrayBuffer());
    const data = { v: 1, board: { ...d, paint: d.paint ? 'board_paint.png' : null }, kind: s.kind, ratio: s.ratio, place: s.place, time: s.time, persp: s.persp, request: s.request,
      refs: s.refs.map((r) => ({ src: r.src, note: r.note })), styleMode: s.styleMode, manualPicks: s.manualPicks };
    await baeGw().draftSave({ data, images });
  } catch { /* 초안을 못 남겨도 그리는 일은 계속 */ } finally { draftSaving = false; }
}
async function loadDraftOnce() {
  if (draftLoaded) return; draftLoaded = true;
  try {
    const d = await baeGw().draftLoad(); const data = d?.data as Record<string, any> | null | undefined;
    if (!data || data.v !== 1 || !board || board.hasContent()) return;
    const paintBytes = d!.images['board_paint.png'];
    await board.restore({ ...data.board, paint: paintBytes ? new Blob([paintBytes as BlobPart], { type: 'image/png' }) : null });
    const refs: BaeRef[] = [];
    for (const r of (Array.isArray(data.refs) ? data.refs : []).slice(0, 4)) {
      if (typeof r?.src !== 'string') continue; const img = new Image(); img.src = r.src; await img.decode().catch(() => undefined);
      refs.push({ id: ++refSeq + Date.now(), src: r.src, note: typeof r.note === 'string' ? r.note : '', img });
    }
    useBaeMake.setState({ ratio: RATIOS[data.ratio as RatioId] ? data.ratio : useBaeMake.getState().ratio,
      place: data.place ?? 'auto', time: data.time ?? 'day', persp: data.persp ?? 'auto', request: typeof data.request === 'string' ? data.request : '',
      refs, styleMode: data.styleMode === 'manual' ? 'manual' : 'auto', manualPicks: Array.isArray(data.manualPicks) ? data.manualPicks.slice(0, 2) : [],
      guide: board.guide(), tilt: board.tilt(), boardRev: board.rev() });
  } catch { /* 초안이 깨졌으면 빈 재료로 */ }
}

/** HTML snapAll: PD 를 기다리는 동안 재료가 바뀌었는지 보는 사진 */
function snapAll(): string {
  const s = useBaeMake.getState(); const b = baeBoard();
  return JSON.stringify([b.rev(), b.guide(), s.ratio, s.refs.map((r) => [r.id, r.note]), s.styleMode, s.manualPicks, s.request, s.place, s.time, s.persp, 0, '', [], b.tilt()]);
}
const uuid = () => crypto.randomUUID();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ensureProgress() {
  if (progressOff) return;
  try {
    progressOff = baeGw().onProgress((p: BaeProgress) => {
      const j = useBaeMake.getState().job;
      if (!j || j.id !== p.jobId || j.phase !== 'drawing' || !p.partial) return;
      useBaeMake.setState({ job: { ...j, partial: p.partial.dataUrl, partialCount: j.partialCount + 1 } });
    });
  } catch { /* 통로가 아직 없으면 다음에 */ }
}

function notifyDone(title: string, body: string) {
  const s = useBaeMake.getState();
  const away = !s.viewVisible || document.hidden;
  if (!away) return;
  toast(title, { description: body, action: { label: 'BAE경 보기', onClick: () => useAppStore.getState().setView('bae-gyeong') } });
  try { (window as unknown as { electronAPI?: { showNativeNotification?: (t: string, b: string) => unknown } }).electronAPI?.showNativeNotification?.(title, body); } catch { /* 알림이 안 돼도 작업은 끝났다 */ }
}

export const useBaeMake = create<MakeState>((set, get) => ({
  kind: 'new', ratio: '16:9', tier: readTier(), place: 'auto', time: 'day', persp: 'auto', request: '',
  refs: [], styleMode: 'auto', manualPicks: [], carryOn: true,
  guide: { ...GUIDE_INITIAL }, tilt: 0, boardRev: 0,
  win: null, winAuto: false, styleBack: null,
  job: null, makingBig: true, showNotes: true, reviseText: '', message: null, submitting: false, viewVisible: false, waitingCheck: false,

  set: (k, v) => set({ [k]: v } as Partial<MakeState>),
  openMaterial: (kind) => { ensureProgress(); baeBoard(); void loadDraftOnce(); set({ win: 'material', winAuto: false, kind: kind ?? get().kind, message: null }); },
  closeWin: () => { if (get().win === 'material') scheduleDraftSave(0); set({ win: null, winAuto: false }); },
  openStyle: () => set((s) => ({ styleBack: s.win === 'material' ? 'material' : null, win: 'style', winAuto: false })),
  backFromStyle: () => set((s) => ({ win: s.styleBack, styleBack: null })),
  setRequest: (t) => { set({ request: t }); markStale(); },
  setPlace: (p) => { set({ place: p }); markStale(); },
  setTime: (t) => { set({ time: t }); markStale(); },
  setPersp: (p) => { if (get().persp === p) return; set({ persp: p }); baeBoard().setGuideType(p); markStale(); },
  setGuideUse: (on) => { baeBoard().setGuideParam('use', on); },
  setRatio: (r) => {
    if (!RATIOS[r]) return;
    set({ ratio: r }); baeBoard().setRatio(r);
    // HTML syncRatioInPrompt: 영어 주문서의 비율 글자를 새 비율로
    const j = get().job;
    if (j?.order) { const p = j.promptText.replace(/Aspect ratio\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/gi, () => 'Aspect ratio ' + effRatio(r, get().tier, baeBoard().tilt())); set({ job: { ...j, promptText: p } }); }
    markStale();
  },
  setTier: (t) => {
    set({ tier: t }); try { localStorage.setItem(TIER_KEY, t); } catch { /* 기억 못 해도 된다 */ }
    const j = get().job;   // 크기는 주문서를 다시 쓰지 않는다 (0원). 비율 글자만 (기울기일 때 달라짐).
    if (j?.order) { const p = j.promptText.replace(/Aspect ratio\s*\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?/gi, () => 'Aspect ratio ' + effRatio(get().ratio, t, baeBoard().tilt())); set({ job: { ...j, promptText: p } }); }
  },
  setStyleMode: (m) => { set({ styleMode: m }); markStale(); },
  togglePick: (id) => {
    const cur = get().manualPicks;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2);   // 세 번째를 고르면 먼저 고른 것이 빠짐
    set({ manualPicks: next, styleMode: 'manual' }); markStale();
  },
  addRefs: async (files) => {
    const room = 4 - get().refs.length;
    const picked = files.filter((f) => /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type)).slice(0, Math.max(0, room));
    if (!picked.length) { if (room <= 0) toast('레퍼런스는 4장까지 넣을 수 있어요'); return; }
    const added: BaeRef[] = [];
    for (const f of picked) {
      const src = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(f); });
      const img = new Image(); img.src = src; await img.decode().catch(() => undefined);
      added.push({ id: ++refSeq + Date.now(), src, note: '', img });
    }
    set((s) => ({ refs: [...s.refs, ...added] })); markStale();
  },
  setRefNote: (id, note) => { set((s) => ({ refs: s.refs.map((r) => (r.id === id ? { ...r, note } : r)) })); markStale(); },
  removeRef: (id) => { set((s) => ({ refs: s.refs.filter((r) => r.id !== id) })); markStale(); },

  submitOrder: async () => {
    const s = get(); const b = baeBoard();
    if (s.submitting || (s.job && (s.job.phase === 'ordering' || s.job.phase === 'revising' || s.job.phase === 'drawing'))) { toast('지금 하던 작업이 끝나면 다시 눌러 주세요'); return; }
    if (!b.hasContent()) { set({ message: { tone: 'warn', text: '러프를 먼저 그리거나 넣어주세요' } }); return; }
    const key = useBaeStore.getState().keyStatus;
    if (!key?.hasKey) { set({ message: { tone: 'error', text: 'OpenAI 키가 아직 없어요. 관리자에게 키를 넣어 달라고 요청해 주세요.' } }); return; }
    ensureProgress();
    set({ submitting: true, message: null });
    let inp: BaeInputs | null;
    try { inp = await prepareInputs(sources(), cache); } catch (e) { set({ submitting: false, message: { tone: 'error', text: msg(e) } }); return; }
    if (!inp) { set({ submitting: false, message: { tone: 'warn', text: '러프를 먼저 그리거나 넣어주세요' } }); return; }
    const lib = baeActiveLibrary(); const oi = orderInputsOf(inp);
    const shown = shownLibrary(oi, s.styleMode, lib, s.manualPicks) as Array<LibEntry & { src: string }>;
    const thumbs = await libThumbs(shown, cache).catch(() => ({}));
    const prev = s.job?.order ?? null;
    const carry = s.carryOn && prev ? carryList(prev, inp.rough.key) : [];
    const job: BaeActiveJob = { id: uuid(), kind: s.kind, createdAt: new Date().toISOString(), phase: 'ordering', startedAt: Date.now(), order: null, promptText: '',
      orderCostUsd: null, orderSec: null, inputs: inp, partial: null, partialCount: 0, result: null, error: null, reviseError: null, revisions: [] };
    const before = snapAll();
    set({ job, win: null, winAuto: false, makingBig: true, submitting: false, reviseText: '', waitingCheck: false });
    const r = await baeGw().order({
      jobId: job.id, kind: s.kind, materials: { ratio: s.ratio, tier: s.tier, tilt: b.tilt(), time: s.time, place: s.place, persp: s.persp, guide: { ...b.guide() }, request: s.request },
      inputs: oi, styleMode: s.styleMode, manualIds: s.manualPicks, manualPicks: s.manualPicks, library: lib.map(({ src: _src, ...e }) => e), libThumbs: thumbs,
      revise: null, prevOrder: null, prevPrompt: '', carry, carryExtra: [],
    }).catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
    const cur = get().job; if (!cur || cur.id !== job.id) return;   // 그사이 그만뒀거나 새 작업
    if (!r.ok) {
      if (r.aborted) { set({ job: null, message: { tone: 'info', text: '그만뒀어요.' } }); toast('그만뒀어요.'); return; }
      set({ job: { ...cur, phase: 'order-failed', error: r.message } }); return;
    }
    const order = { ...r.order, dirty: r.order.dirty || snapAll() !== before };
    set({ job: { ...cur, phase: 'ordered', order, promptText: r.promptText, orderCostUsd: r.costUsd, orderSec: r.sec, startedAt: Date.now() }, manualPicks: r.manualPicks });
    // 14e 8장: BAE경 화면이 보이고, 만드는 화면이 펼쳐져 있고, 다른 창이 없을 때만 저절로 뜬다
    const now = get();
    if (now.viewVisible && !document.hidden && now.makingBig && now.win === null) set({ win: 'make', winAuto: true, waitingCheck: false });
    else { set({ waitingCheck: true }); notifyDone('주문서가 다 됐어요', '요약을 읽고 그림을 만들어 주세요.'); }
  },

  revise: async (text) => {
    const s = get(); const j = s.job; const t = (text ?? s.reviseText).trim();
    if (!j?.order || !t) { toast('고칠 내용을 한국어로 써주세요'); return; }
    if (j.phase === 'revising' || j.phase === 'drawing' || j.phase === 'ordering') return;
    const b = baeBoard(); let inp: BaeInputs | null;
    try { inp = await prepareInputs(sources(), cache); } catch (e) { set({ job: { ...j, reviseError: msg(e) } }); return; }
    if (!inp) { set({ job: { ...j, reviseError: '러프가 비어 있어요. 러프를 다시 넣어주세요.' } }); return; }
    const lib = baeActiveLibrary(); const oi = orderInputsOf(inp);
    const shown = shownLibrary(oi, s.styleMode, lib, s.manualPicks) as Array<LibEntry & { src: string }>;
    const thumbs = await libThumbs(shown, cache).catch(() => ({}));
    const before = snapAll();
    set({ job: { ...j, phase: 'revising', startedAt: Date.now(), reviseError: null, inputs: inp }, reviseText: '' });
    const r = await baeGw().order({
      jobId: j.id, kind: j.kind, materials: { ratio: s.ratio, tier: s.tier, tilt: b.tilt(), time: s.time, place: s.place, persp: s.persp, guide: { ...b.guide() }, request: s.request },
      inputs: oi, styleMode: s.styleMode, manualIds: s.manualPicks, manualPicks: s.manualPicks, library: lib.map(({ src: _src, ...e }) => e), libThumbs: thumbs,
      revise: { text: t }, prevOrder: j.order, prevPrompt: j.promptText, carry: [], carryExtra: [],
    }).catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
    const cur = get().job; if (!cur || cur.id !== j.id) return;
    if (!r.ok) { set({ job: { ...cur, phase: 'ordered', reviseError: r.aborted ? null : r.message }, reviseText: r.aborted ? t : '' }); if (r.aborted) toast('그만뒀어요.'); return; }
    const order = { ...r.order, dirty: r.order.dirty || snapAll() !== before };
    set({ job: { ...cur, phase: 'ordered', order, promptText: r.promptText, orderCostUsd: r.costUsd != null ? (cur.orderCostUsd ?? 0) + r.costUsd : cur.orderCostUsd, startedAt: Date.now(), revisions: order.revisions }, manualPicks: r.manualPicks });
  },

  draw: async () => {
    const s = get(); const j = s.job; const b = baeBoard();
    if (!j?.order || j.phase === 'drawing' || j.phase === 'revising') return;
    const why = baeMisfit(); if (why) { toast('주문서를 다시 만들어 주세요'); return; }
    if (!j.promptText.trim()) { toast('주문서가 비어 있어요'); return; }
    const list = await currentList(sources(), cache, { styleMode: s.styleMode, manualPicks: s.manualPicks, order: j.order, library: baeActiveLibrary() }).catch(() => null);
    if (!list) { toast('보낼 이미지를 준비하지 못했어요. 주문서를 다시 만들어 주세요.'); return; }
    const images = await listPngBytes(list);
    const inp = j.inputs ?? await prepareInputs(sources(), cache);
    const time = [...TIMES_BUILTIN].find((t) => t.id === s.time);
    const persp = PERSPECTIVES.find((p) => p.id === s.persp);
    const size = RATIOS[s.ratio].sizes[s.tier];
    set({ win: null, winAuto: false, makingBig: true, waitingCheck: false, job: { ...j, phase: 'drawing', startedAt: Date.now(), partial: null, partialCount: 0, error: null } });
    const r = await baeGw().draw({
      jobId: j.id, kind: j.kind, parentJobId: null, promptText: j.promptText, ratio: s.ratio, tier: s.tier, tilt: b.tilt(), images,
      previews: { rough: inp?.rough.small ?? null, roughNotes: inp?.rough.annotated ?? null, refs: (inp?.refs ?? []).map((x) => x.small) },
      summary: { request: s.request, ratio: s.ratio, tier: s.tier, size, time: s.time, timeLabel: time?.label ?? s.time, place: s.place, persp: s.persp, perspLabel: persp?.label ?? s.persp,
        tilt: b.tilt(), refNotes: s.refs.map((x) => x.note), roughNotes: inp?.rough.notesText ?? '', styleMode: s.styleMode, picks: j.order.picks, manualVer: j.order.manualVer, fixedVer: j.order.blocksVer },
      pd: { summaryKo: j.order.summary, notesKo: j.order.notes, reason: j.order.reason, prompt: j.promptText, raw: j.order.raw, revisions: j.order.revisions, revTexts: j.order.revTexts,
        director: j.order.director ? { ko: j.order.director.ko, en: j.order.director.en, replaced: j.order.director.replaced } : null },
      orderCostUsd: j.orderCostUsd, name: null, createdAt: j.createdAt,
    }).catch((e) => ({ ok: false as const, aborted: false, message: msg(e), code: null }));
    const cur = get().job; if (!cur || cur.id !== j.id) return;
    if (!r.ok) {
      set({ job: { ...cur, phase: r.aborted ? 'stopped' : 'failed', error: r.message, partial: null } });
      if (!r.aborted) notifyDone('그림을 만들지 못했어요', r.message);
      void useBaeJobs.getState().load();
      return;
    }
    const url = URL.createObjectURL(new Blob([r.png as BlobPart], { type: 'image/png' }));
    set({ job: { ...cur, phase: 'done', partial: null, result: { url, w: r.w, h: r.h, sec: r.sec, costUsd: r.costUsd, model: r.model } } });
    notifyDone('그림이 다 됐어요', 'BAE경에서 결과를 확인해 주세요.');
    void useBaeJobs.getState().load();
  },

  stop: async () => {
    const j = get().job; if (!j) return;
    if (j.phase === 'ordering' || j.phase === 'revising' || j.phase === 'drawing') await baeGw().abort(j.id).catch(() => false);
  },
  fold: () => set({ makingBig: false }),
  unfold: () => set({ makingBig: true }),
  openMake: () => { const j = get().job; if (j?.order) set({ win: 'make', winAuto: false, waitingCheck: false }); },
  backToMaterials: () => set({ win: 'material', winAuto: false }),
  setPrompt: (t) => { const j = get().job; if (j) set({ job: { ...j, promptText: t } }); },
  dismissResult: () => set({ job: null }),
}));

/** 작업판 · 만드는 화면에 쓸 '지금 작업' 한 건을 기록 모양으로 (기록 목록 맨 위에 끼울 때). */
export function baeActiveAsRecord(j: BaeActiveJob, me: { id: string; name: string }): BaeJob {
  return {
    id: j.id, userId: me.id, userName: me.name, kind: j.kind, status: j.phase === 'done' ? 'done' : j.phase === 'failed' ? 'failed' : j.phase === 'stopped' ? 'stopped' : j.phase === 'drawing' ? 'drawing' : 'ordered',
    name: null, parentJobId: null, summary: {}, result: j.result ? { w: j.result.w, h: j.result.h, sec: j.result.sec } : {}, images: j.result ? { result: j.result.url, thumb: j.result.url } : {},
    selfReview: null, stamp: null, stampAt: null, costUsd: j.result?.costUsd ?? j.orderCostUsd ?? 0, origin: '', appVersion: '', hidden: false,
    createdAt: j.createdAt, finishedAt: null, updatedAt: new Date(j.startedAt).toISOString(),
  };
}

export const BAE_TIERS = TIERS;
export const BAE_DIR_NOTES = dirNotes;
