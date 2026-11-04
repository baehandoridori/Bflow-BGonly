import test from 'node:test';
import assert from 'node:assert/strict';

import {
  availableRetakeActions,
  buildCommentFeed,
  commentDayLabel,
  groupedFlags,
  isGroupedWithPrevious,
  retakeActivityPhase,
  retakeActivitySentence,
  retakeCardStatus,
  type FeedCommentLike,
  type FeedEventLike,
} from '../src/utils/commentFeedModel.ts';
import { avatarColor, avatarInitials, avatarSlot } from '../src/utils/userAvatar.ts';

const NOW = new Date(2026, 10, 4, 15, 0, 0); // 2026-11-04(수) 오후 3시
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m, 0).toISOString();
let seq = 0;
const c = (over: Partial<FeedCommentLike> & { userId?: string }): FeedCommentLike => {
  seq += 1;
  return { id: `c${seq}`, userId: 'u-kim', userName: '김어진', createdAt: at(4, 10, seq), ...over };
};
const ev = (over: Partial<FeedEventLike>): FeedEventLike => {
  seq += 1;
  return { id: `e${seq}`, at: at(4, 10, seq), ...over };
};
const none = () => false;

test('본문에는 원댓글만 — 답글은 원댓글 아래 요약(참여자·마지막·새 N)', () => {
  const root = c({ id: 'root', userId: 'u-kang', userName: '강선영', createdAt: at(4, 10, 12) });
  const r1 = c({ id: 'r1', parentCommentId: 'root', userId: 'u-kim', userName: '김어진', createdAt: at(4, 10, 18) });
  const r2 = c({ id: 'r2', parentCommentId: 'root', userId: 'u-park', userName: '박정인', createdAt: at(4, 10, 20) });
  const { items, counts } = buildCommentFeed({ comments: [r2, root, r1], events: [], filter: 'all', isUnread: (x) => x.id === 'r2', meName: null, now: NOW });
  const comments = items.filter((i) => i.kind === 'comment');
  assert.equal(comments.length, 1);
  const item = comments[0];
  assert.equal(item.kind === 'comment' && item.comment.id, 'root');
  assert.ok(item.kind === 'comment');
  assert.deepEqual(item.replies.map((r) => r.id), ['r1', 'r2'], '답글은 시간순');
  assert.equal(item.replySummary?.count, 2);
  assert.deepEqual(item.replySummary?.participants.map((p) => p.name), ['김어진', '박정인']);
  assert.equal(item.replySummary?.lastAt, r2.createdAt);
  assert.equal(item.replySummary?.newCount, 1);
  assert.deepEqual(item.anchorIds, ['root', 'r1', 'r2']);
  assert.equal(counts.roots, 1);
  assert.equal(counts.unread, 1, '답글에만 새 글이 있어도 원댓글이 안 읽음 탭에 남는다');
});

test('답글의 답글(옛 기록)도 맨 위 원댓글로, 원댓글이 지워진 답글은 스스로 원댓글', () => {
  const root = c({ id: 'root' });
  const r1 = c({ id: 'r1', parentCommentId: 'root' });
  const rr = c({ id: 'rr', parentCommentId: 'r1' });
  const orphan = c({ id: 'orphan', parentCommentId: 'gone' });
  const { items } = buildCommentFeed({ comments: [root, r1, rr, orphan], events: [], filter: 'all', isUnread: none, meName: null, now: NOW });
  const comments = items.flatMap((i) => (i.kind === 'comment' ? [i] : []));
  assert.deepEqual(comments.map((i) => i.comment.id), ['root', 'orphan']);
  assert.deepEqual(comments[0].replies.map((r) => r.id), ['r1', 'rr']);
});

