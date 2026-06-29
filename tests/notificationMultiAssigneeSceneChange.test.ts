import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');

test('scene change notifications match multi-assignee scene owners', () => {
  assert.match(app, /function isSceneAssignedToUser/);
  assert.match(app, /parseAssigneeList\(scene\.assignee\)\.includes\(userName\)/);
  assert.doesNotMatch(app, /scene\.assignee === me\.name/);

  const usages = app.match(/isSceneAssignedToUser\(scene,\s*me\.name\)/g) ?? [];
  assert.equal(usages.length, 3);
});
