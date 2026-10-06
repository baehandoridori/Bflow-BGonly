/**
 * 캘린더 새 창 (v1.129.0) — 사이드바 '캘린더' 화면을 캐릭터 현황판처럼 별도 창으로 띄운다.
 * 설계: docs/superpowers/specs/2026-10-06-calendar-popup-design.md
 *
 * 이 파일이 지키는 것:
 *  1) 팝업 창 판정·본 창으로 화면 이동 부탁하기(순수 함수)
 *  2) 새 창 등록·기본 크기·여는 버튼 두 곳
 *  3) 새 창 안의 '다른 화면으로 가는' 버튼 네 가지가 본 창으로 넘어가는 배선
 *  4) 창 사이 신호(IPC)의 다섯 군데 배선
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fitWidgetPopupBounds, fitWidgetPopupSize } from '../electron/widgetPopupBounds.ts';
import { canPopOutToWindow, isWidgetPopupWindow } from '../src/utils/popupWindow.ts';
import { parseWidgetViewNavigation, requestMainWindowView } from '../src/utils/widgetViewNavigation.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
/** 주석을 뺀 코드만 — 설명 글에 같은 낱말이 나와도 세지 않게. */
const code = (path: string) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type FakeWindow = { location?: { hash?: unknown }; electronAPI?: Record<string, unknown> };
function withWindow<T>(fake: FakeWindow | undefined, run: () => T): T {
  const holder = globalThis as Record<string, unknown>;
  const had = 'window' in holder;
  const previous = holder.window;
  if (fake === undefined) delete holder.window;
  else holder.window = fake;
  try {
    return run();
  } finally {
    if (had) holder.window = previous;
    else delete holder.window;
  }
}

// ── 1) 팝업 창 판정 ───────────────────────────────────────────────────
test('isWidgetPopupWindow — #widget-popup/ 로 연 창만 팝업 창이다', () => {
  assert.equal(withWindow(undefined, isWidgetPopupWindow), false, 'window 가 없는 환경(테스트·서버)');
  assert.equal(withWindow({}, isWidgetPopupWindow), false, 'location 이 없는 흉내 window');
  assert.equal(withWindow({ location: {} }, isWidgetPopupWindow), false);
  assert.equal(withWindow({ location: { hash: '' } }, isWidgetPopupWindow), false, '본 창');
  assert.equal(withWindow({ location: { hash: '#/dashboard' } }, isWidgetPopupWindow), false);
  assert.equal(withWindow({ location: { hash: '#widget-popup' } }, isWidgetPopupWindow), false, '위젯 id 가 없으면 팝업이 아니다');
  assert.equal(withWindow({ location: { hash: '#widget-popupX/schedule' } }, isWidgetPopupWindow), false);
  assert.equal(withWindow({ location: { hash: 42 } }, isWidgetPopupWindow), false);

  assert.equal(withWindow({ location: { hash: '#widget-popup/schedule' } }, isWidgetPopupWindow), true);
  assert.equal(withWindow({ location: { hash: '#widget-popup/character-board' } }, isWidgetPopupWindow), true);
  assert.equal(withWindow({ location: { hash: '#widget-popup/ep-part-1?ep=3' } }, isWidgetPopupWindow), true, '쿼리가 붙어도');
});

test('canPopOutToWindow — 본 창이고 새 창 열기 기능이 있을 때만', () => {
  const open = () => undefined;
  assert.equal(withWindow(undefined, canPopOutToWindow), false);
  assert.equal(withWindow({ location: { hash: '' } }, canPopOutToWindow), false, 'electronAPI 없음');
  assert.equal(withWindow({ location: { hash: '' }, electronAPI: {} }, canPopOutToWindow), false, '새 창 열기 기능 없음(웹 미리보기 일부)');
  assert.equal(withWindow({ location: { hash: '' }, electronAPI: { widgetOpenPopup: 'yes' } }, canPopOutToWindow), false);
  assert.equal(withWindow({ location: { hash: '' }, electronAPI: { widgetOpenPopup: open } }, canPopOutToWindow), true);
  assert.equal(
    withWindow({ location: { hash: '#widget-popup/schedule' }, electronAPI: { widgetOpenPopup: open } }, canPopOutToWindow),
    false,
    '이미 새 창 안이면 버튼을 숨긴다',
  );
});

// ── 1) 본 창으로 화면 이동 부탁하기 ───────────────────────────────────
test('requestMainWindowView — 새 창에서는 본 창에 부탁하고 true, 본 창에서는 아무것도 하지 않고 false', () => {
  const sent: unknown[] = [];
  const api = { widgetNavigateView: (payload: unknown) => { sent.push(payload); return Promise.resolve(); } };

  const inMain = withWindow({ location: { hash: '' }, electronAPI: api }, () => requestMainWindowView({ view: 'vacation' }));
  assert.equal(inMain, false, '본 창: 호출한 쪽이 하던 대로 이동한다');
  assert.deepEqual(sent, []);

  const inPopup = withWindow(
    { location: { hash: '#widget-popup/schedule' }, electronAPI: api },
    () => requestMainWindowView({ view: 'scenes', episodeNumber: 5, partId: 'A', department: 'bg', highlightSceneId: 'a001', toastMessage: '이동' }),
  );
  assert.equal(inPopup, true);
  assert.deepEqual(sent, [{ view: 'scenes', episodeNumber: 5, partId: 'A', department: 'bg', highlightSceneId: 'a001', toastMessage: '이동' }]);

  // 새 창인데 신호를 보낼 길이 없어도 '자기 창에서 이동'으로 떨어지지 않는다(새 창에는 그 화면이 없다)
  assert.equal(withWindow({ location: { hash: '#widget-popup/schedule' }, electronAPI: {} }, () => requestMainWindowView({ view: 'settings' })), true);
  assert.equal(withWindow({ location: { hash: '#widget-popup/schedule' } }, () => requestMainWindowView({ view: 'settings' })), true);
  assert.equal(withWindow(undefined, () => requestMainWindowView({ view: 'settings' })), false);
});

test('parseWidgetViewNavigation — 아는 화면·맞는 타입만 통과시킨다', () => {
  assert.deepEqual(parseWidgetViewNavigation({ view: 'vacation' }), { view: 'vacation' });
  assert.deepEqual(parseWidgetViewNavigation({ view: 'settings', extra: 'x' }), { view: 'settings' }, '모르는 값은 버린다');
  assert.deepEqual(parseWidgetViewNavigation({ view: 'dashboard' }), { view: 'dashboard' });
  assert.deepEqual(parseWidgetViewNavigation({ view: 'dashboard', todoId: 'todo-1' }), { view: 'dashboard', todoId: 'todo-1' });
  assert.deepEqual(parseWidgetViewNavigation({ view: 'dashboard', todoId: '' }), { view: 'dashboard' });
  assert.deepEqual(parseWidgetViewNavigation({ view: 'dashboard', todoId: 7 }), { view: 'dashboard' });

  assert.deepEqual(
    parseWidgetViewNavigation({ view: 'scenes', episodeNumber: 5, partId: 'A', department: 'acting', highlightSceneId: 'a001', toastMessage: '씬 뷰로 이동합니다' }),
    { view: 'scenes', episodeNumber: 5, partId: 'A', department: 'acting', highlightSceneId: 'a001', toastMessage: '씬 뷰로 이동합니다' },
  );
  // 빠진 값은 '건드리지 않는다'는 뜻이라 키 자체를 만들지 않는다(navigateToSceneView 가 undefined 를 그렇게 읽는다)
  assert.deepEqual(parseWidgetViewNavigation({ view: 'scenes' }), { view: 'scenes' });
  assert.deepEqual(
    parseWidgetViewNavigation({ view: 'scenes', episodeNumber: '5', partId: null, department: 'sound', highlightSceneId: undefined, toastMessage: 3 }),
    { view: 'scenes' },
    '타입이 틀린 값은 뺀다',
  );
  assert.deepEqual(parseWidgetViewNavigation({ view: 'scenes', episodeNumber: Number.NaN }), { view: 'scenes' });
  assert.deepEqual(parseWidgetViewNavigation({ view: 'scenes', department: 'all' }), { view: 'scenes', department: 'all' });

  for (const bad of [null, undefined, 'vacation', 7, [], [{ view: 'vacation' }], {}, { view: 'playground' }, { view: 'schedule' }, { view: 'character-board' }, { view: 'toString' }, { view: '__proto__' }, { view: null }]) {
    assert.equal(parseWidgetViewNavigation(bad), null, JSON.stringify(bad));
  }
});

