import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen, shell, Notification, Tray, Menu, nativeImage, dialog } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import * as gcal from './googleCalendar';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import {
  initSheets,
  isConnected,
  readAllMetadata,
  readCommentsForPart,
  readRevisionsFromSheets,
  setRetryNotifyCallback,
  getPendingOpsCount,
  waitForAllPendingOps,
} from './sheets';
import { uploadImage as driveUploadImage, setImageUploadUrl } from './drive-image';
import { uploadImage as storageUploadImage, deleteImage as storageDeleteImage } from './storage';
import {
  initVacation,
  isVacationConnected,
  readVacationStatus,
  readVacationLog,
  readAllVacationEvents,
  registerVacation,
  cancelVacation,
  grantDahyu,
  readAllEmployeeNames,
  readDahyuList,
  deleteDahyu,
  getVacPendingOpsCount,
  waitForVacPendingOps,
} from './vacation';

// 앱 이름 설정 — AppData 경로에 영향
app.name = 'Bflow-BGonly';

// Chromium 성능 스위치 (app.ready 전에 호출)
app.commandLine.appendSwitch('js-flags', '--nolazy');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// ─── 이미지 커스텀 프로토콜 등록 (app.ready 전에 호출 필수) ──
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bflow-img',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: 'drive-img',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
const widgetWindows = new Map<string, BrowserWindow>();
const widgetOriginalBounds = new Map<string, Electron.Rectangle>();
const animatingWidgets = new Set<string>();
let isQuitting = false;
let tray: Tray | null = null;
let trayFailed = false;
let lastSupabaseStatus = '연결 중...';
// Codex 리뷰 #7 P2: 렌더러 Overview/SupabaseStatusCard 가 뒤늦게 마운트되는 경우
// onStatusChange 구독으론 과거 이벤트를 못 받음 → 원본 Realtime status 를 캐시해 IPC getter 로 노출.
let currentRealtimeStatus: string = 'CONNECTING';
// Chunk 2(스플래시 2단계 부팅)에서 사용 예정
let splashWin: BrowserWindow | null = null;
// Chunk 2(스플래시 2단계 부팅)에서 사용 예정
let mainLoadedOk = false;
let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
let showTrayHintInFlight = false;
// 최근 브로드캐스트된 세션 정보 캐시 → 새로 열리는 플로팅 위젯 창에 즉시 전달
// (메인 프로세스 재시작 시 null로 초기화됨 — 메인 창이 첫 로그인 broadcast를 쏘면 다시 캐싱)
let lastKnownSession: unknown = null;

/** 아이콘 경로 해석: dev(electron/)와 prod(dist-electron/) + app.getAppPath() 순회 */
function resolveTrayIconPath(): string {
  const candidates = [
    path.join(__dirname, '../public/splash/opening_image_cropped.png'),
    path.join(app.getAppPath(), 'public/splash/opening_image_cropped.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return '';
}

/** Supabase 원시 상태 → 사용자에게 보여줄 한글 라벨 */
function humanizeStatus(raw: string): string {
  switch (raw) {
    case 'SUBSCRIBED': return '실시간 연결됨';
    case 'CHANNEL_ERROR': return '재연결 중';
    case 'TIMED_OUT': return '연결 타임아웃';
    case 'CLOSED': return '연결 끊김';
    default: return raw || '연결 중...';
  }
}

/** 메인 창을 보이고 포커스. 숨김 상태면 복원.
 *  렌더러 크래시 등으로 창이 파괴된 상태에서도 createWindow()로 복구. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[창] 메인 창이 없음 — 재생성');
    mainLoadedOk = false; // 새 로드 사이클 시작
    createWindow();        // did-finish-load 핸들러에서 자동으로 show + focus
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** 트레이 위젯 서브메뉴 토글 핸들러 */
function toggleWidget(widgetId: string, title: string): void {
  const existing = widgetWindows.get(widgetId);
  if (existing && !existing.isDestroyed()) {
    existing.close(); // closed 이벤트가 widgetWindows에서 제거
  } else {
    openWidgetPopup(widgetId, title);
  }
  // 메뉴 체크박스 상태 갱신
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const widgetSubmenu: MenuItemConstructorOptions[] = Object.entries(WIDGET_TITLE_MAP).map(
    ([id, title]) => ({
      label: title,
      type: 'checkbox',
      checked: widgetWindows.has(id),
      click: () => toggleWidget(id, title),
    }),
  );
  const status = lastSupabaseStatus;
  const menu = Menu.buildFromTemplate([
    { label: '열기', click: showMainWindow },
    { type: 'separator' },
    { label: '위젯', submenu: widgetSubmenu },
    { type: 'separator' },
    { label: `상태: ${status}`, enabled: false },
    { type: 'separator' },
    { label: '종료', click: () => { app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`B flow • ${status}`);
}

async function showTrayHintOnce(): Promise<void> {
  if (showTrayHintInFlight) return;
  showTrayHintInFlight = true;
  try {
    const state = await readAppState();
    if (state.trayFirstMinimizeSeen) return;

    let shown = false;
    if (Notification.isSupported()) {
      try {
        new Notification({
          title: 'B flow',
          body: '트레이로 숨겨졌습니다. 트레이 아이콘 우클릭 → 종료로 완전히 닫을 수 있습니다.',
        }).show();
        shown = true;
      } catch { /* ignore */ }
    }

    if (!shown && tray && !tray.isDestroyed() && process.platform === 'win32') {
      try {
        tray.displayBalloon({
          title: 'B flow',
          content: '트레이에 숨겨졌습니다. 트레이 메뉴 종료로 완전히 닫을 수 있습니다.',
        });
        shown = true;
      } catch (err) {
        console.warn('[트레이] displayBalloon 실패 — 조용히 폴백 없이 진행:', err);
      }
    }

    if (shown) {
      await writeAppState({ trayFirstMinimizeSeen: true });
    }
  } finally {
    showTrayHintInFlight = false;
  }
}

function resolveSplashHtmlPath(): string {
  const candidates = [
    path.join(__dirname, '../public/splash/splash.html'),
    path.join(app.getAppPath(), 'public/splash/splash.html'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {/* ignore */}
  }
  return '';
}

function createSplashWindow(): void {
  const htmlPath = resolveSplashHtmlPath();
  if (!htmlPath) {
    console.warn('[스플래시] HTML 파일을 찾지 못함 — 스플래시 생략');
    return;
  }
  splashWin = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    closable: false, // 사용자가 닫지 못하게 (좀비 방지)
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWin.loadFile(htmlPath).catch((err) => {
    console.error('[스플래시] loadFile 실패:', err);
  });
}

function closeSplash(): void {
  if (splashWin && !splashWin.isDestroyed()) {
    // closable:false 창은 close() 거부 → destroy() 사용
    // destroy()가 Windows 특정 엣지 케이스에서 throw 가능 → try/catch로 방어
    try {
      splashWin.destroy();
    } catch (err) {
      console.error('[스플래시] destroy 실패 — 무시하고 진행:', err);
    }
  }
  splashWin = null;
}

function createTray(): void {
  try {
    const iconPath = resolveTrayIconPath();
    // 아이콘 파일을 실제로 찾지 못했으면 → 보이지 않는 트레이로 이어져
    // "앱이 사라진 것처럼" 보일 위험. 트레이 실패로 간주해 창 X = 실제 종료로 폴백.
    if (!iconPath) {
      console.error('[트레이] 아이콘 파일을 찾지 못함 — 트레이 없이 실행 (창 X = 실제 종료)');
      tray = null;
      trayFailed = true;
      return;
    }
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      // 파일은 존재하지만 디코딩 실패 → 역시 보이지 않는 트레이 위험
      console.error('[트레이] 아이콘 디코딩 실패 — 트레이 없이 실행 (창 X = 실제 종료):', iconPath);
      tray = null;
      trayFailed = true;
      return;
    }
    image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip('B flow');
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
    rebuildTrayMenu();
  } catch (err) {
    console.error('[트레이] 생성 실패 — 트레이 없이 실행 (창 X = 실제 종료):', err);
    tray = null;
    trayFailed = true;
  }
}

// ─── 위젯 위치 영속화 (Phase 0-6) ─────────────────────────────
const WIDGET_POS_FILE = 'widget-positions.json';

interface SavedWidgetState {
  x: number; y: number; width: number; height: number;
  opacity: number; alwaysOnTop: boolean;
  title?: string;
  // 위젯 query string용 부가 파라미터 (예: EP 위젯의 ?ep=1).
  // 재실행 시 유실 방지를 위해 함께 영속화. optional이라 구버전 파일과 호환.
  extra?: Record<string, string>;
  /**
   * 위젯이 "현재 열림" 상태인지. false/undefined 면 자동 복원 대상 아님.
   * - 사용자가 위젯 창의 X 를 누르면 false 로 갱신 (위치·크기는 유지해 다음에 다시 열 때 그 자리에 뜨도록)
   * - 위젯 팝업을 여는 IPC 호출 시 true 로 갱신
   */
  isOpen?: boolean;
}

// 위젯 ID → 제목 매핑 (자동 복원 시 title 미저장 파일 호환용)
const WIDGET_TITLE_MAP: Record<string, string> = {
  'overall-progress': '전체 진행률',
  'stage-bars': '단계별 진행률',
  'assignee-cards': '담당자별 현황',
  'episode-summary': '에피소드 요약',
  'dept-comparison': '부서별 비교',
};

const widgetPositionCache = new Map<string, SavedWidgetState>();
let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;

function loadWidgetPositions(): void {
  try {
    const filePath = path.join(getDataPath(), WIDGET_POS_FILE);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data && typeof data === 'object') {
      for (const [id, state] of Object.entries(data)) {
        widgetPositionCache.set(id, state as SavedWidgetState);
      }
    }
  } catch { /* 파일 없음 — 무시 */ }
}

function saveWidgetPositionsDebounced(): void {
  if (positionSaveTimer) clearTimeout(positionSaveTimer);
  positionSaveTimer = setTimeout(() => {
    const obj: Record<string, SavedWidgetState> = {};
    for (const [id, state] of widgetPositionCache) obj[id] = state;
    try {
      const dirPath = getDataPath();
      ensureDir(dirPath);
      fs.writeFileSync(path.join(dirPath, WIDGET_POS_FILE), JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      console.error('[위젯 위치] 저장 실패:', err);
    }
  }, 500);
}

function saveWidgetPositionsSync(): void {
  if (positionSaveTimer) {
    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  const obj: Record<string, SavedWidgetState> = {};
  for (const [id, state] of widgetPositionCache) obj[id] = state;
  try {
    const dirPath = getDataPath();
    ensureDir(dirPath);
    fs.writeFileSync(path.join(dirPath, WIDGET_POS_FILE), JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[위젯 위치] 동기 저장 실패:', err);
  }
}

// ─── 독 스태킹 관리 ─────────────────────────────────────────
const dockedWidgetIds: string[] = [];          // 독에 쌓인 순서
let expandedDockWidgetId: string | null = null; // 현재 호버 확장 중인 위젯

const DOCK_ITEM_W = 140;
const DOCK_ITEM_H = 36;
const DOCK_GAP = 6;
const DOCK_MARGIN = 20;

/** 독 스택에서 index 번째 위치 (아래→위로 쌓임) */
function getDockPosition(index: number): { x: number; y: number; width: number; height: number } {
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  return {
    x: wa.x + wa.width - DOCK_ITEM_W - DOCK_MARGIN,
    y: wa.y + wa.height - DOCK_ITEM_H - DOCK_MARGIN - index * (DOCK_ITEM_H + DOCK_GAP),
    width: DOCK_ITEM_W,
    height: DOCK_ITEM_H,
  };
}

/** 모든 독 위젯을 스택 위치로 재배치 (확장 중인 위젯 제외) */
function repositionAllDocked(excludeWidgetId?: string): void {
  for (let i = 0; i < dockedWidgetIds.length; i++) {
    const wid = dockedWidgetIds[i];
    if (wid === excludeWidgetId) continue;
    const win = widgetWindows.get(wid);
    if (!win || win.isDestroyed()) continue;
    const pos = getDockPosition(i);
    win.setBounds(pos);
  }
}

// ─── 위젯 윈도우 애니메이션 (CSS 기반 — setBounds 루프 대신 단일 스냅) ─────
// iOS 스타일: CSS가 시각 전환을 담당, 네이티브 setBounds는 1회만 호출
// → 프레임 드롭 완전 제거 (setBounds 루프가 Windows에서 스터터링 유발)

/** 딜레이 유틸 */
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 윈도우 바운드를 부드럽게 애니메이션 (easeInOut 커브)
 * CSS transition은 윈도우 크기/위치에 적용 불가 → 네이티브 setBounds 보간
 */
function animateBounds(
  win: BrowserWindow,
  from: Electron.Rectangle,
  to: Electron.Rectangle,
  duration: number,
  widgetId: string,
): Promise<void> {
  return new Promise((resolve) => {
    animatingWidgets.add(widgetId);
    const startTime = Date.now();
    const FPS = 60;
    const interval = Math.round(1000 / FPS);

    // easeInOutCubic
    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

    const timer = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(timer);
        animatingWidgets.delete(widgetId);
        resolve();
        return;
      }

      const elapsed = Date.now() - startTime;
      const raw = Math.min(elapsed / duration, 1);
      const t = ease(raw);

      win.setBounds({
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        width: lerp(from.width, to.width, t),
        height: lerp(from.height, to.height, t),
      });

      if (raw >= 1) {
        clearInterval(timer);
        animatingWidgets.delete(widgetId);
        resolve();
      }
    }, interval);
  });
}

/** 모든 윈도우(메인 + 위젯 팝업)에 sheet:changed 이벤트 브로드캐스트 (delta 페이로드 포함) */
function broadcastDataChanged(excludeWebContentsId?: number, delta?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.id !== excludeWebContentsId) {
      mainWindow.webContents.send('data:changed', delta);
    }
  }
  for (const [, win] of widgetWindows) {
    if (!win.isDestroyed() && win.webContents.id !== excludeWebContentsId) {
      win.webContents.send('data:changed', delta);
    }
  }
}

/** 스냅샷 릴레이: 보낸 창 제외 모든 창에 전체 데이터 전달 */
function broadcastSnapshotRelay(excludeWebContentsId: number, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.id !== excludeWebContentsId) {
      mainWindow.webContents.send('sheet:snapshot-relay', data);
    }
  }
  for (const [, win] of widgetWindows) {
    if (!win.isDestroyed() && win.webContents.id !== excludeWebContentsId) {
      win.webContents.send('sheet:snapshot-relay', data);
    }
  }
}

