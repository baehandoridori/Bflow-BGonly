/**
 * 개인 설정 서비스: AppData 기반 읽기/쓰기
 * Electron IPC를 통해 %APPDATA%/B flow/ 에 저장
 */

import type { WidgetLayoutItem } from '@/types';
import type { ThemeConfig } from '@/themes';

const LAYOUT_FILE = 'layout.json';
const ALL_LAYOUT_FILE = 'layout-all.json';
const EPISODE_LAYOUT_FILE = 'layout-episode.json';
const PREFERENCES_FILE = 'preferences.json';
const THEME_FILE = 'theme.json';

// ─── 위젯 레이아웃 ───────────────────────────

/** 기존 4칸 그리드 레이아웃을 24칸 그리드로 마이그레이션 */
function migrateLayout(layout: WidgetLayoutItem[]): WidgetLayoutItem[] {
  // 감지: 모든 위젯의 x+w가 5 이하이면 구 4칸 형식
  const isOldFormat = layout.every((l) => (l.x + l.w) <= 5);
  if (!isOldFormat) return layout;
  console.log('[설정] 4칸→24칸 레이아웃 마이그레이션 수행');
  return layout.map((l) => ({
    ...l,
    x: l.x * 6,
    y: l.y * 5,
    w: l.w * 6,
    h: l.h * 5,
    minW: l.minW ? l.minW * 6 : undefined,
    minH: l.minH ? l.minH * 5 : undefined,
  }));
}

/** 저장된 레이아웃의 minW/minH를 현재 코드 기준으로 강제 갱신 */
const MIN_W = 2;
const MIN_H = 2;
function enforceMinConstraints(layout: WidgetLayoutItem[]): WidgetLayoutItem[] {
  return layout.map((l) => ({
    ...l,
    minW: MIN_W,
    minH: MIN_H,
  }));
}

export async function loadLayout(key?: 'all' | 'episode'): Promise<WidgetLayoutItem[] | null> {
  try {
    const file = key === 'all' ? ALL_LAYOUT_FILE : key === 'episode' ? EPISODE_LAYOUT_FILE : LAYOUT_FILE;
    const data = await window.electronAPI.readSettings(file);
    if (data && Array.isArray(data)) {
      const layout = data as WidgetLayoutItem[];
      return enforceMinConstraints(migrateLayout(layout));
    }
  } catch (err) {
    console.error('[설정] 레이아웃 로드 실패:', err);
  }
  return null;
}

export async function saveLayout(layout: WidgetLayoutItem[], key?: 'all' | 'episode'): Promise<void> {
  try {
    const file = key === 'all' ? ALL_LAYOUT_FILE : key === 'episode' ? EPISODE_LAYOUT_FILE : LAYOUT_FILE;
    await window.electronAPI.writeSettings(file, layout);
  } catch (err) {
    console.error('[설정] 레이아웃 저장 실패:', err);
  }
}

// ─── 사용자 환경설정 ─────────────────────────

export interface UserPreferences {
  lastEpisode?: number;
  lastPart?: string;
  lastView?: string;
  chartTypes?: Record<string, string>;

  // Phase 8-1: 글꼴 크기
  fontScale?: string;  // 'xs' | 's' | 'm' | 'l' | 'xl'
  fontCategoryScales?: {
    heading?: number;
    body?: number;
    caption?: number;
    micro?: number;
  };

  // 글자 카테고리별 색상
  fontCategoryColors?: {
    heading?: string;
    body?: string;
    caption?: string;
    micro?: string;
  };
  fontColorPreset?: 'theme' | 'high-contrast' | 'soft' | 'mono' | 'custom';

  // v1.20.0: 글꼴 시스템
  /** 'pretendard' | 'inter' | ... | 'system' | `custom:${uuid}` */
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  customFonts?: Array<{
    id: string;
    name: string;
    filename: string;
    format: 'otf' | 'ttf' | 'woff' | 'woff2';
    hasKorean: boolean;
    addedAt: string;
  }>;

