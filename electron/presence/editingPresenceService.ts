// electron/presence/editingPresenceService.ts
import type { SupabaseSceneWorkLink } from '../supabase';
import type { EditingPresenceSnapshot, EditingPresencePayload } from './types';
import { buildPrimaryFileBasenameIndex, resolveScenesForBasenames } from './sceneLinkIndex';
import { startMohoTitlePolling } from './mohoWindowPoller';
import { mergePresenceState } from './presenceMerge';

export interface EditingPresenceDeps {
  getCurrentUser: () => { userId: string; username: string } | null;
  getWorkLinks: () => SupabaseSceneWorkLink[];
  track: (payload: EditingPresencePayload) => void;
  broadcast: (snapshot: EditingPresenceSnapshot) => void;
  now: () => string;
  intervalMs?: number;
  logCollision?: (basenames: string[]) => void;
}

export function startEditingPresenceService(deps: EditingPresenceDeps): () => void {
  const warned = new Set<string>();
  let lastEditing = '__init__';

  const publish = (basenames: string[]) => {
    const user = deps.getCurrentUser();
    if (!user) return;
    const idx = buildPrimaryFileBasenameIndex(deps.getWorkLinks());
    const { sceneUuids, collisions } = resolveScenesForBasenames(idx, basenames);
    const fresh = collisions.filter((c) => !warned.has(c));
    if (fresh.length) { fresh.forEach((c) => warned.add(c)); deps.logCollision?.(fresh); }
    const key = [...sceneUuids].sort().join('|');
    if (key === lastEditing) return;
    lastEditing = key;
    deps.track({ userId: user.userId, username: user.username, editingSceneUuids: sceneUuids, updatedAt: deps.now() });
  };

  const stopPolling = startMohoTitlePolling({ intervalMs: deps.intervalMs, onChange: publish });
  return () => stopPolling();
}

/** main.ts의 onPresenceSync 콜백이 호출: 전체 상태 병합 → broadcast */
export function receivePresence(
  state: Record<string, EditingPresencePayload[]>,
  broadcast: (snapshot: EditingPresenceSnapshot) => void,
): void {
  broadcast(mergePresenceState(state));
}
