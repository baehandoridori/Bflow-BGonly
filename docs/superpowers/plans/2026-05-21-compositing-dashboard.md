# 컴포지팅 현황 대시보드 — 구현 플랜

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans (또는 subagent-driven-development 가능 시) 를 따라 실행. Steps use checkbox (`- [ ]`) syntax. PR 단위로 청크 분할.

**Goal:** B flow 에 새 "컴포지팅 현황 대시보드" 뷰 추가. 6 단계 워크플로 (배치 → 취합중 → 취합 완료 → 보정 중 → 오류 → 완료) 의 EP 별 진행 현황을 실시간으로 보여줌. 기존 컴포지팅 메뉴(리비전 피드백)는 "리비전" 항목으로 분리.

**Spec:** [`docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md`](../specs/2026-05-21-compositing-dashboard-design.md)

**Architecture:**
- 새 테이블 `compositing_states` (씬 단위 1 row, BG/ACT 무관)
- 새 뷰 `CompositingDashboardView` + 서브 폴더 `src/views/compositing-dashboard/`
- 기존 `CompositingView` 는 `compositing-revisions` ViewMode 로 이전
- Supabase Realtime + Presence + Broadcast 로 실시간 협업
- isCompositor 기반 권한 분기

**Tech Stack:** TypeScript + React 18 + Electron + Supabase + Zustand + Tailwind + `node:test` runner

**Branch:** `claude/stupefied-kapitsa-6670b9` (워크트리 — 이미 main 기반)

---

## 실행 순서 / 검증 게이트

각 PR 끝마다:
1. `npm run typecheck` ✓
2. 관련 단위 테스트 ✓ (있을 경우)
3. `npm run build:vite` ✓
4. (PR 4) `npm run build` ✓ — 정식 배포 대비
5. 한솔님 머지 게이트 확인 (메모리 룰)

```
PR 1 — 기반 (토큰 + 타입 + DB 스키마)              ← 이 세션
PR 2 — Store + 공통 컴포넌트                       ← /session-2-start
PR 3 — 메인 뷰 + 사이드바 라우팅                   ← /session-3-start
PR 4 — 마무리 (keyframes + update-notes + 점검)    ← /session-4-start
```

---

## PR 1 — 기반: 토큰 + 타입 + DB 스키마

> **목표:** UI 변경 0. 데이터 모델 + 토큰 + 인프라 준비. 빌드 통과 + Supabase 스키마 적용.

### Task 1.1 — 핸드오프 폴더 복사

**Files:**
- Create: `docs/mockups/compositing-dashboard/` (폴더 전체)

- [x] **Step 1.1.1:** `C:\Users\user\Downloads\design_handoff_unzip\design_handoff_compositing_dashboard\` 의 모든 파일 (README.md, index.html, *.jsx, tokens.css, mock-data.js, CLAUDE_CODE_PROMPT.md) 을 워크트리의 `docs/mockups/compositing-dashboard/` 로 복사. 다음 세션에서 다시 참조 가능.
- [x] **Step 1.1.2:** 복사 검증 — `ls docs/mockups/compositing-dashboard/` 로 파일 11개 확인 (README + 10개 자산).

### Task 1.2 — 디자인 토큰 추가

**Files:**
- Modify: `src/index.css` (또는 `src/themes.ts` 둘 중 토큰 정의 위치)
- Modify: `tailwind.config.js`

- [x] **Step 1.2.1: 컴포지팅 단계 색 토큰 추가** (`src/index.css` 의 `:root` 와 `[data-theme="dark"]` 양쪽):
  ```css
  --status-batch:       #4A5060;
  --status-combine:     #74B9FF;
  --status-aggregated:  #A29BFE;
  --status-adjust:      #FDCB6E;
  --status-error:       #FF7675;
  --status-done:        #00B894;
  ```
  라이트 모드는 동일하게 또는 saturation 약간 낮춤 (점검 후).

- [x] **Step 1.2.2: 파트 색 토큰 추가**:
  ```css
  --part-a: #FF9F43;
  --part-b: #74B9FF;
  --part-c: #A29BFE;
  --part-d: #00CEC9;
  ```

- [x] **Step 1.2.3: 모션 토큰 추가**:
  ```css
  --motion-cascade-duration: 560ms;
  --motion-cascade-stagger:   28ms;
  --motion-cascade-translate: 14px;
  --motion-dock-lift:        -14px;
  --motion-dock-scale:       1.07;
  --motion-glow-duration:    2000ms;
  --motion-wipe-duration:     800ms;
  ```

- [x] **Step 1.2.4: Tailwind extend** — `tailwind.config.js` 의 `theme.extend.colors` 에 status/part 노출:
  ```js
  status: {
    batch: 'var(--status-batch)',
    combine: 'var(--status-combine)',
    aggregated: 'var(--status-aggregated)',
    adjust: 'var(--status-adjust)',
    error: 'var(--status-error)',
    done: 'var(--status-done)',
  },
  part: { a: 'var(--part-a)', b: 'var(--part-b)', c: 'var(--part-c)', d: 'var(--part-d)' },
  ```

### Task 1.3 — TypeScript 타입 확장

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/utils/compositingLabels.ts`

