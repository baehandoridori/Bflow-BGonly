export interface CommentThreadNode {
  id: string;
  parentCommentId?: string | null;
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
