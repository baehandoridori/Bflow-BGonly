# 간트 서버 인증 경계 읽기 전용 점검

검사 시각: **2026-09-07 05:44~05:45 KST**. 운영 DB가 반환한 마지막 시각은 `2026-09-06 20:45:36.341564+00`이다.

## 판단

- 과거 `gantt_security_containment` 때문에 간트가 전면 중단됐다는 기록은 **현재 상태가 아니다**. 운영에는 서버 로그인 세션을 검증하는 간트 RPC가 적용돼 있고, 앱도 그 경로를 사용한다.
- 이번 일정 표시·그룹 이동 변경은 renderer/domain 변경이다. 확인 시점의 변경분에는 Electron 인증·RPC·Realtime 경계나 운영 migration 수정이 없으므로, 이번 변경으로 서버 권한이 늘어나지 않는다. 기능 회귀 검증과 배포 절차는 계속 진행할 수 있다.
- 다만 **기존 `users` 관리 경로의 별도 보안 위험은 남아 있다**. 공개 역할이 사용자 행을 직접 생성·삭제하고 이름·역할을 변경할 수 있으며, 사용자 삭제는 간트 정리 트리거를 실행한다. 따라서 “이번 UI 변경이 인증 권한을 넓히지 않는다”와 “앱 전체의 인증·권한 경계가 안전하다”는 같은 판단이 아니다.

## 환경과 범위

| 항목 | 확인값 |
|---|---|
| 작업 위치 | `C:/Bflow-BGonly/.worktrees/gantt-schedule-visibility` |
| 작업 기준 커밋 | `aa4ac56eb25a6f287375b77134c17d38362bac96` |
| `origin/main` | 같은 커밋. `git ls-remote origin refs/heads/main`으로 원격도 확인 |
| 운영 프로젝트 | Bflow, `mpqifkpxalwxgcrddchv` |
| 운영 상태 | `ACTIVE_HEALTHY`, PostgreSQL 17.6.1 |
| 운영 검사 방법 | Supabase 프로젝트·migration 목록, `pg_class`, `pg_policy`, `pg_proc`, `pg_publication_tables`, `pg_attribute`, `pg_trigger`, `pg_db_role_setting`의 읽기 전용 조회 |
| 변경 여부 | 운영 SQL 쓰기·정책 변경·로그인·공격 재현 쓰기 없음. 개인 비밀번호·세션 토큰 조회 없음 |

`git diff origin/main -- electron DEVLOG/migrations`는 비어 있었다. 앱 코드와 migration은 현재 `origin/main`의 경계를 그대로 사용한다.

## 서버 경계와 운영 적용 상태

운영 migration 목록에서 다음 항목을 확인했다. 이름과 버전은 운영에 기록된 실제 값이며, 저장소 파일명에 포함된 생성 시각과 다를 수 있다.

| 버전 | 운영 migration |
|---|---|
| `20260905125843` | `gantt_security_containment` |
| `20260905133702` | `app_sessions_gantt_session_auth` |
| `20260905140129` | `app_login_throttle_upsert_race_fix` |
| `20260905150955` | `gantt_delete_triggers_security_definer` |
| `20260905151125` | `users_password_lockdown` |
| `20260905163224` | `gantt_release_acl` |
| `20260905175926` | `gantt_revision_ledger` |
| `20260905195742` | `gantt_project_pair` |
| `20260905211721` | `gantt_calendar_color` |

운영 함수의 실제 본문도 조회했다. `app_login`은 서버에서 이름·비밀번호를 대조하고 세션 토큰을 발급한다. `app_session_user_id`는 토큰 형식·해시·만료를 확인하여 사용자 ID를 확정한다. `gantt_session_read`, `gantt_session_execute`, `gantt_session_calendar_events`는 이 함수의 결과를 내부 간트 함수에 전달한다. 호출자가 보낸 사용자 ID로 간트 권한을 판정하는 공개 진입점은 아니다.

