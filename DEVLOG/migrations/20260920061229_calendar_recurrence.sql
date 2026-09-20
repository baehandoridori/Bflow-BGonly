-- Native recurring events remain one canonical master with sparse exceptions.
-- Session authentication and source calendar permissions are authoritative.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.calendar_events
 ADD COLUMN IF NOT EXISTS recurrence_rule JSONB,
 ADD COLUMN IF NOT EXISTS recurrence_revision BIGINT NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS location TEXT,
 ADD COLUMN IF NOT EXISTS meeting_url TEXT,
 ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER;
CREATE TABLE IF NOT EXISTS public.calendar_event_exceptions (
 series_id UUID NOT NULL REFERENCES public.calendar_events(id) ON DELETE CASCADE,
 occurrence_date DATE NOT NULL,
 cancelled BOOLEAN NOT NULL DEFAULT false,
 patch JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(patch)='object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(series_id,occurrence_date)
);
ALTER TABLE public.calendar_event_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_event_exceptions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.calendar_validate_recurrence(rule JSONB,anchor DATE) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE key TEXT; value JSONB;
BEGIN
 IF rule IS NULL OR rule='null'::JSONB THEN RETURN NULL; END IF;
 IF jsonb_typeof(rule)<>'object' OR rule-ARRAY['frequency','interval','weekdays','monthlyMode','monthDay','ordinal','weekday','until','count']<>'{}'::JSONB
   OR coalesce(rule->>'frequency','') NOT IN ('daily','weekly','monthly','yearly')
   OR jsonb_typeof(rule->'interval') IS DISTINCT FROM 'number' OR (rule->>'interval')!~'^[0-9]+$'
   OR (rule->>'interval')::NUMERIC NOT BETWEEN 1 AND 99 THEN
  RAISE EXCEPTION 'Invalid recurrence rule' USING ERRCODE='22023';
 END IF;
 FOREACH key IN ARRAY ARRAY['monthDay','ordinal','weekday','count'] LOOP
  IF rule ? key THEN
   value:=rule->key;
   IF jsonb_typeof(value)<>'number' OR value::TEXT !~ '^-?[0-9]+$' OR NOT (
    (key='monthDay' AND value::TEXT::NUMERIC BETWEEN 1 AND 31) OR
    (key='ordinal' AND (value::TEXT::NUMERIC BETWEEN 1 AND 5 OR value::TEXT::NUMERIC=-1)) OR
    (key='weekday' AND value::TEXT::NUMERIC BETWEEN 0 AND 6) OR
    (key='count' AND value::TEXT::NUMERIC BETWEEN 1 AND 1000)) THEN
    RAISE EXCEPTION 'Invalid recurrence number' USING ERRCODE='22023';
   END IF;
  END IF;
 END LOOP;
 IF rule ? 'weekdays' THEN
  IF jsonb_typeof(rule->'weekdays')<>'array' OR jsonb_array_length(rule->'weekdays')=0 THEN RAISE EXCEPTION 'Invalid recurrence weekdays' USING ERRCODE='22023'; END IF;
  FOR value IN SELECT * FROM jsonb_array_elements(rule->'weekdays') LOOP
   IF jsonb_typeof(value)<>'number' OR value::TEXT !~ '^[0-6]$' THEN RAISE EXCEPTION 'Invalid recurrence weekday' USING ERRCODE='22023'; END IF;
  END LOOP;
  SELECT jsonb_set(rule,'{weekdays}',jsonb_agg(weekday_number ORDER BY weekday_number)) INTO rule FROM (SELECT DISTINCT item::TEXT::INTEGER weekday_number FROM jsonb_array_elements(rule->'weekdays') items(item)) days;
 END IF;
 IF (rule ? 'monthlyMode' AND coalesce(rule->>'monthlyMode','') NOT IN ('date','weekday','lastDay'))
   OR (rule->>'monthlyMode'='weekday' AND NOT (rule ? 'ordinal' AND rule ? 'weekday')) THEN
  RAISE EXCEPTION 'Invalid monthly recurrence mode' USING ERRCODE='22023';
 END IF;
 IF rule ? 'until' THEN
  IF jsonb_typeof(rule->'until')<>'string' OR (rule->>'until') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR (rule->>'until')::DATE<anchor OR rule ? 'count' THEN RAISE EXCEPTION 'Invalid recurrence end' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN rule;
END $$;

-- Returns the 1-based original occurrence index, or 0 if it is not in the rule.
-- Missing month dates are skipped and never consume COUNT. Weeks start Monday.
CREATE OR REPLACE FUNCTION public.calendar_recurrence_index(anchor DATE,rule JSONB,target DATE) RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE every INTEGER:=(rule->>'interval')::INTEGER; frequency TEXT:=rule->>'frequency'; candidate DATE; first_day DATE;
 last_day DATE; month_index INTEGER; end_index INTEGER; day_number INTEGER; total INTEGER:=0; week_start DATE; offset_day INTEGER; weekday INTEGER;
