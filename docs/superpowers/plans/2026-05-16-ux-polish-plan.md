# UX 폴리싱 6종 — 구현 플랜

> **For agentic workers:** in-session execution (한솔 지시). spec: [`docs/superpowers/specs/2026-05-16-ux-polish-design.md`](../specs/2026-05-16-ux-polish-design.md).

**Goal:** 6개 UX 갈증(최근 작업 위젯 묶음 누락 / 카드뷰 하단바 정중앙 / 라쏘 액팅 단계 / 댓글 패널 반응형 / 업데이트 완료 안내 / 사이드바 새 버전 배지) 해소.

**Architecture:** 각 항목 독립적, 같은 PR로 묶어 v1.27.0 polish. spec 그대로 따른다. 4번 v1.26 충돌은 spec 4-2 가이드로 reapply.

**Tech Stack:** TypeScript + React + Framer Motion + Zustand + Sonner + Electron + `node:test` runner.

---

## 실행 순서 / 검증 게이트

각 task 끝: `npm run typecheck` 통과 + 해당 단위테스트 통과. 6개 task 모두 끝나면 `npm run build:vite` 1회 + 수동 동작 확인.

1. Task 1 — 최근 작업 위젯 묶음 (작고 영향 적음, 단위테스트 작성 쉬움)
2. Task 2 — 카드뷰 하단 바 정중앙 (CSS 5줄)
3. Task 6 — 사이드바 새 버전 배지 (CSS + JSX)
4. Task 5 — 업데이트 완료 토스트 + lastSeenVersion
5. Task 3 — 통합 뷰 라쏘 액팅 단계 (bulkActPhaseSet 신규)
6. Task 4 — 댓글 패널 반응형 (가장 큰 변경, v1.26 충돌 대상)

각 task 끝나면 단일 commit.

---

## Task 1 — 최근 작업 위젯 멀티-씬 액션 묶음

**Files:**
- Modify: `src/components/widgets/activity/utils.ts` (sameGroup 함수)
- Modify: `src/components/widgets/activity/ActivityFeed.tsx` (그룹 헤더 라벨 — multi-scene 인 경우 "N개 씬" 표기)
- Test: `tests/activityFeedGrouping.test.ts` (신규)

- [ ] **Step 1.1: 테스트 작성**

`tests/activityFeedGrouping.test.ts` 신규:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupActivities } from '../src/components/widgets/activity/utils.ts';
import type { Activity } from '../src/types/index.ts';

const base = (overrides: Partial<Activity>): Activity => ({
  id: 'a1', userId: 'u1', userName: '한솔', actionType: 'assignee_change',
  actionGroup: 'etc', sceneId: 'scene-1', sceneLabel: 'EP01 #01',
  episodeNumber: 1, department: 'bg', detail: null,
  createdAt: '2026-05-16T00:00:00.000Z', ...overrides,
});

