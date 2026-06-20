import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHashtagQuery, applyHashtag } from '../src/utils/hashtagQuery.ts';

test('caret 앞 # 토큰 감지', () => {
  // '보세요 #a0' : 보0 세1 요2 공백3 #4 a5 0(6) → caret 7
  assert.deepEqual(detectHashtagQuery('보세요 #a0', 7), { query: 'a0', start: 4, end: 7 });
});
test('문자열 시작의 #', () => {
  assert.deepEqual(detectHashtagQuery('#a001', 5), { query: 'a001', start: 0, end: 5 });
});
test('# 앞 영숫자면 단어 내부 → null', () => {
  assert.equal(detectHashtagQuery('abc#a0', 6), null);
});
test('한글 바로 뒤 #는 허용', () => {
  // '참고#a0' : 참0 고1 #2 a3 0(4) → caret 5
  assert.deepEqual(detectHashtagQuery('참고#a0', 5), { query: 'a0', start: 2, end: 5 });
});
test('공백 만나면 토큰 아님', () => {
  assert.equal(detectHashtagQuery('# a0', 4), null);
});
test('# 없으면 null', () => {
  assert.equal(detectHashtagQuery('그냥글', 3), null);
});
test('applyHashtag: scene 토큰을 마크다운 링크로 치환', () => {
  const r = applyHashtag('보세요 #a0', 4, 7, { kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  assert.equal(r.text, '보세요 [#a001](bscene:1:A:a001) ');
  assert.equal(r.caret, '보세요 [#a001](bscene:1:A:a001) '.length);
});
test('applyHashtag: 뒤에 공백 있으면 추가 안 함', () => {
  const r = applyHashtag('#a0 끝', 0, 3, { kind: 'episode', label: '친모2', episodeNumber: 2 });
  assert.equal(r.text, '[#친모2](bepisode:2) 끝');
});
