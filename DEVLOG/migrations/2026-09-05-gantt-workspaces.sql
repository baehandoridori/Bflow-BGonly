-- B flow 간트 작업 공간. 운영 적용은 별도 승인 후 수행한다.
-- Identity boundary: p_actor_id is supplied by Electron's canonical login session.
-- Existing app users are TEXT IDs, not Supabase Auth JWT identities. Like the existing
-- calendar RPCs, this migration does NOT authenticate a caller who directly invokes
-- the Data API with a forged actor. Do not describe this as stronger external authentication.
-- Tasks are one JSONB aggregate per project. Calendar entries are projections, never copies.
-- Lock order: calendars -> gantt_spaces -> gantt_projects -> actor/request receipt.

CREATE TABLE IF NOT EXISTS public.gantt_spaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES public.users(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.gantt_projects (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES public.gantt_spaces(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES public.users(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gantt_spaces_owner_idx ON public.gantt_spaces(owner_id);
CREATE INDEX IF NOT EXISTS gantt_projects_space_idx ON public.gantt_projects(space_id);
CREATE INDEX IF NOT EXISTS gantt_projects_owner_idx ON public.gantt_projects(owner_id);
CREATE TABLE IF NOT EXISTS public.gantt_requests (
  actor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  command JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, request_id)
);

-- Preserve the current app's RPC/actor model. RLS remains enabled even though its
-- legacy role-level policy cannot bind TEXT actor IDs to an authenticated JWT.
ALTER TABLE public.gantt_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gantt_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gantt_spaces' AND policyname='gantt_app_access') THEN
    CREATE POLICY gantt_app_access ON public.gantt_spaces FOR ALL USING(true) WITH CHECK(true);
    CREATE POLICY gantt_app_access ON public.gantt_projects FOR ALL USING(true) WITH CHECK(true);
    CREATE POLICY gantt_app_access ON public.gantt_requests FOR ALL USING(true) WITH CHECK(true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gantt_space_access(p_space JSONB, p_actor TEXT, p_edit BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(p_space->>'ownerId'=p_actor OR (
    (p_space->>'shared')::BOOLEAN AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_space->'members') AS m
      WHERE m->>'userId'=p_actor AND (NOT p_edit OR (m->>'canEdit')::BOOLEAN)
    )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.gantt_project_access(p_space JSONB, p_project JSONB, p_actor TEXT, p_edit BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT public.gantt_space_access(p_space,p_actor,p_edit) AND (
    p_space->>'ownerId'=p_actor OR p_project->>'ownerId'=p_actor OR (
      (p_project->'memberIds'='null'::JSONB OR p_project->'memberIds' ? p_actor)
      AND (NOT p_edit OR p_project->'editorIds'='null'::JSONB OR p_project->'editorIds' ? p_actor)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.gantt_calendar_access(p_actor TEXT,p_calendar UUID,p_edit BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calendars c
    WHERE c.id=p_calendar AND (
      c.owner_id=p_actor OR (NOT p_edit AND c.visibility='team') OR EXISTS (
        SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id
        AND m.user_id=p_actor AND (NOT p_edit OR m.can_edit)
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.gantt_read(p_actor_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor_id) THEN
    RAISE EXCEPTION '로그인 사용자를 찾을 수 없습니다' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'spaces',COALESCE((SELECT jsonb_agg(s.data ORDER BY s.created_at,s.id) FROM public.gantt_spaces s WHERE public.gantt_space_access(s.data,p_actor_id)), '[]'::JSONB),
    'projects',COALESCE((SELECT jsonb_agg(p.data ORDER BY p.created_at,p.id) FROM public.gantt_projects p JOIN public.gantt_spaces s ON s.id=p.space_id WHERE public.gantt_project_access(s.data,p.data,p_actor_id)), '[]'::JSONB)
  );
END $$;

CREATE OR REPLACE FUNCTION public.gantt_validate_project(p_project JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t JSONB; parent JSONB; next_id TEXT; visited TEXT[]; task_id TEXT; task_count INTEGER;
BEGIN
  IF jsonb_typeof(p_project) IS DISTINCT FROM 'object'
     OR NOT p_project ?& ARRAY['id','spaceId','ownerId','name','memo','color','completed','revision','memberIds','editorIds','linkedEpisode','tasks']
     OR COALESCE(p_project->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR COALESCE(p_project->>'name','')='' OR length(p_project->>'name')>2000
     OR jsonb_typeof(p_project->'memo') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_project->'completed') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_project->'tasks') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_project->'memberIds') NOT IN ('array','null')
     OR jsonb_typeof(p_project->'editorIds') NOT IN ('array','null')
     OR COALESCE(p_project->>'color','') !~ '^#[a-fA-F0-9]{6}$' THEN
    RAISE EXCEPTION '간트 프로젝트 입력이 올바르지 않습니다' USING ERRCODE='22023';
  END IF;
  task_count:=jsonb_array_length(p_project->'tasks');
  IF task_count>5000 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_project->'tasks') x)<>task_count THEN
    RAISE EXCEPTION '간트 작업 ID가 중복되거나 작업 수가 너무 많습니다' USING ERRCODE='22023';
  END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(p_project->'tasks') LOOP
    task_id:=t->>'id';
    IF NOT t ?& ARRAY['id','parentId','kind','title','memo','startDate','endDate','allDay','startTime','endTime','mode','predecessorId','progress','progressMode','sceneLinks','workers','attendees','color','calendarId','calendarEventId','completed','sortOrder']
       OR COALESCE(task_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR COALESCE(btrim(t->>'title'),'')='' OR length(t->>'title')>2000
       OR jsonb_typeof(t->'memo') IS DISTINCT FROM 'string' OR length(t->>'memo')>20000
       OR COALESCE(t->>'kind','') NOT IN ('task','group','milestone')
       OR COALESCE(t->>'mode','') NOT IN ('auto','manual')
       OR COALESCE(t->>'progressMode','') NOT IN ('manual','scenes')
       OR jsonb_typeof(t->'progress') IS DISTINCT FROM 'number'
       OR (t->>'progress')::NUMERIC NOT BETWEEN 0 AND 100
       OR jsonb_typeof(t->'allDay') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(t->'completed') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(t->'workers') IS DISTINCT FROM 'array'
       OR jsonb_typeof(t->'attendees') IS DISTINCT FROM 'array'
       OR jsonb_typeof(t->'sceneLinks') IS DISTINCT FROM 'array'
       OR jsonb_typeof(t->'sortOrder') IS DISTINCT FROM 'number'
       OR jsonb_typeof(t->'startTime') IS DISTINCT FROM 'string'
       OR jsonb_typeof(t->'endTime') IS DISTINCT FROM 'string'
       OR jsonb_typeof(t->'parentId') NOT IN ('string','null')
       OR jsonb_typeof(t->'predecessorId') NOT IN ('string','null')
       OR COALESCE(t->>'startDate','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR COALESCE(t->>'endDate','') !~ '^\d{4}-\d{2}-\d{2}$'
       OR (t->>'startDate')::DATE>(t->>'endDate')::DATE
       OR (t->>'color' IS NOT NULL AND t->>'color' !~ '^#[a-fA-F0-9]{6}$') THEN
      RAISE EXCEPTION '간트 작업 입력이 올바르지 않습니다: %', task_id USING ERRCODE='22023';
    END IF;
    IF NOT (t->>'allDay')::BOOLEAN THEN
      IF COALESCE(t->>'startTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
         OR COALESCE(t->>'endTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
         OR (t->>'startDate')::DATE+(t->>'startTime')::TIME > (t->>'endDate')::DATE+(t->>'endTime')::TIME THEN
        RAISE EXCEPTION '작업 시간이 올바르지 않습니다' USING ERRCODE='22023';
      END IF;
    END IF;
    IF t->>'kind'='milestone' AND ((t->>'startDate')<>(t->>'endDate') OR (NOT (t->>'allDay')::BOOLEAN AND t->>'startTime'<>t->>'endTime')) THEN
      RAISE EXCEPTION '마일스톤은 한 시점이어야 합니다' USING ERRCODE='22023';
    END IF;
    IF t->>'calendarId' IS NOT NULL THEN PERFORM (t->>'calendarId')::UUID; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text((t->'workers')||(t->'attendees')) u WHERE NOT EXISTS(SELECT 1 FROM public.users WHERE id=u)) THEN
      RAISE EXCEPTION '작업 참여자를 찾을 수 없습니다' USING ERRCODE='23503';
    END IF;
    visited:=ARRAY[task_id]; next_id:=t->>'parentId';
    WHILE next_id IS NOT NULL LOOP
      IF next_id=ANY(visited) THEN RAISE EXCEPTION '그룹 계층이 순환합니다' USING ERRCODE='22023'; END IF;
      SELECT value INTO parent FROM jsonb_array_elements(p_project->'tasks') WHERE value->>'id'=next_id;
      IF parent IS NULL OR parent->>'kind'<>'group' THEN RAISE EXCEPTION '상위 작업 그룹이 없습니다' USING ERRCODE='22023'; END IF;
      visited:=array_append(visited,next_id); next_id:=parent->>'parentId';
    END LOOP;
    visited:=ARRAY[task_id]; next_id:=t->>'predecessorId';
    WHILE next_id IS NOT NULL LOOP
      IF next_id=ANY(visited) THEN RAISE EXCEPTION '선행 작업이 순환합니다' USING ERRCODE='22023'; END IF;
      SELECT value INTO parent FROM jsonb_array_elements(p_project->'tasks') WHERE value->>'id'=next_id;
      IF parent IS NULL THEN RAISE EXCEPTION '선행 작업이 없습니다' USING ERRCODE='22023'; END IF;
      visited:=array_append(visited,next_id); next_id:=parent->>'predecessorId';
    END LOOP;
  END LOOP;
  IF EXISTS (
    WITH RECURSIVE tasks AS (SELECT value AS task FROM jsonb_array_elements(p_project->'tasks')),
    ancestors(descendant,ancestor) AS (
      SELECT task->>'id',task->>'parentId' FROM tasks WHERE task->>'parentId' IS NOT NULL
      UNION ALL SELECT a.descendant,t.task->>'parentId' FROM ancestors a JOIN tasks t ON t.task->>'id'=a.ancestor WHERE t.task->>'parentId' IS NOT NULL
    ),
    edges AS (
      SELECT task->>'id' AS source,task->>'predecessorId' AS target FROM tasks WHERE task->>'predecessorId' IS NOT NULL
      UNION ALL SELECT task->>'parentId',task->>'id' FROM tasks WHERE task->>'parentId' IS NOT NULL
      UNION ALL SELECT a.descendant,t.task->>'predecessorId' FROM ancestors a JOIN tasks t ON t.task->>'id'=a.ancestor WHERE t.task->>'predecessorId' IS NOT NULL
    ), walk(source,target) AS (
      SELECT source,target FROM edges
      UNION SELECT w.source,e.target FROM walk w JOIN edges e ON e.source=w.target
    ) SELECT 1 FROM walk WHERE source=target
  ) THEN RAISE EXCEPTION '그룹과 선행 작업 사이에 순환 관계가 있습니다' USING ERRCODE='22023'; END IF;
END $$;

-- Only changed calendar-shared fields require its editor permission. Personal task metadata
-- can still be changed after calendar edit rights are revoked, without altering shared details.
CREATE OR REPLACE FUNCTION public.gantt_check_calendar_changes(p_actor TEXT,p_before JSONB,p_after JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE entry RECORD; shared_keys TEXT[]:=ARRAY['title','memo','startDate','endDate','allDay','startTime','endTime','calendarId','kind']; before_fields JSONB; after_fields JSONB;
BEGIN
  FOR entry IN
    SELECT b.value AS old_task,a.value AS new_task
    FROM jsonb_array_elements(COALESCE(p_before->'tasks','[]'::JSONB)) b
    FULL JOIN jsonb_array_elements(COALESCE(p_after->'tasks','[]'::JSONB)) a ON b.value->>'id'=a.value->>'id'
  LOOP
    SELECT jsonb_object_agg(key,value) INTO before_fields FROM jsonb_each(COALESCE(entry.old_task,'{}'::JSONB)) WHERE key=ANY(shared_keys);
    SELECT jsonb_object_agg(key,value) INTO after_fields FROM jsonb_each(COALESCE(entry.new_task,'{}'::JSONB)) WHERE key=ANY(shared_keys);
    IF before_fields IS DISTINCT FROM after_fields THEN
      IF entry.old_task->>'calendarId' IS NOT NULL AND NOT public.gantt_calendar_access(p_actor,(entry.old_task->>'calendarId')::UUID,true) THEN
        RAISE EXCEPTION '연결된 캘린더의 편집 권한이 필요합니다' USING ERRCODE='42501';
      END IF;
      IF entry.new_task->>'calendarId' IS NOT NULL AND NOT public.gantt_calendar_access(p_actor,(entry.new_task->>'calendarId')::UUID,true) THEN
        RAISE EXCEPTION '연결할 캘린더의 편집 권한이 필요합니다' USING ERRCODE='42501';
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.gantt_execute(p_actor_id TEXT,p_request_id TEXT,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE kind TEXT; submitted JSONB; existing JSONB; space JSONB; receipt JSONB; expected INTEGER; next_revision INTEGER; entity_id TEXT; member JSONB; p RECORD; next_data JSONB; next_owner TEXT; acl_key TEXT;
BEGIN
  IF COALESCE(btrim(p_request_id),'')='' OR length(p_request_id)>128 OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR length(p_command::TEXT)>4000000 THEN
    RAISE EXCEPTION '간트 요청이 올바르지 않습니다' USING ERRCODE='22023';
  END IF;
  -- A short write boundary for this small team: calendar writers cannot revoke permissions
  -- between validation and the project CAS. Calendar deletion also obtains calendar locks first.
  LOCK TABLE public.calendars IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_spaces IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_projects IN SHARE ROW EXCLUSIVE MODE;
  PERFORM id FROM public.users WHERE id=p_actor_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '로그인 사용자를 찾을 수 없습니다' USING ERRCODE='42501'; END IF;
  SELECT command INTO receipt FROM public.gantt_requests WHERE actor_id=p_actor_id AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt IS DISTINCT FROM p_command THEN RAISE EXCEPTION '같은 요청 ID에 다른 변경을 보낼 수 없습니다' USING ERRCODE='22023'; END IF;
    RETURN public.gantt_read(p_actor_id); -- fresh ACL; never return a stale private receipt snapshot
  END IF;
  kind:=p_command->>'type';
  expected:=(p_command->>'expectedRevision')::INTEGER;
  IF expected IS NOT NULL AND expected<0 THEN RAISE EXCEPTION '버전이 올바르지 않습니다' USING ERRCODE='22023'; END IF;
  IF kind='saveSpace' THEN
    submitted:=p_command->'space'; entity_id:=submitted->>'id';
    IF jsonb_typeof(submitted) IS DISTINCT FROM 'object' OR COALESCE(entity_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(btrim(submitted->>'name'),'')='' OR length(submitted->>'name')>2000
       OR jsonb_typeof(submitted->'shared') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(submitted->'members') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '간트 폴더 입력이 올바르지 않습니다' USING ERRCODE='22023';
    END IF;
    SELECT data INTO existing FROM public.gantt_spaces WHERE id=entity_id;
    IF existing IS NULL THEN
      IF expected IS NOT NULL OR submitted->>'ownerId' IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION '간트 폴더 생성 권한 또는 버전이 올바르지 않습니다' USING ERRCODE='42501'; END IF;
      next_revision:=1;
    ELSE
      IF existing->>'ownerId'<>p_actor_id OR submitted->>'ownerId' IS DISTINCT FROM existing->>'ownerId' THEN RAISE EXCEPTION '폴더 소유자만 공유 설정을 변경할 수 있습니다' USING ERRCODE='42501'; END IF;
      IF expected IS DISTINCT FROM (existing->>'revision')::INTEGER THEN RAISE EXCEPTION '다른 사용자가 폴더를 먼저 수정했습니다' USING ERRCODE='40001'; END IF;
      next_revision:=expected+1;
    END IF;
    IF (SELECT count(DISTINCT value->>'userId') FROM jsonb_array_elements(submitted->'members'))<>jsonb_array_length(submitted->'members') THEN RAISE EXCEPTION '폴더 멤버가 중복됩니다' USING ERRCODE='22023'; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(submitted->'members') LOOP
      IF jsonb_typeof(member->'canEdit') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=member->>'userId') THEN RAISE EXCEPTION '폴더 멤버가 올바르지 않습니다' USING ERRCODE='22023'; END IF;
    END LOOP;
    submitted:=jsonb_set(submitted,'{revision}',to_jsonb(next_revision));
    INSERT INTO public.gantt_spaces(id,owner_id,revision,data) VALUES(entity_id,p_actor_id,next_revision,submitted)
    ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now();
    -- A folder access change must leave each child project editable by its owner.
    -- Transfer departed owners to the folder owner and trim explicit project ACLs
    -- in this same locked transaction; revision changes invalidate stale saves/undo.
    FOR p IN SELECT * FROM public.gantt_projects WHERE space_id=entity_id ORDER BY id LOOP
      next_owner:=CASE WHEN public.gantt_space_access(submitted,p.owner_id) THEN p.owner_id ELSE submitted->>'ownerId' END;
      next_data:=jsonb_set(p.data,'{ownerId}',to_jsonb(next_owner));
      FOREACH acl_key IN ARRAY ARRAY['memberIds','editorIds'] LOOP
        IF next_data->acl_key<>'null'::JSONB THEN
          next_data:=jsonb_set(next_data,ARRAY[acl_key],COALESCE((
            SELECT jsonb_agg(v ORDER BY ord)
            FROM jsonb_array_elements(next_data->acl_key) WITH ORDINALITY e(v,ord)
            WHERE public.gantt_space_access(submitted,v#>>'{}')
          ),'[]'::JSONB));
        END IF;
      END LOOP;
      IF next_data IS DISTINCT FROM p.data THEN
        UPDATE public.gantt_projects SET owner_id=next_owner,revision=p.revision+1,
          data=jsonb_set(next_data,'{revision}',to_jsonb(p.revision+1)),updated_at=now() WHERE id=p.id;
      END IF;
    END LOOP;
  ELSIF kind='saveProject' THEN
    submitted:=p_command->'project'; entity_id:=submitted->>'id';
    PERFORM public.gantt_validate_project(submitted);
    SELECT data INTO existing FROM public.gantt_projects WHERE id=entity_id;
    SELECT data INTO space FROM public.gantt_spaces WHERE id=submitted->>'spaceId';
    IF space IS NULL OR NOT public.gantt_space_access(space,p_actor_id,true) THEN RAISE EXCEPTION '폴더 편집 권한이 필요합니다' USING ERRCODE='42501'; END IF;
    IF existing IS NULL THEN
      IF expected IS NOT NULL OR submitted->>'ownerId' IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION '프로젝트 생성 권한 또는 버전이 올바르지 않습니다' USING ERRCODE='42501'; END IF;
      next_revision:=1;
    ELSE
      IF submitted->>'spaceId' IS DISTINCT FROM existing->>'spaceId' OR submitted->>'ownerId' IS DISTINCT FROM existing->>'ownerId' THEN RAISE EXCEPTION '프로젝트 소속과 소유자는 변경할 수 없습니다' USING ERRCODE='22023'; END IF;
      IF NOT public.gantt_project_access(space,existing,p_actor_id,true) THEN RAISE EXCEPTION '프로젝트 편집 권한이 필요합니다' USING ERRCODE='42501'; END IF;
      IF expected IS DISTINCT FROM (existing->>'revision')::INTEGER THEN RAISE EXCEPTION '다른 사용자가 프로젝트를 먼저 수정했습니다' USING ERRCODE='40001'; END IF;
      IF (submitted->'memberIds' IS DISTINCT FROM existing->'memberIds' OR submitted->'editorIds' IS DISTINCT FROM existing->'editorIds') AND p_actor_id NOT IN (existing->>'ownerId',space->>'ownerId') THEN RAISE EXCEPTION '소유자만 프로젝트 권한을 변경할 수 있습니다' USING ERRCODE='42501'; END IF;
      next_revision:=expected+1;
    END IF;
    IF NOT public.gantt_space_access(space,submitted->>'ownerId') THEN RAISE EXCEPTION '프로젝트 소유자는 폴더 참여자여야 합니다' USING ERRCODE='42501'; END IF;
    IF submitted->'memberIds'<>'null'::JSONB THEN
      FOR member IN SELECT value FROM jsonb_array_elements(submitted->'memberIds') LOOP
        IF jsonb_typeof(member)<>'string' OR NOT public.gantt_space_access(space,member#>>'{}') THEN RAISE EXCEPTION '프로젝트 참여자는 폴더 참여자여야 합니다' USING ERRCODE='42501'; END IF;
      END LOOP;
    END IF;
    IF submitted->'editorIds'<>'null'::JSONB THEN
      FOR member IN SELECT value FROM jsonb_array_elements(submitted->'editorIds') LOOP
        IF jsonb_typeof(member)<>'string' OR NOT public.gantt_space_access(space,member#>>'{}')
           OR (submitted->'memberIds'<>'null'::JSONB AND NOT submitted->'memberIds' ? (member#>>'{}') AND member#>>'{}'<>submitted->>'ownerId') THEN RAISE EXCEPTION '프로젝트 편집자는 참여 범위를 넓힐 수 없습니다' USING ERRCODE='42501'; END IF;
      END LOOP;
    END IF;
    PERFORM public.gantt_check_calendar_changes(p_actor_id,existing,submitted);
    submitted:=jsonb_set(submitted,'{revision}',to_jsonb(next_revision));
    INSERT INTO public.gantt_projects(id,space_id,owner_id,revision,data) VALUES(entity_id,submitted->>'spaceId',submitted->>'ownerId',next_revision,submitted)
    ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now();
  ELSIF kind='deleteProject' THEN
    entity_id:=p_command->>'projectId'; SELECT data INTO existing FROM public.gantt_projects WHERE id=entity_id;
    SELECT data INTO space FROM public.gantt_spaces WHERE id=existing->>'spaceId';
    IF existing IS NULL OR NOT public.gantt_project_access(space,existing,p_actor_id,true) THEN RAISE EXCEPTION '프로젝트 삭제 권한이 없습니다' USING ERRCODE='42501'; END IF;
    IF expected IS DISTINCT FROM (existing->>'revision')::INTEGER THEN RAISE EXCEPTION '다른 사용자가 프로젝트를 먼저 수정했습니다' USING ERRCODE='40001'; END IF;
    PERFORM public.gantt_check_calendar_changes(p_actor_id,existing,NULL);
    DELETE FROM public.gantt_projects WHERE id=entity_id;
  ELSIF kind='deleteSpace' THEN
    entity_id:=p_command->>'spaceId'; SELECT data INTO existing FROM public.gantt_spaces WHERE id=entity_id;
    IF existing IS NULL OR existing->>'ownerId'<>p_actor_id THEN RAISE EXCEPTION '폴더 소유자만 삭제할 수 있습니다' USING ERRCODE='42501'; END IF;
    IF expected IS DISTINCT FROM (existing->>'revision')::INTEGER THEN RAISE EXCEPTION '다른 사용자가 폴더를 먼저 수정했습니다' USING ERRCODE='40001'; END IF;
    -- Undoing folder creation may only remove a still-empty folder. A project
    -- can arrive after the renderer's read without changing the folder revision.
    IF p_command->'requireEmpty'='true'::JSONB AND EXISTS(SELECT 1 FROM public.gantt_projects WHERE space_id=entity_id) THEN
      RAISE EXCEPTION '폴더에 다른 프로젝트가 추가되어 실행 취소할 수 없습니다' USING ERRCODE='40001';
    END IF;
    FOR p IN SELECT data FROM public.gantt_projects WHERE space_id=entity_id LOOP
      PERFORM public.gantt_check_calendar_changes(p_actor_id,p.data,NULL);
    END LOOP;
    DELETE FROM public.gantt_spaces WHERE id=entity_id;
  ELSE
    RAISE EXCEPTION '알 수 없는 간트 요청입니다' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.gantt_requests(actor_id,request_id,command) VALUES(p_actor_id,p_request_id,p_command);
  RETURN public.gantt_read(p_actor_id);
END $$;

CREATE OR REPLACE FUNCTION public.gantt_calendar_events(p_actor_id TEXT,p_from DATE DEFAULT NULL,p_to DATE DEFAULT NULL,p_event_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor_id) THEN RAISE EXCEPTION '로그인 사용자를 찾을 수 없습니다' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id','gantt:'||p.id||':'||(t->>'id'),'calendar_id',t->>'calendarId',
    'title',t->>'title','memo',t->>'memo','tag_id',NULL,'all_day',(t->>'allDay')::BOOLEAN,
    'start_date',t->>'startDate','end_date',t->>'endDate',
    'start_time',CASE WHEN (t->>'allDay')::BOOLEAN THEN NULL ELSE t->>'startTime' END,
    'end_time',CASE WHEN (t->>'allDay')::BOOLEAN THEN NULL ELSE t->>'endTime' END,
    'linked_episode',NULL,'linked_part',NULL,'linked_sheet_name',NULL,'linked_scene_id',NULL,'linked_department',NULL,'linked_todo_id',NULL,
    'created_by',p.owner_id,'created_at',p.created_at,'updated_at',p.updated_at,
    'linked_gantt_project_id',p.id,'linked_gantt_task_id',t->>'id',
    'gantt_can_edit',public.gantt_project_access(s.data,p.data,p_actor_id,true) AND public.gantt_calendar_access(p_actor_id,(t->>'calendarId')::UUID,true)
  ) ORDER BY t->>'startDate',p.id,t->>'id'),'[]'::JSONB) INTO result
  FROM public.gantt_projects p JOIN public.gantt_spaces s ON s.id=p.space_id
  CROSS JOIN LATERAL jsonb_array_elements(p.data->'tasks') t
  WHERE t->>'calendarId' IS NOT NULL AND t->>'kind'<>'group' AND public.gantt_calendar_access(p_actor_id,(t->>'calendarId')::UUID)
    AND (p_from IS NULL OR (t->>'endDate')::DATE>=p_from)
    AND (p_to IS NULL OR (t->>'startDate')::DATE<=p_to)
    AND (p_event_id IS NULL OR 'gantt:'||p.id||':'||(t->>'id')=p_event_id);
  RETURN result;
END $$;

-- Deleting a calendar removes only its display links; the tasks and project remain.
-- The trigger participates in the original calendar transaction and increments the same
-- project revision, so an in-flight project save cannot restore the removed calendar ID.
CREATE OR REPLACE FUNCTION public.gantt_unlink_deleted_calendar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  LOCK TABLE public.gantt_spaces IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_projects IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.gantt_projects p
  SET data=jsonb_set(jsonb_set(p.data,'{tasks}',(
    SELECT jsonb_agg(CASE WHEN t->>'calendarId'=OLD.id::TEXT
      THEN jsonb_set(jsonb_set(t,'{calendarId}','null'::JSONB),'{calendarEventId}','null'::JSONB) ELSE t END ORDER BY ord)
    FROM jsonb_array_elements(p.data->'tasks') WITH ORDINALITY e(t,ord)
  )),'{revision}',to_jsonb(p.revision+1)),revision=p.revision+1,updated_at=now()
  WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(p.data->'tasks') t WHERE t->>'calendarId'=OLD.id::TEXT);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS gantt_calendar_deleted ON public.calendars;
CREATE TRIGGER gantt_calendar_deleted AFTER DELETE ON public.calendars FOR EACH ROW EXECUTE FUNCTION public.gantt_unlink_deleted_calendar();

-- The existing delete_user_authorized -> delete_user_cascade path obtains calendar locks
-- before deleting users. Preserve its rule: personal data is removed; shared team assets
-- move to another admin (배한솔 first), and the whole deletion fails if none exists.
CREATE OR REPLACE FUNCTION public.gantt_before_user_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE successor TEXT; p RECORD; next_data JSONB; next_tasks JSONB; next_owner TEXT;
BEGIN
  LOCK TABLE public.calendars IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_spaces IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_projects IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM public.gantt_spaces WHERE owner_id=OLD.id AND (data->>'shared')::BOOLEAN) THEN
    SELECT id INTO successor FROM public.users WHERE id<>OLD.id AND role='admin'
    ORDER BY (name='배한솔') DESC,created_at ASC,id ASC LIMIT 1 FOR NO KEY UPDATE;
    IF successor IS NULL THEN RAISE EXCEPTION '공유 간트를 인계할 다른 관리자가 필요합니다. 먼저 관리자를 지정해 주세요.' USING ERRCODE='55000'; END IF;
  END IF;
  DELETE FROM public.gantt_spaces WHERE owner_id=OLD.id AND NOT (data->>'shared')::BOOLEAN;
  UPDATE public.gantt_spaces s SET
    owner_id=CASE WHEN s.owner_id=OLD.id THEN successor ELSE s.owner_id END,
    data=jsonb_set(jsonb_set(jsonb_set(s.data,'{ownerId}',to_jsonb(CASE WHEN s.owner_id=OLD.id THEN successor ELSE s.owner_id END)),
      '{members}',COALESCE((SELECT jsonb_agg(m) FROM jsonb_array_elements(s.data->'members') m
        WHERE m->>'userId'<>OLD.id AND m->>'userId'<>CASE WHEN s.owner_id=OLD.id THEN successor ELSE s.owner_id END),'[]'::JSONB)),
      '{revision}',to_jsonb(s.revision+1)),
    revision=s.revision+1,updated_at=now()
  WHERE s.owner_id=OLD.id OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.data->'members') m WHERE m->>'userId'=OLD.id);
  FOR p IN SELECT gp.*,s.owner_id AS space_owner FROM public.gantt_projects gp JOIN public.gantt_spaces s ON s.id=gp.space_id ORDER BY gp.id LOOP
    next_data:=p.data;
    next_owner:=CASE WHEN p.owner_id=OLD.id THEN p.space_owner ELSE p.owner_id END;
    next_data:=jsonb_set(next_data,'{ownerId}',to_jsonb(next_owner));
    IF next_data->'memberIds'<>'null'::JSONB THEN
      next_data:=jsonb_set(next_data,'{memberIds}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(next_data->'memberIds') v WHERE v#>>'{}'<>OLD.id),'[]'::JSONB));
    END IF;
    IF next_data->'editorIds'<>'null'::JSONB THEN
      next_data:=jsonb_set(next_data,'{editorIds}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(next_data->'editorIds') v WHERE v#>>'{}'<>OLD.id),'[]'::JSONB));
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_set(jsonb_set(t,'{workers}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(t->'workers') v WHERE v#>>'{}'<>OLD.id),'[]'::JSONB)),
      '{attendees}',COALESCE((SELECT jsonb_agg(v) FROM jsonb_array_elements(t->'attendees') v WHERE v#>>'{}'<>OLD.id),'[]'::JSONB)) ORDER BY ord),'[]'::JSONB)
    INTO next_tasks FROM jsonb_array_elements(next_data->'tasks') WITH ORDINALITY e(t,ord);
    next_data:=jsonb_set(next_data,'{tasks}',next_tasks);
    IF next_data IS DISTINCT FROM p.data THEN
      UPDATE public.gantt_projects SET owner_id=next_owner,revision=p.revision+1,
        data=jsonb_set(next_data,'{revision}',to_jsonb(p.revision+1)),updated_at=now() WHERE id=p.id;
    END IF;
  END LOOP;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS gantt_user_deleted ON public.users;
CREATE TRIGGER gantt_user_deleted BEFORE DELETE ON public.users FOR EACH ROW EXECUTE FUNCTION public.gantt_before_user_delete();

-- Parent calendar/user DELETE keeps its existing authorization. Only these trigger
-- bodies need Gantt table access after containment; they are never public RPCs.
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_unlink_deleted_calendar(),public.gantt_before_user_delete() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_unlink_deleted_calendar(),public.gantt_before_user_delete() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;

DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.gantt_spaces,public.gantt_projects,public.gantt_requests TO %I',role_name);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.gantt_read(TEXT),public.gantt_execute(TEXT,TEXT,JSONB),public.gantt_calendar_events(TEXT,DATE,DATE,TEXT) TO %I',role_name);
    END IF;
  END LOOP;
END $$;

DO $$ DECLARE table_name TEXT; BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY['gantt_spaces','gantt_projects'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=table_name) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',table_name);
      END IF;
    END LOOP;
  END IF;
END $$;
