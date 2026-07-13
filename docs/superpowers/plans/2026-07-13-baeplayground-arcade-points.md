# 배플레이그라운드 아케이드 · 포인트 제도 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (subagent 사용 가능 시) 또는 superpowers:executing-plans로 task 단위 구현. 단계는 checkbox(`- [ ]`)로 추적한다.

**Goal:** 업무 활동·출석으로 포인트를 적립하고, 스네이크·테트리스를 플레이해 등급 보상을 받으며, 도전과제·게임별 랭킹·신기록 슬랙 알림·앱 우상단 포인트 배지가 동작하는 배플레이그라운드 v1 아케이드를 만든다.

**Architecture:** 기존 모의투자 지갑(`playground_wallet_accounts`)과 멱등 원장(`playground_value_ledger`)을 확장하고, 신설 RPC 2개(`playground_arcade_read`/`playground_arcade_execute`)가 모든 포인트 변경을 원자·멱등 처리한다. 활동 적립은 Electron main의 기존 활동 로그 지점에 fire-and-forget 훅으로 붙이고, 렌더러에는 `arcade:wallet-updated` push로 전파한다. 게임 엔진은 시드 PRNG를 주입받는 순수 TS 모듈로 만들어 node:test로 결정론 검증하고, 렌더러는 모의투자와 동일한 domain → gateway(electron/localStorage) → zustand store → view 레이어링을 복제한다.

**Tech Stack:** Electron 33, React 18, TypeScript 5.5, Tailwind(플레이그라운드는 자체 pg-* CSS), Zustand, framer-motion, sonner, Node `node:test`, Supabase(PostgreSQL, RPC only).

**승인 원본:** `docs/superpowers/specs/2026-07-13-baeplayground-arcade-points-design.md`(설계), `docs/superpowers/mockups/2026-07-13-baeplayground-arcade-mockup.html`(인터랙션 목업 — 화면 구조·상태 전환·결과 연출의 시각 기준).

---

## Global Constraints

- 모든 변경은 이 레포에서만 수행한다. 참고용 Bflow 원본(`/home/user/Bflow`)은 절대 수정하지 않는다.
- `DEVLOG/migrations/2026-07-11-playground-market-v2.sql`과 `2026-07-12-...hotfix.sql`은 **수정 금지**(참조 전용). 스키마 변경은 전부 신규 마이그레이션 파일에서.
- 렌더러에서 Supabase 직접 호출 금지. 반드시 preload 브릿지 → IPC → main → `electron/supabase.ts` → RPC.
- 렌더러는 `p_user_id`를 위조할 수 없다: main의 `sessionManager`/`currentActivityUser`가 신원 정본이며, 아케이드 IPC 핸들러는 모의투자의 `ensureCanonicalMarketAccess()`와 같은 게이트를 거친다.
- 지갑 변경은 예외 없이 원장(`playground_value_ledger`) insert와 같은 트랜잭션의 RPC 경유. 클라이언트 수치는 표시용 미러일 뿐 서버가 보상의 SSOT다.
- 멱등성: 모든 execute는 `request_id`를 갖고, 서버는 v2와 동일한 probe 규약(`same` → `response_state` 재생, `conflict` → 오류, `missing` → 실행)을 따른다.
- 게임 엔진·사과 배치 등 모든 랜덤은 주입식 시드 PRNG만 사용한다. `Math.random()`·`Date.now()` 직접 호출 금지(루프 시간은 rAF timestamp 사용, 시드는 `crypto.getRandomValues` 1회).
- 게임 루프는 `requestAnimationFrame` + 고정 timestep 누적기. `document.hidden`/blur 시 자동 일시정지하며 멈춘 시간은 시뮬레이션하지 않는다.
- 포인트·점수는 전부 정수. `Number.MAX_SAFE_INTEGER` 초과 금지(서버 CHECK 준수).
- 활동 훅은 원래 mutation 성공 확정 후 `void ...catch(log)` — 원래 흐름을 절대 막거나 실패시키지 않는다. 행위자가 canonical 배한솔이 아니면 조용히 no-op.
- 접근성: 모든 버튼 44px 이상 + `:focus-visible` 링(기존 playground.css 규칙 준수), 캔버스 옆 `aria-live="polite"` 상태 텍스트, `prefers-reduced-motion` 시 리빌/카운트업/플로팅 애니메이션은 즉시 표시로 대체.
- UI 문구는 전부 한국어, 기존 플레이그라운드 톤(해요체) 유지. 메모/placeholder에 italic 금지.
- 슬랙 웹훅 URL은 기존 패턴대로 main에 상수 하드코딩한다(서버 프록시 도입 금지 — 기존 결정). URL 빈 문자열이면 발송 스킵.
- 각 PR 완료 기준: `npm run typecheck` + `npm run test:playground` + `npm run build:vite` 통과. `npm run build`(installer)와 G드라이브 배포는 한솔 명시 요청 시에만.
- `DEVLOG/update-notes.json`과 PR 본문 "업데이트 요약"은 비개발자 톤 규칙(CLAUDE.md) 준수 — 기술 용어·식별자·파일경로 금지, 상황+영향+결과 시나리오로.
- 버전: PR A=1.84.0, B=1.85.0, C=1.86.0, D=1.87.0 (머지 시점의 main 최신 버전에 따라 +1 마이너로 재조정 가능. 규칙: 기능 추가=마이너).
- 커밋 메시지는 한글. task별로 명시된 파일만 정확히 stage한다(미추적 사용자 파일 금지).

## File Structure

**신규 (renderer):**
- `src/features/playground/arcade/constants.ts` — `ARCADE_BALANCE`(입장료·등급·보상·상한), 도전과제 정의. 밸런스 수치의 단일 소스.
- `src/features/playground/arcade/types.ts` — `ArcadeSnapshot`, `ArcadeExecuteCommand`, `ArcadeExecuteResult`, `ArcadeFinishResult`, `ArcadeGameId` 등 공용 타입.
- `src/features/playground/arcade/domain.ts` — 순수 함수: 등급 계산(`gradeForScore`/`rewardForGrade`/`nextGradeInfo`), 도전과제 평가(`evaluateAchievements`).
- `src/features/playground/arcade/gateway.ts` / `electronGateway.ts` / `localStorageGateway.ts` / `previewGateway.ts` / `seed.ts` — 모의투자 게이트웨이 5종과 같은 구조.
- `src/features/playground/arcade/useArcadeStore.ts` — zustand 스토어(스냅샷/런 실행/도전과제/설정).
- `src/features/playground/arcade/walletBridge.ts` — `arcade:wallet-updated` push 구독 → 아케이드/마켓 스토어 동기화.
- `src/features/playground/arcade/badgeFloatQueue.ts` — 배지 "+N P" 플로팅 표시 큐 (순수 모듈, PR B).
- `src/features/playground/arcade/games/prng.ts` — mulberry32 시드 PRNG.
- `src/features/playground/arcade/games/loop.ts` — 고정 timestep rAF 루프 팩토리.
- `src/features/playground/arcade/games/snake/engine.ts`, `snake/types.ts` — 순수 스네이크 엔진.
- `src/features/playground/arcade/games/tetris/engine.ts`, `tetris/types.ts`, `tetris/pieces.ts`(4상태 셀 데이터), `tetris/srs.ts`(킥 테이블), `tetris/bag.ts` — 순수 테트리스 엔진.
- `src/views/playground/arcade/GameHost.tsx` — `route.kind === 'game'` 진입점, 게임별 스테이지/ComingSoon 분기.
- `src/views/playground/arcade/ArcadeStageChrome.tsx` — ready/countdown/running/paused/result 상태 셸(좌 HUD·우 스테이지, `pg-game-screen` 그리드 재사용).
- `src/views/playground/arcade/SnakeStage.tsx` / `TetrisStage.tsx` — 캔버스 렌더 + 입력 바인딩.
- `src/views/playground/arcade/RunResultOverlay.tsx` — 등급 리빌·보상 카운트업·신기록·도전과제 해금.
- `src/views/playground/arcade/ArcadeRankingPanel.tsx` — 게임별 전체/주간 랭킹 탭.
- `src/views/playground/arcade/arcade.css` — playground.css 토큰(`--pg-*`)만 사용.
- `src/components/layout/HeaderPointsBadge.tsx` — 앱 헤더 우상단 포인트 배지.

**신규 (electron/main):**
- `electron/arcadeService.ts` — 사용자별 FIFO 큐, read/execute, awardActivity, grantDailyLogin, 신기록 슬랙 발송, `arcade:wallet-updated` broadcast.

