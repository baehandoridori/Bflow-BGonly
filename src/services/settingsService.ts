/**
 * 개인 설정 서비스: AppData 기반 읽기/쓰기
 * Electron IPC를 통해 %APPDATA%/B flow/ 에 저장
 */

import type { WidgetLayoutItem } from '@/types';
import type { ThemeConfig } from '@/themes';

const LAYOUT_FILE = 'layout.json';
const ALL_LAYOUT_FILE = 'layout-all.json';
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

export async function loadLayout(key?: 'all'): Promise<WidgetLayoutItem[] | null> {
  try {
    const file = key === 'all' ? ALL_LAYOUT_FILE : LAYOUT_FILE;
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

export async function saveLayout(layout: WidgetLayoutItem[], key?: 'all'): Promise<void> {
  try {
    const file = key === 'all' ? ALL_LAYOUT_FILE : LAYOUT_FILE;
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
