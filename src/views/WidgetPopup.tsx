import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Droplets, Eye, Pin, PinOff, Minus, BarChart3 } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { MyTasksWidget } from '@/components/widgets/MyTasksWidget';
import { WidgetIdContext, IsPopupContext } from '@/components/widgets/Widget';
import { loadTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
import { readAllFromSheets, checkConnection, connectSheets, loadSheetsConfig, readMetadataFromSheets } from '@/services/sheetsService';
import { readTestSheet, readLocalMetadata } from '@/services/testSheetService';
import type { Episode } from '@/types';
import { getPreset, getLightColors, applyTheme } from '@/themes';
import { DEFAULT_WEB_APP_URL } from '@/config';

// 모듈 레벨 쿨다운: sheetsNotifyChange 호출 시 자체 변경 감지
let _reloadCooldown = false;
const _COOLDOWN_MS = 3000;

/** 팝업 위젯에서 시트 변경 알림 시 이 래퍼를 사용 (쿨다운 자동 적용) */
export function notifySheetChangeWithCooldown() {
  _reloadCooldown = true;
  setTimeout(() => { _reloadCooldown = false; }, _COOLDOWN_MS);
  return window.electronAPI?.sheetsNotifyChange?.();
}

const WIDGET_REGISTRY: Record<string, { label: string; component: React.ReactNode }> = {
  'overall-progress': { label: '전체 진행률', component: <OverallProgressWidget /> },
  'stage-bars': { label: '단계별 진행률', component: <StageBarsWidget /> },
  'assignee-cards': { label: '담당자별 현황', component: <AssigneeCardsWidget /> },
  'episode-summary': { label: '에피소드 요약', component: <EpisodeSummaryWidget /> },
  'dept-comparison': { label: '부서별 비교', component: <DepartmentComparisonWidget /> },
  'calendar': { label: '캘린더', component: <CalendarWidget /> },
  'my-tasks': { label: '내 할일', component: <MyTasksWidget /> },
};

/**
 * 위젯 팝업 윈도우 전용 렌더러
 * Windows Acrylic 네이티브 블러 + CSS 글래스 틴트 + AOT 핀 + 독 모드
 */
export function WidgetPopup({ widgetId }: { widgetId: string }) {
  const [appOpacity, setAppOpacity] = useState(0.92);
  const [glassIntensity, setGlassIntensity] = useState(0.7);
  const [showControls, setShowControls] = useState(false);
  const [ready, setReady] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showHandle, setShowHandle] = useState(false);
  const handleHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AOT (Always On Top) — 기본: 켜짐
  const [isAOT, setIsAOT] = useState(true);

  // 독 모드 (최소화 → 플로팅 아이콘)
  const [isDocked, setIsDocked] = useState(false);
  const [isDockHover, setIsDockHover] = useState(false);
  const dockHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마우스 위치 추적 → 상단 영역별 호버 감지
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const inHandleZone = y < 40;
    if (inHandleZone) {
      if (handleHideTimerRef.current) { clearTimeout(handleHideTimerRef.current); handleHideTimerRef.current = null; }
      setShowHandle(true);
    } else if (!inHandleZone && showHandle) {
      if (!handleHideTimerRef.current) {
        handleHideTimerRef.current = setTimeout(() => {
          setShowHandle(false);
          handleHideTimerRef.current = null;
        }, 200);
      }
    }

    const inControlZone = x > rect.width * 0.4 && y < 48;
    if (inControlZone) {
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      setShowControls(true);
    } else if (!inControlZone && showControls) {
      if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          setShowControls(false);
          hideTimerRef.current = null;
        }, 300);
      }
    }
  }, [showControls, showHandle]);

  const handleMouseLeave = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (handleHideTimerRef.current) { clearTimeout(handleHideTimerRef.current); handleHideTimerRef.current = null; }
    setShowControls(false);
    setShowHandle(false);
  }, []);

  // 포커스 변경 감지 (Acrylic 회색 fallback 대응)
  useEffect(() => {
    const cleanup = window.electronAPI?.onWidgetFocusChange?.((focused) => {
      setIsFocused(focused);
    });
    return () => { cleanup?.(); };
  }, []);

  // 독 모드 변경 감지 (네이티브 최소화 인터셉트 포함)
  useEffect(() => {
    const cleanup = window.electronAPI?.onWidgetDockChange?.((docked) => {
      setIsDocked(docked);
      if (!docked) setIsDockHover(false);
    });
    return () => { cleanup?.(); };
  }, []);

  // 실시간 데이터 동기화: sheet:changed 이벤트 + 주기적 폴링 (30초)
  useEffect(() => {
    if (!ready) return;

    const loadEpMetadata = async (episodes: Episode[], connected: boolean) => {
      const readMeta = connected ? readMetadataFromSheets : readLocalMetadata;
      const [titleResults, memoResults] = await Promise.all([
        Promise.all(episodes.map((ep) =>
          readMeta('episode-title', String(ep.episodeNumber))
            .then((d) => [ep.episodeNumber, d?.value] as const)
            .catch(() => [ep.episodeNumber, undefined] as const),
        )),
        Promise.all(episodes.map((ep) =>
          readMeta('episode-memo', String(ep.episodeNumber))
            .then((d) => [ep.episodeNumber, d?.value] as const)
            .catch(() => [ep.episodeNumber, undefined] as const),
        )),
      ]);
      const titles: Record<number, string> = {};
      const memos: Record<number, string> = {};
      for (const [num, val] of titleResults) if (val) titles[num] = val;
      for (const [num, val] of memoResults) if (val) memos[num] = val;
      useDataStore.getState().setEpisodeTitles(titles);
      useDataStore.getState().setEpisodeMemos(memos);
    };

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadData = async () => {
      try {
        const api = window.electronAPI;
        if (!api) return;

        const connected = await checkConnection();
        if (connected) {
          const episodes = await readAllFromSheets();
          useDataStore.getState().setEpisodes(episodes);
          loadEpMetadata(episodes, true).catch(() => {});
        } else {
          const cfg = await loadSheetsConfig();
          const urlToConnect = cfg?.webAppUrl || DEFAULT_WEB_APP_URL;
          if (urlToConnect) {
            const result = await connectSheets(urlToConnect);
            if (result.ok) {
              const episodes = await readAllFromSheets();
              useDataStore.getState().setEpisodes(episodes);
              loadEpMetadata(episodes, true).catch(() => {});
            }
          }
        }

        const users = await loadUsers();
        useAuthStore.getState().setUsers(users);
      } catch (err) {
        console.error('[WidgetPopup] 동기화 실패:', err);
      }
    };

    const cleanupEvent = window.electronAPI?.onSheetChanged?.(() => {
      if (_reloadCooldown) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { reloadData(); }, _COOLDOWN_MS + 500);
        return;
      }
      reloadData();
    });

    const pollInterval = setInterval(() => {
      if (!_reloadCooldown) reloadData();
    }, 30_000);

    return () => {
      cleanupEvent?.();
      clearInterval(pollInterval);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [ready]);

  // 테마 + 데이터 초기화
  useEffect(() => {
    // Acrylic 모드: HTML/Body를 투명하게 하여 네이티브 블러가 보이도록
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    (async () => {
      try {
        const saved = await loadTheme();
        if (saved) {
          const savedMode = saved.colorMode ?? 'dark';
          useAppStore.getState().setThemeId(saved.themeId);
          useAppStore.getState().setColorMode(savedMode);
          if (saved.customColors) useAppStore.getState().setCustomThemeColors(saved.customColors);
          let colors = saved.customColors ?? (savedMode === 'light' ? getLightColors(saved.themeId) : getPreset(saved.themeId)?.colors);
          if (colors) applyTheme(colors, savedMode);
        }

        const api = window.electronAPI;
        if (!api) { setReady(true); return; }

        const { isTestMode } = await api.getMode();
        useAppStore.getState().setTestMode(isTestMode);
        useAppStore.getState().setDashboardDeptFilter('all');

        let connected = await checkConnection();
        if (!connected) {
          const cfg = await loadSheetsConfig();
          const urlToConnect = cfg?.webAppUrl || DEFAULT_WEB_APP_URL;
          if (urlToConnect) {
            const result = await connectSheets(urlToConnect);
            connected = result.ok;
          }
        }
        useAppStore.getState().setSheetsConnected(connected);

        let loadedEpisodes: Episode[];
        if (connected) {
          loadedEpisodes = await readAllFromSheets();
        } else {
          loadedEpisodes = await readTestSheet();
        }
        useDataStore.getState().setEpisodes(loadedEpisodes);

        const readMeta = connected ? readMetadataFromSheets : readLocalMetadata;
        const [titleResults, memoResults] = await Promise.all([
          Promise.all(loadedEpisodes.map((ep) =>
            readMeta('episode-title', String(ep.episodeNumber))
              .then((d) => [ep.episodeNumber, d?.value] as const)
              .catch(() => [ep.episodeNumber, undefined] as const),
          )),
          Promise.all(loadedEpisodes.map((ep) =>
            readMeta('episode-memo', String(ep.episodeNumber))
              .then((d) => [ep.episodeNumber, d?.value] as const)
              .catch(() => [ep.episodeNumber, undefined] as const),
          )),
        ]);
        const titles: Record<number, string> = {};
        const memos: Record<number, string> = {};
        for (const [num, val] of titleResults) if (val) titles[num] = val;
        for (const [num, val] of memoResults) if (val) memos[num] = val;
        useDataStore.getState().setEpisodeTitles(titles);
        useDataStore.getState().setEpisodeMemos(memos);

        const users = await loadUsers();
        useAuthStore.getState().setUsers(users);
        const { user } = await loadSession();
        if (user) useAuthStore.getState().setCurrentUser(user);
      } catch (err) {
        console.error('[WidgetPopup] 초기화 실패:', err);
      }
      setReady(true);
    })();
  }, []);

  const widgetMeta = WIDGET_REGISTRY[widgetId];

  const handleClose = useCallback(() => {
    window.electronAPI?.widgetClosePopup?.(widgetId);
  }, [widgetId]);

  const handleAppOpacity = useCallback((val: number) => {
    const clamped = Math.max(0.15, Math.min(1, val));
    setAppOpacity(clamped);
    window.electronAPI?.widgetSetOpacity?.(widgetId, clamped);
  }, [widgetId]);

  const handleToggleAOT = useCallback(() => {
    const next = !isAOT;
    setIsAOT(next);
    window.electronAPI?.widgetSetAlwaysOnTop?.(widgetId, next);
  }, [widgetId, isAOT]);

  const handleMinimize = useCallback(() => {
    setIsDocked(true);
    window.electronAPI?.widgetMinimizeToDock?.(widgetId);
  }, [widgetId]);

  const handleRestore = useCallback(() => {
    setIsDocked(false);
    setIsDockHover(false);
    window.electronAPI?.widgetRestoreFromDock?.(widgetId);
  }, [widgetId]);

  // 독 호버: 윈도우 확장/축소
  const handleDockMouseEnter = useCallback(() => {
    if (dockHoverTimerRef.current) { clearTimeout(dockHoverTimerRef.current); dockHoverTimerRef.current = null; }
    setIsDockHover(true);
    window.electronAPI?.widgetDockExpand?.(widgetId);
  }, [widgetId]);

  const handleDockMouseLeave = useCallback(() => {
    if (dockHoverTimerRef.current) clearTimeout(dockHoverTimerRef.current);
    dockHoverTimerRef.current = setTimeout(() => {
      setIsDockHover(false);
      window.electronAPI?.widgetDockCollapse?.(widgetId);
    }, 300);
  }, [widgetId]);

  if (!widgetMeta) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-white/50 text-sm"
        style={{ background: 'transparent' }}>
        알 수 없는 위젯: {widgetId}
      </div>
    );
  }

  // 글래스 틴트 계산 (Acrylic이 블러 담당, CSS는 틴트/반사만)
  // 포커스 잃으면 틴트를 진하게 올려 Acrylic 회색 fallback을 가림
  const baseTintAlpha = 0.3 + (1 - glassIntensity) * 0.5;  // 0.3~0.8
  const tintAlpha = isFocused ? baseTintAlpha : 0.92;
  const borderAlpha = 0.06 + glassIntensity * 0.14;
  const reflectAlpha = isFocused ? glassIntensity * 0.15 : 0.02;

  // ── 독 모드: 축소(pill) → 호버 시 확장(위젯 프리뷰) ──
  if (isDocked) {
    // 축소 상태: 위젯 이름 pill (140×36, 경량 렌더링)
    if (!isDockHover) {
      return (
        <div
          className="dock-pill h-screen w-screen overflow-hidden cursor-pointer select-none"
          style={{
            background: `rgb(var(--color-bg-card) / 0.92)`,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            willChange: 'transform',
          }}
          onMouseEnter={handleDockMouseEnter}
          onClick={handleRestore}
        >
          <div className="flex items-center justify-center gap-1.5 px-3 h-full">
            <BarChart3 size={13} className="text-text-secondary shrink-0" />
            <span className="text-[11px] text-text-primary font-medium leading-none truncate max-w-[100px]">
              {widgetMeta.label}
            </span>
          </div>
        </div>
      );
    }

    // 확장 상태: 원본 글래스 스타일 + 위젯 프리뷰
    return (
      <div
        className="dock-expanded h-screen w-screen flex flex-col overflow-hidden"
        style={{
          background: `rgb(var(--color-bg-primary) / ${tintAlpha})`,
          cursor: 'pointer',
          animation: 'dock-expand-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
        onMouseLeave={handleDockMouseLeave}
        onMouseEnter={() => {
          if (dockHoverTimerRef.current) { clearTimeout(dockHoverTimerRef.current); dockHoverTimerRef.current = null; }
        }}
        onClick={handleRestore}
      >
        {/* 유리 반사 하이라이트 */}
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: '40%',
            background: `linear-gradient(180deg, rgba(255,255,255,${reflectAlpha * 1.2}) 0%, rgba(255,255,255,${reflectAlpha * 0.2}) 30%, transparent 100%)`,
            maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          }}
        />
        {/* 모서리 굴절 효과 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
            boxShadow: `
              inset 0 0 ${Math.round(glassIntensity * 20)}px rgba(255,255,255,${reflectAlpha * 0.4}),
              inset 0 0 ${Math.round(glassIntensity * 4)}px rgba(255,255,255,${reflectAlpha * 0.8}),
              0 0 0 1px rgba(255,255,255,${borderAlpha * 0.5}) inset,
              0 1px 0 rgba(255,255,255,${reflectAlpha}) inset
            `,
          }}
        />
        {/* 위젯 콘텐츠 (비활성 프리뷰) */}
        <div className="flex-1 overflow-hidden relative z-10" style={{ pointerEvents: 'none' }}>
          <IsPopupContext.Provider value={true}>
          <WidgetIdContext.Provider value={widgetId}>
            <div className="h-full overflow-auto">
              {ready ? widgetMeta.component : null}
            </div>
          </WidgetIdContext.Provider>
          </IsPopupContext.Provider>
        </div>
        {/* 클릭하여 열기 오버레이 */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium text-text-primary/80"
            style={{ background: 'rgb(var(--color-bg-card) / 0.6)', backdropFilter: 'blur(8px)' }}>
            클릭하여 열기
          </span>
        </div>
      </div>
    );
  }

  // ── 일반 모드 UI (Acrylic 네이티브 블러) ──
  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        background: `rgb(var(--color-bg-primary) / ${tintAlpha})`,
        transition: 'background 0.3s ease, opacity 0.2s ease',
        animation: 'dock-restore-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── 유리 반사 하이라이트 (상단) ── */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: '40%',
          background: `linear-gradient(180deg, rgba(255,255,255,${reflectAlpha * 1.2}) 0%, rgba(255,255,255,${reflectAlpha * 0.2}) 30%, transparent 100%)`,
          maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
        }}
      />

      {/* ── 모서리 굴절 효과 ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
          boxShadow: `
            inset 0 0 ${Math.round(glassIntensity * 20)}px rgba(255,255,255,${reflectAlpha * 0.4}),
            inset 0 0 ${Math.round(glassIntensity * 4)}px rgba(255,255,255,${reflectAlpha * 0.8}),
            0 0 0 1px rgba(255,255,255,${borderAlpha * 0.5}) inset,
            0 1px 0 rgba(255,255,255,${reflectAlpha}) inset
          `,
        }}
      />

      {/* ── 상단 드래그 핸들 ── */}
      <div
        className="shrink-0 relative z-20 flex items-center justify-center"
        style={{
          WebkitAppRegion: 'drag',
          height: '28px',
          cursor: showHandle ? 'grab' : 'default',
        } as React.CSSProperties}
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: '48px',
            height: '6px',
            background: 'rgba(255, 255, 255, 0.2)',
            opacity: showHandle ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        />
      </div>

      {/* ── 오른쪽 위 호버 시 컨트롤 ── */}
      {showControls && (
        <div
          className="absolute top-0 right-0 z-30 flex items-center gap-2 px-2.5"
          style={{
            WebkitAppRegion: 'no-drag',
            height: '28px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.35) 30%, rgba(0,0,0,0.5) 100%)',
            borderBottomLeftRadius: '8px',
          } as React.CSSProperties}
          onMouseEnter={() => {
            if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
            setShowControls(true);
          }}
        >
          {/* 앱 오퍼시티 */}
          <div className="flex items-center gap-1" title="앱 투명도">
            <Eye size={11} className="text-white/40" />
            <input type="range" min={15} max={100}
              value={Math.round(appOpacity * 100)}
              onChange={(e) => handleAppOpacity(Number(e.target.value) / 100)}
              className="w-11 h-1 cursor-pointer" />
          </div>

          {/* 글래스 틴트 */}
          <div className="flex items-center gap-1" title="글래스 효과">
            <Droplets size={11} className="text-white/40" />
            <input type="range" min={0} max={100}
              value={Math.round(glassIntensity * 100)}
              onChange={(e) => setGlassIntensity(Number(e.target.value) / 100)}
              className="w-11 h-1 cursor-pointer" />
          </div>

          {/* AOT 핀 토글 */}
          <button
            onClick={handleToggleAOT}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center transition-colors cursor-pointer"
            style={{
              background: isAOT ? 'rgba(108, 92, 231, 0.7)' : 'rgba(255,255,255,0.15)',
            }}
            title={isAOT ? '항상 위에 표시 (켜짐)' : '항상 위에 표시 (꺼짐)'}
          >
            {isAOT
              ? <Pin size={9} className="text-white" strokeWidth={3} />
              : <PinOff size={9} className="text-white/60" strokeWidth={2.5} />}
          </button>

          {/* 최소화 (독 모드) */}
          <button
            onClick={handleMinimize}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-yellow-500/70 hover:bg-yellow-500 transition-colors cursor-pointer"
            title="최소화"
          >
            <Minus size={9} className="text-white" strokeWidth={3} />
          </button>

          {/* 닫기 */}
          <button
            onClick={handleClose}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-red-500/70 hover:bg-red-500 transition-colors cursor-pointer ml-0.5"
          >
            <X size={9} className="text-white" strokeWidth={3} />
          </button>
        </div>
      )}

      {/* ── 위젯 콘텐츠 ── */}
      <div className="flex-1 overflow-hidden relative z-10">
        <IsPopupContext.Provider value={true}>
        <WidgetIdContext.Provider value={widgetId}>
          <div className="h-full overflow-auto">
            {ready ? widgetMeta.component : (
              <div className="flex items-center justify-center h-full">
                <span className="text-sm text-white/30 animate-pulse">로딩 중...</span>
              </div>
            )}
          </div>
        </WidgetIdContext.Provider>
        </IsPopupContext.Provider>
      </div>
    </div>
  );
}
