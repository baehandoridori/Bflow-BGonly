# UX 폴리싱 6종 — 설계 문서

> **작성일**: 2026-05-16
> **대상 버전**: v1.26.x (잠정 — v1.26 본체 대신 polish 패치) 또는 v1.27.0
> **상태**: 설계 확정, 구현 준비
> **mockups**:
> - 2번 하단 바 정중앙 시안: [`docs/mockups/2026-05-16-bulk-bar-center-position.html`](../../mockups/2026-05-16-bulk-bar-center-position.html)
> **선행**:
> - v1.14 (RecentActivityWidget · ActivityFeed groupActivities 도입)
> - v1.16 (씬 목록 통합 뷰 + 일괄 액션 바)
> - v1.25 (액팅 단계 토글 ScenePhaseState)
> - v1.22 (자동 업데이트 manifest · UpdateCenterModal · Sidebar 버전 칩)

---

## 1. 배경과 목표

### 6가지 UX 갈증 (한솔 보고, 2026-05-16)

1. **최근 작업 위젯 묶음 누락** — "담당자 배정" 처럼 한 번에 여러 씬을 건드리는 액션이 카드별로 흩어져 나옴. 한 줄 묶음으로 보고 싶다.
2. **카드 뷰 하단 일괄 액션 바 위치** — "정 가운데가 아니다." 사이드바 너비를 무시한 viewport 정중앙이라 작업 영역에서는 오른쪽으로 치우쳐 보인다.
3. **라쏘 선택 시 액팅 단계 구버전** — 액팅 영역에도 BG의 LO/완료/검수/PNG 4단계 버튼이 그대로 떠 있다. v1.25에서 도입한 wait/work/feedback/done 4 phase 가 반영 안 됨.
4. **상세 모달 댓글 패널 협소** — `w-80` (320px) 고정. 화면이 커도, 댓글이 많아도 협소.
5. **업데이트 직후 안내 부재** — manifest 다운로드 → installer 적용 → 다음 실행. 그런데 새 버전으로 처음 들어왔을 때 "업데이트 완료" 신호가 없다.
6. **사이드바 새 버전 점이 안 보임** — `h-2.5 w-2.5` 점이 사이드바 contour 안쪽에 가려져 잘 안 띈다.

### 공통 목표

- 6 항목 모두 **시각·인지** 영역의 작은 개선 — 데이터/서비스 레이어는 손대지 않는다.
- 각 변경은 가능한 한 **로컬화** — 같은 파일 안에서 끝나도록.
- **v1.26 (`mystifying-meninsky-9d3c74`) 워크트리** 와의 충돌은 4번에 한정. 본 spec 의 4번 명세를 그 워크트리 머지 시 reapply 한다.

---

## 2. 결정 사항 요약

| # | 항목 | 결정 |
|---|---|---|
| 1 | 묶음 범위 | `assignee_change` / `layout_change` / `image_upload_storyboard` / `image_upload_guide` 4종 액션만 scene_id 무관 묶음 (멀티-씬 액션 화이트리스트). 다른 액션은 기존 정책 유지 |
| 2 | 정중앙 정의 | 콘텐츠 영역 정중앙 — `left: calc(50vw + var(--sidebar-w)/2)` 보정. 사이드바 펼침·접힘에 동기화 |
| 3 | 통합 뷰 액팅 행 | BG 행은 STAGES 유지, ACT 행은 `SCENE_PHASES` (wait/work/feedback/done) **set** 동작. 색상은 `SCENE_PHASE_COLORS` 사용 — BG는 `DEPARTMENT_CONFIGS.bg.stageColors` 사용. 두 row 색상 출처가 다른 것은 의도적 (phase ≠ stage) |
| 4 | 댓글 패널 너비 | (a) `clamp(320px, 26vw, 480px)` 기본 + (b) 댓글 갯수 boost + (c) 사용자 드래그 리사이저. 세 가지 모두 조합. 드래그 값이 있으면 a/b 무시 |
| 5 | 업데이트 완료 안내 | Sonner 토스트 + "업데이트 내역 보기" 액션. 최초 설치(`lastSeenVersion` 미존재)는 토스트 생략 |
| 6 | 새 버전 배지 | 점 → 12px 원 + pulse glow 애니메이션 + 사이드바 우측 contour 밖으로 8px 돌출. `prefers-reduced-motion` 존중 |
| 공통 | v1.26 충돌 | 본 spec 의 4번을 v1.26 워크트리 머지 시 reapply (수동 reconcile 또는 별도 cherry-pick). 1·2·3·5·6 은 main 에 단독 머지 |

