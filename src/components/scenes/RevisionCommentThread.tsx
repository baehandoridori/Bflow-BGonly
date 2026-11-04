/**
 * RevisionCommentThread — 리테이크 카드 안에 마운트되는 댓글 스레드 (v1.18.0)
 *
 * 한솔 결정 (spec 2026-05-03):
 *   - 모든 댓글은 단일 `comments` 테이블 사용. revisionId NULL → 일반 씬 댓글, 값 있음 → 리테이크 맥락 댓글.
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
import { describeMentionDelivery, startMentionDelivery, type MentionDeliveryEntry } from '@/services/slackWebhookService';
import { useDataStore } from '@/stores/useDataStore';
import { stripEntityTokens } from '@/utils/entityTokens';
import { EntityText } from '@/components/common/EntityText';
import { EntityHighlightOverlay } from '@/components/common/EntityHighlightOverlay';
import { MentionDropdown } from '@/components/common/MentionDropdown';
import { HashtagDropdown } from '@/components/common/HashtagDropdown';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useHashtagAutocomplete } from '@/hooks/useHashtagAutocomplete';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { isCommentsInvalidationRelevant, type CommentsInvalidatedDetail } from '@/utils/commentRowCache';
import type { HashTarget } from '@/utils/hashEntity';
import { createUuid } from '@/utils/createUuid';
import { useImageAttachments, type AttachedImage } from '@/hooks/useImageAttachments';
import {
  AttachmentImageLightbox,
  type AttachmentImageLightboxEntry,
  type AttachmentImageLightboxState,
} from './AttachmentImageLightbox';
import { avatarColor } from '@/utils/userAvatar';
import { summarizeThread } from '@/utils/commentFeedModel';
import { CommentAvatar, CommentThreadSummaryButton } from './comments/CommentFeedParts';
import '@/styles/comment-feed.css';

interface Props {
  revisionId: string;
  /**
   * commentService 형식 sceneKey (`sheetName:sceneNo`, 예: "EP01_A_BG:3").
   *
   * ⚠️ 리테이크 시스템 sceneKey(`episode:part:sceneId`, 예: "EP01:A:1")와 형식이 다름.
   * 호출 측에서 반드시 commentService 형식으로 변환해서 넘겨야 한다.
   * 잘못된 형식이 전달되면 commentService.parseSceneKey 가 lastIndexOf(':')로 split해
   * partUuid lookup 실패 → "씬을 찾을 수 없음 (partUuid=, sceneId=...)" 에러 발생
   * (이슈: 2026-05-04, RevisionPanel 의 buildSceneKey 결과를 그대로 전달하던 v1.18.0 버그).
   */
  sceneKey: string;
  /** 4c PR2: #씬 칩 클릭 처리 분기(도킹 참조). 없으면 기존 점프. */
  onHashClick?: (t: HashTarget) => void;
  /**
   * v1.147.0(씬 댓글 B안 §5.4·§12-4 기본값): 옆에 댓글 패널이 있는 화면(씬 상세의 리테이크 탭) — 카드 안에는
   * '댓글 N개 · 마지막 시각' 요약과 '스레드 열기'만 두고, 누르면 댓글 패널의 스레드 창을 연다(같은 행·같은 입력창).
   * 패널이 받지 못하면(접혀 있음 등) 예전처럼 카드 안에 목록·입력창을 펼친다.
   */
  openInCommentPanel?: boolean;
  /** 4c PR3: #씬·#파트·#화 칩 우클릭 메뉴. 없으면 기본 우클릭. */
  onHashContextMenu?: (t: HashTarget, e: React.MouseEvent) => void;
}


function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────────────────

