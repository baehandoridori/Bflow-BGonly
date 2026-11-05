import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommentNotificationPreviewStore } from '../src/mocks/commentNotificationPreviewStore.ts';
import type { RecipientWorld } from '../src/shared/commentNotificationRecipients.ts';
import type { CommentNotificationComment } from '../src/shared/commentNotification.ts';

// 미리보기 씬 댓글 서버 알림 저장소(씬 댓글 B안 PR 6): 서버 트리거·래퍼와 같은 받는 사람·커서·읽음, 창 사이 신호.
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function channelHub() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  return () => ({
    postMessage(message: unknown) { for (const listener of [...listeners]) listener({ data: message }); },
    addEventListener(_type: 'message', listener: (event: { data: unknown }) => void) { listeners.add(listener); },
    close() { /* 공유 허브라 닫지 않는다 */ },
  });
}
let ids = 0;
const nextId = () => `00000000-0000-4000-8000-${(++ids).toString().padStart(12, '0')}`;
let clock = Date.UTC(2026, 10, 5, 1, 0, 0);
const now = () => new Date(clock).toISOString();

const world: RecipientWorld & { comments: RecipientWorld['comments'][number][] } = {
  users: [{ id: '1', name: '배한솔' }, { id: '7', name: '원동우' }, { id: '8', name: '이혜민' }],
  episodes: [{ id: 'ep-5', active: true }],
  parts: [{ id: 'part-a-bg', episodeId: 'ep-5', partLetter: 'A', department: 'bg', active: true }],
  scenes: [{ id: 'scene-a1', partId: 'part-a-bg', sceneNumber: 'a001', sortOrder: 1, assignee: '원동우' }],
  comments: [],
  revisions: [],
};
const snapshot = (userId: string, mentions: string[]): CommentNotificationComment => ({
  partId: 'part-a-bg', sceneId: '1', sceneUuid: null, userId, userName: world.users.find((u) => u.id === userId)!.name,
  text: '본문', mentions, imageCount: 0, parentCommentId: null, revisionId: null, characterId: null, createdAt: now(), editedAt: null,
});

