-- 캐릭터 현황판 Tier 2 PR3: 복장 다중 이미지 (A5 디자인+최종 2슬롯 + B12 복장당 여러 이미지 통합)
-- 한 복장이 여러 이미지를 갖고, 각 이미지에 역할(design/final/variant) 라벨 + primary 1개 + 순서.
-- 기존 character_costumes.featured_image_url/image_background/image_fit 는 그대로 두고(추가 전용),
-- 앱(store)이 primary 이미지 값을 그 컬럼들에 반영해 기존 소비처(카드/썸네일/라이트박스/에피소드에셋/나의할일)를
-- 무변경으로 유지한다. (DB 트리거/RPC 없이 앱에서 동기화 — 프로덕션 DB 단순화·검토 용이.)
-- 추가 전용(DROP 없음). 라이브 DB(mpqifkpxalwxgcrddchv) 에 코드 PR 머지 전 먼저 적용.

CREATE TABLE IF NOT EXISTS character_costume_images (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  costume_id       UUID NOT NULL REFERENCES character_costumes(id) ON DELETE CASCADE,
  url              TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'design' CHECK (role IN ('design', 'final', 'variant')),
  label            TEXT,
  image_background TEXT NOT NULL DEFAULT 'transparent'
                     CHECK (image_background IN ('transparent','black','white','checker')),
  image_fit        JSONB NOT NULL DEFAULT '{"scale":1,"scaleX":1,"scaleY":1,"x":0,"y":0,"lockAspect":true}'::jsonb,
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_costume_images_costume ON character_costume_images(costume_id, sort_order);
-- 복장당 primary 는 최대 1개 — DB 레벨 보장(부분 유니크). 앱은 '기존 primary 해제 → 신규 설정' 순서로 갱신.
CREATE UNIQUE INDEX IF NOT EXISTS uq_costume_images_primary
  ON character_costume_images (costume_id) WHERE is_primary;

DROP TRIGGER IF EXISTS trg_costume_images_updated_at ON character_costume_images;
CREATE TRIGGER trg_costume_images_updated_at
  BEFORE UPDATE ON character_costume_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1회성 백필: 기존 featured_image_url 을 role='design', is_primary=true 이미지 행으로 이관(데이터 손실 0).
INSERT INTO character_costume_images (costume_id, url, role, is_primary, sort_order, image_background, image_fit, created_at)
SELECT id, featured_image_url, 'design', true, 0, image_background, image_fit, created_at
FROM character_costumes
WHERE featured_image_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM character_costume_images i WHERE i.costume_id = character_costumes.id);

ALTER TABLE character_costume_images ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='character_costume_images' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON character_costume_images FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='character_costume_images') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE character_costume_images;
  END IF;
END $$;
