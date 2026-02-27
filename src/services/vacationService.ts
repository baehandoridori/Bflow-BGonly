/**
 * 휴가 관리 서비스 — renderer → IPC → electron/vacation.ts 래퍼
 */

import type { VacationStatus, VacationLogEntry, VacationEvent, VacationConfig, VacationResult, DahyuGrantResult } from '@/types/vacation';

const CONFIG_FILE = 'vacation-config.json';

// ─── 설정 (로컬 파일) ───────────────────────────────────────────

export async function loadVacationConfig(): Promise<VacationConfig | null> {
  try {
    const data = await window.electronAPI.readSettings(CONFIG_FILE);
    return data as VacationConfig | null;
  } catch {
    return null;
  }
}

export async function saveVacationConfig(config: VacationConfig): Promise<void> {
  await window.electronAPI.writeSettings(CONFIG_FILE, config);
}

// ─── 연결 ─────────────────────────────────────────────────────

export async function connectVacation(url: string): Promise<{ ok: boolean; error: string | null }> {
  return window.electronAPI.vacationConnect(url);
}

export async function checkVacationConnection(): Promise<boolean> {
  return window.electronAPI.vacationIsConnected();
}

// ─── 읽기 ─────────────────────────────────────────────────────

export async function fetchVacationStatus(name: string): Promise<VacationStatus> {
  const result = await window.electronAPI.vacationReadStatus(name);
  if (!result.ok) throw new Error(result.error ?? '휴가 현황 조회 실패');
  return result.data;
}

export async function fetchVacationLog(
  name: string,
  year?: number,
  limit?: number
): Promise<VacationLogEntry[]> {
  const result = await window.electronAPI.vacationReadLog(name, year, limit);
  if (!result.ok) throw new Error(result.error ?? '휴가 이력 조회 실패');
  return result.data ?? [];
}

export async function fetchAllVacationEvents(year?: number): Promise<VacationEvent[]> {
  const result = await window.electronAPI.vacationReadAllEvents(year);
  if (!result.ok) throw new Error(result.error ?? '휴가 이벤트 조회 실패');
  return result.data ?? [];
}

// ─── 쓰기 ─────────────────────────────────────────────────────

export async function submitVacation(data: {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<VacationResult> {
  return window.electronAPI.vacationRegister(
    data.name, data.type, data.startDate, data.endDate, data.reason
  );
}

export async function cancelVacationRequest(
  name: string,
  rowIndex: number
): Promise<VacationResult> {
  return window.electronAPI.vacationCancel(name, rowIndex);
}

// ─── 대휴 지급 ─────────────────────────────────────────────────

export async function grantDahyu(data: {
  targets: string[];
  reason: string;
  grantDate: string;
}): Promise<DahyuGrantResult> {
  return window.electronAPI.vacationGrantDahyu(data.targets, data.reason, data.grantDate);
}

// ─── 전체 직원 이름 ─────────────────────────────────────────────

export async function fetchAllEmployeeNames(): Promise<string[]> {
  const result = await window.electronAPI.vacationReadAllNames();
  if (!result.ok) throw new Error(result.error ?? '직원 목록 조회 실패');
  return result.data ?? [];
}
