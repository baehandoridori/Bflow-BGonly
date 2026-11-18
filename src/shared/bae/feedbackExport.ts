// BAE경 '피드백 내보내기' (HTML v0.4.11 exportFeedback · askExport): 다음 매뉴얼 고침에 넘길 zip 하나.
// 여기는 순수 계산만 — 어떤 기록을 넣을지, 기록마다 어떤 그림을 찾을지, feedback.json · feedback.md 글.
// 그림을 읽고 zip 을 쓰는 것은 메인(electron/bae/baeFeedbackExport.ts)과 테스트 모드(previewGateway)가 한다.
// 화면 · 메인 · node 시험이 그대로 읽게 값 import 가 없다 (jobs.ts 의 판 규칙 몇 줄을 아래에 같은 뜻으로 둔다).
import type { BaeJob, BaeJobKind, BaeJobSummary } from './jobs';

export const BAE_FEEDBACK_MODES = ['reviewed', 'fresh', 'all'] as const;
/** reviewed = 검수한 그림만 · fresh = 검수한 그림 + 검수 안 한 최근 그림 · all = 검수한 그림이 없어서 전부 */
export type BaeFeedbackMode = (typeof BAE_FEEDBACK_MODES)[number];
/** 넣는 기록: 그림 모델이 그린 것만 (새 배경 · 같은 장소 · 고친 그림 · 다른 각도). 도구 작업(레이어 · 4K · 노이즈 제거 · 불러온 그림)은 주문서가 없어 뺀다. */
export const BAE_FEEDBACK_KINDS: readonly BaeJobKind[] = ['new', 'same', 'edit', 'angle'];
/** 검수 안 한 최근 그림은 가장 최근 20장까지 (HTML 과 같음) */
export const BAE_FEEDBACK_FRESH_MAX = 20;
/** 한 번에 넣는 기록 수 (메인이 기록을 한 건씩 다시 읽는다) */
export const BAE_FEEDBACK_MAX = 300;
export const BAE_FEEDBACK_BUTTON_TITLE = '검수한 그림을 설명과 함께 zip 하나로 묶어요. 검수 안 한 최근 그림도 넣을 수 있어요';

/** 화면 → 메인: 고른 방식과 기록 id (화면이 물어볼 때 센 것 그대로). 글과 그림은 메인이 서버 · 이 PC 에서 다시 읽는다. */
export interface BaeFeedbackRequest { mode: BaeFeedbackMode; ids: string[] }
export interface BaeFeedbackResult {
  /** saved = 저장함 · canceled = 저장 창에서 그만둠 · empty = 넣을 기록을 못 찾음 */
  status: 'saved' | 'canceled' | 'empty';
  /** 저장한 자리 (테스트 모드는 내려받은 파일 이름, 못 내려받았으면 null) */
  path: string | null;
  mode: BaeFeedbackMode;
  count: number;
  /** zip 에 넣은 그림 수 · 그중 서버의 작은 미리보기로 넣은 수 · 못 넣은 그림 수 · 못 읽은 기록 수 */
  images: number; previews: number; missing: number; skipped: number;
  bytes: number;
  /** 알림에 띄울 글 */
  message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;   // jobs.ts isBaeJobId 와 같음
export function baeFeedbackRequestProblem(v: unknown): string | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((k) => k !== 'mode' && k !== 'ids')) return '내보낼 기록을 다시 골라 주세요.';
  if (!(BAE_FEEDBACK_MODES as readonly unknown[]).includes(r.mode)) return '내보내는 방식이 올바르지 않아요.';
  if (!Array.isArray(r.ids) || r.ids.length < 1 || r.ids.length > BAE_FEEDBACK_MAX) return `한 번에 내보낼 그림은 1~${BAE_FEEDBACK_MAX}장이에요.`;
  if (!r.ids.every((id) => typeof id === 'string' && UUID_RE.test(id)) || new Set(r.ids).size !== r.ids.length) return 'BAE경 작업 번호가 올바르지 않아요.';
  return null;
}

