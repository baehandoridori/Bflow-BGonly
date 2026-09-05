-- Generated with Supabase CLI migration new gantt_project_pair.
-- Apply after 20260905173804_gantt_revision_ledger.sql.
-- Add one atomic two-project task transfer; keep existing session-only RPC grants.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
CREATE OR REPLACE FUNCTION public.gantt_execute(p_actor_id TEXT,p_request_id TEXT,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE kind TEXT; submitted JSONB; existing JSONB; space JSONB; receipt JSONB; expected INTEGER; next_revision INTEGER; entity_id TEXT; member JSONB; p RECORD; next_data JSONB; next_owner TEXT; acl_key TEXT; saves JSONB; save_item JSONB; pending_projects JSONB := '[]'::JSONB; expected_space JSONB;
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
  ELSIF kind IN ('saveProject','saveProjectPair') THEN
    IF kind='saveProjectPair' THEN
      IF jsonb_typeof(p_command->'projects') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'projects')<>2 THEN
        RAISE EXCEPTION '서로 다른 두 프로젝트가 필요합니다' USING ERRCODE='22023';
      END IF;
      saves:=p_command->'projects';
      IF (SELECT count(DISTINCT value->'project'->>'id') FROM jsonb_array_elements(saves))<>2 THEN
        RAISE EXCEPTION '서로 다른 두 프로젝트가 필요합니다' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(p_command->'expectedSpaces') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION '이동할 폴더 버전이 필요합니다' USING ERRCODE='22023';
      END IF;
      IF (SELECT count(DISTINCT value->'project'->>'spaceId') FROM jsonb_array_elements(saves))<>jsonb_array_length(p_command->'expectedSpaces')
        OR (SELECT count(DISTINCT value->>'spaceId') FROM jsonb_array_elements(p_command->'expectedSpaces'))<>jsonb_array_length(p_command->'expectedSpaces') THEN
        RAISE EXCEPTION '이동할 폴더 버전이 필요합니다' USING ERRCODE='22023';
      END IF;
      FOR expected_space IN SELECT value FROM jsonb_array_elements(p_command->'expectedSpaces') LOOP
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saves) item WHERE item->'project'->>'spaceId'=expected_space->>'spaceId')
          OR jsonb_typeof(expected_space->'expectedRevision') IS DISTINCT FROM 'number' OR (expected_space->>'expectedRevision')::NUMERIC<>trunc((expected_space->>'expectedRevision')::NUMERIC)
          OR (expected_space->>'expectedRevision')::INTEGER<1 THEN
          RAISE EXCEPTION '이동할 폴더 버전이 올바르지 않습니다' USING ERRCODE='22023';
        END IF;
        SELECT data INTO space FROM public.gantt_spaces WHERE id=expected_space->>'spaceId';
        IF space IS NULL OR (space->>'revision')::INTEGER IS DISTINCT FROM (expected_space->>'expectedRevision')::INTEGER THEN
          RAISE EXCEPTION '다른 사용자가 폴더를 먼저 수정했습니다' USING ERRCODE='40001';
        END IF;
      END LOOP;
    ELSE saves:=jsonb_build_array(p_command); END IF;
    FOR save_item IN SELECT value FROM jsonb_array_elements(saves) LOOP
    submitted:=save_item->'project'; entity_id:=submitted->>'id';
    expected:=(save_item->>'expectedRevision')::INTEGER;
    IF kind='saveProjectPair' AND (jsonb_typeof(save_item->'expectedRevision') IS DISTINCT FROM 'number' OR (save_item->>'expectedRevision')::NUMERIC<>trunc((save_item->>'expectedRevision')::NUMERIC) OR expected<1) THEN
      RAISE EXCEPTION '프로젝트 버전이 올바르지 않습니다' USING ERRCODE='22023';
    END IF;
    PERFORM public.gantt_validate_project(submitted);
    SELECT data INTO existing FROM public.gantt_projects WHERE id=entity_id;
    IF kind='saveProjectPair' THEN
      IF existing IS NULL THEN RAISE EXCEPTION '이동할 프로젝트를 찾을 수 없습니다' USING ERRCODE='40001'; END IF;
      IF (submitted-ARRAY['tasks','completed','revision']) IS DISTINCT FROM (existing-ARRAY['tasks','completed','revision']) THEN
        RAISE EXCEPTION '작업 이동 중 프로젝트 정보는 변경할 수 없습니다' USING ERRCODE='22023';
      END IF;
      IF existing->'completed'='true'::JSONB OR submitted->'completed'='true'::JSONB THEN
        RAISE EXCEPTION '완료된 프로젝트를 다시 연 뒤 이동해 주세요' USING ERRCODE='22023';
      END IF;
    END IF;
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
    pending_projects:=pending_projects||jsonb_build_array(submitted);
    END LOOP;
    -- Both projects passed ACL, folder/project CAS, content and calendar checks.
    -- Publish their changes and one receipt in the same transaction.
    FOR submitted IN SELECT value FROM jsonb_array_elements(pending_projects) LOOP
    entity_id:=submitted->>'id';next_revision:=(submitted->>'revision')::INTEGER;
    INSERT INTO public.gantt_projects(id,space_id,owner_id,revision,data) VALUES(entity_id,submitted->>'spaceId',submitted->>'ownerId',next_revision,submitted)
    ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=now();
    END LOOP;
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


REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_execute(TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
