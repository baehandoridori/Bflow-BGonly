-- 2026-06-22: 리테이크 허브 '전반'(씬 미지정) 항목 지원 — comp_revisions.part_id nullable.
--
-- 배경: 5단계 마이그레이션(2026-06-17-retake-hub.sql)이 scene_id 만 nullable 로 풀고
--       part_id 를 빠뜨렸다. 그 결과 part_id=null 인 '전반' 항목 INSERT 가
--       NOT NULL 제약(SQLSTATE 23502)으로 무조건 실패한다.
-- 전반 항목은 특정 파트/씬에 안 매이고 set_id(comp_revision_sets) 로만 묶이므로
-- part_id 가 null 이어야 한다. (씬-바운드 항목은 기존처럼 part_id 채움 — 영향 없음.)
--
-- 멱등: 이미 nullable 이면 no-op(Postgres DROP NOT NULL 은 재실행 안전).
ALTER TABLE comp_revisions ALTER COLUMN part_id DROP NOT NULL;
