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
import { VacationView } from '@/views/VacationView';
import CompositingView from '@/views/CompositingView';
import { SettingsView } from '@/views/SettingsView';
import { SpotlightSearch } from '@/components/spotlight/SpotlightSearch';
import { LoginScreen } from '@/components/auth/LoginScreen';
import { PasswordChangeModal } from '@/components/auth/PasswordChangeModal';
import { UserManagerModal } from '@/components/auth/UserManagerModal';
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { loadSheetsConfig, connectSheets, checkConnection, readAllFromSheets, readMetadataFromSheets } from '@/services/sheetsService';
import { readAllFromSupabase, testSupabaseConnection, readAllMetadataFromSupabase, onSupabaseRealtimeEvent, onSupabaseStatusChange } from '@/services/supabaseService';
import type { SupabaseRealtimeEvent } from '@/services/supabaseService';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { loadLayout, loadPreferences, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers, setUsersSheetsMode, migrateUsersToSheets } from '@/services/userService';
import { applyTheme, getPreset, getLightColors } from '@/themes';
import { applyFontSettings, DEFAULT_FONT_SCALE, DEFAULT_CATEGORY_SCALES } from '@/utils/typography';
import type { FontScale } from '@/utils/typography';
import { WelcomeToast } from '@/components/WelcomeToast';
import { getGreeting, isFirstLogin, markFirstLoginShown } from '@/utils/greetings';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { DEFAULT_WEB_APP_URL, DEFAULT_VACATION_URL } from '@/config';

