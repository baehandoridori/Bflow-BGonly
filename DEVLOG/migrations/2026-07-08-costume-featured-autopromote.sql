-- 캐릭터 현황판 Tier 2 PR3 보강 (코덱스 P2): 대표(primary) 이미지 삭제 시 DB 가 자동 승격.
-- 문제: 대표 이미지 삭제 + 남은 이미지 승격이 앱에서 2단계(삭제 → set-primary)로 나뉘어 있어,
--   승격 쿼리가 실패하거나 그 사이 앱이 종료되면 "남은 이미지는 있는데 대표 없음(featured NULL)" 상태가 남아
--   카드/에피소드 화면이 이미지를 잃는다.
-- 해결: sync_costume_featured_image 트리거가 "대표가 하나도 없는데 남은 이미지가 있으면" 최소 sort_order 이미지를
--   자동으로 is_primary=true 로 승격한다. 삭제 트리거는 삭제와 같은 트랜잭션에서 실행되므로,
--   삭제 한 번만으로 대표 유지가 원자적으로 보장된다(앱의 별도 승격 쿼리 불필요 → 2-step 경합 제거).
-- 재귀: 승격 UPDATE 가 트리거를 다시 부르지만, 그때는 대표가 존재하므로 승격 분기를 건너뛰고 featured 미러링만 하고 끝난다.
-- 추가 전용 (CREATE OR REPLACE). 컬럼/테이블 삭제 없음.

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
  -- 대표가 하나도 없는데 남은 이미지가 있으면 최소 순서를 자동 승격(코덱스 P2 — 대표 삭제 후 featured 유실 방지).
  --   반드시 DELETE 에서만 발동한다. set_primary RPC 의 clear(is_primary=false) UPDATE 순간에도 primary_count=0 이 되는데,
  --   거기서 자동 승격하면 RPC 가 지정하려는 대상과 두 개의 대표가 생겨 부분 유니크(23505) 를 위반한다.
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
  -- 실제로 바뀔 때만 갱신(불필요한 realtime 이벤트/재귀성 쓰기 방지). 대표 없으면 featured=NULL.
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

-- 트리거 자체는 그대로(AFTER INSERT OR UPDATE OR DELETE). 함수만 교체.
