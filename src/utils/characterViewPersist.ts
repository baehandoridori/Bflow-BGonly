/**
 * 캐릭터 현황판 보기 방식 영속화 (피드백 40) — scenesViewPersist 와 동일 패턴.
 * localStorage 단일 키. 단일 사용자 PC 환경이라 사용자별 분리 불필요.
 * try/catch 로 localStorage 비활성 환경(테스트·개인정보보호 모드) 무시.
 * 주의: node --test 가 직접 import 한다 — '@/' alias import 금지.
 */

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
