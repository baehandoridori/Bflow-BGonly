import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutDayBlocks,
  minutesToTime,
  pxToMinutes,
  snapMinutes,
  timeToMinutes,
} from '../src/utils/timeGridLayout.ts';

test('snapMinutes: 15분 단위 반올림과 하루 범위 클램프', () => {
  assert.equal(snapMinutes(0), 0);
  assert.equal(snapMinutes(7), 0);
  assert.equal(snapMinutes(8), 15);
  assert.equal(snapMinutes(23), 30);
  assert.equal(snapMinutes(-10), 0);
  assert.equal(snapMinutes(1500), 1440);
});

test('pxToMinutes: 시간 눈금 높이 기준으로 좌표를 분으로 환산한다', () => {
  assert.equal(pxToMinutes(14, 56), 15);
  assert.equal(pxToMinutes(56, 56), 60);
});

test('timeToMinutes와 minutesToTime은 시간을 왕복한다', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(minutesToTime(570), '09:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(timeToMinutes('24:00'), 1440);
});

test('layoutDayBlocks: 닿기만 한 블록은 각각 전체 폭이다', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 600, endMin: 660 },
  ]);

  assert.deepEqual(out.map((item) => [item.id, item.col, item.span, item.cols]), [
    ['a', 0, 1, 1],
    ['b', 0, 1, 1],
  ]);
});

test('layoutDayBlocks: 겹친 두 블록을 다른 열에 배치한다', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 840, endMin: 900 },
    { id: 'b', startMin: 870, endMin: 930 },
  ]);
  const a = out.find((item) => item.id === 'a')!;
  const b = out.find((item) => item.id === 'b')!;

  assert.equal(a.cols, 2);
  assert.equal(b.cols, 2);
  assert.notEqual(a.col, b.col);
});

test('layoutDayBlocks: 사슬 겹침은 하나의 두 열 클러스터로 유지한다', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 570, endMin: 660 },
    { id: 'c', startMin: 630, endMin: 690 },
  ]);

  assert.ok(out.every((item) => item.cols === 2));
  assert.equal(out.find((item) => item.id === 'c')!.col, 0);
});

test('layoutDayBlocks: 오른쪽 열과 겹치지 않으면 그 폭을 확장한다', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 720 },
    { id: 'b', startMin: 540, endMin: 600 },
    { id: 'c', startMin: 540, endMin: 600 },
  ]);
  const a = out.find((item) => item.id === 'a')!;

  assert.equal(a.cols, 3);
  assert.equal(a.span, 1);

  const separate = layoutDayBlocks([
    { id: 'x', startMin: 540, endMin: 600 },
    { id: 'y', startMin: 570, endMin: 630 },
    { id: 'z', startMin: 700, endMin: 760 },
  ]);
  assert.equal(separate.find((item) => item.id === 'z')!.cols, 1);
});

test('layoutDayBlocks: 가운데 빈 열은 오른쪽 충돌 전까지 확장한다', () => {
  const out = layoutDayBlocks([
    { id: 'a', startMin: 540, endMin: 600 },
    { id: 'b', startMin: 540, endMin: 600 },
    { id: 'c', startMin: 570, endMin: 660 },
    { id: 'd', startMin: 600, endMin: 630 },
  ]);
  const d = out.find((item) => item.id === 'd')!;

  assert.equal(d.cols, 3);
  assert.equal(d.span, 2);
});

test('layoutDayBlocks: 동시에 시작하면 더 긴 블록을 왼쪽에 둔다', () => {
  const out = layoutDayBlocks([
    { id: 'short', startMin: 540, endMin: 570 },
    { id: 'long', startMin: 540, endMin: 660 },
  ]);

  assert.equal(out.find((item) => item.id === 'long')!.col, 0);
});
