-- 캐릭터 현황판 Tier 2 PR3 보강 (코덱스 P1/P2): primary 이미지 → character_costumes.featured_* 동기화 트리거.
-- 앱이 featured_image_url 을 직접 쓰면 electron updateCharacterCostume 가 이전 featured 파일을 스토리지에서
-- 삭제하는데(단일 이미지 시절 동작), 다중 이미지 모델에선 이전 primary 도 여전히 유효한 이미지 행이라 파일이 깨진다.
-- → 앱의 featured 쓰기를 없애고, DB 트리거가 character_costume_images 변경 시 featured_* 를 동기화한다.
-- 트리거는 character_costumes 만 갱신하므로 electron 스토리지 정리 경로를 타지 않는다(파일 보존). 추가 전용.

CREATE OR REPLACE FUNCTION sync_costume_featured_image() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_costume_id UUID := COALESCE(NEW.costume_id, OLD.costume_id);
  v_url TEXT;
  v_bg  TEXT;
  v_fit JSONB;
BEGIN
  -- 현재 primary 이미지 값(없으면 NULL).
  SELECT url, image_background, image_fit INTO v_url, v_bg, v_fit
    FROM character_costume_images
   WHERE costume_id = v_costume_id AND is_primary = true
   LIMIT 1;
  -- 실제로 바뀔 때만 갱신(불필요한 realtime 이벤트/재귀성 쓰기 방지). primary 없으면 featured=NULL.
  UPDATE character_costumes
     SET featured_image_url = v_url,
         image_background   = COALESCE(v_bg, image_background),
         image_fit          = COALESCE(v_fit, image_fit),
         updated_at         = now()
   WHERE id = v_costume_id
     AND (featured_image_url IS DISTINCT FROM v_url
          OR (v_bg IS NOT NULL AND image_background IS DISTINCT FROM v_bg)
          OR (v_fit IS NOT NULL AND image_fit IS DISTINCT FROM v_fit));
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_costume_featured_image ON character_costume_images;
CREATE TRIGGER trg_sync_costume_featured_image
AFTER INSERT OR UPDATE OR DELETE ON character_costume_images
FOR EACH ROW EXECUTE FUNCTION sync_costume_featured_image();
