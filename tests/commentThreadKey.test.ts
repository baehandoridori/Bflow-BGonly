import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSceneThreadKeyForScene,
  buildSceneThreadKeyFromCommentKey,
  buildSceneThreadKeyFromRevisionKey,
} from '../src/utils/commentThreadKey.ts';

const episodes = [
  {
    episodeNumber: 5,
    title: 'EP05',
    parts: [
      {
        partId: 'A',
        sheetName: 'EP05_A_BG',
        department: 'bg',
        scenes: [
          { id: 'scene-a001', no: 1, sceneId: 'a001' },
          { id: 'scene-a002', no: 2, sceneId: 'a002' },
        ],
      },
      {
        partId: 'A',
        sheetName: 'EP05_A_ACT',
        department: 'act',
        scenes: [
          { id: 'scene-a001-act', no: 1, sceneId: 'a001' },
        ],
      },
    ],
  },
] as any;

test('buildSceneThreadKeyForScene uses episode part scene format', () => {
  const key = buildSceneThreadKeyForScene({
    episodeNumber: 5,
    partId: 'a',
    sceneId: 'A001',
    fallbackKey: 'fallback',
  });

  assert.equal(key, 'EP05:A:a001');
});

test('comment sheet key and revision scene key meet at the same scene thread key', () => {
  const fromComment = buildSceneThreadKeyFromCommentKey(episodes, 'EP05_A_BG:1');
  const fromRevision = buildSceneThreadKeyFromRevisionKey('EP05:A:a001');

  assert.equal(fromComment, 'EP05:A:a001');
  assert.equal(fromRevision, 'EP05:A:a001');
});

test('comment key falls back when no matching part or scene exists', () => {
  assert.equal(buildSceneThreadKeyFromCommentKey(episodes, 'UNKNOWN:99'), 'UNKNOWN:99');
});
