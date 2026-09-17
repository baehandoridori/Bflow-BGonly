-- Calendar-owned Gantt views. Event data and sharing remain in their source tables.
-- Requires calendar-admin-overview-tags and Gantt session/revision/pair migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
CREATE TABLE IF NOT EXISTS public.gantt_calendar_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL UNIQUE REFERENCES public.calendars(id) ON DELETE CASCADE,
  space_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (space_id <> project_id)
);
ALTER TABLE public.gantt_calendar_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gantt_calendar_links FROM PUBLIC, anon, authenticated;

-- Also guards the old session API: an old client may not save a projected UUID or
-- forge response-only source metadata into a normal JSON aggregate.
CREATE OR REPLACE FUNCTION public.gantt_guard_calendar_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE payload JSONB; target_id TEXT;
BEGIN
  IF TG_OP='DELETE' THEN payload:=OLD.data;target_id:=OLD.id;
  ELSE payload:=NEW.data;target_id:=NEW.id; END IF;
  IF payload ? 'calendarLink' OR EXISTS (
    SELECT 1 FROM public.gantt_calendar_links l WHERE l.space_id::TEXT=target_id OR l.project_id::TEXT=target_id
      OR (TG_TABLE_NAME='gantt_projects' AND l.space_id::TEXT=payload->>'spaceId')
  ) OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'tasks')='array' THEN payload->'tasks' ELSE '[]'::JSONB END) t WHERE t ? 'sourceCalendarEventId') THEN
    RAISE EXCEPTION '연결된 캘린더는 원본 캘린더에서 수정해 주세요' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gantt_spaces_guard_calendar_projection ON public.gantt_spaces;
CREATE TRIGGER gantt_spaces_guard_calendar_projection BEFORE INSERT OR UPDATE OR DELETE ON public.gantt_spaces
FOR EACH ROW EXECUTE FUNCTION public.gantt_guard_calendar_projection();
DROP TRIGGER IF EXISTS gantt_projects_guard_calendar_projection ON public.gantt_projects;
CREATE TRIGGER gantt_projects_guard_calendar_projection BEFORE INSERT OR UPDATE OR DELETE ON public.gantt_projects
FOR EACH ROW EXECUTE FUNCTION public.gantt_guard_calendar_projection();

-- A new wrapper leaves old clients on the normal aggregate-only snapshot.
CREATE OR REPLACE FUNCTION public.gantt_session_read_v2(p_session_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); ordinary JSONB; derived JSONB;
BEGIN
  ordinary:=public.gantt_read(actor);
  WITH access AS (
    SELECT c.*,l.id link_id,l.space_id,l.project_id,l.created_by,
      (c.owner_id=actor OR c.visibility='team' OR EXISTS(SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id AND m.user_id=actor)) regular_access,
      (c.owner_id=actor OR EXISTS(SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id AND m.user_id=actor AND m.can_edit)) can_edit,
      EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor AND u.role='admin') is_admin,
      EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor AND u.id='fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND u.role='admin') overview
    FROM public.gantt_calendar_links l JOIN public.calendars c ON c.id=l.calendar_id
  ), visible AS (
    SELECT a.*,jsonb_build_object('calendarId',id,'linkId',link_id,'actorId',actor,'visibility',visibility,'canEdit',can_edit,
      'canUnlink',owner_id=actor OR coalesce(created_by=actor,false) OR (is_admin AND NOT is_personal),
      'isAdminOverview',NOT regular_access AND overview) link
    FROM access a WHERE regular_access OR overview
  ), projected AS (
    SELECT v.*,coalesce((SELECT jsonb_agg(jsonb_build_object('userId',m.user_id,'canEdit',m.can_edit) ORDER BY m.user_id)
      FROM public.calendar_members m WHERE m.calendar_id=v.id),'[]'::JSONB) members,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',e.id,'sourceCalendarEventId',e.id,'parentId',NULL,'kind','task','title',e.title,'memo',coalesce(e.memo,''),
        'startDate',e.start_date,'endDate',e.end_date,'allDay',e.all_day,
        'startTime',CASE WHEN e.all_day THEN '' ELSE coalesce(left(e.start_time,5),'') END,
        'endTime',CASE WHEN e.all_day THEN '' ELSE coalesce(left(e.end_time,5),'') END,
        'mode','manual','predecessorId',NULL,'progress',0,'progressMode','manual','sceneLinks','[]'::JSONB,
        'workers','[]'::JSONB,'attendees','[]'::JSONB,'color',tag.color,'calendarId',NULL,'calendarEventId',NULL,
        'completed',false,'sortOrder',e.ordinal-1) ORDER BY e.start_date,e.id)
        FROM (SELECT ce.*,row_number() OVER(ORDER BY ce.start_date,ce.id) ordinal FROM public.calendar_events ce WHERE ce.calendar_id=v.id) e
        LEFT JOIN public.calendar_tags tag ON tag.id=coalesce(e.tag_ids[1],e.tag_id)),'[]'::JSONB) tasks
    FROM visible v
  ) SELECT jsonb_build_object(
    'spaces',coalesce(jsonb_agg(jsonb_build_object('id',space_id,'name',name,'ownerId',owner_id,'shared',visibility<>'private','members',members,'revision',1,'calendarLink',link) ORDER BY created_at,id),'[]'::JSONB),
    'projects',coalesce(jsonb_agg(jsonb_build_object('id',project_id,'spaceId',space_id,'ownerId',owner_id,'name',name,'memo','','color',color,'completed',false,'revision',1,
      'memberIds',NULL,'editorIds',NULL,'linkedEpisode',NULL,'tasks',tasks,'calendarLink',link) ORDER BY created_at,id),'[]'::JSONB)
  ) INTO derived FROM projected;
  RETURN jsonb_build_object('spaces',(ordinary->'spaces')||(derived->'spaces'),'projects',(ordinary->'projects')||(derived->'projects'));
