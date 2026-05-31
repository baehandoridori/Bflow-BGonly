import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scenesViewSource = readFileSync('src/views/ScenesView.tsx', 'utf-8');
const sceneSheetViewSource = readFileSync('src/components/scenes/SceneSheetView.tsx', 'utf-8');

test('ACT-only sheet view is wired to the new acting phase controls', () => {
  assert.match(sceneSheetViewSource, /import\s+\{\s*ScenePhaseToggle\s*\}/);
  assert.match(sceneSheetViewSource, /onActPhaseStateClick\?:/);
  assert.match(sceneSheetViewSource, /onActFeedbackRequest\?:/);
  assert.match(sceneSheetViewSource, /onActRoundBump\?:/);
  assert.match(sceneSheetViewSource, /department === 'acting'/);
});

test('ACT-only card view receives and renders the new acting phase controls', () => {
  assert.match(scenesViewSource, /onActPhaseStateClick\?:/);
  assert.match(scenesViewSource, /<ScenePhaseToggle[\s\S]*?onStateClick=\{\(next\) => onActPhaseStateClick/);
  assert.match(scenesViewSource, /onActPhaseStateClick=\{handleActPhaseStateClick\}/g);
  assert.match(scenesViewSource, /onActFeedbackRequest=\{handleActFeedbackRequest\}/g);
  assert.match(scenesViewSource, /onActRoundBump=\{handleActRoundBump\}/g);
});
