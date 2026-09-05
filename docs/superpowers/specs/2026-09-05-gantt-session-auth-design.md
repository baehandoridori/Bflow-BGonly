# 간트 호출자 검증 경계 — 로그인 세션 토큰 설계

작성: 2026-09-05 · 대상 브랜치: `claude/gantt-migration-auth-boundary-79e7bf` · 예상 버전: v1.111.0

## 1. 문제

`gantt_workspaces` 마이그레이션(라이브 버전 20260905124058)은 `gantt_spaces`·`gantt_projects`·`gantt_requests` 세 테이블에 `anon` 역할의 직접 읽기/쓰기/삭제 권한과 모든 행을 허용하는 RLS 정책을 부여했고, RPC(`gantt_read`·`gantt_execute`·`gantt_calendar_events`)는 호출자가 보내는 `p_actor_id` 를 그대로 믿었다. 앱에 배포되는 anon 키만 있으면 Data API 를 직접 호출해 소유자/편집자/보기 전용 검사를 우회할 수 있었다.

곧이어 긴급 차단(`gantt_security_containment`, 20260905125843)이 적용돼 현재 라이브 DB 는 다음 상태다.

- 세 테이블: RLS 켜짐, 정책 0개, `anon`/`authenticated` 권한 전부 회수. Realtime publication 에서 제거.
- `gantt_*` 함수 10개: `anon`/`authenticated` EXECUTE 회수.
- 결과: 노출은 막혔지만 앱에서 간트 기능이 통째로 동작하지 않는다.

리뷰(GPT)가 이 항목을 계속 지적하는 이유는 "차단"이 임시 조치이고, 원래 구조(호출자가 자기 신원을 주장하는 방식)가 그대로이기 때문이다.

## 2. 목표와 비목표

**목표**

1. anon 키만 가진 호출자는 간트 데이터를 읽거나 쓸 수 없어야 한다. 실제 비밀번호로 로그인한 사용자만, 자기 권한 범위 안에서만 가능해야 한다.
2. 앱의 기존 구조(Electron main 이 anon 키로 Supabase 호출, 사용자는 `users` 테이블의 TEXT id)를 유지한다. Supabase Auth 전면 전환은 하지 않는다.
3. 간트 기능을 다시 살린다(차단 해제가 아니라 새 경계 위에서).
4. 이후 캘린더 RPC 등 다른 기능도 같은 경계를 재사용할 수 있게 공용 부품으로 만든다.

**비목표**

- 캘린더·씬 등 기존 테이블의 신뢰 모델 변경(이번 범위 밖, 후속 과제로 기록).
- 비밀번호 해시화(별도 과제). 단, 비밀번호가 anon 에게 읽히는 문제는 이번에 닫는다(3.4).

## 3. 설계

### 3.1 서버가 발급하는 로그인 세션 토큰

| 부품 | 역할 |
|------|------|
| `app_sessions` 테이블 | `token_hash`(sha256 hex, PK), `user_id`(users FK, 삭제 시 cascade), `created_at`, `last_seen_at`, `expires_at`. RLS 켜짐·정책 없음·anon 권한 없음. 토큰 원문은 저장하지 않는다. |
| `app_login_throttle` 테이블 | 이름 단위 실패 횟수와 잠금 만료. anon 권한 없음. |
| `app_login(p_name, p_password)` | SECURITY DEFINER. 이름·비밀번호를 서버에서 대조하고 64자 hex 토큰을 발급한다. 실패는 예외가 아니라 `{ok:false, error}` 로 반환해 실패 횟수 기록이 롤백되지 않게 한다. 5회 실패부터 1·2·4·8·15분 지수 잠금. |
| `app_logout(p_token)` | SECURITY DEFINER. 세션 삭제. |
| `app_change_password(p_token, p_current, p_new)` | SECURITY DEFINER. 토큰으로 본인 확인 후 비밀번호 변경, `is_initial_password=false`, 다른 기기 세션 삭제. |
| `app_session_user_id(p_token)` | 내부 전용(anon EXECUTE 없음). 토큰 → 사용자 id. 만료 검사, 1시간 간격으로 `last_seen_at`/`expires_at`(+90일) 연장. 실패 시 SQLSTATE 42501. |

토큰은 `gen_random_uuid()` 두 개를 이어 붙인 64자 hex(약 244비트)로 만들고, DB 에는 sha256 해시만 저장한다. 세션 수명은 마지막 사용 기준 90일이다.

### 3.2 간트 RPC 래퍼

기존 함수 본문(ACL·CAS·멱등성·캘린더 projection)은 그대로 두고, 호출자용 래퍼만 추가한다.

| 공개 래퍼(anon EXECUTE, SECURITY DEFINER) | 내부 호출 |
|------|------|
| `gantt_session_read(p_session_token)` | `gantt_read(app_session_user_id(token))` |
| `gantt_session_execute(p_session_token, p_request_id, p_command)` | `gantt_execute(...)` |
| `gantt_session_calendar_events(p_session_token, p_from, p_to, p_event_id)` | `gantt_calendar_events(...)` |

- 내부 함수와 세 테이블은 차단 상태(anon 권한 없음)를 유지한다. 앱이 도달할 수 있는 유일한 경로는 토큰을 받는 래퍼다.
- 래퍼가 SECURITY DEFINER 인 이유: anon 은 테이블에 접근할 수 없으므로 소유자(postgres) 권한으로 본문을 실행해야 한다. 이는 Supabase 문서가 "의도된 공개 엔드포인트"로 분류하는 패턴이며(lint 0028 참고), 이 저장소의 `playground_*` RPC 도 같은 방식이다. 모든 래퍼는 `SET search_path = public, pg_temp` 를 고정한다.
- 생성 직후 `REVOKE ... FROM PUBLIC` 후 `anon, authenticated, service_role` 에만 EXECUTE 를 준다(이 프로젝트의 default privileges 가 새 함수에 anon EXECUTE 를 자동 부여하므로 내부 함수는 반드시 명시적으로 회수).

