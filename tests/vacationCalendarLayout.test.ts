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
  vacationWeekRenderModel,
  VACATION_BAR_LAYOUT,
  type VacationEventBar,
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

test('일정 뷰: 휴가 동률은 제목이 아니라 사람 이름으로 가른다 (제목 형식이 바뀌어도)', () => {
  // 지금 휴가 제목은 '이름 종류'라 제목 순과 이름 순이 같다. 제목이 '종류 이름'이면 둘이 어긋난다:
  // 제목 순으로는 '연차 윤서연' < '오전반차 강하늘', 이름 순으로는 강하늘 < 윤서연.
  const vacations = mapVacationEvents([
    vac('윤서연', '2026-09-23'),
    vac('강하늘', '2026-09-23', '2026-09-23', '오전반차'),
  ], 'vac').map((e) => ({ ...e, title: `${e.vacationType} ${e.vacationUserName}` }));
  assert.ok(vacations[0].title.localeCompare(vacations[1].title, 'ko') < 0, '전제: 제목 순으로는 윤서연이 먼저');
  for (const input of [vacations, [...vacations].reverse()]) {
    const bars = layoutEventBars(input, WEEK_DAYS);
    assert.deepEqual([...bars].sort((a, b) => a.row - b.row).map((bar) => bar.event.vacationUserName), ['강하늘', '윤서연']);
  }
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

// ── 주 행 렌더 모델 (VacationView 가 그대로 그린다) ───────────────────
type LaidBar = Pick<VacationEventBar, 'row' | 'startCol' | 'span'>;

/** 결정적 의사난수 — 몰린 주를 여러 모양으로 만든다 */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    return x / 2 ** 32;
  };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function randomWeeks(count: number): VacationEventBar[][] {
  const rand = lcg(20260923);
  const names = ['강하늘', '김철수', '박민수', '윤서연', '이영희', '정다은', '최지우', '홍길동', '황보나래'];
  const weeks: VacationEventBar[][] = [];
  for (let w = 0; w < count; w++) {
    const events: VacationEvent[] = [];
    const n = 1 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i++) {
      // 주 앞뒤로 삐져나오는 휴가도 섞는다(9/18 ~ 9/28 에서 시작, 1~5일)
      const start = new Date(2026, 8, 18 + Math.floor(rand() * 11), 12);
      const end = new Date(2026, 8, start.getDate() + Math.floor(rand() * 5), 12);
      events.push(vac(names[Math.floor(rand() * names.length)], isoDate(start), isoDate(end), rand() < 0.3 ? '오후반차' : '연차'));
    }
    weeks.push(layoutVacationBars(events, WEEK_START, WEEK_END, 7));
  }
  return weeks;
}

const WEEK_FIXTURES: VacationEventBar[][] = [
  layoutVacationBars([...CROWDED_BY_REGISTRATION, vac('황보나래', '2026-09-22', '2026-09-24')], WEEK_START, WEEK_END, 7),
  ...randomWeeks(60),
];

/** 모델과 무관하게 막대에서 직접 센, 칸마다 가려진 막대 수 */
function hiddenCountsByBruteForce(all: readonly LaidBar[], drawn: ReadonlySet<LaidBar>, cols: number): number[] {
  const counts = new Array<number>(cols).fill(0);
  for (const bar of all) {
    if (drawn.has(bar)) continue;
    for (let c = bar.startCol; c < bar.startCol + bar.span; c++) counts[c]++;
  }
  return counts;
}

