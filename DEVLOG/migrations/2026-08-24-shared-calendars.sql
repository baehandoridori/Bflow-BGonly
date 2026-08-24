-- DEVLOG/migrations/2026-08-24-shared-calendars.sql
-- B flow 공유 캘린더 (PM 일정관리) — PR2 데이터 계층
-- 설계서: docs/superpowers/specs/2026-08-24-calendar-pm-shared-calendars-design.md §4·§4.1
-- 재실행 안전(idempotent). 라이브 적용은 PR2 머지 직후·배포 전 별도 게이트(한솔 확인 후).

-- ── 1) 신규 테이블 5개 (설계서 §4 DDL 그대로) ──────────────────
CREATE TABLE IF NOT EXISTS calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6C5CE7',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','members','team')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  is_personal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_personal ON calendars(owner_id) WHERE is_personal;
CREATE TABLE IF NOT EXISTS calendar_members (
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (calendar_id, user_id)
);
CREATE TABLE IF NOT EXISTS calendar_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  memo TEXT,
  tag_id UUID REFERENCES calendar_tags(id) ON DELETE SET NULL,
  all_day BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TEXT,          -- 'HH:MM' KST, all_day=false 일 때만
  end_time TEXT,
  linked_episode INTEGER,
  linked_part TEXT,
  linked_sheet_name TEXT,
  linked_scene_id TEXT,
  linked_department TEXT,
  linked_todo_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(calendar_id, start_date, end_date);
CREATE TABLE IF NOT EXISTS calendar_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_name TEXT,
  calendar_id UUID,          -- FK 없음: 캘린더 삭제 후에도 알림 문구 보존
  calendar_name TEXT,
  event_id UUID,
  event_title TEXT,
  event_date TEXT,           -- 이동 대상 날짜 YYYY-MM-DD
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  detail TEXT,               -- 예: '9/25 → 9/26'
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_calendar_notif_recipient
  ON calendar_notifications(recipient_id, created_at DESC);

-- ── 2) 캘린더 멤버 원자적 전체 교체 RPC ─────────────────────────
-- DELETE + INSERT 가 함수 호출 한 트랜잭션에서 실행되어, INSERT 실패 시 기존 멤버도 복원된다.
CREATE OR REPLACE FUNCTION public.replace_calendar_members(
  p_calendar_id UUID,
  p_members JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'p_members must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_members) AS member(user_id TEXT, can_edit BOOLEAN)
    WHERE member.user_id IS NULL
       OR btrim(member.user_id) = ''
       OR member.can_edit IS NULL
  ) THEN
    RAISE EXCEPTION 'Each calendar member requires user_id and can_edit' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT member.user_id
    FROM jsonb_to_recordset(p_members) AS member(user_id TEXT, can_edit BOOLEAN)
    GROUP BY member.user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate calendar member user_id' USING ERRCODE = '23505';
  END IF;

  -- 같은 캘린더의 전체 교체 호출을 직렬화한다. 잠금은 RPC 트랜잭션 종료까지 유지된다.
  PERFORM 1
  FROM calendars
  WHERE id = p_calendar_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar % not found', p_calendar_id USING ERRCODE = '23503';
  END IF;

  DELETE FROM calendar_members WHERE calendar_id = p_calendar_id;

  INSERT INTO calendar_members (calendar_id, user_id, can_edit)
  SELECT p_calendar_id, member.user_id, member.can_edit
  FROM jsonb_to_recordset(p_members) AS member(user_id TEXT, can_edit BOOLEAN);
END;
$$;

COMMENT ON FUNCTION public.replace_calendar_members(UUID, JSONB) IS
  '캘린더별 부모 행 잠금으로 직렬화하는 멤버 전체 교체 atomic RPC. 빈 배열은 전체 삭제, 잘못된 입력·없는 캘린더는 변경 전 거부.';

