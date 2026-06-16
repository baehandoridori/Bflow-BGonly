import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('complete overlay can undo the exact last completion action', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /마지막 체크 취소/);
  assert.match(scenesView, /lastCompletionUndoAction/);
  assert.match(scenesView, /skipCompletionUndoCapture/);
  assert.match(scenesView, /setLastCompletionUndoAction\(\{\s*kind: 'stage'/);
  assert.match(scenesView, /setLastCompletionUndoAction\(\{\s*kind: 'phase'/);
  assert.match(scenesView, /previousState: ScenePhaseState/);
  assert.match(scenesView, /updateScenePhaseInSupabase\(/);
  assert.match(scenesView, /updateSceneCompletionMeta\(/);
});

test('complete overlay stays centered in the viewport and can be hidden', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /dismissedCompletionOverlayKey/);
  assert.match(scenesView, /showCompletionRestoreButton/);
  assert.match(scenesView, /onDismiss/);
  assert.match(scenesView, /className="fixed inset-0 z-\[60\] pointer-events-none/);
  assert.match(scenesView, /items-center justify-center/);
  assert.match(scenesView, /aria-label="완료 안내 숨기기"/);
  assert.match(scenesView, /aria-label="완료 안내 다시 보기"/);
  assert.match(scenesView, /완료 안내 다시 보기/);
  assert.match(scenesView, /setDismissedCompletionOverlayKey\(completionOverlayKey\)/);
  assert.match(scenesView, /setDismissedCompletionOverlayKey\(null\)/);
  assert.doesNotMatch(scenesView, /completionOverlayFrameStyle/);
  assert.doesNotMatch(scenesView, /className="sticky top-0 z-20 pointer-events-none overflow-hidden rounded-\[28px\]"/);
  assert.doesNotMatch(scenesView, /className="absolute bottom-4 left-4 right-4"/);
});

test('completion overlay uses the whole current part instead of the filtered visible list', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /const partCompletionState = useMemo/);
  assert.match(scenesView, /getAllViewCompletionState\(allMergedScenes\)/);
  assert.match(scenesView, /getSingleViewCompletionState\(currentPart\?\.scenes \?\? \[\]\)/);
  assert.doesNotMatch(scenesView, /getAllViewCompletionState\(mergedScenes\)/);
  assert.doesNotMatch(scenesView, /getSingleViewCompletionState\(scenes\)/);
});

test('completion celebration targets the exact sheet scene instead of every matching scene id', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const confetti = await readRepoFile('src', 'components', 'ui', 'Confetti.tsx');

  assert.match(scenesView, /type CompletionCelebrationTarget/);
  assert.match(scenesView, /sceneUuid\?: string \| null/);
  assert.match(scenesView, /setCelebratingTarget\(buildCompletionTarget\(sheetName, scene, sceneIndex\)\)/);
  assert.match(scenesView, /function matchesMergedSceneCelebration/);
  assert.match(scenesView, /target\.sheetName === bgSheetName/);
  assert.match(scenesView, /target\.sheetName === actSheetName/);
  assert.match(confetti, /completeRef/);
  assert.match(confetti, /\}, \[active\]\);/);
});

test('completion celebration clears independently of card confetti remounts', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');

  assert.match(scenesView, /window\.setTimeout\(\(\) => setCelebratingTarget\(null\), 1600\)/);
  assert.match(scenesView, /\[selectedEpisode, selectedPart, selectedDepartment, sceneViewMode, statusFilter, searchQuery, selectedAssignee\]/);
  assert.match(scenesView, /buildSceneCardKey/);
  assert.doesNotMatch(scenesView, /\$\{scene\.sceneId\}-\$\{idx\}/);
});

test('completion tint is a default-on setting persisted in scene UI preferences', async () => {
  const appStore = await readRepoFile('src', 'stores', 'useAppStore.ts');
  const settingsService = await readRepoFile('src', 'services', 'settingsService.ts');
  const effectsSection = await readRepoFile('src', 'components', 'settings', 'EffectsSection.tsx');
  const app = await readRepoFile('src', 'App.tsx');

  assert.match(appStore, /completionTintEnabled: true/);
  assert.match(appStore, /setCompletionTintEnabled/);
  assert.match(settingsService, /completionTintEnabled\?: boolean/);
  assert.match(effectsSection, /씬 완료 색상 표시/);
  assert.match(effectsSection, /persistSceneUi\(\{ completionTintEnabled: enabled \}\)/);
  assert.match(app, /sceneUi\?\.completionTintEnabled \?\? true/);
});

