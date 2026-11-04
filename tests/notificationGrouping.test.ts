import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildNotificationDisplayGroups,
  getNotificationGroupKey,
  latestRevisionAction,
  notificationPreviewLines,
  reactionActorSummary,
  reactionEmojis,
  revisionTimeline,
  type NotificationCardGroup,
} from '../src/utils/notificationGrouping.ts';
import type { AppNotification } from '../src/stores/useNotificationStore.ts';

function notification(partial: Partial<AppNotification>): AppNotification {
  return {
    id: partial.id ?? crypto.randomUUID(),
    type: partial.type ?? 'revision',
    title: partial.title ?? '알림',
    body: partial.body,
    metadata: partial.metadata,
    isRead: partial.isRead ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}

const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
const asCard = (item: ReturnType<typeof buildNotificationDisplayGroups>[number] | undefined): NotificationCardGroup => {
  assert.ok(item && item.kind === 'group', '카드여야 한다');
  return item as NotificationCardGroup;
};

test('리테이크 상태 알림과 그 리테이크 댓글은 리테이크 한 장(최신이 앞)', () => {
  const first = notification({ id: 'n1', title: '새 리테이크', createdAt: at(1), metadata: { revisionId: 'r32', revisionAction: 'add' } });
  const second = notification({ id: 'n2', title: '리테이크 진행중', createdAt: at(2), metadata: { revisionId: 'r32', revisionAction: 'in_progress' } });
  const comment = notification({ id: 'n3', type: 'mention', title: '김어진님이 re#2 에 댓글', body: '배경 톤 확인 부탁', createdAt: at(3), metadata: { revisionId: 'r32', commentId: 'c1', authorName: '김어진', commentPartId: 'p1', commentSceneId: '1' } });

  assert.equal(getNotificationGroupKey(first), 'revision:r32');
  assert.equal(getNotificationGroupKey(comment), 'revision:r32', '리테이크 댓글 멘션도 리테이크 카드로');
  const groups = buildNotificationDisplayGroups([first, second, comment]);
  assert.equal(groups.length, 1);
  const card = asCard(groups[0]);
  assert.equal(card.variant, 'revision');
  assert.equal(card.revisionId, 'r32');
  assert.equal(card.title, '리테이크 알림 3건');
  assert.deepEqual(card.notifications.map((n) => n.id), ['n3', 'n2', 'n1']);
  assert.equal(card.commentCount, 1);
  assert.equal(card.unreadMentionCount, 1);
  assert.equal(revisionTimeline(card), '등록 → 작업 시작 · 댓글 1');
  assert.equal(latestRevisionAction(card), 'in_progress');
});

test('리테이크 알림 하나여도 카드 — 상태가 바뀌어도 새 장을 만들지 않는다', () => {
  const only = notification({ id: 'only', metadata: { revisionId: 'r9', revisionAction: 'add' } });
  const card = asCard(buildNotificationDisplayGroups([only])[0]);
  assert.equal(card.variant, 'revision');
  assert.equal(card.notifications.length, 1);
});

test('같은 씬 댓글·멘션·답글은 씬 한 장 — 새 댓글 N · 멘션 M, 미리보기 세 줄', () => {
  const scene = { commentPartId: 'part-a', commentSceneId: '1' };
  const rows = [
    notification({ id: 'c1', type: 'comment', title: '이혜민님이 댓글', body: 'LO 올렸습니다', createdAt: at(1), isRead: true, metadata: { ...scene, commentId: 'c1', authorName: '이혜민' } }),
    notification({ id: 'c2', type: 'mention', title: '강선영님이 회원님을 언급', body: '@배한솔 그림자 확인', createdAt: at(2), metadata: { ...scene, commentId: 'c2', authorName: '강선영', mentionedBy: '강선영' } }),
    notification({ id: 'c3', type: 'mention', title: '이다은님이 내 댓글에 답글', body: '확인했어요', createdAt: at(3), metadata: { ...scene, commentId: 'c3', parentCommentId: 'c1', mentionedBy: '이다은' } }),
    notification({ id: 'c4', type: 'comment', title: '원동우님이 댓글을 남겼습니다 · EP05 a001', createdAt: at(4), metadata: { ...scene, commentId: 'c4' } }),
    notification({ id: 'other', type: 'comment', title: '다른 씬', createdAt: at(5), metadata: { commentPartId: 'part-a', commentSceneId: '2', commentId: 'x' } }),
  ];
  assert.equal(getNotificationGroupKey(rows[0]!), 'thread:part-a:1');
  const groups = buildNotificationDisplayGroups(rows);
  assert.equal(groups.length, 2, '씬마다 한 장(하나뿐인 씬도 카드)');
  const card = asCard(groups.find((g) => g.kind === 'group' && g.key === 'thread:part-a:1'));
  assert.equal(card.variant, 'thread');
  assert.equal(card.commentCount, 4);
  assert.equal(card.unreadCommentCount, 3);
  assert.equal(card.unreadMentionCount, 2);
  const lines = notificationPreviewLines(card, 3);
  assert.deepEqual(lines.map((l) => l.id), ['c4', 'c3', 'c2']);
  // 이름을 모르는 예전 알림은 제목, 이름을 알면 '이름 + 본문'
  assert.equal(lines[0]!.name, null);
  assert.equal(lines[0]!.text, '원동우님이 댓글을 남겼습니다 · EP05 a001');
  assert.equal(lines[1]!.name, '이다은');
  assert.equal(lines[1]!.text, '확인했어요');
  assert.equal(lines[2]!.mention, true);
  assert.equal(groups[0]!.kind === 'group' && groups[0]!.key, 'thread:part-a:2', '최근 카드가 위');
});

test('캐릭터 댓글 멘션은 씬이 없어 낱개 줄', () => {
  const character = notification({ id: 'ch', type: 'mention', metadata: { characterId: 'char-1', commentId: 'cc1' } });
  assert.equal(getNotificationGroupKey(character), null);
  assert.equal(buildNotificationDisplayGroups([character])[0]!.kind, 'item');
});

test('반응은 씬마다 조용한 한 장 — 박정인 외 1명, 이모지는 겹치지 않게', () => {
  const scene = { commentPartId: 'part-a', commentSceneId: '1' };
  const rows = [
    notification({ id: 'r1', type: 'comment_reaction', createdAt: at(1), metadata: { ...scene, commentId: 'c1', reactionNotificationId: 'r1', reactionEmojis: ['👍'], reactionActorName: '이혜민' } }),
    notification({ id: 'r2', type: 'comment_reaction', createdAt: at(2), metadata: { ...scene, commentId: 'c2', reactionNotificationId: 'r2', reactionEmojis: ['👀', '👍'], reactionActorName: '박정인' } }),
  ];
  const card = asCard(buildNotificationDisplayGroups(rows)[0]);
  assert.equal(card.variant, 'reaction');
  assert.equal(card.key, 'reaction:part-a:1');
  assert.equal(reactionActorSummary(card), '박정인 외 1명');
  assert.deepEqual(reactionEmojis(card), ['👍', '👀']);
});

test('단계 변경·배정 묶음은 두 개 이상일 때만, 씬 uuid 가 있으면 그것으로', () => {
  const sceneChange = notification({ id: 'n1', type: 'scene_change', title: '씬 변경', metadata: { sheetName: 'EP01_A_BG', sceneName: 'a032' } });
  const assignment = notification({ id: 'n2', type: 'scene_assignment', title: '씬 배정', metadata: { sheetName: 'EP01_A_BG', sceneName: 'a032' } });
  assert.equal(getNotificationGroupKey(sceneChange), 'scene:EP01_A_BG:a032');
  const groups = buildNotificationDisplayGroups([sceneChange, assignment]);
  assert.equal(groups.length, 1);
  assert.equal(asCard(groups[0]).variant, 'scene');

  const lone = notification({ id: 'n3', type: 'scene_change', metadata: { sceneId: 'uuid-1', sceneName: 'a001' } });
  assert.equal(getNotificationGroupKey(lone), 'scene:uuid-1');
  assert.equal(buildNotificationDisplayGroups([lone])[0]!.kind, 'item');
});

test('알림 창은 카드로 그린다 — 접는 묶음·왼쪽 막대 없음', () => {
  const panel = readFileSync('src/components/NotificationPanel.tsx', 'utf8');
  assert.match(panel, /buildNotificationDisplayGroups/);
  assert.match(panel, /function NotificationCard\(/);
  assert.doesNotMatch(panel, /NotificationGroupItem|groupCollapsedKeys|묶음 펼치기|묶음 접기/);
  assert.doesNotMatch(panel, /bf-noti-unread-bar|mention-badge|text-\[9px\]|#00D9A0|#FF7675/);
});
