import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONTENT_SWAP_KEYFRAMES,
  CONTENT_SWAP_MS,
  CONTENT_SWAP_SHIFT,
  INITIAL_SWAP_STATE,
  dateCardPreset,
  imageLayersOnReady,
  imageLayersOnSettled,
  imageLayersOnTarget,
  imageLayersWithTopLook,
  imageSwapKeyframes,
  initialImageLayers,
  nextSwapState,
  sidePanelPreset,
  swapDirectionBetween,
  swapInClassName,
  type ImageSwapLayer,
  type SwapState,
} from '../../src/utils/contentSwap.ts';

/* 움직임 폴리싱 11번 content-swap-in-place — 항목을 바꿔 볼 때 창 틀은 제자리, 내용만 스르륵.
   옆 상세 창: 첫 열림만 24px 250ms(닫힘 180ms), 교체는 내용만 140ms 4px 떠오름(색 띠는 바로).
   캐릭터 그림: 옛 그림 위로 새 그림이 준비된 뒤 누른 쪽 6px 에서 160ms. 동작 줄이기: opacity 만 100ms. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
/** 주석을 뺀 코드만 — 설명 글에 같은 낱말이 나와도 세지 않게. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = code('src/styles/motion-popups-panels.css');

const keyframes = (name: string) => {
  const match = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `@keyframes ${name} 없음`);
  return match[1];
};
const rule = (selector: string, source = css) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} 규칙 없음`);
  return match[1];
};

/* ─── 첫 열림 / 교체 구분 ─── */

test('첫 열림은 교체가 아니고, 열린 채 다른 항목으로 바뀐 뒤로는 계속 교체다', () => {
  const run = (keys: Array<string | null>) => {
    let state: SwapState = INITIAL_SWAP_STATE;
    return keys.map((key) => (state = nextSwapState(state, key)).swapped);
  };
  // 닫힘 → A 열림(첫 열림) → A 그대로 → B 로 교체 → 다시 A(여전히 교체) → 닫힘 → C 열림(다시 첫 열림)
  assert.deepEqual(run([null, 'a', 'a', 'b', 'a', null, 'c', 'c']), [false, false, false, true, true, false, false, false]);
});

test('같은 key 로 여러 번 불러도 같은 상태 객체 — 렌더가 두 번 돌아도 안전하다', () => {
  const opened = nextSwapState(INITIAL_SWAP_STATE, 'a');
  assert.equal(nextSwapState(opened, 'a'), opened);
  const swapped = nextSwapState(opened, 'b');
  assert.equal(nextSwapState(swapped, 'b'), swapped);
  assert.equal(nextSwapState(INITIAL_SWAP_STATE, null), INITIAL_SWAP_STATE);
  assert.equal(nextSwapState(INITIAL_SWAP_STATE, undefined), INITIAL_SWAP_STATE);
});

test('안쪽 내용 교체 클래스는 교체일 때만, 휴가 카드는 짧은 변형', () => {
  assert.equal(swapInClassName(false), '');
  assert.equal(swapInClassName(false, true), '');
  assert.equal(swapInClassName(true), 'bf-swap-in');
  assert.equal(swapInClassName(true, true), 'bf-swap-in bf-swap-quick');
});

/* ─── 누른 쪽 ─── */

test('누른 쪽: 뒤쪽 항목이면 오른쪽(1), 앞쪽이면 왼쪽(-1), 목록 밖·같은 항목은 제자리(0)', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(swapDirectionBetween(order, 'a', 'c'), 1);
  assert.equal(swapDirectionBetween(order, 'c', 'b'), -1);
  assert.equal(swapDirectionBetween(order, 'b', 'b'), 0);
  assert.equal(swapDirectionBetween(order, 'other-costume-image', 'a'), 0);
  assert.equal(swapDirectionBetween(order, null, 'a'), 0);
  assert.equal(swapDirectionBetween(order, 'a', null), 0);
});

