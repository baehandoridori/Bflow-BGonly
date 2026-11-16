/**
 * 팀 기록 (검수자, 계획 14 6-1). 거르기(사람 · 기간 · 종류 · 도장 없음 · 찾기)는 서버가 하고, 쪽마다 60건씩 받는다.
 * 그 뒤로는 'jobs' 신호가 올 때만 팀 전체의 '바뀐 것만' 받아 보이는 목록에 끼워 넣는다 (mergeBaeTeamRows) — 고정 간격으로 다시 받지 않는다.
 * 도장은 화면에 먼저 찍고 서버에 보낸 뒤, 실패하면 되돌린다 (Bflow 낙관적 업데이트).
 */
import { create } from 'zustand';
import { mergeBaeTeamRows, type BaeJob, type BaeJobKind, type BaeTeamCursor, type BaeTeamFilter } from '@/shared/bae/jobs';
import { baeTeamPeriodFrom, type BaeStamp, type BaeStampEvent, type BaeTeamPeriod } from '@/shared/bae/review';
import { baeGw } from '../useBaeStore';

export interface BaeTeamUiFilter { userId: string | null; period: BaeTeamPeriod; kind: BaeJobKind | null; unstamped: boolean; q: string }
export const BAE_TEAM_FILTER_START: BaeTeamUiFilter = { userId: null, period: 'all', kind: null, unstamped: false, q: '' };
export const BAE_TEAM_PAGE = 60;

/** 화면의 거르기 → 서버 거르기 (기간은 이 PC 의 시각으로 시작을 셈). */
export function baeTeamServerFilter(f: BaeTeamUiFilter, now = new Date()): BaeTeamFilter {
  const out: BaeTeamFilter = {};
  if (f.userId) out.userId = f.userId;
  const from = baeTeamPeriodFrom(f.period, now); if (from) out.from = from;
  if (f.kind) out.kind = f.kind;
  if (f.unstamped) out.unstamped = true;
  if (f.q.trim()) out.q = f.q.trim().slice(0, 100);
  return out;
}

