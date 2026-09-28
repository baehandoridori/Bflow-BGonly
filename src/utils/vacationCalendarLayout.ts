// 휴가 탭 달력의 주별 막대 배치와 '몇 줄까지 보이나' 계산.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지(타입만 상대 경로로).
//
// 휴가가 몰린 날(한 날짜에 8명 등)에 막대가 주 행 높이를 넘으면 다음 주 칸 위에 겹쳐 그려졌다.
// 이제 행 높이에 들어가는 줄만 그리고, 넘친 막대는 날짜 칸마다 '+N 더보기' 칩으로 묶는다.

import type { VacationEvent } from '../types/vacation.ts';

export interface VacationEventBar {
  event: VacationEvent;
  row: number;
  startCol: number;
  span: number;
  isStart: boolean;
  isEnd: boolean;
}

/** 막대 그리기 치수(px). VacationView 의 막대·칩 스타일과 같은 값이어야 한다. */
export const VACATION_BAR_LAYOUT = {
  /** 날짜 숫자(24px) + 칸 안쪽 여백 아래에서 첫 막대가 시작하는 위치 */
  topPx: 28,
  /** 막대 한 줄 간격(막대 18 + 사이 4) */
  pitchPx: 22,
  /** 막대 높이 */
  heightPx: 18,
  /** 마지막 줄 아래 남길 여백 — 막대가 주 경계선에 붙지 않게 */
  bottomGapPx: 2,
} as const;

const DAY_MS = 86_400_000;

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function spanDays(ev: VacationEvent): number {
  return Math.round((parseDate(ev.endDate).getTime() - parseDate(ev.startDate).getTime()) / DAY_MS) + 1;
}

/**
 * 막대 쌓는 순서: 기간 긴 순 → 시작일 → **이름 가나다순** → 휴가 종류.
 * 예전에는 이름 기준이 없어 동률이면 입력 순서(=등록 순)를 따랐고, 새로 등록한 휴가가 늘 아래 줄로 밀려
 * 몰린 날에는 가려졌다. 이제 같은 날 같은 길이면 누가 언제 등록했든 이름 순으로 자리가 정해진다.
 */
export function compareVacationBarOrder(a: VacationEvent, b: VacationEvent): number {
  const dSpan = spanDays(b) - spanDays(a);
  if (dSpan !== 0) return dSpan;
  const dStart = a.startDate.localeCompare(b.startDate);
  if (dStart !== 0) return dStart;
  const dName = a.name.localeCompare(b.name, 'ko');
  if (dName !== 0) return dName;
  return a.type.localeCompare(b.type, 'ko');
}

/** 한 주(weekStart~weekEnd, cols 칸) 위에 휴가 막대를 줄 단위로 배치한다. */
export function layoutVacationBars(
  events: VacationEvent[],
  weekStart: Date,
  weekEnd: Date,
  cols: number,
): VacationEventBar[] {
  const weekStartStr = fmtDate(weekStart);
  const weekEndStr = fmtDate(weekEnd);

  const relevant = events
    .filter((e) => e.endDate >= weekStartStr && e.startDate <= weekEndStr)
    .sort(compareVacationBarOrder);

  const rows: boolean[][] = [];
  const bars: VacationEventBar[] = [];

  for (const ev of relevant) {
    const evStart = parseDate(ev.startDate);
    const evEnd = parseDate(ev.endDate);
    const clampStart = evStart < weekStart ? weekStart : evStart;
    const clampEnd = evEnd > weekEnd ? weekEnd : evEnd;

    const startCol = Math.round((clampStart.getTime() - weekStart.getTime()) / DAY_MS);
    const endCol = Math.round((clampEnd.getTime() - weekStart.getTime()) / DAY_MS);
    const span = endCol - startCol + 1;

    let placed = -1;
    for (let r = 0; r < rows.length; r++) {
      let free = true;
      for (let c = startCol; c <= endCol; c++) {
        if (rows[r][c]) { free = false; break; }
      }
      if (free) { placed = r; break; }
    }
    if (placed === -1) {
      placed = rows.length;
      rows.push(new Array(cols).fill(false));
    }
    for (let c = startCol; c <= endCol; c++) {
      rows[placed][c] = true;
    }

    bars.push({
      event: ev,
      row: placed,
      startCol,
      span,
      isStart: evStart >= weekStart,
      isEnd: evEnd <= weekEnd,
    });
  }

  return bars;
}

/** 이 주에 쌓인 줄 수 */
export function vacationBarRowCount(bars: readonly Pick<VacationEventBar, 'row'>[]): number {
  let max = -1;
  for (const bar of bars) if (bar.row > max) max = bar.row;
  return max + 1;
}

