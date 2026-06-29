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

### PR 3 — DonutHero + QuickAdd
- `DonutHero.tsx`(4색 도넛 + stat + strip 접기, 카운트업은 PR 5), `QuickAdd.tsx`(+버튼 슬라이드 + 자동완성 드롭다운, 키보드 ↑↓/Enter/Esc, 일반텍스트→개인할일)
- 자동완성 드롭다운 위젯 경계 넘는 fixed 위치 + 뷰포트 클램프

### PR 4 — 행/카드 + 상세 모달 내용
- `SceneRow.tsx`(4단계 칩 순차 토글, 동그라미 없음, 현재단계 n/4, 이동 버튼), `TodoRow.tsx`(Success Check 동그라미), `SceneCard.tsx`(썸네일 가이드>스보>없음)
- 리스트⇄카드 토글. 빈 상태/완료 섹션 새 디자인
- 상세 모달 내용 완성(씬 4단계 가로+이미지+메모, 개인할일 연계자/메모/날짜·캘린더)

### PR 5 — 모션 + reduced-motion
- stagger 진입(`--si`), Success Check 링버스트+confetti, 도넛 카운트업(rAF), strip 슬라이드, 뷰 크로스페이드, 자성 호버
- `window.matchMedia('(prefers-reduced-motion: reduce)')` 전역 가드

---

## 미해결 기술 리스크 (구현 중 주의)
- 신규 IPC 타이밍(팝업→메인 show/focus), `_externalDepth` StrictMode 이중 실행, `useAllEpisodesFlat` 성능(useMemo 의존성), 카드 썸네일 `imageUrl`/`drive-img://` 이원화. (스펙 §3 리스크 참조)
