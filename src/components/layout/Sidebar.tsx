import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { LayoutDashboard, Film, List, Users, CircleUser, GanttChart, CalendarDays, Palmtree, Clapperboard, MessageSquareWarning, ListChecks, Drama, Gamepad2, Settings, PanelLeft, ExternalLink } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { isNavItemHiddenForUser } from './navVisibility';
import { canAccessPlayground } from '@/features/playground/featureFlag';
import { originFromActivation } from '@/features/playground/transition/dotWipeMath';
import { usePlaygroundEntryStore } from '@/features/playground/transition/usePlaygroundEntryStore';
import { cn } from '@/utils/cn';
import { SlidingIndicator } from '@/components/ui/SlidingIndicator';
import { CountBadge } from '@/components/ui/CountBadge';
import { SplashScreen } from '@/components/splash/SplashScreen';
import { getPreset, rgbToHex } from '@/themes';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { VersionHoverTip, deriveHoverState } from './VersionHoverTip';
import { prefetchView } from '@/views/viewLoaders';
import * as gcalService from '@/services/googleCalendarService';

const GCAL_AUTH_EVENT = 'bflow:gcal-auth-changed';
type CalendarAuthState = 'checking' | 'connected' | 'disconnected';
const SIDEBAR_COLLAPSED_WIDTH = 64;
const SIDEBAR_EXPANDED_WIDTH = 192;
const SIDEBAR_LABEL_MAX_WIDTH = 120;

function readCachedCalendarAuthState(): CalendarAuthState {
  if (typeof window === 'undefined') return 'disconnected';
  try {
    return localStorage.getItem('bflow_gcal_authed') === 'true' ? 'connected' : 'disconnected';
  } catch {
    return 'disconnected';
  }
}

function getCalendarAuthLabel(calendarAuthState: CalendarAuthState) {
  if (calendarAuthState === 'connected') return '캘린더 연동됨';
  if (calendarAuthState === 'checking') return '캘린더 연동 확인 중';
  return '캘린더 미연동';
}

const NAV_ITEMS: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={20} /> },
  { id: 'episode', label: '에피소드', icon: <Film size={20} /> },
  { id: 'scenes', label: '씬 목록', icon: <List size={20} /> },
  { id: 'assignee', label: '인원별', icon: <Users size={20} /> },
  { id: 'team', label: '팀원', icon: <CircleUser size={20} /> },
  { id: 'calendar', label: '타임라인', icon: <GanttChart size={20} /> },
  { id: 'schedule', label: '캘린더', icon: <CalendarDays size={20} /> },
  { id: 'vacation', label: '휴가', icon: <Palmtree size={20} /> },
  // v1.30.0~: 컴포지팅 메뉴가 둘로 분리됨.
  //   - 'compositing' : 새 현황 대시보드 (CompositingDashboardView, 6 단계 진행도)
  //   - 'compositing-revisions' : 기존 리테이크 보드 (CompositingView)
  { id: 'compositing', label: '컴포지팅', icon: <Clapperboard size={20} /> },
  { id: 'compositing-revisions', label: '리테이크', icon: <MessageSquareWarning size={20} /> },
  // 리테이크 허브 5단계: 감독/취합자용 세트 허브 (RetakeHubView).
  { id: 'retake-hub', label: '리테이크 허브', icon: <ListChecks size={20} /> },
  // 캐릭터 현황판 — 전면 공개(정식 릴리즈).
  { id: 'character-board', label: '캐릭터', icon: <Drama size={20} /> },
  { id: 'playground', label: '배플레이그라운드', icon: <Gamepad2 size={20} /> },
  { id: 'settings', label: '설정', icon: <Settings size={20} /> },
];

/**
 * 새 창으로 열 수 있는 화면 — 펼친 사이드바에서 항목에 마우스를 올리면 오른쪽에 '새 창으로' 버튼이 뜬다.
 * 키는 화면 id 이자 새 창의 id 다(WidgetPopup 의 WIDGET_REGISTRY, main 의 WIDGET_POPUP_DEFAULTS 와 같은 값).
 */
