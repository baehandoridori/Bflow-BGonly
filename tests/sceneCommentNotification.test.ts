import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNotificationDedupe,
  decideSceneCommentNotification,
  type NormalizedSceneComment,
  type SceneCommentNotificationDeps,
} from '../src/utils/sceneCommentNotification.ts';

const ME = { id: 'u-me', name: '배한솔' };

function comment(extra: Partial<NormalizedSceneComment> = {}): NormalizedSceneComment {
  return {
    commentId: 'c1', partId: 'p-bg', sceneNo: '1', sceneUuid: 's-1',
    userId: 'u-2', userName: '원동우', text: '초기 톤 확인 부탁', mentions: [],
    parentCommentId: null, revisionId: null, characterId: null, createdAt: '2026-11-04T01:00:00Z',
    ...extra,
  };
}

function deps(extra: Partial<SceneCommentNotificationDeps> = {}): SceneCommentNotificationDeps {
  return {
    findScene: () => ({ id: 's-1', sceneId: 'a001', assignee: '' }),
    sceneLabel: () => 'EP05 a001',
    isCommentByUser: () => false,
    hasUserCommentedOnScene: () => false,
    counterpartAssigneeNames: () => [],
    getRevision: () => null,
    userIdByName: (name) => (name === ME.name ? ME.id : null),
    plainText: (t) => t,
    ...extra,
  };
}

const ON = { autoNotify: true, retakeNotify: true };

test('작성자 본인 댓글은 알리지 않는다', () => {
  assert.equal(decideSceneCommentNotification(comment({ userId: ME.id, mentions: [ME.name] }), ME, deps(), ON), null);
});

test('직접 부른 @이름 → 강한 멘션, 제목 뒤에 위치', () => {
  const d = decideSceneCommentNotification(comment({ mentions: [ME.name] }), ME, deps(), ON);
  assert.equal(d?.type, 'mention');
  assert.equal(d?.reason, 'mention');
  assert.equal(d?.quiet, false);
  assert.equal(d?.title, '원동우님이 나를 태그했습니다 · EP05 a001');
  assert.equal(d?.dedupeKey, 'c1:mention');
});

test('내 댓글에 달린 답글 → 멘션 종류(강함)지만 이유는 답글, mentions 배열과 무관', () => {
  const d = decideSceneCommentNotification(comment({ parentCommentId: 'root' }), ME, deps({ isCommentByUser: (id, uid) => id === 'root' && uid === ME.id }), ON);
  assert.equal(d?.type, 'mention');
  assert.equal(d?.reason, 'reply');
  assert.match(d!.title, /내 댓글에 답글을 남겼습니다/);
});

test('담당 씬·상대 부서·스레드 참여자 → 조용한 자동 알림, 설정을 끄면 없음', () => {
  const assignee = deps({ findScene: () => ({ id: 's-1', sceneId: 'a001', assignee: '이혜민, 배한솔' }) });
  const d = decideSceneCommentNotification(comment(), ME, assignee, ON);
  assert.equal(d?.type, 'comment');
  assert.equal(d?.reason, 'auto');
  assert.equal(d?.quiet, true);
  assert.equal(decideSceneCommentNotification(comment(), ME, assignee, { ...ON, autoNotify: false }), null);
  const counterpart = decideSceneCommentNotification(comment(), ME, deps({ counterpartAssigneeNames: () => [ME.name] }), ON);
  assert.match(counterpart!.title, /함께 작업 중인 씬/);
  const participant = decideSceneCommentNotification(comment(), ME, deps({ hasUserCommentedOnScene: () => true }), ON);
  assert.match(participant!.title, /내가 댓글 단 씬/);
  assert.equal(decideSceneCommentNotification(comment(), ME, deps(), ON), null, '아무 관계 없으면 없음');
});