---

## 3. 항목별 디자인 명세

### 3-1. 최근 작업 위젯 — 멀티-씬 액션 묶음

#### 현황

[src/components/widgets/activity/utils.ts:42-80](../../../src/components/widgets/activity/utils.ts) `groupActivities` 의 `sameGroup` 검사:

```ts
const sameGroup = (a: Activity, b: Activity) => {
  if (a.userId !== b.userId) return false;
  if (a.actionType !== b.actionType) return false;
  if (a.episodeNumber !== b.episodeNumber) return false;
  if (a.sceneId !== b.sceneId) return false; // ← Codex P2 도입 (다른 씬 묶임 방지)
  const da = new Date(a.createdAt).getTime();
  const db = new Date(b.createdAt).getTime();
  return Math.abs(da - db) <= GROUP_WINDOW_MS;
};
```

"같은 씬 안에서만 묶기" 정책은 *단일-씬 액션*(stage 토글, 댓글, 리비전) 에는 옳다. 그러나 *멀티-씬 액션*(담당자 배정·레이아웃 변경·이미지 일괄 업로드) 에는 너무 엄격해서 한 번의 사용자 행위가 N 개 줄로 펼쳐진다.

#### 정책

```ts
const MULTI_SCENE_ACTIONS = new Set<ActionType>([
  'assignee_change',
  'layout_change',
  'image_upload_storyboard',
  'image_upload_guide',
]);

const sameGroup = (a, b) => {
  if (a.userId !== b.userId) return false;
  if (a.actionType !== b.actionType) return false;
  if (a.episodeNumber !== b.episodeNumber) return false;
  // 단일-씬 액션만 sceneId 일치 요구. 멀티-씬 액션은 episode 까지만 일치하면 묶음.
  if (!MULTI_SCENE_ACTIONS.has(a.actionType) && a.sceneId !== b.sceneId) return false;
  return Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) <= GROUP_WINDOW_MS;
};
```

#### 표기

`ActivityFeed.tsx` 의 그룹 헤더 라벨 — 묶음 안 액션이 `MULTI_SCENE_ACTIONS` 에 속하면:
- 단일 씬: 기존 `EP01 #03 — 담당자 변경`
- 묶음(N=4): `EP01 — 4개 씬 담당자 변경` (씬 번호 나열 X, 너무 길어짐)

`feedNavigation.ts` 의 점프 — 묶음 클릭 시 첫 번째 활동의 씬으로 이동(현재 정책 유지). 묶음 펼침 UI 는 도입하지 않음(스코프 외).

#### 테스트

`tests/activityFeedGrouping.test.ts` (신규):
- 같은 user + assignee_change + 다른 sceneId × 4 + 5분 이내 → 1 group (length=4)
- 같은 user + stage_done + 다른 sceneId × 2 → 2 items (변경 없음)
- 다른 user + assignee_change × 2 → 2 items (변경 없음)
- 5분 윈도우 초과 → 2 그룹

---

### 3-2. 카드 뷰 하단 일괄 액션 바 — 콘텐츠 영역 정중앙

#### 현황

[src/views/ScenesView.tsx:4399](../../../src/views/ScenesView.tsx):

```tsx
className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 ..."
```

`fixed` + viewport 정중앙. 사이드바(64 ↔ 132px) 가 viewport 안에 있어 시각적 작업 영역에서는 항상 우측으로 치우침. 사이드바 펼침 토글 시 더 심해짐.

#### 정책

사이드바 store 구독 + Framer Motion `animate` prop 으로 부드러운 보정:

```tsx
const sidebarExpanded = useAppStore((s) => s.sidebarExpanded);
const sidebarWidth = sidebarExpanded ? 132 : 64;
const leftPx = `calc(50vw + ${sidebarWidth / 2}px)`;

<motion.div
  className="fixed bottom-6 z-50 ..."
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0, left: leftPx }}
  exit={{ opacity: 0, y: 20 }}
  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
  style={{ transform: 'translateX(-50%)' }}
>
```

