import { useState, useEffect, useCallback } from 'react';
import { X, Minus, GripHorizontal } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { WidgetIdContext } from '@/components/widgets/Widget';
import { loadTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
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
 * 프레임 없는 투명 BrowserWindow 안에서 단일 위젯을 표시.
 * 리퀴드 글래스 스타일 + 드래그/오퍼시티/닫기 컨트롤.
 */
export function WidgetPopup({ widgetId }: { widgetId: string }) {
  const [opacity, setOpacity] = useState(0.92);
  const [isHoverControl, setIsHoverControl] = useState(false);

  // 테마 + 데이터 초기화
  useEffect(() => {
    (async () => {
      // 테마 로드
      const saved = await loadTheme();
      if (saved) {
        useAppStore.getState().setThemeId(saved.themeId);
        if (saved.customColors) useAppStore.getState().setCustomThemeColors(saved.customColors);
        const colors = saved.customColors ?? getPreset(saved.themeId)?.colors;
        if (colors) applyTheme(colors);
      }

      // 데이터 로드 (테스트 모드 or 구글 시트)
      const api = window.electronAPI;
      if (!api) return;
      const { isTestMode } = await api.getMode();
      useAppStore.getState().setTestMode(isTestMode);

      if (!isTestMode) {
        const connected = await api.sheetsIsConnected();
        if (connected) {
          const result = await api.sheetsReadAll();
          if (result.ok && result.data) {
            useDataStore.getState().setEpisodes(result.data);
          }
        }
      } else {
        const sheetPath = await api.testGetSheetPath();
        const raw = await api.testReadSheet(sheetPath);
        if (raw && typeof raw === 'object' && 'episodes' in raw) {
          useDataStore.getState().setEpisodes((raw as { episodes: unknown[] }).episodes as never[]);
        }
      }

      // 유저 정보 (세션 복원)
      const users = await loadUsers();
      useAuthStore.getState().setUsers(users);
      const { user } = await loadSession();
      if (user) useAuthStore.getState().setCurrentUser(user);
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
      <div className="h-screen w-screen flex items-center justify-center bg-transparent text-white/50 text-sm">
        알 수 없는 위젯: {widgetId}
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: 'transparent' }}
    >
      {/* ── 타이틀 바 (드래그 + 컨트롤) ── */}
      <div
        className="flex items-center gap-2 px-3 py-2 select-none shrink-0"
        style={{
          WebkitAppRegion: 'drag',
          background: 'rgba(12, 14, 22, 0.5)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        } as React.CSSProperties}
      >
        <GripHorizontal size={14} className="text-white/25" />
        <span className="text-[12px] font-medium text-white/60 truncate flex-1">
          {widgetMeta.label}
        </span>

        {/* 오퍼시티 컨트롤 */}
        <div
          className="flex items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onMouseEnter={() => setIsHoverControl(true)}
          onMouseLeave={() => setIsHoverControl(false)}
        >
          {isHoverControl && (
            <div className="flex items-center gap-1.5 mr-1">
              <Minus size={10} className="text-white/30" />
              <input
                type="range"
                min={15}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                className="w-16 h-1 accent-accent cursor-pointer"
                title={`투명도 ${Math.round(opacity * 100)}%`}
              />
            </div>
          )}

          <button
            onClick={handleClose}
            className="p-0.5 rounded text-white/40 hover:text-red-400 hover:bg-red-400/15 transition-colors cursor-pointer"
            title="닫기"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── 위젯 콘텐츠 (리퀴드 글래스) ── */}
      <div
        className="flex-1 overflow-hidden rounded-b-2xl"
        style={{
          background: 'rgba(14, 16, 24, 0.35)',
          backdropFilter: 'blur(28px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.8)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.08) inset, 0 1px 0 rgba(255,255,255,0.1) inset',
        }}
      >
        <WidgetIdContext.Provider value={widgetId}>
          <div className="h-full overflow-auto p-3">
            {widgetMeta.component}
          </div>
        </WidgetIdContext.Provider>
      </div>
    </div>
  );
}
