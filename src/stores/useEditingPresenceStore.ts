// src/stores/useEditingPresenceStore.ts
import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { selectEditorsForScenes } from '@/utils/editingPresence';
import type { EditingPresenceSnapshot, EditingUser } from '@/types';

interface EditingPresenceState {
  byScene: EditingPresenceSnapshot;
  applyPresenceSnapshot: (snapshot: EditingPresenceSnapshot) => void;
}

export const useEditingPresenceStore = create<EditingPresenceState>((set) => ({
  byScene: {},
  applyPresenceSnapshot: (snapshot) => set({ byScene: snapshot ?? {} }),
}));

/** 여러 sceneUuid의 편집자(자기 자신 제외) */
export function useSceneEditingPresence(sceneUuids: Array<string | null | undefined>): EditingUser[] {
  const byScene = useEditingPresenceStore((s) => s.byScene);
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  return selectEditorsForScenes(byScene, sceneUuids, currentUserId);
}
