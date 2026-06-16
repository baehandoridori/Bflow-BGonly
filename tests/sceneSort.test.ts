import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compareSceneIdsByNumberThenSuffix,
  parseSceneNumberSuffix,
} from '../src/utils/sceneSort.ts';

test('scene sort parses numeric scene ids with optional alphabet suffixes', () => {
  assert.deepEqual(parseSceneNumberSuffix('a001'), { prefix: 'a', number: 1, suffix: '' });
  assert.deepEqual(parseSceneNumberSuffix('a001A'), { prefix: 'a', number: 1, suffix: 'A' });
  assert.deepEqual(parseSceneNumberSuffix('sc010b'), { prefix: 'sc', number: 10, suffix: 'B' });
  assert.deepEqual(parseSceneNumberSuffix('v2a001b'), { prefix: 'v2a', number: 1, suffix: 'B' });
});

test('scene sort orders by number first and suffix alphabet second', () => {
  const ids = ['a002', 'a001C', 'v2a001B', 'a001', 'a001B', 'a010', 'v2a001', 'a001A'];
  assert.deepEqual(ids.sort(compareSceneIdsByNumberThenSuffix), [
    'a001',
    'v2a001',
    'a001A',
    'a001B',
    'v2a001B',
    'a001C',
    'a002',
    'a010',
  ]);
});

test('scene views use suffix-aware sorting for number order', () => {
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');
  const mergedHelpers = readFileSync('src/utils/mergedSceneHelpers.ts', 'utf8');

  assert.match(scenesView, /compareScenesByNumberThenSuffix/);
  assert.match(mergedHelpers, /compareSceneIdsByNumberThenSuffix/);
  assert.doesNotMatch(scenesView, /sceneId\?\.match\(\/\\d\+\$\/\)/);
  assert.doesNotMatch(mergedHelpers, /sceneId\?\.match\(\/\\d\+\$\/\)/);
});

test('additional scene suffix dropdown includes the current suggested suffix', () => {
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(scenesView, /function getAdditionalSceneSuffixOptions\(currentSuffix: string\): string\[]/);
  assert.match(scenesView, /ADDITIONAL_SCENE_SUFFIXES\.slice\(0, 24\)/);
  assert.match(scenesView, /\?\s*\[\.\.\.defaultOptions, normalized\]/);
  assert.doesNotMatch(scenesView, /ADDITIONAL_SCENE_SUFFIXES\.slice\(0, 8\)/);
});
