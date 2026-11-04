import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommentThreadKey,
  commentThreadIdOf,
  resolveThreadPreference,
  sanitizeThreadPreferences,
  setThreadPreference,
  threadPreferenceFileName,
} from '../src/utils/commentThreadFollow.ts';
import { capNotifications } from '../src/utils/notificationCap.ts';

test('스레드 id — 리테이크 댓글은 re:, 답글은 원댓글, 원댓글은 자기 id', () => {
  assert.equal(commentThreadIdOf({ commentId: 'c1', revisionId: 'rev', parentCommentId: 'p' }), 're:rev');
  assert.equal(commentThreadIdOf({ commentId: 'c2', parentCommentId: 'root' }), 'root');
  assert.equal(commentThreadIdOf({ id: 'root' }), 'root');
  assert.equal(buildCommentThreadKey('EP05:A:a001', 'root'), 'EP05:A:a001#root');
});

test('설정 찾기 — 스레드가 씬보다 먼저, 씬 키가 달라도 같은 스레드면 찾는다', () => {
  const prefs = { 'EP05:A:a001#root': 'mute', 'merged-x#other': 'follow', 'EP05:A:a001': 'follow' } as const;
  assert.equal(resolveThreadPreference(prefs, { threadId: 'root', sceneThreadKey: 'EP05:A:a001' }), 'mute');
  assert.equal(resolveThreadPreference(prefs, { threadId: 'other', sceneThreadKey: 'EP05:A:a001' }), 'follow', '다른 씬 키로 저장된 같은 스레드');
  assert.equal(resolveThreadPreference(prefs, { threadId: 'new', sceneThreadKey: 'EP05:A:a001' }), 'follow', '씬 전체');
  assert.equal(resolveThreadPreference(prefs, { threadId: 'new', sceneThreadKey: 'EP06:B:b001' }), null);
  assert.equal(resolveThreadPreference({}, { threadId: null, sceneThreadKey: null }), null);
});

test('저장값 정리·바꾸기 — 모양이 어긋난 것은 버리고, 넘치면 가장 오래 안 건드린 것부터', () => {
  assert.deepEqual(sanitizeThreadPreferences({ a: 'follow', b: 'nope', '': 'mute', c: 'mute' }), { a: 'follow', c: 'mute' });
  assert.deepEqual(sanitizeThreadPreferences(['x']), {});
  let prefs = setThreadPreference({}, 'a', 'follow', 2);
  prefs = setThreadPreference(prefs, 'b', 'mute', 2);
  prefs = setThreadPreference(prefs, 'a', 'mute', 2);
  prefs = setThreadPreference(prefs, 'c', 'follow', 2);
  assert.deepEqual(prefs, { a: 'mute', c: 'follow' });
  assert.deepEqual(setThreadPreference(prefs, 'a', null), { c: 'follow' });
  assert.equal(threadPreferenceFileName('u/1'), 'comment-thread-follow.u_1.json');
});

test('알림 상한 — 읽은 것 → 단계 변경 → 오래된 댓글 순으로 버리고, 안 읽은 멘션·배정·피드백은 지킨다', () => {
  const n = (id: string, type: string, isRead = false) => ({ id, type, isRead });
  const list = [
    n('m1', 'mention'), n('c1', 'comment'), n('s1', 'scene_change'), n('r1', 'mention', true),
    n('f1', 'acting_feedback'), n('c2', 'comment'), n('a1', 'scene_assignment'), n('s2', 'scene_change'),
  ];
  assert.deepEqual(capNotifications(list, 7).map((x) => x.id), ['m1', 'c1', 's1', 'f1', 'c2', 'a1', 's2'], '읽은 것부터');
  assert.deepEqual(capNotifications(list, 5).map((x) => x.id), ['m1', 'c1', 'f1', 'c2', 'a1'], '그다음 단계 변경(오래된 것부터)');
  assert.deepEqual(capNotifications(list, 4).map((x) => x.id), ['m1', 'c1', 'f1', 'a1'], '그다음 오래된 댓글');
  assert.deepEqual(capNotifications(list, 2).map((x) => x.id), ['m1', 'f1'], '지키는 것끼리는 오래된 것부터');
  assert.equal(capNotifications(list, 50).length, 8);
});

test('스레드 설정은 스레드마다 하나 — 다른 씬 키(통합 상세 등)로 저장된 같은 스레드도 함께 바꾸고 지운다', () => {
  let prefs = setThreadPreference({}, 'EP05:A:a001#root-1', 'mute');
  prefs = setThreadPreference(prefs, 'merged-EP05:A:a001', 'mute');
  // 통합 상세에서 같은 스레드를 '기본으로'
  prefs = setThreadPreference(prefs, 'merged-EP05:A:a001#root-1', null);
  assert.deepEqual(prefs, { 'merged-EP05:A:a001': 'mute' }, '씬 전체 키는 그대로, 같은 스레드 키는 모두 지운다');
  prefs = setThreadPreference(prefs, 'EP05:A:a001#root-1', 'mute');
  prefs = setThreadPreference(prefs, 'merged-EP05:A:a001#root-1', 'follow');
  assert.deepEqual(Object.entries(prefs), [['merged-EP05:A:a001', 'mute'], ['merged-EP05:A:a001#root-1', 'follow']]);
});
