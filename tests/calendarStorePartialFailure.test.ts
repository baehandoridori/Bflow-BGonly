import assert from 'node:assert/strict';
import test from 'node:test';

test('a tag request failure preserves previously loaded calendar and tag metadata', async () => {
  const globalScope = globalThis as Record<string, unknown>;
  const prior = new Map<string, { exists: boolean; value: unknown }>();
  for (const key of ['window', 'localStorage']) {
    prior.set(key, { exists: Object.prototype.hasOwnProperty.call(globalScope, key), value: globalScope[key] });
  }

  const values = new Map<string, string>();
  let failTags = false;
  const originalWarn = console.warn;
  globalScope.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  globalScope.window = {
    electronAPI: {
      calendarList: async () => [{
        id: 'personal-calendar', name: '개인 캘린더', color: '#6C5CE7', visibility: 'private',
        owner_id: 'user-1', is_personal: true, members: [], can_edit: true, can_manage: true,
        created_at: '2026-08-24T00:00:00.000Z',
      }],
      calendarTagsList: async () => {
        if (failTags) throw new Error('calendar_tags temporary outage');
        return [{ id: 'tag-1', name: '업로드', color: '#E17055', sort_order: 0 }];
      },
    },
  };

  try {
    const { useCalendarStore } = await import(`../src/stores/useCalendarStore.ts?partial-failure=${Date.now()}`);
    await useCalendarStore.getState().loadAll();
    failTags = true;
    console.warn = () => {};
    await useCalendarStore.getState().loadAll();

    const state = useCalendarStore.getState();
    assert.equal(state.loaded, true);
    assert.deepEqual(state.calendars.map((calendar) => ({
      id: calendar.id, isPersonal: calendar.isPersonal, canEdit: calendar.canEdit,
    })), [{ id: 'personal-calendar', isPersonal: true, canEdit: true }]);
    assert.deepEqual(state.tags.map((tag) => tag.id), ['tag-1']);
  } finally {
    console.warn = originalWarn;
    for (const [key, value] of prior) {
      if (value.exists) globalScope[key] = value.value;
      else delete globalScope[key];
    }
  }
});
