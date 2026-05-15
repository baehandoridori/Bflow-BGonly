import test from 'node:test';
import assert from 'node:assert/strict';

// v1.25.12 hotfix — 씬 추가 시 이미지 업로드 race condition 대비 폴링 헬퍼.
// 테스트 격리를 위해 supabaseService.ts(React/Electron 의존성 포함)가 아닌
// 순수 헬퍼 파일에서 import 한다.
import { waitForSceneUuidWithStore } from '../src/utils/sceneUuidPolling.ts';

type FakeScene = { sceneId: string; id?: string };
type FakePart = { sheetName: string; scenes: FakeScene[] };
type FakeStore = { episodes: { parts: FakePart[] }[] };

function makeStoreGetter(store: FakeStore): () => FakeStore {
  return () => store;
}

test('waitForSceneUuid: UUID가 이미 있으면 즉시 반환', async () => {
  const store: FakeStore = {
    episodes: [{ parts: [{ sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001', id: 'uuid-1' }] }] }],
  };
  const uuid = await waitForSceneUuidWithStore(makeStoreGetter(store), 'EP01_A_BG', 'a001', 1000);
  assert.equal(uuid, 'uuid-1');
});

test('waitForSceneUuid: UUID가 늦게 들어오면 폴링 후 반환', async () => {
  const store: FakeStore = {
    episodes: [{ parts: [{ sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001' }] }] }],
  };
  const getter = makeStoreGetter(store);
  // 200ms 후에 UUID 채움
  setTimeout(() => { store.episodes[0].parts[0].scenes[0].id = 'uuid-late'; }, 200);
  const start = Date.now();
  const uuid = await waitForSceneUuidWithStore(getter, 'EP01_A_BG', 'a001', 2000);
  const elapsed = Date.now() - start;
  assert.equal(uuid, 'uuid-late');
  assert.ok(elapsed >= 150 && elapsed < 700, `폴링 시간이 비정상: ${elapsed}ms`);
});

test('waitForSceneUuid: 타임아웃 시 null 반환', async () => {
  const store: FakeStore = {
    episodes: [{ parts: [{ sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001' }] }] }],
  };
  const uuid = await waitForSceneUuidWithStore(makeStoreGetter(store), 'EP01_A_BG', 'a001', 300);
  assert.equal(uuid, null);
});

test('waitForSceneUuid: 씬이 아예 없으면 폴링하다 타임아웃', async () => {
  const store: FakeStore = {
    episodes: [{ parts: [{ sheetName: 'EP01_A_BG', scenes: [] }] }],
  };
  const uuid = await waitForSceneUuidWithStore(makeStoreGetter(store), 'EP01_A_BG', 'a001', 200);
  assert.equal(uuid, null);
});

test('waitForSceneUuid: sheetName 매치 실패 시 폴링하다 타임아웃', async () => {
  const store: FakeStore = {
    episodes: [{ parts: [{ sheetName: 'EP01_A_BG', scenes: [{ sceneId: 'a001', id: 'uuid-1' }] }] }],
  };
  const uuid = await waitForSceneUuidWithStore(makeStoreGetter(store), 'EP01_A_ACT', 'a001', 200);
  assert.equal(uuid, null);
});
