# JBBJ 증권시장 실시간 거래 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배한솔 전용 JBBJ 증권시장에 연속 시세, 선/캔들 차트, 정수 주식 주문, 영구 계좌, 화면/마우스 뒤로가기를 구현하고 v1.80.0으로 배포한다.

**Architecture:** 가격은 클라이언트가 같은 시각에 같은 값을 만드는 결정론적 엔진으로 생성하고, 계좌와 관리자 이벤트는 Supabase가 원본이 된다. renderer는 Gateway만 사용하며 Electron main의 canonical session이 사용자 ID를 소유한다. 계좌 mutation은 DB RPC 한 트랜잭션과 request ID ledger로 중복 체결을 막고, 가격 stream과 계좌 optimistic state를 분리한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Zustand 4, Tailwind CSS 3, Supabase PostgreSQL 17, node:test

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-07-11-jbbj-market-live-v2-design.md`.
- 배플레이그라운드는 canonical 배한솔 계정 한 명에게만 보여야 한다.
- 브라우저 프리뷰 로그인은 이름 `배한솔`, 비밀번호 `1234`를 사용한다.
- 최초 지갑은 한 번만 `1,000,000P`; 증권 예수금 `0원`; 보유 주식 없음이다.
- 시장은 24시간 열리고 약 1초마다 연속적으로 움직인다.
- 화폐 표시는 지갑만 `P`, 증권 가격·예수금·평가액·손익은 `원`이다.
- 주문은 정수 주식 `1주`, `5주`, `10주`, `최대`, `직접 입력`이다.
- 선 그래프가 최초 기본값이고 마지막 선/캔들 선택을 기억한다.
- 데스크톱 주문 카드는 sticky, 좁은 창은 하단 사기/팔기 dock이다.
- 화면 뒤로가기와 Windows 마우스 `browser-backward`가 같은 Playground history를 사용한다.
- 모든 계좌 mutation은 낙관적으로 보이고 실패 시 계좌만 authoritative 값으로 롤백한다. 가격 stream은 롤백하지 않는다.
- 실제 Electron 앱은 Supabase가 원본이고 DB 실패 시 preview seed로 fallback하지 않는다.
- public DB 객체는 명시적 GRANT와 RLS를 포함한다. SECURITY DEFINER 함수는 `search_path = ''`, PUBLIC execute revoke를 적용한다.
- 새 production 함수 전에 실패 테스트를 실행하고 예상 이유로 실패한 것을 보고한 뒤 구현한다.
- 변경 후 `npm run typecheck`, 관련 테스트, `npm run build:vite`, 정식 `npm run build`를 통과한다.
- 정식 배포는 installer와 나머지 파일을 먼저 복사하고 `manifest.json`을 마지막에 복사한다.
- 버전은 기능 추가 규칙에 따라 `1.79.0`에서 `1.80.0`으로 올린다.
- 커밋 메시지는 짧은 한국어로 작성한다.

---

### Task 1: 결정론적 실시간 가격·캔들 엔진

**Files:**
- Modify: `src/features/playground/market/types.ts`
- Create: `src/features/playground/market/livePriceEngine.ts`
- Create: `src/features/playground/market/chartSeries.ts`
- Create: `tests/playgroundMarketPriceEngine.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `getLivePriceWon(profile, nowMs, events)`, `buildMinuteCandles(...)`, `aggregateCandles(...)`, `resolveIntervalForRange(...)`.
- Produces the exact public types below for Tasks 4 and 5:

```ts
export type MarketBarInterval = '1m' | '5m' | '10m' | '15m' | '1h' | '1d';
export type MarketChartRange = 'today' | 'week' | 'month' | 'six-months' | 'all';
export type MarketChartStyle = 'line' | 'candlestick';
export type MarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface MarketInstrumentProfile {
  stockId: string;
  basePriceWon: number;
  volatilityBps: number;
  phase: number;
}

export interface MarketAdminEvent {
  id: string;
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
  revision: number;
}

export interface MarketCandle {
  startsAt: string;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  newsIds: string[];
}
```

