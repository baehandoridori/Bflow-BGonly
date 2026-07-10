-- ============================================================
-- 개인 할일 개인화: 상태/우선순위/고정/레이블 + 원자적 mutation RPC
-- date: 2026-07-11
--
-- 원칙:
-- - completed만 쓰는 구버전과 status를 쓰는 신버전을 동시에 지원한다.
-- - 모든 mutation은 user_id 소유권을 함수 안에서 확인한다.
-- - 순서 저장은 클라이언트가 보낸 전체 UUID 집합을 검증한 뒤 전부 재색인한다.
-- - 레이블은 users FK cascade로 정리하며 클라이언트에 DELETE 권한을 주지 않는다.
-- ============================================================

BEGIN;

-- 1) canonical personal todo fields -----------------------------------------

ALTER TABLE public.personal_todos
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS label_ids uuid[] NOT NULL DEFAULT '{}';

-- ADD COLUMN의 기본값으로 채워진 기존 행은 legacy completed 값을 한 번 반영한다.
UPDATE public.personal_todos
SET status = 'done'
WHERE completed IS TRUE
  AND status = 'todo';

UPDATE public.personal_todos
SET
  status = COALESCE(status, 'todo'),
  priority = COALESCE(priority, 'none'),
  pinned = COALESCE(pinned, false),
  label_ids = COALESCE(label_ids, ARRAY[]::uuid[]),
  completed = (COALESCE(status, 'todo') = 'done');

ALTER TABLE public.personal_todos
  ALTER COLUMN status SET DEFAULT 'todo',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN priority SET DEFAULT 'none',
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN pinned SET DEFAULT false,
  ALTER COLUMN pinned SET NOT NULL,
  ALTER COLUMN label_ids SET DEFAULT '{}',
  ALTER COLUMN label_ids SET NOT NULL;

ALTER TABLE public.personal_todos
  DROP CONSTRAINT IF EXISTS personal_todos_status_check;
ALTER TABLE public.personal_todos
  ADD CONSTRAINT personal_todos_status_check
  CHECK (status IN ('todo', 'doing', 'done'));

ALTER TABLE public.personal_todos
  DROP CONSTRAINT IF EXISTS personal_todos_priority_check;
ALTER TABLE public.personal_todos
  ADD CONSTRAINT personal_todos_priority_check
  CHECK (priority IN ('high', 'medium', 'low', 'none'));