**신규 (DB/테스트):**
- `DEVLOG/migrations/2026-07-13-playground-arcade-v1.sql`
- `tests/playgroundArcadeDatabaseContract.test.ts`, `playgroundArcadeDomain.test.ts`, `playgroundArcadeGateway.test.ts`, `playgroundArcadeStore.test.ts`, `playgroundArcadeMainWiring.test.ts`, `playgroundSnakeEngine.test.ts`, `playgroundTetrisEngine.test.ts`, `playgroundArcadeUiWiring.test.ts`, `playgroundHeaderPointsBadge.test.ts`

**수정:** 설계 문서 §12 표의 파일 전부 (routes/PlaygroundView/ranking/catalog/GameCard/Hero/JbbjHouse/useMarketPreviewStore/Header/main/preload/supabase/devElectronAPI/package.json/기존 playground 테스트).

## PR 분할

| PR | 버전 | 내용 | Tasks |
|---|---|---|---|
| **A. 아케이드 기반** | 1.84.0 | 마이그레이션+RPC, main 서비스+IPC, 게이트웨이+스토어, 헤더 배지, 출석 적립, 포인트 랭킹 실데이터 | 1–6 |
| **B. 업무 활동 적립** | 1.85.0 | 씬/댓글/리테이크 훅 3종 + 배지 획득 연출 | 7 |
| **C. 스네이크** | 1.86.0 | 스네이크 엔진, 공용 스테이지 셸, 결과/보상, 도전과제(공통4+스네이크3), 라우트 개명, 로비 기록 연동 | 8–10 |
| **D. 테트리스 + 랭킹/슬랙** | 1.87.0 | 테트리스 엔진/스테이지, 테트리스 도전과제 3종, 게임별 랭킹 패널, 신기록 슬랙 알림 + 설정 토글 | 11–13 |

각 PR 마지막 task에 버전·update-notes·ROADMAP/CONTEXT/AGENTS 갱신과 전체 검증이 포함된다. PR 생성 시 저장소의 `pr-creator` 스킬 형식(업데이트 요약/상세 기술 설명/테스트 가이드)을 따른다.

---

## Chunk 1: PR A — 아케이드 기반 (Tasks 1–6)

### Task 1: DB 마이그레이션 + 계약 테스트

**Files:**
- Create: `DEVLOG/migrations/2026-07-13-playground-arcade-v1.sql`
- Create: `tests/playgroundArcadeDatabaseContract.test.ts`
- Modify: `package.json` (`test:playground`에 신규 테스트 추가 — 이후 task들도 생성 즉시 같은 방식으로 추가, 개별 언급 생략)

**마이그레이션 필수 내용 (순서대로):**

1. `BEGIN;` … `COMMIT;` 래핑, 파일 머리에 v2와 같은 형식으로 원칙·위협모델 주석(v2의 "ACCEPTED TEST-ONLY THREAT MODEL" 문단을 아케이드 문맥으로 요약 인용).
2. 원장 kind 확장:

```sql
ALTER TABLE public.playground_value_ledger
  DROP CONSTRAINT IF EXISTS playground_ledger_kind_valid;
ALTER TABLE public.playground_value_ledger
  ADD CONSTRAINT playground_ledger_kind_valid CHECK (
    kind IN (
      'initial-grant', 'favorite', 'read-reason', 'transfer', 'buy', 'sell',
      'game-entry', 'game-reward', 'scene-progress', 'comment', 'retake-done',
      'daily-login', 'achievement', 'arcade-grant'
    )
  );
```

3. 신규 테이블 3개 (v2와 동일한 스타일: `IF NOT EXISTS`, 정수 안전 CHECK, `user_id text REFERENCES public.users(id) ON DELETE CASCADE`):

```sql
CREATE TABLE IF NOT EXISTS public.playground_game_runs (
  id uuid PRIMARY KEY,                     -- 클라이언트 발급 runId
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  score bigint NOT NULL,
  grade text NOT NULL,
  duration_ms bigint NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb, -- lines/level/goldenEaten/maxLineClear 등
  reward_points bigint NOT NULL DEFAULT 0,
  was_alltime_best boolean NOT NULL DEFAULT false,
  entry_request_id text NOT NULL UNIQUE,   -- 'game-entry:<runId>' 원장 행과 1:1
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_run_game_valid CHECK (game_id IN ('snake', 'tetris', 'sudoku')),
  CONSTRAINT playground_run_grade_valid CHECK (grade IN ('none', 'bronze', 'silver', 'gold', 'platinum')),
  CONSTRAINT playground_run_score_range CHECK (score >= 0 AND score <= 9007199254740991),
  CONSTRAINT playground_run_duration_range CHECK (duration_ms >= 1000 AND duration_ms <= 14400000),
  CONSTRAINT playground_run_reward_range CHECK (reward_points >= 0 AND reward_points <= 9007199254740991)
);
CREATE INDEX IF NOT EXISTS playground_game_runs_leaderboard_idx
  ON public.playground_game_runs(game_id, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS playground_game_runs_user_idx
  ON public.playground_game_runs(user_id, game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.playground_achievement_unlocks (
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  reward_points bigint NOT NULL DEFAULT 0,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id),
  CONSTRAINT playground_achievement_id_valid CHECK (
    char_length(achievement_id) BETWEEN 1 AND 80 AND achievement_id = btrim(achievement_id)
  )
);

CREATE TABLE IF NOT EXISTS public.playground_arcade_config (
  id smallint PRIMARY KEY DEFAULT 1,
  slack_notify_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_arcade_config_singleton CHECK (id = 1)
);
INSERT INTO public.playground_arcade_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

4. RLS + 잠금 (v2 :147–162와 동일 패턴): 3개 테이블 `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL PRIVILEGES ... FROM anon, authenticated` + `FROM PUBLIC`.
5. RPC 2개. **v2의 `playground_market_read`/`playground_market_execute` 본문을 템플릿으로 복제**하되 아래 계약을 정확히 구현한다. 공통 하드닝(둘 다): `SECURITY DEFINER`, `SET search_path = ''`, canonical 배한솔 확인(v2 :172–180과 동일한 name+slack_id 단일 행 조회 후 `p_user_id::text` 일치 검증), execute는 `pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` + 지갑 행 `SELECT ... FOR UPDATE`, 원장 probe(`same`이면 저장된 `response_state`에 **`replayed: true`를 덧붙여** 반환 — replayed는 저장하지 않고 재생 시점에만 추가, `conflict`면 예외 "같은 요청이 다른 내용으로 이미 처리되었어요", `missing`이면 실행), 성공 시 `response_state`를 채워 원장 insert. 마지막에 `REVOKE ALL ON FUNCTION ... FROM PUBLIC/anon/authenticated` 후 `GRANT EXECUTE ... TO anon` (v2 :975–990 패턴).

**`playground_arcade_read(p_user_id uuid) RETURNS jsonb` 응답 계약 (camelCase 키):**

```jsonc
{
  "wallet": { "walletPoints": 999985, "lifetimeEarnedPoints": 1000020 },
  "attendance": { "streakDays": 3, "todayGranted": true },       // KST 기준, 원장 daily-login 행으로 계산
  "todayActivityCounts": { "sceneProgress": 4, "comment": 2, "retakeDone": 0 },
  "games": {
    "snake":  { "myBestScore": 34, "myWeeklyBestScore": 34, "todayRewardedRuns": 2, "totalRuns": 11,
                "leaderboardAll":    [{ "userId": "…", "name": "배한솔", "score": 34, "at": "2026-07-13T…" }],
                "leaderboardWeekly": [ /* 같은 shape, top5 */ ] },
    "tetris": { /* 동일 shape */ }
  },
  "achievements": [{ "achievementId": "arcade-first-run", "unlockedAt": "…" }],
  "aggregates": { "totalRuns": 23, "arcadeEarnedPoints": 380 },  // arcadeEarnedPoints = 적립형 kind 합계(scene-progress·comment·retake-done·daily-login·game-reward·achievement)
  "walletLeaderboard": [{ "userId": "…", "name": "배한솔", "lifetimeEarnedPoints": 1000020 }],
  "config": { "slackNotifyEnabled": false }
}
```

- KST 계산은 전부 `(now() AT TIME ZONE 'Asia/Seoul')::date`, 주간은 `date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')` (월요일 시작)과 `created_at AT TIME ZONE 'Asia/Seoul'` 비교.
- `streakDays`: 오늘(또는 어제)부터 역방향으로 연속된 `daily-login` 날짜 수. 오늘 미출석이면 어제까지의 연속을 반환.
- 리더보드는 사용자별 최고 1행만(`DISTINCT ON (user_id)` 후 score DESC, 동점은 created_at ASC 우선) top5.

**`playground_arcade_execute(p_user_id uuid, p_request_id text, p_kind text, p_payload jsonb) RETURNS jsonb` kind별 계약:**

