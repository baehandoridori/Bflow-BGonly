import type {
  SceneWorkLink,
  SceneWorkLinkDepartment,
  SceneWorkLinkKind,
} from '../types/index.ts';

export type WorkLinkWarning = 'personal_path' | 'maybe_not_file' | 'maybe_not_folder';

export function getWorkLinkSlotKey(
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  kind: SceneWorkLinkKind,
): string {
  return `${sceneUuid}:${department}:${kind}`;
}

export function buildSceneWorkLinkMap(links: SceneWorkLink[]): Map<string, SceneWorkLink> {
  const map = new Map<string, SceneWorkLink>();
  for (const link of links) {
    if (link.linkKind === 'extra_file') continue;
    map.set(getWorkLinkSlotKey(link.sceneUuid, link.department, link.linkKind), link);
  }
  return map;
}

export function getSceneWorkLinkSlots(
  map: Map<string, SceneWorkLink>,
  sceneUuid: string | null | undefined,
  department: SceneWorkLinkDepartment,
): { folder?: SceneWorkLink; primaryFile?: SceneWorkLink } {
  if (!sceneUuid) return {};
  return {
    folder: map.get(getWorkLinkSlotKey(sceneUuid, department, 'folder')),
    primaryFile: map.get(getWorkLinkSlotKey(sceneUuid, department, 'primary_file')),
  };
}

export function getUniqueSceneUuids(
  scenes: Array<{ id?: string | null } | null | undefined>,
): string[] {
  return Array.from(new Set(
    scenes
      .map((scene) => scene?.id)
      .filter((id): id is string => Boolean(id)),
  )).sort();
}

export function isLikelyPersonalPath(input: string): boolean {
  const normalized = input.trim().replace(/\//g, '\\').toLowerCase();
  return (
    /^[a-z]:\\users\\[^\\]+\\/.test(normalized) ||
    /^[a-z]:\\documents and settings\\[^\\]+\\/.test(normalized)
  );
}

function hasFileExtension(input: string): boolean {
  const leaf = input.trim().replace(/\//g, '\\').split('\\').filter(Boolean).pop() ?? '';
  return /\.[^.\s\\/:*?"<>|]+$/.test(leaf);
}

export function getWorkLinkWarnings(
  path: string,
  expectedKind: 'folder' | 'primary_file',
): WorkLinkWarning[] {
  const trimmed = path.trim();
  const warnings: WorkLinkWarning[] = [];
  if (!trimmed) return warnings;

  if (isLikelyPersonalPath(trimmed)) warnings.push('personal_path');

  const normalized = trimmed.replace(/\//g, '\\');
  if (expectedKind === 'primary_file' && (!hasFileExtension(normalized) || /\\$/.test(normalized))) {
    warnings.push('maybe_not_file');
  }
  if (expectedKind === 'folder' && hasFileExtension(normalized)) {
    warnings.push('maybe_not_folder');
  }

  return warnings;
}

export function mapSceneWorkLinkRow(row: Record<string, unknown>): SceneWorkLink {
  const rawDepartment = row.department;
  const rawKind = row.link_kind ?? row.linkKind;
  return {
    id: String(row.id ?? ''),
    sceneUuid: String(row.scene_uuid ?? row.sceneUuid ?? ''),
    department: rawDepartment === 'acting' ? 'acting' : 'bg',
    linkKind:
      rawKind === 'primary_file'
        ? 'primary_file'
        : rawKind === 'extra_file'
          ? 'extra_file'
          : 'folder',
    path: String(row.path ?? ''),
    label: typeof row.label === 'string' ? row.label : null,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0) || 0,
    createdBy:
      typeof row.created_by === 'string'
        ? row.created_by
        : typeof row.createdBy === 'string'
          ? row.createdBy
          : null,
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    updatedBy:
      typeof row.updated_by === 'string'
        ? row.updated_by
        : typeof row.updatedBy === 'string'
          ? row.updatedBy
          : null,
    updatedAt: String(row.updated_at ?? row.updatedAt ?? ''),
  };
}

export function applySceneWorkLinkRealtimeRows(
  current: SceneWorkLink[],
  event: { eventType: 'INSERT' | 'UPDATE' | 'DELETE' | string; row: Record<string, unknown> },
): SceneWorkLink[] {
  const id = String(event.row.id ?? '');
  if (!id) return current;
  if (event.eventType === 'DELETE') return current.filter((link) => link.id !== id);

  const mapped = mapSceneWorkLinkRow(event.row);
  const index = current.findIndex((link) => link.id === id);
  if (index < 0) return [...current, mapped];

  const next = [...current];
  next[index] = { ...next[index], ...mapped };
  return next;
}
