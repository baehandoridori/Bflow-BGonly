// BAE경 작업 기록과 장부의 모양 (서버 bae_gyeong_session_job_* · usage_* 함수의 짝). 화면 · 메인 · 테스트 모드가 같이 쓴다.
// DOM · Electron · '@/' 없이 상대 경로만.
import type { BaeAngleRecord } from './angle/calls';

export const BAE_JOB_KINDS = ['new', 'same', 'edit', 'angle', 'layers', 'import', 'upscale', 'denoise'] as const;
export type BaeJobKind = (typeof BAE_JOB_KINDS)[number];
export const BAE_JOB_STATUSES = ['ordering', 'ordered', 'drawing', 'done', 'failed', 'stopped'] as const;
export type BaeJobStatus = (typeof BAE_JOB_STATUSES)[number];
export const BAE_USAGE_KINDS = ['order', 'image', 'layers', 'angle', 'note', 'other'] as const;
export type BaeUsageKind = (typeof BAE_USAGE_KINDS)[number];

/** 0 주문서 쓰는 중 · 1 주문서 확인 대기 · 2 그리는 중 · 3 끝 (서버 bae_gyeong_status_rank 와 같은 규칙). */
export function baeStatusRank(s: BaeJobStatus): number {
  return s === 'ordering' ? 0 : s === 'ordered' ? 1 : s === 'drawing' ? 2 : 3;
}
export const isBaeJobFinished = (s: BaeJobStatus) => baeStatusRank(s) === 3;

/**
 * 저장소(scene-images 버킷) 안 미리보기 자리. 사용자가 쓴 글자는 경로에 넣지 않는다 — 작업 id 와 정해 둔 이름만.
 * 저장소는 덮어쓰지 않으므로(baePreviews.ts) 결과의 판마다 이름이 따로 있다: result(처음 마무리한 그림) · alt(색 맞춤을 바꾼 그림) ·
 * noise · altnoise(그 둘의 노이즈 제거). 재료는 rough · rough_notes · ref_N · base_N(기준 배경 통째로) · sheet(부품 시트).
 */
export const BAE_PREVIEW_NAMES = [
  'result_1600.jpg', 'result_320.jpg', 'gpt_1600.jpg', 'alt_1600.jpg', 'alt_320.jpg', 'noise_1600.jpg', 'noise_320.jpg', 'altnoise_1600.jpg', 'altnoise_320.jpg',
  'rough.jpg', 'rough_notes.jpg', 'ref_1.jpg', 'ref_2.jpg', 'ref_3.jpg', 'ref_4.jpg', 'base_1.jpg', 'base_2.jpg', 'base_3.jpg', 'sheet.jpg',
] as const;
export type BaePreviewName = (typeof BAE_PREVIEW_NAMES)[number];

/**
 * 결과의 판 (HTML rec.blob · altBlob · noiseSrc · noiseClean 을 파일로): alt = 색 맞춤을 바꾼 쪽(처음 마무리한 그림이 색 맞춘 그림이면
 * 맞추기 전 그림), noise = 노이즈 제거한 것. 처음 마무리한 그림은 { alt: false, noise: false }.
 */