// ── 고르기 ──
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const txts = (v: unknown): string[] => (Array.isArray(v) ? v.map(txt).filter(Boolean) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 내가 남긴 검수 (HTML review: 점수 · 문제 · 아쉬운 점 · 좋았던 점 · 원하는 쪽 · 표시 수). 앱의 검수는 rate · good · bad. 아무것도 없으면 null. */
export interface BaeFeedbackReview { score: string; problems: string[]; bad: string; good: string; want: string; marks: number }
export function baeFeedbackReviewOf(selfReview: unknown): BaeFeedbackReview | null {
  const r = obj(selfReview);
  const marks = Array.isArray(r.strokes) ? r.strokes.length : Math.max(0, Math.floor(num(r.marks) ?? 0));
  const v: BaeFeedbackReview = { score: txt(r.rate) || txt(r.score), problems: txts(r.problems ?? r.tags), bad: txt(r.bad), good: txt(r.good), want: txt(r.want), marks };
  return v.score || v.problems.length || v.bad || v.good || v.want || v.marks ? v : null;
}
/** 검수한 그림 = 내가 검수를 남겼거나 검수자가 좋아요 · 다시 도장을 찍은 그림 ('확인함'만 찍힌 것은 아직 아님). */
export function baeFeedbackIsReviewed(j: Pick<BaeJob, 'selfReview' | 'stamp'>): boolean {
  return !!baeFeedbackReviewOf(j.selfReview) || j.stamp === 'good' || j.stamp === 'again';
}
const byCreated = (a: BaeJob, b: BaeJob) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** 넣을 수 있는 기록: 다 그렸고 · 숨기지 않았고 · 그림 모델이 그린 것. 만든 순서(오래된 것 먼저), 같은 id 는 한 번. */
export function baeFeedbackCandidates(jobs: readonly BaeJob[]): BaeJob[] {
  const seen = new Set<string>(); const out: BaeJob[] = [];
  for (const j of jobs) {
    if (!j || !UUID_RE.test(j.id) || seen.has(j.id) || j.status !== 'done' || j.hidden || !BAE_FEEDBACK_KINDS.includes(j.kind)) continue;
    seen.add(j.id); out.push(j);
  }
  return out.sort(byCreated);
}
export interface BaeFeedbackPlan { all: BaeJob[]; reviewed: BaeJob[]; fresh: BaeJob[] }
/** 넣을 수 있는 것(가장 최근 300장) · 그중 검수한 것 · 검수 안 한 최근 20장. */
export function baeFeedbackPlan(jobs: readonly BaeJob[]): BaeFeedbackPlan {
  const all = baeFeedbackCandidates(jobs).slice(-BAE_FEEDBACK_MAX);
  return { all, reviewed: all.filter(baeFeedbackIsReviewed), fresh: all.filter((j) => !baeFeedbackIsReviewed(j)).slice(-BAE_FEEDBACK_FRESH_MAX) };
}
/** 무엇을 할지: none = 넣을 것이 없음 · all = 검수한 것이 없어 전부 · reviewed = 검수한 것뿐 (최근 그림이 없음) · ask = 물어본다. */
export function baeFeedbackAsk(p: BaeFeedbackPlan): 'none' | 'all' | 'reviewed' | 'ask' {
  if (!p.all.length) return 'none';
  if (!p.reviewed.length) return 'all';
  return p.fresh.length ? 'ask' : 'reviewed';
}
/** 고른 대로: 검수한 것이 없으면 전부, withFresh 면 검수한 것 + 최근 그림 (만든 순서). */
export function baeFeedbackPick(p: BaeFeedbackPlan, withFresh: boolean): { mode: BaeFeedbackMode; jobs: BaeJob[] } {
  if (!p.reviewed.length) return { mode: 'all', jobs: p.all };
  if (withFresh && p.fresh.length) return { mode: 'fresh', jobs: [...p.reviewed, ...p.fresh].sort(byCreated) };
  return { mode: 'reviewed', jobs: p.reviewed };
}
/** 묻는 창의 글 (HTML askExport 그대로). */
export function baeFeedbackAskText(nReviewed: number, nFresh: number) {
  return {
    title: '피드백 내보내기',
    text: `검수한 그림이 ${nReviewed}장 있어요. 검수하지 않은 최근 그림 ${nFresh}장도 같이 넣을까요? 새로 시험한 그림은 검수 전이라도 넣어 주세요.`,
    fresh: `최근 그림 ${nFresh}장도 넣기`,
    only: `검수한 ${nReviewed}장만`,
    cancel: '취소',
  };
}
/** 다 묶었을 때 알림 (HTML 의 toast 글 + 못 넣은 그림). */
export function baeFeedbackDoneText(mode: BaeFeedbackMode, count: number, missing: number): string {
  const base = mode === 'reviewed' ? `검수한 그림 ${count}장을 묶었어요` : mode === 'fresh' ? `검수한 그림과 최근 그림 ${count}장을 묶었어요` : `검수한 그림이 없어서 전부(${count}장) 묶었어요`;
  return missing ? `${base}. 이 PC 에 없어서 못 넣은 그림 ${missing}장은 feedback.md 에 적어 두었어요.` : base;
}
const pad = (n: number) => String(n).padStart(2, '0');
/** 저장 창의 처음 이름: 'BAE경_피드백_YYYYMMDD_HHMM.zip' (이 PC 의 시각). */
export function baeFeedbackZipName(d: Date): string {
  return `BAE경_피드백_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}
/** '11월 17일 09:05' (이 PC 의 시각, HTML day 와 같음). */
export function baeFeedbackDay(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}
/** zip 안의 기록 이름: r01_1a2b3c4d (만든 순서 + 작업 번호 앞 8자). */
export const baeFeedbackKey = (index: number, jobId: string) => `r${pad(index + 1)}_${jobId.slice(0, 8)}`;

// ── 기록마다 찾을 그림 ──
export type BaeFeedbackSlot = 'result' | 'marked' | 'rough' | 'roughNotes' | 'roughLevel' | 'ref' | 'base' | 'sheet' | 'otherLock' | 'beforeNoise';
/**
 * 그림 하나를 찾는 방법: 이 PC 작업 폴더의 이름(앞에서부터) → 없으면 서버 미리보기 주소(작은 JPG) → 그래도 없으면 required 일 때 '못 넣은 그림'.
 * zip 이름은 stem + 찾은 파일의 확장자 (미리보기는 stem + '_preview.jpg').
 */
export interface BaeFeedbackWant { slot: BaeFeedbackSlot; n?: number; label: string; local: string[]; url: string | null; stem: string; required: boolean }
export interface BaeFeedbackGot { slot: BaeFeedbackSlot; n?: number; path: string; preview: boolean }
export interface BaeFeedbackMiss { slot: BaeFeedbackSlot; n?: number; label: string }

/** jobs.ts baeJobVariant · baeVariantFile · BAE_BASE_VARIANT_FILES 와 같은 규칙 (값 import 를 하지 않으려고 여기 둔다). */
const BASE_FILES = ['final.png', 'gpt.png', 'source.png'];
function variantOf(j: Pick<BaeJob, 'result'>): { alt: boolean; noise: boolean } {
  const f = j.result?.finish;
  return { alt: !!f?.lock && f.lock.on === false, noise: !!f?.noise?.on };
}
const variantFile = (v: { alt: boolean; noise: boolean }) => (v.alt ? (v.noise ? 'alt_noise.png' : 'alt.png') : v.noise ? 'final_noise.png' : null);
const variantLocal = (v: { alt: boolean; noise: boolean }) => { const f = variantFile(v); return f ? [f] : [...BASE_FILES]; };
const both = (stem: string) => [`${stem}.jpg`, `${stem}.png`];
const urlOr = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function baeFeedbackWants(j: BaeJob, key: string): BaeFeedbackWant[] {
  const im = j.images ?? {}; const v = variantOf(j); const lock = j.result?.finish?.lock;
  const s = (x: string) => `images/${key}_${x}`;
  const out: BaeFeedbackWant[] = [
    { slot: 'result', label: '결과', local: ['result.png', ...variantLocal(v)], url: urlOr(im.result), stem: s('result'), required: true },
    { slot: 'marked', label: '검수 표시', local: both('review'), url: null, stem: s('marked'), required: false },
    { slot: 'rough', label: '러프', local: both('rough'), url: urlOr(im.rough), stem: s('rough'), required: !!im.rough },
    { slot: 'roughNotes', label: '빨간 메모', local: both('rough_notes'), url: urlOr(im.roughNotes), stem: s('rough_notes'), required: !!im.roughNotes },
  ];
  const refs = Array.isArray(im.refs) ? im.refs : [];
  for (let n = 1; n <= 4; n++) out.push({ slot: 'ref', n, label: `레퍼런스 ${n}`, local: both(`ref_${n}`), url: urlOr(refs[n - 1]), stem: s(`ref${n}`), required: !!urlOr(refs[n - 1]) });
  out.push({ slot: 'roughLevel', label: '수평 맞춘 러프', local: both('rough_level'), url: null, stem: s('rough_level'), required: false });
  out.push({ slot: 'sheet', label: '부품 시트', local: both('sheet'), url: urlOr(im.sheet), stem: s('sheet'), required: !!im.sheet });
  const bases = Array.isArray(im.bases) ? im.bases : [];
  for (let n = 1; n <= 3; n++) out.push({ slot: 'base', n, label: `기준 배경 ${n}`, local: both(`base_${n}`), url: urlOr(bases[n - 1]), stem: s(`base${n}`), required: !!urlOr(bases[n - 1]) });
  // 색 맞춤의 다른 판 · 노이즈 지우기 전 (HTML altBlob · noiseSrc): 이 PC 에만 있다
  if (lock && (lock.moved ?? 0) > 0) out.push({ slot: 'otherLock', label: lock.on ? '색 맞추기 전' : '색 맞춘 그림', local: variantLocal({ alt: !v.alt, noise: false }), url: null, stem: s(lock.on ? 'result_before_lock' : 'result_locked'), required: true });
  if (v.noise) out.push({ slot: 'beforeNoise', label: '노이즈 지우기 전', local: variantLocal({ alt: v.alt, noise: false }), url: null, stem: s('result_before_noise'), required: true });
  return out;
}
/** 찾은 파일의 zip 이름 (local = 이 PC 파일 이름, null = 서버 미리보기). */
export function baeFeedbackZipPath(w: Pick<BaeFeedbackWant, 'stem'>, local: string | null): string {
  return local === null ? `${w.stem}_preview.jpg` : `${w.stem}.${local.toLowerCase().endsWith('.png') ? 'png' : 'jpg'}`;
}

// ── feedback.json 한 건 ──
export interface BaeFeedbackFiles {
  result?: string; marked?: string; rough?: string; roughNotes?: string; roughLevel?: string; refs?: string[]; bases?: string[]; sheet?: string;
  otherLock?: string; beforeNoise?: string;
}
export interface BaeFeedbackItem {
  id: string; jobId: string; name: string; kind: BaeJobKind; createdAt: string;
  manual: string; fixedSentences: string; guidance: string;
  model: string; quality: string; size: string; ratio: string;
  time: string; place: string; perspective: string; camera: string;
  request: string; director: string[]; directorEn: string[]; notes: string; refNotes: string[];
  styleMode: string; styleExamples: string[];
  summary: string; pdNotes: string[]; reason: string; revisions: string[]; prompt: string;
  reviewed: boolean;
  baseBackgrounds: NonNullable<BaeJobSummary['base']> | null;
  tilt: number;
  colorLock: { shown: 'locked' | 'before'; moved: number } | null;
  noise: { on: true; sec: number | null; before: string | null } | null;
  angle: Record<string, unknown> | null;
  review: BaeFeedbackReview | null;
  stamp: { stamp: 'seen' | 'good' | 'again'; label: string; note: string; at: string | null } | null;
  sec: number | null; costUsd: number;
  files: BaeFeedbackFiles;
  /** 이 PC 에 원본이 없어 서버의 작은 미리보기(JPG)로 넣은 그림 */
  previews: string[];
  /** 넣지 못한 그림 (이름) */
  missing: string[];
}
const STAMP_LABEL = { seen: '확인함', good: '좋아요', again: '다시' } as const;   // review.ts BAE_STAMP_LABEL 과 같음
const KIND_LABEL: Record<string, string> = { new: '새 배경', same: '같은 장소', edit: '고친 그림', angle: '다른 각도' };
const PLACE_LABEL: Record<string, string> = { auto: '자동', interior: '실내', exterior: '실외' };

/** 다른 각도 기록 (HTML 피드백의 angle 칸 모양으로). guide = rough, 원래 그림 = ref1, 같은 공간 그림은 보낸 순서대로 ref2 … */
function angleOf(a: unknown): Record<string, unknown> | null {
  if (!a || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  const sources = Array.isArray(r.sources) ? r.sources.map(obj) : [];
  const memo = r.memo && typeof r.memo === 'object' ? obj(r.memo) : null;
  let sent = 0;
  return {
    from: txt(r.fromName), label: txt(r.label), line: txt(r.line), camera: txt(r.sentence), orbit: num(r.orbit), pitch: num(r.pitch), floorH: num(r.floorH), dist: num(r.dist),
    kind: r.kind ?? null, hfov: num(r.hfov), guide: 'rough', original: 'ref1',
    more: sources.map((x) => {
      const isSent = x.sent !== false; const ref = isSent ? `ref${sent + 2}` : null; if (isSent) sent++;
      return { letter: x.letter ?? null, name: x.name ?? null, ref, sent: isSent, pos: x.pos ?? null, yaw: x.yaw ?? null, wall: x.wall ?? null, dist: x.dist ?? null, eye: x.eye ?? null, size: x.size ?? null };
    }),
    notes: num(r.notes) ?? 0, shares: r.shares ?? null, preset: r.preset ?? null, shift: r.shift ?? null,
    memo: memo ? { n: num(memo.n) ?? 0, pd: memo.pd ?? null, ko: txt(memo.ko), raw: memo.raw === true, notes: 'rough_notes' } : null,
    crop: r.crop ?? null,
  };
}

/** 기록 한 건 → feedback.json 의 한 칸 (HTML list.push 의 칸 이름 그대로 + 앱에만 있는 것). fallbackPrompt = 이 PC job.json 의 주문서. */
export function baeFeedbackItem(j: BaeJob, key: string, got: readonly BaeFeedbackGot[], missed: readonly BaeFeedbackMiss[], fallbackPrompt = ''): BaeFeedbackItem {
  const s = obj(j.summary) as BaeJobSummary; const pd = obj(j.pd); const res = obj(j.result); const fin = obj(res.finish);
  const files: BaeFeedbackFiles = {};
  for (const g of got) {
    if (g.slot === 'ref') (files.refs ??= []).push(g.path);
    else if (g.slot === 'base') (files.bases ??= []).push(g.path);
    else files[g.slot] = g.path;
  }
  const lock = fin.lock && typeof fin.lock === 'object' ? obj(fin.lock) : null;
  const moved = num(lock?.moved) ?? 0;
  const noise = fin.noise && typeof fin.noise === 'object' ? obj(fin.noise) : null;
  const dir = obj(pd.director);
  const w = num(res.w); const h = num(res.h);
  const base = s.base && typeof s.base === 'object' ? s.base : null;
  return {
    id: key, jobId: j.id, name: txt(j.name), kind: j.kind, createdAt: j.createdAt,
    manual: txt(s.manualVer) || '(기록 없음)', fixedSentences: txt(s.fixedVer), guidance: txt(s.guidanceVer),
    model: txt(res.model), quality: txt(res.quality), size: w && h ? `${w}x${h}` : '', ratio: txt(s.ratio),
    time: txt(s.timeLabel) || txt(s.time), place: txt(s.place), perspective: txt(s.perspLabel) || txt(s.persp), camera: txt(s.camera),
    request: txt(s.request), director: txts(dir.ko), directorEn: txts(dir.en), notes: txt(s.roughNotes), refNotes: Array.isArray(s.refNotes) ? s.refNotes.map((x) => (typeof x === 'string' ? x : '')) : [],
    styleMode: txt(s.styleMode), styleExamples: txts(s.picks),
    summary: txt(pd.summaryKo), pdNotes: txts(pd.notesKo), reason: txt(pd.reason), revisions: txts(pd.revisions), prompt: txt(pd.prompt) || txt(fallbackPrompt),
    reviewed: baeFeedbackIsReviewed(j),
    baseBackgrounds: base, tilt: num(s.tilt) ?? num(fin.tilt) ?? 0,
    colorLock: lock && moved > 0 ? { shown: lock.on === false ? 'before' : 'locked', moved } : null,
    noise: noise && noise.on === true ? { on: true, sec: num(noise.sec), before: files.beforeNoise ?? null } : null,
    angle: angleOf(s.angle),
    review: baeFeedbackReviewOf(j.selfReview),
    stamp: j.stamp ? { stamp: j.stamp, label: STAMP_LABEL[j.stamp], note: txt(j.stampNote), at: j.stampAt ?? null } : null,
    sec: num(res.sec), costUsd: Number(j.costUsd) || 0,
    files,
    previews: got.filter((g) => g.preview).map((g) => g.path),
    missing: missed.map((m) => m.label),
  };
}

// ── 머리 · 글 ──
export interface BaeFeedbackHead {
  app: string; exportedAt: string;
  /** 지금 설정의 판 (본문은 관리자 화면에만 가므로 판 번호만 적는다) */
  currentManual: string | null; currentFixedSentences: string | null; currentGuidance: string | null;
  mode: BaeFeedbackMode; onlyReviewed: boolean; withFresh: boolean; count: number;
  /** 고른 기록 중 다시 읽지 못해 빠진 수 */
  skipped: number;
  /** 무엇을 '검수한 그림'으로 셌는지 */
  reviewedMeans: string;
}
export function baeFeedbackHead(o: { app: string; now: Date; versions: { manual: string | null; fixed: string | null; guidance: string | null } | null; mode: BaeFeedbackMode; count: number; skipped: number }): BaeFeedbackHead {
  return {
    app: o.app, exportedAt: o.now.toISOString(),
    currentManual: o.versions?.manual ?? null, currentFixedSentences: o.versions?.fixed ?? null, currentGuidance: o.versions?.guidance ?? null,
    mode: o.mode, onlyReviewed: o.mode === 'reviewed', withFresh: o.mode === 'fresh', count: o.count, skipped: o.skipped,
    reviewedMeans: '내가 검수를 남겼거나 검수자가 좋아요 · 다시 도장을 찍은 그림',
  };
}
export function baeFeedbackJson(head: BaeFeedbackHead, items: readonly BaeFeedbackItem[]): string {
  return JSON.stringify({ ...head, items }, null, 2);
}
const MODE_TEXT: Record<BaeFeedbackMode, string> = { reviewed: ', 검수한 그림만', fresh: ', 검수한 그림 + 검수 안 한 최근 그림', all: ', 검수한 그림이 없어서 전부' };
/** feedback.md (HTML 과 같은 모양: 머리, 그림마다 줄들, 그리고 영어 주문서). */
export function baeFeedbackMarkdown(head: BaeFeedbackHead, items: readonly BaeFeedbackItem[]): string {
  const md = [
    `# BAE경 피드백 (${baeFeedbackDay(head.exportedAt)}, ${items.length}장${MODE_TEXT[head.mode]})`, '',
    `지금 매뉴얼: ${head.currentManual ?? '(모름)'} · 고정 문장 ${head.currentFixedSentences ?? '(모름)'}${head.currentGuidance ? ` · 덧붙인 지침 ${head.currentGuidance}판` : ''}`,
    `검수한 그림 = ${head.reviewedMeans}.${head.skipped ? ` 고른 기록 중 ${head.skipped}건은 다시 읽지 못해 빠졌어요.` : ''}`, '',
  ];
  for (const it of items) {
    const tag = it.review ? ` · ${it.review.score || '메모'}` : it.stamp && it.stamp.stamp !== 'seen' ? ` · 도장 ${it.stamp.label}` : it.reviewed ? '' : ' · 검수 안 함';
    md.push(`## ${it.id} · ${baeFeedbackDay(it.createdAt)}${tag}`, '');
    if (it.name) md.push(`- 이름: ${it.name}`);
    if (it.kind !== 'new') md.push(`- 종류: ${KIND_LABEL[it.kind] ?? it.kind}`);
    md.push(`- 매뉴얼 ${it.manual} · ${it.size || '크기 모름'}${it.ratio ? ` (${it.ratio})` : ''} · 품질 ${it.quality || '모름'} · ${it.model || '모델 모름'}`);
    md.push(`- 시간대 ${it.time || '자동'} · 장소 ${PLACE_LABEL[it.place] ?? (it.place || '자동')} · 투시 ${it.perspective || '자동'}`);
    if (it.request) md.push(`- 설명: ${it.request}`);
    if (it.director.length) md.push(`- 개발자 지문: ${it.director.join(' / ')}`);
    if (it.pdNotes.length) md.push(`- PD 메모: ${it.pdNotes.join(' / ')}`);
    if (it.review) {
      if (it.review.problems.length) md.push(`- 문제: ${it.review.problems.join(', ')}`);
      if (it.review.bad) md.push(`- 아쉬운 점: ${it.review.bad}`);
      if (it.review.good) md.push(`- 좋았던 점: ${it.review.good}`);
      if (it.review.want) md.push(`- 원하는 쪽: ${it.review.want}`);
    }
    if (it.stamp) md.push(`- 검수자 도장: ${it.stamp.label}${it.stamp.note ? ` · ${it.stamp.note}` : ''}`);
    const b = it.baseBackgrounds;
    if (b || it.tilt || it.colorLock) {
      const notes = Array.isArray(b?.notes) ? b.notes.filter(Boolean) : [];
      md.push(`- 기준 배경: ${b ? `${b.mode === 'sheet' ? `부품 시트 (부품 ${b.parts}개)` : `${b.n}장 통째로`}${b.painted ? ' · 칠한 러프' : ''}${notes.length ? ` · ${notes.join(' / ')}` : ''}` : '없음'}`
        + `${it.tilt ? ` · 기울기 ${it.tilt}°` : ''}${it.colorLock ? ` · 색 맞춤 ${it.colorLock.shown === 'locked' ? '켬' : '끔'} (${it.colorLock.moved}곳)` : ''}`);
    }
    if (it.noise) md.push(`- 노이즈 제거: 켬 (결과는 지운 그림${it.noise.before ? `, 지우기 전은 ${it.noise.before}` : ''})`);
    if (it.angle) md.push(`- 다른 각도: ${txt(it.angle.line) || txt(it.angle.label)}${txt(it.angle.from) ? ` (원래 그림: ${txt(it.angle.from)})` : ''}`);
    const f = it.files;
    const pics = [f.result, f.marked, f.rough, f.roughNotes, ...(f.refs ?? [])].filter((x): x is string => !!x);
    md.push(`- 그림: ${pics.length ? pics.join(', ') : '(없음)'}`);
    if (it.previews.length) md.push(`- 이 PC 에 원본이 없어서 서버의 작은 미리보기로 넣은 그림: ${it.previews.join(', ')}`);
    if (it.missing.length) md.push(`- 넣지 못한 그림: ${it.missing.join(', ')} (이 PC 에 원본이 없고 서버 미리보기도 없어요. 만든 PC 에서 내보내면 들어가요)`);
    const fence = it.prompt.includes('```') ? '````' : '```';
    md.push('', fence, it.prompt || '(주문서 기록 없음)', fence, '');
  }
  return md.join('\n');
}
