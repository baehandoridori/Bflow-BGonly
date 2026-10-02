// 움직임 폴리싱 2번 — 설명 말풍선이 가리킨 것을 덮지 않고 그 위에 딱 붙어 뜨게 (tooltip-anchor)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  barTooltipAnchor,
  createTooltipWarmth,
  placeAnchoredTooltip,
  placeFollowTooltip,
  rectsOverlap,
  tooltipTransform,
  TOOLTIP_EDGE,
  TOOLTIP_WARM_MS,
} from '../../src/utils/tooltipPosition.ts';
import { createHoverKeyStore } from '../../src/utils/hoverKeyStore.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const VIEW = { width: 1600, height: 900 };
const boxOf = (p: { left: number; top: number }, size: { width: number; height: number }) => ({
  left: p.left, top: p.top, right: p.left + size.width, bottom: p.top + size.height,
});

/* ─── 자리 잡기 ─────────────────────────────────────────────── */

test('막대 말풍선은 막대 위 가운데에 6px 띄워 놓이고 막대를 덮지 않는다', () => {
  const bar = { left: 400, right: 580, top: 300, bottom: 326 };
  const size = { width: 120, height: 60 };
  const p = placeAnchoredTooltip(barTooltipAnchor(bar, 420), size, VIEW, { gapAbove: 6 });
  assert.equal(p.below, false);
  assert.equal(p.top + size.height, bar.top - 6, '막대 위 6px');
  assert.equal(p.left + size.width / 2, (bar.left + bar.right) / 2, '막대 가운데');
  assert.equal(rectsOverlap(boxOf(p, size), bar), false);
});

test('화면 위쪽에서는 대상 아래로 내려가고, 아래로도 자리가 없으면 더 넓은 쪽', () => {
  const size = { width: 100, height: 80 };
  const nearTop = placeAnchoredTooltip({ x: 500, top: 40, bottom: 66 }, size, VIEW, { gapAbove: 6 });
  assert.equal(nearTop.below, true);
  assert.equal(nearTop.top, 72, '대상 아래 끝 + 6px');
  // 위·아래 모두 모자라면 더 넓은 쪽에 두고 화면 안으로 밀어 넣는다.
  const tight = placeAnchoredTooltip({ x: 500, top: 60, bottom: 840 }, { width: 100, height: 200 }, VIEW);
  assert.ok(tight.top >= TOOLTIP_EDGE && tight.top + 200 <= VIEW.height - TOOLTIP_EDGE);
});

test('화면 가장자리 8px 안쪽으로 밀어 넣고, 폭은 줄이지 않는다(오른쪽 끝에서 글자가 접히지 않게)', () => {
  const size = { width: 300, height: 30 };
  const right = placeFollowTooltip({ x: VIEW.width - 4, y: 400 }, size, VIEW);
  assert.equal(right.left + size.width, VIEW.width - TOOLTIP_EDGE);
  const left = placeFollowTooltip({ x: 3, y: 400 }, size, VIEW);
  assert.equal(left.left, TOOLTIP_EDGE);
  // 결과는 정수 픽셀(반 픽셀이면 글자가 흐려진다)
  const odd = placeFollowTooltip({ x: 777.3, y: 400.6 }, { width: 101, height: 29 }, VIEW);
  assert.ok(Number.isInteger(odd.left) && Number.isInteger(odd.top));
  assert.equal(tooltipTransform(odd), `translate3d(${odd.left}px, ${odd.top}px, 0)`);
});

test('커서를 따라가는 말풍선: 커서 위 가운데 12px, 위에 자리가 없으면 커서 아래 16px', () => {
  const size = { width: 140, height: 30 };
  const above = placeFollowTooltip({ x: 700, y: 400 }, size, VIEW);
  assert.deepEqual(above, { left: 630, top: 358, below: false });
  const below = placeFollowTooltip({ x: 700, y: 30 }, size, VIEW);
  assert.deepEqual(below, { left: 630, top: 46, below: true });
});

test('헤더 종 아이콘: 말풍선은 종 아래로 내려가 종과 빨간 배지를 덮지 않는다', () => {
  // 미리보기 1600×900 에서 잰 실제 자리(헤더 높이 56, 종 버튼 34×34, 배지 16×16 오른쪽 위).
  const bell = { left: 1324.25, top: 10.5, right: 1358.25, bottom: 44.5 };
  const badge = { left: 1344.25, top: 8.5, right: 1360.25, bottom: 24.5 };
  const size = { width: 148, height: 30 };
  for (const cursor of [{ x: 1341, y: 27.5 }, { x: 1348, y: 12.5 }, { x: 1352, y: 20 }, { x: 1330, y: 43 }]) {
    const p = placeFollowTooltip(cursor, size, VIEW, { preferBelow: true, targetBottom: bell.bottom });
    const box = boxOf(p, size);
    assert.equal(p.below, true);
    assert.equal(rectsOverlap(box, badge), false, `배지를 덮으면 안 된다 (커서 ${cursor.x},${cursor.y})`);
    assert.equal(rectsOverlap(box, bell), false, '종을 덮으면 안 된다');
    assert.equal(p.top, Math.round(Math.max(bell.bottom + 6, cursor.y + 16)), '종 바로 아래(커서가 더 아래면 커서 16px 아래)');
    assert.equal(Math.round(p.left + size.width / 2), Math.round(cursor.x), '가로는 커서를 따라간다');
  }
  // 창 위에 다른 띠가 있어 헤더가 내려와도(위에 자리가 생겨도) 헤더 말풍선은 아래로 간다.
  const lowered = placeFollowTooltip({ x: 1348, y: 92 }, size, VIEW, { preferBelow: true, targetBottom: 124 });
  assert.equal(lowered.below, true);
  assert.equal(lowered.top, 130);
});

