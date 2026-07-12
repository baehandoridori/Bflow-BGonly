# JBBJ 시장 거래 UX·현실형 시세 v3 설계

**승인일:** 2026-07-13

**승인 범위:** 배한솔 단독 테스트용 JBBJ 모의투자 개선

**시각 기준:** `docs/superpowers/mockups/2026-07-13-jbbj-market-quick-order-chart-v3.html`

**선행 설계:** `docs/superpowers/specs/2026-07-11-jbbj-market-live-v2-design.md`

이 문서는 v2의 계좌·저장·보안·멱등 처리 규칙을 유지하면서 주문 패널, 차트 조작, 가격·거래량 생성 방식을 교체한다. 이 문서와 v2가 충돌하면 UI·차트·가격 엔진은 v3를 따르고, 계좌·거래·보안 경계는 v2를 따른다.

## 1. 목표

JBBJ 시장을 처음 쓰는 사람도 수량을 정한 뒤 바로 사고팔 수 있게 만들고, 가상 종목의 가격이 고정 기준가 주변의 반복 파형이 아니라 실제 금융 시계열에서 흔히 보이는 누적 추세·공통 장세·변동성 군집·드문 급등락·거래량 변화를 보이게 한다.

완료 후 사용자는 다음을 할 수 있어야 한다.

1. 종목 상세에서 현재가, 오늘의 변화, 가격이 움직인 이유를 확인한다.
2. `간격`, `기간`, `선/캔들` 드롭다운을 바꾼다.
3. 차트를 휠로 확대·축소하고 드래그로 좌우 이동한다.
4. 캔들과 함께 거래량을 확인한다.
5. 빠른주문에서 수량을 한 번 정한 뒤 파란 `현재가 팔기` 또는 빨간 `현재가 사기`를 누른다.
6. 같은 주문 패널에서 판매·구매 가능량, 예상 금액, 평단, 보유 수량, 현재 손익을 확인한다.
7. 최종 확인창에서 최신 가격과 주문 결과를 다시 확인한 뒤 체결한다.

## 2. 승인된 제품 결정

- 실제 주식시장 API는 연결하지 않는다.
- JBBJ 시장은 기존처럼 24시간 열린다.
- 모든 가격·거래량은 내부 결정론적 모델로 생성한다.
- 같은 시세 revision, 종목, 시각, 관리자 이벤트 집합에서는 모든 PC가 같은 결과를 계산한다.
- 데스크톱 주문은 승인 목업의 A안인 양방향 빠른주문을 사용한다.
- 매수는 빨강, 매도는 파랑으로 표시한다. 기존 `market-up`, `market-down` 토큰을 재사용한다.
- 게임에는 즉시 체결 가격이 하나뿐이므로 `현재가/시장가` 중복 버튼을 만들지 않는다.
- 수량 프리셋은 `1주`, `5주`, `10주`, `최대`를 유지하고 직접 숫자 입력과 ±1 스테퍼를 제공한다.
- 차트는 TradingView Lightweight Charts 5.2 계열을 사용한다.
- TradingView 출처 표시는 차트 하단의 조용한 링크 또는 공식 attribution 옵션으로 제공한다.
- 선/캔들 마지막 선택을 기억한다. 간격·기간은 종목 상세을 다시 열었을 때 안전한 기본값으로 시작한다.
- 계좌·보유·원가·실현손익·멱등 request ID·canonical 사용자 판정은 변경하지 않는다.
- 새 DB 테이블이나 실제 시세 저장은 추가하지 않는다.
- 사용자 거래가 시장 가격에 영향을 주는 기능은 이번 범위에 포함하지 않는다.

## 3. 현재 문제와 원인

### 3.1 주문

- 사기·팔기가 같은 보라색 탭과 버튼을 사용해 방향을 빠르게 구분하기 어렵다.
- 주문 패널은 예상 금액과 주문 후 잔액만 보여주고 평단·현재 손익을 보여주지 않는다.
- 손익은 상세 하단의 별도 카드에 있어 주문 판단과 떨어져 있다.
- 한 방향을 탭으로 고른 뒤 다시 주문 버튼을 눌러야 해 빠른주문보다 한 단계가 더 필요하다.

