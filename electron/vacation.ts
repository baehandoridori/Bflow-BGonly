/**
 * Vacation HTTP 통신 모듈
 *
 * vacation-repo의 WebApi.gs 웹 앱과 통신하여
 * 휴가 등록/취소/조회를 처리한다.
 *
 * sheets.ts 패턴을 따르되, 별도 웹 앱 URL을 사용한다.
 */

import { gasFetch, gasFetchWithRetry } from './gas-fetch';

let vacationUrl: string | null = null;

// ─── 연결 ─────────────────────────────────────────────────────

export async function initVacation(url: string): Promise<boolean> {
  try {
    const res = await gasFetch(`${url}?action=ping`);
    if (!res.ok) {
      console.error('[Vacation] 핑 실패:', res.status);
      return false;
    }

    const json = await res.json();
    if (!json.ok) {
      console.error('[Vacation] 핑 응답 오류:', json.error);
      return false;
    }

    vacationUrl = url;
    console.log('[Vacation] 연결 성공');
    return true;
  } catch (err) {
    console.error('[Vacation] 연결 실패:', err);
    vacationUrl = null;
    return false;
  }
}

export function isVacationConnected(): boolean {
  return vacationUrl !== null;
}

// ─── 타입 ─────────────────────────────────────────────────────

export interface VacationStatusResponse {
  name: string;
  found: boolean;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  overuse: boolean;
  altVacationHeld: number;
  altVacationUsed: number;
  altVacationNet: number;
  specialVacationUsed: number;
  totalUseCount: number;
}

export interface VacationLogEntry {
  rowIndex: number;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  days: number | string;
  state: string;
}

export interface VacationEvent {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
}

export interface VacationResult {
  ok: boolean;
  success: boolean;
  state: string;
  rowIndex?: number;
  error?: string;
}

// ─── 읽기 ─────────────────────────────────────────────────────

export async function readVacationStatus(name: string): Promise<VacationStatusResponse> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const qs = new URLSearchParams({ action: 'readStatus', name });
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, {}, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: VacationStatusResponse; error?: string };
  if (!json.ok) throw new Error(json.error ?? '휴가 현황 읽기 실패');
  return json.data!;
}

export async function readVacationLog(
  name: string,
  year?: number,
  limit?: number
): Promise<VacationLogEntry[]> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const params: Record<string, string> = { action: 'readLog', name };
  if (year) params.year = String(year);
  if (limit) params.limit = String(limit);

  const qs = new URLSearchParams(params);
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, {}, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: VacationLogEntry[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '휴가 이력 읽기 실패');
  return json.data ?? [];
}

export async function readAllVacationEvents(year?: number): Promise<VacationEvent[]> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const params: Record<string, string> = { action: 'readAllEvents' };
  if (year) params.year = String(year);

  const qs = new URLSearchParams(params);
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, {}, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: VacationEvent[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '휴가 이벤트 읽기 실패');
  return json.data ?? [];
}

// ─── 쓰기 ─────────────────────────────────────────────────────
// 주의: VacationAutoexportAndUpdateDashboard()에 Utilities.sleep(5000)이 포함되어
// API 응답이 10초+ 소요 가능. AbortController로 60초 timeout 설정.

export async function registerVacation(data: {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<VacationResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000); // 60초 timeout

  try {
    const res = await gasFetch(vacationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', ...data }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as VacationResult;
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function cancelVacation(
  name: string,
  rowIndex: number
): Promise<VacationResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await gasFetch(vacationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', name, rowIndex }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as VacationResult;
    return json;
  } finally {
    clearTimeout(timer);
  }
}
