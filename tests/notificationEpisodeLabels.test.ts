import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildNotificationSceneDisplayLabel,
  formatEpisodeDisplayName,
  parseEpisodeNumberFromSceneKey,
} from '../src/utils/notificationEpisodeLabels.ts';

test('notification episode labels prefer custom episode titles over EP ids', () => {
  assert.equal(
    formatEpisodeDisplayName(2, { 2: '그림자국' }),
    '그림자국',
  );
});

test('notification scene display label replaces EP scene keys with episode titles', () => {
  assert.equal(
    buildNotificationSceneDisplayLabel({
      episodeNumber: parseEpisodeNumberFromSceneKey('EP02:B:b018') ?? undefined,
      partId: 'B',
      sceneId: 'b018',
      episodeTitles: { 2: '그림자국' },
    }),
    '그림자국 · B · b018',
  );
});

test('notification scene display label keeps a stable fallback when title is missing', () => {
  assert.equal(
    buildNotificationSceneDisplayLabel({
      episodeNumber: 2,
      sceneId: 'b018',
      episodeTitles: {},
    }),
    'EP02 · b018',
  );
});

test('revision comment notifications prefer uuid scene labels over numeric comment sort ids', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const uuidLabelIndex = app.indexOf('if (sceneByUuid?.sceneId) return sceneByUuid.sceneId;');
  const sceneKeyLabelIndex = app.indexOf('const sceneKeyLabel = buildNotificationSceneDisplayLabelFromSceneKey');

  assert.ok(uuidLabelIndex > -1);
  assert.ok(sceneKeyLabelIndex > -1);
  assert.ok(uuidLabelIndex < sceneKeyLabelIndex);
});
