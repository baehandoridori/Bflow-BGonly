/**
 * 사이드바 nav 항목의 사용자별 표시 규칙 (순수 로직 — React 비의존, 테스트 가능).
 *
 * 현재 규칙: '휴가' 탭을 특정 사용자에게 숨긴다.
 *   - 대상 변경 시 VACATION_HIDDEN_NAMES 배열만 수정하면 된다.
 *   - 식별은 이름 기준. 이 앱의 휴가 도메인이 원래 사용자 이름을 실질 식별자로 쓰므로 관례와 일치한다.
 */

import type { ViewMode } from '@/stores/useAppStore';

/** 휴가 탭을 숨길 사용자 이름 목록. 대상 변경 시 이 배열만 수정한다. */
export const VACATION_HIDDEN_NAMES = ['강선영'];

/**
 * 현재 사용자 이름 기준으로 해당 nav 항목을 숨겨야 하는지 판정한다.
 * userName 이 비어있으면(로그인 정보 없음) 숨기지 않는다 (fail-open — 기본은 노출).
 *
 * id 는 ViewMode 로 좁혀 둔다: 'vacation' 탭 id 가 바뀌면 아래 비교가 컴파일 에러로 잡혀
 * 숨김이 조용히 동작을 멈추는 것을 막는다.
 */
export function isNavItemHiddenForUser(id: ViewMode, userName: string | null | undefined): boolean {
  if (id === 'vacation') return VACATION_HIDDEN_NAMES.includes(userName ?? '');
  return false;
}
