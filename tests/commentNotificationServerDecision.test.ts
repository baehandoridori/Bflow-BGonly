import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decideSceneCommentNotification,
  decideSceneCommentNotificationFromServer,
  normalizeSceneCommentFromServerRow,
  normalizeSceneCommentFromUpdatedBroadcast,
  type SceneCommentNotificationDeps,
} from '../src/utils/sceneCommentNotification.ts';
import { parseCommentNotificationRow, validateCommentNotificationReadTarget } from '../src/shared/commentNotification.ts';
import { commentNotificationReadTarget, markServerCommentNotificationsRead, setServerCommentNotificationsAvailable } from '../src/utils/commentNotificationServer.ts';
import { getNotificationIdentity } from '../src/utils/notificationIdentity.ts';

// 서버 알림 줄 → 화면 알림(씬 댓글 B안 PR 6). 실시간 판정과 같은 제목·같은 중복 키·같은 알림 정체성이어야
// 두 길이 같은 댓글에 겹쳐도 한 번만 뜬다. 이 PC 의 설정·팔로우·끄기는 여기서 거른다.
const me = { id: 'u-han', name: '배한솔' };
const scene = { id: 'scene-1', sceneId: 'a001', assignee: '배한솔' };
const deps = (pref: 'follow' | 'mute' | null = null, overrides: Partial<SceneCommentNotificationDeps> = {}): SceneCommentNotificationDeps => ({
  findScene: () => scene,
  sceneLabel: () => 'EP05 a001',
  isCommentByUser: () => false,
  hasUserCommentedOnScene: () => false,
  counterpartAssigneeNames: () => [],
  getRevision: () => null,
  userIdByName: () => null,
  plainText: (t) => t,
  sceneThreadKey: () => 'EP05:A:a001',
  threadPreference: () => pref,
  ...overrides,
});
const on = { autoNotify: true, retakeNotify: true };
const serverRow = (over: Record<string, unknown> = {}, comment: Record<string, unknown> = {}) => parseCommentNotificationRow({
  id: '11111111-2222-4333-8444-555555555555', commentId: 'c1', kind: 'add', reason: 'auto', detail: 'assignee',
  eventAt: '2026-11-05T01:02:03.123456+00:00', readAt: null, revisionNo: null,
  comment: {
    partId: 'p1', sceneId: '3', sceneUuid: 'scene-1', userId: 'u-kim', userName: '김어진', text: '배경 톤 확인 부탁', mentions: [],
    imageCount: 0, parentCommentId: null, revisionId: null, characterId: null, createdAt: '2026-11-05T01:02:03.000+00:00', editedAt: null,
    ...comment,
  },
  ...over,
})!;
const decide = (row: ReturnType<typeof serverRow>, pref: 'follow' | 'mute' | null = null, settings = on) =>
  decideSceneCommentNotificationFromServer(normalizeSceneCommentFromServerRow(row), { reason: row.reason, detail: row.detail, revisionNo: row.revisionNo }, me, deps(pref), settings);

test('자동: 담당·상대 부서·참여자 문구, 끈 스레드는 없음, 팔로우는 팔로우 알림, 설정이 꺼지면 없음', () => {
  assert.equal(decide(serverRow())?.title, '김어진님이 내 씬에 댓글을 남겼습니다 · EP05 a001');
  assert.equal(decide(serverRow())?.quiet, true);
  assert.equal(decide(serverRow({ detail: 'counterpart' }))?.title, '김어진님이 함께 작업 중인 씬에 댓글을 남겼습니다 · EP05 a001');
  assert.equal(decide(serverRow({ detail: 'participant' }))?.title, '김어진님이 내가 댓글 단 씬에 새 댓글을 남겼습니다 · EP05 a001');
  assert.equal(decide(serverRow(), 'mute'), null);
  const follow = decide(serverRow(), 'follow');
  assert.equal(follow?.reason, 'follow');
  assert.equal(follow?.native, false);
  assert.equal(decide(serverRow(), null, { ...on, autoNotify: false }), null);
  assert.equal(decide(serverRow(), 'follow', { ...on, autoNotify: false })?.reason, 'follow', '팔로우는 설정과 무관');
});

