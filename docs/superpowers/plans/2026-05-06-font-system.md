# 글꼴 시스템 구현 계획 (v1.20.0)

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B flow에 사용자가 글꼴(서체)을 자유롭게 선택·추가할 수 있는 시스템 구축. 큐레이션 9종 + OTF/TTF 직접 추가(드래그앤드롭 포함) + 줄간격·자간 조절 + 숫자 자릿수 자동 정렬.

**Architecture:** CSS 변수(`--font-family`, `--text-line-height`, `--text-letter-spacing`)를 `applyFontFamily/applySpacing` 헬퍼로 갱신 → 즉시 DOM 반영. 사용자 폰트는 메인 프로세스가 `%APPDATA%/Bflow-BGonly/fonts/`로 복사 + opentype.js로 한글 검증, 렌더러는 `bflow-font://` custom protocol로 로드. Settings preferences.json에 `fontFamily / lineHeight / letterSpacing / customFonts[]` 추가.

**Tech Stack:** React 18 + TypeScript + Tailwind + Electron 33 + lucide-react (아이콘) + @fontsource (폰트 패키지) + opentype.js (메타 파싱) + uuid (커스텀 ID).

**Spec reference:** [`docs/superpowers/specs/2026-05-06-font-system-design.md`](../specs/2026-05-06-font-system-design.md)

---

## File Structure

### 신규 파일
- `src/components/settings/FontFamilySection.tsx` — 글꼴(서체) 선택 UI + 사용자 추가/삭제/DnD
- `src/components/settings/SpacingSection.tsx` — 줄간격·자간 슬라이더
- `electron/fontIpc.ts` — IPC 핸들러 + custom protocol 등록 헬퍼

### 변경 파일
- `src/utils/typography.ts` — `FONT_FAMILIES`, `applyFontFamily`, `applySpacing`, `applyPreferencesToDOM` 확장
- `src/services/settingsService.ts` — `UserPreferences` + `CustomFont` 타입 확장
- `src/index.css` — `--font-family / --text-line-height / --text-letter-spacing` CSS 변수 + `tabular-nums` 적용
- `src/main.tsx` 또는 `src/App.tsx` — 시작 시 `applyPreferencesToDOM` 호출에 폰트 필드 포함
- `src/views/SettingsView.tsx` 또는 그에 준하는 위치 — `font` 탭에 신규 섹션 추가
- `electron/main.ts` — IPC 핸들러 등록 + custom protocol 등록 호출
- `electron/preload.ts` — `fontAdd / fontAddByPath / fontDelete / fontList` 노출
- `package.json` — 의존성 9개 추가

---

## Chunk 1: 의존성 설치 + 타입/CSS 기반 작업

### Task 1.1: NPM 의존성 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 폰트 패키지 + 헬퍼 설치 (한 번에)**

```bash
npm install pretendard @fontsource/inter @fontsource/noto-sans-kr @fontsource/ibm-plex-sans-kr @fontsource/nanum-gothic @fontsource/gowun-dodum @fontsource/noto-serif-kr spoqa-han-sans opentype.js uuid
npm install --save-dev @types/uuid
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS (의존성만 설치, 코드 변경 X)

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore(font): 글꼴 시스템 의존성 설치"
```

---

### Task 1.2: typography.ts에 FontFamily / Spacing 타입 + 헬퍼 추가

**Files:**
- Modify: `src/utils/typography.ts`

- [ ] **Step 1: 타입 정의 추가** (파일 끝에)

