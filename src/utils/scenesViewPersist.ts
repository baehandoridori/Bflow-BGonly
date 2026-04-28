/**
 * 씬 뷰 마지막 상태 영속화 — 사용자가 떠났다가 돌아와도 직전에 보던 상태로 복원.
 *
 * 저장 항목 (모두 localStorage 단일 키):
 * - 뷰 모드 ('card' | 'sheet')
 * - 마지막 본 에피소드 번호
 * - 트리 펼침 여부
 *
 * 단일 사용자 PC 환경이라 사용자별 분리 불필요. try/catch 로 localStorage 비활성 환경(개인정보보호 모드 등) 무시.
 */

const KEYS = {
  viewMode: 'bflow_scenes_view_mode',
  lastEpisode: 'bflow_scenes_last_episode',
  treeOpen: 'bflow_scenes_tree_open',
} as const;

export type SceneViewMode = 'card' | 'sheet';

export function loadPersistedSceneViewMode(): SceneViewMode | null {
  try {
    const v = localStorage.getItem(KEYS.viewMode);
    return v === 'card' || v === 'sheet' ? v : null;
  } catch {
    return null;
  }
}

export function savePersistedSceneViewMode(mode: SceneViewMode): void {
  try { localStorage.setItem(KEYS.viewMode, mode); } catch { /* ignore */ }
}

export function loadPersistedLastEpisode(): number | null {
  try {
    const raw = localStorage.getItem(KEYS.lastEpisode);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function savePersistedLastEpisode(ep: number | null): void {
  try {
    if (ep === null) localStorage.removeItem(KEYS.lastEpisode);
    else localStorage.setItem(KEYS.lastEpisode, String(ep));
  } catch { /* ignore */ }
}

export function loadPersistedTreeOpen(): boolean | null {
  try {
    const v = localStorage.getItem(KEYS.treeOpen);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch {
    return null;
  }
}

export function savePersistedTreeOpen(open: boolean): void {
  try { localStorage.setItem(KEYS.treeOpen, open ? '1' : '0'); } catch { /* ignore */ }
}
