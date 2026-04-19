# B flow 9개 UI/UX 이슈 통합 수정 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카드 라쏘 오인식, 위젯 글꼴/색상 미적용, 자동 로그인 실패, 플렉서스 파티클 색상, 대시보드 그라데이션, 휴가 pending 상태, EP 위젯 복원 등 9건을 단일 PR로 수정한다.

**Architecture:** Electron 메인/렌더러 프로세스 간 IPC 브로드캐스트 채널을 추가해 "메인 창 설정 변경 → 전체 창 즉시 반영" 경로를 확립한다. CSS 변수 기반 테마 시스템을 글자 카테고리 색상까지 확장한다. 그라데이션 배경을 canvas 외부 DOM 레이어로 분리하여 파티클과 독립 토글한다. 휴가 등록은 낙관적 업데이트 + 파일 영속화 + 완료 broadcast 토스트로 개선한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Tailwind CSS 3, Zustand 4, sonner, Vite 5 (테스트 프레임워크 없음 — 각 Task는 `npx tsc --noEmit` + `npm run build:vite` + 수동 실행으로 검증)

**Spec 참조:** [`docs/superpowers/specs/2026-04-18-bflow-ui-fixes-design.md`](../specs/2026-04-18-bflow-ui-fixes-design.md)

**검증 공통 명령** (각 Task 마지막에 반복):
```bash
npx tsc --noEmit          # 타입 체크만
npm run build:vite        # tsc + vite build (렌더러 번들)
npm run electron:dev      # 실제 앱 실행(수동 스모크) — 일부 Task만 필요
```

**커밋 컨벤션 (CLAUDE.md):** 한글 메시지, prefix `fix:`/`feat:`/`refactor:`/`chore:` + 간결한 본문.

---

## Chunk 1: 인프라 및 버그 수정 (Task 1–4)

### Task 1: 자동 로그인 실패 진단 로그 추가 (이슈 ⑥)

**Files:**
- Modify: `src/services/userService.ts:181-198` — `loadSession` 실패 구간 로그
- Modify: `src/App.tsx:420-427` — 세션 복원 결과 로그
- Modify: `electron/main.ts` — 이미 `app.name = 'Bflow-BGonly'` 설정됨(라인 38 확인) → 추가 변경 불필요

**배경:** `app.name`은 이미 정확히 지정되어 있다(electron/main.ts:38). 빌드 앱 자동 로그인 실패의 실제 원인을 좁히려면 실패 구간을 로그로 나누어야 한다. 로그 추가 후 빌드 앱 실행 → 원인 확인 → Task 1의 **후속 커밋**으로 근본 수정.

- [ ] **Step 1: `loadSession`에 구간별 로그 추가**

`src/services/userService.ts`의 `loadSession` 본문을 다음과 같이 수정:

```ts
export async function loadSession(): Promise<{ session: AuthSession | null; user: AppUser | null }> {
  let session: AuthSession | null = null;
  try {
    session = (await window.electronAPI.readSettings(AUTH_FILE)) as AuthSession | null;
  } catch (err) {
    console.warn('[auth] auth.json 읽기 실패:', err);
    return { session: null, user: null };
  }
  if (!session) {
    console.info('[auth] auth.json 미존재 — 로그인 필요');
    return { session: null, user: null };
  }
  if (!session.userId) {
    console.warn('[auth] session.userId 누락 — 세션 무효', session);
    return { session: null, user: null };
  }
  const users = await loadUsers();
  const user = users.find((u) => u.id === session!.userId) ?? null;
  if (!user) {
    console.warn('[auth] 세션 userId에 매칭되는 사용자 없음', { sessionUserId: session.userId, userCount: users.length });
  } else {
    console.info('[auth] 세션 복원 성공', { userId: user.id, name: user.name });
  }
  return { session, user };
}
```

- [ ] **Step 2: `App.tsx`의 세션 복원 분기 로그 추가**

[src/App.tsx:420-427] 부근 `rememberMe` 분기에 아래와 같이:

```ts
const rememberMe = savedPrefs?.rememberMe !== false;
console.info('[auth] rememberMe =', rememberMe);
if (rememberMe) {
  const { user } = await loadSession();
  if (user) {
    setCurrentUser(user);
    console.info('[auth] currentUser 설정 완료');
  } else {
    console.info('[auth] 세션 없음 — 로그인 화면 표시');
  }
}
```

- [ ] **Step 3: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/services/userService.ts src/App.tsx
git commit -m "$(cat <<'EOF'
chore(auth): 자동 로그인 실패 진단 로그 추가

auth.json 읽기/userId 매칭/사용자 검색 각 단계에서 실패 이유를 콘솔에 남긴다.
빌드 앱에서 자동 로그인이 안 되는 실제 원인을 재현 후 구분하기 위한 선제 작업.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**후속 예정:** 빌드 후 재현 → 실제 원인 파악 → 근본 수정 추가 커밋 (Task 1-B). 현 단계에선 근본 수정 코드는 작성하지 않는다(YAGNI — 로그 결과 확인 전에는 원인 추정만 가능).

---

### Task 2: IPC 브로드캐스트 인프라 (preferences/session/vacation)

메인 창이 설정·세션 변경 시 모든 BrowserWindow에 push하는 공통 채널. 이후 Task들이 이를 구독한다.

**Files:**
- Modify: `electron/main.ts` — 브로드캐스트 헬퍼 + IPC 핸들러 추가
- Modify: `electron/preload.ts` — 렌더러에서 구독/발행할 수 있도록 노출
- Modify: `src/types/electron.d.ts` — 타입 선언

- [ ] **Step 1: `electron/main.ts`에 브로드캐스트 헬퍼 추가**

파일 적당한 위치(IPC 핸들러 섹션 직전)에:

```ts
/** 메인 창 + 모든 위젯 창에 동일 이벤트 push */
function broadcastToAllWindows(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
  for (const win of widgetWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

// 렌더러 → 메인: "지금 설정 바꿨으니 다른 창에도 알려줘"
ipcMain.handle('preferences:broadcast-change', (_event, payload: unknown) => {
  broadcastToAllWindows('preferences:changed', payload);
  return { ok: true };
});

ipcMain.handle('session:broadcast-change', (_event, payload: unknown) => {
  broadcastToAllWindows('session:changed', payload);
  return { ok: true };
});
```

- [ ] **Step 2: `electron/preload.ts`에 API 노출 (라인 247 부근 `widgetOpenPopup` 근처에 추가)**

```ts
preferencesBroadcastChange: (payload?: unknown) =>
  ipcRenderer.invoke('preferences:broadcast-change', payload),

onPreferencesChanged: (callback: (payload: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on('preferences:changed', listener);
  return () => ipcRenderer.removeListener('preferences:changed', listener);
},

sessionBroadcastChange: (payload?: unknown) =>
  ipcRenderer.invoke('session:broadcast-change', payload),

onSessionChanged: (callback: (payload: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on('session:changed', listener);
  return () => ipcRenderer.removeListener('session:changed', listener);
},
```

- [ ] **Step 3: `src/types/electron.d.ts`에 타입 추가**

기존 `electronAPI` 인터페이스에:

```ts
preferencesBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
onPreferencesChanged: (cb: (payload: unknown) => void) => () => void;
sessionBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
onSessionChanged: (cb: (payload: unknown) => void) => () => void;
```

- [ ] **Step 4: 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 0 에러.

- [ ] **Step 5: 빌드 확인**

```bash
npm run build:vite
```

- [ ] **Step 6: 커밋**

