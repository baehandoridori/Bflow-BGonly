import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Droplets, Eye } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { WidgetIdContext, IsPopupContext } from '@/components/widgets/Widget';
import { loadTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
import { readAllFromSheets, checkConnection, connectSheets, loadSheetsConfig } from '@/services/sheetsService';
import { readTestSheet } from '@/services/testSheetService';
import { getPreset, applyTheme } from '@/themes';

const WIDGET_REGISTRY: Record<string, { label: string; component: React.ReactNode }> = {
  'overall-progress': { label: '전체 진행률', component: <OverallProgressWidget /> },
  'stage-bars': { label: '단계별 진행률', component: <StageBarsWidget /> },
  'assignee-cards': { label: '담당자별 현황', component: <AssigneeCardsWidget /> },
  'episode-summary': { label: '에피소드 요약', component: <EpisodeSummaryWidget /> },
  'dept-comparison': { label: '부서별 비교', component: <DepartmentComparisonWidget /> },
  'calendar': { label: '캘린더', component: <CalendarWidget /> },
};

/**
 * 위젯 팝업 윈도우 전용 렌더러
 * Windows Acrylic 네이티브 블러 + CSS 글래스 효과
 * 두 개의 슬라이더: 앱 오퍼시티 / 글래스 틴트 강도
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

  // 마우스 위치 추적 → 상단 영역별 호버 감지
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 드래그 핸들: 상단 40px 영역
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

    // 컨트롤: 오른쪽 60% + 상단 48px 영역
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

  // 테마 + 데이터 초기화
  useEffect(() => {
    // Acrylic 모드: HTML/Body를 투명하게 하여 네이티브 블러가 보이도록
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    (async () => {
      try {
        // 테마 로드
        const saved = await loadTheme();
        if (saved) {
          useAppStore.getState().setThemeId(saved.themeId);
          if (saved.customColors) useAppStore.getState().setCustomThemeColors(saved.customColors);
          const colors = saved.customColors ?? getPreset(saved.themeId)?.colors;
          if (colors) applyTheme(colors);
        }

        const api = window.electronAPI;
        if (!api) { setReady(true); return; }

        const { isTestMode } = await api.getMode();
        useAppStore.getState().setTestMode(isTestMode);

        // 대시보드 필터를 'all'로 설정 (위젯이 데이터 표시하도록)
        useAppStore.getState().setDashboardDeptFilter('all');

        if (!isTestMode) {
          // 프로덕션: App.tsx와 동일한 서비스 함수 사용
          let connected = await checkConnection();
          console.log('[WidgetPopup] 시트 연결:', connected);
          if (!connected) {
            // 시트 미연결 — 저장된 설정으로 연결 시도
            const cfg = await loadSheetsConfig();
            if (cfg?.webAppUrl) {
              const result = await connectSheets(cfg.webAppUrl);
              connected = result.ok;
              console.log('[WidgetPopup] 재연결 시도:', result.ok);
            }
          }
          if (connected) {
            const episodes = await readAllFromSheets();
            console.log('[WidgetPopup] 데이터:', episodes.length, '에피소드');
            useDataStore.getState().setEpisodes(episodes);
          }
        } else {
          // 테스트: testSheetService 사용 (migrateEpisodes 포함)
          const episodes = await readTestSheet();
          console.log('[WidgetPopup] 테스트 데이터:', episodes.length, '에피소드');
          useDataStore.getState().setEpisodes(episodes);
        }

        // 유저
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

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{
        background: `rgba(12, 14, 22, ${tintAlpha})`,
        transition: 'background 0.3s ease',
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

      {/* ── 상단 드래그 핸들 (가운데 위, 호버 시에만 표시) ── */}
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

          {/* 닫기 */}
          <button
            onClick={handleClose}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-red-500/70 hover:bg-red-500 transition-colors cursor-pointer ml-1"
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
