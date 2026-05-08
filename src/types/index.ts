// ─── 부서 (Department) ──────────────────────

export type Department = 'bg' | 'acting';
export type ScenesDeptFilter = Department | 'all';

export const DEPARTMENTS: Department[] = ['bg', 'acting'];

export interface DepartmentConfig {
  id: Department;
  label: string;
  shortLabel: string;
  stageLabels: Record<Stage, string>;
  stageColors: Record<Stage, string>;
  color: string;
}

export const DEPARTMENT_CONFIGS: Record<Department, DepartmentConfig> = {
  bg: {
    id: 'bg',
    label: '배경',
    shortLabel: 'BG',
    stageLabels: { lo: 'LO', done: '완료', review: '검수', png: 'PNG' },
    stageColors: { lo: '#C4BCFA', done: '#A599F5', review: '#8677EF', png: '#6C5CE7' },
    color: '#6C5CE7',
  },
  acting: {
    id: 'acting',
    label: '액팅',
    shortLabel: 'ACT',
    stageLabels: { lo: '1원화', done: '2원화', review: '동화', png: '최종' },
    stageColors: { lo: '#F5BEB3', done: '#EDA293', review: '#E58A76', png: '#E17055' },
    color: '#E17055',
  },
};

// ─── 진행 단계 ──────────────────────────────

export type Stage = 'lo' | 'done' | 'review' | 'png';

export const STAGES: Stage[] = ['lo', 'done', 'review', 'png'];

/** BG 기본 단계 라벨 (부서별 라벨은 DEPARTMENT_CONFIGS[dept].stageLabels) */
export const STAGE_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완료',
  review: '검수',
  png: 'PNG',
};

/** BG 기본 단계 컬러 (부서별 컬러는 DEPARTMENT_CONFIGS[dept].stageColors) */
export const STAGE_COLORS: Record<Stage, string> = {
  lo: '#C4BCFA',
  done: '#A599F5',
  review: '#8677EF',
  png: '#6C5CE7',
};

// ─── 씬 ──────────────────────────────────────

export interface Scene {
  id?: string;   // Supabase UUID (Sheets 모드에서는 undefined)
  no: number;
  sceneId: string;
  memo: string;
  storyboardUrl: string;
  guideUrl: string;
  assignee: string;
  layoutId: string;
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
  completedBy?: string;  // 모든 단계 완료한 사용자 이름
  completedAt?: string;  // 완료 시각 (ISO 8601)
  /**
   * 씬 길이 변경 시각 라벨 (수동 토글, 영구 라벨 — 사용자가 해제 전까지 유지).
   * - 'LD' = Long Duration (길이 늘어남, <-> SVG 라벨)
   * - 'SD' = Short Duration (길이 줄어듦, >-< SVG 라벨)
   * - null/undefined = 표시 없음
   * 카드/시트 우클릭 메뉴로 토글.
   */
  lengthChange?: 'LD' | 'SD' | null;
  /** 씬 row 등록 시각 (ISO 8601). Supabase scenes.created_at — 2026-05-02 추가 */
  createdAt?: string;
  /** 씬 row 마지막 갱신 시각 (ISO 8601). 단계 토글/필드 변경 시 자동 갱신 */
  updatedAt?: string;
}

// ─── 통합 씬 (BG + ACT 머지) ─────────────────

export interface MergedScene {
  sceneId: string;         // 통합 뷰 대표 씬번호 (예: a001)
  mergedKey: string;       // 통합 뷰 내부 고유 키 (예: a|bg:ac001|act:a001)
  bgScene: Scene | null;
  actScene: Scene | null;
  bgSceneIndex: number;   // bgPart.scenes 내 인덱스 (-1 if absent)
  actSceneIndex: number;   // actPart.scenes 내 인덱스 (-1 if absent)
}

// ─── 컴포지팅 리비전 ─────────────────────────

