# B flow 간트 실제 구현 계획

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 승인된 간트 디자인을 앱 타임라인에 연결하고 기간·우클릭 색상 편집·공유·캘린더 양방향 편집을 구현한다.

**Architecture:** React 간트 화면 → 낙관적 상태 → canonical main 세션을 검증하는 IPC → Supabase 원자적 RPC. 프로젝트 단위 revision으로 하위 작업 전체의 변경을 검증하며, preview는 같은 명령과 권한을 Web Locks로 직렬화한다. 연결 캘린더 일정은 원본 작업을 그대로 조회하는 projection이며 별도 이벤트 복제 없이 같은 작업을 수정한다.

**Tech Stack:** 기존 React 18, TypeScript, Zustand, Electron, Supabase/PostgreSQL. 새 UI 라이브러리 불필요.

**Spec:** `docs/superpowers/specs/2026-09-05-gantt-workspaces-design.md`

**후속 범위 변경 (2026-09-05):** 사용자의 ‘실제 데이터에도 적용시키는 작업 해보자’ 요청에 따라 초기 구현에서 제외한 운영 DB 적용을 진행했다. 별도 결과는 `DEVLOG/2026-09-05-gantt-live-application.md`에 기록한다. PR·머지·설치본 배포는 계속 범위 밖이다.

## Global Constraints

- 구현은 `C:/Bflow-BGonly/.worktrees/gantt-workspaces`, 브랜치 `codex/gantt-workspaces`에서 수행한다. 루트 시안·다른 작업은 보존한다.
- 시안에서 승인된 막대 옆 이름, 격자 없는 다크/라이트 테마, 공통 툴팁 사용감, 폴더 공유, 완료 보기를 유지한다.
- 총 일수는 시작·종료일 포함, 시간 지정은 경과 일·시간, 마일스톤은 기간 0인 시점이다.
- 기존 앱은 Electron canonical user + DB actor ACL을 사용한다. Supabase Auth 기반의 본인 인증이 이미 있다고 가정하지 않는다. SQL은 현재 앱 경계를 보존하고 운영 적용은 수행하지 않는다.
- 프로젝트 CAS는 자동 연쇄 이동·일괄 완료·실행 취소를 하나의 변경으로 처리한다. stale 변경은 최신 상태를 다시 읽고 사용자에게 알린다.
- 폴더 소유자만 공유 설정 변경. 프로젝트 제한은 폴더보다 넓힐 수 없다. 캘린더 연결 공유 필드 편집은 양쪽 편집 권한 필요.
- 운영 DB 적용, PR 생성, 머지, 배포는 이번 실행에 포함하지 않는다. 적용 가능한 migration과 검증 자료까지 작성한다.

## 1. 공용 데이터와 일정 계산

Files: `src/features/gantt/{types,domain}.ts`, `tests/ganttDomain.test.ts`.

- [x] `GanttSnapshot`, `GanttCommand`, `GanttRequest`, `GanttGateway` 타입을 기준으로 폴더·프로젝트·작업을 구현.
- [x] 테스트: 포함 일수/시간/마일스톤, 순환 관계·상위 그룹 검증, 자동 후속 이동·수동 보존, 완료·복원, 폴더/프로젝트 권한, revision 충돌.
- [x] UI와 preview/main이 함께 쓰는 pure helpers: `durationLabel(task)`, `taskBounds(project,taskId?)`, `resolveTaskColor(project,task)`, `updateTask(project,id,patch)`, `completeTasks(project,ids,completed)`, `validateProject(project)`, `applyCommand(snapshot,actorId,command)`, `visibleSnapshot(snapshot,actorId)`.
- [x] `node --test tests/ganttDomain.test.ts`로 검증.

## 2. 저장·권한·캘린더 원자적 연결

Files: `electron/{ganttStore,ganttIpc}.ts`, `DEVLOG/migrations/2026-09-05-gantt-workspaces.sql`, `tests/ganttPersistence.test.ts`.

