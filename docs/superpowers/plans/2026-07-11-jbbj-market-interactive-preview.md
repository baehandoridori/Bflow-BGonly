# JBBJ 증권 인터랙티브 프리뷰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B flow 사이드바에서 도트 전환으로 진입하는 배플레이그라운드와, 승인된 JBBJ 증권의 시장 홈·종목 상세·내 계좌 3화면을 실제로 눌러볼 수 있는 안전한 인터랙티브 프리뷰로 구현한다.

**Architecture:** 전역 `ViewMode`에는 `playground` 하나만 추가하고, 로비·JBBJ 하우스·증권의 내부 이동은 feature-local discriminated union으로 관리한다. 공개 종목/계좌 계산은 순수 도메인 함수와 주입 가능한 preview gateway 뒤에 두며, 운영 빌드에서는 `VITE_ENABLE_PLAYGROUND_PREVIEW=true`를 명시하지 않으면 사이드바 진입점을 숨긴다. 운영 포인트 원장·Supabase RPC·관리자 뉴스·자동 시세 엔진은 이 계획에 섞지 않고 별도의 거래 안전성 계획으로 구현한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Zustand 4, Tailwind CSS 3, Framer Motion 10, Canvas 2D, SVG, Node `node:test`

## Global Constraints

- 수정 대상은 `C:\Bflow-BGonly`뿐이며 참고용 Bflow 원본 레포는 수정하지 않는다.
- 승인 기준 문서는 `docs/superpowers/specs/2026-07-11-jbbj-beginner-stock-market-design.md`이고, v4 시장/종목 프리뷰와 v5 계좌 프리뷰의 정보 위계를 유지한다.
- 이번 계획은 사용자용 인터랙티브 프리뷰만 구현한다. Supabase 스키마, Electron IPC, 운영 포인트, 씬 완료 보상, 관리자 콘솔, 자동 시세 엔진, 랭킹은 수정하지 않는다.
- 프리뷰 데이터는 메모리에서만 유지하고 새로고침 시 승인된 seed로 초기화한다. `%APPDATA%`, `localStorage`, Supabase에 저장하지 않는다.
- 운영 빌드에서는 `VITE_ENABLE_PLAYGROUND_PREVIEW=true`가 아니면 Playground 메뉴를 숨긴다. 개발 서버에서는 기본 노출한다.
- 별도의 가상시장 경고 배너는 노출하지 않는다.
- JBBJ 시장은 24시간 열림으로 표시한다.
- 실제 종목명은 `JBBJ`, `YouTube`, `메타코미디`, `Netflix`, `Adobe`, `Wacom`, `Slack`, `Google Drive` 8개를 사용한다.
- 포인트는 정수로 계산하고, 소수 주식 수량은 `quantityMicros`(1주 = 1,000,000)로 계산해 부동소수 오차를 피한다.
- 상승/하락은 색만 쓰지 않고 `+/-`, `▲/▼`, 한국어 문장을 함께 표시한다.
- 토스 로고, 전용 폰트, 고유 아이콘, 브랜드 파란색, 화면 문구는 복제하지 않는다. B flow 테마 토큰과 자체 보라색을 사용한다.
- 신규 런타임 의존성은 추가하지 않는다.
- `prefers-reduced-motion: reduce`에서는 입자 생성을 생략하고 220ms 이하의 정지형 페이드로 대체한다.
- 데이터 변경은 preview gateway에도 낙관적 반영 → 확정 snapshot 수렴 → 실패 시 직전 confirmed snapshot 복원 순서를 지킨다.
- 구현 시작 시 `superpowers:using-git-worktrees`로 별도 worktree를 만들고, 현재 worktree의 미추적 로그·산출물·사용자 파일을 건드리지 않는다.
- 완료 판단 전에 `npm run test:playground`, `npm run typecheck`, `npm run build:vite`, 로그인 후 수동 검증을 모두 통과한다.

---

## 범위 경계와 후속 계획

이 계획의 결과물은 실제 앱 안에서 디자인·탐색·계산·매수/매도·포인트 넣기/빼기·실패 롤백을 검증하는 프리뷰다. 운영 포인트를 활성화하려면 별도 계획에서 다음을 먼저 확정하고 구현해야 한다.

1. 다중 담당 씬의 보상 분배 정책과 BG/액팅 중복 보상 정책
2. 씬 완료·게임 점수 보상의 exactly-once event key, 완료 취소/재완료/담당자 변경, 일일 cap과 서버 점수 검증
3. `playground_accounts`, append-only `point_ledger`, `market_stocks`, `market_price_events`, `market_holdings`, `market_trades`, `market_orders`, `market_news` 스키마와 nonnegative/reconciliation 규칙
4. renderer가 user/admin id를 주장하지 못하도록 canonical session·role·RLS를 사용하는 Electron main 서비스와 원자적 Supabase RPC
5. `clientMutationId` 멱등성, account row lock, direct DML 차단, quote revision과 stale-price 거절, 지정가 예약자금·취소·만료·체결 worker
6. Realtime 재연결 catch-up, 사용자 전환 epoch, 확정 snapshot version
7. 관리자 종목·뉴스·가격 조정의 예약·승인·되돌리기·감사 로그와 시세 계산 규칙, 부분체결의 micro-point carry/dust 보존 규칙
8. 포인트 랭킹의 자산 기준 `지갑 + 예수금 + 보유 주식 청산가치`
9. 랭킹에 포함되지 않는 별도 연습계좌
10. 테트리스·스도쿠·스네이크의 점수 구간별 차등 포인트와 반복 획득 상한
11. 종목별·전체·이달의 수익률 랭킹: 순입금 제외 분모, KST 월 경계, 기간 시작 평가액, 최소 거래 조건, 동률, 0원/휴면 계좌, 연습·관리자 계좌 제외, 청산 종목 처리 규칙과 period snapshot

프리뷰 구현 중에는 위 항목을 임시 로컬 영구 저장으로 대체하지 않는다.

## File Structure

### Existing files to modify

- `src/stores/useAppStore.ts` — 전역 `ViewMode`에 `playground` 하나만 추가한다.
- `src/components/layout/Sidebar.tsx` — 배플레이그라운드 메뉴, 클릭 원점 수집, preview feature flag 적용.
- `src/components/layout/MainLayout.tsx` — Playground에서 기존 Header를 숨기고 본문 padding을 제거하는 immersive 변형.
- `src/components/layout/Header.tsx` — fallback 제목 맵에 배플레이그라운드 추가.
- `src/utils/navigationBackStack.ts` — back stack label 추가.
- `src/App.tsx` — `PlaygroundView` lazy route와 전역 도트 전환 overlay 마운트.
- `src/index.css` — market up/down/flat/news semantic color의 dark/light CSS 변수.
- `tailwind.config.js` — semantic color를 `market.*` Tailwind 토큰으로 노출.
- `package.json` — `test:playground` 추가 및 `build`, `build:vite` gate 연결.
- `docs/superpowers/specs/2026-07-11-jbbj-beginner-stock-market-design.md` — 구현 완료 시 프리뷰 상태와 검증 결과 기록.

### New route and transition files

- `src/features/playground/featureFlag.ts` — 개발/명시적 QA 빌드에서만 프리뷰 진입 허용.
- `src/features/playground/routes.ts` — lobby/house/coming-soon/market 내부 route union과 reducer.
- `src/features/playground/recommendation.ts` — 중앙 추천을 mount당 한 번 선택하는 순수 함수.
- `src/features/playground/transition/dotWipeMath.ts` — 클릭 원점, particle budget, phase timeline 순수 계산.
- `src/features/playground/transition/DotWipeTransition.tsx` — 재사용 가능한 Canvas dot-wipe.
- `src/features/playground/transition/usePlaygroundEntryStore.ts` — sidebar 진입 request만 보관.
- `src/features/playground/transition/PlaygroundEntryOverlay.tsx` — 화면을 덮은 순간 `setView('playground')`를 한 번 실행.
- `src/views/PlaygroundView.tsx` — A 로비 기본, C안 JBBJ 하우스, 목적지 전환 조정.
- `src/views/playground/PlaygroundLobby.tsx` — 랜덤 중앙 추천과 게임 카드.
- `src/views/playground/JbbjHouse.tsx` — C안 전용 공간.
- `src/views/playground/ComingSoonGame.tsx` — 테트리스/스도쿠/스네이크의 명확한 준비 중 화면.

### New market domain and UI files

- `src/features/playground/market/types.ts` — 종목, series, account, holding, command, snapshot 타입.
- `src/features/playground/market/domain.ts` — 계좌 합계, 검증, 주문/이체 projection, SVG point 계산.
- `src/features/playground/market/seed.ts` — 8개 종목과 승인 예시 계좌의 deterministic seed.
- `src/features/playground/market/previewGateway.ts` — 메모리 snapshot에 command를 적용하고 canonical snapshot을 반환.
- `src/features/playground/market/useMarketPreviewStore.ts` — confirmed/visible snapshot, 단일 mutation gate, rollback.
- `src/views/playground/market/MarketRouter.tsx` — home/stock/account 내부 route 분기.
- `src/views/playground/market/MarketDataBoundary.tsx` — 초기 loading skeleton, read error, retry, mutation aria-live.
- `src/views/playground/market/MarketNav.tsx` — 시장 홈·종목 둘러보기·내 계좌·검색.
- `src/views/playground/market/MarketHome.tsx` — 오늘 요약, 찜, 뉴스, 8개 종목, 초보 미션.
- `src/views/playground/market/MarketRows.tsx` — 관심 카드와 전체 종목 행.
- `src/views/playground/market/StockDetailView.tsx` — 승인된 상세 정보 순서.
- `src/views/playground/market/MarketPriceChart.tsx` — 기간별 SVG 선 그래프와 뉴스 marker.
- `src/views/playground/market/MarketOrderPanel.tsx` — 100/500/1,000P/최대 매수와 25/50/전부 매도.
- `src/views/playground/market/MarketActionDialog.tsx` — 주문 확인과 포인트 이동에 쓰는 접근 가능한 dialog shell.
- `src/views/playground/market/MarketAccountView.tsx` — 184px 메뉴 + 520px 자산 단일 컬럼.
- `src/views/playground/market/PointTransferDialog.tsx` — 넣기/빼기 분리 흐름.

### New tests

- `tests/playgroundNavigationWiring.test.ts`
- `tests/playgroundTransition.test.ts`
- `tests/playgroundRoutes.test.ts`
- `tests/playgroundMarketDomain.test.ts`
- `tests/playgroundMarketPreviewStore.test.ts`
- `tests/playgroundMarketUiWiring.test.ts`
- `tests/playgroundMarketTheme.test.ts`

---

### Task 1: Preview-gated Playground route and immersive layout

**Files:**
- Create: `src/features/playground/featureFlag.ts`
- Create: `src/views/PlaygroundView.tsx`
- Create: `tests/playgroundNavigationWiring.test.ts`
- Create: `tsconfig.playground-tests.json`
- Modify: `src/stores/useAppStore.ts:21`
- Modify: `src/components/layout/Sidebar.tsx:3,39-58,272-282,413-428`
- Modify: `src/components/layout/MainLayout.tsx:1-18`
- Modify: `src/components/layout/Header.tsx:19-35`
- Modify: `src/utils/navigationBackStack.ts:35-49`
- Modify: `src/App.tsx:8-21,2828-2877`

**Interfaces:**
- Produces: `isPlaygroundPreviewEnabled(env?: { DEV?: boolean; VITE_ENABLE_PLAYGROUND_PREVIEW?: string }): boolean`
- Produces: `resolveAllowedView(value, env?): ViewMode`, which rejects unknown and flag-disabled views
- Produces: global `ViewMode` member `'playground'`
- Produces: default export `PlaygroundView`
- Consumes: existing `useAppStore().currentView` and `setView(view)`

- [ ] **Step 1: Write the failing route contract test**

```ts
// tests/playgroundNavigationWiring.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isPlaygroundPreviewEnabled, resolveAllowedView } from '../src/features/playground/featureFlag.ts';
import { getNavigationBackLabel, type NavigationBackSourceState } from '../src/utils/navigationBackStack.ts';

const baseState: NavigationBackSourceState = {
  currentView: 'playground',
  selectedEpisode: null,
  selectedPart: null,
  selectedDepartment: 'all',
  dashboardDeptFilter: 'all',
  episodeDashboardEp: null,
  selectedAssignee: null,
  searchQuery: '',
  sortKey: 'no',
  sortDir: 'asc',
  statusFilter: 'all',
  sceneViewMode: 'sheet',
  sceneGroupMode: 'layout',
  settingsTab: null,
};

test('playground preview is on in dev and opt-in only in production', () => {
  assert.equal(isPlaygroundPreviewEnabled({ DEV: true }), true);
  assert.equal(isPlaygroundPreviewEnabled({ DEV: false }), false);
  assert.equal(isPlaygroundPreviewEnabled({ DEV: false, VITE_ENABLE_PLAYGROUND_PREVIEW: 'true' }), true);
  assert.equal(resolveAllowedView('playground', { DEV: false }), 'dashboard');
  assert.equal(resolveAllowedView('playground', { DEV: true }), 'playground');
  assert.equal(resolveAllowedView('not-a-view', { DEV: true }), 'dashboard');
});

test('playground has a stable navigation label', () => {
  assert.equal(getNavigationBackLabel(baseState), '배플레이그라운드');
});

test('sidebar, app and layout wire one global playground route', () => {
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const layout = readFileSync('src/components/layout/MainLayout.tsx', 'utf8');
  assert.match(sidebar, /id:\s*'playground'.*배플레이그라운드/);
  assert.match(app, /lazy\(\(\) => import\('@\/views\/PlaygroundView'\)\)/);
  assert.match(app, /case 'playground':/);
  assert.match(app, /resolveAllowedView\(savedPrefs\.defaultView\)/);
  assert.match(app, /resolveAllowedView\(currentView\)/);
  assert.match(layout, /currentView === 'playground'/);
});
```

