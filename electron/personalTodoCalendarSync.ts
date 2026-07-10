import { createHash, randomUUID } from 'node:crypto';
import type { PersonalTodoRecord, PersonalTodoPatch } from './personalTodoService';
import type {
  PersonalTodoRecoveryEntry,
  PersonalTodoRecoveryPhase,
  PersonalTodoRecoveryJournal,
} from './personalTodoRecoveryJournal';

export const PERSONAL_TODO_GOOGLE_LINK_KEY = 'bflow_linked_todo_id';
export const PERSONAL_TODO_GOOGLE_USER_KEY = 'bflow_todo_user_id';
export const CALENDAR_ATTEMPT_TIMEOUT_MS = 5_000;
const CALENDAR_UNKNOWN = Symbol('calendar-unknown');

export interface LinkedPersonalTodoCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  memo: string;
  startDate: string;
  endDate: string;
}

export interface PersonalTodoCalendarAdapter {
  resolveTargetCalendarId(userId: string): Promise<string | null>;
  findLinkedEvents(userId: string, todoId: string, candidateCalendarIds: string[]): Promise<LinkedPersonalTodoCalendarEvent[]>;
  insertLinkedEvent(input: {
    calendarId: string;
    eventId: string;
    userId: string;
    todo: PersonalTodoRecord;
  }): Promise<LinkedPersonalTodoCalendarEvent>;
  updateLinkedEvent(event: LinkedPersonalTodoCalendarEvent, todo: PersonalTodoRecord, userId: string): Promise<LinkedPersonalTodoCalendarEvent>;
  deleteLinkedEvent(event: LinkedPersonalTodoCalendarEvent): Promise<void>;
}

export interface PersonalTodoCalendarSyncDependencies {
  journal: PersonalTodoRecoveryJournal;
  adapter: PersonalTodoCalendarAdapter;
  readTodo(userId: string, todoId: string): Promise<PersonalTodoRecord | null>;
  compensateTodo(
    userId: string,
    todoId: string,
    previousCanonical: Record<string, unknown>,
    expectedUpdatedAt: string,
  ): Promise<PersonalTodoRecord | null>;
  trackPending?<T>(promise: Promise<T>): Promise<T>;
  onCalendarCommit?(payload: {
    userId: string;
    todoId: string;
    action: 'upsert' | 'delete' | 'sync-needed';
    event?: LinkedPersonalTodoCalendarEvent;
  }): void;
}

export type CalendarAttemptOutcome<T> =
  | { status: 'committed'; value: T }
  | { status: 'unknown'; reason: 'timeout' | 'error'; error?: unknown };

export function deterministicGoogleEventId(todoId: string): string {
  // Google Calendar accepts base32hex characters a-v and 0-9. A hex digest is
  // a strict subset and gives us a stable response-loss retry idempotency key.
  return `bf10${createHash('sha256').update(todoId).digest('hex')}`;
}

export function withCalendarAttemptTimeout<T>(
  promise: Promise<T>,
  timeoutMs = CALENDAR_ATTEMPT_TIMEOUT_MS,
): Promise<CalendarAttemptOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: CalendarAttemptOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ status: 'unknown', reason: 'timeout' }), timeoutMs);
    promise.then(
      (value) => finish({ status: 'committed', value }),
      (error) => finish({ status: 'unknown', reason: 'error', error }),
    );
  });
}

function calendarWorkerKey(userId: string, todoId: string): string {
  return `${userId}\u0000${todoId}`;
}

function desiredCalendarPatch(patch: PersonalTodoPatch): Record<string, unknown> {
  const allowed = ['title', 'memo', 'startDate', 'endDate', 'addToCalendar'] as const;
  return Object.fromEntries(
    allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]]),
  );
}

function todoMatchesPatch(todo: PersonalTodoRecord, patch: Record<string, unknown>): boolean {
  return Object.entries(patch).every(([key, value]) => (todo as unknown as Record<string, unknown>)[key] === value);
}

function eventMatchesTodo(event: LinkedPersonalTodoCalendarEvent, todo: PersonalTodoRecord): boolean {
  return event.title === todo.title
    && event.memo === todo.memo
    && event.startDate === (todo.startDate ?? todo.endDate ?? '')
    && event.endDate === (todo.endDate ?? todo.startDate ?? '');
}

export class PersonalTodoCalendarSync {
  private readonly workerTails = new Map<string, Promise<void>>();
  private readonly dependencies: PersonalTodoCalendarSyncDependencies;

  constructor(dependencies: PersonalTodoCalendarSyncDependencies) { this.dependencies = dependencies; }