/** 메인 창 + 모든 위젯 창에 동일 이벤트 push (optional: 송신자 제외) */
function broadcastToAllWindows(
  channel: string,
  payload?: unknown,
  excludeSenderId?: number,
): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents.id !== excludeSenderId
  ) {
    mainWindow.webContents.send(channel, payload);
  }
  for (const win of widgetWindows.values()) {
    if (!win.isDestroyed() && win.webContents.id !== excludeSenderId) {
      win.webContents.send(channel, payload);
    }
  }
}

// ─── 유틸리티 ─────────────────────────────────────────────────

function getDataPath(): string {
  return app.getPath('userData');
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getAppRoot(): string {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  // 개발 모드: 딥링크로 앱이 시작되면 cwd가 C:\WINDOWS\system32가 될 수 있으므로
  // __dirname 기준으로 프로젝트 루트를 찾는다 (electron/ → 상위)
  return path.resolve(__dirname, '..');
}

// ─── 윈도우 생성 ──────────────────────────────────────────────

// ─── 메인 창 bounds 저장/복원 ─────────────────────────
interface StoredMainWindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

let cachedMainWindowBounds: StoredMainWindowBounds | null = null;
let saveMainWindowBoundsTimer: ReturnType<typeof setTimeout> | null = null;

async function loadMainWindowBounds(): Promise<StoredMainWindowBounds | null> {
  try {
    const state = await readAppState();
    const b = state.mainWindowBounds as StoredMainWindowBounds | undefined;
    if (!b) return null;
    // 크기 sanity
    if (b.width < 300 || b.height < 200 || b.width > 10000 || b.height > 10000) return null;
    // 위치가 있으면 off-screen 검증 — 중심점이 어느 display 작업영역 안에 있어야 함
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const inside = screen.getAllDisplays().some((d) => {
        const { x, y, width, height } = d.workArea;
        return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
      });
      if (!inside) {
        // 위치는 포기하고 크기와 최대화 상태만 유지
        return { width: b.width, height: b.height, isMaximized: b.isMaximized, isFullScreen: b.isFullScreen };
      }
    }
    return b;
  } catch {
    return null;
  }
}

async function preloadMainWindowBounds(): Promise<void> {
  cachedMainWindowBounds = await loadMainWindowBounds();
}

function scheduleSaveMainWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (saveMainWindowBoundsTimer) clearTimeout(saveMainWindowBoundsTimer);
  saveMainWindowBoundsTimer = setTimeout(() => {
    saveMainWindowBoundsTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const isMaximized = mainWindow.isMaximized();
    const isFullScreen = mainWindow.isFullScreen();
    // maximize/fullscreen 상태의 "복원 크기" 저장 — 다음 실행 때 창을 원래 크기로 기억
    const raw = isMaximized || isFullScreen ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    const payload: StoredMainWindowBounds = {
      x: raw.x, y: raw.y, width: raw.width, height: raw.height,
      isMaximized, isFullScreen,
    };
    writeAppState({ mainWindowBounds: payload }).catch((err) =>
      console.warn('[window-bounds] 저장 실패:', err));
  }, 500);
}

