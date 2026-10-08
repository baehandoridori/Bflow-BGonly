# 배경 라이브러리 작업 인수인계 — 2026-10-06

> **2026-10-08 갱신:** 이 문서의 "미커밋·미배포·작업 보류" 기록은 당시 기준이다. 배경 라이브러리는 v1.130.0으로 main에 통합되어 배한솔 계정 한정으로 시험 공개했고 운영 DB에도 적용했다. 현재 상태는 [3D 구현 인수인계](background-3d-opus-handoff-2026-10-07.md) §14를 본다.

> **2026-10-07 후속 기획:** 평면/3D 공동 도면과 카메라 상하 방향·기즈모·동시 2D 확인 요구는 [Opus 5.5 구현 인수인계](background-3d-opus-handoff-2026-10-07.md)와 연결된 실행 계획에 기록했다. 2026-10-07에 구현과 로컬 검증을 마쳤다(결과: 3D 인수인계 §13). 그 작업은 세션 전용 격리 워크트리 `C:\Bflow-BGonly\.claude\worktrees\background-library-2d-3d-editor-a0ed8c`의 복제본에 있으며 이 워크트리로 옮기는 일은 남아 있다. 아래는 기존 2D 구현의 보존 기록이다.

> 이 문서는 사용자 요청에 따라 현재 구현을 보존하고, 다음 Codex/Claude 작업자가 같은 워크트리에서 이어가기 위해 작성했다.
> **현재 단계: 기능 구현 및 로컬 검증 완료, 사용자 요청으로 작업 보류. 미커밋·미배포 상태다.**
> 새 기능 구현, 원본 데이터 변경, 커밋·PR·DB 적용·배포를 자동으로 시작하지 말고 다음 사용자 요청에 맞춰 이어간다.

## 1. 가장 먼저 알아야 할 현재 상태

| 항목 | 2026-10-06 기록 |
|---|---|
| 실제 작업 폴더 | `C:\Bflow-BGonly\.worktrees\background-library` |
| 브랜치 | `codex/background-library` |
| 현재 HEAD | `e6c7e0e4a53855d8d75d5d71908681e04f7e3de8` |
| 패키지 | `bflow` / `1.126.0` (이 작업의 미배포 기능 버전) |
| 변경 상태 | 구현은 작업 디렉터리의 수정 파일과 미추적 파일에 있다. HEAD만 checkout하면 복원되지 않는다. |
| 프리뷰 | `http://127.0.0.1:5318/?preview=1` |
| 마지막 확인 화면 | 배경 → 에피소드별 배경 → EP05 → 2-1 교실 |
| 문서 작성 중 서버 확인 | 15:19 KST에 127.0.0.1:5318 listen 확인. 재개 시 프로세스 상태를 다시 확인한다. |
| 로컬 도구 | Node v22.18.0 / npm 10.9.3 |
| 이번 보존 요청 | 코드 동작을 추가로 바꾸지 않고 인수인계 문서와 진입 링크만 작성한다. |

- **상위 `C:\Bflow-BGonly` checkout에도 별도 변경이 있으므로 이 작업을 그곳에서 이어가지 않는다.** 현재 워크트리의 코드를 상위 checkout에 덮어쓰지 않는다.
- `git clean`, `git reset --hard`, 일괄 checkout/restore, 워크트리 삭제, 브라우저 저장소 초기화를 하지 않는다. 새 배경 기능 대부분이 미추적 파일이다.
- 이 문서는 소스 전체의 별도 백업 파일이나 커밋을 대신하지 않는다. 구현 원본은 현재 워크트리에 보존되어 있다. 이번 요청으로 커밋·push·PR은 만들지 않았다.
- `node_modules`는 현재 이 워크트리에 존재한다. 의존성 설치/연결을 임의로 지우거나 다시 만들 필요가 없다. 환경이 바뀌면 상태를 확인한 뒤 대응한다.
- 앱 개인 설정, 실행 중인 설치 앱, 공유 드라이브의 배포 파일은 건드리지 않았다.

