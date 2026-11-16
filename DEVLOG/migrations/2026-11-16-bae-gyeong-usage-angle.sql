-- BAE경 '이번 달 내 사용 N장'에 다른 각도로 그린 그림도 센다 (7단계 연결, 2026-11-16).
-- 장부 줄 종류 'angle' 은 다른 각도로의 그림 한 장이다 (PD메모는 'note', 레이어 나누기는 'layers' — 그림 수에 넣지 않음).
-- 바꾸는 것: bae_gyeong_session_usage_summary 의 images 셈 하나 (kind = 'image' → kind IN ('image','angle')). 돈 합계 · 줄 목록은 그대로.
-- Prerequisite: DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql. 기본 파일을 다시 실행하면 이 셈이 예전으로 돌아가므로 이 파일도 다시 실행한다.
-- CREATE OR REPLACE 는 권한을 그대로 두지만, 아래에서 이 함수 하나의 권한을 기본 파일의 규칙대로 다시 맞춘다.
-- 적용: 2026-11-16 개발 브랜치 → 운영 예행연습('BAE ANGLE COUNT SMOKE OK', 되돌림) → 운영 20261116110611 bae_gyeong_usage_angle.
-- (8단계 파일 머리의 함수 지문 350ef63b… 은 이 파일 전의 값이다 — 이 함수 본문이 바뀌어 지문도 바뀐다.)
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE OR REPLACE FUNCTION public.bae_gyeong_session_usage_summary(p_session_token TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT := public.bae_gyeong_actor(p_session_token);
BEGIN
 RETURN (SELECT jsonb_build_object('usd', COALESCE(sum(u.usd), 0), 'images', count(*) FILTER (WHERE u.kind IN ('image','angle')),
   'orders', count(*) FILTER (WHERE u.kind = 'order'),
   'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'model', g.model, 'n', g.n, 'usd', g.usd) ORDER BY g.kind, g.model)
     FROM (SELECT x.kind, x.model, count(*) n, sum(x.usd) usd FROM public.bae_gyeong_usage x
       WHERE x.user_id = actor AND x.created_at >= COALESCE(p_from, '-infinity') AND x.created_at < COALESCE(p_to, 'infinity') GROUP BY x.kind, x.model) g), '[]'::jsonb))
  FROM public.bae_gyeong_usage u
  WHERE u.user_id = actor AND u.created_at >= COALESCE(p_from, '-infinity') AND u.created_at < COALESCE(p_to, 'infinity'));
END $$;

DO $$ DECLARE role_name TEXT; BEGIN
 REVOKE ALL PRIVILEGES ON FUNCTION public.bae_gyeong_session_usage_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.bae_gyeong_session_usage_summary(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO %I', role_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
