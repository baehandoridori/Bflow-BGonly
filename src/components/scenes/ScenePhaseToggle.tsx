/**
 * v1.25.0~ — 액팅 씬 단계 토글 (대기/작업중/피드백 대기/완료 + 차수).
 *
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 4)
 * mockup: docs/mockups/2026-05-11-acting-toggle-q1-interaction.html (옵션 A)
 *
 * - 4개 칩이 한 줄. 한 시점에 1개만 활성 (라디오)
 * - 활성 칩이 '작업중' 또는 '피드백 대기' 일 때만 칩 안쪽에 차수 ▴▾
 * - "피드백 대기" 칩 클릭은 onRequestFeedback 로 위임 (호출자가 확인 모달 표시)
 * - 다른 칩 클릭은 onStateClick 로 위임 (호출자가 상태 변경 + supabase 동기화)
 *
 * BG 분기는 아직 적용하지 않음 (이번 PR 액팅 전용). BG 합류 시 부모에서 분기.
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback } from 'react';
import type { Scene, ScenePhaseState } from '@/types';
import { SCENE_PHASES, SCENE_PHASE_LABELS, SCENE_PHASE_COLORS } from '@/types';
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
      if (target === 'feedback') {
        onRequestFeedback();
        return;
      }
      if (target === activeState) return; // no-op
      onStateClick(target);
    },
    [activeState, disabled, onRequestFeedback, onStateClick],
  );

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1',
        compact ? 'gap-0.5' : 'gap-1',
      )}
      role="radiogroup"
      aria-label="액팅 씬 단계"
    >
      {SCENE_PHASES.map((state) => {
        const isActive = activeState === state;
        const showRound = isActive && (state === 'work' || state === 'feedback');
        const round = state === 'work' ? (scene.workRound ?? 1) : (scene.feedbackRound ?? 1);
        return (
          <button
            key={state}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => handleChipClick(state)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border font-semibold',
              'transition-colors transition-shadow',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              compact
                ? 'px-1.5 py-0.5 text-[10px]'
                : 'px-2.5 py-1 text-[11px]',
              isActive
                ? 'border-transparent text-bg-primary'
                : 'border-bg-border/60 bg-bg-primary/30 text-text-secondary/80 hover:bg-bg-primary/50 hover:text-text-primary',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
            style={
              isActive
                ? {
                    backgroundColor: SCENE_PHASE_COLORS[state],
                    color: state === 'wait' ? '#fff' : '#0F1117',
                  }
                : undefined
            }
          >
            <span>{SCENE_PHASE_LABELS[state]}</span>
            {showRound && (
              <RoundCounter
                value={round}
                onBump={(delta) => onRoundBump(state as 'work' | 'feedback', delta)}
                disabled={disabled}
                compact={compact}
              />
            )}
          </button>
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
        'inline-flex items-center rounded-full bg-bg-primary/35',
        compact ? 'ml-0.5' : 'ml-1',
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
          'inline-flex items-center justify-center rounded-full hover:bg-bg-primary/40',
          compact ? 'w-3.5 h-3.5' : 'w-4 h-4',
          (disabled || value <= 1) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronDown size={compact ? 9 : 10} strokeWidth={2.5} />
      </button>
      <span
        className={cn(
          'font-bold tabular-nums',
          compact ? 'text-[9.5px] px-0.5' : 'text-[10.5px] px-1',
        )}
      >
        {value}차
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
          'inline-flex items-center justify-center rounded-full hover:bg-bg-primary/40',
          compact ? 'w-3.5 h-3.5' : 'w-4 h-4',
          (disabled || value >= 99) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronUp size={compact ? 9 : 10} strokeWidth={2.5} />
      </button>
    </span>
  );
}
