import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { X, Droplets, Eye, Pin, PinOff, Minus, BarChart3 } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useEditingPresenceStore } from '@/stores/useEditingPresenceStore';
import { OverallProgressWidget } from '@/components/widgets/OverallProgressWidget';
import { StageBarsWidget } from '@/components/widgets/StageBarsWidget';
import { AssigneeCardsWidget } from '@/components/widgets/AssigneeCardsWidget';
import { EpisodeSummaryWidget } from '@/components/widgets/EpisodeSummaryWidget';
import { DepartmentComparisonWidget } from '@/components/widgets/DepartmentComparisonWidget';
import { CalendarWidget } from '@/components/widgets/CalendarWidget';
import { MyTasksWidget } from '@/components/widgets/MyTasksWidget';
import { MemoWidget } from '@/components/widgets/MemoWidget';
import { RecentActivityWidget } from '@/components/widgets/RecentActivityWidget';
import { VacationWidget } from '@/components/widgets/VacationWidget';
import { WhiteboardWidget } from '@/components/widgets/whiteboard/WhiteboardWidget';
import { EpOverallProgressWidget } from '@/components/widgets/episode/EpOverallProgressWidget';
import { EpStageBarsWidget } from '@/components/widgets/episode/EpStageBarsWidget';
import { EpAssigneeCardsWidget } from '@/components/widgets/episode/EpAssigneeCardsWidget';
import { EpPartProgressWidget } from '@/components/widgets/episode/EpPartProgressWidget';
import { EpDeptComparisonWidget } from '@/components/widgets/episode/EpDeptComparisonWidget';
import { EpFullDeptProgressWidget } from '@/components/widgets/episode/EpFullDeptProgressWidget';
import { EpSinglePartWidget } from '@/components/widgets/episode/EpSinglePartWidget';
import { WidgetIdContext, IsPopupContext } from '@/components/widgets/Widget';
import { GradientBackdrop } from '@/components/common/GradientBackdrop';
import { loadPreferences, loadTheme } from '@/services/settingsService';
import {
  applyCommittedGoogleDelete,
  applyCommittedPrivacyReplacementDelete,
  loadBflowEvents,
} from '@/services/calendarService';
import {
  fetchFreshUsersFromSupabase,
  loadSession,
  loadUsers,
  setUsersSheetsMode,
} from '@/services/userService';
import { reconcileAuthoritativeUserDirectory } from '@/services/authoritativeUserSession';
import { applyPreferencesToDOM } from '@/utils/typography';
import { readAll, checkConnection, readMetadata } from '@/services/supabaseService';
import { connectGas, loadGasConfig } from '@/services/gasConfigService';
import { invalidatePartCache } from '@/services/commentService';
import { extractSceneDelta } from '@/utils/realtimeDelta';
import { loadVacationConfig, connectVacation } from '@/services/vacationService';
import { useVacationPendingStore } from '@/stores/useVacationPendingStore';
import { Toaster, toast as sonnerToast } from 'sonner';
import type { Episode, AppUser, PresenceSnapshotBundle } from '@/types';
import { getPreset, getLightColors, applyTheme, type ThemeColors } from '@/themes';
import { DEFAULT_GAS_IMAGE_URL } from '@/config';

// 모듈 레벨 쿨다운: dataNotifyChange 호출 시 자체 변경 감지
let _reloadCooldown = false;
const _COOLDOWN_MS = 3000;

/** 팝업 위젯에서 데이터 변경 알림 시 이 래퍼를 사용 (쿨다운 자동 적용) */
export function notifyDataChangeWithCooldown() {
  _reloadCooldown = true;
  setTimeout(() => { _reloadCooldown = false; }, _COOLDOWN_MS);
  return window.electronAPI?.dataNotifyChange?.();
}

const POPUP_SHARED_BFLOW_CALENDAR_TABLES = new Set([
  'calendars',
  'calendar_members',
  'calendar_events',
  'calendar_tags',
]);
const POPUP_SHARED_BFLOW_CALENDAR_ACTIONS = new Set(['INSERT', 'UPDATE', 'DELETE']);

function popupSharedBflowCalendarChangeDetail(raw: unknown): unknown | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { event?: unknown; payload?: unknown; table?: unknown; action?: unknown };
  if (value.event === 'local-calendar-changed') {
    return value.payload ?? { action: 'local-refresh' };
  }
  if (
    typeof value.table === 'string'
    && POPUP_SHARED_BFLOW_CALENDAR_TABLES.has(value.table)
  ) return raw;
  if (value.event === 'data-change' && value.payload && typeof value.payload === 'object') {
    const payload = value.payload as { table?: unknown };
    if (
      typeof payload.table === 'string'
      && POPUP_SHARED_BFLOW_CALENDAR_TABLES.has(payload.table)
    ) return value.payload;
  }
  const detail = value.event === 'calendar-changed' ? value.payload : raw;
  if (!detail || typeof detail !== 'object') return null;
  const action = (detail as { action?: unknown }).action;
  return typeof action === 'string' && POPUP_SHARED_BFLOW_CALENDAR_ACTIONS.has(action)
    ? detail
    : null;
}

let popupSharedCalendarRefreshFlight: Promise<void> | null = null;
let popupSharedCalendarRefreshPhase: 'idle' | 'scheduled' | 'loading' = 'idle';
let popupSharedCalendarRefreshAgain = false;
let popupSharedCalendarRefreshDetail: unknown = null;