- [ ] **Step 1: Write failing deterministic tick tests**

Add node:test cases that assert:

```ts
const profile = { stockId: 'jbbj', basePriceWon: 1842, volatilityBps: 180, phase: 0.37 };
assert.equal(getLivePriceWon(profile, Date.parse('2026-07-11T12:00:01Z'), []), getLivePriceWon(profile, Date.parse('2026-07-11T12:00:01Z'), []));
assert.notEqual(getLivePriceWon(profile, Date.parse('2026-07-11T12:00:01Z'), []), getLivePriceWon(profile, Date.parse('2026-07-11T12:00:02Z'), []));
assert.ok(getLivePriceWon(profile, Date.parse('2026-07-11T12:00:01Z'), []) > 0);
```

Also assert a `halt` event freezes prices throughout its interval and a positive shock raises the affected price relative to the same timestamp without the event.

- [ ] **Step 2: Run the price-engine test and verify RED**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts`
Expected: FAIL because `livePriceEngine.ts` and exported types do not exist.

- [ ] **Step 3: Implement continuous deterministic prices**

Implement a pure seeded hash/value-noise function. Quantize only the public result to integer won; interpolate between adjacent control points so the value at a minute boundary is continuous. Apply events by UTC timestamp. `halt` returns the price at `startsAt - 1 second`. The function must never call `Date.now()` internally.

- [ ] **Step 4: Add failing OHLC and interval tests**

Assert that a one-minute candle contains 60 sampled seconds, `open` equals second 0, `close` equals second 59, `high`/`low` are extrema, and 5/10/15/60-minute aggregation uses first/open, max/high, min/low, last/close. Assert range compatibility:

```ts
assert.equal(resolveIntervalForRange('today', '1m'), '1m');
assert.equal(resolveIntervalForRange('month', '1m'), '1h');
assert.equal(resolveIntervalForRange('six-months', '15m'), '1d');
assert.equal(resolveIntervalForRange('all', '1h'), '1d');
```

- [ ] **Step 5: Run the new OHLC tests and verify RED**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts`
Expected: FAIL on missing candle/aggregation functions.

- [ ] **Step 6: Implement candle generation and aggregation**

Generate no more than 600 returned candles. Preserve event IDs in any candle whose interval overlaps an event. Cache completed historical candle requests by profile/range/interval/event revision; never cache the currently forming candle.

- [ ] **Step 7: Add the test file to `test:playground` and verify GREEN**

Run: `npm run test:playground`
Expected: all existing 100 tests plus the new price tests pass.

- [ ] **Step 8: Commit**

```powershell
git add package.json src/features/playground/market/types.ts src/features/playground/market/livePriceEngine.ts src/features/playground/market/chartSeries.ts tests/playgroundMarketPriceEngine.test.ts
git commit -m "JBBJ 실시간 가격과 캔들 엔진 추가"
```

---

### Task 2: 원화·정수 주식 계좌 도메인과 preview 영속성

**Files:**
- Modify: `src/features/playground/market/types.ts`
- Modify: `src/features/playground/market/domain.ts`
- Modify: `src/features/playground/market/seed.ts`
- Rename/Modify: `src/features/playground/market/previewGateway.ts` to remain the in-memory test gateway
- Create: `src/features/playground/market/localStorageGateway.ts`
- Modify: `src/features/playground/market/useMarketPreviewStore.ts`
- Modify: `src/features/playground/ranking.ts`
- Modify: all `src/views/playground/market/*.tsx` references required to keep typecheck green
- Modify: `tests/playgroundMarketDomain.test.ts`
- Modify: `tests/playgroundMarketPreviewStore.test.ts`
- Create: `tests/playgroundMarketLocalStorageGateway.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: current prices from Task 1 through `quotedPriceWon`.
- Produces:

```ts
export interface Holding {
  stockId: string;
  quantityShares: number;
  costBasisWon: number;
}