function checkWeekModel(bars: readonly LaidBar[], rowHeight: number, label: string) {
  const { topPx: firstTop, pitchPx, heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  const model = vacationWeekRenderModel(bars, rowHeight, 7);
  const drawn = new Set<LaidBar>(model.bars.map((placed) => placed.bar));
  assert.equal(drawn.size, model.bars.length, `${label}: 같은 막대를 두 번 그린다`);
  for (const bar of drawn) assert.ok(bars.includes(bar), `${label}: 없는 막대를 그린다`);

  // 그린 막대는 행 안, 날짜 숫자 아래, 줄끼리 겹치지 않게
  for (const { bar, topPx } of model.bars) {
    assert.ok(topPx >= firstTop, `${label}: 막대가 날짜 숫자를 가린다`);
    assert.ok(topPx + heightPx + bottomGapPx <= rowHeight, `${label}: ${bar.row}줄 막대가 행 밖(다음 주 칸)으로 넘친다`);
  }
  for (const a of model.bars) {
    for (const b of model.bars) {
      if (a.bar.row === b.bar.row) assert.equal(a.topPx, b.topPx, `${label}: 같은 줄인데 높이가 다르다`);
      else assert.ok(Math.abs(a.topPx - b.topPx) >= heightPx, `${label}: 다른 줄 막대가 겹친다`);
    }
  }

  // 가려진 막대는 아래 줄들이다(중간 줄을 빼먹지 않는다)
  const hidden = bars.filter((bar) => !drawn.has(bar));
  if (hidden.length > 0 && model.bars.length > 0) {
    assert.ok(Math.max(...model.bars.map((p) => p.bar.row)) < Math.min(...hidden.map((bar) => bar.row)),
      `${label}: 위 줄을 가리고 아래 줄을 그렸다`);
  }

  // 칩 = 가려진 막대가 걸친 칸마다, 그 수 그대로 (가려진 막대가 1개여도)
  const expected = hiddenCountsByBruteForce(bars, drawn, 7);
  assert.deepEqual(
    model.chips.map((chip) => [chip.col, chip.count]),
    expected.flatMap((count, col) => (count > 0 ? [[col, count]] : [])),
    `${label}: 칩 칸·개수가 가려진 막대와 다르다`,
  );
  assert.equal(
    model.chips.reduce((sum, chip) => sum + chip.count, 0),
    hidden.reduce((sum, bar) => sum + bar.span, 0),
    `${label}: 칩 개수 합 ≠ 가려진 막대가 걸친 칸 수 합 — 소리 없이 사라진 휴가가 있다`,
  );

  for (const chip of model.chips) {
    // 칩도 행 안에, 그 칸의 그린 막대 아래에
    assert.ok(chip.topPx + heightPx + bottomGapPx <= rowHeight, `${label}: ${chip.col}칸 칩이 행 밖으로 밀려 잘린다`);
    for (const { bar, topPx } of model.bars) {
      if (bar.startCol <= chip.col && chip.col < bar.startCol + bar.span) {
        assert.ok(topPx + heightPx <= chip.topPx, `${label}: ${chip.col}칸 칩이 막대를 덮는다`);
      }
    }
  }

  // 자리를 버리지 않는다: 가렸다면 한 줄 더 그리고 칩을 그 아래에 둘 자리가 없었어야 한다
  if (hidden.length > 0) {
    const chipTop = model.chips[0].topPx;
    assert.ok(chipTop + pitchPx + heightPx + bottomGapPx > rowHeight, `${label}: 들어가는 줄까지 가렸다`);
  }
  return model;
}

test('vacationWeekRenderModel — 행 높이마다: 그린 막대·칩은 행 안, 가려진 막대는 칸마다 칩으로 빠짐없이 센다', () => {
  WEEK_FIXTURES.forEach((bars, i) => {
    for (let rowHeight = 48; rowHeight <= 400; rowHeight++) {
      checkWeekModel(bars, rowHeight, `주 ${i}, 높이 ${rowHeight}px`);
    }
  });
});

test('vacationWeekRenderModel — 9/23 8명+1: 두 줄 높이면 막대 1줄과 9/23 칸에 +8 칩', () => {
  const { topPx, pitchPx, heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  const twoRows = topPx + pitchPx + heightPx + bottomGapPx; // 막대 두 줄이 딱 들어가는 높이
  const model = checkWeekModel(WEEK_FIXTURES[0], twoRows, '9/23');
  assert.deepEqual(model.bars.map((p) => p.bar.row), [0], '넘치니 한 줄은 칩 자리');
  assert.deepEqual(model.chips.map((chip) => [chip.col, chip.count]), [[3, 8]]);
  assert.equal(model.chips[0].topPx, topPx + pitchPx, '칩은 그린 막대 바로 아래 줄');
});

test('vacationWeekRenderModel — 가려진 막대가 칸에 하나뿐이어도 칩(+1)이 나온다', () => {
  const bars: LaidBar[] = [
    { row: 0, startCol: 0, span: 7 },
    { row: 1, startCol: 2, span: 1 },
    { row: 2, startCol: 2, span: 2 },
  ];
  const { topPx, pitchPx, heightPx, bottomGapPx } = VACATION_BAR_LAYOUT;
  const model = checkWeekModel(bars, topPx + pitchPx + heightPx + bottomGapPx, '+1'); // 두 줄 높이
  assert.deepEqual(model.chips.map((chip) => [chip.col, chip.count]), [[2, 2], [3, 1]]);
});

test('vacationWeekRenderModel — 다 들어가거나 아직 못 쟀으면 전부 그리고 칩 없음', () => {
  for (const bars of WEEK_FIXTURES) {
    for (const model of [vacationWeekRenderModel(bars, 0, 7), vacationWeekRenderModel(bars, 10_000, 7)]) {
      assert.equal(model.bars.length, bars.length);
      assert.deepEqual(model.chips, []);
    }
  }
  assert.deepEqual(vacationWeekRenderModel([], 120, 7), { visibleRows: 0, bars: [], chips: [] });
});

// ── 휴가 탭 배선 ──────────────────────────────────────────────────────
// 기존 배선 검사는 뷰 안에서 줄 수·칩을 계산하던 줄을 고정했다. 계산이 vacationWeekRenderModel 로 옮겨져
// 이제는 '뷰가 모델 결과만, 그대로 그린다'를 고정한다(칩 칸·개수·top·측정 방식까지).
test('휴가 탭: 주 행 안쪽 높이를 재서 렌더 모델대로만 막대·+N 칩을 그린다 (누르면 그 날짜 선택)', () => {
  const src = readFileSync('src/views/VacationView.tsx', 'utf8');
  assert.doesNotMatch(src, /function layoutEventBars\(/, '배치 계산은 테스트되는 공용 모듈을 쓴다');
  assert.match(src, /layoutVacationBars\(allEvents, weekStart, weekEnd, 7\)/);

  // 측정: 행 안쪽 높이(clientHeight). scrollHeight 는 넘친 막대까지 잡아 전 줄을 그리고 잘린다
  assert.match(src, /const update = \(\) => setWeekRowHeight\(el\.clientHeight\);/);
  assert.match(src, /new ResizeObserver\(update\)/, '행 높이가 바뀌면 다시 잰다');
  assert.match(src, /ref=\{weekIdx === 0 \? measureWeekRow : undefined\}/);
  assert.match(src, /className="grid grid-cols-7 border-b border-bg-border\/20 relative min-h-0 overflow-hidden"/,
    '주 행이 넘친 막대를 잘라 다음 주 칸 위에 그려지지 않는다');

  // 계산은 렌더 모델 한 곳에서 — 뷰가 따로 줄 수·칩 개수·자리를 정하지 않는다
  assert.match(src, /const week = vacationWeekRenderModel\(weeklyBars\.get\(weekIdx\) \?\? \[\], weekRowHeight, 7\);/);
  for (const helper of ['fitVacationBarRows', 'vacationBarRowCount', 'hiddenVacationBarsByColumn', 'vacationMoreChipTopPx', 'vacationBarTopPx']) {
    assert.doesNotMatch(src, new RegExp(`\\b${helper}\\b`), `${helper} 는 렌더 모델 안에서만 쓴다`);
  }
  assert.doesNotMatch(src, /VACATION_BAR_LAYOUT\.(topPx|pitchPx)/, '막대·칩 top 은 모델 값으로');
  assert.doesNotMatch(src, /28 \+ bar\.row \* 22/, '막대 치수는 VACATION_BAR_LAYOUT 한 곳에서');
  assert.doesNotMatch(src, /(?<!week\.)\bbars\.(map|filter)\(/, '모델을 거치지 않고 막대를 그린다');

  // 막대: 모델의 자리 그대로
  assert.match(src, /\{week\.bars\.map\(\(\{ bar, topPx \}, bi\) => \{/);
  assert.match(src, /const top = `\$\{topPx\}px`;/);
  assert.match(src, /style=\{\{ left, width, top, height: `\$\{VACATION_BAR_LAYOUT\.heightPx\}px`, padding: '0 1px' \}\}/);

  // 칩: 모델의 칸·개수·자리 그대로, 거르지 않는다
  const chipStart = src.indexOf('{week.chips.map((chip) => {');
  assert.ok(chipStart >= 0, '칩은 모델의 chips 를 그린다');
  const chipBlock = src.slice(chipStart, src.indexOf('})}', chipStart));
  assert.match(chipBlock, /const day = weekDays\[chip\.col\];/);
  assert.doesNotMatch(chipBlock, /return null/, '어떤 칸에 칩을 둘지는 모델이 정한다');
  assert.match(chipBlock,
    /left: `\$\{\(chip\.col \/ 7\) \* 100\}%`,\s*width: `\$\{100 \/ 7\}%`,\s*top: `\$\{chip\.topPx\}px`,\s*height: `\$\{VACATION_BAR_LAYOUT\.heightPx\}px`,/);
  assert.match(chipBlock, /onClick=\{\(\) => setSelectedDate\(day\.dateStr\)\}/, '칩을 누르면 그 날짜가 선택된다');
  assert.match(chipBlock, /\+\{chip\.count\} 더보기/);
  // 일정 뷰 월 보기 '+N 더보기'와 같은 칩 모양
  assert.match(chipBlock, /text-\[9px\] font-bold text-accent bg-accent\/10 px-1\.5 py-0\.5 rounded-full hover:bg-accent\/20 cursor-pointer/);
});
