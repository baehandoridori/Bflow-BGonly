import { useEffect, useCallback, useState, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { Dashboard } from '@/views/Dashboard';
import { ScenesView } from '@/views/ScenesView';
import { EpisodeView } from '@/views/EpisodeView';
import { AssigneeView } from '@/views/AssigneeView';
import { TeamView } from '@/views/TeamView';
import { CalendarView } from '@/views/CalendarView';
import { ScheduleView } from '@/views/ScheduleView';
import { SettingsView } from '@/views/SettingsView';
import { SpotlightSearch } from '@/components/spotlight/SpotlightSearch';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { PasswordChangeModal } from '@/components/auth/PasswordChangeModal';
import { UserManagerModal } from '@/components/auth/UserManagerModal';
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { loadSheetsConfig, connectSheets, checkConnection, readAllFromSheets, readMetadataFromSheets } from '@/services/sheetsService';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { loadLayout, loadPreferences, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers, setUsersSheetsMode, migrateUsersToSheets } from '@/services/userService';
import { applyTheme, getPreset, getLightColors } from '@/themes';
import { applyFontSettings, DEFAULT_FONT_SCALE, DEFAULT_CATEGORY_SCALES } from '@/utils/typography';
import type { FontScale } from '@/utils/typography';
import { WelcomeToast } from '@/components/WelcomeToast';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { DEFAULT_WEB_APP_URL } from '@/config';

export default function App() {
  const { currentView, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, setChartType, setSheetsConnected, setSheetsConfig, sheetsConfig, sheetsConnected, themeId, customThemeColors, setThemeId, setCustomThemeColors, colorMode, setColorMode, setVacationConnected } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError, setEpisodeTitles, setEpisodeMemos } = useDataStore();
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
  const [localToast, setLocalToast] = useState<string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' } | null>(null);
  const toast = storeToast || localToast;
  const setToast = useCallback((msg: string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' } | null) => {
    setLocalToast(msg);
    if (msg) setStoreToast(null); // 로컬 우선
  }, [setStoreToast]);

  // 글로벌 스토어 토스트 자동 제거 (유형별 시간: error/warning 5초, 나머지 3초)
  useEffect(() => {
    if (!storeToast) return;
    const toastType = typeof storeToast === 'string' ? 'info' : (storeToast.type || 'info');
    const duration = (toastType === 'error' || toastType === 'warning') ? 5000 : 3000;
    const timer = setTimeout(() => setStoreToast(null), duration);
    return () => clearTimeout(timer);
  }, [storeToast, setStoreToast]);

  // 재시도 알림 수신 → 토스트 표시
  useEffect(() => {
    const cleanup = window.electronAPI?.onRetryNotify?.((message) => {
      setStoreToast(message);
    });
    return () => { cleanup?.(); };
  }, [setStoreToast]);

  // 종료 대기 알림 수신 → 저장 중 오버레이
  const [savingBeforeQuit, setSavingBeforeQuit] = useState(false);
  useEffect(() => {
    const cleanup = window.electronAPI?.onSavingBeforeQuit?.(() => {
      setSavingBeforeQuit(true);
    });
    return () => { cleanup?.(); };
  }, []);

  // 테마 초기화 완료 가드 (init에서 로드 전까지 저장 방지)
  const themeInitRef = useRef(false);

  // 스플래시: 이미 로그인 상태여도 앱 시작 시 랜딩 표시
  const [showSplash, setShowSplash] = useState(true);
  // 로딩 스플래시: authReady 후에도 유지, 클릭으로 스킵
  const [loadingSplashDone, setLoadingSplashDone] = useState(false);
  // 환영 팝업: 로그인 직후에만 표시
  const [welcomeUser, setWelcomeUser] = useState<string | null>(null);

  // 데이터 로드 함수 — Apps Script 웹 앱에서 데이터 읽기
  const loadData = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      // 연결 확인 + 재연결 시도
      const connected = await checkConnection();
      if (!connected) {
        const cfg = await loadSheetsConfig();
        const url = cfg?.webAppUrl || DEFAULT_WEB_APP_URL;
        if (url) {
          const result = await connectSheets(url);
          if (!result.ok) throw new Error('시트 연결 실패');
          setSheetsConnected(true);
        } else {
          throw new Error('시트 URL 미설정');
        }
      }

      const episodes = await readAllFromSheets();
      setEpisodes(episodes);
      setLastSyncTime(Date.now());

      // 에피소드 제목/메모를 병렬로 일괄 로드 (초기 렌더 딜레이 제거)
      const titlePromises = episodes.map((ep) =>
        readMetadataFromSheets('episode-title', String(ep.episodeNumber))
          .then((d) => [ep.episodeNumber, d?.value] as const)
          .catch(() => [ep.episodeNumber, undefined] as const),
      );
      const memoPromises = episodes.map((ep) =>
        readMetadataFromSheets('episode-memo', String(ep.episodeNumber))
          .then((d) => [ep.episodeNumber, d?.value] as const)
          .catch(() => [ep.episodeNumber, undefined] as const),
      );
      const [titleResults, memoResults] = await Promise.all([
        Promise.all(titlePromises),
        Promise.all(memoPromises),
      ]);
      const titles: Record<number, string> = {};
      const memos: Record<number, string> = {};
      for (const [num, val] of titleResults) if (val) titles[num] = val;
      for (const [num, val] of memoResults) if (val) memos[num] = val;
      setEpisodeTitles(titles);
      setEpisodeMemos(memos);

      // 위젯 팝업 윈도우에 데이터 변경 알림
      window.electronAPI?.sheetsNotifyChange?.();
    } catch (err) {
      console.error('[동기화 실패]', err);
      setSyncError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [setEpisodes, setSyncing, setLastSyncTime, setSyncError, setEpisodeTitles, setEpisodeMemos, setSheetsConnected]);

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

        const savedLayout = await loadLayout();
        if (savedLayout) {
          setWidgetLayout(savedLayout);
        }
        const savedAllLayout = await loadLayout('all');
        if (savedAllLayout) {
          setAllWidgetLayout(savedAllLayout);
        }
        const savedEpLayout = await loadLayout('episode');
        if (savedEpLayout) {
          setEpisodeWidgetLayout(savedEpLayout);
        }

        // 차트 타입 + 글꼴 크기 로드
        const savedPrefs = await loadPreferences();
        if (savedPrefs?.chartTypes) {
          for (const [widgetId, type] of Object.entries(savedPrefs.chartTypes)) {
            setChartType(widgetId, type as 'horizontal-bar' | 'vertical-bar' | 'donut' | 'stat-card');
          }
        }

        // 글꼴 크기 적용 (FOUC 방지: 테마보다 먼저 적용)
        applyFontSettings({
          fontScale: (savedPrefs?.fontScale as FontScale) ?? DEFAULT_FONT_SCALE,
          fontCategoryScales: savedPrefs?.fontCategoryScales
            ? { ...DEFAULT_CATEGORY_SCALES, ...savedPrefs.fontCategoryScales }
            : undefined,
        });

        // Phase 8-4: 스플래시 건너뛰기
        if (savedPrefs?.skipLoadingSplash) setLoadingSplashDone(true);
        if (savedPrefs?.skipLandingSplash) setShowSplash(false);

        // Phase 8-3: 플렉서스 설정 로드
        if (savedPrefs?.plexus) {
          const p = savedPrefs.plexus;
          useAppStore.getState().setPlexusSettings({
            loginEnabled: p.loginEnabled ?? true,
            loginParticleCount: p.loginParticleCount ?? 666,
            dashboardEnabled: p.dashboardEnabled ?? true,
            dashboardParticleCount: p.dashboardParticleCount ?? 120,
            speed: p.speed ?? 1.0,
            mouseRadius: p.mouseRadius ?? 250,
            mouseForce: p.mouseForce ?? 0.06,
            glowIntensity: p.glowIntensity ?? 1.0,
            connectionDist: p.connectionDist ?? 160,
          });
        }

        // 사이드바 상태 로드
        if (savedPrefs?.sidebarExpanded !== undefined) {
          useAppStore.getState().setSidebarExpanded(savedPrefs.sidebarExpanded);
        }

        // 기본 시작 뷰 로드
        if (savedPrefs?.defaultView) {
          useAppStore.getState().setView(savedPrefs.defaultView as ViewMode);
        }

        // 테마 로드 + 적용 (가드 설정 후 상태 변경)
        const savedTheme = await loadTheme();
        if (savedTheme) {
          const savedMode = savedTheme.colorMode ?? 'dark';
          if (savedTheme.customColors) {
            applyTheme(savedTheme.customColors, savedMode);
          } else if (savedMode === 'light') {
            applyTheme(getLightColors(savedTheme.themeId), savedMode);
          } else {
            const preset = getPreset(savedTheme.themeId);
            if (preset) applyTheme(preset.colors, savedMode);
          }
          // 가드를 먼저 열고 → 상태 변경 (useEffect가 실행될 때 가드가 이미 true)
          themeInitRef.current = true;
          setThemeId(savedTheme.themeId);
          setColorMode(savedMode);
          if (savedTheme.customColors) {
            setCustomThemeColors(savedTheme.customColors);
          }
        } else {
          // 저장된 테마 없음 → 기본 테마 유지, 이후 변경부터 저장 허용
          themeInitRef.current = true;
        }

        // 테마 초기 적용 후 전환 트랜지션 활성화 (초기 로드 시 번쩍임 방지)
        setTimeout(() => document.body.classList.add('theme-ready'), 120);

        // 사용자 목록 로드
        const users = await loadUsers();
        setUsers(users);

        // 세션 복원 (Phase 8-5: rememberMe 설정 확인)
        const rememberMe = savedPrefs?.rememberMe !== false; // 기본 true (하위 호환)
        if (rememberMe) {
          const { user } = await loadSession();
          if (user) {
            setCurrentUser(user);
          }
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
            setUsersSheetsMode(true);
            console.log('[Sheets] 자동 연결 성공');
            // Phase 0-4: 로컬 users.dat를 _USERS 탭으로 마이그레이션 (비동기)
            migrateUsersToSheets().catch(() => {});
          }
        }

        // 휴가 API 자동 연결 (저장된 URL이 있으면 시도)
        const vacConfig = await loadVacationConfig();
        if (vacConfig?.webAppUrl) {
          const vacResult = await connectVacation(vacConfig.webAppUrl);
          if (vacResult.ok) {
            setVacationConnected(true);
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

  // 로그인 직후: 스플래시 건너뛰기 + 초기 비밀번호 토스트
  // authReady 이후(= 사용자가 로그인 폼에서 직접 로그인)에만 스플래시를 건너뜀
  // authReady 이전(= init에서 세션 복원)은 스플래시를 유지
  const prevUserRef = useRef(currentUser);
  useEffect(() => {
    const wasNull = prevUserRef.current === null;
    prevUserRef.current = currentUser;
    if (currentUser && wasNull && authReady) {
      // 사용자가 로그인 폼에서 직접 로그인한 경우 → 스플래시 건너뛰기 + 환영 팝업
      setShowSplash(false);
      setWelcomeUser(currentUser.name);
    }
    if (currentUser?.isInitialPassword) {
      setToast('초기 비밀번호(1234)를 사용 중입니다. 비밀번호를 변경해주세요.');
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [currentUser, authReady]);

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
      applyTheme(customThemeColors, colorMode);
      saveTheme({ themeId, customColors: customThemeColors, colorMode });
    } else if (colorMode === 'light') {
      applyTheme(getLightColors(themeId), colorMode);
      saveTheme({ themeId, colorMode });
    } else {
      const preset = getPreset(themeId);
      if (preset) {
        applyTheme(preset.colors, colorMode);
        saveTheme({ themeId, colorMode });
      }
    }
  }, [themeId, customThemeColors, colorMode]);

  // 초기화 완료 후 데이터 로드
  // authReady 가드: init 완료 전까지 데이터 로딩 방지 (플래시 제거)
  useEffect(() => {
    if (!authReady) return;
    loadData();
  }, [authReady, loadData]);

  // 실시간 동기화: 다른 사용자가 시트를 변경하면 리로드 (디바운스 적용)
  useEffect(() => {
    if (!window.electronAPI?.onSheetChanged) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = window.electronAPI.onSheetChanged(() => {
      // 연속 변경 시 마지막 변경 후 300ms 뒤에 리로드 (배치 쓰기 보호)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log('[동기화] 다른 사용자의 변경 감지 → 데이터 리로드');
        loadData();
      }, 300);
    });
    return () => {
      cleanup?.();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [loadData]);

  // ── 글로벌 단축키 (Phase 8-2) ──
  useGlobalShortcuts({ onReload: loadData });

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
      case 'team':
        return <TeamView />;
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
  // 영상은 1회 재생 후 마지막 프레임에서 멈춤 (스플래시 아트처럼)
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
        {/* 스플래시 영상 — loop 없이 1회 재생 후 마지막 프레임 고정 */}
        <div className="relative" style={{ width: 'min(420px, 75vmin)', aspectRatio: '672 / 592' }}>
          <video
            autoPlay muted playsInline preload="auto"
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

        {/* 하단 문구 */}
        <div className="absolute bottom-6 flex flex-col items-center gap-1.5">
          {canSkip ? (
            <>
              <span
                className="text-sm text-accent/80 font-medium tracking-wide"
                style={{ animation: 'fadeIn 0.5s ease-out' }}
              >
                로딩 완료
              </span>
              <span
                className="text-xs text-white/40 tracking-wide"
                style={{ animation: 'fadeIn 0.5s ease-out 0.2s both' }}
              >
                아무 곳이나 클릭하여 건너뛰기
              </span>
            </>
          ) : (
            <span className="text-sm text-white/30 animate-pulse tracking-wide">
              로딩 중...
            </span>
          )}
        </div>

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

      {/* 토스트 알림 (로컬 + 글로벌 스토어) — 유형별 스타일 */}
      {toast && (() => {
        const msg = typeof toast === 'string' ? toast : toast.message;
        const type = typeof toast === 'string' ? 'info' : (toast.type || 'info');
        const borderColor = type === 'success' ? 'border-emerald-500/40'
          : type === 'error' ? 'border-red-500/40'
          : type === 'warning' ? 'border-amber-500/40'
          : 'border-bg-border';
        const bgColor = type === 'success' ? 'bg-emerald-500/10'
          : type === 'error' ? 'bg-red-500/10'
          : type === 'warning' ? 'bg-amber-500/10'
          : 'bg-bg-card';
        const textColor = type === 'success' ? 'text-emerald-300'
          : type === 'error' ? 'text-red-300'
          : type === 'warning' ? 'text-amber-300'
          : 'text-text-primary';
        return (
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[10000] ${bgColor} border ${borderColor} rounded-xl px-5 py-3 shadow-2xl text-sm ${textColor} animate-slide-down backdrop-blur-sm cursor-pointer`}
            onClick={() => { setLocalToast(null); setStoreToast(null); }}
          >
            {msg}
          </div>
        );
      })()}

      {/* 환영 팝업 (로그인 직후) */}
      {welcomeUser && (
        <WelcomeToast userName={welcomeUser} onDismiss={() => setWelcomeUser(null)} />
      )}

      {/* 종료 대기 오버레이 (Phase 0-5) */}
      {savingBeforeQuit && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-card border border-bg-border rounded-2xl px-8 py-6 shadow-2xl text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-text-primary text-sm font-medium">저장 중...</p>
            <p className="text-text-secondary text-xs mt-1">변경사항을 저장하고 있습니다</p>
          </div>
        </div>
      )}
    </>
  );
}