async function enqueuePopupSharedCalendarRefresh(detail: unknown): Promise<void> {
  popupSharedCalendarRefreshDetail = detail;
  if (popupSharedCalendarRefreshFlight) {
    if (popupSharedCalendarRefreshPhase === 'loading') popupSharedCalendarRefreshAgain = true;
    return popupSharedCalendarRefreshFlight;
  }

  const run = async () => {
    popupSharedCalendarRefreshPhase = 'scheduled';
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (true) {
      popupSharedCalendarRefreshPhase = 'loading';
      popupSharedCalendarRefreshAgain = false;
      const refreshDetail = popupSharedCalendarRefreshDetail;
      try {
        await loadBflowEvents({ broadcast: false });
      } catch (error) {
        console.warn('[Calendar] 팝업 공유 캘린더 정본 재조회 실패:', error);
      }
      if (popupSharedCalendarRefreshAgain) {
        popupSharedCalendarRefreshPhase = 'scheduled';
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }
      window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail: refreshDetail }));
      return;
    }
  };

  const ownedFlight = run().finally(() => {
    if (popupSharedCalendarRefreshFlight === ownedFlight) {
      popupSharedCalendarRefreshFlight = null;
      popupSharedCalendarRefreshPhase = 'idle';
      popupSharedCalendarRefreshAgain = false;
    }
  });
  popupSharedCalendarRefreshFlight = ownedFlight;
  return ownedFlight;
}

/** 팝업의 독립 cache도 일반 공유 캘린더 신호 뒤 정본을 먼저 읽고 UI를 갱신한다. */
export async function applyIncomingSharedBflowCalendarChangeInPopup(raw: unknown): Promise<boolean> {
  const detail = popupSharedBflowCalendarChangeDetail(raw);
  if (!detail) return false;
  await enqueuePopupSharedCalendarRefresh(detail);
  return true;
}

/** 메인/다른 위젯에서 온 calendar-changed를 이 팝업의 독립 cache에 먼저 반영한다.
 *  일반 공유 캘린더 신호는 정본을 재조회하고, privacy migration 영속 삭제 marker는
 *  재조회보다 먼저 exact tombstone 처리해 오래된 snapshot의 ghost 복원을 막는다. */
export async function applyIncomingCalendarChangeInPopup(payload: unknown): Promise<void> {
  const sharedPayload = payload == null
    ? { event: 'local-calendar-changed', payload }
    : payload;
  if (await applyIncomingSharedBflowCalendarChangeInPopup(sharedPayload)) return;
  try {
    applyCommittedGoogleDelete(payload) || applyCommittedPrivacyReplacementDelete(payload);
  } catch (error) {
    console.warn('[Calendar] 팝업 확정 삭제 반영 실패:', error);
  }
  window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail: payload }));
}

/** main이 전달한 Supabase 공유 변경과 exact marker를 popup cache 경로로 연결한다. */
export async function applyIncomingSupabaseCalendarChangeInPopup(raw: unknown): Promise<boolean> {
  if (await applyIncomingSharedBflowCalendarChangeInPopup(raw)) return true;
  if (!raw || typeof raw !== 'object') return false;
  const data = raw as { event?: unknown; payload?: unknown };
  if (data.event !== 'calendar-changed') return false;
  await applyIncomingCalendarChangeInPopup(data.payload);
  return true;
}

export async function reconcilePopupUserDirectory(): Promise<'unchanged' | 'updated' | 'deleted'> {
  const freshUsers = await fetchFreshUsersFromSupabase();
  return reconcileAuthoritativeUserDirectory(freshUsers, {
    getCurrentUser: () => useAuthStore.getState().currentUser,
    setUsers: (users) => useAuthStore.getState().setUsers(users),
    setCurrentUser: (user) => {
      useAuthStore.getState().setCurrentUser(user);
      if (!user) {
        // calendarService의 사용자 소유 cache는 auth store 구독에서 같은 call stack에
        // 비워진다. 그 직후 팝업 위젯의 별도 events state도 재조회해 private 일정이
        // canonical logout 완료를 기다리는 동안 화면에 남지 않게 한다.
        window.dispatchEvent(new CustomEvent('bflow:calendar-changed', {
          detail: {
            action: 'session-cleared',
            reason: 'authoritative-user-deleted',
          },
        }));
      }
    },
    logoutCanonicalSession: () => window.electronAPI.logoutCanonicalSession(),
    onLogoutFailure: (error) => {
      console.warn('[WidgetPopup] 삭제 사용자 canonical session 종료 실패:', error);
    },
  });
}

// 현황판은 App.tsx 와 동일하게 lazy — 팝업 엔트리 청크를 무겁게 하지 않는다 (피드백 36).
const CharacterBoardView = lazy(() => import('@/views/CharacterBoardView'));

/**
 * 캐릭터 현황판 팝업 본문 (피드백 36) — lazy 로딩 래퍼.
 * 현황판은 전면 공개(정식 릴리즈)라 사용자별 접근 게이트는 없다. 다만 세션 확인은 남긴다:
 * 폐기된 게이트가 로그인 없는 상태에서 fail-closed 로 막아 주던 역할을 대신한다 — 팝업이 열린 채
 * 로그아웃하거나 미인증 상태로 자동 복원되면 공유 PC 에 캐릭터 데이터와 편집 컨트롤이 남는다.
 */
function CharacterBoardPopupBody() {
  const currentUser = useAuthStore((s) => s.currentUser);
  if (!currentUser) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-secondary">
        로그인한 뒤에 캐릭터 현황판을 볼 수 있어요.
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-text-secondary/50">불러오는 중...</div>}>
      <CharacterBoardView />
    </Suspense>
  );
}

