import test from 'node:test';import assert from 'node:assert/strict';import { randomUUID } from 'node:crypto';
import { createBackgroundStore } from '../src/features/backgrounds/useBackgroundStore.ts';
import { emptyBackgroundSnapshot,applyBackgroundCommand,BackgroundUnsupportedError } from '../src/features/backgrounds/domain.ts';
import type { BackgroundCommand,BackgroundMap,BackgroundNode,BackgroundSnapshot } from '../src/features/backgrounds/types.ts';
const command=():BackgroundCommand=>({type:'save',kind:'place',entity:{id:randomUUID(),revision:0,name:'학교',parentId:null,folderPath:''},expectedRevision:null});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};}
test('저장 중 즉시 화면 반영하고 실패하면 원래 내용으로 돌아간다',async()=>{const store=createBackgroundStore(),pending=deferred<BackgroundSnapshot>();await store.getState().initialize('alice',{read:async()=>emptyBackgroundSnapshot(true),execute:()=>pending.promise});const action=store.getState().execute(command());assert.equal(store.getState().snapshot.places.length,1);assert.equal(store.getState().pending,true);pending.reject(new Error('저장 실패'));await assert.rejects(action,/실패/);assert.equal(store.getState().snapshot.places.length,0);assert.equal(store.getState().pending,false);assert.match(store.getState().error!,/실패/);});
test('이전 로그인 사용자의 늦은 응답은 새 화면을 덮어쓰지 않는다',async()=>{const store=createBackgroundStore(),response=deferred<BackgroundSnapshot>();await store.getState().initialize('alice',{read:async()=>emptyBackgroundSnapshot(true),execute:()=>response.promise});const c=command(),action=store.getState().execute(c);await store.getState().initialize('bob',{read:async()=>emptyBackgroundSnapshot(false),execute:async()=>emptyBackgroundSnapshot(false)});response.resolve(applyBackgroundCommand(emptyBackgroundSnapshot(true),c,{canManage:true}));await assert.rejects(action,/세션/);assert.equal(store.getState().actorId,'bob');assert.equal(store.getState().snapshot.canManage,false);assert.equal(store.getState().snapshot.places.length,0);});
test('오래된 새로고침 응답은 저장 결과를 덮어쓰지 않는다',async()=>{const store=createBackgroundStore(),slow=deferred<BackgroundSnapshot>();let count=0,current=emptyBackgroundSnapshot(true);await store.getState().initialize('alice',{read:async()=>++count===2?slow.promise:current,execute:async r=>{current=applyBackgroundCommand(current,r.command,{canManage:true});return current;}});const refresh=store.getState().refresh();await store.getState().execute(command());slow.resolve(emptyBackgroundSnapshot(true));await refresh;assert.equal(store.getState().snapshot.places.length,1);});
test('실패 복구 중 도착한 동료 수정 신호를 다시 조회하고 오류 안내는 보존한다',async()=>{
 const store=createBackgroundStore(),recovery=deferred<BackgroundSnapshot>();let reads=0,notify=()=>{};const updated=applyBackgroundCommand(emptyBackgroundSnapshot(true),command(),{canManage:true});
 await store.getState().initialize('alice',{read:async()=>{reads++;return reads===1?emptyBackgroundSnapshot(true):reads===2?recovery.promise:updated;},execute:async()=>{throw new Error('수정 충돌');},subscribe:listener=>{notify=listener;return()=>{};}});
 const action=store.getState().execute(command());await Promise.resolve();notify();recovery.resolve(emptyBackgroundSnapshot(true));await assert.rejects(action,/충돌/);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reads,3);assert.deepEqual(store.getState().snapshot,updated);assert.match(store.getState().error!,/충돌/);
});
test('실패 복구 조회의 잘못된 데이터는 store에 반영하지 않는다',async()=>{
 const store=createBackgroundStore();let reads=0;const before=emptyBackgroundSnapshot(true);
 await store.getState().initialize('alice',{read:async()=>++reads===1?before:{...before,places:null} as unknown as BackgroundSnapshot,execute:async()=>{throw new Error('실패');}});
 await assert.rejects(store.getState().execute(command()),/실패/);assert.deepEqual(store.getState().snapshot,before);
});

