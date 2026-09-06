import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/shared/retakeNotifications.ts';
import * as deepLinks from '../src/shared/bflowDeepLink.ts';
import type { RetakeNotificationDependencies } from '../electron/retakeNotificationService.ts';
import type { RetakeDeliveryEvent, RetakeNotificationActor, RetakeNotificationRecord, RetakeReminderPayload } from '../src/shared/retakeNotifications.ts';

// Electron's bundler resolves extensionless imports. Load the same source with two explicit shared dependencies.
const source = fs.readFileSync(new URL('../electron/retakeNotificationService.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
vm.runInThisContext(`(function(require, exports) { ${compiled}\n})`)((id: string) => {
  if (id === '../src/shared/retakeNotifications') return contracts;
  if (id === '../src/shared/bflowDeepLink') return deepLinks;
  throw new Error(`Unexpected dependency ${id}`);
}, moduleExports);
const { RetakeNotificationService, buildRetakeWorkflowPayload } = moduleExports as typeof import('../electron/retakeNotificationService.ts');

function harness(overrides: Partial<RetakeNotificationDependencies> = {}) {
  let actor: RetakeNotificationActor = { id: 'requester', name: '등록자', slackId: 'U_REQUESTER', role: 'user', epoch: 1 };
  const revision: RetakeNotificationRecord = {
    id: 'retake-123', requesterId: actor.id, sceneKey: 'EP01:A:35', revisionNo: 2, description: '배경 수정',
    assigneeIds: ['pending', 'working', 'done', 'missing', 'pending', 'requester'],
    assigneeStates: { working: { state: 'in_progress' }, done: { state: 'done' } }, setId: 'set-1',
  };
  const sent: Array<Record<string, string>> = [];
  const broadcasts: RetakeReminderPayload[] = [];
  let now = 100_000;
  const deps: RetakeNotificationDependencies = {
    getActor: async () => ({ ...actor }),
    isActorCurrent: (captured) => captured.id === actor.id && captured.epoch === actor.epoch,
    readRevision: async () => revision,
    readUsers: async () => [{ ...actor }, { id: 'pending', slackId: 'U_PENDING' }, { id: 'working', slackId: 'U_WORKING' }],
    sendSlack: async (payload) => { sent.push(payload); },
    broadcast: (payload) => { broadcasts.push(payload); return true; },
    now: () => now,
    createEventId: () => 'event-1',
    ...overrides,
  };
  return {
    service: new RetakeNotificationService(deps), revision, sent, broadcasts,
    setActor: (next: RetakeNotificationActor) => { actor = next; },
    advance: () => { now += contracts.RETAKE_REMINDER_COOLDOWN_MS; },
  };
}

test('assignment delivers only unfinished other assignees and reports missing Slack IDs separately', async () => {
  const h = harness();
  const result = await h.service.notifyAssignment(h.revision.id);
  assert.deepEqual(result.recipients, ['pending', 'working', 'missing']);
  assert.deepEqual(result.slackSentUserIds, ['pending', 'working']);
  assert.deepEqual(result.slackMissingUserIds, ['missing']);
  assert.equal(result.status, 'partial');
  assert.equal(h.broadcasts.length, 0); // canonical INSERT is the initial in-app signal
  assert.equal(h.sent.length, 2);
  assert.deepEqual(Object.keys(h.sent[0]).sort(), ['comment', 'EP', 'time', 'scene', 'name_my', 'name_target', 'part', 'deep_link'].sort());
  assert.equal(h.sent[0].deep_link, 'bflow://retake/retake-123');
  assert.match(h.sent[0].comment, /리테이크 확인하기/);
});

test('Slack partial failure leaves successful deliveries intact and does not reject saved assignment', async () => {
  const h = harness({ sendSlack: async (payload) => { if (payload.name_target === 'U_PENDING') throw new Error('network'); } });
  const result = await h.service.notifyAssignment(h.revision.id);
  assert.deepEqual(result.slackFailedUserIds, ['pending']);
  assert.deepEqual(result.slackSentUserIds, ['working']);
  assert.equal(result.status, 'partial');
  const unavailable = harness({ readRevision: async () => { throw new Error('offline'); } });
  const failed = await unavailable.service.notifyAssignment('saved-id');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error!, /저장됐지만/);
});

test('manual reminder requires canonical requester or compositor and never trusts renderer recipient input', async () => {
  const h = harness();
  h.setActor({ id: 'outsider', name: '외부 사용자', role: 'user', epoch: 1 });
  await assert.rejects(h.service.remind(h.revision.id), /등록자 또는 컴포지터/);
  assert.equal(h.sent.length, 0);
  h.setActor({ id: 'compositor', name: '컴포지터', isCompositor: true, epoch: 1 });
  assert.equal((await h.service.remind(h.revision.id)).status, 'partial');
  assert.equal(h.broadcasts[0].senderId, 'compositor');
  assert.equal(h.broadcasts[0].revisionId, h.revision.id);
});

test('simultaneous calls share one send and rapid retries return explicit cooldown', async () => {
  const h = harness();
  const results = await Promise.all([h.service.remind(h.revision.id), h.service.remind(h.revision.id)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(h.sent.length, 2);
  assert.equal(h.broadcasts.length, 1);
  assert.equal((await h.service.remind(h.revision.id)).status, 'cooldown');
  assert.equal((await h.service.remind(h.revision.id)).cooldownSeconds, 30);
  h.advance();
  await h.service.remind(h.revision.id);
  assert.equal(h.broadcasts.length, 2);
});

test('session switch during lookup prevents all notification effects', async () => {
  const h = harness({ isActorCurrent: () => false });
  await assert.rejects(h.service.remind(h.revision.id), /로그인이 변경/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.broadcasts.length, 0);
});

test('completed and deleted retakes do not send reminders', async () => {
  const h = harness();
  h.revision.finalResolvedAt = '2026-09-07T00:00:00Z';
  assert.equal((await h.service.remind(h.revision.id)).status, 'nothing-to-send');
  assert.equal(h.sent.length, 0);
  assert.equal(h.broadcasts.length, 0);
  const deleted = harness({ readRevision: async () => null });
  await assert.rejects(deleted.service.remind('deleted'), /찾을 수 없어요/);
});

test('general items keep exact retake identity and all workflow variables are strings', () => {
  const payload = buildRetakeWorkflowPayload({ id: 'general-1', requesterId: 'a', sceneKey: '', revisionNo: 1, description: '전반 수정' }, { id: 'a', name: 'A', slackId: 'UA' }, 'UB', true, 0);
  assert.equal(payload.scene, '전반');
  assert.equal(payload.EP, '전반');
  assert.equal(payload.deep_link, 'bflow://retake/general-1');
  assert.ok(Object.values(payload).every((value) => typeof value === 'string'));
});

test('reminder waits for asynchronous broadcast and reports partial when Slack succeeds but app delivery fails', async () => {
  let finishBroadcast: (ok: boolean) => void = () => {};
  const h = harness({ broadcast: () => new Promise<boolean>((resolve) => { finishBroadcast = resolve; }) });
  h.revision.assigneeIds = ['pending'];
  const pending = h.service.remind(h.revision.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.sent.length, 0, 'asynchronous broadcast must settle before later delivery effects');
  finishBroadcast(false);
  const result = await pending;
  assert.equal(result.inAppBroadcast, false);
  assert.deepEqual(result.slackSentUserIds, ['pending']);
  assert.equal(result.status, 'partial');
  const rejected = harness({ broadcast: async () => { throw new Error('channel failed'); } });
  rejected.revision.assigneeIds = ['pending'];
  assert.equal((await rejected.service.remind(rejected.revision.id)).status, 'partial');
});

test('assignment retains pre-insert actor epoch across an A-B-A login sequence without rejecting the saved record', async () => {
  const h = harness();
  const captured = await h.service.captureActor();
  h.setActor({ id: 'other', name: 'Other', role: 'admin', epoch: 2 });
  h.setActor({ id: 'requester', name: '등록자', slackId: 'U_REQUESTER', role: 'user', epoch: 3 });
  const result = await h.service.notifyAssignment(h.revision.id, captured);
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /저장됐지만/);
  assert.equal(h.sent.length, 0);
  assert.equal(h.broadcasts.length, 0);
});

test('session change while waiting for broadcast prevents subsequent Slack delivery', async () => {
  let finishBroadcast: (ok: boolean) => void = () => {};
  const h = harness({ broadcast: () => new Promise<boolean>((resolve) => { finishBroadcast = resolve; }) });
  const pending = h.service.remind(h.revision.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.setActor({ id: 'requester', name: '등록자', epoch: 3 });
  finishBroadcast(true);
  const result = await pending;
  assert.equal(result.status, 'partial');
  assert.equal(h.sent.length, 0);
});

test('queued Slack sends retain the captured actor epoch and are cancelled after an A-B-A session change', async () => {
  let releaseQueue: () => void = () => {};
  const queue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  const guards: Array<() => boolean> = [];
  const delivered: string[] = [];
  const h = harness({ sendSlack: async (payload, isCurrent) => {
    assert.ok(isCurrent, 'transport must receive a guard for its later fetch');
    guards.push(isCurrent);
    await queue;
    if (!isCurrent()) throw new Error('cancelled before fetch');
    delivered.push(payload.name_target);
  } });
  h.revision.assigneeIds = ['pending', 'working'];
  const pending = h.service.notifyAssignment(h.revision.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(guards.length, 2);
  assert.ok(guards.every((guard) => guard()));
  h.setActor({ id: 'other', name: '다른 사용자', epoch: 2 });
  h.setActor({ id: 'requester', name: '등록자', epoch: 3 });
  assert.ok(guards.every((guard) => !guard()));
  releaseQueue();
  const result = await pending;
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.slackFailedUserIds.sort(), ['pending', 'working']);
  assert.deepEqual(delivered, []);
});

function loadIsolatedFunction(file: string, functionName: string, contextValues: Record<string, unknown> = {}) {
  const fileSource = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, fileSource, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === functionName);
  assert.ok(node, `missing function ${functionName}`);
  const javascript = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = vm.createContext({ ...contextValues, exports: {} });
  vm.runInContext(javascript, context);
  return { run: context.exports[functionName] as (...args: any[]) => any, context, fileSource };
}

test('main workflow adapter gives the shared transport a session guard for comments and the captured retake guard', async () => {
  let epoch = 1;
  const calls: Array<{ url: string; options: { isCurrent: () => boolean; timeoutMs?: number; tag: string } }> = [];
  const { context } = loadIsolatedFunction('../electron/main.ts', 'postSlackWebhook', {
    sessionManager: { getCanonicalUserId: () => 'requester', getEpoch: () => epoch },
    slackWorkflowTransport: { send: async (url, _payload, options) => { calls.push({ url, options }); return { ok: true }; } },
  });
  const send = context.postSlackWebhook as (...args: any[]) => Promise<{ ok: boolean }>;
  await send('https://example.test/workflow', { comment: 'comment' }, 'Slack Webhook');
  assert.equal(calls[0].options.isCurrent(), true);
  epoch = 3; // the same user can return after a different login
  assert.equal(calls[0].options.isCurrent(), false);
  let capturedActorCurrent = true;
  const capturedGuard = () => capturedActorCurrent;
  await send('https://example.test/workflow', { comment: 'retake' }, 'Retake Slack', 8000, capturedGuard);
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[1].options.isCurrent, capturedGuard);
  assert.equal(calls[1].options.timeoutMs, 8000);
  capturedActorCurrent = false;
  assert.equal(calls[1].options.isCurrent(), false);
});

test('notification canonical mapping derives assigned state, removes ghost assignees, and retains legacy resolved state', async () => {
  const { run: mapRevision } = loadIsolatedFunction('../electron/supabase.ts', 'mapRevision');
  const raw = { id: 'retake-123', requester_id: 'requester', scene_id: 'EP01:A:1', revision_no: 1,
    status: 'resolved', notify_user_ids: ['pending'], assignee_ids: ['pending', 'ghost'],
    assignee_states: { ghost: { state: 'pending' } }, final_resolved_at: null };
  const normalized = mapRevision(raw);
  assert.equal(normalized.status, 'open', 'stale resolved cache is ignored when a real assignee is pending');
  assert.deepEqual(Array.from(normalized.assigneeIds), ['pending']);
  assert.equal(normalized.assigneeStates.pending.state, 'pending');
  assert.equal(normalized.assigneeStates.ghost, undefined);
  const h = harness({ readRevision: async () => normalized });
  assert.deepEqual((await h.service.notifyAssignment('retake-123')).recipients, ['pending']);
  const legacy = mapRevision({ ...raw, assignee_ids: [], final_resolved_at: '2020-01-01T00:00:00Z' });
  assert.equal(legacy.status, 'resolved');
  assert.equal(legacy.finalResolvedAt, undefined);
  assert.deepEqual(Array.from(contracts.unfinishedRetakeAssigneeIds(legacy)), []);
  const main = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /readRevision: sbReadRevisionById/);
});

