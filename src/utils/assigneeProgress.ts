import type {
  Department,
  Episode,
  MetadataEntry,
  Scene,
  SceneAssigneeProgress,
  SceneAssigneeProgressMap,
  ScenePhaseState,
  Stage,
} from '@/types';
import { SCENE_PHASE_ROUND_MAX, SCENE_PHASE_ROUND_MIN, STAGES } from '@/types';

export const SCENE_ASSIGNEE_PROGRESS_META_TYPE = 'scene-assignee-progress';

export interface AssigneeProgressEntry {
  name: string;
  progress: SceneAssigneeProgress;
  pct: number;
  done: boolean;
}

export function parseAssigneeNames(assignee: string | null | undefined): string[] {
  if (!assignee) return [];
  return assignee
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function clampRound(value: number | null | undefined): number {
  return Math.max(SCENE_PHASE_ROUND_MIN, Math.min(SCENE_PHASE_ROUND_MAX, value || 1));
}

export function sceneStateFromScene(scene: Scene): ScenePhaseState {
  if (scene.sceneState) return scene.sceneState;
  if (scene.png) return 'done';
  if (scene.review) return 'feedback';
  if (scene.lo || scene.done) return 'work';
  return 'wait';
}

function legacyStagesForState(state: ScenePhaseState): Pick<SceneAssigneeProgress, Stage> {
  switch (state) {
    case 'wait':
      return { lo: false, done: false, review: false, png: false };
    case 'work':
      return { lo: true, done: true, review: false, png: false };
    case 'feedback':
      return { lo: true, done: true, review: true, png: false };
    case 'done':
      return { lo: true, done: true, review: true, png: true };
  }
}

function baseProgressFromScene(scene: Scene): SceneAssigneeProgress {
  return {
    lo: scene.lo,
    done: scene.done,
    review: scene.review,
    png: scene.png,
    sceneState: scene.sceneState ?? null,
    workRound: scene.workRound ?? 0,
    feedbackRound: scene.feedbackRound ?? 0,
  };
}

export function normalizeAssigneeProgressMap(scene: Scene): SceneAssigneeProgressMap {
  const names = parseAssigneeNames(scene.assignee);
  if (names.length === 0) return {};
  const existing = scene.assigneeProgress ?? {};
  const base = baseProgressFromScene(scene);
  const next: SceneAssigneeProgressMap = {};
  for (const name of names) {
    const stored = existing[name] ?? {};
    const state = stored.sceneState ?? base.sceneState ?? null;
    const stateFlags = state ? legacyStagesForState(state) : null;
    next[name] = {
      lo: stored.lo ?? stateFlags?.lo ?? base.lo ?? false,
      done: stored.done ?? stateFlags?.done ?? base.done ?? false,
      review: stored.review ?? stateFlags?.review ?? base.review ?? false,
      png: stored.png ?? stateFlags?.png ?? base.png ?? false,
      sceneState: state,
      workRound: stored.workRound ?? base.workRound ?? 0,
      feedbackRound: stored.feedbackRound ?? base.feedbackRound ?? 0,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    };
  }
  return next;
}

function progressCountFromState(state: ScenePhaseState | null | undefined): number | null {
  if (!state) return null;
  switch (state) {
    case 'wait':
      return 0;
    case 'work':
      return 2;
    case 'feedback':
      return 3;
    case 'done':
      return 4;
  }
}

export function progressPercentForEntry(progress: SceneAssigneeProgress): number {
  const stateCount = progressCountFromState(progress.sceneState);
  if (stateCount !== null) return (stateCount / STAGES.length) * 100;
  const count = STAGES.filter((stage) => progress[stage] === true).length;
  return (count / STAGES.length) * 100;
}

export function getAssigneeProgressEntries(scene: Scene): AssigneeProgressEntry[] {
  const names = parseAssigneeNames(scene.assignee);
  if (names.length === 0) return [];
  const map = normalizeAssigneeProgressMap(scene);
  return names.map((name) => {
    const progress = map[name] ?? baseProgressFromScene(scene);
    const pct = progressPercentForEntry(progress);
    return {
      name,
      progress,
      pct,
      done: pct >= 100,
    };
  });
}

export function hasMultiAssigneeProgress(scene: Scene | null | undefined): boolean {
  return parseAssigneeNames(scene?.assignee).length > 1;
}

export function sceneProgressFromAssignees(scene: Scene): number | null {
  if (!hasMultiAssigneeProgress(scene)) return null;
  const entries = getAssigneeProgressEntries(scene);
  if (entries.length === 0) return null;
  return entries.reduce((sum, entry) => sum + entry.pct, 0) / entries.length;
}

export function sceneProgressForAssignee(scene: Scene, assigneeName: string): number {
  const entries = getAssigneeProgressEntries(scene);
  const entry = entries.find((item) => item.name === assigneeName);
  if (entry) return entry.pct;
  const state = progressCountFromState(scene.sceneState);
  if (state !== null) return (state / STAGES.length) * 100;
  return (STAGES.filter((stage) => scene[stage]).length / STAGES.length) * 100;
}

export function isAssigneeProgressFullyDone(scene: Scene): boolean | null {
  if (!hasMultiAssigneeProgress(scene)) return null;
  const entries = getAssigneeProgressEntries(scene);
  return entries.length > 0 && entries.every((entry) => entry.done);
}

export function isAssigneeProgressNotStarted(scene: Scene): boolean | null {
  if (!hasMultiAssigneeProgress(scene)) return null;
  const entries = getAssigneeProgressEntries(scene);
  return entries.length > 0 && entries.every((entry) => entry.pct <= 0);
}

export function stageDoneForAssignee(scene: Scene, assigneeName: string, stage: Stage): boolean {
  const progress = normalizeAssigneeProgressMap(scene)[assigneeName];
  if (!progress) return Boolean(scene[stage]);
  if (progress.sceneState) return legacyStagesForState(progress.sceneState)[stage] === true;
  return Boolean(progress[stage]);
}

function nextProgressForStage(progress: SceneAssigneeProgress, stage: Stage): SceneAssigneeProgress {
  const current = Boolean(progress[stage]);
  return {
    ...progress,
    sceneState: null,
    [stage]: !current,
  };
}

function nextProgressForPhase(progress: SceneAssigneeProgress, nextState: ScenePhaseState): SceneAssigneeProgress {
  const prevState = progress.sceneState ?? 'wait';
  const prevWork = progress.workRound ?? 0;
  const prevFb = progress.feedbackRound ?? 0;
  let workRound = prevWork;
  let feedbackRound = prevFb;
  if (nextState === 'wait' || nextState === 'done') {
    workRound = 0;
    feedbackRound = 0;
  } else if (nextState === 'work') {
    if (prevState === 'feedback') workRound = Math.min(SCENE_PHASE_ROUND_MAX, prevFb + 1);
    else if (prevState !== 'work') workRound = clampRound(prevWork);
  } else if (nextState === 'feedback') {
    if (prevState === 'work') feedbackRound = Math.min(SCENE_PHASE_ROUND_MAX, prevWork);
    else if (prevState !== 'feedback') feedbackRound = clampRound(prevFb);
  }
  return {
    ...progress,
    ...legacyStagesForState(nextState),
    sceneState: nextState,
    workRound,
    feedbackRound,
  };
}

function nextProgressForRound(
  progress: SceneAssigneeProgress,
  kind: 'work' | 'feedback',
  delta: 1 | -1,
): SceneAssigneeProgress {
  const key = kind === 'work' ? 'workRound' : 'feedbackRound';
  return {
    ...progress,
    [key]: clampRound((progress[key] ?? 1) + delta),
  };
}

export function updateAssigneeProgressEntry(
  scene: Scene,
  assigneeName: string,
  update:
    | { kind: 'stage'; stage: Stage }
    | { kind: 'phase'; state: ScenePhaseState }
    | { kind: 'round'; roundKind: 'work' | 'feedback'; delta: 1 | -1 },
  updatedBy?: string,
): SceneAssigneeProgressMap {
  const map = normalizeAssigneeProgressMap(scene);
  const current = map[assigneeName] ?? baseProgressFromScene(scene);
  const next = (() => {
    if (update.kind === 'stage') return nextProgressForStage(current, update.stage);
    if (update.kind === 'phase') return nextProgressForPhase(current, update.state);
    return nextProgressForRound(current, update.roundKind, update.delta);
  })();
  return {
    ...map,
    [assigneeName]: {
      ...next,
      updatedAt: new Date().toISOString(),
      updatedBy,
    },
  };
}

export function updateAllAssigneeProgressEntries(
  scene: Scene,
  update:
    | { kind: 'stagePatch'; patch: Partial<Record<Stage, boolean>> }
    | { kind: 'phase'; state: ScenePhaseState; workRound?: number; feedbackRound?: number },
  updatedBy?: string,
): SceneAssigneeProgressMap {
  const names = parseAssigneeNames(scene.assignee);
  const map = normalizeAssigneeProgressMap(scene);
  const updatedAt = new Date().toISOString();

  return names.reduce<SceneAssigneeProgressMap>((nextMap, name) => {
    const current = map[name] ?? baseProgressFromScene(scene);
    const next = (() => {
      if (update.kind === 'stagePatch') {
        return {
          ...current,
          ...update.patch,
          sceneState: null,
        };
      }
      const phaseProgress = nextProgressForPhase(current, update.state);
      return {
        ...phaseProgress,
        workRound: update.workRound ?? phaseProgress.workRound,
        feedbackRound: update.feedbackRound ?? phaseProgress.feedbackRound,
      };
    })();

    return {
      ...nextMap,
      [name]: {
        ...next,
        updatedAt,
        updatedBy,
      },
    };
  }, { ...map });
}

export function aggregateScenePatchFromAssignees(
  scene: Scene,
  assigneeProgress: SceneAssigneeProgressMap,
  department: Department,
): Partial<Scene> {
  const names = parseAssigneeNames(scene.assignee);
  if (names.length === 0) return { assigneeProgress };
  if (department === 'acting') {
    const order: ScenePhaseState[] = ['wait', 'work', 'feedback', 'done'];
    const lowestState = names.reduce<ScenePhaseState>((lowest, name) => {
      const state = assigneeProgress[name]?.sceneState ?? sceneStateFromScene(scene);
      return order.indexOf(state) < order.indexOf(lowest) ? state : lowest;
    }, 'done');
    const legacy = legacyStagesForState(lowestState);
    return {
      assigneeProgress,
      sceneState: lowestState,
      workRound: assigneeProgress[names[0]]?.workRound ?? scene.workRound ?? 0,
      feedbackRound: assigneeProgress[names[0]]?.feedbackRound ?? scene.feedbackRound ?? 0,
      ...legacy,
    };
  }
  const stagePatch = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      names.every((name) => assigneeProgress[name]?.[stage] === true),
    ]),
  ) as Pick<Scene, Stage>;
  return { assigneeProgress, ...stagePatch };
}

export function serializeAssigneeProgress(progress: SceneAssigneeProgressMap): string {
  return JSON.stringify(progress);
}

export function parseAssigneeProgressValue(value: string | null | undefined): SceneAssigneeProgressMap | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as SceneAssigneeProgressMap;
  } catch {
    return null;
  }
}

export function applyAssigneeProgressMetadata(
  episodes: Episode[],
  metadata: Array<Pick<MetadataEntry, 'type' | 'key' | 'value'>>,
): Episode[] {
  const progressBySceneUuid = new Map<string, SceneAssigneeProgressMap>();
  for (const row of metadata) {
    if (row.type !== SCENE_ASSIGNEE_PROGRESS_META_TYPE) continue;
    const progress = parseAssigneeProgressValue(row.value);
    if (progress) progressBySceneUuid.set(row.key, progress);
  }
  if (progressBySceneUuid.size === 0) return episodes;
  return episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => ({
      ...part,
      scenes: part.scenes.map((scene) => {
        if (!scene.id) return scene;
        const assigneeProgress = progressBySceneUuid.get(scene.id);
        return assigneeProgress
          ? { ...scene, ...aggregateScenePatchFromAssignees(scene, assigneeProgress, part.department) }
          : scene;
      }),
    })),
  }));
}