test('멘션·답글은 끈 스레드여도 늘, 리테이크는 설정이 꺼지면 팔로우한 것만', () => {
  assert.equal(decide(serverRow({ reason: 'mention', detail: null }), 'mute')?.title, '김어진님이 나를 태그했습니다 · EP05 a001');
  assert.equal(decide(serverRow({ reason: 'reply', detail: null }), 'mute')?.title, '김어진님이 내 댓글에 답글을 남겼습니다 · EP05 a001');
  const retake = serverRow({ reason: 'retake', detail: null, revisionNo: 4 }, { revisionId: 'rev-1' });
  assert.equal(decide(retake)?.title, '김어진님이 re#4 에 댓글을 남겼습니다 · EP05 a001');
  assert.equal(decide(retake)?.metadata.revisionId, 'rev-1');
  assert.equal(decide(retake, null, { ...on, retakeNotify: false }), null);
  assert.equal(decide(retake, 'follow', { ...on, retakeNotify: false })?.title, '김어진님이 팔로우 중인 리테이크에 댓글을 남겼습니다 · EP05 a001');
  assert.equal(decide(serverRow({ reason: 'retake', detail: null }, { revisionId: 'rev-1' }))?.title, '김어진님이 리테이크 에 댓글을 남겼습니다 · EP05 a001');
});

test('실시간 판정과 같은 결과·같은 중복 키·같은 알림 정체성(두 길이 겹쳐도 한 번)', () => {
  const live = decideSceneCommentNotification({
    commentId: 'c1', partId: 'p1', sceneNo: '3', sceneUuid: 'scene-1', userId: 'u-kim', userName: '김어진', text: '배경 톤 확인 부탁',
    mentions: [], parentCommentId: null, revisionId: null, characterId: null, createdAt: '2026-11-05T01:02:03.000Z', kind: 'add',
  }, me, deps(), on);
  const server = decide(serverRow());
  assert.ok(live && server);
  assert.equal(server.dedupeKey, live.dedupeKey);
  assert.equal(server.title, live.title);
  assert.deepEqual(server.metadata, live.metadata);
  assert.equal(getNotificationIdentity({ type: server.type, metadata: server.metadata }), getNotificationIdentity({ type: live.type, metadata: live.metadata }));
});

test('수정 멘션: 서버 시각 표기(+00:00)를 방송 표기(Z)로 맞춰 같은 수정이 한 번만', () => {
  const editedAt = '2026-11-05T01:05:00.456Z';
  const live = decideSceneCommentNotification(normalizeSceneCommentFromUpdatedBroadcast({
    commentId: 'c1', partId: 'p1', sceneId: '3', userId: 'u-kim', userName: '김어진', text: '@배한솔 다시 봐 주세요',
    mentions: ['배한솔'], addedMentions: ['배한솔'], editedAt,
  })!, me, deps(), on);
  const row = serverRow({ kind: 'edit', reason: 'mention', detail: null }, { editedAt: '2026-11-05T01:05:00.456+00:00', text: '@배한솔 다시 봐 주세요', mentions: ['배한솔'] });
  const server = decide(row);
  assert.ok(live && server);
  assert.equal(server.dedupeKey, live.dedupeKey);
  assert.equal(server.metadata.mentionEditAt, editedAt);
  assert.equal(getNotificationIdentity({ type: server.type, metadata: server.metadata }), `scene_comment:c1:edit:${editedAt}`);
  assert.equal(decide(serverRow({ kind: 'edit', reason: 'auto', detail: 'assignee' })), null, '수정 줄은 멘션만');
  // 그 뒤 글만 또 고쳐 댓글의 지금 수정 시각이 바뀌어도, 줄에 저장된 그 수정의 시각을 쓴다(같은 수정 알림이 두 번 뜨지 않게).
  const reEdited = serverRow(
    { kind: 'edit', reason: 'mention', detail: null, editAt: '2026-11-05T01:05:00.456+00:00' },
    { editedAt: '2026-11-05T01:06:00.000+00:00', mentions: ['배한솔'] },
  );
  assert.equal(reEdited.editAt, '2026-11-05T01:05:00.456+00:00');
  assert.equal(decide(reEdited)?.dedupeKey, live.dedupeKey);
});

