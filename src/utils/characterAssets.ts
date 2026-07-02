import type { CharacterImageFit, CharacterImageBackground } from '../types/index.ts';

export const DEFAULT_CHARACTER_IMAGE_BACKGROUND: CharacterImageBackground = 'transparent';

export const DEFAULT_CHARACTER_IMAGE_FIT: CharacterImageFit = {
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  x: 0,
  y: 0,
  lockAspect: true,
};

function splitPathAt(path: string): { normalized: string; index: number } {
  const trimmed = path.trim();
  if (!trimmed) return { normalized: '', index: -1 };
  const normalized = trimmed.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return { normalized, index: idx };
}

export function getParentFolderPath(filePath: string): string {
  const { normalized, index } = splitPathAt(filePath);
  if (index <= 0) return '';
  return normalized.slice(0, index);
}

export function getPathBaseName(path: string | null | undefined): string {
  const { normalized, index } = splitPathAt(path ?? '');
  if (!normalized) return '';
  if (index < 0) return normalized;
  return normalized.slice(index + 1);
}

export function resolveCharacterImageFitScales(fit: CharacterImageFit): { scaleX: number; scaleY: number } {
  const normalized = normalizeCharacterImageFit(fit);
  return {
    scaleX: normalized.lockAspect ? normalized.scale : (normalized.scaleX ?? normalized.scale),
    scaleY: normalized.lockAspect ? normalized.scale : (normalized.scaleY ?? normalized.scale),
  };
}

export function getCharacterImageFitTransformStyle(fit: CharacterImageFit): { transform: string; transformOrigin: string } {
  const normalized = normalizeCharacterImageFit(fit);
  const { scaleX, scaleY } = resolveCharacterImageFitScales(normalized);
  return {
    transform: `translate(${normalized.x}%, ${normalized.y}%) scale(${scaleX}, ${scaleY})`,
    transformOrigin: 'center center',
  };
}

export function getResolvedCharacterFolderAfterFilePick(
  currentFolderPath: string | null | undefined,
  pickedFilePath: string,
): string {
  const current = (currentFolderPath ?? '').trim();
  if (current) return current;
  return getParentFolderPath(pickedFilePath);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampScale(value: unknown, fallback: number): number {
  return Math.min(8, Math.max(0.25, finiteNumber(value, fallback)));
}

function clampOffsetPercent(value: unknown, fallback: number): number {
  return Math.min(100, Math.max(-100, finiteNumber(value, fallback)));
}

export function normalizeCharacterImageFit(value: unknown): CharacterImageFit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CHARACTER_IMAGE_FIT };
  }
  const record = value as Record<string, unknown>;
  const scale = clampScale(record.scale, DEFAULT_CHARACTER_IMAGE_FIT.scale);
  const lockAspect = typeof record.lockAspect === 'boolean' ? record.lockAspect : DEFAULT_CHARACTER_IMAGE_FIT.lockAspect;
  return {
    scale,
    scaleX: clampScale(record.scaleX, scale),
    scaleY: clampScale(record.scaleY, scale),
    x: clampOffsetPercent(record.x, DEFAULT_CHARACTER_IMAGE_FIT.x),
    y: clampOffsetPercent(record.y, DEFAULT_CHARACTER_IMAGE_FIT.y),
    lockAspect,
  };
}

export function normalizeCharacterImageBackground(value: unknown): CharacterImageBackground {
  if (value === 'transparent' || value === 'black' || value === 'white' || value === 'checker') return value;
  return DEFAULT_CHARACTER_IMAGE_BACKGROUND;
}