- 사이드바 펼침 토글 시 Motion `animate.left` 가 자동 보간. CSS `transition: left` 와 Motion transform 간 충돌 회피.
- 호버 expand (사용자가 collapsed 상태에서 hover) 는 제외 — store 의 `sidebarExpanded` 만 반영. 호버는 일시 표시일 뿐이라 바의 흔들림이 더 거슬림.

#### Mockup 검증

[`docs/mockups/2026-05-16-bulk-bar-center-position.html`](../../mockups/2026-05-16-bulk-bar-center-position.html) 의 옵션 A.

#### 테스트

수동 검증 (자동화 불요):
- ScenesView 카드 뷰 → 라쏘로 5개 선택 → 사이드바 펼침/접힘 토글 → 바가 콘텐츠 영역 가운데에서 부드럽게 이동.

---

### 3-3. 통합 뷰 라쏘 — 액팅 행 ScenePhases

#### 현황

[src/views/ScenesView.tsx:4418-4477](../../../src/views/ScenesView.tsx) 의 `selectedDepartment === 'all'` 분기에서 BG·ACT 두 줄 모두 `STAGES.map` 으로 LO/완료/검수/PNG 4 버튼을 표시. v1.25 부터 액팅은 wait/work/feedback/done 4 phase 로 바뀌었으나 일괄 액션 바만 옛 모양.

#### 정책

ACT 행을 `SCENE_PHASES` 4 phase 버튼으로 교체. 각 phase 의 의미는 **set**(토글이 아닌 직접 설정) — 여러 씬이 다른 phase 일 수 있으므로 토글은 의미가 모호.

색상 출처: `SCENE_PHASE_COLORS` 직접 사용. BG 행의 `DEPARTMENT_CONFIGS.bg.stageColors` 와 출처가 다른 것은 의도적 — phase 는 stage 와 별개 개념이고, 액팅 단계 토글 (ScenePhaseToggle 등 v1.25 컴포넌트) 도 동일 출처를 쓰고 있어 일관성 유지.

```tsx
// 신규 import (src/types/index.ts 에서 실제 export 된 심볼 그대로)
import { SCENE_PHASES, SCENE_PHASE_LABELS, SCENE_PHASE_COLORS } from '@/types';
import type { ScenePhaseState } from '@/types';

// ACT 행
<div className="flex items-center gap-1">
  <span className="w-1.5 h-1.5 rounded-full shrink-0"
    style={{ backgroundColor: DEPARTMENT_CONFIGS.acting.color }} />
  <span className="text-[11px] text-text-secondary ...">
    {DEPARTMENT_CONFIGS.acting.shortLabel}
  </span>
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
      {SCENE_PHASE_LABELS[phase]}
    </button>
  ))}
</div>
```

#### 핸들러

`handleBulkActPhaseSet(phase: ScenePhaseState)` 신규 — 선택된 ACT 씬 UUID 들에 대해 `bulkSetActPhase` IPC 호출. BG 씬은 무시 (mergedKey 기준 BG/ACT 양쪽 선택돼 있어도 ACT 쪽만 적용).

`src/stores/useBulkOperationsStore.ts` 에 `bulkSetActPhase(uuids, phase)` 추가:
- 기존 `stage-toggle` `delete` `field-edit` 와 같은 kind 로 `act-phase-set` 추가
- BulkOperationStatus 토스트 라벨에도 phase 표기 ("작업중", "피드백 대기" 등)

#### 피드백 대기로 일괄 전환 시

기존 단일-씬에서 `phase_feedback` 으로 전환 시 검수자 확인 모달이 떴다 (v1.25.7). 일괄에서는:
- **검수자 확인 모달 생략** (5개 씬을 한꺼번에 검수 요청하는 컨텍스트에서 모달은 과함)
- 다만 알림은 발송 — `phase_feedback` 으로 변경된 각 씬당 검수자 풀 전원에게 (기존 단일-씬 흐름과 동일)
- 한 번에 N 건이면 토스트로 "5개 씬을 피드백 대기로 설정. 검수자 3명에게 알림 발송." 표시

