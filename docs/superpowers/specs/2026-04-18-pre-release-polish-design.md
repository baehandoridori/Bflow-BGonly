# 정식 빌드 전 마감 4종 — 디자인 문서

**작성일**: 2026-04-18
**대상 브랜치**: `claude/ecstatic-lumiere-42f79a`
**작성자**: 한솔 × Claude

---

## 배경

정식 빌드 배포 직전, 다음 4가지 품질 이슈를 해결해야 한다.

1. **트레이 아이콘 미구현** — 앱에 트레이 아이콘이 전혀 없다.
2. **위젯 위치/크기 기억 불완전** — 트레이로 앱을 종료한 뒤 재실행하면 플로팅 위젯이 마지막 상태를 기억하지 못한다.
3. **빌드 앱 실행 시 로딩 체감이 느림** — 더블클릭 후 아예 아무 화면도 뜨지 않는 구간이 길다.
4. **커스텀 테마가 '완전한 새 테마'가 아닌 '기존 테마 + 새 accent'로 생성됨** — 공산당 레드·이혜민 머쉬룸 같은 톤-온-톤 결과가 나오지 않는다.

---

## 결정사항 요약

| 항목 | 결정 |
|---|---|
| 창 X 버튼 | 트레이로 최소화 (메인 창만 숨김, 위젯은 유지) |
| 트레이 '종료' | **유일한 GUI 종료 경로** (`isQuitting = true` 후 `app.quit()`). 개발 모드의 `Ctrl+C`·작업관리자 강제 종료·트레이 생성 실패 시 fallback은 예외로 허용 |
| 트레이 메뉴 | 좌·더블클릭 = 창 열기 / 우클릭 = 열기·위젯 서브메뉴·현재 상태 표시·종료 |
| 트레이 툴팁 | `'B flow • <상태>'` 실시간 갱신 (Supabase 상태 연동) |
| 트레이 아이콘 에셋 | `public/splash/opening_image_cropped.png` 재활용 |
| 위젯 복원 정책 | 개별 X로 닫아도 위치·크기·AOT·투명도 항상 보존, 앱 재시작 시 자동 복원 |
| 로딩 속도 전략 | 안전 정책 (asar/googleapis 구조 미변경) + 실제 첫 페인트 단축 |
| 커스텀 테마 슬롯 | 1개 (덮어쓰기 구조) |
| 커스텀 테마 입력 | accent / accentSub 두 개만 사용자가 지정 |
| 커스텀 테마 생성 | accent hue 기반 HSL로 배경·보더·텍스트 5색을 자동 파생 |

---

## 섹션 1: 트레이 아이콘 + 위젯 영속화 (종료 경로 재설계)

### 목표

- `Tray` API로 시스템 트레이 아이콘을 생성하고, 앱의 **유일한 실제 종료 경로**를 트레이 메뉴 '종료'로 일원화한다.
- 위젯 상태는 모든 경로(개별 X, 트레이 종료, 작업관리자 강제 종료)에서 최대한 안전하게 보존한다.

### 아키텍처

**`electron/main.ts`에 새 전역 + 함수 추가**

```typescript
let tray: Tray | null = null;
let lastSupabaseStatus: string = '연결 중...';

/** 아이콘 경로 해석: dev(electron/)와 prod(dist-electron/) 모두 커버 */
function resolveTrayIconPath(): string {
  // dev: __dirname = <repo>/electron → ../public
  // prod: __dirname = resources/app/dist-electron → ../public (files 목록에 public/** 포함 필요)
  // 추가 폴백: app.getAppPath() 기준 경로
  const candidates = [
    path.join(__dirname, '../public/splash/opening_image_cropped.png'),
    path.join(app.getAppPath(), 'public/splash/opening_image_cropped.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return ''; // 호출부에서 빈 경로 처리
}

/** 1x1 투명 PNG (base64) — 아이콘 로드 실패 시 최후 폴백 */
const EMPTY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
    // 트레이 실패 시 창 X를 실제 종료로 폴백 (사용자가 앱을 끌 수 있도록)
    trayFailed = true;
  }
}

// 전역에 추가
let trayFailed = false;
```

