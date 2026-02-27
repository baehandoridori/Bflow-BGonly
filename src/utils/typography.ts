/**
 * 타이포그래피 스케일 시스템
 * CSS 변수 기반으로 앱 전체 텍스트 크기를 제어
 */

// ─── 타입 ──────────────────────────────────────

export type FontScale = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface FontCategoryScales {
  heading: number;   // 제목 (text-xl, text-lg)
  body: number;      // 본문 (text-sm, text-base)
  caption: number;   // 캡션 (text-xs)
  micro: number;     // 마이크로 (text-[11px], text-[10px], text-[9px])
}

export interface FontSettings {
  fontScale: FontScale;
  fontCategoryScales?: FontCategoryScales;
}

// ─── 프리셋 ────────────────────────────────────

export const FONT_SCALE_PRESETS: Record<FontScale, { label: string; multiplier: number }> = {
  xs: { label: '아주 작게', multiplier: 0.85 },
  s:  { label: '작게',     multiplier: 0.92 },
  m:  { label: '보통',     multiplier: 1.00 },
  l:  { label: '크게',     multiplier: 1.10 },
  xl: { label: '아주 크게', multiplier: 1.20 },
};

export const FONT_SCALE_ORDER: FontScale[] = ['xs', 's', 'm', 'l', 'xl'];

export const DEFAULT_FONT_SCALE: FontScale = 'm';

export const DEFAULT_CATEGORY_SCALES: FontCategoryScales = {
  heading: 1.0,
  body: 1.0,
  caption: 1.0,
  micro: 1.0,
};

export const CATEGORY_SCALE_MIN = 0.8;
export const CATEGORY_SCALE_MAX = 1.4;
export const CATEGORY_SCALE_STEP = 0.05;

// ─── 카테고리 메타 ─────────────────────────────

export const FONT_CATEGORIES: Array<{
  id: keyof FontCategoryScales;
  label: string;
  description: string;
  previewText: string;
  cssClass: string;
  defaultSize: string;
}> = [
  {
    id: 'heading',
    label: '제목',
    description: '페이지/섹션 제목',
    previewText: '페이지 제목 텍스트',
    cssClass: 'text-xl font-bold',
    defaultSize: '20px',
  },
  {
    id: 'body',
    label: '본문',
    description: '일반 텍스트, 설명',
    previewText: '본문 텍스트와 설명입니다',
    cssClass: 'text-sm',
    defaultSize: '14px',
  },
  {
    id: 'caption',
    label: '캡션',
    description: '라벨, 도움말 텍스트',
    previewText: '라벨, 도움말 텍스트',
    cssClass: 'text-xs',
    defaultSize: '12px',
  },
  {
    id: 'micro',
    label: '마이크로',
    description: '뱃지, 타임스탬프',
    previewText: '뱃지 · 타임스탬프 · 2026-02-27',
    cssClass: 'text-[11px]',
    defaultSize: '11px',
  },
];

// ─── CSS 변수 적용 ─────────────────────────────

export function applyFontSettings(settings: FontSettings): void {
  const root = document.documentElement;
  const { fontScale, fontCategoryScales } = settings;
  const preset = FONT_SCALE_PRESETS[fontScale];

  // 전체 스케일
  root.style.setProperty('--text-scale', String(preset.multiplier));

  // 카테고리별 스케일
  const cats = fontCategoryScales ?? DEFAULT_CATEGORY_SCALES;
  root.style.setProperty('--text-heading-scale', String(cats.heading));
  root.style.setProperty('--text-body-scale', String(cats.body));
  root.style.setProperty('--text-caption-scale', String(cats.caption));
  root.style.setProperty('--text-micro-scale', String(cats.micro));
}

export function resetFontSettings(): void {
  applyFontSettings({
    fontScale: DEFAULT_FONT_SCALE,
    fontCategoryScales: { ...DEFAULT_CATEGORY_SCALES },
  });
}
