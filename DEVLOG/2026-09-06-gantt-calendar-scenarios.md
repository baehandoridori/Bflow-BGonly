# 간트·캘린더 상황별 인수 검증

- 요청: 실제 앱 동작과 오류, 간트·캘린더 연동을 상황별로 확인하고 발견한 문제는 수정·로컬 리뷰·재빌드·배포한다.
- 시작 기준: `origin/main` `367f01893327b08d3da3db015ec01c6fdc333c0f`, 앱 v1.112.1.
- 작업 위치: `.worktrees/gantt-calendar-scenarios`, `codex/간트-캘린더-시나리오-검증`.
- 리뷰: 사용자 지시에 따라 GitHub Codex 리뷰를 로컬 심층 리뷰로 대체한다.
- 데이터: 실제 사용자 일정은 편집하지 않는다. 화면 시험은 별도 개인 검증 폴더/프로젝트만 사용하고 만든 항목의 ID를 기록해 정리한다. DB 권한·경쟁·실패 검증은 격리 DB 또는 롤백 트랜잭션으로 수행한다.

## 실행 순서

1. 설치본 업데이트 적용과 재실행, 기존 간트·캘린더 테스트 기준 결과 확보.
2. 아래 상황표대로 화면·공용 로직·실제 저장 경계를 검증하고 증거 기록.
3. 재현된 오류에 한해 실패 테스트를 추가하고 최소 수정. 수정 담당 외 독립 로컬 리뷰 후 재검증.
4. 필요한 버전/업데이트 내역, 타입 검사·관련 테스트·웹 빌드·정식 빌드 검증.
5. PR 병합 후 정확한 병합 커밋으로 빌드하고 산출물 검증 → manifest 마지막 배포 → 전체 해시/설치 적용 확인.

## 상황표

| ID | 상황 | 기대 결과 | 검증 경로 | 결과 |
|---|---|---|---|---|
| A01 | 준비된 업데이트 적용 | 앱 종료 후 설치·재실행, 버전·설치 로그·pending 정리 일치 | Windows 설치본 | 1.112.0 → 1.112.1 실제 적용 통과 |
| G01 | 개인 폴더·프로젝트·작업 생성 | 저장 후 새로고침에도 보존, 다른 사용자에게 비공개 | preview + 격리 DB + Windows 설치본 | 통과. 실제 계정의 개인 폴더·프로젝트·작업 저장 및 재진입 후 보존 확인 |
| G02 | 작업 이름·메모·색상·담당자·기간 편집 | 즉시 반영 및 저장 결과 일치 | preview + 자동 | 제목·메모·기간 화면 통과, 나머지 domain 회귀 통과 |
| G03 | 막대 이동·리사이즈·확대·그룹·마일스톤 | 날짜·상하위 기간·선행 후속 일정 일치 | preview + 자동 | geometry/canvas/domain 통과, 마일스톤 화면 통과 |
| G04 | 완료·복원·실행 취소·재실행 | 표시와 저장 일치, 원격 변경 덮어쓰기 없음 | preview + 자동 + Windows 설치본 | 완료/취소/재실행 및 프로젝트 반복 복원 preview 통과. 설치본 삭제→복원→재삭제, revision 7→8 및 두 작업 보존 확인 |
| C01 | 개인 캘린더 연결 | 해당 작업만 일정으로 표시, 중복 복제 없음 | preview + 격리 DB + Windows 설치본 | 월 화면·상세·RPC projection 통과. 설치본의 작업·마일스톤 2개 연결 확인 |
| C02 | 간트에서 제목·날짜·시간·메모 수정 | 캘린더 월/주/상세에 같은 값 표시 | preview + 자동 + Windows 설치본 | 월/상세 실제 조작, 주간·매핑 회귀 통과. 설치본 제목·메모·3일 기간·10:00 마일스톤 반영 확인 |
| C03 | 캘린더 상세·드래그로 수정 | 원본 간트 작업 변경, 자동 일정 처리 일치 | preview + 자동 + Windows 설치본 | 상세 편집 양방향 화면 및 운영 원본 저장 확인. DnD/domain 회귀 통과 |
| C04 | 종일/시간 지정·자정·여러 날·월 경계 | 종료일 포함 규칙·시간대·표시 길이 일치 | 자동 + preview | 날짜/시간 회귀 통과, 9/30–10/2 → 9/29–10/2 및 0분 마일스톤 화면 통과 |
| C05 | 캘린더 변경·연결 해제·작업/프로젝트/폴더 삭제 | 이전 projection 제거, 기존 일반 일정 보존 | preview + 격리 DB | 삭제·연결 해제 자동 통과, 프로젝트 삭제/복원 화면 통과 |
| P01 | 소유자·편집자·보기 전용·비멤버 | 간트와 연결 캘린더 양쪽 권한 강제 | 격리 DB + 자동 | session/containment/release DB 계약 통과 |
| P02 | 공유 회수·캘린더 삭제·세션 만료 | 남은 접근 차단, 오래된 화면/요청 복구 | 격리 DB + 자동 | RPC·epoch·preview 회귀 통과. 시작 시 유효 토큰의 서버 만료 조회는 이번 수정 범위 밖 |
| R01 | 두 창에서 동시 편집·충돌 | 최신 데이터 보존, 충돌 안내, 안전한 재시도 | 두 preview + 격리 DB | 최신 변경 안내·미저장 메모 보존·저장 차단, 삭제/복원 알림 수신 통과 |
| R02 | 저장 실패·늦은 응답·재조회 실패 | 낙관적 상태 롤백, 오류 표시, 사용자 변경 보존 | 제어 가능한 자동 시험 | ganttPersistence/RevisionPreview 및 calendar failure 회귀 통과 |
| R03 | preview 새로고침·다른 탭 알림 | 개인/공유 권한·일반 일정 손실 없음 | preview + 자동 | 재진입 시 두 작업·메모 보존, 공유 탭 알림 및 calendar fanout 통과 |
| A02 | 수정 후보 로컬 심층 리뷰 | 재현된 중요 지적 해결, 최종 코드에 clean | 독립 리뷰 | DB/preview/history ↔ UI/mock 교차 clean, auth 독립 clean, smoke 재리뷰 clean |
| A03 | 병합 빌드·배포·설치 | 버전/전체 해시 일치, manifest 마지막, 실제 적용 | 빌드 + G드라이브 + 설치본 | 1.112.2 빌드·배포·설치·로그인 안내 및 로그인 후 실제 계정 CRUD/캘린더 양방향 수정 통과 |

