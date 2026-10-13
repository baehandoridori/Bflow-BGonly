-- 2026-10-12 v1.134.3 — scene-images 버킷: 그림 삭제가 실제로 되게 + 아직 쓰이는 그림은 지워지지 않게
-- 운영 적용: 2026-10-13 에 20261013143155 (scene_images_delete_policy) 로 적용. 함수 본문 md5 대조 일치.
--   적용 뒤 실제 Storage 서버에서 anon 키로 확인: 나열은 빈 목록 / DB 가 가리키는 시험용 파일은 remove() 가 빈 목록이고
--   파일이 남음 / 가리키던 행을 지우자 같은 파일이 지워짐 / REST 로 storage_private 호출은 406(스키마 비노출).
--   2026-10-12 에 남았던 탐침 파일 2개도 이때 지웠다.
--
-- 무엇이 문제였나
--   storage.objects 에 anon 정책이 INSERT·DELETE 둘뿐이고 SELECT 가 없었다. Postgres 는 DELETE 의 WHERE 를
--   SELECT 로 보이는 행에만 적용하므로, 앱(anon 키)의 remove() 는 오류 없이 빈 목록을 돌려주고 하나도 지우지
--   못했다. 2026-04-17(버킷 생성)부터 반년 동안 그랬고, 주인 없는 파일이 1,152개·111MB 쌓였다.
--
-- 무엇을 바꾸나 (있던 정책 둘은 건드리지 않고 정책 둘을 더한다)
--   1) 읽기 정책을 '지우는 작업'에만 연다. 작업 종류를 가리지 않는 읽기 정책을 주면 anon 이 버킷의 파일 이름을
--      전부 나열할 수 있게 된다(공개 버킷이라도 주소는 추측할 수 없는 이름이 지키고 있다).
--      작업 이름은 Storage 서버가 요청마다 정해 주는 값이다: remove() = object.delete_many, 낱개 = object.delete.
--   2) DB 가 아직 가리키는 그림은 지울 수 없게 한다. 삭제가 반년 동안 한 번도 실제로 된 적이 없어서, 앱의
--      '지우기' 호출 가운데 아직 쓰이는 그림을 지우려는 것이 있어도 드러나지 않았다(예: 씬에서 그림을 빼도
--      그림 버전 기록은 그 주소를 계속 쓴다 — 운영에 2건). 정책은 이미 배포된 옛 버전 앱에도 바로 적용되므로
--      앱이 아니라 서버가 막는다. 제한(RESTRICTIVE) 정책이라 나중에 삭제 정책이 하나 더 생겨도 풀리지 않는다.
--      실수를 막는 장치이지 보안 경계는 아니다: 주소가 적힌 표는 anon 이 고칠 수 있어, 기록을 먼저 지우면 그림도 지울 수 있다.
--
-- 그림 주소를 적는 열이 새로 생기면 storage_private.scene_image_is_referenced 에 반드시 넣는다
-- (tests/storageRemove.test.ts 가 목록을 고정한다). 빠진 열의 그림은 '주인 없음'으로 보여 지워질 수 있다.
-- 거꾸로, 이 함수가 읽는 표·열의 이름을 바꾸거나 없애면 삭제가 전부 오류로 막힌다 — 함수를 함께 고친다.
--
-- SQL 로 storage.objects 의 행을 직접 지우지 말 것: 기록만 사라지고 실제 파일은 남아 요금이 계속 나간다
-- (Storage 가 protect_objects_delete 트리거로 막고 있다). 그래서 '삭제 전용 SQL 함수'로는 고칠 수 없다.
--
-- 되돌리기 (삭제가 다시 조용히 실패하는 상태로 돌아간다):
--   BEGIN;
--   DROP POLICY IF EXISTS scene_images_delete_only_unreferenced ON storage.objects;
--   DROP POLICY IF EXISTS scene_images_anon_select_for_delete ON storage.objects;
--   DROP FUNCTION IF EXISTS storage_private.scene_image_is_referenced(text);
--   DROP SCHEMA IF EXISTS storage_private;
--   COMMIT;
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

-- API 로 내놓지 않는 스키마 — 정책은 요청한 역할의 권한으로 함수를 부르므로 그 역할에 사용(USAGE)만 허용한다.
-- public 에 두면 누구나 RPC 로 불러, 잠가 둔 표(background_library_entities)에 어떤 주소가 있는지 떠볼 수 있다.
CREATE SCHEMA IF NOT EXISTS storage_private;
REVOKE ALL ON SCHEMA storage_private FROM PUBLIC;
GRANT USAGE ON SCHEMA storage_private TO anon, authenticated;

