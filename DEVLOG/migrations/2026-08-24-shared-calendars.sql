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

-- ── 1-1) 레거시 개인 일정 사용자 FK ──────────────────────────
-- 기존 고아 행은 다음 정리 라운드까지 보존하되, 새 쓰기와 사용자 삭제가 경합해
-- 고아 행을 더 만들 수 없도록 NOT VALID FK를 건다. NOT VALID도 새 INSERT/UPDATE와
-- 부모 DELETE에는 즉시 적용된다. 구버전 DB에 테이블이 없으면 안전하게 건너뛴다.
DO $$
DECLARE
  v_legacy_user_type OID;
  v_user_id_type OID;
  v_legacy_user_attnum SMALLINT;
  v_user_id_attnum SMALLINT;
  v_existing_constraint RECORD;
BEGIN
  IF pg_catalog.to_regclass('public.private_calendar_events') IS NULL THEN
    RETURN;
  END IF;

  SELECT atttypid, attnum
  INTO v_legacy_user_type, v_legacy_user_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.private_calendar_events'::regclass
    AND attname = 'user_id'
    AND NOT attisdropped;

  SELECT atttypid, attnum
  INTO v_user_id_type, v_user_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.users'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF v_legacy_user_type IS DISTINCT FROM v_user_id_type
     OR v_legacy_user_attnum IS NULL
     OR v_user_id_attnum IS NULL THEN
    RAISE EXCEPTION 'private_calendar_events.user_id and users.id must have the same type'
      USING ERRCODE = '42804';
  END IF;

  SELECT constraint_row.*
  INTO v_existing_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.private_calendar_events'::regclass
    AND constraint_row.conname = 'private_calendar_events_user_id_fkey';

  IF FOUND THEN
    IF v_existing_constraint.contype <> 'f'
       OR v_existing_constraint.confrelid <> 'public.users'::regclass
       OR v_existing_constraint.conkey <> ARRAY[v_legacy_user_attnum]::SMALLINT[]
       OR v_existing_constraint.confkey <> ARRAY[v_user_id_attnum]::SMALLINT[]
       OR v_existing_constraint.confdeltype <> 'c' THEN
      RAISE EXCEPTION 'Constraint private_calendar_events_user_id_fkey has an incompatible definition'
        USING ERRCODE = '42710';
    END IF;
  ELSE
    ALTER TABLE public.private_calendar_events
      ADD CONSTRAINT private_calendar_events_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES public.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

