/**
 * SceneCard / TodoCard — '내 할일' 카드 뷰 (PR 4 신규).
 *
 * SceneCard: 썸네일(가이드 > 스보 > 없음, onError 폴백) + EP>파트 오버레이 + #번호/메모 +
 *   4단계 칩(StageChips) 토글. 본문/이미지 클릭 → 상세모달. hover → 본체 이동/제거.
 * TodoCard: 이미지 없는 컴팩트 카드(::개인 라벨 + 좌측 원형 체크 + 제목/메모). isHighlighted 승계.
 * (이미지 카드와 텍스트 카드는 MyTasksWidget이 그리드 섹션을 나눠 섞지 않는다.)
 */
import { useState } from 'react';
import { ExternalLink, X, Image as ImageIcon, Check } from 'lucide-react';
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
}

export function SceneCard({
  flat, deptCfg, epLabel, sceneNum, pct, isRemovable,
  onToggle, onRemove, onOpenDetail, onNavigateToMain,
}: SceneCardProps) {
  const s = flat.scene;
  const [imgError, setImgError] = useState(false);
  const imageUrl = s.guideUrl || s.storyboardUrl; // 가이드 우선 > 스보
  const info = currentStageInfo(s);
  const stageLabel = info.currentStageKey ? deptCfg.stageLabels[info.currentStageKey] : null;
  const memoText = s.memo ? stripEntityTokens(s.memo) : '';

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border bg-bg-card overflow-hidden transition-colors',
        pct >= 100 ? 'opacity-60 border-bg-border/30' : 'border-bg-border/40 hover:border-bg-border/70',
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
        <StageChips scene={s} deptCfg={deptCfg} onToggleStage={(stage) => onToggle(flat, stage)} />
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
    </div>
  );
}

interface TodoCardProps {
  todo: PersonalTodo;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenDetail: (todo: PersonalTodo) => void;
  isHighlighted?: boolean;
}

export function TodoCard({ todo, onToggle, onRemove, onOpenDetail, isHighlighted }: TodoCardProps) {
  const memoText = todo.memo ? stripEntityTokens(todo.memo) : '';
  return (
    <div
      ref={isHighlighted ? (el: HTMLDivElement | null) => { el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border bg-bg-card p-2 min-h-[92px] transition-colors',
        todo.completed ? 'opacity-60 border-bg-border/30' : 'border-bg-border/40 hover:border-bg-border/70',
        isHighlighted && 'ring-1 ring-accent/60 animate-pulse',
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(todo.id); }}
          aria-pressed={todo.completed}
          title={todo.completed ? '완료됨 · 누르면 해제' : '완료로 표시'}
          className={cn(
            'w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all shrink-0',
            todo.completed ? 'bg-green-500 border-green-500 text-white' : 'border-bg-border/50 hover:border-accent',
          )}
        >
          {todo.completed && <Check size={11} strokeWidth={3} />}
        </button>
        <span className="text-[10px] font-bold text-accent">::ᅠ개인</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(todo.id); }}
          className="ml-auto p-1 text-red-400/60 hover:text-red-400 rounded cursor-pointer opacity-0 group-hover:opacity-100 transition-all shrink-0"
        >
          <X size={12} />
        </button>
      </div>
      <button
        type="button"
        onClick={() => onOpenDetail(todo)}
        className="flex flex-col gap-0.5 text-left cursor-pointer flex-1 min-w-0"
      >
        <span className={cn('text-[12px] text-text-primary line-clamp-2', todo.completed && 'line-through text-text-secondary/50')}>
          {todo.title}
        </span>
        {memoText && <span className="text-[10px] text-text-secondary/50 truncate">{memoText}</span>}
      </button>
    </div>
  );
}