export interface MarketAccount {
  walletPoints: number;
  lifetimeEarnedPoints: number;
  cashWon: number;
  realizedPnlThisMonthWon: number;
  unrealizedPnlAtMonthStartWon: number;
  holdings: Holding[];
}

export type MarketCommand =
  | { kind: 'favorite'; requestId: string; stockId: string; wished: boolean }
  | { kind: 'read-reason'; requestId: string; stockId: string }
  | { kind: 'transfer'; requestId: string; direction: 'wallet-to-broker' | 'broker-to-wallet'; points: number }
  | { kind: 'buy'; requestId: string; stockId: string; quantityShares: number; quotedPriceWon: number }
  | { kind: 'sell'; requestId: string; stockId: string; quantityShares: number | 'all'; quotedPriceWon: number };
```

- [ ] **Step 1: Replace old amount/fraction tests with failing whole-share tests**

Assert initial seed account exactly equals:

```ts
{
  walletPoints: 1_000_000,
  lifetimeEarnedPoints: 1_000_000,
  cashWon: 0,
  realizedPnlThisMonthWon: 0,
  unrealizedPnlAtMonthStartWon: 0,
  holdings: [],
}
```

Assert `buy 3 shares at 1,842 won` spends `5,526원`, adds exactly 3 shares, and `sell 2 shares` returns exactly the quoted proceeds while proportional cost basis and realized PnL remain integers. Assert zero, negative, fractional, unsafe quantities fail. Assert `all` removes the holding.

- [ ] **Step 2: Run domain tests and verify RED**

Run: `node --test ./tests/playgroundMarketDomain.test.ts`
Expected: FAIL because the old micro-share/point command API is still present.

- [ ] **Step 3: Implement the new account domain**

Remove `SHARE_SCALE`, micro-share projection, amount-based buying and ratio-based selling. Introduce `holdingValueWon`, `getBuyCostWon`, `getSellProjection`, `maxBuyableShares`, `validateMarketCommand(snapshot, command, currentPriceWon?)`, and `applyMarketCommand(snapshot, command, currentPriceWon?)`. The optional explicit current price exists for optimistic UI; `quotedPriceWon` is the fallback.

- [ ] **Step 4: Convert seed and visible copy to P/원 semantics**

Give the seed no holdings/cash and `1_000_000P`. Rename stock price fields to `referencePriceWon` and `previousCloseWon`. Keep the approved eight companies and news. Centralize formatting in `src/features/playground/market/format.ts` with `formatPoints`, `formatWon`, and `formatShares`.

- [ ] **Step 5: Write failing browser persistence tests**

Use an injected `Storage` fake. Assert the first read creates the approved account, a transfer survives creation of a second gateway, duplicate request IDs do not execute twice, and a different payload with the same request ID throws `request id conflict`. Key format must be `bflow:playground-market:v2:<userId>`.

- [ ] **Step 6: Run local gateway tests and verify RED**

Run: `node --test ./tests/playgroundMarketLocalStorageGateway.test.ts`
Expected: FAIL because `localStorageGateway.ts` does not exist.

- [ ] **Step 7: Implement the preview-only localStorage gateway**

The gateway takes `{ userId, storage, now, latencyMs }`, persists snapshot plus request fingerprints, and never imports Electron, Supabase, or app services. Corrupt JSON must expose a retryable read error instead of silently granting another million points.

- [ ] **Step 8: Separate quote updates from account rollback**

Keep `confirmed`/`visible` account snapshots in the Zustand store, but do not store the 1-second clock or current quotes in either snapshot. A failed account mutation restores only `confirmed`; Task 4's quote context remains independent.

- [ ] **Step 9: Update ranking semantics and verify GREEN**

Use `lifetimeEarnedPoints`, not wallet balance, for the current user ranking. Run `npm run test:playground` and `npm run typecheck`.

- [ ] **Step 10: Commit**

```powershell
git add package.json src/features/playground src/views/playground/market tests/playgroundMarketDomain.test.ts tests/playgroundMarketPreviewStore.test.ts tests/playgroundMarketLocalStorageGateway.test.ts tests/playgroundMarketUiWiring.test.ts
git commit -m "모의투자를 원화와 정수 주식 거래로 전환"
```

---

### Task 3: Supabase 계좌·ledger·관리 이벤트와 Electron Gateway

**Files:**
- Create: `DEVLOG/migrations/2026-07-11-playground-market-v2.sql`
- Create: `electron/marketAccountService.ts`
- Modify: `electron/supabase.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Create: `src/features/playground/market/electronGateway.ts`
- Create: `src/features/playground/market/gateway.ts`
- Modify: `src/views/PlaygroundView.tsx`
- Create: `tests/playgroundMarketDatabaseContract.test.ts`
- Create: `tests/playgroundMarketDataWiring.test.ts`
- Modify: `src/mocks/devElectronAPI.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MarketCommand`, account types, and admin event types from Tasks 1–2.
- Produces the remote payload shared by main and renderer:

```ts
export interface MarketRemoteState {
  revision: number;
  account: MarketAccount;
  favoriteStockIds: string[];
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
  adminEvents: MarketAdminEvent[];
}

export interface MarketAdminEventInput {
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
}
```

- Produces Electron APIs:

```ts
marketRead(): Promise<MarketRemoteState>;
marketExecute(command: MarketCommand): Promise<MarketRemoteState>;
marketCreateAdminEvent(input: MarketAdminEventInput): Promise<MarketRemoteState>;
marketDeleteAdminEvent(eventId: string): Promise<MarketRemoteState>;
```

- [ ] **Step 1: Write failing SQL contract tests**

Assert the migration defines:

- `playground_wallet_accounts`, `playground_brokerage_accounts`, `playground_market_holdings`, `playground_value_ledger`, `playground_market_events`.
- nonnegative checks and positive integer share checks.
- unique `(user_id, request_id)` ledger key.
- RLS enabled on every new table and direct anon table access revoked.
- `playground_market_read`, `playground_market_execute`, `playground_market_create_event`, `playground_market_delete_event` functions with `security definer set search_path = ''`.
- execute revoked from PUBLIC and explicitly granted to anon.
- strict canonical Hansol lookup by name and Slack ID without a hardcoded generated UUID.
- idempotent seed ledger key `test-initial-grant-v1` and exactly `1000000` point delta.

- [ ] **Step 2: Run database contract test and verify RED**

Run: `node --test ./tests/playgroundMarketDatabaseContract.test.ts`
Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the migration**

`playground_market_execute` must take `p_user_id uuid`, `p_request_id text`, `p_kind text`, `p_payload jsonb`; acquire a per-user advisory transaction lock; lock wallet/broker rows; compare a stable payload fingerprint on duplicate requests; validate transfer/buy/sell/favorite/reason commands; update all affected rows and ledger atomically; return JSON account state. Only positive safe-range bigint values are accepted. Event functions must verify the supplied canonical ID is the unique Hansol user before writing.

- [ ] **Step 4: Write failing main/session wiring tests**

Assert IPC handlers never accept a renderer-supplied user ID; they call `sessionManager.ensure()`, read `getCanonicalUserId()` and `getEpoch()`, reject non-Hansol users, serialize mutations per user, and reject stale completion after a user switch.

- [ ] **Step 5: Run data wiring test and verify RED**

Run: `node --test ./tests/playgroundMarketDataWiring.test.ts`
Expected: FAIL because service, IPC, preload, and type APIs are absent.

- [ ] **Step 6: Implement main-owned market service and Supabase wrappers**

Follow `electron/personalTodoService.ts` session epoch and queue patterns. Do not expose service-role credentials. Parse every bigint returned by Supabase as a safe JavaScript integer or fail. Map Postgres errors to beginner-friendly Korean messages while keeping the original error in main-process logs.

- [ ] **Step 7: Implement gateway selection**