- [x] **Step 1.3.1:** `src/types/index.ts` 에 추가:
  ```typescript
  export type CompositingStatus =
    | 'batch' | 'combine' | 'aggregated' | 'adjust' | 'error' | 'done';

  export type CompositingErrorKind =
    | 'missing_file' | 'fix_blemish' | 'retake' | 'canceled_scene' | 'other';

  export interface CompositingState {
    id: string;
    episodeNumber: number;
    sceneId: string;
    partId: string;
    status: CompositingStatus;
    errorKind: CompositingErrorKind | null;
    errorNote: string | null;
    progressPercent: number;
    updatedAt: string;
    updatedBy: string | null;
  }
  ```

- [x] **Step 1.3.2:** `Scene` 인터페이스에 `durationFrames?: number | null;` 추가.

- [x] **Step 1.3.3:** `ViewMode` 타입에 `compositing-revisions` 추가 (기존 `compositing` 은 유지):
  ```typescript
  export type ViewMode =
    | ... 기존
    | 'compositing'             // 새 — CompositingDashboardView
    | 'compositing-revisions';  // 기존 CompositingView 의 새 식별자
  ```
  단, ViewMode 가 useAppStore 에 있으면 거기서 수정.

- [x] **Step 1.3.4: 라벨 유틸 생성** (`src/utils/compositingLabels.ts`):
  ```typescript
  import type { CompositingStatus, CompositingErrorKind } from '../types';

  export const COMPOSITING_STATUS_LABEL: Record<CompositingStatus, string> = {
    batch: '배치', combine: '취합중', aggregated: '취합 완료',
    adjust: '보정 중', error: '오류', done: '완료',
  };

  export const COMPOSITING_STATUS_TOKEN: Record<CompositingStatus, string> = {
    batch: '--status-batch', combine: '--status-combine',
    aggregated: '--status-aggregated', adjust: '--status-adjust',
    error: '--status-error', done: '--status-done',
  };

  export const COMPOSITING_ERROR_LABEL: Record<CompositingErrorKind, string> = {
    missing_file: '파일 미싱', fix_blemish: '옥에티 수정',
    retake: '리테이크', canceled_scene: '취소된 씬', other: '기타',
  };

  export const COMPOSITING_STATUS_ORDER: CompositingStatus[] = [
    'batch', 'combine', 'aggregated', 'adjust', 'error', 'done',
  ];
  ```

### Task 1.4 — Supabase 마이그레이션 SQL

**Files:**
- Create: `DEVLOG/migrations/2026-05-21-compositing-states.sql`

- [x] **Step 1.4.1: SQL 파일 작성** — spec 의 "4.2 Supabase 스키마" 섹션 SQL 그대로 복사 (compositing_states 테이블 + scenes.duration_frames 컬럼 + RLS 정책 + updated_at 트리거).

