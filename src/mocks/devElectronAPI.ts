/**
 * 브라우저 개발 환경용 electronAPI 목
 * Electron 없이 Vite dev server에서 앱을 테스트할 수 있게 함
 */

import type { ElectronAPI, AppUser, Episode, Scene, CompRevisionSet, SceneWorkLink } from '@/types';
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
import { createUuid } from '@/utils/createUuid';
import { createPersonalTodoPreviewStore, PERSONAL_TODO_PREVIEW_SESSION_KEY, type PersonalTodoPreviewStore } from './personalTodoPreviewStore';
import { createMarketLocalStorageGateway } from '@/features/playground/market/localStorageGateway';
import type { MarketPreviewGateway } from '@/features/playground/market/previewGateway';
import type { MarketRemoteState, MarketSnapshot } from '@/features/playground/market/types';
import { createArcadeLocalStorageGateway } from '@/features/playground/arcade/localStorageGateway';
import type { ArcadePreviewGateway } from '@/features/playground/arcade/previewGateway';
import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';

type PreviewUser = AppUser & { password: string };

const MOCK_USERS: PreviewUser[] = [
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

/** 변경 가능한 mock 사용자 목록 — role 토글 등 update 를 반영하기 위해 MOCK_USERS 복제본 사용. */
function getMockUsers(): PreviewUser[] {
  return (localStore.__users as PreviewUser[] | undefined)
    ?? (localStore.__users = MOCK_USERS.map((u) => ({ ...u }))) as PreviewUser[];
}

let previewCanonicalUserId: string | null = null;
let previewCanonicalEpoch = 0;
let previewRememberedUserId: string | null = null;
let previewTodoStore: PersonalTodoPreviewStore | null = null;
let previewMarketGateway: MarketPreviewGateway | null = null;
let previewMarketUserId: string | null = null;
let previewArcadeGateway: ArcadePreviewGateway | null = null;
let previewArcadeUserId: string | null = null;
const previewTodoCommitListeners = new Set<(payload: unknown) => void>();

type MockCalendarRow = Awaited<ReturnType<ElectronAPI['calendarCreate']>>;
type MockCalendarEventRow = Awaited<ReturnType<ElectronAPI['calendarEventCreate']>>;
type MockCalendarTagRow = Awaited<ReturnType<ElectronAPI['calendarTagsList']>>[number];

const mockCalendars: MockCalendarRow[] = [];
const mockCalendarEvents: MockCalendarEventRow[] = [];
const mockCalendarTags: MockCalendarTagRow[] = [
  { id: 'tag-upload', name: '업로드', color: '#E17055', sort_order: 0 },
  { id: 'tag-cut', name: '가편', color: '#74B9FF', sort_order: 1 },
  { id: 'tag-script', name: '대본', color: '#FDCB6E', sort_order: 2 },
  { id: 'tag-meeting', name: '회의', color: '#A29BFE', sort_order: 3 },
];

function ensureMockPersonalCalendar(): MockCalendarRow | null {
  const userId = previewCanonicalUserId;
  if (!userId) return null;

  const existing = mockCalendars.find(
    (calendar) => calendar.owner_id === userId && calendar.is_personal,
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const created: MockCalendarRow = {
    id: `mock-personal-${userId}`,
    name: '개인',
    color: '#6C5CE7',
    visibility: 'private',
    owner_id: userId,
    is_personal: true,
    created_at: now,
    updated_at: now,
  };
  mockCalendars.push(created);
  return created;
}

function visibleMockCalendarIds(): Set<string> {
  ensureMockPersonalCalendar();
  const userId = previewCanonicalUserId;
  if (!userId) return new Set();
  return new Set(
    mockCalendars
      .filter((calendar) => calendar.owner_id === userId || calendar.visibility === 'team')
      .map((calendar) => calendar.id),
  );
}

function getPreviewTodoStore(): PersonalTodoPreviewStore | null {
  if (!previewCanonicalUserId) return null;
  if (!previewTodoStore || previewTodoStore.userId !== previewCanonicalUserId) {
    previewTodoStore = createPersonalTodoPreviewStore(undefined, previewCanonicalUserId);
    previewTodoStore.subscribe(() => {
      const payload = { userId: previewCanonicalUserId, epoch: previewCanonicalEpoch };
      previewTodoCommitListeners.forEach((listener) => listener(payload));
    });
  }
  return previewTodoStore;
}

function toMarketRemoteState(snapshot: MarketSnapshot): MarketRemoteState {
  return {
    revision: snapshot.revision,
    account: structuredClone(snapshot.account),
    favoriteStockIds: [...snapshot.favoriteStockIds],
    beginnerMission: snapshot.beginnerMission,
    adminEvents: structuredClone(snapshot.adminEvents),
  };
}

function getPreviewMarketGateway(): MarketPreviewGateway {
  const user = previewCanonicalUserId
    ? getMockUsers().find((candidate) => candidate.id === previewCanonicalUserId)
    : null;
  if (user?.name !== '배한솔' || user.slackId !== 'U05DFV9UAN5') {
    throw new Error('배한솔 프리뷰 계정에서만 모의투자를 이용할 수 있어요.');
  }
  if (!previewMarketGateway || previewMarketUserId !== user.id) {
    previewMarketUserId = user.id;
    previewMarketGateway = createMarketLocalStorageGateway({
      userId: user.id,
      storage: window.localStorage,
      now: () => Date.now(),
    });
  }
  return previewMarketGateway;
}

function getPreviewArcadeGateway(): ArcadePreviewGateway {
  const user = previewCanonicalUserId
    ? getMockUsers().find((candidate) => candidate.id === previewCanonicalUserId)
    : null;
  if (user?.name !== '배한솔' || user.slackId !== 'U05DFV9UAN5') {
    throw new Error('배한솔 프리뷰 계정에서만 아케이드를 이용할 수 있어요.');
  }
  if (!previewArcadeGateway || previewArcadeUserId !== user.id) {
    previewArcadeUserId = user.id;
    previewArcadeGateway = createArcadeLocalStorageGateway({
      userId: user.id,
      storage: window.localStorage,
      now: () => Date.now(),
    });
  }
  return previewArcadeGateway;
}

const previewDailyLoginAttempts = new Set<string>();
// 프리뷰 세션 내 액팅 씬 phase 를 기억해, 실제 완료 전이일 때만 적립한다(프로덕션과 동일 게이팅).
const previewScenePhaseByUuid = new Map<string, string>();

// 프리뷰에는 main 프로세스가 없어 production 의 setCanonicalActivityUser → grantDailyLogin
// 흐름이 없다. 배한솔 프리뷰 세션이 확립되면 여기서 출석 적립을 미러링해, 자동 출석이
// 프리뷰/테스트 모드에서도 재현되게 한다(하루 1회, fire-and-forget, 서버 멱등에 의존).
function maybeGrantPreviewDailyLogin(): void {
  const user = previewCanonicalUserId
    ? getMockUsers().find((candidate) => candidate.id === previewCanonicalUserId)
    : null;
  if (user?.name !== '배한솔' || user.slackId !== 'U05DFV9UAN5') return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const key = `${user.id}|${today}`;
  if (previewDailyLoginAttempts.has(key)) return;
  void getPreviewArcadeGateway()
    .execute({ kind: 'daily-login', requestId: `daily-login:${today}` })
    .then(() => {
      previewDailyLoginAttempts.add(key);
    })
    .catch(() => {
      /* fire-and-forget — 다음 세션 트리거에서 재시도 */
    });
}

type PreviewActivityKind = 'scene-stage' | 'scene-phase-done' | 'comment' | 'retake-done';

// 프로덕션 arcadeService.activityRequestId 와 동일한 규칙(프리뷰/테스트 모드 패리티).
function previewActivityRequestId(activity: PreviewActivityKind, refId: string, stage?: string): string | null {
  switch (activity) {
    case 'scene-stage':
      return stage ? `scene-stage:${refId}:${stage}` : null;
    case 'scene-phase-done':
      return `scene-phase-done:${refId}`;
    case 'comment':
      return `comment:${refId}`;
    case 'retake-done':
      return `retake-done:${refId}`;
    default:
      return null;
  }
}

// 프리뷰에는 main 프로세스가 없어 production 의 활동 훅(awardActivity)이 없다. 씬 체크·완료·댓글·
// 리테이크 담당 완료 시 여기서 적립을 미러링하고, 성공하면 지갑 push 로 헤더 배지 획득 연출까지
// 재현한다(canonical 배한솔 한정, fire-and-forget, 서버 규칙과 같은 일일 상한은 게이트웨이가 처리).
function maybeAwardPreviewActivity(activity: PreviewActivityKind, refId: string, stage?: string): void {
  const user = previewCanonicalUserId
    ? getMockUsers().find((candidate) => candidate.id === previewCanonicalUserId)
    : null;
  if (user?.name !== '배한솔' || user.slackId !== 'U05DFV9UAN5') return;
  const requestId = previewActivityRequestId(activity, refId, stage);
  if (!requestId) return;
  void getPreviewArcadeGateway()
    .execute({ kind: 'activity', activity, requestId })
    .then((result) => {
      // 'awarded' 키는 activity 결과에만 있어 union 을 ArcadeActivityResult 로 좁힌다.
      // replayed(같은 requestId 재생)는 지갑 절대값이 그대로이므로 push/연출을 생략한다
      // — production ArcadeService.shouldApplyWallet 과 동일(프리뷰는 재시도 개념이 없음).
      if ('awarded' in result && result.awarded && result.points > 0 && !result.replayed) {
        useArcadeStore.getState().applyWalletPush({ wallet: result.wallet, delta: result.points, reason: activity });
      }
    })
    .catch(() => {
      /* fire-and-forget — 프리뷰 적립 실패는 무시 */
    });
}

// 프리뷰 씬 UUID → 소속 부서. 없으면 null(존재하지 않는 씬). scene-stage 는 BG 만 적립(프로덕션과 동일).
function findMockSceneDepartment(sceneUuid: string): string | null {
  for (const episode of getMockEpisodes()) {
    for (const part of episode.parts) {
      if (part.scenes.some((scene) => scene.id === sceneUuid)) return part.department;
    }
  }
  return null;
}

// 프리뷰 씬 UUID → 현재 액팅 phase(scene_state). phase Map 초기 시드에 쓴다 —
// 이미 done 인 씬의 첫 라운드 변경이 완료 적립을 오발하지 않도록(프로덕션은 DB 의 scene_state 로 판정).
function findMockSceneState(sceneUuid: string): string | null {
  for (const episode of getMockEpisodes()) {
    for (const part of episode.parts) {
      const scene = part.scenes.find((candidate) => candidate.id === sceneUuid);
      if (scene) return scene.sceneState ?? null;
    }
  }
  return null;
}

// 프리뷰 씬 UUID + 단계 → 현재 레거시 단계 값(true/false). 없는 씬은 null.
// 실제 false→true 전이만 적립하도록(이미 true 인 단계의 재체크·중복저장 오적립 방지, 프로덕션과 동일).
function findMockSceneStageValue(sceneUuid: string, stage: string): boolean | null {
  for (const episode of getMockEpisodes()) {
    for (const part of episode.parts) {
      const scene = part.scenes.find((candidate) => candidate.id === sceneUuid);
      if (scene) return (scene as unknown as Record<string, unknown>)[stage] === true;
    }
  }
  return null;
}

function previewNoSession<T>(data: T): { ok: false; kind: 'rejected'; code: string; message: string; retryable: false } {
  void data;
  return { ok: false, kind: 'rejected', code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.', retryable: false };
}

function previewCanonicalPayload() {
  const source = previewCanonicalUserId ? getMockUsers().find((user) => user.id === previewCanonicalUserId) : null;
  if (!source) return { user: null, session: null, epoch: previewCanonicalEpoch };
  const { password: _password, ...user } = source;
  return {
    user,
    session: { userId: user.id, userName: user.name, loggedInAt: new Date().toISOString() },
    epoch: previewCanonicalEpoch,
  };
}

function readRememberedPreviewUser(): string | null {
  try {
    if (typeof window !== 'undefined') return window.localStorage.getItem(PERSONAL_TODO_PREVIEW_SESSION_KEY) ?? null;
  } catch { /* private browsing/localStorage disabled — in-memory fallback remains valid */ }
  return previewRememberedUserId;
}

function writeRememberedPreviewUser(userId: string | null): void {
  previewRememberedUserId = userId;
  try {
    if (typeof window === 'undefined') return;
    if (userId) window.localStorage.setItem(PERSONAL_TODO_PREVIEW_SESSION_KEY, userId);
    else window.localStorage.removeItem(PERSONAL_TODO_PREVIEW_SESSION_KEY);
  } catch { /* private browsing/localStorage disabled */ }
}

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
      {
        type: 'character-board',
        key: 'work-folder-root',
        value: 'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅',
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
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
    && typeof api?.createLocalUser === 'function'
    && typeof api?.readSettings === 'function'
    && typeof api?.writeSettings === 'function'
    && typeof api?.supabaseTestConnection === 'function'
    && typeof api?.supabaseReadAll === 'function'
    && typeof api?.calendarList === 'function'
    && typeof api?.calendarCreate === 'function'
    && typeof api?.calendarUpdate === 'function'
    && typeof api?.calendarDelete === 'function'
    && typeof api?.calendarSetMembers === 'function'
    && typeof api?.calendarEventsList === 'function'
    && typeof api?.calendarEventCreate === 'function'
    && typeof api?.calendarEventUpdate === 'function'
    && typeof api?.calendarEventDelete === 'function'
    && typeof api?.calendarTagsList === 'function'
    && typeof api?.calendarTagsSave === 'function'
    && typeof api?.calendarNotificationsCatchup === 'function'
    && typeof api?.calendarNotificationsMarkRead === 'function';
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

function getMockSceneWorkLinks(): SceneWorkLink[] {
  return (localStore.__sceneWorkLinks as SceneWorkLink[] | undefined)
    ?? (localStore.__sceneWorkLinks = []) as SceneWorkLink[];
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

// ─── 캐릭터 현황판 mock 시드 ──────────────────────────────
// preview 에서 보드/검색/에피소드탭이 비지 않도록 샘플 2~3 캐릭터 + 복장 + 태그 + 에피소드 연결.
const MOCK_CHARACTER_EP = 5; // MOCK_EPISODES 에 존재하는 유일 에피소드(EP05).
const MOCK_CHARACTER_IMAGE_URL = '/splash/opening_image_cropped.png';

function seedMockCharacterData(): void {
  if (localStore.__characters !== undefined) return; // 이미 시드/조작됨

  const now = '2026-06-10T00:00:00.000Z';
  const chars = [
    { id: 'mock-char-1', name: '한솔', memo: '주인공' },
    { id: 'mock-char-2', name: '삐쭈', memo: null },
    { id: 'mock-char-3', name: '혜원', memo: null },
  ].map((c, i) => ({
    id: c.id, name: c.name, status: 'active', memo: c.memo,
    work_folder_path: 'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\한솔',
    reference_height_px: [500, 600, 650][i] ?? null, // T2-3: 키 비교 보기 샘플
    sort_order: i, created_at: now, updated_at: now, created_by: '1',
  }));

  const costumes = [
    // 한솔: 교복(핸드폰 보유), 사복
    {
      id: 'mock-cos-1a', character_id: 'mock-char-1', name: '교복', version_no: 2,
      design_stage: 'done', rigging_stage: 'rigging',
      structure_tags: ['얼굴각도 컨트롤러'], asset_tags: ['핸드폰', '안경'],
    },
    {
      id: 'mock-cos-1b', character_id: 'mock-char-1', name: '사복', version_no: 1,
      design_stage: 'in_progress', rigging_stage: 'waiting',
      structure_tags: [], asset_tags: ['가방'],
    },
    // 삐쭈: 사복(핸드폰 보유)
    {
      id: 'mock-cos-2a', character_id: 'mock-char-2', name: '사복', version_no: 1,
      design_stage: 'feedback', rigging_stage: 'vectorized',
      structure_tags: ['입 모양 컨트롤러'], asset_tags: ['핸드폰'],
    },
    // 혜원: 체육복 (핸드폰 없음)
    {
      id: 'mock-cos-3a', character_id: 'mock-char-3', name: '체육복', version_no: 3,
      design_stage: 'done', rigging_stage: 'done',
      structure_tags: ['얼굴각도 컨트롤러'], asset_tags: ['물병'],
    },
  ].map((c, i) => ({
    ...c,
    featured_image_url: MOCK_CHARACTER_IMAGE_URL,
    work_file_path: 'G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\한솔\\[드라마 퀄리티] 한솔 SWver12.moho',
    image_background: 'transparent',
    image_fit: { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, lockAspect: true },
    design_assignee: '허혜원',
    rigging_assignee: '배한솔',
    assignee: null,
    memo: null,
    due_date: [null, '2026-07-10', null, '2026-07-06'][i] ?? null, // T2-4: 마감 배지 샘플
    height_px: i === 1 ? 700 : null, // 피드백 47: 복장 키 오버라이드 샘플(나머지는 대표 키를 따름)
    sort_order: i, created_at: now, updated_at: now, created_by: '1',
  }));

  // 한솔·삐쭈를 EP05 에 연결 (혜원은 미연결 → '등장 캐릭터 추가' 후보로 남김).
  const charEpMap = [
    {
      id: 'mock-map-1', episode_id: `mock-ep-${MOCK_CHARACTER_EP}`, character_id: 'mock-char-1',
      episode_number: MOCK_CHARACTER_EP, memo: '이 화에서는 교복에 안경 착용', costume_id: 'mock-cos-1a', costume_ids: ['mock-cos-1a'], created_at: now,
    },
    {
      id: 'mock-map-2', episode_id: `mock-ep-${MOCK_CHARACTER_EP}`, character_id: 'mock-char-2',
      episode_number: MOCK_CHARACTER_EP, memo: null, costume_id: null, costume_ids: [], created_at: now,
    },
  ];

  // 복장 다중 이미지 시드 — 각 mock 복장의 featured_image_url 을 대표(primary) 이미지 1장으로.
  const costumeImages = costumes.map((c) => ({
    id: `mock-cimg-${c.id}`,
    costume_id: c.id,
    url: c.featured_image_url,
    role: 'design',
    label: null,
    image_background: c.image_background,
    image_fit: c.image_fit,
    is_primary: true,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    created_by: '1',
  }));

  localStore.__characters = chars;
  localStore.__costumes = costumes;
  localStore.__costumeImages = costumeImages;
  localStore.__charEpMap = charEpMap;
}

/**
 * 프리뷰/mock: 라이브 DB 의 sync_costume_featured_image 트리거를 흉내 —
 * primary 이미지 값을 __costumes 의 featured_* 에 반영(없으면 null)해, 리로드 후에도 카드가 최신 대표를 보이게 한다(코덱스 P2).
 */
function mockSyncCostumeFeatured(costumeId: string): void {
  const images = ((localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [])
    .filter((r) => r.costume_id === costumeId);
  const costume = ((localStore.__costumes as Record<string, unknown>[] | undefined) ?? [])
    .find((c) => c.id === costumeId);
  if (!costume) return;
  // 대표가 없는데 남은 이미지가 있으면 최소 순서를 자동 승격(라이브 트리거와 동일 — 대표 삭제 후 featured 유실 방지, 코덱스 P2).
  let primary = images.find((r) => r.is_primary) ?? null;
  if (!primary && images.length > 0) {
    const promote = [...images].sort(
      (a, b) => ((a.sort_order as number) ?? 0) - ((b.sort_order as number) ?? 0),
    )[0];
    promote.is_primary = true;
    primary = promote;
  }
  costume.featured_image_url = primary ? primary.url : null;
  if (primary) {
    costume.image_background = primary.image_background;
    costume.image_fit = primary.image_fit;
  }
  costume.updated_at = new Date().toISOString();
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
    shellOpenPath: async (targetPath: string) => (
      targetPath.includes('missing')
        ? { ok: false, error: 'not found' }
        : { ok: true }
    ),
    chooseFolderPath: async () => 'G:\\공유 드라이브\\JBBJ\\A_014',
    chooseFilePath: async () => 'G:\\공유 드라이브\\JBBJ\\A_014\\main.psd',
    pathCreateFolder: async (parentPath: string, folderName: string) => ({
      ok: true,
      path: `${parentPath.replace(/[\\/]+$/, '')}\\${folderName.replace(/[\\/:*?"<>|]/g, '').trim() || '새 캐릭터'}`,
      existed: false,
    }),
    pathDirname: async (targetPath: string) => {
      const normalized = targetPath.trim().replace(/[\\/]+$/, '');
      const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
      return index > 0 ? normalized.slice(0, index) : '';
    },
    pathExists: async (targetPath: string) => !targetPath.includes('missing'),

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
      users: getMockUsers().map(u => ({
        id: u.id, name: u.name, slackId: u.slackId,
        isInitialPassword: u.isInitialPassword,
        createdAt: u.createdAt, role: u.role,
      })),
    }),
    ...({ usersWrite: async () => true } as Partial<ElectronAPI>),
    createLocalUser: async (input) => {
      const user: PreviewUser = {
        id: createUuid(), ...input, password: '1234', isInitialPassword: true,
        createdAt: new Date().toISOString(), role: 'user',
      };
      getMockUsers().push(user);
      const { password: _password, ...publicUser } = user;
      return publicUser;
    },
    deleteLocalUser: async (userId) => {
      localStore.__users = getMockUsers().filter((user) => user.id !== userId);
    },

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
      // 실제 완료 전이(이전 상태 ≠ done)일 때만 적립 — 이미 done 인 씬의 라운드 변경은 제외.
      // Map 이 비었으면 mock 씬의 현재 phase 로 시드해, 이미 done 인 씬의 첫 호출이 오적립되지 않게 한다.
      const previousState = previewScenePhaseByUuid.get(sceneUuid) ?? findMockSceneState(sceneUuid) ?? null;
      previewScenePhaseByUuid.set(sceneUuid, sceneState);
      if (sceneState === 'done' && previousState !== 'done') {
        maybeAwardPreviewActivity('scene-phase-done', sceneUuid);
      }
    },
    supabaseDispatchFeedbackNotification: async (payload) => {
      console.log('[DEV] supabaseDispatchFeedbackNotification:', payload);
    },
    supabaseDispatchRetakeAssigneeCompletionNotification: async (payload) => {
      console.log('[DEV] supabaseDispatchRetakeAssigneeCompletionNotification:', payload);
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
    widgetNavigateMain: async () => {},
    onWidgetNavigateMain: noop,
    widgetNavigateToDate: async () => {},
    onWidgetNavigateToDate: noop,

    imageSave: async () => '/dev/mock-image.png',
    imageDelete: async () => true,
    imageGetDir: async () => '/dev/images',
    clipboardReadImage: async () => null,
    clipboardReadImageFile: async () => null,

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
    supabaseUpdateEpisodeReelPath: async (episodeNumber, reelFilePath) => {
      const episodes = getMockEpisodes();
      const episode = episodes.find((item) => item.episodeNumber === episodeNumber);
      if (episode) {
        (episode as Episode & { reelFilePath?: string | null }).reelFilePath = reelFilePath;
        localStore.__mockEpisodes = episodes;
      }
    },
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
    supabaseUpdateSceneStage: async (sceneUuid, stage, value) => {
      // 실제 BG 씬의 false→true 전이일 때만 단계 적립 — 없는 씬/ACT 씬/이미 true 인 단계는 제외(프로덕션과 동일).
      if (
        value === true
        && findMockSceneDepartment(sceneUuid) === 'bg'
        && findMockSceneStageValue(sceneUuid, stage) === false
      ) {
        maybeAwardPreviewActivity('scene-stage', sceneUuid, stage);
      }
    },
    supabaseReadSceneWorkLinks: async (sceneUuids?: string[]) => {
      const links = getMockSceneWorkLinks();
      if (!sceneUuids?.length) return links;
      return links.filter((link) => sceneUuids.includes(link.sceneUuid));
    },
    supabaseUpsertSceneWorkLink: async (input) => {
      const links = getMockSceneWorkLinks();
      const now = new Date().toISOString();
      const existing = links.find((link) =>
        link.sceneUuid === input.sceneUuid
        && link.department === input.department
        && link.linkKind === input.linkKind
      );
      if (existing) {
        existing.path = input.path.trim();
        existing.label = input.label ?? null;
        existing.sortOrder = input.sortOrder ?? 0;
        existing.updatedBy = input.userId ?? null;
        existing.updatedAt = now;
        localStore.__sceneWorkLinks = links;
        return existing;
      }
      const created: SceneWorkLink = {
        id: createUuid(),
        sceneUuid: input.sceneUuid,
        department: input.department,
        linkKind: input.linkKind,
        path: input.path.trim(),
        label: input.label ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdBy: input.userId ?? null,
        createdAt: now,
        updatedBy: input.userId ?? null,
        updatedAt: now,
      };
      links.push(created);
      localStore.__sceneWorkLinks = links;
      return created;
    },
    supabaseDeleteSceneWorkLink: async (sceneUuid, department, linkKind) => {
      localStore.__sceneWorkLinks = getMockSceneWorkLinks().filter((link) =>
        !(link.sceneUuid === sceneUuid && link.department === department && link.linkKind === linkKind)
      );
    },
    supabaseBulkUpdateSceneStages: async (updates) => updates.map((u) => ({ sceneUuid: u.sceneUuid, success: true })),
    supabaseBulkDeleteScenes: async (sceneUuids) => sceneUuids.map((id) => ({ sceneUuid: id, success: true })),
    supabaseBulkUpdateSceneFields: async (updates) => updates.map((u) => ({ sceneUuid: u.sceneUuid, success: true })),
    supabaseUpdateSceneField: async () => {},
    supabaseReadUsers: async () => ({
      status: 'authoritative',
      users: getMockUsers().map(u => ({
        id: u.id, name: u.name, slackId: u.slackId,
        isInitialPassword: u.isInitialPassword,
        createdAt: u.createdAt, role: u.role,
        isCompositor: u.isCompositor ?? false,
        isActingSupervisor: u.isActingSupervisor ?? false,
      })),
    }),
    supabaseAddUser: async () => {},
    supabaseUpdateUser: async (userId, updates) => {
      // role / boolean 토글 등을 mock 사용자 목록에 반영 (preview 검증용).
      const user = getMockUsers().find((u) => u.id === userId);
      if (!user) return;
      if (updates.role !== undefined) user.role = updates.role as string;
      if (updates.isCompositor !== undefined) user.isCompositor = updates.isCompositor as boolean;
      if (updates.isActingSupervisor !== undefined) user.isActingSupervisor = updates.isActingSupervisor as boolean;
    },
    supabaseDeleteUser: async () => {},
    supabaseReadComments: async (partUuid) => getMockCommentRows().filter((comment) => comment.partId === partUuid && !comment.characterId),
    supabaseReadCommentsForCharacter: async (characterId) => getMockCommentRows().filter((comment) => comment.characterId === characterId),
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
    supabaseAddComment: async (commentId, partUuid, sceneId, userId, userName, text, mentions, createdAt, images, revisionId, parentCommentId, characterId, costumeId) => {
      const comments = getMockCommentRows();
      comments.push({
        id: commentId,
        // 캐릭터 댓글이면 part/scene 비우고 character_id 채움 (라이브 DB 동작 미러).
        partId: characterId ? '' : partUuid,
        sceneId: characterId ? '' : sceneId,
        characterId: characterId ?? null,
        costumeId: costumeId ?? null,
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
      // 댓글(일반·리테이크·캐릭터 보드 전부) 적립(spec §, 프로덕션 main.ts 와 동일).
      maybeAwardPreviewActivity('comment', commentId);
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
    supabaseAddPrivateEvent: async () => ({ id: createUuid() }),
    supabaseUpdatePrivateEvent: async () => {},
    supabaseDeletePrivateEvent: async () => {},
    // ─── B flow 공유 캘린더 (프리뷰 in-memory) ───
    calendarList: async () => {
      const visibleIds = visibleMockCalendarIds();
      const userId = previewCanonicalUserId;
      return mockCalendars
        .filter((calendar) => visibleIds.has(calendar.id))
        .map((calendar) => ({
          ...calendar,
          members: [],
          can_edit: calendar.owner_id === userId,
          can_manage: calendar.owner_id === userId,
        }));
    },
    calendarCreate: async (input) => {
      const userId = previewCanonicalUserId;
      if (!userId) throw new Error('로그인이 필요합니다');
      const now = new Date().toISOString();
      const created: MockCalendarRow = {
        id: createUuid(),
        name: input.name,
        color: input.color,
        visibility: input.visibility,
        owner_id: userId,
        is_personal: false,
        created_at: now,
        updated_at: now,
      };
      mockCalendars.push(created);
      return { ...created };
    },
    calendarUpdate: async (id, updates) => {
      const calendar = mockCalendars.find((candidate) => candidate.id === id);
      if (!calendar) return;
      if (updates.name !== undefined) calendar.name = updates.name;
      if (updates.color !== undefined) calendar.color = updates.color;
      if (!calendar.is_personal && updates.visibility !== undefined) {
        calendar.visibility = updates.visibility;
      }
      calendar.updated_at = new Date().toISOString();
    },
    calendarDelete: async (id) => {
      const index = mockCalendars.findIndex((calendar) => calendar.id === id);
      if (index >= 0) mockCalendars.splice(index, 1);
      for (let eventIndex = mockCalendarEvents.length - 1; eventIndex >= 0; eventIndex--) {
        if (mockCalendarEvents[eventIndex].calendar_id === id) {
          mockCalendarEvents.splice(eventIndex, 1);
        }
      }
    },
    calendarSetMembers: async () => {},
    calendarEventsList: async (params) => {
      const visibleIds = visibleMockCalendarIds();
      return mockCalendarEvents
        .filter((event) => visibleIds.has(event.calendar_id))
        .filter((event) => !params?.from || event.end_date >= params.from)
        .filter((event) => !params?.to || event.start_date <= params.to)
        .map((event) => ({ ...event }));
    },
    calendarEventCreate: async (input) => {
      const now = new Date().toISOString();
      const created: MockCalendarEventRow = {
        ...input,
        id: createUuid(),
        created_by: previewCanonicalUserId,
        created_at: now,
        updated_at: now,
      };
      mockCalendarEvents.push(created);
      return { ...created };
    },
    calendarEventUpdate: async (id, updates) => {
      const event = mockCalendarEvents.find((candidate) => candidate.id === id);
      if (!event) throw new Error('일정을 찾을 수 없습니다');
      const immutableFields = {
        id: event.id,
        created_by: event.created_by,
        created_at: event.created_at,
      };
      Object.assign(event, updates, immutableFields, { updated_at: new Date().toISOString() });
      return { ...event };
    },
    calendarEventDelete: async (id) => {
      const index = mockCalendarEvents.findIndex((event) => event.id === id);
      if (index >= 0) mockCalendarEvents.splice(index, 1);
    },
    calendarTagsList: async () => mockCalendarTags.map((tag) => ({ ...tag })),
    calendarTagsSave: async (tags) => {
      const saved = tags.map((tag) => ({
        id: tag.id ?? createUuid(),
        name: tag.name,
        color: tag.color,
        sort_order: tag.sort_order,
      }));
      mockCalendarTags.splice(0, mockCalendarTags.length, ...saved);
      return saved.map((tag) => ({ ...tag }));
    },
    calendarNotificationsCatchup: async () => [],
    calendarNotificationsMarkRead: async () => {},
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
      setId?: string,
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
        setId: setId ?? null,
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

      // 리테이크 담당 완료 전이에서만 적립(프로덕션 main.ts 의 statusActionType 우선순위와 동일 조건).
      if (
        updates.__op !== 'revert_final'
        && !updates.finalResolvedAt
        && updates.__op !== 'reassign'
        && updates.status === 'assignee_done'
      ) {
        maybeAwardPreviewActivity('retake-done', id);
      }

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
    onSupabasePresence: noop,
    getPresenceSnapshot: async () => ({}),
    onSupabaseStatus: noop,
    onSupabaseBroadcast: noop,

    // ─── Playground market mock (same user-scoped localStorage adapter) ───
    marketRead: async () => toMarketRemoteState(await getPreviewMarketGateway().read()),
    marketExecute: async (command) => toMarketRemoteState(
      await getPreviewMarketGateway().execute(command),
    ),
    marketCreateAdminEvent: async (input) => toMarketRemoteState(
      await getPreviewMarketGateway().createAdminEvent(input),
    ),
    marketDeleteAdminEvent: async (eventId) => toMarketRemoteState(
      await getPreviewMarketGateway().deleteAdminEvent(eventId),
    ),

    // ─── Playground arcade mock (same user-scoped localStorage adapter) ───
    arcadeRead: async () => getPreviewArcadeGateway().read(),
    arcadeExecute: async (command) => getPreviewArcadeGateway().execute(command),
    onArcadeWalletUpdated: noop,
    onPlaygroundNativeBack: noop,

    // ─── Personal Todos / Task Views mock ───
    ensureCanonicalSession: async () => {
      if (!previewCanonicalUserId) previewCanonicalUserId = readRememberedPreviewUser();
      maybeGrantPreviewDailyLogin();
      return { ok: true, payload: previewCanonicalPayload() };
    },
    loginCanonicalSession: async (input) => {
      const user = getMockUsers().find((candidate) => candidate.name === input.name);
      if (!user || user.password !== input.password) {
        return { ok: false, payload: previewCanonicalPayload(), error: '이름 또는 비밀번호가 일치하지 않습니다.' };
      }
      if (previewCanonicalUserId !== user.id) previewCanonicalEpoch++;
      previewCanonicalUserId = user.id;
      writeRememberedPreviewUser(input.rememberMe === false ? null : user.id);
      maybeGrantPreviewDailyLogin();
      return { ok: true, payload: previewCanonicalPayload() };
    },
    restoreCanonicalSession: async () => {
      if (!previewCanonicalUserId && readRememberedPreviewUser()) {
        previewCanonicalUserId = readRememberedPreviewUser();
        previewCanonicalEpoch++;
      }
      maybeGrantPreviewDailyLogin();
      return { ok: true, payload: previewCanonicalPayload() };
    },
    logoutCanonicalSession: async () => {
      if (previewCanonicalUserId) previewCanonicalEpoch++;
      previewCanonicalUserId = null;
      writeRememberedPreviewUser(null);
      return { ok: true, payload: previewCanonicalPayload() };
    },
    refreshCanonicalUser: async () => ({ ok: true, payload: previewCanonicalPayload() }),
    changeOwnPassword: async (input) => {
      const user = getMockUsers().find((candidate) => candidate.id === previewCanonicalUserId);
      if (!user) return { ok: false, error: '로그인이 필요합니다.' };
      if (user.password !== input.currentPassword) return { ok: false, error: '현재 비밀번호가 일치하지 않습니다.' };
      user.password = input.newPassword;
      user.isInitialPassword = false;
      return { ok: true };
    },
    readPersonalTodos: async () => {
      const store = getPreviewTodoStore();
      return store ? { ok: true as const, data: store.readTodos().map((todo, sortOrder) => ({ ...todo, userId: store.userId, startDate: todo.startDate ?? null, endDate: todo.endDate ?? null, addToCalendar: todo.addToCalendar ?? false, sortOrder, updatedAt: todo.createdAt })) } : previewNoSession([]);
    },
    readPersonalTodoLabels: async () => {
      const store = getPreviewTodoStore();
      return store ? { ok: true as const, data: store.readLabels().map((label) => ({ ...label, updatedAt: label.createdAt })) } : previewNoSession([]);
    },
    createPersonalTodo: async (input) => {
      const store = getPreviewTodoStore();
      return store ? { ok: true as const, data: store.createTodo(input) } : previewNoSession([]);
    },
    patchPersonalTodo: async (todoId, patch) => {
      const store = getPreviewTodoStore();
      try { return store ? { ok: true as const, data: store.patchTodo(todoId, patch) } : previewNoSession(null); }
      catch { return { ok: false as const, kind: 'rejected' as const, code: 'NOT_FOUND', message: 'not found', retryable: false as const }; }
    },
    applyCalendarToTodoPatch: async (todoId, patch) => {
      const store = getPreviewTodoStore();
      try { return store ? { ok: true as const, data: store.applyCalendarToTodoPatch(todoId, patch) } : previewNoSession(null); }
      catch { return { ok: false as const, kind: 'rejected' as const, code: 'NOT_FOUND', message: 'not found', retryable: false as const }; }
    },
    mutatePersonalTodoOrder: async (mutation, orderedIds) => {
      const store = getPreviewTodoStore();
      try { return store ? { ok: true as const, data: store.mutateOrder(mutation, orderedIds) } : previewNoSession([]); }
      catch { return { ok: false as const, kind: 'rejected' as const, code: 'NOT_FOUND', message: 'not found', retryable: false as const }; }
    },
    deletePersonalTodo: async (todoId) => {
      const store = getPreviewTodoStore();
      return store ? { ok: true as const, data: store.deleteTodo(todoId) } : previewNoSession([]);
    },
    createOrReusePersonalTodoLabelAndAttach: async (input) => {
      const store = getPreviewTodoStore();
      try { return store ? { ok: true as const, data: store.createOrReuseLabelAndAttach(input) } : previewNoSession(null); }
      catch { return { ok: false as const, kind: 'rejected' as const, code: 'NOT_FOUND', message: 'not found', retryable: false as const }; }
    },
    updatePersonalTodoLabel: async (labelId, patch) => {
      const store = getPreviewTodoStore();
      try { return store ? { ok: true as const, data: store.updateLabel(labelId, patch) } : previewNoSession(null); }
      catch { return { ok: false as const, kind: 'rejected' as const, code: 'NOT_FOUND', message: 'not found', retryable: false as const }; }
    },
    readLegacyTaskViews: async () => ({ ok: true, data: null }),
    upsertLegacyTaskViews: async () => ({ ok: true, data: undefined }),
    retryPersonalTodoCalendar: async () => ({ ok: true as const, data: undefined }),
    onPersonalTodoCommit: (callback) => {
      previewTodoCommitListeners.add(callback);
      return () => previewTodoCommitListeners.delete(callback);
    },

    // ─── Memos mock ───
    supabaseReadMemo: async () => null,
    supabaseUpsertMemo: async () => {},
    supabaseReadAllMemos: async () => [],

    // ─── 슬랙 웹훅 (콘솔 로그) ───
    sendSlackWebhook: async (payload: Record<string, string>) => {
      console.log('[DEV 슬랙 웹훅] 페이로드:', JSON.stringify(payload, null, 2));
      return { ok: true };
    },
    sendRiggingWebhook: async (payload: Record<string, string>) => {
      console.log('[DEV 리깅 공지 웹훅] 페이로드:', JSON.stringify(payload, null, 2));
      return { ok: true };
    },
    onDeepLink: noop,

    // ─── Google Calendar mock ───
    gcalIsAuthenticated: async () => false,
    gcalStartAuth: async () => {},
    gcalSaveCredentials: async () => {},
    gcalHasCredentials: async () => false,
    gcalSaveLocalSettings: async () => {},
    gcalSignOut: async () => {},
    gcalListCalendars: async () => [],
    gcalFullSync: async () => [],
    gcalIncrementalSync: async () => ({ updated: [], deleted: [], isFullSync: false }),
    gcalInsertEvent: async () => `mock_${createUuid()}`,
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
        id: idx >= 0 ? compStore[idx].id : createUuid(),
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

    // ─── 캐릭터 현황판 탭·그룹 (mock, 피드백 41) ───
    supabaseLoadCharacterBoardTabs: async () => {
      const store = (localStore.__characterTabs as Record<string, unknown>[] | undefined)
        ?? (localStore.__characterTabs = [] as Record<string, unknown>[]);
      return store as unknown[];
    },
    supabaseAddCharacterBoardTab: async (input: { name: string; sortOrder: number; createdBy?: string | null }) => {
      const store = (localStore.__characterTabs as Record<string, unknown>[] | undefined)
        ?? (localStore.__characterTabs = [] as Record<string, unknown>[]);
      const now = new Date().toISOString();
      const row = {
        id: createUuid(), name: input.name, sort_order: input.sortOrder, groups: [],
        created_by: input.createdBy ?? null, created_at: now, updated_at: now,
      };
      store.push(row);
      return row;
    },
    supabaseUpdateCharacterBoardTab: async (id: string, updates: Record<string, unknown>) => {
      const store = (localStore.__characterTabs as Record<string, unknown>[] | undefined) ?? [];
      const row = store.find((r) => r.id === id) ?? null;
      if (row) Object.assign(row, updates, { updated_at: new Date().toISOString() });
      return row;
    },
    supabaseDeleteCharacterBoardTab: async (id: string) => {
      const store = (localStore.__characterTabs as Record<string, unknown>[] | undefined) ?? [];
      const idx = store.findIndex((r) => r.id === id);
      if (idx >= 0) store.splice(idx, 1);
      return { ok: true };
    },

    // ─── 캐릭터 현황판 (mock) ───
    supabaseLoadCharacters: async () => {
      seedMockCharacterData();
      return localStore.__characters as unknown[];
    },
    supabaseLoadCharacterCostumes: async () => {
      seedMockCharacterData();
      return localStore.__costumes as unknown[];
    },
    supabaseLoadEpisodeCharacterMap: async () => {
      seedMockCharacterData();
      return localStore.__charEpMap as unknown[];
    },
    supabaseAddCharacter: async (input) => {
      const store = (localStore.__characters as Record<string, unknown>[] | undefined)
        ?? (localStore.__characters = [] as Record<string, unknown>[]);
      const now = new Date().toISOString();
      const row = {
        id: createUuid(), name: input.name, status: 'active', memo: input.memo ?? null,
        work_folder_path: null,
        sort_order: store.length, created_at: now, updated_at: now, created_by: input.createdBy ?? null,
      };
      store.push(row);
      return row;
    },
    supabaseUpdateCharacter: async (id, updates) => {
      const store = (localStore.__characters as Record<string, unknown>[] | undefined) ?? [];
      const row = store.find((r) => r.id === id);
      if (row) Object.assign(row, updates, { updated_at: new Date().toISOString() });
      return row ?? { id };
    },
    supabaseDeleteCharacter: async (id) => {
      const removedCostumeIds = new Set(
        ((localStore.__costumes as Record<string, unknown>[] | undefined) ?? [])
          .filter((r) => r.character_id === id).map((r) => r.id),
      );
      localStore.__characters = ((localStore.__characters as Record<string, unknown>[] | undefined) ?? [])
        .filter((r) => r.id !== id);
      localStore.__costumes = ((localStore.__costumes as Record<string, unknown>[] | undefined) ?? [])
        .filter((r) => r.character_id !== id);
      localStore.__costumeImages = ((localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [])
        .filter((r) => !removedCostumeIds.has(r.costume_id));
    },
    supabaseAddCostume: async (input) => {
      const store = (localStore.__costumes as Record<string, unknown>[] | undefined)
        ?? (localStore.__costumes = [] as Record<string, unknown>[]);
      const now = new Date().toISOString();
      const row = {
        id: createUuid(), character_id: input.characterId, name: input.name, version_no: 1,
        design_stage: 'waiting', rigging_stage: 'waiting', featured_image_url: null,
        work_file_path: null,
        image_background: 'transparent',
        image_fit: { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, lockAspect: true },
        structure_tags: [], asset_tags: [], design_assignee: null, rigging_assignee: null, assignee: null, memo: null,
        sort_order: store.filter((r) => r.character_id === input.characterId).length,
        created_at: now, updated_at: now, created_by: input.createdBy ?? null,
      };
      store.push(row);
      return row;
    },
    supabaseUpdateCostume: async (id, updates) => {
      const store = (localStore.__costumes as Record<string, unknown>[] | undefined) ?? [];
      const row = store.find((r) => r.id === id);
      if (row) Object.assign(row, updates, { updated_at: new Date().toISOString() });
      return row ?? { id };
    },
    supabaseDeleteCostume: async (id) => {
      localStore.__costumes = ((localStore.__costumes as Record<string, unknown>[] | undefined) ?? [])
        .filter((r) => r.id !== id);
      localStore.__costumeImages = ((localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [])
        .filter((r) => r.costume_id !== id);
    },
    supabaseLinkCharacterEpisode: async (episodeNumber, characterId) => {
      seedMockCharacterData();
      const store = localStore.__charEpMap as Record<string, unknown>[];
      // UPSERT 패리티 — 이미 있으면 중복 추가하지 않음.
      const existing = store.find((r) => r.episode_number === episodeNumber && r.character_id === characterId);
      if (existing) return existing;
      const row = {
        id: createUuid(), episode_id: `mock-ep-${episodeNumber}`, character_id: characterId,
        episode_number: episodeNumber, memo: null, costume_id: null, costume_ids: [], created_at: new Date().toISOString(),
      };
      store.push(row);
      return row;
    },
    supabaseUnlinkCharacterEpisode: async (episodeNumber, characterId) => {
      seedMockCharacterData();
      localStore.__charEpMap = (localStore.__charEpMap as Record<string, unknown>[])
        .filter((r) => !(r.episode_number === episodeNumber && r.character_id === characterId));
    },
    supabaseUpdateEpisodeCharacterMap: async (episodeNumber, characterId, updates) => {
      seedMockCharacterData();
      const store = localStore.__charEpMap as Record<string, unknown>[];
      const row = store.find((r) => r.episode_number === episodeNumber && r.character_id === characterId);
      if (!row) return;
      if (updates.memo !== undefined) row.memo = updates.memo;
      if (updates.costumeIds !== undefined) {
        row.costume_ids = updates.costumeIds;
        row.costume_id = updates.costumeIds[0] ?? null;
      }
    },
    // 프리뷰에서 업로드/붙여넣기 이미지가 실제로 렌더되도록 로드 가능한 경로를 돌려준다 (피드백 31b·33 검증용).
    storageUploadCharacterImage: async () => ({ ok: true, url: MOCK_CHARACTER_IMAGE_URL }),
    // ─── 복장 다중 이미지 (mock) ───
    supabaseLoadCostumeImages: async () => {
      seedMockCharacterData();
      return localStore.__costumeImages as unknown[];
    },
    supabaseAddCostumeImage: async (input) => {
      const store = (localStore.__costumeImages as Record<string, unknown>[] | undefined)
        ?? (localStore.__costumeImages = [] as Record<string, unknown>[]);
      const now = new Date().toISOString();
      const siblings = store.filter((r) => r.costume_id === input.costumeId);
      const row = {
        id: createUuid(), costume_id: input.costumeId, url: input.url,
        role: input.role ?? 'design', label: null,
        image_background: input.imageBackground ?? 'transparent',
        image_fit: input.imageFit ?? { scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, lockAspect: true },
        natural_width: input.naturalWidth ?? null,
        natural_height: input.naturalHeight ?? null,
        is_primary: input.isPrimary ?? false,
        sort_order: input.sortOrder ?? siblings.length,
        created_at: now, updated_at: now, created_by: input.createdBy ?? null,
      };
      store.push(row);
      mockSyncCostumeFeatured(input.costumeId);
      return row;
    },
    supabaseUpdateCostumeImage: async (id, updates) => {
      const store = (localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [];
      const row = store.find((r) => r.id === id);
      if (row) {
        Object.assign(row, updates, { updated_at: new Date().toISOString() });
        mockSyncCostumeFeatured(row.costume_id as string);
      }
      return row ?? { id };
    },
    supabaseDeleteCostumeImage: async (id) => {
      const all = (localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [];
      const removed = all.find((r) => r.id === id);
      localStore.__costumeImages = all.filter((r) => r.id !== id);
      if (removed) mockSyncCostumeFeatured(removed.costume_id as string);
    },
    supabaseSetPrimaryCostumeImage: async (costumeId, imageId) => {
      const store = (localStore.__costumeImages as Record<string, unknown>[] | undefined) ?? [];
      for (const r of store) {
        if (r.costume_id === costumeId) r.is_primary = r.id === imageId;
      }
      mockSyncCostumeFeatured(costumeId);
    },
    onCharacterBoardRealtime: noop,
  };

  (window as Window & typeof globalThis).electronAPI = mockAPI;
  document.documentElement.dataset.devElectronApi = 'installed';
}
