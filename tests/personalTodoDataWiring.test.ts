import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('renderer bridge does not accept user ownership input', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  assert.doesNotMatch(preload, /supabaseReadTodos:\s*\(userId/);
  assert.doesNotMatch(preload, /supabaseUpsertTodo/);
  assert.match(preload, /patchPersonalTodo:\s*\(todoId[^,]*,\s*patch/);
});

test('calendar reverse sync uses an allowlisted DB-only patch', () => {
  const source = readFileSync('src/views/ScheduleView.tsx', 'utf8');
  const hook = readFileSync('src/components/widgets/my-tasks/hooks/useMyTasksData.ts', 'utf8');
  assert.match(source, /applyCalendarToTodoPatch/);
  assert.doesNotMatch(source, /readTodos\([\s\S]{0,900}upsertTodo/);
  assert.match(hook, /applyCalendarToTodoPatch/);
  assert.doesNotMatch(hook, /addEvent as addCalEvent/);
});

test('main personal todo safety boundaries are isolated into testable modules', () => {
  for (const file of [
    'electron/sessionManager.ts',
    'electron/personalTodoService.ts',
    'electron/personalTodoRecoveryJournal.ts',
    'electron/personalTodoCalendarSync.ts',
  ]) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }
});

test('per-user mutation queue serializes one user, runs users independently, and survives rejection', async () => {
  const mod = await import('../electron/personalTodoService.ts');
  assert.equal(typeof mod.createPersonalTodoMutationQueue, 'function');
  const queue = mod.createPersonalTodoMutationQueue();
  const events: string[] = [];
  let releaseAlice!: () => void;
  const aliceGate = new Promise<void>((resolve) => { releaseAlice = resolve; });

  const aliceFirst = queue.enqueue('alice', async () => {
    events.push('alice:first:start');
    await aliceGate;
    events.push('alice:first:end');
    return 1;
  });
  const aliceSecond = queue.enqueue('alice', async () => {
    events.push('alice:second');
    return 2;
  });
  const bob = queue.enqueue('bob', async () => {
    events.push('bob');
    return 3;
  });

  await bob;
  assert.deepEqual(events, ['alice:first:start', 'bob']);
  releaseAlice();
  assert.deepEqual(await Promise.all([aliceFirst, aliceSecond]), [1, 2]);
  await assert.rejects(queue.enqueue('alice', async () => { throw new Error('expected'); }), /expected/);
  assert.equal(await queue.enqueue('alice', async () => 4), 4);
});

test('dynamic pending tracker waits for work registered while a drain is already waiting', async () => {
  const mod = await import('../electron/personalTodoService.ts');
  assert.equal(typeof mod.DynamicPendingTracker, 'function');
  const tracker = new mod.DynamicPendingTracker();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  tracker.track(new Promise<void>((resolve) => { releaseFirst = resolve; }));
  const waiting = tracker.waitForIdle(500);
  tracker.track(new Promise<void>((resolve) => { releaseSecond = resolve; }));
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tracker.pendingCount, 1);
  releaseSecond();
  assert.equal(await waiting, true);
});

test('calendar reverse patches reject every field outside the five DB-only fields', async () => {
  const mod = await import('../electron/personalTodoService.ts');
  assert.equal(typeof mod.validateCalendarTodoPatch, 'function');
  assert.deepEqual(mod.validateCalendarTodoPatch({
    title: 'A', memo: 'B', startDate: '2026-07-11', endDate: null, addToCalendar: true,
  }), {
    title: 'A', memo: 'B', startDate: '2026-07-11', endDate: null, addToCalendar: true,
  });
  assert.throws(() => mod.validateCalendarTodoPatch({ title: 'A', priority: 'high' }), /unsupported/i);
});

