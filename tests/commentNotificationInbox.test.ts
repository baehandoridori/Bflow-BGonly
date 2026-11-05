import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommentNotificationInbox, type CommentNotificationInboxState } from '../src/utils/commentNotificationInbox.ts';
import type { CommentNotificationCursor, CommentNotificationRow } from '../src/shared/commentNotification.ts';

// 씬 댓글 서버 알림 받기함(씬 댓글 B안 PR 6): 커서·겹쳐 다시 읽기·본 줄 거르기·쪽 넘기기·서버 없음.
const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 5, 1, minute, second)).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const row = (n: number, minute: number, over: Partial<CommentNotificationRow> = {}): CommentNotificationRow => ({
  id: id(n), commentId: `c${n}`, kind: 'add', reason: 'mention', detail: null, eventAt: at(minute), readAt: null, revisionNo: null,
  comment: {
    partId: null, sceneId: null, sceneUuid: null, userId: 'kim', userName: '김어진', text: '', mentions: [], imageCount: 0,
    parentCommentId: null, revisionId: null, characterId: null, createdAt: at(minute), editedAt: null,
  },
  ...over,
});

function harness(server: CommentNotificationRow[], options: { available?: boolean; fail?: boolean } = {}) {
  const calls: Array<CommentNotificationCursor | null> = [];
  const presented: Array<{ ids: string[]; quiet: boolean }> = [];
  let saved: CommentNotificationInboxState | null = null;
  const inbox = createCommentNotificationInbox({
    list: async (cursor, limit) => {
      calls.push(cursor);
      if (options.fail) throw new Error('network');
      if (options.available === false) return { available: false, rows: [] };
      const after = (r: CommentNotificationRow) => !cursor
        || Date.parse(r.eventAt) > Date.parse(cursor.at)
        || (cursor.id !== null && Date.parse(r.eventAt) === Date.parse(cursor.at) && r.id > cursor.id);
      return { available: true, rows: server.filter(after).sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt) || (a.id < b.id ? -1 : 1)).slice(0, limit) };
    },
    present: (rows, quiet) => { presented.push({ ids: rows.map((r) => r.commentId), quiet }); return rows.filter((r) => !r.readAt).length; },
    loadState: () => saved,
    saveState: (state) => { saved = JSON.parse(JSON.stringify(state)); },
  }, { overlapMs: 2 * 60 * 1000, pageSize: 2, maxPages: 3, liveBurst: 2 });
  return { inbox, calls, presented, saved: () => saved, setSaved: (state: CommentNotificationInboxState | null) => { saved = state; } };
}

test('처음엔 주어진 시작점에서 겹침만큼 앞당겨 읽고, 조용히 넘기고, 가장 새 줄을 커서로 저장한다', async () => {
  const h = harness([row(1, 0), row(2, 10), row(3, 11)]);
  const result = await h.inbox.pull('catchup', { at: at(5), id: null });
  assert.deepEqual(h.calls[0], { at: at(3), id: null }, '2분 앞당김');
  assert.deepEqual(h.presented, [{ ids: ['c2', 'c3'], quiet: true }]);
  assert.deepEqual(result, { status: 'done', presented: 2, quieted: false });
  assert.deepEqual(h.saved()?.cursor, { at: at(11), id: id(3) });
});

test('다시 읽은 겹침 줄은 거르고, 다시 켜도(저장된 본 줄) 지운 알림이 되살아나지 않는다', async () => {
  const server = [row(1, 10), row(2, 11)];
  const h = harness(server);
  await h.inbox.pull('catchup', { at: at(9), id: null });
  server.push(row(3, 12));
  await h.inbox.pull('live');
  assert.deepEqual(h.presented.at(-1), { ids: ['c3'], quiet: false }, '새 줄만 실시간으로');
  // 새 세션: 같은 저장 상태로 새 받기함 — 커서에서 2분 앞까지 다시 읽어도 본 줄은 거른다.
  const restarted = harness(server);
  restarted.setSaved(h.saved());
  await restarted.inbox.pull('catchup');
  assert.deepEqual(restarted.presented, [], '겹쳐 다시 읽은 줄은 다시 넘기지 않는다');
  assert.deepEqual(restarted.calls[0], { at: at(10), id: null });
});

