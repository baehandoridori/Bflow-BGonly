-- Execute as one batch after 20260905173804_gantt_revision_ledger.sql.
-- Uses only random fixtures. All data, receipts, sessions and ledger rows roll back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';
CREATE TEMP TABLE gantt_revision_fixture(run_id TEXT,actor_id TEXT,retired_id TEXT) ON COMMIT DROP;
INSERT INTO gantt_revision_fixture SELECT id,'gantt-revision-'||id,gen_random_uuid()::TEXT FROM (SELECT gen_random_uuid()::TEXT AS id) f;
GRANT SELECT ON gantt_revision_fixture TO anon;
INSERT INTO public.users(id,name,role,password)
SELECT actor_id,'__gantt_revision_'||run_id,'user','revision-smoke-pw' FROM gantt_revision_fixture;
INSERT INTO public.gantt_entity_revisions(entity_kind,entity_id,last_revision,retired)
SELECT 'space',retired_id,7,true FROM gantt_revision_fixture;

SET LOCAL ROLE anon;
DO $smoke$
DECLARE
  f RECORD; token TEXT; result JSONB; project_doc JSONB; old_doc JSONB; task_doc JSONB; space_doc JSONB;
  space_id TEXT:=gen_random_uuid()::TEXT; project_id TEXT:=gen_random_uuid()::TEXT; task_id TEXT:=gen_random_uuid()::TEXT;
  calendar_id UUID:=gen_random_uuid(); previous_revision INTEGER; iteration INTEGER; rejected BOOLEAN;