test('multi-scene action: assignee_change 4건 다른 sceneId → 1 group', () => {
  const acts = [
    base({ id: 'a1', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    base({ id: 'a2', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
    base({ id: 'a3', sceneId: 's-3', createdAt: '2026-05-16T00:02:00Z' }),
    base({ id: 'a4', sceneId: 's-4', createdAt: '2026-05-16T00:03:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'group');
  if (r[0].type === 'group') assert.equal(r[0].items.length, 4);
});

test('single-scene action: stage_done 2건 다른 sceneId → 2 items (변경 없음)', () => {
  const acts = [
    base({ id: 'a1', actionType: 'stage_done', actionGroup: 'progress', sceneId: 's-1' }),
    base({ id: 'a2', actionType: 'stage_done', actionGroup: 'progress', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('multi-scene action: 5분 윈도우 초과 → 2 group', () => {
  const acts = [
    base({ id: 'a1', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    base({ id: 'a2', sceneId: 's-2', createdAt: '2026-05-16T00:06:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('multi-scene action: 다른 episode → 묶이지 않음', () => {
  const acts = [
    base({ id: 'a1', sceneId: 's-1', episodeNumber: 1, createdAt: '2026-05-16T00:00:00Z' }),
    base({ id: 'a2', sceneId: 's-2', episodeNumber: 2, createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('layout_change 도 multi-scene 화이트리스트 적용', () => {
  const acts = [
    base({ id: 'a1', actionType: 'layout_change', sceneId: 's-1' }),
    base({ id: 'a2', actionType: 'layout_change', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
});
```

- [ ] **Step 1.2: 테스트 실패 확인**

`node --test ./tests/activityFeedGrouping.test.ts` → 첫 테스트 FAIL (현재 4 items 반환).

- [ ] **Step 1.3: utils.ts 수정**

`src/components/widgets/activity/utils.ts` 의 `groupActivities` 위에 화이트리스트 추가, `sameGroup` 안 `sceneId` 검사를 화이트리스트 분기.

```ts
const MULTI_SCENE_ACTIONS = new Set<ActionType>([
  'assignee_change',
  'layout_change',
  'image_upload_storyboard',
  'image_upload_guide',
]);
```

`sameGroup` 안:
```ts
// 단일-씬 액션만 sceneId 일치 요구. 멀티-씬 액션은 episode 까지만.
if (!MULTI_SCENE_ACTIONS.has(a.actionType) && a.sceneId !== b.sceneId) return false;
```

`ActionType` import 필요.

- [ ] **Step 1.4: 테스트 통과 확인**

- [ ] **Step 1.5: ActivityFeed.tsx 그룹 라벨 보강**

기존 그룹 헤더 라벨에서 액션이 멀티-씬이면 라벨을 `EP01 — N개 씬 담당자 변경` 식으로. 자세한 라벨은 utils.ts 의 `getActivityVerb` 와 `formatActivityGroupLabel` (feedNavigation.ts) 검토 후 결정. 코드를 직접 보고 자연스러운 곳에서 분기.

- [ ] **Step 1.6: typecheck + commit**

```
npm run typecheck
git add src/components/widgets/activity/utils.ts src/components/widgets/activity/ActivityFeed.tsx tests/activityFeedGrouping.test.ts
git commit -m "feat(activity): 멀티-씬 액션 묶음 표기 — 담당자/레이아웃/이미지 업로드 4종 화이트리스트"
```

---

## Task 2 — 카드뷰 하단 일괄 액션 바 콘텐츠 영역 정중앙

**Files:**
- Modify: `src/views/ScenesView.tsx:4392-4404` (motion.div className/animate)

- [ ] **Step 2.1: 변경**

`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 ...` 의 `left-1/2` 제거. `animate` 에 `left` 추가.

```tsx
const sidebarExpanded = useAppStore((s) => s.sidebarExpanded);
const sidebarWidth = sidebarExpanded ? 132 : 64;
const bulkBarLeft = `calc(50vw + ${sidebarWidth / 2}px)`;

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0, left: bulkBarLeft }}
  exit={{ opacity: 0, y: 20 }}
  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
  className="fixed bottom-6 z-50 flex items-center gap-3 px-5 py-2.5 rounded-xl shadow-2xl shadow-black/40"
  style={{
    transform: 'translateX(-50%)',
    background: 'rgb(var(--color-bg-card) / 0.95)',
    border: '1px solid rgb(var(--color-accent) / 0.3)',
    backdropFilter: 'blur(12px)',
  }}
>
```

- [ ] **Step 2.2: typecheck + 수동 동작 확인 (`npm run dev`)**

라쏘 5개 선택 → 사이드바 접힘/펼침 토글 → 바가 콘텐츠 중앙으로 부드럽게 이동.

- [ ] **Step 2.3: commit**

```
git commit -m "feat(scenes): 카드뷰 일괄 액션 바 콘텐츠 영역 정중앙 — 사이드바 너비 보정"
```

---

## Task 6 — 사이드바 새 버전 배지 외부 돌출 + pulse glow

**Files:**
- Modify: `src/components/layout/Sidebar.tsx:290, 326` (하단 컨테이너 overflow-visible, 배지 크기/위치)
- Modify: `src/index.css` or `src/styles/...` — pulse keyframes

- [ ] **Step 6.1: keyframes 추가**

`src/index.css` (또는 글로벌 css 파일 — 위치 확인 후) 에 추가:

```css
@keyframes badgePulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(253, 203, 110, 0.6), 0 0 8px 2px rgba(253, 203, 110, 0.35);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(253, 203, 110, 0), 0 0 12px 4px rgba(253, 203, 110, 0.5);
  }
}
.badge-pulse { animation: badgePulse 2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .badge-pulse { animation: none !important; box-shadow: 0 0 8px 2px rgba(253, 203, 110, 0.4); }
}
```

- [ ] **Step 6.2: Sidebar.tsx 수정**

하단 토글+버전 컨테이너 (Sidebar.tsx:290 `mt-auto flex flex-col ...`) 에 `overflow-visible` 추가 (혹은 className에 그 클래스 명시). 그 안의 점 배지 (326 라인) 를 12px + 외부 돌출 + pulse 클래스로:

```tsx
<span
  aria-hidden="true"
  className="badge-pulse absolute h-3 w-3 rounded-full bg-[#FDCB6E]"
  style={{ right: '-8px', top: '-4px' }}
/>
```

- [ ] **Step 6.3: typecheck + 수동 확인**

`npm run dev` → 새 버전 강제 주입 (또는 mocks/devElectronAPI 에 가짜 updateInfo 주입) → 배지 외부 돌출 + pulse 확인.

- [ ] **Step 6.4: commit**

```
git commit -m "feat(sidebar): 새 버전 배지 외부 돌출 + pulse glow"
```

---

## Task 5 — 업데이트 완료 토스트 + lastSeenVersion

**Files:**
- Modify: `src/types/index.ts` (UserPreferences 인터페이스에 `lastSeenVersion?: string` + `commentPanelWidthPx?: number` 두 필드 모두 추가 — Task 4와 공유)
- Modify: `src/App.tsx` (앱 mount 직후 토스트 체크)
- Modify: `src/utils/semver.ts` 또는 `src/utils/version.ts` (신규 — semverGt 헬퍼)
- Test: `tests/semverGt.test.ts` (신규)

- [ ] **Step 5.1: UserPreferences 인터페이스 확장**

`src/types/index.ts` 의 `UserPreferences` 에 두 필드 추가 (Task 4 도 같이 쓸 commentPanelWidthPx 포함).

- [ ] **Step 5.2: semverGt 헬퍼 + 테스트 작성**

`src/utils/semver.ts` 신규:

```ts
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}
```

`tests/semverGt.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { semverGt } from '../src/utils/semver.ts';

test('major upgrade', () => { assert.equal(semverGt('2.0.0', '1.99.99'), true); });
test('minor upgrade', () => { assert.equal(semverGt('1.26.0', '1.25.11'), true); });
test('patch upgrade', () => { assert.equal(semverGt('1.25.12', '1.25.11'), true); });
test('equal', () => { assert.equal(semverGt('1.25.0', '1.25.0'), false); });
test('downgrade', () => { assert.equal(semverGt('1.25.0', '1.26.0'), false); });
test('missing patch parse as 0', () => { assert.equal(semverGt('1.26', '1.26.0'), false); });
```

- [ ] **Step 5.3: 테스트 통과 확인**

- [ ] **Step 5.4: App.tsx 토스트 체크 로직**

App.tsx 의 적절한 mount 지점에 useEffect 추가. `loadPreferences()` (settingsService) + `toast.success` (sonner) + `setUpdateCenterOpen` (useAppStore).

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    const prefs = (await loadPreferences()) ?? {};
    if (cancelled) return;
    const prev = prefs.lastSeenVersion;
    if (prev && semverGt(__APP_VERSION__, prev)) {
      toast.success(`v${__APP_VERSION__} 으로 업데이트되었어요`, {
        duration: 8000,
        action: {
          label: '업데이트 내역 보기',
          onClick: () => useAppStore.getState().setUpdateCenterOpen(true),
        },
      });
    }
    await savePreferences({ ...prefs, lastSeenVersion: __APP_VERSION__ });
  })();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 5.5: typecheck + 수동 (preferences.json 강제 변경 후 재실행)**

- [ ] **Step 5.6: commit**

```
git commit -m "feat(update): 업데이트 완료 후 첫 실행 시 토스트 + 내역 보기"
```

---

## Task 3 — 통합 뷰 라쏘 액팅 단계 SCENE_PHASES set

**Files:**
- Modify: `src/views/ScenesView.tsx:4441-4459` (ACT 행)
- Modify: `src/stores/useBulkOperationsStore.ts` (`bulkSetActPhase` 추가, `kind` 에 `act-phase-set` 케이스 추가)
- Modify: `src/services/supabaseService.ts` 또는 적절한 service (bulkSetActPhase IPC 호출)
- Modify: `electron/preload.ts` + `electron/main.ts` + `electron/supabase.ts` (IPC 채널 신규 또는 기존 phase 단일 변경 IPC 의 반복 호출)
- Test: `tests/bulkActPhaseSet.test.ts` (신규 — 가능하면 단위 가능한 부분만)

- [ ] **Step 3.1: 기존 phase 변경 흐름 검토**

ScenesView.tsx 의 `handleActPhaseStateClick` / `useDataStore.setSceneActPhase` 등 단일-씬 phase 변경 경로 확인. bulk 는 그 함수를 N번 호출하는 형태로 시작 (최적화는 나중).

- [ ] **Step 3.2: useBulkOperationsStore 에 act-phase-set kind 추가**

```ts
// kind 타입에 'act-phase-set' 추가
// activeOp 의 targetStage 자리 같은 식으로 targetPhase: ScenePhaseState 추가
```

기존 `stage-toggle` 패턴 그대로 따른다.

- [ ] **Step 3.3: ScenesView.tsx ACT 행 교체**

```tsx
{SCENE_PHASES.map((phase) => (
  <button
    key={`act-${phase}`}
    onClick={() => handleBulkActPhaseSet(phase)}
    disabled={isBulkInFlight}
    className="h-7 px-2.5 text-[11px] font-medium rounded-md ..."
    style={{
      backgroundColor: `${SCENE_PHASE_COLORS[phase]}20`,
      color: SCENE_PHASE_COLORS[phase],
      border: `1px solid ${SCENE_PHASE_COLORS[phase]}40`,
    }}
  >
    {SCENE_PHASE_LABELS_SHORT[phase]}
  </button>
))}
```

`handleBulkActPhaseSet` 구현 — 선택된 mergedKey 들 중 ACT 부서 씬만 추출 → 각 씬에 phase set.

- [ ] **Step 3.4: typecheck + 수동 동작 확인**

통합 뷰에서 5개 선택 (BG 2 + ACT 3) → ACT 행 4 phase 버튼 보이는지 → "작업중" 클릭 → ACT 3 개만 phase 변경 → BulkOperationStatus 토스트 라벨 확인.

- [ ] **Step 3.5: commit**

```
git commit -m "feat(scenes): 통합 뷰 일괄 액션 바 액팅 행 SCENE_PHASES 4 버튼"
```

---

## Task 4 — 상세 모달 댓글 패널 3중 반응형

**Files:**
- Create: `src/hooks/useCommentPanelWidth.ts`
- Create: `src/hooks/useViewportWidth.ts` (없으면)
- Test: `tests/useCommentPanelWidth.test.ts`
- Modify: `src/components/scenes/SceneDetailModal.tsx:1078` (w-80 → style.width + 드래그 핸들 + 더블클릭)
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx:815` (동일)

- [ ] **Step 4.1: useViewportWidth 훅**

기존에 있으면 재사용, 없으면 신규.

```ts
export function useViewportWidth(): number {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}
```

- [ ] **Step 4.2: useCommentPanelWidth 훅 + 테스트 작성**

spec 3-4 의 핵심 로직. 다만 React hook 테스트는 node:test 환경에서 직접 어려우므로, 순수 함수 `computeAutoCommentPanelWidth(viewportW, commentCount): number` 를 분리해서 단위 테스트.

```ts
// src/hooks/useCommentPanelWidth.ts
export function computeAutoCommentPanelWidth(viewportW: number, commentCount: number): number {
  const base = Math.max(320, Math.min(480, viewportW * 0.26));
  const boost = commentCount > 15 ? 80 : commentCount > 5 ? 40 : 0;
  return Math.min(600, base + boost);
}
```

훅은 이 함수를 감싸고 savedWidth 우선순위 처리.

`tests/useCommentPanelWidth.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAutoCommentPanelWidth } from '../src/hooks/useCommentPanelWidth.ts';

test('viewport=1440 count=0 → 374px', () => {
  assert.equal(computeAutoCommentPanelWidth(1440, 0), 1440 * 0.26);
});
test('viewport=1024 count=8 → 320 + 40 = 360', () => {
  assert.equal(computeAutoCommentPanelWidth(1024, 8), 360);
});
test('viewport=1920 count=20 → 480 + 80 = 560', () => {
  assert.equal(computeAutoCommentPanelWidth(1920, 20), 560);
});
test('viewport=320 count=0 → 320 (lower bound)', () => {
  assert.equal(computeAutoCommentPanelWidth(320, 0), 320);
});
test('boost cap: viewport=3840 count=50 → 600 (auto cap)', () => {
  assert.equal(computeAutoCommentPanelWidth(3840, 50), 600);
});
```

- [ ] **Step 4.3: 테스트 통과 확인**

- [ ] **Step 4.4: SceneDetailModal 댓글 패널 width + 드래그 핸들**

`w-80` 클래스 제거 → `style={{ width: panelWidth }}`. 좌측 4px 핸들 추가, mouseup-only 저장, useEffect cleanup, 더블클릭 reset.

- [ ] **Step 4.5: UnifiedSceneDetailModal 동일 적용**

- [ ] **Step 4.6: typecheck + 수동 (댓글 0 / 8 / 20 / 드래그 / 더블클릭 자동 모드 복귀)**

- [ ] **Step 4.7: commit**

```
git commit -m "feat(scenes): 댓글 패널 3중 반응형 (clamp + 갯수 boost + 드래그 리사이저)"
```

---

## 최종 게이트

- [ ] `npm run typecheck`
- [ ] `node --test ./tests/activityFeedGrouping.test.ts ./tests/semverGt.test.ts ./tests/useCommentPanelWidth.test.ts`
- [ ] `npm run build:vite`
- [ ] 수동 통합 시나리오:
  - 카드 뷰에서 라쏘 선택 → 사이드바 토글 → 바 위치 OK + ACT 행 phase 버튼 OK
  - 상세 모달 열기 → 댓글 패널 자동 너비 + 드래그 + 더블클릭
  - preferences.json 의 lastSeenVersion 강제 변경 후 재실행 → 토스트 + 내역 보기
  - 사이드바 새 버전 배지 외부 돌출 + pulse
  - RecentActivityWidget 에 담당자 일괄 변경 묶음 표기 확인

---

*Plan v1 — 2026-05-16*
