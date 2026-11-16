-- 2026-11-16: '다른 사용자가 먼저 바꿈' 충돌을 40001 대신 PT409 로 알린다 (서버 API 무한 재시도 막기)
--
-- 배경:
--   간트·캘린더·배경 라이브러리 함수는 '내가 본 판이 낡았다'(버전 불일치·이미 지운 항목·연결이 바뀜)를
--   RAISE ... USING ERRCODE='40001'(serialization_failure)로 알려 왔다. 서버 API(PostgREST)는 40001 을
--   '잠깐 겹친 거래'로 보고 같은 요청을 스스로 처음부터 다시 실행한다. 우리 판정은 다시 해도 똑같이 실패하므로
--   끝나지 않는다. 2026-11-16 BAE경 개발 브랜치(PostgREST 14.18)에서 실제로 앱은 60초가 지나도 답을 못 받고,
--   서버는 연결을 끊을 때까지 9분에 약 530번 같은 요청을 되풀이했다(Bflow-BAE 5c4b9d7e 에서 BAE경 쪽은 고침).
--   Supabase 문서(트러블슈팅 'SQLSTATE 40001 in an RPC function causes infinite retries')도 PostgREST 14 에
--   이 문제가 있고 16 에서 고친다고 적고, 40001 대신 기본 P0001 이나 'PTxyz'(바로 HTTP xyz 로 답함)를 쓰라고 한다.
--
-- 하는 일:
--   아래 8개 함수에서 ERRCODE='40001' 글자만 ERRCODE='PT409' 로 바꾼다. 메시지 글은 그대로다.
--   앱은 충돌을 오류 번호가 아니라 글로 알아보므로(예: 'Calendar event source changed; refresh and retry')
--   동작이 같고, 서버 API 는 되풀이하지 않고 바로 HTTP 409 로 답한다. 옛 버전 앱도 그대로 동작한다.
--     간트    gantt_execute(text,text,jsonb)                    최신 정의: 20260905193555_gantt_project_pair.sql
--             gantt_session_execute_v2(text,text,jsonb)         최신 정의: 2026-09-17-calendar-linked-gantt.sql
--             gantt_assign_insert_revision() (삽입 트리거)        최신 정의: 20260905173804_gantt_revision_ledger.sql
--     캘린더  update_calendar_event_authorized(text,uuid,uuid,jsonb)   최신 정의: 20260920061229_calendar_recurrence.sql
--             delete_calendar_event_authorized(text,uuid,uuid)        최신 정의: 20260920061229_calendar_recurrence.sql
--             calendar_session_recurrence_execute(text,text,uuid,date,text,bigint,jsonb)  최신 정의: 같은 파일
--             calendar_session_feed_manage(text,uuid,text,text,uuid)  최신 정의: 20260919170351_calendar_external_feed.sql
--     배경    background_library_execute(text,text,jsonb)       최신 정의: 2026-10-16-background-editors.sql
--
-- 방식:
--   레포 파일의 함수 본문을 다시 붙이지 않는다. DB 에 실제로 들어 있는 정의(pg_get_functiondef)에서 그 글자만 바꿔
--   CREATE OR REPLACE 한다 — 레포 기록과 운영이 조금 달라도 다른 부분을 되돌리지 않고, 주인·권한·설명·SECURITY·
--   search_path 는 그대로 남는다. 없는 함수는 건너뛴다(시험 DB 처럼 사슬 일부만 있는 곳). 이미 PT409 면 그대로 둔다.
--   끝에서 public 스키마 함수 어디든 40001·40P01 을 직접 내는 곳이 남아 있으면 실패해 전부 되돌린다
--   (목록에 없는 함수가 운영에 있으면 예행연습에서 이름이 드러난다).
--
-- 순서·재실행:
--   위 '최신 정의' 파일(과 같은 함수를 정의하는 더 앞의 파일) 중 하나라도 다시 실행하면 40001 이 되살아난다.
--   그 뒤에는 반드시 이 파일을 다시 실행한다. 배경 사슬은 기본 → 3D → 요소 → 편집자 → 이 파일.
--   반복 실행해도 안전하다.
--
-- 적용 뒤 확인:
--   이미 되풀이 중인 서버 연결은 함수를 바꿔도 멈추지 않는다(Supabase 문서). pg_stat_activity 에서 위 함수를
--   오래(수십 초 이상) 실행 중인 연결이 있는지 따로 본다 — 끊는 것은 한솔 확인 뒤.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

DO $pt409$
DECLARE
  targets CONSTANT TEXT[] := ARRAY[
    'public.gantt_execute(text,text,jsonb)',
    'public.gantt_session_execute_v2(text,text,jsonb)',
    'public.gantt_assign_insert_revision()',
    'public.update_calendar_event_authorized(text,uuid,uuid,jsonb)',
    'public.delete_calendar_event_authorized(text,uuid,uuid)',
    'public.calendar_session_recurrence_execute(text,text,uuid,date,text,bigint,jsonb)',
    'public.calendar_session_feed_manage(text,uuid,text,text,uuid)',
    'public.background_library_execute(text,text,jsonb)'
  ];
  conflict_code CONSTANT TEXT := 'ERRCODE\s*=\s*''40001''';
  target TEXT;
  fn REGPROCEDURE;
  definition TEXT;
  rewritten TEXT;
  leftovers TEXT;
BEGIN
  FOREACH target IN ARRAY targets LOOP
    fn := to_regprocedure(target);
    IF fn IS NULL THEN
      RAISE NOTICE 'PT409: % 없음 — 건너뜀', target;
      CONTINUE;
    END IF;
    definition := pg_get_functiondef(fn);
    IF definition !~* conflict_code THEN
      IF definition !~* 'ERRCODE\s*=\s*''PT409''' THEN
        RAISE EXCEPTION 'PT409: % 의 정의에 충돌 번호가 없다 — 정의가 예상과 다르니 먼저 확인한다', target;
      END IF;
      RAISE NOTICE 'PT409: % 이미 바뀜', target;
      CONTINUE;
    END IF;
    rewritten := regexp_replace(definition, conflict_code, 'ERRCODE=''PT409''', 'gi');
    IF rewritten ~ '40001' THEN
      RAISE EXCEPTION 'PT409: % 에 다른 모양의 40001 이 남는다 — 손으로 확인한다', target;
    END IF;
    EXECUTE rewritten;
    RAISE NOTICE 'PT409: % 바꿈', target;
  END LOOP;

  -- 안전망: public 함수 어디에도 40001·40P01 을 직접 내는 곳이 없어야 한다(EXCEPTION WHEN 으로 받는 것은 괜찮다).
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT) INTO leftovers
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ~* 'ERRCODE\s*=\s*''(40001|40P01|serialization_failure|deadlock_detected)'''
      OR p.prosrc ~* 'RAISE[^;]*(SQLSTATE\s*''(40001|40P01)''|\mserialization_failure\M|\mdeadlock_detected\M)');
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'PT409: 40001·40P01 을 직접 내는 함수가 남아 있다: %', leftovers;
  END IF;
END
$pt409$;

COMMIT;
