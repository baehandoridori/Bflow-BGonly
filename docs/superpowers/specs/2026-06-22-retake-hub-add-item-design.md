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
- 시그니처 끝에 `setId?: string` 추가.
- **early 분기**: `sceneId`(=sceneKey 자리)가 비었거나 공백이면 → `resolvePartUuid`/`resolveSceneUuid…` 호출을 건너뛰고 `part_id`/`scene_id`/`scene_uuid`를 `null`로 둔다(throw 없음).
- 씬이 있으면 **기존 해석 로직 그대로**(미변경).
- INSERT 페이로드에 `set_id: setId ?? null` 추가(양 분기 공통). 다른 컬럼은 불변.
- 담당자 불변식(assignee ⊆ notify) 기존 필터 그대로 적용.

> 주의(메모리 교훈): `electron/`은 `@/` alias로 `src/`를 런타임 import 못 함. 새 순수 로직을 electron에서 쓰면 상대경로 + 인라인 복제. 본 변경은 electron 내부 로직 추가가 거의 없음(분기 + 컬럼 1개)이라 해당 없음.

### 4.2 IPC 시그니처
`supabaseAddRevision`에 `setId?` 인자 추가 — **3곳 동시 수정**:
- `electron/preload.ts` (renderer→main 노출)
- main IPC 핸들러(`electron/main.ts` 또는 ipc 등록 위치) — 인자 전달
- `ElectronAPI` 타입 선언

### 4.3 `src/mocks/devElectronAPI.ts`
- `supabaseAddRevision` mock 끝에 `setId?` 인자 추가.
- `setId: null` 고정 → **전달값 사용**(`setId ?? null`). 실제 시그니처와 패리티(인자 개수·순서 일치).

### 4.4 `src/services/revisionService.ts` `createRevision`
- `CreateRevisionServiceInput`: `sceneKey?: string`(optional) + `setId?: string | null` 추가.
- **전반 분기**(`!input.sceneKey?.trim()`): `getRevisionLookupSceneKeys` 호출 skip, `normalizedSceneKey = ''`, revisionNo는 `nextGeneralRevisionNo(...)`(아래 §5)로 계산. IPC에 빈 sceneKey + `setId` 전달. 로컬 모드는 `all['']`에 push(setId로 세트 구분).
- **씬 분기**: 기존 로직 그대로 + IPC 마지막 인자에 `setId` 추가.
- 생성된 revision 객체의 `setId`는 `input.setId ?? null`로 채움.

### 4.5 `src/stores/useRevisionStore.ts`
- `CreateRevisionInput`: `sceneKey?: string`(optional) + `setId?: string | null` 추가.
- `createRevision` 액션: 서비스 호출 후 `addRevisionOptimistic(revision)`, 그리고 **`revision.setId`가 있으면 `syncSetForRevision(revision.setId)` 호출**(세트 status 재평가 — `deleteRevision` 등 기존 mutation 패턴과 동일, 동적 import fire-and-forget).
  - 근거(메모리 교훈): 세트 status('done'/'open') 영속화는 모든 변경 경로에서 트리거해야 함. 새 open 항목이 done 세트에 들어가면 open으로 재평가돼야 한다. 허브 뷰 effect(`maybeAutoCompleteSet`)도 같이 작동하지만, 액션 레벨에서도 호출해 일관성 확보.

### 4.6 신규 `src/views/retake-hub/RevisionAddModal.tsx`
- props: `targetSet: CompRevisionSet`, `episodes: Episode[]`, `episodeTitles`, `allUsers`, `currentUser`, `onClose`.
- 위 §3 UX. 제출 시 `useRevisionStore().createRevision`.
- 재사용: `EntityAwareInput`, `RevisionRecipientPicker`(enableAssignee), `resizeBlob`, `buildSceneKey`, 파트·씬 union 헬퍼, `calcDefaultRecipients`.

### 4.7 `RetakeHubView.tsx`
- `SetDetailHeader`에 `onAddItem` prop + `+ 항목 추가` 버튼(가져오기 옆, 게이트 없음).
- `showAdd` 상태 + `RevisionAddModal` 렌더(lazy + Suspense, 기존 모달과 동일).

## 5. 순수 로직 / TDD 시드

테스트는 `node:test`(상대경로 import, `@/` 미해석 주의).

- **`nextGeneralRevisionNo(revisions, setId)`** (신규 순수 함수): 같은 세트의 기존 전반 항목(`setId` 일치 && sceneKey 비어있음) 중 max(revisionNo)+1. 세트 안에서 re#1, re#2… 일관 번호. 빈 세트면 1.
  - 테스트: 빈 목록 → 1 / 기존 2개 → 3 / 다른 세트 항목 무시 / 씬 매인 항목 무시.
- **전반 분기 판정**: `createRevision`에서 `sceneKey` 공백 여부로 분기되는지. (가능하면 분기 결정 부분을 순수 헬퍼로 분리해 직접 테스트.)
- mock ↔ 실제 `supabaseAddRevision` **시그니처 패리티** 회귀 테스트(인자 개수·`setId` 위치).

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
| `electron/supabase.ts` | `addRevision` setId 인자 + 전반 early 분기 + INSERT set_id |
| `electron/preload.ts` | `supabaseAddRevision` setId 인자 |
| `electron/main.ts`(또는 ipc 등록부) | setId 전달 |
| ElectronAPI 타입 | `supabaseAddRevision` 시그니처 |
| `src/mocks/devElectronAPI.ts` | mock setId 인자 + 값 사용 |
| `src/services/revisionService.ts` | 입력 타입 optional sceneKey + setId, 전반 분기, `nextGeneralRevisionNo` |
| `src/stores/useRevisionStore.ts` | `CreateRevisionInput` 확장 + 생성 후 syncSetForRevision |
| `src/views/retake-hub/RevisionAddModal.tsx` | 신규 모달 |
| `src/views/RetakeHubView.tsx` | 헤더 버튼 + 모달 배선 |
| `tests/*.test.ts` | `nextGeneralRevisionNo` + 시그니처 패리티 |

## 9. 배포 / 노트

- 머지·G드라이브 배포는 **한솔 명시 후**(`bflow-release-deploy`, manifest-last). update-notes는 비개발자 톤(식별자·경로·기술용어 금지).
- 버전: 기능 추가 → 마이너(v1.45.0 예상).