END $$;

CREATE OR REPLACE FUNCTION public.gantt_session_execute_v2(p_session_token TEXT,p_request_id TEXT,p_command JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); kind TEXT:=p_command->>'type'; source public.calendars%ROWTYPE;
  binding public.gantt_calendar_links%ROWTYPE; receipt JSONB; source_id UUID; is_admin BOOLEAN; can_view BOOLEAN;
BEGIN
  IF kind IS NULL OR kind NOT IN ('linkCalendar','unlinkCalendar') THEN
    PERFORM public.gantt_execute(actor,p_request_id,p_command);
    RETURN public.gantt_session_read_v2(p_session_token);
  END IF;
  IF coalesce(btrim(p_request_id),'')='' OR length(p_request_id)>128 OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR coalesce(p_command->>'calendarId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR (kind='linkCalendar' AND p_command-ARRAY['type','calendarId'] <> '{}'::JSONB)
    OR (kind='unlinkCalendar' AND (p_command-ARRAY['type','calendarId','linkId'] <> '{}'::JSONB OR coalesce(p_command->>'linkId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
    RAISE EXCEPTION '캘린더 연결 요청이 올바르지 않습니다' USING ERRCODE='22023';
  END IF;
  source_id:=(p_command->>'calendarId')::UUID;
  -- Same lock order as ordinary Gantt writes; source membership cannot change between
  -- checking access and committing the binding. No event or member copies are written.
  LOCK TABLE public.calendars IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.calendar_members IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_spaces IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_projects IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_calendar_links IN SHARE ROW EXCLUSIVE MODE;
  SELECT command INTO receipt FROM public.gantt_requests WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF receipt IS DISTINCT FROM p_command THEN RAISE EXCEPTION '같은 요청 ID에 다른 변경을 보낼 수 없습니다' USING ERRCODE='22023'; END IF;
    RETURN public.gantt_session_read_v2(p_session_token);
  END IF;
  SELECT role='admin' INTO is_admin FROM public.users WHERE id=actor FOR SHARE;
  SELECT * INTO source FROM public.calendars WHERE id=source_id;
  IF NOT FOUND THEN RAISE EXCEPTION '캘린더를 찾을 수 없거나 접근 권한이 변경되었습니다' USING ERRCODE='42501'; END IF;
  can_view:=source.owner_id=actor OR source.visibility='team' OR EXISTS(SELECT 1 FROM public.calendar_members WHERE calendar_id=source_id AND user_id=actor)
    OR (actor='fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND is_admin);
  IF NOT can_view THEN RAISE EXCEPTION '캘린더 조회 권한이 없습니다' USING ERRCODE='42501'; END IF;
  SELECT * INTO binding FROM public.gantt_calendar_links WHERE calendar_id=source_id;
  IF kind='linkCalendar' THEN
    IF binding.id IS NULL THEN
      INSERT INTO public.gantt_calendar_links(calendar_id,created_by) VALUES(source_id,actor) RETURNING * INTO binding;
      IF EXISTS(SELECT 1 FROM public.gantt_spaces WHERE id IN(binding.space_id::TEXT,binding.project_id::TEXT))
        OR EXISTS(SELECT 1 FROM public.gantt_projects WHERE id IN(binding.space_id::TEXT,binding.project_id::TEXT)) THEN
        RAISE EXCEPTION '연결 식별자가 충돌했습니다. 다시 시도해 주세요' USING ERRCODE='40001';
      END IF;
    END IF;
  ELSE
    IF binding.id IS NULL OR binding.id::TEXT<>p_command->>'linkId' THEN RAISE EXCEPTION '캘린더 연결이 변경되었습니다. 새로고침해 주세요' USING ERRCODE='40001'; END IF;
    IF NOT(source.owner_id=actor OR coalesce(binding.created_by=actor,false) OR (is_admin AND NOT source.is_personal)) THEN
      RAISE EXCEPTION '캘린더 연결 해제 권한이 없습니다' USING ERRCODE='42501';
    END IF;
    DELETE FROM public.gantt_calendar_links WHERE id=binding.id;
  END IF;
  INSERT INTO public.gantt_requests(actor_id,request_id,command) VALUES(actor,p_request_id,p_command);
  RETURN public.gantt_session_read_v2(p_session_token);
END $$;

-- Empty invalidations only. Subscription never transports private source rows.
CREATE OR REPLACE FUNCTION public.gantt_calendar_link_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='gantt_calendar_links' OR EXISTS(SELECT 1 FROM public.gantt_calendar_links) THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('table',TG_TABLE_NAME,'op',TG_OP),'gantt-changed','bflow-realtime',false);
    EXCEPTION WHEN OTHERS THEN RAISE WARNING '[gantt] linked calendar invalidation failed: %',SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE name TEXT; BEGIN
  FOREACH name IN ARRAY ARRAY['gantt_calendar_links','calendars','calendar_members','calendar_events','calendar_tags','users'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS gantt_calendar_link_changed ON public.%I',name);
    EXECUTE format('CREATE TRIGGER gantt_calendar_link_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.gantt_calendar_link_notify()',name);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.gantt_guard_calendar_projection(),public.gantt_calendar_link_notify(),
  public.gantt_session_read_v2(TEXT),public.gantt_session_execute_v2(TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gantt_session_read_v2(TEXT),public.gantt_session_execute_v2(TEXT,TEXT,JSONB) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
