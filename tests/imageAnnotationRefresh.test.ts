import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const imageModal = readFileSync('src/components/scenes/ImageModal.tsx', 'utf8');
const sceneDetailModal = readFileSync('src/components/scenes/SceneDetailModal.tsx', 'utf8');
const unifiedSceneDetailModal = readFileSync('src/components/scenes/UnifiedSceneDetailModal.tsx', 'utf8');
const annotationCanvas = readFileSync('src/components/scenes/AnnotationCanvas.tsx', 'utf8');

function getLatestImageCallback(source: string): string {
  const match = source.match(/const applyLatestImageUrl = useCallback\([\s\S]*?\n\s+\);/);
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
  assert.match(sceneDetailModal, /onLatestImageUrlChange=\{applyLatestImageUrl\}/);
  assert.match(sceneDetailCallback, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: url \}\)\)/);
  assert.match(sceneDetailCallback, /updateSceneByUuid\(sceneUuid, patch\)/);
  assert.match(sceneDetailCallback, /updateSceneFieldInSupabase\(sceneUuid, field, url\)/);
  assert.match(unifiedSceneDetailModal, /onLatestImageUrlChange=\{applyLatestImageUrl\}/);
  assert.match(unifiedSceneDetailCallback, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: url \}\)\)/);
  assert.match(unifiedSceneDetailCallback, /updateSceneByUuid\(sceneUuid, patch\)/);
  assert.match(unifiedSceneDetailCallback, /updateSceneFieldInSupabase\(sceneUuid, field, url\)/);
  assert.doesNotMatch(sceneDetailCallback, /onFieldUpdate\(sceneIndex, field, url\)/);
  assert.doesNotMatch(unifiedSceneDetailCallback, /onFieldUpdate\(bgSheetName, bgSceneIndex, field, url\)/);
  assert.match(sceneDetailModal, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[deleteConfirm\]: '' \}\)\)/);
  assert.match(unifiedSceneDetailModal, /setLatestImageUrls\(\(prev\) => \(\{ \.\.\.prev, \[imageType\]: '' \}\)\)/);
  assert.match(sceneDetailModal, /\[scene\.storyboardUrl, scene\.guideUrl\]/);
  assert.match(unifiedSceneDetailModal, /\[bgScene\?\.storyboardUrl, bgScene\?\.guideUrl\]/);
});

test('AnnotationCanvas handles Ctrl+Z before outer modal shortcuts when not editing text', () => {
  assert.match(annotationCanvas, /e\.key\.toLowerCase\(\) === 'z'/);
  assert.match(annotationCanvas, /e\.stopPropagation\(\)/);
  assert.match(annotationCanvas, /drawingRef\.current = false/);
  assert.match(annotationCanvas, /document\.addEventListener\('keydown', handler, true\)/);
  assert.match(annotationCanvas, /document\.removeEventListener\('keydown', handler, true\)/);
});
