/**
 * 휴가 관리 서비스 — renderer → IPC → electron/vacation.ts 래퍼
 */

import type { VacationStatus, VacationLogEntry, VacationEvent, VacationConfig, VacationResult, DahyuGrantResult, DahyuListEntry, DahyuDeleteResult } from '@/types/vacation';
import { DEFAULT_VACATION_URL, DEFAULT_VACATION_TOKEN } from '@/config';

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

// ─── 구 주소 이관 ───────────────────────────────────────────────
//
// 2026-09-16 휴가 시스템이 구 Apps Script 웹 앱 → Supabase vacation-api 로 이관됐다.
// 그런데 설정 화면에서 예전에 '설정 저장'을 누른 PC 에는 vacation-config.json 에 구 주소가 남아 있고,
// 저장값이 기본 주소보다 우선이라 계속 구 주소로 붙었다. 구 웹 앱은 핑에 응답하므로 '연결됨'으로 보이면서
// 이관 시점에 멈춘 옛 시트를 읽는다 → 슬랙으로 올린 휴가가 B flow 에 안 보였다.
// 그래서 연결 주소는 반드시 resolveVacationConnection() 을 거쳐 정한다.
// (메인 프로세스 initVacation 은 구 주소도 받아들인다 — 코드로 되돌리는 롤백 경로라 거기서는 막지 않는다.)

/**
 * 구 Apps Script 웹 앱 주소인지.
 * https://script.google.com/macros/s/.../exec 와 Workspace 도메인형 /a/macros/<도메인>/s/.../exec 둘 다.
 */
export function isLegacyVacationUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname.toLowerCase() === 'script.google.com'
      && /^\/(a\/)?macros\//.test(parsed.pathname);
  } catch {
    // URL 로 못 읽는 값(스킴 누락 등)이라도 구 주소 모양이면 구 주소로 본다
    return /(^|\/\/)script\.google\.com\/(a\/)?macros\//i.test(trimmed);
  }
}

/** 설정 화면에서 구 주소를 저장·연결하려 할 때 보여 줄 안내 */
export const LEGACY_VACATION_URL_MESSAGE =
  '구 휴가 웹 앱(Apps Script)은 2026-09-16 이관으로 종료됐습니다. 입력칸을 새 주소로 되돌렸으니 다시 눌러 주세요.';

/** 설정 화면 입력값 검사 — 구 주소면 안내 문구, 아니면 null */
export function legacyVacationUrlError(url: string | null | undefined): string | null {
  return isLegacyVacationUrl(url) ? LEGACY_VACATION_URL_MESSAGE : null;
}

export interface ResolvedVacationConnection {
  /** 실제로 붙을 주소 — 저장값이 비었거나 구 주소면 기본 주소 */
  url: string;
  /** 실제로 실을 토큰 — 설정 파일 값이 우선, 없으면 빌드에 박힌 값 */
  apiToken: string;
  /** 설정 파일에 들어 있던 토큰 원문(설정 화면 입력란 표시용). 없으면 '' */
  savedApiToken: string;
  /** 설정 파일에서 유효한 설정을 읽었는지 */
  hasSavedConfig: boolean;
  /** 구 주소를 발견해 새 주소로 바꿨는지 */
  migratedFromLegacy: boolean;
}

/**
 * 설정 파일을 읽어 실제로 쓸 휴가 API 주소·토큰을 정한다.
 *
 * - 저장된 주소가 없거나 비었으면 기본 주소.
 * - 구 Apps Script 주소면 기본 주소를 쓰고, **설정 파일도 새 주소로 다시 쓴다**
 *   (apiToken 등 다른 키는 그대로 둔다). 다시 쓰기에 실패해도 이번 연결은 새 주소로 한다.
 * - 그 밖의 주소는 그대로(사용자가 일부러 넣은 새 주소·테스트 주소).
 * - 파일을 못 읽으면 기본값으로 가고 파일은 건드리지 않는다(읽지 못한 파일을 덮어써 토큰을 잃지 않게).
 */
export async function resolveVacationConnection(): Promise<ResolvedVacationConnection> {
  // loadVacationConfig 는 읽기 실패 시 예외 대신 null 을 돌려준다
  const raw: unknown = await loadVacationConfig();
  const config = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<VacationConfig> & Record<string, unknown>
    : null;

  const savedUrl = typeof config?.webAppUrl === 'string' ? config.webAppUrl.trim() : '';
  const savedApiToken = typeof config?.apiToken === 'string' ? config.apiToken : '';
  const apiToken = savedApiToken || DEFAULT_VACATION_TOKEN;
  const migratedFromLegacy = isLegacyVacationUrl(savedUrl);

  if (migratedFromLegacy && config) {
    try {
      await saveVacationConfig({ ...config, webAppUrl: DEFAULT_VACATION_URL } as VacationConfig);
      console.info('[Vacation] 구 휴가 웹 앱 주소를 새 주소로 바꿔 저장했습니다');
    } catch (err) {
      console.warn('[Vacation] 구 주소 설정 파일 다시 쓰기 실패 — 이번 연결은 새 주소로 진행', err);
    }
  }

  return {
    url: !savedUrl || migratedFromLegacy ? DEFAULT_VACATION_URL : savedUrl,
    apiToken,
    savedApiToken,
    hasSavedConfig: config !== null,
    migratedFromLegacy,
  };
}

// ─── 연결 ─────────────────────────────────────────────────────

export async function connectVacation(
  url: string,
  apiToken?: string
): Promise<{ ok: boolean; error: string | null }> {
  return window.electronAPI.vacationConnect(url, apiToken);
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

// ─── 대휴 목록 조회 ─────────────────────────────────────────────

export async function fetchDahyuList(): Promise<DahyuListEntry[]> {
  const result = await window.electronAPI.vacationReadDahyuList();
  if (!result.ok) throw new Error(result.error ?? '대휴 목록 조회 실패');
  return result.data ?? [];
}

// ─── 대휴 삭제 ─────────────────────────────────────────────────

export async function deleteDahyuRequest(rowIndices: number[]): Promise<DahyuDeleteResult> {
  return window.electronAPI.vacationDeleteDahyu(rowIndices);
}
