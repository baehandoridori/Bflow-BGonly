import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GRID_FLIP, enterKeyframes } from '../../src/utils/gridFlip.ts';
import { keepOpenDetailInList, type OpenDetailSlot } from '../../src/utils/reflowLinger.ts';
import { shouldSkipClickAfterPointer } from '../../src/utils/pointerClickGuard.ts';

/* 움직임 폴리싱 통합 검증 지적 — 씬 상세 흐름·필터 재배치(fx-scene-flow) 수정 지킴이.
   acc-comments-notify-1 / acc-motion-settings-1: 카드에서 연 상세 창이 확대가 끝난 직후 0배로 접혔다 다시 커지던 '펑'
   acc-scene-flow-1: 필터로 새로 보인 일정 막대를 끌어 놓으면 떠오름이 다시 돌던 것
   acc-scene-flow-3: 점프·돌아가기로 파트가 바뀌면 통합 창이 가라앉지 않고 뚝 사라지던 것
   acc-scene-flow-5: 필터를 켠 채 창 안에서 체크하면 잠시 뒤 창이 혼자 다시 그려지고 화살표가 사라지던 것
   acc-scene-flow-6: 머무는 카드의 단계를 0.5~0.6초 안에 되돌리면 다시 켜지던 것
   acc-scene-flow-7: 점(도트)으로 여러 칸 떨어진 씬을 누르면 한 칸만 가던 것
   acc-scene-flow-8: 닫히는 0.16초 동안 온 열기 요청이 사라지던 것 */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const UNIFIED = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
const SCENE = read('src/components/scenes/SceneDetailModal.tsx');
const SCENES_VIEW = read('src/views/ScenesView.tsx');
const UNIFIED_HOOK = read('src/hooks/useUnifiedScenes.ts');
const COMPOSITING_MODAL = read('src/views/compositing-dashboard/modal/CompositingSceneModal.tsx');

/* ─── acc-comments-notify-1 · acc-motion-settings-1 ─────────────── */

