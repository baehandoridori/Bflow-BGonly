/**
 * Google Sheets 연동 서비스 — 렌더러 프로세스
 *
 * Apps Script 웹 앱 URL을 통해 시트 데이터를 읽고 쓴다.
 * 테스트 모드에서는 로컬 JSON, 라이브 모드에서는 Apps Script 웹 앱을 사용.
 * App.tsx에서 모드에 따라 이 서비스 또는 testSheetService를 호출한다.
 */

import type { Episode, Stage, SheetsConfig } from '@/types';

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

export async function addEpisodeToSheets(episodeNumber: number): Promise<void> {
  await assertOk(window.electronAPI.sheetsAddEpisode(episodeNumber), '에피소드 추가 실패');
}

export async function addPartToSheets(episodeNumber: number, partId: string): Promise<void> {
  await assertOk(window.electronAPI.sheetsAddPart(episodeNumber, partId), '파트 추가 실패');
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