-- ── 2) 캘린더 관리 쓰기 권한 원자적 검증 RPC ────────────────────
-- IPC 사전 검사는 친절한 오류용이다. 실제 관리 권한은 캘린더와 actor 행을
-- 같은 트랜잭션에서 잠근 뒤 재확인하여 소유권 이전·admin 강등 TOCTOU를 막는다.
CREATE OR REPLACE FUNCTION public.update_calendar_authorized(
  p_actor_id TEXT,
  p_calendar_id UUID,
  p_updates JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY['name', 'color', 'visibility'];
  v_calendar calendars%ROWTYPE;
  v_actor_role TEXT;
  v_requested_visibility TEXT;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'p_updates must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_updates) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'p_updates contains an unknown or immutable field' USING ERRCODE = '22023';
  END IF;
  IF p_updates ? 'name'
     AND (jsonb_typeof(p_updates->'name') IS DISTINCT FROM 'string'
          OR btrim(p_updates->>'name') = '') THEN
    RAISE EXCEPTION 'Calendar name must be a non-empty string' USING ERRCODE = '22023';
  END IF;
  IF p_updates ? 'color'
     AND (jsonb_typeof(p_updates->'color') IS DISTINCT FROM 'string'
          OR btrim(p_updates->>'color') = '') THEN
    RAISE EXCEPTION 'Calendar color must be a non-empty string' USING ERRCODE = '22023';
  END IF;
  IF p_updates ? 'visibility' THEN
    IF jsonb_typeof(p_updates->'visibility') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Calendar visibility must be a string' USING ERRCODE = '22023';
    END IF;
    v_requested_visibility := p_updates->>'visibility';
    IF v_requested_visibility NOT IN ('private', 'members', 'team') THEN
      RAISE EXCEPTION 'Invalid calendar visibility' USING ERRCODE = '22023';
    END IF;
  END IF;

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;

  SELECT candidate.* INTO v_calendar
  FROM calendars AS candidate
  WHERE candidate.id = p_calendar_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar % not found', p_calendar_id USING ERRCODE = '23503';
  END IF;

  -- delete_user_cascade와 관리 writer도 calendar→children→user 순서를 유지한다.
  SELECT actor.role INTO v_actor_role
  FROM users AS actor
  WHERE actor.id = p_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session actor % not found', p_actor_id USING ERRCODE = '42501';
  END IF;

  IF v_calendar.is_personal THEN
    IF v_calendar.owner_id <> p_actor_id THEN
      RAISE EXCEPTION 'Personal calendar update permission denied' USING ERRCODE = '42501';
    END IF;
  ELSIF v_calendar.owner_id <> p_actor_id
        AND v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Calendar update permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT v_calendar.is_personal
     AND v_requested_visibility = 'team'
     AND v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can make a team calendar' USING ERRCODE = '42501';
  END IF;

  UPDATE calendars AS target
  SET name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE v_calendar.name END,
      color = CASE WHEN p_updates ? 'color' THEN p_updates->>'color' ELSE v_calendar.color END,
      visibility = CASE
        WHEN NOT v_calendar.is_personal AND p_updates ? 'visibility'
          THEN v_requested_visibility
        ELSE v_calendar.visibility
      END,
      updated_at = now()
  WHERE target.id = p_calendar_id;

  IF NOT v_calendar.is_personal
     AND p_updates ? 'visibility'
     AND v_requested_visibility = 'private' THEN
    DELETE FROM calendar_members
    WHERE calendar_id = p_calendar_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.update_calendar_authorized(TEXT, UUID, JSONB) IS
  '캘린더→멤버→actor 순으로 잠근 뒤 owner/admin 관리 권한과 team 공개 권한을 재확인하고 private 전환 시 멤버를 함께 제거하는 캘린더 수정 RPC.';

CREATE OR REPLACE FUNCTION public.delete_calendar_authorized(
  p_actor_id TEXT,
  p_calendar_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calendar calendars%ROWTYPE;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

  -- event writer·delete_user_cascade와 동일한 부모→자식 테이블 잠금 순서다.
  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;

  SELECT candidate.* INTO v_calendar
  FROM calendars AS candidate
  WHERE candidate.id = p_calendar_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar % not found', p_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT actor.role INTO v_actor_role
  FROM users AS actor
  WHERE actor.id = p_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session actor % not found', p_actor_id USING ERRCODE = '42501';
  END IF;

  IF v_calendar.is_personal THEN
    RAISE EXCEPTION 'Personal calendars cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF v_calendar.owner_id <> p_actor_id
     AND v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Calendar delete permission denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM calendars AS target WHERE target.id = p_calendar_id;
END;
$$;

COMMENT ON FUNCTION public.delete_calendar_authorized(TEXT, UUID) IS
  '캘린더→actor 순으로 잠근 뒤 개인 캘린더 불변식과 owner/admin 관리 권한을 재확인하는 캘린더 삭제 RPC.';

-- 예전 2인자 함수가 적용된 개발 DB에서도 actor 없는 우회 경로를 남기지 않는다.
DROP FUNCTION IF EXISTS public.replace_calendar_members(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.replace_calendar_members_authorized(
  p_actor_id TEXT,
  p_calendar_id UUID,
  p_members JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calendar calendars%ROWTYPE;
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;
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

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;

  SELECT candidate.* INTO v_calendar
  FROM calendars AS candidate
  WHERE candidate.id = p_calendar_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar % not found', p_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT actor.role INTO v_actor_role
  FROM users AS actor
  WHERE actor.id = p_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session actor % not found', p_actor_id USING ERRCODE = '42501';
  END IF;

  IF v_calendar.is_personal THEN
    RAISE EXCEPTION 'Personal calendars cannot have members' USING ERRCODE = '42501';
  END IF;
  IF v_calendar.owner_id <> p_actor_id
     AND v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Calendar member management permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_calendar.visibility = 'private'
     AND jsonb_array_length(p_members) > 0 THEN
    RAISE EXCEPTION 'Private calendars cannot have members' USING ERRCODE = '22023';
  END IF;

  DELETE FROM calendar_members WHERE calendar_id = p_calendar_id;

  INSERT INTO calendar_members (calendar_id, user_id, can_edit)
  SELECT p_calendar_id, member.user_id, member.can_edit
  FROM jsonb_to_recordset(p_members) AS member(user_id TEXT, can_edit BOOLEAN)
  WHERE member.user_id <> v_calendar.owner_id;
END;
$$;

COMMENT ON FUNCTION public.replace_calendar_members_authorized(TEXT, UUID, JSONB) IS
  '캘린더→멤버→actor 순으로 잠근 뒤 개인/private 캘린더 불변식과 owner/admin 권한을 재확인하는 멤버 전체 교체 atomic RPC.';

-- ── 2-1) 캘린더 + 초기 멤버 원자적 생성 RPC ────────────────────
-- 캘린더와 초기 멤버를 한 RPC 트랜잭션에서 기록한다. 멤버 FK 실패를 포함해
-- 어느 단계든 실패하면 부모 캘린더 INSERT도 함께 롤백된다.
CREATE OR REPLACE FUNCTION public.create_calendar_with_members_authorized(
  p_actor_id TEXT,
  p_calendar JSONB,
  p_members JSONB
)
RETURNS SETOF calendars
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY['name', 'color', 'visibility'];
  v_required_keys CONSTANT TEXT[] := ARRAY['name', 'color', 'visibility'];
  v_member_allowed_keys CONSTANT TEXT[] := ARRAY['user_id', 'can_edit'];
  v_visibility TEXT;
  v_actor_role TEXT;
  v_created calendars%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

  IF p_calendar IS NULL OR jsonb_typeof(p_calendar) <> 'object' THEN
    RAISE EXCEPTION 'p_calendar must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_calendar) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'p_calendar contains an unknown or immutable field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_required_keys) AS required(key)
    WHERE NOT (p_calendar ? required.key)
  ) THEN
    RAISE EXCEPTION 'p_calendar is missing a canonical field' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_calendar->'name') IS DISTINCT FROM 'string'
     OR btrim(p_calendar->>'name') = ''
     OR jsonb_typeof(p_calendar->'color') IS DISTINCT FROM 'string'
     OR btrim(p_calendar->>'color') = ''
     OR jsonb_typeof(p_calendar->'visibility') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Calendar name, color, and visibility must be non-empty strings' USING ERRCODE = '22023';
  END IF;

  v_visibility := p_calendar->>'visibility';
  IF v_visibility NOT IN ('private', 'members', 'team') THEN
    RAISE EXCEPTION 'Invalid calendar visibility' USING ERRCODE = '22023';
  END IF;

  IF p_members IS NULL OR jsonb_typeof(p_members) <> 'array' THEN
    RAISE EXCEPTION 'p_members must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_members) AS item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Each calendar member must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_members) AS item(value)
    CROSS JOIN LATERAL jsonb_object_keys(item.value) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_member_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'A calendar member contains an unknown field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_members) AS item(value)
    WHERE NOT (item.value ? 'user_id')
       OR NOT (item.value ? 'can_edit')
       OR jsonb_typeof(item.value->'user_id') IS DISTINCT FROM 'string'
       OR btrim(item.value->>'user_id') = ''
       OR jsonb_typeof(item.value->'can_edit') IS DISTINCT FROM 'boolean'
  ) THEN
    RAISE EXCEPTION 'Each calendar member requires user_id and can_edit' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT item.value->>'user_id'
    FROM jsonb_array_elements(p_members) AS item(value)
    GROUP BY item.value->>'user_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate calendar member user_id' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_members) AS item(value)
    WHERE item.value->>'user_id' = p_actor_id
  ) THEN
    RAISE EXCEPTION 'The calendar owner cannot also be an initial member' USING ERRCODE = '22023';
  END IF;

  IF v_visibility = 'private' AND jsonb_array_length(p_members) > 0 THEN
    RAISE EXCEPTION 'A private calendar cannot have initial members' USING ERRCODE = '22023';
  END IF;

  -- delete_user_cascade와 같은 부모→자식 순서. 일반 writer끼리는 호환된다.
  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_members IN ROW EXCLUSIVE MODE;

  -- 세션 actor의 존재와 team 생성 권한을 같은 트랜잭션에서 고정한다.
  SELECT actor.role INTO v_actor_role
  FROM users AS actor
  WHERE actor.id = p_actor_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session actor % not found', p_actor_id USING ERRCODE = '42501';
  END IF;

  IF v_visibility = 'team' AND v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can create a team calendar' USING ERRCODE = '42501';
  END IF;

  INSERT INTO calendars (name, color, visibility, owner_id, is_personal)
  VALUES (
    p_calendar->>'name',
    p_calendar->>'color',
    v_visibility,
    p_actor_id,
    false
  )
  RETURNING * INTO v_created;

  INSERT INTO calendar_members (calendar_id, user_id, can_edit)
  SELECT
    v_created.id,
    item.value->>'user_id',
    (item.value->>'can_edit')::BOOLEAN
  FROM jsonb_array_elements(p_members) AS item(value);

  RETURN NEXT v_created;