test('쓴 창이 받는 사람별 줄을 만들고, 다른 창은 신호를 받아 자기 줄만 읽는다', async () => {
  const storage = memoryStorage();
  const openChannel = channelHub();
  const writer = createCommentNotificationPreviewStore({ storage, locks: null, openChannel, now, newId: nextId });
  const reader = createCommentNotificationPreviewStore({ storage, locks: null, openChannel, now, newId: nextId });
  let writerSignals = 0, readerSignals = 0;
  writer.subscribe(() => { writerSignals += 1; });
  reader.subscribe(() => { readerSignals += 1; });

  world.comments.push({ id: 'c1', userId: '8', partId: 'part-a-bg', sceneId: '1', sceneUuid: null, mentions: ['배한솔'], parentCommentId: null, revisionId: null, characterId: null });
  assert.equal(await writer.fanoutAdd(world, 'c1', snapshot('8', ['배한솔'])), 2);
  assert.equal(writerSignals, 1, '쓴 창도 신호를 받는다(서버 신호도 모두에게)');
  assert.equal(readerSignals, 1);
  const han = await reader.list('1', null);
  assert.deepEqual(han.rows.map((row) => [row.commentId, row.reason, row.detail]), [['c1', 'mention', null]]);
  const won = await reader.list('7', null);
  assert.deepEqual(won.rows.map((row) => [row.reason, row.detail]), [['auto', 'assignee']]);
  assert.deepEqual((await reader.list('8', null)).rows, [], '작성자 본인은 없음');

  // 받는 사람이 없는 댓글은 줄도 신호도 없다.
  world.comments.push({ id: 'c2', userId: '7', partId: 'part-a-bg', sceneId: '1', sceneUuid: null, mentions: [], parentCommentId: null, revisionId: null, characterId: null });
  clock += 1000;
  assert.equal(await writer.fanoutAdd(world, 'c2', snapshot('7', [])), 1, '이혜민은 참여자(c1 작성)');
  world.comments.push({ id: 'c3', userId: '1', partId: null, sceneId: null, sceneUuid: null, mentions: [], parentCommentId: null, revisionId: null, characterId: 'char-1' });
  assert.equal(await writer.fanoutAdd(world, 'c3', { ...snapshot('1', []), characterId: 'char-1' }), 0);
  assert.equal(readerSignals, 2);

  // 커서: 그 뒤 줄만. 읽음: 내 줄만, 다시 읽어도 0.
  const after = await reader.list('8', { at: now(), id: null });
  assert.deepEqual(after.rows, []);
  assert.deepEqual((await reader.list('8', { at: new Date(clock - 2000).toISOString(), id: null })).rows.map((row) => row.commentId), ['c2']);
  assert.deepEqual(await reader.markRead('1', { addCommentIds: ['c1', 'c2'], editTargets: [] }), { available: true, updated: 1 });
  assert.deepEqual(await reader.markRead('1', { addCommentIds: ['c1'], editTargets: [] }), { available: true, updated: 0 });
  assert.ok((await reader.list('1', null)).rows[0]!.readAt);
  assert.equal((await reader.list('7', null)).rows[0]!.readAt, null);

  // 수정으로 넣은 @: 그 사람에게 수정 줄, 다시 넣으면 안 읽음으로. 댓글 내용도 모든 줄에서 고친다.
  clock += 1000;
  const editedAt = now();
  assert.equal(await writer.fanoutEdit(world, 'c1', ['배한솔'], { ...snapshot('8', ['배한솔', '원동우']), text: '고친 본문', editedAt }), 1);
  const wonRows = (await reader.list('7', null)).rows;
  assert.deepEqual(wonRows.map((row) => [row.kind, row.reason]), [['add', 'auto'], ['edit', 'mention']]);
  assert.ok(wonRows.every((row) => row.comment.text === '고친 본문'));
  assert.equal(wonRows[1]!.editAt, editedAt, '수정 줄은 그 수정의 시각');
  assert.equal(wonRows[0]!.editAt, null);
  // 실서버 래퍼처럼 댓글이 아직 있는 줄만 돌려줄 수 있다.
  assert.deepEqual((await reader.list('7', null, 200, (commentId) => commentId !== 'c1')).rows, []);
  assert.deepEqual(await reader.markRead('7', { addCommentIds: [], editTargets: [{ commentId: 'c1', editAt: new Date(clock - 1).toISOString() }] }), { available: true, updated: 0 }, '다른 수정 시각으로는 읽음이 되지 않는다');
  assert.deepEqual(await reader.markRead('7', { addCommentIds: [], editTargets: [{ commentId: 'c1', editAt: editedAt }] }), { available: true, updated: 1 });
  clock += 1000;
  await writer.fanoutEdit(world, 'c1', ['배한솔'], { ...snapshot('8', ['배한솔', '원동우']), editedAt: now() });
  const again = (await reader.list('7', null)).rows.find((row) => row.kind === 'edit')!;
  assert.equal(again.readAt, null);
  assert.equal(again.eventAt, now());

  // 댓글을 지우면 그 줄도.
  await writer.removeComment('c1');
  assert.deepEqual((await reader.list('1', null)).rows, []);
});

test('저장소가 막혀도 이 창 메모리로 이어 간다', async () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const store = createCommentNotificationPreviewStore({ storage: broken, locks: null, openChannel: null, now, newId: nextId });
  world.comments.push({ id: 'm1', userId: '8', partId: null, sceneId: null, sceneUuid: null, mentions: ['배한솔'], parentCommentId: null, revisionId: null, characterId: 'char-2' });
  assert.equal(await store.fanoutAdd(world, 'm1', { ...snapshot('8', ['배한솔']), characterId: 'char-2' }), 1);
  assert.deepEqual((await store.list('1', null)).rows.map((row) => row.commentId), ['m1']);
});
