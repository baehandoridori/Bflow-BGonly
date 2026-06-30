# 나의 할일 위젯 재설계 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** '나의 할일'(MyTasksWidget) 위젯을 확정 디자인(시안 15)으로 전면 재구현하되, 분석 68건의 구조 문제(모달 종속·씬 이동 부재·데이터 스코핑 버그·2058줄 과밀)를 함께 해소한다.

**Architecture:** 단일 2058줄 파일을 `src/components/widgets/my-tasks/`(진입점 + hooks + components + types)로 분리. 데이터/동기화는 `useMyTasksData` 훅으로, 전체 에피소드는 `useAllEpisodesFlat`로 구독(EP 대시보드 필터 우회). 모달은 `createPortal`로 독립. 위험 낮은 순으로 PR 1~5 단계 배포.

**Tech Stack:** React 18 + TypeScript + Zustand + framer-motion + sonner(toast) + Electron IPC + Supabase. 검증: `npm run typecheck` + 관련 테스트 + `npm run build:vite`.

**확정 사항(2026-06-28):** 커스텀 뷰(탭) 제거 · 개인 할일 날짜/캘린더는 상세 모달로 · 씬 메모 편집은 상세 모달에서만. (스펙: `docs/superpowers/specs/2026-06-28-mytasks-widget-redesign-design.md`)

---

## PR 단위 개요 (위험 낮은 순)

| PR | 내용 | 위험 | 사용자 체감 |
|----|------|------|-------------|
| **1** | 파일 분리 + `useAllEpisodesFlat`(EP 스코핑 버그 수정) + 저장 실패 토스트. **커스텀 뷰 제거.** | 낮음 | EP 대시보드에서도 타 EP 내 씬이 보임(버그 수정). 그 외 동일 |
| **2** | 모달 `createPortal` 분리 + 씬 이동 IPC(`widget:navigate-main`) | 중간 | 팝업서 모달 안 잘림 + 씬 이동 작동 |
| **3** | `DonutHero` + `QuickAdd`(빠른 추가/자동완성) 상단 교체 | 낮음 | 상단이 새 디자인(도넛+빠른추가) |
| **4** | `SceneRow`/`TodoRow`(Success Check)/`SceneCard` + 리스트⇄카드 + 상세 모달 내용 | 낮음 | 행/카드 새 디자인, 씬은 4칸 칩 |
| **5** | 모션(stagger·완료 축하·카운트업) + `prefers-reduced-motion` 가드 | 낮음 | 부드러운 모션·완료 축하 |

각 PR: `typecheck + build:vite` 통과 + 독립 배포 가능. 머지/배포는 한솔 명시 승인 시에만.

---

## Chunk 1: PR 1 — 파일 분리 + 데이터 소스 수정 + 커스텀 뷰 제거

**목표:** UI는 그대로 두고 내부 구조만 정리. 부수효과로 (a) EP 대시보드 모드의 씬 증발 버그 수정, (b) 커스텀 뷰 제거로 코드 단순화, (c) 저장 실패 토스트.

### Task 1.1: 타입 추출

**Files:**
- Create: `src/components/widgets/my-tasks/types.ts`
- 참조: `src/components/widgets/MyTasksWidget.tsx:35-67`(PersonalTodo, TaskView, FlatScene, StageSaveBaseline)

- [x] **Step 1:** `MyTasksWidget.tsx`의 `PersonalTodo`, `FlatScene`, `SceneKey`, `makeKey`, `StageSaveBaseline`, `createStageSaveBaseline` 정의를 `types.ts`로 이동(`TaskView`는 커스텀 뷰 제거로 불필요 — 단 `assigned` 단일 구조에 맞게 정리). export.
- [x] **Step 2:** `npm run typecheck` — 아직 원본이 참조하므로 임시로 원본에 re-import. 통과 확인.
- [x] **Step 3:** Commit `refactor(my-tasks): 타입을 types.ts로 분리`

### Task 1.2: 전체 에피소드 훅 (EP 스코핑 버그 수정)

**Files:**
- Create: `src/components/widgets/my-tasks/hooks/useAllEpisodesFlat.ts`
- 참조: `src/components/widgets/MyTasksWidget.tsx:1193-1211`(allFlat), `src/hooks/useDashboardEpisodes.ts:12-16`(버그 원인), `src/stores/useDataStore.ts`(episodes)

- [x] **Step 1:** `useAllEpisodesFlat(): FlatScene[]` 작성. `useDataStore((s) => s.episodes)` **전체**를 구독해 평탄화(기존 allFlat 로직). `useDashboardEpisodes` 사용 금지. `useMemo` 의존성은 `episodes` 참조만.
- [x] **Step 2:** `npm run typecheck` 통과.
- [x] **Step 3:** Commit `fix(my-tasks): 전체 에피소드 구독으로 EP 대시보드 모드 씬 증발 버그 수정`

### Task 1.3: 데이터/동기화 훅 + 커스텀 뷰 제거 + 저장 토스트

**Files:**
- Create: `src/components/widgets/my-tasks/hooks/useMyTasksData.ts`
- 참조: `MyTasksWidget.tsx:1016-1832`(데이터 로직 전체), `src/services/supabaseService.ts`(readTodos/upsertTodo/deleteTodo/readTaskViews/upsertTaskViews), `src/utils/sceneStageProgression.ts`(순차 단계)

- [x] **Step 1:** 본체의 데이터 로직을 `useMyTasksData`로 이동: 개인할일 로드/저장/CRUD, 씬 토글(`handleSceneToggle`=기존 handleToggle), 인라인 편집, 통계, 파생상태. `useDashboardEpisodes` → `useAllEpisodesFlat`.
- [x] **Step 2:** **커스텀 뷰 제거** — `customViews`/`activeViewId`/`TabBar` 관련 전부 삭제. `assigned`(내 할일) 단일 뷰만. `assigned/custom` 분기(`MyTasksWidget.tsx:1418-1658`) 복붙을 단일 경로로 정리. `assignedTodos`/`assignedSceneKeys`만 유지.
- [x] **Step 3:** **저장 실패 토스트** — 모든 Supabase 저장 catch에서 `toast.error('저장에 실패했어요. 잠시 후 다시 시도해주세요.')` (import sonner). 기존 `ScenesView.tsx`의 sonner 사용 패턴 참조.
- [x] **Step 4:** `_externalDepth`/`_pendingIdMap`/`_deletedBeforeSync`/`stageSaveQueueRef`는 `useRef`로 훅 내부 보존. 캘린더 역동기화 리스너도 이동.
- [x] **Step 5:** `npm run typecheck` 통과.
- [x] **Step 6:** Commit `refactor(my-tasks): 데이터 로직 useMyTasksData 훅 추출 + 커스텀 뷰 제거 + 저장 실패 토스트`

### Task 1.4: 진입점 재조립

**Files:**
- Modify: `src/components/widgets/MyTasksWidget.tsx`(내용 교체) → 또는 `my-tasks/MyTasksWidget.tsx` 생성 후 기존 경로는 배럴 re-export
- 참조: 기존 렌더 JSX `MyTasksWidget.tsx:1908-2056`

- [x] **Step 1:** `my-tasks/MyTasksWidget.tsx` 생성: `useMyTasksData` + 기존 렌더 JSX(커스텀 뷰/TabBar 제거판) 조합. **UI 디자인은 아직 기존 그대로** (PR 3~5에서 교체). 단 탭바만 제거.
- [x] **Step 2:** 기존 `src/components/widgets/MyTasksWidget.tsx`를 `export { MyTasksWidget } from './my-tasks/MyTasksWidget';` 배럴로 교체(import 경로 보존).
- [x] **Step 3:** `npm run typecheck` + `npm run build:vite` 통과.
- [x] **Step 4:** 수동 확인(한솔 dev): 위젯 정상 렌더, 개인할일 추가/완료/삭제, 씬 단계 토글, **EP 대시보드 모드에서 타 EP 내 씬 표시**, 저장 실패 시 토스트.
- [x] **Step 5:** Commit `refactor(my-tasks): 진입점 분리 + 탭바 제거, 기능 동일`

### PR 1 검증 게이트
- [ ] `npm run typecheck` 통과
- [ ] `npm run build:vite` 통과
- [ ] 기존 기능 회귀 없음(개인할일 CRUD/순서, 씬 토글, 캘린더 연동, 크로스창 동기화)
- [ ] EP 대시보드 모드 씬 증발 버그 수정 확인
- [ ] (한솔 승인 시) PR 생성 → 머지 → 배포