## 2. 사용자 의도와 확정된 UX

배경팀은 실제 파일을 장소별 폴더로 관리한다. 하지만 같은 교실에도 여러 구도와 낮/밤, 복도를 보는 장면, 문손잡이 같은 초근접 배경이 있다. 캐릭터 현황판처럼 원본을 모아 찾고, 도면에서 탐색하며, 에피소드 사용 기록까지 관리하는 기능을 요청했다.

대화에서 확정된 요구는 다음과 같다. 이후 작업에서도 이 결정을 임의로 되돌리지 않는다.

1. 관리자가 게임 엔진의 배치 도구처럼 도면과 공간을 자유롭게 만든다. 특정 건물 구조를 코드에 고정하지 않는다.
2. 도면끼리는 폴더 트리처럼 연결한다. **공간 단일 클릭은 선택, 더블클릭은 연결된 상세 도면으로 이동**한다.
3. 도면의 점 그리드는 제거한다. 상위/연결 항목을 복잡한 설정 목록으로 먼저 입력하게 하기보다, 공간에서 내부 도면 만들기 또는 기존 도면 연결로 자연스럽게 이어간다.
4. 기본 시점·주요 시점을 묶고 에피소드에 적용할 수 있다. 에피소드 사용과 장소별 메모는 캐릭터 현황판의 흐름을 따른다.
5. 문 열림 방향을 표시한다. 사물 전용 기호는 **문·의자·테이블·침대**만 유지하고 나머지는 **기타 사물**이다. 책상·소파·수납장·화분을 별도 팔레트로 다시 늘리지 않는다.
6. 작업파일과 이미지파일을 캐릭터처럼 연결한다. 원본 파일과 업로드한 미리보기는 구분한다.
7. 도면 탐색의 이미지는 **도면 아래 그리드**로 표시한다. 도면과 이미지 사이 경계를 위아래로 움직여 높이를 조절할 수 있다.
8. 가장 최근 요청은 **에피소드별 배경 UI를 캐릭터의 에피소드 에셋 화면과 비슷하게 정리**하는 것이었다. 이 요구까지 반영·검증했고 이제 보존 상태다.

## 3. 분류와 데이터 모델

핵심은 **장소 → 구도(view) → 변형(variant) → 이미지 수정본(revision)**이다. 실제 TypeScript 계약은 [types.ts](../src/features/backgrounds/types.ts), 검증과 명령 처리는 [domain.ts](../src/features/backgrounds/domain.ts)를 따른다.

| 개념 | 실제 필드/타입 | 의미 |
|---|---|---|
| 장소 | `BackgroundPlace`, `parentId`, `folderPath` | 파일을 모으는 기준과 장소 계층 |
| 구도 | `BackgroundView.placeId` | 원본 구도가 소속된 장소 |
| 카메라 위치 | `cameraPlaceId` | 어디에서 바라보는가 |
| 보이는 장소 | `visiblePlaceIds` | 화면에 무엇이 보이는가 |
| 관련 장소 | `relatedPlaceIds` | 검색·관련 분류를 보완 |
| 구도 종류 | `shot` | wide / medium / closeup / detail |
| 변형 | `BackgroundVariant`, `time` | 낮/밤/기타 상태. 구도 카드를 복제하지 않는다. |
| 이미지 이력 | `revisions`, `activeRevisionId` | 변형별 수정본과 현재 표시할 수정본 |
| 시점 묶음 | `BackgroundGroup.variantIds` | 자주 쓰는 변형 ID 모음 |
| 에피소드 사용 | `BackgroundUsage` | 에피소드 번호 + 장소 + 변형 ID 목록 + 메모 |
| 도면 | `BackgroundMap` | 자유 계층, 밑그림, 공간·카메라·기호 노드 |

