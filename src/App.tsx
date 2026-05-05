import { lazy, Suspense, useEffect, useCallback, useState, useRef, Component, type ReactNode, type ErrorInfo } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useActivityStore } from '@/stores/useActivityStore';
import { subscribeToActivityRealtime } from '@/services/supabaseService';
// 뷰 lazy 로딩 — 초기 번들에서 제외
const Dashboard = lazy(() => import('@/views/Dashboard').then(m => ({ default: m.Dashboard })));
const ScenesView = lazy(() => import('@/views/ScenesView').then(m => ({ default: m.ScenesView })));
const EpisodeView = lazy(() => import('@/views/EpisodeView').then(m => ({ default: m.EpisodeView })));
const AssigneeView = lazy(() => import('@/views/AssigneeView').then(m => ({ default: m.AssigneeView })));
const TeamView = lazy(() => import('@/views/TeamView').then(m => ({ default: m.TeamView })));
const CalendarView = lazy(() => import('@/views/CalendarView').then(m => ({ default: m.CalendarView })));
const ScheduleView = lazy(() => import('@/views/ScheduleView').then(m => ({ default: m.ScheduleView })));
const VacationView = lazy(() => import('@/views/VacationView').then(m => ({ default: m.VacationView })));
const CompositingView = lazy(() => import('@/views/CompositingView')); // default export
const SettingsView = lazy(() => import('@/views/SettingsView').then(m => ({ default: m.SettingsView })));
import { SpotlightSearch } from '@/components/spotlight/SpotlightSearch';
import { LoginScreen } from '@/components/auth/LoginScreen';
const PasswordChangeModal = lazy(() => import('@/components/auth/PasswordChangeModal').then(m => ({ default: m.PasswordChangeModal })));
const UserManagerModal = lazy(() => import('@/components/auth/UserManagerModal').then(m => ({ default: m.UserManagerModal })));
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { GradientBackdrop } from '@/components/common/GradientBackdrop';
import { loadGasConfig, connectGas, checkGasConnection } from '@/services/gasConfigService';
import { readAll } from '@/services/supabaseService';
import { readAllFromSupabase, testSupabaseConnection, readAllMetadataFromSupabase, onSupabaseRealtimeEvent, onSupabaseStatusChange } from '@/services/supabaseService';
import type { SupabaseRealtimeEvent } from '@/services/supabaseService';
import { invalidatePartCache } from '@/services/commentService';
import { invalidateRevisionsCache } from '@/services/revisionService';
import { extractSceneDelta } from '@/utils/realtimeDelta';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { loadLayout, loadPreferences, savePreferences, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers, setUsersSheetsMode, migrateUsersToSheets } from '@/services/userService';
import { applyTheme, getPreset, getLightColors, deriveThemeFromAccent, sanitizeCustomHex, DEFAULT_THEME_ID } from '@/themes';
import { applyPreferencesToDOM, FONT_COLOR_PRESETS, applyTextColors } from '@/utils/typography';
import { WelcomeToast } from '@/components/WelcomeToast';
import { getGreeting, isFirstLogin, markFirstLoginShown } from '@/utils/greetings';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { DEFAULT_GAS_IMAGE_URL, DEFAULT_VACATION_URL } from '@/config';
import { Toaster, toast as sonnerToast } from 'sonner';
import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';
import { SvgIconDefs } from '@/components/SvgIconDefs';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useVacationPendingStore } from '@/stores/useVacationPendingStore';
import { dispatchNotification, type NotificationSettings } from '@/utils/notificationHelper';
import { isRecentSelfRevisionAction } from '@/stores/useRevisionStore';

// Lazy chunk 로드 실패(네트워크 끊김, 빌드 artifact 누락) 시 블랭크 스크린 방지용 ErrorBoundary.
// 이 컴포넌트 자체는 파일 외부로 분리하지 않고 로컬에 유지 — 인증 모달/메인 뷰 한정으로만 사용.
class LazyErrorBoundary extends Component<{ children: ReactNode; name: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(`[LazyErrorBoundary] ${this.props.name} 로드 실패:`, err, info);
  }
  render() {
    if (this.state.hasError) return null; // 모달/뷰가 뜨지 않는 편이 크래시보다 낫다
    return this.props.children;
  }
}

