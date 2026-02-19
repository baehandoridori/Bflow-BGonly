import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

// 앱 이름 설정 — AppData 경로에 영향
app.name = 'Bflow-BGonly';

// 테스트 모드 감지: --test-mode 플래그 또는 TEST_MODE 환경변수
const isTestMode = process.argv.includes('--test-mode') || process.env.TEST_MODE === '1';

let mainWindow: BrowserWindow | null = null;

function getDataPath(): string {
  return app.getPath('userData'); // %APPDATA%/Bflow-BGonly
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

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

  // 개발 모드: Vite dev server / 프로덕션: 빌드된 파일
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

// ─── IPC 핸들러: 개인 설정 읽기/쓰기 ────────────────────────

ipcMain.handle('settings:get-path', () => {
  return getDataPath();
});

ipcMain.handle('settings:get-mode', () => {
  return { isTestMode };
});

ipcMain.handle('settings:read', async (_event, fileName: string) => {
  const filePath = path.join(getDataPath(), fileName);
  try {
    const data = fs.readFileSync(filePath, { encoding: 'utf-8' });
    return JSON.parse(data);
  } catch {
    return null; // 파일 없으면 null
  }
});

ipcMain.handle('settings:write', async (_event, fileName: string, data: unknown) => {
  const dirPath = getDataPath();
  ensureDir(dirPath);
  const filePath = path.join(dirPath, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  return true;
});

// ─── IPC 핸들러: 테스트 데이터 (테스트 모드 전용) ──────────────

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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  return true;
});

// ─── 앱 라이프사이클 ─────────────────────────────────────────

app.whenReady().then(() => {
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
