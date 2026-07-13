# 배플레이그라운드 아케이드 · 포인트 제도 설계 (스네이크 / 테트리스 / 도전과제 / 랭킹 / 슬랙)

- **날짜**: 2026-07-13
- **상태**: 한솔 리뷰 대기 초안 (자율 세션에서 코드베이스 근거로 결정을 내렸으며, 각 결정의 근거를 명시함. §14 "한솔 확인 항목"만 확정하면 구현 착수 가능)
- **구현 계획**: `docs/superpowers/plans/2026-07-13-baeplayground-arcade-points.md`
- **인터랙션 목업**: `docs/superpowers/mockups/2026-07-13-baeplayground-arcade-mockup.html` (브라우저로 열면 스네이크/테트리스가 실제로 조작되는 목업)

---

## 1. 목표

업무 활동(씬 완료, 댓글, 리테이크 수정 완료, 매일 접속)으로 **포인트**를 벌고, 그 포인트로 배플레이그라운드에서 **게임(스네이크·테트리스)** 을 플레이해 포인트를 더 벌 수 있는 순환 구조를 만든다. 게임마다 **도전과제**와 **랭킹**이 있고, 신기록이 나오면 **슬랙 웹훅**으로 알린다. 보유 포인트는 **메인 화면 우상단**에 항상 보인다.

한 줄 루프: `일해서 포인트 획득 → 우상단 배지에 쌓임 → 플레이그라운드에서 입장료 내고 게임 → 등급 보상/도전과제/신기록 → 슬랙 자랑 → 다시 일`

## 2. 현재 상태 (이미 만들어져 있는 것)

| 영역 | 상태 | 위치 |
|---|---|---|
| 플레이그라운드 로비/하우스/전환(dot-wipe)/뒤로가기 | ✅ 완성 | `src/views/PlaygroundView.tsx`, `src/views/playground/*`, `src/features/playground/*` |
| 게임 3종 카탈로그(테트리스/스네이크/스도쿠) | ✅ 정의됨, 화면은 `ComingSoonGame` 플레이스홀더 | `src/features/playground/catalog.ts`, `routes.ts`(`kind: 'coming-soon'`) |
| 포인트 지갑 (`walletPoints`, `lifetimeEarnedPoints`) | ✅ DB·RPC 존재. 단 **적립 경로가 없음** (최초 1,000,000P 시드뿐) | `playground_wallet_accounts` 테이블, `DEVLOG/migrations/2026-07-11-playground-market-v2.sql` |
| 멱등 원장 (`UNIQUE(user_id, request_id)`) | ✅ 존재 | `playground_value_ledger` |
| 모의투자(JBBJ 증권) | ✅ 별도 트랙에서 완성/운영 중 (이 설계에서 변경 최소화) | `src/features/playground/market/*`, `electron/marketAccountService.ts` |
| 포인트 랭킹 UI | ⚠️ 내 지갑만 실데이터, 팀원 4명은 fixture | `src/features/playground/ranking.ts`(`TEAMMATES`) |
| 로비 카드의 "최고 기록 18,420점" 등 | ⚠️ 전부 하드코딩 카피 | `catalog.ts`의 `heroMeta`/`quickRecord` |
| 활동 로그 (씬/댓글/리테이크, 메인 프로세스 중앙집중) | ✅ 존재 — 포인트 훅을 끼울 지점 | `electron/main.ts` 각 IPC 핸들러 (§7) |
| 슬랙 웹훅 (워크플로 트리거, 메인에서 fetch) | ✅ 패턴 존재 (멘션·리깅 공지) | `electron/main.ts:2923~2947`, `src/services/slackWebhookService.ts` |
| 접근 게이트 | ✅ 배한솔 전용 (`canAccessPlayground`) | `src/features/playground/featureFlag.ts` |

## 3. 비범위 (v1에서 하지 않는 것)