## 증거 및 발견 사항

### 발견한 문제와 수정

1. **P1 삭제·복원 후 오래된 저장이 최신 작업을 지움**: 프로젝트 revision이 1로 재설정되는 ABA를 실제 `app_login` → anon `gantt_session_execute` 경로로 재현했다. 비공개 revision ledger로 삭제·복원·폴더/캘린더 cascade 뒤에도 버전을 유지한다. 예전 삭제 기록은 최종 버전을 확정할 수 없으면 해당 ID의 복원을 거부하고 새 항목 작성을 안내한다. 이력 자체가 없어진 과거 ID까지 복구할 수는 없다.
2. **P2 시간 지정 마일스톤을 캘린더에서 저장하지 못함**: 기존 화면에서 10:00–10:00의 제목만 바꿔도 저장이 막혔다. canonical task kind를 전달하고 마일스톤의 종료일/시각을 시작과 함께 이동시킨다. 수정 화면에서 9/29 10:00 → 9/30 11:30, 제목·메모 저장 및 간트 원본 반영을 확인했다.
3. **P2 preview 캘린더 삭제 후 작업 편집 불가**: 삭제된 calendarId가 남는 문제를 잠금 안의 연결 해제와 실패 원복으로 수정했다. 캘린더·태그처럼 연결 일정에서 지원하지 않는 편집 선택지도 안내와 함께 정리했다.
4. **토큰 없는 기억된 로그인으로 실제 간트 화면 진입**: 실제 설치본의 `gantt:read`에서 재로그인 오류를 확인했다. 원격 로그인 환경에서 토큰이 없거나 복호화되지 않으면 대시보드에 들어가지 않고 기존 로그인 화면에서 이유를 안내한다. 정상 토큰과 원격 로그인을 쓰지 않는 기존 테스트 환경은 유지한다. 사용자 암호를 대신 입력하지 않았으며, 이후 로그인된 설치 앱에서 실제 저장 검사를 완료했다.

