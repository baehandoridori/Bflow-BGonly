// electron/presence/presenceMerge.ts
import type { EditingPresencePayload, EditingPresenceSnapshot, EditingUser } from './types';

type PresenceState = Record<string, EditingPresencePayload[]>;

export function mergePresenceState(state: PresenceState): EditingPresenceSnapshot {
  const bySceneUsers = new Map<string, Map<string, EditingUser>>();
  for (const payloads of Object.values(state ?? {})) {
    for (const p of payloads ?? []) {
      for (const sceneUuid of p.editingSceneUuids ?? []) {
        let users = bySceneUsers.get(sceneUuid);
        if (!users) bySceneUsers.set(sceneUuid, (users = new Map()));
        if (!users.has(p.userId)) users.set(p.userId, { userId: p.userId, username: p.username });
      }
    }
  }
  const snapshot: EditingPresenceSnapshot = {};
  for (const [sceneUuid, users] of bySceneUsers) snapshot[sceneUuid] = [...users.values()];
  return snapshot;
}
