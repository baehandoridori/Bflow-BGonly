import test from 'node:test';
import assert from 'node:assert/strict';

import {
  firstRunServerRowFilter,
  presentServerCommentRows,
  type PresentServerRowsDeps,
  type PresentedServerDecision,
} from '../src/utils/commentNotificationPresent.ts';
import type { CommentNotificationRow } from '../src/shared/commentNotification.ts';

// 서버 알림 줄 → 알림 목록·토스트(씬 댓글 B안 PR 6): 조용히/띄우기, 읽은 줄, 이미 띄운 댓글, 계정 전환, 업데이트 뒤 첫 실행 거르기.
const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 1, minute)).toISOString();
const row = (n: number, over: Partial<CommentNotificationRow> = {}): CommentNotificationRow => ({
  id: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`, commentId: `c${n}`, kind: 'add', reason: 'mention', detail: null,
  eventAt: at(n), editAt: null, readAt: null, revisionNo: null,
  comment: {
    partId: 'p', sceneId: '1', sceneUuid: null, userId: 'kim', userName: '김어진', text: '본문', mentions: [], imageCount: 0,
    parentCommentId: null, revisionId: null, characterId: null, createdAt: at(n), editedAt: null,
  },
  ...over,
});

function harness(options: { listed?: string[]; current?: () => boolean; claimed?: string[] } = {}) {
  const added: Array<Record<string, unknown>> = [];
  const dispatched: Array<{ payload: Record<string, unknown>; options: { quiet: boolean; native: boolean } }> = [];
  const mentions: string[] = [];
  const claimed = new Set(options.claimed ?? []);
  const deps: PresentServerRowsDeps = {
    isCurrent: options.current ?? (() => true),
    decide: (r): PresentedServerDecision | null => (r.reason === 'auto' && r.detail === null ? null : {
      type: r.reason === 'auto' ? 'comment' : 'mention', title: `t-${r.commentId}`, body: '', quiet: r.reason === 'auto', native: r.reason !== 'auto',
      metadata: { commentId: r.commentId }, dedupeKey: `${r.commentId}:${r.reason}`, createdAt: r.comment.createdAt,
    }),
    claim: (key) => (claimed.has(key) ? false : (claimed.add(key), true)),
    identityOf: (_type, metadata) => `scene_comment:${metadata.commentId}`,
    isListed: (identity) => (options.listed ?? []).includes(identity),
    add: (draft) => { added.push(draft); },
    dispatch: (payload, opts) => { dispatched.push({ payload, options: opts }); },
    onMention: (createdAt) => { mentions.push(createdAt); },
  };
  return { deps, added, dispatched, mentions };
}

test('조용히(로그인 모으기)면 목록에만, 서버 줄 id 를 싣고 원래 시각으로, 새 안 읽은 것만 센다', () => {
  const h = harness({ listed: ['scene_comment:c2'] });
  const count = presentServerCommentRows([row(1), row(2), row(3, { readAt: at(30) })], true, h.deps);
  assert.equal(count, 1, 'c2 는 이미 목록에, c3 은 다른 PC 에서 읽음');
  assert.deepEqual(h.added.map((d) => [d.title, d.createdAt, d.isRead ?? false, (d.metadata as Record<string, unknown>).serverNotificationId]), [
    ['t-c1', at(1), false, row(1).id], ['t-c2', at(2), false, row(2).id], ['t-c3', at(3), true, row(3).id],
  ]);
  assert.equal(h.dispatched.length, 0);
  assert.deepEqual(h.mentions, [at(1), at(2)], '읽은 줄은 기준 시각을 옮기지 않는다');
});

test('실시간이면 판정 세기 그대로 띄우고, 다른 PC 에서 읽은 줄은 띄우지 않고 읽은 채로 넣는다', () => {
  const h = harness();
  presentServerCommentRows([row(1), row(2, { reason: 'auto', detail: 'assignee' }), row(3, { readAt: at(30) })], false, h.deps);
  assert.deepEqual(h.dispatched.map((d) => [d.payload.title, d.options]), [
    ['t-c1', { quiet: false, native: true }], ['t-c2', { quiet: true, native: false }],
  ]);
  assert.deepEqual(h.added.map((d) => [d.title, d.isRead]), [['t-c3', true]]);
});

test('실시간 판정이 이미 띄운 댓글(같은 중복 키)·판정 없는 줄은 건너뛰고, 계정이 바뀌면 멈춘다', () => {
  const h = harness({ claimed: ['c1:mention'] });
  presentServerCommentRows([row(1), row(2, { reason: 'auto' }), row(3)], false, h.deps);
  assert.deepEqual(h.dispatched.map((d) => d.payload.title), ['t-c3']);
  let current = true;
  const stop = harness({ current: () => current });
  const stopAfterFirst = { ...stop.deps, add: (draft: Parameters<PresentServerRowsDeps['add']>[0]) => { stop.added.push(draft); current = false; } };
  presentServerCommentRows([row(4), row(5)], true, stopAfterFirst);
  assert.deepEqual(stop.added.map((d) => d.title), ['t-c4']);
});

test('업데이트 뒤 첫 실행: 자동 알림은 직전 몇 분만, 나를 부른 알림은 예전 기준 시각보다 뒤만', () => {
  const startedAt = Date.parse(at(40));
  const filter = firstRunServerRowFilter({ lastSeenAt: at(20), startedAt, autoWindowMs: 2 * 60 * 1000, mentionWindowMs: 10 * 60 * 1000 });
  assert.equal(filter(row(10, { reason: 'auto', detail: 'assignee', eventAt: at(30) })), false, '예전 버전이 실시간으로 보여 준 자동 알림');
  assert.equal(filter(row(11, { reason: 'auto', detail: 'assignee', eventAt: at(39) })), true, '업데이트하는 사이 온 자동 알림');
  assert.equal(filter(row(12, { eventAt: at(20) })), false, '기준 시각과 같으면 이미 받은 것');
  assert.equal(filter(row(13, { reason: 'reply', eventAt: at(21) })), true);
  assert.equal(filter(row(14, { reason: 'retake', eventAt: at(5) })), false);
  const fresh = firstRunServerRowFilter({ lastSeenAt: null, startedAt, autoWindowMs: 2 * 60 * 1000, mentionWindowMs: 10 * 60 * 1000 });
  assert.equal(fresh(row(15, { eventAt: at(29) })), false, '기준 시각이 없으면(첫 로그인) 10분 안쪽만');
  assert.equal(fresh(row(16, { eventAt: at(31) })), true);
  assert.equal(fresh(row(17, { eventAt: 'nope' })), false);
});
