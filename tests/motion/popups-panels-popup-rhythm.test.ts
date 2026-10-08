import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COUNT_TICK_KEYFRAMES,
  POPUP_MS,
  clampMenuToViewport,
  popClassName,
  popOriginFromAnchor,
  popOriginFromPoint,
  popOriginStyle,
} from '../../src/utils/popupMotion.ts';

/* 움직임 폴리싱 8번 popup-rhythm — 창·메뉴가 모두 같은 박자로 떠오르기.
   큰 창: 뒤 배경 150ms + 창 180ms(6px 아래·.98) / 작은 메뉴: 누른 자리 모서리에서 140ms /
   일괄 변경 바: 아래에서 16px 180ms + 숫자 '톡' 140ms / 닫힘은 바로 / 동작 줄이기: opacity 만 100ms. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
/** 주석을 뺀 코드만 — 설명 글에 클래스 이름이 나와도 세지 않게. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = code('src/styles/motion-popups-panels.css');

/** @keyframes 이름 { ... } 본문 */
const keyframes = (name: string) => {
  const match = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `@keyframes ${name} 없음`);
  return match[1];
};
/** 선택자 { ... } 본문(첫 번째) */
const rule = (selector: string, source = css) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} 규칙 없음`);
  return match[1];
};

test('누른 지점 기준점: 메뉴 상자 안의 좌표, 아래로 열리면 위에서 내려오며 피어난다', () => {
  const origin = popOriginFromPoint({ x: 300, y: 200 }, { left: 300, top: 200, width: 180, height: 140 });
  assert.deepEqual(origin, { x: 0, y: 0, up: false });
  assert.equal(popClassName(origin), 'bf-pop');
  assert.deepEqual(popOriginStyle(origin), { '--pop-origin': '0px 0px' });
});

test('누른 지점 기준점: 화면 오른쪽·아래 끝에서 밀려나면 기준점도 반대 모서리로 뒤집힌다', () => {
  const viewport = { width: 1600, height: 900 };
  const size = { width: 180, height: 140 };
  const point = { x: 1590, y: 880 };
  const placed = clampMenuToViewport(point, size, viewport);
  assert.deepEqual(placed, { x: 1600 - 180 - 8, y: 900 - 140 - 8 });
  const origin = popOriginFromPoint(point, { left: placed.x, top: placed.y, width: size.width, height: size.height });
  // 메뉴가 왼쪽 위로 밀려나 누른 지점이 메뉴 오른쪽 아래 근처 → 기준점도 오른쪽 아래, 아래에서 위로 피어남.
  assert.deepEqual(origin, { x: 178, y: 128, up: true });
  assert.equal(popClassName(origin), 'bf-pop bf-pop-up');
  // 누른 지점이 메뉴 바깥이면 가장 가까운 모서리로 붙는다.
  assert.deepEqual(popOriginFromPoint({ x: 2000, y: 2000 }, { left: 0, top: 0, width: 180, height: 140 }), { x: 180, y: 140, up: true });
});

test('화면 안 자리 고치기: 오른쪽·아래 8px, 왼쪽·위 4px 여백(기존 규칙 그대로)', () => {
  assert.deepEqual(clampMenuToViewport({ x: 100, y: 100 }, { width: 50, height: 50 }, { width: 800, height: 600 }), { x: 100, y: 100 });
  assert.deepEqual(clampMenuToViewport({ x: 790, y: 590 }, { width: 50, height: 50 }, { width: 800, height: 600 }), { x: 742, y: 542 });
  assert.deepEqual(clampMenuToViewport({ x: 0, y: -10 }, { width: 900, height: 50 }, { width: 800, height: 600 }), { x: 4, y: 4 });
});

test('버튼 기준점: 버튼 아래에 열리면 위 모서리, 위로 뒤집혀 열리면 아래 모서리에서 피어난다', () => {
  const anchor = { left: 100, right: 200, top: 50, bottom: 80 };
  const below = popOriginFromAnchor(anchor, { left: 100, top: 86, width: 320, height: 400 });
  assert.deepEqual(below, { x: 50, y: 0, up: false });
  const above = popOriginFromAnchor({ left: 100, right: 200, top: 700, bottom: 730 }, { left: 100, top: 294, width: 320, height: 400 });
  assert.deepEqual(above, { x: 50, y: 400, up: true });
  assert.deepEqual(popOriginStyle(null), {});
  assert.equal(popClassName(null), 'bf-pop');
});

test('박자 상수는 사양 그대로 — 배경 150 · 큰 창 180 · 메뉴 140 · 일괄 바 180 · 숫자 140 · 동작 줄이기 100', () => {
  assert.deepEqual({ ...POPUP_MS }, { scrim: 150, modal: 180, pop: 140, bulk: 180, tick: 140, reduced: 100 });
  assert.deepEqual(COUNT_TICK_KEYFRAMES, [
    { opacity: 0.4, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'none' },
  ]);
});

test('CSS 키프레임: 출발 모습이 사양 수치와 같고 transform·opacity 만 쓴다', () => {
  assert.match(keyframes('bf-scrim-in'), /from \{ opacity: 0; \}/);
  assert.match(keyframes('bf-modal-in'), /from \{ opacity: 0; transform: translateY\(6px\) scale\(0\.98\); \}/);
  assert.match(keyframes('bf-pop-in'), /from \{ opacity: 0; transform: translateY\(-4px\) scale\(0\.97\); \}/);
  assert.match(keyframes('bf-pop-in-up'), /from \{ opacity: 0; transform: translateY\(4px\) scale\(0\.97\); \}/);
  assert.match(keyframes('bf-bulk-in'), /from \{ opacity: 0; transform: translateY\(16px\) scale\(0\.98\); \}/);
  assert.match(keyframes('bf-fade-in'), /from \{ opacity: 0; \}/);
  for (const name of ['bf-scrim-in', 'bf-modal-in', 'bf-pop-in', 'bf-pop-in-up', 'bf-bulk-in', 'bf-fade-in']) {
    const props = [...keyframes(name).matchAll(/([a-z-]+):/g)].map((match) => match[1]);
    assert.ok(props.every((prop) => prop === 'opacity' || prop === 'transform'), `${name}: ${props.join(',')}`);
  }
  assert.doesNotMatch(css, /backdrop-filter|box-shadow:|width:|height:/, '흐림·그림자·크기를 움직이지 않는다');
});

test('CSS 클래스: 길이·곡선이 박자 상수와 같고, 들어올 때만 움직인다(backwards, 퇴장 없음)', () => {
  assert.match(rule('.bf-scrim-in'), /animation: bf-scrim-in 150ms var\(--ease-out\) backwards;/);
  assert.match(rule('.bf-modal-in'), /animation: bf-modal-in var\(--motion-base\) var\(--ease-out\) backwards;/);
  assert.match(rule('.bf-pop'), /animation: bf-pop-in 140ms var\(--ease-out\) backwards;/);
  assert.match(rule('.bf-pop'), /transform-origin: var\(--pop-origin, top right\);/);
  assert.match(rule('.bf-pop.bf-pop-up'), /animation-name: bf-pop-in-up;/);
  assert.match(rule('.bf-bulk-in'), /animation: bf-bulk-in var\(--motion-base\) var\(--ease-out\) backwards;/);
  assert.equal(POPUP_MS.modal, 180, '--motion-base 와 같은 값');
  assert.doesNotMatch(css, /forwards|infinite|@keyframes bf-[a-z-]*-out\b/, '퇴장·반복 움직임 없음');
});

test('동작 줄이기: 모든 창·메뉴 클래스가 opacity 만 100ms 로 바뀐다(전역 규칙보다 특이도가 높게)', () => {
  const reduce = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(reduce, 'reduce 블록 없음');
  const body = reduce[1];
  for (const selector of ['.bf-scrim-in', '.bf-modal-in', '.bf-pop', '.bf-bulk-in', '.gantt-modal[open]', '.gantt-modal[open]::backdrop']) {
    assert.ok(body.includes(selector), `${selector} 가 reduce 블록에 없음`);
  }
  assert.match(body, /animation: bf-fade-in 100ms linear backwards !important;/);
  assert.equal(POPUP_MS.reduced, 100);
});

const BIG_WINDOWS: Array<[string, number]> = [
  ['src/components/common/ConfirmDialog.tsx', 1],
  ['src/components/update/UpdateCenterModal.tsx', 1],
  ['src/components/auth/PasswordChangeModal.tsx', 1],
  ['src/components/auth/UserManagerModal.tsx', 1],
  ['src/views/compositing/NewRevisionModal.tsx', 1],
  ['src/views/retake-hub/RevisionAddModal.tsx', 1],
  ['src/views/retake-hub/RevisionImportModal.tsx', 1],
  ['src/views/retake-hub/RevisionSetCreateModal.tsx', 1],
  ['src/views/VacationView.tsx', 1],
  ['src/components/vacation/VacationRegisterModal.tsx', 1],
  ['src/components/vacation/DahyuGrantModal.tsx', 1],
  ['src/components/vacation/DahyuDeleteModal.tsx', 1],
];

test('큰 창: 뒤 배경(.bf-scrim-in)과 창(.bf-modal-in)이 같은 박자로 열린다', () => {
  for (const [file, count] of BIG_WINDOWS) {
    const source = code(file);
    assert.equal(source.match(/\bbf-scrim-in\b/g)?.length ?? 0, count, `${file}: bf-scrim-in`);
    assert.equal(source.match(/\bbf-modal-in\b/g)?.length ?? 0, count, `${file}: bf-modal-in`);
  }
});

test('리테이크 허브·휴가 창: framer 개별 값(scale/y) 대신 공통 CSS — 닫힘도 바로', () => {
  for (const file of [
    'src/views/retake-hub/RevisionAddModal.tsx',
    'src/views/retake-hub/RevisionImportModal.tsx',
    'src/views/retake-hub/RevisionSetCreateModal.tsx',
    'src/components/vacation/VacationRegisterModal.tsx',
    'src/components/vacation/DahyuGrantModal.tsx',
    'src/components/vacation/DahyuDeleteModal.tsx',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /from 'framer-motion'/, `${file}: framer 를 쓰지 않는다`);
    assert.doesNotMatch(source, /scale: 0\.9[56]/, `${file}: 옛 scale 등장`);
  }
  const vacation = read('src/views/VacationView.tsx');
  const deleteModal = vacation.slice(vacation.indexOf('function VacationDeleteListModal'), vacation.indexOf('export function VacationView'));
  assert.doesNotMatch(deleteModal, /motion\.div|exit=/, '휴가 삭제 창: 죽은 exit 대신 공통 CSS');
});

test('흐림 창(휴가 신청·대체휴가)은 바깥 틀이 opacity 를 움직이지 않는다 — 흐림이 꺼졌다 켜지지 않게', () => {
  for (const file of [
    'src/components/vacation/VacationRegisterModal.tsx',
    'src/components/vacation/DahyuGrantModal.tsx',
    'src/components/vacation/DahyuDeleteModal.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /<div className="fixed inset-0 z-\[100\] flex items-center justify-center">/, `${file}: 바깥 틀은 정적`);
    assert.match(source, /className="absolute inset-0 bg-black\/60 backdrop-blur-sm bf-scrim-in"/, `${file}: 배경판이 스스로 어두워짐`);
    assert.match(source, /className="bf-modal-in relative [^"]*backdrop-blur-xl/, `${file}: 흐림 판 자신에게 움직임`);
  }
});

test('확인 창: 라이트 모드 색 토큰을 쓰고 기존 응답 흐름(resolve·pendingRef)은 그대로', () => {
  const source = read('src/components/common/ConfirmDialog.tsx');
  assert.doesNotMatch(source, /#1A1D27|#2D3041|#E8E8EE|#8B8DA3|#6C5CE7|#7D6FFF/i, '어두운 색 하드코딩 없음');
  assert.match(source, /bg-bg-card border border-bg-border/);
  assert.match(source, /text-text-primary/);
  assert.match(source, /text-text-secondary/);
  assert.match(source, /bg-accent [^']*text-on-accent/);
  assert.match(source, /pendingRef\.current = null;\n\s+state\?\.resolve\(ok\);\n\s+setState\(null\);/);
  assert.match(source, /if \(!state\) return null;/, '닫힘은 바로');
});

const SMALL_MENUS: Array<[string, RegExp, number]> = [
  ['src/components/auth/UserMenu.tsx', /className="bf-pop absolute right-0 top-full/g, 1],
  ['src/views/VacationView.tsx', /className="bf-pop absolute right-0 top-full/g, 1],
  ['src/components/calendar/CalendarRail.tsx', /className="bf-pop absolute right-0 top-7/g, 2],
  ['src/components/ui/ContextMenu.tsx', /popClassName\(origin\)/g, 1],
  ['src/components/scenes/SceneContextMenu.tsx', /popClassName\(origin\)/g, 1],
  ['src/features/gantt/GanttDialogs.tsx', /popClassName\(origin\)/g, 1],
  ['src/components/calendar/TagManagerPopover.tsx', /popClassName\(popOrigin\)/g, 1],
  ['src/components/calendar/EventQuickEdit.tsx', /popClassName\(popOrigin\)/g, 1],
];

test('작은 메뉴: 누른 자리 쪽 모서리에서 피어난다(.bf-pop)', () => {
  for (const [file, pattern, count] of SMALL_MENUS) {
    assert.equal(code(file).match(pattern)?.length ?? 0, count, file);
  }
  // 커서·버튼 기준점을 쓰는 메뉴는 인라인 --pop-origin 을 함께 넘긴다.
  for (const file of [
    'src/components/ui/ContextMenu.tsx',
    'src/components/scenes/SceneContextMenu.tsx',
    'src/features/gantt/GanttDialogs.tsx',
    'src/components/calendar/TagManagerPopover.tsx',
    'src/components/calendar/EventQuickEdit.tsx',
  ]) {
    assert.match(read(file), /popOriginStyle\((?:origin|popOrigin)\)/, file);
  }
});

test('우클릭 메뉴: 자리 보정은 그리기 전(useLayoutEffect) — 첫 프레임이 엉뚱한 자리에 뜨지 않게', () => {
  const contextMenu = read('src/components/ui/ContextMenu.tsx');
  assert.match(contextMenu, /useLayoutEffect\(\(\) => \{\n\s+const el = ref\.current;[\s\S]*?clampMenuToViewport\(position, rect,/);
  assert.match(contextMenu, /popOriginFromPoint\(position, \{ left: next\.x, top: next\.y/);
});

test('.bf-pop·.bf-modal-in 은 transform 으로 자리를 잡은 요소에 붙이지 않는다', () => {
  const files = [...BIG_WINDOWS.map(([file]) => file), ...SMALL_MENUS.map(([file]) => file), 'src/views/compositing-dashboard/BulkActionBar.tsx'];
  for (const file of new Set(files)) {
    for (const match of read(file).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = match[1] ?? match[2] ?? '';
      if (!/\bbf-(?:pop|modal-in|bulk-in)\b|popClassName/.test(classes)) continue;
      assert.doesNotMatch(classes, /(?:^|\s)-?translate-|(?:^|\s)scale-|(?:^|\s)rotate-|\banimate-/, `${file}: ${classes}`);
    }
  }
});

test('일괄 변경 바: 바깥 래퍼가 가운데를 맡고 안쪽 바만 올라온다 — 흐림 없음, 떠 있는 동안 재등장 없음', () => {
  const source = code('src/views/compositing-dashboard/BulkActionBar.tsx');
  assert.match(source, /<div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center" style=\{\{ bottom: 28 \}\}>\n\s+<div\n\s+className="bf-bulk-in pointer-events-auto /);
  assert.doesNotMatch(source, /backdropFilter|backdrop-blur/);
  assert.doesNotMatch(source, /-translate-x-1\/2/);
  assert.match(source, /if \(selectedCount === 0\) return null;/, '사라질 때는 바로');
  // 숫자 '톡'은 개수가 바뀔 때만(처음 뜰 때 0→N 은 제외), 동작 줄이기를 넘긴다.
  assert.match(source, /if \(previous === 0 \|\| selectedCount === 0 \|\| previous === selectedCount\) return undefined;/);
  assert.match(source, /animateEl\(\n\s+countRef\.current,\n\s+COUNT_TICK_KEYFRAMES,\n\s+\{ duration: reduce \? POPUP_MS\.reduced : POPUP_MS\.tick, easing: EASE_CSS\.out \},\n\s+reduce,\n\s+\)/);
  assert.match(source, /return \(\) => animation\?\.cancel\(\);/, '연타 시 이전 톡은 취소 후 새로');
  assert.match(source, /<span ref=\{countRef\} className="inline-block tabular-nums">\{selectedCount\}<\/span>개 선택/);
});

test('알림 창은 이 항목에서 건드리지 않는다(comments-notify 갈래)', () => {
  assert.doesNotMatch(read('src/components/NotificationPanel.tsx'), /bf-pop|bf-modal-in|popupMotion/);
});
