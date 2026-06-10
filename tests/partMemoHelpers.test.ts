import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPartMemoToSheets,
  buildPartContextMenuTarget,
  getCombinedPartMemo,
  getCombinedPartReelWorker,
  listVisiblePartMemoSheetNames,
  applyPartReelWorkerToSheets,
  rollbackFailedPartReelWorkerSheets,
  rollbackFailedPartMemoSheets,
} from '../src/utils/partMemoHelpers.ts';

test('getCombinedPartMemo returns a single shared memo once for grouped parts', () => {
  const memo = getCombinedPartMemo(
    {
      EP01_A_BG: '공통 메모',
      EP01_A_ACT: '공통 메모',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
  );

  assert.equal(memo, '공통 메모');
});

test('getCombinedPartMemo preserves differing legacy memos for visibility', () => {
  const memo = getCombinedPartMemo(
    {
      EP01_A_BG: 'BG 메모',
      EP01_A_ACT: 'ACT 메모',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
  );

  assert.equal(memo, 'BG 메모 / ACT 메모');
});

test('applyPartMemoToSheets writes the same memo to every grouped sheet', () => {
  const next = applyPartMemoToSheets(
    {
      EP01_A_BG: '이전 메모',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
    '새 메모',
  );

  assert.deepEqual(next, {
    EP01_A_BG: '새 메모',
    EP01_A_ACT: '새 메모',
  });
});

test('applyPartMemoToSheets clears grouped memos when the input is blank', () => {
  const next = applyPartMemoToSheets(
    {
      EP01_A_BG: '메모',
      EP01_A_ACT: '메모',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
    '   ',
  );

  assert.deepEqual(next, {});
});

test('rollbackFailedPartMemoSheets reverts only failed grouped memo writes', () => {
  const next = rollbackFailedPartMemoSheets(
    {
      EP01_A_BG: '새 메모',
      EP01_A_ACT: '새 메모',
    },
    {
      EP01_A_BG: '이전 BG',
      EP01_A_ACT: '이전 ACT',
    },
    ['EP01_A_ACT'],
    '새 메모',
  );

  assert.deepEqual(next, {
    EP01_A_BG: '새 메모',
    EP01_A_ACT: '이전 ACT',
  });
});

test('rollbackFailedPartMemoSheets restores failed blank memo deletes', () => {
  const next = rollbackFailedPartMemoSheets(
    {},
    {
      EP01_A_BG: '이전 BG',
      EP01_A_ACT: '이전 ACT',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
    '   ',
  );

  assert.deepEqual(next, {
    EP01_A_BG: '이전 BG',
    EP01_A_ACT: '이전 ACT',
  });
});

test('listVisiblePartMemoSheetNames collects every visible part sheet once', () => {
  const sheetNames = listVisiblePartMemoSheetNames([
    {
      episodeNumber: 1,
      title: 'EP.01',
      parts: [
        { partId: 'A', department: 'bg', sheetName: 'EP01_A_BG', scenes: [] },
        { partId: 'A', department: 'acting', sheetName: 'EP01_A_ACT', scenes: [] },
      ],
    },
    {
      episodeNumber: 2,
      title: 'EP.02',
      parts: [
        { partId: 'B', department: 'bg', sheetName: 'EP02_B_BG', scenes: [] },
      ],
    },
  ], 'all');

  assert.deepEqual(sheetNames, ['EP01_A_ACT', 'EP01_A_BG', 'EP02_B_BG']);
});

test('buildPartContextMenuTarget groups BG and ACT sheets for the same part in all mode', () => {
  const target = buildPartContextMenuTarget(1, 'A', [
    { partId: 'A', sheetName: 'EP01_A_BG' },
    { partId: 'A', sheetName: 'EP01_A_ACT' },
  ]);

  assert.deepEqual(target, {
    episodeNumber: 1,
    partId: 'A',
    sheetNames: ['EP01_A_BG', 'EP01_A_ACT'],
  });
});

test('buildPartContextMenuTarget groups case-varied BG and ACT part ids', () => {
  const target = buildPartContextMenuTarget(1, 'A', [
    { partId: 'A', sheetName: 'EP01_A_BG' },
    { partId: 'a', sheetName: 'EP01_A_ACT' },
  ]);

  assert.deepEqual(target, {
    episodeNumber: 1,
    partId: 'A',
    sheetNames: ['EP01_A_BG', 'EP01_A_ACT'],
  });
});

test('buildPartContextMenuTarget returns null when no visible sheet matches the part', () => {
  assert.equal(buildPartContextMenuTarget(1, 'A', []), null);
  assert.equal(buildPartContextMenuTarget(null, 'A', [{ partId: 'A', sheetName: 'EP01_A_BG' }]), null);
});

test('getCombinedPartReelWorker returns a single shared worker once for grouped parts', () => {
  const worker = getCombinedPartReelWorker(
    {
      EP01_A_BG: '배한솔',
      EP01_A_ACT: '배한솔',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
  );

  assert.equal(worker, '배한솔');
});

test('getCombinedPartReelWorker preserves differing legacy workers for visibility', () => {
  const worker = getCombinedPartReelWorker(
    {
      EP01_A_BG: '배한솔',
      EP01_A_ACT: '강선영',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
  );

  assert.equal(worker, '배한솔 / 강선영');
});

test('applyPartReelWorkerToSheets writes the same worker to every grouped sheet', () => {
  const next = applyPartReelWorkerToSheets(
    {
      EP01_A_BG: '이전 담당',
    },
    ['EP01_A_BG', 'EP01_A_ACT'],
    '새 담당',
  );

  assert.deepEqual(next, {
    EP01_A_BG: '새 담당',
    EP01_A_ACT: '새 담당',
  });
});

test('rollbackFailedPartReelWorkerSheets reverts only failed grouped worker writes', () => {
  const next = rollbackFailedPartReelWorkerSheets(
    {
      EP01_A_BG: '새 담당',
      EP01_A_ACT: '새 담당',
    },
    {
      EP01_A_BG: '이전 BG',
      EP01_A_ACT: '이전 ACT',
    },
    ['EP01_A_ACT'],
    '새 담당',
  );

  assert.deepEqual(next, {
    EP01_A_BG: '새 담당',
    EP01_A_ACT: '이전 ACT',
  });
});