- 교실에서 복도를 보는 배경과 복도에서 교실을 보는 배경은 카메라 위치와 보이는 장소를 분리해 찾는다. 방향 필터 `from`은 카메라 위치, `to`는 보이는 장소다.
- 카메라 위치가 없는 클로즈업도 등록한다. 보이는/관련 장소와 태그로 검색하되 `from`에 섞지 않는다.
- 묶음을 에피소드에 적용하면 변형 ID를 중복 없이 복사한다. 나중에 묶음을 고쳐도 과거 에피소드 사용 기록을 자동 변경하지 않는다.
- 도면의 배치와 원본 자산은 별개다. 공간이나 도면 배치를 지웠다고 원본 장소·배경·에피소드 기록까지 삭제하지 않는다.
- 원본 삭제·이동은 참조 보호와 공용 검증을 유지해야 한다. 단순 화면 필터만 바꾸어 제약을 우회하지 않는다.

## 4. 구현된 화면과 동작

### 도면 탐색 및 편집

- 접고 펼치는 도면 트리, 상위 경로, 도면별 선택·확대·위치 복원.
- 사각형/타원형/자유 다각형 공간, 이동·크기·회전·잠금, 카메라 위치·방향·시점 연결, 밑그림.
- 새 도면 이름 입력 후 저장 및 편집 진입. 선택한 공간에서 내부 도면을 만들면 연결까지 함께 저장하고 안쪽으로 이동.
- 기존 도면을 검색해서 연결. 다른 부모의 도면은 자손을 유지하며 이동하고 이전 공간의 진입 연결을 함께 해제.
- 좌표·크기·잠금·장소 연결은 접이식 속성으로, 위치·밑그림은 도면 설정으로 정리.
- 문에는 경첩, 문짝, 열림 원호, 방향 화살표. 경첩 좌우/열리는 쪽 뒤집기, 회전, 복제, 크기 변경, 잠금, undo/redo.
- 공간 안에 놓은 카메라/기호는 공간과 연동한다. 공간을 변형하면 소속 노드도 반영하되 잠긴 노드는 보존. 공간 삭제는 기호를 남기고 연결만 해제.
- 구형 `desk/sofa/cabinet/plant`는 호환 타입만 남아 있고 화면에서는 기타 사물로 표시한다. 기존 이름·위치·크기는 보존한다.

### 도면 아래 이미지 그리드와 높이 조절

- 현재 도면/하위 도면, 공간, 카메라, 기호에 맞는 배경 범위를 계산한다. 아무것도 연결되지 않은 도면을 전체 라이브러리로 확장하지 않는다.
- 검색·구도·시간대 필터, 전체 범위 복귀, 현재 범위와 개수 표시.
- 이미지 클릭 시 해당 변형 상세를 도면 위 모달로 열고, 닫으면 도면 선택과 필터 유지.
- 도면/이미지 사이 경계를 포인터로 위아래 드래그. 키보드 위/아래 24px, Shift 60px, Home/End 최소/최대, Enter/더블클릭 기본 높이.
- 높이만 기기 UI 설정 `bflow.background-map.panel-height.v1`에 저장한다. 도면 엔티티나 편집 이력에 넣지 않는다. 포인터 취소/캡처 상실은 이전 높이로 복귀.
- 좁은 창에서는 도면 캔버스만 높이 조절하고 아래 이미지 영역의 최소 공간을 유지한다.

### 원본 배경과 파일 연결

- 장소/구도 검색, 방향·시간대 분류, 낮/밤 등 변형, 활성 수정본과 이력, 태그·메모, 장소 폴더 경로.
- 변형의 `workFilePath`는 작업파일, 수정본의 `sourceImagePath`는 원본 이미지, `imageUrl`은 공용 미리보기.
- 과거 수정본 `filePath`는 작업파일 호환용이다. `workFilePath` 누락과 명시적 빈 문자열을 구분하여 해제한 연결이 되살아나지 않게 한다.
- 파일 선택/경로 입력/이미지 드롭, 원본 열기, 연결 해제, 수동 이미지 갱신. 갱신은 새 수정본을 만들고 기존 이력 유지.
- 연결 해제는 원본 파일이나 기존 미리보기를 삭제하지 않는다. 자동 폴더 스캔과 파일 변경 감시는 구현 범위에 포함하지 않았다.
- PNG/JPG/WebP, 20MB 원본, 1600px 이내 미리보기, 투명도 보존, 변형당 수정본 100개 제한을 유지한다.