-- ── 2-1) 태그 원자적 전체 교체 RPC ────────────────────────────
-- 함수 안의 예외는 호출 전체를 rollback한다. 따라서 태그 삭제의 FK SET NULL도 후속 실패 시 복구된다.
CREATE OR REPLACE FUNCTION public.replace_calendar_tags(p_tags JSONB)
RETURNS TABLE (id UUID, name TEXT, color TEXT, sort_order INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_tags IS NULL OR jsonb_typeof(p_tags) <> 'array' THEN
    RAISE EXCEPTION 'p_tags must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_tags) AS tag(value)
    WHERE jsonb_typeof(tag.value) <> 'object'
       OR NOT (tag.value ? 'name')
       OR jsonb_typeof(tag.value->'name') <> 'string'
       OR btrim(tag.value->>'name') = ''
       OR NOT (tag.value ? 'color')
       OR jsonb_typeof(tag.value->'color') <> 'string'
       OR btrim(tag.value->>'color') = ''
       OR NOT (tag.value ? 'sort_order')
       OR jsonb_typeof(tag.value->'sort_order') <> 'number'
       OR tag.value->>'sort_order' !~ '^-?[0-9]+$'
       OR (
         tag.value ? 'id'
         AND (
           jsonb_typeof(tag.value->'id') <> 'string'
           OR tag.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         )
       )
  ) THEN
    RAISE EXCEPTION 'Each calendar tag requires name, color, and sort_order; id must be a UUID when provided'
      USING ERRCODE = '22023';
  END IF;

  -- 구조·필드 검증 뒤, 데이터 검증과 교체 전체를 동시 saveTags 호출과 상호 배제한다.
  LOCK TABLE calendar_tags IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT submitted.id
    FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
    WHERE submitted.id IS NOT NULL
    GROUP BY submitted.id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate calendar tag id' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT submitted.name
    FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
    GROUP BY submitted.name
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate calendar tag name' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
    LEFT JOIN calendar_tags AS current ON current.id = submitted.id
    WHERE submitted.id IS NOT NULL AND current.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Unknown calendar tag id' USING ERRCODE = 'P0002';
  END IF;

  -- 제출 목록에 없는 태그만 삭제한다. calendar_events.tag_id 는 FK의 ON DELETE SET NULL을 따른다.
  DELETE FROM calendar_tags AS target
  WHERE target.id NOT IN (
    SELECT submitted.id
    FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
    WHERE submitted.id IS NOT NULL
  );

  -- 기존 이름을 transaction-local 임시 이름으로 옮겨 이름 swap도 UNIQUE 충돌 없이 처리한다.
  UPDATE calendar_tags AS target
  SET name = format('__calendar_tags_tmp_%s_%s', txid_current(), target.id)
  FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
  WHERE submitted.id IS NOT NULL AND target.id = submitted.id;

  UPDATE calendar_tags AS target
  SET name = submitted.name,
      color = submitted.color,
      sort_order = submitted.sort_order
  FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
  WHERE submitted.id IS NOT NULL AND target.id = submitted.id;

  INSERT INTO calendar_tags (name, color, sort_order)
  SELECT submitted.name, submitted.color, submitted.sort_order
  FROM jsonb_to_recordset(p_tags) AS submitted(id UUID, name TEXT, color TEXT, sort_order INTEGER)
  WHERE submitted.id IS NULL;

  RETURN QUERY
  SELECT tag.id, tag.name, tag.color, tag.sort_order
  FROM calendar_tags AS tag
  ORDER BY tag.sort_order, tag.id;
END;
$$;

COMMENT ON FUNCTION public.replace_calendar_tags(JSONB) IS
  '태그 최종 목록을 단일 트랜잭션으로 교체. 검증 실패나 후속 실패 시 삭제·수정·FK SET NULL을 함께 rollback한다.';

