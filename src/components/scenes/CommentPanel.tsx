import { Fragment, useState, useEffect, useRef, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, Paperclip, X, ImagePlus, ArrowUp, CornerDownRight, ChevronDown, ChevronRight, Reply, MessageSquareWarning, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import {
  getComments,
  getCommentsForCharacter,
  buildCharacterCommentKey,
  addComment,
  updateComment,
  deleteComment,
  extractMentions,
  addReaction,
  removeReaction,
  fetchReactionsBulk,
} from '@/services/commentService';
import type { SceneComment } from '@/services/commentService';
import type { AppUser, CommentReaction, CompRevision } from '@/types';
import { groupReactionsByEmoji } from '@/utils/commentReactionUtils';
import { ReactionChip } from './ReactionChip';
import { EmojiPicker } from './EmojiPicker';
import { SmilePlus } from 'lucide-react';
import { sendMentionWebhook } from '@/services/slackWebhookService';
import { formatCommentTime } from '@/utils/formatTime';
import { EntityText } from '@/components/common/EntityText';
import { EntityHighlightOverlay } from '@/components/common/EntityHighlightOverlay';
import { MentionDropdown } from '@/components/common/MentionDropdown';
import { HashtagDropdown } from '@/components/common/HashtagDropdown';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useHashtagAutocomplete } from '@/hooks/useHashtagAutocomplete';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import type { HashTarget } from '@/utils/hashEntity';
import {
  COMMENT_READ_STATE_EVENT,
  getCommentReadStateForUser,
  getLatestOtherUserCommentCreatedAt,
  isCommentKeyUnread,
  markSceneThreadReadForUser,
} from '@/services/commentReadStateService';
import * as storageService from '@/services/storageService';
import { resizeBlob } from '@/utils/imageUtils';
import { RevisionCommentBadge } from './RevisionCommentBadge';
import { RevisionRecipientPicker } from './RevisionRecipientPicker';
import { revisionNoToLabel } from '@/constants/revision';
import {
  getDefaultRevisionSlashRecipientIds,
  parseRevisionSlashCommand,
  type RevisionSlashContext,
} from '@/utils/revisionSlashCommand';
import { buildCommentReplyTarget } from '@/utils/commentThreading';
import { createUuid } from '@/utils/createUuid';
import { AttachmentImageLightbox } from './AttachmentImageLightbox';
import { toast as sonnerToast } from 'sonner';
import '@/styles/comment-panel.css';

// ─── 타입 ───────────────────────────────────

/** 시스템 이벤트 — 댓글 사이사이에 작은 줄로 인라인 표시 (씬 생성/완료/리테이크 등) */
export interface CommentInlineEvent {
  id: string;
  at: string;       // ISO 8601
  text: string;     // 한 줄 텍스트 (예: "이다은이 BG 모든 단계를 완료했습니다")
  tone?: 'default' | 'revision_add' | 'revision_in_progress' | 'revision_resolve' | 'revision_update' | 'revision_delete';
  label?: string;
  revisionId?: string;
  revisionAction?: 'add' | 'status' | 'delete';
}

interface CommentPanelProps {
  /** 기본 sceneKey. 새 댓글은 항상 이 키에 저장된다. 캐릭터 스레드 모드면 무시되고 character 경로로 저장된다. */
  sceneKey: string;
  /**
   * 캐릭터 현황판 상세 스레드 모드. 값이 있으면 댓글 로드/작성을 캐릭터(character_id) 경로로 처리한다.
   * 씬(sceneKey/secondarySceneKey) 경로는 이 prop 이 있을 때 전혀 사용되지 않는다.
   */
  characterThread?: { characterId: string; characterName?: string };
  /** 통합 뷰 전용 — 이 키의 댓글도 함께 보여주되, 저장은 primary(sceneKey)에만 한다 */
  secondarySceneKey?: string;
  /** 사용자별 읽음 상태 저장에 쓰는 canonical 씬 대화 키 */
  sceneThreadKey?: string;
  onCountChange?: (count: number) => void;
  /** 댓글 사이에 시간순으로 끼어들어가는 시스템 이벤트 (씬 생성/완료/리테이크 등) */
  inlineEvents?: CommentInlineEvent[];
  /** v1.24.0: 외부 점프 시 자동 스크롤 + 펄스 강조할 댓글 id. 답글이면 부모 자동 펼침. */
  focusCommentId?: string | null;
  /** v1.24.0: 댓글 이미지 라이트박스 상단에 표시할 씬 라벨 (예: "EP01 A컷 #03"). */
  sceneLabel?: string;
  /** 댓글 입력창의 /re 빠른 리테이크 등록 문맥. 없으면 /re 는 일반 댓글로 취급된다. */
  quickRevision?: CommentPanelQuickRevisionContext;
  /** 4c PR2: #씬 칩 클릭 처리 분기(도킹 참조). 없으면 기존 점프(navigateToHashTarget). */
  onHashClick?: (t: HashTarget) => void;
  /** 4c PR3: #씬·#파트·#화 칩 우클릭 메뉴. */
  onHashContextMenu?: (t: HashTarget, e: React.MouseEvent) => void;
  /** Slack-style 스레드 사이드 패널 열림 상태를 부모 패널 폭 계산에 알려준다. */
  onThreadPanelOpenChange?: (open: boolean) => void;
  /** 스레드 사이드 패널 폭(px). 부모의 분할 리사이즈 상태가 내려온다. */
  threadWidth?: number;
  /** 댓글 목록과 스레드 사이 분할 핸들의 현재 drag/hover 상태. */
  threadResizeActive?: boolean;
  threadResizeHover?: boolean;
  onThreadResizeMouseDown?: (event: React.MouseEvent) => void;
  onThreadResizeDoubleClick?: () => void;
  onThreadResizeHoverChange?: (hover: boolean) => void;
}

type CommentReactionPickerSurface = 'main' | 'thread';

interface CommentReactionPickerTarget {
  commentId: string;
  surface: CommentReactionPickerSurface;
}

export interface CommentPanelQuickRevisionContext {
  /** buildSceneKey() 로 만든 리테이크 canonical sceneKey */
  sceneKey: string;
  /** 현재 화면 문맥. 전체 모드는 BG/ACT 담당자를 모두 기본 체크한다. */
  context: RevisionSlashContext;
  /** 리테이크에 기록할 부서. 전체 모드에서는 생략 가능. */
  department?: 'bg' | 'acting';
  bgAssignee?: string | null;
  actingAssignee?: string | null;
}

/**
 * v1.24.0/v1.24.2: 댓글 이미지 라이트박스 상태.
 *
 * v1.24.2 한솔 보고 fix: 한 댓글의 이미지만 순회 → *씬 안 모든 댓글의 모든 이미지*를 한 갤러리로
 *   순회. 박정인이 각 댓글에 1장씩 5번 첨부한 케이스에서 이전엔 1/1 만 보였음. 이제 5/5 로 보임.
 *   각 이미지 별로 *원본 댓글*의 작성자/본문/시간을 함께 표시 (이미지 변경 시 자동 갱신).
 */
interface CommentLightboxEntry {
  url: string;
  userName: string;
  commentText: string;
  createdAt: string;
  commentId: string;
}
interface CommentLightboxState {
  entries: CommentLightboxEntry[];
  index: number;
}

/** 내부 렌더링용 — 원본이 어느 sceneKey 에서 왔는지 추적 */
type SceneCommentWithSource = SceneComment & { _sourceKey?: string };

/** 첨부 진행 중인 이미지 — 업로드 완료 시 uploadedUrl 채워짐 */
interface AttachedImage {
  id: string;
  previewUrl: string;       // blob URL — 즉시 미리보기
  uploadedUrl?: string;     // CDN URL — 업로드 완료 후
  uploading: boolean;
  error?: string;
}

function cleanupDraftImages(images: AttachedImage[], context: string) {
  images.forEach((item) => {
    try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
    if (item.uploadedUrl) {
      storageService.deleteImage(item.uploadedUrl).catch(err => {
        console.warn(`${context} Storage 정리 실패:`, err);
      });
    }
  });
}

// ─── sceneKey 분해 ─────────────────────────
function parseSceneKey(sceneKey: string): { sheetName: string; sceneId: string } {
  const idx = sceneKey.lastIndexOf(':');
  return { sheetName: sceneKey.substring(0, idx), sceneId: sceneKey.substring(idx + 1) };
}

function isRetakeInlineEvent(event: CommentInlineEvent): boolean {
  return !!event.revisionId || (event.tone?.startsWith('revision_') ?? false);
}

function getRevisionStatusLabel(revision: CompRevision | null): string {
  if (!revision) return '상태 확인 중';
  if (revision.status === 'open') return '대기';
  if (revision.status === 'in_progress') return '진행중';
  if (revision.status === 'assignee_done') return '담당 완료';
  if (revision.status === 'resolved') return '완료';
  return '상태 확인 중';
}

// ─── v1.26.0: 댓글 리액션 영역 (보조 컴포넌트) ─────────────────
interface ReactionsAreaProps {
  commentId: string;
  reactions: CommentReaction[];
  currentUserId: string | null;
  onToggle: (commentId: string, emoji: string) => void;
  pickerOpen: boolean;
  onPickerOpen: () => void;
  onPickerClose: () => void;
  compact?: boolean;  // 답글에서는 더 작게
}

function ReactionsArea({
  commentId,
  reactions,
  currentUserId,
  onToggle,
  pickerOpen,
  onPickerOpen,
  onPickerClose,
  compact = false,
}: ReactionsAreaProps) {
  const groups = groupReactionsByEmoji(reactions, currentUserId);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hasReactions = groups.length > 0;
  // 답글에선 칩 없을 때 + 버튼 평소 보이지 않다가 hover 시만. 부모도 동일하지만 살짝 더 노출 폭 큼.
  return (
    <div
      className={cn(
        'relative flex flex-wrap items-center gap-1',
        compact ? 'mt-1' : 'mt-1.5',
        !hasReactions && 'group/reactions-empty',
      )}
    >
      {groups.map((g) => (
        <ReactionChip
          key={g.emoji}
          group={g}
          currentUserId={currentUserId}
          onToggle={(emoji) => onToggle(commentId, emoji)}
        />
      ))}
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (pickerOpen) onPickerClose();
          else onPickerOpen();
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-dashed border-bg-border text-text-secondary/60 hover:border-accent/60 hover:text-accent-sub hover:bg-accent/[0.06] transition-all',
          compact ? 'w-5 h-5' : 'w-6 h-5',
          hasReactions ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 hover:opacity-100',
        )}
        aria-label="이모지 추가"
        title="이모지 추가"
      >
        <SmilePlus size={compact ? 11 : 12} />
      </button>
      <EmojiPicker
        open={pickerOpen}
        anchorEl={btnRef.current}
        onPick={(emoji) => onToggle(commentId, emoji)}
        onClose={onPickerClose}
      />
    </div>
  );
}

function ThreadReplyButton({
  compact = false,
  onClick,
  'aria-label': ariaLabel,
}: {
  compact?: boolean;
  onClick: () => void;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={ariaLabel}
      title="이 스레드에 답글"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-bg-border/70 bg-bg-primary/60 text-text-secondary/70 hover:border-accent/50 hover:bg-accent/[0.08] hover:text-accent-sub transition-all',
        compact ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-[11px]',
      )}
    >
      <Reply size={compact ? 10 : 11} />
      <span>답글</span>
    </button>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────

