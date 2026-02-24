import { useState, useEffect, useRef } from 'react';
import { Send, Pencil, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getComments,
  addComment,
  updateComment,
  deleteComment,
  extractMentions,
} from '@/services/commentService';
import type { SceneComment } from '@/services/commentService';

// ─── 시간 포맷 ───────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (hr < 24) return `${hr}시간 전`;
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

// ─── 메인 컴포넌트 ───────────────────────────

interface CommentPanelProps {
  sceneKey: string;
  onCountChange?: (count: number) => void;
}

export function CommentPanel({ sceneKey, onCountChange }: CommentPanelProps) {
  const { currentUser, users } = useAuthStore();
  const [comments, setComments] = useState<SceneComment[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 댓글 로드
  useEffect(() => {
    getComments(sceneKey).then((data) => {
      setComments(data);
      onCountChange?.(data.length);
    });
  }, [sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 새 댓글 시 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [comments.length]);

  // 댓글 작성 (낙관적 업데이트 + 중복 방지)
  const handleSubmit = async () => {
    if (!input.trim() || !currentUser || submitting) return;
    setSubmitting(true);

    const mentions = extractMentions(input, users.map(u => u.name));
    const comment: SceneComment = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      text: input.trim(),
      mentions,
      createdAt: new Date().toISOString(),
    };

    // 낙관적: 즉시 UI 반영
    const next = [...comments, comment];
    setComments(next);
    onCountChange?.(next.length);
    setInput('');
    setShowMentions(false);

    try {
      await addComment(sceneKey, comment);
    } catch (err) {
      // 롤백
      console.error('[댓글 추가 실패]', err);
      setComments(comments);
      onCountChange?.(comments.length);
    } finally {
      setSubmitting(false);
    }
  };

  // 댓글 수정 (낙관적)
  const handleEdit = async (commentId: string) => {
    if (!editText.trim()) return;
    const mentions = extractMentions(editText, users.map(u => u.name));
    const prevComments = [...comments];

    // 낙관적 UI 업데이트
    setComments(prev =>
      prev.map(c =>
        c.id === commentId
          ? { ...c, text: editText.trim(), mentions, editedAt: new Date().toISOString() }
          : c
      )
    );
    setEditingId(null);

    try {
      await updateComment(sceneKey, commentId, editText.trim(), mentions);
    } catch (err) {
      console.error('[댓글 수정 실패]', err);
      setComments(prevComments);
    }
  };

  // 댓글 삭제 (낙관적)
  const handleDelete = async (commentId: string) => {
    const prevComments = [...comments];
    const next = comments.filter(c => c.id !== commentId);

    // 낙관적 UI 업데이트
    setComments(next);
    onCountChange?.(next.length);

    try {
      await deleteComment(sceneKey, commentId);
    } catch (err) {
      console.error('[댓글 삭제 실패]', err);
      setComments(prevComments);
      onCountChange?.(prevComments.length);
    }
  };

  // @멘션 감지
  const handleInputChange = (text: string) => {
    setInput(text);
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = text.slice(lastAt + 1);
      if (!afterAt.includes(' ') && afterAt.length < 20) {
        setShowMentions(true);
        setMentionFilter(afterAt.toLowerCase());
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  // @멘션 삽입
  const insertMention = (userName: string) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(`${before}@${userName} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(mentionFilter)
  );

  // 텍스트 내 @멘션 렌더 (굵은 글씨 + 배경 하이라이트)
  const renderText = (text: string) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        const name = part.slice(1);
        const isUser = users.some(u => u.name === name);
        if (isUser) {
          return (
            <span key={i} className="text-accent font-bold bg-accent/10 rounded px-0.5">
              {part}
            </span>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 댓글 목록 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {comments.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-secondary text-xs">아직 의견이 없습니다</p>
            <p className="text-text-secondary/40 text-[10px] mt-1">첫 의견을 남겨보세요</p>
          </div>
        ) : (
          comments.map((comment) => {
            const isOwn = currentUser?.id === comment.userId;
            const isEditing = editingId === comment.id;
            return (
              <div key={comment.id} className="group">
                <div className="flex items-start gap-2">
                  {/* 아바타 */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      backgroundColor: isOwn
                        ? 'rgb(var(--color-accent) / 0.2)'
                        : 'rgb(var(--color-bg-border))',
                    }}
                  >
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: isOwn ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))' }}
                    >
                      {comment.userName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary">
                        {comment.userName}
                      </span>
                      <span className="text-[10px] text-text-secondary/50">
                        {formatTime(comment.createdAt)}
                      </span>
                      {comment.editedAt && (
                        <span className="text-[10px] text-text-secondary/30 italic">수정됨</span>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="mt-1">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full bg-bg-primary border border-bg-border rounded-lg px-2 py-1.5 text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                          rows={2}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleEdit(comment.id);
                            }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div className="flex gap-2 mt-1 justify-end">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 text-[10px] text-text-secondary border border-bg-border rounded-md hover:bg-bg-border/50 transition-colors cursor-pointer"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => handleEdit(comment.id)}
                            className="px-2.5 py-1 text-[10px] text-white bg-accent rounded-md hover:bg-accent/80 transition-colors cursor-pointer"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-text-secondary mt-0.5 break-words leading-relaxed">
                        {renderText(comment.text)}
                      </p>
                    )}
                  </div>
                  {/* 수정/삭제 (자기 댓글만) */}
                  {isOwn && !isEditing && (
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => { setEditingId(comment.id); setEditText(comment.text); }}
                        className="p-1 rounded hover:bg-bg-border/50 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                        title="수정"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(comment.id)}
                        className="p-1 rounded hover:bg-status-none/20 text-text-secondary hover:text-status-none transition-colors cursor-pointer"
                        title="삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 입력 영역 */}
      <div className="px-4 py-3 border-t border-bg-border relative">
        {/* @멘션 자동완성 */}
        {showMentions && filteredUsers.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-bg-card border border-bg-border rounded-lg shadow-lg max-h-32 overflow-y-auto z-10">
            {filteredUsers.map((user, i) => (
              <button
                key={user.id}
                onClick={() => insertMention(user.name)}
                className={`w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
                  i === mentionIndex ? 'bg-accent/15' : 'hover:bg-accent/10'
                }`}
              >
                <span className="text-accent text-[10px]">@</span>
                <span>{user.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="의견을 입력하세요... (@로 태그)"
            className="flex-1 bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/40 resize-none focus:outline-none focus:border-accent"
            rows={2}
            onKeyDown={(e) => {
              // @멘션 드롭다운 키보드 탐색
              if (showMentions && filteredUsers.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev + 1) % filteredUsers.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((prev) => (prev - 1 + filteredUsers.length) % filteredUsers.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  insertMention(filteredUsers[mentionIndex].name);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowMentions(false);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || submitting}
            className="p-2.5 rounded-lg bg-accent hover:bg-accent/80 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
          >
            {submitting ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
