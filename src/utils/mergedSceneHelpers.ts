import { buildCanonicalSceneId, normalizeSceneIdKey } from './sceneIdKey.ts';
import { buildDistinctRevisionSceneId } from './revisionSceneKey.ts';
import { compareSceneIdsByNumberThenSuffix } from './sceneSort.ts';

type SceneLike = {
  id?: string;
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

const rawCounterpartSceneIdsByPart = new Map<string, Set<string>>();

function rawSceneIdKey(sceneId: string | null | undefined): string {
  return (sceneId || '').trim().toLowerCase();
}

function shouldPreserveRawSceneId(partId: string | null | undefined, sceneId: string | null | undefined): boolean {
  const normalizedPartId = normalizePartId(partId);
  if (!normalizedPartId) return false;

  return rawCounterpartSceneIdsByPart.get(normalizedPartId)?.has(rawSceneIdKey(sceneId)) ?? false;
}

// 참조 패널이 '다른 파트'의 merged 를 만들면 buildMergedScenes 가 전역 counterpart 맵(partId 키, 화 미구분)을
// 갱신해 메인 파트의 buildUnifiedSceneId 를 오염시킨다(코덱스 P2). 참조 해석은 호출 전 스냅샷 → 후 복원으로 격리한다.
export function snapshotRawCounterpartState(partId: string | null | undefined): Set<string> | undefined {
  const k = normalizePartId(partId);
  return k ? rawCounterpartSceneIdsByPart.get(k) : undefined;
}
export function restoreRawCounterpartState(partId: string | null | undefined, snapshot: Set<string> | undefined): void {
  const k = normalizePartId(partId);
  if (!k) return;
  if (snapshot) rawCounterpartSceneIdsByPart.set(k, snapshot);
  else rawCounterpartSceneIdsByPart.delete(k);
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
  if (shouldPreserveRawSceneId(partId, sceneId)) {
    return (sceneId || '').trim();
  }

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

function buildSceneSourceIdentity(
  dept: 'bg' | 'act',
  scene: SceneLike | null,
  sceneIndex: number,
): string | null {
  if (!scene) return null;

  const stableId = scene.id?.trim();
  if (stableId) return `${dept}:id:${normalizeRawSceneKey(stableId)}`;
  if (sceneIndex >= 0) return `${dept}:idx:${sceneIndex}`;

  return `${dept}:no:${scene.no}`;
}

function buildMergedSceneDuplicateDisambiguator<TScene extends SceneLike>(
  merged: Pick<MergedSceneLike<TScene>, 'sceneId' | 'bgScene' | 'actScene' | 'bgSceneIndex' | 'actSceneIndex'>,
): string {
  const sourceIdentities = [
    buildSceneSourceIdentity('bg', merged.bgScene, merged.bgSceneIndex),
    buildSceneSourceIdentity('act', merged.actScene, merged.actSceneIndex),
  ].filter((identity): identity is string => Boolean(identity));

  return sourceIdentities.length > 0
    ? `dup:${sourceIdentities.join('+')}`
    : `dup:scene:${normalizeRawSceneKey(merged.sceneId)}`;
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

  const candidateKeys = mergedList.map((merged, index) => {
    const baseKey = baseKeys[index];
    const needsDisambiguation = (baseKeyCounts.get(baseKey) ?? 0) > 1;
    return needsDisambiguation
      ? `${baseKey}|${buildMergedSceneKeyDisambiguator(merged)}`
      : baseKey;
  });
  const candidateKeyCounts = new Map<string, number>();
  candidateKeys.forEach((key) => {
    candidateKeyCounts.set(key, (candidateKeyCounts.get(key) ?? 0) + 1);
  });

  const assignedKeyCounts = new Map<string, number>();
  mergedList.forEach((merged, index) => {
    const candidateKey = candidateKeys[index];
    const duplicateCandidateKey = (candidateKeyCounts.get(candidateKey) ?? 0) > 1;
    const stableKey = duplicateCandidateKey
      ? `${candidateKey}|${buildMergedSceneDuplicateDisambiguator(merged)}`
      : candidateKey;
    const assignedCount = assignedKeyCounts.get(stableKey) ?? 0;

    merged.mergedKey = assignedCount > 0
      ? `${stableKey}|tie:${assignedCount + 1}`
      : stableKey;
    assignedKeyCounts.set(stableKey, assignedCount + 1);
  });
}

function registerRawCounterpartSceneIds<TScene extends SceneLike>(
  mergedList: MergedSceneLike<TScene>[],
  partId: string | null | undefined,
) {
  const normalizedPartId = normalizePartId(partId);
  if (!normalizedPartId) return;

  const rawSceneIds = new Set<string>();
  mergedList.forEach((merged) => {
    if (!shouldPreserveRawSceneIdForCounterpart(merged)) return;

    const rawSceneId = merged.bgScene?.sceneId ?? merged.actScene?.sceneId ?? merged.sceneId;
    const key = rawSceneIdKey(rawSceneId);
    if (key) rawSceneIds.add(key);
  });

  if (rawSceneIds.size > 0) {
    rawCounterpartSceneIdsByPart.set(normalizedPartId, rawSceneIds);
  } else {
    rawCounterpartSceneIdsByPart.delete(normalizedPartId);
  }
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

export function shouldPreserveRawSceneIdForCounterpart(
  merged: Pick<MergedSceneLike, 'mergedKey'>,
): boolean {
  return merged.mergedKey.includes('|id:') || merged.mergedKey.includes('|dup:');
}

export function buildCounterpartSceneId(
  partId: string | null | undefined,
  merged: Pick<MergedSceneLike, 'sceneId' | 'mergedKey' | 'bgScene' | 'actScene'>,
  targetDept: 'bg' | 'acting',
): string {
  const sourceScene = targetDept === 'bg' ? merged.actScene : merged.bgScene;
  const rawSceneId = sourceScene?.sceneId ?? merged.bgScene?.sceneId ?? merged.actScene?.sceneId ?? merged.sceneId;

  return shouldPreserveRawSceneIdForCounterpart(merged)
    ? rawSceneId
    : buildUnifiedSceneId(partId, rawSceneId);
}

export function matchesCounterpartSceneId(
  partId: string | null | undefined,
  candidateSceneId: string | null | undefined,
  targetSceneId: string,
  preserveRawSceneId: boolean,
): boolean {
  if (preserveRawSceneId) {
    return (candidateSceneId || '').trim().toLowerCase() === targetSceneId.trim().toLowerCase();
  }

  return buildUnifiedSceneId(partId, candidateSceneId) === targetSceneId;
}

export function matchesMergedSceneIdentity(
  merged: MergedSceneLike,
  sceneId: string | null | undefined,
): boolean {
  if (!sceneId) return false;
  if (merged.mergedKey === sceneId) return true;
  if (!merged.mergedKey.includes('|id:') && !merged.mergedKey.includes('|dup:') && merged.sceneId === sceneId) return true;
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
  const mergedList: MergedSceneLike<TScene>[] = [];
  const bgByRawSceneId = new Map<string, MergedSceneLike<TScene>[]>();

  bgScenes.forEach((scene) => {
    const merged: MergedSceneLike<TScene> = {
      sceneId: scene.sceneId,
      mergedKey: '',
      bgScene: scene,
      actScene: null,
      bgSceneIndex: bgPartScenes.indexOf(scene),
      actSceneIndex: -1,
    };
    mergedList.push(merged);
    const rawKey = rawSceneIdKey(scene.sceneId);
    const bucket = bgByRawSceneId.get(rawKey) ?? [];
    bucket.push(merged);
    bgByRawSceneId.set(rawKey, bucket);
  });

  const actUnmatched: TScene[] = [];
  actScenes.forEach((scene) => {
    const existing = bgByRawSceneId.get(rawSceneIdKey(scene.sceneId))?.find((merged) => !merged.actScene);
    if (existing) {
      existing.actScene = scene;
      existing.actSceneIndex = actPartScenes.indexOf(scene);
    } else {
      actUnmatched.push(scene);
    }
  });

  const bgLonelyByKey = new Map<string, MergedSceneLike<TScene>[]>();
  for (const merged of mergedList) {
    if (merged.actScene) continue;
    const normalizedKey = normalizeSceneIdKey(merged.sceneId, mergedScenePartId);
    if (!normalizedKey) continue;
    const bucket = bgLonelyByKey.get(normalizedKey) ?? [];
    bucket.push(merged);
    bgLonelyByKey.set(normalizedKey, bucket);
  }

  actUnmatched.forEach((scene) => {
    const key = normalizeSceneIdKey(scene.sceneId, mergedScenePartId);
    const partners = key ? bgLonelyByKey.get(key) : undefined;
    const partner = partners?.shift();
    if (partner) {
      partner.actScene = scene;
      partner.actSceneIndex = actPartScenes.indexOf(scene);
      if (key && partners && partners.length === 0) bgLonelyByKey.delete(key);
      return;
    }

    mergedList.push({
      sceneId: scene.sceneId,
      mergedKey: '',
      bgScene: null,
      actScene: scene,
      bgSceneIndex: -1,
      actSceneIndex: actPartScenes.indexOf(scene),
    });
  });

  mergedList.sort((a, b) => {
    const aScene = a.bgScene ?? a.actScene;
    const bScene = b.bgScene ?? b.actScene;
    if (!aScene || !bScene) return 0;

    let cmp = 0;
    switch (sortKey) {
      case 'no': {
        cmp = compareSceneIdsByNumberThenSuffix(aScene.sceneId, bScene.sceneId);
        if (cmp === 0) cmp = (aScene.no ?? 0) - (bScene.no ?? 0);
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
  registerRawCounterpartSceneIds(mergedList, mergedScenePartId);
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
  commentIdsByKey?: Record<string, readonly string[]>,
) {
  const bgKey = merged.bgScene && bgSheetName ? `${bgSheetName}:${merged.bgScene.no}` : null;
  const actKey = merged.actScene && actSheetName ? `${actSheetName}:${merged.actScene.no}` : null;

  const bg = bgKey ? (commentCounts[bgKey] ?? 0) : 0;
  const act = actKey ? (commentCounts[actKey] ?? 0) : 0;

  // 이슈 F-2(2026-04-23) + Codex P2 6차(2026-04-23):
  // loadPartComments 의 `mapToRequestedSceneNo` 가 alias-collision 등 ambiguous 케이스에서 skip하면
  // BG sheet 결과와 ACT sheet 결과가 서로 다른 댓글 집합이 될 수 있다. 이 때 Math.max 는 한쪽에만
  // 있는 댓글을 누락해 과소 집계하고, CommentPanel(primary+secondary 병합)과 뱃지 숫자가 어긋난다.
  // commentIdsByKey 가 제공되면 양쪽 sheet 의 commentId 유니온 크기를 total 로 사용해 정확도 확보.
  let total: number;
  if (commentIdsByKey) {
    const ids = new Set<string>();
    if (bgKey) for (const id of commentIdsByKey[bgKey] ?? []) ids.add(id);
    if (actKey) for (const id of commentIdsByKey[actKey] ?? []) ids.add(id);
    total = ids.size;
  } else {
    // 후방 호환 경로 — id map 없으면 BG/ACT sheet 의 독립 댓글 수를 합산한다.
    total = bg + act;
  }

  return { bg, act, total };
}
