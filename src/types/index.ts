// ─── 부서 (Department) ──────────────────────

export type Department = 'bg' | 'acting';

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
    stageColors: { lo: '#74B9FF', done: '#A29BFE', review: '#FDCB6E', png: '#00B894' },
    color: '#6C5CE7',
  },
  acting: {
    id: 'acting',
    label: '액팅',
    shortLabel: 'ACT',
    stageLabels: { lo: '1원화', done: '2원화', review: '동화', png: '최종' },
    stageColors: { lo: '#FF6B6B', done: '#FF9FF3', review: '#FECA57', png: '#48DBFB' },
    color: '#E17055',
  },
};

// ─── 진행 단계 ──────────────────────────────

export type Stage = 'lo' | 'done' | 'review' | 'png';

export const STAGES: Stage[] = ['lo', 'done', 'review', 'png'];

/** @deprecated — 부서별 라벨은 DEPARTMENT_CONFIGS[dept].stageLabels 사용 */
export const STAGE_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완료',
  review: '검수',
  png: 'PNG',
};

/** @deprecated — 부서별 컬러는 DEPARTMENT_CONFIGS[dept].stageColors 사용 */
export const STAGE_COLORS: Record<Stage, string> = {
  lo: '#74B9FF',
  done: '#A29BFE',
  review: '#FDCB6E',
  png: '#00B894',
};

// ─── 씬 ──────────────────────────────────────

export interface Scene {
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

// ─── 사용자 & 인증 ─────────────────────────

export interface AppUser {
  id: string;          // UUID
  name: string;
  slackId: string;
  password: string;    // base64 인코딩된 JSON 내 평문 (내부 툴)
  isInitialPassword: boolean;
  createdAt: string;   // ISO 8601
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
  getMode: () => Promise<{ isTestMode: boolean; appRoot: string }>;
  getDataPath: () => Promise<string>;

  // 사용자 파일 (exe 옆 또는 test-data/ 옆, base64 인코딩 JSON)
  usersRead: () => Promise<UsersFile | null>;
  usersWrite: (data: UsersFile) => Promise<boolean>;
  readSettings: (fileName: string) => Promise<unknown | null>;
  writeSettings: (fileName: string, data: unknown) => Promise<boolean>;
  testGetSheetPath: () => Promise<string>;
  testReadSheet: (filePath: string) => Promise<unknown | null>;
  testWriteSheet: (filePath: string, data: unknown) => Promise<boolean>;
  onSheetChanged: (callback: () => void) => () => void;
  // 이미지 파일 저장/삭제 (하이브리드 이미지 스토리지)
  imageSave: (fileName: string, base64Data: string) => Promise<string>;
  imageDelete: (fileName: string) => Promise<boolean>;
  imageGetDir: () => Promise<string>;
  clipboardReadImage: () => Promise<string | null>;
  // Google Sheets 연동 (Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) => Promise<SheetsConnectResult>;
  sheetsIsConnected: () => Promise<boolean>;
  sheetsReadAll: () => Promise<SheetsReadResult>;
  sheetsUpdateCell: (
    sheetName: string,
    rowIndex: number,
    stage: string,
    value: boolean
  ) => Promise<SheetsUpdateResult>;
  // CRUD
  sheetsAddEpisode: (episodeNumber: number, department?: string) => Promise<SheetsUpdateResult>;
  sheetsAddPart: (episodeNumber: number, partId: string, department?: string) => Promise<SheetsUpdateResult>;
  sheetsAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) => Promise<SheetsUpdateResult>;
  sheetsDeleteScene: (sheetName: string, rowIndex: number) => Promise<SheetsUpdateResult>;
  sheetsUpdateSceneField: (sheetName: string, rowIndex: number, field: string, value: string) => Promise<SheetsUpdateResult>;
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  // METADATA 시트
  sheetsReadMetadata: (type: string, key: string) => Promise<{ ok: boolean; data?: { type: string; key: string; value: string; updatedAt: string } | null; error?: string }>;
  sheetsWriteMetadata: (type: string, key: string, value: string) => Promise<SheetsUpdateResult>;
  sheetsSoftDeletePart: (sheetName: string) => Promise<SheetsUpdateResult>;
  sheetsSoftDeleteEpisode: (episodeNumber: number) => Promise<SheetsUpdateResult>;
  // 위젯 팝업 윈도우
  widgetOpenPopup?: (widgetId: string, title: string) => Promise<{ ok: boolean }>;
  widgetSetOpacity?: (widgetId: string, opacity: number) => Promise<void>;
  widgetClosePopup?: (widgetId: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
