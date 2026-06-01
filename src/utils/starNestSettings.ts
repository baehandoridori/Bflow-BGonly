export type BackgroundArt = 'plexus' | 'starnest';
export type StarNestDirectionMode = 'fixed' | 'manual' | 'mouse';
export type StarNestTonePreset = 'bflow' | 'classic' | 'quiet';

export interface StarNestSettings {
  directionMode: StarNestDirectionMode;
  directionX: number;
  directionY: number;
  maxSpeed: number;
  brightness: number;
  saturation: number;
  colorShift: number;
  sparkle: number;
  sparkleSpeed: number;
  zoom: number;
  darkmatter: number;
  distfade: number;
  angleX: number;
  angleY: number;
  iterations: number;
  quality: number;
}

export const DEFAULT_BACKGROUND_ART: BackgroundArt = 'plexus';
export const DEFAULT_DASHBOARD_STAR_NEST_OPACITY = 1;
export const DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX = 0;

export const DEFAULT_STAR_NEST_SETTINGS: StarNestSettings = {
  directionMode: 'mouse',
  directionX: 0.18,
  directionY: 0.08,
  maxSpeed: 0.002,
  brightness: 0.0015,
  saturation: 0.72,
  colorShift: 0,
  sparkle: 0.45,
  sparkleSpeed: 1,
  zoom: 0.76,
  darkmatter: 0.38,
  distfade: 0.7,
  angleX: 0.54,
  angleY: 0.74,
  iterations: 17,
  quality: 16,
};

