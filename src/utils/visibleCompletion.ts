export interface CompletionSceneLike {
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
  completedBy?: string;
  completedAt?: string;
}

export interface CompletionMergedSceneLike {
  bgScene: CompletionSceneLike | null;
  actScene: CompletionSceneLike | null;
}

export interface VisibleCompletionMeta {
  completedBy: string;
  completedAt: string;
}

export interface VisibleCompletionState {
  isComplete: boolean;
  completedMeta: VisibleCompletionMeta | null;
}

function isSceneComplete(scene: CompletionSceneLike | null | undefined): scene is CompletionSceneLike {
  return !!scene && scene.lo && scene.done && scene.review && scene.png;
}

function pickLatestCompletedMeta(scenes: Array<CompletionSceneLike | null | undefined>): VisibleCompletionMeta | null {
  const latest = scenes
    .filter((scene): scene is CompletionSceneLike => !!scene && !!scene.completedAt && !!scene.completedBy)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];

  if (!latest?.completedAt || !latest.completedBy) return null;
  return {
    completedBy: latest.completedBy,
    completedAt: latest.completedAt,
  };
}

export function getSingleViewCompletionState(scenes: CompletionSceneLike[]): VisibleCompletionState {
  const isComplete = scenes.length > 0 && scenes.every((scene) => isSceneComplete(scene));
  return {
    isComplete,
    completedMeta: isComplete ? pickLatestCompletedMeta(scenes) : null,
  };
}

export function getAllViewCompletionState(mergedScenes: CompletionMergedSceneLike[]): VisibleCompletionState {
  const isComplete = mergedScenes.length > 0 && mergedScenes.every(
    (merged) => isSceneComplete(merged.bgScene) && isSceneComplete(merged.actScene),
  );

  return {
    isComplete,
    completedMeta: isComplete
      ? pickLatestCompletedMeta(mergedScenes.flatMap((merged) => [merged.bgScene, merged.actScene]))
      : null,
  };
}
