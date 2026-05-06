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

// ─── 카테고리 색상 ─────────────────────────────

export type FontColorPreset = 'theme' | 'high-contrast' | 'soft' | 'mono' | 'custom';

export interface FontCategoryColors {
  heading?: string;  // RGB triplet "R G B" (예: "232 232 238")
  body?: string;
  caption?: string;
  micro?: string;
}

export const FONT_COLOR_PRESETS: Record<FontColorPreset, { label: string; getColors: (themePrimary: string, themeSecondary: string, themeAccentSub: string) => FontCategoryColors }> = {
  theme: {
    label: '테마 기본',
    getColors: () => ({}),  // 모두 --color-text-primary 폴백
  },
  'high-contrast': {
    label: '고대비',
    getColors: (primary, secondary) => ({
      heading: '255 255 255',
      body: primary,
      caption: secondary,
      micro: secondary,
    }),
  },
  soft: {
    label: '부드러움',
    getColors: (primary, secondary, accentSub) => ({
      heading: accentSub,
      body: primary,
      caption: secondary,
      micro: secondary,
    }),
  },
  mono: {
    label: '단색',
    getColors: (primary) => ({
      heading: primary,
      body: primary,
      caption: primary,
      micro: primary,
    }),
  },
  custom: {
    label: '사용자 지정',
    getColors: () => ({}),  // UI에서 직접 세팅
  },
};

export function applyTextColors(colors: FontCategoryColors): void {
  const root = document.documentElement;
  const set = (key: keyof FontCategoryColors, cssVar: string) => {
    const val = colors[key];
    if (val) root.style.setProperty(cssVar, val);
    else root.style.removeProperty(cssVar);
  };
  set('heading', '--color-text-heading');
  set('body', '--color-text-body');
  set('caption', '--color-text-caption');
  set('micro', '--color-text-micro');
}

export function resetTextColors(): void {
  applyTextColors({});
}

// ─── 저장된 환경설정을 런타임에 적용 ──────────

const VALID_FONT_SCALES: readonly FontScale[] = ['xs', 's', 'm', 'l', 'xl'];

export function isFontScale(v: unknown): v is FontScale {
  return typeof v === 'string' && (VALID_FONT_SCALES as readonly string[]).includes(v);
}

/** UserPreferences의 글자 크기/색상 관련 필드를 CSS 변수에 적용 */
export function applyPreferencesToDOM(prefs: {
  fontScale?: string;
  fontCategoryScales?: Partial<FontCategoryScales>;
  fontCategoryColors?: FontCategoryColors;
  // v1.20.0: 글꼴 시스템
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  customFonts?: CustomFont[];
}): void {
  const scale: FontScale = isFontScale(prefs.fontScale) ? prefs.fontScale : DEFAULT_FONT_SCALE;
  applyFontSettings({
    fontScale: scale,
    fontCategoryScales: {
      heading: prefs.fontCategoryScales?.heading ?? 1,
      body: prefs.fontCategoryScales?.body ?? 1,
      caption: prefs.fontCategoryScales?.caption ?? 1,
      micro: prefs.fontCategoryScales?.micro ?? 1,
    },
  });
  applyTextColors(prefs.fontCategoryColors ?? {});

  // v1.20.0: 글꼴 / 간격
  ensureCustomFontsLoaded(prefs.customFonts ?? []);
  applyFontFamily(prefs.fontFamily ?? DEFAULT_FONT_FAMILY, prefs.customFonts ?? []);
  applySpacing(
    prefs.lineHeight ?? DEFAULT_LINE_HEIGHT,
    prefs.letterSpacing ?? DEFAULT_LETTER_SPACING,
  );
}

// ─── v1.20.0: 글꼴 서체 (Font Family) ───────────────

export interface CustomFont {
  /** `custom:${uuid}` 형식 — preferences.fontFamily에 직접 저장됨 */
  id: string;
  /** opentype.js로 추출한 메타 이름 (사용자에게 표시) */
  name: string;
  /** 디스크에 저장된 실제 파일명 (uuid.확장자) */
  filename: string;
  format: 'otf' | 'ttf' | 'woff' | 'woff2';
  /** 한글 글리프 존재 여부 — false면 토스트 경고 */
  hasKorean: boolean;
  addedAt: string; // ISO 8601
}

export interface FontFamilyMeta {
  id: string;
  label: string;
  /** CSS font-family stack (fallback 포함) */
  cssStack: string;
  group: 'modern' | 'soft' | 'serious' | 'character' | 'system';
}

const FALLBACK_STACK = `'Pretendard Variable', Pretendard, system-ui, sans-serif`;

