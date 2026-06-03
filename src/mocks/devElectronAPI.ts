/**
 * 브라우저 개발 환경용 electronAPI 목
 * Electron 없이 Vite dev server에서 앱을 테스트할 수 있게 함
 */

import type { ElectronAPI, AppUser } from '@/types';
import { MOCK_EPISODES, MOCK_COMPOSITING_STATES, type MockCompositingRow } from './compositingMockSeed';
import { normalizeSceneIdKey } from '@/utils/sceneIdKey';

const MOCK_USERS: AppUser[] = [
  { id: '1', name: '배한솔', slackId: 'U05DFV9UAN5', password: '1234', isInitialPassword: false, createdAt: '2025-01-01T00:00:00Z', role: 'admin' },
  { id: '2', name: '장삐쭈', slackId: 'U03MM2C4F4Z', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '3', name: '허혜원', slackId: 'U03M1Q37LDU', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '4', name: '안류천', slackId: 'U03MAQH93BN', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '5', name: '강선영', slackId: 'U03M8AVUC1H', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '6', name: '박정인', slackId: 'U03M8AWB49Z', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '7', name: '원동우', slackId: 'U03MM2B1W73', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '8', name: '이혜민', slackId: 'U03PN339U4E', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '9', name: '이다은', slackId: 'U068C1BKPRT', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '10', name: '김어진', slackId: 'U090WLY7XLH', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '11', name: '류이레', slackId: 'U0978NUD5L7', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
  { id: '12', name: '류성철', slackId: 'U0A7KTD4Z4G', password: '1234', isInitialPassword: true, createdAt: '2025-01-01T00:00:00Z', role: 'user' },
];

// 로컬 스토리지 기반 간이 저장소
const localStore: Record<string, unknown> = {};

const noop = () => () => {};

interface MockActivityRow {
  id: string;
  user_id: string;
  user_name: string;
  action_type: string;
  action_group: 'progress' | 'memo' | 'scene' | 'etc';
  scene_id: string | null;
  scene_label: string | null;
  episode_number: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const activityRealtimeCallbacks = new Set<(row: MockActivityRow) => void>();

function getMockActivityRows(): MockActivityRow[] {
  return (localStore.__activityRows as MockActivityRow[] | undefined)
    ?? (localStore.__activityRows = []) as MockActivityRow[];
}

function emitMockActivityRealtime(row: MockActivityRow): void {
  activityRealtimeCallbacks.forEach((callback) => callback(row));
}

function decodeRawRevisionSceneId(sceneId: string): string {
  const normalized = sceneId.trim().toLowerCase();
  if (!normalized.startsWith('raw-')) return normalized;
  try {
    return decodeURIComponent(normalized.slice(4));
  } catch {
    return normalized.slice(4);
  }
}

function findMockSceneContext(sceneKey: string, preferredDepartment?: string) {
  const [episodeToken = '', partToken = '', sceneToken = ''] = sceneKey.split(':');
  const episodeNumber = Number(episodeToken.replace(/\D/g, ''));
  const partKey = partToken.trim().toUpperCase();
  const hasRawSceneToken = sceneToken.trim().toLowerCase().startsWith('raw-');
  const sceneId = decodeRawRevisionSceneId(sceneToken);
  const normalizedSceneId = normalizeSceneIdKey(sceneId, partKey);
  let fallback: {
    episode: (typeof MOCK_EPISODES)[number];
    part: (typeof MOCK_EPISODES)[number]['parts'][number];
    scene: (typeof MOCK_EPISODES)[number]['parts'][number]['scenes'][number];
  } | null = null;

  for (const episode of MOCK_EPISODES) {
    if (episodeNumber && episode.episodeNumber !== episodeNumber) continue;
    for (const part of episode.parts) {
      if (part.partId.trim().toUpperCase() !== partKey) continue;
      for (const scene of part.scenes) {
        const rawSceneId = scene.sceneId.trim().toLowerCase();
        const canonicalSceneId = normalizeSceneIdKey(scene.sceneId, part.partId);
        if (hasRawSceneToken) {
          if (rawSceneId !== sceneId) continue;
        } else if (rawSceneId !== sceneId && canonicalSceneId !== normalizedSceneId) {
          continue;
        }
        const match = { episode, part, scene };
        if (!fallback) fallback = match;
        if (!preferredDepartment || part.department === preferredDepartment) return match;
      }
    }
  }

  return fallback;
}

function createMockRevisionActivityRow(params: {
  id: string;
  sceneKey: string;
  revisionNo: number;
  description: string;
  department: string;
  requesterId: string;
  requesterName: string;
  createdAt: string;
}): MockActivityRow {
  const { id, sceneKey, revisionNo, description, requesterId, requesterName, createdAt } = params;
  const context = findMockSceneContext(sceneKey, params.department);
  const department = params.department === 'bg' || params.department === 'acting'
    ? params.department
    : context?.part.department ?? null;
  const sceneLabel = context
    ? `${context.episode.title} ${context.part.partId.toUpperCase()} ${context.scene.sceneId} 리비전 #${revisionNo}`
    : `씬 ${sceneKey} 리비전 #${revisionNo}`;

  return {
    id: `mock-activity-revision_add-${id}`,
    user_id: requesterId,
    user_name: requesterName,
    action_type: 'revision_add',
    action_group: 'memo',
    scene_id: context?.scene.id ?? null,
    scene_label: sceneLabel,
    episode_number: context?.episode.episodeNumber ?? null,
    department,
    detail: {
      revisionId: id,
      revisionNumber: revisionNo,
      descriptionPreview: description.slice(0, 60),
    },
    created_at: createdAt,
  };
}

function filterMockActivities(opts: {
  before?: string;
  limit?: number;
  groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  department?: 'bg' | 'acting' | null;
  sceneIds?: string[];
  rangeStart?: string;
  rangeEnd?: string;
} = {}): MockActivityRow[] {
  let rows = [...getMockActivityRows()];
  if (opts.sceneIds && opts.sceneIds.length > 0) {
    const sceneSet = new Set(opts.sceneIds);
    rows = rows.filter((row) => row.scene_id && sceneSet.has(row.scene_id));
  }
  if (opts.department) {
    rows = rows.filter((row) => row.department === opts.department);
  }
  if (opts.groups && opts.groups.length > 0) {
    const groupSet = new Set(opts.groups);
    rows = rows.filter((row) => groupSet.has(row.action_group));
  }
  if (opts.before) {
    rows = rows.filter((row) => row.created_at < opts.before!);
  }
  if (opts.rangeStart) {
    rows = rows.filter((row) => row.created_at >= opts.rangeStart!);
  }
  if (opts.rangeEnd) {
    rows = rows.filter((row) => row.created_at <= opts.rangeEnd!);
  }
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.slice(0, opts.limit ?? rows.length);
}

export function installDevElectronAPI(): void {
  if (window.electronAPI) return; // 이미 Electron 환경이면 무시

  console.log('[DEV] 브라우저 mock electronAPI 설치됨');

  const mockAPI: ElectronAPI = {
    getDataPath: async () => '/dev/mock-data',

    // v1.20.0: 사용자 폰트 — 개발 환경에선 stub (Electron dialog/fs 사용 불가)
    fontAdd: async () => {
      console.warn('[devMock] fontAdd: Electron 환경에서만 작동');
      return [];
    },
    fontAddByPath: async () => {
      console.warn('[devMock] fontAddByPath: Electron 환경에서만 작동');
      return [];
    },
    fontDelete: async () => ({ ok: true }),
    fontGetPathForFile: () => '',

    usersRead: async () => ({
      users: MOCK_USERS.map(u => ({
        id: u.id, name: u.name, slackId: u.slackId,
        password: u.password, isInitialPassword: u.isInitialPassword,
        createdAt: u.createdAt, role: u.role,
      })),
    }),
    usersWrite: async () => true,

    readSettings: async (fileName: string) => localStore[fileName] ?? null,
    writeSettings: async (fileName: string, data: unknown) => { localStore[fileName] = data; return true; },

    onDataChanged: noop,
    onSheetChanged: noop,
    onRetryNotify: noop,
    onSavingBeforeQuit: noop,
    getUpdateState: async () => null,
    onUpdateState: noop,
    onUpdateReady: noop,
    applyUpdateNow: async () => {},

    showNativeNotification: async (title: string, body: string) => {
      console.log(`[DEV 알림] ${title}: ${body}`);
    },

    // v1.25.0~ 액팅 단계 토글 + 피드백 알림 (mock — 로그만)
    supabaseUpdateScenePhase: async (sceneUuid, sceneState, workRound, feedbackRound) => {
      console.log('[DEV] supabaseUpdateScenePhase:', { sceneUuid, sceneState, workRound, feedbackRound });
    },
    supabaseDispatchFeedbackNotification: async (payload) => {
      console.log('[DEV] supabaseDispatchFeedbackNotification:', payload);
    },
    supabaseFetchMissedFeedbackNotifications: async (userId, since, limit, before) => {
      console.log('[DEV] supabaseFetchMissedFeedbackNotifications:', { userId, since, limit, before });
      return [];
    },
    supabaseMarkFeedbackNotificationRead: async (notificationId) => {
      console.log('[DEV] supabaseMarkFeedbackNotificationRead:', notificationId);
    },
    supabaseFetchMissedAssignmentNotifications: async (userId, since, limit, before) => {
      console.log('[DEV] supabaseFetchMissedAssignmentNotifications:', { userId, since, limit, before });
      return [];
    },
    supabaseMarkAssignmentNotificationRead: async (notificationId) => {
      console.log('[DEV] supabaseMarkAssignmentNotificationRead:', notificationId);
    },
    // v1.29.0 mocks
    supabaseFetchCommentReactionNotifications: async (args: {
      recipientId: string; since?: string; before?: string; limit?: number; ids?: string[];
    }) => {
      console.log('[DEV] supabaseFetchCommentReactionNotifications:', args);
      return { data: [] };
    },
    supabaseMarkCommentReactionRead: async (id) => {
      console.log('[DEV] supabaseMarkCommentReactionRead:', id);
    },
    supabaseMarkAllCommentReactionsRead: async (recipientId) => {
      console.log('[DEV] supabaseMarkAllCommentReactionsRead:', recipientId);
    },
    notifyFeedbackToast: async (payload) => {
      console.log('[DEV] notifyFeedbackToast:', payload);
    },
    onFeedbackJumpToScene: noop,

    imageSave: async () => '/dev/mock-image.png',
    imageDelete: async () => true,
    imageGetDir: async () => '/dev/images',
    clipboardReadImage: async () => null,

    sheetsConnect: async () => ({ ok: false, error: 'DEV mock' }),
    sheetsIsConnected: async () => false,
    sheetsUploadImage: async () => ({ ok: false, error: 'DEV mock' }),
    storageUploadImage: async () => ({ ok: true, url: 'mock://image' }),
    storageDeleteImage: async () => {},
    sheetsReadComments: async () => ({ ok: true, data: [] }),
    sheetsReadRevisions: async () => ({ ok: true, data: [] }),

    dataNotifyChange: async () => ({ ok: true }),
    sheetsNotifyChange: async () => ({ ok: true }),
    onSnapshotRelay: noop,
    sheetsRelaySnapshot: async () => ({ ok: true }),
    sheetsReadAllMetadata: async () => ({ ok: true, data: [] }),

    vacationConnect: async () => ({ ok: false, error: 'DEV mock' }),
    vacationIsConnected: async () => false,
    vacationReadStatus: async () => ({ ok: false, data: {} as never, error: 'DEV mock' }),
    vacationReadLog: async () => ({ ok: false, data: [], error: 'DEV mock' }),
    vacationReadAllEvents: async () => ({ ok: false, data: [], error: 'DEV mock' }),
    vacationRegister: async () => ({ ok: false, success: false, state: '', error: 'DEV mock' }),
    vacationCancel: async () => ({ ok: false, success: false, state: '', error: 'DEV mock' }),
    vacationGrantDahyu: async () => ({ ok: false, success: false, granted: [], failed: [], state: '' }),
    vacationReadAllNames: async () => ({ ok: false, data: [], error: 'DEV mock' }),
    vacationReadDahyuList: async () => ({ ok: false, data: [], error: 'DEV mock' }),
    vacationDeleteDahyu: async () => ({ ok: false, success: false, deleted: [], failed: [], state: '' }),

    whiteboardReadShared: async () => ({ ok: true, data: null }),
    whiteboardWriteShared: async () => ({ ok: true }),

    // ─── Supabase mock ───
    supabaseTestConnection: async () => ({ ok: true }),
    // v1.30.0: 컴포지팅 대시보드 시각 검증용 — MOCK_EPISODES 시드.
    // 운영(.exe)에는 영향 없음 (devElectronAPI 자체가 install skip).
    supabaseReadAll: async () => MOCK_EPISODES as unknown as Record<string, unknown>[],
    supabaseAddEpisode: async () => {},
    supabaseSoftDeleteEpisode: async () => {},
    supabaseArchiveEpisode: async () => {},
    supabaseUnarchiveEpisode: async () => {},
    supabaseReadArchived: async () => [],
    supabaseAddPart: async () => {},
    supabaseSoftDeletePart: async () => {},
    supabaseAddScene: async () => ({ sceneUuid: null }),
    supabaseAddScenes: async () => {},
    supabaseDeleteScene: async () => {},
    supabaseUpdateSceneStage: async () => {},
    supabaseBulkUpdateSceneStages: async (updates) => updates.map((u) => ({ sceneUuid: u.sceneUuid, success: true })),
    supabaseBulkDeleteScenes: async (sceneUuids) => sceneUuids.map((id) => ({ sceneUuid: id, success: true })),
    supabaseBulkUpdateSceneFields: async (updates) => updates.map((u) => ({ sceneUuid: u.sceneUuid, success: true })),
    supabaseUpdateSceneField: async () => {},
    supabaseReadUsers: async () => MOCK_USERS.map(u => ({
      id: u.id, name: u.name, slack_id: u.slackId,
      password: u.password, is_initial_password: u.isInitialPassword,
      created_at: u.createdAt, role: u.role,
    })),
    supabaseAddUser: async () => {},
    supabaseUpdateUser: async () => {},
    supabaseDeleteUser: async () => {},
    supabaseReadComments: async () => [],
    supabaseFetchMissedMentions: async () => [],
    supabaseAddComment: async () => {},
    supabaseEditComment: async () => {},
    supabaseDeleteComment: async () => {},
    // v1.26.0 mocks
    supabaseAddCommentReaction: async () => {},
    supabaseRemoveCommentReaction: async () => {},
    supabaseGetCommentReactionsBulk: async () => ({}),
    supabaseListImageVersions: async () => [],
    supabaseAddImageVersion: async (params: {
      sceneId: string;
      imageType: 'storyboard' | 'guide';
      kind: 'replace' | 'annotate';
      url: string;
      baseVersionNo?: number;
      createdBy: string;
      description?: string | null;
    }) => ({
      id: 'mock-iv-' + Date.now(),
      sceneId: params.sceneId,
      imageType: params.imageType,
      versionNo: 1,
      url: params.url,
      kind: params.kind,
      baseVersionNo: params.baseVersionNo ?? null,
      createdBy: params.createdBy,
      createdByName: 'mock',
      createdAt: new Date().toISOString(),
      description: params.description ?? null,
    }),
    supabaseDeleteImageVersion: async () => {},
    supabaseReadPrivateEvents: async () => [],
    supabaseAddPrivateEvent: async () => ({ id: 'mock-private' }),
    supabaseUpdatePrivateEvent: async () => {},
    supabaseDeletePrivateEvent: async () => {},
    supabaseReadRevisions: async () => [],
    supabaseAddRevision: async (
      id: string,
      _partUuid: string,
      sceneKey: string,
      revisionNo: number,
      _status: string,
      _priority: string,
      description: string,
      _frameNo: string,
      _imageUrl: string,
      department: string,
      lookupDepartment: string,
      requesterId: string,
      requesterName: string,
      _assignee: string,
      createdAt: string,
    ) => {
      const activity = createMockRevisionActivityRow({
        id,
        sceneKey,
        revisionNo,
        description,
        department: department || lookupDepartment,
        requesterId,
        requesterName,
        createdAt,
      });
      getMockActivityRows().unshift(activity);
      emitMockActivityRealtime(activity);
    },
    supabaseUpdateRevision: async () => {},
    supabaseDeleteRevision: async (_id: string) => {},
    supabaseReadAllMetadata: async () => [],
    supabaseReadMetadata: async () => null,
    supabaseWriteMetadata: async () => {},
    supabaseGetActivity: async () => [],
    supabaseGetRealtimeStatus: async () => 'CONNECTING',
    onSupabaseRealtime: noop,
    onSupabaseStatus: noop,
    onSupabaseBroadcast: noop,

    // ─── Personal Todos / Task Views mock ───
    supabaseReadTodos: async () => [],
    supabaseUpsertTodo: async () => 'mock-id',
    supabaseDeleteTodo: async () => {},
    supabaseReadTaskViews: async () => null,
    supabaseUpsertTaskViews: async () => {},

    // ─── Memos mock ───
    supabaseReadMemo: async () => null,
    supabaseUpsertMemo: async () => {},
    supabaseReadAllMemos: async () => [],

    // ─── 슬랙 웹훅 (콘솔 로그) ───
    sendSlackWebhook: async (payload: Record<string, string>) => {
      console.log('[DEV 슬랙 웹훅] 페이로드:', JSON.stringify(payload, null, 2));
      return { ok: true };
    },
    onDeepLink: noop,

    // ─── Google Calendar mock ───
    gcalIsAuthenticated: async () => false,
    gcalStartAuth: async () => {},
    gcalSaveCredentials: async () => {},
    gcalHasCredentials: async () => false,
    gcalSignOut: async () => {},
    gcalListCalendars: async () => [],
    gcalFullSync: async () => [],
    gcalIncrementalSync: async () => ({ updated: [], deleted: [], isFullSync: false }),
    gcalInsertEvent: async () => (typeof crypto !== 'undefined' && crypto.randomUUID ? `mock_${crypto.randomUUID()}` : `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    gcalUpdateEvent: async () => {},
    gcalDeleteEvent: async () => {},
    gcalEnsureWatch: async () => {},

    // 설정/세션 변경 브로드캐스트 (mock은 no-op)
    preferencesBroadcastChange: async () => ({ ok: true }),
    onPreferencesChanged: noop,
    sessionBroadcastChange: async () => ({ ok: true }),
    sessionRequestCurrent: async () => ({ ok: true }),
    onSessionChanged: noop,
    themeBroadcastChange: async () => ({ ok: true }),
    onThemeChanged: noop,
    calendarBroadcastChange: async () => ({ ok: true }),
    onCalendarChanged: noop,

    // ─── 휴가 pending 상태 + 브로드캐스트 (mock은 no-op) ───
    vacationPendingLoad: async () => [],
    vacationPendingSave: async () => ({ ok: true }),
    vacationBroadcastRegistered: async () => ({ ok: true }),
    vacationBroadcastFailed: async () => ({ ok: true }),
    vacationBroadcastPendingChanged: async () => ({ ok: true }),
    onVacationRegistered: noop,
    onVacationFailed: noop,
    onVacationPendingChanged: noop,

    // ─── 활동 기록 (mock 은 빈 결과) ─────────────
    authSetCurrentUser: async () => {},
    activityList: async (opts) => filterMockActivities(opts),
    activityStats: async () => [],
    activityStatsV2: async () => [],
    activityInsights: async () => ({
      monthDowGrid: [],
      userBreakdown: [],
      userBreakdownTotal: 0,
      stageBreakdown: { lo: 0, done: 0, review: 0, png: 0 },
      topScenes: [],
      weeklyCompleted: [],
      sceneFlow: {},
      episodeProgress: [],
    }),
    activityBackfill: async () => [],
    activityStorageInfo: async () => ({ count: 0, sizeMB: 0 }),
    onActivityRealtimeInsert: (callback) => {
      activityRealtimeCallbacks.add(callback);
      return () => activityRealtimeCallbacks.delete(callback);
    },

    // v1.30.0: 컴포지팅 단계 상태 — preview 모드에서 시각 검증용으로 in-memory 시드 + 변경 추적.
    supabaseLoadCompositingStates: async (episodeNumber: number) => {
      const compStore: MockCompositingRow[] = (localStore.__compositingStates as MockCompositingRow[] | undefined)
        ?? (localStore.__compositingStates = [...MOCK_COMPOSITING_STATES]) as MockCompositingRow[];
      return compStore.filter((r) => r.episode_number === episodeNumber);
    },
    supabaseSetCompositingState: async (input) => {
      const compStore: MockCompositingRow[] = (localStore.__compositingStates as MockCompositingRow[] | undefined)
        ?? (localStore.__compositingStates = [...MOCK_COMPOSITING_STATES]) as MockCompositingRow[];
      const idx = compStore.findIndex(
        (r) => r.episode_number === input.episodeNumber && r.scene_id === input.sceneId,
      );
      const row: MockCompositingRow = {
        id: idx >= 0
          ? compStore[idx].id
          : (typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        episode_number: input.episodeNumber,
        scene_id: input.sceneId,
        part_id: input.partId,
        status: input.status,
        error_kind: input.errorKind ?? null,
        error_note: input.errorNote ?? null,
        progress_percent: input.progressPercent ?? 0,
        updated_at: new Date().toISOString(),
        updated_by: input.updatedBy,
      };
      if (idx >= 0) compStore[idx] = row;
      else compStore.push(row);
      return row;
    },
    onCompositingStatesRealtime: noop,
  };

  (window as Window & typeof globalThis).electronAPI = mockAPI;
}
