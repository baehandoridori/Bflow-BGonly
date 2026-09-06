import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { isCommentKeyUnread } from '../src/services/commentReadStateService.ts';

type Summary = { count: number; latestOtherCreatedAt: string | null };
type Badge = { count: number; seen: boolean } | null;
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 20));
const refresh = () => new Promise<void>(resolve => setTimeout(resolve, 125));
const unreadAt = '2026-09-07T01:00:00Z';
const dependencies = {
  './commentReadStateService': {
    COMMENT_READ_STATE_EVENT: 'bflow:comment-read-state-changed',
    getCommentReadStateForUser: async () => ({}), isCommentKeyUnread,
  },
};
async function load(entry: string, extra: Record<string, any> = {}) {
  const deps: Record<string, any> = { ...dependencies, ...extra };
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22',
    external: Object.keys(deps) });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id: string) => { assert.ok(id in deps, `unexpected dependency ${id}`); return deps[id]; }, module, module.exports,
  );
  return module.exports;
}
const dispatch = (events: EventTarget, type: string, detail?: unknown) => events.dispatchEvent(new CustomEvent(type, { detail }));

test('many distinct visible badges share one metadata batch and read-only changes never query comments', async () => {
  const { CharacterCommentSummaryCache } = await load('src/services/characterCommentSummaryService.ts');
  const events = new EventTarget();
  const batches: string[][] = []; let readCalls = 0; let readAt = '';
  const rows: Record<string, Summary> = { hero: { count: 2, latestOtherCreatedAt: unreadAt } };
  const values = new Map<string, Badge>(); const cleanup: Array<() => void> = [];
  const cache = new CharacterCommentSummaryCache(async (ids: string[]) => {
    batches.push(ids); return Object.fromEntries(ids.map(id => [id, rows[id] ?? { count: 0, latestOtherCreatedAt: null }]));
  }, async () => { ++readCalls; return { 'char:hero': readAt }; });
  try {
    for (const id of ['hero', ...Array.from({ length: 119 }, (_, i) => `character-${i}`)]) {
      cleanup.push(cache.subscribe(id, 'me', true, (value: Badge) => values.set(id, value), events));
    }
    cleanup.push(cache.subscribe('hero', 'me', true, () => {}, events));
    await settle();
    assert.equal(batches.length, 1); assert.equal(batches[0].length, 120); assert.equal(readCalls, 1);
    assert.deepEqual(values.get('hero'), { count: 2, seen: false });
    assert.deepEqual(values.get('character-0'), { count: 0, seen: true });
    readAt = unreadAt;
    dispatch(events, 'bflow:comment-read-state-changed', { userId: 'me' }); await settle();
    assert.deepEqual(values.get('hero'), { count: 2, seen: true });
    assert.equal(batches.length, 1, 'marking read queries no summary or comment bodies'); assert.equal(readCalls, 2);
    dispatch(events, 'bflow:comment-read-state-changed', { userId: 'other' }); await settle();
    assert.equal(readCalls, 2);
    rows.hero = { count: 3, latestOtherCreatedAt: '2026-09-07T02:00:00Z' };
    dispatch(events, 'bflow:comments-invalidated', { characterId: 'hero' }); await refresh();
    assert.deepEqual(batches[1], ['hero']); assert.equal(readCalls, 2);
    assert.deepEqual(values.get('hero'), { count: 3, seen: false });
    dispatch(events, 'bflow:comments-invalidated', { characterId: 'unrelated' });
    dispatch(events, 'bflow:comments-invalidated', { sheetName: 'EP01_A_BG' }); await refresh();
    assert.equal(batches.length, 2);
    dispatch(events, 'bflow:comments-invalidated'); dispatch(events, 'bflow:comments-invalidated'); await refresh();
    assert.equal(batches.length, 3, 'generic remote refresh is one batch, not one request per character');
    assert.equal(batches[2].length, 120); assert.equal(readCalls, 2);
  } finally { cleanup.forEach(stop => stop()); }
});

