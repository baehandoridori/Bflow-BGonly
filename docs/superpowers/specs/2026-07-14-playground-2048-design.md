# 배플레이그라운드 2048 제품 설계

## 목적

승인된 인터랙션 목업의 2048을 배플레이그라운드의 세 번째 실제 아케이드 게임으로 제공한다. 사용자는 기존 포인트 지갑으로 입장하고, 클래식 4×4 규칙으로 점수를 쌓고, 결과를 저장해 개인 최고 기록과 순위표를 갱신한다.

승인 기준은 `codex/playground-new-game-mockups` 브랜치의 `docs/superpowers/mockups/2026-07-14-playground-new-games.html`에 구현된 2048 화면과 동작이다. 제품 구현은 최신 `origin/main` 기반의 `codex/2048-게임-추가` 브랜치에서 진행한다.

## 사용자 경험

### 진입과 종료

- 로비 빠른 실행, 추천 히어로, JBBJ 하우스에서 2048을 열 수 있다.
- 준비 화면에서 입장료 10P와 보상 기준을 확인하고 시작한다.
- 시작 성공 후에만 보드가 생성된다. 입장료가 부족하거나 서버가 거부하면 게임은 시작되지 않는다.
- 일시정지, 창 비활성화, 앱 뒤로가기, 종료 확인은 기존 아케이드 스테이지 계약을 따른다.
- 정상 게임 오버 시 같은 `runId`와 결과 payload로 저장을 재시도할 수 있어 중복 지급이 없다.

### 클래식 규칙

- 보드는 4×4이며 시작할 때 2 또는 4 타일 두 개를 생성한다.
- 방향 이동 한 번에서 같은 숫자 두 개를 합치며, 이미 합쳐진 타일은 그 이동에서 다시 합쳐지지 않는다.
- 점수는 새로 만들어진 합성 타일 값의 합이다.
- 실제로 보드가 바뀐 이동 뒤에만 새 타일 하나를 생성한다.
- 이동할 빈 칸도, 합칠 인접 타일도 없으면 게임이 끝난다.
- 2048을 만든 뒤에도 사용자가 `계속 합치기`를 누르면 더 높은 타일과 점수에 도전할 수 있다.

### 입력

- 방향키와 WASD를 지원한다.
- 보드 스와이프와 화면 방향 버튼을 지원한다.
- 스와이프는 24px 이상 움직였을 때 우세한 축의 한 방향만 인정한다.
- 이동 애니메이션 중 입력은 무한히 쌓지 않고 가장 최근 방향 하나만 대기시킨다.
- 버튼, 입력창, contenteditable 요소가 포커스를 가진 동안 게임 키 입력을 가로채지 않는다.
- `P`는 일시정지, `Escape`는 일시정지 또는 종료 확인 흐름에 사용한다.

## 모션과 피드백

- 타일 이동: 150ms, `cubic-bezier(.16, 1, .3, 1)`.
- 새 타일: 190ms spawn pop.
- 합성 타일: 270ms spring-like pop.
- 128/256 합성: soft board impact, 190ms.
- 512/1024 합성: medium board impact, 250ms.
- 2048 이상 합성: heavy board impact, 340ms.
- 화면 전체가 아니라 4×4 보드만 흔들어 주변 UI 가독성을 유지한다.
- 2048 최초 달성 시 heavy impact가 끝난 뒤 입력과 활성 플레이 시간을 멈추고 milestone overlay를 연다.
- `prefers-reduced-motion`에서는 이동과 흔들림을 즉시 반영하고 합성 위치에 정적인 강조만 남긴다.

애니메이션의 논리 상태와 표시 상태는 분리한다. 엔진은 이동 결과를 즉시 계산하지만, 화면은 기존 보드 위에 motion tile을 올려 이동시킨 뒤 150ms가 끝날 때 새 보드로 교체한다. 일시정지나 종료가 중간에 들어오면 타이머를 정리하고 보드를 overlay 뒤에서 계속 바꾸지 않는다.

## 게임 엔진

`src/features/playground/arcade/games/merge2048/`에 React와 분리된 순수 TypeScript 엔진을 둔다.

- `board`: 16칸 1차원 배열. 인덱스는 `row * 4 + column`이다.
- `trace2048Move(board, direction)`: 이동 결과, 획득 점수, 변경 여부, 타일별 from/to trace, 합성 위치, 최대 합성 값을 반환한다.
- `apply2048Move(state, direction, random)`: 유효 이동에만 2/4 타일을 하나 생성하고 새 상태와 표시용 transition을 반환한다.
- `canMove2048(board)`: 빈 칸 또는 가로/세로 동일 인접 타일 존재 여부를 판정한다.
- `impactTier2048(value)`: none/soft/medium/heavy를 결정한다.
- 난수는 함수로 주입해 테스트에서 생성 위치와 2/4 비율을 결정론적으로 검증한다.

