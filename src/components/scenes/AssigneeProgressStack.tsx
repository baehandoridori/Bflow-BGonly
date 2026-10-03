import { useRef, type CSSProperties, type ReactNode } from 'react';
import { CheckCircle2, CheckSquare, ChevronDown, ChevronUp, Clock, MessageSquareWarning, PlayCircle } from 'lucide-react';
import type { Department, Scene, ScenePhaseState, Stage } from '@/types';
import { DEPARTMENT_CONFIGS, SCENE_PHASES, SCENE_PHASE_COLORS, SCENE_PHASE_LABELS_SHORT, STAGES } from '@/types';
import { cn } from '@/utils/cn';
import { RollingNumber } from '@/components/ui/RollingNumber';
import { getAssigneeProgressEntries, sceneStateFromScene, type AssigneeProgressEntry } from '@/utils/assigneeProgress';
import { useStageFillSteps } from './useStageFillSteps';
import { StageRollbackFlash, useStageSaveStatus } from './StageSaveStatus';
import { assigneeCellId, phaseCellId } from './stageSaveFeedback';
import { useMotionArmed } from '@/hooks/useMotionArmed';
import type { StageRollbackFlash as StageRollbackFlashState } from '@/stores/useStageSaveStatusStore';

interface AssigneeProgressStackProps {
  scene: Scene;
  department: Department;
  compact?: boolean;
  onAssigneeStageToggle?: (assigneeName: string, stage: Stage) => void;
  onAssigneePhaseStateClick?: (assigneeName: string, state: ScenePhaseState) => void;
  onAssigneeFeedbackRequest?: (assigneeName: string) => void;
  onAssigneeRoundBump?: (assigneeName: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
}

const PHASE_ICON_BY_STATE: Record<ScenePhaseState, ReactNode> = {
  wait: <Clock size={13} strokeWidth={2.4} />,
  work: <PlayCircle size={13} strokeWidth={2.4} />,
  feedback: <MessageSquareWarning size={13} strokeWidth={2.4} />,
  done: <CheckCircle2 size={13} strokeWidth={2.4} />,
};

const STAGE_ICON_BY_STAGE: Record<Stage, ReactNode> = {
  lo: <Clock size={13} strokeWidth={2.4} />,
  done: <PlayCircle size={13} strokeWidth={2.4} />,
  review: <CheckSquare size={13} strokeWidth={2.4} />,
  png: <CheckCircle2 size={13} strokeWidth={2.4} />,
};

/**
 * 담당자 한 명의 LO/완료/검수/PNG 버튼. 켜진 칸은 단계 색으로 차오르고(scaleX),
 * 앞 단계까지 한꺼번에 바뀌면 LO→PNG(켤 때)·PNG→LO(끌 때) 순서로 이어진다(움직임 폴리싱 6번).
 * 순서 기억(useStageFillSteps)이 담당자마다 따로 있어야 해서 컴포넌트로 뺐다.
 */
function AssigneeStageControls({
  name,
  progress,
  department,
  compact,
  onToggle,
  pending,
  rollback,
}: {
  name: string;
  progress: AssigneeProgressEntry['progress'];
  department: Department;
  compact: boolean;
  onToggle: (stage: Stage) => void;
  pending: ReadonlySet<string>;
  rollback: StageRollbackFlashState | undefined;
}) {
  const cfg = DEPARTMENT_CONFIGS[department];
  const fillSteps = useStageFillSteps(STAGES.map((stage) => progress[stage] === true));
  // 꺼진 칸 채움은 켜질 때만 상자가 생긴다 — 차오름은 한 번 그려진 묶음에서만(처음부터 켜진 칸은 바로 그린다).
  const armRef = useRef<HTMLDivElement>(null);
  useMotionArmed(armRef);

  return (
    <div
      ref={armRef}
      className={cn(
        'grid min-w-0 grid-cols-4 rounded-md bg-bg-card/70 p-0.5',
        compact ? 'gap-0.5' : 'gap-1 border border-bg-border/35 p-1',
      )}
      data-assignee-progress-controls
    >
      {STAGES.map((stage, i) => {
        const active = progress[stage] === true;
        const label = cfg.stageLabels[stage];
        const cellId = assigneeCellId(name, stage);
        const savePending = pending.has(cellId);
        return (
          <button
            type="button"
            key={stage}
            data-on={active}
            data-stage-key={cellId}
            data-save-pending={savePending || undefined}
            aria-busy={savePending || undefined}
            className={cn(
              'stage-seg [--stage-seg-hover-alpha:0.35] min-w-0 inline-flex items-center justify-center rounded font-semibold leading-none',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              compact ? 'h-6 px-0' : 'h-9 gap-1 px-1 text-[11px]',
              !active && 'text-text-secondary/65 hover:text-text-primary',
            )}
            style={{
              '--stage-step': fillSteps[i] ?? 0,
              ...(active ? { color: '#0F1117' } : null),
            } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(stage);
            }}
            aria-label={`${name} ${label}`}
            title={`${name} ${label}`}
          >
            {/* 담당자별 칸은 '현재 단계' 구분 없이 켜진 칸이 모두 진한 단계 색. */}
            <span
              aria-hidden="true"
              className="stage-seg-fill [--stage-seg-dim:1]"
              data-on={active}
              data-glow={active && !compact}
              style={{
                '--stage-seg-color': cfg.stageColors[stage],
                '--stage-seg-glow': `${cfg.stageColors[stage]}35`,
              } as CSSProperties}
            />
            {rollback?.cells.includes(cellId) && <StageRollbackFlash key={rollback.at} />}
            <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
              {STAGE_ICON_BY_STAGE[stage]}
            </span>
            {compact ? null : <span className="whitespace-nowrap leading-none">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function AssigneeProgressStack({
  scene,
  department,
  compact = false,
  onAssigneeStageToggle,
  onAssigneePhaseStateClick,
  onAssigneeFeedbackRequest,
  onAssigneeRoundBump,
}: AssigneeProgressStackProps) {
  // 20번: 저장이 실패해 다시 보내는 중인 버튼(점선·흐림)과 끝내 되돌린 버튼(도리도리·빨간 테두리). 훅이라 일찍 돌아가기 전에.
  const { pending, rollback } = useStageSaveStatus(scene.id);
  const entries = getAssigneeProgressEntries(scene);
  if (entries.length <= 1) return null;

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-bg-border/45 bg-bg-primary/45',
        compact ? 'gap-1 p-1' : 'gap-2 p-2',
      )}
      data-assignee-progress-stack
    >
      {entries.map((entry) => {
        const activeState = entry.progress.sceneState ?? sceneStateFromScene(scene);
        const roundBadge =
          department === 'acting' && activeState === 'work' ? (
            <div
              className={cn(
                'stage-round-pop inline-flex max-w-full shrink-0 items-center gap-1 overflow-hidden rounded-full bg-blue-400/15 font-bold leading-none text-blue-300 whitespace-nowrap',
                compact ? 'h-3.5 min-w-[3.25rem] justify-center px-1 text-[9px]' : 'px-2 py-0.5 text-[11px]',
              )}
              data-assignee-progress-round
              title={`${entry.progress.workRound || 1}차`}
            >
              <span className="shrink-0 whitespace-nowrap tabular-nums leading-none">{entry.progress.workRound || 1}차</span>
              {onAssigneeRoundBump && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-black/15">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center justify-center rounded-full hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-30',
                      compact ? 'h-3.5 w-3.5' : 'h-5 w-5',
                    )}
                    disabled={(entry.progress.workRound || 1) <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssigneeRoundBump(entry.name, 'work', -1);
                    }}
                    aria-label={`${entry.name} 작업 차수 감소`}
                    title={`${entry.name} 작업 차수 감소`}
                  >
                    <ChevronDown size={compact ? 9 : 11} strokeWidth={2.6} />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center justify-center rounded-full hover:bg-black/20',
                      compact ? 'h-3.5 w-3.5' : 'h-5 w-5',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssigneeRoundBump(entry.name, 'work', 1);
                    }}
                    aria-label={`${entry.name} 작업 차수 증가`}
                    title={`${entry.name} 작업 차수 증가`}
                  >
                    <ChevronUp size={compact ? 9 : 11} strokeWidth={2.6} />
                  </button>
                </span>
              )}
            </div>
          ) : null;

        const activeIndex = SCENE_PHASES.indexOf(activeState);
        const activePending = pending.has(assigneeCellId(entry.name, phaseCellId(activeState)));
        const controls =
          department === 'acting' ? (
            <div
              className={cn(
                'relative grid min-w-0 grid-cols-4 rounded-md bg-bg-card/70 p-0.5',
                compact ? 'gap-0.5' : 'gap-1 border border-bg-border/35 p-1',
              )}
              data-assignee-progress-controls
            >
              {/* 움직임 폴리싱 6번: 색 알약 하나가 고른 버튼 자리로 미끄러진다(ScenePhaseToggle 과 같은 방식). */}
              {activeIndex >= 0 && (
                <span
                  aria-hidden="true"
                  className="stage-seg-pill rounded"
                  data-save-pending={activePending || undefined}
                  style={{
                    '--stage-pill-index': activeIndex,
                    '--stage-pill-count': SCENE_PHASES.length,
                    '--stage-pill-pad': compact ? '2px' : '4px',
                    '--stage-pill-gap': compact ? '2px' : '4px',
                  } as CSSProperties}
                >
                  {SCENE_PHASES.map((state) => (
                    <span
                      key={state}
                      className="stage-seg-pill-layer"
                      data-on={activeState === state}
                      data-glow={!compact}
                      style={{
                        '--stage-seg-color': SCENE_PHASE_COLORS[state],
                        '--stage-seg-glow': `${SCENE_PHASE_COLORS[state]}35`,
                      } as CSSProperties}
                    />
                  ))}
                </span>
              )}
              {SCENE_PHASES.map((state) => {
                const active = activeState === state;
                const label = SCENE_PHASE_LABELS_SHORT[state];
                const cellId = assigneeCellId(entry.name, phaseCellId(state));
                const savePending = pending.has(cellId);
                return (
                  <button
                    type="button"
                    key={state}
                    data-on={active}
                    data-stage-key={cellId}
                    data-save-pending={savePending || undefined}
                    aria-busy={savePending || undefined}
                    className={cn(
                      'stage-seg [--stage-seg-hover-alpha:0.35] min-w-0 inline-flex items-center justify-center rounded font-semibold leading-none',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                      compact ? 'h-6 px-0' : 'h-9 gap-1 px-1 text-[11px]',
                      !active && 'text-text-secondary/65 hover:text-text-primary',
                    )}
                    style={
                      active
                        ? { color: state === 'wait' ? '#fff' : '#0F1117' }
                        : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (active) return;
                      if (department === 'acting' && state === 'feedback' && onAssigneeFeedbackRequest) {
                        onAssigneeFeedbackRequest(entry.name);
                        return;
                      }
                      onAssigneePhaseStateClick?.(entry.name, state);
                    }}
                    aria-label={`${entry.name} ${label}`}
                    title={`${entry.name} ${label}`}
                  >
                    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
                      {PHASE_ICON_BY_STATE[state]}
                    </span>
                    {compact ? null : <span className="whitespace-nowrap leading-none">{label}</span>}
                    {rollback?.cells.includes(cellId) && <StageRollbackFlash key={rollback.at} />}
                  </button>
                );
              })}
            </div>
          ) : (
            <AssigneeStageControls
              name={entry.name}
              progress={entry.progress}
              department={department}
              compact={compact}
              onToggle={(stage) => onAssigneeStageToggle?.(entry.name, stage)}
              pending={pending}
              rollback={rollback}
            />
          );

        if (!compact) {
          return (
            <div
              key={entry.name}
              className="rounded-md border border-bg-border/35 bg-bg-card/45 p-2"
              data-assignee-progress-name={entry.name}
            >
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text-primary">{entry.name}</div>
                </div>
                <div className="inline-flex shrink-0 items-center gap-1.5">
                  {roundBadge}
                  <div className="rounded-full bg-bg-primary/70 px-2 py-0.5 text-xs font-bold tabular-nums text-text-primary">
                    <RollingNumber value={Math.round(entry.pct)} suffix="%" countUp={false} />
                  </div>
                </div>
              </div>
              {controls}
            </div>
          );
        }

        return (
          <div
            key={entry.name}
            className="grid min-w-0 grid-cols-[minmax(56px,76px)_minmax(84px,1fr)_2.25rem] items-center gap-1.5"
            data-assignee-progress-name={entry.name}
          >
            {/* 이름(12px) + 차수 배지(14px) + 간격(2px) = 버튼 줄 높이(28px) — '작업중'을 눌러도 줄이 늘어나지 않는다(움직임 폴리싱 6번). */}
            <div className="flex min-w-0 flex-col items-start gap-0.5 overflow-hidden">
              <div className="truncate text-[10px] leading-3 font-semibold text-text-primary">
                {entry.name}
              </div>
              {roundBadge}
            </div>

            {controls}

            <div className="text-right text-[10px] font-bold tabular-nums text-text-secondary">
              <RollingNumber value={Math.round(entry.pct)} suffix="%" countUp={false} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
