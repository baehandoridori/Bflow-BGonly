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

/** 파트 (A·B·C·D) → 색 토큰 */
export function partCssColor(partId: string): string {
  const key = partId.toLowerCase();
  if (key === 'a' || key === 'b' || key === 'c' || key === 'd') {
    return `var(--part-${key})`;
  }
  // 알 수 없는 파트 (E, F, ...) — 액센트 폴백
  return 'var(--color-accent)';
}
