import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('compositing timeline carousel probe is limited to the visible part progress bar', () => {
  const timeline = readFileSync('src/views/compositing-dashboard/timeline/TimelinePanel.tsx', 'utf8');

  assert.match(timeline, /data-compositing-part-progress-bar="true"/);
  assert.match(timeline, /onMouseMove=\{handleProbeMove\}/);
  assert.match(timeline, /window\.addEventListener\('pointermove', handleDocumentHoverPointerMove/);
  assert.match(timeline, /requestAnimationFrame\(flushDocumentHoverPointerMove\)/);
  assert.match(timeline, /buildTimelineProbeGeometry\(clientX, rect\)/);
  assert.match(timeline, /handleCarouselCardHover\(carousel\.group\.partId, sceneIndex\)/);
  assert.match(timeline, /onPointerEnter=\{\(\) => handleCarouselCardHover\(carousel\.group\.partId, sceneIndex\)\}/);
  assert.match(timeline, /data-compositing-carousel-scene-index=\{sceneIndex\}/);
  assert.match(timeline, /setPinnedScene\(sceneKey\);\s*scheduleProbeClearAfterAction\(\);/);
  assert.match(timeline, /clearProbeNow\(\);\s*setDetailScene\(sceneKey\);/);
  assert.match(timeline, /duration-150 ease-out cursor-pointer/);
  assert.doesNotMatch(timeline, /window\.addEventListener\('pointermove', handleDocumentPointerMove/);
  assert.doesNotMatch(timeline, /window\.addEventListener\('pointermove', handleDocumentCarouselPointerMove/);
  assert.doesNotMatch(timeline, /transition-all duration-500/);
  assert.doesNotMatch(timeline, /className="part-row relative cascade-in"[\s\S]{0,900}onMouseMove=\{handleProbeMove\}/);
});