```bash
git add electron/main.ts electron/preload.ts src/types/electron.d.ts
git commit -m "$(cat <<'EOF'
feat(ipc): 설정/세션 변경 브로드캐스트 채널 추가

메인 창이 설정·세션 변경 시 모든 위젯 창에 push하는 공통 IPC를 도입.
후속 Task(위젯 글꼴 통일, 내 할일 세션 동기화)가 이 채널을 구독한다.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 위젯 팝업 `extra` 파라미터 영속화 (이슈 ⑨)

**Files:**
- Modify: `electron/main.ts` — `WidgetPosition` 타입에 `extra` 필드, 저장/복원 로직
- Modify: `src/types/electron.d.ts` — 관련 타입 동기화 (필요 시)

**배경:** `widgetPositionCache`는 위치/크기/AOT/opacity만 저장한다. EP 위젯은 `?ep=1` query string으로 에피소드 번호를 받는데 재실행 시 `extra`가 유실되어 빈 칸이 된다.

- [ ] **Step 1: `WidgetPosition` 타입에 `extra` 추가**

`electron/main.ts`에서 `WidgetPosition`/`widgetPositionCache` 선언 근처에:

```ts
interface WidgetPosition {
  x: number; y: number; width: number; height: number;
  opacity?: number;
  alwaysOnTop?: boolean;
  extra?: Record<string, string>;  // 신규
}
```

(실제 타입 위치는 grep으로 `widgetPositionCache` 선언부 찾아 적용.)

- [ ] **Step 2: `openWidgetPopup`에서 `extra` 저장 + 복원**

[electron/main.ts:1339] `openWidgetPopup` 본문 수정:

```ts
function openWidgetPopup(widgetId: string, widgetTitle: string, extra?: Record<string, string>): { ok: boolean } {
  // 이미 열린 팝업이면 포커스
  const existing = widgetWindows.get(widgetId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }

  const savedPos = widgetPositionCache.get(widgetId);
  const initWidth = savedPos ? Math.max(280, savedPos.width) : 420;
  const initHeight = savedPos ? Math.max(200, savedPos.height) : 360;
  const initAOT = savedPos ? (savedPos.alwaysOnTop ?? true) : true;

  // 신규: 호출 시 넘어온 extra가 우선. 없으면 저장된 extra 복원.
  const effectiveExtra = extra ?? savedPos?.extra;

  // ... (BrowserWindow 생성 동일)

  let hash = `#widget-popup/${encodeURIComponent(widgetId)}`;
  if (effectiveExtra && Object.keys(effectiveExtra).length > 0) {
    const qs = new URLSearchParams(effectiveExtra).toString();
    hash += `?${qs}`;
  }
  // ... (loadURL/loadFile)

  // 위치 캐시 업데이트 시 extra도 포함
  const updatePositionCache = () => {
    if (popupWin.isDestroyed() || animatingWidgets.has(widgetId)) return;
    const b = popupWin.getBounds();
    widgetPositionCache.set(widgetId, {
      x: b.x, y: b.y, width: b.width, height: b.height,
      opacity: popupWin.getOpacity(),
      alwaysOnTop: popupWin.isAlwaysOnTop(),
      extra: effectiveExtra,  // 신규
    });
    // 파일 영속화는 기존 디바운스 경로 그대로
  };
  // ...
}
```

- [ ] **Step 3: 영속 파일 로드 시 하위 호환 확인**

`widget-positions.json` 로드하는 함수(grep `widgetPositionCache` 로드)에서 구버전 파일(extra 미존재) 로드가 crash 없이 처리되는지 확인. `extra?: Record<string, string>`이 optional이라 자연스럽게 호환되어야 하나 JSON.parse 후 그대로 Map에 넣는지 검증.

- [ ] **Step 4: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 5: 수동 스모크 — EP 위젯 재실행 복원**

```bash
npm run electron:dev
```
1. 메인 창에서 EP 1 → "EP 통합 진행률" 팝업 띄움
2. 앱 종료(트레이에서 완전 종료)
3. 재실행 → 해당 위젯이 EP 1 데이터로 복원되는지 확인 (이전엔 빈 칸)

- [ ] **Step 6: 커밋**

```bash
git add electron/main.ts src/types/electron.d.ts
git commit -m "$(cat <<'EOF'
fix(widget): 플로팅 위젯 extra 파라미터 재시작 복원

widgetPositionCache에 extra(에피소드 번호 등)를 함께 저장하여
앱 종료 후 재실행 시 EP 위젯이 비지 않도록 한다.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 라쏘 스크롤 보정 + 메모 영역 제외 (이슈 ①)

**Files:**
- Modify: `src/views/ScenesView.tsx:21-114` — `useLassoSelection` 훅
- Modify: `src/components/scenes/UnifiedSceneCard.tsx:140-146` — 메모 래퍼에 `data-no-lasso`

- [ ] **Step 1: 메모 래퍼에 `data-no-lasso` 속성 추가**

`src/components/scenes/UnifiedSceneCard.tsx`의 메모 영역(라인 140-146)을 다음과 같이 수정:

```tsx
{primaryScene.memo && (
  <div className="mx-4 mt-1" data-no-lasso>
    <p className="text-[11px] text-amber-400/70 leading-relaxed line-clamp-1">
      <HighlightText text={primaryScene.memo} query={searchQuery} />
    </p>
  </div>
)}
```

- [ ] **Step 2: `useLassoSelection` 훅에 스크롤 보정 추가**

`src/views/ScenesView.tsx` 라인 21-114 범위의 훅 전체 교체 (기존 형태 유지, `startScrollRef` + dx/dy 보정 + 임계값 5→8):

```ts
function useLassoSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  cardSelector: string,
  getSceneId: (el: Element) => string | null,
  onSelectionChange: (ids: Set<string>) => void,
  enabled: boolean,
) {
  const [lassoRect, setLassoRect] = useState<LassoRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const startScrollRef = useRef<{ top: number; left: number } | null>(null);
  const isDragging = useRef(false);
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="button"], [data-no-lasso], [contenteditable="true"]')) return;
      if (target.closest('[data-no-lasso]')) return; // 중복 방지
      if (e.button !== 0) return;

      startRef.current = { x: e.clientX, y: e.clientY };
      // 가장 가까운 스크롤 컨테이너의 초기 scrollTop/Left 기록
      const scrollEl = findScrollParent(target) ?? container;
      startScrollRef.current = { top: scrollEl.scrollTop, left: scrollEl.scrollLeft };
      isDragging.current = false;

      const onMouseMove = (me: MouseEvent) => {
        if (!startRef.current || !startScrollRef.current) return;
        const currScroll = findScrollParent(target) ?? container;
        const scrollDx = currScroll.scrollLeft - startScrollRef.current.left;
        const scrollDy = currScroll.scrollTop - startScrollRef.current.top;
        const dx = (me.clientX - startRef.current.x) - scrollDx;
        const dy = (me.clientY - startRef.current.y) - scrollDy;

        // 8px 임계(기존 5 → 완화) — 스크롤 보정 이후의 실제 마우스 이동
        if (!isDragging.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        isDragging.current = true;

        const x = Math.min(startRef.current.x, me.clientX);
        const y = Math.min(startRef.current.y, me.clientY);
        const w = Math.abs(me.clientX - startRef.current.x);
        const h = Math.abs(me.clientY - startRef.current.y);
        setLassoRect({ x, y, w, h });

        const cards = container.querySelectorAll(cardSelector);
        const selected = new Set<string>();
        cards.forEach((card) => {
          const rect = card.getBoundingClientRect();
          if (rect.left < x + w && rect.right > x && rect.top < y + h && rect.bottom > y) {
            const id = getSceneId(card);
            if (id) selected.add(id);
          }
        });
        if (selected.size !== prevIds.current.size || ![...selected].every((id) => prevIds.current.has(id))) {
          prevIds.current = selected;
          onSelectionChange(selected);
        }
      };

      const onMouseUp = (me: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!isDragging.current) {
          if (!me.ctrlKey && !me.metaKey) {
            onSelectionChange(new Set());
            prevIds.current = new Set();
          }
        }
        startRef.current = null;
        startScrollRef.current = null;
        isDragging.current = false;
        setLassoRect(null);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    container.addEventListener('mousedown', onMouseDown);
    return () => container.removeEventListener('mousedown', onMouseDown);
  }, [enabled, containerRef, cardSelector, getSceneId, onSelectionChange]);

  return { lassoRect, isSelecting: isDragging.current };
}

// 유틸: 가장 가까운 스크롤 가능 부모
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const style = getComputedStyle(cur);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}
```

