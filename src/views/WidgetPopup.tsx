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
import { getPreset, applyTheme } from '@/themes';
import type { Episode } from '@/types';

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
 * 리퀴드 글래스 스타일: desktopCapturer 배경 블러 + 모서리 왜곡 + 유리 반사
 * 두 개의 슬라이더: 앱 오퍼시티 / 글래스 효과 강도
 */
export function WidgetPopup({ widgetId }: { widgetId: string }) {
  const [appOpacity, setAppOpacity] = useState(0.92);
  const [glassIntensity, setGlassIntensity] = useState(0.7);
  const [isHover, setIsHover] = useState(false);
  const [ready, setReady] = useState(false);
  const [bgCapture, setBgCapture] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 데스크톱 캡처 (위젯 뒤 화면을 블러 배경으로 사용)
  const captureDesktop = useCallback(async () => {
    try {
      const data = await window.electronAPI?.widgetCaptureBehind?.(widgetId);
      if (data) setBgCapture(data);
    } catch { /* 무시 */ }
  }, [widgetId]);

  // 캡처 시작: 마운트 시 + 주기적 갱신
  useEffect(() => {
    // 초기 캡처 (약간 지연 — 창이 완전히 열린 후)
    const initTimer = setTimeout(captureDesktop, 300);

    // 2초마다 갱신 (위젯 이동/리사이즈 반영)
    captureTimerRef.current = setInterval(captureDesktop, 2000);

    return () => {
      clearTimeout(initTimer);
      if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    };
  }, [captureDesktop]);

  // 테마 + 데이터 초기화
  useEffect(() => {
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
          const connected = await api.sheetsIsConnected();
          console.log('[WidgetPopup] 시트 연결:', connected);
          if (connected) {
            const result = await api.sheetsReadAll();
            console.log('[WidgetPopup] 데이터:', result.ok, result.data?.length ?? 0, '에피소드');
            if (result.ok && result.data) {
              useDataStore.getState().setEpisodes(result.data);
            }
          } else {
            // 시트 미연결 — 저장된 설정으로 연결 시도
            const cfg = await api.readSettings('sheets.json') as { webAppUrl?: string } | null;
            if (cfg?.webAppUrl) {
              const connectResult = await api.sheetsConnect(cfg.webAppUrl);
              if (connectResult.ok) {
                const result = await api.sheetsReadAll();
                if (result.ok && result.data) {
                  useDataStore.getState().setEpisodes(result.data);
                }
              }
            }
          }
        } else {
          const sheetPath = await api.testGetSheetPath();
          const raw = await api.testReadSheet(sheetPath);
          if (raw && typeof raw === 'object' && 'episodes' in raw) {
            useDataStore.getState().setEpisodes((raw as { episodes: Episode[] }).episodes);
          }
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

  // 글래스 효과 계산
  const blurPx = Math.round(10 + glassIntensity * 40); // 10~50px
  const bgAlpha = 0.15 + (1 - glassIntensity) * 0.5;  // 0.15~0.65 (글래스 높으면 배경 투명)
  const borderAlpha = 0.06 + glassIntensity * 0.14;    // 0.06~0.20
  const reflectAlpha = glassIntensity * 0.15;            // 0~0.15

  return (
    <div
      ref={rootRef}
      className="h-screen w-screen p-1"
      style={{ background: 'transparent' }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      {/* ── 리퀴드 글래스 컨테이너 ── */}
      <div
        className="h-full w-full flex flex-col overflow-hidden relative"
        style={{
          borderRadius: '18px',
          background: `rgba(12, 14, 22, ${bgAlpha})`,
          border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
          boxShadow: `
            0 20px 60px rgba(0,0,0,0.5),
            0 0 0 1px rgba(255,255,255,${borderAlpha * 0.5}) inset,
            0 1px 0 rgba(255,255,255,${reflectAlpha}) inset,
            0 -1px 0 rgba(255,255,255,${reflectAlpha * 0.3}) inset
          `,
        }}
      >
        {/* ── 데스크톱 캡처 블러 배경 (진짜 뒷배경 블러) ── */}
        {bgCapture && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              borderRadius: '18px',
              overflow: 'hidden',
            }}
          >
            <img
              src={bgCapture}
              alt=""
              style={{
                position: 'absolute',
                inset: `-${blurPx}px`,
                width: `calc(100% + ${blurPx * 2}px)`,
                height: `calc(100% + ${blurPx * 2}px)`,
                objectFit: 'cover',
                filter: `blur(${blurPx}px) saturate(${1 + glassIntensity * 0.8}) brightness(0.85)`,
              }}
            />
          </div>
        )}

        {/* ── 글래스 오버레이 (반투명 틴트) ── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: '18px',
            background: `rgba(12, 14, 22, ${bgAlpha * 0.7})`,
          }}
        />

        {/* ── 유리 상단 반사 하이라이트 ── */}
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: '40%',
            borderRadius: '18px 18px 0 0',
            background: `linear-gradient(180deg, rgba(255,255,255,${reflectAlpha * 1.2}) 0%, rgba(255,255,255,${reflectAlpha * 0.2}) 30%, transparent 100%)`,
            maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          }}
        />

        {/* ── 모서리 굴절 효과 (안쪽 테두리 그라데이션) ── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            borderRadius: '18px',
            boxShadow: `
              inset 0 0 ${Math.round(glassIntensity * 20)}px rgba(255,255,255,${reflectAlpha * 0.4}),
              inset 0 0 ${Math.round(glassIntensity * 4)}px rgba(255,255,255,${reflectAlpha * 0.8})
            `,
          }}
        />

        {/* ── 드래그 영역 + 호버 컨트롤 ── */}
        <div
          className="shrink-0 relative z-10"
          style={{ WebkitAppRegion: 'drag', height: '36px' } as React.CSSProperties}
        >
          {isHover && (
            <div
              className="absolute inset-0 flex items-center gap-3 px-3"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {/* 앱 오퍼시티 */}
              <div className="flex items-center gap-1" title="앱 투명도">
                <Eye size={11} className="text-white/35" />
                <input type="range" min={15} max={100}
                  value={Math.round(appOpacity * 100)}
                  onChange={(e) => handleAppOpacity(Number(e.target.value) / 100)}
                  className="w-12 h-1 cursor-pointer" />
              </div>

              {/* 글래스 효과 */}
              <div className="flex items-center gap-1" title="글래스 효과">
                <Droplets size={11} className="text-white/35" />
                <input type="range" min={0} max={100}
                  value={Math.round(glassIntensity * 100)}
                  onChange={(e) => setGlassIntensity(Number(e.target.value) / 100)}
                  className="w-12 h-1 cursor-pointer" />
              </div>

              <div className="flex-1" />

              {/* 닫기 */}
              <button
                onClick={handleClose}
                className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-red-500/70 hover:bg-red-500 transition-colors cursor-pointer"
              >
                <X size={9} className="text-white" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>

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
    </div>
  );
}
