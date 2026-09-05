# 간트 릴리스 재검증 — v1.112.1

## 범위와 기준

- 사용자 요청: 이전 간트 작업 세션을 인수하고 테스트, 로컬 리뷰, 심층 리뷰 루프, 실제 설치본 배포까지 진행.
- 원본 작업: `Bflow 간트 차트 고도화`, `codex/gantt-workspaces`.
- 현재 기준: `origin/main`의 `abe55ff2c02b6937f722ae9df346b7cabae20008`. PR #264의 간트/로그인 세션 구현과 PR #263의 캐릭터/작업 경로 개선을 포함한다.
- 원본 간트 UI 13개 파일은 현재 소스와 줄바꿈 외 내용이 같다. 원래 워크트리와 기본 체크아웃의 미커밋 파일은 보존한다.
- 작업 위치: `C:/Bflow-BGonly/.worktrees/gantt-release-audit`, `codex/gantt-release-audit`.
- 시작 시 공유 드라이브와 설치본은 v1.112.0. 설치 로그에 2026-09-06 00:07:57 KST `installer apply OK`를 확인했다.

## 진행 계획

1. [x] 이전 세션, 원본/현재 코드, PR, 배포 버전, 운영 DB 적용 상태 확인.
2. [x] UI/상태 및 저장/권한 독립 로컬 리뷰, 전체 기본 검증.
3. [x] 재현된 문제의 실패 테스트 작성, 최소 수정, SQL/preview 동등성 확인.
4. [x] 전체 타입/테스트/build:vite, 실제 브라우저 입력, 수정 후 독립 리뷰.
5. [ ] 한국어 PR 생성, Codex 리뷰 4개 표면 확인 및 지적 수정 루프.
6. [ ] 검토된 migration 예행연습/운영 적용, 최종 커밋 머지, 해당 커밋의 정식 build.
7. [ ] 설치 파일 먼저/manifest 마지막 배포, 전체 파일 크기·SHA-256·버전 검증 및 설치 상태 확인.

## 시작 시 검증

- `npm ci --no-audit --no-fund`: exit 0, lockfile 기준 설치.
- `BFLOW_PGLITE_MODULE`을 실제 PGlite 실행기에 연결한 기준 코드의 `npm run build:vite`: **2,125 pass / 0 fail / 0 cancelled / 0 skipped / exit 0**.
- 운영 Bflow 프로젝트 `mpqifkpxalwxgcrddchv`: ACTIVE_HEALTHY.
- 로그인/세션/보기 권한/변조 토큰/잠금 카운터 검증 SQL: `passed: true`, 모든 쓰기 ROLLBACK.
- 직접 비밀번호 SELECT 및 내부 `gantt_read` 실행은 anon에서 불가, 세션 래퍼만 실행 가능. 간트 폴더/프로젝트 0행.
- 운영에는 `gantt_delete_triggers_security_definer`와 `users_password_lockdown`까지 적용됐다. 이전 구현 문서의 '2단계 미적용' 기록은 현재 상태와 다르다.

## 재현된 리뷰 항목

- 그룹 자식 추가/삭제에서 자동 후속 일정 재계산 누락.
- 공유 멤버 제거 후 해당 멤버 소유 프로젝트의 저장 거부.
- 자신의 여러 엔티티 변경을 연속 취소할 때 원격 변경으로 오인.
- 연결 작업의 종류 변경이 캘린더 편집 권한 검사를 건너뛰어 일정 표시를 제거할 수 있음.
- 운영에서 고친 삭제 트리거 실행 권한이 소스 재구성 경로에는 누락.
- 로그인 세션 토큰이 `auth.json`에 평문 저장됨.
- 2차 리뷰 추가: 폴더 생성 실행 취소의 조회와 삭제 사이에 다른 창이 만든 프로젝트가 함께 삭제될 수 있음. 빈 폴더만 취소하도록 원자적 `requireEmpty` 조건을 추가한다.

