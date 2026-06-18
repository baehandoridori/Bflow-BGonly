import type { CompRevision, Episode } from '@/types';
import type { SceneGroup } from './utils';

const STALLED_HOURS = 48;

export function buildFeedbackHubPartCollapseKey(episodeNumber: number, partId: string): string {
  return `${episodeNumber}::${partId}`;
}

export interface FeedbackHubPartTree {
  partId: string;
  scenes: SceneGroup[];
  totalOpen: number;
  totalRevisions: number;
}

export interface FeedbackHubEpisodeTree {
  episodeNumber: number;
  episodeLabel: string;
  parts: FeedbackHubPartTree[];
  totalOpen: number;
  totalRevisions: number;
  sceneCount: number;
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function revisionActivityTime(revision: CompRevision): Date {
  return new Date(revision.updatedAt ?? revision.createdAt);
}

function revisionResolvedTime(revision: CompRevision): Date {
  return new Date(revision.resolvedAt ?? revision.updatedAt ?? revision.createdAt);
}

export function buildFeedbackHubStats({
  revisions,
  commentCountByRev,
  currentUserName,
  currentUserId,
  now = new Date(),
}: {
  revisions: CompRevision[];
  commentCountByRev?: Map<string, number>;
  currentUserName?: string;
  /** 신규 담당자(assigneeIds, user.id 기반) 매칭용 — '내 관련'이 담당자도 포함하도록. */
  currentUserId?: string;
  now?: Date;
}) {
  const openRevisions = revisions.filter((revision) => revision.status !== 'resolved');
  const stalledSince = now.getTime() - STALLED_HOURS * 60 * 60 * 1000;

  return {
    totalOpen: openRevisions.length,
    withComments: revisions.filter((revision) => (commentCountByRev?.get(revision.id) ?? 0) > 0).length,
    myRelated: (currentUserName || currentUserId)
      ? revisions.filter((revision) =>
          revision.assignee === currentUserName
          || revision.requesterName === currentUserName
          || (currentUserId ? (revision.assigneeIds?.includes(currentUserId) ?? false) : false),
        ).length
      : 0,
    stalled: openRevisions.filter((revision) => revisionActivityTime(revision).getTime() <= stalledSince).length,
    resolvedToday: revisions.filter((revision) =>
      revision.status === 'resolved' && isSameLocalDate(revisionResolvedTime(revision), now),
    ).length,
    workflowLabels: ['대기', '진행중', '완료'],
  };
}

function fallbackEpisodeLabel(episodeNumber: number): string {
  if (!episodeNumber) return 'EP?';
  return `EP.${String(episodeNumber).padStart(2, '0')}`;
}

function displayPartId(partId: string): string {
  return partId.trim().toUpperCase();
}

function normalizePartIdKey(partId: string | null | undefined): string {
  return (partId ?? '').trim().toLowerCase();
}

function compareSceneGroup(a: SceneGroup, b: SceneGroup): number {
  if (a.info.sceneNo !== b.info.sceneNo) return a.info.sceneNo - b.info.sceneNo;
  return a.info.sceneId.localeCompare(b.info.sceneId, undefined, { numeric: true, sensitivity: 'base' });
}

export function buildFeedbackHubTree({
  sceneGroups,
  episodes,
  getEpisodeDisplayName,
}: {
  sceneGroups: SceneGroup[];
  episodes: Episode[];
  getEpisodeDisplayName?: (episode: Episode) => string;
}): FeedbackHubEpisodeTree[] {
  const episodeByNumber = new Map(episodes.map((episode) => [episode.episodeNumber, episode]));
  const sheetNameToEpisode = new Map<string, Episode>();
  for (const episode of episodes) {
    for (const part of episode.parts) {
      sheetNameToEpisode.set(part.sheetName, episode);
    }
  }

  const episodeMap = new Map<
    number,
    FeedbackHubEpisodeTree & { partMap: Map<string, FeedbackHubPartTree> }
  >();

  for (const sceneGroup of sceneGroups) {
    const episode =
      sceneGroup.info.episodeNumber !== undefined
        ? episodeByNumber.get(sceneGroup.info.episodeNumber)
        : sheetNameToEpisode.get(sceneGroup.info.sheetName);
    const episodeNumber = sceneGroup.info.episodeNumber ?? episode?.episodeNumber ?? 0;
    const episodeLabel = episode
      ? getEpisodeDisplayName?.(episode) ?? episode.title
      : fallbackEpisodeLabel(episodeNumber);
    const rawPartId = sceneGroup.info.partId ?? sceneGroup.info.part ?? '파트 미지정';
    const partKey = normalizePartIdKey(rawPartId);
    const partId = partKey ? displayPartId(rawPartId) : rawPartId;

    let episodeTree = episodeMap.get(episodeNumber);
    if (!episodeTree) {
      episodeTree = {
        episodeNumber,
        episodeLabel,
        parts: [],
        totalOpen: 0,
        totalRevisions: 0,
        sceneCount: 0,
        partMap: new Map(),
      };
      episodeMap.set(episodeNumber, episodeTree);
    }

    let partTree = episodeTree.partMap.get(partKey || partId);
    if (!partTree) {
      partTree = {
        partId,
        scenes: [],
        totalOpen: 0,
        totalRevisions: 0,
      };
      episodeTree.partMap.set(partKey || partId, partTree);
      episodeTree.parts.push(partTree);
    }

    partTree.scenes.push(sceneGroup);
    partTree.totalOpen += sceneGroup.openCount;
    partTree.totalRevisions += sceneGroup.revisions.length;
    episodeTree.totalOpen += sceneGroup.openCount;
    episodeTree.totalRevisions += sceneGroup.revisions.length;
    episodeTree.sceneCount += 1;
  }

  return [...episodeMap.values()]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map(({ partMap: _partMap, ...episodeTree }) => ({
      ...episodeTree,
      parts: episodeTree.parts
        .sort((a, b) => a.partId.localeCompare(b.partId, undefined, { numeric: true, sensitivity: 'base' }))
        .map((partTree) => ({
          ...partTree,
          scenes: [...partTree.scenes].sort(compareSceneGroup),
        })),
    }));
}
