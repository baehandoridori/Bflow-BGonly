/**
 * Vacation HTTP 통신 모듈
 *
 * 휴가 등록/취소/조회를 처리한다. 2026-09 이관으로 상대는
 * 구 WebApi.gs 웹 앱에서 **Supabase Edge Function(vacation-api)** 으로 바뀌었다.
 * 요청·응답 형식(action·봉투·상태 문자열)은 동결 계약이라 그대로이고,
 * 달라진 것은 주소와 `x-bflow-token` 인증 헤더뿐이다.
 *
 * sheets.ts 패턴을 따르되, 별도 웹 앱 URL을 사용한다.
 */

import { gasFetch, gasFetchWithRetry } from './gas-fetch';

let vacationUrl: string | null = null;
let vacationToken: string | null = null;

/**
 * 휴가 API 인증 헤더.
 *
 * 신 API는 토큰이 없거나 틀리면 모든 action을 거부한다.
 * 토큰이 비어 있으면 헤더를 아예 붙이지 않는다 — 구 Apps Script는 헤더를 무시하므로
 * 어느 주소를 가리키든 같은 코드로 동작한다(롤백 시 URL만 되돌리면 된다).
 */
function vacHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return vacationToken ? { ...extra, 'x-bflow-token': vacationToken } : extra;
}

// ─── 진행 중 작업 추적 (종료 시 큐 보장) ─────────────────────
let vacPendingOps = 0;
let vacPendingResolvers: (() => void)[] = [];

export function getVacPendingOpsCount(): number {
  return vacPendingOps;
}

/** 모든 진행 중 휴가 API 작업이 완료될 때까지 대기 (최대 timeoutMs) */
export function waitForVacPendingOps(timeoutMs = 60000): Promise<boolean> {
  if (vacPendingOps <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    vacPendingResolvers.push(() => { clearTimeout(timer); resolve(true); });
  });
}

function trackVacPending<T>(op: Promise<T>): Promise<T> {
  vacPendingOps++;
  return op.finally(() => {
    vacPendingOps--;
    if (vacPendingOps <= 0) {
      vacPendingOps = 0;
      const resolvers = vacPendingResolvers.splice(0);
      resolvers.forEach((r) => r());
    }
  });
}

// ─── 연결 ─────────────────────────────────────────────────────

export async function initVacation(
  url: string,
  token?: string
): Promise<{ ok: boolean; error?: string }> {
  const t = token?.trim() || null;
  try {
    const res = await gasFetch(`${url}?action=ping`, {
      headers: t ? { 'x-bflow-token': t } : {},
    });
    if (!res.ok) {
      console.error('[Vacation] 핑 실패:', res.status);
      return { ok: false, error: `서버 응답 오류 (HTTP ${res.status})` };
    }

    const json = await res.json();
    if (!json.ok) {
      // 인증 실패도 HTTP 200 봉투로 온다(§7-2) — 문구를 그대로 올려 URL 문제와 구분되게 한다
      console.error('[Vacation] 핑 응답 오류:', json.error);
      return { ok: false, error: String(json.error ?? '연결 실패') };
    }

    vacationUrl = url;
    vacationToken = t;
    console.log('[Vacation] 연결 성공');
    return { ok: true };
  } catch (err) {
    console.error('[Vacation] 연결 실패:', err);
    vacationUrl = null;
    vacationToken = null;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
  validUseCount?: number;
}

export interface DahyuGrantResult {
  ok: boolean;
  success: boolean;
  granted: string[];
  failed: string[];
  state: string;
}

export interface DahyuListEntry {
  rowIndex: number;
  name: string;
  grantDate: string;
  reason: string;
}

export interface DahyuDeleteResult {
  ok: boolean;
  success: boolean;
  deleted: number[];
  failed: number[];
  state: string;
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

  const qs = new URLSearchParams({ action: 'readStatus', name, _t: String(Date.now()) });
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, { headers: vacHeaders() }, 'Vacation');
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

  const params: Record<string, string> = { action: 'readLog', name, _t: String(Date.now()) };
  if (year) params.year = String(year);
  if (limit) params.limit = String(limit);

  const qs = new URLSearchParams(params);
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, { headers: vacHeaders() }, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: VacationLogEntry[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '휴가 이력 읽기 실패');
  return json.data ?? [];
}

export async function readAllVacationEvents(year?: number): Promise<VacationEvent[]> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const params: Record<string, string> = { action: 'readAllEvents', _t: String(Date.now()) };
  if (year) params.year = String(year);

  const qs = new URLSearchParams(params);
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, { headers: vacHeaders() }, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: VacationEvent[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '휴가 이벤트 읽기 실패');
  return json.data ?? [];
}

// ─── 쓰기 ─────────────────────────────────────────────────────
// 주의: VacationAutoexportAndUpdateDashboard()에 Utilities.sleep(5000)이 포함되어
// API 응답이 10초+ 소요 가능. AbortController로 60초 timeout 설정.

export function registerVacation(data: {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<VacationResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  return trackVacPending((async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000); // 60초 timeout

    try {
      const res = await gasFetch(vacationUrl!, {
        method: 'POST',
        headers: vacHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'register', ...data }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as VacationResult;
      return json;
    } finally {
      clearTimeout(timer);
    }
  })());
}

export function cancelVacation(
  name: string,
  rowIndex: number
): Promise<VacationResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  return trackVacPending((async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await gasFetch(vacationUrl!, {
        method: 'POST',
        headers: vacHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'cancel', name, rowIndex }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as VacationResult;
      return json;
    } finally {
      clearTimeout(timer);
    }
  })());
}

// ─── 대휴 지급 ─────────────────────────────────────────────────

export async function grantDahyu(data: {
  targets: string[];
  reason: string;
  grantDate: string;
}): Promise<DahyuGrantResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await gasFetch(vacationUrl, {
      method: 'POST',
      headers: vacHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'grantDahyu', ...data }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as DahyuGrantResult;
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 전체 직원 이름 ─────────────────────────────────────────────

export async function readAllEmployeeNames(): Promise<string[]> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const qs = new URLSearchParams({ action: 'readAllNames', _t: String(Date.now()) });
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, { headers: vacHeaders() }, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: string[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '직원 목록 읽기 실패');
  return json.data ?? [];
}

// ─── 대휴 목록 조회 ─────────────────────────────────────────────

export async function readDahyuList(): Promise<DahyuListEntry[]> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const qs = new URLSearchParams({ action: 'readDahyuList', _t: String(Date.now()) });
  const res = await gasFetchWithRetry(`${vacationUrl}?${qs}`, { headers: vacHeaders() }, 'Vacation');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: DahyuListEntry[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '대휴 목록 읽기 실패');
  return json.data ?? [];
}

// ─── 대휴 삭제 ─────────────────────────────────────────────────

export async function deleteDahyu(rowIndices: number[]): Promise<DahyuDeleteResult> {
  if (!vacationUrl) throw new Error('Vacation 미연결');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await gasFetch(vacationUrl, {
      method: 'POST',
      headers: vacHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'deleteDahyu', rowIndices }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as DahyuDeleteResult;
    return json;
  } finally {
    clearTimeout(timer);
  }
}
