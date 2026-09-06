import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createStore } from 'zustand/vanilla';
import { selectMyRetakes, summarizeMyRetakes } from '../src/utils/myRetakes.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const store = (state: any) => Object.assign((select: (s: any) => any) => select(state), { getState: () => state });
const revision = { id: 'r1', sceneKey: 'EP01:A:1', status: 'open', description: 'fix this', requesterId: 'requester',
  assigneeIds: ['me', 'other'], assigneeStates: {}, createdAt: '2026-09-07T01:00:00Z' };

async function loadSource(entry: string, dependencies: Record<string, any>) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react', 'react/jsx-runtime', 'zustand', 'sonner', 'lucide-react', '@/stores/*', '@/services/*', '@/utils/*'] });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
    (id: string) => { assert.ok(id in dependencies, id); return dependencies[id]; }, module, module.exports);
  return module.exports;
}

async function hookHarness(pendingRetakeId: string | null = null, dataConnected = true, savedLocalRevisions: any[] = []) {
  const effects: Array<() => (() => void) | undefined> = [];
  const notices: any[] = [];
  const read: string[] = [];
  const navigated: string[] = [];
  const toasts: any[] = [];
  const deliveryFailures: Array<{ delivery: any; expectsAppNotification: boolean }> = [];
  const lookups: Array<{ resolve: (rows: any[]) => void; reject: (error: Error) => void }> = [];
  const auth = { currentUser: { id: 'me', name: 'Me' }, authReady: true };
  const app = { dataConnected, pendingRetakeId, currentView: 'dashboard',
    setPendingRetakeId: (value: string | null) => { app.pendingRetakeId = value; },
    setView: (value: string) => { app.currentView = value; } };
  const notifications = { activeUserId: 'me', addNotification: (value: any) => {
    notices.push(value); return `notice-${notices.length}`;
  }, markAsRead: (id: string) => read.push(id) };
  let storeLoads = 0;
  let connectedRevisionMode = true;
  const loadModes: boolean[] = [];
  const revisions = { revisions: [] as any[], loadRevisions: async () => {
    storeLoads += 1;
    loadModes.push(connectedRevisionMode);
    if (!connectedRevisionMode) revisions.revisions = [...savedLocalRevisions];
  },
    addRevisionOptimistic: (value: any) => revisions.revisions.push(value),
    updateRevisionOptimistic: (id: string, _key: string, value: any) => {
      revisions.revisions = revisions.revisions.map((item) => item.id === id ? { ...item, ...value } : item);
    } };
  let retryUpdates = 0;
  let onBroadcast: (value: unknown) => void = () => {};
  const api = { onSupabaseBroadcast: (callback: typeof onBroadcast) => { onBroadcast = callback; return () => {}; } };
  const module = await loadSource('src/hooks/useRetakeNotifications.ts', {
    react: { useEffect: (effect: any) => effects.push(effect), useRef: (value: any) => ({ current: value }),
      useState: () => [0, () => { retryUpdates += 1; }] },
    sonner: { toast: Object.assign((...args: any[]) => toasts.push(args), { error: (...args: any[]) => toasts.push(args) }) },
    '@/stores/useAuthStore': { useAuthStore: store(auth) },
    '@/stores/useAppStore': { useAppStore: store(app) },
    '@/stores/useRevisionStore': { useRevisionStore: store(revisions) },
    '@/stores/useNotificationStore': { useNotificationStore: store(notifications) },
    '@/services/revisionService': { setRevisionsSheetsMode: (connected: boolean) => { connectedRevisionMode = connected; },
      reportRetakeDeliveryFailure: (delivery: any, expectsAppNotification: boolean) => deliveryFailures.push({ delivery, expectsAppNotification }),
      getCanonicalRevisions: () => new Promise<any[]>((resolve, reject) => lookups.push({ resolve, reject })) },
    '@/utils/retakeNavigation': { openRetakeInApp: (id: string) => navigated.push(id) },
  });
  module.useRetakeNotifications();
  return { effects, notices, read, navigated, toasts, lookups, auth, app, notifications, revisions, api, loadModes, deliveryFailures,
    broadcast: (value: unknown) => onBroadcast(value), retryUpdates: () => retryUpdates, storeLoads: () => storeLoads };
}

test('local startup loads saved assignments for the dashboard without canonical notification catch-up', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness(null, false, [
    revision,
    { ...revision, id: 'working', assigneeStates: { me: { state: 'in_progress' } } },
    { ...revision, id: 'done', assigneeStates: { me: { state: 'done' } } },
    { ...revision, id: 'theirs', assigneeIds: ['other'] },
  ]);
  (globalThis as any).window = { electronAPI: h.api };
  let cleanup: (() => void) | undefined;
  try {
    assert.deepEqual(h.revisions.revisions, [], 'fresh app starts without visiting the retake screen');
    cleanup = h.effects[0]();
    await flush();
    assert.deepEqual(h.loadModes, [false], 'select the local source before loading, even after an earlier connected mode');
    const items = selectMyRetakes(h.revisions.revisions, h.auth.currentUser.id);
    assert.deepEqual(items.map(item => item.id), ['r1', 'working']);
    assert.deepEqual(summarizeMyRetakes(items, h.auth.currentUser.id), { pending: 1, inProgress: 1, total: 2 });
    assert.equal(h.app.currentView, 'dashboard');
    assert.equal(h.lookups.length, 0, 'local startup does not query canonical notification data');
    assert.equal(h.notices.length, 0);
    assert.equal(h.toasts.length, 0);
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

async function revisionLoadHarness() {
  const requests: Array<(rows: any[]) => void> = [];
  const { useRevisionStore } = await loadSource('src/stores/useRevisionStore.ts', {
    zustand: { create: createStore },
    '@/stores/useDataStore': { useDataStore: Object.assign(store({ episodes: [] }), { subscribe: () => () => {} }) },
    '@/services/revisionService': {
      getAllRevisions: () => new Promise<any[]>(resolve => requests.push(resolve)),
      buildOpenRevisionCountMap: () => ({}),
      getRevisionLookupSceneKeys: (key: string) => [key],
    },
    '@/utils/revisionWorkflow': {},
    '@/utils/revisionNotificationRecipients': {},
    '@/utils/notificationSceneNavigation': {},
  });
  return { store: useRevisionStore, requests };
}

test('a late local startup read cannot overwrite the newer connected result or subsequent optimistic changes', async () => {
  const h = await revisionLoadHarness();
  const localLoad = h.store.getState().loadRevisions();
  const connectedLoad = h.store.getState().loadRevisions();
  h.requests[1]([{ ...revision, id: 'remote' }]);
  await connectedLoad;
  h.store.getState().updateRevisionOptimistic('remote', revision.sceneKey, { description: 'edited after connection' });
  h.requests[0]([{ ...revision, id: 'old-local' }]);
  await localLoad;
  assert.deepEqual(h.store.getState().revisions.map((item: any) => [item.id, item.description]),
    [['remote', 'edited after connection']]);
  assert.equal(h.store.getState().isLoading, false);
});

test('completion of a superseded read keeps the newer read loading until its own completion', async () => {
  const h = await revisionLoadHarness();
  const localLoad = h.store.getState().loadRevisions();
  const connectedLoad = h.store.getState().loadRevisions();
  h.requests[0]([{ ...revision, id: 'old-local' }]);
  await localLoad;
  assert.deepEqual(h.store.getState().revisions, []);
  assert.equal(h.store.getState().isLoading, true);
  h.requests[1]([{ ...revision, id: 'remote' }]);
  await connectedLoad;
  assert.deepEqual(h.store.getState().revisions.map((item: any) => item.id), ['remote']);
  assert.equal(h.store.getState().isLoading, false);
});

test('background delivery failures warn once and initial assignment does not require a second app broadcast', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness(null, false);
  (globalThis as any).window = { electronAPI: h.api };
  const cleanup = h.effects[0]();
  try {
    const delivery = { revisionId: 'r1', status: 'partial', recipients: ['other'],
      slackSentUserIds: [], slackFailedUserIds: ['other'], slackMissingUserIds: [], inAppBroadcast: false };
    const event = { event: 'retake-delivery-result', payload: {
      eventId: 'delivery-1', userId: 'me', kind: 'assignment', delivery,
    } };
    h.broadcast(event); h.broadcast(event);
    assert.deepEqual(h.deliveryFailures, [{ delivery, expectsAppNotification: false }],
      'initial assignment uses the INSERT notification, so broadcast=false is not an app delivery failure');
    h.broadcast({ ...event, payload: { ...event.payload, eventId: 'delivery-2', kind: 'reassignment' } });
    assert.deepEqual(h.deliveryFailures[1], { delivery, expectsAppNotification: true });
    h.broadcast({ ...event, payload: { ...event.payload, eventId: 'sent', delivery: { ...delivery, status: 'sent' } } });
    assert.equal(h.deliveryFailures.length, 2, 'successful background delivery remains quiet');
    assert.equal(h.notices.length, 0, 'delivery results do not create duplicate recipient notifications');
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

test('background delivery failures cannot warn another user, an unready notification scope, or an unmounted hook', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness(null, false);
  (globalThis as any).window = { electronAPI: h.api };
  const cleanup = h.effects[0]();
  try {
    const event = { event: 'retake-delivery-result', payload: { eventId: 'failed', userId: 'other', kind: 'assignment',
      delivery: { revisionId: 'r1', status: 'failed', recipients: ['recipient'], slackSentUserIds: [],
        slackFailedUserIds: ['recipient'], slackMissingUserIds: [], inAppBroadcast: false } } };
    h.broadcast(event);
    event.payload.userId = 'me';
    h.notifications.activeUserId = 'other'; h.broadcast(event);
    h.notifications.activeUserId = 'me'; h.auth.currentUser = { id: 'other', name: 'Other' }; h.broadcast(event);
    h.auth.currentUser = { id: 'me', name: 'Me' }; cleanup?.(); h.broadcast(event);
    assert.deepEqual(h.deliveryFailures, []);
    assert.deepEqual(h.notices, []);
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

test('retake catch-up and reminders respect current recipient, dedupe, read action, and login changes', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness();
  (globalThis as any).window = { electronAPI: h.api };
  let cleanup: (() => void) | undefined;
  try {
    cleanup = h.effects[0]();
    assert.equal(h.storeLoads(), 1, 'dashboard store is loaded independently of strict catch-up');
    h.lookups[0].resolve([revision, { ...revision, id: 'done', assigneeStates: { me: { state: 'done' } } },
      { ...revision, id: 'theirs', assigneeIds: ['other'] }, { ...revision, id: 'resolved', status: 'resolved' }]);
    await flush();
    assert.deepEqual(h.notices.map((item) => item.metadata.revisionId), ['r1']);
    const reminder = { event: 'retake-reminder', payload: { eventId: 'event1', revisionId: 'r1',
      recipients: ['other'], senderName: 'Requester', description: 'Check progress', createdAt: revision.createdAt } };
    h.broadcast(reminder);
    assert.equal(h.notices.length, 1);
    reminder.payload.recipients = ['me'];
    h.broadcast(reminder); h.broadcast(reminder);
    assert.equal(h.notices.length, 2); assert.equal(h.toasts.length, 1);
    h.toasts[0][1].action.onClick();
    assert.deepEqual(h.read, ['notice-2']); assert.deepEqual(h.navigated, ['r1']);
    cleanup?.(); cleanup = h.effects[0]();
    h.auth.currentUser = { id: 'second', name: 'Second' }; h.notifications.activeUserId = 'second';
    h.lookups[1].resolve([revision]); await flush();
    h.broadcast({ ...reminder, payload: { ...reminder.payload, eventId: 'event2' } });
    h.toasts[0][1].action.onClick();
    assert.equal(h.notices.length, 2);
    assert.deepEqual(h.read, ['notice-2'], 'old toast cannot change the next user notification state');
    assert.deepEqual(h.navigated, ['r1']);
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

test('new assignee broadcasts show assignment text, dedupe each event, and keep repeated assignments distinct', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness();
  (globalThis as any).window = { electronAPI: h.api };
  const cleanup = h.effects[0]();
  try {
    h.lookups[0].resolve([]); await flush();
    const event = { event: 'retake-reminder', payload: { kind: 'assignment', eventId: 'assignment-1',
      revisionId: 'r1', recipients: ['other'], senderName: 'Requester', description: 'Assigned work',
      setId: 'set-1', createdAt: revision.createdAt } };
    h.broadcast(event); assert.equal(h.notices.length, 0);
    event.payload.recipients = ['me'];
    h.broadcast(event); h.broadcast(event);
    assert.equal(h.notices.length, 1); assert.equal(h.toasts.length, 1);
    assert.equal(h.notices[0].title, '새 담당 리테이크가 있습니다');
    assert.equal(h.notices[0].body, 'Requester님의 담당 지정 · Assigned work');
    assert.equal(h.notices[0].metadata.revisionAction, 'add');
    assert.equal(h.notices[0].metadata.retakeHubSetId, 'set-1');
    h.toasts[0][1].action.onClick(); assert.deepEqual(h.navigated, ['r1']);
    h.broadcast({ ...event, payload: { ...event.payload, eventId: 'assignment-2' } });
    assert.equal(h.notices.length, 2);
    assert.notEqual(h.notices[0].metadata.revisionEventId, h.notices[1].metadata.revisionEventId);
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

test('cold hub link waits for canonical data and adds only the requested target before choosing the hub', async () => {
  const h = await hookHarness('new-retake');
  h.revisions.revisions.push({ ...revision, id: 'existing' });
  const cleanup = h.effects[1]();
  assert.equal(h.app.currentView, 'dashboard');
  h.lookups[0].resolve([{ ...revision, id: 'new-retake', setId: 'set-new' }, { ...revision, id: 'unrelated-server-item' }]);
  await flush();
  assert.equal(h.app.currentView, 'retake-hub'); assert.equal(h.app.pendingRetakeId, 'new-retake');
  assert.deepEqual(h.revisions.revisions.map((item) => item.id), ['existing', 'new-retake']);
  cleanup?.();
});

test('pending link survives disconnected startup and canonical network failure, with an explicit retry', async () => {
  const disconnected = await hookHarness('new-retake', false);
  disconnected.effects[1]();
  assert.equal(disconnected.lookups.length, 0); assert.equal(disconnected.app.pendingRetakeId, 'new-retake');
  const h = await hookHarness('new-retake'); const cleanup = h.effects[1]();
  h.lookups[0].reject(new Error('offline')); await flush();
  assert.equal(h.app.pendingRetakeId, 'new-retake'); assert.equal(h.app.currentView, 'dashboard');
  h.toasts[0][1].action.onClick(); assert.equal(h.retryUpdates(), 1);
  cleanup?.();
});

test('positive absence clears pending while superseded and stale-user lookups do not mutate the store', async () => {
  const absent = await hookHarness('deleted'); const cleanupAbsent = absent.effects[1]();
  absent.lookups[0].resolve([]); await flush();
  assert.equal(absent.app.pendingRetakeId, null); cleanupAbsent?.();
  for (const change of ['request', 'user']) {
    const h = await hookHarness('old'); const cleanup = h.effects[1]();
    if (change === 'request') h.app.pendingRetakeId = 'new'; else h.auth.currentUser = { id: 'second', name: 'Second' };
    h.lookups[0].resolve([{ ...revision, id: 'old' }]); await flush();
    assert.equal(h.revisions.revisions.length, 0); assert.equal(h.app.currentView, 'dashboard'); cleanup?.();
  }
});

test('uncached navigation preserves current screen until its canonical hub context is known', async () => {
  const h = await hookHarness(); const selected: string[] = [];
  Object.assign(h.app, { pushNavigationBackTarget: () => {} });
  const { openRetakeInApp } = await loadSource('src/utils/retakeNavigation.ts', {
    '@/stores/useAppStore': { useAppStore: store(h.app) },
    '@/stores/useRevisionStore': { useRevisionStore: store(h.revisions) },
    '@/stores/useRevisionSetStore': { useRevisionSetStore: store({ select: (id: string) => selected.push(id) }) },
  });
  openRetakeInApp('uncached');
  assert.equal(h.app.currentView, 'dashboard'); assert.equal(h.app.pendingRetakeId, 'uncached');
  h.revisions.revisions.push({ ...revision, setId: 'set-1' }); openRetakeInApp('r1');
  assert.equal(h.app.currentView, 'retake-hub'); assert.deepEqual(selected, ['set-1']);
});

test('reminder results from a previous item cannot set the next item cooldown or messages', async () => {
  const previousWindow = (globalThis as any).window;
  const values: any[] = []; const refs: any[] = [];
  const effects: Array<{ deps: any[]; cleanup?: () => void }> = [];
  let valueIndex = 0; let refIndex = 0; let effectIndex = 0; let scheduled: Array<() => void> = [];
  let complete: (value: any) => void = () => {}; const toasts: any[] = [];
  const auth = { currentUser: { id: 'requester', name: 'Requester' } };
  const jsx = (type: any, props: any) => ({ type, props });
  const { RemindRetakeButton } = await loadSource('src/components/scenes/revision/RemindRetakeButton.tsx', {
    react: {
      useState: (initial: any) => { const i = valueIndex++; if (!(i in values)) values[i] = initial;
        return [values[i], (next: any) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
      useRef: (initial: any) => { const i = refIndex++; return refs[i] ?? (refs[i] = { current: initial }); },
      useEffect: (effect: any, deps: any[]) => { const i = effectIndex++; const old = effects[i];
        if (!old || deps.some((value, j) => value !== old.deps[j])) scheduled.push(() => {
          old?.cleanup?.(); effects[i] = { deps, cleanup: effect() };
        }); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': { BellRing: 'bell', Loader2: 'loader' },
    sonner: { toast: { success: (message: any) => toasts.push(message), warning: (message: any) => toasts.push(message), error: (message: any) => toasts.push(message) } },
    '@/stores/useAuthStore': { useAuthStore: store(auth) },
  });
  const render = (item: any) => {
    valueIndex = 0; refIndex = 0; effectIndex = 0; scheduled = [];
    const tree = RemindRetakeButton({ revision: item }); scheduled.forEach((effect) => effect()); return tree;
  };
  (globalThis as any).window = { electronAPI: { remindRetake: () => new Promise((resolve) => { complete = resolve; }) } };
  try {
    let tree = render(revision); tree = render(revision); tree.props.children[0].props.onClick();
    render({ ...revision, id: 'next' }); complete({ status: 'sent', recipients: ['me'], simulated: true }); await flush();
    tree = render({ ...revision, id: 'next' });
    assert.equal(tree.props.children[0].props.disabled, false);
    assert.equal(values[1], 0, 'no stale cooldown'); assert.equal(values[2], '', 'no stale result text'); assert.equal(toasts.length, 0);
    assert.equal(render({ ...revision, assigneeIds: ['requester'] }), null, 'self-only assignment does not show a resend button');
  } finally { effects.forEach((effect) => effect.cleanup?.()); (globalThis as any).window = previousWindow; }
});