export type RevisionStatus = 'open' | 'in_progress' | 'resolved';
export type RevisionPriority = 'urgent' | 'high' | 'normal';

export interface CompRevision {
  id: string;
  sceneKey: string;        // "EP01:A:1" (에피소드:파트:정규화된 씬번호)
  revisionNo: number;      // 씬별 자동 증가 (Rev.1, Rev.2, ...)
  status: RevisionStatus;
  priority: RevisionPriority;
  description: string;
  frameNo?: string;        // 프레임 번호 (예: "F024")
  imageUrl?: string;
  department?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  assignee?: string;
  resolvedBy?: string;
  resolvedNote?: string;
  createdAt: string;       // ISO 8601
  updatedAt: string;
  resolvedAt?: string;
  /**
   * v1.18.0: 알림 받을 사람 user.id 배열.
   * 등록 시 폼에서 멘션한 사람들 + 등록자 본인. 댓글/상태 변경 시 이 목록에 알림 전송.
   * 옵셔널 — 사용처에서 `?? []`로 가드. 레거시 데이터/생성 경로 호환.
   */
  notifyUserIds?: string[];
}

// ─── 사용자 & 인증 ─────────────────────────

export interface AppUser {
  id: string;          // UUID
  name: string;
  slackId: string;
  password: string;    // base64 인코딩된 JSON 내 평문 (내부 툴)
  isInitialPassword: boolean;
  createdAt: string;   // ISO 8601
  hireDate?: string;   // Phase 0-4: 입사일 (YYYY-MM-DD)
  birthday?: string;   // Phase 0-4: 생일 (MM-DD)
  role?: string;       // Phase 0-4: 역할 (admin | user)
  /**
   * v1.18.1: 컴포지터 단일 boolean (BG/ACT 부서 구분 없음).
   * 한솔 정정: 컴포지터는 부서로 나뉘지 않음 — 리비전 등록 시 모든 컴포지터가 자동 알림 대상.
   */
  isCompositor?: boolean;
}

export interface UsersFile {
  users: AppUser[];
}

export interface AuthSession {
  userId: string;
  userName: string;
  loggedInAt: string;  // ISO 8601
}

// ─── 파트 & 에피소드 ─────────────────────────

export interface Part {
  id?: string;    // Supabase UUID (Sheets 모드에서는 undefined)
  partId: string; // 'A', 'B', 'C', 'D'
  department: Department; // 'bg' | 'acting'
  sheetName: string; // 'EP01_A_BG' or 'EP01_A' (legacy = bg)
  scenes: Scene[];
}

export interface Episode {
  episodeNumber: number;
  title: string; // 'EP.01'
  parts: Part[];
}

// ─── 담당자 ──────────────────────────────────

export interface Assignee {
  name: string;
  role: string;
  color: string;
}

// ─── 위젯 레이아웃 ───────────────────────────

export interface WidgetLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  visible?: boolean;
}

// ─── 차트 타입 ──────────────────────────────

export type ChartType = 'horizontal-bar' | 'vertical-bar' | 'donut' | 'stat-card';

// ─── 에피소드 상세 통계 ─────────────────────

export interface PartDetailStatsEntry {
  partId: string;
  bgPct: number;
  actPct: number;
  combinedPct: number;
  bgScenes: number;
  actScenes: number;
  bgStages: { stage: Stage; label: string; color: string; done: number; total: number; pct: number }[];
  actStages: { stage: Stage; label: string; color: string; done: number; total: number; pct: number }[];
}

export interface EpisodeDetailStats {
  episodeNumber: number;
  overallPct: number;
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  perDept: Record<Department, { overallPct: number; totalScenes: number; stageStats: StageStats[] }>;
  perPart: PartDetailStatsEntry[];
  perAssignee: AssigneeStats[];
  perDeptAssignee: Record<Department, AssigneeStats[]>;
}

// ─── 통계 ────────────────────────────────────

