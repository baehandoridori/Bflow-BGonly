import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import type { CompRevision } from '../src/types/index.ts';
import { formatRetakeElapsed, getMyRetakeState, selectMyRetakes, summarizeMyRetakes } from '../src/utils/myRetakes.ts';
import { buildRevisionAssigneeCompletionNotifyUserIds } from '../src/utils/revisionNotificationRecipients.ts';

function revision(id: string, fields: Partial<CompRevision> = {}): CompRevision {
  return {
    id, sceneKey: 'EP01:A:1', revisionNo: 1, status: 'open', priority: 'normal',
    description: '수정 내용', requesterId: 'requester', requesterName: '요청자',
    createdAt: '2026-09-07T01:00:00Z', updatedAt: '2026-09-07T01:00:00Z',
    assigneeIds: ['me'], ...fields,
  };
}

test('my retakes includes only the signed-in user unfinished assignments', () => {
  const rows = [
    revision('pending'),
    revision('in-progress', { assigneeStates: { me: { state: 'in_progress' } } }),
    revision('own-done', { status: 'in_progress', assigneeIds: ['me', 'other'], assigneeStates: { me: { state: 'done' }, other: { state: 'pending' } } }),
    revision('only-notified', { assigneeIds: ['other'], notifyUserIds: ['me'] }),
    revision('stale-state', { assigneeIds: ['other'], assigneeStates: { me: { state: 'pending' } } }),
    revision('requester-only', { assigneeIds: [], requesterId: 'me' }),
    revision('resolved', { status: 'resolved' }),
    revision('final', { finalResolvedAt: '2026-09-07T02:00:00Z' }),
  ];
  assert.deepEqual(selectMyRetakes(rows, 'me').map((row) => row.id), ['in-progress', 'pending']);
  assert.deepEqual(selectMyRetakes(rows, ''), []);
  assert.deepEqual(summarizeMyRetakes(rows, 'me'), { pending: 1, inProgress: 1, total: 2 });
});

test('my pending status is not inferred from another assignee or the revision aggregate', () => {
  const row = revision('mixed', { status: 'in_progress', assigneeIds: ['me', 'other'], assigneeStates: { other: { state: 'done' } } });
  assert.equal(getMyRetakeState(row, 'me'), 'pending');
  assert.equal(getMyRetakeState(row, 'other'), null);
});