export default function App() {
  const { currentView, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, setChartType, setSheetsConnected, setSheetsConfig, sheetsConfig, sheetsConnected, themeId, customThemeColors, setThemeId, setCustomThemeColors, colorMode, setColorMode, setVacationConnected, setActiveDataSource } = useAppStore();
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
  const [localToast, setLocalToast] = useState<string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' | 'critical' } | null>(null);
  const toast = storeToast || localToast;
  const setToast = useCallback((msg: string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' | 'critical' } | null) => {
    setLocalToast(msg);
    if (msg) setStoreToast(null); // 로컬 우선
  }, [setStoreToast]);

  // 글로벌 스토어 토스트 자동 제거 (유형별 시간: critical 10초, error/warning 5초, 나머지 3초)
  useEffect(() => {
    if (!storeToast) return;
    const toastType = typeof storeToast === 'string' ? 'info' : (storeToast.type || 'info');
    const duration = toastType === 'critical' ? 10000 : (toastType === 'error' || toastType === 'warning') ? 5000 : 3000;
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
  // 시간대별 인사말 토스트 (WelcomeToast 스타일로 하단 표시)
  const [greetingToast, setGreetingToast] = useState<string | null>(null);

  // 데이터 로드 함수 — Supabase에서 데이터 읽기 (Sheets fallback)
  const loadData = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      // Supabase 우선 시도
      const sbConn = await testSupabaseConnection();
      if (sbConn.ok) {
        setActiveDataSource('supabase');
        const episodes = await readAllFromSupabase();
        setEpisodes(episodes);
        setLastSyncTime(Date.now());

        // 메타데이터 로드 (Supabase)
        try {
          const metaList = (await readAllMetadataFromSupabase()) as { type: string; key: string; value: string }[];
          const titles: Record<number, string> = {};
          const memos: Record<number, string> = {};
          for (const m of metaList) {
            if (m.type === 'episode-title' && m.value) titles[Number(m.key)] = m.value;
            if (m.type === 'episode-memo' && m.value) memos[Number(m.key)] = m.value;
          }
          setEpisodeTitles(titles);
          setEpisodeMemos(memos);
        } catch { /* 메타데이터 로드 실패는 무시 */ }
        return;
      }

      // Supabase 실패 → Sheets fallback
      setActiveDataSource('sheets');
      console.warn('[Supabase] 연결 실패, Sheets fallback 시도');
      const connected = await checkConnection();
      if (!connected) {
        const cfg = await loadSheetsConfig();
        const url = cfg?.webAppUrl || DEFAULT_WEB_APP_URL;
        if (url) {
          const result = await connectSheets(url);
          if (!result.ok) throw new Error('시트 연결 실패');
          setSheetsConnected(true);
        } else {
          throw new Error('데이터 소스 연결 실패');
        }
      }

      const episodes = await readAllFromSheets();
      setEpisodes(episodes);
      setLastSyncTime(Date.now());

      // 메타데이터 로드 (Sheets)
      try {
        if (window.electronAPI?.sheetsReadAllMetadata) {
          const metaRes = await window.electronAPI.sheetsReadAllMetadata();
          if (metaRes.ok && metaRes.data) {
            const titles: Record<number, string> = {};
            const memos: Record<number, string> = {};
            for (const m of metaRes.data) {
              if (m.type === 'episode-title' && m.value) titles[Number(m.key)] = m.value;
              if (m.type === 'episode-memo' && m.value) memos[Number(m.key)] = m.value;
            }
            setEpisodeTitles(titles);
            setEpisodeMemos(memos);
          }
        }
      } catch { /* 메타데이터 로드 실패는 무시 */ }
    } catch (err) {
      console.error('[동기화 실패]', err);
      setSyncError(String(err));
    } finally {
      setSyncing(false);
    }
  }, [setEpisodes, setSyncing, setLastSyncTime, setSyncError, setEpisodeTitles, setEpisodeMemos, setSheetsConnected, setActiveDataSource]);

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

        // Supabase 연결 확인 (항상 시도)
        const sbConn = await testSupabaseConnection();
        if (sbConn.ok) {
          console.log('[Supabase] 연결 성공');
          setSheetsConnected(true); // 기존 UI 호환: 연결 상태 표시에 재사용
          setUsersSheetsMode(true); // 사용자 서비스도 Supabase로 전환 (호환)
        }

        // Sheets fallback 연결 (Supabase 실패 시에만)
        if (!sbConn.ok) {
          const config = await loadSheetsConfig();
          const urlToConnect = config?.webAppUrl || DEFAULT_WEB_APP_URL;
          if (urlToConnect) {
            const effectiveConfig = config ?? { webAppUrl: urlToConnect };
            setSheetsConfig(effectiveConfig);
            const result = await connectSheets(urlToConnect);
            if (result.ok) {
              setSheetsConnected(true);
              setUsersSheetsMode(true);
              console.log('[Sheets] fallback 연결 성공');
              migrateUsersToSheets().catch(() => {});
            }
          }
        }

        // 휴가 API 자동 연결 (저장된 URL 또는 기본 URL로 시도)
        const vacConfig = await loadVacationConfig();
        const vacUrlToConnect = vacConfig?.webAppUrl || DEFAULT_VACATION_URL;
        if (vacUrlToConnect) {
          const vacResult = await connectVacation(vacUrlToConnect);
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

  // 실시간 동기화: 델타 기반 부분 업데이트 또는 full reload (디바운스 적용)
  useEffect(() => {
    if (!window.electronAPI?.onSheetChanged) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = window.electronAPI.onSheetChanged((delta?: unknown) => {
      const d = delta as import('@/types').SheetDelta | undefined;

      // 토글 delta → 해당 셀만 즉시 업데이트 (readAll 없음)
      if (d?.type === 'toggle') {
        useDataStore.getState().setSceneStageValue(d.sheetName, d.sceneId, d.field, d.value);
        return;
      }
      // 필드 업데이트 delta → 해당 필드만 즉시 업데이트
      if (d?.type === 'field-update') {
        useDataStore.getState().setSceneFieldBySceneId(d.sheetName, d.sceneId, d.field, d.value);
        return;
      }
      // 댓글 delta → 캐시 무효화만 (readAll 호출 안 함)
      if (d?.type === 'comment') {
        import('@/services/commentService').then((cs) => cs.invalidatePartCache(d.sheetName));
        return;
      }
      // 할일 delta → localStorage 기반이므로 DOM 이벤트로 위젯에 전달 (readAll 불필요)
      if (d?.type === 'todo') {
        window.dispatchEvent(new Event('bflow:todos-changed'));
        return;
      }
      // 'full', 'snapshot', 또는 delta 없음 → 기존 full reload
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log('[동기화] full reload 트리거');
        loadData();
      }, 300);
    });
    return () => {
      cleanup?.();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [loadData]);

  // Supabase Realtime: DB 변경 감지 → delta 직접 적용 또는 full reload
  useEffect(() => {
    if (!window.electronAPI?.onSupabaseRealtime) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = onSupabaseRealtimeEvent((event: SupabaseRealtimeEvent) => {
      const { table, payload } = event;

      // 댓글 변경 → 캐시 무효화 (CommentPanel이 이벤트 수신하여 리로드)
      if (table === 'comments') {
        import('@/services/commentService').then((cs) => cs.invalidatePartCache());
        return;
      }

      // scenes UPDATE → 체크박스/필드 변경일 가능성 높음 → delta 직접 적용 (full reload 없이 즉시)
      if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
        const row = payload.new as Record<string, unknown>;
        const uuid = row.id as string;
        if (uuid) {
          const fields: Record<string, unknown> = {};
          if (typeof row.lo === 'boolean') fields.lo = row.lo;
          if (typeof row.done === 'boolean') fields.done = row.done;
          if (typeof row.review === 'boolean') fields.review = row.review;
          if (typeof row.png === 'boolean') fields.png = row.png;
          if (typeof row.assignee === 'string') fields.assignee = row.assignee;
          if (typeof row.memo === 'string') fields.memo = row.memo;
          if (typeof row.scene_number === 'string') fields.sceneId = row.scene_number;
          if (typeof row.layout === 'string') fields.layoutId = row.layout;
          if (typeof row.storyboard_url === 'string') fields.storyboardUrl = row.storyboard_url;
          if (typeof row.guide_url === 'string') fields.guideUrl = row.guide_url;
          if (typeof row.sort_order === 'number') fields.no = row.sort_order;
          const applied = useDataStore.getState().updateSceneByUuid(uuid, fields as Partial<import('@/types').Scene>);
          if (applied) return; // delta 적용 성공 → full reload 불필요
        }
      }

      // 그 외 (INSERT, DELETE, 구조 변경 등) → 디바운스 full reload
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[Supabase Realtime] ${table} ${payload?.eventType} → reload`);
        loadData();
      }, 300);
    });
    return () => {
      cleanup();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [loadData]);

  // 스냅샷 릴레이: 다른 창에서 보낸 전체 데이터 직접 적용
  useEffect(() => {
    if (!window.electronAPI?.onSnapshotRelay) return;
    const cleanup = window.electronAPI.onSnapshotRelay((data: unknown) => {
      const d = data as import('@/types').SnapshotRelayData;
      if (d?.episodes) {
        useDataStore.getState().setEpisodes(d.episodes);
      }
      if (d?.episodeTitles) {
        useDataStore.getState().setEpisodeTitles(d.episodeTitles);
      }
      if (d?.episodeMemos) {
        useDataStore.getState().setEpisodeMemos(d.episodeMemos);
      }
    });
    return () => { cleanup?.(); };
  }, []);

  // 주기적 폴링: Realtime 이벤트 누락 방지용 안전망 (30초 간격)
  useEffect(() => {
    if (!authReady) return;
    const POLL_INTERVAL = 30_000;
    const timer = setInterval(() => {
      loadData();
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [authReady, loadData]);

  // Supabase Realtime 연결 상태 모니터링: 재연결 시 즉시 동기화
  useEffect(() => {
    if (!window.electronAPI?.onSupabaseStatus) return;
    const cleanup = onSupabaseStatusChange((status: string) => {
      if (status === 'SUBSCRIBED') {
        // Realtime 재연결 완료 → 놓친 변경사항 즉시 동기화
        loadData();
      }
    });
    return () => { cleanup?.(); };
  }, [loadData]);

  // 자동 로그인: 스플래시 종료 후 시간대별 인사 표시
  // welcomeUser가 있으면 수동 로그인이므로 건너뜀 (WelcomeToast onDismiss에서 처리)
  const autoGreetShownRef = useRef(false);
  useEffect(() => {
    if (autoGreetShownRef.current) return;
    if (!authReady || !currentUser || showSplash || welcomeUser) return;
    autoGreetShownRef.current = true;
    const first = isFirstLogin();
    const msg = getGreeting(currentUser.name, first);
    if (first) markFirstLoginShown();
    setGreetingToast(msg);
  }, [authReady, currentUser, showSplash, welcomeUser]);

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
      case 'vacation':
        return <VacationView />;
      case 'compositing':
        return <CompositingView />;
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
          backgroundColor: '#0F1117',
          backgroundImage: 'radial-gradient(ellipse 55% 65% at 50% 48%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.15) 80%, #0F1117 100%)',
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
        const isCritical = type === 'critical';
        const effectiveType = isCritical ? 'error' : type;
        const borderColor = effectiveType === 'success' ? 'border-emerald-500/40'
          : effectiveType === 'error' ? 'border-red-500/40'
          : effectiveType === 'warning' ? 'border-amber-500/40'
          : 'border-bg-border';
        const bgColor = effectiveType === 'success' ? 'bg-emerald-500/10'
          : effectiveType === 'error' ? 'bg-red-500/10'
          : effectiveType === 'warning' ? 'bg-amber-500/10'
          : 'bg-bg-card';
        const textColor = effectiveType === 'success' ? 'text-emerald-300'
          : effectiveType === 'error' ? 'text-red-300'
          : effectiveType === 'warning' ? 'text-amber-300'
          : 'text-text-primary';
        return (
          <>
            {/* critical 토스트: 반투명 블러 오버레이 */}
            {isCritical && (
              <div
                className="fixed inset-0 z-[9999] bg-black/30 backdrop-blur-[2px] animate-fade-in cursor-pointer"
                onClick={() => { setLocalToast(null); setStoreToast(null); }}
              />
            )}
            <div
              className={`fixed top-4 left-1/2 -translate-x-1/2 z-[10000] ${bgColor} border ${borderColor} rounded-xl px-5 py-3 shadow-2xl text-sm ${textColor} animate-slide-down backdrop-blur-sm cursor-pointer`}
              onClick={() => { setLocalToast(null); setStoreToast(null); }}
            >
              {msg}
            </div>
          </>
        );
      })()}

      {/* 환영 팝업 (로그인 직후) */}
      {welcomeUser && (
        <WelcomeToast userName={welcomeUser} onDismiss={() => {
          setWelcomeUser(null);
          // 수동 로그인: "어서오세요" 사라진 후 시간대별 인사 표시
          const first = isFirstLogin();
          const msg = getGreeting(currentUser.name, first);
          if (first) markFirstLoginShown();
          setGreetingToast(msg);
        }} />
      )}

      {/* 시간대별 인사말 토스트 (WelcomeToast 스타일) */}
      {greetingToast && !welcomeUser && (
        <WelcomeToast message={greetingToast} onDismiss={() => setGreetingToast(null)} />
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
