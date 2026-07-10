\set ON_ERROR_STOP on

-- Dedicated disposable database only. This fixture resets the public schema.
DO $$
BEGIN
  IF current_database() <> 'bflow_task2_test' THEN
    RAISE EXCEPTION 'Refusing to reset non-test database: %', current_database();
  END IF;
END
$$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

CREATE TABLE public.users (
  id text PRIMARY KEY
);

CREATE TABLE public.personal_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public.users(id),
  title text NOT NULL,
  memo text DEFAULT '',
  completed boolean DEFAULT false,
  start_date date,
  end_date date,
  add_to_calendar boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.users(id) VALUES ('alice'), ('bob');
INSERT INTO public.personal_todos(user_id, title, completed, sort_order)
VALUES
  ('alice', 'legacy done', true, 0),
  ('alice', 'legacy todo', false, 1),
  ('bob', 'foreign todo', false, 0);

\ir ../../DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql
\ir ../../DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql

DO $$
DECLARE
  v_todo_id uuid;
  v_foreign_todo_id uuid;
  v_new_id uuid := gen_random_uuid();
  v_label_id uuid;
  v_ids uuid[];
  v_response jsonb;
  v_rejected boolean;
BEGIN
  -- REGRESSION: per_user_transaction_lock
  IF position(
       'pg_advisory_xact_lock' IN pg_get_functiondef('public.patch_personal_todo(uuid,text,jsonb)'::regprocedure)
     ) = 0
     OR position(
       'pg_advisory_xact_lock' IN pg_get_functiondef('public.mutate_personal_todo_order(text,jsonb,uuid[])'::regprocedure)
     ) = 0
     OR position(
       'pg_advisory_xact_lock' IN pg_get_functiondef('public.create_or_reuse_personal_todo_label_and_attach(uuid,text,text,text)'::regprocedure)
     ) = 0
     OR position(
       'pg_advisory_xact_lock' IN pg_get_functiondef('public.update_personal_todo_label(uuid,text,jsonb)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'owner-scoped RPC is missing the per-user transaction lock';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_todos
    WHERE user_id = 'alice' AND title = 'legacy done' AND status = 'done' AND completed
  ) THEN
    RAISE EXCEPTION 'legacy completed backfill failed';
  END IF;

  SELECT id INTO v_todo_id
  FROM public.personal_todos
  WHERE user_id = 'alice' AND title = 'legacy todo';

  -- REGRESSION: patch_pinned_bypass_rejected
  v_rejected := false;
  BEGIN
    PERFORM public.patch_personal_todo(v_todo_id, 'alice', '{"pinned":true}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'patch_personal_todo accepted a pinned bypass';
  END IF;

  -- REGRESSION: patch_done_boundary_rejected
  v_rejected := false;
  BEGIN
    PERFORM public.patch_personal_todo(v_todo_id, 'alice', '{"status":"done"}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'patch_personal_todo crossed into done';
  END IF;

  PERFORM public.patch_personal_todo(v_todo_id, 'alice', '{"status":"doing"}'::jsonb);
  SELECT array_agg(todo.id ORDER BY todo.sort_order)
  INTO v_ids
  FROM public.personal_todos AS todo
  WHERE todo.user_id = 'alice';
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice',
    jsonb_build_object('type', 'status', 'todo_id', v_todo_id, 'status', 'done'),
    v_ids
  );

  v_rejected := false;
  BEGIN
    PERFORM public.patch_personal_todo(v_todo_id, 'alice', '{"status":"doing"}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'patch_personal_todo crossed out of done';
  END IF;

  -- REGRESSION: add_response_loss_retry
  v_ids := array_append(v_ids, v_new_id);
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice',
    jsonb_build_object(
      'type', 'add',
      'todo', jsonb_build_object('id', v_new_id, 'title', 'first committed title', 'status', 'doing', 'pinned', true)
    ),
    v_ids
  );
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice',
    jsonb_build_object(
      'type', 'add',
      'todo', jsonb_build_object('id', v_new_id, 'title', 'retry must not overwrite', 'status', 'todo', 'pinned', false)
    ),
    v_ids
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.personal_todos
    WHERE id = v_new_id
      AND user_id = 'alice'
      AND title = 'first committed title'
      AND status = 'doing'
      AND pinned
  ) THEN
    RAISE EXCEPTION 'add retry did not preserve the first committed row';
  END IF;

  SELECT id INTO v_foreign_todo_id
  FROM public.personal_todos
  WHERE user_id = 'bob' AND title = 'foreign todo';

  -- REGRESSION: foreign_mutation_rejected
  v_rejected := false;
  BEGIN
    PERFORM * FROM public.mutate_personal_todo_order(
      'alice',
      jsonb_build_object(
        'type', 'add',
        'todo', jsonb_build_object('id', v_foreign_todo_id, 'title', 'foreign collision')
      ),
      v_ids
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'foreign add id was not rejected';
  END IF;

  -- REGRESSION: full_row_set_reindexed
  IF EXISTS (
    SELECT 1
    FROM unnest(v_ids) WITH ORDINALITY AS expected(todo_id, ord)
    JOIN public.personal_todos AS todo ON todo.id = expected.todo_id
    WHERE todo.user_id = 'alice' AND todo.sort_order <> expected.ord - 1
  ) THEN
    RAISE EXCEPTION 'server row set was not completely reindexed';
  END IF;

  -- REGRESSION: delete_response_loss_retry
  v_ids := array_remove(v_ids, v_new_id);
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice', jsonb_build_object('type', 'delete', 'todo_id', v_new_id), v_ids
  );
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice', jsonb_build_object('type', 'delete', 'todo_id', v_new_id), v_ids
  );
  IF EXISTS (SELECT 1 FROM public.personal_todos WHERE id = v_new_id) THEN
    RAISE EXCEPTION 'delete retry restored or retained the deleted row';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM public.mutate_personal_todo_order(
      'alice', jsonb_build_object('type', 'delete', 'todo_id', v_foreign_todo_id), v_ids
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'foreign delete id was not rejected';
  END IF;

  v_response := public.create_or_reuse_personal_todo_label_and_attach(
    v_todo_id, 'alice', '작화', 'violet'
  );
  v_label_id := (v_response #>> '{label,id}')::uuid;
  IF v_label_id IS NULL OR v_response -> 'todo' = 'null'::jsonb THEN
    RAISE EXCEPTION 'existing todo attach did not return canonical label and todo';
  END IF;

  v_ids := array_remove(v_ids, v_todo_id);
  PERFORM * FROM public.mutate_personal_todo_order(
    'alice', jsonb_build_object('type', 'delete', 'todo_id', v_todo_id), v_ids
  );

  -- REGRESSION: attach_after_delete_returns_null_todo
  v_response := public.create_or_reuse_personal_todo_label_and_attach(
    v_todo_id, 'alice', '  작화  ', 'blue'
  );
  IF (v_response #>> '{label,id}')::uuid IS DISTINCT FROM v_label_id
     OR v_response -> 'todo' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'attach-after-delete did not return reused label with todo=null';
  END IF;

  IF has_table_privilege('anon', 'public.personal_todo_labels', 'DELETE')
     OR has_table_privilege('authenticated', 'public.personal_todo_labels', 'DELETE') THEN
    RAISE EXCEPTION 'label DELETE privilege was granted';
  END IF;
END
$$;

SELECT 'personal todo database runtime contract passed' AS result;
