/**
 * 캐릭터 현황판 정렬(직접 정한 순서 / 추가한 순서 / 최근 수정순 + 뒤집기) — 순수 정렬 단위 테스트 + 배선 고정.
 * 소스-문자열 검사 부분은 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterLastModifiedMs,
  sortCharactersForBoard,
  characterSortDirectionLabel,
  CHARACTER_SORT_MODE_LABELS,
} from '../src/utils/characterBoardSort.ts';
import { loadPersistedCharacterSort, savePersistedCharacterSort } from '../src/utils/characterViewPersist.ts';
import { groupsAfterCardDrop } from '../src/utils/characterTabGroups.ts';

type Ch = { id: string; createdAt: string; updatedAt: string };
type Co = { id: string; updatedAt: string };
type Im = { createdAt: string; updatedAt: string };

const ch = (id: string, createdAt: string, updatedAt = createdAt): Ch => ({ id, createdAt, updatedAt });
const ids = (list: { id: string }[]) => list.map((c) => c.id);
const NO_COSTUMES = new Map<string, Co[]>();
const NO_IMAGES = new Map<string, Im[]>();

// ─── 최근 수정 시각 ───

test('characterLastModifiedMs: 캐릭터·복장·복장 그림 중 가장 늦은 시각', () => {
  const c = ch('a', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  assert.equal(characterLastModifiedMs(c, [], NO_IMAGES), Date.parse('2026-07-02T00:00:00Z'));
  const costumes: Co[] = [{ id: 'k1', updatedAt: '2026-07-05T00:00:00Z' }, { id: 'k2', updatedAt: '2026-07-03T00:00:00Z' }];
  assert.equal(characterLastModifiedMs(c, costumes, NO_IMAGES), Date.parse('2026-07-05T00:00:00Z'));
  // 대표가 아닌 그림을 추가하면 복장 시각은 그대로라 그림의 추가 시각까지 본다.
  const images = new Map<string, Im[]>([['k2', [{ createdAt: '2026-07-09T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z' }]]]);
  assert.equal(characterLastModifiedMs(c, costumes, images), Date.parse('2026-07-09T00:00:00Z'));
});

test('characterLastModifiedMs: 깨진 시각은 건너뛰고, 전부 깨지면 0', () => {
  const c = ch('a', '2026-07-01T00:00:00Z', '엉뚱');
  assert.equal(characterLastModifiedMs(c, [], NO_IMAGES), Date.parse('2026-07-01T00:00:00Z'));
  assert.equal(characterLastModifiedMs(ch('b', '', ''), [{ id: 'k', updatedAt: '' }], NO_IMAGES), 0);
});

// ─── 정렬 ───

const A = ch('A', '2026-07-01T00:00:00Z', '2026-07-10T00:00:00Z');
const B = ch('B', '2026-07-03T00:00:00Z', '2026-07-04T00:00:00Z');
const C = ch('C', '2026-07-02T00:00:00Z', '2026-07-20T00:00:00Z');
const manualOrder = [B, A, C]; // 스토어(직접 정한) 순서

test('직접 정한 순서: 들어온 순서·배열 그대로', () => {
  const out = sortCharactersForBoard(manualOrder, 'manual', false, NO_COSTUMES, NO_IMAGES);
  assert.equal(out, manualOrder);
  // 뒤집기는 직접 정한 순서에 쓰지 않는다(버튼이 꺼져 있다) — 값이 와도 무시.
  assert.equal(sortCharactersForBoard(manualOrder, 'manual', true, NO_COSTUMES, NO_IMAGES), manualOrder);
});

test('추가한 순서: 먼저 추가한 것부터, 뒤집으면 최근 추가한 것부터', () => {
  assert.deepEqual(ids(sortCharactersForBoard(manualOrder, 'created', false, NO_COSTUMES, NO_IMAGES)), ['A', 'C', 'B']);
  assert.deepEqual(ids(sortCharactersForBoard(manualOrder, 'created', true, NO_COSTUMES, NO_IMAGES)), ['B', 'C', 'A']);
  // 원본 배열은 건드리지 않는다.
  assert.deepEqual(ids(manualOrder), ['B', 'A', 'C']);
});

test('최근 수정순: 방금 손댄 것부터, 뒤집으면 오래 안 건드린 것부터', () => {
  assert.deepEqual(ids(sortCharactersForBoard(manualOrder, 'modified', false, NO_COSTUMES, NO_IMAGES)), ['C', 'A', 'B']);
  assert.deepEqual(ids(sortCharactersForBoard(manualOrder, 'modified', true, NO_COSTUMES, NO_IMAGES)), ['B', 'A', 'C']);
});

test('최근 수정순: 복장을 고친 캐릭터가 앞으로 온다', () => {
  const byCharacter = new Map<string, Co[]>([['B', [{ id: 'kb', updatedAt: '2026-08-01T00:00:00Z' }]]]);
  assert.deepEqual(ids(sortCharactersForBoard(manualOrder, 'modified', false, byCharacter, NO_IMAGES)), ['B', 'C', 'A']);
});

test('같은 시각이면 직접 정한 순서를 유지(뒤집어도 같은 시각끼리는 그대로)', () => {
  const t = '2026-07-01T00:00:00Z';
  const tied = [ch('x', t), ch('y', t), ch('z', t)];
  assert.deepEqual(ids(sortCharactersForBoard(tied, 'created', false, NO_COSTUMES, NO_IMAGES)), ['x', 'y', 'z']);
  assert.deepEqual(ids(sortCharactersForBoard(tied, 'created', true, NO_COSTUMES, NO_IMAGES)), ['x', 'y', 'z']);
  assert.deepEqual(ids(sortCharactersForBoard(tied, 'modified', false, NO_COSTUMES, NO_IMAGES)), ['x', 'y', 'z']);
});

test('정렬 라벨: 메뉴 이름과 방향 안내', () => {
  assert.equal(CHARACTER_SORT_MODE_LABELS.manual, '직접 정한 순서');
  assert.equal(CHARACTER_SORT_MODE_LABELS.created, '추가한 순서');
  assert.equal(CHARACTER_SORT_MODE_LABELS.modified, '최근 수정순');
  assert.equal(characterSortDirectionLabel('created', false), '먼저 추가한 캐릭터부터');
  assert.equal(characterSortDirectionLabel('created', true), '최근 추가한 캐릭터부터');
  assert.equal(characterSortDirectionLabel('modified', false), '최근 수정한 캐릭터부터');
  assert.equal(characterSortDirectionLabel('modified', true), '오래 안 건드린 캐릭터부터');
});

// ─── 설정 기억 ───

test('정렬 설정 기억: node 환경 방어 + 스텁 왕복 + 알 수 없는 값 방어', () => {
  assert.equal(loadPersistedCharacterSort(), null);
  assert.doesNotThrow(() => savePersistedCharacterSort({ mode: 'modified', reversed: false }));
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  try {
    savePersistedCharacterSort({ mode: 'created', reversed: true });
    assert.equal(store.get('bflow_character_board_sort'), 'created-reversed');
    assert.deepEqual(loadPersistedCharacterSort(), { mode: 'created', reversed: true });
    savePersistedCharacterSort({ mode: 'modified', reversed: false });
    assert.deepEqual(loadPersistedCharacterSort(), { mode: 'modified', reversed: false });
    // 직접 정한 순서는 뒤집기가 없다 — 뒤집힌 채로 저장되지 않는다.
    savePersistedCharacterSort({ mode: 'manual', reversed: true });
    assert.equal(store.get('bflow_character_board_sort'), 'manual');
    assert.deepEqual(loadPersistedCharacterSort(), { mode: 'manual', reversed: false });
    store.set('bflow_character_board_sort', 'manual-reversed');
    assert.equal(loadPersistedCharacterSort(), null);
    store.set('bflow_character_board_sort', '이상한값');
    assert.equal(loadPersistedCharacterSort(), null);
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

// ─── 배선 고정 ───

const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');

test('현황판: 정렬 메뉴·뒤집기 버튼·기억', () => {
  assert.match(boardView, /loadPersistedCharacterSort\(\) \?\? DEFAULT_CHARACTER_SORT/);
  assert.match(boardView, /savePersistedCharacterSort\(next\)/);
  assert.match(boardView, /label="정렬 기준"/);
  assert.match(boardView, /aria-label="정렬 순서 뒤집기"/);
  // 뒤집기는 직접 정한 순서에서 꺼진다.
  assert.match(boardView, /disabled=\{heightCompareMode \|\| sort\.mode === 'manual'\}/);
  // 기준을 바꾸면 뒤집기는 풀린다(이미 고른 기준을 다시 누르면 그대로).
  assert.match(boardView, /if \(v !== sort\.mode\) changeSort\(\{ mode: v as CharacterSortMode, reversed: false \}\)/);
});

test('현황판: 정렬 결과가 카드·키 비교·사용자 탭·상세 창에 이어진다', () => {
  assert.match(boardView, /sortCharactersForBoard\(filtered, sort\.mode, sort\.reversed, byCharacter, imagesByCostume\)/);
  // 키 비교는 정렬 결과를 바탕으로 키 순서만 덧씌운다(같은 키·미설정끼리는 고른 정렬 순서).
  assert.match(boardView, /if \(!heightCompareMode\) return sortedCharacters;/);
  assert.match(boardView, /return sortedCharacters\.slice\(\)\.sort\(/);
  // 기존 앵커(characterTier2) 유지.
  assert.match(boardView, /const displayCharacters = useMemo/);
  assert.match(boardView, /displayCharacters\.map/);
  // 정렬 중에는 카드 끌어 옮기기를 끈다.
  assert.match(boardView, /const cardDragEnabled = sort\.mode === 'manual' && viewMode !== 'list'/);
  // 사용자 탭에도 정렬된 목록과 정렬 여부를 넘긴다.
  assert.match(boardView, /characters=\{sortedCharacters\}/);
  assert.match(boardView, /sorted=\{sort\.mode !== 'manual'\}/);
  // 상세 창 왼쪽 목록은 같은 정렬 — 필터 밖 캐릭터까지 정렬해 '전체 보기'에서도 이어진다(창은 연 순간을 붙든다).
  assert.match(boardView, /sortCharactersForBoard\(visibleCharacters, sort\.mode, sort\.reversed, byCharacter, imagesByCostume\)\.map\(\(c\) => c\.id\)/);
  assert.match(boardView, /orderIds=\{modalOrderIds\}/);
});

test('상세 창: 왼쪽 목록 순서는 연 순간의 스냅숏', () => {
  const modal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
  assert.match(modal, /orderIds\?: string\[\]/);
  assert.match(modal, /const \[orderSnapshot\] = useState\(/);
  assert.match(modal, /orderSnapshot\.get\(a\.id\)/);
});

test('사용자 탭 끌어 놓기: 직접 정한 순서에서는 지금처럼(그룹 이동 + 카드 앞으로)', () => {
  const groups = [
    { id: 'g1', name: '1', characterIds: ['a', 'b', 'c'] },
    { id: 'g2', name: '2', characterIds: ['d'] },
  ];
  // 같은 그룹 카드 위 → 그 카드 앞으로.
  assert.deepEqual(groupsAfterCardDrop(groups, 'c', 'g1', 'a', false)?.[0].characterIds, ['c', 'a', 'b']);
  // 같은 그룹 섹션 빈 곳 → 맨 뒤로.
  assert.deepEqual(groupsAfterCardDrop(groups, 'a', 'g1', null, false)?.[0].characterIds, ['b', 'c', 'a']);
  // 다른 그룹 카드 위 → 옮기고 그 카드 앞으로.
  const moved = groupsAfterCardDrop(groups, 'b', 'g2', 'd', false);
  assert.deepEqual(moved?.map((g) => g.characterIds), [['a', 'c'], ['b', 'd']]);
  // 미분류로 → 그룹에서 빠진다.
  assert.deepEqual(groupsAfterCardDrop(groups, 'd', null, 'x', false)?.map((g) => g.characterIds), [['a', 'b', 'c'], []]);
  // 자기 자신 위 → 무변경.
  assert.equal(groupsAfterCardDrop(groups, 'a', 'g1', 'a', false), null);
});

test('사용자 탭 끌어 놓기: 정렬 중에는 그룹 사이 옮기기만, 같은 그룹 안은 무시', () => {
  const groups = [
    { id: 'g1', name: '1', characterIds: ['a', 'b', 'c'] },
    { id: 'g2', name: '2', characterIds: ['d'] },
  ];
  assert.equal(groupsAfterCardDrop(groups, 'c', 'g1', 'a', true), null, '같은 그룹 카드 위');
  assert.equal(groupsAfterCardDrop(groups, 'a', 'g1', null, true), null, '같은 그룹 섹션');
  assert.equal(groupsAfterCardDrop(groups, 'u', null, 'v', true), null, '미분류끼리');
  // 다른 그룹 → 그룹 맨 뒤에 붙는다(카드 앞으로 끼우지 않는다 — 보이는 순서는 정렬이 정한다).
  assert.deepEqual(groupsAfterCardDrop(groups, 'b', 'g2', 'd', true)?.map((g) => g.characterIds), [['a', 'c'], ['d', 'b']]);
  assert.deepEqual(groupsAfterCardDrop(groups, 'u', 'g1', 'b', true)?.[0].characterIds, ['a', 'b', 'c', 'u']);
  assert.deepEqual(groupsAfterCardDrop(groups, 'a', null, null, true)?.[0].characterIds, ['b', 'c']);
});

test('사용자 탭 배선: 정렬 중 그룹 안 순서는 정렬대로, 놓기는 groupsAfterCardDrop 한 곳', () => {
  const groups = readFileSync('src/components/characters/CharacterTabGroupsView.tsx', 'utf8');
  assert.match(groups, /sorted\?: boolean/);
  assert.match(groups, /if \(group && sorted\) members\.sort\(/);
  assert.match(groups, /const next = groupsAfterCardDrop\(tab\.groups, dragId, groupId, targetId, sorted\);/);
  assert.match(groups, /const dropOnGroup = \(groupId: string \| null\) => applyCardDrop\(groupId, null\);/);
  assert.match(groups, /const dropOnCard = \(groupId: string \| null, targetId: string\) => applyCardDrop\(groupId, targetId\);/);
});

test('서버: 순서만 바뀐 경우 캐릭터 수정 시각을 그대로 두는 마이그레이션 기록', () => {
  const path = 'DEVLOG/migrations/2026-10-15-characters-updated-at-ignore-sort-order.sql';
  assert.ok(existsSync(path));
  const sql = readFileSync(path, 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_characters_updated_at\(\)/);
  assert.match(sql, /NEW\.updated_at := OLD\.updated_at;/);
  assert.match(sql, /EXECUTE FUNCTION public\.set_characters_updated_at\(\)/);
});

test('package.json: test:character 에 정렬 테스트 포함', () => {
  const pkg = readFileSync('package.json', 'utf8');
  assert.match(pkg, /\.\/tests\/characterBoardSort\.test\.ts/);
});
