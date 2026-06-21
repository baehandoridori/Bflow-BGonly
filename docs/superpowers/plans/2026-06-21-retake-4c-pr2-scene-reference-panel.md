# 리테이크 4c PR2 — 씬 참조 패널(좌/우 도킹) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 상세 모달 안에서 #씬 칩을 좌클릭하면 보던 모달의 좌/우에 그 씬의 상세를 도킹 패널(편집 가능)로 띄우고, 컴포지팅 씬 메모의 직렬화 토큰 노출을 함께 정리한다.

**Architecture:** 기존 `UnifiedSceneDetailModal`을 `dockMode` prop으로 재사용(backdrop만 분기)해 메인 모달 옆 flex wrapper에 두 번째 인스턴스로 렌더. 참조 상태는 ScenesView 로컬. #씬 칩의 `onHashClick`을 모달 안에서만 "참조 열기"로 분기(모달 밖은 기존 navigate). 참조 씬은 기존 순수 헬퍼 `buildMergedScenes`로 빌드.

**Tech Stack:** React 18 + TS, Zustand, framer-motion, Tailwind 토큰, node:test.

**스펙:** `docs/superpowers/specs/2026-06-21-retake-4c-pr2-scene-reference-panel-design.md`

**작업 워크트리:** `C:\Bflow-BGonly\.claude\worktrees\retake-4c-pr2` (브랜치 `claude/retake-4c-pr2`, main=v1.42.0 기준)

> **구현 전 필수:** 각 Task 시작 전 `Grep`/`Read`로 대상 심볼·라인을 재확인(라인 번호는 작성 시점 기준). 검증은 매 청크 끝에서 `npm run typecheck` + 관련 `node --test` + `npm run build:vite`. preview 불가 UI는 typecheck/build로 갈음하고 한솔 실사용 확인.

---

## File Structure

