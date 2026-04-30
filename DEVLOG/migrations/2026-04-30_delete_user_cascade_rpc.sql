-- 사용자 삭제를 한 트랜잭션으로 묶는 RPC.
-- v1.15.13 / Codex P1 후속 (2026-04-30):
--   personal_todos / memos / task_views 의 user_id FK 가 NO ACTION 으로 걸려 있어
--   user 행 삭제 자체가 막히던 문제 + 부분 실패 시 비가역 데이터 손실 우려를
--   한 RPC 안에서 atomic 처리해 해결.
--
-- 함수 안의 모든 변경은 PostgreSQL 함수 실행의 implicit 트랜잭션에서 동작 — 어느 한 단계라도
-- 예외가 발생하면 전체 ROLLBACK. UI 가 "삭제 실패" 를 보고하는 동안 종속 데이터만 사라지는
-- partial-failure state 를 차단한다.
--
-- 적용: Supabase 콘솔의 SQL Editor 에 붙여넣어 실행하거나, supabase MCP 의 apply_migration
--       으로 적용. 이미 라이브 DB 에는 적용 완료(2026-04-30) — 이 파일은 기록/재현용.

CREATE OR REPLACE FUNCTION public.delete_user_cascade(p_user_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
BEGIN
  -- 1) user_name 조회 — assignee 매칭 키
  SELECT name INTO v_user_name FROM users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  -- 2) 담당자 비우기 (이름 기반, 기존 v1.15.7 정책 유지)
  UPDATE scenes         SET assignee = NULL WHERE assignee = v_user_name;
  UPDATE comp_revisions SET assignee = NULL WHERE assignee = v_user_name;

  -- 3) 개인 데이터 삭제 — FK 막힘 해제 + 한솔 요청에 따른 cleanup
  DELETE FROM personal_todos          WHERE user_id = p_user_id;
  DELETE FROM task_views              WHERE user_id = p_user_id;
  DELETE FROM memos                   WHERE user_id = p_user_id;
  DELETE FROM private_calendar_events WHERE user_id = p_user_id;

  -- 4) user 삭제. 위 단계 중 어디서든 실패하면 전체 ROLLBACK.
  --    comments / activity_log 의 user_id 는 역사 기록으로 의도적으로 보존.
  DELETE FROM users WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.delete_user_cascade(TEXT) IS
  '사용자 삭제 + 종속 정리 atomic RPC. assignee 비우기 / 개인 데이터(personal_todos·task_views·memos·private_calendar_events) 삭제 / users 삭제를 한 트랜잭션으로. comments·activity_log 는 역사 기록으로 보존.';
