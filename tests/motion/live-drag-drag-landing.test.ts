import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BORN_KEEP_MS,
  BORN_MS,
  BORN_RING_MS,
  DRAG_SLIDE_MS,
  GHOST_LEAVE_MS,
  LAND_CLEAR_MS,
  LAND_MS,
  LAND_RING_MS,
  LAND_SCALE,
  clearLandingIf,
  dragSlideOffset,
  landingKeyframes,
  parseTranslate,
  residualOffset,
  type SlideBox,
} from '../../src/utils/dragLanding.ts';
import { EASE_CSS, MOTION_MS } from '../../src/utils/motion.ts';

/* 움직임 폴리싱 16번 — 끌어서 옮기는 모든 곳에 '잡았다 → 옮긴다 → 놓았다' 세 박자
   (캘린더 월 막대·주 시간표 블록·+ 로 만들기, 대시보드 위젯, 타임라인 막대). */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sliceBetween = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} 를 찾지 못했다`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `${start} 뒤에서 ${end} 를 찾지 못했다`);
  return source.slice(from, to);
};
const box = (left: number, top: number, width: number, height = 26): SlideBox => ({ left, top, width, height });

/* ─── 옮긴다: 칸을 넘을 때 미끄러지는 거리 ─────────────────────────── */

test('미끄러짐: 같은 자리면 없음, 칸을 옮기면 이전 자리까지의 거리', () => {
  assert.equal(dragSlideOffset(box(100, 40, 180), box(100, 40, 180)), null);
  assert.equal(dragSlideOffset(box(100, 40, 180), box(100.3, 40.2, 180)), null, '0.5px 미만 떨림은 무시한다');
  assert.deepEqual(dragSlideOffset(box(100, 40, 180), box(285, 40, 180)), { dx: -185, dy: 0 }, '오른쪽 한 칸');
  assert.deepEqual(dragSlideOffset(box(285, 40, 180), box(285, 168, 180)), { dx: 0, dy: -128 }, '아래 주로');
  assert.deepEqual(dragSlideOffset(box(470, 40, 180), box(100, 68, 180)), { dx: 370, dy: -28 }, '왼쪽 두 칸 + 다른 줄');
});

test('미끄러짐: 늘이기는 미끄러지지 않고 바로 맞춘다(오른쪽·왼쪽 모두)', () => {
  // 오른쪽 끝을 늘이면 왼쪽 위 모서리가 그대로다.
  assert.equal(dragSlideOffset(box(100, 40, 180), box(100, 40, 365)), null);
  // 왼쪽 끝을 늘이면 오른쪽 아래 모서리가 그대로다 — 왼쪽 기준으로 미끄러지면 막대가 옆으로 밀려 보인다.
  assert.equal(dragSlideOffset(box(285, 40, 180), box(100, 40, 365)), null);
  // 시간표 블록 아래 끝 늘이기(높이만 바뀜)
  assert.equal(dragSlideOffset(box(10, 100, 90, 56), box(10, 100, 90, 84)), null);
});

test('미끄러짐: 크기가 바뀌어도 어느 모서리도 그대로가 아니면 왼쪽 위 모서리 기준으로 미끄러진다', () => {
  assert.deepEqual(dragSlideOffset(box(100, 40, 180), box(300, 60, 90)), { dx: -200, dy: -20 });
  // 주 끝에 걸려 잘린 조각(오른쪽 끝이 주 경계에 그대로)은 늘이기와 구분되지 않아 바로 맞춘다.
  assert.equal(dragSlideOffset(box(650, 40, 550), box(835, 40, 365)), null);
});

test('미끄러지는 중에 또 칸을 넘으면 지금 보이는 자리(남은 translate)에서 다시 출발한다', () => {
  assert.deepEqual(parseTranslate('none'), { x: 0, y: 0 });
  assert.deepEqual(parseTranslate(''), { x: 0, y: 0 });
  assert.deepEqual(parseTranslate(undefined), { x: 0, y: 0 });
  assert.deepEqual(parseTranslate('12.5px 4px'), { x: 12.5, y: 4 });
  assert.deepEqual(parseTranslate('-71px'), { x: -71, y: 0 });
  assert.deepEqual(parseTranslate('abc def'), { x: 0, y: 0 });
});

test('미끄러짐은 바탕 A 의 빠름(120ms)', () => {
  assert.equal(DRAG_SLIDE_MS, MOTION_MS.fast);
});

/* ─── 놓았다: 착지 '톡' ────────────────────────────────────────────── */

test("착지 '톡': 1 → 1.03 → 1, 개별 scale 속성만(호버 transform·rotate 와 섞이지 않는다)", () => {
  const frames = landingKeyframes(EASE_CSS.out, EASE_CSS.spring);
  assert.equal(LAND_SCALE, 1.03);
  assert.deepEqual(frames.map((frame) => frame.scale), ['1', '1.03', '1']);
  assert.equal(frames[1].offset, 0.3);
  assert.equal(frames[0].easing, EASE_CSS.out, '올라갈 때는 빠르게 출발');
  assert.equal(frames[1].easing, EASE_CSS.spring, '내려앉을 때 살짝 넘쳤다 돌아온다');
  for (const frame of frames) {
    assert.equal('transform' in frame, false, 'transform 을 쓰면 호버 확대·framer transform 을 덮는다');
  }
  assert.equal(LAND_MS, 420);
  assert.ok(LAND_CLEAR_MS > Math.max(LAND_MS, LAND_RING_MS), '표시를 거두기 전에 톡·링이 끝나야 한다');
});

test('착지 표시는 순번이 같을 때만 거둔다 — 그 사이 다시 놓은 착지는 남긴다', () => {
  assert.equal(clearLandingIf({ key: 'a', seq: 3 }, 3), null);
  assert.deepEqual(clearLandingIf({ key: 'a', seq: 4 }, 3), { key: 'a', seq: 4 });
  assert.equal(clearLandingIf(null, 1), null);
});

/* ─── 타임라인: 손을 그대로 따라오는 막대 ───────────────────────────── */

test('타임라인: 스냅된 자리 + 나머지 거리 = 손이 움직인 거리(하루를 넘는 순간에도 튀지 않는다)', () => {
  const day = 48;
  for (const dx of [-130, -24, -1, 0, 5, 23.9, 24.1, 47, 96, 333]) {
    const snapped = Math.round(dx / day);
    // 다시 그려지기 전(이전 스냅)과 다시 그려진 뒤(새 스냅) 모두 보이는 자리는 dx 그대로다.
    for (const rendered of [snapped - 1, snapped, snapped + 1]) {
      assert.ok(Math.abs(rendered * day + residualOffset(dx, rendered, day) - dx) < 1e-9);
    }
  }
  assert.equal(residualOffset(30, 1, 48), -18);
});

/* ─── CSS 박자: 상수와 CSS 가 같은 값을 쓴다 ─────────────────────────── */

const laneCss = read('src/styles/motion-live-drag.css');
const section16 = laneCss.slice(laneCss.lastIndexOf('/*', laneCss.indexOf('16. 끌어서 옮기기')));

test('CSS 박자 = 상수(링 450ms·새 막대 320ms·빛 링 600ms·유리 막대 녹기 150ms)', () => {
  assert.match(section16, new RegExp(`animation: bf-land-ring ${LAND_RING_MS}ms`));
  assert.match(section16, new RegExp(`animation: bf-born-ring ${BORN_RING_MS}ms`));
  assert.match(section16, new RegExp(`animation: bf-bar-born ${BORN_MS}ms`));
  assert.match(section16, new RegExp(`\\.calendar-drag-ghost-layer \\{\\s*transition: opacity ${GHOST_LEAVE_MS}ms`));
  assert.match(section16, /@keyframes bf-land-ring \{\s*from \{ opacity: 0\.9; \}\s*to \{ opacity: 0; \}/);
  assert.match(section16, /@keyframes bf-born-ring \{\s*from \{ opacity: 0\.8; \}/);
  assert.match(section16, /@keyframes bf-bar-born \{\s*from \{ opacity: 0; scale: 0\.96; \}/);
  assert.ok(BORN_KEEP_MS > BORN_RING_MS, '빛 링이 끝나기 전에 새 일정 표시를 거두면 링이 잘린다');
});

test('16번 CSS: 반복 요소에 흐림·레이아웃 속성 전환·animation:none 토글이 없다', () => {
  const css = stripComments(section16);
  assert.doesNotMatch(css, /backdrop-filter/, '움직이는 막대·위젯·쓰레기통에 흐림 금지');
  assert.doesNotMatch(css, /transition:[^;]*\b(left|top|width|height|box-shadow|background)\b/, '레이아웃·그림자·배경 전환 금지');
  assert.doesNotMatch(css, /animation:\s*none/, '연타용 클래스로 animation 을 껐다 켜지 않는다(끝날 때 깜빡임)');
  assert.doesNotMatch(css, /infinite/, '무한 반복 장식 금지');
  // 들림은 개별 scale, 그림자는 미리 그린 층의 opacity
  assert.match(css, /\.calendar-bar-lifted \{\s*scale: 1\.02;/);
  assert.match(css, /\.time-grid-block\.time-grid-lifted \{[^}]*scale: 1\.02;/);
  assert.match(css, /\[data-lifted\] > \.widget-lift \{\s*transform: scale\(1\.02\);/);
  assert.match(css, /\[data-doomed\] > \.widget-lift \{\s*transform: scale\(0\.92\);\s*opacity: 0\.7;/);
  assert.match(css, /\.widget-lift-shadow \{[^}]*box-shadow: 0 28px 56px rgb\(0 0 0 \/ 0\.45\);[^}]*opacity: 0;/);
  assert.match(css, /\.widget-dim \{[^}]*background: rgb\(var\(--color-bg-primary\) \/ 0\.55\);[^}]*transition: opacity 200ms/);
  assert.match(css, /\.dashboard-trash\.is-hot \{\s*transform: scale\(1\.08\);/);
});

test('동작 줄이기: 들림·톡·쓰레기통 커짐은 빠지고 테두리 링만 보인다', () => {
  const reduce = section16.slice(section16.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /\.bf-land-ring \{\s*animation-duration: 450ms !important;/, '전역 0.01ms 규칙이 링까지 지운다');
  assert.match(reduce, /\.bf-land-ring\.is-born \{\s*animation-duration: 600ms !important;/);
  assert.match(reduce, /\.widget-land-ring \{\s*animation-duration: 450ms !important;/);
  assert.match(reduce, /\.calendar-bar-lifted,\s*\.time-grid-block\.time-grid-lifted \{\s*scale: none;/);
  assert.match(reduce, /\[data-lifted\] > \.widget-lift,\s*\[data-doomed\] > \.widget-lift,\s*\.dashboard-trash\.is-hot \{\s*transform: none;/);

  // WAAPI 는 CSS 미디어쿼리로 막히지 않는다 — 미끄러짐은 reduce 를 받아 직접 건너뛰고, 톡은 animateEl(기본: OS 설정)로.
  const landing = read('src/components/ui/DragLanding.tsx');
  assert.match(landing, /if \(!prev \|\| reduce \|\|/);
  assert.match(landing, /animateEl\(\s*ref\.current\?\.parentElement,\s*landingKeyframes/);

  const widgets = read('src/styles/widget-animations.css');
  assert.match(widgets, /@media \(prefers-reduced-motion: reduce\) \{\s*\.react-grid-item,\s*\.react-grid-item\.widget-settling \{\s*transition: none !important;/,
    '!important 전환은 전역 동작 줄이기 규칙보다 특이도가 높아 따로 꺼야 한다');
});

/* ─── 캘린더 월 보기 ──────────────────────────────────────────────── */

test('월 보기: 칸(col)을 key 에서 빼 끄는 막대가 순간이동 대신 미끄러진다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.doesNotMatch(grid, /-c\$\{bar\.startCol\}/, '칸을 key 에 넣으면 칸을 넘을 때마다 새로 붙는다');
  // 막대 key 는 일정 키(방금 만든 일정은 저장 뒤에도 낙관적 키 — fx-misc acc-live-drag-view-4)와 주 번호뿐
  assert.match(grid, /key=\{`\$\{barKey\}-w\$\{wi\}`\}/);
  assert.doesNotMatch(grid, /left 0\.12s|width 0\.12s|top 0\.12s/, 'left·width 전환은 매 프레임 레이아웃');
  assert.doesNotMatch(grid, /isGhost/, '끄는 막대를 흐린 점선(opacity .5)으로 바꾸지 않는다 — 진하게 들린다');
  assert.match(grid, /<DragSlideAnchor slideKey=\{slideKey\} registry=\{slideRegistry\}/);
  assert.match(grid, /\{landingToken != null && <DropLanding key=\{`land-\$\{landingToken\}`\}/, '같은 막대를 또 놓으면 key 로 다시 튼다');
  assert.match(grid, /<EventBarOrigin key=/, '원래 자리 흐린 점선 흔적');
  // 원래 자리는 끌기가 시작될 때의 events(미리보기 전)로 배치한다.
  assert.match(grid, /layoutEventBars\(events, week\)\s*\.filter\(\(bar\) => bar\.row < maxVisibleBars && isDraggedEvent\(bar\.event\)\)/);
});

test('월 보기: 놓는 즉시(저장 전) 착지, 저장에 실패하면 착지를 거둔다', () => {
  const view = read('src/views/ScheduleView.tsx');
  const handler = sliceBetween(view, 'const handleEventDragDone = useCallback(', 'const handleTimeGridEventChange');
  const start = handler.indexOf('startDropLanding(mutationIdentity)');
  const save = handler.indexOf('await updateEvent(');
  const recurrence = handler.indexOf('setPendingPosition(request)');
  assert.ok(start > 0 && save > 0, '착지 시작·저장 호출을 찾지 못했다');
  assert.ok(start < save, '저장을 기다린 뒤에 착지하면 반짝임이 늦게 나온다');
  assert.ok(recurrence < start, '반복 일정은 범위를 고르기 전까지 막대가 원래 자리에 있다 — 그 전에 착지하지 않는다');
  const failure = handler.slice(handler.indexOf('} catch (error) {'));
  assert.match(failure, /cancelDropLanding\(landingSeq\)/);
  assert.match(view, /landing=\{dropLanding\}/);
});

test("'만들기': 저장을 기다리지 않고 유리 막대는 녹고 진짜 막대는 굳어진다", () => {
  const view = read('src/views/ScheduleView.tsx');
  const handler = sliceBetween(view, 'const handleAddEvent = useCallback(', 'const handleDeleteEvent');
  const born = handler.indexOf('markEventBorn(optimisticIdentity)');
  const leaving = handler.indexOf('setCreateGhostLeaving(true)');
  const save = handler.indexOf('await addEvent(');
  assert.ok(born > 0 && leaving > 0 && born < save && leaving < save);
  assert.match(handler.slice(handler.indexOf('} finally {')), /setCreateGhostLeaving\(false\)/, '실패해 창이 남으면 유리 막대도 다시 보여야 한다');

  const ghost = read('src/components/calendar/DragCreateGhost.tsx');
  assert.match(ghost, /\$\{leaving \? ' is-leaving' : ''\}/);
  // + 버튼 함정(v1.127.0): 고스트 key 는 구간 순서, 끄는 중 표시는 is-dragging 그대로.
  assert.match(ghost, /key=\{i\}/);
  assert.match(ghost, /dragging \? ' is-dragging' : ''/);

  const index = stripComments(read('src/index.css'));
  const ghostRule = index.slice(index.indexOf('.calendar-drag-ghost {'), index.indexOf('}', index.indexOf('.calendar-drag-ghost {')));
  assert.doesNotMatch(ghostRule, /backdrop-filter/, '늘어날 때마다 GPU 가 흐림을 다시 그린다');
});

/* ─── 주 시간표 ───────────────────────────────────────────────────── */

test('시간표: 요일을 넘어도 투명에서 다시 떠오르지 않고, 들림·착지는 framer 밖에서', () => {
  const view = read('src/components/calendar/WeekTimeGridView.tsx');
  assert.match(view, /initial=\{reduce \|\| isPreviewed \|\| isSettling \? false : \{ opacity: 0, y: 4 \}\}/);
  assert.doesNotMatch(view, /time-grid-settling/, '저장 뒤에야 도는 테두리 반짝임(box-shadow 키프레임)은 없앤다');
  assert.doesNotMatch(view, /scale: reduce \? 1 : \(isMoving \? 1\.02 : 1\)/, 'framer 개별 scale 은 메인 스레드');
  assert.match(view, /time-grid-block \$\{isMoving \? 'shadow-xl time-grid-lifted' : ''\}/);
  assert.match(view, /<DropLanding key=\{`land-\$\{settleToken\}`\}/);
  assert.match(view, /data-drag-slide-frame=""/, '자동 스크롤과 위치 변화를 구분할 스크롤 상자 표시');
  assert.doesNotMatch(read('src/index.css'), /timeGridSettleFlash/);
});

test('시간표: 착지는 놓는 즉시, 저장이 거부되면 거둔다', () => {
  const hook = read('src/hooks/useTimeGridDnD.ts');
  const finish = sliceBetween(hook, "} else if (onEventChangeRef.current) {", 'if (state?.hasCrossedThreshold) finishedAtRef.current');
  const settle = finish.indexOf('setSettle({ key, seq })');
  const call = finish.indexOf('onEventChangeRef.current(completion.eventId');
  assert.ok(settle > 0 && call > 0 && settle < call, '저장 결과(then) 뒤에 착지하면 반짝임이 저장만큼 늦다');
  assert.doesNotMatch(finish.slice(finish.indexOf('.then(')), /setSettle\(\{/, '저장 성공은 착지를 다시 틀지 않는다');
  assert.equal((finish.match(/abandonSettle\(\);/g) ?? []).length, 2, '비동기 거부·동기 예외 모두 착지를 거둔다');
});

/* ─── 대시보드 위젯 ───────────────────────────────────────────────── */

test('대시보드: 나머지 위젯은 흐림 없이 어둡게, 늘 그려 두고 opacity 만', () => {
  const dash = read('src/views/Dashboard.tsx');
  assert.doesNotMatch(dash, /blur\(2px\)/, '나머지 위젯 10여 개에 흐림을 걸면 느린 PC 에서 버벅인다');
  assert.doesNotMatch(dash, /blur\(16px\)/, '쓰레기통 흐림 제거');
  assert.doesNotMatch(dash, /glowPulse/, '잡은 위젯 테두리 깜빡임 제거');
  assert.match(dash, /<div className="widget-dim" aria-hidden="true" \/>/);
  assert.match(dash, /data-lifted=\{isDrag \? 'true' : undefined\}/);
  assert.match(dash, /data-doomed=\{isDrag && trashHover \? 'true' : undefined\}/);
  assert.match(dash, /\{settle && <div key=\{settle\.seq\} className="widget-land-ring"/);
  // 쓰레기통: framer scale 과 인라인 transform 전환의 이중 구동 → 등장은 transform 문자열 프리셋, 커짐은 CSS 하나.
  assert.match(dash, /transformPreset\(\{ from: 'translateY\(20px\) scale\(0\.8\)', duration: 200 \}, reduce\)/);
  assert.doesNotMatch(dash, /scale: trashHover \? 1\.08 : 1/);
  assert.match(dash, /draggableCancel="button, a, input, select, textarea"/);
  // 쓰레기통에 놓으면 즉시 사라지고 안착 표시는 없다.
  assert.match(dash, /if \(!dropped && moved\) startSettle\(oldItem\.i, 'drag'\);/);
});

test('대시보드: 안착은 transform 만 튕기고, 크기 조절은 언제나 바로 맞춘다', () => {
  const css = stripComments(read('src/styles/widget-animations.css'));
  assert.doesNotMatch(css, /transition:\s*all/, "'all' 이면 크기 조절을 놓을 때 폭·높이까지 출렁인다");
  assert.match(css, /\.react-grid-item\.widget-settling \{\s*transition: transform 0\.45s cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
  assert.match(css, /\.react-grid-item\.widget-settling\.is-resize \{\s*transition: none !important;/);
  assert.match(css, /\.react-draggable-dragging \{[^}]*opacity: 1 !important;/, '잡은 위젯은 진하게(.95 X)');
  assert.doesNotMatch(css, /\.react-grid-item \{[^}]*box-shadow/);
  const widget = stripComments(read('src/components/widgets/Widget.tsx'));
  assert.doesNotMatch(widget, /transition-all/, '크기 조절 중 폭·높이·그림자까지 따라 움직인다');
});

/* ─── 타임라인 ────────────────────────────────────────────────────── */

test('타임라인: 날짜(스냅)가 바뀔 때만 다시 그리고, 그 사이는 막대 자리 transform 만 고친다', () => {
  const canvas = read('src/features/gantt/GanttCanvas.tsx');
  const move = sliceBetween(canvas, 'function moveDrag(', 'function endDrag(');
  assert.match(move, /changed=first\|\|delta!==d\.delta/);
  assert.match(move, /if\(changed\)setDrag\(/, '같은 날짜 안의 움직임마다 차트 전체를 다시 그리지 않는다');
  assert.match(move, /if\(changed\)setCreating\(/);
  assert.match(move, /position\.style\.transform=`translateX\(\$\{residualOffset\(dx,renderedDelta\.current,widthRef\.current\)\}px\)`/);
  // 양끝 늘이기·그룹 이동은 하루 스냅 유지(진행률 막대를 scaleX 로 찌그러뜨리지 않는다).
  assert.match(canvas, /const followsPointer = \(gesture: Gesture\): boolean => gesture\.kind === 'edit' && !gesture\.edge && gesture\.row\.task\?\.kind !== 'group';/);
  assert.doesNotMatch(canvas, /scaleX/);
  // 취소는 원래 자리로 바로, 놓으면 FLIP 120ms + 실제로 놓였을 때만 착지.
  assert.match(canvas, /if \(gesture\.kind === 'edit'\) \{ const position = barPositionOf\(gesture\); if \(position\) position\.style\.transform = ''; \}/);
  assert.match(canvas, /animateEl\(drop\.el, \[\{ translate: `\$\{dx\}px 0px` \}, \{ translate: '0px 0px' \}\], \{ duration: DRAG_SLIDE_MS/);
  assert.match(canvas, /if \(Math\.abs\(moved\) < 1 && Math\.abs\(drop\.el\.offsetWidth - drop\.width\) < 1\) \{/);
  assert.match(canvas, /\{landing\?\.id===r\.id&&<DropLanding key=\{`land-\$\{landing\.seq\}`\}/);
  assert.match(canvas, /className="gantt-drop-slot"/);
  assert.match(canvas, /className="gantt-origin-trace"/);
});

test('미끄러짐 앵커는 떼어질 때 애니메이션을 취소하지 않는다(개발 모드 가짜 떼었다 붙이기에서 순간이동)', () => {
  const landing = stripComments(read('src/components/ui/DragLanding.tsx'));
  const anchor = sliceBetween(landing, 'export function DragSlideAnchor(', 'export function DropLanding(');
  assert.doesNotMatch(anchor, /useLayoutEffect\(\(\) => \(\) =>/);
  assert.match(anchor, /registry\.set\(slideKey, next\);/);
});
