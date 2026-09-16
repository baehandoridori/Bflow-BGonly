import assert from 'node:assert/strict';
import test from 'node:test';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

test('partial failures apply successful metadata and preserve the last successful failed side', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage']) {
    prior.set(key, { exists: Object.prototype.hasOwnProperty.call(globalScope, key), value: globalScope[key] });
  }

  const values = new Map<string, string>();
  let calendarListCalls = 0;
  let calendarTagsListCalls = 0;
  const olderCalendars = deferred<Array<{
    id: string; name: string; color: string; visibility: 'private'; owner_id: string;
    is_personal: boolean; members: never[]; can_edit: boolean; can_manage: boolean; created_at: string;
  }>>();
  const olderTags = deferred<Array<{ id: string; name: string; color: string; sort_order: number }>>();
  const originalWarn = console.warn;
  globalScope.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  globalScope.window = {
    electronAPI: {
      calendarList: async () => {
        calendarListCalls += 1;
        if (calendarListCalls === 1) {
          return [{
            id: 'personal-calendar', name: '기존 캘린더', color: '#6C5CE7', visibility: 'private',
            owner_id: 'user-1', is_personal: true, members: [], can_edit: true, can_manage: true,
            created_at: '2026-08-24T00:00:00.000Z',
          }];
        }
        if (calendarListCalls === 2) {
          return [{
            id: 'updated-calendar', name: '새 캘린더', color: '#74B9FF', visibility: 'private',
            owner_id: 'user-1', is_personal: true, members: [], can_edit: true, can_manage: true,
            created_at: '2026-08-24T01:00:00.000Z',
          }];
        }
        if (calendarListCalls === 3) throw new Error('calendars temporary outage');
        if (calendarListCalls === 4) return olderCalendars.promise;
        if (calendarListCalls === 5) {
          return [{
            id: 'latest-calendar', name: '가장 최신 캘린더', color: '#00B894', visibility: 'private',
            owner_id: 'user-1', is_personal: true, members: [], can_edit: true, can_manage: true,
            created_at: '2026-08-24T02:00:00.000Z',
          }];
        }
        throw new Error(`unexpected calendarList call: ${calendarListCalls}`);
      },
      calendarTagsList: async () => {
        calendarTagsListCalls += 1;
        if (calendarTagsListCalls === 1) {
          return [{ id: 'tag-1', name: '기존 태그', color: '#E17055', sort_order: 0 }];
        }
        if (calendarTagsListCalls === 2) throw new Error('calendar_tags temporary outage');
        if (calendarTagsListCalls === 3) {
          return [{ id: 'tag-2', name: '새 태그', color: '#74B9FF', sort_order: 1 }];
        }
        if (calendarTagsListCalls === 4) return olderTags.promise;
        if (calendarTagsListCalls === 5) throw new Error('latest tag request outage');
        throw new Error(`unexpected calendarTagsList call: ${calendarTagsListCalls}`);
      },
    },
  };

  try {
    const { useCalendarStore } = await import(`../src/stores/useCalendarStore.ts?partial-failure=${Date.now()}`);
    assert.deepEqual(await useCalendarStore.getState().loadAll(), {
      calendarsFresh: true,
      tagsFresh: true,
    });
    assert.equal(calendarListCalls, 1);
    assert.equal(calendarTagsListCalls, 1);
    assert.deepEqual(useCalendarStore.getState().calendars.map(({ id, name }) => ({ id, name })), [
      { id: 'personal-calendar', name: '기존 캘린더' },
    ]);
    assert.deepEqual(useCalendarStore.getState().tags.map(({ id, name }) => ({ id, name })), [
      { id: 'tag-1', name: '기존 태그' },
    ]);

    console.warn = () => {};
    assert.deepEqual(await useCalendarStore.getState().loadAll(), {
      calendarsFresh: true,
      tagsFresh: false,
    });

    assert.equal(calendarListCalls, 2);
    assert.equal(calendarTagsListCalls, 2);
    const afterTagFailure = useCalendarStore.getState();
    assert.equal(afterTagFailure.loaded, true);
    assert.deepEqual(afterTagFailure.calendars.map((calendar) => ({
      id: calendar.id, name: calendar.name, isPersonal: calendar.isPersonal, canEdit: calendar.canEdit,
    })), [{ id: 'updated-calendar', name: '새 캘린더', isPersonal: true, canEdit: true }]);
    assert.deepEqual(afterTagFailure.tags.map(({ id, name }) => ({ id, name })), [
      { id: 'tag-1', name: '기존 태그' },
    ]);

    assert.deepEqual(await useCalendarStore.getState().loadAll(), {
      calendarsFresh: false,
      tagsFresh: true,
    });

    assert.equal(calendarListCalls, 3);
    assert.equal(calendarTagsListCalls, 3);
    const afterCalendarFailure = useCalendarStore.getState();
    assert.equal(afterCalendarFailure.loaded, true);
    assert.deepEqual(afterCalendarFailure.calendars.map(({ id, name }) => ({ id, name })), [
      { id: 'updated-calendar', name: '새 캘린더' },
    ]);
    assert.deepEqual(afterCalendarFailure.tags.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })), [
      { id: 'tag-2', name: '새 태그', sortOrder: 1 },
    ]);

    const olderLoad = useCalendarStore.getState().loadAll();
    const latestLoad = useCalendarStore.getState().loadAll();
    assert.deepEqual(await latestLoad, {
      calendarsFresh: true,
      tagsFresh: false,
    });

    assert.equal(calendarListCalls, 5);
    assert.equal(calendarTagsListCalls, 5);
    assert.deepEqual(useCalendarStore.getState().calendars.map(({ id, name }) => ({ id, name })), [
      { id: 'latest-calendar', name: '가장 최신 캘린더' },
    ]);
    assert.deepEqual(useCalendarStore.getState().tags.map(({ id, name }) => ({ id, name })), [
      { id: 'tag-2', name: '새 태그' },
    ]);

    olderCalendars.resolve([{
      id: 'stale-calendar', name: '늦게 끝난 예전 캘린더', color: '#D63031', visibility: 'private',
      owner_id: 'user-1', is_personal: true, members: [], can_edit: true, can_manage: true,
      created_at: '2026-08-24T00:30:00.000Z',
    }]);
    olderTags.resolve([{ id: 'stale-tag', name: '늦게 끝난 예전 태그', color: '#D63031', sort_order: 9 }]);
    assert.deepEqual(await olderLoad, {
      calendarsFresh: false,
      tagsFresh: false,
    }, 'a superseded call cannot report metadata that it did not apply as fresh');

    assert.deepEqual(useCalendarStore.getState().calendars.map(({ id, name }) => ({ id, name })), [
      { id: 'latest-calendar', name: '가장 최신 캘린더' },
    ]);
    assert.deepEqual(useCalendarStore.getState().tags.map(({ id, name }) => ({ id, name })), [
      { id: 'tag-2', name: '새 태그' },
    ]);
  } finally {
    console.warn = originalWarn;
    for (const [key, value] of prior) {
      if (value.exists) globalScope[key] = value.value;
      else delete globalScope[key];
    }
  }
});