### 에피소드별 배경 — 마지막 작업

실제 참고 화면은 [EpisodeAssetBoard.tsx](../src/views/EpisodeAssetBoard.tsx)이다. 캐릭터 전용 리깅 항목까지 배경에 복제하지 않는다.

- 왼쪽 장소 목록(기본 230px), 오른쪽 선택 장소 상세. 작은 창에서는 세로 배치.
- 에피소드 표시는 `useDataStore.getEpisodeDisplayName`을 사용한다.
- 대표 이미지, 전체 장소 경로, 선택 개수, 구도/시간대 설명, 이미지 썸네일 선택과 **이 편 사용** 배지.
- 같은 장소의 시점 묶음 추가, 모두 해제, **이 편 주의점 · 감독 노트**, **사용 목록 저장**.
- 장소 검색 모달에서 아직 등록하지 않은 장소를 추가. 검색 결과 없음/사용 장소 없음/에피소드 없음 처리.
- 장소·에피소드를 오갈 때 저장 전 선택과 메모를 유지한다. 저장은 명시적 버튼이며 자동 저장으로 바꾸지 않았다.
- 저장 중에는 확인된 목록 순서와 선택 상세를 유지해 낙관적 삭제 실패에도 초안이 사라지지 않도록 한다.
- **배경 원본 보기**는 이 화면에서만 읽기 전용이다. 현재 활성 수정본을 확인하며 과거 수정본 선택/원본 수정/역방향 에피소드 체크는 비활성이다. 수정은 배경 목록으로 이동해서 한다.
- 위 읽기 전용 처리는 에피소드 초안을 작성하는 중 원본을 삭제·이동하거나 사용 기록을 별도로 변경해 충돌시키는 것을 막는다. 도면/배경 목록의 기존 관리자 편집은 그대로다.
- 원본 모달은 숨겨지는 도면 탭 내부가 아니라 공통 탭 바깥에 둔다. 에피소드에서도 정상 표시된다.

## 5. 수정 위치 안내

아래 경로는 모두 이 워크트리 기준이다.

| 파일 | 책임/후속 수정 위치 |
|---|---|
| `src/features/backgrounds/types.ts`, `domain.ts` | 공용 타입, 명령, 방향 검색, 계층·참조·revision·권한 검증 |
| `useBackgroundStore.ts` | 초기화/재조회/낙관 저장/실패 복구, 세션 및 늦은 응답 제어 |
| `previewGateway.ts` | 테스트 데이터, localStorage, Web Locks, 멱등/삭제 기록, 변경 신호 |
| `BackgroundLibraryView.tsx` | 4개 탭, 에피소드 이름, 초기화·재조회, 공통 원본 모달 |
| `BackgroundMapEditor.tsx`, `mapGeometry.ts`, `mapWorkflow.ts` | SVG 배치/편집, 도면 연결·이동·원자 저장 |
| `BackgroundSymbolGlyph.tsx`, `symbolCatalog.ts` | 5종 기호, 문 방향, 구형 프리셋 호환 |
| `BackgroundMapGallery.tsx`, `mapGallery.ts` | 하단 이미지 그리드, 도면/공간/카메라별 범위 |
| `BackgroundMapPanels.tsx` | 도면/이미지 높이 조절과 기기 설정 |
| `BackgroundAssetPanel.tsx`, `BackgroundAssetDialog.tsx` | 배경 목록·원본 편집·변형/수정본·읽기 전용 확인 |
| `BackgroundFileLinks.tsx`, `fileLinks.ts` | 파일 연결 행, 구형 경로 호환, 이미지 갱신 |
| `BackgroundPlaceDialog.tsx`, `BackgroundGroupPanel.tsx` | 장소 폴더와 시점 묶음 |
| `BackgroundEpisodePanel.tsx`, `usageDrafts.ts` | 에피소드 목록/상세, 초안, 사용 저장, 역방향 사용 패널 |
| `BackgroundUI.tsx` | 모달/썸네일 등 공통 UI |
| `backgrounds.css`, `backgrounds-map.css`, `backgrounds-episode.css` | 공통·도면·에피소드 스타일 |
| `electron/backgroundIpc.ts` | main IPC의 canonical 세션/관리자/epoch 검사 |
| `electron/backgroundStore.ts` | DB RPC 호출과 변경 신호 구독 |
| `electron/backgroundStorage.ts`, `electron/backgroundImageFile.ts` | 미리보기 업로드와 원본 이미지 제한 읽기/디코드 |
| `DEVLOG/migrations/2026-09-21-background-library.sql` | 신규 데이터 구조, 서버 검증, RPC, revision/멱등/참조 경계 |
| `src/views/EpisodeAssetBoard.tsx` | UI 참고 원본. 이번 작업에서 캐릭터 화면 자체는 수정하지 않음 |

