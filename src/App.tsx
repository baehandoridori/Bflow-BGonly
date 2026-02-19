import { useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { Dashboard } from '@/views/Dashboard';
import { ScenesView } from '@/views/ScenesView';
import { readTestSheet } from '@/services/testSheetService';
import { loadLayout } from '@/services/settingsService';

export default function App() {
  const { currentView, setTestMode, setWidgetLayout } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError } = useDataStore();

  // 데이터 로드 함수
  const loadData = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const episodes = await readTestSheet();
      setEpisodes(episodes);
      setLastSyncTime(Date.now());
    } catch (err) {
      console.error('[동기화 실패]', err);
      setSyncError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [setEpisodes, setSyncing, setLastSyncTime, setSyncError]);

  // 초기 로드
  useEffect(() => {
    async function init() {
      try {
        // electronAPI 존재 확인
        if (!window.electronAPI) {
          console.warn('[경고] electronAPI 없음 — preload 스크립트 확인 필요');
          return;
        }

        const { isTestMode } = await window.electronAPI.getMode();
        setTestMode(isTestMode);

        const savedLayout = await loadLayout();
        if (savedLayout) {
          setWidgetLayout(savedLayout);
        }

        await loadData();
      } catch (err) {
        console.error('[초기화 실패]', err);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 실시간 동기화: 다른 사용자가 시트를 변경하면 즉시 리로드
  useEffect(() => {
    if (!window.electronAPI?.onSheetChanged) return;
    const cleanup = window.electronAPI.onSheetChanged(() => {
      console.log('[동기화] 다른 사용자의 변경 감지 → 데이터 리로드');
      loadData();
    });
    return cleanup;
  }, [loadData]);

  // 뷰 렌더링
  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'scenes':
        return <ScenesView />;
      case 'episode':
        return (
          <div className="flex items-center justify-center h-full text-text-secondary">
            에피소드별 현황 (구현 예정)
          </div>
        );
      case 'settings':
        return (
          <div className="flex items-center justify-center h-full text-text-secondary">
            설정 (구현 예정)
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return <MainLayout onRefresh={loadData}>{renderView()}</MainLayout>;
}
