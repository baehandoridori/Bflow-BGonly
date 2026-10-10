import type { BackgroundCameraColor } from './types.ts';

/** The colours a camera can be given, in the order the inspector shows them. `dark`/`light`: the value on each theme. */
export const MAP_CAMERA_COLORS: readonly { id: BackgroundCameraColor; label: string; dark: number; light: number }[] = [
  { id: 'red', label: '빨강', dark: 0xf2726b, light: 0xc2362f },
  { id: 'lime', label: '연두', dark: 0xb7d84b, light: 0x5f7f0f },
  { id: 'green', label: '초록', dark: 0x5fcf8b, light: 0x1f8a4c },
  { id: 'teal', label: '청록', dark: 0x45cfc4, light: 0x0b8a82 },
  { id: 'blue', label: '파랑', dark: 0x63a9f7, light: 0x1e6fd0 },
  { id: 'pink', label: '분홍', dark: 0xf58fb8, light: 0xc23f7c },
];
/** The value of a camera colour on a theme, or null for a name that is not in the palette (the caller keeps the default). */
export function cameraColorHex(color: BackgroundCameraColor, light: boolean): number | null {
  const found = MAP_CAMERA_COLORS.find(item => item.id === color);
  return found ? (light ? found.light : found.dark) : null;
}
