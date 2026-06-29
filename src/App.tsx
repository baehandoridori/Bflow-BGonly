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
const CompositingView = lazy(() => import('@/views/CompositingView')); // default export — 기존 리테이크 보드 (v1.30.0~ 'compositing-revisions' 로 이관)
const CompositingDashboardView = lazy(() => import('@/views/CompositingDashboardView')); // v1.30.0+ 새 현황 대시보드
const RetakeHubView = lazy(() => import('@/views/RetakeHubView')); // 리테이크 허브 5단계 — 감독 세트 허브
const CharacterBoardView = lazy(() => import('@/views/CharacterBoardView')); // 캐릭터 현황판 (게이팅)
const SettingsView = lazy(() => import('@/views/SettingsView').then(m => ({ default: m.SettingsView })));
import { SpotlightSearch } from '@/components/spotlight/SpotlightSearch';
import { LoginScreen } from '@/components/auth/LoginScreen';
const PasswordChangeModal = lazy(() => import('@/components/auth/PasswordChangeModal').then(m => ({ default: m.PasswordChangeModal })));
const UserManagerModal = lazy(() => import('@/components/auth/UserManagerModal').then(m => ({ default: m.UserManagerModal })));
import { GlobalTooltipProvider } from '@/components/ui/GlobalTooltip';
import { GradientBackdrop } from '@/components/common/GradientBackdrop';
import { loadGasConfig, connectGas, checkGasConnection } from '@/services/gasConfigService';
import { readAll } from '@/services/supabaseService';
import { testSupabaseConnection, readAllMetadataFromSupabase, onSupabaseRealtimeEvent, onSupabaseStatusChange } from '@/services/supabaseService';
import { applyAssigneeProgressMetadata } from '@/utils/assigneeProgress';
import type { SupabaseRealtimeEvent } from '@/services/supabaseService';
import { invalidatePartCache } from '@/services/commentService';
import { invalidateRevisionsCache } from '@/services/revisionService';
import { extractSceneDelta } from '@/utils/realtimeDelta';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { loadLayout, loadPreferences, savePreferences, loadTheme, saveTheme } from '@/services/settingsService';
import { semverGt } from '@/utils/semver';
import { loadSession, loadUsers, setUsersSheetsMode, migrateUsersToSheets } from '@/services/userService';
import { setFeedbackLastSeenAt, setAssignmentLastSeenAt, getCommentReactionLastSeenAt, setCommentReactionLastSeenAt } from '@/utils/lastSeenTracker';
import { buildReactionNotificationTitle } from '@/utils/commentReactionEmojiFormat';
import { applyTheme, getPreset, getLightColors, deriveThemeFromAccent, sanitizeCustomHex, hexToRgb, DEFAULT_THEME_ID } from '@/themes';
import { applyPreferencesToDOM, FONT_COLOR_PRESETS, applyTextColors } from '@/utils/typography';
import {
  DEFAULT_STAR_NEST_SETTINGS,
  normalizeBackgroundArt,
  normalizeBflowStarNestSettings,
  normalizeDashboardStarNestBlurPx,
  normalizeDashboardStarNestOpacity,
  normalizeStarNestSettings,
} from '@/utils/starNestSettings';
import { WelcomeToast } from '@/components/WelcomeToast';
import { UpdateCenterModal } from '@/components/update/UpdateCenterModal';
import { getGreeting, isFirstLogin, markFirstLoginShown } from '@/utils/greetings';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useCharacterBoardAccess } from '@/hooks/useCharacterBoardAccess';
import { installEditableFocusRecovery } from '@/utils/editableFocus';
import { DEFAULT_GAS_IMAGE_URL, DEFAULT_VACATION_URL } from '@/config';
import { Toaster, toast as sonnerToast } from 'sonner';
import { ConfirmDialogHost } from '@/components/common/ConfirmDialog';
import { SvgIconDefs } from '@/components/SvgIconDefs';
import { useNotificationStore, type AppNotification } from '@/stores/useNotificationStore';
import { useVacationPendingStore } from '@/stores/useVacationPendingStore';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { dispatchNotification, type NotificationSettings } from '@/utils/notificationHelper';
import { useRevisionSetStore } from '@/stores/useRevisionSetStore';
import { navigateNotificationToScene } from '@/utils/notificationSceneAction';
import { resolveNotificationSceneTarget } from '@/utils/notificationSceneNavigation';
import {
  beginCatchupRun,
  fetchCatchupPages,
  orderCatchupRowsForPrepend,
  releaseCatchupRunOnError,
  resetCatchupRun,
} from '@/utils/notificationCatchupRunner';
import {
  parseAssigneeList,
  collectCounterpartAssigneeNames,
  isCommentByUser,
  hasUserCommentedOnScene,
} from '@/utils/sceneNotificationRecipients';
import { buildRevisionNotificationUserIds } from '@/utils/revisionNotificationRecipients';
import {
  buildNotificationSceneDisplayLabel,
  buildNotificationSceneDisplayLabelFromSceneKey,
} from '@/utils/notificationEpisodeLabels';
import { isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';
import { isRecentSelfRevisionAction } from '@/stores/useRevisionStore';
import type { UpdateInfo } from '@/types';

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

function isSceneAssignedToUser<T extends { assignee?: string | null }>(
  scene: T | null | undefined,
  userName: string,
): scene is T {
  return Boolean(scene && parseAssigneeList(scene.assignee).includes(userName));
}

function markLocalFeedbackJumpAsRead(payload: { kind?: string; notificationId?: string }) {
  const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId.trim() : '';
  if (!notificationId) return;
  const store = useNotificationStore.getState();
  const target = store.notifications.find((n) =>
    payload.kind === 'assignment'
      ? n.metadata?.assignmentNotificationId === notificationId
      : n.metadata?.feedbackNotificationId === notificationId
  );
  if (target && !target.isRead) store.markAsRead(target.id);
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

  // 캐릭터 현황판 접근 권한 — 사이드바 메뉴뿐 아니라 뷰 렌더도 게이팅(공유 PC에서 뷰가 잔존해 다음 사용자에게 노출되는 것 방지).
  const hasCharacterBoardAccess = useCharacterBoardAccess();

  // Sonner 토스트 브릿지: 기존 setToast 호출을 Sonner로 전달
  const setStoreToast = useAppStore((s) => s.setToast);
  const storeToast = useAppStore((s) => s.toast);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);

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

  // 자동 업데이트 상태: 좌하단 버전 버튼/모달/토스트가 같은 상태를 공유.
  useEffect(() => {
    window.electronAPI?.getUpdateState?.()
      .then((state) => {
        if (state) setUpdateInfo(state);
      })
      .catch(() => { /* update state is best effort */ });
    const cleanup = window.electronAPI?.onUpdateState?.((state) => {
      setUpdateInfo(state);
    });
    return () => { cleanup?.(); };
  }, [setUpdateInfo]);

  // 자동 업데이트 다운로드 완료 알림 → "지금 업데이트" 버튼 토스트.
  // 사용자가 클릭 시 main이 applying 상태를 기록하고 app.quit → before-quit hook이
  // installer helper를 띄움 → 설치 후 최신 BFLOW.exe 열림. 일반 종료는 다음 실행에서 자동 적용.
  useEffect(() => {
    const cleanup = window.electronAPI?.onUpdateReady?.((version, state) => {
      const updateState: UpdateInfo = state ?? {
        status: 'ready',
        currentVersion: __APP_VERSION__,
        latestVersion: version,
        buildAt: '',
        ready: true,
        releaseNotes: [],
      };
      setUpdateInfo(updateState);
      sonnerToast.success(`새 버전 v${version} 사용 가능`, {
        description: '설치 파일 준비 완료. 적용 중에는 별도 진행 창이 표시됩니다',
        duration: Infinity,  // 사용자가 직접 닫을 때까지
        action: {
          label: '지금 업데이트',
          onClick: () => {
            setUpdateInfo({
              ...updateState,
              status: 'applying',
              message: '업데이트 설치 창을 여는 중입니다. 앱이 잠시 후 닫힙니다.',
            });
            sonnerToast.loading('업데이트 적용 중', {
              description: '잠시 후 앱이 닫히고 설치 진행 창이 표시됩니다',
              duration: Infinity,
            });
            window.electronAPI?.applyUpdateNow?.();
          },
        },
      });
    });
    return () => { cleanup?.(); };
  }, [setUpdateInfo]);

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

  const dispatchRevisionCommentNotification = useCallback((newComment: {
    id?: string | null;
    scene_id?: string | null;
    scene_uuid?: string | null;
    part_id?: string | null;
    user_name?: string | null;
    user_id?: string | null;
    text?: string | null;
    mentions?: string[] | null;
    revision_id?: string | null;
  }): boolean => {
    if (!newComment.revision_id) return false;

    const me = useAuthStore.getState().currentUser;
    if (!me || newComment.user_id === me.id) return true;

    const notiSettings = notiSettingsRef.current;
    if (notiSettings.commentNotify === false) return true;

    import('@/stores/useRevisionStore').then(async ({ useRevisionStore }) => {
      let rev = useRevisionStore.getState().revisions.find((r) => r.id === newComment.revision_id);
      // 리테이크 store 가 비어있으면 fresh 세션에서도 알림이 빠지지 않게 lazy load 후 재시도.
      if (!rev) {
        await useRevisionStore.getState().loadRevisions();
        rev = useRevisionStore.getState().revisions.find((r) => r.id === newComment.revision_id);
        if (!rev) return;
      }

      const revisionNotifyIds = Array.isArray(rev.notifyUserIds) ? rev.notifyUserIds : [];
      const mentionedNames = Array.isArray(newComment.mentions) ? newComment.mentions : [];
      const mentionedUserIds = useAuthStore.getState().users
        .filter((user) => mentionedNames.includes(user.name))
        .map((user) => user.id);
      const targets = new Set(buildRevisionNotificationUserIds({
        notifyUserIds: revisionNotifyIds,
        requesterId: rev.requesterId,
        mentionedUserIds,
      }));
      const isMentioned = mentionedNames.includes(me.name);
      if (!targets.has(me.id)) return;

      const dedupeKey = `revcomment:${newComment.id ?? ''}:${newComment.revision_id}`;
      if (!dedupeNotification(dedupeKey)) return;

      const dataState = useDataStore.getState();
      const sceneByUuid = newComment.scene_uuid
        ? dataState.findSceneByUuid(newComment.scene_uuid)
        : null;
      const sceneLabel = (() => {
        if (sceneByUuid?.sceneId) return sceneByUuid.sceneId;
        const sceneKeyLabel = buildNotificationSceneDisplayLabelFromSceneKey(
          newComment.scene_id,
          dataState.episodeTitles,
          dataState.episodes,
        );
        if (sceneKeyLabel) return sceneKeyLabel;
        return newComment.scene_id || '';
      })();
      const body = newComment.text
        ? (newComment.text.length > 60 ? newComment.text.slice(0, 60) + '...' : newComment.text)
        : `${newComment.user_name || '누군가'}님 댓글`;

      dispatchNotification({
        type: 'revision',
        title: `${isMentioned ? '리테이크 댓글 멘션' : '리테이크 댓글'} — ${sceneLabel}`,
        body,
        metadata: {
          sceneId: sceneByUuid?.id ?? newComment.scene_uuid ?? undefined,
          sceneName: sceneByUuid?.sceneId,
          commentId: newComment.id ?? undefined,
          commentSceneId: newComment.scene_id ?? undefined,
          commentPartId: newComment.part_id ?? undefined,
          revisionId: newComment.revision_id,
          revisionAction: 'comment',
        } as Record<string, unknown>,
      }, notiSettings);
    }).catch(() => { /* 무시 */ });

    return true;
  }, [dedupeNotification]);

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
        const episodes = await readAll();
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
        setEpisodes(episodes);
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

      const loadedEpisodes = await readAll();
      let episodes = loadedEpisodes;
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
            episodes = applyAssigneeProgressMetadata(loadedEpisodes, metaRes.data);
            setEpisodeTitles(titles);
            setEpisodeMemos(memos);
          }
        }
      } catch { /* 메타데이터 로드 실패는 무시 */ }
      setEpisodes(episodes);
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
          const shareBackgroundEffectPresets = p.shareBackgroundEffectPresets ?? true;
          const legacyBackgroundArt = normalizeBackgroundArt(
            p.dashboardBackgroundArt ?? p.backgroundArt ?? p.loginBackgroundArt,
          );
          const loadedLoginBackgroundArt = normalizeBackgroundArt(p.loginBackgroundArt ?? legacyBackgroundArt);
          const loadedDashboardBackgroundArt = normalizeBackgroundArt(p.dashboardBackgroundArt ?? legacyBackgroundArt);
          const legacyStarNest = normalizeStarNestSettings(
            p.dashboardStarNest ?? p.starNest ?? p.loginStarNest ?? DEFAULT_STAR_NEST_SETTINGS,
          );
          const loadedLoginStarNest = normalizeStarNestSettings(p.loginStarNest ?? legacyStarNest);
          const loadedDashboardStarNest = normalizeStarNestSettings(p.dashboardStarNest ?? legacyStarNest);
          const legacyBflowStarNest = normalizeBflowStarNestSettings(
            p.dashboardBflowStarNest ?? p.bflowStarNest ?? p.loginBflowStarNest,
          );
          const loadedLoginBflowStarNest = normalizeBflowStarNestSettings(p.loginBflowStarNest ?? legacyBflowStarNest);
          const loadedDashboardBflowStarNest = normalizeBflowStarNestSettings(p.dashboardBflowStarNest ?? legacyBflowStarNest);
          useAppStore.getState().setPlexusSettings({
            backgroundArt: legacyBackgroundArt,
            loginBackgroundArt: shareBackgroundEffectPresets ? legacyBackgroundArt : loadedLoginBackgroundArt,
            dashboardBackgroundArt: shareBackgroundEffectPresets ? legacyBackgroundArt : loadedDashboardBackgroundArt,
            shareBackgroundEffectPresets,
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
            starNest: legacyStarNest,
            loginStarNest: shareBackgroundEffectPresets ? legacyStarNest : loadedLoginStarNest,
            dashboardStarNest: shareBackgroundEffectPresets ? legacyStarNest : loadedDashboardStarNest,
            dashboardStarNestOpacity: normalizeDashboardStarNestOpacity(p.dashboardStarNestOpacity),
            dashboardStarNestBlurPx: normalizeDashboardStarNestBlurPx(p.dashboardStarNestBlurPx),
            bflowStarNest: legacyBflowStarNest,
            loginBflowStarNest: shareBackgroundEffectPresets ? legacyBflowStarNest : loadedLoginBflowStarNest,
            dashboardBflowStarNest: shareBackgroundEffectPresets ? legacyBflowStarNest : loadedDashboardBflowStarNest,
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

        useAppStore.getState().setCompletionTintEnabled(savedPrefs?.sceneUi?.completionTintEnabled ?? true);

        // v1.27.0: lastSeenVersion 토스트는 *splash 닫힌 후* 별도 effect 에서 처리.
        // 초기에 호출하면 Toaster 가 아직 mount 안 된 상태(splash 화면 동안) 라 안 보이는데
        // lastSeenVersion 은 갱신되어 다음 실행에도 안 보임 — 한솔 v1.27.0 1차 보고.

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
            // v1.23.2 codex 2차 P1: 저장된 customColors (preferences.json) 가 있으면 그것을 그대로 사용.
            //   ThemeSection.handleCustomApply 가 v1.23.2 부터 프리셋 base + 액센트만 override 패턴이라
            //   저장된 customColors 가 사용자 의도. deriveThemeFromAccent 다시 호출하면 라이트 모드 회색 회귀.
            //   savedTheme.customColors 가 없는 옛 데이터만 deriveThemeFromAccent 폴백.
            const colors = savedTheme.customColors
              ?? deriveThemeFromAccent(customHex.accent, customHex.sub, savedMode);
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

  // v1.30.0: 컴포지팅 메뉴가 둘로 나뉘었음을 사용자에게 1회 안내.
  // 기존 사용자 입장에서 '컴포지팅' 위치에 다른 화면이 떠 의아할 수 있으므로
  // 로그인 직후 한 번만 토스트 + localStorage 플래그.
  useEffect(() => {
    if (!authReady || !currentUser) return;
    try {
      const KEY = 'bflow:compositing-split-seen';
      if (localStorage.getItem(KEY) === '1') return;
      // 1초 지연으로 다른 환영 토스트와 겹치지 않게.
      const t = window.setTimeout(() => {
        sonnerToast.info('컴포지팅 메뉴가 둘로 나뉘었어요', {
          description: '"컴포지팅" 은 새 진행 현황 대시보드, "리테이크" 은 기존 리테이크 보드입니다.',
          duration: 7000,
        });
        try { localStorage.setItem(KEY, '1'); } catch { /* noop */ }
      }, 1000);
      return () => window.clearTimeout(t);
    } catch {
      // localStorage 사용 불가 환경(시크릿 모드 등) — silent skip
    }
  }, [authReady, currentUser]);

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

  const notificationUserId = currentUser?.id ?? null;
  useEffect(() => {
    void useNotificationStore.getState().loadFromDisk(notificationUserId);
  }, [notificationUserId]);

  // 한솔 결정 (v1.15.5): 로그인 catch-up — last_seen_at 이후 받은 멘션 댓글을 알림 패널에 누적.
  // v1.15.6 진단 로그: 한솔 보고 "catch-up 실행 안 됨" — 단계별 콘솔 로그로 정확한 원인 파악.
  const catchupDoneUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    console.log('[catchup] effect 진입', { currentUser: currentUser?.id, authReady, doneRef: catchupDoneUserIdRef.current });
    if (!currentUser) {
      resetCatchupRun(catchupDoneUserIdRef);
      console.log('[catchup] currentUser 없음 — skip');
      return;
    }
    if (!authReady) { console.log('[catchup] authReady false — skip'); return; }
    if (!beginCatchupRun(catchupDoneUserIdRef, currentUser.id)) {
      console.log('[catchup] 이미 처리된 사용자 — skip', currentUser.id);
      return;
    }

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
          console.log('[catchup] 놓친 알림 없음');
          return;
        }
        // 알림 패널에만 누적 (토스트 X — 한꺼번에 N 개 띄우면 시끄러움)
        // 한솔 보고 (v1.15.9): catch-up 알림에서 씬 매칭이 안 됨. Realtime 분기와 동일 패턴으로
        // scene_uuid 우선 + part_id+sceneNo fallback 으로 정확한 scene 찾아 metadata 채움.
        const ds = useDataStore.getState();
        const store = useNotificationStore.getState();
        for (const c of orderCatchupRowsForPrepend(missed)) {
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
            type: 'mention',
            title: `${c.userName || '누군가'}님이 나를 태그했습니다`,
            body: c.text ? (c.text.length > 50 ? c.text.slice(0, 50) + '...' : c.text) : undefined,
            createdAt: c.createdAt,
            // scene_uuid 없는 오래된 댓글도 part_uuid + sort_order 로 정확히 찾아갈 수 있게 storage hint 보존.
            metadata: {
              sceneId: scene?.id ?? c.sceneUuid ?? undefined,
              sceneName: scene?.sceneId,
              commentId: c.id,
              commentSceneId: c.sceneId,
              commentPartId: c.partId,
            },
          });
        }
        // 요약 토스트 1번 (한솔이 인지)
        sonnerToast(`놓친 알림 ${missed.length}개를 가져왔어요`, {
          description: '종 모양을 클릭해 확인해주세요.',
          duration: 6000,
        });
        if (missed[0]?.createdAt) setLastSeenAt(me.id, missed[0].createdAt);
        console.log('[catchup] 완료', { added: missed.length });
      } catch (err) {
        console.warn('[catchup] 멘션 catch-up 실패:', err);
        releaseCatchupRunOnError(catchupDoneUserIdRef, me.id);
      }
    })();
  }, [currentUser, authReady]);

  // v1.25.5 액팅 피드백 알림 catch-up — 댓글 멘션 catch-up 과 평행 구조, 별도 lastSeen 키.
  // 로그인 시 마지막 본 시각 이후 미읽음 피드백 알림을 DB 에서 일괄 조회 → 알림 패널 누적.
  // broadcast 가 끊긴 사이 발송된 알림도 영구 복원.
  //
  // 코덱스 1차 P1 #1 fix: currentUser null (logout) 시 ref clear — 다음 로그인 catch-up 재실행.
  // 코덱스 1차 P1 #2 fix: 페이지네이션 — limit 초과 unread 가 다음 로그인에서 영구 손실되지 않도록.
  const feedbackCatchupDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) {
      resetCatchupRun(feedbackCatchupDoneRef);  // P1 #1: logout 시 reset
      return;
    }
    if (!authReady) return;
    if (!beginCatchupRun(feedbackCatchupDoneRef, currentUser.id)) return;

    const me = currentUser;

    (async () => {
      const { getFeedbackLastSeenAt, setFeedbackLastSeenAt, ensureFeedbackLastSeenInitialized } =
        await import('@/utils/lastSeenTracker');
      const lastSeen = getFeedbackLastSeenAt(me.id);
      if (!lastSeen) {
        ensureFeedbackLastSeenInitialized(me.id);
        console.log('[feedback-catchup] 첫 로그인 — last_seen 초기화만');
        return;
      }
      try {
        const { fetchMissedFeedbackNotifications } = await import('@/services/supabaseService');
        // P1 #2: 페이지네이션 — 모든 미읽음 가져올 때까지 batch 반복
        const PAGE_SIZE = 100;
        const SAFE_CAP = 1000;
        type MissedRow = Awaited<ReturnType<typeof fetchMissedFeedbackNotifications>>[number];
        const { rows: all, cappedOut } = await fetchCatchupPages<MissedRow>({
          pageSize: PAGE_SIZE,
          safeCap: SAFE_CAP,
          fetchPage: ({ before, limit }) => fetchMissedFeedbackNotifications(me.id, lastSeen, limit, before),
          getCursor: (row) => row.createdAt,
        });
        if (cappedOut) console.warn('[feedback-catchup] SAFE_CAP 도달 — 페이지네이션 break', { fetched: all.length });
        console.log('[feedback-catchup] 조회 결과', { count: all.length, cappedOut });
        if (all.length === 0) {
          return;
        }
        const store = useNotificationStore.getState();
        for (const m of orderCatchupRowsForPrepend(all)) {
          const ds = useDataStore.getState();
          const epLabel = buildNotificationSceneDisplayLabel({
            episodeNumber: m.episodeNumber,
            sceneId: m.sceneId,
            episodeTitles: ds.episodeTitles,
            episodes: ds.episodes,
          });
          const transitionLabel = `${m.fromState ?? ''} → ${m.toState}`;
          store.addNotification({
            type: 'acting_feedback',
            title: `${m.senderName}님이 피드백을 요청했습니다`,
            body: epLabel,
            createdAt: m.createdAt,
            metadata: {
              sceneId: m.sceneUuid ?? undefined,
              sceneName: m.sceneId,
              sheetName: m.sheetName,
              changedBy: m.senderName,
              feedbackNotificationId: m.id,
              feedbackTransition: transitionLabel,
            },
          });
        }
        sonnerToast(`놓친 피드백 알림 ${all.length}건이 있어요`, {
          description: '종 모양을 클릭해 확인해주세요.',
          duration: 6000,
        });
        // 코덱스 2차 P2 fix: SAFE_CAP 도달 시 lastSeen 갱신 안 함 — cap 이하 older unread 가
        //   `created_at > lastSeen` 필터에서 영구히 제외되는 손실 차단. 다음 로그인이 같은
        //   lastSeen 으로 다시 시작하므로 이미 패널에 추가된 newer 알림이 재추가되지만,
        //   조용한 데이터 손실보다는 시각적 중복이 안전 (dedup 은 후속 과제).
        if (cappedOut) {
          console.warn('[feedback-catchup] cap 도달 — lastSeen 보존 (다음 로그인에 backlog 재조회)');
        } else {
          setFeedbackLastSeenAt(me.id, all[0].createdAt);
        }
      } catch (err) {
        console.warn('[feedback-catchup] 실패:', err);
        releaseCatchupRunOnError(feedbackCatchupDoneRef, me.id);
      }
    })();
  }, [currentUser, authReady]);

  // v1.25.8 씬 담당자 배정 알림 catch-up — 한솔 보고: 미접속 시 배정 알림이 사라짐.
  //   feedback catch-up 과 동일 패턴 (페이지네이션 + 별도 lastSeen + logout 시 ref clear).
  const assignmentCatchupDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) {
      resetCatchupRun(assignmentCatchupDoneRef);
      return;
    }
    if (!authReady) return;
    if (!beginCatchupRun(assignmentCatchupDoneRef, currentUser.id)) return;

    const me = currentUser;

    (async () => {
      const { getAssignmentLastSeenAt, ensureAssignmentLastSeenInitialized } =
        await import('@/utils/lastSeenTracker');
      const lastSeen = getAssignmentLastSeenAt(me.id);
      if (!lastSeen) {
        ensureAssignmentLastSeenInitialized(me.id);
        console.log('[assignment-catchup] 첫 로그인 — last_seen 초기화만');
        return;
      }
      try {
        const { fetchMissedAssignmentNotifications } = await import('@/services/supabaseService');
        const PAGE_SIZE = 100;
        const SAFE_CAP = 1000;
        type MissedRow = Awaited<ReturnType<typeof fetchMissedAssignmentNotifications>>[number];
        const { rows: all, cappedOut } = await fetchCatchupPages<MissedRow>({
          pageSize: PAGE_SIZE,
          safeCap: SAFE_CAP,
          fetchPage: ({ before, limit }) => fetchMissedAssignmentNotifications(me.id, lastSeen, limit, before),
          getCursor: (row) => row.createdAt,
        });
        if (cappedOut) console.warn('[assignment-catchup] SAFE_CAP 도달 — 페이지네이션 break', { fetched: all.length });
        console.log('[assignment-catchup] 조회 결과', { count: all.length, cappedOut });
        if (all.length === 0) {
          return;
        }
        const store = useNotificationStore.getState();
        for (const m of orderCatchupRowsForPrepend(all)) {
          const ds = useDataStore.getState();
          const epLabel = buildNotificationSceneDisplayLabel({
            episodeNumber: m.episodeNumber,
            sceneId: m.sceneId,
            episodeTitles: ds.episodeTitles,
            episodes: ds.episodes,
          });
          const prev = m.prevAssignee?.trim();
          const transitionLabel = prev ? `${prev} → ${m.newAssignee}` : `미배정 → ${m.newAssignee}`;
          store.addNotification({
            type: 'scene_assignment',
            title: `${m.senderName}님이 담당자로 지정했습니다`,
            body: epLabel,
            createdAt: m.createdAt,
            metadata: {
              sceneId: m.sceneUuid,
              sceneName: m.sceneId,
              sheetName: m.sheetName,
              changedBy: m.senderName,
              assignmentNotificationId: m.id,
              assignmentTransition: transitionLabel,
            },
          });
        }
        sonnerToast(`놓친 배정 알림 ${all.length}건이 있어요`, {
          description: '종 모양을 클릭해 확인해주세요.',
          duration: 6000,
        });
        // 코덱스 2차 P2 fix: SAFE_CAP 도달 시 lastSeen 보존 — 같은 이유 (feedback 과 동일).
        if (cappedOut) {
          console.warn('[assignment-catchup] cap 도달 — lastSeen 보존 (다음 로그인에 backlog 재조회)');
        } else {
          setAssignmentLastSeenAt(me.id, all[0].createdAt);
        }
      } catch (err) {
        console.warn('[assignment-catchup] 실패:', err);
        releaseCatchupRunOnError(assignmentCatchupDoneRef, me.id);
      }
    })();
  }, [currentUser, authReady]);

  // v1.29.0: 댓글 이모지 반응 알림 catch-up — 미접속 사이 받은 반응 알림 일괄 조회.
  //   acting_feedback / scene_assignment 와 동일 패턴 (별도 lastSeen + 페이지네이션 + logout 시 ref clear).
  const reactionCatchupDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) {
      resetCatchupRun(reactionCatchupDoneRef);
      return;
    }
    if (!authReady) return;
    if (!beginCatchupRun(reactionCatchupDoneRef, currentUser.id)) return;

    const me = currentUser;

    (async () => {
      const {
        getCommentReactionLastSeenAt,
        setCommentReactionLastSeenAt,
        ensureCommentReactionLastSeenInitialized,
      } = await import('@/utils/lastSeenTracker');
      const lastSeen = getCommentReactionLastSeenAt(me.id);
      if (!lastSeen) {
        ensureCommentReactionLastSeenInitialized(me.id);
        console.log('[reaction-catchup] 첫 로그인 — last_seen 초기화만');
        return;
      }
      try {
        const { fetchCommentReactionNotifications } = await import('@/services/supabaseService');
        const PAGE_SIZE = 100;
        const SAFE_CAP = 1000;
        // 코덱스 12차 P1: fetch 진입 직전 시각을 기록 → catch-up 진행 중 realtime 으로
        //   들어온 신규 알림을 stale 로 오판하지 않게 purge 의 상한선으로 사용.
        const fetchStartedAt = new Date().toISOString();
        // 코덱스 8차 P1: offset 페이지네이션 대신 cursor (before=last_action_at) seek.
        //   페이지 사이 row 추가/삭제로 인한 누락·중복 차단. feedback/assignment catch-up 과 동일.
        const { rows: all, cappedOut } = await fetchCatchupPages<AppNotification>({
          pageSize: PAGE_SIZE,
          safeCap: SAFE_CAP,
          fetchPage: async ({ before, limit }) => {
            const batch = await fetchCommentReactionNotifications({
              recipientId: me.id,
              since: lastSeen,
              before,
              limit,
            });
            return (batch?.data ?? []) as AppNotification[];
          },
          // 코덱스 14차 P2: 단일 timestamp cursor 가 아니라 (last_action_at, id) composite 사용.
          //   같은 last_action_at 행이 page 경계에 걸쳐 영구 누락되는 문제 차단.
          getCursor: (row) => `${row.createdAt}|${row.id}`,
        });
        if (cappedOut) console.warn('[reaction-catchup] SAFE_CAP 도달 — 페이지네이션 break', { fetched: all.length });
        console.log('[reaction-catchup] 조회 결과', { count: all.length, cappedOut });
        // 코덱스 13차 P1: fetch 가 throw 하면 아래 catch 로 빠져 lastSeen 갱신 안 함 (재시도 시 같은 since 유지).
        if (all.length === 0) {
          // 빈 fetch 라도 since~fetchStartedAt 구간의 stale 알림 정리 트리거.
          useNotificationStore.getState().appendCatchupCommentReactions([], lastSeen, fetchStartedAt);
          setCommentReactionLastSeenAt(me.id, new Date().toISOString());
          return;
        }
        useNotificationStore.getState().appendCatchupCommentReactions(all, lastSeen, fetchStartedAt);
        // cap 도달 시 lastSeen 보존 (feedback/assignment 와 동일 — 데이터 손실 방지).
        // 코덱스 15차 P2: composite cursor "<lastAt>|<id>" 로 같은 ts 행 누락 차단.
        if (!cappedOut) {
          const newest = all[0];
          setCommentReactionLastSeenAt(me.id, `${newest.createdAt}|${newest.id}`);
        }
      } catch (err) {
        console.warn('[reaction-catchup] 실패:', err);
        // 코덱스 14차 P2: 실패 시 done flag 클리어 → 같은 세션 안에서 다음 effect run 또는 currentUser
        //   재마운트 시 재시도 가능. 그대로 두면 startup 네트워크 hiccup 한 번에 세션 내내 catch-up 영구 차단.
        releaseCatchupRunOnError(reactionCatchupDoneRef, me.id);
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
      // Case A: hex 두 개 모두 유효
      if (customAccentHex && customSubHex) {
        // v1.23.2 codex 3차 P1: customThemeColors 가 ThemeSection.handleCustomApply 에서 만든
        //   "프리셋 base + 액센트 override" 형태면 그것을 우선 사용 (라이트 모드 배경 그대로 보존).
        //   customThemeColors 가 없거나 accent 가 hex 와 불일치하면 (옛 데이터/마이그레이션) deriveThemeFromAccent 폴백.
        //   colorMode 변경 시 어색하면 사용자가 다시 커스텀 적용 — 일관된 사용자 의도 우선.
        const accentMatches = customThemeColors
          && customThemeColors.accent === hexToRgb(customAccentHex)
          && customThemeColors.accentSub === hexToRgb(customSubHex);
        const colors = accentMatches
          ? customThemeColors!
          : deriveThemeFromAccent(customAccentHex, customSubHex, colorMode);
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

      if (table === 'scene_work_links') {
        useSceneWorkLinkStore.getState().applyRealtime(payload);
        return;
      }

      // 댓글 변경 → 알림 분기 평가 → 캐시 무효화
      // 코덱스 P1 fix (2026-05-10): invalidatePartCache() 가 알림 분기 *전*에 있으면 isCommentByUser/
      //   hasUserCommentedOnScene 가 캐시 비어진 상태에서 호출되어 false 반환 → 답글-자동멘션·스레드 참여자
      //   알림이 silent skip. invalidate 는 분기 평가 *후* 로 옮기고, 호출 시점도 try/finally 로 보장.
      if (table === 'comments') {
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
            // v1.18.0: 리테이크 맥락 댓글 식별 — 값 있으면 'revision' 알림 경로로 분기.
            revision_id?: string | null;
            // v1.24.0: 1단계 대댓글이면 부모 댓글 id. 답글 알림 분기에 사용.
            parent_comment_id?: string | null;
          };
          const me = useAuthStore.getState().currentUser;

          // v1.18.0: 리테이크 맥락 댓글 → 'revision' 알림 (revisionAction='comment').
          // 일반 댓글 알림 경로(isMentioned/isAssignee) 와 *분리* 해 중복 알림 방지.
          // 조건: revision_id 있음 + 그 리테이크 notifyUserIds 에 나 포함 + 내가 작성자 아님.
          if (dispatchRevisionCommentNotification(newComment)) {
            // 리테이크 맥락 댓글은 일반 댓글 알림 경로 스킵.
            // 코덱스 P2 fix (2026-05-10): early return *전* 캐시 무효화. 안 그러면 리테이크 댓글이
            //   캐시에 stale 한 상태로 남아 일반 댓글 뷰에서 누락됨 (broadcast 가 늦거나 끊긴 케이스).
            invalidatePartCache();
            return;
          }

          // v1.24.0: 본인 댓글 알림 차단 — 같은 PC에서 작성한 댓글에 본인이 알림받는 건 노이즈.
          // (한솔 테스트용 v1.15.0 의 user_id !== me.id 제거를 본 PR 에서 복원.)
          if (me && newComment.user_id && newComment.user_id !== me.id && newComment.scene_id) {
            // v1.24.0: dedupeKey 에 commentId 포함 → 같은 사용자가 같은 씬에 짧은 시간 내 여러 댓글 작성 시
            //   broadcast/realtime dedupe 가 두 번째부터 충돌해 silent drop 되던 문제 방지.
            const dedupeKey = `comment:${newComment.user_id}:${newComment.scene_id}:${newComment.id ?? ''}`;
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
                // v1.24.0: assignee 가 콤마 구분 다중 담당자면 split → 자기 이름 포함 여부 매칭.
                // 동일 sceneNo 의 BG↔ACT counterpart 부서 assignee 도 함께 검사 (한 댓글이 양쪽 공유 → 양쪽 작업자 모두 알림).
                const assigneeNames = scene ? parseAssigneeList(scene.assignee) : [];
                const isAssignee = assigneeNames.includes(me.name);
                const counterpartAssigneeNames = scene
                  ? collectCounterpartAssigneeNames(scene)
                  : [];
                const isCounterpartAssignee = counterpartAssigneeNames.includes(me.name);
                // v1.24.0: 답글 부모 작성자 → 자동 멘션 (자기 댓글에 답글 받음).
                let isReplyToMe = false;
                if (newComment.parent_comment_id) {
                  isReplyToMe = isCommentByUser(newComment.parent_comment_id, me.id);
                }
                // v1.24.0: 스레드 참여자 — 해당 씬 댓글 캐시에 자기 userId 댓글이 있는지.
                const isThreadParticipant = scene
                  ? hasUserCommentedOnScene(newComment.part_id, scene, me.id)
                  : false;

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

                // v1.24.0: 알림 분기 — 강한 시각 신호(mention) > 차분한 자동 알림(comment) 우선순위.
                // mention 조건: 명시 @멘션 OR 자기 댓글에 답글 (자동 멘션).
                // comment 조건: 씬 담당자(BG/ACT 모두) OR 스레드 참여자. mention 이 우선이면 comment 는 발송 안 함.
                const baseMetadata: Record<string, unknown> = {
                  sceneId: scene?.id ?? newComment.scene_uuid,
                  sceneName: scene?.sceneId,
                  commentId: newComment.id,
                  commentSceneId: newComment.scene_id,
                  commentPartId: newComment.part_id,
                };
                if (newComment.parent_comment_id) {
                  baseMetadata.parentCommentId = newComment.parent_comment_id;
                }
                const bodyShort = newComment.text
                  ? (newComment.text.length > 50 ? newComment.text.slice(0, 50) + '...' : newComment.text)
                  : undefined;
                const author = newComment.user_name || '누군가';

                if (isMentioned || isReplyToMe) {
                  const title = isMentioned
                    ? `${author}님이 나를 태그했습니다`
                    : `${author}님이 내 댓글에 답글을 남겼습니다`;
                  dispatchNotification({
                    type: 'mention',
                    title,
                    body: bodyShort,
                    metadata: { ...baseMetadata, mentionedBy: author },
                  }, notiSettings);
                } else if (isAssignee || isCounterpartAssignee || isThreadParticipant) {
                  const reason = isAssignee
                    ? '내 씬에 댓글'
                    : isCounterpartAssignee
                    ? '함께 작업 중인 씬에 댓글'
                    : '내가 댓글 단 씬에 새 댓글';
                  // v1.24.0 P1 #10: 더블스페이스 방지 — sceneId 가 비면 prefix 자체 생략.
                  const sceneIdLabel = scene?.sceneId ? `${scene.sceneId} ` : '';
                  dispatchNotification({
                    type: 'comment',
                    title: `${author}님이 ${sceneIdLabel}${reason}`,
                    body: bodyShort,
                    metadata: baseMetadata,
                  }, notiSettings);
                }
              }
            }
          }
        }
        // 코덱스 P1 fix (2026-05-10): 알림 분기 평가가 끝난 *후* 캐시 무효화 →
        //   isCommentByUser/hasUserCommentedOnScene 가 fresh 한 cache 를 사용해 답글-자동멘션·스레드 참여자
        //   알림을 정확히 발송. invalidate 는 다음 조회 시점에 fresh load 트리거.
        invalidatePartCache();
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

      // 리테이크 변경 → 캐시 무효화 + 스토어 리로드 신호
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
            set_id?: string | null;
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
          // '전반'(씬 미지정) 항목은 씬 컨텍스트가 없다 → 세트 제목으로 알리고, 클릭은 리테이크 허브로(코덱스 P2).
          //   (씬 필드가 비어 있어 기존 씬 라벨/씬 점프 경로는 빈 제목 + 이동 불가가 된다.)
          if (!sceneKey) {
            const setTitle = row.set_id
              ? useRevisionSetStore.getState().sets.find((s) => s.id === row.set_id)?.title
              : undefined;
            dispatchNotification({
              type: 'revision',
              title: `새 리테이크 — ${setTitle || '전반 항목'}`,
              body: row.description
                ? (row.description.length > 50 ? row.description.slice(0, 50) + '...' : row.description)
                : `${row.requester_name || '누군가'}님이 등록`,
              metadata: {
                revisionId: row.id,
                revisionAction: 'add',
                retakeHubSetId: row.set_id ?? undefined,
              } as Record<string, unknown>,
            }, notiSettings);
            return;
          }
          const dataState = useDataStore.getState();
          const sceneNameForLabel = buildNotificationSceneDisplayLabelFromSceneKey(
            sceneKey,
            dataState.episodeTitles,
            dataState.episodes,
          ) || sceneKey.split(':').pop() || sceneKey;
          // 코덱스 P1 fix (2026-05-05): metadata.sceneName 에 last-token('a001')만 저장하면
          // 다른 EP/Part 의 같은 raw sceneId 와 reuse 충돌 → 알림 클릭 시 잘못된 씬으로 라우팅 가능.
          // sceneId(UUID) 우선 매칭으로 정확도 보장. sceneName 은 sceneKey 전체 보존 (fallback 식별자).

          dispatchNotification({
            type: 'revision',
            title: `새 리테이크 — ${sceneNameForLabel}`,
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
            set_id?: string | null;
            updated_at?: string | null;
            resolved_at?: string | null;
          };
          const oldRow = payload.old as { status?: string } | undefined;
          const targets = Array.isArray(newRow.notify_user_ids) ? newRow.notify_user_ids : [];
          if (!targets.includes(me.id)) return;

          // 상태 변경 detect — old.status !== new.status 일 때만 알림
          if (!oldRow || oldRow.status === newRow.status) return;
          // 최종완료 되돌리기(resolved → 비resolved)는 알림 보내지 않음 (open 복귀와 동일 무알림 정책).
          // 되돌리기 전용 알림이 '담당 완료'로 오인 발송되던 문제 방지.
          if (oldRow.status === 'resolved' && newRow.status !== 'resolved') return;
          // 본인이 변경한 거면 스킵 (resolved_by 가 본인 이름이면) — resolved 전용 가드.
          if (newRow.resolved_by === me.name) return;

          let action: 'in_progress' | 'assignee_done' | 'resolve';
          let titlePrefix: string;
          if (newRow.status === 'in_progress') {
            action = 'in_progress';
            titlePrefix = '리테이크 진행중';
          } else if (newRow.status === 'assignee_done') {
            // 리테이크 허브 2단계: 담당 전원 완료 → 최종 완료 대기
            // 담당 완료 알림은 완료멘트 입력 UI의 선택 수신자 broadcast 경로에서 보낸다.
            // 여기서 notify_user_ids 전체에 자동 발송하면 사용자가 완료 시 해제한 대상에게도 중복 알림이 간다.
            return;
          } else if (newRow.status === 'resolved') {
            action = 'resolve';
            titlePrefix = '리테이크 완료';
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
          // '전반' 항목 상태 변경 — 씬 컨텍스트 없음 → 세트 제목 + 클릭 시 허브로(코덱스 P2, INSERT 분기와 동일).
          if (!sceneKey) {
            const setTitle = newRow.set_id
              ? useRevisionSetStore.getState().sets.find((s) => s.id === newRow.set_id)?.title
              : undefined;
            dispatchNotification({
              type: 'revision',
              title: `${titlePrefix} — ${setTitle || '전반 항목'}`,
              metadata: {
                revisionId: newRow.id,
                revisionAction: action,
                retakeHubSetId: newRow.set_id ?? undefined,
              } as Record<string, unknown>,
            }, notiSettings);
            return;
          }
          const dataState = useDataStore.getState();
          const sceneNameForLabel = buildNotificationSceneDisplayLabelFromSceneKey(
            sceneKey,
            dataState.episodeTitles,
            dataState.episodes,
          ) || sceneKey.split(':').pop() || sceneKey;
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

      // 리테이크 세트 변경 → 세트 스토어 리로드 신호 (comp_revisions 분기와 동일 패턴)
      if (table === 'comp_revision_sets') {
        window.dispatchEvent(new Event('bflow:revision-sets-invalidated'));
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

  // Realtime 리테이크 변경 → useRevisionStore 리로드
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

  // Realtime 리테이크 세트 변경 → useRevisionSetStore 리로드
  useEffect(() => {
    const handler = () => {
      import('@/stores/useRevisionSetStore').then(({ useRevisionSetStore }) => {
        useRevisionSetStore.getState().reload();
      });
    };
    window.addEventListener('bflow:revision-sets-invalidated', handler);
    return () => window.removeEventListener('bflow:revision-sets-invalidated', handler);
  }, []);

  // v1.25.0~ 액팅 피드백 알림 수신 + 씬 점프 리스너 (코덱스 2차 P1 #4 fix)
  // 이전에는 ScenesView 안에 있었으나, 다른 뷰(Dashboard 등)에서도 알림을 받아야 하므로 App 최상위로 승격.
  useEffect(() => {
    if (!window.electronAPI?.onSupabaseBroadcast) return;

    const offBroadcast = window.electronAPI.onSupabaseBroadcast((event: unknown) => {
      const e = event as { event?: string; payload?: Record<string, unknown> };

      // v1.25.8 씬 담당자 배정 알림 — 본인이 새 담당자로 지정될 때 dispatch.
      //   acting-feedback 과 동일 시각 톤 (강한 펄스 + OS 토스트).
      if (e?.event === 'scene-assignment-notification') {
        const ap = e.payload as {
          notificationId: string;
          createdAt?: string;
          sceneUuid: string; sceneId: string; sheetName: string;
          episodeNumber: number;
          recipientId: string;
          senderId: string; senderName: string;
          prevAssignee: string; newAssignee: string;
        } | undefined;
        const me = useAuthStore.getState().currentUser;
        if (!ap || !me?.id) return;
        // 본인이 새 담당자인 경우만 토스트
        if (ap.recipientId !== me.id) return;
        // 본인이 본인을 지정하는 경우는 차단
        if (ap.senderId === me.id) return;

        const ds = useDataStore.getState();
        const epLabel = buildNotificationSceneDisplayLabel({
          episodeNumber: ap.episodeNumber,
          sceneId: ap.sceneId,
          episodeTitles: ds.episodeTitles,
          episodes: ds.episodes,
        });
        const prev = ap.prevAssignee?.trim();
        const transitionLabel = prev ? `${prev} → ${ap.newAssignee}` : `미배정 → ${ap.newAssignee}`;
        dispatchNotification({
          type: 'scene_assignment',
          title: `${ap.senderName}님이 담당자로 지정했습니다`,
          body: `${epLabel} (${transitionLabel})`,
          metadata: {
            sceneId: ap.sceneUuid,
            sceneName: ap.sceneId,
            sheetName: ap.sheetName,
            changedBy: ap.senderName,
            assignmentTransition: transitionLabel,
            assignmentNotificationId: ap.notificationId,
          },
        }, { ...notiSettingsRef.current, osNotification: false });
        // Windows 네이티브 토스트 + 클릭 시 점프 (리테이크와 동일 sceneJump 경로 재사용)
        // 코덱스 3차 P2 fix: notificationId/kind 도 함께 전달 — 클릭으로 점프했을 때 jump 핸들러가 read_at 처리.
        if (notiSettingsRef.current.osNotification !== false) {
          window.electronAPI.notifyFeedbackToast({
            title: 'B flow — 담당자 배정',
            body: `${ap.senderName}님이 ${epLabel} 담당자로 지정했습니다.`,
            sceneJump: {
              sheetName: ap.sheetName,
              sceneId: ap.sceneId,
              sceneUuid: ap.sceneUuid,
              notificationId: ap.notificationId,
              kind: 'assignment',
            },
          }).catch(() => { /* 토스트 실패 무시 */ });
        }
        // broadcast 를 즉시 받았으므로 lastSeen 갱신 → 다음 로그인 catch-up 에서 중복 차단
        if (me?.id) setAssignmentLastSeenAt(me.id, ap.createdAt ?? new Date().toISOString());
        return;
      }

      if (e?.event === 'retake-assignee-completion') {
        const p = e.payload as {
          revisionId?: string;
          sceneKey?: string;
          setId?: string | null;
          revisionNo?: number;
          senderId?: string;
          senderName?: string;
          recipients?: string[];
          note?: string;
          status?: string;
          updatedAt?: string;
        } | undefined;
        const me = useAuthStore.getState().currentUser;
        if (!p || !me?.id) return;
        const notiSettings = notiSettingsRef.current;
        if (notiSettings.commentNotify === false) return;
        if (!Array.isArray(p.recipients) || !p.recipients.includes(me.id)) return;
        if (p.senderId === me.id) return;
        const dedupeKey = `retake-assignee-completion:${p.revisionId ?? ''}:${p.senderId ?? ''}:${p.updatedAt ?? ''}`;
        if (!dedupeNotification(dedupeKey)) return;

        const ds = useDataStore.getState();
        const sceneKey = p.sceneKey;
        const isGeneralRetakeCompletion = !sceneKey || isGeneralRevisionSceneKey(sceneKey);
        const sceneTarget = !isGeneralRetakeCompletion
          ? resolveNotificationSceneTarget({ sceneName: sceneKey }, ds.episodes)
          : null;
        const sceneLabel = !isGeneralRetakeCompletion
          ? (sceneTarget?.sceneName || buildNotificationSceneDisplayLabelFromSceneKey(
            sceneKey,
            ds.episodeTitles,
            ds.episodes,
          ) || sceneKey.split(':').pop() || sceneKey)
          : '전반 항목';
        const notePreview = p.note?.trim()
          ? (p.note.trim().length > 60 ? p.note.trim().slice(0, 60) + '...' : p.note.trim())
          : undefined;
        const revisionLabel = Number.isFinite(p.revisionNo) ? `re#${p.revisionNo}` : '리테이크';
        const revisionEventId = [p.senderId, p.updatedAt].filter(Boolean).join(':') || undefined;

        dispatchNotification({
          type: 'revision',
          title: `리테이크 담당 완료 — ${sceneLabel}`,
          body: notePreview
            ? `${p.senderName || '담당자'}님이 ${revisionLabel} 담당을 완료했습니다. ${notePreview}`
            : `${p.senderName || '담당자'}님이 ${revisionLabel} 담당을 완료했습니다.`,
          metadata: !isGeneralRetakeCompletion
            ? {
                sceneId: sceneTarget?.sceneUuid,
                sceneName: sceneTarget?.sceneName ?? sceneKey,
                sheetName: sceneTarget?.sheetName,
                partId: sceneTarget?.partId,
                revisionId: p.revisionId,
                revisionAction: 'assignee_done',
                revisionEventId,
              } as Record<string, unknown>
            : {
                revisionId: p.revisionId,
                revisionAction: 'assignee_done',
                revisionEventId,
                retakeHubSetId: p.setId ?? undefined,
              } as Record<string, unknown>,
        }, notiSettings);
        return;
      }

      if (e?.event !== 'acting-feedback-request') return;
      const p = e.payload as {
        sceneUuid: string; sceneId: string; sheetName: string;
        episodeNumber: number; senderId: string; senderName: string;
        fromState: string; toState: string;
        workRound: number; feedbackRound: number;
        recipients: string[];
        // v1.25.5 코덱스 1차 P2 #3: INSERT 결과의 recipient_id → notification_id 매핑
        notificationIdsByRecipient?: Record<string, string>;
        notificationCreatedAtByRecipient?: Record<string, string>;
      } | undefined;
      const me = useAuthStore.getState().currentUser;
      // v1.25.4 진단 로그 — 한솔 보고 "알림이 실제로 잘 오는지" 검증용.
      console.log('[Feedback Recv]', {
        from: p?.senderName,
        sceneId: p?.sceneId,
        recipients: p?.recipients?.length,
        meId: me?.id ? me.id.slice(0, 8) : null,
        amIRecipient: !!(me?.id && p?.recipients?.includes(me.id)),
        amISender: me?.id === p?.senderId,
      });
      if (!p || !me?.id) return;
      if (!Array.isArray(p.recipients) || !p.recipients.includes(me.id)) return;
      if (p.senderId === me.id) return;

      const ds = useDataStore.getState();
      const epLabel = buildNotificationSceneDisplayLabel({
        episodeNumber: p.episodeNumber,
        sceneId: p.sceneId,
        episodeTitles: ds.episodeTitles,
        episodes: ds.episodes,
      });
      // v1.25.5: dispatchNotification 으로 sonner + 알림 store(인앱 누적·persist) 통합.
      //  OS 네이티브 토스트는 osNotification=false 로 차단하고 notifyFeedbackToast 별도 호출
      //  (Windows 토스트 click handler 의 씬 점프 기능 유지).
      //  코덱스 1차 P2 #3 fix: notificationIdsByRecipient 에서 자기 ID 의 row id 추출 →
      //   metadata.feedbackNotificationId 로 markRead 가능.
      const transitionLabel = `${p.fromState || ''} → ${p.toState}`;
      const myFeedbackNotificationId = p.notificationIdsByRecipient?.[me.id];
      const myFeedbackCreatedAt = p.notificationCreatedAtByRecipient?.[me.id];
      dispatchNotification({
        type: 'acting_feedback',
        title: `${p.senderName}님이 피드백을 요청했습니다`,
        body: `${epLabel} (${transitionLabel})`,
        metadata: {
          sceneId: p.sceneUuid,
          sceneName: p.sceneId,
          sheetName: p.sheetName,
          changedBy: p.senderName,
          feedbackTransition: transitionLabel,
          feedbackNotificationId: myFeedbackNotificationId,
        },
      }, { ...notiSettingsRef.current, osNotification: false });
      // Windows 네이티브 토스트 + 클릭 시 점프 (별도 흐름 — main 에서 sceneJump 처리)
      // 코덱스 3차 P2 fix: notificationId/kind 도 함께 전달 — feedback 토스트 클릭 후 read_at 처리.
      if (notiSettingsRef.current.osNotification !== false) {
        window.electronAPI.notifyFeedbackToast({
          title: 'B flow — 피드백 요청',
          body: `${p.senderName}님이 ${epLabel} 검수를 요청했습니다.`,
          sceneJump: {
            sheetName: p.sheetName,
            sceneId: p.sceneId,
            sceneUuid: p.sceneUuid,
            notificationId: myFeedbackNotificationId,
            kind: 'feedback',
          },
        }).catch(() => { /* 토스트 실패는 무시 */ });
      }
      // v1.25.5: broadcast 를 즉시 받았으므로 lastSeen 갱신 — 다음 로그인 catch-up 에서 중복 차단
      if (me?.id) setFeedbackLastSeenAt(me.id, myFeedbackCreatedAt ?? new Date().toISOString());
    });

    const offJump = window.electronAPI.onFeedbackJumpToScene?.((payload) => {
      markLocalFeedbackJumpAsRead(payload);
      navigateNotificationToScene(payload.kind === 'assignment' ? 'scene_assignment' : 'acting_feedback', {
        sceneId: payload.sceneUuid,
        sceneName: payload.sceneId,
        sheetName: payload.sheetName,
        feedbackNotificationId: payload.kind === 'feedback' ? payload.notificationId : undefined,
        assignmentNotificationId: payload.kind === 'assignment' ? payload.notificationId : undefined,
      });
    });

    return () => {
      offBroadcast?.();
      offJump?.();
    };
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
            if (isSceneAssignedToUser(scene, me.name)) {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.sceneChange !== false) {
                const stageLabel = stage === 'lo' ? 'LO' : stage === 'done' ? '완료' : stage === 'review' ? '검수' : stage === 'png' ? 'PNG' : stage;
                // v1.23.1 (#7): 누가 변경했는지 명시 — senderId 로 user 이름 조회.
                const senderName = useAuthStore.getState().users.find((u) => u.id === senderId)?.name ?? '다른 사용자';
                dispatchNotification({
                  type: 'scene_change',
                  title: `${senderName}님이 ${scene.sceneId || sceneUuid} ${stageLabel} ${value ? '✓ 완료' : '✗ 해제'}`,
                  body: `${stageLabel} 단계가 ${value ? '완료' : '해제'} 처리되었습니다`,
                  metadata: { sceneId: sceneUuid, sceneName: scene.sceneId, fromStage: stage, toStage: value ? 'on' : 'off', changedBy: senderName },
                }, notiSettings);
              }
            }
          }
          return;
        }
      }

      // v1.25.0~ 액팅 단계 토글 broadcast — sceneState/workRound/feedbackRound 한 번에
      // 코덱스 1차 P2 #3 fix: 다른 클라이언트가 즉시 반영해야 함 (Realtime 만 의존하면 폴링 지연).
      if (data.event === 'scene-phase-update') {
        const { sceneUuid, sceneState, workRound, feedbackRound, senderId } = data.payload as {
          sceneUuid: string;
          sceneState: 'wait' | 'work' | 'feedback' | 'done';
          workRound: number;
          feedbackRound: number;
          senderId?: string;
        };
        if (sceneUuid && sceneState) {
          useDataStore.getState().updateSceneByUuid(sceneUuid, {
            sceneState,
            workRound: workRound ?? 0,
            feedbackRound: feedbackRound ?? 0,
          });
          // 자기 자신이 보낸 변경은 알림 스킵 (이미 로컬 토스트 표시됨)
          const me = useAuthStore.getState().currentUser;
          if (me && senderId && senderId !== me.id) {
            const scene = useDataStore.getState().findSceneByUuid(sceneUuid);
            if (isSceneAssignedToUser(scene, me.name)) {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.sceneChange !== false) {
                const senderName = useAuthStore.getState().users.find((u) => u.id === senderId)?.name ?? '다른 사용자';
                const stateLabel = sceneState === 'wait' ? '대기'
                  : sceneState === 'work' ? `작업중 ${workRound}차`
                  : sceneState === 'feedback' ? `피드백 대기 ${feedbackRound}차`
                  : '완료';
                dispatchNotification({
                  type: 'scene_change',
                  title: `${senderName}님이 ${scene.sceneId || sceneUuid} → ${stateLabel}`,
                  body: `액팅 씬 단계가 ${stateLabel} 로 변경되었습니다`,
                  metadata: { sceneId: sceneUuid, sceneName: scene.sceneId, toStage: sceneState, changedBy: senderName },
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
            if (isSceneAssignedToUser(scene, me.name)) {
              const notiSettings = notiSettingsRef.current;
              if (notiSettings.sceneChange !== false) {
                // v1.23.1 (#7): 누가 변경했는지 명시.
                const senderName = useAuthStore.getState().users.find((u) => u.id === senderId)?.name ?? '다른 사용자';
                dispatchNotification({
                  type: 'scene_change',
                  title: `${senderName}님이 ${scene.sceneId || sceneUuid} 정보를 수정`,
                  body: `${field} 항목이 변경되었습니다`,
                  metadata: { sceneId: sceneUuid, sceneName: scene.sceneId, changedBy: senderName },
                }, notiSettings);
              }
            }
          }
          return;
        }
      }

      if (data.event === 'comment-added') {
        // 댓글 추가 broadcast → 알림 분기 평가 → 캐시 무효화
        // 코덱스 P1 fix (2026-05-10): invalidate 를 알림 분기 *후* 로 이동. 이전엔 cache miss 로
        //   isCommentByUser/hasUserCommentedOnScene 가 false 반환 → 답글/스레드 알림 누락.
        // v1.24.0 P0 #1: realtime INSERT 분기와 동일한 mention/comment 분기 적용.
        //   broadcast 페이로드에 commentId/parentCommentId/partId 가 포함되어 두 경로 어느 쪽이든 같은 분기 가능.
        const {
          sceneId: commentSceneNumber,  // sort_order text — findSceneBySceneId 매칭용
          userName: commentUserName,
          userId: commentUserId,
          text: commentText,
          mentions: commentMentions,
          commentId: commentCid,
          parentCommentId: commentParent,
          partId: commentPartId,
          revisionId: commentRevisionId,
        } = data.payload as {
          sceneId?: string;
          userName?: string;
          userId?: string;
          text?: string;
          mentions?: string[];
          commentId?: string | null;
          parentCommentId?: string | null;
          partId?: string | null;
          revisionId?: string | null;
        };
        const me = useAuthStore.getState().currentUser;
        // 캐릭터 댓글 broadcast(sceneId='char:{id}') 는 씬 알림 네비게이션이 없음 → 멘션/답글 알림 스킵, 캐시만 무효화.
        //   (캐릭터 현황판 상세에서 직접 확인. 씬 알림으로 잘못 흘러가 깨진 이동 링크가 뜨던 문제 차단.)
        if (typeof commentSceneNumber === 'string' && commentSceneNumber.startsWith('char:')) {
          invalidatePartCache();
          window.dispatchEvent(new Event('bflow:comments-invalidated'));
          return;
        }
        if (commentRevisionId) {
          dispatchRevisionCommentNotification({
            id: commentCid,
            scene_id: commentSceneNumber,
            part_id: commentPartId,
            user_name: commentUserName,
            user_id: commentUserId,
            text: commentText,
            mentions: commentMentions,
            revision_id: commentRevisionId,
          });
          invalidatePartCache();
          window.dispatchEvent(new Event('bflow:comments-invalidated'));
          return;
        }
        if (me && commentUserId && commentUserId !== me.id && commentSceneNumber) {
          const dedupeKey = `comment:${commentUserId}:${commentSceneNumber}:${commentCid ?? ''}`;
          if (!dedupeNotification(dedupeKey)) { /* 이미 Realtime으로 처리됨 */ }
          else if (notiSettingsRef.current.commentNotify === false) { /* 알림 끔 */ }
          else {
            const notiSettings = notiSettingsRef.current;
            // partId 있으면 정확 매칭, 없으면 fallback (alias collision 위험 있지만 단일 데이터인 경우 OK)
            let scene: ReturnType<typeof useDataStore.getState>['episodes'][number]['parts'][number]['scenes'][number] | null = null;
            if (commentPartId) {
              const targetNo = Number(commentSceneNumber);
              if (Number.isFinite(targetNo)) {
                for (const ep of useDataStore.getState().episodes) {
                  for (const part of ep.parts) {
                    if (part.id !== commentPartId) continue;
                    const found = part.scenes.find((s) => Number(s.no) === targetNo);
                    if (found) { scene = found; break; }
                  }
                  if (scene) break;
                }
              }
            }
            if (!scene) {
              scene = useDataStore.getState().findSceneBySceneId(commentSceneNumber!) ?? null;
            }

            const isMentioned = Array.isArray(commentMentions) && commentMentions.includes(me.name);
            const assigneeNames = scene ? parseAssigneeList(scene.assignee) : [];
            const isAssignee = assigneeNames.includes(me.name);
            const counterpartNames = scene ? collectCounterpartAssigneeNames(scene) : [];
            const isCounterpartAssignee = counterpartNames.includes(me.name);
            const isReplyToMe = commentParent ? isCommentByUser(commentParent, me.id) : false;
            const isThreadParticipant = scene
              ? hasUserCommentedOnScene(commentPartId ?? null, scene, me.id)
              : false;

            const baseMetadata: Record<string, unknown> = {
              sceneId: scene?.id,
              sceneName: scene?.sceneId,
              commentId: commentCid ?? undefined,
              commentSceneId: commentSceneNumber,
              commentPartId: commentPartId ?? undefined,
              ...(commentParent ? { parentCommentId: commentParent } : {}),
            };
            const bodyShort = commentText
              ? (commentText.length > 50 ? commentText.slice(0, 50) + '...' : commentText)
              : undefined;
            const author = commentUserName || '누군가';
            const sceneIdLabel = scene?.sceneId ? `${scene.sceneId} ` : '';

            if (isMentioned || isReplyToMe) {
              const title = isMentioned
                ? `${author}님이 나를 태그했습니다`
                : `${author}님이 내 댓글에 답글을 남겼습니다`;
              dispatchNotification({
                type: 'mention',
                title,
                body: bodyShort,
                metadata: { ...baseMetadata, mentionedBy: author },
              }, notiSettings);
            } else if (isAssignee || isCounterpartAssignee || isThreadParticipant) {
              const reason = isAssignee
                ? '내 씬에 댓글'
                : isCounterpartAssignee
                ? '함께 작업 중인 씬에 댓글'
                : '내가 댓글 단 씬에 새 댓글';
              dispatchNotification({
                type: 'comment',
                title: `${author}님이 ${sceneIdLabel}${reason}`,
                body: bodyShort,
                metadata: baseMetadata,
              }, notiSettings);
            }
          }
        }
        // 코덱스 P1 fix: 알림 분기 *후* 캐시 무효화 + 댓글 패널 리로드 신호.
        invalidatePartCache();
        window.dispatchEvent(new Event('bflow:comments-invalidated'));
        return;
      }

      if (data.event === 'data-change') {
        const changedTable = (data.payload as { table?: string } | undefined)?.table;
        if (changedTable === 'users') {
          // 권한/사용자 변경 → 사용자 목록 재로드 + 현재 세션 role 갱신(관리자 승격·강등을 재시작 없이 즉시 반영).
          loadUsers().then((freshUsers) => {
            setUsers(freshUsers);
            const me = useAuthStore.getState().currentUser;
            if (me) {
              const updated = freshUsers.find((u) => u.id === me.id);
              if (updated && updated.role !== me.role) {
                useAuthStore.getState().setCurrentUser({ ...me, role: updated.role });
              }
            }
          }).catch((e) => console.warn('[Broadcast] users 변경 재로드 실패:', e));
          return;
        }
        // 구조적 변경 (씬/파트/에피소드 추가/삭제) → 디바운스 full reload
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          console.log('[Broadcast] 구조 변경 감지 → reload');
          loadData();
        }, 300);
      }

      // 코덱스 2차 P1: 다른 클라이언트의 댓글 리액션 변경 → 변경된 commentId 만 자체 fetch.
      //   CommentPanel 이 window custom event 를 listen 해 reactionsByCommentId 갱신.
      if (data.event === 'comment-reaction-changed') {
        const { commentId, senderId } = data.payload as { commentId?: string; senderId?: string };
        const me = useAuthStore.getState().currentUser;
        // 본인 변경은 옵티미스틱으로 이미 반영됨 — 자기 broadcast 는 무시.
        if (commentId && (!me || senderId !== me.id)) {
          window.dispatchEvent(new CustomEvent('bflow:comment-reaction-changed', { detail: { commentId } }));
        }
      }

      // v1.29.0: 댓글 이모지 반응 알림 — 본인이 받은 경우만 store 반영.
      if (data.event === 'comment-reaction-notification') {
        const payload = data.payload as { notification?: {
          id: string; recipientId: string; actorId: string; actorName: string;
          commentId: string; emojis: string[]; reactionCount: number;
          sceneId?: string; partId?: string; episodeNumber?: number; dept?: string;
          lastActionAt: string; createdAt: string; readAt: string | null;
        } };
        const me = useAuthStore.getState().currentUser;
        const n = payload?.notification;
        if (n && me && n.recipientId === me.id && n.actorId !== me.id) {
          useNotificationStore.getState().upsertCommentReaction({
            id: n.id,
            type: 'comment_reaction',
            title: buildReactionNotificationTitle(n.actorName, n.emojis ?? []),
            metadata: {
              reactionNotificationId: n.id,
              reactionEmojis: n.emojis,
              reactionActorId: n.actorId,
              commentId: n.commentId,
              commentSceneId: n.sceneId,
              commentPartId: n.partId,
            },
            isRead: n.readAt !== null,
            createdAt: n.lastActionAt,
          });
          // 코덱스 2차 P1: 실시간으로 받은 알림은 lastSeen 갱신.
          // 코덱스 6차 P2: monotonic max() 로 out-of-order broadcast 의 cursor 후퇴 차단.
          // 코덱스 15차 P2: lastSeen 을 composite "<lastActionAt>|<id>" 로 저장 → 같은 ts 행이
          //   catch-up 의 gt() 필터에서 영구 제외되던 data loss 차단.
          const prevLastSeen = getCommentReactionLastSeenAt(me.id);
          const prevAt = prevLastSeen?.split('|')[0] ?? '';
          const nextLastSeen = n.lastActionAt > prevAt
            ? `${n.lastActionAt}|${n.id}`
            : (prevLastSeen ?? `${n.lastActionAt}|${n.id}`);
          setCommentReactionLastSeenAt(me.id, nextLastSeen);
        }
      }

      // v1.29.0: 댓글 이모지 반응 알림 축소/삭제.
      if (data.event === 'comment-reaction-notification-removed') {
        const payload = data.payload as {
          recipientId?: string; notificationId?: string; deleted?: boolean;
          emoji?: string; commentId?: string; actorId?: string;
        };
        const me = useAuthStore.getState().currentUser;
        if (payload?.recipientId && me && payload.recipientId === me.id && payload.notificationId) {
          if (payload.deleted) {
            useNotificationStore.getState().removeNotificationById(payload.notificationId);
          } else {
            // 축소 — 단일 행 refetch 로 emojis 배열 정합화
            void (async () => {
              try {
                const { fetchCommentReactionNotifications } = await import('@/services/supabaseService');
                const res = await fetchCommentReactionNotifications({
                  recipientId: me.id,
                  ids: [payload.notificationId!],
                  limit: 1,
                });
                const row = res?.data?.[0];
                if (row) {
                  // 코덱스 5차 P1: refetch 결과의 isRead 가 로컬 읽음 상태를 덮어쓰지 않게 보존.
                  //   "모두 읽음" 직후 다른 PC 가 이모지 제거 → refetch row.isRead=false 일 수 있고
                  //   그대로 upsert 하면 사용자가 방금 읽은 알림이 다시 unread 로 뒤집힘. 로컬에서 한 번이라도
                  //   읽음 처리됐으면(true) 유지, 아직 안 읽었으면 서버 값 사용.
                  const cur = useNotificationStore.getState().notifications.find((x) => x.id === row.id);
                  const preservedRead = cur?.isRead === true ? true : row.isRead;
                  useNotificationStore.getState().upsertCommentReaction({
                    ...row,
                    isRead: preservedRead,
                  } as AppNotification);
                } else {
                  // race: 이미 사라진 행 → store 에서도 제거
                  useNotificationStore.getState().removeNotificationById(payload.notificationId!);
                }
              } catch (err) {
                console.warn('[reaction-removed] refetch 실패:', err);
              }
            })();
          }
        }
      }

      // v1.29.0: 활동 로그 단일 행 삭제 (이모지 반응 취소 시).
      if (data.event === 'activity-removed') {
        const payload = data.payload as { activityId?: string };
        if (payload?.activityId) {
          useActivityStore.getState().removeById(payload.activityId);
        }
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
        .then((prefs) => {
          if (!prefs) return;
          applyPreferencesToDOM(prefs);
          useAppStore.getState().setCompletionTintEnabled(prefs.sceneUi?.completionTintEnabled ?? true);
        })
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

  useEffect(() => installEditableFocusRecovery(), []);

  // v1.27.0: 업데이트 완료 토스트 — splash 닫힌 뒤 (= Toaster mount 된 뒤) 한 번만 표시.
  // splash 동안 호출하면 Toaster 가 아직 없어 안 보이지만 lastSeenVersion 은 갱신되어
  // 다음 실행 시에도 영원히 안 뜨는 문제가 있었음 (한솔 v1.27.0 1차 보고).
  const updateToastShownRef = useRef(false);
  useEffect(() => {
    if (showSplash || updateToastShownRef.current) return;
    updateToastShownRef.current = true; // 같은 세션에서 두 번 안 뜨도록 즉시 마킹
    let cancelled = false;
    (async () => {
      const prefs = (await loadPreferences()) ?? {};
      if (cancelled) return;
      const prev = prefs.lastSeenVersion;
      if (prev && semverGt(__APP_VERSION__, prev)) {
        sonnerToast.success(`v${__APP_VERSION__} 으로 업데이트되었어요`, {
          duration: 8000,
          action: {
            label: '업데이트 내역 보기',
            onClick: () => useAppStore.getState().setUpdateCenterOpen(true),
          },
        });
      }
      // 토스트 표시 여부와 무관하게 lastSeenVersion 갱신 — 다음 업데이트까지 1회 보장.
      if (prev !== __APP_VERSION__) {
        await savePreferences({ ...prefs, lastSeenVersion: __APP_VERSION__ });
      }
    })();
    return () => { cancelled = true; };
  }, [showSplash]);

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
      const app = useAppStore.getState();
      app.pushNavigationBackTarget();
      app.setView('scenes');
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
          return <CompositingDashboardView />;
        case 'compositing-revisions':
          return <CompositingView />;
        case 'retake-hub':
          return <RetakeHubView />;
        case 'character-board':
          return hasCharacterBoardAccess ? <CharacterBoardView /> : <Dashboard />;
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
      <UpdateCenterModal />

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
