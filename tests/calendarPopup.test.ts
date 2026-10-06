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

test('미리보기 mock: 창 사이 화면 이동 신호를 주고받는다', () => {
  const mock = code('src/mocks/devElectronAPI.ts');
  assert.match(mock, /widgetNavigateView: async \(payload\) => \{\s+getMockWidgetViewChannel\(\)\?\.postMessage\(payload\);/);
  assert.match(mock, /onWidgetNavigateView: \(callback\) => \{\s+const channel = getMockWidgetViewChannel\(\);\s+if \(!channel\) return \(\) => \{\};\s+const handler = \(event: MessageEvent\) => callback\(event\.data\);\s+channel\.addEventListener\('message', handler\);\s+return \(\) => channel\.removeEventListener\('message', handler\);/);
});

test('게이트 등록: 이 파일이 test:ui 에 들어 있다', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts['test:ui'].includes('./tests/calendarPopup.test.ts'));
  assert.ok(pkg.scripts['test:ui'].includes('./tests/sidebarCharacterPopout.test.ts'));
});
