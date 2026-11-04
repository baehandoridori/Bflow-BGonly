/** Shared by Electron and the renderer; links carry identity, never executable actions. */
export type BflowDeepLink = { sheetName: string; sceneId: string; commentId?: string } | { revisionId: string };

const COMMENT_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * 댓글 링크(씬 댓글 B안 §5.2 '댓글 링크 복사', v1.147.0) — 씬 링크 뒤에 ?comment=<댓글 id>.
 * 누르면 그 씬 상세를 열고 그 댓글로 이동해 강조한다(답글·리테이크 댓글이면 스레드 창까지).
 */
export function buildCommentDeepLink(sheetName: string, sceneNo: string, commentId: string): string {
  return `bflow://scene/${encodeURIComponent(sheetName)}/${encodeURIComponent(sceneNo)}?comment=${encodeURIComponent(commentId)}`;
}

export function buildRetakeDeepLink(revisionId: string): string {
  return `bflow://retake/${encodeURIComponent(revisionId)}`;
}

export function parseBflowDeepLink(url: string): BflowDeepLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'bflow:' || parsed.username || parsed.password || parsed.port) return null;
    const segments = parsed.pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent);
    if (parsed.hostname === 'retake' && segments.length === 1 && /^[a-zA-Z0-9_-]{1,128}$/.test(segments[0])) {
      return { revisionId: segments[0] };
    }
    if (parsed.hostname === 'scene' && segments.length === 2 && segments.every((s) => s.trim() && !/[\u0000-\u001f/\\]/.test(s))) {
      const commentId = parsed.searchParams.get('comment');
      // 모양이 어긋난 댓글 id 는 버리고 씬만 연다(링크 전체를 막지 않는다).
      return commentId && COMMENT_ID.test(commentId)
        ? { sheetName: segments[0], sceneId: segments[1], commentId }
        : { sheetName: segments[0], sceneId: segments[1] };
    }
    return null;
  } catch {
    return null;
  }
}