test('broadcast adapter waits for server acknowledgement and treats error or timeout as failure', async () => {
  let complete: (value: string) => void = () => {};
  let sendArgs: any[] = [];
  const { run, context, fileSource } = loadIsolatedFunction('../electron/broadcast.ts', 'broadcastRetakeReminder', {
    broadcastConnected: true,
    broadcastChannel: { send: (...args: any[]) => {
      sendArgs = args;
      return new Promise<string>((resolve) => { complete = resolve; });
    } },
  });
  assert.match(fileSource, /channel\('bflow-broadcast',\s*\{ config: \{ broadcast: \{ ack: true \} \} \}\)/);
  let settled = false;
  const pending = run({ revisionId: 'r1' }).then((value: boolean) => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(sendArgs[0].event, 'retake-reminder');
  assert.equal(sendArgs[1].timeout, 8_000);
  complete('ok'); assert.equal(await pending, true);
  for (const response of ['error', 'timed out']) {
    context.broadcastChannel = { send: async () => response };
    assert.equal(await run({ revisionId: 'r1' }), false);
  }
  context.broadcastConnected = false;
  assert.equal(await run({ revisionId: 'r1' }), false);
});

test('reassignment with unchanged overall status sends Slack and app notice only to newly assigned users', async () => {
  const h = harness();
  h.revision.assigneeIds = ['pending'];
  h.revision.status = 'open';
  h.revision.assigneeStates = {};
  const context = await h.service.captureReassignment(h.revision.id, JSON.stringify(['pending', 'working']));
  h.revision.assigneeIds = ['pending', 'working']; // canonical UPDATE succeeds while status stays open
  const result = await h.service.notifyReassignment(h.revision.id, context);
  assert.deepEqual(result.recipients, ['working']);
  assert.deepEqual(result.slackSentUserIds, ['working']);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].name_target, 'U_WORKING');
  assert.match(h.sent[0].comment, /새 리테이크 배정/);
  assert.equal(h.broadcasts[0].kind, 'assignment');
  assert.equal(h.broadcasts[0].eventId, 'event-1');
  assert.deepEqual(h.broadcasts[0].recipients, ['working']);
});

