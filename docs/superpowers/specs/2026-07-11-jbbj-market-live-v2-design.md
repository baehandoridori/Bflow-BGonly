# JBBJ 증권시장 실시간 거래 v2 설계

**승인일:** 2026-07-11
**승인 범위:** 배한솔 단독 테스트 배포
**기준 화면:** v1.79.0 배플레이그라운드의 다크 모드 JBBJ 증권시장

## 목표

고정된 미리보기였던 JBBJ 증권시장을 실제로 가격이 움직이고, 포인트를 옮겨 정수 주식으로 거래하며, 앱을 다시 켜도 계좌가 유지되는 캐주얼 모의투자 기능으로 바꾼다.

## 승인된 제품 결정

- 시장은 매일 24시간 열린다.
- 가격은 약 1초마다 조금씩 오르내린다. 1분마다 한 번 점프하지 않는다.
- 1분 동안의 틱을 모아 시가·고가·저가·종가 캔들을 만든다.
- 자동 가격 변동 위에 관리자가 뉴스, 상승·하락 충격, 추세, 거래 정지를 적용할 수 있다.
- 차트는 첫 방문에 선 그래프로 열리고, 이후에는 마지막 선/캔들 선택을 기억한다.
- 간격은 `1분`, `5분`, `10분`, `15분`, `1시간`, `1일`을 지원한다.
- 기간은 `오늘`, `1주`, `1개월`, `6개월`, `전체`를 지원한다.
- 매수·매도는 `1주`, `5주`, `10주`, `최대`, `직접 입력`의 정수 주식 기준이다.
- 증권시장 안의 가격, 예수금, 평가액, 손익은 `원`으로 표시한다.
- 게임·작업 포인트 지갑은 `P`로 표시하고 증권계좌와 `1P = 1원`으로 입출금한다.
- 배한솔은 테스트 최초 1회에만 지갑 `1,000,000P`를 받는다.
- 증권계좌는 예수금 `0원`, 보유 주식 없음으로 시작한다.
- 재실행 또는 다른 PC에서도 잔액과 투자 내역을 이어간다.
- 넓은 창에서는 주문 카드가 오른쪽에서 화면을 따라오고, 좁은 창에서는 하단 `사기`·`팔기` 도크로 주문 시트를 연다.
- 화면의 뒤로가기와 Windows 마우스 뒤로가기 버튼이 같은 로컬 기록을 사용한다.
- 공개 범위는 배한솔의 canonical 사용자 계정 하나로 제한한다. 다른 팀원에게는 메뉴와 경로 모두 보이지 않는다.

## 사용자 흐름

1. 배한솔이 배플레이그라운드에서 JBBJ 증권시장에 들어간다.
2. 시장 홈에서 움직이는 현재가와 작은 그래프를 보고 종목을 고른다.
3. 종목 상세의 선 그래프에서 간격과 기간을 바꾸거나 캔들 보기로 전환한다.
4. 계좌가 비어 있으면 `포인트 옮기기`로 지갑 P를 예수금 원으로 옮긴다.
5. 고정 주문창에서 수량을 고르고 주문 확인 후 체결한다.
6. 확인 중 가격이 달라졌다면 변경된 가격과 총액을 다시 보여주고 재확인을 요구한다.
7. 내 계좌에서 예수금, 보유 종목, 투자 손익과 거래 결과를 확인한다.
8. 뒤로가기를 누르면 `계좌 → 직전 종목 → 시장 홈 → 진입한 놀이터 화면` 순으로 복귀한다.

## 화면 구조

### 시장 홈

- 기존 Toss형 다크 모드와 정보 순서를 유지한다.
- 종목 행의 현재가와 스파크라인은 1초 틱을 반영하되, 전체 목록이 과도하게 흔들리지 않도록 숫자와 끝점만 부드럽게 갱신한다.
- `찜한 주식`과 `전체 주식` 구조는 유지한다.
- 배한솔 전용 `시장 관리` 버튼은 뉴스·충격·추세·정지 이벤트를 여는 작은 관리 시트로 연결한다.

### 종목 상세

