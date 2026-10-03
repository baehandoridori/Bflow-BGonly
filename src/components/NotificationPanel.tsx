import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Bell, Check, Trash2, ExternalLink } from 'lucide-react';
import { useNotificationStore, type AppNotification } from '@/stores/useNotificationStore';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';
import { floatingGlassStyle, glassTopHighlight } from '@/utils/glassStyles';
import { useMotionPref } from '@/hooks/useMotionPref';
import { EASE_CSS, MOTION_MS, animateEl, transformPreset } from '@/utils/motion';
import {
  BADGE_POP_EASING,
  BADGE_POP_KEYFRAMES,
  BADGE_POP_MS,
  BADGE_ROLL_MS,
  BELL_RING_KEYFRAMES,
  BELL_RING_MS,
  BELL_RING_ORIGIN,
  INITIAL_BELL_CLOCK,
  NOTIFICATION_ROW_EXIT_KEYFRAMES,
  NOTIFICATION_ROW_EXIT_MS,
  NOTIFICATION_ROW_SHIFT_MS,
  badgeRollKeyframes,
  decideBellReaction,
  notificationRowShifts,
  subscribeLiveNotificationArrival,
  takeLiveNotificationArrival,
  type BellReactionClock,
  type NotificationRowPosition,
} from '@/utils/notificationArrival';
import { notificationTypeVisual } from '@/utils/notificationTypeVisual';
import { useNotificationPanelSize, useNotificationPanelResizer } from '@/hooks/useNotificationPanelSize';
import { ResizeEdgeGlow } from '@/components/common/ResizeEdgeGlow';
import { ResizeHandleParticles } from '@/components/common/ResizeHandleParticles';
import {
  getSceneShortcutVisibilityClass,
  shouldShowSceneShortcut,
} from '@/utils/notificationSceneNavigation';
import {
  getNotificationSceneActionLabel,
  navigateNotificationToScene,
} from '@/utils/notificationSceneAction';
import '@/styles/notification-bell.css';
import { lastReactionEmoji } from '@/utils/commentReactionEmojiFormat';
import {
  addDevPreviewNotifications,
  isDevPreviewNotificationToolsEnabled,
} from '@/utils/devPreviewNotifications';
import {
  buildNotificationDisplayGroups,
  type NotificationDisplayItem,
} from '@/utils/notificationGrouping';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import { tokenizeGPaths } from '@/utils/pathLink';
import { DisclosureChevron } from '@/components/ui/DisclosureChevron';
import { UNDO_TOAST_CLASS, showUndoToast } from '@/components/common/UndoToast';
import {
  NOTIFICATION_CLEAR_FADE_MS,
  NOTIFICATION_RESTORE_FADE_MS,
  markNotificationRestoreFade,
  takeNotificationRestoreFade,
} from '@/utils/undoDelete';

// ─── 상대 시간 포맷 ─────────────────────────────────
function timeAgo(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '방금 전';
  const diff = Date.now() - time;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

// ─── 움직임 (움직임 폴리싱 18번 notification-journey) ─────────
// 타입별 아이콘/색상은 알림 카드와 같은 표(@/utils/notificationTypeVisual)를 쓴다.

/** 지운 줄을 내보낼 때 부르는 함수 — 줄 요소를 넘겨 받아 밀어낸 뒤 실제로 지운다. */
type RemoveNotificationRow = (id: string, row: HTMLElement | null) => void;

/** 알림 창 — 종 아래(오른쪽 위 모서리)에서 0.14초 만에 피어난다(작은 메뉴 박자, popup-rhythm 과 같은 값). 닫힘은 바로. */
const PANEL_POP_FROM = 'translateY(-4px) scale(0.97)';
const PANEL_POP = transformPreset({ from: PANEL_POP_FROM, duration: 140 });
const PANEL_POP_REDUCED = transformPreset({ from: PANEL_POP_FROM }, true);

/** 흐림 없는 판 — 바탕이 거의 불투명이라 흐림은 눈에 안 보이는데, 열리며 움직이는 동안·뒤 배경이 움직이는 동안 매 프레임
 *  다시 계산했다. 흐림이 없으면 뒤 글자가 또렷이 비치므로 알파를 .92 → .985 로 올린다(.97 에서도 대시보드 글자가 비쳤다). */
const panelSolidStyle: CSSProperties = {
  ...floatingGlassStyle,
  background: 'rgb(var(--color-bg-card) / 0.985)',
  backdropFilter: 'none',
  WebkitBackdropFilter: 'none',
};

/** 알림 목록 안 움직이는 줄(낱개 줄·묶음·묶음 안 줄)의 지금 위치. */
function measureNotificationRows(list: HTMLElement | null): NotificationRowPosition[] {
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>('[data-noti-flip]')).map((element) => ({
    key: element.dataset.notiFlip ?? '',
    top: element.getBoundingClientRect().top,
    parentKey: element.parentElement?.closest<HTMLElement>('[data-noti-flip]')?.dataset.notiFlip ?? null,
  }));
}

