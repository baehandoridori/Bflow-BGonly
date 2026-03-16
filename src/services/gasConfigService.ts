/**
 * GAS (Google Apps Script) 설정 관리 서비스 — 렌더러 프로세스
 *
 * 이미지 업로드용 GAS 웹 앱 URL 설정을 관리한다.
 * sheetsService.ts에서 분리됨 (Supabase 마이그레이션 M-5).
 */

import type { SheetsConfig } from '@/types';

const GAS_CONFIG_FILE = 'sheets-config.json'; // 기존 파일명 유지 (호환)

// ─── 설정 저장/불러오기 ────────────────────────

export async function loadGasConfig(): Promise<SheetsConfig | null> {
  try {
    const data = await window.electronAPI.readSettings(GAS_CONFIG_FILE);
    if (data && typeof data === 'object') {
      return data as SheetsConfig;
    }
  } catch (err) {
    console.error('[GAS] 설정 로드 실패:', err);
  }
  return null;
}

export async function saveGasConfig(config: SheetsConfig): Promise<void> {
  try {
    await window.electronAPI.writeSettings(GAS_CONFIG_FILE, config);
  } catch (err) {
    console.error('[GAS] 설정 저장 실패:', err);
  }
}

// ─── GAS 연결 ──────────────────────────────────

export async function connectGas(webAppUrl: string): Promise<{ ok: boolean; error: string | null }> {
  return window.electronAPI.sheetsConnect(webAppUrl);
}

export async function checkGasConnection(): Promise<boolean> {
  return window.electronAPI.sheetsIsConnected();
}

// 호환성 alias (sheetsService.ts에서 이관)
export const loadSheetsConfig = loadGasConfig;
export const saveSheetsConfig = saveGasConfig;
export const connectSheets = connectGas;
export const checkConnection = checkGasConnection;
