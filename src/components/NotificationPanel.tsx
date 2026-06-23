import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Trash2, MessageSquare, MessageSquareWarning, RefreshCw, Award, ExternalLink, AtSign, UserPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { useNotificationStore, type AppNotification, type NotificationType } from '@/stores/useNotificationStore';
import { cn } from '@/utils/cn';
import { floatingGlassStyle, glassTopHighlight } from '@/utils/glassStyles';
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

// ─── 상대 시간 포맷 ─────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

// ─── 타입별 아이콘/색상 ──────────────────────────────
function typeConfig(type: NotificationType) {
  switch (type) {
    case 'scene_change': return { icon: RefreshCw, color: '#74B9FF', label: '씬 변경' };
    case 'comment': return { icon: MessageSquare, color: '#8B8DA3', label: '댓글' };
    // v1.24.0: 멘션 — '@' 아이콘 + accent 색상. 댓글과 명확히 구분.
    case 'mention': return { icon: AtSign, color: 'rgb(var(--color-accent))', label: '멘션' };
    case 'milestone': return { icon: Award, color: '#00B894', label: '마일스톤' };
    case 'system': return { icon: Bell, color: '#8B8DA3', label: '시스템' };
    // v1.18.0: 리테이크 알림 — MessageSquareWarning 아이콘 + accent 색상.
    case 'revision': return { icon: MessageSquareWarning, color: 'rgb(var(--color-accent))', label: '리테이크' };
    // v1.25.5: 액팅 피드백 요청 — 검수 요청 (강한 톤, mention 시각 처리와 동일).
    case 'acting_feedback': return { icon: MessageSquareWarning, color: '#FDCB6E', label: '피드백' };
    // v1.25.8: 씬 담당자 배정 — 본인이 새 담당자 (강한 톤, mention 동일 시각 처리).
    case 'scene_assignment': return { icon: UserPlus, color: 'rgb(var(--color-accent))', label: '배정' };
    // v1.29.0: 댓글 이모지 반응 — 차분 톤(comment 동등). 아이콘은 NotificationItem 에서 metadata.reactionEmojis 의
    //   마지막 원소(또는 fallback 💬) 로 덮어 그리므로 여기 icon 값은 placeholder.
    case 'comment_reaction': return { icon: MessageSquare, color: '#8B8DA3', label: '반응' };
  }
}

function NotificationGroupItem({
  group,
  collapsed,
  onToggle,
  onNavigate,
}: {
  group: Extract<NotificationDisplayItem, { kind: 'group' }>;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (n: AppNotification) => void;
}) {
  return (
    <div className="rounded-lg border border-bg-border/35 bg-bg-primary/20 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-border/20 transition-colors"
        title={collapsed ? '묶음 펼치기' : '묶음 접기'}
      >
        {collapsed ? <ChevronRight size={13} className="text-text-secondary/70" /> : <ChevronDown size={13} className="text-text-secondary/70" />}
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
            <NotificationItem key={notification.id} n={notification} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 알림 항목 ───────────────────────────────────────
function NotificationItem({ n, onNavigate }: { n: AppNotification; onNavigate: (n: AppNotification) => void }) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const cfg = typeConfig(n.type);
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

  const handleItemClick = () => {
    if (!n.isRead) markAsRead(n.id);
    onNavigate(n);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleItemClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleItemClick(); } }}
      className={cn(
        'group/noti relative w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors cursor-pointer rounded-lg',
        n.isRead
          ? 'hover:bg-bg-border/15'
          // v1.24.0: 멘션은 카드 배경 더 진하게, 자동 알림은 차분.
          : isMention
            ? 'bg-accent/[0.13] hover:bg-accent/[0.18]'
            : 'bg-accent/[0.04] hover:bg-accent/[0.08]',
      )}
    >
      {/* 미읽 바 — v1.24.0: 멘션은 액센트 색, 자동은 회색 (시각 차별화) */}
      <div
        className="flex-shrink-0 w-[3px] self-stretch rounded-full"
        style={{
          backgroundColor: n.isRead
            ? 'transparent'
            : isMention
              ? 'rgb(var(--color-accent))'
              : 'rgb(var(--color-bg-border) / 1.4)',
        }}
      />

      {/* 아이콘 — v1.29.0: comment_reaction 은 마지막 이모지 자체를 아이콘으로 표시(시각 hook). */}
      <div className="flex-shrink-0 mt-0.5">
        {n.type === 'comment_reaction' && n.metadata?.reactionEmojis?.length ? (
          <span
            className="text-[14px] leading-none"
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
              'text-[12px] leading-tight truncate flex-1 min-w-0',
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
          <p title={n.body} className="text-[11px] text-text-secondary/65 mt-0.5 truncate">{n.body}</p>
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
          onClick={(e) => { e.stopPropagation(); removeNotification(n.id); }}
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
  const { unreadCount, unreadMentionCount, panelOpen, togglePanel } = useNotificationStore();
  // v1.24.0: 시각 강조 분기 — 멘션 우선, 자동 알림은 차분한 글로우, 안 읽음 0개면 일반.
  const hasMention = unreadMentionCount > 0;
  const hasUnread = unreadCount > 0;

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        title={hasMention ? `멘션 ${unreadMentionCount}개 포함 ${unreadCount}개 새 알림` : `${unreadCount}개 새 알림`}
        className={cn(
          'p-2 rounded-lg transition-colors relative cursor-pointer',
          panelOpen
            ? 'bg-accent/15 text-accent'
            : 'hover:bg-bg-border/50',
          // v1.24.0: 안 읽음 시 strong 글로우, 멘션 포함 시 강한 펄스 추가.
          !panelOpen && hasUnread && !hasMention && 'bell-glow-soft',
          !panelOpen && hasMention && 'bell-glow-mention',
        )}
      >
        <Bell size={18} className={cn(hasMention && !panelOpen && 'text-accent')} />
        {hasUnread && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-white text-[9px] font-bold leading-none',
              hasMention ? 'badge-grad-strong' : 'badge-grad',
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && <NotificationDropdown />}
    </div>
  );
}

// ─── 드롭다운 패널 ───────────────────────────────────
function NotificationDropdown() {
  const { notifications, markAllAsRead, clearAll, setPanelOpen, unreadCount } = useNotificationStore();
  const ref = useRef<HTMLDivElement>(null);
  const showDevTools = isDevPreviewNotificationToolsEnabled();

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
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 z-[9999] rounded-xl"
      style={{
        ...floatingGlassStyle,
        width: effectiveWidth,
        height: effectiveHeight,
        // overflow-hidden 빼고 visible — 좌측/하단/코너 핸들 hover glow 가 contour 밖으로 살짝 나가도록.
        overflow: 'visible',
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
                onClick={clearAll}
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
          className="overflow-y-auto p-1.5 space-y-0.5"
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
                />
              ) : (
                <NotificationItem key={item.notification.id} n={item.notification} onNavigate={handleNavigate} />
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
    </div>
  );
}
