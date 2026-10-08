import { useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Sun, Moon, Database, FileSpreadsheet } from 'lucide-react';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { cn } from '@/utils/cn';
import { useMotionPref } from '@/hooks/useMotionPref';
import { EASE_CSS, MOTION_MS, animateEl } from '@/utils/motion';
import { UserMenu } from '@/components/auth/UserMenu';
import { NotificationBell } from '@/components/NotificationPanel';
import { HeaderPointsBadge } from './HeaderPointsBadge';
import { HeaderSyncStatus } from './HeaderSyncStatus';
import { resolveHeaderTitle } from './headerTitle';

interface HeaderProps {
  activeView: ViewMode;
  onRefresh: () => void;
}

export function Header({ activeView, onRefresh }: HeaderProps) {
  const colorMode = useAppStore((s) => s.colorMode);
  const toggleColorMode = useAppStore((s) => s.toggleColorMode);
  const activeDataSource = useAppStore((s) => s.activeDataSource);
  const navigationBackTarget = useAppStore((s) => s.navigationBackStack[s.navigationBackStack.length - 1] ?? null);
  const goBackNavigation = useAppStore((s) => s.goBackNavigation);
  const episodeDashboardEp = useAppStore((s) => s.episodeDashboardEp);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const headerTitle = resolveHeaderTitle(activeView, episodeDashboardEp, episodeTitles);

  // 움직임 폴리싱 18번: '돌아가기'가 생기거나 없어질 때 제목이 순간이동하지 않고 스르륵 비켜선다(FLIP).
  // 바뀌기 직전 자리는 렌더 단계에서 잰다(DOM 이 아직 옛 상태) — useStackFlip 과 같은 방식.
  const { reduce } = useMotionPref();
  const hasBack = navigationBackTarget !== null;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const committedHasBackRef = useRef(hasBack);
  const titleLeftBeforeRef = useRef<number | null>(null);
  if (committedHasBackRef.current !== hasBack && titleLeftBeforeRef.current === null && titleRef.current) {
    titleLeftBeforeRef.current = titleRef.current.offsetLeft;
  }
  useLayoutEffect(() => {
    if (committedHasBackRef.current === hasBack) {
      titleLeftBeforeRef.current = null;
      return;
    }
    committedHasBackRef.current = hasBack;
    const before = titleLeftBeforeRef.current;
    titleLeftBeforeRef.current = null;
    const title = titleRef.current;
    if (before === null || !title) return;
    const shift = before - title.offsetLeft;
    if (Math.abs(shift) < 1) return;
    animateEl(
      title,
      [{ transform: `translateX(${shift}px)` }, { transform: 'translateX(0)' }],
      { duration: MOTION_MS.base, easing: EASE_CSS.snap },
      reduce,
    );
  });

  return (
    // z-40: 본문의 sticky 헤더(z-30)보다 위여야 한다. 알림 패널이 이 헤더 안에 붙어 있어서,
    // 여기가 본문과 같은 z이면 패널이 z-[9999]여도 뒤에 그려진 본문에 가린다.
    // 모달 백드롭(z-40이지만 DOM상 뒤)과 설정 모달(z-50)은 여전히 헤더를 덮는다.
    // data-tooltip-placement: 헤더 버튼 설명 말풍선은 버튼 아래로 — 종 아이콘과 빨간 배지(오른쪽 위)를 덮지 않는다.
    <header className="relative z-40 h-14 shrink-0 bg-bg-card border-b border-bg-border flex items-center justify-between px-6" data-tooltip-placement="below">
      {/* 왼쪽: 현재 뷰 제목 */}
      <div className="flex min-w-0 items-center gap-3">
        {navigationBackTarget && (
          <button
            type="button"
            onClick={goBackNavigation}
            title={`${navigationBackTarget.label}로 돌아가기`}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-accent/25 bg-accent/10 px-2.5',
              'bf-press text-xs font-medium text-accent hover:border-accent/40 hover:bg-accent/18',
              // 생길 때 왼쪽에서 밀려 나온다(160ms, motion-comments-notify.css). 없어질 땐 바로.
              'bf-back-in',
            )}
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">돌아가기</span>
          </button>
        )}
        {/* 화면이 바뀌면 제목만 120ms 페이드(key 로 다시 마운트될 때 한 번) — 움직임 폴리싱 12번.
            h1 은 '돌아가기' 생김·없어짐 FLIP(18번)을 맡고, 페이드는 안쪽 span 에만 건다(두 움직임이 섞이지 않게). */}
        <h1 ref={titleRef} className="truncate text-lg font-semibold"><span key={headerTitle} className="bf-view-title">{headerTitle}</span></h1>
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

        {/* 동기화 상태 + 새로고침 (자동은 조용히, 직접 누른 새로고침만 아이콘이 돈다) */}
        <HeaderSyncStatus onRefresh={onRefresh} />

        {/* 다크/라이트 모드 토글 */}
        <button
          onClick={toggleColorMode}
          title={colorMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          className="bf-press p-2 rounded-lg hover:bg-bg-border/50"
        >
          {colorMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* 알림 벨 */}
        <NotificationBell />

        {/* 보유 포인트 배지 (배플레이그라운드 접근 권한자만) */}
        <HeaderPointsBadge />

        {/* 구분선 */}
        <div className="w-px h-6 bg-bg-border" />

        {/* 사용자 메뉴 */}
        <UserMenu />
      </div>
    </header>
  );
}
