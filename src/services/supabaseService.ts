/**
 * Supabase IPC 래퍼 — 렌더러 프로세스에서 사용
 * window.electronAPI → IPC → 메인 프로세스
 */

import type { Episode, Stage, BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult, Activity, ActionGroup } from '../types';

// 일괄 작업 타입 재노출 — 다른 렌더러 모듈에서 쉽게 참조 가능
export type { BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult };

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

/**
 * 일괄 단계 토글 — RPC `bulk_update_scene_stages` 경유.
 * 각 항목별 per-row 결과(BulkUpdateResult)를 반환해 부분 실패 처리 가능.
 */
export async function bulkUpdateSceneStages(
  updates: BulkStageUpdate[],
  updatedBy: string,
): Promise<BulkUpdateResult[]> {
  return window.electronAPI.supabaseBulkUpdateSceneStages(updates, updatedBy);
}

/**
 * 일괄 씬 삭제 — RPC `bulk_delete_scenes` 경유.
 */
export async function bulkDeleteScenes(
  sceneUuids: string[],
  deletedBy: string,
): Promise<BulkUpdateResult[]> {
  return window.electronAPI.supabaseBulkDeleteScenes(sceneUuids, deletedBy);
}

/**
 * 일괄 필드 수정 — RPC `bulk_update_scene_fields` 경유.
 */