- [ ] **Step 2: Run the route test and confirm the intended failure**

Run: `node --test ./tests/playgroundNavigationWiring.test.ts`

Expected: FAIL because `featureFlag.ts` and the `playground` ViewMode do not exist.

- [ ] **Step 3: Add the feature flag and global route**

```ts
// src/features/playground/featureFlag.ts
import type { ViewMode } from '@/stores/useAppStore';

export interface PlaygroundPreviewEnv {
  DEV?: boolean;
  VITE_ENABLE_PLAYGROUND_PREVIEW?: string;
}

export function isPlaygroundPreviewEnabled(
  env: PlaygroundPreviewEnv = import.meta.env,
): boolean {
  return env.DEV === true || env.VITE_ENABLE_PLAYGROUND_PREVIEW === 'true';
}

const KNOWN_VIEWS = new Set<ViewMode>([
  'dashboard', 'episode', 'scenes', 'assignee', 'team', 'calendar', 'schedule', 'vacation',
  'compositing', 'compositing-revisions', 'retake-hub', 'character-board', 'playground', 'settings',
]);

export function resolveAllowedView(
  value: unknown,
  env: PlaygroundPreviewEnv = import.meta.env,
): ViewMode {
  if (typeof value !== 'string' || !KNOWN_VIEWS.has(value as ViewMode)) return 'dashboard';
  if (value === 'playground' && !isPlaygroundPreviewEnabled(env)) return 'dashboard';
  return value as ViewMode;
}
```

Apply these exact route additions:

```ts
// src/stores/useAppStore.ts — add one member only
export type ViewMode =
  | 'dashboard'
  | 'episode'
  | 'scenes'
  | 'assignee'
  | 'team'
  | 'calendar'
  | 'schedule'
  | 'vacation'
  | 'compositing'
  | 'compositing-revisions'
  | 'retake-hub'
  | 'character-board'
  | 'playground'
  | 'settings';
```

```tsx
// src/views/PlaygroundView.tsx — temporary mount target for this task
export default function PlaygroundView() {
  return (
    <section className="min-h-full bg-bg-primary p-8 text-text-primary" aria-labelledby="playground-title">
      <h1 id="playground-title" tabIndex={-1} className="text-3xl font-semibold outline-none">
        배플레이그라운드
      </h1>
      <p className="mt-3 text-sm text-text-secondary">지금은 쉬는 시간!</p>
    </section>
  );
}
```

```tsx
// src/components/layout/Sidebar.tsx — import and NAV_ITEMS addition
import { Gamepad2 } from 'lucide-react';
import { isPlaygroundPreviewEnabled } from '@/features/playground/featureFlag';

{ id: 'character-board', label: '캐릭터', icon: <Drama size={20} /> },
{ id: 'playground', label: '배플레이그라운드', icon: <Gamepad2 size={20} /> },
{ id: 'settings', label: '설정', icon: <Settings size={20} /> },

// navItems filter chain — production default hidden
.filter((item) => item.id !== 'playground' || isPlaygroundPreviewEnabled())
```

```tsx
// src/App.tsx
import { resolveAllowedView } from '@/features/playground/featureFlag';
const PlaygroundView = lazy(() => import('@/views/PlaygroundView'));

// Resolve both saved preferences and every render; hiding the menu is not the security boundary.
useAppStore.getState().setView(resolveAllowedView(savedPrefs.defaultView));

// App component body, immediately before renderView(); never place this hook inside renderView().
const setView = useAppStore((state) => state.setView);
const safeCurrentView = resolveAllowedView(currentView);
useEffect(() => {
  if (safeCurrentView !== currentView) setView(safeCurrentView);
}, [currentView, safeCurrentView, setView]);

switch (safeCurrentView) {
case 'playground':
  return <PlaygroundView />;
```

```ts
// src/utils/navigationBackStack.ts — VIEW_LABELS
playground: '배플레이그라운드',
```

```ts
// src/components/layout/Header.tsx — VIEW_TITLES
playground: '배플레이그라운드',
```

- [ ] **Step 4: Make MainLayout immersive only for Playground**

```tsx
// src/components/layout/MainLayout.tsx
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/stores/useAppStore';
import { isPlaygroundPreviewEnabled } from '@/features/playground/featureFlag';

interface MainLayoutProps {
  children: React.ReactNode;
  onRefresh: () => void;
}

export function MainLayout({ children, onRefresh }: MainLayoutProps) {
  const currentView = useAppStore((state) => state.currentView);
  const immersive = currentView === 'playground' && isPlaygroundPreviewEnabled();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {!immersive && <Header onRefresh={onRefresh} />}
        <main className={immersive ? 'flex-1 overflow-hidden' : 'flex-1 overflow-auto p-4'}>
          {children}
        </main>
      </div>
    </div>
  );
}
```

Add a focused test TypeScript config so fixtures are not silently outside `tsconfig.json`:

`tsconfig.playground-tests.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/vite-env.d.ts", "tests/playground*.test.ts"]
}
```

- [ ] **Step 5: Run focused checks**

Run: `node --test ./tests/playgroundNavigationWiring.test.ts ./tests/navigationBackStack.test.ts ./tests/sidebarNavVisibility.test.ts`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: both TypeScript projects exit 0.

Run: `npx tsc -p tsconfig.playground-tests.json --noEmit`

Expected: the Playground test fixtures type-check and exit 0.

- [ ] **Step 6: Commit the route scaffold**

```powershell
git add src/features/playground/featureFlag.ts src/views/PlaygroundView.tsx src/stores/useAppStore.ts src/components/layout/Sidebar.tsx src/components/layout/MainLayout.tsx src/components/layout/Header.tsx src/utils/navigationBackStack.ts src/App.tsx tests/playgroundNavigationWiring.test.ts tsconfig.playground-tests.json
git commit -m "배플레이그라운드 프리뷰 진입 경로 추가"
```

---

### Task 2: Reusable click-origin dot transition

**Files:**
- Create: `src/features/playground/transition/dotWipeMath.ts`
- Create: `src/features/playground/transition/DotWipeTransition.tsx`
- Create: `src/features/playground/transition/usePlaygroundEntryStore.ts`
- Create: `src/features/playground/transition/PlaygroundEntryOverlay.tsx`
- Create: `tests/playgroundTransition.test.ts`
- Modify: `src/components/layout/Sidebar.tsx:413-428`
- Modify: `src/App.tsx:2972-2982`

**Interfaces:**
- Produces: `DotWipeRequest { id: number; origin: Point }`
- Produces: `getParticleBudget(width, height, reducedMotion): number`
- Produces: `<DotWipeTransition request onCovered onFinished />`
- Produces: `usePlaygroundEntryStore.getState().request(origin)`
- Consumes: `useAppStore.getState().setView('playground')`

- [ ] **Step 1: Write failing timeline tests**

```ts
// tests/playgroundTransition.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getParticleBudget,
  getHiddenTransitionAction,
  getTransitionFrame,
  originFromActivation,
  originFromRect,
} from '../src/features/playground/transition/dotWipeMath.ts';

test('sidebar button center becomes the particle origin', () => {
  assert.deepEqual(originFromRect({ left: 10, top: 20, width: 40, height: 30 }), { x: 30, y: 35 });
  assert.deepEqual(originFromActivation(73, 91, 1, { left: 10, top: 20, width: 40, height: 30 }), { x: 73, y: 91 });
  assert.deepEqual(originFromActivation(0, 0, 0, { left: 10, top: 20, width: 40, height: 30 }), { x: 30, y: 35 });
});

test('dot transition covers once before revealing', () => {
  assert.deepEqual(getTransitionFrame(0), { phase: 'covering', progress: 0, shouldCommit: false });
  assert.deepEqual(getTransitionFrame(500), { phase: 'revealing', progress: 0, shouldCommit: true });
  assert.equal(getTransitionFrame(750).shouldCommit, true);
  assert.deepEqual(getTransitionFrame(1200), { phase: 'finished', progress: 1, shouldCommit: false });
});

test('particle budget is capped and reduced motion creates no particles', () => {
  assert.equal(getParticleBudget(3840, 2160, true), 0);
  assert.ok(getParticleBudget(3840, 2160, false) <= 12000);
  assert.ok(getParticleBudget(1280, 720, false) >= 4000);
});

test('a hidden window fast-forwards instead of abandoning an active overlay', () => {
  assert.deepEqual(getHiddenTransitionAction(false), { commit: true, finish: true });
  assert.deepEqual(getHiddenTransitionAction(true), { commit: false, finish: true });
});
```

- [ ] **Step 2: Run the timeline test and confirm it fails**

Run: `node --test ./tests/playgroundTransition.test.ts`

Expected: FAIL because `dotWipeMath.ts` does not exist.

- [ ] **Step 3: Implement deterministic timing and budget math**

```ts
// src/features/playground/transition/dotWipeMath.ts
export interface Point { x: number; y: number }
export interface RectLike { left: number; top: number; width: number; height: number }
export type DotWipePhase = 'covering' | 'revealing' | 'finished';

export interface TransitionFrame {
  phase: DotWipePhase;
  progress: number;
  shouldCommit: boolean;
}

export const COVER_MS = 500;
export const TOTAL_MS = 1200;

export function originFromRect(rect: RectLike): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function originFromActivation(
  clientX: number,
  clientY: number,
  detail: number,
  rect: RectLike,
): Point {
  return detail === 0 ? originFromRect(rect) : { x: clientX, y: clientY };
}

export function getParticleBudget(width: number, height: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.max(4000, Math.min(12000, Math.round((width * height) / 220)));
}

export function getTransitionFrame(elapsedMs: number): TransitionFrame {
  if (elapsedMs >= TOTAL_MS) return { phase: 'finished', progress: 1, shouldCommit: false };
  if (elapsedMs >= COVER_MS) {
    return {
      phase: 'revealing',
      progress: (elapsedMs - COVER_MS) / (TOTAL_MS - COVER_MS),
      shouldCommit: true,
    };
  }
  return { phase: 'covering', progress: Math.max(0, elapsedMs / COVER_MS), shouldCommit: false };
}

export function getHiddenTransitionAction(alreadyCommitted: boolean) {
  return { commit: !alreadyCommitted, finish: true } as const;
}
```

- [ ] **Step 4: Implement the request store and Canvas overlay**

```ts
// src/features/playground/transition/usePlaygroundEntryStore.ts
import { create } from 'zustand';
import type { Point } from './dotWipeMath';

export interface DotWipeRequest { id: number; origin: Point }

interface PlaygroundEntryState {
  active: DotWipeRequest | null;
  request(origin: Point): void;
  finish(id: number): void;
}

export const usePlaygroundEntryStore = create<PlaygroundEntryState>((set, get) => ({
  active: null,
  request(origin) {
    if (get().active) return;
    set({ active: { id: Date.now(), origin } });
  },
  finish(id) {
    if (get().active?.id === id) set({ active: null });
  },
}));
```

`DotWipeTransition.tsx` must implement this exact behavior:

```tsx
export interface DotWipeTransitionProps {
  request: DotWipeRequest;
  label?: string;
  onCovered: () => void;
  onFinished: () => void;
}

// One fixed canvas, DPR capped at 1.5, one requestAnimationFrame loop.
// Cover 0-500ms, call onCovered exactly once, reveal 500-1200ms.
// Render "지금은 쉬는 시간!" as a DOM element above the aria-hidden canvas.
// When reduced motion matches, render no particles and use a 220ms opacity fade.
// Cancel RAF and 1800ms safety timeout on unmount only.
// On visibilitychange -> hidden, cancel RAF, call onCovered once if not committed,
// then call onFinished immediately. Never leave the store request active while hidden.
// Escape immediately calls onCovered if needed, then onFinished.
```

Use typed arrays allocated once per request:

```ts
const xs = new Float32Array(budget);
const ys = new Float32Array(budget);
const sizes = new Float32Array(budget);
const delays = new Float32Array(budget);
```