-- ── 3) RLS allow_all (기존 관례: supabase-init.sql:255-259 의 pg_policies 존재 검사 패턴) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendars','calendar_members','calendar_tags','calendar_events','calendar_notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'allow_all') THEN
      EXECUTE format('CREATE POLICY "allow_all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- ── 4) 태그 시드 4행 (설계서 §4, 한솔이 태그 관리에서 수정 가능) ──
-- marker가 남으므로 관리자가 이름을 바꾸거나 지운 뒤 재실행해도 기본 태그를 되살리지 않는다.
DO $$
BEGIN
  LOCK TABLE metadata IN SHARE ROW EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1
    FROM metadata
    WHERE type = 'migration-seed'
      AND key = 'calendar-tags-v1'
  ) THEN
    INSERT INTO calendar_tags (name, color, sort_order) VALUES
      ('업로드', '#E17055', 0),
      ('가편',   '#74B9FF', 1),
      ('대본',   '#FDCB6E', 2),
      ('회의',   '#A29BFE', 3)
    ON CONFLICT (name) DO NOTHING;

    INSERT INTO metadata (type, key, value)
    VALUES ('migration-seed', 'calendar-tags-v1', 'seeded');
  END IF;
END $$;

-- ── 5) 기존 "나만 보기" 데이터 이관 (설계서 §4.1, 재실행 안전) ──
-- 5-1) private_calendar_events 사용자별 개인 캘린더 upsert
--      (users 에 없는 고아 user_id 는 FK 위반 방지를 위해 제외)
INSERT INTO calendars (name, color, visibility, owner_id, is_personal)
SELECT DISTINCT '개인', '#6C5CE7', 'private', p.user_id, true
FROM private_calendar_events p
JOIN users u ON u.id = p.user_id
ON CONFLICT (owner_id) WHERE is_personal DO NOTHING;

-- 5-2) 이벤트 복사 (id·created_at 유지, all_day=true, color 는 의도적으로 버림 — 설계서 §4.1)
--      구 created_by 는 이름 문자열이라 FK(users.id) 불만족 → 소유자 user_id 로 대체.
--      구 start_date 는 'YYYY-MM-DD 또는 ISO datetime' — 앞 10자만 잘라 DATE 캐스팅.
INSERT INTO calendar_events (id, calendar_id, title, memo, all_day, start_date, end_date,
  linked_episode, linked_part, linked_sheet_name, linked_scene_id, linked_department,
  linked_todo_id, created_by, created_at, updated_at)
SELECT p.id, c.id, p.title, p.memo, true,
  substring(p.start_date, 1, 10)::date, substring(p.end_date, 1, 10)::date,
  p.linked_episode, p.linked_part, p.linked_sheet_name, p.linked_scene_id, p.linked_department,
  p.linked_todo_id, p.user_id, p.created_at, p.updated_at
FROM private_calendar_events p
JOIN calendars c ON c.owner_id = p.user_id AND c.is_personal
WHERE substring(p.start_date, 1, 10) ~ '^\d{4}-\d{2}-\d{2}$'
  AND substring(p.end_date, 1, 10) ~ '^\d{4}-\d{2}-\d{2}$'
ON CONFLICT (id) DO NOTHING;

-- 5-3) private_calendar_events 테이블은 이번엔 남겨둠(롤백 + 구버전 앱 호환 — 설계서 §12).
--      다음 라운드에서 공존 창 델타 재이관 후 DROP.

