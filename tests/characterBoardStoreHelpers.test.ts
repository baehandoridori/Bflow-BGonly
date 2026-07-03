/**
 * 캐릭터 현황판 store 순수 헬퍼 동작 테스트 (소스 문자열 검사가 아니라 실제 실행 검증).
 * - rebuildByCharacter 구조적 공유 (H-3)
 * - pending 필드 보호 머지 (mergeIncomingWithPending / mergeEpisodeLinkPatchWithPending)
 * - 정렬 폴백 순서 (compareCharacters / compareCostumes)
 * - 에피소드 링크 조립 / realtime 매핑 파싱
 *
 * Date.now 의존(pending 만료)은 expiresAt 직접 조작으로 우회 — sleep 금지.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Character, CharacterCostume, EpisodeCharacterLink } from '../src/types/index.ts';
import {
  buildByCharacter,
  buildEpisodeLinks,
  compareCharacters,
  compareCostumes,
  mergeEpisodeLinkPatchWithPending,
  mergeIncomingWithPending,
  pendingLinkKey,
  rebuildByCharacter,
  rowToRealtimeMapping,
  sortCharacters,
  sortCostumes,
  trackPendingFields,
} from '../src/stores/characterBoardStoreHelpers.ts';
import type { PendingLocalField } from '../src/stores/characterBoardStoreHelpers.ts';

type Bucket = Map<string, Map<string, PendingLocalField>>;

function makeCostume(over: Partial<CharacterCostume> & { id: string; characterId: string }): CharacterCostume {
  return {
    name: over.id,
    versionNo: 1,
    designStage: 'waiting',
    riggingStage: 'waiting',
    featuredImageUrl: null,
    workFilePath: null,
    imageBackground: 'transparent',
    imageFit: { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, lockAspect: true },
    structureTags: [],
    assetTags: [],
    designAssignee: null,
    riggingAssignee: null,
    assignee: null,
    memo: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...over,
  };
}

function makeCharacter(over: Partial<Character> & { id: string }): Character {
  return {
    name: over.id,
    status: 'active',
    memo: null,
    workFolderPath: null,
    sortOrder: 0,
    episodeIds: [],
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...over,
  };
}

// ─── rebuildByCharacter (H-3 구조적 공유) ───

test('rebuildByCharacter groups costumes per character in sortOrder order, same as buildByCharacter', () => {
  const c1a = makeCostume({ id: 'c1a', characterId: 'ch1', sortOrder: 2 });
  const c1b = makeCostume({ id: 'c1b', characterId: 'ch1', sortOrder: 1 });
  const c2a = makeCostume({ id: 'c2a', characterId: 'ch2', sortOrder: 0 });

  // 빈 prev(초기 로드)에서도 동작해야 한다.
  const result = rebuildByCharacter(new Map(), [c1a, c1b, c2a]);
  assert.deepEqual([...result.keys()].sort(), ['ch1', 'ch2']);
  assert.deepEqual(result.get('ch1')!.map((c) => c.id), ['c1b', 'c1a']);
  assert.deepEqual(result.get('ch2')!.map((c) => c.id), ['c2a']);
  assert.deepEqual(result, buildByCharacter([c1a, c1b, c2a]));
});

test('rebuildByCharacter reuses previous array references for unchanged characters only', () => {
  const c1a = makeCostume({ id: 'c1a', characterId: 'ch1', sortOrder: 0 });
  const c1b = makeCostume({ id: 'c1b', characterId: 'ch1', sortOrder: 1 });
  const c2a = makeCostume({ id: 'c2a', characterId: 'ch2', sortOrder: 0 });
  const c3a = makeCostume({ id: 'c3a', characterId: 'ch3', sortOrder: 0 });
  const prev = rebuildByCharacter(new Map(), [c1a, c1b, c2a, c3a]);

  // ch1 의 복장 하나만 교체 — ch2/ch3 배열은 이전 Map 의 참조를 그대로 재사용해야 한다.
  const c1aChanged = { ...c1a, designStage: 'done' as const };
  const next = rebuildByCharacter(prev, [c1aChanged, c1b, c2a, c3a]);

  assert.notEqual(next, prev);
  assert.notEqual(next.get('ch1'), prev.get('ch1'), 'changed character should get a fresh array');
  assert.equal(next.get('ch1')![0].designStage, 'done');
  assert.equal(next.get('ch2'), prev.get('ch2'), 'unchanged character array reference should be reused');
  assert.equal(next.get('ch3'), prev.get('ch3'), 'unchanged character array reference should be reused');

  // 복장 추가/삭제(길이 변화)는 해당 캐릭터만 새 배열.
  const withAdded = rebuildByCharacter(next, [c1aChanged, c1b, c2a, c3a, makeCostume({ id: 'c2b', characterId: 'ch2', sortOrder: 1 })]);
  assert.notEqual(withAdded.get('ch2'), next.get('ch2'));
  assert.equal(withAdded.get('ch1'), next.get('ch1'));
  assert.equal(withAdded.get('ch3'), next.get('ch3'));
});

// ─── mergeIncomingWithPending ───

test('mergeIncomingWithPending returns incoming as-is when no pending exists', () => {
  const bucket: Bucket = new Map();
  const existing = { id: 'a', updatedAt: '2026-07-01T00:00:00Z', name: 'old' };
  const incoming = { id: 'a', updatedAt: '2026-07-02T00:00:00Z', name: 'new' };
  assert.equal(mergeIncomingWithPending(bucket, existing, incoming), incoming);
  assert.equal(mergeIncomingWithPending(bucket, undefined, incoming), incoming);
});

test('mergeIncomingWithPending keeps existing when incoming.updatedAt is older (stale guard)', () => {
  const bucket: Bucket = new Map();
  const existing = { id: 'a', updatedAt: '2026-07-02T00:00:00Z', name: 'newer' };
  const stale = { id: 'a', updatedAt: '2026-07-01T00:00:00Z', name: 'older' };
  assert.equal(mergeIncomingWithPending(bucket, existing, stale), existing);
});

test('mergeIncomingWithPending preserves local optimistic value while pending differs from incoming', () => {
  const bucket: Bucket = new Map();
  trackPendingFields(bucket, 'a', { name: 'local' });
  const existing = { id: 'a', updatedAt: '2026-07-01T00:00:00Z', name: 'local' };
  const incoming = { id: 'a', updatedAt: '2026-07-02T00:00:00Z', name: 'server' };
  const merged = mergeIncomingWithPending(bucket, existing, incoming);
  assert.equal(merged.name, 'local', 'pending-protected field should keep the local value');
  assert.equal(merged.updatedAt, '2026-07-02T00:00:00Z', 'non-pending fields follow incoming');
  assert.equal(bucket.get('a')!.has('name'), true, 'pending stays until echo arrives');
});

test('mergeIncomingWithPending clears pending once incoming echoes the local value', () => {
  const bucket: Bucket = new Map();
  trackPendingFields(bucket, 'a', { name: 'local' });
  const existing = { id: 'a', updatedAt: '2026-07-01T00:00:00Z', name: 'local' };
  const echo = { id: 'a', updatedAt: '2026-07-02T00:00:00Z', name: 'local' };
  const merged = mergeIncomingWithPending(bucket, existing, echo);
  assert.equal(merged.name, 'local');
  assert.equal(bucket.has('a'), false, 'pending bucket entry should be removed after echo');
});

test('mergeIncomingWithPending ignores expired pending fields (expiresAt manipulated, no sleep)', () => {
  const bucket: Bucket = new Map();
  trackPendingFields(bucket, 'a', { name: 'local' });
  bucket.get('a')!.get('name')!.expiresAt = Date.now() - 1;
  const existing = { id: 'a', updatedAt: '2026-07-01T00:00:00Z', name: 'local' };
  const incoming = { id: 'a', updatedAt: '2026-07-02T00:00:00Z', name: 'server' };
  const merged = mergeIncomingWithPending(bucket, existing, incoming);
  assert.equal(merged.name, 'server', 'expired pending must not protect the field');
  assert.equal(bucket.has('a'), false);
});

// ─── mergeEpisodeLinkPatchWithPending (버킷 파라미터화) ───

test('mergeEpisodeLinkPatchWithPending protects pending fields and passes the rest through', () => {
  const bucket: Bucket = new Map();
  trackPendingFields(bucket, pendingLinkKey('ch1', 3), { memo: 'local memo' });
  const links = new Map<string, EpisodeCharacterLink[]>([
    ['ch1', [{ episodeNumber: 3, memo: 'local memo', costumeId: null }]],
  ]);
  const patch = mergeEpisodeLinkPatchWithPending(bucket, links, 'ch1', 3, { memo: 'server memo', costumeId: 'co1' });
  assert.equal(patch.memo, 'local memo', 'pending memo should survive the remote patch');
  assert.equal(patch.costumeId, 'co1', 'non-pending field follows the patch');
  assert.equal(bucket.has(pendingLinkKey('ch1', 3)), true);
});

test('mergeEpisodeLinkPatchWithPending clears pending on echo and is a no-op without pending', () => {
  const bucket: Bucket = new Map();
  const links = new Map<string, EpisodeCharacterLink[]>([
    ['ch1', [{ episodeNumber: 3, memo: 'local memo', costumeId: null }]],
  ]);

  const plain = { memo: 'server memo' as string | null };
  assert.equal(mergeEpisodeLinkPatchWithPending(bucket, links, 'ch1', 3, plain), plain, 'no pending → patch returned as-is');

  trackPendingFields(bucket, pendingLinkKey('ch1', 3), { memo: 'local memo' });
  const echoed = mergeEpisodeLinkPatchWithPending(bucket, links, 'ch1', 3, { memo: 'local memo' });
  assert.equal(echoed.memo, 'local memo');
  assert.equal(bucket.has(pendingLinkKey('ch1', 3)), false, 'echo should clear the pending entry');
});

// ─── 정렬 폴백 순서 ───

test('compareCharacters falls back sortOrder → createdAt → name → id', () => {
  const base = { sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' };
  assert.ok(compareCharacters(
    makeCharacter({ id: 'x', sortOrder: 0 }),
    makeCharacter({ id: 'y', sortOrder: 1 }),
  ) < 0, 'sortOrder decides first');
  assert.ok(compareCharacters(
    makeCharacter({ id: 'x', ...base, createdAt: '2026-01-01T00:00:00Z' }),
    makeCharacter({ id: 'y', ...base, createdAt: '2026-01-02T00:00:00Z' }),
  ) < 0, 'createdAt breaks sortOrder ties');
  assert.ok(compareCharacters(
    makeCharacter({ id: 'x', ...base, name: 'a' }),
    makeCharacter({ id: 'y', ...base, name: 'b' }),
  ) < 0, 'name breaks createdAt ties');
  assert.ok(compareCharacters(
    makeCharacter({ id: 'a', ...base, name: 'same' }),
    makeCharacter({ id: 'b', ...base, name: 'same' }),
  ) < 0, 'id is the final tiebreaker');

  const sorted = sortCharacters([
    makeCharacter({ id: 'b', ...base, name: 'same' }),
    makeCharacter({ id: 'a', ...base, name: 'same' }),
  ]);
  assert.deepEqual(sorted.map((c) => c.id), ['a', 'b']);
});

test('compareCostumes falls back sortOrder → createdAt → name → id', () => {
  const base = { characterId: 'ch1', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' };
  assert.ok(compareCostumes(
    makeCostume({ id: 'x', characterId: 'ch1', sortOrder: 0 }),
    makeCostume({ id: 'y', characterId: 'ch1', sortOrder: 1 }),
  ) < 0);
  assert.ok(compareCostumes(
    makeCostume({ id: 'x', ...base, createdAt: '2026-01-01T00:00:00Z' }),
    makeCostume({ id: 'y', ...base, createdAt: '2026-01-02T00:00:00Z' }),
  ) < 0);
  assert.ok(compareCostumes(
    makeCostume({ id: 'x', ...base, name: 'a' }),
    makeCostume({ id: 'y', ...base, name: 'b' }),
  ) < 0);
  assert.ok(compareCostumes(
    makeCostume({ id: 'a', ...base, name: 'same' }),
    makeCostume({ id: 'b', ...base, name: 'same' }),
  ) < 0);

  const sorted = sortCostumes([
    makeCostume({ id: 'b', ...base, name: 'same' }),
    makeCostume({ id: 'a', ...base, name: 'same' }),
  ]);
  assert.deepEqual(sorted.map((c) => c.id), ['a', 'b']);
});

// ─── buildEpisodeLinks / rowToRealtimeMapping ───

test('buildEpisodeLinks groups mappings per character sorted by episodeNumber', () => {
  const links = buildEpisodeLinks([
    { characterId: 'ch1', episodeNumber: 5, memo: null, costumeId: null },
    { characterId: 'ch1', episodeNumber: 2, memo: 'm', costumeId: 'co' },
    { characterId: 'ch2', episodeNumber: 1, memo: null, costumeId: null },
  ]);
  assert.deepEqual(links.get('ch1'), [
    { episodeNumber: 2, memo: 'm', costumeId: 'co' },
    { episodeNumber: 5, memo: null, costumeId: null },
  ]);
  assert.deepEqual(links.get('ch2'), [{ episodeNumber: 1, memo: null, costumeId: null }]);
  assert.equal(buildEpisodeLinks([]).size, 0);
});

test('rowToRealtimeMapping parses valid rows and rejects/normalizes missing fields', () => {
  assert.deepEqual(
    rowToRealtimeMapping({ character_id: 'ch1', episode_number: 3, memo: 'm', costume_id: 'co' }),
    { characterId: 'ch1', episodeNumber: 3, memo: 'm', costumeId: 'co' },
  );
  // 필수 필드 결측/타입 불일치 → null (전체 재조립 fallback 신호)
  assert.equal(rowToRealtimeMapping(null), null);
  assert.equal(rowToRealtimeMapping({ character_id: 'ch1' }), null);
  assert.equal(rowToRealtimeMapping({ character_id: 'ch1', episode_number: '3' }), null);
  assert.equal(rowToRealtimeMapping({ episode_number: 3 }), null);
  // 선택 필드는 타입이 어긋나면 null 로 정규화
  assert.deepEqual(
    rowToRealtimeMapping({ character_id: 'ch1', episode_number: 3, memo: 7, costume_id: undefined }),
    { characterId: 'ch1', episodeNumber: 3, memo: null, costumeId: null },
  );
});
