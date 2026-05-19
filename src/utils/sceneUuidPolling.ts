/**
 * v1.25.12 — 옵티미스틱 추가된 씬의 UUID 가 채워질 때까지 폴링하는 헬퍼.
 *
 * 배경:
 *  addScene 호출 후 syncInBackground 로 UUID 가 채워지는데, 그 사이에
 *  이미지 업로드 같은 후속 작업이 sceneIndex 기반 UUID 해석을 하면
 *  resolveSceneUuid 가 throw 한다 ("씬 UUID를 찾을 수 없음").
 *  이 헬퍼는 store 를 짧은 간격으로 폴링해 UUID 가 채워질 때까지 기다리고,
 *  타임아웃이면 null 을 반환해 호출자가 사용자에게 명확한 토스트를 띄울 수 있게 한다.
 *
 * 테스트 격리:
 *  store getter 를 의존성 주입으로 받는 inner form 을 export 한다.
 *  실 사용은 supabaseService.ts 에서 useDataStore.getState 를 주입해 호출.
 */

interface SceneLike {
  sceneId: string;
  id?: string;
}
interface PartLike {
  sheetName: string;
  scenes: SceneLike[];
}
interface StoreLike {
  episodes: { parts: PartLike[] }[];
}

export async function waitForSceneUuidWithStore(
  getStore: () => StoreLike,
  sheetName: string,
  sceneId: string,
  timeoutMs: number = 2000,
  intervalMs: number = 100,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const store = getStore();
    const part = store.episodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
    const scene = part?.scenes.find((s) => s.sceneId === sceneId);
    if (scene?.id) return scene.id;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
