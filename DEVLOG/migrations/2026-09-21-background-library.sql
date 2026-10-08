-- Background library: one CAS-protected entity per row, server sessions, no direct Data API access.
-- Prerequisites: public.users, public.episodes, public.app_session_user_id(text).
-- Apply separately from the application release. This file never seeds production demo data.
-- Applied to production on 2026-10-08 as 20261008035103 (background_library).
-- Follow-up: 2026-10-07-background-map-3d.sql widens background_library_validate_entity for the
-- vertical-axis map fields. This file restores the narrower validator, so after EVERY run of this
-- file run the 3D file again; until then saves that touch a map carrying those fields are rejected.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE TABLE IF NOT EXISTS public.background_library_entities (
  kind TEXT NOT NULL CHECK (kind IN ('place','map','view','group','usage')),
  id UUID NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  value JSONB NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  deleted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind,id)
);
CREATE TABLE IF NOT EXISTS public.background_library_receipts (
  actor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  command JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,request_id)
);
CREATE INDEX IF NOT EXISTS background_library_live_kind_idx ON public.background_library_entities(kind) WHERE deleted_at IS NULL;
ALTER TABLE public.background_library_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.background_library_receipts ENABLE ROW LEVEL SECURITY;

-- All helpers are internal. Explicit revocation below also handles project default privileges.
CREATE OR REPLACE FUNCTION public.background_library_require(ok BOOLEAN, message TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message USING ERRCODE='22023'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.background_library_object(v JSONB, keys TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN v ?& keys AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE NOT k=ANY(keys)) ELSE false END
$$;
CREATE OR REPLACE FUNCTION public.background_library_text(v JSONB, min_length INTEGER, max_length INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN min_length AND max_length AND (min_length=0 OR length(btrim(v#>>'{}'))>0),false)
$$;
CREATE OR REPLACE FUNCTION public.background_library_uuid(v JSONB, nullable BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT COALESCE((nullable AND v='null'::jsonb) OR (jsonb_typeof(v)='string' AND (v#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),false)
$$;
CREATE OR REPLACE FUNCTION public.background_library_number(v JSONB, lo NUMERIC, hi NUMERIC, whole BOOLEAN DEFAULT false)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(v)='number' THEN (v#>>'{}')::numeric BETWEEN lo AND hi AND (NOT whole OR trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric) ELSE false END
$$;
CREATE OR REPLACE FUNCTION public.background_library_array(v JSONB, lo INTEGER, hi INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(v)='array' THEN jsonb_array_length(v) BETWEEN lo AND hi ELSE false END
$$;
CREATE OR REPLACE FUNCTION public.background_library_ids(v JSONB, max_items INTEGER DEFAULT 1000)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT public.background_library_array(v,0,max_items) THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE NOT public.background_library_uuid(x))
  AND (SELECT count(*)=count(DISTINCT x) FROM jsonb_array_elements(v) x);
END $$;
CREATE OR REPLACE FUNCTION public.background_library_image(v JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT public.background_library_text(v,0,2000000) AND ((v#>>'{}')='' OR (v#>>'{}') ~ '^https://[^[:space:]]+$' OR (v#>>'{}') ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')
$$;

CREATE OR REPLACE FUNCTION public.background_library_validate_entity(kind TEXT, v JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE n JSONB; variant JSONB; image JSONB; point JSONB; keys TEXT[];
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
   PERFORM public.background_library_require(keys IS NOT NULL AND public.background_library_object(n,keys) AND public.background_library_uuid(n->'id') AND public.background_library_text(n->'name',1,160),'도면 배치 항목이 올바르지 않습니다.');
   PERFORM public.background_library_require(public.background_library_number(n->'x',-100000,100000) AND public.background_library_number(n->'y',-100000,100000) AND jsonb_typeof(n->'locked')='boolean','도면 위치 또는 잠금 값이 올바르지 않습니다.');
   IF n->>'type'='space' THEN
    PERFORM public.background_library_require(public.background_library_uuid(n->'placeId',true) AND public.background_library_uuid(n->'childMapId',true),'공간의 장소 또는 상세 도면이 올바르지 않습니다.');
    PERFORM public.background_library_require(public.background_library_number(n->'width',10,100000) AND public.background_library_number(n->'height',10,100000) AND public.background_library_number(n->'rotation',-360,360),'공간 크기 또는 회전이 올바르지 않습니다.');
    PERFORM public.background_library_require(n->>'shape' IN ('rect','ellipse','polygon') AND public.background_library_array(n->'points',CASE WHEN n->>'shape'='polygon' THEN 3 ELSE 0 END,200),'공간 모양이 올바르지 않습니다.');
    FOR point IN SELECT * FROM jsonb_array_elements(n->'points') LOOP
     PERFORM public.background_library_require(public.background_library_object(point,ARRAY['x','y']) AND public.background_library_number(point->'x',0,1) AND public.background_library_number(point->'y',0,1),'다각형 좌표가 올바르지 않습니다.');
    END LOOP;
   ELSIF n->>'type'='camera' THEN
    PERFORM public.background_library_require(public.background_library_uuid(n->'spaceId',true) AND public.background_library_number(n->'angle',-360,360) AND public.background_library_number(n->'fov',1,179) AND public.background_library_ids(n->'viewIds'),'카메라 정보가 올바르지 않습니다.');
   ELSE
    PERFORM public.background_library_require(public.background_library_uuid(n->'spaceId',true) AND n->>'symbol' IN ('door','desk','chair','table','sofa','bed','cabinet','plant','custom'),'사물 기호 또는 연결 공간이 올바르지 않습니다.');
    PERFORM public.background_library_require(public.background_library_number(n->'width',10,100000) AND public.background_library_number(n->'height',10,100000) AND public.background_library_number(n->'rotation',-360,360),'기호 크기 또는 회전이 올바르지 않습니다.');
    PERFORM public.background_library_require(n->>'hinge' IN ('left','right') AND n->>'swing' IN ('inward','outward'),'문 경첩 또는 열림 방향이 올바르지 않습니다.');
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

-- Cross-entity validation runs in the same serialized transaction as each individual CAS mutation.
-- This prevents a concurrent deletion from racing a newly created reference.
CREATE OR REPLACE FUNCTION public.background_library_validate()
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE row RECORD; n JSONB; ref JSONB; parent TEXT; visited TEXT[]; item_id TEXT; selected TEXT; home TEXT;
BEGIN
 PERFORM public.background_library_require(NOT EXISTS(SELECT kind FROM public.background_library_entities WHERE deleted_at IS NULL GROUP BY kind HAVING count(*)>CASE WHEN kind='view' THEN 20000 ELSE 10000 END),'배경 항목 수 제한을 초과했습니다.');
 FOR row IN SELECT kind,id,value FROM public.background_library_entities WHERE deleted_at IS NULL LOOP
  PERFORM public.background_library_validate_entity(row.kind,row.value);
  IF row.kind IN ('place','map') THEN
   parent:=row.value->>'parentId'; visited:=ARRAY[row.id::text];
   WHILE parent IS NOT NULL LOOP
    PERFORM public.background_library_require(NOT parent=ANY(visited),'상위 항목이 순환합니다.');
    visited:=array_append(visited,parent);
    PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind=row.kind AND e.id=parent::uuid AND e.deleted_at IS NULL),'상위 항목이 삭제되었거나 존재하지 않습니다.');
    SELECT e.value->>'parentId' INTO parent FROM public.background_library_entities e WHERE e.kind=row.kind AND e.id=parent::uuid AND e.deleted_at IS NULL;
   END LOOP;
  END IF;
  IF row.kind IN ('map','view','group','usage') AND row.value->>'placeId' IS NOT NULL THEN
   PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind='place' AND e.id=(row.value->>'placeId')::uuid AND e.deleted_at IS NULL),'참조하는 장소가 삭제되었거나 존재하지 않습니다.');
  END IF;
  IF row.kind='map' THEN
   FOR n IN SELECT * FROM jsonb_array_elements(row.value->'nodes') LOOP
    IF n->>'type'='space' THEN
     IF n->>'placeId' IS NOT NULL THEN PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind='place' AND e.id=(n->>'placeId')::uuid AND e.deleted_at IS NULL),'공간이 참조하는 장소가 없습니다.'); END IF;
     IF n->>'childMapId' IS NOT NULL THEN PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind='map' AND e.id=(n->>'childMapId')::uuid AND e.value->>'parentId'=row.id::text AND e.deleted_at IS NULL),'상세 도면은 현재 도면의 직계 하위 도면이어야 합니다.'); END IF;
    ELSE
     IF n->>'spaceId' IS NOT NULL THEN PERFORM public.background_library_require(EXISTS(SELECT 1 FROM jsonb_array_elements(row.value->'nodes') space WHERE space->>'type'='space' AND space->>'id'=n->>'spaceId'),'카메라와 기호는 같은 도면의 공간만 참조할 수 있습니다.'); END IF;
     IF n->>'type'='camera' THEN
      FOR ref IN SELECT * FROM jsonb_array_elements(n->'viewIds') LOOP
       PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind='view' AND e.id=(ref#>>'{}')::uuid AND e.deleted_at IS NULL),'카메라가 참조하는 배경이 없습니다.');
      END LOOP;
     END IF;
    END IF;
   END LOOP;
  ELSIF row.kind='view' THEN
   FOR ref IN SELECT * FROM jsonb_array_elements((row.value->'visiblePlaceIds')||(row.value->'relatedPlaceIds')||CASE WHEN row.value->>'cameraPlaceId' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(row.value->'cameraPlaceId') END) LOOP
    PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e WHERE e.kind='place' AND e.id=(ref#>>'{}')::uuid AND e.deleted_at IS NULL),'배경이 참조하는 장소가 없습니다.');
   END LOOP;
  ELSIF row.kind IN ('group','usage') THEN
   FOR ref IN SELECT * FROM jsonb_array_elements(row.value->'variantIds') LOOP
    selected:=ref#>>'{}'; home:=row.value->>'placeId';
    PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.background_library_entities e CROSS JOIN LATERAL jsonb_array_elements(e.value->'variants') variant WHERE e.kind='view' AND e.deleted_at IS NULL AND variant->>'id'=selected AND e.value->>'placeId'=home),'선택한 변형이 없거나 다른 장소의 배경입니다.');
   END LOOP;
  END IF;
 END LOOP;
 PERFORM public.background_library_require(NOT EXISTS(SELECT variant->>'id' FROM public.background_library_entities e CROSS JOIN LATERAL jsonb_array_elements(e.value->'variants') variant WHERE e.kind='view' AND e.deleted_at IS NULL GROUP BY variant->>'id' HAVING count(*)>1),'배경 변형 식별자가 중복됩니다.');
 PERFORM public.background_library_require(NOT EXISTS(SELECT value->>'episodeNumber',value->>'placeId' FROM public.background_library_entities WHERE kind='usage' AND deleted_at IS NULL GROUP BY value->>'episodeNumber',value->>'placeId' HAVING count(*)>1),'같은 에피소드와 장소의 사용 기록이 이미 있습니다.');
END $$;

CREATE OR REPLACE FUNCTION public.background_library_snapshot(actor TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object(
  'places',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='place'),'[]'::jsonb),
  'maps',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='map'),'[]'::jsonb),
  'views',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='view'),'[]'::jsonb),
  'groups',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='group'),'[]'::jsonb),
  'usages',COALESCE(jsonb_agg(value ORDER BY id) FILTER(WHERE kind='usage'),'[]'::jsonb),
  'canManage',EXISTS(SELECT 1 FROM public.users WHERE id=actor AND role='admin'))
 FROM public.background_library_entities WHERE deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.background_library_read(p_session_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor) THEN RAISE EXCEPTION '로그인 세션이 필요합니다.' USING ERRCODE='42501'; END IF;
 RETURN public.background_library_snapshot(actor);
