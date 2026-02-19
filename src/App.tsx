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

  // 초기 로드
  useEffect(() => {
    async function init() {
      try {
        // 모드 확인
        const { isTestMode } = await window.electronAPI.getMode();
        setTestMode(isTestMode);

        // 개인 레이아웃 로드
        const savedLayout = await loadLayout();
        if (savedLayout) {
          setWidgetLayout(savedLayout);
        }

        // 데이터 로드
        await loadData();
      } catch (err) {
        console.error('[초기화 실패]', err);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 데이터 로드 함수
  const loadData = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      // 현재는 테스트 모드만 지원
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

  // 주기적 폴링 (30초)
  useEffect(() => {
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
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