각 항목을 실패 회귀 테스트로 재현한 뒤 수정했다. 기존 RPC 서버 장애 시 로그인 실패는 인증 우회를 추가하지 않고 명시적 오류로 유지한다.

## 수정 후 검증과 심층 리뷰

- `npm run build:vite`: **2,161 tests / 2,161 pass / 0 fail / 0 cancelled / 0 skipped / exit 0**. PGlite DB 실행을 포함한다.
- 마지막 소스 변경 후 `npm run typecheck`: **exit 0**.
- UI/상태 42개, DB/저장 35개, 암호화/세션 22개 집중 검증 통과. 이 수치는 전체 실행과 겹치므로 별도로 합산하지 않는다.
- UI 담당과 DB 담당이 서로 수정본을 재검토했다. 2차에서 발견한 원격 프로젝트 삭제 경쟁 조건과 history revision 혼동까지 수정한 최종 소스에 추가 P1/P2 없음.
- `requireEmpty`는 클라이언트 조회만 믿지 않고 DB lock/CAS 이후 다시 확인한다. 명시적 폴더 삭제는 기존 동작을 유지한다.
- 첫 수정 후 전체 실행은 소유권 이관에 따른 revision 증가의 기존 기대값 불일치로 실패했다. 실제 CAS 계약에 맞게 기대값을 고친 뒤 위 최종 전체 실행으로 확인했다.
- 다중 실제 PC의 Electron 조작 및 운영 DB 동시 부하 실험은 수행하지 않았다. 브라우저 두 창 충돌, PGlite 경쟁 조건 회귀, 운영 DB 롤백 smoke로 확인한 범위를 구분한다.

## 실제 입력과 암호화 확인

- in-app browser `http://127.0.0.1:4327/?preview=1`, 배한솔/1234로 로그인 후 타임라인 진입.
- 실제 포인터 드래그로 교육 자료 정리를 9/6~8에서 9/7~9로 이동해 저장, 실행 취소로 원래 날짜 복원.
- 휠 입력으로 확대율 100% → 141%, 우클릭 빠른 편집에서 제목·메모·색상 동시 저장 후 실행 취소.
- 두 창에서 같은 작업 편집: 첫 창의 미저장 초안을 유지한 채 둘째 창 변경을 수신하고, 충돌 안내와 저장 비활성화를 확인. 검증용 수정은 실행 취소했다.
- Electron **33.4.11 / Windows**의 실제 safeStorage: 암호화 사용 가능, 저장·복원·평문 세션 이관·로그아웃 성공. 파일에 원문 토큰 없음. 임시 userData 및 임의 토큰만 사용하고 모두 정리했다. 운영 로그인 파일은 읽거나 변경하지 않았다.
- 브라우저 preview는 실제 운영 Electron/여러 팀원 PC 검증과 구분한다. 설치 버전과 installer 적용 로그는 별도로 검증한다.

## 운영 DB 예행연습

- 기존 보안 진단 기준: ERROR 3개는 `comments_archive`, `comp_revisions_archive`, `comment_reaction_notifications`의 기존 RLS 항목이다. 이번 간트 수정 범위가 아니므로 기존 설정을 임의 변경하지 않는다. [진단 기준](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
- 첫 SQL 조립 시 JavaScript 문자열 치환이 dollar quote를 바꿔 구문 오류가 났다. DB 변경 전 중단됐으며 함수형 치환으로 원문을 보존한 뒤 migration + smoke 롤백 예행연습이 `passed: true`였다.
- `requireEmpty`까지 포함한 최종 migration + smoke를 운영 DB에서 다시 롤백 예행연습해 `passed: true`를 확인했다. 종료 후 폴더/프로젝트 0행, 검증용 사용자 잔여 0행이다.
- 실제 적용 및 배포는 PR 검토 이후에 진행한다. 이 문서의 체크되지 않은 단계는 완료 주장에 포함하지 않는다.