Render each frame with `ctx.fillRect(...)`; do not use per-particle `shadowBlur`, DOM nodes, or allocate objects inside the loop. If the first three frame durations exceed 24ms, halve the active budget. The 1800ms safety timeout must commit the route and clean up even if RAF stalls. `visibilitychange` must use `getHiddenTransitionAction(committedRef.current)` and fast-forward; it must not cancel the timeout without finishing.

```tsx
// src/features/playground/transition/PlaygroundEntryOverlay.tsx
import { useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { DotWipeTransition } from './DotWipeTransition';
import { usePlaygroundEntryStore } from './usePlaygroundEntryStore';

export function PlaygroundEntryOverlay() {
  const active = usePlaygroundEntryStore((state) => state.active);
  const finish = usePlaygroundEntryStore((state) => state.finish);
  const committedId = useRef<number | null>(null);

  if (!active) return null;

  return (
    <DotWipeTransition
      request={active}
      label="지금은 쉬는 시간!"
      onCovered={() => {
        if (committedId.current === active.id) return;
        committedId.current = active.id;
        useAppStore.getState().setView('playground');
      }}
      onFinished={() => {
        finish(active.id);
        requestAnimationFrame(() => document.getElementById('playground-title')?.focus());
      }}
    />
  );
}
```

- [ ] **Step 5: Route Playground sidebar clicks through the overlay**

```tsx
// src/components/layout/Sidebar.tsx imports
import { originFromActivation } from '@/features/playground/transition/dotWipeMath';
import { usePlaygroundEntryStore } from '@/features/playground/transition/usePlaygroundEntryStore';

// inside Sidebar
const requestPlaygroundEntry = usePlaygroundEntryStore((state) => state.request);

// nav button handler
onClick={(event) => {
  if (isAccessRetryItem) {
    handleAccessTipLeave();
    characterAccess.retry();
  } else if (item.id === 'playground') {
    requestPlaygroundEntry(originFromActivation(
      event.clientX,
      event.clientY,
      event.detail,
      event.currentTarget.getBoundingClientRect(),
    ));
  } else {
    setView(item.id);
  }
}}
```

```tsx
// src/App.tsx — import and mount once beside MainLayout
import { PlaygroundEntryOverlay } from '@/features/playground/transition/PlaygroundEntryOverlay';

<MainLayout onRefresh={loadData}>{renderView()}</MainLayout>
<PlaygroundEntryOverlay />
<SpotlightSearch />
```

- [ ] **Step 6: Run transition checks**

Run: `node --test ./tests/playgroundTransition.test.ts ./tests/playgroundNavigationWiring.test.ts`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit the transition**

```powershell
git add src/features/playground/transition src/components/layout/Sidebar.tsx src/App.tsx tests/playgroundTransition.test.ts
git commit -m "클릭 지점 기반 플레이그라운드 입장 전환 추가"
```

---

### Task 3: Market types, deterministic seed, and point-safe domain math

**Files:**
- Create: `src/features/playground/market/types.ts`
- Create: `src/features/playground/market/domain.ts`
- Create: `src/features/playground/market/seed.ts`
- Create: `tests/playgroundMarketDomain.test.ts`

**Interfaces:**
- Produces: `MarketSnapshot`, `MarketCommand`, `MarketAccount`, `MarketStock`, `Holding`
- Produces: `getAccountSummary(snapshot)`, `validateMarketCommand(snapshot, command)`, `applyMarketCommand(snapshot, command)`
- Produces: `createMarketPreviewSeed(): MarketSnapshot`
- Consumes: no React or Electron APIs

- [ ] **Step 1: Write failing account and order tests**

```ts
// tests/playgroundMarketDomain.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyMarketCommand,
  getAccountSummary,
  getSellProjection,
  getStockQuote,
  holdingValuePoints,
  validateMarketCommand,
} from '../src/features/playground/market/domain.ts';
import { createMarketPreviewSeed } from '../src/features/playground/market/seed.ts';

test('seed has the approved eight companies and account totals', () => {
  const snapshot = createMarketPreviewSeed();
  assert.deepEqual(snapshot.stocks.map((stock) => stock.name), [
    'JBBJ', 'YouTube', '메타코미디', 'Netflix', 'Adobe', 'Wacom', 'Slack', 'Google Drive',
  ]);
  assert.deepEqual(getAccountSummary(snapshot), {
    walletPoints: 18450,
    cashPoints: 3640,
    holdingsValuePoints: 7705,
    totalAssetsPoints: 11345,
    realizedPnlPoints: 1240,
    unrealizedPnlPoints: 205,
    monthlyUnrealizedChangePoints: 205,
    monthlyTotalPnlPoints: 1445,
  });
  assert.deepEqual(getStockQuote(snapshot.stocks[0]), { changePoints: 142, changeRate: 8.4, trend: 'up' });
  assert.equal(snapshot.beginnerMission, 'reason');
});

test('week, month and all series span distinct date ranges and end at current price', () => {
  const stock = createMarketPreviewSeed().stocks[0];
  const span = (period: 'today' | 'week' | 'month' | 'all') => (
    Date.parse(stock.series[period].at(-1)!.at) - Date.parse(stock.series[period][0].at)
  );
  assert.ok(span('today') < span('week'));
  assert.ok(span('week') < span('month'));
  assert.ok(span('month') < span('all'));
  for (const period of ['today', 'week', 'month', 'all'] as const) {
    assert.equal(stock.series[period].at(-1)?.pricePoints, stock.pricePoints);
    const marker = stock.series[period].find((point) => point.newsId === 'jbbj-news');
    assert.equal(marker?.at, new Date('2026-07-11T15:00:00+09:00').toISOString());
    const times = stock.series[period].map((point) => Date.parse(point.at));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
});

test('wallet transfer changes cash but never changes investment result', () => {
  const before = createMarketPreviewSeed();
  const after = applyMarketCommand(before, {
    kind: 'transfer', requestId: 'deposit-1', direction: 'wallet-to-broker', points: 1000,
  });
  assert.equal(after.account.walletPoints, 17450);
  assert.equal(after.account.cashPoints, 4640);
  assert.equal(getAccountSummary(after).monthlyTotalPnlPoints, 1445);
});

test('invalid commands explain why the action is unavailable', () => {
  const snapshot = createMarketPreviewSeed();
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'transfer', requestId: 'bad', direction: 'wallet-to-broker', points: 999999,
  }), '포인트 지갑 잔액이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'bad-buy', stockId: 'jbbj', points: 999999,
  }), '예수금이 부족해요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'bad-sell', stockId: 'google-drive', ratioBps: 2500,
  }), '보유한 주식이 없어요');
});

test('buy and sell use integer micro-shares', () => {
  const seed = createMarketPreviewSeed();
  const bought = applyMarketCommand(seed, {
    kind: 'buy', requestId: 'buy-1', stockId: 'google-drive', points: 500,
  });
  const holding = bought.account.holdings.find((item) => item.stockId === 'google-drive');
  assert.ok(holding && Number.isInteger(holding.quantityMicros));
  assert.ok(bought.account.cashPoints < seed.account.cashPoints);
});

test('beginner mission advances through favorite, reason, then first order', () => {
  const seed = createMarketPreviewSeed();
  seed.beginnerMission = 'favorite';
  const favorited = applyMarketCommand(seed, {
    kind: 'favorite', requestId: 'fav-1', stockId: 'adobe', wished: true,
  });
  assert.equal(favorited.beginnerMission, 'reason');
  const read = applyMarketCommand(favorited, {
    kind: 'read-reason', requestId: 'read-1', stockId: 'adobe',
  });
  assert.equal(read.beginnerMission, 'first-order');
  const ordered = applyMarketCommand(read, {
    kind: 'buy', requestId: 'buy-mission', stockId: 'adobe', points: 100,
  });
  assert.equal(ordered.beginnerMission, 'complete');
});

test('custom sell percentage stays between one and one hundred percent', () => {
  const snapshot = createMarketPreviewSeed();
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-low', stockId: 'jbbj', ratioBps: 99,
  }), '1%부터 100%까지 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-fraction', stockId: 'jbbj', ratioBps: 101,
  }), '매도 비율은 1% 단위로 입력해 주세요');
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-custom', stockId: 'jbbj', ratioBps: 3300,
  }), null);
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'sell', requestId: 'sell-high', stockId: 'jbbj', ratioBps: 10001,
  }), '1%부터 100%까지 입력해 주세요');
});

test('flat-price buy then partial sell does not invent a loss', () => {
  const seed = createMarketPreviewSeed();
  const bought = applyMarketCommand(seed, {
    kind: 'buy', requestId: 'tiny-buy', stockId: 'google-drive', points: 5,
  });
  const realizedBefore = bought.account.realizedPnlThisMonthPoints;
  const sold = applyMarketCommand(bought, {
    kind: 'sell', requestId: 'half-sell', stockId: 'google-drive', ratioBps: 5000,
  });
  assert.equal(sold.account.realizedPnlThisMonthPoints, realizedBefore);
});

test('every partial sell preserves the pre-sale rounded holding value', () => {
  const snapshot = createMarketPreviewSeed();
  for (const holding of snapshot.account.holdings) {
    const stock = snapshot.stocks.find((item) => item.id === holding.stockId)!;
    const beforeValue = holdingValuePoints(holding, stock.pricePoints);
    for (let percent = 1; percent < 100; percent += 1) {
      const projection = getSellProjection(holding, stock.pricePoints, percent * 100);
      const remaining = { ...holding, quantityMicros: holding.quantityMicros - projection.soldQuantityMicros };
      assert.equal(projection.proceedsPoints + holdingValuePoints(remaining, stock.pricePoints), beforeValue);
    }
  }
});

test('buy rejects a non-positive quote before quantity math', () => {
  const snapshot = createMarketPreviewSeed();
  snapshot.stocks[0].pricePoints = 0;
  assert.equal(validateMarketCommand(snapshot, {
    kind: 'buy', requestId: 'bad-quote', stockId: snapshot.stocks[0].id, points: 100,
  }), '현재 가격을 확인할 수 없어요');
});
```

- [ ] **Step 2: Run the domain test and confirm it fails**

Run: `node --test ./tests/playgroundMarketDomain.test.ts`

Expected: FAIL because market domain files do not exist.

- [ ] **Step 3: Define the domain types**

```ts
// src/features/playground/market/types.ts
export type MarketPeriod = 'today' | 'week' | 'month' | 'all';
export type MarketTrend = 'up' | 'down' | 'flat';

export interface PricePoint {
  at: string;
  pricePoints: number;
  newsId?: string;
}

export interface MarketNews {
  id: string;
  stockId: string;
  title: string;
  summary: string;
  publishedAt: string;
}

export interface MarketStock {
  id: string;
  name: string;
  symbol: string;
  character: string;
  description: string;
  pricePoints: number;
  previousClosePoints: number;
  reason: string;
  series: Record<MarketPeriod, PricePoint[]>;
}

export interface Holding {
  stockId: string;
  quantityMicros: number;
  costBasisPoints: number;
}

export interface MarketAccount {
  walletPoints: number;
  cashPoints: number;
  realizedPnlThisMonthPoints: number;
  unrealizedPnlAtMonthStartPoints: number;
  holdings: Holding[];
}

export interface MarketSnapshot {
  revision: number;
  marketOpenLabel: '24시간 열림';
  stocks: MarketStock[];
  news: MarketNews[];
  favoriteStockIds: string[];
  account: MarketAccount;
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
}

export type MarketCommand =
  | { kind: 'favorite'; requestId: string; stockId: string; wished: boolean }
  | { kind: 'read-reason'; requestId: string; stockId: string }
  | { kind: 'transfer'; requestId: string; direction: 'wallet-to-broker' | 'broker-to-wallet'; points: number }
  | { kind: 'buy'; requestId: string; stockId: string; points: number }
  | { kind: 'sell'; requestId: string; stockId: string; ratioBps: number };
```

- [ ] **Step 4: Implement exact integer calculations**