### 로컬 심층 루프

- 수정 담당자와 다른 담당자가 DB/preview/history, UI/mock, auth를 각각 검토했다. 지적 수정 후 최종 기능 코드에 추가 P1/P2 없음(clean).
- 운영 smoke의 `NULL <> expected`가 빈 응답을 통과시키는 문제도 실제 변형 실행으로 재현했다. `IS DISTINCT FROM`과 배열 개수·ID·날짜·시각 검사를 추가했고, 빈 projection·kind/time 누락·로그인 ok 누락·빈 folder/project·revision 누락 7개 변형이 모두 실패하는 것을 확인했다.
- 첫 전체 빌드에서 calendar fanout 테스트 1개가 Web Locks 없는 기존 Node 모형 때문에 실패했다. production guard는 유지하고 이름별 직렬 잠금을 테스트 모형에 추가했다. 전체 캘린더 947/947 통과로 회복했다.

### 검증 수치

- 변경 전 기준: 간트 124 + 캘린더 938 = **1,062개 통과**.
- 최종 `npm run typecheck`: exit 0.
- 최종 `npm run build:vite`: **2,199개 통과**, fail 0, cancelled 0, skipped 0, exit 0. 실제 PGlite 모듈을 지정해 DB 테스트를 건너뛰지 않았다.
- 묶음별: playground 461, auto-update 29, entity 249, notifications 144, presence 38, character 161, calendar 947, UI 17, gantt/auth 153.
- 별도 독립 검사: auth 49개 + UI/service 6상황, SQL smoke 및 변형 18개 통과. 전체 수치에 중복 합산하지 않는다.
- 로그: `%TEMP%/bflow-gantt-scenarios-build-vite-final.log`, `%TEMP%/bflow-gantt-auth-reauth-red.log`, `%TEMP%/bflow-gantt-auth-reauth-green.log`.
- 설치 적용: `%TEMP%/bflow-gantt-scenarios-installed-1.112.1.json`, 설치 helper 종료 코드 0, 재실행 package 1.112.1, pending 정리 확인.

### 검증 범위

- 브라우저 실제 조작은 로컬 preview 데이터이며 운영 사용자 일정 변경 증거가 아니다. 검증 폴더 `__검증_간트연동_0906`, 프로젝트 `__검증_양방향일정`을 사용했다.
- DB 권한·실패·경쟁 순서 검사는 PGlite 실제 SQL/RPC 실행이다. 실제 여러 DB 연결의 동시 잠금 부하 검사는 수행하지 않았다.
- 운영 DB는 사전 조회에서 spaces/projects/requests가 0이었다. 적용과 배포 증거는 아래에 기록한다.

## v1.112.2 배포 기록

