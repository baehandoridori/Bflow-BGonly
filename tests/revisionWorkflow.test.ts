import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRevisionStatus,
  sanitizeAssignees,
  startAssignee,
  completeAssignee,
  revertAssignee,
  canReassignRevision,
  canFinalResolveRevision,
  canActAsAssignee,
} from '../src/utils/revisionWorkflow.ts';
import type { RevisionAssigneeState, AppUser, CompRevision } from '../src/types/index.ts';

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

// ─── Task 5: sanitizeAssignees ────────────────

test('sanitizeAssignees: notify에 없는 담당자 제거', () => {
  const r = sanitizeAssignees(['a', 'b', 'c'], { a: S('done'), b: S('in_progress'), c: S('pending') }, ['a', 'b']);
  assert.deepEqual(r.assigneeIds, ['a', 'b']);
  assert.deepEqual(Object.keys(r.assigneeStates).sort(), ['a', 'b']);
  assert.equal(r.assigneeStates.a.state, 'done');
});
test('sanitizeAssignees: state 없는 담당자는 pending으로 채움', () => {
  const r = sanitizeAssignees(['a'], {}, ['a', 'b']);
  assert.deepEqual(r.assigneeIds, ['a']);
  assert.equal(r.assigneeStates.a.state, 'pending');
});
test('sanitizeAssignees: 빈 입력', () => {
  const r = sanitizeAssignees([], {}, []);
  assert.deepEqual(r.assigneeIds, []);
  assert.deepEqual(r.assigneeStates, {});
});

// ─── Task 6: 담당 상태 전이 ───────────────────

test('startAssignee: pending → in_progress, startedAt 세팅', () => {
  const next = startAssignee({ a: S('pending') }, 'a', '2026-06-17T01:00:00Z');
  assert.equal(next.a.state, 'in_progress');
  assert.equal(next.a.startedAt, '2026-06-17T01:00:00Z');
});
test('startAssignee: 이미 startedAt 있으면 보존(재시작 시 덮어쓰지 않음)', () => {
  const next = startAssignee({ a: { state: 'in_progress', startedAt: 'first' } }, 'a', 'second');
  assert.equal(next.a.startedAt, 'first');
});
test('completeAssignee: → done, note/doneAt 세팅', () => {
  const next = completeAssignee({ a: S('in_progress') }, 'a', 'G:\\path\\v3.psd', '2026-06-17T02:00:00Z');
  assert.equal(next.a.state, 'done');
  assert.equal(next.a.note, 'G:\\path\\v3.psd');
  assert.equal(next.a.doneAt, '2026-06-17T02:00:00Z');
});
test('revertAssignee: done → in_progress, doneAt 제거, startedAt 보존', () => {
  const next = revertAssignee({ a: { state: 'done', note: 'x', startedAt: 's', doneAt: 't' } }, 'a');
  assert.equal(next.a.state, 'in_progress');
  assert.equal(next.a.doneAt, undefined);
  assert.equal(next.a.startedAt, 's');
});
test('전이 함수는 원본을 변경하지 않는다(불변)', () => {
  const orig = { a: S('pending') };
  startAssignee(orig, 'a', 't');
  assert.equal(orig.a.state, 'pending');
});

// ─── Task 7: 권한 가드 ────────────────────────

const user = (over: Partial<AppUser>): AppUser =>
  ({ id: 'u', name: 'n', slackId: '', password: '', isInitialPassword: false, createdAt: '', ...over });
const rev = (over: Partial<CompRevision>): CompRevision =>
  ({ id: 'r', sceneKey: '', revisionNo: 1, status: 'open', priority: 'normal', description: '',
     requesterId: 'req', requesterName: '', createdAt: '', updatedAt: '', ...over });

test('canReassignRevision: 요청자 본인 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'req' }), rev({ requesterId: 'req' })), true);
});
test('canReassignRevision: 컴포지터 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'x', isCompositor: true }), rev({})), true);
});
test('canReassignRevision: admin 허용', () => {
  assert.equal(canReassignRevision(user({ id: 'x', role: 'admin' }), rev({})), true);
});
test('canReassignRevision: 무관한 일반 사용자 거부', () => {
  assert.equal(canReassignRevision(user({ id: 'x' }), rev({ requesterId: 'req' })), false);
});
test('canReassignRevision: null 사용자 거부', () => {
  assert.equal(canReassignRevision(null, rev({})), false);
});
test('canFinalResolveRevision: 요청자/컴포지터급만', () => {
  assert.equal(canFinalResolveRevision(user({ id: 'req' }), rev({ requesterId: 'req' })), true);
  assert.equal(canFinalResolveRevision(user({ id: 'x' }), rev({ requesterId: 'req' })), false);
});
test('canActAsAssignee: 담당자 본인만', () => {
  assert.equal(canActAsAssignee(user({ id: 'a' }), rev({ assigneeIds: ['a', 'b'] })), true);
  assert.equal(canActAsAssignee(user({ id: 'z' }), rev({ assigneeIds: ['a', 'b'] })), false);
});
