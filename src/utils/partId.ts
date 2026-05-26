import type { Department } from '@/types';

export interface PartIdLike {
  partId: string;
  department?: Department;
}

export function normalizePartIdKey(partId: string | null | undefined): string {
  return (partId ?? '').trim().toLowerCase();
}

export function partIdMatches(
  candidate: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const candidateKey = normalizePartIdKey(candidate);
  const targetKey = normalizePartIdKey(target);
  return !!candidateKey && !!targetKey && candidateKey === targetKey;
}

export function findPartById<T extends PartIdLike>(
  parts: T[],
  partId: string | null | undefined,
  department?: Department,
): T | undefined {
  const key = normalizePartIdKey(partId);
  if (!key) return undefined;
  return parts.find((part) => (
    (!department || part.department === department)
    && normalizePartIdKey(part.partId) === key
  ));
}

export function getCanonicalPartIds(parts: PartIdLike[]): string[] {
  const grouped = new Map<string, string>();

  for (const part of parts) {
    const key = normalizePartIdKey(part.partId);
    if (!key) continue;

    const current = grouped.get(key);
    if (!current || part.department === 'bg') {
      grouped.set(key, part.partId);
    }
  }

  return Array.from(grouped.values());
}
