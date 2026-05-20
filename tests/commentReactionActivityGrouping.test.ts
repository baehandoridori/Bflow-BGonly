import test from 'node:test';
import assert from 'node:assert/strict';
import { groupActivities } from '../src/components/widgets/activity/utils.ts';
import type { Activity } from '../src/types/index.ts';

const base = (overrides: Partial<Activity>): Activity => ({
  id: 'a1',
  userId: 'u1',
  userName: '한솔',
  actionType: 'comment_reaction',
  actionGroup: 'memo',
  sceneId: 'scene-1',
  sceneLabel: 'EP01 #01',
  episodeNumber: 1,
  department: 'bg',
  detail: { emoji: '❤️', commentId: 'c1' },
  createdAt: '2026-05-21T00:00:00.000Z',
  ...overrides,
});

test('comment_reaction: 같은 사용자/씬/5분 내 → 1 group', () => {
  const acts = [
    base({ id: 'a1', detail: { emoji: '❤️', commentId: 'c1' }, createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', detail: { emoji: '🔥', commentId: 'c1' }, createdAt: '2026-05-21T00:01:00Z' }),
    base({ id: 'a3', detail: { emoji: '👏', commentId: 'c1' }, createdAt: '2026-05-21T00:02:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'group');
});

test('comment_reaction: 6분 이상 차이 → 2 groups', () => {
  const acts = [
    base({ id: 'a1', createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', createdAt: '2026-05-21T00:06:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
  // 정렬은 시간 역순 — 최신이 먼저 (a2)
  assert.equal(r[0].type, 'item');
  assert.equal(r[1].type, 'item');
});

test('comment_reaction: 다른 사용자 → 별개 항목', () => {
  const acts = [
    base({ id: 'a1', userId: 'u1', userName: '한솔', createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', userId: 'u2', userName: 'A', createdAt: '2026-05-21T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('comment_reaction: 다른 씬 → 별개 항목 (단일-씬 액션이므로 sceneId 일치 필요)', () => {
  const acts = [
    base({ id: 'a1', sceneId: 'scene-1', createdAt: '2026-05-21T00:00:00Z' }),
    base({ id: 'a2', sceneId: 'scene-2', createdAt: '2026-05-21T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('comment_reaction: 같은 씬·같은 사용자에 1개만 있을 때 → 단일 item', () => {
  const acts = [
    base({ id: 'a1', detail: { emoji: '❤️', commentId: 'c1' } }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'item');
});
