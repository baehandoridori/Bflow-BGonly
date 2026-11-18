// BAE경 8단계 '관리자 화면'의 모양과 순수 계산: 확인 도장 · 새 도장 숫자 · 팀 비용 표 · CSV · 기간.
// 서버(DEVLOG/migrations/2026-11-16-bae-gyeong-review.sql)의 짝. 화면 · 메인 · 테스트 모드가 같이 쓴다.
// node --test 가 바로 읽을 수 있게 값 import 가 없다 (DOM · Electron · '@/' 없이).

export const BAE_STAMPS = ['seen', 'good', 'again'] as const;
export type BaeStamp = (typeof BAE_STAMPS)[number];
/** 도장 이름과 뜻 (계획 14 6-2, 시안 '景 아이콘과 낙관'). */
export const BAE_STAMP_LABEL: Record<BaeStamp, string> = { seen: '확인함', good: '좋아요', again: '다시' };
export const BAE_STAMP_MEANING: Record<BaeStamp, string> = { seen: '봤어요', good: '이 방향이 좋아요', again: '다시 해 보면 좋겠어요' };
export const BAE_STAMP_NOTE_MAX = 400;
export const isBaeStamp = (v: unknown): v is BaeStamp => v === 'seen' || v === 'good' || v === 'again';

/** 도장 메모는 한 줄: 띄어쓰기 · 줄바꿈 묶음은 띄어쓰기 하나, 앞뒤 공백은 지우고, 비면 null (서버 bae_gyeong_stamp_note 와 같음). */
export function baeStampNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const t = note.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}
/** 찍으려는 도장의 문제 (없으면 null). stamp 가 null 이면 도장 빼기. */
export function baeStampProblem(stamp: unknown, note: unknown): string | null {
  if (stamp !== null && !isBaeStamp(stamp)) return '도장 종류가 올바르지 않아요.';
  if (note !== null && note !== undefined && typeof note !== 'string') return '도장 메모가 올바르지 않아요.';
  const n = baeStampNote(note);
  if (n && n.length > BAE_STAMP_NOTE_MAX) return `도장 메모는 ${BAE_STAMP_NOTE_MAX}자까지 쓸 수 있어요.`;
  if (stamp === 'again' && !n) return '다시 도장에는 한 줄 메모를 남겨 주세요.';
  return null;
}

/** 도장 차례 한 줄 (누가 · 언제 · 무엇 · 메모). stamp 가 null 이면 도장을 뺀 줄. */
export interface BaeStampEvent { id: number; jobId: string; stamp: BaeStamp | null; note: string | null; by: string; byName: string; at: string }
/** 만든 사람의 새 도장 (좋아요 · 다시): 숫자, 표시할 작업들, 어디까지 봤다고 적을지. */
export interface BaeStampUnseen { count: number; jobIds: string[]; upto: number }
export interface BaeStampBulkResult { stamped: string[]; skipped: number }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function parseBaeStampEvents(v: unknown): BaeStampEvent[] {
  if (!Array.isArray(v) || v.length > 100) throw new Error('BAE경 도장 기록이 올바르지 않아요.');
  return v.map((item) => {
    const r = obj(item);
    if (!Number.isSafeInteger(r.id) || !isId(r.jobId) || typeof r.by !== 'string' || typeof r.at !== 'string' || (r.stamp !== null && !isBaeStamp(r.stamp))) {
      throw new Error('BAE경 도장 기록이 올바르지 않아요.');
    }
    return { id: r.id as number, jobId: r.jobId, stamp: (r.stamp as BaeStamp | null) ?? null, note: str(r.note), by: r.by, byName: str(r.byName) ?? '', at: r.at };
  });
}
export function parseBaeStampUnseen(v: unknown): BaeStampUnseen {
  const r = obj(v);
  const count = Number(r.count); const upto = Number(r.upto);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(upto) || upto < 0 || !Array.isArray(r.jobIds)) throw new Error('BAE경 새 도장 응답이 올바르지 않아요.');
  return { count, jobIds: r.jobIds.filter(isId).slice(0, 100), upto };
}
export function parseBaeStampBulk(v: unknown): BaeStampBulkResult {
  const r = obj(v);
  if (!Array.isArray(r.stamped)) throw new Error('BAE경 도장 응답이 올바르지 않아요.');
  return { stamped: r.stamped.filter(isId), skipped: Math.max(0, Number(r.skipped) || 0) };
}

