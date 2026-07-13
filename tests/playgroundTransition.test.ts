import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FrameCadenceSampler,
  TransitionCallbackGate,
  getOrCreateParticleBuffers,
  getReducedMotionFrame,
  getParticleBudget,
  getHiddenTransitionAction,
  getTransitionFrame,
  originFromActivation,
  originFromRect,
} from '../src/features/playground/transition/dotWipeMath.ts';
import {
  getPlaygroundMovePlan,
  getDotWipePresentation,
  getPlaygroundNavigationTransition,
} from '../src/features/playground/transition/playgroundTransitionPolicy.ts';
import { usePlaygroundEntryStore } from '../src/features/playground/transition/usePlaygroundEntryStore.ts';

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

test('only game and market entry use target-specific dot wipes', () => {
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-house' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'go-lobby' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'return-to-source' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-game', game: 'snake' }), {
    mode: 'dot', target: 'snake',
  });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-market' }), {
    mode: 'dot', target: 'market',
  });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-account' }), { mode: 'none' });
});

test('house game entry produces one atomic dot request for its source', () => {
  const origin = { x: 73, y: 91 };

  assert.deepEqual(
    getPlaygroundMovePlan(
      { kind: 'house' },
      { kind: 'open-game', game: 'tetris' },
      origin,
    ),
    {
      mode: 'dot',
      request: { origin, target: 'tetris', returnTo: 'house' },
    },
  );
});

test('house entry and source return produce immediate surface routes', () => {
  assert.deepEqual(
    getPlaygroundMovePlan(
      { kind: 'lobby' },
      { kind: 'open-house' },
      { x: 0, y: 0 },
    ),
    { mode: 'surface', route: { kind: 'house' } },
  );
  assert.deepEqual(
    getPlaygroundMovePlan(
      { kind: 'game', game: 'snake', returnTo: 'house' },
      { kind: 'return-to-source' },
      { x: 0, y: 0 },
    ),
    { mode: 'surface', route: { kind: 'house' } },
  );
});

test('market internal movement skips the dot and preserves its return surface', () => {
  assert.deepEqual(
    getPlaygroundMovePlan(
      { kind: 'market', page: { kind: 'home' }, returnTo: 'house' },
      { kind: 'open-stock', stockId: 'jbbj' },
      { x: 0, y: 0 },
    ),
    {
      mode: 'none',
      route: {
        kind: 'market',
        page: { kind: 'stock', stockId: 'jbbj' },
        returnTo: 'house',
      },
    },
  );
});

test('dot target copy and palette are exact', () => {
  const palette = { cover: '#07090d', text: '#ffffff', accent: '#45e0b5' };
  assert.deepEqual(getDotWipePresentation('playground-entry'), {
    eyebrow: null,
    label: '지금은 쉬는 시간!',
    accessibleLabel: '지금은 쉬는 시간!',
    palette,
  });
  assert.deepEqual(getDotWipePresentation('tetris'), {
    eyebrow: 'BAE PLAYGROUND',
    label: 'LOADING TETRIS',
    accessibleLabel: 'BAE PLAYGROUND / LOADING TETRIS',
    palette,
  });
  assert.deepEqual(getDotWipePresentation('snake'), {
    eyebrow: 'BAE PLAYGROUND',
    label: 'LOADING SNAKE',
    accessibleLabel: 'BAE PLAYGROUND / LOADING SNAKE',
    palette,
  });
  assert.deepEqual(getDotWipePresentation('sudoku'), {
    eyebrow: 'BAE PLAYGROUND',
    label: 'LOADING SUDOKU',
    accessibleLabel: 'BAE PLAYGROUND / LOADING SUDOKU',
    palette,
  });
  assert.deepEqual(getDotWipePresentation('market'), {
    eyebrow: 'BAE PLAYGROUND',
    label: 'OPENING JBBJ MARKET',
    accessibleLabel: 'BAE PLAYGROUND / OPENING JBBJ MARKET',
    palette,
  });
});

test('reduced motion is a zero-particle 220ms crossfade', () => {
  assert.equal(getParticleBudget(3840, 2160, true), 0);
  assert.deepEqual(getReducedMotionFrame(0), {
    opacity: 0, shouldCommit: false, shouldFinish: false,
  });
  assert.deepEqual(getReducedMotionFrame(55), {
    opacity: 0.5, shouldCommit: false, shouldFinish: false,
  });
  assert.deepEqual(getReducedMotionFrame(110), {
    opacity: 1, shouldCommit: true, shouldFinish: false,
  });
  assert.deepEqual(getReducedMotionFrame(165), {
    opacity: 0.5, shouldCommit: true, shouldFinish: false,
  });
  assert.deepEqual(getReducedMotionFrame(220), {
    opacity: 0, shouldCommit: true, shouldFinish: true,
  });
});

test('entry request atomically stores origin, target and return surface', () => {
  usePlaygroundEntryStore.setState({ active: null });
  const origin = { x: 73, y: 91 };

  usePlaygroundEntryStore.getState().request(origin);

  const active = usePlaygroundEntryStore.getState().active;
  assert.ok(active);
  assert.deepEqual(active, {
    id: active.id,
    origin,
    target: 'playground-entry',
    returnTo: 'lobby',
  });
  usePlaygroundEntryStore.getState().finish(active.id);
  assert.equal(usePlaygroundEntryStore.getState().active, null);
});

test('Playground controller consumes the executable move plan for dot requests', () => {
  const source = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const moveBody = source.match(
    /const move = \(action: PlaygroundAction, origin\?: Point\) => \{([\s\S]*?)\n  \};/,
  )?.[1] ?? '';

  assert.match(source, /getPlaygroundMovePlan/);
  assert.match(source, /\.\.\.plan\.request/);
  assert.match(source, /pendingAction\.current = action/);
  assert.match(source, /transitionInFlight\.current = true/);
  assert.match(moveBody, /getPlaygroundMovePlan\(\s*routeRef\.current,/);
  assert.match(moveBody, /if \(plan\.mode !== 'dot'\) \{\s*commitNavigation\(action\);/);
  assert.match(moveBody, /if \(transitionInFlight\.current\) return;/);
  assert.ok(
    moveBody.indexOf('if (transitionInFlight.current) return;')
      < moveBody.indexOf('getPlaygroundMovePlan('),
    'the in-flight lock must reject every navigation mode before planning',
  );
  assert.match(
    source,
    /onCovered=\{\(\) => \{[\s\S]*pendingAction\.current[\s\S]*commitNavigation\(action\)/,
  );
  assert.match(
    source,
    /onFinished=\{\(\) => \{\s*pendingAction\.current = null;\s*transitionInFlight\.current = false;\s*setWipe\(null\);/,
  );
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