test('unchanged assignment and removal-only updates produce no new notifications', async () => {
  for (const requested of [['pending', 'working'], ['pending']]) {
    const h = harness();
    h.revision.assigneeIds = ['pending', 'working'];
    const context = await h.service.captureReassignment(h.revision.id, JSON.stringify(requested));
    h.revision.assigneeIds = requested;
    assert.equal((await h.service.notifyReassignment(h.revision.id, context)).status, 'nothing-to-send');
    assert.equal(h.sent.length, 0); assert.equal(h.broadcasts.length, 0);
  }
});

test('new assignment difference is intersected with current unfinished canonical assignees', async () => {
  const h = harness();
  h.revision.assigneeIds = ['pending'];
  const context = await h.service.captureReassignment(h.revision.id, JSON.stringify(['pending', 'working', 'done', 'requester']));
  h.revision.assigneeIds = ['pending', 'done', 'requester', 'missing'];
  h.revision.assigneeStates = { done: { state: 'done' } };
  const result = await h.service.notifyReassignment(h.revision.id, context);
  assert.equal(result.status, 'nothing-to-send');
  assert.equal(h.sent.length, 0);
  assert.equal(h.broadcasts.length, 0);
});

test('reassignment partial failure preserves the update and stale captured actor sends nothing', async () => {
  const h = harness({ broadcast: async () => false });
  h.revision.assigneeIds = [];
  const context = await h.service.captureReassignment(h.revision.id, JSON.stringify(['working']));
  h.revision.assigneeIds = ['working'];
  assert.equal((await h.service.notifyReassignment(h.revision.id, context)).status, 'partial');
  const stale = harness();
  stale.revision.assigneeIds = [];
  const captured = await stale.service.captureReassignment(stale.revision.id, JSON.stringify(['working']));
  stale.revision.assigneeIds = ['working'];
  stale.setActor({ id: 'requester', name: '등록자', epoch: 3 });
  assert.equal((await stale.service.notifyReassignment(stale.revision.id, captured)).status, 'failed');
  assert.equal(stale.sent.length, 0); assert.equal(stale.broadcasts.length, 0);
});