test('card and sheet views use completion tint classes', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const unifiedCard = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneCard.tsx');
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');
  const css = await readRepoFile('src', 'index.css');

  assert.match(scenesView, /scene-completion-tint-card/);
  assert.match(unifiedCard, /isMergedComplete/);
  assert.match(unifiedCard, /scene-completion-tint-card/);
  assert.match(unifiedCard, /scene-completion-dept-done/);
  assert.match(singleSheet, /scene-completion-tint-row/);
  assert.match(unifiedSheet, /scene-completion-tint-row/);
  assert.match(css, /\.scene-completion-tint-card/);
  assert.match(css, /\.scene-completion-tint-row/);
});

test('sheet percentage columns are removed and main columns are resizable', async () => {
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');
  const resize = await readRepoFile('src', 'components', 'scenes', 'SheetColumnResize.tsx');

  assert.match(singleSheet, /ResizableHeaderCell/);
  assert.match(singleSheet, /bflow_scene_sheet_columns_\$\{department\}_v1/);
  assert.doesNotMatch(singleSheet, />진행</);
  assert.doesNotMatch(singleSheet, /SheetProgressCell|sceneProgress|progressGradient/);

  assert.match(unifiedSheet, /ResizableHeaderCell/);
  assert.match(unifiedSheet, /bflow_unified_scene_sheet_columns_v1/);
  assert.doesNotMatch(unifiedSheet, />BG%</);
  assert.doesNotMatch(unifiedSheet, />ACT%</);
  assert.doesNotMatch(unifiedSheet, />합계</);
  assert.doesNotMatch(unifiedSheet, /SheetProgressCell|sceneProgress|progressGradient/);

  assert.match(resize, /localStorage\.setItem/);
  assert.match(resize, /role="separator"/);
  assert.match(resize, /onPointerDown/);
});

