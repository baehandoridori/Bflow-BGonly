# 간트 호출자 검증 경계 — 로그인 세션 토큰 적용 기록

작업 위치: `claude/gantt-migration-auth-boundary-79e7bf` (`C:/Bflow-BGonly/.claude/worktrees/focused-bassi-28f123`).
설계: `docs/superpowers/specs/2026-09-05-gantt-session-auth-design.md`.

## 문제

`gantt_workspaces`(20260905124058)는 anon 역할에 간트 테이블 직접 접근과 allow-all RLS 를 주고, RPC 는 호출자가 보낸 `p_actor_id` 를 그대로 믿었다. 배포되는 anon 키만 있으면 소유자/편집자/보기 검사를 우회할 수 있어 `gantt_security_containment`(20260905125843)로 anon 권한을 전부 회수했고, 그 결과 간트 기능도 멈춘 상태였다. 리뷰(GPT)가 같은 항목을 반복 지적한 이유는 차단이 임시 조치이고 원래 구조가 그대로였기 때문이다.

## 적용한 것

### 라이브 DB — `app_sessions_gantt_session_auth` (버전 **20260905133702**, 2026-09-05)

소스: `DEVLOG/migrations/2026-09-05-app-sessions-gantt-auth.sql`. 적용 전 같은 내용 + smoke 를 `BEGIN … ROLLBACK` 한 배치로 예행연습해 `passed: true` 를 확인한 뒤 적용했다.

| 항목 | 내용 |
|------|------|
| `app_sessions`, `app_login_throttle` | 토큰 해시(sha256)와 로그인 잠금. RLS 켜짐·정책 없음·anon/authenticated 권한 없음. |
| `app_login` / `app_logout` / `app_change_password` | SECURITY DEFINER 공개 엔드포인트. 비밀번호 대조와 토큰 발급을 서버가 한다. 실패는 `{ok:false}` 반환(잠금 카운터가 롤백되지 않게). 5회 실패부터 1·2·4·8·15분 잠금. |
| `app_session_user_id` | 내부 전용(anon 실행 불가). 토큰 → 사용자 id, 만료 검사, 1시간 간격 90일 연장. |
| `gantt_session_read/execute/calendar_events` | 토큰을 받아 내부 `gantt_*` 를 실행하는 SECURITY DEFINER 래퍼. 앱이 닿을 수 있는 유일한 경로. |
| 내부 `gantt_*` 함수·세 테이블 | 차단 유지(anon 권한 없음, allow-all 정책 없음). |
| Realtime | 테이블은 publication 에 넣지 않는다. statement 트리거가 `realtime.send(…, 'gantt-changed', 'bflow-realtime', false)` 로 테이블 이름만 broadcast. |

### 앱 (v1.111.0)

- `electron/sessionManager.ts`: 서버 로그인(`remoteLogin`) 우선. 토큰은 main 메모리와 `auth.json` 에만 두고 renderer payload 에서는 항상 벗겨낸다. 서버에 닿을 수 없을 때만 비밀번호를 가진 디렉터리(로컬 저장소)로 대조(토큰 없음). 사용자 전환·로그아웃 시 이전 토큰 서버 폐기.
- `electron/supabase.ts`: `readUsers()` 는 명시 컬럼만 읽고 비밀번호를 돌려주지 않는다. `loginSession`/`logoutSession`/`changeOwnPasswordWithSession` 추가.
- `electron/ganttStore.ts`: RPC 이름·인자를 래퍼 기준으로 바꾸고 세션 토큰 해석기를 주입받는다. 토큰이 없으면 요청을 보내지 않고 재로그인 안내. 캘린더 목록의 projection 조회는 세션 없음/만료를 빈 목록으로 처리해 캘린더를 막지 않고, 쓰기 경로는 오류를 그대로 올린다.
- `electron/main.ts`: 의존성 배선, `auth:change-own-password` 를 토큰 RPC 경로로 전환.
- `electron/realtime.ts`: gantt `postgres_changes` 구독 → `broadcast` 리스너.

## 검증