```ts
// src/features/playground/market/domain.ts
import type { Holding, MarketCommand, MarketSnapshot, MarketStock, MarketTrend, PricePoint } from './types';

export const SHARE_SCALE = 1_000_000;

export function holdingValuePoints(holding: Holding, pricePoints: number): number {
  return Math.round((holding.quantityMicros * pricePoints) / SHARE_SCALE);
}

export function getStockQuote(stock: Pick<MarketStock, 'pricePoints' | 'previousClosePoints'>) {
  const changePoints = stock.pricePoints - stock.previousClosePoints;
  const changeRate = stock.previousClosePoints > 0
    ? Math.round((changePoints / stock.previousClosePoints) * 1000) / 10
    : 0;
  const trend: MarketTrend = changePoints > 0 ? 'up' : changePoints < 0 ? 'down' : 'flat';
  return { changePoints, changeRate, trend };
}

export function toReturnSeries(series: PricePoint[]): number[] {
  const first = series[0]?.pricePoints ?? 0;
  if (first <= 0) return series.map(() => 0);
  return series.map((point) => ((point.pricePoints - first) / first) * 100);
}

export function getSharedReturnDomain(seriesGroups: number[][]) {
  const values = seriesGroups.flat();
  return values.length === 0 ? { min: 0, max: 0 } : { min: Math.min(...values), max: Math.max(...values) };
}

export function getNumericGeometry(
  values: number[],
  width: number,
  height: number,
  domain?: { min: number; max: number },
) {
  if (values.length === 0) return [] as Array<{ x: number; y: number }>;
  if (values.length === 1) return [{ x: width / 2, y: height / 2 }];
  const min = domain?.min ?? Math.min(...values);
  const max = domain?.max ?? Math.max(...values);
  if (max === min) return values.map((_value, index) => ({ x: (index / (values.length - 1)) * width, y: height / 2 }));
  return values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - ((value - min) / (max - min)) * height,
  }));
}

export function getSellProjection(holding: Holding, pricePoints: number, ratioBps: number) {
  const soldQuantityMicros = ratioBps === 10000
    ? holding.quantityMicros
    : Math.max(1, Math.floor((holding.quantityMicros * ratioBps) / 10000));
  const currentValuePoints = holdingValuePoints(holding, pricePoints);
  const remainingQuantityMicros = holding.quantityMicros - soldQuantityMicros;
  const remainingValuePoints = remainingQuantityMicros === 0
    ? 0
    : holdingValuePoints({ ...holding, quantityMicros: remainingQuantityMicros }, pricePoints);
  const remainingCostPoints = remainingQuantityMicros === 0
    ? 0
    : Math.round((holding.costBasisPoints * remainingQuantityMicros) / holding.quantityMicros);
  const proceedsPoints = currentValuePoints - remainingValuePoints;
  const soldCostPoints = holding.costBasisPoints - remainingCostPoints;
  return { soldQuantityMicros, proceedsPoints, soldCostPoints };
}

export function getAccountSummary(snapshot: MarketSnapshot) {
  const holdingsValuePoints = snapshot.account.holdings.reduce((sum, holding) => {
    const stock = snapshot.stocks.find((item) => item.id === holding.stockId);
    return sum + (stock ? holdingValuePoints(holding, stock.pricePoints) : 0);
  }, 0);
  const totalCost = snapshot.account.holdings.reduce((sum, holding) => sum + holding.costBasisPoints, 0);
  const unrealizedPnlPoints = holdingsValuePoints - totalCost;
  const realizedPnlPoints = snapshot.account.realizedPnlThisMonthPoints;
  const monthlyUnrealizedChangePoints = unrealizedPnlPoints - snapshot.account.unrealizedPnlAtMonthStartPoints;
  return {
    walletPoints: snapshot.account.walletPoints,
    cashPoints: snapshot.account.cashPoints,
    holdingsValuePoints,
    totalAssetsPoints: snapshot.account.cashPoints + holdingsValuePoints,
    realizedPnlPoints,
    unrealizedPnlPoints,
    monthlyUnrealizedChangePoints,
    monthlyTotalPnlPoints: realizedPnlPoints + monthlyUnrealizedChangePoints,
  };
}

export function validateMarketCommand(snapshot: MarketSnapshot, command: MarketCommand): string | null {
  if ('points' in command && (!Number.isInteger(command.points) || command.points <= 0)) return '1P 이상 입력해 주세요';
  if (command.kind === 'favorite') return snapshot.stocks.some((stock) => stock.id === command.stockId) ? null : '종목을 찾지 못했어요';
  if (command.kind === 'read-reason') return snapshot.stocks.some((stock) => stock.id === command.stockId) ? null : '종목을 찾지 못했어요';
  if (command.kind === 'transfer') {
    const available = command.direction === 'wallet-to-broker' ? snapshot.account.walletPoints : snapshot.account.cashPoints;
    return command.points <= available ? null : command.direction === 'wallet-to-broker'
      ? '포인트 지갑 잔액이 부족해요'
      : '꺼낼 수 있는 예수금이 부족해요';
  }
  const stock = snapshot.stocks.find((item) => item.id === command.stockId);
  if (!stock) return '종목을 찾지 못했어요';
  if (!Number.isSafeInteger(stock.pricePoints) || stock.pricePoints <= 0) return '현재 가격을 확인할 수 없어요';
  if (command.kind === 'buy') return command.points <= snapshot.account.cashPoints ? null : '예수금이 부족해요';
  if (!Number.isInteger(command.ratioBps) || command.ratioBps < 100 || command.ratioBps > 10000) return '1%부터 100%까지 입력해 주세요';
  if (command.ratioBps % 100 !== 0) return '매도 비율은 1% 단위로 입력해 주세요';
  const holding = snapshot.account.holdings.find((item) => item.stockId === command.stockId);
  if (!holding?.quantityMicros) return '보유한 주식이 없어요';
  return getSellProjection(holding, stock.pricePoints, command.ratioBps).proceedsPoints >= 1
    ? null
    : '받을 포인트가 1P보다 작아요. 더 큰 비율을 선택해 주세요';
}

export function applyMarketCommand(snapshot: MarketSnapshot, command: MarketCommand): MarketSnapshot {
  const error = validateMarketCommand(snapshot, command);
  if (error) throw new Error(error);
  const next = structuredClone(snapshot);
  next.revision += 1;

  if (command.kind === 'favorite') {
    next.favoriteStockIds = command.wished
      ? Array.from(new Set([...next.favoriteStockIds, command.stockId]))
      : next.favoriteStockIds.filter((id) => id !== command.stockId);
    if (next.beginnerMission === 'favorite' && command.wished) next.beginnerMission = 'reason';
    return next;
  }

  if (command.kind === 'read-reason') {
    if (next.beginnerMission === 'reason') next.beginnerMission = 'first-order';
    return next;
  }

  if (command.kind === 'transfer') {
    const sign = command.direction === 'wallet-to-broker' ? 1 : -1;
    next.account.walletPoints -= sign * command.points;
    next.account.cashPoints += sign * command.points;
    return next;
  }

  const stock = next.stocks.find((item) => item.id === command.stockId)!;
  const existing = next.account.holdings.find((item) => item.stockId === command.stockId);

  if (command.kind === 'buy') {
    const quantityMicros = Math.max(1, Math.round((command.points * SHARE_SCALE) / stock.pricePoints));
    const spentPoints = command.points;
    if (existing) {
      existing.quantityMicros += quantityMicros;
      existing.costBasisPoints += spentPoints;
    } else {
      next.account.holdings.push({ stockId: stock.id, quantityMicros, costBasisPoints: spentPoints });
    }
    next.account.cashPoints -= spentPoints;
    if (next.beginnerMission === 'first-order') next.beginnerMission = 'complete';
    return next;
  }

  const projection = getSellProjection(existing!, stock.pricePoints, command.ratioBps);
  existing!.quantityMicros -= projection.soldQuantityMicros;
  existing!.costBasisPoints -= projection.soldCostPoints;
  next.account.cashPoints += projection.proceedsPoints;
  next.account.realizedPnlThisMonthPoints += projection.proceedsPoints - projection.soldCostPoints;
  if (existing!.quantityMicros <= 0) next.account.holdings = next.account.holdings.filter((item) => item !== existing);
  return next;
}
```

- [ ] **Step 5: Add the deterministic approved seed**

Use this complete deterministic seed; no `Math.random()` is permitted in market prices.

```ts
// src/features/playground/market/seed.ts
import { getAccountSummary, getStockQuote } from './domain';
import type { MarketPeriod, MarketSnapshot, MarketStock, PricePoint } from './types';

interface StockSeed {
  id: string;
  name: string;
  symbol: string;
  character: string;
  description: string;
  pricePoints: number;
  previousClosePoints: number;
  reason: string;
}

const STOCK_INPUTS: StockSeed[] = [
  { id: 'jbbj', name: 'JBBJ', symbol: 'JBBJ', character: '콘텐츠 스튜디오', description: '우리 팀의 작품과 캐릭터를 만드는 스튜디오예요.', pricePoints: 1842, previousClosePoints: 1700, reason: '새 프로젝트 공개 소식 뒤 관심이 크게 늘었어요.' },
  { id: 'youtube', name: 'YouTube', symbol: 'YT', character: '영상 플랫폼', description: '전 세계 시청자에게 영상을 전하는 플랫폼이에요.', pricePoints: 1260, previousClosePoints: 1222, reason: '신규 채널 성장 소식이 긍정적으로 반영됐어요.' },
  { id: 'meta-comedy', name: '메타코미디', symbol: 'META', character: '코미디 콘텐츠', description: '코미디언과 새로운 웃음 콘텐츠를 만드는 회사예요.', pricePoints: 920, previousClosePoints: 944, reason: '신작 공개 전 관망하는 움직임이 많았어요.' },
  { id: 'netflix', name: 'Netflix', symbol: 'NFLX', character: '글로벌 스트리밍', description: '다양한 나라의 작품을 보여주는 스트리밍 서비스예요.', pricePoints: 1540, previousClosePoints: 1528, reason: '특별한 소식 없이 보통 범위에서 움직였어요.' },
  { id: 'adobe', name: 'Adobe', symbol: 'ADBE', character: '창작 소프트웨어', description: '그림과 영상 제작에 쓰는 창작 도구를 만들어요.', pricePoints: 770, previousClosePoints: 779, reason: '업데이트 평가가 엇갈리며 소폭 내렸어요.' },
  { id: 'wacom', name: 'Wacom', symbol: 'WACM', character: '창작 장비', description: '그림을 그리는 펜과 태블릿을 만드는 회사예요.', pricePoints: 430, previousClosePoints: 412, reason: '새 태블릿 공개 소식 뒤 관심이 늘었어요.' },
  { id: 'slack', name: 'Slack', symbol: 'WORK', character: '팀 커뮤니케이션', description: '팀이 대화하고 자료를 나누는 협업 도구예요.', pricePoints: 610, previousClosePoints: 610, reason: '특별한 소식 없이 보통 범위에서 움직였어요.' },
  { id: 'google-drive', name: 'Google Drive', symbol: 'GDRV', character: '파일 협업', description: '팀 파일을 보관하고 함께 편집하게 해주는 서비스예요.', pricePoints: 505, previousClosePoints: 498, reason: '협업 기능 개선 소식이 작게 반영됐어요.' },
];

const PERIOD_SCALE: Record<MarketPeriod, number> = { today: 1, week: 1.8, month: 2.6, all: 4 };
const PERIOD_SPAN_MS: Record<MarketPeriod, number> = {
  today: 10 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: 180 * 24 * 60 * 60 * 1000,
};
const PREVIEW_END_MS = Date.parse('2026-07-11T19:00:00+09:00');
const PREVIEW_NEWS_MS = Date.parse('2026-07-11T15:00:00+09:00');

function makeSeries(stock: StockSeed, period: MarketPeriod): PricePoint[] {
  const scaledChange = Math.round((stock.pricePoints - stock.previousClosePoints) * PERIOD_SCALE[period]);
  const start = stock.pricePoints - scaledChange;
  const values = [
    start,
    Math.round(start + scaledChange * 0.18),
    Math.round(start + scaledChange * 0.42),
    Math.round(start + scaledChange * 0.66),
    Math.round(start + scaledChange * 0.82),
    stock.pricePoints,
  ];
  const newsIndex = period === 'today' ? 3 : 4;
  return values.map((pricePoints, index) => ({
    at: new Date(index === newsIndex
      ? PREVIEW_NEWS_MS
      : PREVIEW_END_MS - PERIOD_SPAN_MS[period] + (PERIOD_SPAN_MS[period] * index) / (values.length - 1)).toISOString(),
    pricePoints,
    ...(index === newsIndex ? { newsId: `${stock.id}-news` } : {}),
  }));
}

function toStock(input: StockSeed): MarketStock {
  return {
    ...input,
    series: {
      today: makeSeries(input, 'today'),
      week: makeSeries(input, 'week'),
      month: makeSeries(input, 'month'),
      all: makeSeries(input, 'all'),
    },
  };
}

export function createMarketPreviewSeed(): MarketSnapshot {
  const stocks = STOCK_INPUTS.map(toStock);
  const snapshot: MarketSnapshot = {
    revision: 1,
    marketOpenLabel: '24시간 열림',
    stocks,
    news: stocks.map((stock) => {
      const quote = getStockQuote(stock);
      const movement = quote.changeRate > 0
        ? `${Math.abs(quote.changeRate)}% 올랐어요`
        : quote.changeRate < 0
          ? `${Math.abs(quote.changeRate)}% 내렸어요`
          : '가격 변화가 없었어요';
      return {
        id: `${stock.id}-news`,
        stockId: stock.id,
        title: stock.reason,
        summary: `${stock.name}은 오늘 ${movement}.`,
        publishedAt: '2026-07-11T15:00:00+09:00',
      };
    }),
    favoriteStockIds: ['jbbj', 'youtube', 'wacom'],
    account: {
      walletPoints: 18450,
      cashPoints: 3640,
      realizedPnlThisMonthPoints: 1240,
      unrealizedPnlAtMonthStartPoints: 0,
      holdings: [
        { stockId: 'jbbj', quantityMicros: 2_000_000, costBasisPoints: 3550 },
        { stockId: 'youtube', quantityMicros: 2_000_000, costBasisPoints: 2480 },
        { stockId: 'wacom', quantityMicros: 3_490_698, costBasisPoints: 1470 },
      ],
    },
    beginnerMission: 'reason',
  };
  const summary = getAccountSummary(snapshot);
  const pricesAreValid = stocks.every((stock) => (
    Number.isSafeInteger(stock.pricePoints)
    && stock.pricePoints > 0
    && Number.isSafeInteger(stock.previousClosePoints)
    && stock.previousClosePoints > 0
    && stock.series.today.at(-1)?.pricePoints === stock.pricePoints
  ));
  if (!pricesAreValid || summary.holdingsValuePoints !== 7705 || summary.unrealizedPnlPoints !== 205) {
    throw new Error('market preview seed invariant drifted');
  }
  return snapshot;
}
```