// ── 팀 비용 (서버 bae_gyeong_session_usage_team) ──
export const BAE_COST_BUCKETS = ['day', 'week', 'month'] as const;
export type BaeCostBucket = (typeof BAE_COST_BUCKETS)[number];
/** 장부 줄 종류의 이름 (계획 14 4-3: 주문서 · 그림 · 레이어 · 다른 각도). */
export const BAE_USAGE_KIND_LABEL: Record<string, string> = { order: '주문서', image: '그림', layers: '레이어', angle: '다른 각도', note: '각도 PD메모', other: '기타' };
const KIND_ORDER = ['order', 'image', 'layers', 'angle', 'note', 'other'];
const kindRank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
export interface BaeUsageTeamRow { userId: string; userName: string; period: string; kind: string; model: string; n: number; usd: number }
export interface BaeUsageTeam {
  from: string; to: string; bucket: BaeCostBucket; tz: string;
  /** 고른 기간의 칸 (한국 시각 기준 시작 날짜 'YYYY-MM-DD'). 줄이 없는 칸도 있다. */
  periods: string[];
  rows: BaeUsageTeamRow[];
  /** 같은 장부 줄들의 합 — 표의 합과 같아야 한다. */
  total: { n: number; usd: number };
  /** 이번 달 팀 합계 */
  month: { from: string; n: number; usd: number };
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseBaeUsageTeam(v: unknown): BaeUsageTeam {
  const r = obj(v);
  if (!Array.isArray(r.rows) || !Array.isArray(r.periods) || r.rows.length > 20000 || r.periods.length > 400 || !(BAE_COST_BUCKETS as readonly unknown[]).includes(r.bucket)) {
    throw new Error('BAE경 팀 비용 응답이 올바르지 않아요.');
  }
  const t = obj(r.total); const m = obj(r.month);
  return {
    from: str(r.from) ?? '', to: str(r.to) ?? '', bucket: r.bucket as BaeCostBucket, tz: str(r.tz) ?? 'Asia/Seoul',
    periods: r.periods.filter((p): p is string => typeof p === 'string' && DAY_RE.test(p)),
    rows: r.rows.map((item) => {
      const x = obj(item);
      if (typeof x.userId !== 'string' || typeof x.period !== 'string' || !DAY_RE.test(x.period)) throw new Error('BAE경 팀 비용 줄이 올바르지 않아요.');
      return { userId: x.userId, userName: str(x.userName) ?? '', period: x.period, kind: str(x.kind) ?? 'other', model: str(x.model) ?? '', n: Number(x.n) || 0, usd: Number(x.usd) || 0 };
    }),
    total: { n: Number(t.n) || 0, usd: Number(t.usd) || 0 },
    month: { from: str(m.from) ?? '', n: Number(m.n) || 0, usd: Number(m.usd) || 0 },
  };
}

/** 달러를 백만분의 1 단위 정수로 (장부는 소수 여섯째 자리까지): 더할 때 소수 오차가 쌓이지 않게. */
export const usdMicros = (usd: number) => Math.round(usd * 1e6);
const fromMicros = (m: number) => m / 1e6;

/** 칸 이름: 일 '11/16', 주 '11/16 주', 달 '2026년 11월'. */
export function baeCostPeriodLabel(key: string, bucket: BaeCostBucket): string {
  const [y, m, d] = key.split('-').map(Number);
  if (bucket === 'month') return `${y}년 ${m}월`;
  return bucket === 'week' ? `${m}/${d} 주` : `${m}/${d}`;
}

export interface BaeCostCell { usd: number; n: number }
export interface BaeCostPerson { userId: string; name: string; cells: Record<string, BaeCostCell>; usd: number; n: number }
export interface BaeCostTable {
  periods: Array<{ key: string; label: string; usd: number; n: number }>;
  people: BaeCostPerson[];
  kinds: Array<{ kind: string; label: string; usd: number; n: number }>;
  total: BaeCostCell;
  /** 표의 합(줄을 다 더한 것)과 서버가 같은 장부 줄로 센 합이 같은지 */
  check: { tableUsd: number; ledgerUsd: number; tableN: number; ledgerN: number; same: boolean };
}
/** 사람 × 기간 표 · 종류별 합 · 합계. 사람은 쓴 돈이 많은 순서, 같으면 이름 순서. 지운 사용자는 이름 대신 '(지운 사용자)'. */
export function baeCostTable(r: BaeUsageTeam): BaeCostTable {
  const people = new Map<string, { userId: string; name: string; cells: Map<string, { m: number; n: number }>; m: number; n: number }>();
  const periods = new Map<string, { m: number; n: number }>(r.periods.map((p) => [p, { m: 0, n: 0 }]));
  const kinds = new Map<string, { m: number; n: number }>();
  let tm = 0; let tn = 0;
  for (const x of r.rows) {
    const m = usdMicros(x.usd);
    const p = people.get(x.userId) ?? { userId: x.userId, name: x.userName || '(지운 사용자)', cells: new Map(), m: 0, n: 0 };
    const c = p.cells.get(x.period) ?? { m: 0, n: 0 };
    c.m += m; c.n += x.n; p.cells.set(x.period, c); p.m += m; p.n += x.n; people.set(x.userId, p);
    const pc = periods.get(x.period) ?? { m: 0, n: 0 }; pc.m += m; pc.n += x.n; periods.set(x.period, pc);
    const k = kinds.get(x.kind) ?? { m: 0, n: 0 }; k.m += m; k.n += x.n; kinds.set(x.kind, k);
    tm += m; tn += x.n;
  }
  const ledgerM = usdMicros(r.total.usd);
  return {
    periods: [...periods.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, v]) => ({ key, label: baeCostPeriodLabel(key, r.bucket), usd: fromMicros(v.m), n: v.n })),
    people: [...people.values()].sort((a, b) => b.m - a.m || a.name.localeCompare(b.name, 'ko'))
      .map((p) => ({ userId: p.userId, name: p.name, usd: fromMicros(p.m), n: p.n, cells: Object.fromEntries([...p.cells.entries()].map(([k, v]) => [k, { usd: fromMicros(v.m), n: v.n }])) })),
    kinds: [...kinds.entries()].sort(([a], [b]) => kindRank(a) - kindRank(b) || a.localeCompare(b))
      .map(([kind, v]) => ({ kind, label: BAE_USAGE_KIND_LABEL[kind] ?? kind, usd: fromMicros(v.m), n: v.n })),
    total: { usd: fromMicros(tm), n: tn },
    check: { tableUsd: fromMicros(tm), ledgerUsd: fromMicros(ledgerM), tableN: tn, ledgerN: r.total.n, same: tm === ledgerM && tn === r.total.n },
  };
}