test('자동 알림 설정을 꺼도 직접 멘션·답글은 온다', () => {
  const off = { autoNotify: false, retakeNotify: false };
  assert.equal(decideSceneCommentNotification(comment({ mentions: [ME.name] }), ME, deps(), off)?.reason, 'mention');
  assert.equal(decideSceneCommentNotification(comment({ parentCommentId: 'r' }), ME, deps({ isCommentByUser: () => true }), off)?.reason, 'reply');
});

test('리테이크 댓글 → 요청자·담당자·알림 대상에게 강한 알림(re#N), 일반 자동 알림과 섞지 않음', () => {
  const rev = { id: 'rev-1', revisionNo: 3, requesterId: ME.id, assigneeIds: ['u-9'], notifyUserIds: [] };
  const d = decideSceneCommentNotification(comment({ revisionId: 'rev-1' }), ME, deps({ getRevision: () => rev }), ON);
  assert.equal(d?.type, 'mention');
  assert.equal(d?.reason, 'retake');
  assert.equal(d?.title, '원동우님이 re#3 에 댓글을 남겼습니다 · EP05 a001');
  assert.equal(d?.metadata.revisionId, 'rev-1');
  const notTarget = decideSceneCommentNotification(comment({ revisionId: 'rev-1' }), ME, deps({
    getRevision: () => ({ ...rev, requesterId: 'u-8' }),
    findScene: () => ({ id: 's-1', sceneId: 'a001', assignee: ME.name }),
  }), ON);
  assert.equal(notTarget, null, '리테이크 대상이 아니면 씬 담당이어도 없음');
  assert.equal(decideSceneCommentNotification(comment({ revisionId: 'rev-1' }), ME, deps({ getRevision: () => rev }), { ...ON, retakeNotify: false }), null);
  assert.equal(decideSceneCommentNotification(comment({ revisionId: 'rev-1', mentions: [ME.name] }), ME, deps(), { ...ON, retakeNotify: false })?.reason, 'mention', '리테이크 댓글의 직접 멘션은 항상');
});

test('수정으로 새로 넣은 @이름에만 멘션, 수정에서는 답글·자동 알림 없음', () => {
  const edit = comment({ kind: 'edit', mentions: [ME.name], addedMentions: [ME.name], createdAt: '2026-11-04T02:00:00Z' });
  const d = decideSceneCommentNotification(edit, ME, deps(), ON);
  assert.equal(d?.reason, 'mention');
  assert.equal(d?.dedupeKey, 'c1:mention:edit:2026-11-04T02:00:00Z', '수정마다 따로(코덱스 1차) — 다음 수정에서 넣은 @ 도 알린다');
  const later = decideSceneCommentNotification({ ...edit, createdAt: '2026-11-04T03:00:00Z' }, ME, deps(), ON);
  assert.notEqual(later?.dedupeKey, d?.dedupeKey);
  assert.equal(decideSceneCommentNotification(comment({ kind: 'edit', mentions: [ME.name], addedMentions: [] }), ME, deps(), ON), null, '원래 있던 멘션');
  assert.equal(decideSceneCommentNotification(comment({ kind: 'edit', parentCommentId: 'r', addedMentions: [] }), ME, deps({ isCommentByUser: () => true }), ON), null);
});

test('캐릭터 댓글 → 직접 멘션만, 캐릭터 상세로 가는 정보', () => {
  const d = decideSceneCommentNotification(comment({ characterId: 'hero', partId: null, sceneNo: null, mentions: [ME.name] }), ME, deps(), ON);
  assert.equal(d?.type, 'mention');
  assert.equal(d?.metadata.characterId, 'hero');
  assert.equal(decideSceneCommentNotification(comment({ characterId: 'hero', partId: null, sceneNo: null }), ME, deps({ hasUserCommentedOnScene: () => true }), ON), null);
});

