/**
 * 브라우저 개발 환경용 electronAPI 목
 * Electron 없이 Vite dev server에서 앱을 테스트할 수 있게 함
 */

import type { ElectronAPI, AppUser, Episode, Scene, CompRevisionSet } from '@/types';
import { MOCK_EPISODES, MOCK_COMPOSITING_STATES, type MockCompositingRow } from './compositingMockSeed';
import {
  buildDevPreviewCommentReadStates,
  buildDevPreviewCommentRows,
  buildDevPreviewLocalCommentStore,
  buildDevPreviewRevisionRows,
  type DevPreviewCommentRow,
  type DevPreviewRevisionRow,
} from './devPreviewComments';
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
const COMMENTS_FILE = 'comments.json';

const noop = () => () => {};

function cloneMockEpisodes(): Episode[] {
  return JSON.parse(JSON.stringify(MOCK_EPISODES)) as Episode[];
}

function getMockEpisodes(): Episode[] {
  return (localStore.__mockEpisodes as Episode[] | undefined)
    ?? (localStore.__mockEpisodes = cloneMockEpisodes()) as Episode[];
}

function createMockScene(sheetName: string, sceneId: string, assignee: string, memo: string, no: number): Scene {
  const safeSheet = sheetName.replace(/[^a-z0-9_-]+/gi, '-');
  const safeScene = sceneId.replace(/[^a-z0-9_-]+/gi, '-');
  return {
    id: `mock-scene-${safeSheet}-${safeScene}`,
    no,
    sceneId,
    memo: memo || '',
    storyboardUrl: '',
    guideUrl: '',
    assignee: assignee || '',
    layoutId: '',
    lo: false,
    done: false,
    review: false,
    png: false,
  };
}

function addMockScene(sheetName: string, sceneId: string, assignee: string, memo: string): { sceneUuid: string | null } {
  const episodes = getMockEpisodes();
  for (const episode of episodes) {
    const part = episode.parts.find((item) => item.sheetName === sheetName);
    if (!part) continue;
    const existing = part.scenes.find((scene) => scene.sceneId.trim().toLowerCase() === sceneId.trim().toLowerCase());
    if (existing) return { sceneUuid: existing.id ?? null };
    const nextNo = part.scenes.length > 0
      ? Math.max(...part.scenes.map((scene) => scene.no)) + 1
      : 1;
    const nextScene = createMockScene(sheetName, sceneId, assignee, memo, nextNo);
    part.scenes.push(nextScene);
    localStore.__mockEpisodes = episodes;
    return { sceneUuid: nextScene.id ?? null };
  }
  return { sceneUuid: null };
}

interface MockMetadataRow {
  type: string;
  key: string;
  value: string;
  updatedAt: string;
}

