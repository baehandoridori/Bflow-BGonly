/**
 * 씬 단계 진행 정보 (SceneRow/SceneCard 공유) 순수 함수.
 *
 * - doneCount: 체크된 단계 수 = "n/4"의 n. statsUtils의 checkedStageCount와 동일 산식 —
 *   비연속/구멍 데이터(예: lo+png만 체크)에도 안전하고, 비개발자에겐 '4칸 중 켜진 칸 수'로 직관적.
 * - currentStageKey: 강조할 '현재 단계' 칩 = 마지막 연속 체크 단계(기존 isCurrent 규칙
 *   `checked && (마지막이거나 다음이 미체크)`와 동일). 비연속이면 가장 뒤쪽 것을 현재로 본다.
 *
 * ⚠️ 타입만 import(`import type`) — node:test(type-strip)에서 `@/` alias 없이 실행되게,
 *   STAGE 순서는 값으로 가져오지 않고 로컬 하드코딩(statsUtils/quickAddUtils 선례와 동일).
 */
import type { Stage } from '@/types';

const STAGE_ORDER: Stage[] = ['lo', 'done', 'review', 'png'];

export interface StageInfo {
  /** 체크된 단계 수 (n/4의 n) */
  doneCount: number;
  /** 항상 4 */
  total: number;
  /** 강조할 현재 단계(마지막 연속 체크). 전무면 null */
  currentStageKey: Stage | null;
}

export function currentStageInfo(scene: Record<Stage, boolean>): StageInfo {
  const flags = STAGE_ORDER.map((k) => !!scene[k]);
  const doneCount = flags.reduce((n, on) => n + (on ? 1 : 0), 0);

  let currentStageKey: Stage | null = null;
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    // 체크됐고 (마지막이거나 다음 단계가 미체크) → '현재' 후보. 마지막 후보를 채택(비연속 대비).
    if (flags[i] && (i === STAGE_ORDER.length - 1 || !flags[i + 1])) {
      currentStageKey = STAGE_ORDER[i];
    }
  }

  return { doneCount, total: STAGE_ORDER.length, currentStageKey };
}
