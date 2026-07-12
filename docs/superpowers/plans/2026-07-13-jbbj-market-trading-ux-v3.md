# JBBJ 시장 거래 UX·현실형 시세 v3 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인 목업의 양방향 빠른주문과 확대·이동 가능한 OHLCV 차트를 실제 배플레이그라운드에 적용하고, 모든 화면과 Electron canonical quote가 누적 수익률 기반의 같은 결정론적 시장 모델을 사용하게 한다.

**Architecture:** `shared/playgroundMarketModel.mjs`가 순수 결정론적 일·분·초 시세와 거래량을 만들고 기존 `shared/playgroundMarketPrice.mjs`가 호환 facade로 이를 노출한다. renderer의 candle/홈 스파크라인/전일 종가와 Electron main의 체결 재검증은 이 facade만 사용한다. 주문 controller는 공통 수량 하나에서 매수·매도 preview를 독립 계산하되 기존 frozen command, request ID, 재검증, 낙관적 rollback을 유지한다. Lightweight Charts는 순수 adapter와 React lifecycle 경계로 분리해 Node 단위 테스트와 실제 브라우저 검증을 모두 가능하게 한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Tailwind CSS, Zustand, Node `node:test`, TradingView Lightweight Charts 5.2.0.

## Global Constraints

- 모든 변경은 `C:\Bflow-BGonly`에서만 수행하고 참고용 Bflow 원본은 수정하지 않는다.
- 승인 원본은 `docs/superpowers/specs/2026-07-13-jbbj-market-trading-ux-v3-design.md`와 `docs/superpowers/mockups/2026-07-13-jbbj-market-quick-order-chart-v3.html`이다.
- 실제 시세 API, 신규 DB table/migration, 실제 개장 시간, 지정가 체결, 수수료·세금·배당, 사용자 주문의 가격 영향은 추가하지 않는다.
- JBBJ 시장은 24시간 열리며 같은 모델 revision, 종목, UTC 시각, 관리자 이벤트 집합이면 모든 PC가 같은 가격·OHLC·거래량을 계산한다.
- 가격 모델은 `Math.random()`과 로컬 시간대를 사용하지 않고 기준 epoch `2025-01-01T00:00:00Z`와 안전한 정수만 사용한다.
- `shared/playgroundMarketPrice.mjs`의 `MARKET_INSTRUMENT_PROFILES`, `getLivePriceWon`, `getCanonicalMarketQuoteWon` 기존 호출 계약을 유지한다.
- snapshot의 거래 revision은 체결마다 바뀌므로 자연 시세 shock seed로 사용하지 않는다. 고정 모델 revision과 이벤트 fingerprint만 cache/seed에 사용한다.
- 계좌·보유·원가·실현손익·canonical 사용자 판정·멱등 request ID·응답 유실 재시도·낙관적 rollback 계약은 변경하지 않는다.
- 데스크톱 1280px 이상은 `minmax(0, 1fr) + 360px`와 sticky 주문 패널, 미만은 한 열 본문과 양방향 하단 dock·동일 주문 sheet를 사용한다.
- 매수는 `market-up` 빨강, 매도는 `market-down` 파랑 토큰을 사용하고 색상과 함께 `사기`·`팔기` 텍스트를 제공한다.
- 주문 수량은 하나이며 `1주`, `5주`, `10주`, `최대`, 직접 입력, ±1 steppers를 제공한다. 한쪽 validation 실패는 반대쪽 버튼을 막지 않는다.
- 차트는 `1분/5분/10분/15분/1시간/1일`, `오늘/1주/1개월/6개월/전체`, `선/캔들` 드롭다운과 reset을 제공하고 최대 1,500봉만 전달한다.
- 기간별 최소 자동 간격은 `오늘 1분`, `1주 10분`, `1개월 1시간`, `6개월 1일`, `전체 1일`이다.
- 차트는 휠 zoom, pressed-mouse drag pan, 축 drag, double-click/reset, touch drag, pinch를 제공하며 가격과 분리된 volume pane과 TradingView attribution을 포함한다.
- 모든 input/select/icon button은 보이는 label 또는 고유 `aria-label`, 44px 이상 target, visible focus ring을 갖고 선택 봉을 `aria-live`로 알린다.
- 차트 실패가 현재가·주문·계좌를 막지 않으며 `차트를 표시하지 못했어요`와 `다시 시도` fallback을 제공한다.
- 테스트 모드는 실제 앱과 같은 계산·상호작용을 제공한다.
- 기능 버전은 `1.81.0`이며 package, lockfile, update notes, ROADMAP, CONTEXT, AGENTS를 함께 갱신한다.
- 코드 변경 후 `npm run typecheck`, `npm run test:playground`, `npm run build:vite`를 통과한다. 정식 배포 요청이 없으므로 `npm run build`와 G드라이브 배포는 하지 않는다.
- 기존 미추적 사용자 파일과 로그는 건드리지 않고 task별 정확한 경로만 stage한다.