#### 테스트

`tests/bulkActPhaseSet.test.ts`:
- 선택 5개 (BG 2 + ACT 3) + phase='work' 호출 → ACT 3 개만 phase 변경, BG 2 개는 무변화
- phase='feedback' 호출 → ACT 3 개 모두 phase 변경 + 검수자 풀 멤버에게 씬별 알림 N건 발송 (페이로드 검증)

---

### 3-4. 상세 모달 댓글 패널 — 3중 반응형

#### 현황

- [SceneDetailModal.tsx:1078](../../../src/components/scenes/SceneDetailModal.tsx): `className="w-80 ..."` (320px 고정)
- [UnifiedSceneDetailModal.tsx:815](../../../src/components/scenes/UnifiedSceneDetailModal.tsx): 동일

모달 본체는 viewport 적응형(`w-[min(720px,calc(100vw-26rem))]`)인데 댓글 패널만 고정.

#### 정책

**3-레이어 우선순위**:

1. **사용자 드래그 값**(가장 강함) — `preferences.json.commentPanelWidthPx` 가 정수면 그 값 사용.
2. **댓글 갯수 boost** — 사용자 값 없을 때 댓글 수에 따라 자동 boost:
   - 0~5건: base
   - 6~15건: base + 40px
   - 16건+: base + 80px
3. **viewport clamp**(base 계산) — `clamp(320px, 26vw, 480px)`. boost 후 최대 600px 까지 허용.

```ts
// src/hooks/useCommentPanelWidth.ts (신규)
export function useCommentPanelWidth(commentCount: number): {
  width: number;
  setWidth: (px: number | null) => Promise<void>;
  isUserOverride: boolean;
} {
  const [savedWidth, setSavedWidth] = useState<number | null>(null);

  useEffect(() => {
    loadPreferences().then(p => {
      const w = p?.commentPanelWidthPx;
      if (typeof w === 'number' && w >= 280 && w <= 720) setSavedWidth(w);
    });
  }, []);

  const viewportW = useViewportWidth();

  const computed = useMemo(() => {
    if (savedWidth != null) return savedWidth;
    const base = Math.max(320, Math.min(480, viewportW * 0.26));
    const boost = commentCount > 15 ? 80 : commentCount > 5 ? 40 : 0;
    return Math.min(600, base + boost);
  }, [savedWidth, viewportW, commentCount]);

  const setWidth = useCallback(async (px: number | null) => {
    setSavedWidth(px);
    // loadPreferences() 반환 타입은 UserPreferences | null. App.tsx 의 read-merge-write
    // 패턴(`prefs ?? {}`) 을 그대로 따른다.
    const prefs = (await loadPreferences()) ?? {};
    await savePreferences({ ...prefs, commentPanelWidthPx: px ?? undefined });
  }, []);

  return { width: computed, setWidth, isUserOverride: savedWidth != null };
}
```

**중요한 호출 규칙**: `setWidth` 는 **드래그 종료(mouseup) 시 1회만** 호출한다. `mousemove` 동안은 로컬 state(`savedWidth`) 만 업데이트하거나, 별도의 `liveWidth` ref 로 화면만 갱신. 매 mousemove 마다 `savePreferences` 가 일어나면 디스크 I/O 폭주 + 다른 preference 필드와의 race 위험.

추천: 훅을 다음과 같이 분리한다.
- `setWidth(px)` — 디스크 영구 저장 (mouseup 에서만)
- `setLiveWidth(px)` — state 즉시 갱신 (mousemove 에서)

또는 컴포넌트 측에서 `useRef<number>` 로 드래그 중 너비를 추적하고, 종료 시점에 `setWidth` 1회.

#### 드래그 리사이저

댓글 패널 좌측 경계 4px 영역:

```tsx
<motion.div
  key="comment-panel"
  className="bg-bg-card rounded-2xl ... flex flex-col shrink-0 relative"
  style={{ width: panelWidth }}
>
  {/* 좌측 드래그 핸들 */}
  <div
    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 transition-colors"
    onMouseDown={handleResizeStart}
    onDoubleClick={() => setWidth(null)}
    title="드래그로 너비 조절 · 더블클릭으로 자동 모드 복귀"
  />
  ...
</motion.div>
```