test('그림 키프레임: ‹ 는 왼쪽 6px, › 는 오른쪽 6px 에서 들어와 transform 을 비운다. 방향이 없으면 opacity 만', () => {
  assert.deepEqual(imageSwapKeyframes(-1), [{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }]);
  assert.deepEqual(imageSwapKeyframes(1), [{ opacity: 0, transform: 'translateX(6px)' }, { opacity: 1, transform: 'none' }]);
  assert.deepEqual(imageSwapKeyframes(0), [{ opacity: 0 }, { opacity: 1 }]);
  assert.deepEqual(CONTENT_SWAP_KEYFRAMES, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }]);
});

/* ─── 캐릭터 그림 겹쳐 바꾸기 ─── */

type Look = { bg: string };
const layer = (src: string, phase: ImageSwapLayer<Look>['phase'], bg = src, direction: -1 | 0 | 1 = 0): ImageSwapLayer<Look> => ({ src, phase, direction, look: { bg } });

test('그림 교체: 옛 그림은 아래층에 그대로, 새 그림은 받는 중(안 보임) → 준비되면 떠오름 → 다 떠오르면 아래층을 지운다', () => {
  let layers = initialImageLayers('a.png', { bg: 'white' });
  assert.deepEqual(layers, [layer('a.png', 'settled', 'white')]);
  layers = imageLayersOnTarget(layers, 'b.png', 1, { bg: 'black' });
  assert.deepEqual(layers, [layer('a.png', 'settled', 'white'), layer('b.png', 'loading', 'black', 1)], '옛 그림은 옛 배경 그대로');
  layers = imageLayersOnReady(layers, 'b.png');
  assert.deepEqual(layers.map((l) => l.phase), ['settled', 'entering']);
  layers = imageLayersOnSettled(layers, 'b.png');
  assert.deepEqual(layers, [layer('b.png', 'settled', 'black', 1)]);
});

test('그림 교체: 받는 중에 또 넘기면 받던 그림은 버리고 아래층은 그대로(빈 칸 없음)', () => {
  let layers = imageLayersOnTarget(initialImageLayers('a.png', { bg: 'a' }), 'b.png', 1, { bg: 'b' });
  layers = imageLayersOnTarget(layers, 'c.png', 1, { bg: 'c' });
  assert.deepEqual(layers.map((l) => [l.src, l.phase]), [['a.png', 'settled'], ['c.png', 'loading']]);
  // 늦게 도착한 b 의 준비·완료 신호는 무시
  assert.equal(imageLayersOnReady(layers, 'b.png'), layers);
  assert.equal(imageLayersOnSettled(layers, 'b.png'), layers);
  // 원래 그림으로 돌아오면 받던 것만 버린다
  assert.deepEqual(imageLayersOnTarget(layers, 'a.png', -1, { bg: 'a' }).map((l) => [l.src, l.phase]), [['a.png', 'settled']]);
});

test('그림 교체: 떠오르는 중에 또 넘기면 그 그림을 다 뜬 것으로 아래층에 두고 다음 그림을 받는다', () => {
  let layers = imageLayersOnTarget(initialImageLayers('a.png', { bg: 'a' }), 'b.png', 1, { bg: 'b' });
  layers = imageLayersOnReady(layers, 'b.png');
  layers = imageLayersOnTarget(layers, 'c.png', -1, { bg: 'c' });
  assert.deepEqual(layers.map((l) => [l.src, l.phase, l.direction]), [['b.png', 'settled', 1], ['c.png', 'loading', -1]]);
});

test('그림 교체: 같은 그림의 배경·구도만 바꾸면 맨 위 층 모습만 그 자리에서 바뀐다', () => {
  const layers = [layer('a.png', 'settled', 'white'), layer('b.png', 'entering', 'white')];
  const same = (x: Look, y: Look) => x.bg === y.bg;
  assert.equal(imageLayersWithTopLook(layers, { bg: 'white' }, same), layers);
  assert.deepEqual(imageLayersWithTopLook(layers, { bg: 'checker' }, same).map((l) => l.look.bg), ['white', 'checker']);
});

/* ─── 창 셸 프리셋 ─── */

