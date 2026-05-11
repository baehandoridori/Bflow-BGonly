/**
 * v1.25.0~ 액팅 씬 단계 토글 (대기/작업중/피드백 대기/완료 + 차수).
 *
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 4)
 * mockup: docs/mockups/2026-05-11-acting-toggle-q1-interaction.html (옵션 A)
 *
 * v1.25.3 (한솔 보고 fix): 한솔이 카드/상세 모달에서 "피드백 대기" 5자가 좁은 컨테이너에서
 *  글자가 세로로 wrap 되는 문제를 보고. 다음으로 보정:
 *   1) 칩 라벨을 SCENE_PHASE_LABELS_SHORT 로 단축 (피드백 대기 → 피드백)
 *   2) 컨테이너 `flex w-full` + 칩 `flex-1` 로 기존 액팅 4-stage 토글과 동일한 균등 분할
 *   3) 칩 라벨 + 차수 모두 whitespace-nowrap 으로 wrap 방지
 *   4) 활성 칩 차수 카운터는 "▼ N ▲" 만 (차자 생략) — 좁은 칩 안에서도 보이도록
 *
 * - 한 시점에 1개만 활성 (라디오)
 * - 활성 칩이 '작업중' 또는 '피드백 대기' 일 때만 칩 안쪽에 차수 카운터
 * - "피드백 대기" 칩 클릭은 onRequestFeedback 로 위임 (호출자가 확인 모달 표시)
 * - chip 은 <div role="radio"> — RoundCounter 의 +/- <button> 중첩 button 회피 (코덱스 3차 P2)
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback } from 'react';
import type { Scene, ScenePhaseState } from '@/types';
import { SCENE_PHASES, SCENE_PHASE_LABELS_SHORT, SCENE_PHASE_COLORS } from '@/types';
import { cn } from '@/utils/cn';

export interface ScenePhaseToggleProps {
  scene: Scene;
  /** 칩 클릭 시 호출. 'feedback' 인 경우 onRequestFeedback 가 별도로 호출됨 */
  onStateClick: (next: ScenePhaseState) => void;
  /** 피드백 대기 칩 클릭 시 호출 (확인 모달 트리거) */
  onRequestFeedback: () => void;
  /** 차수 ▴▾ 클릭. kind = 'work' 또는 'feedback', delta = +1 또는 -1 */
  onRoundBump: (kind: 'work' | 'feedback', delta: 1 | -1) => void;
  /** 비활성/저장 중 표시용 */
  disabled?: boolean;
  /** 컴팩트 모드 (시트 셀 안에서 사용 시) */
  compact?: boolean;
}

export function ScenePhaseToggle({
  scene,
  onStateClick,
  onRequestFeedback,
  onRoundBump,
  disabled = false,
  compact = false,
}: ScenePhaseToggleProps) {
  const activeState: ScenePhaseState = scene.sceneState ?? 'wait';

  const handleChipClick = useCallback(
    (target: ScenePhaseState) => {
      if (disabled) return;
      // 코덱스 4차 P2 #9 fix: same-state no-op 체크가 feedback 분기보다 먼저
      if (target === activeState) return;
      if (target === 'feedback') {
        onRequestFeedback();
        return;
      }
      onStateClick(target);
    },
    [activeState, disabled, onRequestFeedback, onStateClick],
  );

  return (
    <div
      className={cn(
        'flex w-full rounded-lg bg-bg-primary/70 border border-bg-border/40',
        compact ? 'p-0.5 gap-0.5' : 'p-1 gap-0.5',
      )}
      role="radiogroup"
      aria-label="액팅 씬 단계"
    >
      {SCENE_PHASES.map((state) => {
        const isActive = activeState === state;
        const showRound = isActive && (state === 'work' || state === 'feedback');
        const round = state === 'work' ? (scene.workRound ?? 1) : (scene.feedbackRound ?? 1);
        return (
          <div
            key={state}
            role="radio"
            aria-checked={isActive}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onClick={() => handleChipClick(state)}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                handleChipClick(state);
              }
            }}
            className={cn(
              'flex-1 min-w-0 inline-flex items-center justify-center gap-1 rounded-md font-medium select-none whitespace-nowrap',
              'transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              compact ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-2 text-[11px]',
              !isActive && 'text-text-secondary/70 hover:text-text-primary hover:bg-bg-border/25 cursor-pointer',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
            style={
              isActive
                ? {
                    backgroundColor: SCENE_PHASE_COLORS[state],
                    color: state === 'wait' ? '#fff' : '#0F1117',
                    fontWeight: 700,
                    boxShadow: `0 2px 8px ${SCENE_PHASE_COLORS[state]}40`,
                  }
                : undefined
            }
          >
            <span className="truncate">{SCENE_PHASE_LABELS_SHORT[state]}</span>
            {showRound && (
              <RoundCounter
                value={round}
                onBump={(delta) => onRoundBump(state as 'work' | 'feedback', delta)}
                disabled={disabled}
                compact={compact}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RoundCounterProps {
  value: number;
  onBump: (delta: 1 | -1) => void;
  disabled?: boolean;
  compact?: boolean;
}

function RoundCounter({ value, onBump, disabled, compact }: RoundCounterProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-black/15 flex-shrink-0',
        compact ? 'gap-0' : 'gap-0',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="차수 감소"
        disabled={disabled || value <= 1}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled && value > 1) onBump(-1);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full hover:bg-black/15',
          compact ? 'w-3 h-3' : 'w-3.5 h-3.5',
          (disabled || value <= 1) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronDown size={compact ? 8 : 9} strokeWidth={2.5} />
      </button>
      <span
        className={cn(
          'font-bold tabular-nums px-0.5',
          compact ? 'text-[9px]' : 'text-[10px]',
        )}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label="차수 증가"
        disabled={disabled || value >= 99}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled && value < 99) onBump(1);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full hover:bg-black/15',
          compact ? 'w-3 h-3' : 'w-3.5 h-3.5',
          (disabled || value >= 99) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronUp size={compact ? 8 : 9} strokeWidth={2.5} />
      </button>
    </span>
  );
}
