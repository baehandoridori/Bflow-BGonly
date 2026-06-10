import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('image detail modal closes from empty image-area clicks without closing content clicks', () => {
  const imageModal = readFileSync('src/components/scenes/ImageModal.tsx', 'utf8');

  assert.match(imageModal, /const handleImageAreaClick = \(e: React\.MouseEvent<HTMLDivElement>\) => \{/);
  assert.match(imageModal, /if \(e\.target === e\.currentTarget && !annotateMode\) onClose\(\);/);
  assert.match(imageModal, /onClick=\{handleImageAreaClick\}/);
});

test('attachment image lightbox lets backdrop blank space dismiss while marked content stays open', () => {
  const lightbox = readFileSync('src/components/scenes/AttachmentImageLightbox.tsx', 'utf8');

  assert.match(lightbox, /closest\('\[data-lightbox-keep-open="true"\]'\)/);
  assert.match(lightbox, /data-lightbox-keep-open="true"/);
  assert.doesNotMatch(lightbox, /className="relative w-full h-full flex flex-col cursor-default"\s+onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});