---

## Chunk 2~5: PR 2~5 (착수 시 상세화)

> 각 PR 착수 직전 이 문서에 bite-sized task를 추가하고 plan-document-reviewer 검토 후 구현.

## Chunk 2: PR 2 — 모달 포털 분리 + 씬 이동 IPC (착수 상세화 2026-06-29)

**확정 범위(한솔 2026-06-29):** "구조 + 상세모달 B/C". 즉 ①모달 createPortal 분리 ②씬→본체 상세 이동 IPC 에 더해, **확정 B**(개인할일 날짜·캘린더 → TodoDetailModal 이전) + **확정 C**(씬 메모 편집 → SceneDetailModal 이전)까지 포함. 단 행/카드의 **시각 재설계(도넛·칩 우선·카드뷰)는 PR 3~4** 로 유지 — PR 2 는 편집 위치 이전 + 포털 인프라 + 이동까지만.

**현재 상태(PR 1 직후):** 위젯엔 인라인 `AddTaskModal`(`fixed inset-0`, 위젯 트리 종속 → 작은 팝업서 클리핑) 하나뿐. 개인할일/씬 상세 모달은 없고 편집은 전부 인라인(`PersonalTodoContent` 날짜/캘린더, `EditableSceneRow` 더블클릭 메모). 팝업 감지 `IsPopupContext` 존재. 포털 레퍼런스 `EventCreateTooltip.tsx`(ESC·외부클릭·AnimatePresence). 본체 씬 상세는 `src/components/scenes/SceneDetailModal.tsx`(스토어 `setPendingSceneModalRequest` + `navigateToSceneView` 경유 오픈).

### Task 2.1: 신규 IPC `widget:navigate-main` 배선 (preload + main + types + App)

**Files:** Modify `electron/main.ts`, `electron/preload.ts`, `src/types/index.ts`, `src/App.tsx`
**참조:** `feedback:jump-to-scene` 패턴 — main.ts:2670-2693(notify:feedback-toast 핸들러), preload.ts:357-374(onFeedbackJumpToScene), types/index.ts:1018-1036, App.tsx:1916-1925(리스너→navigateNotificationToScene), `navigateToSceneView`(src/utils/sceneNavigationAction.ts:25-57, modalRequest 로 모달 오픈)

- [x] **Step 1:** `electron/main.ts` — `ipcMain.handle('widget:navigate-main', (_e, payload) => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('widget:navigate-main', payload); } })`. payload 타입: `{ sheetName: string; sceneId: string; sceneUuid: string; episodeNumber?: number; partId?: string }`. 기존 `widget:` 핸들러들(main.ts:3485~) 근처에 배치.
- [x] **Step 2:** `electron/preload.ts` — `widgetNavigateMain: (payload) => ipcRenderer.invoke('widget:navigate-main', payload)` + `onWidgetNavigateMain: (cb) => { const h=(_e,d)=>cb(d); ipcRenderer.on('widget:navigate-main', h); return () => ipcRenderer.removeListener('widget:navigate-main', h); }`.
- [x] **Step 3:** `src/types/index.ts` — electronAPI 인터페이스에 `widgetNavigateMain?` + `onWidgetNavigateMain?` 타입 추가(feedback 패턴과 동일 형태).
- [x] **Step 4:** `src/App.tsx` — `onFeedbackJumpToScene` 등록부(1916~) 옆에 `onWidgetNavigateMain` 등록: payload 받아 `navigateToSceneView({ episodeNumber, partId, modalRequest: { sceneName: sceneId, sceneUuid, episodeNumber, partId } })` 로 본체 씬 상세 오픈. cleanup 반환 처리.
- [x] **Step 5:** `npm run typecheck` + `npm run build:vite` 통과.
- [x] **Step 6:** Commit `feat(my-tasks): 위젯 팝업→본체 씬 상세 이동 IPC(widget:navigate-main) 배선`

### Task 2.2: 재사용 포털 모달 래퍼 `ModalPortal` + 기존 AddTaskModal 포털화

**Files:** Create `src/components/widgets/my-tasks/components/ModalPortal.tsx`, Modify `src/components/widgets/MyTasksWidget.tsx`(AddTaskModal)
**참조:** `EventCreateTooltip.tsx`(createPortal/ESC/외부클릭 패턴), 기존 AddTaskModal 마크업(MyTasksWidget.tsx:102-335)

- [x] **Step 1:** `ModalPortal.tsx` 작성: `createPortal(content, document.body)`. backdrop(`fixed inset-0 z-50 bg-overlay/50 backdrop-blur-sm`, 클릭 시 onClose), 컨테이너(`bg-bg-card border rounded-2xl shadow-2xl`, **뷰포트 반응형** `width: min(520px, 100vw-32px)`, `maxHeight: 85dvh`, `flex flex-col`, `e.stopPropagation()`), ESC 키 → onClose, `role="dialog" aria-modal="true"`, 포커스 트랩(컨테이너 ref 첫 포커서블 포커스 + Tab 순환), AnimatePresence/motion 진입·퇴장. props: `{ onClose, children, labelledBy?, maxWidth? }`.
- [x] **Step 2:** AddTaskModal 의 `<div fixed inset-0...><motion.div ...>` 래퍼를 `<ModalPortal onClose={onClose}>...내용...</ModalPortal>` 으로 교체(내부 헤더/탭/폼 내용은 그대로 보존). 위젯 `<AnimatePresence>{showPicker && <AddTaskModal.../>}` 호출부는 유지(ModalPortal 내부 AnimatePresence 와 충돌 없게 — 외부 AnimatePresence 제거하고 ModalPortal 가 퇴장 처리하거나, mount/unmount 만으로 처리).
- [x] **Step 3:** `npm run typecheck` + `npm run build:vite` 통과.
- [x] **Step 4:** 수동 확인(한솔 dev): 작은 팝업 창에서 `내 할일 추가` 모달이 **위젯 경계에 안 잘리고** 화면 중앙 풀사이즈로 뜸. ESC/배경클릭 닫힘.
- [x] **Step 5:** Commit `refactor(my-tasks): 모달을 createPortal 래퍼로 분리 — 작은 팝업서 잘림 해소`

### Task 2.3: TodoDetailModal — 개인할일 날짜·캘린더 모달 이전 (확정 B)

**Files:** Create `src/components/widgets/my-tasks/components/TodoDetailModal.tsx`, Modify `MyTasksWidget.tsx`(PersonalTodoContent + 위젯 selectedTodo 상태)
**참조:** PersonalTodoContent 인라인 편집 로직(MyTasksWidget.tsx:486-677), `updatePersonalTodo`(useMyTasksData), 캘린더 이동 `bflow:navigate-to-date` 패턴(486-520)