### 3.2 차트

- `MarketChartCanvas`가 Canvas 2D를 직접 그리며 보이는 모든 봉을 폭에 강제로 맞춘다.
- 포인터는 봉 선택만 바꾸며 휠 줌, 드래그 팬, 핀치 줌, 축 리셋이 없다.
- 간격과 기간이 여러 개의 버튼으로 펼쳐져 차트 위 공간을 많이 차지한다.
- 거래량 데이터가 없어 가격 움직임의 강도를 판단할 수 없다.
- 최근 600봉 제한 때문에 선택한 기간의 앞부분이 잘릴 수 있다.

### 3.3 시세

- 가격은 매분 해시 난수 두 점을 `smoothstep`으로 잇고 사인 반원을 더한 뒤 고정 기준가에 곱한다.
- 수익률이 누적되지 않아 장기적으로 기준가 주변의 좁은 띠로 되돌아온다.
- 모든 종목이 같은 모양의 알고리즘을 쓰며 시장 공통 요인과 업종 요인이 없다.
- 변동성이 시간에 따라 뭉치지 않고 드문 자연 급등락도 없다.
- 관리자 이벤트 영향이 종료 순간 사라져 가격이 원래 경로로 튈 수 있다.
- 홈 스파크라인과 전일 종가가 실시간 엔진이 아니라 고정 seed에 의존한다.

## 4. 화면과 상호작용

### 4.1 데스크톱 종목 상세

- 1280px 이상은 `minmax(0, 1fr) + 360px` 두 열을 사용한다.
- 왼쪽은 종목 요약 → 차트 → 보유 상태 → 최근 소식 순서다.
- 오른쪽 빠른주문은 상세 상단부터 `position: sticky`로 따라온다.
- 주문 패널이 창보다 길면 패널 내부만 스크롤한다.
- 현재 페이지의 카드형 다크 UI와 탐색 구조는 유지한다.
- 승인 목업처럼 종목명·현재가·등락·이유를 하나의 요약 카드에 모아 차트를 더 빨리 볼 수 있게 한다.

### 4.2 양방향 빠른주문

주문 패널의 정보 순서는 고정한다.

1. 현재 가격과 예수금
2. 수량 직접 입력과 ±1 스테퍼
3. `1주`, `5주`, `10주`, `최대` 프리셋
4. 판매 가능 수량, 구매 가능 수량
5. 판매 예상 금액, 구매 예상 금액
6. 파란 `현재가 팔기`, 빨간 `현재가 사기`
7. 내 주식 평균, 현재 손익 금액·수익률, 보유 수량, 현재 평가금
8. 최신 가격 재확인 안내

한 수량을 사기와 팔기에 공통으로 사용한다. 선택 수량이 보유 수량보다 크면 팔기만 비활성화하고, 예수금보다 큰 금액이면 사기만 비활성화한다. 한쪽 주문이 불가능해도 다른 쪽은 계속 사용할 수 있다.

평균 매수가는 `holding.costBasisWon / holding.quantityShares`에서 원 단위로 반올림한다. 평가손익은 `현재가 × 보유 수량 - 총 원가`, 수익률은 `평가손익 / 총 원가 × 100`으로 계산한다. 보유가 없으면 평단·손익 대신 `아직 보유한 주식이 없어요`를 표시한다.

주문 확인창은 기존 frozen command와 request ID를 유지한다. 확인 중 가격, 시세 revision, 예수금, 보유량, 거래정지 상태가 달라지면 기존 확인을 무효화하고 최신 값으로 다시 확인시킨다.

### 4.3 작은 화면