- [x] **Step 1.4.2: Supabase 라이브 DB 적용** — `mcp__67cc__apply_migration` 사용. project_id 는 기존 마이그레이션 인접 파일에서 확인 (or `list_projects` 로). 적용 후 `list_tables` 로 `compositing_states` 존재 확인.

- [x] **Step 1.4.3: RLS 검증** — 임의 행 INSERT 시도 (`execute_sql`). isCompositor=true 인 user UUID 로 시도하면 성공, 다른 user UUID 로 시도하면 거부 확인.

### Task 1.5 — supabaseService + IPC 함수 추가

**Files:**
- Modify: `src/services/supabaseService.ts`
- Modify: `electron/supabase.ts`
- Modify: `electron/preload.ts`
- Modify: `src/mocks/devElectronAPI.ts` (preview/mock 모드 호환)

- [x] **Step 1.5.1:** `src/services/supabaseService.ts` 에 `loadCompositingStates(episodeNumber)`, `setCompositingState(input)`, `subscribeCompositingStates(epNum, onChange): () => void` 함수 추가. 기존 `loadScenes` 패턴 차용.

- [x] **Step 1.5.2:** `electron/supabase.ts` 에 IPC wrapper 추가:
  - `supabase:loadCompositingStates`
  - `supabase:setCompositingState`
  - `supabase:compositingStates:subscribe`
  - `supabase:compositingStates:unsubscribe`

- [x] **Step 1.5.3:** `electron/preload.ts` 에 `window.electronAPI.supabaseLoadCompositingStates`, `supabaseSetCompositingState`, `supabaseSubscribeCompositingStates` 노출.

- [x] **Step 1.5.4:** `src/mocks/devElectronAPI.ts` 에 dev/preview 모드용 in-memory mock 함수 추가 (테스트 데이터 시드 포함).

### Task 1.6 — 검증 & 커밋

- [x] **Step 1.6.1:** `npm run typecheck` 통과
- [x] **Step 1.6.2:** `npm run build:vite` 통과
- [x] **Step 1.6.3:** Commit — 단일 commit 또는 task 별 분할:
  ```
  feat(compositing-dashboard): 토큰·타입·DB 스키마 기반 추가

  - 컴포지팅 단계/파트/모션 디자인 토큰 추가 (src/index.css)
  - CompositingStatus / CompositingErrorKind / CompositingState 타입 추가
  - Scene.durationFrames 필드 추가 (후속 spec)
  - compositing_states 테이블 + scenes.duration_frames 컬럼 마이그레이션
  - supabaseService + IPC + preload 확장
  - 핸드오프 폴더 docs/mockups/ 로 복사

  Spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
  ```
- [x] **Step 1.6.4:** Push + PR 생성 (pr-creator 스킬 사용)
- [x] **Step 1.6.5:** 코덱스 리뷰 루프 (codex-review-loop 스킬)
- [x] **Step 1.6.6:** 한솔님 머지 게이트 — PR URL 한솔님께 보고, 머지 OK 명시 받으면 머지

---

## PR 2 — Store + 공통 컴포넌트

> **세션 시작:** `/session-2-start` (worktree 의 .claude/commands/)
>
> **목표:** 의존성 0 의 공통 컴포넌트 + Zustand store. 어떤 뷰에도 영향 없음.

### Task 2.1 — useCompositingDashboardStore

**Files:**
- Create: `src/stores/useCompositingDashboardStore.ts`

- [x] **Step 2.1.1:** Spec 의 "10. Store" 섹션 코드 그대로 적용. zustand create 사용. expandedParts/mutedScenes 는 Set, guideStripVisible 은 localStorage 초기화.

### Task 2.2 — useDataStore 확장

**Files:**
- Modify: `src/stores/useDataStore.ts`

- [x] **Step 2.2.1:** `compositingStates: Map<string, CompositingState>` 필드 추가. Key = `${episodeNumber}:${sceneId}`.
- [x] **Step 2.2.2:** Setter 추가: `setCompositingStates(rows: CompositingState[])`, `setCompositingState(key, row)`, `deleteCompositingState(key)`.
- [x] **Step 2.2.3:** 진입 시 EP 별 로딩 헬퍼 `loadCompositingForEpisode(epNum)` 추가 (CompositingDashboardView 에서 호출).

