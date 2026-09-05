-- Retain entity revision high-water marks across deletion/restoration (CAS ABA protection).
-- Generated with `supabase migration new gantt_revision_ledger`.
-- Apply after gantt_release_acl. No public RPC or snapshot shape changes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE TABLE IF NOT EXISTS public.gantt_entity_revisions (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('space','project')),
  entity_id TEXT NOT NULL,
  last_revision INTEGER NOT NULL CHECK (last_revision > 0),
  retired BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (entity_kind,entity_id)
);
ALTER TABLE public.gantt_entity_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.gantt_entity_revisions FROM PUBLIC,anon,authenticated;

-- The ledger deliberately has no foreign keys: deleting a user, space or project
-- must never reset its clock. It contains no project content and stays private.
DO $$
DECLARE fresh_live JSONB; item RECORD; next_revision INTEGER;
BEGIN
  LOCK TABLE public.calendars IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_spaces IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.gantt_projects IN SHARE ROW EXCLUSIVE MODE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',e.kind,'id',e.id)),'[]'::JSONB) INTO fresh_live
  FROM (SELECT 'space' AS kind,id FROM public.gantt_spaces UNION ALL SELECT 'project',id FROM public.gantt_projects) e
  WHERE NOT EXISTS(SELECT 1 FROM public.gantt_entity_revisions r WHERE r.entity_kind=e.kind AND r.entity_id=e.id);

  -- Existing receipts record server-checked CAS versions. Never trust a submitted
  -- project.revision/space.revision, which may be an arbitrary client value.
  INSERT INTO public.gantt_entity_revisions(entity_kind,entity_id,last_revision,retired)
  SELECT kind,id,max(revision),NOT EXISTS(
    SELECT 1 FROM public.gantt_spaces s WHERE history.kind='space' AND s.id=history.id
    UNION ALL SELECT 1 FROM public.gantt_projects p WHERE history.kind='project' AND p.id=history.id
  ) FROM (
    SELECT 'space' AS kind,id,revision FROM public.gantt_spaces
    UNION ALL SELECT 'project',id,revision FROM public.gantt_projects
    UNION ALL
    SELECT CASE WHEN command->>'type' IN ('saveSpace','deleteSpace') THEN 'space' ELSE 'project' END,
      CASE command->>'type' WHEN 'saveSpace' THEN command->'space'->>'id' WHEN 'saveProject' THEN command->'project'->>'id'
        WHEN 'deleteSpace' THEN command->>'spaceId' ELSE command->>'projectId' END,
      COALESCE((command->>'expectedRevision')::INTEGER,0)+CASE WHEN command->>'type' IN ('saveSpace','saveProject') THEN 1 ELSE 0 END
    FROM public.gantt_requests WHERE command->>'type' IN ('saveSpace','saveProject','deleteSpace','deleteProject')
  ) history WHERE id IS NOT NULL AND revision>0 GROUP BY kind,id
  ON CONFLICT(entity_kind,entity_id) DO UPDATE SET last_revision=GREATEST(gantt_entity_revisions.last_revision,EXCLUDED.last_revision);
  -- Newly discovered, already-deleted IDs are retired at cutover: old calendar/
  -- user cascades may have incremented their final revision without a receipt.
  -- ON CONFLICT never changes retired, so replay cannot retire new tombstones.

  -- One-time invalidation of live pre-upgrade snapshots, including clocks that
  -- had already been reused. Reapplying the migration leaves tracked rows alone.
  FOR item IN SELECT * FROM jsonb_to_recordset(fresh_live) AS e(kind TEXT,id TEXT) LOOP
    SELECT last_revision+1 INTO next_revision FROM public.gantt_entity_revisions WHERE entity_kind=item.kind AND entity_id=item.id;
    IF item.kind='space' THEN
      UPDATE public.gantt_spaces SET revision=next_revision,data=jsonb_set(data,'{revision}',to_jsonb(next_revision)),updated_at=now() WHERE id=item.id;
    ELSE
      UPDATE public.gantt_projects SET revision=next_revision,data=jsonb_set(data,'{revision}',to_jsonb(next_revision)),updated_at=now() WHERE id=item.id;
    END IF;
    UPDATE public.gantt_entity_revisions SET last_revision=next_revision WHERE entity_kind=item.kind AND entity_id=item.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.gantt_assign_insert_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE previous INTEGER; was_retired BOOLEAN;
BEGIN
  SELECT last_revision,retired INTO previous,was_retired FROM public.gantt_entity_revisions
    WHERE entity_kind=TG_ARGV[0] AND entity_id=NEW.id;
  IF was_retired THEN
    RAISE EXCEPTION '이전 버전에서 삭제한 항목은 복원할 수 없습니다. 새 항목을 만들어 주세요.' USING ERRCODE='40001';
  END IF;
  -- BEFORE INSERT also runs for INSERT ... ON CONFLICT DO UPDATE. The existing
  -- gantt_execute lock/CAS check has already validated that update; the ledger
  -- then assigns precisely the next revision for both updates and resurrection.
  NEW.revision:=COALESCE(previous,0)+1;
  NEW.data:=jsonb_set(NEW.data,'{revision}',to_jsonb(NEW.revision));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.gantt_remember_entity_revision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE entity_id TEXT; entity_revision INTEGER;
BEGIN
  IF TG_OP='DELETE' THEN entity_id:=OLD.id; entity_revision:=OLD.revision;
  ELSE entity_id:=NEW.id; entity_revision:=NEW.revision; END IF;
  INSERT INTO public.gantt_entity_revisions(entity_kind,entity_id,last_revision) VALUES(TG_ARGV[0],entity_id,entity_revision)
  ON CONFLICT ON CONSTRAINT gantt_entity_revisions_pkey DO UPDATE
    SET last_revision=GREATEST(gantt_entity_revisions.last_revision,EXCLUDED.last_revision);
  RETURN NULL;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_assign_insert_revision(),public.gantt_remember_entity_revision() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS gantt_spaces_assign_revision ON public.gantt_spaces;
CREATE TRIGGER gantt_spaces_assign_revision BEFORE INSERT ON public.gantt_spaces
  FOR EACH ROW EXECUTE FUNCTION public.gantt_assign_insert_revision('space');
DROP TRIGGER IF EXISTS gantt_projects_assign_revision ON public.gantt_projects;
CREATE TRIGGER gantt_projects_assign_revision BEFORE INSERT ON public.gantt_projects
  FOR EACH ROW EXECUTE FUNCTION public.gantt_assign_insert_revision('project');
DROP TRIGGER IF EXISTS gantt_spaces_remember_revision ON public.gantt_spaces;
CREATE TRIGGER gantt_spaces_remember_revision AFTER INSERT OR UPDATE OR DELETE ON public.gantt_spaces
  FOR EACH ROW EXECUTE FUNCTION public.gantt_remember_entity_revision('space');
DROP TRIGGER IF EXISTS gantt_projects_remember_revision ON public.gantt_projects;
CREATE TRIGGER gantt_projects_remember_revision AFTER INSERT OR UPDATE OR DELETE ON public.gantt_projects
  FOR EACH ROW EXECUTE FUNCTION public.gantt_remember_entity_revision('project');

-- Calendar editors need the canonical task kind to preserve zero-duration milestones.
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
    'linked_gantt_project_id',p.id,'linked_gantt_task_id',t->>'id','linked_gantt_task_kind',t->>'kind',
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
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_calendar_events(TEXT,DATE,DATE,TEXT) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
