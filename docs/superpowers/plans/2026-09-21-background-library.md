# Background Library Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Track execution with checkboxes below.

**Goal:** 승인한 배경 목업의 관리·탐색·에피소드 흐름을 B flow 실제 화면과 저장 경로에 연결한다.

**Architecture:** `src/features/backgrounds/types.ts` 계약을 공유한다. 엔티티별 revision CAS 명령을 renderer 낙관 store → preload → 세션 검증 IPC → Supabase RPC로 저장한다. Preview는 같은 domain reducer와 세션 계약을 따른다.

**Tech Stack:** React 18, TypeScript, SVG, Zustand, Electron, Supabase PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-09-21-background-library-design.md`

## Global Constraints

- 기존 작업물·앱 실행·개인 설정을 보존한다. 분리 worktree에서 개발한다.
- 비밀 토큰은 main에만 있고 DB가 세션 및 관리자 권한을 검증한다.
- 목업 샘플은 preview에서만 사용한다. 테스트 모드 동등성, 한국어 오류, 현재 테마 대응.
- 도면 삭제/배치 삭제는 원본 자산 또는 에피소드를 삭제하지 않는다.
- 새 의존성 없이 구현한다. package version은 1.126.0.

## Task 1: Domain and state

Files: `src/features/backgrounds/{types,domain,previewGateway,useBackgroundStore}.ts`, `tests/background{Domain,Preview,Store}.test.ts`.

Interfaces: `applyBackgroundCommand(snapshot, command, actor): BackgroundSnapshot`, `validateBackgroundRequest(input)`, `emptyBackgroundSnapshot(canManage=false)`, `createBackgroundPreviewGateway(actor, options)`, `createBackgroundStore()` / `useBackgroundStore`.

- [x] 작성한 계약으로 방향 필터, 부모 순환 거부, 저장 revision 충돌, 참조된 변형 삭제 거부, 묶음 복사 독립성을 먼저 검증한다.
  ```ts
  assert.throws(() => applyBackgroundCommand(snapshot, staleCommand, {canManage:true}), /변경/);
  assert.notStrictEqual(appliedUsage.variantIds, group.variantIds);
  ```
- [x] 공용 domain을 구현한다. 새 엔티티 revision=1, 변경 시 expectedRevision+1. 공간은 같은 도면의 카메라만 참조하고 상세 도면은 현재 도면의 직계 자식만 연결한다.
- [x] preview는 Web Locks로 읽기/쓰기 직렬화하고 requestId 명령 일치 및 삭제 ID 재사용을 검사한다.
- [x] store는 initialize/refresh/execute와 pending,error,loading을 노출한다. 저장 즉시 UI 반영 → canonical 결과로 교체, 실패하면 재조회/rollback; generation으로 이전 세션 응답을 거절한다.
- [x] `node --test tests/backgroundDomain.test.ts tests/backgroundPreview.test.ts tests/backgroundStore.test.ts` 실행.

## Task 2: Persistence and assets

Files: `electron/background{Store,Ipc}.ts`, `DEVLOG/migrations/2026-09-21-background-library.sql`, `tests/background{Persistence,DatabaseContract}.test.ts`.

Interfaces: `createBackgroundStore(client, session)`, `registerBackgroundIpc(deps)`. RPC `background_library_read(p_session_token)` / `background_library_execute(p_session_token,p_request_id,p_command)` return BackgroundSnapshot. Inject `getSessionOriginOrThrow`, token resolver, onChanged. `backgroundUploadImage(base64Data)` returns uploaded URL.

- [x] 테스트에 fake RPC, epoch 변경, token 누락, 잘못된 요청을 넣고 실패를 확인한다.
- [x] 엔티티별 CAS, soft-deletion tombstone, request receipts, SQL 참조/순환/타입 검증 및 권한을 구현한다. 테이블 직접 권한은 회수하고 RPC만 세션 검증 후 사용한다.
- [x] 저장 완료/실시간 알림은 invalidation 신호만 보내고 renderer가 다시 읽는다.
- [x] 파일/폴더는 기존 picker/open API를 재사용하고 배경 이미지 업로드용 안전한 호출을 추가한다.
- [x] SQL smoke/계약 테스트와 main persistence 테스트 실행. 운영 DB 변경은 하지 않는다.

## Task 3: Product UI

Files: `src/features/backgrounds/{BackgroundLibraryView,BackgroundMapEditor,BackgroundAssetPanel,BackgroundEpisodePanel,BackgroundGroupPanel}.tsx`, supporting local components and `backgrounds.css`.

Interfaces: `useBackgroundStore()` provides `{snapshot,loading,pending,error,initialize,refresh,execute}`; commands are defined in types.ts. App episodes come from `useDataStore`.

- [x] 승인 목업을 앱 테마로 연결한다. 빈 상태에서 장소/도면/배경을 등록할 수 있어야 한다.
- [x] SVG 편집기: 선택·그리기·이동·크기·회전·잠금·카메라·밑그림, 트리·경로·더블클릭 상세 이동. draft는 드래그 중만 유지, release/save에 한 번 저장한다.
- [x] 배경 목록/상세는 검색·방향·변형·수정본·장소 폴더와 업로드를 지원한다.
- [x] 묶음 CRUD와 에피소드별 장소/변형/메모, 이미지 상세 역방향 연결을 구현한다. 실패한 draft는 보존한다.
- [x] 기존 Alert/Modal/버튼 패턴 및 작은 창 대응. 도면 단축키는 현재 편집화면에서만 실행한다.

## Task 4: Integration and verification

Files: `src/{App.tsx,stores/useAppStore.ts,types/index.ts,components/layout/Sidebar.tsx,mocks/devElectronAPI.ts}`, `electron/{main,preload}.ts`, `package{,-lock}.json`, `ROADMAP.md`, `AGENTS.md`, `DEVLOG/update-notes.json`.

- [x] 배경 route/API/main 및 preview를 연결한다. 세션 종료 시 store와 구독을 정리한다.
- [x] baseline typecheck + character 관련 테스트 후 새 테스트, `npm run typecheck`, `npm run build:vite`를 실행한다.
- [x] preview 로그인 뒤 더블클릭/드래그/저장후새로고침/묶음적용/EP메모/양방향조회/오류 UI를 브라우저로 검증한다.
- [x] 별도 리뷰로 권한·동시수정·참조·UX 회귀를 확인하고 문제를 수정한다.
- [x] 실제 DB 적용 및 설치 앱 검증 여부를 구현 검증과 구분해서 보고한다.


## Verification notes (2026-09-21)

- 구현은 `codex/background-library` 분리 worktree에서 진행했다. 기존 checkout과 설치 앱은 보존했다.
- 기본/실패/세션/충돌/권한/참조/도면 변환/EP 초안 보존 테스트를 추가했고 로컬 PGlite로 migration을 실행했다.
- 별도 검토에서 발견한 실패 복구 중 invalidation 누락, 잘못된 recovery snapshot, 삭제된 에피소드의 과거 사용 기록, EP 전환 draft 손실, 읽기 전용 상세 갱신을 수정하고 재검토했다.
- 브라우저 preview 로그인 후 단일 선택·더블클릭 3단계 이동, 공간 회전과 카메라 방향 동반 변경, 새 도면 생성·드래그 공간 배치·저장 재조회, 방향 검색, 시점 묶음 적용, EP 메모 새로고침 보존, 배경 상세에서 밤 변형 연결을 확인했다. console error는 없었다.
- 현재 preview에는 실제 mock 에피소드 EP05 하나만 있어 EP 간 전환 보존은 회귀 테스트로 확인했다.
- 파일 선택 자동화는 도구의 filechooser 시간 초과로 완료되지 않았다. 네이티브 파일 선택·이미지 업로드 성공을 검증했다고 간주하지 않는다.
- 운영 DB, 실제 Storage 업로드, 설치 앱 E2E, 정식 설치 파일 빌드·배포는 수행하지 않았다.
- 최종 검사 결과는 `DEVLOG/background-library-verification-2026-09-21.md`에 기록한다.


## 후속 피드백: 도면 작업 흐름 개선

- [x] 점 그리드 제거, 선택 공간에 내부 도면 생성/기존 연결을 직접 제공.
- [x] 이름을 정하면 생성·연결·저장 후 즉시 안쪽 편집으로 진입. 반복해서 하위 도면 생성 가능.
- [x] 기존 도면 검색·다른 부모로 이동·이전 입구 해제를 하나의 `save-maps` 요청으로 저장. 도면별 CAS·최종 참조·순환·권한·실패 원자성 검증.
- [x] 접이식 트리·세부 속성, 도면 설정 모달, 이름 입력 자동 포커스, 작은 창에서 캔버스 하단 유지.
- [x] 브라우저에서 신규 공간 → 내부 도면 → 그 안의 상세 도면 → 두 단계 더블클릭 재진입 확인. 기존 도면 이동·자손 보존·이전 입구 해제·부모 위치 변경 저장 확인.
- [x] 리뷰의 응답 유실 후 재시도 문제를 canonical batch 일치 확인으로 수정. 동료의 후속 수정은 성공으로 오인하지 않는 회귀 검사 추가.

## 후속 기능: 문 열림 방향과 사물 기호

- [x] 문·의자·테이블·침대·기타 사물 5종 SVG와 단일 팔레트, 도면 클릭 배치, 방향 반전·회전·복제·크기·잠금 제공. 사용자 피드백에 따라 나머지 프리셋은 기타 사물로 통합하고 기존 저장 데이터는 호환 표시한다.
- [x] `symbol` 노드 공용 타입/검증/SQL 저장 계약과 공간 동반 변형·삭제 시 연결 해제 구현.
- [x] 계약/geometry/PGlite 회귀 검사 및 전체 배경 검사 66개 통과, 독립 코드 검토에서 기능 결함 없음.
- [x] 실제 preview에서 문 방향·회전, 책상 복제·이동, 의자/테이블 배치, 크기 변경 undo/redo, 잠금, 공간 동반 이동, 저장 재조회 확인.