| kind | request_id 형식(서버가 형식 검증) | payload | 동작 | 응답 |
|---|---|---|---|---|
| `daily-login` | `daily-login:<KST today>` — 서버가 오늘 날짜로 재계산해 불일치 시 예외 | `{}` | +20P (wallet+lifetime), 원장 kind `daily-login` | `{granted, wallet, attendance}` |
| `activity` | `scene-stage:<uuid>:<stage>` / `scene-phase-done:<uuid>` / `comment:<id>` / `retake-done:<id>` | `{ "activity": "scene-stage"\|"scene-phase-done"\|"comment"\|"retake-done" }` | 표(§spec 5-1) 포인트. 댓글은 `supabase:add-comment`를 지나는 모든 댓글(일반+리테이크+캐릭터 보드) 포함. **일일 상한 검사**: 같은 원장 kind의 오늘(KST) 행 수 ≥ 상한이면 지급 0으로 성공 응답(`capped: true`), 원장은 기록하지 않고 response도 저장하지 않음(멱등 키 소비 방지) — 단 이 경우 재시도에도 무해하므로 허용 | `{awarded, points, capped, wallet}` |
| `game-start` | `game-entry:<runId>` | `{ "runId", "gameId" }` | 입장료 차감(부족 시 예외 "포인트가 부족해 게임을 시작할 수 없어요"), 원장 kind `game-entry`(wallet_delta 음수) | `{wallet}` |
| `game-finish` | `game-finish:<runId>` | `{ "runId", "gameId", "score", "durationMs", "meta" }` | (1) `game-entry:<runId>` 원장 행 존재+본인 소유 확인 (2) runs PK 중복 없음 (3) score 상한(snake 441 / tetris 3,000,000)·duration 1s~4h 검증 — durationMs는 running 상태 고정 timestep 누적 합(카운트다운·일시정지 제외) (4) 등급=서버 CASE, 경계 **이상(>=)** 판정(§Task 2 표와 동일 수치·동일 비교연산) (5) 오늘 보상 판 수(`reward_points > 0`인 오늘 runs) < 5 이고 grade≠none이면 보상 지급, 아니면 0 (6) `was_alltime_best` = score가 이전 내 최고 **초과(>)**, 이전 기록 없으면 true — 계산 후 runs insert. `newWeeklyBest`도 같은 규칙을 주간 범위에 적용 (7) 원장 kind `game-reward`(보상 0이어도 insert — 멱등 키 유지) | `{grade, rewardPoints, rewardCapped, newAlltimeBest, newWeeklyBest, prevBestScore, myBestScore, todayRewardedRuns, wallet, slackNotifyEnabled}` — `slackNotifyEnabled`는 config 현재값, `prevBestScore`는 이전 최고(없으면 null, 슬랙 detail용) |
| `achievement-unlock` | `ach:<achievementId>` | `{ "achievementId" }` | 서버 내 고정 맵(id→보너스, §Task 2 표와 동일 10종)에 없는 id는 예외. unlocks insert(이미 있으면 probe가 same 처리) + 보너스 원장 kind `achievement` | `{achievementId, rewardPoints, wallet}` |
| `config-set` | `config:<uuid>` | `{ "slackNotifyEnabled": bool }` | config 행 UPDATE. **원장 미기록**(자연 멱등) | `{config}` |

6. 시드: 없음 (지갑은 v2가 이미 시드). 마이그레이션은 재실행 안전해야 함(`IF NOT EXISTS`/`ON CONFLICT DO NOTHING`, CHECK 재생성은 DROP 후 ADD라 재실행 시 실패하지 않도록 `DROP CONSTRAINT IF EXISTS` 사용).

**Steps:**

- [ ] **Step 1: 계약 테스트 작성** — `tests/playgroundMarketDatabaseContract.test.ts`의 방식(마이그레이션 SQL 텍스트를 읽어 regex로 계약 단언)을 복제. 단언 목록: 3개 테이블 DDL 존재와 핵심 CHECK(duration 하한 1000 포함), kind CHECK가 신규 8종 포함, RPC 2개 시그니처(`uuid` / `uuid, text, text, jsonb`), `SECURITY DEFINER`·`search_path`·advisory lock·`FOR UPDATE`·`GRANT EXECUTE ... TO anon` 존재, KST 표현식(`Asia/Seoul`) 존재, `replayed` 재생 필드 존재, 밸런스 수치(입장료 10/15, 등급 경계 15/25/40/55와 3000/10000/25000/50000이 **`>= 15` 같은 이상-비교 패턴으로** 존재, 보상 8/18/30/45와 12/30/55/80, 상한 5, 활동 포인트 20/5/10/5/30, 도전과제 보너스 맵)가 SQL 본문에 존재.
- [ ] **Step 2: RED 확인** — Run: `node --test ./tests/playgroundArcadeDatabaseContract.test.ts` → 파일 없음/단언 실패로 FAIL.
- [ ] **Step 3: 마이그레이션 SQL 작성** — 위 1~6 전부. v2 파일을 열어 probe/lock/canonical 확인 블록을 그대로 이식하며 함수명·키만 교체.
- [ ] **Step 4: GREEN 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `git add DEVLOG/migrations/2026-07-13-playground-arcade-v1.sql tests/playgroundArcadeDatabaseContract.test.ts package.json` / 메시지: `아케이드 포인트 DB 스키마와 RPC 계약 추가`
- [ ] **Step 6 (한솔 계정 라이브 적용은 별도)**: 마이그레이션은 PR 본문 "배포 후 할 일"에 기재만 하고 이 계획에서는 라이브 DB에 적용하지 않는다 (기존 관행: `DEVLOG/migrations/`에 기록 후 한솔/운영 세션에서 적용).

### Task 2: 밸런스 상수 + 순수 도메인

**Files:**
- Create: `src/features/playground/arcade/constants.ts`, `src/features/playground/arcade/types.ts`, `src/features/playground/arcade/domain.ts`
- Create: `tests/playgroundArcadeDomain.test.ts`

**constants.ts 전문(수치는 이 코드가 정본, SQL과 계약 테스트로 동기화):**

```ts
export type ArcadeGameId = 'snake' | 'tetris';
export type ArcadeGrade = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';

export const ARCADE_BALANCE = {
  dailyLoginPoints: 20,
  activity: {
    'scene-stage': { points: 5, dailyCap: 30, capKind: 'scene-progress' },
    'scene-phase-done': { points: 10, dailyCap: 30, capKind: 'scene-progress' },
    comment: { points: 5, dailyCap: 5, capKind: 'comment' },
    'retake-done': { points: 30, dailyCap: 5, capKind: 'retake-done' },
  },
  games: {
    snake: {
      entryFee: 10,
      scoreLabel: '길이',
      maxScore: 441,
      grades: [
        { grade: 'bronze', min: 15, reward: 8 },
        { grade: 'silver', min: 25, reward: 18 },
        { grade: 'gold', min: 40, reward: 30 },
        { grade: 'platinum', min: 55, reward: 45 },
      ],
    },
    tetris: {
      entryFee: 15,
      scoreLabel: '점수',
      maxScore: 3_000_000,
      grades: [
        { grade: 'bronze', min: 3_000, reward: 12 },
        { grade: 'silver', min: 10_000, reward: 30 },
        { grade: 'gold', min: 25_000, reward: 55 },
        { grade: 'platinum', min: 50_000, reward: 80 },
      ],
    },
  },
  dailyRewardedRunsCap: 5,
} as const;

export interface ArcadeAchievementDefinition {
  id: string;
  name: string;
  description: string;
  bonusPoints: number;
  game: ArcadeGameId | 'common';
}

export const ARCADE_ACHIEVEMENTS: readonly ArcadeAchievementDefinition[] = [
  { id: 'arcade-first-run', name: '첫 판', description: '아케이드 게임을 처음 완주했어요', bonusPoints: 10, game: 'common' },
  { id: 'arcade-runs-50', name: '단골 손님', description: '누적 50판을 플레이했어요', bonusPoints: 30, game: 'common' },
  { id: 'arcade-earned-5k', name: '티끌 모아', description: '적립 포인트 누적 5,000P를 모았어요', bonusPoints: 50, game: 'common' },
  { id: 'attend-7', name: '개근상', description: '7일 연속 출석했어요', bonusPoints: 50, game: 'common' },
  { id: 'snake-30', name: '몸집 불리기', description: '스네이크 길이 30을 달성했어요', bonusPoints: 15, game: 'snake' },
  { id: 'snake-55', name: '전설의 뱀', description: '스네이크 길이 55를 달성했어요', bonusPoints: 40, game: 'snake' },
  { id: 'snake-golden-5', name: '황금 미식가', description: '한 판에 골든 사과 5개를 먹었어요', bonusPoints: 20, game: 'snake' },
  { id: 'tetris-tetris', name: '테트리스!', description: '한 번에 4줄을 지웠어요', bonusPoints: 20, game: 'tetris' },
  { id: 'tetris-level-10', name: '고속 낙하', description: '레벨 10에 도달했어요', bonusPoints: 30, game: 'tetris' },
  { id: 'tetris-30k', name: '3만 클럽', description: '한 판에 30,000점을 넘겼어요', bonusPoints: 40, game: 'tetris' },
] as const;
```