통합 연결도 함께 보존한다: `src/App.tsx`, `src/stores/useAppStore.ts`, `src/types/index.ts`, `src/components/layout/Sidebar.tsx`, `headerTitle.ts`, `src/utils/navigationBackStack.ts`, `src/mocks/devElectronAPI.ts`, `electron/main.ts`, `electron/preload.ts`, `tsconfig.node.json`, `package.json`, `package-lock.json`.

특히 `src/features/playground/featureFlag.ts` 변경은 무관한 플레이그라운드 기능 변경이 아니라 허용 화면 목록에 `background-library`를 등록한 것이다. 잘못 되돌리면 탐색이 막힐 수 있다.

## 6. 저장·동기화·권한에서 유지할 경계

- 실제 앱: renderer → preload 요청 epoch → `backgroundIpc.ts` → `backgroundStore.ts` → `background_library_read/execute` RPC.
- 세션 토큰은 main 밖으로 내보내지 않는다. DB의 `app_session_user_id`가 사용자를 확정한다. 자산/도면/묶음 관리는 관리자, 에피소드 연결은 로그인 사용자 권한이다.
- 엔티티별 revision CAS로 이전 버전 덮어쓰기를 거절한다. 프로젝트 공통 설명의 일반적인 Last-Write-Wins와 달리 배경 기능은 충돌 시 거절하는 이 경계를 따른다. `requestId`는 멱등이고 삭제된 ID를 재사용하지 않는다. UI의 `canManage`를 신원 증명으로 받아들이지 않는다.
- 낙관적 UI → 정본 응답 반영 → 실패 시 재조회/rollback. 입력 초안은 보존한다. 세션 generation과 refresh ticket으로 오래된 응답을 배제한다.
- 도면 생성·연결·이동은 `save-maps` 하나로 저장한다. 모두의 revision과 최종 참조를 확인하고 하나라도 실패하면 전부 되돌린다.
- 응답 유실 복구는 제출한 도면 전체 내용과 정확한 다음 revision이 정본에 일치할 때만 성공으로 본다. 일부 일치나 다른 사람의 후속 수정을 성공으로 오인하지 않는다.
- Realtime/BroadcastChannel은 내용 없는 변경 신호이며 정본을 다시 읽는다.
- Preview도 같은 domain 명령과 검증을 사용한다. localStorage 키는 `bflow-background-library-preview-v1`, 변경 채널은 `bflow-background-library-changed`다. 쓰기는 Web Locks로 직렬화한다.
- 이미지 미리보기는 기존 `scene-images` 버킷의 `backgrounds/` 경로를 사용한다. 운영 저장 기능 누락을 샘플 데이터 성공으로 숨기지 않는다.
- 운영 DB migration은 **아직 적용하지 않았다**. 실제 앱에 넘기기 전 현행 운영 세션 구조와 함께 검토·적용·검증해야 한다. 이 문서는 운영 적용 지시가 아니다.

