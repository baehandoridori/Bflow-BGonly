-- ============================================================
-- 캐릭터 현황판 '최근 수정순' 정렬 (v1.138.0) — 카드 순서만 바뀐 캐릭터는 수정 시각을 그대로 둔다
-- date: 2026-10-15
--
-- 왜: 카드 끌어 옮기기(F29)는 옮긴 카드와 그 사이 카드들의 sort_order 를 한꺼번에 다시 매긴다.
--   공용 set_updated_at() 트리거가 그때마다 updated_at = now() 로 바꿔, 순서만 바뀐 캐릭터들이
--   '방금 수정됨'으로 기록됐다(운영 DB 에 같은 초에 20장이 수정된 흔적 — 2026-07-22).
--   앱의 '최근 수정순' 정렬이 이 시각을 쓰므로, 순서만 바뀐 경우를 수정으로 치지 않는다.
--
-- 범위: characters 테이블의 updated_at 트리거만 전용 함수로 바꾼다. 공용 set_updated_at() 는 그대로.
--   - sort_order 만 바뀐 UPDATE → updated_at 을 이전 값 그대로 유지
--   - 그 밖의 UPDATE(다른 칸이 하나라도 바뀌거나, 아무것도 안 바뀐 UPDATE 포함) → 지금처럼 now()
--
-- 실시간 영향 없음: 앱의 낡은 응답 거르기는 '들어온 updated_at 이 가진 값보다 작을 때'만 버린다(같으면 받는다).
--   순서만 바뀐 응답은 updated_at 이 그대로라 그대로 반영된다. 앱은 updated_at 을 낙관적으로 바꾸지 않는다.
--
-- 되돌리기:
--   DROP TRIGGER IF EXISTS trg_characters_updated_at ON public.characters;
--   CREATE TRIGGER trg_characters_updated_at BEFORE UPDATE ON public.characters
--     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--   DROP FUNCTION IF EXISTS public.set_characters_updated_at();
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_characters_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sort_order IS DISTINCT FROM OLD.sort_order
     AND (to_jsonb(NEW) - 'sort_order' - 'updated_at') = (to_jsonb(OLD) - 'sort_order' - 'updated_at') THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_characters_updated_at ON public.characters;
CREATE TRIGGER trg_characters_updated_at
  BEFORE UPDATE ON public.characters
  FOR EACH ROW EXECUTE FUNCTION public.set_characters_updated_at();
