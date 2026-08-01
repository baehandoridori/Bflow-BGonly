/**
 * 피드백 41: 캐릭터 현황판 탭·그룹 — 순수 헬퍼 유닛 테스트 + 배선 앵커.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeTabGroups, addGroup, renameGroup, removeGroup,
  moveCharacterToGroup, moveGroupBefore, reorderWithinGroup, groupedCharacterIdSet,
} from '../src/utils/characterTabGroups.ts';
import { computeEdgeScrollSpeed } from '../src/utils/dragAutoScroll.ts';

test('sanitizeTabGroups: JSONB 형식 방어', () => {
  assert.deepEqual(sanitizeTabGroups(null), []);
  assert.deepEqual(sanitizeTabGroups('문자열'), []);
  assert.deepEqual(
    sanitizeTabGroups([
      { id: 'g1', name: '주역', characterIds: ['a', 'a', 1, 'b'] },
      { id: 7, name: '형식 불량' },
      null,
    ] as unknown),
    [{ id: 'g1', name: '주역', characterIds: ['a', 'b'] }],
  );
});

test('그룹 CRUD + 멤버 이동 (탭 단위 불변 갱신)', () => {
  let groups = addGroup([], '주역');
  assert.equal(groups.length, 1);
  const gid = groups[0].id;
  groups = renameGroup(groups, gid, '주요 캐릭터');
  assert.equal(groups[0].name, '주요 캐릭터');
  groups = moveCharacterToGroup(groups, 'c1', gid);
  groups = moveCharacterToGroup(groups, 'c2', gid);
  assert.deepEqual(groups[0].characterIds, ['c1', 'c2']);
  // 다른 그룹으로 이동하면 원래 그룹에서 빠진다.
  groups = addGroup(groups, '조연');
  const gid2 = groups[1].id;
  groups = moveCharacterToGroup(groups, 'c1', gid2);
  assert.deepEqual(groups[0].characterIds, ['c2']);
  assert.deepEqual(groups[1].characterIds, ['c1']);
  // 미분류(null) 이동 = 모든 그룹에서 제거.
  groups = moveCharacterToGroup(groups, 'c1', null);
  assert.deepEqual(groups[1].characterIds, []);
  assert.deepEqual([...groupedCharacterIdSet(groups)], ['c2']);
  // 그룹 삭제 — 멤버십만 사라진다.
  groups = removeGroup(groups, gid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, gid2);
});

test('reorderWithinGroup: 대상 앞 삽입 + 방어', () => {
  const base = [{ id: 'g', name: 'G', characterIds: ['a', 'b', 'c'] }];
  assert.deepEqual(reorderWithinGroup(base, 'g', 'c', 'a')[0].characterIds, ['c', 'a', 'b']);
  assert.deepEqual(reorderWithinGroup(base, 'g', 'a', 'a')[0].characterIds, ['a', 'b', 'c']);
  assert.deepEqual(reorderWithinGroup(base, 'g', 'x', 'a')[0].characterIds, ['a', 'b', 'c']);
  assert.deepEqual(reorderWithinGroup(base, '없는그룹', 'a', 'b')[0].characterIds, ['a', 'b', 'c']);
});

test('배선 앵커: 마이그레이션·Realtime·IPC·store', () => {
  const mig = readFileSync('DEVLOG/migrations/2026-07-26-character-board-tabs.sql', 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS character_board_tabs/);
  assert.match(mig, /groups\s+JSONB NOT NULL DEFAULT '\[\]'/);
  assert.match(mig, /ALTER PUBLICATION supabase_realtime ADD TABLE character_board_tabs/);
  const sb = readFileSync('electron/supabase.ts', 'utf8');
  assert.match(sb, /'episode_character_mapping', 'character_board_tabs'\] as const/);
  const main = readFileSync('electron/main.ts', 'utf8');
  assert.match(main, /ipcMain\.handle\('supabase:load-character-board-tabs'/);
  assert.match(main, /ipcMain\.handle\('supabase:update-character-board-tab'/);
  const preload = readFileSync('electron/preload.ts', 'utf8');
  assert.match(preload, /supabase:add-character-board-tab/);
  assert.match(preload, /supabase:delete-character-board-tab/);
  const store = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
  assert.match(store, /pendingTabFields/);
  assert.match(store, /updateTabGroups/);
  assert.match(store, /character_board_tabs/);
  const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.match(mock, /supabaseLoadCharacterBoardTabs/);
});

test('UI 앵커: 탭 스트립·그룹 뷰·검색 색인', () => {
  const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
  assert.match(boardView, /function BoardTabStrip/);
  assert.match(boardView, /const indexedIds = useMemo/);
  assert.match(boardView, /!indexedIds\?\.has\(c\.id\)/);
  assert.match(boardView, /<CharacterTabGroupsView/);
  const groupsView = readFileSync('src/components/characters/CharacterTabGroupsView.tsx', 'utf8');
  assert.match(groupsView, /미분류/);
  assert.match(groupsView, /moveCharacterToGroup/);
  assert.match(groupsView, /reorderWithinGroup/);
  assert.match(groupsView, /draggingIdRef/);
  assert.match(boardView, /data-board-scroll/);
  assert.match(boardView, /--board-sticky-h/);
  // 코덱스 1차 P2: 레일 높이는 100vh 가 아니라 스크롤포트 실측 기준이어야 한다.
  assert.match(boardView, /--board-scroll-h/);
  const rail = readFileSync('src/components/characters/CharacterGroupRail.tsx', 'utf8');
  assert.match(rail, /var\(--board-scroll-h, 100vh\)/);
  assert.match(rail, /loadPersistedRailCollapsed/);
  assert.match(rail, /transition-\[width\]/);
  assert.match(rail, /motion-reduce:transition-none/);
  assert.match(rail, /그룹 추가/);
  assert.match(groupsView, /moveGroupBefore/);
  assert.match(groupsView, /bindVerticalDragAutoScroll/);
  assert.match(groupsView, /scroll-mt-\[calc\(var\(--board-sticky-h,0px\)\+8px\)\]/);
  const persist = readFileSync('src/utils/characterViewPersist.ts', 'utf8');
  assert.match(persist, /bflow_character_rail_collapsed/);
});

test('moveGroupBefore: 레일 그룹 순서 변경 + 방어', () => {
  const g = (id: string) => ({ id, name: id.toUpperCase(), characterIds: [] });
  const base = [g('a'), g('b'), g('c')];
  assert.deepEqual(moveGroupBefore(base, 'c', 'a').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(moveGroupBefore(base, 'a', null).map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(moveGroupBefore(base, 'a', 'a').map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(moveGroupBefore(base, '없음', 'a').map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(moveGroupBefore(base, 'a', '없음').map((x) => x.id), ['a', 'b', 'c']);
});

test('computeEdgeScrollSpeed: 가장자리 근접 비례 속도', () => {
  assert.equal(computeEdgeScrollSpeed(500, 0, 1000), 0);
  assert.ok(computeEdgeScrollSpeed(10, 0, 1000) < 0);
  assert.ok(computeEdgeScrollSpeed(990, 0, 1000) > 0);
  assert.equal(computeEdgeScrollSpeed(0, 0, 1000), -14);
  assert.equal(computeEdgeScrollSpeed(1000, 0, 1000), 14);
  assert.ok(Math.abs(computeEdgeScrollSpeed(71, 0, 1000)) < 0.5);
});
