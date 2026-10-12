/**
 * The colours of the edit band: one that stands apart from the two colours of the theme (its accent and its second
 * accent), in a tone that stands apart from the page. No DOM, no imports: the editor feeds it what is on screen, the
 * tests feed it the presets.
 */
export type MapEditColors = { /** Fill of the band, colour of the frame and of the unsaved dot. "r g b". */ strip: string; /** Text and button lines on the band. "r g b". */ ink: string };
/**
 * The hues the band can have, the first one preferred. None is near red: an editing band is no error.
 * `bright` goes on a dark page with dark text, `deep` on a light page with white text.
 */
export const MAP_EDIT_TONES: readonly { id: string; bright: MapEditColors; deep: MapEditColors }[] = [
  { id: 'amber', bright: { strip: '245 178 64', ink: '28 22 8' }, deep: { strip: '128 81 0', ink: '255 255 255' } },
  { id: 'cyan', bright: { strip: '86 204 222', ink: '6 28 34' }, deep: { strip: '0 102 117', ink: '255 255 255' } },
  { id: 'purple', bright: { strip: '220 150 255', ink: '24 10 34' }, deep: { strip: '134 46 178', ink: '255 255 255' } },
];
/** The first tones of the list are the ones the band normally has. Those after them are a reserve. */
export const MAP_EDIT_MAIN_TONES = 2;
/** With every main tone closer than this (degrees of hue) to a colour of the theme, the reserve is looked at. */
export const MAP_EDIT_RESERVE_BELOW = 60;
/** Below this spread of the three channels (of 1) a colour has no hue to stand apart from: a grey, near-white or near-black accent. */
export const MAP_EDIT_MIN_CHROMA = 0.08;

/** "r g b" as three numbers of 0 to 255, or null. Commas and slashes are read as spaces. */
export function colorTriple(text: string): [number, number, number] | null {
  const parts = String(text).trim().split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  return parts.length === 3 && parts.every(value => Number.isFinite(value) && value >= 0 && value <= 255) ? [parts[0], parts[1], parts[2]] : null;
}
/** Hue in degrees, or null for a colour without one. */
export function colorHue(rgb: readonly number[]): number | null {
  const [r, g, b] = rgb.map(value => value / 255), max = Math.max(r, g, b), spread = max - Math.min(r, g, b);
  if (spread < MAP_EDIT_MIN_CHROMA) return null;
  return 60 * (max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4);
}
export function hueDistance(a: number, b: number): number {
  const apart = Math.abs(a - b) % 360;
  return apart > 180 ? 360 - apart : apart;
}
function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map(value => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio of two colours, 1 to 21. */
export function colorContrast(a: readonly number[], b: readonly number[]): number {
  const one = luminance(a), other = luminance(b);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}
const rgbOf = (colors: MapEditColors) => colorTriple(colors.strip) as [number, number, number];

export function mapEditColors(accent: string, accentSub: string, page: string): MapEditColors {
  // The colours of the theme that have a hue. A grey, a near-white, a near-black and an unreadable value have none.
  const hues = [accent, accentSub].map(text => { const rgb = colorTriple(text); return rgb ? colorHue(rgb) : null; }).filter((hue): hue is number => hue !== null);
  let pick = MAP_EDIT_TONES[0], farthest = -1;
  // Without a hue in the theme there is nothing to stand apart from: the first of the list.
  if (hues.length) MAP_EDIT_TONES.forEach((tone, index) => {
    // A reserve tone is looked at only while every main tone is too near a colour of the theme.
    if (index >= MAP_EDIT_MAIN_TONES && farthest >= MAP_EDIT_RESERVE_BELOW) return;
    // How far the tone is from the theme: its hue distance to the nearer of the theme's colours.
    const toneHue = colorHue(rgbOf(tone.bright)) as number, apart = Math.min(...hues.map(hue => hueDistance(hue, toneHue)));
    if (apart > farthest) { farthest = apart; pick = tone; }
  });
  // Of its two tones, the one that stands out more from the page as it is painted: no attribute is asked which mode this is.
  const pageRgb = colorTriple(page);
  return !pageRgb || colorContrast(rgbOf(pick.bright), pageRgb) >= colorContrast(rgbOf(pick.deep), pageRgb) ? pick.bright : pick.deep;
}