- [ ] **Step 3: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 4: 수동 스모크 — 메모 클릭 / 빈 영역 드래그**

```bash
npm run electron:dev
```
1. 씬 뷰 → 카드 뷰로 전환
2. 스크롤 최상단 상태에서 2번 컷 메모 영역 클릭 → 라쏘 안 뜨고 단일 클릭으로만 처리되는지 확인
3. 카드들 사이 빈 영역에서 드래그 → 기존처럼 라쏘 선택 정상 동작
4. 카드 빠르게 클릭(5~7px 미세 떨림 허용되는지) 확인

- [ ] **Step 5: 커밋**

```bash
git add src/views/ScenesView.tsx src/components/scenes/UnifiedSceneCard.tsx
git commit -m "$(cat <<'EOF'
fix(scenes): 카드 메모 클릭 시 라쏘 오인식 방지

1. 메모 래퍼에 data-no-lasso 추가, 라쏘 제외 셀렉터 확장
2. mousedown 시점의 scrollTop/Left를 기억해 dx/dy에서 스크롤 변화를 보정
3. 드래그 임계값 5→8px로 완화하여 미세 떨림을 클릭으로 처리

스크롤 최상단에서 상단 카드 메모 클릭 → 스크롤 이동으로 인한 가짜 드래그를 방지.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: 글자 색상 및 위젯 통일 (Task 5–8)

### Task 5: `applyTextColors` + 카테고리 CSS 변수 (이슈 ⑤ 코어)

**Files:**
- Modify: `src/utils/typography.ts` — `TextColorSettings`, `applyTextColors` 추가
- Modify: `src/services/settingsService.ts` — `UserPreferences.fontCategoryColors`, `fontColorPreset` 필드 추가
- Modify: `src/index.css` — 카테고리별 color CSS 규칙 추가

- [ ] **Step 1: 기존 `text-text-*` 사용처 그렙 (리뷰 권고 반영)**

```bash
grep -r "text-text-primary\|text-text-secondary" src/components src/views src/App.tsx | wc -l
```
Expected: 수를 기록. 신규 CSS 변수 도입 시 기존 명시 클래스 컴포넌트는 영향 없음 — 확인 용도.

- [ ] **Step 2: `typography.ts`에 색상 타입 + `applyTextColors` 추가**

파일 끝에 추가:

```ts
// ─── 카테고리 색상 ─────────────────────────────

export type FontColorPreset = 'theme' | 'high-contrast' | 'soft' | 'mono' | 'custom';

export interface FontCategoryColors {
  heading?: string;  // RGB triplet "R G B" (예: "232 232 238")
  body?: string;
  caption?: string;
  micro?: string;
}

export const FONT_COLOR_PRESETS: Record<FontColorPreset, { label: string; getColors: (themePrimary: string, themeSecondary: string, themeAccentSub: string) => FontCategoryColors }> = {
  theme: {
    label: '테마 기본',
    getColors: () => ({}),  // 모두 --color-text-primary 폴백
  },
  'high-contrast': {
    label: '고대비',
    getColors: (primary, secondary) => ({
      heading: '255 255 255',
      body: primary,
      caption: secondary,
      micro: secondary,
    }),
  },
  soft: {
    label: '부드러움',
    getColors: (primary, secondary, accentSub) => ({
      heading: accentSub,
      body: primary,
      caption: secondary,
      micro: secondary,
    }),
  },
  mono: {
    label: '단색',
    getColors: (primary) => ({
      heading: primary,
      body: primary,
      caption: primary,
      micro: primary,
    }),
  },
  custom: {
    label: '사용자 지정',
    getColors: () => ({}),  // UI에서 직접 세팅
  },
};

export function applyTextColors(colors: FontCategoryColors): void {
  const root = document.documentElement;
  const set = (key: keyof FontCategoryColors, cssVar: string) => {
    const val = colors[key];
    if (val) root.style.setProperty(cssVar, val);
    else root.style.removeProperty(cssVar);
  };
  set('heading', '--color-text-heading');
  set('body', '--color-text-body');
  set('caption', '--color-text-caption');
  set('micro', '--color-text-micro');
}

export function resetTextColors(): void {
  applyTextColors({});
}
```

- [ ] **Step 3: `settingsService.ts` `UserPreferences`에 필드 추가**

[src/services/settingsService.ts:70-128] 인터페이스에 `fontCategoryScales` 아래에 추가:

```ts
// 글자 카테고리별 색상
fontCategoryColors?: {
  heading?: string;
  body?: string;
  caption?: string;
  micro?: string;
};
fontColorPreset?: 'theme' | 'high-contrast' | 'soft' | 'mono' | 'custom';
```

- [ ] **Step 4: `src/index.css`에 카테고리 색상 CSS 규칙 추가**

라인 61 부근 `:root` 블록 다음에 추가(기존 변수 유지):

```css
/* 글자 카테고리별 색상 — 미지정 시 --color-text-primary 폴백 */
.text-xl, .text-lg, h1, h2, h3 {
  color: rgb(var(--color-text-heading, var(--color-text-primary)));
}
.text-base, .text-sm {
  color: rgb(var(--color-text-body, var(--color-text-primary)));
}
.text-xs {
  color: rgb(var(--color-text-caption, var(--color-text-primary)));
}
.text-\[11px\], .text-\[10px\], .text-\[9px\] {
  color: rgb(var(--color-text-micro, var(--color-text-primary)));
}
```

**주의:** 명시적으로 `text-text-primary`/`text-text-secondary` 등 Tailwind 클래스를 지정한 요소는 Tailwind 규칙이 더 구체적이라 영향 없음 — Step 1의 그렙 결과 확인 대조.

- [ ] **Step 5: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 6: 커밋**

```bash
git add src/utils/typography.ts src/services/settingsService.ts src/index.css
git commit -m "$(cat <<'EOF'
feat(typography): 글자 카테고리별 색상 CSS 변수 기반 적용 함수

applyTextColors()가 --color-text-{heading,body,caption,micro} 변수를 세팅한다.
4개 프리셋(theme/high-contrast/soft/mono/custom) 정의.
index.css는 카테고리별 color 규칙을 primary 폴백으로 추가 — 기존 명시 클래스는 불변.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `FontColorSection` UI 추가 (이슈 ⑤ UI)

**Files:**
- Create: `src/components/settings/FontColorSection.tsx`
- Modify: `src/components/settings/SettingsScreen.tsx` (또는 설정 진입점 파일) — 신규 섹션 마운트

- [ ] **Step 1: 설정 진입점 파일 확인**

```bash
grep -rn "FontSizeSection" src/components/settings
```
→ 사용처 파일 확인 후 Step 3에서 동일한 곳에 `FontColorSection` 추가.

- [ ] **Step 2: `FontColorSection.tsx` 작성**