-- 2) user-owned labels ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.personal_todo_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  color_key text NOT NULL DEFAULT 'violet'
    CHECK (color_key IN ('violet', 'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'gray')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_todo_labels_user_normalized_name_key
  ON public.personal_todo_labels (user_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS personal_todo_labels_user_id_idx
  ON public.personal_todo_labels (user_id);

ALTER TABLE public.personal_todo_labels ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personal_todo_labels'
      AND policyname = 'allow_all'
  ) THEN
    CREATE POLICY "allow_all" ON public.personal_todo_labels
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$policy$;

-- 새 테이블의 클라이언트 권한을 명시적으로 고정한다. 레이블 삭제는 제공하지 않는다.
REVOKE ALL PRIVILEGES ON TABLE public.personal_todo_labels FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.personal_todo_labels TO anon, authenticated;

-- 3) completed <-> status compatibility ------------------------------------

CREATE OR REPLACE FUNCTION public.sync_personal_todo_status_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- INSERT에서는 status 기본값 때문에 필드 생략 여부를 알 수 없다.
    -- 구버전의 completed=true 생성만 done으로 승격하고, 명시된 doing/done은 보존한다.
    IF NEW.status = 'todo' AND COALESCE(NEW.completed, false) THEN
      NEW.status := 'done';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    -- 두 필드가 함께 바뀌면 canonical status가 우선한다.
    NEW.completed := (NEW.status = 'done');
  ELSIF NEW.completed IS DISTINCT FROM OLD.completed THEN
    -- completed만 쓰는 구버전 클라이언트의 변경을 canonical status로 옮긴다.
    NEW.status := CASE WHEN NEW.completed THEN 'done' ELSE 'todo' END;
  END IF;

  NEW.completed := (NEW.status = 'done');
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.sync_personal_todo_status_completed() FROM PUBLIC;

DROP TRIGGER IF EXISTS personal_todos_status_completed_sync ON public.personal_todos;
CREATE TRIGGER personal_todos_status_completed_sync
BEFORE INSERT OR UPDATE ON public.personal_todos
FOR EACH ROW
EXECUTE FUNCTION public.sync_personal_todo_status_completed();

-- 4) owner-scoped patch -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.patch_personal_todo(
  p_todo_id uuid,
  p_user_id text,
  p_patch jsonb
)
RETURNS public.personal_todos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label_ids uuid[];
  v_valid_label_count integer;
  v_todo public.personal_todos%ROWTYPE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Todo patch must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- 모든 user-scoped mutation은 같은 transaction lock을 사용한다.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  SELECT todo.*
  INTO v_todo
  FROM public.personal_todos AS todo
  WHERE todo.id = p_todo_id
    AND todo.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal todo not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_patch ? 'pinned' THEN
    RAISE EXCEPTION 'pinned changes require an order mutation' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key <> ALL (ARRAY[
      'title', 'memo', 'start_date', 'end_date', 'add_to_calendar',
      'status', 'priority', 'label_ids'
    ]::text[])
  ) THEN
    RAISE EXCEPTION 'Todo patch contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'title' AND NULLIF(btrim(p_patch ->> 'title'), '') IS NULL THEN
    RAISE EXCEPTION 'Todo title must not be empty' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'status' THEN
    IF v_todo.status = 'done' OR p_patch ->> 'status' = 'done' THEN
      RAISE EXCEPTION 'done boundary changes require a status mutation' USING ERRCODE = '22023';
    END IF;
    IF p_patch ->> 'status' NOT IN ('todo', 'doing') THEN
      RAISE EXCEPTION 'Todo patch status must be todo or doing' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'label_ids' THEN
    IF jsonb_typeof(p_patch -> 'label_ids') <> 'array' THEN
      RAISE EXCEPTION 'label_ids must be a JSON array' USING ERRCODE = '22023';
    END IF;

    SELECT
      COALESCE(
        array_agg(label.id ORDER BY ord) FILTER (WHERE label.id IS NOT NULL),
        ARRAY[]::uuid[]
      ),
      COUNT(label.id)::integer
    INTO v_label_ids, v_valid_label_count
    FROM jsonb_array_elements_text(p_patch -> 'label_ids')
      WITH ORDINALITY AS requested(raw_id, ord)
    LEFT JOIN public.personal_todo_labels AS label
      ON label.id::text = requested.raw_id
     AND label.user_id = p_user_id;

    IF v_valid_label_count <> jsonb_array_length(p_patch -> 'label_ids') THEN
      RAISE EXCEPTION 'label_ids contains a missing or foreign label' USING ERRCODE = '42501';
    END IF;

    IF cardinality(v_label_ids) <> (
      SELECT COUNT(DISTINCT label_id)::integer
      FROM unnest(v_label_ids) AS labels(label_id)
    ) THEN
      RAISE EXCEPTION 'label_ids must be unique' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_label_ids := v_todo.label_ids;
  END IF;

  UPDATE public.personal_todos AS todo
  SET
    title = CASE WHEN p_patch ? 'title' THEN btrim(p_patch ->> 'title') ELSE todo.title END,
    memo = CASE WHEN p_patch ? 'memo' THEN COALESCE(p_patch ->> 'memo', '') ELSE todo.memo END,
    start_date = CASE
      WHEN p_patch ? 'start_date' THEN NULLIF(p_patch ->> 'start_date', '')::date
      ELSE todo.start_date
    END,
    end_date = CASE
      WHEN p_patch ? 'end_date' THEN NULLIF(p_patch ->> 'end_date', '')::date
      ELSE todo.end_date
    END,
    add_to_calendar = CASE
      WHEN p_patch ? 'add_to_calendar' THEN (p_patch ->> 'add_to_calendar')::boolean
      ELSE todo.add_to_calendar
    END,
    status = CASE WHEN p_patch ? 'status' THEN p_patch ->> 'status' ELSE todo.status END,
    priority = CASE WHEN p_patch ? 'priority' THEN p_patch ->> 'priority' ELSE todo.priority END,
    label_ids = v_label_ids,
    updated_at = now()
  WHERE todo.id = p_todo_id
    AND todo.user_id = p_user_id
  RETURNING todo.* INTO v_todo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal todo not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_todo;
