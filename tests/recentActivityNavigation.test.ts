import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatActivityGroupLabel,
  formatActivitySceneLabel,
  resolveActivitySceneNavigation,
} from '../src/components/widgets/activity/feedNavigation.ts';
import type { Activity, Episode } from '../src/types/index.ts';

const baseActivity = {
  id: 'activity-1',
  userId: 'user-1',
  userName: '한솔',
  actionType: 'stage_done',
  actionGroup: 'stage',
  sceneId: 'scene-uuid-1',
  sceneLabel: 'EP02 B #b018',
  episodeNumber: 2,
  department: 'bg',
  detail: null,
  createdAt: '2026-05-09T00:00:00.000Z',
} satisfies Activity;

const episodes = [
  {
    episodeNumber: 2,
    title: 'EP.02',
    parts: [
      {
        id: 'part-uuid-1',
        partId: 'B',
        department: 'bg',
        sheetName: 'EP02_B_BG',
        scenes: [
          {
            id: 'scene-uuid-1',
            no: 18,
            sceneId: 'b018',
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: '한솔',
            layoutId: '',
            lo: false,
            done: true,
            review: false,
            png: false,
          },
        ],
      },
    ],
  },
] satisfies Episode[];

const episodesWithBothDepartments = [
  {
    episodeNumber: 2,
    title: 'EP.02',
    parts: [
      {
        id: 'part-uuid-bg',
        partId: 'B',
        department: 'bg',
        sheetName: 'EP02_B_BG',
        scenes: [
          {
            id: 'scene-uuid-bg',
            no: 18,
            sceneId: 'b018',
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: '한솔',
            layoutId: '',
            lo: false,
            done: true,
            review: false,
            png: false,
          },
        ],
      },
      {
        id: 'part-uuid-act',
        partId: 'B',
        department: 'acting',
        sheetName: 'EP02_B_ACT',
        scenes: [
          {
            id: 'scene-uuid-act',
            no: 18,
            sceneId: 'b018_act',
            memo: '',
            storyboardUrl: '',
            guideUrl: '',
            assignee: '다른사람',
            layoutId: '',
            lo: false,
            done: false,
            review: false,
            png: false,
          },
        ],
      },
    ],
  },
] satisfies Episode[];

test('recent activity labels replace EP prefix with the custom Korean episode title (v1.23.0 가운데점)', () => {
  assert.equal(
    formatActivitySceneLabel(baseActivity.sceneLabel, baseActivity.episodeNumber, { 2: '쾅 뉴럴링크' }),
    '쾅 뉴럴링크 · B · #b018',
  );
  assert.equal(
    formatActivitySceneLabel(baseActivity.sceneLabel, baseActivity.episodeNumber, {}),
    'EP02 · B · #b018',
  );
  assert.equal(formatActivitySceneLabel(null, 2, { 2: '쾅 뉴럴링크' }), '');
});

test('recent activity group labels use the custom Korean episode title when available', () => {
  assert.equal(formatActivityGroupLabel(baseActivity, { 2: '쾅 뉴럴링크' }), '쾅 뉴럴링크');
  assert.equal(formatActivityGroupLabel(baseActivity, {}), 'EP02');
});

test('recent activity scene navigation resolves UUID activity targets to the scene deep link target', () => {
  assert.deepEqual(resolveActivitySceneNavigation(baseActivity, episodes), {
    episodeNumber: 2,
    partId: 'B',
    sheetName: 'EP02_B_BG',
    sceneId: 'b018',
  });

  assert.equal(
    resolveActivitySceneNavigation(
      { ...baseActivity, sceneId: 'missing-scene', sceneLabel: '알 수 없는 씬' },
      episodes,
    ),
    null,
  );
});

test('recent activity scene navigation falls back to scene label when comment activity lost its scene UUID', () => {
  assert.deepEqual(
    resolveActivitySceneNavigation(
      {
        ...baseActivity,
        actionType: 'comment_add',
        sceneId: null,
        sceneLabel: 'EP02 B #18',
        detail: { commentId: 'comment-1', textPreview: '테스트 댓글' },
      },
      episodes,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_BG',
      sceneId: 'b018',
    },
  );
});

test('recent activity scene navigation tolerates legacy comment activity scene numbers', () => {
  assert.deepEqual(
    resolveActivitySceneNavigation(
      {
        ...baseActivity,
        actionType: 'comment_add',
        sceneId: '18',
        sceneLabel: 'EP02 B #18',
        detail: { commentId: 'comment-2', textPreview: '레거시 댓글' },
      },
      episodes,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_BG',
      sceneId: 'b018',
    },
  );
});

test('recent activity scene navigation uses activity department to disambiguate BG and ACT comment fallbacks', () => {
  assert.deepEqual(
    resolveActivitySceneNavigation(
      {
        ...baseActivity,
        actionType: 'comment_add',
        sceneId: null,
        sceneLabel: 'EP02 B #18',
        department: 'bg',
        detail: { commentId: 'comment-bg' },
      },
      episodesWithBothDepartments,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_BG',
      sceneId: 'b018',
    },
  );

  assert.deepEqual(
    resolveActivitySceneNavigation(
      {
        ...baseActivity,
        actionType: 'comment_add',
        sceneId: null,
        sceneLabel: 'EP02 B #18',
        department: 'acting',
        detail: { commentId: 'comment-act' },
      },
      episodesWithBothDepartments,
    ),
    {
      episodeNumber: 2,
      partId: 'B',
      sheetName: 'EP02_B_ACT',
      sceneId: 'b018_act',
    },
  );
});

// v1.23.0: 가운데점 분리 포맷 검증
test('formatActivitySceneLabel: 가운데점 분리', () => {
  const titles = { 2: '그림자국' };
  assert.equal(
    formatActivitySceneLabel('EP02 E #15', 2, titles),
    '그림자국 · E · #15',
  );
});

test('formatActivitySceneLabel: 에피소드 제목 없으면 EP02 폴백', () => {
  assert.equal(
    formatActivitySceneLabel('EP02 E #15', 2, {}),
    'EP02 · E · #15',
  );
});

test('formatActivitySceneLabel: 빈 라벨', () => {
  assert.equal(formatActivitySceneLabel('', 2, {}), '');
});

test('formatActivitySceneLabel: 리비전 라벨도 가운데점 분리', () => {
  const titles = { 2: '그림자국' };
  assert.equal(
    formatActivitySceneLabel('EP02 E #15 리비전 #3', 2, titles),
    '그림자국 · E · #15 · 리비전 · #3',
  );
});