export const STAR_NEST_TONE_PRESETS: Record<StarNestTonePreset, {
  label: string;
  settings: Partial<StarNestSettings>;
}> = {
  bflow: {
    label: 'Bflow 톤',
    settings: {
      brightness: 0.0015,
      saturation: 0.72,
      colorShift: 0,
      sparkle: 0.45,
      sparkleSpeed: 1,
      zoom: 0.76,
      darkmatter: 0.38,
      distfade: 0.7,
    },
  },
  classic: {
    label: '기본 톤',
    settings: {
      brightness: 0.0018,
      saturation: 0.82,
      colorShift: 0.18,
      sparkle: 0.55,
      sparkleSpeed: 1.15,
      zoom: 0.74,
      darkmatter: 0.34,
      distfade: 0.68,
    },
  },
  quiet: {
    label: '조용한 톤',
    settings: {
      brightness: 0.001,
      saturation: 0.52,
      colorShift: -0.08,
      sparkle: 0.22,
      sparkleSpeed: 0.42,
      zoom: 0.8,
      darkmatter: 0.46,
      distfade: 0.74,
    },
  },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseRgbTuple(rgb: unknown): [number, number, number] | null {
  if (Array.isArray(rgb) && rgb.length >= 3) {
    const parsed = rgb.slice(0, 3).map(Number);
    if (parsed.every(Number.isFinite)) return [parsed[0], parsed[1], parsed[2]];
  }
  if (typeof rgb === 'string') {
    const parsed = rgb.trim().split(/\s+/).slice(0, 3).map(Number);
    if (parsed.length === 3 && parsed.every(Number.isFinite)) return [parsed[0], parsed[1], parsed[2]];
  }
  return null;
}

function rgbToHue([r, g, b]: [number, number, number]): number {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  if (max === min) return 260;
  const d = max - min;
  let h = 0;
  if (max === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) / 6;
  else if (max === ng) h = ((nb - nr) / d + 2) / 6;
  else h = ((nr - ng) / d + 4) / 6;
  return h * 360;
}

export function normalizeStarNestSettings(settings?: Partial<StarNestSettings> | null): StarNestSettings {
  return {
    directionMode:
      settings?.directionMode === 'fixed' || settings?.directionMode === 'manual' || settings?.directionMode === 'mouse'
        ? settings.directionMode
        : DEFAULT_STAR_NEST_SETTINGS.directionMode,
    directionX: clamp(settings?.directionX, -1, 1, DEFAULT_STAR_NEST_SETTINGS.directionX),
    directionY: clamp(settings?.directionY, -1, 1, DEFAULT_STAR_NEST_SETTINGS.directionY),
    maxSpeed: clamp(settings?.maxSpeed, 0, DEFAULT_STAR_NEST_SETTINGS.maxSpeed, DEFAULT_STAR_NEST_SETTINGS.maxSpeed),
    brightness: clamp(settings?.brightness, 0.0002, 0.006, DEFAULT_STAR_NEST_SETTINGS.brightness),
    saturation: clamp(settings?.saturation, 0, 1, DEFAULT_STAR_NEST_SETTINGS.saturation),
    colorShift: clamp(settings?.colorShift, -1, 1, DEFAULT_STAR_NEST_SETTINGS.colorShift),
    sparkle: clamp(settings?.sparkle, 0, 1, DEFAULT_STAR_NEST_SETTINGS.sparkle),
    sparkleSpeed: clamp(settings?.sparkleSpeed, 0.1, 3, DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed),
    zoom: clamp(settings?.zoom, 0.55, 0.95, DEFAULT_STAR_NEST_SETTINGS.zoom),
    darkmatter: clamp(settings?.darkmatter, 0.2, 0.62, DEFAULT_STAR_NEST_SETTINGS.darkmatter),
    distfade: clamp(settings?.distfade, 0.58, 0.82, DEFAULT_STAR_NEST_SETTINGS.distfade),
    angleX: clamp(settings?.angleX, 0, 1, DEFAULT_STAR_NEST_SETTINGS.angleX),
    angleY: clamp(settings?.angleY, 0, 1, DEFAULT_STAR_NEST_SETTINGS.angleY),
    iterations: Math.round(clamp(settings?.iterations, 10, 22, DEFAULT_STAR_NEST_SETTINGS.iterations)),
    quality: Math.round(clamp(settings?.quality, 8, 20, DEFAULT_STAR_NEST_SETTINGS.quality)),
  };
}

export function normalizeDashboardStarNestOpacity(value: unknown): number {
  return clamp(value, 0.2, 1, DEFAULT_DASHBOARD_STAR_NEST_OPACITY);
}

export function normalizeDashboardStarNestBlurPx(value: unknown): number {
  return clamp(value, 0, 20, DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX);
}

export function applyStarNestTonePreset(
  preset: StarNestTonePreset,
  current?: Partial<StarNestSettings> | null,
): StarNestSettings {
  return normalizeStarNestSettings({
    ...normalizeStarNestSettings(current),
    ...STAR_NEST_TONE_PRESETS[preset].settings,
  });
}

export function getThemeSyncedStarNestSettings(
  accentRgb: unknown,
  accentSubRgb: unknown,
  current?: Partial<StarNestSettings> | null,
): StarNestSettings {
  const accent = parseRgbTuple(accentRgb) ?? [108, 92, 231];
  const accentSub = parseRgbTuple(accentSubRgb) ?? [162, 155, 254];
  const hue = rgbToHue(accent);
  const subHue = rgbToHue(accentSub);
  const avgHue = (hue * 0.72) + (subHue * 0.28);
  let colorShift = 0;
  if (avgHue >= 150 && avgHue < 205) colorShift = 0.62;
  else if (avgHue >= 205 && avgHue < 260) colorShift = 0.18;
  else if (avgHue >= 260 && avgHue < 315) colorShift = -0.12;
  else if (avgHue >= 315 || avgHue < 25) colorShift = -0.36;
  else if (avgHue >= 25 && avgHue < 80) colorShift = 0.82;
  else colorShift = 0.36;

  return normalizeStarNestSettings({
    ...normalizeStarNestSettings(current),
    colorShift,
    saturation: 0.68,
    brightness: 0.00145,
    sparkle: 0.4,
    sparkleSpeed: 0.9,
  });
}

export function normalizeBackgroundArt(art: unknown): BackgroundArt {
  return art === 'starnest' ? 'starnest' : DEFAULT_BACKGROUND_ART;
}
