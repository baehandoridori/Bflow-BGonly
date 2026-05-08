-- v1.23.0 — get_activity_stats_v2 (시간 단위 확장) + get_activity_insights (분석 모달)
-- 적용 위치: Supabase SQL editor에서 그대로 실행 (CREATE OR REPLACE 이므로 재실행 안전)
-- 기존 get_activity_stats 시그니처는 변경하지 않음 (호환성). 새 함수 2개 추가.

-- ============================================================================
-- 1. get_activity_stats_v2 — 위젯 히트맵/막대 데이터 소스
-- ============================================================================
CREATE OR REPLACE FUNCTION get_activity_stats_v2(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_granularity text,            -- 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals'
  p_department text DEFAULT NULL,
  p_groups text[] DEFAULT NULL
) RETURNS TABLE (
  bucket1 int,
  bucket2 int,
  total int,
  count_progress int,
  count_memo int,
  count_scene int,
  count_etc int
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_granularity = 'hour-of-day-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(dow  FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket1,
        EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Seoul')::int  AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-x-dow' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1, bucket2;

  ELSIF p_granularity = 'month-totals' THEN
    RETURN QUERY
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS bucket1,
        0 AS bucket2,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE action_group='progress')::int,
        COUNT(*) FILTER (WHERE action_group='memo')::int,
        COUNT(*) FILTER (WHERE action_group='scene')::int,
        COUNT(*) FILTER (WHERE action_group='etc')::int
      FROM activity_log
      WHERE created_at >= p_range_start
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
        AND (p_groups     IS NULL OR action_group = ANY(p_groups))
      GROUP BY bucket1;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_activity_stats_v2(timestamptz, timestamptz, text, text, text[]) TO anon, authenticated;

-- ============================================================================
-- 2. get_activity_insights — 분석 모달 7카드 raw data 한 번에 반환
-- ============================================================================
CREATE OR REPLACE FUNCTION get_activity_insights(
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_department text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- 1) monthDowGrid: 12개월 × 7요일 (1년치 종합 히트맵)
  v_result := v_result || jsonb_build_object('monthDowGrid', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('month', m, 'dow', d, 'count', c))
    FROM (
      SELECT
        EXTRACT(month FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS m,
        EXTRACT(dow   FROM created_at AT TIME ZONE 'Asia/Seoul')::int AS d,
        COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY m, d
    ) t
  ), '[]'::jsonb));

  -- 2) userBreakdown: 활동 많은 상위 5명 (담당자별 비중)
  v_result := v_result || jsonb_build_object('userBreakdown', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'userName', user_name, 'count', c) ORDER BY c DESC)
    FROM (
      SELECT user_id, MAX(user_name) AS user_name, COUNT(*)::int AS c
      FROM activity_log
      WHERE created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY user_id
      ORDER BY c DESC
      LIMIT 5
    ) t
  ), '[]'::jsonb));

  -- 3) userBreakdownTotal: 전체 합계 ("기타 N명" 계산용)
  v_result := v_result || jsonb_build_object('userBreakdownTotal', COALESCE((
    SELECT COUNT(*)::int FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ), 0));

  -- 4) stageBreakdown: LO/완료/검수/PNG 카운트 (단계별 도넛)
  v_result := v_result || jsonb_build_object('stageBreakdown', (
    SELECT jsonb_build_object(
      'lo',     COUNT(*) FILTER (WHERE action_type='stage_lo'),
      'done',   COUNT(*) FILTER (WHERE action_type='stage_done'),
      'review', COUNT(*) FILTER (WHERE action_type='stage_review'),
      'png',    COUNT(*) FILTER (WHERE action_type='stage_png')
    )
    FROM activity_log
    WHERE created_at >= p_range_start AND created_at < p_range_end
      AND (p_department IS NULL OR department = p_department)
  ));

  -- 5) topScenes: 활동 많은 씬 Top 10 (병목 씬 발견)
  v_result := v_result || jsonb_build_object('topScenes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sceneId', scene_id,
      'sceneLabel', scene_label,
      'episodeNumber', episode_number,
      'total', total,
      'revCount', rev_count,
      'memoCount', memo_count,
      'stageCount', stage_count
    ) ORDER BY total DESC)
    FROM (
      SELECT
        scene_id,
        MAX(scene_label)        AS scene_label,
        MAX(episode_number)     AS episode_number,
        COUNT(*)::int           AS total,
        COUNT(*) FILTER (WHERE action_type IN ('revision_add','revision_resolve'))::int AS rev_count,
        COUNT(*) FILTER (WHERE action_type IN ('memo_update','comment_add'))::int       AS memo_count,
        COUNT(*) FILTER (WHERE action_group='progress')::int                            AS stage_count
      FROM activity_log
      WHERE scene_id IS NOT NULL
        AND created_at >= p_range_start AND created_at < p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY scene_id
      ORDER BY total DESC
      LIMIT 10
    ) t
  ), '[]'::jsonb));

  -- 6) weeklyCompleted: 주별 PNG 도달 씬 수 (최근 12주)
  v_result := v_result || jsonb_build_object('weeklyCompleted', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('weekStart', week_start, 'completedSceneCount', cnt) ORDER BY week_start)
    FROM (
      SELECT
        date_trunc('week', created_at AT TIME ZONE 'Asia/Seoul')::date AS week_start,
        COUNT(DISTINCT scene_id)::int AS cnt
      FROM activity_log
      WHERE action_type = 'stage_png'
        AND scene_id IS NOT NULL
        AND created_at >= GREATEST(p_range_start, now() - INTERVAL '12 weeks')
        AND created_at <  p_range_end
        AND (p_department IS NULL OR department = p_department)
      GROUP BY week_start
    ) t
  ), '[]'::jsonb));

  -- 7) sceneFlow + episodeProgress 는 활동 로그만으로는 정확 산출 불가 (씬 단계 첫 도달 timestamp 필요).
  --    v1.23.0 에서는 클라이언트가 useDataStore.episodes/scenes 로 보강하거나 임시 더미 표시.
  --    응답 형태 일관성 위해 빈 객체/배열 반환.
  v_result := v_result || jsonb_build_object(
    'sceneFlow', '{}'::jsonb,
    'episodeProgress', '[]'::jsonb
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_activity_insights(timestamptz, timestamptz, text) TO anon, authenticated;