END
$$;

-- 5) atomic mutation + complete order reindex ------------------------------

CREATE OR REPLACE FUNCTION public.mutate_personal_todo_order(
  p_user_id text,
  p_mutation jsonb,
  p_ordered_ids uuid[]
)
RETURNS SETOF public.personal_todos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mutation_type text;
  v_payload jsonb;
  v_todo_id uuid;
  v_existing_owner text;
  v_affected_id uuid;
  v_inserted_id uuid;
  v_server_count integer;
  v_next_sort_order integer;
  v_reindexed_count integer;
  v_final_ids uuid[];
BEGIN
  IF p_mutation IS NULL OR jsonb_typeof(p_mutation) <> 'object' THEN
    RAISE EXCEPTION 'Todo mutation must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_ordered_ids IS NULL THEN
    RAISE EXCEPTION 'ordered ids are required' USING ERRCODE = '22023';
  END IF;

  -- 같은 사용자의 patch/order/label mutation을 DB transaction 단위로 직렬화한다.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  IF cardinality(p_ordered_ids) <> (
    SELECT COUNT(DISTINCT ordered_id)::integer
    FROM unnest(p_ordered_ids) AS ordered(ordered_id)
  ) THEN
    RAISE EXCEPTION 'ordered ids must be unique' USING ERRCODE = '22023';
  END IF;

  v_mutation_type := p_mutation ->> 'type';

  CASE v_mutation_type
    WHEN 'add' THEN
      v_payload := p_mutation -> 'todo';
      IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN
        RAISE EXCEPTION 'add mutation requires a todo object' USING ERRCODE = '22023';
      END IF;
      v_todo_id := NULLIF(v_payload ->> 'id', '')::uuid;
      IF v_todo_id IS NULL OR NULLIF(btrim(v_payload ->> 'title'), '') IS NULL THEN
        RAISE EXCEPTION 'add mutation requires todo id and title' USING ERRCODE = '22023';
      END IF;

      -- UUID는 idempotency key다. 같은 user의 기존 행이면 first committed row wins.
      SELECT todo.user_id
      INTO v_existing_owner
      FROM public.personal_todos AS todo
      WHERE todo.id = v_todo_id;

      IF FOUND THEN
        IF v_existing_owner IS DISTINCT FROM p_user_id THEN
          RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
        END IF;
      ELSE
        IF v_payload ? 'status' AND v_payload ->> 'status' NOT IN ('todo', 'doing', 'done') THEN
          RAISE EXCEPTION 'add mutation has an invalid status' USING ERRCODE = '22023';
        END IF;
        IF v_payload ? 'pinned' AND jsonb_typeof(v_payload -> 'pinned') <> 'boolean' THEN
          RAISE EXCEPTION 'add mutation pinned must be boolean' USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(MAX(todo.sort_order), -1) + 1
        INTO v_next_sort_order
        FROM public.personal_todos AS todo
        WHERE todo.user_id = p_user_id;

        INSERT INTO public.personal_todos (id, user_id, title, sort_order)
        VALUES (v_todo_id, p_user_id, btrim(v_payload ->> 'title'), v_next_sort_order)
        ON CONFLICT (id) DO NOTHING
        RETURNING id INTO v_inserted_id;

        IF NOT FOUND THEN
          SELECT todo.user_id
          INTO v_existing_owner
          FROM public.personal_todos AS todo
          WHERE todo.id = v_todo_id;
          IF v_existing_owner IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
          END IF;
        ELSE
          PERFORM public.patch_personal_todo(
            v_todo_id,
            p_user_id,
            v_payload - ARRAY['id', 'status', 'pinned']
          );

          UPDATE public.personal_todos AS todo
          SET status = CASE WHEN v_payload ? 'status' THEN v_payload ->> 'status' ELSE todo.status END,
              pinned = CASE WHEN v_payload ? 'pinned' THEN (v_payload ->> 'pinned')::boolean ELSE todo.pinned END,
              updated_at = now()
          WHERE todo.id = v_todo_id
            AND todo.user_id = p_user_id
          RETURNING todo.id INTO v_affected_id;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Added personal todo disappeared' USING ERRCODE = 'P0001';
          END IF;
        END IF;
      END IF;

    WHEN 'delete' THEN
      v_todo_id := NULLIF(p_mutation ->> 'todo_id', '')::uuid;
      IF v_todo_id IS NULL THEN
        RAISE EXCEPTION 'delete mutation requires todo_id' USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.personal_todos AS todo
      WHERE todo.id = v_todo_id
        AND todo.user_id = p_user_id
      RETURNING todo.id INTO v_affected_id;
      IF NOT FOUND THEN
        SELECT todo.user_id
        INTO v_existing_owner
        FROM public.personal_todos AS todo
        WHERE todo.id = v_todo_id;
        IF FOUND AND v_existing_owner IS DISTINCT FROM p_user_id THEN
          RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
        END IF;
        -- 이미 없는 same-user delete는 response-loss retry로 보고 만족된 것으로 처리한다.
      END IF;

    WHEN 'pin' THEN
      v_todo_id := NULLIF(p_mutation ->> 'todo_id', '')::uuid;
      IF v_todo_id IS NULL THEN
        RAISE EXCEPTION 'pin mutation requires todo_id' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_mutation -> 'pinned') <> 'boolean' THEN
        RAISE EXCEPTION 'pin mutation requires a boolean pinned value' USING ERRCODE = '22023';
      END IF;
      UPDATE public.personal_todos AS todo
      SET pinned = (p_mutation ->> 'pinned')::boolean,
          updated_at = now()
      WHERE todo.id = v_todo_id
        AND todo.user_id = p_user_id
      RETURNING todo.id INTO v_affected_id;
      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.personal_todos AS todo WHERE todo.id = v_todo_id) THEN
          RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'Personal todo not found' USING ERRCODE = 'P0002';
      END IF;

    WHEN 'status' THEN
      v_todo_id := NULLIF(p_mutation ->> 'todo_id', '')::uuid;
      IF v_todo_id IS NULL OR p_mutation ->> 'status' NOT IN ('todo', 'doing', 'done') THEN
        RAISE EXCEPTION 'status mutation requires todo_id and canonical status' USING ERRCODE = '22023';
      END IF;
      UPDATE public.personal_todos AS todo
      SET status = p_mutation ->> 'status',
          updated_at = now()
      WHERE todo.id = v_todo_id
        AND todo.user_id = p_user_id
      RETURNING todo.id INTO v_affected_id;
      IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.personal_todos AS todo WHERE todo.id = v_todo_id) THEN
          RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
        END IF;
        RAISE EXCEPTION 'Personal todo not found' USING ERRCODE = 'P0002';
      END IF;

    WHEN 'reorder' THEN
      PERFORM 1;

    ELSE
      RAISE EXCEPTION 'Unsupported todo mutation type: %', v_mutation_type USING ERRCODE = '22023';
  END CASE;

  -- add/delete를 적용한 뒤 검증하므로 ordered ids는 최종 서버 집합과 정확히 맞아야 한다.
  IF EXISTS (
    SELECT 1
    FROM unnest(p_ordered_ids) AS requested(ordered_id)
    LEFT JOIN public.personal_todos AS todo
      ON todo.id = requested.ordered_id
     AND todo.user_id = p_user_id
    WHERE todo.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ordered ids contains a missing or foreign todo' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_server_count
  FROM public.personal_todos AS todo
  WHERE todo.user_id = p_user_id;

  IF cardinality(p_ordered_ids) <> v_server_count OR EXISTS (
    SELECT 1
    FROM public.personal_todos AS todo
    WHERE todo.user_id = p_user_id
      AND NOT (todo.id = ANY (p_ordered_ids))
  ) THEN
    RAISE EXCEPTION 'ordered ids must contain the complete user todo set' USING ERRCODE = '22023';
  END IF;

  WITH requested AS (
    SELECT todo_id, ord
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS requested(todo_id, ord)
  )
  UPDATE public.personal_todos AS todo
  SET sort_order = requested.ord - 1,
      updated_at = now()
  FROM requested
  WHERE todo.id = requested.todo_id
    AND todo.user_id = p_user_id;

  GET DIAGNOSTICS v_reindexed_count = ROW_COUNT;
  IF v_reindexed_count <> v_server_count THEN
    RAISE EXCEPTION 'Not every personal todo was reindexed' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(todo.id ORDER BY todo.sort_order), ARRAY[]::uuid[])
  INTO v_final_ids
  FROM public.personal_todos AS todo
  WHERE todo.user_id = p_user_id;
  IF v_final_ids IS DISTINCT FROM p_ordered_ids THEN
    RAISE EXCEPTION 'Final personal todo order does not match ordered ids' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT todo.*
  FROM public.personal_todos AS todo
  WHERE todo.user_id = p_user_id
  ORDER BY todo.sort_order, todo.id;
