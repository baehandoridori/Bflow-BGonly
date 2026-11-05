/**
 * 씬 댓글 서버 알림 줄 → 알림 목록·토스트(씬 댓글 B안 PR 6). 스토어·창 없이 돌도록 필요한 것을 모두 받는다.
 *
 *  - 판정(decide)은 실시간 판정과 같은 중복 키를 낸다 — 이미 띄운 댓글(claim 실패)은 건너뛴다.
 *  - quiet(로그인·재연결·한꺼번에 여러 줄)이거나 다른 PC 에서 이미 읽은 줄은 목록에만(읽은 줄은 읽은 채로).
 *    아니면 실시간 알림처럼 띄운다(dispatch — 이미 목록에 있으면 토스트를 다시 띄우지 않는 것은 dispatch 몫).
 *  - 새로 알린 수는 목록에 없던 안 읽은 줄만 센다('놓친 알림 N개' 요약).
 * 런타임 import 가 없어 node --test 가 바로 불러 쓴다.
 */

import type { CommentNotificationRow } from '../shared/commentNotification.ts';

export interface PresentedServerDecision {
  type: 'mention' | 'comment';
  title: string;
  body: string;
  quiet: boolean;
  native: boolean;
  metadata: Record<string, unknown>;
  dedupeKey: string;
  /** 목록에 적을 시각(원래 댓글·수정 시각). */
  createdAt: string | null;
}

export interface PresentServerRowsDeps {
  /** 그 사이 로그아웃·계정 전환이면 false — 남은 줄을 넘기지 않는다. */
  isCurrent(): boolean;
  decide(row: CommentNotificationRow): PresentedServerDecision | null;
  claim(dedupeKey: string): boolean;
  identityOf(type: string, metadata: Record<string, unknown>): string | null;
  isListed(identity: string): boolean;
  add(draft: { type: 'mention' | 'comment'; title: string; body?: string; createdAt: string; metadata: Record<string, unknown>; isRead?: boolean }): void;
  dispatch(payload: { type: 'mention' | 'comment'; title: string; body?: string; metadata: Record<string, unknown> }, options: { quiet: boolean; native: boolean }): void;
  /** 나를 부른 안 읽은 알림을 넘겼을 때(예전 길의 기준 시각도 옮긴다). */
  onMention?(createdAt: string): void;
}

export function presentServerCommentRows(rows: readonly CommentNotificationRow[], quiet: boolean, deps: PresentServerRowsDeps): number {
  let added = 0;
  for (const row of rows) {
    if (!deps.isCurrent()) break;
    const decision = deps.decide(row);
    if (!decision || !deps.claim(decision.dedupeKey)) continue;
    const metadata = { ...decision.metadata, serverNotificationId: row.id };
    const identity = deps.identityOf(decision.type, metadata);
    const listed = !!identity && deps.isListed(identity);
    const body = decision.body || undefined;
    if (quiet || row.readAt) {
      deps.add({
        type: decision.type,
        title: decision.title,
        body,
        createdAt: decision.createdAt ?? row.eventAt,
        metadata,
        // 다른 PC 에서 이미 읽었으면 읽은 채로(배지·토스트 없이).
        ...(row.readAt ? { isRead: true } : {}),
      });
      if (!listed && !row.readAt) added += 1;
    } else {
      deps.dispatch({ type: decision.type, title: decision.title, body, metadata }, { quiet: decision.quiet, native: decision.native });
      if (!listed) added += 1;
    }
    if (decision.type === 'mention' && !row.readAt && decision.createdAt) deps.onMention?.(decision.createdAt);
  }
  return added;
}

/**
 * 업데이트 뒤 첫 실행(받기함 커서가 아직 없을 때) — 예전 버전이 실시간으로 이미 보여 준(그리고 지웠을 수도 있는) 줄을
 * 다시 넘기지 않는다(리뷰 지적).
 *  - 자동 알림(auto): 예전 버전도 실시간으로 띄웠고 기준 시각을 옮기지 않았다 → 이번 실행 직전(autoWindowMs)의 것만.
 *  - 나를 부른 알림(멘션·답글·리테이크): 예전 놓친 멘션 모으기처럼 예전 기준 시각보다 뒤의 것만(없으면 mentionWindowMs 안쪽).
 * 거른 줄도 받기함은 본 줄·커서에 넣으므로 다음 읽기에서 다시 나오지 않는다.
 */
export function firstRunServerRowFilter(options: {
  lastSeenAt: string | null;
  startedAt: number;
  autoWindowMs: number;
  mentionWindowMs: number;
}): (row: CommentNotificationRow) => boolean {
  const lastSeen = options.lastSeenAt ? Date.parse(options.lastSeenAt) : NaN;
  const mentionFloor = Number.isFinite(lastSeen) ? lastSeen : options.startedAt - options.mentionWindowMs;
  const autoFloor = options.startedAt - options.autoWindowMs;
  return (row) => {
    const at = Date.parse(row.eventAt);
    if (!Number.isFinite(at)) return false;
    return row.reason === 'auto' ? at > autoFloor : at > mentionFloor;
  };
}
