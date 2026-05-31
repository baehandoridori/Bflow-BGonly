/**
 * v1.25.0~ 액팅 씬 단계 토글 (대기/작업중/피드백 대기/완료).
 *
 * v1.25.7 (한솔 결정 — 시안 B + 피드백 차수 숨김):
 *  - 칩은 라벨만, 균등 분할(flex-1). 폭이 줄어들어도 글자 잘림 X.
 *  - 활성이 '작업중' 일 때만 칩 위 우측에 작은 박스로 "작업중 N차 ▾▴" 표시.
 *  - 피드백 대기/대기/완료 일 때는 차수 영역 자체가 사라짐 (한솔: "피드백 대기는 숫자 없이 OK").
 *  - 데이터(work_round/feedback_round)는 보존되어 상태 전이 시 자동 +1 룰은 그대로.
 *
 * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 4)
 * mockup: docs/mockups/2026-05-12-phase-chip-layout-fix.html
 *
 * - chip 은 <div role="radio"> — RoundCounter 의 +/- <button> 중첩 button 회피 (코덱스 3차 P2)
 */

import { CheckCircle2, ChevronDown, ChevronUp, Clock, MessageSquareWarning, PlayCircle } from 'lucide-react';
import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Scene, ScenePhaseState } from '@/types';
import { SCENE_PHASES, SCENE_PHASE_LABELS_SHORT, SCENE_PHASE_COLORS } from '@/types';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { cn } from '@/utils/cn';

export interface ScenePhaseToggleProps {
  scene: Scene;
  /** 칩 클릭 시 호출. 'feedback' 인 경우 onRequestFeedback 가 별도로 호출됨 */
  onStateClick: (next: ScenePhaseState) => void;
  /** 피드백 대기 칩 클릭 시 호출 (확인 모달 트리거) */
  onRequestFeedback: () => void;
  /** 차수 ▴▾ 클릭. 작업중일 때만 노출되므로 kind 는 'work' 만 사용 */
  onRoundBump: (kind: 'work' | 'feedback', delta: 1 | -1) => void;
  /** 비활성/저장 중 표시용 */
  disabled?: boolean;
  /** 컴팩트 모드 (시트 셀 안에서 사용 시) */
  compact?: boolean;
}

const PHASE_ICON_BY_STATE: Record<ScenePhaseState, ReactNode> = {
  wait: <Clock size={12} strokeWidth={2.4} />,
  work: <PlayCircle size={12} strokeWidth={2.4} />,
  feedback: <MessageSquareWarning size={12} strokeWidth={2.4} />,
  done: <CheckCircle2 size={12} strokeWidth={2.4} />,
};

export function ScenePhaseToggle({
  scene,
  onStateClick,
  onRequestFeedback,
  onRoundBump,
  disabled = false,
  compact = false,
}: ScenePhaseToggleProps) {
  const activeState: ScenePhaseState = scene.sceneState ?? 'wait';
  // v1.25.7: 작업중일 때만 차수 헤더 노출. 피드백/대기/완료는 차수 숨김.
  const showWorkRound = activeState === 'work';
  const workRound = scene.workRound ?? 1;
  // v1.27.0: BG 카드와 동일한 "진행한 이전 단계 옅게 채움" 패턴. 현재 phase 의 앞 단계는
  // 자기 색의 알파(0x20 ≈ 0.125) 로 살짝 채워 시각 진행도 표현.
  const activeIndex = SCENE_PHASES.indexOf(activeState);
  const pointerHandledRef = useRef(false);

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

  const handleChipPointerDown = useCallback(
    (event: ReactPointerEvent, target: ScenePhaseState) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointerHandledRef.current = true;
      handleChipClick(target);
      window.setTimeout(() => {
        pointerHandledRef.current = false;
      }, 600);
    },
    [handleChipClick],
  );

  return (
    <div className="w-full flex flex-col gap-1.5">
      {/* v1.25.7: 작업중 활성 시 차수 헤더. 우측 정렬 작은 박스. */}
      {showWorkRound && (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full font-bold tabular-nums',
              compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]',
            )}
            style={{
              background: `${SCENE_PHASE_COLORS.work}26`,
              color: SCENE_PHASE_COLORS.work,
            }}
          >
            작업중
            <RoundCounter
              value={workRound}
              onBump={(delta) => onRoundBump('work', delta)}
              disabled={disabled}
              compact={compact}
            />
            차
          </span>
        </div>
      )}

      {/* 칩 4개 — 라벨만, 균등 분할 */}
      <div
        className={cn(
          'flex w-full rounded-lg bg-bg-primary/70 border border-bg-border/40',
          compact ? 'p-0.5 gap-0.5' : 'p-1 gap-0.5',
        )}
        role="radiogroup"
        aria-label="액팅 씬 단계"
      >
        {SCENE_PHASES.map((state, i) => {
          const isActive = activeState === state;
          // v1.27.0: 현재 phase 보다 앞선 단계 = 이미 거쳐온 단계. BG 카드 트랙처럼 옅게 채움.
          const isPrevious = !isActive && activeIndex > 0 && i < activeIndex;
          return (
            <div
              key={state}
              data-continuity-stage-segment
              role="radio"
              aria-checked={isActive}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : 0}
              onPointerDown={(e) => handleChipPointerDown(e, state)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (pointerHandledRef.current) {
                  pointerHandledRef.current = false;
                  return;
                }
                handleChipClick(state);
              }}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleChipClick(state);
                }
              }}
              className={cn(
                'compact-label-container flex-1 min-w-0 inline-flex items-center justify-center rounded-md font-medium select-none',
                'transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                compact ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-2 text-[11px]',
                // 비활성 + 진행 전 단계 → 기본 회색 톤 + hover.
                !isActive && !isPrevious && 'text-text-secondary/70 hover:text-text-primary hover:bg-bg-border/25 cursor-pointer',
                // 비활성 + 이미 거쳐온 단계 → 자기 색 옅게. hover 시 살짝 밝게.
                !isActive && isPrevious && 'cursor-pointer hover:brightness-110',
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
                  : isPrevious
                    ? {
                        // BG 트랙의 isDone && !isCurrent 와 동일한 톤 (color + '20' = alpha ~0.125).
                        backgroundColor: `${SCENE_PHASE_COLORS[state]}20`,
                        color: SCENE_PHASE_COLORS[state],
                      }
                    : undefined
              }
            >
              <CompactIconLabel
                icon={PHASE_ICON_BY_STATE[state]}
                label={SCENE_PHASE_LABELS_SHORT[state]}
                className="w-full"
                textClassName="truncate"
              />
            </div>
          );
        })}
      </div>
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
        'inline-flex items-center rounded-full bg-black/15',
        compact ? '' : '',
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
          compact ? 'w-3 h-3' : 'w-4 h-4',
          (disabled || value <= 1) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronDown size={compact ? 8 : 10} strokeWidth={2.5} />
      </button>
      <span
        className={cn(
          'font-bold tabular-nums px-0.5',
          compact ? 'text-[9px]' : 'text-[11px]',
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
          compact ? 'w-3 h-3' : 'w-4 h-4',
          (disabled || value >= 99) && 'opacity-30 cursor-not-allowed',
        )}
      >
        <ChevronUp size={compact ? 8 : 10} strokeWidth={2.5} />
      </button>
    </span>
  );
}
