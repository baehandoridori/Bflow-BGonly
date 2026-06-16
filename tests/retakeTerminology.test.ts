import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSources = [
  'src/App.tsx',
  'src/components/NotificationPanel.tsx',
  'src/components/scenes/CommentPanel.tsx',
  'src/components/scenes/RevisionCornerFlag.tsx',
  'src/components/scenes/RevisionPanel.tsx',
  'src/components/scenes/UnifiedSceneCard.tsx',
  'src/components/scenes/UnifiedSceneDetailModal.tsx',
  'src/stores/useNotificationStore.ts',
  'src/utils/devPreviewNotifications.ts',
  'src/utils/notificationSceneAction.ts',
  'src/views/CompositingView.tsx',
  'src/views/compositing/NewRevisionModal.tsx',
  'src/views/compositing/RevisionDetailPanel.tsx',
  'src/views/compositing/RevisionItem.tsx',
  'src/views/compositing/SceneGroupSection.tsx',
].map((file) => [file, readFileSync(file, 'utf8')] as const);

test('major user-facing retake surfaces no longer expose old revision wording', () => {
  for (const [file, source] of uiSources) {
    assert.doesNotMatch(source, />[^<]*리비전[^<]*</, `${file} still renders 리비전 text`);
    assert.doesNotMatch(source, /['"`][^'"`]*리비전[^'"`]*['"`]/, `${file} still has 리비전 string literals`);
    assert.doesNotMatch(source, />[^<]*피드백 허브[^<]*</, `${file} still renders 피드백 허브 text`);
    assert.doesNotMatch(source, /['"`][^'"`]*피드백 허브[^'"`]*['"`]/, `${file} still has 피드백 허브 string literals`);
  }
}
);

test('retake replacement labels are present in the main UI surfaces', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const compositing = readFileSync('src/views/CompositingView.tsx', 'utf8');
  const commentPanel = readFileSync('src/components/scenes/CommentPanel.tsx', 'utf8');

  assert.match(app, /리테이크/);
  assert.match(compositing, /리테이크 허브/);
  assert.match(commentPanel, /리테이크 빠른 등록/);
});