test('inactive and newly mounted characters respect invalidation, TTL, and bounded batches', async () => {
  const { CharacterCommentSummaryCache } = await load('src/services/characterCommentSummaryService.ts');
  const events = new EventTarget(); const batches: string[][] = []; let now = 0;
  const cache = new CharacterCommentSummaryCache(async (ids: string[]) => {
    batches.push(ids); return Object.fromEntries(ids.map(id => [id, { count: 1, latestOtherCreatedAt: null }]));
  }, async () => ({}), () => now);
  const cleanup: Array<() => void> = [];
  try {
    cleanup.push(cache.subscribe('anchor', 'me', true, () => {}, events));
    const oldStop = cache.subscribe('hero', 'me', true, () => {}, events); cleanup.push(oldStop);
    await settle(); oldStop();
    const cachedStop = cache.subscribe('hero', 'me', true, () => {}, events); cleanup.push(cachedStop);
    await settle(); assert.equal(batches.length, 1, 'remount within TTL uses metadata cache'); cachedStop();
    dispatch(events, 'bflow:comments-invalidated', { characterId: 'hero' }); await refresh();
    assert.equal(batches.length, 1, 'inactive character invalidation does not fetch');
    const freshStop = cache.subscribe('hero', 'me', true, () => {}, events); cleanup.push(freshStop);
    await settle(); assert.deepEqual(batches[1], ['hero']); freshStop();
    now = 31_000;
    cleanup.push(cache.subscribe('hero', 'me', true, () => {}, events)); await settle();
    assert.deepEqual(batches[2], ['hero'], 'future remount revalidates expired summary');
    for (let i = 0; i < 205; i++) cleanup.push(cache.subscribe(`new-${i}`, 'me', true, () => {}, events));
    await settle(); assert.deepEqual(batches.slice(3).map(ids => ids.length), [200, 5]);
    assert.equal(new Set(batches.slice(3).flat()).size, 205);
  } finally { cleanup.forEach(stop => stop()); }
});

test('a targeted invalidation during a bulk read drops the stale target and requests it once again', async () => {
  const { CharacterCommentSummaryCache } = await load('src/services/characterCommentSummaryService.ts');
  const events = new EventTarget(); const batches: string[][] = []; const values: Badge[] = [];
  let resolveFirst: (rows: Record<string, Summary>) => void = () => {};
  const cache = new CharacterCommentSummaryCache((ids: string[]) => {
    batches.push(ids);
    return batches.length === 1 ? new Promise(resolve => { resolveFirst = resolve; })
      : Promise.resolve({ hero: { count: 0, latestOtherCreatedAt: null } });
  }, async () => ({}));
  const stopHero = cache.subscribe('hero', 'me', true, (value: Badge) => values.push(value), events);
  const stopOther = cache.subscribe('other', 'me', true, () => {}, events);
  try {
    await settle(); dispatch(events, 'bflow:comments-invalidated', { characterId: 'hero' }); await refresh();
    assert.equal(batches.length, 1, 'an in-flight target does not start duplicate queries');
    resolveFirst({ hero: { count: 99, latestOtherCreatedAt: unreadAt }, other: { count: 2, latestOtherCreatedAt: null } });
    await settle();
    assert.deepEqual(batches[1], ['hero']);
    assert.ok(!values.some(value => value?.count === 99), 'stale result preceding deletion is never painted');
    assert.deepEqual(values.at(-1), { count: 0, seen: true });
  } finally { stopHero(); stopOther(); }
});

