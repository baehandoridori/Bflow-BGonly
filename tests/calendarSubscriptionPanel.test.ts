import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement } from 'react';

const require = createRequire(import.meta.url);
type Status = { calendarId: string; enabled: boolean; issuedAt: string | null; revision: string | null; url?: string };
const off: Status = { calendarId: 'calendar', enabled: false, issuedAt: null, revision: null };
const on: Status = { ...off, enabled: true, issuedAt: '2026-09-20', revision: 'revision-1' };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let bundle: Promise<string> | undefined;
function bundled() { return bundle ??= build({ entryPoints: ['src/components/calendar/CalendarSubscriptionPanel.tsx'], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['react', 'react/jsx-runtime', 'lucide-react', '@/stores/*'] }).then(result => result.outputFiles[0].text); }
function nodes(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(nodes) : isValidElement(tree) ? [tree, ...nodes((tree.props as any).children)] : []; }
function text(tree: any): string { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : isValidElement(tree) ? text((tree.props as any).children) : ''; }

/** Real panel and handlers; only React scheduling and its external store/API boundaries are controlled. */
async function harness(options: { owner?: string; disabled?: boolean; status?: () => Promise<Status>; manage?: (request: any) => Promise<Status> } = {}) {
  const slots: any[] = [], effects: Array<() => void> = [], subscribers = new Set<(next: any, previous: any) => void>();
  const listeners = new Map<string, Set<() => void>>(), reads: string[] = [], commands: any[] = [], copied: string[] = [];
  let cursor = 0, dirty = false, tree: any, auth = { currentUser: { id: 'actor', name: '소유자' } };
  let calendars = [{ id: 'calendar', ownerId: options.owner ?? 'actor' }];
  let props = { calendarId: 'calendar', disabled: options.disabled ?? false };
  let readImpl = options.status ?? (() => Promise.resolve(off));
  const changed = (a: any[] | undefined, b: any[] | undefined) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const react = { ...require('react'), useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; const state = slots[index]; state.set ??= (value: any) => { const next = typeof value === 'function' ? value(state.value) : value; if (!Object.is(next, state.value)) { state.value = next; dirty = true; } }; return [state.value, state.set]; }, useRef(initial: any) { return slots[cursor++] ??= { current: initial }; }, useEffect(fn: any, deps: any[]) { const index = cursor++, before = slots[index]; if (!before || changed(before.deps, deps)) { slots[index] = { deps }; effects.push(() => { before?.cleanup?.(); slots[index].cleanup = fn(); }); } } };
  const authStore = Object.assign((selector: any) => selector(auth), { getState: () => auth, subscribe: (listener: any) => { subscribers.add(listener); return () => subscribers.delete(listener); } });
  const calendarStore = Object.assign((selector: any) => selector({ calendars }), { getState: () => ({ calendars }) });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', await bundled())((id: string) => id === 'react' ? react : id === 'lucide-react' ? new Proxy({}, { get: () => () => null }) : id === '@/stores/useAuthStore' ? { useAuthStore: authStore } : id === '@/stores/useCalendarStore' ? { useCalendarStore: calendarStore } : require(id), module, module.exports);
  const previous = new Map(['window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { calendarFeedStatus(id: string) { reads.push(id); return readImpl(); }, calendarFeedManage(request: any) { commands.push(request); return options.manage?.(request) ?? Promise.resolve({ ...on, url: 'https://feed.test/secret' }); } }, addEventListener(type: string, fn: any) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); }, removeEventListener(type: string, fn: any) { listeners.get(type)?.delete(fn); } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(value: string) { copied.push(value); } } } });
  function render() { for (let i = 0; i < 20; i++) { dirty = false; cursor = 0; tree = module.exports.CalendarSubscriptionPanel(props); while (effects.length) effects.shift()!(); if (!dirty) return tree; } throw new Error('Panel did not settle'); }
  async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } }
  const buttons = () => nodes(render()).filter(node => node.type === 'button');
  const button = (label: string) => { const found = buttons().find(node => node.props['aria-label'] === label || text(node) === label); assert.ok(found, `button ${label}`); return found; };
  const click = (label: string) => { const node = button(label); if (!node.props.disabled) node.props.onClick(); render(); };
  const urls = () => nodes(render()).filter(node => node.type === 'input' && node.props['aria-label'] === '외부 캘린더 구독 주소').map(node => node.props.value);
  render();
  return { render, settle, button, click, urls, reads, commands, copied, content: () => text(render()), setRead(fn: () => Promise<Status>) { readImpl = fn; }, focus() { listeners.get('focus')?.forEach(fn => fn()); render(); }, setActor(id: string) { const before = auth; auth = { currentUser: { id, name: '갱신된 사용자' } }; subscribers.forEach(fn => fn(auth, before)); render(); }, setCalendars(next: typeof calendars) { calendars = next; render(); }, setCalendar(id: string) { props = { ...props, calendarId: id }; render(); }, dispose() { for (const slot of slots) slot?.cleanup?.(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } } };
}