### Task 2.3 — transientHighlightStore

**Files:**
- Create: `src/stores/transientHighlightStore.ts`

- [x] **Step 2.3.1:** 별도 Zustand store. `highlights: Map<string, { by: string; startedAt: number }>`. `add(key, by)` 메서드는 setTimeout 으로 2.5초 후 자동 delete. `get(key)` 셀렉터.

### Task 2.4 — 공통 컴포넌트

**Files:**
- Create: `src/components/compositing-dashboard/common/StatusChip.tsx`
- Create: `src/components/compositing-dashboard/common/StatusDot.tsx`
- Create: `src/components/compositing-dashboard/common/PartBadge.tsx`

- [x] **Step 2.4.1: StatusChip** — size: 'sm' | 'md' | 'lg' / variant: 'solid' | 'soft' / 카운트 표시 옵션. 핸드오프 `shared.jsx` 의 StatusChip 패턴 차용.
- [x] **Step 2.4.2: StatusDot** — size: 6/8/10/12px / withPulse 옵션 / status prop. 단순한 dot.
- [x] **Step 2.4.3: PartBadge** — size: 'sm' | 'md' | 'lg' / partId: 'A' | 'B' | 'C' | 'D'.

### Task 2.5 — 검증 & 커밋

- [x] **Step 2.5.1:** typecheck + build:vite
- [x] **Step 2.5.2:** Commit:
  ```
  feat(compositing-dashboard): Store + 공통 컴포넌트

  - useCompositingDashboardStore (viewMode/expandedParts/pinnedScene/...)
  - useDataStore.compositingStates Map 확장
  - transientHighlightStore (단계 변경 시 색 펄스용)
  - StatusChip / StatusDot / PartBadge 공통 컴포넌트
  ```
- [ ] **Step 2.5.3:** PR 생성 + 코덱스 루프 + 한솔 머지 게이트

---

## PR 3 — 메인 뷰 + 사이드바 라우팅

> **세션 시작:** `/session-3-start`
>
> **목표:** 사용자가 사이드바 "컴포지팅" 클릭하면 실제 동작하는 화면. 가장 큰 PR.