-- 이 파일(버킷 안 경로)을 DB 가 아직 가리키는가.
--   · 주소 끝에 꼬리표(?…)가 붙어도 놓치지 않도록 '포함'으로 본다 — 틀려도 '쓰이는 중'으로 틀려서 지우지 않는 쪽이다.
--   · 이름에 공백이 있으면 주소에는 %20 으로 적힌다(공개 주소를 만들 때 바뀌는 글자는 공백뿐이다) — 두 모양을 다 찾는다.
--   · anon 이 읽지 못하는 표(background_library_entities)만은 이름이 끝까지 맞을 때만 쓰이는 것으로 본다.
--     '포함'으로 보면 이름을 한 글자씩 늘려 올리고 지워 보는 것으로 그 표의 주소를 알아낼 수 있다.
CREATE OR REPLACE FUNCTION storage_private.scene_image_is_referenced(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH names(name) AS (
    SELECT p_name
    UNION ALL
    -- 캐릭터 그림의 원본(.orig)은 주소가 DB 에 없다. 같은 자리의 화면용 그림(png/jpg)이 쓰이면 원본도 쓰이는 것이다
    -- (규칙: src/shared/characterImageOriginal.ts).
    SELECT m.parts[1] || ext
    FROM regexp_match(p_name, '^(characters/[^/]+/[^/]+/[^/.]+)\.orig$') AS m(parts), unnest(ARRAY['.png', '.jpg']) AS ext
    WHERE m.parts IS NOT NULL
  ),
  needles(needle) AS (
    SELECT '/scene-images/' || name FROM names
    UNION
    SELECT '/scene-images/' || replace(name, ' ', '%20') FROM names
  )
  SELECT EXISTS (
    SELECT 1 FROM needles n
    WHERE EXISTS (SELECT 1 FROM public.scenes s WHERE strpos(s.storyboard_url, n.needle) > 0 OR strpos(s.guide_url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.scene_image_versions v WHERE strpos(v.url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.comments c WHERE strpos(c.images::text, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.comp_revisions r WHERE strpos(r.image_url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.comp_revisions_archive a WHERE strpos(a.image_url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.character_costume_images i WHERE strpos(i.url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.character_costumes k WHERE strpos(k.featured_image_url, n.needle) > 0)
       OR EXISTS (SELECT 1 FROM public.background_library_entities b WHERE strpos(b.value::text, n.needle || '"') > 0 OR strpos(b.value::text, n.needle || '?') > 0)
  );
$function$;
REVOKE ALL ON FUNCTION storage_private.scene_image_is_referenced(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage_private.scene_image_is_referenced(text) TO anon, authenticated;

-- 1) 지우는 작업에서만 행이 보인다. 나열(object.list)·내려받기 같은 다른 작업에서는 전과 같이 아무것도 보이지 않는다.
DROP POLICY IF EXISTS scene_images_anon_select_for_delete ON storage.objects;
CREATE POLICY scene_images_anon_select_for_delete ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'scene-images'
    AND (SELECT storage.allow_any_operation(ARRAY['object.delete', 'object.delete_many']))
  );

-- 2) 아직 쓰이는 그림은 지울 수 없다. 허용 정책(scene_images_anon_delete)에 조건을 붙이지 않고 제한 정책으로 따로 둔다 —
--    허용 정책끼리는 OR 로 묶여서, 삭제 허용 정책이 하나 더 생기면 조건이 풀린다. 제한 정책은 언제나 AND 로 걸린다.
DROP POLICY IF EXISTS scene_images_delete_only_unreferenced ON storage.objects;
CREATE POLICY scene_images_delete_only_unreferenced ON storage.objects
  AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (bucket_id <> 'scene-images' OR NOT storage_private.scene_image_is_referenced(name));

COMMIT;

-- 적용 뒤 확인 (읽기 전용)
--   select policyname, permissive, cmd, roles, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
--     → scene_images_anon_delete(PERMISSIVE DELETE, 버킷만 — 전과 같음. anon 삭제 허용 정책은 이것 하나여야 한다)
--       scene_images_anon_insert(PERMISSIVE INSERT — 전과 같음)
--       scene_images_anon_select_for_delete(PERMISSIVE SELECT, 지우는 작업만)
--       scene_images_delete_only_unreferenced(RESTRICTIVE DELETE, 쓰이는 그림 제외)
--   select storage_private.scene_image_is_referenced(substring(storyboard_url from 'scene-images/(.+)$')) from public.scenes where storyboard_url like '%scene-images/%' limit 1;  → true
--   select storage_private.scene_image_is_referenced('characters/__probe_1791799949229__/probe/1791799949229_probe.png');  → false
-- 적용 뒤 확인 (앱과 같은 anon 키로)
--   list() 는 여전히 빈 목록 / 쓰이는 그림의 remove() 는 빈 목록이고 파일이 남는다 /
--   주인 없는 파일의 remove() 는 그 이름을 돌려주고 공개 주소가 열리지 않게 된다(중간 보관 때문에 잠깐은 열릴 수 있다) /
--   REST 로 storage_private 의 함수를 부르면 거절된다(스키마를 API 로 내놓지 않았는지).
