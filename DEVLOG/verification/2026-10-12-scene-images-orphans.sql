-- scene-images 버킷의 주인 없는 파일 수 (읽기 전용 — 아무것도 바꾸지 않는다).
-- 먼저 DEVLOG/migrations/2026-10-12-scene-images-delete-policy.sql 이 적용돼 있어야 한다(판정 함수를 쓴다).
--
-- 언제 보나: 배포 점검 때, 또는 그림 삭제가 이상하다는 말이 나올 때.
--   앱은 지우지 못한 파일을 main 콘솔에만 남기고 배포본에는 파일 로그가 없다. 삭제가 다시 통째로 막혀도
--   (정책이 되돌려지거나 Storage 가 작업 이름을 바꾸는 경우) 팀 PC 에서는 아무 표시가 나지 않는다 — 이 숫자가 유일한 신호다.
-- 어떻게 읽나: '7일 넘은 주인 없는 파일'이 조금씩만 늘면 정상이다(남는 길은 AGENTS.md '저장소 그림 삭제 경계').
--   지운 만큼 그대로 늘고 있으면 삭제가 실패하고 있는 것이다.
--   기준값 2026-10-12(고치기 전): 전체 4,099개·407MB 중 주인 없는 것 1,152개·111MB.
-- 주의: 여기서 '주인 없음'은 DB 가 가리키지 않는다는 뜻이다. 리깅 공지에 붙여 보낸 그림(슬랙 #공지사항-작업 이
--   가리킨다)과 붙여 두고 아직 보내지 않은 그림도 여기에 세어진다 — 이 숫자만 보고 지우지 않는다.
with objects as (
  select
    o.name,
    coalesce((o.metadata->>'size')::bigint, 0) as size,
    o.created_at,
    storage_private.scene_image_is_referenced(o.name) as used,
    case
      when o.name ~ '^characters/[^/]+/comments/' then '캐릭터 댓글 첨부'
      when o.name ~ '^characters/[^/]+/[^/]+/[^/]+\.orig$' then '캐릭터 그림 원본(.orig)'
      when o.name ~ '^characters/' then '캐릭터 그림(화면용)'
      when o.name ~ '^backgrounds/' then '배경 라이브러리'
      when o.name ~ '^EP\d+/[A-Z]/(BG|ACT)/.+/storyboard_[^/]+$' then '씬 스토리보드'
      when o.name ~ '^EP\d+/[A-Z]/(BG|ACT)/.+/guide_[^/]+$' then '씬 가이드'
      when o.name ~ '^EP\d+/[A-Z]/(BG|ACT)/.+/comment_[^/]+$' then '씬 댓글 첨부'
      else '기타'
    end as kind
  from storage.objects o
  where o.bucket_id = 'scene-images'
)
select
  coalesce(kind, '합계') as 종류,
  count(*) as 전체,
  pg_size_pretty(sum(size)) as 전체_용량,
  count(*) filter (where not used) as 주인_없음,
  pg_size_pretty(coalesce(sum(size) filter (where not used), 0)) as 주인_없는_용량,
  count(*) filter (where not used and created_at < now() - interval '7 days') as 주인_없음_7일_넘음,
  to_char(max(created_at) filter (where not used), 'YYYY-MM-DD') as 가장_최근_주인_없는_파일
from objects
group by rollup (kind)
order by kind nulls last;