`createMarketGateway` selects Electron IPC when all four market APIs exist. In browser preview, it selects the injected localStorage gateway keyed by the authenticated preview user. In production Electron, missing IPC is a load error and must never fall back to the million-point seed.

- [ ] **Step 8: Add dev mock APIs and verify GREEN**

Use the same localStorage-backed adapter for `?preview=1`. Run database contract/data wiring tests, `npm run test:playground`, and `npm run typecheck`.

- [ ] **Step 9: Commit**

```powershell
git add DEVLOG/migrations/2026-07-11-playground-market-v2.sql electron src/features/playground/market src/views/PlaygroundView.tsx src/types/index.ts src/mocks/devElectronAPI.ts tests/playgroundMarketDatabaseContract.test.ts tests/playgroundMarketDataWiring.test.ts package.json
git commit -m "배한솔 모의투자 계좌를 서버에 영구 저장"
```

---

### Task 4: 실시간 선·캔들 차트와 간격·기간 컨트롤

**Files:**
- Create: `src/features/playground/market/useMarketClock.ts`
- Create: `src/features/playground/market/useMarketChartPreference.ts`
- Create: `src/views/playground/market/MarketChartCanvas.tsx`
- Modify: `src/views/playground/market/MarketPriceChart.tsx`
- Modify: `src/views/playground/market/MarketRows.tsx`
- Modify: `src/views/playground/market/MarketRouter.tsx`
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Create: `tests/playgroundMarketChartUi.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 price/candle functions and Task 3 remote admin events.
- Produces: `MarketPriceChart({ stock, events, nowMs, style, interval, range, onStyleChange, onIntervalChange, onRangeChange })`.

- [ ] **Step 1: Write failing chart state and accessibility tests**

Assert first style is `line`, stored `candlestick` is restored, invalid storage is ignored, interval/range compatibility clamps correctly, and the chart exposes selected candle time/open/high/low/close text. Source wiring must contain all Korean labels `선`, `캔들`, `1분`, `5분`, `10분`, `15분`, `1시간`, `1일`, `오늘`, `1주`, `1개월`, `6개월`, `전체`.

- [ ] **Step 2: Run chart UI tests and verify RED**

Run: `node --test ./tests/playgroundMarketChartUi.test.ts`
Expected: FAIL because hooks/canvas and controls do not exist.

- [ ] **Step 3: Implement a visibility-aware one-second clock**

Align updates to the next UTC second. On `visibilitychange` to visible, update immediately; never replay every missed second. Clear timers on unmount.

- [ ] **Step 4: Implement chart preference and controls**

Persist only presentation preference under `bflow:playground-market:chart-style:v2`. Keep account data out of this key. Selecting a range auto-corrects an incompatible interval and announces the effective interval.

- [ ] **Step 5: Implement Canvas rendering and hover/focus summary**

Render line/area or candles on a DPR-aware Canvas using semantic CSS colors read from computed style. Draw no more than 600 bars. Keep one transparent keyboard-navigable range/summary control above the Canvas rather than one DOM element per candle. Pointer movement selects the nearest candle. Current candle updates with every clock tick.

- [ ] **Step 6: Wire live quotes to rows, detail, account and orders**

Calculate one `quoteWonByStockId` map per clock tick. Pass the same current quote to displayed price, account valuation, chart close, and order panel so they cannot disagree. Do not write quote changes into confirmed/visible account snapshots.

- [ ] **Step 7: Verify GREEN and reduced-motion behavior**

With reduced motion, number/color changes remain but CSS interpolation is disabled. Run chart UI tests, `npm run test:playground`, and `npm run typecheck`.

- [ ] **Step 8: Commit**

```powershell
git add package.json src/features/playground/market src/views/playground/market tests/playgroundMarketChartUi.test.ts tests/playgroundMarketUiWiring.test.ts
git commit -m "실시간 선 그래프와 캔들 차트 구현"
```

---

### Task 5: 고정 주문 UI·정수 수량·관리자 이벤트 UI

**Files:**
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Modify: `src/views/playground/market/MarketOrderPanel.tsx`
- Create: `src/views/playground/market/MarketMobileOrderDock.tsx`
- Create: `src/views/playground/market/MarketAdminPanel.tsx`
- Modify: `src/views/playground/market/MarketHome.tsx`
- Modify: `src/views/playground/market/MarketNav.tsx`
- Modify: `src/views/playground/market/MarketActionDialog.tsx`
- Modify: `src/views/playground/market/PointTransferDialog.tsx`
- Modify: `src/views/playground/market/MarketAccountView.tsx`
- Create: `tests/playgroundMarketOrderUi.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `tests/playgroundMarketTheme.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: live quote map, Task 2 commands, Task 3 event mutations.
- Produces one shared order controller used by desktop card and mobile sheet so dialogs/IDs/state are not mounted twice.

- [ ] **Step 1: Write failing responsive order contract tests**

Assert the detail grid places the order aside in the first desktop row, uses `xl:sticky`, a viewport max height and internal overflow. Assert a narrow-screen dock exists outside the MarketRouter scroll container with `사기` and `팔기`, and the content reserves dock height. Assert presets are exactly `1주`, `5주`, `10주`, `최대`, `직접 입력`; no `100P`, `500P`, `1,000P`, `%` sell presets remain.

- [ ] **Step 2: Run order UI test and verify RED**

Run: `node --test ./tests/playgroundMarketOrderUi.test.ts`
Expected: FAIL against the current non-sticky amount/ratio UI.

- [ ] **Step 3: Implement shared whole-share order controller**

Both desktop and mobile call the same controller. Maximum buy is `floor(cashWon / livePriceWon)`. Maximum sell is current holding quantity. Confirmation freezes `side`, `quantityShares`, `quotedPriceWon`, `estimatedTotalWon`, `availableCashWon`, and `availableShares`. Before creating one request ID, revalidate all frozen fields; on drift update the dialog and require another click.

- [ ] **Step 4: Implement sticky desktop card and mobile dock/sheet**

Use 44px minimum targets, visible focus, safe-area bottom padding, and body-portalled dialog. Back closes the sheet/dialog unless mutation is running. Avoid hardcoded dark hex colors; use market/theme tokens.

- [ ] **Step 5: Convert account and transfer copy**

Show `1P = 1원`, projected balances in their respective units, and simple 520px account rows. Empty holdings show `아직 보유한 주식이 없어요` and `종목 둘러보기`.

- [ ] **Step 6: Write failing admin-event UI tests**

Assert only an authorized Hansol prop renders `시장 관리`; event form requires stock, event kind, title, signed impact/direction, start and optional end; halt requires an end or explicit indefinite choice; submit is disabled while saving; active events can be ended/deleted.

- [ ] **Step 7: Run admin UI tests and verify RED**

Run: `node --test ./tests/playgroundMarketOrderUi.test.ts`
Expected: FAIL on absent admin panel.

- [ ] **Step 8: Implement the admin panel**

Use a compact dialog, not a permanent dashboard. Presets: `호재 뉴스`, `악재 뉴스`, `상승 충격`, `하락 충격`, `상승 추세`, `하락 추세`, `거래 정지`. Event success refreshes the authoritative event list and adds a news marker when applicable.

- [ ] **Step 9: Verify GREEN**

Run order UI/theme/playground tests and `npm run typecheck`.

- [ ] **Step 10: Commit**

```powershell
git add package.json src/views/playground/market tests/playgroundMarketOrderUi.test.ts tests/playgroundMarketUiWiring.test.ts tests/playgroundMarketTheme.test.ts
git commit -m "주문창 고정과 관리자 시세 제어 추가"
```

---

### Task 6: Playground history와 Windows 마우스 뒤로가기

**Files:**
- Create: `src/features/playground/history.ts`
- Modify: `src/features/playground/routes.ts`
- Modify: `src/views/PlaygroundView.tsx`
- Modify: `src/views/playground/PlaygroundShell.tsx`
- Modify: `src/views/playground/market/MarketNav.tsx`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Modify: `src/mocks/devElectronAPI.ts`
- Modify: `tests/playgroundRoutes.test.ts`
- Modify: `tests/playgroundNavigationWiring.test.ts`
- Create: `tests/playgroundHistory.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `createPlaygroundHistory(initialRoute)` with `current()`, `push(route)`, `replace(route)`, `canGoBack()`, `back()`.
- Produces preload `onPlaygroundNativeBack(listener): () => void`.

