# 리테이크 4c PR2 — 씬 참조 패널(좌/우 도킹) + 컴포지팅 씬 메모 정리 — 설계

> 상태: 설계 확정(한솔 2026-06-21) · 목표 버전 v1.43.0 · 기준 브랜치 main(v1.42.0)
> 선행: 4c PR1(#씬·파트·화 태그, v1.42.0) 완료. 본 문서는 PR2(Chunk 6 참조 패널) 설계.

## 1. 목표

씬 상세 모달 안에서 **#씬 칩을 좌클릭**하면, 보던 모달의 **왼쪽 또는 오른쪽에** 그 씬의 상세를 **도킹 패널**로 띄운다. 참조 패널은 기존 씬 상세 화면(`UnifiedSceneDetailModal`)을 재사용하므로 정보가 동일하고 **편집도 가능**하다. "메인으로" 버튼으로 참조 씬을 가운데 모달로 승격한다. **#파트·#화 칩**은 기존처럼 그 목록으로 이동(패널 없음). 더불어 **컴포지팅 씬 메모 raw 표시**(직렬화 토큰 노출)를 `stripEntityTokens`로 정리한다(PR1 fast-follow 동봉).

## 2. 현재 상태 (v1.42.0 기준 — 검증 완료)

- **#씬 칩 좌클릭** = `EntityText` `onHashClick` = `navigateToHashTarget(target)` (`src/utils/hashNavigation.ts`).
  - scene: `resolveSceneById(episodes, ep, partId, sceneId, uuid)`(`src/utils/cutScene.ts`) → `navigateToSceneView({ modalRequest })`(`src/utils/sceneNavigationAction.ts`) → `useAppStore.setPendingSceneModalRequest(req)` → ScenesView가 감지해 통합 모달 오픈. **즉 현재는 "점프"(새 모달로 대체)**.
  - part/episode: `navigateToSceneView({ closeModal: true })`로 해당 파트/화 목록 이동.
- **모달 렌더**: `ScenesView`가 `detailMerged && selectedDepartment === 'all'`일 때 `<UnifiedSceneDetailModal merged={detailMerged} … />` 렌더(`src/views/ScenesView.tsx:6408`). `detailMerged`는 `useUnifiedScenes`(`src/hooks/useUnifiedScenes.ts`) 로컬 state.
- **모달 구조**(`src/components/scenes/UnifiedSceneDetailModal.tsx`):
  - `631` backdrop `fixed inset-0 z-50 flex items-center justify-center bg-overlay/60`
  - `645` flex wrapper `flex gap-3 items-stretch max-w-full max-h-full`  ← **本體 + 패널 묶음**
  - 本體 `motion.div`(`w-[min(720px,…)]`) + `992` `<CommentPanelResizable />`
  - 모달 안 메모 표시: `1432` `<EntityText … onHashClick={navigateToHashTarget} />`
- **`stripEntityTokens(text)`**(`src/utils/entityTokens.ts`) 존재: 직렬화 토큰 `[#a001](bscene:…)` → 평문 `#a001`. 멘션·경로·텍스트 보존.

> 참고: 초기 탐색 에이전트가 v1.42.0 이전 워크트리를 읽어 "#씬·onHashClick·stripEntityTokens 미구현"으로 보고했으나, 이는 오류다. 위 사실은 올바른 트리(main=v1.42.0)에서 직접 재확인했다. 단, 탐색 에이전트의 **모달 구조·도킹 패턴·리스크** 분석은 버전 무관하게 유효하여 본 설계에 반영했다.

## 3. 핵심 설계 결정 (한솔 확정)

| # | 결정 |
|---|------|
| 1 | 좌클릭 #씬(**모달 안**) → 참조 패널 도킹. **모달 밖**(카드/시트/위젯/대시보드) → 기존 navigate 유지 |
| 2 | 참조 패널 = `UnifiedSceneDetailModal` 재사용 → 정보 100% 동일 + **편집 가능**(읽기전용 아님) |
| 3 | **좌/우 위치 선택만**(드래그 크기조절 없음) |
| 4 | "**메인으로**" = 참조 씬을 가운데 모달(`detailMerged`)로 승격(자리 교체) |
| 5 | **#파트·#화** → 기존 navigate(패널 없음) |
| 6 | **컴포지팅 씬 메모 raw 3곳** `stripEntityTokens` 정리 동봉 |

## 4. 아키텍처

### 4.A 모달에 dock 모드 추가 — `UnifiedSceneDetailModal`

- 새 prop: `dockMode?: 'modal' | 'left' | 'right'` (기본 `'modal'`).
  - `'modal'`: 현행 그대로(backdrop `fixed inset-0` + 센터 + 키보드/ESC 닫기).
  - `'left'`/`'right'`: **backdrop 미렌더**, 本體만 렌더(부모 flex wrapper가 위치 담당). `motion` 슬라이드 방향만 좌/우. ESC·prev/next 등 전역 키 핸들러는 dock 모드에서 비활성(메인 모달만 소유).
- 근거: 콘텐츠가 **모놀리식**(별도 `SceneDetailContent` 없음, 모달 함수 내 inline). content 추출(대규모 리팩터)은 회귀 위험이 커, **backdrop만 조건 분기**(최소 변경)하는 dockMode 방식 채택.

### 4.B 참조 패널 상태 — ScenesView 로컬

- ScenesView 로컬 state(전역 store 아님): `referenceMerged: MergedScene | null`, `referenceSide: 'left' | 'right'`(기본 `'right'`).
- 근거: 참조 패널은 특정 모달 인스턴스 종속 → **모달이 닫히면 자동 클리어**, 두 인스턴스 state 오염 없음. (전역 `useAppStore`는 race·잔존 위험.)
- 액션: `openReference(target, side)`, `closeReference()`, `setReferenceSide(side)`, `promoteReferenceToMain()`(detailMerged ↔ referenceMerged swap).

### 4.C onHashClick 분기 (모달 안 vs 밖)

- **모달 안**에서 표시되는 모든 `EntityText`(本體 메모 `1432`, `CommentPanel`, `RevisionPanel`, `RevisionCommentThread` 댓글)에는 `onHashClick`으로 **"참조 열기" 래퍼**를 내려보낸다:
  - `(target) => (target.kind === 'scene' && onSceneReference) ? onSceneReference(target, referenceSide) : navigateToHashTarget(target)`
  - 즉 scene → 참조 패널, part/episode → 기존 navigate.
- 구현 — `onSceneReference?: (target: HashTarget, side) => void` 콜백을 모달 안 표시처에 주입(**4갈래, 2브랜치 — 스펙 초안의 'CommentPanel→RevisionCommentThread 2-hop'은 과소평가였음, 검토 반영**):
  1. 本體 메모 `EntityText`(`UnifiedSceneDetailModal.tsx:1432`) — 직접 prop.
  2. **씬 댓글 브랜치**: `UnifiedSceneDetailModal` → `CommentPanelResizable`(현재 hash 관련 prop **없음** → prop 신설) → `CommentPanel`(현재 `navigateToHashTarget`를 모듈 import로 **하드코딩**, `renderText`가 댓글 `:1558`·답글 `:1729`에서 사용 → **prop화** 필요).
  3. **리테이크 댓글 브랜치**: `RevisionPanel`(모달 `:925`에서 렌더) → `RevisionCommentThread`(`RevisionPanel:484`에서 렌더, 현재 `onHashClick` **미전달** = 리테이크 댓글 #칩 비활성). `RevisionCommentThread`는 `onHashClick` prop(`:640`) 보유 → `RevisionPanel`이 주입.
  4. 참조 패널(dock) 자신도 같은 콜백 받아 중첩 #씬 → 참조 교체.
  → 즉 **CommentPanelResizable·CommentPanel·RevisionPanel·RevisionCommentThread 4곳**을 건드린다.
- **모달 밖**(UnifiedSceneCard, UnifiedSceneSheetView, MyTasksWidget 등)은 현행 `navigateToHashTarget` 유지(참조 붙일 모달이 없음). → #씬 클릭 시 기존처럼 모달 오픈.
- 참조 패널 **안**에서 또 #씬 클릭 → 참조가 그 씬으로 교체(같은 onSceneReference, 단일 참조 슬롯).

### 4.D 참조 MergedScene 해석

- #씬 타깃은 `(episodeNumber, partId, sceneId, sceneUuid?)`를 담는다(직렬화 토큰).
- 해석:
  1. `resolveSceneById(...)`로 raw scene 확인(없으면 toast, 패널 안 염).
  2. MergedScene 빌드: 1차 현재 `allMergedScenes`에서 `(ep, part, sceneId)` 매칭. 2차(cross-part/ep) `useDataStore.getState().episodes` 전수 + 기존 merge 로직 재사용으로 빌드.
- 빌더 — `buildMergedScenes`(`src/utils/mergedSceneHelpers.ts:260`)가 **단일 파트 BG/ACT 배열을 받는 순수 export 헬퍼로 이미 존재**(검토 확인). 신규 merge 로직이 아니라 **단일 (ep,part,sceneId)용 얇은 래퍼**만 추출하면 됨(저위험, node:test 가능). 산출 MergedScene이 `sheetName`/`bgSceneIndex`/`actSceneIndex`를 담아 §8.1의 안전 편집 콜백과 정합.

### 4.E 레이아웃 (flex wrapper 확장)

- flex wrapper(`645`) 안에 참조 패널 `motion.div` 삽입:
  - `referenceSide==='left'` → 本體 앞(혹은 CSS `order`).
  - `referenceSide==='right'` → CommentPanelResizable 뒤(가장 바깥) 또는 本體 바로 뒤(댓글보다 안쪽). 기본: 댓글 패널과 충돌 줄이게 **本體 바로 옆**.
- **폭/오버플로우(리스크)**: 本體(720) + 댓글(~360) + 참조(~560) ≈ 1640px+ → FHD에서 빠듯. 대응:
  - 참조 열릴 때 本體 폭을 `flex-shrink` 허용 + 참조 패널 고정폭 `min(560px, 40vw)`.
  - 화면 폭이 임계 미만이면 참조 열 때 댓글 패널 자동 접기(또는 참조를 본체 위 오버레이로 폴백).
- backdrop 클릭=닫기: 참조 패널은 반드시 flex wrapper **안**(같은 z) → backdrop 클릭이 메인+참조 함께 닫음(자연스러움). 참조 내부 클릭은 `stopPropagation`.
- (애니메이션) 기존 flex wrapper는 prev/next 시 `wrapperControls`로 ±56px 슬라이드(`UnifiedSceneDetailModal.tsx:371`). dock 열기/닫기 애니메이션이 이 nav-slide와 **충돌하지 않게 분리**(별도 motion 또는 layout 애니메이션).

### 4.F "메인으로" 승격

- 참조 패널 헤더의 "메인으로" → `promoteReferenceToMain()`: `setDetailMerged(referenceMerged)` + `closeReference()`. (필요 시 직전 메인을 참조로 보내는 "스왑"도 옵션 — 기본은 단순 승격.)

### 4.G 컴포지팅 씬 메모 정리 (동봉)

`scene.memo`를 raw 렌더하는 3곳을 `stripEntityTokens`로 감싼다(title 속성 포함):
- `src/views/compositing/NewRevisionModal.tsx:470` `{selectedScene.memo || '메모 없음'}`
- `src/views/compositing/NewRevisionModal.tsx:543` `{scene.memo || '—'}`
- `src/views/compositing-dashboard/cards/SceneCard.tsx:268`(`const memo = card.bg?.memo || card.act?.memo`) → `298` `{memo}` + `295` `title={memo}`
- **제외**: TimelinePanel `g.memo`(파트 메모), RevisionPanel `revision.description`(CompRevision, 이미 EntityText), 에피소드 아카이브 메모(평문 입력, # 없음).

## 5. 데이터 흐름

```
#씬 칩 클릭(모달 안)
  → onHashClick 래퍼 → onSceneReference(target, side)
  → 참조 MergedScene 해석(resolveSceneById + merge 빌더)
  → ScenesView: referenceMerged 설정
  → flex wrapper에 <UnifiedSceneDetailModal merged={referenceMerged} dockMode={side}
       onSceneReference={…} onFieldUpdate={…}/> 렌더
  → 편집 시 기존 콜백(onFieldUpdate 등, 참조 씬 대상)로 낙관적 업데이트
  → "메인으로" → detailMerged ← referenceMerged, 참조 닫힘
```

## 6. 에러 처리 / 엣지

- 참조 씬 못 찾음 → toast, 패널 안 염.
- 같은 씬(detailMerged===referenceMerged) 참조 → 그냥 열되 편집 충돌은 **LWW**(앱 기존 정책). (동일 씬 두 뷰는 드묾.)
- 폭 부족 → 댓글 패널 자동 접기 / 本體 축소 / 임계 미만 시 오버레이 폴백.
- 두 인스턴스 동시 편집(다른 씬) → 독립, 안전. 같은 씬 → LWW.
- 참조 패널에서 prev/next·ESC 등 전역 단축키 비활성(메인 모달만 소유) → 키 충돌 방지.

## 7. 테스트

- 순수 로직(node:test): 참조 타깃 해석(`resolveSceneById` 기존 테스트), MergedScene 빌더(추출 가능하면), 참조 side 토글/승격을 순수 reducer로 뽑으면 테스트.
- `stripEntityTokens` 기존 테스트 재사용(컴포지팅 정리는 동일 헬퍼).
- UI(preview 불가): `npm run typecheck` + `npm run build:vite` + `npm run build`. **한솔 실사용 확인**(도킹 좌/우, 편집, 메인으로, 오버플로우, 컴포지팅 칩 표시).

## 8. 리스크 / 미해결

1. **두 상세뷰 편집 콜백 — 일부만 재바인딩 필요**(검토 반영, 초안보다 작음):
   - **안전(그대로 재사용)**: `onToggle`(`handleToggleForSheet`)·`onFieldUpdate`(`handleFieldUpdateForSheet`, `ScenesView.tsx:4723`)·`onDeleteDept` — sheetName+index/uuid 자기완결. 참조 MergedScene이 올바른 `sheetName`/`bgSceneIndex`/`actSceneIndex`(=`buildMergedScenes` 산출)를 담으면 cross-part 편집도 안전.
   - **위험(메인 파트 바인딩 → 참조용 재바인딩 필수)**: `onDeleteBoth`(`ScenesView.tsx:6431`, 메인 `bgPart.sheetName` 읽음)·`onAddDept`(`:6452`, 메인 `bgPart`/`actPart`/`mergedScenePartId` 읽음). 참조 패널엔 **참조 씬 파트 기준으로 재바인딩한 콜백 세트**를 별도 전달(안 하면 엉뚱한 메인 씬에 삭제/추가).
   - 낙관적 업데이트 재계산 2회 가능 → 검증.
2. **모달 컨텍스트 prop 체인**: §4.C의 4갈래(CommentPanelResizable·CommentPanel·RevisionPanel·RevisionCommentThread). CommentPanel의 하드코딩 import → prop화, 리테이크 댓글 #칩은 이번에 비로소 활성화됨.
3. **뷰포트 오버플로우 반응형**: 4.E.
4. **참조 MergedScene cross-part 빌드**: 4.D.

> 위 1·3이 구현 중 과도하게 커지면, **폴백**: 참조 패널을 이번엔 "편집 가능하되 댓글 패널과 동시 표시는 좁은 화면에서 제한" 수준으로 출시하고, 풀 동시편집 안정화는 후속. (한솔 확인 후 결정.)

## 9. 범위 밖(향후)

- PR3 우클릭 메뉴(이동/옆에띄우기/수정) — v1.44.0.
- 드래그 크기조절(이번 제외, 좌/우 토글만).
- #파트·#화 요약 패널.

## 10. 구현 순서(권장)

1. **컴포지팅 씬 메모 stripEntityTokens**(작고 독립 — 먼저, 빠른 안전 이득).
2. `UnifiedSceneDetailModal` `dockMode` prop(backdrop 분기 + 전역키 게이트).
3. ScenesView 참조 state(`referenceMerged`/`referenceSide`) + flex wrapper 참조 렌더 + 반응형 폭.
4. `onSceneReference` 분기 배선(本體 메모 + CommentPanel/RevisionPanel/RevisionCommentThread).
5. 참조 MergedScene 해석 헬퍼(빌더 + cross-part 폴백, 가능하면 순수+테스트).
6. 좌/우 토글 + "메인으로" 승격.
7. 검증(typecheck/build) + 한솔 실사용 확인.

---
*작성: Claude × 한솔 (Studio JBBJ) · 2026-06-21*
