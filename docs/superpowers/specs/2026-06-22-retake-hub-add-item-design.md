# 리테이크 허브 — '항목 추가'(씬 지정 + 전반) 설계

> 작성: 2026-06-22 · Claude × 한솔 (Studio JBBJ)
> 선행: 5단계(감독 세트 허브) v1.44.0 배포 완료. 본 문서는 **5단계 후속**.
> 상위 스펙: `docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md` §9.3 / §9.4
> 관련 메모: `project_retake_hub_redesign`

---

## 1. 배경 / 문제

리테이크 허브(`RetakeHubView`)의 세트 상세는 현재 **'기존 리테이크 가져오기'만** 지원한다(`RevisionImportModal` — 이미 만들어진 일반 리비전에 `set_id`를 부여해 세트로 편입). 세트에 들어갈 항목을 **새로 만드는 경로가 허브에 없다**. net-new 항목은 "씬 화면에서 리비전 등록 → 허브에서 가져오기"의 2단계를 거쳐야 하고, 특정 씬에 매이지 않는 '전반'(scene_id 없음) 항목은 아예 만들 수 없다.

막힌 지점:
- `electron/supabase.ts`의 `addRevision`이 씬 컨텍스트 필수(`resolvePartUuid`/`resolveSceneUuidByNumberWithRetry`로 씬 UUID를 해석하고, 못 찾으면 `throw`). INSERT 페이로드에 `set_id` 컬럼이 없다.
- `CreateRevisionInput`(`useRevisionStore`) / `CreateRevisionServiceInput`(`revisionService`)의 `sceneKey`가 필수.

DB는 이미 준비됨(라이브 적용 확인): `comp_revisions.scene_id` nullable, `set_id` 컬럼 + FK(ON DELETE SET NULL) + 인덱스 존재. 추가 마이그레이션 불필요.

## 2. 목표 / 비목표

**목표**
- 세트 상세에서 **새 리비전 항목을 직접 생성**한다.
  - **씬 지정**: 에피소드(세트에 고정) → 파트 → 씬 선택 → 그 씬에 매인 리비전 생성(`scene_id` 채움 + `set_id`).
  - **전반**: 씬 미지정 → `scene_id` 없는 리비전 생성(`set_id`만).