---

## File Structure

- `shared/playgroundMarketModel.mjs`: 해시 PRNG, regime, 일별 checkpoint, 분별 누적 경로, micro path, 이벤트 overlay, 거래량.
- `shared/playgroundMarketPrice.mjs`, `shared/playgroundMarketPrice.d.mts`: 기존 호환 export와 새 minute/daily API.
- `src/features/playground/market/types.ts`: 확장 종목 profile과 `MarketCandle.volumeShares`.
- `src/features/playground/market/chartSeries.ts`: 1분 OHLCV 생성과 5/10/15/60분/일 집계.
- `src/features/playground/market/marketDisplaySeries.ts`: 완성봉 cache와 최대 1,500봉 display series.
- `src/features/playground/market/marketQuote.ts`: 현재가·KST 전일 종가·홈 sparkline을 한 엔진에서 만든 quote context.
- `src/features/playground/market/domain.ts`: 순수 보유 손익 요약.
- `src/views/playground/market/useMarketOrderController.ts`: 공통 수량, 양쪽 preview/validation, 방향을 인자로 받는 confirmation.
- `src/views/playground/market/MarketOrderPanel.tsx`: 승인 목업의 양방향 빠른주문.
- `src/features/playground/market/marketChartAdapter.ts`: Lightweight Charts v5 순수 data/options/lifecycle adapter.
- `src/views/playground/market/MarketInteractiveChart.tsx`: ResizeObserver와 React lifecycle.
- `src/views/playground/market/MarketPriceChart.tsx`: 드롭다운, 자동 interval 보정, selected-candle aria-live, error retry.
- `src/views/playground/market/StockDetailView.tsx`: summary card, 차트, 보유 상태, 소식, 360px 주문 열.
- `tests/playgroundMarketPriceEngine.test.ts`: 결정론적 시세·이벤트·상관·OHLCV.
- `tests/playgroundMarketChartUi.test.ts`: interval/range, 1,500봉, adapter, cleanup, 접근성 wiring.
- `tests/playgroundMarketOrderUi.test.ts`, `tests/playgroundMarketDomain.test.ts`: 공통 수량, 독립 validation, 보유 손익.

---

### Task 1: 누적 수익률 기반 결정론적 시장 모델

**Files:**
- Create: `shared/playgroundMarketModel.mjs`
- Modify: `shared/playgroundMarketPrice.mjs`
- Modify: `shared/playgroundMarketPrice.d.mts`
- Modify: `src/features/playground/market/types.ts`
- Modify: `src/features/playground/market/livePriceEngine.ts`
- Modify: `tests/playgroundMarketPriceEngine.test.ts`

**Interfaces:**

```ts
export interface MarketInstrumentProfile {
  stockId: string;
  basePriceWon: number;
  volatilityBps: number;
  phase: number;
  sectorId?: 'studio' | 'platform' | 'creative-tools' | 'collaboration';
  marketBeta?: number;
  sectorBeta?: number;
  idiosyncraticVolatilityBps?: number;
  longTermDriftBps?: number;
  baseMinuteVolume?: number;
  jumpSensitivity?: number;
}
```

```js
getMarketDailyCheckpoint(profile, dayStartMs, events)
// => { dayStartMs, openWon, highWon, lowWon, closeWon, volumeShares, regime }

getMarketMinuteBar(profile, minuteStartMs, observedUntilMs, events)
// => { openWon, highWon, lowWon, closeWon, volumeShares }
```

- [ ] **Step 1: 기존 호환과 새 모델 동작을 표현하는 실패 테스트 작성**

`tests/playgroundMarketPriceEngine.test.ts`에 같은 입력 deep equality, `observedUntilMs` 경계, 안전한 정수/OHLC, 일 close와 다음 open 연속, 180일 비회귀, market/sector 상관, volatility cluster, jump 상한, halt와 이벤트 종료 잔존 영향 테스트를 추가한다.

```ts
test('partial minute does not observe a future event or future tick', () => {
  const minuteStartMs = Date.parse('2026-07-13T01:00:00.000Z');
  const before = getMarketMinuteBar(profile, minuteStartMs, minuteStartMs + 19_000, []);
  const withFuture = getMarketMinuteBar(profile, minuteStartMs, minuteStartMs + 19_000, [{
    id: 'future', stockId: profile.stockId, revision: 1, kind: 'shock-up', impactBps: 900,
    startsAt: new Date(minuteStartMs + 40_000).toISOString(), endsAt: null,
  }]);
  assert.deepEqual(withFuture, before);
});

test('halt freezes price and makes observed volume zero', () => {
  const bar = getMarketMinuteBar(profile, minuteStartMs, minuteStartMs + 59_999, [halt]);
  assert.equal(bar.openWon, bar.closeWon);
  assert.equal(bar.lowWon, bar.highWon);
  assert.equal(bar.volumeShares, 0);
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts`

