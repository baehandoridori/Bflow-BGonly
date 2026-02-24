import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen } from 'electron';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import {
  initSheets,
  isConnected,
  readAllEpisodes,
  updateSceneStage,
  addEpisode,
  addPart,
  addScene,
  deleteScene,
  updateSceneField,
  uploadImage,
  readMetadata,
  writeMetadata,
  softDeletePart,
  softDeleteEpisode,
  archiveEpisode,
  unarchiveEpisode,
  readArchivedEpisodes,
  gasBatch,
  readRegistry,
  archiveEpisodeViaRegistry,
  unarchiveEpisodeViaRegistry,
  readCommentsForPart,
  addCommentToSheets,
  editCommentInSheets,
  deleteCommentFromSheets,
  readUsersFromSheets,
  addUserToSheets,
  updateUserInSheets,
  deleteUserFromSheets,
  addScenes,
  bulkUpdateCells,
} from './sheets';
import type { SheetUser } from './sheets';
import type { BatchAction } from './sheets';

// 앱 이름 설정 — AppData 경로에 영향
app.name = 'Bflow-BGonly';

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

/** 모든 윈도우(메인 + 위젯 팝업)에 sheet:changed 이벤트 브로드캐스트 */
function broadcastSheetChanged(excludeWebContentsId?: number): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.id !== excludeWebContentsId) {
      mainWindow.webContents.send('sheet:changed');
    }
  }
  for (const [, win] of widgetWindows) {
    if (!win.isDestroyed() && win.webContents.id !== excludeWebContentsId) {
      win.webContents.send('sheet:changed');
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
  return app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();
}

// ─── 윈도우 생성 ──────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'B flow',
    backgroundColor: '#0F1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC 핸들러: 사용자 파일 (base64 인코딩 JSON) ────────────

function getUsersFilePath(): string {
  return path.join(getAppRoot(), 'users.dat');
}

ipcMain.handle('users:read', () => {
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

// ─── IPC 핸들러: Google Sheets 연동 (Apps Script 웹 앱) ─────

ipcMain.handle('sheets:connect', async (_event, webAppUrl: string) => {
  try {
    const ok = await initSheets(webAppUrl);
    return { ok, error: ok ? null : '연결 실패 — URL을 확인해주세요' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:is-connected', () => {
  return isConnected();
});

ipcMain.handle('sheets:read-all', async () => {
  try {
    const episodes = await readAllEpisodes();
    return { ok: true, data: episodes };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: null };
  }
});

ipcMain.handle(
  'sheets:update-cell',
  async (
    _event,
    sheetName: string,
    rowIndex: number,
    stage: string,
    value: boolean
  ) => {
    try {
      await updateSceneStage(sheetName, rowIndex, stage, value);
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
);

ipcMain.handle('sheets:add-episode', async (_event, episodeNumber: number, department?: string) => {
  try {
    await addEpisode(episodeNumber, (department as 'bg' | 'acting') || 'bg');
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:add-part', async (_event, episodeNumber: number, partId: string, department?: string) => {
  try {
    await addPart(episodeNumber, partId, (department as 'bg' | 'acting') || 'bg');
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle(
  'sheets:add-scene',
  async (_event, sheetName: string, sceneId: string, assignee: string, memo: string) => {
    try {
      await addScene(sheetName, sceneId, assignee, memo);
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
);

ipcMain.handle('sheets:delete-scene', async (_event, sheetName: string, rowIndex: number) => {
  try {
    await deleteScene(sheetName, rowIndex);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle(
  'sheets:update-scene-field',
  async (_event, sheetName: string, rowIndex: number, field: string, value: string) => {
    try {
      await updateSceneField(sheetName, rowIndex, field, value);
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
);

ipcMain.handle(
  'sheets:upload-image',
  async (_event, sheetName: string, sceneId: string, imageType: string, base64Data: string) => {
    try {
      const result = await uploadImage(sheetName, sceneId, imageType, base64Data);
      return { ok: true, url: result.url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
);

// ─── IPC 핸들러: METADATA ───────────────────────────────────

ipcMain.handle('sheets:read-metadata', async (_event, type: string, key: string) => {
  try {
    const data = await readMetadata(type, key);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:write-metadata', async (_event, type: string, key: string, value: string) => {
  try {
    await writeMetadata(type, key, value);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:soft-delete-part', async (_event, sheetName: string) => {
  try {
    await softDeletePart(sheetName);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:soft-delete-episode', async (_event, episodeNumber: number) => {
  try {
    await softDeleteEpisode(episodeNumber);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:read-archived', async () => {
  try {
    const data = await readArchivedEpisodes();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('sheets:archive-episode', async (_event, episodeNumber: number) => {
  try {
    await archiveEpisode(episodeNumber);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:unarchive-episode', async (_event, episodeNumber: number) => {
  try {
    await unarchiveEpisode(episodeNumber);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: 배치 요청 (Phase 0) ────────────────────────

ipcMain.handle('sheets:batch', async (_event, actions: BatchAction[]) => {
  try {
    const result = await gasBatch(actions);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: 대량 셀 업데이트 (다중 씬 체크박스 토글) ─────

ipcMain.handle('sheets:bulk-update-cells', async (_event, sheetName: string, updates: { rowIndex: number; stage: string; value: boolean }[]) => {
  try {
    await bulkUpdateCells(sheetName, updates);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: _REGISTRY (Phase 0-2) ───────────────────────

ipcMain.handle('sheets:read-registry', async () => {
  try {
    const data = await readRegistry();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('sheets:archive-episode-via-registry', async (
  _event, episodeNumber: number, archivedBy: string, archiveMemo: string
) => {
  try {
    await archiveEpisodeViaRegistry(episodeNumber, archivedBy, archiveMemo);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:unarchive-episode-via-registry', async (_event, episodeNumber: number) => {
  try {
    await unarchiveEpisodeViaRegistry(episodeNumber);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: 대량 씬 추가 (Phase 0-5) ────────────────────

ipcMain.handle('sheets:add-scenes', async (
  _event, sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]
) => {
  try {
    await addScenes(sheetName, scenes);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: _USERS (Phase 0-4) ──────────────────────────

ipcMain.handle('sheets:read-users', async () => {
  try {
    const data = await readUsersFromSheets();
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('sheets:add-user', async (_event, user: SheetUser) => {
  try {
    await addUserToSheets(user);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:update-user', async (_event, userId: string, updates: Record<string, string>) => {
  try {
    await updateUserInSheets(userId, updates);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:delete-user', async (_event, userId: string) => {
  try {
    await deleteUserFromSheets(userId);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: _COMMENTS (Phase 0-3) ───────────────────────

ipcMain.handle('sheets:read-comments', async (_event, sheetName: string) => {
  try {
    const data = await readCommentsForPart(sheetName);
    return { ok: true, data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, data: [] };
  }
});

ipcMain.handle('sheets:add-comment', async (
  _event, commentId: string, sheetName: string, sceneId: string,
  userId: string, userName: string, text: string, mentions: string[], createdAt: string
) => {
  try {
    await addCommentToSheets(commentId, sheetName, sceneId, userId, userName, text, mentions, createdAt);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:edit-comment', async (
  _event, commentId: string, text: string, mentions: string[]
) => {
  try {
    await editCommentInSheets(commentId, text, mentions);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:delete-comment', async (_event, commentId: string) => {
  try {
    await deleteCommentFromSheets(commentId);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

// ─── IPC 핸들러: 데이터 변경 브로드캐스트 (라이브 모드) ──────

ipcMain.handle('sheets:notify-change', (event) => {
  // 호출한 윈도우를 제외한 모든 윈도우에 sheet:changed 전송
  broadcastSheetChanged(event.sender.id);
  return { ok: true };
});

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
  const buffer = image.toJPEG(80);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
});

// ─── IPC 핸들러: 위젯 팝업 윈도우 ──────────────────────────────

ipcMain.handle('widget:open-popup', (_event, widgetId: string, widgetTitle: string) => {
  // 이미 열린 팝업이면 포커스
  const existing = widgetWindows.get(widgetId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }

  const popupWin = new BrowserWindow({
    width: 420,
    height: 360,
    minWidth: 280,
    minHeight: 200,
    frame: false,
    transparent: false,
    alwaysOnTop: false, // ready-to-show에서 설정
    show: false,        // 수동 show 제어
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

  // 같은 앱을 로드하되, 해시로 팝업 모드 + 위젯 ID 전달
  const hash = `#widget-popup/${encodeURIComponent(widgetId)}`;
  if (process.env.VITE_DEV_SERVER_URL) {
    popupWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}${hash}`);
  } else {
    popupWin.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
  }

  // 윈도우 준비 완료 시 AOT 설정 + 표시 (Acrylic 초기화 후)
  popupWin.once('ready-to-show', () => {
    if (popupWin.isDestroyed()) return;
    popupWin.setAlwaysOnTop(true, 'floating');
    popupWin.showInactive();
    // Acrylic + AOT 안정화를 위해 약간의 딜레이 후 포커스 + AOT 재확인
    setTimeout(() => {
      if (!popupWin.isDestroyed()) {
        popupWin.focus();
        popupWin.setAlwaysOnTop(true, 'floating');
      }
    }, 150);
  });

  widgetWindows.set(widgetId, popupWin);
  popupWin.on('closed', () => {
    widgetWindows.delete(widgetId);
    widgetOriginalBounds.delete(widgetId);
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

  return { ok: true };
});

ipcMain.handle('widget:set-opacity', (_event, widgetId: string, opacity: number) => {
  const win = widgetWindows.get(widgetId);
  if (win && !win.isDestroyed()) {
    win.setOpacity(Math.max(0.15, Math.min(1, opacity)));
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
    win.setAlwaysOnTop(aot, 'floating');
    if (aot) {
      // AOT 켤 때 포커스 확보 + 재확인
      win.focus();
      setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'floating');
      }, 100);
    }
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

// ─── 앱 라이프사이클 ─────────────────────────────────────────

app.whenReady().then(() => {
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
