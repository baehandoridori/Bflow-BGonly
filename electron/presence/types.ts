// electron/presence/types.ts
export interface EditingUser {
  userId: string;
  username: string;
}
/** uuid(씬 sceneUuid·복장 costumeUuid 등) -> 그 파일을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
/** 파일 열림 감지 대상 종류 — 새 파일 종류(예: 릴)는 이 유니온에 키를 추가하고 main 에 소스만 등록한다 (피드백 54). */
export type PresenceKind = 'scene' | 'costume';
/** kind -> 스냅샷 묶음 — main → renderer IPC 로 전달되는 형태. wire 로 올 수 있는 미래 kind 도 보존하도록 키는 string. */
export type PresenceSnapshotBundle = Record<string, EditingPresenceSnapshot>;
/** 메인이 Supabase presence로 track하는 페이로드(사용자당 1개) */
export interface EditingPresencePayload {
  userId: string;
  username: string;
  /** 구버전(≤v1.99) 클라이언트 호환 미러 — 항상 editing.scene 과 동일하게 채운다. 절대 제거·의미 변경 금지. */
  editingSceneUuids: string[];
  /** kind별 편집 대상 uuid 목록 (v1.101+). 예: { scene: [...], costume: [...] }. 구버전 payload 에는 없다. */
  editing?: Record<string, string[]>;
  updatedAt: string;
}
