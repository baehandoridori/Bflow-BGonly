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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import {
  addComment,
  extractMentions,
  getComments,
  type SceneComment,
} from '@/services/commentService';
import { revisionNoToLabel } from '@/constants/revision';
import { formatCommentTime } from '@/utils/formatTime';
import * as storageService from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { sendMentionWebhook } from '@/services/slackWebhookService';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import {
  AttachmentImageLightbox,
  type AttachmentImageLightboxEntry,
  type AttachmentImageLightboxState,
} from './AttachmentImageLightbox';

interface Props {
  revisionId: string;
  /**
   * commentService 형식 sceneKey (`sheetName:sceneNo`, 예: "EP01_A_BG:3").
   *
   * ⚠️ 리비전 시스템 sceneKey(`episode:part:sceneId`, 예: "EP01:A:1")와 형식이 다름.
   * 호출 측에서 반드시 commentService 형식으로 변환해서 넘겨야 한다.
   * 잘못된 형식이 전달되면 commentService.parseSceneKey 가 lastIndexOf(':')로 split해
   * partUuid lookup 실패 → "씬을 찾을 수 없음 (partUuid=, sceneId=...)" 에러 발생
   * (이슈: 2026-05-04, RevisionPanel 의 buildSceneKey 결과를 그대로 전달하던 v1.18.0 버그).
   */
  sceneKey: string;
}

interface AttachedImage {
  id: string;
  previewUrl: string;
  uploadedUrl?: string;
  uploading: boolean;
  error?: string;
}

