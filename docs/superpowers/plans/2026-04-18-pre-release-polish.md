# 정식 빌드 전 마감 4종 — 구현 플랜

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정식 빌드 전에 트레이 아이콘 미구현·위젯 위치 기억 누락·빌드 실행 로딩 체감 지연·커스텀 테마 일부만 변경되는 4가지 이슈를 해결한다.

**Architecture:**
1. **Electron 메인 프로세스**에 트레이 아이콘 + 메인 창 close 차단 + 스플래시 2단계 부팅을 추가하고, 기존 `widgetPositionCache` 삭제 로직을 제거해 위젯 상태를 항상 보존한다.
2. **렌더러 번들**은 Vite `manualChunks`로 vendor를 분리하고 `React.lazy`로 뷰/모달을 지연 로딩한다.
3. **테마 시스템**은 `themes.ts`에 `deriveThemeFromAccent()`를 추가해 accent hex 두 개로 HSL 파생된 완전한 새 테마를 생성하고, `useAppStore`가 colorMode 변경 시 자동 재파생한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5, Vite 5, Zustand 4, Tailwind CSS 3. 테스트 프레임워크 없음 — 검증은 `tsc --noEmit` + `vite build` 통과 + 수동 체크리스트.

**Spec:** [docs/superpowers/specs/2026-04-18-pre-release-polish-design.md](../specs/2026-04-18-pre-release-polish-design.md)

---

## File Structure

### 변경할 파일 (수정)

| 파일 | 책임 |
|---|---|
| [electron/main.ts](../../../electron/main.ts) | 트레이 아이콘·메뉴·상태 갱신, close 핸들러, 스플래시 2단계 부팅, 위젯 캐시 삭제 로직 제거, window-all-closed 변경, app.whenReady 재정렬, 커맨드라인 스위치 |
| [package.json](../../../package.json) | `build.files`에 `public/splash/**` 추가 |
| [vite.config.ts](../../../vite.config.ts) | `build.rollupOptions.output.manualChunks` 추가 |
| [src/App.tsx](../../../src/App.tsx) | 뷰 `React.lazy` 래핑 + `Suspense`, 무거운 모달 lazy |
| [src/themes.ts](../../../src/themes.ts) | `rgbToHsl`/`hslToRgb`/`deriveThemeFromAccent` 함수 추가 |
| [src/stores/useAppStore.ts](../../../src/stores/useAppStore.ts) | `customAccentHex`·`customSubHex` 상태/액션, `setColorMode` 재파생 로직, `sanitizeCustomHex` 마이그레이션 |
| [src/components/settings/ThemeSection.tsx](../../../src/components/settings/ThemeSection.tsx) | `handleCustomApply` 교체, 실시간 배경 프리뷰 |
| [src/services/settingsService.ts](../../../src/services/settingsService.ts) | `preferences.json` 타입에 신규 필드 추가 |

### 신규 파일

| 파일 | 책임 |
|---|---|
| `public/splash/splash.html` | Electron 레벨의 즉시-표시 스플래시 (인라인 CSS, `opening_image_cropped.png` 표시) |

---

## Chunk 1: 트레이 아이콘 + 위젯 영속화

**목표**: Electron 메인 프로세스에 Windows 시스템 트레이를 구현하고, 앱의 유일한 GUI 종료 경로를 트레이 메뉴 '종료'로 일원화. 위젯 위치 캐시 삭제 로직을 제거해 "모든 위젯은 항상 복원" 정책을 반영.

**커밋 단위**: 각 Task 완료 후 독립 커밋. 중간에 `tsc --noEmit` 실패하면 즉시 수정 후 진행.

---

### Task 1.1: Electron import + 전역 변수 추가

**Files:**
- Modify: `electron/main.ts:1` (import 라인)
- Modify: `electron/main.ts:49-53` (전역 변수 블록)

- [ ] **Step 1: import 구문에 `Tray`, `Menu`, `nativeImage`, `dialog` 추가**

기존 `electron/main.ts:1`:
```typescript
import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen, shell, Notification } from 'electron';
```

변경:
```typescript
import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen, shell, Notification, Tray, Menu, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
```

**주의**: `dialog`는 Chunk 2 Task 2.4에서 도입 (타임아웃 에러박스 용). Chunk 1에서는 import하지 않음.

- [ ] **Step 2: 전역 변수 블록에 트레이·상태 플래그 추가**

기존 `electron/main.ts:49-53` 아래에 추가:
```typescript
let tray: Tray | null = null;
let trayFailed = false;
let lastSupabaseStatus = '연결 중...';
let splashWin: BrowserWindow | null = null;
let mainLoadedOk = false;
```

- [ ] **Step 3: tsc 검증**

```bash
cd /c/Bflow-BGonly/.claude/worktrees/ecstatic-lumiere-42f79a && npx tsc --noEmit
```

기대: 0 errors (새 import는 아직 사용 안 됨 — TS는 sideeffect 경고만. 안전)

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "chore(electron): 트레이/다이얼로그/스플래시용 import 및 전역 변수 추가"
```

---

### Task 1.2: 트레이 아이콘 경로 해석 + 1x1 폴백 이미지 유틸

**Files:**
- Modify: `electron/main.ts` (Task 1.1 블록 바로 다음 줄)

- [ ] **Step 1: `resolveTrayIconPath()` + `EMPTY_ICON_B64` 상수 추가**

`electron/main.ts`에서 Task 1.1에서 추가한 전역 변수(`let mainLoadedOk = false;`) 바로 다음 줄에 삽입:

```typescript
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

/** 1x1 투명 PNG — 아이콘 로드 완전 실패 시 최후 폴백 */
const EMPTY_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

기대: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 트레이 아이콘 경로 해석 유틸 + 빈 폴백 이미지"
```

---

### Task 1.3: `humanizeStatus` + `showMainWindow` + `toggleWidget` 헬퍼 추가

> **주의**: 이 Task는 Task 1.4와 **한 덩어리**로 취급. Task 1.3 단독으로는 `rebuildTrayMenu` 미정의 에러가 발생하므로, Task 1.4 완료 전까지 STOP 하지 말 것. 중간 검증·커밋 생략.

**Files:**
- Modify: `electron/main.ts` (Task 1.2 블록 아래)

**Step 0: `openWidgetPopup` 시그니처 사전 확인**

```
Grep pattern "function openWidgetPopup|openWidgetPopup\s*\(" path "electron/main.ts" output_mode content
```

기대: `function openWidgetPopup(widgetId: string, widgetTitle: string, extra?: ...)` 형태. 시그니처가 다르면 Task 1.3의 `toggleWidget` 호출을 실제 시그니처에 맞게 조정.

- [ ] **Step 1: 3개 헬퍼 함수 추가**

```typescript
/** Supabase 원시 상태 → 사용자에게 보여줄 한글 라벨 */
function humanizeStatus(raw: string): string {
  switch (raw) {
    case 'SUBSCRIBED': return '실시간 연결됨';
    case 'CHANNEL_ERROR': return '재연결 중';
    case 'TIMED_OUT': return '연결 타임아웃';
    case 'CLOSED': return '연결 끊김';
    default: return raw || '연결 중';
  }
}

