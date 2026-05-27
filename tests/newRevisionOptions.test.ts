import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRevisionPartOptions,
  buildRevisionPartScenesUnion,
} from '../src/views/compositing/newRevisionOptions.ts';
import type { Episode, Part, Scene } from '../src/types/index.ts';

function scene(sceneId: string, no: number, assignee = ''): Scene {
  return {
    no,
    sceneId,
    memo: `${sceneId} memo`,
    storyboardUrl: '',
    guideUrl: '',
    assignee,
    layoutId: '',
    lo: false,
    done: false,
    review: false,
    png: false,
  };
}

function part(partId: string, department: Part['department'], scenes: Scene[]): Part {
  return {
    partId,
    department,
    sheetName: `EP05_${partId}_${department === 'bg' ? 'BG' : 'ACT'}`,
    scenes,
  };
}

test('new revision part options merge acting/background parts that differ only by case', () => {
  const episode: Episode = {
    episodeNumber: 5,
    title: 'EP.05',
    parts: [
      part('a', 'acting', [scene('a001', 1)]),
      part('A', 'bg', [scene('a001', 1)]),
      part('B', 'bg', [scene('b001', 1)]),
    ],
  };

  const options = buildRevisionPartOptions(episode);

  assert.deepEqual(options.map((option) => option.partId), ['A', 'B']);
  assert.equal(options[0].part.department, 'bg');
});

test('new revision scene union reads BG and acting scenes from the same canonical part', () => {
  const bgPart = part('A', 'bg', [scene('a001', 1, '배경')]);
  const actingPart = part('a', 'acting', [scene('a002', 2, '액팅')]);
  const episode: Episode = {
    episodeNumber: 5,
    title: 'EP.05',
    parts: [bgPart, actingPart],
  };

  const union = buildRevisionPartScenesUnion(episode, bgPart);

  assert.deepEqual(union.scenes.map((item) => item.sceneId), ['a001', 'a002']);
  assert.equal(union.sourceMap.get('a001'), bgPart);
  assert.equal(union.sourceMap.get('a002'), actingPart);
});
