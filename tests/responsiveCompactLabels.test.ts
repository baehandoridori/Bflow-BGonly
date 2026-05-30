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
  assert.match(source, /data-compact-label-text/);
  assert.match(source, /aria-hidden="true"/);
});

test('compact labels use container queries without writing-mode', () => {
  const css = read('src/index.css');

  assert.match(css, /data-compact-icon-label[\s\S]*container-type:\s*inline-size/);
  assert.match(css, /@container\s*\(max-width:\s*72px\)/);
  assert.match(css, /data-compact-label-text[\s\S]*max-width:\s*0/);
  assert.match(css, /data-sheet-header-short-label/);
  assert.match(css, /data-sheet-header-full-label/);
  assert.doesNotMatch(css, /writing-mode/);
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
    'src/components/scenes/SceneSheetView.tsx',
    'src/components/scenes/UnifiedSceneCard.tsx',
    'src/components/scenes/UnifiedSceneSheetView.tsx',
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

test('sheet headers support full and short labels', () => {
  const resize = read('src/components/scenes/SheetColumnResize.tsx');
  const singleSheet = read('src/components/scenes/SceneSheetView.tsx');
  const unifiedSheet = read('src/components/scenes/UnifiedSceneSheetView.tsx');

  assert.match(resize, /shortLabel\?:/);
  assert.match(resize, /data-sheet-header-full-label/);
  assert.match(resize, /data-sheet-header-short-label/);
  assert.match(resize, /title=\{fullLabel\}/);

  assert.match(singleSheet, /shortLabel="SB"/);
  assert.match(singleSheet, /shortLabel="Guide"/);
  assert.match(singleSheet, /shortLabel="씬"/);
  assert.match(singleSheet, /shortLabel="담"/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*lo:\s*'LO'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*done:\s*'완'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*review:\s*'검'/);
  assert.match(singleSheet, /STAGE_SHORT_LABELS[\s\S]*png:\s*'PNG'/);
  assert.match(unifiedSheet, /shortLabel="BG"/);
  assert.match(unifiedSheet, /shortLabel="ACT"/);
  assert.match(unifiedSheet, /BG_STAGE_SHORT_LABELS[\s\S]*lo:\s*'LO'/);
  assert.match(unifiedSheet, /BG_STAGE_SHORT_LABELS[\s\S]*review:\s*'검'/);
  assert.match(unifiedSheet, /ACT_STAGE_SHORT_LABELS[\s\S]*done:\s*'작'/);
  assert.match(unifiedSheet, /ACT_STAGE_SHORT_LABELS[\s\S]*review:\s*'피'/);
});

test('bulk and card stage controls avoid forced ellipsis overflow', () => {
  const scenesView = read('src/views/ScenesView.tsx');
  const unifiedCard = read('src/components/scenes/UnifiedSceneCard.tsx');

  assert.match(scenesView, /bflow-bulk-bar-pulse[\s\S]*max-w-\[calc\(100vw-2rem\)\][\s\S]*flex-wrap/);
  assert.match(scenesView, /<CompactIconLabel icon=\{stageIcon\(stage, 12\)\}/);
  assert.match(scenesView, /<CompactIconLabel icon=\{phaseIcon\(phase, 12\)\}/);
  assert.doesNotMatch(unifiedCard, /text-ellipsis/);
});
