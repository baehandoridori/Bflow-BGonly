import type {
  Scene,
  Episode,
  DashboardStats,
  StageStats,
  AssigneeStats,
  EpisodeStats,
  EpisodeDetailStats,
  PartDetailStatsEntry,
  Stage,
  Department,
} from '@/types';
import { STAGES, STAGE_LABELS, DEPARTMENTS, DEPARTMENT_CONFIGS } from '@/types';

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

/** 에피소드 상세 통계 (에피소드 대시보드용) */
export function calcEpisodeDetailStats(episodes: Episode[], epNum: number): EpisodeDetailStats | null {
  const ep = episodes.find((e) => e.episodeNumber === epNum);
  if (!ep) return null;

  const allScenes = ep.parts.flatMap((p) => p.scenes);
  const totalScenes = allScenes.length;
  const fullyDone = allScenes.filter(isFullyDone).length;
  const notStarted = allScenes.filter(isNotStarted).length;
  const overallPct = totalScenes > 0
    ? allScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / totalScenes
    : 0;

  // 부서별 통계
  const perDept = {} as EpisodeDetailStats['perDept'];
  for (const dept of DEPARTMENTS) {
    const deptParts = ep.parts.filter((p) => p.department === dept);
    const deptScenes = deptParts.flatMap((p) => p.scenes);
    const deptTotal = deptScenes.length;
    const deptCfg = DEPARTMENT_CONFIGS[dept];
    const deptOverall = deptTotal > 0
      ? deptScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / deptTotal
      : 0;
    const deptStageStats: StageStats[] = STAGES.map((stage) => {
      const done = deptScenes.filter((s) => s[stage]).length;
      return {
        stage,
        label: deptCfg.stageLabels[stage],
        done,
        total: deptTotal,
        pct: deptTotal > 0 ? (done / deptTotal) * 100 : 0,
      };
    });
    perDept[dept] = { overallPct: deptOverall, totalScenes: deptTotal, stageStats: deptStageStats };
  }

  // 파트별 통계 (파트 ID로 그룹핑, BG+ACT 각각)
  const partIdSet = new Set(ep.parts.map((p) => p.partId));
  const perPart: PartDetailStatsEntry[] = Array.from(partIdSet).sort().map((partId) => {
    const bgPart = ep.parts.find((p) => p.partId === partId && p.department === 'bg');
    const actPart = ep.parts.find((p) => p.partId === partId && p.department === 'acting');
    const bgScenes = bgPart?.scenes ?? [];
    const actScenes = actPart?.scenes ?? [];
    const allPartScenes = [...bgScenes, ...actScenes];

    const bgPct = bgScenes.length > 0
      ? bgScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / bgScenes.length : 0;
    const actPct = actScenes.length > 0
      ? actScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / actScenes.length : 0;
    const combinedPct = allPartScenes.length > 0
      ? allPartScenes.reduce((sum, s) => sum + sceneProgress(s), 0) / allPartScenes.length : 0;

    const bgCfg = DEPARTMENT_CONFIGS.bg;
    const actCfg = DEPARTMENT_CONFIGS.acting;

    const bgStages = STAGES.map((stage) => ({
      stage,
      label: bgCfg.stageLabels[stage],
      color: bgCfg.stageColors[stage],
      done: bgScenes.filter((s) => s[stage]).length,
      total: bgScenes.length,
      pct: bgScenes.length > 0 ? (bgScenes.filter((s) => s[stage]).length / bgScenes.length) * 100 : 0,
    }));

    const actStages = STAGES.map((stage) => ({
      stage,
      label: actCfg.stageLabels[stage],
      color: actCfg.stageColors[stage],
      done: actScenes.filter((s) => s[stage]).length,
      total: actScenes.length,
      pct: actScenes.length > 0 ? (actScenes.filter((s) => s[stage]).length / actScenes.length) * 100 : 0,
    }));

    return { partId, bgPct, actPct, combinedPct, bgScenes: bgScenes.length, actScenes: actScenes.length, bgStages, actStages };
  });

  // 담당자별 통계
  const assigneeMap = new Map<string, { total: number; completed: number; progressSum: number }>();
  for (const scene of allScenes) {
    const name = scene.assignee || '미배정';
    const entry = assigneeMap.get(name) || { total: 0, completed: 0, progressSum: 0 };
    entry.total++;
    if (isFullyDone(scene)) entry.completed++;
    entry.progressSum += sceneProgress(scene);
    assigneeMap.set(name, entry);
  }
  const perAssignee = Array.from(assigneeMap.entries()).map(([name, data]) => ({
    name,
    totalScenes: data.total,
    completedScenes: data.completed,
    pct: data.progressSum / data.total,
  }));

  return { episodeNumber: epNum, overallPct, totalScenes, fullyDone, notStarted, perDept, perPart, perAssignee };
}
