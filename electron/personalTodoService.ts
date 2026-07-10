export type PersonalTodoStatus = 'todo' | 'doing' | 'done';
export type PersonalTodoPriority = 'high' | 'medium' | 'low' | 'none';
export type PersonalTodoLabelColorKey = 'violet' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'gray';

export interface PersonalTodoRecord {
  id: string;
  userId: string;
  title: string;
  memo: string;
  status: PersonalTodoStatus;
  completed: boolean;
  priority: PersonalTodoPriority;
  pinned: boolean;
  labelIds: string[];
  startDate: string | null;
  endDate: string | null;
  addToCalendar: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalTodoLabelRecord {
  id: string;
  name: string;
  colorKey: PersonalTodoLabelColorKey;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalTodoCreateInput {
  id: string;
  title: string;
  memo?: string;
  status?: PersonalTodoStatus;
  priority?: PersonalTodoPriority;
  pinned?: boolean;
  labelIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  addToCalendar?: boolean;
}

export interface PersonalTodoPatch {
  title?: string;
  memo?: string;
  startDate?: string | null;
  endDate?: string | null;
  addToCalendar?: boolean;
  priority?: PersonalTodoPriority;
  labelIds?: string[];
  status?: PersonalTodoStatus;
}

export type CalendarTodoPatch = Pick<PersonalTodoPatch,
  'title' | 'memo' | 'startDate' | 'endDate' | 'addToCalendar'>;

export type PersonalTodoOrderMutation =
  | { type: 'reorder' }
  | { type: 'pin' | 'setPinned'; todoId: string; pinned: boolean }
  | { type: 'status' | 'setStatusAndOrder'; todoId: string; status: PersonalTodoStatus };

export type PersonalTodoFailureKind = 'rejected' | 'unknown' | 'stale' | 'quitting';
export type PersonalTodoApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: PersonalTodoFailureKind; code: string; message: string; retryable: boolean };

export interface PersonalTodoCommitPayload {
  userId: string;
  kind: 'todo' | 'todos' | 'label' | 'label-attach' | 'task-views';
  todo?: PersonalTodoRecord | null;
  todos?: PersonalTodoRecord[];
  label?: PersonalTodoLabelRecord;
}

export interface PersonalTodoPersistence {
  readTodos(userId: string): Promise<PersonalTodoRecord[]>;
  readTodo(userId: string, todoId: string): Promise<PersonalTodoRecord | null>;
  readLabels(userId: string): Promise<PersonalTodoLabelRecord[]>;
  patchTodo(userId: string, todoId: string, patch: PersonalTodoPatch): Promise<PersonalTodoRecord>;
  mutateOrder(userId: string, mutation: Record<string, unknown>, orderedIds: string[]): Promise<PersonalTodoRecord[]>;
  createOrReuseLabelAndAttach(userId: string, input: { todoId: string; name: string; colorKey: PersonalTodoLabelColorKey }): Promise<{ label: PersonalTodoLabelRecord; todo: PersonalTodoRecord | null }>;
  updateLabel(userId: string, labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabelColorKey }): Promise<PersonalTodoLabelRecord>;
  readTaskViews(userId: string): Promise<{ views: unknown[]; assignedSceneKeys: unknown[] } | null>;
  upsertTaskViews(userId: string, views: unknown[], assignedSceneKeys: unknown[]): Promise<void>;
}

export interface PersonalTodoCalendarCoordinator {
  receive(userId: string, todoId: string, patch: PersonalTodoPatch): Promise<{ operationId: string }>;
  receiveDeletion(userId: string, todoId: string): Promise<{ operationId: string }>;
  markPrepared(operationId: string, previousCanonical: PersonalTodoRecord | null): Promise<void>;
  markDbCommitted(operationId: string, canonical: PersonalTodoRecord): Promise<void>;
  markDbDeleted(operationId: string, previousCanonical: PersonalTodoRecord): Promise<void>;
  markAborted(operationId: string): Promise<void>;
  flushJournal(): Promise<void>;
}

