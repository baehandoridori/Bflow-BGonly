import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen, shell, Notification } from 'electron';
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

// ─── 위젯 위치 영속화 (Phase 0-6) ─────────────────────────────
const WIDGET_POS_FILE = 'widget-positions.json';

interface SavedWidgetState {
  x: number; y: number; width: number; height: number;
  opacity: number; alwaysOnTop: boolean;
  title?: string;
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

import { setupBroadcast } from './broadcast';
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
  updateSceneField as sbUpdateSceneField,
  readUsers as sbReadUsers,
  addUser as sbAddUser,
  updateUser as sbUpdateUser,
  deleteUser as sbDeleteUser,
  readCommentsForPart as sbReadComments,
  addComment as sbAddComment,
  editComment as sbEditComment,
  deleteComment as sbDeleteComment,
  readAllRevisions as sbReadRevisions,
  addRevision as sbAddRevision,
  updateRevision as sbUpdateRevision,
  readAllMetadata as sbReadAllMetadata,
  readMetadata as sbReadMetadata,
  writeMetadata as sbWriteMetadata,
} from './supabase';
import type { SupabaseUser } from './supabase';
import { setupRealtimeSubscription, teardownRealtime } from './realtime';

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
  await sbAddScene(sheetName, sceneId, assignee, memo);
}));
ipcMain.handle('supabase:add-scenes', wrapIpc(async (_e: unknown, sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) => {
  await sbAddScenes(sheetName, scenes);
}));
ipcMain.handle('supabase:delete-scene', wrapIpc(async (_e: unknown, sceneUuid: string) => {
  await sbDeleteScene(sceneUuid);
}));
ipcMain.handle('supabase:update-scene-stage', wrapIpc(async (_e: unknown, sceneUuid: string, stage: string, value: boolean, updatedBy?: string) => {
  await sbUpdateSceneStage(sceneUuid, stage, value, updatedBy);
}));
ipcMain.handle('supabase:bulk-update-scene-stages', wrapIpc(async (_e: unknown, updates: { sceneUuid: string; stage: string; value: boolean }[], updatedBy?: string) => {
  await sbBulkUpdateSceneStages(updates, updatedBy);
}));
ipcMain.handle('supabase:update-scene-field', wrapIpc(async (_e: unknown, sceneUuid: string, field: string, value: string, senderId?: string) => {
  await sbUpdateSceneField(sceneUuid, field, value, senderId);
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
ipcMain.handle('supabase:add-comment', wrapIpc(async (_e: unknown, commentId: string, partUuid: string, sceneId: string,
  userId: string, userName: string, text: string, mentions: string[], createdAt: string) => {
  await sbAddComment(commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt);
}));
ipcMain.handle('supabase:edit-comment', wrapIpc(async (_e: unknown, commentId: string, text: string, mentions: string[]) => {
  await sbEditComment(commentId, text, mentions);
}));
ipcMain.handle('supabase:delete-comment', wrapIpc(async (_e: unknown, commentId: string) => {
  await sbDeleteComment(commentId);
}));

// ─── Revisions ───
ipcMain.handle('supabase:read-revisions', wrapIpc(async () => {
  return sbReadRevisions();
}));
ipcMain.handle('supabase:add-revision', wrapIpc(async (_e: unknown, id: string, partUuid: string, sceneId: string,
  revisionNo: number, status: string, priority: string, description: string, frameNo: string,
  imageUrl: string, department: string, requesterId: string, requesterName: string, assignee: string, createdAt: string) => {
  await sbAddRevision(id, partUuid, sceneId, revisionNo, status, priority, description, frameNo, imageUrl, department, requesterId, requesterName, assignee, createdAt);
}));
ipcMain.handle('supabase:update-revision', wrapIpc(async (_e: unknown, id: string, updates: Record<string, string>) => {
  await sbUpdateRevision(id, updates);
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
    onStatusChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('supabase:status', status);
      }
      for (const win of widgetWindows.values()) {
        if (!win.isDestroyed()) win.webContents.send('supabase:status', status);
      }
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
      return { ok: true, url: result.url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
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
  if (extra && Object.keys(extra).length > 0) {
    const qs = new URLSearchParams(extra).toString();
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
    if (!popupWin.isDestroyed() && initAOT) {
      popupWin.setAlwaysOnTop(true, 'normal');
    }
  });

  widgetWindows.set(widgetId, popupWin);

  // 캐시에 title 저장 (자동 재오픈용)
  const existingCache = widgetPositionCache.get(widgetId);
  if (existingCache) {
    existingCache.title = widgetTitle;
  } else {
    const b = popupWin.getBounds();
    widgetPositionCache.set(widgetId, {
      x: b.x, y: b.y, width: b.width, height: b.height,
      opacity: 1.0, alwaysOnTop: initAOT, title: widgetTitle,
    });
  }
  saveWidgetPositionsDebounced();

  popupWin.on('closed', () => {
    widgetWindows.delete(widgetId);
    widgetOriginalBounds.delete(widgetId);
    // 사용자가 명시적으로 닫으면 캐시 삭제 (자동 복원 안 함)
    // 앱 종료 중이면 캐시 유지 (before-quit에서 이미 저장됨)
    if (!isQuitting) {
      widgetPositionCache.delete(widgetId);
      saveWidgetPositionsDebounced();
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
    pendingDeepLink = url;
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
    if (deepLinkUrl) sendDeepLinkToRenderer(deepLinkUrl);

    // sendDeepLinkToRenderer가 이미 show/focus하지만, URL 없는 경우에도 창 활성화
    if (mainWindow && !deepLinkUrl) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
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

app.whenReady().then(() => {
  // 두 번째 인스턴스면 초기화하지 않고 종료
  if (!gotTheLock) return;

  // 위젯 위치 캐시 로드 (Phase 0-6)
  loadWidgetPositions();

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

  // Supabase Realtime 구독 시작
  startSupabaseRealtime();

  // 저장된 위젯 자동 복원 (Phase 0-6) + 보류 딥링크 전달
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      if (widgetPositionCache.size > 0) {
        for (const [widgetId, state] of widgetPositionCache) {
          const title = state.title || WIDGET_TITLE_MAP[widgetId] || widgetId;
          openWidgetPopup(widgetId, title);
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

  // Supabase Realtime 정리
  teardownRealtime();

  // 위젯 위치 즉시 저장 (closed 이벤트보다 먼저 실행)
  saveWidgetPositionsSync();

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

    // 시트 15초 + 휴가 60초 대기 후 종료
    Promise.all([
      waitForAllPendingOps(15000),
      waitForVacPendingOps(60000),
    ]).then(([sheetsDone, vacDone]) => {
      if (!sheetsDone || !vacDone) {
        console.warn('[종료] 타임아웃 — 일부 작업이 완료되지 않았을 수 있습니다');
      }
      console.log('[종료] 저장 완료, 앱을 종료합니다');
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  if (!isQuitting) {
    app.quit();
  }
});