### 3.3 Realtime

세 테이블은 publication 에 다시 넣지 않는다(행 내용이 anon 구독자에게 흘러갈 수 있음). 대신 `gantt_spaces`·`gantt_projects` 에 statement 단위 AFTER 트리거를 두고 `realtime.send(jsonb_build_object('table', …), 'gantt-changed', 'bflow-realtime', false)` 로 **내용 없는 신호만** 공개 채널에 보낸다. Electron `realtime.ts` 는 기존 `bflow-realtime` 채널에 `broadcast` 리스너를 추가해 `onGanttChange` 를 호출하고, 앱은 지금처럼 RPC 재조회로 최신 상태를 받는다. 트리거는 `realtime.send` 실패를 WARNING 으로 삼켜 간트 저장을 막지 않는다.

### 3.4 비밀번호 컬럼 차단(2단계, 배포 후 적용)

토큰 경계가 있어도 `users.password` 를 anon 이 읽을 수 있으면 "비밀번호 읽기 → 로그인 → 토큰" 으로 우회가 남는다. 따라서 `users` 의 테이블 단위 SELECT/UPDATE 를 회수하고 `password`·`is_initial_password` 를 뺀 컬럼 단위 권한만 다시 준다(INSERT/DELETE 는 기존 관리자 RPC 경로 때문에 유지).

**적용 순서 제약**: 컬럼 권한을 제한하면 그 테이블에 `select *` 를 쓰는 클라이언트가 통째로 실패한다(Supabase 문서 명시). 현재 배포된 v1.110.1 은 `users` 를 `select('*')` 로 읽고 비밀번호를 로컬에서 대조하므로, 이 단계는 **팀 전원이 v1.111.0 이상으로 갱신된 뒤** 적용한다. 그래서 마이그레이션을 두 파일로 나눈다.

| 파일 | 적용 시점 |
|------|------|
| `DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql` | 지금(구 앱과 호환. 새 함수 추가만) |
| `DEVLOG/migrations/2026-09-06-users-password-lockdown.sql` | v1.111.0 배포·팀 갱신 확인 후 |

### 3.5 Electron 변경

- `supabase.ts`: `readUsers()` 는 명시 컬럼만 조회하고 `password` 를 반환하지 않는다. `loginSession`·`logoutSession`·`changeOwnPassword` RPC 호출 추가.
- `sessionManager.ts`: `remoteLogin`/`remoteLogout` 의존성 추가. 로그인 성공 시 토큰을 main 프로세스 안에만 보관하고, `auth.json`(기억된 세션)에 함께 저장해 재시작 후 복원한다. 렌더러로 보내는 payload 에는 토큰을 절대 포함하지 않는다. 서버 로그인이 불가능(오프라인·함수 미적용)하고 로컬 사용자 저장소에 비밀번호가 있을 때만 기존 로컬 대조로 내려간다(토큰 없음).
- `getSessionTokenFor(userId)`: canonical 사용자와 일치할 때만 토큰을 돌려주고, 아니면 "다시 로그인" 오류.
- `ganttStore.ts`: RPC 이름·인자를 래퍼 기준으로 바꾸고, actor id 대신 세션 토큰 해석기를 주입받는다. 호출부(`ganttIpc`, `calendarStore`)의 시그니처는 유지.
- `main.ts`: 의존성 배선, `auth:change-own-password` 를 토큰 RPC 경로로 전환(오프라인은 로컬 저장소 유지).
- `realtime.ts`: gantt `postgres_changes` 구독을 `broadcast` 리스너로 교체.

### 3.6 오류 처리

- 토큰 없음/만료: RPC 가 42501 과 한국어 메시지를 돌려주고, 간트 화면은 기존 오류 영역에 "다시 로그인해 주세요" 를 표시한다.
- 이미 로그인돼 있던 사용자(토큰 없는 기억된 세션)는 간트에서만 재로그인 안내를 보고, 나머지 기능은 그대로 쓴다.
- 로그인 잠금: `{ok:false}` 로 반환되므로 실패 카운트가 커밋된다.

## 4. 검증

- 단위: `tests/ganttPersistence.test.ts`(RPC 이름·토큰 주입), 새 `tests/sessionTokenAuth.test.ts`(로그인/복원/로그아웃/토큰 비노출/로컬 대조 조건).
- SQL: `DEVLOG/verification/2026-09-05-app-sessions-live-smoke.sql` 을 라이브 DB 에서 한 트랜잭션으로 실행 후 ROLLBACK — anon 역할로 잘못된 토큰 거부, 로그인·토큰·간트 읽기/쓰기, 보기 전용 거부, 로그아웃 후 거부, 잠금 동작, 테이블 직접 접근 거부.
- 라이브 적용 후: 실제 anon 키로 REST 호출(`app_login` → `gantt_session_read`), 보안 진단 확인, Realtime broadcast 수신 확인.
- `npm run typecheck`, 관련 테스트, `npm run build:vite`.

## 5. 남기는 과제

- 캘린더·사용자 관리 RPC(`*_authorized`)도 같은 토큰 경계로 옮기기.
- 비밀번호 해시화(`app_login` 이 대조를 담당하므로 이후 서버 쪽만 바꾸면 된다).
- 2단계 마이그레이션 적용(3.4).
