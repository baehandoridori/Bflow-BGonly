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
import { MemoWidget } from '@/components/widgets/MemoWidget';
import { VacationWidget } from '@/components/widgets/VacationWidget';
import { WhiteboardWidget } from '@/components/widgets/whiteboard/WhiteboardWidget';
import { EpOverallProgressWidget } from '@/components/widgets/episode/EpOverallProgressWidget';
import { EpStageBarsWidget } from '@/components/widgets/episode/EpStageBarsWidget';
import { EpAssigneeCardsWidget } from '@/components/widgets/episode/EpAssigneeCardsWidget';
import { EpPartProgressWidget } from '@/components/widgets/episode/EpPartProgressWidget';
import { EpDeptComparisonWidget } from '@/components/widgets/episode/EpDeptComparisonWidget';
import { EpSinglePartWidget } from '@/components/widgets/episode/EpSinglePartWidget';
import { WidgetIdContext, IsPopupContext } from '@/components/widgets/Widget';
import { loadTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
import { readAllFromSheets, checkConnection, connectSheets, loadSheetsConfig, readMetadataFromSheets } from '@/services/sheetsService';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
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
  'vacation-today': { label: '휴가자 현황', component: <VacationWidget /> },
  'memo': { label: '메모', component: <MemoWidget /> },
  'whiteboard': { label: '화이트보드', component: <WhiteboardWidget /> },
  'ep-overall-progress': { label: 'EP 통합 진행률', component: <EpOverallProgressWidget /> },
  'ep-stage-bars': { label: 'EP 단계별 진행률', component: <EpStageBarsWidget /> },
  'ep-assignee-cards': { label: 'EP 담당자별 현황', component: <EpAssigneeCardsWidget /> },
  'ep-part-progress': { label: 'EP 파트별 진행률', component: <EpPartProgressWidget /> },
  'ep-dept-comparison': { label: 'EP 부서별 비교', component: <EpDeptComparisonWidget /> },
};

/**
 * 위젯 팝업 윈도우 전용 렌더러
 * Windows Acrylic 네이티브 블러 + CSS 글래스 틴트 + AOT 핀 + 독 모드
 */