**types.ts 필수 정의**: `ArcadeGameId`/`ArcadeGrade`(constants에서 re-export), `ArcadeSnapshot`(read 응답 미러), `ArcadeExecuteCommand`(kind별 union), `ArcadeExecuteResult`(kind별 서버 응답 union — 공통 옵션 필드 `replayed?: true`), `ArcadeFinishResult`(finishRun 반환 뷰모델 = game-finish 응답 + `unlockedAchievements: ArcadeAchievementDefinition[]`).

**domain.ts 시그니처:**

```ts
gradeForScore(gameId: ArcadeGameId, score: number): ArcadeGrade          // 경계 이상(>=) 판정 — SQL과 동일
rewardForGrade(gameId: ArcadeGameId, grade: ArcadeGrade): number
nextGradeInfo(gameId: ArcadeGameId, score: number): { grade: ArcadeGrade; remaining: number } | null // HUD "다음 등급까지 n"
evaluateAchievements(input: {
  gameId: ArcadeGameId | null;   // null = 게임 외 평가(스냅샷 load 후) — 공통 과제만 검사
  runMeta: { score: number; goldenEaten?: number; maxLineClear?: number; levelReached?: number } | null;
  runRewardPoints: number;       // 이번 런 지급 보상 (게임 외 평가면 0)
  aggregates: { totalRuns: number; arcadeEarnedPoints: number };  // 서버 스냅샷 = 이번 런 미포함 값
  attendanceStreakDays: number;
  unlockedIds: ReadonlySet<string>;
}): string[]                     // 새로 해금할 id 목록(정의 순서)
// 누적형 판정 규칙(내부에서 이번 런 반영): runsAfter = totalRuns + (runMeta ? 1 : 0),
// earnedAfter = arcadeEarnedPoints + runRewardPoints.
// arcade-first-run: runsAfter >= 1 (로드-시 평가에서도 완주 이력이 있으면 해금 — finish 직후 unlock 실패의 회복 경로) / arcade-runs-50: runsAfter >= 50 /
// arcade-earned-5k: earnedAfter >= 5000 / attend-7: attendanceStreakDays >= 7.
```

**Steps:**

- [ ] **Step 1: 실패 테스트 작성** — 경계값 전수: `gradeForScore('snake', 14) === 'none'`, `15→bronze`, `54→gold`, `55→platinum`; tetris 동일; `nextGradeInfo('snake', 20) => { grade: 'silver', remaining: 5 }`, platinum 이후 `null`; evaluateAchievements: 첫 판(totalRuns 0 + runMeta 존재 → 'arcade-first-run' 포함), 누적 경계(totalRuns 49 + runMeta 존재 → 'arcade-runs-50' 해금, 48이면 미해금), earned 경계(arcadeEarnedPoints 4980 + runRewardPoints 20 → 'arcade-earned-5k' 해금), 게임 외 평가(gameId null → 게임 과제 제외·공통 과제만), 이미 해금된 id 제외, `goldenEaten: 5 → 'snake-golden-5'`, `maxLineClear: 4 → 'tetris-tetris'`, `attendanceStreakDays: 7 → 'attend-7'`, 복수 동시 해금 시 정의 순서 유지.
- [ ] **Step 2: RED** — `node --test ./tests/playgroundArcadeDomain.test.ts`
- [ ] **Step 3: 구현** — constants 전문 그대로 + domain 순수 함수.
- [ ] **Step 4: GREEN + 커밋** — 메시지: `아케이드 밸런스 상수와 등급·도전과제 도메인 추가`

### Task 3: 타입 + 게이트웨이 (electron/localStorage/preview)

**Files:**
- Create: `arcade/gateway.ts`, `electronGateway.ts`, `localStorageGateway.ts`, `previewGateway.ts`, `seed.ts` (모두 `src/features/playground/arcade/`)
- Modify: `src/mocks/devElectronAPI.ts`
- Create: `tests/playgroundArcadeGateway.test.ts` (주의: `tests/devPreviewElectronApi.test.ts`는 어떤 npm 스크립트/tsconfig에도 포함되지 않으므로 수정하지 않는다 — devElectronAPI 목 3종 존재 단언은 `playgroundArcadeGateway.test.ts`에 넣는다)

모의투자 게이트웨이 5종(`src/features/playground/market/gateway.ts` 등)을 구조 그대로 복제한다. 인터페이스:

```ts
export interface ArcadePreviewGateway {
  read(): Promise<ArcadeSnapshot>;
  execute(command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult>;
}
```

- `electronGateway`: `window.electronAPI.arcadeRead()` / `arcadeExecute(command)` 위임.
- `localStorageGateway`: 키 `bflow-arcade-preview-v1`. `seed.ts` 시드 — 지갑 12,500P/lifetime 48,200P, 팀원 리더보드(민지 4,920 / 도윤 3,860 / 서아 2,820 / 유진 2,115 — `ranking.ts`에서 제거되는 fixture를 여기로 이사), 스네이크/테트리스 가짜 상위 기록 각 3행, 해금 도전과제 `['arcade-first-run']`, streak 3. execute는 도메인 함수로 실제 규칙(입장료/등급/상한/멱등 request_id 중복 무시)을 로컬에서 재현 — 프리뷰 모드에서도 실제와 같은 흐름 검증 가능해야 한다.
- `gateway.ts`: 모의투자와 같은 기준으로 electron/preview 선택.
- `devElectronAPI.ts`: `arcadeRead`/`arcadeExecute`/`onArcadeWalletUpdated`(no-op unsubscribe 반환) 목 추가 — localStorage 게이트웨이로 위임.

**Steps:**

- [ ] **Step 1: 실패 테스트** — localStorage 게이트웨이: 시드 로드, `game-start` 잔액 차감, 같은 request_id 재실행 시 상태 불변 + 응답 `replayed: true`(멱등), 잔액 부족 예외 메시지, `game-finish` 등급·보상·`newAlltimeBest` 계산, 일일 보상 5회 초과 시 `rewardCapped: true`·보상 0. devElectronAPI 목에 arcade 3종 API 존재.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: 커밋** — `아케이드 게이트웨이와 프리뷰 시드 추가`

### Task 4: Electron main — supabase 함수, arcadeService, IPC, preload, 출석 훅

**Files:**
- Create: `electron/arcadeService.ts`
- Modify: `electron/supabase.ts` (RPC 호출 함수 2개), `electron/main.ts` (서비스 초기화 + `ipcMain.handle('arcade:read'|'arcade:execute')` + `setCanonicalActivityUser`에 출석 훅), `electron/preload.ts` (`arcadeRead`/`arcadeExecute`/`onArcadeWalletUpdated`)
- Create: `tests/playgroundArcadeMainWiring.test.ts`

**계약:**

- `electron/supabase.ts`: `sbReadPlaygroundArcadeState(userId)` → `supabase.rpc('playground_arcade_read', { p_user_id })`, `sbExecutePlaygroundArcade(userId, requestId, kind, payload)` → `supabase.rpc('playground_arcade_execute', …)`. 기존 `readPlaygroundMarketState`(≈:2856)와 같은 오류 래핑 스타일.
- `arcadeService.ts` (모의투자 `marketAccountService.ts`의 축소 복제):
  - 의존성 주입 생성자: `{ read, execute, resolveActor, broadcastWalletUpdate, sendSlackRecord, log }` — node:test에서 전부 목 주입 가능해야 한다.
  - 사용자별 FIFO 큐(`createMarketMutationQueue` 패턴 복제)로 execute 직렬화.
  - `read(userId)`, `execute(userId, command)` — 네트워크 오류 1회 재시도(같은 request_id, 서버 멱등에 의존).
  - `awardActivity(input: { activity, refId, stage? })`: actor = `resolveActor()`(= main의 `currentActivityUser`). actor 없음/비-canonical이면 no-op. request_id를 §spec 5-1 표 규칙으로 조립해 `activity` execute 호출. **`!result.replayed` && `awarded && points > 0`일 때만** `broadcastWalletUpdate({ wallet, delta: points, reason: activity })` — 재생 응답(재체크·재시도)은 push하지 않는다(가짜 "+N P"·스테일 지갑 방지).
  - `grantDailyLogin()`: KST 오늘 문자열로 request_id 조립 후 execute. 앱 세션당 사용자+날짜별 1회만 시도하되 **메모리 Set 등록은 성공 시에만**(자정 경계 등으로 예외가 나면 다음 트리거에서 재시도 가능). 서버 멱등이 최종 방어. 신규 지급(`!replayed`)일 때만 broadcast.
  - game-finish execute 응답이 `newAlltimeBest && slackNotifyEnabled && !replayed`이면 `sendSlackRecord({ title, detail, player })` fire-and-forget — 둘 다 **응답 필드**라 config 캐시 불필요. detail은 `prevBestScore`로 조립(없으면 "첫 기록"). (Task 13에서 URL 연결, 여기서는 의존성 호출만.)
