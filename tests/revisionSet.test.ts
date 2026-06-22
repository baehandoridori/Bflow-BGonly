import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSetProgress, isSetAutoComplete, nextSetStatus } from '../src/utils/revisionSet.ts';

const item = (status: string) => ({ status });

test('computeSetProgress: resolved 수/전체 수 + 퍼센트', () => {
  assert.deepEqual(
    computeSetProgress([item('resolved'), item('open'), item('in_progress')]),
    { done: 1, total: 3, pct: 33 },
  );
  assert.deepEqual(
    computeSetProgress([item('resolved'), item('resolved')]),
    { done: 2, total: 2, pct: 100 },
  );
});

test('computeSetProgress: 빈 세트는 0/0/0 (자동완료 분모 0 방어)', () => {
  assert.deepEqual(computeSetProgress([]), { done: 0, total: 0, pct: 0 });
});

test('computeSetProgress: assignee_done 은 완료로 안 침(resolved 만 분자)', () => {
  assert.deepEqual(
    computeSetProgress([item('resolved'), item('assignee_done')]),
    { done: 1, total: 2, pct: 50 },
  );
});

test('isSetAutoComplete: 전원 resolved + 1개 이상이면 true', () => {
  assert.equal(isSetAutoComplete([item('resolved'), item('resolved')]), true);
  assert.equal(isSetAutoComplete([item('resolved'), item('open')]), false);
  assert.equal(isSetAutoComplete([item('assignee_done')]), false);
});

test('isSetAutoComplete: 빈 세트는 false (자동완료 안 함)', () => {
  assert.equal(isSetAutoComplete([]), false);
});

test('nextSetStatus: 전원 resolved → done, 아니면 open(빈 세트 포함)', () => {
  assert.equal(nextSetStatus([item('resolved'), item('resolved')]), 'done');
  assert.equal(nextSetStatus([item('resolved'), item('open')]), 'open');
  assert.equal(nextSetStatus([]), 'open');
});
