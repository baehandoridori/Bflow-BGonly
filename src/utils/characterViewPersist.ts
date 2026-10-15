/**
 * 캐릭터 현황판 보기 방식 영속화 (피드백 40) — scenesViewPersist 와 동일 패턴.
 * localStorage 단일 키. 단일 사용자 PC 환경이라 사용자별 분리 불필요.
 * try/catch 로 localStorage 비활성 환경(테스트·개인정보보호 모드) 무시.
 * 주의: node --test 가 직접 import 한다 — '@/' alias import 금지.
 */

import type { CharacterSortState } from './characterBoardSort.ts';

const KEY = 'bflow_character_board_view_mode';

export type CharacterBoardViewMode = 'card' | 'compact' | 'list';

export function loadPersistedCharacterViewMode(): CharacterBoardViewMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'card' || v === 'compact' || v === 'list' ? v : null;
  } catch {
    return null;
  }
}

export function savePersistedCharacterViewMode(mode: CharacterBoardViewMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
}

const TAGS_FOLDED_KEY = 'bflow_character_tags_folded';

/** 태그 필터 칩 행 접힘 상태 (정식 공개 라운드). */
export function loadPersistedTagsFolded(): boolean | null {
  try {
    const v = localStorage.getItem(TAGS_FOLDED_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function savePersistedTagsFolded(folded: boolean): void {
  try { localStorage.setItem(TAGS_FOLDED_KEY, folded ? '1' : '0'); } catch { /* ignore */ }
}

const RAIL_COLLAPSED_KEY = 'bflow_character_rail_collapsed';

/** 그룹 레일 접힘 상태 (정식 공개 라운드 — 확정 시안 A). */
export function loadPersistedRailCollapsed(): boolean | null {
  try {
    const v = localStorage.getItem(RAIL_COLLAPSED_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function savePersistedRailCollapsed(collapsed: boolean): void {
  try { localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
}

const GROUP_FOLDED_KEY = 'bflow_character_group_folded';

/** 커스텀 탭 그룹 섹션 접힘 키 목록 (피드백 52). 키 형식: `${tabId}:${groupId | '__ungrouped__'}`. */
export function loadPersistedGroupFolded(): string[] {
  try {
    const raw = localStorage.getItem(GROUP_FOLDED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function savePersistedGroupFolded(keys: string[]): void {
  try { localStorage.setItem(GROUP_FOLDED_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
}

const SORT_KEY = 'bflow_character_board_sort';

/**
 * 현황판 정렬 기준 + 뒤집기. 값: 'manual' | 'created' | 'modified' (뒤집으면 '-reversed' 접미).
 * 직접 정한 순서에는 뒤집기가 없다 — 'manual-reversed' 는 알 수 없는 값으로 버린다.
 */
export function loadPersistedCharacterSort(): CharacterSortState | null {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === 'manual') return { mode: 'manual', reversed: false };
    if (v === 'created' || v === 'modified') return { mode: v, reversed: false };
    if (v === 'created-reversed') return { mode: 'created', reversed: true };
    if (v === 'modified-reversed') return { mode: 'modified', reversed: true };
    return null;
  } catch {
    return null;
  }
}

export function savePersistedCharacterSort(sort: CharacterSortState): void {
  const value = sort.mode !== 'manual' && sort.reversed ? `${sort.mode}-reversed` : sort.mode;
  try { localStorage.setItem(SORT_KEY, value); } catch { /* ignore */ }
}