const WIDGET_REGISTRY: Record<string, { label: string; component: React.ReactNode }> = {
  'overall-progress': { label: '전체 진행률', component: <OverallProgressWidget /> },
  'stage-bars': { label: '단계별 진행률', component: <StageBarsWidget /> },
  'assignee-cards': { label: '담당자별 현황', component: <AssigneeCardsWidget /> },
  'episode-summary': { label: '에피소드 요약', component: <EpisodeSummaryWidget /> },
  'dept-comparison': { label: '부서별 비교', component: <DepartmentComparisonWidget /> },
  'calendar': { label: '캘린더', component: <CalendarWidget /> },
  'my-tasks': { label: '내 할일', component: <MyTasksWidget /> },
  'vacation-today': { label: '휴가자 현황', component: <VacationWidget /> },
  'memo': { label: '메모', component: <MemoWidget /> },
  'whiteboard': { label: '화이트보드', component: <WhiteboardWidget /> },
  'recent-activity': { label: '최근 작업', component: <RecentActivityWidget /> },
  'ep-overall-progress': { label: 'EP 통합 진행률', component: <EpOverallProgressWidget /> },
  'ep-stage-bars': { label: 'EP 단계별 진행률', component: <EpStageBarsWidget /> },
  'ep-assignee-cards': { label: 'EP 담당자별 현황', component: <EpAssigneeCardsWidget /> },
  'ep-part-progress': { label: 'EP 파트별 진행률', component: <EpPartProgressWidget /> },
  'ep-dept-comparison': { label: 'EP 부서별 비교', component: <EpDeptComparisonWidget /> },
  'ep-full-bg-progress': { label: 'EP 전체 BG 진행률', component: <EpFullDeptProgressWidget dept="bg" /> },
  'ep-full-act-progress': { label: 'EP 전체 ACT 진행률', component: <EpFullDeptProgressWidget dept="acting" /> },
  'character-board': { label: '캐릭터 현황판', component: <CharacterBoardPopupBody /> },
};

/**
 * 위젯 팝업 윈도우 전용 렌더러
 * Windows Acrylic 네이티브 블러 + CSS 글래스 틴트 + AOT 핀 + 독 모드
 */
/**
 * preferences.plexus → useAppStore.setPlexusSettings 병합 헬퍼.
 * App.tsx의 동일 로직과 일치시켜 "전체 화면 그라데이션" 토글이 팝업에도 반영되도록 함.
 */
function applyPlexusFromPrefs(prefs: Awaited<ReturnType<typeof loadPreferences>> | null): void {
  if (!prefs?.plexus) return;
  const p = prefs.plexus;
  useAppStore.getState().setPlexusSettings({
    ...(p.loginEnabled !== undefined ? { loginEnabled: p.loginEnabled } : {}),
    ...(p.loginGradientEnabled !== undefined ? { loginGradientEnabled: p.loginGradientEnabled } : {}),
    ...(p.dashboardEnabled !== undefined ? { dashboardEnabled: p.dashboardEnabled } : {}),
    ...(p.dashboardGradientEnabled !== undefined ? { dashboardGradientEnabled: p.dashboardGradientEnabled } : {}),
    globalGradientEnabled: p.globalGradientEnabled ?? true,
  });
}

