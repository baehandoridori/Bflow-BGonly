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
  // v1.146.0(§6.1): 씬 댓글 알림(리테이크 댓글 포함)은 씬 UUID 로 먼저 찾고, 위치는 'EP05 a001'(씬 번호, 정렬 번호 아님).
  const notifier = readFileSync('src/services/sceneCommentNotifier.ts', 'utf8');
  const uuidIndex = notifier.indexOf('const byUuid = ds.findSceneByUuid(comment.sceneUuid);');
  const sortOrderIndex = notifier.indexOf('const targetNo = Number(comment.sceneNo);');
  assert.ok(uuidIndex > -1);
  assert.ok(sortOrderIndex > -1);
  assert.ok(uuidIndex < sortOrderIndex);
  assert.match(notifier, /return scene\?\.sceneId \? `\$\{epLabel\} \$\{scene\.sceneId\}` : epLabel;/);
});
