import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCalendarEvents, VACATION_CHIP_ID } from '../src/utils/calendarEventFilter.ts';
import type { CalendarEvent } from '../src/types/calendar.ts';

test('all-tag toggle persists off/on states, includes only connected vacation, and keeps untagged events', async () => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    const { useCalendarStore } = await import(`../src/stores/useCalendarStore.ts?all-tags=${Date.now()}`);
    useCalendarStore.setState({ tags: [
      { id: 'meeting', name: '회의', color: '#123456', sortOrder: 0 },
      { id: 'review', name: '검토', color: '#654321', sortOrder: 1 },
    ] });
    useCalendarStore.getState().toggleAllTags(true);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, { meeting: false, review: false, [VACATION_CHIP_ID]: false });
    assert.deepEqual(JSON.parse(values.get('bflow_calendar_tags_enabled_v1')!), useCalendarStore.getState().enabledTagIds);
    const untagged = { id: 'none', source: 'bflow', calendarId: 'cal', title: '태그 없음' } as CalendarEvent;
    const tagged = { ...untagged, id: 'tagged', tagIds: ['meeting', 'review'] };
    const vacation = { ...untagged, id: 'vacation', source: 'vacation' } as CalendarEvent;
    assert.deepEqual(filterCalendarEvents([untagged, tagged, vacation], {
      visibleCalendarIds: {}, enabledTagIds: useCalendarStore.getState().enabledTagIds, googleVisible: true,
    }).map(event => event.id), ['none']);
    useCalendarStore.getState().toggleAllTags(true);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, {});
    useCalendarStore.getState().toggleTag('meeting');
    useCalendarStore.getState().toggleAllTags(true);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, {}, 'a mixed selection becomes all on');
    useCalendarStore.setState({ enabledTagIds: { [VACATION_CHIP_ID]: false, 'removed-tag': false } });
    useCalendarStore.getState().toggleAllTags(false);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, { [VACATION_CHIP_ID]: false, 'removed-tag': false, meeting: false, review: false });
    useCalendarStore.getState().toggleAllTags(false);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, { [VACATION_CHIP_ID]: false, 'removed-tag': false }, 'hidden vacation and unrelated preferences are preserved');
    useCalendarStore.getState().toggleAllTags(true);
    assert.deepEqual(useCalendarStore.getState().enabledTagIds, { 'removed-tag': false }, 'connected vacation participates in mixed selection');
    useCalendarStore.setState({ tags: [...useCalendarStore.getState().tags, { id: 'optimistic-tag:pending', name: '임시', color: '#123456', sortOrder: 2 }] });
    useCalendarStore.getState().toggleAllTags(true);
    assert.equal(useCalendarStore.getState().enabledTagIds['optimistic-tag:pending'], undefined, 'temporary tag IDs never enter preferences');
    assert.equal(values.get('bflow_calendar_tags_enabled_v1')!.includes('optimistic-tag:'), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('clean profile initializes all calendar visibility storage keys', async () => {
  const values = new Map<string, string>();
  const globalScope = globalThis as Record<string, unknown>;
  const hadLocalStorage = Object.prototype.hasOwnProperty.call(globalScope, 'localStorage');
  const previousLocalStorage = globalScope.localStorage;
  globalScope.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  try {
    await import(`../src/stores/useCalendarStore.ts?clean-profile=${Date.now()}`);

    assert.equal(values.get('bflow_calendar_visible_v1'), '{}');
    assert.equal(values.get('bflow_calendar_tags_enabled_v1'), '{}');
    assert.equal(values.get('bflow_calendar_muted_v1'), '[]');
  } finally {
    if (hadLocalStorage) globalScope.localStorage = previousLocalStorage;
    else delete globalScope.localStorage;
  }
});
