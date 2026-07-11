# 배플레이그라운드 v3 비교 검증

## Evidence

- 승인 기준: `2026-07-11-playground-v3-reference-1440.png`
- 실제 React: `2026-07-11-playground-v3-actual-1440.png`
- 실제 앱: `http://127.0.0.1:5173/?preview=1`
- 로그인 사용자: `배한솔`
- reference는 `.device` 시작점을 viewport 상단에 맞춘 뒤 원본 그대로 캡처했다. 이 환경의 clip 좌표 오적용을 피했으며 이미지 후처리는 하지 않았다.
- geometry는 1440×1000에서 측정했고 Actual 시각 증거는 같은 1440 폭의 1440×800 viewport로 캡처했다.

## Contract results

| 검증 | 기준 | 실제 측정 | 결과 |
|---|---|---|---|
| 1440 로비 tracks | 2개 | `953.875px / 377.115px` | PASS |
| 왼쪽/오른쪽 비율 | 2.35~2.70 | `2.5294` | PASS |
| ranking rail | 220px 이상 | `377.115px` | PASS |
| random hero | 240px 이상 | `306.188px` | PASS |
| quick cards | 같은 행 4개, top 차이 2px 이하 | 4개, top 차이 `0px` | PASS |
| 1024 layout | 1열 + quick cards 2열 | 로비 1열, 카드 2행 | PASS |
| 390 header | 88px 이상 두 줄 | `100.594px`, 카드 2열 | PASS |
| 390 House dock | 1열 | 1열 | PASS |
| horizontal overflow | 모든 viewport에서 없음 | 1440/1024/720/390 모두 없음 | PASS |
| A↔C transition | dot 없음 | 클릭 직후 status overlay 0개 | PASS |
| game/market transition | target copy + dark cover | Tetris/Market target copy 확인, presentation palette `#07090d` 실행 테스트 통과 | PASS |
| House source return | game/market 모두 House 복귀 | Tetris와 JBBJ 시장 모두 House 복귀 | PASS |
| Lobby source return | market이 Lobby 복귀 | JBBJ 시장에서 Lobby 복귀 | PASS |
| market regression | home/detail/account 유지 | 세 화면 모두 DOM·포커스 확인 | PASS |
| point transfer | 1,000P 넣기/빼기 즉시 반영 | 지갑 `18,450→17,450→18,450P`, 예수금 `3,640→4,640→3,640P` | PASS |
| console errors | 0개 | 0개 | PASS |

## Recommendation session

새로 입장한 한 세션에서 추천은 `스네이크 → 테트리스 → 스도쿠` 순서로 노출됐다. 두 번의 `다른 추천` 안에 플레이 가능한 세 게임이 모두 등장했고 JBBJ 시장은 추천 풀에 포함되지 않았다.

## Interaction notes

- 사이드바 진입 overlay의 접근성 문구는 `지금은 쉬는 시간!`이었다.
- House 왕복은 surface 전환이라 dot overlay가 생기지 않았다.
- Tetris와 JBBJ 시장 진입은 각각 `LOADING TETRIS`, `OPENING JBBJ MARKET` target copy를 표시했다.
- 720 CSS px viewport를 1440 화면의 200% 확대 상당 조건으로 사용했으며 모든 보이는 버튼이 화면 안에 남았다.
- in-app Browser의 합성 Enter는 focus까지 이동했지만 native button click을 발생시키지 못했다. keyboard center origin은 production helper/controller 실행 테스트로, 3px focus-visible은 CSS 계약 테스트로 검증했다.
- 실제 OS `prefers-reduced-motion` 설정은 바꾸지 않았다. 0 particles, 110ms commit, 220ms finish와 surface 즉시 전환은 순수 실행 테스트로 검증했다.

## Visual decision

승인 v3의 local header, asymmetric hero, four-card row, ranking rail, House challenge/podium/dock을 실제 B flow sidebar 안쪽 화면으로 복원했다. 외부 Visual Lab frame은 의도적으로 제외했다.

승인 HTML 이후 확정된 기능 범위에 따라 네 번째 빠른 실행은 준비 중 슬롯머신 대신 실제 JBBJ 시장으로 연결했다. 추천 hero는 계속 테트리스·스네이크·스도쿠 세 게임만 사용한다.
