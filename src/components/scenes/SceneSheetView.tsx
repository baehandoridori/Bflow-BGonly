import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Trash2 } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department } from '@/types';
import type { SceneGroupMode } from '@/stores/useAppStore';
import { sceneProgress } from '@/utils/calcStats';
import { cn } from '@/utils/cn';
import { HighlightText } from '@/components/common/HighlightText';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';

// ─── Props ───────────────────────────────────────────────────

interface SceneSheetViewProps {
  scenes: Scene[];
  allScenes: Scene[];
  department: Department;
  commentCounts: Record<string, number>;
  sheetName: string;
  searchQuery?: string;
  selectedSceneIds?: Set<string>;
  sceneGroupMode: SceneGroupMode;
  onToggle: (sceneId: string, stage: Stage) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: (sceneIndex: number) => void;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
  onCtrlClick?: (sceneId: string) => void;
}

// ─── 인라인 편집 셀 ──────────────────────────────────────────

function SheetEditableCell({
  value,
  field,
  sceneIndex,
  onSave,
  type = 'text',
  searchQuery,
  onOpenDetail,
}: {
  value: string;
  field: string;
  sceneIndex: number;
  onSave: (sceneIndex: number, field: string, value: string) => void;
  type?: 'text' | 'assignee';
  searchQuery?: string;
  onOpenDetail?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  // 담당자 편집 모드 진입 시 AssigneeSelect 내부 input 자동 포커스
  useEffect(() => {
    if (editing && type === 'assignee' && cellRef.current) {
      const input = cellRef.current.querySelector('input');
      if (input) setTimeout(() => input.focus(), 0);
    }
  }, [editing, type]);

  const commit = useCallback(() => {
    if (draft !== value) onSave(sceneIndex, field, draft);
    setEditing(false);
  }, [draft, value, onSave, sceneIndex, field]);

  const handleClick = useCallback(() => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    if (type === 'assignee') {
      // 담당자: 즉시 편집 모드 진입 (200ms 지연 없음)
      setEditing(true);
    } else {
      clickTimer.current = setTimeout(() => {
        setEditing(true);
      }, 200);
    }
  }, [type]);

  const handleDoubleClick = useCallback(() => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    onOpenDetail?.();
  }, [onOpenDetail]);

  if (editing) {
    if (type === 'assignee') {
      return (
        <td
          ref={cellRef}
          className="px-2 py-1"
          style={{ overflow: 'visible', position: 'relative' }}
          onClick={(e) => e.stopPropagation()}
        >
          <AssigneeSelect
            value={draft}
            onChange={(v) => { onSave(sceneIndex, field, v); setEditing(false); }}
            className="w-full"
          />
        </td>
      );
    }
    return (
      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          className="w-full bg-bg-primary border border-accent/50 rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent transition-colors"
        />
      </td>
    );
  }

  const isMemo = field === 'memo';
  return (
    <td
      className={cn(
        'px-2 py-1.5 text-xs text-text-secondary cursor-text truncate hover:bg-accent/5 transition-colors',
        isMemo && 'max-w-0',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <HighlightText text={value || '-'} query={searchQuery} />
    </td>
  );
}

// ─── 이미지 썸네일 + 호버 미리보기 ──────────────────────────

function SheetThumbnailCell({ url, label }: { url: string; label: string }) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!url || !cellRef.current) return;
    const rect = cellRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    // 기본: 셀 오른쪽에 표시
    let x = rect.right + 8;
    let y = rect.top + rect.height / 2;
    // 화면 오른쪽 넘침 방지
    if (x + 288 > viewportW) x = rect.left - 288 - 8;
    // 화면 하단 넘침 방지
    if (y + 120 > viewportH) y = viewportH - 130;
    if (y - 120 < 0) y = 130;
    setHoverPos({ x, y });
  }, [url]);

  return (
    <td
      ref={cellRef}
      className="px-1 py-1 text-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHoverPos(null)}
    >
      {url ? (
        <img
          src={url}
          alt={label}
          className="w-10 h-10 object-contain rounded border border-bg-border/50 mx-auto"
          draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span className="text-[10px] text-text-secondary/30">-</span>
      )}

      {/* 호버 미리보기 포탈 */}
      {hoverPos && url && createPortal(
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="fixed z-[999] pointer-events-none"
          style={{
            left: hoverPos.x,
            top: hoverPos.y,
            transform: 'translateY(-50%)',
          }}
        >
          <img
            src={url}
            alt={label}
            className="max-w-[280px] max-h-[240px] object-contain rounded-lg shadow-2xl border border-bg-border bg-bg-card"
          />
        </motion.div>,
        document.body,
      )}
    </td>
  );
}

// ─── 진행률 셀 (퍼센트 + 미니 바) ───────────────────────────

function SheetProgressCell({ pct }: { pct: number }) {
  return (
    <td className="px-1.5 py-1.5 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span className={cn(
          'text-[11px] font-mono leading-none',
          pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary',
        )}>
          {Math.round(pct)}%
        </span>
        <div className="w-full h-1 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: pct >= 100 ? '#00B894' : pct >= 50 ? '#FDCB6E' : '#74B9FF',
            }}
          />
        </div>
      </div>
    </td>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────

