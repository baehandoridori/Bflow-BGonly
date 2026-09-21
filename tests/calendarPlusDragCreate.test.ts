// tests/calendarPlusDragCreate.test.ts
// 날짜 칸의 + 버튼에서 끌어 범위를 잡는 생성 인터랙션.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toDragRuns } from '../src/utils/calendarDragRuns.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ─── 이어진 구간 묶기 ─────────────────────────────── */

test('선택된 칸을 이어진 구간 하나로 묶는다', () => {
  assert.deepEqual(toDragRuns([false, false, true, true, true, false, false]), [{ col: 3, span: 3 }]);
  assert.deepEqual(toDragRuns([true, true, true, true, true, true, true]), [{ col: 1, span: 7 }]);
  assert.deepEqual(toDragRuns([false, false, false]), []);
  assert.deepEqual(toDragRuns([]), []);
});

test('끊긴 구간은 따로 묶는다 — 한 덩어리로 이어 붙이면 안 된다', () => {
  assert.deepEqual(
    toDragRuns([true, false, true, true, false, false, true]),
    [{ col: 1, span: 1 }, { col: 3, span: 2 }, { col: 7, span: 1 }],
  );
});

test('양 끝 한 칸씩도 각각 한 덩어리', () => {
  assert.deepEqual(toDragRuns([true, false, false, false, false, false, true]), [{ col: 1, span: 1 }, { col: 7, span: 1 }]);
  assert.deepEqual(toDragRuns([false, false, false, true]), [{ col: 4, span: 1 }]);
});

test('반환한 구간은 서로 겹치지 않고 선택 개수와 합이 같다', () => {
  const cases = [
    [true, true, false, true, true, true, false],
    [false, true, false, true, false, true, false],
    [true, true, true, true, true, false, true],
  ];
  for (const sel of cases) {
    const runs = toDragRuns(sel);
    assert.equal(runs.reduce((n, r) => n + r.span, 0), sel.filter(Boolean).length, '칸 수가 맞아야 한다');
    for (let i = 1; i < runs.length; i++) {
      assert.ok(runs[i].col > runs[i - 1].col + runs[i - 1].span, '구간이 겹치거나 맞닿으면 안 된다');
    }
  }
});

/* ─── 배선 ────────────────────────────────────────── */

test('생성 시작점이 칸 전체가 아니라 + 버튼으로 좁혀졌다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /<DayAddButton/, '날짜 칸에 추가 버튼이 없다');
  assert.match(grid, /onStart=\{onCellMouseDown\}/, '+ 버튼이 드래그 생성 훅에 연결되지 않았다');
  assert.doesNotMatch(
    grid,
    /onMouseDown=\{onCellMouseDown \? \(e\) => onCellMouseDown\(e, dateStr\) : undefined\}/,
    '칸 전체를 눌러도 생성되면 + 버튼을 둔 의미가 없다',
  );
  // 칸 전체가 '누르면 생긴다'는 커서를 주면 안 된다.
  assert.doesNotMatch(grid, /transition-colors duration-100 cursor-pointer relative overflow-hidden/);
});

