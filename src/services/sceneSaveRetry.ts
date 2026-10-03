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
 * - 로그인 세션이 바뀌면(로그아웃·다른 사용자 로그인) 저장을 모두 그만두고 다시 얹을 값·표시도 지운다(endSceneSaveSession).
 *   앞 사람의 클릭 값·작성자 id 가 다음 사람 세션 중에 서버로 나가거나, 다음 사람의 받아오기 위에 얹히지 않게
 *   (코덱스 2차 지적 4172094259). 저장은 클릭한 순간의 세션을 붙잡아 두고 보내기 직전마다 확인한다(sceneSaveSession).
 *   직접 로그아웃할 때는 세션이 살아 있는 동안 기다리던 저장을 한 번 보내 본다(flushSceneSavesBeforeLogout).
 */
import type { Episode, Scene } from '@/types';
import {
  browserSaveRetryEnv,
  createSaveRetryController,
  flushNowWithin,
  type SaveRetryController,
  type SaveRetryJob,
} from '@/utils/saveRetry';
import { overlayPendingSceneFields, overlayPendingScenes, type PendingSceneOverlay } from '@/utils/pendingSceneOverlay';
import { createSaveSessionTracker, saveSessionUserChanged, type SaveSession } from '@/utils/saveSession';
import { useAuthStore } from '@/stores/useAuthStore';
import { useStageSaveStatusStore } from '@/stores/useStageSaveStatusStore';

const retryEnv = browserSaveRetryEnv();
const controller = createSaveRetryController(retryEnv);
const sessions = createSaveSessionTracker();

let quitFlushHooked = false;
/** 처음 저장할 때 한 번만 건다(모듈을 읽는 시점에는 창 API 가 아직 없을 수 있다). */
function hookQuitFlush() {
  if (quitFlushHooked || typeof window === 'undefined') return;
  const off = window.electronAPI?.onBeforeQuitFlush?.(() => controller.flushNow());
  quitFlushHooked = typeof off === 'function';
}

let sessionWatchHooked = false;
let lastSessionEpoch: number | null = null;
/**
 * 메인의 로그인 세션 방송도 본다(처음 저장할 때 한 번). 렌더러의 로그인 사용자보다 메인 세션이 먼저 바뀌는 경우까지 —
 * 세션 시기(epoch)가 바뀌었거나 방송된 사용자가 지금 화면의 사용자와 다르면 저장을 그만둔다.
 */
function hookSessionWatch() {
  if (sessionWatchHooked || typeof window === 'undefined') return;
  const off = window.electronAPI?.onSessionChanged?.((payload) => {
    const { epoch, user } = (payload ?? {}) as { epoch?: unknown; user?: { id?: unknown } | null };
    const userId = typeof user?.id === 'string' ? user.id : null;
    const epochChanged = typeof epoch === 'number' && lastSessionEpoch !== null && epoch !== lastSessionEpoch;
    if (typeof epoch === 'number') lastSessionEpoch = epoch;
    if (epochChanged || saveSessionUserChanged(useAuthStore.getState().currentUser?.id, userId)) endSceneSaveSession();
  });
  sessionWatchHooked = typeof off === 'function';
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
    hookSessionWatch();
    // 저장을 시작한 순간의 로그인 세션 — 세션이 바뀐 뒤에는 (다시) 보내지 않는다. 한 번에 여러 요청을 보내는 저장은
    // 요청마다 sceneSaveSession() 으로 다시 확인한다(보내는 사이에 세션이 바뀔 수 있다).
    const session = sessions.capture();
    return controller.run<C>(key, {
      ...job,
      attempt: () => {
        session.assertCurrent();
        return job.attempt();
      },
    });
  },
  flushNow() {
    return controller.flushNow();
  },
  cancelAll() {
    return controller.cancelAll();
  },
};

/** 지금 로그인 세션을 붙잡는다 — 씬 저장 클릭마다 부르고, 저장 요청을 보내기 직전마다 assertCurrent 로 확인한다. */
export function sceneSaveSession(): SaveSession {
  return sessions.capture();
}

/** 로그아웃 직전 정리가 기다리는 최대 시간 — 앱 종료 직전 정리(메인이 최대 3초)와 같다. */
export const LOGOUT_FLUSH_MAX_MS = 3000;

/**
 * 직접 로그아웃하기 직전 — 아직 이 사람의 로그인 세션이 살아 있을 때 재전송을 기다리던 씬 저장을 지금 한 번 보낸다
 * (연결 대기 없이, 앱 종료 직전 정리와 같은 길). 최대 maxWaitMs 만 기다리고, 그래도 남은 저장은 로그아웃으로 세션이
 * 바뀌는 순간 그만둔다(endSceneSaveSession). 이미 세션이 끝난 경로(계정이 지워져 밀려남 등)에서는 부르지 않는다 — 버린다.
 */
export async function flushSceneSavesBeforeLogout(maxWaitMs = LOGOUT_FLUSH_MAX_MS): Promise<void> {
  await flushNowWithin(controller, maxWaitMs, retryEnv);
}

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

const sessionEndedListeners = new Set<() => void>();

/**
 * 로그인 세션이 바뀌어 저장을 그만뒀을 때 부를 것을 건다(App 이 바로 다시 받아온다 — 앞 사람의 아직 저장 안 된 값이
 * 다음 사람 화면에 남아 있지 않게). 그만둔 저장이 없었으면 부르지 않는다. 돌려준 함수로 푼다.
 */
export function onSceneSaveSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

/**
 * 로그인 세션이 바뀌었다 — 재전송을 기다리던 저장을 모두 그만두고(다시 보내지 않음·되돌리기/안내 없음),
 * 받아오기 위에 다시 얹던 내 값과 '다시 보내는 중'·되돌림 표시도 모두 지운다.
 */
export function endSceneSaveSession(): void {
  sessions.end();
  const stopped = controller.cancelAll();
  const held = pendingOverlays.size;
  pendingOverlays.clear();
  useStageSaveStatusStore.getState().resetAll();
  if (stopped === 0 && held === 0) return;
  sessionEndedListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[sceneSaveRetry] 세션 종료 뒤 처리 실패:', error);
    }
  });
}

// 렌더러의 로그인 사용자가 바뀌면(로그아웃·로그인·다른 사용자) 세션이 바뀐 것이다 — 메인의 세션 시기도 사용자가 바뀔 때만 오른다.
// 같은 사람의 정보만 새로 받은 것(이름·권한·비밀번호 변경 표시)은 그대로 둔다.
useAuthStore.subscribe((state, previous) => {
  if (saveSessionUserChanged(previous.currentUser?.id, state.currentUser?.id)) endSceneSaveSession();
});
