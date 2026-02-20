import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron';
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
} from './sheets';

// 앱 이름 설정 — AppData 경로에 영향
app.name = 'Bflow-BGonly';

// 테스트 모드 감지
const isTestMode = process.argv.includes('--test-mode') || process.env.TEST_MODE === '1';

let mainWindow: BrowserWindow | null = null;

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
        // 렌더러에 "다른 사용자가 파일을 변경함" 알림
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sheet:changed');
        }
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
    title: isTestMode ? 'BG 진행 현황판 [테스트]' : 'BG 진행 현황판',
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

ipcMain.handle('sheets:add-episode', async (_event, episodeNumber: number) => {
  try {
    await addEpisode(episodeNumber);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('sheets:add-part', async (_event, episodeNumber: number, partId: string) => {
  try {
    await addPart(episodeNumber, partId);
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

// ─── IPC 핸들러: 이미지 저장/로드 (P2-1) ───────────────────────

function getImagesDir(): string {
  return path.join(getDataPath(), 'images');
}

ipcMain.handle(
  'image:save',
  async (_event, data: Uint8Array, sheetName: string, sceneId: string, imageType: string) => {
    const dir = path.join(getImagesDir(), sheetName);
    ensureDir(dir);
    const filename = `${sceneId}_${imageType}_${Date.now()}.png`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, Buffer.from(data));
    return filePath;
  }
);

ipcMain.handle(
  'image:pick-and-save',
  async (_event, sheetName: string, sceneId: string, imageType: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const srcPath = result.filePaths[0];
    const ext = path.extname(srcPath);
    const dir = path.join(getImagesDir(), sheetName);
    ensureDir(dir);
    const filename = `${sceneId}_${imageType}_${Date.now()}${ext}`;
    const destPath = path.join(dir, filename);
    fs.copyFileSync(srcPath, destPath);
    return destPath;
  }
);

ipcMain.handle('image:delete', async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
});

// ─── 앱 라이프사이클 ─────────────────────────────────────────

app.whenReady().then(() => {
  // 로컬 이미지 프로토콜 등록 (img src에서 local-image://path 사용)
  protocol.handle('local-image', (request) => {
    const filePath = decodeURIComponent(request.url.slice('local-image://'.length));
    return net.fetch(`file://${filePath}`);
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
