import { useEffect, useRef } from 'react';
import { Bell, Check, Trash2, MessageSquare, RefreshCw, Award } from 'lucide-react';
import { useNotificationStore, type AppNotification, type NotificationType } from '@/stores/useNotificationStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';

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
  const cfg = typeConfig(n.type);
  const Icon = cfg.icon;

  return (
    <button
      onClick={() => {
        if (!n.isRead) markAsRead(n.id);
        onNavigate(n);
      }}
      className={cn(
        'w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors cursor-pointer rounded-lg',
        n.isRead
          ? 'hover:bg-white/[0.03]'
          : 'bg-white/[0.03] hover:bg-white/[0.06]',
      )}
    >
      {/* 미읽 바 */}
      <div className="flex-shrink-0 w-0.5 self-stretch rounded-full" style={{
        backgroundColor: n.isRead ? 'transparent' : cfg.color,
      }} />

      {/* 아이콘 */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={14} style={{ color: n.isRead ? '#8B8DA3' : cfg.color }} />
      </div>

      {/* 내용 */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-[12px] leading-tight truncate',
          n.isRead ? 'text-text-secondary/60' : 'text-text-primary font-medium',
        )}>
          {n.title}
        </p>
        {n.body && (
          <p className="text-[11px] text-text-secondary/40 mt-0.5 truncate">{n.body}</p>
        )}
        <span className="text-[10px] text-text-secondary/30 mt-1 block">{timeAgo(n.createdAt)}</span>
      </div>
    </button>
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
            setSelectedEpisode(ep.episodeNumber);
            setHighlightSceneId(found.sceneId);
            setView('scenes');
            setPanelOpen(false);
            return;
          }
        }
      }
    }
    setPanelOpen(false);
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-[340px] max-h-[440px] z-[9999] rounded-xl overflow-hidden"
      style={{
        background: 'rgba(26, 29, 39, 0.92)',
        backdropFilter: 'blur(24px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}
    >
      {/* 상단 빛 반사 */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.3) 50%, transparent 90%)',
        }}
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
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
              className="text-[10px] text-text-secondary/40 hover:text-red-400 flex items-center gap-1 cursor-pointer"
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
            <Bell size={24} className="mx-auto text-text-secondary/20 mb-2" />
            <p className="text-[12px] text-text-secondary/30">알림이 없습니다</p>
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
