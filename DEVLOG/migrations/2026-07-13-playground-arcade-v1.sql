-- ============================================================
-- 배플레이그라운드 아케이드 v1 — 포인트 적립 · 게임 기록 · 도전과제
-- date: 2026-07-13
--
-- 원칙:
-- - 모의투자 v2(playground_wallet_accounts / playground_value_ledger)를 확장한다.
--   지갑·원장은 v2 가 이미 시드했으므로 여기서는 원장 kind 만 넓히고 새 테이블 3개를 더한다.
-- - public table 은 renderer 역할에 직접 열지 않고 hardened RPC 만 anon 에 공개한다.
-- - 현재 인증 경계는 Electron main 의 canonical SessionManager 이며, 모든 RPC 는
--   DB 의 정확한 배한솔 name + Slack ID 한 행을 다시 확인한다.
-- - user UUID 를 migration 에 박지 않고 public.users 의 canonical 행에서 가져온다.
-- - 모든 포인트/점수는 JavaScript Number.MAX_SAFE_INTEGER 범위의 정수만 다룬다.
-- - 지갑 변경은 예외 없이 원장(playground_value_ledger) insert 와 같은 트랜잭션의 RPC 경유다.
--   멱등: 모든 execute 는 request_id 로 저장된 응답을 replayed=true 로 재생한다.
--
-- ACCEPTED TEST-ONLY THREAT MODEL:
-- - anon 은 API 역할일 뿐 실제 RPC 호출자의 사용자 신원을 인증하지 않는다.
-- - 아래 name/Slack/p_user_id 확인은 대상 행이 배한솔인지 확인할 뿐이며,
--   anon 키와 canonical UUID 를 아는 외부 호출자는 Electron main 을 우회해 직접 RPC 를 호출할 수 있다.
-- - 이 잔여 위험은 실제 금전 가치가 없는 배한솔 한 명의 가상 포인트 테스트에서만 수용한다.
-- - 공식 Electron main 의 canonical SessionManager 를 현재 앱 신뢰 경계로 둔다.
-- - Supabase Auth 또는 검증된 서버 인증은 팀 공개나 실제 가치·민감 데이터로 확장 전 필수다.
-- - 배포 앱에서 추출 가능한 가짜 비밀값은 보안 경계로 추가하지 않는다.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. 원장 kind 확장 (아케이드 적립/차감 kind 추가). 재실행 안전하도록 DROP 후 ADD.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2. 신규 테이블 3개
-- ------------------------------------------------------------
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
  ),
  CONSTRAINT playground_achievement_reward_range CHECK (reward_points >= 0 AND reward_points <= 9007199254740991)
);

CREATE TABLE IF NOT EXISTS public.playground_arcade_config (
  id smallint PRIMARY KEY DEFAULT 1,
  slack_notify_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playground_arcade_config_singleton CHECK (id = 1)
);
INSERT INTO public.playground_arcade_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 3. RLS + 직접 접근 잠금 (renderer 역할에 테이블 직접 노출 금지)
-- ------------------------------------------------------------
ALTER TABLE public.playground_game_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_achievement_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playground_arcade_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.playground_game_runs FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_achievement_unlocks FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_arcade_config FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.playground_game_runs FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_achievement_unlocks FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.playground_arcade_config FROM PUBLIC;

-- ------------------------------------------------------------
-- 4. 읽기 RPC — 지갑/출석/오늘 활동/게임 기록/도전과제/랭킹/설정 스냅샷
-- ------------------------------------------------------------
-- 이전 draft 시그니처가 남아 있으면 단일 공개 시그니처 유지를 위해 먼저 제거한다.
DROP FUNCTION IF EXISTS public.playground_arcade_read(uuid);

