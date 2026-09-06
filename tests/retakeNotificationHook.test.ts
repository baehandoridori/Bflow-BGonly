import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createStore } from 'zustand/vanilla';
import { selectMyRetakes, summarizeMyRetakes } from '../src/utils/myRetakes.ts';
import { revisionSetReadHarness } from './helpers/revisionSetReadHarness.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const store = (state: any) => Object.assign((select: (s: any) => any) => select(state), { getState: () => state });
const revision = { id: 'r1', sceneKey: 'EP01:A:1', status: 'open', description: 'fix this', requesterId: 'requester',
  assigneeIds: ['me', 'other'], assigneeStates: {}, createdAt: '2026-09-07T01:00:00Z' };

async function loadSource(entry: string, dependencies: Record<string, any>) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['react', 'react/jsx-runtime', 'zustand', 'sonner', 'lucide-react', '@/stores/*', '@/services/*', '@/utils/*', ...Object.keys(dependencies)] });
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
  const lookups: Array<{ revisionId?: string; resolve: (rows: any) => void; reject: (error: Error) => void }> = [];
  const authStore = createStore(() => ({ currentUser: { id: 'me', name: 'Me' } as any, authReady: true }));
  const auth = new Proxy({} as any, {
    get: (_target, property) => (authStore.getState() as any)[property],
    set: (_target, property, value) => { authStore.setState({ [property]: value }); return true; },
  });
  const { useAppStore: appStore } = await loadSource('src/stores/useAppStore.ts', {
    zustand: { create: createStore },
    './useAuthStore': { useAuthStore: authStore },
    '@/utils/starNestSettings': { DEFAULT_BACKGROUND_ART: 'none', DEFAULT_BFLOW_STAR_NEST_SETTINGS: {},
      DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX: 0, DEFAULT_DASHBOARD_STAR_NEST_OPACITY: 0, DEFAULT_STAR_NEST_SETTINGS: {} },
    '@/utils/navigationBackStack': { appendNavigationBackSnapshot: () => [], createNavigationBackSnapshot: () => ({}) },
  });
  appStore.setState({ dataConnected });
  if (pendingRetakeId) appStore.getState().requestRetakeNavigation(pendingRetakeId);
  const app = new Proxy({} as any, {
    get: (_target, property) => appStore.getState()[property],
    set: (_target, property, value) => {
      if (property === 'dataConnected') appStore.getState().setDataConnected(value);
      else appStore.setState({ [property]: value });
      return true;
    },
  });
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
    applyNavigationRevision: (id: string, value: any) => {
      revisions.revisions = revisions.revisions.filter(item => item.id !== id);
      if (value) revisions.revisions.push(value);
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
      getCanonicalRevisions: () => new Promise<any[]>((resolve, reject) => lookups.push({ resolve, reject })),
      getCanonicalRevision: (revisionId: string) => new Promise<any>((resolve, reject) => lookups.push({ revisionId, resolve, reject })) },
    '@/utils/retakeNavigation': { openRetakeInApp: (id: string) => navigated.push(id) },
  });
  module.useRetakeNotifications();
  return { effects, notices, read, navigated, toasts, lookups, auth, app, notifications, revisions, api, loadModes, deliveryFailures,
    render: () => { effects.length = 0; module.useRetakeNotifications(); },
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
  const failures: Array<(error: Error) => void> = [];
  const { useRevisionStore } = await loadSource('src/stores/useRevisionStore.ts', {
    zustand: { create: createStore },
    '@/stores/useDataStore': { useDataStore: Object.assign(store({ episodes: [] }), { subscribe: () => () => {} }) },
    '@/services/revisionService': {
      getAllRevisions: () => new Promise<any[]>((resolve, reject) => { requests.push(resolve); failures.push(reject); }),
      buildOpenRevisionCountMap: () => ({}),
      getRevisionLookupSceneKeys: (key: string) => [key],
    },
    '@/utils/revisionWorkflow': {},
    '@/utils/revisionNotificationRecipients': {},
    '@/utils/notificationSceneNavigation': {},
  });
  return { store: useRevisionStore, requests, failures };
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

test('catch-up includes assignments beyond 1000 older revisions', async () => {
  const previousWindow = (globalThis as any).window;
  const h = await hookHarness();
  (globalThis as any).window = { electronAPI: h.api };
  const cleanup = h.effects[0]();
  try {
    const rows = Array.from({ length: 1101 }, (_, i) => ({ ...revision, id: `revision-${i}`,
      createdAt: new Date(Date.parse(revision.createdAt) + i * 1000).toISOString() }));
    assert.equal(h.lookups[0].revisionId, undefined, 'catch-up uses the complete canonical list');
    h.lookups[0].resolve(rows); await flush();
    assert.equal(h.notices.length, 50);
    assert.equal(h.notices.at(-1).metadata.revisionId, 'revision-1100');
  } finally { cleanup?.(); (globalThis as any).window = previousWindow; }
});

test('cold hub link publishes only its verified target after canonical data chooses the hub', async () => {
  const h = await hookHarness('new-retake');
  h.revisions.revisions.push({ ...revision, id: 'existing' });
  const cleanup = h.effects[1]();
  assert.equal(h.app.currentView, 'dashboard');
  assert.equal(h.lookups[0].revisionId, 'new-retake', 'navigation directly asks for this ID instead of scanning a capped list');
  h.lookups[0].resolve({ ...revision, id: 'new-retake', setId: 'set-new' });
  await flush();
  assert.equal(h.app.currentView, 'retake-hub'); assert.equal(h.app.pendingRetakeId, 'new-retake');
  assert.equal(h.app.pendingRetakeTarget.revision.id, 'new-retake');
  assert.deepEqual(h.revisions.revisions.map((item) => item.id), ['existing'], 'destination applies the verified target after its normal list load');
  cleanup?.();
});

test('pending link survives disconnected startup and canonical network failure, with an explicit retry', async () => {
  const disconnected = await hookHarness('new-retake', false);
  disconnected.effects[1]();
  assert.equal(disconnected.lookups.length, 0); assert.equal(disconnected.app.retakeNavigationRequest.revisionId, 'new-retake');
  const h = await hookHarness('new-retake'); const cleanup = h.effects[1]();
  h.lookups[0].reject(new Error('offline')); await flush();
  assert.equal(h.app.retakeNavigationRequest.revisionId, 'new-retake'); assert.equal(h.app.currentView, 'dashboard');
  h.toasts[0][1].action.onClick(); assert.equal(h.retryUpdates(), 1);
  cleanup?.();
});

test('positive absence clears pending while superseded and stale-user lookups do not mutate the store', async () => {
  const absent = await hookHarness('deleted'); const cleanupAbsent = absent.effects[1]();
  absent.lookups[0].resolve(null); await flush();
  assert.equal(absent.app.pendingRetakeId, null); cleanupAbsent?.();
  for (const change of ['request', 'user']) {
    const h = await hookHarness('old'); const cleanup = h.effects[1]();
    if (change === 'request') h.app.requestRetakeNavigation('new'); else h.auth.currentUser = { id: 'second', name: 'Second' };
    h.lookups[0].resolve({ ...revision, id: 'old' }); await flush();
    assert.equal(h.revisions.revisions.length, 0); assert.equal(h.app.currentView, 'dashboard'); cleanup?.();
  }
});

test('both cached and uncached connected navigation keep views from consuming unverified targets', async () => {
  const h = await hookHarness(); const selected: string[] = [];
  Object.assign(h.app, { pushNavigationBackTarget: () => {} });
  const { openRetakeInApp } = await loadSource('src/utils/retakeNavigation.ts', {
    '@/stores/useAppStore': { useAppStore: store(h.app) },
    '@/stores/useRevisionStore': { useRevisionStore: store(h.revisions) },
    '@/stores/useRevisionSetStore': { useRevisionSetStore: store({ select: (id: string) => selected.push(id) }) },
    '@/stores/useAuthStore': { useAuthStore: store(h.auth) },
  });
  openRetakeInApp('uncached');
  assert.equal(h.app.currentView, 'dashboard'); assert.equal(h.app.retakeNavigationRequest.revisionId, 'uncached');
  assert.equal(h.app.pendingRetakeId, null);
  h.revisions.revisions.push({ ...revision, setId: 'set-1' }); openRetakeInApp('r1');
  assert.equal(h.app.currentView, 'dashboard'); assert.deepEqual(selected, []);
  assert.equal(h.app.pendingRetakeId, null); assert.equal(h.app.retakeNavigationRequest.revisionId, 'r1');
});

function viewConsumer(view: 'hub' | 'standalone') {
  const source = readFileSync(new URL(view === 'hub' ? '../src/views/RetakeHubView.tsx' : '../src/views/CompositingView.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('if (!pendingRetakeId'));
  const end = source.indexOf('\n  }, [pendingRetakeId', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start + '  useEffect(() => {'.length, end);
  const { code } = transformSync(`module.exports = (env: any) => { const {
    pendingRetakeId, pendingRetakeTarget, revisionsLoaded, isLoading, loadingSets, revisions, sets, select,
    refreshedRetakeRequest, loadRevisionSets, sonnerToast, useAppStore, useRevisionStore,
    setTab, setFocusedRevisionId, setFocusToken, previewMode, sceneInfoMap, setSelectedEp,
    setStatusFilter, setMyTasksOnly, setSearchQuery, setGroupMode, setExpandedScenes,
    setExpandedFeedbackEpisodes, setExpandedFeedbackParts, buildFeedbackHubPartCollapseKey,
    setSelectedRevisionId,
  } = env; ${body} }`, { loader: 'ts', format: 'cjs' });
  const module = { exports: undefined as any };
  new Function('module', code)(module);
  return module.exports as (env: any) => void;
}

function destinationHarness(h: Awaited<ReturnType<typeof hookHarness>>, initialSets = ['set-a', 'set-b'], bindings: {
  revisionStore?: any; setStore?: any; loadSets?: () => Promise<any[]>;
} = {}) {
  const focused: string[] = []; const selected: string[] = []; const warnings: any[] = [];
  let sets = initialSets.map(id => ({ id })); let refreshes = 0;
  let nextSets = sets;
  const refreshedRetakeRequest = { current: null };
  const noop = () => {};
  const revisionStore = bindings.revisionStore ?? store(h.revisions);
  return { focused, selected, warnings, refreshes: () => refreshes,
    nextSets: (ids: string[]) => { nextSets = ids.map(id => ({ id })); },
    consume: (view: 'hub' | 'standalone', revisionsLoaded = true, renderedLoading = revisionStore.getState().isLoading ?? false,
      captured = { pendingRetakeId: h.app.pendingRetakeId, pendingRetakeTarget: h.app.pendingRetakeTarget }) => viewConsumer(view)({
      ...captured,
      revisionsLoaded, isLoading: renderedLoading,
      loadingSets: bindings.setStore?.getState().loading ?? false,
      revisions: revisionStore.getState().revisions, sets: bindings.setStore?.getState().sets ?? sets,
      select: (id: string) => { selected.push(id); bindings.setStore?.getState().select(id); }, refreshedRetakeRequest,
      loadRevisionSets: bindings.loadSets ?? (async () => { ++refreshes; sets = nextSets; return sets; }),
      sonnerToast: { error: (...args: any[]) => warnings.push(args) },
      useAppStore: store(h.app), useRevisionStore: revisionStore,
      setFocusedRevisionId: (id: string) => focused.push(id), setSelectedRevisionId: (id: string) => focused.push(id),
      setTab: noop, setFocusToken: noop, previewMode: false, sceneInfoMap: new Map(),
      setSelectedEp: noop, setStatusFilter: noop, setMyTasksOnly: noop, setSearchQuery: noop,
      setGroupMode: noop, setExpandedScenes: noop, setExpandedFeedbackEpisodes: noop,
      setExpandedFeedbackParts: noop, buildFeedbackHubPartCollapseKey: noop,
    }),
  };
}

test('already mounted destinations wait for canonical moves but open verified snapshots without a successful list load', async () => {
  for (const [oldSet, newSet] of [['set-a', 'set-b'], ['set-a', null], [null, 'set-b']]) {
    const h = await hookHarness('r1');
    h.app.currentView = oldSet ? 'retake-hub' : 'compositing-revisions';
    h.revisions.revisions.push({ ...revision, setId: oldSet });
    const destination = destinationHarness(h);
    const cleanup = h.effects[1]();
    destination.consume(oldSet ? 'hub' : 'standalone');
    assert.equal(h.app.pendingRetakeId, null);
    assert.deepEqual(destination.focused, []);
    h.lookups[0].resolve({ ...revision, setId: newSet }); await flush();
    assert.equal(h.app.currentView, newSet ? 'retake-hub' : 'compositing-revisions');
    // Simulate the ordinary cached list read completing after the canonical lookup.
    h.revisions.revisions = [{ ...revision, setId: oldSet }];
    destination.consume(newSet ? 'hub' : 'standalone', false);
    assert.deepEqual(destination.focused, ['r1']);
    assert.equal(h.revisions.revisions[0].setId, newSet);
    assert.deepEqual(destination.selected, newSet ? [newSet] : []);
    assert.equal(h.app.pendingRetakeId, null); cleanup?.();
  }
});

test('both cold destinations open a verified target when the initial list fails before or after verification', async () => {
  const originalError = console.error; console.error = () => {};
  try {
    for (const view of ['hub', 'standalone'] as const) for (const failureFirst of [true, false]) {
      const h = await hookHarness('r1');
      const revisions = await revisionLoadHarness();
      const destination = destinationHarness(h, ['set-b'], { revisionStore: revisions.store });
      const listLoad = revisions.store.getState().loadRevisions();
      const cleanup = h.effects[1]();
      try {
        if (failureFirst) { revisions.failures[0](new Error('later list page failed')); await listLoad; }
        const verified = { ...revision, setId: view === 'hub' ? 'set-b' : null };
        h.lookups[0].resolve(verified); await flush();
        if (!failureFirst) {
          destination.consume(view, false);
          assert.deepEqual(destination.focused, [], 'an unfinished list may still supply the other revisions');
          revisions.failures[0](new Error('late page failed')); await listLoad;
        }
        destination.consume(view, revisions.store.getState().lastLoadTime !== null && !revisions.store.getState().isLoading);
        assert.deepEqual(destination.focused, ['r1'], `${view}, list failed first=${failureFirst}`);
        assert.equal(h.app.pendingRetakeId, null);
        assert.equal(revisions.store.getState().lastLoadTime, null, 'a single verified row is not a complete list');
        assert.equal(revisions.store.getState().isLoading, false);
        assert.deepEqual(revisions.store.getState().revisions, [verified]);
      } finally { cleanup?.(); }
    }
  } finally { console.error = originalError; }
});

test('both destinations retain the other rows from a delayed full list and then replace only the verified target', async () => {
  for (const view of ['hub', 'standalone'] as const) {
    const h = await hookHarness('r1'); const revisions = await revisionLoadHarness();
    const destination = destinationHarness(h, ['set-b'], { revisionStore: revisions.store });
    const listLoad = revisions.store.getState().loadRevisions(); const cleanup = h.effects[1]();
    try {
      const verified = { ...revision, setId: view === 'hub' ? 'set-b' : null };
      h.lookups[0].resolve(verified); await flush();
      // The mount's load effect can start after render, before the pending-target effect runs.
      destination.consume(view, false, false);
      assert.deepEqual(destination.focused, []);
      const other = { ...revision, id: 'other', description: 'another valid revision' };
      revisions.requests[0]([{ ...revision, setId: 'old-set', description: 'stale' }, other]); await listLoad;
      destination.consume(view, true);
      assert.deepEqual(destination.focused, ['r1']);
      assert.deepEqual(revisions.store.getState().revisions, [other, verified]);
      assert.notEqual(revisions.store.getState().lastLoadTime, null);
    } finally { cleanup?.(); }
  }
});

test('a cold verified hub target survives a failed real set load and opens after retry while the list remains unavailable', async () => {
  const h = await hookHarness('r1'); const revisions = await revisionLoadHarness();
  const { useRevisionSetStore: setStore } = await loadSource('src/stores/useRevisionSetStore.ts', { zustand: { create: createStore } });
  const { loadRevisionSets } = await loadSource('src/services/revisionSetService.ts', {
    '../stores/useRevisionSetStore': { useRevisionSetStore: setStore }, '../stores/useRevisionStore': { useRevisionStore: revisions.store },
    './revisionService': { setRevisionSet: () => {} },
  });
  const oldWindow = (globalThis as any).window; const originalError = console.error; console.error = () => {};
  let setReads = 0;
  (globalThis as any).window = { electronAPI: { supabaseReadRevisionSets: async () => {
    if (++setReads === 1) throw new Error('set list unavailable');
    return [{ id: 'set-b', title: 'Verified set', status: 'open' }];
  } } };
  const destination = destinationHarness(h, [], { revisionStore: revisions.store, setStore, loadSets: loadRevisionSets });
  const cleanup = h.effects[1]();
  try {
    const listLoad = revisions.store.getState().loadRevisions(); revisions.failures[0](new Error('revision list unavailable')); await listLoad;
    h.lookups[0].resolve({ ...revision, setId: 'set-b' }); await flush();
    destination.consume('hub', false); await flush();
    assert.equal(setReads, 1); assert.equal(setStore.getState().loading, false);
    assert.equal(destination.warnings.length, 1); assert.equal(h.app.pendingRetakeId, 'r1');
    destination.consume('hub', false); assert.equal(setReads, 1, 'failed metadata does not retry in a render loop');
    destination.warnings[0][1].action.onClick(); await flush(); destination.consume('hub', false);
    assert.equal(setReads, 2); assert.deepEqual(destination.focused, ['r1']);
    assert.equal(setStore.getState().selectedSetId, 'set-b'); assert.equal(h.app.pendingRetakeId, null);
    assert.equal(revisions.store.getState().lastLoadTime, null);
  } finally { cleanup?.(); console.error = originalError; (globalThis as any).window = oldWindow; }
});

test('an already-open hub retries a failed later set page and selects the verified set beyond row 1000', async () => {
  const h = await hookHarness('r1'); h.app.currentView = 'retake-hub';
  const revisions = await revisionLoadHarness();
  const { useRevisionSetStore: setStore } = await loadSource('src/stores/useRevisionSetStore.ts', { zustand: { create: createStore } });
  const retainedSet = { id: 'set-00000', title: 'Previously loaded set', status: 'open' };
  setStore.setState({ sets: [retainedSet] });
  const { loadRevisionSets } = await loadSource('src/services/revisionSetService.ts', {
    '../stores/useRevisionSetStore': { useRevisionSetStore: setStore }, '../stores/useRevisionStore': { useRevisionStore: revisions.store },
    './revisionService': { setRevisionSet: () => {} },
  });
  const backend = revisionSetReadHarness(undefined, { cap: 200, failAt: 3 });
  const oldWindow = (globalThis as any).window; const originalError = console.error; console.error = () => {};
  (globalThis as any).window = { electronAPI: { supabaseReadRevisionSets: backend.ipcRead } };
  const destination = destinationHarness(h, [], { revisionStore: revisions.store, setStore, loadSets: loadRevisionSets });
  const cleanup = h.effects[1]();
  try {
    h.lookups[0].resolve({ ...revision, setId: 'set-01100' }); await flush();
    destination.consume('hub', false); await flush();
    assert.equal(backend.calls.length, 3); assert.deepEqual(setStore.getState().sets, [retainedSet], 'partial pages never replace the store');
    assert.equal(setStore.getState().loading, false); assert.equal(destination.warnings.length, 1);
    assert.deepEqual(destination.focused, []); assert.equal(h.app.pendingRetakeId, 'r1');
    destination.consume('hub', false); assert.equal(backend.calls.length, 3, 'failure waits for the user retry');
    backend.clearFailure(); destination.warnings[0][1].action.onClick(); await flush(); destination.consume('hub', false);
    assert.equal(setStore.getState().sets.length, 1101); assert.equal(setStore.getState().selectedSetId, 'set-01100');
    assert.deepEqual(destination.focused, ['r1']); assert.equal(h.app.pendingRetakeId, null);
    assert.equal(revisions.store.getState().lastLoadTime, null);
  } finally { cleanup?.(); console.error = originalError; (globalThis as any).window = oldWindow; }
});

test('cached deletion while already in the hub reports absence without consuming a target or cancelling unrelated startup loading', async () => {
  const h = await hookHarness('r1');
  h.app.currentView = 'retake-hub'; h.revisions.revisions.push({ ...revision, setId: 'set-a' });
  const destination = destinationHarness(h);
  let finishWarmup: () => void = () => {};
  h.revisions.loadRevisions = () => new Promise<void>(resolve => { finishWarmup = () => {
    h.revisions.revisions = [{ ...revision, id: 'other-valid' }]; resolve();
  }; });
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = { electronAPI: h.api };
  const cleanupWarmup = h.effects[0](); const cleanup = h.effects[1]();
  try {
    destination.consume('hub'); h.lookups[1].resolve(null); await flush();
    assert.equal(h.app.retakeNavigationRequest, null); assert.equal(h.app.pendingRetakeId, null);
    assert.deepEqual(destination.focused, []); assert.match(h.toasts[0][0], /찾지 못했습니다/);
    finishWarmup(); await flush();
    assert.equal(h.revisions.revisions[0].id, 'other-valid');
    assert.equal(h.app.currentView, 'retake-hub');
  } finally { cleanup?.(); cleanupWarmup?.(); (globalThis as any).window = previousWindow; }
});

test('logout and login synchronously discard verified snapshots before either destination or the hook can consume them', async () => {
  for (const view of ['hub', 'standalone'] as const) for (const nextUser of ['me', 'second']) {
    const h = await hookHarness('r1');
    const cleanup = h.effects[1]();
    h.lookups[0].resolve({ ...revision, setId: view === 'hub' ? 'set-a' : null, description: 'previous account snapshot' }); await flush();
    const captured = { pendingRetakeId: h.app.pendingRetakeId, pendingRetakeTarget: h.app.pendingRetakeTarget };
    const destination = destinationHarness(h);
    h.auth.currentUser = null;
    assert.equal(h.app.pendingRetakeTarget, null, 'auth subscription clears the snapshot before any React effect');
    assert.equal(h.app.retakeNavigationRequest.revisionId, 'r1', 'only the requested ID waits for login');
    const logoutRequest = h.app.retakeNavigationRequest.id;
    // Both changes happen without rendering: the same-user ABA still gets a new generation.
    h.auth.currentUser = { id: nextUser, name: nextUser };
    assert.ok(h.app.retakeNavigationRequest.id > logoutRequest);
    destination.consume(view, false, false, captured);
    assert.deepEqual(destination.focused, []); assert.deepEqual(h.revisions.revisions, []);
    h.render(); const cleanupNext = h.effects[1]();
    try {
      assert.equal(h.lookups.length, 2, 'the new login performs its own canonical lookup');
      h.lookups[1].resolve({ ...revision, setId: view === 'hub' ? 'set-b' : null, description: 'fresh account snapshot' }); await flush();
      destination.consume(view, false);
      assert.deepEqual(destination.focused, ['r1']);
      assert.equal(h.revisions.revisions[0].description, 'fresh account snapshot');
      assert.equal(h.app.pendingRetakeId, null);
    } finally { cleanup?.(); cleanupNext?.(); }
  }
});

test('batched logout-login fences an old lookup and never replaces a newer user navigation request', async () => {
  for (const failed of [true, false]) {
    const h = await hookHarness('r1'); const staleEffect = h.effects[1]; const cleanup = staleEffect();
    const oldId = h.app.retakeNavigationRequest.id;
    h.app.requestRetakeNavigation('newer');
    h.auth.currentUser = null; h.auth.currentUser = { id: 'me', name: 'Me' };
    assert.ok(h.app.retakeNavigationRequest.id > oldId);
    assert.equal(h.app.retakeNavigationRequest.revisionId, 'newer');
    staleEffect(); assert.equal(h.lookups.length, 1, 'a previously rendered effect cannot start another stale lookup');
    if (failed) h.lookups[0].reject(new Error('old session failed'));
    else h.lookups[0].resolve({ ...revision, setId: 'set-a' });
    await flush();
    assert.equal(h.app.pendingRetakeTarget, null); assert.equal(h.toasts.length, 0);
    h.render(); const cleanupNext = h.effects[1]();
    try {
      assert.equal(h.lookups[1].revisionId, 'newer');
      h.lookups[1].resolve({ ...revision, id: 'newer', setId: 'set-b' }); await flush();
      assert.equal(h.app.pendingRetakeTarget.revision.id, 'newer');
    } finally { cleanup?.(); cleanupNext?.(); }
  }
});

test('connection and auth-readiness changes invalidate snapshots atomically and wait for the selected local source', async () => {
  const h = await hookHarness('r1'); const cleanup = h.effects[1]();
  h.lookups[0].resolve({ ...revision, setId: 'set-a', description: 'remote snapshot' }); await flush();
  const captured = { pendingRetakeId: h.app.pendingRetakeId, pendingRetakeTarget: h.app.pendingRetakeTarget };
  const destination = destinationHarness(h);
  h.app.setDataConnected(false);
  assert.equal(h.app.pendingRetakeTarget, null);
  const localId = h.app.retakeNavigationRequest.id;
  h.app.setDataConnected(false); assert.equal(h.app.retakeNavigationRequest.id, localId, 'unchanged source does not restart');
  destination.consume('hub', false, false, captured); assert.deepEqual(destination.focused, []);
  h.revisions.revisions = [{ ...revision, setId: 'set-a', description: 'stale cached remote list' }];
  (h.revisions as any).isLoading = true; h.render(); h.effects[2]();
  assert.equal(h.app.pendingRetakeTarget, null, 'source switch cannot verify old rows before the local load finishes');
  h.revisions.revisions = [{ ...revision, setId: null, description: 'local source' }];
  (h.revisions as any).isLoading = false; h.render(); h.effects[2]();
  assert.equal(h.app.pendingRetakeTarget.revision.description, 'local source');
  h.app.setDataConnected(true); assert.equal(h.app.pendingRetakeTarget, null);
  h.render(); const cleanupNext = h.effects[1]();
  h.auth.authReady = false;
  h.lookups[1].resolve({ ...revision, setId: 'set-a', description: 'before auth reset' }); await flush();
  assert.equal(h.app.pendingRetakeTarget, null);
  const waitingId = h.app.retakeNavigationRequest.id;
  h.auth.authReady = true; assert.ok(h.app.retakeNavigationRequest.id > waitingId);
  h.render(); const cleanupReady = h.effects[1]();
  try {
    h.lookups[2].resolve({ ...revision, setId: 'set-b', description: 'current source and session' }); await flush();
    destination.consume('hub', false);
    assert.equal(h.revisions.revisions.find((item: any) => item.id === 'r1').description, 'current source and session');
  } finally { cleanup?.(); cleanupNext?.(); cleanupReady?.(); }
});

test('a local cached shortcut keeps only its ID before login and cannot install a verified snapshot early', async () => {
  const h = await hookHarness(null, false); h.auth.currentUser = null;
  h.revisions.revisions = [{ ...revision, setId: 'set-a' }];
  const { openRetakeInApp } = await loadSource('src/utils/retakeNavigation.ts', {
    '@/stores/useAppStore': { useAppStore: store(h.app) }, '@/stores/useRevisionStore': { useRevisionStore: store(h.revisions) },
    '@/stores/useAuthStore': { useAuthStore: store(h.auth) },
  });
  openRetakeInApp('r1');
  assert.equal(h.app.pendingRetakeTarget, null); assert.equal(h.app.retakeNavigationRequest.revisionId, 'r1');
  const waitingId = h.app.retakeNavigationRequest.id;
  h.auth.currentUser = { id: 'me', name: 'Me' };
  assert.ok(h.app.retakeNavigationRequest.id > waitingId);
  h.render(); h.effects[2]();
  assert.equal(h.lookups.length, 0); assert.equal(h.app.pendingRetakeTarget.revision.id, 'r1');
});

test('same-ID repeated requests accept only the latest canonical reply', async () => {
  const h = await hookHarness('r1'); const oldCleanup = h.effects[1]();
  const oldId = h.app.retakeNavigationRequest.id;
  h.app.requestRetakeNavigation('r1'); h.render(); const cleanup = h.effects[1]();
  assert.ok(h.app.retakeNavigationRequest.id > oldId);
  h.lookups[1].resolve({ ...revision, setId: 'set-b' }); await flush();
  h.lookups[0].resolve({ ...revision, setId: 'set-a' }); await flush();
  assert.equal(h.app.pendingRetakeTarget.revision.setId, 'set-b');
  oldCleanup?.(); cleanup?.();
});

test('already mounted hub refreshes a missing verified set once and can retry a failed metadata read', async () => {
  const h = await hookHarness('r1'); h.app.currentView = 'retake-hub';
  const cleanup = h.effects[1]();
  h.lookups[0].resolve({ ...revision, setId: 'set-b' }); await flush();
  const destination = destinationHarness(h, ['set-a']);
  destination.consume('hub'); await flush(); destination.consume('hub');
  assert.equal(destination.refreshes(), 1); assert.equal(destination.focused.length, 0);
  assert.equal(destination.warnings.length, 1);
  destination.nextSets(['set-a', 'set-b']); destination.warnings[0][1].action.onClick(); await flush();
  destination.consume('hub');
  assert.equal(destination.refreshes(), 2); assert.deepEqual(destination.selected, ['set-b']);
  assert.deepEqual(destination.focused, ['r1']); cleanup?.();
});

test('local cached widget navigation stays immediate and popup forwarding stays in the main window', async () => {
  const h = await hookHarness(null, false); h.revisions.revisions.push({ ...revision, setId: 'set-a' });
  const { openRetakeInApp } = await loadSource('src/utils/retakeNavigation.ts', {
    '@/stores/useAppStore': { useAppStore: store(h.app) }, '@/stores/useRevisionStore': { useRevisionStore: store(h.revisions) },
    '@/stores/useAuthStore': { useAuthStore: store(h.auth) },
  });
  openRetakeInApp('r1'); assert.equal(h.app.currentView, 'retake-hub'); assert.equal(h.lookups.length, 0);
  const destination = destinationHarness(h); destination.consume('hub');
  assert.deepEqual(destination.focused, ['r1']);
  const previousWindow = (globalThis as any).window; const forwarded: any[] = [];
  (globalThis as any).window = { electronAPI: { widgetNavigateMain: (payload: any) => forwarded.push(payload) } };
  try { openRetakeInApp('r1', { fromPopup: true }); assert.equal(forwarded[0].revisionId, 'r1'); }
  finally { (globalThis as any).window = previousWindow; }
});

test('a verified navigation snapshot prevents older in-flight list responses from replacing the target', async () => {
  const h = await revisionLoadHarness();
  h.store.setState({ revisions: [{ ...revision, setId: 'set-a' }] });
  const oldRead = h.store.getState().loadRevisions();
  h.store.getState().applyNavigationRevision('r1', { ...revision, setId: 'set-b' });
  h.requests[0]([{ ...revision, setId: 'set-a' }]); await oldRead;
  assert.equal(h.store.getState().revisions[0].setId, 'set-b');
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
