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
// Codex 7차 P1: uuid@14는 ESM-only → CJS Electron main 번들에서 require 시 ERR_REQUIRE_ESM
// production 빌드 시 fontIpc 로드 시점에 main 프로세스 크래시 가능. Node 빌트인 randomUUID로 전환.
import { randomUUID } from 'crypto';
// opentype.js는 default export가 없어 namespace import 사용
import * as opentype from 'opentype.js';
// WOFF2는 Brotli 압축 → opentype.js가 직접 파싱 못 함. wawoff2가 WASM으로 TTF로 디컴프레션해줌.
// (Codex 2차 P2 — 광고는 woff2 지원이지만 디컴프레션 누락으로 항상 실패하던 문제 수정)
// CJS 패키지 + 타입 정의 없음 → require로 로드.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wawoff2: { decompress(buf: Buffer | Uint8Array): Promise<Uint8Array> } = require('wawoff2');

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
 *
 * v1.20.x: 한솔님 보고 — `font.names` undefined로 TypeError 발생하던 문제 수정.
 *   - `opentype.load` 대신 `fsp.readFile + opentype.parse`로 통일 (load는 nodejs 경로 인코딩 이슈 사례 있음)
 *   - font/font.names null guard
 *   - charToGlyph 호출도 try/catch로 보호 → names/cmap 누락된 비표준 폰트도 graceful 처리
 *   - 메타 누락 시 파일명 fallback + hasKorean=false 보수적 가정
 */
async function addFontFromPath(srcPath: string): Promise<CustomFont | { error: string }> {
  const ext = path.extname(srcPath).toLowerCase();
  if (!(SUPPORTED_EXT as readonly string[]).includes(ext)) {
    return { error: `지원하지 않는 형식: ${ext || '(확장자 없음)'}` };
  }

  // 모든 형식을 fsp.readFile → ArrayBuffer → opentype.parse 한 흐름으로 통일.
  let arrayBuf: ArrayBuffer;
  try {
    const buf = await fsp.readFile(srcPath);
    if (ext === '.woff2') {
      // wawoff2.decompress: WOFF2(Brotli) → TTF Uint8Array
      const ttfBytes = await wawoff2.decompress(buf);
      arrayBuf = ttfBytes.buffer.slice(
        ttfBytes.byteOffset,
        ttfBytes.byteOffset + ttfBytes.byteLength,
      ) as ArrayBuffer;
    } else {
      arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }
  } catch (e) {
    return { error: `폰트 파일 읽기 실패: ${(e as Error).message}` };
  }

  let font: opentype.Font | null = null;
  try {
    font = opentype.parse(arrayBuf);
  } catch (e) {
    return { error: `폰트 파일 파싱 실패: ${(e as Error).message}` };
  }
  if (!font) {
    return { error: '폰트 파일을 읽을 수 없습니다 (parse 결과 비정상).' };
  }

  // names가 undefined / 비어있을 수 있는 비표준 폰트 graceful 처리
  const namesObj = (font.names ?? {}) as {
    fontFamily?: { en?: string };
    fullName?: { en?: string };
    preferredFamily?: { en?: string };
  };
  const fallbackName = path.basename(srcPath, ext);
  const name =
    namesObj.fontFamily?.en
    || namesObj.fullName?.en
    || namesObj.preferredFamily?.en
    || fallbackName;

  // charToGlyph 호출도 보호 — cmap 테이블 누락된 폰트는 throw 함
  let hasKorean = false;
  try {
    hasKorean = KOREAN_SAMPLE.every((c) => {
      const g = font!.charToGlyph(c);
      return !!g && g.index !== 0;
    });
  } catch {
    hasKorean = false; // 검증 실패 시 보수적으로 false → 사용자에게 영문/숫자만 경고
  }

  const id = `custom:${randomUUID()}`;
  const safeId = id.replace(/[^a-z0-9-]/gi, '_');
  const filename = `${safeId}${ext}`;
  const dir = fontDir();
  ensureFontDir();
  // Codex 5차 P2: copyFile이 try/catch 밖이면 한 파일 실패 시 Promise.all 전체 배치가 reject됨.
  // 이 함수는 { error } 반환으로 partial success를 허용하기로 설계됐으니 copyFile도 보호.
  try {
    await fsp.copyFile(srcPath, path.join(dir, filename));
  } catch (e) {
    return { error: `폰트 파일 복사 실패: ${(e as Error).message}` };
  }

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