test('sheet resize fits the table but restores horizontal access below minimum width', async () => {
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');

  for (const source of [singleSheet, unifiedSheet]) {
    assert.match(source, /useFittedSheetColumnWidths/);
    assert.match(source, /style=\{\{\s*tableLayout:\s*'fixed',\s*width:\s*sheetWidth\s*\}\}/);
    assert.match(source, /const sheetOverflowsViewport = tableViewportWidth > 0 && sheetWidth > tableViewportWidth \+ 1;/);
    assert.match(source, /sheetOverflowsViewport \? 'overflow-x-auto' : 'overflow-x-hidden'/);
    assert.match(source, /'overflow-y-auto rounded-lg border border-bg-border focus:outline-none'/);
    assert.doesNotMatch(source, /className="w-full text-sm border-collapse"/);
    assert.doesNotMatch(source, /className="overflow-auto rounded-lg/);
    assert.doesNotMatch(source, /overflow-y-auto overflow-x-hidden rounded-lg/);
    assert.doesNotMatch(source, /minWidth:\s*sheetWidth/);
  }
});

test('sheet resize preserves direct drag widths after a user customizes columns', async () => {
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');
  const resize = await readRepoFile('src', 'components', 'scenes', 'SheetColumnResize.tsx');

  assert.match(resize, /enabled\s*=\s*true/);
  assert.match(resize, /hasCustomWidths/);
  assert.match(resize, /setHasCustomWidths\(true\)/);
  assert.match(resize, /visualStartWidths\?: Partial<Record<K, number>>/);
  assert.match(resize, /buildContainedResizeWidths/);
  assert.match(resize, /getResizeCompensationKeys/);
  assert.match(resize, /latestWidths/);
  assert.match(resize, /fitSheetColumnWidths\(columns, baseWidths, viewportWidth, fillColumnKeys, enabled\)/);

  for (const source of [singleSheet, unifiedSheet]) {
    assert.match(source, /hasCustomWidths/);
    assert.match(source, /handleResizeStart/);
    assert.match(source, /fittedSheet\.widths/);
    assert.doesNotMatch(source, /!hasCustomWidths/);
  }
});

test('sheet stage resize handles adjust only adjacent stage columns', async () => {
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');

  assert.match(singleSheet, /startBoundaryResize/);
  assert.match(singleSheet, /const nextStage = STAGES\[index \+ 1\];/);
  assert.match(singleSheet, /rightBoundaryColumnKey=\{nextStage\}/);
  assert.match(singleSheet, /rightBoundaryWidth=\{nextStage \? displayWidthOf\(nextStage\) : undefined\}/);
  assert.match(singleSheet, /onBoundaryResizeStart=\{nextStage \? handleBoundaryResizeStart : undefined\}/);

  assert.match(unifiedSheet, /function getBgStageColumnKey\(stage: Stage\): UnifiedSheetColumnKey/);
  assert.match(unifiedSheet, /function getActStageColumnKey\(stage: Stage\): UnifiedSheetColumnKey/);
  assert.match(unifiedSheet, /const nextKey = nextStage \? getBgStageColumnKey\(nextStage\) : undefined;/);
  assert.match(unifiedSheet, /const nextKey = nextStage \? getActStageColumnKey\(nextStage\) : undefined;/);
  assert.match(unifiedSheet, /rightBoundaryColumnKey=\{nextKey\}/);
  assert.match(unifiedSheet, /rightBoundaryWidth=\{nextKey \? displayWidthOf\(nextKey\) : undefined\}/);
  assert.match(unifiedSheet, /onBoundaryResizeStart=\{nextKey \? handleBoundaryResizeStart : undefined\}/);
});

test('scene top progress bar uses the polished progress track styles', async () => {
  const scenesView = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const css = await readRepoFile('src', 'index.css');

  assert.match(scenesView, /scene-top-progress-track/);
  assert.match(scenesView, /scene-top-progress-fill/);
  assert.match(css, /\.scene-top-progress-track/);
  assert.match(css, /scene-progress-sheen/);
});

test('stage and phase controls commit on pointer down in card and sheet views', async () => {
  const phaseToggle = await readRepoFile('src', 'components', 'scenes', 'ScenePhaseToggle.tsx');
  const unifiedCard = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneCard.tsx');
  const singleCard = await readRepoFile('src', 'views', 'ScenesView.tsx');
  const singleSheet = await readRepoFile('src', 'components', 'scenes', 'SceneSheetView.tsx');
  const unifiedSheet = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneSheetView.tsx');
  const stageToggle = await readRepoFile('src', 'components', 'scenes', 'StageSegmentToggle.tsx');

  assert.match(phaseToggle, /handleChipPointerDown/);
  assert.match(phaseToggle, /pointerHandledRef/);
  assert.match(phaseToggle, /onPointerDown=\{\(e\) => handleChipPointerDown\(e, state\)\}/);

  assert.match(stageToggle, /onPointerDown=\{\(e\) => \{/);
  assert.match(stageToggle, /pointerHandledRef/);
  assert.match(stageToggle, /onToggle\(stage\)/);

  assert.match(unifiedCard, /StageSegmentToggle/);
  assert.match(unifiedCard, /onToggle\(sheetName, sceneId, stage, scene\.id \?\? null, sceneIndex\)/);

  assert.match(singleCard, /StageSegmentToggle/);
  assert.match(singleCard, /onToggle\(scene\.sceneId, stage, scene\.id \?\? null, sceneIndex\)/);

  assert.match(singleSheet, /StageSegmentToggle/);
  assert.match(singleSheet, /onToggle\(scene\.sceneId, stage, scene\.id \?\? null, idx\)/);

  assert.match(unifiedSheet, /StageSegmentToggle/);
  assert.match(unifiedSheet, /onToggle\(bgSheetName, bgScene\.sceneId, stage, bgScene\.id \?\? null, bgSceneIndex\)/);
  assert.match(unifiedSheet, /onToggle\(actSheetName, actScene\.sceneId, stage, actScene\.id \?\? null, actSceneIndex\)/);
});

test('dev preview mock scenes include stable UUIDs for real toggle flow', async () => {
  const mockSeed = await readRepoFile('src', 'mocks', 'compositingMockSeed.ts');

  assert.match(mockSeed, /id: `mock-scene-\$\{uuidSeed\}`/);
  assert.match(mockSeed, /`EP05-\$\{partId\}-BG-\$\{sid\}`/);
  assert.match(mockSeed, /`EP05-\$\{partId\}-ACT-\$\{sid\}`/);
});
