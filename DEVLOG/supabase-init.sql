-- ============================================================
-- B flow — Supabase 초기 테이블 생성 SQL
-- Supabase 대시보드 → SQL Editor → New query 에서 실행
-- 작성일: 2026-03-14
-- 참고: IF NOT EXISTS 사용으로 재실행 시에도 안전
-- ============================================================

-- 1. episodes
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_number INTEGER NOT NULL,
  title TEXT,
  memo TEXT,
  status TEXT DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_number)
);

-- 2. parts (→ episodes)
CREATE TABLE IF NOT EXISTS parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  department TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(episode_id, part_id, department)
);

-- 3. scenes (→ parts) + updated_by 컬럼 (자기 변경 필터링용)
CREATE TABLE IF NOT EXISTS scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_number TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  memo TEXT,
  storyboard_url TEXT,
  guide_url TEXT,
  assignee TEXT,
  lo BOOLEAN DEFAULT false,
  done BOOLEAN DEFAULT false,
  review BOOLEAN DEFAULT false,
  png BOOLEAN DEFAULT false,
  layout TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(part_id, scene_number)
);

CREATE INDEX IF NOT EXISTS idx_scenes_part_id ON scenes(part_id);
CREATE INDEX IF NOT EXISTS idx_scenes_assignee ON scenes(assignee);

-- 4. comments (→ parts, scenes)
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comments_part_scene ON comments(part_id, scene_id);