```typescript
// ─── 글꼴 서체 (Font Family) ──────────────────

export interface CustomFont {
  id: string;                   // `custom:${uuid}`
  name: string;                 // 폰트 메타 이름
  filename: string;             // 디스크 저장된 실제 파일명
  format: 'otf' | 'ttf' | 'woff' | 'woff2';
  hasKorean: boolean;
  addedAt: string;              // ISO
}

export interface FontFamilyMeta {
  id: string;
  label: string;
  cssStack: string;
  group: 'modern' | 'soft' | 'serious' | 'character' | 'system';
}

export const FONT_FAMILIES: FontFamilyMeta[] = [
  { id: 'pretendard',    label: 'Pretendard',         cssStack: `'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'inter',         label: 'Inter',              cssStack: `Inter, 'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'noto-sans-kr',  label: 'Noto Sans KR',       cssStack: `'Noto Sans KR', system-ui, sans-serif`, group: 'modern' },
  { id: 'ibm-plex-kr',   label: 'IBM Plex Sans KR',   cssStack: `'IBM Plex Sans KR', system-ui, sans-serif`, group: 'serious' },
  { id: 'spoqa',         label: 'Spoqa Han Sans Neo', cssStack: `'Spoqa Han Sans Neo', system-ui, sans-serif`, group: 'serious' },
  { id: 'nanum-gothic',  label: '나눔고딕',           cssStack: `'Nanum Gothic', system-ui, sans-serif`, group: 'soft' },
  { id: 'gowun-dodum',   label: '고운 도담',          cssStack: `'Gowun Dodum', system-ui, sans-serif`, group: 'soft' },
  { id: 'noto-serif-kr', label: '본명조',             cssStack: `'Noto Serif KR', serif`, group: 'character' },
  { id: 'system',        label: '시스템 기본',        cssStack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, group: 'system' },
];

export const DEFAULT_FONT_FAMILY = 'pretendard';
const FALLBACK_STACK = `'Pretendard Variable', Pretendard, system-ui, sans-serif`;

// ─── Spacing (줄간격·자간) ─────────────────────

export const DEFAULT_LINE_HEIGHT = 1.55;
export const DEFAULT_LETTER_SPACING = 0;
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_STEP = 0.05;
export const LETTER_SPACING_MIN = -0.05;
export const LETTER_SPACING_MAX = 0.10;
export const LETTER_SPACING_STEP = 0.005;

// ─── DOM 적용 ────────────────────────────────

export function applyFontFamily(familyId: string, customFonts: CustomFont[] = []): void {
  const root = document.documentElement;
  let stack = FALLBACK_STACK;
  if (familyId.startsWith('custom:')) {
    const cf = customFonts.find((f) => f.id === familyId);
    if (cf) {
      injectCustomFontFace(cf);
      stack = `'${cf.name}', ${FALLBACK_STACK}`;
    }
  } else {
    const meta = FONT_FAMILIES.find((f) => f.id === familyId);
    if (meta) stack = meta.cssStack;
  }
  root.style.setProperty('--font-family', stack);
}

export function applySpacing(lineHeight: number, letterSpacing: number): void {
  const root = document.documentElement;
  root.style.setProperty('--text-line-height', String(lineHeight));
  root.style.setProperty('--text-letter-spacing', `${letterSpacing}em`);
}

function injectCustomFontFace(font: CustomFont): void {
  if (document.querySelector(`style[data-font-id="${font.id}"]`)) return;
  const formatHint = { otf: 'opentype', ttf: 'truetype', woff: 'woff', woff2: 'woff2' }[font.format];
  const url = `bflow-font://${encodeURIComponent(font.filename)}`;
  const style = document.createElement('style');
  style.setAttribute('data-font-id', font.id);
  style.textContent = `@font-face { font-family: '${font.name}'; src: url('${url}') format('${formatHint}'); font-display: swap; }`;
  document.head.appendChild(style);
}

export function ensureCustomFontsLoaded(customFonts: CustomFont[]): void {
  customFonts.forEach(injectCustomFontFace);
}
```

- [ ] **Step 2: applyPreferencesToDOM 확장** (기존 함수 시그니처에 새 필드 추가)

기존 함수의 prefs 타입에 다음 필드 추가:
```typescript
fontFamily?: string;
lineHeight?: number;
letterSpacing?: number;
customFonts?: CustomFont[];
```

함수 본문 끝에 추가:
```typescript
ensureCustomFontsLoaded(prefs.customFonts ?? []);
applyFontFamily(prefs.fontFamily ?? DEFAULT_FONT_FAMILY, prefs.customFonts ?? []);
applySpacing(
  prefs.lineHeight ?? DEFAULT_LINE_HEIGHT,
  prefs.letterSpacing ?? DEFAULT_LETTER_SPACING,
);
```

- [ ] **Step 3: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/utils/typography.ts
git commit -m "feat(font): typography에 FontFamily/Spacing 타입 + 헬퍼 추가"
```

---

### Task 1.3: UserPreferences 타입 확장

