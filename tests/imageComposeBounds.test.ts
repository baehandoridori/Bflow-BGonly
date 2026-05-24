import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateAnnotationExportBounds } from '../src/utils/imageCompose.ts';

test('annotation export bounds preserve drawings outside the original image', () => {
  const bounds = calculateAnnotationExportBounds(
    { width: 1600, height: 900 },
    { imgX: 300, imgY: 150, imgW: 1000, imgH: 600 },
    { x: 1200, y: 700, width: 140, height: 80 },
  );

  assert.deepEqual(bounds, { x: 300, y: 150, width: 1040, height: 630 });
});

test('annotation export bounds include transparent space before the image when needed', () => {
  const bounds = calculateAnnotationExportBounds(
    { width: 1600, height: 900 },
    { imgX: 300, imgY: 150, imgW: 1000, imgH: 600 },
    { x: 120, y: 80, width: 100, height: 100 },
  );

  assert.deepEqual(bounds, { x: 120, y: 80, width: 1180, height: 670 });
});

test('annotation export bounds fall back to the original image when no annotation pixels are found', () => {
  const bounds = calculateAnnotationExportBounds(
    { width: 1600, height: 900 },
    { imgX: 300, imgY: 150, imgW: 1000, imgH: 600 },
    null,
  );

  assert.deepEqual(bounds, { x: 300, y: 150, width: 1000, height: 600 });
});