/** 메인 창을 보이고 포커스. 숨김 상태면 복원 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
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
```

- [ ] **Step 2: tsc 검증** (rebuildTrayMenu 아직 미정의 → 에러 예상)

```bash
npx tsc --noEmit
```

기대: `Cannot find name 'rebuildTrayMenu'` 에러 — Task 1.4에서 해결.

- [ ] **Step 3: Task 1.4 완료 전까진 커밋 보류**

(다음 Task로 바로 진행)

---

### Task 1.4: `rebuildTrayMenu` + `createTray` 구현

**Files:**
- Modify: `electron/main.ts` (Task 1.3 블록 아래)

- [ ] **Step 1: `rebuildTrayMenu()` 추가**

```typescript
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
    { label: '종료', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`B flow • ${status}`);
}
```

- [ ] **Step 2: `createTray()` 추가**

```typescript
function createTray(): void {
  try {
    const iconPath = resolveTrayIconPath();
    let image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (image.isEmpty()) {
      image = nativeImage.createFromBuffer(Buffer.from(EMPTY_ICON_B64, 'base64'));
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
```

- [ ] **Step 3: tsc 검증**

```bash
npx tsc --noEmit
```

기대: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 트레이 메뉴 구성 + createTray 구현 (3단 폴백 포함)"
```

---

### Task 1.5: Supabase 상태 콜백에서 `rebuildTrayMenu` 호출

**Files:**
- Modify: `electron/main.ts` (문자열 `mainWindow.webContents.send('supabase:status'`가 포함된 콜백)

- [ ] **Step 1: 해당 콜백 위치 문자열 검색으로 특정**

```
Grep pattern "supabase:status" path "electron/main.ts" output_mode content -n
```

매칭된 함수/콜백 내부에서 `lastSupabaseStatus` 갱신 + `rebuildTrayMenu()` 호출 추가:

```typescript
// 기존 콜백 예시:
(status: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('supabase:status', status);
  }
}

// 수정:
(status: string) => {
  lastSupabaseStatus = humanizeStatus(status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('supabase:status', status);
  }
  rebuildTrayMenu();
}
```

**주의**: `setSupabaseStatusCallback` 또는 `startSupabaseRealtime`의 인자로 넘기는 콜백 형태가 다를 수 있음. Read로 실제 구조 확인 후 동일 효과로 반영.

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

기대: 0 errors.

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): Supabase 상태 변화 시 트레이 메뉴/툴팁 갱신"
```

---

### Task 1.6: 위젯 open/close 시 `rebuildTrayMenu` 호출

**Files:**
- Modify: `electron/main.ts` (`openWidgetPopup` 내부 `widgetWindows.set` 직후)
- Modify: `electron/main.ts` (`popupWin.on('closed', ...)` 핸들러 내부)

- [ ] **Step 1: `widgetWindows.set(widgetId, popupWin)` 직후에 `rebuildTrayMenu()` 호출 추가**

문자열 `widgetWindows.set(widgetId, popupWin)` 검색하여 해당 라인 바로 다음에 삽입:
```typescript
widgetWindows.set(widgetId, popupWin);
rebuildTrayMenu(); // 트레이 체크박스 갱신
```

- [ ] **Step 2: `popupWin.on('closed')` 핸들러 내 `widgetWindows.delete` 직후에 `rebuildTrayMenu()` 호출 추가**

`popupWin.on('closed'` 문자열 검색하여 해당 블록 안에서 `widgetWindows.delete(widgetId)` 다음 줄에 삽입:
```typescript
popupWin.on('closed', () => {
  widgetWindows.delete(widgetId);
  widgetOriginalBounds.delete(widgetId);
  rebuildTrayMenu(); // 트레이 체크박스 갱신 (이 줄 추가)
  // 기존 로직: isQuitting 체크 → 캐시 삭제 (다음 Task에서 제거)
  // 기존 로직: 독 스택 제거 + 재배치 (유지)
});
```

- [ ] **Step 3: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 위젯 open/close 시 트레이 메뉴 갱신"
```

---

### Task 1.7: 위젯 캐시 삭제 로직 제거 (핵심 버그 수정)

**Files:**
- Modify: `electron/main.ts` (`popupWin.on('closed', ...)` 핸들러)

- [ ] **Step 1: `if (!isQuitting) { widgetPositionCache.delete(...); saveWidgetPositionsDebounced(); }` 3줄 블록을 삭제 (독 스택 제거 코드는 온전히 유지)**

`popupWin.on('closed'` 블록 내 아래 3줄만 정확히 삭제:
```typescript
if (!isQuitting) {
  widgetPositionCache.delete(widgetId);
  saveWidgetPositionsDebounced();
}
```

주변 코드(`widgetWindows.delete`, `widgetOriginalBounds.delete`, `rebuildTrayMenu()`, `const dockIdx = dockedWidgetIds.indexOf(widgetId)` 이하 독 스택 제거/재배치 블록 전체)는 **건드리지 않음**. 삭제 대상은 정확히 위 3줄뿐.

**최종 상태 예시**:
```typescript
popupWin.on('closed', () => {
  widgetWindows.delete(widgetId);
  widgetOriginalBounds.delete(widgetId);
  rebuildTrayMenu(); // Task 1.6에서 추가
  // 캐시는 항상 유지 → 다음 실행 시 자동 복원 (spec 결정사항)
  const dockIdx = dockedWidgetIds.indexOf(widgetId);
  if (dockIdx >= 0) {
    dockedWidgetIds.splice(dockIdx, 1);
    if (expandedDockWidgetId === widgetId) expandedDockWidgetId = null;
    repositionAllDocked();
  }
});
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "fix(electron): 위젯 개별 X 닫기 시 위치 캐시 유지 (항상 복원 정책)"
```

---

### Task 1.8: `showTrayHintOnce` + OS 차단 폴백

**Files:**
- Modify: `electron/main.ts` (전역 함수 블록, Task 1.4 `createTray` 위)

- [ ] **Step 0: 필요한 기존 유틸 존재 여부 확인**

```
Grep pattern "function getDataPath|function ensureDir|function getAppRoot" path "electron/main.ts" output_mode content
```

기대: `getDataPath()` / `ensureDir()` 둘 다 이미 존재 (main.ts 상단 유틸 블록). 존재 시 그대로 재사용. 부재 시 다음 폴백 작성:

```typescript
// 폴백 (getDataPath/ensureDir 부재 시 주입)
function getDataPath(): string {
  return app.getPath('userData'); // %APPDATA%/Bflow-BGonly/
}
function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
```

- [ ] **Step 1: 메인 프로세스에서 preferences.json을 읽고 쓰는 최소 헬퍼 추가**

`electron/main.ts` 상단의 `getUsersFilePath` 아래 부근에 추가:

```typescript
function getPreferencesFilePath(): string {
  return path.join(getDataPath(), 'preferences.json');
}

async function readPreferences(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(getPreferencesFilePath(), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writePreferences(patch: Record<string, unknown>): Promise<void> {
  const prev = await readPreferences();
  const next = { ...prev, ...patch };
  ensureDir(path.dirname(getPreferencesFilePath()));
  await fs.promises.writeFile(getPreferencesFilePath(), JSON.stringify(next, null, 2), 'utf-8');
}
```

**주의**: 기존에 동일 기능을 하는 함수가 이미 있다면 그것을 재사용. (렌더러 쪽 `settingsService.ts`는 IPC 경유 → 메인 프로세스는 별도 파일 I/O 필요)

- [ ] **Step 2: `showTrayHintOnce()` 추가**

```typescript
async function showTrayHintOnce(): Promise<void> {
  const prefs = await readPreferences();
  if (prefs.trayFirstMinimizeSeen) return;

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
    } catch { /* ignore */ }
  }

  if (shown) {
    await writePreferences({ trayFirstMinimizeSeen: true });
  }
}
```

- [ ] **Step 3: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 트레이 최소화 최초 1회 안내 (Notification + displayBalloon 폴백)"
```

---

### Task 1.9: `mainWindow.on('close')` 핸들러로 창 X → 트레이 숨김

**Files:**
- Modify: `electron/main.ts:262-287` (`createWindow` 함수 내부)