**신규:**
- `src/utils/sceneReference.ts` — `resolveReferenceMergedScene(target, episodes)` 순수 헬퍼(#씬 타깃 → MergedScene, cross-part 폴백). `buildMergedScenes` 재사용.
- `tests/sceneReference.test.ts` — 위 헬퍼 node:test.
- `src/components/scenes/ReferenceScenePanel.tsx` — (얇은) 참조 패널 래퍼: 헤더(좌/우 토글·메인으로·닫기) + dock 모드 `UnifiedSceneDetailModal`. (※ 구현 중 `UnifiedSceneDetailModal` 자체 헤더 재사용이 깔끔하면 이 파일 없이 dockMode 분기로 흡수 가능 — Task 4에서 결정.)

**수정:**
- `src/views/compositing/NewRevisionModal.tsx` — `scene.memo` raw 2곳 `stripEntityTokens`.
- `src/views/compositing-dashboard/cards/SceneCard.tsx` — `memo` raw(본문+title) `stripEntityTokens`.
- `src/components/scenes/UnifiedSceneDetailModal.tsx` — `dockMode` prop(backdrop/전역키 분기) + `onSceneReference` prop을 内 EntityText·자식에 전달.
- `src/views/ScenesView.tsx` — 참조 state(`referenceMerged`/`referenceSide`) + flex wrapper 참조 렌더 + 반응형 폭 + `onSceneReference` 콜백 + 참조용 재바인딩 콜백(onDeleteBoth/onAddDept).
- `src/components/scenes/CommentPanelResizable.tsx` — `onSceneReference?` prop 신설(통과).
- `src/components/scenes/CommentPanel.tsx` — 하드코딩 `navigateToHashTarget` → `onHashClick` prop화(없으면 navigate 폴백).
- `src/components/scenes/RevisionPanel.tsx` — `RevisionCommentThread`에 `onHashClick`(=onSceneReference 래퍼) 전달 + 자신의 EntityText도.
- `src/components/scenes/RevisionCommentThread.tsx` — (이미 `onHashClick` prop 보유) 배선만 확인.

---

## Chunk 1: 컴포지팅 씬 메모 stripEntityTokens 정리 (작고 독립)

> 가장 작고 위험 낮음. 먼저 끝내 빠른 안전 이득. 헬퍼 `stripEntityTokens`는 `src/utils/entityTokens.ts`에 이미 존재.

### Task 1: NewRevisionModal 씬 메모 평문 환원

**Files:**
- Modify: `src/views/compositing/NewRevisionModal.tsx:470, :543`

- [ ] **Step 1: import 추가** — 파일 상단 import 블록에 `import { stripEntityTokens } from '@/utils/entityTokens';` (이미 있으면 생략).
- [ ] **Step 2: :470 수정** — `{selectedScene.memo || '메모 없음'}` → `{selectedScene.memo ? stripEntityTokens(selectedScene.memo) : '메모 없음'}`.
- [ ] **Step 3: :543 수정** — `{scene.memo || '—'}` → `{scene.memo ? stripEntityTokens(scene.memo) : '—'}`.
- [ ] **Step 4: typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 5: 커밋** — `git add src/views/compositing/NewRevisionModal.tsx && git commit -m "리테이크 4c PR2: 컴포지팅 리테이크 씬 선택창 메모 평문 환원"`

### Task 2: SceneCard 씬 메모 평문 환원 (본문 + title)

**Files:**
- Modify: `src/views/compositing-dashboard/cards/SceneCard.tsx:268, :295, :298`

- [ ] **Step 1: import 추가** — `import { stripEntityTokens } from '@/utils/entityTokens';`
- [ ] **Step 2: :268 수정** — `const memo = card.bg?.memo || card.act?.memo;` 다음 줄에 `const memoText = memo ? stripEntityTokens(memo) : memo;` 추가. (조건 `{memo && …}`는 원본 memo로 유지 — 빈값 판정.)
- [ ] **Step 3: :295/:298 수정** — `title={memo}` → `title={memoText}`, `<span className="truncate">{memo}</span>` → `{memoText}`.
- [ ] **Step 4: typecheck** — PASS.
- [ ] **Step 5: 커밋** — `리테이크 4c PR2: 컴포지팅 대시보드 씬 카드 메모 평문 환원`

> **검증(청크 끝):** `npm run build:vite` PASS. (컴포지팅 씬에 #태그 메모 넣고 카드/리테이크 선택창에서 `#a001`로 보이는지 한솔 실사용 — 배포 후.)

---

## Chunk 2: UnifiedSceneDetailModal `dockMode` prop

> backdrop(센터 오버레이)만 분기하고 본체는 그대로. 콘텐츠 모놀리식이라 추출 대신 prop 분기(저위험).

### Task 3: `dockMode` prop 추가 + backdrop/전역키 분기

**Files:**
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx` (Props `:90`, backdrop `:631`, 전역 key useEffect들, flex wrapper `:645`)

- [ ] **Step 1: Props 확장** — `UnifiedSceneDetailModalProps`에 추가:
  ```ts
  /** 'modal'(기본): 풀스크린 backdrop+센터. 'left'/'right': backdrop 없이 본체만(부모가 위치). 참조 도킹용. */
  dockMode?: 'modal' | 'left' | 'right';
  ```
  구조분해에 `dockMode = 'modal'` 기본값 추가.
- [ ] **Step 2: backdrop 분기** — `:631`의 backdrop `motion.div`(`fixed inset-0 …`)를 `dockMode === 'modal'`일 때만 렌더. dock 모드면 backdrop 없이 본체 `motion.div`(`:650`)를 최상위로. (AnimatePresence는 유지; dock일 때 `initial/animate`의 x 방향을 left=−, right=+로.)
    - 구현 형태: 본체를 `const body = (<motion.div …본체…>…</motion.div>)`로 묶고, `return dockMode === 'modal' ? (<AnimatePresence>{backdrop+flexwrapper}</AnimatePresence>) : body;` 식. 단 flex wrapper(`:645`)/CommentPanelResizable은 메인 모달 전용 — dock 인스턴스는 본체만(댓글 패널 dock 안에 또 넣지 않음; Task 4에서 dock 본체 폭/댓글 처리).
- [ ] **Step 3: 전역 키 게이트** — ESC 닫기·prev/next 화살표·paste 등 `window`/`document` 리스너 useEffect들에 `if (dockMode !== 'modal') return;` 가드 추가(참조 패널이 전역 단축키를 가로채지 않게). 닫기는 헤더 X(콜백)로만.
- [ ] **Step 4: typecheck** — PASS. (기존 모달은 `dockMode` 미지정=‘modal’이라 무회귀.)
- [ ] **Step 5: 커밋** — `리테이크 4c PR2: UnifiedSceneDetailModal dockMode prop(backdrop·전역키 분기)`

> **주의:** 이 단계까지는 dock 모드를 아무도 호출하지 않으므로 동작 변화 0(무회귀 확인용). 실제 렌더는 Chunk 4.

---

## Chunk 3: 참조 MergedScene 해석 헬퍼 (TDD)

### Task 4: `resolveReferenceMergedScene` 순수 헬퍼

**Files:**
- Create: `src/utils/sceneReference.ts`
- Create: `tests/sceneReference.test.ts`
- 참조: `src/utils/mergedSceneHelpers.ts:260`(`buildMergedScenes`), `src/utils/cutScene.ts`(`resolveSceneById`), `src/utils/hashEntity.ts`(`HashTarget`)

- [ ] **Step 1: 구현/시그니처 사전 확인** — `Read` `mergedSceneHelpers.ts`의 `buildMergedScenes` 정확한 시그니처(인자: 단일 파트 BG scenes[], ACT scenes[], partId 등 — 실제 확인)와 `MergedScene` 타입. `resolveSceneById` 시그니처 확인.
- [ ] **Step 2: 실패 테스트** — `tests/sceneReference.test.ts`:
  ```ts
  import test from 'node:test';
  import assert from 'node:assert/strict';
  import { resolveReferenceMergedScene } from '../src/utils/sceneReference.ts';

  // EPISODES fixture: ep1 A파트에 BG a001 / ACT a001(같은 sceneId, 다른 row)
  const EPISODES = [{ episodeNumber: 1, title: 'EP.01', parts: [
    { partId: 'A', department: 'bg', scenes: [{ sceneId: 'a001', no: '1', memo: 'bg메모' }] },
    { partId: 'A', department: 'acting', scenes: [{ sceneId: 'a001', no: '1', memo: 'act메모' }] },
  ]}];

  test('scene 타깃 → 통합 MergedScene(같은 sceneId BG+ACT 병합)', () => {
    const m = resolveReferenceMergedScene(
      { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' }, EPISODES as any);
    assert.ok(m);
    assert.equal(m!.sceneId, 'a001');
    // bg/act 양쪽이 채워졌는지(통합)
    assert.ok(m!.bgScene || m!.actScene);
  });
  test('없는 씬 → null', () => {
    assert.equal(resolveReferenceMergedScene(
      { kind: 'scene', episodeNumber: 9, partId: 'Z', sceneId: 'zzz' }, EPISODES as any), null);
  });
  ```
  > fixture의 정확한 episode/part/scene 구조는 Step1에서 확인한 실제 타입에 맞춰 조정.
- [ ] **Step 3: 실패 확인** — `node --test ./tests/sceneReference.test.ts` → FAIL(헬퍼 없음).
- [ ] **Step 4: 구현** — `src/utils/sceneReference.ts`:
  ```ts
  // #씬 타깃(ep,part,sceneId) → 도킹 참조용 단일 MergedScene. cross-part/ep 포함, 활성 episodes 전수.
  // buildMergedScenes(단일 파트 BG/ACT 배열)를 재사용 — 신규 merge 로직 없음.
  import { buildMergedScenes } from './mergedSceneHelpers.ts';
  import type { HashTarget } from './hashEntity.ts';

  export function resolveReferenceMergedScene(target: HashTarget, episodes: readonly any[]) {
    if (target.kind !== 'scene') return null;
    const ep = episodes.find((e) => e.episodeNumber === target.episodeNumber);
    if (!ep) return null;
    // 같은 partId 의 BG·ACT 파트 row 를 모아 buildMergedScenes 로 통합.
    const partRows = ep.parts.filter((p: any) => p.partId === target.partId);
    if (partRows.length === 0) return null;
    const bgScenes = partRows.find((p: any) => p.department === 'bg')?.scenes ?? [];
    const actScenes = partRows.find((p: any) => p.department === 'acting')?.scenes ?? [];
    const merged = buildMergedScenes(/* 실제 시그니처에 맞춰 */ bgScenes, actScenes, target.partId, ep);
    return merged.find((m: any) => m.sceneId === target.sceneId) ?? null;
  }
  ```
  > **`buildMergedScenes` 실제 시그니처에 맞춰 인자 정정**(Step1 확인). sheetName/bgSceneIndex/actSceneIndex가 채워지는지 반환값에서 확인(§8.1 편집 정합).
- [ ] **Step 5: 통과 확인** — `node --test ./tests/sceneReference.test.ts` → PASS.
- [ ] **Step 6: package.json test:entity 에 편입** — `test:entity` 스크립트에 `./tests/sceneReference.test.ts` 추가.
- [ ] **Step 7: 커밋** — `리테이크 4c PR2: 참조 씬 MergedScene 해석 헬퍼(buildMergedScenes 재사용)`

---

## Chunk 4: ScenesView 참조 state + flex wrapper 렌더 + 반응형

### Task 5: 참조 state + openReference/close/toggle/promote

**Files:**
- Modify: `src/views/ScenesView.tsx`(모달 렌더 `:6408`, useUnifiedScenes `:3226`)

- [ ] **Step 1: state 추가** — ScenesView 함수 본문에:
  ```ts
  const [referenceMerged, setReferenceMerged] = useState<MergedScene | null>(null);
  const [referenceSide, setReferenceSide] = useState<'left' | 'right'>('right');
  ```
- [ ] **Step 2: openReference 콜백** —
  ```ts
  const openReference = useCallback((target: HashTarget, side: 'left' | 'right') => {
    const m = resolveReferenceMergedScene(target, useDataStore.getState().episodes);
    if (!m) { useAppStore.getState().setToast(`${target.sceneId} 씬을 찾을 수 없습니다.`); return; }
    setReferenceMerged(m); setReferenceSide(side);
  }, []);
  ```
  (import `resolveReferenceMergedScene`, `HashTarget`.)
- [ ] **Step 3: 모달 닫힐 때 참조도 클리어** — `detailMerged`가 null 되는 onClose 경로(`:3389` 부근 onClose 핸들러)에 `setReferenceMerged(null)` 추가. (모달 닫히면 참조 자동 제거.)
- [ ] **Step 4: 메인 모달에 onSceneReference 전달** — `:6413` `<UnifiedSceneDetailModal>`에 `onSceneReference={openReference}` 추가.
- [ ] **Step 5: typecheck** — PASS(아직 참조 패널 미렌더라 동작 변화 없음).
- [ ] **Step 6: 커밋** — `리테이크 4c PR2: ScenesView 참조 state + openReference`

### Task 6: flex wrapper에 참조 패널 렌더 + 반응형 폭

> 메인 모달의 flex wrapper(`UnifiedSceneDetailModal.tsx:645`)는 모달 내부라 ScenesView에서 직접 못 넣는다. **참조 패널은 메인 모달과 형제로 같은 backdrop 위**에 두되, 시각적으로 메인 본체 옆에 붙도록 배치한다. 두 방법 중 택1(Task에서 실제 확인):
> - (A) 메인 `UnifiedSceneDetailModal`이 `referencePanel?: React.ReactNode` slot prop을 받아 자신의 flex wrapper(`:645`) 안 본체 좌/우에 렌더. ← **권장**(겹침·z·backdrop 일관).
> - (B) ScenesView가 별도 오버레이로 참조를 띄움. ← backdrop/닫기 일관성 깨질 위험, 비권장.

**Files:**
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`(flex wrapper `:645`), `src/views/ScenesView.tsx`(`:6413`)

- [ ] **Step 1: slot prop** — `UnifiedSceneDetailModalProps`에 `referencePanel?: React.ReactNode`, `referenceSide?: 'left'|'right'` 추가. flex wrapper(`:645`) 안에서 `referenceSide==='left'`면 본체 앞, `'right'`면 CommentPanelResizable 뒤(가장 바깥)에 `{referencePanel}` 렌더.
- [ ] **Step 2: 반응형 폭** — 참조 패널 존재 시 본체 `w-[min(720px,…)]`를 `flex-shrink` 허용 + 참조 패널 고정폭 `w-[min(560px,40vw)]`. 화면 폭 임계(예 `< 1500px`) 미만이면 CommentPanelResizable 자동 접기(또는 참조를 본체 위 오버레이) — `window.innerWidth` 기준 또는 Tailwind 반응형. (구현 시 실제 폭 토큰 확인.)
- [ ] **Step 3: ScenesView에서 참조 패널 구성** — `referenceMerged && (`
  ```tsx
  <UnifiedSceneDetailModal
    merged={referenceMerged}
    dockMode={referenceSide}
    onClose={() => setReferenceMerged(null)}
    onSceneReference={openReference}   // 중첩 #씬 → 참조 교체
    {...참조용_편집콜백}                  // Task 7
    /* prev/next 비활성: hasPrev/hasNext={false} */
  />`
  `)` 를 메인 모달의 `referencePanel` prop으로 전달 + `referenceSide={referenceSide}`.
  > 참조 헤더의 좌/우 토글·메인으로·닫기 버튼은 dock 모드 헤더에 추가(Task 8). 우선 Step에서는 dockMode 본체가 보이게만.
- [ ] **Step 4: typecheck + build:vite** — PASS. 본체+참조 동시 렌더 시 레이아웃 깨짐 없는지(빌드 통과 + 한솔 확인 예정).
- [ ] **Step 5: 커밋** — `리테이크 4c PR2: 참조 패널 도킹 렌더 + 반응형 폭`

### Task 7: 참조용 편집 콜백 재바인딩

> §8.1: `onToggle`/`onFieldUpdate`/`onDeleteDept`는 sheet-keyed라 그대로 재사용 가능. `onDeleteBoth`/`onAddDept`는 메인 파트 바인딩이라 **참조 씬 파트 기준 재바인딩** 필요.

**Files:**
- Modify: `src/views/ScenesView.tsx`(`onDeleteBoth :6431`, `onAddDept :6452` 참고)

- [ ] **Step 1: 재바인딩 콜백 작성** — 참조용 `onDeleteBoth`/`onAddDept`를 `referenceMerged`의 part/sheetName 기준으로 구성(메인의 `bgPart`/`actPart`/`mergedScenePartId` 대신 참조 씬 컨텍스트 사용). 나머지(`onToggle`/`onFieldUpdate`/`onDeleteDept`)는 메인과 동일 핸들러 재사용.
- [ ] **Step 2: 참조 인스턴스에 전달** — Task 6 Step3의 `{...참조용_편집콜백}` 채움.
- [ ] **Step 3: typecheck** — PASS.
- [ ] **Step 4: 커밋** — `리테이크 4c PR2: 참조 패널 편집 콜백(참조 파트 기준 재바인딩)`

---

## Chunk 5: onSceneReference 4갈래 배선

> §4.C: 모달 안 표시처의 #씬 칩만 참조 열기로. part/episode·모달 밖은 기존 navigate.

### Task 8: 本體 메모 + dock 헤더 컨트롤

**Files:**
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`(EntityText 메모 `:1432`, dock 헤더)

- [ ] **Step 1: onHashClick 래퍼** — 모달 내부에서 EntityText에 넘기는 `onHashClick`을:
  ```ts
  const handleHash = (t: HashTarget) =>
    (t.kind === 'scene' && onSceneReference) ? onSceneReference(t, referenceSide ?? 'right') : navigateToHashTarget(t);
  ```
  `:1432` `onHashClick={navigateToHashTarget}` → `onHashClick={handleHash}`.
- [ ] **Step 2: dock 헤더 컨트롤** — `dockMode !== 'modal'`일 때 헤더에 [좌][우] 토글·[메인으로]·[✕] 추가. 콜백은 props로(`onToggleSide?`, `onPromote?`, `onClose`). (ScenesView가 setReferenceSide/promote 연결.)
- [ ] **Step 3: typecheck + 커밋** — `리테이크 4c PR2: 모달 메모 #씬 → 참조 분기 + dock 헤더`

### Task 9: 씬 댓글 브랜치 (CommentPanelResizable → CommentPanel)

**Files:**
- Modify: `src/components/scenes/CommentPanelResizable.tsx`(prop 통과), `src/components/scenes/CommentPanel.tsx`(`navigateToHashTarget` 하드코딩 `:1297`, renderText `:1558`/`:1729`)

- [ ] **Step 1: CommentPanel onHashClick prop화** — `CommentPanel` Props에 `onHashClick?: (t: HashTarget) => void` 추가. `renderText`(`:1558`/`:1729`)에서 EntityText `onHashClick`을 `onHashClick ?? navigateToHashTarget`로(미지정 시 기존 동작 유지 — 무회귀).
- [ ] **Step 2: CommentPanelResizable 통과** — `CommentPanelResizable` Props에 `onHashClick?` 추가, 내부 `CommentPanel`에 전달.
- [ ] **Step 3: UnifiedSceneDetailModal 배선** — `:992` `<CommentPanelResizable …>`에 `onHashClick={handleHash}` 전달.
- [ ] **Step 4: typecheck + build:vite** — PASS.
- [ ] **Step 5: 커밋** — `리테이크 4c PR2: 씬 댓글 #씬 → 참조 분기(CommentPanelResizable·CommentPanel)`

### Task 10: 리테이크 댓글 브랜치 (RevisionPanel → RevisionCommentThread) + RevisionPanel 본문

**Files:**
- Modify: `src/components/scenes/RevisionPanel.tsx`(EntityText `:277`/`:357`, RevisionCommentThread 렌더 `:484`), `src/components/scenes/RevisionCommentThread.tsx`(`onHashClick` prop `:640`, 배선 확인)

- [ ] **Step 1: RevisionPanel onHashClick 수신** — `RevisionPanel`이 `onHashClick?: (t: HashTarget) => void` prop을 받도록(UnifiedSceneDetailModal `:925`에서 `handleHash` 전달). 자체 EntityText(`:277`/`:357`)와 `RevisionCommentThread`(`:484`)에 전달.
- [ ] **Step 2: RevisionCommentThread 확인** — `onHashClick`(`:640`)이 내부 EntityText에 실제로 연결돼 있는지 확인(현재 prop만 있고 미사용일 수 있음 → 연결).
- [ ] **Step 3: UnifiedSceneDetailModal → RevisionPanel 배선** — `:925` `<RevisionPanel …>`에 `onHashClick={handleHash}`.
- [ ] **Step 4: typecheck + build:vite** — PASS.
- [ ] **Step 5: 커밋** — `리테이크 4c PR2: 리테이크 댓글/본문 #씬 → 참조 분기(RevisionPanel·RevisionCommentThread)`

---

## Chunk 6: 좌/우 토글 + "메인으로" 승격

### Task 11: 토글·승격 동작 연결

**Files:**
- Modify: `src/views/ScenesView.tsx`, `src/components/scenes/UnifiedSceneDetailModal.tsx`(dock 헤더 콜백)

- [ ] **Step 1: 토글** — dock 헤더 [좌]/[우] → ScenesView `setReferenceSide`. (참조 패널 위치 즉시 반영.)
- [ ] **Step 2: 메인으로** — dock 헤더 [메인으로] → ScenesView `promoteReferenceToMain`:
  ```ts
  const promoteReferenceToMain = useCallback(() => {
    if (!referenceMerged) return;
    setDetailMerged(referenceMerged);   // 참조 씬을 메인으로
    setReferenceMerged(null);
  }, [referenceMerged, setDetailMerged]);
  ```
- [ ] **Step 3: typecheck + build:vite** — PASS.
- [ ] **Step 4: 커밋** — `리테이크 4c PR2: 참조 좌/우 토글 + 메인으로 승격`

---

## Chunk 7: 통합 검증 + 정리

### Task 12: 전체 검증

- [ ] **Step 1: 전체 빌드 검증** — `npm run typecheck` + `npm run test:auto-update` + `npm run test:entity`(sceneReference 포함) + `npm run build:vite` 전부 PASS.
- [ ] **Step 2: 무회귀 grep** — 모달 밖 #씬 칩(UnifiedSceneCard/SheetView/MyTasks)은 여전히 `navigateToHashTarget`(참조 아님)인지 확인. CommentPanel/RevisionCommentThread는 prop 미지정 시 navigate 폴백 유지.
- [ ] **Step 3: 회귀 체크리스트(정적/리뷰)**
  - 모달 안 #씬 좌클릭 → 참조 도킹(좌/우), 모달 밖 → 기존 모달 오픈
  - 참조 패널 편집(단계 토글/필드/메모) 정상, onDeleteBoth/onAddDept 참조 씬에 정확
  - "메인으로" → 참조가 메인 모달로 교체
  - #파트·#화 → 기존 이동(패널 없음)
  - backdrop 클릭 → 메인+참조 함께 닫힘
  - 컴포지팅 씬 카드/리테이크 선택창 메모 `#a001` 평문 표시
  - 좁은 화면 오버플로우 대응(댓글 접기/축소)
- [ ] **Step 4: 커밋(필요 시)** — 정리/주석.

> **배포 검증:** preview 불가 → 빌드 통과 + 한솔 실사용 확인(도킹 좌/우, 편집, 메인으로, 입력 느낌). 이후 PR → 코덱스 루프 → 머지 → `npm run build` → G드라이브 배포(manifest 마지막) → SHA 검증.

---

## 검증 / 후속

- 단계별 typecheck + node:test + build:vite. 멀티에이전트/코드리뷰 + 코덱스 리뷰 루프(`codex-review-loop`).
- 배포는 `bflow-release-deploy` 스킬: `npm run build` → G드라이브 동기화(manifest 마지막) → SHA-256 검증 → update-notes.json v1.43.0 추가.
- 입력 UX(한솔 확인) 및 PR3(우클릭 메뉴, v1.44.0)는 범위 밖.
