// tests/presenceDedupGate.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDedupGate } from '../electron/presence/dedupGate.ts';

test('첫 값은 항상 emit', () => {
  const gate = createDedupGate();
  assert.equal(gate.shouldEmit('a'), true);
});
test('같은 값 연속이면 두 번째부터 skip', () => {
  const gate = createDedupGate();
  assert.equal(gate.shouldEmit('a'), true);
  assert.equal(gate.shouldEmit('a'), false);
  assert.equal(gate.shouldEmit('a'), false);
});
test('값이 달라지면 다시 emit', () => {
  const gate = createDedupGate();
  gate.shouldEmit('a');
  assert.equal(gate.shouldEmit('b'), true);
  assert.equal(gate.shouldEmit('b'), false);
});
test('reset 후에는 같은 값이라도 다시 emit (신원 변경 재방송)', () => {
  const gate = createDedupGate();
  assert.equal(gate.shouldEmit('a'), true);
  assert.equal(gate.shouldEmit('a'), false);
  gate.reset();
  assert.equal(gate.shouldEmit('a'), true);   // 파일 집합 동일해도 재emit
  assert.equal(gate.shouldEmit('a'), false);
});
test('빈 문자열(파일 없음)도 첫 값이면 emit되고 reset으로 재emit', () => {
  const gate = createDedupGate();
  assert.equal(gate.shouldEmit(''), true);
  assert.equal(gate.shouldEmit(''), false);
  gate.reset();
  assert.equal(gate.shouldEmit(''), true);
});
