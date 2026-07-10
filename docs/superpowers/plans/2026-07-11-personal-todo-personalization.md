# Personal Todo Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `내 할일` 디자인을 유지하면서 개인 투두에만 상단 고정, 다중 레이블, 우선순위, 3단계 상태 버튼, 항상 보이는 추가 버튼, 반응형 메모를 제공하고 안전한 다중 창·캘린더 동기화까지 배포한다.

**Architecture:** 개인 투두의 순수 도메인 규칙, Electron main 소유 저장 큐, renderer 낙관적 상태, 표시 컴포넌트를 분리한다. Supabase는 기존 `completed` 컬럼과 호환되는 `status` trigger와 원자적 순서 RPC를 제공하며, renderer는 사용자 ID나 전체 todo 객체를 쓰기 API에 넘기지 않는다. Google Calendar side effect는 main의 todo별 worker와 복구 journal로 실행하고 renderer의 캘린더 역동기화는 allowlist patch만 사용한다.

**Tech Stack:** Electron, React 18, TypeScript, Tailwind CSS, Framer Motion, Zustand, Supabase PostgreSQL 17, Google Calendar API, Node `node:test`.

## Global Constraints

- 모든 변경은 `C:\Bflow-BGonly`에서만 수행하고 참고용 Bflow 원본은 수정하지 않는다.
- 상단 고정·레이블·우선순위·3단계 상태는 개인 투두에만 적용하며 씬·캐릭터 작업은 기존 동작을 유지한다.
- 목록 순서는 `미완료 고정 개인 투두 → 씬 → 캐릭터 → 미완료 일반 개인 투두 → 완료`다.
- 우선순위는 `high | medium | low | none`이며 자동 정렬에 사용하지 않는다.
- 상태는 `todo → doing → done`이고 행·카드에는 다음 행동만 크게 표시한다. 완료 항목의 `다시 열기`는 `todo`로 돌아간다.
- 한 개인 투두에는 여러 레이블을 붙일 수 있고 넓은 행은 최대 2개와 `+N`, 340px 미만은 1개와 `+N`을 표시한다.
- 레이블 팔레트는 `violet #8B7CF6`, `blue #67A9FF`, `green #5BC5A7`, `yellow #E8C261`, `orange #EF9F55`, `red #EF6A78`, `pink #E984B4`, `gray #8B8DA3`만 허용한다.
- 메모는 3줄에서 시작해 약 10줄 또는 모달 높이 40%까지 커지고 이후 내부 스크롤한다.
- 개인 데이터 변경은 UI 즉시 반영 → main queue → Supabase canonical 응답 확정 순서이며, 확정 실패는 최신 서버 baseline으로 롤백한다.
- renderer 공개 todo·label·legacy task view API는 `userId`를 받지 않으며 main의 canonical session을 소유권 기준으로 사용한다.
- 캘린더 역동기화는 `title, memo, startDate, endDate, addToCalendar`만 변경하고 `status, priority, pinned, labelIds`를 보존한다.
- 테스트 모드는 사용자별 데이터 격리, 팝업 공유, 세션 복원, 레이블·정렬·상태 기능을 실제 앱과 동일하게 모사한다.
- 데이터베이스 migration을 앱보다 먼저 적용하고 구버전 `completed` write 호환을 확인한 뒤 앱을 배포한다.
- 기능 릴리스 버전은 `1.78.0`이며 `package.json`, `package-lock.json`, `DEVLOG/update-notes.json`을 함께 갱신한다.
- 코드 변경 후 `npm run typecheck`, 관련 `node --test`, `npm run test:entity`, `npm run test:auto-update`, `npm run build:vite`를 통과한다.
- 정식 배포는 merge된 `main`에서 `npm run build` 후 G드라이브에 `manifest.json`을 제외한 파일을 먼저 복사하고 manifest를 마지막에 갱신한다.

---

## File Structure