function createWindow(): void {
  const b = cachedMainWindowBounds;
  mainWindow = new BrowserWindow({
    x: b?.x,
    y: b?.y,
    width: b?.width ?? 1400,
    height: b?.height ?? 900,
    minWidth: 800,
    minHeight: 600,
    title: 'B flow',
    backgroundColor: '#0F1117',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 저장된 최대화/전체화면 상태 복원
  if (b?.isMaximized) mainWindow.maximize();
  if (b?.isFullScreen) mainWindow.setFullScreen(true);

  // bounds 변경 시 디바운스(500ms) 저장 — 디스크 I/O 최소화
  mainWindow.on('resize', scheduleSaveMainWindowBounds);
  mainWindow.on('move', scheduleSaveMainWindowBounds);
  mainWindow.on('maximize', scheduleSaveMainWindowBounds);
  mainWindow.on('unmaximize', scheduleSaveMainWindowBounds);
  mainWindow.on('enter-full-screen', scheduleSaveMainWindowBounds);
  mainWindow.on('leave-full-screen', scheduleSaveMainWindowBounds);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 메인 로드 완료 → 스플래시 닫고 메인 창 show
  mainWindow.webContents.once('did-finish-load', () => {
    if (isQuitting) return; // 타임아웃으로 이미 종료 중
    mainLoadedOk = true;
    if (loadTimeoutId) {
      clearTimeout(loadTimeoutId); // Task 2.4에서 설정한 타임아웃 해제
      loadTimeoutId = null;
    }
    closeSplash();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    // 재생성 경로 복구: 창 크래시 후 복구된 경우 보류 중인 딥링크 전달
    // (최초 시작 시엔 app.whenReady의 .once 리스너와 중복이지만, pendingDeepLink를
    //  null로 세팅하므로 멱등하게 동작)
    if (pendingDeepLink) {
      sendDeepLinkToRenderer(pendingDeepLink);
      pendingDeepLink = null;
    }
    try { console.timeEnd('splash-to-main'); } catch {/* 이미 종료됨 */}
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && !trayFailed) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      showTrayHintOnce().catch(() => {/* ignore */});
      return;
    }
    // isQuitting === true || trayFailed === true인 경우 기본 동작 허용
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 핸들러: 사용자 파일 (base64 인코딩 JSON) ────────────

function getUsersFilePath(): string {
  // userData 경로 사용 — portable 빌드는 app.getPath('exe')가 매 실행마다
  // 임시 압축해제 폴더를 반환해 users.dat 이 소실됨. userData 는 고정.
  return path.join(getDataPath(), 'users.dat');
}

function getAppStateFilePath(): string {
  return path.join(getDataPath(), 'app-state.json');
}

async function readAppState(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(getAppStateFilePath(), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeAppState(patch: Record<string, unknown>): Promise<void> {
  const prev = await readAppState();
  const next = { ...prev, ...patch };
  ensureDir(path.dirname(getAppStateFilePath()));
  await fs.promises.writeFile(getAppStateFilePath(), JSON.stringify(next, null, 2), 'utf-8');
}

// Codex 리뷰 #3 P1: users.dat 경로를 getAppRoot() → userData 로 바꾸면서
// 기존 로컬 파일이 보이지 않게 됨. 업그레이드 사용자의 로컬 사용자 목록 보존 위해
// 최초 접근 시 한 번만 legacy(getAppRoot()/users.dat) → userData/users.dat 로 복사.
let usersFileMigrationChecked = false;
function migrateLegacyUsersFileIfNeeded(): void {
  if (usersFileMigrationChecked) return;
  usersFileMigrationChecked = true;
  const newPath = getUsersFilePath();
  if (fs.existsSync(newPath)) return; // 이미 userData 쪽에 있으면 migration 불필요
  const legacyPath = path.join(getAppRoot(), 'users.dat');
  if (!fs.existsSync(legacyPath)) return; // 레거시 파일도 없으면 생략
  try {
    ensureDir(path.dirname(newPath));
    fs.copyFileSync(legacyPath, newPath);
    console.log('[users] 레거시 users.dat 를 userData 로 마이그레이션 (롤백 대비 원본 유지)');
  } catch (err) {
    console.warn('[users] 레거시 users.dat 마이그레이션 실패:', err);
  }
}

ipcMain.handle('users:read', () => {
  migrateLegacyUsersFileIfNeeded();
  const filePath = getUsersFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
    const json = Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
});

ipcMain.handle('users:write', (_event, data: unknown) => {
  migrateLegacyUsersFileIfNeeded();
  const filePath = getUsersFilePath();
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const json = JSON.stringify(data, null, 2);
  const encoded = Buffer.from(json, 'utf-8').toString('base64');
  fs.writeFileSync(filePath, encoded, { encoding: 'utf-8' });
  return true;
});

// ─── IPC 핸들러: 설정 ────────────────────────────────────────

ipcMain.handle('settings:get-path', () => getDataPath());

// 외부 URL 을 기본 브라우저로 열기 (메모 링크)
ipcMain.handle('shell:open-external', async (_event, url: string) => {
  try {
    if (typeof url !== 'string' || !/^(https?:|mailto:|tel:)/i.test(url)) {
      return { ok: false, error: 'invalid url' };
    }
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// 파일탐색기에서 경로 열기
ipcMain.handle('shell:show-item', async (_event, filePath: string) => {
  try {
    // 파일이면 해당 파일 선택 상태로 폴더 열기, 폴더면 폴더 열기
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      // 존재하지 않으면 상위 폴더 열기 시도
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        shell.openPath(dir);
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('settings:read', async (_event, fileName: string) => {
  const filePath = path.join(getDataPath(), fileName);
  try {
    const data = fs.readFileSync(filePath, { encoding: 'utf-8' });
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('settings:write', async (_event, fileName: string, data: unknown) => {
  const dirPath = getDataPath();
  ensureDir(dirPath);
  const filePath = path.join(dirPath, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  return true;
});

// ─── IPC 핸들러: 화이트보드 (공유 드라이브 파일) ─────────────

const SHARED_DRIVE_BASE = 'G:\\공유 드라이브\\JBBJ 자료실\\한솔이의 두근두근 실험실\\Bflow-BGonly';
const SHARED_WHITEBOARD_FILE = 'whiteboard-public.json';

function getSharedWhiteboardDir(): string {
  if (fs.existsSync(SHARED_DRIVE_BASE)) return SHARED_DRIVE_BASE;
  return path.join(getDataPath(), 'shared-whiteboard');
}

ipcMain.handle('whiteboard:read-shared', async () => {
  try {
    const dir = getSharedWhiteboardDir();
    const filePath = path.join(dir, SHARED_WHITEBOARD_FILE);
    if (!fs.existsSync(filePath)) {
      return { ok: true, data: null };
    }
    const raw = fs.readFileSync(filePath, { encoding: 'utf-8' });
    return { ok: true, data: JSON.parse(raw) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: null, error: msg };
  }
});

ipcMain.handle('whiteboard:write-shared', async (_event, data: unknown) => {
  try {
    const dir = getSharedWhiteboardDir();
    ensureDir(dir);
    const filePath = path.join(dir, SHARED_WHITEBOARD_FILE);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    fs.renameSync(tmpPath, filePath);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: Supabase ────────────────────────────────────

import { setupBroadcast, broadcastSceneUpdate, broadcastSceneFieldUpdate, broadcastDataChange } from './broadcast';
import {
  testConnection as supabaseTestConnection,
  readAllEpisodes as sbReadAllEpisodes,
  addEpisode as sbAddEpisode,
  softDeleteEpisode as sbSoftDeleteEpisode,
  archiveEpisode as sbArchiveEpisode,
  unarchiveEpisode as sbUnarchiveEpisode,
  readArchivedEpisodes as sbReadArchived,
  addPart as sbAddPart,
  softDeletePart as sbSoftDeletePart,
  addScene as sbAddScene,
  addScenes as sbAddScenes,
  deleteScene as sbDeleteScene,
  updateSceneStage as sbUpdateSceneStage,
  bulkUpdateSceneStages as sbBulkUpdateSceneStages,
  bulkDeleteScenes as sbBulkDeleteScenes,
  bulkUpdateSceneFields as sbBulkUpdateSceneFields,
  updateSceneField as sbUpdateSceneField,
  readUsers as sbReadUsers,
  addUser as sbAddUser,
  updateUser as sbUpdateUser,
  deleteUser as sbDeleteUser,
  readCommentsForPart as sbReadComments,
  fetchMissedMentions as sbFetchMissedMentions,
  addComment as sbAddComment,
  editComment as sbEditComment,
  deleteComment as sbDeleteComment,
  readAllRevisions as sbReadRevisions,
  addRevision as sbAddRevision,
  updateRevision as sbUpdateRevision,
  deleteRevision as sbDeleteRevision,
  readAllMetadata as sbReadAllMetadata,
  readMetadata as sbReadMetadata,
  writeMetadata as sbWriteMetadata,
  readTodos as sbReadTodos,
  upsertTodo as sbUpsertTodo,
  deleteTodo as sbDeleteTodo,
  readTaskViews as sbReadTaskViews,
  upsertTaskViews as sbUpsertTaskViews,
  readMemo as sbReadMemo,
  upsertMemo as sbUpsertMemo,
  readAllMemos as sbReadAllMemos,
  readPrivateEvents as sbReadPrivateEvents,
  addPrivateEvent as sbAddPrivateEvent,
  updatePrivateEvent as sbUpdatePrivateEvent,
  deletePrivateEvent as sbDeletePrivateEvent,
  getPrivateEventOwner as sbGetPrivateEventOwner,
  listActivities as sbListActivities,
  getActivityStats as sbGetActivityStats,
  backfillActivities as sbBackfillActivities,
  getActivityStorageInfo as sbGetActivityStorageInfo,
} from './supabase';
import type { SupabaseUser, BulkStageUpdate, BulkFieldUpdate } from './supabase';
import { setupRealtimeSubscription, teardownRealtime } from './realtime';
import { recordActivity, getActivity, channelToTable, channelToAction } from './activityLogger';

// ─── Supabase IPC 에러 래퍼 ───
function wrapIpc<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Supabase IPC]', msg);
      throw new Error(msg);
    }
  };
}

// ─── Supabase IPC 활동 자동 기록 래퍼 ───
// ipcMain.handle('supabase:*', ...) 에만 가로채기 적용. 다른 채널은 그대로.
// 'supabase:get-activity' 자신은 기록에서 제외 (자가 호출로 활동 왜곡 방지).
{
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: (...args: unknown[]) => unknown) => {
    if (!channel.startsWith('supabase:') || channel === 'supabase:get-activity') {
      return origHandle(channel, listener as Parameters<typeof origHandle>[1]);
    }
    const table = channelToTable(channel);
    const action = channelToAction(channel);
    return origHandle(channel, (async (...args: unknown[]) => {
      recordActivity(table, action);
      return listener(...args);
    }) as Parameters<typeof origHandle>[1]);
  }) as typeof ipcMain.handle;
}

// ─── 활동 기록 헬퍼 ───
// 렌더러가 useAuthStore 변경 시 'auth:set-current-user' 로 알려준다.
// 메인은 이 정보로 자동 활동 기록 (mutation 핸들러에서 1줄 호출).
let currentActivityUser: { id: string; name: string } | null = null;

ipcMain.handle('auth:set-current-user', (_e, user: { id: string; name: string } | null) => {
  currentActivityUser = user;
});

import { supabase as supabaseClient, recordActivityLog as sbRecordActivityLog } from './supabase';
import type { ActionGroup, ActionType } from './supabase';

/** revision sceneKey ('EP02:A:35' 또는 'raw-...') 에서 scene_number 추출. addRevision 의 sceneIdForResolve 와 동일 로직. */
function parseRevisionSceneKey(sceneKey: string): string {
  const rawSegment = sceneKey.includes(':') ? sceneKey.split(':').pop() || sceneKey : sceneKey;
  const lowerSegment = rawSegment.trim().toLowerCase();
  if (lowerSegment.startsWith('raw-')) {
    try { return decodeURIComponent(lowerSegment.slice(4)); }
    catch { return lowerSegment.slice(4); }
  }
  return rawSegment;
}

/** scene_id 로 표시 라벨/에피소드/부서 자동 조회 (활동 기록 메타). */
async function fetchSceneMeta(sceneUuid: string): Promise<{
  sceneLabel: string | null;
  episodeNumber: number | null;
  department: 'bg' | 'acting' | null;
}> {
  try {
    const { data } = await supabaseClient
      .from('scenes')
      .select('scene_number, parts(part_id, department, episodes(episode_number))')
      .eq('id', sceneUuid)
      .single();
    if (!data) return { sceneLabel: null, episodeNumber: null, department: null };
    const part = (data as { parts?: { part_id?: string; department?: string; episodes?: { episode_number?: number } } }).parts;
    const epNum = part?.episodes?.episode_number ?? null;
    const dept = (part?.department === 'bg' || part?.department === 'acting') ? part.department : null;
    const sceneNumber = (data as { scene_number?: string }).scene_number;
    const sceneLabel = epNum && part?.part_id
      ? `EP${String(epNum).padStart(2, '0')} ${part.part_id} #${sceneNumber}`
      : sceneNumber ? `씬 #${sceneNumber}` : null;
    return { sceneLabel, episodeNumber: epNum, department: dept };
  } catch {
    return { sceneLabel: null, episodeNumber: null, department: null };
  }
}

/** 씬 관련 활동 자동 기록 (try/catch 흡수, 본 mutation 흐름 영향 없음) */
async function logSceneActivity(input: {
  sceneUuid: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!currentActivityUser) return;
  try {
    const meta = await fetchSceneMeta(input.sceneUuid);
    await sbRecordActivityLog({
      userId: currentActivityUser.id,
      userName: currentActivityUser.name,
      actionType: input.actionType,
      actionGroup: input.actionGroup,
      sceneId: input.sceneUuid,
      sceneLabel: meta.sceneLabel,
      episodeNumber: meta.episodeNumber,
      department: meta.department,
      detail: input.detail ?? {},
    });
  } catch {
    // 무시
  }
}

// 연결 테스트
ipcMain.handle('supabase:test-connection', wrapIpc(async () => {
  return supabaseTestConnection();
}));

// ─── Episodes ───
ipcMain.handle('supabase:read-all', wrapIpc(async () => {
  return sbReadAllEpisodes();
}));
ipcMain.handle('supabase:add-episode', wrapIpc(async (_e: unknown, episodeNumber: number, department?: string) => {
  await sbAddEpisode(episodeNumber, department);
}));
ipcMain.handle('supabase:soft-delete-episode', wrapIpc(async (_e: unknown, episodeNumber: number) => {
  await sbSoftDeleteEpisode(episodeNumber);
}));
ipcMain.handle('supabase:archive-episode', wrapIpc(async (_e: unknown, episodeNumber: number, archivedBy: string, archiveMemo: string) => {
  await sbArchiveEpisode(episodeNumber, archivedBy, archiveMemo);
}));
ipcMain.handle('supabase:unarchive-episode', wrapIpc(async (_e: unknown, episodeNumber: number) => {
  await sbUnarchiveEpisode(episodeNumber);
}));
ipcMain.handle('supabase:read-archived', wrapIpc(async () => {
  return sbReadArchived();
}));

// ─── Parts ───
ipcMain.handle('supabase:add-part', wrapIpc(async (_e: unknown, episodeNumber: number, partId: string, department?: string) => {
  await sbAddPart(episodeNumber, partId, department);
}));
ipcMain.handle('supabase:soft-delete-part', wrapIpc(async (_e: unknown, sheetName: string) => {
  await sbSoftDeletePart(sheetName);
}));

// ─── Scenes ───
ipcMain.handle('supabase:add-scene', wrapIpc(async (_e: unknown, sheetName: string, sceneId: string, assignee: string, memo: string) => {
  const result = await sbAddScene(sheetName, sceneId, assignee, memo);
  // 활동 기록 — addScene 반환값에 새 UUID 가 있으면 사용. 없으면 sheetName/sceneId 로 라벨만 구성
  if (currentActivityUser) {
    try {
      const sceneLabel = `${sheetName} #${sceneId}`;
      const dept = sheetName.endsWith('_BG') ? 'bg' : sheetName.endsWith('_ACT') ? 'acting' : null;
      await sbRecordActivityLog({
        userId: currentActivityUser.id, userName: currentActivityUser.name,
        actionType: 'scene_add', actionGroup: 'scene',
        sceneId: null, sceneLabel, episodeNumber: null, department: dept,
        detail: { sceneId },
      });
    } catch { /* 무시 */ }
  }
  return result;
}));
ipcMain.handle('supabase:add-scenes', wrapIpc(async (_e: unknown, sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) => {
  await sbAddScenes(sheetName, scenes);
  // 다중 추가는 첫 항목만 대표로 기록 (자잘한 다중 추가 노이즈 방지)
  if (currentActivityUser && scenes.length > 0) {
    try {
      const dept = sheetName.endsWith('_BG') ? 'bg' : sheetName.endsWith('_ACT') ? 'acting' : null;
      const label = scenes.length === 1
        ? `${sheetName} #${scenes[0].sceneId}`
        : `${sheetName} #${scenes[0].sceneId} 외 ${scenes.length - 1}건`;
      await sbRecordActivityLog({
        userId: currentActivityUser.id, userName: currentActivityUser.name,
        actionType: 'scene_add', actionGroup: 'scene',
        sceneId: null, sceneLabel: label, episodeNumber: null, department: dept,
        detail: { count: scenes.length },
      });
    } catch { /* 무시 */ }
  }
}));
ipcMain.handle('supabase:delete-scene', wrapIpc(async (_e: unknown, sceneUuid: string) => {
  // 삭제 전에 메타 조회 (DELETE 후엔 못 가져옴)
  const meta = currentActivityUser ? await fetchSceneMeta(sceneUuid) : null;
  await sbDeleteScene(sceneUuid);
  if (currentActivityUser && meta) {
    try {
      await sbRecordActivityLog({
        userId: currentActivityUser.id, userName: currentActivityUser.name,
        actionType: 'scene_delete', actionGroup: 'scene',
        sceneId: sceneUuid,
        sceneLabel: meta.sceneLabel, episodeNumber: meta.episodeNumber, department: meta.department,
        detail: {},
      });
    } catch { /* 무시 */ }
  }
}));
ipcMain.handle('supabase:update-scene-stage', wrapIpc(async (_e: unknown, sceneUuid: string, stage: string, value: boolean, updatedBy?: string) => {
  await sbUpdateSceneStage(sceneUuid, stage, value, updatedBy);
  if (stage === 'lo' || stage === 'done' || stage === 'review' || stage === 'png') {
    await logSceneActivity({
      sceneUuid,
      actionType: `stage_${stage}` as ActionType,
      actionGroup: 'progress',
      detail: { value },
    });
  }
}));
ipcMain.handle('supabase:bulk-update-scene-stages', wrapIpc(async (_e: unknown, updates: BulkStageUpdate[], updatedBy: string) => {
  const results = await sbBulkUpdateSceneStages(updates, updatedBy, currentActivityUser?.name ?? null);
  for (const u of updates) {
    const r = results.find((x) => x.sceneUuid === u.sceneUuid);
    if (!r?.success) continue;
    // stage boolean broadcast
    broadcastSceneUpdate(u.sceneUuid, u.stage, u.value, updatedBy);
    // 완료 메타(scene-completion metadata) 변경 broadcast — Codex 리뷰 #11.
    // metadata 테이블은 Realtime 구독 대상이 아니므로, 피어 UI가 completedBy/At을
    // 즉시 반영할 수 있도록 scene-field-update 이벤트로 별도 전파한다.
    // undefined = 변경 없음(미전송), null = clear(빈 문자열 전송), string = set.
    if (u.completedBy !== undefined) {
      broadcastSceneFieldUpdate(u.sceneUuid, 'completedBy', u.completedBy ?? '', updatedBy);
    }
    if (u.completedAt !== undefined) {
      broadcastSceneFieldUpdate(u.sceneUuid, 'completedAt', u.completedAt ?? '', updatedBy);
    }
  }
  return results;
}));
ipcMain.handle('supabase:bulk-delete-scenes', wrapIpc(async (_e: unknown, sceneUuids: string[], deletedBy: string) => {
  const results = await sbBulkDeleteScenes(sceneUuids, deletedBy, currentActivityUser?.name ?? null);
  // 단일 deleteScene과 parity 유지를 위해 성공 시 data-change broadcast — Codex 리뷰 #12.
  // Realtime 끊긴 상태의 피어가 broadcast-triggered reload로 동기화할 수 있도록 한다.
  if (results.some((r) => r.success)) {
    broadcastDataChange('scenes', 'DELETE', deletedBy);
  }
  return results;
}));
ipcMain.handle('supabase:bulk-update-scene-fields', wrapIpc(async (_e: unknown, updates: BulkFieldUpdate[], updatedBy: string) => {
  const results = await sbBulkUpdateSceneFields(updates, updatedBy, currentActivityUser?.name ?? null);
  for (const u of updates) {
    const r = results.find((x) => x.sceneUuid === u.sceneUuid);
    if (!r?.success) continue;
    for (const [key, value] of Object.entries(u.fields)) {
      if (value !== undefined) {
        broadcastSceneFieldUpdate(u.sceneUuid, key, value, updatedBy);
      }
    }
  }
  return results;
}));
ipcMain.handle('supabase:update-scene-field', wrapIpc(async (_e: unknown, sceneUuid: string, field: string, value: string, senderId?: string) => {
  await sbUpdateSceneField(sceneUuid, field, value, senderId);
  // 필드별 활동 기록
  let actionType: ActionType | null = null;
  let actionGroup: ActionGroup | null = null;
  if (field === 'memo')                                     { actionType = 'memo_update'; actionGroup = 'memo'; }
  else if (field === 'assignee')                            { actionType = 'assignee_change'; actionGroup = 'etc'; }
  else if (field === 'layout' || field === 'layoutId')      { actionType = 'layout_change'; actionGroup = 'etc'; }
  else if (field === 'storyboardUrl')                       { actionType = 'image_upload_storyboard'; actionGroup = 'etc'; }
  else if (field === 'guideUrl')                            { actionType = 'image_upload_guide'; actionGroup = 'etc'; }
  if (actionType && actionGroup) {
    await logSceneActivity({
      sceneUuid, actionType, actionGroup,
      detail: actionType.startsWith('image_upload') ? {} : { to: value },
    });
  }
}));

// ─── Users ───
ipcMain.handle('supabase:read-users', wrapIpc(async () => {
  return sbReadUsers();
}));
ipcMain.handle('supabase:add-user', wrapIpc(async (_e: unknown, user: SupabaseUser) => {
  await sbAddUser(user);
}));
ipcMain.handle('supabase:update-user', wrapIpc(async (_e: unknown, userId: string, updates: Record<string, string>) => {
  await sbUpdateUser(userId, updates);
}));
ipcMain.handle('supabase:delete-user', wrapIpc(async (_e: unknown, userId: string) => {
  await sbDeleteUser(userId);
}));

// ─── Comments ───
ipcMain.handle('supabase:read-comments', wrapIpc(async (_e: unknown, partUuid: string) => {
  return sbReadComments(partUuid);
}));
// 한솔 결정 (v1.15.5): 로그인 catch-up — last seen 이후 받은 멘션 댓글 일괄 조회
ipcMain.handle('supabase:fetch-missed-mentions', wrapIpc(async (
  _e: unknown,
  userId: string,
  userName: string,
  since: string,
  limit?: number,
) => {
  return sbFetchMissedMentions(userId, userName, since, limit ?? 50);
}));
ipcMain.handle('supabase:add-comment', wrapIpc(async (_e: unknown, commentId: string, partUuid: string, sceneId: string,
  userId: string, userName: string, text: string, mentions: string[], createdAt: string, images: string[] = []) => {
  await sbAddComment(commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images);
  // 활동 기록 — partUuid 로 부서/에피소드 + scene UUID 자동 조회
  // (sceneId 가 TEXT 형식이라 scenes 테이블 조회로 UUID 변환 — 그룹화 정확성 + 부서 필터 통과)
  if (currentActivityUser) {
    try {
      const { data: partRow } = await supabaseClient
        .from('parts')
        .select('part_id, department, episodes(episode_number)')
        .eq('id', partUuid)
        .single();
      const part = partRow as { part_id?: string; department?: string; episodes?: { episode_number?: number } } | null;
      const epNum = part?.episodes?.episode_number ?? null;
      const dept = (part?.department === 'bg' || part?.department === 'acting') ? part.department : null;

      // scene UUID 조회 — comment.scene_id (TEXT scene_number) + partUuid 로 scenes 테이블 매칭
      let sceneUuid: string | null = null;
      const { data: sceneRow } = await supabaseClient
        .from('scenes')
        .select('id')
        .eq('part_id', partUuid)
        .eq('scene_number', sceneId)
        .maybeSingle();
      sceneUuid = (sceneRow as { id?: string } | null)?.id ?? null;

      const sceneLabel = epNum && part?.part_id
        ? `EP${String(epNum).padStart(2, '0')} ${part.part_id} #${sceneId}`
        : `씬 ${sceneId}`;
      await sbRecordActivityLog({
        userId: currentActivityUser.id, userName: currentActivityUser.name,
        actionType: 'comment_add', actionGroup: 'memo',
        sceneId: sceneUuid, sceneLabel,
        episodeNumber: epNum, department: dept,
        detail: { commentId, textPreview: text.slice(0, 60) },
      });
    } catch { /* 무시 */ }
  }
}));
ipcMain.handle('supabase:edit-comment', wrapIpc(async (_e: unknown, commentId: string, text: string, mentions: string[], images: string[] = []) => {
  await sbEditComment(commentId, text, mentions, images);
}));
ipcMain.handle('supabase:delete-comment', wrapIpc(async (_e: unknown, commentId: string) => {
  await sbDeleteComment(commentId);
}));

// ─── Supabase: 비공개 캘린더 이벤트 ───
// 권한: 렌더러가 보낸 userId/input.user_id 를 그대로 믿지 않고, 메인 세션에 저장된
// 현재 로그인 사용자 ID 로 강제(또는 검증) 한다. 악성/오작동 렌더러가 다른 사용자의
// 비공개 일정을 읽거나 수정하는 경로 차단.
function getSessionUserIdOrThrow(): string {
  const s = lastKnownSession as { user?: { id?: string } } | null;
  const id = s?.user?.id;
  if (!id) throw new Error('세션에 로그인 사용자 정보가 없습니다 (비공개 일정)');
  return id;
}

async function assertPrivateEventOwnerOrThrow(id: string): Promise<void> {
  const ownerId = await sbGetPrivateEventOwner(id);
  if (!ownerId) throw new Error('해당 비공개 일정을 찾을 수 없습니다');
  const sessionUserId = getSessionUserIdOrThrow();
  if (ownerId !== sessionUserId) throw new Error('이 비공개 일정에 대한 권한이 없습니다');
}

ipcMain.handle('supabase:read-private-events', wrapIpc(async () => {
  // 렌더러가 넘긴 userId 는 무시 — 세션 사용자 본인 것만 조회.
  const userId = getSessionUserIdOrThrow();
  return sbReadPrivateEvents(userId);
}));

ipcMain.handle('supabase:add-private-event', wrapIpc(async (_e: unknown, input: Parameters<typeof sbAddPrivateEvent>[0]) => {
  // 렌더러가 넘긴 user_id 는 무시하고 세션 본인 id 로 강제.
  const userId = getSessionUserIdOrThrow();
  return sbAddPrivateEvent({ ...input, user_id: userId });
}));

ipcMain.handle('supabase:update-private-event', wrapIpc(async (_e: unknown, id: string, updates: Parameters<typeof sbUpdatePrivateEvent>[1]) => {
  await assertPrivateEventOwnerOrThrow(id);
  await sbUpdatePrivateEvent(id, updates);
}));

ipcMain.handle('supabase:delete-private-event', wrapIpc(async (_e: unknown, id: string) => {
  await assertPrivateEventOwnerOrThrow(id);
  await sbDeletePrivateEvent(id);
}));

// ─── Revisions ───
ipcMain.handle('supabase:read-revisions', wrapIpc(async () => {
  return sbReadRevisions();
}));
ipcMain.handle('supabase:add-revision', wrapIpc(async (_e: unknown, id: string, partUuid: string, sceneId: string,
    revisionNo: number, status: string, priority: string, description: string, frameNo: string,
    imageUrl: string, department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string) => {
    await sbAddRevision(id, partUuid, sceneId, revisionNo, status, priority, description, frameNo, imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt);
    if (currentActivityUser) {
      try {
        // sceneId 가 sceneKey 형식 (예: 'EP02:A:35') 일 수 있으므로 파싱 + raw- prefix 디코드 (Codex P2)
        const sceneNumber = parseRevisionSceneKey(sceneId);

        // 저장된 row 에서 정확한 part_id (UUID) 조회 — partUuid 가 빈 문자열일 수 있어 직접 사용 못 함
        const { data: revRow } = await supabaseClient
          .from('comp_revisions')
          .select('part_id, parts(part_id, episodes(episode_number))')
          .eq('id', id)
          .single();
        const rev = revRow as {
          part_id?: string;
          parts?: { part_id?: string; episodes?: { episode_number?: number } };
        } | null;
        const resolvedPartUuid = rev?.part_id ?? null;
        const epNum = rev?.parts?.episodes?.episode_number ?? null;
        const partLabel = rev?.parts?.part_id ?? null;

        let sceneUuid: string | null = null;
        if (resolvedPartUuid) {
          const { data: sceneRow } = await supabaseClient
            .from('scenes')
            .select('id')
            .eq('part_id', resolvedPartUuid)
            .eq('scene_number', sceneNumber)
            .maybeSingle();
          sceneUuid = (sceneRow as { id?: string } | null)?.id ?? null;
        }

        const dept = department === 'bg' || department === 'acting' ? department : null;
        const sceneLabel = epNum && partLabel
          ? `EP${String(epNum).padStart(2, '0')} ${partLabel} #${sceneNumber} 리비전 #${revisionNo}`
          : `씬 ${sceneNumber} 리비전 #${revisionNo}`;
        await sbRecordActivityLog({
          userId: currentActivityUser.id, userName: currentActivityUser.name,
          actionType: 'revision_add', actionGroup: 'memo',
          sceneId: sceneUuid, sceneLabel,
          episodeNumber: epNum, department: dept,
          detail: { revisionId: id, descriptionPreview: description.slice(0, 60) },
        });
      } catch { /* 무시 */ }
    }
  }));
ipcMain.handle('supabase:update-revision', wrapIpc(async (_e: unknown, id: string, updates: Record<string, string>) => {
  await sbUpdateRevision(id, updates);
  // status === 'resolved' 변경만 활동 기록 — comp_revisions 에서 부서/에피소드 자동 조회 (Codex P2)
  if (currentActivityUser && updates.status === 'resolved') {
    try {
      const { data: revRow } = await supabaseClient
        .from('comp_revisions')
        .select('scene_id, revision_no, department, part_id, parts(part_id, episodes(episode_number))')
        .eq('id', id)
        .single();
      const rev = revRow as {
        scene_id?: string;
        revision_no?: number;
        department?: string;
        part_id?: string;        // comp_revisions.part_id (UUID)
        parts?: { part_id?: string; episodes?: { episode_number?: number } };  // parts.part_id (TEXT 라벨)
      } | null;
      const dept = (rev?.department === 'bg' || rev?.department === 'acting') ? rev.department : null;
      const epNum = rev?.parts?.episodes?.episode_number ?? null;

      // scene UUID 조회 — rev.scene_id 는 sceneKey 형식 (예: 'EP02:A:35') 이므로 파싱 + raw- 디코드 (Codex P2)
      let sceneUuid: string | null = null;
      const sceneNumber = rev?.scene_id ? parseRevisionSceneKey(rev.scene_id) : null;
      if (rev?.part_id && sceneNumber) {
        const { data: sceneRow } = await supabaseClient
          .from('scenes')
          .select('id')
          .eq('part_id', rev.part_id)
          .eq('scene_number', sceneNumber)
          .maybeSingle();
        sceneUuid = (sceneRow as { id?: string } | null)?.id ?? null;
      }

      const sceneLabel = epNum && rev?.parts?.part_id && sceneNumber
        ? `EP${String(epNum).padStart(2, '0')} ${rev.parts.part_id} #${sceneNumber} 리비전 #${rev.revision_no ?? '?'}`
        : `리비전 #${rev?.revision_no ?? '?'} 해결`;
      await sbRecordActivityLog({
        userId: currentActivityUser.id, userName: currentActivityUser.name,
        actionType: 'revision_resolve', actionGroup: 'memo',
        sceneId: sceneUuid, sceneLabel,
        episodeNumber: epNum, department: dept,
        detail: { revisionId: id },
      });
    } catch { /* 무시 */ }
  }
}));
// Codex 리뷰 #8 P1: 리비전 삭제는 renderer-provided userId 를 신뢰하면 안 됨.
// 신뢰된 출처(메모리 session + auth.json 파일)에서 직접 해석.
function resolveTrustedCurrentUserId(): string | null {
  const memId = (lastKnownSession as { user?: { id?: string } } | null)?.user?.id ?? null;
  let fileId: string | null = null;
  try {
    const authPath = path.join(getDataPath(), 'auth.json');
    if (fs.existsSync(authPath)) {
      const raw = fs.readFileSync(authPath, { encoding: 'utf-8' });
      const session = JSON.parse(raw) as { userId?: string } | null;
      fileId = session?.userId ?? null;
    }
  } catch { /* ignore */ }
  // 둘 다 있으면 반드시 일치해야 신뢰 (세션 위변조 방어)
  if (memId && fileId) return memId === fileId ? memId : null;
  return memId ?? fileId;
}

ipcMain.handle('supabase:delete-revision', wrapIpc(async (_e: unknown, id: string) => {
  const userId = resolveTrustedCurrentUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');
  await sbDeleteRevision(id, userId);
}));

// ─── Metadata ───
ipcMain.handle('supabase:read-all-metadata', wrapIpc(async () => {
  return sbReadAllMetadata();
}));
ipcMain.handle('supabase:read-metadata', wrapIpc(async (_e: unknown, type: string, key: string) => {
  return sbReadMetadata(type, key);
}));
ipcMain.handle('supabase:write-metadata', wrapIpc(async (_e: unknown, type: string, key: string, value: string) => {
  await sbWriteMetadata(type, key, value);
}));

// ─── Activity (클라이언트 IPC 트래픽 메모리 집계) ───
// 이 핸들러는 자기 자신 호출을 기록하지 않도록 위쪽 래퍼에서 제외되어 있다.
ipcMain.handle('supabase:get-activity', async (
  _e: unknown,
  opts: { table?: string; action?: 'read' | 'write'; rangeMs: number; buckets: number },
) => {
  return getActivity(opts);
});

// Realtime 현재 상태 getter — Codex 리뷰 #7 P2: 늦게 마운트된 렌더러가
// 과거 onStatusChange 이벤트를 놓치지 않도록 최신 상태를 조회.
ipcMain.handle('supabase:get-realtime-status', () => currentRealtimeStatus);

// ─── Personal Todos IPC ──────────────────────────────

ipcMain.handle('supabase:read-todos', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadTodos(userId);
}));

ipcMain.handle('supabase:upsert-todo', wrapIpc(async (_e: unknown, userId: string, todo: unknown) => {
  return sbUpsertTodo(userId, todo as Parameters<typeof sbUpsertTodo>[1]);
}));

ipcMain.handle('supabase:delete-todo', wrapIpc(async (_e: unknown, todoId: string) => {
  return sbDeleteTodo(todoId);
}));

ipcMain.handle('supabase:read-task-views', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadTaskViews(userId);
}));

ipcMain.handle('supabase:upsert-task-views', wrapIpc(async (_e: unknown, userId: string, views: unknown[], sceneKeys: unknown[]) => {
  return sbUpsertTaskViews(userId, views, sceneKeys);
}));

// ─── Memos IPC ──────────────────────────────

ipcMain.handle('supabase:read-memo', wrapIpc(async (_e: unknown, userId: string, widgetId: string) => {
  return sbReadMemo(userId, widgetId);
}));

ipcMain.handle('supabase:upsert-memo', wrapIpc(async (_e: unknown, userId: string, widgetId: string, memoData: unknown) => {
  return sbUpsertMemo(userId, widgetId, memoData as Parameters<typeof sbUpsertMemo>[2]);
}));

ipcMain.handle('supabase:read-all-memos', wrapIpc(async (_e: unknown, userId: string) => {
  return sbReadAllMemos(userId);
}));

// ─── 활동 기록 (activity_log) ──────────────────────────────
// 주의: recordActivity 는 IPC 노출 안 함. 활동 기록은 mutation 함수 내부 헬퍼로만 호출.
ipcMain.handle('activity:list', wrapIpc(async (_e: unknown, opts: {
  before?: string;
  limit?: number;
  groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  department?: 'bg' | 'acting' | null;
}) => {
  return sbListActivities(opts ?? {});
}));

ipcMain.handle('activity:stats', wrapIpc(async (_e: unknown, opts: {
  days?: number;
  groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  department?: 'bg' | 'acting' | null;
}) => {
  return sbGetActivityStats(opts ?? {});
}));

ipcMain.handle('activity:backfill', wrapIpc(async (_e: unknown, since: string) => {
  return sbBackfillActivities(since);
}));

ipcMain.handle('activity:storage-info', wrapIpc(async () => {
  return sbGetActivityStorageInfo();
}));

// ─── Google Calendar IPC ──────────────────────────────

ipcMain.handle('gcal:is-authenticated', wrapIpc(async () => {
  return gcal.isAuthenticated();
}));

ipcMain.handle('gcal:start-auth', wrapIpc(async () => {
  await gcal.startAuth();
}));

ipcMain.handle('gcal:save-credentials', wrapIpc(async (_e: unknown, clientId: string, clientSecret: string) => {
  gcal.saveCredentials(clientId, clientSecret);
}));

ipcMain.handle('gcal:has-credentials', wrapIpc(async () => {
  return gcal.hasCredentialsSet();
}));

ipcMain.handle('gcal:sign-out', wrapIpc(async () => {
  await gcal.signOut();
}));

ipcMain.handle('gcal:list-calendars', wrapIpc(async () => {
  return gcal.listCalendars();
}));

ipcMain.handle('gcal:full-sync', wrapIpc(async (_e: unknown, calendarId: string) => {
  return gcal.fullSync(calendarId);
}));

ipcMain.handle('gcal:incremental-sync', wrapIpc(async (_e: unknown, calendarId: string) => {
  return gcal.incrementalSync(calendarId);
}));

ipcMain.handle('gcal:insert-event', wrapIpc(async (_e: unknown, calendarId: string, input: unknown) => {
  return gcal.insertEvent(calendarId, input as gcal.GCalEventInput);
}));

ipcMain.handle('gcal:update-event', wrapIpc(async (_e: unknown, calendarId: string, eventId: string, input: unknown) => {
  return gcal.updateEvent(calendarId, eventId, input as Partial<gcal.GCalEventInput>);
}));

ipcMain.handle('gcal:delete-event', wrapIpc(async (_e: unknown, calendarId: string, eventId: string) => {
  return gcal.deleteEvent(calendarId, eventId);
}));

ipcMain.handle('gcal:ensure-watch', wrapIpc(async (_e: unknown, calendarId: string, userId: string) => {
  return gcal.ensureWatch(calendarId, userId);
}));

// ─── Slack Webhook ───
const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/triggers/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';

ipcMain.handle('slack:send-webhook', wrapIpc(async (_e: unknown, payload: Record<string, string>) => {
  console.log('[Slack Webhook] 요청 페이로드:', JSON.stringify(payload));
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log('[Slack Webhook] 응답:', res.status, body);
  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status} — ${body}`);
  return { ok: true };
}));

// ─── Realtime 구독 (앱 시작 시 자동 설정) ───
function startSupabaseRealtime() {
  // 1) postgres_changes 기반 (기존)
  setupRealtimeSubscription({
    onSceneChange: (payload) => broadcastSupabaseEvent('scenes', payload),
    onCommentChange: (payload) => broadcastSupabaseEvent('comments', payload),
    onRevisionChange: (payload) => broadcastSupabaseEvent('comp_revisions', payload),
    onEpisodeChange: (payload) => broadcastSupabaseEvent('episodes', payload),
    onPartChange: (payload) => broadcastSupabaseEvent('parts', payload),
    onActivityInsert: (payload) => {
      // 활동 기록은 INSERT 만 추적, 모든 윈도우에 전파
      const row = payload.new;
      if (!row) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('activity:realtime-insert', row);
      }
      for (const win of widgetWindows.values()) {
        if (!win.isDestroyed()) win.webContents.send('activity:realtime-insert', row);
      }
    },
    onStatusChange: (status) => {
      currentRealtimeStatus = status;
      lastSupabaseStatus = humanizeStatus(status);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('supabase:status', status);
      }
      for (const win of widgetWindows.values()) {
        if (!win.isDestroyed()) win.webContents.send('supabase:status', status);
      }
      rebuildTrayMenu();
    },
  });

  // 2) Broadcast 기반 즉시 동기화 (Publication 설정 불필요)
  setupBroadcast((event, payload) => {
    const broadcastEvent = { event, payload };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('supabase:broadcast-event', broadcastEvent);
    }
    for (const win of widgetWindows.values()) {
      if (!win.isDestroyed()) win.webContents.send('supabase:broadcast-event', broadcastEvent);
    }
  });
}

function broadcastSupabaseEvent(table: string, payload: unknown) {
  const event = { table, payload };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('supabase:realtime-event', event);
  }
  for (const win of widgetWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send('supabase:realtime-event', event);
  }
}

// ─── IPC 핸들러: Google Sheets 연동 (Apps Script 웹 앱) ─────

ipcMain.handle('sheets:connect', async (_event, webAppUrl: string) => {
  try {
    const ok = await initSheets(webAppUrl);
    if (ok) setImageUploadUrl(webAppUrl); // 이미지 업로드용 URL도 동일하게 설정
    return { ok, error: ok ? null : '연결 실패 — URL을 확인해주세요' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:is-connected', () => {
  return isConnected();
});

ipcMain.handle(
  'sheets:upload-image',
  async (_event, sheetName: string, sceneId: string, imageType: string, base64Data: string) => {
    try {
      const result = await driveUploadImage(sheetName, sceneId, imageType, base64Data);

      // Drive 업로드 성공 시 manifest 갱신 (파일명 키는 GAS 네이밍 규칙과 일치)
      const typeSuffix = imageType === 'storyboard' ? 'sb' : 'guide';
      const mimeMatch = base64Data.match(/^data:(image\/(\w+));base64,/);
      const ext = mimeMatch?.[2] === 'png' ? '.png' : '.jpg';
      const manifestKey = `${sheetName}_${sceneId}_${typeSuffix}${ext}`;
      const manifest = loadImageManifest();
      manifest[manifestKey] = {
        ...(manifest[manifestKey] ?? { size: 0 }),
        driveUrl: result.url,
        uploadedAt: new Date().toISOString(),
      };
      saveImageManifest(manifest);

      return { ok: true, url: result.url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
);

// ─── Supabase Storage IPC ──────────────────────────────

ipcMain.handle(
  'storage:upload-image',
  async (_event, sheetName: string, sceneId: string, imageType: 'storyboard' | 'guide', base64Data: string) => {
    return storageUploadImage(sheetName, sceneId, imageType, base64Data);
  },
);

ipcMain.handle(
  'storage:delete-image',
  async (_event, url: string) => {
    await storageDeleteImage(url);
  },
);

// ─── IPC 핸들러: 네이티브 알림 ─────────────────────────────
ipcMain.handle('notification:show-native', (_e: unknown, title: string, body: string) => {
  // 앱 포커스 상태면 스킵 (인앱 토스트만 표시)
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
    return;
  }
  if (Notification.isSupported()) {
    const noti = new Notification({ title, body });
    noti.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    noti.show();
  }
});

// ─── IPC 핸들러: METADATA ───────────────────────────────────

ipcMain.handle('sheets:read-all-metadata', async () => {
  try {
    const data = await readAllMetadata();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: [], error: msg };
  }
});

// ─── IPC 핸들러: _COMMENTS fallback (Supabase 장애 시) ──────

ipcMain.handle('sheets:read-comments', async (_event, sheetName: string) => {
  try {
    const data = await readCommentsForPart(sheetName);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

// ─── IPC 핸들러: _COMP_REVISIONS fallback (Supabase 장애 시) ──

ipcMain.handle('sheets:read-revisions', async () => {
  try {
    const data = await readRevisionsFromSheets();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

// ─── IPC 핸들러: 데이터 변경 브로드캐스트 (라이브 모드) ──────

// 호환성: 기존 채널도 유지
ipcMain.handle('sheets:notify-change', (event, delta?: unknown) => {
  broadcastDataChanged(event.sender.id, delta);
  return { ok: true };
});
ipcMain.handle('data:notify-change', (event, delta?: unknown) => {
  broadcastDataChanged(event.sender.id, delta);
  return { ok: true };
});

// 스냅샷 릴레이: 구조적 변경 후 최신 데이터를 다른 창에 직접 전달
ipcMain.handle('sheets:relay-snapshot', (event, data: unknown) => {
  broadcastSnapshotRelay(event.sender.id, data);
  return { ok: true };
});

// 렌더러 → 메인: "지금 설정 바꿨으니 다른 창에도 알려줘"
ipcMain.handle('preferences:broadcast-change', (_event, payload: unknown) => {
  broadcastToAllWindows('preferences:changed', payload);
  return { ok: true };
});

ipcMain.handle('session:broadcast-change', (_event, payload: unknown) => {
  lastKnownSession = payload;
  broadcastToAllWindows('session:changed', payload);
  return { ok: true };
});

// 팝업이 onSessionChanged 구독 등록 후 명시적으로 재전송을 요청 — ready-to-show 타이밍 miss 방어.
// event.sender.send로 요청한 창에만 전송 (broadcast 아님). lastKnownSession이 null이면 무응답.
ipcMain.handle('session:request-current', (event) => {
  if (lastKnownSession !== null) {
    event.sender.send('session:changed', lastKnownSession);
  }
  return { ok: true };
});

ipcMain.handle('theme:broadcast-change', (_event, payload: unknown) => {
  broadcastToAllWindows('theme:changed', payload);
  return { ok: true };
});

// 캘린더 변경 브로드캐스트 — 송신자 제외(자기 프로세스 window event 중복 방지)
ipcMain.handle('calendar:broadcast-change', (event, payload: unknown) => {
  broadcastToAllWindows('calendar:changed', payload, event.sender.id);
  return { ok: true };
});

// ─── IPC 핸들러: 휴가 pending 상태 파일 I/O + 브로드캐스트 ─────

const PENDING_VACATIONS_FILE = 'pendingVacations.json';
let pendingSaveChain: Promise<{ ok: boolean }> = Promise.resolve({ ok: true });

function getPendingVacationsPath(): string {
  return path.join(app.getPath('userData'), PENDING_VACATIONS_FILE);
}

ipcMain.handle('vacation:pending:load', () => {
  try {
    const file = getPendingVacationsPath();
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // 파일이 유효 JSON이지만 배열이 아닌 경우(파손 후 수동 편집 등) downstream crash 방어
    if (!Array.isArray(parsed)) {
      console.warn('[vacation] pending 파일이 배열 형태가 아님 — 빈 배열로 fallback');
      return [];
    }
    return parsed;
  } catch (err) {
    console.warn('[vacation] pending 로드 실패:', err);
    return [];
  }
});

ipcMain.handle('vacation:pending:save', (_e, list: unknown) => {
  // 저장은 체인으로 직렬화 — 동시 호출 경합 방지
  pendingSaveChain = pendingSaveChain.then(async () => {
    try {
      const file = getPendingVacationsPath();
      await fs.promises.writeFile(file, JSON.stringify(list ?? []), 'utf-8');
      return { ok: true };
    } catch (err) {
      console.error('[vacation] pending 저장 실패:', err);
      return { ok: false };
    }
  });
  return pendingSaveChain;
});

// 송신자 제외(excludeSenderId): 현재 창은 VacationRegisterModal에서 로컬 setToast로
// 즉시 피드백하므로, 자기 자신이 broadcast를 받아 Sonner 토스트를 중복 표시하는 것을 방지.
// dev/test 모드에서도 로컬 setToast가 동작하여 사용자 피드백 보장.
ipcMain.handle('vacation:broadcast-registered', (event, payload: unknown) => {
  broadcastToAllWindows('vacation:registered', payload, event.sender.id);
  return { ok: true };
});

ipcMain.handle('vacation:broadcast-failed', (event, payload: unknown) => {
  broadcastToAllWindows('vacation:failed', payload, event.sender.id);
  return { ok: true };
});

// pending 상태 변경(add/remove/clearStale) 브로드캐스트 — 다른 창이 hydrate하여 노란색 동기화
// 송신자 제외(excludeSenderId): 자기 상태를 덮어쓰지 않도록 (이미 set으로 최신)
ipcMain.handle('vacation:broadcast-pending-changed', (event, payload: unknown) => {
  broadcastToAllWindows('vacation:pending-changed', payload, event.sender.id);
  return { ok: true };
});

// ─── IPC 핸들러: 휴가 관리 (vacation-repo WebApi) ────────────

ipcMain.handle('vacation:connect', async (_event, webAppUrl: string) => {
  try {
    const ok = await initVacation(webAppUrl);
    return { ok, error: ok ? null : '연결 실패 — URL을 확인해주세요' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('vacation:is-connected', () => {
  return isVacationConnected();
});

ipcMain.handle('vacation:read-status', async (_event, name: string) => {
  try {
    const data = await readVacationStatus(name);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('vacation:read-log', async (_event, name: string, year?: number, limit?: number) => {
  try {
    const data = await readVacationLog(name, year, limit);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('vacation:read-all-events', async (_event, year?: number) => {
  try {
    const data = await readAllVacationEvents(year);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('vacation:register', async (
  _event, name: string, type: string, startDate: string, endDate: string, reason: string
) => {
  try {
    const result = await registerVacation({ name, type, startDate, endDate, reason });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, success: false, state: '', error: msg };
  }
});

ipcMain.handle('vacation:cancel', async (_event, name: string, rowIndex: number) => {
  try {
    const result = await cancelVacation(name, rowIndex);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, success: false, state: '', error: msg };
  }
});

ipcMain.handle('vacation:grant-dahyu', async (_event, targets: string[], reason: string, grantDate: string) => {
  try {
    const result = await grantDahyu({ targets, reason, grantDate });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, success: false, granted: [], failed: targets, state: msg };
  }
});

ipcMain.handle('vacation:read-all-names', async () => {
  try {
    const names = await readAllEmployeeNames();
    return { ok: true, data: names };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: [], error: msg };
  }
});

ipcMain.handle('vacation:read-dahyu-list', async () => {
  try {
    const list = await readDahyuList();
    return { ok: true, data: list };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: [], error: msg };
  }
});

ipcMain.handle('vacation:delete-dahyu', async (_event, rowIndices: number[]) => {
  try {
    const result = await deleteDahyu(rowIndices);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, success: false, deleted: [], failed: rowIndices, state: msg };
  }
});

// ─── 이미지 캐시 manifest ────────────────────────────

const IMAGES_DIR = path.join(getDataPath(), 'images');

interface ImageManifest {
  [filename: string]: {
    driveUrl?: string;
    uploadedAt?: string;
    size: number;
  };
}

function loadImageManifest(): ImageManifest {
  try {
    const manifestPath = path.join(IMAGES_DIR, 'manifest.json');
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveImageManifest(manifest: ImageManifest): void {
  ensureDir(IMAGES_DIR);
  const manifestPath = path.join(IMAGES_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/** 앱 시작 시 캐시 크기 확인 + Drive 백업된 오래된 파일 자동 정리 */
function cleanupImageCache(maxSizeMB: number = 500): void {
  if (!fs.existsSync(IMAGES_DIR)) return;

  const manifest = loadImageManifest();

  const files = fs.readdirSync(IMAGES_DIR)
    .filter((f) => f !== 'manifest.json')
    .map((f) => {
      const filePath = path.join(IMAGES_DIR, f);
      try {
        const stat = fs.statSync(filePath);
        return { name: f, path: filePath, stat };
      } catch {
        return null;
      }
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs); // 오래된 것 먼저

  let totalSize = files.reduce((sum, f) => sum + f.stat.size, 0);
  const maxSize = maxSizeMB * 1024 * 1024;

  if (totalSize <= maxSize) return;

  console.log(`[ImageCache] 캐시 크기 ${(totalSize / 1024 / 1024).toFixed(1)}MB > ${maxSizeMB}MB, 정리 시작`);

  for (const file of files) {
    if (totalSize <= maxSize) break;

    const meta = manifest[file.name];
    if (meta?.driveUrl) {
      // Drive에 원본이 있으면 삭제 가능
      fs.unlinkSync(file.path);
      delete manifest[file.name];
      totalSize -= file.stat.size;
      console.log(`[ImageCache] 삭제: ${file.name} (Drive 백업 있음)`);
    }
  }

  saveImageManifest(manifest);
  console.log(`[ImageCache] 정리 완료, 현재 크기: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
}

// ─── IPC 핸들러: 이미지 파일 저장 ────────────────────────────

ipcMain.handle(
  'image:save',
  async (_event, fileName: string, base64Data: string) => {
    const imagesDir = path.join(getDataPath(), 'images');
    ensureDir(imagesDir);

    // "data:image/jpeg;base64,/9j/..." → raw base64 추출
    const match = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
    if (!match) throw new Error('Invalid base64 image data');

    const buffer = Buffer.from(match[1], 'base64');
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, buffer);

    // manifest에 기록
    const manifest = loadImageManifest();
    manifest[fileName] = {
      size: buffer.length,
    };
    saveImageManifest(manifest);

    return `bflow-img://local/${encodeURIComponent(fileName)}`;
  }
);

ipcMain.handle('image:delete', async (_event, fileName: string) => {
  const filePath = path.join(getDataPath(), 'images', fileName);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('image:get-dir', () => {
  return path.join(getDataPath(), 'images');
});

// ─── IPC 핸들러: 클립보드 이미지 읽기 ────────────────────────

ipcMain.handle('clipboard:read-image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  // 메인 프로세스에서 리사이즈 완료 → 렌더러에서 재인코딩 불필요
  const size = image.getSize();
  const maxSize = 800;
  let target = image;
  if (size.width > maxSize || size.height > maxSize) {
    const ratio = Math.min(maxSize / size.width, maxSize / size.height);
    target = image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) });
  }
  const buffer = target.toJPEG(80);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
});

// ─── IPC 핸들러: 위젯 팝업 윈도우 ──────────────────────────────

function openWidgetPopup(widgetId: string, widgetTitle: string, extra?: Record<string, string>): { ok: boolean } {
  // 이미 열린 팝업이면 포커스
  const existing = widgetWindows.get(widgetId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }

  // 저장된 위치/크기 복원 (Phase 0-6)
  const savedPos = widgetPositionCache.get(widgetId);
  const initWidth = savedPos ? Math.max(280, savedPos.width) : 420;
  const initHeight = savedPos ? Math.max(200, savedPos.height) : 360;
  const initAOT = savedPos ? savedPos.alwaysOnTop : true;

  // 호출 시점 extra가 우선. 없으면 이전에 저장된 extra 복원.
  // (EP 위젯 `?ep=1` 등의 query string 파라미터 영속화 — 이슈 ⑨)
  const effectiveExtra = extra ?? savedPos?.extra;

  const popupWin = new BrowserWindow({
    width: initWidth,
    height: initHeight,
    minWidth: 280,
    minHeight: 200,
    frame: false,
    transparent: false,
    alwaysOnTop: initAOT,
    resizable: true,
    skipTaskbar: false,
    title: widgetTitle,
    backgroundColor: '#00000000',
    hasShadow: true,
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 저장된 위치 적용 + 스크린 범위 검증
  if (savedPos) {
    const display = screen.getDisplayNearestPoint({ x: savedPos.x, y: savedPos.y });
    const wa = display.workArea;
    const cx = Math.max(wa.x, Math.min(wa.x + wa.width - initWidth, savedPos.x));
    const cy = Math.max(wa.y, Math.min(wa.y + wa.height - initHeight, savedPos.y));
    popupWin.setBounds({ x: cx, y: cy, width: initWidth, height: initHeight });
  }

  // 저장된 opacity 적용
  if (savedPos && savedPos.opacity !== undefined) {
    popupWin.setOpacity(Math.max(0.15, Math.min(1, savedPos.opacity)));
  }

  // 같은 앱을 로드하되, 해시로 팝업 모드 + 위젯 ID 전달
  let hash = `#widget-popup/${encodeURIComponent(widgetId)}`;
  if (effectiveExtra && Object.keys(effectiveExtra).length > 0) {
    const qs = new URLSearchParams(effectiveExtra).toString();
    hash += `?${qs}`;
  }
  if (process.env.VITE_DEV_SERVER_URL) {
    popupWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}${hash}`);
  } else {
    popupWin.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
  }

  // Acrylic DWM 버그 우회: 생성자의 alwaysOnTop:true는 기본 레벨이라 Acrylic에서 무효.
  // 윈도우 준비 후 'normal' 레벨로 명시적 재설정 (Acrylic에서 'normal'이 실제 topmost)
  popupWin.once('ready-to-show', () => {
    if (popupWin.isDestroyed()) return;
    if (initAOT) {
      popupWin.setAlwaysOnTop(true, 'normal');
    }
    // 마지막으로 알려진 세션을 즉시 전달 → 위젯 초기 "사용자 정보 로딩 중..." 상태 해결
    if (lastKnownSession) {
      popupWin.webContents.send('session:changed', lastKnownSession);
    }
  });

  widgetWindows.set(widgetId, popupWin);
  rebuildTrayMenu(); // 트레이 체크박스 갱신

  // 캐시에 title + 열림 플래그 저장 (자동 재오픈은 isOpen=true 일 때만 수행)
  const existingCache = widgetPositionCache.get(widgetId);
  if (existingCache) {
    existingCache.title = widgetTitle;
    existingCache.isOpen = true;
    // 명시적 extra가 새로 들어온 경우만 덮어씀 (복원 경로에서는 savedPos?.extra를 유지)
    if (extra) existingCache.extra = extra;
  } else {
    const b = popupWin.getBounds();
    widgetPositionCache.set(widgetId, {
      x: b.x, y: b.y, width: b.width, height: b.height,
      opacity: 1.0, alwaysOnTop: initAOT, title: widgetTitle,
      extra: effectiveExtra,
      isOpen: true,
    });
  }
  saveWidgetPositionsDebounced();

  popupWin.on('closed', () => {
    widgetWindows.delete(widgetId);
    widgetOriginalBounds.delete(widgetId);
    rebuildTrayMenu(); // 트레이 체크박스 갱신
    // 위치/크기 캐시는 유지하되 isOpen=false 로 마킹 → 다음 실행 시 자동 복원에서 제외.
    // (사용자가 다시 열면 이전 위치에 그대로 복원됨)
    // 단, 앱 종료(isQuitting) 중 발생한 closed 이벤트는 "사용자가 명시적으로 닫은" 것이 아니라
    // 종료 절차에 의한 자동 파괴이므로 isOpen 을 건드리지 않는다 — 열려있던 위젯들이 다음 실행
    // 시 그대로 복원되도록.
    if (!isQuitting) {
      const cached = widgetPositionCache.get(widgetId);
      if (cached) {
        cached.isOpen = false;
        saveWidgetPositionsDebounced();
      }
    }
    // 독 스택에서 제거 + 나머지 재배치
    const dockIdx = dockedWidgetIds.indexOf(widgetId);
    if (dockIdx >= 0) {
      dockedWidgetIds.splice(dockIdx, 1);
      if (expandedDockWidgetId === widgetId) expandedDockWidgetId = null;
      repositionAllDocked();
    }
  });

  // 포커스 변경 시 렌더러에 알림
  popupWin.on('blur', () => {
    if (!popupWin.isDestroyed()) {
      popupWin.webContents.send('widget:focus-change', false);
    }
  });
  popupWin.on('focus', () => {
    if (!popupWin.isDestroyed()) {
      popupWin.webContents.send('widget:focus-change', true);
    }
  });

  // 화면 모서리 자석 스냅
  let snapFlag = false;
  popupWin.on('moved', () => {
    if (popupWin.isDestroyed() || snapFlag) return;
    if (animatingWidgets.has(widgetId)) return;
    // 독 모드에서는 스냅 안 함
    if (widgetOriginalBounds.has(widgetId)) return;

    const bounds = popupWin.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const wa = display.workArea;
    const threshold = 15;

    let newX = bounds.x;
    let newY = bounds.y;
    let snapped = false;

    if (Math.abs(bounds.x - wa.x) < threshold) { newX = wa.x; snapped = true; }
    if (Math.abs((bounds.x + bounds.width) - (wa.x + wa.width)) < threshold) { newX = wa.x + wa.width - bounds.width; snapped = true; }
    if (Math.abs(bounds.y - wa.y) < threshold) { newY = wa.y; snapped = true; }
    if (Math.abs((bounds.y + bounds.height) - (wa.y + wa.height)) < threshold) { newY = wa.y + wa.height - bounds.height; snapped = true; }

    if (snapped && (newX !== bounds.x || newY !== bounds.y)) {
      snapFlag = true;
      popupWin.setBounds({ x: newX, y: newY, width: bounds.width, height: bounds.height });
      setTimeout(() => { snapFlag = false; }, 50);
    }
  });

  // 위치/크기 변경 시 캐시 업데이트 (Phase 0-6)
  const updatePositionCache = () => {
    if (popupWin.isDestroyed() || animatingWidgets.has(widgetId)) return;
    if (dockedWidgetIds.includes(widgetId)) return; // 독 상태면 저장 안 함
    const b = popupWin.getBounds();
    const prev = widgetPositionCache.get(widgetId);
    widgetPositionCache.set(widgetId, {
      x: b.x, y: b.y, width: b.width, height: b.height,
      opacity: prev?.opacity ?? 0.92,
      alwaysOnTop: prev?.alwaysOnTop ?? true,
      title: prev?.title ?? widgetTitle,
      extra: prev?.extra ?? effectiveExtra,
    });
    saveWidgetPositionsDebounced();
  };
  popupWin.on('move', updatePositionCache);
  popupWin.on('resize', updatePositionCache);

  return { ok: true };
}

ipcMain.handle('widget:open-popup', (_event, widgetId: string, widgetTitle: string, extra?: Record<string, string>) => {
  return openWidgetPopup(widgetId, widgetTitle, extra);
});

ipcMain.handle('widget:set-opacity', (_event, widgetId: string, opacity: number) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    const clamped = Math.max(0.15, Math.min(1, opacity));
    win.setOpacity(clamped);
    let cached = widgetPositionCache.get(widgetId);
    if (!cached) {
      const b = win.getBounds();
      cached = { x: b.x, y: b.y, width: b.width, height: b.height, opacity: clamped, alwaysOnTop: win.isAlwaysOnTop(), title: '' };
      widgetPositionCache.set(widgetId, cached);
    } else {
      cached.opacity = clamped;
      // extra는 기존 값 유지 (별도 변경 없음)
    }
    saveWidgetPositionsDebounced();
  }
});

ipcMain.handle('widget:resize', (_event, widgetId: string, width: number, height: number) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    const bounds = win.getBounds();
    win.setBounds({ x: bounds.x, y: bounds.y, width: Math.round(width), height: Math.round(height) }, true);
  }
});

ipcMain.handle('widget:get-size', (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    const [w, h] = win.getSize();
    return { width: w, height: h };
  }
  return null;
});

ipcMain.handle('widget:close-popup', (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

ipcMain.handle('widget:set-aot', (_event, widgetId: string, aot: boolean) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    // Acrylic + Windows DWM 우회:
    // OFF: setAlwaysOnTop(false) — 일반 윈도우로 전환
    // ON: setAlwaysOnTop(true, 'normal') — Acrylic에서 'normal' 레벨이 실제 topmost
    if (aot) {
      win.setAlwaysOnTop(true, 'normal');
    } else {
      win.setAlwaysOnTop(false);
    }
    let cached = widgetPositionCache.get(widgetId);
    if (!cached) {
      const b = win.getBounds();
      cached = { x: b.x, y: b.y, width: b.width, height: b.height, opacity: 0.92, alwaysOnTop: aot, title: '' };
      widgetPositionCache.set(widgetId, cached);
    } else {
      cached.alwaysOnTop = aot;
    }
    saveWidgetPositionsDebounced();
  }
});

ipcMain.handle('widget:minimize-to-dock', async (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  const currentBounds = win.getBounds();
  if (!widgetOriginalBounds.has(widgetId)) {
    widgetOriginalBounds.set(widgetId, currentBounds);
  }

  // 독 스택에 추가
  if (!dockedWidgetIds.includes(widgetId)) {
    dockedWidgetIds.push(widgetId);
  }
  const stackIndex = dockedWidgetIds.indexOf(widgetId);
  const target = getDockPosition(stackIndex);

  // 1) 렌더러에 독 모드 전환 알림 → CSS 콘텐츠 축소 시작
  win.webContents.send('widget:dock-change', true);

  // 2) 최소 크기 제한 해제 후, 윈도우를 부드럽게 축소
  win.setMinimumSize(DOCK_ITEM_W, DOCK_ITEM_H);
  win.setResizable(false);
  win.setSkipTaskbar(true);

  await animateBounds(win, currentBounds, target, 350, widgetId);

  // 기존 독 위젯들 재배치
  repositionAllDocked(widgetId);
});

ipcMain.handle('widget:dock-expand', async (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  expandedDockWidgetId = widgetId;

  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const expandW = 380;
  const expandH = 320;

  const currentBounds = win.getBounds();
  const target = {
    x: wa.x + wa.width - expandW - DOCK_MARGIN,
    y: wa.y + wa.height - expandH - DOCK_MARGIN,
    width: expandW,
    height: expandH,
  };

  // 부드럽게 확장 (pill → 프리뷰)
  await animateBounds(win, currentBounds, target, 200, widgetId);
});

ipcMain.handle('widget:dock-collapse', async (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  expandedDockWidgetId = null;

  const currentBounds = win.getBounds();
  const stackIndex = dockedWidgetIds.indexOf(widgetId);
  const target = stackIndex >= 0 ? getDockPosition(stackIndex) : getDockPosition(0);

  // 부드럽게 축소 (프리뷰 → pill)
  await animateBounds(win, currentBounds, target, 180, widgetId);
});

ipcMain.handle('widget:restore-from-dock', async (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  // 독 스택에서 제거
  const idx = dockedWidgetIds.indexOf(widgetId);
  if (idx >= 0) dockedWidgetIds.splice(idx, 1);
  if (expandedDockWidgetId === widgetId) expandedDockWidgetId = null;

  const currentBounds = win.getBounds();
  const original = widgetOriginalBounds.get(widgetId);
  const target = original ?? { x: currentBounds.x - 140, y: currentBounds.y - 160, width: 420, height: 360 };

  // 1) 윈도우 속성 복원 + 독 모드 해제 → CSS 복원 애니메이션 시작
  win.setMinimumSize(40, 36);   // 일시적으로 최소크기 낮춤 (애니메이션 중 클리핑 방지)
  win.setResizable(true);
  win.setSkipTaskbar(false);
  win.webContents.send('widget:dock-change', false);

  // 2) 부드럽게 확장 애니메이션
  await animateBounds(win, currentBounds, target, 350, widgetId);

  // 3) 최소 크기 복원
  win.setMinimumSize(280, 200);
  if (original) widgetOriginalBounds.delete(widgetId);

  // 나머지 독 위젯들 재배치
  repositionAllDocked();
});

// ─── IPC 핸들러: 위젯 뒤 데스크톱 캡처 (글래스 블러용) ──────

ipcMain.handle('widget:capture-behind', async (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return null;

  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: display.size,
    });

    // 해당 디스플레이의 소스 찾기
    const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
    if (!source) return null;

    const thumbnail = source.thumbnail;

    // 위젯 위치 기준으로 크롭
    const x = Math.max(0, bounds.x - display.bounds.x);
    const y = Math.max(0, bounds.y - display.bounds.y);
    const w = Math.min(bounds.width, display.size.width - x);
    const h = Math.min(bounds.height, display.size.height - y);

    if (w <= 0 || h <= 0) return null;

    const cropped = thumbnail.crop({ x, y, width: w, height: h });
    return `data:image/png;base64,${cropped.toPNG().toString('base64')}`;
  } catch (err) {
    console.error('[widget:capture-behind]', err);
    return null;
  }
});

// ─── 위젯 저장 상태 조회 (WidgetPopup에서 초기 opacity/AOT 복원용) ─
ipcMain.handle('widget:get-saved-state', (_event, widgetId: string) => {
  return widgetPositionCache.get(widgetId) ?? null;
});

// ─── 딥링크 (bflow:// 커스텀 프로토콜) ──────────────────────
// URL 형식: bflow://scene/<sheetName>/<sceneId>
// 예: bflow://scene/EP01_A_BG/a003  또는  bflow://scene/EP01_A_BG/12
//
// 동작 방식 (빌드 모드):
//   1) 앱이 실행 중 → second-instance 이벤트로 URL 수신 → 기존 창 포커스 + 씬 모달 오픈
//   2) 앱이 꺼져 있음 → OS가 앱 실행 + argv로 URL 전달 → 로드 완료 후 씬 모달 오픈
//
// 동작 방식 (개발 모드):
//   second-instance가 불안정할 수 있으므로, 파일 기반 폴백 추가:
//   - 두 번째 인스턴스가 deeplink.txt 파일에 URL 기록 후 종료
//   - 첫 번째 인스턴스가 파일 감시(fs.watch)로 URL 읽어서 처리
//
// 테스트: cmd에서 start bflow://scene/EP01_A_BG/a003
//   ※ 빌드 후에는 설치된 exe가 자동 등록됨

const PROTOCOL = 'bflow';
const DEEPLINK_FILE = path.join(app.getPath('userData'), 'deeplink.txt');

let pendingDeepLink: string | null = null;

function parseDeepLink(url: string): { sheetName: string; sceneId: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    if (u.host !== 'scene') return null;
    const segments = u.pathname.replace(/^\/+/, '').split('/');
    if (segments.length < 2) return null;
    return { sheetName: decodeURIComponent(segments[0]), sceneId: decodeURIComponent(segments[1]) };
  } catch {
    return null;
  }
}

function sendDeepLinkToRenderer(url: string): void {
  const parsed = parseDeepLink(url);
  if (!parsed) return;
  console.log('[DeepLink] 전달:', parsed);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deep-link', parsed);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // 메인 창이 파괴된 상태 (렌더러 크래시 등) → pendingDeepLink로 저장하고
    // showMainWindow()로 창 복구 트리거. 새 창의 did-finish-load 시점에 처리됨.
    pendingDeepLink = url;
    showMainWindow();
  }
}

/** 딥링크 파일에 URL 기록 (두 번째 인스턴스 → 첫 번째 인스턴스 전달용) */
function writeDeepLinkFile(url: string): void {
  try {
    const dir = path.dirname(DEEPLINK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEEPLINK_FILE, url, 'utf-8');
  } catch (err) {
    console.error('[DeepLink] 파일 쓰기 실패:', err);
  }
}

/** 딥링크 파일 감시 시작 (첫 번째 인스턴스에서 호출) */
/** 딥링크 파일 폴링 감시 시작 (500ms 주기) */
function watchDeepLinkFile(): void {
  // 기존 파일 정리
  try { fs.unlinkSync(DEEPLINK_FILE); } catch { /* 없으면 무시 */ }

  setInterval(() => {
    try {
      if (!fs.existsSync(DEEPLINK_FILE)) return;
      const url = fs.readFileSync(DEEPLINK_FILE, 'utf-8').trim();
      fs.unlinkSync(DEEPLINK_FILE);
      if (url) {
        console.log('[DeepLink] 파일에서 URL 감지:', url);
        sendDeepLinkToRenderer(url);
      }
    } catch { /* 파일 경합 무시 */ }
  }, 500);
}

// 싱글 인스턴스 + 딥링크 전달
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 두 번째 인스턴스: 딥링크 파일만 기록하고 조용히 종료
  // requestSingleInstanceLock()이 false를 반환하면 argv는 이미 첫 번째 인스턴스로 전달됨
  // 파일 기록은 second-instance IPC가 유실될 경우의 폴백
  const deepLinkUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (deepLinkUrl) writeDeepLinkFile(deepLinkUrl);
  // ★ ready 이전에 quit/exit하면 Windows가 "프로그램 실패"로 인식 → 비프음 재생
  // ready까지 기다린 후 조용히 종료해야 비프음 방지
  app.on('ready', () => setTimeout(() => app.exit(0), 50));
} else {
  // ★ 프로토콜 등록은 첫 번째 인스턴스에서만!
  // 두 번째 인스턴스에서 호출하면 cwd가 system32일 때 레지스트리가 깨짐
  if (process.env.VITE_DEV_SERVER_URL) {
    const success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(__dirname, '..'),
    ]);
    console.log(`[DeepLink] 개발 모드 프로토콜 등록: ${success ? '성공' : '실패'}`);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  // 첫 번째 인스턴스: second-instance 이벤트 + 파일 감시
  app.on('second-instance', (_event, argv) => {
    console.log('[DeepLink] second-instance argv:', argv);
    const deepLinkUrl = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    console.log('[DeepLink] 추출된 URL:', deepLinkUrl ?? '(없음)');
    if (deepLinkUrl) {
      sendDeepLinkToRenderer(deepLinkUrl);
    } else {
      // URL 없는 경우에도 창 활성화 (showMainWindow가 필요 시 재생성까지 책임짐)
      showMainWindow();
    }
  });

  // 파일 기반 폴백: second-instance가 안 먹힐 경우 대비
  watchDeepLinkFile();
}

// macOS: open-url 이벤트
app.on('open-url', (event, url) => {
  event.preventDefault();
  sendDeepLinkToRenderer(url);
});

// ─── 앱 라이프사이클 ─────────────────────────────────────────

app.whenReady().then(async () => {
  // 두 번째 인스턴스면 초기화하지 않고 종료
  if (!gotTheLock) return;

  // 메인 창 bounds 미리 로드 — createWindow 전에 캐시 완료되어 있어야 첫 창부터 저장 크기로 뜸
  await preloadMainWindowBounds();

  // 위젯 위치 캐시 로드 (Phase 0-6)
  loadWidgetPositions();

  // 이미지 캐시 정리 (500MB 초과 시 Drive 백업된 파일 자동 삭제)
  cleanupImageCache();

  // bflow-img:// 프로토콜 핸들러: userData/images/ 폴더에서 이미지 서빙
  // standard URL이므로 hostname은 소문자로 변환됨 → pathname에 파일명 보관
  protocol.handle('bflow-img', (request) => {
    const url = new URL(request.url);
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const fullPath = path.join(getDataPath(), 'images', fileName);
    return net.fetch(pathToFileURL(fullPath).toString());
  });

  // drive-img:// 프로토콜 핸들러: Google Drive 이미지 프록시
  // uc?export=view URL은 Electron 렌더러에서 403 차단됨 → 메인 프로세스에서 대신 fetch
  protocol.handle('drive-img', async (request) => {
    const url = new URL(request.url);
    const fileId = url.pathname.replace(/^\/+/, '');

    // 1차: thumbnail 엔드포인트 (가장 안정적)
    const endpoints = [
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
      `https://lh3.googleusercontent.com/d/${fileId}=s800`,
      `https://drive.google.com/uc?export=view&id=${fileId}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const resp = await net.fetch(endpoint, { redirect: 'follow' });
        const ct = resp.headers.get('content-type') || '';
        if (resp.ok && ct.startsWith('image/')) {
          return resp;
        }
      } catch {
        // 다음 엔드포인트 시도
      }
    }

    return new Response('Drive image not found', { status: 404 });
  });

  console.time('splash-to-main'); // 측정 시작

  createSplashWindow(); // 1. 가장 먼저 스플래시
  createTray();        // 먼저 트레이 준비 (실패해도 앱은 계속)
  createWindow();

  // 메인 로드 30초 타임아웃 (좀비 방지).
  // Task 2.3의 did-finish-load 핸들러에서 clearTimeout + 해제 처리.
  // 공유 드라이브 최초 로드/캐시 워밍 감안한 여유 타임아웃
  const MAIN_LOAD_TIMEOUT_MS = 30_000;
  loadTimeoutId = setTimeout(() => {
    if (mainLoadedOk) {
      loadTimeoutId = null;
      return;
    }
    console.error('[메인 로드] 30초 타임아웃 — 에러 다이얼로그 후 종료');
    closeSplash();
    try {
      dialog.showErrorBox('B flow', '앱 로드에 실패했습니다. 다시 실행해주세요.');
    } catch {/* ignore */}
    try { console.timeEnd('splash-to-main'); } catch {/* ignore */}
    isQuitting = true;
    app.quit();
  }, MAIN_LOAD_TIMEOUT_MS);

  // Google Calendar 토큰 복원
  gcal.restoreTokens();

  // Supabase Realtime 구독 시작
  startSupabaseRealtime();

  // 저장된 위젯 자동 복원 (Phase 0-6) + 보류 딥링크 전달
  // .once: 렌더러 재로드(Ctrl+Shift+R, 크래시 복구) 시 재실행 방지 — 사용자가 닫은 위젯 재등장/딥링크 재실행 차단
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (widgetPositionCache.size > 0) {
        for (const [widgetId, state] of widgetPositionCache) {
          // 사용자가 명시적으로 닫은 위젯(isOpen=false) 은 복원하지 않음.
          // isOpen 필드가 없는 레거시 데이터는 호환을 위해 "열린 상태" 로 간주 → 기존 UX 유지.
          if (state.isOpen === false) continue;
          try {
            const title = state.title || WIDGET_TITLE_MAP[widgetId] || widgetId;
            // state.extra를 명시적으로 넘기지 않아도 openWidgetPopup 내부에서
            // savedPos.extra를 자동 복원(effectiveExtra)하지만, 명시 전달로 의도를 분명히 한다.
            openWidgetPopup(widgetId, title, state.extra);
          } catch (err) {
            console.error(`[위젯 자동복원] ${widgetId} 실패:`, err);
          }
        }
      }
      // 앱 시작 시 보류된 딥링크 전달
      if (pendingDeepLink) {
        sendDeepLinkToRenderer(pendingDeepLink);
        pendingDeepLink = null;
      }
      // Windows: 프로세스 argv에서 딥링크 확인 (프로토콜 핸들러로 앱이 시작된 경우)
      const argDeepLink = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
      if (argDeepLink) sendDeepLinkToRenderer(argDeepLink);
    });
  }

  // 재시도 알림 콜백: sheets.ts → 모든 윈도우에 브로드캐스트
  setRetryNotifyCallback((message: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sheets:retry-notify', message);
    }
    for (const [, win] of widgetWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('sheets:retry-notify', message);
      }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ─── 종료 시 미완료 작업 대기 (Phase 0-5) ─────────────────────

app.on('before-quit', (e) => {
  if (isQuitting) return;
  isQuitting = true;

  // GCal Watch 채널 중지 (5초 타임아웃)
  const watchCleanup = gcal.stopAllWatches().catch(() => {});

  // Supabase Realtime 정리
  teardownRealtime();

  // 위젯 위치 즉시 저장 (closed 이벤트보다 먼저 실행)
  saveWidgetPositionsSync();

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }

  const sheetsPending = getPendingOpsCount();
  const vacPending = getVacPendingOpsCount();
  const totalPending = sheetsPending + vacPending;
  if (totalPending > 0) {
    e.preventDefault();

    console.log(`[종료] ${totalPending}개 작업 대기 중 (시트: ${sheetsPending}, 휴가: ${vacPending})... 완료 후 종료합니다.`);

    // 메인 윈도우에 "저장 중" 알림
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:saving-before-quit', totalPending);
    }

    // Watch 정리 + 시트 15초 + 휴가 60초 대기 후 종료
    const watchWithTimeout = Promise.race([watchCleanup, new Promise<void>((r) => setTimeout(r, 5000))]);
    Promise.all([
      watchWithTimeout,
      waitForAllPendingOps(15000),
      waitForVacPendingOps(60000),
    ]).then(([, sheetsDone, vacDone]) => {
      if (!sheetsDone || !vacDone) {
        console.warn('[종료] 타임아웃 — 일부 작업이 완료되지 않았을 수 있습니다');
      }
      console.log('[종료] 저장 완료, 앱을 종료합니다');
      app.quit();
    });
  } else {
    // 대기 중 작업 없음: Watch 정리는 fire-and-forget (종료를 지연시키지 않음)
    Promise.race([watchCleanup, new Promise<void>((r) => setTimeout(r, 2000))]).catch(() => {});
  }
});

process.on('exit', () => {
  try { saveWidgetPositionsSync(); } catch {/* ignore */}
});

app.on('window-all-closed', () => {
  // 트레이가 살아있고 사용자가 종료 의사를 표시하지 않은 경우: 백그라운드 유지
  if (!isQuitting && tray && !tray.isDestroyed()) {
    return;
  }
  // 트레이 실패 or isQuitting: 정상 종료 흐름
  app.quit();
});
