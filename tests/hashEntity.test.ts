import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeHashTag, parseHashTarget } from '../src/utils/hashEntity.ts';

test('serialize scene', () => {
  assert.equal(
    serializeHashTag({ kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001' }),
    '[#a001](bscene:1:A:a001)',
  );
});
test('serialize part / episode', () => {
  assert.equal(serializeHashTag({ kind: 'part', label: 'A파트', episodeNumber: 1, partId: 'A' }), '[#A파트](bpart:1:A)');
  assert.equal(serializeHashTag({ kind: 'episode', label: '친모2', episodeNumber: 2 }), '[#친모2](bepisode:2)');
});
test('parse scene/part/episode target', () => {
  assert.deepEqual(parseHashTarget('bscene:1:A:a001'), { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  assert.deepEqual(parseHashTarget('bpart:12:C'), { kind: 'part', episodeNumber: 12, partId: 'C' });
  assert.deepEqual(parseHashTarget('bepisode:2'), { kind: 'episode', episodeNumber: 2 });
});
test('parse invalid → null', () => {
  assert.equal(parseHashTarget('http://x'), null);
  assert.equal(parseHashTarget('bscene:0:A:a001'), null); // ep<=0
  assert.equal(parseHashTarget('bscene:1:A'), null); // 부족
  assert.equal(parseHashTarget('bpart:1'), null); // partId 없음
  assert.equal(parseHashTarget(''), null);
});
test('roundtrip: serialize → parse', () => {
  const t = { kind: 'scene', label: 'b012', episodeNumber: 3, partId: 'B', sceneId: 'b012' } as const;
  const link = serializeHashTag(t);
  const inner = link.slice(link.indexOf('(') + 1, link.lastIndexOf(')'));
  assert.deepEqual(parseHashTarget(inner), { kind: 'scene', episodeNumber: 3, partId: 'B', sceneId: 'b012' });
});
