/**
 * BAE경 화면의 상태: 서버가 정한 권리, 설정 책장, 키 상태. 신호('settings' · 'members')가 오면 다시 읽는다.
 * 고정 간격으로 전부 다시 받지 않는다 (Bflow 10월 사고 뒤의 규칙).
 */
import { create } from 'zustand';
import { BAE_NO_ACCESS, type BaeAccess } from '@/shared/bae/access';
import type { BaeKeyStatus } from '@/shared/bae/secrets';
import type { BaeSettingKey, BaeSettingRow } from '@/shared/bae/settings';
import { baeGateway } from './gateway';
import type { BaeGateway } from './types';

export type BaeTab = 'bench' | 'records' | 'costs' | 'settings';

interface BaeState {
  actorId: string | null;
  access: BaeAccess;
  rows: BaeSettingRow[];
  defaults: { manual: string | null; fixed: string | null };
  keyStatus: BaeKeyStatus | null;
  loading: boolean;
  error: string | null;
  tab: BaeTab;
  setTab(tab: BaeTab): void;
  start(actorId: string | null, gateway?: BaeGateway): Promise<void>;
  refresh(): Promise<void>;
  row(key: BaeSettingKey): BaeSettingRow | undefined;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
let gw: BaeGateway | null = null; let unsubscribe: (() => void) | null = null; let generation = 0;

export const useBaeStore = create<BaeState>((set, get) => ({
  actorId: null, access: BAE_NO_ACCESS, rows: [], defaults: { manual: null, fixed: null }, keyStatus: null, loading: false, error: null, tab: 'bench',
  setTab: (tab) => set({ tab }),
  row: (key) => get().rows.find((r) => r.key === key),
  start: async (actorId, supplied) => {
    if (get().actorId === actorId && gw) return;
    const gen = ++generation; unsubscribe?.(); unsubscribe = null; gw = null;
    set({ actorId, access: BAE_NO_ACCESS, rows: [], keyStatus: null, loading: !!actorId, error: null });
    if (!actorId) return;
    try {
      gw = supplied ?? baeGateway();
      unsubscribe = gw.onChanged((what) => { if (gen === generation && (what === 'settings' || what === 'members')) void get().refresh(); });
      await get().refresh();
    } catch (e) { if (gen === generation) set({ loading: false, error: message(e) }); }
  },
  refresh: async () => {
    const g = gw; const gen = generation; if (!g) return;
    try {
      const view = await g.settings();
      const keyStatus = view.access.canUse ? await g.keyStatus().catch(() => null) : null;
      if (gen !== generation) return;
      set({ access: view.access, rows: view.rows, defaults: view.defaults, keyStatus, loading: false, error: null });
    } catch (e) { if (gen === generation) set({ loading: false, error: message(e) }); }
  },
}));

/** 화면 컴포넌트가 직접 저장할 때 쓰는 통로 (같은 것을 돌려준다). */
export function baeGw(): BaeGateway { if (!gw) gw = baeGateway(); return gw; }