- `src/components/widgets/my-tasks/types.ts`: 개인 투두·레이블 타입과 hook 공개 계약.
- `src/components/widgets/my-tasks/personalTodoDomain.ts`: 정규화, 상태 전이, 그룹 분류, 순서 재구성, 레이블·우선순위 표시 순수 함수.
- `DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql`: 컬럼, 호환 trigger, label table, 원자적 todo·label RPC.
- `electron/personalTodoService.ts`: canonical session 기반 main mutation queue와 Supabase/RPC 호출.
- `electron/personalTodoCalendarSync.ts`: todo별 Google Calendar worker, timeout, 멱등 reconcile.
- `electron/personalTodoRecoveryJournal.ts`: atomic temp-write+rename 복구 journal.
- `electron/sessionManager.ts`: main-verified login/restore/logout와 session 전환 barrier.
- `electron/main.ts`, `electron/preload.ts`, `src/types/index.ts`: 타입이 있는 IPC 등록과 브리지.
- `src/components/widgets/my-tasks/hooks/usePersonalTodos.ts`: confirmed baseline, optimistic intent, session epoch, broadcast merge.
- `src/components/widgets/my-tasks/hooks/useMyTasksData.ts`: 씬·캐릭터 조합과 개인 todo hook 연결.
- `src/components/widgets/my-tasks/components/TodoMetadata.tsx`: 우선순위선, 레이블 요약, 상태 보조 문구.
- `src/components/widgets/my-tasks/components/TodoStatusAction.tsx`: 다음 행동 버튼.
- `src/components/widgets/my-tasks/components/PinnedTodoSection.tsx`: `나의 고정` 리스트·카드 패널.
- `src/components/widgets/my-tasks/components/TodoCard.tsx`: 개인 투두 카드.
- `src/components/widgets/my-tasks/components/TodoLabelPicker.tsx`: 레이블 선택·생성·편집 popover.
- `src/components/widgets/my-tasks/components/TodoRow.tsx`, `TodoDetailModal.tsx`, `MyTasksWidget.tsx`: 기존 시각 구조를 유지한 통합 UI.
- `src/components/common/EntityAwareInput.tsx`: 기존 호출과 호환되는 auto-grow 상한.
- `src/views/ScheduleView.tsx`: calendar-to-todo allowlist patch.
- `src/mocks/personalTodoPreviewStore.ts`, `src/mocks/devElectronAPI.ts`: 테스트 모드 영속·브리지.
- `tests/personalTodoDomain.test.ts`, `tests/personalTodoDatabaseContract.test.ts`, `tests/personalTodoDataWiring.test.ts`, `tests/personalTodoUiWiring.test.ts`, `tests/personalTodoPreview.test.ts`: 새 기능 회귀 테스트.

---

### Task 1: Personal todo domain contract

**Files:**
- Modify: `src/components/widgets/my-tasks/types.ts`
- Create: `src/components/widgets/my-tasks/personalTodoDomain.ts`
- Modify: `src/components/widgets/my-tasks/statsUtils.ts`
- Create: `tests/personalTodoDomain.test.ts`
- Modify: `tests/myTasksStats.test.ts`

**Interfaces:**
- Produces: `normalizePersonalTodo(raw): PersonalTodo`, `createPersonalTodo(input): PersonalTodo`, `splitPersonalTodos(todos): { pinned; normal; done }`, `reassemblePersonalTodos(groups): PersonalTodo[]`, `getTodoNextAction(status)`, `summarizeTodoLabels(labelIds, labels, compact)`, `getPriorityPresentation(priority)`.
- Produces types: `PersonalTodoStatus`, `PersonalTodoPriority`, `PersonalTodoLabel`, `PersonalTodoLabelColorKey`.

- [ ] **Step 1: Write the failing domain tests**

```ts
test('legacy completed value is normalized into canonical status', () => {
  assert.equal(normalizePersonalTodo({ id: 'a', title: 'A', completed: true }).status, 'done');
  assert.equal(normalizePersonalTodo({ id: 'b', title: 'B', completed: false }).status, 'todo');
});

test('completed pinned todo leaves the pinned group and reopens into it', () => {
  const done = normalizePersonalTodo({ id: 'a', title: 'A', completed: true, pinned: true });
  assert.deepEqual(splitPersonalTodos([done]).pinned, []);
  const reopened = applyPersonalTodoStatus(done, 'todo');
  assert.deepEqual(splitPersonalTodos([reopened]).pinned.map((todo) => todo.id), ['a']);
});

test('label summary preserves selected order and reports overflow', () => {
  const labels = [
    { id: 'l1', name: '작화', colorKey: 'violet', createdAt: '' },
    { id: 'l2', name: '급함', colorKey: 'red', createdAt: '' },
    { id: 'l3', name: '회의', colorKey: 'blue', createdAt: '' },
  ] satisfies PersonalTodoLabel[];
  assert.deepEqual(summarizeTodoLabels(['l2', 'l1', 'l3'], labels, false), {
    visible: [labels[1], labels[0]], hiddenCount: 1,
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test ./tests/personalTodoDomain.test.ts ./tests/myTasksStats.test.ts`

Expected: FAIL because the new domain types and helpers do not exist and stats still derive completion from `completed`.

- [ ] **Step 3: Implement the minimal domain API**

