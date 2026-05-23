/**
 * 컴포지팅 단계 라벨 / 색 토큰 / 오류 사유 라벨 매핑 유틸.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
 * 결정 기록 (브레인스토밍 2026-05-21):
 *   - 내부 코드 키 (`batch | combine | aggregated | adjust | error | done`) 는 그대로
 *   - 사용자 노출 라벨만 한솔님 팀 용어로 다듬음 (취합중 / 취합 완료 / ...)
 */

import type { CompositingStatus, CompositingErrorKind } from '../types';

/** 단계 → 사용자 표시 라벨 */
export const COMPOSITING_STATUS_LABEL: Record<CompositingStatus, string> = {
  batch:      '배치',
  combine:    '취합중',
  aggregated: '취합 완료',
  adjust:     '보정 중',
  error:      '오류',
  done:       '완료',
};

/** 단계 → CSS 변수 토큰 (src/index.css 의 --status-*) */
export const COMPOSITING_STATUS_TOKEN: Record<CompositingStatus, string> = {
  batch:      '--status-batch',
  combine:    '--status-combine',
  aggregated: '--status-aggregated',
  adjust:     '--status-adjust',
  error:      '--status-error',
  done:       '--status-done',
};

/** 단계 → Tailwind 색 키 (bg-status-batch 등) */
export const COMPOSITING_STATUS_TAILWIND_KEY: Record<CompositingStatus, string> = {
  batch:      'status-batch',
  combine:    'status-combine',
  aggregated: 'status-aggregated',
  adjust:     'status-adjust',
  error:      'status-error',
  done:       'status-done',
};

/** 단계 표시 순서 (UI 헤더 / 모달 그리드용. 전이 룰은 자유) */
export const COMPOSITING_STATUS_ORDER: CompositingStatus[] = [
  'batch', 'combine', 'aggregated', 'adjust', 'error', 'done',
];

/** 오류 세부 사유 → 사용자 표시 라벨 */
export const COMPOSITING_ERROR_LABEL: Record<CompositingErrorKind, string> = {
  missing_file:   '파일 미싱',
  fix_blemish:    '옥에티 수정',
  retake:         '리테이크',
  canceled_scene: '취소된 씬',
  other:          '기타',
};

/** 오류 사유 표시 순서 */
export const COMPOSITING_ERROR_ORDER: CompositingErrorKind[] = [
  'missing_file', 'fix_blemish', 'retake', 'canceled_scene', 'other',
];

/** 라이트 모드와 다크 모드 양쪽에서 단계 색을 CSS var() 로 가져오는 헬퍼 */
export function statusCssColor(status: CompositingStatus): string {
  return `var(${COMPOSITING_STATUS_TOKEN[status]})`;
}

/**
 * 한솔 정의 (2026-05-22): "완료된 부분" = done + aggregated.
 *   취합 완료(aggregated) 는 완료 계열의 한 단계로 간주 — 진행률 / RAM 라인 표시에 모두 포함.
 */
export function isCompletedStatus(status: CompositingStatus | undefined | null): boolean {
  return status === 'done' || status === 'aggregated';
}

/**
 * 컴포지팅 대시보드에서 단계 변경 권한을 가진 사용자 판정.
 *
 * 한솔 정정 (2026-05-21): 배한솔은 언제나 컴포지터 + admin.
 *   → user.isCompositor === true 외에도 다음 경우 true:
 *      - user.role === 'admin' (관리자는 자동 권한)
 *      - user.name === '배한솔' (오너 — 데이터 누락 시에도 항상 권한)
 */
import type { AppUser } from '@/types';
export function isCompositorForCompositing(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isCompositor === true) return true;
  if (user.role === 'admin') return true;
  if (user.name === '배한솔') return true;
  return false;
}

/** 파트 (A~G) → 색 토큰. 그 외는 액센트 폴백. */
export function partCssColor(partId: string): string {
  const key = partId.toLowerCase();
  if (key === 'a' || key === 'b' || key === 'c' || key === 'd'
      || key === 'e' || key === 'f' || key === 'g') {
    return `var(--part-${key})`;
  }
  // H 이상 — 액센트 폴백.
  // 코덱스 9차 P2: --color-accent 는 RGB triplet ("108 92 231") 이라 var() 만 쓰면 invalid CSS color.
  //   color/border/color-mix() 슬롯에 직접 쓸 수 있도록 rgb() wrapping 한 완성된 color 값을 반환.
  return 'rgb(var(--color-accent))';
}
