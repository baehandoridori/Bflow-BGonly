// ─── 씬 행 (접기/펼치기) ────────────────────

import { useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, MessageSquareText, Plus } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import type { CompRevision, RevisionStatus, Episode } from '@/types';
import { STATUS_CONFIG } from '@/constants/revision';
import { RevisionItem } from './RevisionItem';
import { AddRevisionForm } from './AddRevisionForm';
import { SceneJumpButton } from './SceneJumpButton';
import type { SceneGroup } from './utils';
import { buildFeedbackHubPartCollapseKey, type FeedbackHubEpisodeTree } from './feedbackHubUtils';
import { RevisionCommentMarker, summarizeRevisionComments } from './RevisionCommentMarker';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';

function statusColorMix(status: RevisionStatus, alpha: number): string {
  const color = STATUS_CONFIG[status]?.color ?? STATUS_CONFIG.open.color;
  const percent = Math.max(0, Math.min(100, alpha * 100));
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function buildAmbientLineStyle(statuses: RevisionStatus[]): CSSProperties | undefined {
  if (statuses.length <= 1) return undefined;

  const lastIndex = statuses.length - 1;
  const feather = Math.max(5, Math.min(11, 30 / statuses.length));
  const stops: string[] = [`${statusColorMix(statuses[0], 0.08)} 0%`];

  statuses.forEach((status, index) => {
    const position = Math.round((index / lastIndex) * 100);
    const lead = Math.max(0, position - feather);
    const tail = Math.min(100, position + feather);
    const coreAlpha = status === 'resolved' ? 0.58 : 0.86;

    stops.push(`${statusColorMix(status, 0.36)} ${lead}%`);
    stops.push(`${statusColorMix(status, coreAlpha)} ${position}%`);
    stops.push(`${statusColorMix(status, 0.38)} ${tail}%`);
  });

  stops.push(`${statusColorMix(statuses[lastIndex], 0.06)} 100%`);

  const activeStatus = statuses.find((status) => status !== 'resolved') ?? statuses[0];
  const tailStatus = statuses[statuses.length - 1];

  return {
    background: `linear-gradient(180deg, ${stops.join(', ')})`,
    boxShadow: `0 0 14px ${statusColorMix(activeStatus, 0.28)}, 0 0 18px ${statusColorMix(tailStatus, 0.14)}`,
  };
}

export function SceneRow({
  group,
  expanded,
  selectedRevisionId,
  commentCountByRev,
  commentSeenByRev,
  pathMode = 'full',
  onToggle,
  onSelectRevision,
  onStatusChange,
}: {
  group: SceneGroup;
  expanded: boolean;
  selectedRevisionId: string | null;
  /** v1.19.6: revisionId → 댓글 개수. 0 이면 마커 표시 안 함. */
  commentCountByRev?: Map<string, number>;
  /** revisionId → 현재 사용자가 댓글을 확인했는지 여부. */
  commentSeenByRev?: Map<string, boolean>;
  pathMode?: 'full' | 'sceneOnly';
  onToggle: () => void;
  onSelectRevision: (rev: CompRevision) => void;
  onStatusChange: (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const { info, revisions, openCount, uniqueRequesters } = group;
  const episodes = useDataStore((s) => s.episodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const epLabel = (() => {
    const ep = episodes.find((e) => e.episodeNumber === info.episodeNumber);
    if (ep) return getEpisodeDisplayName(ep);
    return info.sheetName.split('_')[0] || 'EP?';
  })();

  // 씬 ID 표시 (a001, SC001 등 원본 그대로)
  const sceneLabel = info.sceneId || `S${String(info.sceneNo).padStart(2, '0')}`;
  const sceneTitle = info.sceneName?.trim();
  const showSceneTitle = !!sceneTitle && sceneTitle !== info.sceneId;
  const sortedRevisions = [...revisions].sort((a, b) => {
    // 미해결 먼저, 그 안에서 최신순 (createdAt 내림차순)
    if (a.status === 'resolved' && b.status !== 'resolved') return 1;
    if (a.status !== 'resolved' && b.status === 'resolved') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const isSceneResolved = revisions.length > 0 && openCount === 0;
  const ambientStatuses = sortedRevisions.map((revision) => revision.status);
  const ambientLineStyle = buildAmbientLineStyle(ambientStatuses);
  const commentSummary = summarizeRevisionComments(revisions, commentCountByRev, commentSeenByRev);

  return (
    <div className="border-b border-bg-border/40 last:border-b-0">
      {/* 씬 헤더 — div + role=button (내부에 SceneJumpButton 이라는 button 이 있어 button 중첩 회피) */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        data-scene-complete={isSceneResolved ? 'true' : 'false'}
        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
          isSceneResolved
            ? 'bg-bg-primary/5 hover:bg-bg-border/5'
            : 'hover:bg-bg-border/10'
        }`}
      >
        {/* 펼치기/접기 */}
        <span className={`shrink-0 w-5 ${
          isSceneResolved ? 'text-text-secondary/25' : 'text-text-secondary/50'
        }`}>
          {openCount > 0 && (
            expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          )}
        </span>

        {/* v1.19.6: EP / 파트 / 씬 ID 메타 라벨 — 트리 보기에서는 EP/파트 반복 제거 */}
        <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
          {pathMode === 'full' && (
            <>
              <span
                className={`truncate max-w-[140px] ${
                  isSceneResolved ? 'text-text-secondary/35' : 'text-text-secondary/70'
                }`}
                title={epLabel}
              >
                {epLabel}
              </span>
              <span className="text-text-secondary/40">/</span>
              <span className={`font-medium ${
                isSceneResolved ? 'text-text-secondary/35' : 'text-text-secondary'
              }`}>{info.part}</span>
              <span className="text-text-secondary/40">/</span>
            </>
          )}
          <span
            className={`font-bold px-2 py-0.5 rounded border ${
              isSceneResolved
                ? 'text-text-secondary/45 border-bg-border/35 bg-bg-primary/25'
                : expanded
                ? 'text-accent border-accent/40 bg-accent/10'
                : 'text-text-secondary border-bg-border bg-bg-primary/50'
            }`}
          >
            {sceneLabel}
          </span>
        </div>

        {/* 씬 이름 */}
        {showSceneTitle && (
          <span className={`font-medium text-sm truncate ${
            isSceneResolved ? 'text-text-secondary/45' : 'text-text-primary'
          }`}>
            {sceneTitle}
          </span>
        )}

        {/* 오른쪽: 아바타 + 미해결 뱃지 + 씬 점프 */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {uniqueRequesters.length > 0 && (
            <span
              className={`compact-label-container inline-flex min-w-0 shrink items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border ${
                isSceneResolved
                  ? 'border-bg-border/25 bg-bg-primary/25 text-text-secondary/40'
                  : 'border-bg-border/40 bg-bg-primary/45 text-text-secondary/70'
              }`}
              title={`요청자: ${uniqueRequesters.join(', ')}`}
            >
              <CompactIconLabel icon={<MessageSquareText size={11} />} label={`요청 ${uniqueRequesters.length}`} />
            </span>
          )}
          <RevisionCommentMarker
            count={commentSummary.count}
            seen={commentSummary.seen}
            className={isSceneResolved ? 'opacity-70' : ''}
          />
          {openCount > 0 && (
            <span
              className="compact-label-container flex min-w-0 shrink items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: STATUS_CONFIG.open.color, backgroundColor: STATUS_CONFIG.open.bg }}
            >
              <CompactIconLabel icon={<AlertTriangle size={10} />} label={`${openCount} 미해결`} />
            </span>
          )}
          {isSceneResolved && (
            <span className="compact-label-container inline-flex min-w-0 shrink text-[10px] font-bold rounded-full px-2 py-0.5 text-text-secondary/45 bg-bg-primary/35 border border-bg-border/25">
              <CompactIconLabel icon={<CheckCircle2 size={10} />} label="완료" />
            </span>
          )}
          <SceneJumpButton
            sceneKey={info.sceneKey}
            variant="action"
            episodeNumber={info.episodeNumber}
            partId={info.partId}
            sceneUuid={info.sceneUuid}
          />
        </div>
      </div>

      {/* 확장된 리테이크 목록 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            {/* 세로 가이드라인 + 리테이크 아이템들 */}
            <div className="relative pb-2 ml-8">
              {ambientLineStyle && (
                <div
                  data-ambient-status-line="true"
                  data-ambient-statuses={ambientStatuses.join('|')}
                  className="absolute left-[22px] top-2 bottom-8 w-[2px] rounded-full"
                  style={ambientLineStyle}
                />
              )}

              {/* 리테이크 아이템들 */}
              {sortedRevisions
                .map((rev) => (
                  <RevisionItem
                    key={rev.id}
                    revision={rev}
                    isSelected={rev.id === selectedRevisionId}
                    commentCount={commentCountByRev?.get(rev.id) ?? 0}
                    commentSeen={commentSeenByRev?.get(rev.id) ?? false}
                    onSelect={() => onSelectRevision(rev)}
                    onStatusChange={(status, note) =>
                      onStatusChange(rev.id, rev.sceneKey, status, note)
                    }
                  />
                ))}

              {/* 추가 버튼 / 폼 */}
              <AnimatePresence mode="wait">
                {showAddForm ? (
                    <AddRevisionForm
                      key="form"
                      sceneKey={info.sceneKey}
                      department={info.department}
                      sceneAssignee={info.assignee}
                      onClose={() => setShowAddForm(false)}
                    />
                ) : (
                  <motion.div
                    key="btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="ml-4 mr-4 mb-2"
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowAddForm(true); }}
                      className="compact-label-container flex min-w-0 shrink items-center gap-1 px-3 py-1.5 text-[11px] text-text-secondary/60 hover:text-accent transition-colors cursor-pointer rounded-lg hover:bg-accent/5"
                    >
                      <CompactIconLabel
                        icon={<Plus size={12} />}
                        label="추가 리테이크 요청"
                      />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 리테이크 허브 트리 (에피소드 → 파트 → 씬) ─────────────────────

export function FeedbackTreeSection({
  episodeTrees,
  expandedEpisodes,
  expandedParts,
  expandedScenes,
  selectedRevisionId,
  commentCountByRev,
  commentSeenByRev,
  onToggleEpisode,
  onTogglePart,
  onToggleScene,
  onSelectRevision,
  onStatusChange,
}: {
  episodeTrees: FeedbackHubEpisodeTree[];
  expandedEpisodes: Set<number>;
  expandedParts: Set<string>;
  expandedScenes: Set<string>;
  selectedRevisionId: string | null;
  commentCountByRev?: Map<string, number>;
  commentSeenByRev?: Map<string, boolean>;
  onToggleEpisode: (episodeNumber: number) => void;
  onTogglePart: (episodeNumber: number, partId: string) => void;
  onToggleScene: (sceneKey: string) => void;
  onSelectRevision: (rev: CompRevision) => void;
  onStatusChange: (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => void;
}) {
  return (
    <div className="px-5 py-4 space-y-4">
      {episodeTrees.map((episodeTree) => {
        const isEpisodeExpanded = expandedEpisodes.has(episodeTree.episodeNumber);
        const episodeCommentSummary = summarizeRevisionComments(
          episodeTree.parts.flatMap((partTree) =>
            partTree.scenes.flatMap((group) => group.revisions),
          ),
          commentCountByRev,
          commentSeenByRev,
        );

        return (
          <section
            key={episodeTree.episodeNumber}
            className="overflow-hidden rounded-xl border border-bg-border/55 bg-bg-card/55"
          >
            <header
              role="button"
              tabIndex={0}
              aria-expanded={isEpisodeExpanded}
              onClick={() => onToggleEpisode(episodeTree.episodeNumber)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleEpisode(episodeTree.episodeNumber);
                }
              }}
              className="px-4 py-3 flex items-center gap-3 border-b border-bg-border/35 bg-bg-primary/20 hover:bg-bg-primary/35 transition-colors cursor-pointer"
            >
              <span className="shrink-0 text-text-secondary/60">
                {isEpisodeExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text-primary">{episodeTree.episodeLabel}</span>
                  <span className="text-[10px] text-text-secondary/60">
                    {episodeTree.sceneCount}씬 · {episodeTree.totalRevisions}개 리테이크
                  </span>
                  <RevisionCommentMarker
                    count={episodeCommentSummary.count}
                    seen={episodeCommentSummary.seen}
                    size="compact"
                  />
                </div>
              </div>
              {episodeTree.totalOpen > 0 && (
                <span
                  className="compact-label-container inline-flex min-w-0 shrink items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5"
                  style={{ color: STATUS_CONFIG.open.color, backgroundColor: STATUS_CONFIG.open.bg }}
                >
                  <CompactIconLabel icon={<AlertTriangle size={10} />} label={`${episodeTree.totalOpen} 미해결`} />
                </span>
              )}
            </header>

            <AnimatePresence initial={false}>
              {isEpisodeExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="divide-y divide-bg-border/30">
                  {episodeTree.parts.map((partTree) => {
                    const partKey = buildFeedbackHubPartCollapseKey(episodeTree.episodeNumber, partTree.partId);
                    const isPartExpanded = expandedParts.has(partKey);
                    const isPartResolved = partTree.totalRevisions > 0 && partTree.totalOpen === 0;
                    const partCommentSummary = summarizeRevisionComments(
                      partTree.scenes.flatMap((group) => group.revisions),
                      commentCountByRev,
                      commentSeenByRev,
                    );

                    return (
                      <section key={partTree.partId}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-expanded={isPartExpanded}
                          data-part-complete={isPartResolved ? 'true' : 'false'}
                          onClick={() => onTogglePart(episodeTree.episodeNumber, partTree.partId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onTogglePart(episodeTree.episodeNumber, partTree.partId);
                            }
                          }}
                          className={`px-4 py-2.5 flex items-center gap-2 transition-colors cursor-pointer ${
                            isPartResolved
                              ? 'bg-bg-primary/5 hover:bg-bg-border/5'
                              : 'bg-bg-primary/10 hover:bg-bg-border/10'
                          }`}
                        >
                          <span className="shrink-0 text-text-secondary/55">
                            {isPartExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            isPartResolved ? 'bg-text-secondary/25' : 'bg-accent-sub'
                          }`} />
                          <span className={`text-[12px] font-bold ${
                            isPartResolved ? 'text-text-secondary/45' : 'text-text-primary'
                          }`}>{partTree.partId} 파트</span>
                          <span className={`text-[10px] ${
                            isPartResolved ? 'text-text-secondary/35' : 'text-text-secondary/60'
                          }`}>
                            {partTree.scenes.length}씬 · {partTree.totalRevisions}개
                          </span>
                          <RevisionCommentMarker
                            count={partCommentSummary.count}
                            seen={partCommentSummary.seen}
                            size="compact"
                            className={isPartResolved ? 'opacity-60' : ''}
                          />
                          {isPartResolved ? (
                            <span className="compact-label-container ml-auto inline-flex min-w-0 shrink text-[10px] font-bold rounded-full px-2 py-0.5 text-text-secondary/45 bg-bg-primary/35 border border-bg-border/25">
                              <CompactIconLabel icon={<CheckCircle2 size={10} />} label="완료" />
                            </span>
                          ) : partTree.totalOpen > 0 ? (
                            <span className="compact-label-container ml-auto inline-flex min-w-0 shrink text-[10px] font-bold text-accent-sub">
                              <CompactIconLabel icon={<AlertTriangle size={10} />} label={`${partTree.totalOpen} 미해결`} />
                            </span>
                          ) : null}
                        </div>

                        <AnimatePresence initial={false}>
                          {isPartExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18, ease: 'easeInOut' }}
                              className={`ml-5 overflow-hidden border-l ${
                                isPartResolved ? 'border-bg-border/25' : 'border-bg-border/40'
                              }`}
                            >
                              {partTree.scenes.map((group) => (
                                <SceneRow
                                  key={group.sceneKey}
                                  group={group}
                                  expanded={expandedScenes.has(group.sceneKey)}
                                  selectedRevisionId={selectedRevisionId}
                                  commentCountByRev={commentCountByRev}
                                  commentSeenByRev={commentSeenByRev}
                                  pathMode="sceneOnly"
                                  onToggle={() => onToggleScene(group.sceneKey)}
                                  onSelectRevision={onSelectRevision}
                                  onStatusChange={onStatusChange}
                                />
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </section>
                    );
                  })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}

// ─── 에피소드 필터 ──────────────────────────

export function EpisodeFilter({
  episodes,
  selected,
  onSelect,
}: {
  episodes: Episode[];
  selected: number | null;
  onSelect: (ep: number | null) => void;
}) {
  const getDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className={`compact-label-container inline-flex min-w-0 shrink items-center justify-center px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
          selected === null
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-bg-border text-text-secondary hover:text-text-primary'
        }`}
      >
        <CompactIconLabel icon={<Circle size={12} strokeWidth={2.4} />} label="전체" />
      </button>
      {episodes.map((ep) => {
        const displayName = getDisplayName(ep);
        const shortName = `EP.${String(ep.episodeNumber).padStart(2, '0')}`;
        return (
          <button
            key={ep.episodeNumber}
            onClick={() => onSelect(ep.episodeNumber)}
            title={displayName}
            className={`compact-label-container inline-flex min-w-0 max-w-[10rem] shrink items-center justify-center px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
              selected === ep.episodeNumber
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-bg-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <span data-episode-filter-label className="min-w-0 truncate">{displayName}</span>
            <span data-episode-filter-short-label className="hidden whitespace-nowrap">{shortName}</span>
          </button>
        );
      })}
    </div>
  );
}
