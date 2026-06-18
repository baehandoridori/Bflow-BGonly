# 리테이크 허브 2단계 — 인라인 카드(시안 A) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. UI 일관성이 중요한 단계라 카드/폼 구현은 단일 작업자가 순차로 진행하고, 검증·스펙준수·심층 리뷰에 서브에이전트를 활용한다.

**Goal:** 1단계가 완성한 담당자 워크플로우 백엔드(순수함수·스토어·서비스·IPC)를 씬 모달 리테이크 탭의 카드 UI(시안 A)에 연결한다 — 담당 칩 + 최종완료 바 + 클릭 인라인 확장 + 완료멘트 입력 + 좌측 4색 막대, 그리고 1단계가 의도적으로 남긴 인계 6건(생성 시 담당지정 배선, Picker 승격 토글, 권한가드 적용, 칸반 assignee_done 분리, self-action 알림 억제, 재배정 활동기록)을 마무리한다.

**Architecture:** 신규 백엔드 로직은 작성하지 않는다. 이미 존재하는 `useRevisionStore` 액션 6종(startAssignee/completeAssignee/reassign/finalResolve/revertFinalResolve/revertAssignee)을 호출하고, `revisionWorkflow.ts` 권한가드 3종(canActAsAssignee/canReassignRevision/canFinalResolveRevision)으로 버튼 노출을 제어한다. 담당 칩·완료멘트 입력·최종완료 바는 **store 비종속 콜백 props 컴포넌트**(`src/components/scenes/revision/`)로 분리해 5단계 허브 시안B가 그대로 재사용하게 한다. 상태 표시 토대(AssigneeState 라벨/색, 색막대 색 선택, 담당자 요약)는 순수 함수로 떼어 `node --test` TDD 한다.

**Tech Stack:** React 18 + TypeScript + framer-motion(AnimatePresence/layout) + Tailwind + Zustand. 테스트는 Node.js 내장 `node:test`(vitest 아님), `@/` alias 미해석이라 테스트 대상·런타임 import 모두 **상대경로**.

**Spec:** `docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md` (§4 핵심결정, §5 권한, §7 워크플로우, §8 인라인 UX, §13 단계). 1단계 계획: `docs/superpowers/plans/2026-06-17-retake-hub-step1-workflow-backend.md`.

---

## 범위 / 경계 (반드시 지킬 것)

**2단계 포함:**
- 인라인 카드(시안 A): `RevisionPanel.tsx` 의 `RevisionCard` 개편 + 씬 모달/기본 탭 적용.
- 1단계 인계 6건 전부 (생성 담당지정, Picker 승격, 권한가드, 칸반 분리, self-action 억제, 재배정 활동기록).

