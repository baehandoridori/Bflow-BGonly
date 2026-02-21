import type {
  Scene,
  Episode,
  DashboardStats,
  StageStats,
  AssigneeStats,
  EpisodeStats,
  Stage,
  Department,
} from '@/types';
import { STAGES, STAGE_LABELS, DEPARTMENT_CONFIGS } from '@/types';

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

/** 에피소드 배열 → 전체 대시보드 통계 (department 필터 옵션) */
export function calcDashboardStats(episodes: Episode[], department?: Department): DashboardStats {
  const filteredEpisodes = department
    ? episodes.map((ep) => ({
        ...ep,
        parts: ep.parts.filter((p) => p.department === department),
      }))
    : episodes;

  const allScenes: Scene[] = filteredEpisodes.flatMap((ep) =>
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
  // 단계별 부분 진행률 반영: 각 씬의 4단계 완료 비율 평균
  const overallPct =
    allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / totalScenes;

  // 단계별 통계 (부서별 라벨 적용)
  const labels = department ? DEPARTMENT_CONFIGS[department].stageLabels : STAGE_LABELS;
  const stageStats: StageStats[] = STAGES.map((stage: Stage) => {
    const done = allScenes.filter((s) => s[stage]).length;
    return {
      stage,
      label: labels[stage],
      done,
      total: totalScenes,
      pct: (done / totalScenes) * 100,
    };
  });

  // 담당자별 통계 (부분 진행률 반영)
  const assigneeMap = new Map<string, { total: number; completed: number; progressSum: number }>();
  for (const scene of allScenes) {
    const name = scene.assignee || '미배정';
    const entry = assigneeMap.get(name) || { total: 0, completed: 0, progressSum: 0 };
    entry.total++;
    if (isFullyDone(scene)) entry.completed++;
    entry.progressSum += sceneProgress(scene);
    assigneeMap.set(name, entry);
  }

  const assigneeStats: AssigneeStats[] = Array.from(assigneeMap.entries()).map(
    ([name, data]) => ({
      name,
      totalScenes: data.total,
      completedScenes: data.completed,
      pct: data.progressSum / data.total,
    })
  );

  // 에피소드별 통계 (부분 진행률 반영)
  const episodeStats: EpisodeStats[] = filteredEpisodes.map((ep) => {
    const epScenes = ep.parts.flatMap((p) => p.scenes);
    const epProgressSum = epScenes.reduce((sum, s) => sum + sceneProgress(s), 0);
    return {
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      parts: ep.parts.map((part) => {
        const partProgressSum = part.scenes.reduce((sum, s) => sum + sceneProgress(s), 0);
        return {
          part: part.partId,
          department: part.department,
          pct: part.scenes.length > 0 ? partProgressSum / part.scenes.length : 0,
          totalScenes: part.scenes.length,
        };
      }),
      overallPct: epScenes.length > 0 ? epProgressSum / epScenes.length : 0,
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
