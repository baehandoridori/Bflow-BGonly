-- Gantt release regression smoke. Run this whole file as ONE SQL batch.
-- Every inserted user/calendar/Gantt row belongs to this random run and is rolled back.
-- Requires 20260905151837_gantt_release_acl.sql. Never continue after a SQL error.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE TEMP TABLE gantt_release_fixture(run_id TEXT,owner_id TEXT,worker_id TEXT) ON COMMIT DROP;
INSERT INTO gantt_release_fixture
SELECT run_id,'gantt-release-owner-'||run_id,'gantt-release-worker-'||run_id
FROM (SELECT gen_random_uuid()::TEXT AS run_id) fixture;
GRANT SELECT ON gantt_release_fixture TO anon;
INSERT INTO public.users(id,name,role,password)
SELECT owner_id,'__gantt_release_owner_'||run_id,'user','release-owner-pw' FROM gantt_release_fixture
UNION ALL
SELECT worker_id,'__gantt_release_worker_'||run_id,'user','release-worker-pw' FROM gantt_release_fixture;

SET LOCAL ROLE anon;
DO $smoke$
DECLARE
  fixture RECORD; login JSONB; owner_token TEXT; worker_token TEXT;
  calendar_id UUID:=gen_random_uuid(); space_id TEXT:=gen_random_uuid()::TEXT;
  project_id TEXT:=gen_random_uuid()::TEXT; second_project_id TEXT:=gen_random_uuid()::TEXT;
  task_id TEXT:=gen_random_uuid()::TEXT; space_doc JSONB; project_doc JSONB; task_doc JSONB;
  result JSONB; saved JSONB; current_doc JSONB; rejected BOOLEAN;