**2단계 제외 (건드리지 말 것):**
- 엔티티 감지(`@멘션`/`G:\`경로/씬·컷 morph, `useEntityDetector`, `EntityAwareInput`) = **3단계**. 완료멘트·내용 입력은 **평문 textarea** 로만. 기존 `PathLinkifiedText` 표시(읽기) 재사용은 OK, 입력 측 morph 도입 금지.
- 리테이크 허브 뷰(`RetakeHubView`)·세트(`comp_revision_sets`/`useRevisionSetStore`)·시안B 테이블·자동취합·가져오기·세트 진행률 = **5단계**. `set_id` 는 데이터에 있어도 카드는 무시.
- `comp_revision_sets` Realtime(`onRevisionSetChange`) = **5단계**.
- `MemoEditor`(TipTap) 엔티티 = **4단계**.
- DB 마이그레이션 라이브 적용 = 한솔 승인 후(코드 작업과 무관). 백엔드 시그니처(`electron/*`, 순수함수, 서비스/스토어 액션 6종) **변경 금지** — 호출만.

**핵심 호환 결정 (레거시 안전 + 점진 전환):**
- `hasAssignees = (rev.assigneeIds?.length ?? 0) > 0`.
  - **담당자 0명**(legacy 또는 신규 미지정) → 기존 단순 흐름 유지: `RevisionStatusAction`(open↔in_progress↔resolved, `updateStatus` 경유) + "담당 지정" 버튼 노출.
  - **담당자 1명+** → 담당 워크플로우: 담당 칩(본인 액션) + 최종완료 바. `RevisionStatusAction`(updateStatus 직접 전환) 숨김.
- 완료멘트: 빈 멘트 허용(스펙 §8.3), placeholder 로 경로 입력 유도.

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|------|------|-----------|
| `src/utils/avatarColor.ts` | 사용자 ID→아바타 색 (Picker 에서 추출, 칩 공통화) | 신규 |
| `src/utils/revisionCardView.ts` | 카드 표현 순수함수 (색막대 색, 담당자 요약, 완료멘트 집계, 게이트) | 신규 |
| `tests/revisionCardView.test.ts` | 위 순수함수 TDD (`node --test`) | 신규 |
| `src/constants/revision.ts` | `ASSIGNEE_STATE_CONFIG`(담당자 상태 라벨/색) 추가, `revisionNoToLabel` 유지 | 수정 |
| `src/components/scenes/revision/AssigneeChipRow.tsx` | 담당 칩 행 (아바타+이름+상태점, 본인 칩 액션 콜백) | 신규 |
| `src/components/scenes/revision/CompletionNoteInput.tsx` | 완료멘트 입력 (평문 textarea, 확정/취소 콜백) | 신규 |
| `src/components/scenes/revision/FinalResolveBar.tsx` | 최종완료 분리 바 (잠금/활성, 콜백) | 신규 |
| `src/components/scenes/RevisionRecipientPicker.tsx` | 담당자 승격 3-state 토글 추가 | 수정 |
| `src/components/scenes/RevisionPanel.tsx` | `RevisionCard` 인라인 확장 통합 + 생성폼 담당지정 | 수정 |
| `src/index.css` | `.rev-side-bar` status 4색 분기 | 수정 |
| `src/stores/useRevisionStore.ts` | `CreateRevisionInput.assigneeIds` + 담당액션 self-mark + mark 유니온 확장 | 수정 |
| `src/stores/useNotificationStore.ts` | `revisionAction` 유니온에 `'assignee_done'` 추가 (알림 메타 타입) | 수정 |
| `src/services/revisionService.ts` | `CreateRevisionServiceInput.assigneeIds` + 생성 시 담당 배선(sheets/local/IPC) | 수정 |
| `src/mocks/devElectronAPI.ts` | mock `supabaseAddRevision` 에 `assigneeIdsJson` 인자 + 저장 | 수정 |
| `src/views/compositing/ProgressKanbanSection.tsx` | assignee_done 4번째 컬럼 분리 | 수정 |
| `src/views/CompositingView.tsx` | 상태필터에 '담당완료'(assignee_done) 추가 + 타입 확장 | 수정 |
| `src/App.tsx` | 리테이크 UPDATE 알림: assignee_done 매핑 + self-mark 억제 연동 | 수정 |
| `electron/main.ts` | 재배정 활동기록이 status 분기에 안 가려지게 우선순위 보정 | 수정 |

> 표현 컴포넌트(`src/components/scenes/revision/*`)는 **store 를 직접 import 하지 않는다**. 모든 데이터/액션은 props 로 받는다 → 5단계 시안B 테이블 재사용. `RevisionPanel` 이 store 와 props 를 잇는 어댑터 역할.

---

## Chunk 1: 표현 토대 (상수 + 순수함수 + TDD)

### Task 1: avatarColor 공통화

**Files:**
- Create: `src/utils/avatarColor.ts`
- Modify: `src/components/scenes/RevisionRecipientPicker.tsx:31-42` (AVATAR_COLORS/avatarColor 제거 후 import)

- [ ] **Step 1: `src/utils/avatarColor.ts` 작성** — `RevisionRecipientPicker.tsx:31-42` 의 `AVATAR_COLORS` 배열과 `avatarColor(id)` 함수를 그대로 옮긴다(동작 동일).

```ts
// 사용자 ID → 일관된 아바타 색 (테마 무관 개인 식별색)
const AVATAR_COLORS = [
  '#6C5CE7', '#74B9FF', '#FDCB6E', '#E17055',
  '#A29BFE', '#00B894', '#FF6B6B', '#F9A8D4',
];

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
```

- [ ] **Step 2: Picker 에서 import 로 교체** — `RevisionRecipientPicker.tsx` 의 로컬 `AVATAR_COLORS`/`avatarColor` 삭제, `import { avatarColor } from '@/utils/avatarColor';` 추가. 호출부 동일.
- [ ] **Step 3: typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 4: Commit** — `git add src/utils/avatarColor.ts src/components/scenes/RevisionRecipientPicker.tsx` / `리테이크 허브 2단계: avatarColor 공통 유틸 추출`

### Task 2: 담당자 상태 표시 상수

**Files:**
- Modify: `src/constants/revision.ts`

- [ ] **Step 1: `ASSIGNEE_STATE_CONFIG` 추가** — `AssigneeState`('pending'|'in_progress'|'done') 별 라벨/색/점색. 색은 status 막대 규약과 정렬(대기 #FDCB6E / 진행중 #74B9FF / 완료 accent). `STATUS_CONFIG` 와 혼동 금지 주석.

```ts
import type { RevisionStatus, RevisionPriority, AssigneeState } from '@/types';

/**
 * 담당자 개별 상태(AssigneeState) 표시값. 리테이크 전체 status(STATUS_CONFIG)와 별개.
 * 담당 칩의 상태 점/라벨에 사용. 색은 §8.1 막대 색 규약과 정렬.
 */
export const ASSIGNEE_STATE_CONFIG: Record<AssigneeState, { label: string; color: string }> = {
  pending: { label: '대기', color: 'var(--status-adjust)' },          // #FDCB6E
  in_progress: { label: '진행중', color: 'var(--status-combine)' },   // #74B9FF
  done: { label: '완료', color: 'rgb(var(--color-accent))' },          // #6C5CE7
};
```

- [ ] **Step 2: typecheck** → PASS.
- [ ] **Step 3: Commit** — `git add src/constants/revision.ts` / `리테이크 허브 2단계: 담당자 상태 표시 상수 추가`

### Task 3: 카드 표현 순수함수 (TDD)

**Files:**
- Create: `src/utils/revisionCardView.ts`
- Test: `tests/revisionCardView.test.ts`

> `node --test` 는 `@/` alias 미해석. 테스트는 `../src/utils/revisionCardView.ts` 상대 import, 모듈 내부 타입은 `import type` 로(런타임 값 import 없음).

- [ ] **Step 1: 실패 테스트 작성** `tests/revisionCardView.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sideBarColorClass, summarizeAssignees, collectAssigneeNotes, canShowFinalResolveBar,
} from '../src/utils/revisionCardView.ts';