-- comment_read_states: 사용자별 씬 댓글 마지막 확인 시간
CREATE TABLE IF NOT EXISTS comment_read_states (
  user_id TEXT NOT NULL,
  scene_thread_key TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scene_thread_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_read_states_user_updated
  ON comment_read_states (user_id, updated_at DESC);

-- 5. comp_revisions (→ parts)
CREATE TABLE IF NOT EXISTS comp_revisions (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'normal',
  description TEXT,
  frame_no TEXT,
  image_url TEXT,
  department TEXT,
  requester_id TEXT,
  requester_name TEXT,
  assignee TEXT,
  resolved_by TEXT,
  resolved_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comp_revisions_part_scene ON comp_revisions(part_id, scene_id);

-- 6. users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  password TEXT,
  slack_id TEXT,
  hire_date TEXT,
  birthday TEXT,
  is_initial_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. metadata
CREATE TABLE IF NOT EXISTS metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(type, key)
);

-- 8. private_calendar_events — 사용자 개인 비공개 일정 (Google Calendar 비연동)
-- 정책: 같은 도메인(@studiojbbj.com) 구성원에게도 노출되면 안 되는 일정은 여기에만 저장된다.
-- Google Calendar 에는 올라가지 않으므로 '바쁨 시간' 조차 노출되지 않는다.
CREATE TABLE IF NOT EXISTS private_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,           -- 소유자 (본인만 조회/수정)
  title TEXT NOT NULL,
  memo TEXT,
  color TEXT,
  type TEXT DEFAULT 'custom',      -- 'custom' | 'episode' | 'part' | 'scene'
  start_date TEXT NOT NULL,        -- YYYY-MM-DD 또는 ISO datetime
  end_date TEXT NOT NULL,
  linked_episode INTEGER,
  linked_part TEXT,
  linked_sheet_name TEXT,
  linked_scene_id TEXT,
  linked_department TEXT,          -- 'bg' | 'acting'
  linked_todo_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_private_cal_events_user ON private_calendar_events(user_id, start_date DESC);

-- ============================================================
-- RLS 정책: 초기 개발 단계에서는 anon key로 전체 접근 허용
-- (Supabase Auth 연동 완료 후 authenticated 전용으로 강화)
-- DO NOTHING 패턴: 이미 존재하면 무시
-- ============================================================

ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'episodes' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON episodes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'parts' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON parts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scenes' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON scenes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE comment_read_states ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comment_read_states' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comment_read_states FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE comp_revisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comp_revisions' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON comp_revisions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'metadata' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON metadata FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE private_calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'private_calendar_events' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON private_calendar_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Realtime 활성화 (이미 추가되어 있으면 에러 무시)
-- ============================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE scenes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comp_revisions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE episodes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE parts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 다중 선택 일괄 작업 RPC (2026-04-22, spec 2026-04-22-bulk-operations-ux-design.md)
-- ============================================================

-- 완료 메타 시맨틱 (PR #32 Codex 리뷰 #2 반영):
--  - completedBy/At 키 부재           → 메타 건드리지 않음 (토글 방향이 완료 상태를 바꾸지 않을 때)
--  - 키 존재 AND 값이 NULL/빈 문자열  → metadata 행 DELETE (4단계 완료 해제)
--  - 키 존재 AND 값이 둘 다 있음      → metadata 행 UPSERT (4단계 전부 완료)
CREATE OR REPLACE FUNCTION bulk_update_scene_stages(
  p_updates jsonb,
  p_updated_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  v_uuid uuid;
  v_stage text;
  v_value boolean;
  v_has_meta_keys boolean;
  v_completed_by text;
  v_completed_at_text text;
  v_completed_at timestamptz;
  v_meta_value text;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    -- 모든 파싱/캐스팅을 BEGIN 블록 안으로 이동 — 한 항목의 malformed 입력(invalid UUID,
    -- invalid boolean 등)이 RPC 전체를 실패시키지 않고 해당 row만 실패로 기록되도록 보장.
    -- (Codex 리뷰 #13) 매 루프 시작 시 v_uuid를 NULL로 리셋해 이전 루프 값이 실패 row에
    -- 잘못 매핑되는 것도 방지.
    v_uuid := NULL;
    BEGIN
      v_uuid := (u->>'sceneUuid')::uuid;
      v_stage := u->>'stage';
      v_value := (u->>'value')::boolean;
      v_has_meta_keys := (u ? 'completedBy') OR (u ? 'completedAt');
      v_completed_by := u->>'completedBy';
      v_completed_at_text := u->>'completedAt';

      IF v_stage NOT IN ('lo','done','review','png') THEN
        RAISE EXCEPTION 'invalid stage: %', v_stage;
      END IF;

      UPDATE scenes SET
        lo     = CASE WHEN v_stage = 'lo'     THEN v_value ELSE lo END,
        done   = CASE WHEN v_stage = 'done'   THEN v_value ELSE done END,
        review = CASE WHEN v_stage = 'review' THEN v_value ELSE review END,
        png    = CASE WHEN v_stage = 'png'    THEN v_value ELSE png END,
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      IF v_has_meta_keys THEN
        IF v_completed_by IS NOT NULL AND v_completed_by <> ''
           AND v_completed_at_text IS NOT NULL AND v_completed_at_text <> '' THEN
          -- 명시적 set: UPSERT
          v_completed_at := v_completed_at_text::timestamptz;
          v_meta_value := jsonb_build_object(
            'completedBy', v_completed_by,
            'completedAt', v_completed_at
          )::text;
          INSERT INTO metadata (type, key, value, updated_at)
            VALUES ('scene-completion', v_uuid::text, v_meta_value, now())
            ON CONFLICT (type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        ELSE
          -- 명시적 clear: null/빈 문자열 조합 → metadata 행 제거
          DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;
        END IF;
      END IF;
      -- v_has_meta_keys = false: 메타 건드리지 않음 (완료 여부 미변동 토글)

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- v_uuid가 파싱 전에 실패하면 NULL 반환 (이전 루프 값 오염 방지를 위해 위에서 reset)
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bulk_delete_scenes(
  p_uuids uuid[],
  p_deleted_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  FOREACH v_uuid IN ARRAY p_uuids LOOP
    BEGIN
      DELETE FROM scenes WHERE id = v_uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;
      DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bulk_update_scene_fields(
  p_updates jsonb,
  p_updated_by text
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  f jsonb;
  v_uuid uuid;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    -- UUID 파싱도 BEGIN 블록 안으로 이동 (Codex 리뷰 #14).
    v_uuid := NULL;
    BEGIN
      v_uuid := (u->>'sceneUuid')::uuid;
      f := u->'fields';

      UPDATE scenes SET
        assignee       = COALESCE(f->>'assignee', assignee),
        memo           = COALESCE(f->>'memo', memo),
        layout         = COALESCE(f->>'layout', layout),
        storyboard_url = COALESCE(f->>'storyboardUrl', storyboard_url),
        guide_url      = COALESCE(f->>'guideUrl', guide_url),
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_scene_stages(jsonb, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_delete_scenes(uuid[], text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION bulk_update_scene_fields(jsonb, text)  TO anon, authenticated;

-- ============================================================
-- 최근 작업 위젯 — activity_log (2026-04-27)
-- spec: docs/superpowers/specs/2026-04-27-recent-activity-widget-design.md
-- ============================================================

-- 1. activity_log 테이블
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                -- 누가 (users.id 참조, 단 FK 안 검 — 신뢰 모델 §3.4)
  user_name TEXT NOT NULL,              -- 표시용 (조인 비용 ↓, 이름 변경되어도 옛 기록은 옛 이름)
  action_type TEXT NOT NULL,            -- 14종 enum (spec §3.2)
  action_group TEXT NOT NULL,           -- 'progress' | 'memo' | 'scene' | 'etc'
  scene_id UUID,                        -- scenes.id (UUID, nullable). comments.scene_id 는 TEXT 라 다름 — 본 테이블은 UUID 통일
  scene_label TEXT,                     -- 표시용 "EP01 A씬 #5"
  episode_number INTEGER,
  department TEXT,                      -- 'bg' | 'acting'
  detail JSONB,                         -- 자유 메타 (예: { value: true })
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created  ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user     ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_scene    ON activity_log(scene_id);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'activity_log' AND policyname = 'allow_all') THEN
    CREATE POLICY "allow_all" ON activity_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. record_activity RPC (앱 INSERT 헬퍼)
CREATE OR REPLACE FUNCTION record_activity(
  p_user_id TEXT,
  p_user_name TEXT,
  p_action_type TEXT,
  p_action_group TEXT,
  p_scene_id UUID,
  p_scene_label TEXT,
  p_episode_number INTEGER,
  p_department TEXT,
  p_detail JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO activity_log (
    user_id, user_name, action_type, action_group,
    scene_id, scene_label, episode_number, department, detail
  ) VALUES (
    p_user_id, p_user_name, p_action_type, p_action_group,
    p_scene_id, p_scene_label, p_episode_number, p_department, p_detail
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION record_activity(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER, TEXT, JSONB)
  TO anon, authenticated;

-- 3. activity_log_stats RPC (히트맵 24x7 격자 집계 + 그룹별 카운트)
-- KST 기준으로 day_of_week / hour 추출 (PostgreSQL EXTRACT(dow): 0=일 ~ 6=토)
-- v1.14.1: 그룹별 카운트(progress/memo/scene/etc) 추가 — 히트맵 셀 호버 툴팁용
DROP FUNCTION IF EXISTS activity_log_stats(TIMESTAMPTZ, TEXT[], TEXT);
CREATE OR REPLACE FUNCTION activity_log_stats(
  p_since TIMESTAMPTZ,
  p_groups TEXT[] DEFAULT NULL,        -- NULL이면 전체
  p_department TEXT DEFAULT NULL       -- NULL이면 전체
) RETURNS TABLE (
  day_of_week INTEGER,
  hour INTEGER,
  count INTEGER,
  count_progress INTEGER,
  count_memo INTEGER,
  count_scene INTEGER,
  count_etc INTEGER
)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT
    EXTRACT(dow  FROM (created_at AT TIME ZONE 'Asia/Seoul'))::integer AS day_of_week,
    EXTRACT(hour FROM (created_at AT TIME ZONE 'Asia/Seoul'))::integer AS hour,
    COUNT(*)::integer AS count,
    COUNT(*) FILTER (WHERE action_group = 'progress')::integer AS count_progress,
    COUNT(*) FILTER (WHERE action_group = 'memo')::integer     AS count_memo,
    COUNT(*) FILTER (WHERE action_group = 'scene')::integer    AS count_scene,
    COUNT(*) FILTER (WHERE action_group = 'etc')::integer      AS count_etc
  FROM activity_log
  WHERE created_at >= p_since
    AND (p_groups IS NULL OR action_group = ANY(p_groups))
    AND (p_department IS NULL OR department = p_department)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION activity_log_stats(TIMESTAMPTZ, TEXT[], TEXT) TO anon, authenticated;

-- 4. 보존 정책 — 1년 자동 정리 (pg_cron 사용, Supabase Pro 활성화됨)
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM activity_log WHERE created_at < now() - INTERVAL '1 year';
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 기존 같은 이름 cron 이 있으면 unschedule 후 재등록 (재실행 안전)
DO $$ BEGIN
  PERFORM cron.unschedule('activity-log-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'activity-log-cleanup',
  '0 4 * * *',                          -- 매일 새벽 4시 (KST 13시 ≈ UTC 04시)
  $$ SELECT cleanup_old_activity_logs(); $$
);

-- 5. bulk RPC 시그니처 확장 — 활동 기록 파라미터 추가
-- 기존 함수를 CREATE OR REPLACE 로 덮어씀. user_name 이 NULL 이면 활동 기록 생략 (호환성).

CREATE OR REPLACE FUNCTION bulk_update_scene_stages(
  p_updates jsonb,
  p_updated_by text,
  p_user_name text DEFAULT NULL          -- 신규: 활동 기록용
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  v_uuid uuid;
  v_stage text;
  v_value boolean;
  v_has_meta_keys boolean;
  v_completed_by text;
  v_completed_at_text text;
  v_completed_at timestamptz;
  v_meta_value text;
  v_scene_label text;
  v_episode_number integer;
  v_department text;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_uuid := NULL;
    BEGIN
      v_uuid := (u->>'sceneUuid')::uuid;
      v_stage := u->>'stage';
      v_value := (u->>'value')::boolean;
      v_has_meta_keys := (u ? 'completedBy') OR (u ? 'completedAt');
      v_completed_by := u->>'completedBy';
      v_completed_at_text := u->>'completedAt';
      v_scene_label := u->>'sceneLabel';
      v_episode_number := COALESCE((u->>'episodeNumber')::integer, NULL);
      v_department := u->>'department';

      IF v_stage NOT IN ('lo','done','review','png') THEN
        RAISE EXCEPTION 'invalid stage: %', v_stage;
      END IF;

      UPDATE scenes SET
        lo     = CASE WHEN v_stage = 'lo'     THEN v_value ELSE lo END,
        done   = CASE WHEN v_stage = 'done'   THEN v_value ELSE done END,
        review = CASE WHEN v_stage = 'review' THEN v_value ELSE review END,
        png    = CASE WHEN v_stage = 'png'    THEN v_value ELSE png END,
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      IF v_has_meta_keys THEN
        IF v_completed_by IS NOT NULL AND v_completed_by <> ''
           AND v_completed_at_text IS NOT NULL AND v_completed_at_text <> '' THEN
          v_completed_at := v_completed_at_text::timestamptz;
          v_meta_value := jsonb_build_object(
            'completedBy', v_completed_by,
            'completedAt', v_completed_at
          )::text;
          INSERT INTO metadata (type, key, value, updated_at)
            VALUES ('scene-completion', v_uuid::text, v_meta_value, now())
            ON CONFLICT (type, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
        ELSE
          DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;
        END IF;
      END IF;

      -- 신규: 활동 기록 (p_user_name 이 NULL 아닐 때만, 실패해도 본 작업은 성공)
      IF p_user_name IS NOT NULL THEN
        BEGIN
          PERFORM record_activity(
            p_updated_by, p_user_name,
            'stage_' || v_stage, 'progress',
            v_uuid, v_scene_label, v_episode_number, v_department,
            jsonb_build_object('value', v_value)
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_scene_stages(jsonb, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bulk_delete_scenes(
  p_uuids uuid[],
  p_deleted_by text,
  p_user_name text DEFAULT NULL,
  p_meta jsonb DEFAULT '[]'::jsonb        -- 각 element: { sceneUuid, sceneLabel, episodeNumber, department }
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_uuid uuid;
  m_elem jsonb;
  v_scene_label text;
  v_episode_number integer;
  v_department text;
BEGIN
  FOREACH v_uuid IN ARRAY p_uuids LOOP
    BEGIN
      DELETE FROM scenes WHERE id = v_uuid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;
      DELETE FROM metadata WHERE type = 'scene-completion' AND key = v_uuid::text;

      IF p_user_name IS NOT NULL THEN
        m_elem := NULL;
        FOR m_elem IN SELECT jsonb_array_elements(p_meta) LOOP
          IF (m_elem->>'sceneUuid')::uuid = v_uuid THEN EXIT; END IF;
          m_elem := NULL;
        END LOOP;
        IF m_elem IS NOT NULL THEN
          v_scene_label := m_elem->>'sceneLabel';
          v_episode_number := COALESCE((m_elem->>'episodeNumber')::integer, NULL);
          v_department := m_elem->>'department';
        ELSE
          v_scene_label := NULL;
          v_episode_number := NULL;
          v_department := NULL;
        END IF;
        BEGIN
          PERFORM record_activity(
            p_deleted_by, p_user_name,
            'scene_delete', 'scene',
            v_uuid, v_scene_label, v_episode_number, v_department,
            '{}'::jsonb
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_delete_scenes(uuid[], text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION bulk_update_scene_fields(
  p_updates jsonb,
  p_updated_by text,
  p_user_name text DEFAULT NULL
) RETURNS TABLE (scene_uuid uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  u jsonb;
  f jsonb;
  v_uuid uuid;
  v_scene_label text;
  v_episode_number integer;
  v_department text;
  v_field_changed text;
  v_field_value text;
BEGIN
  FOR u IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    v_uuid := NULL;
    BEGIN
      v_uuid := (u->>'sceneUuid')::uuid;
      f := u->'fields';
      v_scene_label := u->>'sceneLabel';
      v_episode_number := COALESCE((u->>'episodeNumber')::integer, NULL);
      v_department := u->>'department';

      UPDATE scenes SET
        assignee       = COALESCE(f->>'assignee', assignee),
        memo           = COALESCE(f->>'memo', memo),
        layout         = COALESCE(f->>'layout', layout),
        storyboard_url = COALESCE(f->>'storyboardUrl', storyboard_url),
        guide_url      = COALESCE(f->>'guideUrl', guide_url),
        updated_at = now(),
        updated_by = p_updated_by
      WHERE id = v_uuid;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'scene not found: %', v_uuid;
      END IF;

      -- 변경된 필드별 활동 기록 (간단화 위해 첫 번째 필드만 기록)
      IF p_user_name IS NOT NULL THEN
        IF f ? 'memo' THEN v_field_changed := 'memo_update'; v_field_value := f->>'memo';
        ELSIF f ? 'assignee' THEN v_field_changed := 'assignee_change'; v_field_value := f->>'assignee';
        ELSIF f ? 'layout' THEN v_field_changed := 'layout_change'; v_field_value := f->>'layout';
        ELSIF f ? 'storyboardUrl' THEN v_field_changed := 'image_upload_storyboard'; v_field_value := NULL;
        ELSIF f ? 'guideUrl' THEN v_field_changed := 'image_upload_guide'; v_field_value := NULL;
        ELSE v_field_changed := NULL;
        END IF;

        IF v_field_changed IS NOT NULL THEN
          BEGIN
            PERFORM record_activity(
              p_updated_by, p_user_name,
              v_field_changed,
              CASE
                WHEN v_field_changed = 'memo_update' THEN 'memo'
                ELSE 'etc'
              END,
              v_uuid, v_scene_label, v_episode_number, v_department,
              CASE WHEN v_field_value IS NOT NULL THEN jsonb_build_object('to', v_field_value) ELSE '{}'::jsonb END
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
      END IF;

      scene_uuid := v_uuid;
      success := TRUE;
      error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      scene_uuid := v_uuid;
      success := FALSE;
      error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_scene_fields(jsonb, text, text) TO anon, authenticated;
-- v1.23.0 — get_activity_stats_v2 (시간 단위 확장) + get_activity_insights (분석 모달)
-- 적용 위치: Supabase SQL editor에서 그대로 실행 (CREATE OR REPLACE 이므로 재실행 안전)
-- 기존 get_activity_stats 시그니처는 변경하지 않음 (호환성). 새 함수 2개 추가.

-- ============================================================================
-- 1. get_activity_stats_v2 — 위젯 히트맵/막대 데이터 소스
-- ============================================================================
CREATE OR REPLACE FUNCTION get_activity_stats_v2(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_granularity text,            -- 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals'
  p_department text DEFAULT NULL,
  p_groups text[] DEFAULT NULL
) RETURNS TABLE (
  bucket1 int,
  bucket2 int,
  total int,
  count_progress int,
  count_memo int,
  count_scene int,
  count_etc int
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_granularity = 'hour-of-day-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(dow  FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket1,
        EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-totals' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        0 AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_activity_stats_v2(timestamptz, timestamptz, text, text, text[]) TO anon, authenticated;

-- ============================================================================
-- 2. get_activity_insights — 분석 모달 7카드 raw data 한 번에 반환
-- ============================================================================
CREATE OR REPLACE FUNCTION get_activity_insights(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_department text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- 1) monthDowGrid: 12개월 × 7요일 (1년치 종합 히트맵)
  --    NOTE (codex 4·14차 P2 인지): rolling 12개월 윈도우에서 같은 month 가 시작·끝에 overlap 가능.
  --    v1.23.0 은 month bucket 합산을 의도적으로 유지 — 카드 부제로 사용자 안내 추가.
  --    v1.24 에서 (year, month) 튜플 그룹핑 + 별도 분석 페이지로 정밀 분리 예정.
  v_result := v_result || jsonb_build_object('monthDowGrid', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('month', m, 'dow', d, 'count', c))
    FROM (
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS m,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS d,
        COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY m, d
    ) t
  ), '[]'::jsonb));

  -- 2) userBreakdown: 활동 많은 상위 5명 (담당자별 비중)
  v_result := v_result || jsonb_build_object('userBreakdown', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'userName', user_name, 'count', c) ORDER BY c DESC)
    FROM (
      SELECT user_id, MAX(user_name) AS user_name, COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT 5
    ) t
  ), '[]'::jsonb));

  -- 3) userBreakdownTotal: 전체 합계 ("기타 N명" 계산용)
  v_result := v_result || jsonb_build_object('userBreakdownTotal', COALESCE((
    SELECT COUNT(*)::int FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ), 0));

  -- 4) stageBreakdown: LO/완료/검수/PNG 카운트 (단계별 도넛)
  v_result := v_result || jsonb_build_object('stageBreakdown', (
    SELECT jsonb_build_object(
      'lo',     COUNT(*) FILTER (WHERE action_type='stage_lo'),
      'done',   COUNT(*) FILTER (WHERE action_type='stage_done'),
      'review', COUNT(*) FILTER (WHERE action_type='stage_review'),
      'png',    COUNT(*) FILTER (WHERE action_type='stage_png')
    )
    FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ));

  -- 5) topScenes: 활동 많은 씬 Top 10 (병목 씬 발견)
  v_result := v_result || jsonb_build_object('topScenes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sceneId', scene_id,
      'sceneLabel', scene_label,
      'episodeNumber', episode_number,
      'total', total,
      'revCount', rev_count,
      'memoCount', memo_count,
      'stageCount', stage_count
    ) ORDER BY total DESC)
    FROM (
      SELECT
        scene_id,
        MAX(scene_label)        AS scene_label,
        MAX(episode_number)     AS episode_number,
        COUNT(*)::int           AS total,
        COUNT(*) FILTER (WHERE action_type IN ('revision_add','revision_resolve'))::int AS rev_count,
        COUNT(*) FILTER (WHERE action_type IN ('memo_update','comment_add'))::int       AS memo_count,
        COUNT(*) FILTER (WHERE action_group='progress')::int                            AS stage_count
      FROM activity_log
      WHERE scene_id IS NOT NULL
        AND created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY scene_id
      ORDER BY total DESC
      LIMIT 10
    ) t
  ), '[]'::jsonb));

  -- 6) weeklyCompleted: 주별 PNG 도달 씬 수 (최근 12주)
  v_result := v_result || jsonb_build_object('weeklyCompleted', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('weekStart', week_start, 'completedSceneCount', cnt) ORDER BY week_start)
    FROM (
      SELECT
        date_trunc('week', created_at AT TIME ZONE 'Asia/Seoul')::date AS week_start,
        COUNT(DISTINCT scene_id)::int AS cnt
      FROM activity_log
      WHERE action_type = 'stage_png'
        AND scene_id IS NOT NULL
        AND created_at >= GREATEST(p_range_start, now() - INTERVAL '12 weeks')
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY week_start
    ) t
  ), '[]'::jsonb));

  -- 7) sceneFlow + episodeProgress 는 활동 로그만으로는 정확 산출 불가 (씬 단계 첫 도달 timestamp 필요).
  --    v1.23.0 에서는 클라이언트가 useDataStore.episodes/scenes 로 보강하거나 임시 더미 표시.
  --    응답 형태 일관성 위해 빈 객체/배열 반환.
  v_result := v_result || jsonb_build_object(
    'sceneFlow', '{}'::jsonb,
    'episodeProgress', '[]'::jsonb
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_activity_insights(timestamptz, timestamptz, text) TO anon, authenticated;
