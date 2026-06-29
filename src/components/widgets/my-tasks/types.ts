import { snapshotSequentialStages } from '@/utils/sceneStageProgression';
import type { SequentialStagePatch } from '@/utils/sceneStageProgression';
import type { Scene, Department } from '@/types';

/* ─── 타입 ──────────────────────────────────── */

export type SceneKey = string;
export const makeKey = (sheetName: string, sceneId: string): SceneKey => `${sheetName}:${sceneId}`;

export interface PersonalTodo {
  id: string;
  title: string;
  memo: string;
  completed: boolean;
  createdAt: string;
  startDate?: string;
  endDate?: string;
  addToCalendar?: boolean;
}

export interface TaskView {
  id: string;
  name: string;
  type: 'assigned' | 'custom';
  sceneKeys: SceneKey[];
  personalTodos: PersonalTodo[];
}

export interface FlatScene {
  scene: Scene;
  sheetName: string;
  sceneIndex: number;
  episodeNumber: number;
  partId: string;
  department: Department;
  key: SceneKey;
}

export type StageSaveBaseline = SequentialStagePatch & {
  completedBy?: string;
  completedAt?: string;
};

export function createStageSaveBaseline(scene: Scene | StageSaveBaseline): StageSaveBaseline {
  return {
    ...snapshotSequentialStages(scene),
    completedBy: scene.completedBy ?? '',
    completedAt: scene.completedAt ?? '',
  };
}
