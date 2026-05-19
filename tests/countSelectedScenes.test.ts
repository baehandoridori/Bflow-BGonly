import test from 'node:test';
import assert from 'node:assert/strict';
import { countSelectedScenes } from '../src/utils/bulkSelectionCount.ts';

// 테스트 격리를 위해 MergedScene / Part 의 최소 형태만 사용한다.
type MinimalScene = { id: string; sceneId: string };
type MinimalPart = { sheetName: string; scenes: MinimalScene[] };
type MinimalMerged = {
  mergedKey: string;
  bgScene: MinimalScene | null;
  actScene: MinimalScene | null;
};

function makeMerged(mergedKey: string, hasBg: boolean, hasAct: boolean): MinimalMerged {
  const sid = mergedKey.split('|')[1] ?? mergedKey;
  return {
    mergedKey,
    bgScene: hasBg ? { id: `bg-${mergedKey}`, sceneId: sid } : null,
    actScene: hasAct ? { id: `act-${mergedKey}`, sceneId: sid } : null,
  };
}

test('통합 모드 — 카드 1장 (bg + act 둘 다 선택) = 1개', () => {
  const merged = [makeMerged('A|a001', true, true)];
  const selected = new Set(['bg:A|a001', 'act:A|a001']);
  assert.equal(countSelectedScenes(selected, merged as any, null), 1);
});

test('통합 모드 — 카드 3장 (각 머지드 키별 bg+act) = 3개', () => {
  const merged = [
    makeMerged('A|a001', true, true),
    makeMerged('A|a002', true, true),
    makeMerged('A|a003', true, true),
  ];
  const selected = new Set([
    'bg:A|a001', 'act:A|a001',
    'bg:A|a002', 'act:A|a002',
    'bg:A|a003', 'act:A|a003',
  ]);
  assert.equal(countSelectedScenes(selected, merged as any, null), 3);
});

test('통합 모드 — bg 만 가진 머지드 카드 1장 = 1개', () => {
  const merged = [makeMerged('A|a001', true, false)];
  const selected = new Set(['bg:A|a001']);
  assert.equal(countSelectedScenes(selected, merged as any, null), 1);
});

test('개별 모드 — plain sceneId 3개 = 3개', () => {
  const part: MinimalPart = {
    sheetName: 'EP01_A_BG',
    scenes: [
      { id: 'u1', sceneId: 'a001' },
      { id: 'u2', sceneId: 'a002' },
      { id: 'u3', sceneId: 'a003' },
    ],
  };
  const selected = new Set(['a001', 'a002', 'a003']);
  assert.equal(countSelectedScenes(selected, [], part as any), 3);
});

test('빈 selection = 0', () => {
  assert.equal(countSelectedScenes(new Set(), [], null), 0);
});

test('중복 sceneId 입력에서 dedup', () => {
  const selected = new Set(['a001', 'a001']);  // Set 은 자체적으로 dedup 됨
  assert.equal(countSelectedScenes(selected, [], null), 1);
});

test('통합 + 개별 혼합 — bg:KEY + plain sceneId 둘 다 = 2개', () => {
  const merged = [makeMerged('A|a001', true, true)];
  const selected = new Set(['bg:A|a001', 'b002']);
  assert.equal(countSelectedScenes(selected, merged as any, null), 2);
});
