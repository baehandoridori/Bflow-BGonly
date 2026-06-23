import test from 'node:test';
import assert from 'node:assert/strict';
import { createUuid } from '../src/utils/createUuid.ts';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('createUuid uses randomUUID when available', () => {
  const id = createUuid({ randomUUID: () => '11111111-1111-4111-8111-111111111111' });

  assert.equal(id, '11111111-1111-4111-8111-111111111111');
});

test('createUuid falls back to a UUID v4 string without randomUUID', () => {
  const bytes = Array.from({ length: 16 }, (_, index) => index);
  const id = createUuid({
    getRandomValues: (array) => {
      array.set(bytes);
      return array;
    },
  });

  assert.match(id, UUID_V4_RE);
  assert.equal(id, '00010203-0405-4607-8809-0a0b0c0d0e0f');
});