test('subscription panel: owner-only mounting and disabled settings never issue commands', async () => {
  const reader = await harness({ owner: 'another' }); try { await reader.settle(); assert.equal(reader.render(), null); assert.deepEqual(reader.reads, []); } finally { reader.dispose(); }
  const disabled = await harness({ disabled: true }); try { await disabled.settle(); assert.equal(disabled.button('구독 주소 발급').props.disabled, true); disabled.click('구독 주소 발급'); assert.equal(disabled.commands.length, 0); } finally { disabled.dispose(); }
});
test('subscription panel: issue is single-flight, uses expected revision, copies one-time address', async () => {
  const pending = deferred<Status>(), h = await harness({ manage: () => pending.promise }); try {
    await h.settle(); h.click('구독 주소 발급'); assert.equal(h.commands.length, 1); assert.deepEqual(h.commands[0], { calendarId: 'calendar', action: 'enable', expectedRevision: null });
    assert.equal(h.button('주소 교체').props.disabled, true); h.focus(); assert.equal(h.reads.length, 1);
    pending.resolve({ ...on, url: 'https://feed.test/one-time' }); await h.settle(); assert.deepEqual(h.urls(), ['https://feed.test/one-time']);
    h.click('주소 복사'); await h.settle(); assert.deepEqual(h.copied, ['https://feed.test/one-time']); assert.ok(h.content().includes('복사했어요'));
  } finally { h.dispose(); }
});
test('subscription panel: rotate/revoke require confirmation and preserve CAS revision', async () => {
  const h = await harness({ status: async () => on, manage: async request => ({ ...on, enabled: request.action !== 'revoke', revision: 'revision-2', ...(request.action === 'rotate' ? { url: 'https://feed.test/new' } : {}) }) }); try {
    await h.settle(); h.click('주소 교체'); assert.equal(h.commands.length, 0); h.click('취소'); h.click('주소 교체'); h.click('새 주소 발급'); await h.settle(); assert.equal(h.commands[0].expectedRevision, 'revision-1');
    h.click('구독 중지'); assert.equal(h.commands.length, 1); h.click('구독 중지'); await h.settle(); assert.equal(h.commands[1].action, 'revoke'); assert.equal(h.commands[1].expectedRevision, 'revision-2'); assert.deepEqual(h.urls(), []); assert.ok(h.content().includes('외부 구독 꺼짐'));
  } finally { h.dispose(); }
});
test('subscription panel: failed mutation reconciles committed state before allowing retry', async () => {
  const reconcile = deferred<Status>(), h = await harness({ manage: async () => { throw new Error('lost response'); } }); try {
    await h.settle(); h.setRead(() => reconcile.promise); h.click('구독 주소 발급'); await h.settle(); assert.equal(h.reads.length, 2); assert.equal(h.button('구독 주소 발급').props.disabled, true);
    reconcile.resolve({ ...on, revision: 'committed' }); await h.settle(); assert.deepEqual(h.urls(), []); assert.ok(h.content().includes('구독 주소 사용 중')); assert.equal(h.button('주소 교체').props.disabled, false);
    h.click('주소 교체'); h.click('새 주소 발급'); assert.equal(h.commands[1].expectedRevision, 'committed'); await h.settle();
  } finally { h.dispose(); }
});
test('subscription panel: status refresh preserves same-revision address and clears changed revision', async () => {
  const h = await harness(); try { await h.settle(); h.click('구독 주소 발급'); await h.settle(); h.setRead(async () => on); h.focus(); await h.settle(); assert.equal(h.urls().length, 1); h.setRead(async () => ({ ...on, revision: 'rotated-elsewhere' })); h.focus(); await h.settle(); assert.deepEqual(h.urls(), []); } finally { h.dispose(); }
});
test('subscription panel: late issue response after actor or ownership change cannot reveal bearer address', async () => {
  for (const change of ['actor', 'owner']) {
    const pending = deferred<Status>(), h = await harness({ manage: () => pending.promise }); try { await h.settle(); h.click('구독 주소 발급'); if (change === 'actor') h.setActor('another'); else h.setCalendars([{ id: 'calendar', ownerId: 'another' }]); pending.resolve({ ...on, url: 'https://feed.test/secret' }); await h.settle(); assert.equal(h.render(), null); assert.deepEqual(h.urls(), []); } finally { h.dispose(); }
  }
});
test('subscription panel: a late status for previous calendar does not replace current calendar state', async () => {
  const first = deferred<Status>(), h = await harness({ status: () => first.promise }); try { h.setCalendars([{ id: 'calendar', ownerId: 'actor' }, { id: 'new', ownerId: 'actor' }]); h.setRead(async () => ({ ...off, calendarId: 'new' })); h.setCalendar('new'); await h.settle(); first.resolve(on); await h.settle(); assert.ok(h.content().includes('외부 구독 꺼짐')); h.click('구독 주소 발급'); assert.equal(h.commands[0].calendarId, 'new'); assert.equal(h.commands[0].expectedRevision, null); } finally { h.dispose(); }
});
test('subscription panel: same-actor session replacement clears address and reloads status without refocus', async () => {
  const h = await harness(); try { await h.settle(); h.click('구독 주소 발급'); await h.settle(); assert.equal(h.urls().length, 1); h.setRead(async () => on); h.setActor('actor'); await h.settle(); assert.deepEqual(h.urls(), []); assert.equal(h.reads.length, 2); assert.ok(h.content().includes('구독 주소 사용 중')); assert.equal(h.button('주소 교체').props.disabled, false); } finally { h.dispose(); }
});
test('subscription panel: same-actor new session discards an earlier pending issued URL', async () => {
  const pending = deferred<Status>(), h = await harness({ manage: () => pending.promise }); try {
    await h.settle(); h.click('구독 주소 발급'); h.setRead(async () => ({ ...on, revision: 'new-session' })); h.setActor('actor'); await h.settle();
    pending.resolve({ ...on, url: 'https://feed.test/old-session' }); await h.settle(); assert.deepEqual(h.urls(), []); assert.equal(h.button('주소 교체').props.disabled, false);
    h.click('주소 교체'); h.click('새 주소 발급'); assert.equal(h.commands[1].expectedRevision, 'new-session'); await h.settle();
  } finally { h.dispose(); }
});
test('subscription panel: failed status read disables issuing until explicit retry succeeds', async () => {
  const h = await harness({ status: async () => { throw new Error('offline'); } }); try {
    await h.settle(); assert.equal(h.button('구독 주소 발급').props.disabled, true); assert.ok(h.content().includes('구독 상태를 확인하지 못했어요'));
    h.setRead(async () => off); h.click('구독 상태 새로고침'); await h.settle(); assert.equal(h.button('구독 주소 발급').props.disabled, false); assert.equal(h.commands.length, 0);
  } finally { h.dispose(); }
});