test('본문은 태그 토큰을 뺀 60자, 이미지만 있으면 (이미지 N장)', () => {
  const long = 'ㄱ'.repeat(80);
  const d = decideSceneCommentNotification(comment({ text: long, mentions: [ME.name] }), ME, deps(), ON);
  assert.equal(d?.body.length, 61);
  const img = decideSceneCommentNotification(comment({ text: '', imageCount: 2, mentions: [ME.name] }), ME, deps(), ON);
  assert.equal(img?.body, '(이미지 2장)');
  const stripped = decideSceneCommentNotification(comment({ text: '[#a001](tok) 봐 주세요', mentions: [ME.name] }), ME, deps({ plainText: (t) => t.replace(/\[(#[^\]]+)\]\([^)]+\)/g, '$1') }), ON);
  assert.equal(stripped?.body, '#a001 봐 주세요');
});

test('중복 거르기: 같은 키는 한 번만, 상한을 넘으면 오래된 것부터 잊는다', () => {
  const dedupe = createNotificationDedupe(2);
  assert.equal(dedupe.claim('a'), true);
  assert.equal(dedupe.claim('a'), false);
  dedupe.claim('b');
  dedupe.claim('c');
  assert.equal(dedupe.has('a'), false);
  assert.equal(dedupe.claim('c'), false);
});

test('세 길(실시간 행·추가 방송·수정 방송)이 같은 모양으로 정리된다', async () => {
  const mod = await import('../src/utils/sceneCommentNotification.ts');
  const fromRow = mod.normalizeSceneCommentFromRealtimeRow({ id: 'c1', part_id: 'p', scene_id: 3, scene_uuid: 's', user_id: 'u', user_name: 'n', text: 't', mentions: ['m'], images: ['i'], parent_comment_id: 'r', revision_id: null, character_id: null, created_at: 'T' });
  const fromAdd = mod.normalizeSceneCommentFromAddedBroadcast({ commentId: 'c1', partId: 'p', sceneId: '3', sceneUuid: 's', userId: 'u', userName: 'n', text: 't', mentions: ['m'], images: ['i'], parentCommentId: 'r', revisionId: null, createdAt: 'T' });
  assert.deepEqual(fromRow, fromAdd);
  const character = mod.normalizeSceneCommentFromAddedBroadcast({ commentId: 'c2', sceneId: 'char:hero', userId: 'u', text: 't', mentions: [] });
  assert.equal(character?.characterId, 'hero');
  assert.equal(character?.sceneNo, null);
  assert.equal(mod.normalizeSceneCommentFromUpdatedBroadcast({ commentId: 'c1', addedMentions: [] }), null, '새로 넣은 @ 가 없으면 알림 없음');
  const edit = mod.normalizeSceneCommentFromUpdatedBroadcast({ commentId: 'c1', partId: 'p', sceneId: '3', userId: 'u', text: 't', mentions: ['a', 'b'], addedMentions: ['b'], editedAt: 'E' });
  assert.equal(edit?.kind, 'edit');
  assert.deepEqual(edit?.addedMentions, ['b']);
});

test('수정으로 넣은 멘션은 그 댓글의 예전 알림과 따로 센다(정체성에 수정 시각)', async () => {
  const { getNotificationIdentity } = await import('../src/utils/notificationIdentity.ts');
  const add = decideSceneCommentNotification(comment({ mentions: [] }), ME, deps({ findScene: () => ({ id: 's-1', sceneId: 'a001', assignee: ME.name }) }), ON);
  const edit = decideSceneCommentNotification(comment({ kind: 'edit', mentions: [ME.name], addedMentions: [ME.name], createdAt: '2026-11-04T02:00:00Z' }), ME, deps(), ON);
  const a = getNotificationIdentity({ type: add!.type, metadata: add!.metadata });
  const e = getNotificationIdentity({ type: edit!.type, metadata: edit!.metadata });
  assert.equal(a, 'scene_comment:c1');
  assert.equal(e, 'scene_comment:c1:edit:2026-11-04T02:00:00Z');
});