드래그 동작:
- `mousedown` → `startX`, `startW` ref 캡처. `mousemove`/`mouseup` 을 `window` 에 등록. body 에 `cursor: col-resize`, `user-select: none` 적용
- `mousemove` 시 `newW = clamp(280, 720, startW - (e.clientX - startX))` (좌측 핸들이라 부호 반대). 화면 즉시 갱신용 ref/local state 만 업데이트 — **savePreferences 호출 X**
- 드래그 cap(720px) 가 자동 모드 cap(600px) 보다 큰 것은 의도적 — "자동 모드는 보수적, 사용자가 직접 잡으면 더 넓게 허용".
- `mouseup` → 글로벌 리스너 해제 + body 스타일 복귀 + `setWidth(newW)` **1회** 호출 (이게 disk 영구 저장)
- 더블클릭 → `setWidth(null)` → 자동 모드 복귀

**Cleanup (필수)** — 드래그 중 모달이 닫히거나 컴포넌트가 unmount 될 위험:
```tsx
useEffect(() => {
  return () => {
    // unmount 시 글로벌 리스너 강제 해제
    window.removeEventListener('mousemove', mousemoveHandlerRef.current!);
    window.removeEventListener('mouseup', mouseupHandlerRef.current!);
    // body 스타일 복귀
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
}, []);
```

리스너 핸들러는 `useRef` 로 보관해 stable identity 유지 (`addEventListener`/`removeEventListener` 짝 맞추기).

#### 시각적 affordance

- 핸들 영역 hover 시 `bg-accent/40` 가는 막대 (1px 폭으로 잔잔하게)
- 드래그 중에는 body 에 `cursor: col-resize` + 선택 비활성화 (`user-select: none`)
- 자동 모드일 때는 핸들 옆 작은 hint 아이콘 hover 시에만 표시 (UI 노이즈 최소화)

#### 테스트

`tests/useCommentPanelWidth.test.ts`:
- viewport=1440, commentCount=0 → base=max(320, min(480, 1440*0.26))=max(320, 374)=374px
- viewport=1024, commentCount=8 → base=max(320, min(480, 266))=max(320, 266)=320 + boost40 = **360px**
- viewport=1920, commentCount=20 → max(320, min(480, 499))=480 + boost80 = 560px
- savedWidth=500 → boost·viewport 무시, 500px
- viewport=320, commentCount=0 → 320px (clamp lower bound: max(320, min(480, 83))=320)

---

### 3-5. 업데이트 완료 안내 — 토스트 + 내역 보기

#### 현황

[electron/autoUpdate/checker.ts](../../../electron/autoUpdate/checker.ts) 와 [src/stores/useAppStore.ts](../../../src/stores/useAppStore.ts) 에 `updateInfo.status === 'ready'` 가 있고, installer helper 적용 후 다음 실행 시 새 버전으로 진입. 그러나 진입한 직후 사용자가 "업데이트가 됐다" 는 사실을 즉시 알 신호가 없다.

`preferences.json` 에 `lastSeenVersion` 같은 마커가 없어 "이전엔 어떤 버전이었는지" 알 길도 없다.

#### 정책

`preferences.json` 에 `lastSeenVersion: string` 추가:

1. **앱 첫 인터랙티브 화면 도달 직후** (Splash 닫힐 때 또는 App.tsx mount 직후):
   ```ts
   // semver 비교: a > b 이면 true. patch 까지 정수 비교.
   function semverGt(a: string, b: string): boolean {
     const pa = a.split('.').map(n => parseInt(n, 10) || 0);
     const pb = b.split('.').map(n => parseInt(n, 10) || 0);
     for (let i = 0; i < 3; i++) {
       if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
       if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
     }
     return false;
   }

   const prefs = (await loadPreferences()) ?? {};
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
   ```

2. **최초 설치**: `prev` 가 `undefined` 인 경우는 토스트 생략. "업데이트" 가 아니라 "신규 설치" 라서 의미가 다름. 단 `lastSeenVersion` 은 즉시 기록.

