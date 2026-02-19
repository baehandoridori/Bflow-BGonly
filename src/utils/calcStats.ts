import type {
  Scene,
  Episode,
  DashboardStats,
  StageStats,
  AssigneeStats,
  EpisodeStats,
  Stage,
} from '@/types';
import { STAGES, STAGE_LABELS } from '@/types';

/** 씬 1개의 진행률 (0~100) */
export function sceneProgress(scene: Scene): number {
  const checks = [scene.lo, scene.done, scene.review, scene.png];
  const completed = checks.filter(Boolean).length;
  return (completed / 4) * 100;
}

/** 씬이 4단계 모두 완료인지 */
export function isFullyDone(scene: Scene): boolean {
  return scene.lo && scene.done && scene.review && scene.png;
}

/** 씬이 아무것도 시작 안 한 상태인지 */
export function isNotStarted(scene: Scene): boolean {
  return !scene.lo && !scene.done && !scene.review && !scene.png;
}

/** 에피소드 배열 → 전체 대시보드 통계 */
export function calcDashboardStats(episodes: Episode[]): DashboardStats {
  const allScenes: Scene[] = episodes.flatMap((ep) =>
    ep.parts.flatMap((part) => part.scenes)
  );

  const totalScenes = allScenes.length;
  if (totalScenes === 0) {
    return {
      overallPct: 0,
      totalScenes: 0,
      fullyDone: 0,
      notStarted: 0,
      stageStats: STAGES.map((s) => ({
        stage: s,
        label: STAGE_LABELS[s],
        done: 0,
        total: 0,
        pct: 0,
      })),
      assigneeStats: [],
      episodeStats: [],
    };
  }

  const fullyDone = allScenes.filter(isFullyDone).length;
  const notStarted = allScenes.filter(isNotStarted).length;
  const overallPct = (fullyDone / totalScenes) * 100;

  // 단계별 통계
  const stageStats: StageStats[] = STAGES.map((stage: Stage) => {
    const done = allScenes.filter((s) => s[stage]).length;
    return {
      stage,
      label: STAGE_LABELS[stage],
      done,
      total: totalScenes,
      pct: (done / totalScenes) * 100,
    };
  });

  // 담당자별 통계
  const assigneeMap = new Map<string, { total: number; completed: number }>();
  for (const scene of allScenes) {
    const name = scene.assignee || '미배정';
    const entry = assigneeMap.get(name) || { total: 0, completed: 0 };
    entry.total++;
    if (isFullyDone(scene)) entry.completed++;
    assigneeMap.set(name, entry);
  }

  const assigneeStats: AssigneeStats[] = Array.from(assigneeMap.entries()).map(
    ([name, data]) => ({
      name,
      totalScenes: data.total,
      completedScenes: data.completed,
      pct: (data.completed / data.total) * 100,
    })
  );

  // 에피소드별 통계
  const episodeStats: EpisodeStats[] = episodes.map((ep) => {
    const epScenes = ep.parts.flatMap((p) => p.scenes);
    const epDone = epScenes.filter(isFullyDone).length;
    return {
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      parts: ep.parts.map((part) => {
        const partDone = part.scenes.filter(isFullyDone).length;
        return {
          part: part.partId,
          pct: part.scenes.length > 0 ? (partDone / part.scenes.length) * 100 : 0,
          totalScenes: part.scenes.length,
        };
      }),
      overallPct: epScenes.length > 0 ? (epDone / epScenes.length) * 100 : 0,
    };
  });

  return {
    overallPct,
    totalScenes,
    fullyDone,
    notStarted,
    stageStats,
    assigneeStats,
    episodeStats,
  };
}
