// ─── 씬 행 (접기/펼치기) ────────────────────

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, AlertTriangle, Plus } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import type { CompRevision, RevisionStatus, Episode } from '@/types';
import { AvatarStack } from './sharedComponents';
import { RevisionItem } from './RevisionItem';
import { AddRevisionForm } from './AddRevisionForm';
import { SceneJumpButton } from './SceneJumpButton';
import type { SceneGroup } from './utils';
import type { FeedbackHubEpisodeTree } from './feedbackHubUtils';

export function SceneRow({
  group,
  expanded,
  selectedRevisionId,
  commentCountByRev,
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
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-border/10 transition-colors cursor-pointer"
      >
        {/* 펼치기/접기 */}
        <span className="shrink-0 text-text-secondary/50 w-5">
          {openCount > 0 && (
            expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          )}
        </span>

        {/* v1.19.6: EP / 파트 / 씬 ID 메타 라벨 — 트리 보기에서는 EP/파트 반복 제거 */}
        <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
          {pathMode === 'full' && (
            <>
              <span
                className="text-text-secondary/70 truncate max-w-[140px]"
                title={epLabel}
              >
                {epLabel}
              </span>
              <span className="text-text-secondary/40">/</span>
              <span className="text-text-secondary font-medium">{info.part}</span>
              <span className="text-text-secondary/40">/</span>
            </>
          )}
          <span
            className={`font-bold px-2 py-0.5 rounded border ${
              expanded
                ? 'text-accent border-accent/40 bg-accent/10'
                : 'text-text-secondary border-bg-border bg-bg-primary/50'
            }`}
          >
            {sceneLabel}
          </span>
        </div>

        <SceneJumpButton
          sceneKey={info.sceneKey}
          variant="chip"
          episodeNumber={info.episodeNumber}
          partId={info.partId}
          sceneUuid={info.sceneUuid}
        />

        {/* 씬 이름 */}
        {showSceneTitle && (
          <span className="font-medium text-sm text-text-primary truncate">
            {sceneTitle}
          </span>
        )}

        {/* 오른쪽: 아바타 + 미해결 뱃지 + 씬 점프 */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {uniqueRequesters.length > 0 && (
            <AvatarStack names={uniqueRequesters} max={4} size={22} />
          )}
          {openCount > 0 && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
              style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.12)' }}
            >
              <AlertTriangle size={10} />
              {openCount} 미해결
            </span>
          )}
        </div>
      </div>

      {/* 확장된 리비전 목록 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            {/* 세로 가이드라인 + 리비전 아이템들 */}
            <div className="relative pb-2 ml-8">
              {/* 세로 가이드라인 */}
              <div
                className="absolute left-[22px] top-0 bottom-2 w-px bg-bg-border/50"
              />

              {/* 리비전 아이템들 */}
              {[...revisions]
                .sort((a, b) => {
                  // 미해결 먼저, 그 안에서 최신순 (createdAt 내림차순)
                  if (a.status === 'resolved' && b.status !== 'resolved') return 1;
                  if (a.status !== 'resolved' && b.status === 'resolved') return -1;
                  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                })
                .map((rev) => (
                  <RevisionItem
                    key={rev.id}
                    revision={rev}
                    isSelected={rev.id === selectedRevisionId}
                    commentCount={commentCountByRev?.get(rev.id) ?? 0}
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
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-text-secondary/60 hover:text-accent transition-colors cursor-pointer rounded-lg hover:bg-accent/5"
                    >
                      <Plus size={12} />
                      <span>
                        <span className="text-accent-sub font-semibold">{epLabel}</span>
                        {' '}{info.part} {info.sceneId} 에 추가 수정 요청
                      </span>
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

// ─── 피드백 허브 트리 (에피소드 → 파트 → 씬) ─────────────────────

export function FeedbackTreeSection({
  episodeTrees,
  expandedScenes,
  selectedRevisionId,
  commentCountByRev,
  onToggleScene,
  onSelectRevision,
  onStatusChange,
}: {
  episodeTrees: FeedbackHubEpisodeTree[];
  expandedScenes: Set<string>;
  selectedRevisionId: string | null;
  commentCountByRev?: Map<string, number>;
  onToggleScene: (sceneKey: string) => void;
  onSelectRevision: (rev: CompRevision) => void;
  onStatusChange: (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => void;
}) {
  return (
    <div className="px-5 py-4 space-y-4">
      {episodeTrees.map((episodeTree) => (
        <section
          key={episodeTree.episodeNumber}
          className="overflow-hidden rounded-xl border border-bg-border/55 bg-bg-card/55"
        >
          <header className="px-4 py-3 flex items-center gap-3 border-b border-bg-border/35 bg-bg-primary/20">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary">{episodeTree.episodeLabel}</span>
                <span className="text-[10px] text-text-secondary/60">
                  {episodeTree.sceneCount}씬 · {episodeTree.totalRevisions}개 피드백
                </span>
              </div>
            </div>
            {episodeTree.totalOpen > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5 shrink-0"
                style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.12)' }}
              >
                <AlertTriangle size={10} />
                {episodeTree.totalOpen} 미해결
              </span>
            )}
          </header>

          <div className="divide-y divide-bg-border/30">
            {episodeTree.parts.map((partTree) => (
              <section key={partTree.partId}>
                <div className="px-4 py-2.5 flex items-center gap-2 bg-bg-primary/10">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-sub shrink-0" />
                  <span className="text-[12px] font-bold text-text-primary">{partTree.partId} 파트</span>
                  <span className="text-[10px] text-text-secondary/60">
                    {partTree.scenes.length}씬 · {partTree.totalRevisions}개
                  </span>
                  {partTree.totalOpen > 0 && (
                    <span className="ml-auto text-[10px] font-bold text-accent-sub">
                      {partTree.totalOpen} 미해결
                    </span>
                  )}
                </div>

                <div className="ml-5 border-l border-bg-border/40">
                  {partTree.scenes.map((group) => (
                    <SceneRow
                      key={group.sceneKey}
                      group={group}
                      expanded={expandedScenes.has(group.sceneKey)}
                      selectedRevisionId={selectedRevisionId}
                      commentCountByRev={commentCountByRev}
                      pathMode="sceneOnly"
                      onToggle={() => onToggleScene(group.sceneKey)}
                      onSelectRevision={onSelectRevision}
                      onStatusChange={onStatusChange}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ))}
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
        className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
          selected === null
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-bg-border text-text-secondary hover:text-text-primary'
        }`}
      >
        전체
      </button>
      {episodes.map((ep) => (
        <button
          key={ep.episodeNumber}
          onClick={() => onSelect(ep.episodeNumber)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
            selected === ep.episodeNumber
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-bg-border text-text-secondary hover:text-text-primary'
          }`}
        >
          {getDisplayName(ep)}
        </button>
      ))}
    </div>
  );
}
