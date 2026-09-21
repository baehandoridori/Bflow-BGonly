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
function GhostBar({
  run, label, reduceMotion,
}: { run: DragRun; label: string; reduceMotion: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const prevWidth = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.getBoundingClientRect().width;
    const before = prevWidth.current;
    prevWidth.current = width;
    // 첫 렌더는 CSS 등장 애니메이션에 맡긴다. 폭이 바뀐 뒤부터만 늘어나는 느낌을 준다.
    if (reduceMotion || before <= 0 || width <= 0 || Math.abs(before - width) < 0.5) return;
    el.animate(
      [{ transform: `scaleX(${before / width})` }, { transform: 'scaleX(1)' }],
      { duration: 380, easing: 'cubic-bezier(.22,1.2,.36,1)' },
    );
  }, [run.span, run.col, reduceMotion]);

  return (
    <div
      ref={ref}
      className="calendar-drag-ghost"
      style={{
        gridColumn: `${run.col} / span ${run.span}`,
        // 왼쪽으로 늘어날 때는 오른쪽 끝이 제자리에 있어야 자연스럽다.
        transformOrigin: 'left center',
      }}
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
  reduceMotion = false,
  dragging = false,
}: {
  /** 이 행에 그려지는 날짜들(주말 숨김이 적용된 실제 칸 순서) */
  week: string[];
  isSelected: (date: string) => boolean;
  gridTemplateColumns: string;
  /** 실제로 만들어질 날짜 수. 화면 칸 수가 아니라 시작~종료 일수다(주말을 숨겨도 어긋나지 않게). */
  totalDays: number;
  /** 범위가 시작하는 행에서만 true — 줄마다 라벨이 반복되면 지저분하다. */
  showLabel: boolean;
  reduceMotion?: boolean;
  /** 끄는 중에만 표면 반사를 돌린다. 생성 폼을 채우는 동안 계속 돌면 낭비다. */
  dragging?: boolean;
}) {
  const selected = week.map(isSelected);
  if (!selected.some(Boolean)) return null;
  const runs = toDragRuns(selected);

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[3] grid${dragging ? ' is-dragging' : ''}`}
      style={{ gridTemplateColumns }}
      aria-hidden
    >
      {runs.map((run, i) => (
        // key 는 위치가 아니라 구간 순서로 — col 을 키로 쓰면 왼쪽으로 끌 때마다
        // 새 요소로 갈려서 FLIP 대신 등장 애니메이션이 반복된다.
        <GhostBar
          key={i}
          run={run}
          label={i === 0 && showLabel ? (totalDays > 1 ? `새 일정 · ${totalDays}일` : '새 일정') : ''}
          reduceMotion={reduceMotion}
        />
      ))}
    </div>
  );
}
