// electron/presence/editingPresenceService.ts
import type { SupabaseSceneWorkLink } from '../supabase';
import type { EditingPresenceSnapshot, EditingPresencePayload } from './types';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from './sceneLinkIndex';
import { startMohoTitlePolling } from './mohoWindowPoller';
import { mergePresenceState } from './presenceMerge';
import { createDedupGate } from './dedupGate';

export interface EditingPresenceDeps {
  getCurrentUser: () => { userId: string; username: string } | null;
  getWorkLinks: () => SupabaseSceneWorkLink[];
  track: (payload: EditingPresencePayload) => void;
  broadcast: (snapshot: EditingPresenceSnapshot) => void;
  now: () => string;
  intervalMs?: number;
  logCollision?: (basenames: string[]) => void;
}

export interface EditingPresenceHandle {
  /** 서비스 중단(앱 종료 시). */
  stop: () => void;
  /**
   * 사용자 신원 변경(로그아웃/로그인/계정 전환) 시 호출.
   * dedup 기억을 비워, 열린 Moho 파일 집합이 동일해도 다음 폴에서 새 신원으로 재track한다.
   */
  reset: () => void;
}

export function startEditingPresenceService(deps: EditingPresenceDeps): EditingPresenceHandle {
  const warned = new Set<string>();
  const gate = createDedupGate();

  const publish = (basenames: string[]) => {
    const user = deps.getCurrentUser();
    if (!user) return;
    const idx = buildPrimaryFileBasenameIndex(deps.getWorkLinks());
    const { sceneUuids, collisions } = resolveScenesForBasenames(idx, basenames);
    const fresh = collisions.filter((c) => !warned.has(c));
    if (fresh.length) { fresh.forEach((c) => warned.add(c)); deps.logCollision?.(fresh); }
    const key = [...sceneUuids].sort().join('|');
    if (!gate.shouldEmit(key)) return;
    deps.track({ userId: user.userId, username: user.username, editingSceneUuids: sceneUuids, updatedAt: deps.now() });
  };

  const polling = startMohoTitlePolling({ intervalMs: deps.intervalMs, onChange: publish });
  return {
    stop: () => polling.stop(),
    reset: () => { gate.reset(); polling.reset(); },
  };
}

/** main.ts의 onPresenceSync 콜백이 호출: 전체 상태 병합 → broadcast */
export function receivePresence(
  state: Record<string, EditingPresencePayload[]>,
  broadcast: (snapshot: EditingPresenceSnapshot) => void,
): void {
  broadcast(mergePresenceState(state));
}
