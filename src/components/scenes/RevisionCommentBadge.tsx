/**
 * RevisionCommentBadge — 씬 댓글 패널에서 리테이크 맥락 댓글에 붙는 [re#] 칩.
 *
 * 한솔 결정 (spec 2026-05-03):
 *   - 댓글 패널의 일반 댓글 흐름 안에서 "이 댓글은 re# 리테이크 맥락" 임을 즉시 알 수 있도록
 *     작성자 옆에 작은 칩으로 노출.
 *   - 클릭 시 'bflow:jump-to-revision' 이벤트 dispatch → 모달이 'revisions' 탭으로 전환 후
 *     해당 카드 scrollIntoView + pulse 애니메이션 (UnifiedSceneDetailModal 의 listener 처리).
 *
 * 디자인: docs/mockups/revision-comment-integration.html 의 [re#] 칩 시안 참조.
 *   - bg-accent/15 + border-accent/30 (accent 톤 미니 칩)
 *   - hover:bg-accent/25
 *   - italic 금지 (CLAUDE.md feedback_memo_italic 규칙 준수)
 */

import { useRevisionStore } from '@/stores/useRevisionStore';
import { revisionNoToLabel } from '@/constants/revision';

interface Props {
  revisionId: string;
  /** 클릭 시 호출 — 보통 'bflow:jump-to-revision' 이벤트 dispatch. */
  onJump?: (revisionId: string) => void;
}

export function RevisionCommentBadge({ revisionId, onJump }: Props) {
  // useRevisionStore.state 구조: revisions: CompRevision[] (배열). id 로 직접 find.
  const rev = useRevisionStore((s) => s.revisions.find((r) => r.id === revisionId));
  if (!rev) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump?.(revisionId);
      }}
      title={`${revisionNoToLabel(rev.revisionNo)} 리테이크으로 이동`}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border bg-accent/15 text-accent-sub border-accent/30 hover:bg-accent/25 cursor-pointer transition-colors"
    >
      {revisionNoToLabel(rev.revisionNo)}
    </button>
  );
}