test('도면 묶음 저장은 응답을 잃어도 복구 조회에서 정확한 커밋을 확인하면 완료한다', async () => {
  const store = createBackgroundStore();
  let current = emptyBackgroundSnapshot(true);
  const request: BackgroundCommand = { type: 'save-maps', maps: [{ entity: { id: randomUUID(), revision: 0, name: '새 도면', parentId: null, placeId: null, imageUrl: '', nodes: [] }, expectedRevision: null }] };
  await store.getState().initialize('admin', {
    read: async () => current,
    execute: async ({command}) => { current = applyBackgroundCommand(current, command, {canManage:true}); throw new Error('응답 유실'); },
  });
  await store.getState().execute(request);
  assert.equal(store.getState().snapshot.maps.length, 1);
  assert.equal(store.getState().snapshot.maps[0].revision, 1);
  assert.equal(store.getState().pending, false);
  assert.equal(store.getState().error, null);
});
test('도면 저장 복구 중 동료가 더 수정한 상태는 내 저장 성공으로 오인하지 않는다', async () => {
  const store = createBackgroundStore();
  let current = emptyBackgroundSnapshot(true);
  const request: BackgroundCommand = { type: 'save-maps', maps: [{ entity: { id: randomUUID(), revision: 0, name: '새 도면', parentId: null, placeId: null, imageUrl: '', nodes: [] }, expectedRevision: null }] };
  await store.getState().initialize('admin', {
    read: async () => current,
    execute: async ({command}) => {
      current = applyBackgroundCommand(current, command, {canManage:true});
      current = applyBackgroundCommand(current, {type:'save-maps',maps:[{entity:{...current.maps[0],name:'동료 변경'},expectedRevision:1}]}, {canManage:true});
      throw new Error('응답 유실');
    },
  });
  await assert.rejects(store.getState().execute(request), /응답 유실/);
  assert.equal(store.getState().snapshot.maps[0].name, '동료 변경');
  assert.equal(store.getState().snapshot.maps[0].revision, 2);
});

function tallMap(): BackgroundMap {
  const room: BackgroundNode = { id: randomUUID(), type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 110, width: 470, height: 300, rotation: 0, shape: 'rect', points: [], locked: false, elevation: -12.5, volumeHeight: 260.75 };
  return { id: randomUUID(), revision: 0, name: '입체 도면', parentId: null, placeId: null, imageUrl: '', nodes: [room,
    { id: randomUUID(), type: 'camera', name: '내려다보는 카메라', spaceId: room.id, x: 500, y: 340, angle: 90, fov: 55, viewIds: [], locked: false, elevation: 120.25, pitch: -90, roll: -33.5, aspect: 16 / 9 },
    { id: randomUUID(), type: 'symbol', name: '책상', symbol: 'table', spaceId: room.id, x: 200, y: 200, width: 120, height: 60, rotation: 15, locked: false, hinge: 'left', swing: 'inward', elevation: 35.125, volumeHeight: 80.5, pitch: -45.5, roll: 12.25 },
    { id: randomUUID(), type: 'camera', name: '평면 카메라', spaceId: null, x: 10, y: 20, angle: 0, fov: 60, viewIds: [], locked: false },
  ] };
}
// What a server reply looks like to the renderer: plain JSON, never the objects that were sent.
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('높이·기울기 값을 가진 도면은 저장 중 화면, 저장 응답, 응답 유실 복구에서 모두 보낸 값 그대로다', async () => {
  const store = createBackgroundStore(), reply = deferred<BackgroundSnapshot>(), entity = tallMap(), sent = structuredClone(entity);
  let current = emptyBackgroundSnapshot(true), lose = false;
  await store.getState().initialize('admin', {
    read: async () => wire(current),
    execute: async ({command}) => { current = applyBackgroundCommand(current, command, {canManage:true}); if (lose) throw new Error('응답 유실'); return reply.promise; },
  });
  const saving = store.getState().execute({ type: 'save-maps', maps: [{ entity, expectedRevision: null }] });
  assert.equal(store.getState().pending, true);
  assert.deepEqual(store.getState().snapshot.maps, [{ ...sent, revision: 1 }]);
  reply.resolve(wire(current)); await saving;
  assert.deepEqual(store.getState().snapshot.maps, [{ ...sent, revision: 1 }]);
  // Rename only, and this time the reply never arrives.
  lose = true;
  await store.getState().execute({ type: 'save-maps', maps: [{ entity: { ...store.getState().snapshot.maps[0], name: '이름만 변경' }, expectedRevision: 1 }] });
  assert.deepEqual(store.getState().snapshot.maps, [{ ...sent, name: '이름만 변경', revision: 2 }]);
  assert.equal(store.getState().pending, false); assert.equal(store.getState().error, null); assert.deepEqual(entity, sent);
});
test('복구 조회의 높이 값이 보낸 값과 하나라도 다르면 저장 완료로 보지 않고 서버 값을 보여 준다', async () => {
  for (const alter of [(camera: Record<string, number>) => { camera.pitch = 0; }, (camera: Record<string, number>) => { delete camera.roll; }]) {
    const store = createBackgroundStore(), entity = tallMap();
    let current = emptyBackgroundSnapshot(true);
    await store.getState().initialize('admin', {
      read: async () => wire(current),
      execute: async ({command}) => { current = applyBackgroundCommand(current, command, {canManage:true}); alter(current.maps[0].nodes[1] as unknown as Record<string, number>); throw new Error('응답 유실'); },
    });
    await assert.rejects(store.getState().execute({ type: 'save-maps', maps: [{ entity, expectedRevision: null }] }), /응답 유실/);
    assert.deepEqual(store.getState().snapshot.maps, current.maps); assert.notDeepEqual(store.getState().snapshot.maps[0].nodes[1], entity.nodes[1]);
    assert.match(store.getState().error!, /응답 유실/); assert.equal(store.getState().pending, false);
  }
});
test('조회 결과의 높이 값이 잘못되면 화면에 반영하지 않고 마지막으로 확인한 도면을 유지한다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), good = { ...emptyBackgroundSnapshot(true), maps: [{ ...tallMap(), revision: 1 }] };
  let broken = false;
  await store.getState().initialize('admin', { read: async () => { const value = wire(good); if (broken) (value.maps[0].nodes[1] as unknown as Record<string, unknown>).pitch = '아래'; return value; }, execute: async () => good });
  assert.deepEqual(store.getState().snapshot, good);
  broken = true; assert.equal(await store.getState().refresh(), false);
  assert.deepEqual(store.getState().snapshot, good); assert.match(store.getState().error!, /위아래 각도/);
  assert.equal(store.getState().updateRequired, false); assert.equal(warn.mock.callCount(), 0);
});

