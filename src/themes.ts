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
    name: 'Nameko',
    nameKo: '나메코',
    colors: {
      bgPrimary: '16 14 10',
      bgCard: '28 24 16',
      bgBorder: '50 44 32',
      textPrimary: '240 235 220',
      textSecondary: '170 155 130',
      accent: '232 122 32',
      accentSub: '245 176 65',
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

/** 프리셋 ID로 라이트 모드 색상 생성 (accent 유지, 배경/텍스트만 변경) */
export function getLightColors(themeId: string): ThemeColors {
  const preset = getPreset(themeId);
  const accent = preset?.colors.accent ?? THEME_PRESETS[0].colors.accent;
  const accentSub = preset?.colors.accentSub ?? THEME_PRESETS[0].colors.accentSub;
  return {
    bgPrimary: '235 237 244',     // 진행 바 트랙 등이 흰 카드 위에서 보이도록 대비 강화
    bgCard: '255 255 255',
    bgBorder: '210 213 224',      // 보더도 약간 진하게
    textPrimary: '28 32 42',
    textSecondary: '70 80 96',    // 알파(/50 /40) 적용 시에도 가독성 보장
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
