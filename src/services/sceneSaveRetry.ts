/**
 * 씬 단계 저장의 자동 재전송 진행기 — 앱에 하나(움직임 폴리싱 20번 safety-net).
 *
 * 씬 목록 화면을 떠났다 돌아와도 같은 진행기를 써야 '같은 칸 재클릭은 마지막 값만'이 이어진다.
 * 그래서 화면(컴포넌트) 안이 아니라 모듈에 둔다. 규칙·수치는 src/utils/saveRetry.ts.
 *
 * - 저장을 기다리는 동안 받아오기가 옛 서버 값으로 덮지 않게, 칸 묶음마다 '다시 얹을 내 값'을 맡겨 둔다
 *   (holdPendingSceneValues → 데이터 스토어의 setEpisodes 가 keepPendingSceneValues 로 얹는다. src/utils/pendingSceneOverlay.ts).
 *   실시간으로 받은 씬 한 개의 행(서버 행 전체)도 keepPendingSceneFields 로 같은 규칙을 거친다(App 의 scenes UPDATE 처리).
 * - 앱 종료 직전(트레이 '종료'·'지금 업데이트')에는 재전송을 기다리던 저장을 지금 한 번 보낸다
 *   (이미 있는 종료 전 정리 통로 onBeforeQuitFlush — 메인이 최대 3초 기다려 준다).
 */
import type { Episode, Scene } from '@/types';
import {
  browserSaveRetryEnv,
  createSaveRetryController,
  type SaveRetryController,
  type SaveRetryJob,
} from '@/utils/saveRetry';
import { overlayPendingSceneFields, overlayPendingScenes, type PendingSceneOverlay } from '@/utils/pendingSceneOverlay';

const controller = createSaveRetryController(browserSaveRetryEnv());

let quitFlushHooked = false;
/** 처음 저장할 때 한 번만 건다(모듈을 읽는 시점에는 창 API 가 아직 없을 수 있다). */
function hookQuitFlush() {
  if (quitFlushHooked || typeof window === 'undefined') return;
  const off = window.electronAPI?.onBeforeQuitFlush?.(() => controller.flushNow());
  quitFlushHooked = typeof off === 'function';
}

export const sceneSaveRetry: SaveRetryController = {
  pendingCarry<C>(key: string) {
    return controller.pendingCarry<C>(key);
  },
  isRetrying(key: string) {
    return controller.isRetrying(key);
  },
  run<C>(key: string, job: SaveRetryJob<C>) {
    hookQuitFlush();
    return controller.run<C>(key, job);
  },
  flushNow() {
    return controller.flushNow();
  },
};

const pendingOverlays = new Map<string, PendingSceneOverlay>();

/** 칸 묶음(key)의 '다시 얹을 내 값'을 맡긴다. 같은 key 의 새 저장이 맡기면 앞 것은 바뀐다. 돌려준 함수로 푼다(내 것일 때만). */
export function holdPendingSceneValues(key: string, overlay: PendingSceneOverlay): () => void {
  pendingOverlays.set(key, overlay);
  return () => {
    if (pendingOverlays.get(key) === overlay) pendingOverlays.delete(key);
  };
}

/** 받아온 씬 목록에, 저장을 기다리는 내 값을 다시 얹는다(맡긴 것이 없으면 그대로). */
export function keepPendingSceneValues(episodes: Episode[]): Episode[] {
  return pendingOverlays.size === 0 ? episodes : overlayPendingScenes(episodes, pendingOverlays.values());
}

/** 실시간으로 받은 씬 한 개의 행(서버 행 전체)에도, 저장을 기다리는 내 값을 다시 얹는다. current 는 행을 얹기 전 화면의 그 씬. */
export function keepPendingSceneFields(sceneUuid: string, current: Scene | undefined, fields: Partial<Scene>): Partial<Scene> {
  return pendingOverlays.size === 0 ? fields : overlayPendingSceneFields(sceneUuid, current, fields, pendingOverlays.values());
}
