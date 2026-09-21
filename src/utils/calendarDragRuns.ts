/**
 * 캘린더 한 줄에서 '이어진 선택 구간'을 묶는다.
 *
 * 드래그로 잡은 범위를 칸마다 그리면 이음새마다 테두리가 생기고 색이 끊긴다.
 * 이어진 구간을 요소 하나로 그리려고, 선택된 칸을 연속 구간(시작 컬럼 + 길이)으로 접는다.
 */
export interface DragRun {
  /** 1-based 그리드 컬럼 */
  col: number;
  span: number;
}

export function toDragRuns(selected: readonly boolean[]): DragRun[] {
  const runs: DragRun[] = [];
  let cur: DragRun | null = null;
  selected.forEach((on, i) => {
    if (!on) { cur = null; return; }
    // 바로 앞 칸에서 이어진 경우에만 같은 덩어리로 친다.
    if (cur && cur.col + cur.span === i + 1) cur.span += 1;
    else { cur = { col: i + 1, span: 1 }; runs.push(cur); }
  });
  return runs;
}