test('같은 리테이크의 댓글·활동은 카드 하나 — 자리는 첫 활동(등록) 시각', () => {
  const before = c({ id: 'before', createdAt: at(4, 10, 0) });
  const add = ev({ id: 'add', revisionId: 'rev1', at: at(4, 10, 24), actionType: 'revision_add' });
  const work = ev({ id: 'work', revisionId: 'rev1', at: at(4, 10, 26), actionType: 'revision_in_progress' });
  const rc1 = c({ id: 'rc1', revisionId: 'rev1', createdAt: at(4, 10, 27) });
  const middle = c({ id: 'middle', createdAt: at(4, 10, 30) });
  const rc2 = c({ id: 'rc2', revisionId: 'rev1', createdAt: at(4, 10, 40) });
  const stage = ev({ id: 'stage', at: at(4, 11, 0) });
  const { items, counts } = buildCommentFeed({ comments: [rc2, middle, rc1, before], events: [stage, work, add], filter: 'all', isUnread: none, meName: null, now: NOW });
  assert.deepEqual(items.map((i) => i.key), ['d:2026-11-4', 'c:before', 'r:rev1', 'c:middle', 'e:stage']);
  const card = items[2];
  assert.ok(card.kind === 'retake');
  assert.deepEqual(card.events.map((e) => e.id), ['add', 'work']);
  assert.deepEqual(card.comments.map((x) => x.id), ['rc1', 'rc2']);
  assert.equal(card.commentSummary?.count, 2);
  assert.equal(card.at, add.at);
  assert.equal(counts.retakes, 1);
  assert.equal(counts.roots, 2);
});

test('5분 안 같은 사람은 묶음, 카드·활동·날짜 줄이 끼면 끊김', () => {
  const a = c({ id: 'a', createdAt: at(4, 9, 5) });
  const b = c({ id: 'b', createdAt: at(4, 9, 7) });
  const late = c({ id: 'late', createdAt: at(4, 9, 20) });
  const other = c({ id: 'other', userId: 'u-park', userName: '박정인', createdAt: at(4, 9, 21) });
  const stage = ev({ id: 'stage', at: at(4, 9, 22) });
  const after = c({ id: 'after', userId: 'u-park', userName: '박정인', createdAt: at(4, 9, 23) });
  const { items } = buildCommentFeed({ comments: [a, b, late, other, after], events: [stage], filter: 'all', isUnread: none, meName: null, now: NOW });
  const grouped = Object.fromEntries(items.flatMap((i) => (i.kind === 'comment' ? [[i.comment.id, i.grouped]] : [])));
  assert.deepEqual(grouped, { a: false, b: true, late: false, other: false, after: false });
  assert.equal(isGroupedWithPrevious(a, b), true);
  assert.equal(isGroupedWithPrevious(a, late), false);
  assert.deepEqual(groupedFlags([a, b, late]), [false, true, false]);
});

test('날짜 줄 — 날짜가 바뀌는 곳에만, 전체 탭에서만. 오늘 / 11월 3일 화요일 / 다른 해', () => {
  const yesterday = c({ id: 'y', createdAt: at(3, 18, 0) });
  const today = c({ id: 't', createdAt: at(4, 9, 0) });
  const all = buildCommentFeed({ comments: [today, yesterday], events: [], filter: 'all', isUnread: none, meName: null, now: NOW }).items;
  assert.deepEqual(all.filter((i) => i.kind === 'day').map((i) => i.kind === 'day' && i.label), ['11월 3일 화요일', '오늘']);
  const unread = buildCommentFeed({ comments: [today, yesterday], events: [], filter: 'unread', isUnread: () => true, meName: null, now: NOW }).items;
  assert.equal(unread.some((i) => i.kind === 'day'), false);
  assert.equal(commentDayLabel(new Date(2025, 11, 31, 9).toISOString(), NOW), '2025년 12월 31일 수요일');
  assert.equal(commentDayLabel('잘못된 값', NOW), '');
});

test('탭 — 안 읽음·리테이크·@나 와 숫자', () => {
  const mine = c({ id: 'mine', mentions: ['배한솔'] });
  const plain = c({ id: 'plain' });
  const root = c({ id: 'root' });
  const replyMe = c({ id: 'replyMe', parentCommentId: 'root', mentions: ['배한솔'] });
  const rc = c({ id: 'rc', revisionId: 'rev1' });
  const stage = ev({ id: 'stage' });
  const args = { comments: [mine, plain, root, replyMe, rc], events: [stage], isUnread: (x: FeedCommentLike) => x.id === 'plain' || x.id === 'rc', meName: '배한솔', now: NOW };
  const keys = (filter: 'all' | 'unread' | 'retake' | 'mine') => buildCommentFeed({ ...args, filter }).items.filter((i) => i.kind !== 'day').map((i) => i.key);
  assert.deepEqual(keys('unread'), ['c:plain', 'r:rev1']);
  assert.deepEqual(keys('retake'), ['r:rev1']);
  assert.deepEqual(keys('mine'), ['c:mine', 'c:root'], '답글에서 나를 불러도 그 원댓글');
  assert.equal(keys('all').includes('e:stage'), true);
  assert.deepEqual(buildCommentFeed({ ...args, filter: 'all' }).counts, { roots: 3, retakes: 1, unread: 2, mine: 2 });
});

