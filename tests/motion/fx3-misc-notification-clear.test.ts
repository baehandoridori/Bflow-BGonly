/**
 * 코덱스 2차 지적 4172094266 — 알림 '전체 삭제'(와 한 줄 지우기)는 누른 순간 보이던 알림만 지운다.
 *
 * 예전: 줄들이 0.15초에 옅어진 '뒤'에 그때의 목록 전체를 지웠다. 그 사이 실시간으로 온 알림은 한 번도 보이지 못한 채
 * 읽음 처리(서버 쪽 포함)되고 지워졌으며, '되돌리기'도 그 알림까지 되살렸다.
 * 이제: 누를 때 대상(id + 만든 시각)을 뜨고, 움직임 뒤에는 그 대상만 지운다. 그사이 새로 온 알림, 같은 id 로 새 내용이 온
 * 알림(이모지 반응이 늘어 만든 시각이 바뀜)은 남고 읽음 처리되지 않는다. '되돌리기'는 실제로 지운 알림만 되살린다.
 *
 * 판단(src/utils/undoDelete.ts)과 저장소(src/stores/useNotificationStore.ts — esbuild 로 묶어 그대로 돌림)는 동작으로,
 * 알림 창 배선(NotificationPanel)은 소스 가드로 본다. 실제 화면은 미리보기에서 확인(옅어지는 사이 알림 주입 → 남음).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';

import { shownNotificationMarks, splitShownNotifications } from '../../src/utils/undoDelete.ts';

const nodeRequire = createRequire(import.meta.url);
const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/** `start` 로 시작하는 블록 본문(중괄호 짝 맞춤). */
function bodyOf(source: string, start: string): string {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `없음: ${start}`);
  const open = source.indexOf('{', at + start.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`닫히지 않음: ${start}`);
}

/* ─── 판단 ─────────────────────────────────────────────────────── */

const row = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({ id, createdAt, ...extra });

test('지울 대상 표시: 누른 순간 목록의 id 와 만든 시각만 뜬다', () => {
  assert.deepEqual(
    shownNotificationMarks([row('a', 't1', { title: '가', isRead: false }), row('b', 't2')]),
    [{ id: 'a', createdAt: 't1' }, { id: 'b', createdAt: 't2' }],
  );
  assert.deepEqual(shownNotificationMarks([]), []);
});

test('지우기 확정: 누른 순간 보이던 알림만 removed — 새로 온 알림·같은 id 새 내용은 kept, 이미 사라진 알림은 어디에도 없다', () => {
  const marks = shownNotificationMarks([row('a', 't1'), row('b', 't2'), row('c', 't3'), row('gone', 't0')]);
  const current = [
    row('b', 't8', { emojis: 2 }), // 옅어지는 사이 같은 반응 알림에 새 이모지 — 만든 시각이 바뀌어 맨 위로
    row('late', 't9'), // 옅어지는 사이 실시간으로 온 알림
    row('a', 't1', { isRead: true }), // 읽음 표시만 바뀜 — 같은 알림
    row('c', 't3'),
  ];
  const { kept, removed } = splitShownNotifications(current, marks);
  assert.deepEqual(kept.map((x) => x.id), ['b', 'late']);
  assert.deepEqual(removed.map((x) => x.id), ['a', 'c'], "그사이 사라진 'gone' 은 되살리지 않는다");
  assert.equal(removed[0].isRead, true, '지금 모습 그대로 돌려준다(되돌리기가 그대로 되살림)');
  assert.deepEqual(splitShownNotifications(current, []).removed, [], '대상이 없으면 아무것도 지우지 않는다');
  // 만든 시각이 빠진 옛 저장 알림 — 대상에 없는 id 를 '둘 다 없음'으로 같다고 보지 않는다
  const odd = [{ id: 'x', createdAt: undefined as unknown as string }];
  assert.deepEqual(splitShownNotifications(odd, [{ id: 'y', createdAt: undefined as unknown as string }]).removed, []);
});

/* ─── 저장소(실제 소스를 묶어 그대로) ─────────────────────────── */