export interface StageStats {
  stage: Stage;
  label: string;
  done: number;
  total: number;
  pct: number;
}

export interface AssigneeStats {
  name: string;
  totalScenes: number;
  completedScenes: number;
  pct: number;
}

export interface EpisodePartStats {
  part: string;
  department: Department;
  pct: number;
  totalScenes: number;
}

export interface EpisodeStats {
  episodeNumber: number;
  title: string;
  parts: EpisodePartStats[];
  overallPct: number;
}

export interface DashboardStats {
  overallPct: number;
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  stageStats: StageStats[];
  assigneeStats: AssigneeStats[];
  episodeStats: EpisodeStats[];
}

// ─── _REGISTRY 타입 (Phase 0-2) ──────────────

export interface RegistryEntry {
  sheetName: string;
  episodeNumber: number;
  partId: string;
  department: string;
  status: 'active' | 'archived' | 'deleted';
  title: string;
  archivedAt: string;
  archivedBy: string;
  archiveMemo: string;
  updatedAt: string;
}

// ─── 동기화 델타 (창 간 IPC 페이로드) ────────

export interface SheetDeltaToggle {
  type: 'toggle';
  sheetName: string;
  sceneId: string;
  field: Stage;
  value: boolean;
}
export interface SheetDeltaFieldUpdate {
  type: 'field-update';
  sheetName: string;
  sceneId: string;
  sceneIndex: number;
  field: string;
  value: string;
}
export interface SheetDeltaComment {
  type: 'comment';
  sheetName: string;
  sceneId: string;
  commentAction: 'add' | 'edit' | 'delete';
}
export interface SheetDeltaSnapshot {
  type: 'snapshot';
}
export interface SheetDeltaFull {
  type: 'full';
}
export interface SheetDeltaTodo {
  type: 'todo';
}
export type SheetDelta =
  | SheetDeltaToggle
  | SheetDeltaFieldUpdate
  | SheetDeltaComment
  | SheetDeltaSnapshot
  | SheetDeltaFull
  | SheetDeltaTodo;

export interface SnapshotRelayData {
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  episodeMemos: Record<number, string>;
}

// ─── 메타데이터 항목 ────────────────────────

export interface MetadataEntry {
  type: string;
  key: string;
  value: string;
  updatedAt: string;
}

// ─── Google Sheets 연동 타입 ─────────────────

export interface SheetsConnectResult {
  ok: boolean;
  error: string | null;
}

export interface SheetsReadResult {
  ok: boolean;
  data: Episode[] | null;
  error?: string;
}

export interface SheetsUpdateResult {
  ok: boolean;
  error?: string;
}

export interface SheetsConfig {
  webAppUrl: string;
}

// ─── 일괄 작업 (bulk operations) ────────────

export type BulkStageUpdate = {
  sceneUuid: string;
  stage: Stage;
  value: boolean;
  /**
   * 완료 메타 시맨틱:
   * - `undefined`: 메타 건드리지 않음
   * - `null`: metadata 행을 삭제 (완료 해제)
   * - `string`: UPSERT (완료 설정)
   */
  completedBy?: string | null;
  completedAt?: string | null;
};

export type BulkFieldUpdate = {
  sceneUuid: string;
  fields: {
    assignee?: string;
    memo?: string;
    layoutId?: string;
    storyboardUrl?: string;
    guideUrl?: string;
  };
};

export type BulkUpdateResult = {
  sceneUuid: string;
  success: boolean;
  error?: string;
};

// ─── 활동 기록 (activity_log) ───────────────

export type ActionGroup = 'progress' | 'memo' | 'scene' | 'etc';
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'memo_update' | 'comment_add'
  | 'revision_add' | 'revision_in_progress' | 'revision_resolve' | 'revision_delete'
  // v1.18.0: 리비전 맥락 댓글 — 일반 comment_add 와 분리해 활동 피드에서 별도 표시
  | 'revision_comment'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide';

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  sceneId: string | null;
  sceneLabel: string | null;
  episodeNumber: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

