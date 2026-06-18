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