function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
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
  const { currentUser, users } = useAuthStore();
  const { setView, setHighlightUserName } = useAppStore();
  const revision = useRevisionStore(s => s.revisions.find(r => r.id === revisionId));
  const revisionLabel = revision ? revisionNoToLabel(revision.revisionNo) : 're?';
  const { sheetName, sceneId } = useMemo(() => parseSceneKey(sceneKey), [sceneKey]);

  const [allComments, setAllComments] = useState<SceneComment[]>([]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [lightbox, setLightbox] = useState<AttachmentImageLightboxState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  const draftRef = useRef('');
  const mountedRef = useRef(true);

  useEffect(() => { attachedImagesRef.current = attachedImages; }, [attachedImages]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    if (!showMentions) return;
    const container = mentionDropdownRef.current;
    if (!container) return;
    const items = container.querySelectorAll('button');
    items[mentionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, showMentions]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachedImagesRef.current.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
        if (item.uploadedUrl) {
          storageService.deleteImage(item.uploadedUrl).catch(err => {
            console.warn('[리비전 댓글 첨부 unmount] draft Storage 정리 실패:', err);
          });
        }
      });
    };
  }, []);

  // 이 리비전 맥락 댓글만 필터 (시간순)
  const comments = allComments
    .filter(c => c.revisionId === revisionId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const openLightbox = useCallback((clickedUrl: string, clickedComment: SceneComment) => {
    const entries: AttachmentImageLightboxEntry[] = [];
    for (const c of comments) {
      if (!c.images || c.images.length === 0) continue;
      for (const url of c.images) {
        entries.push({
          url,
          userName: c.userName,
          commentText: c.text,
          createdAt: c.createdAt,
          commentId: c.id,
        });
      }
    }
    if (entries.length === 0) return;
    let clickIdx = entries.findIndex(
      (entry) => entry.commentId === clickedComment.id && entry.url === clickedUrl,
    );
    if (clickIdx < 0) clickIdx = entries.findIndex((entry) => entry.url === clickedUrl);
    setLightbox({ entries, index: clickIdx < 0 ? 0 : clickIdx });
  }, [comments]);

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const lightboxStep = useCallback((dir: 1 | -1) => {
    setLightbox((prev) => {
      if (!prev) return prev;
      const len = prev.entries.length;
      if (len <= 1) return prev;
      return { ...prev, index: (prev.index + dir + len) % len };
    });
  }, []);

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

  const uploadAttachedImage = useCallback(async (id: string, file: File | Blob) => {
    try {
      const base64 = await resizeBlob(file, 800, 0.8);
      const result = await storageService.uploadImage(sheetName, sceneId, 'comment', base64);
      if (!result.ok || !result.url) throw new Error(result.error || '업로드 실패');

      const url = result.url;
      if (!mountedRef.current) {
        storageService.deleteImage(url).catch(err => {
          console.warn('[리비전 댓글 첨부 unmount race] 정리 실패:', err);
        });
        return;
      }

      setAttachedImages(prev => {
        const exists = prev.some(item => item.id === id);
        if (!exists) {
          storageService.deleteImage(url).catch(err => {
            console.warn('[리비전 댓글 첨부 race] 제거 후 도착한 업로드 객체 정리 실패:', err);
          });
          return prev;
        }
        return prev.map(item =>
          item.id === id ? { ...item, uploadedUrl: url, uploading: false } : item
        );
      });
    } catch (err) {
      console.error('[리비전 댓글 이미지 업로드 실패]', err);
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setAttachedImages(prev => prev.map(item =>
        item.id === id ? { ...item, uploading: false, error: message } : item
      ));
    }
  }, [sceneId, sheetName]);

  const addAttachedImageFromBlob = useCallback((file: File | Blob) => {
    const id = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    setAttachedImages(prev => [...prev, { id, previewUrl, uploading: true }]);
    void uploadAttachedImage(id, file);
  }, [uploadAttachedImage]);

  const removeAttachedImage = useCallback((id: string) => {
    setAttachedImages(prev => {
      const target = prev.find(item => item.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      if (target?.uploadedUrl) {
        storageService.deleteImage(target.uploadedUrl).catch(err => {
          console.warn('[리비전 댓글 첨부 제거] Storage 삭제 실패:', err);
        });
      }
      return prev.filter(item => item.id !== id);
    });
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLElement>) => {
    const imageItems = Array.from(e.clipboardData?.items || [])
      .filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) addAttachedImageFromBlob(file);
    });
  }, [addAttachedImageFromBlob]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => file.type.startsWith('image/'));
    files.forEach(addAttachedImageFromBlob);
    e.target.value = '';
  }, [addAttachedImageFromBlob]);

  const handleDraftChange = useCallback((text: string) => {
    setDraft(text);
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
  }, []);

  const filteredUsers = useMemo(
    () => users.filter(user => user.name.toLowerCase().includes(mentionFilter)),
    [mentionFilter, users],
  );

  const insertMention = useCallback((userName: string) => {
    const lastAt = draft.lastIndexOf('@');
    const before = lastAt >= 0 ? draft.slice(0, lastAt) : `${draft} `;
    const nextDraft = `${before}@${userName} `;
    setDraft(nextDraft);
    draftRef.current = nextDraft;
    setShowMentions(false);
    inputRef.current?.focus();
  }, [draft]);

  const hasUploadingImage = attachedImages.some(item => item.uploading);
  const uploadedImageUrls = attachedImages.map(item => item.uploadedUrl).filter((url): url is string => !!url);
  const canSend = Boolean(currentUser)
    && !submitting
    && !hasUploadingImage
    && (draft.trim().length > 0 || uploadedImageUrls.length > 0);

  async function send() {
    if (!canSend || !currentUser) return;
    setSubmitting(true);

    const newComment: SceneComment = {
      id: crypto.randomUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      text: draft.trim(),
      mentions: extractMentions(draft, users.map(user => user.name)),
      images: uploadedImageUrls,
      createdAt: new Date().toISOString(),
      // v1.18.0 핵심: 이 댓글은 해당 리비전 맥락에 속함.
      // commentService.addComment → supabase:add-comment IPC → addComment(... revisionId)
      // 까지 정식 전달되어 comments.revision_id 컬럼에 저장된다 (청크 4 Task 14 정식화).
      revisionId,
    };

    // 낙관적 UI
    setAllComments(prev => [...prev, newComment]);
    const prevDraft = draft;
    const prevAttached = attachedImages;
    setDraft('');
    draftRef.current = '';
    setShowMentions(false);
    setAttachedImages([]);
    attachedImagesRef.current = [];

    try {
      await addComment(sceneKey, newComment);
      prevAttached.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
      });

      if (newComment.mentions.length > 0 && currentUser.slackId) {
        const parts = sheetName.match(/^EP(\d+)_([A-Z])_/);
        const epLabel = parts ? `EP.${parts[1].padStart(2, '0')}` : sheetName;
        const partLabel = parts ? `${parts[2]}파트` : '';
        for (const mentionedName of newComment.mentions) {
          const target = users.find(user => user.name === mentionedName);
          if (target?.slackId && target.slackId !== currentUser.slackId) {
            sendMentionWebhook({
              commentText: newComment.text,
              episodeLabel: epLabel,
              sceneId,
              partLabel,
              sheetName,
              authorSlackId: currentUser.slackId,
              targetSlackId: target.slackId,
            });
          }
        }
      }
    } catch (err) {
      console.error('[리비전 댓글 스레드] 전송 실패:', err);

      if (!mountedRef.current) {
        prevAttached.forEach((item) => {
          try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
          if (item.uploadedUrl) {
            storageService.deleteImage(item.uploadedUrl).catch(err2 => {
              console.warn('[리비전 댓글 전송 실패 + unmount] storage 정리 실패:', err2);
            });
          }
        });
        return;
      }

      // 롤백
      setAllComments(prev => prev.filter(c => c.id !== newComment.id));
      const userStartedNewDraft = draftRef.current.length > 0 || attachedImagesRef.current.length > 0;
      if (userStartedNewDraft) {
        prevAttached.forEach((item) => {
          try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
          if (item.uploadedUrl) {
            storageService.deleteImage(item.uploadedUrl).catch(err2 => {
              console.warn('[리비전 댓글 전송 실패 롤백] 버려진 업로드 객체 정리 실패:', err2);
            });
          }
        });
      } else {
        setDraft(prevDraft);
        draftRef.current = prevDraft;
        setAttachedImages(prevAttached);
        attachedImagesRef.current = prevAttached;
      }
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
          users={users}
          onImageClick={openLightbox}
          onMentionClick={(userName) => {
            setHighlightUserName(userName);
            setView('team');
          }}
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
          <div className="flex-1 min-w-0 space-y-2" onPaste={handlePaste}>
            {attachedImages.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {attachedImages.map((image) => (
                  <div key={image.id} className="relative flex-shrink-0">
                    <img
                      src={image.previewUrl}
                      alt=""
                      className="w-14 h-14 rounded-md object-cover border border-bg-border/60"
                    />
                    {image.uploading && (
                      <div className="absolute inset-0 rounded-md bg-black/45 flex items-center justify-center">
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      </div>
                    )}
                    {image.error && (
                      <div
                        className="absolute inset-0 rounded-md bg-red-500/45 flex items-center justify-center"
                        title={`업로드 실패: ${image.error}`}
                      >
                        <X size={16} className="text-white" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachedImage(image.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                      style={{ border: '2px solid rgb(var(--color-bg-card))' }}
                      title="첨부 제거"
                    >
                      <X size={11} strokeWidth={3} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative flex gap-2">
              {showMentions && filteredUsers.length > 0 && (
                <div
                  ref={mentionDropdownRef}
                  className="absolute bottom-full left-10 right-24 mb-1 max-h-32 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-20"
                >
                  {filteredUsers.map((user, index) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => insertMention(user.name)}
                      className={`w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
                        index === mentionIndex ? 'bg-accent/15' : 'hover:bg-accent/10'
                      }`}
                    >
                      <span className="text-accent text-[11px]">@</span>
                      <span>{user.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-8 h-8 rounded-md border border-bg-border/60 bg-bg-primary/70 text-text-secondary hover:text-text-primary hover:border-accent/50 hover:bg-bg-primary transition-colors inline-flex items-center justify-center cursor-pointer"
                title="이미지 첨부"
              >
                <Paperclip size={13} />
              </button>
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={e => handleDraftChange(e.target.value)}
                onKeyDown={e => {
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
                    send();
                  }
                }}
                placeholder={`${revisionLabel} 댓글 남기기... (Ctrl+V)`}
                className="flex-1 min-w-0 px-3 py-1.5 bg-bg-primary/80 border border-bg-border/60 rounded text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
              />
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="px-3 py-1.5 text-[11px] font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity inline-flex items-center gap-1"
                title={hasUploadingImage ? '이미지 업로드 중...' : '댓글 전송 (Enter)'}
              >
                <ArrowUp size={11} strokeWidth={3} />
                전송
              </button>
            </div>
          </div>
        </div>
      )}
      {lightbox && (
        <AttachmentImageLightbox
          lightbox={lightbox}
          setLightbox={setLightbox}
          closeLightbox={closeLightbox}
          lightboxStep={lightboxStep}
          sceneLabel={`${revisionLabel} 댓글`}
          ariaLabel="리비전 댓글 이미지 확대 보기"
          fileNamePrefix={`${revisionLabel}-comment`}
        />
      )}
    </div>
  );
}

// ─── 댓글 버블 ──────────────────────────────────────────────────────────

function CommentBubble({
  comment,
  isMe,
  users,
  onImageClick,
  onMentionClick,
}: {
  comment: SceneComment;
  isMe: boolean;
  users: { name: string }[];
  onImageClick: (url: string, comment: SceneComment) => void;
  onMentionClick: (userName: string) => void;
}) {
  const renderMentionInSegment = (segment: string, baseIdx: number) => {
    const parts = segment.split(/(@\S+)/g);
    return parts.map((part, index) => {
      const key = `${baseIdx}-${index}`;
      if (part.startsWith('@')) {
        const name = part.slice(1);
        if (users.some(user => user.name === name)) {
          return (
            <span
              key={key}
              className="text-accent font-bold bg-accent/10 rounded px-0.5 cursor-pointer hover:bg-accent/20 transition-colors"
              onClick={() => onMentionClick(name)}
              title={`${name} 팀원 보기`}
            >
              {part}
            </span>
          );
        }
      }
      return <span key={key}>{part}</span>;
    });
  };

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
          {formatCommentTime(comment.createdAt)}
        </span>
      </div>
      {comment.text && (
        <div className="text-[12px] text-text-primary whitespace-pre-wrap leading-relaxed">
          <PathLinkifiedText text={comment.text} renderTextSegment={renderMentionInSegment} />
        </div>
      )}
      {(comment.images?.length ?? 0) > 0 && (
        <div className={`mt-2 grid gap-1.5 ${comment.images!.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {comment.images!.map((url, index) => (
            <button
              type="button"
              key={`${url}-${index}`}
              onClick={() => onImageClick(url, comment)}
              className="block rounded-md overflow-hidden border border-bg-border/60 bg-bg-secondary/40 cursor-zoom-in hover:opacity-90 transition-opacity"
              title="이미지 확대"
            >
              <img
                src={url}
                alt=""
                className="w-full max-h-32 object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
