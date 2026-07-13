import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBadgeFloatQueue,
  enqueueBadgeFloat,
  popBadgeFloat,
} from '../src/features/playground/arcade/badgeFloatQueue.ts';

test('a fresh queue is empty and starts issuing ids from 1', () => {
  const q = createBadgeFloatQueue();
  assert.deepEqual(q.items, []);
  assert.equal(q.nextId, 1);
});

test('enqueue adds up to three distinct floating items with monotonic ids', () => {
  let q = createBadgeFloatQueue();
  q = enqueueBadgeFloat(q, 5);
  q = enqueueBadgeFloat(q, 10);
  q = enqueueBadgeFloat(q, 30);
  assert.equal(q.items.length, 3);
  assert.deepEqual(q.items.map((i) => i.delta), [5, 10, 30]);
  assert.deepEqual(q.items.map((i) => i.id), [1, 2, 3]);
  assert.equal(q.nextId, 4);
});

test('a fourth enqueue over the cap sums into the last item and issues no new id', () => {
  let q = createBadgeFloatQueue();
  q = enqueueBadgeFloat(q, 5);
  q = enqueueBadgeFloat(q, 10);
  q = enqueueBadgeFloat(q, 30);
  q = enqueueBadgeFloat(q, 20); // 초과 → 마지막 항목에 합산
  assert.equal(q.items.length, 3);
  assert.deepEqual(q.items.map((i) => i.delta), [5, 10, 50]);
  assert.deepEqual(q.items.map((i) => i.id), [1, 2, 3], '합산은 새 id 를 만들지 않는다');
  assert.equal(q.nextId, 4, 'nextId 도 그대로');
});

test('further overflow keeps summing into the same last item', () => {
  let q = createBadgeFloatQueue();
  q = enqueueBadgeFloat(q, 5);
  q = enqueueBadgeFloat(q, 10);
  q = enqueueBadgeFloat(q, 30);
  q = enqueueBadgeFloat(q, 20);
  q = enqueueBadgeFloat(q, 7);
  assert.deepEqual(q.items.map((i) => i.delta), [5, 10, 57]);
});

test('pop removes the front item in FIFO order and opens a slot again', () => {
  let q = createBadgeFloatQueue();
  q = enqueueBadgeFloat(q, 5);
  q = enqueueBadgeFloat(q, 10);
  q = enqueueBadgeFloat(q, 30);
  q = popBadgeFloat(q);
  assert.deepEqual(q.items.map((i) => i.id), [2, 3]);
  assert.deepEqual(q.items.map((i) => i.delta), [10, 30]);
  // 슬롯이 다시 비었으니 새 항목은 합산이 아니라 추가된다.
  q = enqueueBadgeFloat(q, 8);
  assert.deepEqual(q.items.map((i) => i.delta), [10, 30, 8]);
  assert.deepEqual(q.items.map((i) => i.id), [2, 3, 4]);
});

test('pop on an empty queue is a no-op', () => {
  const q = createBadgeFloatQueue();
  const popped = popBadgeFloat(q);
  assert.deepEqual(popped.items, []);
  assert.equal(popped.nextId, 1);
});

test('non-positive or non-finite deltas are ignored', () => {
  let q = createBadgeFloatQueue();
  q = enqueueBadgeFloat(q, 0);
  q = enqueueBadgeFloat(q, -5);
  q = enqueueBadgeFloat(q, Number.NaN);
  q = enqueueBadgeFloat(q, Number.POSITIVE_INFINITY);
  assert.deepEqual(q.items, []);
  assert.equal(q.nextId, 1);
});

test('enqueue and pop never mutate the input state (pure)', () => {
  const q0 = createBadgeFloatQueue();
  const q1 = enqueueBadgeFloat(q0, 5);
  assert.deepEqual(q0.items, [], '원본은 그대로');
  assert.equal(q0.nextId, 1);
  const q2 = popBadgeFloat(q1);
  assert.equal(q1.items.length, 1, 'pop 도 원본 불변');
  assert.equal(q2.items.length, 0);
});
