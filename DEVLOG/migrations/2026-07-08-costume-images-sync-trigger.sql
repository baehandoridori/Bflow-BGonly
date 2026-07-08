-- 캐릭터 현황판 Tier 2 PR3 (코덱스 P1/P2): primary 이미지 → character_costumes.featured_* 동기화 트리거.
-- 앱이 featured_image_url 을 직접 쓰면 electron updateCharacterCostume 가 이전 featured 파일을 스토리지에서
-- 삭제하는데(단일 이미지 시절 동작), 다중 이미지 모델에선 이전 primary 도 여전히 유효한 이미지 행이라 파일이 깨진다.
-- → 앱의 featured 쓰기를 없애고, DB 트리거가 character_costume_images 변경 시 featured_* 를 동기화한다.
-- 트리거는 character_costumes 만 갱신하므로 electron 스토리지 정리 경로를 타지 않는다(파일 보존).
--
-- 이 파일이 sync_costume_featured_image 의 '최종' 정의다(파일명 정렬상 마지막 트리거 정의 파일).
--   코덱스 P2: 마이그레이션을 파일명 순서대로 적용해도 auto-promote 가 mirror-only 버전에 덮이지 않도록,
--   자동 승격 분기를 이 최종 파일에 직접 포함한다(별도 autopromote 파일로 분리하지 않음).
--
-- 자동 승격(코덱스 P2): 대표(primary) 이미지를 지웠는데 남은 이미지가 있으면 최소 sort_order 를 자동 대표로 승격한다.
--   삭제 트리거는 삭제와 같은 트랜잭션에서 실행되므로 "삭제 한 번"만으로 대표 유지가 원자적으로 보장된다
--   (앱이 삭제 후 별도 승격 쿼리를 보낼 필요 없음 → 2-step 경합 제거).
--   반드시 TG_OP='DELETE' 에서만 발동한다. set_primary RPC 의 clear(is_primary=false) UPDATE 순간에도
--   primary_count=0 이 되는데, 거기서 승격하면 RPC 대상과 대표가 둘이 되어 부분 유니크(23505)를 위반한다.
-- 재귀: 승격 UPDATE 가 트리거를 다시 부르지만(그때는 TG_OP='UPDATE'), 대표가 존재하므로 승격 분기를 건너뛰고
--   featured 미러링만 하고 끝난다. 추가 전용.

CREATE OR REPLACE FUNCTION sync_costume_featured_image() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_costume_id UUID := COALESCE(NEW.costume_id, OLD.costume_id);
  v_url TEXT;
  v_bg  TEXT;
  v_fit JSONB;
  v_primary_count INT;
  v_promote_id UUID;
BEGIN
  -- 대표가 하나도 없는데 남은 이미지가 있으면 최소 순서를 자동 승격(DELETE 에서만).
  SELECT count(*) FILTER (WHERE is_primary = true) INTO v_primary_count
    FROM character_costume_images WHERE costume_id = v_costume_id;
  IF TG_OP = 'DELETE' AND v_primary_count = 0 THEN
    SELECT id INTO v_promote_id
      FROM character_costume_images
     WHERE costume_id = v_costume_id
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 1;
    IF v_promote_id IS NOT NULL THEN
      -- 이 UPDATE 가 트리거를 재귀 호출 → 그때 대표가 존재해 아래 미러링 분기로 마무리되므로 여기서는 종료.
      UPDATE character_costume_images SET is_primary = true WHERE id = v_promote_id;
      RETURN NULL;
    END IF;
  END IF;

  -- 현재 대표 이미지 값(없으면 NULL).
  SELECT url, image_background, image_fit INTO v_url, v_bg, v_fit
    FROM character_costume_images
   WHERE costume_id = v_costume_id AND is_primary = true
   LIMIT 1;
  -- primary 없으면 featured=NULL, 실제로 바뀔 때만 갱신(불필요한 realtime 이벤트/재귀성 쓰기 방지).
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