CREATE OR REPLACE FUNCTION public.playground_arcade_read(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_wallet public.playground_wallet_accounts%ROWTYPE;
  v_today date;
  v_week_start timestamp;
  v_today_granted boolean;
  v_streak integer := 0;
  v_cursor date;
  v_slack_enabled boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'arcade user is required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'arcade access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT wallet.*
  INTO v_wallet
  FROM public.playground_wallet_accounts AS wallet
  WHERE wallet.user_id = p_user_id::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'arcade wallet account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_week_start := date_trunc('week', now() AT TIME ZONE 'Asia/Seoul');

  v_today_granted := EXISTS (
    SELECT 1
    FROM public.playground_value_ledger AS ledger
    WHERE ledger.user_id = p_user_id::text
      AND ledger.kind = 'daily-login'
      AND (ledger.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
  );

  -- 연속 출석: 오늘(또는 오늘 미출석 시 어제)부터 역방향으로 daily-login 이 이어진 날 수
  IF v_today_granted THEN
    v_cursor := v_today;
  ELSIF EXISTS (
    SELECT 1
    FROM public.playground_value_ledger AS ledger
    WHERE ledger.user_id = p_user_id::text
      AND ledger.kind = 'daily-login'
      AND (ledger.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today - 1
  ) THEN
    v_cursor := v_today - 1;
  ELSE
    v_cursor := NULL;
  END IF;

  WHILE v_cursor IS NOT NULL LOOP
    IF EXISTS (
      SELECT 1
      FROM public.playground_value_ledger AS ledger
      WHERE ledger.user_id = p_user_id::text
        AND ledger.kind = 'daily-login'
        AND (ledger.created_at AT TIME ZONE 'Asia/Seoul')::date = v_cursor
    ) THEN
      v_streak := v_streak + 1;
      v_cursor := v_cursor - 1;
    ELSE
      v_cursor := NULL;
    END IF;
  END LOOP;

  SELECT config.slack_notify_enabled
  INTO v_slack_enabled
  FROM public.playground_arcade_config AS config
  WHERE config.id = 1;
  v_slack_enabled := COALESCE(v_slack_enabled, false);

  RETURN jsonb_build_object(
    'wallet', jsonb_build_object(
      'walletPoints', v_wallet.wallet_points,
      'lifetimeEarnedPoints', v_wallet.lifetime_earned_points
    ),
    'attendance', jsonb_build_object(
      'streakDays', v_streak,
      'todayGranted', v_today_granted
    ),
    'todayActivityCounts', jsonb_build_object(
      'sceneProgress', (
        SELECT COUNT(*) FROM public.playground_value_ledger AS l
        WHERE l.user_id = p_user_id::text AND l.kind = 'scene-progress'
          AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
      ),
      'comment', (
        SELECT COUNT(*) FROM public.playground_value_ledger AS l
        WHERE l.user_id = p_user_id::text AND l.kind = 'comment'
          AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
      ),
      'retakeDone', (
        SELECT COUNT(*) FROM public.playground_value_ledger AS l
        WHERE l.user_id = p_user_id::text AND l.kind = 'retake-done'
          AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
      )
    ),
    'games', jsonb_build_object(
      'snake', jsonb_build_object(
        'myBestScore', COALESCE((
          SELECT MAX(r.score) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake'
        ), 0),
        'myWeeklyBestScore', COALESCE((
          SELECT MAX(r.score) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake'
            AND (r.created_at AT TIME ZONE 'Asia/Seoul') >= v_week_start
        ), 0),
        'todayRewardedRuns', (
          SELECT COUNT(*) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.reward_points > 0
            AND (r.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
        ),
        'totalRuns', (
          SELECT COUNT(*) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake'
        ),
        'maxGoldenEaten', COALESCE((
          SELECT MAX((r.meta ->> 'goldenEaten')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.meta ->> 'goldenEaten' ~ '^[0-9]+$'
        ), 0),
        'maxLineClear', COALESCE((
          SELECT MAX((r.meta ->> 'maxLineClear')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.meta ->> 'maxLineClear' ~ '^[0-9]+$'
        ), 0),
        'maxLevel', COALESCE((
          SELECT MAX((r.meta ->> 'levelReached')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.meta ->> 'levelReached' ~ '^[0-9]+$'
        ), 0),
        'leaderboardAll', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('userId', top.user_id, 'name', top.name, 'score', top.score, 'at', top.created_at)
            ORDER BY top.score DESC, top.created_at ASC
          )
          FROM (
            SELECT best.user_id, u.name, best.score, best.created_at
            FROM (
              SELECT DISTINCT ON (r.user_id) r.user_id, r.score, r.created_at
              FROM public.playground_game_runs AS r
              WHERE r.game_id = 'snake'
              ORDER BY r.user_id, r.score DESC, r.created_at ASC
            ) best
            JOIN public.users AS u ON u.id = best.user_id
            ORDER BY best.score DESC, best.created_at ASC
            LIMIT 5
          ) top
        ), '[]'::jsonb),
        'leaderboardWeekly', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('userId', top.user_id, 'name', top.name, 'score', top.score, 'at', top.created_at)
            ORDER BY top.score DESC, top.created_at ASC
          )
          FROM (
            SELECT best.user_id, u.name, best.score, best.created_at
            FROM (
              SELECT DISTINCT ON (r.user_id) r.user_id, r.score, r.created_at
              FROM public.playground_game_runs AS r
              WHERE r.game_id = 'snake'
                AND (r.created_at AT TIME ZONE 'Asia/Seoul') >= v_week_start
              ORDER BY r.user_id, r.score DESC, r.created_at ASC
            ) best
            JOIN public.users AS u ON u.id = best.user_id
            ORDER BY best.score DESC, best.created_at ASC
            LIMIT 5
          ) top
        ), '[]'::jsonb)
      ),
      'tetris', jsonb_build_object(
        'myBestScore', COALESCE((
          SELECT MAX(r.score) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris'
        ), 0),
        'myWeeklyBestScore', COALESCE((
          SELECT MAX(r.score) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris'
            AND (r.created_at AT TIME ZONE 'Asia/Seoul') >= v_week_start
        ), 0),
        'todayRewardedRuns', (
          SELECT COUNT(*) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris' AND r.reward_points > 0
            AND (r.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
        ),
        'totalRuns', (
          SELECT COUNT(*) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris'
        ),
        'maxGoldenEaten', COALESCE((
          SELECT MAX((r.meta ->> 'goldenEaten')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris' AND r.meta ->> 'goldenEaten' ~ '^[0-9]+$'
        ), 0),
        'maxLineClear', COALESCE((
          SELECT MAX((r.meta ->> 'maxLineClear')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris' AND r.meta ->> 'maxLineClear' ~ '^[0-9]+$'
        ), 0),
        'maxLevel', COALESCE((
          SELECT MAX((r.meta ->> 'levelReached')::bigint) FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris' AND r.meta ->> 'levelReached' ~ '^[0-9]+$'
        ), 0),
        'leaderboardAll', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('userId', top.user_id, 'name', top.name, 'score', top.score, 'at', top.created_at)
            ORDER BY top.score DESC, top.created_at ASC
          )
          FROM (
            SELECT best.user_id, u.name, best.score, best.created_at
            FROM (
              SELECT DISTINCT ON (r.user_id) r.user_id, r.score, r.created_at
              FROM public.playground_game_runs AS r
              WHERE r.game_id = 'tetris'
              ORDER BY r.user_id, r.score DESC, r.created_at ASC
            ) best
            JOIN public.users AS u ON u.id = best.user_id
            ORDER BY best.score DESC, best.created_at ASC
            LIMIT 5
          ) top
        ), '[]'::jsonb),
        'leaderboardWeekly', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('userId', top.user_id, 'name', top.name, 'score', top.score, 'at', top.created_at)
            ORDER BY top.score DESC, top.created_at ASC
          )
          FROM (
            SELECT best.user_id, u.name, best.score, best.created_at
            FROM (
              SELECT DISTINCT ON (r.user_id) r.user_id, r.score, r.created_at
              FROM public.playground_game_runs AS r
              WHERE r.game_id = 'tetris'
                AND (r.created_at AT TIME ZONE 'Asia/Seoul') >= v_week_start
              ORDER BY r.user_id, r.score DESC, r.created_at ASC
            ) best
            JOIN public.users AS u ON u.id = best.user_id
            ORDER BY best.score DESC, best.created_at ASC
            LIMIT 5
          ) top
        ), '[]'::jsonb)
      )
    ),
    'achievements', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('achievementId', a.achievement_id, 'unlockedAt', a.unlocked_at)
        ORDER BY a.unlocked_at
      )
      FROM public.playground_achievement_unlocks AS a
      WHERE a.user_id = p_user_id::text
    ), '[]'::jsonb),
    'aggregates', jsonb_build_object(
      'totalRuns', (
        SELECT COUNT(*) FROM public.playground_game_runs AS r
        WHERE r.user_id = p_user_id::text
      ),
      'arcadeEarnedPoints', COALESCE((
        SELECT SUM(l.wallet_delta) FROM public.playground_value_ledger AS l
        WHERE l.user_id = p_user_id::text
          AND l.kind IN ('scene-progress', 'comment', 'retake-done', 'daily-login', 'game-reward', 'achievement')
      ), 0)::bigint
    ),
    'walletLeaderboard', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('userId', w.user_id, 'name', u.name, 'lifetimeEarnedPoints', w.lifetime_earned_points)
        ORDER BY w.lifetime_earned_points DESC, u.name ASC
      )
      FROM public.playground_wallet_accounts AS w
      JOIN public.users AS u ON u.id = w.user_id
    ), '[]'::jsonb),
    'config', jsonb_build_object('slackNotifyEnabled', v_slack_enabled)
  );