interface BaeTeamState {
  filter: BaeTeamUiFilter;
  rows: BaeJob[];
  more: boolean;
  next: BaeTeamCursor | null;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** 여러 건 '확인함'으로 고른 기록 */
  picked: string[];
  /** 한 건 보기 (PD 글 포함) · 도장 차례 */
  details: Record<string, BaeJob>;
  history: Record<string, BaeStampEvent[]>;
  stamping: Record<string, boolean>;
  bulkBusy: boolean;
  setFilter(patch: Partial<BaeTeamUiFilter>): void;
  load(): Promise<void>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  toggle(id: string): void;
  pickAll(ids: string[], on: boolean): void;
  stamp(job: BaeJob, stamp: BaeStamp | null, note: string | null, actorId: string): Promise<BaeJob>;
  stampBulk(actorId: string): Promise<{ stamped: number; skipped: number }>;
  loadDetail(jobId: string, updatedAt: string): Promise<void>;
  loadHistory(jobId: string): Promise<void>;
  /** 내 기록 쪽에서 도장을 찍었을 때 (같은 작업이 팀 목록에 있으면 맞춘다) */
  put(job: BaeJob): void;
  reset(): void;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
let gen = 0; let since: string | null = null; let qTimer: ReturnType<typeof setTimeout> | null = null; let refreshing: Promise<void> | null = null; let again = false;
const START = { rows: [] as BaeJob[], more: false, next: null, loaded: false, loading: false, loadingMore: false, error: null, picked: [] as string[], details: {}, history: {}, stamping: {}, bulkBusy: false };
const finishedJob = (j: BaeJob) => j.status === 'done' || j.status === 'failed' || j.status === 'stopped';
/** 여러 건 '확인함'으로 고를 수 있는 기록: 끝났고 도장이 아직 없는 것 (서버도 나머지는 그대로 둔다). */
export const baeTeamPickable = (j: BaeJob) => finishedJob(j) && j.stamp === null;

export const useBaeTeam = create<BaeTeamState>((set, get) => ({
  filter: BAE_TEAM_FILTER_START, ...START,
  reset: () => { gen++; since = null; if (qTimer) clearTimeout(qTimer); qTimer = null; set({ filter: BAE_TEAM_FILTER_START, ...START }); },
  setFilter: (patch) => {
    set((s) => ({ filter: { ...s.filter, ...patch }, picked: [] }));
    if (qTimer) clearTimeout(qTimer);
    // 찾는 말은 치는 동안 묻지 않고 잠깐 멈췄을 때 한 번
    if ('q' in patch && Object.keys(patch).length === 1) qTimer = setTimeout(() => { qTimer = null; void get().load(); }, 350);
    else void get().load();
  },
  load: async () => {
    const my = ++gen;
    set({ loading: true, error: null });
    try {
      const page = await baeGw().jobsTeamFind(baeTeamServerFilter(get().filter), null, BAE_TEAM_PAGE);
      if (my !== gen) return;
      since = page.serverTime || since;
      set({ rows: page.rows, more: page.more, next: page.next, loaded: true, loading: false, error: null });
    } catch (e) { if (my === gen) set({ loading: false, error: message(e) }); }
  },
  loadMore: async () => {
    const { next, loadingMore } = get(); if (!next || loadingMore) return;
    const my = gen; set({ loadingMore: true });
    try {
      const page = await baeGw().jobsTeamFind(baeTeamServerFilter(get().filter), next, BAE_TEAM_PAGE);
      if (my !== gen) return;
      set((s) => ({ rows: [...s.rows, ...page.rows.filter((r) => !s.rows.some((x) => x.id === r.id))], more: page.more, next: page.next, loadingMore: false }));
    } catch (e) { if (my === gen) set({ loadingMore: false, error: message(e) }); }
  },
  refresh: async () => {
    if (!get().loaded) return get().load();
    if (refreshing) { again = true; return refreshing; }
    const my = gen;
    const run = async () => {
      try {
        const g = baeGw(); const filter = baeTeamServerFilter(get().filter);
        // 팀 전체의 '바뀐 것만' (2분 겹침) — 몇 쪽까지만, 그 뒤는 다음 신호에
        let cursor = since ? new Date(Date.parse(since) - 120_000).toISOString() : null;
        for (let i = 0; i < 5 && cursor; i++) {
          const got = await g.jobsTeam(cursor, 100);
          if (my !== gen) return;
          set((s) => ({ rows: mergeBaeTeamRows(s.rows, got.rows, filter, !s.more), details: dropStale(s.details, got.rows) }));
          since = got.serverTime || since;
          if (!got.more || !got.rows.length) break;
          cursor = got.rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), cursor);
        }
        if (!since) await get().load();
      } catch { /* 다음 신호에 다시 */ }
    };
    refreshing = run().finally(() => { refreshing = null; if (again && my === gen) { again = false; void get().refresh(); } });
    return refreshing;
  },
  toggle: (id) => set((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : [...s.picked, id] })),
  pickAll: (ids, on) => set((s) => ({ picked: on ? [...new Set([...s.picked, ...ids])] : s.picked.filter((x) => !ids.includes(x)) })),
  put: (job) => set((s) => ({ rows: s.rows.some((r) => r.id === job.id) ? mergeBaeTeamRows(s.rows, [job], baeTeamServerFilter(s.filter), true) : s.rows, details: job.pd ? { ...s.details, [job.id]: job } : s.details })),
  stamp: async (job, stamp, note, actorId) => {
    const before = { rows: get().rows, details: get().details };
    const at = new Date().toISOString();
    const local: BaeJob = { ...(get().details[job.id] ?? job), stamp, stampAt: stamp ? at : null, stampBy: stamp ? actorId : null, stampNote: stamp ? note : null };
    set((s) => ({ stamping: { ...s.stamping, [job.id]: true }, rows: s.rows.map((r) => (r.id === job.id ? { ...r, stamp, stampAt: local.stampAt } : r)), details: { ...s.details, [job.id]: local } }));
    try {
      const saved = await baeGw().jobStamp(job.id, stamp, note);
      set((s) => ({ rows: s.rows.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)), details: { ...s.details, [saved.id]: saved }, stamping: { ...s.stamping, [job.id]: false } }));
      void get().loadHistory(job.id);
      return saved;
    } catch (e) {
      set((s) => ({ rows: before.rows, details: before.details, stamping: { ...s.stamping, [job.id]: false } }));   // 되돌림
      throw e;
    }
  },
  stampBulk: async (actorId) => {
    const ids = get().picked.filter((id) => { const r = get().rows.find((x) => x.id === id); return !!r && baeTeamPickable(r); });
    if (!ids.length || get().bulkBusy) return { stamped: 0, skipped: 0 };
    const before = get().rows; const at = new Date().toISOString();
    set((s) => ({ bulkBusy: true, rows: s.rows.map((r) => (ids.includes(r.id) ? { ...r, stamp: 'seen' as const, stampAt: at, stampBy: actorId, stampNote: null } : r)) }));
    try {
      const r = await baeGw().jobStampBulk(ids);
      set({ bulkBusy: false, picked: [] });
      void get().refresh();   // 서버가 정한 그대로 맞춘다 ('도장 없음'이면 빠진다)
      return { stamped: r.stamped.length, skipped: r.skipped };
    } catch (e) { set({ rows: before, bulkBusy: false }); throw e; }
  },
  loadDetail: async (jobId, updatedAt) => {
    const have = get().details[jobId]; if (have && have.updatedAt >= updatedAt && have.pd) return;
    try { const j = await baeGw().jobGet(jobId); set((s) => ({ details: { ...s.details, [jobId]: j } })); } catch { /* 목록 모양으로 보여 준다 */ }
  },
  loadHistory: async (jobId) => {
    try { const h = await baeGw().jobStamps(jobId); set((s) => ({ history: { ...s.history, [jobId]: h } })); } catch { /* 차례 없이 보여 준다 */ }
  },
}));

/** 바뀐 줄의 한 건 보기는 다음에 열 때 다시 받는다. */
function dropStale(details: Record<string, BaeJob>, changed: BaeJob[]): Record<string, BaeJob> {
  let out = details;
  for (const c of changed) { const d = out[c.id]; if (d && d.updatedAt < c.updatedAt) { out = { ...out }; delete out[c.id]; } }
  return out;
}