test('긴 막대는 처음 올린 커서 근처, 짧은 막대는 막대 가운데에 고정한다', () => {
  const wide = { left: 0, right: 1400, top: 300, bottom: 326 };
  assert.equal(barTooltipAnchor(wide, 100).x, 220, '커서에서 120px 안쪽');
  assert.equal(barTooltipAnchor(wide, 1350).x, 1230);
  assert.equal(barTooltipAnchor({ left: 100, right: 300, top: 0, bottom: 26 }, 120).x, 200, '짧으면 가운데');
  assert.equal(barTooltipAnchor({ left: 100, right: 120, top: 0, bottom: 26 }, 101).x, 110, '아주 짧아도 가운데');
  assert.deepEqual(
    { top: barTooltipAnchor(wide, 600).top, bottom: barTooltipAnchor(wide, 600).bottom },
    { top: 300, bottom: 326 },
  );
});

test('웜업: 숨긴 지 300ms 안에만 바로 옮겨 가고, 스크롤·클릭으로 닫으면 끊긴다', () => {
  const warmth = createTooltipWarmth();
  assert.equal(TOOLTIP_WARM_MS, 300);
  assert.equal(warmth.isWarm(1000), false, '처음엔 차갑다');
  warmth.markHidden(1000);
  assert.equal(warmth.isWarm(1299), true);
  assert.equal(warmth.isWarm(1300), false);
  warmth.markHidden(2000);
  warmth.reset();
  assert.equal(warmth.isWarm(2001), false);
});

/* ─── 캘린더 막대 hover 저장소 ─────────────────────────────── */

test('마우스가 올라간 일정이 바뀌면 이전·새 일정의 막대만 알림을 받는다', () => {
  const store = createHoverKeyStore();
  const calls: string[] = [];
  const off = ['a', 'b', 'c'].map((key) => store.subscribe(key, () => calls.push(key)));
  store.subscribe('a', () => calls.push('a2')); // 여러 주에 걸친 같은 일정의 다른 조각

  store.set('a');
  assert.deepEqual(calls.sort(), ['a', 'a2']);
  calls.length = 0;
  store.set('a');
  assert.deepEqual(calls, [], '같은 일정이면 아무도 다시 그리지 않는다');
  store.set('b');
  assert.deepEqual(calls.sort(), ['a', 'a2', 'b'], '달력 전체가 아니라 바뀐 두 일정만');
  calls.length = 0;
  store.set(null);
  assert.deepEqual(calls, ['b']);
  assert.equal(store.get(), null);
  off[2]();
  calls.length = 0;
  store.set('c');
  assert.deepEqual(calls, [], '구독을 끊으면 알리지 않는다');
});

/* ─── 소스 가드 ─────────────────────────────────────────────── */

test('앱 전체 말풍선: 위치는 바깥 상자 transform, 마우스 이동은 상태를 바꾸지 않고, 흐림 없음', () => {
  const src = read('src/components/ui/GlobalTooltip.tsx');
  assert.doesNotMatch(src, /from 'framer-motion'/, 'framer 의 scale 이 위치 transform 을 덮던 구조로 돌아가지 않는다');
  assert.doesNotMatch(src, /backdropFilter|backdrop-blur/);
  assert.match(src, /className="fixed left-0 top-0 z-\[99999\] pointer-events-none"/, '바깥 상자는 화면 왼쪽 위 기준(폭이 줄지 않게)');
  assert.match(src, /pos\.style\.transform = tooltipTransform\(placement\)/);
  const move = src.slice(src.indexOf('const handleMouseMove'), src.indexOf('document.addEventListener(\'mouseover\''));
  assert.match(move, /requestAnimationFrame/);
  assert.doesNotMatch(move, /setTip\(/, '마우스가 움직일 때 React 상태를 바꾸지 않는다');
  // 웜업 미끄러짐은 대상이 바뀌는 순간에만, 동작 줄이기면 없음.
  assert.match(src, /const slide = tip\.warm && placedOnce\.current && !reduceRef\.current;/);
  assert.match(src, /pos\.style\.transition = slide \?/);
  assert.match(src, /duration: r \? REDUCED_FADE_MS : POP_MS/);
  assert.match(src, /data-tooltip-placement="below"/);
  assert.match(read('src/components/layout/Header.tsx'), /<header className="[^"]*" data-tooltip-placement="below">/);
});

test('사이드바 메뉴에는 title 말풍선이 없다(펼쳐지는 이름 위에 같은 글자가 겹쳐 떴다)', () => {
  const src = read('src/components/layout/Sidebar.tsx');
  assert.doesNotMatch(src, /title=\{isVisuallyExpanded \? undefined : item\.label\}/);
});

test('설명 카드 공용 유리 스타일은 뒤 흐림을 쓰지 않는다', () => {
  const src = read('src/utils/glassStyles.ts');
  const tooltip = src.slice(src.indexOf('export const tooltipGlassStyle'), src.indexOf('export const glassTopHighlight'));
  assert.doesNotMatch(tooltip, /backdropFilter|WebkitBackdropFilter/);
  assert.match(tooltip, /0\.97\) 0%, rgb\(var\(--color-tooltip-bg\) \/ 0\.99\)/);
});