- [ ] **Step 1: `mainWindow.on('closed', ...)` 위에 `mainWindow.on('close', ...)` 추가**

**Chunk 1 범위에서는 `show: false` 옵션을 추가하지 않음** — Chunk 2 Task 2.3에서 스플래시 도입과 함께 변경. 여기서는 기존 `BrowserWindow` 옵션 그대로 유지하고, 핸들러 2개만 추가:

```typescript
// 기존 createWindow 함수의 mainWindow.on('closed', ...) 바로 위에 아래를 추가
mainWindow.on('close', (e) => {
  if (!isQuitting && !trayFailed) {
    e.preventDefault();
    mainWindow?.hide();
    showTrayHintOnce().catch(() => {/* ignore */});
    return;
  }
  // isQuitting === true || trayFailed === true인 경우 기본 동작 허용
});

// (기존 mainWindow.on('closed', () => { mainWindow = null; }); 는 유지)
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 메인 창 X 버튼 → 트레이 숨김 (trayFailed 시 실제 종료 폴백)"
```

---

### Task 1.10: `window-all-closed` 이벤트 수정

**Files:**
- Modify: `electron/main.ts:1713-1717`

- [ ] **Step 1: 트레이가 살아있으면 종료하지 않도록 변경**

```typescript
// BEFORE:
app.on('window-all-closed', () => {
  if (!isQuitting) {
    app.quit();
  }
});

// AFTER:
app.on('window-all-closed', () => {
  // 트레이가 살아있고 사용자가 종료 의사를 표시하지 않은 경우: 백그라운드 유지
  if (!isQuitting && tray && !tray.isDestroyed()) {
    return;
  }
  // 트레이 실패 or isQuitting: 정상 종료 흐름
  app.quit();
});
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): window-all-closed에서 트레이 생존 시 종료 차단"
```

---

### Task 1.11: `app.whenReady()` 에서 `createTray()` 호출

**Files:**
- Modify: `electron/main.ts:1620` 부근 (`createWindow()` 호출 라인)

- [ ] **Step 1: `createWindow()` 호출 바로 앞에 `createTray()` 삽입**

```typescript
// app.whenReady().then(() => { ... } 내부
// BEFORE:
createWindow();

// AFTER:
createTray();        // 먼저 트레이 준비 (실패해도 앱은 계속)
createWindow();
```

- [ ] **Step 2: tsc 검증 + Step 3: 개발 실행 정상 경로 검증**

```bash
npx tsc --noEmit
npm run electron:dev
```

기대:
- Windows 시스템 트레이에 B flow 아이콘 표시 (흐릿하지만 16x16로 축소된 스플래시)
- 트레이 우클릭 → 메뉴 4항목 ('열기 / 위젯 / 상태 / 종료') 표시
- 메인 창 X → 창 사라짐, 트레이 아이콘 유지, 최초 1회 Notification 등장
- 트레이 좌클릭 or '열기' → 메인 창 복원
- 트레이 '종료' → 앱 완전 종료, 트레이 아이콘 소거

**증상 → 원인 Task 매트릭스** (문제 발견 시 해당 Task 재확인):

| 증상 | 원인 Task |
|---|---|
| 트레이 아이콘 미표시 | Task 1.4 (createTray), Task 1.11 (whenReady 호출) |
| 우클릭 메뉴 미노출 or 잘못됨 | Task 1.4 (rebuildTrayMenu) |
| 위젯 서브메뉴 체크박스 안 맞음 | Task 1.6 (open/close 시 rebuildTrayMenu) |
| 창 X 눌렀는데 앱이 실제로 종료됨 | Task 1.9 (close 핸들러), Task 1.10 (window-all-closed) |
| 트레이 '종료'가 동작 안 함 | Task 1.4 (종료 메뉴 click 핸들러) |
| 위젯 개별 X 닫았는데 재시작 시 복원 안 됨 | Task 1.7 (캐시 삭제 로직 제거 누락) |
| Notification이 안 뜸 | Task 1.8 (showTrayHintOnce) — 다만 OS 차단 환경은 정상 |
| Supabase 상태 툴팁 미반영 | Task 1.5 (콜백 수정) |

- [ ] **Step 3.5: `trayFailed` 폴백 시나리오 검증 (좀비 방지 필수 확인)**

1. `npm run electron:dev` 종료 상태에서 `public/splash/opening_image_cropped.png` 파일명을 일시 변경 (예: `.png.bak`).
2. 다시 `npm run electron:dev` 실행 → 콘솔에 `[트레이] 생성 실패` 로그가 나오고 트레이 아이콘 없음 확인.
3. 메인 창 X 클릭 → 실제 종료 확인 (숨어서 좀비가 되면 안 됨).
4. 파일명 원복 후 재실행해서 정상 동작 복원 확인.

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): app.whenReady에서 트레이 초기화 수행"
```

---

### Task 1.12: `process.on('exit')` 위젯 위치 안전망

**Files:**
- Modify: `electron/main.ts` (전역 스코프, `app.on('before-quit')` 근처)

- [ ] **Step 0: `saveWidgetPositionsSync` 존재 확인**

```
Grep pattern "function saveWidgetPositionsSync" path "electron/main.ts" output_mode content -n
```

기대: `function saveWidgetPositionsSync(): void` 존재 (main.ts:103). 부재 시 `saveWidgetPositionsDebounced`가 내부에 timer clear + 동기 저장 흐름을 포함하는지 확인 후 대안으로 사용.

- [ ] **Step 1: `process.on('exit')` 등록**

```typescript
// app.on('before-quit') 핸들러 정의 이후에 추가
process.on('exit', () => {
  try { saveWidgetPositionsSync(); } catch {/* ignore */}
});
```

- [ ] **Step 2: tsc 검증 + Step 3: 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts
git commit -m "feat(electron): process exit 시 위젯 위치 최종 안전망 저장"
```

---

### Task 1.13: `package.json`의 `build.files`에 `public/splash/**` 추가

**Files:**
- Modify: `package.json:36-41`

- [ ] **Step 1: `files` 배열에 `public/splash/**` 추가**

```json
"files": [
  "dist/**/*",
  "dist-electron/**/*",
  "public/splash/**",
  "node_modules/**/*",
  "package.json"
]
```

- [ ] **Step 2: 빌드 검증**

```bash
npm run build:vite
```

기대: tsc + vite build 성공.

- [ ] **Step 3: electron-builder --dir 모드로 파일 포함 확인 (선택)**

```bash
npx electron-builder --dir
ls dist/win-unpacked/resources/app/public/splash/
```

기대: `opening_image_cropped.png`가 포함되어 있음. 없으면 `files` 패턴 재확인.

- [ ] **Step 4: 커밋**

```bash
git add package.json
git commit -m "build: public/splash/** 를 빌드 산출물에 포함"
```

---

### Chunk 1 완료 검증

- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build:vite` 통과
- [ ] `npm run electron:dev` 실행 → 스펙 체크리스트 섹션 1 9개 항목 중 수동 검증 가능한 항목(트레이 아이콘 존재/메뉴/창 X/트레이 종료/위젯 재시작 복원) 통과

완료되면 Chunk 2로 진행.

---

## Chunk 2: 빌드 앱 로딩 속도 최적화

**목표**: 스플래시 2단계 부팅(Electron BrowserWindow로 즉시 이미지 표시 → 메인 창 준비 후 전환)과 Vite `manualChunks` + `React.lazy`로 체감·실제 로딩 속도 모두 단축. `asar`·`googleapis` 구조는 건드리지 않는 안전 정책.

---

### Task 2.1: `public/splash/splash.html` 신규 작성

**Files:**
- Create: `public/splash/splash.html`

- [ ] **Step 1: 인라인 CSS로 스플래시 HTML 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>B flow</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      -webkit-app-region: drag;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      width: 220px;
      height: 220px;
      object-fit: contain;
      animation: fadeIn 0.3s ease-out;
      filter: drop-shadow(0 6px 16px rgba(0,0,0,0.35));
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
  </style>
</head>
<body>
  <img src="./opening_image_cropped.png" alt="B flow">
</body>
</html>
```

