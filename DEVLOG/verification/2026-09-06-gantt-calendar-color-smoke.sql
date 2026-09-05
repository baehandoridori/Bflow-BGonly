-- Run as one batch after 20260905210416_gantt_calendar_color.sql.
-- Only randomized fixtures are used; every row, session, receipt and revision rolls back.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';
CREATE TEMP TABLE gantt_color_fixture(run_id TEXT,owner_id TEXT,viewer_id TEXT) ON COMMIT DROP;
INSERT INTO gantt_color_fixture SELECT id,'gantt-color-owner-'||id,'gantt-color-viewer-'||id FROM (SELECT gen_random_uuid()::TEXT id) f;
GRANT SELECT ON gantt_color_fixture TO anon;
INSERT INTO public.users(id,name,role,password)
SELECT owner_id,'__gantt_color_owner_'||run_id,'user','color-smoke-pw' FROM gantt_color_fixture
UNION ALL SELECT viewer_id,'__gantt_color_viewer_'||run_id,'user','color-smoke-pw' FROM gantt_color_fixture;
SET LOCAL ROLE anon;
DO $smoke$
DECLARE
  f RECORD; token TEXT; viewer_token TEXT; result JSONB; project_doc JSONB; task_doc JSONB; group_doc JSONB; child_group_doc JSONB;
  space_id TEXT:=gen_random_uuid()::TEXT; project_id TEXT:=gen_random_uuid()::TEXT; task_id TEXT:=gen_random_uuid()::TEXT;
  group_id TEXT:=gen_random_uuid()::TEXT; child_group_id TEXT:=gen_random_uuid()::TEXT; calendar_id UUID:=gen_random_uuid();
  step INTEGER; expected_color TEXT;
BEGIN
  IF current_user IS DISTINCT FROM 'anon' THEN RAISE EXCEPTION 'smoke requires anon'; END IF;
  IF (SELECT count(*) FROM gantt_color_fixture) IS DISTINCT FROM 1::BIGINT THEN RAISE EXCEPTION 'fixture missing'; END IF;
  SELECT * INTO f FROM gantt_color_fixture;
  result:=public.app_login('__gantt_color_owner_'||f.run_id,'color-smoke-pw');token:=result->>'token';
  IF result->'ok' IS DISTINCT FROM 'true'::JSONB OR (token ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'owner login failed'; END IF;
  result:=public.app_login('__gantt_color_viewer_'||f.run_id,'color-smoke-pw');viewer_token:=result->>'token';
  IF result->'ok' IS DISTINCT FROM 'true'::JSONB OR (viewer_token ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'viewer login failed'; END IF;
  BEGIN PERFORM public.gantt_calendar_events(f.owner_id); RAISE EXCEPTION 'internal RPC exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.gantt_session_execute(token,'color-space',jsonb_build_object('type','saveSpace','expectedRevision',NULL,
    'space',jsonb_build_object('id',space_id,'name','Color smoke','ownerId',f.owner_id,'shared',false,'members','[]'::JSONB,'revision',1)));
  INSERT INTO public.calendars(id,name,color,owner_id,visibility,is_personal) VALUES(calendar_id,'Color smoke','#6C5CE7',f.owner_id,'team',false);
  task_doc:=jsonb_build_object('id',task_id,'parentId',child_group_id,'kind','task','title','Linked color','memo','',
    'startDate','2026-09-06','endDate','2026-09-06','allDay',true,'startTime','','endTime','',
    'mode','manual','predecessorId',NULL,'progress',100,'progressMode','manual','sceneLinks','[]'::JSONB,
    'workers','[]'::JSONB,'attendees','[]'::JSONB,'color',NULL,'calendarId',calendar_id,'calendarEventId',NULL,'completed',true,'sortOrder',0);
  group_doc:=task_doc||jsonb_build_object('id',group_id,'parentId',NULL,'kind','group','calendarId',NULL,'color','#FDCB6E');
  child_group_doc:=group_doc||jsonb_build_object('id',child_group_id,'parentId',group_id,'color',NULL);
  project_doc:=jsonb_build_object('id',project_id,'spaceId',space_id,'ownerId',f.owner_id,'name','Color project','memo','Private project note',
    'color','#74B9FF','completed',false,'revision',1,'memberIds',NULL,'editorIds',NULL,'linkedEpisode',NULL,'tasks',jsonb_build_array(group_doc,child_group_doc,task_doc));
  FOR step IN 1..3 LOOP
    IF step=1 THEN expected_color:='#FDCB6E';
    ELSIF step=2 THEN expected_color:='#FF6B6B';task_doc:=task_doc||jsonb_build_object('color',expected_color);
    ELSE expected_color:='#74B9FF';task_doc:=task_doc||jsonb_build_object('color',NULL);group_doc:=group_doc||jsonb_build_object('color',NULL);END IF;
    project_doc:=project_doc||jsonb_build_object('tasks',jsonb_build_array(group_doc,child_group_doc,task_doc));
    result:=public.gantt_session_execute(token,'color-project-'||step,jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',CASE WHEN step=1 THEN NULL ELSE step-1 END));
    project_doc:=result->'projects'->0;
    IF project_doc->>'id' IS DISTINCT FROM project_id OR (project_doc->>'revision')::INTEGER IS DISTINCT FROM step THEN RAISE EXCEPTION 'save failed'; END IF;
    result:=public.gantt_session_calendar_events(viewer_token,'2026-09-06','2026-09-06','gantt:'||project_id||':'||task_id);
    IF jsonb_typeof(result) IS DISTINCT FROM 'array' OR jsonb_array_length(result) IS DISTINCT FROM 1
      OR result->0->>'gantt_color' IS DISTINCT FROM expected_color OR result->0->'gantt_can_edit' IS DISTINCT FROM 'false'::JSONB
      OR result->0 ? 'tasks' OR result->0 ? 'workers' THEN RAISE EXCEPTION 'projection color or privacy mismatch'; END IF;
  END LOOP;
  result:=public.gantt_session_read(viewer_token);
  IF result->'projects' IS DISTINCT FROM '[]'::JSONB OR result->'spaces' IS DISTINCT FROM '[]'::JSONB THEN RAISE EXCEPTION 'private project exposed'; END IF;
  result:=public.gantt_session_calendar_events(token,'2026-09-07','2026-09-08','gantt:'||project_id||':'||task_id);
  IF result IS DISTINCT FROM '[]'::JSONB THEN RAISE EXCEPTION 'date range ignored'; END IF;
  UPDATE public.calendars SET visibility='private' WHERE id=calendar_id;
  result:=public.gantt_session_calendar_events(viewer_token,NULL,NULL,'gantt:'||project_id||':'||task_id);
  IF result IS DISTINCT FROM '[]'::JSONB THEN RAISE EXCEPTION 'calendar access revocation ignored'; END IF;
END $smoke$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed;