**Files:**
- Modify: `src/services/settingsService.ts` (또는 UserPreferences 정의 위치)

- [ ] **Step 1: 위치 확인**

```bash
grep -rn "interface UserPreferences" src/
```

- [ ] **Step 2: UserPreferences interface에 신규 필드 추가**

```typescript
import type { CustomFont } from '@/utils/typography';

export interface UserPreferences {
  // ... 기존
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  customFonts?: CustomFont[];
}
```

- [ ] **Step 3: 타입 체크 + 커밋**

```bash
npx tsc --noEmit
git add src/services/settingsService.ts
git commit -m "feat(font): UserPreferences에 fontFamily/spacing/customFonts 필드 추가"
```

---

### Task 1.4: index.css에 CSS 변수 + 폰트 import + tabular-nums

**Files:**
- Modify: `src/index.css`
- Modify: `src/main.tsx` (폰트 import 위치에 따라)

- [ ] **Step 1: 폰트 CSS import** (`src/main.tsx` 최상단 또는 `src/index.css` 시작 부분)

```typescript
// src/main.tsx 상단
import 'pretendard/dist/web/static/pretendard.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
import '@fontsource/nanum-gothic/400.css';
import '@fontsource/nanum-gothic/700.css';
import '@fontsource/gowun-dodum/400.css';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/500.css';
import '@fontsource/noto-serif-kr/700.css';
import 'spoqa-han-sans/css/SpoqaHanSansNeo.css';
```

- [ ] **Step 2: index.css에 CSS 변수 추가** (기존 `:root` 블록 안에)

