// tests/editingPresenceSelectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectEditorsForScenes, formatEditorLabels, isWarnPresence,
  editingBeamClassName, editingBeamRowClassName,
} from '../src/utils/editingPresence.ts';

const snap = {
  s1: [{ userId: 'u1', username: '배한솔' }, { userId: 'u2', username: '김민수' }],
  s2: [{ userId: 'u2', username: '김민수' }],
};

test('여러 sceneUuid 유니온 + 자기 자신 제외 + userId dedupe', () => {
  assert.deepEqual(selectEditorsForScenes(snap, ['s1', 's2'], 'u1').map((u) => u.userId), ['u2']);
});
test('자기 없으면 전원', () => {
  assert.equal(selectEditorsForScenes(snap, ['s1'], null).length, 2);
});
test('라벨 포맷: 최대 2 + overflow', () => {
  const editors = [{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }, { userId: 'c', username: 'C' }];
  const r = formatEditorLabels(editors, 2);
  assert.deepEqual(r.shown.map((u) => u.username), ['A', 'B']);
  assert.equal(r.overflow, 1);
});
test('경고 판정: 2명 이상', () => {
  assert.equal(isWarnPresence([{ userId: 'a', username: 'A' }]), false);
  assert.equal(isWarnPresence([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), true);
});
test('beam 클래스: 0명 빈 문자열, 1명 base, 2명 warn', () => {
  assert.equal(editingBeamClassName([]), '');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }]), 'editing-beam');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam editing-beam--warn');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }]), 'editing-beam-row');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam-row editing-beam-row--warn');
});