- [ ] **Step 2: 파일 확인**

```bash
ls public/splash/
```

기대: `opening_image_cropped.png`, `splash.html`, (기존에 있던 파일들).

- [ ] **Step 3: 커밋**

```bash
git add public/splash/splash.html
git commit -m "feat: 스플래시 2단계 부팅용 HTML 신설"
```

---

### Task 2.2: `createSplashWindow()` + `closeSplash()` 구현

**Files:**
- Modify: `electron/main.ts` (헬퍼 함수 블록, Task 1.4 `createTray` 근처)

- [ ] **Step 1: 스플래시 윈도우 생성/종료 유틸 추가**

```typescript
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
    splashWin.destroy();
  }
  splashWin = null;
}
```

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 스플래시 윈도우 생성/종료 유틸 추가"
```

---

### Task 2.3: `createWindow` — `show: false` + `did-finish-load` 훅

**Files:**
- Modify: `electron/main.ts:262-287` (`createWindow`)

- [ ] **Step 1: 기존 `BrowserWindow` options 객체에 `show: false,` 한 줄만 추가 (다른 webPreferences 필드·기존 이벤트 핸들러 건드리지 않음)**

`electron/main.ts:263-275`의 기존 `new BrowserWindow({...})` 블록에서 `backgroundColor` 바로 아래에 `show: false,` 한 줄 추가:

```typescript
// Edit target (precise anchor):
//   backgroundColor: '#0F1117',
// 의 바로 다음 줄에 삽입:
    show: false,
```

**주의**: `webPreferences`, `preload`, `minWidth`, `minHeight`, `title` 등 기존 옵션 전체는 수정 금지. 기존에 있는 이벤트 리스너(`did-fail-load` 등)도 그대로 둠.

- [ ] **Step 2: `did-finish-load` 이벤트 핸들러 추가 (Task 2.4의 타임아웃 해제도 이 핸들러에서 처리)**

`mainWindow.loadURL`/`loadFile` 호출 이후, `mainWindow.on('close', ...)` 핸들러 바로 위에 추가:

```typescript
// 메인 로드 완료 → 스플래시 닫고 메인 창 show
mainWindow.webContents.once('did-finish-load', () => {
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
  try { console.timeEnd('splash-to-main'); } catch {/* 이미 종료됨 */}
});
```

**주의**: `loadTimeoutId`는 Task 2.4 Step 1에서 모듈 스코프 변수로 선언 예정 (`let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;`). Task 2.3은 이 변수를 사용하는 `did-finish-load` 블록까지만 작성.

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): 메인 창 show:false + did-finish-load로 스플래시 전환"
```

---

### Task 2.4: 30초 타임아웃 + `console.time` 측정 로그

**Files:**
- Modify: `electron/main.ts:1` (import에 `dialog` 추가)
- Modify: `electron/main.ts` (`app.whenReady().then(...)` 블록)

- [ ] **Step 0: `dialog` import 추가**

`electron/main.ts:1`의 import 라인에 `dialog` 추가:
```typescript
import { app, BrowserWindow, clipboard, ipcMain, protocol, net, desktopCapturer, screen, shell, Notification, Tray, Menu, nativeImage, dialog } from 'electron';
```

- [ ] **Step 1: 모듈 스코프에 `loadTimeoutId` 변수 추가** (Task 1.1 전역 변수 블록 근처)

```typescript
let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: `app.whenReady()` 블록 시작부에 측정 로그 + 타임아웃 설정 추가**

기존 `app.whenReady().then(() => { ... })` 블록의 `createWindow()` 호출 **앞**에 다음을 삽입. 기존 내용(`gcal.restoreTokens()`, `startSupabaseRealtime()`, 위젯 복원 등)은 모두 그대로 유지:

```typescript
console.time('splash-to-main'); // 측정 시작

createSplashWindow(); // 1. 가장 먼저 스플래시
// (기존) createTray();   -- Task 1.11에서 이미 추가됨
// (기존) createWindow(); -- 아래 유지

// 메인 로드 30초 타임아웃 (좀비 방지).
// Task 2.3의 did-finish-load 핸들러에서 clearTimeout + 해제 처리.
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
  isQuitting = true;
  app.quit();
}, MAIN_LOAD_TIMEOUT_MS);
```

**주의**:
1. 기존 `createTray()` (Task 1.11) 호출 앞에 `createSplashWindow()`를 두어 스플래시가 트레이보다 먼저 뜨도록 순서 유지.
2. 타임아웃 해제는 Task 2.3의 `did-finish-load` 핸들러에서 `clearTimeout(loadTimeoutId)`로 처리 — 여기서는 별도의 `.once('did-finish-load', ...)` 등록하지 않음 (리스너 중복 방지).

- [ ] **Step 2: tsc 검증**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 개발 실행 수동 검증**

```bash
npm run electron:dev
```

기대:
- 앱 시작 시 300x300 투명 스플래시 즉시 표시 (`opening_image_cropped.png` 중앙 정렬)
- 약간의 시간 후 스플래시 사라지고 메인 창 등장
- 콘솔에 `splash-to-main: XXXXms` 로그

- [ ] **Step 4: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(electron): app.whenReady 재정렬 + 30초 타임아웃 + splash-to-main 측정"
```

---

### Task 2.5: Chromium 커맨드라인 스위치

**Files:**
- Modify: `electron/main.ts` (파일 상단, `app.whenReady` 호출 전)

- [ ] **Step 1: import 아래, 전역 변수 위에 3개 스위치 추가**

```typescript
// import 문 아래, 첫 함수 선언 전
app.commandLine.appendSwitch('js-flags', '--nolazy');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
```

- [ ] **Step 2: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add electron/main.ts
git commit -m "perf(electron): Chromium GPU/JS 최적화 스위치 3종 추가"
```

---

### Task 2.6: `vite.config.ts`에 `manualChunks` 추가

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: 렌더러 빌드 설정에 `build.rollupOptions.output.manualChunks` 추가**

현재 `vite.config.ts`는 플러그인만 구성되어 있고 `build` 옵션이 없음. 최상위 `build` 블록 신설:

```typescript
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron([
      // ... 기존 설정 유지
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-grid': ['react-grid-layout'],
          'vendor-motion': ['framer-motion'],
          'vendor-ui': ['lucide-react', 'sonner', 'clsx'],
        },
      },
    },
  },
});
```

- [ ] **Step 2: 빌드 검증**

```bash
npm run build:vite
ls dist/assets/
```

기대: `vendor-react-*.js`, `vendor-supabase-*.js`, `vendor-grid-*.js`, `vendor-motion-*.js`, `vendor-ui-*.js` 청크가 `dist/assets/`에 존재.

- [ ] **Step 3: 커밋**

```bash
git add vite.config.ts
git commit -m "perf(vite): manualChunks로 성격별 vendor 번들 분리"
```

---

### Task 2.7: `src/App.tsx` — 뷰 lazy 로딩

**Files:**
- Modify: `src/App.tsx:1-15` (import 블록)
- Modify: `src/App.tsx:779-804` (`renderView()`)

- [ ] **Step 1: 9개 뷰 import를 `React.lazy`로 변경**

기존 `src/App.tsx:6-15`의 10개 뷰 import 라인을 모두 삭제하고, 아래 lazy 선언으로 교체. **App.tsx의 non-view import(`useEffect`, `MainLayout`, `useAppStore`, `useDataStore`, 서비스·유틸 등)는 전부 그대로 보존**.

기존 `src/App.tsx:1`의 react import에 `lazy`, `Suspense`를 추가:

```typescript
// BEFORE:
import { useEffect, useCallback, useState, useRef } from 'react';