// ─── v1.23.0: 시간 단위 + 분석 모달 ─────────────

/** 최근 작업 위젯 시간 단위 */
export type TimeUnit = 'week' | 'month' | 'year';

/** 단위 + 기간 인덱스(0=현재, 1=이전 주/달/년 ...) */
export interface TimeRange {
  unit: TimeUnit;
  rangeIdx: number;
}

/** 히트맵 셀 클릭 필터 (bucket 의미는 granularity 에 따라 달라짐) */
export interface CellFilter {
  bucket1: number;  // hour-of-day-x-dow: dow / month-x-dow: month(0-based)
  bucket2: number;  // hour-of-day-x-dow: hour / month-x-dow: dow
}

/** get_activity_stats_v2 RPC 한 row */
export interface ActivityStatRowV2 {
  bucket1: number;
  bucket2: number;
  total: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}

/** get_activity_insights RPC 응답 (분석 모달 raw data) */
export interface ActivityInsightsRaw {
  monthDowGrid: Array<{ month: number; dow: number; count: number }>;
  userBreakdown: Array<{ userId: string; userName: string; count: number }>;
  userBreakdownTotal: number;
  stageBreakdown: { lo: number; done: number; review: number; png: number };
  topScenes: Array<{
    sceneId: string;
    sceneLabel: string | null;
    episodeNumber: number | null;
    total: number;
    revCount: number;
    memoCount: number;
    stageCount: number;
  }>;
  weeklyCompleted: Array<{ weekStart: string; completedSceneCount: number }>;
  /** v1.23.0: 클라이언트 보강 (RPC 는 빈 객체 반환) */
  sceneFlow: Record<string, never>;
  /** v1.23.0: 클라이언트 보강 (RPC 는 빈 배열 반환) */
  episodeProgress: unknown[];
}

export interface UpdateReleaseNote {
  version: string;
  title: string;
  items: string[];
}

export interface UpdateInfo {
  status: 'available' | 'downloading' | 'ready' | 'applying' | 'up-to-date' | 'failed' | 'suppressed';
  currentVersion: string;
  latestVersion: string;
  buildAt: string;
  ready: boolean;
  releaseNotes: UpdateReleaseNote[];
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

// ─── Electron API (preload에서 노출) ─────────

export interface ElectronAPI {
  getDataPath: () => Promise<string>;
  shellShowItem?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  /** 외부 URL 을 기본 브라우저로 열기 (메모 링크 전용) */
  openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>;

