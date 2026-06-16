import type { Scene } from '@/types';

export interface ParsedSceneNumberSuffix {
  prefix: string;
  number: number;
  suffix: string;
}

export function parseSceneNumberSuffix(sceneId: string | null | undefined): ParsedSceneNumberSuffix {
  const raw = (sceneId ?? '').trim();
  const match = raw.match(/^(.*?)(\d+)([A-Za-z]*)$/);
  if (!match) {
    return {
      prefix: raw,
      number: Number.POSITIVE_INFINITY,
      suffix: '',
    };
  }

  return {
    prefix: match[1] ?? '',
    number: Number.parseInt(match[2] ?? '0', 10),
    suffix: (match[3] ?? '').toUpperCase(),
  };
}

export function compareSceneIdsByNumberThenSuffix(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseSceneNumberSuffix(a);
  const right = parseSceneNumberSuffix(b);

  if (left.number !== right.number) return left.number - right.number;
  const suffixCmp = left.suffix.localeCompare(right.suffix, undefined, { numeric: true, sensitivity: 'base' });
  if (suffixCmp !== 0) return suffixCmp;
  return left.prefix.localeCompare(right.prefix, undefined, { numeric: true, sensitivity: 'base' });
}

export function compareScenesByNumberThenSuffix(a: Scene, b: Scene): number {
  const sceneIdCmp = compareSceneIdsByNumberThenSuffix(a.sceneId, b.sceneId);
  if (sceneIdCmp !== 0) return sceneIdCmp;
  return (a.no ?? 0) - (b.no ?? 0);
}
