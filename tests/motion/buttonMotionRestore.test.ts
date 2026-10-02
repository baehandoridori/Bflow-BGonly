import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* 움직임 폴리싱 1번 — 테마 전환 규칙이 꺼 두었던 버튼·화살표 움직임 되살리기, 화살표 통일, 누름 반응. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('테마 전환 색 페이드는 특이도 0 이라 컴포넌트의 transition 유틸을 덮지 않는다', () => {
  const css = stripComments(read('src/index.css'));
  assert.match(css, /:where\(body\.theme-ready\) :where\(#root, header, aside, main, \[role="dialog"\], button, input, textarea, select, svg\) \{/);
  // 다른 곳에서 같은 요소를 높은 특이도로 다시 잡지 않는다.
  assert.doesNotMatch(css, /body\.theme-ready\s+(button|svg|header|aside|main|input|textarea|select|\[role)/);
});

test('framer 가 움직이는 버튼에는 transform·opacity 를 CSS 로 다시 전환하지 않는다', () => {
  // transition-all 이 살아나면 framer 의 x·scale 매 프레임 값을 CSS 가 뒤쫓아 끈적이고 늦게 멈춘다.
  const modal = read('src/components/scenes/SceneDetailModal.tsx');
  const revisionTab = modal.slice(modal.indexOf('key="revision-tab"'), modal.indexOf('title="컴포지팅 리테이크"'));
  assert.ok(revisionTab.length > 0, '리테이크 탭 버튼을 찾지 못했다');
  assert.match(revisionTab, /transition-colors/);
  assert.doesNotMatch(revisionTab, /transition-all/);

  const chips = read('src/components/widgets/my-tasks/components/StageChips.tsx');
  assert.match(chips, /whileTap=/);
  assert.match(chips, /'rounded font-medium flex items-center justify-center transition-colors'/);
  assert.doesNotMatch(chips, /transition-all/);
});

test('opacity 만 전환하던 숨은 버튼도 hover 색 페이드를 잃지 않는다', () => {
  const cases: [string, RegExp][] = [
    ['src/components/calendar/CalendarRail.tsx', /opacity-0 transition-\[opacity,background-color\] hover:bg-bg-border\/50/],
    ['src/components/characters/CharacterDetailModal.tsx', /opacity-0 transition-\[opacity,color\] hover:text-red-400/],
    ['src/components/characters/FeaturedImageSlot.tsx', /opacity-0 transition-\[opacity,color\] hover:text-red-400/],
    ['src/components/scenes/EpisodeTreeNav.tsx', /hover:text-text-primary transition-\[opacity,color\]/],
    ['src/components/scenes/EpisodeTreeNav.tsx', /hover:text-accent transition-\[opacity,color\]/],
    ['src/components/widgets/MemoWidget.tsx', /transition-\[opacity,color,background-color\] p-0\.5 rounded hover:bg-accent\/15/],
    ['src/components/widgets/MemoWidget.tsx', /transition-\[opacity,color,background-color\] p-0\.5 rounded hover:bg-red-500\/20/],
    ['src/views/EpisodeView.tsx', /hover:text-accent transition-\[opacity,color\]/],
  ];
  for (const [file, pattern] of cases) assert.match(read(file), pattern, file);
  // Tailwind 3 에 없는 transition-border 는 테두리 전환을 하나도 만들지 않는다.
  for (const file of ['src/views/AssigneeView.tsx', 'src/views/EpisodeView.tsx', 'src/views/CalendarView.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /\btransition-border\b/, file);
    assert.match(source, /transition-\[box-shadow,border-color\] duration-200 ease-out/, file);
  }
});

/* ─── 화살표 통일: 그림 바꿔 끼우기 → ▶ 하나를 90° 회전 ─── */

const DISCLOSURE_SITES: [string, number][] = [
  ['src/components/NotificationPanel.tsx', 1],
  ['src/components/scenes/CommentPanel.tsx', 1],
  ['src/components/scenes/ThreadTodoSection.tsx', 1],
  ['src/components/settings/IntegrationCard.tsx', 1],
  ['src/components/settings/SettingsSidebar.tsx', 1],
  ['src/components/calendar/CalendarRail.tsx', 1],
  ['src/views/compositing/SceneGroupSection.tsx', 3],
  ['src/views/compositing/EpisodeGroupSection.tsx', 2],
  ['src/views/compositing-dashboard/cards/PartHeader.tsx', 1],
];

test('펼침 화살표는 DisclosureChevron 하나를 돌린다(0.2초 · ease-snap · 동작 줄이기면 즉시)', () => {
  const chevron = read('src/components/ui/DisclosureChevron.tsx');
  assert.match(chevron, /<ChevronRight\b/);
  assert.doesNotMatch(chevron, /ChevronDown/);
  assert.match(chevron, /'transition-\[transform,color\] duration-200 ease-snap motion-reduce:transition-none'/);
  assert.match(chevron, /expanded && 'rotate-90'/);

  for (const [file, count] of DISCLOSURE_SITES) {
    const source = read(file);
    assert.equal(source.match(/<DisclosureChevron expanded=\{/g)?.length ?? 0, count, `${file}: 화살표 ${count}곳`);
    assert.doesNotMatch(
      source,
      /\?\s*<Chevron(Right|Down)\b[^>]*\/>\s*:\s*<Chevron(Right|Down)\b/,
      `${file}: ▶/▼ 그림을 바꿔 끼우면 돌지 않고 '뚝' 바뀐다`,
    );
  }
});

test('간트 그룹 접기·트리 화살표도 같은 회전(0.2초 · cubic-bezier(.2,0,0,1))', () => {
  const canvas = read('src/features/gantt/GanttCanvas.tsx');
  assert.doesNotMatch(canvas, /\?<ChevronRight size=\{16\}\/>:<ChevronDown size=\{16\}\/>/);
  const collapseStart = canvas.indexOf('className="gantt-row-collapse"');
  const collapseButton = canvas.slice(collapseStart, canvas.indexOf('</button>', collapseStart));
  assert.ok(collapseStart > 0, '그룹 접기 버튼을 찾지 못했다');
  assert.match(collapseButton, /aria-expanded=\{!collapsed\.includes\(r\.id\)\}/, '회전은 aria-expanded 를 따른다');
  assert.match(collapseButton, /<ChevronRight size=\{16\} aria-hidden="true"\/>$/);

  const canvasCss = read('src/features/gantt/canvas.css');
  assert.match(canvasCss, /\.gantt-canvas-wrap \.gantt-row-collapse svg\{transition:transform \.2s cubic-bezier\(\.2,0,0,1\)\}/);
  assert.match(canvasCss, /\.gantt-canvas-wrap \.gantt-row-collapse\[aria-expanded=true\] svg\{transform:rotate\(90deg\)\}/);
  assert.match(canvasCss, /@media\(prefers-reduced-motion:reduce\)\{\.gantt-canvas-wrap \.gantt-row-collapse svg,/);

  const treeCss = read('src/features/gantt/tree.css');
  assert.match(treeCss, /\.gantt-tree-toggle svg\{transition:transform \.2s cubic-bezier\(\.2,0,0,1\)\}/);
});

/* ─── 누름 반응 ─── */

test('.bf-press: 색 전환은 지키고 누르는 동안 scale(.97) 120ms, 동작 줄이기면 없음', () => {
  const css = read('src/index.css');
  const rule = css.match(/\n\.bf-press \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(rule, /color var\(--motion-base\) var\(--ease-std\)/);
  assert.match(rule, /background-color var\(--motion-base\) var\(--ease-std\)/);
  assert.match(rule, /transform var\(--motion-fast\) var\(--ease-snap\)/);
  assert.match(css, /\.bf-press:active:not\(:disabled\) \{\s*transform: scale\(0\.97\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bf-press:active:not\(:disabled\) \{ transform: none; \}/);
});

test('헤더·사이드바 아이콘 버튼에 누름 반응을 붙이고, transition 유틸과 섞지 않는다', () => {
  const header = read('src/components/layout/Header.tsx');
  assert.equal(header.match(/bf-press/g)?.length, 3, '돌아가기·새로고침·테마 버튼');
  assert.doesNotMatch(header, /transition-colors/);

  const bell = read('src/components/NotificationPanel.tsx');
  assert.match(bell, /'bf-press p-2 rounded-lg relative cursor-pointer'/);

  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.match(sidebar, /'flex items-center cursor-pointer w-full h-10 rounded-lg',\s*'bf-press',/, '메뉴 버튼');
  assert.match(sidebar, /className="bf-press w-8 h-8 rounded-lg/, '사이드바 접기 버튼');
  for (const line of sidebar.split('\n').filter((text) => text.includes('bf-press'))) {
    assert.doesNotMatch(line, /\btransition-(all|colors)\b/, line.trim());
  }
});

test('B 로고: hover 확대 0.3초 out 곡선, 누름 0.12초, 동작 줄이기면 확대 없음, 확대되는 흐림 층 없음', () => {
  const sidebar = read('src/components/layout/Sidebar.tsx');
  const logo = sidebar.slice(sidebar.indexOf('function LiquidGlassLogo'), sidebar.indexOf('export function Sidebar'));
  assert.ok(logo.length > 0, '로고 컴포넌트를 찾지 못했다');
  assert.match(logo, /transition-transform duration-300 ease-out-expo hover:scale-110 active:scale-95 active:duration-fast motion-reduce:hover:scale-100 motion-reduce:active:scale-100/);
  assert.doesNotMatch(logo, /backdropFilter|WebkitBackdropFilter/);
});