test('sideBarColorClass: status별 클래스 접미사', () => {
  assert.equal(sideBarColorClass('open'), 'rev-side-bar-open');
  assert.equal(sideBarColorClass('in_progress'), 'rev-side-bar-progress');
  assert.equal(sideBarColorClass('assignee_done'), 'rev-side-bar-assignee-done');
  assert.equal(sideBarColorClass('resolved'), 'rev-side-bar-done');
});

test('summarizeAssignees: 완료/전체 집계 + 전원완료 플래그', () => {
  const s = summarizeAssignees(['a', 'b'], { a: { state: 'done' }, b: { state: 'in_progress' } });
  assert.equal(s.total, 2);
  assert.equal(s.doneCount, 1);
  assert.equal(s.allDone, false);
  const s2 = summarizeAssignees(['a'], { a: { state: 'done' } });
  assert.equal(s2.allDone, true);
  // state 누락 = pending 취급
  const s3 = summarizeAssignees(['a', 'b'], { a: { state: 'done' } });
  assert.equal(s3.doneCount, 1);
  assert.equal(s3.allDone, false);
});

test('summarizeAssignees: 담당 0명이면 allDone=false (빈 세트 함정 방지)', () => {
  const s = summarizeAssignees([], {});
  assert.equal(s.total, 0);
  assert.equal(s.allDone, false);
});

test('collectAssigneeNotes: done + note 있는 담당자만 (userId, note) 수집', () => {
  const notes = collectAssigneeNotes(['a', 'b', 'c'], {
    a: { state: 'done', note: 'G:\\proj\\a.psd' },
    b: { state: 'done' },          // note 없음 → 제외
    c: { state: 'in_progress', note: '작업중' }, // done 아님 → 제외
  });
  assert.deepEqual(notes, [{ userId: 'a', note: 'G:\\proj\\a.psd' }]);
});

test('canShowFinalResolveBar: 담당자 1명+ 이고 finalResolvedAt 없거나 있으면 노출(되돌리기 포함), 0명이면 숨김', () => {
  assert.equal(canShowFinalResolveBar(['a'], undefined), true);
  assert.equal(canShowFinalResolveBar(['a'], '2026-06-18T00:00:00Z'), true);
  assert.equal(canShowFinalResolveBar([], undefined), false);
});
```

- [ ] **Step 2: 실패 확인** — `node --test tests/revisionCardView.test.ts` → FAIL ("Cannot find module '../src/utils/revisionCardView.ts'").
- [ ] **Step 3: 최소 구현** `src/utils/revisionCardView.ts`

```ts
import type { RevisionStatus, RevisionAssigneeState } from '@/types';
// ⚠️ node --test 호환: 런타임 값 import 금지(import type 만). import type 라인은 트랜스파일 시 strip 되므로
//   @/ alias 여도 node --test 에서 무해(기존 revisionWorkflow.ts 와 동일 패턴). 단 typecheck(tsc) 는
//   alias 를 해석하므로 구현 파일은 반드시 @/types 를 쓴다. 테스트 파일만 상대경로(../src/...)로 대상 import.

type StateMap = Readonly<Record<string, RevisionAssigneeState>>;

/** §8.1 좌측 색막대 — status별 CSS 클래스 접미사. */
export function sideBarColorClass(status: RevisionStatus): string {
  switch (status) {
    case 'in_progress': return 'rev-side-bar-progress';
    case 'assignee_done': return 'rev-side-bar-assignee-done';
    case 'resolved': return 'rev-side-bar-done';
    case 'open':
    default: return 'rev-side-bar-open';
  }
}

export interface AssigneeSummary { total: number; doneCount: number; allDone: boolean; }

/** 담당자 집계 — allDone 은 담당자 1명+ 전원 done 일 때만 true (빈 세트는 false). */
export function summarizeAssignees(assigneeIds: readonly string[], states: StateMap): AssigneeSummary {
  const total = assigneeIds.length;
  const doneCount = assigneeIds.filter((id) => (states[id]?.state ?? 'pending') === 'done').length;
  return { total, doneCount, allDone: total > 0 && doneCount === total };
}

/** done + note 가 있는 담당자의 완료멘트 수집 (대표 멘트 표시용). */
export function collectAssigneeNotes(assigneeIds: readonly string[], states: StateMap): Array<{ userId: string; note: string }> {
  const out: Array<{ userId: string; note: string }> = [];
  for (const id of assigneeIds) {
    const s = states[id];
    if (s?.state === 'done' && s.note) out.push({ userId: id, note: s.note });
  }
  return out;
}

