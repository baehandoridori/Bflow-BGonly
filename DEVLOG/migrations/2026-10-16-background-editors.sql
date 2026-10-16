-- Background editors: the people an admin picks to edit the background library as an admin does.
-- Prerequisites: public.users, public.app_session_user_id(text), and the chain applied before it.
-- Chain: base -> 3D -> elements -> this file (2026-09-21-background-library.sql -> 2026-10-07-background-map-3d.sql ->
-- 2026-10-09-background-map-elements.sql -> this file). It replaces background_library_snapshot and
-- background_library_execute, which the base file defines, with the same bodies whose edit right is "an admin, or a user
-- on the editor list". A run of the base file brings the admin-only right back (fail closed: listed editors can read and
-- record episode usage, nothing more), so re-run this file after every run of the base file, after the 3D and elements
-- files. Apply it before the app release that opens the background screen to the team.
-- The new functions are named background_editors_*, never background_library_*: the earlier files revoke every
-- background_library_% function and grant only read and execute again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- The editor list. Its rows are reached only through the functions below: no policy, no direct privilege. No foreign key
-- to users, so deleting a user is never blocked by it: a row whose user is gone gives no right, as every check also asks
-- for the user row.
CREATE TABLE IF NOT EXISTS public.background_editors (
  user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 200),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.background_editors ENABLE ROW LEVEL SECURITY;

-- The edit right, in one place: an admin, or a user on the list. Internal: no role is granted it below.
CREATE OR REPLACE FUNCTION public.background_editors_can_edit(actor TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor AND (u.role='admin' OR EXISTS(SELECT 1 FROM public.background_editors e WHERE e.user_id=u.id)))
$$;

CREATE OR REPLACE FUNCTION public.background_library_snapshot(actor TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object(
  'places',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='place'),'[]'::jsonb),
  'maps',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='map'),'[]'::jsonb),
  'views',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='view'),'[]'::jsonb),
  'groups',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='group'),'[]'::jsonb),
  'usages',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='usage'),'[]'::jsonb),
  'canManage',public.background_editors_can_edit(actor))
 FROM public.background_library_entities WHERE deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.background_library_execute(p_session_token TEXT,p_request_id TEXT,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); v_kind TEXT; action TEXT; item_id UUID; expected BIGINT;
 candidate JSONB; previous public.background_library_entities%ROWTYPE; receipt JSONB; can_manage BOOLEAN; operations JSONB; operation JSONB;
BEGIN
 SELECT public.background_editors_can_edit(id) INTO can_manage FROM public.users WHERE id=actor FOR SHARE;
 IF can_manage IS NULL THEN RAISE EXCEPTION '로그인 세션이 필요합니다.' USING ERRCODE='42501'; END IF;
 PERFORM public.background_library_require(public.background_library_uuid(to_jsonb(p_request_id)),'올바른 요청 식별자가 필요합니다.');
 PERFORM public.background_library_require(jsonb_typeof(p_command)='object' AND octet_length(p_command::text)<=28000000,'배경 요청이 올바르지 않거나 너무 큽니다.');
 IF p_command->>'type'='save-maps' THEN
  IF NOT can_manage THEN RAISE EXCEPTION '배경을 고칠 권한이 없습니다. 관리자에게 배경 편집자로 지정해 달라고 요청해 주세요.' USING ERRCODE='42501'; END IF;
  PERFORM public.background_library_require(public.background_library_object(p_command,ARRAY['type','maps']) AND public.background_library_array(p_command->'maps',1,100),'함께 저장할 도면은 1개 이상 100개 이하여야 합니다.');
  operations:='[]'::jsonb;
  FOR operation IN SELECT * FROM jsonb_array_elements(p_command->'maps') LOOP
   PERFORM public.background_library_require(public.background_library_object(operation,ARRAY['entity','expectedRevision']),'도면 저장 항목의 필드가 올바르지 않습니다.');
   operations:=operations||jsonb_build_array(operation||jsonb_build_object('type','save','kind','map'));
  END LOOP;
 ELSE
  operations:=jsonb_build_array(p_command);
 END IF;
 FOR operation IN SELECT * FROM jsonb_array_elements(operations) LOOP
  v_kind:=operation->>'kind'; action:=operation->>'type';
  PERFORM public.background_library_require(v_kind IN ('place','map','view','group','usage') AND action IN ('save','delete'),'알 수 없는 배경 요청입니다.');
  IF v_kind<>'usage' AND NOT can_manage THEN RAISE EXCEPTION '배경을 고칠 권한이 없습니다. 관리자에게 배경 편집자로 지정해 달라고 요청해 주세요.' USING ERRCODE='42501'; END IF;
  PERFORM public.background_library_require(public.background_library_object(operation,CASE WHEN action='save' THEN ARRAY['type','kind','entity','expectedRevision'] ELSE ARRAY['type','kind','id','expectedRevision'] END),'배경 요청의 필드가 올바르지 않습니다.');
  IF action='save' THEN
   PERFORM public.background_library_validate_entity(v_kind,operation->'entity');
  ELSE
   PERFORM public.background_library_require(public.background_library_uuid(operation->'id'),'삭제할 항목의 식별자가 올바르지 않습니다.');
  END IF;
  PERFORM public.background_library_require((action='save' AND operation->'expectedRevision'='null'::jsonb) OR public.background_library_number(operation->'expectedRevision',1,9007199254740990,true),'저장 버전이 올바르지 않습니다.');
 END LOOP;
 IF p_command->>'type'='save-maps' THEN
  PERFORM public.background_library_require(NOT EXISTS(SELECT (item->'entity'->>'id')::uuid FROM jsonb_array_elements(operations) item GROUP BY (item->'entity'->>'id')::uuid HAVING count(*)>1),'같은 도면을 중복 저장할 수 없습니다.');
 END IF;
 -- Global reference lock, individual entity revision: unrelated edits still never conflict.
 PERFORM pg_advisory_xact_lock(2119212026,1);
 SELECT r.command INTO receipt FROM public.background_library_receipts r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt<>p_command THEN RAISE EXCEPTION '같은 요청 식별자로 다른 내용을 저장할 수 없습니다.' USING ERRCODE='22023'; END IF;
  RETURN public.background_library_snapshot(actor);
 END IF;
 -- Every operation and the final graph validation share this transaction. A later conflict or
 -- invalid link rolls all maps back, including newly created parent/child pairs.
 FOR operation IN SELECT * FROM jsonb_array_elements(operations) LOOP
  v_kind:=operation->>'kind'; action:=operation->>'type'; candidate:=operation->'entity';
  item_id:=(CASE WHEN action='save' THEN candidate->>'id' ELSE operation->>'id' END)::uuid;
  expected:=(operation->>'expectedRevision')::bigint;
  -- Episode removal retains historical usage; only the usage being saved needs a live episode.
  IF action='save' AND v_kind='usage' THEN
   PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.episodes ep WHERE ep.episode_number=(candidate->>'episodeNumber')::integer),'에피소드가 존재하지 않습니다.');
  END IF;
  SELECT * INTO previous FROM public.background_library_entities e WHERE e.kind=v_kind AND e.id=item_id FOR UPDATE;
  IF expected IS NULL THEN
   IF FOUND THEN RAISE EXCEPTION '이미 존재하거나 삭제된 식별자입니다. 다시 불러와 주세요.' USING ERRCODE='40001'; END IF;
  ELSE
   IF NOT FOUND OR previous.deleted_at IS NOT NULL OR previous.revision<>expected THEN RAISE EXCEPTION '다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.' USING ERRCODE='40001'; END IF;
  END IF;
  IF action='save' THEN
   candidate:=jsonb_set(candidate,'{revision}',to_jsonb(COALESCE(expected,0)+1));
   INSERT INTO public.background_library_entities AS target(kind,id,revision,value) VALUES(v_kind,item_id,COALESCE(expected,0)+1,candidate)
    ON CONFLICT ON CONSTRAINT background_library_entities_pkey DO UPDATE SET revision=EXCLUDED.revision,value=EXCLUDED.value,updated_at=now();
  ELSE
   UPDATE public.background_library_entities e SET deleted_at=now(),revision=e.revision+1,updated_at=now() WHERE e.kind=v_kind AND e.id=item_id;
  END IF;
 END LOOP;
 PERFORM public.background_library_validate();
 INSERT INTO public.background_library_receipts(actor_id,request_id,command) VALUES(actor,p_request_id,p_command);
 -- Realtime public channel carries no user, identifiers or entity content. Missing local extension is harmless.
 -- A failed signal must not undo the save: other clients catch up on their next read.
 BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
   EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::jsonb,'changed','background-library',false;
  END IF;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[background-library] realtime 변경 신호 전송 실패: %', SQLERRM;
 END;
 RETURN public.background_library_snapshot(actor);