// AFTER:
import { lazy, Suspense, useEffect, useCallback, useState, useRef } from 'react';
```

이어서 `src/App.tsx:6-15`의 10개 뷰 import 블록만 아래로 교체. 나머지 import는 건드리지 않음:

```typescript
// 뷰 lazy 로딩 — 초기 번들에서 제외
const Dashboard = lazy(() => import('@/views/Dashboard').then(m => ({ default: m.Dashboard })));
const ScenesView = lazy(() => import('@/views/ScenesView').then(m => ({ default: m.ScenesView })));
const EpisodeView = lazy(() => import('@/views/EpisodeView').then(m => ({ default: m.EpisodeView })));
const AssigneeView = lazy(() => import('@/views/AssigneeView').then(m => ({ default: m.AssigneeView })));
const TeamView = lazy(() => import('@/views/TeamView').then(m => ({ default: m.TeamView })));
const CalendarView = lazy(() => import('@/views/CalendarView').then(m => ({ default: m.CalendarView })));
const ScheduleView = lazy(() => import('@/views/ScheduleView').then(m => ({ default: m.ScheduleView })));
const VacationView = lazy(() => import('@/views/VacationView').then(m => ({ default: m.VacationView })));
const CompositingView = lazy(() => import('@/views/CompositingView')); // default export
const SettingsView = lazy(() => import('@/views/SettingsView').then(m => ({ default: m.SettingsView })));
```

- [ ] **Step 2: `renderView()` 반환을 `<Suspense>`로 감쌈**

`src/App.tsx:779-804` 수정:

```typescript
const renderView = () => {
  const view = (() => {
    switch (currentView) {
      case 'dashboard': return <Dashboard />;
      case 'scenes': return <ScenesView />;
      case 'episode': return <EpisodeView />;
      case 'assignee': return <AssigneeView />;
      case 'team': return <TeamView />;
      case 'calendar': return <CalendarView />;
      case 'schedule': return <ScheduleView />;
      case 'vacation': return <VacationView />;
      case 'compositing': return <CompositingView />;
      case 'settings': return <SettingsView />;
      default: return <Dashboard />;
    }
  })();
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full w-full">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      {view}
    </Suspense>
  );
};
```

- [ ] **Step 3: 빌드 검증**

```bash
npx tsc --noEmit
npm run build:vite
ls dist/assets/
```

기대: 각 뷰가 독립 청크(`Dashboard-*.js` 등)로 나옴. 초기 `index-*.js`는 viewer-*이 없음.

- [ ] **Step 4: 개발 수동 검증**

```bash
npm run electron:dev
```

기대: 뷰 전환 시 잠깐 스피너 → 정상 렌더. 기존 동작 회귀 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/App.tsx
git commit -m "perf(renderer): 10개 뷰 React.lazy로 지연 로딩"
```

---

### Task 2.8: 무거운 모달 lazy 로딩

**Files:**
- Modify: `src/App.tsx` (PasswordChangeModal, UserManagerModal import/렌더 부분)

- [ ] **Step 1: 두 모달을 `lazy`로 변환 + `Suspense` 래핑**

```typescript
// import 상단
const PasswordChangeModal = lazy(() => import('@/components/auth/PasswordChangeModal').then(m => ({ default: m.PasswordChangeModal })));
const UserManagerModal = lazy(() => import('@/components/auth/UserManagerModal').then(m => ({ default: m.UserManagerModal })));
```

렌더 부분(`src/App.tsx:893-898` 부근):
```typescript
{showPasswordChange && (
  <Suspense fallback={null}>
    <PasswordChangeModal />
  </Suspense>
)}
{showUserManager && (
  <Suspense fallback={null}>
    <UserManagerModal />
  </Suspense>
)}
```

- [ ] **Step 2: 빌드 검증**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 3: 커밋**

```bash
git add src/App.tsx
git commit -m "perf(renderer): 인증 모달 lazy 로딩"
```

---

### Task 2.9: 설정 섹션 lazy 로딩 (조건부)

**Files:**
- Modify: `src/views/SettingsView.tsx` (존재/구조 확인 후 결정)

- [ ] **Step 1: SettingsView 존재 및 섹션 구조 확인**

```
Grep pattern "export (const|function|default) \\w*SettingsView" path "src/views" output_mode content
Grep pattern "ThemeSection|SheetsSection|NotificationSection" path "src/views/SettingsView.tsx" output_mode content -n
```

판단 기준:
- **탭 기반(조건부 렌더)**: `{activeTab === 'theme' && <ThemeSection />}` 형태가 보이면 → Step 2로 진행해 lazy 적용.
- **동시 렌더**: 모든 섹션을 한 번에 나열하는 구조 → lazy가 의미 없음. **이 Task 전체를 스킵**하고 Task 2.10으로.
- **파일 미존재 또는 다른 구조**: 역시 스킵.

- [ ] **Step 2 (탭 기반일 때만): 섹션별 `lazy` 적용**

```typescript
import { lazy, Suspense } from 'react';
const ThemeSection = lazy(() => import('@/components/settings/ThemeSection').then(m => ({ default: m.ThemeSection })));
const SheetsSection = lazy(() => import('@/components/settings/SheetsSection').then(m => ({ default: m.SheetsSection })));
// ... 10개 섹션 동일 패턴
```

각 섹션 사용처를 `<Suspense fallback={null}>…</Suspense>`로 감쌈.

- [ ] **Step 3: 빌드 검증 + 커밋 (변경이 있었을 때만)**

```bash
npx tsc --noEmit
npm run build:vite
git add src/views/SettingsView.tsx
git commit -m "perf(renderer): 설정 섹션 lazy 로딩"
```

---

### Task 2.10: Chunk 2 전체 검증 (electron-builder 포함)

- [ ] **Step 1: 전체 빌드**

```bash
npm run build
```

기대: tsc + vite + electron-builder 모두 통과. `dist/BFLOW.exe` 생성.

- [ ] **Step 2: portable exe 수동 실행 검증**

`BFLOW.exe --enable-logging` 실행 (또는 별도 터미널에서 `BFLOW.exe` 실행 후 stdout 확인):
- 더블클릭 후 빠르게 스플래시 등장
- 스플래시 → 메인 창 전환 부드러움
- 콘솔 로그로 `splash-to-main: XXXXms` 확인 (목표 < 3000ms, 이상적으로 < 1500ms)
- 메인 창에서 뷰 전환 시 짧은 스피너 → 로드 완료

**실패 시 진단 가이드**:
- 스플래시 자체가 안 뜸 → Task 2.1(splash.html)/Task 2.2(createSplashWindow)/Task 2.4 Step 2(createSplashWindow 호출 순서) 재확인
- 스플래시는 뜨는데 3000ms 넘어감 → `splash-to-main` 로그 확인, Task 2.6 청크 분리 / Task 2.7 lazy 적용 범위 검토
- 스플래시 뜬 채 멈춤 (메인 창 안 뜸) → Task 2.3 `did-finish-load` 핸들러 + Task 2.4 타임아웃 경로 동작 확인 (30초 후 에러 다이얼로그 떠야 함)

- [ ] **Step 3: 이상 없으면 Chunk 2 커밋 병합 확인**

