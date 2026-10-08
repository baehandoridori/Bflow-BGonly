import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAccessBackgroundLibrary, canAccessPlayground, resolveAllowedView } from '../src/features/playground/featureFlag.ts';

const hansol = { id: 'fcc4b438-2696-4e88-a03f-d6f34e73e08f', name: '배한솔' };
const previewHansol = { id: '1', name: '배한솔' };
const others = [
  { id: 'a2a5b1c0-0000-4000-8000-000000000001', name: '다른 팀원' },
  { id: 'fcc4b438-2696-4e88-a03f-d6f34e73e08f', name: '이름만 다른 사람' },
  { id: 'a2a5b1c0-0000-4000-8000-000000000002', name: '배한솔' },
  { id: 1, name: '배한솔' },
  null,
  undefined,
];

test('the background library is open to the trial account only, like the playground', () => {
  assert.equal(canAccessBackgroundLibrary(hansol, false), true);
  assert.equal(resolveAllowedView('background-library', hansol, false), 'background-library');
  for (const user of others) {
    assert.equal(canAccessBackgroundLibrary(user as never, false), false);
    assert.equal(resolveAllowedView('background-library', user as never, false), 'dashboard', 'a saved or stale view never lands on the hidden screen');
  }
  // Other screens are untouched by the gate.
  assert.equal(resolveAllowedView('character-board', others[0], false), 'character-board');
  // It follows the playground rule exactly, so both open together.
  for (const user of [hansol, previewHansol, ...others]) {
    for (const preview of [false, true]) assert.equal(canAccessBackgroundLibrary(user as never, preview), canAccessPlayground(user as never, preview));
  }
});

test('the preview account opens it only in explicit preview mode', () => {
  assert.equal(canAccessBackgroundLibrary(previewHansol, false), false);
  assert.equal(canAccessBackgroundLibrary(previewHansol, true), true);
  assert.equal(resolveAllowedView('background-library', previewHansol, true), 'background-library');
  assert.equal(resolveAllowedView('background-library', { id: '1', name: '다른 사용자' }, true), 'dashboard');
});

test('the menu and the routed view both go through the gate', () => {
  const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /item\.id !== 'background-library' \|\| canAccessBackgroundLibrary\(currentUser\)/);
  assert.match(app, /const safeCurrentView = resolveAllowedView\(currentView, currentUser\);/);
  assert.match(app, /switch \(safeCurrentView\)[\s\S]*?case 'background-library':/, 'the screen is rendered from the gated view, not the raw one');
});