/** CSV 칸 하나: 쉼표 · 따옴표 · 줄바꿈이 있으면 따옴표로 싸고, 수식으로 읽힐 글(= + - @ 로 시작)은 앞에 ' 를 붙인다. */
function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const BUCKET_NAME: Record<BaeCostBucket, string> = { day: '일', week: '주', month: '달' };
/**
 * 팀 비용 CSV (엑셀에서 한글이 깨지지 않게 BOM 을 붙인다). 장부를 묶은 줄 그대로: 기간 시작 · 사람 · 종류 · 모델 · 호출 수 · 달러 · 원,
 * 마지막에 합계 한 줄. 원은 설정의 환율로 셈한다.
 */
export function baeUsageCsv(r: BaeUsageTeam, krwPerUsd: number): string {
  const rate = Number.isFinite(krwPerUsd) && krwPerUsd > 0 ? krwPerUsd : 1400;
  const rows = [...r.rows].sort((a, b) => (a.period !== b.period ? (a.period < b.period ? -1 : 1) : (a.userName || a.userId).localeCompare(b.userName || b.userId, 'ko') || a.kind.localeCompare(b.kind) || a.model.localeCompare(b.model)));
  const lines = [[`기간 시작(${BUCKET_NAME[r.bucket]})`, '사람', '종류', '모델', '호출 수', '달러', '원'].map(csvCell).join(',')];
  let m = 0; let n = 0;
  for (const x of rows) {
    const xm = usdMicros(x.usd); m += xm; n += x.n;
    lines.push([x.period, x.userName || '(지운 사용자)', BAE_USAGE_KIND_LABEL[x.kind] ?? x.kind, x.model, x.n, fromMicros(xm).toFixed(6), Math.round(fromMicros(xm) * rate)].map(csvCell).join(','));
  }
  lines.push(['합계', '', '', '', n, fromMicros(m).toFixed(6), Math.round(fromMicros(m) * rate)].map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
/** CSV 파일 이름의 처음 값: 'BAE경_비용_2026-11-01_2026-11-16.csv' (한국 시각 날짜). */
export function baeUsageCsvName(r: Pick<BaeUsageTeam, 'from' | 'to'>): string {
  const day = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 10) : ''; };
  const a = day(r.from); const b = day(new Date(Date.parse(r.to) - 1).toISOString());
  return a && b ? `BAE경_비용_${a}_${b}.csv` : 'BAE경_비용.csv';
}