function NotificationGroupItem({
  group,
  collapsed,
  onToggle,
  onNavigate,
  onRemove,
}: {
  group: Extract<NotificationDisplayItem, { kind: 'group' }>;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (n: AppNotification) => void;
  onRemove: RemoveNotificationRow;
}) {
  return (
    <div data-noti-flip={`g:${group.key}`} className="rounded-lg border border-bg-border/35 bg-bg-primary/20 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-border/20 transition-colors"
        title={collapsed ? '묶음 펼치기' : '묶음 접기'}
      >
        <DisclosureChevron expanded={!collapsed} size={13} className="text-text-secondary/70" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">{group.title}</span>
        {group.unreadCount > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">
            {group.unreadCount}
          </span>
        )}
        <span className="text-[10px] text-text-secondary/50">{timeAgo(group.latestCreatedAt)}</span>
      </button>
      {!collapsed && (
        <div className="space-y-0.5 border-t border-bg-border/25 p-1">
          {group.notifications.map((notification) => (
            <NotificationItem key={notification.id} n={notification} onNavigate={onNavigate} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 알림 항목 ───────────────────────────────────────
function NotificationItem({ n, onNavigate, onRemove }: { n: AppNotification; onNavigate: (n: AppNotification) => void; onRemove: RemoveNotificationRow }) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const rowRef = useRef<HTMLDivElement>(null);
  const cfg = notificationTypeVisual(n.type);
  const Icon = cfg.icon;
  // 멘션·댓글 알림은 metadata 가 부족해도 이동 버튼을 만든다.
  // 노출 방식은 기존 알림 액션과 동일하게 hover/focus 때만 보여준다.
  const hasNavigateTarget = shouldShowSceneShortcut(n.type, n.metadata);
  const actionLabel = getNotificationSceneActionLabel(n.type, n.metadata);
  // v1.24.0: 멘션 알림 — 더 강한 시각 신호 (액센트 좌측 바 + @ 배지 + 카드 배경 진한 alpha).
  // v1.25.5: acting_feedback 도 멘션과 동일한 강한 톤 (검수 요청은 즉시 인지 필요).
  // v1.25.8: scene_assignment 도 동일 — 담당자 배정은 즉시 인지 필요.
  const isMention = n.type === 'mention' || n.type === 'acting_feedback' || n.type === 'scene_assignment';
  const actionVisibilityClass = getSceneShortcutVisibilityClass();
  const bodyHasPath = n.body ? tokenizeGPaths(n.body).some((token) => token.type === 'path') : false;

  const handleItemClick = () => {
    if (!n.isRead) markAsRead(n.id);
    onNavigate(n);
  };

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      data-noti-flip={`n:${n.id}`}
      data-noti-read={n.isRead ? 'true' : 'false'}
      onClick={handleItemClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleItemClick(); } }}
      className={cn(
        // 읽음 처리: 배경·글자색이 0.2초에 걸쳐 차분해진다(굵기 차이는 안 읽음 구분용이라 바로 바뀜).
        'group/noti relative w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors duration-200 cursor-pointer rounded-lg',
        n.isRead
          ? 'hover:bg-bg-border/15'
          // v1.24.0: 멘션은 카드 배경 더 진하게, 자동 알림은 차분.
          : isMention
            ? 'bg-accent/[0.13] hover:bg-accent/[0.18]'
            : 'bg-accent/[0.04] hover:bg-accent/[0.08]',
      )}
    >
      {/* 미읽 바 — v1.24.0: 멘션은 액센트 색, 자동은 회색 (시각 차별화).
          읽으면 색은 그대로 둔 채 위아래로 접히듯 사라진다(scaleY + opacity 200ms, motion-comments-notify.css). */}
      <div
        aria-hidden
        className="bf-noti-unread-bar flex-shrink-0 w-[3px] self-stretch rounded-full"
        style={{
          backgroundColor: isMention
            ? 'rgb(var(--color-accent))'
            : 'rgb(var(--color-bg-border) / 1.4)',
        }}
      />

      {/* 아이콘 — v1.29.0: comment_reaction 은 마지막 이모지 자체를 아이콘으로 표시(시각 hook). */}
      <div className="flex-shrink-0 mt-0.5">
        {n.type === 'comment_reaction' && n.metadata?.reactionEmojis?.length ? (
          <span
            className="text-[14px] leading-none transition-opacity duration-200"
            style={{ opacity: n.isRead ? 0.55 : 1 }}
          >
            {lastReactionEmoji(n.metadata.reactionEmojis)}
          </span>
        ) : (
          <Icon size={14} style={{ color: n.isRead ? 'rgb(var(--color-text-secondary) / 0.55)' : cfg.color }} />
        )}
      </div>

      {/* 내용 — truncate 된 텍스트는 호버 시 GlobalTooltip 으로 전체 노출 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p
            title={n.title}
            className={cn(
              'text-[12px] leading-tight truncate flex-1 min-w-0 transition-colors duration-200',
              n.isRead ? 'text-text-secondary/80' : isMention ? 'text-text-primary font-semibold' : 'text-text-primary font-medium',
            )}
          >
            {n.title}
          </p>
          {/* v1.24.0: 멘션 배지 — '@' 표기로 일반 댓글 알림과 즉시 구분 */}
          {isMention && !n.isRead && (
            <span className="flex-shrink-0 text-[9px] font-bold text-accent px-1.5 py-0.5 rounded mention-badge">@</span>
          )}
        </div>
        {n.body && (
          <p
            title={n.body}
            className={cn(
              'text-[11px] text-text-secondary/65 mt-0.5',
              bodyHasPath ? 'whitespace-normal leading-relaxed' : 'truncate',
            )}
          >
            <PathLinkifiedText text={n.body} />
          </p>
        )}
        <span className="text-[10px] text-text-secondary/50 mt-1 block">{timeAgo(n.createdAt)}</span>
      </div>

      {/* 본문 클릭은 그대로 자동 (씬 이동 + 읽음). 액션 버튼은 stopPropagation 으로 분리. */}
      <div className={cn('flex items-center gap-1 self-start mt-0.5 flex-shrink-0 transition-opacity', actionVisibilityClass)}>
        {hasNavigateTarget && (
          <button
            type="button"
            title={actionLabel}
            onClick={(e) => { e.stopPropagation(); handleItemClick(); }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium bg-accent/15 text-accent-sub border border-accent/30 hover:bg-accent/25"
          >
            <ExternalLink size={10} />
            <span>{actionLabel}</span>
          </button>
        )}
        {!n.isRead && (
          <button
            type="button"
            title="읽음 처리"
            onClick={(e) => {
              e.stopPropagation();
              markAsRead(n.id);
            }}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-[#00D9A0] bg-[#00D9A0]/10 border border-[#00D9A0]/30 hover:bg-[#00D9A0]/20"
          >
            <Check size={11} />
          </button>
        )}
        <button
          type="button"
          title="삭제"
          onClick={(e) => { e.stopPropagation(); onRemove(n.id, rowRef.current); }}
          className="inline-flex items-center justify-center w-5 h-5 rounded text-[#FF7675] bg-[#FF7675]/10 border border-[#FF7675]/30 hover:bg-[#FF7675]/20"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── 벨 아이콘 버튼 ──────────────────────────────────
export function NotificationBell() {
  const { unreadCount, unreadMentionCount, panelOpen, togglePanel, activeUserId } = useNotificationStore();
  // v1.24.0: 시각 강조 분기 — 멘션 우선, 자동 알림은 차분한 글로우, 안 읽음 0개면 일반.
  const hasMention = unreadMentionCount > 0;
  const hasUnread = unreadCount > 0;

  // 움직임 폴리싱 18번: 실시간으로 방금 온 알림에만 반응한다(앱 시작 때 쌓인 알림·계정 전환은 신호가 없다).
  // 나를 부른 알림이면 종 '딩동', 아니면 배지만 '톡' + 새 숫자가 아래에서 굴러 올라온다.
  // 움직임은 모두 WAAPI(transform) — 종 빛(::after 무한 애니메이션)을 클래스로 껐다 켜지 않아 깜빡이지 않는다.
  const { reduce } = useMotionPref();
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const ringRef = useRef<HTMLSpanElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const badgeNumberRef = useRef<HTMLSpanElement>(null);
  const badgeRollRef = useRef<Animation | null>(null);
  const clockRef = useRef<BellReactionClock>(INITIAL_BELL_CLOCK);
  const shownCountRef = useRef({ userId: activeUserId, count: unreadCount });

  const rollBadgeNumber = useCallback((direction: 'up' | 'down') => {
    badgeRollRef.current?.cancel();
    badgeRollRef.current = animateEl(
      badgeNumberRef.current,
      badgeRollKeyframes(direction),
      { duration: BADGE_ROLL_MS, easing: EASE_CSS.out },
      reduceRef.current,
    );
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = subscribeLiveNotificationArrival(() => {
      // 같은 순간 여러 개가 와도 한 번 — 새 숫자가 그려진 다음 차례에 몰아서 처리한다.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const state = useNotificationStore.getState();
        const arrival = takeLiveNotificationArrival(state.activeUserId);
        if (!arrival || state.unreadCount === 0) return;
        const decision = decideBellReaction(arrival, clockRef.current, Date.now());
        clockRef.current = decision.clock;
        if (decision.ring) {
          animateEl(ringRef.current, BELL_RING_KEYFRAMES, { duration: BELL_RING_MS, easing: 'ease-out' }, reduceRef.current);
        }
        if (decision.pop) {
          animateEl(badgeRef.current, BADGE_POP_KEYFRAMES, { duration: BADGE_POP_MS, easing: BADGE_POP_EASING }, reduceRef.current);
          rollBadgeNumber('up');
        }
      }, 0);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [rollBadgeNumber]);

  // 읽거나 지워서 줄면 숫자가 위에서 내려온다. 계정이 바뀐 순간·배지가 사라질 때는 그냥 바뀐다.
  useEffect(() => {
    const previous = shownCountRef.current;
    shownCountRef.current = { userId: activeUserId, count: unreadCount };
    if (previous.userId !== activeUserId) return;
    if (unreadCount > 0 && unreadCount < previous.count) rollBadgeNumber('down');
  }, [activeUserId, unreadCount, rollBadgeNumber]);

  const bellLabel = hasMention ? `멘션 ${unreadMentionCount}개 포함 ${unreadCount}개 새 알림` : `${unreadCount}개 새 알림`;

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        aria-label={bellLabel}
        aria-expanded={panelOpen}
        // 알림 창이 열려 있으면 설명 말풍선을 띄우지 않는다 — 종 아래로 뜨는 말풍선이 창 머리의 '모두 읽음·전체 삭제'를 덮었다.
        title={panelOpen ? undefined : bellLabel}
        className={cn(
          'bf-press p-2 rounded-lg relative cursor-pointer',
          panelOpen
            ? 'bg-accent/15 text-accent'
            : 'hover:bg-bg-border/50',
          // v1.24.0: 안 읽음 시 strong 글로우, 멘션 포함 시 강한 펄스 추가.
          !panelOpen && hasUnread && !hasMention && 'bell-glow-soft',
          !panelOpen && hasMention && 'bell-glow-mention',
        )}
      >
        {/* 흔들리는 축은 종 꼭대기(50% 15%) — 버튼(누름 scale)과 따로 움직이게 안쪽 칸만 돌린다. */}
        <span ref={ringRef} className="block" style={{ transformOrigin: BELL_RING_ORIGIN }}>
          <Bell size={18} className={cn(hasMention && !panelOpen && 'text-accent')} />
        </span>
        {hasUnread && (
          <span
            ref={badgeRef}
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center overflow-hidden rounded-full text-white text-[9px] font-bold leading-none',
              hasMention ? 'badge-grad-strong' : 'badge-grad',
            )}
          >
            {/* 숫자만 굴린다 — 배지 밖으로 나간 부분은 가려져 계기판처럼 보인다. */}
            <span ref={badgeNumberRef} className="block">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </span>
        )}
      </button>

      {panelOpen && <NotificationDropdown />}
    </div>
  );
}

// ─── 드롭다운 패널 ───────────────────────────────────
function NotificationDropdown() {
  const { notifications, markAllAsRead, setPanelOpen, unreadCount, removeNotification } = useNotificationStore();
  const ref = useRef<HTMLDivElement>(null);
  const showDevTools = isDevPreviewNotificationToolsEnabled();
  const { reduce } = useMotionPref();

  // 움직임 폴리싱 18번: 지운 줄은 오른쪽으로 밀려나고(150ms), 아래 줄은 그 자리로 미끄러져 올라온다(220ms).
  const listRef = useRef<HTMLDivElement>(null);
  const rowShiftBeforeRef = useRef<Map<string, number> | null>(null);
  const removingIdsRef = useRef(new Set<string>());
  const handleRemove = useCallback<RemoveNotificationRow>((id, row) => {
    if (removingIdsRef.current.has(id)) return;
    removingIdsRef.current.add(id);
    const commit = () => {
      removingIdsRef.current.delete(id);
      // 지우기 직전 위치를 잰다 — 지운 뒤(useLayoutEffect) 새 위치와 비교해 아래 줄을 되돌렸다 푼다.
      rowShiftBeforeRef.current = reduce
        ? null
        : new Map(measureNotificationRows(listRef.current).map((position) => [position.key, position.top]));
      removeNotification(id);
    };
    const exit = animateEl(
      row,
      NOTIFICATION_ROW_EXIT_KEYFRAMES,
      { duration: NOTIFICATION_ROW_EXIT_MS, easing: EASE_CSS.in, fill: 'forwards' },
      reduce,
    );
    if (!exit || !row) {
      commit();
      return;
    }
    // 밀려나는 동안 다시 누르지 못하게. 창이 닫혀도 지우기는 끝까지 간다(타이머는 저장소만 건드린다).
    row.style.pointerEvents = 'none';
    const duration = Number(exit.effect?.getTiming().duration) || NOTIFICATION_ROW_EXIT_MS;
    window.setTimeout(commit, duration);
  }, [reduce, removeNotification]);

  useLayoutEffect(() => {
    const before = rowShiftBeforeRef.current;
    rowShiftBeforeRef.current = null;
    const list = listRef.current;
    if (!before || !list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-noti-flip]'));
    // 앞서 미끄러지던 줄은 지금 보이는 자리(before 에 이미 담김)에서 새로 출발한다.
    rows.forEach((row) => row.getAnimations().forEach((animation) => { if (animation.id === 'noti-row-shift') animation.cancel(); }));
    const shifts = notificationRowShifts(before, measureNotificationRows(list));
    rows.forEach((row) => {
      const key = row.dataset.notiFlip ?? '';
      const shift = shifts.get(key);
      // 밀려나는 중인 줄은 그대로 사라지게 둔다.
      if (!shift || removingIdsRef.current.has(key.slice(2))) return;
      const animation = animateEl(
        row,
        [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
        { duration: NOTIFICATION_ROW_SHIFT_MS, easing: EASE_CSS.out },
        reduce,
      );
      if (animation) animation.id = 'noti-row-shift';
    });
  }, [notifications, reduce]);

  // 움직임 폴리싱 20번: '전체 삭제' — 줄들이 0.15초에 옅어진 뒤 비우고, 오른쪽 아래에 '알림을 모두 지웠어요 · 되돌리기'.
  // 되돌리면 지운 알림이 그대로 돌아오고 줄들이 0.18초에 다시 나타난다. 창이 닫혀도 비우기는 끝까지 간다(타이머는 저장소만 건드린다).
  const clearFadeRef = useRef<Animation | null>(null);
  const clearingRef = useRef(false);
  const handleClearAll = useCallback(() => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    const commit = () => {
      clearingRef.current = false;
      const state = useNotificationStore.getState();
      const userId = state.activeUserId;
      const removed = state.clearAll();
      if (removed.length === 0) return;
      showUndoToast({
        message: '알림을 모두 지웠어요',
        onUndo: () => {
          markNotificationRestoreFade();
          useNotificationStore.getState().restoreNotifications(removed, userId);
        },
        // 로컬 목록만 지우는 일이라 기다렸다 할 일이 없다 — 시간이 지나면 되돌릴 수 없게 될 뿐.
        onExpire: () => {},
      });
    };
    const fade = animateEl(
      listRef.current,
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: NOTIFICATION_CLEAR_FADE_MS, easing: EASE_CSS.in, fill: 'forwards' },
      reduce,
    );
    if (!fade) {
      commit();
      return;
    }
    clearFadeRef.current = fade;
    // 옅어지는 동안 줄을 다시 누르지 못하게.
    if (listRef.current) listRef.current.style.pointerEvents = 'none';
    window.setTimeout(commit, NOTIFICATION_CLEAR_FADE_MS);
  }, [reduce]);

  useLayoutEffect(() => {
    const list = listRef.current;
    // 비운 뒤: 옅어진 채 멈춰 있던 목록 상자를 풀고 '알림이 없습니다'를 옅게 띄운다.
    if (clearFadeRef.current && notifications.length === 0) {
      clearFadeRef.current.cancel();
      clearFadeRef.current = null;
      if (list) list.style.pointerEvents = '';
      animateEl(list, [{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS.fast, easing: EASE_CSS.out }, reduce);
      return;
    }
    // 되돌린 뒤(창이 열려 있으면): 줄들이 다시 나타난다.
    if (notifications.length > 0 && takeNotificationRestoreFade()) {
      clearFadeRef.current?.cancel();
      clearFadeRef.current = null;
      if (list) list.style.pointerEvents = '';
      animateEl(list, [{ opacity: 0 }, { opacity: 1 }], { duration: NOTIFICATION_RESTORE_FADE_MS, easing: EASE_CSS.out }, reduce);
    }
  }, [notifications, reduce]);

  // v1.27.0: 패널 너비/높이 사용자 조절 + preferences 저장.
  const { width, height, commit, isUserOverride } = useNotificationPanelSize();
  // drag 중에는 disk 저장 없이 live 갱신.
  const [liveSize, setLiveSize] = useState<{ width?: number; height?: number } | null>(null);
  const [hoverAxis, setHoverAxis] = useState<'w' | 's' | 'sw' | null>(null);
  const [dragAxis, setDragAxis] = useState<'w' | 's' | 'sw' | null>(null);
  const [groupCollapsedKeys, setGroupCollapsedKeys] = useState<Set<string>>(new Set());
  const displayGroups = useMemo(() => buildNotificationDisplayGroups(notifications), [notifications]);

  const { startDrag } = useNotificationPanelResizer({
    liveSetSize: (size) => setLiveSize((prev) => ({ ...(prev ?? {}), ...size })),
    commitSize: (size) => {
      setLiveSize(null);
      setDragAxis(null);
      // v1.27.0 코덱스 4차 P3 fix: drag 종료 직후 마우스가 핸들에서 떨어져 있으면
      // onMouseLeave 는 drag 중에 !dragAxis 가드로 hoverAxis 를 못 풀고, drag 끝난 뒤에는
      // mouseLeave 이벤트가 이미 지났기 때문에 hoverAxis 가 stale 하게 남아 glow 가 hover
      // intensity 로 굳음. drag 종료 시 명시적으로 hoverAxis 도 초기화.
      setHoverAxis(null);
      void commit(size);
    },
  });

  const effectiveWidth = liveSize?.width ?? width;
  const effectiveHeight = liveSize?.height ?? height;
  // 헤더(약 46px) + 약간의 패딩 빼고 알림 목록 max-h. 외측 height 기준으로 계산.
  const listMaxHeight = Math.max(120, effectiveHeight - 50);

  // 외부 클릭 닫기 — 드래그 중에는 외부 mousedown 무시 (글로벌 핸들러가 이미 등록되어 있으므로).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dragAxis) return;
      // 움직임 폴리싱 20번: '되돌리기' 카드를 누를 때는 닫지 않는다 — 되살아나는 알림을 그 자리에서 보게.
      if ((e.target as Element | null)?.closest?.(`.${UNDO_TOAST_CLASS}`)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [setPanelOpen, dragAxis]);

  const handleNavigate = (n: AppNotification) => {
    if (n.type === 'calendar') {
      const date = n.metadata?.eventDate;
      useAppStore.getState().navigateToScheduleDate(date ? { date } : undefined);
      setPanelOpen(false);
      return;
    }
    navigateNotificationToScene(n.type, n.metadata);
    setPanelOpen(false);
  };

  const toggleGroup = (key: string) => {
    setGroupCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <motion.div
      ref={ref}
      {...(reduce ? PANEL_POP_REDUCED : PANEL_POP)}
      className="absolute right-0 top-full mt-2 z-[9999] rounded-xl"
      style={{
        ...panelSolidStyle,
        width: effectiveWidth,
        height: effectiveHeight,
        // overflow-hidden 빼고 visible — 좌측/하단/코너 핸들 hover glow 가 contour 밖으로 살짝 나가도록.
        overflow: 'visible',
        transformOrigin: 'top right',
      }}
    >
      {/* 안쪽 컨텐츠 컨테이너 — 둥근 모서리 깨끗하게 clip. */}
      <div className="absolute inset-0 rounded-xl overflow-hidden">
        {/* 상단 빛 반사 */}
        <div
          className="absolute top-0 left-0 right-0 h-px pointer-events-none"
          style={{
            background: glassTopHighlight,
          }}
        />

        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/35">
          <span className="text-[13px] font-semibold text-text-primary">
            알림
            {isUserOverride && (
              <span
                className="ml-2 text-[9px] text-text-secondary/45 font-normal"
                title="사용자 조정 크기. 더블클릭 핸들로 기본 크기 복귀."
              >
                · 크기 고정
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {showDevTools && (
              <button
                onClick={() => { void addDevPreviewNotifications(); }}
                className="text-[10px] text-text-secondary/70 hover:text-accent flex items-center gap-1 cursor-pointer"
                title="프리뷰에서 씬 이동 알림을 테스트합니다"
              >
                <Bell size={11} />
                테스트 알림
              </button>
            )}
            {unreadCount > 0 && (
              <button
                onClick={() => {
                  markAllAsRead();
                }}
                className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-1 cursor-pointer"
              >
                <Check size={11} />
                모두 읽음
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[10px] text-text-secondary/55 hover:text-red-400 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 size={11} />
                전체 삭제
              </button>
            )}
          </div>
        </div>

        {/* 알림 목록 */}
        <div
          ref={listRef}
          // overflow-x-hidden: 지운 줄이 오른쪽으로 밀려나는 동안 가로 스크롤바가 깜빡 생기지 않게.
          className="overflow-y-auto overflow-x-hidden p-1.5 space-y-0.5"
          style={{ maxHeight: listMaxHeight }}
        >
          {notifications.length === 0 ? (
            <div className="py-10 text-center">
              <Bell size={24} className="mx-auto text-text-secondary/25 mb-2" />
              <p className="text-[12px] text-text-secondary/50">알림이 없습니다</p>
            </div>
          ) : (
            displayGroups.map((item) => (
              item.kind === 'group' ? (
                <NotificationGroupItem
                  key={item.key}
                  group={item}
                  collapsed={groupCollapsedKeys.has(item.key)}
                  onToggle={() => toggleGroup(item.key)}
                  onNavigate={handleNavigate}
                  onRemove={handleRemove}
                />
              ) : (
                <NotificationItem key={item.notification.id} n={item.notification} onNavigate={handleNavigate} onRemove={handleRemove} />
              )
            ))
          )}
        </div>
      </div>

      {/* v1.27.0: 리사이즈 핸들 3개 + EdgeGlow.
          좌측: 너비 / 하단: 높이 / 좌하단 코너: 동시. 더블클릭 → 기본 크기 복귀. */}
      {/* 좌측 (너비) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="알림 패널 너비 조절"
        title="드래그로 너비 조절 · 더블클릭으로 기본 크기 복귀"
        onMouseEnter={() => !dragAxis && setHoverAxis('w')}
        onMouseLeave={() => !dragAxis && setHoverAxis((p) => (p === 'w' ? null : p))}
        onMouseDown={(e) => {
          setDragAxis('w');
          startDrag('w', e, effectiveWidth, effectiveHeight);
        }}
        onDoubleClick={() => void commit({ width: null, height: null })}
        className="absolute left-0 top-2 bottom-2 w-2 cursor-w-resize z-20"
      />
      {/* 하단 (높이) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="알림 패널 높이 조절"
        title="드래그로 높이 조절 · 더블클릭으로 기본 크기 복귀"
        onMouseEnter={() => !dragAxis && setHoverAxis('s')}
        onMouseLeave={() => !dragAxis && setHoverAxis((p) => (p === 's' ? null : p))}
        onMouseDown={(e) => {
          setDragAxis('s');
          startDrag('s', e, effectiveWidth, effectiveHeight);
        }}
        onDoubleClick={() => void commit({ width: null, height: null })}
        className="absolute bottom-0 left-2 right-2 h-2 cursor-s-resize z-20"
      />
      {/* 좌하단 코너 */}
      <div
        role="separator"
        aria-label="알림 패널 너비·높이 동시 조절"
        title="드래그로 크기 조절 · 더블클릭으로 기본 크기 복귀"
        onMouseEnter={() => !dragAxis && setHoverAxis('sw')}
        onMouseLeave={() => !dragAxis && setHoverAxis((p) => (p === 'sw' ? null : p))}
        onMouseDown={(e) => {
          setDragAxis('sw');
          startDrag('sw', e, effectiveWidth, effectiveHeight);
        }}
        onDoubleClick={() => void commit({ width: null, height: null })}
        className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-30"
      />

      {/* EdgeGlow — idle 에도 은은하게 보여 핸들 존재 암시 (한솔 v1.27.0 보고).
          댓글 패널과 톤 통일. hover/drag 시 단계적으로 강해짐. */}
      <ResizeEdgeGlow
        edge="w"
        intensity={
          dragAxis === 'w' || dragAxis === 'sw'
            ? 'drag'
            : hoverAxis === 'w' || hoverAxis === 'sw'
              ? 'hover'
              : 'idle'
        }
        radius={12}
      />
      <ResizeEdgeGlow
        edge="s"
        intensity={
          dragAxis === 's' || dragAxis === 'sw'
            ? 'drag'
            : hoverAxis === 's' || hoverAxis === 'sw'
              ? 'hover'
              : 'idle'
        }
        radius={12}
      />
      {/* 드래그 중에만 좌측/하단 변에서 파티클 사르르. */}
      <ResizeHandleParticles edge="w" active={dragAxis === 'w' || dragAxis === 'sw'} />
      <ResizeHandleParticles edge="s" active={dragAxis === 's' || dragAxis === 'sw'} />
    </motion.div>
  );
}
