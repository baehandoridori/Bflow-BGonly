import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getParticleBudget,
  getHiddenTransitionAction,
  getTransitionFrame,
  originFromActivation,
  originFromRect,
} from '../src/features/playground/transition/dotWipeMath.ts';

test('sidebar button center becomes the particle origin', () => {
  assert.deepEqual(originFromRect({ left: 10, top: 20, width: 40, height: 30 }), { x: 30, y: 35 });
  assert.deepEqual(originFromActivation(73, 91, 1, { left: 10, top: 20, width: 40, height: 30 }), { x: 73, y: 91 });
  assert.deepEqual(originFromActivation(0, 0, 0, { left: 10, top: 20, width: 40, height: 30 }), { x: 30, y: 35 });
});

test('dot transition covers once before revealing', () => {
  assert.deepEqual(getTransitionFrame(0), { phase: 'covering', progress: 0, shouldCommit: false });
  assert.deepEqual(getTransitionFrame(500), { phase: 'revealing', progress: 0, shouldCommit: true });
  assert.equal(getTransitionFrame(750).shouldCommit, true);
  assert.deepEqual(getTransitionFrame(1200), { phase: 'finished', progress: 1, shouldCommit: false });
});

test('particle budget is capped and reduced motion creates no particles', () => {
  assert.equal(getParticleBudget(3840, 2160, true), 0);
  assert.ok(getParticleBudget(3840, 2160, false) <= 12000);
  assert.ok(getParticleBudget(1280, 720, false) >= 4000);
});

test('a hidden window fast-forwards instead of abandoning an active overlay', () => {
  assert.deepEqual(getHiddenTransitionAction(false), { commit: true, finish: true });
  assert.deepEqual(getHiddenTransitionAction(true), { commit: false, finish: true });
});

test('a stalled final frame commits before finishing the overlay', () => {
  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  const finishedBranch = source.match(/if \(frame\.phase === 'finished'\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  assert.match(finishedBranch, /commitOnce\(\);[\s\S]*finishOnce\(\);/);
});

test('same-request effect replay preserves the exactly-once guards', () => {
  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /const initializedRequestIdRef = useRef<number \| null>\(null\);/);
  assert.match(
    source,
    /if \(initializedRequestIdRef\.current !== request\.id\) \{\s*initializedRequestIdRef\.current = request\.id;\s*committedRef\.current = false;\s*finishedRef\.current = false;\s*\}/,
  );
});

test('viewport and DPR changes relayout the existing particle buffers', () => {
  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /const updateCanvasLayout = \(\) => \{/);
  assert.match(source, /dpr = Math\.min\(window\.devicePixelRatio \|\| 1, MAX_DPR\);/);
  assert.match(source, /updateParticleLayout\(\);/);
  assert.match(source, /window\.addEventListener\('resize', handleViewportChange\);/);
  assert.match(source, /resolutionQuery\.addEventListener\('change', handleResolutionChange\);/);
  assert.match(source, /window\.removeEventListener\('resize', handleViewportChange\);/);
});
