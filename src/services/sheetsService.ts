/**
 * Google Sheets 연동 서비스 — 렌더러 프로세스
 *
 * 테스트 모드에서는 로컬 JSON, 라이브 모드에서는 실제 Google Sheets API를 사용.
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

export async function connectSheets(credentialsPath: string): Promise<{ ok: boolean; error: string | null }> {
  return window.electronAPI.sheetsConnect(credentialsPath);
}

export async function checkConnection(): Promise<boolean> {
  return window.electronAPI.sheetsIsConnected();
}

// ─── 데이터 읽기 ──────────────────────────────

export async function readAllFromSheets(spreadsheetId: string): Promise<Episode[]> {
  const result = await window.electronAPI.sheetsReadAll(spreadsheetId);
  if (!result.ok) {
    throw new Error(result.error ?? '시트 읽기 실패');
  }
  return result.data ?? [];
}

// ─── 셀 업데이트 (체크박스 토글) ──────────────

export async function updateSheetCell(
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
  stage: Stage,
  value: boolean
): Promise<void> {
  const result = await window.electronAPI.sheetsUpdateCell(
    spreadsheetId, sheetName, rowIndex, stage, value
  );
  if (!result.ok) {
    throw new Error(result.error ?? '셀 업데이트 실패');
  }
}

// ─── 파일 선택 대화상자 ───────────────────────

export async function pickCredentialsFile(): Promise<string | null> {
  return window.electronAPI.sheetsPickCredentials();
}