/**
 * 주 행 높이(px, 막대가 놓이는 안쪽 높이)에 막대를 몇 줄 그릴지.
 *
 * - 다 들어가면 전부.
 * - 넘치면 들어가는 줄에서 한 줄을 '+N 더보기' 칩 자리로 비운다 → capacity - 1 줄.
 * - 아직 높이를 못 쟀으면(0 이하·NaN) 전부 — 주 행이 overflow-hidden 이라 그래도 다음 주로 넘치지 않는다.
 */
export function fitVacationBarRows(rowHeightPx: number, totalRows: number): number {
  if (totalRows <= 0) return 0;
  if (!Number.isFinite(rowHeightPx) || rowHeightPx <= 0) return totalRows;
  const { topPx, pitchPx, heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  const capacity = Math.max(0, Math.floor((rowHeightPx - bottomGapPx - topPx - heightPx) / pitchPx) + 1);
  if (totalRows <= capacity) return totalRows;
  return Math.max(0, capacity - 1);
}

/** 칸마다 가려진(visibleRows 이상 줄의) 막대 수 — '+N' 칩에 쓴다. */
export function hiddenVacationBarsByColumn(
  bars: readonly Pick<VacationEventBar, 'row' | 'startCol' | 'span'>[],
  visibleRows: number,
  cols: number,
): number[] {
  const counts = new Array<number>(cols).fill(0);
  for (const bar of bars) {
    if (bar.row < visibleRows) continue;
    const end = Math.min(cols, bar.startCol + bar.span);
    for (let c = Math.max(0, bar.startCol); c < end; c++) counts[c]++;
  }
  return counts;
}

/** '+N' 칩(또는 가려진 줄이 시작하는 자리)의 top(px) */
export function vacationMoreChipTopPx(visibleRows: number): number {
  return VACATION_BAR_LAYOUT.topPx + visibleRows * VACATION_BAR_LAYOUT.pitchPx;
}

/** 막대 줄(row)의 top(px) */
export function vacationBarTopPx(row: number): number {
  return VACATION_BAR_LAYOUT.topPx + row * VACATION_BAR_LAYOUT.pitchPx;
}

/** 그릴 막대 하나와 그 자리 */
export interface VacationBarPlacement<B> {
  bar: B;
  topPx: number;
}

/** 날짜 칸 하나의 '+N 더보기' 칩 */
export interface VacationMoreChip {
  /** 날짜 칸(0 = 일요일) */
  col: number;
  /** 그 칸에서 가려진 막대 수(1 이상) */
  count: number;
  topPx: number;
}

/** 주 행 하나를 그리는 데 필요한 전부 — VacationView 는 이 결과만 그린다 */
export interface VacationWeekRenderModel<B> {
  visibleRows: number;
  bars: VacationBarPlacement<B>[];
  chips: VacationMoreChip[];
}

/**
 * 주 행 하나의 렌더 모델: 행 높이(rowHeightPx, 막대가 놓이는 안쪽 높이)에 들어가는 줄의 막대와,
 * 넘친 막대가 걸친 날짜 칸마다 '+N 더보기' 칩.
 *
 * 보장(테스트가 고정한다):
 * - 그린 막대와 칩은 모두 행 안에 들어간다(행을 잰 뒤, 칩 한 줄이 들어가는 높이부터).
 * - 막대는 그리거나(bars) 걸친 칸마다 칩 count 로 세거나 둘 중 하나 — 소리 없이 사라지지 않는다.
 * - 칩은 가려진 막대가 있는 칸에만, 가려진 막대가 1개여도 나온다.
 */
export function vacationWeekRenderModel<B extends Pick<VacationEventBar, 'row' | 'startCol' | 'span'>>(
  bars: readonly B[],
  rowHeightPx: number,
  cols: number,
): VacationWeekRenderModel<B> {
  const visibleRows = fitVacationBarRows(rowHeightPx, vacationBarRowCount(bars));
  const placed = bars
    .filter((bar) => bar.row < visibleRows)
    .map((bar) => ({ bar, topPx: vacationBarTopPx(bar.row) }));
  const chipTopPx = vacationMoreChipTopPx(visibleRows);
  const chips: VacationMoreChip[] = [];
  hiddenVacationBarsByColumn(bars, visibleRows, cols).forEach((count, col) => {
    if (count > 0) chips.push({ col, count, topPx: chipTopPx });
  });
  return { visibleRows, bars: placed, chips };
}