## 7. 프리뷰 재개 방법과 데이터 보존

현재 5318 프리뷰 서버가 살아 있다면 그대로 사용한다. 꺼졌을 때만 다음처럼 이 워크트리에서 renderer 전용으로 실행한다.

```powershell
Set-Location -LiteralPath 'C:\Bflow-BGonly\.worktrees\background-library'
$env:BFLOW_RENDERER_ONLY = '1'
npm exec vite -- --host 127.0.0.1 --port 5318 --strictPort
```

- 주소는 `http://127.0.0.1:5318/?preview=1`이다. 5318이 사용 중이면 기존 서버를 확인하고 임의로 종료하지 않는다. `--strictPort`로 다른 포트에 조용히 열리는 일을 막는다.
- 로그인 화면이 보이면 현재 사용자 지침의 **preview 전용 테스트 계정**인 이름 `배한솔` / 비밀번호 `1234`로 로그인한다. 운영 계정으로 해석하지 않는다.
- 배경 메뉴 → 에피소드별 배경 또는 도면 탐색으로 이동한다. 이전 UI 선택은 브라우저 전체 재실행 후 다시 골라야 할 수 있다.
- 브라우저 프로필/호스트/포트가 달라지면 같은 저장 자료가 보이지 않을 수 있다. `localhost`와 `127.0.0.1`도 서로 다른 origin이다. 브라우저 저장소를 지우지 않는다.
- 저장된 preview 자료는 브라우저 저장소에 있고 코드/Git에 포함되어 있지 않다. **저장 전 초안은 메모리 상태이므로 페이지 새로고침·언마운트까지 복구를 보장하지 않는다.** 장소/에피소드/탭을 오가는 동안의 초안 보존과 구분한다.
- 마지막 검증에서는 EP05 하나만 제공됐다. 기존 2-1 교실의 낮/밤 2개 사용과 기존 메모 `복도 장면 검증 메모`는 변경하지 않았다.
- 추가한 preview 사용 예제: 기존 `2층 복도` 장소 → `복도에서 바라본 교실 · 밤` 1개, 메모 `프리뷰 UI 확인: 복도에서 교실을 바라보는 밤 배경`. 저장 후 라이브러리 재조회까지 확인했다. 원본 구도나 장소를 새로 만들거나 수정한 것은 아니다.
- 이전 확인용 `기호 배치 확인`, `파일 연결 확인` 등 자료가 남아 있을 수 있다. 사용자 자료와 구분 없이 일괄 삭제하지 않는다.
- `src/mocks/devElectronAPI.ts`의 원본 이미지 경로 읽기는 지정된 예제 경로를 처리하는 모의 기능이다. 이 경로에서 프리뷰가 표시됐다고 실제 공유 드라이브 파일을 읽었거나 Storage에 업로드했다고 판단하지 않는다. 실제 경로의 OS 접근은 Electron에서 별도로 확인해야 한다.
- `BFLOW_RENDERER_ONLY`는 브라우저 프리뷰 전용이다. **전체 Vite 검증 시 환경변수를 제거해야 main/preload도 빌드된다.** 배포용 설정으로 영구 저장하지 않는다.

## 8. 검증 결과와 한계

상세 누적 기록은 [background-library-verification-2026-09-21.md](background-library-verification-2026-09-21.md)를 본다. 아래는 가장 최근 2026-10-06 검증 결과이며, 이 인수인계 문서 작성 때문에 동일 검사를 다시 실행한 것은 아니다.

