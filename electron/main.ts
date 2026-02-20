import { app, BrowserWindow, clipboard, ipcMain, protocol, net } from 'electron';
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
