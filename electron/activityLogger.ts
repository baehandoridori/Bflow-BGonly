/**
 * Supabase IPC 활동 기록 — Main process 메모리 circular buffer.
 *
 * - 모든 supabase:* IPC 호출을 기록 (read/write)
 * - Array.shift 대신 고정 크기 + 인덱스 덮어쓰기 방식 → O(1), GC 부담 0
 * - 앱 재시작 시 초기화 (세션 활동 집계 전용)
 */

export type ActivityAction = 'read' | 'write';

export interface ActivityEvent {
  table: string;
  action: ActivityAction;
  ts: number;
}

// 30,000 이벤트 ≒ 초당 10 이벤트 기준 약 50분 / 초당 1 이벤트 기준 ~8시간 상세 유지
// 한 이벤트 ≈ 40 bytes → 총 ~1.2MB 고정 메모리
const BUFFER_SIZE = 30000;
const buf: (ActivityEvent | undefined)[] = new Array(BUFFER_SIZE);
let cursor = 0;

export function recordActivity(table: string, action: ActivityAction): void {
  buf[cursor] = { table, action, ts: Date.now() };
  cursor = (cursor + 1) % BUFFER_SIZE;
}

export interface ActivityQuery {
  /** 특정 테이블만 집계. 생략 시 전체 */
  table?: string;
  /** read/write 만 집계. 생략 시 전체 */
  action?: ActivityAction;
  /** 현재부터 과거 몇 ms 까지 집계할지 */
  rangeMs: number;
  /** 반환할 버킷 개수 */
  buckets: number;
}

export interface ActivityBucket {
  startTs: number;
  count: number;
}

/** 지정 범위 내 이벤트를 일정한 크기의 버킷으로 집계 */
export function getActivity(q: ActivityQuery): ActivityBucket[] {
  const now = Date.now();
  const cutoff = now - q.rangeMs;
  const bucketMs = q.rangeMs / q.buckets;
  const counts = new Array<number>(q.buckets).fill(0);

  for (const ev of buf) {
    if (!ev) continue;
    if (ev.ts < cutoff || ev.ts > now) continue;
    if (q.table && ev.table !== q.table) continue;
    if (q.action && ev.action !== q.action) continue;
    const idx = Math.min(Math.floor((ev.ts - cutoff) / bucketMs), q.buckets - 1);
    if (idx >= 0) counts[idx] += 1;
  }

  return counts.map((count, i) => ({
    startTs: cutoff + i * bucketMs,
    count,
  }));
}

/** IPC 채널명 → 관련 테이블 매핑 (기록 시 자동 분류용) */
export function channelToTable(channel: string): string {
  const rest = channel.replace(/^supabase:/, '');
  // 순서 중요: 구체 → 일반
  if (/revision/i.test(rest)) return 'comp_revisions';
  if (/comment/i.test(rest)) return 'comments';
  if (/user/i.test(rest)) return 'users';
  if (/scene/i.test(rest)) return 'scenes';
  if (/part(?!.*episode)/i.test(rest)) return 'parts';
  if (/episode|archive/i.test(rest)) return 'episodes';
  if (/metadata|private-event/i.test(rest)) return 'metadata';
  // read-all 은 scenes/parts/episodes 통합 로드 → 대표로 scenes
  if (rest === 'read-all') return 'scenes';
  if (rest === 'test-connection') return 'scenes';
  return 'other';
}

/** IPC 채널명 → read/write 분류 */
export function channelToAction(channel: string): ActivityAction {
  const rest = channel.replace(/^supabase:/, '');
  if (/^(read|test|get|list)/i.test(rest)) return 'read';
  return 'write';
}