END
$$;

-- 6) atomic label create/reuse/attach and owner-scoped label update ----------

DROP FUNCTION IF EXISTS public.create_or_reuse_personal_todo_label_and_attach(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_or_reuse_personal_todo_label_and_attach(
  p_todo_id uuid,
  p_user_id text,
  p_name text,
  p_color_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label public.personal_todo_labels%ROWTYPE;
  v_todo public.personal_todos%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Label name must not be empty' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  SELECT todo.*
  INTO v_todo
  FROM public.personal_todos AS todo
  WHERE todo.id = p_todo_id
    AND todo.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND AND EXISTS (
    SELECT 1 FROM public.personal_todos AS todo WHERE todo.id = p_todo_id
  ) THEN
    RAISE EXCEPTION 'Todo id belongs to another user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.personal_todo_labels (user_id, name, color_key)
  VALUES (p_user_id, btrim(p_name), p_color_key)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_label;

  IF NOT FOUND THEN
    SELECT label.*
    INTO v_label
    FROM public.personal_todo_labels AS label
    WHERE label.user_id = p_user_id
      AND lower(btrim(label.name)) = lower(btrim(p_name));
  END IF;

  IF v_label.id IS NULL THEN
    RAISE EXCEPTION 'Unable to create or reuse label' USING ERRCODE = 'P0001';
  END IF;

  IF v_todo.id IS NOT NULL THEN
    UPDATE public.personal_todos AS todo
    SET label_ids = CASE
          WHEN v_label.id = ANY (todo.label_ids) THEN todo.label_ids
          ELSE array_append(todo.label_ids, v_label.id)
        END,
        updated_at = now()
    WHERE todo.id = p_todo_id
      AND todo.user_id = p_user_id
    RETURNING todo.* INTO v_todo;
  END IF;

  RETURN jsonb_build_object(
    'label', to_jsonb(v_label),
    'todo', CASE WHEN v_todo.id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_todo) END
  );
END
$$;

CREATE OR REPLACE FUNCTION public.update_personal_todo_label(
  p_label_id uuid,
  p_user_id text,
  p_patch jsonb
)
RETURNS public.personal_todo_labels
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_label public.personal_todo_labels%ROWTYPE;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Label patch must be a JSON object' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_patch) AS patch_key(key)
    WHERE patch_key.key <> ALL (ARRAY['name', 'color_key']::text[])
  ) THEN
    RAISE EXCEPTION 'Label patch contains unsupported fields' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'name' AND NULLIF(btrim(p_patch ->> 'name'), '') IS NULL THEN
    RAISE EXCEPTION 'Label name must not be empty' USING ERRCODE = '22023';
  END IF;

  UPDATE public.personal_todo_labels AS label
  SET
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch ->> 'name') ELSE label.name END,
    color_key = CASE WHEN p_patch ? 'color_key' THEN p_patch ->> 'color_key' ELSE label.color_key END,
    updated_at = now()
  WHERE label.id = p_label_id
    AND label.user_id = p_user_id
  RETURNING label.* INTO v_label;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal todo label not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_label;
END
$$;

-- PostgreSQL은 함수 생성 시 PUBLIC EXECUTE를 기본 부여하므로 RPC별로 회수한다.
REVOKE EXECUTE ON FUNCTION public.patch_personal_todo(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mutate_personal_todo_order(text, jsonb, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_reuse_personal_todo_label_and_attach(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_personal_todo_label(uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.patch_personal_todo(uuid, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_personal_todo_order(text, jsonb, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_reuse_personal_todo_label_and_attach(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_personal_todo_label(uuid, text, jsonb) TO anon, authenticated;

COMMIT;
