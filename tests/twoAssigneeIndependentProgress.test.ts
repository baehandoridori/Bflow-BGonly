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
  assert.match(scenesView, /writeAssigneeProgressMetadata\(uuid, patch\.assigneeProgress\)/);
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
  const service = readFileSync('src/services/supabaseService.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  assert.match(util, /applyAssigneeProgressMetadata/);
  assert.match(util, /aggregateScenePatchFromAssignees\(scene, assigneeProgress, part\.department\)/);
  assert.match(service, /export async function readAll\(\): Promise<Episode\[]> \{[\s\S]*readAllMetadataFromSupabase\(\)[\s\S]*applyAssigneeProgressMetadata\(episodes, metadata\)/);
  assert.match(app, /const episodes = await readAll\(\);/);
});

test('stale assignee metadata is ignored once a scene no longer has multiple assignees', () => {
  const util = readFileSync(progressUtilPath, 'utf8');

  assert.match(util, /if \(names\.length <= 1\) return \{\};/);
  assert.match(util, /parseAssigneeNames\(scene\.assignee\)\.length <= 1/);
  assert.match(util, /sceneWithoutStaleAssigneeProgress/);
});

test('acting aggregate rounds come from the assignee state that determines the bottleneck', () => {
  const util = readFileSync(progressUtilPath, 'utf8');

  assert.match(util, /const roundSourceEntries = entries\.filter\(\(entry\) => entry\.state === lowestState\)/);
  assert.match(util, /const maxRoundFor = \(key: 'workRound' \| 'feedbackRound'\) =>/);
  assert.match(util, /const shouldResetRounds = lowestState === 'wait' \|\| lowestState === 'done'/);
  assert.match(util, /workRound: shouldResetRounds \? 0 : maxRoundFor\('workRound'\)/);
  assert.doesNotMatch(util, /assigneeProgress\[names\[0\]\]\?\.workRound/);
});

test('per-assignee completion boundary changes persist completion metadata', () => {
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(scenesView, /const completionMeta = \(\(\) =>/);
  assert.match(scenesView, /patch\.completedBy = completionMeta\.nextCompletedBy/);
  assert.match(scenesView, /patch\.completedAt = completionMeta\.nextCompletedAt/);
  assert.match(scenesView, /await updateSceneCompletionMeta\(\s*sheetName,\s*sceneIndex,/);
});

test('per-assignee progress metadata writes are serialized per scene', () => {
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(scenesView, /assigneeProgressWriteQueueRef/);
  assert.match(scenesView, /queues\.get\(sceneUuid\) \?\? Promise\.resolve\(\)/);
  assert.match(scenesView, /const run = previous\.catch\(\(\) => undefined\)\.then\(task\)/);
  assert.match(scenesView, /writeAssigneeProgressMetadata\(sceneUuid, nextProgress\)/);
  assert.match(scenesView, /assigneeProgressMutationSeqRef/);
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

test('detail modals only show per-assignee controls when update handlers are available', () => {
  const files = [
    'src/components/scenes/UnifiedSceneDetailModal.tsx',
    'src/components/scenes/SceneDetailModal.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /const canUseAssigneeProgressStack = hasMultiAssigneeProgress\(scene\)/, file);
    assert.match(source, /onAssigneeActPhaseStateClick && onAssigneeActFeedbackRequest && onAssigneeActRoundBump/, file);
    assert.match(source, /\{canUseAssigneeProgressStack \? \(/, file);
  }
});

test('dev preview seeds two ACT assignees with different progress states', () => {
  const source = readFileSync('src/mocks/compositingMockSeed.ts', 'utf8');
  assert.match(source, /assigneeProgress/);
  assert.match(source, /sceneState: 'work'/);
  assert.match(source, /sceneState: 'wait'/);
});

test('assignee filter applies status chips to the selected assignee progress', () => {
  const util = readFileSync(progressUtilPath, 'utf8');
  const scenesView = readFileSync('src/views/ScenesView.tsx', 'utf8');

  assert.match(util, /matchesAssigneeStatusFilter/);
  assert.match(scenesView, /matchesAssigneeStatusFilter\(s,\s*statusFilter,\s*selectedAssignee\)/);
  assert.match(scenesView, /mergedMatchesStatusFilter\(merged,\s*statusFilter,\s*selectedAssignee\)/);
  assert.match(scenesView, /matchesAssigneeStatusFilter\(scene,\s*statusFilter,\s*selectedAssignee\)/);
});