Expected: FAIL because `getMarketDailyCheckpoint`, `getMarketMinuteBar`, enhanced profile fields, and volume do not exist.

- [ ] **Step 3: 순수 모델의 최소 구현**

고정 64-bit 문자열 hash → `[0,1)` uniform → Box-Muller normal을 구현하고 모든 key를 `MODEL_REVISION|bucket|factorId` 형태로 만든다. `Math.random()`과 snapshot revision은 사용하지 않는다.

일별 수익률은 다음 식을 그대로 구현한다.

```js
const dailyReturn = clamp(
  regimeDrift
    + profile.marketBeta * marketShock
    + profile.sectorBeta * sectorShock
    + idiosyncraticShock
    + rareJump,
  -0.24,
  0.24,
);
const closeWon = safeWon(Math.exp(Math.log(previousCloseWon) + dailyReturn));
```

regime은 hash로 얻은 지속 길이 3~18일 segment에 `bull | bear | sideways`를 부여해 하루마다 무작위로 뒤집히지 않게 한다. 같은 market shock과 sector shock은 해당 일의 모든 종목이 공유하고 고유 shock만 `stockId`를 포함한다.

분별 raw return은 다음 상태를 순차 계산하고 마지막 합을 그날 목표 log return에 맞춘다.

```js
variance = clamp(baseVariance * 0.08 + variance * 0.86 + previousReturn ** 2 * 0.06,
  baseVariance * 0.35, baseVariance * 12);
raw[minute] = sharedShock + sectorShock + Math.sqrt(variance) * idiosyncraticShock + jump;
bridged[minute] = raw[minute] + (targetDailyReturn - sum(raw)) / 1440;
```

관리자 이벤트는 base bridge에 섞지 않고 요청 시각까지의 causal log-level overlay로 더한다. `shock/news`는 빠른 진입 후 종료 시 잔존 수준과 exponential decay, `trend`는 기간 동안 누적 후 최종 수준 유지, `halt`는 시작 1초 전 가격 고정과 0 volume을 사용한다.

거래량은 관측된 초 비율에 맞춰 다음 곱을 안전한 정수로 만든다.

```js
volume = baseMinuteVolume * observedFraction * kstActivityFactor
  * volatilityFactor * absoluteReturnFactor * eventFactor * deterministicNoise;
```

기존 4개 profile 필드만 가진 테스트용 profile은 optional enhanced fields의 안정된 기본값을 사용한다. 특히 `volatilityBps === 0`이고 이벤트가 없으면 기존처럼 상수 가격을 유지한다.

- [ ] **Step 4: GREEN과 회귀 확인**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts`

Expected: PASS; 동일 종목/UTC/event input은 byte-for-byte 동일하고 기존 facade tests도 유지된다.

- [ ] **Step 5: Commit**

```powershell
git add shared/playgroundMarketModel.mjs shared/playgroundMarketPrice.mjs shared/playgroundMarketPrice.d.mts src/features/playground/market/types.ts src/features/playground/market/livePriceEngine.ts tests/playgroundMarketPriceEngine.test.ts
git commit -m "모의시장 누적 시세와 거래량 모델 추가"
```

---

### Task 2: OHLCV 집계와 홈·상세·체결 시세 통일

**Files:**
- Modify: `src/features/playground/market/types.ts`
- Modify: `src/features/playground/market/chartSeries.ts`
- Modify: `src/features/playground/market/marketDisplaySeries.ts`
- Modify: `src/features/playground/market/marketChartUi.ts`
- Modify: `src/features/playground/market/marketQuote.ts`
- Modify: `src/features/playground/market/seed.ts`
- Modify: `src/views/playground/market/MarketRouter.tsx`
- Modify: `src/views/playground/market/MarketRows.tsx`
- Modify: `src/views/playground/market/MarketHome.tsx`
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Modify: `tests/playgroundMarketPriceEngine.test.ts`
- Modify: `tests/playgroundMarketChartUi.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`

**Interfaces:**

```ts
export interface MarketCandle {
  startsAt: string;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  volumeShares: number;
  newsIds: string[];
}

export interface MarketQuoteContext {
  quoteWonByStockId: Readonly<Record<string, number>>;
  previousCloseWonByStockId: Readonly<Record<string, number>>;
  sparklineByStockId: Readonly<Record<string, PricePoint[]>>;
}
```

- [ ] **Step 1: volume 집계와 화면 간 시세 일치 실패 테스트 작성**

```ts
test('aggregateCandles sums child volume', () => {
  const source = [candle({ volumeShares: 120 }), candle({ volumeShares: 80 })];
  assert.equal(aggregateCandles(source, '5m')[0]?.volumeShares, 200);
});

