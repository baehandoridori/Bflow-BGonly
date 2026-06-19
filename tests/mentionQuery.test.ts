import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMentionQuery, applyMention } from '../src/utils/mentionQuery.ts';

// 끝에서 멘션 (caret 은 '홍' 글자 뒤 = 5)
test('detect: 끝에서 @ 입력', () => {
  assert.deepEqual(detectMentionQuery('안녕 @홍', 5), { query: '홍', start: 3, end: 5 });
});
// @ 바로 뒤 caret(빈 query) — 인덱스 안(0)녕(1)' '(2)@(3), caret=4
test('detect: @ 바로 뒤 caret(빈 query)', () => {
  assert.deepEqual(detectMentionQuery('안녕 @', 4), { query: '', start: 3, end: 4 });
});
// 핵심: 텍스트 '중간' caret 멘션 (기존 lastIndexOf 로는 불가). '@김 끝' 에서 '@김' 직후(2)
test('detect: 중간 caret 멘션', () => {
  assert.deepEqual(detectMentionQuery('@김 끝', 2), { query: '김', start: 0, end: 2 });
});
test('detect: 문자열 맨 앞 @', () => {
  assert.deepEqual(detectMentionQuery('@', 1), { query: '', start: 0, end: 1 });
});
test('detect: 이메일 a@b 는 멘션 아님(영숫자 뒤 @)', () => {
  assert.equal(detectMentionQuery('a@b', 3), null);
});
test('detect: 한글 뒤 붙은 @ 도 멘션(한글은 공백 없이 붙여 씀)', () => {
  // 이(0)거(1)@(2)배(3), caret=4 → '@' 앞이 한글이라 이메일 아님 → 멘션 허용
  assert.deepEqual(detectMentionQuery('이거@배', 4), { query: '배', start: 2, end: 4 });
});
test('detect: 기호 뒤 붙은 @ 도 멘션', () => {
  // )(0)@(1)김(2), caret=3
  assert.deepEqual(detectMentionQuery(')@김', 3), { query: '김', start: 1, end: 3 });
});
test('detect: query 안에 공백이면 멘션 아님(토큰 종료)', () => {
  assert.equal(detectMentionQuery('@김 철수', 5), null);
});
test('detect: 20자 이상 query 는 멘션 아님', () => {
  const long = '@' + 'a'.repeat(20);
  assert.equal(detectMentionQuery(long, long.length), null);
});
test('detect: caret 앞에 @ 없으면 null', () => {
  assert.equal(detectMentionQuery('일반 텍스트', 6), null);
});

// applyMention — end 는 detect 의 caret(=end) 계약과 동일하게 사용
test('apply: caret 토큰을 @이름 + 공백으로 치환', () => {
  // '안녕 @홍'(len5), start=3,end=5 → '안녕 @홍길동 '
  assert.deepEqual(applyMention('안녕 @홍', 3, 5, '홍길동'), { text: '안녕 @홍길동 ', caret: 8 });
});
test('apply: 중간 멘션 치환은 뒷부분 보존 + 공백 중복 안 함', () => {
  // '@김 끝' start=0,end=2 → '@김철수 끝' (end 뒤가 ' '이라 공백 추가 안 함)
  assert.deepEqual(applyMention('@김 끝', 0, 2, '김철수'), { text: '@김철수 끝', caret: 4 });
});
