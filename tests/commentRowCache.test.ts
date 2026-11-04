import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCommentRowOp,
  buildSheetCommentStore,
  countCommentRowsByScene,
  createCommentRowCache,
  isCommentsInvalidationRelevant,
  normalizeCommentBroadcastChange,
  normalizeRealtimeCommentChange,
  type CommentRow,
} from '../src/utils/commentRowCache.ts';
import type { Part } from '../src/types/index.ts';

function row(id: string, extra: Partial<CommentRow> = {}): CommentRow {
  return {
    id,
    partId: 'part-bg',
    sceneId: '1',
    userId: 'u1',
    userName: '원동우',
    text: `본문 ${id}`,
    mentions: [],
    images: [],
    createdAt: '2026-11-04T01:00:00.000Z',
    editedAt: null,
    revisionId: null,
    parentCommentId: null,
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('같은 파트를 동시에 부르면 서버 요청은 한 번이고, 받은 뒤에는 캐시에서 돌려준다', async () => {
  const calls: string[] = [];
  const cache = createCommentRowCache({ read: async (partId) => { calls.push(partId); return [row('c1')]; } });
  const [a, b] = await Promise.all([cache.load('part-bg'), cache.load('part-bg')]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  await cache.load('part-bg');
  assert.equal(calls.length, 1, '캐시에 있으면 다시 읽지 않는다');
});

test('끼워 넣기·바꾸기·빼기는 캐시만 고치고, 같은 변경을 두 번 받아도 한 번만 바뀐다', async () => {
  let reads = 0;
  const cache = createCommentRowCache({ read: async () => { reads += 1; return [row('c1'), row('c2', { parentCommentId: 'c1' })]; } });
  await cache.load('part-bg');

  assert.deepEqual(cache.apply({ kind: 'upsert', row: row('c3') }), ['part-bg']);
  assert.deepEqual(cache.apply({ kind: 'upsert', row: row('c3') }), [], '실시간과 방송이 같은 댓글을 두 번 줘도 한 번만');
  assert.equal(cache.peek('part-bg')?.length, 3);

  assert.deepEqual(cache.apply({ kind: 'patch', id: 'c1', fields: { text: '고침', editedAt: '2026-11-04T02:00:00.000Z' } }), ['part-bg']);
  assert.equal(cache.findById('c1')?.text, '고침');
  assert.deepEqual(cache.apply({ kind: 'patch', id: 'nope', fields: { text: 'x' } }), [], '모르는 댓글 수정은 무시');

  assert.deepEqual(cache.apply({ kind: 'delete', id: 'c1' }), ['part-bg']);
  assert.equal(cache.findById('c1'), undefined);
  assert.equal(cache.findById('c2')?.parentCommentId, null, '부모가 지워진 답글은 일반 댓글로');
  assert.equal(reads, 1, '변경을 받는 동안 서버를 다시 읽지 않는다');
});

test('읽는 도중 도착한 변경은 결과에 덧씌운다', async () => {
  const gate = deferred<CommentRow[]>();
  const cache = createCommentRowCache({ read: () => gate.promise });
  const loading = cache.load('part-bg');
  cache.apply({ kind: 'upsert', row: row('new') });
  cache.apply({ kind: 'delete', id: 'old' });
  gate.resolve([row('old'), row('keep')]);
  const rows = await loading;
  assert.deepEqual(rows.map((r) => r.id).sort(), ['keep', 'new']);
  assert.deepEqual(cache.peek('part-bg')?.map((r) => r.id).sort(), ['keep', 'new']);
});

test('읽는 도중 무효화하면 결과는 부른 쪽에만 가고 캐시에는 남지 않는다', async () => {
  const gate = deferred<CommentRow[]>();
  let reads = 0;
  const cache = createCommentRowCache({ read: () => { reads += 1; return reads === 1 ? gate.promise : Promise.resolve([row('fresh')]); } });
  const loading = cache.load('part-bg');
  cache.invalidate('part-bg');
  gate.resolve([row('stale')]);
  assert.deepEqual((await loading).map((r) => r.id), ['stale']);
  assert.equal(cache.peek('part-bg'), undefined);
  assert.deepEqual((await cache.load('part-bg')).map((r) => r.id), ['fresh']);
});

test('읽기가 실패하면 캐시하지 않고 다음에 다시 읽는다', async () => {
  let reads = 0;
  const cache = createCommentRowCache({ read: async () => { reads += 1; if (reads === 1) throw new Error('down'); return [row('c1')]; } });
  await assert.rejects(cache.load('part-bg'));
  assert.equal(cache.peek('part-bg'), undefined);
  assert.equal((await cache.load('part-bg')).length, 1);
  assert.equal(reads, 2);
});

test('다른 파트로 옮겨 간 행은 예전 파트에서 빠진다', async () => {
  const cache = createCommentRowCache({ read: async (partId) => (partId === 'part-bg' ? [row('c1')] : []) });
  await cache.load('part-bg');
  await cache.load('part-act');
  const changed = cache.apply({ kind: 'upsert', row: row('c1', { partId: 'part-act' }) });
  assert.deepEqual(changed.sort(), ['part-act', 'part-bg']);
  assert.equal(cache.peek('part-bg')?.length, 0);
  assert.equal(cache.peek('part-act')?.length, 1);
});

test('순서가 뒤바뀐 신호: 수정 뒤에 늦게 온 추가 스냅샷은 수정을 되돌리지 않는다', async () => {
  const cache = createCommentRowCache({ read: async () => [] });
  await cache.load('part-bg');
  cache.apply({ kind: 'upsert', row: row('c1', { text: '고친 글', editedAt: '2026-11-04T02:00:00.000Z' }) });
  assert.deepEqual(cache.apply({ kind: 'upsert', row: row('c1', { text: '처음 글', editedAt: null }) }), [], '늦게 온 추가 방송');
  assert.equal(cache.findById('c1')?.text, '고친 글');
  assert.deepEqual(cache.apply({ kind: 'patch', id: 'c1', fields: { text: '더 이른 수정', editedAt: '2026-11-04T01:00:00.000Z' } }), []);
  assert.equal(cache.findById('c1')?.text, '고친 글');
  assert.deepEqual(cache.apply({ kind: 'patch', id: 'c1', fields: { text: '나중 수정', editedAt: '2026-11-04T03:00:00.000Z' } }), ['part-bg']);
  assert.equal(cache.findById('c1')?.text, '나중 수정');
});

test('순서가 뒤바뀐 신호: 지운 댓글은 늦게 온 추가 신호나 삭제 전에 시작한 조회로 되살아나지 않는다', async () => {
  const gate = deferred<CommentRow[]>();
  let reads = 0;
  const cache = createCommentRowCache({ read: () => { reads += 1; return reads === 1 ? Promise.resolve([row('c1')]) : gate.promise; } });
  await cache.load('part-bg');
  assert.deepEqual(cache.apply({ kind: 'delete', id: 'c1' }), ['part-bg']);
  assert.deepEqual(cache.apply({ kind: 'upsert', row: row('c1') }), [], '삭제 뒤에 온 추가 방송');
  assert.equal(cache.findById('c1'), undefined);
  // 다른 파트를 읽는 중 — 삭제 전에 시작한 조회가 지운 댓글을 돌려줘도 캐시에 넣지 않는다.
  const loading = cache.load('part-act');
  gate.resolve([row('c1', { partId: 'part-act' }), row('c2', { partId: 'part-act' })]);
  assert.deepEqual((await loading).map((r) => r.id), ['c2']);
});

test('applyCommentRowOp: 내용이 같으면 같은 배열을 돌려준다', () => {
  const rows = [row('c1')];
  const same = applyCommentRowOp(rows, { kind: 'upsert', row: row('c1') });
  assert.equal(same.changed, false);
  assert.equal(same.rows, rows);
  const unknownImages = applyCommentRowOp([row('c1', { images: undefined })], { kind: 'upsert', row: row('c1') });
  assert.equal(unknownImages.changed, true, '이미지 칸을 모르던 행이 실제 목록을 받으면 바뀐 것');
});

function scene(no: number, sceneId: string) {
  return { no, sceneId } as unknown as Part['scenes'][number];
}

test('buildSheetCommentStore: 상대 부서 댓글은 같은 씬 번호로 옮겨 붙이고, 모호하면 건너뛴다', () => {
  const bg: Part = { id: 'part-bg', partId: 'A', department: 'bg', sheetName: 'EP05_A_BG', scenes: [scene(1, 'a001'), scene(2, 'a002')] };
  const act: Part = { id: 'part-act', partId: 'A', department: 'acting', sheetName: 'EP05_A_ACT', scenes: [scene(7, 'a002'), scene(8, 'a001')] };
  const partByUuid = new Map([[bg.id!, bg], [act.id!, act]]);
  const bgRows = [row('b1', { sceneId: '1' })];
  const actRows = [row('x1', { partId: 'part-act', sceneId: '8' }), row('x2', { partId: 'part-act', sceneId: '99' })];
  const store = buildSheetCommentStore('EP05_A_BG', [bgRows, actRows], bg, partByUuid);
  assert.deepEqual(Object.keys(store), ['EP05_A_BG:1']);
  assert.deepEqual(store['EP05_A_BG:1'].map((c) => c.id), ['b1', 'x1']);
  assert.equal(store['EP05_A_BG:1'][1].storageKey, 'EP05_A_ACT:8', '실제 저장 위치를 기억한다');
});

test('countCommentRowsByScene: scene.no 별 개수', () => {
  const counts = countCommentRowsByScene([row('a', { sceneId: '1' }), row('b', { sceneId: '1' }), row('c', { sceneId: '2' })]);
  assert.equal(counts.get('1'), 2);
  assert.equal(counts.get('2'), 1);
});

test('실시간 이벤트 정리: 추가·수정은 행 전체로, 삭제는 id 로, 캐릭터는 따로', () => {
  const insert = normalizeRealtimeCommentChange({
    eventType: 'INSERT',
    new: { id: 'c1', part_id: 'p', scene_id: '3', user_id: 'u', user_name: '이혜민', text: 't', mentions: ['배한솔'], images: ['i'], created_at: '2026-11-04T00:00:00Z', edited_at: null, revision_id: null, parent_comment_id: 'root' },
  });
  assert.equal(insert.kind, 'op');
  if (insert.kind === 'op') {
    assert.equal(insert.op.kind, 'upsert');
    assert.equal(insert.action, 'add');
    if (insert.op.kind === 'upsert') assert.equal(insert.op.row.parentCommentId, 'root');
  }
  const del = normalizeRealtimeCommentChange({ eventType: 'DELETE', old: { id: 'c1' } });
  assert.deepEqual(del, { kind: 'op', op: { kind: 'delete', id: 'c1' }, partId: null, commentId: 'c1', action: 'delete' });
  const character = normalizeRealtimeCommentChange({ eventType: 'UPDATE', new: { id: 'c2', character_id: 'hero' } });
  assert.deepEqual(character, { kind: 'character', characterId: 'hero', commentId: 'c2', action: 'edit' });
  const partial = normalizeRealtimeCommentChange({ eventType: 'UPDATE', new: { id: 'c3', part_id: 'p' } });
  assert.deepEqual(partial, { kind: 'invalidate', partId: 'p', commentId: 'c3', action: 'edit' });
});

test('방송 정리: 예전 버전의 추가 방송(이미지·시각 없음)은 그 파트만 다시 읽게 한다', () => {
  const legacy = normalizeCommentBroadcastChange('comment-added', { commentId: 'c1', partId: 'p', sceneId: '3', text: 't', mentions: [] });
  assert.deepEqual(legacy, { kind: 'invalidate', partId: 'p', commentId: 'c1', action: 'add' });
  const full = normalizeCommentBroadcastChange('comment-added', { commentId: 'c1', partId: 'p', sceneId: '3', text: 't', mentions: [], images: [], createdAt: '2026-11-04T00:00:00Z', userId: 'u', userName: 'n' });
  assert.equal(full.kind, 'op');
  const characterAdd = normalizeCommentBroadcastChange('comment-added', { sceneId: 'char:hero', commentId: 'c9' });
  assert.deepEqual(characterAdd, { kind: 'character', characterId: 'hero', commentId: 'c9', action: 'add' });
  const updated = normalizeCommentBroadcastChange('comment-updated', { commentId: 'c1', partId: 'p', text: '새', mentions: ['a'], editedAt: '2026-11-04T01:00:00Z' });
  assert.deepEqual(updated, { kind: 'op', op: { kind: 'patch', id: 'c1', fields: { text: '새', mentions: ['a'], editedAt: '2026-11-04T01:00:00Z' } }, partId: 'p', commentId: 'c1', action: 'edit' });
  const deleted = normalizeCommentBroadcastChange('comment-deleted', { commentId: 'c1', partId: 'p' });
  assert.deepEqual(deleted, { kind: 'op', op: { kind: 'delete', id: 'c1' }, partId: 'p', commentId: 'c1', action: 'delete' });
  assert.deepEqual(normalizeCommentBroadcastChange('comment-deleted', { characterId: 'hero', commentId: 'c1' }), { kind: 'character', characterId: 'hero', commentId: 'c1', action: 'delete' });
});

test('무효화 신호는 자기 시트(상대 부서 포함)·자기 캐릭터 것만 받는다', () => {
  assert.equal(isCommentsInvalidationRelevant(undefined, { sheetNames: ['EP05_A_BG'] }), true, '전체 신호');
  assert.equal(isCommentsInvalidationRelevant({}, { characterId: 'hero' }), true, '전체 신호');
  assert.equal(isCommentsInvalidationRelevant({ sheetName: 'EP05_A_ACT' }, { sheetNames: ['EP05_A_BG'] }), true, '상대 부서');
  assert.equal(isCommentsInvalidationRelevant({ sheetName: 'EP06_A_BG' }, { sheetNames: ['EP05_A_BG'] }), false);
  assert.equal(isCommentsInvalidationRelevant({ sheetNames: ['EP06_A_BG', 'EP05_B_ACT'] }, { sheetNames: ['EP05_B_BG'] }), true);
  assert.equal(isCommentsInvalidationRelevant({ characterId: 'hero' }, { sheetNames: ['EP05_A_BG'] }), false, '씬 화면은 캐릭터 신호를 받지 않는다');
  assert.equal(isCommentsInvalidationRelevant({ characterId: 'hero' }, { characterId: 'hero' }), true);
  assert.equal(isCommentsInvalidationRelevant({ characterId: 'villain' }, { characterId: 'hero' }), false);
  assert.equal(isCommentsInvalidationRelevant({ sheetName: 'EP05_A_BG' }, { characterId: 'hero' }), false, '캐릭터 화면은 씬 신호를 받지 않는다');
  assert.equal(isCommentsInvalidationRelevant({ partIds: ['part-act'] }, { partIds: ['part-bg', 'part-act'] }), true);
  assert.equal(isCommentsInvalidationRelevant({ partIds: ['part-x'], sheetNames: ['EP09_A_BG'] }, { partIds: ['part-bg'] }), false);
});

test('어디 것인지 모르는 삭제 신호는 그 댓글을 보여 주는 화면만 받는다', () => {
  const detail = { commentId: 'c9', commentAction: 'delete' as const, unresolvedDelete: true };
  assert.equal(isCommentsInvalidationRelevant(detail, { characterId: 'hero', knownCommentIds: new Set(['c9']) }), true);
  assert.equal(isCommentsInvalidationRelevant(detail, { characterId: 'hero', knownCommentIds: new Set(['c1']) }), false);
  assert.equal(isCommentsInvalidationRelevant(detail, { sheetNames: ['EP05_A_BG'] }), false, '씬 목록 배지는 무관(씬 캐시에 없던 댓글)');
});