test('옆 상세 창 셸: 첫 열림 24px·250ms·out, 닫힘 [제자리→24px]·180ms·in, transform 은 끝나면 비운다', () => {
  const full = sidePanelPreset(false);
  assert.deepEqual(full.initial, { opacity: 0, transform: 'translateX(24px)' });
  assert.deepEqual(full.animate, { opacity: 1, transform: 'translateX(0px)', transitionEnd: { transform: 'none' } });
  assert.deepEqual(full.transition, { duration: 0.25, ease: [0.16, 1, 0.3, 1] });
  assert.deepEqual(full.exit, { opacity: 0, transform: ['translateX(0px)', 'translateX(24px)'], transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } });
  assert.equal(sidePanelPreset(false), full, '같은 객체 — 렌더마다 새로 만들지 않는다');
});

test('동작 줄이기: 창 셸·날짜 카드 모두 움직임 없이 opacity 만 100ms', () => {
  for (const preset of [sidePanelPreset(true), dateCardPreset(true)]) {
    assert.deepEqual(preset.initial, { opacity: 0 });
    assert.deepEqual(preset.animate, { opacity: 1 });
    assert.equal((preset.transition as { duration: number }).duration, 0.1);
    assert.equal(JSON.stringify(preset).includes('transform'), false);
  }
});

test('휴가 날짜 카드 셸: 6px 아래에서 180ms, 닫힐 때 4px 위로 120ms(높이는 움직이지 않는다)', () => {
  const full = dateCardPreset(false);
  assert.deepEqual(full.initial, { opacity: 0, transform: 'translateY(6px)' });
  assert.deepEqual(full.exit, { opacity: 0, transform: ['translateY(0px)', 'translateY(-4px)'], transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } });
  assert.equal(JSON.stringify(full).includes('height'), false);
});

/* ─── CSS 박자 ─── */

test('CSS: 내용 교체 140ms(휴가 120ms)·4px, 타임라인 상세 창 200ms·16px — contentSwap.ts 와 같은 값', () => {
  assert.equal(CONTENT_SWAP_MS.content, 140);
  assert.equal(CONTENT_SWAP_SHIFT.content, 4);
  assert.match(keyframes('bf-swap-in'), /from \{ opacity: 0; transform: translateY\(4px\); \}/);
  assert.match(rule('.bf-swap-in'), new RegExp(`animation: bf-swap-in ${CONTENT_SWAP_MS.content}ms var\\(--ease-out\\) backwards;`));
  assert.match(rule('.bf-swap-in.bf-swap-quick'), new RegExp(`animation-duration: ${CONTENT_SWAP_MS.contentQuick}ms;`));
  assert.match(keyframes('bf-inspector-in'), new RegExp(`from \\{ opacity: 0; transform: translateX\\(${CONTENT_SWAP_SHIFT.inspector}px\\); \\}`));
  assert.match(css, new RegExp(`\\.gantt \\.gantt-inspector,\\n\\.gantt \\.gantt-inspector-shell \\{\\n  animation: bf-inspector-in ${CONTENT_SWAP_MS.inspector}ms var\\(--ease-out\\) backwards;`));
  // 너비·높이는 움직이지 않는다
  assert.doesNotMatch(keyframes('bf-swap-in') + keyframes('bf-inspector-in'), /width|height/);
});

test('CSS: 동작 줄이기에서 내용 교체·타임라인 상세 창은 opacity 만 100ms', () => {
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  for (const selector of ['.bf-swap-in', '.bf-swap-in.bf-swap-quick', '.gantt .gantt-inspector', '.gantt .gantt-inspector-shell']) {
    assert.ok(reduce.includes(selector), `${selector} 가 reduce 블록에 없음`);
  }
  assert.match(reduce, new RegExp(`animation: bf-fade-in ${CONTENT_SWAP_MS.reduced}ms linear backwards !important;`));
});

/* ─── 화면 연결(소스 가드) ─── */