- [x] **Step 1:** `TodoDetailModal.tsx` 작성(ModalPortal 사용): props `{ todo, onUpdate, onClose }`. 내용 — 제목 편집, 메모(`EntityAwareInput` 멀티라인, 멘션 ON / #태그 OFF: 기존 정책 동일), 시작일·종료일(date input), `캘린더에 추가` 토글, (addToCalendar 시) `캘린더에서 보기` 이동 버튼. 기존 인라인 편집 로직(commitTitle/commitDates/toggleCalendarLink/navigateToCalendar) 재사용·이식.
- [x] **Step 2:** PersonalTodoContent 에서 **인라인 날짜 편집·날짜 표시·`날짜 추가` 버튼·캘린더 토글 제거**(확정 B: 메인 행엔 날짜/캘린더 미노출). 인라인 제목 편집도 모달로 이전. 행에 남길 것: 드래그 핸들, `::개인` 라벨, (addToCalendar 읽기 표시 아이콘은 유지 가능), 제목·메모(읽기), 체크박스(완료), 삭제. **행 본문 클릭 → TodoDetailModal 오픈**(체크박스/삭제/드래그 제외).
- [x] **Step 3:** MyTasksWidget 에 `selectedTodo: PersonalTodo | null` 상태 + 위젯 하단에서 `selectedTodo && <TodoDetailModal .../>` 1회 렌더(ModalPortal 통해 클리핑 회피). PersonalTodoContent 에 `onOpenDetail(todo)` 콜백 전달.
- [x] **Step 4:** `npm run typecheck` + `npm run build:vite` 통과.
- [x] **Step 5:** 수동 확인: 개인할일 클릭 → 상세 모달, 날짜/캘린더/메모 편집·저장 동작. 메인 행엔 날짜/캘린더 편집 UI 없음.
- [x] **Step 6:** Commit `feat(my-tasks): 개인 할일 상세 모달 신설 — 날짜·캘린더 편집을 모달로 이전(확정 B)`

### Task 2.4: SceneDetailModal — 씬 메모 편집 이전(확정 C) + 본체 씬 상세 이동 버튼

**Files:** Create `src/components/widgets/my-tasks/components/SceneDetailModal.tsx`, Modify `MyTasksWidget.tsx`(EditableSceneRow + renderRow + selectedScene 상태)
**참조:** EditableSceneRow(MyTasksWidget.tsx:351-483, 메모 인라인 편집 + 4단계 트랙), `handleSceneToggle`/`handleEditField`(useMyTasksData), navigateToSceneView / widgetNavigateMain(Task 2.1)

- [x] **Step 1:** `SceneDetailModal.tsx` 작성(ModalPortal 사용): props `{ flat, onToggle, onEditField, onClose }`. 내용 — 씬 컨텍스트(EP>파트>#번호), 4단계 트랙(부서별 라벨·색, `onToggle(flat, stage)` 순차 토글), 이미지(있으면 `scene.imageUrl`/`drive-img://`), 메모 편집(`EntityAwareInput`, `enableHashtag` — 기존 씬 메모 정책 동일), **`본체 씬 상세로 이동` 버튼**. 시각은 현 스타일 유지(재설계는 PR 4).
- [x] **Step 2:** EditableSceneRow 에서 **인라인 메모 편집 제거**(확정 C: editingField/startEdit/commitEdit/Pencil 편집버튼/더블클릭 핸들러 삭제). 4단계 트랙(독립 토글)·제거 버튼은 유지. **행 본문 클릭 → SceneDetailModal 오픈**(트랙·제거 버튼 제외). 행에 **`본체로 이동` 작은 버튼** 추가(한솔 "씬 행에서 ... 버튼").
- [x] **Step 3:** 이동 동작 — 대시보드(`isPopup=false`): `navigateToSceneView({ episodeNumber, partId, department, modalRequest:{ sceneName: scene.sceneId, sceneUuid: scene.<uuid필드>, episodeNumber, partId } })`. 팝업(`isPopup=true`): `window.electronAPI?.widgetNavigateMain?.({ sheetName: flat.sheetName, sceneId: scene.sceneId, sceneUuid: scene.<uuid필드>, episodeNumber, partId })`. (Scene 의 uuid 필드명은 타입 확인 후 사용 — 본체 SceneDetailModal 오픈에 쓰는 식별자와 동일하게.)
- [x] **Step 4:** MyTasksWidget 에 `selectedScene: FlatScene | null` 상태 + 하단 1회 렌더 + renderRow 가 `onOpenDetail(flat)` 전달. `isPopup` 을 모달/행에 전달해 이동 분기.
- [x] **Step 5:** `npm run typecheck` + `npm run build:vite` 통과.
- [x] **Step 6:** 수동 확인: 씬 클릭 → 상세 모달(메모 편집·단계 토글 동작). `본체로 이동` → 대시보드는 본체 씬 상세 오픈, 팝업은 메인 창 떠서 해당 씬 상세 오픈.
- [x] **Step 7:** Commit `feat(my-tasks): 씬 상세 모달 신설 — 메모 편집 이전(확정 C) + 본체 씬 상세 이동`

### Task 2.5: PR 2 검증 게이트 + 버전 + 업데이트 노트 + PR

- [x] **Step 1:** 전체 `npm run typecheck` + `npm run build:vite` 통과. 관련 테스트 있으면 실행.
- [x] **Step 2:** 회귀 확인(한솔 dev): 기존 개인할일 CRUD·순서·캘린더 연동, 씬 단계 토글·제거, 크로스창 동기화. 모달 클리핑 해소. 씬 이동(대시보드/팝업) 동작.
- [x] **Step 3:** 버전 `package.json` 1.51.1 → 1.52.0(기능 추가=마이너) + `DEVLOG/update-notes.json` 항목(비개발자 톤: 모달 안 잘림 + 씬 바로가기).
- [x] **Step 4:** Commit → push → PR 생성(pr-creator 스킬, 비개발자 톤 요약 + 개발자 톤 상세). 
- [x] **Step 5:** codex-review-loop 트리거 + P1/P2 반영 + 재트리거 → "Didn't find any major issues" 까지.

### PR 2 검증 게이트
- [x] `npm run typecheck` 통과
- [x] `npm run build:vite` 통과 (typecheck + 3개 테스트 스위트 포함, exit 0)
- [x] 작은 팝업서 모달 클리핑 해소(createPortal) — 구현 완료(Electron 팝업 시각 실측은 한솔 dev 권장)
- [x] 씬→본체 상세 이동 동작(대시보드 in-app / 팝업 IPC) — 배선 완료 + 배선 테스트 추가
- [x] 확정 B(날짜·캘린더 모달) / 확정 C(씬 메모 모달) 반영, 인라인 편집 회귀 없음
- [x] 심층 리뷰(5렌즈+적대적 검증) 확정 4건(전부 low) 중 #2/#3/#4 반영, #1(팝업 캘린더 cross-window)은 별도 후속
- [ ] (한솔 승인 시) PR 머지 → 빌드 → 배포

## Chunk 3: PR 3 — DonutHero + QuickAdd (상단 헤더 교체) (착수 상세화 2026-06-30)

**목표:** 위젯 상단의 단순 진행률 바를 컴팩트 4색 도넛 히어로로, 하단 `내 할일 추가` 버튼을 헤더 `+` 버튼 기반 QuickAdd(씬 자동완성 + 일반텍스트→개인할일)로 교체한다. 행/카드 재설계와 모션은 PR 4~5로 유지.

**현재 상태(PR 2 직후):** 상단은 `요약 바`(가는 진행 바 + `fullyDone/total (pct%)`, `MyTasksWidget.tsx:761-775`). 추가는 하단 점선 `내 할일 추가` 버튼(`854-861`) → `AddTaskModal`(작업/개인 탭, 다중 씬 선택 피커 + 개인할일 폼, ModalPortal). 데이터 훅 `stats = { total, fullyDone, pct }`(씬 4단계 + 개인 1단계 가중). Widget 헤더는 `headerRight` 슬롯 제공(대시보드: title 우측 / 팝업: headerRight 있을 때만 미니헤더 렌더). 단계 통합색 `STAGE_COLORS`(lo #C4BCFA → png #6C5CE7), 부서별 색 `DEPARTMENT_CONFIGS[dept].stageColors`. 도넛 SVG 패턴 레퍼런스 `OverallProgressWidget.tsx:108-218`(circle + strokeDasharray/strokeDashoffset 세그먼트, rotate(-90)).

**확정 디자인 결정 (목업 `concept-15-r2.html` 정리되어 부재 → 시안15 스펙·메모리 의도 기반. ★4-렌즈 계획 검토 2026-06-30 반영판. 도넛 표기/색·QuickAdd 발견성은 한솔 dev 시각 확인으로 최종 검증):**
1. **도넛 = 내 씬 4단계 누적 진행.** 슬롯 = `sceneTotal × 4`, 단계별(lo/done/review/png) 체크 개수를 **뚜렷한 단계 4색 누적 세그먼트**로 그린다. ★색은 `STAGE_COLORS`(보라 명도 4톤 — 컴팩트 도넛서 구분 안 됨)가 아니라 **`ACTION_TYPE_COLOR`/CLAUDE.md 토큰과 동일한 뚜렷한 4색**: lo `#74B9FF`(파랑)·done `#A29BFE`(보라)·review `#FDCB6E`(노랑)·png `#00B894`(초록). DonutHero 내부 상수 `DONUT_STAGE_COLORS`로 정의(activity 결합 회피, 값만 공유). 세그먼트 사이 1~2px 트랙색 갭으로 경계 분리. **부서 혼합(BG/ACT)이어도 통합 단계색** — "도넛은 진행률 게이지이며 단계 색은 BG/ACT 공통의 단계 의미(준비→완료)를 나타낸다(부서 색 코드 아님)"로 결정 문서화.
2. **도넛 중앙 = 완료 씬 `M / N`** (큰 M, 작게 `/N` 또는 `M/N 씬`). ★검토 반영: `stageProgressPct`(체크박스 57% 식)는 비개발자 멘탈모델과 어긋남 → 중앙 숫자로 강조하지 않는다. `stageProgressPct`는 **도넛 채움 정도(arc)로만** 시각화. 채움은 비반올림 실제값, 중앙 M/N은 완료 씬 정수 → 둘은 역할 분담(≤1% 표시 오차는 의도, "정확히 일치" 단언 삭제).
3. **stat 라인** (도넛 아래/옆): `완료 M · 진행 K · 개인 P`(K=진행 중 씬, P=개인 할일 수).
4. **"오늘 마친 씬 N개" 칩**: 씬 `completedAt`이 로컬 기준 오늘인 `doneScenes` 수. N>0일 때만 표시(#00B894 톤). ★검토 반영: (a) 문구를 "오늘 N개 완료"가 아니라 **"오늘 마친 씬 N개"**로 — 씬 한정·완료자 무관("내 목록 씬 중 오늘 완료된 수")임을 드러냄. (b) `completedAt` falsy/Invalid Date 가드 필수(`if(!c) return false; const d=new Date(c); if(isNaN(d.getTime())) return false;`). (c) 개인 할일은 `completedAt` 필드 없어 제외(스키마/마이그레이션은 PR 4~5), 레거시 미기록 씬도 제외됨 — 의도된 동작(주석·게이트 명시).
5. **strip 접기**: 도넛 패널 접기 토글(chevron) → 한 줄 strip(가는 진행 바 + `M/N 씬 · X%`). 접힘 상태는 위젯 로컬 `useState`(영속 없음). 팝업 세로 공간 절약.
6. **더블베젤 + 포커스카드 톤**: 도넛은 단일 링이 아니라 **트랙 링 + 진행 링의 이중 베젤**(시안15 "더블베젤" 의도). 컨테이너는 옅은 포커스카드 톤(테두리/배경 살짝 강조). 목업 부재 → 정확한 형태는 한솔 dev 시각 확인 게이트.
7. **QuickAdd**: 헤더 `headerRight`에 `+` 버튼(기존 필터 버튼 옆, tooltip `할일 추가`). 클릭 → 도넛 아래 입력칸 슬라이드 등장(autofocus). 동작:
   - 후보 = **MyTasksWidget이 `useAllEpisodesFlat()`로 가진 `allFlat`을 prop으로 전달**(★검토 반영: QuickAdd 자체 재구독 금지 — 씬 1225+ 이중 평탄화 회피. `useMyTasksData`가 `allFlat`을 반환하도록 추가하거나 MyTasksWidget에서 직접 호출해 내려줌).
   - 자동완성: `sceneId.toLowerCase().includes` + 끝자리 번호 매칭, 상위 ~8개. **정렬·강조: '내 담당' 판정은 `useMyTasksData`와 동일한 콤마 분리 매칭**(`scene.assignee.split(',').some(s => s.trim() === currentUserName)`) — 공유 헬퍼 권장. 내 담당 우선 정렬 + 점/펄스 강조. **`existingKeys.has(key)`(이미 목록=비활성+`추가됨`)는 '내 담당'(강조)과 별개 개념으로 분리 처리.** 에피소드 구분 헤더(`episodeTitles`).
   - 키보드: ↑↓ activeIndex, Enter=선택 항목 add(매칭 없으면 텍스트→개인할일), Esc/Tab 닫힘. ★**한글 IME 가드 필수**: onKeyDown 진입부 `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`(Enter/↑/↓ 전부). 개인할일(한글) 조기 추가/중복 방지.
   - 텍스트→개인할일: QuickAdd props `onAddPersonalTodo(title: string)`. ★부모(MyTasksWidget)가 어댑터로 `title`→`PersonalTodo` 객체(`createUuid`·`createdAt`·`completed:false`·`memo:''`·`addToCalendar:false`) 변환해 훅 `addPersonalTodo(객체)` 호출(시그니처 불일치 방지).
   - 드롭다운 = **앵커드 포털**: 레퍼런스는 `AssigneeMultiSelect.tsx`(createPortal+`wrapRef.getBoundingClientRect()`+`position:fixed`+scroll/resize 재계산(capture=true)+외부클릭 mousedown+키보드+`onMouseDown preventDefault`로 외부클릭 중복 방지) **+ `GlassDropdown.tsx`**(아래 공간 부족 시 위로 여는 `shouldOpenUp` 클램프). ★ModalPortal(중앙 모달) 아님.
   - ★클램프 스펙(구속력): (a) `dropdownMaxHeight = min(원하는높이, max(아래공간, 위공간) - 8)`, (b) 아래 공간 < 임계치면 입력칸 위로 띄움(bottom 기준), (c) 드롭다운 자체 `overflow-y:auto` + max-height, (d) 좌우 `min(left, vw - dropW - 8)`. Electron 팝업은 창 경계 밖 paint 불가(최소 280×200) → 세로 플립·내부 스크롤 없으면 잘림.
   - footer/보조: `여러 씬 한번에 추가` → `onOpenFullPicker()`(AddTaskModal 오픈) 후 닫힘. ★발견성: 입력칸 옆 상시 보조 버튼으로도 노출(텍스트 입력 없이 도달). placeholder 힌트 `a001 입력 또는 메모…`.
   - 기존 하단 점선 `내 할일 추가` 버튼 제거.
8. **AddTaskModal 유지**: 다중 씬 선택 피커 회귀 없이 유지(QuickAdd 보조 버튼/footer로 진입). 개인 탭도 보존. `defaultMode`만 'scene'으로.
9. **범위 밖(PR 4~5로 이월):** 카운트업/링버스트/stagger/뷰 크로스페이드 모션, `prefers-reduced-motion` 가드, 행/카드 재설계, 리스트⇄카드 토글, **강화 빈 상태**(PR 3은 최소 안내만). PR 3은 기본 `transition`(width/opacity/슬라이드)만.

### Task 3.1: 데이터 훅 stats 확장 (비파괴) + 순수 함수 추출 + 단위 테스트
**Files:** Create `src/components/widgets/my-tasks/statsUtils.ts`, Modify `useMyTasksData.ts`, Create `tests/myTasksStats.test.ts`
**참조:** stats useMemo(`useMyTasksData.ts:571-584`), completedAt 기록(`601-630`)

- [ ] **Step 1:** 순수 함수 `computeMyTasksStats(scenes, todos, now)`를 `statsUtils.ts`에 추출(★타입만 import — `node --test` type-strip 호환, 값 import/STAGES 미사용, 단계 필드 직접 접근). 반환: 기존 `total/fullyDone/pct` **유지** + `sceneTotal`·`doneSceneCount`·`pendingSceneCount`·`stageCounts{lo,done,review,png}`·`stageProgressPct`·`personalTotal`·`todayCompletedScenes`(completedAt falsy/Invalid 가드 + 로컬 오늘 비교).
- [ ] **Step 2:** `useMyTasksData`의 stats useMemo가 `computeMyTasksStats` 호출하도록 교체(의존성에 doneScenes·allViewScenes·activePersonalTodos). `UseMyTasksDataResult.stats` 타입 확장. 기존 소비처(`MyTasksWidget.tsx:772` fullyDone/total/pct) 비파괴 확인.
- [ ] **Step 3:** `tests/myTasksStats.test.ts`(node:test): sceneTotal=0/personalTotal>0 빈상태, completedAt falsy/Invalid 제외, stageProgressPct 산식, 로컬-오늘 경계. `package.json`의 `test:entity`(또는 신규 `test:mytasks` 체인)에 추가해 `build:vite`가 돌게.
- [ ] **Step 4:** `npm run typecheck` + 새 테스트 통과.
- [ ] **Step 5:** Commit `feat(my-tasks): 도넛용 통계 순수함수 추출 + 단계별/오늘완료 확장 + 단위 테스트`

### Task 3.2: DonutHero 컴포넌트
**Files:** Create `src/components/widgets/my-tasks/components/DonutHero.tsx`, Modify `MyTasksWidget.tsx`(상단 요약바 교체)
**참조:** OverallProgressWidget 도넛 세그먼트(`108-218`, strokeDasharray/offset+rotate(-90)), SceneDetailModal 톤, `ACTION_TYPE_COLOR`(단계 4색 값)

- [ ] **Step 1:** `DonutHero.tsx` 작성. props: `{ stats; collapsed; onToggleCollapse }`. 펼침: 컴팩트 SVG **더블베젤** 도넛(반경 ~34, strokeWidth ~8, 트랙 링 + 진행 링) — `DONUT_STAGE_COLORS`(lo #74B9FF·done #A29BFE·review #FDCB6E·png #00B894) 4색 누적 세그먼트(lo→done→review→png 순, 세그먼트 사이 1~2px 갭, 마지막만 round cap), 트랙 `bg-border`. **중앙 = `M/N`(완료/전체 씬)**. stat 라인(`완료 M · 진행 K · 개인 P`) + `todayCompletedScenes>0`이면 **"오늘 마친 씬 N개"** 칩(#00B894). 우상단 접기 chevron.
- [ ] **Step 2:** 접힘(`collapsed`): 한 줄 strip — 가는 진행 바(stageProgressPct) + `M/N 씬 · X%` + 펼치기 chevron.
- [ ] **Step 3:** 빈 상태(sceneTotal=0 && personalTotal=0): 옅은 안내(강화 빈상태는 PR 4). sceneTotal=0·personalTotal>0: 도넛 0/0 회색 + 개인 stat.
- [ ] **Step 4:** `MyTasksWidget.tsx`에서 `요약 바`(761-775)를 `<DonutHero stats={stats} collapsed={donutCollapsed} onToggleCollapse={...}/>`로 교체. `donutCollapsed` 위젯 로컬 useState.
- [ ] **Step 5:** `npm run typecheck` + `npm run build:vite` 통과.
- [ ] **Step 6:** Commit `feat(my-tasks): 더블베젤 4색 단계 도넛 히어로(중앙 M/N) + 오늘 마친 씬 칩 + 접기 strip`

### Task 3.3: QuickAdd 컴포넌트 (씬 자동완성 + 개인할일)
**Files:** Create `src/components/widgets/my-tasks/components/QuickAdd.tsx`, Modify `MyTasksWidget.tsx`, (옵션) `statsUtils.ts`나 `types.ts`에 `isAssignedToMe`/`filterSceneCandidates` 헬퍼, Create `tests/quickAddSceneFilter.test.ts`
**참조:** ★`AssigneeMultiSelect.tsx`(앵커 포털/키보드/외부클릭/scroll·resize 재계산) + `GlassDropdown.tsx`(위로 여는 클램프), `useAllEpisodesFlat`, `addScenes`/`addPersonalTodo`/`existingKeys`, 콤마 분리 매칭(`useMyTasksData.ts:548-552`)

- [ ] **Step 1:** `QuickAdd.tsx` 작성. props: `{ open; onClose; candidates: FlatScene[]; episodeTitles; existingKeys; currentUserName; onAddScene(key); onAddPersonalTodo(title); onOpenFullPicker }`. ★`candidates`는 부모가 내려줌(자체 useAllEpisodesFlat 재구독 X). 입력 `value` 로컬 상태.
- [ ] **Step 2:** 순수 함수 `filterSceneCandidates(candidates, query, currentUserName, existingKeys)` (statsUtils.ts 또는 quickAddUtils.ts, 타입만 import): includes+끝자리 번호 매칭, 내담당(콤마분리) 우선 정렬→EP→번호, 상위 8. 반환 항목에 `{ flat, isMine, alreadyAdded }`. `tests/quickAddSceneFilter.test.ts`(node:test): 끝자리 매칭(a001 vs '1'), 2인 담당 콤마 매칭, existingKeys 비활성, 정렬.
- [ ] **Step 3:** 드롭다운 UI: 에피소드 구분 헤더, 내담당 점/펄스, alreadyAdded 비활성+`추가됨`. 키보드 ↑↓/Enter/Esc/Tab + ★한글 IME 가드(`isComposing||keyCode===229`). Enter=활성 항목 add 또는 매칭 없으면 `onAddPersonalTodo(value.trim())`.
- [ ] **Step 4:** 앵커드 포털: `createPortal(document.body)`+`position:fixed`, 입력칸 `getBoundingClientRect`, ★세로 플립(아래공간 부족시 위)+`dropdownMaxHeight`+`overflow-y:auto`+좌우 클램프. scroll/resize 재계산(capture) 또는 닫기. 외부클릭 mousedown(입력/드롭다운 제외)+`onMouseDown preventDefault`.
- [ ] **Step 5:** footer/보조 `여러 씬 한번에 추가` → `onOpenFullPicker()`. placeholder 힌트.
- [ ] **Step 6:** `MyTasksWidget.tsx` 통합: `allFlat`(useAllEpisodesFlat 또는 훅 반환) 확보 → QuickAdd `candidates`. 헤더 `headerRight` `+` 버튼(`showQuickAdd` 토글, 필터 버튼과 공존, tooltip). 도넛 아래 `showQuickAdd && <QuickAdd.../>`. 하단 점선 버튼 제거. `onAddPersonalTodo`는 title→PersonalTodo 객체 어댑터. `onOpenFullPicker={()=>{setShowQuickAdd(false);setShowPicker(true);}}`. `AddTaskModal defaultMode="scene"`.
- [ ] **Step 7:** `npm run typecheck` + 새 테스트 + `npm run build:vite` 통과.
- [ ] **Step 8:** Commit `feat(my-tasks): QuickAdd — +버튼 슬라이드 + 씬 자동완성(앵커드 포털·IME 가드) + 개인할일`

### Task 3.4: PR 3 검증 게이트 + 버전 + 업데이트 노트 + PR
- [ ] **Step 1:** 전체 `npm run typecheck` + `npm run build:vite`(my-tasks 단위 테스트 포함) 통과.
- [ ] **Step 2:** 회귀 확인(한솔 dev): 도넛 진행/중앙 M/N/오늘 마친 씬/접기/더블베젤, QuickAdd 자동완성·내담당강조·키보드·한글 입력 중 Enter 안전·개인할일·보조 다중추가 진입, 작은 팝업서 드롭다운 클램프(아래 없으면 위로), 기존 CRUD/토글/동기화.
- [ ] **Step 3:** 버전 `package.json` **1.54.0 → 1.55.0**(기능 추가) + `DEVLOG/update-notes.json` 항목(비개발자 톤: "내 할일 위에 한눈에 보이는 진행 도넛 + 씬 이름만 쳐서 바로 추가").
- [ ] **Step 4:** Commit → push → PR 생성(pr-creator). codex-review-loop → clean. 최종 심층 리뷰 → 빌드 → (승인된) 머지.

### PR 3 검증 게이트
- [ ] `npm run typecheck` 통과
- [ ] `npm run build:vite` 통과(my-tasks 단위 테스트 포함)
- [ ] 도넛 4색 단계 구분 보임 + 중앙 M/N + 채움/표기 역할분담, "오늘 마친 씬" 칩(completedAt 가드), 접기 strip, 더블베젤
- [ ] QuickAdd 자동완성(내담당 콤마매칭 강조·existingKeys 비활성 분리)·키보드·한글 IME Enter 안전·개인할일 fallback·풀피커/보조 진입
- [ ] 드롭다운 클램프 3종: 최소 팝업(280×200)에서 (i)안 잘림 (ii)내부 스크롤 (iii)아래 공간 없으면 위로
- [ ] 팝업서 QuickAdd 입력칸이 리스트를 과도하게 가리지 않음
- [ ] 기존 기능 회귀 없음(개인할일/씬 CRUD·토글·캘린더·크로스창)
- [ ] (한솔 승인 시) PR 머지 → 빌드

## Chunk 4: PR 4 — 행/카드 재설계 + 리스트⇄카드 토글 (착수 상세화 2026-06-30)

**목표:** 리스트 아이템(씬/개인할일)을 시안15 톤으로 재설계하고, 카드 뷰 + 리스트⇄카드 토글을 추가한다. 행/카드 컴포넌트를 `my-tasks/components/`로 분리해 진입점을 더 가볍게. **모션(Success Check 링버스트·stagger·크로스페이드 등)은 PR 5** — PR 4는 정적 디자인 + 기본 transition만.

**현재 상태(PR 3 직후):** `MyTasksWidget.tsx` 안에 `EditableSceneRow`(2줄: EP>파트 컨텍스트 + #번호/메모, 우측 4단계 트랙, hover 이동/제거, 클릭→SceneDetailModal)와 `PersonalTodoContent`(드래그핸들·::개인 라벨·제목/메모·**우측 체크박스**·삭제, 클릭→TodoDetailModal)가 인라인 정의. `renderRow`가 EditableSceneRow 사용. 리스트 구조: pendingScenes(renderRow) → pendingPersonalTodos(Reorder.Group) → 완료 섹션(collapsible). 상세모달(SceneDetailModal/TodoDetailModal)은 PR 2/3에서 기능 완성. 카드 패턴 레퍼런스: `src/views/compositing-dashboard/cards/SceneCard.tsx`(ImageSlot = `url ? <img object-cover loading=lazy> : 없음`, 이미지 URL 직접 src — `drive-img://` 포함 Electron 프로토콜이 처리). 씬 이미지 필드: `scene.guideUrl`/`scene.storyboardUrl`. 단계 색 `DEPARTMENT_CONFIGS[dept].stageColors`, 라벨 `stageLabels`.

**확정 디자인 결정 (시안15 스펙·메모 기반, 한솔 dev 시각확인으로 검증):**
1. **SceneRow** (`components/SceneRow.tsx`, EditableSceneRow에서 추출·재설계): 왼쪽 동그라미 **없음**(씬은 단계 칩이 진행 표시). 2줄(①EP>파트·#번호 컨텍스트 ②메모 or sceneId). 4단계 칩(LO/완료/검수/PNG) 순차 토글(`handleSceneToggle`). **현재 단계 미니라벨 "n/4"**(예: 검수까지 = 3/4) — `currentStageInfo` 순수함수로 계산. 본문 클릭→SceneDetailModal, hover→본체 이동(ExternalLink)+제거(X, isRemovable). 완료 씬(pct 100)은 살짝 흐림.
2. **TodoRow** (`components/TodoRow.tsx`, PersonalTodoContent에서 추출·재설계): **왼쪽 동그라미 체크**(정적 — ring→check 애니메이션은 PR 5)로 이동(현재 우측 체크박스 → 좌측 원형). 드래그핸들·::개인 라벨·제목/메모(읽기)·hover 제거. 본문 클릭→TodoDetailModal.
3. **SceneCard** (`components/SceneCard.tsx`, 신규): 카드 뷰용. 썸네일(**가이드>스보>없음**, `<img object-cover loading=lazy>`, 없으면 `ImageIcon` 플레이스홀더), 상단 EP>파트·#번호, 하단 4단계 칩(토글) + 현재단계 n/4. 클릭(본문/이미지)→상세모달, 칩=토글(stopPropagation), hover 이동/제거. 폭 유동(그리드 셀).
4. **TodoCard** (카드 뷰용 개인할일, SceneCard.tsx 또는 TodoRow.tsx 내 변형): 이미지 없는 컴팩트 카드 — ::개인 라벨, 제목/메모, 모서리 동그라미 체크, 클릭→TodoDetailModal. SceneCard와 동일 그리드 셀 톤.
5. **리스트⇄카드 토글**: 헤더 `headerRight`에 토글 버튼(`List`/`LayoutGrid` lucide, QuickAdd +·필터 버튼 옆). `viewMode: 'list'|'card'` 위젯 로컬 useState. **카드 모드**: pendingScenes→SceneCard, pendingPersonalTodos→TodoCard 를 반응형 그리드(`grid` + `repeat(auto-fill, minmax(~130px, 1fr))` 또는 grid-cols 반응). 완료 섹션도 동일 모드. **드래그 순서변경(Reorder)은 list 모드에서만** — 카드 그리드 DnD는 범위 밖(카드 모드에선 일반 그리드).
6. **빈 상태 강화**: 아이콘 + "아직 할 일이 없어요" + 보조 안내("＋ 버튼으로 씬이나 메모를 추가하세요"). QuickAdd 유도.
7. **완료 섹션**: 기존 collapsible 유지 + 톤 정리(카운트 칩·구분선). list/card 모드 모두 동작.
8. **상세 모달 시각 폴리싱**: SceneDetailModal 4단계 가로 트랙·이미지·메모 여백 정리(기능은 이미 완성, 큰 변경 없음). TodoDetailModal 동일.
9. **범위 밖(PR 5로 이월)**: Success Check 링버스트·콘페티, stagger 진입, 도넛 카운트업, 뷰 크로스페이드, 자성 호버, `prefers-reduced-motion` 가드. PR 4는 `transition` 기본(색/opacity/hover)만.

**★4-렌즈 검토 반영 (2026-06-30) — 구현 시 바인딩:**
- **A. SceneRow**: `forwardRef` 불필요(renderRow가 ref 미전달=죽은 계약) → 일반 함수 컴포넌트. 단 내부 루트 `motion.div`의 `layout` + `key={flat.key}` + `initial/animate/exit`(opacity) 그대로 보존 — 바깥 `AnimatePresence mode="popLayout"`와 함께 완료 이동/제거 애니메이션이 깨지지 않게(회귀 방지, PR5 모션 아님).
- **B. TodoRow = 콘텐츠만 추출**. `Reorder.Group`/`Reorder.Item`(key={todo.id}·value={todo}·onReorder)은 MyTasksWidget에 그대로 유지. TodoRow를 Reorder.Item으로 만들지 말 것.
- **C. isHighlighted 승계 필수**: TodoRow·TodoCard가 `isHighlighted` prop 받아 `scrollIntoView({block:'center'})` + ring 강조 수행. MyTasksWidget이 list/card 양쪽에서 `highlightTodoId===todo.id` 주입. (캘린더→할일 점프 회귀 방지 — 게이트 항목)
- **D. currentStageInfo 정의 확정**: `{ doneCount: number, total: 4, currentStageKey: Stage|null }`. **"n/4"의 n = doneCount = 체크된 단계 수**(statsUtils의 checkedStageCount와 동일 산식 — 비연속/구멍 데이터에도 안전, 비개발자에겐 '4칸 중 켜진 칸'). `currentStageKey` = 마지막 연속 체크 단계(기존 isCurrent 규칙 `checked && (i===last || !s[next])`) — 강조 칩용. 테스트: 전무/전부/연속(lo+done)/비연속(lo+png)/역순.
- **E. 칩 클릭 어포던스(정적)**: hover 시 칩 배경/커서 변화, 미체크 칩은 옅은/점선 테두리 '빈 슬롯', `title`=부서별 전체 라벨(기존 유지). 현재단계 n/4 미니라벨.
- **F. 카드 그리드**: `grid` + `repeat(auto-fill, minmax(132px, 1fr))`, 280px 팝업(가용 ~248px)서 1열 graceful. **씬 그리드 / 개인 그리드 섹션 분리**(이미지 카드 ↔ 텍스트 카드 혼합 금지). 썸네일 `<img onError>`→ImageIcon 폴백. 카드 모드는 `Reorder` 미사용·드래그 핸들 비노출.
- **G. 팝업 리사이즈**: 완료섹션 높이 추정 effect(`doneScenes.length*36+32`, MyTasksWidget.tsx 팝업 전용)의 deps에 `viewMode` 추가. card 모드에선 자동 grow 비활성(내부 스크롤로 잘림 방지). 모달 resize effect와 다툼 없게.
- **H. viewMode**: 위젯 로컬 state + `localStorage` 1키 영속(`bflow_mytasks_view_mode`, 저비용·체감 큼). 기본 `'list'`. 토글은 QuickAdd 열림과 독립.
- **I. 빈 상태**: 리스트 영역 전용(DonutHero는 PR3 자체 빈 표시 유지). 기존 4-조건 재사용. 완전 빈 vs '진행0·완료>0(완료 축하)' 분기.
- **J. 테스트**: `tests/myTasksStageInfo.test.ts`를 `package.json` `test:entity` 체인 끝에 추가(build:vite가 돌게).
- **K. 칩 라벨/색은 `deptCfg.stageLabels`/`stageColors`(부서별; ACT=대기/작업중/피드백/완료). 'LO/완료/검수/PNG'는 BG 예시.** 담당자 이름은 이미 행에 미표시(유지). (스펙 §3 'imageUrl' 표기는 guideUrl/storyboardUrl 오기 — 정정)

### Task 4.1: 행 컴포넌트 추출·재설계 (list 모드) + 현재단계 순수함수
**Files:** Create `components/SceneRow.tsx`·`components/TodoRow.tsx`·`stageInfo.ts`, Create `tests/myTasksStageInfo.test.ts`, Modify `MyTasksWidget.tsx`(EditableSceneRow/PersonalTodoContent 제거→import, renderRow 교체)
- [ ] **Step 1:** 순수함수 `currentStageInfo(scene)` → `{ doneCount: number, total: 4, currentLabelKey: Stage|null }` (체크된 단계 수 + 현재(마지막 연속 체크) 단계). `stageInfo.ts`, 타입만 import, node:test.
- [ ] **Step 2:** `SceneRow.tsx` = EditableSceneRow 이식 + 현재단계 "n/4" 미니라벨 추가 + 톤 정리. `TodoRow.tsx` = PersonalTodoContent 이식 + 체크박스를 **좌측 원형**으로 이동.
- [ ] **Step 3:** `MyTasksWidget.tsx`에서 인라인 정의 제거, 새 파일 import. renderRow가 SceneRow 사용, Reorder.Item이 TodoRow 사용.
- [ ] **Step 4:** `npm run typecheck` + 새 테스트 + `npm run build:vite` 통과.
- [ ] **Step 5:** Commit `refactor(my-tasks): SceneRow/TodoRow 분리·재설계 + 현재단계 n/4`

### Task 4.2: 카드 뷰 + 리스트⇄카드 토글
**Files:** Create `components/SceneCard.tsx`(+ TodoCard), Modify `MyTasksWidget.tsx`
- [ ] **Step 1:** `SceneCard.tsx` 작성(썸네일 가이드>스보, 4단계 칩 토글, 현재단계 n/4, 클릭→모달, hover 이동/제거) + `TodoCard`(이미지 없는 컴팩트).
- [ ] **Step 2:** `MyTasksWidget.tsx`에 `viewMode` 상태 + 헤더 토글 버튼. 리스트 렌더를 `viewMode==='card'`이면 그리드(SceneCard/TodoCard), 아니면 기존 행. 완료 섹션도 분기. Reorder는 list 모드만.
- [ ] **Step 3:** `npm run typecheck` + `npm run build:vite` 통과.
- [ ] **Step 4:** Commit `feat(my-tasks): 리스트⇄카드 뷰 토글 + SceneCard/TodoCard`

### Task 4.3: 빈 상태/완료 섹션 + 상세모달 폴리싱
- [ ] **Step 1:** 강화 빈 상태(아이콘+안내+QuickAdd 유도). 완료 섹션 톤 정리(list/card 공통).
- [ ] **Step 2:** SceneDetailModal/TodoDetailModal 여백·4단계 트랙 시각 폴리싱(기능 불변).
- [ ] **Step 3:** `npm run typecheck` + `npm run build:vite` 통과.
- [ ] **Step 4:** Commit `feat(my-tasks): 강화 빈 상태 + 완료 섹션/상세모달 시각 정리`

### Task 4.4: PR 4 검증 게이트 + 버전 + 업데이트 노트 + PR
- [ ] **Step 1:** 전체 `npm run typecheck` + `npm run build:vite`(my-tasks 단위테스트 포함) 통과.
- [ ] **Step 2:** 회귀 확인(한솔 dev): 행/카드 토글, 씬 단계 토글·이동·제거, 개인할일 완료·드래그·삭제, 상세모달, 빈/완료 섹션, 작은 팝업서 카드 그리드.
- [ ] **Step 3:** 버전 bump(현재 1.56.1 → **1.57.0**, 기능 추가) + `DEVLOG/update-notes.json`(비개발자 톤: "내 할일을 카드로도 볼 수 있고, 행/카드가 더 깔끔해졌어요").
- [ ] **Step 4:** Commit → push → PR(pr-creator) → codex-review-loop clean → 최종 심층 리뷰 → 빌드 → 머지 → 배포.

### PR 4 검증 게이트
- [ ] `npm run typecheck` 통과
- [ ] `npm run build:vite` 통과(단위테스트 포함)
- [ ] SceneRow/TodoRow 재설계(씬=칩·동그라미X, 개인=좌측 원형 체크), 현재단계 n/4
- [ ] 리스트⇄카드 토글, SceneCard 썸네일(가이드>스보>없음), 카드서 칩 토글/이동/제거
- [ ] 강화 빈 상태, 완료 섹션 list/card 동작, 드래그는 list 모드만
- [ ] 기존 기능 회귀 없음(CRUD·토글·캘린더·크로스창·상세모달)
- [ ] (한솔 승인 시) 머지 → 빌드 → 배포

## Chunk 5: PR 5 — 모션 + prefers-reduced-motion 가드 (마지막, 착수 상세화 2026-07-01)

**목표:** 시안15의 모션 폴리싱을 입힌다. **외부 의존성 없이 framer-motion만** 사용하고, **모든 신규 모션은 `prefers-reduced-motion` 가드**로 끈다(접근성·저사양). 생산성 위젯이므로 절제 — 과한 애니메이션 금지, 미세하고 빠르게.

**현재 상태(PR 4 직후):** framer-motion 사용 중(`useReducedMotion` 가용 — function 확인). DonutHero(중앙 M/N 정적, segments는 CSS `transition-all duration-500`, strip는 `transition-[width]`), SceneRow(`motion.div` initial/animate/exit opacity + layout), TodoRow/TodoCard(원형 체크 정적), SceneCard(정적), StageChips(`transition-all`), QuickAdd(이미 slide motion), ModalPortal(scale/opacity exit). 완료 토글 = `togglePersonalTodo`(개인)/`handleSceneToggle`(씬). 뷰 전환 = `viewMode` state.

**확정 디자인 결정 (시안15 §12 모션, framer-motion 한정, 전부 reduced-motion 가드):**
1. **reduced-motion 가드 훅** `my-tasks/useMotion.ts`: framer-motion `useReducedMotion()` 래핑 → `reduce: boolean`. reduce면 신규 모션은 즉시/비활성. (window.matchMedia 직접 대신 framer-motion 훅 — SSR/일관성). 모든 신규 모션 컴포넌트가 이 값으로 게이트.
2. **stagger 진입**: SceneRow/TodoRow/SceneCard/TodoCard 진입 fade+slide-up(y 6→0), `delay = clampStaggerDelay(index)`(상한 ~0.3s, 대량 리스트 폭주 방지). ★데이터 변경(토글/추가)마다 재-stagger 되지 않게 — 진입(initial→animate)에만, layout 애니메이션과 분리. reduce면 delay 0·slide 없음(opacity만 또는 즉시). `clampStaggerDelay` pure + node:test.
3. **Success Check** `components/SuccessCheckCircle.tsx`: 개인 할일 완료 토글 시 원형 ring→check(scale spring) + ring-burst(확장·페이드 링 1회). **마지막 미완료 항목이 완료돼 진행 0이 되면 콘페티**(가벼운 DOM 조각 몇 개 fade-out, 라이브러리 없음). TodoRow/TodoCard 체크박스를 이 컴포넌트로 교체(완료→미완료 토글도 자연스럽게). reduce면 즉시 체크·burst/콘페티 없음.
4. **도넛 카운트업 + 첫 페인트 sweep**: DonutHero 중앙 완료 수(M)를 값 변경 시 카운트업(framer-motion `useMotionValue`+`animate` 또는 작은 rAF 훅, 정수). arc는 mount sweep(0→현재). reduce면 즉시 값·sweep 없음.
5. **strip 슬라이드 / 뷰 크로스페이드**: DonutHero 펼침↔strip 높이/opacity 전환(AnimatePresence). MyTasksWidget viewMode list↔card 크로스페이드(컨테이너 key=viewMode, 짧은 fade). reduce면 즉시 스왑.
6. **자성 호버 글로우**: SceneRow/TodoRow/SceneCard/TodoCard `whileHover` 미세 scale(1.0→1.005~1.01)+옅은 글로우(box-shadow). reduce면 hover 모션 없음(색 hover만 유지).
7. **칩 spring**: StageChips `whileTap` scale(0.9) + 색 transition(기존). reduce면 tap 모션 없음.
8. **모달 퇴장**: ModalPortal 기존 scale/opacity exit 유지(이미 있음) — reduce 가드만 추가 검토(범위 작음, 선택).

**★4-렌즈 검토 반영 (2026-07-01) — 구현 시 바인딩 (모션이 popLayout/Reorder/layout과 충돌 위험 → 강하게 제약):**
- **A. reduce 게이트**: `const reduce = useReducedMotion() === true;`(framer-motion, null→false=모션 ON 기본). 모든 신규 모션은 `reduce`면 즉시/비활성.
- **B. Stagger = 위젯 최초 mount 1회·opacity만**: `y`(slide)는 layout/popLayout 노드(SceneRow)에 **넣지 않는다**(layout+y 떨림). `mountedRef`로 첫 페인트 후 `delay=0` → 토글/완료이동/리오더로 행이 재마운트돼도 **재-stagger 없이 단순 fade**. `delayFn(index)=mountedRef.current ? 0 : clampStaggerDelay(index)`. index는 renderScene/renderPendingTodos/renderDoneTodos map에서 prop 전달.
- **C. 자성 호버 = CSS box-shadow 글로우만**(framer `whileHover scale` 금지 — Reorder transform·layout 측정 충돌). Tailwind `hover:shadow-[...]`+`transition-shadow`. transform/scale 미사용 → 드래그·layout 안전. (reduce에서도 글로우는 '움직임' 아니라 허용, transition만 짧게)
- **D. Success Check**: `SuccessCheckCircle`(TodoRow + SceneCard의 TodoCard **양쪽** 원형 체크 대체). 완료 시 ring→check scale spring. aria-pressed/title/onToggle(stopPropagation)/키보드 보존. reduce→즉시.
  - **★최종 심층 리뷰 반영(2026-07-01)**: 당초 ring-burst 1회를 두려 했으나, 개인 할일을 완료하면 항목이 진행 리스트 → '완료 섹션'(별도 부모·기본 접힘)으로 즉시 이동 = React unmount→remount 라 인스턴스 내 false→true 전이를 관측할 수 없어 burst 가 보일 틈이 없다(dead code) → **ring-burst 제거**. 체크 spring 은 유지(완료 섹션 펼침 시 노출). 전체 완료 축하는 위젯 레벨 Confetti(진행 0 전이)가 담당 — 이쪽은 행 이동과 무관하게 정상 동작.
- **E. 콘페티 = 사용자 의도 트리거만**: pending 0 '부수효과 감지' 금지. MyTasksWidget이 togglePersonalTodo/handleSceneToggle을 **래핑**해 `userCompleteRef` 세움 → effect가 `userCompleteRef && prevPending>0 && pending===0`일 때 1회. **첫 렌더 스킵(mountedRef)**, pending=씬+개인 전체(빈상태 축하 UI와 일관), 타이머 cleanup, reduce→생략. (필터/완료섹션접기/realtime/되돌리기 오발화 차단)
- **F. 뷰 크로스페이드 = 생략**: list↔card 컨테이너를 key/AnimatePresence로 감싸면 내부 Reorder/popLayout 통째 재마운트(드래그 손실·재-stagger). **즉시 전환**으로 두고 문서화. (시안 의도지만 회귀 비용이 커 의도적 미적용)
- **G. 도넛 카운트업**: 중앙 M만, effect deps=`stats.doneSceneCount`(원시값), ≤300ms, **첫 마운트는 즉시값**(sweep 없음), reduce→즉시. arc는 기존 CSS transition 유지(framer sweep 중복 금지). strip 숫자는 정적.
- **H. 칩 whileTap**: StageChips는 평범한 button(layout/Reorder 무관) → `motion.button whileTap={{scale:0.9}}`. reduce→none.
- **I. strip 전환**: DonutHero 펼침↔strip를 AnimatePresence(height/opacity)로(리스트와 격리 — 안전). reduce→즉시.
- **J. 테스트**: `clampStaggerDelay`(reduce/상한/index) pure + `tests/myTasksMotion.test.ts`, test:entity 체인 등록.

### Task 5.1: reduced-motion 훅 + stagger 진입
**Files:** Create `my-tasks/useMotion.ts`·`my-tasks/motionUtils.ts`, Create `tests/myTasksMotion.test.ts`, Modify SceneRow/TodoRow/SceneCard(+TodoCard)
- [ ] **Step 1:** `useMotion.ts` = `useReducedMotion()` 래핑 `useMotionPref(): { reduce: boolean }`. `motionUtils.ts` = pure `clampStaggerDelay(index, reduce): number`(reduce면 0, 아니면 `min(index*0.025, 0.3)`).
- [ ] **Step 2:** SceneRow/TodoRow/SceneCard/TodoCard에 진입 모션(motion.div) + `index` prop으로 stagger delay. reduce 가드. (SceneRow는 이미 motion.div — y/stagger 추가, forwardRef·layout 유지.)
- [ ] **Step 3:** `tests/myTasksMotion.test.ts`(node:test) — clampStaggerDelay reduce/상한/index. test:entity 체인 등록.
- [ ] **Step 4:** typecheck + 새 테스트 + build:vite. Commit.

### Task 5.2: Success Check + 콘페티
**Files:** Create `components/SuccessCheckCircle.tsx`, Modify TodoRow/TodoCard(+MyTasksWidget 완료 콘페티 트리거 검토)
- [ ] **Step 1:** `SuccessCheckCircle` — props `{ completed, onToggle, title }`. ring→check scale spring + 완료 전이 시 ring-burst. reduce 가드. TodoRow/TodoCard의 원형 체크 버튼 대체(동작/aria 보존).
- [ ] **Step 2:** 콘페티 — 마지막 미완료 개인 할일 완료로 pending 0 전이 시 1회(가벼운 DOM, reduce면 생략). 위치는 위젯 또는 행. 과하지 않게.
- [ ] **Step 3:** typecheck + build:vite. Commit.

### Task 5.3: 도넛 카운트업/sweep + 크로스페이드 + 호버/칩
**Files:** Modify DonutHero, MyTasksWidget, StageChips, SceneRow/TodoRow/카드
- [ ] **Step 1:** DonutHero 카운트업(M) + arc mount sweep, reduce 가드.
- [ ] **Step 2:** MyTasksWidget viewMode 크로스페이드(AnimatePresence key=viewMode) + DonutHero strip 전환, reduce 가드.
- [ ] **Step 3:** 자성 호버(whileHover) 행/카드 + StageChips whileTap, reduce 가드.
- [ ] **Step 4:** typecheck + build:vite. Commit.

### Task 5.4: PR 5 검증 게이트 + 버전 + 노트 + PR
- [ ] **Step 1:** typecheck + build:vite(테스트 포함) 통과.
- [ ] **Step 2:** 회귀+모션 확인(한솔 dev): 진입 stagger, 완료 Success Check/콘페티, 도넛 카운트업, 뷰 크로스페이드, 호버, **OS reduced-motion ON 시 전부 즉시/비활성**.
- [ ] **Step 3:** 버전 현재(1.57.1)→**1.58.0** + update-notes(비개발자 톤: "완료할 때 기분 좋은 효과, 부드러운 전환. 동작 줄이기 설정 존중").
- [ ] **Step 4:** Commit → push → PR(pr-creator) → codex-review-loop → 최종 심층 리뷰 → 빌드 → 머지 → 배포.

### PR 5 검증 게이트
- [ ] `npm run typecheck` + `build:vite`(단위 테스트 포함) 통과
- [ ] 모든 신규 모션이 `prefers-reduced-motion: reduce`에서 즉시/비활성 (★핵심)
- [ ] stagger가 데이터 변경마다 재생되지 않음(진입만), 대량 리스트 delay 상한
- [ ] Success Check/콘페티/카운트업/크로스페이드/호버 동작, 기능 회귀 없음
- [ ] (한솔 승인 시) 머지 → 빌드 → 배포

---

## 미해결 기술 리스크 (구현 중 주의)
- 신규 IPC 타이밍(팝업→메인 show/focus), `_externalDepth` StrictMode 이중 실행, `useAllEpisodesFlat` 성능(useMemo 의존성), 카드 썸네일 `imageUrl`/`drive-img://` 이원화. (스펙 §3 리스크 참조)