test('recovery journal persists phase changes atomically and keeps unrelated entries', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mod = await import('../electron/personalTodoRecoveryJournal.ts');
  assert.equal(typeof mod.PersonalTodoRecoveryJournal, 'function');
  const dir = mkdtempSync(join(tmpdir(), 'bflow-personal-journal-'));
  try {
    const journalPath = join(dir, 'journal.json');
    const journal = new mod.PersonalTodoRecoveryJournal(journalPath);
    await Promise.all([
      journal.upsert({ operationId: 'one', userId: 'alice', todoId: 'a', desiredPatch: { title: 'A' }, targetCalendarId: null, candidateSourceCalendarIds: [], deterministicEventId: 'a', phase: 'received', previousCanonical: null, dbCommittedUpdatedAt: null, createdAt: '1', updatedAt: '1' }),
      journal.upsert({ operationId: 'two', userId: 'bob', todoId: 'b', desiredPatch: { title: 'B' }, targetCalendarId: null, candidateSourceCalendarIds: [], deterministicEventId: 'b', phase: 'received', previousCanonical: null, dbCommittedUpdatedAt: null, createdAt: '2', updatedAt: '2' }),
    ]);
    await journal.updatePhase('one', 'db_committed', { dbCommittedUpdatedAt: '3' });
    assert.deepEqual((await journal.read()).map((entry: { operationId: string }) => entry.operationId).sort(), ['one', 'two']);
    assert.equal((await journal.get('one'))?.phase, 'db_committed');
    await journal.remove('one');
    assert.deepEqual((await journal.read()).map((entry: { operationId: string }) => entry.operationId), ['two']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('calendar helpers provide stable idempotency ids and a five-second unknown outcome boundary', async () => {
  const mod = await import('../electron/personalTodoCalendarSync.ts');
  assert.equal(typeof mod.deterministicGoogleEventId, 'function');
  const first = mod.deterministicGoogleEventId('550e8400-e29b-41d4-a716-446655440000');
  assert.equal(first, mod.deterministicGoogleEventId('550e8400-e29b-41d4-a716-446655440000'));
  assert.match(first, /^[a-v0-9]{5,1024}$/);
  assert.equal(mod.PERSONAL_TODO_GOOGLE_LINK_KEY, 'bflow_linked_todo_id');
  const outcome = await mod.withCalendarAttemptTimeout(
    new Promise<never>(() => {}),
    5,
  );
  assert.deepEqual(outcome, { status: 'unknown', reason: 'timeout' });
});

test('session payload sanitization never returns a password', async () => {
  const mod = await import('../electron/sessionManager.ts');
  assert.equal(typeof mod.sanitizeSessionUser, 'function');
  const sanitized = mod.sanitizeSessionUser({ id: 'alice', name: 'Alice', password: 'secret', role: 'user' });
  assert.equal('password' in sanitized, false);
  assert.deepEqual(sanitized, { id: 'alice', name: 'Alice', role: 'user' });
});

test('main wires the recovery journal and calendar worker into live todo intents', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  const google = readFileSync('electron/googleCalendar.ts', 'utf8');
  assert.match(main, /personal-calendar-recovery\.json/);
  assert.match(main, /calendar:\s*personalTodoCalendarSync/);
  assert.match(main, /personalTodoCalendarSync\.recover/);
  assert.match(main, /personalTodoService\.waitForIdle\(15000\)/);
  assert.match(google, /id:\s*input\.id/);
  assert.match(main, /bflow_type:\s*'custom'[\s\S]{0,180}PERSONAL_TODO_GOOGLE_LINK_KEY/);
  assert.match(main, /personal-todo:retry-calendar[\s\S]{0,500}personalTodoCalendarSync\.recover/);
  assert.match(readFileSync('electron/preload.ts', 'utf8'), /retryPersonalTodoCalendar/);
  assert.match(readFileSync('src/services/calendarService.ts', 'utf8'), /gcalSaveLocalSettings/);
  assert.match(readFileSync('src/App.tsx', 'utf8'), /syncAll\(\{ broadcast: false \}\)/);
});

test('committed-but-response-lost keeps the calendar intent and reconciles from owner-scoped read-back', async () => {
  const { PersonalTodoService } = await import('../electron/personalTodoService.ts');
  const todo = {
    id: 'todo-1', userId: 'alice', title: 'before', memo: '', status: 'todo' as const,
    completed: false, priority: 'none' as const, pinned: false, labelIds: [],
    startDate: '2026-07-11', endDate: '2026-07-11', addToCalendar: true,
    sortOrder: 0, createdAt: '1', updatedAt: '1',
  };
  let stored = { ...todo };
  const calls: string[] = [];
  const service = new PersonalTodoService({
    getCanonicalSession: () => ({ userId: 'alice', epoch: 1 }),
    persistence: {
      readTodos: async () => [stored],
      readTodo: async (userId, todoId) => userId === 'alice' && todoId === stored.id ? stored : null,
      readLabels: async () => [],
      patchTodo: async (_userId, _todoId, patch) => {
        stored = { ...stored, ...patch, labelIds: patch.labelIds ? [...patch.labelIds] : stored.labelIds, updatedAt: '2' };
        throw Object.assign(new Error('connection lost after commit'), { code: 'ECONNRESET' });
      },
      mutateOrder: async () => [stored],
      createOrReuseLabelAndAttach: async () => { throw new Error('unused'); },
      updateLabel: async () => { throw new Error('unused'); },
      readTaskViews: async () => null,
      upsertTaskViews: async () => undefined,
    },
    calendar: {
      receive: async () => ({ operationId: 'op-1' }),
      receiveDeletion: async () => ({ operationId: 'op-delete' }),
      markPrepared: async () => { calls.push('prepared'); },
      markDbCommitted: async () => { calls.push('db-committed'); },
      markDbDeleted: async () => { calls.push('db-deleted'); },
      markUnknown: async () => { calls.push('unknown'); },
      markAborted: async () => { calls.push('aborted'); },
      flushJournal: async () => undefined,
    },
  });

  const result = await service.patchTodo('todo-1', { title: 'after', labelIds: ['label-1'] }, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['prepared', 'db-committed']);
});

test('delete committed before response loss still advances the linked calendar deletion', async () => {
  const { PersonalTodoService } = await import('../electron/personalTodoService.ts');
  const todo = {
    id: 'todo-delete', userId: 'alice', title: 'delete me', memo: '', status: 'todo' as const,
    completed: false, priority: 'none' as const, pinned: false, labelIds: [],
    startDate: '2026-07-11', endDate: '2026-07-11', addToCalendar: true,
    sortOrder: 0, createdAt: '1', updatedAt: '1',
  };
  let stored: typeof todo | null = todo;
  const calls: string[] = [];
  const service = new PersonalTodoService({
    getCanonicalSession: () => ({ userId: 'alice', epoch: 1 }),
    persistence: {
      readTodos: async () => stored ? [stored] : [], readTodo: async () => stored,
      readLabels: async () => [], patchTodo: async () => { throw new Error('unused'); },
      mutateOrder: async () => {
        stored = null;
        throw Object.assign(new Error('connection lost after delete'), { code: 'ECONNRESET' });
      },
      createOrReuseLabelAndAttach: async () => { throw new Error('unused'); },
      updateLabel: async () => { throw new Error('unused'); }, readTaskViews: async () => null,
      upsertTaskViews: async () => undefined,
    },
    calendar: {
      receive: async () => ({ operationId: 'unused' }),
      receiveDeletion: async () => ({ operationId: 'op-delete' }),
      markPrepared: async () => { calls.push('prepared'); },
      markDbCommitted: async () => { calls.push('db-committed'); },
      markDbDeleted: async () => { calls.push('db-deleted'); },
      markUnknown: async () => { calls.push('unknown'); },
      markAborted: async () => { calls.push('aborted'); }, flushJournal: async () => undefined,
    },
  });
  const result = await service.deleteTodo(todo.id, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['prepared', 'db-deleted']);
});

test('session transition closes old-user intake and suppresses results captured before the epoch change', async () => {
  const { PersonalTodoService } = await import('../electron/personalTodoService.ts');
  let session = { userId: 'alice' as string | null, epoch: 1 };
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  const service = new PersonalTodoService({
    getCanonicalSession: () => session,
    persistence: {
      readTodos: async () => { await readGate; return []; },
      readTodo: async () => null,
      readLabels: async () => [],
      patchTodo: async () => { throw new Error('unused'); },
      mutateOrder: async () => [],
      createOrReuseLabelAndAttach: async () => { throw new Error('unused'); },
      updateLabel: async () => { throw new Error('unused'); },
      readTaskViews: async () => null,
      upsertTaskViews: async () => undefined,
    },
  });

  const accepted = service.readTodos(1);
  service.beginSessionTransition('alice', 1);
  const rejectedDuringDrain = await service.readLabels(1);
  assert.equal(rejectedDuringDrain.ok, false);
  if (!rejectedDuringDrain.ok) assert.equal(rejectedDuringDrain.kind, 'stale');
  session = { userId: 'bob', epoch: 2 };
  releaseRead();
  const staleResult = await accepted;
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.kind, 'stale');
});

test('create retry keeps each todo id exactly once in the authoritative order', async () => {
  const { PersonalTodoService } = await import('../electron/personalTodoService.ts');
  const existing = {
    id: 'same-id', userId: 'alice', title: 'already committed', memo: '', status: 'todo' as const,
    completed: false, priority: 'none' as const, pinned: false, labelIds: [], startDate: null,
    endDate: null, addToCalendar: false, sortOrder: 0, createdAt: '1', updatedAt: '1',
  };
  let orderedIds: string[] = [];
  const service = new PersonalTodoService({
    getCanonicalSession: () => ({ userId: 'alice', epoch: 1 }),
    persistence: {
      readTodos: async () => [existing], readTodo: async () => existing, readLabels: async () => [],
      patchTodo: async () => existing,
      mutateOrder: async (_userId, _mutation, ids) => { orderedIds = ids; return [existing]; },
      createOrReuseLabelAndAttach: async () => { throw new Error('unused'); },
      updateLabel: async () => { throw new Error('unused'); }, readTaskViews: async () => null,
      upsertTaskViews: async () => undefined,
    },
  });
  await service.createTodo({ id: 'same-id', title: 'retry' }, 1);
  assert.deepEqual(orderedIds, ['same-id']);
});

test('dev preview canonical login restore and logout are functional and password-free', () => {
  const source = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.doesNotMatch(source, /preview session unavailable/);
  assert.match(source, /loginCanonicalSession:[\s\S]{0,1000}input\.password/);
  assert.match(source, /restoreCanonicalSession:[\s\S]{0,500}previewCanonical/);
  assert.match(source, /logoutCanonicalSession:[\s\S]{0,500}previewCanonical/);
});

test('public renderer user reads and contracts never expose or replace plaintext passwords', () => {
  const preload = readFileSync('electron/preload.ts', 'utf8');
  const types = readFileSync('src/types/index.ts', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  const appUser = types.slice(types.indexOf('export interface AppUser'), types.indexOf('export interface AuthSession'));
  assert.doesNotMatch(appUser, /password\s*:/);
  assert.doesNotMatch(preload, /usersWrite:/);
  assert.match(main, /sanitizePublicUser/);
  assert.match(preload, /changeOwnPassword/);
});

test('my tasks consumes main personal-todo commits and cancels stale session loads', () => {
  const hook = readFileSync('src/components/widgets/my-tasks/hooks/useMyTasksData.ts', 'utf8');
  assert.match(hook, /onPersonalTodoCommit/);
  assert.match(hook, /PersonalTodoLoadGate/);
  assert.match(hook, /payload\.userId[^\n]*currentUser/);
});

test('calendar recovery searches both previous and current candidate calendars', () => {
  const sync = readFileSync('electron/personalTodoCalendarSync.ts', 'utf8');
  const main = readFileSync('electron/main.ts', 'utf8');
  assert.match(sync, /resolveCandidateCalendarIds/);
  assert.match(sync, /candidateSourceCalendarIds/);
  assert.match(main, /resolveCandidateCalendarIds:[\s\S]{0,700}listCalendars/);
});

test('user profile mutations refresh and broadcast the canonical main-owned profile', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  const userService = readFileSync('src/services/userService.ts', 'utf8');
  assert.match(main, /supabase:update-user[\s\S]{0,500}refreshCurrentUser/);
  assert.match(main, /auth:change-own-password[\s\S]{0,2500}refreshCurrentUser/);
  assert.match(userService, /changeOwnPassword/);
});

test('commit during initial todo migration is folded into authoritative load and scene-key saves stay enabled', async () => {
  const { PersonalTodoLoadGate } = await import('../src/components/widgets/my-tasks/hooks/personalTodoLoadGate.ts');
  const gate = new PersonalTodoLoadGate();
  const initialToken = gate.beginInitialLoad();

  assert.equal(gate.noteAuthoritativeCommit(), null, 'commit must be deferred while migration is running');
  assert.equal(gate.consumeDeferredCommit(initialToken), true, 'initial loader must perform a final authoritative reload');
  assert.equal(gate.finishInitialLoad(initialToken), true);
  assert.equal(gate.canPersistSceneKeys, true);

  let sceneKeySaves = 0;
  if (gate.canPersistSceneKeys) sceneKeySaves++;
  assert.equal(sceneKeySaves, 1, 'scene-key persistence must remain enabled after the deferred commit reload');
});

test('commit arriving during the final authoritative reload schedules one more reload before initialization finishes', async () => {
  const { PersonalTodoLoadGate } = await import('../src/components/widgets/my-tasks/hooks/personalTodoLoadGate.ts');
  const gate = new PersonalTodoLoadGate();
  const initialToken = gate.beginInitialLoad();
  let releaseFirstReload!: () => void;
  const firstReloadGate = new Promise<void>((resolve) => { releaseFirstReload = resolve; });
  let reloadCount = 0;

  gate.noteAuthoritativeCommit();
  const draining = gate.drainDeferredCommits(initialToken, async () => {
    reloadCount++;
    if (reloadCount === 1) await firstReloadGate;
    return reloadCount;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  gate.noteAuthoritativeCommit();
  releaseFirstReload();

  assert.equal(await draining, 2);
  assert.equal(reloadCount, 2);
  assert.equal(gate.finishInitialLoad(initialToken), true);
});

test('authoritative empty remote users never fall back to stale local users', async () => {
  const { selectVisibleUsers } = await import('../src/services/userDirectoryPolicy.ts');
  const localUsers = [{ id: 'local-alice', name: 'Local Alice' }];
  const visible = selectVisibleUsers({ status: 'authoritative', users: [] }, localUsers);
  assert.deepEqual(visible, []);
});

test('transient remote user outage cannot clear a verified canonical session', async () => {
  const { SessionManager } = await import('../electron/sessionManager.ts');
  const alice = { id: 'alice', name: 'Alice', password: 'secret', role: 'user' };
  let userRead = { status: 'authoritative' as const | 'remote-unavailable', users: [alice] };
  const rememberedWrites: Array<{ userId: string } | null> = [];
  const broadcasts: Array<{ user: { id: string } | null }> = [];
  const manager = new SessionManager({
    readUsers: async () => userRead,
    readRememberedSession: async () => null,
    writeRememberedSession: async (session) => { rememberedWrites.push(session); },
    beginPersonalDataTransition: () => undefined,
    endPersonalDataTransition: () => undefined,
    drainPersonalDataQueue: async () => undefined,
    flushCalendarJournal: async () => undefined,
    setActivityUser: () => undefined,
    broadcast: (payload) => { broadcasts.push(payload as { user: { id: string } | null }); },
  });

  assert.equal((await manager.login({ name: 'Alice', password: 'secret' })).ok, true);
  userRead = { status: 'remote-unavailable', users: [] };
  const refreshed = await manager.refreshCurrentUser();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.payload.user?.id, 'alice');
  assert.equal(rememberedWrites.some((entry) => entry === null), false);
  assert.equal(broadcasts.at(-1)?.user?.id, 'alice');
});
