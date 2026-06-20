import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeEntities } from '../src/utils/entityTokens.ts';

const USERS = ['홍길동', '김철수'];

test('순수 텍스트', () => {
  assert.deepEqual(tokenizeEntities('그냥 글', USERS), [{ type: 'text', content: '그냥 글' }]);
});
test('유효 멘션만 mention 토큰, 무효 @는 text', () => {
  assert.deepEqual(tokenizeEntities('@홍길동 @없는사람', USERS), [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' @없는사람' },
  ]);
});
test('이름 뒤 조사가 붙으면 평문(extractMentions 와 동일 \\S+ 규칙)', () => {
  assert.deepEqual(tokenizeEntities('@홍길동님', USERS), [{ type: 'text', content: '@홍길동님' }]);
});
test('G:\\ 경로는 path 토큰(줄끝까지 — pathLink 규칙)', () => {
  const t = tokenizeEntities('보면 G:\\공유 드라이브\\a.png 확인', USERS);
  assert.deepEqual(t[0], { type: 'text', content: '보면 ' });
  assert.deepEqual(t[1], { type: 'path', content: 'G:\\공유 드라이브\\a.png 확인' });
});
test('멘션+경로 혼합 위치순 보존(경로 먼저 분리)', () => {
  const t = tokenizeEntities('@홍길동 G:\\a.png', USERS);
  assert.deepEqual(t, [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' ' },
    { type: 'path', content: 'G:\\a.png' },
  ]);
});
test('빈 문자열', () => {
  assert.deepEqual(tokenizeEntities('', USERS), []);
});

// ─── 4a: 컷 번호 토큰 (4c에서 #태그로 전환 중 — Chunk5 정리 시 제거 예정) ───
test('컷 번호 감지(컷N/cutN) + 숫자 파싱', () => {
  assert.deepEqual(tokenizeEntities('컷5 확인 cut12', USERS), [
    { type: 'cut', content: '컷5', number: 5 },
    { type: 'text', content: ' 확인 ' },
    { type: 'cut', content: 'cut12', number: 12 },
  ]);
});
test('uncut3 영문 단어 내부는 컷 아님', () => {
  assert.deepEqual(tokenizeEntities('uncut3', USERS), [{ type: 'text', content: 'uncut3' }]);
});
test('컷0/컷00 은 컷 토큰 아님(number<=0 가드)', () => {
  assert.deepEqual(tokenizeEntities('컷0', USERS), [{ type: 'text', content: '컷0' }]);
});

// ─── 4c: # 씬·파트·화 태그(마크다운 링크식) ───
test('hash scene 토큰 파싱', () => {
  assert.deepEqual(tokenizeEntities('보세요 [#a001](bscene:1:A:a001) 참고', USERS), [
    { type: 'text', content: '보세요 ' },
    { type: 'hash', content: '[#a001](bscene:1:A:a001)', label: 'a001', target: { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' } },
    { type: 'text', content: ' 참고' },
  ]);
});
test('hash part/episode 토큰', () => {
  const toks = tokenizeEntities('[#A파트](bpart:1:A) [#친모2](bepisode:2)', USERS);
  assert.equal(toks.filter((t) => t.type === 'hash').length, 2);
  assert.deepEqual(toks[0], { type: 'hash', content: '[#A파트](bpart:1:A)', label: 'A파트', target: { kind: 'part', episodeNumber: 1, partId: 'A' } });
});
test('잘못된 링크 타깃은 평문', () => {
  assert.deepEqual(tokenizeEntities('[#x](http://y)', USERS), [{ type: 'text', content: '[#x](http://y)' }]);
});
test('멘션+해시 혼합 위치순', () => {
  assert.deepEqual(tokenizeEntities('@홍길동 [#a001](bscene:1:A:a001)', USERS), [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' ' },
    { type: 'hash', content: '[#a001](bscene:1:A:a001)', label: 'a001', target: { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' } },
  ]);
});
test('해시 라벨 안에 컷 패턴이 있어도 hash 우선(겹침)', () => {
  const toks = tokenizeEntities('[#컷5씬](bscene:1:A:a001)', USERS);
  assert.equal(toks.length, 1);
  assert.equal(toks[0].type, 'hash');
});