test('캐릭터 댓글: 멘션 줄만, 누르면 캐릭터로. 작성자 본인 줄은 없음', () => {
  const character = decide(serverRow({ reason: 'mention', detail: null }, { characterId: 'char-1', partId: null, sceneId: null, sceneUuid: null }));
  assert.equal(character?.metadata.characterId, 'char-1');
  assert.equal(character?.title, '김어진님이 나를 태그했습니다');
  assert.equal(decide(serverRow({}, { characterId: 'char-1' })), null);
  assert.equal(decide(serverRow({}, { userId: 'u-han' })), null);
});

test('줄 모양 검사: 이유·종류·시각·id 가 틀리면 버린다', () => {
  assert.ok(serverRow());
  assert.equal(parseCommentNotificationRow({ ...serverRow(), reason: 'follow' }), null);
  assert.equal(parseCommentNotificationRow({ ...serverRow(), detail: 'boss' }), null);
  assert.equal(parseCommentNotificationRow({ ...serverRow(), reason: 'mention', detail: 'assignee' }), null);
  assert.equal(parseCommentNotificationRow({ ...serverRow(), id: 'nope' }), null);
  assert.equal(parseCommentNotificationRow({ ...serverRow(), eventAt: 'yesterday' }), null);
  assert.equal(parseCommentNotificationRow({ ...serverRow(), comment: { ...serverRow().comment, userId: '' } }), null);
  assert.deepEqual(serverRow({}, { mentions: ['a', 3, ''] }).comment.mentions, ['a']);
});

test('서버 읽음 대상: 씬·캐릭터 댓글 알림만, 수정 멘션은 따로, 500개씩 나눠 보낸다, 서버에 줄이 없으면 보내지 않는다', async () => {
  const target = commentNotificationReadTarget([
    { type: 'mention', metadata: { commentId: 'c1' } },
    { type: 'comment', metadata: { commentId: 'c2' } },
    { type: 'mention', metadata: { commentId: 'c1', mentionEditAt: '2026-11-05T01:05:00.456Z' } },
    { type: 'comment_reaction', metadata: { commentId: 'c3', reactionNotificationId: 'r1' } },
    { type: 'revision', metadata: { commentId: 'c4' } },
    { type: 'mention', metadata: { commentId: 'bad id!' } },
  ]);
  assert.deepEqual(target, { addCommentIds: ['c1', 'c2'], editCommentIds: ['c1'] });
  const sent: Array<{ addCommentIds: string[]; editCommentIds: string[] }> = [];
  const send = async (part: { addCommentIds: string[]; editCommentIds: string[] }) => { sent.push(part); };
  setServerCommentNotificationsAvailable(null);
  markServerCommentNotificationsRead({ addCommentIds: Array.from({ length: 700 }, (_, i) => `a${i}`), editCommentIds: ['e1'] }, send);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent.map((part) => [part.addCommentIds.length, part.editCommentIds.length]), [[500, 0], [200, 1]]);
  for (const part of sent) assert.doesNotThrow(() => validateCommentNotificationReadTarget(part));
  setServerCommentNotificationsAvailable(false);
  markServerCommentNotificationsRead(target, send);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sent.length, 2);
  setServerCommentNotificationsAvailable(null);
});
