-- Background library maps: stairs symbol, road spaces and camera colours.
-- Prerequisites: 2026-09-21-background-library.sql, then 2026-10-07-background-map-3d.sql. Apply this file
-- after both, and before the app version that writes these shapes (v1.133.0): app first means every save
-- that carries one of them fails with 22023.
-- Chain: base -> 3D -> this file. All three replace public.background_library_validate_entity, each with a
-- wider one, so the file that ran last decides what the server accepts.
-- Re-run this file after every run of either of them, not only after the first one. The base file puts back
-- the plan-only validator and the 3D file the validator without the additions below. Stored maps stay
-- readable and nothing is lost, but each write re-checks every map that is still stored, so one stored
-- stair, road or camera colour makes every write that leaves that map stored fail with 22023 (in practice
-- every edit) until this file is applied again. A write that deletes that map, or saves it without those
-- nodes, would pass: do not get round the error that way (a deleted map cannot be brought back), apply
-- the chain again. While no such map is stored yet, only saves that carry one of these shapes fail.
-- After a run of the base file, run the 3D file first: this file refuses to run on the base validator.
--
-- Replaces public.background_library_validate_entity and nothing else. The body is the 3D body with three
-- additions; tests/backgroundDatabaseContract.test.ts fails if they drift apart.
--   symbol: kind 'stairs' joins the closed list
--   space : optional surface, one of ('road'); omitted = a room
--   camera: optional color, one of ('red','lime','green','teal','blue','pink'); omitted = the amber it was
-- `spatial` now also lists these two optional keys; the name is kept so every other line stays the 3D line.
-- The lists mirror BACKGROUND_SYMBOL_KINDS, BACKGROUND_SPACE_SURFACES and BACKGROUND_CAMERA_COLORS in
-- src/features/backgrounds/domain.ts.
-- Both keys are optional. A map saved without them stays valid and is stored without them: the server
-- validates and never fills in or rewrites a value, because lost-reply recovery compares the complete
-- submitted map with the stored one. No stored row is touched by this file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $$ DECLARE body TEXT; BEGIN
 IF to_regprocedure('public.background_library_validate_entity(text,jsonb)') IS NULL THEN
  RAISE EXCEPTION '2026-09-21-background-library.sql 을 먼저 적용해야 합니다.' USING ERRCODE='55000';
 END IF;
 SELECT p.prosrc INTO body FROM pg_proc p WHERE p.oid='public.background_library_validate_entity(text,jsonb)'::regprocedure;
 IF position('n-spatial' IN body)=0 THEN
  RAISE EXCEPTION '2026-10-07-background-map-3d.sql 을 먼저 적용해야 합니다.' USING ERRCODE='55000';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.background_library_validate_entity(kind TEXT, v JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE n JSONB; variant JSONB; image JSONB; point JSONB; keys TEXT[]; spatial TEXT[];
BEGIN
 keys:=CASE kind
  WHEN 'place' THEN ARRAY['id','revision','name','parentId','folderPath']
  WHEN 'map' THEN ARRAY['id','revision','name','parentId','placeId','imageUrl','nodes']
  WHEN 'view' THEN ARRAY['id','revision','name','placeId','cameraPlaceId','visiblePlaceIds','relatedPlaceIds','shot','tags','memo','variants']
  WHEN 'group' THEN ARRAY['id','revision','name','placeId','variantIds']
  WHEN 'usage' THEN ARRAY['id','revision','episodeNumber','placeId','variantIds','memo'] END;
 PERFORM public.background_library_require(keys IS NOT NULL AND public.background_library_object(v,keys),'배경 항목의 필드가 올바르지 않습니다.');
 PERFORM public.background_library_require(public.background_library_uuid(v->'id') AND public.background_library_number(v->'revision',0,9007199254740990,true),'배경 식별자 또는 버전이 올바르지 않습니다.');
 IF kind<>'usage' THEN PERFORM public.background_library_require(public.background_library_text(v->'name',1,160),'배경 이름은 1~160자여야 합니다.'); END IF;
 IF kind IN ('place','map') THEN PERFORM public.background_library_require(public.background_library_uuid(v->'parentId',true),'상위 항목이 올바르지 않습니다.'); END IF;
 IF kind IN ('view','group','usage','map') THEN PERFORM public.background_library_require(public.background_library_uuid(v->'placeId',kind='map'),'장소가 올바르지 않습니다.'); END IF;
 IF kind IN ('view','usage') THEN PERFORM public.background_library_require(public.background_library_text(v->'memo',0,10000),'메모는 10000자 이하여야 합니다.'); END IF;
 IF kind='place' THEN
  PERFORM public.background_library_require(public.background_library_text(v->'folderPath',0,4096),'폴더 경로가 올바르지 않습니다.');
 ELSIF kind='map' THEN
  PERFORM public.background_library_require(public.background_library_image(v->'imageUrl') AND public.background_library_array(v->'nodes',0,1000),'도면 이미지 또는 공간 목록이 올바르지 않습니다.');
  FOR n IN SELECT * FROM jsonb_array_elements(v->'nodes') LOOP
   keys:=CASE n->>'type'
    WHEN 'space' THEN ARRAY['id','type','name','placeId','childMapId','x','y','width','height','rotation','shape','points','locked']
    WHEN 'camera' THEN ARRAY['id','type','name','spaceId','x','y','angle','fov','viewIds','locked']
    WHEN 'symbol' THEN ARRAY['id','type','name','symbol','spaceId','x','y','width','height','rotation','locked','hinge','swing'] END;
   spatial:=CASE n->>'type'
    WHEN 'space' THEN ARRAY['elevation','volumeHeight','surface']
    WHEN 'camera' THEN ARRAY['elevation','pitch','roll','aspect','color']
    WHEN 'symbol' THEN ARRAY['elevation','volumeHeight','pitch','roll'] END;
   PERFORM public.background_library_require(keys IS NOT NULL AND public.background_library_object(n-spatial,keys) AND public.background_library_uuid(n->'id') AND public.background_library_text(n->'name',1,160),'도면 배치 항목이 올바르지 않습니다.');
   PERFORM public.background_library_require(public.background_library_number(n->'x',-100000,100000) AND public.background_library_number(n->'y',-100000,100000) AND jsonb_typeof(n->'locked')='boolean','도면 위치 또는 잠금 값이 올바르지 않습니다.');
   IF n->>'type'='space' THEN
    PERFORM public.background_library_require(public.background_library_uuid(n->'placeId',true) AND public.background_library_uuid(n->'childMapId',true),'공간의 장소 또는 상세 도면이 올바르지 않습니다.');
    PERFORM public.background_library_require(public.background_library_number(n->'width',10,100000) AND public.background_library_number(n->'height',10,100000) AND public.background_library_number(n->'rotation',-360,360),'공간 크기 또는 회전이 올바르지 않습니다.');
    PERFORM public.background_library_require((NOT (n ? 'elevation') OR public.background_library_number(n->'elevation',-100000,100000)) AND (NOT (n ? 'volumeHeight') OR public.background_library_number(n->'volumeHeight',1,100000)),'공간의 바닥 높이 또는 입체 높이가 올바르지 않습니다.');
    PERFORM public.background_library_require(NOT (n ? 'surface') OR n->>'surface' IN ('road'),'공간 종류가 올바르지 않습니다.');
    PERFORM public.background_library_require(n->>'shape' IN ('rect','ellipse','polygon') AND public.background_library_array(n->'points',CASE WHEN n->>'shape'='polygon' THEN 3 ELSE 0 END,200),'공간 모양이 올바르지 않습니다.');
    FOR point IN SELECT * FROM jsonb_array_elements(n->'points') LOOP
     PERFORM public.background_library_require(public.background_library_object(point,ARRAY['x','y']) AND public.background_library_number(point->'x',0,1) AND public.background_library_number(point->'y',0,1),'다각형 좌표가 올바르지 않습니다.');
    END LOOP;
   ELSIF n->>'type'='camera' THEN
    PERFORM public.background_library_require(public.background_library_uuid(n->'spaceId',true) AND public.background_library_number(n->'angle',-360,360) AND public.background_library_number(n->'fov',1,179) AND public.background_library_ids(n->'viewIds'),'카메라 정보가 올바르지 않습니다.');
    PERFORM public.background_library_require((NOT (n ? 'elevation') OR public.background_library_number(n->'elevation',-100000,100000)) AND (NOT (n ? 'pitch') OR public.background_library_number(n->'pitch',-90,90)) AND (NOT (n ? 'roll') OR public.background_library_number(n->'roll',-180,180)) AND (NOT (n ? 'aspect') OR public.background_library_number(n->'aspect',0.1,10)),'카메라 높이, 위아래 각도, 기울기 또는 화면 비율이 올바르지 않습니다.');
    PERFORM public.background_library_require(NOT (n ? 'color') OR n->>'color' IN ('red','lime','green','teal','blue','pink'),'카메라 색이 올바르지 않습니다.');
   ELSE
    PERFORM public.background_library_require(public.background_library_uuid(n->'spaceId',true) AND n->>'symbol' IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom','stairs'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');
    PERFORM public.background_library_require(public.background_library_number(n->'width',10,100000) AND public.background_library_number(n->'height',10,100000) AND public.background_library_number(n->'rotation',-360,360),'기호 크기 또는 회전이 올바르지 않습니다.');
    PERFORM public.background_library_require(n->>'hinge' IN ('left','right') AND n->>'swing' IN ('inward','outward'),'문 경첩 또는 열림 방향이 올바르지 않습니다.');
    PERFORM public.background_library_require((NOT (n ? 'elevation') OR public.background_library_number(n->'elevation',-100000,100000)) AND (NOT (n ? 'volumeHeight') OR public.background_library_number(n->'volumeHeight',1,100000)) AND (NOT (n ? 'pitch') OR public.background_library_number(n->'pitch',-90,90)) AND (NOT (n ? 'roll') OR public.background_library_number(n->'roll',-180,180)),'사물의 바닥 높이, 입체 높이, 위아래 각도 또는 기울기가 올바르지 않습니다.');
   END IF;
  END LOOP;
  PERFORM public.background_library_require((SELECT count(*)=count(DISTINCT node_item->>'id') FROM jsonb_array_elements(v->'nodes') node_item),'도면 배치 식별자가 중복됩니다.');
 ELSIF kind='view' THEN
  PERFORM public.background_library_require(public.background_library_uuid(v->'cameraPlaceId',true) AND public.background_library_ids(v->'visiblePlaceIds') AND public.background_library_ids(v->'relatedPlaceIds'),'배경 장소 목록이 올바르지 않습니다.');
  PERFORM public.background_library_require(v->>'shot' IN ('wide','medium','closeup','detail') AND public.background_library_array(v->'tags',0,100),'배경 분류가 올바르지 않습니다.');
  PERFORM public.background_library_require(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'tags') x WHERE NOT public.background_library_text(x,1,80)),'배경 태그가 올바르지 않습니다.');
  PERFORM public.background_library_require(public.background_library_array(v->'variants',1,100),'배경에는 1~100개의 변형이 필요합니다.');
  FOR variant IN SELECT * FROM jsonb_array_elements(v->'variants') LOOP
   PERFORM public.background_library_require(public.background_library_object(variant-'workFilePath',ARRAY['id','name','time','revisions','activeRevisionId']) AND public.background_library_uuid(variant->'id') AND public.background_library_text(variant->'name',1,160) AND variant->>'time' IN ('day','night','other'),'배경 변형이 올바르지 않습니다.');
   PERFORM public.background_library_require(NOT (variant ? 'workFilePath') OR public.background_library_text(variant->'workFilePath',0,4096),'작업파일 경로가 올바르지 않습니다.');
   PERFORM public.background_library_require(public.background_library_array(variant->'revisions',1,100) AND public.background_library_uuid(variant->'activeRevisionId'),'이미지 수정본이 올바르지 않습니다.');
   FOR image IN SELECT * FROM jsonb_array_elements(variant->'revisions') LOOP
    PERFORM public.background_library_require(public.background_library_object(image-'sourceImagePath',ARRAY['id','imageUrl','filePath','createdAt']) AND public.background_library_uuid(image->'id') AND public.background_library_image(image->'imageUrl') AND public.background_library_text(image->'filePath',0,4096) AND public.background_library_text(image->'createdAt',1,64),'이미지 수정본 정보가 올바르지 않습니다.');
    PERFORM public.background_library_require(NOT (image ? 'sourceImagePath') OR public.background_library_text(image->'sourceImagePath',0,4096),'이미지파일 경로가 올바르지 않습니다.');
    BEGIN
     PERFORM public.background_library_require(isfinite((image->>'createdAt')::timestamptz),'수정본 날짜가 올바르지 않습니다.');
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '수정본 날짜가 올바르지 않습니다.' USING ERRCODE='22023'; END;
   END LOOP;
   PERFORM public.background_library_require((SELECT count(*)=count(DISTINCT revision_item->>'id') FROM jsonb_array_elements(variant->'revisions') revision_item) AND EXISTS(SELECT 1 FROM jsonb_array_elements(variant->'revisions') revision_item WHERE revision_item->>'id'=variant->>'activeRevisionId'),'현재 이미지가 없거나 수정본 식별자가 중복됩니다.');
  END LOOP;
 ELSE
  PERFORM public.background_library_require(public.background_library_ids(v->'variantIds',10000),'선택한 배경 변형이 올바르지 않습니다.');
  IF kind='usage' THEN
   PERFORM public.background_library_require(public.background_library_number(v->'episodeNumber',1,2147483647,true),'에피소드 번호가 올바르지 않습니다.');
  END IF;
 END IF;
END $$;

-- CREATE OR REPLACE keeps the existing grants; repeat the base lockdown so a rerun also repairs drift.
DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',fn,role_name);
   END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.background_library_read(text),public.background_library_execute(text,text,jsonb) TO %I',role_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