  // 사용자 파일 (exe 옆 또는 test-data/ 옆, base64 인코딩 JSON)
  usersRead: () => Promise<UsersFile | null>;
  usersWrite: (data: UsersFile) => Promise<boolean>;
  readSettings: (fileName: string) => Promise<unknown | null>;
  writeSettings: (fileName: string, data: unknown) => Promise<boolean>;
  onDataChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onSheetChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onRetryNotify?: (callback: (message: string) => void) => () => void;
  onSavingBeforeQuit?: (callback: (pendingCount: number) => void) => () => void;
  // v1.22.1: 자동 업데이트 알림
  getUpdateState?: () => Promise<UpdateInfo | null>;
  checkForUpdates?: () => Promise<UpdateInfo | null>;
  onUpdateState?: (callback: (state: UpdateInfo | null) => void) => () => void;
  onUpdateReady?: (callback: (version: string, state?: UpdateInfo) => void) => () => void;
  applyUpdateNow?: () => Promise<void>;
  // 네이티브 알림
  showNativeNotification?: (title: string, body: string) => Promise<void>;
  // 이미지 파일 저장/삭제 (하이브리드 이미지 스토리지)
  imageSave: (fileName: string, base64Data: string) => Promise<string>;
  imageDelete: (fileName: string) => Promise<boolean>;
  imageGetDir: () => Promise<string>;
  clipboardReadImage: () => Promise<string | null>;
  // GAS 연결 (이미지 업로드용 Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) => Promise<SheetsConnectResult>;
  sheetsIsConnected: () => Promise<boolean>;
  // 이미지 업로드 (GAS → Google Drive)
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  // ─── Supabase Storage ──────────────────────────
  storageUploadImage: (
    sheetName: string,
    sceneId: string,
    imageType: string,
    base64Data: string,
  ) => Promise<{ ok: boolean; url?: string; error?: string }>;
  storageDeleteImage: (url: string) => Promise<void>;
  // Sheets fallback (Supabase 장애 시)
  sheetsReadComments: (sheetName: string) => Promise<{ ok: boolean; data: { commentId: string; sheetName: string; sceneId: string; userId: string; userName: string; text: string; mentions: string[]; createdAt: string; editedAt: string }[]; error?: string }>;
  sheetsReadRevisions: () => Promise<{ ok: boolean; data: { id: string; sceneKey: string; revisionNo: number; status: string; description: string; imageUrl: string; department: string; requesterId: string; requesterName: string; assignee: string; resolvedBy: string; resolvedNote: string; createdAt: string; updatedAt: string; resolvedAt: string }[]; error?: string }>;
  // 데이터 변경 브로드캐스트
  dataNotifyChange?: (delta?: SheetDelta) => Promise<{ ok: boolean }>;
  sheetsNotifyChange?: (delta?: SheetDelta) => Promise<{ ok: boolean }>;
  // 스냅샷 릴레이 (같은 PC 내 다른 창에 전체 데이터 전달)
  onSnapshotRelay?: (callback: (data: SnapshotRelayData) => void) => () => void;
  sheetsRelaySnapshot?: (data: SnapshotRelayData) => Promise<{ ok: boolean }>;
  // 메타데이터 일괄 로딩
  sheetsReadAllMetadata?: () => Promise<{ ok: boolean; data: MetadataEntry[]; error?: string }>;
  // 휴가 관리 (vacation-repo WebApi)
  vacationConnect: (webAppUrl: string) => Promise<{ ok: boolean; error: string | null }>;
  vacationIsConnected: () => Promise<boolean>;
  vacationReadStatus: (name: string) => Promise<{ ok: boolean; data: import('./vacation').VacationStatus; error?: string }>;
  vacationReadLog: (name: string, year?: number, limit?: number) => Promise<{ ok: boolean; data: import('./vacation').VacationLogEntry[]; error?: string }>;
  vacationReadAllEvents: (year?: number) => Promise<{ ok: boolean; data: import('./vacation').VacationEvent[]; error?: string }>;
  vacationRegister: (name: string, type: string, startDate: string, endDate: string, reason: string) => Promise<import('./vacation').VacationResult>;
  vacationCancel: (name: string, rowIndex: number) => Promise<import('./vacation').VacationResult>;
  vacationGrantDahyu: (targets: string[], reason: string, grantDate: string) => Promise<import('./vacation').DahyuGrantResult>;
  vacationReadAllNames: () => Promise<{ ok: boolean; data: string[]; error?: string }>;
  vacationReadDahyuList: () => Promise<{ ok: boolean; data: import('./vacation').DahyuListEntry[]; error?: string }>;
  vacationDeleteDahyu: (rowIndices: number[]) => Promise<import('./vacation').DahyuDeleteResult>;
  // 위젯 팝업 윈도우
  widgetGetSavedState?: (widgetId: string) => Promise<{
    x: number; y: number; width: number; height: number;
    opacity: number; alwaysOnTop: boolean;
  } | null>;
  widgetOpenPopup?: (widgetId: string, title: string, extra?: Record<string, string>) => Promise<{ ok: boolean }>;
  widgetSetOpacity?: (widgetId: string, opacity: number) => Promise<void>;
  widgetClosePopup?: (widgetId: string) => Promise<void>;
  widgetResize?: (widgetId: string, width: number, height: number) => Promise<void>;
  widgetGetSize?: (widgetId: string) => Promise<{ width: number; height: number } | null>;
  widgetCaptureBehind?: (widgetId: string) => Promise<string | null>;
  onWidgetFocusChange?: (callback: (focused: boolean) => void) => () => void;
  widgetSetAlwaysOnTop?: (widgetId: string, aot: boolean) => Promise<void>;
  widgetMinimizeToDock?: (widgetId: string) => Promise<void>;
  widgetRestoreFromDock?: (widgetId: string) => Promise<void>;
  widgetDockExpand?: (widgetId: string) => Promise<void>;
  widgetDockCollapse?: (widgetId: string) => Promise<void>;
  onWidgetDockChange?: (callback: (isDocked: boolean) => void) => () => void;

