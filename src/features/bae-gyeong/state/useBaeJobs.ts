/**
 * 내 작업 기록 목록. 처음 한 번 최근 것을 받고, 그 뒤로는 'jobs' 신호가 올 때만 '바뀐 것만' 받는다 (커서 = 가진 것 중 가장 늦은
 * updated_at 에서 2분 겹침). 고정 간격으로 다시 받지 않는다 (Bflow 2026-10 사고 뒤의 규칙). 서버 줄 수가 줄면(관리자가 지움) 그때만 전부.
 */
import { create } from 'zustand';
import { baeJobCursor, mergeBaeJobs, type BaeJob } from '@/shared/bae/jobs';
import { baeGw } from '../useBaeStore';

interface BaeJobsState {
  rows: BaeJob[];
  total: number;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** 이 PC 에서 방금 만든 것 (서버에 아직 안 올라간 것 포함) — 서버 줄이 오면 그것으로 바뀐다. */
  local: Record<string, BaeJob>;
  /** 한 건 보기용 (PD 글 포함). 목록은 가볍게 받고, 열 때만 이것을 받는다. */
  details: Record<string, BaeJob>;
  loadDetail(jobId: string, updatedAt: string): Promise<void>;
  load(force?: boolean): Promise<void>;
  putLocal(job: BaeJob): void;
  hide(jobId: string, hidden: boolean): Promise<void>;
  reset(): void;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
let inflight: Promise<void> | null = null; let again = false; let gen = 0;

export const useBaeJobs = create<BaeJobsState>((set, get) => ({
  rows: [], total: 0, loaded: false, loading: false, error: null, local: {}, details: {},
  reset: () => { gen++; inflight = null; again = false; set({ rows: [], total: 0, loaded: false, loading: false, error: null, local: {}, details: {} }); },
  loadDetail: async (jobId, updatedAt) => {
    const have = get().details[jobId]; if (have && have.updatedAt >= updatedAt) return;
    try { const j = await baeGw().jobGet(jobId); set((s) => ({ details: { ...s.details, [jobId]: j } })); } catch { /* 목록 모양으로 보여 준다 */ }
  },
  putLocal: (job) => set((s) => ({ local: { ...s.local, [job.id]: job } })),
  load: async (force = false) => {
    if (inflight) { again = true; return inflight; }
    const my = gen;
    const run = async () => {
      set({ loading: true });
      try {
        const g = baeGw();
        let rows = force ? [] : get().rows;
        let cursor = force || !get().loaded ? null : baeJobCursor(rows);
        let total = get().total;
        for (let page = 0; page < 20; page++) {
          const got = await g.jobsMine(cursor, 100);
          if (my !== gen) return;
          rows = mergeBaeJobs(rows, got.rows); total = got.total;
          if (cursor === null || !got.more) break;
          cursor = baeJobCursor(got.rows);
        }
        // 서버 줄이 내가 가진 것보다 적으면 지워진 줄이 있다: 한 번 전부 다시 (드문 일)
        if (!force && get().loaded && total < rows.length) {
          const fresh = await g.jobsMine(null, 300); if (my !== gen) return;
          rows = mergeBaeJobs([], fresh.rows); total = fresh.total;
        }
        const local = { ...get().local };
        for (const r of rows) delete local[r.id];
        set({ rows, total, loaded: true, loading: false, error: null, local });
      } catch (e) { if (my === gen) set({ loading: false, error: message(e) }); }
    };
    inflight = run().finally(() => { inflight = null; if (again && my === gen) { again = false; void get().load(); } });
    return inflight;
  },
  hide: async (jobId, hidden) => {
    const before = get().rows;
    set({ rows: before.map((r) => (r.id === jobId ? { ...r, hidden } : r)) });   // 낙관적
    try { const j = await baeGw().jobHide(jobId, hidden); set((s) => ({ rows: mergeBaeJobs(s.rows, [j]) })); }
    catch (e) { set({ rows: before, error: message(e) }); throw e; }
  },
}));

/** 화면에 보일 목록: 이 PC 에서 방금 만든 것 + 서버 것, 숨긴 것은 뺌. */
export function visibleBaeJobs(s: Pick<BaeJobsState, 'rows' | 'local'>): BaeJob[] {
  return mergeBaeJobs(s.rows, Object.values(s.local)).filter((j) => !j.hidden);
}