- `main.ts`: `ensureCanonicalMarketAccess()`와 동일한 게이트를 재사용(또는 동일 로직의 `ensureCanonicalArcadeAccess()` — 기존 함수가 market 전용 네이밍이면 새 이름으로 복제)해 두 핸들러 보호. `arcade:wallet-updated`는 `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))`.
- `preload.ts`: 기존 market 브릿지(≈:299–307) 바로 아래에 동일 스타일로 3개 추가. `onArcadeWalletUpdated(cb)`는 구독 해제 함수를 반환.
- KST 날짜 유틸: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())` → `YYYY-MM-DD`.

**Steps:**

- [ ] **Step 1: 실패 테스트** — arcadeService를 목 의존성으로 생성해: 비-canonical actor의 awardActivity가 execute를 호출하지 않음 / request_id 조립 규칙 4종 정확 일치 / grantDailyLogin 같은 날 2회 호출 시 execute 1회·실패 후엔 재시도 허용(Set은 성공 시에만 등록) / execute 네트워크 오류 1회 재시도 후 성공 / awarded 응답 시 broadcastWalletUpdate 호출 payload 검증 / capped 응답 시 broadcast 미호출 / **`replayed: true` 응답 시 broadcast·슬랙 모두 미호출**.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: typecheck** — `npm run typecheck` (electron tsconfig 포함 확인)
- [ ] **Step 6: 커밋** — `아케이드 메인 서비스와 IPC 배선 추가`

### Task 5: useArcadeStore + 지갑 브릿지 + 마켓 스토어 패치 액션

**Files:**
- Create: `src/features/playground/arcade/useArcadeStore.ts`, `src/features/playground/arcade/walletBridge.ts`
- Modify: `src/features/playground/market/useMarketPreviewStore.ts` (`applyServerWallet` 액션)
- Create: `tests/playgroundArcadeStore.test.ts`

**스토어 계약 (모의투자 스토어 패턴 준수 — confirmed/visible 이중 스냅샷은 불필요, 아케이드는 단일 `snapshot` + mutation 중 `mutating` 플래그):**

```ts
interface ArcadeState {
  snapshot: ArcadeSnapshot | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  sessionKey: string | null;
  load(sessionKey?: string): Promise<void>;
  startRun(gameId: ArcadeGameId): Promise<{ runId: string } | null>;   // 실패 시 error 세팅 + null
  finishRun(input: { runId: string; gameId: ArcadeGameId; score: number; durationMs: number; meta: Record<string, number> }):
    Promise<ArcadeFinishResult | null>;                                 // 응답으로 snapshot 갱신 + 도전과제 평가·unlock 실행
                                                                        // 평가 입력: aggregates는 갱신 "전" 스냅샷 값(이번 런 미포함), runRewardPoints = 응답 rewardPoints
  setSlackNotify(enabled: boolean): Promise<boolean>;
  applyWalletPush(update: { wallet: ArcadeWallet; delta: number; reason: string }): void;
  clearError(): void;
}
```

- `finishRun` 성공 후: (1) 갱신 **전** aggregates를 캡처해 `evaluateAchievements` 입력으로 사용 (2) snapshot의 wallet/기록/leaderboard/todayRewardedRuns/aggregates(totalRuns+1, arcadeEarnedPoints+rewardPoints) 갱신 (3) 신규 해금마다 `achievement-unlock` execute(실패는 무시하고 다음 로드에서 재평가) 후 해금 보너스를 wallet과 `aggregates.arcadeEarnedPoints`에 모두 반영 (4) 결과에 `unlockedAchievements: ArcadeAchievementDefinition[]` 포함해 반환 — RunResultOverlay가 그대로 표시.
- `load()` 성공 후: `evaluateAchievements({ gameId: null, runMeta: null, runRewardPoints: 0, … })`로 공통 과제(attend-7, arcade-earned-5k 등)를 평가해 미해금분 unlock — 게임을 하지 않아도 출석·적립 과제가 해금되게.
- 모든 execute 성공 응답의 wallet과 `applyWalletPush`는 `useMarketPreviewStore.getState().applyServerWallet(wallet)`도 함께 호출한다(플레이그라운드 헤더 잔액 동기화).
- `applyServerWallet(wallet)`: confirmed/visible 각각 존재할 때 `account.walletPoints`/`lifetimeEarnedPoints`만 교체한 새 스냅샷으로 set.
- `walletBridge.ts`: `initArcadeWalletBridge()` — `window.electronAPI.onArcadeWalletUpdated` 구독을 앱에서 1회 등록(중복 등록 가드), 콜백에서 두 스토어 갱신. 반환값으로 해제 함수.

**Steps:**

- [ ] **Step 1: 실패 테스트** — 목 게이트웨이 주입 스토어 팩토리(모의투자 `createMarketPreviewStore` 패턴): load 스냅샷 반영 / startRun 잔액 부족 오류 메시지 세팅·null 반환 / finishRun이 unlock execute를 신규 해금 수만큼 호출 / applyWalletPush가 market 스토어 `applyServerWallet`과 함께 동작(스파이) / 동일 세션키 재로드 시 중복 로딩 방지.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: 커밋** — `아케이드 스토어와 지갑 동기화 브릿지 추가`

### Task 6: 헤더 포인트 배지 + 포인트 랭킹 실데이터 + PR A 마무리

**Files:**
- Create: `src/components/layout/HeaderPointsBadge.tsx` / Create: `tests/playgroundHeaderPointsBadge.test.ts`
- Modify: `src/components/layout/Header.tsx` (우상단 클러스터 ≈:51 — `NotificationBell`과 구분선 사이에 배지 삽입)
- Modify: `src/features/playground/ranking.ts`, `src/views/PlaygroundView.tsx`
- Modify: `package.json`(1.84.0), `DEVLOG/update-notes.json`, `ROADMAP.md`, `CONTEXT.md`, `AGENTS.md`

**배지 스펙 (목업 §헤더 배지 참조):**

- 노출 조건: `canAccessPlayground(currentUser)`(기존 `featureFlag.ts`). 미충족 시 렌더 안 함.
- 마운트 시 arcade store `load(currentUser.id)`(이미 로드됐으면 no-op) + `initArcadeWalletBridge()` 1회.
- 표시: `1,234,567 P` (ko-KR 천단위, `font-variant-numeric: tabular-nums`), 로딩/오류 시 `— P`. 클릭 → `useAppStore.getState().setView('playground')`. `aria-label="보유 포인트 …, 배플레이그라운드 열기"`.
- 획득 연출(+N 플로팅·펄스)은 PR B(Task 7)에서 — 이 task는 정적 배지까지.
- 스타일: Tailwind 다크 토큰(카드 #1A1D27, 보더 #2D3041, 액센트 #6C5CE7 계열) — 헤더의 기존 버튼들과 동일한 높이/radius.

**랭킹 실데이터:**

- `ranking.ts`: `TEAMMATES` 상수 삭제. `buildPointRanking(user, teammates: readonly { id, name, lifetimeEarnedPoints: number | null }[])`로 변경 — 정렬·동점·상태문구 로직 유지. **null 처리 규칙**: `lifetimeEarnedPoints === null`인 팀원은 항상 최하단에 이름순(ko-KR collator)으로 배치하고 rank/points는 null(표시 '—') — 기존 comparator에 null이 섞이면 NaN 정렬이 되므로 non-null 그룹 정렬 후 null 그룹을 이어 붙인다.
- `PlaygroundView.tsx`: 아케이드 스냅샷 load(마운트 시) 후 `walletLeaderboard` + `useAuthStore.users`(지갑 없는 팀원 → `lifetimeEarnedPoints: null`)를 합성해 전달. 스냅샷 없으면 기존 '순위 계산 중' 경로.

**Steps:**

- [ ] **Step 1: 실패 테스트** — **테스트 방식 주의**: 이 레포에는 jsdom/@testing-library가 없다. 컴포넌트 배선은 기존 `playgroundV3UiWiring.test.ts`처럼 소스 파일 텍스트 정규식 단언으로(게이트 조건·setView('playground') 호출·`— P` 폴백·tabular-nums 존재), 로직(포인트 포맷 함수)은 순수 함수로 분리해 node:test로 직접 검증. 랭킹: teammates 주입 시그니처로 기존 케이스(1위/동점/차이 문구) 재검증 + null 팀원 최하단 이름순 배치 + fixture 상수 부재 확인.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: PR A 전체 검증** — Run: `npm run typecheck && npm run test:playground && npm run build:vite` → 모두 PASS.
- [ ] **Step 6: 문서·버전** — package.json 1.84.0, update-notes(예: "이제 화면 오른쪽 위에 내 포인트가 항상 보여요. 매일 처음 앱을 켜면 출석 포인트도 쌓여요" 톤), ROADMAP 배플레이그라운드 섹션 체크 갱신, CONTEXT/AGENTS의 파일 맵에 arcade 추가.
- [ ] **Step 7: 커밋 + PR** — 메시지: `아케이드 포인트 기반과 우상단 포인트 배지 (v1.84.0)`. PR 본문은 pr-creator 형식, "배포 후 할 일: `2026-07-13-playground-arcade-v1.sql` 라이브 적용 필요" 명시.

---

## Chunk 2: PR B — 업무 활동 적립 (Task 7)

### Task 7: 활동 훅 3종 + 배지 획득 연출

**Files:**
- Modify: `electron/main.ts` — 훅 4곳:
  - `supabase:update-scene-stage` 핸들러(≈:1944, `logSceneActivity` 직후): `value === true`일 때 `void arcadeService.awardActivity({ activity: 'scene-stage', refId: sceneUuid, stage })`
  - `supabase:update-scene-phase` 핸들러(≈:1956): `sceneState === 'done'`일 때 `scene-phase-done`
  - `supabase:add-comment` 핸들러(≈:2277, 활동 로그 직후): `comment`(commentId 사용)
  - 리비전 상태 핸들러(≈:2488–2492): actionType이 `revision_assignee_done`으로 매핑될 때 `retake-done`(revisionId 사용)
  - **주의**: `supabase:bulk-update-scene-stages`(≈:1986)에는 훅을 넣지 않는다.
- Create: `src/features/playground/arcade/badgeFloatQueue.ts` — 플로팅 표시 큐 **순수 모듈**(enqueue(delta) → 표시 항목 배열, 최대 3개 대기·초과분은 마지막 항목에 합산, pop 규칙 포함) — node:test로 직접 검증 가능해야 한다.
- Modify: `src/components/layout/HeaderPointsBadge.tsx` — `applyWalletPush` 수신 시: 배지 펄스(scale 1→1.06→1) + `+{delta}P` 플로팅 라벨(framer-motion, 1.2s 상승 페이드)을 badgeFloatQueue로 순차 표시. `prefers-reduced-motion`이면 즉시 갱신만.
- Modify: `tests/playgroundArcadeMainWiring.test.ts`(훅 조건 케이스 추가), `tests/playgroundHeaderPointsBadge.test.ts`(연출 상태 전이)
- Modify: `package.json`(1.85.0), `DEVLOG/update-notes.json`, `ROADMAP.md`

**Steps:**

- [ ] **Step 1: 실패 테스트** — main wiring: stage=false(체크 해제)는 award 미호출 / phase='work'는 미호출·'done'만 호출 / bulk 경로 미호출 / revision_reassign 미호출·assignee_done만 호출. badgeFloatQueue(순수): push 3연속 시 큐 길이 3, 4번째는 마지막에 합산, pop 순서. 배지 JSX 배선은 정규식 단언.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: 수동 검증(프리뷰 불가 영역)** — `npm run electron:dev`로 실제 실행 후 씬 체크 1회 → 배지 +5P 연출과 다음 read 반영 확인. 결과를 PR 본문 테스트 가이드에 기록.
- [ ] **Step 6: PR B 검증·문서·커밋** — typecheck/test:playground/build:vite, 1.85.0, update-notes("씬을 완료하거나 댓글을 달면 포인트가 쌓이고, 오른쪽 위 배지가 살짝 반짝이며 알려줘요" 톤). 메시지: `업무 활동 포인트 적립 훅과 배지 연출 (v1.85.0)`

---

## Chunk 3: PR C — 스네이크 + 공용 스테이지 (Tasks 8–10)

### Task 8: 스네이크 엔진 (순수)

**Files:**
- Create: `src/features/playground/arcade/games/prng.ts`, `games/snake/types.ts`, `games/snake/engine.ts`
- Create: `tests/playgroundSnakeEngine.test.ts`

**규칙 전문 (스펙 §8과 동일 — 구현은 이 표가 정본):**

| 항목 | 값 |
|---|---|
| 그리드 | 21×21, x 0–20 좌→우, y 0–20 상→하 |
| 시작 | 몸 `[(10,10),(9,10),(8,10),(7,10)]`(머리 첫 번째), 방향 동(+1,0), 길이 4 |
| 틱 | 시작 160ms, 사과당 −4ms, 하한 80ms |
| 입력 | 방향 큐 최대 2개. 큐가 가득이면 무시. 각 틱에 큐에서 1개 꺼내 적용하되 현재 진행 방향의 정반대면 버리고 다음 것도 보지 않는다(그 틱은 기존 방향 유지) |
| 사과 | 빈 칸 중 균등 선택: `floor(random() * freeCells.length)` (freeCells는 y·x 오름차순 정렬). 먹은 개수가 5의 배수가 되는 사과(5,10,…번째로 먹히는 사과)는 스폰 시점부터 골든 |
| 성장 | 일반 +1, 골든 +2 (꼬리 유지 방식: 성장 수만큼 틱에서 꼬리 제거 생략) |
| 죽음 | 다음 머리 위치가 벽 밖 또는 몸(꼬리가 이번 틱에 빠지는 칸은 제외) |
| score | 최종 길이. `goldenEaten` 카운트 meta 보고 |

**엔진 인터페이스:**

```ts
createSnakeGame(seed: number): SnakeState
enqueueDirection(state: SnakeState, dir: 'up' | 'down' | 'left' | 'right'): SnakeState
stepSnake(state: SnakeState): SnakeState   // 1틱 진행. state.status: 'running' | 'dead'
// SnakeState: { grid: 21, body: Point[], dir, queue, apple: { pos, golden }, eaten, goldenEaten,
//               tickMs, status, length }  — 모두 불변 업데이트
```

**Steps:**

- [ ] **Step 1: 실패 테스트** — 고정 시드로: 초기 상태 정확성 / 4틱 직진 후 머리 (14,10) / 반대방향 입력 무시 / 사과 취식 시 길이 +1·tickMs 156 / 5번째 사과 골든·길이 +2 / 벽 충돌 dead / 자기 몸 충돌 dead / 꼬리 빠지는 칸 진입은 생존 / 같은 시드 두 판 deep-equal(결정론).
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN → Step 5: 커밋** — `스네이크 순수 엔진 추가`

### Task 9: 공용 스테이지 셸 + 게임 루프 + 결과 오버레이

**Files:**
- Create: `src/features/playground/arcade/games/loop.ts`
- Create: `src/views/playground/arcade/ArcadeStageChrome.tsx`, `RunResultOverlay.tsx`, `arcade.css`
- Create: `tests/playgroundArcadeUiWiring.test.ts`(시작)

**계약 (목업의 화면 구조·상태 전환이 시각 기준):**

- `loop.ts`: `createFixedStepLoop({ stepMs, onStep, onFrame })` — rAF 누적기, `start/pause/resume/stop`, hidden/blur 자동 pause 콜백 노출. stepMs는 매 스텝 후 변경 가능(스네이크 가속).
- `ArcadeStageChrome`: props `{ game: PlaygroundGameDefinition; phase: 'ready'|'countdown'|'running'|'paused'|'finishing'|'result'; hud: ReactNode; stage: ReactNode; result?: ReactNode; onStart/onResume/onQuit; startDisabledReason?: string; todayRewardedRuns: number; entryFee: number; keyHints: readonly { key: string; label: string }[] }`.
  - ready: 규칙 요약 + 키 안내 + "오늘 보상 가능 {5-n}/5" + `{fee}P 내고 시작` 버튼(잔액 부족 시 disabled + 사유). countdown: 3→2→1 오버레이(각 700ms). paused: 반투명 오버레이 + 재개/나가기. `aria-live="polite"` 상태 텍스트 1개 유지.
  - 진행 중 뒤로가기: `PlaygroundBackProvider`의 인터셉터 스택(`src/features/playground/backInterception.ts` — JbbjHouse 쪽 사용례 참고)에 등록해 "게임을 종료할까요? 입장료는 돌려받지 못해요" 확인 모달. running/paused/countdown에서만 인터셉트, ready/result는 통과.
- `RunResultOverlay`: props `{ gameId, result: ArcadeFinishResult, scoreLabel, onReplay, onExit, replayDisabledReason? }`. 연출 순서(모두 reduced-motion 대체 있음): 등급 게이지 채움(560ms) → 등급명 스탬프 → 보상 카운트업(0→n, 480ms) → `newAlltimeBest`면 "신기록!" 배너 → 해금 도전과제 카드 순차 등장(120ms 스태거). `rewardCapped`면 보상 자리에 "오늘 보상 한도에 도달했어요 (5/5)".
- `arcade.css`: `--pg-*` 토큰만 사용, 클래스 접두 `pg-arcade-`.

**Steps:**

- [ ] **Step 1: 실패 테스트** — loop: 고정 스텝 누적(stepMs 160에서 33ms 프레임 4회 → step 0회, 5회째(누적 165ms) → 1회), pause 중 시간 미누적, stepMs 변경 반영. chrome: phase별 필수 요소 존재(테스트는 기존 `playgroundV3UiWiring.test.ts`의 JSX 문자열/구조 검사 방식을 따른다), 잔액 부족 disabled, back 인터셉터 등록/해제 시점.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN → Step 5: 커밋** — `아케이드 공용 스테이지 셸과 결과 오버레이 추가`

### Task 10: SnakeStage 통합 + 라우트 개명 + 로비 연동 + PR C 마무리

**Files:**
- Create: `src/views/playground/arcade/SnakeStage.tsx`, `GameHost.tsx`
- Modify: `src/features/playground/routes.ts`(`'coming-soon'` → `'game'`), `src/views/PlaygroundView.tsx`(GameHost 렌더 + 스냅샷/도전과제 토스트 연결). 참고: 'coming-soon' 문자열 실참조는 routes.ts, PlaygroundView.tsx, tests/playgroundRoutes·playgroundTransition·playgroundV3UiWiring 5개 파일(2026-07-13 grep 기준)이며, `src/features/playground/history.ts`와 `transition/playgroundTransitionPolicy.ts`는 kind 문자열을 직접 참조하지 않지만 타입 추론으로 영향받을 수 있으니 typecheck로 확인. 추가 Modify: `src/features/playground/catalog.ts`(카피 갱신 — 스네이크 `heroMeta: '평균 3분 · 내 최고 기록은 카드에서 바로 보여요'` 류, `stageReward`를 확정 보상표 문구로), `PlaygroundGameCard.tsx`/`PlaygroundRecommendationHero.tsx`(`record?: string` prop — 내 최고 기록 오버레이, 없으면 "아직 기록이 없어요"), `JbbjHouse.tsx`(구현 게임 상태 문구 "바로 플레이")
- Modify: 기존 테스트 — `grep -rn "coming-soon" src tests` 전수 치환 (2026-07-13 기준 실참조: `tests/playgroundRoutes.test.ts`, `tests/playgroundTransition.test.ts`, `tests/playgroundV3UiWiring.test.ts`)
- Modify: `tests/playgroundArcadeUiWiring.test.ts`(SnakeStage/GameHost 케이스), `package.json`(1.86.0), update-notes, ROADMAP/CONTEXT/AGENTS

**SnakeStage 계약:**

- 캔버스 21×21(셀 20px 기준, DPR 스케일, 컨테이너에 맞춰 축소). 스네이크 몸은 라운드 사각형, 머리 밝게, 골든 사과는 `--pg-yellow` 발광. HUD: 길이(=score) / 다음 등급까지 / 골든 카운트 / 내 최고.
- 키: 화살표+WASD(`keydown`에서 `preventDefault`) → `enqueueDirection`. P/Esc 일시정지.
- 흐름: ready에서 시작 클릭 → `useArcadeStore.startRun('snake')` 성공 시 countdown → 엔진 생성(시드 발급) → 루프. dead → `finishRun({ score: length, meta: { goldenEaten } })` → result. 다시 하기 = 새 runId로 ready부터.
- `GameHost`: `route.game`이 'snake'(PR D 이후 'tetris' 포함)면 해당 스테이지, 아니면(sudoku) 기존 `ComingSoonGame`.
- 도전과제 토스트: `finishRun` 결과의 `unlockedAchievements`를 sonner 커스텀 토스트("도전과제 달성! {name} +{bonus}P")로 — PlaygroundView 레벨에서 표시.

**Steps:**

- [ ] **Step 1: 실패 테스트** — routes: `navigatePlayground(…, { kind: 'open-game', game: 'snake' })`가 `{ kind: 'game', … }` 반환 + 기존 route 테스트 전수 갱신. GameHost 분기(snake→스테이지, sudoku→ComingSoon). 카드 record prop 오버레이.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: 프리뷰 실측** — `npm run dev:renderer` 후 `http://localhost:5190/?preview=1`(배한솔/1234 로그인) → 로비→스네이크 진입→한 판 완주→결과/보상/기록 반영을 실제 조작으로 확인. 콘솔 오류 0 확인.
- [ ] **Step 6: PR C 검증·문서·커밋** — typecheck/test:playground/build:vite, 1.86.0, update-notes("이제 스네이크를 진짜로 플레이할 수 있어요. 포인트를 내고 시작해서 등급에 따라 더 크게 돌려받아요" 톤). 메시지: `스네이크 게임과 보상·도전과제 흐름 (v1.86.0)`

