import { useEffect, useCallback, useState, useRef } from 'react';
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
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { readTestSheet } from '@/services/testSheetService';
import { loadSheetsConfig, connectSheets, readAllFromSheets } from '@/services/sheetsService';
import { loadLayout, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers } from '@/services/userService';
import { applyTheme, getPreset, DEFAULT_THEME_ID } from '@/themes';
import { DEFAULT_WEB_APP_URL } from '@/config';

export default function App() {
  const { currentView, isTestMode, setTestMode, setWidgetLayout, setAllWidgetLayout, setSheetsConnected, setSheetsConfig, sheetsConfig, sheetsConnected, themeId, customThemeColors, setThemeId, setCustomThemeColors } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError } = useDataStore();
  const {
    currentUser, setCurrentUser,
    authReady, setAuthReady,
    setUsers,
    isAdminMode, setAdminMode,
    showPasswordChange, showUserManager, setShowUserManager,
  } = useAuthStore();

  // 토스트 상태 (글로벌 스토어 기반)
  const storeToast = useAppStore((s) => s.toast);
  const setStoreToast = useAppStore((s) => s.setToast);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const toast = storeToast || localToast;
  const setToast = useCallback((msg: string | null) => {
    setLocalToast(msg);
    if (msg) setStoreToast(null); // 로컬 우선
  }, [setStoreToast]);

  // 글로벌 스토어 토스트 자동 제거
  useEffect(() => {
    if (!storeToast) return;
    const timer = setTimeout(() => setStoreToast(null), 3000);
    return () => clearTimeout(timer);
  }, [storeToast, setStoreToast]);

  // 테마 초기화 완료 가드 (init에서 로드 전까지 저장 방지)
  const themeInitRef = useRef(false);

  // 스플래시: 이미 로그인 상태여도 앱 시작 시 랜딩 표시
  const [showSplash, setShowSplash] = useState(true);
  // 로딩 스플래시: authReady 후에도 유지, 클릭으로 스킵
  const [loadingSplashDone, setLoadingSplashDone] = useState(false);

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
        const savedAllLayout = await loadLayout('all');
        if (savedAllLayout) {
          setAllWidgetLayout(savedAllLayout);
        }

        // 테마 로드 + 적용 (가드 설정 후 상태 변경)
        const savedTheme = await loadTheme();
        if (savedTheme) {
          if (savedTheme.customColors) {
            applyTheme(savedTheme.customColors);
          } else {
            const preset = getPreset(savedTheme.themeId);
            if (preset) applyTheme(preset.colors);
          }
          // 가드를 먼저 열고 → 상태 변경 (useEffect가 실행될 때 가드가 이미 true)
          themeInitRef.current = true;
          setThemeId(savedTheme.themeId);
          if (savedTheme.customColors) {
            setCustomThemeColors(savedTheme.customColors);
          }
        } else {
          // 저장된 테마 없음 → 기본 테마 유지, 이후 변경부터 저장 허용
          themeInitRef.current = true;
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
        // 설정이 없으면 config.ts의 DEFAULT_WEB_APP_URL을 fallback으로 사용
        const config = await loadSheetsConfig();
        const urlToConnect = config?.webAppUrl || DEFAULT_WEB_APP_URL;
        if (urlToConnect) {
          const effectiveConfig = config ?? { webAppUrl: urlToConnect };
          setSheetsConfig(effectiveConfig);
          const result = await connectSheets(urlToConnect);
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

  // 테마 변경 시: CSS 적용 + appdata 저장 (초기화 완료 후에만 저장)
  useEffect(() => {
    if (!themeInitRef.current) return; // init()에서 테마 로드 전까지 저장 방지
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
  // authReady 가드: init 완료 전까지 테스트 데이터 로딩 방지 (플래시 제거)
  useEffect(() => {
    if (!authReady) return;
    loadData();
  }, [authReady, loadData]);

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

  // 로딩 스플래시 — authReady 후에도 유지, 클릭으로 스킵 가능
  if (!loadingSplashDone) {
    const canSkip = authReady;
    return (
      <div
        className="flex items-center justify-center h-screen w-screen overflow-hidden cursor-pointer select-none"
        style={{
          background: 'radial-gradient(ellipse 55% 65% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.15) 80%, #0F1117 100%)',
        }}
        onClick={() => { if (canSkip) setLoadingSplashDone(true); }}
      >
        {/* 스플래시 영상 */}
        <div className="relative" style={{ width: 'min(420px, 75vmin)', aspectRatio: '672 / 592' }}>
          <video
            autoPlay muted loop playsInline preload="auto"
            src="/splash/opening_video.mp4"
            className="absolute object-cover"
            style={{
              inset: '-10%', width: '120%', height: '120%',
              animation: 'loadingSplashReveal 1.5s ease-out 0.3s forwards',
              filter: 'blur(8px) brightness(0.6)',
              transform: 'scale(1.05)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskComposite: 'destination-in' as never,
              maskComposite: 'intersect' as never,
            }}
          />
        </div>

        {/* 로딩 중 / 클릭 투 스킵 */}
        {canSkip ? (
          <span
            className="absolute bottom-8 text-sm text-white/50 tracking-wide animate-pulse"
            style={{ animation: 'fadeIn 0.5s ease-out, pulse 2s ease-in-out infinite' }}
          >
            아무 곳이나 클릭하여 건너뛰기
          </span>
        ) : (
          <span className="absolute bottom-8 text-sm text-white/30 animate-pulse tracking-wide">
            로딩 중...
          </span>
        )}

        <style>{`
          @keyframes loadingSplashReveal {
            to { filter: blur(0px) brightness(1); transform: scale(1); }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // 인증 초기화 아직 미완료 (비정상 경로 — 위에서 splash가 처리하므로 거의 발생 안 함)
  if (!authReady) return null;

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
      <GlobalTooltipProvider />

      {/* 비밀번호 변경 모달 */}
      {showPasswordChange && <PasswordChangeModal />}

      {/* 관리자: 사용자 관리 모달 */}
      {showUserManager && <UserManagerModal />}

      {/* 토스트 알림 (로컬 + 글로벌 스토어) */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-bg-card border border-bg-border rounded-xl px-5 py-3 shadow-2xl text-sm text-text-primary animate-slide-down"
          onClick={() => { setLocalToast(null); setStoreToast(null); }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
