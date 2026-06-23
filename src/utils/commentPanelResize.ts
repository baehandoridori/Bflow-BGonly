export type CommentPanelResizeEdge = 'inner' | 'outer';

export const COMMENT_PANEL_MIN_WIDTH = 280;
export const COMMENT_PANEL_MAX_WIDTH = 720;
export const COMMENT_THREAD_PANEL_DEFAULT_WIDTH = 340;
export const COMMENT_THREAD_PANEL_MIN_WIDTH = 260;
export const COMMENT_THREAD_PANEL_MAX_WIDTH = 560;
export const COMMENT_THREAD_PANEL_GAP_WIDTH = 20;

export function clampCommentPanelWidth(px: number): number {
  return Math.max(COMMENT_PANEL_MIN_WIDTH, Math.min(COMMENT_PANEL_MAX_WIDTH, px));
}

export function getCommentThreadPanelMaxWidthForMainWidth(mainWidth: number): number {
  const maxWithinFrame = Math.round(mainWidth + COMMENT_THREAD_PANEL_DEFAULT_WIDTH - COMMENT_PANEL_MIN_WIDTH);
  return Math.max(
    COMMENT_THREAD_PANEL_MIN_WIDTH,
    Math.min(COMMENT_THREAD_PANEL_MAX_WIDTH, maxWithinFrame),
  );
}

export function clampCommentThreadPanelWidth(px: number, maxWidth = COMMENT_THREAD_PANEL_MAX_WIDTH): number {
  const effectiveMaxWidth = Math.max(COMMENT_THREAD_PANEL_MIN_WIDTH, Math.min(COMMENT_THREAD_PANEL_MAX_WIDTH, maxWidth));
  return Math.max(COMMENT_THREAD_PANEL_MIN_WIDTH, Math.min(effectiveMaxWidth, Math.round(px)));
}

/**
 * 댓글 패널 자동 너비 계산.
 * - clamp(320, viewport*0.26, 480) 을 base 로 함
 * - 댓글 갯수 boost: 6~15건 -> +40, 16건+ -> +80
 * - 자동 모드 상한은 600px.
 */
export function computeAutoCommentPanelWidth(viewportW: number, commentCount: number): number {
  const base = Math.max(320, Math.min(480, viewportW * 0.26));
  const boost = commentCount > 15 ? 80 : commentCount > 5 ? 40 : 0;
  return Math.min(600, base + boost);
}

export function computeCommentPanelResizeWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  edge: CommentPanelResizeEdge,
): number {
  const deltaX = currentX - startX;
  const nextWidth = edge === 'outer'
    ? startWidth + deltaX
    : startWidth - deltaX;

  return clampCommentPanelWidth(nextWidth);
}

export function computeCommentThreadPanelResizeWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  maxWidth = COMMENT_THREAD_PANEL_MAX_WIDTH,
): number {
  const deltaX = currentX - startX;
  return clampCommentThreadPanelWidth(startWidth - deltaX, maxWidth);
}
