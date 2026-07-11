import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LayoutDashboard, Film, List, Users, CircleUser, GanttChart, CalendarDays, Palmtree, Clapperboard, MessageSquareWarning, ListChecks, Drama, Gamepad2, Settings, PanelLeft, Plus } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCharacterBoardAccessState } from '@/hooks/useCharacterBoardAccess';
import { isNavItemHiddenForUser } from './navVisibility';
import { canAccessPlayground } from '@/features/playground/featureFlag';
import { originFromActivation } from '@/features/playground/transition/dotWipeMath';
import { usePlaygroundEntryStore } from '@/features/playground/transition/usePlaygroundEntryStore';
import { cn } from '@/utils/cn';
import { SplashScreen } from '@/components/splash/SplashScreen';
import { getPreset, rgbToHex } from '@/themes';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { VersionHoverTip, deriveHoverState } from './VersionHoverTip';
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
  // 캐릭터 현황판 — 게이팅 허용 사용자에게만 노출 (Sidebar 가 access 플래그로 필터).
  { id: 'character-board', label: '캐릭터', icon: <Drama size={20} /> },
  { id: 'playground', label: '배플레이그라운드', icon: <Gamepad2 size={20} /> },
  { id: 'settings', label: '설정', icon: <Settings size={20} /> },
];

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
      className="group relative w-10 h-10 rounded-xl mb-4 cursor-pointer transition-transform duration-300 hover:scale-110 active:scale-95"
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

      {/* 메인 글래스 레이어 */}
      <div
        className="relative w-full h-full rounded-xl overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at ${lightX}% ${lightY}%, rgba(255,255,255,0.18) 0%, transparent 60%),
            linear-gradient(135deg, rgba(${ac}, 0.35) 0%, rgba(${acSub}, 0.2) 50%, rgba(${ac}, 0.1) 100%)
          `,
          backdropFilter: 'blur(20px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
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

/** GAP-H/I-A5: 캐릭터 메뉴 권한 확인 실패 안내 — VersionHoverTip 과 동일한 floating 툴팁 패턴.
 *  사이드바가 overflow:hidden 이라 native title 대신 createPortal + getBoundingClientRect 로 body 에 렌더. */
function CharacterAccessRetryTip({ show, anchorRef }: { show: boolean; anchorRef: React.RefObject<HTMLElement> }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!show) return;
    let frame: number | null = null;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextLeft = rect.right + 12;
      const nextTop = rect.top + rect.height / 2;
      setPos((prev) => (prev && prev.left === nextLeft && prev.top === nextTop ? prev : { left: nextLeft, top: nextTop }));
    };
    // 사이드바 호버 펼침 애니메이션 동안 anchor 가 계속 이동 — VersionHoverTip 과 동일하게 RAF 로 동기화.
    const loop = () => {
      update();
      frame = requestAnimationFrame(loop);
    };
    update();
    frame = requestAnimationFrame(loop);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [show, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      role="tooltip"
      className={`fixed z-[10050] bg-bg-card/97 border border-bg-border rounded-[10px] px-3.5 py-2.5 max-w-[280px] shadow-[0_18px_40px_rgba(0,0,0,0.45)] text-[12px] text-text-primary leading-relaxed pointer-events-none transition-opacity duration-150 ${show ? 'opacity-100' : 'opacity-0'}`}
      style={{ left: pos.left, top: pos.top, transform: 'translateY(-50%)' }}
    >
      {/* 좌측 화살표 */}
      <div
        className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0"
        style={{
          borderTop: '7px solid transparent',
          borderBottom: '7px solid transparent',
          borderRight: '8px solid rgb(var(--color-bg-border))',
        }}
      />
      권한 정보를 확인하지 못했어요 — 클릭해서 다시 확인
    </div>,
    document.body,
  );
}

export function Sidebar() {
  const { currentView, setView, sidebarExpanded, toggleSidebarExpanded } = useAppStore();
  const requestPlaygroundEntry = usePlaygroundEntryStore((state) => state.request);
  const setPendingCharacterAddRequest = useAppStore((s) => s.setPendingCharacterAddRequest);
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
  // 캐릭터 현황판 게이팅 — 허용 사용자가 아니면 메뉴 항목 자체를 숨김 (fail-closed).
  //   예외(GAP-H/I-A5): 권한 '조회 실패'(error) 시에는 숨기는 대신 흐린 상태 + 경고 점으로 남겨
  //   클릭으로 재확인(retry)할 수 있게 한다 — 순단 때 권한자 메뉴가 통째로 사라지면 재시도 UI 에 도달할 수 없다.
  //   loading 중과 정상 차단(무권한)은 기존과 동일하게 숨김.
  const characterAccess = useCharacterBoardAccessState();
  const characterAccessFailed = characterAccess.error && !characterAccess.allowed;
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentUserName = currentUser?.name;
  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => item.id !== 'character-board' || characterAccess.allowed || characterAccessFailed)
        .filter((item) => item.id !== 'playground' || canAccessPlayground(currentUser))
        // 휴가 탭 등: 지정된 사용자에게는 숨김
        .filter((item) => !isNavItemHiddenForUser(item.id, currentUserName)),
    [characterAccess.allowed, characterAccessFailed, currentUser, currentUserName],
  );
  const [accessTipShow, setAccessTipShow] = useState(false);
  const accessTipTimer = useRef<ReturnType<typeof setTimeout>>();
  const accessAnchorRef = useRef<HTMLButtonElement>(null);
  const handleAccessTipEnter = useCallback(() => {
    if (accessTipTimer.current) clearTimeout(accessTipTimer.current);
    accessTipTimer.current = setTimeout(() => setAccessTipShow(true), 250);
  }, []);
  const handleAccessTipLeave = useCallback(() => {
    if (accessTipTimer.current) clearTimeout(accessTipTimer.current);
    setAccessTipShow(false);
  }, []);
  const [showSplash, setShowSplash] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [calendarAuthState, setCalendarAuthState] = useState<CalendarAuthState>(() => readCachedCalendarAuthState());

  const isExpanded = sidebarExpanded;
  const isVisuallyExpanded = isExpanded || isHovered;
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

        {/* 네비게이션 */}
        {navItems.map((item) => {
          // GAP-H: 권한 조회 실패 시 캐릭터 메뉴는 뷰 이동 대신 재확인(retry) 트리거가 된다.
          const isAccessRetryItem = item.id === 'character-board' && characterAccessFailed;
          // B6: 권한 있는 캐릭터 항목엔 펼침/hover 시 '+' 로 바로 추가 창을 연다.
          const isCharacterAddItem = item.id === 'character-board' && characterAccess.allowed && !characterAccessFailed;
          const navButton = (
          <button
            ref={isAccessRetryItem ? accessAnchorRef : undefined}
            onClick={(event) => {
              if (isAccessRetryItem) {
                handleAccessTipLeave();
                characterAccess.retry();
              } else if (item.id === 'playground') {
                requestPlaygroundEntry(originFromActivation(
                  event.clientX,
                  event.clientY,
                  event.detail,
                  event.currentTarget.getBoundingClientRect(),
                ));
              } else {
                setView(item.id);
              }
            }}
            onMouseEnter={isAccessRetryItem ? handleAccessTipEnter : undefined}
            onMouseLeave={isAccessRetryItem ? handleAccessTipLeave : undefined}
            title={isAccessRetryItem || isVisuallyExpanded ? undefined : item.label}
            aria-label={isAccessRetryItem ? `${item.label} — 권한 정보를 확인하지 못했어요. 클릭해서 다시 확인` : undefined}
            className={cn(
              'flex items-center cursor-pointer shrink-0 h-10 mx-2 rounded-lg',
              'transition-colors duration-200',
              isAccessRetryItem
                ? 'text-text-secondary/50 hover:text-text-secondary hover:bg-bg-border/30'
                : currentView === item.id
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/50',
            )}
          >
            {/* 아이콘: 항상 w-12 내 중앙 → 펼침/접힘 무관 동일 위치 */}
            <span className="shrink-0 w-12 flex justify-center relative">
              {item.icon}
              {isAccessRetryItem && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 right-1.5 h-2.5 w-2.5 rounded-full border border-bg-card shadow-[0_0_0_1px_rgba(0,0,0,0.18)]"
                  style={{ backgroundColor: 'rgb(var(--char-stage-feedback))' }}
                />
              )}
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
              {item.id === 'compositing-revisions' && totalOpenRevisions > 0 && (
                <span
                  className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1"
                  style={{ backgroundColor: '#FDCB6E', color: '#1A1D27' }}
                  title={`미해결 리테이크 ${totalOpenRevisions}개`}
                >
                  {totalOpenRevisions}
                </span>
              )}
              {item.id === 'compositing' && compositingErrorCount > 0 && (
                <span
                  className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1"
                  style={{ backgroundColor: 'var(--status-error)', color: '#fff' }}
                  title={`오류 ${compositingErrorCount}개`}
                >
                  {compositingErrorCount}
                </span>
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
          if (isCharacterAddItem) {
            return (
              <div key={item.id} className="relative">
                {navButton}
                {isVisuallyExpanded && (
                  <button
                    type="button"
                    aria-label="캐릭터 추가"
                    title="캐릭터 추가"
                    onClick={(e) => { e.stopPropagation(); setView('character-board'); setPendingCharacterAddRequest(true); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-text-secondary hover:text-accent hover:bg-accent/15 transition-colors cursor-pointer"
                  >
                    <Plus size={15} />
                  </button>
                )}
              </div>
            );
          }
          return <div key={item.id} className="contents">{navButton}</div>;
        })}
        <CharacterAccessRetryTip show={accessTipShow && characterAccessFailed} anchorRef={accessAnchorRef} />

        {/* 하단: 토글 + 버전 (항상 같은 위치)
            v1.27.0: 새 버전 배지를 사이드바 우측 contour 밖으로 돌출시키기 위해
            이 컨테이너만 overflow-visible 적용. aside 본체는 overflow-hidden 유지 (네비 라벨 보호). */}
        <div className="mt-auto flex flex-col items-center gap-1.5 w-16 shrink-0 overflow-visible">
          <button
            onClick={handleToggle}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary/40 hover:text-text-primary hover:bg-bg-border/50 transition-all duration-200 cursor-pointer"
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