test('캘린더: 막대는 커지지 않고 테두리 층만, 카드는 막대에 고정, 부모 상태로 달력 전체를 다시 그리지 않는다', () => {
  const src = read('src/components/calendar/CalendarGrid.tsx');
  assert.doesNotMatch(src, /scale-\[1\.02\]|brightness-110/);
  assert.doesNotMatch(src, /onMouseMove=\{handleMove\}/);
  assert.doesNotMatch(src, /useState<CalendarEventIdentity \| null>/, '호버 일정은 부모 상태가 아니라 작은 저장소에');
  assert.match(src, /const \[hoverStore\] = useState\(createHoverKeyStore\)/);
  assert.match(src, /barTooltipAnchor\(e\.currentTarget\.getBoundingClientRect\(\), e\.clientX\)/);
  assert.match(src, /if \(!reduceMotion && previous && previous !== transform\)/, '웜업 미끄러짐은 동작 줄이기면 없음');
  assert.match(src, /duration: reduceMotion \? 100 : 140, easing: EASE_CSS\.out \},\n\s+reduceMotion,/);
  const css = read('src/styles/motion-chrome-popups.css');
  const ring = css.slice(css.indexOf('.calendar-event-bar-ring {'));
  assert.match(ring, /transition: opacity 150ms var\(--ease-std\);/);
  assert.doesNotMatch(ring.slice(0, ring.indexOf('}')), /transition:[^;]*(box-shadow|transform|all)/, '그림자·크기는 애니메이션하지 않는다');
});

test('타임라인: 막대에 들어온 순간 한 번만 자리를 정하고, 충돌 검사는 프로젝트가 바뀔 때만', () => {
  const canvas = read('src/features/gantt/GanttCanvas.tsx');
  assert.doesNotMatch(canvas, /onPointerMove:\(e:React\.PointerEvent<HTMLElement>\)=>showHover\(r,e\.clientX/);
  assert.match(canvas, /const enterBar=\(e:React\.PointerEvent<HTMLElement>\)=>\{if\(hover\?\.task\.id===r\.id\)return;/);
  assert.match(canvas, /const conflicts = useMemo\(\(\) => new Map\([\s\S]*?\), \[projects\]\);/);
  const tooltip = read('src/features/gantt/GanttTooltip.tsx');
  assert.match(tooltip, /placeAnchoredTooltip\(\{ x: shown\.x, top: shown\.y, bottom: shown\.anchorBottom \}/);
  assert.match(tooltip, /if \(!reduce && \(previous\.left !== next\.left/, '웜업 미끄러짐은 동작 줄이기면 없음');
  assert.match(read('src/features/gantt/canvas.css'), /\.gantt-hover\.gantt-detail-hover\{[^}]*animation:none\}/);
});

test('대시보드: 최근 작업 칸은 확대 효과에 연결되고 두 번째 말풍선(title)이 없으며, 말풍선은 위젯을 다시 그리지 않는다', () => {
  const heatmap = read('src/components/widgets/activity/GoldenHeatmap.tsx');
  const cell = heatmap.slice(heatmap.indexOf('function Cell('));
  assert.match(cell, /className="path-link-heatmap-cell /);
  assert.doesNotMatch(cell, /title=/);
  assert.doesNotMatch(cell, /zIndex: selected \? 5 : 'auto'/, "인라인 'auto' 가 hover 의 z-index 를 막는다");
  assert.doesNotMatch(cell, /onMouseMove/);
  assert.match(read('src/styles/activity-widget.css'), /\.path-link-heatmap-cell:hover \{\n\s+transform: scale\(1\.4\);/);
  for (const path of ['src/components/widgets/RecentActivityWidget.tsx', 'src/components/widgets/DepartmentComparisonWidget.tsx']) {
    const src = read(path);
    assert.match(src, /<ChartHoverTooltip/);
    assert.doesNotMatch(src, /setTooltip\(|backdrop-blur|onMouseMove=\{handleBarMove\}/, path);
  }
  const chart = read('src/components/widgets/ChartHoverTooltip.tsx');
  assert.match(chart, /pos\.style\.transform = tooltipTransform\(placement\)/);
  assert.match(chart, /duration: reduceRef\.current \? REDUCED_FADE_MS : FADE_MS/);
});
