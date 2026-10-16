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

test('the background library is open to everyone signed in (v1.142.0): who may edit is the server\'s to say', () => {
  // Every signed-in member, in the app and in the preview: the menu and the screen. Editing is not decided here.
  for (const user of [hansol, previewHansol, ...others.slice(0, 3)]) {
    for (const preview of [false, true]) {
      assert.equal(canAccessBackgroundLibrary(user, preview), true, `${user.name} ${preview}`);
      assert.equal(resolveAllowedView('background-library', user, preview), 'background-library');
    }
  }
  // No one signed in, or no usable identity: no menu, and a saved or stale view never lands on the screen.
  for (const user of [{ id: 1, name: '배한솔' }, { id: '', name: '빈 아이디' }, { id: 'x' }, null, undefined]) {
    assert.equal(canAccessBackgroundLibrary(user as never, false), false, JSON.stringify(user));
    assert.equal(resolveAllowedView('background-library', user as never, false), 'dashboard');
  }
  // Other screens are untouched by the gate.
  assert.equal(resolveAllowedView('character-board', others[0], false), 'character-board');
});

test('the playground stays the trial account\'s alone: the two gates no longer open together', () => {
  assert.equal(canAccessPlayground(hansol, false), true); assert.equal(canAccessPlayground(previewHansol, true), true);
  for (const user of others) assert.equal(canAccessPlayground(user as never, false), false);
  assert.equal(resolveAllowedView('playground', others[0], false), 'dashboard');
  assert.equal(resolveAllowedView('background-library', others[0], false), 'background-library');
});

test('the menu and the routed view both go through the gate', () => {
  const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /item\.id !== 'background-library' \|\| canAccessBackgroundLibrary\(currentUser\)/);
  assert.match(app, /const safeCurrentView = resolveAllowedView\(currentView, currentUser\);/);
  assert.match(app, /switch \(safeCurrentView\)[\s\S]*?case 'background-library':/, 'the screen is rendered from the gated view, not the raw one');
});
