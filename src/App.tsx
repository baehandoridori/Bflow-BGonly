import { useEffect, useCallback, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { Dashboard } from '@/views/Dashboard';
import { ScenesView } from '@/views/ScenesView';
import { EpisodeView } from '@/views/EpisodeView';
import { AssigneeView } from '@/views/AssigneeView';
import { CalendarView } from '@/views/CalendarView';
import { ScheduleView } from '@/views/ScheduleView';
import { SettingsView } from '@/views/SettingsView';
import { SpotlightSearch } from '@/components/spotlight/SpotlightSearch';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { PasswordChangeModal } from '@/components/auth/PasswordChangeModal';
import { UserManagerModal } from '@/components/auth/UserManagerModal';
import { readTestSheet } from '@/services/testSheetService';
import { loadSheetsConfig, connectSheets, readAllFromSheets } from '@/services/sheetsService';
import { loadLayout, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
import { applyTheme, getPreset, DEFAULT_THEME_ID } from '@/themes';

export default function App() {
  const { currentView, isTestMode, setTestMode, setWidgetLayout, setSheetsConnected, setSheetsConfig, sheetsConfig, sheetsConnected, themeId, customThemeColors, setThemeId, setCustomThemeColors } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError } = useDataStore();
  const {
    currentUser, setCurrentUser,
    authReady, setAuthReady,
    setUsers,
    isAdminMode, setAdminMode,
    showPasswordChange, showUserManager, setShowUserManager,
  } = useAuthStore();

  // 토스트 상태 (초기 비밀번호 알림 등)
  const [toast, setToast] = useState<string | null>(null);

  // 스플래시: 이미 로그인 상태여도 앱 시작 시 랜딩 표시
  const [showSplash, setShowSplash] = useState(true);

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

  // 초기 로드 + 인증 세션 복원
  useEffect(() => {
    async function init() {
      try {
        // electronAPI 존재 확인
        if (!window.electronAPI) {
          console.warn('[경고] electronAPI 없음 — preload 스크립트 확인 필요');
          setAuthReady(true);
          return;
        }

        const { isTestMode: testMode } = await window.electronAPI.getMode();
        setTestMode(testMode);

        const savedLayout = await loadLayout();
        if (savedLayout) {
          setWidgetLayout(savedLayout);
        }

        // 테마 로드 + 적용
        const savedTheme = await loadTheme();
        if (savedTheme) {
          setThemeId(savedTheme.themeId);
          if (savedTheme.customColors) {
            setCustomThemeColors(savedTheme.customColors);
            applyTheme(savedTheme.customColors);
          } else {
            const preset = getPreset(savedTheme.themeId);
            if (preset) applyTheme(preset.colors);
          }
        }

        // 사용자 목록 로드
        const users = await loadUsers();
        setUsers(users);

        // 세션 복원
        const { user } = await loadSession();
        if (user) {
          setCurrentUser(user);
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
      } finally {
        setAuthReady(true);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 로그인 직후: 초기 비밀번호 토스트
  useEffect(() => {
    if (currentUser?.isInitialPassword) {
      setToast('초기 비밀번호(1234)를 사용 중입니다. 비밀번호를 변경해주세요.');
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [currentUser]);

  // 사용자 변경 시 목록 리로드
  useEffect(() => {
    if (currentUser) {
      loadUsers().then(setUsers);
    }
  }, [currentUser, setUsers]);

  // 테마 변경 시: CSS 적용 + appdata 저장
  useEffect(() => {
    if (themeId === 'custom' && customThemeColors) {
      applyTheme(customThemeColors);
      saveTheme({ themeId, customColors: customThemeColors });
    } else {
      const preset = getPreset(themeId);
      if (preset) {
        applyTheme(preset.colors);
        saveTheme({ themeId });
      }
    }
  }, [themeId, customThemeColors]);

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

  // Ctrl+Alt+U: 관리자 모드 토글
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'u') {
        e.preventDefault();
        if (!isAdminMode) {
          setAdminMode(true);
          setShowUserManager(true);
          setToast('관리자 모드가 활성화되었습니다.');
          setTimeout(() => setToast(null), 3000);
        } else {
          setShowUserManager(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAdminMode, setAdminMode, setShowUserManager]);

  // 뷰 렌더링
  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'scenes':
        return <ScenesView />;
      case 'episode':
        return <EpisodeView />;
      case 'assignee':
        return <AssigneeView />;
      case 'calendar':
        return <CalendarView />;
      case 'schedule':
        return <ScheduleView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <Dashboard />;
    }
  };

  // 인증 초기화 대기
  if (!authReady) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-bg-primary">
        <span className="text-sm text-text-secondary animate-pulse">로딩 중...</span>
      </div>
    );
  }

  // 로그인 화면 (비로그인 상태)
  if (!currentUser) {
    return <LoginScreen />;
  }

  // 스플래시 랜딩 (로그인 상태에서도 앱 시작 시 표시)
  if (showSplash) {
    return <LoginScreen mode="splash" onComplete={() => setShowSplash(false)} />;
  }

  return (
    <>
      <MainLayout onRefresh={loadData}>{renderView()}</MainLayout>
      <SpotlightSearch />

      {/* 비밀번호 변경 모달 */}
      {showPasswordChange && <PasswordChangeModal />}

      {/* 관리자: 사용자 관리 모달 */}
      {showUserManager && <UserManagerModal />}

      {/* 토스트 알림 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-bg-card border border-bg-border rounded-xl px-5 py-3 shadow-2xl text-sm text-text-primary animate-slide-down">
          {toast}
        </div>
      )}
    </>
  );
}
