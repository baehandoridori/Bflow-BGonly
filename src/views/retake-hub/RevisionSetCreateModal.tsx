/**
 * RevisionSetCreateModal — 리테이크 세트 생성 모달 (리테이크 허브 5단계, 컴포지터급 전용).
 *
 * 입력: 제목(필수) + 에피소드 범위(선택) + 취합자(선택). createRevisionSet(service) 호출.
 * 낙관적 추가/롤백은 service/store 가 전담. 비컴포지터에게는 호출측(RetakeHubView)이 버튼 자체를 숨긴다.
 *
 * 부서(BG/ACT)는 사용자에게 노출하지 않으므로 입력에서 제외(department=null 로 생성).
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, ListPlus } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import type { AppUser, Episode } from '@/types';
import { createRevisionSet } from '@/services/revisionSetService';
import { isCompositorForCompositing } from '@/utils/compositingLabels';

interface Props {
  currentUser: AppUser | null;
  allUsers: AppUser[];
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  onClose: () => void;
  onCreated: (setId: string) => void;
}

export function RevisionSetCreateModal({
  currentUser,
  allUsers,
  episodes,
  episodeTitles,
  onClose,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState<number | ''>('');
  const [aggregatorId, setAggregatorId] = useState<string>(currentUser?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  // 에피소드 옵션 — episodeNumber 오름차순, 표시명은 사용자 지정 제목 우선.
  const episodeOptions = useMemo(() => {
    return [...episodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((e) => ({
        num: e.episodeNumber,
        label: episodeTitles[e.episodeNumber] || e.title || `EP.${String(e.episodeNumber).padStart(2, '0')}`,
      }));
  }, [episodes, episodeTitles]);

  // 취합자 후보 — 컴포지터급(컴포지터/admin/오너). 본인이 포함 안 돼도 직접 고를 수 있게 본인은 항상 포함.
  const aggregatorCandidates = useMemo(() => {
    const compositors = allUsers.filter((u) => isCompositorForCompositing(u));
    if (currentUser && !compositors.some((u) => u.id === currentUser.id)) {
      compositors.push(currentUser);
    }
    return compositors.sort((a, b) => a.name.localeCompare(b.name));
  }, [allUsers, currentUser]);

  const handleSubmit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await createRevisionSet({
        title: title.trim(),
        episodeNumber: episodeNumber === '' ? null : Number(episodeNumber),
        department: null,
        aggregatorId: aggregatorId || null,
        createdBy: currentUser?.id,
      });
      if (created) {
        onCreated(created.id);
      } else {
        sonnerToast.error('세트 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
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
        className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/60">
          <div className="flex items-center gap-2">
            <ListPlus size={18} className="text-accent" />
            <span className="text-[15px] font-bold text-text-primary">새 리테이크 세트</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
              제목 <span className="text-accent">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="예: 3화 최종본 리테이크"
              className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
              에피소드 <span className="text-text-secondary/50 font-normal normal-case">(선택)</span>
            </label>
            <select
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer"
            >
              <option value="">지정 안 함</option>
              {episodeOptions.map((o) => (
                <option key={o.num} value={o.num}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">
              취합자 <span className="text-text-secondary/50 font-normal normal-case">(선택)</span>
            </label>
            <select
              value={aggregatorId}
              onChange={(e) => setAggregatorId(e.target.value)}
              className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer"
            >
              <option value="">지정 안 함</option>
              {aggregatorCandidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 액션 */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-bg-border/60">
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
            disabled={!title.trim() || submitting}
            className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          >
            {submitting ? '만드는 중…' : '세트 만들기'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
