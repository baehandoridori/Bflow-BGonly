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
import { loadGasConfig, connectGas, checkGasConnection } from '@/services/gasConfigService';
import { readAll } from '@/services/supabaseService';
import { readAllFromSupabase, testSupabaseConnection, readAllMetadataFromSupabase, onSupabaseRealtimeEvent, onSupabaseStatusChange } from '@/services/supabaseService';
import type { SupabaseRealtimeEvent } from '@/services/supabaseService';
import { invalidatePartCache } from '@/services/commentService';
import { invalidateRevisionsCache } from '@/services/revisionService';
import { extractSceneDelta } from '@/utils/realtimeDelta';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { loadLayout, loadPreferences, loadTheme, saveTheme } from '@/services/settingsService';
import { loadSession, loadUsers, setUsersSheetsMode, migrateUsersToSheets } from '@/services/userService';
import { applyTheme, getPreset, getLightColors } from '@/themes';
import { applyFontSettings, DEFAULT_FONT_SCALE, DEFAULT_CATEGORY_SCALES } from '@/utils/typography';
import type { FontScale } from '@/utils/typography';
import { WelcomeToast } from '@/components/WelcomeToast';
import { getGreeting, isFirstLogin, markFirstLoginShown } from '@/utils/greetings';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { DEFAULT_GAS_IMAGE_URL, DEFAULT_VACATION_URL } from '@/config';
import { Toaster, toast as sonnerToast } from 'sonner';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { dispatchNotification, type NotificationSettings } from '@/utils/notificationHelper';

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
          const newComment = payload.new as { scene_id?: string; user_name?: string; user_id?: string; text?: string; mentions?: string[] };
          const me = useAuthStore.getState().currentUser;
          if (me && newComment.user_id && newComment.user_id !== me.id && newComment.scene_id) {
            const dedupeKey = `comment:${newComment.user_id}:${newComment.scene_id}`;
            if (!dedupeNotification(dedupeKey)) { /* 이미 broadcast로 처리됨 */ }
            else {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.commentNotify !== false) {
                const scene = useDataStore.getState().findSceneBySceneId(newComment.scene_id!);
                const isMentioned = Array.isArray(newComment.mentions) && newComment.mentions.includes(me.name);
                const isAssignee = scene && scene.assignee === me.name;

                if (isMentioned) {
                  dispatchNotification({
                    type: 'comment',
                    title: `${newComment.user_name || '누군가'}님이 나를 태그했습니다`,
                    body: newComment.text ? (newComment.text.length > 50 ? newComment.text.slice(0, 50) + '...' : newComment.text) : undefined,
                    metadata: scene ? { sceneId: scene.id, sceneName: scene.sceneId } : undefined,
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
      if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
        const delta = extractSceneDelta(payload.new);
        if (delta) {
          const applied = useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
          if (applied) return;
        }
      }

      // 리비전 변경 → 캐시 무효화 + 스토어 리로드 신호
      if (table === 'comp_revisions') {
        invalidateRevisionsCache();
        window.dispatchEvent(new Event('bflow:revisions-invalidated'));
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
        const { sceneUuid, field, value, senderId } = data.payload as { sceneUuid: string; field: string; value: string; senderId?: string };
        if (sceneUuid && field) {
          useDataStore.getState().updateSceneByUuid(sceneUuid, { [field]: value });

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
    });
    return () => {
      cleanup();
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [loadData]);

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
