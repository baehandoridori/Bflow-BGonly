// tests/workFileIndex.test.ts — 엔티티 무관 작업 파일 인덱스 (피드백 54)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkFileBasenameIndex, resolveIdsForBasenames } from '../electron/presence/workFileIndex.ts';

test('basename 소문자 키 + path/id 없는 항목 스킵', () => {
  const idx = buildWorkFileBasenameIndex([
    { id: 'c1', path: 'G:\\공유 드라이브\\사코팍\\윤서준.MOHO' },
    { id: 'c2', path: null },
    { id: '', path: 'G:\\x\\y.moho' },
  ]);
  assert.deepEqual([...idx.keys()], ['윤서준.moho']);
  assert.deepEqual([...idx.get('윤서준.moho')!], ['c1']);
});

test('동명 파일 콜리전 보고 + id 유니온', () => {
  const idx = buildWorkFileBasenameIndex([
    { id: 'c1', path: 'G:\\a\\미영.moho' },
    { id: 'c2', path: 'G:\\b\\미영.moho' },
    { id: 'c3', path: 'G:\\b\\광철.moho' },
  ]);
  const { ids, collisions } = resolveIdsForBasenames(idx, ['미영.moho', '광철.moho', '없는파일.moho']);
  assert.deepEqual(ids.sort(), ['c1', 'c2', 'c3']);
  assert.deepEqual(collisions, ['미영.moho']);
});

test('빈 입력 방어', () => {
  const idx = buildWorkFileBasenameIndex([]);
  assert.deepEqual(resolveIdsForBasenames(idx, []), { ids: [], collisions: [] });
});