```bash
git log --oneline -15
```

Chunk 2의 10개 커밋이 순서대로 쌓여있는지 확인.

---

## Chunk 3: 커스텀 테마 HSL 파생

**목표**: `themes.ts`에 HSL 유틸 + `deriveThemeFromAccent()` 추가. `ThemeSection`의 커스텀 적용이 accent/sub 두 hex로 완전히 새 프리셋(배경·보더·텍스트 포함)을 생성하도록 변경. colorMode 전환 시 자동 재파생.

---

### Task 3.1: `themes.ts`에 `rgbToHsl` + `hslToRgb` 추가

**Files:**
- Modify: `src/themes.ts:114-129` (유틸 섹션)

- [ ] **Step 1: HSL 변환 유틸 2개 추가**

`src/themes.ts`의 기존 `rgbToHex`/`hexToRgb` 아래에 추가:

```typescript
/** RGB triplet → HSL (h: 0-360, s/l: 0-100) */
export function rgbToHsl(triplet: string): { h: number; s: number; l: number } {
  const [r, g, b] = triplet.split(' ').map(Number).map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL (h: 0-360, s/l: 0-100) → RGB triplet */
export function hslToRgb(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hP = h / 60;
  const x = c * (1 - Math.abs((hP % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= hP && hP < 1) [r1, g1, b1] = [c, x, 0];
  else if (hP < 2) [r1, g1, b1] = [x, c, 0];
  else if (hP < 3) [r1, g1, b1] = [0, c, x];
  else if (hP < 4) [r1, g1, b1] = [0, x, c];
  else if (hP < 5) [r1, g1, b1] = [x, 0, c];
  else if (hP < 6) [r1, g1, b1] = [c, 0, x];
  const m = lN - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `${r} ${g} ${b}`;
}
```

- [ ] **Step 2: 수동 sanity 검증**

브라우저 콘솔(`npm run electron:dev` 실행 후)에서:
```javascript
// 검정 → HSL (0, 0, 0)
rgbToHsl('0 0 0')  // { h:0, s:0, l:0 }
// 흰색
rgbToHsl('255 255 255')  // { h:0, s:0, l:100 }
// 빨강
rgbToHsl('255 0 0')  // { h:0, s:100, l:50 }
// 역변환
hslToRgb(0, 100, 50)  // "255 0 0"
```

**주의**: 실제로 이 함수들은 아직 import되지 않아 window 객체로는 접근 불가. 대신 TS 컴파일 통과만 확인하고 실사용 검증은 Task 3.2 이후로 미룸.

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/themes.ts
git commit -m "feat(themes): rgbToHsl/hslToRgb HSL 변환 유틸 추가"
```

---

### Task 3.2: `deriveThemeFromAccent` 구현

**Files:**
- Modify: `src/themes.ts` (Task 3.1 블록 아래)

- [ ] **Step 1: 함수 추가**

```typescript
/**
 * accent hex 두 개로부터 7색 ThemeColors 전체를 생성.
 * 배경·보더·텍스트 5색은 accent hue 기반 HSL 계단 공식으로 파생.
 */
export function deriveThemeFromAccent(
  accentHex: string,
  accentSubHex: string,
  mode: 'dark' | 'light',
): ThemeColors {
  const { h } = rgbToHsl(hexToRgb(accentHex));
  const dark = mode === 'dark';
  return {
    bgPrimary:     dark ? hslToRgb(h, 20, 5)  : hslToRgb(h, 15, 88),
    bgCard:        dark ? hslToRgb(h, 22, 9)  : hslToRgb(h, 10, 99),
    bgBorder:      dark ? hslToRgb(h, 20, 16) : hslToRgb(h, 25, 70),
    textPrimary:   dark ? hslToRgb(h, 15, 92) : hslToRgb(h, 30, 12),
    textSecondary: dark ? hslToRgb(h, 15, 59) : hslToRgb(h, 25, 28),
    accent:        hexToRgb(accentHex),
    accentSub:     hexToRgb(accentSubHex),
  };
}
```

- [ ] **Step 2: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/themes.ts
git commit -m "feat(themes): deriveThemeFromAccent — accent hue로 전체 테마 파생"
```

---

### Task 3.3: `useAppStore`에 `customAccentHex`/`customSubHex` 상태 + 액션 추가

**Files:**
- Modify: `src/stores/useAppStore.ts`

- [ ] **Step 1: 해당 store 파일에서 테마 관련 상태 블록 찾기**

```bash
# Read 전후 부분 파악
```

- [ ] **Step 2: 인터페이스/초기값/액션 추가**

기존 `customThemeColors` 상태 근처에 다음 추가:
```typescript
// 상태 타입 (기존 타입 정의에 추가)
customAccentHex: string | null;
customSubHex: string | null;

// 초기값 (기존 initial state 객체에 추가)
customAccentHex: null,
customSubHex: null,

// 액션 (기존 set* 액션 근처에 추가)
setCustomAccentHex: (hex: string | null) => set({ customAccentHex: hex }),
setCustomSubHex: (hex: string | null) => set({ customSubHex: hex }),
```

- [ ] **Step 3: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/stores/useAppStore.ts
git commit -m "feat(store): customAccentHex/customSubHex 상태 + 액션 추가"
```

---

### Task 3.4: `sanitizeCustomHex` 마이그레이션 유틸

**Files:**
- Modify: `src/stores/useAppStore.ts` (또는 `src/themes.ts` — store에서 사용하기 편한 곳)

- [ ] **Step 1: `src/themes.ts`에 `sanitizeCustomHex` 추가**

```typescript
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * 저장된 커스텀 테마 필드들을 검증/마이그레이션.
 * 부분적 유효성도 허용하여 사용자가 저장한 hex를 최대한 보존.
 *
 * 우선순위:
 * 1. 두 hex 모두 유효 → 둘 다 사용
 * 2. 한 hex만 유효 → 유효한 쪽은 유지, 나머지는 triplet에서 역산 (없으면 그 값을 sub로 복제)
 * 3. 둘 다 hex 무효 → triplet 양쪽 모두 역산
 * 4. triplet도 없거나 실패 → null (호출부는 DEFAULT_THEME_ID로 폴백)
 */
export function sanitizeCustomHex(input: {
  customAccentHex?: string | null;
  customSubHex?: string | null;
  customThemeColors?: ThemeColors | null;
}): { accent: string; sub: string } | null {
  const aValid = !!(input.customAccentHex && HEX_RE.test(input.customAccentHex));
  const sValid = !!(input.customSubHex && HEX_RE.test(input.customSubHex));
  const c = input.customThemeColors;

  // Case 1: 둘 다 hex 유효
  if (aValid && sValid) {
    return { accent: input.customAccentHex!, sub: input.customSubHex! };
  }

  // Case 2/3: triplet으로 보강
  let tripletAccent: string | null = null;
  let tripletSub: string | null = null;
  if (c?.accent && c?.accentSub) {
    try {
      tripletAccent = rgbToHex(c.accent);
      tripletSub = rgbToHex(c.accentSub);
    } catch {/* triplet 파싱 실패 */}
  }

  // Case 2a: accent hex만 유효
  if (aValid) {
    return {
      accent: input.customAccentHex!,
      sub: tripletSub ?? input.customAccentHex!, // sub 복구 불가 시 accent와 동일
    };
  }
  // Case 2b: sub hex만 유효
  if (sValid) {
    return {
      accent: tripletAccent ?? input.customSubHex!,
      sub: input.customSubHex!,
    };
  }
  // Case 3: 둘 다 hex 무효 → triplet 시도
  if (tripletAccent && tripletSub) {
    return { accent: tripletAccent, sub: tripletSub };
  }
  // Case 4: 전부 실패
  return null;
}
```

- [ ] **Step 2: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/themes.ts
git commit -m "feat(themes): sanitizeCustomHex 마이그레이션 유틸"
```

