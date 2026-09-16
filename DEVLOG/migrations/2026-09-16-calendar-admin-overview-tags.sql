-- Session-authenticated calendar overview and multiple event tags.
-- Deploy before the matching desktop release. Existing single-tag events are retained.
BEGIN;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS tag_ids UUID[] NOT NULL DEFAULT '{}';
UPDATE public.calendar_events SET tag_ids = ARRAY[tag_id] WHERE tag_id IS NOT NULL AND cardinality(tag_ids) = 0;

-- Old clients still write tag_id. New clients write tag_ids; keep the first item in tag_id.
CREATE OR REPLACE FUNCTION public.calendar_sync_event_tags() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids UUID[]; v_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ids := CASE WHEN cardinality(NEW.tag_ids) > 0 THEN NEW.tag_ids WHEN NEW.tag_id IS NOT NULL THEN ARRAY[NEW.tag_id] ELSE '{}'::UUID[] END;
  ELSIF NEW.tag_ids IS DISTINCT FROM OLD.tag_ids THEN
    v_ids := NEW.tag_ids;
  ELSIF NEW.tag_id IS DISTINCT FROM OLD.tag_id THEN
    v_ids := CASE WHEN NEW.tag_id IS NULL THEN '{}'::UUID[] ELSE ARRAY[NEW.tag_id] END;
  ELSE RETURN NEW;
  END IF;
  IF v_ids IS NULL OR array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid calendar tags' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY ordinal), '{}'::UUID[]) INTO v_ids
    FROM (SELECT id, min(ordinal) ordinal FROM unnest(v_ids) WITH ORDINALITY AS tags(id, ordinal) GROUP BY id) unique_tags;
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.calendar_tags WHERE id = v_id FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown calendar tag' USING ERRCODE = '23503'; END IF;
  END LOOP;
  NEW.tag_ids := v_ids; NEW.tag_id := v_ids[1]; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS calendar_event_tags_sync ON public.calendar_events;
CREATE TRIGGER calendar_event_tags_sync BEFORE INSERT OR UPDATE OF tag_id, tag_ids ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.calendar_sync_event_tags();

CREATE OR REPLACE FUNCTION public.calendar_remove_deleted_tag() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.calendar_events SET tag_ids = array_remove(tag_ids, OLD.id)
  WHERE OLD.id = ANY(tag_ids);
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS calendar_tag_associations_delete ON public.calendar_tags;
CREATE TRIGGER calendar_tag_associations_delete BEFORE DELETE ON public.calendar_tags
FOR EACH ROW EXECUTE FUNCTION public.calendar_remove_deleted_tag();

CREATE OR REPLACE FUNCTION public.calendar_session_list(p_session_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token); v_overview BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND id = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND role = 'admin') INTO v_overview;
  RETURN (WITH visible AS (
    SELECT c.* FROM public.calendars c WHERE v_overview OR c.owner_id = v_actor OR c.visibility = 'team'
      OR EXISTS (SELECT 1 FROM public.calendar_members m WHERE m.calendar_id = c.id AND m.user_id = v_actor)
  ) SELECT jsonb_build_object(
    'calendars', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at, c.id) FROM visible c), '[]'::JSONB),
    'members', coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM public.calendar_members m JOIN visible c ON c.id = m.calendar_id), '[]'::JSONB)));
END $$;

CREATE OR REPLACE FUNCTION public.calendar_session_events(p_session_token TEXT, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token); v_overview BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND id = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND role = 'admin') INTO v_overview;
  RETURN QUERY SELECT e.* FROM public.calendar_events e JOIN public.calendars c ON c.id = e.calendar_id
  WHERE (v_overview OR c.owner_id = v_actor OR c.visibility = 'team'
    OR EXISTS (SELECT 1 FROM public.calendar_members m WHERE m.calendar_id = c.id AND m.user_id = v_actor))
    AND (p_from IS NULL OR e.end_date >= p_from) AND (p_to IS NULL OR e.start_date <= p_to)
  ORDER BY e.start_date, e.id;
END $$;

-- Reuse canonical projection formatting and expose only tasks actually linked to an
-- otherwise-hidden calendar. This never expands Gantt project or write permissions.
CREATE OR REPLACE FUNCTION public.gantt_session_calendar_events(
  p_session_token TEXT, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL, p_event_id TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token); v_regular JSONB; v_extra JSONB;