`src/components/settings/FontColorSection.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { FONT_CATEGORIES, FONT_COLOR_PRESETS, applyTextColors, type FontColorPreset, type FontCategoryColors } from '@/utils/typography';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { useAppStore } from '@/stores/useAppStore';
import { getPreset, getLightColors } from '@/themes';

function parseTriplet(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(' ').map(Number);
  return [r || 0, g || 0, b || 0];
}
function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex: string): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

export function FontColorSection() {
  const themeId = useAppStore((s) => s.themeId);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const colorMode = useAppStore((s) => s.colorMode);

  const [preset, setPreset] = useState<FontColorPreset>('theme');
  const [colors, setColors] = useState<FontCategoryColors>({});
  const [advanced, setAdvanced] = useState(false);

  // 현재 테마 색상 참조
  const themeColors = customThemeColors ?? (colorMode === 'light' ? getLightColors(themeId) : getPreset(themeId)?.colors);
  const primary = themeColors?.textPrimary ?? '232 232 238';
  const secondary = themeColors?.textSecondary ?? '139 141 163';
  const accentSub = themeColors?.accentSub ?? '162 155 254';

  useEffect(() => {
    (async () => {
      const prefs = await loadPreferences();
      if (prefs?.fontColorPreset) setPreset(prefs.fontColorPreset);
      if (prefs?.fontCategoryColors) setColors(prefs.fontCategoryColors);
    })();
  }, []);

  const handlePresetChange = async (p: FontColorPreset) => {
    setPreset(p);
    const nextColors = p === 'custom'
      ? colors
      : FONT_COLOR_PRESETS[p].getColors(primary, secondary, accentSub);
    setColors(nextColors);
    applyTextColors(nextColors);
    const prev = (await loadPreferences()) ?? {};
    await savePreferences({ ...prev, fontColorPreset: p, fontCategoryColors: nextColors });
    window.electronAPI?.preferencesBroadcastChange?.({ fontColorPreset: p, fontCategoryColors: nextColors });
  };

  const handleCategoryColor = async (cat: keyof FontCategoryColors, hex: string) => {
    const next = { ...colors, [cat]: fromHex(hex) };
    setColors(next);
    setPreset('custom');
    applyTextColors(next);
    const prev = (await loadPreferences()) ?? {};
    await savePreferences({ ...prev, fontColorPreset: 'custom', fontCategoryColors: next });
    window.electronAPI?.preferencesBroadcastChange?.({ fontColorPreset: 'custom', fontCategoryColors: next });
  };

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-lg font-bold">글자 색상</h3>
        <p className="text-xs text-text-secondary">카테고리별 색상을 프리셋 또는 사용자 지정으로 변경합니다.</p>
      </header>

      {/* 프리셋 */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FONT_COLOR_PRESETS) as FontColorPreset[]).map((p) => (
          <button
            key={p}
            onClick={() => handlePresetChange(p)}
            className={`px-3 py-1.5 rounded text-xs border ${preset === p ? 'bg-accent text-on-accent border-accent' : 'border-bg-border text-text-primary hover:bg-bg-card'}`}
          >
            {FONT_COLOR_PRESETS[p].label}
          </button>
        ))}
      </div>

      {/* 고급 모드 토글 */}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
        고급 설정 (카테고리별 색상 개별 지정)
      </label>

      {advanced && (
        <div className="space-y-3">
          {FONT_CATEGORIES.map((cat) => {
            const current = colors[cat.id]
              ?? (preset !== 'custom' ? FONT_COLOR_PRESETS[preset].getColors(primary, secondary, accentSub)[cat.id] : undefined)
              ?? primary;
            return (
              <div key={cat.id} className="flex items-center gap-3">
                <div className="w-20 text-xs text-text-secondary">{cat.label}</div>
                <input
                  type="color"
                  value={toHex(parseTriplet(current))}
                  onChange={(e) => handleCategoryColor(cat.id, e.target.value)}
                  className="w-10 h-8 rounded cursor-pointer"
                />
                <span className={`${cat.cssClass} flex-1`}>{cat.previewText}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: 설정 화면에 마운트**

Step 1에서 찾은 파일에서 `FontSizeSection` 아래에 `<FontColorSection />` 추가. import 경로도 추가.

- [ ] **Step 4: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 5: 수동 스모크 — 프리셋 전환 / 고급 모드**

```bash
npm run electron:dev
```
1. 설정 → 글자 색상 섹션 진입 확인
2. 프리셋 `high-contrast` 선택 → 제목 밝아짐 확인
3. 고급 모드 체크 → 본문 색상 커스텀 → 즉시 반영 확인
4. 앱 재시작 → 마지막 선택이 유지되는지 확인

- [ ] **Step 6: 커밋**

```bash
git add src/components/settings/FontColorSection.tsx src/components/settings
git commit -m "$(cat <<'EOF'
feat(settings): 글자 카테고리별 색상 섹션 UI 추가

프리셋 5종(theme/high-contrast/soft/mono/custom) + 고급 모드에서
카테고리별 color picker. 변경 시 savePreferences + preferencesBroadcastChange.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `WidgetPopup` 초기화 통합 + 브로드캐스트 구독 (이슈 ②)

**Files:**
- Modify: `src/views/WidgetPopup.tsx:287-371` — 초기화 루틴에 `loadPreferences` + `applyFontSettings` + `applyTextColors` 호출, `onPreferencesChanged` 구독
- Modify: `src/App.tsx` — 설정 저장 직후 `preferencesBroadcastChange` 호출 (이미 Task 6에서 FontColorSection이 호출하므로 FontSizeSection에도 동일 호출 추가)
- Modify: `src/components/settings/FontSizeSection.tsx` — 변경 시 broadcast 추가

- [ ] **Step 1: `WidgetPopup` 초기화에 preferences 적용 코드 추가**

[src/views/WidgetPopup.tsx:287-371]의 `(async () => { ... })` 본문 `loadTheme` 직후에 추가:

```ts
// 글꼴 크기 + 색상 적용
const prefs = await loadPreferences();
if (prefs) {
  applyFontSettings({
    fontScale: (prefs.fontScale as FontScale) ?? DEFAULT_FONT_SCALE,
    fontCategoryScales: {
      heading: prefs.fontCategoryScales?.heading ?? 1,
      body: prefs.fontCategoryScales?.body ?? 1,
      caption: prefs.fontCategoryScales?.caption ?? 1,
      micro: prefs.fontCategoryScales?.micro ?? 1,
    },
  });
  applyTextColors(prefs.fontCategoryColors ?? {});
}
```

import 추가:
```ts
import { loadPreferences } from '@/services/settingsService';
import { applyFontSettings, applyTextColors, DEFAULT_FONT_SCALE, type FontScale } from '@/utils/typography';
```

- [ ] **Step 2: `onPreferencesChanged` 구독 추가**

`WidgetPopup` 내 별도 `useEffect`:

```ts
useEffect(() => {
  const cleanup = window.electronAPI?.onPreferencesChanged?.((_payload) => {
    // 가장 단순한 방법: 재로드
    loadPreferences().then((prefs) => {
      if (!prefs) return;
      applyFontSettings({
        fontScale: (prefs.fontScale as FontScale) ?? DEFAULT_FONT_SCALE,
        fontCategoryScales: {
          heading: prefs.fontCategoryScales?.heading ?? 1,
          body: prefs.fontCategoryScales?.body ?? 1,
          caption: prefs.fontCategoryScales?.caption ?? 1,
          micro: prefs.fontCategoryScales?.micro ?? 1,
        },
      });
      applyTextColors(prefs.fontCategoryColors ?? {});
    });
  });
  return () => { cleanup?.(); };
}, []);
```

- [ ] **Step 3: 메인 앱도 동일하게 구독 (App.tsx)**

`src/App.tsx`의 기존 초기화 `useEffect` 안 또는 별도 effect로:

```ts
useEffect(() => {
  const cleanup = window.electronAPI?.onPreferencesChanged?.(() => {
    loadPreferences().then((prefs) => {
      if (!prefs) return;
      applyFontSettings({ fontScale: (prefs.fontScale as FontScale) ?? 'm', fontCategoryScales: { heading: 1, body: 1, caption: 1, micro: 1, ...prefs.fontCategoryScales } });
      applyTextColors(prefs.fontCategoryColors ?? {});
    });
  });
  return () => { cleanup?.(); };
}, []);
```

- [ ] **Step 4: `FontSizeSection`에 `preferencesBroadcastChange` 호출 추가**

기존에 저장하는 곳(프리셋 변경 / 카테고리 스케일 슬라이더) 마지막에:

```ts
window.electronAPI?.preferencesBroadcastChange?.({ fontScale: ..., fontCategoryScales: ... });
```

(기존 구조에서 이미 savePreferences를 호출하는 지점 직후에 추가.)

- [ ] **Step 5: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 6: 수동 스모크 — 메인 변경 → 플로팅 즉시 반영**

