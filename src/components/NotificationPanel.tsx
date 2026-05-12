import { useEffect, useRef } from 'react';
import { Bell, Check, Trash2, MessageSquare, MessageSquareWarning, RefreshCw, Award, ExternalLink, AtSign } from 'lucide-react';
import { useNotificationStore, type AppNotification, type NotificationType } from '@/stores/useNotificationStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';
import { floatingGlassStyle, glassTopHighlight } from '@/utils/glassStyles';
import '@/styles/notification-bell.css';

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
    // v1.18.0: 리비전 알림 — MessageSquareWarning 아이콘 + accent 색상.
    case 'revision': return { icon: MessageSquareWarning, color: 'rgb(var(--color-accent))', label: '리비전' };
    // v1.25.5: 액팅 피드백 — 검수 요청 (강한 톤, mention 시각 처리와 동일).
    case 'acting_feedback': return { icon: MessageSquareWarning, color: '#FDCB6E', label: '피드백' };
  }
}

// ─── 알림 항목 ───────────────────────────────────────
function NotificationItem({ n, onNavigate }: { n: AppNotification; onNavigate: (n: AppNotification) => void }) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const cfg = typeConfig(n.type);
  const Icon = cfg.icon;
  // v1.23.1 (#6): 멘션·댓글 알림은 metadata 가 비어 있어도 "씬 보기" 버튼 노출.
  //   다른 PC 사용자가 멘션 보낼 때 useDataStore 에 그 씬이 없어 metadata=undefined 가 되는
  //   케이스가 있는데, 그래도 본문 클릭 navigate 가 자체 fallback 으로 처리하므로 버튼 노출이 안전.
  const hasMetadataTarget = !!(n.metadata?.sceneId || n.metadata?.sceneName);
  const isSceneRelated = n.type === 'comment' || n.type === 'mention' || n.type === 'scene_change' || n.type === 'revision' || n.type === 'acting_feedback';
  const hasNavigateTarget = hasMetadataTarget || isSceneRelated;
  // v1.24.0: 멘션 알림 — 더 강한 시각 신호 (액센트 좌측 바 + @ 배지 + 카드 배경 진한 alpha).
  // v1.25.5: acting_feedback 도 멘션과 동일한 강한 톤 (검수 요청은 즉시 인지 필요).
  const isMention = n.type === 'mention' || n.type === 'acting_feedback';

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

      {/* 아이콘 */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={14} style={{ color: n.isRead ? 'rgb(var(--color-text-secondary) / 0.55)' : cfg.color }} />
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

      {/* 한솔 결정: 호버 시 우측에 [씬 보기 / 읽음 / 삭제] 액션 fade-in.
          본문 클릭은 그대로 자동 (씬 이동 + 읽음). 액션 버튼은 stopPropagation 으로 분리.
          flex sibling 으로 두어 평소에도 영역만 차지 (opacity 0) → 본문 truncate 가 액션 영역까지 침범하지 않음. */}
      <div className="flex items-center gap-1 self-start mt-0.5 flex-shrink-0 opacity-0 group-hover/noti:opacity-100 transition-opacity">
        {hasNavigateTarget && (
          <button
            type="button"
            title="씬 보기"
            onClick={(e) => { e.stopPropagation(); handleItemClick(); }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium bg-accent/15 text-accent-sub border border-accent/30 hover:bg-accent/25"
          >
            <ExternalLink size={10} />
            <span>씬 보기</span>
          </button>
        )}
        {!n.isRead && (
          <button
            type="button"
            title="읽음 처리"
            onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
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
  const { setView, setSelectedEpisode, setHighlightSceneId } = useAppStore();
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [setPanelOpen]);

  const handleNavigate = (n: AppNotification) => {
    const sceneId = n.metadata?.sceneId;
    const sceneName = n.metadata?.sceneName;
    // v1.18.0: 리비전 알림 — 모달 자동 오픈 + revisions 탭 + focusRevisionId 강조.
    // ScenesView 가 listen 하는 window CustomEvent 로 라우팅.
    const isRevisionNotif = n.type === 'revision';
    const revisionId = n.metadata?.revisionId;
    // v1.24.0: 댓글/멘션 알림 — 모달 자동 오픈 + 해당 댓글 자동 스크롤 + 펄스.
    const isCommentLikeNotif = n.type === 'comment' || n.type === 'mention';
    // v1.25.5: 액팅 피드백 알림 — 점프 시 DB read_at 처리
    const isActingFeedbackNotif = n.type === 'acting_feedback';
    const feedbackNotificationId = n.metadata?.feedbackNotificationId;
    if (isActingFeedbackNotif && feedbackNotificationId) {
      // fire-and-forget — read_at 업데이트 실패는 점프 흐름에 영향 없음
      import('@/services/supabaseService')
        .then(({ markFeedbackNotificationRead }) => markFeedbackNotificationRead(feedbackNotificationId))
        .catch((err) => console.warn('[NotificationPanel] markFeedbackNotificationRead 실패:', err));
    }
    const commentId = n.metadata?.commentId;

    if (sceneId || sceneName) {
      // 코덱스 P1 fix (2026-05-05): sceneName 이 'EP01:A:a001' 형식 sceneKey 면
      // EP/파트/sceneId 로 정확히 매칭 (raw sceneId 가 다른 EP 와 reuse 되어도 정확).
      const sceneKeyParts = typeof sceneName === 'string' && sceneName.includes(':')
        ? sceneName.split(':')
        : null;
      const sceneKeyEp = sceneKeyParts?.[0];   // 'EP01'
      const sceneKeyPart = sceneKeyParts?.[1]; // 'A'
      const sceneKeyId = sceneKeyParts?.[2];   // 'a001'

      // 씬 UUID/이름으로 에피소드를 찾아서 이동
      const episodes = useDataStore.getState().episodes;
      for (const ep of episodes) {
        for (const part of ep.parts) {
          const found = part.scenes.find(s => {
            // 1순위: UUID (가장 정확)
            if (sceneId && s.id === sceneId) return true;
            // 2순위: sceneKey 풀 매칭 ('EP01:A:a001' → ep.episodeNumber + part.partId + s.sceneId 모두 일치)
            // 코덱스 P1 fix (6차, 2026-05-05): episode 토큰 정규화 — "EP01"→1, "EP1"→1 모두 같은 episodeNumber 매칭.
            // 이전엔 String(ep.episodeNumber)='1' vs sceneKeyEp.replace(/\D/g,'')='01' → 문자열 mismatch.
            if (sceneKeyParts) {
              const sceneKeyEpNum = sceneKeyEp ? Number(sceneKeyEp.replace(/\D/g, '')) : NaN;
              const epLabelMatch = (
                (Number.isFinite(sceneKeyEpNum) && ep.episodeNumber === sceneKeyEpNum) ||
                (sceneKeyEp != null && ep.title === sceneKeyEp)
              );
              const partLabelMatch = sceneKeyPart && part.partId === sceneKeyPart;
              if (epLabelMatch && partLabelMatch && sceneKeyId && s.sceneId === sceneKeyId) return true;
            }
            // 3순위 (legacy): sceneName 이 단순 raw sceneId ('a001') 인 경우 — reuse 위험 있음
            if (!sceneKeyParts && sceneName && s.sceneId === sceneName) return true;
            return false;
          });
          if (found) {
            // 한솔 보고 (v1.15.4): part 도 같이 이동해야 다른 파트의 씬으로 가도 펄스 이펙트가 보임
            setSelectedEpisode(ep.episodeNumber);
            useAppStore.getState().setSelectedPart(part.partId);
            setHighlightSceneId(found.sceneId);
            setView('scenes');
            setPanelOpen(false);

            // 리비전 알림이면 모달 자동 오픈 + 탭/포커스.
            // 코덱스 P1 fix (2026-05-05): store-based request → ScenesView 마운트 race 제거.
            // 이전 CustomEvent dispatch 는 setView 와 같은 tick 에 발화되어 ScenesView listener
            // 등록 전에 손실될 수 있었음.
            if (isRevisionNotif) {
              useAppStore.getState().setPendingSceneModalRequest({
                sceneUuid: found.id,
                sceneName: found.sceneId,
                episodeNumber: ep.episodeNumber,
                partId: part.partId,
                initialTab: 'revisions',
                focusRevisionId: revisionId,
              });
            } else if (isCommentLikeNotif && commentId) {
              // v1.24.0: 댓글/멘션 알림 — 모달 자동 오픈 + 해당 댓글 자동 스크롤 + 펄스.
              // 코덱스 P1 fix (2026-05-10): forceDeptFilter:'all' 강제. counterpart assignee 알림을
              //   반대 부서 필터에서 클릭할 때 단일 부서 매칭 실패하던 회귀 차단 (ActivityFeed 점프와 일관).
              useAppStore.getState().setPendingSceneModalRequest({
                sceneUuid: found.id,
                sceneName: found.sceneId,
                episodeNumber: ep.episodeNumber,
                partId: part.partId,
                initialTab: 'detail',
                focusCommentId: commentId,
                forceDeptFilter: 'all',
              });
            }
            return;
          }
        }
      }
      // 매칭 실패 — 씬 뷰로만이라도 이동 + 안내 (한솔 결정: 알림 패널 씬 보기 무반응 fix)
      console.warn('[NotificationPanel] 씬 매칭 실패', { sceneId, sceneName, episodeCount: episodes.length });
      setView('scenes');
      useAppStore.getState().setToast?.({
        type: 'warning',
        message: '씬을 자동으로 찾지 못했어요. 씬 뷰에서 직접 확인해주세요.',
      });
    } else if (n.type === 'comment' || n.type === 'mention' || n.type === 'scene_change' || n.type === 'revision' || n.type === 'acting_feedback') {
      // v1.23.1 codex 1차 P2 + v1.24.0: metadata 가 비어있어도 씬 관련 알림이면 씬 뷰로 이동 + 안내.
      setView('scenes');
      useAppStore.getState().setToast?.({
        type: 'info',
        message: '알림에 씬 정보가 부족해요. 씬 뷰에서 직접 찾아주세요.',
      });
    }
    setPanelOpen(false);
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-[340px] max-h-[440px] z-[9999] rounded-xl overflow-hidden"
      style={floatingGlassStyle}
    >
      {/* 상단 빛 반사 */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: glassTopHighlight,
        }}
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/35">
        <span className="text-[13px] font-semibold text-text-primary">알림</span>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
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
      <div className="overflow-y-auto max-h-[380px] p-1.5 space-y-0.5">
        {notifications.length === 0 ? (
          <div className="py-10 text-center">
            <Bell size={24} className="mx-auto text-text-secondary/25 mb-2" />
            <p className="text-[12px] text-text-secondary/50">알림이 없습니다</p>
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem key={n.id} n={n} onNavigate={handleNavigate} />
          ))
        )}
      </div>
    </div>
  );
}
