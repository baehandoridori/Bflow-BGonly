/**
 * 휴가가 몰린 날 달력 표시 테스트
 *
 * 문제(2026-09-23 에 8명): 막대 쌓는 순서가 '기간 긴 순 → 시작일' 뿐이라 동률이면 입력 순서(=등록 순)를
 * 따랐다. 새로 등록한 휴가가 늘 아래 줄로 밀려, 휴가 탭 달력에서는 주 칸을 넘쳐 다음 주 칸 위에 그려졌고
 * 일정 뷰 월 보기에서는 '+N 더보기' 뒤로 숨었다.
 *
 * 해결: 동률에 이름 가나다순 보조키. 휴가 탭 달력은 주 행 높이에 들어가는 줄만 그리고,
 * 넘친 막대는 날짜 칸마다 '+N 더보기' 칩으로 묶는다(누르면 그 날짜 선택).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compareVacationBarOrder,
  fitVacationBarRows,
  hiddenVacationBarsByColumn,
  layoutVacationBars,
  vacationBarRowCount,
  vacationMoreChipTopPx,
  VACATION_BAR_LAYOUT,
} from '../src/utils/vacationCalendarLayout.ts';
import { layoutEventBars } from '../src/utils/calendarWeekdays.ts';
import { mapVacationEvents } from '../src/utils/vacationEvents.ts';
import type { VacationEvent } from '../src/types/vacation.ts';
import type { CalendarEvent } from '../src/types/calendar.ts';

/** 2026-09-20(일) ~ 2026-09-26(토) */
const WEEK_START = new Date(2026, 8, 20, 12);
const WEEK_END = new Date(2026, 8, 26, 12);
const WEEK_DAYS = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 20 + i, 12));

function vac(name: string, startDate: string, endDate = startDate, type = '연차'): VacationEvent {
  return { name, type, startDate, endDate };
}

/** 9/23 하루짜리 8명 — 등록 순서대로 */
const CROWDED_BY_REGISTRATION = ['홍길동', '김철수', '이영희', '박민수', '최지우', '정다은', '강하늘', '윤서연']
  .map((name) => vac(name, '2026-09-23'));

const koSorted = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, 'ko'));

// ── 동률 정렬 ─────────────────────────────────────────────────────────
test('휴가 탭: 같은 날 같은 길이면 등록 순이 아니라 이름 가나다순으로 줄이 정해진다', () => {
  const bars = layoutVacationBars(CROWDED_BY_REGISTRATION, WEEK_START, WEEK_END, 7);
  const byRow = [...bars].sort((a, b) => a.row - b.row).map((bar) => bar.event.name);
  assert.deepEqual(byRow, koSorted(CROWDED_BY_REGISTRATION.map((e) => e.name)));
  assert.equal(byRow[0], '강하늘', '마지막에 등록한 사람이라도 이름이 앞이면 첫 줄');
});

test('휴가 탭: 입력 순서를 뒤집어도 배치가 같다 (결정적)', () => {
  const events = [
    ...CROWDED_BY_REGISTRATION,
    vac('홍길동', '2026-09-22', '2026-09-24'),
    vac('김철수', '2026-09-23', '2026-09-23', '오후반차'),
  ];
  const rowsOf = (list: VacationEvent[]) => layoutVacationBars(list, WEEK_START, WEEK_END, 7)
    .map((bar) => `${bar.row}:${bar.event.name}:${bar.event.type}:${bar.event.startDate}`)
    .sort();
  assert.deepEqual(rowsOf([...events].reverse()), rowsOf(events));
});

test('휴가 탭: 기간이 긴 휴가가 여전히 먼저, 같은 이름·날짜면 휴가 종류로 가른다', () => {
  const long = vac('황보나래', '2026-09-22', '2026-09-24');
  const halfPm = vac('강하늘', '2026-09-23', '2026-09-23', '오후반차');
  const halfAm = vac('강하늘', '2026-09-23', '2026-09-23', '오전반차');
  assert.ok(compareVacationBarOrder(long, halfAm) < 0, '긴 휴가가 이름보다 우선');
  assert.ok(compareVacationBarOrder(halfAm, halfPm) < 0, '오전반차 < 오후반차 (가나다)');
  const bars = layoutVacationBars([halfPm, halfAm, long], WEEK_START, WEEK_END, 7);
  assert.deepEqual(
    [...bars].sort((a, b) => a.row - b.row).map((b) => `${b.event.name} ${b.event.type}`),
    ['황보나래 연차', '강하늘 오전반차', '강하늘 오후반차'],
  );
});

test('일정 뷰: 휴가 막대도 동률이면 이름 가나다순, 같은 날 팀 일정은 휴가보다 위에 남는다', () => {
  const vacations = mapVacationEvents(CROWDED_BY_REGISTRATION, 'vac');
  const meeting: CalendarEvent = {
    id: 'meeting', title: '회의', memo: '', color: '#6C5CE7', type: 'custom',
    startDate: '2026-09-23', endDate: '2026-09-23', createdBy: '배한솔', createdAt: '2026-09-01T00:00:00.000Z',
  } as CalendarEvent;

  // 일정 뷰가 넘겨주는 순서: 일반 일정 → 휴가(등록 순)
  const bars = layoutEventBars([meeting, ...vacations], WEEK_DAYS);
  const byRow = [...bars].sort((a, b) => a.row - b.row).map((bar) => bar.event.vacationUserName ?? bar.event.title);
  assert.deepEqual(byRow, ['회의', ...koSorted(CROWDED_BY_REGISTRATION.map((e) => e.name))]);

  // 입력 순서가 뒤집혀도 같다
  const reversed = layoutEventBars([...vacations].reverse().concat(meeting), WEEK_DAYS);
  assert.deepEqual(
    [...reversed].sort((a, b) => a.row - b.row).map((bar) => bar.event.vacationUserName ?? bar.event.title),
    byRow,
  );
});