3. **버전 다운그레이드**: `prev > current` 도 토스트 생략 (개발 빌드/롤백 케이스). `semverGt(current, prev)` 가 false 이면 토스트 안 뜸.

4. **`UserPreferences` 인터페이스에 필드 추가** ([src/types/index.ts](../../../src/types/index.ts)):
   ```ts
   export interface UserPreferences {
     // ...기존 필드
     lastSeenVersion?: string;
     commentPanelWidthPx?: number;
   }
   ```

#### 토스트 톤

- 메시지: `v1.26.0 으로 업데이트되었어요` (사용자-친화)
- 액션 라벨: `업데이트 내역 보기` → UpdateCenterModal 자동 오픈
- 길이: 8초 (Sonner 기본 4초보다 길게 — 사용자가 액션 클릭할 시간 확보)
- 위치: 기존 toast 위치 동일 (보통 bottom-right)

#### 테스트

수동:
- localStorage / preferences.json 에 `lastSeenVersion=1.25.0` 강제 기록 → 앱 재시작 → 토스트 표시 확인
- "업데이트 내역 보기" 클릭 → UpdateCenterModal 열림 확인
- 토스트 dismiss 후 재시작 → 토스트 안 뜸 (`lastSeenVersion` 갱신됨)
- `lastSeenVersion` 키 자체 제거(=신규 설치 가정) → 토스트 안 뜸
- `lastSeenVersion=1.26.0`, 현재 빌드=1.25.0 (다운그레이드) → 토스트 안 뜸 (`semverGt` false)

---

### 3-6. 사이드바 새 버전 배지 — 외부 돌출 + pulse glow

#### 현황

[src/components/layout/Sidebar.tsx:240, 326](../../../src/components/layout/Sidebar.tsx):

```tsx
<aside className="... overflow-hidden z-40">  // ← overflow-hidden 이 외부 돌출 차단
  ...
  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#FDCB6E] ..." />
```

- 점 10px → 작음
- `-right-1 -top-1` 사이드바 contour 안쪽
- `overflow-hidden` 으로 외부 돌출도 불가

#### 정책

1. **하단 토글+버전 컨테이너만 `overflow-visible` 적용** (옵션 A 확정)
   - `aside` 자체는 `overflow-hidden` 유지 — 네비 라벨이 호버 확장 시 깔끔하게 잘리는 기존 동작 보호.
   - v 버튼이 속한 하단 `flex flex-col` 컨테이너(Sidebar.tsx:290 근처 `mt-auto ...`)에만 `overflow-visible` 추가. v 버튼 위 영역(네비)은 영향 없음.
   - 옵션 B(aside 자체 overflow 풀고 inner nav 에만 hidden 추가)는 변경 범위가 커서 제외.

2. **배지 키우기 + 외부 돌출**:
   ```tsx
   <span
     aria-hidden="true"
     className="badge-pulse absolute h-3 w-3 rounded-full bg-[#FDCB6E]"
     style={{
       right: '-8px',  // 사이드바 contour 밖으로 절반 돌출
       top: '-4px',
       boxShadow: '0 0 0 0 rgba(253, 203, 110, 0.6)',
       animation: 'badgePulse 2s ease-in-out infinite',
     }}
   />
   ```

3. **Pulse glow 키프레임** (Tailwind 기본에 없으니 globals.css 추가):
   ```css
   @keyframes badgePulse {
     0%, 100% {
       box-shadow: 0 0 0 0 rgba(253, 203, 110, 0.6),
                   0 0 8px 2px rgba(253, 203, 110, 0.35);
     }
     50% {
       box-shadow: 0 0 0 6px rgba(253, 203, 110, 0),
                   0 0 12px 4px rgba(253, 203, 110, 0.5);
     }
   }
   @media (prefers-reduced-motion: reduce) {
     .badge-pulse { animation: none !important; box-shadow: 0 0 8px 2px rgba(253, 203, 110, 0.4); }
   }
   ```

4. **접근성**:
   - `aria-hidden="true"` (장식 요소) — 실제 정보는 v 버튼 `aria-label` 이 이미 전달 ("새 버전 v1.26.0 준비됨 · 업데이트 내역 열기")
   - `prefers-reduced-motion: reduce` 시 애니메이션 정지 + 정적 glow 유지

