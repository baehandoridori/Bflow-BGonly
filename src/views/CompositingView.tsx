import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Filter,
  Circle,
  Clock,
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  ListFilter,
} from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { setRevisionsSheetsMode } from '@/services/revisionService';
import type { CompRevision, RevisionStatus } from '@/types';

// ─── 상수 ───────────────────────────────────

const STATUS_CONFIG: Record<RevisionStatus, { label: string; color: string; bg: string; icon: typeof Circle }> = {
  open: { label: '대기', color: '#FDCB6E', bg: 'rgba(253, 203, 110, 0.15)', icon: Circle },
  in_progress: { label: '진행중', color: '#74B9FF', bg: 'rgba(116, 185, 255, 0.15)', icon: Clock },
  resolved: { label: '해결', color: '#00B894', bg: 'rgba(0, 184, 148, 0.15)', icon: Check },
};

// ─── 시간 포맷 ───────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (hr < 24) return `${hr}시간 전`;
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

/** sceneKey (EP01:A:a001) 에서 정보 파싱 */
function parseSceneKey(sceneKey: string): { ep: string; part: string; sceneId: string } {
  const [ep, part, sceneId] = sceneKey.split(':');
  return { ep: ep || '', part: part || '', sceneId: sceneId || '' };
}

// ─── 상태 뱃지 ───────────────────────────────

function StatusBadge({ status }: { status: RevisionStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon size={10} fill={status === 'open' ? 'currentColor' : 'none'} />
      {cfg.label}
    </span>
  );
}

// ─── 필터 타입 ───────────────────────────────

type StatusFilterType = 'all' | RevisionStatus;

// ─── 메인 뷰 ─────────────────────────────────

