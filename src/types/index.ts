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
}

// ─── 통합 씬 (BG + ACT 머지) ─────────────────

export interface MergedScene {
  sceneId: string;
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
  sceneKey: string;        // "EP01:A:a001" (에피소드:파트:씬ID)
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

// ─── Electron API (preload에서 노출) ─────────

export interface ElectronAPI {
  getDataPath: () => Promise<string>;
  shellShowItem?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;

  // 사용자 파일 (exe 옆 또는 test-data/ 옆, base64 인코딩 JSON)
  usersRead: () => Promise<UsersFile | null>;
  usersWrite: (data: UsersFile) => Promise<boolean>;
  readSettings: (fileName: string) => Promise<unknown | null>;
  writeSettings: (fileName: string, data: unknown) => Promise<boolean>;
  onDataChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onSheetChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onRetryNotify?: (callback: (message: string) => void) => () => void;
  onSavingBeforeQuit?: (callback: (pendingCount: number) => void) => () => void;
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
  supabaseAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) => Promise<void>;
  supabaseAddScenes: (sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) => Promise<void>;
  supabaseDeleteScene: (sceneUuid: string) => Promise<void>;
  supabaseUpdateSceneStage: (sceneUuid: string, stage: string, value: boolean, updatedBy?: string) => Promise<void>;
  supabaseBulkUpdateSceneStages: (updates: { sceneUuid: string; stage: string; value: boolean }[], updatedBy?: string) => Promise<void>;
  supabaseUpdateSceneField: (sceneUuid: string, field: string, value: string, senderId?: string) => Promise<void>;
  supabaseReadUsers: () => Promise<unknown[]>;
  supabaseAddUser: (user: unknown) => Promise<void>;
  supabaseUpdateUser: (userId: string, updates: Record<string, string>) => Promise<void>;
  supabaseDeleteUser: (userId: string) => Promise<void>;
  supabaseReadComments: (partUuid: string) => Promise<unknown[]>;
  supabaseAddComment: (commentId: string, partUuid: string, sceneId: string, userId: string, userName: string, text: string, mentions: string[], createdAt: string) => Promise<void>;
  supabaseEditComment: (commentId: string, text: string, mentions: string[]) => Promise<void>;
  supabaseDeleteComment: (commentId: string) => Promise<void>;
  supabaseReadRevisions: () => Promise<unknown[]>;
  supabaseAddRevision: (id: string, partUuid: string, sceneId: string, revisionNo: number, status: string, priority: string, description: string, frameNo: string, imageUrl: string, department: string, requesterId: string, requesterName: string, assignee: string, createdAt: string) => Promise<void>;
  supabaseUpdateRevision: (id: string, updates: Record<string, string>) => Promise<void>;
  supabaseReadAllMetadata: () => Promise<unknown[]>;
  supabaseReadMetadata: (type: string, key: string) => Promise<unknown>;
  supabaseWriteMetadata: (type: string, key: string, value: string) => Promise<void>;
  onSupabaseRealtime: (callback: (event: unknown) => void) => () => void;
  onSupabaseStatus: (callback: (status: string) => void) => () => void;
  onSupabaseBroadcast: (callback: (event: unknown) => void) => () => void;
  // 슬랙 웹훅
  sendSlackWebhook: (payload: Record<string, string>) => Promise<{ ok: boolean }>;
  // 딥링크
  onDeepLink: (callback: (data: { sheetName: string; sceneId: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
