import { snapshotSequentialStages } from '@/utils/sceneStageProgression';
import type { SequentialStagePatch } from '@/utils/sceneStageProgression';
import type { Scene, Department, CostumeDesignStage, CostumeRiggingStage } from '@/types';

/* ─── 타입 ──────────────────────────────────── */

export type SceneKey = string;
export const makeKey = (sheetName: string, sceneId: string): SceneKey => `${sheetName}:${sceneId}`;

export type PersonalTodoStatus = 'todo' | 'doing' | 'done';
export type PersonalTodoPriority = 'high' | 'medium' | 'low' | 'none';
export type PersonalTodoLabelColorKey = 'violet' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'gray';

export interface PersonalTodoLabel {
  id: string;
  name: string;
  colorKey: PersonalTodoLabelColorKey;
  createdAt: string;
}

export interface PersonalTodo {
  id: string;
  title: string;
  memo: string;
  status: PersonalTodoStatus;
  completed: boolean;
  priority: PersonalTodoPriority;
  pinned: boolean;
  labelIds: string[];
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

export type CharacterTaskKind = 'design' | 'rigging';

export interface CharacterTaskItem {
  key: `char:${string}:${CharacterTaskKind}`;
  kind: CharacterTaskKind;
  characterId: string;
  characterName: string;
  costumeId: string;
  costumeName: string;
  stage: CostumeDesignStage | CostumeRiggingStage;
  stageLabel: string;
  stageColor: string;
  done: boolean;
  /** 복장 마감일(YYYY-MM-DD) — 배지 표시용. null=미설정. (T2-4) */
  dueDate: string | null;
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