#### Edge case

- `hasUpdateIssue`(failed/suppressed) 상태일 때는 배지를 점이 아니라 작은 ⚠ 아이콘 또는 다른 색 (`#FF7675`)으로 — 본 spec 스코프 외 (기존 v 버튼 색 처리로 이미 구분되고 있음)

#### 테스트

수동:
- updateInfo 강제 주입 → `hasRemoteUpdate=true` 상태에서 배지가 사이드바 우측 contour 밖으로 절반 돌출되어 보이는지
- pulse 애니메이션 2초 주기로 부드럽게 도는지
- Windows 설정 "애니메이션 효과 켜기" 끄면 정적 glow 만 남는지 (prefers-reduced-motion)

---

## 4. v1.26 (mystifying-meninsky-9d3c74) 워크트리 충돌 처리

### 4-1. 영향 평가

| # | 손볼 파일 | v1.26 변경 여부 | 충돌 위험 |
|---|---|---|---|
| 1 | `widgets/activity/utils.ts` + `ActivityFeed.tsx` | ❌ | 없음 |
| 2 | `views/ScenesView.tsx` (~4399) | ❌ | 없음 |
| 3 | `views/ScenesView.tsx` (~4441) + `useBulkOperationsStore.ts` | ❌ | 없음 |
| 4 | `scenes/SceneDetailModal.tsx` + `UnifiedSceneDetailModal.tsx` + 신규 `hooks/useCommentPanelWidth.ts` | **✅ 대규모 변경 중** (댓글 이모지·이미지 우클릭·드로잉 주석) | **HIGH** |
| 5 | `useAppStore.ts` + `App.tsx` + 신규 `lastSeenVersion` | ❌ | 없음 |
| 6 | `layout/Sidebar.tsx` + `globals.css` | ❌ | 없음 |

### 4-2. v1.26 머지 시 reapply 가이드 (4번에 한정)

본 spec 4번이 main 에 머지된 후 v1.26 워크트리도 main 에 머지될 때:

**a. SceneDetailModal.tsx**
- v1.26 의 댓글 이모지 리액션 추가는 CommentPanel 내부 구조 변경. 외곽 `<motion.div key="comment-panel">` 의 `style={{ width: panelWidth }}` 와 좌측 드래그 핸들은 그대로 유지 가능.
- conflict 발생 영역: `className="w-80 ..."` 라인. v1.26 측이 이미 width 를 동적으로 만들었다면 본 spec 의 `useCommentPanelWidth` 를 그 자리로 옮긴다.

**b. UnifiedSceneDetailModal.tsx**
- 같은 정책. `w-80` → `style={{ width: panelWidth }}` 로 대체.

**c. 충돌이 큰 경우의 우회 경로**
- v1.26 워크트리 안에서 본 spec 4번을 작은 cherry-pick 으로 다시 적용 (별도 PR).
- 또는 본 spec 4번을 v1.26 머지 직전까지 *보류* 했다가, v1.26 머지 후 main 에서 작업.

---

## 5. 빌드 순서

본 spec 의 6 항목은 서로 독립적이므로 어느 순서로든 가능. 추천:

1. **1번** (utils.ts 단일 함수 + 라벨 한 줄) — 가장 작고 즉시 보이는 효과
2. **2번** (ScenesView className 5줄)
3. **6번** (Sidebar + css keyframes 15줄)
4. **5번** (lastSeenVersion preferences + App.tsx 토스트)
5. **3번** (bulkActPhaseSet 신규 + ScenesView ACT 행 교체)
6. **4번** (useCommentPanelWidth 훅 + 양쪽 모달 + CSS) — v1.26 충돌 고려해 가장 마지막

각 항목 단위로 commit, 6개 한 PR (v1.26.x or v1.27.0 polish 묶음).

---

## 6. 테스트 계획

### 6-1. 단위/자동 테스트