export default function App() {
  const { currentView, setWidgetLayout, setAllWidgetLayout, setEpisodeWidgetLayout, setChartType, setDataConnected, setGasConfig, themeId, customThemeColors, setThemeId, setCustomThemeColors, colorMode, setColorMode, setVacationConnected, setActiveDataSource } = useAppStore();
  const { setEpisodes, setSyncing, setLastSyncTime, setSyncError, setEpisodeTitles, setEpisodeMemos } = useDataStore();
  const {
    currentUser, setCurrentUser,
    authReady, setAuthReady,
    setUsers,
    isAdminMode, setAdminMode,
    showPasswordChange, showUserManager, setShowUserManager,
  } = useAuthStore();

  // Sonner 토스트 브릿지: 기존 setToast 호출을 Sonner로 전달
  const setStoreToast = useAppStore((s) => s.setToast);
  const storeToast = useAppStore((s) => s.toast);

  // 전역 그라데이션 배경 토글 (모든 뷰 뒤에 표시, 로그인/스플래시 포함)
  const globalGradientEnabled = useAppStore((s) => s.plexusSettings.globalGradientEnabled !== false);

  // 글로벌 스토어 토스트 → Sonner 자동 전달
  useEffect(() => {
    if (!storeToast) return;
    const msg = typeof storeToast === 'string' ? storeToast : storeToast.message;
    const type = typeof storeToast === 'string' ? 'info' : (storeToast.type || 'info');
    if (type === 'success') sonnerToast.success(msg);
    else if (type === 'error' || type === 'critical') sonnerToast.error(msg, { duration: type === 'critical' ? 10000 : 5000 });
    else if (type === 'warning') sonnerToast.warning(msg, { duration: 5000 });
    else sonnerToast.info(msg);
    setStoreToast(null);
  }, [storeToast, setStoreToast]);

  // 로컬 setToast — Sonner 직접 호출
  const setToast = useCallback((msg: string | { message: string; type?: 'info' | 'success' | 'error' | 'warning' | 'critical' } | null) => {
    if (!msg) return;
    const text = typeof msg === 'string' ? msg : msg.message;
    const type = typeof msg === 'string' ? 'info' : (msg.type || 'info');
    if (type === 'success') sonnerToast.success(text);
    else if (type === 'error' || type === 'critical') sonnerToast.error(text, { duration: type === 'critical' ? 10000 : 5000 });
    else if (type === 'warning') sonnerToast.warning(text, { duration: 5000 });
    else sonnerToast.info(text);
  }, []);

  // 재시도 알림 수신 → Sonner 토스트 표시
  useEffect(() => {
    const cleanup = window.electronAPI?.onRetryNotify?.((message) => {
      sonnerToast.warning(message);
    });
    return () => { cleanup?.(); };
  }, []);

  // currentUser 변경 시 메인 프로세스에 동기화 (활동 기록 자동 user_id/user_name 사용)
  useEffect(() => {
    window.electronAPI?.authSetCurrentUser?.(
      currentUser ? { id: currentUser.id, name: currentUser.name } : null,
    );
  }, [currentUser]);

  // 활동(activity_log) 글로벌 구독 + 초기 로드 — 로그인 후 1번.
  // RecentActivityWidget 의 자체 구독은 idempotent 처리되어 중복 호출 안전.
  // 한솔 결정 (2026-05-02): Realtime 을 위젯 lifecycle 에 묶지 말고 App 전역에서 항상 구독 →
  // 위젯 안 떠 있어도 씬 모달이 실시간 audit 받음.
  useEffect(() => {
    if (!currentUser) return;
    useActivityStore.getState().loadInitial();
    const unsub = subscribeToActivityRealtime((row) => {
      useActivityStore.getState().receiveRealtime(row);
    });
    return () => { unsub(); };
  }, [currentUser]);

  // 토스트 설정 (위치/시간) — 설정에서 로드
  const [toastPosition, setToastPosition] = useState<'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'>('bottom-right');
  const [toastDuration, setToastDuration] = useState(3000);

  // 종료 대기 알림 수신 → 저장 중 오버레이
  const [savingBeforeQuit, setSavingBeforeQuit] = useState(false);
  useEffect(() => {
    const cleanup = window.electronAPI?.onSavingBeforeQuit?.(() => {
      setSavingBeforeQuit(true);
    });
    return () => { cleanup?.(); };
  }, []);

  // 토스트 설정 변경 실시간 반영 (NotificationSection에서 이벤트 발생)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.toastPosition) setToastPosition(detail.toastPosition);
      if (detail?.toastDuration) setToastDuration(detail.toastDuration);
    };
    window.addEventListener('bflow:toast-settings-changed', handler);
    return () => window.removeEventListener('bflow:toast-settings-changed', handler);
  }, []);

  // 알림 설정 변경 실시간 반영 (NotificationSection에서 이벤트 발생)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        notiSettingsRef.current = {
          ...notiSettingsRef.current,
          ...detail,
        };
      }
    };
    window.addEventListener('bflow:noti-settings-changed', handler);
    return () => window.removeEventListener('bflow:noti-settings-changed', handler);
  }, []);

  // 알림 설정 ref (broadcast 핸들러에서 최신값 참조용)
  const notiSettingsRef = useRef<NotificationSettings>({ sceneChange: true, commentNotify: true, osNotification: true });

  // 알림 중복 방지 (broadcast + postgres_changes 동시 도착 시)
  const MAX_DEDUP_KEYS = 200;
  const recentNotiKeysRef = useRef<Set<string>>(new Set());
  const dedupeNotification = useCallback((key: string): boolean => {
    const set = recentNotiKeysRef.current;
    if (set.has(key)) return false; // 이미 처리됨
    set.add(key);
    // 크기 상한 초과 시 가장 오래된 키 제거 (Set은 삽입 순서 유지)
    if (set.size > MAX_DEDUP_KEYS) {
      const first = set.values().next().value;
      if (first !== undefined) set.delete(first);
    }
    setTimeout(() => set.delete(key), 3000);
    return true; // 처리 가능
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
      const connected = await checkGasConnection();
      if (!connected) {
        const cfg = await loadGasConfig();
        const url = cfg?.webAppUrl || DEFAULT_GAS_IMAGE_URL;
        if (url) {
          const result = await connectGas(url);
          if (!result.ok) throw new Error('시트 연결 실패');
          setDataConnected(true);
        } else {
          throw new Error('데이터 소스 연결 실패');
        }
      }

      const episodes = await readAll();
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
  }, [setEpisodes, setSyncing, setLastSyncTime, setSyncError, setEpisodeTitles, setEpisodeMemos, setDataConnected, setActiveDataSource]);

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

        // 글꼴 크기/색상 적용 (FOUC 방지: 테마보다 먼저 적용)
        if (savedPrefs) applyPreferencesToDOM(savedPrefs);

        // Phase 8-4: 스플래시 건너뛰기
        if (savedPrefs?.skipLoadingSplash) setLoadingSplashDone(true);
        if (savedPrefs?.skipLandingSplash) setShowSplash(false);

        // Phase 8-3: 플렉서스 설정 로드
        if (savedPrefs?.plexus) {
          const p = savedPrefs.plexus;
          useAppStore.getState().setPlexusSettings({
            loginEnabled: p.loginEnabled ?? true,
            loginGradientEnabled: p.loginGradientEnabled ?? true,
            loginParticleCount: p.loginParticleCount ?? 666,
            dashboardEnabled: p.dashboardEnabled ?? true,
            dashboardGradientEnabled: p.dashboardGradientEnabled ?? true,
            dashboardParticleCount: p.dashboardParticleCount ?? 120,
            globalGradientEnabled: p.globalGradientEnabled ?? true,
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

        // 토스트 설정 로드
        if (savedPrefs?.notifications?.toastPosition) {
          setToastPosition(savedPrefs.notifications.toastPosition);
        }
        if (savedPrefs?.notifications?.toastDuration) {
          setToastDuration(savedPrefs.notifications.toastDuration);
        }

        // 알림 히스토리 로드
        useNotificationStore.getState().loadFromDisk();

        // 알림 설정 ref 업데이트
        if (savedPrefs?.notifications) {
          notiSettingsRef.current = {
            sceneChange: savedPrefs.notifications.sceneChange ?? true,
            commentNotify: savedPrefs.notifications.commentNotify ?? true,
            osNotification: savedPrefs.notifications.osNotification ?? true,
            sound: savedPrefs.notifications.sound ?? true,
          };
        }

        // 테마 로드 + 적용 (가드 설정 후 상태 변경)
        const savedTheme = await loadTheme();
        if (savedTheme) {
          const savedMode = savedTheme.colorMode ?? 'dark';
          themeInitRef.current = true;

          // 프리셋/커스텀 모든 경로에서 hex 복원 (preferences.json 기준)
          // → 이후 theme-save useEffect가 실행돼도 null로 덮어쓰지 않도록 보장
          useAppStore.getState().setCustomAccentHex(savedTheme.customAccentHex ?? null);
          useAppStore.getState().setCustomSubHex(savedTheme.customSubHex ?? null);

          // 커스텀 테마 마이그레이션
          let customHex: { accent: string; sub: string } | null = null;
          if (savedTheme.themeId === 'custom') {
            customHex = sanitizeCustomHex({
              customAccentHex: savedTheme.customAccentHex,
              customSubHex: savedTheme.customSubHex,
              customThemeColors: savedTheme.customColors ?? null,
            });
            if (!customHex) {
              console.warn('[테마] 커스텀 테마 데이터 손상 → 기본 프리셋으로 폴백');
            }
          }

          // 실제 적용할 테마 ID (커스텀 복구 실패 시 기본 프리셋으로 강제)
          const effectiveThemeId =
            savedTheme.themeId === 'custom' && !customHex
              ? DEFAULT_THEME_ID
              : savedTheme.themeId;

          // CSS 적용
          if (effectiveThemeId === 'custom' && customHex) {
            const colors = deriveThemeFromAccent(customHex.accent, customHex.sub, savedMode);
            applyTheme(colors, savedMode);
            setThemeId('custom');
            setColorMode(savedMode);
            setCustomThemeColors(colors);
            // sanitize로 보강된 경우 스토어도 보강된 hex로 갱신 (위 기본 복원 덮어쓰기)
            if (customHex.accent !== (savedTheme.customAccentHex ?? null)) {
              useAppStore.getState().setCustomAccentHex(customHex.accent);
            }
            if (customHex.sub !== (savedTheme.customSubHex ?? null)) {
              useAppStore.getState().setCustomSubHex(customHex.sub);
            }
            // 구포맷만 있거나 sanitize로 보강된 경우 새 포맷으로 재저장
            if (savedTheme.customAccentHex !== customHex.accent || savedTheme.customSubHex !== customHex.sub) {
              saveTheme({
                themeId: 'custom',
                customColors: colors,
                colorMode: savedMode,
                customAccentHex: customHex.accent,
                customSubHex: customHex.sub,
              });
            }
          } else if (savedMode === 'light') {
            applyTheme(getLightColors(effectiveThemeId), savedMode);
            setThemeId(effectiveThemeId);
            setColorMode(savedMode);
          } else {
            const preset = getPreset(effectiveThemeId);
            if (preset) {
              applyTheme(preset.colors, savedMode);
              setThemeId(effectiveThemeId);
              setColorMode(savedMode);
            } else {
              // 완전 손상 (프리셋 ID도 유효하지 않음) → 최종 폴백
              const fallback = getPreset(DEFAULT_THEME_ID)!;
              applyTheme(fallback.colors, savedMode);
              setThemeId(DEFAULT_THEME_ID);
              setColorMode(savedMode);
            }
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
        console.info('[auth] rememberMe =', rememberMe);
        if (rememberMe) {
          const { user } = await loadSession();
          if (user) {
            setCurrentUser(user);
            console.info('[auth] currentUser 설정 완료');
          } else {
            console.info('[auth] 세션 없음 — 로그인 화면 표시');
          }
        }

        // Supabase 연결 확인 (항상 시도)
        const sbConn = await testSupabaseConnection();
        if (sbConn.ok) {
          console.log('[Supabase] 연결 성공');
          setDataConnected(true);
          setUsersSheetsMode(true); // 사용자 서비스도 IPC 모드 활성화
        }

        // Sheets fallback 연결 (Supabase 실패 시에만)
        if (!sbConn.ok) {
          const config = await loadGasConfig();
          const urlToConnect = config?.webAppUrl || DEFAULT_GAS_IMAGE_URL;
          if (urlToConnect) {
            const effectiveConfig = config ?? { webAppUrl: urlToConnect };
            setGasConfig(effectiveConfig);
            const result = await connectGas(urlToConnect);
            if (result.ok) {
              setDataConnected(true);
              setUsersSheetsMode(true);
              console.log('[Sheets] fallback 연결 성공');
              migrateUsersToSheets().catch(() => {});
            }
          }
        }

        // Supabase/Sheets 연결 후 사용자 목록 재로드 + 세션 재복원
        // (위에서 sheetsMode=false 상태로 로컬 users.dat를 읽었으므로,
        //  Supabase 사용자 ID와 달라 세션 복원이 실패할 수 있음)
        if (useAppStore.getState().dataConnected && !useAuthStore.getState().currentUser) {
          const freshUsers = await loadUsers();
          setUsers(freshUsers);
          if (rememberMe) {
            const { user: freshUser } = await loadSession();
            if (freshUser) setCurrentUser(freshUser);
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

  // 세션 변경 브로드캐스트: currentUser 변화를 모든 위젯 창에 전파
  // (로그인/세션 복원/로그아웃/비밀번호 변경 등 모든 setCurrentUser 경로 공통)
  // 로그인: user truthy → { user } 브로드캐스트
  // 로그아웃: null → { user: null } 명시적 브로드캐스트 (위젯 창이 currentUser를 null로 재설정)
  // 첫 실행 시 이미 로그인된 사용자(loadSession 복원 등)가 있으면 broadcast —
  // 플로팅 위젯이 이미 열려 있는 경우 초기 사용자 상태를 전파하기 위함.
  const prevBroadcastUserRef = useRef<typeof currentUser | undefined>(undefined);
  useEffect(() => {
    const prev = prevBroadcastUserRef.current;
    prevBroadcastUserRef.current = currentUser;

    // 첫 실행: currentUser가 이미 있다면 broadcast (플로팅 위젯이 이미 열려 있을 수 있음)
    if (prev === undefined) {
      if (currentUser) {
        window.electronAPI?.sessionBroadcastChange?.({ user: currentUser });
      }
      return;
    }

    // 동일 사용자 + 동일 필드면 스킵.
    // id만 비교하면 같은 유저의 필드 변경(비밀번호 변경, isInitialPassword, role, name 등)이 전파되지 않아
    // 팝업/위젯 창이 stale currentUser를 유지하게 됨. AppUser는 평탄 data 구조(types/index.ts:114)라
    // JSON.stringify 동등성으로 안전하게 비교 가능.
    const isSameUser =
      (prev === null && currentUser === null) ||
      (prev != null &&
        currentUser != null &&
        JSON.stringify(prev) === JSON.stringify(currentUser));
    if (isSameUser) return;

    window.electronAPI?.sessionBroadcastChange?.({ user: currentUser ?? null });
  }, [currentUser]);

  // 사용자 변경 시 목록 리로드
  useEffect(() => {
    if (currentUser) {
      loadUsers().then(setUsers);
    }
  }, [currentUser, setUsers]);

  // 한솔 결정 (v1.15.5): 로그인 catch-up — last_seen_at 이후 받은 멘션 댓글을 알림 패널에 누적.
  // v1.15.6 진단 로그: 한솔 보고 "catch-up 실행 안 됨" — 단계별 콘솔 로그로 정확한 원인 파악.
  const catchupDoneUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    console.log('[catchup] effect 진입', { currentUser: currentUser?.id, authReady, doneRef: catchupDoneUserIdRef.current });
    if (!currentUser) { console.log('[catchup] currentUser 없음 — skip'); return; }
    if (!authReady) { console.log('[catchup] authReady false — skip'); return; }
    if (catchupDoneUserIdRef.current === currentUser.id) {
      console.log('[catchup] 이미 처리된 사용자 — skip', currentUser.id);
      return;
    }

    catchupDoneUserIdRef.current = currentUser.id;
    const me = currentUser;
    console.log('[catchup] 처리 시작', { id: me.id, name: me.name });

    (async () => {
      const { getLastSeenAt, setLastSeenAt, ensureLastSeenInitialized } = await import('@/utils/lastSeenTracker');
      const lastSeen = getLastSeenAt(me.id);
      console.log('[catchup] lastSeen', lastSeen);
      if (!lastSeen) {
        // 첫 로그인 — 이전 알림 catch-up 안 함, 시각만 기록
        ensureLastSeenInitialized(me.id);
        console.log('[catchup] 첫 로그인 — last_seen 초기화만, catch-up 스킵');
        return;
      }
      try {
        console.log('[catchup] supabaseFetchMissedMentions 호출', {
          available: !!window.electronAPI?.supabaseFetchMissedMentions,
          since: lastSeen,
        });
        const missed = await window.electronAPI?.supabaseFetchMissedMentions?.(me.id, me.name, lastSeen, 50);
        console.log('[catchup] fetch 결과', { count: missed?.length ?? 0, missed });
        if (!missed || missed.length === 0) {
          setLastSeenAt(me.id, new Date().toISOString());
          console.log('[catchup] 놓친 알림 없음 — last_seen 업데이트만');
          return;
        }
        // 알림 패널에만 누적 (토스트 X — 한꺼번에 N 개 띄우면 시끄러움)
        // 한솔 보고 (v1.15.9): catch-up 알림에서 씬 매칭이 안 됨. Realtime 분기와 동일 패턴으로
        // scene_uuid 우선 + part_id+sceneNo fallback 으로 정확한 scene 찾아 metadata 채움.
        const ds = useDataStore.getState();
        const store = useNotificationStore.getState();
        for (const c of missed) {
          // 1) scene_uuid 로 정확 매칭
          let scene = c.sceneUuid ? ds.findSceneByUuid(c.sceneUuid) : null;
          // 2) part_id + sceneNo 조합으로 fallback
          if (!scene && c.partId && c.sceneId) {
            const targetNo = Number(c.sceneId);
            if (Number.isFinite(targetNo)) {
              for (const ep of ds.episodes) {
                for (const part of ep.parts) {
                  if (part.id !== c.partId) continue;
                  const found = part.scenes.find((s) => Number(s.no) === targetNo);
                  if (found) { scene = found; break; }
                }
                if (scene) break;
              }
            }
          }
          store.addNotification({
            type: 'comment',
            title: `${c.userName || '누군가'}님이 나를 태그했습니다`,
            body: c.text ? (c.text.length > 50 ? c.text.slice(0, 50) + '...' : c.text) : undefined,
            // scene 매칭 성공 시 UUID + 사용자 sceneId 둘 다. 못 찾아도 sceneUuid 라도 넣어 '씬 보기' 버튼은 노출
            metadata: scene
              ? { sceneId: scene.id, sceneName: scene.sceneId }
              : (c.sceneUuid ? { sceneId: c.sceneUuid } : undefined),
          });
        }
        // 요약 토스트 1번 (한솔이 인지)
        sonnerToast(`놓친 알림 ${missed.length}개를 가져왔어요`, {
          description: '종 모양을 클릭해 확인해주세요.',
          duration: 6000,
        });
        setLastSeenAt(me.id, new Date().toISOString());
        console.log('[catchup] 완료', { added: missed.length });
      } catch (err) {
        console.warn('[catchup] 멘션 catch-up 실패:', err);
      }
    })();
  }, [currentUser, authReady]);

  // v1.15.11 (한솔 보고): persistRestore 책임을 ScenesView 외부로 이동.
  // 이전엔 ScenesView 마운트 시 saved last episode 를 복원했는데, 외부에서 navigateToScene 으로
  // setSelectedEpisode 를 set한 직후 ScenesView 가 첫 마운트 되는 케이스에서 race condition 발생 →
  // 다른 에피소드 알림 클릭 시 마지막 본 에피소드로 되돌아가는 버그.
  // 해결: 앱 root 에서 episodes 첫 로드 시 한 번만 saved 복원. selectedEpisode 가 이미 set 되어 있으면 skip.
  // → ScenesView 마운트 / unmount 와 무관하게 race 자체가 사라짐.
  const episodesForInit = useDataStore((s) => s.episodes);
  const selectedEpisodeForInit = useAppStore((s) => s.selectedEpisode);
  const lastEpisodeRestoredRef = useRef(false);
  useEffect(() => {
    if (lastEpisodeRestoredRef.current) return;
    if (episodesForInit.length === 0) return;
    if (selectedEpisodeForInit !== null && selectedEpisodeForInit !== undefined) {
      // 외부 (예: 알림 navigate) 가 이미 set 했으면 건드리지 않음
      lastEpisodeRestoredRef.current = true;
      return;
    }
    void import('@/utils/scenesViewPersist').then(({ loadPersistedLastEpisode }) => {
      const saved = loadPersistedLastEpisode();
      if (saved !== null && episodesForInit.some((ep) => ep.episodeNumber === saved)) {
        useAppStore.getState().setSelectedEpisode(saved);
      }
      lastEpisodeRestoredRef.current = true;
    });
  }, [episodesForInit, selectedEpisodeForInit]);

  // 테마 변경 시: CSS 적용 + appdata 저장 (초기화 완료 후에만 저장)
  useEffect(() => {
    if (!themeInitRef.current) return; // init()에서 테마 로드 전까지 저장 방지
    const { customAccentHex, customSubHex, setCustomThemeColors } = useAppStore.getState();

    if (themeId === 'custom') {
      // Case A: hex 두 개 모두 유효 → 현재 colorMode로 재파생
      if (customAccentHex && customSubHex) {
        const colors = deriveThemeFromAccent(customAccentHex, customSubHex, colorMode);
        applyTheme(colors, colorMode);
        // 얕은 비교로 동일한 결과면 setState를 건너뛰어 effect 재실행 루프 방지
        const same =
          customThemeColors !== null &&
          customThemeColors.bgPrimary === colors.bgPrimary &&
          customThemeColors.bgCard === colors.bgCard &&
          customThemeColors.bgBorder === colors.bgBorder &&
          customThemeColors.textPrimary === colors.textPrimary &&
          customThemeColors.textSecondary === colors.textSecondary &&
          customThemeColors.accent === colors.accent &&
          customThemeColors.accentSub === colors.accentSub;
        if (!same) {
          setCustomThemeColors(colors);
        }
        saveTheme({
          themeId,
          customColors: colors,
          colorMode,
          customAccentHex,
          customSubHex,
        });
        return;
      }
      // Case B: hex 없이 customThemeColors만 (마이그레이션 과도기)
      if (customThemeColors) {
        applyTheme(customThemeColors, colorMode);
        saveTheme({ themeId, customColors: customThemeColors, colorMode });
        return;
      }
      // Case C: themeId=custom이지만 hex/customThemeColors 모두 없음 → 기본 프리셋으로 폴백
      console.warn('[테마] themeId=custom이지만 색상 데이터 없음 → 기본 프리셋으로 폴백');
      setThemeId(DEFAULT_THEME_ID);
      // 이 setThemeId는 effect를 재실행시켜 프리셋 분기로 진입하므로 추가 처리 불필요
      return;
    }

    // 프리셋 경로
    if (colorMode === 'light') {
      applyTheme(getLightColors(themeId), colorMode);
      saveTheme({
        themeId,
        colorMode,
        customAccentHex: customAccentHex ?? undefined,
        customSubHex: customSubHex ?? undefined,
      });
    } else {
      const preset = getPreset(themeId);
      if (preset) {
        applyTheme(preset.colors, colorMode);
        saveTheme({
          themeId,
          colorMode,
          customAccentHex: customAccentHex ?? undefined,
          customSubHex: customSubHex ?? undefined,
        });
      }
    }
  }, [themeId, customThemeColors, colorMode]);

  // 테마 broadcast — themeId/colorMode/customThemeColors 중 어느 것이라도 바뀌면 전파
  // 별도 effect로 분리한 이유: 위 effect의 early return(custom 경로 Case A/B/C)을 우회하여
  // 커스텀 accent/sub 변경 시에도 플로팅 위젯에 전파되도록 보장
  //
  // payload에 customColors 포함: 팝업이 파일 재로드 없이 즉시 적용 → race 제거
  // (saveTheme 쓰기 완료 전에 broadcast가 발행될 수 있어, 팝업이 stale 파일을 읽는 문제 방지)
  useEffect(() => {
    if (!themeInitRef.current) return; // 초기 로드는 제외
    window.electronAPI?.themeBroadcastChange?.({
      themeId,
      colorMode,
      customColors: customThemeColors ?? null,
    });
  }, [themeId, customThemeColors, colorMode]);

  // 비-custom 폰트 색상 프리셋 사용 시: 테마/모드/커스텀색 변경에 따라 카테고리 색상 재계산·저장·broadcast
  // FontColorSection은 settings 'font' 탭이 열렸을 때만 마운트되므로,
  // 사용자가 다른 탭에서 테마를 바꾸면 stale fontCategoryColors가 디스크에 남는 문제 해결.
  useEffect(() => {
    if (!themeInitRef.current) return; // 초기 로드는 skip
    (async () => {
      try {
        const prefs = await loadPreferences();
        const preset = prefs?.fontColorPreset;
        if (!preset || preset === 'custom') return; // custom은 사용자 지정값 유지
        const themeColors =
          customThemeColors
            ?? (colorMode === 'light' ? getLightColors(themeId) : getPreset(themeId)?.colors);
        if (!themeColors) return;
        const primary = themeColors.textPrimary;
        const secondary = themeColors.textSecondary;
        const accentSub = themeColors.accentSub;
        const nextColors = FONT_COLOR_PRESETS[preset].getColors(primary, secondary, accentSub);
        applyTextColors(nextColors);
        await savePreferences({
          ...(prefs ?? {}),
          fontColorPreset: preset,
          fontCategoryColors: nextColors,
        });
        window.electronAPI?.preferencesBroadcastChange?.({
          fontColorPreset: preset,
          fontCategoryColors: nextColors,
        });
      } catch (err) {
        console.warn('[font-color] 테마 변경에 따른 재계산 실패:', err);
      }
    })();
  }, [themeId, colorMode, customThemeColors]);

  // 초기화 완료 후 데이터 로드
  // authReady 가드: init 완료 전까지 데이터 로딩 방지 (플래시 제거)
  useEffect(() => {
    if (!authReady) return;
    loadData();
  }, [authReady, loadData]);

  // onSheetChanged 리스너 삭제됨 — Supabase Realtime이 대체 (M-3)

  // Supabase Realtime: DB 변경 감지 → delta 직접 적용 또는 full reload
  useEffect(() => {
    if (!window.electronAPI?.onSupabaseRealtime) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = onSupabaseRealtimeEvent((event: SupabaseRealtimeEvent) => {
      const { table, payload } = event;
      console.log(`[App Realtime] 이벤트 수신: table=${table}, type=${payload?.eventType}`);

      // 댓글 변경 → 캐시 무효화 + 알림
      if (table === 'comments') {
        invalidatePartCache();

        // INSERT 이벤트: 다른 사용자가 내 씬에 댓글 / @멘션 시 알림
        if (payload?.eventType === 'INSERT' && payload?.new) {
          // comments 테이블 컬럼: scene_id 는 사실 scene.no(sort_order, 예: '1', '2'...).
          // 정확한 씬 매칭은 scene_uuid 컬럼 사용 (electron/supabase.ts:872 참고).
          const newComment = payload.new as {
            id?: string;
            scene_id?: string;
            scene_uuid?: string;
            part_id?: string;
            user_name?: string;
            user_id?: string;
            text?: string;
            mentions?: string[];
            // v1.18.0: 리비전 맥락 댓글 식별 — 값 있으면 'revision' 알림 경로로 분기.
            revision_id?: string | null;
          };
          const me = useAuthStore.getState().currentUser;

          // v1.18.0: 리비전 맥락 댓글 → 'revision' 알림 (revisionAction='comment').
          // 일반 댓글 알림 경로(isMentioned/isAssignee) 와 *분리* 해 중복 알림 방지.
          // 조건: revision_id 있음 + 그 리비전 notifyUserIds 에 나 포함 + 내가 작성자 아님.
          if (me && newComment.revision_id && newComment.user_id !== me.id) {
            const notiSettings = notiSettingsRef.current;
            if (notiSettings.commentNotify !== false) {
              import('@/stores/useRevisionStore').then(async ({ useRevisionStore }) => {
                let rev = useRevisionStore.getState().revisions.find((r) => r.id === newComment.revision_id);
                // 코덱스 P1 fix (3차, 2026-05-05): 리비전 store 가 비어있으면 (예: 다른 뷰에서
                // 시작한 fresh 세션) 댓글 알림이 silent drop 되던 문제. lazy load 후 재시도.
                if (!rev) {
                  await useRevisionStore.getState().loadRevisions();
                  rev = useRevisionStore.getState().revisions.find((r) => r.id === newComment.revision_id);
                  if (!rev) return;
                }
                const targets = Array.isArray(rev.notifyUserIds) ? rev.notifyUserIds : [];
                if (!targets.includes(me.id)) return;
                // dedupe — 같은 댓글이 broadcast/realtime 두 경로로 들어와도 한 번만.
                // 코덱스 P1 fix (2026-05-05): commentId 포함. 같은 사용자가 같은 리비전에
                // 짧은 시간 내 여러 댓글 작성 시 두 번째부터 dedupe 충돌로 알림 손실되던 문제.
                const dedupeKey = `revcomment:${newComment.id ?? ''}:${newComment.revision_id}`;
                if (!dedupeNotification(dedupeKey)) return;
                // 씬 매칭 — comment_panel.css 카드 라우팅 위해 sceneId/sceneName 도 같이 채움.
                const sceneByUuid = newComment.scene_uuid
                  ? useDataStore.getState().findSceneByUuid(newComment.scene_uuid)
                  : null;
                const body = newComment.text
                  ? (newComment.text.length > 60 ? newComment.text.slice(0, 60) + '...' : newComment.text)
                  : `${newComment.user_name || '누군가'}님 댓글`;
                dispatchNotification({
                  type: 'revision',
                  title: `리비전 댓글 — ${sceneByUuid?.sceneId || newComment.scene_id || ''}`,
                  body,
                  metadata: {
                    // 코덱스 P2 fix (8차, 2026-05-05): sceneByUuid 가 stale 캐시 등으로 null 일 때
                    // newComment.scene_uuid 폴백 — 라우팅이 sceneId/sceneName 의존이라 누락 시 알림 클릭이 동작 안 함.
                    sceneId: sceneByUuid?.id ?? newComment.scene_uuid,
                    sceneName: sceneByUuid?.sceneId,
                    revisionId: newComment.revision_id,
                    revisionAction: 'comment',
                  } as Record<string, unknown>,
                }, notiSettings);
              }).catch(() => { /* 무시 */ });
            }
            // 리비전 맥락 댓글은 일반 댓글 알림 경로 스킵.
            return;
          }

          // 한솔 테스트용 (v1.15.0): 본인이 본인 태그한 경우에도 토스트 발동되도록 user_id 자기 비교 제거.
          // 실 운영 시 본인 댓글 알림이 의미없으면 다음 PR 에서 user_id !== me.id 조건 복원.
          if (me && newComment.user_id && newComment.scene_id) {
            const dedupeKey = `comment:${newComment.user_id}:${newComment.scene_id}`;
            if (!dedupeNotification(dedupeKey)) { /* 이미 broadcast로 처리됨 */ }
            else {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.commentNotify !== false) {
                // 한솔 보고 (2026-04-28): comments.scene_id='1' 같은 sort_order 라 기존 sceneId/UUID 매칭 모두 실패.
                // 정확한 씬은 scene_uuid 우선. fallback 으로 part_id + sceneNo 매칭.
                const sceneByUuid = newComment.scene_uuid
                  ? useDataStore.getState().findSceneByUuid(newComment.scene_uuid)
                  : null;
                const sceneByPartAndNo = (() => {
                  if (sceneByUuid) return null;
                  if (!newComment.part_id || !newComment.scene_id) return null;
                  const targetNo = Number(newComment.scene_id);
                  if (!Number.isFinite(targetNo)) return null;
                  for (const ep of useDataStore.getState().episodes) {
                    for (const part of ep.parts) {
                      if (part.id !== newComment.part_id) continue;
                      const found = part.scenes.find((s) => Number(s.no) === targetNo);
                      if (found) return found;
                    }
                  }
                  return null;
                })();
                const scene = sceneByUuid ?? sceneByPartAndNo ?? null;
                const isMentioned = Array.isArray(newComment.mentions) && newComment.mentions.includes(me.name);
                const isAssignee = scene && scene.assignee === me.name;

                // 한솔 진단용 (v1.15.4): scene 매칭 실패 원인을 콘솔에서 정확히 파악하기 위한 로그.
                // 강선영 PC 등 다른 사용자에서 멘션 알림 받을 때 scene 못 찾는 케이스 진단.
                if (!scene) {
                  const ds = useDataStore.getState();
                  console.warn('[댓글알림진단] scene 매칭 실패', {
                    payload: {
                      scene_id: newComment.scene_id,
                      scene_uuid: newComment.scene_uuid,
                      part_id: newComment.part_id,
                      user_name: newComment.user_name,
                      mentions: newComment.mentions,
                    },
                    me: { id: me.id, name: me.name },
                    storeStats: {
                      episodeCount: ds.episodes.length,
                      partCount: ds.episodes.reduce((s, e) => s + e.parts.length, 0),
                      sceneCount: ds.episodes.reduce((s, e) => s + e.parts.reduce((ss, p) => ss + p.scenes.length, 0), 0),
                    },
                    samplePartIds: ds.episodes.flatMap((e) => e.parts.map((p) => p.id)).slice(0, 5),
                    matchedPart: newComment.part_id ? ds.episodes.flatMap((e) => e.parts).find((p) => p.id === newComment.part_id) : null,
                  });
                }

                if (isMentioned) {
                  dispatchNotification({
                    type: 'comment',
                    title: `${newComment.user_name || '누군가'}님이 나를 태그했습니다`,
                    body: newComment.text ? (newComment.text.length > 50 ? newComment.text.slice(0, 50) + '...' : newComment.text) : undefined,
                    // scene 정확히 찾았으면 UUID + 사용자 sceneId. 못 찾아도 scene_uuid 라도 넣어 '씬 보기' 버튼은 항상 노출
                    // (한솔 보고 v1.15.3: 다른 PC 사용자가 멘션 받았을 때 useDataStore 에 그 씬이 없어 metadata=undefined → 버튼 누락)
                    // navigateToScene 이 매칭 실패하면 자체 fallback 으로 씬 뷰 이동 + 안내
                    metadata: scene
                      ? { sceneId: scene.id, sceneName: scene.sceneId }
                      : (newComment.scene_uuid ? { sceneId: newComment.scene_uuid } : undefined),
                  }, notiSettings);
                } else if (isAssignee) {
                  dispatchNotification({
                    type: 'comment',
                    title: `${newComment.user_name || '누군가'}님이 댓글을 남겼습니다`,
                    body: newComment.text ? (newComment.text.length > 50 ? newComment.text.slice(0, 50) + '...' : newComment.text) : undefined,
                    metadata: { sceneId: scene!.id, sceneName: scene!.sceneId },
                  }, notiSettings);
                }
              }
            }
          }
        }
        return;
      }

      // scenes UPDATE → delta 직접 적용 (full reload 없이 즉시)
      // 주의: bulk op 확정은 여기서 처리하지 않는다. IPC 응답(runBulkOp)만을 확정 경로로 사용.
      // (Codex 리뷰 #9) updated_by === me.id 필터만으로는 "같은 사용자의 다른 op" 또는
      // "다른 기기의 지연된 에코"가 새 op의 pending을 잘못 confirm할 수 있어, op 레벨 correlation
      // 없이는 Realtime 확정이 안전하지 않다. Realtime은 데이터 스토어 동기화 용도로만 사용.
      if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
        const delta = extractSceneDelta(payload.new);
        if (delta) {
          const applied = useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
          if (applied) return;
        }
      }

      // scenes DELETE → 대상 UUID 즉시 제거 (full reload 없이 즉시)
      // 주의: bulk op 확정은 IPC 응답에서만 처리. 다른 사용자가 같은 씬을 동시 삭제했을 때
      //       field-edit/stage-toggle 경로의 pending이 가짜 confirm되는 것을 방지.
      //       (delete 경로도 RPC 응답에서 removeSceneByUuid를 직접 호출하므로 유실 없음)
      if (table === 'scenes' && payload?.eventType === 'DELETE') {
        const deletedId = (payload?.old as { id?: string } | undefined)?.id;
        if (typeof deletedId === 'string') {
          useDataStore.getState().removeSceneByUuid(deletedId);
          return;
        }
        // deletedId 없으면 (REPLICA IDENTITY 특이 상황) 아래 debounced reload로 fallthrough
      }

      // 리비전 변경 → 캐시 무효화 + 스토어 리로드 신호
      if (table === 'comp_revisions') {
        invalidateRevisionsCache();
        window.dispatchEvent(new Event('bflow:revisions-invalidated'));

        // v1.18.0: 본인이 notify_user_ids 에 포함되어 있으면 자체 알림 발송.
        // 등록자 본인(requester) 액션은 스킵 (자기 알림 X).
        const me = useAuthStore.getState().currentUser;
        if (!me) return;

        const notiSettings = notiSettingsRef.current;
        // 댓글 알림과 같은 settings flag 재사용 (별도 토글 없음 — 추후 분리 가능)
        if (notiSettings.commentNotify === false) return;

        if (payload?.eventType === 'INSERT' && payload?.new) {
          const row = payload.new as {
            id?: string;
            scene_id?: string;
            scene_uuid?: string;
            requester_id?: string;
            requester_name?: string;
            description?: string;
            revision_no?: number;
            notify_user_ids?: string[] | null;
            created_at?: string | null;
          };
          // 본인이 등록자면 스킵
          if (row.requester_id === me.id) return;
          // notify_user_ids 에 본인 없으면 스킵
          const targets = Array.isArray(row.notify_user_ids) ? row.notify_user_ids : [];
          if (!targets.includes(me.id)) return;

          // v1.19.7: 같은 INSERT 가 broadcast/realtime 두 경로로 들어와도 한 번만.
          // created_at 을 키에 포함해 같은 row 의 중복 이벤트만 차단 (다른 row 면 created_at 이 다름).
          if (row.id) {
            const dedupeKey = `revision:${row.id}:add:${row.created_at ?? ''}`;
            if (!dedupeNotification(dedupeKey)) return;
          }

          // sceneKey → 씬 매칭 (revisions 의 scene_id 는 'EP01:A:1' sceneKey 형식)
          const sceneKey = row.scene_id || '';
          const sceneNameForLabel = sceneKey.split(':').pop() || sceneKey;
          // 코덱스 P1 fix (2026-05-05): metadata.sceneName 에 last-token('a001')만 저장하면
          // 다른 EP/Part 의 같은 raw sceneId 와 reuse 충돌 → 알림 클릭 시 잘못된 씬으로 라우팅 가능.
          // sceneId(UUID) 우선 매칭으로 정확도 보장. sceneName 은 sceneKey 전체 보존 (fallback 식별자).

          dispatchNotification({
            type: 'revision',
            title: `새 리비전 — ${sceneNameForLabel}`,
            body: row.description ? (row.description.length > 50 ? row.description.slice(0, 50) + '...' : row.description) : `${row.requester_name || '누군가'}님이 등록`,
            metadata: {
              sceneId: row.scene_uuid,  // UUID 매칭 우선 (NotificationPanel:181 부근)
              sceneName: sceneKey,       // sceneKey 전체 보존 — last-token reuse 충돌 방지
              revisionId: row.id,
              revisionAction: 'add',
            } as Record<string, unknown>,
          }, notiSettings);
          return;
        }

        if (payload?.eventType === 'UPDATE' && payload?.new) {
          const newRow = payload.new as {
            id?: string;
            scene_id?: string;
            scene_uuid?: string;
            requester_id?: string;
            status?: string;
            revision_no?: number;
            resolved_by?: string | null;
            notify_user_ids?: string[] | null;
            updated_at?: string | null;
            resolved_at?: string | null;
          };
          const oldRow = payload.old as { status?: string } | undefined;
          const targets = Array.isArray(newRow.notify_user_ids) ? newRow.notify_user_ids : [];
          if (!targets.includes(me.id)) return;

          // 상태 변경 detect — old.status !== new.status 일 때만 알림
          if (!oldRow || oldRow.status === newRow.status) return;
          // 본인이 변경한 거면 스킵 (resolved_by 가 본인 이름이면) — resolved 전용 가드.
          if (newRow.resolved_by === me.name) return;

          let action: 'in_progress' | 'resolve';
          let titlePrefix: string;
          if (newRow.status === 'in_progress') {
            action = 'in_progress';
            titlePrefix = '리비전 진행중';
          } else if (newRow.status === 'resolved') {
            action = 'resolve';
            titlePrefix = '리비전 완료';
          } else {
            // open 으로 되돌림 — 알림 X
            return;
          }

          // 코덱스 P2 fix (4차, 2026-05-05): in_progress 자기 액션은 resolved_by 미채워져
          // 위 가드가 못 걸렀음. updateStatus 가 mark 해둔 self-action 체크로 차단.
          if (newRow.id && isRecentSelfRevisionAction(newRow.id, action)) return;

          // v1.19.7: 같은 UPDATE 가 두 경로 또는 동일 status 로의 다른 필드 UPDATE 로 두 번 도착할 때 차단.
          // resolve 는 resolved_at 이, in_progress 는 updated_at 이 안정 타임스탬프 (같은 status 반복 변경이면 시간이 다름).
          if (newRow.id) {
            const stamp = action === 'resolve'
              ? (newRow.resolved_at ?? newRow.updated_at ?? '')
              : (newRow.updated_at ?? '');
            const dedupeKey = `revision:${newRow.id}:${action}:${stamp}`;
            if (!dedupeNotification(dedupeKey)) return;
          }

          const sceneKey = newRow.scene_id || '';
          const sceneNameForLabel = sceneKey.split(':').pop() || sceneKey;
          // 코덱스 P1 fix (2026-05-05): INSERT 분기와 동일 — sceneId(UUID) 우선,
          // sceneName 은 sceneKey 전체 보존 (last-token reuse 충돌 방지).
          dispatchNotification({
            type: 'revision',
            title: `${titlePrefix} — ${sceneNameForLabel}`,
            metadata: {
              sceneId: newRow.scene_uuid,
              sceneName: sceneKey,
              revisionId: newRow.id,
              revisionAction: action,
            } as Record<string, unknown>,
          }, notiSettings);
          return;
        }
        return;
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

  // Realtime 리비전 변경 → useRevisionStore 리로드
  useEffect(() => {
    const handler = () => {
      import('@/stores/useRevisionStore').then(({ useRevisionStore }) => {
        // 이미 로드된 적이 있을 때만 리로드 (아직 한번도 안 열었으면 스킵)
        if (useRevisionStore.getState().lastLoadTime) {
          useRevisionStore.getState().loadRevisions();
        }
      });
    };
    window.addEventListener('bflow:revisions-invalidated', handler);
    return () => window.removeEventListener('bflow:revisions-invalidated', handler);
  }, []);

  // Supabase Broadcast: 다른 사용자의 쓰기 직후 즉시 delta 수신 (Publication 설정 불필요)
  useEffect(() => {
    if (!window.electronAPI?.onSupabaseBroadcast) return;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = window.electronAPI.onSupabaseBroadcast((raw: unknown) => {
      const data = raw as { event: string; payload: Record<string, unknown> };
      if (!data?.event) return;
      console.log(`[App Broadcast] 이벤트 수신: ${data.event}`, data.payload);

      if (data.event === 'scene-update') {
        // 체크박스 토글 → UUID로 즉시 반영
        const { sceneUuid, stage, value, senderId } = data.payload as { sceneUuid: string; stage: string; value: boolean; senderId?: string };
        if (sceneUuid && stage != null && value != null) {
          useDataStore.getState().updateSceneByUuid(sceneUuid, { [stage]: value });

          // 알림: 타인이 내 씬을 변경한 경우
          const me = useAuthStore.getState().currentUser;
          if (me && senderId && senderId !== me.id) {
            const scene = useDataStore.getState().findSceneByUuid(sceneUuid);
            if (scene && scene.assignee === me.name) {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.sceneChange !== false) {
                const stageLabel = stage === 'lo' ? 'LO' : stage === 'done' ? '완료' : stage === 'review' ? '검수' : stage === 'png' ? 'PNG' : stage;
                dispatchNotification({
                  type: 'scene_change',
                  title: `${scene.sceneId || sceneUuid} — ${stageLabel} ${value ? '✓' : '✗'}`,
                  body: `다른 사용자가 내 씬의 단계를 변경했습니다`,
                  metadata: { sceneId: sceneUuid, sceneName: scene.sceneId, fromStage: stage, toStage: value ? 'on' : 'off' },
                }, notiSettings);
              }
            }
          }
          return;
        }
      }

      if (data.event === 'scene-field-update') {
        // 필드 변경 → UUID로 즉시 반영
        const { sceneUuid, field, value, senderId } = data.payload as { sceneUuid: string; field: string; value: string | null; senderId?: string };
        if (sceneUuid && field) {
          // v1.16.0: lengthChange 필드는 '' (빈 문자열) 을 null 로 정규화 (송신부에서도 normalize 하지만 안전망)
          const normalized = (field === 'lengthChange' && value === '') ? null : value;
          useDataStore.getState().updateSceneByUuid(sceneUuid, { [field]: normalized });

          // 알림: 타인이 내 씬의 필드를 변경한 경우 (담당자 변경 등)
          const me = useAuthStore.getState().currentUser;
          if (me && senderId && senderId !== me.id) {
            const scene = useDataStore.getState().findSceneByUuid(sceneUuid);
            if (scene && scene.assignee === me.name) {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.sceneChange !== false) {
                dispatchNotification({
                  type: 'scene_change',
                  title: `${scene.sceneId || sceneUuid} — ${field} 변경`,
                  body: `다른 사용자가 내 씬의 정보를 수정했습니다`,
                  metadata: { sceneId: sceneUuid, sceneName: scene.sceneId },
                }, notiSettings);
              }
            }
          }
          return;
        }
      }

      if (data.event === 'comment-added') {
        // 댓글 추가 broadcast → 캐시 무효화 + 알림
        invalidatePartCache();
        window.dispatchEvent(new Event('bflow:comments-invalidated'));
        const { sceneId: commentSceneId, userName: commentUserName, userId: commentUserId, text: commentText, mentions: commentMentions } = data.payload as {
          sceneId?: string; userName?: string; userId?: string; text?: string; mentions?: string[];
        };
        const me = useAuthStore.getState().currentUser;
        if (me && commentUserId && commentUserId !== me.id && commentSceneId) {
          const dedupeKey = `comment:${commentUserId}:${commentSceneId}`;
          if (!dedupeNotification(dedupeKey)) { /* 이미 Realtime으로 처리됨 */ }
          else if (notiSettingsRef.current.commentNotify === false) { /* 알림 끔 */ }
          else {
            const notiSettings = notiSettingsRef.current;
            const scene = useDataStore.getState().findSceneBySceneId(commentSceneId!);
            const isMentioned = Array.isArray(commentMentions) && commentMentions.includes(me.name);
            const isAssignee = scene && scene.assignee === me.name;

            if (isMentioned) {
              // @멘션된 경우: 씬 담당 여부와 무관하게 알림
              dispatchNotification({
                type: 'comment',
                title: `${commentUserName || '누군가'}님이 나를 태그했습니다`,
                body: commentText ? (commentText.length > 50 ? commentText.slice(0, 50) + '...' : commentText) : undefined,
                metadata: scene ? { sceneId: scene.id, sceneName: scene.sceneId } : undefined,
              }, notiSettings);
            } else if (isAssignee) {
              // 내 씬에 댓글이 달린 경우
              dispatchNotification({
                type: 'comment',
                title: `${commentUserName || '누군가'}님이 댓글을 남겼습니다`,
                body: commentText ? (commentText.length > 50 ? commentText.slice(0, 50) + '...' : commentText) : undefined,
                metadata: { sceneId: scene!.id, sceneName: scene!.sceneId },
              }, notiSettings);
            }
          }
        }
        return;
      }

      if (data.event === 'data-change') {
        // 구조적 변경 (씬/파트/에피소드 추가/삭제) → 디바운스 full reload
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          console.log('[Broadcast] 구조 변경 감지 → reload');
          loadData();
        }, 300);
      }

      if (data.event === 'calendar-changed') {
        // GCal webhook → incremental sync (인증된 경우에만)
        import('@/services/googleCalendarService').then(({ isAuthenticated }) => {
          isAuthenticated().then((authed) => {
            if (!authed) return;
            import('@/services/calendarService').then(({ syncIncremental }) => {
              syncIncremental().catch((err) =>
                console.warn('[Broadcast] 캘린더 incremental sync 실패:', err),
              );
            });
          });
        });
      }
    });
    return () => {
      cleanup();
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [loadData]);

  // 환경설정(글꼴 크기/색상) 변경 브로드캐스트 구독
  // — 설정 창이 메인 창과 동일하지만, 메인도 자기 자신의 브로드캐스트에 반응해 재적용해야
  //    여러 창(메인 + 플로팅 위젯 N개) 간 일관성이 유지됨
  useEffect(() => {
    const cleanup = window.electronAPI?.onPreferencesChanged?.(() => {
      loadPreferences()
        .then((prefs) => { if (prefs) applyPreferencesToDOM(prefs); })
        .catch((err) => console.warn('[설정] 브로드캐스트 재적용 실패', err));
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── 캘린더 변경 IPC 브로드캐스트 구독 ───────────
  // 다른 창(플로팅 위젯 등)에서 발생한 캘린더 변경을 IPC로 받아
  // 자기 프로세스 window event로 재발행 → 기존 구독자(CalendarWidget/MyTasksWidget/ScheduleView)가 자동 반응
  // 무한 루프 방지: 송신자 제외는 메인 프로세스에서 처리됨
  useEffect(() => {
    const cleanup = window.electronAPI?.onCalendarChanged?.((payload) => {
      window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail: payload }));
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── 휴가 등록 완료 브로드캐스트 구독 → Sonner 토스트 ─────
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationRegistered?.((payload) => {
      const p = payload as { name?: string; type?: string } | undefined;
      const who = p?.name ? `${p.name} ` : '';
      const what = p?.type ? ` (${p.type})` : '';
      sonnerToast.success(`${who}휴가 등록 완료${what}`);
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── 휴가 등록 실패 브로드캐스트 구독 ─────────────
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationFailed?.((payload) => {
      const p = payload as { name?: string; error?: string } | undefined;
      const who = p?.name ? `${p.name} ` : '';
      const err = p?.error ?? '알 수 없는 오류';
      sonnerToast.error(`${who}휴가 등록 실패: ${err}`, { duration: 10000 });
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── pending 변경 브로드캐스트 구독 → hydrate (다른 창에서 add/remove/clearStale 시 동기화) ──
  // 송신자는 메인에서 excludeSenderId로 제외되므로 자기 상태를 덮어쓰지 않음
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationPendingChanged?.(() => {
      useVacationPendingStore.getState().hydrate();
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── pending 휴가: hydrate + 30초 타임아웃 (메인 창 전용) ────
  useEffect(() => {
    useVacationPendingStore.getState().hydrate();
    const timer = setInterval(async () => {
      try {
        const stale = await useVacationPendingStore.getState().clearStale(30_000);
        for (const p of stale) {
          sonnerToast.error(`휴가 등록 타임아웃: ${p.name ?? '알 수 없음'} (30초 경과)`, { duration: 10000 });
        }
      } catch (err) {
        console.warn('[vacation:pending] 타임아웃 검사 실패', err);
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  // 주기적 폴링: Realtime 이벤트 누락 방지용 안전망 (5초 간격)
  useEffect(() => {
    if (!authReady) return;
    const POLL_INTERVAL = 15_000;
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

  // 딥링크 수신 (bflow://scene/...) → 씬 뷰로 이동
  const { setPendingDeepLink } = useAppStore();
  useEffect(() => {
    if (!window.electronAPI?.onDeepLink) return;
    const cleanup = window.electronAPI.onDeepLink((data) => {
      console.log('[DeepLink] 수신:', data);
      setPendingDeepLink(data);
      useAppStore.getState().setView('scenes');
    });
    return cleanup;
  }, [setPendingDeepLink]);

  // 뷰 렌더링
  const renderView = () => {
    const view = (() => {
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
    })();
    return (
      <LazyErrorBoundary key={currentView} name={`View:${currentView}`}>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full w-full">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          {view}
        </Suspense>
      </LazyErrorBoundary>
    );
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
            src="./splash/opening_video.mp4"
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
    return (
      <>
        <GradientBackdrop intensity="normal" enabled={globalGradientEnabled} />
        <LoginScreen />
      </>
    );
  }

  // 스플래시 랜딩 (로그인 상태에서도 앱 시작 시 표시)
  if (showSplash) {
    return (
      <>
        <GradientBackdrop intensity="normal" enabled={globalGradientEnabled} />
        <LoginScreen mode="splash" onComplete={() => setShowSplash(false)} />
      </>
    );
  }

  return (
    <>
      <SvgIconDefs />
      <GradientBackdrop intensity="normal" enabled={globalGradientEnabled} />
      <MainLayout onRefresh={loadData}>{renderView()}</MainLayout>
      <SpotlightSearch />
      <GlobalTooltipProvider />

      {/* 비밀번호 변경 모달 */}
      {showPasswordChange && (
        <LazyErrorBoundary name="PasswordChangeModal">
          <Suspense fallback={null}>
            <PasswordChangeModal />
          </Suspense>
        </LazyErrorBoundary>
      )}

      {/* 관리자: 사용자 관리 모달 */}
      {showUserManager && (
        <LazyErrorBoundary name="UserManagerModal">
          <Suspense fallback={null}>
            <UserManagerModal />
          </Suspense>
        </LazyErrorBoundary>
      )}

      {/* Promise 기반 확인 다이얼로그 호스트 */}
      <ConfirmDialogHost />

      {/* Sonner 토스트 — 테마 색상 연동 + 스르륵 애니메이션 + 호버 펼침 */}
      <Toaster
        theme={colorMode === 'light' ? 'light' : 'dark'}
        position={toastPosition}
        duration={toastDuration}
        toastOptions={{
          className: 'bflow-toast',
          style: {
            fontSize: '13px',
          },
        }}
        gap={8}
        visibleToasts={5}
        expand={false}
        closeButton
      />

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