test('user, source, and last-unmount boundaries discard old responses and never share another session summary', async () => {
  const { CharacterCommentSummaryCache } = await load('src/services/characterCommentSummaryService.ts');
  const events = new EventTarget(); const requests: Array<(rows: Record<string, Summary>) => void> = [];
  const readUsers: string[] = []; const first: Badge[] = []; const next: Badge[] = [];
  const cache = new CharacterCommentSummaryCache(() => new Promise(resolve => requests.push(resolve)),
    async (userId: string) => { readUsers.push(userId); return {}; });
  const stopFirst = cache.subscribe('hero', 'first', true, (value: Badge) => first.push(value), events);
  await settle();
  const stopNext = cache.subscribe('hero', 'next', true, (value: Badge) => next.push(value), events);
  await settle(); stopFirst();
  requests[0]({ hero: { count: 99, latestOtherCreatedAt: unreadAt } });
  requests[1]({ hero: { count: 1, latestOtherCreatedAt: null } }); await settle();
  assert.ok(!first.some(value => value?.count === 99)); assert.deepEqual(next.at(-1), { count: 1, seen: true });
  const local: Badge[] = []; const stopLocal = cache.subscribe('hero', 'next', false, (value: Badge) => local.push(value), events);
  await settle(); stopNext(); requests[2]({ hero: { count: 2, latestOtherCreatedAt: null } }); await settle();
  assert.deepEqual(local.at(-1), { count: 2, seen: true }); stopLocal();
  const stopAgain = cache.subscribe('hero', 'next', false, () => {}, events); await settle();
  assert.equal(requests.length, 4, 'same-user login/remount after all cards close starts fresh');
  requests[3]({ hero: { count: 3, latestOtherCreatedAt: null } }); await settle(); stopAgain();
  assert.deepEqual(readUsers, ['first', 'next', 'next', 'next']);
});

test('generic invalidation also fences an unmounted in-flight character before a future mount', async () => {
  const { CharacterCommentSummaryCache } = await load('src/services/characterCommentSummaryService.ts');
  const events = new EventTarget(); const batches: string[][] = [];
  let first: (rows: Record<string, Summary>) => void = () => {};
  const cache = new CharacterCommentSummaryCache((ids: string[]) => {
    batches.push(ids);
    if (batches.length === 1) return new Promise(resolve => { first = resolve; });
    return Promise.resolve(Object.fromEntries(ids.map(id => [id, { count: 0, latestOtherCreatedAt: null }])));
  }, async () => ({}));
  const stopA = cache.subscribe('a', 'me', true, () => {}, events);
  const stopB = cache.subscribe('b', 'me', true, () => {}, events);
  let stopNewA: (() => void) | undefined;
  try {
    await settle(); stopA();
    dispatch(events, 'bflow:comments-invalidated'); await refresh();
    first({ a: { count: 99, latestOtherCreatedAt: null }, b: { count: 0, latestOtherCreatedAt: null } });
    await settle();
    const values: Badge[] = [];
    stopNewA = cache.subscribe('a', 'me', true, (value: Badge) => values.push(value), events);
    await settle();
    assert.deepEqual(batches.at(-1), ['a']);
    assert.ok(!values.some(value => value?.count === 99));
    assert.deepEqual(values.at(-1), { count: 0, seen: true });
  } finally { stopNewA?.(); stopB(); stopA(); }
});

test('badge keeps the existing compact marker and hides a previous user or source snapshot immediately', async () => {
  let currentUserId = 'me'; let connected = true; let state: any = null; let mounted = false;
  let callback: (value: Badge) => void = () => {}; let effect: (() => () => void) | undefined;
  const module = await load('src/components/characters/CharacterCommentBadge.tsx', {
    react: { useState: () => [state, (value: any) => { state = value; }], useEffect: (next: any) => { if (!mounted) effect = next; } },
    'react/jsx-runtime': { jsx: (type: any, props: any) => ({ type, props }) },
    '@/stores/useAuthStore': { useAuthStore: (select: any) => select({ currentUser: { id: currentUserId } }) },
    '@/stores/useAppStore': { useAppStore: (select: any) => select({ dataConnected: connected }) },
    '@/services/characterCommentSummaryService': { subscribeCharacterCommentSummary: (_id: string, _user: string, _connected: boolean, next: typeof callback) => { callback = next; return () => {}; } },
    '@/views/compositing/RevisionCommentMarker': { RevisionCommentMarker: () => null },
  });
  assert.equal(module.CharacterCommentBadge({ characterId: 'hero' }), null); mounted = true; const cleanup = effect?.();
  callback({ count: 2, seen: true });
  const badge = module.CharacterCommentBadge({ characterId: 'hero' });
  assert.equal(badge.props.count, 2); assert.equal(badge.props.seen, true); assert.equal(badge.props.size, 'compact');
  currentUserId = 'other'; assert.equal(module.CharacterCommentBadge({ characterId: 'hero' }), null);
  currentUserId = 'me'; connected = false; assert.equal(module.CharacterCommentBadge({ characterId: 'hero' }), null);
  cleanup?.();
});