// ── 2) 새 창 등록·기본 크기 ───────────────────────────────────────────
test('새 창 id 는 schedule — 캘린더 위젯의 여러 개 띄우기 규칙(calendar-)에 걸리지 않는다', () => {
  const popup = code('src/views/WidgetPopup.tsx');
  assert.match(popup, /'schedule': \{ label: '캘린더', component: <SchedulePopupBody \/> \},/);
  assert.match(popup, /'calendar': \{ label: '캘린더', component: <CalendarWidget \/> \},/, '대시보드 캘린더 위젯은 그대로');
  assert.match(popup, /widgetId\.startsWith\('calendar-'\) \? WIDGET_REGISTRY\['calendar'\]/);
  assert.equal('schedule'.startsWith('calendar-'), false);

  // 본문: 로그인 확인 뒤, 본 창과 같은 지연 로드 함수로 캘린더 화면을 띄운다
  assert.match(popup, /const ScheduleView = lazy\(\(\) => loadScheduleView\(\)\.then\(\(m\) => \(\{ default: m\.ScheduleView \}\)\)\);/);
  const body = popup.slice(popup.indexOf('function SchedulePopupBody()'), popup.indexOf('const WIDGET_REGISTRY'));
  assert.match(body, /const currentUser = useAuthStore\(\(s\) => s\.currentUser\);\s+if \(!currentUser\) \{/, '로그인 확인이 먼저');
  assert.match(body, /로그인한 뒤에 캘린더를 볼 수 있어요\./);
  assert.match(body, /<Suspense fallback=\{[^\n]*\}>\s*<ScheduleView \/>\s*<\/Suspense>/);
  assert.ok(body.indexOf('if (!currentUser)') < body.indexOf('<ScheduleView />'), '로그인 전에는 캘린더를 그리지 않는다');

  const loaders = read('src/views/viewLoaders.ts');
  assert.match(loaders, /export const loadScheduleView = \(\) => import\('@\/views\/ScheduleView'\);/);
  assert.match(code('src/App.tsx'), /lazy\(\(\) => loadScheduleView\(\)\.then\(m => \(\{ default: m\.ScheduleView \}\)\)\)/, '본 창도 같은 함수');
});

test('main: 캘린더 새 창은 화면형 크기로, 항상 위는 끈 채로 연다', () => {
  const main = code('electron/main.ts');
  const defaults = main.slice(main.indexOf('const WIDGET_POPUP_DEFAULTS'), main.indexOf('function openWidgetPopup('));
  assert.match(defaults, /'schedule': \{ width: 1280, height: 820, alwaysOnTop: false \},/);
  assert.match(defaults, /'character-board': \{ width: 1160, height: 780, alwaysOnTop: false \},/, '현황판 기본값은 그대로');
  assert.match(main, /const preset = WIDGET_POPUP_DEFAULTS\[widgetId\];/);

  // 미리보기도 같은 크기로 연다
  assert.match(code('src/mocks/devElectronAPI.ts'), /widgetId === 'schedule' \? 'width=1280,height=820'/);
});

test('새 창 크기를 뜰 화면에 맞춘다 — 작은 화면에서 아래·오른쪽이 화면 밖으로 나가지 않게 (코덱스 지적)', () => {
  // 크기: 화면(작업 영역)보다 크면 그만큼만 줄인다
  const calendar = { width: 1280, height: 820 };
  assert.deepEqual(fitWidgetPopupSize(calendar, { width: 1366, height: 728 }), { width: 1280, height: 728 }, '1366×768 노트북 — 높이만 줄인다');
  assert.deepEqual(fitWidgetPopupSize(calendar, { width: 1280, height: 672 }), { width: 1280, height: 672 }, '1920×1080 을 150% 로 쓰는 노트북');
  assert.deepEqual(fitWidgetPopupSize(calendar, { width: 865, height: 1488 }), { width: 865, height: 820 }, '세로로 세운 모니터 — 폭만 줄인다');
  assert.deepEqual(fitWidgetPopupSize(calendar, { width: 2560, height: 1392 }), calendar, '넉넉한 화면에서는 그대로');
  assert.deepEqual(fitWidgetPopupSize({ width: 1366, height: 728 }, { width: 1366, height: 728 }), { width: 1366, height: 728 }, '딱 맞으면 그대로');
  assert.deepEqual(fitWidgetPopupSize({ width: 100, height: 90 }, { width: 1366, height: 728 }), { width: 280, height: 200 }, '최소 크기는 지킨다');
  assert.deepEqual(fitWidgetPopupSize({ width: 900, height: 700 }, { width: 200, height: 150 }), { width: 280, height: 200 }, '화면이 최소 크기보다 작아도 최소 크기');

  // 기억한 자리·크기 되살리기: 크기를 먼저 줄이고, 그 크기로 자리를 화면 안으로 민다
  const laptop = { x: 0, y: 0, width: 1366, height: 728 };
  assert.deepEqual(
    fitWidgetPopupBounds({ x: 300, y: 100, width: 2000, height: 1300 }, laptop),
    { x: 0, y: 0, width: 1366, height: 728 },
    '큰 모니터에서 쓰던 크기 → 화면에 꽉 차는 크기',
  );
  assert.deepEqual(
    fitWidgetPopupBounds({ x: 40, y: 20, width: 1280, height: 820 }, laptop),
    { x: 40, y: 0, width: 1280, height: 728 },
    '높이만 넘치면 높이만 줄이고 위로 붙인다 (가로 자리는 그대로)',
  );
  assert.deepEqual(
    fitWidgetPopupBounds({ x: 1200, y: 600, width: 480, height: 400 }, laptop),
    { x: 886, y: 328, width: 480, height: 400 },
    '크기는 맞고 자리만 넘치면 안으로 민다',
  );
  assert.deepEqual(
    fitWidgetPopupBounds({ x: 200, y: 100, width: 800, height: 500 }, laptop),
    { x: 200, y: 100, width: 800, height: 500 },
    '다 들어와 있으면 그대로',
  );
  assert.deepEqual(
    fitWidgetPopupBounds({ x: 1300, y: 700, width: 100, height: 90 }, laptop),
    { x: 1086, y: 528, width: 280, height: 200 },
    '최소 크기로 키운 창도 키운 크기 기준으로 안으로 민다',
  );
  // 주 화면 왼쪽에 붙은 보조 모니터 — 좌표가 음수이고 위쪽이 0 이 아니다
  const left = { x: -2560, y: 3, width: 2560, height: 1392 };
  assert.deepEqual(fitWidgetPopupBounds({ x: -2700, y: -50, width: 800, height: 600 }, left), { x: -2560, y: 3, width: 800, height: 600 });
  assert.deepEqual(fitWidgetPopupBounds({ x: -500, y: 1000, width: 800, height: 600 }, left), { x: -800, y: 795, width: 800, height: 600 });
  assert.deepEqual(fitWidgetPopupBounds({ x: -2000, y: 100, width: 3000, height: 2000 }, left), { x: -2560, y: 3, width: 2560, height: 1392 });
  // 결과에는 자리·크기만 — 기억해 둔 다른 값(투명도 등)이 창 크기 지정에 섞여 들어가지 않는다
  const remembered = { x: 1, y: 2, width: 300, height: 300, opacity: 0.5, alwaysOnTop: true, title: '캘린더' };
  assert.deepEqual(Object.keys(fitWidgetPopupBounds(remembered, laptop)).sort(), ['height', 'width', 'x', 'y']);

  // main: 창이 뜰 화면 하나를 정해(기억한 자리의 화면, 처음이면 주 화면) 처음 크기·되살린 크기를 모두 그 안으로
  const main = code('electron/main.ts');
  assert.match(main, /import \{ fitWidgetPopupBounds, fitWidgetPopupSize, WIDGET_POPUP_MIN_HEIGHT, WIDGET_POPUP_MIN_WIDTH \} from '\.\/widgetPopupBounds';/);
  const open = main.slice(main.indexOf('function openWidgetPopup('), main.indexOf("ipcMain.handle('widget:open-popup'"));
  assert.match(
    open,
    /const targetWorkArea = \(savedPos\s+\? screen\.getDisplayNearestPoint\(\{ x: savedPos\.x, y: savedPos\.y \}\)\s+: screen\.getPrimaryDisplay\(\)\)\.workArea;/,
  );
  assert.match(
    open,
    /const \{ width: initWidth, height: initHeight \} = fitWidgetPopupSize\(\s*savedPos \?\? \{ width: preset\?\.width \?\? 420, height: preset\?\.height \?\? 360 \},\s*targetWorkArea,\s*\);/,
  );
  assert.match(open, /width: initWidth,\s+height: initHeight,\s+minWidth: WIDGET_POPUP_MIN_WIDTH,\s+minHeight: WIDGET_POPUP_MIN_HEIGHT,/);
  // 되살릴 때: 크기까지 맞춘 값을 두 번 준다 — 배율이 다른 모니터로 옮겨 갈 때 한 번으로는 크기가 배율 비율만큼 어긋난다(실측)
  assert.match(
    open,
    /if \(savedPos\) \{\s+const restored = fitWidgetPopupBounds\(savedPos, targetWorkArea\);\s+popupWin\.setBounds\(restored\);\s+popupWin\.setBounds\(restored\);\s+\}/,
  );
  assert.equal((open.match(/popupWin\.setBounds\(/g) ?? []).length, 3, '창 자리·크기를 정하는 곳은 되살리기(두 번)와 모서리 붙이기뿐');
  assert.doesNotMatch(open, /savedPos\.width|savedPos\.height/, '기억한 크기를 맞추지 않고 그대로 쓰는 곳이 없다');
});

test('여는 곳 ①: 사이드바 캘린더·캐릭터 항목의 새 창 버튼 (공용)', () => {
  const sidebar = code('src/components/layout/Sidebar.tsx');
  const popouts = sidebar.slice(sidebar.indexOf('const NAV_POPOUTS'), sidebar.indexOf('function LiquidGlassLogo'));
  assert.match(popouts, /schedule: \{ title: '캘린더', hint: '캘린더를 새 창으로 열어요', ariaLabel: '캘린더를 새 창으로 열기' \},/);
  assert.match(popouts, /'character-board': \{ title: '캐릭터 현황판', hint: '캐릭터 현황판을 새 창으로 열어요', ariaLabel: '캐릭터 현황판을 새 창으로 열기' \},/);
  assert.equal((popouts.match(/title: '/g) ?? []).length, 2, '새 창으로 열 수 있는 화면은 둘');
  // 화면 id 를 그대로 새 창 id 로 쓴다 — 등록(WIDGET_REGISTRY)·기본 크기(WIDGET_POPUP_DEFAULTS)와 같은 값이어야 한다
  assert.match(sidebar, /widgetOpenPopup\?\.\(item\.id, popout\.title\)/);
  assert.match(sidebar, /\{ id: 'schedule', label: '캘린더', icon: <CalendarDays size=\{20\} \/> \},/);
});

test('여는 곳 ②: 캘린더 머리줄의 새 창 버튼 — 새 창 안에서는 숨긴다', () => {
  const view = code('src/views/ScheduleView.tsx');
  assert.match(view, /\{canPopOutToWindow\(\) && \(\s*<button\s+type="button"\s+onClick=\{\(\) => \{ void window\.electronAPI\?\.widgetOpenPopup\?\.\('schedule', '캘린더'\); \}\}/);
  assert.match(view, /<ExternalLink size=\{13\} \/> 새 창으로/);
  assert.match(view, /import \{ canPopOutToWindow \} from '@\/utils\/popupWindow';/);
  // 훅(useContext)으로 팝업을 판정하지 않는다 — ScheduleView 는 훅을 흉내 내어 함수를 직접 부르는 테스트가 있다
  assert.doesNotMatch(view, /IsPopupContext|useContext\(/);
  assert.doesNotMatch(code('src/components/calendar/CalendarRail.tsx'), /IsPopupContext|useContext\(/);
  assert.doesNotMatch(code('src/components/calendar/EventSidePanel.tsx'), /IsPopupContext/);
});

// ── 3) 새 창 안의 '다른 화면으로 가는' 버튼 네 가지 ───────────────────
test('새 창 안: 휴가·씬 이동은 본 창으로 넘긴다 (본 창에서는 하던 대로)', () => {
  const view = code('src/views/ScheduleView.tsx');
  const handler = view.slice(view.indexOf('const handleNavigate = useCallback('), view.indexOf('const reconcileEventMutation'));
  assert.match(handler, /if \(ev\.type === 'vacation'\) \{\s+if \(!requestMainWindowView\(\{ view: 'vacation' \}\)\) setView\('vacation'\);\s+setPanelEvent\(null\);\s+return;/);
  assert.match(
    handler,
    /if \(requestMainWindowView\(\{\s+view: 'scenes',\s+episodeNumber: ev\.linkedEpisode,\s+partId: linkedPart \?\? undefined,\s+department: ev\.linkedDepartment,\s+highlightSceneId: ev\.linkedSceneId,\s+toastMessage,\s+\}\)\) return;\s+navigateToSceneView\(\{/,
  );
  // 본 창 경로의 인자는 그대로다
  assert.match(handler, /navigateToSceneView\(\{\s+episodeNumber: ev\.linkedEpisode,\s+partId: linkedPart,\s+department: ev\.linkedDepartment,\s+highlightSceneId: ev\.linkedSceneId,\s+toastMessage,\s+\}\);/);
  assert.match(handler, /const toastMessage = `\$\{ev\.title\} → 씬 뷰로 이동합니다`;/);
});

test('새 창 안: 설정에서 연동하기·할일로 이동도 본 창으로 넘긴다', () => {
  const rail = code('src/components/calendar/CalendarRail.tsx');
  assert.match(rail, /onClick=\{\(\) => \{ if \(!requestMainWindowView\(\{ view: 'settings' \}\)\) setView\('settings'\); \}\}/);

  const panel = code('src/components/calendar/EventSidePanel.tsx');
  assert.match(
    panel,
    /if \(!requestMainWindowView\(\{ view: 'dashboard', todoId: linkedTodoId \}\)\) \{\s+setView\('dashboard'\);\s+setTimeout\(\(\) => \{\s+window\.dispatchEvent\(new CustomEvent\('bflow:navigate-to-todo', \{ detail: \{ todoId: linkedTodoId \} \}\)\);\s+\}, 300\);\s+\}\s+onClose\(\);/,
  );
  // 캘린더 화면 쪽에 본 창 전용 이동이 새로 생기면 여기에 걸린다 — 새 창에서는 갈 곳이 없으므로 requestMainWindowView 를 거쳐야 한다
  for (const path of ['src/views/ScheduleView.tsx', 'src/components/calendar/CalendarRail.tsx', 'src/components/calendar/EventSidePanel.tsx']) {
    const source = code(path);
    const direct = source.match(/setView\('[a-z-]+'\)/g) ?? [];
    const guarded = source.match(/if \(!requestMainWindowView\([^)]*\)\) (?:\{\s+)?setView\('[a-z-]+'\)/g) ?? [];
    assert.equal(direct.length, guarded.length, `${path}: setView(...) ${direct.length}곳 중 ${guarded.length}곳만 새 창 분기를 거친다`);
  }
});

// ── 4) 창 사이 신호 배선 ──────────────────────────────────────────────
test('IPC widget:navigate-view — 새 창 → main(본 창을 앞으로) → 본 창', () => {
  const main = code('electron/main.ts');
  assert.match(
    main,
    /ipcMain\.handle\('widget:navigate-view', \(_e, payload: unknown\) => \{\s+if \(mainWindow && !mainWindow\.isDestroyed\(\)\) \{\s+if \(mainWindow\.isMinimized\(\)\) mainWindow\.restore\(\);\s+mainWindow\.show\(\);\s+mainWindow\.focus\(\);\s+mainWindow\.webContents\.send\('widget:navigate-view', payload\);\s+\}\s+\}\);/,
  );

  const preload = code('electron/preload.ts');
  assert.match(preload, /widgetNavigateView: \(payload: unknown\) =>\s+ipcRenderer\.invoke\('widget:navigate-view', payload\),/);
  assert.match(preload, /onWidgetNavigateView: \(callback: \(payload: unknown\) => void\) => \{\s+const handler = \(_event: unknown, data: unknown\) => callback\(data\);\s+ipcRenderer\.on\('widget:navigate-view', handler\);\s+return \(\) => ipcRenderer\.removeListener\('widget:navigate-view', handler\);/);

  const types = code('src/types/index.ts');
  assert.match(types, /widgetNavigateView\?: \(payload: WidgetViewNavigation\) => Promise<void>;/);
  assert.match(types, /onWidgetNavigateView\?: \(callback: \(payload: unknown\) => void\) => \(\) => void;/);
});

test('본 창(App): 받은 요청을 확인한 뒤 그 화면을 연다', () => {
  const app = code('src/App.tsx');
  const start = app.indexOf('const offWidgetNavigateView = window.electronAPI.onWidgetNavigateView?.(');
  assert.ok(start > -1);
  const handler = app.slice(start, app.indexOf('return () => {', start));
  assert.match(handler, /const navigation = parseWidgetViewNavigation\(payload\);\s+if \(!navigation\) return;/, '확인하지 않은 값으로 화면을 바꾸지 않는다');
  assert.match(handler, /if \(navigation\.view === 'scenes'\) \{\s+navigateToSceneView\(\{\s+episodeNumber: navigation\.episodeNumber,\s+partId: navigation\.partId,\s+department: navigation\.department,\s+highlightSceneId: navigation\.highlightSceneId,\s+toastMessage: navigation\.toastMessage,\s+\}\);\s+return;/);
  assert.match(handler, /useAppStore\.getState\(\)\.setView\(navigation\.view\);/);
  assert.match(handler, /if \(navigation\.view === 'dashboard' && navigation\.todoId\) \{[\s\S]*?new CustomEvent\('bflow:navigate-to-todo', \{ detail: \{ todoId \} \}\)[\s\S]*?\}, 300\);/);
  assert.match(app.slice(start), /offWidgetNavigateView\?\.\(\);/, '구독 해제');
});

// ── 5) 미리보기: 새 창이 본 창의 로그인 상태를 따라간다 (코덱스 지적) ──────────
// Electron 에서는 main 프로세스가 로그인 상태를 모든 창에 알린다. 미리보기 mock 은 그 길이 no-op 이라
// '로그인 유지'를 끄고 로그인하면 새 창에 로그인 안내만 뜨고, 본 창에서 로그아웃해도 새 창에 개인 일정이 남았다.
type PreviewSession = { user: { id: string; name: string } | null };
type PreviewApi = {
  loginCanonicalSession(input: { name: string; password: string; rememberMe?: boolean }): Promise<{ ok: boolean; payload: PreviewSession }>;
  logoutCanonicalSession(): Promise<{ ok: boolean; payload: PreviewSession }>;
  restoreCanonicalSession(): Promise<{ ok: boolean; payload: PreviewSession }>;
  onSessionChanged(callback: (payload: unknown) => void): () => void;
  sessionRequestCurrent(): Promise<{ ok: boolean }>;
  widgetNavigateView(payload: unknown): Promise<void>;
  onWidgetNavigateView(callback: (payload: unknown) => void): () => void;
  widgetOpenPopup(widgetId: string, title: string, extra?: Record<string, string>): Promise<{ ok: boolean }>;
};
type PreviewWindow = {
  localStorage: unknown;
  location: { hash: string; origin?: string; pathname?: string; search?: string };
  opener?: unknown;
  electronAPI?: PreviewApi;
  // 새 창 열기·위치와 크기 기억을 흉내 낼 때만 쓴다
  open?: (url: string, name: string, features: string) => unknown;
  addEventListener?: (type: string, listener: () => void) => void;
  screenX?: number; screenY?: number; innerWidth?: number; innerHeight?: number;
  resizeBy?: (dx: number, dy: number) => void;
};

function fakeLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

let previewBundle: Promise<string> | undefined;
let previewNonce = 0;
/** mock 은 창마다 따로 도는 모듈이다 — 묶음을 창마다 새로 불러와 그 창의 window 로 설치한다 */
async function openPreviewWindow(fake: PreviewWindow): Promise<PreviewApi> {
  // esbuild 는 이 테스트에서만 쓴다 — 파일 머리에서 가져오면 다른 테스트까지 esbuild 가 있어야 돈다
  const { build } = await import('esbuild');
  previewBundle ??= build({
    stdin: {
      contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'calendar-popup-preview-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  }).then((result) => result.outputFiles[0].text);
  const source = await previewBundle;
  const holder = globalThis as Record<string, unknown>;
  holder.window = fake;
  const encoded = Buffer.from(source).toString('base64');
  const preview = await import(`data:text/javascript;base64,${encoded}#calendar-popup-preview-${previewNonce++}`) as { installDevElectronAPI(): void };
  holder.window = fake; // import 를 기다리는 동안 다른 창으로 바뀌었을 수 있다
  preview.installDevElectronAPI();
  assert.ok(fake.electronAPI, 'mock 이 설치돼야 한다');
  return fake.electronAPI;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`기다렸지만 일어나지 않음: ${label}`);
}

test('미리보기: 새 창이 자기를 연 본 창의 로그인·로그아웃을 따라간다 (코덱스 지적)', async () => {
  const holder = globalThis as Record<string, unknown>;
  const saved = { hadWindow: 'window' in holder, window: holder.window, hadDocument: 'document' in holder, document: holder.document };
  const originalLog = console.log;
  console.log = () => undefined; // mock 설치 안내 글
  holder.document = { documentElement: { dataset: {} } };
  const names = (list: unknown[]) => list.map((payload) => (payload as PreviewSession).user?.name ?? null);
  try {
    const storage = fakeLocalStorage(); // 같은 주소의 창은 localStorage 를 함께 쓴다
    const mainWindow: PreviewWindow = { localStorage: storage, location: { hash: '' } };
    const main = await openPreviewWindow(mainWindow);
    // '로그인 유지'를 끄고 로그인 — 기억된 사용자가 없어 새 창 혼자서는 로그인을 되살리지 못한다
    assert.equal((await main.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false })).ok, true);

    const popupWindow: PreviewWindow = { localStorage: storage, location: { hash: '#widget-popup/schedule' }, opener: mainWindow };
    const popup = await openPreviewWindow(popupWindow);
    assert.equal((await popup.restoreCanonicalSession()).payload.user, null, '새 창 혼자서는 로그인 상태를 모른다');
    const seen: unknown[] = [];
    const off = popup.onSessionChanged((payload) => seen.push(payload));
    await popup.sessionRequestCurrent();
    await waitFor(() => seen.length === 1, '새 창이 본 창의 로그인을 받음');
    assert.deepEqual(names(seen), ['장삐쭈']);
    assert.equal((await popup.restoreCanonicalSession()).payload.user?.name, '장삐쭈', '새 창의 mock 도 그 사용자로 동작한다');

    // 다른 본 창(다른 탭)에 다른 사람이 로그인해도 새 창은 자기를 연 창만 따라간다
    const otherMain = await openPreviewWindow({ localStorage: fakeLocalStorage(), location: { hash: '' } });
    assert.equal((await otherMain.loginCanonicalSession({ name: '허혜원', password: '1234', rememberMe: false })).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(names(seen), ['장삐쭈']);
    // 본 창끼리는 서로의 로그인을 받지 않는다
    assert.equal((await main.restoreCanonicalSession()).payload.user?.name, '장삐쭈');
    assert.equal((await otherMain.restoreCanonicalSession()).payload.user?.name, '허혜원');

    // 본 창에서 다른 사람으로 다시 로그인 → 새 창도 바뀐다
    assert.equal((await main.loginCanonicalSession({ name: '안류천', password: '1234', rememberMe: false })).ok, true);
    await waitFor(() => seen.length === 2, '새 창이 바뀐 로그인을 받음');
    assert.deepEqual(names(seen), ['장삐쭈', '안류천']);

    // 본 창에서 로그아웃 → 열려 있던 새 창도 내용을 내린다(개인 일정이 남지 않게)
    await main.logoutCanonicalSession();
    await waitFor(() => seen.length === 3, '새 창이 로그아웃을 받음');
    assert.deepEqual(names(seen), ['장삐쭈', '안류천', null]);
    assert.equal((await popup.restoreCanonicalSession()).payload.user, null);

    // 로그아웃된 본 창에 다시 물어도(새 창을 새로 고친 경우) '로그인 안 됨'으로 남는다 — 다른 탭의 로그인을 주워 오지 않는다
    await popup.sessionRequestCurrent();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(names(seen), ['장삐쭈', '안류천', null]);

    // 구독을 끊으면 더 받지 않는다
    off();
    assert.equal((await main.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false })).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(seen.length, 3);

    // 주소를 직접 쳐서 연 새 창(연 창을 모름)은 로그인돼 있는 본 창의 답을 받는다
    const orphanWindow: PreviewWindow = { localStorage: fakeLocalStorage(), location: { hash: '#widget-popup/character-board' } };
    const orphan = await openPreviewWindow(orphanWindow);
    const orphanSeen: unknown[] = [];
    orphan.onSessionChanged((payload) => orphanSeen.push(payload));
    await orphan.sessionRequestCurrent();
    await waitFor(() => orphanSeen.length >= 1, '연 창을 모르는 새 창도 로그인 상태를 받음');
    assert.ok(names(orphanSeen).every((name) => name === '장삐쭈' || name === '허혜원'), names(orphanSeen).join(','));

    // 모르는 사용자 id 가 오면 '로그인 안 됨'으로 정리한다(가짜 id 를 쥐고 있다가 다음 신호에 또 알리지 않는다).
    // 이 시점의 새 창은 장삐쭈로 맞춰져 있다(위에서 구독만 끊었다).
    const ownerId = (mainWindow as unknown as { __bflowPreviewWindowId?: string }).__bflowPreviewWindowId;
    assert.equal(typeof ownerId, 'string', '본 창이 자기 id 를 window 에 남겨야 새 창이 알아본다');
    const again: unknown[] = [];
    popup.onSessionChanged((payload) => again.push(payload));
    const forged = new BroadcastChannel('bflow-dev-session');
    try {
      forged.postMessage({ kind: 'bflow-dev-session', type: 'state', from: ownerId, userId: 'no-such-user' });
      await waitFor(() => again.length === 1, '모르는 사용자 → 로그인 안 됨');
      forged.postMessage({ kind: 'bflow-dev-session', type: 'state', from: ownerId, userId: null });
      forged.postMessage({ kind: 'other-kind', type: 'state', from: ownerId, userId: '2' });
      forged.postMessage({ kind: 'bflow-dev-session', type: 'state', from: 'someone-else', userId: '2' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepEqual(names(again), [null], '이미 로그인 안 됨 상태 — 같은 상태·남의 신호·다른 종류의 신호로는 다시 알리지 않는다');
    } finally {
      forged.close();
    }

    // 지목해서 물으면 로그아웃된 본 창도 답한다 — 새 창이 '기억된 로그인'만으로 혼자 켜져 있지 않게.
    // (새 창이 뜨는 사이에 본 창이 로그아웃하면 그 알림을 놓친다. 그래서 뜬 뒤에 다시 묻는다.)
    const sharedStorage = fakeLocalStorage();
    const loggedOutMainWindow: PreviewWindow = { localStorage: sharedStorage, location: { hash: '' } };
    await openPreviewWindow(loggedOutMainWindow);
    const rememberingMain = await openPreviewWindow({ localStorage: sharedStorage, location: { hash: '' } });
    assert.equal((await rememberingMain.loginCanonicalSession({ name: '강선영', password: '1234' })).ok, true); // 로그인 유지(기본)
    const stalePopupWindow: PreviewWindow = { localStorage: sharedStorage, location: { hash: '#widget-popup/schedule' }, opener: loggedOutMainWindow };
    const stalePopup = await openPreviewWindow(stalePopupWindow);
    assert.equal((await stalePopup.restoreCanonicalSession()).payload.user?.name, '강선영', '기억된 로그인으로 혼자 켜진 상태');
    const staleSeen: unknown[] = [];
    stalePopup.onSessionChanged((payload) => staleSeen.push(payload));
    await stalePopup.sessionRequestCurrent();
    await waitFor(() => staleSeen.length === 1, '로그아웃된 본 창의 답');
    assert.deepEqual(names(staleSeen), [null]);
  } finally {
    console.log = originalLog;
    if (saved.hadWindow) holder.window = saved.window; else delete holder.window;
    if (saved.hadDocument) holder.document = saved.document; else delete holder.document;
  }
});

test('미리보기: 본 창을 새로 고쳐도 새 창은 그 본 창과 이어져 있다', async () => {
  // 본 창을 새로 고치면 그 창의 mock 이 처음부터 다시 돌아 창 id 가 바뀐다. 새 창이 '자기를 연 창'의 id 를 한 번 적어 두기만
  // 하면 새로 고친 본 창을 못 알아본다 — 화면 이동 부탁이 허공에 가고, 본 창이 로그아웃 상태로 떠도 새 창에 개인 일정이 남는다.
  const holder = globalThis as Record<string, unknown>;
  const saved = { hadWindow: 'window' in holder, window: holder.window, hadDocument: 'document' in holder, document: holder.document };
  const originalLog = console.log;
  console.log = () => undefined;
  holder.document = { documentElement: { dataset: {} } };
  const names = (list: unknown[]) => list.map((payload) => (payload as PreviewSession).user?.name ?? null);
  const windowId = (target: PreviewWindow) => (target as unknown as { __bflowPreviewWindowId?: string }).__bflowPreviewWindowId;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const tap = new BroadcastChannel('bflow-dev-session'); // 창 사이에 오가는 로그인 상태 신호를 옆에서 듣는다
  const heard: Array<{ type?: string; from?: string; restored?: boolean }> = [];
  tap.onmessage = (event) => { heard.push(event.data as { type?: string; from?: string; restored?: boolean }); };
  try {
    const storage = fakeLocalStorage();
    const mainWindow: PreviewWindow = { localStorage: storage, location: { hash: '' } };
    const main = await openPreviewWindow(mainWindow);
    assert.equal((await main.loginCanonicalSession({ name: '장삐쭈', password: '1234', rememberMe: false })).ok, true); // 로그인 유지 없이
    const popupWindow: PreviewWindow = { localStorage: storage, location: { hash: '#widget-popup/schedule' }, opener: mainWindow };
    const popup = await openPreviewWindow(popupWindow);
    const seen: unknown[] = [];
    popup.onSessionChanged((payload) => seen.push(payload));
    await popup.sessionRequestCurrent();
    await waitFor(() => seen.length === 1, '새 창이 본 창의 로그인을 받음');

    // 본 창 새로 고침 — 같은 창(같은 window)에 mock 이 새로 설치되고 id 가 바뀐다.
    // (실제로는 문서가 새로 만들어져 electronAPI 가 비어 있다. 흉내 낸 창에서는 직접 비운다.)
    const idBefore = windowId(mainWindow);
    delete mainWindow.electronAPI;
    const reloadedMain = await openPreviewWindow(mainWindow);
    const idAfter = windowId(mainWindow);
    assert.equal(typeof idAfter, 'string');
    assert.notEqual(idAfter, idBefore, '새로 고치면 창 id 가 바뀐다');

    // '로그인 유지' 없이 로그인했었으므로 새로 고친 본 창은 로그아웃 상태로 뜬다. 앱이 시작하며 로그인 상태를 되살릴 때
    // 그 창이 열어 둔 새 창도 내용을 내린다.
    assert.equal((await reloadedMain.restoreCanonicalSession()).payload.user, null);
    await waitFor(() => seen.length === 2, '새로 고친 본 창의 로그아웃 상태를 새 창이 받음');
    assert.deepEqual(names(seen), ['장삐쭈', null]);
    assert.equal((await popup.restoreCanonicalSession()).payload.user, null, '새 창의 mock 도 로그아웃 상태');

    // 새로 고친 본 창에서 다시 로그인 → 새 창이 따라온다
    assert.equal((await reloadedMain.loginCanonicalSession({ name: '안류천', password: '1234', rememberMe: false })).ok, true);
    await waitFor(() => seen.length === 3, '새로 고친 본 창의 로그인을 새 창이 받음');
    assert.deepEqual(names(seen), ['장삐쭈', null, '안류천']);

    // 화면 이동 부탁도 새로 고친 본 창이 받는다
    const got: unknown[] = [];
    reloadedMain.onWidgetNavigateView((payload) => got.push(payload));
    holder.window = popupWindow;
    await popup.widgetNavigateView({ view: 'settings' });
    await waitFor(() => got.length === 1, '새로 고친 본 창이 화면 이동 부탁을 받음');
    assert.deepEqual(got, [{ view: 'settings' }]);

    // 새 창이 다시 물으면(새 창만 새로 고친 경우) 지금의 본 창을 지목한다
    heard.length = 0;
    await popup.sessionRequestCurrent();
    await waitFor(() => heard.some((message) => message.type === 'request'), '새 창의 물음');
    assert.equal((heard.find((message) => message.type === 'request') as { to?: unknown }).to, idAfter, '옛 id 가 아니라 지금 id');
    await pause(80); // 본 창의 답이 지나가게

    // 새 창은 상태를 되살릴 때 알리지 않는다 — 알리는 쪽은 본 창뿐이다
    heard.length = 0;
    await popup.restoreCanonicalSession();
    await pause(80);
    assert.equal(heard.filter((message) => message.type === 'state').length, 0);
    // 본 창이 되살릴 때의 알림에는 '막 뜬 창의 지금 상태'라는 표시가 붙고, 로그인·로그아웃 알림에는 붙지 않는다
    await reloadedMain.restoreCanonicalSession();
    await waitFor(() => heard.some((message) => message.type === 'state' && message.from === idAfter), '본 창이 되살리며 알림');
    assert.equal(heard.find((message) => message.type === 'state' && message.from === idAfter)?.restored, true);
    await pause(80);
    heard.length = 0;
    assert.equal((await reloadedMain.loginCanonicalSession({ name: '안류천', password: '1234', rememberMe: false })).ok, true);
    await waitFor(() => heard.some((message) => message.type === 'state' && message.from === idAfter), '본 창이 로그인하며 알림');
    assert.notEqual(heard.find((message) => message.type === 'state' && message.from === idAfter)?.restored, true);

    // 연 창을 모르는 새 창(주소를 직접 쳐서 엶)은 관계없는 탭이 새로 떴다고 내용을 내리지 않는다.
    // 그 탭에서 실제로 로그아웃하면 따라간다(연 창을 모르면 아무 본 창의 로그인·로그아웃을 받는 기존 규칙).
    const orphanWindow: PreviewWindow = { localStorage: fakeLocalStorage(), location: { hash: '#widget-popup/schedule' } };
    const orphan = await openPreviewWindow(orphanWindow);
    const orphanSeen: unknown[] = [];
    orphan.onSessionChanged((payload) => orphanSeen.push(payload));
    heard.length = 0;
    await orphan.sessionRequestCurrent();
    await waitFor(() => orphanSeen.length >= 1, '연 창을 모르는 새 창이 로그인 상태를 받음');
    await pause(120); // 로그인돼 있는 다른 본 창들의 답이 다 올 때까지
    const settled = orphanSeen.length;
    assert.notEqual(names(orphanSeen).at(-1), null);
    // 물음에는 본 창만 답한다 — 로그인돼 있는 다른 새 창(위의 popup)은 답하지 않는다
    assert.equal(heard.filter((message) => message.type === 'state' && message.from === windowId(popupWindow)).length, 0);
    assert.ok(heard.some((message) => message.type === 'state' && message.from === idAfter), '새로 고친 본 창은 답했다');
    const freshTab = await openPreviewWindow({ localStorage: fakeLocalStorage(), location: { hash: '' } });
    assert.equal((await freshTab.restoreCanonicalSession()).payload.user, null, '새로 뜬 탭은 로그인 안 된 상태');
    await pause(120);
    assert.equal(orphanSeen.length, settled, '관계없는 탭이 떴다고 내용을 내리지 않는다');
    await freshTab.logoutCanonicalSession();
    await waitFor(() => orphanSeen.length === settled + 1, '실제 로그아웃은 따라간다');
    assert.equal(names(orphanSeen).at(-1), null);

    // 연 창을 읽을 수 없으면(연 창이 다른 사이트로 가 버려 읽는 순간 오류가 난다) 죽지 않고 '연 창을 모르는 새 창'으로 동작한다.
    // 연 창이 남긴 id 가 글자가 아니어도 마찬가지다.
    const requestFrom = (target: PreviewWindow) => heard.find((message) => message.type === 'request' && message.from === windowId(target)) as { to?: unknown } | undefined;
    const blockedOpener = new Proxy({}, { get() { throw new Error('SecurityError'); } });
    const strandedWindow: PreviewWindow = { localStorage: fakeLocalStorage(), location: { hash: '#widget-popup/schedule' }, opener: blockedOpener };
    const stranded = await openPreviewWindow(strandedWindow);
    const oddWindow: PreviewWindow = { localStorage: fakeLocalStorage(), location: { hash: '#widget-popup/schedule' }, opener: { __bflowPreviewWindowId: 42 } };
    const odd = await openPreviewWindow(oddWindow);
    heard.length = 0;
    assert.deepEqual(await stranded.sessionRequestCurrent(), { ok: true });
    assert.deepEqual(await odd.sessionRequestCurrent(), { ok: true });
    await waitFor(() => !!requestFrom(strandedWindow) && !!requestFrom(oddWindow), '연 창을 읽을 수 없는 새 창들의 물음');
    assert.equal(requestFrom(strandedWindow)?.to, null, '지목 없이 묻는다');
    assert.equal(requestFrom(oddWindow)?.to, null, '글자가 아닌 id 는 믿지 않는다');
    holder.window = strandedWindow;
    await stranded.widgetNavigateView({ view: 'vacation' }); // 화면 이동 부탁도 죽지 않는다
  } finally {
    tap.close();
    console.log = originalLog;
    if (saved.hadWindow) holder.window = saved.window; else delete holder.window;
    if (saved.hadDocument) holder.document = saved.document; else delete holder.document;
  }
});

test('미리보기: 새 창의 화면 이동 부탁은 그 창을 연 본 창만 받는다 (코덱스 지적)', async () => {
  // Electron 에는 본 창이 하나뿐이다. 미리보기에서 본 창 탭을 두 개 열어 두면, 맨몸으로 방송한 부탁을 두 탭이 다 받아
  // 새 창 하나가 모든 탭의 화면을 바꿨다. 부탁에 '자기를 연 창'을 실어 그 탭만 받게 한다.
  const holder = globalThis as Record<string, unknown>;
  const saved = { hadWindow: 'window' in holder, window: holder.window, hadDocument: 'document' in holder, document: holder.document };
  const originalLog = console.log;
  console.log = () => undefined;
  holder.document = { documentElement: { dataset: {} } };
  try {
    const storage = fakeLocalStorage();
    const mainWindow: PreviewWindow = { localStorage: storage, location: { hash: '' } };
    const otherMainWindow: PreviewWindow = { localStorage: storage, location: { hash: '' } };
    const popupWindow: PreviewWindow = { localStorage: storage, location: { hash: '#widget-popup/schedule' }, opener: mainWindow };
    const main = await openPreviewWindow(mainWindow);
    const otherMain = await openPreviewWindow(otherMainWindow);
    const popup = await openPreviewWindow(popupWindow);
    const got = { main: [] as unknown[], other: [] as unknown[], popup: [] as unknown[] };
    const offMain = main.onWidgetNavigateView((payload) => got.main.push(payload));
    otherMain.onWidgetNavigateView((payload) => got.other.push(payload));
    popup.onWidgetNavigateView((payload) => got.popup.push(payload));

    holder.window = popupWindow;
    await popup.widgetNavigateView({ view: 'scenes', episodeNumber: 5, highlightSceneId: 'a001' });
    await waitFor(() => got.main.length === 1, '새 창을 연 본 창이 부탁을 받음');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(got.main, [{ view: 'scenes', episodeNumber: 5, highlightSceneId: 'a001' }], '보낸 값 그대로');
    assert.deepEqual(got.other, [], '다른 탭은 움직이지 않는다');
    assert.deepEqual(got.popup, [], '새 창은 화면 이동 부탁을 받지 않는다');

    // 주소를 직접 쳐서 연 새 창은 연 창을 모른다 → 열려 있는 본 창이 모두 받는다
    const orphanWindow: PreviewWindow = { localStorage: storage, location: { hash: '#widget-popup/schedule' } };
    const orphan = await openPreviewWindow(orphanWindow);
    holder.window = orphanWindow;
    await orphan.widgetNavigateView({ view: 'settings' });
    await waitFor(() => got.main.length === 2 && got.other.length === 1, '연 창을 모르는 새 창의 부탁');
    assert.deepEqual(got.other, [{ view: 'settings' }]);
    assert.deepEqual(got.popup, []);

    // 다른 모양의 신호(예전의 맨몸 값·다른 종류)는 화면을 바꾸지 않는다
    const forged = new BroadcastChannel('bflow-dev-widget-navigate-view');
    try {
      forged.postMessage({ view: 'vacation' });
      forged.postMessage({ kind: 'something-else', to: null, payload: { view: 'vacation' } });
      forged.postMessage('vacation');
      forged.postMessage(null);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(got.main.length, 2);
      assert.equal(got.other.length, 1);
    } finally {
      forged.close();
    }

    // 구독을 끊으면 더 받지 않는다
    offMain();
    holder.window = popupWindow;
    await popup.widgetNavigateView({ view: 'vacation' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(got.main.length, 2);
    assert.equal(got.other.length, 1, '여전히 다른 탭은 받지 않는다');
  } finally {
    console.log = originalLog;
    if (saved.hadWindow) holder.window = saved.window; else delete holder.window;
    if (saved.hadDocument) holder.document = saved.document; else delete holder.document;
  }
});

test('미리보기: 새 창의 위치·크기를 기억했다가 다음에 그대로 연다 (코덱스 지적)', async () => {
  // Electron 에서는 main 이 새 창의 위치·크기를 저장해 다음에 같은 자리로 연다. 미리보기는 늘 기본 크기로만 열어서
  // '창의 위치와 크기는 다음에 열 때도 그대로'를 미리보기에서 확인할 수 없었다.
  const holder = globalThis as Record<string, unknown>;
  const saved = { hadWindow: 'window' in holder, window: holder.window, hadDocument: 'document' in holder, document: holder.document };
  const originalLog = console.log;
  const originalInfo = console.info;
  console.log = () => undefined;
  console.info = () => undefined; // [preview] widgetOpenPopup 안내 글
  holder.document = { documentElement: { dataset: {} } };
  try {
    const storage = fakeLocalStorage();
    const opened: Array<{ url: string; name: string; features: string }> = [];
    const mainWindow: PreviewWindow = {
      localStorage: storage,
      location: { hash: '', origin: 'http://localhost:5190', pathname: '/', search: '?preview=1' },
      open: (url, name, features) => { opened.push({ url, name, features }); return {}; },
    };
    const main = await openPreviewWindow(mainWindow);
    const open = async (widgetId: string, title: string) => {
      holder.window = mainWindow;
      assert.deepEqual(await main.widgetOpenPopup(widgetId, title), { ok: true });
      return opened.at(-1)!;
    };

    // 처음엔 기본 크기
    const first = await open('schedule', '캘린더');
    assert.equal(first.features, 'popup,width=1280,height=820');
    assert.equal(first.url, 'http://localhost:5190/?preview=1#widget-popup/schedule');
    assert.equal(first.name, 'bflow-widget-schedule');

    // 새 창: 크기가 바뀌면·닫힐 때 자기 위치와 크기를 적어 둔다
    const listeners = new Map<string, () => void>();
    const popupWindow: PreviewWindow = {
      localStorage: storage,
      location: { hash: '#widget-popup/schedule' },
      opener: mainWindow,
      screenX: 0, screenY: 0, innerWidth: 1280, innerHeight: 820,
      addEventListener: (type, listener) => { listeners.set(type, listener); },
    };
    await openPreviewWindow(popupWindow);
    assert.deepEqual([...listeners.keys()].sort(), ['pagehide', 'resize']);

    Object.assign(popupWindow, { screenX: 140, screenY: 60, innerWidth: 900, innerHeight: 640 });
    listeners.get('resize')!();
    assert.equal((await open('schedule', '캘린더')).features, 'popup,width=900,height=640,left=140,top=60');

    // 옮기기만 하면 브라우저가 알려 주지 않는다 → 닫힐 때 마지막 자리를 적는다
    Object.assign(popupWindow, { screenX: 300, screenY: 200 });
    listeners.get('pagehide')!();
    assert.equal((await open('schedule', '캘린더')).features, 'popup,width=900,height=640,left=300,top=200');

    // 다른 새 창은 자기 기본 크기 그대로(창마다 따로 기억한다)
    assert.equal((await open('character-board', '캐릭터 현황판')).features, 'popup,width=1160,height=780');
    assert.equal((await open('my-tasks', '내 할일')).features, 'popup,width=480,height=600');

    // 너무 작은 크기는 Electron 창과 같은 최소(280×200)로, 소수는 반올림
    Object.assign(popupWindow, { screenX: 10.4, screenY: 20.6, innerWidth: 100, innerHeight: 50 });
    listeners.get('resize')!();
    assert.equal((await open('schedule', '캘린더')).features, 'popup,width=280,height=200,left=10,top=21');

    // 본 창은 자기 위치·크기를 적지 않는다(새 창만)
    const mainListeners = new Map<string, () => void>();
    await openPreviewWindow({ localStorage: storage, location: { hash: '' }, addEventListener: (type, listener) => { mainListeners.set(type, listener); } });
    assert.equal(mainListeners.size, 0);

    // 기억한 값이 깨졌거나 숫자가 아니면 기본 크기로
    for (const broken of ['{broken', '[]', 'null', JSON.stringify({ schedule: { left: 'a', top: 0, width: 900, height: 640 } }), JSON.stringify({ schedule: { left: 0, top: 0, width: 900 } }), JSON.stringify({ schedule: null })]) {
      storage.setItem('bflow:preview:widget-popup-bounds', broken);
      assert.equal((await open('schedule', '캘린더')).features, 'popup,width=1280,height=820', broken);
    }

    // 값이 깨져 있어도 다음 저장은 된다 — 깨진 값은 버리고 깨끗하게 새로 적는다
    Object.assign(popupWindow, { screenX: 5, screenY: 6, innerWidth: 700, innerHeight: 500 });
    for (const broken of ['{broken', '[1,2]', '"text"', 'null', '7']) {
      storage.setItem('bflow:preview:widget-popup-bounds', broken);
      listeners.get('pagehide')!();
      assert.deepEqual(
        JSON.parse(storage.getItem('bflow:preview:widget-popup-bounds') ?? ''),
        { schedule: { left: 5, top: 6, width: 700, height: 500 } },
        broken,
      );
    }
    assert.equal((await open('schedule', '캘린더')).features, 'popup,width=700,height=500,left=5,top=6');

    // 여는 쪽이 준 크기를 Electron 은 창틀까지 포함한 크기로 읽어, 그대로 두면 열 때마다 창틀만큼 줄어든다.
    // 새 창은 떴을 때 기억한 안쪽 크기(700×500)와 다르면 스스로 맞춘다. 같으면 건드리지 않는다.
    const resized: Array<[number, number]> = [];
    const popupLike = (innerWidth: number, innerHeight: number, hash = '#widget-popup/schedule'): PreviewWindow => ({
      localStorage: storage, location: { hash }, opener: mainWindow, screenX: 5, screenY: 6, innerWidth, innerHeight,
      addEventListener: () => undefined,
      resizeBy: (dx, dy) => { resized.push([dx, dy]); },
    });
    await openPreviewWindow(popupLike(686, 437));
    assert.deepEqual(resized, [[14, 63]], '창틀만큼 작게 열렸으면 그만큼 키운다');
    await openPreviewWindow(popupLike(700, 500));
    assert.equal(resized.length, 1, '이미 맞으면 건드리지 않는다');
    await openPreviewWindow(popupLike(400, 300, '#widget-popup/my-tasks'));
    assert.equal(resized.length, 1, '기억한 것이 없는 새 창은 건드리지 않는다');
    await openPreviewWindow(popupLike(690, 500));
    await openPreviewWindow(popupLike(700, 520));
    assert.deepEqual(resized.slice(1), [[10, 0], [0, -20]], '가로나 세로 한쪽만 달라도 맞춘다');

    // 다른 새 창이 자기 자리를 적어도 캘린더 창의 기억은 남는다
    const boardListeners = new Map<string, () => void>();
    await openPreviewWindow({
      localStorage: storage,
      location: { hash: '#widget-popup/character-board?tab=board' },
      opener: mainWindow,
      screenX: 40, screenY: 50, innerWidth: 1000, innerHeight: 720,
      addEventListener: (type, listener) => { boardListeners.set(type, listener); },
    });
    boardListeners.get('pagehide')!();
    assert.equal((await open('character-board', '캐릭터 현황판')).features, 'popup,width=1000,height=720,left=40,top=50', '주소 뒤 쿼리는 창 id 가 아니다');
    assert.equal((await open('schedule', '캘린더')).features, 'popup,width=700,height=500,left=5,top=6');
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    if (saved.hadWindow) holder.window = saved.window; else delete holder.window;
    if (saved.hadDocument) holder.document = saved.document; else delete holder.document;
  }
});

test('게이트 등록: 이 파일이 test:ui 에 들어 있다', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts['test:ui'].includes('./tests/calendarPopup.test.ts'));
  assert.ok(pkg.scripts['test:ui'].includes('./tests/sidebarCharacterPopout.test.ts'));
});
