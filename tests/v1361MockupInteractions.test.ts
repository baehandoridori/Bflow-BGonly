import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('docs/mockups/v1361-retake-threading-additional-scene.html', 'utf8');

test('v1.36.1 mockup can generate grouped notifications for preview checks', () => {
  assert.match(source, /data-action="add-retake-notification"/);
  assert.match(source, /data-action="add-scene-notification"/);
  assert.match(source, /function renderNotifications/);
  assert.match(source, /notificationGroups/);
});

test('v1.36.1 mockup adds scenes into the visible sorted scene list', () => {
  assert.match(source, /data-action="add-scene"/);
  assert.match(source, /function renderScenes/);
  assert.match(source, /sceneRows/);
  assert.match(source, /sortScenes/);
});

test('v1.36.1 mockup includes card, sheet, and operation plan for two-assignee progress', () => {
  assert.match(source, /data-view="two-card"/);
  assert.match(source, /data-view="two-sheet"/);
  assert.match(source, /data-view="two-plan"/);
  assert.match(source, /전체 씬 조작/);
  assert.match(source, /개별 조작/);
});
