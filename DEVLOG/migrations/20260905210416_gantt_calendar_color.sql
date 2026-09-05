-- Calendar projections carry the same inherited color as the Gantt chart.
-- Keep the existing session wrapper, audience checks and internal-only RPC ACL.
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
    'gantt_color',COALESCE((
      WITH RECURSIVE ancestors(task,depth,visited) AS (
        SELECT t,0,ARRAY[t->>'id']
        UNION ALL
        SELECT task_index.tasks->(a.task->>'parentId'),a.depth+1,a.visited||(a.task->>'parentId')
        FROM ancestors a
        WHERE a.task->>'color' IS NULL AND task_index.tasks ? (a.task->>'parentId')
          AND NOT (a.task->>'parentId')=ANY(a.visited)
      )
      SELECT a.task->>'color' FROM ancestors a WHERE a.task->>'color' IS NOT NULL ORDER BY depth LIMIT 1
    ),p.data->>'color'),
    'gantt_can_edit',public.gantt_project_access(s.data,p.data,p_actor_id,true) AND public.gantt_calendar_access(p_actor_id,(t->>'calendarId')::UUID,true)
  ) ORDER BY t->>'startDate',p.id,t->>'id'),'[]'::JSONB) INTO result
  FROM public.gantt_projects p JOIN public.gantt_spaces s ON s.id=p.space_id
  CROSS JOIN LATERAL (SELECT jsonb_object_agg(item->>'id',item) AS tasks FROM jsonb_array_elements(p.data->'tasks') item) task_index
  CROSS JOIN LATERAL jsonb_array_elements(p.data->'tasks') t
  WHERE t->>'calendarId' IS NOT NULL AND t->>'kind'<>'group' AND public.gantt_calendar_access(p_actor_id,(t->>'calendarId')::UUID)
    AND (p_from IS NULL OR (t->>'endDate')::DATE>=p_from)
    AND (p_to IS NULL OR (t->>'startDate')::DATE<=p_to)
    AND (p_event_id IS NULL OR 'gantt:'||p.id||':'||(t->>'id')=p_event_id);
  RETURN result;
END $$;
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_calendar_events(TEXT,DATE,DATE,TEXT) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
