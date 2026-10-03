import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EMPTY_IMAGE_SAVE,
  SAVED_CHIP_MS,
  SCENE_FLIP,
  SCENE_FLIP_EASE_CSS,
  SCENE_MODAL_CLOSE_MS,
  advancePendingFlip,
  beginImageSave,
  clearImageSave,
  continuityStartTransform,
  finishImageSave,
  ghostBox,
  imageSaveView,
  isChainedFlip,
  planSceneFlip,
  planTitleRoll,
  preloadImage,
  resolveDetailContext,
  rubberBandKeyframes,
  sceneModalMotion,
  shouldSkipRepeatedKey,
  showImageSavePreview,
  tabShiftPx,
  type DetailTarget,
} from '../../src/utils/sceneFlip.ts';

/* 움직임 폴리싱 14번 scene-detail-flow — 씬 상세 창 닫기·열기·넘김·탭·이미지 저장.
   한솔 결정(2026-10-03): 카드가 왼쪽·오른쪽으로 '지나가는' 넘김(약 96px·0.985·흐려짐, 0.3초 cubic-bezier(.22,1,.36,1)),
   연타·키 누르고 있기는 약 0.14초로 이어 붙임, 동작 줄이기는 0.12초 투명도만. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/* ─── 순수 계획 ─────────────────────────────────────────────── */