export interface PersonalTodoServiceDependencies {
  persistence: PersonalTodoPersistence;
  getCanonicalSession(): { userId: string | null; epoch: number };
  calendar?: PersonalTodoCalendarCoordinator;
  onCommit?(payload: PersonalTodoCommitPayload): void;
}

export class DynamicPendingTracker {
  private readonly pending = new Set<Promise<unknown>>();
  private revision = 0;
  private waiters = new Set<() => void>();

  get pendingCount(): number { return this.pending.size; }

  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    this.revision += 1;
    this.notify();
    promise.finally(() => {
      this.pending.delete(promise);
      this.revision += 1;
      this.notify();
    }).catch(() => { /* the caller observes the original promise */ });
    return promise;
  }

  private notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0) {
      const observedRevision = this.revision;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(wake);
          resolve();
        }, remaining);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.add(wake);
      });
      if (Date.now() >= deadline && this.pending.size > 0) return false;
      if (observedRevision === this.revision && this.pending.size > 0) continue;
    }
    return true;
  }
}

export interface PersonalTodoMutationQueue {
  enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T>;
  drain(userId: string): Promise<void>;
  pendingUsers(): number;
}

export function createPersonalTodoMutationQueue(): PersonalTodoMutationQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(userId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(operation);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(userId, tail);
      tail.finally(() => {
        if (tails.get(userId) === tail) tails.delete(userId);
      });
      return result;
    },
    async drain(userId: string): Promise<void> {
      while (tails.has(userId)) await tails.get(userId);
    },
    pendingUsers: () => tails.size,
  };
}

const PERSONAL_PATCH_FIELDS = new Set(['title', 'memo', 'startDate', 'endDate', 'addToCalendar', 'priority', 'labelIds', 'status']);
const CALENDAR_PATCH_FIELDS = new Set(['title', 'memo', 'startDate', 'endDate', 'addToCalendar']);

function validatePatchObject<T extends Record<string, unknown>>(patch: T, fields: Set<string>): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Patch must be an object');
  for (const key of Object.keys(patch)) {
    if (!fields.has(key)) throw new Error(`Unsupported patch field: ${key}`);
    if (patch[key] === undefined) throw new Error(`Unsupported undefined patch value: ${key}`);
  }
  return { ...patch };
}

export function validatePersonalTodoPatch(patch: PersonalTodoPatch): PersonalTodoPatch {
  return validatePatchObject(patch as Record<string, unknown>, PERSONAL_PATCH_FIELDS) as PersonalTodoPatch;
}

export function validateCalendarTodoPatch(patch: CalendarTodoPatch): CalendarTodoPatch {
  return validatePatchObject(patch as Record<string, unknown>, CALENDAR_PATCH_FIELDS) as CalendarTodoPatch;
}