---

## Chunk 4: PR D — 테트리스 + 랭킹/슬랙 (Tasks 11–13)

### Task 11: 테트리스 엔진 (순수)

**Files:**
- Create: `src/features/playground/arcade/games/tetris/types.ts`, `tetris/pieces.ts`, `tetris/srs.ts`, `tetris/bag.ts`, `tetris/engine.ts`
- Create: `tests/playgroundTetrisEngine.test.ts`

**규칙 전문 (이 표·데이터가 정본):**

- 보드: 폭 10(x 0–9), 총 22행(y 0 상단, y 0–1 숨김, 가시 y 2–21). y는 아래로 증가.
- 조각 셀 데이터(`pieces.ts`): 회전 상태 `0/R/2/L` 순. JLSTZ·T는 3×3 박스, I는 4×4, O는 고정. 박스 로컬 `(col,row)`:

```
T: 0=(1,0)(0,1)(1,1)(2,1)  R=(1,0)(1,1)(2,1)(1,2)  2=(0,1)(1,1)(2,1)(1,2)  L=(1,0)(0,1)(1,1)(1,2)
J: 0=(0,0)(0,1)(1,1)(2,1)  R=(1,0)(2,0)(1,1)(1,2)  2=(0,1)(1,1)(2,1)(2,2)  L=(1,0)(1,1)(0,2)(1,2)
L: 0=(2,0)(0,1)(1,1)(2,1)  R=(1,0)(1,1)(1,2)(2,2)  2=(0,1)(1,1)(2,1)(0,2)  L=(0,0)(1,0)(1,1)(1,2)
S: 0=(1,0)(2,0)(0,1)(1,1)  R=(1,0)(1,1)(2,1)(2,2)  2=(1,1)(2,1)(0,2)(1,2)  L=(0,0)(0,1)(1,1)(1,2)
Z: 0=(0,0)(1,0)(1,1)(2,1)  R=(2,0)(1,1)(2,1)(1,2)  2=(0,1)(1,1)(1,2)(2,2)  L=(1,0)(0,1)(1,1)(0,2)
I: 0=(0,1)(1,1)(2,1)(3,1)  R=(2,0)(2,1)(2,2)(2,3)  2=(0,2)(1,2)(2,2)(3,2)  L=(1,0)(1,1)(1,2)(1,3)
O: 전 상태 (1,0)(2,0)(1,1)(2,1) — 회전해도 불변, 킥 없음
```

