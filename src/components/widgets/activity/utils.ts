import type { Activity } from '@/types';
import { GROUP_WINDOW_MS } from './constants';

export type FeedItem =
  | { type: 'item'; activity: Activity }
  | { type: 'group'; key: string; items: Activity[] };

/**
 * 활동 목록을 5분 윈도우 그룹으로 묶는다.
 * 같은 user + 같은 action_type + 같은 episode + 5분 이내 → 한 그룹.
 * 단일 항목은 type='item' 으로 평면화.
 */
export function groupActivities(items: Activity[]): FeedItem[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const result: FeedItem[] = [];
  let buffer: Activity[] = [sorted[0]];

  const sameGroup = (a: Activity, b: Activity) => {
    if (a.userId !== b.userId) return false;
    if (a.actionType !== b.actionType) return false;
    if (a.episodeNumber !== b.episodeNumber) return false;
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    return Math.abs(da - db) <= GROUP_WINDOW_MS;
  };

  const flush = () => {
    if (buffer.length === 1) {
      result.push({ type: 'item', activity: buffer[0] });
    } else {
      result.push({
        type: 'group',
        key: `${buffer[0].userId}:${buffer[0].actionType}:${buffer[0].episodeNumber ?? 'na'}:${buffer[0].id}`,
        items: [...buffer],
      });
    }
    buffer = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = buffer[buffer.length - 1];
    const cur = sorted[i];
    if (sameGroup(prev, cur)) buffer.push(cur);
    else { flush(); buffer.push(cur); }
  }
  flush();
  return result;
}

export interface GoldenWindow {
  day: number;
  hour: number;
  count: number;
}

/** 24x7 격자에서 연속 2시간 합이 최대인 슬롯. 동률이면 가장 최근 요일 우선. */
export function pickGoldenWindow(grid: number[][]): GoldenWindow | null {
  let best: GoldenWindow | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 23; h++) {
      const sum = (grid[d]?.[h] ?? 0) + (grid[d]?.[h + 1] ?? 0);
      if (sum === 0) continue;
      if (!best || sum > best.count || (sum === best.count && d > best.day)) {
        best = { day: d, hour: h, count: sum };
      }
    }
  }
  return best;
}

/** 24시간 합산에서 연속 2시간 정점. */
export function pickGoldenHour(hourTotals: number[]): { hour: number; ratio: number } | null {
  const total = hourTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestHour = 0, bestSum = 0;
  for (let h = 0; h < 23; h++) {
    const sum = hourTotals[h] + (hourTotals[h + 1] ?? 0);
    if (sum > bestSum) { bestSum = sum; bestHour = h; }
  }
  return { hour: bestHour, ratio: bestSum / total };
}

/** 7요일 합산에서 정점 요일. */
export function pickGoldenDay(dayTotals: number[]): { day: number; ratio: number } | null {
  const total = dayTotals.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let bestDay = 0, bestCount = 0;
  for (let d = 0; d < 7; d++) {
    if (dayTotals[d] > bestCount) { bestCount = dayTotals[d]; bestDay = d; }
  }
  return { day: bestDay, ratio: bestCount / total };
}

/**
 * stats 결과(PostgreSQL EXTRACT(dow): 0=일~6=토) → 표시용 24x7 격자.
 * 표시 인덱스: 0=월, 1=화, ..., 5=토, 6=일.
 */
export function buildHeatmapGrid(stats: Array<{ day_of_week: number; hour: number; count: number }>): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of stats) {
    // pg dow 0=일,1=월,...,6=토 → 표시 0=월,...,6=일
    const displayDay = (s.day_of_week + 6) % 7;
    if (displayDay >= 0 && displayDay < 7 && s.hour >= 0 && s.hour < 24) {
      grid[displayDay][s.hour] = s.count;
    }
  }
  return grid;
}

export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

export function intensityBg(level: 0 | 1 | 2 | 3 | 4): string {
  return [
    'rgba(108, 92, 231, 0.06)',
    'rgba(108, 92, 231, 0.18)',
    'rgba(108, 92, 231, 0.36)',
    'rgba(108, 92, 231, 0.58)',
    'rgba(108, 92, 231, 0.85)',
  ][level];
}

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
export function dayLabel(idx: number): string {
  return DAY_LABELS[idx] ?? '';
}

/** 상대 시간 표시 — 24시간 미만 상대, 이상 절대 */
export function formatRelativeTime(isoString: string, now: number = Date.now()): string {
  const then = new Date(isoString).getTime();
  const diff = now - then;
  if (diff < 0) return '방금';
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  // 24시간 이상 — 절대 시간 (간단 KST 변환)
  const dt = new Date(isoString);
  const kst = new Date(dt.getTime() + 9 * 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  if (days === 1) return `어제 ${hh}:${mm}`;
  if (days < 7) return `${days}일 전 ${hh}:${mm}`;
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${mo}/${dd} ${hh}:${mm}`;
}