| 검사 | 결과 |
|---|---|
| `npm run typecheck` | 3개 TypeScript 설정 통과 |
| `npm run test:background` | 77 통과 / 0 실패 / 조건부 DB 검사 1개 생략 |
| `npm run build:vite` | 종료 코드 0, 전체 2,834 통과 / 0 실패 / 조건부 검사 33개 생략, renderer/main/preload 빌드 |
| 마지막 코드 보완 | 읽기 전용 보호 후 typecheck·배경 검사·Vite 재검증, 대표 이미지 CSS 수정 후 Vite 재빌드 통과 |
| 프리뷰 | 장소 검색/추가, 낮·밤 선택, 장소 이동 후 초안 유지, 원본 확인/복귀, 저장/재조회 확인 |
| 작은 창 | 740×900 세로 구성과 일반 1075px 폭 구성 확인, 가로 넘침 없음 |
| 브라우저 오류 | 검증 흐름 console error 0개 |
| 읽기 전용 코드 리뷰 | 발견한 원본/사용 기록 충돌 위험 수정, 재검토에서 추가 확정 결함 없음 |
| 문서 보존 단계 | 작성 전후 기존 변경 파일 65개의 SHA-256 비교에서 AGENTS.md 안내 링크 외 64개 모두 동일. CLAUDE.md 안내 링크와 인수인계 문서만 추가 편집. `git diff --check` 및 문서의 모든 로컬 링크 확인 통과. |

로그 폴더: `C:\Users\user\Documents\Codex\background-library-validation-20261006`

- `episode-board-build-vite.log`
- `episode-board-final-typecheck.log`
- `episode-board-final-tests.log`
- `episode-board-final-vite.log`
- `episode-board-final-layout-vite.log`

이전 도면/파일 작업 로그는 `background-library-validation-20260921`, 높이 조절 로그는 `background-library-validation-20260930`에 있다. 외부 로그 폴더가 없어도 누적 검증 문서는 이 워크트리에 남는다.

**테스트 숫자 해석:** 9/21~9/22에 별도 PGlite를 지정한 실행은 전체 2,925개/배경 94개 통과로 기록되어 있다. 최근 기본 환경은 `BFLOW_PGLITE_MODULE`을 지정하지 않아 DB 하위 검사들이 조건부 생략됐다. 숫자가 다르다는 이유만으로 회귀로 단정하거나, 최근 실행을 모든 DB 검사 통과라고 말하지 않는다. `tests/backgroundDatabaseContract.test.ts`의 환경변수와 skip 조건을 확인한다.

**미검증/미수행 범위:** 운영 DB migration, 실제 Storage 업로드의 전체 흐름, 네이티브 파일 선택 → 저장 → OS 원본 앱 열기 E2E, 실제 설치 앱 E2E, 정식 installer 빌드, 공유 드라이브 배포. 과거 별도 Electron helper로 이미지 디코드·축소·투명도·원본 불변은 확인했지만 전체 사용자 파일 연동 검증을 대체하지 않는다. EP 간 초안 이동은 당시 preview에 EP05 하나만 있어 기존 회귀 테스트 근거와 분리해 기록했다.

## 9. 후속 변경 시 검사 명령

코드를 바꾸는 다음 작업자가 실행한다. 문서만 바꾸는 현재 보존 단계에서 무거운 빌드를 반복할 필요는 없다.

```powershell
Set-Location -LiteralPath 'C:\Bflow-BGonly\.worktrees\background-library'
Remove-Item Env:BFLOW_RENDERER_ONLY -ErrorAction SilentlyContinue
npm run typecheck
npm run test:background
npm run build:vite
git -c core.safecrlf=false diff --check
```

`build:vite` 자체에 타입 검사와 전체 지정 테스트가 포함된다. 개발용 manifest는 installer 없이 만들어질 수 있으므로 배포 성공의 증거로 쓰지 않는다. 실제 배포를 요청받으면 그때 현행 배포 지침과 운영 DB 상태를 다시 확인한다.

관련 테스트 파일은 `tests/background*.test.ts` 11개다: Domain, Preview, Store, Persistence, DatabaseContract, MapGeometry, MapWorkflow, MapGallery, UsageDrafts, FileLinks, ImageFile.