function getMockMetadataRows(): MockMetadataRow[] {
  return (localStore.__metadataRows as MockMetadataRow[] | undefined)
    ?? (localStore.__metadataRows = [
      {
        type: 'episode-title',
        key: '5',
        value: '쾅 뉴럴링크',
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
      {
        type: 'episode-memo',
        key: '5',
        value: '컴포지팅 목업',
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
      { type: 'part-reel-worker', key: 'EP05_A_BG', value: '배한솔', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_A_ACT', value: '배한솔', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_B_BG', value: '장삐쭈', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_B_ACT', value: '장삐쭈', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_C_BG', value: '강선영', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_C_ACT', value: '강선영', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_D_BG', value: '박정인', updatedAt: '2026-06-05T00:00:00.000Z' },
      { type: 'part-reel-worker', key: 'EP05_D_ACT', value: '박정인', updatedAt: '2026-06-05T00:00:00.000Z' },
    ]) as MockMetadataRow[];
}

function upsertMockMetadata(type: string, key: string, value: string): void {
  const rows = getMockMetadataRows();
  const existing = rows.find((row) => row.type === type && row.key === key);
  if (existing) {
    existing.value = value;
    existing.updatedAt = new Date().toISOString();
    return;
  }
  rows.push({ type, key, value, updatedAt: new Date().toISOString() });
}

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

export function hasUsableElectronAPI(api: Partial<ElectronAPI> | undefined): boolean {
  return typeof api?.usersRead === 'function'
    && typeof api?.usersWrite === 'function'
    && typeof api?.readSettings === 'function'
    && typeof api?.writeSettings === 'function'
    && typeof api?.supabaseTestConnection === 'function'
    && typeof api?.supabaseReadAll === 'function';
}

function getMockActivityRows(): MockActivityRow[] {
  return (localStore.__activityRows as MockActivityRow[] | undefined)
    ?? (localStore.__activityRows = buildInitialMockActivityRows()) as MockActivityRow[];
}

function getMockCommentRows(): DevPreviewCommentRow[] {
  return (localStore.__commentRows as DevPreviewCommentRow[] | undefined)
    ?? (localStore.__commentRows = buildDevPreviewCommentRows(MOCK_EPISODES)) as DevPreviewCommentRow[];
}

function getMockCommentReadStates(userId: string) {
  const stateRows = (localStore.__commentReadStateRows as ReturnType<typeof buildDevPreviewCommentReadStates> | undefined)
    ?? (localStore.__commentReadStateRows = buildDevPreviewCommentReadStates(userId, MOCK_EPISODES)) as ReturnType<typeof buildDevPreviewCommentReadStates>;
  return stateRows.filter((row) => row.userId === userId);
}

function getMockRevisionRows(): DevPreviewRevisionRow[] {
  return (localStore.__revisionRows as DevPreviewRevisionRow[] | undefined)
    ?? (localStore.__revisionRows = buildDevPreviewRevisionRows(MOCK_EPISODES)) as DevPreviewRevisionRow[];
}

function getMockRevisionSets(): CompRevisionSet[] {
  return (localStore.__revisionSets as CompRevisionSet[] | undefined)
    ?? (localStore.__revisionSets = []) as CompRevisionSet[];
}

function parseJsonStringArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
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

  for (const episode of getMockEpisodes()) {
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
    ? `${context.episode.title} ${context.part.partId.toUpperCase()} ${context.scene.sceneId} 리테이크 #${revisionNo}`
    : `씬 ${sceneKey} 리테이크 #${revisionNo}`;

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

function createMockRevisionStatusActivityRow(params: {
  revision: DevPreviewRevisionRow;
  actionType: 'revision_in_progress' | 'revision_resolve';
  userId: string;
  userName: string;
  createdAt: string;
  resolvedNote?: string;
}): MockActivityRow {
  const { revision, actionType, userId, userName, createdAt, resolvedNote } = params;
  const context = findMockSceneContext(revision.sceneKey, revision.department);
  const department = revision.department === 'bg' || revision.department === 'acting'
    ? revision.department
    : context?.part.department ?? null;
  const sceneLabel = context
    ? `${context.episode.title} ${context.part.partId.toUpperCase()} ${context.scene.sceneId} 리테이크 #${revision.revisionNo}`
    : `씬 ${revision.sceneKey} 리테이크 #${revision.revisionNo}`;

  return {
    id: `mock-activity-${actionType}-${revision.id}`,
    user_id: userId,
    user_name: userName,
    action_type: actionType,
    action_group: 'memo',
    scene_id: context?.scene.id ?? null,
    scene_label: sceneLabel,
    episode_number: context?.episode.episodeNumber ?? null,
    department,
    detail: {
      revisionId: revision.id,
      revisionNumber: revision.revisionNo,
      descriptionPreview: revision.description.slice(0, 60),
      ...(resolvedNote ? { resolvedNote } : {}),
    },
    created_at: createdAt,
  };
}

function buildInitialMockActivityRows(): MockActivityRow[] {
  const rows: MockActivityRow[] = [];
  for (const revision of getMockRevisionRows()) {
    rows.push(createMockRevisionActivityRow({
      id: revision.id,
      sceneKey: revision.sceneKey,
      revisionNo: revision.revisionNo,
      description: revision.description,
      department: revision.department,
      requesterId: revision.requesterId,
      requesterName: revision.requesterName,
      createdAt: revision.createdAt,
    }));
    if (revision.status === 'in_progress') {
      rows.push(createMockRevisionStatusActivityRow({
        revision,
        actionType: 'revision_in_progress',
        userId: '1',
        userName: '배한솔',
        createdAt: revision.updatedAt || revision.createdAt,
      }));
    }
    if (revision.status === 'resolved') {
      rows.push(createMockRevisionStatusActivityRow({
        revision,
        actionType: 'revision_resolve',
        userId: '1',
        userName: revision.resolvedBy || '배한솔',
        createdAt: revision.resolvedAt || revision.updatedAt || revision.createdAt,
        resolvedNote: revision.resolvedNote,
      }));
    }
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
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
  if (hasUsableElectronAPI(window.electronAPI)) return; // 이미 Electron 환경이면 무시

  localStore[COMMENTS_FILE] ??= buildDevPreviewLocalCommentStore(MOCK_EPISODES);
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
    retryUpdate: async () => null,
    onUpdateState: noop,
    onUpdateReady: noop,
    applyUpdateNow: async () => {},

    showNativeNotification: async (title: string, body: string) => {
      console.log(`[DEV 알림] ${title}: ${body}`);
    },

    // v1.25.0~ 액팅 단계 토글 + 리테이크 알림 (mock — 로그만)
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
    sheetsReadRevisions: async () => ({ ok: true, data: getMockRevisionRows() }),

    dataNotifyChange: async () => ({ ok: true }),
    sheetsNotifyChange: async () => ({ ok: true }),
    onSnapshotRelay: noop,
    sheetsRelaySnapshot: async () => ({ ok: true }),
    sheetsReadAllMetadata: async () => ({ ok: true, data: getMockMetadataRows() }),

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
    supabaseReadAll: async () => getMockEpisodes() as unknown as Record<string, unknown>[],
    supabaseAddEpisode: async () => {},
    supabaseSoftDeleteEpisode: async () => {},
    supabaseArchiveEpisode: async () => {},
    supabaseUnarchiveEpisode: async () => {},
    supabaseReadArchived: async () => [],
    supabaseAddPart: async () => {},
    supabaseSoftDeletePart: async () => {},
    supabaseAddScene: async (sheetName, sceneId, assignee, memo) => addMockScene(sheetName, sceneId, assignee, memo),
    supabaseAddScenes: async (sheetName, scenes) => {
      scenes.forEach((scene) => addMockScene(sheetName, scene.sceneId, scene.assignee, scene.memo));
    },
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
    supabaseReadComments: async (partUuid) => getMockCommentRows().filter((comment) => comment.partId === partUuid),
    supabaseReadCommentReadStates: async (userId) => getMockCommentReadStates(userId),
    supabaseUpsertCommentReadState: async (userId, sceneThreadKey, lastReadAt) => {
      const stateRows = getMockCommentReadStates(userId);
      const existing = stateRows.find((row) => row.sceneThreadKey === sceneThreadKey);
      const updatedAt = new Date().toISOString();
      if (existing) {
        existing.lastReadAt = lastReadAt;
        existing.updatedAt = updatedAt;
      } else {
        stateRows.push({ userId, sceneThreadKey, lastReadAt, updatedAt });
      }
      localStore.__commentReadStateRows = stateRows;
    },
    supabaseFetchMissedMentions: async () => [],
    supabaseAddComment: async (commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images, revisionId, parentCommentId) => {
      const comments = getMockCommentRows();
      comments.push({
        id: commentId,
        partId: partUuid,
        sceneId,
        userId,
        userName,
        text,
        mentions,
        images,
        createdAt,
        editedAt: null,
        revisionId: revisionId ?? null,
        parentCommentId: parentCommentId ?? null,
      });
      localStore.__commentRows = comments;
    },
    supabaseEditComment: async (commentId, text, mentions, images) => {
      const comments = getMockCommentRows();
      const target = comments.find((comment) => comment.id === commentId);
      if (!target) return;
      target.text = text;
      target.mentions = mentions;
      if (images !== undefined) target.images = images;
      target.editedAt = new Date().toISOString();
      localStore.__commentRows = comments;
    },
    supabaseDeleteComment: async (commentId) => {
      const comments = getMockCommentRows()
        .filter((comment) => comment.id !== commentId)
        .map((comment) => comment.parentCommentId === commentId ? { ...comment, parentCommentId: null } : comment);
      localStore.__commentRows = comments;
    },
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
    supabaseReadRevisions: async () => getMockRevisionRows(),
    supabaseAddRevision: async (
      id: string,
      _partUuid: string,
      sceneKey: string,
      revisionNo: number,
      status: string,
      priority: string,
      description: string,
      frameNo: string,
      imageUrl: string,
      department: string,
      lookupDepartment: string,
      requesterId: string,
      requesterName: string,
      assignee: string,
      createdAt: string,
      notifyUserIdsJson?: string,
      assigneeIdsJson?: string,
    ) => {
      const revisions = getMockRevisionRows();
      const mockAssigneeIds = parseJsonStringArray(assigneeIdsJson);
      revisions.push({
        id,
        sceneKey,
        revisionNo,
        status: status || 'open',
        priority: priority || 'normal',
        description,
        frameNo,
        imageUrl,
        department: department || lookupDepartment,
        requesterId,
        requesterName,
        assignee,
        resolvedBy: '',
        resolvedNote: '',
        createdAt,
        updatedAt: createdAt,
        resolvedAt: '',
        notifyUserIds: parseJsonStringArray(notifyUserIdsJson),
        assigneeIds: mockAssigneeIds,
        assigneeStates: Object.fromEntries(mockAssigneeIds.map((aid) => [aid, { state: 'pending' }])),
        setId: null,
        finalResolvedBy: '',
        finalResolvedAt: '',
      });
      localStore.__revisionRows = revisions;
      window.dispatchEvent(new CustomEvent('bflow:revisions-invalidated'));

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
    supabaseUpdateRevision: async (id: string, updates: Record<string, string>) => {
      const revisions = getMockRevisionRows();
      const target = revisions.find((revision) => revision.id === id);
      if (!target) return;
      const previousStatus = target.status;
      // 프로덕션 main.ts 와 동일: __op 는 활동기록 분기 전용 신호라 행에 저장하지 않는다.
      const { __op: _op, ...rest } = updates;
      void _op;
      // JSONB 필드는 JSON 문자열로 들어오므로 파싱해 객체/배열로 저장(재로드 시 타입가드 폴백 소실 방지).
      const normalized: Record<string, unknown> = { ...rest };
      if (typeof rest.assigneeIds === 'string') {
        try { normalized.assigneeIds = JSON.parse(rest.assigneeIds); } catch { normalized.assigneeIds = []; }
      }
      if (typeof rest.assigneeStates === 'string') {
        try { normalized.assigneeStates = JSON.parse(rest.assigneeStates); } catch { normalized.assigneeStates = {}; }
      }
      Object.assign(target, {
        ...normalized,
        updatedAt: rest.updatedAt ?? rest.updated_at ?? new Date().toISOString(),
      });
      localStore.__revisionRows = revisions;
      window.dispatchEvent(new CustomEvent('bflow:revisions-invalidated'));

      if (updates.status && updates.status !== previousStatus) {
        const actionType = updates.status === 'resolved'
          ? 'revision_resolve'
          : updates.status === 'in_progress'
            ? 'revision_in_progress'
            : null;
        if (actionType) {
          const activity = createMockRevisionStatusActivityRow({
            revision: target,
            actionType,
            userId: '1',
            userName: updates.resolvedBy || '배한솔',
            createdAt: target.resolvedAt || target.updatedAt || new Date().toISOString(),
            resolvedNote: updates.resolvedNote,
          });
          getMockActivityRows().unshift(activity);
          emitMockActivityRealtime(activity);
        }
      }
    },
    supabaseDeleteRevision: async (id: string) => {
      localStore.__revisionRows = getMockRevisionRows().filter((revision) => revision.id !== id);
      window.dispatchEvent(new CustomEvent('bflow:revisions-invalidated'));
    },
    supabaseReadRevisionSets: async () => getMockRevisionSets(),
    supabaseAddRevisionSet: async (input) => {
      const now = new Date().toISOString();
      const set = {
        id: `mock-set-${Date.now()}`,
        title: input.title,
        episodeNumber: input.episodeNumber ?? null,
        department: input.department ?? null,
        aggregatorId: input.aggregatorId ?? null,
        status: 'open' as const,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      localStore.__revisionSets = [...getMockRevisionSets(), set];
      window.dispatchEvent(new CustomEvent('bflow:revision-sets-invalidated'));
      return set;
    },
    supabaseUpdateRevisionSet: async (id, fields) => {
      const sets = getMockRevisionSets();
      let updated = sets.find((s) => s.id === id);
      localStore.__revisionSets = sets.map((s) => {
        if (s.id !== id) return s;
        updated = { ...s, ...fields, updatedAt: new Date().toISOString() };
        return updated;
      });
      if (!updated) throw new Error(`mock revision set not found: ${id}`);
      window.dispatchEvent(new CustomEvent('bflow:revision-sets-invalidated'));
      return updated;
    },
    supabaseDeleteRevisionSet: async (id) => {
      localStore.__revisionSets = getMockRevisionSets().filter((s) => s.id !== id);
      // 실 DB FK ON DELETE SET NULL 패리티(코덱스 P2) — 삭제된 세트를 가리키던 mock 리비전의 setId 를 해제.
      //   안 하면 preview 에서 유령 세트 소속·stale setId 동작이 남는다(UI 안내도 '항목 소속만 해제').
      const revisions = getMockRevisionRows();
      let touched = false;
      for (const rev of revisions) {
        if (rev.setId === id) { rev.setId = null; touched = true; }
      }
      if (touched) {
        localStore.__revisionRows = revisions;
        window.dispatchEvent(new CustomEvent('bflow:revisions-invalidated'));
      }
      window.dispatchEvent(new CustomEvent('bflow:revision-sets-invalidated'));
    },
    supabaseReadAllMetadata: async () => getMockMetadataRows(),
    supabaseReadMetadata: async (type, key) =>
      getMockMetadataRows().find((row) => row.type === type && row.key === key) ?? null,
    supabaseWriteMetadata: async (type, key, value) => upsertMockMetadata(type, key, value),
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
  document.documentElement.dataset.devElectronApi = 'installed';
}
