import { useLayoutEffect, useRef } from 'react';
import { toDragRuns, type DragRun } from '@/utils/calendarDragRuns';

/**
 * 드래그로 잡는 중인 날짜 범위를 한 덩어리의 유리로 보여 준다.
 *
 * 칸마다 따로 그리면 이음새마다 테두리가 생기고 색이 끊긴다.
 * **이어진 구간은 언제나 요소 하나**로 두고, 구간이 늘거나 줄 때 바뀐 폭만큼
 * scaleX 를 되돌렸다가 1 로 푸는 FLIP 으로 물처럼 늘어나게 한다.
 *
 * 한 주(행) 안에서만 그리므로 주 경계를 넘는 범위는 이 컴포넌트가 주마다 하나씩 그려진다.
 */
function GhostBar({ run, label }: { run: DragRun; label: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const prevWidth = useRef(0);
  const prevSpan = useRef(run.span);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    const grew = prevSpan.current !== run.span;
    // 처음 생길 때는 등장 애니메이션(CSS)에 맡기고, 폭이 바뀔 때만 늘어나는 느낌을 준다.
    if (grew && prevWidth.current > 0 && width > 0 && Math.abs(prevWidth.current - width) > 0.5) {
      el.animate(
        [{ transform: `scaleX(${prevWidth.current / width})` }, { transform: 'scaleX(1)' }],
        { duration: 380, easing: 'cubic-bezier(.22,1.2,.36,1)' },
      );
    }
    prevWidth.current = width;
    prevSpan.current = run.span;
  }, [run.span, run.col]);

  return (
    <div
      ref={ref}
      className="calendar-drag-ghost"
      style={{ gridColumn: `${run.col} / span ${run.span}`, transformOrigin: 'left center' }}
    >
      {label && <span className="calendar-drag-ghost-label">{label}</span>}
    </div>
  );
}

export function DragCreateGhost({
  week,
  isSelected,
  gridTemplateColumns,
  totalDays,
  showLabel,
}: {
  /** 이 행에 그려지는 날짜들(주말 숨김이 적용된 실제 칸 순서) */
  week: string[];
  isSelected: (date: string) => boolean;
  gridTemplateColumns: string;
  /** 전체 범위의 날짜 수 — 라벨에 'N일' 로 적는다. */
  totalDays: number;
  /** 범위가 시작하는 행에서만 true — 줄마다 라벨이 반복되면 지저분하다. */
  showLabel: boolean;
}) {
  const selected = week.map(isSelected);
  if (!selected.some(Boolean)) return null;
  const runs = toDragRuns(selected);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[3] grid"
      style={{ gridTemplateColumns }}
      aria-hidden
    >
      {runs.map((run, i) => (
        <GhostBar
          key={`${run.col}`}
          run={run}
          label={i === 0 && showLabel ? (totalDays > 1 ? `새 일정 · ${totalDays}일` : '새 일정') : ''}
        />
      ))}
    </div>
  );
}
