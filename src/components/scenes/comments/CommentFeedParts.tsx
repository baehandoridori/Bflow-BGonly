/**
 * 씬 댓글 B안 화면 조각 (v1.147.0) — 댓글 패널·스레드 창이 같이 쓴다. 동작은 부르는 쪽(CommentPanel)이 넘긴다.
 * 스타일은 styles/comment-feed.css(토큰만). 시안: docs/superpowers/mockups/2026-11-04-scene-comments-b-plan.html
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AtSign,
  Check,
  Copy,
  ExternalLink,
  Link2,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Reply,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { avatarColor, avatarInitials } from '@/utils/userAvatar';
import { formatTimeShort } from '@/utils/formatTime';
import {
  RETAKE_ACTION_LABEL,
  RETAKE_STATUS_LABEL,
  type CommentFeedCounts,
  type CommentFeedFilter,
  type CommentThreadSummary,
  type FeedPerson,
  type RetakeAction,
  type RetakeCardStatus,
  type RetakePhase,
} from '@/utils/commentFeedModel';

// ─── 아바타 ───────────────────────────────────────────────

export function CommentAvatar({ userId, userName, className = 'cmt-avatar' }: { userId: string; userName: string; className?: string }) {
  return (
    <span className={className} style={{ background: avatarColor(userId || userName) }} aria-hidden>
      {avatarInitials(userName)}
    </span>
  );
}

function MiniAvatars({ people }: { people: readonly FeedPerson[] }) {
  return (
    <span className="cmt-thread-avs" aria-hidden>
      {people.map((p) => (
        <span key={p.id} style={{ background: avatarColor(p.id || p.name) }}>{avatarInitials(p.name)}</span>
      ))}
    </span>
  );
}

// ─── 필터 탭 ──────────────────────────────────────────────

const TABS: Array<{ id: CommentFeedFilter; label: string; count?: keyof CommentFeedCounts }> = [
  { id: 'all', label: '전체' },
  { id: 'unread', label: '안 읽음', count: 'unread' },
  { id: 'retake', label: '리테이크', count: 'retakes' },
  { id: 'mine', label: '@나', count: 'mine' },
];

export function CommentFilterTabs({
  filter,
  counts,
  onChange,
  extra,
}: {
  filter: CommentFeedFilter;
  counts: CommentFeedCounts;
  onChange: (next: CommentFeedFilter) => void;
  /** 오른쪽 끝(예: '스레드 다시 열기'). */
  extra?: ReactNode;
}) {
  return (
    <div className="cmt-tabs" role="tablist" aria-label="댓글 보기">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          className="cmt-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count && <span className="cmt-tab-n">{counts[tab.count]}</span>}
        </button>
      ))}
      {extra && <span className="cmt-tabs-extra">{extra}</span>}
    </div>
  );
}

// ─── 구분 줄 ──────────────────────────────────────────────

export function CommentDayDivider({ label }: { label: string }) {
  return <div className="cmt-day" role="separator" aria-label={label}><span>{label}</span></div>;
}

export function CommentNewDivider({ nodeRef, fading }: { nodeRef?: (node: HTMLDivElement | null) => void; fading?: boolean }) {
  return (
    <div
      ref={nodeRef}
      className="cmt-newline comment-unread-divider"
      data-comment-unread-divider
      data-fading={fading ? 'true' : undefined}
      style={{ opacity: fading ? 0 : 1, transition: 'opacity var(--motion-slow) var(--ease-std)' }}
      role="separator"
      aria-label="새 댓글"
    >
      <span>새 댓글</span>
    </div>
  );
}

// ─── 시스템 활동 한 줄 ─────────────────────────────────────

export function CommentActivityLine({ text, at, phase, inset = false }: { text: string; at: string; phase?: RetakePhase; inset?: boolean }) {
  return (
    <div className={inset ? 'cmt-activity is-inset' : 'cmt-activity'} data-phase={phase ?? 'other'}>
      <span className="cmt-activity-dot" aria-hidden />
      <span className="cmt-activity-text" title={text}>{text}</span>
      <span className="cmt-activity-time">{formatTimeShort(at)}</span>
    </div>
  );
}

