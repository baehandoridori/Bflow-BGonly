// electron/presence/presenceMerge.ts
import type { EditingPresencePayload, EditingPresenceSnapshot, EditingUser, PresenceSnapshotBundle } from './types';

type PresenceState = Record<string, EditingPresencePayload[]>;

/** payload 의 kind별 편집 목록 — 신버전은 editing, 구버전(editing 없음)은 { scene: editingSceneUuids } 로 정규화. */
function editingByKind(p: EditingPresencePayload): Record<string, string[]> {
  return p.editing ?? { scene: p.editingSceneUuids ?? [] };
}

/** presence state → kind별 스냅샷 묶음. 편집 대상이 없는 kind 는 키를 만들지 않는다. */
export function mergePresenceState(state: PresenceState): PresenceSnapshotBundle {
  const byKindUuidUsers = new Map<string, Map<string, Map<string, EditingUser>>>();
  for (const payloads of Object.values(state ?? {})) {
    for (const p of payloads ?? []) {
      for (const [kind, uuids] of Object.entries(editingByKind(p))) {
        for (const uuid of uuids ?? []) {
          let byUuid = byKindUuidUsers.get(kind);
          if (!byUuid) byKindUuidUsers.set(kind, (byUuid = new Map()));
          let users = byUuid.get(uuid);
          if (!users) byUuid.set(uuid, (users = new Map()));
          if (!users.has(p.userId)) users.set(p.userId, { userId: p.userId, username: p.username });
        }
      }
    }
  }
  const bundle: PresenceSnapshotBundle = {};
  for (const [kind, byUuid] of byKindUuidUsers) {
    const snapshot: EditingPresenceSnapshot = {};
    for (const [uuid, users] of byUuid) snapshot[uuid] = [...users.values()];
    bundle[kind] = snapshot;
  }
  return bundle;
}
