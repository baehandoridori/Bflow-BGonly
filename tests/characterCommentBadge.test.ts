import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { getLatestOtherUserCommentCreatedAt, isCommentKeyUnread } from '../src/services/commentReadStateService.ts';

test('character badges share reads, follow read state, and refresh after an in-flight invalidation', async () => {
  const originalWindow = (globalThis as any).window;
  const events = new EventTarget();
  (globalThis as any).window = events;
  type Comment = { id: string; userId: string; createdAt: string };
  type Badge = { props: { count: number; seen: boolean; size: string } } | null;
  type Harness = { value: unknown; effects: Array<() => void>; cleanup?: () => void; mounted: boolean; characterId: string };
  let currentHarness: Harness;
  const harnesses: Harness[] = [];
  let currentUserId = 'me';
  let comments: Comment[] = [
    { id: 'first', userId: 'other', createdAt: '2026-09-07T01:00:00Z' },
    { id: 'own', userId: 'me', createdAt: '2026-09-07T02:00:00Z' },
  ];
  let readAt = '';
  let commentReads = 0;
  let stateReads = 0;
  let pendingComment: Promise<Comment[]> | undefined;
  const result = await build({
    entryPoints: ['src/components/characters/CharacterCommentBadge.tsx'],
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22',
    external: ['react', 'react/jsx-runtime', '@/stores/useAuthStore', '@/services/commentService', '@/services/commentReadStateService', '@/views/compositing/RevisionCommentMarker'],
  });
  const module = { exports: {} as { CharacterCommentBadge: (props: { characterId: string }) => Badge } };
  const dependencies: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const harness = currentHarness;
        if (!harness.mounted) harness.value = initial;
        return [harness.value, (next: unknown) => { harness.value = next; }];
      },
      useEffect: (effect: () => () => void) => {
        const harness = currentHarness;
        if (!harness.mounted) harness.effects.push(() => { harness.cleanup = effect(); });
      },
    },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
    '@/stores/useAuthStore': { useAuthStore: (select: (state: unknown) => unknown) => select({ currentUser: { id: currentUserId } }) },
    '@/services/commentService': {
      buildCharacterCommentKey: (id: string) => `char:${id}`,
      getCommentsForCharacter: async () => { ++commentReads; return pendingComment ?? comments; },
    },
    '@/services/commentReadStateService': {
      COMMENT_READ_STATE_EVENT: 'bflow:comment-read-state-changed',
      getCommentReadStateForUser: async () => { ++stateReads; return { 'char:hero': readAt }; },
      getLatestOtherUserCommentCreatedAt,
      isCommentKeyUnread,
    },
    '@/views/compositing/RevisionCommentMarker': { RevisionCommentMarker: () => null },
  };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    (id: string) => {
      assert.ok(id in dependencies, `unexpected dependency ${id}`);
      return dependencies[id];
    }, module, module.exports,
  );
  const render = (harness: Harness) => {
    currentHarness = harness;
    const badge = module.exports.CharacterCommentBadge({ characterId: harness.characterId });
    harness.mounted = true;
    harness.effects.splice(0).forEach((effect) => effect());
    return badge;
  };
  const mount = (characterId: string) => {
    const harness: Harness = { characterId, value: null, effects: [], mounted: false };
    harnesses.push(harness);
    render(harness);
    return harness;
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const refresh = () => new Promise<void>((resolve) => setTimeout(resolve, 175));
  const dispatch = (type: string, detail?: unknown) => events.dispatchEvent(new CustomEvent(type, { detail }));

  try {
    const first = mount('hero');
    const duplicate = mount('hero');
    mount('villain');
    await flush();
    assert.equal(commentReads, 2, 'duplicate character shares its comment query');
    assert.equal(stateReads, 1, 'all character badges share the user read-state query');
    assert.equal(render(first)?.props.count, 2);
    assert.equal(render(duplicate)?.props.seen, false);
    assert.equal(render(first)?.props.size, 'compact');

    readAt = '2026-09-07T01:00:00Z';
    dispatch('bflow:comment-read-state-changed', { userId: 'me' });
    await refresh();
    assert.equal(render(first)?.props.seen, true, 'the user own later comment does not remain unread');

    const previousReads = commentReads;
    dispatch('bflow:comments-invalidated', { characterId: 'unrelated' });
    dispatch('bflow:comments-invalidated', { sheetName: 'EP01_A_BG' });
    await refresh();
    assert.equal(commentReads, previousReads, 'unrelated character and scene events do not refetch');

    let resolvePending!: (rows: Comment[]) => void;
    pendingComment = new Promise((resolve) => { resolvePending = resolve; });
    dispatch('bflow:comments-invalidated', { characterId: 'hero' });
    await refresh();
    dispatch('bflow:comments-invalidated', { characterId: 'hero' });
    await refresh();
    comments = [];
    pendingComment = undefined;
    resolvePending([{ id: 'stale', userId: 'other', createdAt: '2026-09-07T03:00:00Z' }]);
    await flush();
    await flush();
    assert.equal(render(first)?.props.count, 0, 'the response that preceded deletion is followed by a fresh read');
    assert.equal(render(duplicate)?.props.count, 0);

    first.cleanup?.();
    duplicate.cleanup?.();
    const afterCleanup = commentReads;
    dispatch('bflow:comments-invalidated', { characterId: 'hero' });
    await refresh();
    assert.equal(commentReads, afterCleanup, 'unmounted badges remove their listeners');
  } finally {
    harnesses.forEach((harness) => harness.cleanup?.());
    (globalThis as any).window = originalWindow;
  }
});
