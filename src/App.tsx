import { useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { Dashboard } from '@/views/Dashboard';
import { ScenesView } from '@/views/ScenesView';
import { SettingsView } from '@/views/SettingsView';
import { readTestSheet } from '@/services/testSheetService';
import { loadSheetsConfig, connectSheets, readAllFromSheets } from '@/services/sheetsService';
import { loadLayout } from '@/services/settingsService';

export default function App() {
  const { currentView, isTestMode, setTestMode, setWidgetLayout, setSheetsConnected, setSheetsConfig, sheetsConfig, sheetsConnected } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError } = useDataStore();

  // 데이터 로드 함수 — 모드에 따라 테스트 시트 또는 Apps Script 웹 앱 사용
  const loadData = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      let episodes;
      if (sheetsConnected) {
        // 시트 연결됨: Apps Script 웹 앱에서 읽기
        episodes = await readAllFromSheets();
      } else {
        // 시트 미연결: 로컬 JSON 파일 (테스트용)
        episodes = await readTestSheet();
      }
      setEpisodes(episodes);
      setLastSyncTime(Date.now());
    } catch (err) {
      console.error('[동기화 실패]', err);
      setSyncError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [sheetsConnected, setEpisodes, setSyncing, setLastSyncTime, setSyncError]);

  // 초기 로드
  useEffect(() => {
    async function init() {
      try {
        // electronAPI 존재 확인
        if (!window.electronAPI) {
          console.warn('[경고] electronAPI 없음 — preload 스크립트 확인 필요');
          return;
        }

        const { isTestMode: testMode } = await window.electronAPI.getMode();
        setTestMode(testMode);

        const savedLayout = await loadLayout();
        if (savedLayout) {
          setWidgetLayout(savedLayout);
        }

        // 저장된 Sheets 설정이 있으면 자동 연결 시도 (모드 무관)
        const config = await loadSheetsConfig();
        if (config?.webAppUrl) {
          setSheetsConfig(config);
          const result = await connectSheets(config.webAppUrl);
          if (result.ok) {
            setSheetsConnected(true);
            console.log('[Sheets] 자동 연결 성공');
          }
        }
      } catch (err) {
        console.error('[초기화 실패]', err);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 초기화 완료 후 데이터 로드 (sheetsConnected/isTestMode 변경 시)
  useEffect(() => {
    loadData();
  }, [loadData]);

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
        return <SettingsView />;
      default:
        return <Dashboard />;
    }
  };

  return <MainLayout onRefresh={loadData}>{renderView()}</MainLayout>;
}