- 스폰: 박스 원점 보드 `(3,0)` (I도 (3,0)). 스폰 셀이 기존 블록과 겹치면 즉시 게임 오버(block out).
- SRS 킥(`srs.ts`): **아래 표는 y-down 좌표로 이미 변환된 값**(표준 SRS의 +y↑를 반전). 순서대로 5개 오프셋을 시도, 전부 실패면 회전 취소.

```
JLSTZ/T:
0→R: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
R→0: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)
R→2: (0,0) (+1,0) (+1,+1) (0,-2) (+1,-2)
2→R: (0,0) (-1,0) (-1,-1) (0,+2) (-1,+2)
2→L: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
L→2: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
L→0: (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)
0→L: (0,0) (+1,0) (+1,-1) (0,+2) (+1,+2)
I:
0→R: (0,0) (-2,0) (+1,0) (-2,+1) (+1,-2)
R→0: (0,0) (+2,0) (-1,0) (+2,-1) (-1,+2)
R→2: (0,0) (-1,0) (+2,0) (-1,-2) (+2,+1)
2→R: (0,0) (+1,0) (-2,0) (+1,+2) (-2,-1)
2→L: (0,0) (+2,0) (-1,0) (+2,-1) (-1,+2)
L→2: (0,0) (-2,0) (+1,0) (-2,+1) (+1,-2)
L→0: (0,0) (+1,0) (-2,0) (+1,+2) (-2,-1)
0→L: (0,0) (-1,0) (+2,0) (-1,-2) (+2,+1)
```