test('수정으로 다시 고쳐진 줄(같은 id, 새 시각)은 새 줄로 본다', async () => {
  const server = [row(1, 10, { kind: 'edit' })];
  const h = harness(server);
  await h.inbox.pull('catchup', { at: at(9), id: null });
  server[0] = { ...server[0]!, eventAt: at(11) };
  await h.inbox.pull('live');
  assert.deepEqual(h.presented.map((p) => p.ids), [['c1'], ['c1']]);
});

test('쪽 넘기기는 마지막 줄의 (시각, id) 로, 쪽 수 한도에 닿으면 저장하고 같은 읽기 안에서 끝까지 이어 받는다', async () => {
  const server = Array.from({ length: 8 }, (_, i) => row(i + 1, 10, { eventAt: at(10, i) }));
  const h = harness(server);
  const result = await h.inbox.pull('catchup', { at: at(9), id: null });
  assert.deepEqual(h.calls.slice(1, 3), [{ at: at(10, 1), id: id(2) }, { at: at(10, 3), id: id(4) }]);
  assert.deepEqual(h.presented.map((p) => p.ids), [['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], ['c7', 'c8']], '코덱스 2차: 한도에서 멈추지 않고 최근 줄까지');
  assert.equal(result.presented, 8);
  assert.deepEqual(h.saved()?.cursor, { at: at(10, 7), id: id(8) });
  await h.inbox.pull('catchup');
  assert.equal(h.presented.length, 2, '다시 읽어도 새 줄 없음');
});

test('live 에서 한도를 넘게 쌓여 있으면 이어 받는 몫까지 조용히 넣고 수를 알린다', async () => {
  const server = [row(1, 10)];
  const h = harness(server);
  await h.inbox.pull('catchup', { at: at(9), id: null });
  for (let i = 0; i < 7; i++) server.push(row(10 + i, 11, { eventAt: at(11, i) }));
  const result = await h.inbox.pull('live');
  assert.ok(h.presented.slice(1).every((p) => p.quiet), '한꺼번에 온 것은 조용히');
  assert.deepEqual(h.presented.slice(1).flatMap((p) => p.ids), ['c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16']);
  assert.deepEqual([result.presented, result.quieted], [7, true]);
});

test('다시 읽는 구간의 본 줄은 개수와 상관없이 남긴다 — 다시 켜도 지운 알림이 되살아나지 않는다', async () => {
  const server = Array.from({ length: 6 }, (_, i) => row(i + 1, 10, { eventAt: at(10, i) }));
  const first = createCommentNotificationInbox({
    list: async (cursor, limit) => ({ available: true, rows: server.filter((r) => !cursor || Date.parse(r.eventAt) > Date.parse(cursor.at) || (cursor.id !== null && Date.parse(r.eventAt) === Date.parse(cursor.at) && r.id > cursor.id)).slice(0, limit) }),
    present: (rows) => rows.length,
    loadState: () => null,
    saveState: (state) => { saved = JSON.parse(JSON.stringify(state)); },
  }, { seenLimit: 2, pageSize: 200 });
  let saved: CommentNotificationInboxState | null = null;
  await first.pull('catchup', { at: at(9), id: null });
  assert.equal(saved!.seen.length, 6, '2분 안쪽 줄 여섯 모두');
  const presented: string[] = [];
  const restarted = createCommentNotificationInbox({
    list: async (cursor, limit) => ({ available: true, rows: server.filter((r) => !cursor || Date.parse(r.eventAt) > Date.parse(cursor.at)).slice(0, limit) }),
    present: (rows) => { presented.push(...rows.map((r) => r.commentId)); return rows.length; },
    loadState: () => saved,
    saveState: () => undefined,
  }, { seenLimit: 2 });
  await restarted.pull('catchup');
  assert.deepEqual(presented, []);
});

test('live 에서 한꺼번에 많이 오면 조용히 넣고 그 수를 알린다', async () => {
  const server = [row(1, 10)];
  const h = harness(server);
  await h.inbox.pull('catchup', { at: at(9), id: null });
  server.push(row(2, 11), row(3, 11, { eventAt: at(11, 1) }), row(4, 11, { eventAt: at(11, 2) }));
  const result = await h.inbox.pull('live');
  assert.deepEqual(h.presented.at(-1), { ids: ['c2', 'c3', 'c4'], quiet: true });
  assert.deepEqual(result, { status: 'done', presented: 3, quieted: true });
});

test('show 로 고르지 않은 줄도 본 줄·커서에는 들어가 다음 읽기에서 다시 나오지 않는다', async () => {
  const server = [row(1, 10, { reason: 'auto', detail: 'assignee' }), row(2, 11)];
  const h = harness(server);
  const first = await h.inbox.pull('catchup', { at: at(9), id: null }, { show: (r) => r.reason !== 'auto' });
  assert.deepEqual(h.presented, [{ ids: ['c2'], quiet: true }]);
  assert.equal(first.presented, 1);
  assert.deepEqual(h.saved()?.cursor, { at: at(11), id: id(2) });
  await h.inbox.pull('live');
  assert.equal(h.presented.length, 1, '고르지 않은 줄(c1)도 다시 넘기지 않는다');
});

test('서버에 줄이 없으면 unavailable, 실패하면 failed — 커서는 그대로', async () => {
  const none = harness([row(1, 10)], { available: false });
  assert.equal((await none.inbox.pull('catchup', { at: at(9), id: null })).status, 'unavailable');
  assert.equal(none.saved(), null);
  const broken = harness([row(1, 10)], { fail: true });
  assert.equal((await broken.inbox.pull('catchup', { at: at(9), id: null })).status, 'failed');
  assert.equal(broken.saved(), null);
});

test('읽는 중에 온 요청들은 아직 시작 안 한 다음 읽기 하나로 합친다 — 하나라도 catchup 이면 조용히', async () => {
  let release!: () => void;
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let lists = 0;
  const presented: boolean[] = [];
  const server = [row(1, 10)];
  const inbox = createCommentNotificationInbox({
    list: async () => { lists += 1; const snapshot = [...server]; await gate; return { available: true, rows: snapshot }; },
    present: (rows, quiet) => { presented.push(quiet); return rows.length; },
    loadState: () => null,
    saveState: () => undefined,
  });
  const first = inbox.pull('live', { at: at(9), id: null });
  await new Promise((resolve) => setTimeout(resolve, 5));
  server.push(row(2, 11));
  const second = inbox.pull('live');
  const third = inbox.pull('catchup');
  assert.equal(second, third, '같은 다음 읽기');
  release();
  await first;
  gate = Promise.resolve();
  const merged = await second;
  assert.equal(lists, 2, '읽기는 두 번뿐(세 번째 요청은 합쳐짐)');
  assert.deepEqual(presented, [false, true], '합친 읽기는 catchup 이라 조용히');
  assert.deepEqual([merged.status, merged.presented, merged.quieted], ['done', 1, false]);
  // 첫 실행 거르기(show)가 있는 요청은 합치지 않고 따로 선다.
  const filtered = inbox.pull('catchup', null, { show: () => true });
  const plain = inbox.pull('live');
  assert.notEqual(filtered, plain);
  await Promise.all([filtered, plain]);
});

test('요청은 한 줄로 서고, 버린(dispose) 받기함은 응답을 넘기지 않는다', async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inbox = createCommentNotificationInbox({
    list: async (cursor) => { order.push(`list:${cursor?.at ?? 'none'}`); await gate; return { available: true, rows: [row(1, 10)] }; },
    present: (rows) => { order.push(`present:${rows.length}`); return rows.length; },
    loadState: () => null,
    saveState: () => undefined,
  });
  const first = inbox.pull('catchup', { at: at(9), id: null });
  const second = inbox.pull('live');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(order, [`list:${at(7)}`], '두 번째는 첫 번째가 끝난 뒤');
  inbox.dispose();
  release();
  assert.equal((await first).status, 'failed');
  assert.equal((await second).status, 'failed');
  assert.ok(!order.some((step) => step.startsWith('present')));
});
