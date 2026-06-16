import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unifiedSheet = readFileSync('src/components/scenes/UnifiedSceneSheetView.tsx', 'utf8');
const singleSheet = readFileSync('src/components/scenes/SceneSheetView.tsx', 'utf8');
const unifiedCard = readFileSync('src/components/scenes/UnifiedSceneCard.tsx', 'utf8');
const previewSeed = readFileSync('src/mocks/compositingMockSeed.ts', 'utf8');

test('assignee sheet editors keep multi-select draft in sync before closing', () => {
  for (const source of [unifiedSheet, singleSheet]) {
    assert.match(source, /const handleAssigneeChange = useCallback/);
    assert.match(source, /setDraft\(v\)/);
    assert.match(source, /draftRef\.current = v/);
    assert.match(source, /type === 'assignee'/);
  }
});

test('assignee sheet editors do not auto-commit stale draft over multi-select saves', () => {
  for (const source of [unifiedSheet, singleSheet]) {
    assert.match(source, /if \(type === 'assignee'\) \{/);
    assert.match(source, /cancelledRef\.current = false;\s*return;/);
  }
});

test('unified scene cards expose multi-assignees with compact chip overflow', () => {
  assert.match(unifiedCard, /AssigneeChipList/);
  assert.match(unifiedCard, /maxVisible=\{1\}/);
});

test('dev preview includes one two-assignee ACT scene for real app checks', () => {
  assert.match(previewSeed, /assignee: `\$\{actAssignee\}, 강선영`/);
});
