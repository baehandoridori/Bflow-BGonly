-- 2026-09-06: 사용자·캘린더 삭제 복구 (간트 정리 트리거를 SECURITY DEFINER 로)
--
-- 증상 (v1.112.0 운영에서 재현):
--   관리자 사용자 삭제와 캘린더 삭제가 모두 실패한다.
--     ERROR: 42501 permission denied for table gantt_spaces
--     CONTEXT: gantt_before_user_delete() / gantt_unlink_deleted_calendar()
--
-- 원인:
--   gantt_workspaces 가 users/calendars 에 붙인 정리 트리거 두 개는 SECURITY INVOKER 다.
--   간트 테이블은 gantt_security_containment 이후 anon 권한이 전부 회수돼 있고,
--   delete_user_authorized / delete_calendar_authorized 도 SECURITY INVOKER 라
--   트리거가 호출자(anon) 권한으로 실행되면서 간트 테이블 LOCK 에서 막힌다.
--   간트 테이블에 anon 권한이 있던 최초 버전에서는 드러나지 않았고,
--   차단 이후 삭제를 시도한 적이 없어 배포까지 통과했다.
--
-- 조치: 두 트리거 함수만 SECURITY DEFINER 로 바꾼다. 간트 테이블의 anon 차단은 그대로 유지한다.
--   안전한 이유:
--     - RETURNS trigger 라 PostgREST 가 RPC 로 노출하지 않고, anon EXECUTE 도 없다(아래에서 재확인).
--     - search_path 가 public, pg_temp 로 고정돼 있다.
--     - 이미 권한 검증을 통과한 삭제의 뒷정리만 하며, 입력은 OLD 행뿐이다.
-- 멱등: 반복 실행 안전.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER FUNCTION public.gantt_before_user_delete() SECURITY DEFINER;
ALTER FUNCTION public.gantt_unlink_deleted_calendar() SECURITY DEFINER;

-- 직접 호출 경로는 계속 막아 둔다(트리거로만 실행).
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_before_user_delete() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_unlink_deleted_calendar() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_before_user_delete() FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.gantt_unlink_deleted_calendar() FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.gantt_before_user_delete() IS
  '사용자 삭제 시 간트 폴더/프로젝트를 정리하는 트리거. 간트 테이블이 anon 에서 차단돼 있으므로 SECURITY DEFINER 로 실행한다.';
COMMENT ON FUNCTION public.gantt_unlink_deleted_calendar() IS
  '캘린더 삭제 시 연결된 간트 작업의 캘린더 연결을 해제하는 트리거. 같은 이유로 SECURITY DEFINER.';

NOTIFY pgrst, 'reload schema';