test('week range promotes one minute to ten minutes', () => {
  assert.equal(resolveIntervalForRange('1m', 'week'), '10m');
});
```

홈 sparkline 마지막 값, 상세 current quote, `getCanonicalMarketQuoteWon`가 같은 값을 반환하고 KST 전일 경계를 UTC 시각과 무관하게 동일 계산하는 테스트를 추가한다. 기존 candle fixture마다 `volumeShares`를 명시한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts ./tests/playgroundMarketChartUi.test.ts ./tests/playgroundMarketUiWiring.test.ts`

Expected: FAIL because candles have no volume, chart limit is 600, week promotes to 15m, and home rows still use fixed seed series.

- [ ] **Step 3: OHLCV와 quote context 구현**

`buildMinuteCandles`는 각 minute에 `getMarketMinuteBar(profile, start, observedUntil, events)`를 한 번 호출한다. `aggregateCandles`는 기존 open/first, high/max, low/min, close/last, news ID union 규칙에 아래 volume 합을 추가한다.

```ts
volumeShares: bucket.reduce((sum, candle) => sum + candle.volumeShares, 0),
```

`MAX_MARKET_CHART_BARS`를 1,500으로 바꾸고 `resolveIntervalForRange()`를 다음 표로 고정한다.

```ts
const MIN_INTERVAL_BY_RANGE: Record<MarketChartRange, MarketBarInterval> = {
  today: '1m', week: '10m', month: '1h', 'six-months': '1d', all: '1d',
};
```

`buildMarketQuoteContext(snapshot, nowMs)`는 profile별 현재 가격, KST 당일 00:00 직전 가격, 오늘 범위의 대표 48~96개 engine candle close를 만든다. `MarketRouter`에서 한 번 memoize해 홈, 상세, 계좌가 같은 context를 받는다. `MarketRows`의 `todaySeriesAtQuote()` 마지막 점 교체 방식은 제거하고 engine sparkline을 직접 사용한다. `seed.ts`의 고정 series/previous close는 초기 구조 호환용 fallback으로만 남기고 화면 계산에는 사용하지 않는다.

- [ ] **Step 4: GREEN과 성능 회귀 확인**

Run: `node --test ./tests/playgroundMarketPriceEngine.test.ts ./tests/playgroundMarketChartUi.test.ts ./tests/playgroundMarketUiWiring.test.ts`

Expected: PASS; display series는 1,500개 이하이며 완성봉 cache와 진행 중 마지막 봉 갱신을 유지한다.

- [ ] **Step 5: Commit**

```powershell
git add src/features/playground/market/types.ts src/features/playground/market/chartSeries.ts src/features/playground/market/marketDisplaySeries.ts src/features/playground/market/marketChartUi.ts src/features/playground/market/marketQuote.ts src/features/playground/market/seed.ts src/views/playground/market/MarketRouter.tsx src/views/playground/market/MarketRows.tsx src/views/playground/market/MarketHome.tsx src/views/playground/market/StockDetailView.tsx tests/playgroundMarketPriceEngine.test.ts tests/playgroundMarketChartUi.test.ts tests/playgroundMarketUiWiring.test.ts
git commit -m "홈과 차트의 시세·거래량 계산 통일"
```

---

### Task 3: 공통 수량 기반 양방향 주문 controller

**Files:**
- Modify: `src/features/playground/market/domain.ts`
- Modify: `src/views/playground/market/useMarketOrderController.ts`
- Modify: `tests/playgroundMarketDomain.test.ts`
- Modify: `tests/playgroundMarketOrderUi.test.ts`
- Modify: `tests/playgroundMarketPreviewStore.test.ts`

**Interfaces:**

```ts
export interface MarketHoldingSummary {
  averagePriceWon: number | null;
  marketValueWon: number;
  unrealizedPnlWon: number;
  unrealizedPnlRate: number | null;
}

export function getMarketHoldingSummary(
  holding: Holding | null | undefined,
  currentPriceWon: number,
): MarketHoldingSummary;
```

```ts
type MarketOrderBySide<T> = Record<MarketOrderSide, T>;

interface MarketOrderController {
  quantityInput: string;
  selectedChoice: MarketShareChoice | null;
  previewBySide: MarketOrderBySide<FrozenMarketOrder | null>;
  validationBySide: MarketOrderBySide<string | null>;
  availableBuyShares: number;
  availableSellShares: number;
  setQuantityInput(value: string): void;
  stepQuantity(delta: -1 | 1): void;
  selectChoice(choice: MarketShareChoice): void;
  openSheet(opener: HTMLElement, preferredSide?: MarketOrderSide): void;
  openConfirmation(side: MarketOrderSide, opener?: HTMLElement): void;
}
```

