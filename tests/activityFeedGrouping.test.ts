import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { groupActivities } from '../src/components/widgets/activity/utils.ts';
import type { Activity, ActionType } from '../src/types/index.ts';

const feedbackHubPreviewApp = readFileSync('src/views/FeedbackHubPreviewApp.tsx', 'utf8');

function makeActivity(overrides: Partial<Activity> & { id: string }): Activity {
  return {
    id: overrides.id,
    userId: overrides.userId ?? 'u1',
    userName: overrides.userName ?? '한솔',
    actionType: overrides.actionType ?? ('assignee_change' as ActionType),
    actionGroup: overrides.actionGroup ?? 'etc',
    sceneId: overrides.sceneId ?? 'scene-1',
    sceneLabel: overrides.sceneLabel ?? 'EP01 #01',
    episodeNumber: overrides.episodeNumber ?? 1,
    department: overrides.department ?? 'bg',
    detail: overrides.detail ?? null,
    createdAt: overrides.createdAt ?? '2026-05-16T00:00:00.000Z',
  };
}

test('multi-scene action: assignee_change 4건 다른 sceneId 5분 이내 → 1 group', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
    makeActivity({ id: 'a3', sceneId: 's-3', createdAt: '2026-05-16T00:02:00Z' }),
    makeActivity({ id: 'a4', sceneId: 's-4', createdAt: '2026-05-16T00:03:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0]?.type, 'group');
  if (r[0]?.type === 'group') assert.equal(r[0].items.length, 4);
});

test('single-scene action: stage_done 2건 다른 sceneId → 2 items (회귀 방지)', () => {
  const acts: Activity[] = [
    makeActivity({
      id: 'a1',
      actionType: 'stage_done',
      actionGroup: 'progress',
      sceneId: 's-1',
      createdAt: '2026-05-16T00:00:00Z',
    }),
    makeActivity({
      id: 'a2',
      actionType: 'stage_done',
      actionGroup: 'progress',
      sceneId: 's-2',
      createdAt: '2026-05-16T00:01:00Z',
    }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
  assert.equal(r[0]?.type, 'item');
  assert.equal(r[1]?.type, 'item');
});

test('multi-scene action: 5분 윈도우 초과 → 2 그룹/아이템', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', sceneId: 's-2', createdAt: '2026-05-16T00:06:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('multi-scene action: 다른 episode → 묶이지 않음', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', sceneId: 's-1', episodeNumber: 1, createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', sceneId: 's-2', episodeNumber: 2, createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('layout_change 도 multi-scene 화이트리스트 적용', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', actionType: 'layout_change', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', actionType: 'layout_change', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
});

test('image_upload_storyboard 도 multi-scene 화이트리스트 적용', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', actionType: 'image_upload_storyboard', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', actionType: 'image_upload_storyboard', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
    makeActivity({ id: 'a3', actionType: 'image_upload_storyboard', sceneId: 's-3', createdAt: '2026-05-16T00:02:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  if (r[0]?.type === 'group') assert.equal(r[0].items.length, 3);
});

test('retake revision_add bursts across scenes are grouped within 5 minutes', () => {
  const acts: Activity[] = [
    makeActivity({
      id: 'r1',
      actionType: 'revision_add',
      actionGroup: 'memo',
      sceneId: 's-1',
      createdAt: '2026-05-16T00:00:00Z',
    }),
    makeActivity({
      id: 'r2',
      actionType: 'revision_add',
      actionGroup: 'memo',
      sceneId: 's-2',
      createdAt: '2026-05-16T00:01:00Z',
    }),
    makeActivity({
      id: 'r3',
      actionType: 'revision_add',
      actionGroup: 'memo',
      sceneId: 's-3',
      createdAt: '2026-05-16T00:02:00Z',
    }),
  ];

  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0]?.type, 'group');
  if (r[0]?.type === 'group') assert.equal(r[0].items.length, 3);
});

test('retake status bursts across scenes are grouped within 5 minutes', () => {
  const acts: Activity[] = [
    makeActivity({
      id: 'r1',
      actionType: 'revision_resolve',
      actionGroup: 'memo',
      sceneId: 's-1',
      createdAt: '2026-05-16T00:00:00Z',
    }),
    makeActivity({
      id: 'r2',
      actionType: 'revision_resolve',
      actionGroup: 'memo',
      sceneId: 's-2',
      createdAt: '2026-05-16T00:01:00Z',
    }),
  ];

  const r = groupActivities(acts);
  assert.equal(r.length, 1);
  assert.equal(r[0]?.type, 'group');
});

test('다른 user 의 같은 multi-scene 액션 → 묶이지 않음 (user 분리는 유지)', () => {
  const acts: Activity[] = [
    makeActivity({ id: 'a1', userId: 'u1', sceneId: 's-1', createdAt: '2026-05-16T00:00:00Z' }),
    makeActivity({ id: 'a2', userId: 'u2', sceneId: 's-2', createdAt: '2026-05-16T00:01:00Z' }),
  ];
  const r = groupActivities(acts);
  assert.equal(r.length, 2);
});

test('feedback hub preview retake activities use the same memo group as production activity constants', () => {
  assert.match(feedbackHubPreviewApp, /actionGroup:\s*'memo'/);
  assert.doesNotMatch(feedbackHubPreviewApp, /actionGroup:\s*'etc'/);
});

test('feedback hub preview retake burst uses one actor id for grouped demo', () => {
  assert.match(feedbackHubPreviewApp, /const actorUserId = typeof actor === 'object' \? actor\.userId : revision\.requesterId/);
  assert.match(feedbackHubPreviewApp, /const actorUserName = typeof actor === 'object' \? actor\.userName : actor \?\? revision\.requesterName/);
  const burstActivityStart = feedbackHubPreviewApp.indexOf("'2026-05-28T07:37:00+09:00'");
  assert.notEqual(burstActivityStart, -1);
  const burstActivityCall = feedbackHubPreviewApp.slice(burstActivityStart, burstActivityStart + 180);
  assert.match(burstActivityCall, /userId: 'preview-user-hansol'/);
  assert.match(burstActivityCall, /userName: '한솔'/);
});