### Task 3.1 — 사이드바 라우팅 변경

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/stores/useAppStore.ts`

- [ ] **Step 3.1.1: NAV_ITEMS 분리** — `compositing` 항목 라벨 그대로 + 새 icon 다른 거 (예: Clapperboard 유지) / 새 `compositing-revisions` 항목 추가 (라벨 "리비전", icon MessageSquareWarning).
- [ ] **Step 3.1.2: App.tsx 라우팅** — `viewMode === 'compositing'` → `<CompositingDashboardView />` / `viewMode === 'compositing-revisions'` → `<CompositingView />`.
- [ ] **Step 3.1.3: localStorage 마이그레이션** — 첫 진입 시 (`!localStorage['bflow:compositing-split-seen']`) 토스트 안내. 닫으면 플래그 set.
- [ ] **Step 3.1.4: 사이드바 미해결 리비전 배지** — 기존 `compositing` 항목에 붙어있던 미해결 카운트 배지를 `compositing-revisions` 로 이동.
- [ ] **Step 3.1.5: 사이드바 컴포지팅 배지** — `compositing_states` 의 `error` 카운트를 `compositing` 항목 배지로.

### Task 3.2 — DashHeader

**Files:**
- Create: `src/views/compositing-dashboard/DashHeader.tsx`

- [ ] **Step 3.2.1: 구조** — 좌(타이틀+진행률) + 가운데(EP 칩 토글) + 우(담당 컴포지터 칩 + 보는 사람 칩 + ↻).
- [ ] **Step 3.2.2: EP 칩 토글** — useDataStore.episodes 에서 활성 EP 목록 가져와 칩 렌더. 현재 EP 강조. 클릭 = store.setEpisode + preferences 저장.
- [ ] **Step 3.2.3: ◀ ▶ 화살표** — prev/next EP 이동.
- [ ] **Step 3.2.4: 담당 컴포지터 칩** — useDataStore.users 에서 `isCompositor=true` 인 사용자 표시 (MVP: 전원 또는 첫 1명).
- [ ] **Step 3.2.5: 보는 사람 칩** — Supabase Realtime presence 룸 구독 결과로 표시 (Task 3.7 에서 wire).
- [ ] **Step 3.2.6: ↻ 버튼** — `key++` state 로 cascade 재생 트리거.

### Task 3.3 — GuideStrip + StatusLegend

**Files:**
- Create: `src/views/compositing-dashboard/GuideStrip.tsx`
- Create: `src/views/compositing-dashboard/StatusLegend.tsx`

- [ ] **Step 3.3.1: GuideStrip** — localStorage 플래그 체크. 텍스트 + 닫기 버튼. 닫으면 store.dismissGuideStrip.
- [ ] **Step 3.3.2: StatusLegend** — 6 칩, 각 칩 카운트. 클릭 = store.setStatusFilter 토글. 호버 = hoveredStatus (linked highlight 용).

### Task 3.4 — Timeline 패널

**Files:**
- Create: `src/views/compositing-dashboard/timeline/TimelinePanel.tsx`
- Create: `src/views/compositing-dashboard/timeline/LayerPanel.tsx`
- Create: `src/views/compositing-dashboard/timeline/TimeRuler.tsx`
- Create: `src/views/compositing-dashboard/timeline/CompletedBar.tsx`
- Create: `src/views/compositing-dashboard/timeline/WorkingBar.tsx`
- Create: `src/views/compositing-dashboard/timeline/CurrentPositionLine.tsx`

- [ ] **Step 3.4.1: TimelinePanel 컨테이너** — wipe-in 800ms 애니메이션.
- [ ] **Step 3.4.2: LayerPanel** — 좌측 컬럼. Scene 행마다 sceneId + 솔로(S)/뮤트(👁) 토글.
- [ ] **Step 3.4.3: TimeRuler** — `useMemo(() => scenes.every(s => s.durationFrames != null), [scenes])` 로 mode 결정. true 면 분:초, false 면 씬 인덱스 ("Scene 1, Scene 5, ...").
- [ ] **Step 3.4.4: CompletedBar** — status='done' 인 씬들의 가로축 범위. 초록 8px height.
- [ ] **Step 3.4.5: WorkingBar** — status in ('combine','aggregated','adjust'). 파란 12px height + opacity 0.5.
- [ ] **Step 3.4.6: CurrentPositionLine** — 마지막 단계 변경된 씬의 위치. 빨간 1px 세로선 + 삼각 핸들. 200ms transition.

### Task 3.5 — 파트 카드 그리드

**Files:**
- Create: `src/views/compositing-dashboard/cards/PartCardRow.tsx`
- Create: `src/views/compositing-dashboard/cards/PartHeader.tsx`
- Create: `src/views/compositing-dashboard/cards/SceneCard.tsx`

- [ ] **Step 3.5.1: PartHeader** — PartBadge + 라벨 + 카운트 + 펼침 토글. 호버 시 store.setHoveredPart.
- [ ] **Step 3.5.2: PartCardRow** — onMouseMove dock lift 효과 구현 (마우스 X 와 카드 X 거리 함수). throttle (requestAnimationFrame).
- [ ] **Step 3.5.3: SceneCard** — 이미지 분할 (storyboardUrl / guideUrl), 단계 점 (StatusDot), BG/ACT 담당자, 진입 cascade (animation-delay), 1 클릭 pin / 2 클릭 모달, transientHighlight 구독 (색 펄스 + 보낸 사람 아바타 배지).
- [ ] **Step 3.5.4: 상태 필터 dim 효과** — statusFilter 가 있으면 일치 안 하는 카드 opacity 0.35.
- [ ] **Step 3.5.5: 솔로/뮤트 효과** — soloScene 이 있으면 그 씬 외 dim. mutedScenes 에 있으면 그 씬 숨김.

### Task 3.6 — 상세 모달

**Files:**
- Create: `src/views/compositing-dashboard/modal/CompositingSceneModal.tsx`

- [ ] **Step 3.6.1: 구조** — Spec 의 "9. 씬 상세 모달" 그대로. 헤더 / 이미지 두 장 / 단계 그리드 / 오류 사유 / 담당자 / 활동 기록.
- [ ] **Step 3.6.2: 단계 그리드** — 6 칩, 현재 단계 채움, 클릭 = handleStatusChange. isCompositor=false 면 disabled (opacity 0.4 + tooltip "컴포지터만 변경할 수 있습니다").
- [ ] **Step 3.6.3: 오류 사유** — status='error' 일 때만 노출. 5 칩 + 기타. errorKind='other' 면 자유 입력 필드 (max 100자, onBlur 저장).
- [ ] **Step 3.6.4: 키보드 단축키** — 1~6 단계, Esc 닫기, ← → prev/next 씬.

### Task 3.7 — 데이터 동기화 (낙관적 + Realtime + Presence)

**Files:**
- Create: `src/views/CompositingDashboardView.tsx` (메인 컨테이너)
- Modify: `electron/broadcast.ts` (presence 확장)

- [ ] **Step 3.7.1: CompositingDashboardView 마운트** — useEffect 로 EP 변경 시 `loadCompositingForEpisode(epNum)` + subscribe + presence join.
- [ ] **Step 3.7.2: 낙관적 토글 함수** — Spec 의 "11.2 단계 토글" 코드 그대로. 실패 시 prev 로 롤백 + sonner 토스트.
- [ ] **Step 3.7.3: Realtime onChange** — store UPSERT + 본인 아닐 때 transientHighlightStore.add.
- [ ] **Step 3.7.4: Presence join/leave** — `compositing-presence:{epNum}` 채널. EP 전환 시 leave + join.
- [ ] **Step 3.7.5: Broadcast 단계 변경** — channel.send broadcast event 'status-change'. 수신측은 transientHighlight 추가.

### Task 3.8 — preferences 저장

**Files:**
- Modify: `src/services/preferencesService.ts` (또는 settingsService)

- [ ] **Step 3.8.1:** `lastCompositingEpisode: number` 필드 추가. setEpisode 시 디바운스 500ms 저장.

### Task 3.9 — 검증 & 커밋

- [ ] **Step 3.9.1:** typecheck + build:vite
- [ ] **Step 3.9.2:** 라이트/다크 모드 시각 점검 (이미지 첨부 또는 한솔 프리뷰)
- [ ] **Step 3.9.3:** isCompositor=true / false 양쪽 권한 테스트
- [ ] **Step 3.9.4:** 두 창 열고 단계 변경 → Realtime sync + 색 펄스 + 아바타 배지 확인
- [ ] **Step 3.9.5:** Commit + PR + 코덱스 루프 + 한솔 머지 게이트

---

## PR 4 — 마무리: keyframes + update-notes + 라이트 모드

> **세션 시작:** `/session-4-start`
>
> **목표:** 모션 완성도 + 비개발자 톤 update-notes + 라이트 모드 polish + 정식 build 통과.

### Task 4.1 — Keyframes 정리

**Files:**
- Modify: `src/index.css` (또는 별도 `src/styles/compositing-dashboard.css`)

- [ ] **Step 4.1.1:** `bf-cascade-in`, `bf-glow-pulse`, `bf-wipe-in`, `bf-status-flash` keyframes 를 `@layer components` 또는 적절한 layer 에 정리. Spec 의 "13. 모션" 섹션 코드 그대로.
- [ ] **Step 4.1.2:** `prefers-reduced-motion` 미디어 쿼리로 모든 모션 200ms fade-in 으로 override.

### Task 4.2 — 라이트 모드 점검

**Files:**
- Modify: `src/index.css` 의 `:root` (라이트 모드) status/part 토큰

- [ ] **Step 4.2.1:** 라이트 모드에서 status 색이 너무 saturated 인지 확인. 필요 시 -10~20% lightness.
- [ ] **Step 4.2.2:** 카드 배경/보더, 안내 띠 톤, glow pulse 색 — 라이트 모드 대비 확인.
- [ ] **Step 4.2.3:** 한솔 프리뷰 받아 어색한 부분 조정.

### Task 4.3 — Update Notes

**Files:**
- Modify: `DEVLOG/update-notes.json`

- [ ] **Step 4.3.1:** v1.30.0 항목 추가. 한솔의 update-notes 비개발자 톤 룰 준수 (`feedback_update_notes_tone.md` + CLAUDE.md):
  - 식별자/파일경로/기술용어 금지
  - 시나리오 형식 "X 상황 → Y → Z"
  - 슬랙 공유 가능한 톤

  예시:
  ```json
  {
    "version": "1.30.0",
    "date": "2026-05-25",
    "title": "컴포지팅 현황을 한눈에",
    "summary": "씬마다 작업이 어디까지 왔는지(배치/취합/보정/완료/오류) 색으로 바로 보입니다. 컴포지터가 단계를 바꾸면 다른 팀원 화면에도 바로 반영되고, 그 카드가 잠깐 색을 띠며 누가 바꿨는지 작은 아이콘으로 표시돼요.",
    "details": [...]
  }
  ```

### Task 4.4 — E2E 시나리오 체크리스트

**Files:**
- Create: `DEVLOG/compositing-dashboard-e2e.md`

- [ ] **Step 4.4.1:** 수동 테스트 시나리오 체크리스트. Spec 의 "3. 핵심 사용자 흐름" 5 시나리오 + 실제 테스트 절차.

### Task 4.5 — Version bump + lessons

**Files:**
- Modify: `package.json` (version → "1.30.0")
- Modify: `tasks/lessons.md`

- [ ] **Step 4.5.1:** version bump.
- [ ] **Step 4.5.2:** lessons 항목 추가 — 이번 작업에서 학습한 패턴 / 실수 / 결정 근거.

### Task 4.6 — 검증 & 커밋

- [ ] **Step 4.6.1:** `npm run typecheck` ✓
- [ ] **Step 4.6.2:** `npm run build:vite` ✓
- [ ] **Step 4.6.3:** `npm run build` ✓ (정식 빌드, installer)
- [ ] **Step 4.6.4:** Commit + PR + 코덱스 루프
- [ ] **Step 4.6.5:** 한솔님 머지 게이트
- [ ] **Step 4.6.6:** (한솔님 명시 시에만) G드라이브 배포 + 슬랙 공지

---

## 진척 추적

각 청크 끝나면 위 체크박스 채우기. 다음 세션 시작 시 `/session-N-start` slash command 가 이 파일의 다음 미완료 PR 의 첫 task 부터 자동 진행 알림.

PR 1 완료 시점: 한솔님이 머지 OK 한 뒤 이 plan 파일 PR 1 섹션 전체 ✓ 표시 commit 후 다음 세션.

---

## 참고

- Spec: [`../specs/2026-05-21-compositing-dashboard-design.md`](../specs/2026-05-21-compositing-dashboard-design.md)
- Premiere 후속: [`../specs/2026-05-21-premiere-clip-length-import-design.md`](../specs/2026-05-21-premiere-clip-length-import-design.md)
- 핸드오프 (복사 후): `docs/mockups/compositing-dashboard/`
- 핸드오프 (원본): `C:\Users\user\Downloads\design_handoff_unzip\design_handoff_compositing_dashboard\`
- CLAUDE.md 룰: 한글 커밋 / npm run typecheck + 관련 테스트 + build:vite / 낙관적 업데이트 + 롤백 / Supabase 단일 경로 / 자동 업데이트 게이트
- 메모리 룰: PR 머지 게이트 / G드라이브 배포 게이트 / 슬랙 공지 게이트 / update-notes 비개발자 톤