- 1280px 미만은 본문을 한 열로 유지하고 기존 하단 주문 도크를 사용한다.
- 하단에는 파란 `현재가 팔기`와 빨간 `현재가 사기`를 동시에 표시한다.
- 누르면 데스크톱 빠른주문과 동일한 정보·계산·컨트롤러를 쓰는 주문 시트가 열린다.
- 본문 아래에는 도크 높이와 safe area만큼 여백을 확보한다.
- 주문 시트가 열린 동안 배경 스크롤을 막고 Escape·뒤로가기는 시트를 먼저 닫는다.

### 4.4 차트 컨트롤

차트 상단에는 다음 컨트롤만 둔다.

- 간격 드롭다운: `1분`, `5분`, `10분`, `15분`, `1시간`, `1일`
- 기간 드롭다운: `오늘`, `1주`, `1개월`, `6개월`, `전체`
- 모양 드롭다운: `선`, `캔들`
- 위치·확대 비율 초기화 버튼

기간에 비해 너무 촘촘한 간격을 고르면 선택 기간 전체가 1,500봉 안에 들어오는 가장 가까운 간격으로 자동 보정하고 스크린리더 안내를 보낸다. 조합별 기본값은 다음과 같다.

| 기간 | 최소 자동 간격 |
|---|---|
| 오늘 | 1분 |
| 1주 | 10분 |
| 1개월 | 1시간 |
| 6개월 | 1일 |
| 전체 | 1일 |

### 4.5 차트 조작

- 마우스 휠: 시간축 확대·축소
- 왼쪽 버튼 드래그: 좌우 이동
- 시간축·가격축 드래그: 해당 축 확대·축소
- 더블클릭 또는 초기화 버튼: 선택 기간 전체에 맞춤
- 터치: 가로 드래그와 핀치 줌
- 포인터 이동: 십자선과 현재 봉의 시간·시가·고가·저가·종가·거래량 표시
- 선/캔들 전환: 현재 보이는 시간 구간을 가능한 한 유지
- 기간 전환: 새 기간 전체에 맞춤

차트 하단에는 가격과 분리된 거래량 histogram을 둔다. 가격 상승 봉의 거래량은 빨강, 하락 봉은 파랑으로 표시한다.

### 4.6 접근성

- 모든 드롭다운에 보이는 label과 `aria-label`을 제공한다.
- 선택 봉의 시간·OHLC·거래량을 `aria-live` 텍스트로 제공한다.
- 주문 수량 input, ± 버튼, 프리셋, 사기·팔기 버튼에 고유한 접근성 이름을 제공한다.
- 색상만으로 방향을 전달하지 않고 `사기`, `팔기`, `+`, `-` 텍스트를 함께 표시한다.
- `prefers-reduced-motion`에서는 숫자·패널 전환 애니메이션을 최소화한다.
- 차트 라이브러리가 실패해도 텍스트 현재가와 주문 기능은 사용할 수 있어야 한다.

## 5. 코드 구조

### 5.1 시세 모델

새 파일 `shared/playgroundMarketModel.mjs`는 외부 상태에 의존하지 않는 순수 결정론적 모델을 담당한다.

책임:

- seed 해시와 결정론적 PRNG
- 시장·업종·종목 shock 생성
- 상승·하락·횡보 regime 생성
- 일별 checkpoint와 분별 누적 수익률 생성
- 변동성 상태와 드문 jump 생성
- 거래량 생성
- 관리자 이벤트의 가격·변동성·거래량 영향 계산

기존 `shared/playgroundMarketPrice.mjs`는 호환 facade로 남긴다.

- `MARKET_INSTRUMENT_PROFILES`
- `getLivePriceWon`
- `getCanonicalMarketQuoteWon`

기존 호출자는 API를 바꾸지 않고 새 모델 결과를 받는다. 차트용 확장 API는 다음 이름을 사용한다.

```js
getMarketMinuteBar(profile, minuteStartMs, observedUntilMs, events)
getMarketDailyCheckpoint(profile, dayStartMs, events)
```

`observedUntilMs`는 해당 분 안에서 실제로 도달한 마지막 시각이다. 완성된 과거 봉은 분의 마지막 초를, 진행 중인 봉은 현재 초를 넘기지 않는다. OHLC와 거래량은 이 경계까지만 계산해 미래 tick이나 아직 시작하지 않은 이벤트가 노출되지 않게 한다.

