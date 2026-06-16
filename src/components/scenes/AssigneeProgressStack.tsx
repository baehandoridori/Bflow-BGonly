import type { ReactNode } from 'react';
import { CheckCircle2, CheckSquare, ChevronDown, ChevronUp, Clock, MessageSquareWarning, PlayCircle } from 'lucide-react';
import type { Department, Scene, ScenePhaseState, Stage } from '@/types';
import { DEPARTMENT_CONFIGS, SCENE_PHASES, SCENE_PHASE_COLORS, SCENE_PHASE_LABELS_SHORT, STAGES } from '@/types';
import { cn } from '@/utils/cn';
import { getAssigneeProgressEntries, sceneStateFromScene } from '@/utils/assigneeProgress';

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

export function AssigneeProgressStack({
  scene,
  department,
  compact = false,
  onAssigneeStageToggle,
  onAssigneePhaseStateClick,
  onAssigneeFeedbackRequest,
  onAssigneeRoundBump,
}: AssigneeProgressStackProps) {
  const entries = getAssigneeProgressEntries(scene);
  if (entries.length <= 1) return null;
  const cfg = DEPARTMENT_CONFIGS[department];

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
                'inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-400/15 font-bold text-blue-300',
                compact ? 'px-1 text-[9px]' : 'px-2 py-0.5 text-[11px]',
              )}
              data-assignee-progress-round
            >
              <span className="tabular-nums">{entry.progress.workRound || 1}차</span>
              {onAssigneeRoundBump && (
                <span className="inline-flex items-center rounded-full bg-black/15">
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center justify-center rounded-full hover:bg-black/20 disabled:cursor-not-allowed disabled:opacity-30',
                      compact ? 'h-4 w-4' : 'h-5 w-5',
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
                      compact ? 'h-4 w-4' : 'h-5 w-5',
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

        const controls =
          department === 'acting' ? (
            <div
              className={cn(
                'grid min-w-0 grid-cols-4 rounded-md bg-bg-card/70 p-0.5',
                compact ? 'gap-0.5' : 'gap-1 border border-bg-border/35 p-1',
              )}
              data-assignee-progress-controls
            >
              {SCENE_PHASES.map((state) => {
                const active = activeState === state;
                const label = SCENE_PHASE_LABELS_SHORT[state];
                return (
                  <button
                    type="button"
                    key={state}
                    className={cn(
                      'min-w-0 inline-flex items-center justify-center rounded font-semibold leading-none transition-all',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                      compact ? 'h-6 px-0' : 'h-9 gap-1 px-1 text-[11px]',
                      !active && 'text-text-secondary/65 hover:bg-bg-border/35 hover:text-text-primary',
                    )}
                    style={
                      active
                        ? {
                            backgroundColor: SCENE_PHASE_COLORS[state],
                            color: state === 'wait' ? '#fff' : '#0F1117',
                            boxShadow: compact ? undefined : `0 2px 8px ${SCENE_PHASE_COLORS[state]}35`,
                          }
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
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className={cn(
                'grid min-w-0 grid-cols-4 rounded-md bg-bg-card/70 p-0.5',
                compact ? 'gap-0.5' : 'gap-1 border border-bg-border/35 p-1',
              )}
              data-assignee-progress-controls
            >
              {STAGES.map((stage) => {
                const active = entry.progress[stage] === true;
                const label = cfg.stageLabels[stage];
                return (
                  <button
                    type="button"
                    key={stage}
                    className={cn(
                      'min-w-0 inline-flex items-center justify-center rounded font-semibold leading-none transition-all',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                      compact ? 'h-6 px-0' : 'h-9 gap-1 px-1 text-[11px]',
                      !active && 'text-text-secondary/65 hover:bg-bg-border/35 hover:text-text-primary',
                    )}
                    style={
                      active
                        ? {
                            backgroundColor: cfg.stageColors[stage],
                            color: '#0F1117',
                            boxShadow: compact ? undefined : `0 2px 8px ${cfg.stageColors[stage]}35`,
                          }
                        : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssigneeStageToggle?.(entry.name, stage);
                    }}
                    aria-label={`${entry.name} ${label}`}
                    title={`${entry.name} ${label}`}
                  >
                    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
                      {STAGE_ICON_BY_STAGE[stage]}
                    </span>
                    {compact ? null : <span className="whitespace-nowrap leading-none">{label}</span>}
                  </button>
                );
              })}
            </div>
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
                    {Math.round(entry.pct)}%
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
            className="grid min-w-0 grid-cols-[minmax(48px,72px)_minmax(88px,1fr)_2.25rem] items-center gap-1.5"
            data-assignee-progress-name={entry.name}
          >
            <div className="min-w-0">
              <div className="truncate text-[10px] font-semibold text-text-primary">
                {entry.name}
              </div>
              {roundBadge}
            </div>

            {controls}

            <div className="text-right text-[10px] font-bold tabular-nums text-text-secondary">
              {Math.round(entry.pct)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}
