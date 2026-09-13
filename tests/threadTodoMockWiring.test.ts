/**
 * 피드백 58: 미리보기 mock(devElectronAPI) 의 팀 할 일 시나리오 — 로그인 전 거부, 추가/완료/해제, 사용자 전환으로 삭제 권한 거부·관리자 삭제.
 * tests/ganttMockWiring.test.ts 와 같은 방식으로 브라우저 전역을 흉내 내고 esbuild 로 mock 을 번들한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('mock: 팀 할 일 추가·완료·해제·삭제 권한이 서버 래퍼 규칙과 같다', async () => {
  const keys = ['window', 'document', 'navigator', 'BroadcastChannel'];
  const descriptors = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = new Map<string, string>();
  let tail = Promise.resolve();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const locks = { request<T>(_key: string, callback: () => Promise<T>): Promise<T> { const result = tail.then(() => callback()); tail = result.then(() => undefined, () => undefined); return result; } };
  const win = { localStorage: storage, electronAPI: undefined as any };
  for (const [key, value] of Object.entries({ window: win, document: { documentElement: { dataset: {} } }, navigator: { locks }, BroadcastChannel: undefined })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const bundle = await build({ stdin: { contents: "export { installDevElectronAPI } from './src/mocks/devElectronAPI.ts';", resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
    const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#thread-todo`);
    module.installDevElectronAPI();
    const api = win.electronAPI;
    const KEY = 'EP05:A:a001';

    // 로그인 전에는 거부.
    await assert.rejects(api.threadTodoList(KEY), /로그인/);

    // 배한솔(admin) 로그인 → 추가: 정제·작성자 스냅샷·신호 1회.
    await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
    let signals = 0;
    const unsubscribe = api.onThreadTodosChanged(() => { signals += 1; });
    const added = await api.threadTodoAdd(KEY, '  출력   크기 키우기 ');
    assert.equal(added.text, '출력 크기 키우기');
    assert.equal(added.created_by, '1');
    assert.equal(added.created_by_name, '배한솔');
    assert.equal(added.done_at, null);
    assert.equal(signals, 1);
    assert.deepEqual((await api.threadTodoList(KEY)).map((r: any) => r.id), [added.id]);
    assert.deepEqual(await api.threadTodoList('EP05:A:a002'), []);
    await assert.rejects(api.threadTodoAdd(KEY, '   '), /1~200자/);
    await assert.rejects(api.threadTodoAdd('', '할 일'), /대상이 올바르지/);

    // 완료: 최초 완료자 유지 → 해제: 세 칸 비움.
    const signalsBeforeDone = signals;
    const done1 = await api.threadTodoSetDone(added.id, true);
    assert.equal(signals, signalsBeforeDone + 1, '완료도 변경 신호를 보낸다');
    assert.equal(done1.done_by_name, '배한솔');
    assert.ok(done1.done_at);
    await api.loginCanonicalSession({ name: '장삐쭈', password: '1234' });
    await new Promise((resolve) => setTimeout(resolve, 5)); // 두 번째 체크가 다른 시각에 일어나도록
    const done2 = await api.threadTodoSetDone(added.id, true);
    assert.equal(done2.done_at, done1.done_at, '먼저 체크한 시각이 남는다');
    assert.equal(done2.done_by, '1', '먼저 체크한 사람의 id 가 남는다');
    assert.equal(done2.done_by_name, '배한솔', '먼저 체크한 사람이 남는다');
    const undone = await api.threadTodoSetDone(added.id, false);
    assert.equal(undone.done_at, null); assert.equal(undone.done_by, null); assert.equal(undone.done_by_name, null);

    // 삭제 권한: 장삐쭈(user)는 배한솔 항목을 못 지운다, 자기 항목은 지운다.
    await assert.rejects(api.threadTodoDelete(added.id), /내가 추가한/);
    const mine = await api.threadTodoAdd(KEY, '장삐쭈 항목');
    const signalsBeforeDelete = signals;
    assert.deepEqual(await api.threadTodoDelete(mine.id), { ok: true, deleted: true });
    assert.equal(signals, signalsBeforeDelete + 1, '삭제도 변경 신호를 보낸다');
    assert.deepEqual(await api.threadTodoDelete(mine.id), { ok: true, deleted: false });
    await assert.rejects(api.threadTodoSetDone(mine.id, true), /이미 지워진/);

    // 관리자(배한솔)는 남의 항목도 지운다.
    const theirs = await api.threadTodoAdd(KEY, '삭제될 항목');
    await api.loginCanonicalSession({ name: '배한솔', password: '1234' });
    assert.deepEqual(await api.threadTodoDelete(theirs.id), { ok: true, deleted: true });
    assert.deepEqual(await api.threadTodoDelete(added.id), { ok: true, deleted: true });
    assert.deepEqual(await api.threadTodoList(KEY), []);
    unsubscribe();
    const before = signals;
    await api.threadTodoAdd(KEY, '구독 해제 뒤');
    assert.equal(signals, before, '구독 해제 뒤에는 신호가 오지 않는다');
    // 코덱스 4차: 미리보기 새 창은 Electron 과 같은 #widget-popup 해시로 같은 앱을 브라우저 창에 연다
    const opened: Array<{ url: string; name: string; features: string }> = [];
    Object.assign(win, {
      location: { origin: 'http://localhost:5190', pathname: '/', search: '?preview=1' },
      open: (url: string, name: string, features: string) => { opened.push({ url, name, features }); return {}; },
    });
    assert.deepEqual(await api.widgetOpenPopup('character-board', '캐릭터 현황판'), { ok: true });
    assert.deepEqual(opened, [{ url: 'http://localhost:5190/?preview=1#widget-popup/character-board', name: 'bflow-widget-character-board', features: 'popup,width=1160,height=780' }]);
    Object.assign(win, { open: () => null });
    assert.deepEqual(await api.widgetOpenPopup('character-board', '캐릭터 현황판'), { ok: false }, '팝업이 막히면 ok:false');
  } finally {
    for (const key of keys) {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
