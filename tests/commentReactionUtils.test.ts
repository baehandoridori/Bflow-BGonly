import test from 'node:test';
import assert from 'node:assert/strict';

import { groupReactionsByEmoji, formatReactionTooltip } from '../src/utils/commentReactionUtils.ts';

// 테스트에서 CommentReaction 의 최소 형태만 사용 — 타입은 string field 만 있으면 OK
type R = { id: string; commentId: string; userId: string; userName: string; emoji: string; createdAt: string };

function r(id: string, emoji: string, userId: string, userName: string): R {
  return { id, commentId: 'c1', userId, userName, emoji, createdAt: '2026-05-15T10:00:00Z' };
}

test('groupReactionsByEmoji: 같은 이모지 그룹화 + 카운트', () => {
  const reactions = [
    r('1', '✅', 'u1', '한솔'),
    r('2', '✅', 'u2', '박정인'),
    r('3', '👀', 'u1', '한솔'),
  ];
  const groups = groupReactionsByEmoji(reactions, 'u1');
  assert.equal(groups.length, 2);
  const checkGroup = groups.find((g) => g.emoji === '✅')!;
  assert.equal(checkGroup.count, 2);
  assert.deepEqual(checkGroup.userNames, ['한솔', '박정인']);
  assert.equal(checkGroup.mine, true);
  const eyeGroup = groups.find((g) => g.emoji === '👀')!;
  assert.equal(eyeGroup.count, 1);
  assert.equal(eyeGroup.mine, true);
});

test('groupReactionsByEmoji: 본인 user id 없으면 mine=false', () => {
  const reactions = [r('1', '✅', 'u1', '한솔')];
  const groups = groupReactionsByEmoji(reactions, 'u2');
  assert.equal(groups[0].mine, false);
});

test('groupReactionsByEmoji: 정렬은 첫 등장 순서', () => {
  const reactions = [
    r('1', '🎉', 'u1', '한솔'),
    r('2', '✅', 'u2', '박정인'),
    r('3', '🎉', 'u3', '김단비'),
  ];
  const groups = groupReactionsByEmoji(reactions, 'u1');
  assert.deepEqual(groups.map((g) => g.emoji), ['🎉', '✅']);
});

test('groupReactionsByEmoji: 빈 입력', () => {
  assert.deepEqual(groupReactionsByEmoji([], 'u1'), []);
});

test('groupReactionsByEmoji: 동일 사용자가 같은 이모지 중복 입력 방어', () => {
  // DB UNIQUE 가 막지만, 캐시 동기화 중 일시적으로 중복이 들어올 수 있음
  const reactions = [
    r('1', '✅', 'u1', '한솔'),
    r('2', '✅', 'u1', '한솔'),
  ];
  const groups = groupReactionsByEmoji(reactions, 'u1');
  assert.equal(groups[0].count, 1);
});

test('formatReactionTooltip: 본인 포함 시 "나" 강조', () => {
  const group = { emoji: '✅', count: 2, userIds: ['u1', 'u2'], userNames: ['한솔', '박정인'], mine: true };
  const tip = formatReactionTooltip(group, 'u1');
  assert.match(tip, /나/);
  assert.match(tip, /박정인/);
  assert.match(tip, /2명/);
});

test('formatReactionTooltip: 5명 초과 시 외 N명', () => {
  const ids = ['u1','u2','u3','u4','u5','u6','u7'];
  const names = ['A','B','C','D','E','F','G'];
  const group = { emoji: '🔥', count: 7, userIds: ids, userNames: names, mine: false };
  const tip = formatReactionTooltip(group, 'me');
  assert.match(tip, /외 2명/);
  assert.match(tip, /7명/);
});