// A library with one map (room, camera, table, camera), and what this version reads once a newer app has saved one of
// its nodes: the same library with that node changed.
const library = (): BackgroundSnapshot => ({ ...emptyBackgroundSnapshot(true), maps: [{ ...tallMap(), revision: 1 }] });
const newer = (snapshot: BackgroundSnapshot, node: number, change: Record<string, unknown>): BackgroundSnapshot => {
  const value = wire(snapshot); Object.assign(value.maps[0].nodes[node], change); return value;
};
const UNKNOWN_SYMBOL = ['[background] update required:', '사물 기호가 올바르지 않습니다.', 'value "elevator"'];
const UNKNOWN_KEY = ['[background] update required:', '지원하지 않는 배경 속성이 포함되어 있습니다.', 'keys "future"'];

test('첫 조회에 이 버전이 모르는 기호 종류가 있으면 오류 대신 업데이트 안내를 켜고 저장을 막으며, 까닭은 콘솔에 한 번만 남긴다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), stored = newer(library(), 2, { symbol: 'elevator' });
  let executes = 0;
  await store.getState().initialize('admin', { read: async () => wire(stored), execute: async () => { executes++; return emptyBackgroundSnapshot(true); } });
  assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().error, null); assert.equal(store.getState().loading, false);
  assert.deepEqual(store.getState().snapshot, emptyBackgroundSnapshot());
  await assert.rejects(store.getState().execute(command()), /업데이트/);
  assert.equal(executes, 0); assert.equal(store.getState().pending, false); assert.deepEqual(store.getState().snapshot, emptyBackgroundSnapshot());
  assert.equal(warn.mock.callCount(), 1); assert.deepEqual(warn.mock.calls[0].arguments, UNKNOWN_SYMBOL);
  // The screen reads again every 15 seconds, on focus and on every change signal: none of those may write the line again.
  assert.equal(await store.getState().refresh(), false); assert.equal(await store.getState().refresh(), false);
  assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().error, null); assert.equal(warn.mock.callCount(), 1);
  // Signing out starts over: the next account reads for itself.
  await store.getState().initialize(null); assert.equal(store.getState().updateRequired, false);
});
test('잘 읽던 화면에 모르는 키가 든 응답이 오면 마지막으로 확인한 자료를 둔 채 안내를 켜고, 꺼졌다가 다시 켜질 때마다 한 번씩 적는다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), good = library();
  let unknown = false;
  await store.getState().initialize('admin', { read: async () => unknown ? newer(good, 0, { future: 1 }) : wire(good), execute: async () => good });
  assert.deepEqual(store.getState().snapshot, good); assert.equal(store.getState().updateRequired, false);
  unknown = true; assert.equal(await store.getState().refresh(), false);
  assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().error, null); assert.deepEqual(store.getState().snapshot, good);
  assert.equal(warn.mock.callCount(), 1); assert.deepEqual(warn.mock.calls[0].arguments, UNKNOWN_KEY);
  assert.equal(await store.getState().refresh(), false); assert.equal(store.getState().updateRequired, true); assert.equal(warn.mock.callCount(), 1);
  unknown = false; assert.equal(await store.getState().refresh(), true);
  assert.equal(store.getState().updateRequired, false); assert.equal(store.getState().error, null); assert.deepEqual(store.getState().snapshot, good);
  assert.equal(warn.mock.callCount(), 1);
  unknown = true; assert.equal(await store.getState().refresh(), false);
  assert.equal(store.getState().updateRequired, true); assert.equal(warn.mock.callCount(), 2); assert.deepEqual(warn.mock.calls[1].arguments, UNKNOWN_KEY);
});
test('오류 문장이 떠 있던 화면에 모르는 키가 든 응답이 오면 문장을 지우고 안내만 남긴다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), good = library();
  let change: Record<string, unknown> = {};
  await store.getState().initialize('admin', { read: async () => newer(good, 0, change), execute: async () => good });
  change = { x: 'a' }; assert.equal(await store.getState().refresh(), false);
  assert.match(store.getState().error!, /가로 좌표/); assert.equal(store.getState().updateRequired, false); assert.equal(warn.mock.callCount(), 0);
  change = { future: 1 }; assert.equal(await store.getState().refresh(), false);
  assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().error, null); assert.deepEqual(store.getState().snapshot, good);
  assert.equal(warn.mock.callCount(), 1); assert.deepEqual(warn.mock.calls[0].arguments, UNKNOWN_KEY);
});
test('저장 응답과 복구 조회가 모두 모르는 종류를 담고 있으면 저장 전 자료로 돌아가 안내를 켜고, 응답에서 걸린 까닭을 한 번 적는다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), good = library();
  let reads = 0;
  await store.getState().initialize('admin', {
    read: async () => ++reads === 1 ? wire(good) : newer(good, 2, { symbol: 'escalator' }),
    execute: async () => newer(good, 2, { symbol: 'elevator' }),
  });
  // The original error is thrown again: the one from the reply, not the one from the recovery read.
  await assert.rejects(store.getState().execute(command()), (error: unknown) => error instanceof BackgroundUnsupportedError && error.detail === 'value "elevator"');
  assert.equal(reads, 2); assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().pending, false); assert.equal(store.getState().error, null);
  assert.deepEqual(store.getState().snapshot, good);
  assert.equal(warn.mock.callCount(), 1); assert.deepEqual(warn.mock.calls[0].arguments, UNKNOWN_SYMBOL);
});
test('저장이 다른 까닭으로 거절돼도 복구 조회에 모르는 키가 있으면 안내를 켜고, 원래 오류로 거절한다', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const store = createBackgroundStore(), good = library();
  let reads = 0;
  await store.getState().initialize('admin', {
    read: async () => ++reads === 1 ? wire(good) : newer(good, 0, { future: 1 }),
    execute: async () => { throw new Error('수정 충돌'); },
  });
  await assert.rejects(store.getState().execute(command()), /충돌/);
  assert.equal(store.getState().updateRequired, true); assert.equal(store.getState().pending, false); assert.equal(store.getState().error, null);
  assert.deepEqual(store.getState().snapshot, good);
  assert.equal(warn.mock.callCount(), 1); assert.deepEqual(warn.mock.calls[0].arguments, UNKNOWN_KEY);
});