---

### Task 3.5: `settingsService.ts`의 `loadTheme`/`saveTheme` 타입에 신규 필드 추가

**Files:**
- Modify: `src/services/settingsService.ts`

- [ ] **Step 1: `ThemeConfig` 타입 또는 관련 인터페이스 확장**

```bash
# Read src/services/settingsService.ts to find ThemeConfig or equivalent
```

`customAccentHex?: string; customSubHex?: string;` 필드 추가. 기존 `customColors`(ThemeColors)는 유지(하위 호환).

- [ ] **Step 2: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/services/settingsService.ts
git commit -m "feat(settings): ThemeConfig에 customAccentHex/customSubHex 필드 추가"
```

---

### Task 3.6: `App.tsx` 초기화 — 마이그레이션 실행 + 재파생

**Files:**
- Modify: `src/App.tsx:321-343` (테마 로드/적용 블록)

- [ ] **Step 1: `sanitizeCustomHex` 사용해 저장된 상태 정규화**

기존 `init()` 내부 테마 로드 블록:
```typescript
const savedTheme = await loadTheme();
if (savedTheme) {
  // ... 기존 로직
}
```

수정:
```typescript
const savedTheme = await loadTheme();
if (savedTheme) {
  const savedMode = savedTheme.colorMode ?? 'dark';

  // 커스텀 테마 마이그레이션
  let customHex: { accent: string; sub: string } | null = null;
  if (savedTheme.themeId === 'custom') {
    customHex = sanitizeCustomHex({
      customAccentHex: savedTheme.customAccentHex,
      customSubHex: savedTheme.customSubHex,
      customThemeColors: savedTheme.customColors ?? null,
    });
    if (!customHex) {
      console.warn('[테마] 커스텀 테마 데이터 손상 → 기본 프리셋으로 폴백');
    }
  }

  // 실제 적용할 테마 ID (커스텀 복구 실패 시 기본 프리셋으로 강제)
  const effectiveThemeId =
    savedTheme.themeId === 'custom' && !customHex
      ? DEFAULT_THEME_ID
      : savedTheme.themeId;

  // CSS 적용
  if (effectiveThemeId === 'custom' && customHex) {
    const colors = deriveThemeFromAccent(customHex.accent, customHex.sub, savedMode);
    applyTheme(colors, savedMode);
    themeInitRef.current = true;
    setThemeId('custom');
    setColorMode(savedMode);
    setCustomThemeColors(colors);
    useAppStore.getState().setCustomAccentHex(customHex.accent);
    useAppStore.getState().setCustomSubHex(customHex.sub);
    // 구포맷만 있거나 sanitize로 보강된 경우 새 포맷으로 재저장
    if (savedTheme.customAccentHex !== customHex.accent || savedTheme.customSubHex !== customHex.sub) {
      saveTheme({
        themeId: 'custom',
        customColors: colors,
        colorMode: savedMode,
        customAccentHex: customHex.accent,
        customSubHex: customHex.sub,
      });
    }
  } else if (savedMode === 'light') {
    applyTheme(getLightColors(effectiveThemeId), savedMode);
    themeInitRef.current = true;
    setThemeId(effectiveThemeId);
    setColorMode(savedMode);
  } else {
    const preset = getPreset(effectiveThemeId);
    if (preset) {
      applyTheme(preset.colors, savedMode);
      themeInitRef.current = true;
      setThemeId(effectiveThemeId);
      setColorMode(savedMode);
    } else {
      // 완전 손상 (프리셋 ID도 유효하지 않음) → 최종 폴백
      const fallback = getPreset(DEFAULT_THEME_ID)!;
      applyTheme(fallback.colors, savedMode);
      themeInitRef.current = true;
      setThemeId(DEFAULT_THEME_ID);
      setColorMode(savedMode);
    }
  }
} else {
  themeInitRef.current = true;
}
```

추가 import 필요: `deriveThemeFromAccent`, `sanitizeCustomHex`, `DEFAULT_THEME_ID` from `@/themes`.

- [ ] **Step 2: tsc 검증 + 커밋**

```bash
npx tsc --noEmit
git add src/App.tsx
git commit -m "feat(theme): 앱 초기화 시 커스텀 테마 마이그레이션 + 구포맷 자동 변환"
```

---

### Task 3.7: `App.tsx`의 테마 적용 `useEffect` 단일 교체

**Files:**
- Modify: `src/App.tsx:442-458` (테마 변경 시 CSS 적용 + 저장)

> **주의**: 기존 플랜의 Task 3.8(colorMode 재파생)은 이 Task로 병합됨. 기존 `useEffect` 하나를 아래 버전으로 완전 교체하는 **단일 편집**으로 처리. 두 번 덮어쓰지 말 것.

- [ ] **Step 1: 기존 useEffect를 다음 단일 버전으로 교체**

의도: `[themeId, customThemeColors, colorMode]` 세 의존성을 모두 포함하고, 진입 시 **한 번에** 다음 분기를 타도록 함.
- `themeId === 'custom'`이고 hex 두 개가 모두 있으면 → hex 기반 `deriveThemeFromAccent` 호출 (colorMode만 바뀐 경우도 여기서 자동 처리)
- `themeId === 'custom'`이고 hex가 없지만 `customThemeColors`만 있으면 → 기존 colors 그대로 `applyTheme`
- 그 외 → 프리셋 경로

```typescript
useEffect(() => {
  if (!themeInitRef.current) return;
  const { customAccentHex, customSubHex, setCustomThemeColors } = useAppStore.getState();

  if (themeId === 'custom') {
    // Case A: hex 두 개 모두 유효 → 현재 colorMode로 재파생
    if (customAccentHex && customSubHex) {
      const colors = deriveThemeFromAccent(customAccentHex, customSubHex, colorMode);
      applyTheme(colors, colorMode);
      setCustomThemeColors(colors);
      saveTheme({
        themeId,
        customColors: colors,
        colorMode,
        customAccentHex,
        customSubHex,
      });
      return;
    }
    // Case B: hex 없이 customThemeColors만 (마이그레이션 과도기)
    if (customThemeColors) {
      applyTheme(customThemeColors, colorMode);
      saveTheme({ themeId, customColors: customThemeColors, colorMode });
      return;
    }
    // Case C: 아무것도 없음 — themeInitRef가 true면 오지 않아야 함. 안전망만.
    return;
  }

  // 프리셋 경로
  if (colorMode === 'light') {
    applyTheme(getLightColors(themeId), colorMode);
    saveTheme({ themeId, colorMode });
  } else {
    const preset = getPreset(themeId);
    if (preset) {
      applyTheme(preset.colors, colorMode);
      saveTheme({ themeId, colorMode });
    }
  }
}, [themeId, customThemeColors, colorMode]);
```

**deps array 설명**:
- `themeId`/`colorMode`: 프리셋↔커스텀 전환, 다크↔라이트 전환 시 재실행
- `customThemeColors`: 사용자가 "적용" 버튼으로 새 customAccent를 설정한 경우 (`setCustomThemeColors`가 이 배열을 갱신 → effect 재실행 → Case A에서 최신 hex로 재파생)

`customAccentHex`/`customSubHex`는 `useAppStore.getState()`로 읽어 stale closure 회피.

- [ ] **Step 2: tsc 검증 + 수동 검증 + 커밋**

```bash
npx tsc --noEmit
npm run electron:dev
```

수동 검증:
1. 커스텀 테마 적용 (accent #E11D48) → 전체 톤 변경 확인
2. 다크/라이트 토글 → 배경이 accent hue 기반으로 자동 재생성되는지 확인
3. 새 커스텀 accent(#814D41)로 재적용 → 톤 즉시 바뀜

```bash
git add src/App.tsx
git commit -m "feat(theme): 커스텀 테마 colorMode 전환 시 hex 기반 자동 재파생 (단일 useEffect)"
```

---

### Task 3.8: (Task 3.7로 병합됨 — 이 Task는 스킵)

Task 3.7의 단일 useEffect 교체로 colorMode 재파생 로직이 통합됨. 별도의 Task 3.8 없음. 다음 Task는 Task 3.9로 바로 이어짐.

---

### Task 3.9: `ThemeSection.tsx`의 `handleCustomApply` 교체

**Files:**
- Modify: `src/components/settings/ThemeSection.tsx:33-44`

- [ ] **Step 1: 기존 구현 제거 + `deriveThemeFromAccent` 호출로 변경**

```typescript
// import 추가
import { THEME_PRESETS, rgbToHex, hexToRgb, getPreset, getLightColors, deriveThemeFromAccent } from '@/themes';