- [ ] **Step 1: Write failing history behavior tests**

Assert `lobby → house → market home → stock → account` backs up in reverse order; duplicate route pushes are ignored; a home `focusRequest` replaces the top; the last back returns to lobby and then returns null. Assert dialog/back interception is wired before route pop.

- [ ] **Step 2: Run history tests and verify RED**

Run: `node --test ./tests/playgroundHistory.test.ts`
Expected: FAIL because the history module is absent.

- [ ] **Step 3: Implement local history and controller wiring**

Record the route only when navigation commits. Dot wipe records at `onCovered`, not click time. Preserve market home scroll and opener focus on back. Clear history on Playground unmount/user switch. Existing global `navigationBackStack` remains untouched.

- [ ] **Step 4: Write failing native back IPC tests**

Assert BrowserWindow listens for `app-command`, filters exact `browser-backward`, sends `playground:native-back`, preload exposes a disposer, and Playground subscribes only while mounted.

- [ ] **Step 5: Run navigation wiring tests and verify RED**

Run: `node --test ./tests/playgroundNavigationWiring.test.ts`
Expected: FAIL on missing app-command/IPC subscription.

- [ ] **Step 6: Implement native back bridge and common Back action**

Use the same controller for visible back buttons and native events. Back priority: active mutable dialog/sheet close; mutation-in-progress ignore; transition-in-progress ignore; history pop; return to source. Remove the listener on window close and component unmount.