// ── 보이는 줄 수·넘침 개수 ────────────────────────────────────────────
test('fitVacationBarRows — 행 높이에 들어가는 만큼만, 넘치면 한 줄을 +N 칩 자리로 비운다', () => {
  const { topPx, pitchPx, heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  // 딱 3줄 들어가는 높이
  const threeRows = topPx + 2 * pitchPx + heightPx + bottomGapPx;
  assert.equal(fitVacationBarRows(threeRows, 3), 3, '다 들어가면 전부');
  assert.equal(fitVacationBarRows(threeRows, 2), 2);
  assert.equal(fitVacationBarRows(threeRows - 1, 3), 1, '한 픽셀 모자라면 2줄만 들어가고, 넘치니 1줄 + 칩');
  assert.equal(fitVacationBarRows(threeRows, 8), 2, '8줄이면 2줄 + 칩');
  assert.equal(fitVacationBarRows(40, 8), 0, '막대 한 줄도 안 들어가면 0');
  assert.equal(fitVacationBarRows(threeRows, 0), 0);
  assert.equal(fitVacationBarRows(0, 5), 5, '높이를 아직 못 쟀으면 전부(행이 overflow-hidden 이라 안 넘친다)');
  assert.equal(fitVacationBarRows(Number.NaN, 5), 5);
});

test('+N 칩은 마지막으로 보이는 막대 바로 아래 줄에 있고, 그 줄은 행 안에 들어간다', () => {
  const { heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  // 칩 한 줄(28 + 18 + 여백 2 = 48px)은 들어가는 높이부터
  for (let rowHeight = 48; rowHeight <= 400; rowHeight++) {
    const visible = fitVacationBarRows(rowHeight, 99);
    assert.ok(vacationMoreChipTopPx(visible) + heightPx + bottomGapPx <= rowHeight,
      `높이 ${rowHeight}px: 칩이 다음 주 칸으로 넘친다`);
  }
});

test('hiddenVacationBarsByColumn — 날짜 칸마다 가려진 막대 수를 센다', () => {
  const bars = layoutVacationBars([
    ...CROWDED_BY_REGISTRATION,
    vac('황보나래', '2026-09-22', '2026-09-24'),
  ], WEEK_START, WEEK_END, 7);
  assert.equal(vacationBarRowCount(bars), 9, '9/23 에 9명 → 9줄');

  // 두 줄만 보이면: 9/23(수, 인덱스 3)에 7명이 가려지고, 9/22·9/24 는 황보나래(첫 줄)뿐이라 0
  assert.deepEqual(hiddenVacationBarsByColumn(bars, 2, 7), [0, 0, 0, 7, 0, 0, 0]);
  assert.deepEqual(hiddenVacationBarsByColumn(bars, 9, 7), [0, 0, 0, 0, 0, 0, 0], '다 보이면 칩 없음');
  assert.deepEqual(hiddenVacationBarsByColumn(bars, 0, 7), [0, 0, 1, 9, 1, 0, 0], '하나도 안 보이면 전부');
});

test('hiddenVacationBarsByColumn — 여러 날 막대가 가려지면 걸친 칸마다 센다', () => {
  const bars = [
    { row: 0, startCol: 0, span: 7 },
    { row: 1, startCol: 1, span: 3 },
    { row: 2, startCol: 2, span: 1 },
  ];
  assert.deepEqual(hiddenVacationBarsByColumn(bars, 1, 7), [0, 1, 2, 1, 0, 0, 0]);
});

// ── 휴가 탭 배선 ──────────────────────────────────────────────────────
test('휴가 탭: 주 행을 재서 보이는 줄만 그리고, 넘치면 +N 칩(누르면 그 날짜 선택)', () => {
  const src = readFileSync('src/views/VacationView.tsx', 'utf8');
  assert.doesNotMatch(src, /function layoutEventBars\(/, '배치 계산은 테스트되는 공용 모듈을 쓴다');
  assert.match(src, /layoutVacationBars\(allEvents, weekStart, weekEnd, 7\)/);
  assert.match(src, /new ResizeObserver\(update\)/, '행 높이가 바뀌면 다시 잰다');
  assert.match(src, /ref=\{weekIdx === 0 \? measureWeekRow : undefined\}/);
  assert.match(src, /const visibleRows = fitVacationBarRows\(weekRowHeight, vacationBarRowCount\(bars\)\);/);
  assert.match(src, /bars\.filter\(\(bar\) => bar\.row < visibleRows\)\.map\(/, '보이는 줄만 그린다');
  assert.match(src, /className="grid grid-cols-7 border-b border-bg-border\/20 relative min-h-0 overflow-hidden"/,
    '주 행이 넘친 막대를 잘라 다음 주 칸 위에 그려지지 않는다');
  assert.match(src, /onClick=\{\(\) => setSelectedDate\(day\.dateStr\)\}/, '칩을 누르면 그 날짜가 선택된다');
  assert.match(src, /\+\{count\} 더보기/);
  // 일정 뷰 월 보기 '+N 더보기'와 같은 칩 모양
  assert.match(src, /text-\[9px\] font-bold text-accent bg-accent\/10 px-1\.5 py-0\.5 rounded-full hover:bg-accent\/20 cursor-pointer/);
  assert.doesNotMatch(src, /28 \+ bar\.row \* 22/, '막대 치수는 VACATION_BAR_LAYOUT 한 곳에서');
});