END $$;

-- The editor list as the settings page reads it: for admins only, through their session. Ids of users that still exist.
CREATE OR REPLACE FUNCTION public.background_editors_session_list(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='admin') THEN RAISE EXCEPTION '배경 편집자 명단은 관리자만 볼 수 있습니다.' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(e.user_id ORDER BY e.user_id) FROM public.background_editors e JOIN public.users u ON u.id=e.user_id),'[]'::jsonb);
END $$;

-- One person put on the list or taken off it, by an admin. The answer is the list as it is afterwards. The library's
-- contentless signal goes out, so every open background screen reads again and shows its right as it is now.
CREATE OR REPLACE FUNCTION public.background_editors_session_set(p_session_token TEXT,p_user_id TEXT,p_editor BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='admin') THEN RAISE EXCEPTION '배경 편집자는 관리자만 정할 수 있습니다.' USING ERRCODE='42501'; END IF;
 IF p_editor IS NULL OR p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id) THEN RAISE EXCEPTION '배경 편집자로 정할 사용자를 찾을 수 없습니다.' USING ERRCODE='22023'; END IF;
 -- The library's lock: a change of the list never lands in the middle of a save.
 PERFORM pg_advisory_xact_lock(2119212026,1);
 IF p_editor THEN
  INSERT INTO public.background_editors(user_id,granted_by) VALUES(p_user_id,actor) ON CONFLICT (user_id) DO NOTHING;
 ELSE
  DELETE FROM public.background_editors WHERE user_id=p_user_id;
 END IF;
 BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
   EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::jsonb,'changed','background-library',false;
  END IF;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[background-editors] realtime 변경 신호 전송 실패: %', SQLERRM;
 END;
 RETURN COALESCE((SELECT jsonb_agg(e.user_id ORDER BY e.user_id) FROM public.background_editors e JOIN public.users u ON u.id=e.user_id),'[]'::jsonb);
END $$;

-- The lockdown of the earlier files, over both prefixes: every function revoked, and only the four session RPCs granted.
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; BEGIN
 REVOKE ALL PRIVILEGES ON TABLE public.background_editors FROM PUBLIC;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'background_library_%' OR p.proname LIKE 'background_editors_%') LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.background_editors FROM %I',role_name);
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'background_library_%' OR p.proname LIKE 'background_editors_%') LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',fn,role_name);
   END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.background_library_read(text),public.background_library_execute(text,text,jsonb),public.background_editors_session_list(text),public.background_editors_session_set(text,text,boolean) TO %I',role_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
