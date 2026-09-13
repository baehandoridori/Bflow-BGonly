/**
 * 피드백 58: 팀 할 일 공유 계약(src/shared/threadTodo.ts) 순수 유닛 테스트.
 * main·렌더러·mock 이 같은 검증기를 쓰므로 여기서 규칙을 못박는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THREAD_TODO_KEY_MAX,
  THREAD_TODO_RESPONSE_DISCARDED,
  THREAD_TODO_TEXT_MAX,
  canDeleteThreadTodo,
  isThreadTodoRow,
  isValidThreadKey,
  isValidThreadTodoText,
  sanitizeThreadTodoText,
  type ThreadTodoRow,
} from '../src/shared/threadTodo.ts';

const row: ThreadTodoRow = {
  id: '11111111-2222-4333-8444-555555555555',
  thread_key: 'EP05:A:a001',
  text: '출력 크기 키우기',
  created_by: 'alice',
  created_by_name: '앨리스',
  created_at: '2026-09-14T00:00:00+00:00',
  done_at: null,
  done_by: null,
  done_by_name: null,
};

test('공유 계약 파일은 런타임 import 가 없다 (main·렌더러·mock·node --test 공용)', () => {
  const src = readFileSync('src/shared/threadTodo.ts', 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /from '@\//);
  assert.equal(THREAD_TODO_TEXT_MAX, 200);
  assert.equal(THREAD_TODO_KEY_MAX, 200);
  assert.equal(THREAD_TODO_RESPONSE_DISCARDED, '로그인 세션이 변경되어 할 일 응답을 폐기했습니다.');
});

test('sanitizeThreadTodoText: 앞뒤 공백 제거·연속 공백(개행 포함) 한 칸·비문자열은 빈 문자열', () => {
  assert.equal(sanitizeThreadTodoText('  출력   크기 \n 키우기 '), '출력 크기 키우기');
  assert.equal(sanitizeThreadTodoText('\t\n'), '');
  // 붙여 넣은 CRLF·줄바꿈 없는 공백(NBSP)·한글 입력기의 전각 공백도 한 칸으로 (서버보다 넓거나 같은 공백 기준)
  assert.equal(sanitizeThreadTodoText('출력\r\n크기 키우기　끝'), '출력 크기 키우기 끝');
  assert.equal(sanitizeThreadTodoText(null), '');
  assert.equal(sanitizeThreadTodoText(42), '');
});

test('isValidThreadTodoText: 1~200자', () => {
  assert.equal(isValidThreadTodoText(''), false);
  assert.equal(isValidThreadTodoText('가'), true);
  assert.equal(isValidThreadTodoText('가'.repeat(200)), true);
  assert.equal(isValidThreadTodoText('가'.repeat(201)), false);
});

test('isValidThreadKey: 비어 있지 않은 200자 이하 문자열만', () => {
  assert.equal(isValidThreadKey('EP05:A:a001'), true);
  assert.equal(isValidThreadKey('char:11111111-2222-4333-8444-555555555555'), true);
  assert.equal(isValidThreadKey(''), false);
  assert.equal(isValidThreadKey('   '), false);
  assert.equal(isValidThreadKey('k'.repeat(200)), true);
  assert.equal(isValidThreadKey('k'.repeat(201)), false);
  assert.equal(isValidThreadKey(undefined), false);
  assert.equal(isValidThreadKey(7), false);
});

test('isThreadTodoRow: 필수 문자열 6개 + 완료 3칸(문자열 또는 null)', () => {
  assert.equal(isThreadTodoRow(row), true);
  assert.equal(isThreadTodoRow({ ...row, done_at: '2026-09-14T01:00:00+00:00', done_by: 'bob', done_by_name: '밥' }), true);
  assert.equal(isThreadTodoRow({ ...row, id: 1 }), false);
  assert.equal(isThreadTodoRow({ ...row, done_by: undefined }), false);
  assert.equal(isThreadTodoRow({ ...row, done_at: 3 }), false);
  const { created_by_name: _omit, ...missing } = row;
  assert.equal(isThreadTodoRow(missing), false);
  const { created_at: _omitCreatedAt, ...noCreatedAt } = row;
  assert.equal(isThreadTodoRow(noCreatedAt), false);
  assert.equal(isThreadTodoRow(null), false);
  assert.equal(isThreadTodoRow('row'), false);
});

test('canDeleteThreadTodo: 작성자 본인 또는 admin 만 (표시용 판정)', () => {
  assert.equal(canDeleteThreadTodo(row, { id: 'alice' }), true);
  assert.equal(canDeleteThreadTodo(row, { id: 'bob', role: 'admin' }), true);
  assert.equal(canDeleteThreadTodo(row, { id: 'bob', role: 'user' }), false);
  assert.equal(canDeleteThreadTodo(row, { id: 'bob' }), false);
  assert.equal(canDeleteThreadTodo(row, null), false);
  assert.equal(canDeleteThreadTodo(row, undefined), false);
});
