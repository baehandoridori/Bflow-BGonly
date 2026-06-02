import { useRef } from 'react';
import { CheckCircle2, CheckSquare, Clock, PlayCircle } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { Department, Scene, Stage } from '@/types';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { cn } from '@/utils/cn';
import { useStageLabelDisplayMode } from './useStageLabelDisplayMode';

export function stageIcon(stage: Stage, size = 12) {
  if (stage === 'lo') return <Clock size={size} strokeWidth={2.4} />;
  if (stage === 'done') return <PlayCircle size={size} strokeWidth={2.4} />;
  if (stage === 'review') return <CheckSquare size={size} strokeWidth={2.4} />;
  return <CheckCircle2 size={size} strokeWidth={2.4} />;
}

interface StageSegmentToggleProps {
  scene: Scene;
  department: Department;
  onToggle: (stage: Stage) => void;
  compact?: boolean;
  iconDisplay?: 'always' | 'wide' | 'never' | 'auto';
  className?: string;
  segmentClassName?: string | ((stage: Stage) => string | undefined);
  dataContinuityTarget?: string;
}

export function StageSegmentToggle({
  scene,
  department,
  onToggle,
  compact = false,
  iconDisplay = 'auto',
  className,
  segmentClassName,
  dataContinuityTarget,
}: StageSegmentToggleProps) {
  const cfg = DEPARTMENT_CONFIGS[department];
  const pointerHandledRef = useRef(false);
  const { modeOf, setNode } = useStageLabelDisplayMode(cfg.stageLabels, compact, iconDisplay === 'auto');
  const iconClassName =
    iconDisplay === 'never'
      ? 'hidden'
      : iconDisplay === 'wide'
        ? 'hidden 2xl:inline-flex'
        : undefined;

  return (
    <div
      className={cn(
        'flex w-full rounded-lg bg-bg-primary/70 border border-bg-border/40',
        compact ? 'p-0.5 gap-0.5' : 'p-1 gap-0.5',
        className,
      )}
      data-continuity-source={dataContinuityTarget}
    >
      {STAGES.map((stage, i) => {
        const isDone = scene[stage];
        const isCurrent = isDone && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);
        const extraClassName =
          typeof segmentClassName === 'function' ? segmentClassName(stage) : segmentClassName;

        return (
          <button
            type="button"
            key={stage}
            ref={setNode(stage)}
            data-continuity-stage-segment
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              pointerHandledRef.current = true;
              onToggle(stage);
              window.setTimeout(() => {
                pointerHandledRef.current = false;
              }, 600);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (pointerHandledRef.current) {
                pointerHandledRef.current = false;
                return;
              }
              onToggle(stage);
            }}
            className={cn(
              'compact-label-container flex-1 min-w-0 inline-flex items-center justify-center rounded-md font-medium transition-all cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              compact ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-2 text-[11px]',
              !isDone && 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/25',
              extraClassName,
            )}
            style={
              isDone
                ? isCurrent
                  ? {
                      backgroundColor: cfg.color,
                      color: '#fff',
                      fontWeight: 700,
                      boxShadow: `0 2px 8px ${cfg.color}40`,
                    }
                  : {
                      backgroundColor: `${cfg.color}20`,
                      color: cfg.color,
                    }
                : undefined
            }
            title={cfg.stageLabels[stage]}
          >
            <CompactIconLabel
              icon={stageIcon(stage, 12)}
              label={cfg.stageLabels[stage]}
              className="w-full"
              textClassName="leading-none"
              iconClassName={iconClassName}
              iconPosition="after"
              displayMode={
                iconDisplay === 'auto'
                  ? modeOf(stage)
                  : iconDisplay === 'never'
                    ? 'text'
                    : 'both'
              }
            />
          </button>
        );
      })}
    </div>
  );
}
