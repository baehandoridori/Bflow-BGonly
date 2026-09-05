-- Emergency containment: deny public Gantt data and RPC access until server authentication is deployed.
-- Does not delete data or grant elevated privileges to existing triggers.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
REVOKE ALL PRIVILEGES ON TABLE public.gantt_spaces, public.gantt_projects, public.gantt_requests FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_spaces;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_projects;
DROP POLICY IF EXISTS gantt_app_access ON public.gantt_requests;
DO $containment$
DECLARE f RECORD; t TEXT;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'gantt\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['gantt_spaces','gantt_projects','gantt_requests'] LOOP
    IF EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',t);
    END IF;
  END LOOP;
END $containment$;
NOTIFY pgrst, 'reload schema';
