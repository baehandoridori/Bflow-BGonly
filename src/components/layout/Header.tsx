import { RefreshCw, Pencil, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  const { currentView, isEditMode, setEditMode } = useAppStore();
  const { isSyncing, lastSyncTime } = useDataStore();

  const VIEW_TITLES: Record<string, string> = {
    dashboard: '전체 현황 대시보드',
    episode: '에피소드별 현황',
    scenes: '씬 목록',
    settings: '설정',
  };

  const lastSyncLabel = lastSyncTime
    ? `마지막 동기화: ${new Date(lastSyncTime).toLocaleTimeString('ko-KR')}`
    : '동기화 대기 중';

  return (
    <header className="h-14 bg-bg-card border-b border-bg-border flex items-center justify-between px-6">
      {/* 왼쪽: 현재 뷰 제목 */}
      <h1 className="text-lg font-semibold">{VIEW_TITLES[currentView] ?? ''}</h1>

      {/* 오른쪽: 액션 버튼들 */}
      <div className="flex items-center gap-3">
        {/* 동기화 상태 */}
        <span className="text-xs text-text-secondary">{lastSyncLabel}</span>

        {/* 새로고침 */}
        <button
          onClick={onRefresh}
          disabled={isSyncing}
          title="데이터 새로고침"
          className={cn(
            'p-2 rounded-lg hover:bg-bg-border/50 transition-colors',
            isSyncing && 'animate-spin text-accent'
          )}
        >
          <RefreshCw size={18} />
        </button>

        {/* 레이아웃 편집 (대시보드에서만) */}
        {currentView === 'dashboard' && (
          <>
            <button
              onClick={() => setEditMode(!isEditMode)}
              title={isEditMode ? '편집 완료' : '레이아웃 편집'}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors',
                isEditMode
                  ? 'bg-accent text-white'
                  : 'bg-bg-border/50 text-text-secondary hover:text-text-primary'
              )}
            >
              <Pencil size={14} />
              {isEditMode ? '편집 완료' : '레이아웃 편집'}
            </button>
            {isEditMode && (
              <button
                onClick={() => {
                  useAppStore.getState().setWidgetLayout(null as unknown as never);
                  setEditMode(false);
                }}
                title="레이아웃 초기화"
                className="p-2 rounded-lg hover:bg-bg-border/50 text-text-secondary transition-colors"
              >
                <RotateCcw size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