## 10. 재개 시 주의할 구현 함정

1. 에피소드의 원본 확인창에서 역방향 사용 변경을 허용하면 저장 중인 usage 초안의 revision이 뒤처진다. 원본 삭제/장소 이동까지 허용하면 아직 저장되지 않은 선택 변형이 유실될 수 있다. `readOnly`/`usageReadOnly`와 실제 `canEdit` 경계를 유지한다.
2. 낙관적 삭제로 목록이 잠깐 사라질 때 상세를 unmount하면 오류 복구 후 입력이 사라진다. 에피소드의 확인된 목록 순서/초안과 원본 모달의 캐시 처리를 보존한다.
3. 공용 `.bg-thumbnail`의 너비 규칙이 대표 이미지 스타일을 덮어써 가로 넘침을 일으켰다. 최종 선택자 `.bg-episode-hero > .bg-episode-hero-image`의 우선순위와 좁은 창 대응을 유지하고 실제 화면으로 확인한다.
4. 배경 목록과 에피소드 화면의 선택·초안은 별개다. 탭을 숨기는 구조를 일괄 조건부 렌더로 바꿀 때 언마운트에 따른 초안 유실을 확인한다.
5. `workFilePath`의 undefined/빈 문자열 의미, 구형 기호 타입, 변형/수정본 ID를 단순 정리 목적으로 합치거나 지우지 않는다.
6. 라이브러리 UI 검증은 로그인 이후 실제 목표 화면까지 수행한다. 코드에 존재하거나 로그인 화면이 뜬 것만으로 동작 완료를 선언하지 않는다.

## 11. 다음 작업자에게 남기는 상태

- 현재 요청들은 구현·로컬 검증까지 완료되어 있다. 자동으로 이어서 구현해야 할 승인된 새 기능은 없다. 사용자가 다음 개선 방향을 정하면 그 범위부터 이어간다.
- 운영 적용을 선택하면 먼저 migration·실제 파일/Storage·설치 앱 동작 검증이 필요하다. 커밋/PR/merge/deploy는 이번 보존 요청에 포함하지 않았다.
- 브랜치가 오래되어 통합이 필요하더라도 현재 미커밋/미추적 변경을 먼저 확인하고 보존한다. 원본 작업 폴더를 덮어쓰거나 미추적 파일을 청소하지 않는다.
- 최신 범위는 이 문서와 검증 문서의 마지막 날짜가 기준이다. 상단 ROADMAP의 전체 테스트 숫자는 이전 PGlite 실행 기록이므로 최신 기본 환경 수치와 구분한다.

읽을 문서:

1. [AGENTS.md](../AGENTS.md): 저장·권한 경계 및 프로젝트 필수 규칙.
2. [배경 라이브러리 설계](../docs/superpowers/specs/2026-09-21-background-library-design.md).
3. [초기 구현 계획](../docs/superpowers/plans/2026-09-21-background-library.md), [파일 연결](../docs/superpowers/plans/2026-09-21-background-file-links.md).
4. [하단 이미지 그리드](../docs/superpowers/plans/2026-09-22-background-map-gallery.md), [높이 조절](../docs/superpowers/plans/2026-09-30-background-map-height.md).
5. [마지막 에피소드 UI 계획](../docs/superpowers/plans/2026-10-06-background-episode-board.md).
6. [누적 검증 내역](background-library-verification-2026-09-21.md), [사용자 피드백 교훈](../tasks/lessons.md).

다음 대화에 전달할 짧은 문장:

> C:\Bflow-BGonly\.worktrees\background-library 워크트리의 DEVLOG/background-library-handoff-2026-10-06.md부터 읽고 현재 미커밋/미추적 변경을 보존한 채 이어서 작업해 주세요. 마지막 완료 항목은 에피소드별 배경을 캐릭터 에피소드 에셋 방식으로 정리한 UI이며, 아직 운영 DB 적용이나 배포는 하지 않았습니다.
