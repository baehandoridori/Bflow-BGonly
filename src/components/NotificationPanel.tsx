import { useEffect, useRef } from 'react';
import { Bell, Check, Trash2, MessageSquare, RefreshCw, Award, ExternalLink } from 'lucide-react';
import { useNotificationStore, type AppNotification, type NotificationType } from '@/stores/useNotificationStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';
import { floatingGlassStyle, glassTopHighlight } from '@/utils/glassStyles';

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
    case 'comment': return { icon: MessageSquare, color: '#6C5CE7', label: '댓글' };
    case 'milestone': return { icon: Award, color: '#00B894', label: '마일스톤' };
    case 'system': return { icon: Bell, color: '#8B8DA3', label: '시스템' };
  }
}

// ─── 알림 항목 ───────────────────────────────────────
function NotificationItem({ n, onNavigate }: { n: AppNotification; onNavigate: (n: AppNotification) => void }) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const cfg = typeConfig(n.type);
  const Icon = cfg.icon;
  const hasNavigateTarget = !!(n.metadata?.sceneId || n.metadata?.sceneName);

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
          : 'bg-accent/[0.08] hover:bg-accent/[0.12]',
      )}
    >
      {/* 미읽 바 */}
      <div className="flex-shrink-0 w-0.5 self-stretch rounded-full" style={{
        backgroundColor: n.isRead ? 'transparent' : cfg.color,
      }} />

      {/* 아이콘 */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={14} style={{ color: n.isRead ? 'rgb(var(--color-text-secondary) / 0.55)' : cfg.color }} />
      </div>

      {/* 내용 — truncate 된 텍스트는 호버 시 GlobalTooltip 으로 전체 노출 */}
      <div className="flex-1 min-w-0">
        <p
          title={n.title}
          className={cn(
            'text-[12px] leading-tight truncate',
            n.isRead ? 'text-text-secondary/80' : 'text-text-primary font-medium',
          )}
        >
          {n.title}
        </p>
        {n.body && (
          <p
            title={n.body}
            className={`text-[11px] text-text-secondary/65 mt-0.5 ${
              n.body.includes('\n') ? 'whitespace-pre-line break-words' : 'truncate'
            }`}
          >
            {n.body}
          </p>
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
  const { unreadCount, panelOpen, togglePanel } = useNotificationStore();

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        title="알림"
        className={cn(
          'p-2 rounded-lg transition-colors relative cursor-pointer',
          panelOpen ? 'bg-accent/15 text-accent' : 'hover:bg-bg-border/50',
        )}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
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
    if (sceneId || sceneName) {
      // 씬 UUID/이름으로 에피소드를 찾아서 이동
      const episodes = useDataStore.getState().episodes;
      for (const ep of episodes) {
        for (const part of ep.parts) {
          const found = part.scenes.find(s =>
            (sceneId && s.id === sceneId) || (sceneName && s.sceneId === sceneName),
          );
          if (found) {
            // 한솔 보고 (v1.15.4): part 도 같이 이동해야 다른 파트의 씬으로 가도 펄스 이펙트가 보임
            setSelectedEpisode(ep.episodeNumber);
            useAppStore.getState().setSelectedPart(part.partId);
            setHighlightSceneId(found.sceneId);
            setView('scenes');
            setPanelOpen(false);
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