END;
$$;

COMMENT ON FUNCTION public.create_calendar_with_members_authorized(TEXT, JSONB, JSONB) IS
  '세션 actor 권한과 안전한 입력을 재검증하고 캘린더 + 초기 멤버를 단일 트랜잭션에서 생성하는 SECURITY INVOKER RPC.';

-- ── 2-2) 일정 쓰기 권한 원자적 검증 RPC ───────────────────────
-- IPC 사전 검사는 친절한 오류용이다. 실제 권한은 부모 캘린더 행을 잠근 뒤
-- 같은 트랜잭션에서 재확인하여 멤버 권한 회수와 일정 쓰기의 TOCTOU를 막는다.
CREATE OR REPLACE FUNCTION public.create_calendar_event_authorized(
  p_actor_id TEXT,
  p_event JSONB
)
RETURNS SETOF calendar_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY[
    'calendar_id', 'title', 'memo', 'tag_id', 'all_day', 'start_date', 'end_date',
    'start_time', 'end_time', 'linked_episode', 'linked_part', 'linked_sheet_name',
    'linked_scene_id', 'linked_department', 'linked_todo_id'
  ];
  v_required_keys CONSTANT TEXT[] := ARRAY[
    'calendar_id', 'title', 'memo', 'tag_id', 'all_day', 'start_date', 'end_date',
    'start_time', 'end_time', 'linked_episode', 'linked_part', 'linked_sheet_name',
    'linked_scene_id', 'linked_department', 'linked_todo_id'
  ];
  v_calendar_id UUID;
  v_calendar calendars%ROWTYPE;
  v_created calendar_events%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

  IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' THEN
    RAISE EXCEPTION 'p_event must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_event) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'p_event contains an unknown or immutable field' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_required_keys) AS required(key)
    WHERE NOT (p_event ? required.key)
  ) THEN
    RAISE EXCEPTION 'p_event is missing a canonical field' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_calendar_id := (p_event->>'calendar_id')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'calendar_id must be a UUID' USING ERRCODE = '22023';
  END;
  IF v_calendar_id IS NULL THEN
    RAISE EXCEPTION 'Target calendar is missing' USING ERRCODE = '23503';
  END IF;

  -- delete_user_cascade와 같은 부모→자식 테이블 순서. 일반 writer끼리는 호환된다.
  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;

  SELECT candidate.* INTO v_calendar
  FROM calendars AS candidate
  WHERE candidate.id = v_calendar_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target calendar % not found', v_calendar_id USING ERRCODE = '23503';
  END IF;

  IF v_calendar.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_calendar.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event create permission denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO calendar_events (
    calendar_id, title, memo, tag_id, all_day, start_date, end_date,
    start_time, end_time, linked_episode, linked_part, linked_sheet_name,
    linked_scene_id, linked_department, linked_todo_id, created_by
  ) VALUES (
    v_calendar_id,
    p_event->>'title',
    p_event->>'memo',
    (p_event->>'tag_id')::UUID,
    (p_event->>'all_day')::BOOLEAN,
    (p_event->>'start_date')::DATE,
    (p_event->>'end_date')::DATE,
    p_event->>'start_time',
    p_event->>'end_time',
    (p_event->>'linked_episode')::INTEGER,
    p_event->>'linked_part',
    p_event->>'linked_sheet_name',
    p_event->>'linked_scene_id',
    p_event->>'linked_department',
    p_event->>'linked_todo_id',
    p_actor_id
  )
  RETURNING * INTO v_created;

  RETURN NEXT v_created;
