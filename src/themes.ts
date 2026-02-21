/**
 * 테마 시스템 — 프리셋 + 커스텀 테마 지원
 * CSS 변수(RGB triplet) 기반으로 Tailwind 색상과 연동
 */

export interface ThemeColors {
  bgPrimary: string;     // RGB triplet e.g. "15 17 23"
  bgCard: string;
  bgBorder: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentSub: string;     // 그라데이션 서브 컬러
}

export interface ThemePreset {
  id: string;
  name: string;
  nameKo: string;
  colors: ThemeColors;
}

// ─── 프리셋 정의 ──────────────────────────────

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'violet',
    name: 'Violet Dream',
    nameKo: '바이올렛 드림',
    colors: {
      bgPrimary: '15 17 23',
      bgCard: '26 29 39',
      bgBorder: '45 48 65',
      textPrimary: '232 232 238',
      textSecondary: '139 141 163',
      accent: '108 92 231',
      accentSub: '162 155 254',
    },
  },
  {
    id: 'cinema-red',
    name: 'Cinema Red',
    nameKo: '시네마 레드',
    colors: {
      bgPrimary: '12 10 16',
      bgCard: '22 18 27',
      bgBorder: '45 34 50',
      textPrimary: '238 232 238',
      textSecondary: '163 139 158',
      accent: '225 29 72',
      accentSub: '251 113 133',
    },
  },
  {
    id: 'midnight-blue',
    name: 'Midnight Blue',
    nameKo: '미드나잇 블루',
    colors: {
      bgPrimary: '11 17 32',
      bgCard: '18 26 44',
      bgBorder: '35 48 75',
      textPrimary: '230 235 245',
      textSecondary: '130 148 180',
      accent: '59 130 246',
      accentSub: '96 165 250',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    nameKo: '에메랄드',
    colors: {
      bgPrimary: '10 16 14',
      bgCard: '16 26 22',
      bgBorder: '30 50 42',
      textPrimary: '230 242 236',
      textSecondary: '130 163 148',
      accent: '16 185 129',
      accentSub: '52 211 153',
    },
  },
  {
    id: 'amber-gold',
    name: 'Amber Gold',
    nameKo: '앰버 골드',
    colors: {
      bgPrimary: '15 13 10',
      bgCard: '26 23 18',
      bgBorder: '50 44 34',
      textPrimary: '242 238 230',
      textSecondary: '168 158 138',
      accent: '217 119 6',
      accentSub: '251 191 36',
    },
  },
];

export const DEFAULT_THEME_ID = 'violet';

// ─── 유틸리티 ─────────────────────────────────

/** RGB triplet → hex (#RRGGBB) */
export function rgbToHex(triplet: string): string {
  const [r, g, b] = triplet.split(' ').map(Number);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** hex → RGB triplet */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** 프리셋 ID로 찾기 */
export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find(p => p.id === id);
}

/** CSS 변수에 테마 적용 */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty('--color-bg-primary', colors.bgPrimary);
  root.style.setProperty('--color-bg-card', colors.bgCard);
  root.style.setProperty('--color-bg-border', colors.bgBorder);
  root.style.setProperty('--color-text-primary', colors.textPrimary);
  root.style.setProperty('--color-text-secondary', colors.textSecondary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-accent-sub', colors.accentSub);
}

/** 저장용 테마 설정 */
export interface ThemeConfig {
  themeId: string;
  customColors?: ThemeColors;
}
