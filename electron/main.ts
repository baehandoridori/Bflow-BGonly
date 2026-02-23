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
} from './sheets';

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

// 테스트 모드 감지
const isTestMode = process.argv.includes('--test-mode') || process.env.TEST_MODE === '1';

let mainWindow: BrowserWindow | null = null;
const widgetWindows = new Map<string, BrowserWindow>();
const widgetOriginalBounds = new Map<string, Electron.Rectangle>();

// ─── 파일 감시 (실시간 동기화) ────────────────────────────────

let fileWatcher: fs.FSWatcher | null = null;
// 자기가 쓴 직후에는 알림 무시 (자기 반영 방지)
let ignoreNextChange = false;

function startWatching(filePath: string): void {
  stopWatching();

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let debounceTimer: NodeJS.Timeout | null = null;

  try {
    fileWatcher = fs.watch(filePath, { persistent: false }, (eventType) => {
      if (eventType !== 'change') return;

      if (ignoreNextChange) {
        ignoreNextChange = false;
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // 모든 윈도우(메인 + 위젯 팝업)에 "데이터 변경" 알림
        broadcastSheetChanged();
      }, 200); // 200ms debounce
    });
  } catch {
    // 파일이 아직 없으면 1초 후 재시도
    setTimeout(() => startWatching(filePath), 1000);
  }
}

function stopWatching(): void {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
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
    title: isTestMode ? 'B flow [테스트]' : 'B flow',
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
    stopWatching();
  });

  // 테스트 모드: 시트 파일 감시 시작
  if (isTestMode) {
    const sheetPath = path.join(getAppRoot(), 'test-data', 'sheets.json');
    if (fs.existsSync(sheetPath)) {
      startWatching(sheetPath);
    }
  }
}

// ─── IPC 핸들러: 사용자 파일 (base64 인코딩 JSON) ────────────

function getUsersFilePath(): string {
  // 테스트: test-data/users.dat  |  프로덕션: exe 옆 users.dat
  if (isTestMode) {
    return path.join(getAppRoot(), 'test-data', 'users.dat');
  }
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

ipcMain.handle('settings:get-mode', () => ({
  isTestMode,
  appRoot: getAppRoot(),
}));

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

// ─── IPC 핸들러: 테스트 데이터 ───────────────────────────────

ipcMain.handle('test:get-sheet-path', () => {
  return path.join(getAppRoot(), 'test-data', 'sheets.json');
});

ipcMain.handle('test:read-sheet', async (_event, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath, { encoding: 'utf-8' });
    return JSON.parse(data);
  } catch {
    return null;
  }
});

ipcMain.handle('test:write-sheet', async (_event, filePath: string, data: unknown) => {
  const dir = path.dirname(filePath);
  ensureDir(dir);

  // 자기 쓰기 → 파일 변경 이벤트 무시 플래그
  ignoreNextChange = true;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });

  // 최초 쓰기 시 감시 시작
  if (!fileWatcher && isTestMode) {
    startWatching(filePath);
  }

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
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    title: widgetTitle,
    backgroundColor: '#00000000',
    hasShadow: false,
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

  widgetWindows.set(widgetId, popupWin);
  popupWin.on('closed', () => {
    widgetWindows.delete(widgetId);
    widgetOriginalBounds.delete(widgetId);
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

  // 네이티브 최소화 인터셉트 → 독 모드로 전환
  popupWin.on('minimize', () => {
    if (popupWin.isDestroyed()) return;
    popupWin.restore();
    // 독 모드 진입
    if (!widgetOriginalBounds.has(widgetId)) {
      widgetOriginalBounds.set(widgetId, popupWin.getBounds());
    }
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const dockW = 420;
    const dockH = 360;
    popupWin.setBounds({
      x: wa.x + wa.width - dockW - 12,
      y: wa.y + wa.height - dockH - 12,
      width: dockW,
      height: dockH,
    });
    popupWin.setSkipTaskbar(true);
    popupWin.setResizable(false);
    popupWin.webContents.send('widget:dock-change', true);
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
    win.setAlwaysOnTop(aot);
  }
});

ipcMain.handle('widget:minimize-to-dock', (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  if (!widgetOriginalBounds.has(widgetId)) {
    widgetOriginalBounds.set(widgetId, win.getBounds());
  }
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const dockW = 420;
  const dockH = 360;
  win.setBounds({
    x: wa.x + wa.width - dockW - 12,
    y: wa.y + wa.height - dockH - 12,
    width: dockW,
    height: dockH,
  });
  win.setSkipTaskbar(true);
  win.setResizable(false);
  win.webContents.send('widget:dock-change', true);
});

ipcMain.handle('widget:restore-from-dock', (_event, widgetId: string) => {
  const win = widgetWindows.get(widgetId);
  if (!win || win.isDestroyed()) return;

  const original = widgetOriginalBounds.get(widgetId);
  if (original) {
    win.setBounds(original);
    widgetOriginalBounds.delete(widgetId);
  }
  win.setSkipTaskbar(false);
  win.setResizable(true);
  win.webContents.send('widget:dock-change', false);
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
  stopWatching();
  app.quit();
});
