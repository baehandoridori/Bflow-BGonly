import test from 'node:test';
import assert from 'node:assert/strict';

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