export function RevisionCommentThread({ revisionId, sceneKey, onHashClick, onHashContextMenu, openInCommentPanel = false }: Props) {
  const { currentUser, users } = useAuthStore();
  const { setView, setHighlightUserName } = useAppStore();
  const revision = useRevisionStore(s => s.revisions.find(r => r.id === revisionId));
  const revisionLabel = revision ? revisionNoToLabel(revision.revisionNo) : 're?';
  const { sheetName, sceneId } = useMemo(() => parseSceneKey(sceneKey), [sceneKey]);

  const [allComments, setAllComments] = useState<SceneComment[]>([]);
  // 내 댓글의 슬랙 전달 결과(씬 댓글 B안 §6.2) — 말풍선 아래 작은 글.
  const [slackDelivery, setSlackDelivery] = useState<Map<string, MentionDeliveryEntry>>(() => new Map());
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(true);
  /** 댓글 패널 스레드 창을 쓰는 화면에서 카드 안 목록을 펼쳤나(패널이 못 받았거나 알림으로 특정 댓글을 보여 줄 때). */
  const [inlineOpen, setInlineOpen] = useState(!openInCommentPanel);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [lightbox, setLightbox] = useState<AttachmentImageLightboxState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  const draftRef = useRef('');
  const mountedRef = useRef(true);
  const commentRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const setCommentNode = useCallback((commentId: string, node: HTMLDivElement | null) => {
    if (node) commentRefs.current.set(commentId, node);
    else commentRefs.current.delete(commentId);
  }, []);

  useEffect(() => { attachedImagesRef.current = attachedImages; }, [attachedImages]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attachedImagesRef.current.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
        if (item.uploadedUrl) {
          storageService.deleteImage(item.uploadedUrl).catch(err => {
            console.warn('[리테이크 댓글 첨부 unmount] draft Storage 정리 실패:', err);
          });
        }
      });
    };
  }, []);

  // 이 리테이크 맥락 댓글만 필터 (시간순)
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
      .catch(err => console.error('[리테이크 댓글 스레드] 로드 실패:', err));
  }, [sceneKey]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // 다른 PC/창 변경 시 자동 리로드 (300ms 디바운스, CommentPanel 와 동일 패턴)
  // v1.145.0: 이 리테이크가 달린 시트(상대 부서 포함)의 신호만 받는다. 캐시를 고친 신호면 캐시만 다시 본다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sheetName = sceneKey.includes(':') ? sceneKey.slice(0, sceneKey.lastIndexOf(':')) : sceneKey;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CommentsInvalidatedDetail | undefined>).detail;
      if (!isCommentsInvalidationRelevant(detail, { sheetNames: [sheetName] })) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadComments(); }, 300);
    };
    window.addEventListener('bflow:comments-invalidated', handler);
    return () => {
      window.removeEventListener('bflow:comments-invalidated', handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadComments, sceneKey]);

  // 외부 트리거(알림 클릭 → 모달 → 펼침 요청) 수신
  useEffect(() => {
    function onExpand(e: Event) {
      const detail = (e as CustomEvent<{ revisionId?: string; commentId?: string }>).detail;
      if (detail?.revisionId === revisionId) {
        setExpanded(true);
        if (detail.commentId) {
          setInlineOpen(true);
          setFocusedCommentId(detail.commentId);
        }
      }
    }
    window.addEventListener('bflow:expand-revision', onExpand);
    return () => window.removeEventListener('bflow:expand-revision', onExpand);
  }, [revisionId]);

  useEffect(() => {
    if (!focusedCommentId || !expanded) return;

    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const tryScroll = () => {
      if (cancelled) return;
      const el = commentRefs.current.get(focusedCommentId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearTimer = setTimeout(() => setFocusedCommentId(null), 1700);
        return;
      }
      attempts += 1;
      if (attempts < 10) retryTimer = setTimeout(tryScroll, 200);
      else clearTimer = setTimeout(() => setFocusedCommentId(null), 200);
    };

    retryTimer = setTimeout(tryScroll, 100);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [focusedCommentId, expanded, comments.length]);

  // 첨부 그림 — 댓글 패널과 같은 한 벌(hooks/useImageAttachments).
  const attachments = useImageAttachments({
    setImages: setAttachedImages, sheetName, sceneId, mountedRef, label: '[리테이크 댓글 이미지]',
  });
  const removeAttachedImage = attachments.remove;

  const handlePaste = useCallback((e: ClipboardEvent<HTMLElement>) => {
    if (attachments.addFromClipboard(e.clipboardData?.items)) e.preventDefault();
  }, [attachments]);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    attachments.addFiles(e.target.files);
    e.target.value = '';
  }, [attachments]);

  const mention = useMentionAutocomplete({
    onChange: (next) => { setDraft(next); draftRef.current = next; },
    users,
    inputRef,
  });
  // 4c: #태그 자동완성 — @멘션 옆에 나란히 공존(EntityAwareInput 패턴). users 불필요(episodes 자체 구독).
  const hash = useHashtagAutocomplete({
    onChange: (next) => { setDraft(next); draftRef.current = next; },
    inputRef,
  });
  const [inputScrollLeft, setInputScrollLeft] = useState(0);

  const hasUploadingImage = attachedImages.some(item => item.uploading);
  const uploadedImageUrls = attachedImages.map(item => item.uploadedUrl).filter((url): url is string => !!url);
  const canSend = Boolean(currentUser)
    && !submitting
    && !hasUploadingImage
    && (draft.trim().length > 0 || uploadedImageUrls.length > 0);

  async function send() {
    if (!canSend || !currentUser) return;
    const prevDraft = draft;
    const prevAttached = attachedImages;
    let newComment: SceneComment | null = null;

    try {
      setSubmitting(true);

      newComment = {
        id: createUuid(),
        userId: currentUser.id,
        userName: currentUser.name,
        text: draft.trim(),
        mentions: extractMentions(draft, users.map(user => user.name)),
        images: uploadedImageUrls,
        createdAt: new Date().toISOString(),
        // v1.18.0 핵심: 이 댓글은 해당 리테이크 맥락에 속함.
        // commentService.addComment → supabase:add-comment IPC → addComment(... revisionId)
        // 까지 정식 전달되어 comments.revision_id 컬럼에 저장된다 (청크 4 Task 14 정식화).
        revisionId,
      };

      // 낙관적 UI
      setAllComments(prev => [...prev, newComment!]);
      setDraft('');
      draftRef.current = '';
      mention.close();
      hash.close();
      setAttachedImages([]);
      attachedImagesRef.current = [];

      await addComment(sceneKey, newComment);
      prevAttached.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
      });

      // v1.146.0(§6.2): 댓글 패널과 같은 슬랙 함수 — 직접 부른 @이름 + 리테이크 요청자(작성자가 요청자면 빼고).
      {
        const sent = newComment;
        const extraTargetIds = revision?.requesterId && revision.requesterId !== currentUser.id ? [revision.requesterId] : [];
        if (sent.mentions.length > 0 || extraTargetIds.length > 0) {
          const scene = useDataStore.getState().episodes.flatMap((ep) => ep.parts)
            .find((p) => p.sheetName === sheetName)?.scenes.find((sc) => String(sc.no) === String(sceneId));
          startMentionDelivery({
            comment: { text: sent.text, images: sent.images, mentions: sent.mentions },
            sheetName,
            sceneNo: sceneId,
            sceneLabel: scene?.sceneId ?? null,
            me: currentUser,
            users,
            extraTargetIds,
          }, (entry) => {
            if (!mountedRef.current) return;
            setSlackDelivery((prev) => new Map(prev).set(sent.id, entry));
          });
        }
      }
    } catch (err) {
      console.error('[리테이크 댓글 스레드] 전송 실패:', err);
      const failedComment = newComment;
      if (!failedComment) {
        if (mountedRef.current) {
          setDraft(prevDraft);
          draftRef.current = prevDraft;
          setAttachedImages(prevAttached);
          attachedImagesRef.current = prevAttached;
        }
        return;
      }

      if (!mountedRef.current) {
        prevAttached.forEach((item) => {
          try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
          if (item.uploadedUrl) {
            storageService.deleteImage(item.uploadedUrl).catch(err2 => {
              console.warn('[리테이크 댓글 전송 실패 + unmount] storage 정리 실패:', err2);
            });
          }
        });
        return;
      }

      // 롤백
      setAllComments(prev => prev.filter(c => c.id !== failedComment.id));
      const userStartedNewDraft = draftRef.current.length > 0 || attachedImagesRef.current.length > 0;
      if (userStartedNewDraft) {
        prevAttached.forEach((item) => {
          try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
          if (item.uploadedUrl) {
            storageService.deleteImage(item.uploadedUrl).catch(err2 => {
              console.warn('[리테이크 댓글 전송 실패 롤백] 버려진 업로드 객체 정리 실패:', err2);
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
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  }

  // 옆 댓글 패널의 스레드 창으로 — 요약 + '스레드 열기'(§5.4). 패널이 받지 못하면 카드 안에 펼친다.
  if (openInCommentPanel && !inlineOpen) {
    const summary = summarizeThread(comments, () => false);
    const openInPanel = () => {
      // 이 카드의 씬 키를 같이 — 도킹한 참조 씬의 카드가 본 씬 댓글 패널에서 열리지 않게(그 패널은 자기 씬만 받는다).
      const detail: { revisionId: string; sceneKey: string; handled?: boolean } = { revisionId, sceneKey };
      window.dispatchEvent(new CustomEvent('bflow:open-revision-thread', { detail }));
      if (!detail.handled) setInlineOpen(true);
    };
    return (
      <div className="mt-3 border-t border-bg-border/40 pt-2.5 flex items-center gap-2 flex-wrap" data-revision-thread-summary>
        {summary ? (
          <CommentThreadSummaryButton summary={summary} noun="댓글" onOpen={openInPanel} />
        ) : (
          <span className="text-[11.5px] text-text-secondary">아직 댓글이 없어요</span>
        )}
        <button type="button" className="cmt-btn ml-auto" onClick={openInPanel}>
          스레드 열기
        </button>
      </div>
    );
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
    <div className="mt-3 border-t border-bg-border/40 pt-2 space-y-0.5">
      {comments.map(c => (
        <div
          key={c.id}
          ref={(node) => setCommentNode(c.id, node)}
          className={focusedCommentId === c.id ? 'comment-target-pulse rounded-lg' : undefined}
        >
          <CommentBubble
            comment={c}
            revisionId={c.revisionId ?? revisionId}
            isMe={c.userId === currentUser?.id}
            users={users}
            onImageClick={openLightbox}
            onMentionClick={(userName) => {
              setHighlightUserName(userName);
              setView('team');
            }}
            onHashClick={onHashClick ?? navigateToHashTarget}
            onHashContextMenu={onHashContextMenu}
          />
          {c.userId === currentUser?.id && slackDelivery.get(c.id) && (() => {
            const entry = slackDelivery.get(c.id)!;
            const note = describeMentionDelivery(entry.result);
            if (!note) return null;
            return (
              <div
                data-comment-slack-delivery
                role={note.failed ? 'alert' : undefined}
                className="mt-0.5 flex flex-wrap items-center justify-end gap-x-1.5 text-[11px]"
              >
                <span className={note.failed && !entry.sending ? 'font-semibold text-status-low' : 'text-text-secondary/70'}>
                  {entry.sending ? '슬랙 다시 보내는 중…' : note.text}
                </span>
                {note.failed && !entry.sending && (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); entry.retry(); }}
                    className="font-semibold text-accent underline-offset-2 hover:underline cursor-pointer"
                  >
                    다시 보내기
                  </button>
                )}
              </div>
            );
          })()}
        </div>
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
              {mention.active ? (
                <MentionDropdown
                  showSlackHint
                  items={mention.items}
                  index={mention.index}
                  onPick={mention.select}
                  positionClassName="left-10 right-24"
                />
              ) : hash.active ? (
                <HashtagDropdown
                  items={hash.items}
                  index={hash.index}
                  onPick={hash.select}
                  positionClassName="left-10 right-24"
                />
              ) : null}
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
              <div className="relative flex-1 min-w-0">
                {/* 4a-2: 입력 중 @이름·경로·컷 파란 강조(미러). 입력칸은 !bg-transparent + 위. */}
                <EntityHighlightOverlay
                  text={draft}
                  userNames={users.map(user => user.name)}
                  singleLine
                  scrollLeft={inputScrollLeft}
                  className="w-full px-3 py-1.5 border rounded text-[12px]"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={e => { setDraft(e.target.value); draftRef.current = e.target.value; mention.refresh(); hash.refresh(); }}
                  // caret 이동은 onSelect/onClick 으로만 감지(onKeyUp 미사용) — 멘션 활성 중 Arrow/Escape 는
                  // preventDefault 되어 caret 이 안 바뀌므로 refresh 가 안 돌아 index 리셋·Escape 후 재오픈이 없다.
                  onClick={() => { mention.refresh(); hash.refresh(); }}
                  onSelect={() => { mention.refresh(); hash.refresh(); }}
                  onScroll={e => setInputScrollLeft(e.currentTarget.scrollLeft)}
                  onKeyDown={e => {
                    if (mention.onKeyDown(e)) return;
                    if (hash.onKeyDown(e)) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={`${revisionLabel} 댓글 남기기... (Ctrl+V)`}
                  className="relative w-full px-3 py-1.5 !bg-transparent border border-bg-border/60 rounded text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
                />
              </div>
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
          ariaLabel="리테이크 댓글 이미지 확대 보기"
          fileNamePrefix={`${revisionLabel}-comment`}
        />
      )}
    </div>
  );
}

// ─── 댓글 버블 ──────────────────────────────────────────────────────────

function CommentBubble({
  comment,
  revisionId,
  isMe,
  users,
  onImageClick,
  onMentionClick,
  onHashClick,
  onHashContextMenu,
}: {
  comment: SceneComment;
  revisionId: string;
  isMe: boolean;
  users: { name: string }[];
  onImageClick: (url: string, comment: SceneComment) => void;
  onMentionClick: (userName: string) => void;
  onHashClick?: (target: import('@/utils/hashEntity').HashTarget) => void;
  onHashContextMenu?: (t: import('@/utils/hashEntity').HashTarget, e: React.MouseEvent) => void;
}) {
  return (
    <div className="cmt-row" data-revision-comment-row data-revision-id={revisionId} data-mine={isMe ? '' : undefined}>
      <CommentAvatar userId={comment.userId} userName={comment.userName} />
      <div className="min-w-0">
        <div className="cmt-head">
          <span className="cmt-name">{comment.userName}</span>
          <span className="cmt-time">{formatCommentTime(comment.createdAt)}</span>
          {comment.editedAt && <span className="cmt-meta-note">(수정됨)</span>}
        </div>
        {comment.text && (
          <div className="cmt-body">
            <EntityText
              text={comment.text}
              userNames={users.map(user => user.name)}
              onMentionClick={onMentionClick}
              onHashClick={onHashClick}
              onHashContextMenu={onHashContextMenu}
            />
          </div>
        )}
        {(comment.images?.length ?? 0) > 0 && (
          <div className={comment.images!.length > 1 ? 'cmt-images is-multi' : 'cmt-images'}>
            {comment.images!.map((url, index) => (
              <button
                type="button"
                key={`${url}-${index}`}
                className="cmt-image-button"
                aria-label={`${comment.userName}의 첨부 이미지 ${index + 1} 크게 보기`}
                onClick={() => onImageClick(url, comment)}
              >
                <img src={url} alt={`${comment.userName}의 첨부 이미지 ${index + 1}`} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
