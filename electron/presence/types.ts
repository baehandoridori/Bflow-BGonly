// electron/presence/types.ts
export interface EditingUser {
  userId: string;
  username: string;
}
/** sceneUuid -> 그 씬을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
/** 메인이 Supabase presence로 track하는 페이로드(사용자당 1개) */
export interface EditingPresencePayload {
  userId: string;
  username: string;
  editingSceneUuids: string[];
  updatedAt: string;
}