export function SceneSheetView({
  scenes,
  allScenes,
  department,
  commentCounts,
  sheetName,
  searchQuery,
  selectedSceneIds,
  sceneGroupMode,
  onToggle,
  onDelete,
  onOpenDetail,
  onFieldUpdate,
  onCtrlClick,
}: SceneSheetViewProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];

  // 레이아웃 그룹핑 (layout 모드)
  const layoutGroups = useMemo(() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, Scene[]>();
    for (const scene of scenes) {
      const lid = (scene.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(scene);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  }, [scenes, sceneGroupMode]);

  // 각 씬이 그룹에서 첫 번째인지, 그룹 크기 (layout 모드용)
  const layoutMeta = useMemo(() => {
    if (!layoutGroups) return new Map<Scene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    const meta = new Map<Scene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    for (const [layoutKey, groupScenes] of layoutGroups) {
      groupScenes.forEach((scene, i) => {
        meta.set(scene, { isFirst: i === 0, groupSize: groupScenes.length, layoutKey });
      });
    }
    return meta;
  }, [layoutGroups]);

  // 레이아웃 모드에서 그룹 순서로 정렬된 scenes
  const orderedScenes = useMemo(() => {
    if (!layoutGroups) return scenes;
    return layoutGroups.flatMap(([, groupScenes]) => groupScenes);
  }, [layoutGroups, scenes]);

  const displayScenes = layoutGroups ? orderedScenes : scenes;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <div className="overflow-auto rounded-lg border border-bg-border">
        <table className="w-full text-sm border-collapse">
          {/* ── 헤더 ── */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-card border-b border-bg-border">
              {sceneGroupMode === 'layout' && (
                <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary border-r border-bg-border/50">
                  레이아웃
                </th>
              )}
              <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary">씬번호</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-text-secondary">메모</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">스토리보드</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">가이드</th>
              <th className="w-24 px-2 py-2 text-left text-xs font-medium text-text-secondary">담당자</th>
              {STAGES.map((s) => (
                <th
                  key={s}
                  className="w-10 px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: deptConfig.stageColors[s] }}
                >
                  {deptConfig.stageLabels[s]}
                </th>
              ))}
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">진행</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>

          {/* ── 본문 ── */}
          <tbody>
            {displayScenes.map((scene, rowIndex) => {
              const pct = sceneProgress(scene);
              const idx = allScenes.indexOf(scene);
              const meta = layoutMeta.get(scene);
              const isSelected = selectedSceneIds?.has(scene.sceneId);
              const isFirstInGroup = meta?.isFirst ?? false;
              const groupSize = meta?.groupSize ?? 1;
              const layoutKey = meta?.layoutKey ?? '';

              return (
                <motion.tr
                  key={`${scene.sceneId}-${idx}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(rowIndex * 0.01, 0.2) }}
                  className={cn(
                    'border-b border-bg-border/30 transition-colors group',
                    rowIndex % 2 === 0 ? 'bg-bg-card/20' : 'bg-bg-primary/10',
                    'hover:bg-accent/5',
                    isSelected && 'bg-accent/10 hover:bg-accent/15',
                    searchQuery && 'bg-accent/5 border-l-2 border-l-accent/60',
                    sceneGroupMode === 'layout' && isFirstInGroup && rowIndex > 0 && 'border-t-2 border-t-bg-border',
                  )}
                  onClick={(e) => {
                    if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                      onCtrlClick(scene.sceneId);
                    }
                  }}
                  onDoubleClick={() => onOpenDetail(idx)}
                >
                  {/* 레이아웃 병합 셀 */}
                  {sceneGroupMode === 'layout' && isFirstInGroup && (
                    <td
                      rowSpan={groupSize}
                      className="px-2 py-2 text-center font-mono text-xs font-bold border-r border-bg-border/50 align-middle"
                      style={{ color: deptConfig.color }}
                    >
                      {layoutKey !== '미분류' ? `#${layoutKey}` : (
                        <span className="text-text-secondary/40 font-normal">-</span>
                      )}
                    </td>
                  )}

                  {/* 씬번호 + 댓글 뱃지 */}
                  <td className="px-2 py-1.5 font-mono text-xs text-accent">
                    <span className="flex items-center gap-1">
                      <HighlightText text={scene.sceneId || '-'} query={searchQuery} />
                      {(() => {
                        const cc = commentCounts[`${sheetName}:${scene.no}`];
                        return cc > 0 ? (
                          <span className="inline-flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-px rounded-full">
                            <MessageCircle size={9} fill="currentColor" />
                            <span className="text-[10px] font-bold">{cc}</span>
                          </span>
                        ) : null;
                      })()}
                    </span>
                  </td>

                  {/* 메모 (인라인 편집) */}
                  <SheetEditableCell
                    value={scene.memo || ''}
                    field="memo"
                    sceneIndex={idx}
                    onSave={onFieldUpdate}
                    searchQuery={searchQuery}
                    onOpenDetail={() => onOpenDetail(idx)}
                  />

                  {/* 스토리보드 썸네일 */}
                  <SheetThumbnailCell url={scene.storyboardUrl} label="스토리보드" />

                  {/* 가이드 썸네일 */}
                  <SheetThumbnailCell url={scene.guideUrl} label="가이드" />

                  {/* 담당자 (인라인 편집) */}
                  <SheetEditableCell
                    value={scene.assignee || ''}
                    field="assignee"
                    sceneIndex={idx}
                    onSave={onFieldUpdate}
                    type="assignee"
                    searchQuery={searchQuery}
                    onOpenDetail={() => onOpenDetail(idx)}
                  />

                  {/* 진행상황 체크박스 (LO/완료/검수/PNG) */}
                  {STAGES.map((stage) => (
                    <td key={stage} className="px-1 py-1.5 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggle(scene.sceneId, stage); }}
                        className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
                        style={
                          scene[stage]
                            ? { backgroundColor: deptConfig.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                            : { border: '1px solid #2D3041' }
                        }
                      >
                        {scene[stage] ? '✓' : ''}
                      </button>
                    </td>
                  ))}

                  {/* 진행률 */}
                  <SheetProgressCell pct={pct} />

                  {/* 삭제 */}
                  <td className="px-1 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                      className="opacity-0 group-hover:opacity-100 text-text-secondary/50 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