BEGIN
  v_regular := public.gantt_calendar_events(v_actor, p_from, p_to, p_event_id);
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor AND id = 'fcc4b438-2696-4e88-a03f-d6f34e73e08f' AND role = 'admin') THEN
    RETURN v_regular;
  END IF;
  WITH hidden AS (
    SELECT c.id, c.owner_id FROM public.calendars c WHERE c.owner_id <> v_actor AND c.visibility <> 'team'
      AND NOT EXISTS (SELECT 1 FROM public.calendar_members m WHERE m.calendar_id = c.id AND m.user_id = v_actor)
  ), owners AS (SELECT DISTINCT owner_id FROM hidden), projected AS (
    SELECT row.value FROM owners o CROSS JOIN LATERAL
      jsonb_array_elements(public.gantt_calendar_events(o.owner_id, p_from, p_to, p_event_id)) row(value)
    JOIN hidden c ON c.id::TEXT = row.value->>'calendar_id' AND c.owner_id = o.owner_id
  ) SELECT coalesce(jsonb_agg(value || jsonb_build_object('gantt_can_edit', false)), '[]'::JSONB) INTO v_extra FROM projected;
  RETURN v_regular || v_extra;
END $$;

-- Wrappers derive the actor from the server session, retaining the existing atomic ACL checks.
CREATE OR REPLACE FUNCTION public.calendar_session_event_create(p_session_token TEXT, p_event JSONB)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token); v_event public.calendar_events%ROWTYPE; v_tags UUID[];
BEGIN
  IF p_event ? 'tag_ids' THEN
    IF jsonb_typeof(p_event->'tag_ids') <> 'array' THEN RAISE EXCEPTION 'tag_ids must be an array' USING ERRCODE = '22023'; END IF;
    SELECT coalesce(array_agg(value::UUID ORDER BY ordinal), '{}'::UUID[]) INTO v_tags FROM jsonb_array_elements_text(p_event->'tag_ids') WITH ORDINALITY AS tags(value, ordinal);
  END IF;
  SELECT * INTO v_event FROM public.create_calendar_event_authorized(v_actor, p_event - 'tag_ids');
  IF v_tags IS NOT NULL THEN
    UPDATE public.calendar_events SET tag_ids = v_tags, tag_id = v_tags[1] WHERE id = v_event.id RETURNING * INTO v_event;
  END IF;
  RETURN NEXT v_event;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_session_event_update(p_session_token TEXT, p_event_id UUID, p_expected_calendar_id UUID, p_updates JSONB)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token); v_event public.calendar_events%ROWTYPE; v_tags UUID[];
BEGIN
  IF p_updates ? 'tag_ids' THEN
    IF jsonb_typeof(p_updates->'tag_ids') <> 'array' THEN RAISE EXCEPTION 'tag_ids must be an array' USING ERRCODE = '22023'; END IF;
    SELECT coalesce(array_agg(value::UUID ORDER BY ordinal), '{}'::UUID[]) INTO v_tags FROM jsonb_array_elements_text(p_updates->'tag_ids') WITH ORDINALITY AS tags(value, ordinal);
  END IF;
  SELECT * INTO v_event FROM public.update_calendar_event_authorized(v_actor, p_event_id, p_expected_calendar_id, p_updates - 'tag_ids');
  IF v_tags IS NOT NULL THEN
    UPDATE public.calendar_events SET tag_ids = v_tags, tag_id = v_tags[1] WHERE id = v_event.id RETURNING * INTO v_event;
  END IF;
  RETURN NEXT v_event;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_session_tags_save(p_session_token TEXT, p_tags JSONB)
RETURNS TABLE(id UUID, name TEXT, color TEXT, sort_order INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor TEXT := public.app_session_user_id(p_session_token);
BEGIN
  RETURN QUERY SELECT * FROM public.replace_calendar_tags_authorized(v_actor, p_tags);
END $$;

-- Public clients may only mutate the tag catalog with a validated admin session.
-- Existing old desktop versions can still read/use tags; their tag editor requires an update.
REVOKE ALL ON FUNCTION public.replace_calendar_tags_authorized(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.calendar_tags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar_sync_event_tags(), public.calendar_remove_deleted_tag() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar_session_list(TEXT), public.calendar_session_events(TEXT, DATE, DATE),
 public.calendar_session_event_create(TEXT, JSONB), public.calendar_session_event_update(TEXT, UUID, UUID, JSONB),
 public.calendar_session_tags_save(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_session_list(TEXT), public.calendar_session_events(TEXT, DATE, DATE),
 public.calendar_session_event_create(TEXT, JSONB), public.calendar_session_event_update(TEXT, UUID, UUID, JSONB),
 public.calendar_session_tags_save(TEXT, JSONB) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
