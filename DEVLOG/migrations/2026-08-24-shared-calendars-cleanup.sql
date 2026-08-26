-- 2026-08-24 공유 캘린더 라운드 마감 정리 (PR4)
-- 구글 팀 캘린더(teamCalendarId) 잔재 제거 — 팀 공유는 B flow 캘린더가 담당 (설계서 §9).
-- 구버전 앱은 이 행이 없으면 primary 만 동기화하므로 삭제해도 안전.
DELETE FROM metadata WHERE type = 'gcal' AND key = 'teamCalendarId';