- `bag.ts`: 7-bag — 7종 셔플(Fisher–Yates, 주입 PRNG) 소진 후 재충전. Next 5 노출.
- 중력(레벨 1–15 ms/행): `[1000, 850, 720, 600, 490, 390, 310, 240, 180, 140, 105, 80, 60, 45, 35]`, 레벨 = `min(15, floor(누적 라인/10)+1)`.
- 소프트드롭 50ms/행(+1점/칸), 하드드롭 즉시(+2점/칸, 즉시 고정·락 딜레이 무시).
- 락 딜레이: 접지 상태 500ms 후 고정. 이동/회전 성공 시 리셋, 피스당 최대 15회, 초과 시 접지 즉시 고정.
- 점수: 1/2/3/4줄 = 100/300/500/800 × 레벨. 콤보: 라인을 지운 락이 연속되면 `50 × 콤보수 × 레벨`(첫 클리어 콤보수 0, 이후 1,2,…), 클리어 없는 락에서 리셋. T-spin/B2B 없음.
- Hold: C키, 피스당 1회. 홀드 교체 피스는 스폰 위치에서 시작.
- 게임 오버: block out. `meta` 보고: `{ lines, levelReached, maxLineClear }`.

**엔진 인터페이스 (스네이크와 같은 불변 스타일):**

```ts
createTetrisGame(seed: number): TetrisState
tickTetris(state: TetrisState, elapsedMs: number): TetrisState        // 중력·락딜레이 진행
applyTetrisInput(state: TetrisState, input:
  'left' | 'right' | 'softDropOn' | 'softDropOff' | 'rotateCw' | 'rotateCcw' | 'hardDrop' | 'hold'): TetrisState
// TetrisState: { board, active: { piece, rotation, x, y }, hold, holdUsed, queue(next 5 보장),
//               bag, level, lines, score, combo, lockElapsedMs, lockResets, status, stats: { maxLineClear, levelReached } }
```

**Steps:**

- [ ] **Step 1: 실패 테스트** — 고정 시드: 7-bag 14개에 7종×2 / T 스폰 셀 (4,0)(3,1)(4,1)(5,1) / 벽에 붙은 T의 0→R 회전이 킥 2번째 (-1,0)로 성공하는 구체 배치 / I 킥 케이스 1개 / 4줄 클리어 800×레벨 + `maxLineClear: 4` / 콤보 점수 / 소프트·하드드롭 가산 / 락 리셋 15회 초과 강제 고정 / 레벨 10 진입 시 중력 140ms / block out 게임 오버 / 같은 시드 결정론.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN → Step 5: 커밋** — `테트리스 순수 엔진 추가 (SRS·7백·콤보)`

### Task 12: TetrisStage + DAS/ARR 입력

**Files:**
- Create: `src/views/playground/arcade/TetrisStage.tsx`, `src/features/playground/arcade/games/keymap.ts`
- Modify: `src/views/playground/arcade/GameHost.tsx`(tetris 분기), `tests/playgroundArcadeUiWiring.test.ts`

**계약:**

- `keymap.ts`: DAS/ARR 상태기 — `keydown`(repeat 무시)으로 즉시 1회 이동, 160ms 유지 시 40ms 간격 반복. 좌우 동시엔 나중 키 우선. 프레임 루프에서 `advance(nowMs)` 호출로 반복 발생. 소프트드롭은 keydown/keyup을 `softDropOn/Off`로 전달.
- 렌더: 캔버스 — 보드(가시 20행), 고스트 피스(현 위치에서 하드드롭 위치 반투명), Hold 박스, Next 5 세로 목록, HUD(점수/레벨/라인/콤보/다음 등급까지/내 최고). 셀 색은 `--pg-*` 토큰에서 조각별 매핑(I=mint, O=yellow, T=lavender, S=green, Z=accent, J=blue, L=muted 계열 — arcade.css에 변수로).
- 키 안내: `← → 이동 · ↓ 소프트 · Space 하드 · Z/X 회전 · C 홀드 · P 일시정지`.
- finish meta: `{ lines, levelReached, maxLineClear }`.

**Steps:**

- [ ] **Step 1: 실패 테스트** — keymap: DAS 전 1회 이동/160ms 후 40ms 간격 반복/keyup 리셋/repeat 이벤트 무시. GameHost tetris 분기.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: 프리뷰 실측** — Task 10과 동일 방식으로 테트리스 한 판(하드드롭·홀드·4줄 시도) 완주 확인.
- [ ] **Step 6: 커밋** — `테트리스 스테이지와 DAS·ARR 입력 추가`

### Task 13: 게임별 랭킹 패널 + 신기록 슬랙 + 설정 토글 + PR D 마무리

**Files:**
- Create: `src/views/playground/arcade/ArcadeRankingPanel.tsx`
- Modify: `src/views/playground/JbbjHouse.tsx`(랭킹 패널 배치 확정 — 하우스 그리드의 명예의 전당(podium) 아래에 게임별 랭킹 패널 추가. 로비는 변경하지 않음), `electron/main.ts`(`SLACK_ARCADE_WEBHOOK_URL = ''` 상수 + arcadeService에 주입되는 `sendSlackRecord` 구현 — 기존 `postSlackWebhook` 재사용, URL 빈 값이면 skip), `electron/arcadeService.ts`(game-finish 응답 후 조건 발송 로직 마감), `src/views/playground/market/MarketAdminPanel.tsx` 또는 신규 아케이드 설정 섹션(슬랙 토글 — `setSlackNotify`), 테스트들, `package.json`(1.87.0), update-notes, ROADMAP/CONTEXT/AGENTS

**계약:**

- 랭킹 패널: 게임 탭(스네이크/테트리스) × 기간 탭(전체/이번 주). 행: 순위/이름/score(게임별 라벨)/달성일. 내 행 강조(`is-me`). 5행 미만은 "—" 자리 표시. 데이터는 스냅샷의 leaderboard — 별도 fetch 없음, `finishRun` 후 자동 최신화.
- 슬랙 발송 조건: 응답의 `newAlltimeBest && slackNotifyEnabled && !replayed` && URL 비어있지 않음. payload `{ title: '테트리스 신기록!', detail: '32,410점 — 이전 기록 18,420점', player: '배한솔' }` — detail은 응답의 `prevBestScore`로 조립(null이면 '32,410점 — 첫 기록'). 실패는 로그만.
- 토글 UI: 배한솔 관리자 영역(모의투자 관리자 패널과 같은 게이트)에 "신기록 슬랙 알림" 스위치 + "슬랙 워크플로 URL이 설정된 뒤에 실제로 발송돼요" 안내문.

**Steps:**

- [ ] **Step 1: 실패 테스트** — arcadeService: newAlltimeBest+config on→send 호출, off→미호출, URL 빈 값→미호출, send 실패해도 finish 결과 반환. 랭킹 패널 wiring(탭 전환·빈 행) / 토글이 `config-set` execute 호출.
- [ ] **Step 2: RED → Step 3: 구현 → Step 4: GREEN**
- [ ] **Step 5: PR D 전체 검증** — typecheck/test:playground/build:vite + 프리뷰에서 랭킹 탭·토글 실측.
- [ ] **Step 6: 문서·버전·커밋** — 1.87.0, update-notes("테트리스가 열렸어요. 게임마다 순위표가 생겼고, 최고 기록을 깨면 슬랙으로 자랑도 보낼 수 있어요(관리 설정에서 켤 수 있어요)" 톤), ROADMAP의 "게임 실행과 서버 저장"/"포인트·게임 점수 정책 확정" 체크. 메시지: `테트리스와 게임별 랭킹·신기록 슬랙 알림 (v1.87.0)`
- [ ] **Step 7: 후속 메모** — PR 본문에 잔여 항목 기재: 스도쿠/슬롯머신, 주간 다이제스트, 팀 공개 시 위협모델 업그레이드(Supabase Auth)와 신규 유저 시드(`arcade-grant`), `SLACK_ARCADE_WEBHOOK_URL` 실값 주입.

---

## 완료 정의 (전체)

1. 4개 PR 모두: `npm run typecheck` + `npm run test:playground` + `npm run build:vite` 통과, 프리뷰(`?preview=1`) 실측 증적.
2. 포인트 순환 루프 시연 가능: 출석/씬 체크로 적립 → 우상단 배지 반영 → 스네이크·테트리스 입장료 지불 → 등급 보상·도전과제 → 랭킹 갱신 → (설정 on 시) 신기록 슬랙.
3. 원장(`playground_value_ledger`)만 봐도 모든 포인트 증감이 재구성 가능(감사 가능성).
4. 같은 이벤트 재발생(재체크·재시도·재실행)에 중복 지급 0건 — 멱등 키 테스트로 보증.