- 기능 PR: [#268](https://github.com/baehandoridori/Bflow-BGonly/pull/268), 2026-09-06 02:58:54 KST 병합.
- 정확한 병합 커밋: `09dd0dbf565d2643508f3261eb5a4dbcd00b095d`. 검증한 PR head와 tree 차이 없음.
- 빌드: `.worktrees/release-v1.112.2-09dd0dbf`의 clean detached HEAD에서 `npm ci` 후 실제 PGlite를 지정한 `npm run build` 실행. **2,199 pass / 0 fail / 0 cancelled / 0 skipped, exit 0**.
- 정식 빌드 renderer도 localhost preview에서 로그인 후 타임라인 3개 프로젝트와 캘린더 18개 일정 표시, console error 0을 확인했다. 개발 서버의 화면 검사와 구분한다.
- 로컬 산출물 독립 리뷰: 전체 파일 SHA-256 재계산 및 candidate 대조 7,327/7,327 일치. 설치 파일/패키징 앱 PE 버전, main/preload/renderer 원본→패키징 해시, latest.yml 양쪽 SHA-512, 과거 업데이트 내역 177개 원문 및 전체 178개 내역 보존 확인.

### 운영 DB

- 저장소 migration `20260905173804_gantt_revision_ledger.sql`을 운영 `20260905175926_gantt_revision_ledger`로 적용했다.
- 실제 운영 DB의 anon 역할에서 fixture `app_login` → session RPC로 내부 직접 접근·위조 토큰 거부, 반복 삭제/복원, 오래된 저장/삭제 차단, 0분 마일스톤 projection, 캘린더 연결 해제, 폴더 연쇄 삭제를 확인했다. 최종 `passed=true`.
- 한 transaction의 `ROLLBACK` 후 전후 counts 동일: users 17, app_sessions 0, spaces 0, projects 0, requests 0, revisions 0, calendars 12. 기존 사용자 일정은 수정하지 않았다.
- ledger 직접 SELECT는 anon/authenticated 모두 false, RLS true. 기존 advisory WARN 31 / ERROR 3은 증가하지 않았다. 의도적으로 직접 읽을 수 없는 private ledger의 `RLS enabled / no policy` INFO 1개만 추가됐다.
- 증거: `%TEMP%/bflow-gantt-scenarios-live-db.json`.

### G드라이브 전송과 재개

- 대상: `G:/공유 드라이브/JBBJ 자료실/한솔이의 두근두근 실험실/Bflow-BGonly/dist`.
- 기존 1.112.1 installer·latest.yml·manifest.json은 `%TEMP%/bflow-before-1.112.2-20260906-030511`에 백업했다. 독립 검토에서 3개 해시와 installer SHA-512가 이전 배포와 일치했다. 전체 이전 산출물은 기존 `.worktrees/release-v1.112.1-b96df3fa/dist`에 남아 있다.
- 최초 복사는 전송 도중 실행 프로세스가 종료됐다. 프로세스가 없고 최종 보고서도 없음을 확인한 뒤 기존 manifest를 유지한 채 전체 파일을 비교했다. 7,313개가 일치했고 lucide-react의 작은 파일 13개만 불일치했다. 확인한 13개만 다시 복사하고 각 해시 및 전체 파일을 재검증했다.
- **03:26:49 KST**: 이전 manifest 해시를 유지한 채 나머지 **7,326개 파일 전부 일치**, 불일치 0.
- 그다음 manifest를 마지막에 복사했다. **03:27:08 KST**: 전체 **7,327/7,327개, 922,921,271 bytes**, SHA-256 불일치 0.
- win-unpacked는 **7,200개, 695,277,664 bytes**이며 manifest와 일치한다. 0byte 파일 6개는 원본 의존성에도 동일하게 존재하며 복사 실패가 아니다.
- 독립 배포 검토는 원격 핵심 5개 파일을 직접 재해시하고 전체 비교 보고서의 파일별 해시·manifest-last 순서를 확인했다.

| 파일 | 크기(bytes) | SHA-256 (로컬·원격 동일) |
|---|---:|---|
| BFLOW-Setup.exe | 201,359,469 | `441ed4ca0e079b67a62768501bbd20407472b89f5a42a3ea27522b6e7325e7ea` |
| latest.yml | 329 | `f706aa0b660a17a2639878124579ce860a90827c69fd5aa6df6a1bcef45fab5c` |
| manifest.json | 242,144 | `9701cadab0714ed7ce8c6b1b9982e5707333a88e26dc25422e6a723c5a6e1ac8` |

- 증거: `%TEMP%/bflow-gantt-scenarios-candidate.json`, `bflow-gantt-scenarios-resume-precommit.json`, `bflow-gantt-scenarios-repair.json`, `bflow-gantt-scenarios-deploy-precommit.json`, `bflow-gantt-scenarios-deploy-verification.json`.
- 브라우저 검증용 프로젝트와 연결 일정 2개는 삭제했고, 기존 캘린더 일정 18개가 남음을 확인했다. 빈 preview 검증 폴더는 폴더 삭제 UI가 없어 남아 있다. 별도 기능 추가나 전체 preview 데이터 초기화는 하지 않았다.

### 실제 설치본

- 앱 업데이트 목록에서 현재 1.112.1 / 준비된 최신 1.112.2를 확인했다. 로컬에 받은 installer도 위 SHA-256과 일치한 뒤 정상 `지금 업데이트` 버튼을 눌렀다.
- 03:28:22 KST 앱의 모든 프로세스가 종료된 뒤 installer가 시작됐고, **03:29:03 KST 종료 코드 0 및 BFLOW 재실행, installer apply OK**를 확인했다. installer-pending도 정리됐다.
- 설치된 package 버전은 **1.112.2**이며 BFLOW.exe, package.json, main.js, preload.js, renderer index.html 5개가 빌드 원본과 SHA-256 일치했다. 증거: `%TEMP%/bflow-gantt-scenarios-installed-1.112.2.json`.
- 새로 실행된 Windows 앱의 로그인 화면에서 `저장된 로그인 정보를 다시 확인해야 합니다. 이름과 비밀번호로 다시 로그인해 주세요.` 안내가 실제 표시됐다. 예전처럼 토큰 없는 상태로 간트 화면에 들어가지 않는 것을 확인했다.
- 로그인된 대시보드를 확인한 뒤 **03:48 KST까지 실제 계정의 Windows 설치본 검증을 완료**했다. 인증 입력을 자동화하지 않았으며, 검증 동작은 실제 앱의 입력창·목록·저장 버튼·실행 취소/다시 실행으로 수행했다.

### 실제 계정의 간트·캘린더 인수 결과

- 개인 폴더 `__실앱검증_0906_간트연동`와 프로젝트 `__실앱검증_양방향_0906`을 생성했다. 운영 DB의 `shared=false`, 빈 members, 해당 폴더 아래 저장된 프로젝트를 별도 읽기로 확인했다.
- 간트에서 종일 작업 `__실앱검증_3일작업`을 9/6–9/8, 검증 메모와 함께 개인 캘린더에 연결했다. 캘린더 월 화면과 상세에서 제목·3일 기간·메모가 일치했다.
- 캘린더 상세에서 제목을 `__실앱검증_캘린더수정`, 시작일을 9/7, 메모를 `캘린더에서 수정한 메모: 9월 7~8일`로 저장했다. 운영 간트 원본 revision 4에서 같은 값이 확인됐고, 타임라인 재진입 시 같은 제목의 **2일 막대**가 표시됐다.
- 시간 지정 마일스톤을 9/7 **10:00–10:00**으로 연결했다. 캘린더에서 9/8 **11:00–11:00**으로 수정할 때 종료 날짜·시간이 시작값을 따라가며 수정 불가로 표시됐고 저장은 정상 동작했다. 운영 원본 revision 7의 `kind=milestone`, `allDay=false`, 두 시각 11:00 및 타임라인의 **0일 마일스톤**을 확인했다.
- 프로젝트 삭제 후 운영 행 0 → 앱 실행 취소 후 **revision 8 / ledger 8**로 복원됐다. 두 작업의 ID·제목·날짜·시간·메모·캘린더 연결은 삭제 전과 동일했다. 앱의 다시 실행으로 재삭제한 뒤 운영 행 0을 확인했다.
- 검증 폴더는 삭제 UI가 없으므로 **ID·이름·소유자·revision·비공개 상태·빈 하위 프로젝트를 잠금 안에서 모두 확인한 SQL로 그 빈 폴더 1개만 정리**했다. 이 정리는 UI 삭제 기능 검증에 포함하지 않는다. 실제 앱에서도 폴더가 사라지는 재조회 반영을 확인했다.
- 최종 검증 폴더/프로젝트 0개, 캘린더의 검증 연결 일정 0개. 월 화면에는 기존 일정 4개가 남았다. 연결했던 개인 캘린더의 일반 일정 2개는 삭제/정리 전후 fingerprint `2faf83735a1e57962198c50131e15a7b`로 동일했다. 중복 저장 방지용 요청 이력과 revision ledger는 정상 보존한다.
- 원래 화면에 있던 별도 폴더·프로젝트·작업은 유지했으며, 검증 종료 후 타임라인으로 돌아왔다. 설치본의 검증 동작에서 저장/연동 오류는 관찰하지 않았다.
- 증거 요약: `DEVLOG/verification/2026-09-06-gantt-native-acceptance.json`. 이 기록은 실제 UI 관찰 및 운영 DB 읽기 결과의 정리이며, 자동화 테스트 실행 결과와 구분한다.
- 검증 범위: 실제 계정 1개에서 위 핵심 흐름을 직접 조작했다. 여러 실사용자 계정/PC의 동시 UI 조작은 수행하지 않았고, 권한·충돌·롤백·드래그 경계는 앞서 기록한 DB/자동 시험과 두 preview 탭 검증으로 확인했다.