test('main update handler never emits reassignment notifications when persistence rejects', async () => {
  const main = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const registration = ast.statements.find((node) => node.getText(ast).startsWith("ipcMain.handle('supabase:update-revision'"));
  assert.ok(registration);
  const js = ts.transpileModule(registration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const h = harness(); h.revision.assigneeIds = ['pending'];
  let handler: (...args: any[]) => Promise<unknown> = async () => {};
  new Function('ipcMain', 'wrapIpc', 'retakeNotificationService', 'sbUpdateRevision', js)(
    { handle: (_name: string, callback: typeof handler) => { handler = callback; } },
    (callback: typeof handler) => callback, h.service,
    async () => { throw new Error('write refused'); },
  );
  await assert.rejects(handler({}, h.revision.id, { assigneeIds: '["pending","working"]', __op: 'reassign' }), /write refused/);
  assert.equal(h.sent.length, 0); assert.equal(h.broadcasts.length, 0);
});

function mainPersistenceHarness(options: { directoryFails?: boolean; sendSlack?: () => Promise<void> } = {}) {
  const main = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const statements = ast.statements.filter((node) => {
    const text = node.getText(ast);
    return text.startsWith('const retakeNotificationService =')
      || text.startsWith("ipcMain.handle('supabase:add-revision'")
      || text.startsWith("ipcMain.handle('supabase:update-revision'");
  });
  assert.equal(statements.length, 3, 'exercise the actual main service wiring and both persistence handlers');
  const javascript = ts.transpileModule(statements.map((node) => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let user = { id: 'requester', name: '요청자', role: 'user', isCompositor: true, slackId: 'U_REQUESTER' };
  let epoch = 1;
  let changeDuringEnsure = false;
  const events: string[] = [];
  const deliveryEvents: Array<{ channel: string; event: { event: string; payload: RetakeDeliveryEvent } }> = [];
  const revision: RetakeNotificationRecord = {
    id: 'retake-main', requesterId: user.id, sceneKey: 'EP01:A:1', revisionNo: 1,
    description: '수정 요청', assigneeIds: ['pending'], assigneeStates: {},
  };
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const context = vm.createContext({
    RetakeNotificationService,
    sessionManager: {
      ensure: async () => {
        const result = { ok: true, payload: { user: { ...user }, epoch } };
        if (changeDuringEnsure) { user = { ...user, id: 'another-user' }; epoch += 1; }
        return result;
      },
      getCanonicalUserId: () => user.id, getEpoch: () => epoch,
    },
    sbReadUsers: async () => {
      events.push('directory');
      if (options.directoryFails !== false) throw new Error('directory unavailable');
      return [{ ...user }, { id: 'pending', slackId: 'U_PENDING' }, { id: 'working', slackId: 'U_WORKING' }];
    },
    sbReadRevisionById: async () => { events.push('read-revision'); return revision; },
    sbAddRevision: async () => { events.push('insert'); },
    sbUpdateRevision: async (_id: string, updates: Record<string, string>) => {
      events.push('update'); revision.assigneeIds = JSON.parse(updates.assigneeIds); return { affected: true };
    },
    postSlackWebhook: async () => { events.push('slack'); await options.sendSlack?.(); },
    SLACK_WEBHOOK_URL: 'https://example.invalid/workflow',
    broadcastRetakeReminder: async () => { events.push('broadcast'); return true; },
    broadcastToAllWindows: (channel: string, event: { event: string; payload: RetakeDeliveryEvent }) => { deliveryEvents.push({ channel, event }); },
    randomUUID: () => 'event-main',
    ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) },
    wrapIpc: (callback: unknown) => callback,
    currentActivityUser: null,
  });
  vm.runInContext(javascript, context);
  return {
    events, revision, deliveryEvents,
    changeSessionDuringEnsure: () => { changeDuringEnsure = true; },
    changeSessionAwayAndBack: () => { epoch += 2; },
    create: () => handlers.get('supabase:add-revision')!({}, revision.id, 'part-id', revision.sceneKey, 1, 'open', 'normal',
      revision.description, '', '', 'bg', 'bg', 'requester', '요청자', '', '2026-09-07T00:00:00Z', '["pending"]', '["pending"]'),
    reassign: () => handlers.get('supabase:update-revision')!({}, revision.id, { assigneeIds: '["pending","working"]', __op: 'reassign' }),
  };
}

test('valid canonical session still INSERTs when the notification directory fails, reporting failure separately without rollback', async () => {
  const h = mainPersistenceHarness();
  const result = await h.create();
  assert.equal(result, undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.deliveryEvents[0].event.payload.delivery.status, 'failed');
  assert.match(h.deliveryEvents[0].event.payload.delivery.error!, /저장됐지만/);
  assert.deepEqual(h.events, ['insert', 'read-revision', 'directory']);
});

test('canonical reassignment persists before notification directory failure and retains the assigned users', async () => {
  const h = mainPersistenceHarness();
  const result = await h.reassign();
  assert.equal(result, undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.deliveryEvents[0].event.payload.delivery.status, 'failed');
  assert.match(h.deliveryEvents[0].event.payload.delivery.error!, /변경됐지만/);
  assert.deepEqual(h.events, ['read-revision', 'update', 'read-revision', 'directory']);
  assert.deepEqual(h.revision.assigneeIds, ['pending', 'working']);
});

test('INSERT and reassignment return before slow Slack finishes and later report the failure to the sender', async () => {
  for (const action of ['create', 'reassign'] as const) {
    let rejectSlack!: (error: Error) => void;
    const slowSlack = new Promise<void>((_resolve, reject) => { rejectSlack = reject; });
    const h = mainPersistenceHarness({ directoryFails: false, sendSlack: () => slowSlack });
    let returned = false;
    const save = h[action]().then((result) => { assert.equal(result, undefined); returned = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, true, 'a pending Slack timeout must not keep the save dialog open');
    assert.ok(h.events.includes(action === 'create' ? 'insert' : 'update'));
    assert.ok(h.events.includes('slack'));
    assert.equal(h.deliveryEvents.length, 0);
    rejectSlack(new Error('slow Slack failed'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await save;
    assert.equal(h.deliveryEvents.length, 1);
    const event = h.deliveryEvents[0];
    assert.equal(event.channel, 'supabase:broadcast-event');
    assert.equal(event.event.event, 'retake-delivery-result');
    assert.equal(event.event.payload.userId, 'requester');
    assert.equal(event.event.payload.epoch, 1);
    assert.equal(event.event.payload.kind, action === 'create' ? 'assignment' : 'reassignment');
    assert.equal(event.event.payload.delivery.status, action === 'create' ? 'failed' : 'partial');
    assert.equal(event.event.payload.delivery.slackFailedUserIds.length, 1);
  }
});

test('late background delivery results are discarded after the sender leaves and returns with a new epoch', async () => {
  let rejectSlack!: (error: Error) => void;
  const slowSlack = new Promise<void>((_resolve, reject) => { rejectSlack = reject; });
  const h = mainPersistenceHarness({ directoryFails: false, sendSlack: () => slowSlack });
  await h.create();
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.changeSessionAwayAndBack();
  rejectSlack(new Error('old request failed'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.deliveryEvents.length, 0);
  assert.equal(h.events.filter((event) => event === 'insert').length, 1);
});

test('closed result listeners cannot produce an unhandled rejection or undo background persistence', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const h = harness({ onDeliveryResult: async () => { throw new Error('renderer closed'); } });
  const actor = await h.service.captureActor();
  assert.equal(h.service.startAssignmentDelivery(h.revision.id, actor), undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(h.sent.length, 2);
});

test('preload filters queued delivery results using the current canonical epoch and preserves other broadcasts', () => {
  const preload = fs.readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('preload.ts', preload, ts.ScriptTarget.Latest, true);
  let subscription: ts.PropertyAssignment | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onSupabaseBroadcast') subscription = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(subscription);
  const javascript = ts.transpileModule(`const subscribe = ${subscription.initializer.getText(ast)}; globalThis.subscribe = subscribe;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  let listener: ((_event: unknown, data: unknown) => void) | undefined;
  const context = vm.createContext({ canonicalSessionEpoch: 1, ipcRenderer: {
    on: (_channel: string, handler: typeof listener) => { listener = handler; },
    removeListener: () => { listener = undefined; },
  } });
  vm.runInContext(javascript, context);
  const received: unknown[] = [];
  const unsubscribe = context.subscribe((event: unknown) => received.push(event));
  listener!({}, { event: 'retake-delivery-result', payload: { userId: 'requester', epoch: 1 } });
  assert.equal(received.length, 1);
  context.canonicalSessionEpoch = 3;
  listener!({}, { event: 'retake-delivery-result', payload: { userId: 'requester', epoch: 1 } });
  assert.equal(received.length, 1, 'same-user results from a previous login must not reach React');
  listener!({}, { event: 'retake-delivery-result', payload: { userId: 'requester', epoch: 3 } });
  listener!({}, { event: 'retake-reminder', payload: { recipients: ['requester'] } });
  assert.equal(received.length, 3);
  unsubscribe();
  assert.equal(listener, undefined);
});

test('canonical session changes still block INSERT and reassignment before any persistence or notification', async () => {
  for (const action of ['create', 'reassign'] as const) {
    const h = mainPersistenceHarness();
    h.changeSessionDuringEnsure();
    await assert.rejects(h[action](), /로그인이 필요/);
    assert.deepEqual(h.events, []);
  }
});

test('post-save directory enrichment uses fresh Slack metadata and rejects newly revoked send privileges', async () => {
  const h = harness({ readUsers: async () => [
    { id: 'requester', name: '새 이름', role: 'user', slackId: 'U_FRESH' },
    { id: 'pending', slackId: 'U_PENDING' },
  ] });
  h.revision.assigneeIds = ['pending'];
  assert.equal((await h.service.notifyAssignment(h.revision.id)).status, 'sent');
  assert.equal(h.sent[0].name_my, 'U_FRESH');
  const demoted = harness({ readUsers: async () => [
    { id: 'reviewer', name: '검수자', role: 'user', isCompositor: false, slackId: 'U_REVIEWER' },
    { id: 'pending', slackId: 'U_PENDING' },
  ] });
  demoted.setActor({ id: 'reviewer', name: '검수자', role: 'admin', isCompositor: true, epoch: 1 });
  demoted.revision.assigneeIds = ['pending'];
  assert.equal((await demoted.service.notifyAssignment(demoted.revision.id)).status, 'failed');
  await assert.rejects(demoted.service.remind(demoted.revision.id), /등록자 또는 컴포지터/);
  assert.equal(demoted.sent.length, 0); assert.equal(demoted.broadcasts.length, 0);
});