- 슬롯머신, 스도쿠 **구현** (스도쿠는 카탈로그·ComingSoon 유지, 슬롯은 disabled 유지)
- JBBJ 하우스의 팀 챌린지 실데이터화, "4명 접속 중" 실시간 presence
- 주간 랭킹 다이제스트 슬랙 자동 발송 (신기록 단건 알림만 v1)
- 테트리스 T-spin/Back-to-Back 보너스 판정
- 팀 전체 공개 (배한솔 전용 게이트와 v2 위협 모델 유지 — `2026-07-11-playground-market-v2.sql` 주석의 "TEST-ONLY THREAT MODEL" 그대로)
- Supabase Realtime 구독 (모의투자와 동일하게 미사용 — 단일 사용자라 불필요)
- 포인트 차감형 패널티, 포인트 만료, 유저 간 포인트 선물

## 4. 아키텍처 결정

### 4-1. 지갑·원장은 신설하지 않고 모의투자 것을 확장한다 (결정)

- 포인트 통화는 하나다. 게임/활동/모의투자 이체가 모두 같은 `playground_wallet_accounts.wallet_points`를 쓰고, 모든 증감은 `playground_value_ledger`에 남는다.
- 원장의 `kind` CHECK 제약을 확장해 아케이드용 kind를 추가한다: `'game-entry' | 'game-reward' | 'scene-progress' | 'comment' | 'retake-done' | 'daily-login' | 'achievement' | 'arcade-grant'`.
- **멱등성**: 기존 `UNIQUE(user_id, request_id)`를 그대로 활용. 활동 적립의 request_id는 결정론적 이벤트 키(§7 표)라서 "체크 해제 후 재체크" 같은 반복 행동에 재지급되지 않는다.
- 대안(별도 아케이드 지갑/원장 신설)은 지갑 이원화·이체 UI 추가 부담 때문에 기각.

### 4-2. RPC는 신설 2개, 기존 모의투자 RPC는 건드리지 않는다 (결정)

- `playground_arcade_read(p_user_id uuid)` — 지갑/기록/랭킹/도전과제/출석/설정 스냅샷 1회 조회.
- `playground_arcade_execute(p_user_id uuid, p_request_id text, p_kind text, p_payload jsonb)` — 모든 변경(출석/활동/게임 시작/게임 종료/도전과제/설정).
- v2와 동일한 하드닝을 복제한다: `SECURITY DEFINER` + `SET search_path=''`, 테이블 REVOKE ALL + RPC만 `GRANT EXECUTE TO anon`, canonical 배한솔 재확인, `pg_advisory_xact_lock`(사용자 단위), 지갑 행 `FOR UPDATE`, 원장 멱등 probe(`same`/`conflict`/`missing`), `response_state` 재생 응답.
- `playground_market_execute`를 확장하지 않는 이유: 이미 800줄 규모의 신중히 관리되는 함수라 게임 분기를 섞으면 회귀 위험이 크다.

### 4-3. 활동 포인트는 렌더러가 아니라 **Electron 메인의 기존 활동 로그 지점**에서 지급한다 (결정)

- 메인은 이미 씬/댓글/리테이크 mutation 성공 직후 활동 로그를 남기고(`logSceneActivity`/`sbRecordActivityLog`), 행위자 신원도 메인 소유의 `currentActivityUser`가 정본이다.
- 이 지점에서 `arcadeService.awardActivity(...)`를 **fire-and-forget**으로 호출한다(await로 원래 mutation을 막지 않고, 실패는 로그만). 렌더러 UI에는 메인 → 렌더러 push(`arcade:wallet-updated`)로 잔액 변화를 알린다.
- 프로토타입 게이트: `currentActivityUser`가 canonical 배한솔이 아니면 지급 시도 자체를 건너뛴다(조용히 no-op). 팀 공개 시 이 게이트만 제거하면 된다.

### 4-4. 렌더러는 모의투자와 동일한 레이어링을 복제한다 (결정)

`domain(순수) → gateway(electron/localStorage 이중) → zustand store → view`. 게임 엔진(스네이크/테트리스)은 **순수 TS 모듈 + 주입식 시드 PRNG**로 만들어 node:test로 결정론 테스트한다 (`Math.random()` 직접 사용 금지 — 모의투자 가격 모델과 같은 원칙).

### 4-5. 지갑 표시의 단일 소스 (결정)