### 5.2 TypeScript 도메인

`MarketCandle`에 `volumeShares`를 추가한다.

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
```

상위 봉의 거래량은 포함된 하위 봉의 `volumeShares` 합계다. 기존 OHLC 집계 규칙은 유지한다.

### 5.3 차트 React 경계

새 `MarketInteractiveChart.tsx`는 Lightweight Charts의 생성·갱신·정리만 담당한다.

- `createChart`와 가격 series 생성
- 캔들·선 series 교체
- volume histogram series 생성
- ResizeObserver 기반 크기 동기화
- crosshair 구독과 선택 봉 callback
- 시간축 visible range 유지
- unmount 시 모든 구독과 chart 제거
- 다크·라이트 토큰 반영

기존 `MarketPriceChart.tsx`는 드롭다운, 상태 보정, 접근성 안내, empty/error UI를 담당한다. 기존 `MarketChartCanvas.tsx`는 새 차트가 안정화되면 제거한다.

### 5.4 주문 React 경계

`useMarketOrderController`는 기존 frozen command·재검증·멱등 요청의 단일 진실 원천으로 유지한다. `MarketOrderPanel`과 `MarketMobileOrderDock`은 같은 controller를 사용한다.

새 UI 계산 중 주문 도메인에 포함되지 않는 표시 전용 값은 순수 helper로 분리한다.

```ts
interface MarketHoldingSummary {
  averagePriceWon: number | null;
  marketValueWon: number;
  unrealizedPnlWon: number;
  unrealizedPnlRate: number | null;
}
```

helper는 `Holding`, 현재가만 받고 store를 직접 읽지 않는다.

## 6. 현실형 결정론적 시장 모델

### 6.1 기본 원칙

- `Math.random()`을 사용하지 않는다.
- 기준 epoch는 `2025-01-01T00:00:00Z`로 고정한다.
- 가격은 단순 위치 noise가 아니라 이전 가격에 log return을 누적해 계산한다.
- 모든 shock은 `시각 bucket + 시세 revision + 시장/업종/종목 seed`에서 생성한다.
- 가격은 항상 1원 이상의 안전한 정수다.
- 거래량은 0 이상의 안전한 정수다.

### 6.2 종목 프로필

각 종목은 다음 속성을 가진다.

```ts
interface MarketInstrumentProfile {
  stockId: string;
  sectorId: 'studio' | 'platform' | 'creative-tools' | 'collaboration';
  basePriceWon: number;
  marketBeta: number;
  sectorBeta: number;
  idiosyncraticVolatilityBps: number;
  longTermDriftBps: number;
  baseMinuteVolume: number;
  jumpSensitivity: number;
}
```

동일 업종 예시는 다음과 같다.

- studio: `jbbj`, `meta-comedy`, `netflix`
- platform: `youtube`
- creative-tools: `adobe`, `wacom`
- collaboration: `slack`, `google-drive`

JBBJ·메타코미디는 높은 beta와 변동성, Slack·Google Drive는 낮은 변동성, Adobe·Wacom은 중간 업종 상관을 갖는다.

### 6.3 일별 regime과 checkpoint

시장은 `bull`, `bear`, `sideways` 세 regime 중 하나다. regime은 일별로 결정되며 같은 상태가 며칠 이어질 확률이 높다.

각 일의 종목 log return은 다음 요소의 합이다.

```text
regime drift
+ market beta × 공통 시장 shock
+ sector beta × 업종 shock
+ 종목 고유 shock
+ 낮은 확률의 jump
+ 관리자 이벤트 누적 영향
```

일별 close는 전일 close에 log return을 누적해 계산한다. epoch부터 요청일까지의 checkpoint는 프로필·시세 revision·이벤트 fingerprint별로 메모리 cache한다. 최대 `전체` 범위가 약 600일이므로 순차 계산 비용은 제한적이다.

### 6.4 분별 경로와 변동성 군집

각 UTC 날짜의 1,440개 분봉은 그날의 open과 일별 close 사이를 잇는 누적 return 경로로 만든다.

- 시장·업종·종목 분별 shock을 합성한다.
- 직전 절대 수익률이 크면 이후 몇 개 구간의 변동성도 높아지는 GARCH 유사 상태를 사용한다.
- 기본 shock은 작은 움직임이 많고, 낮은 확률의 jump가 두꺼운 꼬리를 만든다.
- 분별 raw path의 마지막 값을 일별 close에 맞추는 bridge 보정을 적용한다.
- 초별 현재가는 현재 분 open에서 현재 분 close로 이어지는 결정론적 micro-bridge를 사용한다.
- 기존처럼 매분 동일한 사인 반원을 반복하지 않는다.

### 6.5 종목 간 상관

시장 공통 shock과 업종 shock을 공유하므로 종목들은 어느 정도 같이 움직인다. 종목 고유 shock과 beta 차이 때문에 완전히 같은 선이 되지 않는다.

검증 목표는 180일 일별 수익률에서 다음 범위다.

- 전체 종목 쌍 평균 상관: `0.15` 이상 `0.75` 이하
- 동일 업종 평균 상관: 전체 평균보다 높음
- 서로 다른 종목의 완전 상관 또는 동일 경로 금지

이 범위는 특정 수익을 보장하는 제품 규칙이 아니라 인공적인 완전 독립·완전 동조를 막는 회귀 테스트 기준이다.

### 6.6 거래량

분별 거래량은 다음 요소를 곱해 만든다.

```text
종목 기본 거래량
× 24시간 활동 주기
× 현재 변동성 배율
× 절대 수익률 배율
× 이벤트 배율
× 작은 결정론적 noise
```

24시간 시장은 유지하되 한국 업무 시간대에는 평균 거래량이 높고 심야에는 낮게 보인다. 시장이 닫히지 않으므로 개장·폐장 gap은 만들지 않는다. 대신 드문 자연 jump와 관리자 이벤트가 불연속에 가까운 움직임을 만든다.

### 6.7 관리자 이벤트

- `halt`: 시작 직전 가격으로 고정하고 거래량을 0으로 만든다.
- `shock-up`, `shock-down`: 시작 직후 빠르게 반영하고 종료 뒤 일부 영향은 가격 수준에 남으며 나머지는 서서히 약해진다.
- `trend`: 이벤트 기간에 drift로 누적되고 종료 뒤 새 가격 수준을 유지한다.
- `news`: 작은 방향 영향과 함께 일정 시간 변동성·거래량을 높인다.
- 이벤트 종료 시 impact를 단순 제거하지 않아 원래 경로로 즉시 튀지 않게 한다.
- 이벤트 목록·revision이 달라지면 관련 cache를 무효화한다.
- 이벤트를 삭제해도 이미 기록된 ledger·체결 가격·계좌 상태는 변경하지 않는다.

## 7. 데이터 흐름과 신뢰 경계

```text
렌더러 clock
  → shared 결정론적 모델
  → 현재가·캔들·거래량
  → 차트와 빠른주문 preview