test('캘린더: 바깥 셸은 key 고정이라 교체 때 다시 움직이지 않고, 안쪽 창은 일정 key 로 새로 그린다(초안은 지금처럼 버려짐)', () => {
  const view = code('src/views/ScheduleView.tsx');
  const block = view.match(/<motion\.div\n\s+key="event-side-panel"[\s\S]*?<\/motion\.div>/);
  assert.ok(block, '상세 창 바깥 셸');
  assert.match(block[0], /\{\.\.\.sidePanelPreset\(reduce\)\}/);
  assert.match(block[0], /<EventSidePanel\n\s+key=\{`panel-\$\{panelEventKey\}`\}/);
  assert.match(block[0], /swapIn=\{panelSwapIn\}/);
  assert.match(view, /const panelSwapIn = useSwapIn\(panelEventKey\);/);

  const panel = code('src/components/calendar/EventSidePanel.tsx');
  assert.doesNotMatch(panel, /framer-motion|<motion\./, '창 자체는 움직이지 않는다(셸이 맡음)');
  assert.doesNotMatch(panel, /x: 300/);
  assert.match(panel, /backdropFilter: 'none'/, '움직이는 창에 흐림 금지');
  // 색 띠는 교체 클래스 밖(바로 새 색), 헤더·본문만 떠오른다
  const stripe = panel.indexOf('linear-gradient(90deg, ${event.color}');
  const firstSwap = panel.indexOf('swapInClassName(swapIn)');
  assert.ok(stripe > 0 && firstSwap > stripe);
  assert.equal(panel.match(/swapInClassName\(swapIn\)/g)?.length, 2);
});

test('캘린더 새 일정·캘린더 설정 창: 같은 창 박자, 동작 줄이기 분기, 흐림 없음', () => {
  for (const path of ['src/components/calendar/EventCreateModal.tsx', 'src/components/calendar/CalendarSettingsModal.tsx']) {
    const source = code(path);
    assert.match(source, /\{\.\.\.sidePanelPreset\(prefersReducedMotion\(\)\)\}/, path);
    assert.doesNotMatch(source, /x: 40/, path);
    assert.match(source, /backdropFilter: 'none'/, path);
  }
});

test('리테이크: 칸(셸)은 너비를 움직이지 않고, 내용은 리테이크 key 로 새로 그려 메모 등 상태가 항목마다 비워진다', () => {
  const panel = code('src/views/compositing/RevisionDetailPanel.tsx');
  assert.doesNotMatch(panel, /width: 0|width: 380/, '너비 애니메이션 금지');
  assert.match(panel, /export const DetailPanel = forwardRef<HTMLDivElement, DetailPanelProps>/);
  assert.match(panel, /<DetailPanelContent key=\{props\.revision\.id\} \{\.\.\.props\} swapIn=\{swapIn\} \/>/);
  // 상태는 안쪽(DetailPanelContent)에 있어야 항목마다 초기화된다
  const content = panel.slice(panel.indexOf('function DetailPanelContent('));
  assert.match(content, /const \[showResolveNote, setShowResolveNote\] = useState\(false\);/);
  assert.match(content, /const \[resolveNote, setResolveNote\] = useState\(''\);/);
  assert.match(content, /const \[noteEditingFor, setNoteEditingFor\] = useState<string \| null>\(null\);/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf('function DetailPanelContent(')), /useState\(/);
  assert.doesNotMatch(panel, /style=\{elevatedGlassStyle\}/, '움직이는 칸 안 흐림 카드 금지');

  const view = code('src/views/CompositingView.tsx');
  assert.match(view, /<AnimatePresence mode="popLayout">\n\s+\{selectedRevision && \(\n\s+<DetailPanel\n\s+key="revision-detail"/);
  assert.match(view, /<div className="relative h-full flex overflow-x-clip bg-bg-primary\/40">/);
});

test('휴가: 카드 틀은 key 고정(mode wait 제거), 안쪽만 날짜 key 로 바뀌고 흐림 없음', () => {
  const view = code('src/views/VacationView.tsx');
  const block = view.match(/key="selected-date-detail"[\s\S]*?<\/motion\.div>/);
  assert.ok(block);
  assert.match(block[0], /\{\.\.\.dateCardPreset\(reduce\)\}/);
  assert.match(block[0], /className="bg-bg-card\/60 rounded-xl border border-bg-border\/30 p-4"/);
  assert.match(block[0], /<div key=\{selectedDate\} className=\{swapInClassName\(dateSwapIn, true\) \|\| undefined\}>/);
  assert.doesNotMatch(block[0], /backdrop-blur/);
  const before = view.slice(0, view.indexOf('key="selected-date-detail"'));
  assert.doesNotMatch(before.slice(before.lastIndexOf('<AnimatePresence')), /mode="wait"/);
});

test('타임라인: 연결 캘린더 창(작업마다 새로 그림)은 바깥 셸에서 처음 열릴 때만 밀려 들어온다', () => {
  const view = read('src/features/gantt/GanttView.tsx');
  assert.match(view, /<div className="gantt-inspector-shell flex flex-none min-h-0 min-w-0"><LinkedCalendarPanel key=\{`\$\{user\.id\}:\$\{p\.id\}:\$\{task\?\.id\|\|''\}`\}/);
  assert.match(view, /setInspecting\(false\);\}\}\/><\/div>\}/);
  // GanttInspector 는 key 가 없어 작업을 바꿔도 다시 재생되지 않는다(의도)
  assert.match(view, /\{inspecting&&p&&!p\.calendarLink&&<GanttInspector project=\{p\}/);
});