class PersonalTodoIntentError extends Error {
  readonly kind: PersonalTodoFailureKind;
  readonly code: string;
  constructor(kind: PersonalTodoFailureKind, code: string, message: string) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

function failureResult(error: unknown): PersonalTodoApiResult<never> {
  if (error instanceof PersonalTodoIntentError) {
    return { ok: false, kind: error.kind, code: error.code, message: error.message, retryable: error.kind !== 'rejected' };
  }
  const value = error as { code?: string; message?: string };
  const code = value?.code ?? 'UNKNOWN_OUTCOME';
  const message = value?.message ?? String(error);
  if (/ordered ids|stale|complete user todo set/i.test(message)) {
    return { ok: false, kind: 'stale', code: 'STALE_ORDER', message, retryable: true };
  }
  if (/^(22|23|42)|P0002/.test(code) || /unsupported|must not|not found|belongs to another|invalid/i.test(message)) {
    return { ok: false, kind: 'rejected', code, message, retryable: false };
  }
  return { ok: false, kind: 'unknown', code, message, retryable: true };
}

function groupRank(todo: Pick<PersonalTodoRecord, 'status' | 'pinned'>): number {
  if (todo.status === 'done') return 2;
  return todo.pinned ? 0 : 1;
}

function orderedIdsWithAdded(rows: PersonalTodoRecord[], input: PersonalTodoCreateInput): string[] {
  const targetRank = groupRank({ status: input.status ?? 'todo', pinned: input.pinned === true });
  const result: string[] = [];
  let inserted = false;
  for (const row of rows) {
    const rank = groupRank(row);
    if (!inserted && rank > targetRank) {
      result.push(input.id);
      inserted = true;
    }
    result.push(row.id);
  }
  if (!inserted) result.push(input.id);
  return result;
}

function normalizeOrderMutation(mutation: PersonalTodoOrderMutation): Record<string, unknown> {
  if (mutation.type === 'reorder') return { type: 'reorder' };
  if (mutation.type === 'pin' || mutation.type === 'setPinned') {
    return { type: 'pin', todo_id: mutation.todoId, pinned: mutation.pinned };
  }
  if ('status' in mutation) return { type: 'status', todo_id: mutation.todoId, status: mutation.status };
  throw new Error(`Unsupported order mutation: ${mutation.type}`);
}

export class PersonalTodoService {
  readonly pending = new DynamicPendingTracker();
  readonly queue = createPersonalTodoMutationQueue();
  private quitting = false;
  private readonly dependencies: PersonalTodoServiceDependencies;
  private readonly intakesByUser = new Map<string, Set<Promise<unknown>>>();

  constructor(dependencies: PersonalTodoServiceDependencies) { this.dependencies = dependencies; }

  beginQuitting(): void { this.quitting = true; }

  private capture(expectedEpoch?: number): { userId: string; epoch: number } {
    if (this.quitting) throw new PersonalTodoIntentError('quitting', 'APP_QUITTING', 'App is quitting');
    const session = this.dependencies.getCanonicalSession();
    if (!session.userId) throw new PersonalTodoIntentError('stale', 'NO_CANONICAL_SESSION', 'Canonical session is not ready');
    if (expectedEpoch !== undefined && expectedEpoch !== session.epoch) {
      throw new PersonalTodoIntentError('stale', 'STALE_SESSION', 'Renderer session is stale');
    }
    return { userId: session.userId, epoch: session.epoch };
  }

  private success<T>(data: T): PersonalTodoApiResult<T> { return { ok: true, data }; }

  private trackUserIntake<T>(userId: string, promise: Promise<T>): Promise<T> {
    const set = this.intakesByUser.get(userId) ?? new Set<Promise<unknown>>();
    set.add(promise);
    this.intakesByUser.set(userId, set);
    promise.finally(() => {
      set.delete(promise);
      if (set.size === 0 && this.intakesByUser.get(userId) === set) this.intakesByUser.delete(userId);
    }).catch(() => { /* caller observes the original promise */ });
    return this.pending.track(promise);
  }

  private read<T>(expectedEpoch: number | undefined, operation: (userId: string) => Promise<T>): Promise<PersonalTodoApiResult<T>> {
    let captured: { userId: string };
    try { captured = this.capture(expectedEpoch); } catch (error) { return Promise.resolve(failureResult(error)); }
    return operation(captured.userId).then((data) => this.success(data), failureResult);
  }

  private mutate<T>(expectedEpoch: number | undefined, operation: (userId: string) => Promise<T>): Promise<PersonalTodoApiResult<T>> {
    let captured: { userId: string };
    try { captured = this.capture(expectedEpoch); } catch (error) { return Promise.resolve(failureResult(error)); }
    const queued = this.queue.enqueue(captured.userId, () => operation(captured.userId));
    return this.pending.track(queued).then((data) => this.success(data), failureResult);
  }