| 검증 | 결과 |
|------|------|
| 예행연습(마이그레이션 + smoke, 한 트랜잭션, ROLLBACK) | `passed: true` |
| 적용 후 `DEVLOG/verification/2026-09-05-app-sessions-live-smoke.sql` (anon 역할, 8개 항목, ROLLBACK) | `passed: true`. 검증용 사용자 잔여 0행. |
| 실제 anon 키 REST 호출 | 아래 표 |
| Realtime | `bflow-realtime` 공개 채널 구독 후 `realtime.send` 신호 수신 확인(`RECEIVED … "event":"gantt-changed"`). |
| 보안 진단 | 새 ERROR 0. 의도된 WARN: 공개 SECURITY DEFINER 6개(lint 0028/0029, 기존 `playground_*` RPC 와 같은 패턴). INFO: `app_sessions`/`app_login_throttle` RLS 정책 없음(의도: anon 접근 자체가 없음). |
| `npm run typecheck` | 통과 |
| `npm run test:gantt` | 74 tests · 73 pass · 1 skipped(PGlite 없음) |
| `npm run test:calendar` | 938 pass |
| `npm run build:vite` | exit 0 · 전체 2,098 tests · 2,097 pass · 0 fail · 1 skipped(PGlite) · renderer/main/preload 번들 생성 |
| 2단계 마이그레이션 예행연습(라이브, ROLLBACK) | `passed: true` — 아래 REST 표 하단 참고 |

REST 검증(임시 사용자 `rest-check-2026-09-05`, 검증 뒤 삭제):

| 호출 | 기대 | 결과 |
|------|------|------|
| `rpc/app_login` 올바른 비밀번호 | 200, 토큰 64자, user 에 password 없음 | ✅ 200 `ok=true`, 토큰 64자, user 키에 password 없음 |
| `rpc/app_login` 틀린 비밀번호 | 200 `{ok:false}` | ✅ 200 `{"ok":false,"error":"비밀번호가 일치하지 않습니다."}` |
| `rpc/gantt_session_read` 유효 토큰 | 200 `{spaces:[],projects:[]}` | ✅ 200 `{"spaces":[],"projects":[]}` (`gantt_session_calendar_events` 200 `[]`) |
| `rpc/gantt_session_read` 위조 토큰 | 4xx 42501 | ✅ 401 42501 "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." |
| `GET gantt_spaces`, `GET app_sessions`, `POST gantt_spaces` | 4xx permission denied | ✅ 모두 401 42501 permission denied for table |
| `rpc/gantt_read`, `rpc/gantt_execute`, `rpc/app_session_user_id` | 4xx (실행 권한 없음) | ✅ 모두 401 42501 permission denied for function |
| `rpc/app_change_password` 틀린 현재 비밀번호 | 200 `{ok:false}` | ✅ 200 `{"ok":false,"error":"현재 비밀번호가 일치하지 않습니다."}` |
| `rpc/app_logout` → `gantt_session_read` | 204 → 4xx 만료 | ✅ 204 → 401 만료 |
| `GET users?select=id,password` (anon) | 2단계 전이라 아직 200 | ⚠️ 200 — 2단계(`2026-09-06-users-password-lockdown.sql`) 적용 뒤 401 이 된다. 롤백 예행연습으로 새 앱 조회·RPC 호환을 확인했다(아래). |

2단계 예행연습(라이브, `BEGIN … ROLLBACK`): 컬럼 권한 축소 후 anon 으로 명시 컬럼 디렉터리 조회 성공, `password` 조회·`select *`·`password` UPDATE 는 permission denied, `app_login`/`gantt_session_read`/`app_change_password` 정상, `update_user_authorized`(본문 교체판)·`create_user_authorized` 정상 → `passed: true`.

## 남은 순서

1. v1.111.0 빌드·배포(간트 릴리스). 예전에 로그인해 둔 계정은 간트 화면에서 재로그인 안내를 보는 것이 정상이다.
2. **팀 전원 갱신 확인 뒤** `DEVLOG/migrations/2026-09-06-users-password-lockdown.sql` 적용. anon 의 `users.password` 읽기/쓰기를 막아 "비밀번호 읽기 → 로그인" 우회를 닫는다. 그 전에 적용하면 v1.110.1 이하 로그인이 즉시 깨진다.
3. 후속: 캘린더·사용자 관리 `*_authorized` RPC 도 같은 토큰 경계로 이전, 비밀번호 해시화.
