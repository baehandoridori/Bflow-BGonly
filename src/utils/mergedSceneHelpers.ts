import { buildCanonicalSceneId, normalizeSceneIdKey } from './sceneIdKey.ts';
import { buildDistinctRevisionSceneId } from './revisionSceneKey.ts';

type SceneLike = {
  no: number;
  sceneId: string;
};

type SortableSceneLike = SceneLike & {
  assignee?: string;
  lo?: boolean;
  done?: boolean;
  review?: boolean;
  png?: boolean;
};

type SortKeyLike = 'no' | 'assignee' | 'progress' | 'incomplete';
type SortDirLike = 'asc' | 'desc';

export type MergedSceneLike<TScene extends SceneLike = SceneLike> = {
  sceneId: string;
  mergedKey: string;
  bgScene: TScene | null;
  actScene: TScene | null;
  bgSceneIndex: number;
  actSceneIndex: number;
};

type BulkTogglePlan = {
  sheetName: string;
  updates: { sceneId: string; sceneIndex: number }[];
};

function normalizePartId(partId: string | null | undefined): string {
  return (partId || '').trim().slice(0, 1).toLowerCase();
}

function dedupeUpdates(updates: { sceneId: string; sceneIndex: number }[]) {
  const seen = new Set<string>();
  return updates.filter((update) => {
    const key = `${update.sceneIndex}:${update.sceneId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sceneProgressLike(scene: SortableSceneLike): number {
  const checks = [scene.lo, scene.done, scene.review, scene.png];
  return (checks.filter(Boolean).length / 4) * 100;
}

function countIncompleteStages(scene: SortableSceneLike): number {
  return 4 - [scene.lo, scene.done, scene.review, scene.png].filter(Boolean).length;
}

export function buildUnifiedSceneId(partId: string | null | undefined, sceneId: string | null | undefined): string {
  return buildCanonicalSceneId(partId, sceneId);
}

export function buildMergedSceneKey(
  partId: string | null | undefined,
  merged: Pick<MergedSceneLike, 'sceneId' | 'bgScene' | 'actScene'>,
): string {
  const partPrefix = normalizePartId(partId) || '_';
  const sceneIdentity = normalizeSceneIdKey(
    merged.bgScene?.sceneId ?? merged.actScene?.sceneId ?? merged.sceneId,
    partId,
  ) || '-';
  return `${partPrefix}|scene:${sceneIdentity}`;
}

function normalizeRawSceneKey(sceneId: string | null | undefined): string {
  const normalized = (sceneId || '').trim().toLowerCase();
  return normalized ? encodeURIComponent(normalized) : '-';
}

function buildMergedSceneKeyDisambiguator(
  merged: Pick<MergedSceneLike, 'sceneId' | 'bgScene' | 'actScene'>,
): string {
  return `id:${normalizeRawSceneKey(merged.sceneId)}`;
}

function assignMergedSceneKeys<TScene extends SceneLike>(
  mergedList: MergedSceneLike<TScene>[],
  partId: string | null | undefined,
) {
  const baseKeys = mergedList.map((merged) => buildMergedSceneKey(partId, merged));
  const baseKeyCounts = new Map<string, number>();
  baseKeys.forEach((key) => {
    baseKeyCounts.set(key, (baseKeyCounts.get(key) ?? 0) + 1);
  });

  const assignedKeyCounts = new Map<string, number>();
  mergedList.forEach((merged, index) => {
    const baseKey = baseKeys[index];
    const needsDisambiguation = (baseKeyCounts.get(baseKey) ?? 0) > 1;
    const candidateKey = needsDisambiguation
      ? `${baseKey}|${buildMergedSceneKeyDisambiguator(merged)}`
      : baseKey;
    const assignedCount = assignedKeyCounts.get(candidateKey) ?? 0;

    merged.mergedKey = assignedCount > 0
      ? `${candidateKey}|dup:${assignedCount + 1}`
      : candidateKey;
    assignedKeyCounts.set(candidateKey, assignedCount + 1);
  });
}

export function buildUnifiedSceneIdFromMerged(
  partId: string | null | undefined,
  merged: Pick<MergedSceneLike, 'sceneId' | 'bgScene' | 'actScene'>,
): string {
  return buildUnifiedSceneId(
    partId,
    merged.bgScene?.sceneId ?? merged.actScene?.sceneId ?? merged.sceneId,
  );
}

export function buildMergedRevisionSceneId(
  merged: Pick<MergedSceneLike, 'sceneId' | 'mergedKey' | 'bgScene' | 'actScene'>,
): string {
  if (merged.mergedKey.includes('|dup:')) {
    return `merged-${encodeURIComponent(merged.mergedKey)}`;
  }

  const rawSceneId = merged.bgScene?.sceneId ?? merged.actScene?.sceneId ?? merged.sceneId;
  if (merged.mergedKey.includes('|id:')) {
    return buildDistinctRevisionSceneId(rawSceneId) || `merged-${encodeURIComponent(merged.mergedKey)}`;
  }

  return rawSceneId;
}

export function matchesMergedSceneIdentity(
  merged: MergedSceneLike,
  sceneId: string | null | undefined,
): boolean {
  if (!sceneId) return false;
  if (merged.mergedKey === sceneId) return true;
  if (merged.sceneId === sceneId) return true;
  if (merged.bgScene?.sceneId === sceneId) return true;
  if (merged.actScene?.sceneId === sceneId) return true;
  return false;
}

export function buildMergedScenes<TScene extends SortableSceneLike>({
  bgScenes,
  actScenes,
  bgPartScenes,
  actPartScenes,
  mergedScenePartId,
  sortKey,
  sortDir,
}: {
  bgScenes: TScene[];
  actScenes: TScene[];
  bgPartScenes: TScene[];
  actPartScenes: TScene[];
  mergedScenePartId: string | null | undefined;
  sortKey: SortKeyLike;
  sortDir: SortDirLike;
}): MergedSceneLike<TScene>[] {
  const map = new Map<string, MergedSceneLike<TScene>>();

  bgScenes.forEach((scene) => {
    map.set(scene.sceneId, {
      sceneId: scene.sceneId,
      mergedKey: '',
      bgScene: scene,
      actScene: null,
      bgSceneIndex: bgPartScenes.indexOf(scene),
      actSceneIndex: -1,
    });
  });

  const actUnmatched: TScene[] = [];
  actScenes.forEach((scene) => {
    const existing = map.get(scene.sceneId);
    if (existing) {
      existing.actScene = scene;
      existing.actSceneIndex = actPartScenes.indexOf(scene);
    } else {
      actUnmatched.push(scene);
    }
  });

  const bgLonelyByKey = new Map<string, MergedSceneLike<TScene>>();
  for (const merged of map.values()) {
    if (merged.actScene) continue;
    const normalizedKey = normalizeSceneIdKey(merged.sceneId, mergedScenePartId);
    if (!normalizedKey) continue;
    if (!bgLonelyByKey.has(normalizedKey)) bgLonelyByKey.set(normalizedKey, merged);
  }

  actUnmatched.forEach((scene) => {
    const key = normalizeSceneIdKey(scene.sceneId, mergedScenePartId);
    const partner = key ? bgLonelyByKey.get(key) : undefined;
    if (partner) {
      partner.actScene = scene;
      partner.actSceneIndex = actPartScenes.indexOf(scene);
      bgLonelyByKey.delete(key);
      return;
    }

    map.set(scene.sceneId, {
      sceneId: scene.sceneId,
      mergedKey: '',
      bgScene: null,
      actScene: scene,
      bgSceneIndex: -1,
      actSceneIndex: actPartScenes.indexOf(scene),
    });
  });

  const mergedList = Array.from(map.values()).sort((a, b) => {
    const aScene = a.bgScene ?? a.actScene;
    const bScene = b.bgScene ?? b.actScene;
    if (!aScene || !bScene) return 0;

    let cmp = 0;
    switch (sortKey) {
      case 'no': {
        const aNum = parseInt(aScene.sceneId?.match(/\d+$/)?.[0] || '0', 10) || aScene.no;
        const bNum = parseInt(bScene.sceneId?.match(/\d+$/)?.[0] || '0', 10) || bScene.no;
        cmp = aNum - bNum;
        break;
      }
      case 'assignee':
        cmp = (aScene.assignee || '').localeCompare(bScene.assignee || '');
        break;
      case 'progress': {
        const aCount = (a.bgScene ? 1 : 0) + (a.actScene ? 1 : 0) || 1;
        const bCount = (b.bgScene ? 1 : 0) + (b.actScene ? 1 : 0) || 1;
        const aPct = ((a.bgScene ? sceneProgressLike(a.bgScene) : 0) + (a.actScene ? sceneProgressLike(a.actScene) : 0)) / aCount;
        const bPct = ((b.bgScene ? sceneProgressLike(b.bgScene) : 0) + (b.actScene ? sceneProgressLike(b.actScene) : 0)) / bCount;
        cmp = aPct - bPct;
        break;
      }
      case 'incomplete': {
        const aLeft = (a.bgScene ? countIncompleteStages(a.bgScene) : 0) + (a.actScene ? countIncompleteStages(a.actScene) : 0);
        const bLeft = (b.bgScene ? countIncompleteStages(b.bgScene) : 0) + (b.actScene ? countIncompleteStages(b.actScene) : 0);
        cmp = bLeft - aLeft;
        break;
      }
    }

    return sortDir === 'asc' ? cmp : -cmp;
  });

  assignMergedSceneKeys(mergedList, mergedScenePartId);
  mergedList.forEach((merged) => {
    merged.sceneId = buildUnifiedSceneIdFromMerged(mergedScenePartId, merged);
  });

  return mergedList;
}

export function filterMergedScenesBySourceScenes<TScene extends SceneLike>(
  mergedScenes: MergedSceneLike<TScene>[],
  bgScenes: TScene[],
  actScenes: TScene[],
): MergedSceneLike<TScene>[] {
  const bgSceneSet = new Set(bgScenes);
  const actSceneSet = new Set(actScenes);

  return mergedScenes.filter((merged) =>
    (merged.bgScene ? bgSceneSet.has(merged.bgScene) : false)
    || (merged.actScene ? actSceneSet.has(merged.actScene) : false),
  );
}

export function getSyncedMergedDetail<TScene extends SceneLike, TMerged extends MergedSceneLike<TScene>>(
  detailMerged: TMerged | null,
  mergedScenes: TMerged[],
): TMerged | null {
  if (!detailMerged) return null;
  if (detailMerged.mergedKey) {
    return mergedScenes.find((scene) => scene.mergedKey === detailMerged.mergedKey) ?? null;
  }

  return mergedScenes.find((scene) => scene.sceneId === detailMerged.sceneId) ?? null;
}

export function buildAllModeBulkTogglePlans(
  selectedSceneIds: Set<string>,
  mergedScenes: MergedSceneLike[],
  bgSheetName: string | null,
  actSheetName: string | null,
  onlyDept?: 'bg' | 'acting',
): BulkTogglePlan[] {
  const mergedByKey = new Map(mergedScenes.map((scene) => [scene.mergedKey, scene]));
  const plans: BulkTogglePlan[] = [];

  const collect = (
    prefix: 'bg' | 'act',
    sheetName: string | null,
    onlyDeptValue: 'bg' | 'acting',
  ) => {
    if (!sheetName || (onlyDept && onlyDept !== onlyDeptValue)) return;

    const updates: { sceneId: string; sceneIndex: number }[] = [];
    selectedSceneIds.forEach((selectedId) => {
      if (!selectedId.startsWith(`${prefix}:`)) return;
      const mergedKey = selectedId.slice(prefix.length + 1);
      const merged = mergedByKey.get(mergedKey);
      if (!merged) return;

      const scene = prefix === 'bg' ? merged.bgScene : merged.actScene;
      const sceneIndex = prefix === 'bg' ? merged.bgSceneIndex : merged.actSceneIndex;
      if (!scene || sceneIndex < 0) return;

      updates.push({ sceneId: scene.sceneId, sceneIndex });
    });

    const deduped = dedupeUpdates(updates);
    if (deduped.length > 0) {
      plans.push({ sheetName, updates: deduped });
    }
  };

  collect('bg', bgSheetName, 'bg');
  collect('act', actSheetName, 'acting');

  return plans;
}

export function getMergedCommentBadgeCounts(
  merged: MergedSceneLike,
  bgSheetName: string | null,
  actSheetName: string | null,
  commentCounts: Record<string, number>,
) {
  const bg = merged.bgScene && bgSheetName
    ? (commentCounts[`${bgSheetName}:${merged.bgScene.no}`] ?? 0)
    : 0;
  const act = merged.actScene && actSheetName
    ? (commentCounts[`${actSheetName}:${merged.actScene.no}`] ?? 0)
    : 0;

  return {
    bg,
    act,
    total: bg + act,
  };
}