  readTodos(expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord[]>> {
    return this.read(expectedEpoch, (userId) => this.dependencies.persistence.readTodos(userId));
  }

  readLabels(expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoLabelRecord[]>> {
    return this.read(expectedEpoch, (userId) => this.dependencies.persistence.readLabels(userId));
  }

  createTodo(input: PersonalTodoCreateInput, expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord[]>> {
    if (!input.id || !input.title?.trim()) return Promise.resolve(failureResult(new PersonalTodoIntentError('rejected', 'INVALID_INPUT', 'Todo id and title are required')));
    return this.mutate(expectedEpoch, async (userId) => {
      const rows = await this.dependencies.persistence.readTodos(userId);
      const mutation = {
        type: 'add',
        todo: {
          id: input.id,
          title: input.title,
          memo: input.memo ?? '',
          status: input.status ?? 'todo',
          priority: input.priority ?? 'none',
          pinned: input.pinned ?? false,
          labelIds: input.labelIds ?? [],
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          addToCalendar: input.addToCalendar ?? false,
        },
      };
      let operationId: string | null = null;
      if (this.dependencies.calendar && input.addToCalendar) {
        operationId = (await this.dependencies.calendar.receive(userId, input.id, mutation.todo)).operationId;
        await this.dependencies.calendar.markPrepared(operationId, null);
      }
      try {
        const canonical = await this.dependencies.persistence.mutateOrder(userId, mutation, orderedIdsWithAdded(rows, input));
        const created = canonical.find((todo) => todo.id === input.id);
        if (operationId && created) await this.dependencies.calendar!.markDbCommitted(operationId, created);
        this.dependencies.onCommit?.({ userId, kind: 'todos', todos: canonical });
        return canonical;
      } catch (error) {
        if (operationId) await this.dependencies.calendar!.markAborted(operationId);
        throw error;
      }
    });
  }

  patchTodo(todoId: string, patch: PersonalTodoPatch, expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord>> {
    let validated: PersonalTodoPatch;
    try { validated = validatePersonalTodoPatch(patch); } catch (error) { return Promise.resolve(failureResult(new PersonalTodoIntentError('rejected', 'INVALID_PATCH', String(error)))); }
    let captured: { userId: string };
    try { captured = this.capture(expectedEpoch); } catch (error) { return Promise.resolve(failureResult(error)); }
    const intake = (async () => {
      const operation = this.dependencies.calendar
        && Object.keys(validated).some((key) => CALENDAR_PATCH_FIELDS.has(key))
        ? await this.dependencies.calendar.receive(captured.userId, todoId, validated)
        : null;
      return this.queue.enqueue(captured.userId, async () => {
        try {
          const previous = operation ? await this.dependencies.persistence.readTodo(captured.userId, todoId) : null;
          if (operation) await this.dependencies.calendar!.markPrepared(operation.operationId, previous);
          const canonical = await this.dependencies.persistence.patchTodo(captured.userId, todoId, validated);
          if (operation) await this.dependencies.calendar!.markDbCommitted(operation.operationId, canonical);
          this.dependencies.onCommit?.({ userId: captured.userId, kind: 'todo', todo: canonical });
          return canonical;
        } catch (error) {
          if (operation) await this.dependencies.calendar!.markAborted(operation.operationId);
          throw error;
        }
      });
    })();
    return this.trackUserIntake(captured.userId, intake).then((data) => this.success(data), failureResult);
  }

  applyCalendarPatch(todoId: string, patch: CalendarTodoPatch, expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord>> {
    let validated: CalendarTodoPatch;
    try { validated = validateCalendarTodoPatch(patch); } catch (error) { return Promise.resolve(failureResult(new PersonalTodoIntentError('rejected', 'INVALID_CALENDAR_PATCH', String(error)))); }
    return this.mutate(expectedEpoch, async (userId) => {
      const canonical = await this.dependencies.persistence.patchTodo(userId, todoId, validated);
      this.dependencies.onCommit?.({ userId, kind: 'todo', todo: canonical });
      return canonical;
    });
  }

  mutateOrder(mutation: PersonalTodoOrderMutation, orderedIds: string[], expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord[]>> {
    return this.mutate(expectedEpoch, async (userId) => {
      const canonical = await this.dependencies.persistence.mutateOrder(userId, normalizeOrderMutation(mutation), [...orderedIds]);
      this.dependencies.onCommit?.({ userId, kind: 'todos', todos: canonical });
      return canonical;
    });
  }

  deleteTodo(todoId: string, expectedEpoch?: number): Promise<PersonalTodoApiResult<PersonalTodoRecord[]>> {
    let captured: { userId: string };
    try { captured = this.capture(expectedEpoch); } catch (error) { return Promise.resolve(failureResult(error)); }
    const intake = (async () => {
      const operation = this.dependencies.calendar
        ? await this.dependencies.calendar.receiveDeletion(captured.userId, todoId)
        : null;
      return this.queue.enqueue(captured.userId, async () => {
        const current = await this.dependencies.persistence.readTodos(captured.userId);
        const previous = current.find((todo) => todo.id === todoId) ?? null;
        try {
          if (operation) await this.dependencies.calendar!.markPrepared(operation.operationId, previous);
          const canonical = await this.dependencies.persistence.mutateOrder(
            captured.userId,
            { type: 'delete', todo_id: todoId },
            current.filter((todo) => todo.id !== todoId).map((todo) => todo.id),
          );
          if (operation && previous) await this.dependencies.calendar!.markDbDeleted(operation.operationId, previous);
          else if (operation) await this.dependencies.calendar!.markAborted(operation.operationId);
          this.dependencies.onCommit?.({ userId: captured.userId, kind: 'todos', todos: canonical });
          return canonical;
        } catch (error) {
          if (operation) await this.dependencies.calendar!.markAborted(operation.operationId);
          throw error;
        }
      });
    })();
    return this.trackUserIntake(captured.userId, intake).then((data) => this.success(data), failureResult);
  }

  createOrReuseLabelAndAttach(input: { todoId: string; name: string; colorKey: PersonalTodoLabelColorKey }, expectedEpoch?: number) {
    return this.mutate(expectedEpoch, async (userId) => {
      const result = await this.dependencies.persistence.createOrReuseLabelAndAttach(userId, input);
      this.dependencies.onCommit?.({ userId, kind: 'label-attach', label: result.label, todo: result.todo });
      return result;
    });
  }

  updateLabel(labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabelColorKey }, expectedEpoch?: number) {
    return this.mutate(expectedEpoch, async (userId) => {
      const label = await this.dependencies.persistence.updateLabel(userId, labelId, patch);
      this.dependencies.onCommit?.({ userId, kind: 'label', label });
      return label;
    });
  }

  readTaskViews(expectedEpoch?: number) {
    return this.read(expectedEpoch, (userId) => this.dependencies.persistence.readTaskViews(userId));
  }

  upsertTaskViews(views: unknown[], assignedSceneKeys: unknown[], expectedEpoch?: number) {
    return this.mutate(expectedEpoch, async (userId) => {
      await this.dependencies.persistence.upsertTaskViews(userId, views, assignedSceneKeys);
      this.dependencies.onCommit?.({ userId, kind: 'task-views' });
    });
  }

  async drainUser(userId: string): Promise<void> {
    while (true) {
      const intakes = this.intakesByUser.get(userId);
      if (intakes?.size) await Promise.allSettled([...intakes]);
      await this.queue.drain(userId);
      if (!this.intakesByUser.has(userId) && this.queue.pendingUsers() === 0) return;
      if (!this.intakesByUser.has(userId)) return;
    }
  }
  waitForIdle(timeoutMs: number): Promise<boolean> { return this.pending.waitForIdle(timeoutMs); }
  getPendingCount(): number { return this.pending.pendingCount; }
}
