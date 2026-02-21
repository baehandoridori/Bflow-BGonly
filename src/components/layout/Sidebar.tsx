import { LayoutDashboard, Film, List, Settings } from 'lucide-react';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';

const NAV_ITEMS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={20} /> },
  { id: 'episode', label: '에피소드', icon: <Film size={20} /> },
  { id: 'scenes', label: '씬 목록', icon: <List size={20} /> },
  { id: 'settings', label: '설정', icon: <Settings size={20} /> },
];

export function Sidebar() {
  const { currentView, setView, isTestMode } = useAppStore();

  return (
    <aside className="w-16 h-full bg-bg-card border-r border-bg-border flex flex-col items-center py-4 gap-2">
      {/* 로고 */}
      <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-white font-bold text-sm mb-4">
        Bf
      </div>

      {/* 네비게이션 */}
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => setView(item.id)}
          title={item.label}
          className={cn(
            'w-12 h-12 rounded-lg flex items-center justify-center transition-colors',
            currentView === item.id
              ? 'bg-accent/20 text-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/50'
          )}
        >
          {item.icon}
        </button>
      ))}

      {/* 하단: 테스트 모드 + 버전 */}
      <div className="mt-auto mb-2 flex flex-col items-center gap-0.5">
        {isTestMode && (
          <span className="text-[9px] text-status-low font-mono">TEST</span>
        )}
        <span className="text-[8px] text-text-secondary/50 font-mono">
          v{__APP_VERSION__}
        </span>
      </div>
    </aside>
  );
}