/** 최종완료 바를 카드에 그릴지 — 담당자 1명+ 일 때만(0명 항목은 단순 흐름). 활성/잠금은 호출측이 allDone+권한으로 결정. */
export function canShowFinalResolveBar(assigneeIds: readonly string[], _finalResolvedAt: string | null | undefined): boolean {
  return assigneeIds.length > 0;
}
```

> 검증됨(에이전트 실측): Node 22.18 은 `import type` 라인을 통째로 strip 하므로 구현 파일이 `@/types`(alias)를 써도 `node --test` 에서 깨지지 않는다. typecheck(`tsc`)는 alias 를 해석하므로 구현 파일은 `@/types` 가 정답. 테스트 파일(`tests/revisionCardView.test.ts`)만 대상 모듈을 상대경로 `../src/utils/revisionCardView.ts` 로 import.

- [ ] **Step 4: 통과 확인** — `node --test tests/revisionCardView.test.ts` → PASS (5 tests). 이어 `node --test tests/revisionWorkflow.test.ts tests/retakeTerminology.test.ts tests/revisionCardView.test.ts` 전체 회귀 → PASS.
- [ ] **Step 5: typecheck** → PASS.
- [ ] **Step 6: Commit** — `git add src/utils/revisionCardView.ts tests/revisionCardView.test.ts` / `리테이크 허브 2단계: 카드 표현 순수함수 TDD`

---

## Chunk 2: 공통 표현 컴포넌트 (store 비종속)

> 셋 다 콜백 props 만 받는다. store/권한가드를 import 하지 않는다. 권한·게이트 판정 결과를 boolean prop 으로 받는다.

### Task 4: AssigneeChipRow

**Files:**
- Create: `src/components/scenes/revision/AssigneeChipRow.tsx`

- [ ] **Step 1: 작성** — props: `{ assignees: Array<{ id: string; name: string; state: AssigneeState }>; currentUserId: string | null; canAct: boolean; finalResolved: boolean; onStart: (userId) => void; onComplete: (userId) => void; onRevert: (userId) => void }`.
  - 각 칩: 아바타(`avatarColor(id)`) + 이름 + 상태 점(`ASSIGNEE_STATE_CONFIG[state].color`).
  - 본인 칩(`id === currentUserId && canAct`)만 클릭 액션: `pending`→onStart, `in_progress`→onComplete(멘트입력은 부모가 처리; 여기선 onComplete(userId) 트리거만), `done`→onRevert. `finalResolved` 면 본인 칩도 되돌리기 비활성(스펙 §6.2).
  - 타인 칩은 비클릭 상태 표시만.
- [ ] **Step 2: typecheck** → PASS.
- [ ] **Step 3: Commit** — `리테이크 허브 2단계: 담당 칩 행 컴포넌트`

### Task 5: CompletionNoteInput

**Files:**
- Create: `src/components/scenes/revision/CompletionNoteInput.tsx`

- [ ] **Step 1: 작성** — props: `{ initialValue?: string; onConfirm: (note: string) => void; onCancel: () => void }`. 평문 `<textarea>`(placeholder "완료 결과·파일 경로(G:\\...)를 적어주세요 — 비워도 됩니다"), 확정/취소 버튼. **엔티티 감지 없음**(3단계). Ctrl/Cmd+Enter 확정.
- [ ] **Step 2: typecheck** → PASS.
- [ ] **Step 3: Commit** — `리테이크 허브 2단계: 완료멘트 입력 컴포넌트`

### Task 6: FinalResolveBar

**Files:**
- Create: `src/components/scenes/revision/FinalResolveBar.tsx`

- [ ] **Step 1: 작성** — props: `{ resolved: boolean; enabled: boolean; canFinalResolve: boolean; finalResolvedBy?: string; onResolve: () => void; onRevert: () => void }`.
  - `resolved` 면 "최종 완료됨 · {finalResolvedBy}" + 되돌리기(권한 시).
  - 미완료면 분리된 하단 바: `enabled && canFinalResolve` 일 때만 활성("최종 완료"), 아니면 잠금(전원 담당완료 전 비활성, "담당 전원 완료 후 최종 완료 가능" 안내). `canFinalResolve` 없으면 숨김.
- [ ] **Step 2: typecheck** → PASS.
- [ ] **Step 3: Commit** — `리테이크 허브 2단계: 최종완료 바 컴포넌트`

---

## Chunk 3: RevisionRecipientPicker 담당자 승격 (3-state)

**Files:**
- Modify: `src/components/scenes/RevisionRecipientPicker.tsx`

> 불변식: 담당자(승격)는 항상 알림 대상. 3-state 사이클 = 미선택 → 알림(체크) → 담당자(왕관) → 미선택. `defaultCheckedKey` 변경 시 승격 상태도 함께 리셋(carry-over 방지, 코덱스 P2 함정).

- [ ] **Step 1: props 확장** — `onAssigneesChange?: (assigneeIds: string[]) => void` 추가(옵셔널 — 기존 호출처 무영향). 담당 차원 비활성 모드(승격 토글 미노출)를 위해 `enableAssignee?: boolean` 추가.
- [ ] **Step 2: 승격 상태 추가** — `const [assigneeIds, setAssigneeIds] = useState<string[]>([]);`. `defaultCheckedKey` useEffect(line 68-73) 에 `setAssigneeIds([])` 추가 + `onAssigneesChange?.([])` emit.
- [ ] **Step 3: 3-state 토글 로직** — 칩 클릭(`toggle`)을 사이클로: 알림만→담당승격(assigneeIds 추가, 알림 유지)→해제(알림+담당 모두 제거). 담당자는 항상 checked. `emitChange` 시 `onAssigneesChange?.(assigneeIds ∩ checked)` 도 emit(불변식: 알림에서 빠지면 담당도 빠짐).
- [ ] **Step 4: 왕관 배지 렌더** — `enableAssignee` 일 때 담당자 칩 우측에 `Crown`(lucide) 아이콘 배지. title "담당자 — 한 번 더 누르면 해제". 비담당 알림 칩은 기존 Check 배지.
- [ ] **Step 5: §7.2 역방향 불변식 경고** — 담당자(왕관) 칩을 **미선택으로 전환**(=담당이기도 한 사람을 알림에서 빼는 동작)할 때, 클릭 직전 인라인 경고/툴팁 "담당자이기도 합니다 — 함께 해제됩니다" 노출 후 알림+담당 동시 해제. (스펙 §6.1/§7.2 명시 요구 — 차단이 아니라 경고 후 동시 해제.) 3-state 사이클상 '왕관→미선택' 전이에 이 경고를 건다.
- [ ] **Step 6: typecheck** → PASS.
- [ ] **Step 7: Commit** — `리테이크 허브 2단계: 알림 대상 담당자 승격 토글 + 동시 해제 경고`

---

## Chunk 4: createRevision 담당자 배선

> 백엔드(`electron/*`)는 `assigneeIdsJson` 끝단까지 완비. 렌더러 끝단만 연결. 불변식 `assignee_ids ⊆ notify_user_ids` 는 `sanitizeAssignees` 로 보정.

### Task 7: 타입 + 서비스 배선

**Files:**
- Modify: `src/services/revisionService.ts:425-516`
- Modify: `src/stores/useRevisionStore.ts:14-26, 149-153`

- [ ] **Step 1: 타입에 assigneeIds 추가** — `CreateRevisionServiceInput`(revisionService.ts:425-434) 과 `CreateRevisionInput`(useRevisionStore.ts:14-26) 둘 다 `assigneeIds?: string[]`.
- [ ] **Step 2: service 본문 배선** — `createRevision`(revisionService.ts:436):
  - `notifyUserIds` 계산 후 `const { assigneeIds, assigneeStates } = sanitizeAssignees(input.assigneeIds ?? [], {}, notifyUserIds);` (import 추가).
  - `const status = deriveRevisionStatus(assigneeIds, assigneeStates, undefined);` (담당 전원 pending이면 'open' 유지).
  - sheetsMode revision 객체(452-473): `status`, `assigneeIds`, `assigneeStates` 를 계산값으로(현 하드코딩 `[]`/`{}`/`'open'` 대체).
  - `supabaseAddRevision` 호출(476-481): status 인자를 `status` 로, 마지막에 `, JSON.stringify(assigneeIds)` 추가(17번째).
  - 로컬 분기 revision 객체(493-509): `assigneeIds`, `assigneeStates`, `status` 포함.
- [ ] **Step 3: store createRevision** — `revisionService.createRevision(input)` 가 input 그대로 받으므로 추가 변경 불필요(타입만). `addRevisionOptimistic` 은 service 반환 revision 사용(이미 assignee 반영됨) → OK 확인.
- [ ] **Step 4: typecheck** → PASS.
- [ ] **Step 5: Commit** — `리테이크 허브 2단계: 생성 시 담당자 지정 데이터 배선`

### Task 8: dev mock

**Files:**
- Modify: `src/mocks/devElectronAPI.ts:609-626`

- [ ] **Step 1: mock 시그니처 + 저장** — `supabaseAddRevision` 에 `assigneeIdsJson?: string` 인자 추가, push 객체에 `assigneeIds: assigneeIdsJson ? JSON.parse(assigneeIdsJson) : []`, `assigneeStates: {}` 저장(preview 카드 검증용). (mock row 형태가 `mapRevision` 입력과 일치하도록 확인.)
- [ ] **Step 2: typecheck** → PASS.
- [ ] **Step 3: Commit** — `리테이크 허브 2단계: dev mock 담당자 인자 반영`

---

## Chunk 5: RevisionCard 인라인 확장 통합 (시안 A 본체)

**Files:**
- Modify: `src/components/scenes/RevisionPanel.tsx`
- Modify: `src/index.css:1196-1226`

### Task 9: 좌측 막대 4색 CSS

- [ ] **Step 1: `.rev-side-bar` 변형 추가** (index.css) — 기존 `.rev-side-bar`(accent 기본)/`.rev-side-bar-done`(#00B894) 유지 + `rev-side-bar-open`(#FDCB6E)/`rev-side-bar-progress`(#74B9FF)/`rev-side-bar-assignee-done`(rgb(var(--color-accent))). 토큰 사용.

```css
.rev-side-bar-open { background: var(--status-adjust); }
.rev-side-bar-progress { background: var(--status-combine); }
.rev-side-bar-assignee-done { background: rgb(var(--color-accent)); }
/* .rev-side-bar-done 는 기존 #00B894 유지 */
```

- [ ] **Step 2: Commit** — `리테이크 허브 2단계: 리테이크 카드 좌측 막대 4색`

### Task 10: RevisionCard 담당 워크플로우 통합

> `RevisionCard` 는 store 액션 콜백을 받아 Chunk 2 컴포넌트에 연결. `RevisionPanel` 이 store 와 잇는다.

- [ ] **Step 1: RevisionPanel store 구조분해 확장** (RevisionPanel.tsx:317) — `startAssignee, completeAssignee, reassign, finalResolve, revertFinalResolve, revertAssignee` 추가.
- [ ] **Step 2: 권한가드 import** — `canActAsAssignee, canReassignRevision, canFinalResolveRevision` (`@/utils/revisionWorkflow`), `summarizeAssignees, collectAssigneeNotes, sideBarColorClass, canShowFinalResolveBar` (`@/utils/revisionCardView`).
- [ ] **Step 3: RevisionCard props 확장** — `currentUser`, `allUsers`(이미 카드 내 useAuthStore 사용 중 — 유지 가능), 담당 액션 콜백들, 인라인 확장 상태. 담당 칩/최종완료 바/완료멘트 입력을 `hasAssignees` 분기로 렌더:
  - `hasAssignees=false`: 기존 `RevisionStatusAction`(updateStatus) + (canReassign 시) "담당 지정" 버튼(reassign UI 열기).
  - `hasAssignees=true`: `RevisionStatusAction` 숨김. `AssigneeChipRow`(본인 액션 → store.startAssignee/completeAssignee→멘트입력/revertAssignee) + `FinalResolveBar`(enabled=summarizeAssignees(...).allDone, canFinalResolve=canFinalResolveRevision(currentUser,rev)).
- [ ] **Step 4: 좌측 막대 색** — `<span className={`rev-side-bar ${sideBarColorClass(revision.status)}`} />` (기존 resolved-only 분기 대체).
- [ ] **Step 5: 클릭 인라인 확장** — `expanded` 토글(useState). 담당 칩/완료멘트/최종완료 바/댓글을 `AnimatePresence` height+opacity 로 감쌈.
  - **토글 핸들은 헤더 좌측 라벨 영역(re# + StatusBadge, 즉 `RevisionPanel.tsx:179-188` 의 `<div className="flex items-center gap-2 flex-wrap">`)에만** 부여한다(또는 별도 chevron). 카드 루트(`motion.div` 160)·헤더 div 전체에 onClick 토글을 걸지 않는다 — 현재 헤더 우측(190-202)이 `RevisionStatusAction`·삭제버튼을 자식으로 가져 버블링 충돌.
  - 헤더 우측 액션 컨테이너(`:190` `<div className="flex items-center gap-1.5">`)에 `onClick={(e)=>e.stopPropagation()}`. 삭제버튼·`RevisionStatusAction`·"담당 지정/변경" 버튼 각각도 stopPropagation.
  - **확장 영역(담당 칩/완료멘트 textarea/최종완료 바/댓글)에는 토글 onClick 을 절대 걸지 않는다.** `AssigneeChipRow` 본인 칩 onClick(store 액션 호출)·`CompletionNoteInput` textarea·`FinalResolveBar` 버튼은 확장 영역 내부라 토글과 무관하지만, 혹시 상위에 핸들이 있으면 stopPropagation.
  - 댓글 스레드는 확장 영역 안에 둔다. `commentSceneKey` 계산식(`:359` `${sheetName}:${scene.no}`)과 prop 전달 경로는 **변경 금지**(JSX 위치만 이동). `scene.no` 는 sort_order(숫자)지 raw sceneId 아님 — 형식 보존.
- [ ] **Step 6: 완료멘트 입력 흐름** — 본인 칩 'in_progress'→완료 클릭 시 `CompletionNoteInput` 인라인 등장 → onConfirm(note) → `store.completeAssignee(rev, currentUser.id, note)`. 카드 로컬 state `noteEditingFor: userId | null`.
- [ ] **Step 7: 재배정 UI** — "담당 지정"/"담당 변경" 클릭 시 인라인으로 `RevisionRecipientPicker`(enableAssignee, defaultCheckedIds=현 notifyUserIds, 현 assigneeIds 초기) 또는 간이 멀티선택. 확정 시 `store.reassign(rev, nextAssigneeIds)`. `canReassignRevision` 가드. 후보는 `notifyUserIds` 부분집합. **§7.2 역방향 경고(Chunk 3 Step 5)를 여기에도 적용** — 담당자를 알림에서 빼면 담당도 함께 빠진다는 경고. 재배정 토글 버튼은 stopPropagation(Step 5).
- [ ] **Step 8: 완료멘트 표시** — `collectAssigneeNotes` 로 done 담당자 멘트 집계해 표시(기존 legacy `resolvedNote` 블록은 hasAssignees=false 일 때만). `PathLinkifiedText` 로 경로 표시(읽기 재사용 OK).
- [ ] **Step 9: StatusBadge** — 텍스트 배지는 §8.1상 색막대로 대체가 원칙이나, 접근성/식별 위해 작게 유지하되 `assignee_done` 아이콘 분기 추가(현재 open/in_progress/resolved만). (배지 완전 제거는 폴리싱 6단계로 미뤄도 됨 — 2단계는 막대 4색 + 배지 라벨 유지.)
- [ ] **Step 10: typecheck** → PASS.
- [ ] **Step 11: Commit** — `리테이크 허브 2단계: 카드 담당 칩+최종완료 바+인라인 확장 통합`

### Task 11: 생성 폼 담당지정

- [ ] **Step 1: 폼 state** (RevisionPanel.tsx:369 부근) — `const [assigneeIds, setAssigneeIds] = useState<string[]>([]);`.
- [ ] **Step 2: Picker 연결** (601-606) — `enableAssignee`, `onAssigneesChange={setAssigneeIds}` 추가.
- [ ] **Step 3: createRevision 전달** (431-441) — `assigneeIds` 추가.
- [ ] **Step 4: 리셋** (442-445) — `setAssigneeIds([])` 추가.
- [ ] **Step 5: typecheck** → PASS.
- [ ] **Step 6: Commit** — `리테이크 허브 2단계: 생성 폼 담당자 지정 UI`

---

## Chunk 6: 칸반 assignee_done 4컬럼 분리

**Files:**
- Modify: `src/views/compositing/ProgressKanbanSection.tsx`
- Modify: `src/views/CompositingView.tsx`

- [ ] **Step 1: byStatus 4분할** (ProgressKanbanSection.tsx:36-40) — `assignee_done` 키 분리(현 in_progress 합산 제거).
- [ ] **Step 2: KanbanColumn statusKey 타입** (:91) — `'open'|'in_progress'|'assignee_done'|'resolved'`. `isResolved` 매핑(:119) 은 `statusKey === 'resolved'` 유지.
- [ ] **Step 3: 4컬럼 렌더** — `grid-cols-3`(:43)→`grid-cols-4`(또는 반응형), `<KanbanColumn title="담당 완료" statusKey="assignee_done" revisions={byStatus.assignee_done} ... />` 추가. `STATUS_CONFIG['assignee_done']` 색/라벨 그대로.
- [ ] **Step 4: CompositingView 상태필터** (:626-631) — 버튼 배열에 `{ key: 'assignee_done' as const, label: '담당완료', icon: <아이콘> }` 추가. **타입 변경 불필요** — `statusFilter` 는 이미 `'all' | RevisionStatus` 이고 `RevisionStatus` 에 `'assignee_done'` 포함(검증됨). 엄격 일치 필터(:267,:318)는 자동 동작.
- [ ] **Step 5: typecheck** → PASS.
- [ ] **Step 6: Commit** — `리테이크 허브 2단계: 칸반 담당완료 컬럼 분리`

---

## Chunk 7: self-action 억제 + 알림 매핑 + 재배정 활동기록

**Files:**
- Modify: `src/stores/useRevisionStore.ts`
- Modify: `src/App.tsx:1560-1629`
- Modify: `electron/main.ts:1903-1908`

> 목적: 신규 담당 액션이 본인에게 알림 깜빡임을 만들지 않게 self-mark, assignee_done 알림 매핑, 재배정 감사로그 보장(스펙 §7.3).

> 현행 코드 사실(검증됨): `electron/main.ts:1903-1908` 은 **이미** `else if (updates.assigneeIds) → 'revision_reassign'` 분기를 가짐(체인 마지막). 순수 재배정(status='open' 유지)은 이미 정상 기록된다. 소실되는 유일한 케이스는 **재배정이 status 전이(in_progress/assignee_done/resolved)를 동반**할 때 위 분기가 먼저 잡는 경우다. 이것만 보정한다.

- [ ] **Step 1: mark 유니온 확장** — `markSelfRevisionAction`/`isRecentSelfRevisionAction` 의 action 타입을 `'in_progress' | 'resolve' | 'assignee_done' | 'final_resolve' | 'reassign'` 로 확장(useRevisionStore.ts:286,297).
- [ ] **Step 2: 담당 액션에 mark 호출** — store 액션 6종(199-249)에 낙관 반영 직후 `markSelfRevisionAction(rev.id, <action>)` 추가:
  - startAssignee→`'in_progress'`
  - completeAssignee→파생 status 가 `assignee_done` 이면 `'assignee_done'`, 아니면 `'in_progress'`
  - finalResolve→`'final_resolve'`
  - reassign→`'reassign'`
  - revertFinalResolve→파생 status(`deriveRevisionStatus(...,null)`)가 `assignee_done` 이면 `'assignee_done'` else `'in_progress'`
  - **revertAssignee→`'in_progress'`** (revert 는 항상 in_progress 로 파생 → 본인 알림 깜빡임 방지. P2 보강: 생략하지 말 것.)
- [ ] **Step 3: 알림 메타 타입 확장** — `src/stores/useNotificationStore.ts:43` `revisionAction?: 'add'|'in_progress'|'resolve'|'comment'` 에 `'assignee_done'` 추가. (`devPreviewNotifications.ts` 등 같은 값 쓰는 곳도 grep 으로 확인.) 이걸 안 하면 Step 4 의 디스패치가 typecheck 실패.
- [ ] **Step 4: App.tsx status→action 매핑 확장** (1582-1593) — `assignee_done` 케이스 추가(titlePrefix "리테이크 담당 완료", action `'assignee_done'`). self 억제(1597)에 확장된 action 반영(`isRecentSelfRevisionAction(id, action)`). `open` 복귀는 기존대로 무알림.
- [ ] **Step 5: 재배정 알림 정책** — 재배정은 status-diff 가드(1578)에 걸려 알림이 안 나갈 수 있음(의도된 조용함 허용). **알림은 보내지 않되 활동기록만 보장**(Step 6) — 스펙 §7.3 은 감사로그만 요구. App.tsx 추가 변경 없음.
- [ ] **Step 6: main.ts 재배정 활동기록 보정 (동반 status 전이 케이스만)** —
  - `reassignRevision`(revisionService.ts:605) 가 `supabaseUpdateRevision(id, { ...updates, __op: 'reassign' })` 로 호출(마커 추가). 서비스 시그니처(`rev, nextAssigneeIds`)는 불변 — 경계 위반 아님.
  - `electron/main.ts:1898` IPC 핸들러에서 **`__op` 를 먼저 분리**해 DB 경로 오염/`console.warn` 노이즈 방지: `const { __op, ...dbUpdates } = updates; await sbUpdateRevision(id, dbUpdates);` (supabase.ts 의 fieldMap 미등록 warn 회피).
  - 활동기록 분기(1903-1908)는 분리 전 `updates`(또는 보존한 `__op`)를 참조해 우선순위 재배치: `if (updates.finalResolvedAt) ... else if (__op === 'reassign') statusActionType='revision_reassign'` 를 **finalResolvedAt 다음, status 분기 앞**으로. 즉 재배정 update 는 동반 status 전이가 있어도 `revision_reassign` 로 기록(한솔 §7.3 '재배정 포함' 우선). finalResolve 동반만 예외(최종완료 우선).
- [ ] **Step 7: typecheck + node 테스트 회귀** → PASS.
- [ ] **Step 8: Commit** — `리테이크 허브 2단계: 담당 액션 self-mark + 담당완료 알림 + 재배정 활동기록 보정`

---

## Chunk 8: 통합 검증 + 심층 리뷰

- [ ] **Step 1: 전체 typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 2: 전체 node 테스트** — `node --test tests/revisionWorkflow.test.ts tests/retakeTerminology.test.ts tests/revisionCardView.test.ts` → 전부 PASS(회귀 0).
- [ ] **Step 3: build:vite** — `npm run build:vite` → PASS.
- [ ] **Step 4: preview 수동 확인** — dev + `?preview=1` 자동 로그인(mock 배한솔). 씬 모달 리테이크 탭에서: (a) 담당자 지정→칩 표시, (b) 본인 칩 시작→진행중 막대색, (c) 완료→멘트 입력→assignee_done, (d) 최종완료 바 활성→resolved, (e) 카드 클릭 확장/접힘, (f) 칸반 4컬럼. 콘솔/네트워크 에러 0.
- [ ] **Step 5: 심층 멀티에이전트 코드 리뷰** — 5차원(정확성/회귀/스펙준수/권한·불변식/UX경계) find → 적대적 검증. Critical/P1 0 까지 반영.
- [ ] **Step 6: Definition of Done 확인** (아래) + 메모리 갱신 + 3단계 안내.

---

## Definition of Done (2단계 완료 기준)

- [ ] 담당자 1명/다중 모두 `지정→시작→완료(멘트)→최종완료` 정상. 전원 담당완료 전 최종완료 바 잠금.
- [ ] 권한 가드: 본인만 담당 액션, 요청자/컴포지터급만 재배정·최종완료. 무권한 비노출.
- [ ] 담당자 0명 항목은 기존 단순 흐름(updateStatus) 유지(레거시 안전).
- [ ] 생성 시 담당 지정 → 저장 후에도 유지(sheets/local/preview 모두), 불변식 `assignee_ids ⊆ notify` 복원.
- [ ] 좌측 막대 4색, 클릭 인라인 확장, 완료 opacity/취소선 유지, re#/글래스/세로선 자산 유지.
- [ ] 칸반 담당완료 컬럼 분리. 본인 담당 액션 시 자기 알림 깜빡임 없음. 재배정 활동기록 남음.
- [ ] typecheck + 전체 node 테스트 + build:vite PASS. preview 수동 확인. 심층 리뷰 Critical/P1 0.
- [ ] 경계 준수: 엔티티 감지/허브·세트/시안B/TipTap 미착수, 백엔드 시그니처 무변경.

## 다음 단계 (3단계 예고)

엔티티 감지 공통 입력 — `useEntityDetector` + `EntityAwareInput`, 기존 `@멘션` 댓글류(`RevisionCommentThread`/`CommentPanel`)부터 평문→칩 morph 교체. 2단계의 완료멘트/내용 입력창이 3단계에서 엔티티 인식 입력으로 승격된다.

## 미해결 / 구현 중 결정

- 완료멘트 필수 여부: 현재 빈 멘트 허용(placeholder 유도). 한솔 피드백 시 강제 전환.
- StatusBadge 텍스트 완전 제거는 6단계 폴리싱으로 미룸(2단계는 막대 4색 + 배지 라벨 유지).
- 재배정 알림: 활동기록만 보장, 푸시 알림은 미발송(스펙 §7.3 감사로그 요구만 충족).
