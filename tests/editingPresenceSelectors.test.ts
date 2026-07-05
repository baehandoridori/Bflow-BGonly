// tests/editingPresenceSelectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectEditorsForScenes, formatEditorLabels, isWarnPresence,
  editorDisplayName, editingBeamClassName, editingBeamRowClassName,
} from '../src/utils/editingPresence.ts';

const snap = {
  s1: [{ userId: 'u1', username: '배한솔' }, { userId: 'u2', username: '김민수' }],
  s2: [{ userId: 'u2', username: '김민수' }],
};

test('여러 sceneUuid 유니온 + 자기 자신 포함 + userId dedupe', () => {
  // 자기(u1) 는 제외되지 않고 포함되며 맨 앞에 온다.
  assert.deepEqual(selectEditorsForScenes(snap, ['s1', 's2'], 'u1').map((u) => u.userId), ['u1', 'u2']);
});
test('자기 자신은 isSelf=true 로 태깅되고 맨 앞', () => {
  const editors = selectEditorsForScenes(snap, ['s1'], 'u2');
  assert.equal(editors[0].userId, 'u2');
  assert.equal(editors[0].isSelf, true);
  assert.equal(editors[1].userId, 'u1');
  assert.equal(editors[1].isSelf, false);
});
test('자기 혼자 편집: 1명 포함 + 경고 아님', () => {
  const editors = selectEditorsForScenes(snap, ['s2'], 'u2');
  assert.equal(editors.length, 1);
  assert.equal(editors[0].isSelf, true);
  assert.equal(isWarnPresence(editors), false);
});
test('자기+타인 편집: 경고 톤', () => {
  const editors = selectEditorsForScenes(snap, ['s1'], 'u1');
  assert.equal(editors.length, 2);
  assert.equal(isWarnPresence(editors), true);
});
test('selfUserId 없으면 아무도 isSelf 아님', () => {
  const editors = selectEditorsForScenes(snap, ['s1'], null);
  assert.equal(editors.length, 2);
  assert.equal(editors.every((u) => u.isSelf === false), true);
});
test('editorDisplayName: 자기는 "나", 타인은 이름', () => {
  assert.equal(editorDisplayName({ userId: 'u1', username: '배한솔', isSelf: true }), '나');
  assert.equal(editorDisplayName({ userId: 'u2', username: '김민수', isSelf: false }), '김민수');
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