test('+ 버튼은 거리 기반으로 드러나고 키보드로도 실제로 만들 수 있다', () => {
  const btn = read('src/components/calendar/DayAddButton.tsx');
  assert.match(btn, /data-proximity-reveal/, '근접 노출 대상 표시가 없다');
  assert.match(btn, /type="button"/);
  assert.match(btn, /aria-label=/, '스크린리더가 어느 날짜인지 알 수 없다');
  // 근접도가 0 이어도 DOM 에 남겨야 탭으로 닿고 깜빡이지 않는다.
  assert.doesNotMatch(btn, /\{\s*reveal\s*>\s*0\s*&&/);
  // 키보드 활성화는 mousedown 없이 click 만 온다(detail 0). 탭으로 닿기만 하고
  // 눌러도 아무 일이 없으면 죽은 정지점만 35~42개 생긴다.
  assert.match(btn, /e\.detail === 0/, '키보드로 눌렀을 때 아무 일도 안 일어난다');
  assert.match(btn, /onActivate\?\.\(date\)/, '키보드 활성화가 그 날짜로 연결되지 않았다');
  // mousedown 에서 전파를 막으면 document 에 걸린 바깥클릭 닫기(퀵에디트·태그 팝오버·레일 메뉴)가
  // 통째로 죽는다. 주석에 단어가 들어 있어도 걸리지 않게 핸들러 본문의 '호출'만 본다.
  const downStart = btn.indexOf('onMouseDown={');
  const downEnd = btn.indexOf('onClick={');
  assert.ok(downStart > -1 && downEnd > downStart, 'mousedown 핸들러를 찾지 못했다');
  assert.doesNotMatch(
    btn.slice(downStart, downEnd),
    /^\s*e\.stopPropagation\(\);/m,
    'mousedown 을 막으면 퀵에디트·태그 팝오버·레일 메뉴가 닫히지 않는다',
  );

  const css = read('src/index.css');
  assert.match(css, /\.calendar-day-add\s*\{[\s\S]*?--reveal: 0;/, '기본 노출값이 없다');
  assert.match(css, /opacity: var\(--reveal\)/);
  assert.match(css, /\.calendar-day-add:focus-visible[\s\S]*?opacity: 1/, '초점은 근접도와 무관하게 보여야 한다');

  const hook = read('src/hooks/useProximityReveal.ts');
  assert.match(hook, /window\.addEventListener\('pointermove'/, '컨테이너에 걸면 월 전환 때 리스너가 끊긴다');
  assert.match(hook, /requestAnimationFrame/, '포인터마다 계산하면 과하다');
  assert.match(hook, /setProperty\('--reveal'/);
});

test('고스트는 이어진 구간마다 요소 하나 — 칸마다 그리지 않는다', () => {
  const ghost = read('src/components/calendar/DragCreateGhost.tsx');
  assert.match(ghost, /toDragRuns\(selected\)/);
  assert.match(ghost, /gridColumn: `\$\{run\.col\} \/ span \$\{run\.span\}`/, '한 덩어리로 걸쳐야 이음새가 없다');
  // 폭이 바뀔 때만 FLIP 으로 늘어나는 느낌을 준다.
  assert.match(ghost, /scaleX\(\$\{before \/ width\}\)/, 'FLIP 이 폭 변화를 되돌리지 않는다');
  assert.match(ghost, /useLayoutEffect/, '그려진 뒤 측정하면 한 프레임 늦는다');
});

test('고스트 범위는 한 소스에서 나오고 날짜 이동과 완전히 분리된다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /createRange\?: \{ startDate: string; endDate: string; days: number; dragging: boolean \} \| null;/);
  assert.match(grid, /totalDays=\{createRange\.days\}/, '라벨 일수가 화면 칸 수에서 나오면 주말 숨김에서 어긋난다');

  const view = read('src/views/ScheduleView.tsx');
  assert.match(view, /const createRange = useMemo/);
  assert.match(view, /createRange=\{createRange\}/);
  // persistedDateRange 는 날짜 이동 펄스에도 쓰인다 — 여기 섞이면 이동만 해도 고스트가 뜬다.
  const start = view.indexOf('const createRange = useMemo');
  const fn = view.slice(start, start + 900);
  assert.doesNotMatch(fn, /persistedDateRange/, '날짜 이동 펄스가 고스트로 그려진다');
  assert.doesNotMatch(fn, /pulseDate/);
  assert.match(fn, /dragState\.isDragging/, '드래그 상태를 직접 봐야 한다');
});

test('동작 줄이기에서는 늘어나는 애니메이션도 멈춘다', () => {
  const ghost = read('src/components/calendar/DragCreateGhost.tsx');
  // el.animate 는 CSS 미디어쿼리로 막히지 않는다 — 직접 건너뛰어야 한다.
  assert.match(ghost, /if \(reduceMotion \|\|/, 'FLIP 이 모션 줄이기에서도 돈다');
  assert.match(ghost, /reduceMotion=\{reduceMotion\}/);
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /reduceMotion=\{reduceMotion\}/);
});

test('표면 반사는 끄는 중에만 돈다', () => {
  const css = read('src/index.css');
  assert.match(css, /\.is-dragging \.calendar-drag-ghost::before/, '생성 폼을 채우는 내내 합성이 돈다');
  const ghost = read('src/components/calendar/DragCreateGhost.tsx');
  assert.match(ghost, /dragging \? ' is-dragging' : ''/);
});

test('라이트 모드에서도 + 버튼이 보인다', () => {
  const css = read('src/index.css');
  assert.match(css, /\[data-color-mode="light"\] \.calendar-day-add/, '흰색 하드코딩이라 밝은 배경에서 묻힌다');
});

test('달을 넘기면 + 노출을 다시 계산한다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  // 휠·키보드로 달을 넘기면 pointermove 가 없어 새 달 버튼이 0 으로 굳는다.
  assert.match(grid, /useEffect\(\(\) => \{ refreshReveal\(\); \}, \[visibleWeeks, createRange, refreshReveal\]\);/);
});

test('고스트 key 는 위치가 아니라 구간 순서 — 왼쪽으로 끌어도 늘어난다', () => {
  const ghost = read('src/components/calendar/DragCreateGhost.tsx');
  assert.match(ghost, /key=\{i\}/, 'col 을 key 로 쓰면 왼쪽 확장마다 요소가 갈려 FLIP 이 죽는다');
  assert.doesNotMatch(ghost, /key=\{`\$\{run\.col\}`\}/);
});

test('빈 달 안내문이 실제 시작점을 가리킨다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /날짜 옆 \+ 버튼을 눌러 새 일정을 만들어 보세요/);
  assert.doesNotMatch(grid, /날짜를 눌러 새 일정을 만들어 보세요/, '이제 칸을 눌러도 만들어지지 않는다');
});

test('놓으면 기존 사이드 패널이 잡은 범위로 열린다 (경로 변경 없음)', () => {
  const view = read('src/views/ScheduleView.tsx');
  assert.match(view, /onDragComplete: \(startDate, endDate/, '드래그 완료 경로가 바뀌었다');
  assert.match(view, /setCreateDate\(startDate\);/);
  assert.match(view, /setCreateEndDate\(endDate\);/);
  assert.match(view, /setShowCreate\(true\);/);
  assert.match(view, /initialDate=\{createDate\}/);
  assert.match(view, /initialEndDate=\{createEndDate\}/);
});
