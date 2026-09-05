-- B flow Gantt: post-migration smoke test; every write is rolled back.
-- Prerequisite: 2026-09-05-gantt-workspaces.sql has already been applied.
-- Execute this entire file as ONE SQL batch. For psql use: -v ON_ERROR_STOP=1.
-- Never continue to the final SELECT after an error. An aborted connection must
-- issue ROLLBACK before reuse. The success row is emitted only after the DO block
-- completed and ROLLBACK succeeded. This file does not deploy the migration.
-- Reads users.id/name only (name appears in the predicate); no password or Slack data.
-- Existing calendar rows/members/events are never written. A missing owner calendar
-- is replaced by a transaction-local scratch row, not a persistent test calendar.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';
SET LOCAL ROLE anon;

DO $gantt_smoke$
<<smoke>>
DECLARE
  owner_id TEXT;
  editor_id TEXT;
  viewer_id TEXT;
  owner_count INTEGER;
  other_ids TEXT[];
  calendar_id UUID;
  run_id TEXT := 'gantt-smoke-' || gen_random_uuid()::TEXT;
  space_id TEXT := gen_random_uuid()::TEXT;
  project_id TEXT := gen_random_uuid()::TEXT;
  group_id TEXT := gen_random_uuid()::TEXT;
  task_id TEXT := gen_random_uuid()::TEXT;
  timed_id TEXT := gen_random_uuid()::TEXT;
  milestone_id TEXT := gen_random_uuid()::TEXT;
  event_id TEXT;
  base_task JSONB;
  project_doc JSONB;
  space_doc JSONB;
  create_project_command JSONB;
  command_doc JSONB;
  result_doc JSONB;
  persisted JSONB;
  projection JSONB;
  received_message TEXT;
  rejected BOOLEAN;
  event_count_before BIGINT;
  day_text TEXT := CURRENT_DATE::TEXT;
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'Smoke test must run as anon';
  END IF;
  SELECT count(*), min(u.id) INTO owner_count, owner_id
    FROM public.users u WHERE u.name = '배한솔';
  IF owner_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one 배한솔 user is required; found %', owner_count;
  END IF;
  SELECT array_agg(candidate.id ORDER BY candidate.id) INTO other_ids
    FROM (SELECT u.id FROM public.users u WHERE u.id <> owner_id ORDER BY u.id LIMIT 2) candidate;
  IF COALESCE(cardinality(other_ids), 0) <> 2 THEN
    RAISE EXCEPTION 'Two other existing users are required for editor/viewer checks';
  END IF;
  editor_id := other_ids[1];
  viewer_id := other_ids[2];

  SELECT c.id INTO calendar_id FROM public.calendars c
    WHERE c.owner_id = smoke.owner_id ORDER BY c.created_at, c.id LIMIT 1;
  IF calendar_id IS NULL THEN
    INSERT INTO public.calendars(name, color, visibility, owner_id, is_personal)
      VALUES ('ROLLBACK ONLY ' || run_id, '#6C5CE7', 'private', owner_id, false)
      RETURNING id INTO calendar_id;
  END IF;
  -- Projection must not create or modify legacy calendar_events rows.
  SELECT count(*) INTO event_count_before FROM public.calendar_events;

  space_doc := jsonb_build_object(
    'id', space_id, 'ownerId', owner_id, 'name', 'ROLLBACK ONLY ' || run_id,
    'shared', true, 'revision', 1,
    'members', jsonb_build_array(
      jsonb_build_object('userId', editor_id, 'canEdit', true),
      jsonb_build_object('userId', viewer_id, 'canEdit', false)));
  PERFORM public.gantt_execute(owner_id, run_id || ':space-create',
    jsonb_build_object('type', 'saveSpace', 'space', space_doc, 'expectedRevision', NULL));

  base_task := jsonb_build_object(
    'id', task_id, 'parentId', group_id, 'kind', 'task', 'title', '롤백 검증 작업', 'memo', '공유 메모 검증',
    'startDate', day_text, 'endDate', day_text, 'allDay', true, 'startTime', '', 'endTime', '',
    'mode', 'manual', 'predecessorId', NULL, 'progress', 0, 'progressMode', 'manual', 'sceneLinks', '[]'::JSONB,
    'workers', jsonb_build_array(owner_id), 'attendees', jsonb_build_array(editor_id), 'color', NULL,
    'calendarId', calendar_id::TEXT, 'calendarEventId', NULL, 'completed', false, 'sortOrder', 1);
  project_doc := jsonb_build_object(
    'id', project_id, 'spaceId', space_id, 'ownerId', owner_id, 'name', '롤백 검증 프로젝트',
    'memo', '프로젝트 상세 메모', 'color', '#6C5CE7', 'completed', false, 'revision', 1,
    'memberIds', NULL, 'editorIds', NULL, 'linkedEpisode', NULL,
    'tasks', jsonb_build_array(
      base_task || jsonb_build_object('id', group_id, 'parentId', NULL, 'kind', 'group', 'title', '검증 그룹', 'calendarId', NULL, 'sortOrder', 0),
      base_task,
      base_task || jsonb_build_object('id', timed_id, 'title', '시간 일정', 'allDay', false, 'startTime', '10:00', 'endTime', '14:30', 'sortOrder', 2),
      base_task || jsonb_build_object('id', milestone_id, 'parentId', NULL, 'kind', 'milestone', 'title', '검증 마일스톤', 'calendarId', NULL, 'sortOrder', 3)));
  create_project_command := jsonb_build_object('type', 'saveProject', 'project', project_doc, 'expectedRevision', NULL);
  result_doc := public.gantt_execute(owner_id, run_id || ':project-create', create_project_command);
  SELECT value INTO persisted FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id;
  IF persisted IS DISTINCT FROM project_doc THEN RAISE EXCEPTION 'Initial project round-trip differs'; END IF;

  -- Identical request replay: one aggregate, one receipt, unchanged revision.
  result_doc := public.gantt_execute(owner_id, run_id || ':project-create', create_project_command);
  IF (SELECT count(*) FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id) <> 1
     OR (SELECT revision FROM public.gantt_projects WHERE id = project_id) <> 1
     OR (SELECT count(*) FROM public.gantt_requests r WHERE r.actor_id = owner_id AND r.request_id = run_id || ':project-create') <> 1 THEN
    RAISE EXCEPTION 'Identical replay duplicated aggregate, receipt, or revision';
  END IF;
  rejected := false;
  BEGIN
    PERFORM public.gantt_execute(owner_id, run_id || ':project-create',
      jsonb_set(create_project_command, '{project,name}', '"different request"'::JSONB));
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS received_message = MESSAGE_TEXT;
    IF received_message <> '같은 요청 ID에 다른 변경을 보낼 수 없습니다' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Reused request ID accepted a different command'; END IF;

  -- Both folder members can see this project; only the editor can save it.
  result_doc := public.gantt_read(editor_id);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id) THEN RAISE EXCEPTION 'Editor cannot read shared project'; END IF;
  result_doc := public.gantt_read(viewer_id);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id) THEN RAISE EXCEPTION 'Viewer cannot read shared project'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.gantt_execute(viewer_id, run_id || ':viewer-denied',
      jsonb_build_object('type', 'saveProject', 'project', project_doc, 'expectedRevision', 1));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS received_message = MESSAGE_TEXT;
    IF received_message <> '폴더 편집 권한이 필요합니다' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Viewer write was not rejected'; END IF;

  -- The editor changes only project metadata; no calendar rights are assumed or altered.
  command_doc := jsonb_build_object('type', 'saveProject', 'project',
    jsonb_set(project_doc, '{color}', '"#123456"'::JSONB), 'expectedRevision', 1);
  result_doc := public.gantt_execute(editor_id, run_id || ':editor-save', command_doc);
  SELECT value INTO persisted FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id;
  IF persisted->>'color' IS DISTINCT FROM '#123456' OR persisted->>'revision' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Editor save did not commit exactly revision 2'; END IF;

  rejected := false;
  BEGIN
    PERFORM public.gantt_execute(owner_id, run_id || ':stale-denied',
      jsonb_build_object('type', 'saveProject', 'project', project_doc, 'expectedRevision', 1));
  EXCEPTION WHEN SQLSTATE '40001' THEN
    GET STACKED DIAGNOSTICS received_message = MESSAGE_TEXT;
    IF received_message <> '다른 사용자가 프로젝트를 먼저 수정했습니다' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected OR (SELECT revision FROM public.gantt_projects WHERE id = project_id) <> 2 THEN RAISE EXCEPTION 'Stale CAS was accepted or changed the aggregate'; END IF;
  IF EXISTS (SELECT 1 FROM public.gantt_requests r WHERE r.request_id IN (run_id || ':viewer-denied', run_id || ':stale-denied')) THEN RAISE EXCEPTION 'Rejected writes left success receipts'; END IF;

  event_id := 'gantt:' || project_id || ':' || timed_id;
  projection := public.gantt_calendar_events(owner_id, CURRENT_DATE, CURRENT_DATE, event_id);
  IF jsonb_array_length(projection) <> 1 OR projection->0->>'start_time' IS DISTINCT FROM '10:00'
     OR projection->0->>'end_time' IS DISTINCT FROM '14:30' OR projection->0->>'all_day' IS DISTINCT FROM 'false'
     OR projection->0->>'gantt_can_edit' IS DISTINCT FROM 'true'
     OR projection->0->>'calendar_id' IS DISTINCT FROM calendar_id::TEXT THEN
    RAISE EXCEPTION 'Owner timed calendar projection failed';
  END IF;
  projection := public.gantt_calendar_events(owner_id, CURRENT_DATE, CURRENT_DATE, 'gantt:' || project_id || ':' || task_id);
  IF jsonb_array_length(projection) <> 1 OR projection->0->>'all_day' IS DISTINCT FROM 'true'
     OR projection->0->>'start_time' IS NOT NULL OR projection->0->>'end_time' IS NOT NULL THEN
    RAISE EXCEPTION 'All-day projection failed';
  END IF;
  IF public.gantt_calendar_events(owner_id, NULL, NULL, 'gantt:' || project_id || ':' || group_id) <> '[]'::JSONB THEN RAISE EXCEPTION 'Summary group leaked into calendar projection'; END IF;
  projection := public.gantt_calendar_events(viewer_id, NULL, NULL, event_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(projection) AS projected(value) WHERE value->>'gantt_can_edit' IS DISTINCT FROM 'false') THEN RAISE EXCEPTION 'Viewer gained calendar edit capability'; END IF;

  -- Complete the project and every task in one revision; leaf date/time data survives.
  project_doc := jsonb_set(persisted, '{completed}', 'true'::JSONB);
  SELECT jsonb_set(project_doc, '{tasks}', jsonb_agg(task || jsonb_build_object('completed', true, 'progress', 100, 'progressMode', 'manual') ORDER BY ord))
    INTO project_doc FROM jsonb_array_elements(project_doc->'tasks') WITH ORDINALITY AS task_row(task, ord);
  result_doc := public.gantt_execute(owner_id, run_id || ':complete',
    jsonb_build_object('type', 'saveProject', 'project', project_doc, 'expectedRevision', 2));
  SELECT value INTO persisted FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id;
  IF persisted->>'revision' IS DISTINCT FROM '3' OR persisted->>'completed' IS DISTINCT FROM 'true'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(persisted->'tasks') task WHERE task->>'completed' IS DISTINCT FROM 'true' OR task->>'progress' IS DISTINCT FROM '100') THEN
    RAISE EXCEPTION 'Atomic project completion failed';
  END IF;

  PERFORM public.gantt_execute(owner_id, run_id || ':delete',
    jsonb_build_object('type', 'deleteProject', 'projectId', project_id, 'expectedRevision', 3));
  IF EXISTS (SELECT 1 FROM public.gantt_projects WHERE id = project_id)
     OR public.gantt_calendar_events(owner_id, NULL, NULL, event_id) <> '[]'::JSONB THEN RAISE EXCEPTION 'Deleted project or projection remains'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.gantt_execute(owner_id, run_id || ':save-after-delete',
      jsonb_build_object('type', 'saveProject', 'project', persisted, 'expectedRevision', 3));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS received_message = MESSAGE_TEXT;
    IF received_message <> '프로젝트 생성 권한 또는 버전이 올바르지 않습니다' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Late save resurrected a deleted project'; END IF;
  result_doc := public.gantt_execute(owner_id, run_id || ':project-create', create_project_command);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result_doc->'projects') WHERE value->>'id' = project_id) THEN RAISE EXCEPTION 'Replay resurrected deleted project'; END IF;
  PERFORM public.gantt_execute(owner_id, run_id || ':space-delete',
    jsonb_build_object('type', 'deleteSpace', 'spaceId', space_id, 'expectedRevision', 1));
  IF EXISTS (SELECT 1 FROM public.gantt_spaces WHERE id = space_id) THEN RAISE EXCEPTION 'Scratch folder deletion failed'; END IF;
  IF (SELECT count(*) FROM public.calendar_events) <> event_count_before THEN RAISE EXCEPTION 'Projection changed calendar_events rows'; END IF;
  -- Request receipts and any scratch calendar are deliberately left in this
  -- transaction to prove that the following ROLLBACK, not manual cleanup, owns them.
END;
$gantt_smoke$;

ROLLBACK;

SELECT '2026-09-05-gantt-live-smoke'::TEXT AS verification_name,
       true AS passed,
       'All transactional changes rolled back'::TEXT AS result;
