/**
 * RevisionCommentThread — 리비전 카드 안에 마운트되는 댓글 스레드 (v1.18.0)
 *
 * 한솔 결정 (spec 2026-05-03):
 *   - 모든 댓글은 단일 `comments` 테이블 사용. revisionId NULL → 일반 씬 댓글, 값 있음 → 리비전 맥락 댓글.
 *   - 카드 안에서 작성된 댓글은 자동으로 `revisionId = 그 카드 id` 로 저장.
 *   - "bflow:expand-revision" 이벤트(detail.revisionId === 본인) 수신 시 자동 펼침.
 *   - "bflow:comments-invalidated" 수신 시 디바운스 재로드 (기존 CommentPanel 패턴 동일).
 *
 * 디자인: docs/mockups/revision-detail.html 의 카드 내 댓글 스레드 영역 참조.
 *   - 본인 댓글: bg-accent/[0.10] border-accent/30
 *   - 다른 사람: bg-bg-primary/60 border-bg-border/40
 *   - 입력 placeholder: "re# 댓글 남기기..." (italic 금지 — placeholder 자체는 브라우저 기본 처리)
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import {
  addComment,
  getComments,
  type SceneComment,
} from '@/services/commentService';
import { revisionNoToLabel } from '@/constants/revision';
import { formatTimeShort } from '@/utils/formatTime';

interface Props {
  revisionId: string;
  sceneKey: string;
}

// 사용자 ID 해시 → 일관된 아바타 색 (RevisionRecipientPicker 와 동일 팔레트)
const AVATAR_COLORS = [
  '#6C5CE7', '#74B9FF', '#FDCB6E', '#E17055',
  '#A29BFE', '#00B894', '#FF6B6B', '#F9A8D4',
];
function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────

export function RevisionCommentThread({ revisionId, sceneKey }: Props) {
  const { currentUser } = useAuthStore();
  const revision = useRevisionStore(s => s.revisions.find(r => r.id === revisionId));
  const revisionLabel = revision ? revisionNoToLabel(revision.revisionNo) : 're?';

  const [allComments, setAllComments] = useState<SceneComment[]>([]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 이 리비전 맥락 댓글만 필터 (시간순)
  const comments = allComments
    .filter(c => c.revisionId === revisionId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // 댓글 로드 — sceneKey 의 모든 댓글을 가져와서 revisionId 로 필터링
  const loadComments = useCallback(() => {
    getComments(sceneKey)
      .then(list => setAllComments(list))
      .catch(err => console.error('[리비전 댓글 스레드] 로드 실패:', err));
  }, [sceneKey]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // 다른 PC/창 변경 시 자동 리로드 (300ms 디바운스, CommentPanel 와 동일 패턴)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadComments(); }, 300);
    };
    window.addEventListener('bflow:comments-invalidated', handler);
    return () => {
      window.removeEventListener('bflow:comments-invalidated', handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadComments]);

  // 외부 트리거(알림 클릭 → 모달 → 펼침 요청) 수신
  useEffect(() => {
    function onExpand(e: Event) {
      const detail = (e as CustomEvent<{ revisionId?: string }>).detail;
      if (detail?.revisionId === revisionId) setExpanded(true);
    }
    window.addEventListener('bflow:expand-revision', onExpand);
    return () => window.removeEventListener('bflow:expand-revision', onExpand);
  }, [revisionId]);

  async function send() {
    if (!draft.trim() || !currentUser || submitting) return;
    setSubmitting(true);

    const newComment: SceneComment = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      text: draft.trim(),
      mentions: [],
      images: [],
      createdAt: new Date().toISOString(),
      // v1.18.0 핵심: 이 댓글은 해당 리비전 맥락에 속함.
      // commentService.addComment → supabase:add-comment IPC → addComment(... revisionId)
      // 까지 정식 전달되어 comments.revision_id 컬럼에 저장된다 (청크 4 Task 14 정식화).
      revisionId,
    };

    // 낙관적 UI
    setAllComments(prev => [...prev, newComment]);
    const prevDraft = draft;
    setDraft('');

    try {
      await addComment(sceneKey, newComment);
    } catch (err) {
      console.error('[리비전 댓글 스레드] 전송 실패:', err);
      // 롤백
      setAllComments(prev => prev.filter(c => c.id !== newComment.id));
      setDraft(prevDraft);
    } finally {
      setSubmitting(false);
    }
  }

  // 접힌 상태 — 댓글 개수 표시 + 펼치기 버튼
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 text-[11px] text-accent-sub hover:underline cursor-pointer"
      >
        댓글 {comments.length}개 보기 ▾
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-bg-border/40 pt-3 space-y-2.5">
      {comments.map(c => (
        <CommentBubble
          key={c.id}
          comment={c}
          isMe={c.userId === currentUser?.id}
        />
      ))}

      {/* 입력란 */}
      {currentUser && (
        <div className="flex gap-2 pt-1">
          <span
            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ background: avatarColor(currentUser.id) }}
            aria-hidden
          >
            {currentUser.name.charAt(0)}
          </span>
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`${revisionLabel} 댓글 남기기...`}
              className="flex-1 px-3 py-1.5 bg-bg-primary/80 border border-bg-border/60 rounded text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || submitting}
              className="px-3 py-1.5 text-[11px] font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity inline-flex items-center gap-1"
              title="댓글 전송 (Enter)"
            >
              <ArrowUp size={11} strokeWidth={3} />
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 댓글 버블 ──────────────────────────────────────────────────────────

function CommentBubble({ comment, isMe }: { comment: SceneComment; isMe: boolean }) {
  return (
    <div
      className={`border rounded-lg px-3 py-2 ${
        isMe
          ? 'bg-accent/[0.10] border-accent/30'
          : 'bg-bg-primary/60 border-bg-border/40'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: avatarColor(comment.userId) }}
            aria-hidden
          >
            {comment.userName.charAt(0)}
          </span>
          <span className={`text-[11px] font-bold ${isMe ? 'text-accent-sub' : 'text-text-primary'}`}>
            {comment.userName}
          </span>
        </div>
        <span className="text-[10px] text-text-secondary/50">
          {formatTimeShort(comment.createdAt)}
        </span>
      </div>
      <div className="text-[12px] text-text-primary whitespace-pre-wrap leading-relaxed">
        {comment.text}
      </div>
    </div>
  );
}