```css
:root {
  /* ... 기존 변수들 */

  /* 글꼴 시스템 (v1.20.0) */
  --font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif;
  --text-line-height: 1.55;
  --text-letter-spacing: 0em;
}

/* @layer base 안에 추가 */
@layer base {
  html, body {
    font-family: var(--font-family);
    line-height: var(--text-line-height);
    letter-spacing: var(--text-letter-spacing);
  }
}

/* tabular-nums 글로벌 — 숫자 영역에 자동 적용 */
[data-numeric],
.tabular,
.font-mono {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: 빌드 + 시각 확인**

```bash
npm run build:vite
```
Expected: PASS, dist 폴더 정상 생성

- [ ] **Step 4: 커밋**

```bash
git add src/main.tsx src/index.css
git commit -m "feat(font): 폰트 패키지 import + CSS 변수 + tabular-nums 글로벌"
```

---

## Chunk 2: 메인 프로세스 IPC + Custom Protocol

### Task 2.1: electron/fontIpc.ts 신규 작성

**Files:**
- Create: `electron/fontIpc.ts`

- [ ] **Step 1: 파일 생성** — 전체 코드:

```typescript
import { app, dialog, ipcMain, protocol, net } from 'electron';
import { promises as fsp, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import opentype from 'opentype.js';
import type { CustomFont } from '../src/utils/typography';

const FONT_DIR = path.join(app.getPath('userData'), 'fonts');
const KOREAN_SAMPLE = ['가', '나', '다', '한', '글', '안', '녕', '스', '튜', '디', '오'];
const SUPPORTED_EXT = ['.otf', '.ttf', '.woff', '.woff2'] as const;

export function ensureFontDir(): void {
  if (!existsSync(FONT_DIR)) mkdirSync(FONT_DIR, { recursive: true });
}

/** Electron app:ready 이전에 호출 필요 */
export function registerFontProtocolPriv(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'bflow-font', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Electron app:ready 이후 호출 */
export function registerFontProtocol(): void {
  ensureFontDir();
  protocol.handle('bflow-font', (request) => {
    const url = new URL(request.url);
    const filename = decodeURIComponent(url.hostname + url.pathname);
    const safe = path.basename(filename); // path traversal 방지
    const filePath = path.join(FONT_DIR, safe);
    if (!filePath.startsWith(FONT_DIR)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

async function addFontFromPath(srcPath: string): Promise<CustomFont | { error: string }> {
  const ext = path.extname(srcPath).toLowerCase() as typeof SUPPORTED_EXT[number];
  if (!SUPPORTED_EXT.includes(ext)) {
    return { error: `지원하지 않는 형식: ${ext}` };
  }
  let font: opentype.Font;
  try {
    font = await opentype.load(srcPath);
  } catch (e) {
    return { error: `폰트 파일 파싱 실패: ${(e as Error).message}` };
  }
  const name = font.names.fontFamily?.en || font.names.fullName?.en || path.basename(srcPath, ext);
  const hasKorean = KOREAN_SAMPLE.every((c) => {
    const g = font.charToGlyph(c);
    return !!g && g.unicode === c.charCodeAt(0);
  });
  const id = `custom:${uuidv4()}`;
  const filename = `${id.replace(/[^a-z0-9-]/gi, '_')}${ext}`;
  await fsp.copyFile(srcPath, path.join(FONT_DIR, filename));
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
  ipcMain.handle('font:add', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Font Files', extensions: ['otf', 'ttf', 'woff', 'woff2'] }],
      title: '글꼴 파일 선택',
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(addFontFromPath));
  });

  ipcMain.handle('font:add-by-path', async (_e, filePaths: string[]) => {
    return Promise.all(filePaths.map(addFontFromPath));
  });

  ipcMain.handle('font:delete', async (_e, font: CustomFont) => {
    try {
      await fsp.unlink(path.join(FONT_DIR, font.filename));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/fontIpc.ts
git commit -m "feat(font): 사용자 폰트 IPC + bflow-font:// custom protocol"
```

---

### Task 2.2: electron/main.ts에 IPC + 프로토콜 통합

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: import 추가**

```typescript
import { registerFontProtocolPriv, registerFontProtocol, registerFontIpcHandlers } from './fontIpc';
```

- [ ] **Step 2: app.whenReady() 호출 전에**

```typescript
registerFontProtocolPriv();
```
※ `registerSchemesAsPrivileged`는 ready 이전에 호출되어야 함.

- [ ] **Step 3: app.whenReady() 콜백 안에**

```typescript
registerFontProtocol();
registerFontIpcHandlers();
```

- [ ] **Step 4: 빌드 + Electron 실행 검증**

```bash
npm run build:vite
```

- [ ] **Step 5: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(font): main.ts에 IPC/프로토콜 등록"
```

---

### Task 2.3: preload.ts에 API 노출

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: contextBridge에 추가**

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 기존
  fontAdd: () => ipcRenderer.invoke('font:add'),
  fontAddByPath: (paths: string[]) => ipcRenderer.invoke('font:add-by-path', paths),
  fontDelete: (font: any) => ipcRenderer.invoke('font:delete', font),
});
```

- [ ] **Step 2: src/types에서 electronAPI 타입에 동일 메서드 추가** (있는 경우)

```bash
grep -rn "interface ElectronAPI" src/types/
```
해당 위치에 추가.

- [ ] **Step 3: 타입 체크 + 커밋**

```bash
npx tsc --noEmit
git add electron/preload.ts src/types/
git commit -m "feat(font): preload에 fontAdd/Delete API 노출"
```

---

## Chunk 3: 렌더러 컴포넌트

### Task 3.1: FontFamilySection 신규 작성

**Files:**
- Create: `src/components/settings/FontFamilySection.tsx`

- [ ] **Step 1: 컴포넌트 작성** (목업 구조 그대로 React 컴포넌트화)

```tsx
import { useState, useCallback } from 'react';
import { CaseSensitive, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  FONT_FAMILIES,
  DEFAULT_FONT_FAMILY,
  applyFontFamily,
  type CustomFont,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';

interface Props {
  fontFamily: string;
  customFonts: CustomFont[];
  onChange: (familyId: string, customFonts: CustomFont[]) => void;
}

export function FontFamilySection({ fontFamily, customFonts, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const persistAndApply = useCallback(async (familyId: string, nextCustomFonts: CustomFont[]) => {
    applyFontFamily(familyId, nextCustomFonts);
    onChange(familyId, nextCustomFonts);
    const prev = (await loadPreferences()) ?? {};
    await savePreferences({ ...prev, fontFamily: familyId, customFonts: nextCustomFonts });
    window.electronAPI?.preferencesBroadcastChange?.({ fontFamily: familyId, customFonts: nextCustomFonts });
  }, [onChange]);

  const handleSelect = useCallback((id: string) => {
    persistAndApply(id, customFonts);
  }, [customFonts, persistAndApply]);

  const handleAddViaButton = useCallback(async () => {
    setBusy(true);
    try {
      const results = await window.electronAPI!.fontAdd();
      processAddResults(results);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f: any) => f.path).filter(Boolean);
    if (paths.length === 0) return;
    setBusy(true);
    try {
      const results = await window.electronAPI!.fontAddByPath(paths);
      processAddResults(results);
    } finally {
      setBusy(false);
    }
  }, []);

  const processAddResults = useCallback((results: any[]) => {
    const added: CustomFont[] = [];
    for (const r of results) {
      if (!r) continue;
      if ('error' in r) {
        toast.error(`폰트 추가 실패: ${r.error}`);
      } else {
        added.push(r as CustomFont);
        if (!(r as CustomFont).hasKorean) {
          toast.warning(`"${(r as CustomFont).name}"은(는) 한글 글리프가 없어 영문/숫자만 표시됩니다.`);
        }
      }
    }
    if (added.length > 0) {
      const next = [...customFonts, ...added];
      persistAndApply(fontFamily, next);
      toast.success(`${added.length}개 폰트 추가됨`);
    }
  }, [customFonts, fontFamily, persistAndApply]);

  const handleDelete = useCallback(async (font: CustomFont) => {
    if (!confirm(`"${font.name}" 글꼴을 삭제하시겠습니까?`)) return;
    await window.electronAPI!.fontDelete(font);
    const next = customFonts.filter((f) => f.id !== font.id);
    const fallbackId = fontFamily === font.id ? DEFAULT_FONT_FAMILY : fontFamily;
    persistAndApply(fallbackId, next);
  }, [customFonts, fontFamily, persistAndApply]);

  return (
    <SettingsSection
      icon={<CaseSensitive size={18} className="text-accent" />}
      title="글꼴 (서체)"
    >
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'transition-all rounded-lg',
          dragging && 'ring-2 ring-accent ring-offset-2 ring-offset-bg-card bg-accent/5',
        )}
      >
        <p className="text-xs text-text-secondary mb-2">기본 글꼴</p>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {FONT_FAMILIES.map((meta) => (
            <button
              key={meta.id}
              onClick={() => handleSelect(meta.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-all cursor-pointer',
                fontFamily === meta.id
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'border-bg-border text-text-primary hover:bg-bg-border/30',
              )}
              style={{ fontFamily: meta.cssStack }}
            >
              {meta.label}
            </button>
          ))}
        </div>

        {customFonts.length > 0 && (
          <>
            <p className="text-xs text-text-secondary mb-2">내 글꼴</p>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {customFonts.map((font) => {
                const active = fontFamily === font.id;
                return (
                  <span
                    key={font.id}
                    className={cn(
                      'inline-flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-md text-xs font-medium border transition-all',
                      active ? 'bg-accent/15 border-accent text-accent' : 'border-bg-border text-text-primary',
                    )}
                  >
                    <button
                      onClick={() => handleSelect(font.id)}
                      className="cursor-pointer"
                      style={{ fontFamily: `'${font.name}', system-ui, sans-serif` }}
                    >
                      {font.name}
                    </button>
                    <button
                      onClick={() => handleDelete(font)}
                      className="w-5 h-5 inline-flex items-center justify-center rounded text-text-tertiary hover:bg-red-500/15 hover:text-red-400 cursor-pointer"
                      title="삭제"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          </>
        )}

        <button
          onClick={handleAddViaButton}
          disabled={busy}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-dashed transition-all cursor-pointer',
            'border-bg-border text-accent-sub hover:border-accent hover:bg-accent/8 hover:border-solid',
            busy && 'opacity-50 cursor-wait',
          )}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          글꼴 추가
        </button>

        <p className="mt-3 text-[10px] text-text-secondary/60 flex items-start gap-1.5">
          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
          <span>추가하시는 글꼴의 라이선스는 본인이 확인해주세요. 추가된 글꼴은 본인 PC에만 저장됩니다 (다른 팀원에게는 안 보임).</span>
        </p>
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/components/settings/FontFamilySection.tsx
git commit -m "feat(font): FontFamilySection 컴포넌트 (선택+추가+DnD+삭제)"
```

---

### Task 3.2: SpacingSection 신규 작성

**Files:**
- Create: `src/components/settings/SpacingSection.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
import { useCallback } from 'react';
import { AlignVerticalSpaceAround, RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { SettingsSection } from './SettingsSection';
import {
  applySpacing,
  DEFAULT_LINE_HEIGHT, DEFAULT_LETTER_SPACING,
  LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, LINE_HEIGHT_STEP,
  LETTER_SPACING_MIN, LETTER_SPACING_MAX, LETTER_SPACING_STEP,
} from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';

interface Props {
  lineHeight: number;
  letterSpacing: number;
  onChange: (lineHeight: number, letterSpacing: number) => void;
}

export function SpacingSection({ lineHeight, letterSpacing, onChange }: Props) {
  const persist = useCallback(async (lh: number, ls: number) => {
    applySpacing(lh, ls);
    onChange(lh, ls);
    const prev = (await loadPreferences()) ?? {};
    await savePreferences({ ...prev, lineHeight: lh, letterSpacing: ls });
    window.electronAPI?.preferencesBroadcastChange?.({ lineHeight: lh, letterSpacing: ls });
  }, [onChange]);

  const handleReset = useCallback(() => {
    persist(DEFAULT_LINE_HEIGHT, DEFAULT_LETTER_SPACING);
  }, [persist]);

  const isCustom = lineHeight !== DEFAULT_LINE_HEIGHT || letterSpacing !== DEFAULT_LETTER_SPACING;

  return (
    <SettingsSection
      icon={<AlignVerticalSpaceAround size={18} className="text-accent" />}
      title="간격"
      action={
        isCustom && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-border/30 cursor-pointer"
          >
            <RotateCcw size={12} />
            기본값 복원
          </button>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium">줄간격</span>
          <input
            type="range"
            min={LINE_HEIGHT_MIN} max={LINE_HEIGHT_MAX} step={LINE_HEIGHT_STEP}
            value={lineHeight}
            onChange={(e) => persist(parseFloat(e.target.value), letterSpacing)}
            className="flex-1 h-1.5 cursor-pointer"
          />
          <span className={cn(
            'w-12 text-right text-xs font-mono tabular-nums',
            lineHeight === DEFAULT_LINE_HEIGHT ? 'text-text-secondary/50' : 'text-accent',
          )}>
            {lineHeight.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium">자간</span>
          <input
            type="range"
            min={LETTER_SPACING_MIN} max={LETTER_SPACING_MAX} step={LETTER_SPACING_STEP}
            value={letterSpacing}
            onChange={(e) => persist(lineHeight, parseFloat(e.target.value))}
            className="flex-1 h-1.5 cursor-pointer"
          />
          <span className={cn(
            'w-12 text-right text-xs font-mono tabular-nums',
            letterSpacing === DEFAULT_LETTER_SPACING ? 'text-text-secondary/50' : 'text-accent',
          )}>
            {letterSpacing.toFixed(3)}
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 2: 타입 체크 + 커밋**

```bash
npx tsc --noEmit
git add src/components/settings/SpacingSection.tsx
git commit -m "feat(font): SpacingSection 컴포넌트 (줄간격/자간 슬라이더)"
```

---

## Chunk 4: 통합 + 검증

### Task 4.1: SettingsView에 신규 섹션 통합

**Files:**
- Modify: `src/views/SettingsView.tsx` (또는 활성 탭 분기 위치)

- [ ] **Step 1: 위치 확인**

```bash
grep -rn "FontSizeSection" src/
```

- [ ] **Step 2: import 추가**

```typescript
import { FontFamilySection } from '@/components/settings/FontFamilySection';
import { SpacingSection } from '@/components/settings/SpacingSection';
```

- [ ] **Step 3: font 탭 분기 안에 통합**

```tsx
{activeTab === 'font' && (
  <>
    <FontFamilySection
      fontFamily={fontFamily}
      customFonts={customFonts}
      onChange={(id, customs) => { setFontFamily(id); setCustomFonts(customs); }}
    />
    <FontSizeSection {...기존 props} />
    <FontColorSection />
    <SpacingSection
      lineHeight={lineHeight}
      letterSpacing={letterSpacing}
      onChange={(lh, ls) => { setLineHeight(lh); setLetterSpacing(ls); }}
    />
  </>
)}
```

- [ ] **Step 4: 상태 관리** — useAppStore (Zustand) 또는 SettingsView 로컬 state로 fontFamily/customFonts/lineHeight/letterSpacing 초기 로드. 기존 패턴(themeId 등)을 그대로 따라간다.

- [ ] **Step 5: 타입 체크 + 빌드 + 커밋**

```bash
npx tsc --noEmit
npm run build:vite
git add src/views/SettingsView.tsx src/stores/useAppStore.ts
git commit -m "feat(font): 글꼴 탭에 FontFamilySection/SpacingSection 통합"
```

---

### Task 4.2: App.tsx 시작 흐름에 폰트 적용

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 시작 시 preferences hydrate 위치 확인**

```bash
grep -n "applyPreferencesToDOM\|loadPreferences" src/App.tsx src/main.tsx
```

- [ ] **Step 2: applyPreferencesToDOM 호출이 이미 있다면, 신규 필드도 자동 적용됨** (Task 1.2에서 확장 완료). 없다면 hydrate 직후 호출 추가.

- [ ] **Step 3: 다른 창(플로팅 위젯) preferencesBroadcastChange 수신 핸들러도 같은 헬퍼 사용** — 검증.

- [ ] **Step 4: 빌드 + 커밋**

```bash
npm run build:vite
git add src/App.tsx
git commit -m "feat(font): App 시작 시 글꼴 prefs 자동 적용"
```

---

### Task 4.3: 빌드 + 수동 검증

- [ ] **Step 1: 풀 빌드**

```bash
npm run build:vite
```
Expected: PASS

- [ ] **Step 2: Electron 실행 + 수동 체크리스트**

```bash
npm run electron:dev
```

체크:
- [ ] 첫 실행 시 Pretendard 자동 적용
- [ ] 9개 기본 글꼴 칩 클릭 시 즉시 적용
- [ ] 다른 창(플로팅 위젯)도 같이 변경
- [ ] 줄간격 슬라이더 동작 (메모/댓글 영역에 변화 보임)
- [ ] 자간 슬라이더 동작
- [ ] "기본값 복원" 동작
- [ ] `+ 글꼴 추가` 클릭 → 탐색기 열림 → OTF 선택 → 칩 등장 → 클릭 시 적용
- [ ] 드래그앤드롭 → 동일하게 추가
- [ ] 한글 미지원 폰트 (예: Inter.otf) → 토스트 경고
- [ ] 휴지통 → 삭제 + 적용 중이던 폰트라면 Pretendard로 폴백
- [ ] 앱 재시작 → 마지막 선택 폰트 유지
- [ ] 위젯 숫자가 자릿수 일자로 정렬 (대시보드 % 확인)

- [ ] **Step 3: 발견된 버그 수정 후 커밋** (있는 경우만)

---

### Task 4.4: 버전 bump + PR

- [ ] **Step 1: package.json version → 1.20.0**

- [ ] **Step 2: 최종 커밋**

```bash
git add package.json
git commit -m "chore(release): v1.20.0 — 글꼴 시스템"
```

- [ ] **Step 3: 푸시 + PR 생성** (pr-creator 스킬 활용)

```bash
git push -u origin claude/crazy-goldberg-b4d4eb
```
PR 본문 — 비개발자 이해 가능한 업데이트 로그 + 상세 기술 설명 + 테스트 가이드 (한솔님 기존 PR 패턴 그대로).

---

## 완료 기준

- ✅ 9개 기본 글꼴 즉시 적용
- ✅ 사용자 OTF/TTF/WOFF/WOFF2 추가 (탐색기 + DnD)
- ✅ 한글 글리프 자동 검증 + 경고 토스트
- ✅ 줄간격·자간 슬라이더 즉시 반영
- ✅ 위젯 숫자 자릿수 자동 정렬
- ✅ 다른 창 동기화
- ✅ 앱 재시작 시 설정 유지
- ✅ tsc --noEmit + vite build 통과
- ✅ Pretendard 기본값 자동 적용
- ✅ PR 생성

---

*Plan 끝. 실행은 위에서 아래로 순차 진행. 각 task 종료 후 커밋. 빌드 깨지면 즉시 fix.*
