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

- [ ] **Step 1:** `MyTasksWidget.tsx`의 `PersonalTodo`, `FlatScene`, `SceneKey`, `makeKey`, `StageSaveBaseline`, `createStageSaveBaseline` 정의를 `types.ts`로 이동(`TaskView`는 커스텀 뷰 제거로 불필요 — 단 `assigned` 단일 구조에 맞게 정리). export.
- [ ] **Step 2:** `npm run typecheck` — 아직 원본이 참조하므로 임시로 원본에 re-import. 통과 확인.
- [ ] **Step 3:** Commit `refactor(my-tasks): 타입을 types.ts로 분리`

### Task 1.2: 전체 에피소드 훅 (EP 스코핑 버그 수정)

**Files:**
- Create: `src/components/widgets/my-tasks/hooks/useAllEpisodesFlat.ts`
- 참조: `src/components/widgets/MyTasksWidget.tsx:1193-1211`(allFlat), `src/hooks/useDashboardEpisodes.ts:12-16`(버그 원인), `src/stores/useDataStore.ts`(episodes)

- [ ] **Step 1:** `useAllEpisodesFlat(): FlatScene[]` 작성. `useDataStore((s) => s.episodes)` **전체**를 구독해 평탄화(기존 allFlat 로직). `useDashboardEpisodes` 사용 금지. `useMemo` 의존성은 `episodes` 참조만.
- [ ] **Step 2:** `npm run typecheck` 통과.
- [ ] **Step 3:** Commit `fix(my-tasks): 전체 에피소드 구독으로 EP 대시보드 모드 씬 증발 버그 수정`

### Task 1.3: 데이터/동기화 훅 + 커스텀 뷰 제거 + 저장 토스트

**Files:**
- Create: `src/components/widgets/my-tasks/hooks/useMyTasksData.ts`
- 참조: `MyTasksWidget.tsx:1016-1832`(데이터 로직 전체), `src/services/supabaseService.ts`(readTodos/upsertTodo/deleteTodo/readTaskViews/upsertTaskViews), `src/utils/sceneStageProgression.ts`(순차 단계)

- [ ] **Step 1:** 본체의 데이터 로직을 `useMyTasksData`로 이동: 개인할일 로드/저장/CRUD, 씬 토글(`handleSceneToggle`=기존 handleToggle), 인라인 편집, 통계, 파생상태. `useDashboardEpisodes` → `useAllEpisodesFlat`.
- [ ] **Step 2:** **커스텀 뷰 제거** — `customViews`/`activeViewId`/`TabBar` 관련 전부 삭제. `assigned`(내 할일) 단일 뷰만. `assigned/custom` 분기(`MyTasksWidget.tsx:1418-1658`) 복붙을 단일 경로로 정리. `assignedTodos`/`assignedSceneKeys`만 유지.
- [ ] **Step 3:** **저장 실패 토스트** — 모든 Supabase 저장 catch에서 `toast.error('저장에 실패했어요. 잠시 후 다시 시도해주세요.')` (import sonner). 기존 `ScenesView.tsx`의 sonner 사용 패턴 참조.
- [ ] **Step 4:** `_externalDepth`/`_pendingIdMap`/`_deletedBeforeSync`/`stageSaveQueueRef`는 `useRef`로 훅 내부 보존. 캘린더 역동기화 리스너도 이동.
- [ ] **Step 5:** `npm run typecheck` 통과.
- [ ] **Step 6:** Commit `refactor(my-tasks): 데이터 로직 useMyTasksData 훅 추출 + 커스텀 뷰 제거 + 저장 실패 토스트`

### Task 1.4: 진입점 재조립

**Files:**
- Modify: `src/components/widgets/MyTasksWidget.tsx`(내용 교체) → 또는 `my-tasks/MyTasksWidget.tsx` 생성 후 기존 경로는 배럴 re-export
- 참조: 기존 렌더 JSX `MyTasksWidget.tsx:1908-2056`

- [ ] **Step 1:** `my-tasks/MyTasksWidget.tsx` 생성: `useMyTasksData` + 기존 렌더 JSX(커스텀 뷰/TabBar 제거판) 조합. **UI 디자인은 아직 기존 그대로** (PR 3~5에서 교체). 단 탭바만 제거.
- [ ] **Step 2:** 기존 `src/components/widgets/MyTasksWidget.tsx`를 `export { MyTasksWidget } from './my-tasks/MyTasksWidget';` 배럴로 교체(import 경로 보존).
- [ ] **Step 3:** `npm run typecheck` + `npm run build:vite` 통과.
- [ ] **Step 4:** 수동 확인(한솔 dev): 위젯 정상 렌더, 개인할일 추가/완료/삭제, 씬 단계 토글, **EP 대시보드 모드에서 타 EP 내 씬 표시**, 저장 실패 시 토스트.
- [ ] **Step 5:** Commit `refactor(my-tasks): 진입점 분리 + 탭바 제거, 기능 동일`

### PR 1 검증 게이트
- [ ] `npm run typecheck` 통과
- [ ] `npm run build:vite` 통과
- [ ] 기존 기능 회귀 없음(개인할일 CRUD/순서, 씬 토글, 캘린더 연동, 크로스창 동기화)
- [ ] EP 대시보드 모드 씬 증발 버그 수정 확인
- [ ] (한솔 승인 시) PR 생성 → 머지 → 배포

---

## Chunk 2~5: PR 2~5 (착수 시 상세화)

> 각 PR 착수 직전 이 문서에 bite-sized task를 추가하고 plan-document-reviewer 검토 후 구현.

### PR 2 — 모달 포털 + 씬 이동 IPC
- `electron/preload.ts`에 `widgetNavigateMain` + `electron/main.ts`에 `ipcMain.handle('widget:navigate-main')`(기존 `feedback:jump-to-scene` 패턴 `main.ts:2685` 재사용) + `src/types/index.ts` electronAPI 타입
- `TodoDetailModal.tsx`/`SceneDetailModal.tsx`를 `createPortal(document.body)`로, ESC·포커스트랩·`role=dialog`·뷰포트 반응형(`min(440px, 100vw-32px)`, `85dvh`)
- 씬 이동: 대시보드는 `navigateToSceneView`, 팝업은 신규 IPC로 메인 창 라우팅
- 개인 할일 날짜·캘린더는 `TodoDetailModal` 안으로(확정 B). 씬 메모 편집은 `SceneDetailModal`에서만(확정 C)

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
