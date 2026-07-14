# 모의 주식 자동 뉴스와 차트 수정 구현 계획

> **실행 방식:** 테스트를 먼저 실패시키고, 작은 순서의 작업 단위마다 구현·리뷰·검증을 수행한다.

**목표:** 관리자 조작 없이 매일 생성되는 뉴스와 같은 가격 반영 경로를 만들고, 차트 패널 겹침과 시간봉 선택 혼동을 해결한다.

**아키텍처:** shared 자동 뉴스 생성기가 KST 날짜에서 이벤트를 만들고, shared 가격 wrapper가 수동 이벤트와 병합한다. 렌더러는 `MarketQuoteContext`의 동적 뉴스/이유를 표시하며, 차트는 표시 범위의 같은 이벤트 집합을 사용한다. 가격 pane은 라이브러리의 empty-pane 보존 기능으로 고정한다.

**기술:** Electron, React 18, TypeScript, Node test runner, Lightweight Charts 5.2, shared ESM `.mjs`.

---

### Task 1: 결정론적 자동 뉴스와 가격 wrapper 만들기

**Files:**
- Create: `shared/playgroundMarketAutoNews.mjs`
- Modify: `shared/playgroundMarketModel.mjs`
- Modify: `shared/playgroundMarketPrice.mjs`
- Modify: `shared/playgroundMarketPrice.d.mts`
- Create: `tests/playgroundMarketAutonomousNews.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

`tests/playgroundMarketAutonomousNews.test.ts`에 같은 KST 날짜의 결과가 deep-equal이고 ID가 `auto:2026-07-14:`로 시작하며, 이벤트 직전과 직후 canonical quote가 달라지고, KST 자정·manual/automatic ID 중복 제거·종료 뒤 감쇠·수동 배열 불변성이 지켜지는 계약을 작성한다.

**Step 2: Run test to verify it fails**

Run: `node --test tests/playgroundMarketAutonomousNews.test.ts`

Expected: 모듈/함수를 찾지 못해 실패한다.

**Step 3: Implement the minimal source**

`playgroundMarketAutoNews.mjs`에 KST day start·안정 hash·일일 한 건 선택·장중 공개시각·긍정/부정 제목/요약을 구현한다. 이벤트에는 `automatic: true`를 넣고, `getAutonomousMarketNewsForNow`, `getAutonomousMarketEventsForRange`를 export한다.

`playgroundMarketModel.mjs`는 `automatic: true`인 news만 종료 후 0까지 감쇠하고, event fingerprint와 completed-day 영향 판정이 그 짧은 효과 범위만 계산하게 한다.

`playgroundMarketPrice.mjs`는 `mergeMarketEvents`와 `getEffectiveMarketEventsForRange`를 export하고, `getLivePriceWon`, `getMarketMinuteBar`, `getMarketDailyCheckpoint`가 각 관측 범위에 필요한 자동 이벤트를 수동 이벤트와 병합해 raw model로 전달하게 한다. d.ts에는 `automatic?: boolean`과 새 export 계약을 동기화한다.

**Step 4: Run test to verify it passes**

Run: `node --test tests/playgroundMarketAutonomousNews.test.ts`

Expected: 결정성·KST 경계·가격 영향·감쇠·중복 제거가 모두 통과한다.

**Step 5: Commit**

```bash
git add shared/playgroundMarketAutoNews.mjs shared/playgroundMarketModel.mjs shared/playgroundMarketPrice.mjs shared/playgroundMarketPrice.d.mts tests/playgroundMarketAutonomousNews.test.ts package.json
git commit -m "모의주식 자동 뉴스 가격 모델 추가"
```

### Task 2: 동적 뉴스 표시와 주문/차트 경로 연결하기

**Files:**
- Modify: `src/features/playground/market/types.ts`
- Modify: `src/features/playground/market/marketQuote.ts`
- Modify: `src/views/playground/market/MarketHome.tsx`
- Modify: `src/views/playground/market/MarketRows.tsx`
- Modify: `src/views/playground/market/StockDetailView.tsx`
- Modify: `src/views/playground/market/MarketPriceChart.tsx`
- Modify: `tests/playgroundMarketDataWiring.test.ts`
- Modify: `tests/playgroundMarketChartUi.test.ts`
- Modify: `tests/playgroundMarketPriceEngine.test.ts`

**Step 1: Write failing tests**

추가 테스트는 `buildMarketQuoteContext`가 `news`, `reasonByStockId`를 반환하고 자동 뉴스 시작 시 renderer quote가 shared canonical quote와 같음을 검사한다. wiring test는 Home/Rows/Detail이 `snapshot.news`와 `stock.reason`을 직접 읽지 않으며 차트가 `getEffectiveMarketEventsForRange`를 사용함을 검사한다. chart display test는 자동 뉴스가 겹치는 candle의 `newsIds`에 자동 ID를 넣는지 검사한다.

**Step 2: Run tests to verify they fail**

Run: `node --test tests/playgroundMarketDataWiring.test.ts tests/playgroundMarketChartUi.test.ts tests/playgroundMarketPriceEngine.test.ts`

Expected: 새 context 속성과 새 표시 경로가 없어 실패한다.

**Step 3: Implement the minimal source**

`MarketQuoteContext`에 읽기 전용 `news`와 `reasonByStockId`를 추가한다. `marketQuote.ts`는 shared 자동 뉴스 메타데이터로 당일 공개된 뉴스와 관리자 최신 이벤트를 합쳐 정렬하고, 각 종목에 최신 뉴스 요약 또는 동적 기본 이유를 부여한다.

`MarketHome`, `MarketRows`, `StockDetailView`는 context만 사용한다. `MarketPriceChart`는 선택 range와 현재 시각으로 effective event set을 만들고 이후 progressive/current candle 계산의 input으로 사용한다. `StockDetailView`는 차트에 raw manual events를 넘겨 자동 이벤트가 UI·가격·주문 영역에 중복 저장되지 않게 한다.

Electron `main.ts`는 수정하지 않는다. Task 1에서 바뀐 wrapper export를 그대로 resolver로 주입하고 있다는 계약 테스트를 추가해 주문 canonical quote의 동등성을 지킨다.

**Step 4: Run tests to verify they pass**

Run: `node --test tests/playgroundMarketDataWiring.test.ts tests/playgroundMarketChartUi.test.ts tests/playgroundMarketPriceEngine.test.ts tests/playgroundMarketAutonomousNews.test.ts`

Expected: 동적 화면 데이터, candle news ID, canonical-price parity가 통과한다.

**Step 5: Commit**

```bash
git add src/features/playground/market/types.ts src/features/playground/market/marketQuote.ts src/views/playground/market/MarketHome.tsx src/views/playground/market/MarketRows.tsx src/views/playground/market/StockDetailView.tsx src/views/playground/market/MarketPriceChart.tsx tests/playgroundMarketDataWiring.test.ts tests/playgroundMarketChartUi.test.ts tests/playgroundMarketPriceEngine.test.ts
git commit -m "모의주식 동적 뉴스 화면과 차트 연결"
```

### Task 3: 거래량 pane 유지와 시간봉 선택 혼동 고치기

**Files:**
- Modify: `src/features/playground/market/marketChartAdapter.ts`
- Modify: `src/views/playground/market/MarketPriceChart.tsx`
- Modify: `tests/playgroundMarketChartUi.test.ts`

**Step 1: Write failing tests**

Lightweight Charts fake가 마지막 series 제거 시 빈 pane을 없애도록 만들고, 선→캔들→선 전환 뒤 price series는 pane 0, volume series는 pane 1인지 검사한다. UI test는 `resolveIntervalForRange(range, interval) === interval`인 옵션만 enabled이고 나머지는 disabled/설명되는지 검사한다.

**Step 2: Run test to verify it fails**

Run: `node --test tests/playgroundMarketChartUi.test.ts`

Expected: style 전환 후 두 series가 pane 0이 되고, 비호환 시간봉이 selectable이라 실패한다.

**Step 3: Implement the minimal source**

가격 pane을 만들자마자 `setPreserveEmptyPane(true)`로 고정해 `removePriceSeries()` 중 pane 0이 자동 삭제되지 않게 한다. `MarketPriceChart`는 각 interval option에 `resolveIntervalForRange(range, option) === option`을 적용해 불가능한 option을 disabled하고, `aria-describedby`로 현재 기간에서 자동 선택되는 최소 간격을 설명한다. 기존 interval promotion과 1,500봉 제한은 유지한다.

**Step 4: Run test to verify it passes**

Run: `node --test tests/playgroundMarketChartUi.test.ts`

Expected: pane lifecycle와 range-aware interval control이 통과한다.

**Step 5: Commit**

```bash
git add src/features/playground/market/marketChartAdapter.ts src/views/playground/market/MarketPriceChart.tsx tests/playgroundMarketChartUi.test.ts
git commit -m "모의주식 차트 패널과 시간봉 선택 수정"
```

### Task 4: 릴리스 준비와 전체 검증

**Files:**
- Modify: `package.json`
- Modify: `DEVLOG/update-notes.json`
- Modify: `docs/superpowers/specs/2026-07-14-market-autonomous-news-chart-repair.md`
- Modify: `docs/superpowers/plans/2026-07-14-market-autonomous-news-chart-repair.md`

**Step 1: Update release metadata**

기능 추가에 따라 `package.json` 버전을 `1.88.2`에서 `1.89.0`으로 올리고, `DEVLOG/update-notes.json`에 자동 뉴스·거래량 패널 고정·기간별 시간봉 안내를 기존 category enum 안에서 기록한다.

**Step 2: Verify release tests and build**

Run in order:

```bash
npm run typecheck
npm run test:playground
npm run test:auto-update
npm run build:vite
npm run build
```

Expected: 모든 명령이 종료 코드 0으로 끝나며, build가 `dist/BFLOW-Setup.exe`, `dist/latest.yml`, `dist/manifest.json`을 만든다.

**Step 3: Preview the user flows**

`npm run dev:renderer`로 `?preview=1` 화면을 열어 `배한솔`/`1234`로 로그인한다. 배플레이그라운드에서 자동 뉴스, 오늘 움직인 이유, 선/캔들 전환, disabled 시간봉, 차트 zoom/pan을 확인한다.

**Step 4: Commit**

```bash
git add package.json DEVLOG/update-notes.json docs/superpowers/specs/2026-07-14-market-autonomous-news-chart-repair.md docs/superpowers/plans/2026-07-14-market-autonomous-news-chart-repair.md
git commit -m "모의주식 자동 뉴스 릴리스 준비"
```

### Task 5: PR·리뷰·병합·배포

1. `git diff origin/main...HEAD`와 테스트 결과로 PR 제목 `[v1.89.0] 모의 주식 자동 뉴스와 차트 안정화` 및 필수 네 섹션 본문을 만든다.
2. `gh pr create` 후 `@codex review`를 남기고, watcher 또는 issue/review/line comments를 확인해 명시적인 긍정 리뷰 또는 수정 완료를 받는다.
3. GitHub에서 병합된 SHA를 확인하고, 원본 배포 checkout `C:\Bflow-BGonly`만 fast-forward 한다. 기존 더티 변경은 건드리지 않는다.
4. 배포 checkout에서 release build를 재확인하고 `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist`로 installer·latest.yml을 먼저 복사한 뒤 `manifest.json`을 마지막에 복사한다.
5. 원격 SHA-256와 manifest version `1.89.0`을 다시 읽어 배포를 확인한다.

