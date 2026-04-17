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
    nameKo: '공산당 레드',
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
    nameKo: '윤성원 블루',
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
    nameKo: '똥파리 골드',
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
  {
    id: 'nameko',
    name: '이혜민 머쉬룸',
    nameKo: '이혜민 머쉬룸',
    colors: {
      bgPrimary: '16 14 10',
      bgCard: '28 24 16',
      bgBorder: '50 44 32',
      textPrimary: '240 235 220',
      textSecondary: '170 155 130',
      accent: '129 77 65',
      accentSub: '224 203 175',
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

/** RGB triplet → HSL (h: 0-360, s/l: 0-100) */
export function rgbToHsl(triplet: string): { h: number; s: number; l: number } {
  const [r, g, b] = triplet.split(' ').map(Number).map(v => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL (h: 0-360, s/l: 0-100) → RGB triplet */
export function hslToRgb(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hP = h / 60;
  const x = c * (1 - Math.abs((hP % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= hP && hP < 1) [r1, g1, b1] = [c, x, 0];
  else if (hP < 2) [r1, g1, b1] = [x, c, 0];
  else if (hP < 3) [r1, g1, b1] = [0, c, x];
  else if (hP < 4) [r1, g1, b1] = [0, x, c];
  else if (hP < 5) [r1, g1, b1] = [x, 0, c];
  else if (hP < 6) [r1, g1, b1] = [c, 0, x];
  const m = lN - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `${r} ${g} ${b}`;
}

/** 프리셋 ID로 찾기 */
export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find(p => p.id === id);
}

/** 프리셋 ID로 라이트 모드 색상 생성 (accent 유지, 배경/텍스트만 변경) */
export function getLightColors(themeId: string): ThemeColors {
  const preset = getPreset(themeId);
  const accent = preset?.colors.accent ?? THEME_PRESETS[0].colors.accent;
  const accentSub = preset?.colors.accentSub ?? THEME_PRESETS[0].colors.accentSub;
  return {
    bgPrimary: '225 228 238',     // 카드(흰색)와 충분한 대비 (~30pt gap)
    bgCard: '255 255 255',
    bgBorder: '180 186 205',      // 보더 강화: 흰 배경 위에서 확실히 보이도록 (~75pt gap)
    textPrimary: '24 28 38',      // 약간 더 진한 검정
    textSecondary: '50 58 75',    // 강화: /50 /40 알파에서도 가독성 확보 (기존 70 80 96 → 50 58 75)
    accent,
    accentSub,
  };
}

/** CSS 변수에 테마 적용 */
export function applyTheme(colors: ThemeColors, colorMode?: 'dark' | 'light'): void {
  const root = document.documentElement;
  root.style.setProperty('--color-bg-primary', colors.bgPrimary);
  root.style.setProperty('--color-bg-card', colors.bgCard);
  root.style.setProperty('--color-bg-border', colors.bgBorder);
  root.style.setProperty('--color-text-primary', colors.textPrimary);
  root.style.setProperty('--color-text-secondary', colors.textSecondary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-accent-sub', colors.accentSub);
  // 라이트/다크 모드 표시 (CSS/컴포넌트에서 참조 가능)
  root.setAttribute('data-color-mode', colorMode ?? 'dark');
}

/** 저장용 테마 설정 */
export interface ThemeConfig {
  themeId: string;
  customColors?: ThemeColors;
  colorMode?: 'dark' | 'light';
}