주문 확인
  → frozen command + request ID
  → Electron main canonical session
  → 같은 shared 모델로 최신 가격·halt 재검증
  → Supabase RPC 원자적 체결
  → authoritative snapshot 반환
```

- renderer는 사용자 ID를 보내지 않는다.
- 가격·거래량 생성은 네트워크를 요구하지 않는다.
- 계좌·이벤트 원본은 기존처럼 Supabase다.
- 브라우저 preview는 localStorage gateway를 사용하되 실제 앱 fallback 원본이 아니다.
- 차트 확대·이동 상태는 로컬 UI 상태이며 DB에 저장하지 않는다.

## 8. 오류와 복구

- Lightweight Charts 초기화 실패 시 차트 카드 안에 `차트를 표시하지 못했어요`와 `다시 시도`를 제공한다.
- 차트 오류가 현재가·주문·계좌를 숨기거나 막아서는 안 된다.
- candle 데이터가 비어 있으면 empty state를 표시하고 마지막 정상 current quote는 유지한다.
- 유효하지 않은 기간·간격 조합은 가장 가까운 안전한 값으로 보정한다.
- 숫자가 안전한 정수 범위를 벗어나면 해당 candle을 버리고 개발 로그를 남기며 주문 canonical quote는 기존 검증으로 차단한다.
- 주문 mutation 실패는 기존 confirmed snapshot으로 롤백한다.
- 응답 유실 시 동일 request ID와 command fingerprint를 재사용한다.
- 가격 변경·거래정지는 일반 저장 실패로 덮지 않고 사용자가 이해할 수 있는 이유를 보존한다.

## 9. 성능과 cache

- 한 번에 차트에 전달하는 봉은 최대 1,500개다.
- 기간 전체가 1,500개를 넘으면 간격을 자동 승격한다.
- 완성된 일별 checkpoint와 1분 경로는 프로필·revision·이벤트 fingerprint별 LRU cache에 저장한다.
- 현재 진행 중인 1분봉만 1초마다 갱신한다.
- React에서는 candle 배열 fingerprint가 같으면 전체 series를 다시 만들지 않고 마지막 data point만 `update`한다.
- 종목·기간·간격·이벤트 revision이 달라질 때만 `setData`한다.
- 차트 unmount 시 ResizeObserver, crosshair, time-range 구독을 모두 해제하고 `chart.remove()`를 호출한다.

## 10. 테마

- 다크 배경·카드·보더는 기존 B flow 토큰을 사용한다.
- 상승·매수: `market-up`
- 하락·매도: `market-down`
- 거래량은 해당 candle 방향 색을 낮은 불투명도로 사용한다.
- 라이트 모드에서도 매수·매도 버튼의 흰 글자가 WCAG AA 대비를 만족하도록 토큰을 조정한다.
- focus ring은 기존 accent를 유지한다.
- 반짝임·장식 애니메이션은 추가하지 않고 상태 전환에만 150~200ms transition을 사용한다.

## 11. 테스트 전략

### 11.1 시세 모델

- 같은 입력에서 가격·OHLC·거래량이 byte-for-byte 동일하다.
- 다른 PC 시간대에서도 UTC timestamp 결과가 같다.
- 모든 가격은 양의 안전한 정수다.
- 모든 거래량은 0 이상의 안전한 정수다.
- `low ≤ open/close ≤ high`가 항상 성립한다.
- 일별 close와 다음 날 open이 이벤트 없는 24시간 시장에서 연속된다.
- 180일 경로가 고정 기준가의 좁은 범위로 강제 회귀하지 않는다.
- bull·bear·sideways의 평균 return 부호와 변동성이 구분된다.
- 고변동 구간의 평균 절대 return이 저변동 구간보다 크다.
- 종목 간 평균·동일 업종 상관이 승인 범위에 있다.
- 드문 jump 개수와 최대 크기가 정한 상한 안에 있다.
- halt 동안 가격 고정·거래량 0이다.
- shock·trend·news 종료 경계에 인공적인 원복 jump가 없다.

### 11.2 캔들·거래량 집계

- 1분봉을 5·10·15·60분·1일로 집계할 때 OHLC가 정확하다.
- 상위 봉 거래량은 하위 봉 합계다.
- 미래 이벤트가 과거 candle에 노출되지 않는다.
- 1,500봉 제한과 기간별 간격 자동 승격이 정확하다.
- 홈 스파크라인 마지막 값, 상세 현재가, 주문 canonical quote가 일치한다.
- 전일 종가는 KST 날짜 경계의 엔진 값에서 계산한다.

### 11.3 주문

- 평단·평가금·평가손익·수익률 helper가 매수, 부분 매도, 전량 매도에서 정확하다.
- 수량 하나로 사기·팔기 예상 금액이 함께 갱신된다.
- 보유량 초과는 팔기만 막고 사기는 유지한다.
- 예수금 초과는 사기만 막고 팔기는 유지한다.
- 확인 중 가격·revision·잔액·보유량·halt 변경 시 재확인한다.
- 응답 유실 재시도는 동일 request ID를 쓰고 계좌를 한 번만 변경한다.

### 11.4 차트 UI

- 드롭다운 option과 기본값이 승인 설계와 같다.
- 선/캔들 선택 기억이 유지된다.
- wheel·pressed mouse drag·pinch 옵션이 활성화된다.
- 가격 series와 volume histogram이 함께 생성된다.
- crosshair가 OHLC·거래량 접근성 텍스트를 갱신한다.
- 기간 변경은 fitContent, 모양 변경은 visible range 유지를 호출한다.
- unmount 시 구독·observer·chart가 정리된다.
- 차트 오류 fallback에서도 주문 패널이 남는다.

### 11.5 실제 화면 검증

- `배한솔 / 1234`로 로그인한 뒤 실제 종목 상세를 확인한다.
- 1440×900: 오른쪽 sticky 빠른주문과 전체 차트
- 1024×768: 한 열 본문과 하단 주문 도크
- 800×600: 주문 시트, safe area, 내부 스크롤
- 다크·라이트 모드
- 휠 줌, 드래그 팬, 더블클릭 초기화
- 사기·팔기 확인창과 가격 변경 재확인
- 콘솔 error 0건

## 12. 검증 명령

```powershell
npm run typecheck
npm run test:playground
npm run build:vite
```

정식 배포를 요청받는 경우에만 추가로 실행한다.

```powershell
npm run build
```

## 13. 버전과 문서

- 사용자 기능 추가이며 선행 v1.81.0 릴리스가 main에 합쳐져 최종 배포 버전은 `1.82.0`으로 올린다.
- `package.json`, `package-lock.json`을 함께 갱신한다.
- `DEVLOG/update-notes.json`에 주문·차트·시세 개선을 비개발자용 문구로 기록한다.
- `ROADMAP.md`의 배플레이그라운드 실사용 피드백 항목을 갱신한다.
- 오래된 `CONTEXT.md`에 Playground 시장 파일 맵과 가격 엔진 경계를 추가한다.
- 아키텍처 설명이 바뀌므로 `AGENTS.md` 상태·문서 버전을 갱신한다.
- 승인 목업을 삭제하거나 `.superpowers/` 안에만 두지 않는다.

## 14. 하지 않는 것

- 실제 Yahoo, Nasdaq, Finnhub 등 외부 시세 API 연결
- 실제 화폐·현금성 보상
- 실제 증시 개장·폐장 시간
- 지정가 예약 체결
- 호가창·NPC 주문·사용자 주문의 가격 영향
- 공매도·미수·레버리지·수수료·세금·배당
- 팀 전체 공개
- Supabase Auth 전환
- 기존 계좌·ledger 데이터 migration

## 15. 완료 기준

- 승인 목업의 정보 구조와 매수 빨강·매도 파랑이 실제 화면에 반영된다.
- 주문 패널에서 평단·현재 손익·보유량·예상 금액을 한눈에 확인할 수 있다.
- 간격·기간이 드롭다운이며 모든 승인 option이 동작한다.
- 차트 휠 확대·드래그 이동·십자선·초기화·선/캔들·거래량이 동작한다.
- 홈 스파크라인·전일 종가·상세 차트·현재가가 한 엔진을 사용한다.
- 종목들이 공통 장세 안에서 서로 다르게 움직이고 장기 가격이 기준가 주변 반복 파형으로 보이지 않는다.
- 관리자 이벤트 종료 시 인공적인 원복 jump가 없다.
- renderer와 Electron main canonical quote가 일치한다.
- 기존 계좌·보안·멱등·롤백 테스트가 모두 유지된다.
- 필수 테스트·typecheck·Vite build가 통과한다.
- Codex 프리뷰와 실제 로그인 화면을 승인 목업과 나란히 비교한다.