| 파일 | 검증 |
|---|---|
| `tests/activityFeedGrouping.test.ts` | 멀티-씬 액션 묶음 동작 + 단일-씬 액션 묶임 방지 (기존 동작 유지) |
| `tests/bulkActPhaseSet.test.ts` | BG/ACT 혼합 선택에서 ACT 만 phase 변경 + phase=feedback 시 알림 발송 페이로드 |
| `tests/useCommentPanelWidth.test.ts` | viewport × commentCount × savedWidth 매트릭스 |

### 6-2. 수동 검증

- 1번: ScenesView 에서 5개 씬 선택 → 일괄 담당자 변경 → RecentActivityWidget 에 1줄 묶음 표시 확인
- 2번: 카드 뷰 5개 선택 → 사이드바 펼침/접힘 토글 → 바가 콘텐츠 영역 중앙에서 부드럽게 이동
- 3번: 통합 뷰에서 ACT 씬 3개 선택 → 하단 바 ACT 행에 "대기 / 작업중 / 피드백 대기 / 완료" 4 버튼 확인 → "작업중" 클릭 → 3개 씬 모두 작업중 1차로 set
- 4번: 댓글이 1개일 때 / 8개일 때 / 20개일 때 패널 너비 자동 boost 확인 → 좌측 핸들 드래그 → 너비 저장 → 재진입 시 유지 → 더블클릭 → 자동 모드 복귀
- 5번: preferences 강제로 lastSeenVersion=1.25.0 → 앱 재시작 → 토스트 + 내역 보기 액션 → 클릭 시 UpdateCenterModal 오픈
- 6번: 새 버전 강제 주입 → 사이드바 v 버튼 우상단 원이 사이드바 contour 밖으로 절반 돌출 + pulse glow

---

### 6-3. 멀티-씬 액션 화이트리스트의 완전성

`ActionType` 정의([src/types/index.ts:444-454](../../../src/types/index.ts)) 전수 검토 결과, 멀티-씬 성격을 띠는 액션은 4종(`assignee_change`, `layout_change`, `image_upload_storyboard`, `image_upload_guide`)이 전부. 길이 변경(LD/SD)은 `ActionType` 에 등록돼 있지 않아 activity 로그 묶음 문제에 무관 — 별도 처리 불필요. 향후 새 멀티-씬 액션이 추가되면 `MULTI_SCENE_ACTIONS` set 에 함께 추가하는 것을 기억해 둘 것.

---

## 7. Out of Scope

본 패치에서 의도적으로 *하지 않는* 것:

- 묶음 펼침 UI (Recent Activity 의 묶음을 클릭해 N 건 상세 펼치기) — 별도 패치
- 일괄 액션 바를 BG/ACT 혼합 1줄로 다시 합치기 — 현재 2줄 구조 유지
- 댓글 패널 위치 자체 변경 (좌측 도킹 등) — 현재 모달 우측 슬라이드 구조 유지
- 자동 업데이트 다운로드 흐름 변경 — manifest/installer helper 정책은 무손상
- v1.26 본체 기능(이모지·이미지 버전·드로잉 주석) 에 대한 polish — v1.26 워크트리에서 별도

---

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| 1번 묶음 정책이 다른 액션에도 영향 줄까 | 화이트리스트 4종만 정확히 명시 + 단위 테스트로 회귀 방지 |
| 2번 호버 expand 와 클릭 expand 의 동기화 누락 | store 의 `sidebarExpanded`만 구독 — 호버 상태는 의도적으로 무시 (흔들림 방지) |
| 3번 phase set 일괄에서 알림 N건 폭주 | 검수자 풀이 작아 보통 3~5명 × N건. 한 번에 토스트 1건으로 요약 표시 |
| 4번 드래그 리사이저가 다른 UI(이미지 모달 등) 와 충돌 | 핸들 영역 4px 만 사용 + `data-no-lasso` 같은 가드 마커 활용 |
| 5번 lastSeenVersion 누락 시 영원히 토스트 안 뜸 | 토스트 표시 전이 아니라 표시 후 즉시 저장. 누락은 single-shot 한계 — 다음 업데이트 시 자동 회복 |
| 6번 `overflow-hidden` 풀면 다른 영역 깨질까 | v 버튼 컨테이너에만 visible 적용. 사이드바 본체는 hidden 유지 |

---

*spec 버전: 2026-05-16 v1*
*작성: Claude × 한솔 (Studio JBBJ)*
