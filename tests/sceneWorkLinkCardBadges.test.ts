import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const unifiedCardSource = readFileSync('src/components/scenes/UnifiedSceneCard.tsx', 'utf-8');
const scenesViewSource = readFileSync('src/views/ScenesView.tsx', 'utf-8');

test('card work-link badges are hover-revealed near the header, not pinned over controls', () => {
  for (const [label, source] of [
    ['unified card', unifiedCardSource],
    ['single-department card', scenesViewSource],
  ] as const) {
    assert.ok(
      source.includes('group-hover:opacity-100'),
      `${label} should reveal work-link badges when the card is hovered`,
    );
    assert.ok(
      source.includes('group-focus-within:opacity-100'),
      `${label} should reveal work-link badges for keyboard focus inside the card`,
    );
    assert.ok(
      source.includes('absolute -top-3 right-3'),
      `${label} should place work-link badges near the card header`,
    );
    assert.doesNotMatch(
      source,
      /SceneWorkLinkBadges[\s\S]{0,180}bottom-2\.5 right-3/,
      `${label} should not pin work-link badges over lower card controls`,
    );
  }
});
