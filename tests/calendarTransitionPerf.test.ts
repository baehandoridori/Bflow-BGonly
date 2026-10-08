// tests/calendarTransitionPerf.test.ts
// 캘린더 넘김(월·주·일) 애니메이션을 부드럽게 만든 구조의 회귀 방지.
// 성능 문제는 눈으로만 드러나서, 다시 무거운 방식으로 되돌아가지 않게 구조와 핵심 계산을 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reuseUnchangedCalendarEvents, isSameCalendarEventContent } from '../src/utils/calendarEventReuse.ts';
import { pickStackFlipShift } from '../src/hooks/useStackFlip.ts';
import type { CalendarEvent } from '../src/types/calendar.ts';

// 체크아웃 설정(autocrlf)에 따라 CRLF 로 올 수 있어, 여러 줄 정규식이 흔들리지 않게 LF 로 맞춘다.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    title: '회의',
    memo: '',
    color: '#6C5CE7',
    type: 'custom',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    createdBy: '배한솔',
    createdAt: '2026-10-01T00:00:00.000Z',
    source: 'bflow',
    sourceCalendarId: 'bflow:cal-1',
    calendarId: 'cal-1',
    tagIds: ['tag-a'],
    ...overrides,
  };
}

/* ─── 정본 재조회: 내용이 같으면 이전 객체를 쓴다 ───────────── */

test('내용이 같은 정본 목록은 이전 배열을 그대로 돌려줘 상태 갱신이 아무 일도 하지 않는다', () => {
  const previous = [event(), event({ id: 'ev-2', title: '마감' })];
  // 정본 캐시는 기간을 넘길 때마다 같은 내용의 새 객체를 만든다.
  const next = previous.map((item) => ({ ...item, tagIds: [...(item.tagIds ?? [])] }));
  const merged = reuseUnchangedCalendarEvents(previous, next);
  assert.equal(merged, previous, '배열 자체가 같아야 React 가 다시 그리지 않는다');
});

test('바뀐 일정만 새 객체로, 나머지는 이전 객체를 재사용한다', () => {
  const unchanged = event({ id: 'same' });
  const before = event({ id: 'moved' });
  const previous = [unchanged, before];
  const next = [{ ...unchanged }, { ...before, startDate: '2026-10-06', endDate: '2026-10-06' }];
  const merged = reuseUnchangedCalendarEvents(previous, next);
  assert.notEqual(merged, previous, '바뀐 일정이 있으면 새 배열이다');
  assert.equal(merged[0], unchanged, '내용이 같은 일정은 이전 객체(메모·편집기 상태 보존)');
  assert.equal(merged[1], next[1], '바뀐 일정은 새 객체');
});

test('같은 일정이라도 태그·반복 규칙 같은 중첩 값이 바뀌면 다른 내용으로 본다', () => {
  assert.equal(isSameCalendarEventContent(event(), event({ tagIds: ['tag-b'] })), false);
  assert.equal(isSameCalendarEventContent(event(), event({ tagIds: ['tag-a', 'tag-b'] })), false);
  const rule = { freq: 'weekly', interval: 1 } as unknown as CalendarEvent['recurrenceRule'];
  const otherRule = { freq: 'weekly', interval: 2 } as unknown as CalendarEvent['recurrenceRule'];
  assert.equal(isSameCalendarEventContent(event({ recurrenceRule: rule }), event({ recurrenceRule: { ...rule } as CalendarEvent['recurrenceRule'] })), true);
  assert.equal(isSameCalendarEventContent(event({ recurrenceRule: rule }), event({ recurrenceRule: otherRule })), false);
  // undefined 키는 없는 것과 같다(정본 매핑이 빈 값을 생략하기도 한다).
  assert.equal(isSameCalendarEventContent(event({ memo: undefined as unknown as string }), { ...event(), memo: undefined as unknown as string }), true);
});

test('순서나 개수가 달라지면 이전 배열을 쓰지 않는다', () => {
  const a = event({ id: 'a' });
  const b = event({ id: 'b' });
  assert.notEqual(reuseUnchangedCalendarEvents([a, b], [{ ...b }, { ...a }]), [a, b]);
  const reordered = reuseUnchangedCalendarEvents([a, b], [{ ...b }, { ...a }]);
  assert.equal(reordered[0], b, '순서가 바뀌어도 같은 일정 객체는 재사용한다');
  assert.equal(reordered[1], a);
  assert.equal(reuseUnchangedCalendarEvents([a, b], [{ ...a }]).length, 1, '빠진 일정은 빠진다');
});

