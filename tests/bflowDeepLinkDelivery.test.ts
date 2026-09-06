import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { parseBflowDeepLink } from '../src/shared/bflowDeepLink.ts';

function contract(path: string, start: string, end: string): string {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing contract in ${path}`);
  return ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const mainContract = contract('../electron/main.ts', '// ─── 딥링크 전달 준비 계약 ─', '// ─── 딥링크 전달 준비 계약 끝');
const preloadContract = contract('../electron/preload.ts', '// ─── 딥링크 구독 준비 계약 ─', '// ─── 딥링크 구독 준비 계약 끝');
const launchContract = contract('../electron/main.ts', '/** 딥링크 파일에 URL 기록', '/**\n * v1.22.3');
type Message = { channel: string; args: any[]; target?: EventEmitter; event?: any };

let instanceSequence = 0;
function harness(files = new Map<string, string>()) {
  const instanceId = ++instanceSequence;
  const ipcMain = new EventEmitter();
  const toMain: Message[] = [];
  const toRenderer: Message[] = [];
  let renderer: EventEmitter;
  let ready = false;
  let shown = 0;
  let documentSequence = 0;
  let gotLock = true;
  let lockData: any;
  const polls: Array<() => void> = [];
  const app = Object.assign(new EventEmitter(), { isReady: () => ready,
    requestSingleInstanceLock: (data: unknown) => { lockData = data; return gotLock; },
    setAsDefaultProtocolClient: () => true, exit: () => {} });
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { processId: 1, routingId: 1 },
    send: (channel: string, ...args: any[]) => toRenderer.push({ channel, args, target: renderer }),
  });
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const context = vm.createContext({
    ipcMain, mainWindow: null, parseBflowDeepLink, randomUUID: () => `instance-${instanceId}-${++documentSequence}`,
    app, showMainWindow: () => ++shown, path, PROTOCOL: 'bflow', DEEPLINK_FILE: 'deeplink.txt',
    console: { log: () => {}, error: () => {} },
    setInterval: (callback: () => void) => { polls.push(callback); return polls.length; }, setTimeout: () => 0,
    fs: { existsSync: (file: string) => files.has(file), mkdirSync: () => {},
      writeFileSync: (file: string, text: string) => files.set(file, text),
      readFileSync: (file: string) => files.get(file), unlinkSync: (file: string) => files.delete(file) },
  });
  vm.runInContext(mainContract, context);
  function newRenderer() {
    renderer = Object.assign(new EventEmitter(), {
      send: (channel: string, ...args: any[]) => toMain.push({
        channel, args, event: { sender: contents, senderFrame: contents.mainFrame },
      }),
    });
    const preload = vm.createContext({ ipcRenderer: renderer });
    vm.runInContext(preloadContract, preload);
    return { subscribe: (callback: (data: unknown) => void) => preload.subscribeDeepLink(callback) as () => void };
  }
  function drainMain() {
    while (toMain.length) {
      const message = toMain.shift()!;
      ipcMain.emit(message.channel, message.event, ...message.args);
    }
  }
  function drainRenderer() {
    while (toRenderer.length) {
      const message = toRenderer.shift()!;
      message.target?.emit(message.channel, {}, ...message.args);
    }
  }
  return {
    contents, win, toMain, toRenderer, ipcMain,
    boot: (ownsLock: boolean, argv: string[] = []) => {
      gotLock = ownsLock; context.process = { argv, env: {}, execPath: 'app.exe' };
      vm.runInContext(launchContract, context);
    },
    lockData: () => lockData,
    secondInstance: (argv: string[], data?: unknown) => app.emit('second-instance', {}, argv, '.', data),
    pollFile: () => polls.forEach(poll => poll()),
    sequence: () => vm.runInContext('deepLinkSequence', context),
    seenCount: () => vm.runInContext('seenDeepLinkLaunchIds.size', context),
    queue: (url: string, launchId?: string) => context.sendDeepLinkToRenderer(url, launchId),
    attach: () => { ready = true; context.mainWindow = win; context.bindDeepLinkWindow(win); return newRenderer(); },
    reload: () => { contents.emit('did-start-navigation', {}, 'app://index', false, true); return newRenderer(); },
    domReady: () => contents.emit('dom-ready'),
    pending: () => vm.runInContext('pendingDeepLink?.data ?? null', context),
    shown: () => shown,
    drainMain, drainRenderer,
    settle: () => { for (let i = 0; i < 8 && (toMain.length || toRenderer.length); i++) { drainRenderer(); drainMain(); } },
  };
}

test('cold launch keeps a link through DOM load until the application subscribes', () => {
  const h = harness();
  const received: unknown[] = [];
  h.queue('bflow://retake/cold-start');
  assert.equal(h.shown(), 0);
  const renderer = h.attach();
  h.domReady();
  h.settle();
  h.contents.emit('did-finish-load');
  assert.deepEqual(h.pending(), { revisionId: 'cold-start' });
  assert.deepEqual(received, []);
  renderer.subscribe(data => received.push(data));
  h.settle();
  assert.deepEqual(received, [{ revisionId: 'cold-start' }]);
  assert.equal(h.pending(), null);
});

test('the latest valid request wins while startup or login is pending and handled links do not replay', () => {
  const h = harness();
  h.queue('bflow://retake/initial-argv');
  h.queue('bflow://scene/EP01_A_BG/%EC%94%AC1');
  h.queue('bflow://retake/invalid/path');
  const renderer = h.attach();
  const received: unknown[] = [];
  renderer.subscribe(data => received.push(data));
  h.domReady();
  h.settle();
  assert.deepEqual(received, [{ sheetName: 'EP01_A_BG', sceneId: '씬1' }]);
  h.reload().subscribe(data => received.push(data));
  h.domReady();
  h.settle();
  assert.equal(received.length, 1);
});

test('a reload rejects stale document readiness and keeps an unacknowledged link for the new document', () => {
  const h = harness();
  const first = h.attach();
  first.subscribe(() => assert.fail('old document must not receive the new delivery'));
  h.domReady();
  h.drainRenderer();
  const staleReady = h.toMain.shift()!;
  h.queue('bflow://retake/reload');
  const next = h.reload();
  h.ipcMain.emit(staleReady.channel, staleReady.event, ...staleReady.args);
  assert.equal(h.toRenderer.length, 0);
  h.domReady();
  h.settle();
  // Even the same webContents/frame identifiers cannot make an old document ready.
  h.ipcMain.emit(staleReady.channel, staleReady.event, ...staleReady.args);
  assert.equal(h.toRenderer.length, 0);
  const received: unknown[] = [];
  next.subscribe(data => received.push(data));
  h.settle();
  assert.deepEqual(received, [{ revisionId: 'reload' }]);
  assert.equal(h.pending(), null);
});

test('unsubscribe between ready and delivery preserves the link for the replacement subscription', () => {
  const h = harness();
  const renderer = h.attach();
  const received: unknown[] = [];
  const oldCleanup = renderer.subscribe(() => assert.fail('unmounted subscription'));
  h.domReady();
  h.settle();
  h.queue('bflow://retake/strict-mode');
  oldCleanup();
  renderer.subscribe(data => received.push(data));
  oldCleanup(); // A delayed duplicate cleanup cannot unregister the new listener.
  h.settle();
  assert.deepEqual(received, [{ revisionId: 'strict-mode' }]);
  assert.equal(h.pending(), null);
});

test('an old receipt cannot remove a newer pending request', () => {
  const h = harness();
  const renderer = h.attach();
  const received: unknown[] = [];
  renderer.subscribe(data => received.push(data));
  h.domReady();
  h.settle();
  h.queue('bflow://retake/first');
  h.drainRenderer(); // Keep its acknowledgment in flight.
  h.queue('bflow://retake/second');
  h.drainMain();
  assert.deepEqual(h.pending(), { revisionId: 'second' });
  h.settle();
  assert.deepEqual(received, [{ revisionId: 'first' }, { revisionId: 'second' }]);
  assert.equal(h.pending(), null);
});

test('popup and child-frame readiness cannot consume the main window pending link', () => {
  const h = harness();
  const renderer = h.attach();
  renderer.subscribe(() => {});
  h.domReady();
  h.drainRenderer();
  const ready = h.toMain.shift()!;
  h.queue('bflow://retake/main-only');
  h.ipcMain.emit(ready.channel, { ...ready.event, sender: {} }, ...ready.args);
  h.ipcMain.emit(ready.channel, { ...ready.event, senderFrame: { processId: 1, routingId: 2 } }, ...ready.args);
  assert.equal(h.toRenderer.length, 0);
  assert.deepEqual(h.pending(), { revisionId: 'main-only' });
  h.ipcMain.emit(ready.channel, ready.event, ...ready.args);
  h.settle();
  assert.equal(h.pending(), null);
});

test('an in-page or child-frame navigation does not unregister the active document', () => {
  const h = harness();
  const received: unknown[] = [];
  h.attach().subscribe(data => received.push(data));
  h.domReady();
  h.settle();
  h.contents.emit('did-start-navigation', {}, 'app://index#same', true, true);
  h.contents.emit('did-start-navigation', {}, 'app://child', false, false);
  h.queue('bflow://retake/still-ready');
  h.settle();
  assert.deepEqual(received, [{ revisionId: 'still-ready' }]);
});

test('a duplicate launch after acknowledgement does not deliver twice but a new launch of the same URL does', () => {
  const h = harness(); const received: unknown[] = [];
  h.attach().subscribe(data => received.push(data)); h.domReady(); h.settle();
  h.queue('bflow://retake/same-item', 'launch-1'); h.settle();
  h.queue('bflow://retake/same-item', 'launch-1'); h.settle();
  assert.equal(received.length, 1);
  h.queue('bflow://retake/same-item', 'launch-2'); h.settle();
  assert.equal(received.length, 2);
});

test('both Windows transport arrival orders share the actual secondary launch identity and deliver once after ACK', () => {
  for (const first of ['file', 'second-instance']) {
    const files = new Map<string, string>(); const primary = harness(files);
    primary.boot(true); const received: unknown[] = [];
    primary.attach().subscribe(data => received.push(data)); primary.domReady(); primary.settle();
    const url = 'bflow://retake/transport'; const secondary = harness(files);
    secondary.boot(false, ['app.exe', url]);
    const envelope = JSON.parse(files.get('deeplink.txt')!);
    assert.equal(envelope.url, url);
    assert.equal(envelope.launchId, secondary.lockData().bflowDeepLinkLaunchId);
    if (first === 'file') primary.pollFile(); else primary.secondInstance(['app.exe', url], secondary.lockData());
    primary.settle(); assert.equal(primary.pending(), null);
    if (first === 'file') primary.secondInstance(['app.exe', url], secondary.lockData()); else primary.pollFile();
    primary.settle(); assert.deepEqual(received, [{ revisionId: 'transport' }]);
    assert.equal(primary.sequence(), 1); assert.equal(primary.shown(), 1);
    // A real second click launches a new process, even if its URL is identical.
    const nextClick = harness(files); nextClick.boot(false, ['app.exe', url]);
    assert.notEqual(nextClick.lockData().bflowDeepLinkLaunchId, envelope.launchId);
    primary.secondInstance(['app.exe', url], nextClick.lockData()); primary.settle(); primary.pollFile(); primary.settle();
    assert.equal(received.length, 2); assert.equal(primary.sequence(), 2);
  }
});

test('duplicate transports while no listener exists or a document reloads retain the same pending request', () => {
  const files = new Map<string, string>(); const primary = harness(files); primary.boot(true);
  const url = 'bflow://retake/wait-for-listener'; const secondary = harness(files); secondary.boot(false, [url]);
  const envelope = files.get('deeplink.txt')!;
  primary.pollFile(); primary.secondInstance([url], secondary.lockData());
  assert.equal(primary.sequence(), 1);
  primary.attach(); primary.domReady(); primary.settle();
  assert.deepEqual(primary.pending(), { revisionId: 'wait-for-listener' });
  const next = primary.reload();
  files.set('deeplink.txt', envelope); primary.pollFile(); primary.secondInstance([url], secondary.lockData());
  assert.equal(primary.sequence(), 1);
  const received: unknown[] = []; next.subscribe(data => received.push(data)); primary.domReady(); primary.settle();
  assert.deepEqual(received, [{ revisionId: 'wait-for-listener' }]); assert.equal(primary.pending(), null);
});

test('a delayed duplicate cannot replace a newer pending intent, and initial argv uses its own lock identity', () => {
  const primary = harness(); const url = 'bflow://retake/initial'; primary.boot(true, [url]);
  const launchId = primary.lockData().bflowDeepLinkLaunchId;
  primary.queue('bflow://retake/newer', 'newer-launch');
  primary.secondInstance([url], primary.lockData());
  primary.queue(url, launchId);
  assert.deepEqual(primary.pending(), { revisionId: 'newer' }); assert.equal(primary.sequence(), 2);
  const received: unknown[] = []; primary.attach().subscribe(data => received.push(data)); primary.domReady(); primary.settle();
  assert.deepEqual(received, [{ revisionId: 'newer' }]);
});

test('legacy plain URL files still open and malformed envelopes or URLs do not reserve a valid launch ID', () => {
  const files = new Map<string, string>(); const primary = harness(files); primary.boot(true);
  const received: unknown[] = []; primary.attach().subscribe(data => received.push(data)); primary.domReady(); primary.settle();
  const url = 'bflow://retake/legacy';
  for (let i = 0; i < 2; i++) { files.set('deeplink.txt', url); primary.pollFile(); primary.settle(); }
  assert.equal(received.length, 2, 'ID-less legacy requests cannot be safely deduplicated by URL');
  files.set('deeplink.txt', '{"url":'); primary.pollFile();
  files.set('deeplink.txt', JSON.stringify({ url: 'bflow://retake/invalid/path', launchId: 'valid-launch' })); primary.pollFile();
  primary.secondInstance(['bflow://retake/invalid/path'], { bflowDeepLinkLaunchId: 'valid-launch' });
  assert.equal(received.length, 2); assert.equal(primary.seenCount(), 0);
  files.set('deeplink.txt', JSON.stringify({ url: 'bflow://retake/valid', launchId: 'valid-launch' })); primary.pollFile(); primary.settle();
  primary.secondInstance(['bflow://retake/valid'], { bflowDeepLinkLaunchId: 'valid-launch' }); primary.settle();
  assert.deepEqual(received.at(-1), { revisionId: 'valid' }); assert.equal(received.length, 3);
});

test('launch deduplication has a bounded memory footprint and never blocks fresh same-URL intents', () => {
  const h = harness();
  for (let i = 0; i < 300; i++) h.queue('bflow://retake/repeated', `launch-${i}`);
  assert.equal(h.sequence(), 300); assert.equal(h.seenCount(), 256);
  h.queue('bflow://retake/repeated', 'launch-299');
  assert.equal(h.sequence(), 300);
});