```bash
npm run electron:dev
```
1. 플로팅 위젯(예: "내 할일") 띄움
2. 메인에서 설정 → 글꼴 크기 xl로 변경
3. 플로팅 위젯도 즉시 큰 글씨로 전환되는지 확인
4. 글자 색상 프리셋 변경도 동일하게 플로팅에 반영되는지 확인

- [ ] **Step 7: 커밋**

```bash
git add src/views/WidgetPopup.tsx src/App.tsx src/components/settings/FontSizeSection.tsx
git commit -m "$(cat <<'EOF'
fix(widget): 플로팅 위젯에 글꼴 크기/색상 적용 + 실시간 반영

WidgetPopup 초기화에서 loadPreferences → applyFontSettings/applyTextColors 호출.
FontSizeSection 변경 시 preferencesBroadcastChange 호출, 위젯과 메인이 구독 후 재적용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: "내 할일" 플로팅 세션 동기화 (이슈 ③)

**Files:**
- Modify: `src/views/WidgetPopup.tsx` — `onSessionChanged` 구독
- Modify: `src/App.tsx` — 로그인/로그아웃 시점에 `sessionBroadcastChange` 호출
- Modify: `src/components/widgets/MyTasksWidget.tsx` — `currentUser` 미설정 시 로딩 상태 표시

- [ ] **Step 1: 빌드 앱 재현 확인 (Task 1 로그 확인)**

Task 1에서 빌드 후 자동 로그인 실패의 실제 로그를 확인했다면, 그 결과를 먼저 공유받는다. 로그가 "세션 없음"으로 나오면 이슈 ③도 "세션 자체가 안 실려서" 발생한 것이므로 Task 1 근본 수정으로 함께 해결 — 이 경우 Task 8 Step 2–3만 보험으로 추가.

- [ ] **Step 2: `App.tsx`에서 로그인 성공 직후 broadcast**

로그인 처리 핸들러(예: `handleLogin`) 마지막에:

```ts
window.electronAPI?.sessionBroadcastChange?.({ user });
```

로그아웃 핸들러도 동일:

```ts
window.electronAPI?.sessionBroadcastChange?.({ user: null });
```

- [ ] **Step 3: `WidgetPopup`에서 구독**

```ts
useEffect(() => {
  const cleanup = window.electronAPI?.onSessionChanged?.((payload) => {
    const { user } = (payload as { user: AppUser | null }) ?? {};
    useAuthStore.getState().setCurrentUser(user ?? null);
  });
  return () => { cleanup?.(); };
}, []);
```

- [ ] **Step 4: `MyTasksWidget` 로딩 상태**

`activeView.type === 'assigned'` 분기 앞에 `currentUser === null && activeView.type === 'assigned'` 체크:

```tsx
if (activeView.type === 'assigned' && !currentUser) {
  return <div className="flex items-center justify-center h-full text-xs text-text-secondary/60">사용자 정보 로딩 중...</div>;
}
```

- [ ] **Step 5: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 6: 수동 스모크 — 메인 로그인 → 플로팅 갱신**

```bash
npm run electron:dev
```
1. 메인 로그아웃 상태에서 "내 할일" 플로팅 띄움(가능한 경우) → 로딩 메시지 확인
2. 메인 로그인 → 플로팅이 즉시 항목 채움
3. 메인 로그아웃 → 플로팅이 다시 로딩 상태

- [ ] **Step 7: 커밋**

```bash
git add src/views/WidgetPopup.tsx src/App.tsx src/components/widgets/MyTasksWidget.tsx
git commit -m "$(cat <<'EOF'
fix(widget): 플로팅 위젯 세션 동기화로 내 할일 빈 칸 해결

메인 앱 로그인/로그아웃 시 sessionBroadcastChange → 모든 위젯 창의
useAuthStore.currentUser를 동일 값으로 갱신. MyTasksWidget은 currentUser가
아직 없을 때 로딩 상태를 표시.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: 시각 효과 및 휴가 (Task 9–12)

### Task 9: `GradientBackdrop` 분리 + 파티클과 독립 토글 (이슈 ⑦)

**사전 탐색 결과 (플랜 작성 시 확인됨):**
- `plexusSettings` 타입: `src/stores/useAppStore.ts:110-121` (interface), 초기값: `:233-245`
- 플렉서스 설정 UI: `src/components/settings/EffectsSection.tsx`
- Dashboard.tsx 그라데이션 위치: 라인 127-150 (주석 `// ── 배경 그라데이션 조명` 부터 grd3의 `ctx.fillRect(0, 0, w, h);` 까지). 앞의 `ctx.clearRect`(라인 125)와 뒤의 파티클 물리 업데이트(라인 152~)는 유지.
- LoginScreen.tsx 그라데이션 위치: 라인 205-221 (`if (!isLight) {` 블록 내의 **중앙 그라데이션 `cg`**(206-212) + **마우스 글로우 `mg`**(215-221)). 노이즈 오버레이(`ctx.drawImage(noiseRef.current, 0, 0);`, 223)는 유지.

**Files:**
- Create: `src/components/common/GradientBackdrop.tsx`
- Modify: `src/views/Dashboard.tsx:125-150` — 그라데이션 블록만 제거
- Modify: `src/components/auth/LoginScreen.tsx:205-222` — `cg`/`mg` 블록 제거(노이즈 유지)
- Modify: `src/stores/useAppStore.ts:110-245` — `plexusSettings`에 gradient 플래그 추가
- Modify: `src/services/settingsService.ts:86-96` — `UserPreferences.plexus`에 동일 필드 추가
- Modify: `src/components/settings/EffectsSection.tsx` — 그라데이션 토글 UI

- [ ] **Step 1: `GradientBackdrop` 컴포넌트 작성**

`src/components/common/GradientBackdrop.tsx`:

```tsx
export function GradientBackdrop({ enabled = true }: { enabled?: boolean }) {
  if (!enabled) return null;
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -1,
        background: `
          radial-gradient(at 20% 10%, rgb(var(--color-accent) / 0.10) 0%, transparent 50%),
          radial-gradient(at 80% 90%, rgb(var(--color-accent-sub) / 0.08) 0%, transparent 50%),
          radial-gradient(at 50% 50%, rgb(var(--color-accent) / 0.04) 0%, transparent 60%)
        `,
      }}
    />
  );
}
```

- [ ] **Step 2: `Dashboard.tsx` canvas 그라데이션 제거 + 컴포넌트 마운트**

[src/views/Dashboard.tsx:127-150] 전체(`// ── 배경 그라데이션 조명 ...` 주석부터 grd3의 `ctx.fillRect(0, 0, w, h);` 까지)를 **통째로 삭제**한다. 앞 `ctx.clearRect(0, 0, w, h);`(125)와 뒤의 `const mx = mouseRef.current.x;` 이후 파티클 로직은 유지.

또한 `DashboardPlexus` 컴포넌트를 렌더하는 상위 JSX(파일 내 `<DashboardPlexus />` 사용처)가 있는 블록 앞에 다음 배치:

```tsx
<GradientBackdrop enabled={plexusSettings.dashboardGradientEnabled !== false} />
<DashboardPlexus />
```

import:
```ts
import { GradientBackdrop } from '@/components/common/GradientBackdrop';
```

- [ ] **Step 3: `LoginScreen.tsx` canvas 그라데이션 제거 + 컴포넌트 마운트**

[src/components/auth/LoginScreen.tsx:205-222] 중 `if (!isLight) { ... }` 블록 내부의 두 영역만 삭제:
- 중앙 그라데이션: `const cg = ctx.createRadialGradient(...)` 생성 ~ `ctx.fillRect(0, 0, w, h);` (대략 206-212)
- 마우스 글로우: `if (mouseRef.current.x > 0 && mouseRef.current.y > 0) { const mg = ... ctx.fillRect(0, 0, w, h); }` (대략 214-221)

**유지:** `ctx.drawImage(noiseRef.current, 0, 0);` (라인 223) — 노이즈 오버레이는 그라데이션이 아니므로 그대로 둔다.

`PlexusBackground` 컴포넌트를 감싸는 상위 JSX(파일 내 `<PlexusBackground />` 사용처) 앞:

```tsx
<GradientBackdrop enabled={plexusSettings.loginGradientEnabled !== false} />
<PlexusBackground />
```

- [ ] **Step 4: 스토어 + Preferences 타입 확장**

`src/stores/useAppStore.ts`의 `plexusSettings` 인터페이스(라인 110-121)에 추가:

```ts
plexusSettings: {
  loginEnabled: boolean;
  loginGradientEnabled: boolean;        // 신규
  loginParticleCount?: number;
  dashboardEnabled: boolean;
  dashboardGradientEnabled: boolean;    // 신규
  dashboardParticleCount?: number;
  speed?: number;
  mouseRadius?: number;
  mouseForce?: number;
  glowIntensity?: number;
  connectionDist?: number;
};
```

초기값(라인 233-245)에 `loginGradientEnabled: true`, `dashboardGradientEnabled: true` 추가.

`src/services/settingsService.ts:86-96`의 `UserPreferences.plexus`에도 동일한 두 optional 필드 추가:

```ts
plexus?: {
  loginEnabled?: boolean;
  loginGradientEnabled?: boolean;        // 신규
  loginParticleCount?: number;
  dashboardEnabled?: boolean;
  dashboardGradientEnabled?: boolean;    // 신규
  dashboardParticleCount?: number;
  speed?: number;
  mouseRadius?: number;
  mouseForce?: number;
  glowIntensity?: number;
  connectionDist?: number;
};
```

- [ ] **Step 5: 설정 UI에 그라데이션 토글 추가**

`src/components/settings/EffectsSection.tsx`를 열고, 기존 파티클 토글(`dashboardEnabled`, `loginEnabled`) 근처에 동일 패턴으로 추가:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={plexusSettings.dashboardGradientEnabled !== false}
    onChange={(e) => setPlexusSettings({ dashboardGradientEnabled: e.target.checked })}
  />
  대시보드 그라데이션 배경
</label>
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={plexusSettings.loginGradientEnabled !== false}
    onChange={(e) => setPlexusSettings({ loginGradientEnabled: e.target.checked })}
  />
  로그인 그라데이션 배경
</label>
```

(EffectsSection이 이미 `setPlexusSettings`로 저장/영속화 로직을 갖고 있다는 전제 — grep으로 확인 후 동일 메소드 사용. 저장 시 `savePreferences` 호출도 함께 있어야 함. 없으면 기존 토글 핸들러 패턴 그대로 복제.)

- [ ] **Step 6: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 7: 수동 스모크**

```bash
npm run electron:dev
```
1. 대시보드 파티클 OFF → 그라데이션 유지 확인(기존엔 완전 단색)
2. 대시보드 그라데이션 OFF → 단색 배경
3. 로그인 화면 동일 패턴 확인

- [ ] **Step 8: 커밋**

```bash
git add src/components/common/GradientBackdrop.tsx src/views/Dashboard.tsx src/components/auth/LoginScreen.tsx src/services/settingsService.ts src/stores
git commit -m "$(cat <<'EOF'
feat(ui): 대시보드/로그인 그라데이션을 파티클과 독립 토글

GradientBackdrop 컴포넌트를 canvas 외부 DOM 레이어로 분리.
plexus.dashboardGradientEnabled / loginGradientEnabled 설정 추가.
파티클 OFF 상태에서도 그라데이션 배경을 유지할 수 있음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 플렉서스 파티클 폴백/지연 수정 (이슈 ④)

**Files:**
- Modify: `src/components/auth/LoginScreen.tsx:48-77` — `getPlexusColors` 폴백 + 테마 로드 대기
- Modify: `src/views/Dashboard.tsx:77-84` — `getColors` 폴백 동일

- [ ] **Step 1: 폴백 배열을 accent 계열만으로 축소**

`src/components/auth/LoginScreen.tsx:48-77`의 `getPlexusColors()` 중 **폴백 배열만** 교체(라인 52):

```ts
// Before (라인 52)
if (!colors) return [[108, 92, 231], [162, 155, 254], [116, 185, 255], [0, 184, 148], [85, 239, 196]];

// After
if (!colors) return [[108, 92, 231], [162, 155, 254]];  // accent/accentSub 보라 계열만 — 파랑/청록 제거
```

**나머지 로직(HSL 기반 보색/유사색 생성, 최종 return 배열 8개)은 그대로 유지.** 테마가 로드된 정상 흐름에서는 기존과 동일하게 동작하며, 폴백 노출 시의 색상만 축소된다.

`src/views/Dashboard.tsx:77-84`의 `getColors()`는 이미 `[[108, 92, 231], [162, 155, 254]]` 폴백이므로 변경 불필요.

- [ ] **Step 2: 파티클 초기화를 테마 로드 후로 지연**

LoginScreen의 PlexusBackground 컴포넌트에 `themeReady` 체크 추가:

```tsx
function PlexusBackground() {
  const themeId = useAppStore((s) => s.themeId);  // 구독으로 변경 감지
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 테마가 한 번이라도 바뀌면(초기 로드 포함) ready
    setReady(true);
  }, [themeId]);

  useEffect(() => {
    if (!ready) return;
    // ... 기존 파티클 생성/애니메이션 로직
  }, [ready, themeId]);
  // ...
}
```

- [ ] **Step 3: 파티클 색을 매 프레임 최신 테마에서 resolve (LoginScreen + Dashboard 양쪽)**

**LoginScreen.tsx** 수정:

1. `Particle` 타입(라인 9 근처)에서 `color: [number, number, number]` → `colorIdx: number`로 교체.
2. `createParticle` 함수(라인 89-100)에서:
   ```ts
   // Before
   const cols = plexusColors ?? getPlexusColors();
   const color = cols[Math.floor(Math.random() * cols.length)];
   return { ..., color };

   // After
   const cols = plexusColors ?? getPlexusColors();
   const colorIdx = Math.floor(Math.random() * cols.length);
   return { ..., colorIdx };
   ```
3. 애니메이션 루프에서 `p.color` 참조를 전부 `getPlexusColors()[p.colorIdx % palette.length]`로 바꾼다. 매 프레임 상단에서 `const palette = getPlexusColors();`를 한 번 호출하고 루프에서 재사용:
   ```ts
   const palette = getPlexusColors();
   for (const p of particles) {
     const [r, g, b] = palette[p.colorIdx % palette.length];
     // 기존 fillStyle/strokeStyle에서 p.color → [r, g, b] 사용
   }
   ```
4. 연결선 렌더에서 `pts[i].color` → `palette[pts[i].colorIdx % palette.length]`.

**Dashboard.tsx** 수정 (동일 패턴):

1. `DashPt` 타입에서 `color` → `colorIdx`.
2. `resize` 내 파티클 생성(라인 97-103)에서 `c` 대신 인덱스 저장:
   ```ts
   const cols = getColors();
   ptsRef.current = Array.from({ length: ptCount }, () => {
     const colorIdx = Math.floor(Math.random() * cols.length);
     return { x: ..., y: ..., vx: ..., vy: ..., size: ..., colorIdx, alpha: ... };
   });
   ```
3. 애니메이션 루프(`animate` 내부, 라인 118~)에서 매 프레임 최상단에 `const palette = getColors();` 추가. `p.color`, `pts[i].color` 참조를 `palette[p.colorIdx % palette.length]`로 교체.

**주의:** 타입 호환성 — 기존에 `p.color`를 쓰는 모든 라인을 TS 컴파일러가 잡아준다. `npx tsc --noEmit`으로 누락 확인.

- [ ] **Step 4: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 5: 수동 스모크**

```bash
npm run electron:dev
```
1. 로그인 화면 진입 → 파티클 색이 현재 테마 accent 계열만 보이는지 확인 (파랑/청록 없음)
2. 설정 → 테마 커스텀으로 accent 변경 → 대시보드 파티클이 새 색으로 전환되는지 확인

- [ ] **Step 6: 커밋**

