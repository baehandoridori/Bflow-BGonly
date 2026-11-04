import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMentionWebhookPayloads,
  mergeMentionDeliveryRetry,
  slackCommentText,
  slackEpisodeAndPart,
} from '../src/utils/mentionWebhookPayloads.ts';
import { resolveNotificationSettings } from '../src/utils/notificationSettings.ts';

const me = { id: 'u-me', name: '배한솔', slackId: 'U-ME' };
const users = {
  kim: { id: 'u-kim', name: '김어진', slackId: 'U-KIM' },
  park: { id: 'u-park', name: '박정인', slackId: '' },
};

test('EP·파트 변수는 리테이크 알림과 같은 모양(EP05 / A)', () => {
  assert.deepEqual(slackEpisodeAndPart('EP05_A_BG'), { EP: 'EP05', part: 'A' });
  assert.deepEqual(slackEpisodeAndPart('EP12_C_ACT'), { EP: 'EP12', part: 'C' });
  assert.deepEqual(slackEpisodeAndPart('이상한이름'), { EP: '이상한이름', part: '' });
});

test('슬랙 글: 태그 토큰은 평문으로, 이미지만 있으면 (이미지 N장)', () => {
  const plain = (t: string) => t.replace(/\[(#[^\]]+)\]\([^)]+\)/g, '$1');
  assert.equal(slackCommentText({ text: '[#a001](bflow:x) 확인', images: [] }, plain), '#a001 확인');
  assert.equal(slackCommentText({ text: '  ', images: ['a', 'b'] }, plain), '(이미지 2장)');
});

test('받는 사람: 나는 빼고, 같은 사람은 한 번, 슬랙 ID 없으면 missing 으로', () => {
  const plan = buildMentionWebhookPayloads({
    comment: { text: '봐 주세요', images: [] },
    sheetName: 'EP05_A_BG',
    sceneNo: '3',
    sceneLabel: 'a001',
    me,
    targets: [users.kim, me, users.kim, users.park],
    now: Date.parse('2026-11-04T05:30:00Z'),
    plainText: (t) => t,
  });
  assert.equal(plan.payloads.length, 1);
  assert.deepEqual(plan.missing, ['박정인']);
  const payload = plan.payloads[0].payload;
  assert.equal(payload.name_target, 'U-KIM');
  assert.equal(payload.name_my, 'U-ME');
  assert.equal(payload.EP, 'EP05');
  assert.equal(payload.part, 'A');
  assert.equal(payload.scene, 'a001', '씬 변수는 정렬 번호가 아니라 씬 번호');
  assert.equal(payload.deep_link, 'bflow://scene/EP05_A_BG/3');
  assert.match(payload.time, /11월 4일/);
});

test('작성자 슬랙 ID 가 없어도 받는 사람에게는 보낸다(이름으로 표시)', () => {
  const plan = buildMentionWebhookPayloads({
    comment: { text: '확인', images: [] },
    sheetName: 'EP05_A_BG', sceneNo: '1', me: { id: 'u-me', name: '배한솔', slackId: null },
    targets: [users.kim], plainText: (t) => t,
  });
  assert.equal(plan.payloads.length, 1);
  assert.equal(plan.payloads[0].payload.name_my, '배한솔');
});

test('알림 설정: 기본값과 예전 저장값 옮기기', () => {
  assert.deepEqual(resolveNotificationSettings(null), { sceneAuto: true, retake: true, reaction: false, osNotification: true });
  // 예전 '내 씬 댓글 알림'·'내 씬 변경 알림' 중 하나라도 껐으면 '내 씬 자동 알림'도 꺼짐. 멘션은 항상(키 없음).
  assert.equal(resolveNotificationSettings({ commentNotify: false }).sceneAuto, false);
  assert.equal(resolveNotificationSettings({ sceneChange: false }).sceneAuto, false);
  // 예전 '내 씬 댓글'은 리테이크 등록·진행·리테이크 댓글 알림도 같이 껐다 — 껐던 사람은 리테이크 알림도 꺼진 채로.
  assert.equal(resolveNotificationSettings({ commentNotify: false }).retake, false, '예전에 끈 사람에게 리테이크 알림이 갑자기 오지 않게');
  assert.equal(resolveNotificationSettings({ sceneChange: false }).retake, true, '내 씬 변경 토글은 리테이크와 무관');
  assert.equal(resolveNotificationSettings({ retake: true, commentNotify: false }).retake, true, '새 키가 우선');
  assert.equal(resolveNotificationSettings({ sceneAuto: true, commentNotify: false }).sceneAuto, true, '새 키가 우선');
  assert.equal(resolveNotificationSettings({ reaction: true, sound: false, syncComplete: true, toastDuration: 7000 }).reaction, true);
});

test('다시 보내기 결과 합치기 — 받은 사람은 그대로 더하고, 실패는 이번 결과로', () => {
  const first = { targets: 3, sent: 1, failed: 1, failedIds: ['u-kim'], missing: ['박정인'] };
  const ok = mergeMentionDeliveryRetry(first, { targets: 1, sent: 1, failed: 0, failedIds: [], missing: [] });
  assert.deepEqual(ok, { targets: 3, sent: 2, failed: 0, failedIds: [], missing: ['박정인'] });
  const again = mergeMentionDeliveryRetry(first, { targets: 1, sent: 0, failed: 1, failedIds: ['u-kim'], missing: [] });
  assert.deepEqual(again.failedIds, ['u-kim']);
  assert.equal(again.sent, 1);
});

test('슬랙은 받는 사람 모두에게 한꺼번에 보낸다 — 기다리는 사이 로그아웃해도 나머지가 새 세션으로 나가지 않게(코덱스 5차)', async () => {
  const { notifyMentionsForComment } = await import('../src/services/slackWebhookService.ts');
  const started: string[] = [];
  const finish: Array<(ok: boolean) => void> = [];
  const previous = (globalThis as any).window;
  (globalThis as any).window = { electronAPI: { sendSlackWebhook: (payload: Record<string, string>) => {
    started.push(payload.name_target);
    return new Promise<void>((resolve, reject) => finish.push((ok) => (ok ? resolve() : reject(new Error('막힘')))));
  } } };
  try {
    const pending = notifyMentionsForComment({
      comment: { text: '확인 부탁', mentions: ['김어진', '이도윤'] },
      sheetName: 'EP05_A_BG', sceneNo: '3', sceneLabel: 'a003', me,
      users: [me, users.kim, { id: 'u-lee', name: '이도윤', slackId: 'U-LEE' }],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['U-KIM', 'U-LEE'], '첫 요청이 끝나기 전에 모두 보냈다');
    finish[0](true);
    finish[1](false);
    const result = await pending;
    assert.equal(result.sent, 1);
    assert.deepEqual(result.failedIds, ['u-lee']);
  } finally {
    (globalThis as any).window = previous;
  }
});
