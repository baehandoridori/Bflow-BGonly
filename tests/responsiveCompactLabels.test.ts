import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf-8');

test('CompactIconLabel exposes accessible icon and label hooks', () => {
  const componentPath = 'src/components/common/CompactIconLabel.tsx';
  assert.ok(existsSync(componentPath), 'CompactIconLabel component should exist');

  const source = read(componentPath);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{label\}/);
  assert.match(source, /data-compact-icon-label/);
  assert.match(source, /data-compact-label-icon/);
  assert.match(source, /data-compact-label-text/);
  assert.match(source, /data-icon-position=\{iconPosition\}/);
  assert.match(source, /data-display-mode=\{displayMode\}/);
  assert.match(source, /aria-hidden="true"/);
});

test('compact labels collapse at narrow viewport without self-sizing container traps', () => {
  const css = read('src/index.css');
  const component = read('src/components/common/CompactIconLabel.tsx');

  assert.doesNotMatch(css, /\.compact-label-container\s*\{[^}]*container-type/);
  assert.doesNotMatch(css, /\[data-compact-icon-label\]\s*\{[^}]*container-type/);
  assert.doesNotMatch(component, /container-type/);
  assert.match(css, /@media\s*\(max-width:\s*1040px\)/);
  assert.match(css, /@media\s*\(max-width:\s*1040px\)\s*\{[\s\S]*\[data-compact-icon-label\]:not\(\[data-display-mode="icon"\]\)\s+\[data-compact-label-icon\][\s\S]*max-width:\s*0/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*1040px\)\s*\{[\s\S]*\.compact-label-container\s+\[data-compact-label-text\][\s\S]*max-width:\s*0/);
  assert.match(css, /data-sheet-header-short-label/);
  assert.match(css, /data-sheet-header-full-label/);
  assert.doesNotMatch(css, /writing-mode/);
});

test('compact label icon display rule preserves Tailwind hidden utilities', () => {
  const css = read('src/index.css');
  const scenesView = read('src/views/ScenesView.tsx');
  const unifiedCard = read('src/components/scenes/UnifiedSceneCard.tsx');

  assert.match(scenesView, /iconClassName="hidden 2xl:inline-flex"/);
  assert.match(unifiedCard, /iconClassName="hidden 2xl:inline-flex"/);
  assert.doesNotMatch(css, /\[data-compact-label-icon\]\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /\[data-compact-label-icon\]:not\(\.hidden\)\s*\{[\s\S]*display:\s*inline-flex/);
});

test('target dense surfaces import and use CompactIconLabel', () => {
  const surfaces = [
    'src/views/CompositingView.tsx',
    'src/views/compositing/EpisodeGroupSection.tsx',
    'src/views/compositing/ProgressKanbanSection.tsx',
    'src/views/compositing/RevisionItem.tsx',
    'src/views/compositing/RevisionDetailPanel.tsx',
    'src/views/compositing/SceneGroupSection.tsx',
    'src/views/compositing/SceneJumpButton.tsx',
    'src/views/ScenesView.tsx',
    'src/components/scenes/ScenePhaseToggle.tsx',
    'src/components/scenes/StageSegmentToggle.tsx',
    'src/components/scenes/UnifiedSceneCard.tsx',
  ];

  for (const file of surfaces) {
    const source = read(file);
    assert.match(source, /CompactIconLabel/, `${file} should use CompactIconLabel`);
  }
});

test('ScenePhaseToggle maps every phase to a lucide icon label', () => {
  const source = read('src/components/scenes/ScenePhaseToggle.tsx');

  assert.match(source, /Clock/);
  assert.match(source, /LoaderCircle|PlayCircle/);
  assert.match(source, /MessageSquareWarning/);
  assert.match(source, /CheckCircle2/);
  assert.match(source, /<CompactIconLabel[\s\S]*label=\{SCENE_PHASE_LABELS_SHORT\[state\]\}/);
  assert.match(source, /className="w-full"/);
});

test('acting department labels no longer expose deprecated animation stages', () => {
  const source = read('src/types/index.ts');

  assert.match(source, /stageLabels:\s*\{\s*lo:\s*'대기',\s*done:\s*'작업중',\s*review:\s*'피드백',\s*png:\s*'완료'\s*\}/);
});

test('sheet headers support full and short labels', () => {
  const resize = read('src/components/scenes/SheetColumnResize.tsx');
  const singleSheet = read('src/components/scenes/SceneSheetView.tsx');
  const unifiedSheet = read('src/components/scenes/UnifiedSceneSheetView.tsx');

  assert.match(resize, /shortLabel\?:/);
  assert.match(resize, /data-sheet-header-full-label/);
  assert.match(resize, /data-sheet-header-short-label/);
  assert.match(resize, /title=\{fullLabel\}/);
  assert.match(resize, /startBoundaryResize/);
  assert.match(resize, /leftBoundaryColumnKey/);
  assert.match(resize, /rightBoundaryColumnKey/);
  assert.match(resize, /fitSheetColumnWidths/);
  assert.match(resize, /useFittedSheetColumnWidths/);

  assert.match(singleSheet, /shortLabel="SB"/);
  assert.match(singleSheet, /shortLabel="Guide"/);
  assert.match(singleSheet, /shortLabel="씬"/);
  assert.match(singleSheet, /columnKey="alerts"/);
  assert.match(singleSheet, /SINGLE_SHEET_FILL_COLUMNS/);
  assert.match(singleSheet, /sheetOverflowsViewport \? 'overflow-x-auto' : 'overflow-x-hidden'/);
  assert.match(singleSheet, /shortLabel="담"/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*lo:\s*'LO'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*done:\s*'완'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*review:\s*'검'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*png:\s*'PNG'/);
  assert.match(unifiedSheet, /shortLabel="BG"/);
  assert.match(unifiedSheet, /shortLabel="ACT"/);
  assert.match(unifiedSheet, /columnKey="alerts"/);
  assert.match(unifiedSheet, /UNIFIED_SHEET_FILL_COLUMNS/);
  assert.match(unifiedSheet, /sheetOverflowsViewport \? 'overflow-x-auto' : 'overflow-x-hidden'/);
  assert.match(unifiedSheet, /BG_STAGE_SHORT_LABELS[\s\S]*lo:\s*'LO'/);
  assert.match(unifiedSheet, /BG_STAGE_SHORT_LABELS[\s\S]*review:\s*'검'/);
  assert.match(unifiedSheet, /ACT_STAGE_SHORT_LABELS[\s\S]*done:\s*'작'/);
  assert.match(unifiedSheet, /ACT_STAGE_SHORT_LABELS[\s\S]*review:\s*'피'/);
  assert.match(unifiedSheet, /rightBoundaryColumnKey="actMemo"/);
  assert.match(unifiedSheet, /leftBoundaryColumnKey="bgMemo"/);
});

test('bulk and card stage controls avoid forced ellipsis overflow', () => {
  const scenesView = read('src/views/ScenesView.tsx');
  const unifiedCard = read('src/components/scenes/UnifiedSceneCard.tsx');
  const phaseToggle = read('src/components/scenes/ScenePhaseToggle.tsx');
  const stageToggle = read('src/components/scenes/StageSegmentToggle.tsx');
  const labelModeHook = read('src/components/scenes/useStageLabelDisplayMode.ts');
  const revisionFlag = read('src/components/scenes/RevisionCornerFlag.tsx');

  assert.match(scenesView, /bflow-bulk-bar-pulse[\s\S]*max-w-\[calc\(100vw-2rem\)\][\s\S]*flex-wrap/);
  assert.match(scenesView, /compact-label-container[\s\S]*inline-flex[\s\S]*min-w-0[\s\S]*shrink/);
  assert.match(scenesView, /compact-label-container[\s\S]*flex[\s\S]*min-w-0[\s\S]*shrink/);
  assert.doesNotMatch(scenesView, /bflow-bulk-bar-pulse[\s\S]{0,3000}whitespace-nowrap disabled:opacity-50/);
  assert.match(scenesView, /StageSegmentToggle/);
  assert.match(scenesView, /icon=\{stageIcon\(stage, 12\)\}[\s\S]*iconPosition="after"/);
  assert.match(scenesView, /icon=\{phaseIcon\(phase, 12\)\}[\s\S]*iconPosition="after"/);
  assert.match(phaseToggle, /iconDisplay = 'auto'/);
  assert.match(stageToggle, /iconDisplay = 'auto'/);
  assert.match(phaseToggle, /displayMode=\{[\s\S]*modeOf\(state\)/);
  assert.match(stageToggle, /displayMode=\{[\s\S]*modeOf\(stage\)/);
  assert.match(labelModeHook, /ResizeObserver/);
  assert.match(revisionFlag, /revision-corner-flag/);
  assert.doesNotMatch(unifiedCard, /text-ellipsis/);
});

test('compositing and shared dropdown controls use compact or bounded labels', () => {
  const glassDropdown = read('src/components/common/GlassDropdown.tsx');
  const scenesView = read('src/views/ScenesView.tsx');
  const compositingView = read('src/views/CompositingView.tsx');
  const sceneGroupSection = read('src/views/compositing/SceneGroupSection.tsx');
  const dashboardBulkBar = read('src/views/compositing-dashboard/BulkActionBar.tsx');

  assert.match(glassDropdown, /CompactIconLabel/);
  assert.match(glassDropdown, /compact-label-container/);
  assert.match(scenesView, /label="작업자 선택"[\s\S]*icon=\{<UserRound/);
  assert.match(compositingView, /GlassDropdown<SortMode>/);
  assert.doesNotMatch(compositingView, /<select[\s\S]*댓글 많은순[\s\S]*<\/select>/);
  assert.match(sceneGroupSection, /data-episode-filter-label/);
  assert.match(sceneGroupSection, /data-episode-filter-short-label/);
  assert.match(dashboardBulkBar, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(dashboardBulkBar, /overflow-x-auto/);
  assert.match(dashboardBulkBar, /CompactIconLabel/);
});

test('Bflow does not install a custom app cursor', () => {
  const css = read('src/index.css');
  const main = read('src/main.tsx');

  assert.ok(!existsSync('src/components/common/BflowCursorLayer.tsx'));
  assert.doesNotMatch(css, /--bflow-cursor-/);
  assert.doesNotMatch(css, /bflow-custom-cursor-enabled/);
  assert.doesNotMatch(css, /bflow-cursor-layer/);
  assert.doesNotMatch(main, /BflowCursorLayer/);
});
