/**
 * v1.23.0: 시간 단위(주/달/년) + 기간 인덱스(0=현재) 의 KST 캘린더 경계 계산.
 *
 * - week: 월요일 시작 (월~일)
 * - month: 1일~말일
 * - year: 1/1~12/31
 *
 * 반환: UTC ISO 문자열 (Supabase timestamptz 비교용) + 사람 읽는 라벨.
 */
import type { TimeUnit } from '@/types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKST(d: Date): Date { return new Date(d.getTime() + KST_OFFSET_MS); }
function fromKST(d: Date): Date { return new Date(d.getTime() - KST_OFFSET_MS); }

export function getRangeBoundary(
  unit: TimeUnit,
  rangeIdx: number,
  now: Date = new Date(),
): { startISO: string; endISO: string; label: string } {
  const kst = toKST(now);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const dow = kst.getUTCDay(); // 0=일

  let kstStart: Date;
  let kstEnd: Date;
  let label: string;

  if (unit === 'week') {
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monKst = new Date(Date.UTC(y, m, d + diffToMon));
    kstStart = new Date(Date.UTC(monKst.getUTCFullYear(), monKst.getUTCMonth(), monKst.getUTCDate() - rangeIdx * 7));
    kstEnd = new Date(Date.UTC(kstStart.getUTCFullYear(), kstStart.getUTCMonth(), kstStart.getUTCDate() + 7));
    const lastDay = new Date(kstEnd.getTime() - 86_400_000);
    const span = `${kstStart.getUTCMonth() + 1}/${kstStart.getUTCDate()}–${lastDay.getUTCMonth() + 1}/${lastDay.getUTCDate()}`;
    label = rangeIdx === 0 ? `이번 주 (${span})`
          : rangeIdx === 1 ? `지난 주 (${span})`
          : `${rangeIdx}주 전 (${span})`;
  } else if (unit === 'month') {
    const targetMonth = m - rangeIdx;
    kstStart = new Date(Date.UTC(y, targetMonth, 1));
    kstEnd = new Date(Date.UTC(y, targetMonth + 1, 1));
    label = rangeIdx === 0 ? `이번 달 (${kstStart.getUTCMonth() + 1}월)`
          : rangeIdx === 1 ? `지난 달 (${kstStart.getUTCMonth() + 1}월)`
          : `${kstStart.getUTCFullYear()}년 ${kstStart.getUTCMonth() + 1}월`;
  } else {
    const targetYear = y - rangeIdx;
    kstStart = new Date(Date.UTC(targetYear, 0, 1));
    kstEnd = new Date(Date.UTC(targetYear + 1, 0, 1));
    label = rangeIdx === 0 ? `올해 (${targetYear}년)`
          : rangeIdx === 1 ? `작년 (${targetYear}년)`
          : `${targetYear}년`;
  }

  return {
    startISO: fromKST(kstStart).toISOString(),
    endISO: fromKST(kstEnd).toISOString(),
    label,
  };
}

/** 단위에 따른 RPC granularity */
export function granularityFor(unit: TimeUnit): 'hour-of-day-x-dow' | 'month-x-dow' {
  if (unit === 'year') return 'month-x-dow';
  return 'hour-of-day-x-dow';
}

/** "오늘로" 버튼 레이블 */
export function todayLabelFor(unit: TimeUnit): string {
  return unit === 'week' ? '이번 주' : unit === 'month' ? '이번 달' : '올해';
}
