import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { parseBflowDeepLink } from '../src/shared/bflowDeepLink.ts';

function contract(path: string, start: string, end: string): string {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing contract in ${path}`);
  return ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const mainContract = contract('../electron/main.ts', '// ─── 딥링크 전달 준비 계약 ─', '// ─── 딥링크 전달 준비 계약 끝');
const preloadContract = contract('../electron/preload.ts', '// ─── 딥링크 구독 준비 계약 ─', '// ─── 딥링크 구독 준비 계약 끝');
type Message = { channel: string; args: any[]; target?: EventEmitter; event?: any };

function harness() {
  const ipcMain = new EventEmitter();
  const toMain: Message[] = [];
  const toRenderer: Message[] = [];
  let renderer: EventEmitter;
  let ready = false;
  let shown = 0;
  let documentSequence = 0;
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { processId: 1, routingId: 1 },
    send: (channel: string, ...args: any[]) => toRenderer.push({ channel, args, target: renderer }),
  });
  const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const context = vm.createContext({
    ipcMain, mainWindow: null, parseBflowDeepLink, randomUUID: () => `document-${++documentSequence}`,
    app: { isReady: () => ready }, showMainWindow: () => ++shown,
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
    queue: (url: string) => context.sendDeepLinkToRenderer(url),
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
