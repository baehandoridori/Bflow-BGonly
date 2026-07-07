import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCostumeInOrder, reorderedCostumeSortOrders } from '../src/stores/characterBoardStoreHelpers.ts';

test('moveCostumeInOrder: 바로 다음 항목 위로 드롭해도 실제로 이동한다(회귀 방지)', () => {
  // [A,B,C] 에서 B 를 바로 다음 C 위로 드롭 → 아래로 이동이므로 C '뒤' → [A,C,B]. (이전 버그: no-op [A,B,C])
  assert.deepEqual(moveCostumeInOrder(['A', 'B', 'C'], 'B', 'C'), ['A', 'C', 'B']);
});

test('moveCostumeInOrder: 방향별 삽입', () => {
  // 위로 드래그(from>to) → 대상 앞.
  assert.deepEqual(moveCostumeInOrder(['A', 'B', 'C'], 'C', 'A'), ['C', 'A', 'B']);
  assert.deepEqual(moveCostumeInOrder(['A', 'B', 'C'], 'B', 'A'), ['B', 'A', 'C']);
  // 아래로 드래그(from<to) → 대상 뒤.
  assert.deepEqual(moveCostumeInOrder(['A', 'B', 'C'], 'A', 'C'), ['B', 'C', 'A']);
  assert.deepEqual(moveCostumeInOrder(['A', 'B', 'C'], 'A', 'B'), ['B', 'A', 'C']);
});

test('moveCostumeInOrder: 같은 대상/미존재 id 는 원본 유지', () => {
  assert.deepEqual(moveCostumeInOrder(['A', 'B'], 'A', 'A'), ['A', 'B']);
  assert.deepEqual(moveCostumeInOrder(['A', 'B'], 'ghost', 'A'), ['A', 'B']);
  assert.deepEqual(moveCostumeInOrder(['A', 'B'], 'A', 'ghost'), ['A', 'B']);
});

test('재배치는 바뀐 복장만 0..n-1 sortOrder 로 돌려준다', () => {
  const costumes = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ];
  // c 를 맨 앞으로: [c, a, b] → c:0, a:1, b:2. a·b·c 전부 바뀜.
  assert.deepEqual(reorderedCostumeSortOrders(costumes, ['c', 'a', 'b']), [
    { id: 'c', sortOrder: 0 },
    { id: 'a', sortOrder: 1 },
    { id: 'b', sortOrder: 2 },
  ]);
});

test('순서 그대로면 변경 없음', () => {
  const costumes = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
  ];
  assert.deepEqual(reorderedCostumeSortOrders(costumes, ['a', 'b']), []);
});

test('인접 두 개만 스왑하면 그 둘만 반환', () => {
  const costumes = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ];
  // [a, c, b] → a:0(불변), c:1, b:2.
  assert.deepEqual(reorderedCostumeSortOrders(costumes, ['a', 'c', 'b']), [
    { id: 'c', sortOrder: 1 },
    { id: 'b', sortOrder: 2 },
  ]);
});

test('비정상 sortOrder(동률·구멍)도 인덱스 기준으로 정규화', () => {
  const costumes = [
    { id: 'a', sortOrder: 5 },
    { id: 'b', sortOrder: 5 },
    { id: 'c', sortOrder: 9 },
  ];
  assert.deepEqual(reorderedCostumeSortOrders(costumes, ['a', 'b', 'c']), [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ]);
});

test('orderedIds 에 없는 id 는 무시', () => {
  const costumes = [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }];
  assert.deepEqual(reorderedCostumeSortOrders(costumes, ['b', 'a', 'ghost']), [
    { id: 'b', sortOrder: 0 },
    { id: 'a', sortOrder: 1 },
  ]);
});