- [ ] **Step 1: 보유 손익·독립 주문 validation 실패 테스트 작성**

```ts
assert.deepEqual(getMarketHoldingSummary({
  stockId: 'jbbj', quantityShares: 4, costBasisWon: 6_760,
}, 1_842), {
  averagePriceWon: 1_690,
  marketValueWon: 7_368,
  unrealizedPnlWon: 608,
  unrealizedPnlRate: (608 / 6_760) * 100,
});
```

공통 2주에서 보유 1주면 sell만 실패/buy는 통과, 현금 부족이면 buy만 실패/sell은 통과, stepper가 최소 1주를 유지, `openConfirmation('sell')`과 `openConfirmation('buy')`가 전달받은 방향으로 각각 freeze하는 테스트를 추가한다. Preview store에는 buy 응답 유실과 대칭인 sell 동일 request ID 재시도 테스트를 추가한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketOrderUi.test.ts ./tests/playgroundMarketPreviewStore.test.ts`

Expected: FAIL because holding summary and side-indexed controller API do not exist.

- [ ] **Step 3: 표시 helper와 controller 구현**

`getMarketHoldingSummary`는 미보유 시 nullable 값을 반환하고 보유 시 `Math.round(costBasisWon / quantityShares)`, 기존 `holdingValueWon`, `marketValueWon - costBasisWon`, `pnl / costBasisWon * 100`을 사용한다.

`MARKET_SHARE_CHOICES`는 `[1, 5, 10, 'max']`로 줄이고 직접 입력은 항상 보이는 field로 분리한다. `freezeMarketOrder`는 choice 해석을 끝낸 정확한 `quantityShares`를 받는다.

```ts
freezeMarketOrder({ snapshot, stock, side, quantityShares, quotedPriceWon }): FrozenMarketOrder
```

controller는 같은 `quantityShares`로 buy/sell 두 preview를 만들고 `validateMarketCommand`를 각각 실행한다. `openConfirmation(side)`는 `setSide()` 후 stale state를 읽지 않고 전달받은 `side`로 즉시 frozen command를 만든다. 기존 `confirm()`의 최신 snapshot 재검증, drift 시 재확인, 최초 request ID 생성, 응답 유실 시 동일 ID 재시도는 그대로 둔다.

- [ ] **Step 4: GREEN 확인**

Run: `node --test ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketOrderUi.test.ts ./tests/playgroundMarketPreviewStore.test.ts`

Expected: PASS; 한쪽 오류가 반대 버튼에 전파되지 않고 기존 rollback/idempotency tests도 통과한다.

- [ ] **Step 5: Commit**

```powershell
git add src/features/playground/market/domain.ts src/views/playground/market/useMarketOrderController.ts tests/playgroundMarketDomain.test.ts tests/playgroundMarketOrderUi.test.ts tests/playgroundMarketPreviewStore.test.ts
git commit -m "공통 수량의 양방향 주문 계산 추가"
```

---

### Task 4: 승인 목업의 빠른주문·반응형 layout 구현

**Files:**
- Modify: `src/views/playground/market/MarketOrderPanel.tsx`
- Modify: `src/views/playground/market/MarketMobileOrderDock.tsx`
- Modify: `src/views/playground/market/MarketOrderDialogs.tsx`
- Modify: `src/views/playground/market/MarketActionDialog.tsx`
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Modify: `src/views/playground/market/MarketRouter.tsx`
- Modify: `tests/playgroundMarketOrderUi.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `tests/playgroundMarketTheme.test.ts`

- [ ] **Step 1: 새 정보 순서와 반응형 계약의 실패 test 작성**