**`package.json`의 `files` 목록 확인**: `public/**`가 포함되어 있어야 함. 현재 목록에는 없음 → **신규 추가 필요**:
```json
"files": [
  "dist/**/*",
  "dist-electron/**/*",
  "public/splash/**",          // 신규 추가
  "node_modules/**/*",
  "package.json"
]
```

function rebuildTrayMenu(): void {
  if (!tray) return;
  const widgetSubmenu: MenuItemConstructorOptions[] = Object.entries(WIDGET_TITLE_MAP).map(
    ([id, title]) => ({
      label: title,
      type: 'checkbox',
      checked: widgetWindows.has(id),
      click: () => toggleWidget(id, title),
    }),
  );
  const status = lastSupabaseStatus; // 아래 '상태 갱신 다리' 참고
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

**상태 갱신 다리 (Supabase realtime → 트레이)**

기존 main.ts:667-670에 Supabase 상태를 렌더러로 보내는 콜백이 이미 있음 (`mainWindow.webContents.send('supabase:status', status)`). 이 콜백 내부에서 **동시에** `lastSupabaseStatus`를 갱신하고 `rebuildTrayMenu()` 호출:

```typescript
// 기존 콜백 수정
(status: string) => {
  lastSupabaseStatus = humanizeStatus(status); // 'SUBSCRIBED' → '실시간 연결됨' 등
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('supabase:status', status);
  }
  rebuildTrayMenu(); // 트레이 메뉴/툴팁 갱신
}
```

위젯 open/close 시점에도 `rebuildTrayMenu()` 호출 (위젯 서브메뉴 체크박스 갱신).
```

**메인 창 닫기 차단 (`createWindow` 내부에 추가)**

```typescript
mainWindow.on('close', (e) => {
  if (!isQuitting && !trayFailed) {
    e.preventDefault();
    mainWindow?.hide();
    // 위젯은 건드리지 않음 (요구사항 반영)
    showTrayHintOnce(); // 최초 1회만 안내 Notification
    return;
  }
  // isQuitting === true이거나 트레이 실패 상태면 기본 동작(닫힘) 허용
});
```

**위젯 캐시 삭제 로직 제거 (`openWidgetPopup` 내부, `popupWin.on('closed')` 핸들러)**

```typescript
// BEFORE:
popupWin.on('closed', () => {
  widgetWindows.delete(widgetId);
  widgetOriginalBounds.delete(widgetId);
  if (!isQuitting) {
    widgetPositionCache.delete(widgetId);    // 이 2줄을
    saveWidgetPositionsDebounced();           // 완전 삭제
  }
  // ...독 스택 제거 로직 유지
});

// AFTER:
popupWin.on('closed', () => {
  widgetWindows.delete(widgetId);
  widgetOriginalBounds.delete(widgetId);
  // 캐시는 항상 유지 → 다음 실행 시 자동 복원
  // 독 스택 제거 로직 유지
});
```

**`window-all-closed` 동작 변경**

```typescript
app.on('window-all-closed', () => {
  // 트레이가 있으면 백그라운드 유지. 종료는 오직 트레이 '종료' 메뉴로만.
  if (!isQuitting) return;
  app.quit();
});
```

**`before-quit` 보강 — 작업관리자 강제종료 대비**

```typescript
// 기존 before-quit 핸들러는 그대로 유지. 추가 안전망:
process.on('exit', () => {
  // 동기 저장만 가능. debounce 제거 후 sync 저장.
  try { saveWidgetPositionsSync(); } catch {}
});
```

**최초 트레이 최소화 안내 (`%APPDATA%/preferences.json` 기록)**

OS가 Notification을 차단(Windows Focus Assist 등)한 경우를 고려해 다단 폴백:

```typescript
async function showTrayHintOnce(): Promise<void> {
  const prefs = await loadPreferences();
  if (prefs?.trayFirstMinimizeSeen) return;

  let shown = false;
  if (Notification.isSupported()) {
    try {
      new Notification({
        title: 'B flow',
        body: '트레이로 숨겨졌습니다. 트레이 아이콘 우클릭 → 종료로 완전히 닫을 수 있습니다.',
      }).show();
      shown = true;
    } catch {/* ignore */}
  }

  // Windows 폴백: 트레이 balloon (전부 실패하면 그냥 조용히 진행)
  if (!shown && tray && process.platform === 'win32') {
    try {
      tray.displayBalloon({
        title: 'B flow',
        content: '트레이에 숨겨졌습니다. 트레이 메뉴 종료로 완전히 닫을 수 있습니다.',
      });
      shown = true;
    } catch {/* ignore */}
  }

  // 실제로 안내를 보여줬을 때만 "봤음"으로 기록 (차단 환경 사용자 보호)
  if (shown) {
    await savePreferences({ ...prefs, trayFirstMinimizeSeen: true });
  }
}
```

### 구성요소 책임

| 구성요소 | 책임 |
|---|---|
| `createTray()` | 트레이 아이콘·툴팁·이벤트 바인딩. 앱 시작 시 1회 호출 |
| `rebuildTrayMenu()` | 위젯 상태/Supabase 상태 변화 시 재호출되어 메뉴·툴팁 최신화 |
| `toggleWidget(id, title)` | 트레이에서 위젯 on/off. 내부적으로 `openWidgetPopup` 또는 `widgetWindows.get(id).close()` |
| `humanizeStatus(raw)` | Supabase 원시 상태 문자열(`'SUBSCRIBED'`/`'CHANNEL_ERROR'` 등)을 사람이 읽을 수 있는 한글 문자열로 변환. `lastSupabaseStatus` 갱신에만 사용 |
| 기존 `loadWidgetPositions()` | 변경 없음. 이미 앱 시작 시 호출됨 (main.ts:1578) |
| 기존 자동 복원 루프 (main.ts:1631) | 변경 없음. `widgetPositionCache` 내용대로 `openWidgetPopup` 호출 |

### 데이터 플로우

```
[사용자 창 X 클릭]
  → mainWindow.close()
  → close 핸들러: isQuitting=false → preventDefault + hide()
  → 위젯들은 그대로 유지

[사용자 개별 위젯 X 클릭]
  → popupWin closed 이벤트
  → widgetWindows에서만 제거, widgetPositionCache는 유지
  → saveWidgetPositionsDebounced() 호출 안 함 (변경 없으니)

[사용자 트레이 '종료' 클릭]
  → isQuitting=true; app.quit()
  → before-quit 핸들러: saveWidgetPositionsSync() + Supabase 정리
  → 모든 창 닫힘 허용
  → 종료

[다음 앱 실행]
  → loadWidgetPositions() → widgetPositionCache 복원
  → createWindow() + createTray()
  → did-finish-load → 저장된 모든 widgetId에 대해 openWidgetPopup 호출
  → 위젯 재등장 (마지막 위치·크기·AOT·투명도 그대로)
```

### 위험 요소 / 완화

| 위험 | 완화 |
|---|---|
| 트레이 아이콘 16x16 변환 시 스플래시 이미지 가독성 저하 | 아이콘이 흐릿하면 Phase 후속에서 전용 `.ico` 파일로 교체 (이번 스코프 밖) |
| macOS는 `window-all-closed` 동작 관례가 다름 | 현재 Windows 전용 빌드(`win.target: portable`)이므로 고려 불필요 |
| 작업관리자 강제종료 시 `process.on('exit')`도 못 타는 경우 | `saveWidgetPositionsDebounced`가 500ms마다 저장하므로 마지막 저장분 보존 |

---

## 섹션 2: 빌드 앱 로딩 속도 — 안전 정책

### 목표

- 사용자 체감 로딩(더블클릭 → 첫 화면 등장) 시간을 대폭 단축.
- `asar`, `googleapis` 구조는 건드리지 않음 (최근 수정으로 해결한 docs 모듈 누락 버그 재발 방지).

### 두 축의 개선

#### A. 체감 속도: 스플래시 2단계 부팅

현재 흐름:
```
더블클릭 → Electron 초기화 → createWindow (숨김)
  → loadFile(index.html) → Vite 번들 파싱 → React 마운트
  → 내부 SplashScreen 컴포넌트 렌더 → 사용자가 드디어 뭔가 봄
```

개선 흐름:
```
더블클릭 → Electron 초기화 → createSplashWindow() (즉시 show)
                                 ↓ (사용자는 이 시점에 스플래시 봄)
                              백그라운드: createWindow (숨김 상태)
                                 → loadFile(index.html) → React 준비 완료
                                 → did-finish-load 이벤트
                                 → splashWin.close() + mainWindow.show()
```

**구현 포인트**:

- 새 파일 `public/splash/splash.html` — 인라인 CSS, 외부 의존성 0. 같은 폴더의 `opening_image_cropped.png`를 상대 경로(`./opening_image_cropped.png`)로 참조. 경로 일원화 목적으로 `public/splash/` 하위에 배치 → `package.json` `files`의 `public/splash/**` 한 줄로 스플래시 에셋+HTML 모두 커버.
- `electron/main.ts`에 `createSplashWindow()` 신설: `width:300, height:300, frame:false, transparent:true, alwaysOnTop:true, resizable:false, skipTaskbar:true, show:true, closable:false`. (`closable:false`로 사용자가 스플래시를 닫을 수 없게 해 좀비 상태 방지)
- `app.whenReady()`에서 **트레이 생성 직후, createWindow 직전**에 스플래시 생성.
- `mainWindow = new BrowserWindow({ show: false, ... })` — 기존엔 기본 show:true였음.
- `mainWindow.webContents.once('did-finish-load', () => { closeSplash(); mainWindow.show(); })`.
- `closeSplash()`는 `splashWin.destroy()` 래퍼 (`closable:false`인 창은 `close()`가 거부되므로 `destroy()` 사용).

**메인 로드 타임아웃 (좀비 방지)**

메인 창이 30초 내 `did-finish-load`를 내지 못하면 에러 창 띄우고 종료:

```typescript
const MAIN_LOAD_TIMEOUT_MS = 30_000;
let mainLoadedOk = false;

const timer = setTimeout(() => {
  if (mainLoadedOk) return;
  console.error('[메인 로드] 타임아웃 — 강제 종료');
  closeSplash();
  dialog.showErrorBox('B flow', '앱 로드에 실패했습니다. 다시 실행해주세요.');
  isQuitting = true;
  app.quit();
}, MAIN_LOAD_TIMEOUT_MS);

mainWindow.webContents.once('did-finish-load', () => {
  mainLoadedOk = true;
  clearTimeout(timer);
  closeSplash();
  mainWindow.show();
  console.timeEnd('splash-to-main'); // 측정용 로그
});

console.time('splash-to-main'); // createSplashWindow 직후 시작
```

**측정 방법**: `console.time`/`console.timeEnd`로 스플래시 표시 시점부터 메인 show까지의 ms를 로그에 남김. 배포 portable exe에서도 `--enable-logging` 플래그로 확인 가능. 검증 체크리스트의 "1초 이내"는 이 로그 기준으로 판정.

#### B. 실제 속도: 렌더러 초기 번들 축소 + 초기화 지연

**B-1. Vite 번들 분할 (`vite.config.ts`)**

```typescript
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
```

(공통 vendor를 성격별로 분리. `react-grid-layout`과 `framer-motion`은 서로 무관한 동적 로드 타이밍을 가지므로 분리가 캐시 효율에 유리)

- 초기 HTML 파싱 시 메인 체인 번들이 작아져 첫 페인트 시간 단축.
- 브라우저 캐시 효율↑ (vendor 번들은 앱 업데이트 후에도 동일 해시).

**B-2. `React.lazy()` 적용 — 라우트/모달 단위 지연 로딩**

지연 로딩 대상:
- **뷰(라우트) 레벨**: `src/App.tsx`에서 `Dashboard`, `ScheduleView`, `EpisodeView`, `WidgetPopup`을 `React.lazy()`로 감쌈. 초기 렌더 시 현재 활성 뷰 하나만 로드.
- **무거운 모달**: `SceneDetailModal`, `WhiteboardModal`, `UserManagerModal`, `ImageModal` — 모달이 실제로 열릴 때 번들 로드.
- **설정 패널**: 설정 창을 처음 열 때만 각 Section 로드 (`ThemeSection`, `SheetsSection`, `NotificationSection`, `StartupSection`, `ShortcutsSection`, `EffectsSection` 등).

각 `lazy` 컴포넌트는 `<Suspense fallback={기존 로딩 스피너}>`로 래핑.

**B-3. 메인 프로세스 초기화 지연**

`electron/main.ts`의 `app.whenReady()` 콜백 재정렬:

```typescript
app.whenReady().then(() => {
  createSplashWindow();      // 1. 즉시 스플래시 (사용자 인지)
  createTray();              // 2. 트레이 (경량)
  createWindow();            // 3. 메인 창 (숨김 상태로 로드 시작)

  // 4. 무거운 초기화는 메인 창 로드 완료 후로
  mainWindow.webContents.once('did-finish-load', () => {
    splashWin?.close();
    mainWindow?.show();
    gcal.restoreTokens();        // 기존엔 여기보다 위에 있었음
    startSupabaseRealtime();     // 기존엔 여기보다 위에 있었음
    // 기존 자동 위젯 복원 로직 그대로
  });
});
```

**B-4. Chromium 커맨드라인 스위치 (안전 범위)**

```typescript
app.commandLine.appendSwitch('js-flags', '--nolazy');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
```

### 기대 효과

- **체감**: 더블클릭 → 수백ms 내 스플래시 표시 → 사용자가 "응답 중"임을 인지.
- **실제**: 초기 JS 번들 크기 30~50% 축소 (vendor 분리 + lazy), React 트리 마운트 시간 단축, 첫 렌더 가능 시점(FMP) 당겨짐.

### 미채택 (의도적 제외)

| 항목 | 제외 이유 |
|---|---|
| `asar: true` 재활성화 | googleapis docs 모듈 누락 버그 회귀 위험 |
| `googleapis` → `@googleapis/drive` + `@googleapis/calendar` 분할 | 큰 리팩터링, 회귀 위험 |
| V8 snapshot 파일 생성 | 빌드 파이프라인 복잡도 증가 |
| Electron 업그레이드 | 스코프 밖 |

---

## 섹션 3: 커스텀 테마 — accent hue 기반 HSL 파생

### 목표

- 커스텀 테마 슬롯(1개, 덮어쓰기)을 **완전한 새 프리셋**으로 만든다.
- 사용자는 accent/accentSub 두 색만 고름. 나머지 5색(`bgPrimary`, `bgCard`, `bgBorder`, `textPrimary`, `textSecondary`)은 자동 파생.
- 결과가 공산당 레드·이혜민 머쉬룸 수준의 일관된 톤을 낼 것.

### 알고리즘 (기존 프리셋 역설계)

**다크 모드** (L 계단: 5 / 9 / 16 / 59 / 92):
```
bgPrimary     = hsl(accentHue, S=20%, L=5%)
bgCard        = hsl(accentHue, S=22%, L=9%)
bgBorder      = hsl(accentHue, S=20%, L=16%)
textPrimary   = hsl(accentHue, S=15%, L=92%)
textSecondary = hsl(accentHue, S=15%, L=59%)
```

**라이트 모드**:
```
bgPrimary     = hsl(accentHue, S=15%, L=88%)
bgCard        = hsl(accentHue, S=10%, L=99%)
bgBorder      = hsl(accentHue, S=25%, L=70%)
textPrimary   = hsl(accentHue, S=30%, L=12%)
textSecondary = hsl(accentHue, S=25%, L=28%)
```

**검증 (예상 유사도)**: 공산당 레드 프리셋의 accent(#E11D48)를 커스텀에 넣었을 때 생성되는 배경 5색과 실제 프리셋 5색의 HSL 거리 평균 ±5% 이내로 수렴하면 합격.

### 구현

**`src/themes.ts` 확장**

```typescript
// 신규 유틸
function rgbToHsl(triplet: string): { h: number; s: number; l: number }
function hslToRgb(h: number, s: number, l: number): string  // "r g b"

// 신규 함수
export function deriveThemeFromAccent(
  accentHex: string,
  accentSubHex: string,
  mode: 'dark' | 'light'
): ThemeColors {
  const { h } = rgbToHsl(hexToRgb(accentHex));
  const darkMode = mode === 'dark';
  return {
    bgPrimary:     darkMode ? hslToRgb(h, 20, 5)  : hslToRgb(h, 15, 88),
    bgCard:        darkMode ? hslToRgb(h, 22, 9)  : hslToRgb(h, 10, 99),
    bgBorder:      darkMode ? hslToRgb(h, 20, 16) : hslToRgb(h, 25, 70),
    textPrimary:   darkMode ? hslToRgb(h, 15, 92) : hslToRgb(h, 30, 12),
    textSecondary: darkMode ? hslToRgb(h, 15, 59) : hslToRgb(h, 25, 28),
    accent:        hexToRgb(accentHex),
    accentSub:     hexToRgb(accentSubHex),
  };
}
```

**`src/components/settings/ThemeSection.tsx` — `handleCustomApply` 교체**

```typescript
// BEFORE:
const handleCustomApply = () => {
  const base = getPreset(themeId === 'custom' ? 'violet' : themeId)?.colors
    ?? THEME_PRESETS[0].colors;
  const colors: ThemeColors = {
    ...base,
    accent: hexToRgb(customAccent),
    accentSub: hexToRgb(customSub),
  };
  setThemeId('custom');
  setCustomThemeColors(colors);
  setEditingCustom(false);
};

// AFTER:
const handleCustomApply = () => {
  const colors = deriveThemeFromAccent(customAccent, customSub, colorMode);
  setThemeId('custom');
  setCustomThemeColors(colors);
  setCustomAccentHex(customAccent);       // 신규 저장 필드
  setCustomSubHex(customSub);             // 신규 저장 필드
  setEditingCustom(false);
};
```

**`src/stores/useAppStore.ts` 확장**

- 신규 상태: `customAccentHex: string | null`, `customSubHex: string | null`.
- 신규 액션: `setCustomAccentHex`, `setCustomSubHex`.
- `setColorMode(mode)` 내부에서 `themeId === 'custom'` && 두 hex 모두 있으면 `deriveThemeFromAccent(accentHex, subHex, mode)` 재호출 → `customThemeColors` 업데이트 + `applyTheme()` 재실행.

**마이그레이션 로직 (앱 시작 시 1회, store 초기화 단계)**

```typescript
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeCustomHex(
  saved: Partial<{ customAccentHex: string; customSubHex: string; customThemeColors: ThemeColors }>
): { accent: string; sub: string } | null {
  const savedAccent = saved.customAccentHex;
  const savedSub = saved.customSubHex;
  // 1순위: 새 포맷 — 유효성 검증
  if (savedAccent && HEX_RE.test(savedAccent) && savedSub && HEX_RE.test(savedSub)) {
    return { accent: savedAccent, sub: savedSub };
  }
  // 2순위: 구포맷 customThemeColors.accent/accentSub에서 역산
  if (saved.customThemeColors?.accent && saved.customThemeColors?.accentSub) {
    try {
      return {
        accent: rgbToHex(saved.customThemeColors.accent),
        sub: rgbToHex(saved.customThemeColors.accentSub),
      };
    } catch { /* triplet 파싱 실패 */ }
  }
  // 둘 다 실패 → null 반환. 호출부는 커스텀 테마를 비활성화하고 기본 프리셋으로 폴백.
  return null;
}
```

- 마이그레이션 타이밍: `useAppStore` 초기값 계산 단계 (앱 최초 마운트 시 1회). `preferences.json` 로드 직후.
- 역산 성공 시: `customAccentHex`/`customSubHex`를 즉시 `savePreferences`로 기록해 다음 실행부터 새 포맷 사용.
- 역산 실패 시: `themeId` = `DEFAULT_THEME_ID`, `customThemeColors` = `null`, 사용자에게는 침묵 (토스트 없음 — 로그만).
- 저장 포맷: 기존 `customThemeColors`는 유지 (하위 호환). 신규 필드(`customAccentHex`/`customSubHex`)는 `preferences.json`에 추가.

**커스텀 편집 패널 미리보기 (`ThemeSection.tsx`)**

- 현재 프리뷰: `linear-gradient(135deg, ${customAccent}, ${customSub})` 한 줄.
- 추가: accent 입력 변경 시 실시간으로 `deriveThemeFromAccent()` 호출 → **파생된 bgPrimary/bgCard/bgBorder 3색 박스**를 오른쪽에 나란히 표시. 사용자가 '적용' 전에 배경까지 확인 가능.

**프리셋 그리드의 '커스텀' 타일**

- `themeId === 'custom'`이고 `customThemeColors`가 있으면, 다른 프리셋과 동일한 그라디언트 프리뷰 표시: `linear-gradient(135deg, bgCard 0%, accent 50%, accentSub 100%)`.
- 비어 있으면 현재의 플레이스홀더 아이콘 유지.

### 구성요소 책임

| 구성요소 | 책임 |
|---|---|
| `rgbToHsl`, `hslToRgb` | RGB triplet ↔ HSL 정확한 수학 변환 (표준 공식) |
| `deriveThemeFromAccent` | accent/sub 두 hex + mode에서 ThemeColors 전체 생성. 순수 함수 |
| `handleCustomApply` | UI에서 받은 두 hex를 저장 + 파생 + store 반영 |
| `setColorMode` (수정) | 커스텀 테마일 때 mode 전환 시 재파생 |

### 위험 요소 / 완화

| 위험 | 완화 |
|---|---|
| 특정 hue(예: 순수 노랑)에서 텍스트 대비 WCAG AA 미달 | L=92% 와 L=5%는 17:1 이상 콘트라스트 → 수학적으로 AA 보장. S가 변해도 L이 지배적 |
| 사용자가 채도 0(회색)을 accent로 고르면 파생된 배경도 완전 무채색 | 의도된 동작. 모노톤 테마는 유효한 선택 |
| 기존 저장된 `customThemeColors`(두 hex 없음) 로드 시 colorMode 전환이 일회성으로 어색할 수 있음 | `customThemeColors.accent` triplet에서 hex 역산해 `customAccentHex`에 저장 후 정상화 |

---

## 검증 체크리스트

### 섹션 1 (트레이 + 위젯)
- [ ] 앱 시작 시 Windows 시스템 트레이에 B flow 아이콘이 나타난다.
- [ ] 트레이 아이콘 좌·더블클릭 시 메인 창이 열린다 (숨겨져 있으면 복원).
- [ ] 우클릭 메뉴에 '열기 / 위젯 서브메뉴 / 상태 / 종료'가 보인다.
- [ ] 메인 창 X 버튼 → 창만 숨고 앱은 살아있다 (트레이 아이콘 유지, 위젯 유지).
- [ ] 최초 1회 "트레이로 숨김" Notification이 뜬다. 두 번째부터는 안 뜬다.
- [ ] Focus Assist 등으로 Notification이 차단된 상태에서는 `trayFirstMinimizeSeen`이 `true`로 저장되지 않아 다음 실행 때 다시 안내 시도한다.
- [ ] 트레이 '종료' 클릭 → 앱이 완전히 종료된다 (트레이 아이콘 사라짐).
- [ ] **트레이 생성이 실패하는 시나리오** (아이콘 파일 없음 + 에셋 없음) → `trayFailed=true`로 폴백되어 창 X가 실제 종료로 동작 (앱이 좀비로 남지 않음).
- [ ] 위젯을 개별 X로 닫고 앱 재시작 → 그 위젯이 마지막 위치/크기/AOT/투명도로 자동 복원된다.
- [ ] 트레이로 완전 종료 후 재시작 → 열려있던 모든 위젯이 복원된다.
- [ ] Supabase 연결 상태 변화가 트레이 툴팁·메뉴에 반영된다 (상태 콜백에서 `rebuildTrayMenu` 호출로 검증).

### 섹션 2 (로딩 속도)
- [ ] 더블클릭 후 1초 이내에 스플래시 이미지가 화면에 나타난다 (로컬 SSD 기준, `--enable-logging` 플래그로 `console.time('splash-to-main')` 시작 시각과 `app.whenReady()` 시각 차이를 측정하여 < 1000ms 확인).
- [ ] `console.timeEnd('splash-to-main')` 로그가 스플래시 표시부터 메인 show까지의 시간을 찍는다.
- [ ] 스플래시 → 메인 창 전환이 부드럽다 (깜빡임 없음).
- [ ] 메인 창이 30초 안에 로드되지 않는 극단 시나리오에서 에러 다이얼로그가 뜨고 앱이 종료된다.
- [ ] `vite build` 결과 `dist/assets/`에 `vendor-react`, `vendor-supabase`, `vendor-grid`, `vendor-motion`, `vendor-ui` 번들이 분리되어 있다.
- [ ] 초기 화면이 Dashboard일 때 Schedule/Episode 뷰 번들은 로드되지 않는다 (DevTools Network).
- [ ] Scene 상세 모달 열기 전까진 `SceneDetailModal.tsx` 번들이 요청되지 않는다.
- [ ] 빌드 크기가 이전 대비 감소하지 않아도 무방 (파일 분할만 해도 병렬 로드 이득).

### 섹션 3 (커스텀 테마)
- [ ] 커스텀 편집 패널에서 accent·sub 색상 지정 시 배경 3색 프리뷰가 실시간으로 갱신된다.
- [ ] '적용' 클릭 후 앱 전체(사이드바·카드·보더·텍스트)가 하나의 톤으로 자동 변경된다.
- [ ] 공산당 레드 accent(#E11D48, #FB7185)를 커스텀에 넣은 결과가 공산당 레드 프리셋과 시각적으로 유사하다.
- [ ] 이혜민 머쉬룸 accent(#814D41, #E0CBAF) 동일 테스트 통과.
- [ ] 다크 ↔ 라이트 토글 시 커스텀 테마 배경도 자동으로 재생성된다.
- [ ] 프리셋 그리드의 '커스텀' 타일이 다른 프리셋과 동일한 그라디언트 프리뷰로 표시된다.
- [ ] 앱 재시작 후 커스텀 테마가 그대로 복원된다 (hex 저장 포맷 포함).
- [ ] **구포맷 마이그레이션**: `customAccentHex`/`customSubHex`가 없고 `customThemeColors`만 있던 기존 사용자 데이터로 시작해도 정상 복원되며, 시작 후 새 포맷으로 `preferences.json`에 기록된다.
- [ ] **손상된 hex 방어**: `customAccentHex`가 `"garbage"` 같은 잘못된 값이면 자동으로 기본 프리셋으로 폴백하고 로그만 남긴다 (사용자 토스트 없음, 앱 크래시 없음).

### 회귀 방지
- [ ] `tsc --noEmit` 통과.
- [ ] `vite build` 통과.
- [ ] `electron-builder`로 portable 빌드 → 실행 → 위 시나리오 수동 검증.
- [ ] 기존 기능(화이트보드, 씬 시트뷰, 캘린더, 휴가, 슬랙 웹훅) 동작 회귀 없음.

---

## 비-목표 (Not in Scope)

- 트레이 아이콘용 전용 `.ico` 파일 제작 (스플래시 PNG 재활용으로 충분)
- macOS 트레이 동작 (Windows portable 빌드만 배포)
- 여러 개 커스텀 테마 슬롯 / 테마 이름 지정 / 테마 공유
- asar 재활성화, googleapis 의존성 재구조화
- Electron·React 버전 업그레이드
- 커스텀 테마에서 배경/보더/텍스트 직접 지정 (고급 모드)
- 트레이에서의 알림 배지(미읽음 수 등)

---

## 파일 변경 요약

| 파일 | 변경 |
|---|---|
| `electron/main.ts` | 트레이 생성/메뉴/이벤트, Supabase 상태 콜백에서 `rebuildTrayMenu` 호출, mainWindow close 차단 + `trayFailed` 폴백, 위젯 캐시 삭제 로직 제거, window-all-closed 수정, process exit 안전망, app.whenReady 재정렬, 스플래시 윈도우 + 30초 타임아웃 + 측정 로그, 커맨드라인 스위치 추가 |
| `electron/preload.ts` | 변경 없음 (기존 IPC로 충분) |
| `public/splash/splash.html` | 신규 — 스플래시 2단계 부팅용. `public/splash/` 하위에 배치해 기존 이미지와 함께 `public/splash/**` files 규칙 한 줄로 커버 |
| `package.json` | `build.files`에 `public/splash/**` 추가 |
| `vite.config.ts` | manualChunks 설정 (성격별 vendor 분리) |
| `src/App.tsx` | 뷰/모달 lazy 로딩 래핑 |
| `src/themes.ts` | `rgbToHsl`, `hslToRgb`, `deriveThemeFromAccent` 추가 |
| `src/stores/useAppStore.ts` | `customAccentHex`/`customSubHex` 상태, `setColorMode` 재파생 로직, `sanitizeCustomHex` 마이그레이션 |
| `src/components/settings/ThemeSection.tsx` | `handleCustomApply` 교체, 실시간 배경 프리뷰 추가 |
| `src/services/settingsService.ts` | preferences.json에 `trayFirstMinimizeSeen`, `customAccentHex`, `customSubHex` 필드 추가 |

---

*디자인 문서 끝*
