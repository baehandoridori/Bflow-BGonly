// ─── 진행 단계 ──────────────────────────────

export type Stage = 'lo' | 'done' | 'review' | 'png';

export const STAGES: Stage[] = ['lo', 'done', 'review', 'png'];

export const STAGE_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완료',
  review: '검수',
  png: 'PNG',
};

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
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
}

// ─── 파트 & 에피소드 ─────────────────────────

export interface Part {
  partId: string; // 'A', 'B', 'C', 'D'
  sheetName: string; // 'EP01_A'
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
  readSettings: (fileName: string) => Promise<unknown | null>;
  writeSettings: (fileName: string, data: unknown) => Promise<boolean>;
  testGetSheetPath: () => Promise<string>;
  testReadSheet: (filePath: string) => Promise<unknown | null>;
  testWriteSheet: (filePath: string, data: unknown) => Promise<boolean>;
  onSheetChanged: (callback: () => void) => () => void;
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
  sheetsAddEpisode: (episodeNumber: number) => Promise<SheetsUpdateResult>;
  sheetsAddPart: (episodeNumber: number, partId: string) => Promise<SheetsUpdateResult>;
  sheetsAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) => Promise<SheetsUpdateResult>;
  sheetsDeleteScene: (sheetName: string, rowIndex: number) => Promise<SheetsUpdateResult>;
  sheetsUpdateSceneField: (sheetName: string, rowIndex: number, field: string, value: string) => Promise<SheetsUpdateResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
