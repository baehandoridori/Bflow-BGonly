import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeedbackHubStats, buildFeedbackHubTree } from '../src/views/compositing/feedbackHubUtils.ts';
import type { CompRevision } from '../src/types/index.ts';
import type { SceneGroup } from '../src/views/compositing/utils.ts';

const baseRevision = {
  sceneKey: 'EP01:A:1',
  priority: 'normal',
  description: '색감 확인 필요',
  requesterId: 'user-1',
  requesterName: '한솔',
  createdAt: '2026-05-27T01:00:00.000Z',
  updatedAt: '2026-05-27T01:00:00.000Z',
} satisfies Partial<CompRevision>;

function revision(overrides: Partial<CompRevision>): CompRevision {
  return {
    ...baseRevision,
    id: overrides.id ?? 'rev-1',
    revisionNo: overrides.revisionNo ?? 1,
    status: overrides.status ?? 'open',
    ...overrides,
  } as CompRevision;
}

function sceneGroup(
  episodeNumber: number,
  partId: string,
  sceneId: string,
  sceneNo: number,
  openCount: number,
  revisions: CompRevision[] = [revision({
    id: `${episodeNumber}-${partId}-${sceneId}`,
    sceneKey: `EP${String(episodeNumber).padStart(2, '0')}:${partId}:${sceneId}`,
  })],
): SceneGroup {
  return {
    sceneKey: `EP${String(episodeNumber).padStart(2, '0')}:${partId}:${sceneId}`,
    info: {
      sceneKey: `EP${String(episodeNumber).padStart(2, '0')}:${partId}:${sceneId}`,
      sceneId,
      sceneNo,
      sceneName: `${sceneId} 메모`,
      sheetName: `EP${String(episodeNumber).padStart(2, '0')}_${partId}_BG`,
      part: partId,
      partId,
      episodeNumber,
      department: 'bg',
      assignee: '배한',
    },
    revisions,
    openCount,
    uniqueRequesters: ['배한'],
  };
}

test('feedback hub stats use real revision workflow states without assignment-only buckets', () => {
  const revisions = [
    revision({
      id: 'open-old',
      revisionNo: 1,
      status: 'open',
      assignee: '민지',
      requesterName: '한솔',
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z',
    }),
    revision({
      id: 'progress-mine',
      revisionNo: 2,
      status: 'in_progress',
      assignee: '한솔',
      requesterName: '민지',
    }),
    revision({
      id: 'reopened-fresh',
      revisionNo: 3,
      status: 'open',
      assignee: '서연',
      requesterName: '민지',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-27T08:50:00.000Z',
      resolvedAt: '2026-05-22T00:00:00.000Z',
    }),
    revision({
      id: 'resolved-today',
      revisionNo: 4,
      status: 'resolved',
      assignee: '민지',
      requesterName: '서연',
      resolvedAt: '2026-05-27T02:00:00.000Z',
    }),
  ];

  const stats = buildFeedbackHubStats({
    revisions,
    commentCountByRev: new Map([
      ['open-old', 2],
      ['progress-mine', 1],
    ]),
    currentUserName: '한솔',
    now: new Date('2026-05-27T09:00:00.000Z'),
  });

  assert.equal(stats.totalOpen, 3);
  assert.equal(stats.withComments, 2);
  assert.equal(stats.myRelated, 2);
  assert.equal(stats.stalled, 1);
  assert.equal(stats.resolvedToday, 1);
  assert.deepEqual(stats.workflowLabels, ['대기', '진행중', '완료']);
});

test('feedback hub tree groups visible scenes by episode then part', () => {
  const tree = buildFeedbackHubTree({
    sceneGroups: [
      sceneGroup(5, 'B', 'b001', 1, 1),
      sceneGroup(5, 'A', 'a002', 2, 0),
      sceneGroup(5, 'A', 'a001', 1, 1),
      sceneGroup(6, 'A', 'a001', 1, 1),
    ],
    episodes: [
      { episodeNumber: 5, title: 'EP.05', parts: [] },
      { episodeNumber: 6, title: 'EP.06', parts: [] },
    ],
    getEpisodeDisplayName: (episode) => episode.title,
  });

  assert.deepEqual(tree.map((episode) => episode.episodeLabel), ['EP.05', 'EP.06']);
  assert.deepEqual(tree[0].parts.map((part) => part.partId), ['A', 'B']);
  assert.deepEqual(tree[0].parts[0].scenes.map((scene) => scene.info.sceneId), ['a001', 'a002']);
  assert.equal(tree[0].sceneCount, 3);
  assert.equal(tree[0].totalOpen, 2);
});