export function CommentPanel({
  sceneKey,
  characterThread,
  secondarySceneKey,
  sceneThreadKey,
  onCountChange,
  inlineEvents,
  focusCommentId,
  sceneLabel,
  quickRevision,
  onHashClick,
  onHashContextMenu,
  onThreadPanelOpenChange,
  threadWidth = 340,
  threadResizeActive = false,
  threadResizeHover = false,
  onThreadResizeMouseDown,
  onThreadResizeDoubleClick,
  onThreadResizeHoverChange,
}: CommentPanelProps) {
  const { currentUser, users } = useAuthStore();
  const { setView, setHighlightUserName } = useAppStore();
  const createRevision = useRevisionStore((s) => s.createRevision);
  const loadRevisions = useRevisionStore((s) => s.loadRevisions);
  const revisions = useRevisionStore((s) => s.revisions);
  const userNames = useMemo(() => users.map((u) => u.name), [users]);

  // 캐릭터 스레드 모드 — 이 키가 있으면 모든 댓글 로드/작성이 character 경로로 흐른다.
  const characterId = characterThread?.characterId ?? null;
  const characterCommentKey = useMemo(
    () => (characterId ? buildCharacterCommentKey(characterId) : null),
    [characterId],
  );
  // 새 댓글이 저장될 키 — 캐릭터 모드면 char:{id}, 아니면 씬 키. addComment/대댓글/스레드가 공통으로 쓴다.
  const primaryStorageKey = characterCommentKey ?? sceneKey;

  const { sheetName, sceneId } = useMemo(() => parseSceneKey(primaryStorageKey), [primaryStorageKey]);
  const effectiveSceneThreadKey = characterCommentKey ?? sceneThreadKey ?? sceneKey;
  const sceneKeyRef = useRef(sceneKey);
  sceneKeyRef.current = sceneKey;

  useEffect(() => {
    if (!quickRevision?.sceneKey) return;
    loadRevisions();
  }, [loadRevisions, quickRevision?.sceneKey]);

  // 댓글 상태
  const [comments, setComments] = useState<SceneCommentWithSource[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // v1.26.0: 이모지 리액션 — commentId → reactions
  const [reactionsByCommentId, setReactionsByCommentId] = useState<Map<string, CommentReaction[]>>(new Map());
  const [reactionPicker, setReactionPicker] = useState<CommentReactionPickerTarget | null>(null);
  const pickerAnchorRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  // 입력 상태
  const [input, setInput] = useState('');
  const [taHeight, setTaHeight] = useState(40);
  const [taScrollTop, setTaScrollTop] = useState(0);
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [threadInput, setThreadInput] = useState('');
  const [threadSubmitting, setThreadSubmitting] = useState(false);
  const [threadMentionTarget, setThreadMentionTarget] = useState<SceneCommentWithSource | null>(null);
  const [threadAttachedImages, setThreadAttachedImages] = useState<AttachedImage[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [quickRevisionPickerOpen, setQuickRevisionPickerOpen] = useState(false);
  const [quickRevisionNotifyIds, setQuickRevisionNotifyIds] = useState<string[]>([]);


  // v1.24.0: 답글 입력 모드 — 클릭 시 입력 카드 상단에 답글 컨텍스트 헤더 노출 + parentCommentId 채워서 저장.
  // 코덱스 P2 fix (2026-05-10): sceneKey 변경 시 reset 필수 — 안 그러면 다른 씬으로 이동 후 전송 시
  //   cross-scene parentCommentId 가 박혀 orphan 답글 + 잘못된 부모 작성자에게 알림 발송.
  const [replyTarget, setReplyTarget] = useState<SceneCommentWithSource | null>(null);
  const [activeThreadRootId, setActiveThreadRootId] = useState<string | null>(null);
  const activeThreadRootIdRef = useRef<string | null>(activeThreadRootId);
  activeThreadRootIdRef.current = activeThreadRootId;
  const [activeRevisionThreadId, setActiveRevisionThreadId] = useState<string | null>(null);
  const activeRevisionThreadIdRef = useRef<string | null>(activeRevisionThreadId);
  activeRevisionThreadIdRef.current = activeRevisionThreadId;
  const [lastThreadRootId, setLastThreadRootId] = useState<string | null>(null);
  useEffect(() => {
    setReplyTarget(null);
    setActiveThreadRootId(null);
    setActiveRevisionThreadId(null);
    setLastThreadRootId(null);
    setThreadInput('');
    threadInputValueRef.current = '';
    cleanupDraftImages(threadAttachedImagesRef.current, '[스레드 댓글 scene 변경]');
    setThreadAttachedImages([]);
    threadAttachedImagesRef.current = [];
    setThreadSubmitting(false);
    threadSubmitRequestRef.current = null;
    setThreadMentionTarget(null);
  }, [primaryStorageKey]);
  useEffect(() => {
    setThreadInput('');
    threadInputValueRef.current = '';
    cleanupDraftImages(threadAttachedImagesRef.current, '[스레드 댓글 전환]');
    setThreadAttachedImages([]);
    threadAttachedImagesRef.current = [];
    setThreadSubmitting(false);
    threadSubmitRequestRef.current = null;
  }, [activeThreadRootId, activeRevisionThreadId]);
  // v1.24.0: 부모 댓글 별 답글 접힘 상태 (기본 펼침 — 처음 진입 시 모두 펼친 상태).
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const toggleThread = useCallback((parentId: string) => {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);
  const replyDraftTarget = useMemo(
    () => buildCommentReplyTarget(comments, replyTarget),
    [comments, replyTarget],
  );
  // v1.24.0: 외부 점프 시 강조할 댓글 id. focusCommentId prop 변경 또는 jump 이벤트로 set.
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(focusCommentId ?? null);
  const commentRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const readMarkedRef = useRef<string | null>(null);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);
  const [unreadDividerElement, setUnreadDividerElement] = useState<HTMLDivElement | null>(null);
  const setUnreadDividerNode = useCallback((node: HTMLDivElement | null) => {
    unreadDividerRef.current = node;
    setUnreadDividerElement(node);
  }, []);

  // v1.18.0: "re만" 필터 — 리테이크 맥락 댓글(revisionId 있음)만 표시.
  // 한솔 결정 (spec 2026-05-03): 댓글 패널에서 "리테이크 댓글만" 빠르게 가려보고 싶을 때 토글.
  // onCountChange 는 전체 카운트로 유지(외부 배지 표기 일관성), 시각 필터만 패널 내부 적용.
  const [reOnly, setReOnly] = useState(false);
  // v1.23.4 (#3 한솔): 활동(inlineEvents) 감추기 — 댓글만 보기. localStorage 영속.
  const [hideActivity, setHideActivity] = useState<boolean>(() => {
    try { return localStorage.getItem('bflow_comment_hide_activity') === '1'; } catch { return false; }
  });
  const toggleHideActivity = useCallback(() => {
    setHideActivity((v) => {
      const next = !v;
      try { localStorage.setItem('bflow_comment_hide_activity', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // 드래그 + 라이트박스
  const [draggingOver, setDraggingOver] = useState(false);
  // v1.24.0: 단일 URL → 이미지 배열 + 인덱스 + 컨텍스트 로 확장.
  // v1.24.2: 한 댓글 → *씬 안 모든 댓글의 모든 이미지* 갤러리로 확장 (사용자 보고 fix).
  const [lightbox, setLightbox] = useState<CommentLightboxState | null>(null);
  // commentsRef — openLightbox 가 클릭 시점의 *최신 visibleComments* 를 닫힌 클로저 없이 참조하기 위함.
  const commentsRef = useRef<SceneCommentWithSource[]>([]);
  const openLightbox = useCallback((clickedUrl: string, clickedComment: SceneComment) => {
    // 씬 안 모든 댓글의 모든 이미지를 시간순으로 합쳐 갤러리 entries 구성.
    // 같은 url 이 여러 댓글에 들어있어도 각자 별도 entry (작성자/본문/시간 다를 수 있음).
    const entries: CommentLightboxEntry[] = [];
    const sorted = [...commentsRef.current].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    for (const c of sorted) {
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
    // 클릭한 이미지의 인덱스 — 같은 댓글의 같은 url 매칭 (다른 댓글의 동일 url 회피).
    let clickIdx = entries.findIndex(
      (e) => e.commentId === clickedComment.id && e.url === clickedUrl,
    );
    if (clickIdx < 0) clickIdx = entries.findIndex((e) => e.url === clickedUrl);
    if (clickIdx < 0) clickIdx = 0;
    setLightbox({ entries, index: clickIdx });
  }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const lightboxStep = useCallback((dir: 1 | -1) => {
    setLightbox((prev) => {
      if (!prev) return prev;
      const len = prev.entries.length;
      if (len <= 1) return prev;
      const next = (prev.index + dir + len) % len;
      return { ...prev, index: next };
    });
  }, []);

  // 패널 높이 측정 — 입력 카드 35% 한계 계산
  const [panelHeight, setPanelHeight] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadInputValueRef = useRef('');
  const threadSubmitRequestRef = useRef<string | null>(null);
  const threadAttachedImagesRef = useRef<AttachedImage[]>([]);
  const threadInputRef = useRef<HTMLTextAreaElement>(null);
  const threadFileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const openThreadReply = useCallback((target: SceneCommentWithSource) => {
    const threadTarget = buildCommentReplyTarget(comments, target);
    const threadRootId = threadTarget.parentCommentId ?? threadTarget.rootComment?.id ?? target.id;
    setActiveRevisionThreadId(null);
    setActiveThreadRootId(threadRootId);
    setLastThreadRootId(threadRootId);
    setCollapsedThreads((prev) => {
      if (!prev.has(threadRootId)) return prev;
      const next = new Set(prev);
      next.delete(threadRootId);
      return next;
    });
    setReplyTarget(null);
    setThreadMentionTarget(target);
    requestAnimationFrame(() => threadInputRef.current?.focus());
  }, [comments]);
  const revisionExists = useCallback((revisionId?: string | null): revisionId is string => {
    return !!revisionId && revisions.some((revision) => revision.id === revisionId);
  }, [revisions]);
  const openRevisionDetail = useCallback((revisionId?: string) => {
    if (!revisionExists(revisionId)) return;
    window.dispatchEvent(new CustomEvent('bflow:jump-to-revision', { detail: { revisionId } }));
  }, [revisionExists]);
  const openRevisionThread = useCallback((revisionId?: string, focusComposer = false, mentionTarget: SceneCommentWithSource | null = null) => {
    if (!revisionExists(revisionId)) return;
    setActiveThreadRootId(null);
    setActiveRevisionThreadId(revisionId);
    setReplyTarget(null);
    setThreadMentionTarget(mentionTarget);
    if (focusComposer) requestAnimationFrame(() => threadInputRef.current?.focus());
  }, [revisionExists]);
  const openContextualThreadReply = useCallback((target: SceneCommentWithSource) => {
    if (target.revisionId) {
      openRevisionThread(target.revisionId, true, target);
      return;
    }
    openThreadReply(target);
  }, [openRevisionThread, openThreadReply]);
  const replyInActiveThread = useCallback((target: SceneCommentWithSource) => {
    const targetRevisionId = activeRevisionThreadId ?? target.revisionId;
    if (targetRevisionId) {
      openRevisionThread(targetRevisionId, true, target);
      return;
    }
    openThreadReply(target);
  }, [activeRevisionThreadId, openRevisionThread, openThreadReply]);

  // ── 입력 카드 + textarea 한계 계산 ──
  // 패널 전체 높이의 30% 까지 입력 카드가 자란다. 그 이상은 textarea 안에서 스크롤.
  // v1.23.3 (#1 진짜 fix): 카드 자체에 overflow-hidden + flex-col + textarea flex-1 로 재구성.
  //   기존 cap 220 도 overflow:visible 카드라 콘텐츠가 모달 밖으로 흘러넘쳐 회귀.
  //   카드를 flex-col 로 만들고 footer 가 항상 보이도록 textarea 가 자체 scroll 처리.
  //   추가로 cap 도 180 으로 더 단단히.
  const inputCardMaxPx = Math.min(180, Math.max(120, Math.floor(panelHeight * 0.30)));
  const imageRowHeight = attachedImages.length > 0 ? 88 : 0;       // 썸네일 64 + 위아래 여백 + pb-1
  const FOOTER_H = 56;                                              // toolbar(h-7) + mt-1.5 + border + pt-1.5 + 카드 padding(pt-2 + pb-1.5)
  const taMaxPx = Math.max(40, inputCardMaxPx - imageRowHeight - FOOTER_H);

  // 패널 ResizeObserver — 부모 높이 변화 추적
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => setPanelHeight(panel.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel);
    return () => ro.disconnect();
  }, []);

  // textarea 부드러운 자라기 — 측정 시 'auto' 잠깐 → 이전 px 복원 → setState (px → px transition)
  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = 'auto';
    const sh = ta.scrollHeight;
    ta.style.height = prev;
    setTaHeight(Math.max(40, Math.min(sh, taMaxPx)));
  }, [input, taMaxPx]);

  const quickRevisionCommand = useMemo(() => parseRevisionSlashCommand(input), [input]);
  const quickRevisionActive = !!quickRevision && quickRevisionCommand.isRevisionCommand;
  const quickRevisionDescription = quickRevisionCommand.description;
  const quickRevisionDefaultRecipientIds = useMemo(() => {
    if (!quickRevision || !currentUser) return [];
    return getDefaultRevisionSlashRecipientIds({
      context: quickRevision.context,
      bgAssignee: quickRevision.bgAssignee,
      actingAssignee: quickRevision.actingAssignee,
      allUsers: users,
      excludeUserId: currentUser.id,
    });
  }, [
    quickRevision?.context,
    quickRevision?.bgAssignee,
    quickRevision?.actingAssignee,
    currentUser?.id,
    users,
  ]);
  const quickRevisionDefaultRecipientKey = quickRevisionDefaultRecipientIds.join('|');

  useEffect(() => {
    if (!quickRevisionActive) {
      setQuickRevisionPickerOpen(false);
      return;
    }
    setQuickRevisionNotifyIds(quickRevisionDefaultRecipientIds);
    setReplyTarget(null);
  }, [quickRevisionActive, quickRevisionDefaultRecipientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickRevisionSelectedUsers = useMemo(
    () => quickRevisionNotifyIds
      .map((id) => users.find((user) => user.id === id))
      .filter((user): user is AppUser => !!user),
    [quickRevisionNotifyIds, users],
  );
  const quickRevisionHasAttachments = quickRevisionActive && attachedImages.length > 0;

  // 댓글 로드 — primary + optional secondary 시간순 병합 (기존 로직).
  // 캐릭터 스레드 모드는 character 경로로만 로드하고 secondary 는 무시한다 (씬 키 경로 미사용).
  const loadComments = useCallback(() => {
    const primaryPromise = characterId
      ? getCommentsForCharacter(characterId).then((list) =>
          list.map<SceneCommentWithSource>((c) => ({ ...c, _sourceKey: characterCommentKey ?? undefined })),
        )
      : getComments(sceneKey).then((list) =>
          list.map<SceneCommentWithSource>((c) => ({ ...c, _sourceKey: sceneKey })),
        );
    const secondaryPromise = !characterId && secondarySceneKey
      ? getComments(secondarySceneKey).then((list) =>
          list.map<SceneCommentWithSource>((c) => ({ ...c, _sourceKey: secondarySceneKey })),
        )
      : Promise.resolve([] as SceneCommentWithSource[]);

    Promise.all([primaryPromise, secondaryPromise]).then(([a, b]) => {
      const merged = [...a, ...b].sort(
        (x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime(),
      );
      const seen = new Set<string>();
      const deduped = merged.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      setComments(deduped);
      onCountChange?.(deduped.length);
      // v1.26.0: 댓글 로드 후 리액션도 함께 fetch
      const ids = deduped.map((c) => c.id);
      fetchReactionsBulk(ids).then((map) => setReactionsByCommentId(map));
    });
  }, [sceneKey, secondarySceneKey, characterId, characterCommentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadComments(); }, [loadComments]);

  // v1.28.0 (코덱스 2차 P1): 다른 클라이언트의 리액션 변경 broadcast 수신 → 해당 댓글만 재fetch.
  //   App.tsx 가 'bflow:comment-reaction-changed' window event 를 dispatch 한다.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ commentId?: string }>).detail;
      const cid = detail?.commentId;
      if (!cid) return;
      // 현재 패널에 떠 있는 댓글에 해당할 때만 fetch (불필요한 호출 방지)
      const isMine = comments.some((c) => c.id === cid);
      if (!isMine) return;
      fetchReactionsBulk([cid]).then((refreshed) => {
        setReactionsByCommentId((m) => {
          const nm = new Map(m);
          nm.set(cid, refreshed.get(cid) ?? []);
          return nm;
        });
      });
    };
    window.addEventListener('bflow:comment-reaction-changed', handler);
    return () => window.removeEventListener('bflow:comment-reaction-changed', handler);
  }, [comments]);

  // v1.26.0: 이모지 리액션 토글 (옵티미스틱 → IPC → 실패 시 롤백)
  const handleReactionToggle = useCallback(async (commentId: string, emoji: string) => {
    if (!currentUser) return;
    const prev = reactionsByCommentId.get(commentId) ?? [];
    const mine = prev.find((r) => r.userId === currentUser.id && r.emoji === emoji);
    let next: CommentReaction[];
    if (mine) {
      // 제거
      next = prev.filter((r) => !(r.userId === currentUser.id && r.emoji === emoji));
    } else {
      // 추가
      next = [...prev, {
        id: `tmp-${Date.now()}`,
        commentId,
        userId: currentUser.id,
        userName: currentUser.name,
        emoji,
        createdAt: new Date().toISOString(),
      }];
    }
    setReactionsByCommentId((m) => {
      const nm = new Map(m);
      nm.set(commentId, next);
      return nm;
    });
    try {
      if (mine) {
        await removeReaction(commentId, emoji, currentUser.id);
      } else {
        await addReaction(commentId, emoji, currentUser.id, currentUser.name);
      }
      // 재fetch 로 진짜 id 동기화
      const refreshed = await fetchReactionsBulk([commentId]);
      setReactionsByCommentId((m) => {
        const nm = new Map(m);
        nm.set(commentId, refreshed.get(commentId) ?? []);
        return nm;
      });
    } catch (err) {
      // 롤백
      console.error('[CommentPanel] 리액션 토글 실패', err);
      setReactionsByCommentId((m) => {
        const nm = new Map(m);
        nm.set(commentId, prev);
        return nm;
      });
    }
  }, [currentUser, reactionsByCommentId]);

  // v1.24.2: openLightbox 가 closure 없이 *최신 visibleComments* 참조하도록 ref 동기화.
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  const latestOtherUserCommentAt = useMemo(
    () => getLatestOtherUserCommentCreatedAt(comments, currentUser?.id ?? ''),
    [comments, currentUser?.id],
  );

  const hasUnreadComments = isCommentKeyUnread(latestOtherUserCommentAt, lastReadAt);

  useEffect(() => {
    if (!currentUser?.id) {
      setLastReadAt(null);
      return;
    }

    let cancelled = false;
    const load = () => {
      void getCommentReadStateForUser(currentUser.id).then((state) => {
        if (!cancelled) setLastReadAt(state[effectiveSceneThreadKey] ?? null);
      });
    };

    load();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== currentUser.id) return;
      load();
    };

    window.addEventListener(COMMENT_READ_STATE_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(COMMENT_READ_STATE_EVENT, handler);
    };
  }, [currentUser?.id, effectiveSceneThreadKey]);

  const markUnreadCommentsRead = useCallback(() => {
    if (!currentUser?.id || !effectiveSceneThreadKey || !latestOtherUserCommentAt) return;
    if (readMarkedRef.current === latestOtherUserCommentAt) return;

    readMarkedRef.current = latestOtherUserCommentAt;
    setLastReadAt(latestOtherUserCommentAt);
    void markSceneThreadReadForUser({
      userId: currentUser.id,
      sceneThreadKey: effectiveSceneThreadKey,
      readAt: latestOtherUserCommentAt,
    });
  }, [currentUser?.id, effectiveSceneThreadKey, latestOtherUserCommentAt]);

  // 다른 PC 변경 시 자동 리로드 (300ms 디바운스)
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

  // v1.24.0: focusCommentId prop 변경 시 → 자동 스크롤 + 일시 펄스. 답글이면 부모 자동 펼침.
  // P0 #2 fix: cleanup 누수 + comments 의존성으로 인한 펄스 무한 재시작 회귀 방지.
  //   - comments 의존성 제거 (다른 사람 댓글 추가 시 effect 재실행 X)
  //   - 두 setTimeout 모두 effect cleanup 에서 명시적으로 clear.
  //   - 답글 펼침은 별도 effect 로 분리 (target 검색에 comments 필요하지만 펄스 재시작과 무관).
  // 코덱스 P1 fix (2026-05-10): cold cache + 느린 supabase fetch 시 100ms 후 단 1회 시도라
  //   commentRefs 가 비어있어 점프 silent fail. 200ms 간격으로 최대 ~2초 재시도 (10회) → 댓글 마운트 후
  //   첫 발견 시점에 scroll. 끝까지 못 찾으면 펄스만 잠깐 뒤 해제 (무한 retry X — 펄스 무한 재시작 방지).
  useEffect(() => {
    if (!focusCommentId) return;
    setFocusedCommentId(focusCommentId);
    let attempts = 0;
    let scrolled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const tryScroll = () => {
      if (scrolled) return;
      const el = commentRefs.current.get(focusCommentId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        scrolled = true;
        clearTimer = setTimeout(() => setFocusedCommentId(null), 1700);
        return;
      }
      attempts += 1;
      if (attempts < 10) {
        retryTimer = setTimeout(tryScroll, 200);
      } else {
        // 포기 — 펄스만 짧게 해제 (사용자에게 "찾으려 했음" 시각 리테이크 잔존).
        clearTimer = setTimeout(() => setFocusedCommentId(null), 200);
      }
    };

    retryTimer = setTimeout(tryScroll, 100);
    return () => {
      scrolled = true; // 후속 retryTimer 콜백 차단
      if (retryTimer) clearTimeout(retryTimer);
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, [focusCommentId]);

  // v1.24.0: focusCommentId 가 답글이면 부모 댓글 펼침 보장. comments 가 늦게 도착해도 처리.
  useEffect(() => {
    if (!focusCommentId) return;
    const target = comments.find((c) => c.id === focusCommentId);
    if (target?.parentCommentId) {
      const replyFocusThread = buildCommentReplyTarget(comments, target);
      const threadRootId = replyFocusThread.parentCommentId;
      if (!threadRootId) return;
      setThreadMentionTarget(null);
      setActiveThreadRootId(threadRootId);
      setLastThreadRootId(threadRootId);
      setCollapsedThreads((prev) => {
        if (!prev.has(threadRootId)) return prev;
        const next = new Set(prev);
        next.delete(threadRootId);
        return next;
      });
    }
  }, [focusCommentId, comments]);

  // v1.24.0: 답글 모드 진입 시 입력창에 부모 작성자 자동 멘션 프리셋.
  // P1 #6 fix: 비어있을 때만 prefix 추가 + *기존 입력이 다른 답글 prefix(@xxx )로 시작*하면 prefix 만 교체.
  //   이전 코드는 사용자가 답글 버튼 누른 직후 다른 답글 버튼 누르면 첫 prefix 가 stale 하게 남았음.
  useEffect(() => {
    if (!replyTarget) return;
    const replyInputThreadTarget = buildCommentReplyTarget(comments, replyTarget);
    if (replyInputThreadTarget.isReplyToReply) {
      setInput((prev) => (/^@\S+\s*$/.test(prev.trimStart()) ? '' : prev));
      inputRef.current?.focus();
      return;
    }
    if (currentUser && replyTarget.userName === currentUser.name) return;
    const newPrefix = `@${replyTarget.userName} `;
    setInput((prev) => {
      const trimmed = prev.trimStart();
      if (trimmed.length === 0) return newPrefix;
      // 기존 prefix(@xxx ) 가 다른 사용자면 교체. 같은 사용자면 그대로.
      const existingMentionMatch = trimmed.match(/^@(\S+)\s/);
      if (existingMentionMatch) {
        if (existingMentionMatch[1] === replyTarget.userName) return prev;
        return newPrefix + trimmed.slice(existingMentionMatch[0].length);
      }
      // 사용자가 일반 텍스트 작성 중이면 건드리지 않음.
      return prev;
    });
    inputRef.current?.focus();
  }, [replyTarget, comments]); // eslint-disable-line react-hooks/exhaustive-deps

  // v1.24.0: 라이트박스 키보드 — Escape 닫기 + ArrowLeft/Right 로 한 댓글 내 이미지 이동.
  // stopPropagation 으로 모달 prev/next (← →) 와 충돌 차단 — 라이트박스 활성 시 화살표는 *이미지만* 이동.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        lightboxStep(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        lightboxStep(1);
        return;
      }
    };
    // capture: true → 모달의 ArrowLeft/Right 핸들러보다 먼저 잡아 stopPropagation 으로 모달 prev/next 차단.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightbox, closeLightbox, lightboxStep]);

  // Codex P2(2026-04-29): cleanup + in-flight 롤백 정확도를 위한 latest 값 ref 추적.
  // 빈 deps 의 cleanup 은 초기 렌더 값만 capture 하므로 ref 가 필수.
  const attachedImagesRef = useRef<AttachedImage[]>([]);
  useEffect(() => { attachedImagesRef.current = attachedImages; }, [attachedImages]);
  useEffect(() => { threadAttachedImagesRef.current = threadAttachedImages; }, [threadAttachedImages]);
  const inputValueRef = useRef('');
  useEffect(() => { inputValueRef.current = input; }, [input]);

  // 3단계: @멘션 자동완성 공통 훅(caret 기반 중간 멘션 + DOM 직접 읽기)
  const mention = useMentionAutocomplete({
    onChange: (next) => { setInput(next); inputValueRef.current = next; },
    users,
    inputRef,
  });
  // 4c: #태그 자동완성 — @멘션 옆에 나란히 공존(EntityAwareInput 패턴). users 불필요(episodes 자체 구독).
  const hash = useHashtagAutocomplete({
    onChange: (next) => { setInput(next); inputValueRef.current = next; },
    inputRef,
  });
  // 답글 진입(replyTarget 설정) 시 멘션·태그 드롭다운 닫기 — 답글 프리셋 setInput+focus 가 stale 드롭다운을 남기지 않게.
  useEffect(() => {
    if (replyTarget) { mention.close(); hash.close(); }
  }, [replyTarget, mention.close, hash.close]);
  // Codex P2 8차(2026-04-29): unmount 후 upload 완료 race 처리 — React 가 unmounted component 의 setState 를
  // drop 하므로 setAttachedImages updater 안의 side-effect (deleteImage) 도 실행 안 됨 → orphan.
  // mountedRef 로 unmount 여부를 직접 확인해 그 케이스에서 storage 즉시 정리.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 컴포넌트 언마운트 시 blob URL 정리.
  // Codex P2 5차(2026-04-29): unmount 시점에 attachedImages 에 남아있는 항목은 모두 *전송 안 된 draft* 다
  // (성공 시 setAttachedImages([]) 으로 비워지므로). 업로드 완료된 draft 의 uploadedUrl 도 storage 에서 삭제 →
  // "이미지 첨부 → 업로드 완료 → 패널 닫고 떠남" 같은 정상 사용자 행동에서 발생하던 storage leak 방지.
  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(a => {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
        if (a.uploadedUrl) {
          storageService.deleteImage(a.uploadedUrl).catch(err => {
            console.warn('[댓글 패널 unmount] draft Storage 정리 실패:', err);
          });
        }
      });
      cleanupDraftImages(threadAttachedImagesRef.current, '[스레드 댓글 패널 unmount]');
    };
  }, []);

  // ── 이미지 업로드 ──
  const uploadAttachedImage = useCallback(async (id: string, file: File | Blob) => {
    try {
      const base64 = await resizeBlob(file, 800, 0.8);
      const result = await storageService.uploadImage(sheetName, sceneId, 'comment', base64);
      if (result.ok && result.url) {
        const url = result.url;
        // Codex P2 8차(2026-04-29): unmount 후 upload 완료 시 React 가 setState drop → orphan.
        if (!mountedRef.current) {
          storageService.deleteImage(url).catch(err => {
            console.warn('[댓글 이미지 unmount race] 정리 실패:', err);
          });
          return;
        }
        // Codex P2 13차(2026-04-30): attachedImagesRef 가 useEffect 로 동기화되어 한 렌더 늦을 수 있어 race —
        // 사용자 X 클릭 직후 ref 가 stale 한 상태에서 도착한 upload 가 stillExists=true 로 인식되면
        // 이후 setAttachedImages.map 이 no-op 이 되어 uploadedUrl 이 어디에도 안 남고 orphan 발생.
        // 해결: setAttachedImages functional updater 안에서 latest prev 로 직접 검사 (React 가 latest state 보장).
        setAttachedImages(prev => {
          const exists = prev.some(a => a.id === id);
          if (!exists) {
            // 사용자 X 클릭으로 이미 제거 → 도착한 upload 객체 정리
            storageService.deleteImage(url).catch(err => {
              console.warn('[댓글 이미지 race] 사용자 제거 후 도착한 업로드 객체 정리 실패:', err);
            });
            return prev;
          }
          return prev.map(a =>
            a.id === id ? { ...a, uploadedUrl: url, uploading: false } : a
          );
        });
      } else {
        throw new Error(result.error || '업로드 실패');
      }
    } catch (err) {
      console.error('[댓글 이미지 업로드 실패]', err);
      if (!mountedRef.current) return;       // unmount 후 setState drop 방지
      const msg = err instanceof Error ? err.message : String(err);
      setAttachedImages(prev => prev.map(a =>
        a.id === id ? { ...a, uploading: false, error: msg } : a
      ));
    }
  }, [sheetName, sceneId]);

  const addAttachedImageFromBlob = useCallback((file: File | Blob) => {
    const id = createUuid();
    const previewUrl = URL.createObjectURL(file);
    setAttachedImages(prev => {
      if (!quickRevisionActive) return [...prev, { id, previewUrl, uploading: true }];

      prev.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
        if (item.uploadedUrl) {
          storageService.deleteImage(item.uploadedUrl).catch(err => {
            console.warn('[빠른 리테이크 첨부 교체] 이전 업로드 객체 정리 실패:', err);
          });
        }
      });
      return [{ id, previewUrl, uploading: true }];
    });
    void uploadAttachedImage(id, file);
  }, [quickRevisionActive, uploadAttachedImage]);

  const removeAttachedImage = (id: string) => {
    setAttachedImages(prev => {
      const target = prev.find(a => a.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      // Codex P2 4차(2026-04-29): 백그라운드 업로드가 이미 완료된 항목을 사용자가 X 로 제거하면
      // Storage 의 객체도 함께 삭제 (orphan 파일 방지). fire-and-forget — 실패해도 UI 흐름 안 막음.
      if (target?.uploadedUrl) {
        storageService.deleteImage(target.uploadedUrl).catch(err => {
          console.warn('[댓글 첨부 제거] Storage 삭제 실패:', err);
        });
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // 클립보드 paste
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(it => it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    (quickRevisionActive ? imageItems.slice(0, 1) : imageItems).forEach(it => {
      const f = it.getAsFile();
      if (f) addAttachedImageFromBlob(f);
    });
  };

  // 드래그 카운터 패턴 — 자식 위 이동 시 깜빡임 방지
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) setDraggingOver(true);
    }
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDraggingOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    (quickRevisionActive ? files.slice(0, 1) : files).forEach(addAttachedImageFromBlob);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    (quickRevisionActive ? files.slice(0, 1) : files).forEach(addAttachedImageFromBlob);
    e.target.value = '';
  };

  const uploadThreadAttachedImage = useCallback(async (id: string, file: File | Blob) => {
    try {
      const base64 = await resizeBlob(file, 800, 0.8);
      const result = await storageService.uploadImage(sheetName, sceneId, 'comment', base64);
      if (result.ok && result.url) {
        const url = result.url;
        if (!mountedRef.current) {
          storageService.deleteImage(url).catch(err => {
            console.warn('[스레드 댓글 이미지 unmount race] 정리 실패:', err);
          });
          return;
        }
        setThreadAttachedImages(prev => {
          const exists = prev.some(a => a.id === id);
          if (!exists) {
            storageService.deleteImage(url).catch(err => {
              console.warn('[스레드 댓글 이미지 race] 사용자 제거 후 도착한 업로드 객체 정리 실패:', err);
            });
            return prev;
          }
          return prev.map(a =>
            a.id === id ? { ...a, uploadedUrl: url, uploading: false } : a
          );
        });
      } else {
        throw new Error(result.error || '업로드 실패');
      }
    } catch (err) {
      console.error('[스레드 댓글 이미지 업로드 실패]', err);
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setThreadAttachedImages(prev => prev.map(a =>
        a.id === id ? { ...a, uploading: false, error: msg } : a
      ));
    }
  }, [sheetName, sceneId]);

  const addThreadAttachedImageFromBlob = useCallback((file: File | Blob) => {
    const id = createUuid();
    const previewUrl = URL.createObjectURL(file);
    setThreadAttachedImages(prev => [...prev, { id, previewUrl, uploading: true }]);
    void uploadThreadAttachedImage(id, file);
  }, [uploadThreadAttachedImage]);

  const removeThreadAttachedImage = (id: string) => {
    setThreadAttachedImages(prev => {
      const target = prev.find(a => a.id === id);
      cleanupDraftImages(target ? [target] : [], '[스레드 댓글 첨부 제거]');
      return prev.filter(a => a.id !== id);
    });
  };

  const handleThreadPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(it => it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    imageItems.forEach(it => {
      const f = it.getAsFile();
      if (f) addThreadAttachedImageFromBlob(f);
    });
  };

  const handleThreadDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(addThreadAttachedImageFromBlob);
  };

  const handleThreadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(addThreadAttachedImageFromBlob);
    e.target.value = '';
  };

  // ── 전송 ──
  const hasUploadingImage = attachedImages.some(a => a.uploading);
  const uploadedImageUrls = attachedImages.map(a => a.uploadedUrl).filter((u): u is string => !!u);
  const canSubmit = quickRevisionActive
    ? !submitting
      && !hasUploadingImage
      && quickRevisionDescription.length > 0
      && quickRevisionNotifyIds.length > 0
    : !submitting
      && !hasUploadingImage
      && (input.trim().length > 0 || uploadedImageUrls.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || !currentUser) return;
    if (quickRevisionActive && quickRevision) {
      setSubmitting(true);
      const prevAttached = attachedImages;
      const revisionImageUrl = uploadedImageUrls[0];
      const unusedUploadedImageUrls = uploadedImageUrls.slice(1);
      setAttachedImages([]);
      attachedImagesRef.current = [];
      try {
        await createRevision({
          sceneKey: quickRevision.sceneKey,
          description: quickRevisionDescription,
          imageUrl: revisionImageUrl,
          department: quickRevision.department,
          lookupDepartment: quickRevision.department,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          notifyUserIds: quickRevisionNotifyIds,
          assigneeIds: quickRevisionNotifyIds,
        });
        setInput('');
        inputValueRef.current = '';
        setQuickRevisionPickerOpen(false);
        mention.close();
        hash.close();
        setReplyTarget(null);
        prevAttached.forEach((item) => {
          try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
        });
        unusedUploadedImageUrls.forEach((url) => {
          storageService.deleteImage(url).catch(err => {
            console.warn('[빠른 리테이크 등록] 미사용 업로드 객체 정리 실패:', err);
          });
        });
        const targetNames = quickRevisionSelectedUsers.map((user) => user.name).join(', ');
        sonnerToast.success('리테이크를 등록했습니다', {
          description: targetNames ? `${targetNames}에게 알림을 보냈습니다.` : undefined,
          duration: 2200,
        });
      } catch (err) {
        console.error('[리테이크 빠른 등록 실패]', err);
        if (!mountedRef.current) {
          prevAttached.forEach((item) => {
            try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
            if (item.uploadedUrl) {
              storageService.deleteImage(item.uploadedUrl).catch(err2 => {
                console.warn('[리테이크 빠른 등록 실패 + unmount] storage 정리 실패:', err2);
              });
            }
          });
          return;
        }

        const userStartedNew = attachedImagesRef.current.length > 0;
        if (userStartedNew) {
          prevAttached.forEach((item) => {
            try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
            if (item.uploadedUrl) {
              storageService.deleteImage(item.uploadedUrl).catch(err2 => {
                console.warn('[리테이크 빠른 등록 실패 롤백] 버려진 업로드 객체 정리 실패:', err2);
              });
            }
          });
        } else {
          setAttachedImages(prevAttached);
          attachedImagesRef.current = prevAttached;
        }
        sonnerToast.error('리테이크 등록 실패', {
          description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);

    const replyThreadTarget = buildCommentReplyTarget(comments, replyTarget);
    const replyParent = replyThreadTarget.rootComment;
    const isReplyToReply = replyThreadTarget.isReplyToReply;

    const mentions = extractMentions(input, userNames);
    // v1.24.0: 답글이면 부모 작성자도 mentions 에 포함 (자동 멘션 — 슬랙 알림/멘션 알림 트리거).
    if (
      replyThreadTarget.replyToComment &&
      replyThreadTarget.replyToComment.userName !== currentUser.name &&
      !mentions.includes(replyThreadTarget.replyToComment.userName)
    ) {
      mentions.push(replyThreadTarget.replyToComment.userName);
    }
    // v1.24.0 코덱스 P1 fix (2026-05-10 round 2): 답글은 부모 댓글의 *진짜 storage sheet* 에 저장.
    //   _sourceKey 는 UI dedup 의 첫 발견 sceneKey 라 unified 뷰에서 *secondary 댓글이 primary key 로 stamp* 되는
    //   케이스가 있어 신뢰 불가. raw row 기반 storageKey (partId → sheetName + scene.no) 를 우선 사용.
    //   둘 다 없으면 (Sheets fallback 으로 partId 비어있음) primary sceneKey 로 fallback.
    const targetSceneKey =
      replyParent?.storageKey
      ?? replyParent?._sourceKey
      ?? replyTarget?.storageKey
      ?? replyTarget?._sourceKey
      ?? primaryStorageKey;
    const comment: SceneCommentWithSource = {
      id: createUuid(),
      userId: currentUser.id,
      userName: currentUser.name,
      text: input.trim(),
      mentions,
      images: uploadedImageUrls,
      createdAt: new Date().toISOString(),
      // Slack-style: 답글의 답글도 최상위 댓글 스레드 아래에 저장한다.
      parentCommentId: replyThreadTarget.parentCommentId,
      _sourceKey: targetSceneKey,
    };

    // 낙관적 UI
    const next = [...comments, comment];
    setComments(next);
    onCountChange?.(next.length);
    if (replyThreadTarget.parentCommentId) {
      setActiveThreadRootId(replyThreadTarget.parentCommentId);
      setLastThreadRootId(replyThreadTarget.parentCommentId);
      setCollapsedThreads((prev) => {
        if (!prev.has(replyThreadTarget.parentCommentId!)) return prev;
        const opened = new Set(prev);
        opened.delete(replyThreadTarget.parentCommentId!);
        return opened;
      });
    }

    // Codex P2(2026-04-29): blob URL revoke 와 attachedImages 초기화는 전송 성공 *후* 에 수행.
    // 실패 시 사용자가 같은 페이로드(텍스트 + 첨부)로 재시도할 수 있어야 새 이미지 첨부 흐름의 신뢰성이 보장된다.
    // Codex P1 6차(2026-04-29): ref sync useEffect 가 한 렌더 늦을 수 있어, setState 직후 unmount 가 일어나면
    // unmount cleanup 이 pre-submit 첨부물을 보고 in-flight 댓글의 이미지를 삭제하는 race 발생 가능.
    // setState 와 동시에 ref 도 즉시 동기화하여 cleanup 이 항상 최신 상태(빈 배열) 를 본다.
    const prevInput = input;
    const prevAttached = attachedImages;
    const prevReplyTarget = replyTarget;
    setInput('');
    inputValueRef.current = '';
    mention.close();
    hash.close();
    setAttachedImages([]);
    attachedImagesRef.current = [];
    // v1.24.0: 답글 전송 후 답글 모드 해제 (성공/실패 무관 — 실패 시 아래에서 복원).
    setReplyTarget(null);

    try {
      // v1.24.0: 답글이면 targetSceneKey (부모 sourceKey) 로 저장 → 부모/답글이 같은 sheet 에 모임.
      await addComment(targetSceneKey, comment);
      if (prevReplyTarget) {
        markUnreadCommentsRead();
      }

      // 성공 — 이전 미리보기 blob URL revoke (메모리 정리)
      prevAttached.forEach(a => {
        try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
      });

      // 슬랙 멘션 웹훅 (기존 로직 보존) — 캐릭터 댓글은 씬 deeplink 가 없으므로 스킵.
      if (!characterCommentKey && mentions.length > 0 && currentUser.slackId) {
        const parts = sheetName.match(/^EP(\d+)_([A-Z])_/);
        const epLabel = parts ? `EP.${parts[1].padStart(2, '0')}` : sheetName;
        const partLabel = parts ? `${parts[2]}파트` : '';
        for (const mentionedName of mentions) {
          const target = users.find(u => u.name === mentionedName);
          if (target?.slackId && target.slackId !== currentUser.slackId) {
            sendMentionWebhook({
              commentText: comment.text,
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
      console.error('[댓글 추가 실패]', err);

      // Codex P2 9차(2026-04-29): addComment 실패 + panel 이 그 동안 unmount 된 케이스 (slow request 중 close).
      // setState 가 unmounted component 에서 drop 되어 prevAttached 의 uploadedUrl 정리 안 됨 → orphan.
      // mountedRef 체크 후 state 복원 대신 storage 직접 정리.
      if (!mountedRef.current) {
        prevAttached.forEach(a => {
          try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
          if (a.uploadedUrl) {
            storageService.deleteImage(a.uploadedUrl).catch(err2 => {
              console.warn('[댓글 전송 실패 + unmount] storage 정리 실패:', err2);
            });
          }
        });
        return;
      }

      // 롤백 — 댓글 리스트는 항상 복원.
      setComments(comments);
      onCountChange?.(comments.length);

      // Codex P2 4차(2026-04-29): in-flight 동안 사용자가 새 텍스트 *또는* 새 이미지 첨부를 시작했는지
      // 두 ref 로 함께 확인. 둘 중 하나라도 새 작업이 있으면 prev 복원하면 stale draft 와 섞임 → 덮어쓰지 않고
      // prev blob URL 만 revoke 해 leak 방지. 새 작업이 전혀 없을 때만 prev 복원해 단순 재시도.
      const userStartedNew =
        inputValueRef.current.length > 0 || attachedImagesRef.current.length > 0;
      if (userStartedNew) {
        // Codex P2 7차(2026-04-29): 사용자가 새 드래프트 시작했고 prev 를 버리는 분기 →
        // previewUrl 뿐 아니라 *이미 업로드 완료된* uploadedUrl 도 storage 에서 삭제 (orphan 방지).
        prevAttached.forEach(a => {
          try { URL.revokeObjectURL(a.previewUrl); } catch { /* ignore */ }
          if (a.uploadedUrl) {
            storageService.deleteImage(a.uploadedUrl).catch(err => {
              console.warn('[댓글 전송 실패 롤백] 버려진 업로드 객체 정리 실패:', err);
            });
          }
        });
      } else {
        setInput(prevInput);
        setAttachedImages(prevAttached);
        // v1.24.0: 답글 전송 실패 시 답글 모드도 복원해 사용자가 그대로 재시도 가능.
        if (prevReplyTarget) setReplyTarget(prevReplyTarget);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 댓글 수정 (낙관적) — 이미지는 기존 그대로 유지 (수정은 텍스트만).
  // Codex P1(2026-04-29): target.images 가 undefined (Sheets fallback) 면 그대로 undefined 전달 →
  // updateComment 가 supabase update payload 에서 images 컬럼을 제외해 실 이미지 URL 들이 보존된다.
  const handleEdit = async (commentId: string) => {
    if (!editText.trim()) return;
    const target = comments.find((c) => c.id === commentId);
    const targetKey = target?.storageKey ?? target?._sourceKey ?? primaryStorageKey;
    const mentions = extractMentions(editText, userNames);
    const existingImages = target?.images;
    const prevComments = [...comments];

    setComments(prev =>
      prev.map(c =>
        c.id === commentId
          ? { ...c, text: editText.trim(), mentions, editedAt: new Date().toISOString() }
          : c
      )
    );
    setEditingId(null);

    try {
      await updateComment(targetKey, commentId, editText.trim(), mentions, existingImages);
    } catch (err) {
      console.error('[댓글 수정 실패]', err);
      setComments(prevComments);
    }
  };

  // 댓글 삭제 (낙관적)
  const handleDelete = async (commentId: string) => {
    const target = comments.find((c) => c.id === commentId);
    const targetKey = target?.storageKey ?? target?._sourceKey ?? primaryStorageKey;
    const prevComments = [...comments];
    const next = comments.filter(c => c.id !== commentId);

    setComments(next);
    onCountChange?.(next.length);

    try {
      await deleteComment(targetKey, commentId);
    } catch (err) {
      console.error('[댓글 삭제 실패]', err);
      setComments(prevComments);
      onCountChange?.(prevComments.length);
    }
  };

  // @멘션 등 엔티티 자동완성은 useMentionAutocomplete 가 담당. 여기선 입력값만 반영(자라기는 useLayoutEffect).
  const handleInputChange = (text: string) => {
    setInput(text);
  };

  // v1.18.0: re만 필터 — 토글 켜져 있으면 revisionId 있는 댓글만 노출.
  const visibleComments = useMemo(
    () => (reOnly ? comments.filter((c) => !!c.revisionId) : comments),
    [comments, reOnly],
  );
  const visibleInlineEvents = useMemo(
    () => hideActivity ? [] : reOnly ? (inlineEvents ?? []).filter(isRetakeInlineEvent) : (inlineEvents ?? []),
    [hideActivity, inlineEvents, reOnly],
  );

  // v1.24.0: 메인 흐름은 부모 댓글만(parentCommentId 없음). 답글은 별도 그룹.
  const topLevelComments = useMemo(
    () => visibleComments.filter((c) => !c.parentCommentId),
    [visibleComments],
  );

  /**
   * v1.24.0: parentCommentId 별 답글 그룹. 시간 오름차순 정렬.
   * 부모 댓글이 visibleComments 에 없으면 (re만 토글 등) 답글도 메인 흐름에 표시 (orphan 방지).
   */
  const repliesByParent = useMemo(() => {
    const map = new Map<string, SceneCommentWithSource[]>();
    const topIds = new Set(topLevelComments.map((c) => c.id));
    for (const c of visibleComments) {
      if (!c.parentCommentId) continue;
      if (!topIds.has(c.parentCommentId)) continue; // orphan — 메인 흐름으로 떨어뜨림
      const arr = map.get(c.parentCommentId) ?? [];
      arr.push(c);
      map.set(c.parentCommentId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return map;
  }, [visibleComments, topLevelComments]);

  const activeThreadRoot = useMemo(
    () => activeThreadRootId ? comments.find((c) => c.id === activeThreadRootId) ?? null : null,
    [activeThreadRootId, comments],
  );
  const activeRevisionThread = useMemo(
    () => activeRevisionThreadId ? revisions.find((r) => r.id === activeRevisionThreadId) ?? null : null,
    [activeRevisionThreadId, revisions],
  );
  const activeRevisionThreadEvent = useMemo(
    () => activeRevisionThreadId
      ? [...(inlineEvents ?? [])]
        .filter((event) => event.revisionId === activeRevisionThreadId)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0] ?? null
      : null,
    [activeRevisionThreadId, inlineEvents],
  );
  const activeThreadOpen = activeThreadRoot != null || activeRevisionThreadId != null;
  useEffect(() => {
    onThreadPanelOpenChange?.(activeThreadOpen);
  }, [activeThreadOpen, onThreadPanelOpenChange]);
  const activeThreadReplies = useMemo(
    () => activeThreadRoot
      ? comments
        .filter((c) => c.parentCommentId === activeThreadRoot.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      : [],
    [activeThreadRoot, comments],
  );
  const activeThreadMessages = useMemo(
    () => activeThreadRoot ? [activeThreadRoot, ...activeThreadReplies] : [],
    [activeThreadRoot, activeThreadReplies],
  );
  const activeRevisionThreadComments = useMemo(
    () => activeRevisionThreadId
      ? comments
        .filter((c) => c.revisionId === activeRevisionThreadId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      : [],
    [activeRevisionThreadId, comments],
  );
  const activeRevisionThreadAvailable = !activeRevisionThreadId || !!activeRevisionThread;
  const threadHasUploadingImage = threadAttachedImages.some(a => a.uploading);
  const threadUploadedImageUrls = threadAttachedImages.map(a => a.uploadedUrl).filter((u): u is string => !!u);
  const canSubmitThread =
    activeThreadOpen
    && activeRevisionThreadAvailable
    && !!currentUser
    && !threadSubmitting
    && !threadHasUploadingImage
    && (threadInput.trim().length > 0 || threadUploadedImageUrls.length > 0);
  const handleThreadSubmit = async () => {
    if (!canSubmitThread || !currentUser || (!activeThreadRoot && !activeRevisionThreadId)) return;

    const threadRoot = activeThreadRoot;
    const revisionThreadId = activeRevisionThreadId;
    const panelSceneKey = sceneKey;
    const text = threadInput.trim();
    const submittedThreadAttached = threadAttachedImages;
    const submittedThreadImageUrls = threadUploadedImageUrls;
    const targetSceneKey = threadRoot?.storageKey ?? threadRoot?._sourceKey ?? primaryStorageKey;
    const mentions = extractMentions(text, userNames);
    const threadMentionReplyTarget = buildCommentReplyTarget(comments, threadMentionTarget);
    const threadMentionTargetInCurrentThread =
      revisionThreadId
        ? threadMentionTarget?.revisionId === revisionThreadId
        : threadMentionTarget?.id === threadRoot?.id || threadMentionReplyTarget.parentCommentId === threadRoot?.id;
    const mentionTargetName = threadMentionTargetInCurrentThread
      ? threadMentionTarget!.userName
      : revisionThreadId
        ? activeRevisionThread?.requesterName ?? threadMentionTarget?.userName ?? currentUser.name
        : threadRoot!.userName;
    if (mentionTargetName !== currentUser.name && !mentions.includes(mentionTargetName)) {
      mentions.push(mentionTargetName);
    }
    const comment: SceneCommentWithSource = {
      id: createUuid(),
      userId: currentUser.id,
      userName: currentUser.name,
      text,
      mentions,
      images: submittedThreadImageUrls,
      createdAt: new Date().toISOString(),
      revisionId: activeRevisionThreadId ?? threadRoot?.revisionId ?? null,
      parentCommentId: activeRevisionThreadId ? null : threadRoot!.id,
      _sourceKey: targetSceneKey,
    };

    const next = [...comments, comment];
    const submitRequestId = comment.id;
    try {
      setThreadSubmitting(true);
      threadSubmitRequestRef.current = submitRequestId;
      setComments(next);
      onCountChange?.(next.length);
      if (threadRoot) {
        setLastThreadRootId(threadRoot.id);
        setCollapsedThreads((prev) => {
          if (!prev.has(threadRoot.id)) return prev;
          const opened = new Set(prev);
          opened.delete(threadRoot.id);
          return opened;
        });
      }
      setThreadInput('');
      threadInputValueRef.current = '';
      setThreadAttachedImages([]);
      threadAttachedImagesRef.current = [];

      await addComment(targetSceneKey, comment);
      markUnreadCommentsRead();
      setThreadMentionTarget((current) => current?.id === threadMentionTarget?.id ? null : current);
      submittedThreadAttached.forEach((item) => {
        try { URL.revokeObjectURL(item.previewUrl); } catch { /* ignore */ }
      });

      // 캐릭터 스레드 답글은 씬 deeplink 가 없으므로 슬랙 웹훅 스킵(상위 작성 경로와 동일 가드).
      if (!characterCommentKey && mentions.length > 0 && currentUser.slackId) {
        const { sheetName: threadSheetName, sceneId: threadSceneId } = parseSceneKey(targetSceneKey);
        const parts = threadSheetName.match(/^EP(\d+)_([A-Z])_/);
        const epLabel = parts ? `EP.${parts[1].padStart(2, '0')}` : threadSheetName;
        const partLabel = parts ? `${parts[2]}파트` : '';
        for (const mentionedName of mentions) {
          const target = users.find(u => u.name === mentionedName);
          if (target?.slackId && target.slackId !== currentUser.slackId) {
            sendMentionWebhook({
              commentText: comment.text,
              episodeLabel: epLabel,
              sceneId: threadSceneId,
              partLabel,
              sheetName: threadSheetName,
              authorSlackId: currentUser.slackId,
              targetSlackId: target.slackId,
            });
          }
        }
      }
    } catch (err) {
      console.error('[스레드 댓글 추가 실패]', err);
      const cleanupSubmittedThreadDraft = () => cleanupDraftImages(submittedThreadAttached, '[스레드 댓글 전송 실패]');
      if (!mountedRef.current || sceneKeyRef.current !== panelSceneKey) {
        cleanupSubmittedThreadDraft();
        return;
      }
      setComments((current) => {
        const withoutFailedComment = current.filter((c) => c.id !== comment.id);
        if (withoutFailedComment.length !== current.length) {
          onCountChange?.(withoutFailedComment.length);
        }
        return withoutFailedComment;
      });
      const canRestoreThreadDraft =
        (
          revisionThreadId
            ? activeRevisionThreadIdRef.current === revisionThreadId
            : activeThreadRootIdRef.current === threadRoot?.id
        )
        && threadInputValueRef.current.length === 0
        && threadAttachedImagesRef.current.length === 0;
      if (canRestoreThreadDraft) {
        setThreadInput(text);
        threadInputValueRef.current = text;
        setThreadAttachedImages(submittedThreadAttached);
        threadAttachedImagesRef.current = submittedThreadAttached;
      } else {
        cleanupSubmittedThreadDraft();
      }
    } finally {
      if (
        mountedRef.current
        && (threadSubmitRequestRef.current === submitRequestId || threadSubmitRequestRef.current == null)
      ) {
        setThreadSubmitting(false);
        if (threadSubmitRequestRef.current === submitRequestId) {
          threadSubmitRequestRef.current = null;
        }
      }
    }
  };
  const canReopenLastThread = !!lastThreadRootId && !activeThreadRoot && comments.some((c) => c.id === lastThreadRootId);

  /** orphan 답글 — 부모가 visibleComments 에 없는 답글. 메인 흐름에 일반 댓글로 노출. */
  const orphanReplies = useMemo(() => {
    const topIds = new Set(topLevelComments.map((c) => c.id));
    return visibleComments.filter(
      (c) => !!c.parentCommentId && !topIds.has(c.parentCommentId),
    );
  }, [visibleComments, topLevelComments]);

  /** 메인 흐름 = topLevel + orphan replies. 시간순 정렬은 mergeFeed 가 처리. */
  const mainFlowComments = useMemo(
    () => [...topLevelComments, ...orphanReplies].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    [topLevelComments, orphanReplies],
  );

  const orderedVisibleComments = useMemo(
    () => [...visibleComments].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    [visibleComments],
  );
  const mainFeedNodes = useMemo(
    () => mergeFeed(mainFlowComments, visibleInlineEvents),
    [mainFlowComments, visibleInlineEvents],
  );

  const firstUnreadCommentId = useMemo(() => {
    if (!currentUser?.id || !hasUnreadComments) return null;
    const readMs = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;

    for (const comment of orderedVisibleComments) {
      if (comment.userId === currentUser.id) continue;
      const createdMs = Date.parse(comment.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      if (createdMs > readMs) return comment.id;
    }

    return null;
  }, [currentUser?.id, hasUnreadComments, lastReadAt, orderedVisibleComments]);

  useEffect(() => {
    if (!firstUnreadCommentId) return;
    const target = comments.find((comment) => comment.id === firstUnreadCommentId);
    if (target?.parentCommentId) {
      const unreadThread = buildCommentReplyTarget(comments, target);
      const threadRootId = unreadThread.parentCommentId;
      if (!threadRootId) return;
      setCollapsedThreads((prev) => {
        if (!prev.has(threadRootId)) return prev;
        const next = new Set(prev);
        next.delete(threadRootId);
        return next;
      });
    }
  }, [firstUnreadCommentId, comments]);

  // 새 댓글 시 스크롤. 읽지 않은 댓글이 있으면 구분선으로 먼저 이동한다.
  useEffect(() => {
    if (firstUnreadCommentId) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    // Codex R3 P2 (2026-05-03): inlineEvents 도 watch — system 활동만 도착해도 스크롤 따라가게.
  }, [comments.length, inlineEvents?.length, firstUnreadCommentId]);

  useEffect(() => {
    if (!firstUnreadCommentId || !unreadDividerElement) return;
    const timer = setTimeout(() => {
      unreadDividerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [firstUnreadCommentId, unreadDividerElement]);

  useEffect(() => {
    if (!firstUnreadCommentId || !latestOtherUserCommentAt || !unreadDividerElement) return;
    const anchor = unreadDividerElement;
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        markUnreadCommentsRead();
        observer.disconnect();
      }
    }, { root, threshold: 0.6 });

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [firstUnreadCommentId, latestOtherUserCommentAt, markUnreadCommentsRead, unreadDividerElement]);

  const handleMentionClick = (userName: string) => {
    setHighlightUserName(userName);
    setView('team');
  };

  const activeThreadPanelKey = activeRevisionThreadId
    ? `revision:${activeRevisionThreadId}`
    : activeThreadRoot?.id ?? 'thread';
  const activeRevisionThreadLabel = activeRevisionThread
    ? revisionNoToLabel(activeRevisionThread.revisionNo)
    : activeRevisionThreadEvent?.label ?? '리테이크';
  const activeRevisionThreadDescription =
    activeRevisionThread?.description
    ?? activeRevisionThreadEvent?.text
    ?? '리테이크 내용을 불러오는 중입니다.';
  const activeRevisionThreadRequester =
    activeRevisionThread?.requesterName
    ?? activeRevisionThreadEvent?.text.split(' ')[0]
    ?? '리테이크';
  const activeThreadMessagesForPanel = activeRevisionThreadId ? activeRevisionThreadComments : activeThreadMessages;

  // 4c: 댓글 본문 #태그 칩 클릭/우클릭 → 해당 씬/파트/화로 점프 또는 메뉴.
  const renderText = (text: string, _sourceKey?: string) => (
    <EntityText text={text} userNames={userNames} onMentionClick={handleMentionClick} onHashClick={onHashClick ?? navigateToHashTarget} onHashContextMenu={onHashContextMenu} />
  );

  // ─── 렌더링 ────────────────────────────────

  return (
    <div
      ref={panelRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // v1.23.4 (#2 진짜 root cause): h-full 만으로는 부모 column flex 안에서 의도된 height 차지 못함
      //   → 부모(모달 패널) 가 column flex 인데 헤더 외 두 번째 자식인 CommentPanel 이 flex-1 없으면
      //     CommentPanel 의 h-full = 100% of parent (부모 전체 height) → 헤더 자리만큼 overflow.
      //   flex-1 + min-h-0 으로 변경: 부모의 남은 공간 정확히 차지 + 자식들이 자체 scroll 가능.
      //   h-full 도 같이 두어 부모가 column flex 가 아닌 경우(legacy)에도 작동.
      className="flex h-full flex-1 min-h-0 relative overflow-visible"
    >
      <div className="flex min-w-0 flex-1 flex-col h-full">
      {/* v1.18.0: 상단 미니 툴바 — "re만" 필터 토글 (한솔 결정 spec 2026-05-03).
          v1.23.4 (#3 한솔): "활동 감추기" 토글 추가 — 시스템 활동(단계 변경 등) 숨기고 댓글만 표시. */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-end gap-1 shrink-0">
        {canReopenLastThread && (
          <button
            type="button"
            onClick={() => {
              setThreadMentionTarget(null);
              setActiveRevisionThreadId(null);
              setActiveThreadRootId(lastThreadRootId);
            }}
            title="마지막으로 보던 스레드 다시 열기"
            className="text-[10px] px-2 py-1 rounded transition-colors cursor-pointer font-bold text-text-secondary hover:text-text-primary hover:bg-bg-primary/50"
          >
            스레드 다시 열기
          </button>
        )}
        <button
          type="button"
          onClick={toggleHideActivity}
          title={hideActivity ? '활동 숨기는 중 — 클릭해 다시 표시' : '시스템 활동(단계 변경 등) 숨기고 댓글만 보기'}
          className={cn(
            'text-[10px] px-2 py-1 rounded transition-colors cursor-pointer font-bold',
            hideActivity
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50',
          )}
        >
          활동 감추기
        </button>
        <button
          type="button"
          onClick={() => setReOnly((v) => !v)}
          title={reOnly ? '리테이크 댓글만 표시중 — 클릭해 전체 보기' : '리테이크 댓글만 보기'}
          className={cn(
            'text-[10px] px-2 py-1 rounded transition-colors cursor-pointer font-bold',
            reOnly
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/50',
          )}
        >
          re만
        </button>
      </div>

      {/* 댓글 목록 — 시스템 이벤트(inlineEvents)와 시간순 머지 + 새 항목 슬라이드 인 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0 select-text">
        {/* 코덱스 P3 fix (9차, 2026-05-05): reOnly 시 inlineEvents 는 어차피 mergeFeed 에서 drop 되므로
            empty-state 판정에서도 inlineEvents 무시 → 리테이크 댓글 0 + inline 만 있을 때 빈 영역 방지. */}
        {visibleComments.length === 0 && visibleInlineEvents.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-text-secondary text-xs">
              {reOnly ? '리테이크 댓글이 없습니다' : '아직 의견이 없습니다'}
            </p>
            <p className="text-text-secondary/40 text-[11px] mt-1">
              {reOnly ? '"re만" 토글을 끄면 일반 댓글이 보입니다' : '첫 의견을 남겨보세요'}
            </p>
          </div>
        ) : (
        <AnimatePresence initial={false}>
          {(() => {
            let prevUserId: string | null = null;
            let prevRevisionId: string | null = null;
            return mainFeedNodes.map((node) => {
              if (node.kind === 'event') {
                // v1.24.0: 시스템 활동이 끼어들면 묶음 끊김 (확정 규칙).
                prevUserId = null;
                prevRevisionId = null;
                const isRevisionEvent = isRetakeInlineEvent(node.event);
                const eventToneClass =
                  node.event.tone === 'revision_resolve'
                    ? 'comment-inline-event comment-inline-event-resolve'
                    : node.event.tone === 'revision_in_progress'
                      ? 'comment-inline-event comment-inline-event-in-progress'
                      : node.event.tone === 'revision_add'
                        ? 'comment-inline-event comment-inline-event-add'
                        : node.event.tone === 'revision_delete'
                          ? 'comment-inline-event comment-inline-event-delete'
                          : node.event.tone === 'revision_update'
                            ? 'comment-inline-event comment-inline-event-update'
                            : 'text-text-secondary/55';
                const eventDotClass =
                  node.event.tone === 'revision_resolve'
                    ? 'comment-inline-event-dot comment-inline-event-dot-resolve'
                    : node.event.tone === 'revision_in_progress'
                      ? 'comment-inline-event-dot comment-inline-event-dot-in-progress'
                      : node.event.tone === 'revision_add'
                        ? 'comment-inline-event-dot comment-inline-event-dot-add'
                        : node.event.tone === 'revision_delete'
                          ? 'comment-inline-event-dot comment-inline-event-dot-delete'
                          : node.event.tone === 'revision_update'
                            ? 'comment-inline-event-dot comment-inline-event-dot-update'
                            : 'bg-text-secondary/40';
                const canOpenRevision = revisionExists(node.event.revisionId) && node.event.revisionAction !== 'delete';
                return (
                  <motion.div
                    key={`evt:${node.event.id}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      'flex items-center gap-2 text-[10.5px] py-0.5',
                      isRevisionEvent
                        ? 'rounded-lg border px-2.5 py-2 shadow-[0_10px_26px_rgba(0,0,0,0.18)]'
                        : '',
                      eventToneClass,
                    )}
                  >
                    {isRevisionEvent ? (
                      <div className="min-w-0 flex-1">
                        <div className="comment-inline-event-time mb-1 text-[10px] tabular-nums">
                          {formatCommentTime(node.event.at)}
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', eventDotClass)} aria-hidden />
                          {node.event.label && (
                            <span className="comment-inline-event-label shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold">
                              {node.event.label}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">{node.event.text}</span>
                        </div>
                        {canOpenRevision && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openRevisionDetail(node.event.revisionId)}
                              className="rounded-md border border-bg-border/70 bg-bg-primary/40 px-2 py-1 text-[10px] font-semibold text-text-secondary hover:border-accent/45 hover:text-accent-sub transition-colors"
                            >
                              상세모달에서 열기
                            </button>
                            <button
                              type="button"
                              onClick={() => openRevisionThread(node.event.revisionId)}
                              className="rounded-md border border-bg-border/70 bg-bg-primary/40 px-2 py-1 text-[10px] font-semibold text-text-secondary hover:border-accent/45 hover:text-accent-sub transition-colors"
                            >
                              댓글에서 열기
                            </button>
                            <button
                              type="button"
                              onClick={() => openRevisionThread(node.event.revisionId, true)}
                              className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent/[0.08] px-2 py-1 text-[10px] font-semibold text-accent-sub hover:bg-accent/[0.14] transition-colors"
                            >
                              <Reply size={10} />
                              답글
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', eventDotClass)} aria-hidden />
                        <span className="flex-1 truncate">{node.event.text}</span>
                        <span className="tabular-nums shrink-0">{formatCommentTime(node.event.at)}</span>
                      </>
                    )}
                  </motion.div>
                );
              }
              const comment = node.comment;
              const commentRevisionId = comment.revisionId ?? null;
              // v1.24.0: 묶음 — 같은 사용자가 연속이면 메타 숨김 (Slack 스타일).
              // 리테이크 댓글은 각각의 re# 맥락이 핵심이라 작성자가 같아도 묶지 않는다.
              const isGroupedWithPrev = prevUserId === comment.userId && !prevRevisionId && !commentRevisionId;
              prevUserId = comment.userId;
              prevRevisionId = commentRevisionId;
              const isOwn = currentUser?.id === comment.userId;
              const isEditing = editingId === comment.id;
              const hasImages = (comment.images?.length ?? 0) > 0;
              // 멘션 강조 — @나 가 mentions 에 들어있으면 좌측 4px accent 스트라이프 (한솔 결정 2026-05-02)
              const mentionsMe = !!currentUser && (comment.mentions ?? []).includes(currentUser.name);
              const isFocused = focusedCommentId === comment.id;
              const replies = repliesByParent.get(comment.id) ?? [];
              const threadCollapsed = collapsedThreads.has(comment.id);
              const isOrphanReply = !!comment.parentCommentId;
              const showUnreadDivider =
                firstUnreadCommentId != null
                && comment.id === firstUnreadCommentId;
              return (
              <Fragment key={comment.id}>
                {showUnreadDivider && (
                  <div
                    ref={setUnreadDividerNode}
                    className="flex items-center gap-2 py-1"
                    aria-label="새 댓글 시작"
                  >
                    <span className="h-px flex-1 bg-accent/30" />
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      새 댓글
                    </span>
                    <span className="h-px flex-1 bg-accent/30" />
                  </div>
                )}
              <motion.div
                key={comment.id}
                ref={(el) => { commentRefs.current.set(comment.id, el); }}
                onClick={markUnreadCommentsRead}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'group relative',
                  mentionsMe && 'pl-2',
                  isFocused && 'comment-target-pulse',
                  isGroupedWithPrev && 'comment-grouped-with-prev',
                )}
                style={mentionsMe ? { borderLeft: '4px solid rgb(var(--color-accent))', borderRadius: 4 } : undefined}
              >
                {/* 메타 — v1.24.0: 같은 사용자 연속 묶음일 땐 헤더 숨김 (시간만 호버 시 좌측). */}
                {!isGroupedWithPrev && (
                <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  {isOwn ? (
                    <>
                      <span className="text-[11px] text-text-secondary/50">
                        {formatCommentTime(comment.createdAt)}
                      </span>
                      <span className="text-xs font-semibold text-text-primary">
                        {comment.userName}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-semibold text-text-primary">
                        {comment.userName}
                      </span>
                      <span className="text-[11px] text-text-secondary/50">
                        {formatCommentTime(comment.createdAt)}
                      </span>
                    </>
                  )}
                  {/* v1.18.0: 리테이크 맥락 댓글은 [re#] 칩 → 클릭 시 모달이 리테이크 탭/카드로 점프 */}
                  {commentRevisionId && (
                    <RevisionCommentBadge
                      revisionId={commentRevisionId}
                      onJump={openRevisionDetail}
                    />
                  )}
                  {/* v1.24.0: orphan reply (부모 댓글 사라진 답글) 표시 */}
                  {isOrphanReply && (
                    <span className="text-[10px] text-text-secondary/50 inline-flex items-center gap-0.5" title="원댓글이 삭제된 답글">
                      <CornerDownRight size={10} />원답글
                    </span>
                  )}
                  {comment.editedAt && (
                    <span className="text-[11px] text-text-secondary/30 italic">수정됨</span>
                  )}
                </div>
                )}

                {/* 말풍선 */}
                <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] relative group/bubble">
                    {isEditing ? (
                      <div>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary resize-none focus:outline-none focus:border-accent min-w-[200px]"
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
                            className="px-2.5 py-1 text-[11px] text-text-secondary border border-bg-border rounded-md hover:bg-bg-border/50 transition-colors cursor-pointer"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => handleEdit(comment.id)}
                            className="px-2.5 py-1 text-[11px] text-white bg-accent rounded-md hover:bg-accent/80 transition-colors cursor-pointer"
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed break-words text-text-primary ${
                          isOwn ? 'bg-accent/20 border border-accent/30' : 'bg-bg-border/70'
                        }`}
                      >
                        {comment.text && <div>{renderText(comment.text, comment.storageKey ?? comment._sourceKey)}</div>}
                        {hasImages && (
                          <div
                            className={`grid gap-1 ${comment.text ? 'mt-2' : ''} ${
                              comment.images!.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                            }`}
                          >
                            {comment.images!.map((url, i) => (
                              <img
                                key={i}
                                src={url}
                                alt=""
                                className="rounded-md w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                style={{ maxHeight: 160 }}
                                onClick={() => openLightbox(url, comment)}
                                loading="lazy"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 수정/삭제 (자기 댓글만) + v1.24.0 답글 버튼 (모든 댓글) */}
                    {!isEditing && (
                      <div
                        className={cn(
                          'absolute top-0 flex gap-0.5 opacity-0 group-hover/bubble:opacity-100 transition-opacity',
                          isOwn ? '-left-20' : '-right-8',
                        )}
                      >
                        <button
                          onClick={() => openContextualThreadReply(comment)}
                          className="p-1 rounded hover:bg-bg-border/50 text-text-secondary hover:text-accent transition-colors cursor-pointer"
                          title="답글"
                        >
                          <Reply size={12} />
                        </button>
                        {isOwn && (
                          <>
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
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* v1.26.0: 이모지 리액션 — 부모 댓글 */}
                <div className={cn('mt-1 flex', isOwn ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] w-fit flex items-center gap-1.5', isOwn && 'flex-row-reverse')}>
                    <ReactionsArea
                      commentId={comment.id}
                      reactions={reactionsByCommentId.get(comment.id) ?? []}
                      currentUserId={currentUser?.id ?? null}
                      onToggle={handleReactionToggle}
                      pickerOpen={reactionPicker?.surface === 'main' && reactionPicker.commentId === comment.id}
                      onPickerOpen={() => setReactionPicker({ commentId: comment.id, surface: 'main' })}
                      onPickerClose={() => setReactionPicker(null)}
                    />
                    <ThreadReplyButton
                      aria-label={`답글 달기: ${comment.userName}`}
                      onClick={() => openContextualThreadReply(comment)}
                    />
                  </div>
                </div>

                {/* v1.24.0: 답글 스레드 — 부모 댓글 아래 인라인 들여쓰기 + 좌측 라인 + 토글 */}
                {replies.length > 0 && (
                  <div className="mt-1.5 ml-3 pl-3 border-l-2 border-accent/30 space-y-2">
                    <button
                      onClick={() => toggleThread(comment.id)}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-secondary hover:text-accent transition-colors"
                      title={threadCollapsed ? '답글 펼치기' : '답글 접기'}
                    >
                      {threadCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                      <span>답글 {replies.length}개 {threadCollapsed ? '펼치기' : '접기'}</span>
                    </button>
                    {!threadCollapsed && replies.map((reply, ri) => {
                      const replyIsOwn = currentUser?.id === reply.userId;
                      const replyIsEditing = editingId === reply.id;
                      const replyHasImages = (reply.images?.length ?? 0) > 0;
                      const replyMentionsMe = !!currentUser && (reply.mentions ?? []).includes(currentUser.name);
                      const replyIsFocused = focusedCommentId === reply.id;
                      const replyShowUnreadDivider =
                        firstUnreadCommentId != null
                        && reply.id === firstUnreadCommentId;
                      const replyRevisionId = reply.revisionId ?? commentRevisionId;
                      const prevReplyRevisionId = ri > 0 ? replies[ri - 1].revisionId ?? commentRevisionId : null;
                      // 답글 묶음 — 답글 내부에서도 같은 사용자 연속이면 메타 숨김.
                      // 리테이크 답글은 re# 표식이 사라지면 안 되므로 묶지 않는다.
                      const replyIsGrouped = ri > 0 && replies[ri - 1].userId === reply.userId && !prevReplyRevisionId && !replyRevisionId;
                      return (
                        <Fragment key={reply.id}>
                        {replyShowUnreadDivider && (
                          <div
                            ref={setUnreadDividerNode}
                            className="flex items-center gap-2 py-1"
                            aria-label="새 댓글 시작"
                          >
                            <span className="h-px flex-1 bg-accent/30" />
                            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                              새 댓글
                            </span>
                            <span className="h-px flex-1 bg-accent/30" />
                          </div>
                        )}
                        <div
                          ref={(el) => { commentRefs.current.set(reply.id, el); }}
                          onClick={markUnreadCommentsRead}
                          className={cn(
                            'group/reply relative',
                            replyMentionsMe && 'pl-1.5',
                            replyIsFocused && 'comment-target-pulse',
                            replyIsGrouped && 'comment-grouped-with-prev',
                          )}
                          style={replyMentionsMe ? { borderLeft: '3px solid rgb(var(--color-accent))', borderRadius: 3 } : undefined}
                        >
                          {!replyIsGrouped && (
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[11px] font-semibold text-text-primary">{reply.userName}</span>
                              <span className="text-[10px] text-text-secondary/50">{formatCommentTime(reply.createdAt)}</span>
                              {replyRevisionId && (
                                <RevisionCommentBadge
                                  revisionId={replyRevisionId}
                                  onJump={openRevisionDetail}
                                />
                              )}
                              {reply.editedAt && (
                                <span className="text-[10px] text-text-secondary/30 italic">수정됨</span>
                              )}
                            </div>
                          )}
                          <div className="relative group/replybubble">
                            {replyIsEditing ? (
                              <div>
                                <textarea
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  className="w-full bg-bg-primary border border-bg-border rounded-md px-2 py-1.5 text-[11.5px] text-text-primary resize-none focus:outline-none focus:border-accent"
                                  rows={2}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleEdit(reply.id);
                                    }
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                />
                                <div className="flex gap-2 mt-1 justify-end">
                                  <button
                                    onClick={() => setEditingId(null)}
                                    className="px-2 py-0.5 text-[10.5px] text-text-secondary border border-bg-border rounded hover:bg-bg-border/50 cursor-pointer"
                                  >취소</button>
                                  <button
                                    onClick={() => handleEdit(reply.id)}
                                    className="px-2 py-0.5 text-[10.5px] text-white bg-accent rounded hover:bg-accent/80 cursor-pointer"
                                  >저장</button>
                                </div>
                              </div>
                            ) : (
                              <div
                                className={`rounded-lg px-2.5 py-1.5 text-[11.5px] leading-relaxed break-words text-text-primary ${
                                  replyIsOwn ? 'bg-accent/15 border border-accent/25' : 'bg-bg-border/50'
                                }`}
                              >
                                {reply.text && <div>{renderText(reply.text, reply.storageKey ?? reply._sourceKey)}</div>}
                                {replyHasImages && (
                                  <div className={`grid gap-1 ${reply.text ? 'mt-1.5' : ''} ${reply.images!.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                    {reply.images!.map((url, i) => (
                                      <img
                                        key={i}
                                        src={url}
                                        alt=""
                                        className="rounded w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                        style={{ maxHeight: 120 }}
                                        onClick={() => openLightbox(url, reply)}
                                        loading="lazy"
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {!replyIsEditing && (
                              <div className={cn(
                                'absolute top-0 flex gap-0.5 opacity-0 group-hover/replybubble:opacity-100 transition-opacity',
                                replyIsOwn ? '-right-16' : '-right-7',
                              )}>
                                <button
                                  onClick={() => openContextualThreadReply(reply)}
                                  className="p-0.5 rounded hover:bg-bg-border/50 text-text-secondary hover:text-accent cursor-pointer"
                                  title="답글"
                                >
                                  <Reply size={11} />
                                </button>
                                {replyIsOwn && (
                                  <>
                                <button
                                  onClick={() => { setEditingId(reply.id); setEditText(reply.text); }}
                                  className="p-0.5 rounded hover:bg-bg-border/50 text-text-secondary hover:text-text-primary cursor-pointer"
                                  title="수정"
                                >
                                  <Pencil size={11} />
                                </button>
                                <button
                                  onClick={() => handleDelete(reply.id)}
                                  className="p-0.5 rounded hover:bg-status-none/20 text-text-secondary hover:text-status-none cursor-pointer"
                                  title="삭제"
                                >
                                  <Trash2 size={11} />
                                </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          {/* v1.26.0: 답글 리액션 영역 (compact) */}
                          <div className="flex items-center gap-1.5">
                            <ReactionsArea
                              commentId={reply.id}
                              reactions={reactionsByCommentId.get(reply.id) ?? []}
                              currentUserId={currentUser?.id ?? null}
                              onToggle={handleReactionToggle}
                              pickerOpen={reactionPicker?.surface === 'main' && reactionPicker.commentId === reply.id}
                              onPickerOpen={() => setReactionPicker({ commentId: reply.id, surface: 'main' })}
                              onPickerClose={() => setReactionPicker(null)}
                              compact
                            />
                            <ThreadReplyButton
                              compact
                              aria-label={`답글 달기: ${reply.userName}`}
                              onClick={() => openContextualThreadReply(reply)}
                            />
                          </div>
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </motion.div>
              </Fragment>
            );
            });
          })()}
        </AnimatePresence>
        )}
      </div>

      {/* 입력 영역 — 떠있는 카드 (위 댓글 영역과 시각적 분리)
          v1.23.2 (#3): shrink-0 명시 — 부모 column flex 안에서 압축 안 되도록 하되,
          반대로 자식 카드의 maxHeight cap (inputCardMaxPx) 으로 wrapper 가 넘쳐 grow 하는 것도 방지. */}
      <div className="px-3 pb-3 pt-3 relative shrink-0">
        {/* @멘션·#태그 자동완성 (멘션 우선) */}
        {mention.active ? (
          <MentionDropdown
            items={mention.items}
            index={mention.index}
            onPick={mention.select}
            positionClassName="left-3 right-3"
          />
        ) : hash.active ? (
          <HashtagDropdown
            items={hash.items}
            index={hash.index}
            onPick={hash.select}
            positionClassName="left-3 right-3"
          />
        ) : null}

        <AnimatePresence initial={false}>
          {quickRevisionActive && (
            <motion.div
              key="quick-revision-preview"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="mb-2 rounded-xl border border-accent/40 bg-accent/[0.08] shadow-lg overflow-visible"
              style={{ boxShadow: '0 16px 36px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.03)' }}
            >
              <div className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[12px] font-bold text-text-primary">
                      <span className="w-6 h-6 rounded-lg border border-accent/35 bg-accent/20 text-accent-sub inline-flex items-center justify-center shrink-0">
                        <MessageSquareWarning size={13} strokeWidth={2.4} />
                      </span>
                      리테이크 빠른 등록
                    </div>
                    <div className="mt-1 text-[12px] text-text-secondary/85 truncate">
                      {quickRevisionDescription || '내용을 입력하면 리테이크으로 등록됩니다'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuickRevisionPickerOpen((open) => !open)}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg border border-bg-border/70 bg-bg-primary/35 text-[11.5px] font-bold text-text-primary hover:border-accent/50 hover:bg-accent/[0.10] transition-colors cursor-pointer"
                  >
                    담당자 변경
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-text-secondary/80">알람 보낼 담당자</span>
                  {quickRevisionSelectedUsers.length > 0 ? quickRevisionSelectedUsers.map((user) => (
                    <span
                      key={user.id}
                      className="inline-flex items-center gap-1.5 h-6 rounded-full border border-accent/40 bg-accent/15 pl-1 pr-2 text-[11.5px] text-text-primary"
                    >
                      <span className="w-4 h-4 rounded-full bg-accent/80 text-white text-[9px] font-bold inline-flex items-center justify-center">
                        {user.name.charAt(0)}
                      </span>
                      {user.name}
                    </span>
                  )) : (
                    <span className="inline-flex items-center h-6 rounded-full border border-status-none/35 bg-status-none/10 px-2 text-[11.5px] text-status-none">
                      선택 필요
                    </span>
                  )}
                </div>

                {quickRevisionHasAttachments && (
                  <div className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-2 text-[11px] text-accent-sub">
                    첨부 이미지가 리테이크 이미지로 함께 등록됩니다.
                  </div>
                )}

                <div className={cn(
                  'rounded-lg border border-bg-border/50 bg-bg-primary/35 p-2',
                  quickRevisionPickerOpen ? 'block' : 'hidden',
                )}>
                  <RevisionRecipientPicker
                    allUsers={users}
                    defaultCheckedIds={quickRevisionDefaultRecipientIds}
                    excludeUserId={currentUser?.id || ''}
                    onChange={setQuickRevisionNotifyIds}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          onPaste={handlePaste}
          // v1.23.3 (#1 진짜 fix): flex-col + overflow-hidden — footer 항상 보이고 textarea 만 자체 scroll.
          className={`comment-input-card rounded-xl border px-2.5 pt-2 pb-1.5 flex flex-col overflow-hidden ${focused && !draggingOver ? 'focused' : ''} ${draggingOver ? 'dragover' : ''}`}
          style={{
            background: 'rgb(var(--comment-card-elev-rgb))',
            // 한솔 리테이크(2026-05-02): focus 시 accent-sub(보라)가 박혀서 "보라색 고정"으로 보임 → 중립 흰색 알파로 변경
            borderColor: draggingOver
              ? 'rgb(var(--color-accent))'
              : replyTarget
              ? 'rgba(108,92,231,0.6)' // v1.24.0: 답글 모드 시 보라 강조
              : (focused ? 'rgba(255,255,255,0.16)' : 'rgb(var(--color-bg-border))'),
            maxHeight: inputCardMaxPx,
          }}
        >
          {/* v1.24.0: 답글 컨텍스트 헤더 — 답글 모드일 때만 카드 상단에 노출 */}
          {replyTarget && (
            <div className="flex items-start gap-2 mb-2 px-2 py-1.5 -mx-2.5 -mt-2 border-b border-accent/30 bg-accent/[0.06] rounded-t-xl">
              <CornerDownRight size={12} className="text-accent mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[10.5px] text-accent font-medium">
                  {(replyDraftTarget.rootComment ?? replyTarget).userName}의 스레드에 댓글 추가
                </div>
                {replyDraftTarget.isReplyToReply && (
                  <div className="text-[10.5px] text-text-secondary/60 truncate mt-0.5">
                    선택한 메시지 · {replyTarget.userName}: {replyTarget.text || '(이미지 첨부)'}
                  </div>
                )}
                {!replyDraftTarget.isReplyToReply && (
                  <div className="text-[11px] text-text-secondary/70 truncate mt-0.5">{replyTarget.text || '(이미지 첨부)'}</div>
                )}
              </div>
              <button
                onClick={() => setReplyTarget(null)}
                className="w-5 h-5 rounded hover:bg-bg-border/50 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer flex-shrink-0"
                title="답글 취소"
              >
                <X size={11} />
              </button>
            </div>
          )}
          {/* 이미지 썸네일 줄 */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1" style={{ height: 76 }}>
              {attachedImages.map(img => (
                <div key={img.id} className="relative flex-shrink-0">
                  <img
                    src={img.previewUrl}
                    className="w-16 h-16 object-cover rounded-lg border border-bg-border"
                    alt=""
                  />
                  {img.uploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  {img.error && (
                    <div className="absolute inset-0 bg-red-500/40 rounded-lg flex items-center justify-center" title={`업로드 실패: ${img.error}`}>
                      <X size={20} className="text-white" />
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachedImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[11px] flex items-center justify-center hover:scale-110 transition-transform cursor-pointer"
                    style={{ border: '2px solid rgb(var(--comment-card-elev-rgb))' }}
                    title="제거"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {/* textarea — 풀 너비. wrapper 는 flex-col(입력카드의 flex item), textarea 가 그 안의 flex item 으로
              남은 공간을 차지하되 footer 보존(기존 동작 유지) + 4a-2 입력 하이라이트 미러를 뒤에 겹침. */}
          <div className="relative flex-1 min-h-0 flex flex-col">
            {/* 입력 중 @이름·경로·컷 파란 강조(미러). textarea 는 이미 bg-transparent 라 그대로 위에 보임. */}
            <EntityHighlightOverlay
              text={input}
              userNames={userNames}
              scrollTop={taScrollTop}
              className="block w-full px-2 py-1.5 text-xs leading-relaxed"
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { handleInputChange(e.target.value); mention.refresh(); hash.refresh(); }}
              // caret 이동은 onSelect/onClick 으로만 감지(onKeyUp 미사용 — Arrow/Escape preventDefault 로 index 리셋 방지).
              onClick={() => { mention.refresh(); hash.refresh(); }}
              onSelect={() => { mention.refresh(); hash.refresh(); }}
              onScroll={(e) => setTaScrollTop(e.currentTarget.scrollTop)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="댓글 입력... (Ctrl+V / 드래그로 이미지)"
              rows={1}
              className="comment-input-textarea relative block w-full flex-1 min-h-0 px-2 py-1.5 text-xs resize-none outline-none bg-transparent leading-relaxed text-text-primary placeholder:text-text-secondary/40 overflow-y-auto whitespace-pre-wrap break-words"
              style={{ height: taHeight, maxHeight: taMaxPx, boxSizing: 'border-box' }}
              onKeyDown={(e) => {
                if (mention.onKeyDown(e)) return;
                if (hash.onKeyDown(e)) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleFileChange}
          />
          {/* 하단 toolbar — 좌측 첨부, 우측 전송 (cowork 스타일). v1.23.3 (#1): shrink-0 명시 — 항상 보임 보장 */}
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-bg-border/40 shrink-0">
            <button
              onClick={() => {
                fileInputRef.current?.click();
              }}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-card hover:text-text-primary transition-colors cursor-pointer"
              title="이미지 첨부"
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-7 h-7 rounded-md flex items-center justify-center bg-accent hover:bg-accent-sub text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              title={
                quickRevisionActive
                  ? quickRevisionNotifyIds.length === 0
                      ? '알람 보낼 담당자를 선택해 주세요'
                      : '리테이크 등록 (Enter)'
                  : hasUploadingImage ? '이미지 업로드 중...' : '전송 (Enter)'
              }
            >
              {submitting ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ArrowUp size={14} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
      </div>

      <AnimatePresence initial={false}>
        {activeThreadOpen && (
          <Fragment key={activeThreadPanelKey}>
          <motion.div
            key={`${activeThreadPanelKey}:resize`}
            role="separator"
            aria-orientation="vertical"
            aria-label="댓글과 스레드 사이 경계로 너비 조절"
            title="드래그로 스레드 칸 너비 조절 · 더블클릭으로 기본 폭 복귀"
            data-no-lasso
            data-comment-thread-resize-handle
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onMouseEnter={() => onThreadResizeHoverChange?.(true)}
            onMouseLeave={() => onThreadResizeHoverChange?.(false)}
            onMouseDown={onThreadResizeMouseDown}
            onDoubleClick={onThreadResizeDoubleClick}
            className="relative flex h-full w-5 shrink-0 cursor-col-resize items-stretch justify-center"
          >
            <div
              className={cn(
                'my-3 w-px rounded-full transition-[background-color,box-shadow,opacity,transform] duration-150',
                threadResizeActive || threadResizeHover
                  ? 'bg-accent/80 opacity-100 shadow-[0_0_14px_rgba(108,92,231,0.45)] scale-x-[2]'
                  : 'bg-bg-border/85 opacity-45',
              )}
            />
          </motion.div>
          <motion.aside
            key={activeThreadPanelKey}
            data-comment-thread-side-panel
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-bg-border bg-bg-primary/55 shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
            style={{ width: threadWidth }}
          >
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-bg-border px-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">
                  {activeRevisionThreadId ? '리테이크 스레드' : '스레드'}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-text-secondary/70">
                  {activeRevisionThreadId
                    ? `${activeRevisionThreadLabel} · 댓글 ${activeRevisionThreadComments.length}개`
                    : `${activeThreadRoot?.userName ?? '댓글'} · 답글 ${activeThreadReplies.length}개`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (activeThreadRoot) setLastThreadRootId(activeThreadRoot.id);
                  setThreadMentionTarget(null);
                  setActiveThreadRootId(null);
                  setActiveRevisionThreadId(null);
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-border/60 hover:text-text-primary"
                title="스레드 닫기"
                aria-label="스레드 닫기"
              >
                <X size={14} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {activeRevisionThreadId && (
                <div
                  data-retake-thread-root
                  className="rounded-xl border border-accent/25 bg-accent/[0.07] px-3 py-3 text-text-primary"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-accent/25 bg-bg-primary/35 px-1.5 py-0.5 text-[10px] font-bold text-accent-sub">
                      {activeRevisionThreadLabel}
                    </span>
                    <span className="rounded-md border border-bg-border/70 bg-bg-primary/35 px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                      {getRevisionStatusLabel(activeRevisionThread)}
                    </span>
                    <span className="ml-auto text-[10px] text-text-secondary/65">
                      {activeRevisionThreadRequester}
                    </span>
                  </div>
                  <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap break-words">
                    <EntityText
                      text={activeRevisionThreadDescription}
                      userNames={userNames}
                      onMentionClick={handleMentionClick}
                      onHashClick={onHashClick ?? navigateToHashTarget}
                      onHashContextMenu={onHashContextMenu}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openRevisionDetail(activeRevisionThreadId)}
                      className="rounded-md border border-bg-border/70 bg-bg-primary/45 px-2 py-1 text-[10px] font-semibold text-text-secondary hover:border-accent/45 hover:text-accent-sub transition-colors"
                    >
                      상세모달에서 열기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setThreadMentionTarget(null);
                        requestAnimationFrame(() => threadInputRef.current?.focus());
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent/[0.10] px-2 py-1 text-[10px] font-semibold text-accent-sub hover:bg-accent/[0.16] transition-colors"
                    >
                      <Reply size={10} />
                      답글
                    </button>
                  </div>
                </div>
              )}
              {activeRevisionThreadId && activeRevisionThreadComments.length === 0 && (
                <div className="rounded-lg border border-dashed border-bg-border/70 px-3 py-6 text-center text-[11px] text-text-secondary/65">
                  아직 리테이크 댓글이 없습니다
                </div>
              )}
              {activeThreadMessagesForPanel.map((message, index) => {
                const messageIsOwn = currentUser?.id === message.userId;
                const messageHasImages = (message.images?.length ?? 0) > 0;
                const messageMentionsMe = !!currentUser && (message.mentions ?? []).includes(currentUser.name);
                const messageIsFocused = focusedCommentId === message.id;
                const messageIsThreadRoot = !activeRevisionThreadId && index === 0;
                const messageRevisionId = message.revisionId ?? activeRevisionThreadId;
                return (
                  <div
                    key={message.id}
                    ref={(el) => { commentRefs.current.set(message.id, el); }}
                    onClick={markUnreadCommentsRead}
                    className={cn(
                      'group/thread-message relative',
                      messageMentionsMe && 'pl-1.5',
                      messageIsFocused && 'comment-target-pulse',
                    )}
                    style={messageMentionsMe ? { borderLeft: '3px solid rgb(var(--color-accent))', borderRadius: 3 } : undefined}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-text-primary">{message.userName}</span>
                      <span className="text-[10px] text-text-secondary/50">{formatCommentTime(message.createdAt)}</span>
                      {messageIsThreadRoot && (
                        <span className="ml-auto rounded-full border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent">
                          원댓글
                        </span>
                      )}
                      {messageRevisionId && (
                        <RevisionCommentBadge
                          revisionId={messageRevisionId}
                          onJump={openRevisionDetail}
                        />
                      )}
                      {message.editedAt && (
                        <span className="text-[10px] text-text-secondary/30 italic">수정됨</span>
                      )}
                    </div>
                    <div className={cn(
                      'rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed break-words text-text-primary',
                      messageIsOwn ? 'bg-accent/15 border border-accent/25' : 'bg-bg-border/50',
                    )}>
                      {message.text && <div>{renderText(message.text, message.storageKey ?? message._sourceKey)}</div>}
                      {messageHasImages && (
                        <div className={`grid gap-1 ${message.text ? 'mt-1.5' : ''} ${message.images!.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                          {message.images!.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt=""
                              className="rounded w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                              style={{ maxHeight: 120 }}
                              onClick={() => openLightbox(url, message)}
                              loading="lazy"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <ReactionsArea
                        commentId={message.id}
                        reactions={reactionsByCommentId.get(message.id) ?? []}
                        currentUserId={currentUser?.id ?? null}
                        onToggle={handleReactionToggle}
                        pickerOpen={reactionPicker?.surface === 'thread' && reactionPicker.commentId === message.id}
                        onPickerOpen={() => setReactionPicker({ commentId: message.id, surface: 'thread' })}
                        onPickerClose={() => setReactionPicker(null)}
                        compact
                      />
                      <ThreadReplyButton
                        compact
                        aria-label={`답글 달기: ${message.userName}`}
                        onClick={() => replyInActiveThread(message)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="shrink-0 border-t border-bg-border bg-bg-primary/80 px-3 py-3">
              <div
                className="rounded-lg border border-bg-border/80 bg-bg-card/70 p-2 transition-colors focus-within:border-accent/50"
                onDragEnter={(event) => {
                  if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDrop={handleThreadDrop}
              >
                {threadMentionTarget && (!activeThreadRoot || threadMentionTarget.id !== activeThreadRoot.id) && (
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10.5px] font-medium text-accent">
                    <CornerDownRight size={11} />
                    <span className="min-w-0 truncate">{threadMentionTarget.userName}에게 답글</span>
                  </div>
                )}
                {threadAttachedImages.length > 0 && (
                  <div data-comment-thread-attachments className="mb-2 flex gap-2 overflow-x-auto pb-1">
                    {threadAttachedImages.map((img) => (
                      <div key={img.id} className="relative h-14 w-14 shrink-0">
                        <img
                          src={img.previewUrl}
                          className="h-14 w-14 rounded-lg border border-bg-border object-cover"
                          alt=""
                        />
                        {img.uploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                            <div className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          </div>
                        )}
                        {img.error && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/40" title={`업로드 실패: ${img.error}`}>
                            <X size={16} className="text-white" />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeThreadAttachedImage(img.id)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] text-white transition-transform hover:scale-110"
                          style={{ border: '2px solid rgb(var(--comment-card-elev-rgb))' }}
                          title="제거"
                          aria-label="스레드 첨부 이미지 제거"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={threadInputRef}
                  data-comment-thread-input
                  value={threadInput}
                  onChange={(event) => {
                    setThreadInput(event.target.value);
                    threadInputValueRef.current = event.target.value;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleThreadSubmit();
                    }
                  }}
                  onPaste={handleThreadPaste}
                  placeholder={activeRevisionThreadId ? '리테이크에 댓글 입력... (Ctrl+V / 드래그로 이미지)' : '스레드에 댓글 입력... (Ctrl+V / 드래그로 이미지)'}
                  rows={2}
                  className="block min-h-[44px] w-full resize-none bg-transparent px-1 py-0.5 text-[11.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-secondary/45"
                />
                <input
                  ref={threadFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={handleThreadFileChange}
                />
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => threadFileInputRef.current?.click()}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-border/60 hover:text-text-primary"
                    title="스레드에 이미지 첨부"
                    aria-label="스레드에 이미지 첨부"
                  >
                    <Paperclip size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleThreadSubmit}
                    disabled={!canSubmitThread}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-sub disabled:cursor-not-allowed disabled:opacity-30"
                    title={threadHasUploadingImage ? '스레드 이미지 업로드 중...' : '스레드에 전송 (Enter)'}
                    aria-label="스레드에 전송"
                  >
                    {threadSubmitting ? (
                      <div className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    ) : (
                      <ArrowUp size={14} strokeWidth={2.5} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.aside>
          </Fragment>
        )}
      </AnimatePresence>

      {/* 드래그 오버레이 */}
      {draggingOver && (
        <div className="comment-drop-overlay">
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <div className="comment-drop-icon text-accent">
              <ImagePlus size={48} strokeWidth={1.6} />
            </div>
            <div className="text-sm font-semibold text-accent-sub">
              이미지를 여기에 놓으세요
            </div>
            <div className="text-[11px] text-text-secondary">
              {quickRevisionActive ? '빠른 리테이크 이미지로 첨부됩니다' : '여러 장을 한 번에 첨부할 수 있어요'}
            </div>
          </div>
        </div>
      )}

      {/* v1.24.1: 라이트박스를 portal 로 body 직속 렌더 → 사이드바/모달 위에 항상 노출 */}
      {lightbox && (
        <AttachmentImageLightbox
          lightbox={lightbox}
          setLightbox={setLightbox}
          closeLightbox={closeLightbox}
          lightboxStep={lightboxStep}
          sceneLabel={sceneLabel}
          ariaLabel="댓글 이미지 확대 보기"
          manageKeyboard={false}
        />
      )}
    </div>
  );
}

/**
 * v1.24.2 한솔 보고 fix: 씬 안 모든 댓글의 모든 이미지를 한 갤러리로 순회 + 이미지 *아래* 에
 *   현재 이미지의 작성자/시간/본문 표시 (씬 상세 모달 ImageModal UX 와 일관). createPortal 로
 *   body 직속 렌더 → z-index 99999 로 항상 위.
 *
 * 레이아웃:
 *   ┌─────────────────────────────────────┐
 *   │ [씬 라벨]            n/m       [X]  │  ← 헤더 (얇음)
 *   │                                       │
 *   │  ◀     [    메인 이미지    ]     ▶   │  ← 메인 이미지 + 좌우 화살표
 *   │                                       │
 *   │  배한솔 · 14:02                      │  ← 이미지 아래 작성자+시간
 *   │  옥상 씬 LO 일단 올렸어요...         │  ← 본문 full text
 *   │                                       │
 *   │  [▢][▢][▢][▢][▢]   ←/→ 이동        │  ← 썸네일 strip + 키보드 안내
 *   └─────────────────────────────────────┘
 */
function CommentLightboxPortal({
  lightbox,
  setLightbox,
  closeLightbox,
  lightboxStep,
  sceneLabel,
}: {
  lightbox: CommentLightboxState;
  setLightbox: (next: CommentLightboxState | null | ((prev: CommentLightboxState | null) => CommentLightboxState | null)) => void;
  closeLightbox: () => void;
  lightboxStep: (dir: 1 | -1) => void;
  sceneLabel?: string;
}) {
  if (typeof document === 'undefined') return null;
  const current = lightbox.entries[lightbox.index];
  if (!current) return null;
  const totalCount = lightbox.entries.length;
  const showNav = totalCount > 1;

  return createPortal(
    <div
      className="comment-lightbox-backdrop cursor-zoom-out"
      onClick={closeLightbox}
      role="dialog"
      aria-modal="true"
      aria-label="댓글 이미지 확대 보기"
    >
      {/* 라이트박스 컨텐츠 — flex column 으로 헤더/이미지/본문/썸네일 구획 */}
      <div
        className="relative w-full h-full flex flex-col cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 헤더 — 씬 라벨 + N/M + 닫기 (얇게, 본문은 이미지 아래로 이동) */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 pt-4 pb-2">
          <div className="flex items-center gap-2 text-[12px] text-white/80 flex-wrap min-w-0">
            {sceneLabel && (
              <>
                <span className="px-2 py-1 rounded bg-white/10 font-medium">{sceneLabel}</span>
                <span className="text-white/40">·</span>
              </>
            )}
            <span className="tabular-nums text-white/70">{lightbox.index + 1} / {totalCount}</span>
          </div>
          <button
            onClick={closeLightbox}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
            title="닫기 (ESC)"
            aria-label="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* 메인 이미지 영역 — flex-grow + 좌우 화살표 absolute */}
        <div className="flex-1 relative flex items-center justify-center px-6 min-h-0">
          {showNav && (
            <button
              onClick={() => lightboxStep(-1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="이전 이미지 (←)"
              aria-label="이전 이미지"
            >
              <ChevronLeftIcon size={26} />
            </button>
          )}

          <img
            src={current.url}
            alt={`${current.userName}의 댓글 이미지 ${lightbox.index + 1}/${totalCount}`}
            className="comment-lightbox-image"
            key={`${lightbox.index}-${current.url}`}
          />

          {showNav && (
            <button
              onClick={() => lightboxStep(1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
              title="다음 이미지 (→)"
              aria-label="다음 이미지"
            >
              <ChevronRightIcon size={26} />
            </button>
          )}
        </div>

        {/* 이미지 *바로 아래* — 현재 이미지의 작성자 + 시간 + 본문 (씬 상세 모달 ImageModal UX 와 일관) */}
        <div className="flex-shrink-0 px-6 pt-3 pb-2 max-w-3xl mx-auto w-full">
          <div className="flex items-baseline gap-2 text-[12.5px] mb-1">
            <span className="font-semibold text-white">{current.userName}</span>
            <span className="text-white/50 text-[11px]">{formatCommentTime(current.createdAt)}</span>
          </div>
          {current.commentText && (
            <p className="text-[13.5px] text-white/95 leading-relaxed whitespace-pre-wrap break-words max-h-24 overflow-y-auto comment-lightbox-thumb-strip">
              {current.commentText}
            </p>
          )}
        </div>

        {/* 하단 썸네일 strip — 이미지 2장 이상 + 키보드 안내 */}
        {showNav && (
          <div
            className="flex-shrink-0 px-6 py-3"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.2))' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-white/60 font-medium">이미지 {totalCount}장</span>
              <span className="text-[11px] text-white/60">
                <span className="px-1.5 py-0.5 rounded bg-white/10 mr-1">←</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">→</span>
                <span className="ml-2">키보드 이동</span>
                <span className="mx-2 text-white/30">·</span>
                <span className="px-1.5 py-0.5 rounded bg-white/10">ESC</span>
                <span className="ml-1">닫기</span>
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 comment-lightbox-thumb-strip">
              {lightbox.entries.map((entry, i) => {
                const isActive = i === lightbox.index;
                return (
                  <button
                    key={`${i}-${entry.commentId}-${entry.url}`}
                    type="button"
                    onClick={() => setLightbox((prev) => prev ? { ...prev, index: i } : prev)}
                    className={cn(
                      'flex-shrink-0 rounded-md overflow-hidden transition-all cursor-pointer',
                      isActive ? 'comment-lightbox-thumb-active' : 'opacity-60 hover:opacity-100',
                    )}
                    style={{ width: 72, height: 72 }}
                    aria-label={`${i + 1}번 이미지로 이동 (${entry.userName})`}
                    aria-current={isActive ? 'true' : undefined}
                    title={`${entry.userName}: ${entry.commentText.slice(0, 30)}`}
                  >
                    <img src={entry.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── 시스템 이벤트 + 댓글 시간순 머지 ─────────────────

type FeedNode =
  | { kind: 'comment'; comment: SceneCommentWithSource }
  | { kind: 'event'; event: CommentInlineEvent };

/** 댓글과 시스템 이벤트를 createdAt 시간순으로 합쳐 단일 피드 노드 배열로 변환. */
function mergeFeed(
  comments: SceneCommentWithSource[],
  events: CommentInlineEvent[],
): FeedNode[] {
  const nodes: FeedNode[] = [
    ...comments.map<FeedNode>((c) => ({ kind: 'comment', comment: c })),
    ...events.map<FeedNode>((e) => ({ kind: 'event', event: e })),
  ];
  nodes.sort((a, b) => {
    const ta = a.kind === 'comment' ? a.comment.createdAt : a.event.at;
    const tb = b.kind === 'comment' ? b.comment.createdAt : b.event.at;
    return new Date(ta).getTime() - new Date(tb).getTime();
  });
  return nodes;
}
