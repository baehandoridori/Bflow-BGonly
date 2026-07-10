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
});
