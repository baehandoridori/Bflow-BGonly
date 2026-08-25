import assert from 'node:assert/strict';
import test from 'node:test';

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