const domainReadStub: Plugin = {
  name: 'stub-notification-domain-read',
  setup(builder) {
    builder.onResolve({ filter: /notificationDomainRead$/ }, () => ({ path: 'domain-read', namespace: 'fx3-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'fx3-stub' }, () => ({
      loader: 'js',
      contents: 'export function markNotificationDomainRead(type, metadata) { (globalThis.__fx3DomainReads ??= []).push({ type, id: metadata && metadata.__id }); }',
    }));
  },
};

type Notification = {
  id: string;
  type: string;
  title: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

interface StoreApi {
  getState(): {
    activeUserId: string | null;
    notifications: Notification[];
    unreadCount: number;
    addNotification(draft: Omit<Notification, 'id' | 'isRead' | 'createdAt'> & { createdAt?: string }): string;
    markAsRead(id: string): void;
    upsertCommentReaction(n: Notification): void;
    removeNotificationById(id: string): void;
    removeShownNotifications(marks: ReturnType<typeof shownNotificationMarks>, userId: string | null): Notification[];
    restoreNotifications(snapshot: Notification[], userId: string | null): boolean;
  };
  setState(partial: Record<string, unknown>): void;
}

let storeSource: string | null = null;

/** 저장소를 새로 하나 띄운다(테스트마다 따로). 디스크 쓰기·서버 읽음 처리는 기록만 한다. */
async function freshStore() {
  if (!storeSource) {
    const result = await build({
      entryPoints: ['src/stores/useNotificationStore.ts'],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false,
      logLevel: 'silent',
      external: ['react'],
      plugins: [domainReadStub],
    });
    storeSource = result.outputFiles[0].text;
  }
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', storeSource)(nodeRequire, module, module.exports);
  const store = module.exports.useNotificationStore as StoreApi;
  const writes: Notification[][] = [];
  const g = globalThis as Record<string, unknown>;
  g.window = { electronAPI: { writeSettings: async (_file: string, data: Notification[]) => { writes.push(data); return true; } } };
  g.__fx3DomainReads = [];
  const domainReads = () => (g.__fx3DomainReads as Array<{ id: string }>).map((entry) => entry.id);
  const resetDomainReads = () => { g.__fx3DomainReads = []; };
  return { store, writes, domainReads, resetDomainReads };
}

/** 저장 알림 하나 — 서버 쪽 읽음 처리 기록에서 가려내도록 metadata.__id 를 단다. */
const saved = (id: string, createdAt: string, type = 'comment', extra: Partial<Notification> = {}): Notification => ({
  id,
  type,
  title: `알림 ${id}`,
  isRead: false,
  createdAt,
  metadata: { __id: id, ...(type === 'comment_reaction' ? { reactionNotificationId: `rx-${id}` } : {}) },
  ...extra,
});

test('저장소: 전체 삭제 확정은 누른 순간 보이던 알림만 지우고 읽음 처리한다 — 그사이 온 알림은 남고, 되돌리기는 지운 것만', async () => {
  const { store, writes, domainReads, resetDomainReads } = await freshStore();
  store.setState({
    activeUserId: 'u1',
    notifications: [saved('a', '2026-10-03T10:03:00.000Z'), saved('r', '2026-10-03T10:02:00.000Z', 'comment_reaction'), saved('c', '2026-10-03T10:01:00.000Z')],
  });
  // '전체 삭제'를 누른 순간
  const marks = shownNotificationMarks(store.getState().notifications);

  // 줄들이 옅어지는 0.15초 사이
  const lateId = store.getState().addNotification({ type: 'comment', title: '늦게 온 알림', createdAt: '2026-10-03T10:04:00.000Z', metadata: { __id: 'late' } });
  store.getState().upsertCommentReaction(saved('r', '2026-10-03T10:05:00.000Z', 'comment_reaction', { title: '반응이 하나 더' }));
  store.getState().markAsRead('a');
  resetDomainReads();
  writes.length = 0;

  // 움직임이 끝난 뒤 확정
  const removed = store.getState().removeShownNotifications(marks, 'u1');
  assert.deepEqual(removed.map((n) => n.id), ['a', 'c'], '누른 순간 보이던(그리고 그대로인) 알림만 지운다');
  assert.equal(removed[0].isRead, true, '지금 모습 그대로(되돌리기가 읽음 표시까지 되살림)');
  assert.deepEqual(store.getState().notifications.map((n) => n.id), ['r', lateId], '새로 온 알림·새 내용이 온 반응 알림은 남는다');
  assert.equal(store.getState().notifications.find((n) => n.id === 'r')?.title, '반응이 하나 더');
  assert.equal(store.getState().unreadCount, 2, '남은 두 알림은 안 읽음 그대로');
  assert.deepEqual(domainReads(), ['a', 'c'], '서버 쪽 읽음 처리도 지운 알림에만');
  assert.deepEqual(writes.at(-1)?.map((n) => n.id), ['r', lateId], '파일에도 남은 알림만');

  // 되돌리기 — 실제로 지운 알림만, 그사이 온 알림 아래에 원래 순서대로
  resetDomainReads();
  assert.equal(store.getState().restoreNotifications(removed, 'u1'), true);
  assert.deepEqual(store.getState().notifications.map((n) => n.id), ['r', lateId, 'a', 'c']);
  assert.deepEqual(domainReads(), [], '되돌리기는 서버 쪽을 건드리지 않는다');
});

test('저장소: 누른 뒤 계정이 바뀌었거나 대상이 비면 아무것도 지우지 않는다', async () => {
  const { store, writes, domainReads } = await freshStore();
  store.setState({ activeUserId: 'u1', notifications: [saved('a', 't1'), saved('b', 't2')] });
  const marks = shownNotificationMarks(store.getState().notifications);
  store.setState({ activeUserId: 'u2', notifications: [saved('a', 't1'), saved('x', 't3')] });
  assert.deepEqual(store.getState().removeShownNotifications(marks, 'u1'), []);
  assert.deepEqual(store.getState().notifications.map((n) => n.id), ['a', 'x'], '다른 계정 목록은 그대로(같은 id 가 있어도)');
  assert.deepEqual(store.getState().removeShownNotifications([], 'u2'), []);
  assert.deepEqual(domainReads(), []);
  assert.equal(writes.length, 0, '파일도 건드리지 않는다');
});

test('저장소: 한 줄 지우기 — 밀려나는 사이 같은 알림에 새 내용이 오면 지우지 않고, 그대로면 지운다', async () => {
  const { store, domainReads } = await freshStore();
  store.setState({ activeUserId: 'u1', notifications: [saved('r', 't1', 'comment_reaction'), saved('b', 't0')] });
  const marks = shownNotificationMarks(store.getState().notifications.filter((n) => n.id === 'r'));
  store.getState().upsertCommentReaction(saved('r', 't5', 'comment_reaction', { title: '새 이모지' }));
  assert.deepEqual(store.getState().removeShownNotifications(marks, 'u1'), [], '새 내용은 못 본 알림 — 남긴다');
  assert.deepEqual(store.getState().notifications.map((n) => n.id), ['r', 'b']);
  assert.deepEqual(domainReads(), []);

  const again = shownNotificationMarks(store.getState().notifications.filter((n) => n.id === 'b'));
  assert.deepEqual(store.getState().removeShownNotifications(again, 'u1').map((n) => n.id), ['b']);
  assert.deepEqual(store.getState().notifications.map((n) => n.id), ['r']);
  assert.deepEqual(domainReads(), ['b']);
});

/* ─── 알림 창 배선(소스 가드) ───────────────────────────────────── */

const panel = read('src/components/NotificationPanel.tsx');

test('알림 창 전체 삭제: 대상은 누를 때 뜨고, 움직임 뒤에는 그 대상만 지운다(그때의 목록을 다시 읽지 않는다)', () => {
  const clear = bodyOf(panel, 'const handleClearAll = useCallback(() =>');
  assert.match(clear, /const \{ notifications: shown, activeUserId: userId \} = useNotificationStore\.getState\(\);\s*const marks = shownNotificationMarks\(shown\);\s*if \(marks\.length === 0\) return;/);
  const markAt = clear.indexOf('const marks = shownNotificationMarks(shown);');
  const commitAt = clear.indexOf('const commit = () =>');
  const timerAt = clear.indexOf('window.setTimeout(commit, NOTIFICATION_CLEAR_FADE_MS);');
  assert.ok(markAt >= 0 && markAt < commitAt && commitAt < timerAt, '누를 때 뜬 대상을 확정이 쓴다');
  const commit = bodyOf(clear, 'const commit = () =>');
  assert.match(commit, /const removed = useNotificationStore\.getState\(\)\.removeShownNotifications\(marks, userId\);/);
  assert.doesNotMatch(commit, /clearAll\(|\.notifications\b|activeUserId/, '확정 때의 전체 목록·계정을 쓰지 않는다');
  assert.match(commit, /useNotificationStore\.getState\(\)\.restoreNotifications\(removed, userId\);/, '되돌리기는 지운 것만');
  assert.doesNotMatch(panel, /\.clearAll\(\)/);
});

test('알림 창 전체 삭제: 옅어짐은 비우기를 마치면 푼다 — 남은 줄(그사이 온 알림)이 있어도, 지운 것이 없어도', () => {
  const clear = bodyOf(panel, 'const handleClearAll = useCallback(() =>');
  const commit = bodyOf(clear, 'const commit = () =>');
  // 옅어지는 중이었으면 목록이 바뀐 다음 그림에서 푼다(표시는 저장소를 바꾸기 전에)
  assert.ok(commit.indexOf('clearCommittedRef.current = clearFadeRef.current !== null;') >= 0);
  assert.ok(commit.indexOf('clearCommittedRef.current = clearFadeRef.current !== null;') < commit.indexOf('removeShownNotifications('));
  assert.match(panel, /if \(clearFadeRef\.current && clearCommittedRef\.current\) \{\s*clearCommittedRef\.current = false;\s*revealClearedList\(clearFadeRef\.current, list, reduce\);\s*clearFadeRef\.current = null;\s*return;/);
  assert.doesNotMatch(panel, /clearFadeRef\.current && notifications\.length === 0/, "'목록이 비었을 때만' 풀면 남은 줄이 투명한 채 남는다");
  // 지운 것이 없으면(그사이 모두 사라짐·계정 전환) 다시 그려지지 않으니 그 자리에서 푼다
  assert.match(commit, /if \(removed\.length === 0\) \{\s*\/\/[^\n]*\n\s*clearCommittedRef\.current = false;\s*if \(clearFadeRef\.current\) revealClearedList\(clearFadeRef\.current, listRef\.current, reduce\);\s*clearFadeRef\.current = null;\s*return;/);
  const reveal = bodyOf(panel, 'function revealClearedList(');
  assert.match(reveal, /fade\?\.cancel\(\);\s*if \(list\) list\.style\.pointerEvents = '';\s*animateEl\(list, \[\{ opacity: 0 \}, \{ opacity: 1 \}\], \{ duration: MOTION_MS\.fast, easing: EASE_CSS\.out \}, reduce\);/);
});

test('알림 창 한 줄 지우기: 누른 순간의 그 알림만 — 지우지 않았으면 잰 위치를 버리고 밀려난 줄을 되돌린다', () => {
  const remove = bodyOf(panel, 'const handleRemove = useCallback<RemoveNotificationRow>((id, row) =>');
  assert.match(remove, /const \{ notifications: shown, activeUserId: userId \} = useNotificationStore\.getState\(\);\s*const marks = shownNotificationMarks\(shown\.filter\(\(n\) => n\.id === id\)\);\s*if \(marks\.length === 0\) return;/);
  const commit = bodyOf(remove, 'const commit = () =>');
  assert.match(commit, /if \(useNotificationStore\.getState\(\)\.removeShownNotifications\(marks, userId\)\.length > 0\) return;\s*\/\/[^\n]*\n\s*rowShiftBeforeRef\.current = null;\s*exit\?\.cancel\(\);\s*if \(row\) row\.style\.pointerEvents = '';/);
  assert.doesNotMatch(remove, /removeNotification\(/);
});