```ts
export type PersonalTodoStatus = 'todo' | 'doing' | 'done';
export type PersonalTodoPriority = 'high' | 'medium' | 'low' | 'none';
export type PersonalTodoLabelColorKey = 'violet' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'gray';

export interface PersonalTodo {
  id: string;
  title: string;
  memo: string;
  status: PersonalTodoStatus;
  completed: boolean;
  priority: PersonalTodoPriority;
  pinned: boolean;
  labelIds: string[];
  createdAt: string;
  startDate?: string;
  endDate?: string;
  addToCalendar?: boolean;
}

export function applyPersonalTodoStatus(todo: PersonalTodo, status: PersonalTodoStatus): PersonalTodo {
  return { ...todo, status, completed: status === 'done' };
}
```

`normalizePersonalTodo` must reject invalid enum values to the documented defaults, de-duplicate label IDs in first-seen order, and always derive `completed` from status. `reassemblePersonalTodos` must return pinned, normal, done in that order without duplicate IDs.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test ./tests/personalTodoDomain.test.ts ./tests/myTasksStats.test.ts`

Expected: PASS with `doing` counted as incomplete and only `done` counted as complete.

- [ ] **Step 5: Commit**

```powershell
git add src/components/widgets/my-tasks/types.ts src/components/widgets/my-tasks/personalTodoDomain.ts src/components/widgets/my-tasks/statsUtils.ts tests/personalTodoDomain.test.ts tests/myTasksStats.test.ts
git commit -m "개인 할일 상태와 개인화 도메인 규칙 추가"
```

---

### Task 2: PostgreSQL compatibility and atomic mutation contract

**Files:**
- Create: `DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql`
- Create: `tests/personalTodoDatabaseContract.test.ts`
- Modify: `DEVLOG/migrations/2026-04-30_delete_user_cascade_rpc.sql`
- Modify: `DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql`

**Interfaces:**
- Consumes: enum strings and label palette from Task 1.
- Produces RPCs: `patch_personal_todo(p_todo_id uuid, p_user_id text, p_patch jsonb)`, `mutate_personal_todo_order(p_user_id text, p_mutation jsonb, p_ordered_ids uuid[])`, `create_or_reuse_personal_todo_label_and_attach(...)`, `update_personal_todo_label(...)`.
- Produces tables/columns: `personal_todos.status`, `priority`, `pinned`, `label_ids`; `personal_todo_labels`.

- [ ] **Step 1: Write the failing SQL contract test**

```ts
test('migration contains status compatibility and ownership checks', () => {
  const sql = readFileSync('DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql', 'utf8');
  assert.match(sql, /status\s+text\s+not null\s+default\s+'todo'/i);
  assert.match(sql, /completed\s*=\s*\(new\.status\s*=\s*'done'\)/i);
  assert.match(sql, /array_agg\([^)]*order by ord/i);
  assert.match(sql, /personal_todo_labels/i);
  assert.match(sql, /id\s*=\s*p_todo_id[\s\S]*user_id\s*=\s*p_user_id/i);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test ./tests/personalTodoDatabaseContract.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Write the idempotent migration**

```sql
ALTER TABLE public.personal_todos
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS label_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.personal_todos DROP CONSTRAINT IF EXISTS personal_todos_status_check;
ALTER TABLE public.personal_todos ADD CONSTRAINT personal_todos_status_check CHECK (status IN ('todo','doing','done'));
ALTER TABLE public.personal_todos DROP CONSTRAINT IF EXISTS personal_todos_priority_check;
ALTER TABLE public.personal_todos ADD CONSTRAINT personal_todos_priority_check CHECK (priority IN ('high','medium','low','none'));
```

The trigger must support old clients that only change `completed`, prefer `status` when both fields change, and set `completed = (status = 'done')`. The order RPC must validate uniqueness and ownership of ordered IDs, apply add/delete/pin/status/reorder mutation, then reindex the complete server row set. The label table must use `ON DELETE CASCADE`, a normalized unique user/name index, RLS enabled with the existing internal-tool `allow_all` policy, and explicit anon/authenticated SELECT/INSERT/UPDATE grants; no label DELETE grant is added.

- [ ] **Step 4: Run SQL contract test to verify GREEN**

Run: `node --test ./tests/personalTodoDatabaseContract.test.ts`

Expected: PASS and the two stored delete-user RPC definitions still remove users without direct label deletion because FK cascade owns cleanup.

- [ ] **Step 5: Commit**

```powershell
git add DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql DEVLOG/migrations/2026-04-30_delete_user_cascade_rpc.sql DEVLOG/migrations/2026-06-29-character-board-asset-workflow.sql tests/personalTodoDatabaseContract.test.ts
git commit -m "개인 할일 호환 마이그레이션과 원자적 저장 RPC 추가"
```

---

### Task 3: Main-owned session, queue, IPC, and calendar safety

**Files:**
- Create: `electron/sessionManager.ts`
- Create: `electron/personalTodoService.ts`
- Create: `electron/personalTodoRecoveryJournal.ts`
- Create: `electron/personalTodoCalendarSync.ts`
- Modify: `electron/supabase.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/index.ts`
- Modify: `src/services/supabaseService.ts`
- Modify: `src/views/ScheduleView.tsx`
- Create: `tests/personalTodoDataWiring.test.ts`

**Interfaces:**
- Consumes: Task 2 RPCs.
- Produces renderer bridge: `ensureCanonicalSession()`, `readPersonalTodos()`, `readPersonalTodoLabels()`, `createPersonalTodo(input)`, `patchPersonalTodo(id, patch)`, `applyCalendarToTodoPatch(id, patch)`, `mutatePersonalTodoOrder(mutation, orderedIds)`, `deletePersonalTodo(id)`, `createOrReusePersonalTodoLabelAndAttach(input)`, `updatePersonalTodoLabel(id, patch)`, `onPersonalTodoCommit(callback)`.
- Public todo, label, and legacy task-view methods must not accept `userId`.

- [ ] **Step 1: Write the failing data wiring tests**

```ts
test('renderer bridge does not accept user ownership input', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  assert.doesNotMatch(preload, /supabaseReadTodos:\s*\(userId/);
  assert.doesNotMatch(preload, /supabaseUpsertTodo/);
  assert.match(preload, /patchPersonalTodo:\s*\(todoId[^,]*,\s*patch/);
});

test('calendar reverse sync uses an allowlisted DB-only patch', () => {
  const source = readFileSync('src/views/ScheduleView.tsx', 'utf8');
  assert.match(source, /applyCalendarToTodoPatch/);
  assert.doesNotMatch(source, /readTodos\([\s\S]{0,900}upsertTodo/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test ./tests/personalTodoDataWiring.test.ts`

Expected: FAIL because the preload exposes user-scoped whole-object APIs and ScheduleView performs read-modify-upsert.

- [ ] **Step 3: Implement the main-owned API**

```ts
export type PersonalTodoPatch = Partial<Pick<PersonalTodo,
  'title' | 'memo' | 'startDate' | 'endDate' | 'addToCalendar' | 'priority' | 'labelIds' | 'status'
>>;

export type CalendarTodoPatch = Partial<Pick<PersonalTodo,
  'title' | 'memo' | 'startDate' | 'endDate' | 'addToCalendar'
>>;
```

`personalTodoService` captures canonical user ID when the IPC handler starts and serializes all DB intents per user. `sessionManager` verifies login/restore in main, drains that user's DB queue and persists calendar journal state before canonical transition, then broadcasts a password-free session. `personalTodoCalendarSync` uses `bflow_linked_todo_id` as the idempotency key, runs separate `(userId,todoId)` workers, applies a 5-second attempt timeout, and records `received/prepared/db_committed/calendar_unknown/compensating/aborted` phases in an atomic JSON journal. `before-quit` rejects new intents with `APP_QUITTING`, waits for dynamic pending operations within the existing deadline, and leaves unresolved calendar entries for startup recovery.

- [ ] **Step 4: Run wiring tests to verify GREEN**

Run: `node --test ./tests/personalTodoDataWiring.test.ts`

Expected: PASS, with no renderer-provided `userId`, no public whole-object todo upsert, and calendar reverse sync changing only the five allowed fields.

- [ ] **Step 5: Typecheck Electron and renderer contracts**

Run: `npm run typecheck`

Expected: PASS with the same signatures in `preload.ts`, `src/types/index.ts`, and `supabaseService.ts`.

- [ ] **Step 6: Commit**

```powershell
git add electron/sessionManager.ts electron/personalTodoService.ts electron/personalTodoRecoveryJournal.ts electron/personalTodoCalendarSync.ts electron/supabase.ts electron/main.ts electron/preload.ts src/types/index.ts src/services/supabaseService.ts src/views/ScheduleView.tsx tests/personalTodoDataWiring.test.ts
git commit -m "개인 할일 저장 큐와 세션 기반 캘린더 동기화 추가"
```

---

### Task 4: Renderer personal todo state and preview parity

**Files:**
- Create: `src/components/widgets/my-tasks/hooks/usePersonalTodos.ts`
- Create: `src/components/widgets/my-tasks/personalTodoMigration.ts`
- Modify: `src/components/widgets/my-tasks/hooks/useMyTasksData.ts`
- Create: `src/mocks/personalTodoPreviewStore.ts`
- Modify: `src/mocks/devElectronAPI.ts`
- Create: `tests/personalTodoPreview.test.ts`
- Modify: `tests/devPreviewElectronApi.test.ts`

**Interfaces:**
- Consumes: Task 1 domain API and Task 3 bridge.
- Produces: `usePersonalTodos()` with arrays `todos`, `labels`, `pinnedTodos`, `normalTodos`, `doneTodos` and actions `addTodo`, `patchTodo`, `setStatus`, `setPinned`, `reorderGroup`, `deleteTodo`, `createAndAttachLabel`, `updateLabel`, `retrySync`.

- [ ] **Step 1: Write failing preview and hook wiring tests**

```ts
test('preview storage is isolated by canonical user and shared by windows', () => {
  const alice = createPersonalTodoPreviewStore(memoryStorage, 'alice');
  const bob = createPersonalTodoPreviewStore(memoryStorage, 'bob');
  alice.replaceTodos([createPersonalTodo({ id: 'a', title: 'Alice' })]);
  assert.equal(alice.readTodos().length, 1);
  assert.equal(bob.readTodos().length, 0);
});

test('personal todo hook keeps a confirmed baseline and session epoch', () => {
  const source = readFileSync('src/components/widgets/my-tasks/hooks/usePersonalTodos.ts', 'utf8');
  assert.match(source, /confirmed.*Baseline/i);
  assert.match(source, /sessionEpoch/);
  assert.match(source, /ensureCanonicalSession/);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test ./tests/personalTodoPreview.test.ts ./tests/devPreviewElectronApi.test.ts`

Expected: FAIL because the preview store and hook do not exist.

- [ ] **Step 3: Implement confirmed-baseline optimistic state**

```ts
interface PersonalTodoMutationState {
  confirmedTodos: PersonalTodo[];
  confirmedLabels: PersonalTodoLabel[];
  pendingTodoIds: Set<string>;
  pendingLabelIds: Set<string>;
  orderSyncNeeded: boolean;
  sessionEpoch: number;
}
```

Each action must update UI first, enqueue one bridge intent, then replace baseline from the canonical response. Definite failures restore the latest confirmed baseline; unknown outcomes retry once and perform an authoritative read before either accepting canonical state or marking `sync-needed`. Broadcasts update confirmed baseline while preserving local pending display. Session change increments the epoch, clears all caches/pending maps, and ignores stale responses. Legacy local/task-view migration normalizes rows once without dropping dates or calendar links.

The preview store uses canonical-user-scoped localStorage keys and BroadcastChannel, supplies deterministic seed/reset helpers, restores remembered session, preserves logged-out data, and implements the same label/status/order methods as preload.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test ./tests/personalTodoPreview.test.ts ./tests/devPreviewElectronApi.test.ts ./tests/personalTodoDomain.test.ts`

Expected: PASS for user isolation, cross-window sharing, session restore, deterministic reset, logout retention, and epoch/baseline wiring.

- [ ] **Step 5: Commit**

```powershell
git add src/components/widgets/my-tasks/hooks/usePersonalTodos.ts src/components/widgets/my-tasks/personalTodoMigration.ts src/components/widgets/my-tasks/hooks/useMyTasksData.ts src/mocks/personalTodoPreviewStore.ts src/mocks/devElectronAPI.ts tests/personalTodoPreview.test.ts tests/devPreviewElectronApi.test.ts
git commit -m "개인 할일 낙관적 상태와 테스트 모드 저장소 추가"
```

---

### Task 5: Row, card, pinned section, and status actions

**Files:**
- Create: `src/components/widgets/my-tasks/components/TodoMetadata.tsx`
- Create: `src/components/widgets/my-tasks/components/TodoStatusAction.tsx`
- Create: `src/components/widgets/my-tasks/components/PinnedTodoSection.tsx`
- Create: `src/components/widgets/my-tasks/components/TodoCard.tsx`
- Modify: `src/components/widgets/my-tasks/components/TodoRow.tsx`
- Modify: `src/components/widgets/my-tasks/components/SceneCard.tsx`
- Modify: `src/components/widgets/MyTasksWidget.tsx`
- Create: `tests/personalTodoUiWiring.test.ts`

**Interfaces:**
- Consumes: Task 1 presentation helpers and Task 4 hook actions.
- Produces shared props: `todo`, `resolvedLabels`, `syncState`, `onOpen`, `onNextStatus`, `onDelete`, and list-only `dragControls`.

- [ ] **Step 1: Write failing UI wiring tests**

```ts
test('pinned personal section renders before scene and character work', () => {
  const source = readFileSync('src/components/widgets/MyTasksWidget.tsx', 'utf8');
  assert.ok(source.indexOf('<PinnedTodoSection') < source.indexOf('sceneTodos.map'));
});

test('list drag starts only from the handle', () => {
  const source = readFileSync('src/components/widgets/my-tasks/components/TodoRow.tsx', 'utf8');
  assert.match(source, /dragListener=\{false\}/);
  assert.match(source, /dragControls\.start/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test ./tests/personalTodoUiWiring.test.ts`

Expected: FAIL because the pinned section and handle-only drag are absent.

- [ ] **Step 3: Implement shared personal todo presentation**

```tsx
<TodoStatusAction
  status={todo.status}
  disabled={syncState === 'pending' || syncState === 'sync-needed'}
  onAction={() => onNextStatus(todo.id, getTodoNextAction(todo.status).targetStatus)}
/>
```

`TodoRow` and `TodoCard` must show the priority line, resolved label summary, textual current state, next-action button, and amber retry affordance. Remove `::개인`. Keep title/memo click opening detail. Split pinned and normal list `Reorder.Group`s and set `dragListener={false}` so only the handle calls `dragControls.start(event)`. Group moves happen only through pin/status actions. Scene and character components receive no personal metadata controls.

- [ ] **Step 4: Run UI wiring tests to verify GREEN**

Run: `node --test ./tests/personalTodoUiWiring.test.ts`

Expected: PASS for personal-only controls, pinned-first ordering, separate groups, handle-only drag, next-action button, and selected todo lookup from the full todo list.

- [ ] **Step 5: Commit**

```powershell
git add src/components/widgets/my-tasks/components/TodoMetadata.tsx src/components/widgets/my-tasks/components/TodoStatusAction.tsx src/components/widgets/my-tasks/components/PinnedTodoSection.tsx src/components/widgets/my-tasks/components/TodoCard.tsx src/components/widgets/my-tasks/components/TodoRow.tsx src/components/widgets/my-tasks/components/SceneCard.tsx src/components/widgets/MyTasksWidget.tsx tests/personalTodoUiWiring.test.ts
git commit -m "개인 할일 고정 패널과 상태 진행 버튼 추가"
```

---

### Task 6: Detail modal, label picker, responsive memo, and accessibility

**Files:**
- Create: `src/components/widgets/my-tasks/components/TodoLabelPicker.tsx`
- Modify: `src/components/widgets/my-tasks/components/TodoDetailModal.tsx`
- Modify: `src/components/common/EntityAwareInput.tsx`
- Modify: `src/components/common/ModalPortal.tsx`
- Modify: `src/components/widgets/MyTasksWidget.tsx`
- Modify: `tests/personalTodoUiWiring.test.ts`

**Interfaces:**
- Consumes: Task 4 immediate property actions and label pending state.
- Produces: nested picker Escape behavior and optional `autoGrowMinRows`, `autoGrowMaxRows`, `autoGrowMaxContainerRatio` input props.

- [ ] **Step 1: Extend failing UI tests**

```ts
test('detail modal exposes personal properties and bounded auto-grow memo', () => {
  const modal = readFileSync('src/components/widgets/my-tasks/components/TodoDetailModal.tsx', 'utf8');
  assert.match(modal, /상단 고정/);
  assert.match(modal, /할 일/);
  assert.match(modal, /진행 중/);
  assert.match(modal, /완료/);
  assert.match(modal, /autoGrowMaxRows=\{10\}/);
  assert.match(modal, /autoGrowMaxContainerRatio=\{0\.4\}/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test ./tests/personalTodoUiWiring.test.ts`

Expected: FAIL because the detail property toolbar, label picker, and bounded memo props are absent.

- [ ] **Step 3: Implement modal property editing**

```tsx
<EntityAwareInput
  value={memo}
  onChange={setMemo}
  autoGrow
  autoGrowMinRows={3}
  autoGrowMaxRows={10}
  autoGrowMaxContainerRatio={0.4}
  enableHashtags={false}
/>
```

Keep title/memo local until blur. Apply pin/status/priority/label selection immediately. The label picker trims names, enforces 1–24 characters, prevents case-insensitive duplicates, supports the eight palette keys, sorts selected labels first and others by normalized name/creation/id, keeps new-label pending intent in the hook, and disables removal until canonical UUID arrives. Escape closes the picker first and only a second Escape closes the modal. Every control uses semantic button/select elements, focus rings, `aria-label`, `aria-pressed`, visible state text, viewport-constrained picker height, and a modal-internal focus target after list group movement.

- [ ] **Step 4: Run UI tests and typecheck**

Run: `node --test ./tests/personalTodoUiWiring.test.ts && npm run typecheck`

Expected: PASS. Existing `EntityAwareInput autoGrow` calls remain unbounded unless new max props are provided.

- [ ] **Step 5: Commit**

```powershell
git add src/components/widgets/my-tasks/components/TodoLabelPicker.tsx src/components/widgets/my-tasks/components/TodoDetailModal.tsx src/components/common/EntityAwareInput.tsx src/components/common/ModalPortal.tsx src/components/widgets/MyTasksWidget.tsx tests/personalTodoUiWiring.test.ts
git commit -m "개인 할일 상세 속성과 반응형 메모 편집 추가"
```

---

### Task 7: Responsive widget integration, navigation, and release metadata

**Files:**
- Modify: `src/components/widgets/MyTasksWidget.tsx`
- Modify: `src/index.css`
- Modify: `src/components/widgets/my-tasks/statsUtils.ts`
- Modify: `tests/personalTodoUiWiring.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DEVLOG/update-notes.json`

**Interfaces:**
- Consumes all prior tasks.
- Produces the integrated dashboard/popup list/card experience and release version `1.78.0`.

- [ ] **Step 1: Add failing integration assertions**

```ts
test('widget keeps add visible and reveals completed calendar targets', () => {
  const source = readFileSync('src/components/widgets/MyTasksWidget.tsx', 'utf8');
  assert.match(source, /aria-label=["']개인 할일 추가["']/);
  assert.match(source, /setShowDone\(true\)/);
  assert.match(source, /setFilterDone\(false\)/);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `node --test ./tests/personalTodoUiWiring.test.ts`

Expected: FAIL until the visible add control, responsive label rules, and completed-target expansion are wired.

- [ ] **Step 3: Complete integration and release notes**

```json
{
  "version": "1.78.0",
  "title": "내 할일을 나만의 투두리스트처럼 관리해요",
  "items": [
    { "category": "feature", "summary": "중요한 개인 할일을 위에 고정해요", "description": "자주 확인해야 하는 개인 할일을 '나의 고정' 영역에 따로 모아둘 수 있어요. 담당 씬이나 캐릭터 작업은 기존 방식 그대로 유지돼요." },
    { "category": "feature", "summary": "레이블과 우선순위로 할일을 구분해요", "description": "개인 할일에 색상 레이블을 여러 개 붙이고, 높음·보통·낮음 우선순위를 표시해 필요한 일을 더 빠르게 찾을 수 있어요." },
    { "category": "feature", "summary": "시작하기부터 완료까지 버튼으로 진행해요", "description": "할 일을 '시작하기', 진행 중인 일을 '완료하기', 끝낸 일을 '다시 열기' 버튼으로 바로 바꿀 수 있어요." },
    { "category": "ux", "summary": "할일 추가와 긴 메모 작성이 더 편해졌어요", "description": "위젯의 추가 버튼이 항상 잘 보이고, 상세 창의 메모 칸은 작성한 줄 수에 맞춰 자연스럽게 커져요." }
  ]
}
```

The header `+` remains in place but becomes an always-visible accent button with a minimum 32px hit target. Container queries show two labels at 340px+, one below 340px, hide memo preview below 340px, and preserve action-button minimum width. Calendar navigation to a done todo disables completed filtering, expands the done section, then scrolls/highlights. Update `test:entity` to include all five new tests and align all package version fields to `1.78.0`.

- [ ] **Step 4: Run the integrated development verification**

Run: `npm run typecheck; npm run test:entity; npm run test:auto-update; npm run build:vite`

Expected: every command exits 0, update notes validate, and Vite produces the development bundle.

- [ ] **Step 5: Commit**

```powershell
git add src/components/widgets/MyTasksWidget.tsx src/index.css src/components/widgets/my-tasks/statsUtils.ts tests/personalTodoUiWiring.test.ts package.json package-lock.json DEVLOG/update-notes.json
git commit -m "개인 할일 반응형 UI와 1.78.0 릴리스 정보 반영"
```

---

### Task 8: Browser preview, database migration, and compatibility smoke test

**Files:**
- Modify only if preview or smoke test exposes a defect in the files covered by Tasks 1–7.

**Interfaces:**
- Consumes: built preview, Task 2 migration, Supabase project `mpqifkpxalwxgcrddchv`.
- Produces: verified UI and live schema ready before app deployment.

- [ ] **Step 1: Preview the actual local app**

Run: existing localhost preview, log in with preview account `배한솔` / `1234`, then inspect dashboard and popup at wide and narrow widget widths.

Expected: the existing visual language is preserved; `나의 고정` appears only for personal todos; start/complete/reopen moves items correctly; two labels collapse to one at narrow width; the add button remains visible; detail memo grows from 3 to 10 lines and scrolls; Escape closes picker before modal; scene/character rows have no new controls.

- [ ] **Step 2: Apply the reviewed migration before the app release**

Use the Supabase migration API with project `mpqifkpxalwxgcrddchv`, migration name `personal_todo_personalization_2026_07_11`, and the exact contents of `DEVLOG/migrations/2026-07-11-personal-todo-personalization.sql`.

Expected: migration succeeds once and appears in the project migration list.

- [ ] **Step 3: Run live compatibility smoke tests**

Use read-only SQL after scoped insert/update/delete calls to verify:

```sql
-- old-client insert/update behavior
insert into public.personal_todos (user_id, title, completed, sort_order)
values (:test_user_id, '__codex_personal_todo_compat__', true, 2147483000)
returning id, status, completed;

update public.personal_todos
set completed = false
where id = :test_todo_id and user_id = :test_user_id
returning status, completed;
```

Expected: insert returns `done/true`, old-client reopen returns `todo/false`, new status writes keep `completed` synchronized, label ownership checks reject foreign IDs, order RPC returns a complete unique ordered set, and test rows/labels are removed. Run Supabase security/performance advisors and record only new findings attributable to this migration.

- [ ] **Step 4: Re-run focused verification after live smoke**

Run: `npm run typecheck; node --test ./tests/personalTodoDomain.test.ts ./tests/personalTodoDatabaseContract.test.ts ./tests/personalTodoDataWiring.test.ts ./tests/personalTodoUiWiring.test.ts ./tests/personalTodoPreview.test.ts; npm run build:vite`

Expected: all commands exit 0 after the live contract is confirmed.

- [ ] **Step 5: Commit preview/smoke fixes only if any were required**

```powershell
git add <exact-files-changed-by-the-fix>
git commit -m "개인 할일 프리뷰와 실DB 호환성 보완"
```

If no fix was needed, do not create an empty commit.

---

### Task 9: PR, Codex review loop, merge, production build, and manifest-last deployment

**Files:**
- No source file changes unless the review loop finds an actionable issue.

**Interfaces:**
- Consumes: complete verified feature branch and live-compatible database.
- Produces: merged PR and deployed `1.78.0` artifacts.

- [ ] **Step 1: Push and create the PR**

Run: `git push -u origin codex/my-tasks-personalization`, then create a ready PR titled `[v1.78.0] 개인 할일 고정·레이블·상태 관리 추가` with sections `📋 업데이트 요약`, `🔧 상세 기술 설명`, `🚧 개발 난항`, `✅ 테스트 가이드`.

Expected: PR URL is created against `main`, with non-developer update notes first and exact test evidence in the guide.

- [ ] **Step 2: Complete the Codex review loop**

Trigger `@codex review` and poll issue comments, inline comments, reviews, and trigger reactions. Fix all actionable P1/P2/P3 findings with tests, commit in Korean, push, and trigger a new review.

Expected: explicit success such as `Didn't find any major issues`, an APPROVED review, or a positive completed-review reaction; silence alone is not success.

- [ ] **Step 3: Merge and update the deployment checkout**

Run: merge the approved PR, then `git switch main; git pull --ff-only origin main` in `C:\Bflow-BGonly`.

Expected: local `main` equals merged `origin/main` and tracked worktree is clean.

- [ ] **Step 4: Build the production release**

Run: `npm run build`

Expected: exit 0; `dist/BFLOW-Setup.exe`, `dist/latest.yml`, and `dist/manifest.json` exist and all report `1.78.0`.

- [ ] **Step 5: Deploy files before manifest**

```powershell
$src = 'C:\Bflow-BGonly\dist'
$dst = 'G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist'
& robocopy $src $dst /MIR /XF manifest.json /R:3 /W:5 /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
Copy-Item -LiteralPath (Join-Path $src 'manifest.json') -Destination (Join-Path $dst 'manifest.json') -Force
```

Expected: all payload files finish first and only then is remote manifest replaced.

- [ ] **Step 6: Verify deployed version and hashes**

```powershell
$files = 'BFLOW-Setup.exe','latest.yml','manifest.json'
$results = $files | ForEach-Object {
  $local = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $src $_)).Hash
  $remote = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dst $_)).Hash
  [pscustomobject]@{ File = $_; Match = $local -eq $remote; Local = $local; Remote = $remote }
}
if (($results | Where-Object { -not $_.Match }).Count -gt 0) { throw 'deployed artifact hash mismatch' }
$results
```

Expected: remote manifest and latest version are `1.78.0`, and SHA-256 matches for all three core artifacts.

---

## Self-Review Record

- Spec coverage: personal-only pin, pinned-first layout, multi-label display and editing, priority display, three statuses and next action, responsive memo, visible add, accessibility, narrow popup behavior, completed navigation, optimistic rollback, cross-window/session safety, calendar allowlist, preview parity, database compatibility, PR/review/deploy are each assigned to Tasks 1–9.
- Placeholder scan: no deferred implementation phrases are used; every task names exact files, commands, interfaces, failure expectation, implementation contract, pass expectation, and commit boundary.
- Type consistency: `PersonalTodo.status`, `priority`, `pinned`, `labelIds` flow from Task 1 through SQL mappers, bridge DTOs, hook state, UI props, preview storage, and tests with the same names and enum values.