- [ ] **Step 7: Verify GREEN**

Run history/routes/navigation/playground tests and `npm run typecheck`.

- [ ] **Step 8: Commit**

```powershell
git add package.json electron/main.ts electron/preload.ts src/types/index.ts src/mocks/devElectronAPI.ts src/features/playground src/views/PlaygroundView.tsx src/views/playground tests/playgroundHistory.test.ts tests/playgroundRoutes.test.ts tests/playgroundNavigationWiring.test.ts
git commit -m "화면과 마우스 뒤로가기를 하나로 연결"
```

---

### Task 7: 배한솔 접근 게이트·릴리스 문서·전체 검증

**Files:**
- Modify: `src/features/playground/featureFlag.ts`
- Modify: every existing access call site and access test
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DEVLOG/update-notes.json`
- Modify: `ROADMAP.md`
- Test: all relevant `tests/playground*.test.ts`

**Interfaces:**
- Production access is canonical Hansol UUID `fcc4b438-2696-4e88-a03f-d6f34e73e08f` plus exact normalized name `배한솔`; browser preview uses ID `1` plus exact name only when explicit preview mode is true.
- Version output is exactly `1.80.0`.

- [ ] **Step 1: Write failing fail-closed access tests**

Assert exact canonical ID/name is allowed; same name with another ID is denied; same ID with another name is denied; missing user denied; preview ID is allowed only when explicit preview mode is true. Assert sidebar and App route both call the same helper.

- [ ] **Step 2: Run access tests and verify RED**

Run: `node --test ./tests/playgroundNavigationWiring.test.ts`
Expected: FAIL because the current helper is name-only.

- [ ] **Step 3: Implement the canonical access gate**

Keep the constant in one module. Do not expose Playground route content when unauthorized even if a stale `currentView='playground'` is restored.

- [ ] **Step 4: Add v1.80.0 release metadata**

Update package and lockfile versions to `1.80.0`. Prepend an update note titled `JBBJ 모의투자가 실제 시장처럼 움직여요` with nontechnical items covering live/candle charts, whole-share orders and fixed controls, persistent million-point test account, and easier back navigation. Mark Playground v2 test rollout in `ROADMAP.md` without claiming team-wide availability.

- [ ] **Step 5: Run focused and full development verification**

Run in this order:

```powershell
npm run test:playground
npm run typecheck
npm run test:auto-update
npm run build:vite
```

Expected: every command exits 0.

- [ ] **Step 6: Start preview and verify real interactions**

Log in with `배한솔` / `1234`. Verify live movement for at least 5 seconds, line/candle toggle, every interval/range, sticky order at 1440×900, dock at 800×600, point transfer, 1-share buy/sell, account persistence after reload, visible back, and browser Back behavior. Then log in as a non-Hansol mock user and verify the sidebar item and direct route are absent/blocked.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json DEVLOG/update-notes.json ROADMAP.md src/features/playground/featureFlag.ts src tests
git commit -m "배한솔 전용 모의투자 v1.80.0 출시 준비"
```