test('oldest assignments come first without changing the store array', () => {
  const rows = [revision('new', { createdAt: '2026-09-07T02:00:00Z' }), revision('old', { createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-09-07T03:00:00Z' }), revision('unknown', { createdAt: '' })];
  assert.deepEqual(selectMyRetakes(rows, 'me').map((row) => row.id), ['old', 'new', 'unknown']);
  assert.deepEqual(rows.map((row) => row.id), ['new', 'old', 'unknown']);
});

test('completion and reassignment remove items while a rollback restores them', () => {
  const pending = revision('work');
  assert.equal(selectMyRetakes([pending], 'me').length, 1);
  assert.equal(selectMyRetakes([{ ...pending, assigneeStates: { me: { state: 'done' } } }], 'me').length, 0);
  assert.equal(selectMyRetakes([{ ...pending, assigneeIds: ['other'] }], 'me').length, 0);
  assert.equal(selectMyRetakes([pending], 'me').length, 1);
});

test('elapsed labels use creation time and handle invalid or future timestamps', () => {
  const now = Date.parse('2026-09-07T03:00:00Z');
  assert.equal(formatRetakeElapsed('2026-09-07T02:59:45Z', now), '방금 등록');
  assert.equal(formatRetakeElapsed('2026-09-07T02:40:00Z', now), '등록 후 20분');
  assert.equal(formatRetakeElapsed('2026-09-07T01:00:00Z', now), '등록 후 2시간');
  assert.equal(formatRetakeElapsed('2026-09-04T01:00:00Z', now), '등록 후 3일');
  assert.equal(formatRetakeElapsed('2026-09-08T00:00:00Z', now), '방금 등록');
  assert.equal(formatRetakeElapsed('', now), '등록일 없음');
});

test('all default dashboards place my-retakes within the grid without widget overlap', () => {
  const source = readFileSync('src/views/Dashboard.tsx', 'utf8');
  type Layout = { i: string; x: number; y: number; w: number; h: number };
  for (const name of ['DEPT_LAYOUT', 'ALL_LAYOUT', 'EP_LAYOUT']) {
    const content = source.match(new RegExp(`const ${name}: Layout\\[\\] = (\\[[\\s\\S]*?\\n\\]);`));
    assert.ok(content, name);
    const layout = new Function(`return ${content[1]}`)() as Layout[];
    assert.equal(layout.filter((item) => item.i === 'my-retakes').length, 1, name);
    for (let a = 0; a < layout.length; ++a) {
      assert.ok(layout[a].x >= 0 && layout[a].x + layout[a].w <= 24, `${name}: ${layout[a].i} fits`);
      for (let b = a + 1; b < layout.length; ++b) {
        const left = layout[a];
        const right = layout[b];
        const overlap = left.x < right.x + right.w && left.x + left.w > right.x && left.y < right.y + right.h && left.y + left.h > right.y;
        assert.equal(overlap, false, `${name}: ${left.i} overlaps ${right.i}`);
      }
    }
  }
});

test('widget actions use the current assignee, preserve the completion editor on rollback, and forward popup navigation', async () => {
  type Node = { type: unknown; props: Record<string, any> };
  const values: any[] = [];
  let cursor = 0;
  let isPopup = false;
  const actor = { id: 'me', name: '담당자' };
  let rows = [revision('work', { notifyUserIds: ['me', 'requester'] })];
  const calls: unknown[][] = [];
  const errors: string[] = [];
  let resolveSave: (() => void) | undefined;
  let rollback = true;
  const connection = { dataConnected: true, setDataConnected(value: boolean) { this.dataConnected = value; } };
  const store = {
    get revisions() { return rows; },
    isLoading: false,
    async loadRevisions() { calls.push(['load']); },
    async startAssignee(row: CompRevision, userId: string) {
      calls.push(['start', row.id, userId]);
      rows = [{ ...row, assigneeStates: { [userId]: { state: 'in_progress' } } }];
    },
    async completeAssignee(row: CompRevision, userId: string, note: string, notifyIds: string[], name: string) {
      calls.push(['complete', row.id, userId, note, notifyIds, name]);
      rows = [{ ...row, assigneeStates: { [userId]: { state: 'done', note } } }];
      if (rollback) {
        await new Promise<void>((resolve) => { resolveSave = resolve; });
        rows = [row];
      }
    },
  };
  const useStore = Object.assign((select: (state: typeof store) => unknown) => select(store), { getState: () => store });
  const useAuth = Object.assign((select: (state: { currentUser: typeof actor }) => unknown) => select({ currentUser: actor }), { getState: () => ({ currentUser: actor }) });
  const dependencies: Record<string, any> = {
    react: {
      useState: (initial: unknown) => {
        const index = cursor++;
        if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], (next: unknown) => { values[index] = next; }];
      },
      useRef: (initial: unknown) => {
        const index = cursor++;
        if (!(index in values)) values[index] = { current: initial };
        return values[index];
      },
      useContext: () => isPopup,
      useMemo: (make: () => unknown) => make(),
      useEffect: () => {},
    },
    'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    'lucide-react': { Check: 'Check', ChevronRight: 'ChevronRight', Clock: 'Clock', MessageSquareWarning: 'RetakeIcon', Play: 'Play' },
    sonner: { toast: { error: (message: string) => errors.push(message) } },
    './Widget': { Widget: 'Widget', IsPopupContext: 'Popup' },
    '@/stores/useAuthStore': { useAuthStore: useAuth },
    '@/stores/useAppStore': { useAppStore: { getState: () => connection } },
    '@/stores/useRevisionStore': { useRevisionStore: useStore },
    '@/services/revisionService': {
      setRevisionsSheetsMode: (enabled: boolean) => calls.push(['mode', enabled]),
      invalidateRevisionsCache: () => calls.push(['invalidate']),
    },
    '@/components/scenes/revision/CompletionNoteInput': { CompletionNoteInput: 'CompletionNoteInput' },
    '@/constants/revision': { ASSIGNEE_STATE_CONFIG: { pending: { label: '대기' }, in_progress: { label: '진행중' } }, revisionNoToLabel: (n: number) => `re${n}` },
    '@/utils/revisionNotificationRecipients': { buildRevisionAssigneeCompletionNotifyUserIds },
    '@/utils/myRetakes': { formatRetakeElapsed, getMyRetakeState, selectMyRetakes, summarizeMyRetakes },
    '@/utils/entityTokens': { stripEntityTokens: (text: string) => text },
    '@/utils/revisionGeneral': { isGeneralRevisionSceneKey: () => false },
    '@/utils/retakeNavigation': { openRetakeInApp: (...args: unknown[]) => calls.push(['navigate', ...args]) },
  };
  const bundle = await build({
    entryPoints: ['src/components/widgets/MyRetakesWidget.tsx'], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'node22',
    external: Object.keys(dependencies),
  });
  const module = { exports: {} as { MyRetakesWidget: () => Node; installMyRetakesPopupRefresh: () => () => void } };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)((id: string) => {
    assert.ok(id in dependencies, `unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  const render = () => { cursor = 0; return module.exports.MyRetakesWidget(); };
  const flatten = (node: unknown): Node[] => {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!node || typeof node !== 'object' || !('props' in node)) return [];
    const element = node as Node;
    return [element, ...flatten(element.props.children)];
  };
  const label = (node: unknown): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(label).join('');
    return node && typeof node === 'object' && 'props' in node ? label((node as Node).props.children) : '';
  };
  const button = (tree: Node, text: string) => flatten(tree).find((node) => node.type === 'button' && label(node) === text)!;
  const editor = (tree: Node) => flatten(tree).find((node) => node.type === 'CompletionNoteInput');
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  let tree = render();
  button(tree, '진행중').props.onClick();
  await flush();
  assert.deepEqual(calls[0], ['start', 'work', 'me']);
  tree = render();
  assert.equal(button(tree, '진행중'), undefined);
  button(tree, '담당 완료').props.onClick();
  tree = render();
  assert.deepEqual(editor(tree)?.props.notifyDefaultIds, ['requester']);
  editor(tree)?.props.onConfirm('G:\\결과.moho', []);
  assert.ok(editor(render()), 'optimistic completion must not unmount the completion draft');
  resolveSave?.();
  await flush();
  assert.ok(editor(render()), 'rollback leaves the completion editor open');
  assert.equal(errors.length, 1);
  assert.deepEqual(calls[1], ['complete', 'work', 'me', 'G:\\결과.moho', [], '담당자']);

  rollback = false;
  editor(render())?.props.onConfirm('수정 완료', ['requester']);
  await flush();
  assert.equal(editor(render()), undefined);
  assert.equal(selectMyRetakes(rows, 'me').length, 0);

  rows = [revision('reassigned')];
  tree = render();
  const staleStart = button(tree, '진행중');
  rows = [{ ...rows[0], assigneeIds: ['other'] }];
  const callCount = calls.length;
  staleStart.props.onClick();
  await flush();
  assert.equal(calls.length, callCount, 'reassignment between render and click must prevent mutation');

  rows = [revision('popup-work')];
  isPopup = true;
  tree = render();
  const title = flatten(tree).find((node) => node.type === 'button' && String(node.props.className).startsWith('group'))!;
  title.props.onClick();
  assert.deepEqual(calls.at(-1), ['navigate', 'popup-work', { fromPopup: true }]);
  button(tree, '진행중').props.onClick();
  await flush();
  assert.deepEqual(calls.slice(-2), [['mode', true], ['start', 'popup-work', 'me']], 'popup chooses remote storage before mutation');

  const previousWindow = (globalThis as any).window;
  const events = new EventTarget();
  let onStatus: ((status: string, metadata: { reconnected: boolean }) => void) | undefined;
  let unsubscribed = false;
  (events as any).electronAPI = {
    onSupabaseStatus(callback: typeof onStatus) { onStatus = callback; return () => { unsubscribed = true; }; },
  };
  (globalThis as any).window = events;
  connection.dataConnected = false;
  const cleanup = module.exports.installMyRetakesPopupRefresh();
  const waitRefresh = () => new Promise<void>((resolve) => setTimeout(resolve, 275));
  try {
    await flush();
    assert.deepEqual(calls.slice(-3), [['mode', false], ['invalidate'], ['load']], 'preview starts in local mode before reading');
    const beforeJoin = calls.length;
    onStatus?.('SUBSCRIBED', { reconnected: false });
    await waitRefresh();
    assert.equal(calls.length, beforeJoin, 'initial join does not duplicate initial refresh');

    onStatus?.('SUBSCRIBED', { reconnected: true });
    await waitRefresh();
    assert.equal(connection.dataConnected, true);
    assert.deepEqual(calls.slice(-3), [['mode', true], ['invalidate'], ['load']], 'reconnect switches mode and bypasses old cache before reading');

    const beforeChange = calls.length;
    events.dispatchEvent(new Event('bflow:revisions-invalidated'));
    await waitRefresh();
    assert.equal(calls.length, beforeChange + 3);
    assert.deepEqual(calls.slice(-3), [['mode', true], ['invalidate'], ['load']], 'change and fallback signals fetch fresh remote revisions');
    cleanup();
    const beforeUnmount = calls.length;
    events.dispatchEvent(new Event('bflow:revisions-invalidated'));
    await waitRefresh();
    assert.equal(calls.length, beforeUnmount);
    assert.equal(unsubscribed, true);
  } finally {
    cleanup();
    (globalThis as any).window = previousWindow;
  }
});