BEGIN
 IF rule IS NULL OR target IS NULL OR target<anchor OR (rule ? 'until' AND target>(rule->>'until')::DATE) THEN RETURN 0; END IF;
 IF frequency='daily' THEN
  IF (target-anchor)%every<>0 THEN RETURN 0; END IF;
  total:=(target-anchor)/every+1;
  RETURN CASE WHEN rule ? 'count' AND total>(rule->>'count')::INTEGER THEN 0 ELSE total END;
 END IF;
 IF frequency='weekly' THEN
  week_start:=anchor-((extract(dow FROM anchor)::INTEGER+6)%7);
  -- At most seven selected days per active week; COUNT stops work early.
  WHILE week_start<=target LOOP
   FOR offset_day IN 0..6 LOOP
    candidate:=week_start+offset_day;weekday:=(offset_day+1)%7;
    IF candidate>=anchor AND candidate<=target AND (
      (rule ? 'weekdays' AND rule->'weekdays' @> to_jsonb(ARRAY[weekday])) OR
      (NOT rule ? 'weekdays' AND weekday=extract(dow FROM anchor)::INTEGER)) THEN
     total:=total+1;
     IF rule ? 'count' AND total>(rule->>'count')::INTEGER THEN RETURN 0; END IF;
     IF candidate=target THEN RETURN total; END IF;
    END IF;
   END LOOP;
   week_start:=week_start+every*7;
  END LOOP;
 ELSE
  month_index:=extract(year FROM anchor)::INTEGER*12+extract(month FROM anchor)::INTEGER-1;
  end_index:=extract(year FROM target)::INTEGER*12+extract(month FROM target)::INTEGER-1;
  WHILE month_index<=end_index LOOP
   first_day:=make_date(month_index/12,month_index%12+1,1);
   last_day:=(first_day+interval '1 month'-interval '1 day')::DATE;
   day_number:=coalesce((rule->>'monthDay')::INTEGER,extract(day FROM anchor)::INTEGER);
   IF rule->>'monthlyMode'='lastDay' THEN day_number:=extract(day FROM last_day)::INTEGER;
   ELSIF rule->>'monthlyMode'='weekday' THEN
    IF (rule->>'ordinal')::INTEGER=-1 THEN day_number:=extract(day FROM last_day)::INTEGER-((extract(dow FROM last_day)::INTEGER-(rule->>'weekday')::INTEGER+7)%7);
    ELSE day_number:=1+(((rule->>'weekday')::INTEGER-extract(dow FROM first_day)::INTEGER+7)%7)+((rule->>'ordinal')::INTEGER-1)*7; END IF;
   END IF;
   IF day_number<=extract(day FROM last_day)::INTEGER THEN
    candidate:=first_day+day_number-1;
    IF candidate>=anchor AND candidate<=target THEN
     total:=total+1;
     IF rule ? 'count' AND total>(rule->>'count')::INTEGER THEN RETURN 0; END IF;
     IF candidate=target THEN RETURN total; END IF;
    END IF;
   END IF;
   month_index:=month_index+every*CASE WHEN frequency='yearly' THEN 12 ELSE 1 END;
  END LOOP;
 END IF;
 RETURN 0;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_recurrence_document(event_id UUID) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path=public,pg_temp AS $$
 SELECT to_jsonb(e)||jsonb_build_object('recurrence_exceptions',coalesce((SELECT jsonb_agg(
  jsonb_build_object('occurrence_date',x.occurrence_date,'cancelled',x.cancelled,'patch',x.patch) ORDER BY x.occurrence_date)
  FROM public.calendar_event_exceptions x WHERE x.series_id=e.id),'[]'::JSONB)) FROM public.calendar_events e WHERE e.id=event_id
