import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetakeDeepLink, parseBflowDeepLink } from '../src/shared/bflowDeepLink.ts';

test('retake links preserve the exact revision independently of scene or set', () => {
  const id = '74f3eeb3-bc25-442a-a77a-6b4cda85b7bd';
  assert.deepEqual(parseBflowDeepLink(buildRetakeDeepLink(id)), { revisionId: id });
});

test('existing scene links still decode Korean sheet and scene names', () => {
  assert.deepEqual(parseBflowDeepLink('bflow://scene/EP01_A_BG/%EC%94%AC%201'), {
    sheetName: 'EP01_A_BG', sceneId: '씬 1',
  });
});

test('malformed or foreign deep links never become retake navigation', () => {
  for (const url of ['https://retake/abc', 'bflow://retake/', 'bflow://retake/a/b',
    'bflow://retake/%2F', 'bflow://retake/%ZZ', 'bflow://x@retake/a', 'bflow://scene/a']) {
    assert.equal(parseBflowDeepLink(url), null, url);
  }
});
