/**
 * BAE경 '이 PC 점검' (계획 14 9-4, 14b 10-5 '팀원 설정에 남음 + 결과가 관리자에게 보임', HTML pcCheck() 4936줄).
 *   점검하기: 화면이 WebGPU 를 재고 메인이 그래픽카드 · 모델 · 공간 · 창고 · OpenAI 를 모은다 → 줄과 한 줄 정리.
 *   끝나면 저절로 서버 표에 내 줄을 올린다 (못 올려도 점검 결과는 그대로 — 조용히 안내만).
 *   관리자 · 검수자: 팀 표를 읽는다. 'pc-checks' 신호(내용 없음)가 오면 다시 읽고, 내가 올린 줄은 받은 줄로 바로 바꾼다.
 * 결과는 이 상태에 남아서 탭을 오가도 그대로 (앱을 다시 켜면 다시 점검).
 */
import { create } from 'zustand';
import type { BaePcCheck, BaePcCheckRow } from '@/shared/bae/pcCheck';
import { baeModels, baeRunPcCheck } from '../modelAccess';
import { mergePcCheckRow } from '../settings/pcCheckView';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface PcCheckState {
  running: boolean;
  result: BaePcCheck | null;
  error: string | null;
  /** 서버 표에 올리기: idle → sending → ok | failed */
  upload: 'idle' | 'sending' | 'ok' | 'failed';
  uploadError: string | null;
  run(): Promise<void>;
  // ── 관리자 · 검수자: 팀 표 ──
  team: BaePcCheckRow[];
  teamLoaded: boolean;
  teamLoading: boolean;
  teamError: string | null;
  loadTeam(): Promise<void>;
  reset(): void;
}

let teamSeq = 0;
export const useBaePcCheck = create<PcCheckState>((set, get) => ({
  running: false, result: null, error: null, upload: 'idle', uploadError: null,
  team: [], teamLoaded: false, teamLoading: false, teamError: null,

  run: async () => {
    if (get().running) return;
    set({ running: true, error: null });
    let r: BaePcCheck;
    try { r = await baeRunPcCheck(); }
    catch (e) { set({ running: false, error: msg(e) }); return; }
    set({ running: false, result: r, upload: 'sending', uploadError: null });
    // 서버 표에 내 줄 (계획 14 9-4 '점검 결과 한 줄을 서버에'): 실패해도 점검 결과는 그대로 보인다
    try {
      const row = await baeModels().pcCheckPut();
      set((s) => ({ upload: 'ok', team: s.teamLoaded ? mergePcCheckRow(s.team, row) : s.team }));
    } catch (e) { set({ upload: 'failed', uploadError: msg(e) }); }
  },

  loadTeam: async () => {
    const seq = ++teamSeq;
    set({ teamLoading: true });
    try {
      const rows = await baeModels().pcCheckList();
      if (seq === teamSeq) set({ team: rows, teamLoaded: true, teamLoading: false, teamError: null });
    } catch (e) { if (seq === teamSeq) set({ teamLoading: false, teamError: msg(e) }); }
  },

  reset: () => { teamSeq++; set({ running: false, result: null, error: null, upload: 'idle', uploadError: null, team: [], teamLoaded: false, teamLoading: false, teamError: null }); },
}));
