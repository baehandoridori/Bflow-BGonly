/**
 * 브라우저 개발 환경용 electronAPI 목
 * Electron 없이 Vite dev server에서 앱을 테스트할 수 있게 함
 */

import type { ElectronAPI, AppUser } from '@/types';

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

export function installDevElectronAPI(): void {
  if (window.electronAPI) return; // 이미 Electron 환경이면 무시

  console.log('[DEV] 브라우저 mock electronAPI 설치됨');

  const mockAPI: ElectronAPI = {
    getDataPath: async () => '/dev/mock-data',

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

    showNativeNotification: async (title: string, body: string) => {
      console.log(`[DEV 알림] ${title}: ${body}`);
    },

    imageSave: async () => '/dev/mock-image.png',
    imageDelete: async () => true,
    imageGetDir: async () => '/dev/images',
    clipboardReadImage: async () => null,

    sheetsConnect: async () => ({ ok: false, error: 'DEV mock' }),
    sheetsIsConnected: async () => false,
    sheetsUploadImage: async () => ({ ok: false, error: 'DEV mock' }),
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
    supabaseReadAll: async () => [],
    supabaseAddEpisode: async () => {},
    supabaseSoftDeleteEpisode: async () => {},
    supabaseArchiveEpisode: async () => {},
    supabaseUnarchiveEpisode: async () => {},
    supabaseReadArchived: async () => [],
    supabaseAddPart: async () => {},
    supabaseSoftDeletePart: async () => {},
    supabaseAddScene: async () => {},
    supabaseAddScenes: async () => {},
    supabaseDeleteScene: async () => {},
    supabaseUpdateSceneStage: async () => {},
    supabaseBulkUpdateSceneStages: async () => {},
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
    supabaseAddComment: async () => {},
    supabaseEditComment: async () => {},
    supabaseDeleteComment: async () => {},
    supabaseReadRevisions: async () => [],
    supabaseAddRevision: async () => {},
    supabaseUpdateRevision: async () => {},
    supabaseReadAllMetadata: async () => [],
    supabaseReadMetadata: async () => null,
    supabaseWriteMetadata: async () => {},
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
  };

  (window as Window & typeof globalThis).electronAPI = mockAPI;
}