test('mutation metadata confirmation waits for the newest same-session refresh', async (t) => {
  const globalScope = globalThis as Record<string, unknown>;
  const previousWindow = globalScope.window;
  const previousStorage = globalScope.localStorage;
  const values = new Map<string, string>();
  globalScope.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const { useAuthStore } = await import('../src/stores/useAuthStore.ts');
  const previousUser = useAuthStore.getState().currentUser;
  const user = { id: 'refresh-owner', name: '테스트 사용자', role: 'admin' } as NonNullable<typeof previousUser>;
  useAuthStore.setState({ currentUser: user });
  const { useCalendarStore, getCalendarCanonicalSnapshot } = await import('../src/stores/useCalendarStore.ts');
  type Row = Awaited<ReturnType<typeof window.electronAPI.calendarList>>[number];
  const row = (name: string): Row => ({
    id: 'created-calendar', name, color: '#6C5CE7', visibility: 'private', owner_id: user.id,
    is_personal: false, members: [], can_edit: true, can_manage: true, created_at: '',
  });
  let calls: Array<ReturnType<typeof deferred<Row[]>>> = [];
  globalScope.window = { electronAPI: {
    calendarList: () => { const call = deferred<Row[]>(); calls.push(call); return call.promise; },
    calendarTagsList: async () => [],
  } };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  try {
    await t.test('a successful request superseded by Realtime cannot report failure while the newer request is pending', async () => {
      calls = [];
      let settled = false;
      const confirmation = useCalendarStore.getState().loadAll({ waitForLatest: true }).then((result) => { settled = true; return result; });
      const realtime = useCalendarStore.getState().loadAll();
      calls[0].resolve([row('created')]);
      await tick();
      const premature = settled;
      calls[1].resolve([row('created')]);
      const result = await confirmation;
      await realtime;
      assert.equal(premature, false, 'saving must await the replacement read, not enter a false reconciliation error');
      assert.deepEqual(result, { calendarsFresh: true, tagsFresh: true });
      assert.equal(getCalendarCanonicalSnapshot(user.id)?.calendars[0].name, 'created');
    });
    await t.test('multiple supersessions follow the final read, including one completed before its predecessor', async () => {
      calls = [];
      const confirmation = useCalendarStore.getState().loadAll({ waitForLatest: true });
      const middle = useCalendarStore.getState().loadAll();
      calls[0].resolve([row('older')]);
      await tick();
      const latest = useCalendarStore.getState().loadAll();
      calls[2].resolve([row('latest')]);
      await latest;
      calls[1].resolve([row('middle')]);
      await middle;
      assert.deepEqual(await confirmation, { calendarsFresh: true, tagsFresh: true });
      assert.equal(useCalendarStore.getState().calendars[0].name, 'latest');
    });
    await t.test('a failed newer read does not turn discarded successful metadata into a confirmed save', async () => {
      calls = [];
      const confirmation = useCalendarStore.getState().loadAll({ waitForLatest: true });
      globalScope.window = { electronAPI: { calendarList: async () => { throw new Error('newer read failed'); }, calendarTagsList: async () => [] } };
      const latest = useCalendarStore.getState().loadAll();
      calls[0].resolve([row('discarded')]);
      await latest;
      assert.deepEqual(await confirmation, { calendarsFresh: false, tagsFresh: true });
      assert.equal(useCalendarStore.getState().calendars[0].name, 'latest');
    });
    await t.test('changing users and returning to the original user cannot revive an old confirmation', async () => {
      calls = [];
      globalScope.window = { electronAPI: {
        calendarList: () => { const call = deferred<Row[]>(); calls.push(call); return call.promise; },
        calendarTagsList: async () => [],
      } };
      const confirmation = useCalendarStore.getState().loadAll({ waitForLatest: true });
      useAuthStore.setState({ currentUser: { ...user, id: 'other-user' } });
      useAuthStore.setState({ currentUser: user });
      const current = useCalendarStore.getState().loadAll();
      calls[1].resolve([row('new session')]);
      await current;
      calls[0].resolve([row('old session')]);
      assert.deepEqual(await confirmation, { calendarsFresh: false, tagsFresh: false });
      assert.equal(useCalendarStore.getState().calendars[0].name, 'new session');
    });
  } finally {
    useAuthStore.setState({ currentUser: previousUser });
    if (previousWindow === undefined) delete globalScope.window; else globalScope.window = previousWindow;
    if (previousStorage === undefined) delete globalScope.localStorage; else globalScope.localStorage = previousStorage;
  }
});