export interface BaeVariant { alt: boolean; noise: boolean }
/** 이 PC 보관함의 판 파일. 처음 그림은 null — 메인이 final.png → gpt.png → source.png 순서로 찾는다 (따로 적지 않은 작업도 있어서). */
export function baeVariantFile(v: BaeVariant): string | null {
  return v.alt ? (v.noise ? 'alt_noise.png' : 'alt.png') : v.noise ? 'final_noise.png' : null;
}
/** 처음 그림 파일을 찾는 순서: 화면이 마무리한 그림 · GPT 가 준 그대로 · 도구 작업에 불러온 그림. */
export const BAE_BASE_VARIANT_FILES = ['final.png', 'gpt.png', 'source.png'] as const;
/** 판마다 미리보기 이름 (1600 · 320). */
export function baeVariantPreviews(v: BaeVariant): { big: BaePreviewName; small: BaePreviewName } {
  const stem = v.alt ? (v.noise ? 'altnoise' : 'alt') : v.noise ? 'noise' : 'result';
  return { big: `${stem}_1600.jpg` as BaePreviewName, small: `${stem}_320.jpg` as BaePreviewName };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isBaeJobId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export function baePreviewPath(jobId: string, name: BaePreviewName): string {
  if (!isBaeJobId(jobId) || !(BAE_PREVIEW_NAMES as readonly string[]).includes(name)) throw new Error('BAE경 미리보기 자리가 올바르지 않아요.');
  return `bae/${jobId}/${name}`;
}

/** 작업 한 건에 남는 글과 숫자 (plan 14 5-2). 그림 원본은 만든 사람 PC, 여기는 미리보기 주소만. */
export interface BaeJobSummary {
  request?: string; // 한국어 설명 ({ } 지문 포함 그대로)
  ratio?: string; tier?: string; size?: [number, number]; drawSize?: [number, number] | null;
  time?: string; timeLabel?: string; place?: string; persp?: string; perspLabel?: string; tilt?: number; guideKo?: string; camera?: string;
  refNotes?: string[]; roughNotes?: string; styleMode?: 'auto' | 'manual'; picks?: string[];
  manualVer?: string; fixedVer?: string; guidanceVer?: string; settingsRev?: Record<string, number>;
  /** 기준 배경 (HTML 기록의 base): 방식 · 장 수 · 칠한 러프 · 어느 쪽 메모 · 부품 수. 없으면 null. */
  base?: { mode: 'sheet' | 'base'; n: number; painted: boolean; notes: string[]; parts: number } | null;
  /** 그릴 때 '그린 뒤 색 맞춤'이 켜져 있었는지 */
  lockOn?: boolean;
  /** 도구 작업(노이즈 제거 등)의 그림 이름 (불러온 파일 이름 또는 원래 작업 이름) */
  source?: string;
  /** 다른 각도로 (kind 'angle', 7단계): 카메라 · 같은 공간 그림 · PD메모 기록 + 요약 줄(line, HTML 의 요약 글) · 파일 이름 */
  angle?: BaeAngleRecord & { line: string; fileName: string };
}
/** 그린 뒤 한 일 (plan 14 5-2 '뒤에 한 일'): 기울기 되돌림 · 색 맞춤 · 노이즈 제거. */
export interface BaeJobFinish {
  /** 기울기만큼 되돌려 자른 각도 (0 이면 안 함) */
  tilt?: number;
  /** 색 맞춤: 옮긴 넓은 면 수, 지금 보이는 것이 맞춘 그림인지. 맞춘 면이 없거나 안 했으면 null */
  lock?: { moved: number; on: boolean } | null;
  /** 노이즈 제거: 지금 켜져 있는지 · 걸린 초 */
  noise?: { on: boolean; sec?: number } | null;
  /** 색 맞춤을 못 했을 때의 안내 (HTML finishPicture 의 note) · 4K 를 미리보기 그림으로 키웠을 때의 안내 */
  note?: string;
  /** 4K로 키운 작업 (kind 'upscale'): 방식 · 계산한 곳 · 그래픽카드에서 CPU 로 이어 갔나 · 키우기 전 크기 */
  upscale?: BaeUpscaleDone | null;
}
/** 4K로 키우기 한 번 (계획 14 5-2 '뒤에 한 일: 4K'). A = 선명하게(모델 일꾼), B = 원본 그대로(화면 쪽 일꾼). */
export interface BaeUpscaleDone {
  mode: 'A' | 'B';
  ep: 'dml' | 'cpu' | 'webgpu' | 'wasm';
  fellBack: boolean;
  from: [number, number];
}
export interface BaeJobPd {
  summaryKo?: string; notesKo?: string[]; reason?: string; prompt?: string; raw?: string;
  revisions?: string[]; revTexts?: string[]; director?: { ko: string[]; en: string[]; replaced: string[] } | null; model?: string;
}
export interface BaeJobResult {
  w?: number; h?: number; model?: string; quality?: string; sec?: number; error?: string; stoppedAt?: string; usdOrder?: number; usdImage?: number;
  finish?: BaeJobFinish;
  /** 레이어로 나누기 (kind 'layers', 5단계): PSD 에 든 것. count 는 물건 레이어 수 (빈 방 '배경' 한 장은 따로) */
  layers?: BaeLayersDone;
}
/** 다 나눈 레이어 작업의 숫자 (electron/bae/baeLayers.ts done 의 result.layers). */
export interface BaeLayersDone {
  count: number; shadows: number; bins: { OL: number; ML: number; UL: number }; left: number; merged: number; props: number; stackDiff: number; again: boolean;
  /** 이 PC 작업 폴더의 PSD 파일 이름 ('layers.psd') */
  file: string;
  /** 6단계: 가장자리 방식과 그 까닭 (쉬운 말) */
  edges?: string; edgesNote?: string;
}
/** 미리보기 주소. source = 도구 작업의 원래 그림 · 판을 바꾼 작업의 처음 그림, bases · sheet = 기준 배경 재료. */
export type BaeJobImages = Partial<Record<'result' | 'thumb' | 'gpt' | 'rough' | 'roughNotes' | 'sheet' | 'source', string>> & { refs?: string[]; bases?: string[] };

/** 기록의 '지금 보이는 판' (색 맞춤을 바꿨는지 · 노이즈를 지웠는지). */
export function baeJobVariant(j: Pick<BaeJob, 'result'>): BaeVariant {
  const f = j.result?.finish;
  return { alt: !!f?.lock && f.lock.on === false, noise: !!f?.noise?.on };
}
/** 색 맞춤을 켜고 끌 수 있는 작업인지 (HTML syncLockRow: altBlob 이 있을 때만). */
export const baeJobHasLock = (j: Pick<BaeJob, 'result'>): boolean => !!j.result?.finish?.lock && (j.result.finish.lock.moved ?? 0) > 0;

export interface BaeJob {
  id: string; userId: string; userName: string; kind: BaeJobKind; status: BaeJobStatus; name: string | null; parentJobId: string | null;
  summary: BaeJobSummary; result: BaeJobResult; images: BaeJobImages; selfReview: Record<string, unknown> | null;
  stamp: 'seen' | 'good' | 'again' | null; stampAt: string | null; costUsd: number; origin: string; appVersion: string; hidden: boolean;
  createdAt: string; finishedAt: string | null; updatedAt: string;
  pd?: BaeJobPd; stampBy?: string | null; stampNote?: string | null;
}
/** 메인이 서버에 보내는 한 번의 쓰기. 보낸 칸만 바뀐다. 누가 · 이름표는 서버가 정한다. */
export interface BaeJobWrite {
  id: string; kind?: BaeJobKind; status: BaeJobStatus; name?: string | null; parentJobId?: string | null;
  summary?: BaeJobSummary; pd?: BaeJobPd; result?: BaeJobResult; images?: BaeJobImages; selfReview?: Record<string, unknown> | null;
  costUsd?: number; origin?: string; appVersion?: string; createdAt?: string; finishedAt?: string;
}
export interface BaeJobPage { rows: BaeJob[]; more: boolean; serverTime: string; total: number }

export interface BaeUsageLine {
  requestId: string; jobId: string | null; kind: BaeUsageKind; model: string; tokens: Record<string, number>; usd: number; at: string;
}
export interface BaeUsageSummary { usd: number; images: number; orders: number; lines: { kind: string; model: string; n: number; usd: number }[] }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseBaeJob(v: unknown): BaeJob {
  const r = obj(v);
  if (!isBaeJobId(r.id) || typeof r.userId !== 'string' || !(BAE_JOB_KINDS as readonly unknown[]).includes(r.kind) || !(BAE_JOB_STATUSES as readonly unknown[]).includes(r.status)) {
    throw new Error('BAE경 작업 기록이 올바르지 않아요.');
  }
  const job: BaeJob = {
    id: r.id, userId: r.userId, userName: str(r.userName) ?? '', kind: r.kind as BaeJobKind, status: r.status as BaeJobStatus,
    name: str(r.name), parentJobId: isBaeJobId(r.parentJobId) ? r.parentJobId : null,
    summary: obj(r.summary) as BaeJobSummary, result: obj(r.result) as BaeJobResult, images: obj(r.images) as BaeJobImages,
    selfReview: r.selfReview && typeof r.selfReview === 'object' ? (r.selfReview as Record<string, unknown>) : null,
    stamp: r.stamp === 'seen' || r.stamp === 'good' || r.stamp === 'again' ? r.stamp : null, stampAt: str(r.stampAt),
    costUsd: Number(r.costUsd) || 0, origin: str(r.origin) ?? '', appVersion: str(r.appVersion) ?? '', hidden: r.hidden === true,
    createdAt: str(r.createdAt) ?? '', finishedAt: str(r.finishedAt), updatedAt: str(r.updatedAt) ?? '',
  };
  if ('pd' in r) { job.pd = obj(r.pd) as BaeJobPd; job.stampBy = str(r.stampBy); job.stampNote = str(r.stampNote); }
  return job;
}
export function parseBaeJobPage(v: unknown): BaeJobPage {
  const r = obj(v);
  if (!Array.isArray(r.rows) || r.rows.length > 300) throw new Error('BAE경 작업 목록이 올바르지 않아요.');
  return { rows: r.rows.map(parseBaeJob), more: r.more === true, serverTime: str(r.serverTime) ?? '', total: Number(r.total) || 0 };
}
export function parseBaeUsageSummary(v: unknown): BaeUsageSummary {
  const r = obj(v);
  const lines = Array.isArray(r.lines) ? r.lines.map((l) => { const x = obj(l); return { kind: str(x.kind) ?? '', model: str(x.model) ?? '', n: Number(x.n) || 0, usd: Number(x.usd) || 0 }; }) : [];
  return { usd: Number(r.usd) || 0, images: Number(r.images) || 0, orders: Number(r.orders) || 0, lines };
}

/** 받은 목록을 내가 가진 목록에 끼워 넣는다 (같은 id 는 새것으로, 최근 바뀐 순서). */
export function mergeBaeJobs(have: BaeJob[], got: BaeJob[]): BaeJob[] {
  const byId = new Map(have.map((j) => [j.id, j] as const));
  for (const j of got) {
    const old = byId.get(j.id);
    if (!old || old.updatedAt <= j.updatedAt) byId.set(j.id, old && old.pd && !j.pd ? { ...j, pd: old.pd, stampBy: old.stampBy, stampNote: old.stampNote } : j);
  }
  return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}
// ── 팀 기록 (8단계, 서버 bae_gyeong_session_job_find_team 의 짝) ──
/** 팀 기록 거르기: 사람 · 기간(만든 때 from 이상 to 미만) · 종류 · 도장 없음(끝났고 도장이 없음) · 찾는 말(이름 · 설명 · PD 요약 · 영어 주문서). */
export interface BaeTeamFilter { userId?: string | null; from?: string | null; to?: string | null; kind?: BaeJobKind | null; unstamped?: boolean; q?: string }
/** 다음 쪽 위치: 서버가 준 마지막 줄의 createdAt · id 그대로 (글자를 바꾸지 않고 돌려준다). */
export interface BaeTeamCursor { createdAt: string; id: string }
export interface BaeTeamPage { rows: BaeJob[]; more: boolean; next: BaeTeamCursor | null; serverTime: string }

const isIsoTime = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
export function baeTeamFilterProblem(v: unknown): string | null {
  const f = v as Record<string, unknown> | null;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return '팀 기록 거르기 값이 올바르지 않아요.';
  const known = ['userId', 'from', 'to', 'kind', 'unstamped', 'q'];
  if (Object.keys(f).some((k) => !known.includes(k))) return '팀 기록 거르기 값이 올바르지 않아요.';
  if (f.userId != null && (typeof f.userId !== 'string' || f.userId.length > 200)) return '팀 기록 거르기 값이 올바르지 않아요.';
  if ((f.from != null && !isIsoTime(f.from)) || (f.to != null && !isIsoTime(f.to))) return '팀 기록 기간이 올바르지 않아요.';
  if (f.kind != null && !(BAE_JOB_KINDS as readonly unknown[]).includes(f.kind)) return '팀 기록 거르기 값이 올바르지 않아요.';
  if (f.unstamped != null && typeof f.unstamped !== 'boolean') return '팀 기록 거르기 값이 올바르지 않아요.';
  if (f.q != null && (typeof f.q !== 'string' || f.q.trim().length > 100)) return '찾는 말은 100자까지 쓸 수 있어요.';
  return null;
}
export function baeTeamCursorProblem(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const c = v as Record<string, unknown>;
  return typeof c === 'object' && isIsoTime(c.createdAt) && isBaeJobId(c.id) && Object.keys(c).length === 2 ? null : '팀 기록 위치가 올바르지 않아요.';
}
export function parseBaeTeamPage(v: unknown): BaeTeamPage {
  const r = obj(v);
  if (!Array.isArray(r.rows) || r.rows.length > 200) throw new Error('BAE경 팀 기록이 올바르지 않아요.');
  const n = obj(r.next);
  const next = typeof n.createdAt === 'string' && isBaeJobId(n.id) ? { createdAt: n.createdAt, id: n.id } : null;
  return { rows: r.rows.map(parseBaeJob), more: r.more === true && !!next, next: r.more === true ? next : null, serverTime: str(r.serverTime) ?? '' };
}
/** 팀 기록 줄 순서: 만든 때가 늦은 것부터 (같으면 id 큰 것부터 — 서버와 같음). */
export function sortBaeTeamRows(rows: BaeJob[]): BaeJob[] {
  return [...rows].sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
/** 글이 아닌 거르기(사람 · 기간 · 종류 · 도장 없음)에 맞는지. 시각은 같은 모양이 아닐 수 있어 수로 견준다. */
function baeTeamRowFits(j: BaeJob, f: BaeTeamFilter): boolean {
  const made = Date.parse(j.createdAt);
  if (f.userId && j.userId !== f.userId) return false;
  if (f.kind && j.kind !== f.kind) return false;
  if (f.from && !(made >= Date.parse(f.from))) return false;
  if (f.to && !(made < Date.parse(f.to))) return false;
  if (f.unstamped && (j.stamp !== null || !isBaeJobFinished(j.status))) return false;
  return true;
}
/**
 * 받은 줄이 거르기에 맞는지 (화면에서 고칠 수 있는 만큼). 찾는 말은 이름과 설명에서만 본다 — 주문서 글은 목록에 없어서 서버만 본다.
 */
export function baeTeamRowMatches(j: BaeJob, f: BaeTeamFilter): boolean {
  if (!baeTeamRowFits(j, f)) return false;
  const q = (f.q ?? '').trim().toLowerCase();
  return !q || `${j.name ?? ''}\n${j.summary.request ?? ''}`.toLowerCase().includes(q);
}
/**
 * 'jobs' 신호로 받은 바뀐 줄(서버 job_list_team 의 '바뀐 것만')을 지금 보이는 팀 목록에 끼워 넣는다.
 * - 이미 있는 줄: 글이 아닌 거르기에 아직 맞으면 새것으로, 아니면 뺀다 (예: '도장 없음'에서 도장을 받은 줄). 찾는 말은 서버가 이미 본 줄이라 다시 보지 않는다.
 * - 없던 줄: 거르기에 맞고, 다 받은 목록이거나 받은 줄 중 가장 오래된 것보다 나중에 만든 것만 (아직 받지 않은 아래쪽 쪽에 속한 줄은 넣지 않는다).
 */
export function mergeBaeTeamRows(have: BaeJob[], changed: BaeJob[], f: BaeTeamFilter, complete: boolean): BaeJob[] {
  const byId = new Map(have.map((j) => [j.id, j] as const));
  let oldest = Infinity;
  for (const j of have) { const t = Date.parse(j.createdAt); if (t < oldest) oldest = t; }
  for (const c of changed) {
    const old = byId.get(c.id);
    if (old) {
      if (old.updatedAt > c.updatedAt) continue;
      if (baeTeamRowFits(c, f)) byId.set(c.id, old.pd && !c.pd ? { ...c, pd: old.pd, stampBy: old.stampBy, stampNote: old.stampNote } : c);
      else byId.delete(c.id);
    } else if (baeTeamRowMatches(c, f) && (complete || Date.parse(c.createdAt) >= oldest)) {
      byId.set(c.id, c);
    }
  }
  return sortBaeTeamRows([...byId.values()]);
}

/** 다음 '바뀐 것만' 요청의 커서: 가진 것 중 가장 늦은 updated_at 에서 2분 겹침 (늦게 커밋된 줄 대비). */
export function baeJobCursor(rows: BaeJob[]): string | null {
  let max = '';
  for (const r of rows) if (r.updatedAt > max) max = r.updatedAt;
  if (!max) return null;
  const t = Date.parse(max);
  return Number.isFinite(t) ? new Date(t - 120_000).toISOString() : null;
}