$$;
CREATE OR REPLACE FUNCTION public.calendar_session_recurrence_events(p_session_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token);
BEGIN
 RETURN (SELECT coalesce(jsonb_agg(public.calendar_recurrence_document(e.id) ORDER BY e.start_date,e.id),'[]'::JSONB)
 FROM public.calendar_events e JOIN public.calendars c ON c.id=e.calendar_id
 WHERE c.owner_id=actor OR c.visibility='team' OR EXISTS(SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id AND m.user_id=actor)
 OR EXISTS(SELECT 1 FROM public.users u WHERE u.id=actor AND u.id='fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND u.role='admin'));
END $$;

-- Validate a complete candidate; callers construct it from canonical data plus an allowlisted patch.
CREATE OR REPLACE FUNCTION public.calendar_validate_recurrence_event(candidate public.calendar_events) RETURNS public.calendar_events
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE tag UUID;
BEGIN
 IF candidate.calendar_id IS NULL OR candidate.title IS NULL OR btrim(candidate.title)='' OR candidate.all_day IS NULL
   OR candidate.start_date IS NULL OR candidate.end_date IS NULL OR candidate.end_date<candidate.start_date
   OR candidate.start_date<DATE '0001-01-01' OR candidate.end_date>DATE '9999-12-31'
   OR (NOT candidate.all_day AND (coalesce(candidate.start_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR coalesce(candidate.end_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR (candidate.start_date=candidate.end_date AND candidate.end_time<candidate.start_time)))
   OR (coalesce(candidate.meeting_url,'')<>'' AND candidate.meeting_url !~* '^https?://[^[:space:]/?#]+[^[:space:]]*$')
   OR (candidate.reminder_minutes IS NOT NULL AND candidate.reminder_minutes NOT BETWEEN 0 AND 10080)
   OR candidate.tag_ids IS NULL OR array_position(candidate.tag_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid calendar event fields' USING ERRCODE='22023';
 END IF;
 candidate.recurrence_rule:=public.calendar_validate_recurrence(candidate.recurrence_rule,candidate.start_date);
 FOREACH tag IN ARRAY candidate.tag_ids LOOP
  PERFORM 1 FROM public.calendar_tags WHERE id=tag FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown calendar tag' USING ERRCODE='23503'; END IF;
 END LOOP;
 candidate.tag_id:=candidate.tag_ids[1];
 RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_session_recurrence_execute(
 p_session_token TEXT,p_action TEXT,p_event_id UUID,p_occurrence_date DATE,p_scope TEXT,p_expected_revision BIGINT,p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); existing public.calendar_events%ROWTYPE; candidate public.calendar_events%ROWTYPE;
 source_id UUID; target_id UUID; patch JSONB; merged JSONB; exception_patch JSONB; selected_index INTEGER; split_id UUID; structural BOOLEAN; scope TEXT:=p_scope;
 allowed CONSTANT TEXT[]:=ARRAY['expected_calendar_id','calendar_id','title','memo','tag_id','tag_ids','all_day','start_date','end_date','start_time','end_time',
 'linked_episode','linked_part','linked_sheet_name','linked_scene_id','linked_department','linked_todo_id','recurrence_rule','location','meeting_url','reminder_minutes'];
 field TEXT; value JSONB; retained RECORD;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('create','update','delete') OR scope IS NULL OR scope NOT IN ('this','following','all')
   OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch-allowed<>'{}'::JSONB OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
  RAISE EXCEPTION 'Invalid recurrence command' USING ERRCODE='22023';
 END IF;
 patch:=p_patch-'expected_calendar_id';
 -- JSON casts must not silently turn numbers/objects into text or fractional reminders into integers.
 FOR field,value IN SELECT * FROM jsonb_each(patch) LOOP
  IF (field=ANY(ARRAY['title','memo','start_date','end_date','start_time','end_time','location','meeting_url','calendar_id','tag_id','linked_part','linked_sheet_name','linked_scene_id','linked_department','linked_todo_id']) AND jsonb_typeof(value) NOT IN ('string','null'))
   OR (field='all_day' AND jsonb_typeof(value)<>'boolean')
   OR (field=ANY(ARRAY['reminder_minutes','linked_episode']) AND value<>'null'::JSONB AND (jsonb_typeof(value)<>'number' OR value::TEXT !~ '^-?[0-9]+$'))
   OR (field='tag_ids' AND jsonb_typeof(value)<>'array')
   OR (field=ANY(ARRAY['start_date','end_date']) AND (value#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
   RAISE EXCEPTION 'Invalid calendar field type' USING ERRCODE='22023';
  END IF;
 END LOOP;
 IF p_action='create' THEN
  IF scope<>'all' OR p_event_id IS NOT NULL OR p_occurrence_date IS NOT NULL OR p_expected_revision<>0 THEN RAISE EXCEPTION 'Invalid create command' USING ERRCODE='22023'; END IF;
  source_id:=(patch->>'calendar_id')::UUID;target_id:=source_id;
 ELSE
  source_id:=(p_patch->>'expected_calendar_id')::UUID;
  IF source_id IS NULL OR p_event_id IS NULL THEN RAISE EXCEPTION 'Expected source calendar is required' USING ERRCODE='22023'; END IF;
  target_id:=CASE WHEN patch ? 'calendar_id' THEN (patch->>'calendar_id')::UUID ELSE source_id END;
 END IF;
 -- Catalog deletion rewrites exception tags and master revisions. Acquire its read lock
 -- first so it cannot delete an override tag between validation and insertion.
 LOCK TABLE public.calendar_tags IN SHARE MODE;
 -- Match parent-before-child order of existing calendar commands. Membership is locked
 -- as well, so a concurrent revoke cannot pass between authorization and the write.
 LOCK TABLE public.calendars IN ROW EXCLUSIVE MODE;
 LOCK TABLE public.calendar_members IN SHARE MODE;
 LOCK TABLE public.calendar_events IN ROW EXCLUSIVE MODE;
 PERFORM id FROM public.calendars WHERE id=ANY(ARRAY[source_id,target_id]) ORDER BY id FOR UPDATE;
 IF p_action<>'create' THEN
  SELECT * INTO existing FROM public.calendar_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR existing.calendar_id<>source_id OR existing.recurrence_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'Calendar event changed; refresh and retry' USING ERRCODE='40001';
  END IF;
 END IF;
 IF source_id IS NULL OR target_id IS NULL OR EXISTS(SELECT 1 FROM unnest(ARRAY[source_id,target_id]) ids(id)
 WHERE NOT EXISTS(SELECT 1 FROM public.calendars c WHERE c.id=ids.id AND (c.owner_id=actor OR EXISTS(
  SELECT 1 FROM public.calendar_members m WHERE m.calendar_id=c.id AND m.user_id=actor AND m.can_edit)))) THEN
  RAISE EXCEPTION 'Calendar event edit permission denied' USING ERRCODE='42501';
 END IF;
 IF scope<>'all' THEN
  selected_index:=public.calendar_recurrence_index(existing.start_date,existing.recurrence_rule,p_occurrence_date);
  IF selected_index=0 THEN RAISE EXCEPTION 'Date is not an occurrence of this series' USING ERRCODE='22023'; END IF;
  IF scope='this' AND patch-ARRAY['title','memo','tag_id','tag_ids','all_day','start_date','end_date','start_time','end_time','location','meeting_url','reminder_minutes']<>'{}'::JSONB THEN
   RAISE EXCEPTION 'A single occurrence cannot change its series or calendar' USING ERRCODE='22023';
  END IF;
  IF scope='following' AND selected_index=1 THEN scope:='all'; END IF;
 END IF;
 IF p_action='delete' AND patch<>'{}'::JSONB THEN RAISE EXCEPTION 'Delete does not accept event changes' USING ERRCODE='22023'; END IF;
 IF p_action='delete' AND scope='all' THEN
  DELETE FROM public.calendar_events WHERE id=p_event_id;
  RETURN jsonb_build_object('event',NULL,'split_event',NULL,'deleted',true);
 END IF;
 IF p_action='create' THEN
  merged:=jsonb_build_object('id',gen_random_uuid(),'memo','','all_day',true,'tag_ids','[]'::JSONB,'created_by',actor,'created_at',now(),'updated_at',now(),'recurrence_revision',0)||patch;
 ELSE
  merged:=to_jsonb(existing);
  IF scope IN ('this','following') THEN
   merged:=merged||jsonb_build_object('start_date',p_occurrence_date,'end_date',p_occurrence_date+(existing.end_date-existing.start_date));
  END IF;
  IF scope='this' THEN
   SELECT x.patch INTO exception_patch FROM public.calendar_event_exceptions x WHERE x.series_id=existing.id AND x.occurrence_date=p_occurrence_date;
   merged:=merged||coalesce(exception_patch,'{}'::JSONB);
  END IF;
  merged:=merged||patch;
 END IF;
 IF patch ? 'tag_ids' THEN merged:=merged||jsonb_build_object('tag_id',patch->'tag_ids'->0);
 ELSIF patch ? 'tag_id' THEN merged:=merged||jsonb_build_object('tag_ids',CASE WHEN patch->'tag_id'='null'::JSONB THEN '[]'::JSONB ELSE jsonb_build_array(patch->'tag_id') END); END IF;
 -- The full rule belongs to the master, not the date-shifted exception candidate.
 IF scope='this' THEN merged:=merged||jsonb_build_object('recurrence_rule',NULL); END IF;
 candidate:=public.calendar_validate_recurrence_event(jsonb_populate_record(NULL::public.calendar_events,merged));
 IF scope='this' THEN
  exception_patch:=coalesce(exception_patch,'{}'::JSONB)||patch;
  IF patch ? 'tag_ids' OR patch ? 'tag_id' THEN exception_patch:=exception_patch||jsonb_build_object('tag_ids',candidate.tag_ids,'tag_id',candidate.tag_id); END IF;
  INSERT INTO public.calendar_event_exceptions(series_id,occurrence_date,cancelled,patch)
   VALUES(existing.id,p_occurrence_date,p_action='delete',CASE WHEN p_action='delete' THEN '{}'::JSONB ELSE exception_patch END)
   ON CONFLICT(series_id,occurrence_date) DO UPDATE SET cancelled=excluded.cancelled,patch=excluded.patch,updated_at=now();
  UPDATE public.calendar_events SET recurrence_revision=recurrence_revision+1,updated_at=now() WHERE id=existing.id;
  RETURN jsonb_build_object('event',public.calendar_recurrence_document(existing.id),'split_event',NULL,'deleted',false);
 END IF;
 IF scope='following' THEN
  -- Truncate using UNTIL alone, since the shared rule contract excludes COUNT+UNTIL.
  UPDATE public.calendar_events SET recurrence_rule=(existing.recurrence_rule-'count')||jsonb_build_object('until',p_occurrence_date-1),recurrence_revision=recurrence_revision+1,updated_at=now() WHERE id=existing.id;
  IF p_action='delete' THEN
   DELETE FROM public.calendar_event_exceptions WHERE series_id=existing.id AND occurrence_date>=p_occurrence_date;
   RETURN jsonb_build_object('event',public.calendar_recurrence_document(existing.id),'split_event',NULL,'deleted',false);
  END IF;
  candidate.id:=gen_random_uuid();candidate.created_by:=actor;candidate.created_at:=now();candidate.updated_at:=now();candidate.recurrence_revision:=0;
  IF (NOT patch ? 'recurrence_rule' OR candidate.recurrence_rule=existing.recurrence_rule) AND existing.recurrence_rule ? 'count' THEN
   candidate.recurrence_rule:=candidate.recurrence_rule||jsonb_build_object('count',(existing.recurrence_rule->>'count')::INTEGER-selected_index+1);
  END IF;
  INSERT INTO public.calendar_events SELECT (candidate).*;
  structural:=(candidate.recurrence_rule-ARRAY['until','count']) IS DISTINCT FROM (existing.recurrence_rule-ARRAY['until','count']) OR candidate.start_date<>p_occurrence_date;
  IF NOT structural THEN
   FOR retained IN SELECT x.occurrence_date,x.patch FROM public.calendar_event_exceptions x WHERE x.series_id=existing.id AND NOT x.cancelled
    AND x.occurrence_date>=p_occurrence_date AND public.calendar_recurrence_index(candidate.start_date,candidate.recurrence_rule,x.occurrence_date)>0 LOOP
    PERFORM public.calendar_validate_recurrence_event(jsonb_populate_record(NULL::public.calendar_events,
     to_jsonb(candidate)||jsonb_build_object('recurrence_rule',NULL,'start_date',retained.occurrence_date,
      'end_date',retained.occurrence_date+(candidate.end_date-candidate.start_date))||retained.patch));
   END LOOP;
   UPDATE public.calendar_event_exceptions SET series_id=candidate.id WHERE series_id=existing.id AND occurrence_date>=p_occurrence_date
    AND public.calendar_recurrence_index(candidate.start_date,candidate.recurrence_rule,occurrence_date)>0;
  END IF;
  DELETE FROM public.calendar_event_exceptions WHERE series_id=existing.id AND occurrence_date>=p_occurrence_date;
  RETURN jsonb_build_object('event',public.calendar_recurrence_document(existing.id),'split_event',public.calendar_recurrence_document(candidate.id),'deleted',false);
 END IF;
 IF p_action='create' THEN INSERT INTO public.calendar_events SELECT (candidate).*;
 ELSE
  structural:=candidate.recurrence_rule IS DISTINCT FROM existing.recurrence_rule OR candidate.start_date<>existing.start_date;
  IF structural THEN DELETE FROM public.calendar_event_exceptions WHERE series_id=existing.id;
  ELSE
   FOR retained IN SELECT x.occurrence_date,x.patch FROM public.calendar_event_exceptions x WHERE x.series_id=existing.id AND NOT x.cancelled LOOP
    PERFORM public.calendar_validate_recurrence_event(jsonb_populate_record(NULL::public.calendar_events,
     to_jsonb(candidate)||jsonb_build_object('recurrence_rule',NULL,'start_date',retained.occurrence_date,
      'end_date',retained.occurrence_date+(candidate.end_date-candidate.start_date))||retained.patch));
   END LOOP;
  END IF;
  UPDATE public.calendar_events SET calendar_id=candidate.calendar_id,title=candidate.title,memo=candidate.memo,tag_id=candidate.tag_id,tag_ids=candidate.tag_ids,
   all_day=candidate.all_day,start_date=candidate.start_date,end_date=candidate.end_date,start_time=candidate.start_time,end_time=candidate.end_time,
   linked_episode=candidate.linked_episode,linked_part=candidate.linked_part,linked_sheet_name=candidate.linked_sheet_name,linked_scene_id=candidate.linked_scene_id,
   linked_department=candidate.linked_department,linked_todo_id=candidate.linked_todo_id,recurrence_rule=candidate.recurrence_rule,
   location=candidate.location,meeting_url=candidate.meeting_url,reminder_minutes=candidate.reminder_minutes,recurrence_revision=existing.recurrence_revision+1,updated_at=now()
   WHERE id=existing.id;
 END IF;
 RETURN jsonb_build_object('event',public.calendar_recurrence_document(candidate.id),'split_event',NULL,'deleted',false);
END $$;

-- Preserve existing legacy ACL and return signatures, with a recurring-master guard.
CREATE OR REPLACE FUNCTION public.update_calendar_event_authorized(
  p_actor_id TEXT,
  p_event_id UUID,
  p_expected_calendar_id UUID,
  p_updates JSONB
)
RETURNS SETOF calendar_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_keys CONSTANT TEXT[] := ARRAY[
    'calendar_id', 'title', 'memo', 'tag_id', 'all_day', 'start_date', 'end_date',
    'start_time', 'end_time', 'linked_episode', 'linked_part', 'linked_sheet_name',
    'linked_scene_id', 'linked_department', 'linked_todo_id'
  ];
  v_target_calendar_id UUID;
  v_source calendars%ROWTYPE;
  v_target calendars%ROWTYPE;
  v_existing calendar_events%ROWTYPE;
  v_updated calendar_events%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'p_updates must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_updates) AS submitted(key)
    WHERE NOT (submitted.key = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'p_updates contains an unknown or immutable field' USING ERRCODE = '22023';
  END IF;

  IF p_expected_calendar_id IS NULL THEN
    RAISE EXCEPTION 'Expected source calendar is missing' USING ERRCODE = '23503';
  END IF;

  v_target_calendar_id := p_expected_calendar_id;
  IF p_updates ? 'calendar_id' THEN
    BEGIN
      v_target_calendar_id := (p_updates->>'calendar_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'calendar_id must be a UUID' USING ERRCODE = '22023';
    END;
    IF v_target_calendar_id IS NULL THEN
      RAISE EXCEPTION 'Target calendar is missing' USING ERRCODE = '23503';
    END IF;
  END IF;

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;

  -- source와 payload에서 파생한 target을 UUID 순서로 잠가 이동끼리의 역순 교착을 피한다.
  PERFORM candidate.id
  FROM calendars AS candidate
  WHERE candidate.id = ANY (ARRAY[p_expected_calendar_id, v_target_calendar_id])
  ORDER BY candidate.id
  FOR UPDATE;

  SELECT candidate.* INTO v_source
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source calendar % not found', p_expected_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT candidate.* INTO v_target
  FROM calendars AS candidate
  WHERE candidate.id = v_target_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target calendar % not found', v_target_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT current_event.* INTO v_existing
  FROM calendar_events AS current_event
  WHERE current_event.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_existing.calendar_id <> p_expected_calendar_id THEN
    RAISE EXCEPTION 'Calendar event source changed; refresh and retry' USING ERRCODE = '40001';
  END IF;

  -- Locked source row: old clients must not mistake one occurrence for its master.
  IF v_existing.recurrence_rule IS NOT NULL THEN
    RAISE EXCEPTION '반복 일정은 최신 앱에서 수정해 주세요' USING ERRCODE='22023';
  END IF;

  IF v_source.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_source.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event source permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_target.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_target.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event target permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE calendar_events AS target_event
  SET calendar_id = CASE WHEN p_updates ? 'calendar_id' THEN v_target_calendar_id ELSE v_existing.calendar_id END,
      title = CASE WHEN p_updates ? 'title' THEN p_updates->>'title' ELSE v_existing.title END,
      memo = CASE WHEN p_updates ? 'memo' THEN p_updates->>'memo' ELSE v_existing.memo END,
      tag_id = CASE WHEN p_updates ? 'tag_id' THEN (p_updates->>'tag_id')::UUID ELSE v_existing.tag_id END,
      all_day = CASE WHEN p_updates ? 'all_day' THEN (p_updates->>'all_day')::BOOLEAN ELSE v_existing.all_day END,
      start_date = CASE WHEN p_updates ? 'start_date' THEN (p_updates->>'start_date')::DATE ELSE v_existing.start_date END,
      end_date = CASE WHEN p_updates ? 'end_date' THEN (p_updates->>'end_date')::DATE ELSE v_existing.end_date END,
      start_time = CASE WHEN p_updates ? 'start_time' THEN p_updates->>'start_time' ELSE v_existing.start_time END,
      end_time = CASE WHEN p_updates ? 'end_time' THEN p_updates->>'end_time' ELSE v_existing.end_time END,
      linked_episode = CASE WHEN p_updates ? 'linked_episode' THEN (p_updates->>'linked_episode')::INTEGER ELSE v_existing.linked_episode END,
      linked_part = CASE WHEN p_updates ? 'linked_part' THEN p_updates->>'linked_part' ELSE v_existing.linked_part END,
      linked_sheet_name = CASE WHEN p_updates ? 'linked_sheet_name' THEN p_updates->>'linked_sheet_name' ELSE v_existing.linked_sheet_name END,
      linked_scene_id = CASE WHEN p_updates ? 'linked_scene_id' THEN p_updates->>'linked_scene_id' ELSE v_existing.linked_scene_id END,
      linked_department = CASE WHEN p_updates ? 'linked_department' THEN p_updates->>'linked_department' ELSE v_existing.linked_department END,
      linked_todo_id = CASE WHEN p_updates ? 'linked_todo_id' THEN p_updates->>'linked_todo_id' ELSE v_existing.linked_todo_id END,
      updated_at = now()
  WHERE target_event.id = p_event_id
  RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

-- Preserve existing legacy ACL and return signatures, with a recurring-master guard.
CREATE OR REPLACE FUNCTION public.delete_calendar_event_authorized(
  p_actor_id TEXT,
  p_event_id UUID,
  p_expected_calendar_id UUID
)
RETURNS SETOF calendar_events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source calendars%ROWTYPE;
  v_existing calendar_events%ROWTYPE;
  v_deleted calendar_events%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' THEN
    RAISE EXCEPTION 'A session actor is required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_calendar_id IS NULL THEN
    RAISE EXCEPTION 'Expected source calendar is missing' USING ERRCODE = '23503';
  END IF;

  LOCK TABLE calendars IN ROW EXCLUSIVE MODE;
  LOCK TABLE calendar_events IN ROW EXCLUSIVE MODE;

  PERFORM candidate.id
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id
  ORDER BY candidate.id
  FOR UPDATE;

  SELECT candidate.* INTO v_source
  FROM calendars AS candidate
  WHERE candidate.id = p_expected_calendar_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source calendar % not found', p_expected_calendar_id USING ERRCODE = '23503';
  END IF;

  SELECT current_event.* INTO v_existing
  FROM calendar_events AS current_event
  WHERE current_event.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_existing.calendar_id <> p_expected_calendar_id THEN
    RAISE EXCEPTION 'Calendar event source changed; refresh and retry' USING ERRCODE = '40001';
  END IF;

  -- Locked source row: old clients must not mistake one occurrence for its master.
  IF v_existing.recurrence_rule IS NOT NULL THEN
    RAISE EXCEPTION '반복 일정은 최신 앱에서 수정해 주세요' USING ERRCODE='22023';
  END IF;

  IF v_source.owner_id <> p_actor_id
     AND NOT EXISTS (
       SELECT 1
       FROM calendar_members AS permission
       WHERE permission.calendar_id = v_source.id
         AND permission.user_id = p_actor_id
         AND permission.can_edit IS TRUE
     ) THEN
    RAISE EXCEPTION 'Calendar event delete permission denied' USING ERRCODE = '42501';
  END IF;

  DELETE FROM calendar_events AS target_event
  WHERE target_event.id = p_event_id
  RETURNING * INTO v_deleted;

  RETURN NEXT v_deleted;
END;
$$;

-- CAS also observes ordinary old-client updates; explicit new revisions advance once.
CREATE OR REPLACE FUNCTION public.calendar_recurrence_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (
  (TG_OP='INSERT' AND NEW.recurrence_rule IS NOT NULL) OR
  (TG_OP='UPDATE' AND (OLD.recurrence_rule IS NOT NULL OR NEW.recurrence_rule IS NOT NULL)) OR
  (TG_OP='DELETE' AND OLD.recurrence_rule IS NOT NULL)) THEN
  RAISE EXCEPTION 'Recurring events require a validated session command' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
  IF NEW.recurrence_revision=OLD.recurrence_revision THEN NEW.recurrence_revision:=OLD.recurrence_revision+1; END IF;
  NEW.updated_at:=now();
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS calendar_recurrence_revision ON public.calendar_events;
CREATE TRIGGER calendar_recurrence_revision BEFORE INSERT OR UPDATE OR DELETE ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.calendar_recurrence_revision_guard();

-- Removed tag IDs cannot survive inside an occurrence override.
CREATE OR REPLACE FUNCTION public.calendar_recurrence_remove_tag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 WITH changed AS (UPDATE public.calendar_event_exceptions x SET patch=x.patch||jsonb_build_object(
  'tag_ids',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(x.patch->'tag_ids') value WHERE value<>to_jsonb(OLD.id::TEXT)),'[]'::JSONB),
  'tag_id',(SELECT value FROM jsonb_array_elements(x.patch->'tag_ids') value WHERE value<>to_jsonb(OLD.id::TEXT) LIMIT 1)),updated_at=now()
 WHERE x.patch->'tag_ids' @> jsonb_build_array(OLD.id) RETURNING x.series_id)
 UPDATE public.calendar_events e SET recurrence_revision=recurrence_revision+1,updated_at=now()
 WHERE e.id IN(SELECT series_id FROM changed);
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS calendar_recurrence_tag_delete ON public.calendar_tags;
CREATE TRIGGER calendar_recurrence_tag_delete BEFORE DELETE ON public.calendar_tags
FOR EACH ROW EXECUTE FUNCTION public.calendar_recurrence_remove_tag();

-- The bearer-authenticated feed keeps source UUIDs and exports raw masters plus sparse exceptions.
CREATE OR REPLACE FUNCTION public.calendar_feed_read(p_token_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source public.calendars%ROWTYPE; events JSONB;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT c.* INTO source FROM public.calendar_external_feeds f JOIN public.calendars c ON c.id=f.calendar_id AND c.owner_id=f.owner_id
  WHERE f.token_hash=p_token_hash AND f.enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH native AS (
    SELECT jsonb_build_object('id',e.id,'title',e.title,'memo',e.memo,'all_day',e.all_day,'start_date',e.start_date,'end_date',e.end_date,
      'start_time',e.start_time,'end_time',e.end_time,'created_at',e.created_at,'updated_at',e.updated_at,
      'recurrence_rule',e.recurrence_rule,'recurrence_revision',e.recurrence_revision,
      'location',e.location,'meeting_url',e.meeting_url,'reminder_minutes',e.reminder_minutes,
      'recurrence_exceptions',coalesce((SELECT jsonb_agg(jsonb_build_object('occurrence_date',x.occurrence_date,'cancelled',x.cancelled,
       'patch',x.patch||CASE WHEN x.patch ? 'tag_ids' THEN jsonb_build_object('categories',coalesce((SELECT jsonb_agg(t.name ORDER BY tags.ordinal)
         FROM jsonb_array_elements_text(x.patch->'tag_ids') WITH ORDINALITY tags(id,ordinal) JOIN public.calendar_tags t ON t.id=tags.id::UUID),'[]'::JSONB)) ELSE '{}'::JSONB END)
        ORDER BY x.occurrence_date) FROM public.calendar_event_exceptions x WHERE x.series_id=e.id),'[]'::JSONB),
      'categories',coalesce((SELECT jsonb_agg(t.name ORDER BY ids.ordinal) FROM unnest(
        CASE WHEN cardinality(e.tag_ids)>0 THEN e.tag_ids WHEN e.tag_id IS NOT NULL THEN ARRAY[e.tag_id] ELSE '{}'::UUID[] END
      ) WITH ORDINALITY ids(id,ordinal) JOIN public.calendar_tags t ON t.id=ids.id),'[]'::JSONB)) value
    FROM public.calendar_events e WHERE e.calendar_id=source.id
  ), projected AS (
    SELECT jsonb_build_object('id',p->>'id','title',p->>'title','memo',p->>'memo','all_day',(p->>'all_day')::BOOLEAN,
      'start_date',p->>'start_date','end_date',p->>'end_date','start_time',p->>'start_time','end_time',p->>'end_time',
      'created_at',p->>'created_at','updated_at',p->>'updated_at','categories','[]'::JSONB) value
    FROM jsonb_array_elements(public.gantt_calendar_events(source.owner_id)) p
    WHERE p->>'calendar_id'=source.id::TEXT
  ), selected AS (SELECT value FROM native UNION ALL SELECT value FROM projected)
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'start_date',value->>'id'),'[]'::JSONB) INTO events FROM selected;
  RETURN jsonb_build_object('calendar',jsonb_build_object('id',source.id,'name',source.name,'color',source.color),'events',events);
END $$;

CREATE OR REPLACE FUNCTION public.calendar_recurrence_camel_exceptions(event_id UUID) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('occurrenceDate',x.occurrence_date,'cancelled',x.cancelled,'patch',
  coalesce((SELECT jsonb_object_agg(keys.camel,x.patch->keys.snake) FROM (VALUES
   ('title','title'),('memo','memo'),('start_date','startDate'),('end_date','endDate'),('start_time','startTime'),('end_time','endTime'),
   ('all_day','allDay'),('tag_id','tagId'),('tag_ids','tagIds'),('location','location'),('meeting_url','meetingUrl'),('reminder_minutes','reminderMinutes')) keys(snake,camel)
   WHERE x.patch ? keys.snake),'{}'::JSONB)||CASE WHEN x.patch ? 'tag_ids' THEN jsonb_build_object('color',coalesce(
    (SELECT t.color FROM public.calendar_tags t WHERE t.id=(x.patch#>>'{tag_ids,0}')::UUID),
    (SELECT c.color FROM public.calendar_events e JOIN public.calendars c ON c.id=e.calendar_id WHERE e.id=x.series_id))) ELSE '{}'::JSONB END)
    ORDER BY x.occurrence_date),'[]'::JSONB)
 FROM public.calendar_event_exceptions x WHERE x.series_id=event_id
$$;

-- Gantt receives raw series; the current canvas window expands these without persistent copies.
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
        'recurrenceRule',e.recurrence_rule,'recurrenceRevision',e.recurrence_revision,
        'recurrenceExceptions',public.calendar_recurrence_camel_exceptions(e.id),
        'location',e.location,'meetingUrl',e.meeting_url,'reminderMinutes',e.reminder_minutes,
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

REVOKE ALL ON FUNCTION public.calendar_validate_recurrence(JSONB,DATE),public.calendar_recurrence_index(DATE,JSONB,DATE),
 public.calendar_recurrence_document(UUID),public.calendar_validate_recurrence_event(public.calendar_events),
 public.calendar_recurrence_camel_exceptions(UUID),public.calendar_recurrence_revision_guard(),public.calendar_recurrence_remove_tag(),
 public.calendar_session_recurrence_events(TEXT),public.calendar_session_recurrence_execute(TEXT,TEXT,UUID,DATE,TEXT,BIGINT,JSONB)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_session_recurrence_events(TEXT),public.calendar_session_recurrence_execute(TEXT,TEXT,UUID,DATE,TEXT,BIGINT,JSONB) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.calendar_feed_read(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_read(TEXT) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