export default function CompositingView() {
  const { currentUser } = useAuthStore();
  const sheetsConnected = useAppStore((s) => s.sheetsConnected);
  const { revisions, loadRevisions, updateStatus, isLoading } = useRevisionStore();

  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('all');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [showResolveInput, setShowResolveInput] = useState(false);

  useEffect(() => {
    setRevisionsSheetsMode(sheetsConnected);
    loadRevisions();
  }, [sheetsConnected, loadRevisions]);

  // 필터링
  const filtered = useMemo(() => {
    let list = [...revisions];

    if (statusFilter !== 'all') {
      list = list.filter((r) => r.status === statusFilter);
    }

    if (myTasksOnly && currentUser) {
      list = list.filter((r) => r.assignee === currentUser.userName || (!r.assignee && r.status !== 'resolved'));
    }

    // 최신 순 정렬
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [revisions, statusFilter, myTasksOnly, currentUser]);

  const selected = revisions.find((r) => r.id === selectedId) || null;

  // 통계
  const stats = useMemo(() => {
    const open = revisions.filter((r) => r.status === 'open').length;
    const inProgress = revisions.filter((r) => r.status === 'in_progress').length;
    const resolved = revisions.filter((r) => r.status === 'resolved').length;
    return { open, inProgress, resolved, total: revisions.length };
  }, [revisions]);

  const handleStatusChange = async (rev: CompRevision, newStatus: RevisionStatus, note?: string) => {
    await updateStatus(rev.id, rev.sceneKey, newStatus, {
      resolvedBy: currentUser?.userName,
      resolvedNote: note,
    });
    setShowResolveInput(false);
    setResolveNote('');
  };

  const navigateToScene = (sceneKey: string) => {
    const { ep } = parseSceneKey(sceneKey);
    const epNum = parseInt(ep.replace(/\D/g, ''), 10);
    if (epNum) {
      useAppStore.getState().setSelectedEpisode(epNum);
      useAppStore.getState().setView('scenes');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="shrink-0 px-6 pt-6 pb-4">
        <h1 className="text-lg font-semibold text-text-primary mb-4">컴포지팅 리비전</h1>

        {/* 통계 카드 */}
        <div className="flex gap-3 mb-4">
          {([
            { key: 'open' as const, label: '대기', count: stats.open },
            { key: 'in_progress' as const, label: '진행중', count: stats.inProgress },
            { key: 'resolved' as const, label: '해결', count: stats.resolved },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all cursor-pointer ${
                statusFilter === key
                  ? 'border-opacity-100 shadow-sm'
                  : 'border-bg-border hover:border-opacity-60'
              }`}
              style={{
                borderColor: statusFilter === key ? STATUS_CONFIG[key].color : undefined,
                backgroundColor: statusFilter === key ? STATUS_CONFIG[key].bg : 'rgba(26, 29, 39, 0.6)',
              }}
            >
              <span className="text-xl font-bold" style={{ color: STATUS_CONFIG[key].color }}>{count}</span>
              <span className="text-xs text-text-secondary">{label}</span>
            </button>
          ))}
        </div>

        {/* 필터 바 */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMyTasksOnly(!myTasksOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
              myTasksOnly
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-bg-border text-text-secondary hover:text-text-primary'
            }`}
          >
            <ListFilter size={14} />
            내 할 일
          </button>
          <span className="text-xs text-text-secondary">
            {filtered.length}건{statusFilter !== 'all' ? ` (${STATUS_CONFIG[statusFilter].label})` : ''}
          </span>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 flex min-h-0">
        {/* 좌측: 리비전 목록 */}
        <div className="w-[380px] shrink-0 border-r border-bg-border overflow-y-auto">
          {isLoading && revisions.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-text-secondary/50 text-sm">
              로딩 중...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary/50">
              <Filter size={32} className="mb-3" />
              <p className="text-sm">리비전이 없습니다</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map((rev) => {
                const { ep, part, sceneId } = parseSceneKey(rev.sceneKey);
                const isSelected = rev.id === selectedId;

                return (
                  <motion.button
                    key={rev.id}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => setSelectedId(rev.id)}
                    className={`w-full text-left px-4 py-3 border-b border-bg-border/50 transition-colors cursor-pointer ${
                      isSelected ? 'bg-accent/10' : 'hover:bg-bg-border/30'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-primary">
                          {ep} {part && `${part}파트`}
                        </span>
                        <span className="text-[11px] text-text-secondary">#{sceneId}</span>
                        <span className="text-[10px] text-text-secondary/60">Rev.{rev.revisionNo}</span>
                      </div>
                      <StatusBadge status={rev.status} />
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">{rev.description}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-secondary/60">
                      <span>{rev.requesterName}</span>
                      <span>&middot;</span>
                      <span>{formatTime(rev.createdAt)}</span>
                      {rev.department && (
                        <>
                          <span>&middot;</span>
                          <span className="uppercase">{rev.department === 'bg' ? 'BG' : 'ACT'}</span>
                        </>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* 우측: 상세 패널 */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="p-6"
              >
                {/* 상세 헤더 */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-base font-semibold text-text-primary">
                        Rev.{selected.revisionNo}
                      </h2>
                      <StatusBadge status={selected.status} />
                    </div>
                    <p className="text-xs text-text-secondary">
                      {(() => {
                        const { ep, part, sceneId } = parseSceneKey(selected.sceneKey);
                        return `${ep} ${part}파트 #${sceneId}`;
                      })()}
                    </p>
                  </div>
                  <button
                    onClick={() => navigateToScene(selected.sceneKey)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-bg-border text-text-secondary hover:text-accent hover:border-accent/40 transition-all cursor-pointer"
                  >
                    <ExternalLink size={12} />
                    씬으로 이동
                  </button>
                </div>

                {/* 설명 */}
                <div
                  className="rounded-xl p-4 mb-4 border border-bg-border/60"
                  style={{ background: 'rgba(26, 29, 39, 0.8)', backdropFilter: 'blur(12px)' }}
                >
                  <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
                    {selected.description}
                  </p>
                </div>

                {/* 이미지 */}
                {selected.imageUrl && (
                  <div className="mb-4">
                    <img
                      src={selected.imageUrl}
                      alt="첨부"
                      className="rounded-xl max-h-64 object-contain border border-bg-border/40"
                    />
                  </div>
                )}

                {/* 정보 */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {[
                    { label: '요청자', value: selected.requesterName },
                    { label: '파트', value: selected.department === 'bg' ? 'BG' : selected.department === 'acting' ? '액팅' : '-' },
                    { label: '담당 컴포지터', value: selected.assignee || '미배정' },
                    { label: '요청일', value: formatTime(selected.createdAt) },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-3 py-2 rounded-lg bg-bg-primary/50">
                      <p className="text-[10px] text-text-secondary/60 mb-0.5">{label}</p>
                      <p className="text-xs text-text-primary">{value}</p>
                    </div>
                  ))}
                </div>

                {/* 해결 정보 */}
                {selected.status === 'resolved' && (
                  <div
                    className="rounded-xl p-4 mb-4 border"
                    style={{ borderColor: STATUS_CONFIG.resolved.color + '40', backgroundColor: STATUS_CONFIG.resolved.bg }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Check size={14} style={{ color: STATUS_CONFIG.resolved.color }} />
                      <span className="text-xs font-medium" style={{ color: STATUS_CONFIG.resolved.color }}>해결됨</span>
                    </div>
                    {selected.resolvedBy && (
                      <p className="text-xs text-text-secondary">{selected.resolvedBy}이(가) 해결 &middot; {selected.resolvedAt ? formatTime(selected.resolvedAt) : ''}</p>
                    )}
                    {selected.resolvedNote && (
                      <p className="text-xs text-text-primary mt-1">{selected.resolvedNote}</p>
                    )}
                  </div>
                )}

                {/* 상태 변경 액션 */}
                {selected.status !== 'resolved' && (
                  <div className="flex items-center gap-3">
                    {selected.status === 'open' && (
                      <button
                        onClick={() => handleStatusChange(selected, 'in_progress')}
                        className="px-4 py-2 text-xs font-medium rounded-xl text-white transition-all cursor-pointer hover:opacity-90"
                        style={{ backgroundColor: STATUS_CONFIG.in_progress.color }}
                      >
                        진행 시작
                      </button>
                    )}
                    <button
                      onClick={() => setShowResolveInput(true)}
                      className="px-4 py-2 text-xs font-medium rounded-xl text-white transition-all cursor-pointer hover:opacity-90"
                      style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                    >
                      해결 완료
                    </button>
                  </div>
                )}

                {/* 해결 메모 입력 */}
                <AnimatePresence>
                  {showResolveInput && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="mt-4 overflow-hidden"
                    >
                      <textarea
                        value={resolveNote}
                        onChange={(e) => setResolveNote(e.target.value)}
                        placeholder="해결 메모 (선택)"
                        className="w-full px-3 py-2 text-sm bg-bg-primary rounded-xl border border-bg-border text-text-primary placeholder:text-text-secondary/50 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={() => { setShowResolveInput(false); setResolveNote(''); }}
                          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleStatusChange(selected, 'resolved', resolveNote)}
                          className="px-4 py-1.5 text-xs font-medium rounded-lg text-white transition-all cursor-pointer hover:opacity-90"
                          style={{ backgroundColor: STATUS_CONFIG.resolved.color }}
                        >
                          해결
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full text-text-secondary/40"
              >
                <ChevronDown size={32} className="mb-2 rotate-[-90deg]" />
                <p className="text-sm">좌측에서 리비전을 선택하세요</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