| 운영 객체 | `anon` / `authenticated` 확인 결과 |
|---|---|
| `gantt_spaces`, `gantt_projects`, `gantt_requests`, `gantt_entity_revisions` | SELECT·INSERT·UPDATE·DELETE 모두 불가. RLS 켜짐, 정책 0개 |
| `app_sessions`, `app_login_throttle` | SELECT·INSERT·UPDATE·DELETE 모두 불가. RLS 켜짐, 정책 0개 |
| 내부 `gantt_*`, `app_session_user_id` | EXECUTE 불가 |
| `gantt_session_read/execute/calendar_events` | EXECUTE 가능. SECURITY DEFINER, 고정 `search_path=public, pg_temp`, 본문에서 토큰 검증 |
| `users.password` | SELECT·UPDATE 불가. INSERT 권한은 아래 별도 위험 참조 |
| 간트 테이블의 `supabase_realtime` publication | 포함된 테이블 없음 |

`gantt_notify_change`는 `table`과 `op`만 `gantt-changed` 방송으로 보낸다. 실제 행 내용이나 권한 있는 snapshot을 공개 채널로 보내지 않는다. 앱은 신호 후 세션 RPC로 다시 조회한다.

앱 경로도 일치한다. `electron/sessionManager.ts`의 `getSessionTokenFor`는 main의 현재 사용자와 토큰 소유 사용자가 일치할 때만 토큰을 반환한다. `electron/ganttIpc.ts`는 요청 epoch를 검사하고, 응답 때 계정이 바뀌었으면 폐기한다. `electron/ganttStore.ts`는 `p_session_token`을 세션 RPC에 보내며 토큰이 없을 때는 요청하지 않는다. `electron/main.ts`가 이를 실제 SessionManager에 연결하고, `electron/realtime.ts`는 내용 없는 방송을 재조회 신호로 처리한다.

참조: `DEVLOG/2026-09-05-gantt-session-auth.md`, `DEVLOG/2026-09-06-gantt-release-audit.md`, `DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql`.

## 동작 증거와 확인하지 않은 범위

- 현재 소스의 `sessionTokenAuth`, `ganttPersistence`, `rememberedAuthStorage` 테스트: **39개 중 38 pass, 0 fail, 1 skipped**. 이번 실행은 `BFLOW_PGLITE_MODULE` 미설정으로 PostgreSQL 거래 시험 1개가 생략됐다. 세션 없는 요청 차단, 사용자 전환, epoch, 토큰의 renderer 제외, OS 암호화 저장, RPC 인자 경계는 통과했다.
- `DEVLOG/verification/2026-09-06-gantt-native-acceptance.json`에는 **v1.112.2 / Windows 설치본 / 실계정 1개 / 2026-09-06 03:48:53 KST**에서 간트 저장, 캘린더 양방향 수정, 0분 마일스톤, 삭제·실행 취소·재실행과 DB 일치 확인 기록이 있다. 현재 릴리스의 새 실앱 조작 증거로 확대 해석하지 않는다.
- 기존 릴리스 문서에는 적용 후 운영 세션 smoke와 위조 토큰·내부 RPC 거부 기록이 있다. 이번 점검은 그 기록에 더해 현재 함수 본문과 권한을 다시 읽었다.
- 이번 점검에서 새 로그인·정상 토큰 RPC 호출·실제 계정 저장·여러 운영 PC 동시 조작은 실행하지 않았다. 특히 정상 `app_session_user_id` 호출도 오래된 세션의 사용 시각을 갱신할 수 있어 읽기 전용 점검에 포함하지 않았다.

따라서 **현재 간트 기능은 서버 인증 경계로 동작 가능한 구조이며, 알려진 containment 전면 차단 상태는 아니다**. 개별 PC의 로그인 만료·구버전 기억된 로그인에는 재로그인이 필요할 수 있고, 최신 설치본의 실제 조작은 해당 릴리스 검증에서 별도로 확인해야 한다.

## 기존 users 관리 위험

현재 운영 메타데이터에서 다음을 확인했다.

