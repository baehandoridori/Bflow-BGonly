/**
 * RevisionImportModal — 기존 리테이크 '가져오기' (리테이크 허브 5단계, 스펙 §9.4).
 *
 * 현재 세트에 안 속한 리비전을 검색(에피소드/씬/내용)·다중 선택 → assignToSet 으로 편입한다.
 * 이미 다른 세트에 속한 리비전은 그 세트 제목을 표시(편입하면 소속이 옮겨진다).
 *
 * 편입은 revisionSetService.assignToSet 가 낙관/영속/롤백을 전담(이 컴포넌트는 호출만).
 * 세트 진행률/자동완료는 호출측(허브 뷰)의 maybeAutoCompleteSet effect 가 편입 후 반영한다.
 *
 * 부서(BG/ACT) 라벨 텍스트는 노출하지 않는다(메모리 규칙). 상태 색만 사용.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, FolderInput, Search, Check } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import type { CompRevision, CompRevisionSet, AppUser } from '@/types';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { parseRevisionSceneContext } from '@/utils/revisionSceneContext';
import { stripEntityTokens } from '@/utils/entityTokens';
import { assignToSet } from '@/services/revisionSetService';

interface Props {
  /** 편입 대상 세트. */
  targetSet: CompRevisionSet;
  /** 전역 전체 리비전 (현재 세트 소속/타 세트 소속 모두 포함). */
  allRevisions: CompRevision[];
  /** 세트 id → 제목 (타 세트 소속 표시용). */
  setTitleOf: (setId: string) => string | null;
  /** 에피소드 번호 → 라벨. */
  episodeLabelOf: (ep: number | null | undefined) => string | null;
  allUsers: AppUser[];
  onClose: () => void;
}

/** sceneKey 의 씬 번호 토큰(마지막 segment 의 숫자/원본). */
function sceneNumberOf(sceneKey: string): string {
  const last = (sceneKey || '').split(':').pop() ?? '';
  return last.replace(/^raw-/i, '');
}

/** 리비전 표시 라벨 — "EP01 A #3" 또는 형식 밖이면 '전반'. */
function sceneLabelOf(rev: CompRevision, episodeLabelOf: Props['episodeLabelOf']): string {
  const ctx = parseRevisionSceneContext(rev.sceneKey);
  if (!ctx) return '전반';
  const ep = episodeLabelOf(ctx.episodeNumber) ?? `EP.${String(ctx.episodeNumber).padStart(2, '0')}`;
  return `${ep} ${ctx.partId} #${sceneNumberOf(rev.sceneKey)}`;
}

export function RevisionImportModal({
  targetSet,
  allRevisions,
  setTitleOf,
  episodeLabelOf,
  allUsers,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map(allUsers.map((u) => [u.id, u.name]));
    return (id: string) => map.get(id) ?? id;
  }, [allUsers]);

  // 후보: 현재 세트에 안 속한 리비전. 최신 등록 먼저.
  const candidates = useMemo(() => {
    return allRevisions
      .filter((r) => r.setId !== targetSet.id)
      .slice()
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [allRevisions, targetSet.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((r) => {
      const haystack = [
        sceneLabelOf(r, episodeLabelOf),
        stripEntityTokens(r.description || ''),
        revisionNoToLabel(r.revisionNo),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [candidates, query, episodeLabelOf]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(ids.map((id) => assignToSet(id, targetSet.id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const ok = ids.length - failed;
      if (ok > 0) {
        sonnerToast.success(`${ok}개 리테이크를 세트에 담았어요.`);
      }
      if (failed > 0) {
        sonnerToast.error(`${failed}개는 담지 못했어요. 잠시 후 다시 시도해주세요.`);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-lg max-h-[82vh] flex flex-col rounded-2xl border border-bg-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-bg-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <FolderInput size={18} className="text-accent shrink-0" />
            <span className="text-[15px] font-bold text-text-primary truncate">
              기존 리테이크 가져오기
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors shrink-0"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 검색 */}
        <div className="shrink-0 px-5 pt-4 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="에피소드·씬·내용으로 검색"
              className="w-full pl-9 pr-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-secondary/60">
            「{targetSet.title}」에 담을 리테이크를 골라주세요.
          </p>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-5 py-2 min-h-0 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary/50">
              <p className="text-sm">
                {candidates.length === 0
                  ? '담을 수 있는 다른 리테이크가 없어요.'
                  : '검색 결과가 없어요.'}
              </p>
            </div>
          ) : (
            filtered.map((rev) => {
              const checked = selectedIds.has(rev.id);
              const statusCfg = STATUS_CONFIG[rev.status];
              const otherSetTitle = rev.setId ? setTitleOf(rev.setId) : null;
              const assigneeIds = rev.assigneeIds ?? [];
              return (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => toggle(rev.id)}
                  className={[
                    'w-full text-left rounded-xl border p-3 transition-all cursor-pointer flex items-start gap-3',
                    checked
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-bg-border/50 bg-bg-card/50 hover:border-accent/35 hover:bg-bg-border/25',
                  ].join(' ')}
                >
                  {/* 체크 박스 */}
                  <span
                    className={[
                      'mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                      checked ? 'bg-accent border-accent' : 'border-bg-border/70',
                    ].join(' ')}
                  >
                    {checked && <Check size={11} strokeWidth={3} className="text-white" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-accent-sub">
                        {revisionNoToLabel(rev.revisionNo)}
                      </span>
                      <span className="text-[11px] text-text-secondary/80">
                        {sceneLabelOf(rev, episodeLabelOf)}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ color: statusCfg.color, background: statusCfg.bg }}
                      >
                        {statusCfg.label}
                      </span>
                    </span>

                    <span className="block mt-1 text-[13px] text-text-primary line-clamp-2">
                      {stripEntityTokens(rev.description || '') || '내용 없음'}
                    </span>

                    <span className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-text-secondary/60">
                      {assigneeIds.length > 0 && (
                        <span>담당 {assigneeIds.map(nameOf).join(', ')}</span>
                      )}
                      {otherSetTitle && (
                        <span className="text-amber-400/80">현재 「{otherSetTitle}」 소속</span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* 액션 */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-4 border-t border-bg-border/60">
          <span className="text-[12px] text-text-secondary/75">
            {selectedIds.size > 0 ? `${selectedIds.size}개 선택됨` : '선택 없음'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
            >
              {submitting ? '담는 중…' : '세트에 담기'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
