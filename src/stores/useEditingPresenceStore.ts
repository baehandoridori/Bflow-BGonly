// src/stores/useEditingPresenceStore.ts
import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { selectEditorsForScenes, hasSceneCollision } from '@/utils/editingPresence';
import type { PresenceEditor } from '@/utils/editingPresence';
import type { EditingPresenceSnapshot } from '@/types';

interface EditingPresenceState {
  byScene: EditingPresenceSnapshot;
  applyPresenceSnapshot: (snapshot: EditingPresenceSnapshot) => void;
}

export const useEditingPresenceStore = create<EditingPresenceState>((set) => ({
  byScene: {},
  applyPresenceSnapshot: (snapshot) => set({ byScene: snapshot ?? {} }),
}));

/** 여러 sceneUuid의 편집자(자기 자신 포함 — 본인은 '나'로 표시) */
export function useSceneEditingPresence(sceneUuids: Array<string | null | undefined>): PresenceEditor[] {
  const byScene = useEditingPresenceStore((s) => s.byScene);
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  return selectEditorsForScenes(byScene, sceneUuids, currentUserId);
}

/** 주어진 씬(파일)들 중 하나라도 2명 이상이 동시 편집이면 true (통합 카드/행 경고용 — 유니온 거짓충돌 방지) */
export function useSceneCollisionWarn(sceneUuids: Array<string | null | undefined>): boolean {
  const byScene = useEditingPresenceStore((s) => s.byScene);
  return hasSceneCollision(byScene, sceneUuids);
}
