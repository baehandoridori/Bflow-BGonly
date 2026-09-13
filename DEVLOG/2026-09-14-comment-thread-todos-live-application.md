# 팀 할 일(comment_thread_todos) 운영 DB 적용 기록

> **대상**: 피드백 58 팀 할 일 — PR [#284](https://github.com/baehandoridori/Bflow-BGonly/pull/284) (v1.118.0)
> **근거**: 계획서 `DEVLOG/2026-09-14-피드백-58-59-수정계획.md` 부록 A-2. 한솔 지시("코덱스 리뷰 루프 돌리고 배포까지 진행해줘")로, 코덱스 리뷰가 명시 완료 신호("Didn't find any major issues", 커밋 `abad1457`)를 낸 뒤 머지 전에 적용했다.
> **적용자**: Claude Opus 5 (Supabase MCP), 2026-09-14 08:00 KST 무렵(2026-09-13 22:59 UTC).

## 1. 적용 전 확인 (2026-09-13 22:04 UTC)

- 운영 Bflow 프로젝트 `mpqifkpxalwxgcrddchv`. `comment_thread_todos` 테이블 없음, `comment_thread_todos_*` 함수 0개.
- 전제 객체 존재: `public.app_session_user_id` 1, `realtime.send` 1, `gantt_session_*` 래퍼 3.
- 기존 데이터 지문: 사용자 17명(`id|name|role` md5 `ce78d3458b327df09e9f8f46d7f5a448`) · 댓글 1,551건(id md5 `cb9b59ea9b245b7c6feeb843eefc4e55`) · 간트 폴더 5 · Realtime publication 테이블 22 · 적용된 migration 77.
- 보안 진단(적용 전): 정책 없는 RLS 테이블 24 · search_path 가변 함수 13 · RLS 꺼진 public 테이블 3 · public 확장 1 · anon 실행 가능 SECURITY DEFINER 12 · authenticated 실행 가능 SECURITY DEFINER 6.
- 적용할 SQL 은 계획서 작성 이후(커밋 `05ea3da0`) 바뀌지 않았다. 저장소 원본(LF) SHA-256:
  - `DEVLOG/migrations/2026-09-14-comment-thread-todos.sql` — `925aa7ff99f9fbdd30b123e159358edac8902dd1851fd59c8435439c7a71c57f`
  - `DEVLOG/verification/2026-09-14-comment-thread-todos-smoke.sql` — `148be4d58abb67a069e6296f0c633068993e41dce2c334d72c025b6d0f47ad40`

## 2. 적용

- MCP `apply_migration`, 이름 `comment_thread_todos` → 성공. 운영 migration 목록 버전 **`20260913225950`** `comment_thread_todos` (적용된 migration 77 → 78).
- 파일 전체를 한 배치로 적용했다(`SET LOCAL lock_timeout = '5s'`, `statement_timeout = '45s'` 포함).
- 전달 과정 확인: `comment_thread_todos_session_add` 정의에 정규식 `'\s+'` 가 원문 그대로(단일 백슬래시) 들어간 것을 `pg_get_functiondef` 로 확인.

## 3. 스모크 (2026-09-13 23:00 UTC)

`DEVLOG/verification/2026-09-14-comment-thread-todos-smoke.sql` 을 파일 전체 한 배치로 실행했다(BEGIN … ROLLBACK).

| verification_name | passed | result |
|---|---|---|
| 2026-09-14-comment-thread-todos-smoke | **true** | All transactional changes rolled back |

검증 내용: anon 의 테이블 직접 읽기·쓰기 거부, 위조·NULL 토큰 거부(42501·"다시 로그인"), 서버 공백 정제·작성자 이름 스냅샷, 입력 검증 22023, 최초 완료자 유지·해제 세 칸 비움, 남의 항목 삭제 42501·자기 항목 삭제·재삭제 `deleted:false`·관리자 삭제, 지운 항목 완료 P0002, 스레드별 목록 분리.

## 4. 확인 쿼리 (계획서 부록 A-2 3단계, 2026-09-13 23:01 UTC)

| 항목 | 기대값 | 실제값 | 통과 |
|---|---|---|---|
| anon 이 테이블을 직접 못 읽는다 `has_table_privilege('anon','public.comment_thread_todos','SELECT')` | `false` | `false` | ✅ |
| RLS 정책 0개 | `0` | `0` | ✅ |
| publication 미등록 | `0` | `0` | ✅ |
| 래퍼 4개 존재 | `_add`, `_delete`, `_list`, `_set_done` | `comment_thread_todos_session_add, _delete, _list, _set_done` | ✅ |
| 신호 트리거 존재 | 1행 | `comment_thread_todos_notify_change` | ✅ |

추가 확인:

- anon 의 래퍼 실행 권한 `true`(앱 경로), 트리거 함수 실행 권한 `false`.
- 스모크 뒤 `comment_thread_todos` 행 **0**, 검증용 사용자 잔여 **0**.
- 기존 데이터 지문 적용 전후 **동일**: 사용자 17명 `ce78d3458b327df09e9f8f46d7f5a448` · 댓글 1,551건 `cb9b59ea9b245b7c6feeb843eefc4e55` · 간트 폴더 5 · publication 테이블 22.
- 보안 진단(적용 후, 23:01 UTC): 정책 없는 RLS 테이블 24 → **25**(`comment_thread_todos`, 의도 — 래퍼로만 연다) · anon 실행 가능 SECURITY DEFINER 12 → **16** · authenticated 6 → **10**(래퍼 4개, 간트 세션 래퍼와 같은 설계) · 나머지 항목 수 동일(13 · 3 · 1). 새로 생긴 다른 항목 없음.

## 5. 구버전 앱 영향

추가 전용 migration 이라 v1.117.x 앱이 쓰는 테이블·함수·정책·publication 은 바뀌지 않았다(publication 테이블 수·기존 데이터 지문 동일). 구버전 앱을 직접 실행해 확인하지는 않았다.

## 6. 다음

- PR #284 머지 → `bflow-release-deploy` 로 v1.118.0 빌드·G드라이브 배포(manifest 마지막 갱신).
- 배포 뒤 실기 확인: 구현 기록 `DEVLOG/2026-09-14-피드백-58-59-구현.md` §6-2.
