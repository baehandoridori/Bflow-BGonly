// ─── 휴가 관리 타입 ──────────────────────────────────────────

export type VacationType = '연차' | '오전반차' | '오후반차' | '대체휴가' | '특별휴가';

export const VACATION_TYPES: VacationType[] = ['연차', '오전반차', '오후반차', '대체휴가', '특별휴가'];

export const VACATION_COLOR = '#00B894'; // 에메랄드 그린

export interface VacationStatus {
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

export interface VacationRegisterRequest {
  name: string;
  type: VacationType;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface VacationResult {
  ok: boolean;
  success: boolean;
  state: string;
  rowIndex?: number;
  error?: string;
}

export interface VacationConfig {
  webAppUrl: string;
}
