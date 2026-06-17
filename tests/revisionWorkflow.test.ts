import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveRevisionStatus } from '../src/utils/revisionWorkflow.ts';
import type { RevisionAssigneeState } from '../src/types/index.ts';

const S = (state: 'pending' | 'in_progress' | 'done'): RevisionAssigneeState => ({ state });

test('deriveRevisionStatus: final_resolved_at 있으면 항상 resolved', () => {
  assert.equal(deriveRevisionStatus(['a'], { a: S('done') }, '2026-06-17T00:00:00Z'), 'resolved');
  assert.equal(deriveRevisionStatus([], {}, '2026-06-17T00:00:00Z'), 'resolved');
});
test('deriveRevisionStatus: 담당자 0명이면 open', () => {
  assert.equal(deriveRevisionStatus([], {}, null), 'open');
});
test('deriveRevisionStatus: 전원 pending이면 open', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('pending'), b: S('pending') }, null), 'open');
});
test('deriveRevisionStatus: 전원 done이면 assignee_done', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done'), b: S('done') }, null), 'assignee_done');
});
test('deriveRevisionStatus: 일부만 done이면 in_progress', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done'), b: S('pending') }, null), 'in_progress');
});
test('deriveRevisionStatus: 누군가 in_progress면 in_progress', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('in_progress'), b: S('pending') }, null), 'in_progress');
});
test('deriveRevisionStatus: state 누락 항목은 pending 취급', () => {
  assert.equal(deriveRevisionStatus(['a', 'b'], { a: S('done') }, null), 'in_progress');
});
