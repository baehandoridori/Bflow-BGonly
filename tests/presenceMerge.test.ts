// tests/presenceMerge.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePresenceState } from '../electron/presence/presenceMerge.ts';

test('여러 사용자의 편집 씬을 sceneUuid별로 병합', () => {
  const state = {
    u1: [{ userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' }],
    u2: [{ userId: 'u2', username: '김민수', editingSceneUuids: ['s1', 's2'], updatedAt: '' }],
  };
  const snap = mergePresenceState(state);
  assert.deepEqual(snap['s1'].map((u) => u.userId).sort(), ['u1', 'u2']);
  assert.deepEqual(snap['s2'].map((u) => u.username), ['김민수']);
});
test('같은 사용자 중복 페이로드는 userId로 dedupe', () => {
  const state = { u1: [
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' },
  ] };
  assert.equal(mergePresenceState(state)['s1'].length, 1);
});
test('편집 씬 없으면 빈 스냅샷', () => {
  assert.deepEqual(mergePresenceState({ u1: [{ userId: 'u1', username: 'x', editingSceneUuids: [], updatedAt: '' }] }), {});
});