source wiring tests에서 `현재 가격 → 예수금 → 수량 → presets → 판매/구매 가능 → 예상 금액 → 팔기/사기 → 보유 요약 → 최신 가격 안내`의 DOM 순서, `market-down`/`market-up` semantic classes, `minmax(0,1fr)_360px`, 1280px dock 분기, body scroll lock, safe-area padding을 검증한다. 기존 방향 tab, `직접 입력` preset, 단일 accent CTA, 지정가 preview 문구는 존재하지 않아야 한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketOrderUi.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts`

Expected: FAIL because current panel is tabbed and uses one purple action.

- [ ] **Step 3: A안 주문 panel과 상세 summary 구현**

`MarketOrderPanel`은 store를 직접 import하지 않고 controller만 사용한다. 수량 input은 `<label htmlFor>`를 갖고 ± 버튼과 preset은 최소 44px, 각 action은 자신의 `validationBySide`만으로 disabled 처리한다. 주문 버튼 순서는 파란 `현재가 팔기`, 빨간 `현재가 사기`다. 보유가 없으면 `아직 보유한 주식이 없어요`를 표시한다.

`MarketMobileOrderDock`은 양쪽 버튼을 동시에 표시하고 어느 버튼을 눌러도 같은 panel sheet를 열되 preferred side만 focus/설명에 사용한다. sheet가 열리면 body scroll을 잠그고 cleanup에서 원래 값을 복원한다. 기존 Escape, 뒤로가기, focus trap, opener focus restore는 유지한다.

`StockDetailView`는 회사/현재가/오늘 변화/이유를 하나의 summary card로 합치고 `xl:grid-cols-[minmax(0,1fr)_360px]`를 사용한다. sticky aside는 viewport보다 길면 내부 scroll하며 작은 화면은 dock+safe area만큼 bottom padding을 둔다.

- [ ] **Step 4: GREEN 확인**

Run: `node --test ./tests/playgroundMarketOrderUi.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts`

Expected: PASS; 기존 dialog confirmation과 account link focus behavior도 유지된다.

- [ ] **Step 5: Commit**

```powershell
git add src/views/playground/market/MarketOrderPanel.tsx src/views/playground/market/MarketMobileOrderDock.tsx src/views/playground/market/MarketOrderDialogs.tsx src/views/playground/market/MarketActionDialog.tsx src/views/playground/market/StockDetailView.tsx src/views/playground/market/MarketRouter.tsx tests/playgroundMarketOrderUi.test.ts tests/playgroundMarketUiWiring.test.ts tests/playgroundMarketTheme.test.ts
git commit -m "빠른주문 양방향 UI와 반응형 배치 적용"
```

---

### Task 5: Lightweight Charts v5 adapter와 데이터 변환

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/playground/market/marketChartAdapter.ts`
- Modify: `src/features/playground/market/marketChartUi.ts`
- Modify: `tests/playgroundMarketChartUi.test.ts`

**Interfaces:**

```ts
export interface MarketChartAdapter {
  render(input: {
    candles: readonly MarketCandle[];
    style: MarketChartStyle;
    fitContent: boolean;
  }): void;
  applyTheme(theme: MarketChartTheme): void;
  resize(width: number, height: number): void;
  fitContent(): void;
  destroy(): void;
}

export function createMarketChartAdapter({
  container, runtime, theme, onCrosshairCandle,
}: CreateMarketChartAdapterOptions): MarketChartAdapter;
```

- [ ] **Step 1: 순수 adapter 옵션·data·cleanup 실패 테스트 작성**

fake runtime으로 `createChart`, `addSeries`, `setData`, `update`, `removeSeries`, `subscribe/unsubscribeCrosshairMove`, visible logical range, `fitContent`, `remove` 호출을 기록한다. 다음 interaction contract를 정확히 assertion한다.

```ts
handleScroll: {
  mouseWheel: true,
  pressedMouseMove: true,
  horzTouchDrag: true,
  vertTouchDrag: false,
},
handleScale: {
  mouseWheel: true,
  pinch: true,
  axisPressedMouseMove: { time: true, price: true },
  axisDoubleClickReset: true,
},
```

OHLC timestamp 변환, line data, candle data, volume histogram의 상승 빨강/하락 파랑, volume pane index 1, full `setData`와 마지막 봉 `update`, style 변경 시 visible range 복원, destroy 1회 cleanup을 테스트한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketChartUi.test.ts`

Expected: FAIL because the adapter and Lightweight Charts dependency do not exist.

- [ ] **Step 3: dependency와 adapter 최소 구현**

Run: `npm install lightweight-charts@5.2.0 --save`

lockfile의 기존 local `bflow` dependency는 변경하지 않는다. adapter는 v5 API를 사용한다.

```ts
const chart = runtime.createChart(container, options);
const priceSeries = chart.addSeries(
  style === 'candlestick' ? runtime.CandlestickSeries : runtime.LineSeries,
  priceOptions,
  0,
);
const volumeSeries = chart.addSeries(runtime.HistogramSeries, {
  priceFormat: { type: 'volume' },
  priceScaleId: 'volume',
}, 1);
```

상승 봉은 `market-up`, 하락 봉은 `market-down`의 resolved CSS color를 사용한다. `startsAt`은 UTC seconds `UTCTimestamp`로 변환하며 invalid/unsafe candle은 adapter input에서 제외하고 개발 log를 남긴다. TradingView attribution은 공식 `attributionLogo: true` 옵션 또는 차트 하단 공식 링크 중 한 방식으로 제공한다.

- [ ] **Step 4: GREEN과 type contract 확인**

Run: `node --test ./tests/playgroundMarketChartUi.test.ts`

Expected: PASS with fake runtime. Task 6에서 real package typings는 `npm run typecheck`로 확인한다.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/features/playground/market/marketChartAdapter.ts src/features/playground/market/marketChartUi.ts tests/playgroundMarketChartUi.test.ts
git commit -m "Lightweight Charts 데이터 어댑터 추가"
```

