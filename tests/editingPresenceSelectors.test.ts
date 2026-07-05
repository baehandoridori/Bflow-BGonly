// tests/editingPresenceSelectors.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectEditorsForScenes, formatEditorLabels, isWarnPresence, hasSceneCollision,
  editorDisplayName, editingBeamClass, editingBeamRowClass,
  editingBeamClassName, editingBeamRowClassName,
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
test('beam 클래스(단일 씬): 0명 빈 문자열, 1명 base, 2명 warn', () => {
  assert.equal(editingBeamClassName([]), '');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }]), 'editing-beam');
  assert.equal(editingBeamClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam editing-beam--warn');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }]), 'editing-beam-row');
  assert.equal(editingBeamRowClassName([{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }]), 'editing-beam-row editing-beam-row--warn');
});

// ── 통합(유니온) 거짓충돌 방지 ──
const unionSnap = {
  bg: [{ userId: 'me', username: '나' }],                                             // 내가 BG 만 열어둠
  act: [{ userId: 'other', username: '김민수' }],                                     // 팀원이 ACT 만 열어둠
  both: [{ userId: 'me', username: '나' }, { userId: 'other', username: '김민수' }],  // 한 파일에 둘
};
test('hasSceneCollision: 서로 다른 파일 1명씩은 충돌 아님, 한 파일 2명+면 충돌', () => {
  assert.equal(hasSceneCollision(unionSnap, ['bg', 'act']), false); // 유니온 2명이지만 파일별 1명 → 거짓충돌 아님
  assert.equal(hasSceneCollision(unionSnap, ['both']), true);       // 한 파일에 2명 → 실제 충돌
  assert.equal(hasSceneCollision(unionSnap, ['bg']), false);
  assert.equal(hasSceneCollision(unionSnap, ['both', 'act']), true);
  assert.equal(hasSceneCollision(unionSnap, [null, undefined]), false);
  assert.equal(hasSceneCollision(unionSnap, ['nope']), false);
});
test('editingBeamClass/Row: 편집자 유무·경고 독립 신호', () => {
  assert.equal(editingBeamClass(false, false), '');
  assert.equal(editingBeamClass(false, true), '');   // 편집자 없으면 경고여도 빈 문자열
  assert.equal(editingBeamClass(true, false), 'editing-beam');
  assert.equal(editingBeamClass(true, true), 'editing-beam editing-beam--warn');
  assert.equal(editingBeamRowClass(false, true), '');
  assert.equal(editingBeamRowClass(true, false), 'editing-beam-row');
  assert.equal(editingBeamRowClass(true, true), 'editing-beam-row editing-beam-row--warn');
});
test('통합 카드 시나리오: 나 BG + 팀원 ACT → 글로우는 있지만 경고 아님', () => {
  const union = selectEditorsForScenes(unionSnap, ['bg', 'act'], 'me');
  assert.equal(union.length, 2); // 유니온 이름표는 둘 다
  const warn = hasSceneCollision(unionSnap, ['bg', 'act']);
  assert.equal(editingBeamClass(union.length > 0, warn), 'editing-beam'); // 경고 아님
});