- 지갑 UI 소스는 계속 `useMarketPreviewStore.visible.account`(플레이그라운드 헤더/랭킹)와 신규 `useArcadeStore.snapshot.wallet`(앱 헤더 배지) 두 군데가 되므로, **아케이드 mutation 성공 응답과 `arcade:wallet-updated` push가 올 때마다 두 스토어 모두에 반영**한다. `useMarketPreviewStore`에 외부 지갑 패치 액션(`applyServerWallet`)을 추가한다 (confirmed/visible 동시 패치; 모의투자 명령 진행 중이면 서버 응답이 곧 덮어쓰므로 충돌 무해).

## 5. 포인트 경제 (v1 밸런스)

> 모든 수치는 `src/features/playground/arcade/constants.ts`의 `ARCADE_BALANCE` 한 곳에 두고, SQL RPC의 수치와 계약 테스트로 동기화한다. 한솔이 나중에 조정할 때 이 파일 + 마이그레이션만 바꾸면 된다.

### 5-1. 적립 (업무 활동 — 메인 프로세스 훅)

| 활동 | 포인트 | request_id (멱등 키) | 1일 상한 (KST) |
|---|---|---|---|
| 매일 첫 실행(로그인·세션 복원 포함) | **+20** | `daily-login:<YYYY-MM-DD>` | 1회 |
| BG 씬 단계 체크 (lo/done/review/png 각각, false→true 최초 1회) | **+5** | `scene-stage:<sceneUuid>:<stage>` | scene-progress 합산 30건 |
| ACT 씬 phase가 done으로 최초 진입 | **+10** | `scene-phase-done:<sceneUuid>` | scene-progress 합산 30건 |
| 댓글 작성 (일반 + 리테이크 + 캐릭터 보드 댓글 — `supabase:add-comment` 경유 전부) | **+5** | `comment:<commentId>` | 5건 |
| 리테이크 담당자 수정 완료 (`revision_assignee_done`) | **+30** | `retake-done:<revisionId>` | 5건 |

- 상한 판정은 **서버(RPC)** 가 원장에서 같은 kind의 오늘(KST) 행 수를 세어 강제한다. 상한 초과 시 지급 0으로 정상 응답(에러 아님).
- 체크 해제해도 회수하지 않는다(원장 불변). 재체크 시 멱등 키 때문에 재지급 없음.
- `supabase:bulk-update-scene-stages`(일괄 보정 경로)에서는 지급하지 않는다 — 대량 보정으로 오지급 방지.
- `revision_resolve`(감독 최종 완료)는 v1에서 지급 없음. 수정 행위자 보상이 목적이므로 담당자 완료에만 지급.

### 5-2. 소비·게임 보상

| 게임 | 입장료 | 등급 기준 (score) | 등급별 보상 |
|---|---|---|---|
| 스네이크 (score = 최종 길이) | **10P** | BRONZE 15 / SILVER 25 / GOLD 40 / PLATINUM 55 | 8 / 18 / 30 / **45P** |
| 테트리스 (score = 점수) | **15P** | BRONZE 3,000 / SILVER 10,000 / GOLD 25,000 / PLATINUM 50,000 | 12 / 30 / 55 / **80P** |

- 보상은 **한 판에 최고 도달 등급 1개만** 지급. 미달(NONE)은 0P.
- **보상 지급은 게임별 1일 5회(KST)**. NONE 판은 카운트하지 않음. 이후 판은 플레이·기록·랭킹은 되지만 보상 0 (시작 화면에 "오늘 보상 가능 3/5" 표시).
- 입장료는 게임 시작 시 차감(잔액 부족이면 시작 불가), 중도 이탈·사망·앱 종료 시 환불 없음. 입장료에는 횟수 제한 없음 → 포인트 싱크 역할.
- 최고 등급 보상(45/80)은 기존 카탈로그 카피의 수치(스네이크 45P, 테트리스 80P)를 계승. 등급 문구는 §12에 따라 카피 갱신.

### 5-3. 밸런스 감각 (근거)

활발한 하루: 출석 20 + 씬 체크 ~10건 50~100 + 댓글 25 + 리테이크 1~2건 30~60 ≈ **125~205P/일**. 게임 기대 수익은 실력에 따라 판당 -15 ~ +65P, 보상 상한(5회)까지 하루 최대 +400P(플래티넘 5연속, 사실상 불가). 초기 시드 1,000,000P(모의투자 자본)가 이미 있어 v1 수치는 "의미 있는 잔액 변화"보다 **루프 검증**이 목적. 팀 공개 시 신규 유저 시드는 `arcade-grant` kind로 별도 책정(예: 3,000P — v1 비범위).