---

### Task 6: React 차트 lifecycle·드롭다운·오류 복구

**Files:**
- Create: `src/views/playground/market/MarketInteractiveChart.tsx`
- Modify: `src/views/playground/market/MarketPriceChart.tsx`
- Delete: `src/views/playground/market/MarketChartCanvas.tsx`
- Modify: `src/features/playground/market/useMarketChartPreference.ts`
- Modify: `tests/playgroundMarketChartUi.test.ts`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `tests/playgroundMarketTheme.test.ts`

- [ ] **Step 1: React wiring과 접근성 실패 test 작성**

Node 22가 `.tsx`를 직접 실행하지 못하고 jsdom이 없으므로 TSX는 source contract로 검증하고 명령형 behavior는 Task 5 adapter test로 검증한다. source test는 `ResizeObserver`, `disconnect`, adapter `destroy`, selected candle callback, retry key, 세 select option, visible label/aria-label, aria-live, reset button, attribution, fallback copy를 확인한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketChartUi.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts`

Expected: FAIL because canvas buttons and custom pointer chart remain.

- [ ] **Step 3: React chart 경계와 controls 구현**

`MarketInteractiveChart`는 mount에서 adapter를 한 번 만들고 `ResizeObserver`로 container size를 전달한다. unmount에서 observer disconnect 후 adapter `destroy()`를 정확히 한 번 호출한다. 전체 candle fingerprint/interval/range가 바뀌면 `setData`, 같은 series의 진행 중 마지막 봉만 바뀌면 `update`하도록 adapter에 input을 전달한다.

`MarketPriceChart`는 다음 visible labels와 values를 갖는 `<select>` 세 개를 사용한다.

```ts
const INTERVAL_OPTIONS = [
  ['1m', '1분'], ['5m', '5분'], ['10m', '10분'],
  ['15m', '15분'], ['1h', '1시간'], ['1d', '1일'],
] as const;
const RANGE_OPTIONS = [
  ['today', '오늘'], ['week', '1주'], ['month', '1개월'],
  ['six-months', '6개월'], ['all', '전체'],
] as const;
const STYLE_OPTIONS = [['line', '선'], ['candlestick', '캔들']] as const;
```

range 선택 시 interval 자동 승격과 `aria-live` 안내 후 `fitContent`; style 전환 시 visible range 보존; reset/double-click은 `fitContent`를 호출한다. crosshair 선택 text는 `시간 · 시가 · 고가 · 저가 · 종가 · 거래량`을 모두 포함한다. localStorage v2 key로 line/candlestick만 기억하고 interval/range는 상세 진입 기본값으로 돌아간다.

chart adapter 생성/render가 throw하면 chart 카드 안에 fallback과 retry button을 표시하되 부모 summary/order panel은 그대로 남긴다.

- [ ] **Step 4: GREEN, typecheck, dependency bundle 확인**

Run: `node --test ./tests/playgroundMarketChartUi.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts`

Run: `npm run typecheck`

Expected: PASS; Lightweight Charts 5.2 API mismatch와 cleanup leak이 없다.

- [ ] **Step 5: Commit**

```powershell
git add src/views/playground/market/MarketInteractiveChart.tsx src/views/playground/market/MarketPriceChart.tsx src/features/playground/market/useMarketChartPreference.ts tests/playgroundMarketChartUi.test.ts tests/playgroundMarketUiWiring.test.ts tests/playgroundMarketTheme.test.ts
git rm src/views/playground/market/MarketChartCanvas.tsx
git commit -m "확대·이동 가능한 거래량 차트 적용"
```

---

### Task 7: 버전·문서·전체 회귀·Codex 실제 화면 검증

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DEVLOG/update-notes.json`
- Modify: `ROADMAP.md`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`
- Modify: `progress.md` (local ignored implementation ledger only; do not stage)

- [ ] **Step 1: 문서 contract test 또는 source assertion을 먼저 실패하도록 갱신**

기존 package/update-notes tests가 있으면 `1.81.0`과 새 note를 요구하도록 먼저 바꾸고 RED를 확인한다. 별도 test가 없으면 `tests/playgroundMarketUiWiring.test.ts`에 package version, update note headline, `lightweight-charts` dependency의 source contract를 추가한다.

- [ ] **Step 2: RED 확인**

Run: `node --test ./tests/playgroundMarketUiWiring.test.ts`

Expected: FAIL because version and user-facing update note are still 1.80.0.

- [ ] **Step 3: 버전과 문서 갱신**

`package.json`과 root lockfile version을 `1.81.0`으로 맞춘다. update note 첫 항목은 비개발자용으로 `양방향 빠른주문`, `휠 확대·드래그 이동·거래량`, `덜 인위적인 장세와 종목별 움직임`을 설명한다.

`ROADMAP.md`에는 배플레이그라운드 모의시장 실사용 피드백 반영 완료를 추가하되 포인트·게임 점수 정책 미확정 항목은 완료 처리하지 않는다. `CONTEXT.md`에는 shared deterministic model → renderer preview → Electron canonical 재검증 흐름과 새 파일 map을 추가한다. `AGENTS.md`에는 Playground v3 상태, Lightweight Charts stack, 로컬 시세/Supabase 계좌 경계, 문서 버전 2026-07-13을 갱신한다.

- [ ] **Step 4: 전체 자동 검증**

Run in order:

```powershell
npm run typecheck
npm run test:playground
npm run build:vite
```

Expected: 모두 exit 0, 새 console warning/error 없음. 실패하면 첫 원인을 재현하는 test를 추가해 RED→GREEN으로 고친 뒤 세 명령을 처음부터 다시 실행한다.

- [ ] **Step 5: Codex in-app preview 실제 상호작용 검증**

로컬 Chrome을 열지 않는다. Codex in-app Browser의 새 검증 tab을 사용하고 로그인 화면이 보이면 `배한솔 / 1234`로 로그인한다. 다음 viewport와 흐름을 각각 screenshot, text state, console로 확인한다.

- `1440×900`: 360px sticky 빠른주문, summary, 전체 차트, 세 dropdown.
- `1024×768`: 한 열 본문, 파란 팔기·빨간 사기 하단 dock.
- `800×600`: 주문 sheet 내부 scroll, safe area, background scroll lock.
- 다크·라이트: 텍스트/버튼 contrast와 visible focus.
- 차트: wheel zoom → drag pan → crosshair → style switch → range switch → reset.
- 주문: 공통 수량 변경 → sell-only disabled → buy-only disabled → 양쪽 confirmation → 취소/복귀.
- Console: 새 error 0건.

Playwright client를 사용할 수 있는 실행 URL이면 `C:\Users\user\.codex\skills\develop-web-game\scripts\web_game_playwright_client.js`로 짧은 action burst를 실행하고 생성 screenshot을 `view_image`로 직접 확인한다. Electron/Codex browser 경계 때문에 client가 접근하지 못하면 in-app Browser screenshot·console·DOM state로 같은 검증을 수행하고 이유를 `progress.md`에 남긴다.

- [ ] **Step 6: 문서 commit**

```powershell
git add package.json package-lock.json DEVLOG/update-notes.json ROADMAP.md CONTEXT.md AGENTS.md tests/playgroundMarketUiWiring.test.ts
git commit -m "모의투자 v3 버전과 사용 문서 갱신"
```

- [ ] **Step 7: 독립 전체 branch review와 잔여 수정**

branch 시작점 `d2615b1`부터 HEAD까지 review package를 만들고 `superpowers:requesting-code-review`의 reviewer에게 승인 spec, 이 계획, test report를 전달한다. Critical/Important findings는 하나의 fix task로 모두 고치고 covering tests와 전체 검증을 다시 실행한다. 최종 `git diff --check`, exact staged paths, `git status --short`, commit log를 확인한다.

---

## Completion Evidence

- `npm run typecheck` exit 0.
- `npm run test:playground` exit 0.
- `npm run build:vite` exit 0.
- 동일 input의 가격·OHLCV 결정론, 180일 상관/비회귀, event 종료/halt tests 통과.
- 공통 수량의 buy/sell 독립 validation과 기존 request ID/rollback tests 통과.
- Lightweight Charts wheel/drag/pinch options, OHLCV series, visible range, cleanup tests 통과.
- Codex in-app preview에서 1440/1024/800 viewport, dark/light, order/chart interactions, console 0건을 직접 확인.
- 사용자 미추적 파일은 보존되고 feature 관련 파일만 commit됨.

## Self-Review

- 승인 spec의 목표 7개를 Task 1~7에 각각 연결했다.
- 새 함수마다 먼저 실패하는 Node test 또는 source contract test가 있다.
- engine → candle/quote → controller/UI → chart adapter/React → docs/preview 순서라 task 간 interface가 단방향이다.
- 실제 시장 API, DB migration, 지정가·수수료 등 제외 범위를 계획 어디에도 다시 도입하지 않았다.
- 기존 facade, account store, canonical main, request ID와 rollback 계약을 binding constraint로 유지했다.
- 미정 항목이나 빈 예시 없이 exact values, signatures, commands, commit paths를 적었다.
