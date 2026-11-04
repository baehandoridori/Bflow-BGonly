import test from 'node:test';
import assert from 'node:assert/strict';

import { capNotifications } from '../src/utils/notificationCap.ts';
import {
  SCENE_CHANGE_BUCKET_MS,
  dedupeNotificationsByIdentity,
  getNotificationIdentity,
  prependNotificationDeduped,
} from '../src/utils/notificationIdentity.ts';
import { parseNativeNotificationJump } from '../src/shared/nativeNotificationJump.ts';

type Row = { id: string; type: string; title?: string; body?: string; isRead: boolean; createdAt: string; metadata?: Record<string, unknown> };
const row = (id: string, type: string, isRead: boolean, minute = 0, metadata?: Record<string, unknown>): Row => ({
  id, type, isRead, createdAt: new Date(Date.UTC(2026, 10, 4, 10, minute)).toISOString(), metadata,
});

test('상한: 넘치면 읽은 것 → 단계 변경 → 오래된 댓글 순으로 버리고 안 읽은 멘션·배정·피드백은 지킨다', () => {
  // 최신이 앞
  const list = [
    row('mention-new', 'mention', false, 9),
    row('comment-new', 'comment', false, 8),
    row('read-1', 'mention', true, 7),
    row('stage', 'scene_change', false, 6),
    row('comment-old', 'comment', false, 5),
    row('assign', 'scene_assignment', false, 4),
    row('feedback', 'acting_feedback', false, 3),
    row('mention-old', 'mention', false, 2),
  ];
  assert.deepEqual(capNotifications(list, 7).map((n) => n.id), ['mention-new', 'comment-new', 'stage', 'comment-old', 'assign', 'feedback', 'mention-old']);
  assert.deepEqual(capNotifications(list, 6).map((n) => n.id), ['mention-new', 'comment-new', 'comment-old', 'assign', 'feedback', 'mention-old']);
  assert.deepEqual(capNotifications(list, 5).map((n) => n.id), ['mention-new', 'comment-new', 'assign', 'feedback', 'mention-old'], '오래된 댓글부터');
  assert.deepEqual(capNotifications(list, 4).map((n) => n.id), ['mention-new', 'assign', 'feedback', 'mention-old'], '지켜야 할 것만 남는다');
  assert.deepEqual(capNotifications(list, 2).map((n) => n.id), ['mention-new', 'assign'], '지킬 것만으로 넘치면 그 안에서 오래된 것부터');
  assert.equal(capNotifications(list, 50).length, list.length);
});

test('상한: 쌓아 넣을 때(prepend)·다시 읽을 때(dedupe) 모두 위치가 아니라 순서로 자른다', () => {
  const list = Array.from({ length: 50 }, (_, i) => row(`read-${i}`, 'comment', true, i % 60));
  const oldMention = row('old-mention', 'mention', false, 0, { commentId: 'm-old' });
  const withMention = [...list.slice(0, 49), oldMention];
  const next = prependNotificationDeduped(withMention, row('new', 'comment', false, 59, { commentId: 'c-new' }), 50);
  assert.equal(next.length, 50);
  assert.ok(next.some((n) => n.id === 'old-mention'), '맨 뒤의 안 읽은 멘션이 밀려나지 않는다');
  assert.equal(next[0]!.id, 'new');

  const deduped = dedupeNotificationsByIdentity([...withMention, row('extra', 'comment', true, 1)], 50);
  assert.equal(deduped.length, 50);
  assert.ok(deduped.some((n) => n.id === 'old-mention'));
});

test('단계 변경: 같은 사람 5분 안이면 한 줄 — 최근 제목·수 더하기·하나라도 안 읽었으면 안 읽음', () => {
  const base = Date.UTC(2026, 10, 4, 10, 0);
  const bucketStart = Math.floor(base / SCENE_CHANGE_BUCKET_MS) * SCENE_CHANGE_BUCKET_MS;
  const first: Row = { id: 's1', type: 'scene_change', title: '배한솔님이 a001 LO ✓ 완료', isRead: true, createdAt: new Date(bucketStart + 1000).toISOString(), metadata: { changedBy: '배한솔', sceneId: 'u1', sceneName: 'a001' } };
  const second: Row = { id: 's2', type: 'scene_change', title: '배한솔님이 a002 LO ✓ 완료', isRead: false, createdAt: new Date(bucketStart + 60_000).toISOString(), metadata: { changedBy: '배한솔', sceneId: 'u2', sceneName: 'a002' } };
  assert.equal(getNotificationIdentity(first), getNotificationIdentity(second));
  const merged = prependNotificationDeduped([first], second, 50);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.id, 's1', '원래 줄 id 를 지킨다');
  assert.equal(merged[0]!.title, '배한솔님이 a002 LO ✓ 완료');
  assert.equal(merged[0]!.metadata?.sceneName, 'a002', '이동은 최근 씬으로');
  assert.equal(merged[0]!.metadata?.changeCount, 2);
  assert.equal(merged[0]!.isRead, false);
  assert.equal(merged[0]!.createdAt, second.createdAt);

  // 저장된 목록(최신이 앞)을 다시 읽어도 최근 제목이 이긴다.
  const reloaded = dedupeNotificationsByIdentity([second, first], 50);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0]!.title, '배한솔님이 a002 LO ✓ 완료');

  // 다른 사람·5분 넘김·누가 바꿨는지 모르는 줄은 합치지 않는다.
  const otherPerson: Row = { ...second, id: 's3', metadata: { changedBy: '김어진', sceneId: 'u2' } };
  const later: Row = { ...second, id: 's4', createdAt: new Date(bucketStart + SCENE_CHANGE_BUCKET_MS + 1000).toISOString() };
  const anonymous: Row = { ...second, id: 's5', metadata: { sceneId: 'u2' } };
  assert.notEqual(getNotificationIdentity(otherPerson), getNotificationIdentity(first));
  assert.notEqual(getNotificationIdentity(later), getNotificationIdentity(first));
  assert.equal(getNotificationIdentity(anonymous), null);
});

test('Windows 알림 이동 묶음: 모양이 다르면 버리고, 값은 글자·숫자·참거짓·글자 목록만', () => {
  assert.equal(parseNativeNotificationJump(null), null);
  assert.equal(parseNativeNotificationJump('x'), null);
  assert.equal(parseNativeNotificationJump({ type: 'mention' }), null, 'id 없음');
  assert.equal(parseNativeNotificationJump({ notificationId: 'n1', type: 'mention', userId: 3 }), null, '계정 값이 이상함');
  const jump = parseNativeNotificationJump({
    notificationId: ' n1 ',
    userId: 'u1',
    type: 'mention',
    metadata: {
      commentId: 'c1',
      commentSceneId: '12',
      revisionId: '',
      nested: { a: 1 },
      fn: () => 1,
      count: 2,
      flag: true,
      emojis: ['👍', 3, ''],
      __proto__: 'x',
    },
  });
  assert.ok(jump);
  assert.equal(jump.notificationId, 'n1');
  assert.equal(jump.userId, 'u1');
  assert.deepEqual(jump.metadata, { commentId: 'c1', commentSceneId: '12', count: 2, flag: true, emojis: ['👍'] });
  assert.equal(parseNativeNotificationJump({ notificationId: 'n2', type: 'comment' })?.userId, null);
});