## 6. 게임 공통 플로우 (스테이지 상태 머신)

```
ready ──[입장료 지급 성공(game-start)]──▶ countdown(3→2→1, 각 700ms) ──▶ running
running ──[P/Esc, 창 blur, document.hidden]──▶ paused ──[재개]──▶ running
running ──[죽음/탑아웃]──▶ finishing(game-finish RPC) ──▶ result
result ──[다시 하기]──▶ ready(새 runId)   result/ready ──[나가기]──▶ 로비/하우스
```

- `runId = crypto.randomUUID()` 를 시작 시 발급. `game-start`의 request_id는 `game-entry:<runId>`, 종료는 `game-finish:<runId>`.
- **결과 검증(서버)**: finish는 (1) 같은 유저의 `game-entry:<runId>` 원장 행 존재, (2) 동일 runId 런 미존재, (3) score/duration 상식 범위(§8·§9의 상한, duration 1초~4시간)일 때만 접수. 등급·보상 계산은 서버가 SSOT(클라 상수는 표시용 미러). 등급 판정은 경계값 **이상(>=)**.
- **durationMs 정의**: running 상태에서 고정 timestep으로 소비된 시뮬레이션 시간의 합(ms). 카운트다운·일시정지 시간은 포함하지 않는다. (정상 스네이크 최단 사망 ≈ 1.76초라 1초 하한은 조작 방어용으로만 작동)
- **멱등 재생 표시**: execute가 원장 probe `same`으로 저장된 응답을 재생할 때는 응답에 `replayed: true`를 덧붙인다. 재생 응답으로는 지갑 push·획득 연출을 발생시키지 않는다 (재체크·재시도 시 가짜 "+N P" 방지).
- **게임 중 뒤로가기/사이드바 이탈**: 기존 `PlaygroundBackProvider` 인터셉터 스택에 등록해 "게임을 종료할까요? 입장료는 돌려받지 못해요" 확인 모달을 띄운다.
- **일시정지 자동화**: `document.hidden`·창 blur 시 자동 pause. 게임 루프는 `requestAnimationFrame` + 고정 timestep 누적기(멈춘 시간은 시뮬레이션하지 않음).
- **RNG**: 판마다 `seed = crypto.getRandomValues` 기반 32bit 정수 1개 → mulberry32 계열 시드 PRNG. 엔진은 `random()`을 주입받는 순수 함수 집합.
- **결과 화면**: 등급 리빌(게이지 채움) → 보상 카운트업 → 신기록 배너 → 새로 해금된 도전과제 목록. 목업 참조.
- **접근성**: 캔버스 옆 `aria-live="polite"` 상태 텍스트(시작/일시정지/게임 오버/등급), 모든 버튼 44px 이상, `prefers-reduced-motion`이면 리빌·카운트업을 즉시 표시로 대체.

## 7. 활동 훅 지점 (Electron 메인 — 정확한 위치)

| 훅 | 위치 (현재 기준) | 조건 |
|---|---|---|
| 씬 단계(BG) | `electron/main.ts` `supabase:update-scene-stage` 핸들러 (≈:1944, `logSceneActivity` 호출부) | `value === true`인 체크만 |
| 씬 phase(ACT) | 같은 파일 `supabase:update-scene-phase` 핸들러 (≈:1956) | `sceneState === 'done'`만 |
| 댓글 | 같은 파일 `supabase:add-comment` 핸들러 (≈:2277) | 저장 성공 후 |
| 리테이크 | 같은 파일 리비전 상태 핸들러의 actionType 매핑 (≈:2488–2492) | `revision_assignee_done`으로 매핑되는 경우만 |
| 출석 | `electron/main.ts` `setCanonicalActivityUser` (≈:1470) — sessionManager.publish 경유로 로그인·세션 복원 모두 통과 | 사용자 확정 시 1회 시도(멱등) |

