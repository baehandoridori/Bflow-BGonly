import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FrameCadenceSampler,
  TransitionCallbackGate,
  getOrCreateParticleBuffers,
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

test('only three consecutive slow RAF intervals trigger degradation', () => {
  const consistentlySlow = new FrameCadenceSampler(100);
  assert.equal(consistentlySlow.sample(125), false);
  assert.equal(consistentlySlow.sample(150), false);
  assert.equal(consistentlySlow.sample(175), true);
  assert.equal(consistentlySlow.sample(205), false);

  const interrupted = new FrameCadenceSampler(100);
  assert.equal(interrupted.sample(125), false);
  assert.equal(interrupted.sample(145), false);
  assert.equal(interrupted.sample(175), false);

  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /new FrameCadenceSampler\(startedAt\)/);
  assert.match(source, /cadenceSampler\.sample\(now\)/);
  assert.doesNotMatch(source, /drawStartedAt/);
});

test('navigation transition owns the topmost body portal layer', () => {
  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /import \{ createPortal \} from 'react-dom';/);
  assert.match(source, /const TRANSITION_LAYER_Z_INDEX = 2147483647;/);
  assert.match(source, /return createPortal\(/);
  assert.match(source, /style=\{\{ zIndex: TRANSITION_LAYER_Z_INDEX \}\}/);
  assert.match(source, /pointer-events-auto/);
  assert.match(source, /document\.body/);
});

test('same request and full budget reuse one typed-array allocation', () => {
  const first = getOrCreateParticleBuffers(null, 17, 4000);
  const replay = getOrCreateParticleBuffers(first, 17, 4000);
  assert.strictEqual(replay, first);
  assert.strictEqual(replay.xs, first.xs);
  assert.equal(replay.delays.length, 4000);

  const resizedBudget = getOrCreateParticleBuffers(first, 17, 5000);
  assert.notStrictEqual(resizedBudget, first);
  assert.equal(resizedBudget.xs.length, 5000);

  const nextRequest = getOrCreateParticleBuffers(first, 18, 4000);
  assert.notStrictEqual(nextRequest, first);

  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /const particleBuffersRef = useRef<ParticleBufferCache \| null>\(null\);/);
  assert.match(source, /getOrCreateParticleBuffers\(particleBuffersRef\.current, request\.id, budget\)/);
});

test('callback gate exposes executable exactly-once state', () => {
  const gate = new TransitionCallbackGate();
  assert.equal(gate.hasCommitted, false);
  assert.equal(gate.hasFinished, false);
  assert.equal(gate.tryCommit(), true);
  assert.equal(gate.tryCommit(), false);
  assert.equal(gate.hasCommitted, true);
  assert.equal(gate.tryFinish(), true);
  assert.equal(gate.tryFinish(), false);
  assert.equal(gate.hasFinished, true);

  const source = readFileSync('src/features/playground/transition/DotWipeTransition.tsx', 'utf8');
  assert.match(source, /new TransitionCallbackGate\(\)/);
  assert.match(source, /callbackGate\.tryCommit\(\)/);
  assert.match(source, /callbackGate\.tryFinish\(\)/);
});