```bash
git add src/components/auth/LoginScreen.tsx src/views/Dashboard.tsx
git commit -m "$(cat <<'EOF'
fix(plexus): 파티클 색상이 테마 따라가도록 수정

1. 폴백 팔레트에서 파랑/청록 제거 (accent/accentSub만)
2. 파티클은 색 인덱스만 저장, draw 시 매 프레임 최신 팔레트 조회
3. 테마 로드 전에는 파티클 초기화 지연 (폴백 색 일시 노출 방지)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 휴가 pending 상태 + 브로드캐스트 토스트 (이슈 ⑧)

**사전 탐색 결과:**
- 실제 휴가 등록 함수: `submitVacation(data)` — `src/services/vacationService.ts:60`. (플랜 초안의 `registerVacation`은 없는 함수. 시그니처는 `(data: { ... })` 형태.)
- `electron/main.ts`에 `fs`(라인 6), `path`(라인 5), `broadcastToAllWindows`(Task 2) 모두 이미 사용 가능.
- 30초 타임아웃 주체는 **메인 창(App.tsx)만** 담당. 플로팅 위젯에서는 중복 실행 방지.

**Files:**
- Modify: `electron/main.ts` — `vacation:pending:load/save` IPC, `vacation:registered/failed` broadcast
- Modify: `electron/preload.ts`, `src/types/electron.d.ts` — API 노출
- Create: `src/stores/useVacationPendingStore.ts` (Zustand store)
- Modify: `src/components/widgets/VacationWidget.tsx` — 낙관적 업데이트 + pending 렌더
- Modify: `src/components/widgets/CalendarWidget.tsx` — pending 이벤트 노란색 렌더
- Modify: `src/App.tsx`, `src/views/WidgetPopup.tsx` — `vacation:registered`/`failed` 구독 → sonner 토스트 (App.tsx에서만 30초 타임아웃)

- [ ] **Step 1: 메인 프로세스 IPC (파일 I/O + broadcast)**

`electron/main.ts`에 추가(파일 I/O와 broadcast 핸들러는 같은 섹션에 모은다). `fs`, `path`는 이미 import됨(라인 5-6).

```ts
const PENDING_VACATIONS_FILE = 'pendingVacations.json';

ipcMain.handle('vacation:pending:load', () => {
  try {
    const file = path.join(app.getPath('userData'), PENDING_VACATIONS_FILE);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    console.warn('[vacation] pending 로드 실패:', err);
    return [];
  }
});

ipcMain.handle('vacation:pending:save', (_e, list: unknown) => {
  try {
    const file = path.join(app.getPath('userData'), PENDING_VACATIONS_FILE);
    fs.writeFileSync(file, JSON.stringify(list ?? []), 'utf-8');
    return { ok: true };
  } catch (err) {
    console.error('[vacation] pending 저장 실패:', err);
    return { ok: false };
  }
});

ipcMain.handle('vacation:broadcast-registered', (_e, payload: unknown) => {
  broadcastToAllWindows('vacation:registered', payload);
  return { ok: true };
});

ipcMain.handle('vacation:broadcast-failed', (_e, payload: unknown) => {
  broadcastToAllWindows('vacation:failed', payload);
  return { ok: true };
});
```

- [ ] **Step 2: preload.ts + 타입 완전 정의**

`electron/preload.ts`에 추가(Task 2의 `onPreferencesChanged` 리스너 패턴을 동일하게 복제):

```ts
vacationPendingLoad: () =>
  ipcRenderer.invoke('vacation:pending:load'),
vacationPendingSave: (list: unknown) =>
  ipcRenderer.invoke('vacation:pending:save', list),
vacationBroadcastRegistered: (payload?: unknown) =>
  ipcRenderer.invoke('vacation:broadcast-registered', payload),
vacationBroadcastFailed: (payload?: unknown) =>
  ipcRenderer.invoke('vacation:broadcast-failed', payload),