  // Phase 8-3: 플렉서스 애니메이션
  plexus?: {
    loginEnabled?: boolean;
    loginGradientEnabled?: boolean;
    loginParticleCount?: number;
    dashboardEnabled?: boolean;
    dashboardGradientEnabled?: boolean;
    dashboardParticleCount?: number;
    globalGradientEnabled?: boolean;
    speed?: number;
    mouseRadius?: number;
    mouseForce?: number;
    glowIntensity?: number;
    connectionDist?: number;
  };

  // Phase 8-4: 스플래시 건너뛰기
  skipLoadingSplash?: boolean;
  skipLandingSplash?: boolean;

  // Phase 8-5: 로그인 유지
  rememberMe?: boolean;

  // Phase 8-2: 키보드 단축키 커스텀 바인딩
  shortcuts?: Record<string, string>;

  // 기본 시작 뷰
  defaultView?: string;

  // 알림 설정
  notifications?: {
    sceneChange?: boolean;      // 내 씬 변경 알림 (기본 true)
    commentNotify?: boolean;    // 내 씬 댓글 알림 (기본 true)
    syncComplete?: boolean;     // 동기화 완료 알림 (기본 false)
    sound?: boolean;            // 알림 소리 (추후 구현)
    osNotification?: boolean;   // OS 네이티브 알림 (기본 true)
    toastPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    toastDuration?: number;     // ms (3000 | 5000 | 7000 | 10000)
    slackWebhookUrl?: string;   // Slack 웹훅 URL (추후 연동)
  };

  // 사이드바
  sidebarExpanded?: boolean;

  // 씬 뷰 UI 상태
  sceneUi?: {
    controlsCollapsedByContext?: Record<string, boolean>;
  };

  // 화이트보드 배경색
  whiteboardBgColor?: string;  // 기본값 '#FFFFFF'

  // 설정 사이드바: 접힌 그룹 ID 목록
  settingsCollapsedGroups?: string[];

  // 연동 탭: 접힌 IntegrationCard ID 목록
  settingsIntegrationCollapsed?: string[];

  // v1.27.0: 업데이트 직후 첫 실행 토스트용 — 이 PC에서 마지막으로 본 앱 버전
  lastSeenVersion?: string;

  // v1.27.0: 사용자가 드래그로 직접 조정한 댓글 패널 너비. null 이면 자동 모드.
  commentPanelWidthPx?: number;

  // v1.27.0: 알림 패널 사용자 조정 크기. null 이면 기본값(w=340, h=440).
  notificationPanelWidthPx?: number;
  notificationPanelHeightPx?: number;
}

export async function loadPreferences(): Promise<UserPreferences | null> {
  try {
    const data = await window.electronAPI.readSettings(PREFERENCES_FILE);
    if (data && typeof data === 'object') {
      return data as UserPreferences;
    }
  } catch (err) {
    console.error('[설정] 환경설정 로드 실패:', err);
  }
  return null;
}

export async function savePreferences(prefs: UserPreferences): Promise<void> {
  try {
    await window.electronAPI.writeSettings(PREFERENCES_FILE, prefs);
  } catch (err) {
    console.error('[설정] 환경설정 저장 실패:', err);
  }
}

// ─── 테마 설정 ───────────────────────────────

export async function loadTheme(): Promise<ThemeConfig | null> {
  try {
    const data = await window.electronAPI.readSettings(THEME_FILE);
    if (data && typeof data === 'object' && 'themeId' in (data as Record<string, unknown>)) {
      return data as ThemeConfig;
    }
  } catch (err) {
    console.error('[설정] 테마 로드 실패:', err);
  }
  return null;
}

export async function saveTheme(config: ThemeConfig): Promise<void> {
  try {
    await window.electronAPI.writeSettings(THEME_FILE, config);
  } catch (err) {
    console.error('[설정] 테마 저장 실패:', err);
  }
}
