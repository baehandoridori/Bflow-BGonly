import test from 'node:test';
import assert from 'node:assert/strict';
import { dropEdgeFor, moveCostumeInOrder } from '../src/stores/characterBoardStoreHelpers.ts';

test('dropEdgeFor: 아래로 드래그(from<to)는 대상 뒤(after)', () => {
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'A', 'C'), 'after');
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'A', 'B'), 'after');
});

test('dropEdgeFor: 위로 드래그(from>to)는 대상 앞(before)', () => {
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'C', 'A'), 'before');
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'B', 'A'), 'before');
});

test('dropEdgeFor: 자기 자신·미존재·null 은 표시 안 함(null)', () => {
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'B', 'B'), null);
  assert.equal(dropEdgeFor(['A', 'B', 'C'], null, 'A'), null);
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'ghost', 'A'), null);
  assert.equal(dropEdgeFor(['A', 'B', 'C'], 'A', 'ghost'), null);
});

test('dropEdgeFor 삽입선은 실제 재배치(moveCostumeInOrder) 결과와 방향이 일치한다', () => {
  // 삽입선이 대상 '뒤(after)'로 표시되면 → 실제로도 대상 바로 뒤에 놓여야 한다.
  const ids = ['A', 'B', 'C', 'D'];
  for (const drag of ids) {
    for (const target of ids) {
      const edge = dropEdgeFor(ids, drag, target);
      if (!edge) continue;
      const result = moveCostumeInOrder(ids, drag, target);
      const targetIdx = result.indexOf(target);
      const dragIdx = result.indexOf(drag);
      if (edge === 'after') {
        assert.equal(dragIdx, targetIdx + 1, `${drag}→${target} after: 대상 바로 뒤`);
      } else {
        assert.equal(dragIdx, targetIdx - 1, `${drag}→${target} before: 대상 바로 앞`);
      }
    }
  }
});