END;
$$;

COMMENT ON FUNCTION public.create_calendar_event_authorized(TEXT, JSONB) IS
  '부모 캘린더 잠금 후 owner/can_edit 권한을 재확인하고 세션 actor를 created_by로 강제하는 일정 생성 RPC.';

CREATE OR REPLACE FUNCTION public.update_calendar_event_authorized(
  p_actor_id TEXT,
  p_event_id UUID,
  p_expected_calendar_id UUID,
  p_updates JSONB
)
RETURNS SETOF calendar_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY[
    'calendar_id', 'title', 'memo', 'tag_id', 'all_day', 'start_date', 'end_date',
    'start_time', 'end_time', 'linked_episode', 'linked_part', 'linked_sheet_name',
    'linked_scene_id', 'linked_department', 'linked_todo_id'
  ];
  v_target_calendar_id UUID;
  v_source calendars%ROWTYPE;
  v_target calendars%ROWTYPE;
  v_existing calendar_events%ROWTYPE;
  v_updated calendar_events%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'p_updates must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_updates) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'p_updates contains an unknown or immutable field' USING ERRCODE = '22023';
  END IF;

  IF p_expected_calendar_id IS NULL THEN
    RAISE EXCEPTION 'Expected source calendar is missing' USING ERRCODE = '23503';
  END IF;

  v_target_calendar_id := p_expected_calendar_id;
  IF p_updates ? 'calendar_id' THEN
    BEGIN
      v_target_calendar_id := (p_updates->>'calendar_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'calendar_id must be a UUID' USING ERRCODE = '22023';
    END;
    IF v_target_calendar_id IS NULL THEN
      RAISE EXCEPTION 'Target calendar is missing' USING ERRCODE = '23503';
    END IF;
  END IF;

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;

  -- source와 payload에서 파생한 target을 UUID 순서로 잠가 이동끼리의 역순 교착을 피한다.
  PERFORM candidate.id
  FROM calendars AS candidate
  WHERE candidate.id = ANY (ARRAY[p_expected_calendar_id, v_target_calendar_id])
  ORDER BY candidate.id
  FOR UPDATE;

  SELECT candidate.* INTO v_source
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source calendar % not found', p_expected_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT candidate.* INTO v_target
  FROM calendars AS candidate
  WHERE candidate.id = v_target_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target calendar % not found', v_target_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT current_event.* INTO v_existing
  FROM calendar_events AS current_event
  WHERE current_event.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_existing.calendar_id <> p_expected_calendar_id THEN
    RAISE EXCEPTION 'Calendar event source changed; refresh and retry' USING ERRCODE = '40001';
  END IF;

  IF v_source.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_source.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event source permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_target.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_target.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event target permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE calendar_events AS target_event
  SET calendar_id = CASE WHEN p_updates ? 'calendar_id' THEN v_target_calendar_id ELSE v_existing.calendar_id END,
      title = CASE WHEN p_updates ? 'title' THEN p_updates->>'title' ELSE v_existing.title END,
      memo = CASE WHEN p_updates ? 'memo' THEN p_updates->>'memo' ELSE v_existing.memo END,
      tag_id = CASE WHEN p_updates ? 'tag_id' THEN (p_updates->>'tag_id')::UUID ELSE v_existing.tag_id END,
      all_day = CASE WHEN p_updates ? 'all_day' THEN (p_updates->>'all_day')::BOOLEAN ELSE v_existing.all_day END,
      start_date = CASE WHEN p_updates ? 'start_date' THEN (p_updates->>'start_date')::DATE ELSE v_existing.start_date END,
      end_date = CASE WHEN p_updates ? 'end_date' THEN (p_updates->>'end_date')::DATE ELSE v_existing.end_date END,
      start_time = CASE WHEN p_updates ? 'start_time' THEN p_updates->>'start_time' ELSE v_existing.start_time END,
      end_time = CASE WHEN p_updates ? 'end_time' THEN p_updates->>'end_time' ELSE v_existing.end_time END,
      linked_episode = CASE WHEN p_updates ? 'linked_episode' THEN (p_updates->>'linked_episode')::INTEGER ELSE v_existing.linked_episode END,
      linked_part = CASE WHEN p_updates ? 'linked_part' THEN p_updates->>'linked_part' ELSE v_existing.linked_part END,
      linked_sheet_name = CASE WHEN p_updates ? 'linked_sheet_name' THEN p_updates->>'linked_sheet_name' ELSE v_existing.linked_sheet_name END,
      linked_scene_id = CASE WHEN p_updates ? 'linked_scene_id' THEN p_updates->>'linked_scene_id' ELSE v_existing.linked_scene_id END,
      linked_department = CASE WHEN p_updates ? 'linked_department' THEN p_updates->>'linked_department' ELSE v_existing.linked_department END,
      linked_todo_id = CASE WHEN p_updates ? 'linked_todo_id' THEN p_updates->>'linked_todo_id' ELSE v_existing.linked_todo_id END,
      updated_at = now()
  WHERE target_event.id = p_event_id
  RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

COMMENT ON FUNCTION public.update_calendar_event_authorized(TEXT, UUID, UUID, JSONB) IS
  'source/target 부모와 일정 행을 순서대로 잠근 뒤 양쪽 owner/can_edit 권한과 expected source를 재확인하는 일정 수정 RPC.';

CREATE OR REPLACE FUNCTION public.delete_calendar_event_authorized(
  p_actor_id TEXT,
  p_event_id UUID,
  p_expected_calendar_id UUID
)
RETURNS SETOF calendar_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source calendars%ROWTYPE;
  v_existing calendar_events%ROWTYPE;
  v_deleted calendar_events%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_calendar_id IS NULL THEN
    RAISE EXCEPTION 'Expected source calendar is missing' USING ERRCODE = '23503';
  END IF;

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;

  PERFORM candidate.id
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id
  ORDER BY candidate.id
  FOR UPDATE;

  SELECT candidate.* INTO v_source
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source calendar % not found', p_expected_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT current_event.* INTO v_existing
  FROM calendar_events AS current_event
  WHERE current_event.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_existing.calendar_id <> p_expected_calendar_id THEN
    RAISE EXCEPTION 'Calendar event source changed; refresh and retry' USING ERRCODE = '40001';
  END IF;

  IF v_source.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_source.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event delete permission denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM calendar_events AS target_event
  WHERE target_event.id = p_event_id
  RETURNING * INTO v_deleted;

  RETURN NEXT v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_calendar_event_authorized(TEXT, UUID, UUID) IS
  'source 부모와 일정 행을 잠근 뒤 owner/can_edit 권한과 expected source를 재확인하는 일정 삭제 RPC.';

-- 비공개 전환은 대체 일정 생성과 원본 삭제 사이에 세션·권한이 바뀔 수 있다.
-- main 프로세스의 일회성 receipt가 기억한 생성 결과만 단일 DELETE로 정리한다.
-- created_by 는 사용자 삭제 cascade가 NULL로 바꿀 수 있으므로 행 세대 식별자에 쓰지 않는다.
-- id + calendar + 불변 생성시각이 모두 같은 한 행에만 작동하므로 동일 id가 재사용되거나
-- 행이 교체되면 0행을 반환한다. 이전 개발 DB의 4인자 판은 재실행 때 제거한다.
DROP FUNCTION IF EXISTS public.delete_calendar_privacy_replacement(UUID, UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.delete_calendar_privacy_replacement(
  p_event_id UUID,
  p_calendar_id UUID,
  p_created_at TIMESTAMPTZ
)
RETURNS SETOF public.calendar_events
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.calendar_events AS target_event
  WHERE target_event.id = p_event_id
    AND target_event.calendar_id = p_calendar_id
    AND target_event.created_at = p_created_at
  RETURNING target_event.*;
$$;

COMMENT ON FUNCTION public.delete_calendar_privacy_replacement(UUID, UUID, TIMESTAMPTZ) IS
  'main 일회성 receipt에 고정된 정확한 대체 일정 행만 권한 재검사 없이 원자적으로 보상 삭제하는 SECURITY INVOKER RPC.';

-- ── 2-2) 태그 원자적 전체 교체 RPC ────────────────────────────
-- 함수 안의 예외는 호출 전체를 rollback한다. 따라서 태그 삭제의 FK SET NULL도 후속 실패 시 복구된다.
-- 예전 actor 없는 함수가 적용된 개발 DB에서도 권한 우회 경로를 남기지 않는다.
DROP FUNCTION IF EXISTS public.replace_calendar_tags(JSONB);

CREATE OR REPLACE FUNCTION public.replace_calendar_tags_authorized(
  p_actor_id TEXT,
  p_tags JSONB
)
RETURNS TABLE (id UUID, name TEXT, color TEXT, sort_order INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_role TEXT;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

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

  -- table→actor 순서는 다른 캘린더 관리 RPC의 table→row 규약과 같다.
  -- FOR SHARE는 role 강등/사용자 삭제와 충돌하되 FK의 KEY SHARE와는 호환된다.
  SELECT actor.role INTO v_actor_role
  FROM users AS actor
  WHERE actor.id = p_actor_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session actor % not found', p_actor_id USING ERRCODE = '42501';
  END IF;
  IF v_actor_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Calendar tag management permission denied' USING ERRCODE = '42501';
  END IF;

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

COMMENT ON FUNCTION public.replace_calendar_tags_authorized(TEXT, JSONB) IS
  '세션 actor의 admin 역할을 잠가 재검증한 뒤 태그 최종 목록을 단일 트랜잭션으로 교체. 검증 실패나 후속 실패 시 삭제·수정·FK SET NULL을 함께 rollback한다.';

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
--      구 날짜는 'YYYY-MM-DD 또는 ISO datetime'. 실제 존재하는 날짜만 복사하고,
--      잘못된 날짜 행은 호환·정정용 private_calendar_events 에 그대로 남긴다.
WITH legacy_raw AS MATERIALIZED (
  SELECT p.*, c.id AS target_calendar_id,
    substring(p.start_date, 1, 10) AS start_raw,
    substring(p.end_date, 1, 10) AS end_raw
  FROM private_calendar_events p
  JOIN calendars c ON c.owner_id = p.user_id AND c.is_personal
),
legacy_parts AS MATERIALIZED (
  SELECT legacy_raw.*,
    CASE WHEN start_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(start_raw, '-', 1)::integer END AS start_year,
    CASE WHEN start_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(start_raw, '-', 2)::integer END AS start_month,
    CASE WHEN start_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(start_raw, '-', 3)::integer END AS start_day,
    CASE WHEN end_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(end_raw, '-', 1)::integer END AS end_year,
    CASE WHEN end_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(end_raw, '-', 2)::integer END AS end_month,
    CASE WHEN end_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN split_part(end_raw, '-', 3)::integer END AS end_day
  FROM legacy_raw
),
legacy_parsed AS MATERIALIZED (
  SELECT legacy_parts.*,
    CASE
      WHEN start_year BETWEEN 1 AND 9999
       AND start_month BETWEEN 1 AND 12
       AND start_day BETWEEN 1 AND 31
      THEN CASE
        WHEN extract(month FROM (make_date(start_year, start_month, 1) + start_day - 1)) = start_month
        THEN make_date(start_year, start_month, 1) + start_day - 1
      END
    END AS migrated_start_date,
    CASE
      WHEN end_year BETWEEN 1 AND 9999
       AND end_month BETWEEN 1 AND 12
       AND end_day BETWEEN 1 AND 31
      THEN CASE
        WHEN extract(month FROM (make_date(end_year, end_month, 1) + end_day - 1)) = end_month
        THEN make_date(end_year, end_month, 1) + end_day - 1
      END
    END AS migrated_end_date
  FROM legacy_parts
)
INSERT INTO calendar_events (id, calendar_id, title, memo, all_day, start_date, end_date,
  linked_episode, linked_part, linked_sheet_name, linked_scene_id, linked_department,
  linked_todo_id, created_by, created_at, updated_at)
SELECT p.id, p.target_calendar_id, p.title, p.memo, true,
  p.migrated_start_date, p.migrated_end_date,
  p.linked_episode, p.linked_part, p.linked_sheet_name, p.linked_scene_id, p.linked_department,
  p.linked_todo_id, p.user_id, p.created_at, p.updated_at
FROM legacy_parsed p
WHERE p.migrated_start_date IS NOT NULL
  AND p.migrated_end_date IS NOT NULL
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
  v_has_shared_calendars BOOLEAN := false;
BEGIN
  SELECT name INTO v_user_name FROM users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- ── 공유 캘린더 불변식 선검사 (어떤 사용자 데이터도 바꾸기 전) ──
  -- 사용자 삭제는 드문 관리자 작업이다. direct calendar DELETE(parent→child)와
  -- event move/update(child→parent)가 서로 역순으로 행 잠금을 잡지 못하도록,
  -- 두 쓰기 테이블을 부모→자식 순서로 먼저 직렬화한다.
  LOCK TABLE calendars IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN SHARE ROW EXCLUSIVE MODE;

  -- 멤버 교체 RPC와 동일하게 부모→자식 순서로 잠가 교착을 피한다.
  PERFORM c.id
  FROM calendars c
  WHERE c.owner_id = p_user_id
  ORDER BY c.id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM calendars c
    WHERE c.owner_id = p_user_id
      AND NOT c.is_personal
  ) INTO v_has_shared_calendars;

  IF v_has_shared_calendars THEN
    -- 공유 캘린더는 팀 자산 보존 — admin(배한솔 우선) 에게 소유 이전한다.
    -- calendar→event→user 순서로 잠그며, 동률은 id로 고정하고 역할 변경·삭제를 이전 완료까지 막는다.
    SELECT id INTO v_admin_id FROM users
    WHERE id <> p_user_id AND role = 'admin'
    ORDER BY (name = '배한솔') DESC, created_at ASC, id ASC
    LIMIT 1
    FOR NO KEY UPDATE;

    IF v_admin_id IS NULL THEN
      RAISE EXCEPTION 'Shared calendars require another admin owner before deleting user %', p_user_id
        USING ERRCODE = '55000';
    END IF;
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
  -- 작성자 표시는 nullable — FK(NO ACTION) 위반 방지. 이벤트 행을 부모 캘린더보다 먼저 잠근다.
  UPDATE calendar_events SET created_by = NULL WHERE created_by = p_user_id;

  -- 개인 캘린더는 삭제 (이벤트는 ON DELETE CASCADE)
  DELETE FROM calendars WHERE owner_id = p_user_id AND is_personal;

  IF v_admin_id IS NOT NULL THEN
    -- 새 소유자가 이미 멤버 행으로 있으면 제거(소유자는 멤버 목록에 두지 않는 규약)
    DELETE FROM calendar_members m USING calendars c
      WHERE m.calendar_id = c.id AND c.owner_id = p_user_id AND m.user_id = v_admin_id;
    UPDATE calendars SET owner_id = v_admin_id, updated_at = now()
      WHERE owner_id = p_user_id;
  END IF;
  DELETE FROM calendar_members       WHERE user_id = p_user_id;
  DELETE FROM calendar_notifications WHERE recipient_id = p_user_id;

  DELETE FROM users WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.delete_user_cascade(TEXT) IS
  '사용자 삭제 + 종속 정리 atomic RPC. 공유 캘린더 소유자는 후계 admin을 잠근 뒤에만 진행하며, 부재 시 어떤 변경도 없이 거부한다. 개인 데이터 삭제 / 개인 캘린더 삭제·공유 캘린더 admin 이전 / users 삭제를 한 트랜잭션으로. comments·activity_log 는 역사 기록으로 보존.';