const NAV_POPOUTS: Partial<Record<ViewMode, { title: string; hint: string; ariaLabel: string }>> = {
  'character-board': { title: '캐릭터 현황판', hint: '캐릭터 현황판을 새 창으로 열어요', ariaLabel: '캐릭터 현황판을 새 창으로 열기' },
  schedule: { title: '캘린더', hint: '캘린더를 새 창으로 열어요', ariaLabel: '캘린더를 새 창으로 열기' },
};

/** 리퀴드 글래스 스타일 B 로고 아이콘 (테마 accent 색상 반영) */
function LiquidGlassLogo({ onClick }: { onClick: () => void }) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  // 테마 accent 색상 — 매 렌더마다 직접 계산 (테마 변경 시 즉시 반영)
  const themeId = useAppStore((s) => s.themeId);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const colors = customThemeColors ?? getPreset(themeId)?.colors;
  const accent = colors?.accent ?? '108 92 231';
  const accentSub = colors?.accentSub ?? '162 155 254';
  const ac = accent.split(' ').join(', ');
  const acSub = accentSub.split(' ').join(', ');
  const acHex = rgbToHex(accent);
  const acSubHex = rgbToHex(accentSub);
  // background-clip:text 그라디언트 re-paint 강제 키
  const themeKey = `${themeId}-${accent}-${accentSub}`;

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMousePos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0.5, y: 0.5 });
  };

  // 마우스 위치에 따른 동적 라이트 포지션
  const lightX = mousePos.x * 100;
  const lightY = mousePos.y * 100;

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      title="B flow — 스플래시 보기"
      className="group relative w-10 h-10 rounded-xl mb-4 cursor-pointer transition-transform duration-300 ease-out-expo hover:scale-110 active:scale-95 active:duration-fast motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
      style={{ perspective: '200px' }}
    >
      {/* 외부 글로우 */}
      <div
        className="absolute -inset-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(${ac}, 0.4), rgba(${acSub}, 0.15), transparent 70%)`,
          filter: 'blur(6px)',
        }}
      />

      {/* 메인 글래스 레이어 — backdrop-filter 는 두지 않는다. hover 확대가 살아난 뒤로는 흐림 층까지 함께
          확대·재계산되는데, 뒤가 사이드바 단색 배경이라 흐림은 눈에 보이지 않는다(움직임 폴리싱 1번). */}
      <div
        className="relative w-full h-full rounded-xl overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.18) 0%, transparent 60%),
            linear-gradient(135deg, rgba(${ac}, 0.35) 0%, rgba(${acSub}, 0.2) 50%, rgba(${ac}, 0.1) 100%)
          `,
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: `
            0 0 0 0.5px rgba(255,255,255,0.1) inset,
            0 2px 8px rgb(var(--color-shadow) / var(--shadow-alpha)),
            0 1px 2px rgba(${ac}, 0.2)
          `,
        }}
      >
        {/* 상단 하이라이트 (유리 반사) */}
        <div
          className="absolute inset-x-0 top-0 h-[45%] rounded-t-xl pointer-events-none"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.04) 60%, transparent 100%)`,
            maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          }}
        />

        {/* 동적 라이트 리플렉션 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.25) 0%, transparent 50%)`,
          }}
        />

        {/* 무지개빛(iridescent) 셰이드 */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity duration-500"
          style={{
            background: `
              conic-gradient(
                from ${mousePos.x * 360}deg at ${lightX}% ${lightY}%,
                rgba(${ac}, 0.15),
                rgba(${acSub}, 0.1),
                rgba(${ac}, 0.08),
                rgba(${acSub}, 0.1),
                rgba(${ac}, 0.15)
              )
            `,
            mixBlendMode: 'overlay',
          }}
        />

        {/* 텍스트 — key로 테마 변경 시 강제 re-mount하여 gradient repaint 보장 */}
        <div className="relative flex items-center justify-center w-full h-full">
          <span
            key={themeKey}
            className="font-bold text-base tracking-tight"
            style={{
              background: `linear-gradient(135deg, ${acHex} 0%, ${acSubHex} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: 'none',
              filter: 'drop-shadow(0 1px 2px rgb(var(--color-shadow) / var(--shadow-alpha)))',
            }}
          >
            B
          </span>
        </div>

        {/* 하단 에지 라이트 */}
        <div
          className="absolute inset-x-0 bottom-0 h-[1px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.15) 50%, transparent 90%)',
          }}
        />
      </div>
    </button>
  );
}

export function Sidebar() {
  const { currentView, setView, sidebarExpanded, toggleSidebarExpanded } = useAppStore();
  const requestPlaygroundEntry = usePlaygroundEntryStore((state) => state.request);
  const updateInfo = useAppStore((s) => s.updateInfo);
  const setUpdateCenterOpen = useAppStore((s) => s.setUpdateCenterOpen);
  const totalOpenRevisions = useRevisionStore((s) => s.totalOpenRevisionCount);
  // v1.30.0: 컴포지팅 현황 대시보드의 '오류' 상태 카운트 — 사이드바 배지.
  // load 된 EP 만 카운트되므로 (CompositingDashboardView 진입 시점에 load) MVP 로는 충분.
  const compositingStates = useDataStore((s) => s.compositingStates);
  const compositingErrorCount = useMemo(() => {
    let n = 0;
    for (const row of compositingStates.values()) {
      if (row.status === 'error') n += 1;
    }
    return n;
  }, [compositingStates]);
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentUserName = currentUser?.name;
  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => item.id !== 'playground' || canAccessPlayground(currentUser))
        // 휴가 탭 등: 지정된 사용자에게는 숨김
        .filter((item) => !isNavItemHiddenForUser(item.id, currentUserName)),
    [currentUser, currentUserName],
  );
  const [showSplash, setShowSplash] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [calendarAuthState, setCalendarAuthState] = useState<CalendarAuthState>(() => readCachedCalendarAuthState());

  const isExpanded = sidebarExpanded;
  const isVisuallyExpanded = isExpanded || isHovered;
  // 피드백 59(코덱스 2차): 새 창 버튼(캐릭터·캘린더)은 사이드바 폭 전환(350ms)이 끝난 뒤에만 그린다 —
  //   펼쳐지는 동안 좁은 행에서 아이콘 위에 겹쳐 클릭을 가로채지 않게.
  const [navPopoutReady, setNavPopoutReady] = useState(false);
  useEffect(() => {
    if (!isVisuallyExpanded) {
      setNavPopoutReady(false);
      return;
    }
    const timer = setTimeout(() => setNavPopoutReady(true), 350);
    return () => clearTimeout(timer);
  }, [isVisuallyExpanded]);
  const hasRemoteUpdate = Boolean(
    updateInfo
    && updateInfo.latestVersion !== updateInfo.currentVersion
    && updateInfo.status !== 'suppressed'
    && updateInfo.status !== 'up-to-date',
  );
  const hasUpdateIssue = updateInfo?.status === 'failed' || updateInfo?.status === 'suppressed';
  // v1.23.0: 브라우저 기본 title 대신 floating 툴팁 사용 (사이드바 좁아 native title 이 창 밖으로 삐져나오는 문제 해결)
  const hoverState = deriveHoverState(updateInfo);
  const formattedBuildAt = (() => {
    if (!updateInfo?.buildAt) return undefined;
    const d = new Date(updateInfo.buildAt);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  })();
  const [versionTipShow, setVersionTipShow] = useState(false);
  const versionTipTimer = useRef<ReturnType<typeof setTimeout>>();
  const versionAnchorRef = useRef<HTMLSpanElement>(null);
  const handleVersionEnter = useCallback(() => {
    if (versionTipTimer.current) clearTimeout(versionTipTimer.current);
    versionTipTimer.current = setTimeout(() => setVersionTipShow(true), 250);
  }, []);
  const handleVersionLeave = useCallback(() => {
    if (versionTipTimer.current) clearTimeout(versionTipTimer.current);
    setVersionTipShow(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyAuthState = (authed: boolean) => {
      if (!cancelled) setCalendarAuthState(authed ? 'connected' : 'disconnected');
    };

    setCalendarAuthState((prev) => (prev === 'connected' ? prev : 'checking'));
    gcalService.isAuthenticated()
      .then(applyAuthState)
      .catch(() => {
        if (!cancelled) setCalendarAuthState(readCachedCalendarAuthState());
      });

    const handleAuthChanged = (event: Event) => {
      const authed = (event as CustomEvent<{ authed?: boolean }>).detail?.authed;
      if (typeof authed === 'boolean') {
        applyAuthState(authed);
        return;
      }
      setCalendarAuthState(readCachedCalendarAuthState());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'bflow_gcal_authed') applyAuthState(event.newValue === 'true');
    };

    window.addEventListener(GCAL_AUTH_EVENT, handleAuthChanged as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(GCAL_AUTH_EVENT, handleAuthChanged as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 누르자마자 선택 표시가 출발하게(움직임 폴리싱 7번): 표시는 이 사이드바 안 상태로 먼저 그리고(flushSync),
  //   무거운 새 화면 그리기(setView)는 그 프레임이 화면에 나간 다음(rAF → setTimeout)으로 미룬다.
  //   표시는 합성 스레드에서 미끄러지므로 새 화면을 그리는 동안에도 멈추지 않는다.
  //   단축키·알림 링크처럼 클릭 없이 바뀐 화면은 currentView 를 그대로 따라간다(from 이 달라지면 무시).
  const [pendingNav, setPendingNav] = useState<{ view: ViewMode; from: ViewMode } | null>(null);
  const shownView = pendingNav && pendingNav.from === currentView ? pendingNav.view : currentView;
  const navScheduleRef = useRef<{ frame: number | null; timers: ReturnType<typeof setTimeout>[] }>({ frame: null, timers: [] });
  const cancelScheduledNav = useCallback(() => {
    const schedule = navScheduleRef.current;
    if (schedule.frame !== null) cancelAnimationFrame(schedule.frame);
    schedule.timers.forEach((timer) => clearTimeout(timer));
    schedule.frame = null;
    schedule.timers = [];
  }, []);
  useEffect(() => cancelScheduledNav, [cancelScheduledNav]);
  const goToView = useCallback((view: ViewMode) => {
    cancelScheduledNav();
    if (view === currentView) {
      setPendingNav(null);
      setView(view);
      return;
    }
    flushSync(() => setPendingNav({ view, from: currentView }));
    const schedule = navScheduleRef.current;
    let applied = false;
    const apply = () => {
      if (applied) return;
      applied = true;
      cancelScheduledNav();
      // 같은 작업 안의 두 갱신은 한 번에 그려진다 — 화면과 표시가 함께 확정된다.
      setView(view);
      setPendingNav(null);
    };
    schedule.frame = requestAnimationFrame(() => {
      schedule.frame = null;
      schedule.timers.push(setTimeout(apply, 0));
    });
    // 창이 가려져 rAF 가 멈춘 경우에도 화면은 바뀌어야 한다.
    schedule.timers.push(setTimeout(apply, 120));
  }, [cancelScheduledNav, currentView, setView]);

  const handleToggle = useCallback(async () => {
    toggleSidebarExpanded();
    const next = !sidebarExpanded;
    const prefs = await loadPreferences() ?? {};
    await savePreferences({ ...prefs, sidebarExpanded: next });
  }, [sidebarExpanded, toggleSidebarExpanded]);

  const handleMouseEnter = useCallback(() => {
    if (sidebarExpanded) return;
    clearTimeout(hoverTimeoutRef.current);
    setIsHovered(true);
  }, [sidebarExpanded]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  }, []);

  const sidebarBg = `
    linear-gradient(180deg, transparent 55%, rgb(var(--color-accent) / 0.07) 78%, rgb(var(--color-accent-sub) / 0.12) 100%),
    rgb(var(--color-bg-card))
  `;

  return (
    <>
      {/* 레이아웃 공간 확보용 스페이서 */}
      <div
        className="shrink-0"
        style={{
          width: isExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
          transition: 'width 350ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />

      {/* 실제 사이드바 (fixed — 호버 시 콘텐츠 안 밀림) */}
      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="fixed top-0 left-0 h-full border-r border-bg-border flex flex-col py-4 gap-2 overflow-hidden z-40"
        style={{
          width: isVisuallyExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
          transition: 'width 350ms cubic-bezier(0.4, 0, 0.2, 1)',
          background: sidebarBg,
        }}
      >
        {/* 로고 — 항상 중앙 고정 */}
        <div className="w-16 flex justify-center shrink-0 mb-1">
          <LiquidGlassLogo onClick={() => setShowSplash(true)} />
        </div>

        {/* 네비게이션 — 선택 표시(보라 알약)는 하나만 두고 활성 메뉴로 세로로 미끄러진다(움직임 폴리싱 7번).
            가로 자리는 CSS(left-2 right-2)라 사이드바 펼침(폭 350ms)과 겹쳐도 따로 놀지 않는다. */}
        <SlidingIndicator
          activeKey={shownView}
          axis="y"
          timing="rail"
          deps={[navItems]}
          className="left-2 right-2 rounded-lg bg-accent/20"
        />
        {navItems.map((item) => {
          const navButton = (
          <button
            data-slide-key={item.id}
            onClick={(event) => {
              if (item.id === 'playground') {
                cancelScheduledNav();
                setPendingNav(null);
                requestPlaygroundEntry(originFromActivation(
                  event.clientX,
                  event.clientY,
                  event.detail,
                  event.currentTarget.getBoundingClientRect(),
                ));
              } else {
                goToView(item.id);
              }
            }}
            // 설명 말풍선(title) 없음: 접힌 사이드바는 마우스를 올리는 순간 펼쳐져 같은 이름이 옆에 나타난다.
            // title 을 두면 펼쳐지는 이름 위에 같은 글자의 말풍선이 겹쳐 떴다(움직임 폴리싱 2번).
            // 움직임 폴리싱 12번: 마우스를 올리는(포커스하는) 순간 그 화면 코드를 미리 받아 둔다 —
            //   누를 때 로딩 동그라미 없이 바로 그린다. 올린 항목만(전부 미리 받으면 입력이 막힌다).
            onMouseEnter={() => prefetchView(item.id)}
            onFocus={() => prefetchView(item.id)}
            className={cn(
              'flex items-center cursor-pointer w-full h-10 rounded-lg',
              'bf-press',
              // 배경은 위의 미끄러지는 표시가 맡는다 — 여기서는 글자색만.
              shownView === item.id
                ? 'text-accent'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/50 group-hover/nav:text-text-primary group-hover/nav:bg-bg-border/50',
            )}
          >
            {/* 아이콘: 항상 w-12 내 중앙 → 펼침/접힘 무관 동일 위치 */}
            <span className="shrink-0 w-12 flex justify-center relative">
              {item.icon}
              {item.id === 'schedule' && (
                <span
                  aria-label={getCalendarAuthLabel(calendarAuthState)}
                  title={getCalendarAuthLabel(calendarAuthState)}
                  className={cn(
                    'absolute -top-0.5 right-1.5 h-2.5 w-2.5 rounded-full border border-bg-card shadow-[0_0_0_1px_rgba(0,0,0,0.18)]',
                    calendarAuthState === 'checking' && 'animate-pulse',
                  )}
                  style={{
                    backgroundColor: calendarAuthState === 'connected'
                      ? '#22C55E'
                      : calendarAuthState === 'checking'
                        ? '#FDCB6E'
                        : '#8B8DA3',
                  }}
                >
                  <span className="sr-only">{getCalendarAuthLabel(calendarAuthState)}</span>
                </span>
              )}
              {/* 숫자 배지: 늘면 '톡', 0 이 되면 작게 줄며 사라진다(움직임 폴리싱 7번). */}
              {item.id === 'compositing-revisions' && (
                <CountBadge
                  count={totalOpenRevisions}
                  className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1"
                  style={{ backgroundColor: '#FDCB6E', color: '#1A1D27' }}
                  title={`미해결 리테이크 ${totalOpenRevisions}개`}
                />
              )}
              {item.id === 'compositing' && (
                <CountBadge
                  count={compositingErrorCount}
                  className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1"
                  style={{ backgroundColor: 'var(--status-error)', color: '#fff' }}
                  title={`오류 ${compositingErrorCount}개`}
                />
              )}
            </span>
            <span
              className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis"
              style={{
                maxWidth: isVisuallyExpanded ? SIDEBAR_LABEL_MAX_WIDTH : 0,
                opacity: isVisuallyExpanded ? 1 : 0,
                paddingRight: isVisuallyExpanded ? 8 : 0,
                transition: 'max-width 350ms cubic-bezier(0.4, 0, 0.2, 1), opacity 250ms ease 80ms, padding 350ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {item.label}
            </span>
          </button>
          );
          // 피드백 59: 새 창으로 열 수 있는 항목(캐릭터·캘린더 — NAV_POPOUTS)은 펼침 상태에서 우측에 '새 창으로' 버튼을
          //   띄운다 — 현재 화면을 떠나지 않고 그 화면을 별도 창으로 연다. 버튼 안에 버튼을 두지 않기 위해 nav 버튼의
          //   형제로 absolute 배치. (래퍼가 자리(mx-2·shrink-0)를 맡고, nav 버튼은 w-full 로 그 안을 채운다.)
          const popout = NAV_POPOUTS[item.id];
          const showPopout = popout !== undefined && isVisuallyExpanded && navPopoutReady
            && typeof window.electronAPI?.widgetOpenPopup === 'function';
          return (
            <div key={item.id} className="group/nav relative shrink-0 mx-2">
              {navButton}
              {showPopout && popout && (
                <button
                  type="button"
                  onClick={() => { void window.electronAPI?.widgetOpenPopup?.(item.id, popout.title); }}
                  title={popout.hint}
                  aria-label={popout.ariaLabel}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-text-secondary/60 invisible group-hover/nav:visible group-focus-within/nav:visible hover:bg-bg-border/60 hover:text-text-primary cursor-pointer"
                >
                  <ExternalLink size={14} />
                </button>
              )}
            </div>
          );
        })}

        {/* 하단: 토글 + 버전 (항상 같은 위치)
            v1.27.0: 새 버전 배지를 사이드바 우측 contour 밖으로 돌출시키기 위해
            이 컨테이너만 overflow-visible 적용. aside 본체는 overflow-hidden 유지 (네비 라벨 보호). */}
        <div className="mt-auto flex flex-col items-center gap-1.5 w-16 shrink-0 overflow-visible">
          <button
            onClick={handleToggle}
            className="bf-press w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary/40 hover:text-text-primary hover:bg-bg-border/50 cursor-pointer"
            title={isExpanded ? '사이드바 접기' : '사이드바 펼치기'}
          >
            <PanelLeft
              size={14}
              className={cn('transition-transform duration-200', isExpanded && 'rotate-180')}
            />
          </button>
          <span
            ref={versionAnchorRef}
            className="relative text-[11px] text-text-secondary/50 font-mono whitespace-nowrap"
            onMouseEnter={handleVersionEnter}
            onMouseLeave={handleVersionLeave}
          >
            <button
              type="button"
              onClick={() => setUpdateCenterOpen(true)}
              className={cn(
                'relative rounded-lg px-2 py-1 font-mono text-[11px] transition-all duration-200',
                hasRemoteUpdate
                  ? 'cursor-pointer text-accent-sub bg-accent/10 border border-accent/25 shadow-[0_0_18px_rgb(var(--color-accent)/0.14)] hover:bg-accent/18 hover:border-accent/40'
                  : hasUpdateIssue
                    ? 'cursor-pointer text-[#FDCB6E] bg-[#FDCB6E]/10 border border-[#FDCB6E]/25 hover:bg-[#FDCB6E]/15'
                    : updateInfo
                      ? 'cursor-pointer text-text-secondary/70 border border-bg-border/40 hover:text-text-primary hover:bg-bg-border/35'
                      : 'cursor-pointer text-text-secondary/60 border border-bg-border/25 hover:text-text-primary hover:bg-bg-border/30',
              )}
              aria-label={hoverState === 'available'
                ? `새 버전 v${updateInfo?.latestVersion} 준비됨 · 업데이트 내역 열기`
                : '업데이트 내역 열기'}
            >
              v{__APP_VERSION__}
              {hasRemoteUpdate && (
                <span
                  aria-hidden="true"
                  className="bflow-badge-pulse absolute h-3 w-3 rounded-full bg-[#FDCB6E]"
                  style={{ right: '-8px', top: '-4px' }}
                />
              )}
            </button>
          </span>
          <VersionHoverTip
            show={versionTipShow}
            anchorRef={versionAnchorRef}
            state={hoverState}
            currentVersion={__APP_VERSION__}
            latestVersion={updateInfo?.latestVersion ?? __APP_VERSION__}
            buildAt={formattedBuildAt}
            message={updateInfo?.message}
          />
        </div>
      </aside>

      {/* 스플래시 오버레이 (이스터에그) */}
      <AnimatePresence>
        {showSplash && (
          <SplashScreen onComplete={() => setShowSplash(false)} />
        )}
      </AnimatePresence>
    </>
  );
}
