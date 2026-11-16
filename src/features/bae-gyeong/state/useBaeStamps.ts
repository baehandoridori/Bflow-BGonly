/**
 * 내 작업에 온 새 확인 도장 (좋아요 · 다시): 사이드바 景 아이콘의 숫자와 내 기록의 '새 도장' 표시 (계획 14 6-2, 8단계).
 * 사이드바가 쓰므로 가볍게: 앱에서는 preload 통로를 바로 쓰고, 테스트 모드에서만 통로 모듈을 늦게 불러온다.
 * 숫자는 'jobs' 신호(누가 도장을 찍으면 서버가 보낸다)와 'stamps'(이 PC 의 다른 창에서 봤다)가 올 때만 다시 읽는다 — 고정 간격으로 묻지 않는다.
 * 확인함은 조용하다 (숫자 없이 기록에만 보인다). 내 기록을 열면 본 것으로 적는다.
 */
import { create } from 'zustand';
import type { BaeGateway } from '../types';

interface BaeStampsState {
  userId: string | null;
  count: number;
  /** 서버가 준 '어디까지' (본 것으로 적을 때 그대로 돌려준다) */
  upto: number;
  /** 아직 보지 않은 새 도장이 찍힌 내 작업 */
  ids: string[];
  /** 이번에 내 기록에서 본 새 도장 — 이 화면을 떠날 때까지 줄에 '새 도장'으로 남긴다 */
  fresh: string[];
  start(userId: string | null): void;
  refresh(): Promise<void>;
  markSeen(): Promise<void>;
  clearFresh(): void;
}

async function gateway(): Promise<BaeGateway> {
  if (typeof window !== 'undefined' && window.baeGyeongAPI) return window.baeGyeongAPI;
  return (await import('../gateway')).baeGateway();
}

let off: (() => void) | null = null; let gen = 0; let timer: ReturnType<typeof setTimeout> | null = null; let seeing = false;

export const useBaeStamps = create<BaeStampsState>((set, get) => ({
  userId: null, count: 0, upto: 0, ids: [], fresh: [],
  start: (userId) => {
    if (get().userId === userId && (off || !userId)) return;
    const my = ++gen; off?.(); off = null; if (timer) clearTimeout(timer); timer = null;
    set({ userId, count: 0, upto: 0, ids: [], fresh: [] });
    if (!userId) return;
    void gateway().then((g) => {
      if (my !== gen) return;
      // 도장이 찍히면 서버는 'jobs' 신호를 보낸다. 한꺼번에 여러 신호가 와도 한 번만 묻는다.
      off = g.onChanged((what) => {
        if (what !== 'jobs' && what !== 'stamps') return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void get().refresh(); }, 1200);
      });
      void get().refresh();
    }).catch(() => undefined);
  },
  refresh: async () => {
    const my = gen; const userId = get().userId; if (!userId || seeing) return;
    try {
      const u = await (await gateway()).stampUnseen();
      if (my === gen) set({ count: u.count, upto: u.upto, ids: u.jobIds });
    } catch { /* 숫자를 못 받으면 숫자 없이 둔다 (BAE경을 쓸 수 없는 계정 · 서버 준비 전) */ }
  },
  markSeen: async () => {
    const my = gen; if (!get().userId || seeing) return;
    seeing = true;
    const before = { count: get().count, ids: get().ids };
    try {
      const g = await gateway();
      const u = await g.stampUnseen();
      if (my !== gen) return;
      set((s) => ({ fresh: [...new Set([...s.fresh, ...u.jobIds])], count: 0, ids: [] }));   // 낙관적: 숫자를 먼저 지운다
      if (u.count === 0) return;   // 새 것이 없으면 적을 것도 없다 (확인함은 숫자를 만들지 않는다)
      const after = await g.stampSeen(u.upto);
      if (my === gen) set({ count: after.count, upto: after.upto, ids: after.jobIds });
    } catch {
      if (my === gen) set({ count: before.count, ids: before.ids });   // 되돌림: 서버에 '봤다'를 못 적었다
    } finally { seeing = false; }
  },
  clearFresh: () => set({ fresh: [] }),
}));