공통 규칙: **원래 mutation의 성공이 확정된 뒤**에만 호출, `void arcadeService.awardActivity(...).catch(log)` 형태로 절대 원래 흐름을 막거나 실패시키지 않는다. 행위자는 `currentActivityUser`.

## 8. 스네이크 스펙 (전체 규칙 — 구현 계획 Task에 상세 재기술)

- 그리드 21×21. 시작: 머리 (10,10), 몸 (9,10)(8,10)(7,10), 길이 4, 동쪽 진행.
- 틱 기반: 시작 160ms/틱, 사과 1개당 -4ms, 하한 80ms.
- 입력: 화살표/WASD. 방향 큐 최대 2개 버퍼(가득이면 입력 무시). 각 틱에 큐에서 1개 꺼내 적용하되, 현재 진행 방향의 180° 반전이면 버리고 그 틱은 기존 방향을 유지한다(다음 큐 항목을 당겨 보지 않음).
- 사과: 빈 칸에서 균등 랜덤(주입 PRNG). **5의 배수 번째(5, 10, 15…) 사과는 골든** — 성장 +2 (일반은 +1). 골든도 속도 증가는 1회분.
- 죽음: 벽 또는 자기 몸 충돌 → finish.
- score = 최종 길이 (이론 최대 441 — 서버 상한). 카탈로그 표기 "최고 길이"와 일치.

## 9. 테트리스 스펙 (전체 규칙 — 구현 계획 Task에 상세 재기술)

- 보드 10×20 (+숨김 2행). 7-bag 랜덤라이저, Next 5개, Hold 1개(피스당 1회), 고스트 피스 표시.
- 회전: **SRS 표준 + 벽킥 테이블(JLSTZ·I 분리)** — 킥 테이블 전문을 구현 계획에 수록.
- 중력(레벨→ms/행): `[1000, 850, 720, 600, 490, 390, 310, 240, 180, 140, 105, 80, 60, 45, 35]` (레벨 1~15, 15에서 고정).
- 입력: ←→ 이동(DAS 160ms / ARR 40ms 자체 구현 — OS 키 반복 사용 금지), ↓ 소프트드롭(50ms/행, +1점/칸), Space 하드드롭(+2점/칸), Z=반시계, X 또는 ↑=시계, C=홀드, P/Esc=일시정지.
- 락 딜레이 500ms, 이동/회전 성공 시 리셋(최대 15회, 초과 시 즉시 고정).
- 점수: 1/2/3/4줄 = 100/300/500/800 × 레벨. 콤보(연속 클리어 락) = 50 × 콤보수 × 레벨. 레벨 = `floor(누적 라인/10)+1` (상한 15).
- 게임 오버: 스폰 위치 충돌(block out). 서버 score 상한 3,000,000.

## 10. 도전과제 (v1 — 10종)

정의는 코드 상수(정의 파일은 `constants.ts`), 해금 상태만 DB(`playground_achievement_unlocks`). 평가 트리거는 두 곳: **① 게임 finish 직후**(게임 과제 + 공통 과제), **② 아케이드 스냅샷 load 직후**(공통 과제만 — attend-7, arcade-earned-5k처럼 게임 없이 달성되는 과제 커버). 새 해금마다 `achievement-unlock` execute(멱등 키 `ach:<id>`) → 보너스는 서버의 id→보너스 고정 맵으로 지급(클라 주장 금액을 믿지 않음). 조건 자체의 서버 재검증은 하지 않음(단일 사용자 프로토타입 한계로 수용, 스펙에 명시). 누적형 조건은 "이번 런 반영 후" 기준: 도메인 함수가 서버 스냅샷(런 미포함 값)에 이번 런(+1판, +보상 포인트)을 더해 판정한다.

