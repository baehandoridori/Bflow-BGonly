import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { characterStageColor, type CharacterStageMeta } from '@/constants/characterStages';

// ─── 단계 레일 ──────────────────────────────────
// 채움형 스텝 레일: 지난 단계=채운 점(체크), 현재=색 강조+글로우, 이후=빈 점. 클릭으로 설정.
export function StageRail<T extends string>({
  label,
  stages,
  meta,
  current,
  onSelect,
  headerRight,
}: {
  label: string;
  stages: readonly T[];
  meta: Record<T, CharacterStageMeta>;
  current: T;
  onSelect: (s: T) => void;
  headerRight?: ReactNode;
}) {
  const curIdx = Math.max(0, stages.indexOf(current));
  const curColor = characterStageColor(meta[current]);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-xs font-medium" style={{ color: curColor }}>{meta[current].label}</span>
        </div>
        {headerRight}
      </div>
      <div className="flex items-start">
        {stages.map((s, i) => {
          const m = meta[s];
          const passed = i < curIdx;
          const isCur = i === curIdx;
          const reached = i <= curIdx;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              aria-label={`${label} ${m.label}`}
              aria-pressed={isCur}
              className="group relative flex-1 flex flex-col items-center gap-1.5 cursor-pointer"
            >
              {/* 연결선 (이전 노드 → 이 노드) */}
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute top-[9px] h-[2px] -z-0"
                  style={{
                    left: '-50%',
                    width: '100%',
                    background: reached ? characterStageColor(meta[stages[i - 1]]) : 'rgb(var(--color-bg-border))',
                  }}
                />
              )}
              {/* 노드 */}
              <span
                className="relative z-[1] w-[18px] h-[18px] rounded-full flex items-center justify-center transition-[background-color,border-color,box-shadow] duration-200 ease-out"
                style={{
                  background: reached ? characterStageColor(m) : 'rgb(var(--color-bg-card))',
                  border: `2px solid ${reached ? characterStageColor(m) : 'rgb(var(--color-bg-border))'}`,
                  boxShadow: isCur ? `0 0 0 4px ${characterStageColor(m, 0.2)}` : 'none',
                }}
              >
                {passed && <Check size={10} className="text-white" strokeWidth={3} />}
                {isCur && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span
                className="text-[11px] leading-tight text-center transition-colors"
                style={{ color: isCur ? characterStageColor(m) : 'rgb(var(--color-text-secondary))' }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