BEGIN
  IF current_user<>'anon' THEN RAISE EXCEPTION 'smoke must run as anon'; END IF;
  SELECT * INTO fixture FROM gantt_release_fixture;
  login:=public.app_login('__gantt_release_owner_'||fixture.run_id,'release-owner-pw');
  IF login->>'ok'<>'true' THEN RAISE EXCEPTION 'owner login failed'; END IF;
  owner_token:=login->>'token';
  login:=public.app_login('__gantt_release_worker_'||fixture.run_id,'release-worker-pw');
  IF login->>'ok'<>'true' THEN RAISE EXCEPTION 'worker login failed'; END IF;
  worker_token:=login->>'token';

  BEGIN PERFORM 1 FROM public.gantt_projects; RAISE EXCEPTION 'anon could read Gantt table';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_read(fixture.owner_id); RAISE EXCEPTION 'anon could invoke internal read';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.gantt_session_read(repeat('0',64)); RAISE EXCEPTION 'forged token accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege('anon','public.gantt_unlink_deleted_calendar()','EXECUTE')
     OR has_function_privilege('anon','public.gantt_before_user_delete()','EXECUTE') THEN
    RAISE EXCEPTION 'delete trigger exposed as RPC';
  END IF;

  INSERT INTO public.calendars(id,name,color,visibility,owner_id,is_personal)
  VALUES(calendar_id,'ROLLBACK ONLY '||fixture.run_id,'#6C5CE7','members',fixture.owner_id,false);
  INSERT INTO public.calendar_members(calendar_id,user_id,can_edit) VALUES(calendar_id,fixture.worker_id,true);
  space_doc:=jsonb_build_object('id',space_id,'ownerId',fixture.owner_id,'name','ROLLBACK ONLY',
    'shared',true,'revision',1,'members',jsonb_build_array(jsonb_build_object('userId',fixture.worker_id,'canEdit',true)));
  task_doc:=jsonb_build_object('id',task_id,'parentId',NULL,'kind','task','title','original','memo','',
    'startDate','2026-09-06','endDate','2026-09-06','allDay',true,'startTime','','endTime','',
    'mode','manual','predecessorId',NULL,'progress',0,'progressMode','manual','sceneLinks','[]'::JSONB,
    'workers','[]'::JSONB,'attendees','[]'::JSONB,'color',NULL,'calendarId',calendar_id::TEXT,
    'calendarEventId',NULL,'completed',false,'sortOrder',0);
  project_doc:=jsonb_build_object('id',project_id,'spaceId',space_id,'ownerId',fixture.worker_id,
    'name','ROLLBACK ONLY','memo','','color','#6C5CE7','completed',false,'revision',1,
    'memberIds',jsonb_build_array(fixture.worker_id),'editorIds',jsonb_build_array(fixture.worker_id),
    'linkedEpisode',NULL,'tasks',jsonb_build_array(task_doc));
  PERFORM public.gantt_session_execute(owner_token,fixture.run_id||':space',
    jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',NULL));
  PERFORM public.gantt_session_execute(worker_token,fixture.run_id||':project',
    jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',NULL));

  -- A child can arrive between the undo preflight and deleteSpace without a space revision change.
  rejected:=false;
  BEGIN
    PERFORM public.gantt_session_execute(owner_token,fixture.run_id||':undo-space-create',
      jsonb_build_object('type','deleteSpace','spaceId',space_id,'expectedRevision',1,'requireEmpty',true));
  EXCEPTION WHEN serialization_failure THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'folder undo deleted a concurrently-created project'; END IF;

  -- A kind change affects projection existence and needs calendar edit permission.
  UPDATE public.calendar_members SET can_edit=false WHERE user_id=fixture.worker_id;
  rejected:=false;
  BEGIN
    PERFORM public.gantt_session_execute(worker_token,fixture.run_id||':kind',
      jsonb_build_object('type','saveProject','expectedRevision',1,
        'project',jsonb_set(project_doc,'{tasks,0,kind}','"group"'::JSONB)));
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'calendar viewer removed projection through kind'; END IF;
  result:=public.gantt_session_calendar_events(owner_token,NULL,NULL,'gantt:'||project_id||':'||task_id);
  IF jsonb_array_length(result)<>1 THEN RAISE EXCEPTION 'denied kind edit changed projection'; END IF;

  -- Removing the project owner from the folder transfers the project in the same CAS.
  space_doc:=jsonb_set(space_doc,'{members}','[]'::JSONB);
  result:=public.gantt_session_execute(owner_token,fixture.run_id||':remove-worker',
    jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',1));
  SELECT p INTO saved FROM jsonb_array_elements(result->'projects') p WHERE p->>'id'=project_id;
  IF saved->>'ownerId' IS DISTINCT FROM fixture.owner_id OR saved->>'revision'<>'2'
     OR saved->'memberIds'<>'[]'::JSONB OR saved->'editorIds'<>'[]'::JSONB THEN
    RAISE EXCEPTION 'folder ACL cascade did not reconcile project';
  END IF;
  IF public.gantt_session_read(worker_token)<>jsonb_build_object('spaces','[]'::JSONB,'projects','[]'::JSONB) THEN
    RAISE EXCEPTION 'removed worker still has Gantt access';
  END IF;
  rejected:=false;
  BEGIN
    PERFORM public.gantt_session_execute(worker_token,fixture.run_id||':removed-write',
      jsonb_build_object('type','saveProject','project',saved,'expectedRevision',2));
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'removed worker could save'; END IF;
  result:=public.gantt_session_execute(owner_token,fixture.run_id||':owner-edit',
    jsonb_build_object('type','saveProject','project',jsonb_set(saved,'{name}','"owner can edit"'::JSONB),'expectedRevision',2));
  rejected:=false;
  BEGIN
    PERFORM public.gantt_session_execute(owner_token,fixture.run_id||':stale',
      jsonb_build_object('type','saveProject','project',saved,'expectedRevision',2));
  EXCEPTION WHEN serialization_failure THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'stale project revision accepted'; END IF;

  -- Parent DELETE remains available to anon while the trigger alone has private table access.
  DELETE FROM public.calendars c WHERE c.id=calendar_id;
  result:=public.gantt_session_read(owner_token);
  SELECT p INTO current_doc FROM jsonb_array_elements(result->'projects') p WHERE p->>'id'=project_id;
  IF current_doc->>'revision'<>'4' OR jsonb_array_length(current_doc->'tasks')<>1
     OR current_doc#>'{tasks,0,calendarId}'<>'null'::JSONB THEN
    RAISE EXCEPTION 'calendar deletion did not unlink task atomically';
  END IF;

  -- A deleted member's project transfers to the fixture folder owner, never a real admin.
  space_doc:=jsonb_set(space_doc,'{members}',jsonb_build_array(jsonb_build_object('userId',fixture.worker_id,'canEdit',true)));
  PERFORM public.gantt_session_execute(owner_token,fixture.run_id||':readd-worker',
    jsonb_build_object('type','saveSpace','space',space_doc,'expectedRevision',2));
  project_doc:=jsonb_set(project_doc,'{id}',to_jsonb(second_project_id));
  project_doc:=jsonb_set(project_doc,'{tasks,0,calendarId}','null'::JSONB);
  project_doc:=jsonb_set(project_doc,'{tasks,0,workers}',jsonb_build_array(fixture.worker_id));
  PERFORM public.gantt_session_execute(worker_token,fixture.run_id||':second-project',
    jsonb_build_object('type','saveProject','project',project_doc,'expectedRevision',NULL));
  DELETE FROM public.users u WHERE u.id=fixture.worker_id;
  result:=public.gantt_session_read(owner_token);
  SELECT p INTO current_doc FROM jsonb_array_elements(result->'projects') p WHERE p->>'id'=second_project_id;
  IF current_doc->>'ownerId' IS DISTINCT FROM fixture.owner_id OR current_doc->>'revision'<>'2'
     OR current_doc#>'{tasks,0,workers}'<>'[]'::JSONB THEN
    RAISE EXCEPTION 'user deletion did not reconcile project';
  END IF;
  BEGIN PERFORM public.gantt_session_read(worker_token); RAISE EXCEPTION 'deleted user token accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $smoke$;
RESET ROLE;
ROLLBACK;
SELECT true AS passed,'gantt release ACL / projection / delete triggers' AS check_name;