export function WidgetPopup({ widgetId, extraParams }: { widgetId: string; extraParams?: Record<string, string> }) {
  // 전역 그라데이션 배경 토글 (설정의 "전체 화면 그라데이션"이 플로팅 위젯에도 반영되도록)
  const globalGradientEnabled = useAppStore((s) => s.plexusSettings.globalGradientEnabled !== false);
  const colorMode = useAppStore((s) => s.colorMode);

  const [appOpacity, setAppOpacity] = useState(1);
  const [glassIntensity, setGlassIntensity] = useState(0.7);
  const [showControls, setShowControls] = useState(false);
  const [showBottomControls, setShowBottomControls] = useState(false);
  const [ready, setReady] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // showHandle은 제거됨 — 타이틀 바가 항상 표시되므로 불필요

  // AOT (Always On Top) — 기본: 켜짐
  const [isAOT, setIsAOT] = useState(true);

  // 독 모드 (최소화 → 플로팅 아이콘)
  const [isDocked, setIsDocked] = useState(false);
  const [isDockHover, setIsDockHover] = useState(false);
  const dockHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 모핑 전환 상태: 'idle' | 'minimizing' | 'restoring'
  const [morphState, setMorphState] = useState<'idle' | 'minimizing' | 'restoring'>('idle');

  // 마우스 위치 추적 → 하단 슬라이더 영역 호버 감지
  // (상단 컨트롤은 타이틀 바의 mouseenter/mouseleave로 처리)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 하단 우측 슬라이더 영역 (아래 48px, 오른쪽 60%)
    const inBottomZone = y > rect.height - 48 && x > rect.width * 0.4;
    if (inBottomZone) {
      if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
      setShowBottomControls(true);
    } else if (!inBottomZone && showBottomControls) {
      if (!bottomHideTimerRef.current) {
        bottomHideTimerRef.current = setTimeout(() => {
          setShowBottomControls(false);
          bottomHideTimerRef.current = null;
        }, 400);
      }
    }
  }, [showBottomControls]);

  const handleMouseLeave = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
    setShowControls(false);
    setShowBottomControls(false);
  }, []);

  // 윈도우 바깥에서 진입 시에도 하단 슬라이더 호버 감지
  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y > rect.height - 48 && x > rect.width * 0.4) setShowBottomControls(true);
  }, []);

  // 포커스 변경 감지 (Acrylic 회색 fallback 대응)
  useEffect(() => {
    const cleanup = window.electronAPI?.onWidgetFocusChange?.((focused) => {
      setIsFocused(focused);
    });
    return () => { cleanup?.(); };
  }, []);

  // 독 모드 변경 감지 (네이티브 최소화 인터셉트 포함)
  useEffect(() => {
    const cleanup = window.electronAPI?.onWidgetDockChange?.((docked) => {
      setIsDocked(docked);
      if (!docked) setIsDockHover(false);
    });
    return () => { cleanup?.(); };
  }, []);

  // 환경설정(글꼴 크기/색상 + 플렉서스) 변경 브로드캐스트 구독 — 메인 창에서 저장되면 즉시 재적용
  // plexus(globalGradientEnabled 등)는 현재 EffectsSection이 broadcast하지 않지만, 향후 추가 시
  // WidgetPopup도 자동 반영되도록 미리 재적용 경로 포함.
  useEffect(() => {
    const cleanup = window.electronAPI?.onPreferencesChanged?.(() => {
      loadPreferences()
        .then((prefs) => {
          if (prefs) {
            applyPreferencesToDOM(prefs);
            applyPlexusFromPrefs(prefs);
          }
        })
        .catch((err) => console.warn('[설정] 브로드캐스트 재적용 실패', err));
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── 휴가 pending hydrate (팝업에서도 필요) — 30초 타임아웃은 메인 창 전용 ───
  useEffect(() => {
    useVacationPendingStore.getState().hydrate();
  }, []);

  // ─── 휴가 등록 완료 브로드캐스트 구독 → Sonner 토스트 ─────
  // hydrate() 재호출: 메인 창이 pending을 제거했을 수 있으므로 디스크에서 최신 목록 재로드
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationRegistered?.((payload) => {
      const p = payload as { name?: string; type?: string } | undefined;
      const who = p?.name ? `${p.name} ` : '';
      const what = p?.type ? ` (${p.type})` : '';
      sonnerToast.success(`${who}휴가 등록 완료${what}`);
      useVacationPendingStore.getState().hydrate();
    });
    return () => { cleanup?.(); };
  }, []);

  // ─── 휴가 등록 실패 브로드캐스트 구독 ─────────────
  // hydrate() 재호출: 실패 시에도 메인 창이 pending을 제거했을 수 있음
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationFailed?.((payload) => {
      const p = payload as { name?: string; error?: string } | undefined;
      const who = p?.name ? `${p.name} ` : '';
      const err = p?.error ?? '알 수 없는 오류';
      sonnerToast.error(`${who}휴가 등록 실패: ${err}`, { duration: 10000 });
      useVacationPendingStore.getState().hydrate();
    });
    return () => { cleanup?.(); };
  }, []);

  // pending 변경 브로드캐스트 구독 → hydrate (다른 창에서 add/remove/clearStale 시 동기화)
  // 송신자는 메인에서 excludeSenderId로 제외 (자기 상태 덮어쓰기 방지)
  useEffect(() => {
    const cleanup = window.electronAPI?.onVacationPendingChanged?.(() => {
      useVacationPendingStore.getState().hydrate();
    });
    return () => { cleanup?.(); };
  }, []);

  // 세션 변경 브로드캐스트 구독 — 메인 창 로그인/로그아웃 시 currentUser 즉시 동기화
  useEffect(() => {
    const cleanup = window.electronAPI?.onSessionChanged?.((payload) => {
      const { user } = (payload as { user: AppUser | null }) ?? {};
      useAuthStore.getState().setCurrentUser(user ?? null);
    });
    // 구독 등록 직후 메인에 현재 세션 재전송 요청 — ready-to-show 타이밍 miss 방어 (이중 안전망)
    window.electronAPI?.sessionRequestCurrent?.();
    return () => { cleanup?.(); };
  }, []);

  // 실시간 편집 프레즌스 구독 — 팝업 렌더러는 별도 프로세스라 App.tsx 배선이 적용되지 않는다 (피드백 54).
  // 캐릭터 현황판 팝업의 카드/행/모달이 프레즌스를 소비하므로, 스냅샷 push + 마운트 시 replay 를 배선한다.
  useEffect(() => {
    let liveEventSeen = false;
    const off = window.electronAPI?.onSupabasePresence?.((snap) => {
      liveEventSeen = true;
      useEditingPresenceStore.getState().applyPresenceSnapshot(snap as PresenceSnapshotBundle);
    });
    window.electronAPI?.getPresenceSnapshot?.().then((snap) => {
      if (!liveEventSeen) {
        useEditingPresenceStore.getState().applyPresenceSnapshot(snap as PresenceSnapshotBundle | null | undefined);
      }
    }).catch(() => { /* ignore */ });
    return () => { off?.(); };
  }, []);

  // 테마 변경 브로드캐스트 구독 — 메인 창에서 테마 바뀌면 즉시 재적용
  // payload를 직접 적용 (파일 재로드 X) — saveTheme 완료 전 broadcast 수신 시 stale 파일 읽는 race 방지
  useEffect(() => {
    const cleanup = window.electronAPI?.onThemeChanged?.((payload) => {
      try {
        const data = payload as {
          themeId?: string;
          colorMode?: 'dark' | 'light';
          customColors?: ThemeColors | null;
        } | null;
        if (!data) return;
        const nextThemeId = data.themeId;
        const nextMode = data.colorMode ?? 'dark';
        const nextCustom = data.customColors ?? null;
        if (!nextThemeId) return;

        useAppStore.getState().setThemeId(nextThemeId);
        useAppStore.getState().setColorMode(nextMode);
        useAppStore.getState().setCustomThemeColors(nextCustom);

        const colors = nextCustom
          ?? (nextMode === 'light' ? getLightColors(nextThemeId) : getPreset(nextThemeId)?.colors);
        if (colors) applyTheme(colors, nextMode);
      } catch (err) {
        console.warn('[theme] broadcast 적용 실패:', err);
      }
    });
    return () => { cleanup?.(); };
  }, []);

  // 캘린더 변경 IPC 브로드캐스트 구독 — 다른 창(메인/다른 위젯)에서 변경되면 window event 재발행
  // 무한 루프 방지: 송신자 제외는 메인 프로세스에서 처리됨
  useEffect(() => {
    const cleanup = window.electronAPI?.onCalendarChanged?.((payload) => {
      void applyIncomingCalendarChangeInPopup(payload);
    });
    return () => { cleanup?.(); };
  }, []);

  // 저장된 opacity/AOT 복원 (Phase 0-6)
  useEffect(() => {
    window.electronAPI?.widgetGetSavedState?.(widgetId).then((saved) => {
      if (saved) {
        setAppOpacity(saved.opacity);
        setIsAOT(saved.alwaysOnTop);
        // BrowserWindow에도 실제 투명도 적용
        window.electronAPI?.widgetSetOpacity?.(widgetId, saved.opacity);
      }
    });
  }, [widgetId]);

  // 실시간 데이터 동기화: 델타 기반 부분 업데이트 + 120초 emergency fallback
  useEffect(() => {
    if (!ready) return;

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadData = async () => {
      try {
        const api = window.electronAPI;
        if (!api) return;

        const connected = await checkConnection();
        if (connected) {
          setUsersSheetsMode(true); // 피드백 45: 재연결 후에도 아래 loadUsers() 가 원격 목록을 읽도록.
          const episodes = await readAll();
          useDataStore.getState().setEpisodes(episodes);
          // 메타데이터 일괄 로딩 (Supabase)
          try {
            const { readAllMetadataFromSupabase } = await import('@/services/supabaseService');
            const metaList = (await readAllMetadataFromSupabase()) as { type: string; key: string; value: string }[];
            const titles: Record<number, string> = {};
            const memos: Record<number, string> = {};
            for (const m of metaList) {
              if (m.type === 'episode-title' && m.value) titles[Number(m.key)] = m.value;
              if (m.type === 'episode-memo' && m.value) memos[Number(m.key)] = m.value;
            }
            useDataStore.getState().setEpisodeTitles(titles);
            useDataStore.getState().setEpisodeMemos(memos);
          } catch { /* 메타데이터 로딩 실패는 무시 */ }
        } else {
          // 재연결 시도
          const cfg = await loadGasConfig();
          const urlToConnect = cfg?.webAppUrl || DEFAULT_GAS_IMAGE_URL;
          if (urlToConnect) {
            const result = await connectGas(urlToConnect);
            if (result.ok) {
              setUsersSheetsMode(true); // 피드백 45: GAS 폴백 재연결 성공 시에도 동일.
              const episodes = await readAll();
              useDataStore.getState().setEpisodes(episodes);
            }
          }
        }

        const users = await loadUsers();
        useAuthStore.getState().setUsers(users);
      } catch (err) {
        console.error('[WidgetPopup] 동기화 실패:', err);
      }
    };

    // onSheetChanged 리스너 삭제됨 — Supabase Realtime이 대체 (M-3)

    // 스냅샷 릴레이 수신 — 다른 창에서 보낸 전체 데이터 직접 적용
    const cleanupSnapshot = window.electronAPI?.onSnapshotRelay?.((data: unknown) => {
      const d = data as import('@/types').SnapshotRelayData;
      if (d?.episodes) useDataStore.getState().setEpisodes(d.episodes);
      if (d?.episodeTitles) useDataStore.getState().setEpisodeTitles(d.episodeTitles);
      if (d?.episodeMemos) useDataStore.getState().setEpisodeMemos(d.episodeMemos);
    });

    // Emergency fallback: 120초마다 full reload (delta/relay 누락 방지)
    const emergencyPoll = setInterval(() => {
      if (!_reloadCooldown) reloadData();
    }, 120_000);

    // Supabase Realtime: DB 변경 감지 → delta 직접 적용 또는 full reload
    const cleanupRealtime = window.electronAPI?.onSupabaseRealtime?.((event: unknown) => {
      const { table, payload } = event as import('@/services/supabaseService').SupabaseRealtimeEvent;

      if (popupSharedBflowCalendarChangeDetail(event)) {
        void applyIncomingSharedBflowCalendarChangeInPopup(event);
        return;
      }

      if (table === 'users') {
        void reconcilePopupUserDirectory()
          .then((result) => { if (result !== 'deleted') reloadData(); })
          .catch((error) => console.warn('[WidgetPopup] users 변경 재로드 실패:', error));
        return;
      }

      if (table === 'comments') {
        invalidatePartCache();
        return;
      }

      if (table === 'scenes' && payload?.eventType === 'UPDATE' && payload?.new) {
        const delta = extractSceneDelta(payload.new);
        if (delta) {
          const applied = useDataStore.getState().updateSceneByUuid(delta.uuid, delta.fields);
          if (applied) return;
        }
      }

      if (table === 'comp_revisions') {
        window.dispatchEvent(new Event('bflow:revisions-invalidated'));
        return;
      }

      if (table === 'comp_revision_sets') {
        window.dispatchEvent(new Event('bflow:revision-sets-invalidated'));
        return;
      }

      // 그 외 → 디바운스 full reload
      if (_reloadCooldown) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { reloadData(); }, _COOLDOWN_MS + 500);
        return;
      }
      reloadData();
    });

    // Supabase Broadcast: 즉시 동기화 (Publication 설정 불필요)
    const cleanupBroadcast = window.electronAPI?.onSupabaseBroadcast?.((raw: unknown) => {
      const data = raw as { event: string; payload: Record<string, unknown> };
      if (!data?.event) return;

      if (popupSharedBflowCalendarChangeDetail(raw)) {
        void applyIncomingSharedBflowCalendarChangeInPopup(raw);
        return;
      }

      if (data.event === 'scene-update') {
        const { sceneUuid, stage, value } = data.payload as { sceneUuid: string; stage: string; value: boolean };
        if (sceneUuid && stage != null && value != null) {
          useDataStore.getState().updateSceneByUuid(sceneUuid, { [stage]: value });
          return;
        }
      }
      if (data.event === 'scene-field-update') {
        const { sceneUuid, field, value } = data.payload as { sceneUuid: string; field: string; value: string | null };
        if (sceneUuid && field) {
          // v1.16.0: lengthChange 안전망 (송신부에서 normalize 하지만 이중 보호)
          const normalized = (field === 'lengthChange' && value === '') ? null : value;
          useDataStore.getState().updateSceneByUuid(sceneUuid, { [field]: normalized });
          return;
        }
      }
      if (data.event === 'calendar-changed') {
        // 일반 공유 변경은 위 정본 재조회 분기에서 처리된다. 이 잔여 경로는 다른 앱
        // 인스턴스에서 persistence가 끝난 exact delete marker를 즉시 tombstone한다.
        void applyIncomingSupabaseCalendarChangeInPopup(raw);
        return;
      }
      if (data.event === 'data-change') {
        const table = data.payload?.table;
        if (table === 'users') {
          void reconcilePopupUserDirectory()
            .then((result) => { if (result !== 'deleted') reloadData(); })
            .catch((error) => console.warn('[WidgetPopup] users 변경 재로드 실패:', error));
        } else {
          reloadData();
        }
      }
    });

    return () => {
      cleanupSnapshot?.();
      cleanupRealtime?.();
      cleanupBroadcast?.();
      clearInterval(emergencyPoll);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [ready]);

  // 테마 + 데이터 초기화
  useEffect(() => {
    // Acrylic 모드: HTML/Body를 투명하게 하여 네이티브 블러가 보이도록
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    (async () => {
      try {
        const saved = await loadTheme();
        if (saved) {
          const savedMode = saved.colorMode ?? 'dark';
          useAppStore.getState().setThemeId(saved.themeId);
          useAppStore.getState().setColorMode(savedMode);
          if (saved.customColors) useAppStore.getState().setCustomThemeColors(saved.customColors);
          let colors = saved.customColors ?? (savedMode === 'light' ? getLightColors(saved.themeId) : getPreset(saved.themeId)?.colors);
          if (colors) applyTheme(colors, savedMode);
        }

        // 글꼴 크기/색상 + 플렉서스 설정 적용 (FOUC 방지: 초기 렌더 전에 CSS 변수 세팅)
        const prefs = await loadPreferences();
        if (prefs) {
          applyPreferencesToDOM(prefs);
          applyPlexusFromPrefs(prefs);
        }

        const api = window.electronAPI;
        if (!api) { setReady(true); return; }

        useAppStore.getState().setDashboardDeptFilter('all');

        // 에피소드 위젯 팝업: URL 파라미터에서 에피소드 번호 복원
        if (extraParams?.ep) {
          const epNum = parseInt(extraParams.ep, 10);
          if (!isNaN(epNum)) useAppStore.getState().setEpisodeDashboardEp(epNum);
        }

        let connected = await checkConnection();
        if (!connected) {
          const cfg = await loadGasConfig();
          const urlToConnect = cfg?.webAppUrl || DEFAULT_GAS_IMAGE_URL;
          if (urlToConnect) {
            const result = await connectGas(urlToConnect);
            connected = result.ok;
          }
        }
        useAppStore.getState().setDataConnected(connected);
        // 피드백 45: 팝업 렌더러는 별도 프로세스라 App.tsx 의 setUsersSheetsMode(true) 가 적용되지 않는다 —
        //   연결 성공 시 켜야 아래 loadUsers() 가 Supabase 사용자 디렉터리(전체 팀원)를 읽는다.
        if (connected) setUsersSheetsMode(true);

        // 휴가 API 자동 연결
        const vacConfig = await loadVacationConfig();
        if (vacConfig?.webAppUrl) {
          const vacResult = await connectVacation(vacConfig.webAppUrl);
          if (vacResult.ok) {
            useAppStore.getState().setVacationConnected(true);
          }
        }

        if (connected) {
          const loadedEpisodes = await readAll();
          useDataStore.getState().setEpisodes(loadedEpisodes);

          const [titleResults, memoResults] = await Promise.all([
            Promise.all(loadedEpisodes.map((ep) =>
              readMetadata('episode-title', String(ep.episodeNumber))
                .then((d) => [ep.episodeNumber, d?.value] as const)
                .catch(() => [ep.episodeNumber, undefined] as const),
            )),
            Promise.all(loadedEpisodes.map((ep) =>
              readMetadata('episode-memo', String(ep.episodeNumber))
                .then((d) => [ep.episodeNumber, d?.value] as const)
                .catch(() => [ep.episodeNumber, undefined] as const),
            )),
          ]);
          const titles: Record<number, string> = {};
          const memos: Record<number, string> = {};
          for (const [num, val] of titleResults) if (val) titles[num] = val;
          for (const [num, val] of memoResults) if (val) memos[num] = val;
          useDataStore.getState().setEpisodeTitles(titles);
          useDataStore.getState().setEpisodeMemos(memos);
        } else {
          console.warn('[WidgetPopup] 시트 연결 실패 — 빈 상태로 시작');
          useDataStore.getState().setEpisodes([]);
        }

        const users = await loadUsers();
        useAuthStore.getState().setUsers(users);
        const { user } = await loadSession();
        if (user) useAuthStore.getState().setCurrentUser(user);
      } catch (err) {
        console.error('[WidgetPopup] 초기화 실패:', err);
      }
      setReady(true);
    })();
  }, []);

  // 정확 매칭 → 접두사 매칭 (memo-{timestamp}, calendar-{timestamp} 등 다중 인스턴스 지원)
  const widgetMeta = WIDGET_REGISTRY[widgetId]
    ?? (widgetId.startsWith('memo-') ? WIDGET_REGISTRY['memo']
    : widgetId.startsWith('calendar-') ? WIDGET_REGISTRY['calendar']
    : widgetId.startsWith('my-tasks-') ? WIDGET_REGISTRY['my-tasks']
    : widgetId.startsWith('ep-part-') ? { label: '파트별 상세', component: <EpSinglePartWidget /> }
    : undefined);

  // EP 위젯: 에피소드 번호/이름을 포함한 동적 레이블
  const epNum = useAppStore((s) => s.episodeDashboardEp);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const displayLabel = useMemo(() => {
    if (!widgetMeta) return '';
    if (widgetId.startsWith('ep-') && epNum !== null) {
      const epName = episodeTitles[epNum] || `EP.${String(epNum).padStart(2, '0')}`;
      return `${epName} — ${widgetMeta.label.replace(/^EP /, '')}`;
    }
    return widgetMeta.label;
  }, [widgetId, widgetMeta, epNum, episodeTitles]);

  const handleClose = useCallback(() => {
    window.electronAPI?.widgetClosePopup?.(widgetId);
  }, [widgetId]);

  const handleAppOpacity = useCallback((val: number) => {
    const clamped = Math.max(0.15, Math.min(1, val));
    setAppOpacity(clamped);
    window.electronAPI?.widgetSetOpacity?.(widgetId, clamped);
  }, [widgetId]);

  const handleToggleAOT = useCallback(() => {
    const next = !isAOT;
    setIsAOT(next);
    window.electronAPI?.widgetSetAlwaysOnTop?.(widgetId, next);
  }, [widgetId, isAOT]);

  const handleMinimize = useCallback(() => {
    setMorphState('minimizing');
    // 콘텐츠 페이드아웃 시작 후 네이티브 모핑 호출
    setTimeout(() => {
      setIsDocked(true);
      window.electronAPI?.widgetMinimizeToDock?.(widgetId);
      // 모핑 완료 후 idle 복귀
      setTimeout(() => setMorphState('idle'), 400);
    }, 60);
  }, [widgetId]);

  const handleRestore = useCallback(() => {
    setMorphState('restoring');
    setIsDocked(false);
    setIsDockHover(false);
    window.electronAPI?.widgetRestoreFromDock?.(widgetId);
    // 모핑 완료 후 idle 복귀
    setTimeout(() => setMorphState('idle'), 400);
  }, [widgetId]);

  // 독 호버: 윈도우 확장/축소
  const handleDockMouseEnter = useCallback(() => {
    if (dockHoverTimerRef.current) { clearTimeout(dockHoverTimerRef.current); dockHoverTimerRef.current = null; }
    setIsDockHover(true);
    window.electronAPI?.widgetDockExpand?.(widgetId);
  }, [widgetId]);

  const handleDockMouseLeave = useCallback(() => {
    if (dockHoverTimerRef.current) clearTimeout(dockHoverTimerRef.current);
    dockHoverTimerRef.current = setTimeout(() => {
      setIsDockHover(false);
      window.electronAPI?.widgetDockCollapse?.(widgetId);
    }, 300);
  }, [widgetId]);

  if (!widgetMeta) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-text-primary/50 text-sm"
        style={{ background: 'transparent' }}>
        알 수 없는 위젯: {widgetId}
      </div>
    );
  }

  // 글래스 틴트 계산 (Acrylic이 블러 담당, CSS는 틴트/반사만)
  // 포커스 잃으면 틴트를 진하게 올려 Acrylic 회색 fallback을 가림
  const baseTintAlpha = 0.3 + (1 - glassIntensity) * 0.5;  // 0.3~0.8
  const tintAlpha = isFocused ? baseTintAlpha : 0.92;
  const borderAlpha = 0.06 + glassIntensity * 0.14;
  const reflectAlpha = isFocused ? glassIntensity * 0.15 : 0.02;

  // ── 독 모드: 축소(pill) → 호버 시 확장(위젯 프리뷰) ──
  if (isDocked) {
    // 축소 상태: 위젯 이름 pill (140×36, 경량 렌더링)
    if (!isDockHover) {
      return (
        <div
          className="dock-pill w-full h-full overflow-hidden cursor-pointer select-none"
          style={{
            background: `rgb(var(--color-bg-card) / 0.92)`,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            willChange: 'transform, opacity',
            animation: 'morph-dock-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
          }}
          onMouseEnter={handleDockMouseEnter}
          onClick={handleRestore}
        >
          <div className="flex items-center justify-center gap-1.5 px-2 h-full w-full">
            <BarChart3 size={12} className="text-text-secondary shrink-0" />
            <span className="text-[11px] text-text-primary font-medium leading-none truncate">
              {displayLabel}
            </span>
          </div>
        </div>
      );
    }

    // 확장 상태: 원본 글래스 스타일 + 위젯 프리뷰
    return (
      <div
        className="dock-expanded w-full h-full flex flex-col overflow-hidden"
        style={{
          background: `rgb(var(--color-bg-primary) / ${tintAlpha})`,
          cursor: 'pointer',
          animation: 'dock-expand-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
        onMouseLeave={handleDockMouseLeave}
        onMouseEnter={() => {
          if (dockHoverTimerRef.current) { clearTimeout(dockHoverTimerRef.current); dockHoverTimerRef.current = null; }
        }}
        onClick={handleRestore}
      >
        {/* 유리 반사 하이라이트 */}
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: '40%',
            background: `linear-gradient(180deg, rgba(255,255,255,${reflectAlpha * 1.2}) 0%, rgba(255,255,255,${reflectAlpha * 0.2}) 30%, transparent 100%)`,
            maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          }}
        />
        {/* 모서리 굴절 효과 */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
            boxShadow: `
              inset 0 0 ${Math.round(glassIntensity * 20)}px rgba(255,255,255,${reflectAlpha * 0.4}),
              inset 0 0 ${Math.round(glassIntensity * 4)}px rgba(255,255,255,${reflectAlpha * 0.8}),
              0 0 0 1px rgba(255,255,255,${borderAlpha * 0.5}) inset,
              0 1px 0 rgba(255,255,255,${reflectAlpha}) inset
            `,
          }}
        />
        {/* 위젯 콘텐츠 (비활성 프리뷰) */}
        <div className="flex-1 overflow-hidden relative z-10" style={{ pointerEvents: 'none' }}>
          <IsPopupContext.Provider value={true}>
          <WidgetIdContext.Provider value={widgetId}>
            <div className="h-full overflow-auto">
              {ready ? widgetMeta.component : null}
            </div>
          </WidgetIdContext.Provider>
          </IsPopupContext.Provider>
        </div>
        {/* 클릭하여 열기 오버레이 */}
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <span className="px-3 py-1.5 rounded-full text-xs font-medium text-text-primary/80"
            style={{ background: 'rgb(var(--color-bg-card) / 0.6)', backdropFilter: 'blur(8px)' }}>
            클릭하여 열기
          </span>
        </div>
      </div>
    );
  }

  // ── 일반 모드 UI (Acrylic 네이티브 블러) ──
  const isMinimizing = morphState === 'minimizing';
  const isRestoring = morphState === 'restoring';
  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden relative"
      style={{
        background: `rgb(var(--color-bg-primary) / ${tintAlpha})`,
        transition: 'background 0.3s ease, opacity 0.35s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        ...(isMinimizing ? {
          opacity: 0,
          transform: 'scale(0.8)',
        } : isRestoring ? {
          animation: 'morph-restore-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        } : {}),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* 전역 그라데이션 배경 (App.tsx와 동일한 intensity="normal"로 일관성 유지) */}
      <GradientBackdrop enabled={globalGradientEnabled} intensity="normal" />
      {/* ── 유리 반사 하이라이트 (상단) ── */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: '40%',
          background: `linear-gradient(180deg, rgba(255,255,255,${reflectAlpha * 1.2}) 0%, rgba(255,255,255,${reflectAlpha * 0.2}) 30%, transparent 100%)`,
          maskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, black 0%, transparent 100%)',
        }}
      />

      {/* ── 모서리 굴절 효과 ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
          boxShadow: `
            inset 0 0 ${Math.round(glassIntensity * 20)}px rgba(255,255,255,${reflectAlpha * 0.4}),
            inset 0 0 ${Math.round(glassIntensity * 4)}px rgba(255,255,255,${reflectAlpha * 0.8}),
            0 0 0 1px rgba(255,255,255,${borderAlpha * 0.5}) inset,
            0 1px 0 rgba(255,255,255,${reflectAlpha}) inset
          `,
        }}
      />

      {/* ── 상단 타이틀 바 (드래그 핸들 + 제목 + 컨트롤 통합) ── */}
      <div
        className="shrink-0 relative z-20 flex items-center gap-2 px-3 select-none"
        style={{
          WebkitAppRegion: 'drag',
          height: '36px',
          cursor: 'grab',
          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
        } as React.CSSProperties}
        onMouseEnter={() => {
          if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
          setShowControls(true);
        }}
        onMouseLeave={() => {
          hideTimerRef.current = setTimeout(() => {
            setShowControls(false);
            hideTimerRef.current = null;
          }, 400);
        }}
      >
        <BarChart3 size={13} className="text-accent/70 shrink-0" />
        <span className="text-[12px] text-text-primary/70 font-medium truncate">
          {displayLabel}
        </span>
        <div className="flex-1" />

        {/* 컨트롤 (no-drag — 호버 시 표시) */}
        <div
          className="flex items-center gap-2"
          style={{
            WebkitAppRegion: 'no-drag',
            opacity: showControls ? 1 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
            transition: 'opacity 0.2s ease',
          } as React.CSSProperties}
        >
          {/* AOT 핀 토글 */}
          <button
            onClick={handleToggleAOT}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center transition-colors cursor-pointer"
            style={{
              background: isAOT ? 'rgba(108, 92, 231, 0.7)' : 'rgba(255,255,255,0.15)',
            }}
            title={isAOT ? '항상 위에 표시 (켜짐)' : '항상 위에 표시 (꺼짐)'}
          >
            {isAOT
              ? <Pin size={9} className="text-on-accent" strokeWidth={3} />
              : <PinOff size={9} className="text-text-primary/60" strokeWidth={2.5} />}
          </button>

          {/* 최소화 (독 모드) */}
          <button
            onClick={handleMinimize}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-yellow-500/70 hover:bg-yellow-500 transition-colors cursor-pointer"
            title="최소화"
          >
            <Minus size={9} className="text-text-primary" strokeWidth={3} />
          </button>

          {/* 닫기 */}
          <button
            onClick={handleClose}
            className="w-[18px] h-[18px] rounded-full flex items-center justify-center bg-red-500/70 hover:bg-red-500 transition-colors cursor-pointer ml-0.5"
          >
            <X size={9} className="text-text-primary" strokeWidth={3} />
          </button>
        </div>
      </div>

      {/* ── 우하단 슬라이더 (오퍼시티/글래스) — 항상 렌더링, opacity로 전환 ── */}
      <div
        className="absolute bottom-0 right-0 z-30 flex items-center gap-2 px-2.5"
        style={{
          WebkitAppRegion: 'no-drag',
          height: '28px',
          background: showBottomControls
            ? 'linear-gradient(90deg, transparent 0%, rgb(var(--color-shadow) / 0.35) 30%, rgb(var(--color-shadow) / 0.5) 100%)'
            : 'transparent',
          borderTopLeftRadius: '8px',
          opacity: showBottomControls ? 1 : 0,
          pointerEvents: showBottomControls ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, background 0.2s ease',
        } as React.CSSProperties}
        onMouseEnter={() => {
          if (bottomHideTimerRef.current) { clearTimeout(bottomHideTimerRef.current); bottomHideTimerRef.current = null; }
          setShowBottomControls(true);
        }}
      >
        {/* 앱 오퍼시티 */}
        <div className="flex items-center gap-1" title="앱 투명도">
          <Eye size={11} className="text-text-secondary/60" />
          <input type="range" min={15} max={100}
            value={Math.round(appOpacity * 100)}
            onChange={(e) => handleAppOpacity(Number(e.target.value) / 100)}
            className="w-11 h-1 cursor-pointer" />
        </div>

        {/* 글래스 틴트 */}
        <div className="flex items-center gap-1" title="글래스 효과">
          <Droplets size={11} className="text-text-secondary/60" />
          <input type="range" min={0} max={100}
            value={Math.round(glassIntensity * 100)}
            onChange={(e) => setGlassIntensity(Number(e.target.value) / 100)}
            className="w-11 h-1 cursor-pointer" />
        </div>
      </div>

      {/* ── 위젯 콘텐츠 ── */}
      <div className="flex-1 overflow-hidden relative z-10">
        <IsPopupContext.Provider value={true}>
        <WidgetIdContext.Provider value={widgetId}>
          <div className="h-full overflow-auto">
            {ready ? widgetMeta.component : (
              <div className="flex items-center justify-center h-full">
                <span className="text-sm text-text-secondary/30 animate-pulse">로딩 중...</span>
              </div>
            )}
          </div>
        </WidgetIdContext.Provider>
        </IsPopupContext.Provider>
      </div>

      {/* Sonner 토스트 (휴가 등록 완료/실패 브로드캐스트 표시용) */}
      <Toaster
        theme={colorMode === 'light' ? 'light' : 'dark'}
        position="bottom-right"
        duration={4000}
        toastOptions={{
          className: 'bflow-toast',
          style: { fontSize: '12px' },
        }}
        visibleToasts={3}
        closeButton
      />
    </div>
  );
}