export const FONT_FAMILIES: FontFamilyMeta[] = [
  { id: 'pretendard',    label: 'Pretendard',         cssStack: `'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'inter',         label: 'Inter',              cssStack: `Inter, 'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'noto-sans-kr',  label: 'Noto Sans KR',       cssStack: `'Noto Sans KR', system-ui, sans-serif`, group: 'modern' },
  { id: 'ibm-plex-kr',   label: 'IBM Plex Sans KR',   cssStack: `'IBM Plex Sans KR', system-ui, sans-serif`, group: 'serious' },
  { id: 'spoqa',         label: 'Spoqa Han Sans Neo', cssStack: `'Spoqa Han Sans Neo', system-ui, sans-serif`, group: 'serious' },
  { id: 'nanum-gothic',  label: '나눔고딕',           cssStack: `'Nanum Gothic', system-ui, sans-serif`, group: 'soft' },
  { id: 'gowun-dodum',   label: '고운 도담',          cssStack: `'Gowun Dodum', system-ui, sans-serif`, group: 'soft' },
  { id: 'noto-serif-kr', label: '본명조',             cssStack: `'Noto Serif KR', serif`, group: 'character' },
  { id: 'system',        label: '시스템 기본',        cssStack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, group: 'system' },
];

export const DEFAULT_FONT_FAMILY = 'pretendard';

// ─── 간격 (Line Height / Letter Spacing) ─────────────

export const DEFAULT_LINE_HEIGHT = 1.55;
export const DEFAULT_LETTER_SPACING = 0;
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_STEP = 0.05;
export const LETTER_SPACING_MIN = -0.05;
export const LETTER_SPACING_MAX = 0.10;
export const LETTER_SPACING_STEP = 0.005;

// ─── DOM 적용 헬퍼 ──────────────────────────────────

/**
 * CSS `font-family` 값에 안전하게 끼워 넣을 수 있도록 sanitize + escape.
 * - Codex 1차 P2: applyFontFamily / injectCustomFontFace / 렌더러 inline style 양쪽이 같은 규칙을 따라야 함.
 * - Codex 6차 P3: CSS string은 raw newline/control char를 가질 수 없음 → 공백으로 정규화 후 backslash/quote escape.
 *   예: `Kid's\nSans` → `Kid's Sans` → `Kid\\'s Sans` → `'Kid\\'s Sans'` 가 유효한 CSS 값.
 */
export function escapeFontFamilyName(name: string): string {
  // 1. 제어 문자(newline/CR/tab/form-feed/vertical-tab/NUL~US/DEL) → 공백 → trim
  const sanitized = name.replace(/[ -]+/g, ' ').replace(/\s+/g, ' ').trim();
  // 2. backslash + single quote escape
  return sanitized.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function applyFontFamily(familyId: string, customFonts: CustomFont[] = []): void {
  const root = document.documentElement;
  let stack = FALLBACK_STACK;

  if (familyId.startsWith('custom:')) {
    const cf = customFonts.find((f) => f.id === familyId);
    if (cf) {
      injectCustomFontFace(cf);
      stack = `'${escapeFontFamilyName(cf.name)}', ${FALLBACK_STACK}`;
    }
    // 못 찾으면 폴백 → DEFAULT_FONT_FAMILY와 동일 효과
  } else {
    const meta = FONT_FAMILIES.find((f) => f.id === familyId);
    if (meta) stack = meta.cssStack;
  }

  root.style.setProperty('--font-family', stack);
}

export function applySpacing(lineHeight: number, letterSpacing: number): void {
  const root = document.documentElement;
  root.style.setProperty('--text-line-height', String(lineHeight));
  root.style.setProperty('--text-letter-spacing', `${letterSpacing}em`);
}

/** 사용자 폰트의 @font-face를 동적으로 <head>에 주입. 같은 id가 이미 있으면 skip. */
function injectCustomFontFace(font: CustomFont): void {
  if (document.querySelector(`style[data-font-id="${font.id}"]`)) return;
  const formatHint: Record<CustomFont['format'], string> = {
    otf: 'opentype', ttf: 'truetype', woff: 'woff', woff2: 'woff2',
  };
  const url = `bflow-font://${encodeURIComponent(font.filename)}`;
  const style = document.createElement('style');
  style.setAttribute('data-font-id', font.id);
  style.textContent = `@font-face { font-family: '${escapeFontFamilyName(font.name)}'; src: url('${url}') format('${formatHint[font.format]}'); font-display: swap; }`;
  document.head.appendChild(style);
}

/** 모든 사용자 폰트의 @font-face를 미리 주입 — 앱 시작 시 호출. */
export function ensureCustomFontsLoaded(customFonts: CustomFont[]): void {
  customFonts.forEach(injectCustomFontFace);
}