test('캐릭터 그림: 카드 ‹ › 는 누른 쪽으로, 상세 큰 미리보기는 고른 순서로 겹쳐 바꾸고, 다른 표면은 지금 그대로', () => {
  const card = code('src/components/characters/CharacterCard.tsx');
  assert.match(card, /const stepCostume = \(dir: 1 \| -1\) => \{\n\s+setSwapDirection\(dir\);/);
  assert.match(card, /swapDirection=\{swapDirection\}/);
  const slot = code('src/components/characters/FeaturedImageSlot.tsx');
  assert.match(slot, /useSwapDirection\(selectedImage\?\.id \?\? null, images\.map\(\(image\) => image\.id\)\)/);
  assert.match(slot, /swapDirection=\{imageSwapDirection\}/);

  const frame = code('src/components/characters/CharacterImageFrame.tsx');
  assert.match(frame, /const layered = Boolean\(url && !failed && swapDirection !== undefined\);/, '넘긴 표면만 겹쳐 바꾸기');
  assert.match(frame, /style=\{layered \? undefined : backgroundStyle\(background\)\}/, '겹치는 동안 배경은 층마다 — 옛 그림이 새 배경 위에 비치지 않게');
  assert.match(frame, /style=\{\{ \.\.\.backgroundStyle\(layer\.look\.background\)/);
  assert.match(frame, /img\.decode\(\)/, '새 그림이 준비된 다음 바뀐다');
  assert.match(frame, /layer\.phase === 'loading' \? \{ opacity: 0 \} : null/);
  assert.match(frame, /animateEl\(\n\s+layerRef\.current,\n\s+imageSwapKeyframes\(layer\.direction\)/);

  // 라이트박스·목록 행·편 자산 보드 등은 옵트인하지 않는다
  for (const path of ['src/components/characters/CharacterImageLightbox.tsx', 'src/components/characters/CharacterListRow.tsx', 'src/views/EpisodeAssetBoard.tsx']) {
    assert.doesNotMatch(read(path), /swapDirection=/, path);
  }
});

test('캐릭터 상세 창: 캐릭터를 바꾸면 다시 그리지 않고 오른쪽 내용만 WAAPI 로 떠오른다', () => {
  const modal = code('src/components/characters/CharacterDetailModal.tsx');
  assert.match(modal, /useSwapFade\(detailMainRef, selectedId, reduceMotion\);/);
  assert.match(modal, /<main ref=\{detailMainRef\} className="relative z-\[1\] flex-1 min-w-0">/);
  assert.match(modal, /<CharacterDetailPanel\n\s+character=\{selected\}/, '상세 패널은 key 없이 — 안쪽 상태 보존');
});