- 1280px 이상은 `minmax(0, 1fr) + 340px` 두 열이다.
- 오른쪽 주문 카드는 상세 상단부터 배치하고 `position: sticky`로 따라온다.
- 주문 카드가 창 높이보다 길면 카드 내부만 스크롤한다.
- 1280px 미만은 본문을 한 열로 두고, 스크롤 컨테이너 밖 하단 도크에 `사기`와 `팔기`를 고정한다.
- 하단 도크 높이와 safe area만큼 본문 아래 여백을 확보한다.
- 선/캔들 토글, 간격, 기간은 차트 상단에 두되 초심자에게 먼저 보이는 순서는 `현재가 → 변동률 → 차트 → 간격/기간`이다.
- 캔들 선택 시 현재 캔들의 몸통과 꼬리가 틱마다 갱신된다.
- 키보드/스크린리더 사용자는 현재 선택 캔들의 시간과 OHLC를 텍스트로 확인할 수 있다.

### 내 계좌

- 승인된 Toss 계좌형 520px 단일 열의 심플함을 유지한다.
- 상단에는 총 증권자산, 이달 손익, 예수금을 보여준다.
- 포인트 지갑은 별도 행에 `1,000,000P`처럼 표시하고 `넣기`, `빼기`를 제공한다.
- 보유 종목이 없을 때는 빈 상태와 `종목 둘러보기` 버튼을 제공한다.
- 테스트 시작 시 샘플 보유 종목은 없다.

## 가격 엔진

### 결정론적 시세

- 같은 종목, 같은 UTC 초, 같은 관리자 이벤트 집합은 항상 같은 가격을 만든다.
- 종목별 기준가·변동성·저주파 추세에 결정론적 value noise를 합성해 분 경계에서도 끊기지 않는 경로를 만든다.
- 렌더러는 정각 기준 약 1초마다 `now`를 갱신한다. 백그라운드에서 돌아오면 누락된 초를 재생하지 않고 현재 시각 가격으로 즉시 따라잡는다.
- 선 그래프와 캔들 그래프는 같은 가격 함수에서 나온 `close`를 사용해 서로 다른 현재가를 표시하지 않는다.

### 캔들 집계

```ts
export type MarketBarInterval = '1m' | '5m' | '10m' | '15m' | '1h' | '1d';
export type MarketChartRange = 'today' | 'week' | 'month' | 'six-months' | 'all';
export type MarketChartStyle = 'line' | 'candlestick';

export interface MarketCandle {
  startsAt: string;
  openWon: number;
  highWon: number;
  lowWon: number;
  closeWon: number;
  newsIds: string[];
}
```

- 기본 원천은 1분 캔들이다.
- 5·10·15분, 1시간, 1일은 첫 open, 최대 high, 최소 low, 마지막 close로 집계한다.
- 기간과 맞지 않는 간격은 선택 시 가장 가까운 유효 간격으로 보정한다.
- 한 화면 렌더링은 최대 600개 봉으로 제한한다.

### 관리자 이벤트

```ts
export type MarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface MarketAdminEvent {
  id: string;
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
}
```

- 뉴스/충격/추세는 시작 시각과 기간에 따라 가격 함수에 결정론적으로 더해진다.
- `halt` 동안 가격은 정지 직전 값으로 고정되고 주문 버튼은 비활성화된다.
- 관리 이벤트를 삭제해 과거 체결 가격을 되돌리지는 않는다. 이벤트 수정은 새 revision으로 기록한다.

## 계좌와 거래 모델

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

- 주문 수량은 양의 안전한 정수만 허용한다.
- 매수 총액은 `현재가 × 수량`이며 예수금을 넘을 수 없다.
- 최대 매수는 `floor(예수금 / 현재가)`다.
- 매도는 보유 정수 주식을 넘을 수 없다.
- 최초 계좌에는 소수 주식이 없으므로 신규 도메인에서는 micro-share를 사용하지 않는다.
- 포인트 랭킹은 현재 지갑 잔액이 아니라 `lifetimeEarnedPoints`를 사용해 투자 이체 때문에 순위가 오르내리지 않게 한다.

## 영구 저장과 보안 경계