- 생성 즉시 세트 테이블에 낙관적 반영, 진행률·세트 자동완료 상태 재평가.
- 내용 입력은 엔티티 인식(@멘션·#씬태그) + **이미지 첨부**. 담당/알림은 **팀 전체에서 추가 가능 + 담당 승격**.

**비목표 (이번 범위 아님)**
- 리비전 워크플로우/상태 머신 변경 없음(기존 그대로).
- 씬 화면 쪽 생성 폼(`AddRevisionForm`/`NewRevisionModal`/`RevisionPanel`) 변경 없음.
- 세트 자체의 CRUD 변경 없음.
- 이미지 저장 방식 변경 없음(기존 리비전과 동일 경로 재사용).

## 3. 사용자 동작 (UX)

세트 상세 헤더 `SetDetailHeader`의 `기존 리테이크 가져오기` **옆에 `+ 항목 추가` 버튼**을 둔다. 스펙 §9.4 "항목 추가(누구나)"에 따라 `canManage` 게이트 없이 모두에게 노출(가져오기 버튼과 동일).

클릭 → `RevisionAddModal`(신규, `createPortal` + framer-motion, 기존 허브 모달과 동일한 셸):

1. **대상 토글** — `씬 지정` / `전반 (대상 씬 없음)` 세그먼트.
2. **씬 지정일 때만** 표시:
   - **에피소드**: 세트에 `episodeNumber`가 있으면 **고정 표시(자물쇠, 변경 불가)**. 없으면 에피소드 셀렉트 노출.
   - **파트** 셀렉트 → **씬** 셀렉트. 같은 파트의 BG/ACT 시트 씬을 union(`buildRevisionPartOptions`/파트·씬 union 헬퍼 재사용, `NewRevisionModal`과 동일).
3. **내용** — `EntityAwareInput`(multiline, @멘션·#씬태그). **이미지 첨부**: 하단 좌측 `이미지` 버튼(파일 선택) + 입력칸 붙여넣기(`onPaste`) → `resizeBlob(file, 800, 0.8)` → 미리보기 + X 삭제. (`AddRevisionForm` 패턴 그대로.)
4. **담당 · 알림 지정** — `RevisionRecipientPicker`(`enableAssignee` + `onAssigneesChange`). 칩 클릭 순환(미선택→알림→담당 왕관). `+ 다른 사람 추가` → 이름 검색 → 팀 전체에서 추가. 씬 지정 시 그 씬 담당자를 기본 체크(`calcDefaultRecipients`), 전반은 컴포지터만 기본 체크.
5. `만들기` → `createRevision({ sceneKey, setId, description, imageUrl, notifyUserIds, assigneeIds, department, lookupDepartment })` 호출 → 낙관적 추가 → 모달 닫힘.

생성 결과:
- **씬 지정 항목**: `scene_id` 있음 → **그 씬 상세창 리테이크 탭에도 동일하게 노출**(같은 `comp_revisions` 레코드라 자연 반영). 세트 테이블에는 해당 씬 그룹에 표시.
- **전반 항목**: `scene_id` 없음 → 씬 상세창엔 안 뜨고 허브 '전반 (대상 씬 없음)' 그룹에만 표시(`RetakeHubItemTable`의 기존 general 그룹).

부서(BG/ACT) 라벨은 노출하지 않는다(메모리 규칙). 내부 추론·상태 색만 사용.

## 4. 데이터 / 배선

원칙: **기존 씬-바운드 경로는 절대 깨지 않는다.** `setId`는 모든 시그니처의 **마지막 인자**로 추가(미전달 시 `null`=현행과 동일). 씬 없는(전반) 경우만 **early 분기**로 씬 UUID 해석을 건너뛴다.

### 4.1 `electron/supabase.ts` `addRevision`
- 시그니처 끝(현재 마지막 인자 `assigneeIdsJson?` 다음, 18번째)에 `setId?: string` 추가.
- **early 분기**: `sceneId`(=sceneKey 자리)가 비었거나 공백이면 → `resolvePartUuid`/`resolveSceneUuid…`(현재 throw 지점 `:1857-1859`) 호출을 건너뛰고 INSERT에서 `part_id`/`scene_id`/`scene_uuid`를 **명시적으로 `null`**(빈 문자열 `''` 아님)로 둔다(throw 없음). — 현재 코드는 `scene_id: sceneId`라 전반이면 `''`가 들어갈 수 있으므로 early 분기에서 `null`로 끊는다.
- 씬이 있으면 **기존 해석 로직 그대로**(미변경). 컬럼명 `part_id`/`scene_id`/`scene_uuid` 정확(`:1891-1893`).
- INSERT 페이로드에 `set_id: setId ?? null` 추가(양 분기 공통). 다른 컬럼은 불변.
- 담당자 불변식(assignee ⊆ notify) 기존 필터 그대로 적용.

> 주의(메모리 교훈): `electron/`은 `@/` alias로 `src/`를 런타임 import 못 함. 새 순수 로직을 electron에서 쓰면 상대경로 + 인라인 복제. 본 변경은 electron 내부 로직 추가가 거의 없음(분기 + 컬럼 1개)이라 해당 없음.

### 4.2 IPC 시그니처 — 채널 `supabase:add-revision`, **사실상 4지점 수정**
`setId?`를 마지막 인자로 추가:
- `electron/preload.ts:221-229` — `ipcRenderer.invoke('supabase:add-revision', …)` 노출부.
- `electron/main.ts:1824-1828` — **`ipcMain.handle('supabase:add-revision', …)` 인자 시그니처(`:1824-1827`) + `sbAddRevision(...)` 전달부(`:1828`) 둘 다**.
  - ⚠️ main 핸들러는 단순 pass-through가 아니다. 호출 뒤 **activity 로깅 블록(`:1829-1902`)이 `parseRevisionSceneKey(sceneId)`로 sceneKey를 재파싱**한다. 전반(빈 sceneKey)이면 `parseRevisionSceneKey('')`는 throw 없이 `''` 반환 + 씬 해석은 `resolvedPartUuid && sceneNumber` 가드로 skip되어 **비치명적**(다만 activity `sceneLabel`이 빈 씬번호로 어색하게 남을 수 있음 — P3, 허용).
- `ElectronAPI` 타입 선언 `src/types/index.ts:1003` — `supabaseAddRevision` 시그니처.

### 4.3 `src/mocks/devElectronAPI.ts`
- `supabaseAddRevision` mock 끝에 `setId?` 인자 추가.
- `setId: null` 고정 → **전달값 사용**(`setId ?? null`). 실제 시그니처와 패리티(인자 개수·순서 일치).

### 4.4 `src/services/revisionService.ts` `createRevision`
- `CreateRevisionServiceInput`: `sceneKey?: string`(optional) + `setId?: string | null` 추가.
- **전반 분기**(`!input.sceneKey?.trim()`): `getRevisionLookupSceneKeys`(현재 `:439` 무조건 호출) skip, `normalizedSceneKey = ''`, revisionNo는 `nextGeneralRevisionNo(revisions, setId)`(아래 §5)로 계산. IPC(`:482-488`)에 **빈 sceneKey** + `setId` 전달. 로컬 모드는 `all['']`에 push(setId로 세트 구분).
- **씬 분기**: 기존 로직 그대로 + IPC 마지막 인자에 `setId` 추가.
- 생성된 revision 객체의 `setId`를 `input.setId ?? null`로 채움 — **sheets/local 두 분기 모두**(현재 `setId: null` 하드코딩 `:476`, `:518` 2곳).
  - ⚠️ 이 setId 채움은 §4.5의 `syncSetForRevision` / 허브 effect 자동완료가 동작하기 위한 **필수 선행**이다(둘 다 `r.setId===setId`로 집계). setId를 안 채우면 진행률 재평가·알림이 전부 무동작.

### 4.5 `src/stores/useRevisionStore.ts`
- `CreateRevisionInput`: `sceneKey?: string`(optional) + `setId?: string | null` 추가.
- `createRevision` 액션: 서비스 호출 후 `addRevisionOptimistic(revision)`, 그리고 **`revision.setId`가 있으면 `syncSetForRevision(revision.setId)` 호출**(세트 status 재평가 — `deleteRevision` 등 기존 mutation 패턴과 동일, 동적 import fire-and-forget).
  - 근거(메모리 교훈): 세트 status('done'/'open') 영속화는 모든 변경 경로에서 트리거해야 함. 새 open 항목이 done 세트에 들어가면 open으로 재평가돼야 한다. 허브 뷰 effect(`maybeAutoCompleteSet`)도 같이 작동하지만, 액션 레벨에서도 호출해 일관성 확보.

### 4.6 신규 `src/views/retake-hub/RevisionAddModal.tsx`
- props: `targetSet: CompRevisionSet`, `episodes: Episode[]`, `episodeTitles`, `allUsers`, `currentUser`, `onClose`.
- 위 §3 UX. 제출 시 `useRevisionStore().createRevision`.
- 재사용(실제 위치):
  - `EntityAwareInput` (`src/components/common/EntityAwareInput.tsx`), `RevisionRecipientPicker`(`enableAssignee`+`onAssigneesChange`, `src/components/scenes/RevisionRecipientPicker.tsx`), `resizeBlob(file,800,0.8)`(`src/utils/imageUtils.ts`), `buildSceneKey`(`src/services/revisionService.ts:780`), `calcDefaultRecipients`(`src/utils/revisionRecipients.ts`).
  - **파트·씬 union 헬퍼 = `src/views/compositing/newRevisionOptions.ts`**: `buildRevisionPartOptions` / `buildRevisionPartScenesUnion` / `getSourcePartForRevisionScene` / `formatRevisionPartId`. (`NewRevisionModal`도 `src/views/compositing/`에 있음 — 4단계 흐름 그대로 참고.)
  - 이미지 첨부 패턴(파일선택 버튼 + `onPaste` + `handleImageFile`→`resizeBlob`→미리보기+X)은 `src/views/compositing/AddRevisionForm.tsx`를 1:1 모범으로 따른다.

### 4.7 `RetakeHubView.tsx`
- `SetDetailHeader`에 `onAddItem` prop + `+ 항목 추가` 버튼(가져오기 옆, 게이트 없음).
- `showAdd` 상태 + `RevisionAddModal` 렌더(lazy + Suspense, 기존 모달과 동일).

## 5. 순수 로직 / TDD 시드

테스트는 `node:test`(상대경로 import, `@/` 미해석 주의).

> ⚠️ **핵심 정합성(P1, 리뷰 B1) — 전반 판정은 "sceneKey 비어있음"이 아니라 `partOf(sceneKey)==null`(=`RetakeHubItemTable.isGeneralItem` 로직)로 통일한다.**
> 이유: 전반 항목 sceneKey는 낙관 추가 시엔 `''`지만, **재로드 후 `rowToRevision`→`normalizeStoredRevisionSceneKey`가 `''`→`'::'`로 정규화**한다. 즉 같은 항목의 sceneKey가 시점에 따라 `''` ↔ `'::'`로 흔들린다. `'sceneKey===""'`로 번호를 매기면 재로드된 전반 항목(`'::'`)을 못 세어 re# 충돌/리셋이 난다. `partOf`(`split(':').length<2` 또는 `parts[1]` 빈 값 → null)는 `''`와 `'::'`를 **둘 다** 전반으로 잡으므로 안전. — 메모리 `project_scene_case_sensitivity_bug` 교훈(reader/writer/UI키 동반 수정)과 동일 클래스.

- **`nextGeneralRevisionNo(revisions, setId)`** (신규 순수 함수): `r.setId===setId && isGeneral(r.sceneKey)`인 항목 중 max(revisionNo)+1. `isGeneral`은 위 `partOf==null` 기준(공유 헬퍼). 세트 안에서 re#1, re#2… 일관 번호. 빈 세트면 1.
  - 테스트: 빈 목록 → 1 / 기존 2개(`''`) → 3 / **재로드 표현(`'::'`) 섞여도 동일 카운트** / 다른 세트 항목 무시 / 씬 매인 항목(`EP01:A:1`) 무시.
- **전반 판정 헬퍼**(`isGeneralRevision`/`partOf` 동등): store(낙관 카운트)·service(번호)·테스트가 **같은 함수** 사용. (이미 `RetakeHubItemTable`이 쓰는 판정과 일치시킴 — 중복 구현 금지, 공유 모듈로.)
- mock ↔ 실제 `supabaseAddRevision` **시그니처 패리티** 회귀 테스트(인자 개수·`setId` 위치 18번째).

## 6. 회귀 안전

- 기존 호출처(`AddRevisionForm`/`NewRevisionModal`/`RevisionPanel`)는 `setId` 미전달 → `set_id` null → **현행과 100% 동일**.
- 씬-바운드 UUID 해석/`throw` 로직 **미변경**(전반은 그 앞에서 early-return).
- `setId`는 모든 시그니처 마지막 인자 → 기존 인자 순서 불변.
- `imageUrl`은 기존 `createRevision` 인자라 추가 배선 0.
- 담당자 불변식은 `addRevision` 필터 + `RevisionRecipientPicker`(assignee ⊆ notify)로 이중 보장.
- 낙관 추가 실패 시 기존 롤백 경로(`loadRevisions` 재로드) 그대로.

## 7. 검증

1. `npm run typecheck` + `node:test`(신규 `nextGeneralRevisionNo` 포함) + `npm run build:vite`.
2. `npm run build`(installer) 게이트 — 배포 시.
3. 실제 앱 동작:
   - 전반 항목 생성 → 허브 '전반' 그룹에 즉시 표시, 진행률(분모) 증가.
   - 씬 지정 항목 생성 → 세트 테이블 + **그 씬 상세창 리테이크 탭** 양쪽 노출.
   - done 세트에 새 항목 추가 → 세트가 open으로 재평가.
   - 이미지 첨부(붙여넣기/파일) → 미리보기 → 생성 후 카드/테이블에 반영.
   - 담당 승격(왕관) → 담당 워크플로우 정상.
4. 코덱스 리뷰 루프 + 멀티에이전트 적대 리뷰(핵심 생성 경로라 필수).

## 8. 작업 파일 요약

| 파일 | 변경 |
|---|---|
| `electron/supabase.ts` | `addRevision` setId 인자(18번째) + 전반 early 분기(scene_id=null) + INSERT set_id |
| `electron/preload.ts:221-229` | `supabase:add-revision` invoke에 setId 인자 |
| `electron/main.ts:1824-1828` | `ipcMain.handle` 시그니처 + `sbAddRevision(...)` 전달부 둘 다 setId |
| `src/types/index.ts:1003` | `ElectronAPI.supabaseAddRevision` 시그니처 |
| `src/mocks/devElectronAPI.ts:614~` | mock setId 인자 + 값 사용(`setId ?? null`) |
| `src/services/revisionService.ts` | 입력 타입 optional sceneKey + setId, 전반 분기, `nextGeneralRevisionNo`, 생성 setId 채움(2곳) |
| `src/stores/useRevisionStore.ts` | `CreateRevisionInput` 확장 + 생성 후 `syncSetForRevision` |
| 공유 전반 판정 헬퍼 | `isGeneralRevision`(=`partOf==null`) — `RetakeHubItemTable`·service·store·test 공유(단일 모듈) |
| `src/views/retake-hub/RevisionAddModal.tsx` | 신규 모달 |
| `src/views/RetakeHubView.tsx` | 헤더 버튼 + 모달 배선 |
| `tests/*.test.ts` | `nextGeneralRevisionNo`(`''`·`'::'` 혼재 포함) + 시그니처 패리티 |

## 9. 배포 / 노트

- 머지·G드라이브 배포는 **한솔 명시 후**(`bflow-release-deploy`, manifest-last). update-notes는 비개발자 톤(식별자·경로·기술용어 금지).
- 버전: 기능 추가 → 마이너(v1.45.0 예상).
