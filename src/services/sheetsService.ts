/**
 * Google Sheets 연동 서비스 — 렌더러 프로세스
 *
 * Apps Script 웹 앱 URL을 통해 시트 데이터를 읽고 쓴다.
 * 테스트 모드에서는 로컬 JSON, 라이브 모드에서는 Apps Script 웹 앱을 사용.
 * App.tsx에서 모드에 따라 이 서비스 또는 testSheetService를 호출한다.
 */

import type { Episode, Stage, SheetsConfig, Department, RegistryEntry } from '@/types';

const SHEETS_CONFIG_FILE = 'sheets-config.json';

// ─── 설정 저장/불러오기 ────────────────────────

export async function loadSheetsConfig(): Promise<SheetsConfig | null> {
  try {
    const data = await window.electronAPI.readSettings(SHEETS_CONFIG_FILE);
    if (data && typeof data === 'object') {
      return data as SheetsConfig;
    }
  } catch (err) {
    console.error('[Sheets] 설정 로드 실패:', err);
  }
  return null;
}

export async function saveSheetsConfig(config: SheetsConfig): Promise<void> {
  try {
    await window.electronAPI.writeSettings(SHEETS_CONFIG_FILE, config);
  } catch (err) {
    console.error('[Sheets] 설정 저장 실패:', err);
  }
}

// ─── 연결 ──────────────────────────────────────

export async function connectSheets(webAppUrl: string): Promise<{ ok: boolean; error: string | null }> {
  return window.electronAPI.sheetsConnect(webAppUrl);
}

export async function checkConnection(): Promise<boolean> {
  return window.electronAPI.sheetsIsConnected();
}

// ─── 데이터 읽기 ──────────────────────────────

export async function readAllFromSheets(): Promise<Episode[]> {
  const result = await window.electronAPI.sheetsReadAll();
  if (!result.ok) {
    throw new Error(result.error ?? '시트 읽기 실패');
  }
  return result.data ?? [];
}

// ─── Batch 요청 (Phase 0: 여러 작업을 한 번에) ──────────────

export interface BatchAction {
  action: string;
  params: Record<string, string>;
}

export interface BatchResult {
  ok: boolean;
  results?: { ok: boolean; data?: unknown }[];
  error?: string;
  failedAt?: number;
}

export async function batchToSheets(actions: BatchAction[]): Promise<BatchResult> {
  const result = await window.electronAPI.sheetsBatch(actions);
  if (!result.ok) {
    throw new Error(result.error ?? '배치 요청 실패');
  }
  return result;
}

/** 배치 액션 빌더 — 타입 안전한 배치 작업 생성 */
export const batchActions = {
  addEpisode: (episodeNumber: number, department: Department = 'bg'): BatchAction => ({
    action: 'addEpisode',
    params: { episodeNumber: String(episodeNumber), department },
  }),

  addPart: (episodeNumber: number, partId: string, department: Department = 'bg'): BatchAction => ({
    action: 'addPart',
    params: { episodeNumber: String(episodeNumber), partId, department },
  }),

  writeMetadata: (type: string, key: string, value: string): BatchAction => ({
    action: 'writeMetadata',
    params: { type, key, value },
  }),

  archiveEpisode: (episodeNumber: number): BatchAction => ({
    action: 'archiveEpisode',
    params: { episodeNumber: String(episodeNumber) },
  }),

  deleteScene: (sheetName: string, rowIndex: number): BatchAction => ({
    action: 'deleteScene',
    params: { sheetName, rowIndex: String(rowIndex) },
  }),

  updateSceneField: (sheetName: string, rowIndex: number, field: string, value: string): BatchAction => ({
    action: 'updateSceneField',
    params: { sheetName, rowIndex: String(rowIndex), field, value },
  }),

  softDeleteEpisode: (episodeNumber: number): BatchAction => ({
    action: 'softDeleteEpisode',
    params: { episodeNumber: String(episodeNumber) },
  }),
};

// ─── 셀 업데이트 (체크박스 토글) ──────────────

export async function updateSheetCell(
  sheetName: string,
  rowIndex: number,
  stage: Stage,
  value: boolean
): Promise<void> {
  const result = await window.electronAPI.sheetsUpdateCell(
    sheetName, rowIndex, stage, value
  );
  if (!result.ok) {
    throw new Error(result.error ?? '셀 업데이트 실패');
  }
}

// ─── CRUD ────────────────────────────────────

async function assertOk(promise: Promise<{ ok: boolean; error?: string }>, fallback: string) {
  const result = await promise;
  if (!result.ok) throw new Error(result.error ?? fallback);
}

export async function addEpisodeToSheets(episodeNumber: number, department: Department = 'bg'): Promise<void> {
  await assertOk(window.electronAPI.sheetsAddEpisode(episodeNumber, department), '에피소드 추가 실패');
}