1. `users`의 `anon`·`authenticated`에는 테이블 INSERT·DELETE 권한이 있다. `password`, `id`, `role`을 포함한 모든 컬럼의 INSERT 권한도 있다.
2. `name`, `role`, `slack_id`, `hire_date`, `birthday`, `is_compositor`, `is_acting_supervisor`는 직접 UPDATE 가능하다. `password` SELECT·UPDATE 차단만으로 이 경로가 닫히지는 않는다.
3. `users`에는 `allow_all`, 대상 `PUBLIC`, 명령 `ALL`, `USING true`, `WITH CHECK true` 정책 1개가 있다. `anon`의 public 스키마 USAGE도 true다. `pg_db_role_setting`에 설정된 `pgrst.db_pre_request` 추가 검사도 발견하지 못했다.
4. `create_user_authorized`와 `update_user_authorized`는 anon 실행 가능하며 서버 세션 대신 전달된 `p_actor_id`의 role을 확인한다. `delete_user_cascade(p_user_id)`도 anon 실행 가능하고, 조회한 본문에 세션이나 호출자 인증 검사가 없다.
5. `users`의 활성 `BEFORE DELETE` 트리거 `gantt_user_deleted`는 SECURITY DEFINER `gantt_before_user_delete`를 호출한다. 이 함수는 해당 사용자의 비공개 간트 폴더를 삭제하고, 공유 폴더 소유권을 다른 관리자로 옮기며 프로젝트 소유자·멤버·담당자를 정리한다.

이는 계정 관리 경로에서 권한 없는 데이터 변경이 간트까지 영향을 줄 수 있다는 **별도 P1 보안 위험**이다. 실제 공격 요청이나 운영 사용자 삭제를 실행하지 않았으므로 구체적인 사용자별 FK·데이터 상태에 따른 성공 여부는 시험하지 않았다. 판단 근거는 현재 권한·정책·활성 트리거와 함수 본문이다.

이 권한은 이번 UI 변경에서 추가된 것이 아니다. `DEVLOG/migrations/2026-09-06-users-password-lockdown.sql`은 기존 관리자 RPC 호환 때문에 INSERT·DELETE와 일부 컬럼 UPDATE를 유지했다고 명시한다. 간트 세션 RPC가 복구됐다는 사실과 이 기존 사용자 관리 위험을 함께 기록해야 한다.

## 안전한 후속 대책과 출시 구분

- 기존 실제 앱의 사용자 생성·수정·삭제·비밀번호 초기화 호출을 먼저 조사하고, main의 세션 토큰을 받는 서버 RPC로 옮긴다. 서버가 토큰의 사용자와 관리자 권한을 확인해야 하며 호출자 입력 `actorId`만 믿지 않는다.
- 사용자 생성·삭제·역할 변경은 해당 인증 RPC 안에서만 허용하고, `users`의 직접 INSERT·DELETE 및 민감 컬럼 UPDATE를 회수한다. 기존 정리 트리거는 인증된 삭제 안에서 실행되도록 유지한다. 공개 디렉터리에 필요한 읽기 컬럼은 별도로 유지한다.
- 공개 사용자 변경 권한을 먼저 회수하면 현재 설치된 앱의 관리자 기능이 깨질 수 있다. 실제 Electron 호출 경로 전환, 테스트 모드 동등성, 지원 버전 배포와 운영 권한 전환 순서를 함께 설계해야 한다. 로그인 거부·비관리자·위조 actor·이전 세션·삭제에 따른 간트 정리 등을 격리 DB에서 검증한다.
- **이번 UI 릴리스 판단:** 서버 경계를 변경하지 않는 UI/도메인 회귀 검증으로 판단한다. 과거 containment 기억만으로 중단할 근거는 없다. 기존 users 위험을 이번 변경으로 해결했다고 보고하지 않으며, 앱 전체 보안 인증을 통과했다는 표현도 사용하지 않는다. 별도 보안 개선 작업과 권한 전환이 필요하다.

권한과 RLS의 구분은 [Supabase 공식 Data API 보안 문서](https://supabase.com/docs/guides/api/securing-your-api)의 설명과 같은 기준으로 점검했다. 이번 점검에서는 운영 정책을 수정하지 않았다.
