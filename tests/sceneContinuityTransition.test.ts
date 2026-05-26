import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const readRepoFile = (...segments: string[]) =>
  readFile(path.join(process.cwd(), ...segments), 'utf-8');

test('scene continuity transition animates the real detail modal without graphic ghosts', async () => {
  const transition = await readRepoFile('src', 'components', 'scenes', 'SceneContinuityTransition.tsx');

  assert.match(transition, /buildStartTransform/);
  assert.match(transition, /targetRoot\.animate/);
  assert.match(transition, /bflow-continuity-live-root/);
  assert.doesNotMatch(transition, /buildSkeletonGhost/);
  assert.doesNotMatch(transition, /buildModalShellGhost/);
  assert.doesNotMatch(transition, /animateModalShell/);
  assert.doesNotMatch(transition, /bflow-continuity-modal-shell/);
  assert.doesNotMatch(transition, /bflow-continuity-ghost/);
  assert.doesNotMatch(transition, /\.cloneNode\(/);
  assert.doesNotMatch(transition, /innerText|textContent/);
});

test('unified scene card exposes continuity source anchors for card details', async () => {
  const card = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneCard.tsx');

  assert.match(card, /data-continuity-card/);
  assert.match(card, /data-continuity-source="title"/);
  assert.match(card, /data-continuity-source="storyboard"/);
  assert.match(card, /data-continuity-source="guide"/);
  assert.match(card, /data-continuity-source="bg-memo"/);
  assert.match(card, /data-continuity-source="act-memo"/);
  assert.match(card, /data-continuity-source=\{dept === 'bg' \? 'bg-stage' : 'act-stage'\}/);
  assert.match(card, /data-continuity-stage-segment/);
});

test('unified scene detail modal exposes measured continuity targets', async () => {
  const modal = await readRepoFile('src', 'components', 'scenes', 'UnifiedSceneDetailModal.tsx');

  assert.match(modal, /SceneContinuityTransition/);
  assert.match(modal, /continuitySourceElement/);
  assert.match(modal, /data-continuity-target="title"/);
  assert.match(modal, /data-continuity-target="storyboard"/);
  assert.match(modal, /data-continuity-target="guide"/);
  assert.match(modal, /data-continuity-target-box/);
  assert.match(modal, /continuityTarget="storyboard"/);
  assert.match(modal, /continuityTarget="guide"/);
  assert.match(modal, /data-continuity-target=\{dept === 'bg' \? 'bg-stage' : 'act-stage'\}/);
  assert.match(modal, /data-continuity-stage-segment/);
  assert.match(modal, /continuityTarget=\{dept === 'bg' \? 'bg-memo' : 'act-memo'\}/);
});

test('acting phase toggle exposes continuity stage segments', async () => {
  const phaseToggle = await readRepoFile('src', 'components', 'scenes', 'ScenePhaseToggle.tsx');

  assert.match(phaseToggle, /data-continuity-stage-segment/);
});
