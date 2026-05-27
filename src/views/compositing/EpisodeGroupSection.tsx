// ─── 에피소드별 그룹 뷰 (v1.19.0) ─────────
//
// EP 헤더 → 펼치면 그 EP의 씬들 nested → 각 씬 안에 미니 리비전 행들.
// mockup `revision-board-v3.html` view-episode 섹션 참조.

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, AlertTriangle, MessageSquare } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import type { CompRevision, RevisionStatus, Episode } from '@/types';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { formatTimeShort } from '@/utils/formatTime';
import type { SceneGroup } from './utils';
import { SceneJumpButton } from './SceneJumpButton';

// ─── EP 그룹 타입 ──────────

interface EpisodeGroup {
  episodeNumber: number;
  episodeName: string;
  scenes: SceneGroup[];
  totalOpen: number;
  totalRevisions: number;
}

function getEpisodeGroups(sceneGroups: SceneGroup[], episodes: Episode[]): EpisodeGroup[] {
  // sceneKey 의 첫 토큰("EP01_A_BG" 같은 sheet) 에서 ep.episodeNumber 매핑
  const sheetToEp = new Map<string, { num: number; name: string }>();
  for (const ep of episodes) {
    for (const part of ep.parts) {
      sheetToEp.set(part.sheetName, { num: ep.episodeNumber, name: ep.title });
    }
  }

  const map = new Map<number, EpisodeGroup>();
  for (const sg of sceneGroups) {
    const epNum = sg.info.episodeNumber
      ?? sheetToEp.get(sg.info.sheetName)?.num
      ?? 0;
    const epName = sheetToEp.get(sg.info.sheetName)?.name ?? `EP${String(epNum).padStart(2, '0')}`;
    if (!map.has(epNum)) {
      map.set(epNum, {
        episodeNumber: epNum,
        episodeName: epName,
        scenes: [],
        totalOpen: 0,
        totalRevisions: 0,
      });
    }
    const grp = map.get(epNum)!;
    grp.scenes.push(sg);
    grp.totalOpen += sg.openCount;
    grp.totalRevisions += sg.revisions.length;
  }

  // EP 번호순 정렬
  return Array.from(map.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
}

// ─── 메인 컴포넌트 ──────────

export function EpisodeGroupSection({
  sceneGroups,
  episodes,
  expandedScenes,
  selectedRevisionId,
  commentCountByRev,
  onSelectRevision,
  onToggleScene,
}: {
  sceneGroups: SceneGroup[];
  episodes: Episode[];
  expandedScenes: Set<string>;
  selectedRevisionId: string | null;
  /** v1.19.7: revisionId → 댓글 개수. 0 이면 마커 표시 안 함. 씬별 모드와 일관 유지. */
  commentCountByRev?: Map<string, number>;
  onSelectRevision: (rev: CompRevision) => void;
  onToggleScene: (sceneKey: string) => void;
}) {
  const getDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const episodeGroups = useMemo(
    () => getEpisodeGroups(sceneGroups, episodes),
    [sceneGroups, episodes],
  );

  const [expandedEps, setExpandedEps] = useState<Set<number>>(() => {
    // 첫 EP 자동 펼침
    const first = episodeGroups[0]?.episodeNumber;
    return first !== undefined ? new Set([first]) : new Set();
  });

  const toggleEp = (epNum: number) => {
    setExpandedEps((prev) => {
      const next = new Set(prev);
      if (next.has(epNum)) next.delete(epNum);
      else next.add(epNum);
      return next;
    });
  };

  if (episodeGroups.length === 0) return null;

  return (
    <div className="space-y-3 px-6 pb-6">
      {episodeGroups.map((eg) => {
        const expanded = expandedEps.has(eg.episodeNumber);
        const epDisplay = episodes.find((e) => e.episodeNumber === eg.episodeNumber);
        const epLabel = epDisplay ? getDisplayName(epDisplay) : eg.episodeName;
        return (
          <article
            key={eg.episodeNumber}
            className="bg-bg-card border border-bg-border/60 rounded-xl overflow-hidden"
            style={{ borderLeft: '3px solid rgb(var(--color-accent, 108 92 231))' }}
          >
            <header
              onClick={() => toggleEp(eg.episodeNumber)}
              className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-bg-primary/30 transition-colors"
            >
              <span className="shrink-0 text-text-secondary">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </span>
              <div className="flex items-baseline gap-2 flex-1 min-w-0">
                <span className="text-[16px] font-mono font-bold text-text-primary">{epLabel}</span>
              </div>
              {eg.totalOpen > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-accent text-white flex items-center gap-1 shrink-0">
                  <AlertTriangle size={10} />
                  {eg.totalOpen} 미해결
                </span>
              )}
              <span className="text-[10px] text-text-secondary/70 shrink-0">
                {eg.scenes.length}씬 · {eg.totalRevisions}개
              </span>
            </header>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-bg-border/40"
                >
                  <div className="p-3 space-y-2">
                    {eg.scenes.map((sg) => (
                      <SceneNested
                        key={sg.sceneKey}
                        sceneGroup={sg}
                        expanded={expandedScenes.has(sg.sceneKey)}
                        selectedRevisionId={selectedRevisionId}
                        commentCountByRev={commentCountByRev}
                        onSelectRevision={onSelectRevision}
                        onToggleScene={() => onToggleScene(sg.sceneKey)}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </article>
        );
      })}
    </div>
  );
}

// ─── 씬 블록 (EP 그룹 내부 nested) ──────────

function SceneNested({
  sceneGroup,
  expanded,
  selectedRevisionId,
  commentCountByRev,
  onSelectRevision,
  onToggleScene,
}: {
  sceneGroup: SceneGroup;
  expanded: boolean;
  selectedRevisionId: string | null;
  commentCountByRev?: Map<string, number>;
  onSelectRevision: (rev: CompRevision) => void;
  onToggleScene: () => void;
}) {
  const { info, revisions, openCount } = sceneGroup;
  const sceneLabel = info.sceneId || `S${String(info.sceneNo).padStart(2, '0')}`;

  // 미해결 먼저 → 최신순
  const sortedRevs = [...revisions].sort((a, b) => {
    if (a.status === 'resolved' && b.status !== 'resolved') return 1;
    if (a.status !== 'resolved' && b.status === 'resolved') return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="bg-bg-primary/30 border border-bg-border/40 rounded-lg p-2.5">
      <div
        onClick={onToggleScene}
        className="flex items-center gap-2 mb-2 cursor-pointer"
      >
        <span className="shrink-0 text-text-secondary/60">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="text-[12px] font-mono font-bold text-text-primary">{info.partId ?? info.part} {info.sceneNo || sceneLabel}</span>
        <SceneJumpButton
          sceneKey={info.sceneKey}
          variant="chip"
          episodeNumber={info.episodeNumber}
          partId={info.partId}
          sceneUuid={info.sceneUuid}
        />
        {info.sceneName && (
          <span className="text-[11px] text-text-secondary/70 truncate flex-1">{info.sceneName}</span>
        )}
        {!info.sceneName && <span className="flex-1" />}
        {openCount > 0 && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-accent text-white font-bold shrink-0">
            {openCount}
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5">
              {sortedRevs.map((rev) => (
                <MiniRevisionRow
                  key={rev.id}
                  rev={rev}
                  isSelected={rev.id === selectedRevisionId}
                  commentCount={commentCountByRev?.get(rev.id) ?? 0}
                  onSelect={() => onSelectRevision(rev)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 미니 리비전 행 (에피소드 nested 안) ──────────

function MiniRevisionRow({
  rev,
  isSelected,
  commentCount = 0,
  onSelect,
}: {
  rev: CompRevision;
  isSelected: boolean;
  /** v1.19.7: 댓글 개수 마커 — 씬별 모드와 일관 유지. */
  commentCount?: number;
  onSelect: () => void;
}) {
  const isResolved = rev.status === 'resolved';
  const statusCfg = STATUS_CONFIG[rev.status as RevisionStatus];
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 text-[12px] px-1 py-1 rounded transition-colors text-left ${
        isSelected ? 'bg-accent/[0.10]' : 'hover:bg-bg-border/15'
      }`}
    >
      <span className={`text-[10px] font-bold font-mono shrink-0 ${isResolved ? 'text-text-secondary/50' : 'text-accent-sub'}`}>
        {revisionNoToLabel(rev.revisionNo)}
      </span>
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0"
        style={{ color: statusCfg.color, backgroundColor: statusCfg.bg }}
      >
        {statusCfg.label}
      </span>
      <span className={`truncate flex-1 min-w-0 ${isResolved ? 'line-through text-text-secondary/60' : 'text-text-primary'}`}>
        {rev.description}
      </span>
      {commentCount > 0 && (
        <span
          className={`flex items-center gap-0.5 text-[10px] shrink-0 ${isResolved ? 'text-text-secondary/50' : 'text-text-secondary/70'}`}
          title={`댓글 ${commentCount}개`}
        >
          <MessageSquare size={10} className="shrink-0" />
          {commentCount}
        </span>
      )}
      <span className="text-[10px] text-text-secondary/70 shrink-0">{formatTimeShort(rev.createdAt)}</span>
    </button>
  );
}
