import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeHashTag, parseHashTarget } from '../src/utils/hashEntity.ts';
import { tokenizeEntities } from '../src/utils/entityTokens.ts';

test('serialize scene', () => {
  assert.equal(
    serializeHashTag({ kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001' }),
    '[#a001](bscene:1:A:a001)',
  );
});
test('serialize scene + uuid', () => {
  assert.equal(
    serializeHashTag({ kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001', sceneUuid: 'uuid-xyz' }),
    '[#a001](bscene:1:A:a001:uuid-xyz)',
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
test('parse scene + uuid target (5 seg)', () => {
  assert.deepEqual(parseHashTarget('bscene:1:A:a001:uuid-xyz'), { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001', sceneUuid: 'uuid-xyz' });
});
test('parse 구형 scene 태그(uuid 없음, 4 seg) 도 여전히 OK', () => {
  assert.deepEqual(parseHashTarget('bscene:3:B:b012'), { kind: 'scene', episodeNumber: 3, partId: 'B', sceneId: 'b012' });
});
test('parse invalid → null', () => {
  assert.equal(parseHashTarget('http://x'), null);
  assert.equal(parseHashTarget('bscene:0:A:a001'), null); // ep<=0
  assert.equal(parseHashTarget('bscene:1:A'), null); // 부족
  assert.equal(parseHashTarget('bpart:1'), null); // partId 없음
  assert.equal(parseHashTarget(''), null);
  assert.equal(parseHashTarget('bepisode:1abc'), null); // ep 접두사 숫자 거부(손편집)
  assert.equal(parseHashTarget('bscene:1x:A:a001'), null); // ep 접두사 숫자 거부
});
test('roundtrip: serialize → parse', () => {
  const t = { kind: 'scene', label: 'b012', episodeNumber: 3, partId: 'B', sceneId: 'b012' } as const;
  const link = serializeHashTag(t);
  const inner = link.slice(link.indexOf('(') + 1, link.lastIndexOf(')'));
  assert.deepEqual(parseHashTarget(inner), { kind: 'scene', episodeNumber: 3, partId: 'B', sceneId: 'b012' });
});
test('roundtrip: serialize → parse (uuid 보존)', () => {
  const t = { kind: 'scene', label: 'b012', episodeNumber: 3, partId: 'B', sceneId: 'b012', sceneUuid: 'u-99' } as const;
  const link = serializeHashTag(t);
  const inner = link.slice(link.indexOf('(') + 1, link.lastIndexOf(')'));
  assert.deepEqual(parseHashTarget(inner), { kind: 'scene', episodeNumber: 3, partId: 'B', sceneId: 'b012', sceneUuid: 'u-99' });
});
test('label escape: 라벨에 []() 포함 시 토큰이 깨지지 않음', () => {
  // free-form 라벨(커스텀 화 제목)에 마크다운 특수문자가 들어가도 직렬화 결과가
  // 다시 정상 인식되어야 한다. 예: 'EP [01]' → '[#EP 01](bepisode:1)'
  assert.equal(
    serializeHashTag({ kind: 'episode', label: 'EP [01]', episodeNumber: 1 }),
    '[#EP 01](bepisode:1)',
  );
  // `(`,`)` 포함 라벨도 안전
  assert.equal(
    serializeHashTag({ kind: 'part', label: 'A파트(특수)', episodeNumber: 2, partId: 'A' }),
    '[#A파트특수](bpart:2:A)',
  );
});
test('label escape: 직렬화 결과가 tokenizeEntities/parseHashTarget 로 정상 인식', () => {
  // `]`/`(` 가 섞인 라벨로 직렬화 → HASH_LINK_REGEX(tokenizeEntities) 가 hash 토큰으로 잡아야 함.
  // 괄호류만 제거되고 나머지 글자는 유지된다: 'a[001](x)' → 'a001x'.
  const link = serializeHashTag({ kind: 'scene', label: 'a[001](x)', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  assert.equal(link, '[#a001x](bscene:1:A:a001)');
  const tokens = tokenizeEntities(`여기 ${link} 참고`, []);
  const hash = tokens.find((t) => t.type === 'hash');
  assert.ok(hash, 'hash 토큰으로 인식되어야 함');
  if (hash && hash.type === 'hash') {
    assert.equal(hash.label, 'a001x');
    assert.deepEqual(hash.target, { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  }
});
