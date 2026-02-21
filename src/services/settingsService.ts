/**
 * 개인 설정 서비스: AppData 기반 읽기/쓰기
 * Electron IPC를 통해 %APPDATA%/Bflow-BGonly/ 에 저장
 */

import type { WidgetLayoutItem } from '@/types';
import type { ThemeConfig } from '@/themes';

const LAYOUT_FILE = 'layout.json';
const PREFERENCES_FILE = 'preferences.json';
const THEME_FILE = 'theme.json';

// ─── 위젯 레이아웃 ───────────────────────────

export async function loadLayout(): Promise<WidgetLayoutItem[] | null> {
  try {
    const data = await window.electronAPI.readSettings(LAYOUT_FILE);
    if (data && Array.isArray(data)) {
      return data as WidgetLayoutItem[];
    }
  } catch (err) {
    console.error('[설정] 레이아웃 로드 실패:', err);
  }
  return null;
}

export async function saveLayout(layout: WidgetLayoutItem[]): Promise<void> {
  try {
    await window.electronAPI.writeSettings(LAYOUT_FILE, layout);
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