React, DOM, 타이머, `Math.random()` 직접 호출은 엔진에 넣지 않는다.

## 아케이드 포인트 계약

2048도 기존 `ArcadeService`와 `playground_arcade_read`/`playground_arcade_execute` RPC를 사용한다. 새 IPC 채널, 새 테이블, 새 원장 종류는 만들지 않는다.

| 항목 | 값 |
|---|---:|
| 입장료 | 10P |
| Bronze | 3,000점 이상 / 5P |
| Silver | 8,000점 이상 / 12P |
| Gold | 18,000점 이상 / 25P |
| Platinum | 35,000점 이상 / 40P |
| 서버 허용 최고 점수 | 10,000,000점 |
| 일일 보상 가능 횟수 | 기존 공통 상한 5회 |

2048 달성 overlay는 게임 안의 milestone이며 별도 포인트 도전과제로 저장하지 않는다. 첫 판, 누적 플레이, 누적 적립 같은 공통 도전과제는 2048 결과도 자동으로 포함한다.

## 데이터와 이전 저장본

- `ArcadeGameId`, 밸런스, preview seed, 랭킹 탭에 `2048`을 추가한다.
- 기존 preview localStorage v1 저장본에 `games['2048']`이 없어도 지갑, 출석, 기존 게임 기록, 멱등 요청 기록을 보존한 채 기본 2048 통계를 채운다.
- 날짜가 바뀌면 2048의 `todayRewardedRuns`도 0으로 되돌린다.
- 테스트 모드도 실서비스와 같은 점수 상한, 활성 시간 1초~4시간, 입장료, 보상 상한, 실패 시 불변 계약을 지킨다.
- 기존 적용 migration은 수정하지 않고 `2026-07-14-playground-2048.sql` forward migration을 추가한다.
- migration은 CHECK allow-list, read snapshot/leaderboard, start fee, finish 점수 검증, grade/reward 분기만 확장한다.
- 기존 `SECURITY DEFINER`, 빈 `search_path`, canonical 사용자 확인, advisory lock, `FOR UPDATE`, replay/idempotency, PUBLIC·authenticated 차단과 anon-only EXECUTE 권한을 유지한다.

앱보다 DB migration을 먼저 적용한다. 앱이 먼저 배포되면 구버전 RPC가 2048 start/finish를 거부할 수 있다.

## 화면 구성

- 상단 HUD: 현재 점수, 최고 타일, 남은 빈 칸.
- 중앙: 정사각형 4×4 보드와 live status.
- 하단: 키 안내와 모바일용 네 방향 조작 버튼.
- milestone, pause, quit, result는 기존 아케이드 chrome 안에서 겹쳐 표시한다.
- 게임 카드와 아트는 기존 Playground 의미 토큰을 사용하며 2048 전용 노란 tone을 추가한다.
- 1440×800, 1024×768, 390×844에서 보드와 조작 버튼이 잘리지 않아야 한다.
- 모든 조작 버튼은 최소 44×44px이며 모바일 dock은 safe-area를 포함한다.

## 접근성과 테스트 훅

- 보드에 좌표 순서의 현재 값이 포함된 `aria-label`을 제공한다.
- 이동 중 `aria-busy="true"`, 점수/합성/게임 종료 안내는 `aria-live`로 알린다.
- milestone과 종료 확인 dialog는 제목 연결, 모달 의미, 초기 포커스와 복귀 포커스를 가진다.
- 스테이지가 mount된 동안 `window.render_game_to_text()`를 제공해 보드, 점수, 최고 타일, phase, animation, queued direction을 직렬화한다.
- `window.advanceTime(ms)`는 turn-based 게임의 대기 중 이동/impact timer를 테스트에서 완료시키는 용도로만 제공하고 unmount 때 제거한다.

## 범위 밖

- 2048 전용 DB 도전과제와 최고 타일 장기 통계
- undo, power-up, 광고, 멀티플레이
- 스도쿠나 추가 캐주얼 게임 구현
- 기존 스네이크·테트리스 밸런스 변경

## 완료 조건

- 엔진의 합성/점수/no-op/game-over/RNG/trace 테스트가 통과한다.
- Arcade domain, preview, store, SQL contract가 2048을 포함한다.
- 실제 앱 preview에 `배한솔 / 1234`로 로그인해 데스크톱·태블릿·모바일 폭에서 키보드, 버튼, 스와이프, pause, milestone, result를 확인한다.
- `npm run typecheck`, 관련 테스트, `npm run test:playground`, `npm run build:vite`가 통과한다.
- 독립 리뷰와 Codex PR 리뷰가 명시적으로 통과한 뒤 merge한다.
- 정식 빌드 산출물을 G드라이브에 파일 먼저, `manifest.json` 마지막 순서로 배포하고 Setup/latest/manifest SHA-256을 확인한다.