BEGIN
  IF current_user IS DISTINCT FROM 'anon' THEN RAISE EXCEPTION 'smoke requires anon'; END IF;
  IF (SELECT count(*) FROM gantt_revision_fixture) IS DISTINCT FROM 1::BIGINT THEN RAISE EXCEPTION 'fixture missing'; END IF;
  SELECT * INTO f FROM gantt_revision_fixture;
  result:=public.app_login('__gantt_revision_'||f.run_id,'revision-smoke-pw');
  IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR result->'ok' IS DISTINCT FROM 'true'::JSONB
    OR ((result->>'token') ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'fixture login failed'; END IF;
  token:=result->>'token';
  BEGIN PERFORM 1 FROM public.gantt_entity_revisions; RAISE EXCEPTION 'ledger exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_read(f.actor_id); RAISE EXCEPTION 'internal RPC exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_session_read(repeat('0',64)); RAISE EXCEPTION 'forged token accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  space_doc:=jsonb_build_object('id',space_id,'name','Revision smoke','ownerId',f.actor_id,'shared',false,'members','[]'::JSONB,'revision',1);
  rejected:=false;
  BEGIN
    PERFORM public.gantt_session_execute(token,'retired',jsonb_build_object('type','saveSpace','space',jsonb_set(space_doc,'{id}',to_jsonb(f.retired_id)),'expectedRevision',NULL));
  EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF rejected IS DISTINCT FROM true THEN RAISE EXCEPTION 'retired ID recreated'; END IF;
  PERFORM public.gantt_session_execute(token,'space',jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',NULL));

  INSERT INTO public.calendars(id,name,color,owner_id,visibility,is_personal)
  VALUES(calendar_id,'Revision smoke','#6C5CE7',f.actor_id,'members',false);
  task_doc:=jsonb_build_object('id',task_id,'parentId',NULL,'kind','milestone','title','One point','memo','',
    'startDate','2026-09-06','endDate','2026-09-06','allDay',false,'startTime','10:00','endTime','10:00',
    'mode','manual','predecessorId',NULL,'progress',0,'progressMode','manual','sceneLinks','[]'::JSONB,
    'workers','[]'::JSONB,'attendees','[]'::JSONB,'color',NULL,'calendarId',calendar_id,'calendarEventId',NULL,'completed',false,'sortOrder',0);
  project_doc:=jsonb_build_object('id',project_id,'spaceId',space_id,'ownerId',f.actor_id,'name','Project','memo','',
    'color','#6C5CE7','completed',false,'revision',1,'memberIds',NULL,'editorIds',NULL,'linkedEpisode',NULL,'tasks',jsonb_build_array(task_doc));
  old_doc:=project_doc;
  PERFORM public.gantt_session_execute(token,'project',jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',NULL));
  result:=public.gantt_session_calendar_events(token,NULL,NULL,'gantt:'||project_id||':'||task_id);
  IF jsonb_typeof(result) IS DISTINCT FROM 'array' OR jsonb_array_length(result) IS DISTINCT FROM 1
    OR result->0->>'id' IS DISTINCT FROM 'gantt:'||project_id||':'||task_id
    OR result->0->>'linked_gantt_task_kind' IS DISTINCT FROM 'milestone'
    OR result->0->>'start_time' IS DISTINCT FROM '10:00'
    OR result->0->>'end_time' IS DISTINCT FROM '10:00' THEN RAISE EXCEPTION 'milestone projection mismatch'; END IF;

  project_doc:=jsonb_set(project_doc,'{tasks}',jsonb_build_array(task_doc,jsonb_set(jsonb_set(task_doc,'{id}',to_jsonb(gen_random_uuid()::TEXT)),'{title}','"Preserve me"'::JSONB)));
  result:=public.gantt_session_execute(token,'edit',jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',1));
  project_doc:=result->'projects'->0;
  IF jsonb_typeof(result->'projects') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'projects') IS DISTINCT FROM 1
    OR jsonb_typeof(project_doc) IS DISTINCT FROM 'object' OR project_doc->>'id' IS DISTINCT FROM project_id
    OR (project_doc->>'revision')::INTEGER IS DISTINCT FROM 2
    OR jsonb_typeof(project_doc->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(project_doc->'tasks') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'edit lost project or tasks'; END IF;
  FOR iteration IN 1..3 LOOP
    previous_revision:=(project_doc->>'revision')::INTEGER;
    PERFORM public.gantt_session_execute(token,'delete-'||iteration,jsonb_build_object('type','deleteProject','projectId',project_id,'expectedRevision',previous_revision));
    result:=public.gantt_session_execute(token,'restore-'||iteration,jsonb_build_object('type','saveProject','project',jsonb_set(project_doc,'{revision}','1'::JSONB),'expectedRevision',NULL));
    project_doc:=result->'projects'->0;
    IF jsonb_typeof(result->'projects') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'projects') IS DISTINCT FROM 1
      OR project_doc->>'id' IS DISTINCT FROM project_id OR (project_doc->>'revision')::INTEGER IS DISTINCT FROM previous_revision+1
      OR jsonb_typeof(project_doc->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(project_doc->'tasks') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'restoration lost clock or tasks'; END IF;
  END LOOP;
  rejected:=false;
  BEGIN PERFORM public.gantt_session_execute(token,'stale-save',jsonb_build_object('type','saveProject','project',old_doc,'expectedRevision',1));
    EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF rejected IS DISTINCT FROM true THEN RAISE EXCEPTION 'stale save accepted'; END IF;
  rejected:=false;
  BEGIN PERFORM public.gantt_session_execute(token,'stale-delete',jsonb_build_object('type','deleteProject','projectId',project_id,'expectedRevision',2));
    EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF rejected IS DISTINCT FROM true THEN RAISE EXCEPTION 'stale delete accepted'; END IF;

  previous_revision:=(project_doc->>'revision')::INTEGER;
  DELETE FROM public.calendars WHERE id=calendar_id;
  result:=public.gantt_session_read(token);
  project_doc:=result->'projects'->0;
  IF jsonb_typeof(result->'projects') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'projects') IS DISTINCT FROM 1
    OR project_doc->>'id' IS DISTINCT FROM project_id OR (project_doc->>'revision')::INTEGER IS DISTINCT FROM previous_revision+1
    OR jsonb_typeof(project_doc->'tasks') IS DISTINCT FROM 'array' OR jsonb_array_length(project_doc->'tasks') IS DISTINCT FROM 2
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(project_doc->'tasks') t WHERE t->'calendarId' IS DISTINCT FROM 'null'::JSONB
      OR t->'calendarEventId' IS DISTINCT FROM 'null'::JSONB) THEN RAISE EXCEPTION 'calendar cascade failed'; END IF;
  PERFORM public.gantt_session_execute(token,'folder-delete',jsonb_build_object('type','deleteSpace','spaceId',space_id,'expectedRevision',1));
  result:=public.gantt_session_execute(token,'folder-restore',jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',NULL));
  IF jsonb_typeof(result->'spaces') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'spaces') IS DISTINCT FROM 1
    OR result->'spaces'->0->>'id' IS DISTINCT FROM space_id OR (result->'spaces'->0->>'revision')::INTEGER IS DISTINCT FROM 2
    OR result->'projects' IS DISTINCT FROM '[]'::JSONB THEN RAISE EXCEPTION 'folder clock reset'; END IF;
  result:=public.gantt_session_execute(token,'child-restore',jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',NULL));
  IF jsonb_typeof(result->'projects') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'projects') IS DISTINCT FROM 1
    OR result->'projects'->0->>'id' IS DISTINCT FROM project_id
    OR (result->'projects'->0->>'revision')::INTEGER IS DISTINCT FROM (project_doc->>'revision')::INTEGER+1
    OR result->'projects'->0->'tasks' IS DISTINCT FROM project_doc->'tasks' THEN RAISE EXCEPTION 'cascade reset child clock'; END IF;
END $smoke$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed;