// ─── 답글 요약 줄 ──────────────────────────────────────────

export function CommentThreadSummaryButton({
  summary,
  noun = '답글',
  onOpen,
}: {
  summary: CommentThreadSummary;
  noun?: '답글' | '댓글';
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="cmt-thread-summary"
      onClick={(event) => { event.stopPropagation(); onOpen(); }}
      aria-label={`${noun} ${summary.count}개 보기${summary.newCount ? `, 새 ${summary.newCount}개` : ''}`}
    >
      <MiniAvatars people={summary.participants} />
      <span className="cmt-thread-count">{noun} {summary.count}개</span>
      <span className="cmt-thread-last">마지막 {formatTimeShort(summary.lastAt)}</span>
      {summary.newCount > 0 && <span className="cmt-thread-new">새 {summary.newCount}</span>}
    </button>
  );
}

// ─── 호버 도구 줄 + ⋯ 메뉴 ─────────────────────────────────

export const QUICK_REACTIONS: Array<{ emoji: string; label: string }> = [
  { emoji: '✅', label: '확인' },
  { emoji: '👍', label: '좋아요' },
  { emoji: '👀', label: '보는 중' },
];

export interface CommentMenuItem {
  id: string;
  label: string;
  icon: 'todo' | 'link' | 'copy' | 'edit' | 'delete';
  danger?: boolean;
  /** 이 항목 앞에 구분선. */
  separated?: boolean;
  onSelect: () => void;
}

const MENU_ICONS = {
  todo: ListTodo,
  link: Link2,
  copy: Copy,
  edit: Pencil,
  delete: Trash2,
} as const;

