/**
 * SceneCard / TodoCard — '내 할일' 카드 뷰 (PR 4 신규).
 *
 * SceneCard: 썸네일(가이드 > 스보 > 없음, onError 폴백) + EP>파트 오버레이 + #번호/메모 +
 *   4단계 칩(StageChips) 토글. 본문/이미지 클릭 → 상세모달. hover → 본체 이동/제거.
 * TodoCard는 별도 컴포넌트에서 이미지 없는 개인 할일 카드를 담당한다.
 * (이미지 카드와 텍스트 카드는 MyTasksWidget이 그리드 섹션을 나눠 섞지 않는다.)
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, X, Image as ImageIcon } from 'lucide-react';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Stage } from '@/types';
import { stripEntityTokens } from '@/utils/entityTokens';
import { cn } from '@/utils/cn';
import type { SceneKey, FlatScene, PersonalTodo } from '../types';
import { StageChips } from './StageChips';
import { currentStageInfo } from '../stageInfo';

interface SceneCardProps {
  flat: FlatScene;
  deptCfg: typeof DEPARTMENT_CONFIGS['bg'];
  epLabel: string;
  sceneNum: string;
  pct: number;
  isRemovable: boolean;
  onToggle: (flat: FlatScene, stage: Stage) => void;
  onRemove: (key: SceneKey) => void;
  onOpenDetail: (flat: FlatScene) => void;
  onNavigateToMain: (flat: FlatScene) => void;
  enterDelay?: number;
  reduce?: boolean;
}
export function SceneCard({
  flat, deptCfg, epLabel, sceneNum, pct, isRemovable,
  onToggle, onRemove, onOpenDetail, onNavigateToMain,
  enterDelay = 0, reduce = false,
}: SceneCardProps) {
  const s = flat.scene;
  const [imgError, setImgError] = useState(false);
  const imageUrl = s.guideUrl || s.storyboardUrl; // 가이드 우선 > 스보
  // 카드 인스턴스는 flat.key 로 고정 유지된다. 이미지 URL 이 실시간으로 바뀌면(가이드/스보 교체)
  // 이전 URL 의 404 로 굳은 imgError 를 풀어 새 이미지를 다시 시도한다(영구 플레이스홀더 방지).
  useEffect(() => { setImgError(false); }, [imageUrl]);
  const info = currentStageInfo(s);
  const stageLabel = info.currentStageKey ? deptCfg.stageLabels[info.currentStageKey] : null;
  const memoText = s.memo ? stripEntityTokens(s.memo) : '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.25, delay: enterDelay }}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-bg-card overflow-hidden transition-[border-color,box-shadow]',
        pct >= 100 ? 'opacity-60 border-bg-border/30' : 'border-bg-border/40 hover:border-bg-border/70 hover:shadow-[0_4px_18px_-6px_rgba(108,92,231,0.5)]',
      )}
    >
      {/* 썸네일 (클릭 → 상세) */}
      <button
        type="button"
        onClick={() => onOpenDetail(flat)}
        className="relative block w-full aspect-[4/3] bg-bg-primary/40 overflow-hidden cursor-pointer"
        title="클릭하여 상세 보기/편집"
      >
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={s.sceneId}
            onError={() => setImgError(true)}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-text-secondary/30">
            <ImageIcon size={20} className="opacity-50" />
          </div>
        )}
        {/* 컨텍스트 오버레이 */}
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/45 text-white text-[9px] font-medium backdrop-blur-sm pointer-events-none">
          {epLabel} &gt; {flat.partId}
        </span>
      </button>

      {/* #번호 + 현재단계 n/4 + 메모 (클릭 → 상세) */}
      <button
        type="button"
        onClick={() => onOpenDetail(flat)}
        className="flex flex-col gap-0.5 px-2 pt-1.5 text-left cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-mono text-accent shrink-0">#{sceneNum}</span>
          {info.doneCount > 0 && (
            <span className="text-[9px] text-text-secondary/45 tabular-nums truncate">{stageLabel} {info.doneCount}/{info.total}</span>
          )}
        </div>
        <span className="text-[11px] text-text-primary truncate">{memoText || s.sceneId}</span>
      </button>

      {/* 단계 칩 */}
      <div className="px-2 py-1.5">
        <StageChips scene={s} deptCfg={deptCfg} onToggleStage={(stage) => onToggle(flat, stage)} reduce={reduce} />
      </div>

      {/* hover 액션 */}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onNavigateToMain(flat); }}
          className="p-1 rounded bg-black/45 text-white/80 hover:text-white backdrop-blur-sm cursor-pointer"
          title="본체 앱의 씬 상세로 이동"
        >
          <ExternalLink size={11} />
        </button>
        {isRemovable && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(flat.key); }}
            className="p-1 rounded bg-black/45 text-red-300 hover:text-red-200 backdrop-blur-sm cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