- [x] `gantt:read`, `gantt:execute`는 main 세션 user/epoch 검증 후 실행. renderer actor를 신뢰하지 않음.
- [x] RPC가 folder/project ACL, revision, requestId, 연결 캘린더 편집 권한을 잠금 안에서 검사하고 원자적으로 저장.
- [x] linked calendar event의 제목/기간/메모 편집은 작업과 자동 후속 날짜에 반영. calendar 삭제는 연결 해제, task 삭제는 연결 이벤트 제거.
- [x] 비어 있는 설치/테이블 미적용은 명확한 준비 안내. 저장 실패를 성공으로 표시하지 않음.
- [x] 테스트: 권한 거부, stale, 중복 request, 세션 변경, 캘린더 링크 권한·시간·삭제, 실패 원자성.

## 3. Preview와 낙관적 상태

Files: `src/features/gantt/{previewGateway,useGanttStore}.ts`, `src/mocks/devElectronAPI.ts`, `tests/ganttPreview.test.ts`.

- [x] 공통 command reducer로 preview 구현. 공통 authority를 Web Locks로 보호하고 매 mutation 최신 상태 읽기, request 멱등성, BroadcastChannel invalidation.
- [x] Zustand는 로컬 즉시 반영 후 gateway 저장, 실패 시 해당 작업 정본 재조회. 계정별 세대 fence로 오래된 응답 차단.
- [x] 실행 취소/재실행은 예상 revision과 일치하는 본인 변경에 한정. 원격 변경 후 취소 거부.
- [x] preview calendar gateway의 기존 이벤트 API에 linked task 조회/편집/삭제를 동일 규칙으로 연결.

## 4. React 간트 편집 화면

Files: `src/features/gantt/{GanttView,GanttCanvas,GanttInspector,GanttDialogs,GanttTooltip}.tsx`, `gantt.css`.

- [x] 폴더 트리와 공유 설정, 프로젝트 생성·숨김·집중 보기, 진행/완료 분리 및 완료/복원.
- [x] 빈 날짜 작성, 그룹 접기, 막대 이동/리사이즈, 자동→수동 확인, 계층/순서/다중 선택, 선행 작업 편집.
- [x] 커서 중심 휠 확대, Shift 가로 이동, 기간 맞춤, 막대 옆 이름/총 기간, 선택형 목록.
- [x] 우클릭 빠른 제목/날짜/메모/색상/완료 편집. 그룹색 상속과 기본색 복원. Escape/외부 클릭 닫기.
- [x] 상세의 시간·메모·작업자·참석자·씬 연결·진행률·캘린더 선택과 공유 안내.
- [x] 기존 glassStyles와 Pretendard 체계 재사용, 긴 제목 줄바꿈 및 툴팁, 테마 반응.

## 5. 앱 연결과 검증

Files: `src/App.tsx`, `src/types/index.ts`, `electron/{main,preload}.ts`, `package.json`, `package-lock.json`, `ROADMAP.md`, `AGENTS.md`, `DEVLOG/update-notes.json`.

- [x] 타임라인 라우트를 새 화면으로 교체. 기존 씬/에피소드/캘린더 데이터 보존.
- [x] preload 및 mock API 연결, 실시간/재연결/로그아웃 invalidation. 간트 테이블은 일반 전체 새로고침에서 제외.
- [x] 버전 1.111.0, 기능 설명 및 적용 SQL 기록.
- [x] `npm run typecheck`, `node --test tests/gantt*.test.ts`, 관련 calendar tests, `npm run build:vite` 통과 확인. 기존 날짜 의존 실패는 fixture 기준 날짜를 명시적으로 고정해 재현 가능하게 수정.
- [x] 실제 앱 preview 로그인 후 생성→우클릭 색상→완료→undo→캘린더 양방향→새로고침 저장 흐름 검증. 드래그·휠은 React 이벤트 경로 테스트로 검증했으며 실제 마우스 감각은 릴리스 전 확인 항목이다.
- [x] 독립 리뷰 및 발견사항 수정 후 최종 상태 기록.


검증 기록: `DEVLOG/2026-09-05-gantt-implementation.md`. 운영 적용·PR·머지·설치본 배포 미수행.