export function CommentRowToolbar({
  userName,
  primary,
  onQuickReact,
  onOpenEmoji,
  menuItems,
}: {
  userName: string;
  /** 본문 목록은 '답글'(스레드 창 열기), 스레드 창 안은 '@이름'(입력창에 넣기). */
  primary: { kind: 'reply'; onClick: () => void } | { kind: 'mention'; onClick: () => void } | null;
  onQuickReact: (emoji: string) => void;
  onOpenEmoji: () => void;
  menuItems: CommentMenuItem[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // 메뉴 밖을 누르면 닫는다(메뉴 단추 자체는 제외 — 그 단추가 직접 토글한다).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && wrapRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    requestAnimationFrame(() => firstItemRef.current?.focus());
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const shortName = userName.length > 2 ? userName.slice(-2) : userName;
  return (
    <div ref={wrapRef} onClick={(event) => event.stopPropagation()}>
      <div className={menuOpen ? 'cmt-toolbar is-open' : 'cmt-toolbar'} role="toolbar" aria-label={`${userName} 댓글 동작`}>
        {QUICK_REACTIONS.map((r) => (
          <button key={r.emoji} type="button" title={r.label} aria-label={`${r.label} 반응`} onClick={() => onQuickReact(r.emoji)}>
            {r.emoji}
          </button>
        ))}
        <button type="button" aria-label="이모지 더보기" title="이모지 더보기" onClick={onOpenEmoji}>
          <SmilePlus size={14} aria-hidden />
        </button>
        {primary && <span className="cmt-toolbar-sep" aria-hidden />}
        {primary?.kind === 'reply' && (
          <button type="button" className="cmt-toolbar-label" onClick={primary.onClick} aria-label={`답글 달기: ${userName}`} title="답글">
            <Reply size={13} aria-hidden />
            <span>답글</span>
          </button>
        )}
        {primary?.kind === 'mention' && (
          <button type="button" className="cmt-toolbar-label" onClick={primary.onClick} aria-label={`@${userName} 넣기`} title={`@${userName} 넣기`}>
            <AtSign size={13} aria-hidden />
            <span>{shortName}</span>
          </button>
        )}
        {menuItems.length > 0 && (
          <button
            type="button"
            aria-label="더보기"
            title="더보기"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={14} aria-hidden />
          </button>
        )}
      </div>
      {menuOpen && (
        <div
          className="cmt-menu"
          role="menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // 모달·스레드 창까지 닫히지 않게 여기서 멈춘다.
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
            }
          }}
        >
          {menuItems.map((item, index) => {
            const Icon = MENU_ICONS[item.icon];
            return (
              <div key={item.id}>
                {item.separated && <hr />}
                <button
                  ref={index === 0 ? firstItemRef : undefined}
                  type="button"
                  role="menuitem"
                  className={item.danger ? 'is-danger' : undefined}
                  onClick={() => { setMenuOpen(false); item.onSelect(); }}
                >
                  <Icon size={13} aria-hidden />
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 리테이크 루트 카드 ─────────────────────────────────────

export function RetakeRootCard({
  label,
  status,
  requesterName,
  at,
  description,
  assignees,
  meId,
  meName,
  activityCount,
  commentSummary,
  onOpenThread,
  onOpenDetail,
  actions,
  inThread = false,
}: {
  label: string;
  status: RetakeCardStatus;
  requesterName: string | null;
  at: string;
  description: ReactNode;
  assignees: readonly FeedPerson[];
  meId: string | null;
  meName: string | null;
  activityCount: number;
  commentSummary: CommentThreadSummary | null;
  onOpenThread?: () => void;
  onOpenDetail?: () => void;
  /** 스레드 창 안 — 담당 완료·해결 같은 버튼. */
  actions?: Array<{ id: RetakeAction; onClick: () => void; busy?: boolean }>;
  inThread?: boolean;
}) {
  return (
    <div className="cmt-retake" data-retake-card data-status={status}>
      <div className="cmt-retake-head">
        <span className="cmt-retake-label">{label}</span>
        <span className="cmt-status" data-status={status}>{RETAKE_STATUS_LABEL[status]}</span>
        <span>{requesterName ? `요청 ${requesterName} · ` : ''}{formatTimeShort(at)}</span>
      </div>
      <div className={inThread ? 'cmt-retake-desc' : 'cmt-retake-desc is-clamped'}>{description}</div>
      <div className="cmt-retake-meta">
        {assignees.length > 0 && (
          <span className="cmt-retake-who">
            {assignees.slice(0, 3).map((a) => (
              <span key={a.id} style={{ background: avatarColor(a.id || a.name) }} aria-hidden>{avatarInitials(a.name)}</span>
            ))}
            담당 {assignees.map((a) => (a.id === meId ? `나(${meName ?? a.name})` : a.name)).join(', ')}
          </span>
        )}
        <span>활동 {activityCount}건</span>
      </div>
      {inThread ? (
        actions && actions.length > 0 ? (
          <div className="cmt-retake-actions">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                className={index === 0 && action.id !== 'reopen' && action.id !== 'reopen_mine' ? 'cmt-btn is-primary' : 'cmt-btn'}
                disabled={action.busy}
                onClick={action.onClick}
              >
                {(action.id === 'complete' || action.id === 'resolve') && <Check size={12} aria-hidden />}
                {RETAKE_ACTION_LABEL[action.id]}
              </button>
            ))}
            {onOpenDetail && (
              <button type="button" className="cmt-btn" onClick={onOpenDetail}>상세 열기</button>
            )}
          </div>
        ) : onOpenDetail ? (
          <div className="cmt-retake-actions">
            <button type="button" className="cmt-btn" onClick={onOpenDetail}>상세 열기</button>
          </div>
        ) : null
      ) : (
        <div className="cmt-retake-foot">
          {commentSummary && onOpenThread ? (
            <CommentThreadSummaryButton summary={commentSummary} noun="댓글" onOpen={onOpenThread} />
          ) : onOpenThread ? (
            <button type="button" className="cmt-retake-open" onClick={(event) => { event.stopPropagation(); onOpenThread(); }}>
              댓글 달기
            </button>
          ) : null}
          {onOpenDetail && (
            <button type="button" className="cmt-retake-detail" onClick={(event) => { event.stopPropagation(); onOpenDetail(); }}>
              <ExternalLink size={12} aria-hidden />
              상세
            </button>
          )}
        </div>
      )}
    </div>
  );
}