END $$;

CREATE OR REPLACE FUNCTION public.background_library_execute(p_session_token TEXT,p_request_id TEXT,p_command JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor TEXT:=public.app_session_user_id(p_session_token); v_kind TEXT; action TEXT; item_id UUID; expected BIGINT;
 candidate JSONB; previous public.background_library_entities%ROWTYPE; receipt JSONB; can_manage BOOLEAN; operations JSONB; operation JSONB;
BEGIN
 SELECT COALESCE(role='admin',false) INTO can_manage FROM public.users WHERE id=actor FOR SHARE;
 IF can_manage IS NULL THEN RAISE EXCEPTION '로그인 세션이 필요합니다.' USING ERRCODE='42501'; END IF;
 PERFORM public.background_library_require(public.background_library_uuid(to_jsonb(p_request_id)),'올바른 요청 식별자가 필요합니다.');
 PERFORM public.background_library_require(jsonb_typeof(p_command)='object' AND octet_length(p_command::text)<=28000000,'배경 요청이 올바르지 않거나 너무 큽니다.');
 IF p_command->>'type'='save-maps' THEN
  IF NOT can_manage THEN RAISE EXCEPTION '배경 관리는 관리자만 할 수 있습니다.' USING ERRCODE='42501'; END IF;
  PERFORM public.background_library_require(public.background_library_object(p_command,ARRAY['type','maps']) AND public.background_library_array(p_command->'maps',1,100),'함께 저장할 도면은 1개 이상 100개 이하여야 합니다.');
  operations:='[]'::jsonb;
  FOR operation IN SELECT * FROM jsonb_array_elements(p_command->'maps') LOOP
   PERFORM public.background_library_require(public.background_library_object(operation,ARRAY['entity','expectedRevision']),'도면 저장 항목의 필드가 올바르지 않습니다.');
   operations:=operations||jsonb_build_array(operation||jsonb_build_object('type','save','kind','map'));
  END LOOP;
 ELSE
  operations:=jsonb_build_array(p_command);
 END IF;
 FOR operation IN SELECT * FROM jsonb_array_elements(operations) LOOP
  v_kind:=operation->>'kind'; action:=operation->>'type';
  PERFORM public.background_library_require(v_kind IN ('place','map','view','group','usage') AND action IN ('save','delete'),'알 수 없는 배경 요청입니다.');
  IF v_kind<>'usage' AND NOT can_manage THEN RAISE EXCEPTION '배경 관리는 관리자만 할 수 있습니다.' USING ERRCODE='42501'; END IF;
  PERFORM public.background_library_require(public.background_library_object(operation,CASE WHEN action='save' THEN ARRAY['type','kind','entity','expectedRevision'] ELSE ARRAY['type','kind','id','expectedRevision'] END),'배경 요청의 필드가 올바르지 않습니다.');
  IF action='save' THEN
   PERFORM public.background_library_validate_entity(v_kind,operation->'entity');
  ELSE
   PERFORM public.background_library_require(public.background_library_uuid(operation->'id'),'삭제할 항목의 식별자가 올바르지 않습니다.');
  END IF;
  PERFORM public.background_library_require((action='save' AND operation->'expectedRevision'='null'::jsonb) OR public.background_library_number(operation->'expectedRevision',1,9007199254740990,true),'저장 버전이 올바르지 않습니다.');
 END LOOP;
 IF p_command->>'type'='save-maps' THEN
  PERFORM public.background_library_require(NOT EXISTS(SELECT (item->'entity'->>'id')::uuid FROM jsonb_array_elements(operations) item GROUP BY (item->'entity'->>'id')::uuid HAVING count(*)>1),'같은 도면을 중복 저장할 수 없습니다.');
 END IF;
 -- Global reference lock, individual entity revision: unrelated edits still never conflict.
 PERFORM pg_advisory_xact_lock(2119212026,1);
 SELECT r.command INTO receipt FROM public.background_library_receipts r WHERE r.actor_id=actor AND r.request_id=p_request_id;
 IF FOUND THEN
  IF receipt<>p_command THEN RAISE EXCEPTION '같은 요청 식별자로 다른 내용을 저장할 수 없습니다.' USING ERRCODE='22023'; END IF;
  RETURN public.background_library_snapshot(actor);
 END IF;
 -- Every operation and the final graph validation share this transaction. A later conflict or
 -- invalid link rolls all maps back, including newly created parent/child pairs.
 FOR operation IN SELECT * FROM jsonb_array_elements(operations) LOOP
  v_kind:=operation->>'kind'; action:=operation->>'type'; candidate:=operation->'entity';
  item_id:=(CASE WHEN action='save' THEN candidate->>'id' ELSE operation->>'id' END)::uuid;
  expected:=(operation->>'expectedRevision')::bigint;
  -- Episode removal retains historical usage; only the usage being saved needs a live episode.
  IF action='save' AND v_kind='usage' THEN
   PERFORM public.background_library_require(EXISTS(SELECT 1 FROM public.episodes ep WHERE ep.episode_number=(candidate->>'episodeNumber')::integer),'에피소드가 존재하지 않습니다.');
  END IF;
  SELECT * INTO previous FROM public.background_library_entities e WHERE e.kind=v_kind AND e.id=item_id FOR UPDATE;
  IF expected IS NULL THEN
   IF FOUND THEN RAISE EXCEPTION '이미 존재하거나 삭제된 식별자입니다. 다시 불러와 주세요.' USING ERRCODE='40001'; END IF;
  ELSE
   IF NOT FOUND OR previous.deleted_at IS NOT NULL OR previous.revision<>expected THEN RAISE EXCEPTION '다른 사용자가 먼저 변경했습니다. 다시 불러와 주세요.' USING ERRCODE='40001'; END IF;
  END IF;
  IF action='save' THEN
   candidate:=jsonb_set(candidate,'{revision}',to_jsonb(COALESCE(expected,0)+1));
   INSERT INTO public.background_library_entities AS target(kind,id,revision,value) VALUES(v_kind,item_id,COALESCE(expected,0)+1,candidate)
    ON CONFLICT ON CONSTRAINT background_library_entities_pkey DO UPDATE SET revision=EXCLUDED.revision,value=EXCLUDED.value,updated_at=now();
  ELSE
   UPDATE public.background_library_entities e SET deleted_at=now(),revision=e.revision+1,updated_at=now() WHERE e.kind=v_kind AND e.id=item_id;
  END IF;
 END LOOP;
 PERFORM public.background_library_validate();
 INSERT INTO public.background_library_receipts(actor_id,request_id,command) VALUES(actor,p_request_id,p_command);
 -- Realtime public channel carries no user, identifiers or entity content. Missing local extension is harmless.
 -- A failed signal must not undo the save: other clients catch up on their next read.
 BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
   EXECUTE 'SELECT realtime.send($1,$2,$3,$4)' USING '{}'::jsonb,'changed','background-library',false;
  END IF;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[background-library] realtime 변경 신호 전송 실패: %', SQLERRM;
 END;
 RETURN public.background_library_snapshot(actor);
END $$;

DO $$ DECLARE role_name TEXT; fn REGPROCEDURE; BEGIN
 REVOKE ALL PRIVILEGES ON TABLE public.background_library_entities,public.background_library_receipts FROM PUBLIC;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',fn);
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.background_library_entities,public.background_library_receipts FROM %I',role_name);
   FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'background_library_%' LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',fn,role_name);
   END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION public.background_library_read(text),public.background_library_execute(text,text,jsonb) TO %I',role_name);
  END IF;
 END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;

