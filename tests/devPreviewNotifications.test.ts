import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const modulePath = path.join(process.cwd(), 'src', 'utils', 'devPreviewNotifications.ts');

test('dev preview notification builder creates real scene-jump alarm types from mock episode data', async () => {
  assert.equal(existsSync(modulePath), true, 'devPreviewNotifications.ts must exist');
  const { buildDevPreviewNotifications } = await import('../src/utils/devPreviewNotifications.ts');

  const notifications = buildDevPreviewNotifications([
    {
      episodeNumber: 1,
      title: 'EP.01',
      parts: [
        {
          id: 'part-bg',
          partId: 'A',
          department: 'bg',
          sheetName: 'EP01_A_BG',
          scenes: [
            {
              id: 'scene-bg',
              no: 1,
              sceneId: 'a001',
              memo: '',
              storyboardUrl: '',
              guideUrl: '',
              assignee: '배한솔',
              layoutId: '',
              lo: false,
              done: false,
              review: false,
              png: false,
            },
          ],
        },
        {
          id: 'part-act',
          partId: 'A',
          department: 'acting',
          sheetName: 'EP01_A_ACT',
          scenes: [
            {
              id: 'scene-act',
              no: 1,
              sceneId: 'a001',
              memo: '',
              storyboardUrl: '',
              guideUrl: '',
              assignee: '배한솔',
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
  ]);

  assert.deepEqual(
    notifications.map((n) => n.type),
    ['mention', 'comment_reaction', 'revision', 'acting_feedback', 'scene_assignment'],
  );
  assert.equal(notifications[0].metadata?.commentPartId, 'part-bg');
  assert.equal(notifications[0].metadata?.commentSceneId, '1');
  assert.equal(notifications[3].metadata?.sheetName, 'EP01_A_ACT');
  assert.equal(notifications[4].metadata?.assignmentNotificationId, 'dev-preview-assignment');
});

test('notification dropdown exposes a dev-only test alarm generator', () => {
  const panel = readFileSync(path.join(process.cwd(), 'src', 'components', 'NotificationPanel.tsx'), 'utf8');

  assert.match(panel, /isDevPreviewNotificationToolsEnabled/);
  assert.match(panel, /addDevPreviewNotifications\(\)/);
  assert.match(panel, /테스트 알림/);
});