---

### Task 8: DB 적용·리뷰·병합·정식 빌드·manifest-last 배포

**Files:**
- Read/verify: `DEVLOG/migrations/2026-07-11-playground-market-v2.sql`
- Build output: `dist/BFLOW-Setup.exe`, `dist/latest.yml`, `dist/manifest.json`
- Deployment: `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist`

**Interfaces:**
- Supabase project: `mpqifkpxalwxgcrddchv`.
- Canonical seed lookup: `name='배한솔'`, `slack_id='U05DFV9UAN5'`.

- [ ] **Step 1: Run final whole-branch review and fix all Critical/Important findings**

Generate a diff package from the merge base. Dispatch a fresh reviewer for spec compliance and code quality. Re-run covering tests after each fix and repeat review until clean.

- [ ] **Step 2: Apply the reviewed migration and verify live DB**

Use the Supabase migration tool once with migration name `playground_market_v2`. Query the five tables, function privileges, RLS flags, Hansol balances, holdings count, and initial ledger. Reinvoke the idempotent initialization path or equivalent verification transaction and prove the grant remains exactly once. Run Supabase security and performance advisors and resolve new findings caused by this migration.

- [ ] **Step 3: Push branch, open PR, review, and merge**

Create a PR with the required Korean nontechnical update summary, technical details, development difficulties, and user/developer test guides. Complete review checks, merge, and fast-forward `C:\Bflow-BGonly` main.

- [ ] **Step 4: Build release from deployment checkout**

Run `npm run build` in `C:\Bflow-BGonly`. Confirm version `1.80.0` and existence of installer, latest.yml, manifest and win-unpacked app package.

- [ ] **Step 5: Deploy manifest last**

Mirror all `dist` contents except `manifest.json` to the G Drive dist directory. Check robocopy exit code `< 8`. Copy `manifest.json` last.

- [ ] **Step 6: Verify deployed hashes and version**

Compare local/remote SHA-256 for `BFLOW-Setup.exe`, `latest.yml`, `manifest.json`; all must match. Confirm both manifest and latest.yml identify `1.80.0`.

- [ ] **Step 7: Verify installed update outcome**

Confirm the installed app package version, latest process path, pending-installer cleanup, and `swap.log` installer success markers. Reopen the installed app as 배한솔 and recheck Playground visibility/live price. Do not send Slack or team-wide announcements.

---

## Plan Self-Review

- Spec coverage: requirements 1–5 and the approved follow-up decisions map to Tasks 1–7; deployment maps to Task 8.
- Persistence: live Electron never falls back to a grant-producing seed; preview persistence is explicitly isolated.
- Type consistency: `priceWon`, `cashWon`, `quantityShares`, `costBasisWon`, `MarketCandle`, and `MarketAdminEvent` names are consistent across tasks.
- Security: migration requires RLS, explicit grants, empty search path for definer functions, canonical main-process identity, and no service-role key.
- Visual fidelity: existing Toss-like dark screen/order/account hierarchy stays intact; only required chart/order/navigation additions are introduced.
- Placeholder scan: no TBD, TODO, or unspecified test step remains.