export async function addPartToSheets(episodeNumber: number, partId: string, department: Department = 'bg'): Promise<void> {
  await assertOk(window.electronAPI.sheetsAddPart(episodeNumber, partId, department), '파트 추가 실패');
}

export async function addSceneToSheets(
  sheetName: string, sceneId: string, assignee: string, memo: string
): Promise<void> {
  await assertOk(window.electronAPI.sheetsAddScene(sheetName, sceneId, assignee, memo), '씬 추가 실패');
}

export async function deleteSceneFromSheets(sheetName: string, rowIndex: number): Promise<void> {
  await assertOk(window.electronAPI.sheetsDeleteScene(sheetName, rowIndex), '씬 삭제 실패');
}

export async function updateSceneFieldInSheets(
  sheetName: string, rowIndex: number, field: string, value: string
): Promise<void> {
  await assertOk(window.electronAPI.sheetsUpdateSceneField(sheetName, rowIndex, field, value), '씬 수정 실패');
}

// ─── 메타데이터 CRUD ─────────────────────────

export async function readMetadataFromSheets(
  type: string, key: string
): Promise<{ type: string; key: string; value: string; updatedAt: string } | null> {
  const result = await window.electronAPI.sheetsReadMetadata(type, key);
  if (!result.ok) throw new Error(result.error ?? '메타데이터 읽기 실패');
  return result.data ?? null;
}

export async function writeMetadataToSheets(
  type: string, key: string, value: string
): Promise<void> {
  await assertOk(window.electronAPI.sheetsWriteMetadata(type, key, value), '메타데이터 쓰기 실패');
}

export async function softDeletePartInSheets(sheetName: string): Promise<void> {
  await assertOk(window.electronAPI.sheetsSoftDeletePart(sheetName), '파트 삭제 실패');
}

export async function softDeleteEpisodeInSheets(episodeNumber: number): Promise<void> {
  await assertOk(window.electronAPI.sheetsSoftDeleteEpisode(episodeNumber), '에피소드 삭제 실패');
}

// ─── 아카이빙 ────────────────────────────────

export async function readArchivedFromSheets(): Promise<{ episodeNumber: number; title: string; partCount: number; archivedBy?: string; archivedAt?: string; archiveMemo?: string }[]> {
  const result = await window.electronAPI.sheetsReadArchived();
  if (!result.ok) throw new Error(result.error ?? '아카이빙 목록 읽기 실패');
  return result.data ?? [];
}

export async function archiveEpisodeInSheets(episodeNumber: number): Promise<void> {
  await assertOk(window.electronAPI.sheetsArchiveEpisode(episodeNumber), '에피소드 아카이빙 실패');
}

export async function unarchiveEpisodeInSheets(episodeNumber: number): Promise<void> {
  await assertOk(window.electronAPI.sheetsUnarchiveEpisode(episodeNumber), '에피소드 복원 실패');
}

// ─── 이미지 업로드 (Drive) ───────────────────

export async function uploadImageToSheets(
  sheetName: string,
  sceneId: string,
  imageType: string,
  base64Data: string
): Promise<string> {
  const result = await window.electronAPI.sheetsUploadImage(sheetName, sceneId, imageType, base64Data);
  if (!result.ok || !result.url) {
    throw new Error(result.error ?? '이미지 업로드 실패');
  }
  return result.url;
}

// ─── 대량 씬 추가 (Phase 0-5) ────────────────

export async function addScenesToSheets(
  sheetName: string,
  scenes: { sceneId: string; assignee: string; memo: string }[],
): Promise<void> {
  const result = await window.electronAPI.sheetsAddScenes(sheetName, scenes);
  if (!result.ok) {
    throw new Error(result.error ?? '대량 씬 추가 실패');
  }
}

// ─── _REGISTRY (Phase 0-2) ──────────────────

export async function readRegistryFromSheets(): Promise<RegistryEntry[]> {
  const result = await window.electronAPI.sheetsReadRegistry();
  if (!result.ok) throw new Error(result.error ?? '레지스트리 읽기 실패');
  return result.data ?? [];
}

export async function archiveEpisodeViaRegistryInSheets(
  episodeNumber: number, archivedBy: string, archiveMemo: string
): Promise<void> {
  await assertOk(
    window.electronAPI.sheetsArchiveEpisodeViaRegistry(episodeNumber, archivedBy, archiveMemo),
    '에피소드 아카이빙 실패 (레지스트리)'
  );
}

export async function unarchiveEpisodeViaRegistryInSheets(episodeNumber: number): Promise<void> {
  await assertOk(
    window.electronAPI.sheetsUnarchiveEpisodeViaRegistry(episodeNumber),
    '에피소드 복원 실패 (레지스트리)'
  );
}