-- ── 6) Realtime publication 4개 (재실행 시 duplicate_object 흡수) ──
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendars','calendar_members','calendar_events','calendar_notifications'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ── 7) delete_user_cascade 갱신 (2026-06-29 판 전문 복사 + 캘린더 정리 추가) ──
-- 베이스: DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql:33-84
-- (더 최신 재정의가 있으면 그 판을 베이스로 할 것 — Step 1 에서 확인)
CREATE OR REPLACE FUNCTION public.delete_user_cascade(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_admin_id TEXT;
BEGIN
  SELECT name INTO v_user_name FROM users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE scenes         SET assignee = NULL WHERE assignee = v_user_name;
  UPDATE comp_revisions SET assignee = NULL WHERE assignee = v_user_name;

  UPDATE character_costumes
  SET design_assignee = NULLIF(array_to_string(ARRAY(
    SELECT btrim(assignee_name)
    FROM unnest(regexp_split_to_array(design_assignee, '[[:space:]]*,[[:space:]]*')) AS assignee_name
    WHERE btrim(assignee_name) <> ''
      AND btrim(assignee_name) <> v_user_name
  ), ', '), '')
  WHERE design_assignee IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM unnest(regexp_split_to_array(design_assignee, '[[:space:]]*,[[:space:]]*')) AS assignee_name
      WHERE btrim(assignee_name) = v_user_name
    );

  UPDATE character_costumes
  SET rigging_assignee = NULLIF(array_to_string(ARRAY(
    SELECT btrim(assignee_name)
    FROM unnest(regexp_split_to_array(rigging_assignee, '[[:space:]]*,[[:space:]]*')) AS assignee_name
    WHERE btrim(assignee_name) <> ''
      AND btrim(assignee_name) <> v_user_name
  ), ', '), '')
  WHERE rigging_assignee IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM unnest(regexp_split_to_array(rigging_assignee, '[[:space:]]*,[[:space:]]*')) AS assignee_name
      WHERE btrim(assignee_name) = v_user_name
    );

  DELETE FROM personal_todos          WHERE user_id = p_user_id;
  DELETE FROM task_views              WHERE user_id = p_user_id;
  DELETE FROM memos                   WHERE user_id = p_user_id;
  DELETE FROM private_calendar_events WHERE user_id = p_user_id;

  -- ── 공유 캘린더 정리 (2026-08-24 추가, 설계서 §4) ──
  -- 멤버 교체 RPC와 동일하게 부모→자식 순서로 잠가 교착을 피한다.
  PERFORM c.id
  FROM calendars c
  WHERE c.owner_id = p_user_id
  ORDER BY c.id
  FOR UPDATE;

  -- 작성자 표시는 nullable — FK(NO ACTION) 위반 방지
  UPDATE calendar_events SET created_by = NULL WHERE created_by = p_user_id;
  -- 개인 캘린더는 삭제 (이벤트는 ON DELETE CASCADE)
  DELETE FROM calendars WHERE owner_id = p_user_id AND is_personal;
  -- 공유 캘린더는 팀 자산 보존 — admin(배한솔 우선) 에게 소유 이전
  SELECT id INTO v_admin_id FROM users
  WHERE id <> p_user_id AND role = 'admin'
  ORDER BY (name = '배한솔') DESC, created_at ASC
  LIMIT 1;
  IF v_admin_id IS NOT NULL THEN
    -- 새 소유자가 이미 멤버 행으로 있으면 제거(소유자는 멤버 목록에 두지 않는 규약)
    DELETE FROM calendar_members m USING calendars c
      WHERE m.calendar_id = c.id AND c.owner_id = p_user_id AND m.user_id = v_admin_id;
    UPDATE calendars SET owner_id = v_admin_id, updated_at = now()
      WHERE owner_id = p_user_id;
  ELSE
    DELETE FROM calendars WHERE owner_id = p_user_id;  -- admin 부재(비정상) 폴백
  END IF;
  DELETE FROM calendar_members       WHERE user_id = p_user_id;
  DELETE FROM calendar_notifications WHERE recipient_id = p_user_id;

  DELETE FROM users WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.delete_user_cascade(TEXT) IS
  '사용자 삭제 + 종속 정리 atomic RPC. 씬/리테이크/복장 담당자 비우기 / 개인 데이터 삭제 / 개인 캘린더 삭제·공유 캘린더 admin 이전 / users 삭제를 한 트랜잭션으로. comments·activity_log 는 역사 기록으로 보존.';