- 실제 Electron 앱의 계좌 원본은 Supabase다.
- 브라우저 프리뷰는 사용자별 localStorage 어댑터를 사용한다. 이것은 프리뷰 전용이며 실제 앱의 fallback 원본이 아니다.
- DB에는 지갑, 증권계좌, 보유 종목, ledger, 즐겨찾기/미션, 관리자 이벤트를 분리한다.
- 최초 지급은 DB migration의 고유 ledger key `test-initial-grant-v1`로 한 번만 반영한다.
- migration은 배한솔 UUID를 하드코딩하지 않고 `name='배한솔'`과 `slack_id='U05DFV9UAN5'`로 정확히 한 행을 조회한다.
- 입출금·매수·매도는 한 RPC 트랜잭션에서 계정 row를 잠그고 잔액, 보유량, 원가, 손익, ledger를 함께 변경한다.
- 모든 mutation은 `(user_id, request_id)` 고유 제약으로 재시도 중복 체결을 막는다.
- renderer가 user ID를 넘기지 않는다. Electron main의 canonical SessionManager가 사용자를 결정한다.
- 현재 앱은 Supabase Auth가 아니므로 이번 가상 포인트 테스트의 신뢰 경계는 공식 Electron 앱이다. 실제 금전 가치 기능으로 확장하지 않는다.
- 새 public 테이블은 명시적 GRANT와 RLS를 같은 migration에 포함한다. RPC는 PUBLIC 실행권한을 회수하고 필요한 anon 역할만 허용한다.
- DB 읽기 실패 시 코드 seed로 100만 포인트를 다시 만들지 않는다. 오류 화면과 재시도만 제공한다.

## 내비게이션

- Playground 내부 전용 stack을 둔다. 전역 B flow 알림 복귀 stack과 섞지 않는다.
- 실제로 다른 화면으로 이동할 때만 push하고, 같은 화면 재선택과 focus request는 replace한다.
- dot wipe는 화면이 덮인 뒤 실제 route가 적용되는 시점에 한 번만 기록한다.
- Back 우선순위는 `열린 dialog 닫기 → Playground stack pop → 진입 원본으로 복귀`다.
- mutation 저장 중에는 dialog 닫기와 Back을 막는다.
- Electron BrowserWindow의 `app-command: browser-backward`를 preload 구독으로 전달한다.
- Playground가 unmount되면 구독과 stack을 정리해 다른 B flow 화면에 영향을 주지 않는다.

## 오류 처리

- 주문 확인 후 가격, 예수금, 보유량이 달라지면 기존 확인을 무효화하고 새 내용으로 재확인을 요구한다.
- 낙관적 계좌 변경 실패 시 직전 authoritative 계좌로만 롤백한다. 가격 stream은 롤백하지 않는다.
- DB 네트워크 장애는 계좌를 빈 값이나 seed로 덮지 않는다.
- 동일 request ID와 다른 payload가 오면 충돌 오류로 처리한다.
- 가격이 0 이하, 안전하지 않은 정수, 거래 정지 종목은 주문할 수 없다.

## 검증 기준

- 같은 seed/시각/이벤트에서 같은 틱과 캔들을 만든다.
- 1분 캔들 및 5·10·15·60분 집계의 OHLC가 정확하다.
- 1초가 진행되면 현재가와 현재 캔들이 달라진다.
- 선/캔들, 모든 간격과 기간, 새로고침 후 마지막 차트 스타일을 확인한다.
- 배한솔 최초 지갑 1,000,000P, 예수금 0원, 보유 0주를 확인한다.
- migration을 두 번 실행해도 지급이 한 번이다.
- 같은 request ID 재전송이 중복 이체/체결되지 않는다.
- 매수·매도는 정수 주식만 처리하고 원화 합계를 보존한다.
- 데스크톱 sticky 주문창과 좁은 창 하단 도크를 1440×900, 1024×768, 800×600에서 확인한다.
- 화면 뒤로가기와 Windows 마우스 뒤로가기가 같은 순서로 동작한다.
- 배한솔 로그인에서는 메뉴와 경로가 보이고 다른 사용자에서는 둘 다 차단된다.
- `npm run typecheck`, 관련 테스트, `npm run build:vite`, `npm run build`를 통과한다.

## 이번 배포에서 하지 않는 것

- 실제 주식시장 데이터 연결
- 실제 화폐 또는 현금성 보상
- 팀 전체 공개
- 지정가 주문의 실제 예약 체결
- Supabase Auth 전환