export function WidgetPopup({ widgetId }: { widgetId: string }) {
  const [appOpacity, setAppOpacity] = useState(1);
  const [glassIntensity, setGlassIntensity] = useState(0.7);
  const [showControls, setShowControls] = useState(false);
  const [showBottomControls, setShowBottomControls] = useState(false);
  const [ready, setReady] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showHandle, setShowHandle] = useState(false);
  const handleHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AOT (Always On Top) — 기본: 켜짐
  const [isAOT, setIsAOT] = useState(true);

  // 독 모드 (최소화 → 플로팅 아이콘)
  const [isDocked, setIsDocked] = useState(false);
  const [isDockHover, setIsDockHover] = useState(false);
  const dockHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모핑 전환 상태: 'idle' | 'minimizing' | 'restoring'
  const [morphState, setMorphState] = useState<'idle' | 'minimizing' | 'restoring'>('idle');

  // 마우스 위치 추적 → 상단(컨트롤) + 하단(슬라이더) 영역별 호버 감지
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 상단 드래그 핸들 영역 (위 40px)
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

    // 상단 컨트롤 영역 (위 60px 전체 — 핀/최소화/닫기, 넉넉한 감지 영역)
    const inControlZone = y < 60;
    if (inControlZone) {
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      setShowControls(true);
    } else if (!inControlZone && showControls) {
      if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          setShowControls(false);
          hideTimerRef.current = null;
        }, 600);
      }
    }

    // 하단 우측 슬라이더 영역 (아래 48px, 오른쪽 60%)
    const inBottomZone = y > rect.height - 48 && x > rect.width * 0.4;
    if (inBottomZone) {
      if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
      setShowBottomControls(true);
    } else if (!inBottomZone && showBottomControls) {
      if (!bottomHideTimerRef.current) {
        bottomHideTimerRef.current = setTimeout(() => {
          setShowBottomControls(false);
          bottomHideTimerRef.current = null;
        }, 400);
      }
    }
  }, [showControls, showHandle, showBottomControls]);

  const handleMouseLeave = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (handleHideTimerRef.current) { clearTimeout(handleHideTimerRef.current); handleHideTimerRef.current = null; }
    if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
    setShowControls(false);
    setShowHandle(false);
    setShowBottomControls(false);
  }, []);

  // 윈도우 바깥에서 진입 시에도 호버 감지 (onMouseMove만으로는 외부→내부 진입 미감지)
  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // 상단 60px 이내면 핸들 + 컨트롤 모두 표시 (넉넉한 영역)
    if (y < 60) {
      setShowHandle(true);
      setShowControls(true);
    }
    if (y > rect.height - 48 && x > rect.width * 0.4) setShowBottomControls(true);
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

  // 저장된 opacity/AOT 복원 (Phase 0-6)
  useEffect(() => {
    window.electronAPI?.widgetGetSavedState?.(widgetId).then((saved) => {
      if (saved) {
        setAppOpacity(saved.opacity);
        setIsAOT(saved.alwaysOnTop);
        // BrowserWindow에도 실제 투명도 적용
        window.electronAPI?.widgetSetOpacity?.(widgetId, saved.opacity);
      }
    });
  }, [widgetId]);

  // 실시간 데이터 동기화: sheet:changed 이벤트 + 주기적 폴링 (30초)
  useEffect(() => {
    if (!ready) return;

    const loadEpMetadata = async (episodes: Episode[]) => {
      const [titleResults, memoResults] = await Promise.all([
        Promise.all(episodes.map((ep) =>
          readMetadataFromSheets('episode-title', String(ep.episodeNumber))
            .then((d) => [ep.episodeNumber, d?.value] as const)
            .catch(() => [ep.episodeNumber, undefined] as const),
        )),
        Promise.all(episodes.map((ep) =>
          readMetadataFromSheets('episode-memo', String(ep.episodeNumber))
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
          loadEpMetadata(episodes).catch(() => {});
        } else {
          // 재연결 시도
          const cfg = await loadSheetsConfig();
          const urlToConnect = cfg?.webAppUrl || DEFAULT_WEB_APP_URL;
          if (urlToConnect) {
            const result = await connectSheets(urlToConnect);
            if (result.ok) {
              const episodes = await readAllFromSheets();
              useDataStore.getState().setEpisodes(episodes);
              loadEpMetadata(episodes).catch(() => {});
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

        // 휴가 API 자동 연결
        const vacConfig = await loadVacationConfig();
        if (vacConfig?.webAppUrl) {
          const vacResult = await connectVacation(vacConfig.webAppUrl);
          if (vacResult.ok) {
            useAppStore.getState().setVacationConnected(true);
          }
        }

        if (connected) {
          const loadedEpisodes = await readAllFromSheets();
          useDataStore.getState().setEpisodes(loadedEpisodes);

          const [titleResults, memoResults] = await Promise.all([
            Promise.all(loadedEpisodes.map((ep) =>
              readMetadataFromSheets('episode-title', String(ep.episodeNumber))
                .then((d) => [ep.episodeNumber, d?.value] as const)
                .catch(() => [ep.episodeNumber, undefined] as const),
            )),
            Promise.all(loadedEpisodes.map((ep) =>
              readMetadataFromSheets('episode-memo', String(ep.episodeNumber))
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
        } else {
          console.warn('[WidgetPopup] 시트 연결 실패 — 빈 상태로 시작');
          useDataStore.getState().setEpisodes([]);
        }

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

  // 정확 매칭 → 접두사 매칭 (memo-{timestamp}, calendar-{timestamp} 등 다중 인스턴스 지원)
  const widgetMeta = WIDGET_REGISTRY[widgetId]
    ?? (widgetId.startsWith('memo-') ? WIDGET_REGISTRY['memo']
    : widgetId.startsWith('calendar-') ? WIDGET_REGISTRY['calendar']
    : widgetId.startsWith('my-tasks-') ? WIDGET_REGISTRY['my-tasks']
    : widgetId.startsWith('ep-part-') ? { label: '파트별 상세', component: <EpSinglePartWidget /> }
    : undefined);

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
    setMorphState('minimizing');
    // 콘텐츠 페이드아웃 시작 후 네이티브 모핑 호출
    setTimeout(() => {
      setIsDocked(true);
      window.electronAPI?.widgetMinimizeToDock?.(widgetId);
      // 모핑 완료 후 idle 복귀
      setTimeout(() => setMorphState('idle'), 400);
    }, 60);
  }, [widgetId]);

  const handleRestore = useCallback(() => {
    setMorphState('restoring');
    setIsDocked(false);
    setIsDockHover(false);
    window.electronAPI?.widgetRestoreFromDock?.(widgetId);
    // 모핑 완료 후 idle 복귀
    setTimeout(() => setMorphState('idle'), 400);
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
      <div className="h-screen w-screen flex items-center justify-center text-text-primary/50 text-sm"
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
          className="dock-pill w-full h-full overflow-hidden cursor-pointer select-none"
          style={{
            background: `rgb(var(--color-bg-card) / 0.92)`,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            willChange: 'transform, opacity',
            animation: 'morph-dock-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
          onMouseEnter={handleDockMouseEnter}
          onClick={handleRestore}
        >
          <div className="flex items-center justify-center gap-1.5 px-2 h-full w-full">
            <BarChart3 size={12} className="text-text-secondary shrink-0" />
            <span className="text-[11px] text-text-primary font-medium leading-none truncate">
              {widgetMeta.label}
            </span>
          </div>
        </div>
      );
    }

    // 확장 상태: 원본 글래스 스타일 + 위젯 프리뷰
    return (
      <div
        className="dock-expanded w-full h-full flex flex-col overflow-hidden"
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
  const isMinimizing = morphState === 'minimizing';
  const isRestoring = morphState === 'restoring';
  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        background: `rgb(var(--color-bg-primary) / ${tintAlpha})`,
        transition: 'background 0.3s ease, opacity 0.35s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        ...(isMinimizing ? {
          opacity: 0,
          transform: 'scale(0.8)',
        } : isRestoring ? {
          animation: 'morph-restore-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        } : {}),
      }}
      onMouseEnter={handleMouseEnter}
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

      {/* ── 상단 컨트롤 (핀/최소화/닫기) — 항상 렌더링, opacity로 전환 ── */}
      {/* no-drag 영역이 항상 존재해야 drag region이 마우스 이벤트를 삼키지 않음 */}
      <div
        className="absolute top-0 right-0 z-30 flex items-center gap-2 px-2.5"
        style={{
          WebkitAppRegion: 'no-drag',
          height: '28px',
          background: showControls
            ? 'linear-gradient(90deg, transparent 0%, rgb(var(--color-shadow) / 0.35) 30%, rgb(var(--color-shadow) / 0.5) 100%)'
            : 'transparent',
          borderBottomLeftRadius: '8px',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, background 0.2s ease',
        } as React.CSSProperties}
        onMouseEnter={() => {
          if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
          setShowControls(true);
        }}
      >
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
            ? <Pin size={9} className="text-on-accent" strokeWidth={3} />
            : <PinOff size={9} className="text-text-primary/60" strokeWidth={2.5} />}
        </button>

        {/* 최소화 (독 모드) */}
        <button
          onClick={handleMinimize}
          className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-yellow-500/70 hover:bg-yellow-500 transition-colors cursor-pointer"
          title="최소화"
        >
          <Minus size={9} className="text-text-primary" strokeWidth={3} />
        </button>

        {/* 닫기 */}
        <button
          onClick={handleClose}
          className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-red-500/70 hover:bg-red-500 transition-colors cursor-pointer ml-0.5"
        >
          <X size={9} className="text-text-primary" strokeWidth={3} />
        </button>
      </div>

      {/* ── 우하단 슬라이더 (오퍼시티/글래스) — 항상 렌더링, opacity로 전환 ── */}
      <div
        className="absolute bottom-0 right-0 z-30 flex items-center gap-2 px-2.5"
        style={{
          WebkitAppRegion: 'no-drag',
          height: '28px',
          background: showBottomControls
            ? 'linear-gradient(90deg, transparent 0%, rgb(var(--color-shadow) / 0.35) 30%, rgb(var(--color-shadow) / 0.5) 100%)'
            : 'transparent',
          borderTopLeftRadius: '8px',
          opacity: showBottomControls ? 1 : 0,
          pointerEvents: showBottomControls ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, background 0.2s ease',
        } as React.CSSProperties}
        onMouseEnter={() => {
          if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
          setShowBottomControls(true);
        }}
      >
        {/* 앱 오퍼시티 */}
        <div className="flex items-center gap-1" title="앱 투명도">
          <Eye size={11} className="text-text-secondary/60" />
          <input type="range" min={15} max={100}
            value={Math.round(appOpacity * 100)}
            onChange={(e) => handleAppOpacity(Number(e.target.value) / 100)}
            className="w-11 h-1 cursor-pointer" />
        </div>

        {/* 글래스 틴트 */}
        <div className="flex items-center gap-1" title="글래스 효과">
          <Droplets size={11} className="text-text-secondary/60" />
          <input type="range" min={0} max={100}
            value={Math.round(glassIntensity * 100)}
            onChange={(e) => setGlassIntensity(Number(e.target.value) / 100)}
            className="w-11 h-1 cursor-pointer" />
        </div>
      </div>

      {/* ── 위젯 콘텐츠 ── */}
      <div className="flex-1 overflow-hidden relative z-10">
        <IsPopupContext.Provider value={true}>
        <WidgetIdContext.Provider value={widgetId}>
          <div className="h-full overflow-auto">
            {ready ? widgetMeta.component : (
              <div className="flex items-center justify-center h-full">
                <span className="text-sm text-text-secondary/30 animate-pulse">로딩 중...</span>
              </div>
            )}
          </div>
        </WidgetIdContext.Provider>
        </IsPopupContext.Provider>
      </div>
    </div>
  );
}
