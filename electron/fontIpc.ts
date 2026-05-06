/**
 * v1.20.0: 사용자 폰트 IPC + custom protocol
 *
 * - `font:add` — dialog로 OTF/TTF/WOFF/WOFF2 선택 → %APPDATA%/<app>/fonts/ 복사
 * - `font:add-by-path` — 드래그앤드롭에서 호출 (filePaths 배열)
 * - `font:delete` — 파일 삭제
 * - `bflow-font://<filename>` — 렌더러가 @font-face src로 사용할 custom protocol
 *
 * 한글 글리프 검증: opentype.js로 'KOREAN_SAMPLE' 음절을 모두 매핑할 수 있는지 확인.
 * Path traversal 방지: filename은 path.basename으로만 사용, FONT_DIR 밖은 차단.
 */
import { app, dialog, ipcMain, protocol, net } from 'electron';
import { promises as fsp, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';
// opentype.js는 default export가 없어 namespace import 사용
import * as opentype from 'opentype.js';

interface CustomFont {
  id: string;
  name: string;
  filename: string;
  format: 'otf' | 'ttf' | 'woff' | 'woff2';
  hasKorean: boolean;
  addedAt: string;
}

const KOREAN_SAMPLE = ['가', '나', '다', '한', '글', '안', '녕', '스', '튜', '디', '오'];
const SUPPORTED_EXT = ['.otf', '.ttf', '.woff', '.woff2'] as const;

function fontDir(): string {
  return path.join(app.getPath('userData'), 'fonts');
}

function ensureFontDir(): void {
  const dir = fontDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Electron app:ready 이전에 호출 필수. main.ts의 protocol.registerSchemesAsPrivileged 배열에
 * 통합되어야 하는데, 이미 main.ts에서 bflow-img/drive-img를 등록하고 있어 그 옆에 추가.
 * 이 함수는 단독 호출용 (다른 진입점용).
 */
export function registerFontProtocolPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'bflow-font',
      privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** Electron app:ready 이후 호출. */
export function registerFontProtocol(): void {
  ensureFontDir();
  const dir = fontDir();
  protocol.handle('bflow-font', async (request) => {
    try {
      const url = new URL(request.url);
      // bflow-font://<filename> — hostname에 파일명, pathname은 보통 빈 문자열 or '/'
      const raw = decodeURIComponent(url.hostname + url.pathname).replace(/\/+$/, '');
      const safe = path.basename(raw); // path traversal 방지
      const filePath = path.join(dir, safe);
      // 추가 안전 체크: 정규화된 경로가 fontDir 안에 있는지
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(dir))) {
        return new Response('forbidden', { status: 403 });
      }
      if (!existsSync(resolved)) {
        return new Response('not-found', { status: 404 });
      }
      return net.fetch(pathToFileURL(resolved).toString());
    } catch (e) {
      return new Response('error: ' + (e as Error).message, { status: 500 });
    }
  });
}

/**
 * 단일 폰트 파일을 fontDir에 복사하고 메타데이터 추출.
 * 실패 시 { error: ... } 반환 (throw 안 함 — 다중 추가 시 일부 성공/실패 허용).
 */
async function addFontFromPath(srcPath: string): Promise<CustomFont | { error: string }> {
  const ext = path.extname(srcPath).toLowerCase();
  if (!(SUPPORTED_EXT as readonly string[]).includes(ext)) {
    return { error: `지원하지 않는 형식: ${ext || '(확장자 없음)'}` };
  }

  let font: opentype.Font;
  try {
    font = await opentype.load(srcPath);
  } catch (e) {
    return { error: `폰트 파일 파싱 실패: ${(e as Error).message}` };
  }

  const name =
    font.names.fontFamily?.en
    || font.names.fullName?.en
    || font.names.preferredFamily?.en
    || path.basename(srcPath, ext);

  const hasKorean = KOREAN_SAMPLE.every((c) => {
    const g = font.charToGlyph(c);
    // .notdef 글리프(인덱스 0)이면 미지원
    return g && g.index !== 0;
  });

  const id = `custom:${uuidv4()}`;
  const safeId = id.replace(/[^a-z0-9-]/gi, '_');
  const filename = `${safeId}${ext}`;
  const dir = fontDir();
  ensureFontDir();
  await fsp.copyFile(srcPath, path.join(dir, filename));

  return {
    id,
    name,
    filename,
    format: ext.slice(1) as CustomFont['format'],
    hasKorean,
    addedAt: new Date().toISOString(),
  };
}

export function registerFontIpcHandlers(): void {
  // 1. 파일 선택 다이얼로그 → 추가
  ipcMain.handle('font:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Font Files', extensions: ['otf', 'ttf', 'woff', 'woff2'] }],
      title: '글꼴 파일 선택',
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return Promise.all(result.filePaths.map(addFontFromPath));
  });

  // 2. 드래그앤드롭에서 호출 (filePaths 배열)
  ipcMain.handle('font:add-by-path', async (_e, filePaths: string[]) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
    return Promise.all(filePaths.map(addFontFromPath));
  });

  // 3. 삭제 — { id, filename } 받음
  ipcMain.handle('font:delete', async (_e, font: { id: string; filename: string }) => {
    try {
      const dir = fontDir();
      const safe = path.basename(font.filename);
      const filePath = path.join(dir, safe);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(dir))) {
        return { ok: false, error: 'forbidden path' };
      }
      if (existsSync(resolved)) {
        await fsp.unlink(resolved);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
