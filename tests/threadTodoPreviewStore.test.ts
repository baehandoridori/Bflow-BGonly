/**
 * 피드백 58(코덱스 2차): 미리보기 팀 할 일 저장소 — 새로고침·다른 창 공유·서버 규칙 동일성.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THREAD_TODO_PREVIEW_CHANNEL,
  THREAD_TODO_PREVIEW_LOCK,
  THREAD_TODO_PREVIEW_STORAGE_KEY,
  createThreadTodoPreviewStore,
} from '../src/mocks/threadTodoPreviewStore.ts';

const KEY = 'EP05:A:a001';
const HANSOL = { id: '1', name: '배한솔', role: 'admin' };
const BBIJJU = { id: '2', name: '장삐쭈', role: 'user' };

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}
/** 같은 이름의 채널끼리 메시지를 주고받는 가짜 BroadcastChannel (보낸 채널 객체 자신에게는 오지 않음 — 브라우저와 같음). */
function channelBus() {
  const open = new Set<{ name: string; handlers: Array<(event: { data: unknown }) => void>; closed: boolean }>();
  return (name = THREAD_TODO_PREVIEW_CHANNEL) => () => {
    const self = { name, handlers: [] as Array<(event: { data: unknown }) => void>, closed: false };
    open.add(self);
    return {
      postMessage(data: unknown) { for (const other of open) if (other !== self && !other.closed && other.name === self.name) other.handlers.forEach((h) => h({ data })); },
      addEventListener(_type: 'message', handler: (event: { data: unknown }) => void) { self.handlers.push(handler); },
      close() { self.closed = true; open.delete(self); },
    };
  };
}
let idSeq = 0;
const ids = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`;

test('새로고침(새 저장소 인스턴스)해도 같은 저장 공간이면 목록이 남는다', async () => {
  const storage = memoryStorage();
  const first = createThreadTodoPreviewStore({ storage, locks: null, openChannel: null, newId: ids });
  const added = await first.add(HANSOL, KEY, '  출력   크기 키우기 ');
  assert.equal(added.text, '출력 크기 키우기');
  assert.ok(storage.values.get(THREAD_TODO_PREVIEW_STORAGE_KEY));
  const reloaded = createThreadTodoPreviewStore({ storage, locks: null, openChannel: null, newId: ids });
  assert.deepEqual((await reloaded.list(KEY)).map((r) => r.id), [added.id]);
  assert.deepEqual(await reloaded.list('EP05:A:a002'), []);
});

test('다른 창에는 변경 신호가 한 번 가고, 자기 창 구독자도 한 번만 받는다', async () => {
  const storage = memoryStorage();
  const bus = channelBus();
  const windowA = createThreadTodoPreviewStore({ storage, locks: null, openChannel: bus(), newId: ids });
  const windowB = createThreadTodoPreviewStore({ storage, locks: null, openChannel: bus(), newId: ids });
  let a = 0; let b = 0;
  const offA = windowA.subscribe(() => { a += 1; });
  const offB = windowB.subscribe(() => { b += 1; });
  const row = await windowA.add(HANSOL, KEY, '창 A 에서 추가');
  assert.equal(a, 1, '자기 창은 로컬 신호 1회(자기 방송은 무시)');
  assert.equal(b, 1, '다른 창은 방송 1회');
  assert.deepEqual((await windowB.list(KEY)).map((r) => r.text), ['창 A 에서 추가'], '다른 창도 같은 저장 공간을 읽는다');
  await windowB.setDone(BBIJJU, row.id, true);
  assert.deepEqual([a, b], [2, 2]);
  await windowA.remove(HANSOL, row.id);
  assert.deepEqual([a, b], [3, 3]);
  await windowA.remove(HANSOL, row.id); // 이미 없는 항목 — 신호 없음
  assert.deepEqual([a, b], [3, 3]);
  offA(); offB();
  await windowB.add(BBIJJU, KEY, '구독 해제 뒤');
  assert.deepEqual([a, b], [3, 3], '구독 해제 뒤에는 어느 창에도 신호가 오지 않는다');
});

test('쓰기는 창끼리 같은 잠금으로 직렬화한다 (잠금이 없으면 이 창 안에서 순서대로)', async () => {
  const storage = memoryStorage();
  const used: string[] = [];
  let tail = Promise.resolve();
  const locks = { request<T>(name: string, callback: () => Promise<T>): Promise<T> { used.push(name); const result = tail.then(() => callback()); tail = result.then(() => undefined, () => undefined); return result; } };
  const store = createThreadTodoPreviewStore({ storage, locks, openChannel: null, newId: ids });
  const [x, y] = await Promise.all([store.add(HANSOL, KEY, '하나'), store.add(BBIJJU, KEY, '둘')]);
  await store.setDone(HANSOL, x.id, true);
  await store.remove(BBIJJU, y.id);
  assert.deepEqual(used, [THREAD_TODO_PREVIEW_LOCK, THREAD_TODO_PREVIEW_LOCK, THREAD_TODO_PREVIEW_LOCK, THREAD_TODO_PREVIEW_LOCK]);
  assert.deepEqual((await store.list(KEY)).map((r) => r.text), ['하나']);
  const noLock = createThreadTodoPreviewStore({ storage: memoryStorage(), locks: null, openChannel: null, newId: ids });
  await Promise.all(Array.from({ length: 5 }, (_, i) => noLock.add(HANSOL, KEY, `항목 ${i}`)));
  assert.equal((await noLock.list(KEY)).length, 5);
});

test('서버 래퍼와 같은 규칙: 검증 문구·최초 완료자 유지·해제 세 칸·삭제 권한·없는 항목', async () => {
  let clock = 0;
  const store = createThreadTodoPreviewStore({ storage: memoryStorage(), locks: null, openChannel: null, newId: ids, now: () => `2026-09-14T00:00:0${clock++}.000Z` });
  await assert.rejects(store.list(''), /대상이 올바르지/);
  await assert.rejects(store.add(HANSOL, KEY, '   '), /1~200자/);
  await assert.rejects(store.add(HANSOL, 'k'.repeat(201), '할 일'), /대상이 올바르지/);
  const row = await store.add(HANSOL, KEY, '할 일');
  const done1 = await store.setDone(HANSOL, row.id, true);
  const done2 = await store.setDone(BBIJJU, row.id, true);
  assert.equal(done2.done_at, done1.done_at, '먼저 체크한 시각이 남는다');
  assert.equal(done2.done_by, '1');
  assert.equal(done2.done_by_name, '배한솔');
  const undone = await store.setDone(BBIJJU, row.id, false);
  assert.deepEqual([undone.done_at, undone.done_by, undone.done_by_name], [null, null, null]);
  await assert.rejects(store.remove(BBIJJU, row.id), /내가 추가한/);
  const mine = await store.add(BBIJJU, KEY, '장삐쭈 항목');
  assert.deepEqual(await store.remove(BBIJJU, mine.id), { ok: true, deleted: true });
  assert.deepEqual(await store.remove(BBIJJU, mine.id), { ok: true, deleted: false });
  await assert.rejects(store.setDone(BBIJJU, mine.id, true), /이미 지워진/);
  assert.deepEqual(await store.remove(HANSOL, row.id), { ok: true, deleted: true }, '관리자는 남의 항목도 지운다');
});

test('깨진 미리보기 데이터·잘못된 행은 무시하고, 저장소를 못 쓰면 이 창 메모리로 동작한다', async () => {
  const storage = memoryStorage();
  storage.setItem(THREAD_TODO_PREVIEW_STORAGE_KEY, '{not json');
  const store = createThreadTodoPreviewStore({ storage, locks: null, openChannel: null, newId: ids });
  assert.deepEqual(await store.list(KEY), []);
  storage.setItem(THREAD_TODO_PREVIEW_STORAGE_KEY, JSON.stringify([{ id: 'x' }]));
  assert.deepEqual(await store.list(KEY), []);
  const memoryOnly = createThreadTodoPreviewStore({ storage: null, locks: null, openChannel: null, newId: ids });
  await memoryOnly.add(HANSOL, KEY, '메모리');
  assert.equal((await memoryOnly.list(KEY)).length, 1);
  const throwing = { getItem(): string | null { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const blocked = createThreadTodoPreviewStore({ storage: throwing, locks: null, openChannel: null, newId: ids });
  await blocked.add(HANSOL, KEY, '막힌 저장소');
  assert.equal((await blocked.list(KEY)).length, 1);
});

// ── 코덱스 3차 ──
test('저장소 읽기는 되는데 쓰기가 실패하면, 이후엔 이 창 메모리를 기준으로 읽어 방금 한 변경이 되돌아가지 않는다', async () => {
  const persisted = JSON.stringify([]);
  let writes = 0;
  const readOnly = { getItem: () => persisted, setItem() { writes += 1; throw new Error('QuotaExceededError'); } };
  const store = createThreadTodoPreviewStore({ storage: readOnly, locks: null, openChannel: null, newId: ids });
  const first = await store.add(HANSOL, KEY, '첫 항목');
  assert.deepEqual((await store.list(KEY)).map((r) => r.id), [first.id], '쓰기 실패 직후 조회에도 남아 있다');
  const second = await store.add(HANSOL, KEY, '둘째 항목');
  await store.setDone(HANSOL, first.id, true);
  assert.deepEqual((await store.list(KEY)).map((r) => [r.text, r.done_by_name]), [['첫 항목', '배한솔'], ['둘째 항목', null]]);
  assert.deepEqual(await store.remove(HANSOL, second.id), { ok: true, deleted: true });
  assert.deepEqual((await store.list(KEY)).map((r) => r.text), ['첫 항목']);
  assert.equal(writes, 1, '실패한 뒤로는 저장소에 다시 쓰지 않는다');
});

// ── 코덱스 8차 ──
test('읽던 저장소가 도중에 막혀도 마지막으로 읽은 목록을 이 창 메모리로 유지한다', async () => {
  const storage = memoryStorage();
  const seeded = createThreadTodoPreviewStore({ storage, locks: null, openChannel: null, newId: ids });
  const kept = await seeded.add(HANSOL, KEY, '저장돼 있던 항목');
  let blocked = false;
  const flaky = {
    getItem(key: string) { if (blocked) throw new Error('SecurityError'); return storage.getItem(key); },
    setItem(key: string, value: string) { if (blocked) throw new Error('SecurityError'); storage.setItem(key, value); },
  };
  const store = createThreadTodoPreviewStore({ storage: flaky, locks: null, openChannel: null, newId: ids });
  assert.deepEqual((await store.list(KEY)).map((r) => r.id), [kept.id], '처음엔 저장소에서 읽는다');
  blocked = true;
  assert.deepEqual((await store.list(KEY)).map((r) => r.id), [kept.id], '막힌 뒤에도 마지막으로 읽은 목록이 남는다');
  const added = await store.add(HANSOL, KEY, '막힌 뒤 추가');
  assert.deepEqual((await store.list(KEY)).map((r) => r.id), [kept.id, added.id]);
});

// ── 코덱스 9차 ──
test('미리보기도 이모지 200자 할 일을 받는다', async () => {
  const store = createThreadTodoPreviewStore({ storage: memoryStorage(), locks: null, openChannel: null, newId: ids });
  const row = await store.add(HANSOL, KEY, '😀'.repeat(200));
  assert.equal(Array.from(row.text).length, 200);
  await assert.rejects(store.add(HANSOL, KEY, '😀'.repeat(201)), /1~200자/);
});
