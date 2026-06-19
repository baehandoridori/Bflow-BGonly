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

// ─── 4a: 컷 번호 토큰 ───
test('컷 번호 감지(컷N/cutN) + 숫자 파싱', () => {
  assert.deepEqual(tokenizeEntities('컷5 확인 cut12', USERS), [
    { type: 'cut', content: '컷5', number: 5 },
    { type: 'text', content: ' 확인 ' },
    { type: 'cut', content: 'cut12', number: 12 },
  ]);
});
test('cut 사이 공백 허용, 대소문자 무시', () => {
  assert.deepEqual(tokenizeEntities('Cut 7', USERS), [{ type: 'cut', content: 'Cut 7', number: 7 }]);
});
test('uncut3 영문 단어 내부는 컷 아님', () => {
  assert.deepEqual(tokenizeEntities('uncut3', USERS), [{ type: 'text', content: 'uncut3' }]);
});
test('공백 뒤 컷은 감지', () => {
  assert.deepEqual(tokenizeEntities('추가 컷3', USERS), [
    { type: 'text', content: '추가 ' },
    { type: 'cut', content: '컷3', number: 3 },
  ]);
});
test('한글 바로 뒤 컷도 감지(앞 경계는 영숫자만 차단)', () => {
  assert.deepEqual(tokenizeEntities('한컷3', USERS), [
    { type: 'text', content: '한' },
    { type: 'cut', content: '컷3', number: 3 },
  ]);
});
test('씬N 은 감지 안 함(컷만 — 씬은 sceneId 혼동)', () => {
  assert.deepEqual(tokenizeEntities('씬5', USERS), [{ type: 'text', content: '씬5' }]);
});
test('멘션+컷 혼합 위치순', () => {
  assert.deepEqual(tokenizeEntities('@홍길동 컷3', USERS), [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' ' },
    { type: 'cut', content: '컷3', number: 3 },
  ]);
});
