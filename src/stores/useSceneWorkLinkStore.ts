import { create } from 'zustand';
import type { SceneWorkLink, SceneWorkLinkDepartment } from '@/types';
import {
  deleteSceneWorkLink,
  readSceneWorkLinks,
  upsertSceneWorkLink,
  type UpsertSceneWorkLinkInput,
} from '@/services/sceneWorkLinkService';
import {
  applySceneWorkLinkRealtimeRows,
  buildSceneWorkLinkMap,
  getWorkLinkSlotKey,
  mapSceneWorkLinkRow,
  mergeSceneWorkLinkLoadResult,
} from '@/utils/sceneWorkLinks';

interface SceneWorkLinkState {
  links: SceneWorkLink[];
  linkMap: Map<string, SceneWorkLink>;
  loading: boolean;
  loadForSceneUuids: (sceneUuids: string[]) => Promise<void>;
  upsertLink: (input: UpsertSceneWorkLinkInput) => Promise<void>;
  deleteLink: (
    sceneUuid: string,
    department: SceneWorkLinkDepartment,
    linkKind: 'folder' | 'primary_file',
  ) => Promise<void>;
  applyRealtime: (payload: unknown) => void;
  getLink: (
    sceneUuid: string | undefined | null,
    department: SceneWorkLinkDepartment,
    linkKind: 'folder' | 'primary_file',
  ) => SceneWorkLink | undefined;
}

function withMap(links: SceneWorkLink[]) {
  return { links, linkMap: buildSceneWorkLinkMap(links) };
}

let mutationSequence = 0;
const touchedSlotSequences = new Map<string, number>();

function markSlotTouched(input: {
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLink['linkKind'];
}) {
  mutationSequence += 1;
  touchedSlotSequences.set(getWorkLinkSlotKey(input.sceneUuid, input.department, input.linkKind), mutationSequence);
}

function markRealtimeSlotTouched(
  row: Record<string, unknown>,
  eventType: string,
  currentLinks: SceneWorkLink[],
) {
  const rowSceneUuid = row.scene_uuid ?? row.sceneUuid;
  if (rowSceneUuid) {
    markSlotTouched(mapSceneWorkLinkRow(row));
    return;
  }

  if (eventType !== 'DELETE') return;
  const rowId = String(row.id ?? '');
  const existing = currentLinks.find((link) => link.id === rowId);
  if (existing) markSlotTouched(existing);
}

function getTouchedSlotKeysAfter(sequence: number): Set<string> {
  const keys = new Set<string>();
  for (const [key, touchedAt] of touchedSlotSequences) {
    if (touchedAt > sequence) keys.add(key);
  }
  return keys;
}

export const useSceneWorkLinkStore = create<SceneWorkLinkState>((set, get) => ({
  links: [],
  linkMap: new Map(),
  loading: false,

  loadForSceneUuids: async (sceneUuids) => {
    const unique = Array.from(new Set(sceneUuids.filter(Boolean)));
    if (unique.length === 0) return;
    const loadStartedAt = mutationSequence;

    set({ loading: true });
    try {
      const rows = await readSceneWorkLinks(unique);
      const preserveSlotKeys = getTouchedSlotKeysAfter(loadStartedAt);
      set({
        ...withMap(mergeSceneWorkLinkLoadResult(get().links, rows, unique, preserveSlotKeys)),
        loading: false,
      });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  upsertLink: async (input) => {
    const previous = get().links;
    markSlotTouched(input);
    const now = new Date().toISOString();
    const optimistic: SceneWorkLink = {
      id: `optimistic:${input.sceneUuid}:${input.department}:${input.linkKind}`,
      sceneUuid: input.sceneUuid,
      department: input.department,
      linkKind: input.linkKind,
      path: input.path,
      label: input.label ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdBy: input.userId ?? null,
      createdAt: now,
      updatedBy: input.userId ?? null,
      updatedAt: now,
    };
    const withoutSlot = previous.filter((link) =>
      !(link.sceneUuid === input.sceneUuid
        && link.department === input.department
        && link.linkKind === input.linkKind)
    );
    set(withMap([...withoutSlot, optimistic]));

    try {
      const saved = await upsertSceneWorkLink(input);
      const replaced = get().links.filter((link) =>
        !(link.sceneUuid === input.sceneUuid
          && link.department === input.department
          && link.linkKind === input.linkKind)
      );
      set(withMap([...replaced, saved]));
    } catch (err) {
      set(withMap(previous));
      throw err;
    }
  },

  deleteLink: async (sceneUuid, department, linkKind) => {
    const previous = get().links;
    markSlotTouched({ sceneUuid, department, linkKind });
    set(withMap(previous.filter((link) =>
      !(link.sceneUuid === sceneUuid && link.department === department && link.linkKind === linkKind)
    )));
    try {
      await deleteSceneWorkLink(sceneUuid, department, linkKind);
    } catch (err) {
      set(withMap(previous));
      throw err;
    }
  },

  applyRealtime: (payload) => {
    const p = payload as {
      eventType?: string;
      new?: Record<string, unknown>;
      old?: Record<string, unknown>;
    } | null;
    if (!p?.eventType) return;
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row) return;
    markRealtimeSlotTouched(row, p.eventType, get().links);
    set(withMap(applySceneWorkLinkRealtimeRows(get().links, { eventType: p.eventType, row })));
  },

  getLink: (sceneUuid, department, linkKind) => {
    if (!sceneUuid) return undefined;
    return get().linkMap.get(getWorkLinkSlotKey(sceneUuid, department, linkKind));
  },
}));
