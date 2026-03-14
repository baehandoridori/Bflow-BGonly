/**
 * Supabase IPC 래퍼 — 렌더러 프로세스에서 사용
 * 기존 sheetsService.ts와 동일한 패턴: window.electronAPI → IPC → 메인 프로세스
 */

import type { Episode, Stage } from '../types';

// 타입은 src/types/index.ts의 ElectronAPI 인터페이스에 정의됨

// ─── 연결 ───────────────────────────────────────

export async function testSupabaseConnection(): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI.supabaseTestConnection();
}

// ─── Episodes ───────────────────────────────────

export async function readAllFromSupabase(): Promise<Episode[]> {
  const data = await window.electronAPI.supabaseReadAll();
  return data as Episode[];
}

export async function addEpisodeToSupabase(episodeNumber: number, department?: string): Promise<void> {
  await window.electronAPI.supabaseAddEpisode(episodeNumber, department);
}

export async function softDeleteEpisodeInSupabase(episodeNumber: number): Promise<void> {
  await window.electronAPI.supabaseSoftDeleteEpisode(episodeNumber);
}

export async function archiveEpisodeInSupabase(episodeNumber: number, archivedBy: string, archiveMemo: string): Promise<void> {
  await window.electronAPI.supabaseArchiveEpisode(episodeNumber, archivedBy, archiveMemo);
}

export async function unarchiveEpisodeInSupabase(episodeNumber: number): Promise<void> {
  await window.electronAPI.supabaseUnarchiveEpisode(episodeNumber);
}

export async function readArchivedFromSupabase(): Promise<unknown[]> {
  return window.electronAPI.supabaseReadArchived();
}

// ─── Parts ──────────────────────────────────────

export async function addPartToSupabase(episodeNumber: number, partId: string, department?: string): Promise<void> {
  await window.electronAPI.supabaseAddPart(episodeNumber, partId, department);
}

export async function softDeletePartInSupabase(sheetName: string): Promise<void> {
  await window.electronAPI.supabaseSoftDeletePart(sheetName);
}

// ─── Scenes ─────────────────────────────────────

export async function addSceneToSupabase(sheetName: string, sceneId: string, assignee: string, memo: string): Promise<void> {
  await window.electronAPI.supabaseAddScene(sheetName, sceneId, assignee, memo);
}

export async function addScenesToSupabase(sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]): Promise<void> {
  await window.electronAPI.supabaseAddScenes(sheetName, scenes);
}

export async function deleteSceneFromSupabase(sceneUuid: string): Promise<void> {
  await window.electronAPI.supabaseDeleteScene(sceneUuid);
}

export async function updateSceneStageInSupabase(sceneUuid: string, stage: Stage, value: boolean, updatedBy?: string): Promise<void> {
  await window.electronAPI.supabaseUpdateSceneStage(sceneUuid, stage, value, updatedBy);
}

export async function bulkUpdateSceneStagesInSupabase(
  updates: { sceneUuid: string; stage: string; value: boolean }[],
  updatedBy?: string,
): Promise<void> {
  await window.electronAPI.supabaseBulkUpdateSceneStages(updates, updatedBy);
}

export async function updateSceneFieldInSupabase(sceneUuid: string, field: string, value: string): Promise<void> {
  await window.electronAPI.supabaseUpdateSceneField(sceneUuid, field, value);
}

// ─── Users ──────────────────────────────────────

export async function readUsersFromSupabase(): Promise<unknown[]> {
  return window.electronAPI.supabaseReadUsers();
}

export async function addUserToSupabase(user: unknown): Promise<void> {
  await window.electronAPI.supabaseAddUser(user);
}

export async function updateUserInSupabase(userId: string, updates: Record<string, string>): Promise<void> {
  await window.electronAPI.supabaseUpdateUser(userId, updates);
}

export async function deleteUserFromSupabase(userId: string): Promise<void> {
  await window.electronAPI.supabaseDeleteUser(userId);
}

// ─── Comments ───────────────────────────────────

export async function readCommentsFromSupabase(partUuid: string): Promise<unknown[]> {
  return window.electronAPI.supabaseReadComments(partUuid);
}

export async function addCommentToSupabase(
  commentId: string, partUuid: string, sceneId: string,
  userId: string, userName: string, text: string, mentions: string[], createdAt: string,
): Promise<void> {
  await window.electronAPI.supabaseAddComment(commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt);
}

export async function editCommentInSupabase(commentId: string, text: string, mentions: string[]): Promise<void> {
  await window.electronAPI.supabaseEditComment(commentId, text, mentions);
}

export async function deleteCommentFromSupabase(commentId: string): Promise<void> {
  await window.electronAPI.supabaseDeleteComment(commentId);
}

// ─── Revisions ──────────────────────────────────

export async function readRevisionsFromSupabase(): Promise<unknown[]> {
  return window.electronAPI.supabaseReadRevisions();
}

export async function addRevisionToSupabase(
  id: string, partUuid: string, sceneId: string, revisionNo: number, status: string,
  priority: string, description: string, frameNo: string, imageUrl: string,
  department: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
): Promise<void> {
  await window.electronAPI.supabaseAddRevision(id, partUuid, sceneId, revisionNo, status, priority, description, frameNo, imageUrl, department, requesterId, requesterName, assignee, createdAt);
}

export async function updateRevisionInSupabase(id: string, updates: Record<string, string>): Promise<void> {
  await window.electronAPI.supabaseUpdateRevision(id, updates);
}

// ─── Metadata ───────────────────────────────────

export async function readAllMetadataFromSupabase(): Promise<unknown[]> {
  return window.electronAPI.supabaseReadAllMetadata();
}

export async function readMetadataFromSupabase(type: string, key: string): Promise<unknown> {
  return window.electronAPI.supabaseReadMetadata(type, key);
}

export async function writeMetadataToSupabase(type: string, key: string, value: string): Promise<void> {
  await window.electronAPI.supabaseWriteMetadata(type, key, value);
}

// ─── Realtime 이벤트 구독 ───────────────────────

export interface SupabaseRealtimeEvent {
  table: string;
  payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  };
}

/** Realtime 이벤트 리스너 등록 (cleanup 함수 반환) */
export function onSupabaseRealtimeEvent(callback: (event: SupabaseRealtimeEvent) => void): () => void {
  return window.electronAPI.onSupabaseRealtime(callback as (event: unknown) => void);
}

/** Supabase 연결 상태 리스너 등록 */
export function onSupabaseStatusChange(callback: (status: string) => void): () => void {
  return window.electronAPI.onSupabaseStatus(callback);
}