test('리테이크 활동 문장·단계 — 원래 종류가 없으면 예전 tone 으로', () => {
  assert.equal(retakeActivitySentence({ actionType: 'revision_add' }), '리테이크를 등록했어요');
  assert.equal(retakeActivitySentence({ actionType: 'revision_in_progress' }), '작업을 시작했어요');
  assert.equal(retakeActivitySentence({ actionType: 'revision_assignee_done' }), '담당 작업을 끝냈어요');
  assert.equal(retakeActivitySentence({ actionType: 'revision_final_resolve' }), '해결로 표시했어요');
  assert.equal(retakeActivitySentence({ actionType: 'revision_reassign' }), '담당자를 바꿨어요');
  assert.equal(retakeActivityPhase({ tone: 'revision_resolve' }), 'resolved');
  assert.equal(retakeActivityPhase({ actionType: 'revision_update' }), 'other');
});

test('리테이크 카드 상태와 스레드 창 버튼 — 지금 권한과 같게', () => {
  assert.equal(retakeCardStatus({ status: 'in_progress' }, false), 'in_progress');
  assert.equal(retakeCardStatus({ status: 'assignee_done', finalResolvedAt: '2026-11-04' }, false), 'resolved');
  assert.equal(retakeCardStatus(null, true), 'deleted');
  assert.equal(retakeCardStatus(null, false), 'unknown');
  assert.deepEqual(availableRetakeActions({ status: 'open', myState: 'pending', canFinal: false }), ['start']);
  assert.deepEqual(availableRetakeActions({ status: 'in_progress', myState: 'in_progress', canFinal: false }), ['complete']);
  assert.deepEqual(availableRetakeActions({ status: 'assignee_done', myState: null, canFinal: true }), ['resolve']);
  assert.deepEqual(availableRetakeActions({ status: 'assignee_done', myState: 'done', canFinal: true }), ['resolve', 'reopen_mine']);
  assert.deepEqual(availableRetakeActions({ status: 'resolved', myState: 'done', canFinal: true }), ['reopen']);
  assert.deepEqual(availableRetakeActions({ status: 'resolved', myState: 'done', canFinal: false }), [], '해결 뒤에는 요청자만 다시 연다');
  assert.deepEqual(availableRetakeActions({ status: 'in_progress', myState: null, canFinal: false }), [], '권한이 없으면 버튼 없음');
});

test('아바타 — 같은 사람 같은 색(CSS 변수), 이니셜은 이름 뒤 두 글자', () => {
  assert.equal(avatarColor('u-1'), avatarColor('u-1'));
  assert.match(avatarColor('u-1'), /^var\(--avatar-[1-8]\)$/);
  const slots = new Set(Array.from({ length: 40 }, (_, i) => avatarSlot(`user-${i}`)));
  assert.ok(slots.size >= 6, '여러 칸에 고르게');
  assert.equal(avatarInitials('배한솔'), '한솔');
  assert.equal(avatarInitials('이도'), '이도');
  assert.equal(avatarInitials('  '), '?');
});

test('스레드 창 글 — 본문 요약과 같은 묶음(답글의 답글·리테이크 댓글에 단 옛 답글 포함)', async () => {
  const { threadMembers } = await import('../src/utils/commentFeedModel.ts');
  const root = c({ id: 'root' });
  const r1 = c({ id: 'r1', parentCommentId: 'root' });
  const rr = c({ id: 'rr', parentCommentId: 'r1' });
  const rc = c({ id: 'rc', revisionId: 'rev1' });
  const legacy = c({ id: 'legacy', parentCommentId: 'rc' });
  const other = c({ id: 'other' });
  const all = [rr, root, r1, rc, legacy, other];
  assert.deepEqual(threadMembers(all, { rootId: 'root' }).map((x) => x.id), ['r1', 'rr']);
  assert.deepEqual(threadMembers(all, { revisionId: 'rev1' }).map((x) => x.id), ['rc', 'legacy']);
  const feed = buildCommentFeed({ comments: all, events: [], filter: 'all', isUnread: none, meName: null, now: NOW });
  const card = feed.items.find((i) => i.kind === 'retake');
  assert.equal(card && card.kind === 'retake' && card.commentSummary?.count, 2, '카드 숫자와 스레드 창 글 수가 같다');
});