// ── 기간 (이 PC 의 시각으로 셈: 팀 PC 는 한국 시각) ──
export type BaeTeamPeriod = 'today' | 'week' | 'month' | 'all';
export const BAE_TEAM_PERIOD_LABEL: Record<BaeTeamPeriod, string> = { today: '오늘', week: '이번 주', month: '이번 달', all: '전체' };
/** 팀 기록 기간의 시작 (주는 월요일부터). 전체는 null. */
export function baeTeamPeriodFrom(p: BaeTeamPeriod, now: Date): string | null {
  if (p === 'all') return null;
  const d = new Date(now.getFullYear(), now.getMonth(), p === 'month' ? 1 : now.getDate());
  if (p === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}
export type BaeCostRange = 'this-month' | 'last-month' | 'three-months' | 'this-year';
export const BAE_COST_RANGE_LABEL: Record<BaeCostRange, string> = { 'this-month': '이번 달', 'last-month': '지난 달', 'three-months': '최근 3개월', 'this-year': '올해' };
/** 비용 표의 범위. to 가 null 이면 지금까지. */
export function baeCostRangeDates(r: BaeCostRange, now: Date): { from: string; to: string | null } {
  const y = now.getFullYear(); const m = now.getMonth();
  if (r === 'last-month') return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
  if (r === 'three-months') return { from: new Date(y, m - 2, 1).toISOString(), to: null };
  if (r === 'this-year') return { from: new Date(y, 0, 1).toISOString(), to: null };
  return { from: new Date(y, m, 1).toISOString(), to: null };
}
/** 범위마다 쓸 수 있는 기간 단위 (서버의 길이 한도: 일 93일 · 주 371일). '올해'를 일 단위로는 보지 않는다. */
export function baeCostBucketsFor(r: BaeCostRange): BaeCostBucket[] {
  return r === 'this-year' ? ['week', 'month'] : ['day', 'week', 'month'];
}
