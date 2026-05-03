// ─── 씬 행 (접기/펼치기) ────────────────────

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, AlertTriangle, Plus } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import type { CompRevision, RevisionStatus, Episode } from '@/types';
import { AvatarStack } from './sharedComponents';
import { RevisionItem } from './RevisionItem';
import { AddRevisionForm } from './AddRevisionForm';
import type { SceneGroup } from './utils';

export function SceneRow({
  group,
  expanded,
  selectedRevisionId,
  onToggle,
  onSelectRevision,
  onStatusChange,
}: {
  group: SceneGroup;
  expanded: boolean;
  selectedRevisionId: string | null;
  onToggle: () => void;
  onSelectRevision: (rev: CompRevision) => void;
  onStatusChange: (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const { info, revisions, openCount, uniqueRequesters } = group;

  // 씬 ID 표시 (a001, SC001 등 원본 그대로)
  const sceneLabel = info.sceneId || `S${String(info.sceneNo).padStart(2, '0')}`;

  return (
    <div className="border-b border-bg-border/40 last:border-b-0">
      {/* 씬 헤더 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-border/10 transition-colors cursor-pointer"
      >
        {/* 펼치기/접기 */}
        <span className="shrink-0 text-text-secondary/50 w-5">
          {openCount > 0 && (
            expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          )}
        </span>

        {/* 씬 번호 뱃지 */}
        <span
          className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded border ${
            expanded
              ? 'text-accent border-accent/40 bg-accent/10'
              : 'text-text-secondary border-bg-border bg-bg-primary/50'
          }`}
        >
          {sceneLabel}
        </span>

        {/* 씬 이름 */}
        <span className="font-medium text-sm text-text-primary truncate">
          {info.sceneName || info.sceneId}
        </span>

        {/* 오른쪽: 아바타 + 미해결 뱃지 */}
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
      </button>

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
                      수정 요청 추가
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