test('한 번 넘김: 지금 씬은 넘기는 반대쪽으로 96px·0.985 로 지나가며 흐려지고, 다음 씬은 반대쪽에서 들어와 원래 모습으로 끝난다', () => {
  const next = planSceneFlip({ dir: 1, chained: false, reduce: false });
  assert.equal(next.durationMs, 300);
  assert.equal(next.easing, 'cubic-bezier(0.22, 1, 0.36, 1)');
  assert.equal(SCENE_FLIP_EASE_CSS, next.easing);
  assert.deepEqual(next.outgoing, [
    { transform: 'none', opacity: 1 },
    { transform: 'translateX(-96px) scale(0.985)', opacity: 0 },
  ]);
  assert.deepEqual(next.incoming, [
    { transform: 'translateX(96px) scale(0.985)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ]);

  const prev = planSceneFlip({ dir: -1, chained: false, reduce: false });
  assert.equal(prev.outgoing[1].transform, 'translateX(96px) scale(0.985)', '이전(←)은 거울 방향');
  assert.equal(prev.incoming[0].transform, 'translateX(-96px) scale(0.985)');
});

test('이어 붙인 넘김(연타·키 누르고 있기)은 0.14초로 짧아지고, 움직이던 그 자리·투명도에서 이어 간다(방향 전환도 즉시)', () => {
  const from = { transform: 'matrix(0.985, 0, 0, 0.985, 40, 0)', opacity: 0.6 };
  const reverse = planSceneFlip({ dir: -1, chained: true, reduce: false, from });
  assert.equal(reverse.durationMs, SCENE_FLIP.chainMs);
  assert.equal(SCENE_FLIP.chainMs, 140);
  assert.deepEqual(reverse.outgoing[0], from, '지금 보이던 자리에서 출발 — 순간이동 없음');
  assert.equal(reverse.outgoing[1].transform, 'translateX(64px) scale(0.985)', '되돌아갈 때는 들어오던 쪽으로 즉시 빠진다');
  assert.equal(reverse.incoming[0].transform, 'translateX(-64px) scale(0.985)');
});

test('동작 줄이기: 넘김·제목 굴림 모두 이동 없이 0.12초 투명도 교차만', () => {
  for (const plan of [
    planSceneFlip({ dir: 1, chained: false, reduce: true }),
    planSceneFlip({ dir: -1, chained: true, reduce: true }),
    planTitleRoll({ dir: 1, durationMs: 300, reduce: true }),
  ]) {
    assert.equal(plan.durationMs, 120);
    for (const frame of [...plan.outgoing, ...plan.incoming]) {
      assert.equal('transform' in frame, false, '동작 줄이기에는 transform 이 없다');
    }
    assert.deepEqual(plan.incoming, [{ opacity: 0 }, { opacity: 1 }]);
  }
});

test('씬 번호·제목은 본문과 같은 방향으로 짧게(14px) 굴러 바뀌고 본문보다 먼저 끝난다', () => {
  const roll = planTitleRoll({ dir: 1, durationMs: 300, reduce: false });
  assert.equal(roll.durationMs, 220);
  assert.equal(roll.outgoing[1].transform, 'translateX(-14px)');
  assert.equal(roll.incoming[0].transform, 'translateX(14px)');
  assert.equal(planTitleRoll({ dir: 1, durationMs: 140, reduce: false }).durationMs, 140, '이어 붙일 때는 본문 길이를 넘지 않는다');
});

test('이어 붙임 판정과 키 자동 반복 걸러내기', () => {
  assert.equal(isChainedFlip(1000, Number.NEGATIVE_INFINITY, 0), false, '처음 넘김');
  assert.equal(isChainedFlip(1100, 1000, 300), true, '앞 넘김 진행 중');
  assert.equal(isChainedFlip(1350, 1000, 300), true, '막 끝난 직후(여유 60ms)');
  assert.equal(isChainedFlip(1400, 1000, 300), false);

  assert.equal(shouldSkipRepeatedKey(false, 1010, 1000), false, '따로 누른 키는 걸러내지 않는다(연타는 그대로 다 넘김)');
  assert.equal(shouldSkipRepeatedKey(true, 1100, 1000), true, '누르고 있을 때 0.14초 안의 반복은 건너뜀');
  assert.equal(shouldSkipRepeatedKey(true, 1140, 1000), false);
});

test('맨 끝 고무줄: 넘기려던 쪽으로 16px 끌렸다가 원래 자리로 돌아온다', () => {
  const frames = rubberBandKeyframes(1);
  assert.equal(frames[0].transform, 'none');
  assert.equal(frames[1].transform, 'translateX(-16px)');
  assert.equal(frames[1].offset, 0.3);
  assert.equal(frames.at(-1)?.transform, 'none', '끝나면 transform 이 남지 않는다');
  assert.equal(rubberBandKeyframes(-1)[1].transform, 'translateX(16px)');
});

test('탭 전환은 누른 탭 쪽(±8px)에서 들어온다', () => {
  const order = ['detail', 'revisions', 'files', 'history'] as const;
  assert.equal(tabShiftPx(order, 'detail', 'history'), 8);
  assert.equal(tabShiftPx(order, 'files', 'revisions'), -8);
  assert.equal(tabShiftPx(order, 'files', 'files'), 0);
});

test('닫기: 창 묶음이 0.16초 동안 살짝 작아지며 가라앉고(나갈 때 곡선) 뒤 막은 같이 밝아진다 — 동작 줄이기는 투명도만', () => {
  const full = sceneModalMotion(false);
  assert.equal(SCENE_MODAL_CLOSE_MS, 160);
  assert.deepEqual(full.shellExit.transform, ['translateY(0px) scale(1)', 'translateY(6px) scale(0.97)'], "'none' 에서 출발하지 않게 제자리 값을 명시");
  assert.equal(full.shellExit.opacity, 0);
  assert.deepEqual(full.shellExit.transition, { duration: 0.16, ease: [0.4, 0, 1, 1] });
  assert.deepEqual(full.backdropExit, { opacity: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } });
  // 열기는 transform 문자열 + 끝나면 none (framer 개별 x/y/scale 아님)
  assert.equal(full.body.initial.transform, 'translateY(12px) scale(0.96)');
  assert.deepEqual(full.body.animate.transitionEnd, { transform: 'none' });

  const calm = sceneModalMotion(true);
  assert.equal('transform' in calm.shellExit, false);
  assert.equal('transform' in calm.body.initial, false);
  assert.equal(sceneModalMotion(true), calm, '같은 객체 — 렌더마다 새로 만들지 않는다');
});

test("'전체' 보기 연결 확대: 카드 폭에 맞춘 균등 확대 + 위 정렬(가로세로 따로 늘리지 않아 글자가 납작해지지 않는다)", () => {
  const transform = continuityStartTransform({ left: 300, top: 400, width: 180 }, { left: 200, top: 60, width: 720 });
  assert.equal(transform, 'translate3d(100px, 340px, 0) scale(0.25)');
  assert.doesNotMatch(transform, /scale\([^)]*,/, 'scale(x, y) 두 값이면 비율이 깨진다');
});

test("'저장됨 ✓' 칩은 1.2초, 원격 그림 미리 받기는 창이 없는 환경에서도 바로 끝난다", async () => {
  assert.equal(SAVED_CHIP_MS, 1200);
  await preloadImage('');
  await preloadImage('https://example.invalid/a.png'); // node 에는 Image 가 없다 → 바로 끝
});

/* ─── 리뷰 반영: 닫히는 동안 씬 고정 · 넘김 준비 소비 · 칸별 저장 상태 ─────────── */

test('#파트 점프로 닫히는 동안 단일 창은 직전 씬을 그대로 보여 준다(대상 파트의 같은 순번 씬으로 바뀌지 않음)', () => {
  // ScenesView 의 흐름을 그대로 따라간다: 렌더마다 resolveDetailContext → pin 을 다음 렌더로, 닫기 신호 effect 가 pin 을 detailContext 로 고정.
  const parts: Record<string, string[]> = { 'EP05_A_BG': ['a001', 'a002', 'a003'], 'EP05_B_BG': ['b001', 'b002', 'b003'] };
  let detailContext: DetailTarget | null = null;
  const detailSceneIndex = 1; // 카드에서 a002 를 열었다(detailContext 없음)
  let pinned: DetailTarget | null = null;
  let closingPin: DetailTarget | null = null; // ScenesView 의 closingDetailPinRef
  let consumedSignal = 0;
  const render = (currentSheet: string, signal: number) => {
    const resolved = resolveDetailContext({
      context: detailContext,
      sceneIndex: detailSceneIndex,
      currentSheetName: currentSheet,
      closePending: signal !== consumedSignal || closingPin !== null,
      pinned: closingPin ?? pinned,
    });
    pinned = resolved.pin;
    const target = resolved.context ?? { sheetName: currentSheet, sceneIndex: detailSceneIndex };
    return parts[target.sheetName][target.sceneIndex];
  };
  assert.equal(render('EP05_A_BG', 0), 'a002');
  assert.equal(render('EP05_A_BG', 0), 'a002');
  // 점프: 같은 갱신에서 파트가 B 로 바뀌고 닫기 신호가 오른다 → 신호를 소비하기 전 렌더도 a002.
  assert.equal(render('EP05_B_BG', 1), 'a002', '신호 소비 전 렌더에서 b002 가 보이면 안 된다');
  assert.equal(render('EP05_B_BG', 1), 'a002', '같은 신호로 다시 그려도(StrictMode 등) 그대로');
  // 닫기 신호 effect: 신호 소비 + closingPin 고정. setDetailContext 는 뒤 갱신이라 그 전에 다른 갱신이 먼저 그려질 수 있다.
  consumedSignal = 1;
  closingPin = pinned;
  assert.equal(render('EP05_B_BG', 1), 'a002', 'detailContext 가 아직 안 들어온 렌더(다른 갱신이 먼저)도 a002');
  detailContext = detailContext ?? closingPin;
  for (let frame = 0; frame < 10; frame += 1) assert.equal(render('EP05_B_BG', 1), 'a002', '가라앉는 0.16초 내내 a002');

  // 신호가 없으면 예전처럼 '지금 파트의 n번째'(파트를 옮겨 다른 씬을 보는 건 정상 흐름).
  assert.deepEqual(
    resolveDetailContext({ context: null, sceneIndex: 2, currentSheetName: 'EP05_B_BG', closePending: false, pinned: { sheetName: 'EP05_A_BG', sceneIndex: 2 } }),
    { context: null, pin: { sheetName: 'EP05_B_BG', sceneIndex: 2 } },
  );
  // 시트를 아는 열기(detailContext)는 그대로, 닫힌 상태(sceneIndex null)는 고정할 것이 없다.
  const ctx = { sheetName: 'EP05_A_BG', sceneIndex: 0 };
  assert.deepEqual(resolveDetailContext({ context: ctx, sceneIndex: 0, currentSheetName: 'EP05_B_BG', closePending: true, pinned: null }), { context: ctx, pin: ctx });
  assert.deepEqual(resolveDetailContext({ context: null, sceneIndex: null, currentSheetName: 'EP05_B_BG', closePending: true, pinned: ctx }), { context: null, pin: null });
});

test('나가는 카드 자리: 짧은 씬으로 넘겨 스크롤이 당겨지면 그만큼 같이 옮겨 보던 자리 그대로, 아래 끝은 칸 높이까지(스크롤 영역을 늘리지 않음)', () => {
  // BG 창 실측: 긴 씬(1237px)을 맨 아래(518)까지 보다가 짧은 씬(1069px)으로 → 스크롤 350 으로 당겨짐(-168)
  assert.deepEqual(ghostBox({ top: 0, height: 1237, scrollShift: 350 - 518, heightCap: 1069 }), { top: -168, height: 1237 });
  // 스크롤이 그대로면 예전과 같다(칸 높이까지 자름)
  assert.deepEqual(ghostBox({ top: 0, height: 1069, scrollShift: 0, heightCap: 1237 }), { top: 0, height: 1069 });
  assert.deepEqual(ghostBox({ top: 0, height: 1237, heightCap: 1069 }), { top: 0, height: 1069 });
  // 제목 고스트는 자르지 않는다
  assert.deepEqual(ghostBox({ top: 4, height: 28 }), { top: 4, height: 28 });
  assert.deepEqual(ghostBox({ top: 0, height: 100, scrollShift: -500, heightCap: 300 }), { top: -500, height: 100 }, '음수 높이 없음');
  assert.equal(ghostBox({ top: 0, height: 100, heightCap: -5 }).height, 0);
  const hook = read('src/hooks/useSceneFlip.ts');
  assert.match(hook, /const box = ghostBox\(\{ top: snap\.top, height: snap\.height, scrollShift, heightCap \}\);/);
  assert.match(hook, /const scrollShift = outer && outer\.el\.isConnected \? outer\.el\.scrollTop - outer\.top : 0;/);
  assert.match(hook, /outerScroll: scroller \? \{ el: scroller, top: scroller\.scrollTop \} : null,/);
});

test('넘김 준비 소비: 도트로 여러 칸을 건너뛰면 마지막 칸에서 한 번만, 오래된 준비(0.9초)는 버린다', () => {
  assert.deepEqual(advancePendingFlip(null, 0), { ready: null, keep: null });
  // 한 칸: 첫 씬 변경에서 바로 넘긴다.
  const one = { dir: 1 as const, stepsLeft: 1, at: 1000 };
  assert.deepEqual(advancePendingFlip(one, 1010), { ready: { ...one, stepsLeft: 0 }, keep: null });
  // 세 칸: 앞 두 번은 남겨 두고(움직이지 않음), 세 번째에 넘긴다.
  let pending: { dir: 1; stepsLeft: number; at: number } | null = { dir: 1, stepsLeft: 3, at: 1000 };
  const verdicts: string[] = [];
  for (const t of [1010, 1020, 1030]) {
    const { ready, keep } = advancePendingFlip(pending, t);
    verdicts.push(ready ? 'run' : keep ? `wait:${keep.stepsLeft}` : 'none');
    pending = keep;
  }
  assert.deepEqual(verdicts, ['wait:2', 'wait:1', 'run']);
  assert.equal(pending, null, '넘긴 뒤에는 준비가 비어 있다');
  // 준비하고 0.9초가 넘도록 씬이 안 바뀌면 버린다(엉뚱한 때 넘기지 않게).
  assert.deepEqual(advancePendingFlip({ dir: -1, stepsLeft: 1, at: 1000 }, 1000 + SCENE_FLIP.staleMs + 1), { ready: null, keep: null });
  assert.notEqual(advancePendingFlip({ dir: -1, stepsLeft: 1, at: 1000 }, 1000 + SCENE_FLIP.staleMs).ready, null);
});

test('이미지 저장 상태는 씬·저장 번호별: 붙여넣고 바로 다음 씬으로 가도 앞 씬 그림·저장됨이 새지 않고, 새 저장을 앞 저장이 지우지 않는다', () => {
  // 씬 A 스토리보드에 붙여넣기(저장 1) → 미리보기
  let state = beginImageSave(EMPTY_IMAGE_SAVE, 'storyboard', 'A', 1);
  state = showImageSavePreview(state, 'storyboard', 1, 'data:a');
  assert.deepEqual(imageSaveView(state, 'storyboard', 'A'), { sceneKey: 'A', token: 1, saving: true, preview: 'data:a' });
  // 곧바로 → 씬 B: 앞 씬의 미리보기·저장 중이 보이지 않는다.
  assert.deepEqual(imageSaveView(state, 'storyboard', 'B'), { saving: false });
  // 씬 B 에서 바로 또 붙여넣기(저장 2)
  state = beginImageSave(state, 'storyboard', 'B', 2);
  state = showImageSavePreview(state, 'storyboard', 2, 'data:b');
  // 앞 저장(1)이 원격 그림을 다 받고 마무리 — 새 저장의 미리보기·저장 중을 지우지 않는다.
  const afterStale = finishImageSave(state, 'storyboard', 1, 5000);
  assert.equal(afterStale, state, '번호가 다르면 아무것도 바꾸지 않는다');
  assert.equal(showImageSavePreview(state, 'storyboard', 1, 'data:late'), state, '늦게 온 앞 저장의 미리보기도 무시');
  assert.deepEqual(imageSaveView(afterStale, 'storyboard', 'B'), { sceneKey: 'B', token: 2, saving: true, preview: 'data:b' });
  // 새 저장 마무리 → 저장됨 시각, 미리보기 걷힘
  state = finishImageSave(state, 'storyboard', 2, 6000);
  assert.deepEqual(imageSaveView(state, 'storyboard', 'B'), { sceneKey: 'B', token: 2, saving: false, savedAt: 6000 });
  assert.deepEqual(imageSaveView(state, 'storyboard', 'A'), { saving: false }, "다른 씬에 '저장됨 ✓' 이 뜨지 않는다");
  // 실패는 저장 중만 풀고 저장됨은 없다. 칸끼리는 따로.
  let other = beginImageSave(state, 'guide', 'B', 3);
  other = finishImageSave(other, 'guide', 3, null);
  assert.deepEqual(imageSaveView(other, 'guide', 'B'), { sceneKey: 'B', token: 3, saving: false });
  assert.equal(imageSaveView(other, 'storyboard', 'B').savedAt, 6000);
  // 지우기·주석 반영은 지금 씬의 그 칸만 비운다(다른 씬 것은 그대로).
  assert.equal(clearImageSave(other, 'storyboard', 'A'), other);
  assert.equal(clearImageSave(other, 'storyboard', 'B').storyboard, undefined);
  assert.equal(finishImageSave(clearImageSave(beginImageSave(EMPTY_IMAGE_SAVE, 'guide', 'B', 9), 'guide', 'B'), 'guide', 9, 1).guide, undefined,
    '비운 칸에는 진행 중이던 저장의 마무리도 되살아나지 않는다');
});

/* ─── 소스 가드 ─────────────────────────────────────────────── */

const SCENE = read('src/components/scenes/SceneDetailModal.tsx');
const UNIFIED = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
const CONTINUITY = read('src/components/scenes/SceneContinuityTransition.tsx');
const HOOK = read('src/hooks/useSceneFlip.ts');
const SCENES_VIEW = read('src/views/ScenesView.tsx');
const CSS = read('src/styles/motion-scene-flow.css');

test('두 상세 창 모두: 닫기 요청은 closing 으로 받아 exit 를 다 돌린 뒤 부모 onClose (Esc·바깥 클릭·닫기 버튼·바깥 신호)', () => {
  for (const [name, src] of [['SceneDetailModal', SCENE], ['UnifiedSceneDetailModal', UNIFIED]] as const) {
    assert.match(src, /<AnimatePresence onExitComplete=\{(?:dockMode === 'modal' \? )?finishClose/, `${name}: exit 이 끝나면 부모 onClose`);
    assert.match(src, /!closing && \(/, `${name}: closing 이면 창 묶음을 빼서 exit 이 돈다`);
    assert.match(src, /exit=\{modalMotion\.shellExit\}/, `${name}: 본체+댓글 패널이 같이 가라앉는다`);
    assert.match(src, /exit=\{modalMotion\.backdropExit\}/, `${name}: 뒤 화면이 서서히 밝아진다`);
    assert.match(src, /if \(closingRef\.current\) return;/, `${name}: 닫히는 동안 연타·단축키 무시`);
    assert.match(src, /style\.pointerEvents = 'none'/, `${name}: 가라앉는 동안 창 안 클릭 막기`);
    assert.match(src, /useEffect\(\(\) => \(\) => finishClose\(\), \[finishClose\]\)/, `${name}: 닫히다 언마운트돼도 부모 정리`);
    assert.match(src, /closeRequestToken/, `${name}: 바깥 닫기 신호도 같은 길`);
    assert.match(src, /backdropMouseDownRef\.current && e\.target === e\.currentTarget\) (?:\{\s*)?requestClose\(\)/, `${name}: 바깥 클릭`);
    assert.doesNotMatch(src, /exit=\{\{ opacity: 0, scale: 0\.9[56]/, `${name}: framer 개별 scale 로 닫지 않는다`);
  }
  // 부서 전환은 같은 컷을 바로 다시 여는 흐름 — 부모 onClose 를 바로 부른다(부드러운 닫힘을 기다리면 재오픈과 엇갈린다).
  assert.match(UNIFIED, /setDashboardDeptFilter\(next\);\n\s+onClose\(\);/);
  assert.match(SCENE, /<DeptToggle [^>]*onClose=\{onClose\}/);
  // ScenesView: 상세 창이 떠 있으면 닫기 신호를 바로 상태 비우기 대신 창에 넘긴다
  assert.match(SCENES_VIEW, /setSceneModalCloseToken\(\(n\) => n \+ 1\)/);
  assert.equal(SCENES_VIEW.match(/closeRequestToken=\{sceneModalCloseToken\}/g)?.length, 2);
});

test('ScenesView: 닫기 신호를 소비하기 전 렌더부터 가라앉는 동안 내내 단일 창 대상이 고정된다(점프·뒤로 가기)', () => {
  // 신호 값·소비 기록은 detailScene 계산보다 먼저 있어야 같은 렌더에서 대상을 고정할 수 있다.
  const signalAt = SCENES_VIEW.indexOf('const closeSceneModalSignal = useAppStore((s) => s.closeSceneModalSignal);');
  const detailAt = SCENES_VIEW.indexOf('const detailScene = (() => {');
  assert.ok(signalAt > 0 && signalAt < detailAt);
  assert.match(SCENES_VIEW, /closePending: closeSceneModalSignal !== lastCloseSignalRef\.current \|\| closingDetailPinRef\.current !== null,\n\s+pinned: closingDetailPinRef\.current \?\? detailPinRef\.current,/);
  assert.match(SCENES_VIEW, /detailPinRef\.current = resolvedDetail\.pin;\n\s+const shownDetailContext = resolvedDetail\.context;/);
  // 고정은 닫힘이 끝날 때(onClose)·닫힌 뒤 풀린다
  assert.match(SCENES_VIEW, /if \(detailSceneIndex === null\) closingDetailPinRef\.current = null;/);
  assert.match(SCENES_VIEW, /onClose=\{\(\) => \{ closingDetailPinRef\.current = null; setDetailSceneIndex\(null\);/);
  const derive = SCENES_VIEW.slice(detailAt, SCENES_VIEW.indexOf('// 필터링', detailAt));
  assert.doesNotMatch(derive, /\bdetailContext\b/, 'detailScene·시트·부서는 고정된 대상(shownDetailContext)으로 계산');
  // effect: 토큰을 올리기 전에 대상을 detailContext 로 고정
  assert.match(SCENES_VIEW, /const pin = detailPinRef\.current;\n\s+closingDetailPinRef\.current = pin;\n\s+if \(pin\) setDetailContext\(\(prev\) => prev \?\? pin\);\n\s+setSceneModalCloseToken\(\(n\) => n \+ 1\);/);
  // 상세 창의 이전/다음 목록도 같은 대상 기준
  assert.match(SCENES_VIEW, /if \(shownDetailContext\) \{\n\s+const part = allParts\.find\(\(p\) => p\.sheetName === shownDetailContext\.sheetName\);\n\s+return part\?\.scenes \?\? \[\];/);
});

test('씬 넘김: 창 틀은 제자리(옛 통째 흔들림 제거), 본문 카드만 지나가고 키·버튼·도트 모두 같은 길', () => {
  assert.doesNotMatch(UNIFIED, /useAnimationControls|wrapperControls|navVariants|mode="wait"/);
  for (const src of [SCENE, UNIFIED]) {
    assert.match(src, /useSceneFlip\(\{/);
    assert.match(src, /className="sf-flip-viewport/);
    assert.match(src, /sf-title-slot/);
    assert.match(src, /flip\.bounce\(dir\)/);
    assert.match(src, /flip\.allowKey\(e\.repeat\)/);
    assert.match(src, /flip\.peek\('next'\)/);
    assert.match(src, /sf-peek sf-peek--next/);
    // 도트로 여러 칸 건너뛰어도 목표 순번으로 한 번에 가고 카드는 한 번만 넘긴다(검증 지적 acc-scene-flow-7 —
    // 예전처럼 onNavigate 를 칸 수만큼 부르면 부모가 닫아 둔 순번 때문에 한 칸만 갔다).
    assert.match(src, /if \(onNavigateTo\) \{\n\s+flip\.prepare\(dir === 'next' \? 1 : -1\);\n\s+onNavigateTo\(i\);/);
    assert.doesNotMatch(src, /setTimeout\(\(\) => onNavigate\(/, '도트가 onNavigate 를 여러 번 부르지 않는다');
    // 도트 폭은 바로 바꾼다(되살아난 transition-all 이 폭을 0.3초 늘리던 것)
    assert.doesNotMatch(src, /'rounded-full transition-all duration-300 cursor-pointer'/);
  }
  // 통합 창: 씬·탭이 바뀌면 key 로 새로 그려 스크롤·안쪽 상태가 처음부터(예전과 같음).
  // 씬은 목록 순번이 아니라 정체(mergedKey)로 본다 — 머무름이 끝나 순번이 바뀌어도 다시 그리지 않는다(acc-scene-flow-5).
  assert.match(UNIFIED, /key=\{`body:\$\{tab\}:\$\{sceneIdentity\}`\}\n\s+ref=\{flipLayerRef\}/);
  assert.match(UNIFIED, /const sceneIdentity = merged\.mergedKey \|\| merged\.sceneId;/);
  assert.match(UNIFIED, /useSceneFlip\(\{\n\s+identity: sceneIdentity,/);
});

test('넘김 훅: 고스트는 transform·opacity 만(WAAPI), 끝나면 지우고, 들어오는 쪽은 fill backwards 라 transform 이 남지 않는다', () => {
  assert.match(HOOK, /cloneNode\(true\)/);
  assert.match(HOOK, /setAttribute\('inert', ''\)/);
  assert.match(HOOK, /removeAttribute\('id'\)/, '같은 id 로 다른 코드를 헷갈리게 하지 않는다');
  assert.match(HOOK, /style\.zIndex = '-1'/);
  assert.match(HOOK, /fill: 'backwards'/);
  assert.doesNotMatch(HOOK, /fill: 'both'/);
  assert.match(HOOK, /anim\.onfinish = remove/);
  assert.match(HOOK, /while \(list\.length > SCENE_FLIP\.maxGhosts\)/, '연타로 쌓이는 고스트 상한');
  assert.doesNotMatch(HOOK, /(?:width|height|left|top|filter|boxShadow)\s*:\s*\[/, '레이아웃·흐림 키프레임 금지');
  assert.match(CSS, /\.sf-flip-viewport \{\n\s+position: relative;\n\}/);
  assert.match(CSS, /\.sf-title-slot \{\n\s+position: relative;\n\s+isolation: isolate;/);
  // 본문 칸은 움직이는 동안만 쌓임 맥락(평소 펼침 메뉴 겹침 순서는 그대로)
  assert.match(HOOK, /viewport\.style\.isolation = 'isolate';[\s\S]*viewport\.style\.isolation = '';/);
  // 준비 소비는 순수 함수가 정한 대로(도트 여러 칸·오래된 준비)
  assert.match(HOOK, /const \{ ready, keep \} = advancePendingFlip\(pendingRef\.current, now\(\)\);\n\s+pendingRef\.current = keep;\n\s+if \(ready\) run\(ready\);/);
});

test('연결 확대(SceneContinuityTransition): 균등 확대 + 처음 30% 투명, filter 없음, 끝나고 transform 이 남지 않음', () => {
  assert.match(CONTINUITY, /continuityStartTransform\(sourceRect, targetRect\)/);
  assert.match(CONTINUITY, /\{ opacity: 1, offset: 0\.3 \}/);
  assert.doesNotMatch(CONTINUITY, /scaleX|scaleY|filter:|blur\(/);
  assert.doesNotMatch(CONTINUITY, /fill: 'both'/);
  assert.match(read('src/index.css'), /\.bflow-continuity-live-root \{\n\s+transform-origin: top left;\n\s+will-change: transform, opacity;\n/);
});

test('통합 창: 움직이는 동안 다시 그려지던 흐림 제거(헤더 뒤 흐림·배경 글로우 filter blur)', () => {
  assert.doesNotMatch(UNIFIED, /backdropFilter: 'blur\(20px\)'/);
  assert.doesNotMatch(UNIFIED, /filter: 'blur\((?:40|50)px\)'/);
  assert.doesNotMatch(SCENE, /bg-bg-card\/95 backdrop-blur-md/, '단일 창 머리줄도 불투명 배경');
});

test('탭 전환 0.15초: 직접 누른 탭만, 누른 쪽에서 — 끝나면 transform 이 남지 않고 동작 줄이기는 0.12초 투명도', () => {
  assert.match(UNIFIED, /onClick=\{\(\) => selectTab\('history'\)\}/);
  assert.match(UNIFIED, /tabShift !== null && 'sf-tab-fade'/);
  assert.match(CSS, /\.sf-tab-fade \{\n\s+animation: sf-tab-in 150ms var\(--ease-out\) backwards;/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.sf-tab-fade \{\n\s+animation-name: sf-tab-in-calm !important;\n\s+animation-duration: 120ms !important;/);
});

test('이미지 붙여넣기: 미리보기를 바로 띄우고(살짝 어둡게 + 아래 줄), 원격 그림을 미리 받은 뒤 걷고 저장됨 칩 — 칸 높이 고정', () => {
  // 통합 창: 그림이 있으면 저장 중에도 그림을 보여 준다(예전엔 저장 중 칸이 먼저라 미리보기가 안 보였다)
  assert.match(UNIFIED, /\{loading && !url \? \(/);
  assert.match(UNIFIED, /loading && 'sf-img--saving'/);
  assert.match(UNIFIED, /className="sf-upload-bar"/);
  assert.match(UNIFIED, /await preloadImage\(url\);\n\s+setImageSave\(\(s\) => finishImageSave\(s, imageType, token, Date\.now\(\)\)\);/);
  // 칸별 저장 상태: 시작할 때 씬 키·번호, 화면은 지금 씬 키로 거른다(리뷰 반영)
  assert.match(UNIFIED, /const token = \+\+imageSaveTokenRef\.current;\n\s+setImageSave\(\(s\) => beginImageSave\(s, imageType, imageSceneKey, token\)\);/);
  assert.match(UNIFIED, /setImageSave\(\(s\) => showImageSavePreview\(s, imageType, token, base64\)\);/);
  assert.match(UNIFIED, /setImageSave\(\(s\) => finishImageSave\(s, imageType, token, null\)\);/);
  assert.doesNotMatch(UNIFIED, /setImageLoading|setPreviewUrls|setSavedAt/, '모달 단위(씬 구분 없는) 저장 표시 상태를 다시 두지 않는다');
  assert.match(UNIFIED, /url=\{storyboardSave\.preview \?\? latestImageUrls\.storyboard \?\? bgScene\?\.storyboardUrl \?\? ''\}/);
  assert.match(UNIFIED, /savedAt=\{guideSave\.savedAt\}/);
  // 붙여넣기 구독이 씬을 넘겨도 다시 걸리지 않는 경우(두 씬 그림 주소가 같음)에도 지금 씬의 저장 함수를 쓴다
  assert.match(UNIFIED, /const ok = await uploadImageRef\.current\(blob, imageType\);/);
  assert.match(UNIFIED, /\n\s+uploadImageRef\.current = uploadImage;\n/);
  const slot = UNIFIED.slice(UNIFIED.indexOf('function UnifiedImageSlot('), UNIFIED.indexOf('/* ── 확인 다이얼로그 ── */'));
  assert.ok(slot.length > 0);
  assert.doesNotMatch(slot, /\bh-32\b/, '빈 칸·저장 중·그림 모두 h-40');
  assert.doesNotMatch(slot, /backdrop-blur-sm" title=/, 'hover 버튼 뒤 흐림 제거');
  assert.match(slot, /opacity-0 group-hover:opacity-100 transition-opacity duration-150/);
  // 단일 창: 업로드 중 흐림 덮개 대신 같은 표시, 모든 업로드 길이 같은 마무리를 지난다
  assert.match(SCENE, /uploading && 'sf-img--saving'/);
  assert.doesNotMatch(SCENE, /업로드중\.\.\./);
  assert.equal(SCENE.match(/saveSlotImage\(\s*imageType,/g)?.length, 5, '붙여넣기·파일·클립보드·칸 붙여넣기·드롭 모두 한 길');
  assert.match(SCENE, /await preloadImage\(url\);\n\s+setImageSave\(\(s\) => finishImageSave\(s, imageType, token, Date\.now\(\)\)\);/);
  assert.match(SCENE, /const token = \+\+imageSaveTokenRef\.current;\n\s+setImageSave\(\(s\) => beginImageSave\(s, imageType, imageSceneKey, token\)\);/);
  assert.doesNotMatch(SCENE, /setImageLoading|setPreviewUrls|setSavedAt/);
  assert.match(SCENE, /loading=\{storyboardSave\.saving && !storyboardSave\.preview\}\n\s+uploading=\{storyboardSave\.saving && !!storyboardSave\.preview\}/);
  // 읽기 전용 칸(액팅 창의 BG 그림) hover: 숨은 흐림 없이 고정 배경 위 투명도만
  const readonlySlot = SCENE.slice(SCENE.indexOf('function ReadOnlyImagePreview('), SCENE.indexOf('// ─── 메인 모달'));
  assert.ok(readonlySlot.length > 200);
  assert.doesNotMatch(readonlySlot, /backdrop-blur|transition-colors/);
  assert.match(readonlySlot, /bg-overlay\/30 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150/);
  // 저장됨 칩: 타이머로 지워 동작 줄이기에서도 1.2초 읽힌다
  assert.match(HOOK, /export function useSavedFlash/);
  assert.match(CSS, /\.sf-saved-chip \{\n\s+animation: none !important;/);
  assert.match(CSS, /\.sf-upload-bar::after \{\n\s+animation: none !important;/);
});
