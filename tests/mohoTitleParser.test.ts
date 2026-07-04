// tests/mohoTitleParser.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMohoTitles } from '../electron/presence/mohoTitleParser.ts';

test('표준 제목에서 basename(확장자 포함, 소문자) 추출', () => {
  assert.deepEqual(parseMohoTitles(['b030.moho -Moho']), ['b030.moho']);
});
test('미저장 표시 * 와 대소문자 처리', () => {
  assert.deepEqual(parseMohoTitles(['B030-피드백.MOHO* -Moho']), ['b030-피드백.moho']);
});
test('여러 Moho 인스턴스(여러 줄)와 중복 제거', () => {
  assert.deepEqual(
    parseMohoTitles(['b030.moho -Moho', 'b031-다시.moho -Moho', 'b030.moho -Moho']),
    ['b030.moho', 'b031-다시.moho'],
  );
});
test('빈 줄/공백/비-moho(제목없음, 새 프로젝트) 무시', () => {
  assert.deepEqual(parseMohoTitles(['', '   ', 'Untitled -Moho', 'Moho Pro']), []);
});
test('버전 표기가 붙은 앱 접미사도 제거', () => {
  assert.deepEqual(parseMohoTitles(['a012.mohoproj - Moho Pro']), ['a012.mohoproj']);
});
test('파일명에 대시가 있어도 확장자 앞까지 보존', () => {
  assert.deepEqual(parseMohoTitles(['ep2-b030-retake.moho -Moho']), ['ep2-b030-retake.moho']);
});