- [ ] **Step 6: Run domain checks**

Run: `node --test ./tests/playgroundMarketDomain.test.ts`

Expected: 10 tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 7: Commit the market domain**

```powershell
git add src/features/playground/market/types.ts src/features/playground/market/domain.ts src/features/playground/market/seed.ts tests/playgroundMarketDomain.test.ts
git commit -m "JBBJ 증권 프리뷰 계산과 시드 데이터 추가"
```

---

### Task 4: Preview gateway and optimistic store with rollback

**Files:**
- Create: `src/features/playground/market/previewGateway.ts`
- Create: `src/features/playground/market/useMarketPreviewStore.ts`
- Create: `tests/playgroundMarketPreviewStore.test.ts`

**Interfaces:**
- Produces: `MarketPreviewGateway { read(): Promise<MarketSnapshot>; execute(command): Promise<MarketSnapshot> }`
- Produces: `createMarketPreviewGateway(options?)`
- Produces: `createMarketPreviewStore(gateway)` and singleton `useMarketPreviewStore`
- Consumes: `applyMarketCommand`, `createMarketPreviewSeed`

- [ ] **Step 1: Write failing optimistic-state tests**

```ts
// tests/playgroundMarketPreviewStore.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMarketPreviewGateway } from '../src/features/playground/market/previewGateway.ts';
import { createMarketPreviewStore } from '../src/features/playground/market/useMarketPreviewStore.ts';

test('successful transfer converges visible and confirmed snapshots', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 0 }));
  await store.getState().load();
  const result = await store.getState().execute({
    kind: 'transfer', requestId: 'ok-1', direction: 'wallet-to-broker', points: 1000,
  });
  assert.equal(result, true);
  assert.equal(store.getState().visible?.account.cashPoints, 4640);
  assert.equal(store.getState().confirmed?.account.cashPoints, 4640);
});

test('failed mutation restores the confirmed snapshot', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0, failRequestIds: new Set(['fail-1']) });
  const store = createMarketPreviewStore(gateway);
  await store.getState().load();
  const before = store.getState().confirmed;
  const result = await store.getState().execute({
    kind: 'transfer', requestId: 'fail-1', direction: 'wallet-to-broker', points: 1000,
  });
  assert.equal(result, false);
  assert.deepEqual(store.getState().visible, before);
  assert.equal(store.getState().error, '저장하지 못했어요. 이전 상태로 되돌렸어요.');
});

test('a second mutation is blocked until the first is confirmed', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 20 }));
  await store.getState().load();
  const first = store.getState().execute({
    kind: 'favorite', requestId: 'first', stockId: 'adobe', wished: true,
  });
  const second = await store.getState().execute({
    kind: 'favorite', requestId: 'second', stockId: 'wacom', wished: true,
  });
  assert.equal(second, false);
  await first;
});

test('the same request id is idempotent across sequential retries', async () => {
  const gateway = createMarketPreviewGateway({ latencyMs: 0 });
  const commandA = { kind: 'transfer', requestId: 'same-id', direction: 'wallet-to-broker', points: 1000 } as const;
  const first = await gateway.execute(commandA);
  const afterB = await gateway.execute({
    kind: 'favorite', requestId: 'different-id', stockId: 'adobe', wished: true,
  });
  const retryA = await gateway.execute(commandA);
  assert.equal(first.account.cashPoints, 4640);
  assert.equal(retryA.account.cashPoints, 4640);
  assert.equal(retryA.revision, afterB.revision);
  assert.ok(retryA.favoriteStockIds.includes('adobe'));
  await assert.rejects(() => gateway.execute({ ...commandA, points: 500 }), /request id conflict/);
});

test('read failure exposes a retryable initial error without a fake snapshot', async () => {
  const store = createMarketPreviewStore(createMarketPreviewGateway({ latencyMs: 0, failRead: true }));
  await store.getState().load();
  assert.equal(store.getState().visible, null);
  assert.equal(store.getState().error, '시장 정보를 불러오지 못했어요.');
});
```

- [ ] **Step 2: Run the store test and confirm it fails**

Run: `node --test ./tests/playgroundMarketPreviewStore.test.ts`

Expected: FAIL because the gateway and store do not exist.

- [ ] **Step 3: Implement the memory-only gateway**

```ts
// src/features/playground/market/previewGateway.ts
import { applyMarketCommand } from './domain';
import { createMarketPreviewSeed } from './seed';
import type { MarketCommand, MarketSnapshot } from './types';

export interface MarketPreviewGateway {
  read(): Promise<MarketSnapshot>;
  execute(command: MarketCommand): Promise<MarketSnapshot>;
}

export interface MarketPreviewGatewayOptions {
  latencyMs?: number;
  failRequestIds?: Set<string>;
  failRead?: boolean;
}

function wait(ms: number) {
  return ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function createMarketPreviewGateway(
  options: MarketPreviewGatewayOptions = {},
): MarketPreviewGateway {
  let snapshot = createMarketPreviewSeed();
  const latencyMs = options.latencyMs ?? 180;
  const fingerprintByRequestId = new Map<string, string>();
  return {
    async read() {
      await wait(latencyMs);
      if (options.failRead) throw new Error('preview gateway read failed');
      return structuredClone(snapshot);
    },
    async execute(command) {
      await wait(latencyMs);
      if (options.failRequestIds?.has(command.requestId)) throw new Error('preview gateway rejected request');
      const fingerprint = JSON.stringify(command);
      const previousFingerprint = fingerprintByRequestId.get(command.requestId);
      if (previousFingerprint && previousFingerprint !== fingerprint) throw new Error('request id conflict');
      if (previousFingerprint) return structuredClone(snapshot);
      snapshot = applyMarketCommand(snapshot, command);
      fingerprintByRequestId.set(command.requestId, fingerprint);
      return structuredClone(snapshot);
    },
  };
}
```

- [ ] **Step 4: Implement the injected Zustand store**

```ts
// src/features/playground/market/useMarketPreviewStore.ts
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { applyMarketCommand, validateMarketCommand } from './domain';
import { createMarketPreviewGateway, type MarketPreviewGateway } from './previewGateway';
import type { MarketCommand, MarketSnapshot } from './types';

interface MarketPreviewState {
  confirmed: MarketSnapshot | null;
  visible: MarketSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  load(): Promise<void>;
  execute(command: MarketCommand): Promise<boolean>;
  clearError(): void;
}

export function createMarketPreviewStore(
  gateway: MarketPreviewGateway,
): UseBoundStore<StoreApi<MarketPreviewState>> {
  return create<MarketPreviewState>((set, get) => ({
    confirmed: null,
    visible: null,
    loading: false,
    mutating: false,
    error: null,
    async load() {
      set({ loading: true, error: null });
      try {
        const snapshot = await gateway.read();
        set({ confirmed: snapshot, visible: snapshot, loading: false });
      } catch {
        set({ loading: false, error: '시장 정보를 불러오지 못했어요.' });
      }
    },
    async execute(command) {
      const { visible, mutating } = get();
      if (!visible || mutating) return false;
      const validation = validateMarketCommand(visible, command);
      if (validation) {
        set({ error: validation });
        return false;
      }
      const projected = applyMarketCommand(visible, command);
      set({ visible: projected, mutating: true, error: null });
      try {
        const confirmed = await gateway.execute(command);
        set({ confirmed, visible: confirmed, mutating: false });
        return true;
      } catch {
        set({ visible: get().confirmed, mutating: false, error: '저장하지 못했어요. 이전 상태로 되돌렸어요.' });
        return false;
      }
    },
    clearError() { set({ error: null }); },
  }));
}

export const useMarketPreviewStore = createMarketPreviewStore(createMarketPreviewGateway());
```

- [ ] **Step 5: Run store checks**

Run: `node --test ./tests/playgroundMarketPreviewStore.test.ts ./tests/playgroundMarketDomain.test.ts`

Expected: 15 tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the preview state layer**

```powershell
git add src/features/playground/market/previewGateway.ts src/features/playground/market/useMarketPreviewStore.ts tests/playgroundMarketPreviewStore.test.ts
git commit -m "JBBJ 증권 프리뷰 낙관적 상태와 롤백 추가"
```

---

### Task 5: A안 로비, C안 JBBJ 하우스, and market home

**Files:**
- Create: `src/features/playground/routes.ts`
- Create: `src/features/playground/recommendation.ts`
- Create: `src/views/playground/PlaygroundLobby.tsx`
- Create: `src/views/playground/JbbjHouse.tsx`
- Create: `src/views/playground/ComingSoonGame.tsx`
- Create: `src/views/playground/market/MarketRouter.tsx`
- Create: `src/views/playground/market/MarketDataBoundary.tsx`
- Create: `src/views/playground/market/MarketNav.tsx`
- Create: `src/views/playground/market/MarketHome.tsx`
- Create: `src/views/playground/market/MarketRows.tsx`
- Create: `src/views/playground/market/StockDetailView.tsx` (read-only first slice)
- Create: `src/views/playground/market/MarketAccountView.tsx` (read-only first slice)
- Create: `tests/playgroundRoutes.test.ts`
- Create: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `src/views/PlaygroundView.tsx`

**Interfaces:**
- Produces: `PlaygroundRoute`, `MarketRoute`, `navigatePlayground(route, action)`
- Produces: `pickRecommendation(items, random?)`
- Produces: `<PlaygroundLobby onOpen(destination, origin) onOpenHouse(origin) />`
- Produces: `<MarketRouter route onNavigate onExit />`
- Consumes: Task 2 `DotWipeTransition`; Task 4 `useMarketPreviewStore`

- [ ] **Step 1: Write failing route and recommendation tests**

```ts
// tests/playgroundRoutes.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { initialPlaygroundRoute, navigatePlayground } from '../src/features/playground/routes.ts';
import { pickRecommendation } from '../src/features/playground/recommendation.ts';

test('A lobby is the default and the dedicated button opens C house', () => {
  assert.deepEqual(initialPlaygroundRoute, { kind: 'lobby' });
  assert.deepEqual(navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' }), { kind: 'house' });
});

test('market remains one local route with three pages', () => {
  const market = navigatePlayground(initialPlaygroundRoute, { kind: 'open-market' });
  assert.deepEqual(market, { kind: 'market', page: { kind: 'home' } });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-stock', stockId: 'jbbj' }), {
    kind: 'market', page: { kind: 'stock', stockId: 'jbbj' },
  });
  assert.deepEqual(navigatePlayground(market, { kind: 'open-account' }), {
    kind: 'market', page: { kind: 'account' },
  });
  assert.deepEqual(navigatePlayground(market, {
    kind: 'market-home', focusRequest: { target: 'all-stocks', id: 7 },
  }), {
    kind: 'market', page: { kind: 'home', focusRequest: { target: 'all-stocks', id: 7 } },
  });
});

test('recommendation accepts deterministic randomness', () => {
  const items = ['tetris', 'sudoku', 'snake', 'market'] as const;
  assert.equal(pickRecommendation(items, () => 0), 'tetris');
  assert.equal(pickRecommendation(items, () => 0.99), 'market');
});
```

```ts
// tests/playgroundMarketUiWiring.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('market home preserves the approved information order', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const labels = ['오늘의 JBBJ 시장', '찜한 주식', '오늘 가격에 영향을 준 소식', '모든 주식', '초보 미션'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('lobby includes random recommendation, market, three games and JBBJ house', () => {
  const source = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  for (const label of ['오늘의 추천', 'JBBJ 증권', '테트리스', '스도쿠', '스네이크', 'JBBJ 하우스']) {
    assert.match(source, new RegExp(label));
  }
});

test('market shell has a stable loading and retry boundary', () => {
  const source = readFileSync('src/views/playground/market/MarketDataBoundary.tsx', 'utf8');
  assert.match(source, /시장 정보를 불러오는 중/);
  assert.match(source, /시장 정보를 불러오지 못했어요/);
  assert.match(source, /다시 불러오기/);
  assert.match(source, /aria-live="polite"/);
});

test('market search follows the keyboard combobox contract', () => {
  const source = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');
  for (const contract of ['role="combobox"', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'aria-live="polite"']) {
    assert.match(source, new RegExp(contract));
  }
});
```