test("연결 확대로 열렸는지는 마운트 때 한 번만 정한다 — 확대가 끝나 출발 카드가 비워져도 본체에 새 transform 애니메이션이 걸리지 않는다", () => {
  assert.match(UNIFIED, /const \[continuityOpen\] = useState\(\(\) => !!continuitySourceElement && !reduce\);/);
  assert.doesNotMatch(UNIFIED, /const continuityOpen = /, '렌더마다 다시 계산하지 않는다');
  // 훅은 이른 return(if (!headScene) return null) 보다 앞에 있어야 한다
  assert.ok(UNIFIED.indexOf('const [continuityOpen]') < UNIFIED.indexOf('if (!headScene) return null;'));
  // 연결 확대로 열린 창의 본체는 끝까지 투명도 1 그대로 — transform 목표(떠오르기)로 바뀌지 않는다
  assert.match(UNIFIED, /: continuityOpen\n\s+\? \{ initial: \{ opacity: 1 \}, animate: \{ opacity: 1 \} \}\n\s+: \{\n\s+initial: modalMotion\.body\.initial,/);
  // 확대가 끝나면 부모는 출발 카드를 비운다(그래도 위 값은 그대로)
  assert.match(SCENES_VIEW, /onContinuityEnd=\{clearContinuitySource\}/);
  // 단일(BG/액팅) 창은 연결 확대가 없고 처음부터 떠오르기 하나만 돈다
  assert.doesNotMatch(SCENE, /continuitySourceElement/);
  assert.match(SCENE, /initial=\{modalMotion\.body\.initial\}\n\s+animate=\{modalMotion\.body\.animate\}/);
});

/* ─── acc-scene-flow-5: 열린 씬은 창이 닫힐 때까지 이전/다음 목록에 ─────────── */

const key = (s: string) => s;

test('열린 씬이 목록에 있으면 그 순번을 쓰고 자리를 기억한다', () => {
  const nav = keepOpenDetailInList(['a', 'b', 'c'], 'b', key, null);
  assert.deepEqual(nav, { list: ['a', 'b', 'c'], index: 1, slot: { key: 'b', index: 1 } });
});

test('체크로 필터에서 빠지면 기억한 자리에 끼워 둔다 — → 는 원래 다음 씬, ← 는 원래 이전 씬', () => {
  const slot: OpenDetailSlot = { key: 'b', index: 1 };
  const nav = keepOpenDetailInList(['a', 'c', 'd'], 'b', key, slot);
  assert.deepEqual(nav.list, ['a', 'b', 'c', 'd']);
  assert.equal(nav.index, 1);
  assert.equal(nav.list[nav.index - 1], 'a');
  assert.equal(nav.list[nav.index + 1], 'c');
  assert.equal(nav.slot, slot, '기억은 그대로 넘긴다');
  // 마지막 칸이었으면 끝에, 목록이 줄었으면 끝을 넘지 않는다
  assert.deepEqual(keepOpenDetailInList(['a'], 'z', key, { key: 'z', index: 5 }).list, ['a', 'z']);
  assert.deepEqual(keepOpenDetailInList([], 'z', key, { key: 'z', index: 0 }), { list: ['z'], index: 0, slot: { key: 'z', index: 0 } });
});

test('처음부터 목록에 없던 씬(필터 밖 씬을 알림으로 연 경우)·다른 씬의 기억·창이 닫힘은 예전처럼', () => {
  assert.deepEqual(keepOpenDetailInList(['a', 'c'], 'b', key, null), { list: ['a', 'c'], index: -1, slot: null });
  assert.deepEqual(keepOpenDetailInList(['a', 'c'], 'b', key, { key: 'x', index: 1 }), { list: ['a', 'c'], index: -1, slot: null });
  assert.deepEqual(keepOpenDetailInList(['a', 'c'], null, key, { key: 'a', index: 0 }), { list: ['a', 'c'], index: -1, slot: null });
});

test('다른 씬으로 넘기면 그 씬 기준으로 다시 기억하고, 빠졌던 씬은 목록에서 자연히 사라진다', () => {
  let slot: OpenDetailSlot | null = null;
  slot = keepOpenDetailInList(['a', 'b', 'c'], 'b', key, slot).slot; // b 를 열어 둠
  const held = keepOpenDetailInList(['a', 'c'], 'b', key, slot); // b 를 체크해 필터에서 빠짐
  const next = held.list[held.index + 1];
  const moved = keepOpenDetailInList(['a', 'c'], next, key, held.slot);
  assert.deepEqual(moved, { list: ['a', 'c'], index: 1, slot: { key: 'c', index: 1 } });
});

test('두 상세 창 모두 그 목록으로 화살표·n / m·점을 그린다(통합 창 본문은 순번 대신 씬 정체로 다시 그림 판정)', () => {
  assert.match(SCENES_VIEW, /const singleNav = keepOpenDetailInList\(/);
  assert.match(SCENES_VIEW, /singleNavSlotRef\.current = singleNav\.slot;\n\s+const filteredIndices = singleNav\.list;\n\s+const posInFiltered = singleNav\.index;/);
  assert.match(SCENES_VIEW, /const unifiedNav = keepOpenDetailInList\(\n\s+mergedScenes,\n\s+detailMerged,/);
  assert.match(SCENES_VIEW, /unifiedNavSlotRef\.current = unifiedNav\.slot;/);
  assert.match(SCENES_VIEW, /totalMerged: navScenes\.length,/);
  // 창이 닫히면 기억도 지운다(다음에 연 같은 씬이 엉뚱한 자리에 끼지 않게)
  assert.match(SCENES_VIEW, /if \(!detailMerged\) unifiedNavSlotRef\.current = null;/);
  assert.match(SCENES_VIEW, /if \(detailSceneIndex === null\) singleNavSlotRef\.current = null;/);
  assert.doesNotMatch(UNIFIED, /\$\{currentMergedIndex\}:\$\{merged\.sceneId\}/);
});

/* ─── acc-scene-flow-7: 점(도트)으로 여러 칸 ──────────────────── */

test('점(도트)은 목표 순번으로 한 번에 간다 — 세 상세 창 부모가 모두 onNavigateTo 를 넘긴다', () => {
  for (const [name, src] of [['SceneDetailModal', SCENE], ['UnifiedSceneDetailModal', UNIFIED]] as const) {
    assert.match(src, /onNavigateTo\?: \(index: number\) => void;/, `${name}: prop`);
    assert.match(src, /onNavigateTo\(i\);/, `${name}: 점 클릭은 목표 순번`);
  }
  assert.match(SCENES_VIEW, /onNavigateTo=\{goToFilteredPos\}/);
  assert.match(SCENES_VIEW, /onNavigateTo=\{goToMergedPos\}/);
  assert.match(COMPOSITING_MODAL, /onNavigateTo=\{navigateTo\}/);
  // 목표 순번으로 가는 함수는 한 번에 setDetail* 한 번
  assert.match(SCENES_VIEW, /const goToMergedPos = \(pos: number\) => \{\n\s+if \(pos < 0 \|\| pos >= navScenes\.length \|\| pos === curIdx\) return;\n\s+setDetailMerged\(navScenes\[pos\]\);/);
});

/* ─── acc-scene-flow-6: 누름마다 따로 판정 ───────────────────────── */

/**
 * 버튼 하나에 pointerdown / 마우스 click(detail 1) / 키보드 click(detail 0) 이 섞여 올 때 실제 토글 횟수
 * (컴포넌트와 같은 규칙: pointerdown 에서 토글하고 표시, click 은 shouldSkipClickAfterPointer 로 판정).
 */
function simulate(events: Array<'down' | 'click' | 'key'>): number {
  let handled = false;
  let toggles = 0;
  for (const type of events) {
    if (type === 'down') {
      handled = true;
      toggles++;
    } else if (shouldSkipClickAfterPointer(handled, type === 'click' ? 1 : 0)) {
      handled = false;
    } else {
      toggles++;
    }
  }
  return toggles;
}

/** 예전 규칙(600ms 타이머로 표시를 지움)을 시각과 함께 흉내 — 무엇이 틀렸는지 남겨 둔다. */
function simulateOldTimer(events: Array<['down' | 'click', number]>): number {
  let handled = false;
  let toggles = 0;
  const timers: number[] = [];
  for (const [type, t] of events) {
    while (timers.length && timers[0] <= t) { timers.shift(); handled = false; }
    if (type === 'down') {
      handled = true;
      toggles++;
      timers.push(t + 600);
    } else if (handled) {
      handled = false;
    } else {
      toggles++;
    }
  }
  return toggles;
}

test('머무는 카드의 단계를 0.55초 뒤 다시 눌러 되돌리면(누르는 시간 80ms) 누름마다 한 번씩만 토글된다', () => {
  // 예전: 첫 누름의 600ms 타이머가 둘째 누름의 표시를 지워 둘째 click 이 한 번 더 토글(꺼졌다 곧바로 다시 켜짐)
  assert.equal(simulateOldTimer([['down', 0], ['click', 80], ['down', 550], ['click', 630]]), 3);
  assert.equal(simulate(['down', 'click', 'down', 'click']), 2);
  // 0.6초 넘게 누르고 있어도 click 은 같은 누름의 것 — 한 번만(예전에는 두 번)
  assert.equal(simulateOldTimer([['down', 0], ['click', 700]]), 2);
  assert.equal(simulate(['down', 'click']), 1);
  // 키보드(Enter·Space)로 만든 click(detail 0)은 그대로 토글한다 — 직전에 누르다 버튼 밖에서 뗀 경우에도
  assert.equal(simulate(['key']), 1);
  assert.equal(simulate(['down', 'key']), 2);
  assert.equal(simulate(['down', 'click', 'click']), 2, '짝이 없는 마우스 click 은 그대로');
  assert.equal(shouldSkipClickAfterPointer(true, 0), false);
  assert.equal(shouldSkipClickAfterPointer(true, 2), true, '더블클릭의 둘째 click 도 자기 pointerdown 과 짝');
  assert.equal(shouldSkipClickAfterPointer(false, 1), false);
});

test('단계 버튼·액팅 칩: 타이머로 표시를 지우지 않고 click 의 detail 로 짝지운다', () => {
  for (const path of ['src/components/scenes/StageSegmentToggle.tsx', 'src/components/scenes/ScenePhaseToggle.tsx']) {
    const src = read(path);
    assert.doesNotMatch(src, /setTimeout\(\(\) => \{\n\s+pointerHandledRef\.current = false;/, `${path}: 600ms 타이머 제거`);
    assert.match(src, /pointerHandledRef\.current = true;/, `${path}: pointerdown 에서 표시`);
    assert.match(src, /if \(shouldSkipClickAfterPointer\(pointerHandledRef\.current, e\.detail\)\) \{\n\s+pointerHandledRef\.current = false;\n\s+return;/, `${path}: click 판정`);
  }
});

/* ─── acc-scene-flow-1: 캘린더 막대 떠오름은 한 번만 ─────────────────── */

test('캘린더: 떠오름 클래스는 마운트 때 정한 그대로 — 끌고 놓아도 다시 붙었다 떨어지지 않는다', () => {
  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /revealOnMountRef\.current = !reduceMotion && !isDragging && shouldRevealOnMount\(revealSince, Date\.now\(\)\);/);
  assert.match(grid, /revealOnMountRef\.current && 'sf-cal-bar-reveal',/);
  assert.doesNotMatch(grid, /!isDragging && 'sf-cal-bar-reveal'/);
});

/* ─── acc-scene-flow-3 · 8: 가라앉는 동안 ─────────────────────────── */

test('통합 창도 닫기 신호 ~ onClose 동안 보던 씬·시트명·파트 이름을 고정한다(점프·돌아가기로 파트가 바뀌어도)', () => {
  // 렌더 단계: 신호를 아직 소비하지 않았거나 가라앉는 중이면 '닫는 중'
  assert.match(SCENES_VIEW, /const unifiedClosePending = closeSceneModalSignal !== lastCloseSignalRef\.current \|\| sceneModalClosingRef\.current;/);
  // 그동안 열린 씬을 새 파트 목록과 맞추지 않는다(맞추면 null 이 되어 뚝 사라짐)
  assert.match(SCENES_VIEW, /holdDetail: unifiedClosePending,/);
  assert.match(UNIFIED_HOOK, /if \(holdDetailRef\.current\) return;/);
  // 이름·순번은 직전 값을 쓴다
  assert.match(SCENES_VIEW, /const view = unifiedClosePending && unifiedViewPinRef\.current \? unifiedViewPinRef\.current : liveView;\n\s+unifiedViewPinRef\.current = view;/);
  for (const prop of ['bgSheetName', 'actSheetName', 'partLabel', 'episodeLabel', 'hasPrev', 'hasNext', 'currentMergedIndex', 'totalMerged']) {
    assert.match(SCENES_VIEW, new RegExp(`${prop}=\\{view\\.${prop}\\}`), prop);
  }
  // 부서가 '전체'가 아니게 바뀌어도 가라앉는 동안은 그린다 + 닫기 신호 effect 도 같은 판단
  assert.match(SCENES_VIEW, /\{detailMerged && unifiedModalShown && \(\(\) => \{/);
  assert.match(SCENES_VIEW, /sceneModalShownRef\.current = Boolean\(\(detailScene && detailSceneIdx !== null\) \|\| unifiedModalShown\);/);
  // 신호를 창에 넘기면서 닫는 중 표시, onClose 에서 해제
  assert.match(SCENES_VIEW, /sceneModalClosingRef\.current = true;\n(?:\s+\/\/.*\n)*\s+const pin = detailPinRef\.current;/);
  assert.match(SCENES_VIEW, /onClose=\{\(\) => \{\n\s+sceneModalClosingRef\.current = false;\n\s+unifiedViewPinRef\.current = null;\n\s+setDetailMerged\(null\);/);
});

test('닫히는 0.16초 사이에 온 열기 요청은 창이 다 닫힌 뒤 처리한다(닫히는 창이 새 대상을 지우지 않게)', () => {
  for (const [name, src] of [['SceneDetailModal', SCENE], ['UnifiedSceneDetailModal', UNIFIED]] as const) {
    assert.match(src, /onCloseStart\?: \(\) => void;/, `${name}: prop`);
    assert.match(src, /closingRef\.current = true;\n\s+onCloseStartRef\.current\?\.\(\);/, `${name}: 가라앉기 시작에 알림`);
  }
  assert.equal(SCENES_VIEW.match(/onCloseStart=\{markSceneModalClosing\}/g)?.length, 2);
  const effectAt = SCENES_VIEW.indexOf('if (!pendingReq) return;');
  assert.ok(effectAt > 0);
  assert.match(SCENES_VIEW.slice(effectAt, effectAt + 400), /if \(sceneModalClosingRef\.current\) return;/);
  // 닫히면(sceneDetailOpen 이 바뀌면) 다시 돈다
  assert.match(SCENES_VIEW, /setSelectedDepartment, setDashboardDeptFilter, sceneDetailOpen\]\);/);
  assert.match(SCENES_VIEW, /const sceneDetailOpen = Boolean\(detailMerged\) \|\| detailSceneIndex !== null;\n\s+if \(!sceneDetailOpen\) sceneModalClosingRef\.current = false;/);
  // 단일 창 onClose 도 해제
  assert.match(SCENES_VIEW, /onClose=\{\(\) => \{ closingDetailPinRef\.current = null; setDetailSceneIndex\(null\); setDetailContext\(null\); setModalRouting\(null\); sceneModalClosingRef\.current = false; \}\}/);
});

/* ─── perf-2: 상태 필터를 바꿀 때 멈춤 ───────────────────────────── */

test('씬 목록의 새 카드는 투명도 없이 8px 아래에서 떠오르기만 한다 — 다음 필터 변경 때 격자 전체 스타일 재계산을 막는다', () => {
  // 투명도 없는 떠오름: transform 만, 끝나면 남지 않는다
  assert.deepEqual(enterKeyframes(GRID_FLIP.enterOffsetPx, false), [
    { transform: 'translateY(8px)' },
    { transform: 'translateY(0px)' },
  ]);
  for (const frame of enterKeyframes(GRID_FLIP.enterOffsetPx, false)) assert.equal('opacity' in frame, false);
  // 다른 작은 목록(기본값)은 예전처럼 투명에서 떠오른다
  assert.deepEqual(enterKeyframes()[0], { opacity: 0, transform: 'translateY(8px)' });
  const hook = read('src/hooks/useGridFlip.ts');
  assert.match(hook, /enterFade = true/);
  assert.match(hook, /element\.animate\(enterKeyframes\(GRID_FLIP\.enterOffsetPx, enterFade\), \{/);
  // 씬 목록 격자만 끈다
  const flipCall = SCENES_VIEW.slice(SCENES_VIEW.indexOf('useGridFlip(\n    sceneListRef,'));
  assert.match(flipCall.slice(0, 1200), /enterFade: false,/);
});