// useAppStore에서 추가 액션 가져오기
const {
  themeId, customThemeColors, colorMode,
  setThemeId, setCustomThemeColors, setColorMode,
  setCustomAccentHex, setCustomSubHex,
} = useAppStore();

// handleCustomApply 교체
const handleCustomApply = () => {
  const colors = deriveThemeFromAccent(customAccent, customSub, colorMode);
  setCustomAccentHex(customAccent);
  setCustomSubHex(customSub);
  setThemeId('custom');
  setCustomThemeColors(colors);
  setEditingCustom(false);
};
```

- [ ] **Step 2: tsc 검증 + 개발 실행 수동 검증**

```bash
npx tsc --noEmit
npm run electron:dev
```

설정 → 테마 → 커스텀 → accent `#E11D48`, sub `#FB7185` → 적용. 기대:
- 배경이 어두운 붉은 보라 톤으로 변경
- 카드 배경, 보더, 텍스트 색상 모두 톤 일관
- 공산당 레드 프리셋과 유사한 시각적 결과

- [ ] **Step 3: 커밋**

```bash
git add src/components/settings/ThemeSection.tsx
git commit -m "fix(theme): 커스텀 테마가 accent hue로 전체 테마 파생하도록 변경"
```

---

### Task 3.10: 커스텀 편집 패널에 실시간 배경 프리뷰 추가

**Files:**
- Modify: `src/components/settings/ThemeSection.tsx:140-188` (editingCustom 블록)

- [ ] **Step 1: accent 입력값에서 실시간으로 배경 3색 계산**

```typescript
// 컴포넌트 내부에 derive 메모이제이션 (useMemo로)
const previewColors = useMemo(() => {
  try {
    return deriveThemeFromAccent(customAccent, customSub, colorMode);
  } catch {
    return null;
  }
}, [customAccent, customSub, colorMode]);
```

- [ ] **Step 2: 기존 그라디언트 프리뷰 아래에 배경 3색 박스 추가**

```tsx
{previewColors && (
  <div className="flex gap-2 mt-2">
    <div className="flex-1 flex flex-col items-center gap-1">
      <div className="w-full h-8 rounded-md" style={{ background: `rgb(${previewColors.bgPrimary})` }} />
      <span className="text-[10px] text-text-secondary">Primary</span>
    </div>
    <div className="flex-1 flex flex-col items-center gap-1">
      <div className="w-full h-8 rounded-md" style={{ background: `rgb(${previewColors.bgCard})` }} />
      <span className="text-[10px] text-text-secondary">Card</span>
    </div>
    <div className="flex-1 flex flex-col items-center gap-1">
      <div className="w-full h-8 rounded-md" style={{ background: `rgb(${previewColors.bgBorder})` }} />
      <span className="text-[10px] text-text-secondary">Border</span>
    </div>
  </div>
)}
```

**주의**: `import { useMemo } from 'react'` 필요.

- [ ] **Step 3: tsc 검증 + 수동 검증 + 커밋**

```bash
npx tsc --noEmit
npm run electron:dev
# 커스텀 편집 패널에서 색상 바꾸면 3색 박스가 실시간 변함
git add src/components/settings/ThemeSection.tsx
git commit -m "feat(theme): 커스텀 편집 패널에 실시간 배경 프리뷰 추가"
```

---

### Task 3.11: 프리셋 그리드의 '커스텀' 타일 실제 그라디언트

**Files:**
- Modify: `src/components/settings/ThemeSection.tsx:117-137` (커스텀 버튼 블록)

- [ ] **Step 1: `themeId === 'custom'`이고 `customThemeColors`가 있을 때 프리뷰 적용**

```tsx
<button
  onClick={() => setEditingCustom(true)}
  className={cn(
    'relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all cursor-pointer',
    themeId === 'custom'
      ? 'border-accent bg-accent/10'
      : 'border-bg-border hover:border-accent/40 hover:bg-bg-border/30 border-dashed',
  )}
>
  {themeId === 'custom' && customThemeColors ? (
    <div
      className="w-full h-10 rounded-lg"
      style={{
        background: `linear-gradient(135deg, rgb(${customThemeColors.bgCard}) 0%, rgb(${customThemeColors.accent}) 50%, rgb(${customThemeColors.accentSub}) 100%)`,
      }}
    />
  ) : (
    <div className="w-full h-10 rounded-lg flex items-center justify-center bg-bg-border/50">
      <Palette size={20} className="text-text-secondary" />
    </div>
  )}
  <span className="text-xs text-text-primary font-medium">커스텀</span>
  <span className="text-[11px] text-text-secondary">Custom</span>
  {themeId === 'custom' && (
    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
      <Check size={12} className="text-white" />
    </div>
  )}
</button>
```

- [ ] **Step 2: tsc 검증 + 수동 검증 + 커밋**

```bash
npx tsc --noEmit
npm run electron:dev
git add src/components/settings/ThemeSection.tsx
git commit -m "feat(theme): 커스텀 타일이 적용된 테마의 실제 그라디언트 표시"
```

---

### Chunk 3 완료 검증

- [ ] `npx tsc --noEmit` 통과
- [ ] `npm run build:vite` 통과
- [ ] 수동 검증:
  - 공산당 레드 accent(#E11D48, #FB7185)를 커스텀에 넣으면 전체 톤이 공산당 레드 느낌으로 바뀜
  - 이혜민 머쉬룸 accent(#814D41, #E0CBAF) 동일 테스트 통과
  - 다크 ↔ 라이트 토글 시 커스텀 배경도 자동 재생성
  - 커스텀 편집 패널의 3색 배경 프리뷰가 실시간 갱신
  - 프리셋 그리드 '커스텀' 타일이 다른 프리셋처럼 그라디언트로 표시
  - 앱 재시작 후 커스텀 테마 그대로 복원

---

## 최종 통합 검증

- [ ] `npm run build` (tsc + vite + electron-builder) 전체 통과
- [ ] `dist/BFLOW.exe` 실행 → 스펙 `검증 체크리스트` 섹션 1/2/3 전 항목 통과
- [ ] 기존 기능 회귀 없음 (화이트보드·씬시트·캘린더·휴가·슬랙·알림·Supabase Realtime)
- [ ] `git log --oneline -40` 으로 커밋 히스토리가 Chunk 1 13개 + Chunk 2 10개 + Chunk 3 11개 = 약 34개 커밋으로 깔끔하게 쌓여있음
- [ ] 최종 커밋 메시지에 이 플랜 파일 링크 포함

---

*플랜 끝*
