/**
 * Supabase IPC 래퍼 — 렌더러 프로세스에서 사용
 * window.electronAPI → IPC → 메인 프로세스
 */

import type {
  Episode, Stage, ScenePhaseState, BulkStageUpdate, BulkFieldUpdate, BulkUpdateResult,
  Activity, ActionGroup,
  CompositingState, CompositingStatus, CompositingErrorKind,
  Character, CharacterCostume, CostumeDesignStage, CostumeRiggingStage,
  CharacterRow, CharacterCostumeRow,
  CharacterBoardTab, CharacterBoardTabRow,
  CharacterCostumeImage, CharacterCostumeImageRow, CostumeImageRole,
  CharacterImageBackground, CharacterImageFit,
  CostumeActivityLogContext,
  CommentReadStateRow,
  PublicUserDirectory,
} from '../types';
import { applyAssigneeProgressMetadata } from '../utils/assigneeProgress';
import { normalizeCharacterImageBackground, normalizeCharacterImageFit } from '../utils/characterAssets';
import { sanitizeTabGroups } from '@/utils/characterTabGroups';

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
  return (data as Array<Episode & { reel_file_path?: string | null }>).map((ep) => ({
    ...ep,
    reelFilePath: ep.reelFilePath ?? ep.reel_file_path ?? null,
  }));
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

