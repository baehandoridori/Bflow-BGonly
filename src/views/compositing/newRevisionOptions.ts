import type { Episode, Part, Scene } from '@/types';

export interface RevisionPartOption {
  partId: string;
  part: Part;
}

export interface RevisionPartScenesUnion {
  scenes: Scene[];
  sourceMap: Map<string, Part>;
}

function normalizePartIdKey(partId: string | null | undefined): string {
  return (partId ?? '').trim().toLowerCase();
}

export function formatRevisionPartId(partId: string | null | undefined): string {
  return (partId ?? '').trim().toUpperCase();
}

export function buildRevisionPartOptions(
  episode: Episode | null | undefined,
): RevisionPartOption[] {
  if (!episode) return [];

  const map = new Map<string, RevisionPartOption>();
  for (const part of episode.parts) {
    const key = normalizePartIdKey(part.partId);
    if (!key) continue;

    const current = map.get(key);
    if (!current || part.department === 'bg') {
      map.set(key, {
        partId: formatRevisionPartId(part.partId),
        part,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.partId.localeCompare(b.partId, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function buildRevisionPartScenesUnion(
  episode: Episode | null | undefined,
  selectedPart: Part | null | undefined,
): RevisionPartScenesUnion {
  if (!episode || !selectedPart) {
    return { scenes: [], sourceMap: new Map() };
  }

  const selectedPartKey = normalizePartIdKey(selectedPart.partId);
  const matchingParts = episode.parts
    .filter((part) => normalizePartIdKey(part.partId) === selectedPartKey)
    .sort((a, b) => (a.department === 'bg' ? 0 : 1) - (b.department === 'bg' ? 0 : 1));

  const seenSceneIds = new Set<string>();
  const scenes: Scene[] = [];
  const sourceMap = new Map<string, Part>();

  for (const part of matchingParts) {
    for (const scene of part.scenes) {
      const sceneKey = scene.sceneId.trim().toLowerCase();
      if (!sceneKey || seenSceneIds.has(sceneKey)) continue;
      seenSceneIds.add(sceneKey);
      scenes.push(scene);
      sourceMap.set(scene.sceneId, part);
      sourceMap.set(sceneKey, part);
    }
  }

  return { scenes, sourceMap };
}

export function getSourcePartForRevisionScene(
  sourceMap: Map<string, Part>,
  sceneId: string,
  fallbackPart: Part,
): Part {
  return sourceMap.get(sceneId) ?? sourceMap.get(sceneId.trim().toLowerCase()) ?? fallbackPart;
}
