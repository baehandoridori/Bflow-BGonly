import { ArrowLeft, RefreshCw, Sun, Moon, Database, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';
import { UserMenu } from '@/components/auth/UserMenu';
import { NotificationBell } from '@/components/NotificationPanel';

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  const { currentView, colorMode, toggleColorMode } = useAppStore();
  const activeDataSource = useAppStore((s) => s.activeDataSource);
  const navigationBackTarget = useAppStore((s) => s.navigationBackStack[s.navigationBackStack.length - 1] ?? null);
  const goBackNavigation = useAppStore((s) => s.goBackNavigation);
  const episodeDashboardEp = useAppStore((s) => s.episodeDashboardEp);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const { isSyncing, lastSyncTime } = useDataStore();

  const VIEW_TITLES: Record<string, string> = {
    dashboard: '전체 현황 대시보드',
    episode: '에피소드별 현황',
    scenes: '씬 목록',
    assignee: '인원별 현황',
    calendar: '타임라인',
    vacation: '휴가 관리',
    settings: '설정',
  };

  // 에피소드 대시보드 모드일 때 제목 변경
  const headerTitle = currentView === 'dashboard' && episodeDashboardEp !== null
    ? `${episodeTitles[episodeDashboardEp] || `EP.${String(episodeDashboardEp).padStart(2, '0')}`} 대시보드`
    : (VIEW_TITLES[currentView] ?? '');

  const lastSyncLabel = lastSyncTime
    ? `마지막 동기화: ${new Date(lastSyncTime).toLocaleTimeString('ko-KR')}`
    : '동기화 대기 중';

  return (
    <header className="relative z-30 h-14 shrink-0 bg-bg-card border-b border-bg-border flex items-center justify-between px-6">
      {/* 왼쪽: 현재 뷰 제목 */}
      <div className="flex min-w-0 items-center gap-3">
        {navigationBackTarget && (
          <button
            type="button"
            onClick={goBackNavigation}
            title={`${navigationBackTarget.label}로 돌아가기`}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5',
              'text-xs font-medium text-accent transition-colors hover:border-accent/40 hover:bg-accent/18',
            )}
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">돌아가기</span>
          </button>
        )}
        <h1 className="truncate text-lg font-semibold">{headerTitle}</h1>
      </div>

      {/* 오른쪽: 액션 버튼들 */}
      <div className="flex items-center gap-3">
        {/* 데이터 소스 뱃지 (아이콘만) */}
        {activeDataSource && (
          <div className="flex items-center gap-2 mr-1" title={`현재 연결: ${activeDataSource}`}>
            <span className={cn(
              'flex items-center justify-center w-6 h-6 rounded-md',
              activeDataSource === 'supabase'
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-amber-500/10 text-amber-500'
            )}>
              {activeDataSource === 'supabase' ? <Database size={14} /> : <FileSpreadsheet size={14} />}
            </span>
          </div>
        )}

        {/* 동기화 상태 (인디케이터) */}
        <div
          className="flex items-center gap-2 text-xs text-text-secondary mr-1"
          title={lastSyncLabel}
        >
          {isSyncing ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              동기화 중...
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-emerald-500" />
              최신 상태
            </span>
          )}
        </div>

        {/* 새로고침 */}
        <button
          onClick={onRefresh}
          disabled={isSyncing}
          title="데이터 새로고침"
          className={cn(
            'p-2 rounded-lg hover:bg-bg-border/50 transition-colors text-text-secondary hover:text-text-primary',
            isSyncing && 'animate-spin text-accent'
          )}
        >
          <RefreshCw size={18} />
        </button>

        {/* 다크/라이트 모드 토글 */}
        <button
          onClick={toggleColorMode}
          title={colorMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          className="p-2 rounded-lg hover:bg-bg-border/50 transition-colors"
        >
          {colorMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* 알림 벨 */}
        <NotificationBell />

        {/* 구분선 */}
        <div className="w-px h-6 bg-bg-border" />

        {/* 사용자 메뉴 */}
        <UserMenu />
      </div>
    </header>
  );
}
