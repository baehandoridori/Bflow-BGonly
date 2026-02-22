import { useState, useEffect, useCallback } from 'react';
import { X, Minus } from 'lucide-react';
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
 * 프레임 없는 투명 BrowserWindow에서 단일 위젯을 리퀴드 글래스 스타일로 표시.
 */
export function WidgetPopup({ widgetId }: { widgetId: string }) {
  const [opacity, setOpacity] = useState(0.92);
  const [isHover, setIsHover] = useState(false);
  const [ready, setReady] = useState(false);

  // 테마 + 데이터 초기화
  useEffect(() => {
    // body/html 투명하게
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

        // 데이터 로드
        const api = window.electronAPI;
        if (!api) { console.warn('[WidgetPopup] electronAPI 없음'); setReady(true); return; }

        const { isTestMode } = await api.getMode();
        useAppStore.getState().setTestMode(isTestMode);
        console.log('[WidgetPopup] 모드:', isTestMode ? '테스트' : '프로덕션');

        if (!isTestMode) {
          const connected = await api.sheetsIsConnected();
          console.log('[WidgetPopup] 시트 연결:', connected);
          if (connected) {
            const result = await api.sheetsReadAll();
            console.log('[WidgetPopup] 시트 데이터:', result.ok, result.data?.length ?? 0, '에피소드');
            if (result.ok && result.data) {
              useDataStore.getState().setEpisodes(result.data);
            }
          }
        } else {
          const sheetPath = await api.testGetSheetPath();
          const raw = await api.testReadSheet(sheetPath);
          if (raw && typeof raw === 'object' && 'episodes' in raw) {
            const episodes = (raw as { episodes: Episode[] }).episodes;
            console.log('[WidgetPopup] 테스트 데이터:', episodes.length, '에피소드');
            useDataStore.getState().setEpisodes(episodes);
          }
        }

        // 유저 정보 (세션 복원)
        const users = await loadUsers();
        useAuthStore.getState().setUsers(users);
        const { user } = await loadSession();
        if (user) {
          useAuthStore.getState().setCurrentUser(user);
          console.log('[WidgetPopup] 유저:', user.name);
        }
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

  const handleOpacityChange = useCallback((val: number) => {
    const clamped = Math.max(0.15, Math.min(1, val));
    setOpacity(clamped);
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

  return (
    <div
      className="h-screen w-screen p-1"
      style={{ background: 'transparent' }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <div
        className="h-full w-full flex flex-col overflow-hidden"
        style={{
          borderRadius: '16px',
          background: 'rgba(12, 14, 22, 0.55)',
          backdropFilter: 'blur(40px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.8)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: `
            0 20px 60px rgba(0,0,0,0.5),
            0 0 0 1px rgba(255,255,255,0.06) inset,
            0 1px 0 rgba(255,255,255,0.1) inset
          `,
        }}
      >
        {/* ── 드래그 영역 (타이틀 바 없이, 상단 전체) ── */}
        <div
          className="shrink-0 relative"
          style={{
            WebkitAppRegion: 'drag',
            height: '32px',
          } as React.CSSProperties}
        >
          {/* 호버 시에만 오퍼시티 + 닫기 컨트롤 */}
          {isHover && (
            <div
              className="absolute inset-0 flex items-center justify-end gap-2 px-3"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {/* 오퍼시티 슬라이더 */}
              <div className="flex items-center gap-1.5">
                <Minus size={10} className="text-white/30" />
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                  className="w-14 h-1 cursor-pointer"
                  title={`투명도 ${Math.round(opacity * 100)}%`}
                />
              </div>

              {/* 닫기 */}
              <button
                onClick={handleClose}
                className="w-5 h-5 rounded-full flex items-center justify-center bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer"
                title="닫기"
              >
                <X size={10} className="text-white" strokeWidth={3} />
              </button>
            </div>
          )}
        </div>

        {/* ── 위젯 콘텐츠 ── */}
        <div className="flex-1 overflow-hidden">
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