END
$$;

-- ------------------------------------------------------------
-- 5. 실행 RPC — 출석/활동/게임 시작·종료/도전과제/설정. 지갑 변경은 전부 여기 원장 경유.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.playground_arcade_execute(
  p_user_id uuid,
  p_request_id text,
  p_kind text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match_count integer;
  v_wallet public.playground_wallet_accounts%ROWTYPE;
  v_existing_fingerprint text;
  v_existing_response jsonb;
  v_fingerprint text;
  v_response jsonb;
  v_write_ledger boolean := true;
  v_ledger_kind text;
  v_wallet_delta bigint := 0;
  v_lifetime_delta bigint := 0;
  v_max_safe constant bigint := 9007199254740991;
  v_today date;
  v_week_start timestamp;
  v_new_wallet_points bigint;
  v_new_lifetime bigint;
  -- 출석 streak
  v_streak integer := 0;
  v_cursor date;
  -- 활동
  v_activity text;
  v_points bigint;
  v_cap integer;
  v_cap_kind text;
  v_today_count integer;
  -- 게임
  v_game_id text;
  v_run_id text;
  v_entry_fee bigint;
  v_entry_stock_id text;   -- game-entry 원장에 시작 게임을 기록해 game-finish 에서 대조
  v_entry_game_id text;    -- game-finish 시 조회한 입장 게임
  v_score bigint;
  v_duration bigint;
  v_grade text;
  v_reward bigint;
  v_reward_capped boolean;
  v_today_rewarded integer;
  v_prev_best bigint;
  v_prev_weekly_best bigint;
  v_new_alltime_best boolean;
  v_new_weekly_best boolean;
  v_my_best bigint;
  v_slack_enabled boolean;
  -- 도전과제
  v_ach_id text;
  v_bonus bigint;
  v_condition_met boolean;  -- 서버가 도전과제 조건을 재검증(보상의 SSOT)
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'arcade user is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT COUNT(*)
  INTO v_match_count
  FROM public.users
  WHERE users.name = '배한솔'
    AND users.slack_id = 'U05DFV9UAN5';
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'canonical Hansol account is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE users.id = p_user_id::text
      AND users.name = '배한솔'
      AND users.slack_id = 'U05DFV9UAN5'
  ) THEN
    RAISE EXCEPTION 'arcade access is limited to canonical Hansol' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
    OR char_length(p_request_id) NOT BETWEEN 1 AND 200
    OR char_length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
    OR p_request_id IS DISTINCT FROM btrim(p_request_id)
    OR p_request_id ~ '^[[:space:]]|[[:space:]]$' THEN
    RAISE EXCEPTION 'arcade request id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN (
    'daily-login', 'activity', 'game-start', 'game-finish', 'achievement-unlock', 'config-set'
  ) THEN
    RAISE EXCEPTION 'arcade command kind is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'arcade command payload is invalid' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := encode(
    sha256(convert_to(p_kind || E'\n' || p_payload::text, 'UTF8')),
    'hex'
  );
  v_today := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_week_start := date_trunc('week', now() AT TIME ZONE 'Asia/Seoul');

  SELECT wallet.*
  INTO v_wallet
  FROM public.playground_wallet_accounts AS wallet
  WHERE wallet.user_id = p_user_id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'arcade wallet account is not initialized' USING ERRCODE = 'P0002';
  END IF;

  -- 멱등 probe: 같은 request_id 가 이미 처리됐으면 저장된 응답을 replayed=true 로 재생한다.
  SELECT ledger.payload_fingerprint, ledger.response_state
  INTO v_existing_fingerprint, v_existing_response
  FROM public.playground_value_ledger AS ledger
  WHERE ledger.user_id = p_user_id::text
    AND ledger.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION '같은 요청이 다른 내용으로 이미 처리되었어요' USING ERRCODE = '23505';
    END IF;
    RETURN COALESCE(v_existing_response, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  CASE p_kind
    WHEN 'daily-login' THEN
      IF p_request_id IS DISTINCT FROM 'daily-login:' || to_char(v_today, 'YYYY-MM-DD') THEN
        RAISE EXCEPTION '출석 요청 날짜가 올바르지 않아요' USING ERRCODE = '22023';
      END IF;
      v_ledger_kind := 'daily-login';
      v_points := 20;
      v_wallet_delta := v_points;
      v_lifetime_delta := v_points;
      UPDATE public.playground_wallet_accounts
      SET wallet_points = wallet_points + v_points,
          lifetime_earned_points = lifetime_earned_points + v_points,
          updated_at = now()
      WHERE user_id = p_user_id::text
      RETURNING wallet_points, lifetime_earned_points INTO v_new_wallet_points, v_new_lifetime;

      -- streak: 오늘(지급 중) + 역방향 연속 daily-login
      v_cursor := v_today;
      WHILE v_cursor IS NOT NULL LOOP
        IF v_cursor = v_today OR EXISTS (
          SELECT 1 FROM public.playground_value_ledger AS l
          WHERE l.user_id = p_user_id::text AND l.kind = 'daily-login'
            AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_cursor
        ) THEN
          v_streak := v_streak + 1;
          v_cursor := v_cursor - 1;
        ELSE
          v_cursor := NULL;
        END IF;
      END LOOP;

      v_response := jsonb_build_object(
        'granted', true,
        'wallet', jsonb_build_object('walletPoints', v_new_wallet_points, 'lifetimeEarnedPoints', v_new_lifetime),
        'attendance', jsonb_build_object('streakDays', v_streak, 'todayGranted', true)
      );

    WHEN 'activity' THEN
      IF jsonb_typeof(p_payload -> 'activity') IS DISTINCT FROM 'string'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key <> 'activity'
        ) THEN
        RAISE EXCEPTION 'activity payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_activity := p_payload ->> 'activity';
      IF v_activity = 'scene-stage' THEN
        v_points := 5; v_cap := 30; v_cap_kind := 'scene-progress';
      ELSIF v_activity = 'scene-phase-done' THEN
        v_points := 10; v_cap := 30; v_cap_kind := 'scene-progress';
      ELSIF v_activity = 'comment' THEN
        v_points := 5; v_cap := 5; v_cap_kind := 'comment';
      ELSIF v_activity = 'retake-done' THEN
        v_points := 30; v_cap := 5; v_cap_kind := 'retake-done';
      ELSE
        RAISE EXCEPTION 'activity type is invalid' USING ERRCODE = '22023';
      END IF;
      -- request_id 는 활동 종류 접두사로 시작해야 한다.
      IF p_request_id NOT LIKE v_activity || ':%' THEN
        RAISE EXCEPTION 'activity request id is invalid' USING ERRCODE = '22023';
      END IF;

      SELECT COUNT(*)
      INTO v_today_count
      FROM public.playground_value_ledger AS l
      WHERE l.user_id = p_user_id::text
        AND l.kind = v_cap_kind
        AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today;

      IF v_today_count >= v_cap THEN
        -- 일일 상한 도달: 지급 없이 성공 응답. 원장/응답 미기록으로 멱등 키를 소비하지 않는다.
        v_write_ledger := false;
        v_response := jsonb_build_object(
          'awarded', false, 'points', 0, 'capped', true,
          'wallet', jsonb_build_object(
            'walletPoints', v_wallet.wallet_points,
            'lifetimeEarnedPoints', v_wallet.lifetime_earned_points
          )
        );
      ELSE
        v_ledger_kind := v_cap_kind;
        v_wallet_delta := v_points;
        v_lifetime_delta := v_points;
        UPDATE public.playground_wallet_accounts
        SET wallet_points = wallet_points + v_points,
            lifetime_earned_points = lifetime_earned_points + v_points,
            updated_at = now()
        WHERE user_id = p_user_id::text
        RETURNING wallet_points, lifetime_earned_points INTO v_new_wallet_points, v_new_lifetime;
        v_response := jsonb_build_object(
          'awarded', true, 'points', v_points, 'capped', false,
          'wallet', jsonb_build_object('walletPoints', v_new_wallet_points, 'lifetimeEarnedPoints', v_new_lifetime)
        );
      END IF;

    WHEN 'game-start' THEN
      IF jsonb_typeof(p_payload -> 'runId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'gameId') IS DISTINCT FROM 'string'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('runId', 'gameId')
        ) THEN
        RAISE EXCEPTION 'game start payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_run_id := p_payload ->> 'runId';
      v_game_id := p_payload ->> 'gameId';
      IF v_game_id NOT IN ('snake', 'tetris') THEN
        RAISE EXCEPTION 'game is not available' USING ERRCODE = '22023';
      END IF;
      IF p_request_id IS DISTINCT FROM 'game-entry:' || v_run_id THEN
        RAISE EXCEPTION 'game start request id is invalid' USING ERRCODE = '22023';
      END IF;
      v_entry_fee := CASE v_game_id WHEN 'snake' THEN 10 WHEN 'tetris' THEN 15 ELSE 0 END;
      IF v_wallet.wallet_points < v_entry_fee THEN
        RAISE EXCEPTION '포인트가 부족해 게임을 시작할 수 없어요' USING ERRCODE = 'P0001';
      END IF;
      v_ledger_kind := 'game-entry';
      v_entry_stock_id := v_game_id;  -- 시작 게임을 원장에 남겨 종료 시 대조한다.
      v_wallet_delta := -v_entry_fee;
      v_lifetime_delta := 0;
      UPDATE public.playground_wallet_accounts
      SET wallet_points = wallet_points - v_entry_fee,
          updated_at = now()
      WHERE user_id = p_user_id::text
      RETURNING wallet_points, lifetime_earned_points INTO v_new_wallet_points, v_new_lifetime;
      v_response := jsonb_build_object(
        'wallet', jsonb_build_object('walletPoints', v_new_wallet_points, 'lifetimeEarnedPoints', v_new_lifetime)
      );

    WHEN 'game-finish' THEN
      IF jsonb_typeof(p_payload -> 'runId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'gameId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_payload -> 'score') IS DISTINCT FROM 'number'
        OR jsonb_typeof(p_payload -> 'durationMs') IS DISTINCT FROM 'number'
        OR jsonb_typeof(p_payload -> 'meta') IS DISTINCT FROM 'object'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key NOT IN ('runId', 'gameId', 'score', 'durationMs', 'meta')
        ) THEN
        RAISE EXCEPTION 'game finish payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_run_id := p_payload ->> 'runId';
      v_game_id := p_payload ->> 'gameId';
      IF v_game_id NOT IN ('snake', 'tetris') THEN
        RAISE EXCEPTION 'game is not available' USING ERRCODE = '22023';
      END IF;
      IF p_request_id IS DISTINCT FROM 'game-finish:' || v_run_id THEN
        RAISE EXCEPTION 'game finish request id is invalid' USING ERRCODE = '22023';
      END IF;
      IF (p_payload ->> 'score') !~ '^[0-9]+$' OR (p_payload ->> 'durationMs') !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'game finish values must be non-negative integers' USING ERRCODE = '22023';
      END IF;
      v_score := (p_payload ->> 'score')::bigint;
      v_duration := (p_payload ->> 'durationMs')::bigint;
      IF v_game_id = 'snake' AND (v_score < 0 OR v_score > 441) THEN
        RAISE EXCEPTION 'snake score is out of range' USING ERRCODE = '22023';
      END IF;
      IF v_game_id = 'tetris' AND (v_score < 0 OR v_score > 3000000) THEN
        RAISE EXCEPTION 'tetris score is out of range' USING ERRCODE = '22023';
      END IF;
      IF v_duration < 1000 OR v_duration > 14400000 THEN
        RAISE EXCEPTION 'game duration is out of range' USING ERRCODE = '22023';
      END IF;
      -- (1) 입장 원장 존재 + 본인 소유 + 시작 게임 일치 확인
      -- (game-entry 원장의 stock_id 에 시작 게임을 저장해 두었다. 다른 게임으로 종료해
      --  낮은 입장료로 높은 보상을 받는 것을 막는다.)
      SELECT l.stock_id
      INTO v_entry_game_id
      FROM public.playground_value_ledger AS l
      WHERE l.user_id = p_user_id::text
        AND l.request_id = 'game-entry:' || v_run_id
        AND l.kind = 'game-entry';
      IF NOT FOUND THEN
        RAISE EXCEPTION '시작되지 않은 게임은 기록할 수 없어요' USING ERRCODE = 'P0001';
      END IF;
      IF v_entry_game_id IS DISTINCT FROM v_game_id THEN
        RAISE EXCEPTION '시작한 게임과 종료한 게임이 달라요' USING ERRCODE = 'P0001';
      END IF;
      -- (2) runs PK 중복 없음
      IF EXISTS (SELECT 1 FROM public.playground_game_runs AS r WHERE r.id = v_run_id::uuid) THEN
        RAISE EXCEPTION '이미 기록된 게임이에요' USING ERRCODE = '23505';
      END IF;
      -- (4) 등급 (경계 이상 판정) + 등급별 보상
      IF v_game_id = 'snake' THEN
        v_grade := CASE
          WHEN v_score >= 55 THEN 'platinum'
          WHEN v_score >= 40 THEN 'gold'
          WHEN v_score >= 25 THEN 'silver'
          WHEN v_score >= 15 THEN 'bronze'
          ELSE 'none'
        END;
        v_reward := CASE v_grade
          WHEN 'bronze' THEN 8
          WHEN 'silver' THEN 18
          WHEN 'gold' THEN 30
          WHEN 'platinum' THEN 45
          ELSE 0
        END;
      ELSE
        v_grade := CASE
          WHEN v_score >= 50000 THEN 'platinum'
          WHEN v_score >= 25000 THEN 'gold'
          WHEN v_score >= 10000 THEN 'silver'
          WHEN v_score >= 3000 THEN 'bronze'
          ELSE 'none'
        END;
        v_reward := CASE v_grade
          WHEN 'bronze' THEN 12
          WHEN 'silver' THEN 30
          WHEN 'gold' THEN 55
          WHEN 'platinum' THEN 80
          ELSE 0
        END;
      END IF;
      -- (5) 오늘 보상 판 수(이 게임, KST) < 5 이고 grade != none 이면 보상
      SELECT COUNT(*)
      INTO v_today_rewarded
      FROM public.playground_game_runs AS r
      WHERE r.user_id = p_user_id::text
        AND r.game_id = v_game_id
        AND r.reward_points > 0
        AND (r.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today;
      v_reward_capped := v_today_rewarded >= 5;
      IF v_grade = 'none' OR v_reward_capped THEN
        v_reward := 0;
      END IF;
      -- (6) 최고 기록 갱신 판정 (이번 런 반영 전 초과 비교)
      SELECT MAX(r.score)
      INTO v_prev_best
      FROM public.playground_game_runs AS r
      WHERE r.user_id = p_user_id::text AND r.game_id = v_game_id;
      v_new_alltime_best := v_prev_best IS NULL OR v_score > v_prev_best;
      SELECT MAX(r.score)
      INTO v_prev_weekly_best
      FROM public.playground_game_runs AS r
      WHERE r.user_id = p_user_id::text AND r.game_id = v_game_id
        AND (r.created_at AT TIME ZONE 'Asia/Seoul') >= v_week_start;
      v_new_weekly_best := v_prev_weekly_best IS NULL OR v_score > v_prev_weekly_best;
      v_my_best := GREATEST(COALESCE(v_prev_best, 0), v_score);

      INSERT INTO public.playground_game_runs (
        id, user_id, game_id, score, grade, duration_ms, meta, reward_points, was_alltime_best, entry_request_id
      ) VALUES (
        v_run_id::uuid, p_user_id::text, v_game_id, v_score, v_grade, v_duration,
        COALESCE(p_payload -> 'meta', '{}'::jsonb), v_reward, v_new_alltime_best, 'game-entry:' || v_run_id
      );

      IF v_reward > 0 THEN
        UPDATE public.playground_wallet_accounts
        SET wallet_points = wallet_points + v_reward,
            lifetime_earned_points = lifetime_earned_points + v_reward,
            updated_at = now()
        WHERE user_id = p_user_id::text
        RETURNING wallet_points, lifetime_earned_points INTO v_new_wallet_points, v_new_lifetime;
      ELSE
        v_new_wallet_points := v_wallet.wallet_points;
        v_new_lifetime := v_wallet.lifetime_earned_points;
      END IF;

      v_ledger_kind := 'game-reward';
      v_wallet_delta := v_reward;
      v_lifetime_delta := v_reward;

      SELECT config.slack_notify_enabled
      INTO v_slack_enabled
      FROM public.playground_arcade_config AS config
      WHERE config.id = 1;
      v_slack_enabled := COALESCE(v_slack_enabled, false);

      v_response := jsonb_build_object(
        'grade', v_grade,
        'rewardPoints', v_reward,
        'rewardCapped', v_reward_capped,
        'newAlltimeBest', v_new_alltime_best,
        'newWeeklyBest', v_new_weekly_best,
        'prevBestScore', v_prev_best,
        'myBestScore', v_my_best,
        'todayRewardedRuns', v_today_rewarded + CASE WHEN v_reward > 0 THEN 1 ELSE 0 END,
        'wallet', jsonb_build_object('walletPoints', v_new_wallet_points, 'lifetimeEarnedPoints', v_new_lifetime),
        'slackNotifyEnabled', v_slack_enabled
      );

    WHEN 'achievement-unlock' THEN
      IF jsonb_typeof(p_payload -> 'achievementId') IS DISTINCT FROM 'string'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key <> 'achievementId'
        ) THEN
        RAISE EXCEPTION 'achievement payload is invalid' USING ERRCODE = '22023';
      END IF;
      v_ach_id := p_payload ->> 'achievementId';
      IF p_request_id IS DISTINCT FROM 'ach:' || v_ach_id THEN
        RAISE EXCEPTION 'achievement request id is invalid' USING ERRCODE = '22023';
      END IF;
      v_bonus := CASE v_ach_id
        WHEN 'arcade-first-run' THEN 10
        WHEN 'arcade-runs-50' THEN 30
        WHEN 'arcade-earned-5k' THEN 50
        WHEN 'attend-7' THEN 50
        WHEN 'snake-30' THEN 15
        WHEN 'snake-55' THEN 40
        WHEN 'snake-golden-5' THEN 20
        WHEN 'tetris-tetris' THEN 20
        WHEN 'tetris-level-10' THEN 30
        WHEN 'tetris-30k' THEN 40
        ELSE NULL
      END;
      IF v_bonus IS NULL THEN
        RAISE EXCEPTION '알 수 없는 도전과제예요' USING ERRCODE = '22023';
      END IF;
      -- 서버측 조건 재검증 — 클라이언트 수치는 표시용 미러일 뿐 서버가 보상의 SSOT다.
      -- 렌더러가 조건 미충족 상태로 unlock 을 요청해도 보너스를 발행하지 않는다.
      IF v_ach_id = 'arcade-first-run' THEN
        v_condition_met := (SELECT COUNT(*) FROM public.playground_game_runs AS r WHERE r.user_id = p_user_id::text) >= 1;
      ELSIF v_ach_id = 'arcade-runs-50' THEN
        v_condition_met := (SELECT COUNT(*) FROM public.playground_game_runs AS r WHERE r.user_id = p_user_id::text) >= 50;
      ELSIF v_ach_id = 'arcade-earned-5k' THEN
        v_condition_met := (
          SELECT COALESCE(SUM(l.wallet_delta), 0)
          FROM public.playground_value_ledger AS l
          WHERE l.user_id = p_user_id::text
            AND l.kind IN ('scene-progress', 'comment', 'retake-done', 'daily-login', 'game-reward', 'achievement')
        ) >= 5000;
      ELSIF v_ach_id = 'attend-7' THEN
        v_streak := 0;
        IF EXISTS (
          SELECT 1 FROM public.playground_value_ledger AS l
          WHERE l.user_id = p_user_id::text AND l.kind = 'daily-login'
            AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today
        ) THEN
          v_cursor := v_today;
        ELSIF EXISTS (
          SELECT 1 FROM public.playground_value_ledger AS l
          WHERE l.user_id = p_user_id::text AND l.kind = 'daily-login'
            AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_today - 1
        ) THEN
          v_cursor := v_today - 1;
        ELSE
          v_cursor := NULL;
        END IF;
        WHILE v_cursor IS NOT NULL LOOP
          IF EXISTS (
            SELECT 1 FROM public.playground_value_ledger AS l
            WHERE l.user_id = p_user_id::text AND l.kind = 'daily-login'
              AND (l.created_at AT TIME ZONE 'Asia/Seoul')::date = v_cursor
          ) THEN
            v_streak := v_streak + 1;
            v_cursor := v_cursor - 1;
          ELSE
            v_cursor := NULL;
          END IF;
        END LOOP;
        v_condition_met := v_streak >= 7;
      ELSIF v_ach_id = 'snake-30' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.score >= 30
        );
      ELSIF v_ach_id = 'snake-55' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake' AND r.score >= 55
        );
      ELSIF v_ach_id = 'snake-golden-5' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'snake'
            AND COALESCE((r.meta ->> 'goldenEaten')::bigint, 0) >= 5
        );
      ELSIF v_ach_id = 'tetris-tetris' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris'
            AND COALESCE((r.meta ->> 'maxLineClear')::bigint, 0) >= 4
        );
      ELSIF v_ach_id = 'tetris-level-10' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris'
            AND COALESCE((r.meta ->> 'levelReached')::bigint, 0) >= 10
        );
      ELSIF v_ach_id = 'tetris-30k' THEN
        v_condition_met := EXISTS (
          SELECT 1 FROM public.playground_game_runs AS r
          WHERE r.user_id = p_user_id::text AND r.game_id = 'tetris' AND r.score >= 30000
        );
      ELSE
        v_condition_met := false;
      END IF;
      IF NOT v_condition_met THEN
        RAISE EXCEPTION '아직 달성하지 못한 도전과제예요' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.playground_achievement_unlocks (user_id, achievement_id, reward_points)
      VALUES (p_user_id::text, v_ach_id, v_bonus);
      v_ledger_kind := 'achievement';
      v_wallet_delta := v_bonus;
      v_lifetime_delta := v_bonus;
      UPDATE public.playground_wallet_accounts
      SET wallet_points = wallet_points + v_bonus,
          lifetime_earned_points = lifetime_earned_points + v_bonus,
          updated_at = now()
      WHERE user_id = p_user_id::text
      RETURNING wallet_points, lifetime_earned_points INTO v_new_wallet_points, v_new_lifetime;
      v_response := jsonb_build_object(
        'achievementId', v_ach_id,
        'rewardPoints', v_bonus,
        'wallet', jsonb_build_object('walletPoints', v_new_wallet_points, 'lifetimeEarnedPoints', v_new_lifetime)
      );

    WHEN 'config-set' THEN
      IF jsonb_typeof(p_payload -> 'slackNotifyEnabled') IS DISTINCT FROM 'boolean'
        OR EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(payload_key)
          WHERE payload_key <> 'slackNotifyEnabled'
        ) THEN
        RAISE EXCEPTION 'config payload is invalid' USING ERRCODE = '22023';
      END IF;
      IF p_request_id NOT LIKE 'config:%' THEN
        RAISE EXCEPTION 'config request id is invalid' USING ERRCODE = '22023';
      END IF;
      v_slack_enabled := (p_payload ->> 'slackNotifyEnabled')::boolean;
      UPDATE public.playground_arcade_config
      SET slack_notify_enabled = v_slack_enabled, updated_at = now()
      WHERE id = 1;
      -- config 는 자연 멱등이라 원장을 기록하지 않는다.
      v_write_ledger := false;
      v_response := jsonb_build_object(
        'config', jsonb_build_object('slackNotifyEnabled', v_slack_enabled)
      );
  END CASE;

  IF v_write_ledger THEN
    INSERT INTO public.playground_value_ledger (
      user_id, request_id, kind, payload_fingerprint, wallet_delta, lifetime_earned_delta, stock_id, response_state
    ) VALUES (
      p_user_id::text, p_request_id, v_ledger_kind, v_fingerprint, v_wallet_delta, v_lifetime_delta, v_entry_stock_id, v_response
    );
  END IF;

  RETURN v_response;
END
$$;

-- ------------------------------------------------------------
-- 6. RPC 하드닝 — 생성 즉시 PUBLIC EXECUTE 를 회수하고 anon 에게만 공개한다.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.playground_arcade_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_arcade_execute(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.playground_arcade_read(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.playground_arcade_execute(uuid, text, text, jsonb) FROM anon, authenticated;

-- 위 ACCEPTED TEST-ONLY THREAT MODEL 에 따라 단일 사용자 가상 포인트 시험 기간에만
-- anon RPC 를 공개한다. Supabase Auth 기반 소유권 검증 전에는 팀 전체로 확장하지 않는다.
GRANT EXECUTE ON FUNCTION public.playground_arcade_read(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.playground_arcade_execute(uuid, text, text, jsonb) TO anon;

COMMIT;