| id | 이름 | 조건 | 보너스 |
|---|---|---|---|
| `arcade-first-run` | 첫 판 | 아케이드 런 최초 완료 | +10P |
| `arcade-runs-50` | 단골 손님 | 누적 런 50판 | +30P |
| `arcade-earned-5k` | 티끌 모아 | 적립형 kind(활동+출석+게임보상+도전과제) 누적 +5,000P | +50P |
| `attend-7` | 개근상 | 연속 출석 7일 (원장 `daily-login` 행으로 계산) | +50P |
| `snake-30` | 몸집 불리기 | 스네이크 한 판 길이 30 | +15P |
| `snake-55` | 전설의 뱀 | 스네이크 한 판 길이 55 | +40P |
| `snake-golden-5` | 황금 미식가 | 한 판에 골든 사과 5개 | +20P |
| `tetris-tetris` | 테트리스! | 한 번에 4줄 클리어 | +20P |
| `tetris-level-10` | 고속 낙하 | 레벨 10 도달 | +30P |
| `tetris-30k` | 3만 클럽 | 단판 30,000점 | +40P |

## 11. 랭킹 · 슬랙 알림

- **게임별 랭킹**: `playground_game_runs`에서 read RPC가 계산 — 전체 기간 top5 + 주간(KST 월요일 시작) top5 + 내 최고. 로비/하우스에서 게임별 탭 패널로 표시. (현재 실사용자는 한솔뿐이라 자리 표시 행 "—" 노출.)
- **포인트 랭킹(기존 레일)**: `ranking.ts`의 `TEAMMATES` fixture 제거. read RPC가 모든 지갑 행(+`users` join 이름)을 반환하고, 지갑 없는 팀원은 `useAuthStore.users` 목록으로 "— P" 행 표시. 프리뷰 모드에서만 기존 fixture 4명을 시드로 유지.
- **신기록 정의**: `newAlltimeBest` = 이번 score가 내 이전 전체 기간 최고를 **초과(>)** — 동점은 신기록 아님. 이전 기록이 없으면(첫 완주) 신기록으로 취급하고 슬랙 detail은 "첫 기록"으로 표기. `newWeeklyBest`도 같은 규칙을 주간 범위에 적용.
- **슬랙 알림 (v1 = 전체 기간 신기록 단건)**: finish 응답의 `newAlltimeBest === true && slackNotifyEnabled === true`(둘 다 서버 응답 필드)일 때 **메인 프로세스가** 기존 `postSlackWebhook` 패턴으로 발송. 렌더러 왕복 없음. `replayed` 응답에는 발송하지 않음.
  - 신규 워크플로 트리거 URL 상수 `SLACK_ARCADE_WEBHOOK_URL`(메인 하드코딩, 기존 패턴 유지 — `feedback_slack_hardcoded_webhook` 결정 준수). **한솔이 슬랙 워크플로를 새로 만들어 URL을 채워야 하며**, 빈 문자열이면 조용히 skip.
  - payload 변수 3개 고정: `title`(예: "테트리스 신기록!"), `detail`(예: "32,410점 — 이전 기록 18,420점"), `player`(행위자 이름).
  - 발송 여부는 DB 설정 `playground_arcade_config.slack_notify_enabled`(기본 **false**)로 제어. 플레이그라운드 내 관리자 설정 토글(모의투자 관리자 패널 패턴)로 변경.

## 12. 현재 코드에서 수정해야 할 것 (신규 파일 제외 전체 목록)

