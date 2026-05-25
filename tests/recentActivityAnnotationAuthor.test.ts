import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8');
}

test('annotation image updates are first-class memo activity types', () => {
  const srcTypes = read('src/types/index.ts');
  const electronTypes = read('electron/supabase.ts');
  const constants = read('src/components/widgets/activity/constants.ts');
  const feed = read('src/components/widgets/activity/ActivityFeed.tsx');
  const labels = read('src/components/scenes/activityLabels.ts');
  const main = read('electron/main.ts');

  for (const source of [srcTypes, electronTypes]) {
    assert.match(source, /'image_annotate_storyboard'/);
    assert.match(source, /'image_annotate_guide'/);
  }

  assert.match(constants, /image_annotate_storyboard:\s*'memo'/);
  assert.match(constants, /image_annotate_guide:\s*'memo'/);
  assert.match(constants, /image_annotate_storyboard:\s*'스토리보드 주석 업데이트'/);
  assert.match(constants, /image_annotate_guide:\s*'가이드 주석 업데이트'/);

  assert.match(feed, /case 'image_annotate_storyboard':/);
  assert.match(feed, /case 'image_annotate_guide':/);
  assert.match(labels, /case 'image_annotate_storyboard':/);
  assert.match(labels, /case 'image_annotate_guide':/);

  assert.match(main, /params\.kind === 'annotate'/);
  assert.match(main, /image_annotate_storyboard/);
  assert.match(main, /image_annotate_guide/);
});

test('scene memo rows expose latest memo author metadata', () => {
  const unifiedModal = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
  const singleModal = read('src/components/scenes/SceneDetailModal.tsx');
  const helper = read('src/components/scenes/memoAuthorMeta.ts');

  assert.match(helper, /findLatestMemoActivity/);
  assert.match(helper, /actionType === 'memo_update'/);

  assert.match(unifiedModal, /memoAuthorMeta/);
  assert.match(unifiedModal, /findLatestMemoActivity/);
  assert.match(singleModal, /memoAuthorMeta/);
  assert.match(singleModal, /findLatestMemoActivity/);
});