test('같은 id 라도 저장소가 다르면(구글·B flow) 다른 일정으로 본다', () => {
  const bflow = event({ id: 'dup' });
  const google = event({ id: 'dup', source: 'google', sourceCalendarId: 'primary', calendarId: undefined });
  const merged = reuseUnchangedCalendarEvents([bflow], [{ ...google }]);
  assert.notEqual(merged[0], bflow, '저장소가 다른 일정을 이전 객체로 덮으면 안 된다');
});

test('비어 있던 목록이 또 비어 있으면 이전 배열을 그대로 쓴다(빈 기간도 다시 그리지 않음)', () => {
  const empty: CalendarEvent[] = [];
  assert.equal(reuseUnchangedCalendarEvents(empty, []), empty);
  const next = [event()];
  assert.equal(reuseUnchangedCalendarEvents(empty, next), next);
});

test('Date 처럼 순수 객체가 아닌 값은 키 비교로 같다고 보지 않는다', () => {
  const withDate = (time: number) => ({ ...event(), extra: new Date(time) }) as unknown as CalendarEvent;
  assert.equal(isSameCalendarEventContent(withDate(0), withDate(86_400_000)), false);
});

test('ScheduleView 는 정본을 받을 때 재사용 결과로 상태를 갱신한다', () => {
  const view = read('src/views/ScheduleView.tsx');
  assert.match(view, /setEvents\(\(previous\) => reuseUnchangedCalendarEvents\(previous, canonicalEvents\)\);/);
  assert.doesNotMatch(view, /setEvents\(canonicalEvents\);/, '새 객체를 그대로 넣으면 넘길 때마다 화면 전체가 다시 그려진다');
  // 주간·2주의 연도 주 배열은 달이 바뀌어도 같은 참조여야 사이드바 53주가 다시 그려지지 않는다.
  assert.match(view, /const yearWeeks = useMemo\(\(\) => generateYearWeeks\(year\), \[year\]\);/);
});

/* ─── 월 보기: 합성 스레드 전환 + 칸마다 흐림 없음 ─────────── */

