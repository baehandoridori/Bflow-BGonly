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
    await useCalendarStore.getState().loadAll();
    assert.equal(calendarListCalls, 1);
    assert.equal(calendarTagsListCalls, 1);
    assert.deepEqual(useCalendarStore.getState().calendars.map(({ id, name }) => ({ id, name })), [
      { id: 'personal-calendar', name: '기존 캘린더' },
    ]);
    assert.deepEqual(useCalendarStore.getState().tags.map(({ id, name }) => ({ id, name })), [
      { id: 'tag-1', name: '기존 태그' },
    ]);

    console.warn = () => {};
    await useCalendarStore.getState().loadAll();

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

    await useCalendarStore.getState().loadAll();

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
    await latestLoad;

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
    await olderLoad;

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
