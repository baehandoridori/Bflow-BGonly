-- REPLICA IDENTITY FULL — Realtime UPDATE payload.old 보장
-- 작성일: 2026-05-05 (코덱스 10차 P1 fix)
-- 멱등 — 재실행 안전 (DEFAULT → FULL 전환은 idempotent)
--
-- 배경: Supabase Postgres Changes 의 UPDATE payload 는 기본적으로 `new` 만 보장하고
-- `old` 는 PK 만 들어옴. App.tsx 의 리비전 status 변경 알림이 `oldRow.status !==
-- newRow.status` 비교에 의존하므로 `old` 가 undefined 인 환경에서는 in_progress/
-- resolved 알림이 절대 발화되지 않음. REPLICA IDENTITY FULL 로 전체 row 를 payload
-- 에 포함시켜 정확한 비교 가능.
--
-- 댓글 테이블도 향후 status/edit 비교에 대비해 같이 설정.

ALTER TABLE comp_revisions REPLICA IDENTITY FULL;
ALTER TABLE comments REPLICA IDENTITY FULL;
