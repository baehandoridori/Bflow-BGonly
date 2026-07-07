export interface CommentThreadNode {
  id: string;
  parentCommentId?: string | null;
}

export interface ThreadedMainFlowCommentNode {
  id: string;
  createdAt?: string;
  revisionId?: string | null;
}

export interface ThreadedCommentMainFlowKey {
  timeMs: number;
  order: number;
}

export interface CommentReplyTarget<T extends CommentThreadNode> {
  parentCommentId: string | null;
  rootComment: T | null;
  replyToComment: T | null;
  isReplyToReply: boolean;
}

/**
 * Slack-style thread rule:
 * - a top-level comment starts the thread
 * - replying to any reply is still stored under the top-level comment
 *
 * This keeps the existing parentCommentId schema while avoiding invisible
 * nested replies that the current UI does not render as a separate tree.
 */
export function buildCommentReplyTarget<T extends CommentThreadNode>(
  comments: readonly T[],
  replyTo: T | null | undefined,
): CommentReplyTarget<T> {
  if (!replyTo) {
    return {
      parentCommentId: null,
      rootComment: null,
      replyToComment: null,
      isReplyToReply: false,
    };
  }

  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  let root = replyTo;
  let current = replyTo;
  const visited = new Set<string>([replyTo.id]);

  while (current.parentCommentId) {
    const parent = commentsById.get(current.parentCommentId);
    if (!parent || visited.has(parent.id)) {
      root = replyTo;
      break;
    }
    root = parent;
    current = parent;
    visited.add(parent.id);
  }

  return {
    parentCommentId: root.id,
    rootComment: root,
    replyToComment: replyTo,
    isReplyToReply: root.id !== replyTo.id,
  };
}

function normalizeRevisionThreadId(revisionId: string | null | undefined): string | null {
  if (typeof revisionId !== 'string') return null;
  const trimmed = revisionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createdAtMs(createdAt: string | null | undefined): number {
  const parsed = Date.parse(createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Keep comments from the same retake thread adjacent in the main comment panel.
 *
 * The first comment in each retake thread keeps its chronological position.
 * Later comments from that same revision are pulled directly after it, matching
 * the side-thread mental model without changing the persisted parentCommentId.
 */
export function orderCommentsForThreadedMainFlow<T extends ThreadedMainFlowCommentNode>(
  comments: readonly T[],
): T[] {
  const sorted = comments
    .map((comment, index) => ({ comment, index, timeMs: createdAtMs(comment.createdAt) }))
    .sort((a, b) => (a.timeMs - b.timeMs) || (a.index - b.index));

  const revisionBuckets = new Map<string, typeof sorted>();
  for (const item of sorted) {
    const revisionId = normalizeRevisionThreadId(item.comment.revisionId);
    if (!revisionId) continue;
    const bucket = revisionBuckets.get(revisionId) ?? [];
    bucket.push(item);
    revisionBuckets.set(revisionId, bucket);
  }

  const emittedRevisions = new Set<string>();
  const ordered: T[] = [];
  for (const item of sorted) {
    const revisionId = normalizeRevisionThreadId(item.comment.revisionId);
    if (!revisionId) {
      ordered.push(item.comment);
      continue;
    }
    if (emittedRevisions.has(revisionId)) continue;
    const bucket = revisionBuckets.get(revisionId) ?? [item];
    ordered.push(...bucket.map((entry) => entry.comment));
    emittedRevisions.add(revisionId);
  }

  return ordered;
}

export function buildThreadedCommentMainFlowKeys<T extends ThreadedMainFlowCommentNode>(
  comments: readonly T[],
): Map<string, ThreadedCommentMainFlowKey> {
  const revisionAnchorMs = new Map<string, number>();
  const keys = new Map<string, ThreadedCommentMainFlowKey>();

  comments.forEach((comment, order) => {
    const revisionId = normalizeRevisionThreadId(comment.revisionId);
    let timeMs = createdAtMs(comment.createdAt);
    if (revisionId) {
      if (!revisionAnchorMs.has(revisionId)) revisionAnchorMs.set(revisionId, timeMs);
      timeMs = revisionAnchorMs.get(revisionId) ?? timeMs;
    }
    keys.set(comment.id, { timeMs, order });
  });

  return keys;
}