- [ ] **Step 2: Run the route/UI contract tests and confirm they fail**

Run: `node --test ./tests/playgroundRoutes.test.ts ./tests/playgroundMarketUiWiring.test.ts`

Expected: FAIL because local routes and UI files do not exist.

- [ ] **Step 3: Implement typed local routes and recommendation selection**

```ts
// src/features/playground/routes.ts
export type PreviewGame = 'tetris' | 'sudoku' | 'snake';

export type MarketRoute =
  | { kind: 'home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'stock'; stockId: string }
  | { kind: 'account' };

export type PlaygroundRoute =
  | { kind: 'lobby' }
  | { kind: 'house' }
  | { kind: 'coming-soon'; game: PreviewGame }
  | { kind: 'market'; page: MarketRoute };

export type PlaygroundAction =
  | { kind: 'go-lobby' }
  | { kind: 'open-house' }
  | { kind: 'open-game'; game: PreviewGame }
  | { kind: 'open-market' }
  | { kind: 'market-home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'open-stock'; stockId: string }
  | { kind: 'open-account' };

export const initialPlaygroundRoute: PlaygroundRoute = { kind: 'lobby' };

export function navigatePlayground(_current: PlaygroundRoute, action: PlaygroundAction): PlaygroundRoute {
  switch (action.kind) {
    case 'go-lobby': return { kind: 'lobby' };
    case 'open-house': return { kind: 'house' };
    case 'open-game': return { kind: 'coming-soon', game: action.game };
    case 'open-market': return { kind: 'market', page: { kind: 'home' } };
    case 'market-home': return { kind: 'market', page: { kind: 'home', focusRequest: action.focusRequest } };
    case 'open-stock': return { kind: 'market', page: { kind: 'stock', stockId: action.stockId } };
    case 'open-account': return { kind: 'market', page: { kind: 'account' } };
  }
}
```

```ts
// src/features/playground/recommendation.ts
export function pickRecommendation<T>(items: readonly T[], random: () => number = Math.random): T {
  if (items.length === 0) throw new Error('recommendation items must not be empty');
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
```

- [ ] **Step 4: Replace the temporary view with local routing and reusable dot-wipe**

```tsx
// src/views/PlaygroundView.tsx
import { useEffect, useRef, useState } from 'react';
import { PlaygroundLobby } from './playground/PlaygroundLobby';
import { JbbjHouse } from './playground/JbbjHouse';
import { ComingSoonGame } from './playground/ComingSoonGame';
import { MarketRouter } from './playground/market/MarketRouter';
import { DotWipeTransition } from '@/features/playground/transition/DotWipeTransition';
import type { DotWipeRequest } from '@/features/playground/transition/usePlaygroundEntryStore';
import {
  initialPlaygroundRoute,
  navigatePlayground,
  type PlaygroundAction,
  type PlaygroundRoute,
} from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';

export default function PlaygroundView() {
  const [route, setRoute] = useState<PlaygroundRoute>(initialPlaygroundRoute);
  const [wipe, setWipe] = useState<DotWipeRequest | null>(null);
  const pendingAction = useRef<PlaygroundAction | null>(null);
  const sequence = useRef(0);
  const loadMarket = useMarketPreviewStore((state) => state.load);

  useEffect(() => { void loadMarket(); }, [loadMarket]);

  const move = (action: PlaygroundAction, origin?: Point) => {
    if (!origin) {
      setRoute((current) => navigatePlayground(current, action));
      return;
    }
    if (wipe) return;
    pendingAction.current = action;
    setWipe({ id: ++sequence.current, origin });
  };

  return (
    <section className="relative h-full overflow-hidden bg-bg-primary text-text-primary" aria-labelledby="playground-title">
      <h1 id="playground-title" tabIndex={-1} className="sr-only outline-none">배플레이그라운드</h1>
      {route.kind === 'lobby' && <PlaygroundLobby onMove={move} />}
      {route.kind === 'house' && <JbbjHouse onBack={() => move({ kind: 'go-lobby' })} />}
      {route.kind === 'coming-soon' && <ComingSoonGame game={route.game} onBack={() => move({ kind: 'go-lobby' })} />}
      {route.kind === 'market' && (
        <MarketRouter
          route={route.page}
          onNavigate={(action) => move(action)}
          onExit={() => move({ kind: 'go-lobby' })}
        />
      )}
      {wipe && (
        <DotWipeTransition
          request={wipe}
          onCovered={() => {
            if (pendingAction.current) setRoute((current) => navigatePlayground(current, pendingAction.current!));
          }}
          onFinished={() => {
            pendingAction.current = null;
            setWipe(null);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: Build A lobby, C house, and coming-soon destinations**

`PlaygroundLobby.tsx` must define one array with these exact items and select the central recommendation once with `useState(() => pickRecommendation(...))`:

```ts
const GAME_ITEMS = [
  { id: 'market', label: 'JBBJ 증권', description: '포인트로 천천히 투자 흐름을 익혀요' },
  { id: 'tetris', label: '테트리스', description: '블록을 쌓고 점수를 모아요' },
  { id: 'sudoku', label: '스도쿠', description: '차분하게 숫자 퍼즐을 풀어요' },
  { id: 'snake', label: '스네이크', description: '꼬리를 늘리며 기록에 도전해요' },
] as const;
```

The component contract is:

```tsx
interface PlaygroundLobbyProps {
  onMove(action: PlaygroundAction, origin?: Point): void;
}

// Pointer activation uses event.clientX/clientY as the exact origin.
// Keyboard activation uses the button rect center as the fallback origin.
// Every card calls:
// market -> { kind: 'open-market' }
// tetris/sudoku/snake -> { kind: 'open-game', game: item.id }
// dedicated "JBBJ 하우스 둘러보기" button -> { kind: 'open-house' }
```

The visible order is `지금은 쉬는 시간!` → `오늘의 추천` large center tile → four game cards → dedicated `JBBJ 하우스 둘러보기` button. Every actionable card is a real `<button>`, has a focus ring, and calls `originFromActivation(event.clientX, event.clientY, event.detail, event.currentTarget.getBoundingClientRect())`; pointer input therefore starts at the exact click location while keyboard activation starts at the button center.

`JbbjHouse.tsx` uses the C안 name `JBBJ 하우스`, a calm lounge description, current point balance read-only summary, and a `놀이터로 돌아가기` button. `ComingSoonGame.tsx` maps the three game ids to Korean labels and renders `준비 중이에요` plus `놀이터로 돌아가기`; it does not simulate game rewards.

- [ ] **Step 6: Implement MarketRouter, navigation, and the approved home order**

```tsx
// src/views/playground/market/MarketRouter.tsx
import { useEffect } from 'react';
import type { MarketRoute, PlaygroundAction } from '@/features/playground/routes';
import { MarketNav } from './MarketNav';
import { MarketHome } from './MarketHome';
import { StockDetailView } from './StockDetailView';
import { MarketAccountView } from './MarketAccountView';
import { MarketDataBoundary } from './MarketDataBoundary';

interface MarketRouterProps {
  route: MarketRoute;
  onNavigate(action: PlaygroundAction): void;
  onExit(): void;
}

export function MarketRouter({ route, onNavigate, onExit }: MarketRouterProps) {
  useEffect(() => {
    if (route.kind === 'home' && route.focusRequest?.target === 'all-stocks') return;
    requestAnimationFrame(() => document.getElementById('market-page-title')?.focus());
  }, [route.kind, route.kind === 'stock' ? route.stockId : route.kind === 'home' ? route.focusRequest?.id : undefined]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-primary">
      <MarketNav active={route.kind} onNavigate={onNavigate} onExit={onExit} />
      <MarketDataBoundary>
      <div className="min-h-0 flex-1 overflow-auto">
        {route.kind === 'home' && (
          <MarketHome
            focusAllStocksRequestId={route.focusRequest?.target === 'all-stocks' ? route.focusRequest.id : null}
            onOpenStock={(stockId) => onNavigate({ kind: 'open-stock', stockId })}
          />
        )}
        {route.kind === 'stock' && (
          <StockDetailView
            stockId={route.stockId}
            onOpenAccount={() => onNavigate({ kind: 'open-account' })}
            onOpenMarketHome={() => onNavigate({ kind: 'market-home' })}
          />
        )}
        {route.kind === 'account' && (
          <MarketAccountView
            onOpenStock={(stockId) => onNavigate({ kind: 'open-stock', stockId })}
            onOpenMarketHome={() => onNavigate({ kind: 'market-home' })}
          />
        )}
      </div>
      </MarketDataBoundary>
    </div>
  );
}
```

`MarketDataBoundary.tsx` reads `visible`, `loading`, `error`, and `load` from the store. If `visible` is null and loading or error is absent, render three fixed-height skeleton regions matching the home header/cards/rows and announce `시장 정보를 불러오는 중`. If `visible` is null and `error` exists, render `시장 정보를 불러오지 못했어요` and a `다시 불러오기` button that calls `load`. When `visible` exists, keep children mounted even if a mutation error exists, and expose that error in one `aria-live="polite"` region instead of replacing the page.

Home/detail/account components still use a null guard (`if (!snapshot) return null`) for type safety; the boundary owns the visible loading/error experience.

`MarketNav.tsx` must include `JBBJ 시장`, `시장 홈`, `종목 둘러보기`, `내 계좌`, `종목·뉴스 검색`, and `놀이터로`. `시장 홈` calls `{ kind: 'market-home' }`. Keep a `browseRequestId` ref and make every `종목 둘러보기` click increment it, then call `{ kind: 'market-home', focusRequest: { target: 'all-stocks', id: browseRequestId.current } }`; repeated clicks therefore retrigger focus. `MarketNav` owns its transient search query, reads stocks/news from `useMarketPreviewStore`, filters company names and news text, then calls `onNavigate({ kind: 'open-stock', stockId })` when a result is selected.

The search control follows the combobox pattern: input `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; popup `role="listbox"`; results `role="option"`. ArrowDown/ArrowUp change the active result, Enter navigates, Escape closes and returns focus, and an `aria-live="polite"` node announces the result count.

`MarketHome.tsx` renders sections in this exact order and uses no tabs that hide the all-stock list:

```tsx
<section aria-labelledby="market-today-heading">오늘의 JBBJ 시장</section>
<section aria-labelledby="favorites-heading">찜한 주식</section>
<section aria-labelledby="news-heading">오늘 가격에 영향을 준 소식</section>
<section aria-labelledby="all-stocks-heading">모든 주식</section>
<section aria-labelledby="beginner-mission-heading">초보 미션</section>
```

Every home/detail/account root begins with `<h1 id="market-page-title" tabIndex={-1}>`; MarketRouter moves focus there after normal local route changes. `MarketHome` receives `focusAllStocksRequestId: number | null`; when the id changes it scrolls `#all-stocks-heading` into view and focuses that heading. MarketRouter skips page-title focus for that request, so the two effects never compete.

`MarketRows.tsx` exposes:

```ts
interface FavoriteStockCardProps {
  stock: MarketStock;
  wished: boolean;
  onOpen(): void;
  onToggleFavorite(): void;
}

interface StockListRowProps extends FavoriteStockCardProps {}
```

Show at most three favorites. If there are none, show JBBJ, YouTube, Wacom as recommendations. If there are four or more, show the first three plus `찜한 주식 {count}개 모두 보기`, which scrolls and focuses the matching rows in the all-stock section. Normalize each compact series to percentage change from its first point, compute one shared return-rate min/max and time domain, then call `getNumericGeometry(toReturnSeries(series), width, height, sharedReturnDomain)`; this keeps 430P and 1,842P stocks visually comparable without flattening the lower-priced stock. Every row derives amount/rate/trend with `getStockQuote(stock)` and displays company, character, current price, signed amount/rate, accessible sparkline, reason, and favorite toggle. Use a non-interactive row wrapper containing two sibling buttons: a wide detail-open button and a favorite button with dynamic `aria-label` plus `aria-pressed`. Never nest a button inside the row-open button.

Clicking a news/reason item first submits `{ kind: 'read-reason', requestId: crypto.randomUUID(), stockId }`, then opens that stock. Render the beginner mission as one active row only: `주식 하나 찜하기` → `가격이 움직인 이유 읽기` → `100P로 첫 주문 연습하기`. When `beginnerMission === 'complete'`, replace the row with a compact `첫 투자 둘러보기를 마쳤어요` disclosure so it no longer competes with the stock list.

For this independently testable route slice, create read-only versions of both downstream screens before wiring `MarketRouter`:

```tsx
// StockDetailView.tsx initial contract
interface StockDetailViewProps {
  stockId: string;
  onOpenAccount(): void;
  onOpenMarketHome(): void;
}

// Read snapshot, resolve stock and holding, and render the approved headings in order:
// 회사 한 줄 설명 → 현재 가격과 오늘의 변화 → 오늘 움직인 이유 → 가격 그래프 (start/current text only)
// → 내 보유 상태 → 간편 주문 (current available cash text only) → 최근 소식.
// Invalid stock calls onOpenMarketHome from a visible recovery button.
```

```tsx
// MarketAccountView.tsx initial contract
interface MarketAccountViewProps {
  onOpenStock(stockId: string): void;
  onOpenMarketHome(): void;
}

// Read snapshot and getAccountSummary, then render the 184px menu + 520px column.
// Show dynamic user account title, total assets, cash row, holding rows, and three P&L rows.
// The 넣기/빼기 controls are not rendered until Task 7, so this slice never implies a mutation it cannot perform.
```

These are functional read-only slices with real seeded data. Task 6 adds the interactive chart/orders to the existing detail file; Task 7 adds transfer actions/dialogs to the existing account file.

- [ ] **Step 7: Run route/home checks**

Run: `node --test ./tests/playgroundRoutes.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketPreviewStore.test.ts`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit the lobby and market home**

```powershell
git add src/features/playground/routes.ts src/features/playground/recommendation.ts src/views/PlaygroundView.tsx src/views/playground src/views/playground/market/MarketRouter.tsx src/views/playground/market/MarketNav.tsx src/views/playground/market/MarketHome.tsx src/views/playground/market/MarketRows.tsx tests/playgroundRoutes.test.ts tests/playgroundMarketUiWiring.test.ts
git commit -m "A안 로비와 JBBJ 증권 시장 홈 구현"
```

---

### Task 6: Beginner stock detail, chart, and easy orders

**Files:**
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Create: `src/views/playground/market/MarketPriceChart.tsx`
- Create: `src/views/playground/market/MarketOrderPanel.tsx`
- Create: `src/views/playground/market/MarketActionDialog.tsx`
- Modify: `src/features/playground/market/domain.ts`
- Modify: `tests/playgroundMarketDomain.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`

**Interfaces:**
- Produces: `getChartGeometry(series, width, height)` and `<MarketPriceChart stock period />`
- Produces: `<MarketOrderPanel stock snapshot onOpenAccount />`
- Produces: accessible `<MarketActionDialog open title openerRef onClose />`
- Consumes: `MarketCommand` buy/sell, `getSellProjection`, and `useMarketPreviewStore.execute`

- [ ] **Step 1: Add failing chart and detail-order tests**

```ts
// append to tests/playgroundMarketDomain.test.ts
import { getChartGeometry, getSharedReturnDomain, toReturnSeries } from '../src/features/playground/market/domain.ts';

test('chart geometry uses the local price domain and handles one point', () => {
  assert.deepEqual(getChartGeometry([{ at: 'a', pricePoints: 500 }], 100, 40), [{ x: 50, y: 20 }]);
  const points = getChartGeometry([
    { at: 'a', pricePoints: 100 }, { at: 'b', pricePoints: 200 }, { at: 'c', pricePoints: 150 },
  ], 100, 40);
  assert.deepEqual(points, [{ x: 0, y: 40 }, { x: 50, y: 0 }, { x: 100, y: 20 }]);
  assert.deepEqual(getChartGeometry([
    { at: 'a', pricePoints: 610 }, { at: 'b', pricePoints: 610 },
  ], 100, 40), [{ x: 0, y: 20 }, { x: 100, y: 20 }]);
});

test('compact sparklines share one normalized return domain', () => {
  const stocks = createMarketPreviewSeed().stocks.slice(0, 2);
  const returns = stocks.map((stock) => toReturnSeries(stock.series.today));
  const allReturns = returns.flat();
  assert.deepEqual(getSharedReturnDomain(returns), {
    min: Math.min(...allReturns), max: Math.max(...allReturns),
  });
});
```

```ts
// append to tests/playgroundMarketUiWiring.test.ts
test('stock detail uses the approved beginner-first order', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const labels = ['회사 한 줄 설명', '현재 가격과 오늘의 변화', '오늘 움직인 이유', '가격 그래프', '내 보유 상태', '간편 주문', '최근 소식'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const forbidden of ['PER', 'PBR', '체결 강도', '호가창']) assert.doesNotMatch(source, new RegExp(forbidden));
});

test('market dialog is portalled, labelled, inert and focus-safe', () => {
  const source = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  assert.match(source, /createPortal/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /\.inert\s*=\s*true/);
  assert.match(source, /openerRef\.current.*focus/);
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketUiWiring.test.ts`

Expected: FAIL because chart geometry and detail files do not exist.

- [ ] **Step 3: Add chart geometry with empty/single-point handling**

```ts
// append to src/features/playground/market/domain.ts
export function getChartGeometry(
  series: PricePoint[],
  width: number,
  height: number,
  domain?: { min: number; max: number },
) {
  return getNumericGeometry(series.map((point) => point.pricePoints), width, height, domain);
}
```

- [ ] **Step 4: Implement an accessible SVG chart without a chart dependency**

`MarketPriceChart.tsx` must:

- accept `stock: MarketStock`, `period: MarketPeriod`, `onPeriodChange(period)`;
- render tabs `오늘 / 1주 / 1개월 / 전체` as buttons with `aria-pressed`;
- call `getChartGeometry(stock.series[period], 720, 280)`;
- generate a `M ... L ...` SVG path and a unique gradient id from `useId()`;
- use the actual min/max domain, 12px visual padding, and transparent hover rectangles;
- show the hovered time and price in a text element outside the SVG;
- show news markers only where `PricePoint.newsId` exists;
- display start price on the left and current price on the right;
- render `가격 정보가 아직 없어요` for empty data and a centered dot for one point;
- include `role="img"` and an `aria-label` containing stock name, period, start price, current price, and 상승/하락 sentence.

The component may use a gradient fill under the line, but its line color must be `text-market-up`, `text-market-down`, or `text-market-flat`; it must not contain raw hex colors.

- [ ] **Step 5: Implement the dialog shell and easy order panel**

`MarketActionDialog.tsx` must implement this exact accessibility contract:

```ts
interface MarketActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  openerRef: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  onClose(): void;
}
```

Render the dialog with `createPortal(..., document.body)`. When opened it stores the previously focused element, generates title/description ids with `useId()`, focuses the first enabled control, traps Tab/Shift+Tab, closes on Escape, and uses `role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}`. While open, set `document.getElementById('root')!.inert = true` and `aria-hidden="true"`; on close/unmount, remove both before returning focus to `openerRef.current`. The fixed overlay blocks pointer input, but `inert` is the keyboard/screen-reader boundary. It uses B flow semantic tokens only.

`MarketOrderPanel.tsx` implements:

```ts
type OrderSide = 'buy' | 'sell';
const BUY_PRESETS = [100, 500, 1000] as const;
const SELL_PRESETS = [2500, 5000, 10000] as const;
```

- Buy default: `현재 가격으로 바로 사기`, 100/500/1,000P/최대, expected micro-shares, remaining cash, amount-bearing CTA.
- Sell default: 25%/50%/전부/직접 입력; direct input accepts integer percentages from 1 through 100 and converts them to `ratioBps = percent * 100`. Both the displayed expected quantity/received cash and the submitted confirmation must use the same `getSellProjection(holding, stock.pricePoints, ratioBps)` result; disabled with `보유한 주식이 없어요` when absent.
- Validate before opening confirmation; show the exact domain error below the control and in an `aria-live="polite"` region.
- Confirmation submits one command with `crypto.randomUUID()`, disables controls while `mutating`, and shows a Sonner success/failure toast.
- `원하는 가격에 주문하기` opens a complete preview form with order side, desired integer price, 100/500/1,000P/custom budget, estimated micro-shares, and the sentence `가격이 {price}P가 되면 {budget}P만큼 자동으로 주문`.
- The form has an input review step and a final `지정가 주문 모양 확인` action. Final confirmation stores no order and changes no balance; it closes with `지정가 입력 흐름을 확인했어요. 실제 예약과 체결은 운영 시세 엔진 연결 후 활성화돼요.` This preserves the approved advanced-order UX without pretending that an excluded matching engine exists.

- [ ] **Step 6: Compose StockDetailView in the approved order**

Use a single column below `xl`. At `xl`, use named grid areas so the visual order remains explanation → price → reason → graph → holding/order → news: the right `360px` order rail begins on the same grid row as `내 보유 상태`, never at the top beside the company explanation. DOM/tab order stays exactly the same as the visual reading order. Left content max width is `760px`. Render visible headings/comments with these exact labels in this exact order:

```tsx
<section aria-label="회사 한 줄 설명">...</section>
<section aria-label="현재 가격과 오늘의 변화">종목명 / 현재가 / 오늘 등락 금액·비율 / 풀어 쓴 변화 문장 / 찜</section>
<section aria-labelledby="price-reason-heading"><h2 id="price-reason-heading">오늘 움직인 이유</h2>...</section>
<section aria-labelledby="price-chart-heading"><h2 id="price-chart-heading">가격 그래프</h2>...</section>
<section aria-labelledby="holding-heading"><h2 id="holding-heading">내 보유 상태</h2>...</section>
<aside aria-labelledby="easy-order-heading"><h2 id="easy-order-heading">간편 주문</h2>...</aside>
<section aria-labelledby="recent-news-heading"><h2 id="recent-news-heading">최근 소식</h2>...</section>
```

`StockDetailView` accepts `stockId`, `onOpenAccount()`, and `onOpenMarketHome()`. For no holding, show `아직 보유하지 않음` and `100P부터 시작할 수 있어요`; do not render zero-value fake rows. If `stockId` is invalid, render `종목을 찾지 못했어요` and call `onOpenMarketHome` from its market-home action rather than throwing.

The price-summary section uses `getStockQuote(stock)` and shows `1,842P`, `▲ +142P (+8.4%)`, and `오늘 142P, 8.4% 올랐어요` together with an `aria-pressed` favorite button. The favorite control is a sibling of the detail navigation control, never a button nested inside another button.

- [ ] **Step 7: Run detail checks**

Run: `node --test ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketPreviewStore.test.ts`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit the stock detail**

```powershell
git add src/features/playground/market/domain.ts src/views/playground/market/StockDetailView.tsx src/views/playground/market/MarketPriceChart.tsx src/views/playground/market/MarketOrderPanel.tsx src/views/playground/market/MarketActionDialog.tsx tests/playgroundMarketDomain.test.ts tests/playgroundMarketUiWiring.test.ts
git commit -m "초심자용 종목 상세와 간편 주문 구현"
```

---

### Task 7: Beginner-first simple account and point transfer

**Files:**
- Modify: `src/views/playground/market/MarketAccountView.tsx`
- Create: `src/views/playground/market/PointTransferDialog.tsx`
- Modify: `tests/playgroundMarketUiWiring.test.ts`

**Interfaces:**
- Produces: `<MarketAccountView onOpenStock(stockId) onOpenMarketHome() />`
- Produces: `<PointTransferDialog direction open openerRef onClose />`
- Consumes: `getAccountSummary`, `MarketCommand` transfer, `useMarketPreviewStore`

- [ ] **Step 1: Add a failing account simplicity contract**

```ts
// append to tests/playgroundMarketUiWiring.test.ts
test('account stays a 520px single column with simple rows and no chart', () => {
  const source = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  assert.match(source, /max-w-\[520px\]/);
  for (const label of ['투자 계좌', '총자산', '넣기', '빼기', '쓸 수 있는 포인트', '현재 내 투자 현황', '내 투자 실적']) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /MarketPriceChart|price-chart|7일|전체 기간/);
});

test('account side menu exposes only Assets as implemented', () => {
  const source = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  for (const label of ['자산', '거래내역', '주문내역', '수익분석', '계좌관리']) assert.match(source, new RegExp(label));
  assert.match(source, /aria-current="page"/);
  assert.match(source, /준비 중/);
});
```

- [ ] **Step 2: Run the account contract and confirm it fails**

Run: `node --test ./tests/playgroundMarketUiWiring.test.ts`

Expected: FAIL because the account view does not exist.

- [ ] **Step 3: Implement separate deposit and withdrawal dialogs**

```ts
interface PointTransferDialogProps {
  direction: 'wallet-to-broker' | 'broker-to-wallet';
  open: boolean;
  openerRef: React.RefObject<HTMLElement>;
  onClose(): void;
}

const TRANSFER_PRESETS = [1000, 5000] as const;
```

Build on `MarketActionDialog` and render:

- deposit title `투자 계좌에 포인트 넣기`, source `포인트 지갑 잔액`, presets `1,000P / 5,000P / 전부`, result `이동 후 예수금`, CTA `{amount}P 넣기`;
- withdrawal title `투자 계좌에서 포인트 빼기`, source `꺼낼 수 있는 예수금`, same presets, result `이동 후 포인트 지갑`, CTA `{amount}P 빼기`;
- integer numeric input with `min=1`, `inputMode="numeric"`, comma-free internal value and formatted display beside it;
- domain validation on every input; invalid CTA disabled and error announced through `aria-live="polite"`;
- one `transfer` command with `crypto.randomUUID()`; success closes and returns focus, failure stays open and shows the store rollback message;
- helper text `수수료가 없고 투자 실적에는 포함되지 않아요` and `투자 중인 포인트는 주식을 판 뒤 뺄 수 있어요`.

- [ ] **Step 4: Implement the 184px + 520px account layout**

`MarketAccountView.tsx` desktop structure is fixed:

```tsx
<div className="mx-auto grid w-full max-w-[980px] grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[184px_minmax(0,1fr)] lg:gap-16 lg:px-8 lg:py-10">
  <nav aria-label="계좌 메뉴">...</nav>
  <div className="w-full max-w-[520px]">
    <header>{currentUser?.name ? `${currentUser.name}님의 투자 계좌` : '내 투자 계좌'} / 총자산 / 넣기 / 빼기</header>
    <section><h2>쓸 수 있는 포인트</h2>...</section>
    <section><h2>현재 내 투자 현황</h2>...</section>
    <section><h2>내 투자 실적</h2>...</section>
  </div>
</div>
```

Implement it responsively as `grid-cols-1 lg:grid-cols-[184px_minmax(0,1fr)]`. Below `lg`, the account menu becomes a compact horizontal list above the 520px column; it must not force horizontal scroll at the app's 800px minimum width or at 200% zoom. The chart uses `viewBox="0 0 720 280"` with `className="h-auto w-full"`; 720×280 is a coordinate system, not a fixed CSS width.

Read `currentUser` from `useAuthStore`; the account title is `${currentUser.name}님의 투자 계좌`, with `내 투자 계좌` as the null-safe fallback. The side menu lists `자산`, `거래내역`, `주문내역`, `수익분석`, `계좌관리`. `자산` is a button with `aria-current="page"`; the other four are non-interactive text rows with `aria-disabled="true"` and an adjacent `준비 중` status, so they never imply a working page.

The content rules are:

- Show total assets once, calculated as cash + current holdings value.
- Header actions show wallet balance nearby but do not include wallet in total assets.
- `쓸 수 있는 포인트` has one row: `내 포인트 예수금` / cash / `주식을 바로 살 수 있는 포인트`.
- Each holding row has only stock name, current value, signed unrealized P&L amount/rate, and opens that stock.
- No holdings state says `아직 보유한 주식이 없어요` and links to market home.
- `내 투자 실적` has exactly `이번 달 전체 결과`, `확정된 결과`, `보유 중 변화`; use `realizedPnlThisMonthPoints + (currentUnrealizedPnl - unrealizedPnlAtMonthStartPoints)` so the monthly label is mathematically true and wallet↔broker transfers remain excluded. No chart, formula card, average price, or allocation graph.
- Skeletons preserve the same row heights while loading.

- [ ] **Step 5: Run account/domain checks**

Run: `node --test ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketPreviewStore.test.ts`

Expected: all tests PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 6: Commit the account flow**

```powershell
git add src/views/playground/market/MarketAccountView.tsx src/views/playground/market/PointTransferDialog.tsx tests/playgroundMarketUiWiring.test.ts
git commit -m "초심자형 단순 계좌와 포인트 이동 구현"
```

---

### Task 8: Theme tokens, build gate, accessibility, and visual verification

**Files:**
- Create: `tests/playgroundMarketTheme.test.ts`
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-07-11-jbbj-beginner-stock-market-design.md`
- Verify: all files created in Tasks 1-7

**Interfaces:**
- Produces: Tailwind colors `market-up`, `market-down`, `market-flat`, `market-news`
- Produces: npm script `test:playground`
- Consumes: all previous task tests and UI components

- [ ] **Step 1: Write the failing semantic-theme contract**

```ts
// tests/playgroundMarketTheme.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

test('market semantic colors exist in CSS and Tailwind', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const tailwind = readFileSync('tailwind.config.js', 'utf8');
  for (const token of ['market-up', 'market-down', 'market-flat', 'market-news']) {
    assert.match(css, new RegExp(`--color-${token}`));
    assert.match(tailwind, new RegExp(`'${token}'`));
  }
});

test('new market components do not hardcode hex colors', () => {
  const files = [
    'src/views/playground/market/MarketNav.tsx',
    'src/views/playground/market/MarketHome.tsx',
    'src/views/playground/market/MarketRows.tsx',
    'src/views/playground/market/StockDetailView.tsx',
    'src/views/playground/market/MarketPriceChart.tsx',
    'src/views/playground/market/MarketOrderPanel.tsx',
    'src/views/playground/market/MarketAccountView.tsx',
    'src/views/playground/market/PointTransferDialog.tsx',
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /#[0-9a-f]{3,8}\b/i, file);
});

test('preview feature cannot reach production persistence APIs', () => {
  const collect = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? collect(path) : [path];
  });
  const files = [
    'src/views/PlaygroundView.tsx',
    ...collect('src/features/playground'),
    ...collect('src/views/playground'),
  ]
    .filter((file) => /\.tsx?$/.test(file));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /window\.electronAPI|localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i,
      file,
    );
  }
});
```

- [ ] **Step 2: Run the theme test and confirm it fails**

Run: `node --test ./tests/playgroundMarketTheme.test.ts`

Expected: FAIL because semantic market tokens are not defined.

- [ ] **Step 3: Add dark and light semantic tokens**

Add to the existing dark/root token block in `src/index.css`:

```css
--color-market-up: 244 124 103;
--color-market-down: 100 160 235;
--color-market-flat: 157 163 173;
--color-market-news: 164 142 255;
```

Add to the existing light-mode override:

```css
--color-market-up: 174 52 40;
--color-market-down: 47 111 187;
--color-market-flat: 92 99 110;
--color-market-news: 103 80 197;
```

Add under `theme.extend.colors` in `tailwind.config.js`:

```js
'market-up': 'rgb(var(--color-market-up) / <alpha-value>)',
'market-down': 'rgb(var(--color-market-down) / <alpha-value>)',
'market-flat': 'rgb(var(--color-market-flat) / <alpha-value>)',
'market-news': 'rgb(var(--color-market-news) / <alpha-value>)',
```

- [ ] **Step 4: Add one focused test command to both build gates**

```json
"test:playground": "node --test ./tests/playgroundNavigationWiring.test.ts ./tests/playgroundTransition.test.ts ./tests/playgroundRoutes.test.ts ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketPreviewStore.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts"
```

Extend the existing typecheck script so the new test fixtures are checked:

```json
"typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.playground-tests.json --noEmit"
```

Insert `npm run test:playground &&` after `npm run typecheck &&` in both `build` and `build:vite`. Do not remove or reorder any existing test suite.

- [ ] **Step 5: Run automated verification**

Run: `npm run test:playground`

Expected: every Playground test PASS, exit 0.

Run: `npm run typecheck`

Expected: renderer and Electron TypeScript checks PASS, exit 0.

Run: `npm run build:vite`

Expected: all existing suites plus `test:playground` PASS, Vite build completes, development manifest generation accepts the missing installer.

- [ ] **Step 6: Run the required logged-in browser verification**

Start the approved local preview command in the implementation worktree. In the browser:

1. If login appears, sign in with name `배한솔`, password `1234`.
2. Confirm the Playground sidebar item is visible in dev and starts particles from the sidebar click point.
3. Confirm the route does not switch until the dots cover the prior screen and the overlay says `지금은 쉬는 시간!`.
4. Confirm A lobby is default, the recommendation is selected again on each fresh mount, and the dedicated button opens C안 `JBBJ 하우스`.
5. Click all four game cards; confirm the dot transition begins at each button and the three unfinished games show a clear preparation screen.
6. Open JBBJ 증권 and check home at 800×600, 1024×768, and 1440px widths, then at 200% zoom: no horizontal clipping, favorites above, news next, all eight stocks always reachable below.
7. At both normal zoom and 800×600 + 200% zoom, open JBBJ detail, switch all four periods, favorite it, buy 100P, sell 25%, and verify the fluid SVG/order rail do not clip and balances/holding values update together.
8. At both normal zoom and 800×600 + 200% zoom, open account, confirm the side menu becomes a horizontal menu without overflow, deposit 1,000P, withdraw 1,000P, and confirm investment result does not change.
9. Try over-balance buy/transfer and a sell on an unowned stock; confirm CTA disabled and Korean reason visible.
10. Turn on OS reduced motion; confirm no particles are created and navigation finishes within 220ms.
11. Use keyboard only: focus rings visible, modal Tab stays trapped, Escape closes, focus returns to opener; in market search use ArrowDown/ArrowUp, Enter, and Escape and confirm the result-count live announcement.
12. Run a production Vite build without the env flag; confirm the sidebar entry is absent and a saved/default/direct `playground` view request resolves to Dashboard instead of mounting the preview.

Expected: all 12 checks pass with no browser console error.

- [ ] **Step 7: Record implementation status without claiming backend completion**

Append this section to the design spec:

```markdown
## 12. 인터랙티브 프리뷰 구현 상태

- 사용자용 시장 홈·종목 상세·내 계좌 3화면: 구현 완료
- 배플레이그라운드 A 로비·C안 JBBJ 하우스·클릭 원점 도트 전환: 구현 완료
- 메모리 기반 포인트 이동·매수·매도·롤백 검증: 구현 완료
- 운영 포인트 원장·씬 보상·Supabase 거래 RPC·관리자 시세/뉴스: 별도 운영 데이터 계획 범위
- 배포 노출: `VITE_ENABLE_PLAYGROUND_PREVIEW=true`인 명시적 QA 빌드에서만 허용
```

- [ ] **Step 8: Commit final polish and verification wiring**

```powershell
git add src/index.css tailwind.config.js package.json tests/playgroundMarketTheme.test.ts docs/superpowers/specs/2026-07-11-jbbj-beginner-stock-market-design.md
git commit -m "JBBJ 증권 프리뷰 테마와 검증 게이트 완성"
```

---

## Final Acceptance Checklist

- [ ] 전역 `ViewMode`는 `playground` 하나만 늘어났다.
- [ ] 개발/QA에서만 Playground 메뉴가 보이고 일반 운영 빌드에는 숨겨진다.
- [ ] flag-off 운영 빌드는 저장된 preference·back stack·직접 `setView`로도 Playground를 렌더하지 않는다.
- [ ] 사이드바와 모든 게임 카드의 클릭 원점에서 dot-wipe가 시작한다.
- [ ] A 로비가 기본이고 전용 버튼으로 C안 JBBJ 하우스를 연다.
- [ ] 중앙 추천은 mount당 한 번 무작위로 선택된다.
- [ ] 시장 홈은 찜과 모든 주식을 동시에 보여준다.
- [ ] 상세는 설명 → 가격/이유 → 그래프 → 보유 → 주문 → 뉴스 순서를 지킨다.
- [ ] 계좌는 184px 좌측 메뉴 + 520px 자산 단일 컬럼이고 차트가 없다.
- [ ] 포인트 이동은 투자 실적을 바꾸지 않는다.
- [ ] 실패 mutation은 confirmed snapshot으로 롤백된다.
- [ ] 같은 `requestId` 재시도는 포인트나 거래를 두 번 적용하지 않는다.
- [ ] 지정가 프리뷰는 가격·금액·예상 수량·확인 단계까지 제공하되 실제 예약/체결을 가장하지 않는다.
- [ ] 가상시장 경고 배너가 없다.
- [ ] 토스 고유 브랜드 자산이나 문구를 복제하지 않았다.
- [ ] reduced motion, 키보드, focus return, 색 이외 상승/하락 정보가 동작한다.
- [ ] 운영 DB/IPC/포인트 원장 파일은 수정하지 않았다.
- [ ] `npm run test:playground`, `npm run typecheck`, `npm run build:vite`가 통과한다.

## Execution Handoff

이 문서는 UI/상태 프리뷰 구현 계획이다. 구현 후 운영 포인트와 관리자 기능을 연결하기 전에 별도의 `JBBJ 증권 운영 데이터·관리자 시스템` 브레인스토밍과 계획을 진행한다.

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`를 사용해 Task마다 새 구현 agent를 배정하고, spec 검수와 코드 품질 검수를 각각 통과한 뒤 다음 Task로 간다.
2. **Inline Execution** — `superpowers:executing-plans`를 사용해 이 세션에서 Task를 묶음 실행하고 Task 2/4/6/8 뒤에 검토 checkpoint를 둔다.

두 방식 모두 첫 명령은 `superpowers:using-git-worktrees`로 현재 `main`에서 `codex/jbbj-market-preview` 격리 worktree를 만드는 것이다. main worktree의 기존 미추적 파일은 그대로 보존한다.