export async function updateEpisodeReelPath(episodeNumber: number, reelFilePath: string | null): Promise<void> {
  await window.electronAPI.supabaseUpdateEpisodeReelPath(episodeNumber, reelFilePath);
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

/** v1.25.0~ 액팅 씬 단계 + 차수 Supabase 동기화 (sceneState/workRound/feedbackRound 한 번에) */
export async function updateScenePhaseInSupabase(
  sceneUuid: string,
  sceneState: ScenePhaseState,
  workRound: number,
  feedbackRound: number,
  updatedBy?: string,
): Promise<void> {
  await window.electronAPI.supabaseUpdateScenePhase(sceneUuid, sceneState, workRound, feedbackRound, updatedBy);
}

/** v1.25.0~ 액팅 리테이크 알림 발송 — broadcast 채널로 다른 클라이언트 전파 */
export async function dispatchActingFeedbackNotification(payload: {
  sceneUuid: string;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  senderId: string;
  senderName: string;
  fromState: string;
  toState: string;
  workRound: number;
  feedbackRound: number;
  recipients: string[];
  message?: string;
}): Promise<void> {
  await window.electronAPI.supabaseDispatchFeedbackNotification(payload);
}

/** v1.25.5 로그인 catch-up — 마지막 본 시각 이후 미읽음 액팅 리테이크 알림 조회.
 *  before: 페이지네이션 (created_at < before). */
export async function fetchMissedFeedbackNotifications(
  userId: string,
  since: string,
  limit?: number,
  before?: string,
): ReturnType<typeof window.electronAPI.supabaseFetchMissedFeedbackNotifications> {
  return window.electronAPI.supabaseFetchMissedFeedbackNotifications(userId, since, limit, before);
}

/** v1.25.5 알림 읽음 처리 */
export async function markFeedbackNotificationRead(notificationId: string): Promise<void> {
  await window.electronAPI.supabaseMarkFeedbackNotificationRead(notificationId);
}

/** v1.25.8 씬 담당자 배정 알림 catch-up — 한솔 보고: 미접속 시 배정 알림이 사라짐.
 *  acting_feedback 과 동일 패턴 (DB row INSERT + broadcast + 로그인 catch-up).
 *  before: 페이지네이션 (created_at < before). */
export async function fetchMissedAssignmentNotifications(
  userId: string,
  since: string,
  limit?: number,
  before?: string,
): ReturnType<typeof window.electronAPI.supabaseFetchMissedAssignmentNotifications> {
  return window.electronAPI.supabaseFetchMissedAssignmentNotifications(userId, since, limit, before);
}

/** v1.25.8 씬 담당자 배정 알림 읽음 처리 */
export async function markAssignmentNotificationRead(notificationId: string): Promise<void> {
  await window.electronAPI.supabaseMarkAssignmentNotificationRead(notificationId);
}

/** v1.29.0 댓글 이모지 반응 알림 — catch-up / refetch. */
export async function fetchCommentReactionNotifications(args: {
  recipientId: string;
  since?: string;
  before?: string;
  limit?: number;
  ids?: string[];
}): ReturnType<typeof window.electronAPI.supabaseFetchCommentReactionNotifications> {
  return window.electronAPI.supabaseFetchCommentReactionNotifications(args);
}

/** v1.29.0 댓글 이모지 반응 알림 — 단일 read_at 갱신. */
export async function markCommentReactionRead(notificationId: string): Promise<void> {
  await window.electronAPI.supabaseMarkCommentReactionRead(notificationId);
}

/** v1.29.0 댓글 이모지 반응 알림 — recipient 의 모든 미읽음 read_at 갱신. */
export async function markAllCommentReactionsRead(recipientId: string): Promise<void> {
  await window.electronAPI.supabaseMarkAllCommentReactionsRead(recipientId);
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
  await window.electronAPI.supabaseUpdateSceneField(sceneUuid, field, value, getCurrentSenderId());
}

// ─── Users ──────────────────────────────────────

export async function readUsersFromSupabase(): Promise<PublicUserDirectory> {
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

export async function readCommentReadStatesFromSupabase(userId: string): Promise<CommentReadStateRow[]> {
  if (!window.electronAPI?.supabaseReadCommentReadStates) return [];
  return window.electronAPI.supabaseReadCommentReadStates(userId);
}

export async function upsertCommentReadStateInSupabase(
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
): Promise<void> {
  if (!window.electronAPI?.supabaseUpsertCommentReadState) return;
  await window.electronAPI.supabaseUpsertCommentReadState(userId, sceneThreadKey, lastReadAt);
}

export async function addCommentToSupabase(
  commentId: string, partUuid: string, sceneId: string,
  userId: string, userName: string, text: string, mentions: string[], createdAt: string,
  images: string[] = [],
  /** v1.18.0: 리테이크 맥락 댓글이면 해당 id, 일반 씬 댓글이면 null. */
  revisionId: string | null = null,
  /** v1.24.0: 1단계 대댓글이면 부모 댓글 id, 일반 댓글이면 null. */
  parentCommentId: string | null = null,
): Promise<void> {
  await window.electronAPI.supabaseAddComment(commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images, revisionId, parentCommentId);
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
import { useAuthStore } from '../stores/useAuthStore';
import { waitForSceneUuidWithStore } from '../utils/sceneUuidPolling';

const SCENE_COMPLETION_META_TYPE = 'scene-completion';

/**
 * v1.25.12 — 옵티미스틱 추가된 씬의 UUID 가 채워질 때까지 폴링.
 * 씬 추가 직후 이미지 업로드 같은 후속 작업에서 사용.
 * 타임아웃이면 null 반환 — 호출자가 토스트로 안내.
 */
export async function waitForSceneUuid(
  sheetName: string,
  sceneId: string,
  timeoutMs: number = 2000,
): Promise<string | null> {
  return waitForSceneUuidWithStore(() => useDataStore.getState(), sheetName, sceneId, timeoutMs);
}

/** sheetName + sceneIndex → scene UUID 조회 (스토어에서) */
function resolveSceneUuid(sheetName: string, sceneIndex: number): string {
  const episodes = useDataStore.getState().episodes;
  const part = episodes.flatMap((ep) => ep.parts).find((p) => p.sheetName === sheetName);
  const scene = part?.scenes[sceneIndex];
  if (!scene?.id) throw new Error(`씬 UUID를 찾을 수 없음: ${sheetName}[${sceneIndex}]`);
  return scene.id;
}

/** v1.25.8 코덱스 1차 P1 fix: 씬 필드 mutation 시 sender 자동 주입 — 담당자 알림 분기 활성화.
 *  이전엔 senderId 가 누락된 채로 IPC 가 호출되어, electron 측 'assignee' notify 분기가
 *  영구히 건너뛰어졌다 (= 알림 INSERT/broadcast 모두 안 됨). */
function getCurrentSenderId(): string | undefined {
  return useAuthStore.getState().currentUser?.id;
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

/** 체크박스 셀 업데이트 (이미 알고 있는 UUID를 직접 사용) */
export async function updateCellByUuid(
  sceneUuid: string, stage: string, value: boolean, updatedBy?: string,
): Promise<void> {
  await window.electronAPI.supabaseUpdateSceneStage(sceneUuid, stage, value, updatedBy);
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

/** 씬 필드 업데이트 (rowIndex → UUID).
 *  v1.25.8 코덱스 1차 P1 fix: senderId 주입 — 담당자 변경 시 알림 분기 활성화. */
export async function updateSceneField(sheetName: string, rowIndex: number, field: string, value: string): Promise<void> {
  const uuid = resolveSceneUuid(sheetName, rowIndex);
  await window.electronAPI.supabaseUpdateSceneField(uuid, field, value, getCurrentSenderId());
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
  const episodes = await readAllFromSupabase();
  try {
    const metadata = (await readAllMetadataFromSupabase()) as { type: string; key: string; value: string }[];
    return applyAssigneeProgressMetadata(episodes, metadata);
  } catch (err) {
    console.warn('[supabaseService] 담당자별 진행 메타데이터 적용 실패:', err);
    return episodes;
  }
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
        // v1.25.8 코덱스 1차 P1 fix: senderId 주입 — 담당자 변경 시 알림 분기 활성화.
        await window.electronAPI.supabaseUpdateSceneField(uuid, p.field, p.value, getCurrentSenderId());
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

function unwrapPersonalTodoResult<T>(result: import('@/types').MainPersonalTodoResult<T>): T {
  if (result.ok) return result.data;
  const error = new Error(result.message) as Error & { kind: import('@/types').MainPersonalTodoFailureKind; code: string; retryable: boolean };
  error.kind = result.kind;
  error.code = result.code;
  error.retryable = result.retryable;
  throw error;
}

export async function ensureCanonicalSession() {
  return window.electronAPI.ensureCanonicalSession();
}

export async function readPersonalTodos() {
  return unwrapPersonalTodoResult(await window.electronAPI.readPersonalTodos());
}

export const readTodos = readPersonalTodos;

export async function readPersonalTodoLabels() {
  return unwrapPersonalTodoResult(await window.electronAPI.readPersonalTodoLabels());
}

export async function createPersonalTodo(input: Parameters<NonNullable<typeof window.electronAPI>['createPersonalTodo']>[0]) {
  return unwrapPersonalTodoResult(await window.electronAPI.createPersonalTodo(input));
}

export async function patchPersonalTodo(todoId: string, patch: import('@/types').MainPersonalTodoPatch) {
  return unwrapPersonalTodoResult(await window.electronAPI.patchPersonalTodo(todoId, patch));
}

export async function applyCalendarToTodoPatch(todoId: string, patch: import('@/types').MainCalendarTodoPatch) {
  return unwrapPersonalTodoResult(await window.electronAPI.applyCalendarToTodoPatch(todoId, patch));
}

export async function mutatePersonalTodoOrder(
  mutation: Parameters<NonNullable<typeof window.electronAPI>['mutatePersonalTodoOrder']>[0],
  orderedIds: string[],
) {
  return unwrapPersonalTodoResult(await window.electronAPI.mutatePersonalTodoOrder(mutation, orderedIds));
}

export async function deletePersonalTodo(todoId: string) {
  return unwrapPersonalTodoResult(await window.electronAPI.deletePersonalTodo(todoId));
}

export const deleteTodo = deletePersonalTodo;

export async function createOrReusePersonalTodoLabelAndAttach(
  input: Parameters<NonNullable<typeof window.electronAPI>['createOrReusePersonalTodoLabelAndAttach']>[0],
) {
  return unwrapPersonalTodoResult(await window.electronAPI.createOrReusePersonalTodoLabelAndAttach(input));
}

export async function updatePersonalTodoLabel(
  labelId: string,
  patch: Parameters<NonNullable<typeof window.electronAPI>['updatePersonalTodoLabel']>[1],
) {
  return unwrapPersonalTodoResult(await window.electronAPI.updatePersonalTodoLabel(labelId, patch));
}

export async function readTaskViews() {
  return unwrapPersonalTodoResult(await window.electronAPI.readLegacyTaskViews());
}

export async function upsertTaskViews(
  views: unknown[],
  assignedSceneKeys: unknown[],
): Promise<void> {
  unwrapPersonalTodoResult(await window.electronAPI.upsertLegacyTaskViews(views, assignedSceneKeys));
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
  /** v1.23.0: 시간 단위 탐색 시 range 필터 (Codex 8차 P1) */
  rangeStart?: string;
  rangeEnd?: string;
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

/** v1.23.0: 시간 단위 + 기간 기반 통계 */
export async function getActivityStatsV2(opts: {
  rangeStart: string;
  rangeEnd: string;
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
  department?: 'bg' | 'acting' | null;
  groups?: ActionGroup[];
}) {
  return await window.electronAPI.activityStatsV2(opts);
}

/** v1.23.0: 분석 모달 7카드 raw data */
export async function getActivityInsights(opts: {
  rangeStart: string;
  rangeEnd: string;
  department?: 'bg' | 'acting' | null;
}) {
  return await window.electronAPI.activityInsights(opts);
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

// ─── v1.30.0: 컴포지팅 단계 상태 ────────────────
// spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md

/** DB row(snake_case) → 도메인 객체(camelCase) */
function rowToCompositingState(row: any): CompositingState {
  return {
    id: row.id,
    episodeNumber: row.episode_number,
    sceneId: row.scene_id,
    partId: row.part_id,
    status: row.status as CompositingStatus,
    errorKind: row.error_kind as CompositingErrorKind | null,
    errorNote: row.error_note ?? null,
    progressPercent: row.progress_percent ?? 0,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

/** 한 에피소드의 모든 컴포지팅 상태 row 로드. row 없는 씬은 caller 가 'batch' 디폴트로 처리. */
export async function loadCompositingStates(episodeNumber: number): Promise<CompositingState[]> {
  const rows = await window.electronAPI.supabaseLoadCompositingStates(episodeNumber);
  return (rows ?? []).map(rowToCompositingState);
}

/** UPSERT — (episodeNumber, sceneId) 가 유니크. row 없으면 INSERT, 있으면 UPDATE. */
export async function setCompositingState(input: {
  episodeNumber: number;
  sceneId: string;
  partId: string;
  status: CompositingStatus;
  errorKind?: CompositingErrorKind | null;
  errorNote?: string | null;
  progressPercent?: number;
  updatedBy: string;
}): Promise<CompositingState> {
  const row = await window.electronAPI.supabaseSetCompositingState(input);
  return rowToCompositingState(row);
}

/**
 * 실시간 구독 — 다른 사용자/창의 변경을 받음.
 * 반환값은 cleanup 함수 (호출하면 구독 해제).
 *
 * @param onChange — eventType: 'INSERT' | 'UPDATE' | 'DELETE'
 */
export function subscribeCompositingStatesRealtime(
  onChange: (state: CompositingState, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): () => void {
  return window.electronAPI.onCompositingStatesRealtime((payload: any) => {
    const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
    const row = payload.row ?? payload.old;
    if (row) onChange(rowToCompositingState(row), eventType);
  });
}

// ─── 캐릭터 현황판 ────────────────────────────

/** DB row(snake_case) → 도메인 Character(camelCase). episodeIds 는 caller 가 매핑으로 조립. */
export function rowToCharacter(rawRow: CharacterRow | Record<string, unknown>): Character {
  // IPC/realtime 경계 신뢰 지점 — 구조는 CharacterRow(snake_case 컬럼)로 간주하고,
  // 값 수준 보정(null/기본값)은 아래 fallback 이 담당한다.
  const row = rawRow as CharacterRow;
  return {
    id: row.id,
    name: row.name,
    status: (row.status ?? 'active') as Character['status'],
    memo: row.memo ?? null,
    workFolderPath: row.work_folder_path ?? null,
    referenceHeightPx: row.reference_height_px ?? null,
    sortOrder: row.sort_order ?? 0,
    episodeIds: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** DB row(snake_case) → 도메인 CharacterCostume(camelCase). */
/**
 * costume_ids 배열 우선, 비어 있으면 구버전 costume_id 스칼라 폴백 (피드백 42 롤아웃 호환).
 * 문자열 요소만 통과 — JSONB 손상/타 타입 방어.
 */
export function normalizeCostumeIds(costumeIds: unknown, costumeId: unknown): string[] {
  const arr = Array.isArray(costumeIds) ? costumeIds.filter((v): v is string => typeof v === 'string') : [];
  if (arr.length > 0) return arr;
  return typeof costumeId === 'string' && costumeId ? [costumeId] : [];
}

export function rowToCostume(rawRow: CharacterCostumeRow | Record<string, unknown>): CharacterCostume {
  // IPC/realtime 경계 신뢰 지점 — 구조는 CharacterCostumeRow(snake_case 컬럼)로 간주하고,
  // 구버전 스키마 호환 fallback(assignee 승계 등)은 아래 로직이 담당한다.
  const row = rawRow as CharacterCostumeRow;
  const hasDesignAssigneeColumn = Object.prototype.hasOwnProperty.call(row, 'design_assignee');
  const hasRiggingAssigneeColumn = Object.prototype.hasOwnProperty.call(row, 'rigging_assignee');
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    versionNo: row.version_no ?? 1,
    designStage: (row.design_stage ?? 'waiting') as CostumeDesignStage,
    riggingStage: (row.rigging_stage ?? 'waiting') as CostumeRiggingStage,
    featuredImageUrl: row.featured_image_url ?? null,
    workFilePath: row.work_file_path ?? null,
    imageBackground: normalizeCharacterImageBackground(row.image_background),
    imageFit: normalizeCharacterImageFit(row.image_fit),
    structureTags: Array.isArray(row.structure_tags) ? row.structure_tags : [],
    assetTags: Array.isArray(row.asset_tags) ? row.asset_tags : [],
    designAssignee: hasDesignAssigneeColumn ? row.design_assignee ?? null : row.assignee ?? null,
    riggingAssignee: hasRiggingAssigneeColumn ? row.rigging_assignee ?? null : row.assignee ?? null,
    assignee: row.assignee ?? null,
    memo: row.memo ?? null,
    dueDate: row.due_date ?? null,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadCharacters(): Promise<Character[]> {
  const rows = await window.electronAPI.supabaseLoadCharacters();
  return (rows ?? []).map(rowToCharacter);
}

export async function loadCharacterCostumes(): Promise<CharacterCostume[]> {
  const rows = await window.electronAPI.supabaseLoadCharacterCostumes();
  return (rows ?? []).map(rowToCostume);
}

/** 캐릭터-에피소드 매핑 → { characterId, episodeNumber, memo, costumeIds } 목록. */
export async function loadEpisodeCharacterMap(): Promise<{
  characterId: string;
  episodeNumber: number;
  memo: string | null;
  costumeIds: string[];
}[]> {
  const rows = await window.electronAPI.supabaseLoadEpisodeCharacterMap();
  return (rows ?? [])
    .filter((r: any) => r.episode_number != null)
    .map((r: any) => ({
      characterId: r.character_id,
      episodeNumber: r.episode_number,
      memo: r.memo ?? null,
      costumeIds: normalizeCostumeIds(r.costume_ids, r.costume_id),
    }));
}

export async function addCharacter(input: {
  name: string;
  memo?: string | null;
  createdBy?: string | null;
}): Promise<Character> {
  const row = await window.electronAPI.supabaseAddCharacter(input);
  return rowToCharacter(row);
}

export async function updateCharacter(id: string, updates: Record<string, unknown>): Promise<Character> {
  const row = await window.electronAPI.supabaseUpdateCharacter(id, updates);
  return rowToCharacter(row);
}

export async function deleteCharacter(id: string): Promise<void> {
  await window.electronAPI.supabaseDeleteCharacter(id);
}

export async function addCharacterCostume(input: {
  characterId: string;
  name: string;
  createdBy?: string | null;
}): Promise<CharacterCostume> {
  const row = await window.electronAPI.supabaseAddCostume(input);
  return rowToCostume(row);
}

/**
 * 복장 수정 — 도메인 camelCase 부분 업데이트를 snake_case 컬럼으로 매핑해 단일 update 쿼리.
 * split-state 금지: 여러 필드를 한 번에 전달하면 한 번에 저장.
 */
export async function updateCharacterCostume(
  id: string,
  updates: Partial<{
    name: string;
    versionNo: number;
    designStage: CostumeDesignStage;
    riggingStage: CostumeRiggingStage;
    featuredImageUrl: string | null;
    workFilePath: string | null;
    imageBackground: CharacterCostume['imageBackground'];
    imageFit: CharacterCostume['imageFit'];
    structureTags: string[];
    assetTags: string[];
    designAssignee: string | null;
    riggingAssignee: string | null;
    assignee: string | null;
    memo: string | null;
    dueDate: string | null;
    sortOrder: number;
  }>,
  /**
   * 단계 변경(디자인/리깅)일 때만 전달 — 메인이 활동 피드에 기록할 표시용 컨텍스트.
   * 신원("누가")은 메인 세션 사용자에서 가져오므로 여기엔 담지 않는다.
   */
  logContext?: CostumeActivityLogContext,
): Promise<CharacterCostume> {
  const snake: Record<string, unknown> = {};
  if (updates.name !== undefined) snake.name = updates.name;
  if (updates.versionNo !== undefined) snake.version_no = updates.versionNo;
  if (updates.designStage !== undefined) snake.design_stage = updates.designStage;
  if (updates.riggingStage !== undefined) snake.rigging_stage = updates.riggingStage;
  if (updates.featuredImageUrl !== undefined) snake.featured_image_url = updates.featuredImageUrl;
  if (updates.workFilePath !== undefined) snake.work_file_path = updates.workFilePath;
  if (updates.imageBackground !== undefined) snake.image_background = updates.imageBackground;
  if (updates.imageFit !== undefined) snake.image_fit = updates.imageFit;
  if (updates.structureTags !== undefined) snake.structure_tags = updates.structureTags;
  if (updates.assetTags !== undefined) snake.asset_tags = updates.assetTags;
  if (updates.designAssignee !== undefined) snake.design_assignee = updates.designAssignee;
  if (updates.riggingAssignee !== undefined) snake.rigging_assignee = updates.riggingAssignee;
  if (updates.assignee !== undefined) snake.assignee = updates.assignee;
  if (updates.memo !== undefined) snake.memo = updates.memo;
  if (updates.dueDate !== undefined) snake.due_date = updates.dueDate;
  if (updates.sortOrder !== undefined) snake.sort_order = updates.sortOrder;
  const row = await window.electronAPI.supabaseUpdateCostume(id, snake, logContext);
  return rowToCostume(row);
}

export async function deleteCharacterCostume(id: string): Promise<void> {
  await window.electronAPI.supabaseDeleteCostume(id);
}

// ─── 복장 다중 이미지 (character_costume_images) ───

/** DB row(snake_case) → 도메인 CharacterCostumeImage(camelCase). 배경/맞춤 값은 정규화기로 보정. */
export function rowToCostumeImage(rawRow: CharacterCostumeImageRow | Record<string, unknown>): CharacterCostumeImage {
  const row = rawRow as CharacterCostumeImageRow;
  return {
    id: row.id,
    costumeId: row.costume_id,
    url: row.url,
    role: (row.role ?? 'design') as CostumeImageRole,
    label: row.label ?? null,
    imageBackground: normalizeCharacterImageBackground(row.image_background),
    imageFit: normalizeCharacterImageFit(row.image_fit),
    naturalWidth: row.natural_width ?? null,
    naturalHeight: row.natural_height ?? null,
    isPrimary: row.is_primary === true,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadCharacterCostumeImages(): Promise<CharacterCostumeImage[]> {
  const rows = await window.electronAPI.supabaseLoadCostumeImages();
  return (rows ?? []).map(rowToCostumeImage);
}

// ─── 캐릭터 현황판 탭·그룹 (피드백 41) ───

export function rowToCharacterBoardTab(row: CharacterBoardTabRow): CharacterBoardTab {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order ?? 0,
    groups: sanitizeTabGroups(row.groups),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadCharacterBoardTabs(): Promise<CharacterBoardTab[]> {
  const rows = (await window.electronAPI.supabaseLoadCharacterBoardTabs()) as CharacterBoardTabRow[];
  return rows.map(rowToCharacterBoardTab);
}

export async function addCharacterBoardTab(input: { name: string; sortOrder: number; createdBy?: string | null }): Promise<CharacterBoardTab> {
  const row = (await window.electronAPI.supabaseAddCharacterBoardTab(input)) as CharacterBoardTabRow;
  return rowToCharacterBoardTab(row);
}

export async function updateCharacterBoardTab(
  id: string,
  updates: Partial<Pick<CharacterBoardTab, 'name' | 'sortOrder' | 'groups'>>,
): Promise<void> {
  const snake: Record<string, unknown> = {};
  if (updates.name !== undefined) snake.name = updates.name;
  if (updates.sortOrder !== undefined) snake.sort_order = updates.sortOrder;
  if (updates.groups !== undefined) snake.groups = updates.groups;
  await window.electronAPI.supabaseUpdateCharacterBoardTab(id, snake);
}

export async function deleteCharacterBoardTab(id: string): Promise<void> {
  await window.electronAPI.supabaseDeleteCharacterBoardTab(id);
}

export async function addCharacterCostumeImage(input: {
  costumeId: string;
  url: string;
  role?: CostumeImageRole;
  imageBackground?: CharacterImageBackground;
  imageFit?: CharacterImageFit;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  isPrimary?: boolean;
  sortOrder?: number;
  createdBy?: string | null;
}): Promise<CharacterCostumeImage> {
  const row = await window.electronAPI.supabaseAddCostumeImage(input);
  return rowToCostumeImage(row);
}

/** 복장 이미지 부분 수정 — camelCase 부분 업데이트를 snake_case 컬럼으로 매핑해 단일 update. */
export async function updateCharacterCostumeImage(
  id: string,
  updates: Partial<{
    role: CostumeImageRole;
    label: string | null;
    imageBackground: CharacterImageBackground;
    imageFit: CharacterImageFit;
    isPrimary: boolean;
    sortOrder: number;
  }>,
): Promise<CharacterCostumeImage> {
  const snake: Record<string, unknown> = {};
  if (updates.role !== undefined) snake.role = updates.role;
  if (updates.label !== undefined) snake.label = updates.label;
  if (updates.imageBackground !== undefined) snake.image_background = updates.imageBackground;
  if (updates.imageFit !== undefined) snake.image_fit = updates.imageFit;
  if (updates.isPrimary !== undefined) snake.is_primary = updates.isPrimary;
  if (updates.sortOrder !== undefined) snake.sort_order = updates.sortOrder;
  const row = await window.electronAPI.supabaseUpdateCostumeImage(id, snake);
  return rowToCostumeImage(row);
}

export async function deleteCharacterCostumeImage(id: string): Promise<void> {
  await window.electronAPI.supabaseDeleteCostumeImage(id);
}

/** 복장 대표 이미지 지정 — 같은 복장의 나머지 이미지 primary 해제 후 대상만 지정(메인에서 clear 먼저). */
export async function setPrimaryCostumeImage(costumeId: string, imageId: string): Promise<void> {
  await window.electronAPI.supabaseSetPrimaryCostumeImage(costumeId, imageId);
}

export async function linkCharacterEpisode(
  episodeNumber: number,
  characterId: string,
  createdBy?: string | null,
): Promise<void> {
  await window.electronAPI.supabaseLinkCharacterEpisode(episodeNumber, characterId, createdBy);
}

export async function unlinkCharacterEpisode(episodeNumber: number, characterId: string): Promise<void> {
  await window.electronAPI.supabaseUnlinkCharacterEpisode(episodeNumber, characterId);
}

/** 캐릭터-에피소드 매핑의 이 편 전용 필드 수정 (memo / costumeIds). */
export async function updateEpisodeCharacterMapping(
  episodeNumber: number,
  characterId: string,
  updates: { memo?: string | null; costumeIds?: string[] },
): Promise<void> {
  await window.electronAPI.supabaseUpdateEpisodeCharacterMap(episodeNumber, characterId, updates);
}

export async function uploadCharacterImage(
  characterId: string,
  costumeId: string,
  base64Data: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  return window.electronAPI.storageUploadCharacterImage(characterId, costumeId, base64Data);
}

/**
 * 캐릭터 현황판 Realtime 구독. 세 테이블 변경을 table 판별자와 함께 전달.
 * 반환값은 cleanup 함수.
 */
export function subscribeCharacterBoardRealtime(
  onChange: (payload: {
    table: 'characters' | 'character_costumes' | 'character_costume_images' | 'episode_character_mapping' | 'character_board_tabs';
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void,
): () => void {
  return window.electronAPI.onCharacterBoardRealtime((payload) => {
    onChange(payload);
  });
}

export async function readAllMemos(userId: string) {
  return window.electronAPI.supabaseReadAllMemos(userId);
}
