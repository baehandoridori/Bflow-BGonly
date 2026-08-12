// src/stores/useEditingPresenceStore.ts
import { create } from 'zustand';
import { useAuthStore } from './useAuthStore';
import { selectEditorsForScenes, hasSceneCollision } from '@/utils/editingPresence';
import type { PresenceEditor } from '@/utils/editingPresence';
import type { EditingPresenceSnapshot, PresenceKind, PresenceSnapshotBundle } from '@/types';

interface EditingPresenceState {
  /** kind('scene'·'costume'·…) -> 스냅샷 (피드백 54 일반화). */
  byKind: PresenceSnapshotBundle;
  /** 씬 시트의 스토어 1회 구독 경로를 유지하는 scene kind 호환 미러. */
  byScene: EditingPresenceSnapshot;
  applyPresenceSnapshot: (bundle: PresenceSnapshotBundle | null | undefined) => void;
}

export const useEditingPresenceStore = create<EditingPresenceState>((set) => ({
  byKind: {},
  byScene: {},
  applyPresenceSnapshot: (bundle) => {
    const byKind = bundle ?? {};
    set({ byKind, byScene: byKind['scene'] ?? {} });
  },
}));

// 없는 kind 조회 시 참조 안정 빈 스냅샷 — 셀렉터가 매 렌더 새 객체를 만들지 않게.
const EMPTY_SNAPSHOT: EditingPresenceSnapshot = {};

/** kind 무관 공용 훅 — 새 파일 종류를 붙일 때도 이 두 훅만 쓰면 된다 (피드백 54). */
export function useEntityEditingPresence(kind: PresenceKind, uuids: Array<string | null | undefined>): PresenceEditor[] {
  const snapshot = useEditingPresenceStore((s) => s.byKind[kind] ?? EMPTY_SNAPSHOT);
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);
  return selectEditorsForScenes(snapshot, uuids, currentUserId);
}

/** 주어진 파일들 중 하나라도 2명 이상 동시 편집이면 true — 유니온 거짓충돌 방지. */
export function useEntityCollisionWarn(kind: PresenceKind, uuids: Array<string | null | undefined>): boolean {
  const snapshot = useEditingPresenceStore((s) => s.byKind[kind] ?? EMPTY_SNAPSHOT);
  return hasSceneCollision(snapshot, uuids);
}

/** 씬 훅 — 기존 호출처(씬 카드·시트·모달 6곳) 시그니처 유지 래퍼. */
export function useSceneEditingPresence(sceneUuids: Array<string | null | undefined>): PresenceEditor[] {
  return useEntityEditingPresence('scene', sceneUuids);
}
export function useSceneCollisionWarn(sceneUuids: Array<string | null | undefined>): boolean {
  return useEntityCollisionWarn('scene', sceneUuids);
}

/** 복장 훅 래퍼 (캐릭터 현황판 표면용, 피드백 54). */
export function useCostumeEditingPresence(costumeUuids: Array<string | null | undefined>): PresenceEditor[] {
  return useEntityEditingPresence('costume', costumeUuids);
}
export function useCostumeCollisionWarn(costumeUuids: Array<string | null | undefined>): boolean {
  return useEntityCollisionWarn('costume', costumeUuids);
}
