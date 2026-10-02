import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SAVED_CHIP_MS,
  SCENE_FLIP,
  SCENE_FLIP_EASE_CSS,
  SCENE_MODAL_CLOSE_MS,
  continuityStartTransform,
  isChainedFlip,
  planSceneFlip,
  planTitleRoll,
  preloadImage,
  rubberBandKeyframes,
  sceneModalMotion,
  shouldSkipRepeatedKey,
  tabShiftPx,
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
    // 도트로 여러 칸 건너뛰어도 카드는 한 번만 넘긴다
    assert.match(src, /flip\.prepare\([^)]*,\s*(?:steps|currentSceneIndex - i|i - currentSceneIndex)\)/);
    // 도트 폭은 바로 바꾼다(되살아난 transition-all 이 폭을 0.3초 늘리던 것)
    assert.doesNotMatch(src, /'rounded-full transition-all duration-300 cursor-pointer'/);
  }
  // 통합 창: 씬·탭이 바뀌면 key 로 새로 그려 스크롤·안쪽 상태가 처음부터(예전과 같음)
  assert.match(UNIFIED, /key=\{`body:\$\{tab\}:\$\{currentMergedIndex\}`\}\n\s+ref=\{flipLayerRef\}/);
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
  assert.match(UNIFIED, /await preloadImage\(url\);\n\s+setPreviewUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: undefined \}\)\);\n\s+setSavedAt/);
  const slot = UNIFIED.slice(UNIFIED.indexOf('function UnifiedImageSlot('), UNIFIED.indexOf('/* ── 확인 다이얼로그 ── */'));
  assert.ok(slot.length > 0);
  assert.doesNotMatch(slot, /\bh-32\b/, '빈 칸·저장 중·그림 모두 h-40');
  assert.doesNotMatch(slot, /backdrop-blur-sm" title=/, 'hover 버튼 뒤 흐림 제거');
  assert.match(slot, /opacity-0 group-hover:opacity-100 transition-opacity duration-150/);
  // 단일 창: 업로드 중 흐림 덮개 대신 같은 표시, 모든 업로드 길이 같은 마무리를 지난다
  assert.match(SCENE, /uploading && 'sf-img--saving'/);
  assert.doesNotMatch(SCENE, /업로드중\.\.\./);
  assert.equal(SCENE.match(/await commitSavedImage\(imageType, url\);/g)?.length, 5);
  assert.match(SCENE, /await preloadImage\(url\);\n\s+setPreviewUrls/);
  // 저장됨 칩: 타이머로 지워 동작 줄이기에서도 1.2초 읽힌다
  assert.match(HOOK, /export function useSavedFlash/);
  assert.match(CSS, /\.sf-saved-chip \{\n\s+animation: none !important;/);
  assert.match(CSS, /\.sf-upload-bar::after \{\n\s+animation: none !important;/);
});