| 파일 | 수정 내용 |
|---|---|
| `DEVLOG/migrations/2026-07-11-playground-market-v2.sql` | 수정 금지(참조만). kind CHECK 확장은 **새 마이그레이션**에서 `ALTER TABLE ... DROP CONSTRAINT playground_ledger_kind_valid; ADD CONSTRAINT ...` |
| `src/features/playground/routes.ts` | `{ kind: 'coming-soon' }` → `{ kind: 'game' }`로 개명 (게임 구현이 붙는 PR C에서). 액션은 `open-game` 그대로 |
| `src/views/PlaygroundView.tsx` | `route.kind === 'game'` 분기에서 신규 `GameHost` 렌더 + 아케이드 스냅샷 load + 랭킹 빌드에 실데이터 전달 |
| `src/features/playground/ranking.ts` | `TEAMMATES` fixture 제거, `buildPointRanking(user, teammates)` 시그니처로 실데이터 주입 |
| `src/features/playground/catalog.ts` | `heroMeta`/`quickRecord`의 하드코딩 수치 제거(예: "평균 4분 · 최고 기록은 실제 기록으로 표시"), 보상 카피를 §5-2 확정 수치로 갱신 (예: 테트리스 "플래티넘 등급은 80 포인트") |
| `src/views/playground/PlaygroundGameCard.tsx`, `PlaygroundRecommendationHero.tsx` | `record`/`reward` 표시용 옵션 prop 추가 — 아케이드 스토어의 내 최고 기록으로 오버레이, 없으면 "아직 기록이 없어요" |
| `src/views/playground/JbbjHouse.tsx` | 도크 항목 상태 문구 "플레이 준비 중" → "바로 플레이" (구현된 게임만) |
| `src/features/playground/market/useMarketPreviewStore.ts` | `applyServerWallet(wallet)` 액션 추가 (confirmed/visible의 `account.walletPoints`/`lifetimeEarnedPoints` 패치) |
| `src/components/layout/Header.tsx` | 우상단 클러스터(≈:51, NotificationBell과 구분선 사이)에 `HeaderPointsBadge` 삽입 (canAccessPlayground 게이트) |
| `electron/main.ts` | 아케이드 IPC 핸들러 2개 + 활동 훅 4곳 + 출석 훅 + `SLACK_ARCADE_WEBHOOK_URL` 상수 + arcadeService 초기화 |
| `electron/preload.ts` | `arcadeRead`/`arcadeExecute`/`onArcadeWalletUpdated` 브릿지 |
| `electron/supabase.ts` | `sbReadPlaygroundArcadeState`/`sbExecutePlaygroundArcade` |
| `src/mocks/devElectronAPI.ts` | 아케이드 API 목 추가 (localStorage 게이트웨이로 위임) |
| `package.json` | `test:playground`에 신규 테스트 파일 추가, 버전 상향 |
| `tests/playgroundRoutes.test.ts` 등 route/전환/프레젠테이션 테스트 | `coming-soon` → `game` 개명 반영 (`grep -r "coming-soon" src tests`로 전수 확인) |
| `ROADMAP.md`, `CONTEXT.md`, `AGENTS.md`, `DEVLOG/update-notes.json` | PR별 갱신 (update-notes는 비개발자 톤 규칙 준수) |

## 13. 데이터 모델 · IPC 요약

- **신규 테이블**: `playground_game_runs`(런 기록: id=runId, game_id, score, grade, duration_ms, meta jsonb, reward_points, was_alltime_best, entry_request_id UNIQUE), `playground_achievement_unlocks`(PK user_id+achievement_id), `playground_arcade_config`(단일 행, slack_notify_enabled).
- **원장 kind 확장**: §4-1.
- **IPC**: `arcade:read`, `arcade:execute` (invoke) / `arcade:wallet-updated` (메인→렌더러 push, payload `{ wallet, delta, reason }`). 네이밍은 기존 `도메인:동작` kebab-case 컨벤션.
- **execute kind**: `daily-login` / `activity` / `game-start` / `game-finish` / `achievement-unlock` / `config-set` (config-set만 원장 미기록 — 자연 멱등이므로). 모든 execute 응답은 재생 시 `replayed: true`를 포함한다.
- 전체 DDL·RPC 계약·응답 shape는 구현 계획 Task 1에 수록.

## 14. 한솔 확인 항목 (구현 전 결정하면 좋은 것 — 기본값으로도 진행 가능)

1. **입장료 유무**: 게임 시작에 입장료(스네이크 10P/테트리스 15P)를 받는 설계입니다. "포인트로 게임을 한다"는 컨셉 + 포인트 싱크 목적. 무료로 하려면 `ARCADE_BALANCE`에서 0으로.
2. **보상 상한**: 게임별 1일 5회가 기본값. 조정 가능.
3. **리테이크 완료의 정의**: 담당자 완료(`revision_assignee_done`)에만 +30P. 감독 최종 완료에도 줄지 여부.
4. **슬랙 워크플로**: 신기록 알림용 워크플로(변수 `title`/`detail`/`player`)를 슬랙에서 새로 만들어 URL을 전달해야 발송 가능. 그 전까지는 토글 off + URL 빈 값으로 무해.
5. **활동 포인트 수치** (§5-1 표) — 전부 상수 파일에서 일괄 조정 가능.

---
*작성: Claude (자율 세션) × 한솔 리뷰 대기 · Studio JBBJ*