export async function bulkUpdateSceneFields(
  updates: BulkFieldUpdate[],
  updatedBy: string,
): Promise<BulkUpdateResult[]> {
  return window.electronAPI.supabaseBulkUpdateSceneFields(updates, updatedBy);
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

export async function updateUserInSupabase(userId: string, updates: Record<string, string | null>): Promise<void> {
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
  images: string[] = [],
  /** v1.18.0: 리비전 맥락 댓글이면 해당 id, 일반 씬 댓글이면 null. */
  revisionId: string | null = null,
): Promise<void> {
  await window.electronAPI.supabaseAddComment(commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images, revisionId);
}

export async function editCommentInSupabase(commentId: string, text: string, mentions: string[], images?: string[]): Promise<void> {
  await window.electronAPI.supabaseEditComment(commentId, text, mentions, images);
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
  department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
  notifyUserIdsJson: string = '[]',
): Promise<void> {
  await window.electronAPI.supabaseAddRevision(id, partUuid, sceneId, revisionNo, status, priority, description, frameNo, imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt, notifyUserIdsJson);
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

// ═══════════════════════════════════════════════════════
// 고수준 API — sheetName/rowIndex 기반 호출을 UUID로 변환
// ═══════════════════════════════════════════════════════

import { useDataStore } from '../stores/useDataStore';

const SCENE_COMPLETION_META_TYPE = 'scene-completion';

/** sheetName + sceneIndex → scene UUID 조회 (스토어에서) */
function resolveSceneUuid(sheetName: string, sceneIndex: number): string {
  const episodes = useDataStore.getState().episodes;
  const part = episodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
  const scene = part?.scenes[sceneIndex];
  if (!scene?.id) throw new Error(`씬 UUID를 찾을 수 없음: ${sheetName}[${sceneIndex}]`);
  return scene.id;
}

/** sheetName + sceneId (human) → scene UUID */
function resolveSceneUuidBySceneId(sheetName: string, sceneId: string): string {
  const episodes = useDataStore.getState().episodes;
  const part = episodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
  const scene = part?.scenes.find((s) => s.sceneId === sceneId);
  if (!scene?.id) throw new Error(`씬 UUID를 찾을 수 없음: ${sheetName}:${sceneId}`);
  return scene.id;
}

// ─── 셀/씬 업데이트 ──────────────────

/** 체크박스 셀 업데이트 (sheetName + rowIndex → UUID 변환) */
export async function updateCell(
  sheetName: string, rowIndex: number, stage: string, value: boolean, updatedBy?: string,
): Promise<void> {
  const uuid = resolveSceneUuid(sheetName, rowIndex);
  await window.electronAPI.supabaseUpdateSceneStage(uuid, stage, value, updatedBy);
}

/** 에피소드 추가 */
export async function addEpisode(episodeNumber: number, department?: string): Promise<void> {
  await window.electronAPI.supabaseAddEpisode(episodeNumber, department);
}

/** 파트 추가 */
export async function addPart(episodeNumber: number, partId: string, department?: string): Promise<void> {
  await window.electronAPI.supabaseAddPart(episodeNumber, partId, department);
}

/** 씬 추가 */
export async function addScene(sheetName: string, sceneId: string, assignee: string, memo: string): Promise<{ sceneUuid: string | null }> {
  // IPC 가 { sceneUuid } 객체를 반환 — caller 가 활용할 수 있게 그대로 전달 (self-review fix 2026-05-02).
  return await window.electronAPI.supabaseAddScene(sheetName, sceneId, assignee, memo) as { sceneUuid: string | null };
}

/** 씬 다건 추가 */
export async function addScenes(sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]): Promise<void> {
  await window.electronAPI.supabaseAddScenes(sheetName, scenes);
}

/** 씬 삭제 (rowIndex → UUID) */
export async function deleteScene(sheetName: string, rowIndex: number): Promise<void> {
  const uuid = resolveSceneUuid(sheetName, rowIndex);
  await window.electronAPI.supabaseDeleteScene(uuid);
}

/** 씬 필드 업데이트 (rowIndex → UUID) */
export async function updateSceneField(sheetName: string, rowIndex: number, field: string, value: string): Promise<void> {
  const uuid = resolveSceneUuid(sheetName, rowIndex);
  await window.electronAPI.supabaseUpdateSceneField(uuid, field, value);
}

/** 씬 완료 메타 저장 (rowIndex → metadata upsert) */
export async function updateSceneCompletionMeta(
  sheetName: string,
  rowIndex: number,
  completion: { completedBy: string; completedAt: string } | null,
): Promise<void> {
  const uuid = resolveSceneUuid(sheetName, rowIndex);
  await window.electronAPI.supabaseWriteMetadata(
    SCENE_COMPLETION_META_TYPE,
    uuid,
    completion ? JSON.stringify(completion) : '',
  );
}

/** 파트 소프트 삭제 */
export async function softDeletePart(sheetName: string): Promise<void> {
  await window.electronAPI.supabaseSoftDeletePart(sheetName);
}

/** 에피소드 소프트 삭제 */
export async function softDeleteEpisode(episodeNumber: number): Promise<void> {
  await window.electronAPI.supabaseSoftDeleteEpisode(episodeNumber);
}

/** 에피소드 아카이브 */
export async function archiveEpisode(episodeNumber: number, archivedBy: string, archiveMemo: string): Promise<void> {
  await window.electronAPI.supabaseArchiveEpisode(episodeNumber, archivedBy, archiveMemo);
}

/** 에피소드 아카이브 해제 */
export async function unarchiveEpisode(episodeNumber: number): Promise<void> {
  await window.electronAPI.supabaseUnarchiveEpisode(episodeNumber);
}

/** 아카이브된 에피소드 조회 */
export async function readArchived(): Promise<{ episodeNumber: number; title: string; partCount: number; archivedBy?: string; archivedAt?: string; archiveMemo?: string }[]> {
  const data = (await window.electronAPI.supabaseReadArchived()) as { episodeNumber: number; title: string; partCount?: number; archivedBy?: string; archivedAt?: string; archiveMemo?: string }[];
  return data.map((d) => ({ ...d, partCount: d.partCount ?? 0 }));
}

/** 메타데이터 저장 */
export async function writeMetadata(type: string, key: string, value: string): Promise<void> {
  await window.electronAPI.supabaseWriteMetadata(type, key, value);
}

/** 메타데이터 조회 */
export async function readMetadata(type: string, key: string): Promise<{ type: string; key: string; value: string; updatedAt: string } | null> {
  const data = await window.electronAPI.supabaseReadMetadata(type, key);
  return data as { type: string; key: string; value: string; updatedAt: string } | null;
}

/** 전체 에피소드 데이터 조회 */
export async function readAll(): Promise<Episode[]> {
  return readAllFromSupabase();
}

// ─── 배치 실행 ──────────

export interface BatchAction {
  action: string;
  params: Record<string, string>;
}

/** batchActions 빌더 */
export const batchActions = {
  addEpisode: (episodeNumber: number, department?: string): BatchAction => ({
    action: 'addEpisode',
    params: { episodeNumber: String(episodeNumber), ...(department ? { department } : {}) },
  }),
  addPart: (episodeNumber: number, partId: string, department?: string): BatchAction => ({
    action: 'addPart',
    params: { episodeNumber: String(episodeNumber), partId, ...(department ? { department } : {}) },
  }),
  writeMetadata: (type: string, key: string, value: string): BatchAction => ({
    action: 'writeMetadata',
    params: { type, key, value },
  }),
  deleteScene: (sheetName: string, rowIndex: number): BatchAction => ({
    action: 'deleteScene',
    params: { sheetName, rowIndex: String(rowIndex) },
  }),
  /** UUID 기반 씬 삭제 — 낙관적 업데이트 이후에도 안전 */
  deleteSceneByUuid: (sceneUuid: string): BatchAction => ({
    action: 'deleteSceneByUuid',
    params: { sceneUuid },
  }),
  updateSceneField: (sheetName: string, rowIndex: number, field: string, value: string): BatchAction => ({
    action: 'updateSceneField',
    params: { sheetName, rowIndex: String(rowIndex), field, value },
  }),
  archiveEpisode: (episodeNumber: number): BatchAction => ({
    action: 'archiveEpisode',
    params: { episodeNumber: String(episodeNumber) },
  }),
  softDeleteEpisode: (episodeNumber: number): BatchAction => ({
    action: 'softDeleteEpisode',
    params: { episodeNumber: String(episodeNumber) },
  }),
};

/** 배치 액션 실행 — 각 액션을 개별 Supabase 호출로 실행 */
export async function batchExecute(actions: BatchAction[]): Promise<{ ok: boolean }> {
  for (const act of actions) {
    const p = act.params;
    switch (act.action) {
      case 'addEpisode':
        await window.electronAPI.supabaseAddEpisode(Number(p.episodeNumber), p.department);
        break;
      case 'addPart':
        await window.electronAPI.supabaseAddPart(Number(p.episodeNumber), p.partId, p.department);
        break;
      case 'writeMetadata':
        await window.electronAPI.supabaseWriteMetadata(p.type, p.key, p.value);
        break;
      case 'deleteScene': {
        const uuid = resolveSceneUuid(p.sheetName, Number(p.rowIndex));
        await window.electronAPI.supabaseDeleteScene(uuid);
        break;
      }
      case 'deleteSceneByUuid': {
        await window.electronAPI.supabaseDeleteScene(p.sceneUuid);
        break;
      }
      case 'updateSceneField': {
        const uuid = resolveSceneUuid(p.sheetName, Number(p.rowIndex));
        await window.electronAPI.supabaseUpdateSceneField(uuid, p.field, p.value);
        break;
      }
      case 'archiveEpisode':
        await window.electronAPI.supabaseArchiveEpisode(Number(p.episodeNumber), '', '');
        break;
      case 'softDeleteEpisode':
        await window.electronAPI.supabaseSoftDeleteEpisode(Number(p.episodeNumber));
        break;
    }
  }
  return { ok: true };
}

// ─── 연결 확인 ───────────────────────

export async function checkConnection(): Promise<boolean> {
  const result = await testSupabaseConnection();
  return result.ok;
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
export interface ActivityBucket { startTs: number; count: number }
export interface ActivityQueryOpts {
  /** 특정 테이블만. 생략 시 전체 */
  table?: string;
  /** read/write 만. 생략 시 전체 */
  action?: 'read' | 'write';
  rangeMs: number;
  buckets: number;
}

/** Supabase IPC 활동 기록(최근 세션) 에서 시간대별 카운트 조회 — 쿼리 아님, 로컬 메모리 집계. */
export async function getSupabaseActivity(opts: ActivityQueryOpts): Promise<ActivityBucket[]> {
  if (!window.electronAPI?.supabaseGetActivity) return [];
  return window.electronAPI.supabaseGetActivity(opts);
}

/** 현재 Realtime subscription 상태를 메인 프로세스 캐시에서 조회 — 늦은 마운트 대응. */
export async function getSupabaseRealtimeStatus(): Promise<string> {
  if (!window.electronAPI?.supabaseGetRealtimeStatus) return 'CONNECTING';
  try { return await window.electronAPI.supabaseGetRealtimeStatus(); }
  catch { return 'CONNECTING'; }
}

export function onSupabaseStatusChange(callback: (status: string) => void): () => void {
  return window.electronAPI.onSupabaseStatus(callback);
}

// ─── Personal Todos ──────────────────────────────

export async function readTodos(userId: string) {
  return window.electronAPI.supabaseReadTodos(userId);
}

export async function upsertTodo(userId: string, todo: {
  id?: string;
  title: string;
  memo: string;
  completed: boolean;
  startDate?: string | null;
  endDate?: string | null;
  addToCalendar?: boolean;
  sortOrder?: number;
  createdAt?: string;
}): Promise<string> {
  return window.electronAPI.supabaseUpsertTodo(userId, todo);
}

export async function deleteTodo(todoId: string): Promise<void> {
  return window.electronAPI.supabaseDeleteTodo(todoId);
}

export async function readTaskViews(userId: string) {
  return window.electronAPI.supabaseReadTaskViews(userId);
}

export async function upsertTaskViews(
  userId: string,
  views: unknown[],
  assignedSceneKeys: unknown[],
): Promise<void> {
  return window.electronAPI.supabaseUpsertTaskViews(userId, views, assignedSceneKeys);
}

// ─── Memos ──────────────────────────────

export async function readMemo(userId: string, widgetId: string) {
  return window.electronAPI.supabaseReadMemo(userId, widgetId);
}

export async function upsertMemo(
  userId: string,
  widgetId: string,
  memoData: { tabs: unknown[]; activeTabId: string | null; fontSize: number },
): Promise<void> {
  return window.electronAPI.supabaseUpsertMemo(userId, widgetId, memoData);
}

// ─── 활동 기록 (activity_log) ──────────────

function rowToActivity(row: any): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    actionType: row.action_type,
    actionGroup: row.action_group,
    sceneId: row.scene_id,
    sceneLabel: row.scene_label,
    episodeNumber: row.episode_number,
    department: row.department,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export async function listActivities(opts: {
  before?: string;
  limit?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
  /** 특정 씬(들) 의 activity 만 — 씬 상세 모달의 히스토리 탭/댓글 인라인용. 2026-05-02 추가. */
  sceneIds?: string[];
}): Promise<Activity[]> {
  const rows = await window.electronAPI.activityList(opts);
  return (rows ?? []).map(rowToActivity);
}

export async function getActivityStats(opts: {
  days?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}): Promise<Array<{
  day_of_week: number;
  hour: number;
  count: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}>> {
  return await window.electronAPI.activityStats(opts);
}

export async function backfillActivities(since: string): Promise<Activity[]> {
  const rows = await window.electronAPI.activityBackfill(since);
  return (rows ?? []).map(rowToActivity);
}

export async function getActivityStorageInfo(): Promise<{ count: number; sizeMB: number }> {
  return await window.electronAPI.activityStorageInfo();
}

export function subscribeToActivityRealtime(cb: (activity: Activity) => void): () => void {
  return window.electronAPI.onActivityRealtimeInsert((row: any) => cb(rowToActivity(row)));
}

export async function readAllMemos(userId: string) {
  return window.electronAPI.supabaseReadAllMemos(userId);
}
