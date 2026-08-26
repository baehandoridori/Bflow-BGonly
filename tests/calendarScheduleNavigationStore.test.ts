import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

type PendingScheduleDateNavigation = {
  id: number;
  date: string;
  todoId?: string;
};

type ScheduleNavigationStore = {
  getState(): {
    currentView: string;
    pendingScheduleDateNavigationRequest: PendingScheduleDateNavigation | null;
    pendingScheduleTodoPanelNavigationRequest: PendingScheduleDateNavigation | null;
    navigateToScheduleDate(target?: { date: string; todoId?: string }): void;
    consumeScheduleDateNavigationRequest(requestId: number): PendingScheduleDateNavigation | null;
    consumeScheduleTodoPanelNavigationRequest(requestId: number): PendingScheduleDateNavigation | null;
    setView(view: string): void;
    pushNavigationBackTarget(): void;
    goBackNavigation(): boolean;
  };
};

async function loadScheduleNavigationStore(): Promise<ScheduleNavigationStore> {
  const result = await build({
    entryPoints: ['src/stores/useAppStore.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    external: ['zustand'],
  });
  const module = { exports: {} as Record<string, unknown> };
  const nodeRequire = createRequire(import.meta.url);
  const evaluate = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  evaluate(nodeRequire, module, module.exports);
  return module.exports.useAppStore as ScheduleNavigationStore;
}

test('schedule date request survives the lazy mount boundary and only its exact consumer clears it', async () => {
  const store = await loadScheduleNavigationStore();
  store.getState().setView('dashboard');

  store.getState().navigateToScheduleDate({ date: '2026-09-03', todoId: 'todo-first' });
  const first = store.getState().pendingScheduleDateNavigationRequest;
  assert.deepEqual(first && { date: first.date, todoId: first.todoId }, {
    date: '2026-09-03',
    todoId: 'todo-first',
  });
  assert.equal(store.getState().currentView, 'schedule');
  assert.deepEqual(store.getState().pendingScheduleTodoPanelNavigationRequest, first);

  store.getState().navigateToScheduleDate({ date: '2026-09-04', todoId: 'todo-second' });
  const second = store.getState().pendingScheduleDateNavigationRequest;
  const secondTodoPanelRequest = store.getState().pendingScheduleTodoPanelNavigationRequest;
  assert.ok(first && second);
  assert.ok(secondTodoPanelRequest);
  assert.ok(second.id > first.id, 'a repeat click must replace the old request with a newer identity');
  assert.equal(
    store.getState().consumeScheduleDateNavigationRequest(first.id),
    null,
    'a stale ScheduleView effect cannot clear a newer request',
  );
  assert.equal(store.getState().pendingScheduleDateNavigationRequest?.id, second.id);
  assert.equal(
    store.getState().consumeScheduleTodoPanelNavigationRequest(first.id),
    null,
    'a stale event-load effect cannot clear a newer todo panel request',
  );
  assert.equal(store.getState().pendingScheduleTodoPanelNavigationRequest?.id, secondTodoPanelRequest.id);
  assert.deepEqual(store.getState().consumeScheduleDateNavigationRequest(second.id), second);
  assert.equal(store.getState().pendingScheduleDateNavigationRequest, null);
  assert.deepEqual(
    store.getState().consumeScheduleTodoPanelNavigationRequest(secondTodoPanelRequest.id),
    secondTodoPanelRequest,
  );
  assert.equal(store.getState().pendingScheduleTodoPanelNavigationRequest, null);

  store.getState().navigateToScheduleDate({ date: '2026-09-05' });
  assert.equal(
    store.getState().pendingScheduleTodoPanelNavigationRequest,
    null,
    'a date-only route does not create a todo panel request',
  );
  store.getState().setView('dashboard');
  assert.equal(
    store.getState().pendingScheduleDateNavigationRequest,
    null,
    'leaving the schedule before mount must discard the old request instead of jumping later',
  );
  assert.equal(
    store.getState().pendingScheduleTodoPanelNavigationRequest,
    null,
    'leaving the schedule before event loading finishes must discard the old todo panel request',
  );

  store.getState().navigateToScheduleDate({ date: '2026-09-06' });
  store.getState().navigateToScheduleDate();
  assert.equal(
    store.getState().pendingScheduleDateNavigationRequest,
    null,
    'a newer route without a date must not revive an older pending date jump',
  );
  assert.equal(
    store.getState().pendingScheduleTodoPanelNavigationRequest,
    null,
    'a newer route without a date must not revive an older todo panel jump',
  );

  store.getState().setView('dashboard');
  store.getState().pushNavigationBackTarget();
  store.getState().navigateToScheduleDate({ date: '2026-09-07', todoId: 'todo-back-navigation' });
  assert.equal(store.getState().goBackNavigation(), true);
  assert.equal(store.getState().currentView, 'dashboard');
  assert.equal(
    store.getState().pendingScheduleTodoPanelNavigationRequest,
    null,
    'going back out of schedule discards a todo panel request that never resolved',
  );
});
