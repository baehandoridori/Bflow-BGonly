import { create } from 'zustand';
import type { CompRevision, RevisionPriority, RevisionStatus } from '@/types';
import * as revisionService from '@/services/revisionService';

interface RevisionState {
  revisions: CompRevision[];
  revisionCountByScene: Record<string, number>; // sceneKey → open count
  totalOpenRevisionCount: number;
  isLoading: boolean;
  lastLoadTime: number | null;

  loadRevisions: () => Promise<void>;
  addRevisionOptimistic: (revision: CompRevision) => void;
  updateRevisionOptimistic: (id: string, sceneKey: string, updates: Partial<CompRevision>) => void;

  createRevision: (
    sceneKey: string,
    data: {
      description: string;
      priority?: RevisionPriority;
      frameNo?: string;
      imageUrl?: string;
      department?: 'bg' | 'acting';
      lookupDepartment?: 'bg' | 'acting';
      requesterId: string;
      requesterName: string;
      assignee?: string;
    },
  ) => Promise<CompRevision>;

  updateStatus: (
    id: string,
    sceneKey: string,
    status: RevisionStatus,
    extra?: { resolvedBy?: string; resolvedNote?: string },
  ) => Promise<void>;

  getRevisionsForScene: (sceneKey: string) => CompRevision[];
  getOpenCount: (sceneKey: string) => number;
}

function buildCountMap(revisions: CompRevision[]): Record<string, number> {
  return revisionService.buildOpenRevisionCountMap(revisions);
}

function countOpenRevisions(revisions: CompRevision[]): number {
  const openRevisionIds = new Set<string>();
  revisions.forEach((revision) => {
    if (revision.status !== 'resolved') {
      openRevisionIds.add(revision.id);
    }
  });
  return openRevisionIds.size;
}

function getRevisionLookupKeys(sceneKey: string): Set<string> {
  return new Set(revisionService.getRevisionLookupSceneKeys(sceneKey));
}

export const useRevisionStore = create<RevisionState>((set, get) => ({
  revisions: [],
  revisionCountByScene: {},
  totalOpenRevisionCount: 0,
  isLoading: false,
  lastLoadTime: null,

  loadRevisions: async () => {
    set({ isLoading: true });
    try {
      const all = await revisionService.getAllRevisions();
      set({
        revisions: all,
        revisionCountByScene: buildCountMap(all),
        totalOpenRevisionCount: countOpenRevisions(all),
        lastLoadTime: Date.now(),
      });
    } catch (err) {
      console.error('[리비전 스토어] 로드 실패:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  addRevisionOptimistic: (revision) => {
    set((state) => {
      const revisions = [...state.revisions, revision];
      return {
        revisions,
        revisionCountByScene: buildCountMap(revisions),
        totalOpenRevisionCount: countOpenRevisions(revisions),
      };
    });
  },

  updateRevisionOptimistic: (id, sceneKey, updates) => {
    set((state) => {
      const lookupKeys = getRevisionLookupKeys(sceneKey);
      const revisions = state.revisions.map((r) =>
        r.id === id && lookupKeys.has(r.sceneKey) ? { ...r, ...updates } : r,
      );
      return {
        revisions,
        revisionCountByScene: buildCountMap(revisions),
        totalOpenRevisionCount: countOpenRevisions(revisions),
      };
    });
  },

  createRevision: async (sceneKey, data) => {
    const revision = await revisionService.createRevision(sceneKey, data);
    get().addRevisionOptimistic(revision);
    return revision;
  },

  updateStatus: async (id, sceneKey, status, extra) => {
    const now = new Date().toISOString();
    // 낙관적 업데이트
    get().updateRevisionOptimistic(id, sceneKey, {
      status,
      updatedAt: now,
      ...(status === 'resolved'
        ? { resolvedAt: now, resolvedBy: extra?.resolvedBy, resolvedNote: extra?.resolvedNote }
        : { resolvedAt: undefined, resolvedBy: undefined, resolvedNote: undefined }),
    });

    try {
      await revisionService.updateRevisionStatus(id, sceneKey, status, extra);
    } catch (err) {
      console.error('[리비전 스토어] 상태 업데이트 실패:', err);
      // 롤백: 다시 로드
      await get().loadRevisions();
    }
  },

  getRevisionsForScene: (sceneKey) => {
    const lookupKeys = getRevisionLookupKeys(sceneKey);
    return get().revisions.filter((r) => lookupKeys.has(r.sceneKey));
  },

  getOpenCount: (sceneKey) => {
    const lookupKeys = getRevisionLookupKeys(sceneKey);
    return get().revisions.filter((r) =>
      lookupKeys.has(r.sceneKey) && r.status !== 'resolved',
    ).length;
  },
}));
