import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const progressUtilPath = 'src/utils/assigneeProgress.ts';
const stackPath = 'src/components/scenes/AssigneeProgressStack.tsx';

test('two-assignee progress has a metadata-backed normalization utility', () => {
  assert.equal(existsSync(progressUtilPath), true);
  const source = readFileSync(progressUtilPath, 'utf8');
  assert.match(source, /SCENE_ASSIGNEE_PROGRESS_META_TYPE = 'scene-assignee-progress'/);
  assert.match(source, /applyAssigneeProgressMetadata/);
  assert.match(source, /getAssigneeProgressEntries/);
  assert.match(source, /updateAssigneeProgressEntry/);
  assert.match(source, /sceneProgressForAssignee/);
});

test('shared progress stack renders per-assignee controls for cards, sheets, and detail modals', () => {
  assert.equal(existsSync(stackPath), true);
  const source = readFileSync(stackPath, 'utf8');
  assert.match(source, /AssigneeProgressStack/);
  assert.match(source, /onAssigneeStageToggle/);
  assert.match(source, /onAssigneePhaseStateClick/);
  assert.match(source, /onAssigneeFeedbackRequest/);
  assert.match(source, /data-assignee-progress-name/);
});

test('shared progress stack uses compact icon controls and roomier detail controls', () => {
  const source = readFileSync(stackPath, 'utf8');
  assert.match(source, /PHASE_ICON_BY_STATE/);
  assert.match(source, /STAGE_ICON_BY_STAGE/);
  assert.match(source, /data-assignee-progress-controls/);
  assert.match(source, /data-assignee-progress-round/);
  assert.match(source, /aria-label=\{`\$\{entry.name\}/);
  assert.match(source, /compact \? null :/);
  assert.match(source, /grid-cols-4/);
  assert.match(source, /h-6/);
  assert.match(source, /h-9/);
});

test('whole-scene and bulk actions persist all assignee progress together', () => {
  const util = readFileSync(progressUtilPath, 'utf8');
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(util, /updateAllAssigneeProgressEntries/);
  assert.match(scenesView, /bulkAssigneeProgressByUuid/);
  assert.match(scenesView, /writeMetadata\(\s*SCENE_ASSIGNEE_PROGRESS_META_TYPE,\s*uuid,/);
  assert.match(scenesView, /assigneeProgress: nextProgress/);
  assert.match(scenesView, /phasePatch\.assigneeProgress = nextProgress/);
});

test('multi-assignee acting feedback clicks route through the request modal flow', () => {
  const stack = readFileSync(stackPath, 'utf8');
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(stack, /state === 'feedback' && onAssigneeFeedbackRequest/);
  assert.match(scenesView, /handleActFeedbackRequest\(sheetName, sceneId, assigneeName, sceneUuid, sceneIndex\)/);
  assert.match(scenesView, /assigneeName\?: string/);
  assert.match(scenesView, /onAssigneeActFeedbackRequest=\{handleActFeedbackRequest\}/);
  assert.match(scenesView, /dispatchActingFeedbackNotification/);
});

test('loaded assignee progress rehydrates aggregate scene flags for legacy progress surfaces', () => {
  const util = readFileSync(progressUtilPath, 'utf8');

  assert.match(util, /applyAssigneeProgressMetadata/);
  assert.match(util, /aggregateScenePatchFromAssignees\(scene, assigneeProgress, part\.department\)/);
});

test('per-assignee completion boundary changes persist completion metadata', () => {
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(scenesView, /const completionMeta = \(\(\) =>/);
  assert.match(scenesView, /patch\.completedBy = completionMeta\.nextCompletedBy/);
  assert.match(scenesView, /patch\.completedAt = completionMeta\.nextCompletedAt/);
  assert.match(scenesView, /await updateSceneCompletionMeta\(\s*sheetName,\s*sceneIndex,/);
});

test('scene surfaces wire the shared progress stack instead of a single shared control for multi-assignee scenes', () => {
  const files = [
    'src/components/scenes/UnifiedSceneCard.tsx',
    'src/components/scenes/UnifiedSceneSheetView.tsx',
    'src/components/scenes/UnifiedSceneDetailModal.tsx',
    'src/views/ScenesView.tsx',
    'src/components/scenes/SceneSheetView.tsx',
    'src/components/scenes/SceneDetailModal.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /AssigneeProgressStack/, file);
  }
});

test('dev preview seeds two ACT assignees with different progress states', () => {
  const source = readFileSync('src/mocks/compositingMockSeed.ts', 'utf8');
  assert.match(source, /assigneeProgress/);
  assert.match(source, /sceneState: 'work'/);
  assert.match(source, /sceneState: 'wait'/);
});