test('월 전환은 transform 문자열(합성 스레드)로 움직이고 끝나면 transform 을 남기지 않는다', () => {
  const motionSource = read('src/components/calendar/monthSlideMotion.ts');
  assert.match(motionSource, /transform: `translateY\(\$\{direction > 0 \? distancePx : -distancePx\}px\)`/);
  assert.match(motionSource, /transitionEnd: \{ transform: 'none' \}/, 'translateY(0) 이 남으면 fixed 자손의 기준 상자가 바뀐다');
  assert.doesNotMatch(motionSource, /\by: /, 'y 는 메인 스레드가 매 프레임 계산한다');
  // 캘린더 월 화면과 대시보드 위젯이 같은 방식을 쓴다.
  for (const [name, file, slide] of [
    ['월 화면', 'src/components/calendar/CalendarGrid.tsx', 'monthSlide'],
    ['위젯', 'src/components/widgets/CalendarWidget.tsx', 'monthSlide'],
  ] as const) {
    const source = read(file);
    assert.doesNotMatch(source, /mode="popLayout"/, `${name}: 나가는 달을 측정·절대 배치하지 않는다(격자 칸에 겹친다)`);
    assert.doesNotMatch(source, /\by: monthDirection/, `${name}: y 는 메인 스레드가 매 프레임 계산한다`);
    assert.match(source, /createMonthSlideVariants\(/, `${name}: 공용 슬라이드를 쓴다`);
    assert.match(source, new RegExp(`<AnimatePresence initial=\\{false\\} custom=\\{${slide}\\}>`), `${name}: 나가는 달도 지금 방향을 따른다`);
    assert.match(source, /style=\{MONTH_LAYER_STYLE\}/, `${name}: 두 달을 한 칸에 겹친다`);
  }
});

test('미니 달력 넘김은 합성 스레드로 돌고, 동작 줄이기에서는 미끄러지지 않는다', () => {
  // transform 문자열은 ScheduleView 의 MotionConfig('동작 줄이기')가 막지 못한다 — 직접 꺼야 한다.
  const mini = read('src/components/calendar/MiniCalendar.tsx');
  assert.match(mini, /const \{ reduce \} = useMotionPref\(\);/);
  assert.match(mini, /initial=\{reduce \? \{ opacity: 0 \} : \{ opacity: 0, transform: 'translateX\(20px\)' \}\}/);
  assert.match(mini, /exit=\{reduce \? \{ opacity: 0 \} : \{ opacity: 0, transform: 'translateX\(-20px\)' \}\}/);
  assert.match(mini, /transitionEnd: \{ transform: 'none' \}/);
  assert.doesNotMatch(mini, /\bx: -?20\b/, 'x 는 메인 스레드가 매 프레임 계산한다');
});

test('대시보드 위젯의 주·하루 넘김도 framer layout·JS 크기 애니메이션을 쓰지 않는다', () => {
  const widget = read('src/components/widgets/CalendarWidget.tsx');
  assert.doesNotMatch(widget, /^\s*layout\s*$/m, '크기를 scale 로 맞추면 글자가 찌그러진다');
  assert.doesNotMatch(widget, /flex: isActive/, 'flex 를 JS 로 애니메이션하면 매 프레임 레이아웃을 다시 잡는다');
  assert.match(widget, /const WIDGET_WEEK_SLOTS = \[-3, -2, -1, 0, 1, 2, 3\] as const;/, '양끝 대기 줄이 있어야 넘겨도 줄이 이어진다');
  assert.match(widget, /const WIDGET_2WEEK_SLOTS = \[-3, -2, -1, 0, 1, 2, 3, 4, 5\] as const;/, '2주씩 넘기므로 대기 줄도 2개씩');
  assert.match(widget, /key=\{`week-\$\{fmtDate\(week\.ws\)\}`\}/, '줄은 날짜 키로 유지된다');
  // 첫 로드·변경 신호(refresh)와 기간 이동, 두 경로 모두 재사용을 거친다.
  assert.equal([...widget.matchAll(/setEvents\(\(previous\) => reuseUnchangedCalendarEvents\(previous, result\)\)/g)].length, 2);
  assert.doesNotMatch(widget, /setEvents\(result\)/, '새 객체를 그대로 넣으면 넘길 때마다 위젯 전체가 다시 그려진다');
  const css = read('src/index.css');
  assert.match(css, /\.calendar-widget-week-row \{\s*transition:\s*flex-grow 0\.4s/);
  assert.match(css, /\.calendar-widget-day-center \{\s*animation: calendarWidgetDayIn/);
});

test('알림 벨 강조 빛은 box-shadow 키프레임이 아니라 투명도·크기로 움직인다', () => {
  const css = read('src/styles/notification-bell.css');
  const keyframes = [...css.matchAll(/@keyframes bell-glow-[\w-]+ \{[\s\S]*?\n\}/g)].map((match) => match[0]);
  assert.equal(keyframes.length, 2, '숨쉬기·멘션 펄스 두 가지');
  for (const frames of keyframes) {
    assert.doesNotMatch(frames, /box-shadow/, '키프레임에서 그림자를 바꾸면 매 프레임 다시 칠한다');
    assert.match(frames, /opacity/);
  }
  assert.match(css, /\.bell-glow-soft::after,\s*\.bell-glow-mention::after \{[\s\S]*?z-index: -1;/, '빛은 버튼 내용 뒤에 깔린다');
  assert.match(css, /\.bell-glow-soft,\s*\.bell-glow-mention \{\s*isolation: isolate;/, 'z-index -1 이 헤더 배경 뒤로 숨지 않게');
});

test('일정 막대와 + 버튼에는 backdrop-filter 를 두지 않는다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.doesNotMatch(grid, /backdropFilter|WebkitBackdropFilter/, '막대마다 흐림을 걸면 달 전환 때 GPU 가 매 프레임 다시 그린다');
  const css = read('src/index.css');
  const addButton = css.slice(css.indexOf('.calendar-day-add {'), css.indexOf('.calendar-day-add:hover'));
  assert.ok(addButton.length > 0, '+ 버튼 규칙을 찾지 못했다');
  assert.doesNotMatch(addButton, /^\s*(-webkit-)?backdrop-filter:/m, '숨은 + 버튼 42개도 각각 합성 레이어가 된다');
});

test('+ 버튼 근접 노출은 모두 잰 다음 바뀐 것만 쓴다(레이아웃 스래싱 없음)', () => {
  const hook = read('src/hooks/useProximityReveal.ts');
  const applyBody = hook.slice(hook.indexOf('const apply = useCallback'), hook.indexOf('const schedule = useCallback'));
  const readIndex = applyBody.indexOf('getBoundingClientRect');
  const writeIndex = applyBody.indexOf("setProperty('--reveal'");
  assert.ok(readIndex > 0 && writeIndex > readIndex, '측정이 쓰기보다 먼저 끝나야 한다');
  assert.match(applyBody, /const values = elements\.map/, '측정 결과를 먼저 모은다');
  const readPhase = applyBody.slice(applyBody.indexOf('const values = elements.map'), applyBody.indexOf('elements.forEach'));
  assert.ok(readPhase.length > 0, '측정 단계와 쓰기 단계를 찾지 못했다');
  assert.doesNotMatch(readPhase, /setProperty|style\./, '측정 도중에 쓰면 다음 측정이 매번 강제 재계산된다');
  assert.match(applyBody, /getPropertyValue\('--reveal'\) !== values\[index\]/, '값이 그대로인 버튼은 건드리지 않는다');
});

/* ─── 주·일 보기: 줄 묶음 미끄러짐 ─────────────────────── */

type Row = { id: string; start: number; anchor?: boolean; active?: boolean };
function snapshot(rows: Row[]) {
  return {
    rows: new Map(rows.map((row, index) => [row.id, {
      start: row.start, index, anchor: row.anchor === true, active: row.active === true,
    }])),
    activeIndex: rows.findIndex((row) => row.active),
  };
}

test('다음 주: 옛 포커스 바로 위의 접힌 줄이 제자리에 보이도록 묶음을 되돌린다', () => {
  // 접힌 줄 60px, 포커스 카드 500px. 넘긴 뒤 같은 날짜 줄(w-1)은 위로 한 칸(60px) 올라갔다.
  const before = snapshot([
    { id: 'w-2', start: 100, anchor: true }, { id: 'w-1', start: 160, anchor: true },
    { id: 'w0', start: 220, active: true }, { id: 'w+1', start: 720, anchor: true }, { id: 'w+2', start: 780, anchor: true },
  ]);
  // 먼 줄(w+2)은 포커스 카드 높이 차이만큼 어긋날 수 있다 — 기준으로 삼으면 안 된다.
  const after = snapshot([
    { id: 'w-1', start: 100, anchor: true }, { id: 'w0', start: 160, anchor: true },
    { id: 'w+1', start: 220, active: true }, { id: 'w+2', start: 716, anchor: true }, { id: 'w+3', start: 776, anchor: true },
  ]);
  assert.equal(pickStackFlipShift(before, after), 60, '한 칸 아래에서 시작해 제자리로 올라온다');
});

test('이전 주: 옛 포커스 바로 아래의 접힌 줄을 기준으로 삼는다(먼 줄이 아니라)', () => {
  const before = snapshot([
    { id: 'w-2', start: 100, anchor: true }, { id: 'w-1', start: 160, anchor: true },
    { id: 'w0', start: 220, active: true }, { id: 'w+1', start: 720, anchor: true }, { id: 'w+2', start: 780, anchor: true },
  ]);
  const after = snapshot([
    { id: 'w-3', start: 104, anchor: true }, { id: 'w-2', start: 164, anchor: true },
    { id: 'w-1', start: 220, active: true }, { id: 'w0', start: 720, anchor: true }, { id: 'w+1', start: 780, anchor: true },
  ]);
  // w+1(720 → 780, -60)과 w-2(100 → 164, -64) 중 옛 포커스에 가까운 w+1 이 기준이다.
  assert.equal(pickStackFlipShift(before, after), -60, '한 칸 위에서 시작해 제자리로 내려온다');
});

test('2주 보기에서 한 주씩 넘기면 계속 포커스인 주를 기준으로 삼는다', () => {
  const before = snapshot([
    { id: 'w-1', start: 100, anchor: true }, { id: 'w0', start: 160, active: true },
    { id: 'w+1', start: 460, active: true }, { id: 'w+2', start: 760, anchor: true },
  ]);
  const after = snapshot([
    { id: 'w0', start: 100, anchor: true }, { id: 'w+1', start: 160, active: true },
    { id: 'w+2', start: 460, active: true }, { id: 'w+3', start: 760, anchor: true },
  ]);
  assert.equal(pickStackFlipShift(before, after), 300, 'w+1 카드가 옛 자리에서 이어진다');
});

test('미끄러짐 측정값은 키가 그대로인 커밋에서 버린다(버려진 렌더의 옛 측정이 섞이지 않게)', () => {
  const flip = read('src/hooks/useStackFlip.ts');
  // 의존성 없이 커밋마다 돌고, 키가 그대로면 남은 측정값을 비운다.
  assert.match(flip, /if \(committedKeyRef\.current === flipKey\) \{\s*snapshotRef\.current = null;\s*return;\s*\}/);
  assert.match(flip, /\n {2}\}\);\n\n {2}useLayoutEffect\(\(\) => \(\) => \{/, '첫 레이아웃 효과는 의존성 배열이 없어야 커밋마다 돈다');
});

test('같은 달로 금방 돌아와도 나가는 중인 달 레이어를 다시 쓰지 않는다(넘길 때마다 새 키)', () => {
  for (const file of ['src/components/calendar/CalendarGrid.tsx', 'src/components/widgets/CalendarWidget.tsx']) {
    const source = read(file);
    assert.match(source, /monthLayerKeyRef\.current = \{ monthKey, seq: monthLayerKeyRef\.current\.seq \+ 1 \};/, file);
    assert.match(source, /key=\{monthLayerKey\}/, file);
  }
  // 미니 달력은 memo 라 '오늘'을 부모에게서 받아야 날짜가 바뀌면 다시 그려진다.
  assert.match(read('src/components/calendar/MiniCalendar.tsx'), /const today = todayProp \?\? fmtDate\(new Date\(\)\);/);
  assert.match(read('src/views/ScheduleView.tsx'), /selectedDate=\{miniCalendarSelectedDate\}\n\s*today=\{today\}/);
});

test('이어지는 줄이 없으면(멀리 건너뜀) 되돌릴 거리를 정하지 않는다', () => {
  const before = snapshot([{ id: 'a', start: 100, anchor: true }, { id: 'b', start: 160, active: true }]);
  const after = snapshot([{ id: 'x', start: 100, anchor: true }, { id: 'y', start: 160, active: true }]);
  assert.equal(pickStackFlipShift(before, after), null);
});

test('주간 카드 보기는 framer layout(크기 scale) 대신 줄 묶음 하나를 미끄러뜨린다', () => {
  const week = read('src/components/calendar/WeekScrollView.tsx');
  assert.doesNotMatch(week, /^\s*layout\s*$/m, '크기를 scale 로 맞추면 글자가 찌그러지고 매 프레임 다시 그린다');
  assert.doesNotMatch(week, /AnimatePresence/);
  assert.match(week, /useStackFlip\(stackRef,/);
  assert.match(week, /key=\{weekKey\}/, '연도를 넘어도 같은 주는 같은 줄로 이어지게 날짜를 키로 쓴다');
  assert.match(week, /data-flip-anchor=\{isActive \? undefined : 'true'\}/);
  // 포커스 카드는 남은 높이 안에 들어가고 일정 목록은 카드 안에서 스크롤된다.
  assert.match(week, /minHeight: isActive \? \(is2Week \? '30vh' : '50vh'\) : undefined/);
  assert.match(week, /flex-1 min-h-0 overflow-y-auto mt-2/, '목록이 줄어들 수 있어야 안에서 스크롤된다');
  // 높이가 모자라면 포커스 카드가 먼저 줄고(바닥까지), 이웃 주는 그 뒤에야 줄어든다 — 낮은 창에서 카드 아래가 잘리지 않게.
  assert.match(week, /className=\{isActive \? 'w-full flex flex-col' : 'w-full min-h-0 overflow-hidden'\}/);
  assert.match(week, /flex: isActive \? '0 1000 auto' : '0 1 auto',/);
  // 목록 끝에 막 닿은 관성 휠은 주를 넘기지 않는다.
  assert.match(week, /if \(Date\.now\(\) - lastListScrollAtRef\.current < LIST_SCROLL_SETTLE_MS\) return;/);
  assert.match(week, /onScrollCapture=\{handleScrollCapture\}/);
});

test('일간 보기는 날짜 키로 칸을 유지하고 바깥 대기 칸(너비 0)으로 들고 나간다', () => {
  const day = read('src/components/calendar/DayScrollView.tsx');
  assert.doesNotMatch(day, /AnimatePresence/);
  assert.doesNotMatch(day, /^\s*layout\s*$/m, 'CSS 너비 트랜지션과 framer layout 측정이 서로 싸운다');
  assert.match(day, /const RENDER_RANGE = 3;/);
  assert.match(day, /\{ width: '0%', minWidth: 0, opacity: 0, scale: 0\.94 \}/, '대기 칸은 너비 0');
  assert.match(day, /key=\{dateStr\}/);
  assert.match(day, /const ACTIVE_CONTENT_WIDTH = 'calc\(60cqw - 10px\)';/, '포커스 카드 내용은 최종 너비로 고정한다');
  assert.match(day, /containerType: 'inline-size'/);
  const css = read('src/index.css');
  assert.match(css, /\.calendar-day-col \{\s*transition:\s*width 0\.4s/);
});

test('넘김 강조와 카드 호버는 CSS 트랜지션이고 동작 줄이기·연타에서는 끈다', () => {
  const css = read('src/index.css');
  assert.match(css, /\.calendar-scroll-row \{[\s\S]*?transition:[\s\S]*?opacity 0\.38s[\s\S]*?transform 0\.38s/);
  // 연타 모드는 트랜지션만 끈다. animation 을 none 으로 껐다 되돌리면 이름이 바뀐 것으로 보고
  // 이미 떠 있던 줄마다 등장 애니메이션이 다시 돌아, 연타가 끝나는 순간 묶음 전체가 한 번 깜빡인다.
  const instantRule = css.match(/\.calendar-scroll-rows--instant \.calendar-scroll-row,\s*\.calendar-scroll-rows--instant \.calendar-day-col \{([^}]*)\}/);
  assert.ok(instantRule, '연타 규칙을 찾지 못했다');
  assert.match(instantRule[1], /transition: none;/);
  assert.doesNotMatch(instantRule[1], /animation/, '연타 규칙에서 animation 을 바꾸면 끝날 때 깜빡인다');
  const baseRow = css.match(/\.calendar-scroll-row \{([^}]*)\}/);
  assert.ok(baseRow && !/animation/.test(baseRow[1]), '주간 줄 등장은 CSS 가 아니라 넘김 때 새로 생긴 줄에만(useStackFlip)');
  assert.match(css, /\.calendar-day-col > \.calendar-scroll-row \{\s*animation: calendarScrollRowIn/);
  const flip = read('src/hooks/useStackFlip.ts');
  assert.match(flip, /if \(before\.rows\.has\(id\) \|\| !row\.element/, '넘김 때 새로 들어온 줄만 떠오르게 한다');
  // 일간 보기도 연타(←→ 누르고 있기) 중에는 칸 너비를 바로 바꾼다.
  const view = read('src/views/ScheduleView.tsx');
  assert.match(view, /reduceMotion=\{reduce\}\n\s*instantTransition=\{skipPeriodTransition\}\n\s*\/>\n\s*\) : viewMode === 'week' && weekSubMode === 'timegrid'/);
  assert.match(read('src/components/calendar/DayScrollView.tsx'), /reduceMotion \|\| instantTransition \? ' calendar-scroll-rows--instant' : ''/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.calendar-scroll-row,\s*\.calendar-day-col,\s*\.calendar-event-card \{/);
  const week = read('src/components/calendar/WeekScrollView.tsx');
  const day = read('src/components/calendar/DayScrollView.tsx');
  for (const [name, source] of [['주간', week], ['일간', day]] as const) {
    assert.doesNotMatch(source, /whileHover/, `${name} 카드마다 framer 컴포넌트를 만들지 않는다`);
    assert.match(source, /calendar-event-card flex items-center gap-2 cursor-pointer/, `${name} 카드 호버는 CSS`);
  }
});

test('사이드바는 활성 줄만 다시 그리고, 바깥 화면을 끌고 가지 않고 목록만 스크롤한다', () => {
  for (const file of ['src/components/calendar/WeekSidebar.tsx', 'src/components/calendar/DaySidebar.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /scrollIntoView\(/, `${file}: scrollIntoView 는 overflow:hidden 바깥 상자까지 움직인다`);
    assert.match(source, /scrollIntoNearestScroller\(activeEl,/);
    assert.match(source, /= memo\(function /, `${file}: 항목은 memo 로 감싼다`);
    assert.doesNotMatch(source, /motion\.button/, `${file}: 항목마다 framer 컴포넌트를 만들지 않는다`);
  }
});
