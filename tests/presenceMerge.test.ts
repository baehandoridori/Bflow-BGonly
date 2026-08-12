// tests/presenceMerge.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePresenceState } from '../electron/presence/presenceMerge.ts';

test('여러 사용자의 편집 씬을 scene kind 로 병합', () => {
  const state = {
    u1: [{ userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], editing: { scene: ['s1'] }, updatedAt: '' }],
    u2: [{ userId: 'u2', username: '김민수', editingSceneUuids: ['s1', 's2'], editing: { scene: ['s1', 's2'] }, updatedAt: '' }],
  };
  const snap = mergePresenceState(state);
  assert.deepEqual(snap['scene']['s1'].map((u) => u.userId).sort(), ['u1', 'u2']);
  assert.deepEqual(snap['scene']['s2'].map((u) => u.username), ['김민수']);
});
test('같은 사용자 중복 페이로드는 userId로 dedupe', () => {
  const state = { u1: [
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], editing: { scene: ['s1'] }, updatedAt: '' },
    { userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], editing: { scene: ['s1'] }, updatedAt: '' },
  ] };
  assert.equal(mergePresenceState(state)['scene']['s1'].length, 1);
});
test('편집 대상 없으면 빈 번들 (빈 kind 는 키를 만들지 않는다)', () => {
  assert.deepEqual(
    mergePresenceState({ u1: [{ userId: 'u1', username: 'x', editingSceneUuids: [], editing: { scene: [], costume: [] }, updatedAt: '' }] }),
    {},
  );
});
test('피드백 54: 복장 uuid 는 costume kind 로 병합 — 씬과 네임스페이스 분리', () => {
  const state = {
    u1: [{ userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], editing: { scene: ['s1'], costume: ['c1'] }, updatedAt: '' }],
    u2: [{ userId: 'u2', username: '김민수', editingSceneUuids: [], editing: { scene: [], costume: ['c1'] }, updatedAt: '' }],
  };
  const snap = mergePresenceState(state);
  assert.deepEqual(snap['costume']['c1'].map((u) => u.userId).sort(), ['u1', 'u2']);
  assert.equal(snap['scene']['c1'], undefined);
});
test('피드백 54: 구버전 payload(editing 없음)는 editingSceneUuids 를 scene 으로 정규화', () => {
  const snap = mergePresenceState({
    u1: [{ userId: 'u1', username: '배한솔', editingSceneUuids: ['s1'], updatedAt: '' }],
  });
  assert.deepEqual(snap['scene']['s1'].map((u) => u.userId), ['u1']);
  assert.equal(snap['costume'], undefined);
});