  receive(userId: string, todoId: string, patch: PersonalTodoPatch): Promise<PersonalTodoRecoveryEntry> {
    const now = new Date().toISOString();
    const entry: PersonalTodoRecoveryEntry = {
      operationId: randomUUID(),
      userId,
      todoId,
      desiredPatch: desiredCalendarPatch(patch),
      targetCalendarId: null,
      candidateSourceCalendarIds: [],
      deterministicEventId: deterministicGoogleEventId(todoId),
      phase: 'received',
      previousCanonical: null,
      dbCommittedUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.dependencies.journal.upsert(entry).then(() => entry);
  }

  receiveDeletion(userId: string, todoId: string): Promise<PersonalTodoRecoveryEntry> {
    return this.receive(userId, todoId, { addToCalendar: false }).then(async (entry) => {
      const desiredPatch = { ...entry.desiredPatch, __deleted: true };
      await this.dependencies.journal.upsert({ ...entry, desiredPatch });
      return { ...entry, desiredPatch };
    });
  }

  markPrepared(operationId: string, previousCanonical: PersonalTodoRecord | null): Promise<void> {
    return this.dependencies.journal.updatePhase(operationId, 'prepared', {
      previousCanonical: previousCanonical ? { ...previousCanonical } : null,
    });
  }

  async markDbCommitted(operationId: string, canonical: PersonalTodoRecord): Promise<void> {
    await this.dependencies.journal.updatePhase(operationId, 'db_committed', {
      dbCommittedUpdatedAt: canonical.updatedAt,
    });
    void this.enqueue(operationId).catch(() => { /* journal preserves the unresolved intent */ });
  }

  async markDbDeleted(operationId: string, previousCanonical: PersonalTodoRecord): Promise<void> {
    await this.dependencies.journal.updatePhase(operationId, 'db_committed', {
      dbCommittedUpdatedAt: previousCanonical.updatedAt,
    });
    void this.enqueue(operationId).catch(() => { /* journal preserves the unresolved intent */ });
  }

  async markAborted(operationId: string): Promise<void> {
    await this.dependencies.journal.updatePhase(operationId, 'aborted');
    await this.dependencies.journal.remove(operationId);
  }

  private enqueue(operationId: string): Promise<void> {
    const scheduled = (async () => {
      const entry = await this.dependencies.journal.get(operationId);
      if (!entry) return;
      const key = calendarWorkerKey(entry.userId, entry.todoId);
      const previous = this.workerTails.get(key) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(() => this.reconcile(operationId));
      const tail = current.then(() => undefined, () => undefined);
      this.workerTails.set(key, tail);
      tail.finally(() => {
        if (this.workerTails.get(key) === tail) this.workerTails.delete(key);
      });
      await current;
    })();
    return this.dependencies.trackPending ? this.dependencies.trackPending(scheduled) : scheduled;
  }

  private async setUnknown(entry: PersonalTodoRecoveryEntry): Promise<void> {
    await this.dependencies.journal.updatePhase(entry.operationId, 'calendar_unknown');
    this.dependencies.onCalendarCommit?.({
      userId: entry.userId,
      todoId: entry.todoId,
      action: 'sync-needed',
    });
  }

  private async attempt<T>(entry: PersonalTodoRecoveryEntry, operation: Promise<T>): Promise<T | typeof CALENDAR_UNKNOWN> {
    const outcome = await withCalendarAttemptTimeout(operation);
    if (outcome.status === 'committed') return outcome.value;
    await this.setUnknown(entry);
    return CALENDAR_UNKNOWN;
  }

  private async compensate(entry: PersonalTodoRecoveryEntry): Promise<void> {
    if (!entry.previousCanonical || !entry.dbCommittedUpdatedAt) {
      await this.setUnknown(entry);
      return;
    }
    await this.dependencies.journal.updatePhase(entry.operationId, 'compensating');
    const compensated = await this.dependencies.compensateTodo(
      entry.userId,
      entry.todoId,
      entry.previousCanonical,
      entry.dbCommittedUpdatedAt,
    );
    if (!compensated) {
      await this.setUnknown(entry);
      return;
    }
    await this.dependencies.journal.remove(entry.operationId);
  }

  private async reconcile(operationId: string): Promise<void> {
    const entry = await this.dependencies.journal.get(operationId);
    if (!entry) return;
    if (entry.phase === 'aborted') {
      await this.dependencies.journal.remove(entry.operationId);
      return;
    }
    let todo = await this.dependencies.readTodo(entry.userId, entry.todoId);
    if (!todo && entry.desiredPatch.__deleted === true && entry.previousCanonical) {
      todo = { ...(entry.previousCanonical as unknown as PersonalTodoRecord), addToCalendar: false };
    } else if (!todo) {
      await this.compensate(entry);
      return;
    }

    let targetCalendarId = entry.targetCalendarId;
    if (!targetCalendarId) {
      const resolvedTarget = await this.attempt(entry, this.dependencies.adapter.resolveTargetCalendarId(entry.userId));
      if (resolvedTarget === CALENDAR_UNKNOWN) return;
      targetCalendarId = resolvedTarget;
      if (targetCalendarId === null) {
        if (todo.addToCalendar) await this.compensate(entry);
        else await this.dependencies.journal.remove(entry.operationId);
        return;
      }
      await this.dependencies.journal.updatePhase(entry.operationId, entry.phase, { targetCalendarId });
    }

    const candidateIds = [...new Set([targetCalendarId, ...entry.candidateSourceCalendarIds])];
    const events = await this.attempt(
      entry,
      this.dependencies.adapter.findLinkedEvents(entry.userId, entry.todoId, candidateIds),
    );
    if (events === CALENDAR_UNKNOWN) return;
    if (events.length > 1) {
      await this.setUnknown(entry);
      return;
    }

    const shouldExist = todo.addToCalendar && Boolean(todo.startDate || todo.endDate);
    if (!shouldExist) {
      if (events[0]) {
        const deleted = await this.attempt(entry, this.dependencies.adapter.deleteLinkedEvent(events[0]));
        if (deleted === CALENDAR_UNKNOWN) return;
      }
      await this.dependencies.journal.remove(entry.operationId);
      this.dependencies.onCalendarCommit?.({ userId: entry.userId, todoId: entry.todoId, action: 'delete' });
      return;
    }

    let canonicalEvent = events[0];
    if (!canonicalEvent) {
      const inserted = await this.attempt(entry, this.dependencies.adapter.insertLinkedEvent({
        calendarId: targetCalendarId,
        eventId: entry.deterministicEventId,
        userId: entry.userId,
        todo,
      }));
      canonicalEvent = inserted === CALENDAR_UNKNOWN ? undefined : inserted;
    } else if (!eventMatchesTodo(canonicalEvent, todo)) {
      const updated = await this.attempt(
        entry,
        this.dependencies.adapter.updateLinkedEvent(canonicalEvent, todo, entry.userId),
      );
      canonicalEvent = updated === CALENDAR_UNKNOWN ? undefined : updated;
    }
    if (!canonicalEvent) return;

    await this.dependencies.journal.remove(entry.operationId);
    this.dependencies.onCalendarCommit?.({
      userId: entry.userId,
      todoId: entry.todoId,
      action: 'upsert',
      event: canonicalEvent,
    });
  }

  async recover(userId: string): Promise<void> {
    const entries = (await this.dependencies.journal.read()).filter((entry) => entry.userId === userId);
    for (const entry of entries) {
      if (entry.phase === 'aborted') {
        await this.dependencies.journal.remove(entry.operationId);
        continue;
      }
      if (entry.phase === 'received' || entry.phase === 'prepared') {
        const current = await this.dependencies.readTodo(entry.userId, entry.todoId);
        if (!current && entry.desiredPatch.__deleted === true && entry.previousCanonical) {
          await this.dependencies.journal.updatePhase(entry.operationId, 'db_committed', {
            dbCommittedUpdatedAt: (entry.previousCanonical.updatedAt as string | undefined) ?? entry.updatedAt,
          });
        } else if (!current || !todoMatchesPatch(current, entry.desiredPatch)) {
          await this.dependencies.journal.updatePhase(entry.operationId, 'aborted');
          await this.dependencies.journal.remove(entry.operationId);
          continue;
        } else {
          await this.dependencies.journal.updatePhase(entry.operationId, 'db_committed', {
            dbCommittedUpdatedAt: current.updatedAt,
          });
        }
      }
      await this.enqueue(entry.operationId);
    }
  }

  async flushJournal(): Promise<void> {
    await this.dependencies.journal.flush();
  }

  getPendingWorkerCount(): number {
    return this.workerTails.size;
  }
}

export function isCalendarPatch(patch: PersonalTodoPatch): boolean {
  return Object.keys(desiredCalendarPatch(patch)).length > 0;
}

export function recoveryPhaseNeedsAttention(phase: PersonalTodoRecoveryPhase): boolean {
  return phase === 'calendar_unknown' || phase === 'compensating';
}
