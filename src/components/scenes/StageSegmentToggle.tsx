import { useRef, type CSSProperties } from 'react';
import { CheckCircle2, CheckSquare, Clock, PlayCircle } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { Department, Scene, Stage } from '@/types';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { cn } from '@/utils/cn';
import { useStageLabelDisplayMode } from './useStageLabelDisplayMode';
import { useStageFillSteps } from './useStageFillSteps';
import { StageRollbackFlash, useStageSaveStatus } from './StageSaveStatus';

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
  // 움직임 폴리싱 6번: 여러 칸이 한 번에 바뀌면 LO→PNG(켤 때)·PNG→LO(끌 때) 순서로 40ms 씩 이어서.
  const fillSteps = useStageFillSteps(STAGES.map((stage) => Boolean(scene[stage])));
  // 20번: 저장이 실패해 다시 보내는 중인 칸(점선·흐림)과 끝내 되돌린 칸(도리도리·빨간 테두리).
  const { pending, rollback } = useStageSaveStatus(scene.id);
  const fillColorStyle = { '--stage-seg-color': cfg.color, '--stage-seg-glow': `${cfg.color}40` } as CSSProperties;
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
        const savePending = pending.has(stage);

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
            data-on={isDone}
            // 17번: 마지막 칸(PNG)까지 켜졌으면 완료 칸 — 동작 줄이기에서 꽃가루 대신 이 칸 테두리가 한 번 빛난다.
            data-celebrate-cell={isCurrent && i === STAGES.length - 1 ? true : undefined}
            data-stage-key={stage}
            data-save-pending={savePending || undefined}
            aria-busy={savePending || undefined}
            // stage-seg: 누름(scale .94 → 톡) · transform/opacity/color 만 전환 · hover 바탕은 겹친 층의 opacity.
            // 굵기는 고정(semibold) — 굵기가 바뀌면 글자 폭이 바뀌어 다시 배치된다.
            className={cn(
              'stage-seg compact-label-container flex-1 min-w-0 inline-flex items-center justify-center rounded-md font-semibold cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              compact ? 'px-1 py-1 text-[10px]' : 'px-1.5 py-2 text-[11px]',
              !isDone && 'text-text-secondary/60 hover:text-text-primary',
              extraClassName,
            )}
            style={{
              '--stage-step': fillSteps[i] ?? 0,
              ...(isDone ? { color: isCurrent ? '#fff' : cfg.color } : null),
            } as CSSProperties}
            title={cfg.stageLabels[stage]}
          >
            {/* 칸 색: 켜지면 왼쪽부터 scaleX 로 차오르고, 현재 단계면 13% → 100% 로 진해진다. */}
            <span
              aria-hidden="true"
              className="stage-seg-fill"
              data-on={isDone}
              data-current={isCurrent}
              data-glow={isCurrent}
              style={fillColorStyle}
            />
            {rollback?.cells.includes(stage) && <StageRollbackFlash key={rollback.at} />}
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
