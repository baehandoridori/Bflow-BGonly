import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const imageModal = readFileSync('src/components/scenes/ImageModal.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const annotationCanvas = readFileSync('src/components/scenes/AnnotationCanvas.tsx', 'utf8');

function getLatestImageCallback(source: string): string {
  const match = source.match(/onLatestImageUrlChange=\{\(imageType, url\) => \{[\s\S]*?\n\s+\}\}/);
  assert.ok(match);
  return match[0];
}

test('ImageModal notifies parent detail surfaces when the latest image URL changes', () => {
  assert.match(imageModal, /onLatestImageUrlChange\?: \(imageType: 'storyboard' \| 'guide', url: string\) => void/);
  assert.match(imageModal, /onLatestImageUrlChange\?\.\(imageType, newVer\.url\)/);
  assert.match(imageModal, /onLatestImageUrlChange\?\.\(type, newVer\.url\)/);
  assert.match(imageModal, /onLatestImageUrlChange\?\.\(imageType, latest\?\.url \?\? ''\)/);
  const sceneDetailCallback = getLatestImageCallback(sceneDetailModal);
  const unifiedSceneDetailCallback = getLatestImageCallback(unifiedSceneDetailModal);
  assert.match(sceneDetailModal, /onLatestImageUrlChange=\{\(imageType, url\) => \{/);
  assert.match(sceneDetailCallback, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: url \}\)\)/);
  assert.match(unifiedSceneDetailModal, /onLatestImageUrlChange=\{\(imageType, url\) => \{/);
  assert.match(unifiedSceneDetailCallback, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: url \}\)\)/);
  assert.doesNotMatch(sceneDetailCallback, /onFieldUpdate\(sceneIndex, field, url\)/);
  assert.doesNotMatch(unifiedSceneDetailCallback, /onFieldUpdate\(bgSheetName, bgSceneIndex, field, url\)/);
});

test('AnnotationCanvas handles Ctrl+Z before outer modal shortcuts when not editing text', () => {
  assert.match(annotationCanvas, /e\.key\.toLowerCase\(\) === 'z'/);
  assert.match(annotationCanvas, /e\.stopPropagation\(\)/);
  assert.match(annotationCanvas, /drawingRef\.current = false/);
  assert.match(annotationCanvas, /document\.addEventListener\('keydown', handler, true\)/);
  assert.match(annotationCanvas, /document\.removeEventListener\('keydown', handler, true\)/);
});
