import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sideBarColorClass,
  summarizeAssignees,
  collectAssigneeNotes,
  canShowFinalResolveBar,
} from '../src/utils/revisionCardView.ts';

test('sideBarColorClass: status별 클래스 접미사', () => {
  assert.equal(sideBarColorClass('open'), 'rev-side-bar-open');
  assert.equal(sideBarColorClass('in_progress'), 'rev-side-bar-progress');
  assert.equal(sideBarColorClass('assignee_done'), 'rev-side-bar-assignee-done');
  assert.equal(sideBarColorClass('resolved'), 'rev-side-bar-done');
});

test('summarizeAssignees: 완료/전체 집계 + 전원완료 플래그', () => {
  const s = summarizeAssignees(['a', 'b'], { a: { state: 'done' }, b: { state: 'in_progress' } });
  assert.equal(s.total, 2);
  assert.equal(s.doneCount, 1);
  assert.equal(s.allDone, false);

  const s2 = summarizeAssignees(['a'], { a: { state: 'done' } });
  assert.equal(s2.allDone, true);

  // state 누락 = pending 취급
  const s3 = summarizeAssignees(['a', 'b'], { a: { state: 'done' } });
  assert.equal(s3.doneCount, 1);
  assert.equal(s3.allDone, false);
});

test('summarizeAssignees: 담당 0명이면 allDone=false (빈 세트 함정 방지)', () => {
  const s = summarizeAssignees([], {});
  assert.equal(s.total, 0);
  assert.equal(s.doneCount, 0);
  assert.equal(s.allDone, false);
});

test('collectAssigneeNotes: done + note 있는 담당자만 (userId, note) 수집', () => {
  const notes = collectAssigneeNotes(['a', 'b', 'c'], {
    a: { state: 'done', note: 'G:\\proj\\a.psd' },
    b: { state: 'done' }, // note 없음 → 제외
    c: { state: 'in_progress', note: '작업중' }, // done 아님 → 제외
  });
  assert.deepEqual(notes, [{ userId: 'a', note: 'G:\\proj\\a.psd' }]);
});

test('collectAssigneeNotes: 순서는 assigneeIds 순서를 따른다', () => {
  const notes = collectAssigneeNotes(['b', 'a'], {
    a: { state: 'done', note: 'A' },
    b: { state: 'done', note: 'B' },
  });
  assert.deepEqual(notes, [
    { userId: 'b', note: 'B' },
    { userId: 'a', note: 'A' },
  ]);
});

test('canShowFinalResolveBar: 담당자 1명+ 이면 노출(finalResolvedAt 유무 무관), 0명이면 숨김', () => {
  assert.equal(canShowFinalResolveBar(['a'], undefined), true);
  assert.equal(canShowFinalResolveBar(['a'], '2026-06-18T00:00:00Z'), true);
  assert.equal(canShowFinalResolveBar([], undefined), false);
  assert.equal(canShowFinalResolveBar([], '2026-06-18T00:00:00Z'), false);
});