  // 화이트보드 (공유 드라이브 파일 접근)
  whiteboardReadShared: () => Promise<{ ok: boolean; data: import('./whiteboard').WhiteboardData | null; error?: string }>;
  whiteboardWriteShared: (data: import('./whiteboard').WhiteboardData) => Promise<{ ok: boolean; error?: string }>;

  // ─── Supabase ──────────────────────────────────
  supabaseTestConnection: () => Promise<{ ok: boolean; error?: string }>;
  supabaseReadAll: () => Promise<unknown[]>;
  supabaseAddEpisode: (episodeNumber: number, department?: string) => Promise<void>;
  supabaseSoftDeleteEpisode: (episodeNumber: number) => Promise<void>;
  supabaseArchiveEpisode: (episodeNumber: number, archivedBy: string, archiveMemo: string) => Promise<void>;
  supabaseUnarchiveEpisode: (episodeNumber: number) => Promise<void>;
  supabaseReadArchived: () => Promise<unknown[]>;
  supabaseAddPart: (episodeNumber: number, partId: string, department?: string) => Promise<void>;
  supabaseSoftDeletePart: (sheetName: string) => Promise<void>;
  supabaseAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) => Promise<{ sceneUuid: string | null }>;
  supabaseAddScenes: (sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) => Promise<void>;
  supabaseDeleteScene: (sceneUuid: string) => Promise<void>;
  supabaseUpdateSceneStage: (sceneUuid: string, stage: string, value: boolean, updatedBy?: string) => Promise<void>;
  supabaseBulkUpdateSceneStages: (updates: BulkStageUpdate[], updatedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseBulkDeleteScenes: (sceneUuids: string[], deletedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseBulkUpdateSceneFields: (updates: BulkFieldUpdate[], updatedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseUpdateSceneField: (sceneUuid: string, field: string, value: string, senderId?: string) => Promise<void>;
  supabaseReadUsers: () => Promise<unknown[]>;
  supabaseAddUser: (user: unknown) => Promise<void>;
  supabaseUpdateUser: (userId: string, updates: Record<string, string | boolean | null>) => Promise<void>;
  supabaseDeleteUser: (userId: string) => Promise<void>;
  supabaseReadComments: (partUuid: string) => Promise<unknown[]>;
  /** 한솔 결정 (v1.15.5): 로그인 catch-up — last seen 이후 받은 멘션 댓글 일괄 조회 */
  supabaseFetchMissedMentions: (userId: string, userName: string, since: string, limit?: number) => Promise<Array<{
    id: string;
    partId: string;
    sceneId: string;
    /** v1.15.9: 정확 씬 매칭용 UUID (catch-up navigateToScene 에서 활용) */
    sceneUuid?: string | null;
    userId: string;
    userName: string;
    text: string;
    mentions: string[];
    createdAt: string;
    editedAt?: string | null;
  }>>;
  supabaseAddComment: (commentId: string, partUuid: string, sceneId: string, userId: string, userName: string, text: string, mentions: string[], createdAt: string, images?: string[], revisionId?: string | null) => Promise<void>;
  supabaseEditComment: (commentId: string, text: string, mentions: string[], images?: string[]) => Promise<void>;
  supabaseDeleteComment: (commentId: string) => Promise<void>;
  /** 비공개 캘린더 이벤트 — Google Calendar 비연동, Supabase 전용 */
  supabaseReadPrivateEvents: (userId: string) => Promise<Array<{
    id: string;
    user_id: string;
    title: string;
    memo: string | null;
    color: string | null;
    type: string | null;
    start_date: string;
    end_date: string;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>>;
  supabaseAddPrivateEvent: (input: {
    user_id: string;
    title: string;
    memo?: string;
    color?: string;
    type?: string;
    start_date: string;
    end_date: string;
    linked_episode?: number | null;
    linked_part?: string | null;
    linked_sheet_name?: string | null;
    linked_scene_id?: string | null;
    linked_department?: string | null;
    linked_todo_id?: string | null;
    created_by?: string;
  }) => Promise<{ id: string }>;
  supabaseUpdatePrivateEvent: (id: string, updates: Record<string, unknown>) => Promise<void>;
  supabaseDeletePrivateEvent: (id: string) => Promise<void>;
  supabaseReadRevisions: () => Promise<unknown[]>;
  supabaseAddRevision: (id: string, partUuid: string, sceneId: string, revisionNo: number, status: string, priority: string, description: string, frameNo: string, imageUrl: string, department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string, notifyUserIdsJson: string) => Promise<void>;
  supabaseUpdateRevision: (id: string, updates: Record<string, string>) => Promise<void>;
  supabaseDeleteRevision: (id: string) => Promise<void>;
  supabaseReadAllMetadata: () => Promise<unknown[]>;
  supabaseReadMetadata: (type: string, key: string) => Promise<unknown>;
  supabaseWriteMetadata: (type: string, key: string, value: string) => Promise<void>;
  supabaseGetActivity: (opts: { table?: string; action?: 'read' | 'write'; rangeMs: number; buckets: number })
    => Promise<Array<{ startTs: number; count: number }>>;
  supabaseGetRealtimeStatus: () => Promise<string>;
  onSupabaseRealtime: (callback: (event: unknown) => void) => () => void;
  onSupabaseStatus: (callback: (status: string) => void) => () => void;
  onSupabaseBroadcast: (callback: (event: unknown) => void) => () => void;
  // 슬랙 웹훅
  sendSlackWebhook: (payload: Record<string, string>) => Promise<{ ok: boolean }>;
  // 딥링크
  onDeepLink: (callback: (data: { sheetName: string; sceneId: string }) => void) => () => void;

  // ─── Personal Todos / Task Views ──────────────────
  supabaseReadTodos: (userId: string) => Promise<any[]>;
  supabaseUpsertTodo: (userId: string, todo: unknown) => Promise<string>;
  supabaseDeleteTodo: (todoId: string) => Promise<void>;
  supabaseReadTaskViews: (userId: string) => Promise<any>;
  supabaseUpsertTaskViews: (userId: string, views: unknown[], sceneKeys: unknown[]) => Promise<void>;
  // ─── Memos ───────────────────────────────
  supabaseReadMemo: (userId: string, widgetId: string) => Promise<any>;
  supabaseUpsertMemo: (userId: string, widgetId: string, data: unknown) => Promise<void>;
  supabaseReadAllMemos: (userId: string) => Promise<any[]>;

  // ─── 활동 기록 — currentUser 동기화 ─────────
  authSetCurrentUser: (user: { id: string; name: string } | null) => Promise<void>;

  // ─── 활동 기록 (activity_log) ──────────────
  activityList: (opts: {
    before?: string;
    limit?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
    sceneIds?: string[];
    /** v1.23.0: 시간 단위 탐색 시 range 필터 */
    rangeStart?: string;
    rangeEnd?: string;
  }) => Promise<any[]>;
  activityStats: (opts: {
    days?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
  }) => Promise<Array<{
    day_of_week: number;
    hour: number;
    count: number;
    count_progress: number;
    count_memo: number;
    count_scene: number;
    count_etc: number;
  }>>;
  /** v1.23.0: 시간 단위 + 기간 기반 통계 (히트맵·막대 데이터 소스) */
  activityStatsV2: (opts: {
    rangeStart: string;
    rangeEnd: string;
    granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
    department?: 'bg' | 'acting' | null;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  }) => Promise<ActivityStatRowV2[]>;
  /** v1.23.0: 분석 모달 7카드 raw data 한 번에 */
  activityInsights: (opts: {
    rangeStart: string;
    rangeEnd: string;
    department?: 'bg' | 'acting' | null;
  }) => Promise<ActivityInsightsRaw>;
  activityBackfill: (since: string) => Promise<any[]>;
  activityStorageInfo: () => Promise<{ count: number; sizeMB: number }>;
  onActivityRealtimeInsert: (cb: (row: any) => void) => () => void;

  // ─── 설정/세션 변경 브로드캐스트 ─────────────────
  preferencesBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onPreferencesChanged: (cb: (payload: unknown) => void) => () => void;
  sessionBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  sessionRequestCurrent: () => Promise<{ ok: boolean }>;
  onSessionChanged: (cb: (payload: unknown) => void) => () => void;
  themeBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onThemeChanged: (cb: (payload: unknown) => void) => () => void;
  calendarBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onCalendarChanged: (cb: (payload: unknown) => void) => () => void;

  // ─── 휴가 pending 상태 + 브로드캐스트 ─────────────
  vacationPendingLoad: () => Promise<unknown>;
  vacationPendingSave: (list: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastRegistered: (payload?: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastFailed: (payload?: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastPendingChanged: (payload?: unknown) => Promise<{ ok: boolean }>;
  onVacationRegistered: (cb: (payload: unknown) => void) => () => void;
  onVacationFailed: (cb: (payload: unknown) => void) => () => void;
  onVacationPendingChanged: (cb: (payload: unknown) => void) => () => void;

  // ─── 사용자 폰트 (v1.20.0) ──────────────────────
  fontAdd: () => Promise<Array<
    | { id: string; name: string; filename: string; format: 'otf' | 'ttf' | 'woff' | 'woff2'; hasKorean: boolean; addedAt: string }
    | { error: string }
  >>;
  fontAddByPath: (filePaths: string[]) => Promise<Array<
    | { id: string; name: string; filename: string; format: 'otf' | 'ttf' | 'woff' | 'woff2'; hasKorean: boolean; addedAt: string }
    | { error: string }
  >>;
  fontDelete: (font: { id: string; filename: string }) => Promise<{ ok: boolean; error?: string }>;
  /** 드래그앤드롭에서 File 객체 → 절대 경로 (Electron 32+ webUtils.getPathForFile) */
  fontGetPathForFile: (file: File) => string;

  // ─── Google Calendar ──────────────────────────────
  gcalIsAuthenticated: () => Promise<boolean>;
  gcalStartAuth: () => Promise<void>;
  gcalSaveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  gcalHasCredentials: () => Promise<boolean>;
  gcalSignOut: () => Promise<void>;
  gcalListCalendars: () => Promise<Array<{ id: string; summary: string; primary: boolean }>>;
  gcalFullSync: (calendarId: string) => Promise<any[]>;
  gcalIncrementalSync: (calendarId: string) => Promise<{ updated: any[]; deleted: string[]; isFullSync: boolean }>;
  gcalInsertEvent: (calendarId: string, input: unknown) => Promise<string>;
  gcalUpdateEvent: (calendarId: string, eventId: string, input: unknown) => Promise<void>;
  gcalDeleteEvent: (calendarId: string, eventId: string) => Promise<void>;
  gcalEnsureWatch: (calendarId: string, userId: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
