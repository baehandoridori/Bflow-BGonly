-- 캐릭터 현황판 Tier 2 PR3 보강 (코덱스 P2): 대표 이미지 지정 원자화 RPC.
-- 앱이 'clear(is_primary=false) → set(is_primary=true)' 2쿼리로 하면, set 이 실패/0행일 때
-- 대표 없는 상태로 남아 트리거가 featured 를 비워 다른 클라이언트에 깨져 보인다.
-- → 한 함수(트랜잭션) 안에서 clear+set 을 처리하고, 대상 이미지가 없으면 예외로 롤백한다. 추가 전용.

CREATE OR REPLACE FUNCTION set_primary_costume_image(p_image_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_costume_id UUID;
BEGIN
  SELECT costume_id INTO v_costume_id FROM character_costume_images WHERE id = p_image_id;
  IF v_costume_id IS NULL THEN
    RAISE EXCEPTION 'costume image % not found', p_image_id;
  END IF;
  -- 부분 유니크(costume 당 primary 1개) 위반을 피하려 기존 primary 를 먼저 해제.
  UPDATE character_costume_images
     SET is_primary = false, updated_at = now()
   WHERE costume_id = v_costume_id AND is_primary = true AND id <> p_image_id;
  UPDATE character_costume_images
     SET is_primary = true, updated_at = now()
   WHERE id = p_image_id AND is_primary = false;
END; $$;