onVacationRegistered: (callback: (payload: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on('vacation:registered', listener);
  return () => ipcRenderer.removeListener('vacation:registered', listener);
},
onVacationFailed: (callback: (payload: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on('vacation:failed', listener);
  return () => ipcRenderer.removeListener('vacation:failed', listener);
},
```

`src/types/electron.d.ts`의 `electronAPI` 인터페이스에 시그니처 추가:

```ts
vacationPendingLoad: () => Promise<unknown>;
vacationPendingSave: (list: unknown) => Promise<{ ok: boolean }>;
vacationBroadcastRegistered: (payload?: unknown) => Promise<{ ok: boolean }>;
vacationBroadcastFailed: (payload?: unknown) => Promise<{ ok: boolean }>;
onVacationRegistered: (cb: (payload: unknown) => void) => () => void;
onVacationFailed: (cb: (payload: unknown) => void) => () => void;
```

- [ ] **Step 3: `useVacationPendingStore` 작성**

`src/stores/useVacationPendingStore.ts`:

```ts
import { create } from 'zustand';
import type { VacationEvent } from '@/types';

interface PendingEvent extends VacationEvent {
  status: 'pending';
  pendingId: string;
  createdAt: number;
}

interface Store {
  pending: PendingEvent[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (ev: PendingEvent) => Promise<void>;
  remove: (pendingId: string) => Promise<void>;
  clearStale: (olderThanMs: number) => Promise<void>;
}

export const useVacationPendingStore = create<Store>((set, get) => ({
  pending: [],
  hydrated: false,
  hydrate: async () => {
    const list = (await window.electronAPI?.vacationPendingLoad?.()) as PendingEvent[] | null;
    set({ pending: list ?? [], hydrated: true });
  },
  add: async (ev) => {
    const next = [...get().pending, ev];
    set({ pending: next });
    await window.electronAPI?.vacationPendingSave?.(next);
  },
  remove: async (pendingId) => {
    const next = get().pending.filter((p) => p.pendingId !== pendingId);
    set({ pending: next });
    await window.electronAPI?.vacationPendingSave?.(next);
  },
  clearStale: async (olderThanMs) => {
    const now = Date.now();
    const next = get().pending.filter((p) => now - p.createdAt < olderThanMs);
    if (next.length !== get().pending.length) {
      set({ pending: next });
      await window.electronAPI?.vacationPendingSave?.(next);
    }
  },
}));
```

- [ ] **Step 4: `VacationWidget` 낙관적 업데이트 + pending 렌더**

`src/components/widgets/VacationWidget.tsx` 기존 등록 흐름을 찾아(`submitVacation`이 실제 API — `src/services/vacationService.ts:60`) 다음 패턴으로 래핑:

```ts
import { submitVacation } from '@/services/vacationService';
import { useVacationPendingStore } from '@/stores/useVacationPendingStore';

const handleRegister = async (data: Parameters<typeof submitVacation>[0]) => {
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // UI용 pending VacationEvent 합성 — 실제 필드는 data.dates/name 등에 맞춰 변환
  const pendingEvent = {
    ...data,
    pendingId,
    status: 'pending' as const,
    createdAt: Date.now(),
  };
  await useVacationPendingStore.getState().add(pendingEvent);
  try {
    await submitVacation(data);
    await useVacationPendingStore.getState().remove(pendingId);
    await window.electronAPI?.vacationBroadcastRegistered?.({ name: data.name });
    await load();  // 기존 위젯의 데이터 리로드
  } catch (err) {
    await useVacationPendingStore.getState().remove(pendingId);
    await window.electronAPI?.vacationBroadcastFailed?.({ error: String(err) });
  }
};
```

**주의:** `submitVacation` 실제 인자 형태는 `src/services/vacationService.ts:60-71`를 열어 복사. `VacationEvent` 타입은 `src/types`에서 import. pending 이벤트의 `pendingId`는 기존 키(`rowIndex`, `date+name` 등)와 충돌하지 않도록 `'pending-...'` prefix를 문자열로 보장.

pending 이벤트는 기존 이벤트 렌더 로직에 합류시키되 `className="bg-amber-400/20 border border-amber-400/60 text-amber-200"` 같은 노란 계열로 분기.

- [ ] **Step 5: `CalendarWidget`에도 pending 이벤트 병합 표시**

`src/components/widgets/CalendarWidget.tsx`에서:

```ts
import { useVacationPendingStore } from '@/stores/useVacationPendingStore';
const pending = useVacationPendingStore((s) => s.pending);
```

기존 이벤트 렌더 배열에 `pending`을 **concat**해서 함께 표시. pending 이벤트는 `pendingId`로 구분해 노란 스타일을 분기(`event.status === 'pending'` 또는 `'pendingId' in event` 체크). key로 `event.pendingId ?? event.id ?? \`${date}-${name}\``를 사용하여 기존 정상 이벤트 key와 충돌 없도록 한다.

- [ ] **Step 6: 토스트 구독 (App.tsx + WidgetPopup.tsx)**

```ts
import { toast } from 'sonner';

useEffect(() => {
  const cleanup = window.electronAPI?.onVacationRegistered?.(() => {
    toast.success('휴가 등록 완료');
  });
  return () => { cleanup?.(); };
}, []);
useEffect(() => {
  const cleanup = window.electronAPI?.onVacationFailed?.((payload) => {
    toast.error(`휴가 등록 실패: ${(payload as { error?: string })?.error ?? '알 수 없는 오류'}`);
  });
  return () => { cleanup?.(); };
}, []);
```

- [ ] **Step 7: 30초 타임아웃 (메인 창 전용)**

**App.tsx에서만** 실행(플로팅 위젯에서는 실행 금지 — 중복 방지):

```ts
useEffect(() => {
  // 초기 1회 + 이후 15초마다 오래된 pending 정리
  useVacationPendingStore.getState().hydrate();
  const timer = setInterval(() => {
    useVacationPendingStore.getState().clearStale(30_000);
  }, 15_000);
  return () => clearInterval(timer);
}, []);
```

`WidgetPopup.tsx`에서는 `hydrate()`만 호출하고 setInterval은 추가하지 않는다. 여러 플로팅 창이 동시에 setInterval을 돌릴 때 같은 파일을 동시에 여러 번 쓰는 경쟁 상태 방지.

`clearStale`에서 제거된 pending 각각에 대해 `sonner.toast.error('휴가 등록 타임아웃 (30초 경과) — 다시 시도해주세요')` 를 메인 창에서만 호출(Store 내부에서 broadcast 호출은 하지 않음 — 메인 창이 직접 처리).

- [ ] **Step 8: 타입 체크 + 빌드**

```bash
npx tsc --noEmit
npm run build:vite
```

- [ ] **Step 9: 수동 스모크**

```bash
npm run electron:dev
```
1. 휴가 등록 → 즉시 노란색 pending 표시
2. 대기 중 다른 탭 이동 후 돌아옴 → 여전히 노란색
3. 등록 완료 → 어느 화면이든 "휴가 등록 완료" 토스트
4. 네트워크 끊은 채 등록 → 30초 뒤 자동 실패 토스트

- [ ] **Step 10: 커밋**

```bash
git add electron/main.ts electron/preload.ts src/types/electron.d.ts src/stores/useVacationPendingStore.ts src/components/widgets/VacationWidget.tsx src/components/widgets/CalendarWidget.tsx src/services/vacationService.ts src/App.tsx src/views/WidgetPopup.tsx
git commit -m "$(cat <<'EOF'
feat(vacation): 등록 중 pending 상태 + 완료 브로드캐스트 토스트

1. 낙관적 업데이트: 등록 요청 즉시 노란색 pending 이벤트 추가
2. pending 목록을 pendingVacations.json에 영속화 (화면 전환/재시작 유지)
3. 완료/실패 시 broadcastToAllWindows → 어느 창이든 sonner 토스트
4. 30초 타임아웃으로 무한 pending 방지

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 최종 빌드 검증 + 스모크 테스트

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 0 에러.

- [ ] **Step 2: 렌더러 빌드**

```bash
npm run build:vite
```
Expected: 번들 생성 성공.

- [ ] **Step 3: 개발 모드 스모크 (먼저)**

```bash
npm run electron:dev
```

아래 체크리스트 중 빌드가 필요 없는 항목을 개발 모드에서 먼저 확인. 이 단계에서 찾은 버그는 각 Task로 돌아가 수정.

- 카드 뷰 스크롤 최상단에서 메모 클릭 → 라쏘 안 생김 (이슈 ①)
- 설정 프리셋 xl 변경 → 모든 위젯 즉시 반영 (이슈 ②)
- "내 할일" 플로팅이 메인과 동일 항목 수 노출 (이슈 ③)
- 로그인/대시보드 파티클이 테마 색만 사용 (이슈 ④)
- 글자 카테고리 색상 프리셋 5종 + 고급 모드 동작 (이슈 ⑤)
- 파티클 OFF 시 그라데이션 유지 (이슈 ⑦)
- 휴가 등록 pending + 완료 토스트 전역 (이슈 ⑧)
- EP 위젯 재시작 후 데이터 복원 (이슈 ⑨, 개발 모드에서도 재현 가능)

- [ ] **Step 4: Electron 실제 빌드 (검증용 포터블 exe)**

```bash
npm run build
```
Expected: `release/BFLOW.exe` (또는 `dist-electron/` 하위 포터블 파일) 생성 성공.

- [ ] **Step 5: 빌드 앱 수동 스모크 — 이슈 ⑥ 중점**

빌드된 `BFLOW.exe`를 실행:

- [ ] 빌드 앱 최초 실행 → 로그인 → 앱 종료 → 재실행 → **자동 로그인 성공** (이슈 ⑥ 근본 수정 확인)
- [ ] Task 1에서 추가한 진단 로그 확인 (DevTools 콘솔) — 실패 시 로그로 원인 파악 후 Task 1-B로 근본 수정 추가
- [ ] `%APPDATA%\Bflow-BGonly\auth.json`이 실제 생성·읽기 가능한지 확인

- [ ] **Step 6: 기타 빌드 앱 스모크**

Step 3에서 개발 모드로 통과한 항목도 빌드 앱에서 재확인:

- [ ] 이슈 ①~⑨ 전부 빌드 앱에서도 동일하게 동작

**실패 시**: 해당 Task로 돌아가 수정 → 재빌드 → 재확인.

- [ ] **Step 7: 하위 호환 스모크**

1. 구버전 `widget-positions.json` 파일 그대로 둔 채 새 빌드 실행 → crash 없이 동작, 이후 extra 저장되어 새 포맷 반영
2. 구버전 `preferences.json` (fontCategoryColors 없는 상태) 로드 → 기본 색상 정상 동작

- [ ] **Step 8: 최종 커밋 (필요 시 lessons.md 업데이트)**

```bash
git add tasks/lessons.md  # 실행 중 얻은 교훈이 있으면
git commit -m "chore: Phase 마무리 검증 완료 + lessons 갱신"
```

---

## 체크리스트 — PR 올리기 전

- [ ] 모든 Task의 커밋이 브랜치에 쌓였는가
- [ ] `npm run build` 성공
- [ ] 수동 스모크 9건 모두 통과
- [ ] `ROADMAP.md` 해당 Phase 상태 갱신 (필요 시)
- [ ] 버전 범프 (`package.json` `1.9.0` → `1.10.0` — 기능 추가이므로 minor)

## 리스크 메모

- **Task 1 근본 수정**이 Task 1-A(로그 추가)만으로는 완결되지 않는다. 빌드 앱 재현 후 추가 커밋 필요. 해당 시점에 Task 1-B를 본 플랜에 추가로 기재.
- **Task 5의 CSS 선택자**가 전역에 적용된다. 기존 명시 클래스 사용처가 많다면 일부 UI에서 색이 바뀔 수 있음 — Step 1 그렙 결과로 사전 평가.
- **Task 11 파일 I/O** 경로가 한글 포함(드라이브 경로)일 가능성. `app.getPath('userData')`를 사용하므로 문제없어야 하나, 저장 실패 로그 확인.
